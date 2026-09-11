import { randomUUID } from "node:crypto";
import { InvoiceStatus } from "@prisma/client";
import { prisma } from "./prisma";
import {
  dueDateForMonth,
  feeLineTotal,
  feePeriod,
  invoiceBalance,
  invoiceLateStamp,
  monthFeeTitle,
  periodFromDate,
  sessionMonthsThrough,
} from "./fees";
import { ensureSchoolSessions } from "./school-session";

async function sessionRange(sessionId?: string, asOf = new Date()) {
  const { sessions, current } = await ensureSchoolSessions();
  const session = (sessionId && sessions.find((s) => s.id === sessionId)) || current;
  return {
    session,
    months: sessionMonthsThrough(asOf, { start: session.startsOn, end: session.endsOn }),
  };
}

function coveredPeriods(rows: { studentId: string; period: string }[]) {
  const have = new Set<string>();
  for (const row of rows) {
    if (!row.period) continue;
    have.add(`${row.studentId}:${row.period}`);
    have.add(`${row.studentId}:${row.period.slice(0, 7)}`);
  }
  return have;
}

function feeAddOnApplies(
  addOn: { startsPeriod: string; endsPeriod: string; cadence: string; active: boolean },
  period: string
) {
  if (!addOn.active) return false;
  if (addOn.startsPeriod && addOn.startsPeriod > period) return false;
  if (addOn.endsPeriod && addOn.endsPeriod < period) return false;
  if (addOn.cadence === "ONE_TIME") return addOn.startsPeriod === period;
  return true;
}

function feeAddOnLines(
  addOns: { label: string; kind: string; amount: number; startsPeriod: string; endsPeriod: string; cadence: string; active: boolean }[],
  period: string
) {
  return addOns.filter((addOn) => feeAddOnApplies(addOn, period)).map((addOn) => ({
    label: addOn.label,
    kind: "FLAT" as const,
    amount: addOn.kind === "DISCOUNT" || addOn.kind === "CONCESSION" ? -Math.abs(addOn.amount) : Math.abs(addOn.amount),
  }));
}

export async function backfillInvoicePeriods() {
  const orphans = await prisma.feeInvoice.findMany({
    where: { period: "" },
    select: { id: true, studentId: true, dueDate: true },
  });
  for (const inv of orphans) {
    let period = periodFromDate(inv.dueDate);
    const clash = await prisma.feeInvoice.findFirst({
      where: { studentId: inv.studentId, period, NOT: { id: inv.id } },
      select: { id: true },
    });
    if (clash) period = `${period}-${inv.id.slice(-4)}`;
    await prisma.feeInvoice.update({ where: { id: inv.id }, data: { period } });
  }
}

export async function previewDueFees(classId: string, asOf = new Date(), sessionId?: string) {
  const { months } = await sessionRange(sessionId, asOf);
  const [students, existing] = await Promise.all([
    prisma.student.findMany({ where: { classId }, select: { id: true } }),
    prisma.feeInvoice.findMany({
      where: { classId },
      select: { period: true, studentId: true },
    }),
  ]);
  const have = coveredPeriods(existing);
  return {
    studentCount: students.length,
    months: months.map((m) => {
      const already = students.filter((s) => have.has(`${s.id}:${m.period}`)).length;
      return {
        period: m.period,
        label: new Date(m.year, m.monthIndex, 1).toLocaleString("en-IN", {
          month: "long",
          year: "numeric",
        }),
        already,
        missing: Math.max(0, students.length - already),
      };
    }),
  };
}

export async function issueDueFeesCore(asOf = new Date(), classId?: string, sessionId?: string) {
  await backfillInvoicePeriods();
  const { session, months } = await sessionRange(sessionId, asOf);
  const templates = await prisma.feeTemplate.findMany({
    where: {
      sessionId: session.id,
      ...(classId ? { classId } : {}),
    },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });

  let created = 0;
  const added: string[] = [];

  for (const template of templates) {
    if (!template.lines.length) continue;
    const activeMonths = months.filter((month) => {
      if (template.startsPeriod && template.startsPeriod > month.period) return false;
      if (template.endsPeriod && template.endsPeriod < month.period) return false;
      return true;
    });
    if (!activeMonths.length) continue;
    const students = await prisma.student.findMany({
      where: { classId: template.classId },
      select: { id: true, feeAddOns: { where: { active: true } } },
    });
    if (!students.length) continue;

    const drafts = template.lines.map((l) => ({
      label: l.label,
      kind: l.kind,
      amount: l.amount,
    }));
    const existing = await prisma.feeInvoice.findMany({
      where: { studentId: { in: students.map((s) => s.id) } },
      select: { studentId: true, period: true },
    });
    const have = coveredPeriods(existing);

    const rows = [];
    for (const student of students) {
      for (const month of activeMonths) {
        if (have.has(`${student.id}:${month.period}`)) continue;
        const lines = [...drafts, ...feeAddOnLines(student.feeAddOns, month.period)];
        rows.push({
          studentId: student.id,
          classId: template.classId,
          templateId: template.id,
          period: month.period,
          title: monthFeeTitle(month.year, month.monthIndex, template.name),
          amount: feeLineTotal(lines).total,
          linesJson: JSON.stringify(lines),
          dueDate: dueDateForMonth(month.year, month.monthIndex, template.dueDay),
          ...invoiceLateStamp(template),
          shareToken: randomUUID(),
          status: InvoiceStatus.DUE,
        });
        added.push(month.period);
      }
    }
    if (rows.length) {
      await prisma.feeInvoice.createMany({ data: rows });
      created += rows.length;
    }
  }

  return {
    created,
    months: [...new Set(added)],
    through: feePeriod(asOf.getFullYear(), asOf.getMonth()),
  };
}

export function reminderCopy(inv: {
  title: string;
  student: { name: string };
  amount: number;
  dueDate: Date;
  lateFeePerDay?: number;
  lateAfter10?: number;
  lateAfter20?: number;
  lateKind?: string | null;
  lateGraceDays?: number | null;
  lateAmount?: number | null;
  payments: { amount: number }[];
  status?: string;
}) {
  const { remaining, late, lateDays, dueNow, lateLabel } = invoiceBalance(inv);
  return {
    dueNow,
    message: lateDays
      ? `${inv.student.name}: ${inv.title} still due · ${lateLabel}. Remaining ₹${remaining + late}.`
      : `${inv.student.name}: ${inv.title} still due · ₹${dueNow}.`,
  };
}
