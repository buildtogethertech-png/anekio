import type { AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { normalizeMobile } from "./phone";
import { confirmContactChange, requestContactChange } from "./auth-challenges";

/**
 * The signed-in person's own login details for the Profile page.
 * Name: office staff edit their own; teachers, parents and students ask the office, because the
 * name prints on payroll, report cards and receipts.
 */
export async function getMyAccountCore(user: AccessUser) {
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, email: true, phone: true } });
  if (!row) throw new Error("Account missing");
  const email = (row.email || "").trim();
  return {
    name: row.name,
    email: email.endsWith(".local") ? "" : email,
    phone: normalizeMobile(row.phone || "") || "",
    canEditName: user.portal === "OFFICE",
    canEditContact: user.portal !== "STUDENT",
  };
}

export async function updateMyNameCore(user: AccessUser, input: { name?: string }) {
  if (user.portal !== "OFFICE") throw new Error("Ask the school office to change your name.");
  const name = String(input.name || "").replace(/\s+/g, " ").trim();
  if (name.length < 2) throw new Error("Enter your full name.");
  if (name.length > 80) throw new Error("Keep the name under 80 characters.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { name } }),
    prisma.staffMember.updateMany({ where: { userId: user.id }, data: { name } }),
  ]);
  return { name };
}

export async function requestMyContactChangeCore(user: AccessUser, input: { kind?: string; value?: string; password?: string }) {
  if (user.portal === "STUDENT") throw new Error("Ask the school office to change your login.");
  return requestContactChange(user.id, input);
}

export async function confirmMyContactChangeCore(user: AccessUser, input: { kind?: string; code?: string }) {
  if (user.portal === "STUDENT") throw new Error("Ask the school office to change your login.");
  return confirmContactChange(user.id, input);
}
