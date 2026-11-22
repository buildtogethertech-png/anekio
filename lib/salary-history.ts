/**
 * Salary history: a salary is never overwritten. Each change adds a SalaryRevision row (amount, from which month);
 * Teacher / StaffMember.monthlySalary keeps today's figure for the screens that only need that.
 * The salary for a month = the latest revision with effectiveFrom on or before that month.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";

type Db = Prisma.TransactionClient | typeof prisma;
export type SalaryKind = "teacher" | "staff";
export type SalaryRevisionRow = { amount: number; effectiveFrom: string; reason: string; at: string };

export function monthOf(date: Date | string = new Date()) {
  if (typeof date === "string" && /^\d{4}-\d{2}/.test(date)) return date.slice(0, 7);
  const d = typeof date === "string" ? new Date(date) : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Records a salary for this person from `effectiveFrom` (YYYY-MM, default this month) when it differs from the
 * salary already in force then. A second change in the same month replaces that month's row (no history of typos).
 */
export async function recordSalary(
  db: Db,
  kind: SalaryKind,
  id: string,
  input: { orgId: string | null; amount: number; effectiveFrom?: string; reason?: string; actorId?: string | null }
) {
  const amount = Math.round(Number(input.amount) || 0);
  const effectiveFrom = /^\d{4}-\d{2}$/.test(String(input.effectiveFrom || "")) ? String(input.effectiveFrom) : monthOf();
  const owner = kind === "teacher" ? { teacherId: id } : { staffMemberId: id };
  const inForce = await db.salaryRevision.findFirst({
    where: { ...owner, effectiveFrom: { lte: effectiveFrom } },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  if (inForce && inForce.amount === amount) return;
  if (inForce && inForce.effectiveFrom === effectiveFrom) {
    await db.salaryRevision.update({ where: { id: inForce.id }, data: { amount, reason: input.reason ?? inForce.reason, updatedById: input.actorId ?? null } });
  } else {
    await db.salaryRevision.create({
      data: { orgId: input.orgId, ...owner, amount, effectiveFrom, reason: input.reason || "", createdById: input.actorId ?? null, updatedById: input.actorId ?? null },
    });
  }
}

/** The salary in force for `month` from a person's history (oldest first or any order); `fallback` when none. */
export function salaryForMonth(history: { amount: number; effectiveFrom: string }[] | undefined, month: string, fallback: number) {
  let best: { amount: number; effectiveFrom: string } | null = null;
  for (const row of history ?? []) {
    if (row.effectiveFrom <= month && (!best || row.effectiveFrom >= best.effectiveFrom)) best = row;
  }
  return best ? best.amount : fallback;
}

/** Include for teacher / staff queries: the salary history, oldest first. */
export const SALARY_HISTORY_INCLUDE = {
  salaryRevisions: { select: { amount: true, effectiveFrom: true, reason: true, createdAt: true }, orderBy: [{ effectiveFrom: "asc" as const }, { createdAt: "asc" as const }] },
};

export function salaryHistoryOf(row: { salaryRevisions?: { amount: number; effectiveFrom: string; reason: string; createdAt: Date }[] }): SalaryRevisionRow[] {
  return (row.salaryRevisions ?? []).map((r) => ({ amount: r.amount, effectiveFrom: r.effectiveFrom, reason: r.reason, at: r.createdAt.toISOString() }));
}

/**
 * Makes the history match today's salaries for everyone in scope: a person with no history gets one row from their
 * joining month; a person whose current salary differs from the history gets a row from this month. Used after
 * Excel imports (which set monthlySalary directly) and as the one-off local backfill.
 */
export async function reconcileSalaryHistory(db: Db, orgId: string | null) {
  const month = monthOf();
  const scope = orgId ? { orgId } : {};
  const [teachers, staff] = await Promise.all([
    db.teacher.findMany({ where: { ...scope, OR: [{ archivedAt: null }, { archivedAt: { not: null } }] }, select: { id: true, orgId: true, monthlySalary: true, joinedOn: true, ...SALARY_HISTORY_INCLUDE } }),
    db.staffMember.findMany({ where: { ...scope, OR: [{ archivedAt: null }, { archivedAt: { not: null } }] }, select: { id: true, orgId: true, monthlySalary: true, joinedOn: true, ...SALARY_HISTORY_INCLUDE } }),
  ]);
  let added = 0;
  for (const [kind, rows] of [["teacher", teachers], ["staff", staff]] as const) {
    for (const row of rows) {
      const history = row.salaryRevisions;
      const from = !history.length ? monthOf(row.joinedOn || month) : month;
      if (history.length && salaryForMonth(history, month, -1) === row.monthlySalary) continue;
      await recordSalary(db, kind, row.id, { orgId: row.orgId ?? null, amount: row.monthlySalary, effectiveFrom: from, reason: history.length ? "" : "Joining salary" });
      added += 1;
    }
  }
  return added;
}

/** Staff → profile → Revise salary: a new salary from a month, with a reason. Today's figure moves once that month comes. */
export async function reviseSalaryCore(user: AccessUser, input: { kind?: string; id?: string; amount?: number | string; effectiveFrom?: string; reason?: string }) {
  if (!can(user, "salary.approve")) throw new Error("No access.");
  const kind: SalaryKind = input.kind === "teacher" ? "teacher" : "staff";
  const id = String(input.id || "").trim();
  const amount = Math.round(Number(String(input.amount ?? "").replace(/[₹,\s]/g, "")));
  if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) throw new Error("Enter the monthly salary in rupees.");
  const effectiveFrom = String(input.effectiveFrom || "").slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveFrom)) throw new Error("Pick the month it starts from.");
  const reason = String(input.reason || "").trim().slice(0, 120);
  const row =
    kind === "teacher"
      ? await prisma.teacher.findFirst({ where: { id }, select: { id: true, orgId: true } })
      : await prisma.staffMember.findFirst({ where: { id }, select: { id: true, orgId: true } });
  if (!row) throw new Error("Employee not found.");
  await recordSalary(prisma, kind, row.id, { orgId: row.orgId ?? null, amount, effectiveFrom, reason, actorId: user.id });
  if (effectiveFrom <= monthOf()) {
    if (kind === "teacher") await prisma.teacher.update({ where: { id: row.id }, data: { monthlySalary: amount } });
    else await prisma.staffMember.update({ where: { id: row.id }, data: { monthlySalary: amount } });
  }
  return { ok: true as const };
}
