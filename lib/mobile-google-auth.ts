import { OAuth2Client } from "google-auth-library";

function audiences() {
  const configured = String(process.env.GOOGLE_MOBILE_ALLOWED_AUDIENCES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(configured.length ? configured : [String(process.env.GOOGLE_MOBILE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim()].filter(Boolean))];
}

export function mobileGoogleAuthConfigured() {
  return audiences().length > 0;
}

export async function verifiedGoogleEmail(idToken: string) {
  const expectedAudiences = audiences();
  if (!expectedAudiences.length) throw new Error("Google sign-in is not configured.");

  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({
    idToken,
    audience: expectedAudiences,
  });
  const payload = ticket.getPayload();
  const email = String(payload?.email || "").trim().toLowerCase();

  if (!email || !payload?.email_verified) {
    throw new Error("Google did not provide a verified email address.");
  }
  return email;
}
