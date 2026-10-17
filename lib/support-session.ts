import { createHmac, randomInt } from "node:crypto";
import { signSupportToken } from "./app-jwt";
import { prisma } from "./prisma";

/** One-time code lifetime (admin → phone/web hand-off). */
export const SUPPORT_CODE_TTL_MS = 5 * 60_000;
/** How long a redeemed support session stays signed in. */
export const SUPPORT_SESSION_TTL_MS = 60 * 60_000;
/** Ops a support session may never run: they would change the real user's device or credentials. */
export const SUPPORT_BLOCKED_OPS = new Set(["savePushToken", "changePassword", "updateMyName", "requestContactChange", "confirmContactChange"]);

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export class SupportSessionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type SupportContext = {
  sessionId: string;
  adminEmail: string;
  expiresAt: string;
};

function secret() {
  const value =
    process.env.ANEKIO_AUTH_SECRET || process.env.JWT_SECRET || process.env.APP_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!value) throw new SupportSessionError(503, "Support login is not configured.");
  return value;
}

export function normalizeSupportCode(raw: string) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function supportCodeHash(code: string) {
  return createHmac("sha256", secret()).update(`support:${normalizeSupportCode(code)}`).digest("hex");
}

function newCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return code;
}

export function formatSupportCode(code: string) {
  const clean = normalizeSupportCode(code);
  return `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

async function audit(orgId: string | null | undefined, actorEmail: string, action: string, detail: string, userId: string) {
  try {
    await prisma.saasAuditEvent.create({
      data: { orgId: orgId || null, actorEmail, action, detail, entityType: "User", entityId: userId },
    });
  } catch (error) {
    console.error("Support audit write failed", error);
  }
}

export async function createSupportCode(input: { adminEmail: string; orgId: string; userId: string; reason?: string }) {
  const reason = String(input.reason || "").trim().slice(0, 300);
  if (!reason) throw new SupportSessionError(400, "Add a reason or ticket for this support login.");
  const user = await prisma.user.findFirst({
    where: { id: input.userId, orgId: input.orgId },
    select: { id: true, name: true, orgId: true, role: { select: { name: true } } },
  });
  if (!user) throw new SupportSessionError(404, "That user is not in this organisation.");
  const code = newCode();
  const codeExpiresAt = new Date(Date.now() + SUPPORT_CODE_TTL_MS);
  const session = await prisma.supportSession.create({
    data: {
      orgId: user.orgId,
      targetUserId: user.id,
      adminEmail: input.adminEmail.toLowerCase(),
      reason,
      codeHash: supportCodeHash(code),
      codeExpiresAt,
    },
  });
  await audit(user.orgId, input.adminEmail, "SUPPORT_LOGIN_CODE", `Code for ${user.name} (${user.role.name}) · ${reason}`, user.id);
  return { sessionId: session.id, code: formatSupportCode(code), codeExpiresAt, user };
}

/** Exchanges a one-time code for a 60-minute support token. Single use. */
export async function redeemSupportCode(rawCode: string) {
  const code = normalizeSupportCode(rawCode);
  if (code.length !== CODE_LENGTH) throw new SupportSessionError(400, "Enter the 8-character support code.");
  const now = new Date();
  const session = await prisma.supportSession.findUnique({ where: { codeHash: supportCodeHash(code) } });
  if (!session || session.redeemedAt || session.endedAt || session.codeExpiresAt < now) {
    throw new SupportSessionError(401, "That support code is invalid, used, or expired.");
  }
  const expiresAt = new Date(now.getTime() + SUPPORT_SESSION_TTL_MS);
  const claimed = await prisma.supportSession.updateMany({
    where: { id: session.id, redeemedAt: null },
    data: { redeemedAt: now, expiresAt },
  });
  if (claimed.count !== 1) throw new SupportSessionError(401, "That support code is invalid, used, or expired.");
  await audit(session.orgId, session.adminEmail, "SUPPORT_LOGIN_STARTED", session.reason, session.targetUserId);
  return {
    userId: session.targetUserId,
    token: signSupportToken(session.targetUserId, session.id, expiresAt),
    support: { sessionId: session.id, adminEmail: session.adminEmail, expiresAt: expiresAt.toISOString() } satisfies SupportContext,
  };
}

/** Returns the live session for a support token, or null when ended/expired. */
export async function activeSupportSession(sessionId: string, userId: string): Promise<SupportContext | null> {
  const session = await prisma.supportSession.findUnique({ where: { id: sessionId } });
  if (!session || session.targetUserId !== userId || !session.redeemedAt || session.endedAt) return null;
  if (!session.expiresAt || session.expiresAt < new Date()) return null;
  return { sessionId: session.id, adminEmail: session.adminEmail, expiresAt: session.expiresAt.toISOString() };
}

export async function endSupportSession(sessionId: string) {
  const session = await prisma.supportSession.findUnique({ where: { id: sessionId } });
  if (!session || session.endedAt) return;
  await prisma.supportSession.update({ where: { id: sessionId }, data: { endedAt: new Date() } });
  await audit(session.orgId, session.adminEmail, "SUPPORT_LOGIN_ENDED", session.reason, session.targetUserId);
}

export async function recordSupportWrite(user: { id: string; orgId?: string | null; support?: SupportContext }, op: string) {
  if (!user.support) return;
  await audit(user.orgId, user.support.adminEmail, "SUPPORT_WRITE", op || "write", user.id);
}

export async function supportUsersForOrg(orgId: string, q = "") {
  const search = q.trim();
  return prisma.user.findMany({
    where: search
      ? { orgId, OR: [{ name: { contains: search } }, { email: { contains: search } }, { phone: { contains: search } }] }
      : { orgId },
    take: 200,
    orderBy: [{ role: { portal: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, email: true, phone: true, role: { select: { name: true, portal: true } } },
  });
}

export async function recentSupportSessions(orgId: string, take = 10) {
  return prisma.supportSession.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take,
    include: { targetUser: { select: { name: true } } },
  });
}
