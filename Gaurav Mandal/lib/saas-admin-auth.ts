import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "anekio_saas_admin";
export const ADMIN_OAUTH_COOKIE = "anekio_saas_oauth";

export type SaasAdminSession = {
  email: string;
  csrf: string;
  iat: number;
  exp: number;
};

type OAuthState = {
  state: string;
  verifier: string;
  redirectUri: string;
  basePath: string;
  iat: number;
  exp: number;
};

function secret() {
  const value = process.env.JWT_SECRET || process.env.APP_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error("JWT_SECRET is required for the SaaS admin session.");
  return value;
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign<T>(value: T) {
  const body = encode(value);
  const signature = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verify<T>(token: string): T | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>();
  for (const item of String(header || "").split(";")) {
    const index = item.indexOf("=");
    if (index < 1) continue;
    const name = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

function list(value: string | undefined) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function adminEmailAllowed(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return false;
  const exactEmails = new Set([
    "buildtogether.tech@gmail.com",
    ...list(process.env.ANEKIO_ADMIN_ALLOWED_EMAILS),
  ]);
  const domains = new Set([
    "anekio.com",
    "anekio.in",
    ...list(process.env.ANEKIO_ADMIN_ALLOWED_DOMAINS).map((domain) => domain.replace(/^@/, "")),
  ]);
  return exactEmails.has(email) || domains.has(email.slice(at + 1));
}

export function localAdminLoginAvailable() {
  return process.env.NODE_ENV !== "production";
}

export function verifyLocalAdminLogin(rawEmail: string, rawPassword: string) {
  if (!localAdminLoginAvailable()) return false;
  const email = rawEmail.trim().toLowerCase();
  if (!adminEmailAllowed(email)) return false;
  const expected = String(process.env.ANEKIO_ADMIN_DEV_PASSWORD || "12345");
  const actualBuffer = Buffer.from(rawPassword);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createAdminSession(email: string, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  return sign<SaasAdminSession>({
    email: email.trim().toLowerCase(),
    csrf: randomBytes(24).toString("base64url"),
    iat,
    exp: iat + 60 * 60 * 12,
  });
}

export function readAdminSession(cookieHeader: string | undefined, now = Date.now()) {
  const token = parseCookies(cookieHeader).get(ADMIN_SESSION_COOKIE);
  if (!token) return null;
  const session = verify<SaasAdminSession>(token);
  const timestamp = Math.floor(now / 1000);
  if (!session?.email || !session.csrf || session.exp <= timestamp || session.iat > timestamp + 60) return null;
  if (!adminEmailAllowed(session.email)) return null;
  return session;
}

export function secureRequest(input: { protocol?: string; forwardedProto?: string }) {
  return process.env.NODE_ENV === "production" || input.protocol === "https" || input.forwardedProto === "https";
}

export function cookieValue(
  name: string,
  value: string,
  options: { secure: boolean; maxAgeSeconds: number }
) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
  ];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function clearCookie(name: string, secure: boolean) {
  return cookieValue(name, "", { secure, maxAgeSeconds: 0 });
}

function googleConfig() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

export function googleAdminAuthConfigured() {
  return googleConfig().configured;
}

export function createGoogleAdminAuth(redirectUri: string, basePath: string, now = Date.now()) {
  const config = googleConfig();
  if (!config.configured) throw new Error("Google admin sign-in is not configured.");
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const iat = Math.floor(now / 1000);
  const value = sign<OAuthState>({ state, verifier, redirectUri, basePath, iat, exp: iat + 10 * 60 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return { url: url.toString(), cookie: value };
}

export async function finishGoogleAdminAuth(input: {
  cookieHeader: string | undefined;
  state: string;
  code: string;
  now?: number;
}) {
  const config = googleConfig();
  if (!config.configured) throw new Error("Google admin sign-in is not configured.");
  const token = parseCookies(input.cookieHeader).get(ADMIN_OAUTH_COOKIE);
  const oauth = token ? verify<OAuthState>(token) : null;
  const timestamp = Math.floor((input.now ?? Date.now()) / 1000);
  if (!oauth || oauth.exp <= timestamp || oauth.iat > timestamp + 60 || oauth.state !== input.state) {
    throw new Error("The sign-in request expired. Please try again.");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: input.code,
      code_verifier: oauth.verifier,
      grant_type: "authorization_code",
      redirect_uri: oauth.redirectUri,
    }),
  });
  const tokenBody = (await response.json()) as { access_token?: string; error_description?: string };
  if (!response.ok || !tokenBody.access_token) {
    throw new Error(tokenBody.error_description || "Google sign-in could not be completed.");
  }
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const profile = (await profileResponse.json()) as { email?: string; email_verified?: boolean; name?: string };
  const email = String(profile.email || "").trim().toLowerCase();
  if (!profileResponse.ok || !profile.email_verified || !adminEmailAllowed(email)) {
    throw new Error("This Google account is not authorised for the Anekio admin portal.");
  }
  return { email, name: String(profile.name || "").trim(), basePath: oauth.basePath };
}
