import bcrypt from "bcryptjs";
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";
import { userForLogin } from "./login";
import { looksLikeEmail, normalizeMobile } from "./phone";
import { publicOrigin } from "./utils";

export type AuthChallengePurpose = "LOGIN" | "PASSWORD_RESET";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESET_LINK_TTL_MS = 15 * 60 * 1000;
const RESEND_AFTER_MS = 45 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;
const MAX_ATTEMPTS = 5;

export class AuthFlowError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function authSecret() {
  const secret =
    process.env.ANEKIO_AUTH_SECRET ||
    process.env.JWT_SECRET ||
    process.env.APP_JWT_SECRET ||
    process.env.NEXTAUTH_SECRET;
  if (!secret) throw new AuthFlowError(503, "Secure sign-in is temporarily unavailable.");
  return secret;
}

function normalizeIdentifier(raw: string) {
  const value = raw.trim();
  if (looksLikeEmail(value)) return value.toLowerCase();
  return normalizeMobile(value) || value.toLowerCase();
}

function identifierHash(raw: string) {
  return createHmac("sha256", authSecret()).update(normalizeIdentifier(raw)).digest("hex");
}

export function authCodeHash(challengeId: string, purpose: AuthChallengePurpose, code: string) {
  return createHmac("sha256", authSecret()).update(`${challengeId}:${purpose}:${code}`).digest("hex");
}

export function authCodeMatches(expectedHex: string, challengeId: string, purpose: AuthChallengePurpose, code: string) {
  const actual = Buffer.from(authCodeHash(challengeId, purpose, code));
  const expected = Buffer.from(expectedHex);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function deliverableEmail(value: string | null | undefined) {
  const email = String(value || "").trim().toLowerCase();
  return email.includes("@") && !email.endsWith(".local") ? email : "";
}

function maskEmail(value: string) {
  const [name = "", domain = ""] = value.split("@");
  if (!domain) return "your registered email";
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"*".repeat(Math.max(3, name.length - visible.length))}@${domain}`;
}

function maskMobile(value: string) {
  const phone = normalizeMobile(value);
  if (!phone) return "your registered mobile";
  return `+91 ${phone.slice(0, 2)}${"•".repeat(6)}${phone.slice(-2)}`;
}

function emailConfig() {
  const apiKey = (process.env.ANEKIO_AUTH_RESEND_API_KEY || process.env.RESEND_API_KEY || "").trim();
  const from = (process.env.ANEKIO_AUTH_FROM_EMAIL || "Anekio <support@anekio.com>").trim();
  return { apiKey, from, configured: Boolean(apiKey && from) };
}

function wakitConfig() {
  const token = (process.env.WAKIT_TOKEN || "").trim();
  const template = (process.env.WAKIT_OTP_TEMPLATE || "otp").trim();
  const language = (process.env.WAKIT_OTP_LANGUAGE || "en_US").trim();
  return { token, template, language, configured: Boolean(token && template && language) };
}

function renflairConfig() {
  const apiKey = (process.env.RENFLAIR_API_KEY || "").trim();
  return { apiKey, configured: Boolean(apiKey) };
}

function providerResponseText(value: unknown) {
  if (typeof value === "string") return value.toLowerCase();
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return "";
  }
}

function providerReportedFailure(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const status = "status" in value && typeof value.status === "string" ? value.status.toLowerCase() : "";
  return status === "failed" || status === "error";
}

function whatsappUnavailable(status: number, payload: unknown) {
  const detail = providerResponseText(payload);
  return (
    status === 404 ||
    /not (?:on|registered (?:on|with)) whatsapp|whatsapp (?:number )?(?:is )?not (?:available|registered|found)|no whatsapp account/.test(detail)
  );
}

function emailCopy(code: string, purpose: AuthChallengePurpose) {
  const action = purpose === "LOGIN" ? "sign in to Anekio" : "reset your Anekio password";
  const subject = purpose === "LOGIN" ? "Your Anekio sign-in code" : "Reset your Anekio password";
  const text = `Use ${code} to ${action}. This code expires in 10 minutes and can be used once. If you did not request it, you can ignore this email.`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#102a56;line-height:1.6;max-width:520px;margin:auto;padding:24px">
    <div style="font-size:18px;font-weight:800;margin-bottom:24px">Anekio</div>
    <h1 style="font-size:24px;line-height:1.25;margin:0 0 12px">${subject}</h1>
    <p style="color:#52657d;margin:0 0 22px">Use this verification code to ${action}.</p>
    <div style="font-size:32px;font-weight:800;background:#f1f6ff;border:1px solid #c9d9f3;border-radius:8px;padding:18px 20px;text-align:center">${code}</div>
    <p style="color:#52657d;font-size:13px;margin:20px 0 0">The code expires in 10 minutes and works once. Anekio will never ask you to share it.</p>
  </div>`;
  return { subject, text, html };
}

function resetLinkEmailCopy(url: string) {
  const subject = "Reset your Anekio password";
  const text = `Reset your password using this link: ${url}\n\nThis link expires in 15 minutes. If you did not request it, ignore this email.`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#102a56;line-height:1.6;max-width:520px;margin:auto;padding:24px">
    <div style="font-size:18px;font-weight:800;margin-bottom:24px">Anekio</div>
    <h1 style="font-size:24px;line-height:1.25;margin:0 0 12px">Reset your Anekio password</h1>
    <p style="color:#52657d;margin:0 0 22px">Reset your password using the link below.</p>
    <p style="margin:0 0 22px"><a href="${url}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:12px 18px;border-radius:8px;font-weight:700;text-decoration:none">Reset password</a></p>
    <p style="color:#52657d;font-size:13px;margin:0">This link expires in 15 minutes. If you did not request it, ignore this email.</p>
  </div>`;
  return { subject, text, html };
}

async function sendAuthEmail(to: string, code: string, purpose: AuthChallengePurpose) {
  const config = emailConfig();
  if (!config.configured) {
    if (process.env.NODE_ENV !== "production") return false;
    throw new AuthFlowError(503, "Email verification is being configured. Use your password for now.");
  }
  const mail = emailCopy(code, purpose);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: config.from, to: [to], ...mail }),
  });
  if (!response.ok) {
    throw new AuthFlowError(503, "We could not send the verification email. Try again shortly.");
  }
  return true;
}

async function sendWhatsAppOtp(phone: string, code: string) {
  const config = wakitConfig();
  if (!config.configured) return "unavailable" as const;
  const response = await fetch("https://wakit.in/api/v1/messages/template", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: `+91${phone}`,
      template: config.template,
      language: config.language,
      params: [String(code), "Anekio"],
    }),
  });
  const raw = await response.text();
  let payload: unknown = raw;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Providers may return plain-text error bodies.
  }
  if (response.ok && !providerReportedFailure(payload)) return "sent" as const;
  if (whatsappUnavailable(response.status, payload)) return "unavailable" as const;
  throw new AuthFlowError(503, "We could not send the WhatsApp verification code. Try again shortly.");
}

async function sendSmsOtp(phone: string, code: string) {
  const config = renflairConfig();
  if (!config.configured) {
    if (process.env.NODE_ENV !== "production") return false;
    throw new AuthFlowError(503, "SMS verification is being configured. Use your password or email instead.");
  }
  const url = new URL("https://sms.renflair.in/V1.php");
  url.search = new URLSearchParams({ API: config.apiKey, PHONE: phone, OTP: String(code) }).toString();
  const response = await fetch(url);
  const raw = await response.text();
  let payload: unknown = raw;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Providers may return plain-text success bodies.
  }
  if (!response.ok || providerReportedFailure(payload)) {
    throw new AuthFlowError(503, "We could not send the SMS verification code. Try again shortly.");
  }
  return true;
}

async function sendMobileOtp(phone: string, code: string) {
  const whatsAppResult = await sendWhatsAppOtp(phone, code);
  if (whatsAppResult === "sent") return "WHATSAPP" as const;
  const smsSent = await sendSmsOtp(phone, code);
  return smsSent ? ("SMS" as const) : null;
}

async function sendResetLinkEmail(to: string, url: string) {
  const config = emailConfig();
  if (!config.configured) {
    if (process.env.NODE_ENV !== "production") return false;
    throw new AuthFlowError(503, "Email verification is being configured. Use your password for now.");
  }
  const mail = resetLinkEmailCopy(url);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.from, to: [to], ...mail }),
  });
  if (!response.ok) throw new AuthFlowError(503, "We could not send the reset link. Try again shortly.");
  return true;
}

export async function requestAuthCode(raw: string, purpose: AuthChallengePurpose) {
  const identifier = normalizeIdentifier(raw);
  if (!identifier) throw new AuthFlowError(400, "Enter your email or mobile number.");
  const usingEmail = looksLikeEmail(identifier);
  const isPasswordReset = purpose === "PASSWORD_RESET";
  const responseDestination = isPasswordReset ? "your registered email" : usingEmail ? maskEmail(identifier) : maskMobile(identifier);

  const now = new Date();
  const hash = identifierHash(identifier);
  const rateWindow = new Date(now.getTime() - RATE_WINDOW_MS);
  const resendAfter = new Date(now.getTime() - RESEND_AFTER_MS);
  await prisma.authChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });

  const [recent, latest, user] = await Promise.all([
    prisma.authChallenge.count({ where: { identifierHash: hash, purpose, createdAt: { gte: rateWindow } } }),
    prisma.authChallenge.findFirst({ where: { identifierHash: hash, purpose }, orderBy: { createdAt: "desc" } }),
    userForLogin(identifier),
  ]);
  if (latest && latest.createdAt > resendAfter) {
    throw new AuthFlowError(429, "Please wait a moment before requesting another code.");
  }
  if (recent >= RATE_LIMIT) {
    throw new AuthFlowError(429, "Too many code requests. Try again in 15 minutes.");
  }

  const id = randomUUID();
  const code = purpose === "PASSWORD_RESET" ? randomBytes(32).toString("base64url") : String(randomInt(0, 1_000_000)).padStart(6, "0");
  const destination = isPasswordReset || usingEmail ? deliverableEmail(user?.email) : user ? normalizeMobile(identifier) : "";
  const challenge = await prisma.authChallenge.create({
    data: {
      id,
      userId: user?.id || null,
      identifierHash: hash,
      destination,
      purpose,
      codeHash: authCodeHash(id, purpose, code),
      expiresAt: new Date(now.getTime() + (purpose === "PASSWORD_RESET" ? RESET_LINK_TTL_MS : CODE_TTL_MS)),
    },
  });

  let mobileDelivery: "WHATSAPP" | "SMS" | null = null;
  if (destination) {
    try {
      if (purpose === "PASSWORD_RESET") {
        await sendResetLinkEmail(destination, `${publicOrigin()}/reset-password?token=${encodeURIComponent(`${id}.${code}`)}`);
      } else if (usingEmail) {
        await sendAuthEmail(destination, code, purpose);
      } else {
        mobileDelivery = await sendMobileOtp(destination, code);
      }
    } catch (error) {
      await prisma.authChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
      throw error;
    }
  }

  return {
    ok: true as const,
    message:
      purpose === "PASSWORD_RESET"
        ? "If that account has a verified email, a reset link is on its way."
        : usingEmail
          ? "If that account has a verified email, a six-digit code is on its way."
          : mobileDelivery === "SMS"
            ? "If that account has a registered mobile, a six-digit SMS code is on its way."
            : "If that account has a registered mobile, a six-digit WhatsApp code is on its way.",
    destination: responseDestination,
    expiresInSeconds: (purpose === "PASSWORD_RESET" ? RESET_LINK_TTL_MS : CODE_TTL_MS) / 1000,
    ...(process.env.NODE_ENV !== "production" && purpose !== "PASSWORD_RESET" ? { developmentCode: code } : {}),
  };
}

export async function consumeAuthCode(raw: string, purpose: AuthChallengePurpose, rawCode: string) {
  const identifier = normalizeIdentifier(raw);
  const code = rawCode.replace(/\D/g, "");
  if (!identifier || code.length !== 6) throw new AuthFlowError(400, "Enter the six-digit code.");

  const challenge = await prisma.authChallenge.findFirst({
    where: {
      identifierHash: identifierHash(identifier),
      purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge || challenge.attempts >= MAX_ATTEMPTS) {
    throw new AuthFlowError(401, "That code is invalid or has expired.");
  }

  if (!authCodeMatches(challenge.codeHash, challenge.id, purpose, code)) {
    const attempts = challenge.attempts + 1;
    await prisma.authChallenge.update({
      where: { id: challenge.id },
      data: { attempts, ...(attempts >= MAX_ATTEMPTS ? { consumedAt: new Date() } : {}) },
    });
    throw new AuthFlowError(401, "That code is invalid or has expired.");
  }

  const consumed = await prisma.authChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date(), attempts: { increment: 1 } },
  });
  if (consumed.count !== 1 || !challenge.userId) {
    throw new AuthFlowError(401, "That code is invalid or has expired.");
  }
  return challenge.userId;
}

export async function resetPasswordWithCode(raw: string, code: string, nextPassword: string) {
  if (nextPassword.length < 8) throw new AuthFlowError(400, "Use at least 8 characters for the new password.");
  const userId = await consumeAuthCode(raw, "PASSWORD_RESET", code);
  const password = await bcrypt.hash(nextPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { password } });
  return { ok: true as const };
}

export async function resetPasswordWithLink(rawToken: string, nextPassword: string) {
  if (nextPassword.length < 8) throw new AuthFlowError(400, "Use at least 8 characters for the new password.");
  const [id, token] = rawToken.split(".");
  if (!id || !token) throw new AuthFlowError(401, "That reset link is invalid or has expired.");
  const challenge = await prisma.authChallenge.findFirst({ where: { id, purpose: "PASSWORD_RESET", consumedAt: null, expiresAt: { gt: new Date() } } });
  if (!challenge || !authCodeMatches(challenge.codeHash, challenge.id, "PASSWORD_RESET", token) || !challenge.userId) {
    throw new AuthFlowError(401, "That reset link is invalid or has expired.");
  }
  const consumed = await prisma.authChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (consumed.count !== 1) throw new AuthFlowError(401, "That reset link is invalid or has expired.");
  await prisma.user.update({ where: { id: challenge.userId }, data: { password: await bcrypt.hash(nextPassword, 10) } });
  return { ok: true as const };
}
