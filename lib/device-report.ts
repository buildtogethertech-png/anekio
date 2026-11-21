/**
 * Staff phone report (brand, model, NFC support, IP), in DeviceReport: one row per staff login, sent once.
 * The session tells the app `deviceCheck: true` only while that row is missing, so a phone reports once.
 * To ask someone's phone again, delete their row (scripts/sql/2026-11-21-device-reports.sql).
 */
import type { AccessUser } from "./permissions";
import { prisma } from "./prisma";

const clip = (value: unknown) => String(value ?? "").trim().slice(0, 80);

function staffLogin(user: AccessUser) {
  return !user.support && (user.portal === "TEACHER" || user.portal === "OFFICE");
}

export async function deviceCheckWanted(user: AccessUser) {
  if (!staffLogin(user)) return false;
  try {
    return !(await prisma.deviceReport.findUnique({ where: { userId: user.id }, select: { id: true } }));
  } catch {
    return false; // table not created yet on this server
  }
}

export async function saveDeviceReportCore(
  user: AccessUser,
  input: {
    platform?: string;
    nfc?: string;
    brand?: string;
    model?: string;
    modelId?: string;
    os?: string;
    appBuild?: string;
    ip?: string;
  }
) {
  if (!staffLogin(user)) return;
  const data = {
    platform: clip(input.platform),
    brand: clip(input.brand),
    model: clip(input.model),
    modelId: clip(input.modelId),
    os: clip(input.os),
    appBuild: clip(input.appBuild),
    nfc: ["yes", "no"].includes(String(input.nfc)) ? String(input.nfc) : "unknown",
    ip: clip(input.ip),
    reportedAt: new Date(),
  };
  await prisma.deviceReport.upsert({
    where: { userId: user.id },
    create: { userId: user.id, orgId: user.orgId ?? null, ...data },
    update: data,
  });
}
