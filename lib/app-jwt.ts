import { createHmac, timingSafeEqual } from "crypto";

function secret() {
  const s = process.env.JWT_SECRET || process.env.APP_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("JWT_SECRET is missing");
  return s;
}

function b64url(value: string | Buffer) {
  const buf = typeof value === "string" ? Buffer.from(value) : value;
  return buf.toString("base64url");
}

function parsePart(part: string) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

type TokenBody = { sub?: string; typ?: string; sid?: string; as?: string; iat?: number; exp?: number };

function signBody(body: Record<string, unknown>) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(body));
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", secret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifiedBody(token: string): TokenBody | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const data = `${header}.${payload}`;
  const expected = createHmac("sha256", secret()).update(data).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const body = parsePart(payload) as TokenBody;
  if (typeof body.exp === "number" && body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

/** `as: "PARENT"` signs in a staff member who is also a parent with their parent hat. */
export function signAppToken(userId: string, as?: AppHat) {
  const now = Math.floor(Date.now() / 1000);
  return signBody({ sub: userId, typ: "app", ...(as ? { as } : {}), iat: now, exp: now + 60 * 60 * 24 * 30 });
}

export type AppHat = "PARENT" | "TEACHER";

export function verifyAppToken(token: string) {
  return verifyAppTokenClaims(token)?.userId ?? null;
}

export function verifyAppTokenClaims(token: string): { userId: string; as?: AppHat } | null {
  const body = verifiedBody(token);
  if (!body || body.typ !== "app" || !body.sub) return null;
  const as = body.as === "PARENT" || body.as === "TEACHER" ? (body.as as AppHat) : undefined;
  return { userId: body.sub, ...(as ? { as } : {}) };
}

/** Short-lived token for an Anekio staff "log in as" session. Revocable via SupportSession.endedAt. */
export function signSupportToken(userId: string, sessionId: string, expiresAt: Date) {
  const now = Math.floor(Date.now() / 1000);
  return signBody({ sub: userId, typ: "support", sid: sessionId, iat: now, exp: Math.floor(expiresAt.getTime() / 1000) });
}

export function verifySupportToken(token: string) {
  const body = verifiedBody(token);
  if (!body || body.typ !== "support" || !body.sub || !body.sid) return null;
  return { userId: body.sub, sessionId: body.sid };
}
