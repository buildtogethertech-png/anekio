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

export function signAppToken(userId: string) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub: userId, typ: "app", iat: now, exp: now + 60 * 60 * 24 * 30 })
  );
  const data = `${header}.${payload}`;
  const sig = createHmac("sha256", secret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyAppToken(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const data = `${header}.${payload}`;
  const expected = createHmac("sha256", secret()).update(data).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const body = parsePart(payload) as { sub?: string; typ?: string; exp?: number };
  if (body.typ !== "app" || !body.sub) return null;
  if (typeof body.exp === "number" && body.exp < Math.floor(Date.now() / 1000)) return null;
  return body.sub;
}
