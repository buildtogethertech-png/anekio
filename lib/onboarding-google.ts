import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";
import { publicOrigin } from "./utils";
import {
  IMPORT_KINDS,
  onboardingSpreadsheetTemplate,
  onboardingTemplate,
  previewOnboardingRows,
  rowsFromCsvContent,
  rowsFromWorkbookBuffer,
  type ImportKind,
} from "./onboarding";

const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const AUTH_SCOPE = `openid email ${DRIVE_FILE_SCOPE}`;
const SHEETS_MIME = "application/vnd.google-apps.spreadsheet";
const STATE_TTL_SECONDS = 10 * 60;
const TOKEN_SKEW_MS = 60 * 1000;

type OAuthState = {
  userId: string;
  verifier: string;
  returnTo: string;
  iat: number;
  exp: number;
};

type TokenBody = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type Connection = NonNullable<Awaited<ReturnType<typeof prisma.googleDriveConnection.findUnique>>>;

function need(user: AccessUser) {
  if (!can(user, "onboarding.manage")) throw new Error("No access.");
}

function googleConfig() {
  const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim();
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

function redirectUri() {
  return String(process.env.GOOGLE_DRIVE_REDIRECT_URI || `${publicOrigin()}/api/v1/onboarding/google/callback`).trim();
}

function secret() {
  const value = process.env.GOOGLE_DRIVE_TOKEN_SECRET || process.env.APP_JWT_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is missing.");
  return value;
}

function signingKey() {
  return createHash("sha256").update(secret()).digest();
}

function b64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function signState(payload: OAuthState) {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyState(value: string): OAuthState {
  const [body, sig] = String(value || "").split(".");
  if (!body || !sig) throw new Error("Google connection expired. Please try again.");
  const expected = createHmac("sha256", signingKey()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Google connection expired. Please try again.");
  const state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
  const now = Math.floor(Date.now() / 1000);
  if (!state.userId || !state.verifier || state.exp <= now || state.iat > now + 60) {
    throw new Error("Google connection expired. Please try again.");
  }
  return state;
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", signingKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decrypt(value: string) {
  const [iv, tag, encrypted] = String(value || "").split(".");
  if (!iv || !tag || !encrypted) return "";
  const decipher = createDecipheriv("aes-256-gcm", signingKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function asKind(value: unknown): ImportKind {
  const kind = String(value || "") as ImportKind;
  if (!IMPORT_KINDS.includes(kind)) throw new Error("Choose a valid onboarding template.");
  return kind;
}

function parseGoogleJson<T>(text: string): T | null {
  try {
    return text ? JSON.parse(text) as T : null;
  } catch {
    return null;
  }
}

function googleErrorMessage(text: string, fallback: string) {
  const data = parseGoogleJson<{
    error?: string | { message?: string };
    error_description?: string;
    message?: string;
  }>(text);
  if (data?.error_description) return data.error_description;
  if (typeof data?.error === "string" && data.error) return data.error;
  if (data?.error && typeof data.error === "object" && data.error.message) return data.error.message;
  if (data?.message) return data.message;
  const plain = text.trim();
  if (plain) return plain.slice(0, 500);
  return fallback;
}

function safeReturnTo(value: string) {
  const fallback = `${publicOrigin()}/onboarding`;
  try {
    const candidate = new URL(value || fallback);
    const current = new URL(publicOrigin());
    const local = ["localhost", "127.0.0.1"].includes(candidate.hostname) || candidate.hostname.endsWith(".localhost");
    if (candidate.protocol.startsWith("http") && (candidate.host === current.host || local)) return candidate.toString();
  } catch {
    // Fall through to the known app route.
  }
  return fallback;
}

export function googleDriveOnboardingConfigured() {
  return googleConfig().configured;
}

export async function createOnboardingGoogleAuthUrl(user: AccessUser, input: { returnTo?: string } = {}) {
  need(user);
  const config = googleConfig();
  if (!config.configured) throw new Error("Google Sheets is not configured. Add Google OAuth credentials first.");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const now = Math.floor(Date.now() / 1000);
  const state = signState({
    userId: user.id,
    verifier,
    returnTo: safeReturnTo(String(input.returnTo || "")),
    iat: now,
    exp: now + STATE_TTL_SECONDS,
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", AUTH_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent select_account");
  return { configured: true, connected: false, authUrl: url.toString() };
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await response.text();
  const data = parseGoogleJson<TokenBody>(text);
  if (!response.ok || !data?.access_token) {
    throw new Error(googleErrorMessage(text, "Google Sheets connection failed."));
  }
  return data;
}

async function googleEmail(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return "";
  const data = parseGoogleJson<{ email?: string }>(await response.text());
  return String(data?.email || "").trim().toLowerCase();
}

export async function finishOnboardingGoogleAuth(input: { state: string; code: string }) {
  const config = googleConfig();
  if (!config.configured) throw new Error("Google Sheets is not configured.");
  const state = verifyState(input.state);
  const existing = await prisma.googleDriveConnection.findUnique({ where: { userId: state.userId } });
  const tokens = await tokenRequest(new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: input.code,
    code_verifier: state.verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
  }));
  const accessToken = tokens.access_token || "";
  const refreshToken = tokens.refresh_token || (existing ? decrypt(existing.encryptedRefreshToken) : "");
  if (!refreshToken) throw new Error("Google did not return Drive access. Please connect again and approve file access.");
  const expiresAt = new Date(Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000);
  const email = await googleEmail(accessToken);
  await prisma.googleDriveConnection.upsert({
    where: { userId: state.userId },
    update: {
      googleEmail: email,
      scope: tokens.scope || DRIVE_FILE_SCOPE,
      encryptedAccessToken: encrypt(accessToken),
      encryptedRefreshToken: encrypt(refreshToken),
      expiresAt,
    },
    create: {
      userId: state.userId,
      googleEmail: email,
      scope: tokens.scope || DRIVE_FILE_SCOPE,
      encryptedAccessToken: encrypt(accessToken),
      encryptedRefreshToken: encrypt(refreshToken),
      expiresAt,
    },
  });
  return safeReturnTo(state.returnTo);
}

async function accessTokenFor(connection: Connection) {
  if (connection.expiresAt.getTime() > Date.now() + TOKEN_SKEW_MS) return decrypt(connection.encryptedAccessToken);
  const config = googleConfig();
  const refreshToken = decrypt(connection.encryptedRefreshToken);
  const tokens = await tokenRequest(new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }));
  const accessToken = tokens.access_token || "";
  await prisma.googleDriveConnection.update({
    where: { id: connection.id },
    data: {
      encryptedAccessToken: encrypt(accessToken),
      expiresAt: new Date(Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000),
      scope: tokens.scope || connection.scope,
    },
  });
  return accessToken;
}

async function requireConnection(user: AccessUser, returnTo: string) {
  const connection = await prisma.googleDriveConnection.findUnique({ where: { userId: user.id } });
  if (connection) return { connection, missing: null };
  return { connection: null, missing: await createOnboardingGoogleAuthUrl(user, { returnTo }) };
}

function multipartBody(name: string, contentType: string, file: Buffer) {
  const boundary = `anekio_${randomBytes(12).toString("hex")}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const metadata = Buffer.from(
    [
      delimiter,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify({ name, mimeType: SHEETS_MIME }),
      delimiter,
      `Content-Type: ${contentType}\r\n`,
      "Content-Transfer-Encoding: binary\r\n\r\n",
    ].join(""),
    "utf8"
  );
  const tail = Buffer.from(closeDelimiter, "utf8");
  return { boundary, body: Buffer.concat([metadata, file, tail]) };
}

export async function createOnboardingGoogleSheet(user: AccessUser, input: { kind?: string; returnTo?: string }) {
  need(user);
  const kind = asKind(input.kind);
  const config = googleConfig();
  if (!config.configured) throw new Error("Google Sheets is not configured. Add Google OAuth credentials first.");
  const returnTo = safeReturnTo(String(input.returnTo || ""));
  const { connection, missing } = await requireConnection(user, returnTo);
  if (missing || !connection) return missing!;
  const template = await onboardingSpreadsheetTemplate(user, kind);
  const accessToken = await accessTokenFor(connection);
  const name = template.fileName.replace(/\.(csv|xlsx)$/i, "").replace(/-/g, " ");
  const multipart = multipartBody(name, template.contentType, template.buffer);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${multipart.boundary}`,
      "Content-Length": String(multipart.body.length),
    },
    body: new Uint8Array(multipart.body),
  });
  const text = await response.text();
  const data = parseGoogleJson<{ id?: string; name?: string; webViewLink?: string; error?: { message?: string } }>(text);
  if (!response.ok || !data?.id || !data.webViewLink) {
    throw new Error(googleErrorMessage(text, "Could not create the Google Sheet."));
  }
  await prisma.schoolOnboardingState.upsert({
    where: { id: "school" },
    update: {},
    create: { id: "school" },
  });
  const sheet = await prisma.onboardingGoogleSheet.create({
    data: {
      stateId: "school",
      userId: user.id,
      kind,
      fileId: data.id,
      name: data.name || name,
      webViewLink: data.webViewLink,
    },
  });
  return {
    configured: true,
    connected: true,
    sheet: {
      id: sheet.id,
      kind,
      fileId: sheet.fileId,
      name: sheet.name,
      webViewLink: sheet.webViewLink,
    },
  };
}

export async function previewOnboardingGoogleSheet(user: AccessUser, input: { kind?: string; sheetId?: string; fileId?: string }) {
  need(user);
  const kind = asKind(input.kind);
  const sheet = await prisma.onboardingGoogleSheet.findFirst({
    where: {
      userId: user.id,
      kind,
      OR: [
        { id: String(input.sheetId || "") },
        { fileId: String(input.fileId || "") },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  if (!sheet) throw new Error("Open this template in Google Sheets first.");
  const connection = await prisma.googleDriveConnection.findUnique({ where: { userId: user.id } });
  if (!connection) throw new Error("Connect Google Sheets first.");
  const accessToken = await accessTokenFor(connection);
  const exportMime = kind === "students"
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv";
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(sheet.fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(body.toString("utf8") || "Could not read the Google Sheet.");
  const rows = kind === "students"
    ? await rowsFromWorkbookBuffer(kind, body)
    : rowsFromCsvContent(body.toString("utf8"));
  const preview = await previewOnboardingRows(user, {
    kind,
    fileName: `${sheet.name}.csv`,
    uploadPath: `google:${sheet.fileId}`,
    rows,
  });
  await prisma.onboardingGoogleSheet.update({
    where: { id: sheet.id },
    data: { reviewedAt: new Date(), importId: preview.batchId },
  });
  return { ...preview, sheetId: sheet.id, webViewLink: sheet.webViewLink };
}
