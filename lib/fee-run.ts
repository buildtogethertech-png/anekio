import { randomUUID } from "node:crypto";
import { InvoiceStatus, type FeeLine, type FeeTemplate } from "@prisma/client";
import { prisma } from "./prisma";
import {
  composeStudentFeeLines,
  studentMayBeBilledForPeriod,
  dueDateForMonth,
  feeLineTotal,
  feePeriod,
  invoiceBalance,
  invoiceLateMetadata,
  monthFeeTitle,
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
  }
  return have;
}

type FeeMonth = { year: number; monthIndex: number; period: string };

function templateMonthsThrough(template: Pick<FeeTemplate, "startsPeriod" | "endsPeriod">, asOf: Date): FeeMonth[] {
  const validPeriod = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!validPeriod.test(template.startsPeriod) || !validPeriod.test(template.endsPeriod)) return [];
  const currentPeriod = feePeriod(asOf.getFullYear(), asOf.getMonth());
  const lastPeriod = template.endsPeriod < currentPeriod ? template.endsPeriod : currentPeriod;
  if (template.startsPeriod > lastPeriod) return [];

  const months: FeeMonth[] = [];
  const [startYear, startMonth] = template.startsPeriod.split("-").map(Number);
  const [endYear, endMonth] = lastPeriod.split("-").map(Number);
  for (let year = startYear, monthIndex = startMonth - 1; year * 12 + monthIndex <= endYear * 12 + endMonth - 1;) {
    months.push({ year, monthIndex, period: feePeriod(year, monthIndex) });
    monthIndex += 1;
    if (monthIndex === 12) {
      year += 1;
      monthIndex = 0;
    }
  }
  return months;
}

/** The button and cron choose different scopes, but issue each template with the same rules. */
export async function issueTemplateMonthlyInvoices(template: FeeTemplate & { lines: FeeLine[] }, months: FeeMonth[]) {
  const students = await prisma.student.findMany({
    where: { classId: template.classId },
    select: { id: true, billingStartPeriod: true, feeAddOns: { where: { active: true } } },
  });
  if (!students.length || !template.lines.length || !months.length) return { created: 0, studentCount: students.length, months: [] as string[] };

  const existing = await prisma.feeInvoice.findMany({
    where: { studentId: { in: students.map((student) => student.id) } },
    select: { studentId: true, period: true },
  });
  const have = coveredPeriods(existing);
  const rows = [];
  for (const student of students) {
    for (const month of months) {
      if (template.startsPeriod && month.period < template.startsPeriod) continue;
      if (template.endsPeriod && month.period > template.endsPeriod) continue;
      if (!studentMayBeBilledForPeriod(student, month.period)) continue;
      if (have.has(`${student.id}:${month.period}`)) continue;
      const lines = composeStudentFeeLines(template.lines, student.feeAddOns, month.period);
      if (!lines.length) continue;
      rows.push({
        studentId: student.id,
        orgId: template.orgId ?? null,
        classId: template.classId,
        templateId: template.id,
        period: month.period,
        title: monthFeeTitle(month.year, month.monthIndex, template.name),
        amount: feeLineTotal(lines).total,
        linesJson: JSON.stringify(lines),
        dueDate: dueDateForMonth(month.year, month.monthIndex, template.dueDay),
        metadataJson: invoiceLateMetadata(template),
        shareToken: randomUUID(),
        status: InvoiceStatus.DUE,
      });
    }
  }
  if (!rows.length) return { created: 0, studentCount: students.length, months: [] as string[] };
  const result = await prisma.feeInvoice.createMany({ data: rows });
  return { created: result.count, studentCount: students.length, months: [...new Set(rows.map((row) => row.period))] };
}

export async function previewDueFees(classId: string, asOf = new Date(), sessionId?: string) {
  const { months } = await sessionRange(sessionId, asOf);
  const [students, existing] = await Promise.all([
    prisma.student.findMany({ where: { classId }, select: { id: true, billingStartPeriod: true } }),
    prisma.feeInvoice.findMany({
      where: { classId },
      select: { period: true, studentId: true },
    }),
  ]);
  const have = coveredPeriods(existing);
  return {
    studentCount: students.length,
    months: months.map((m) => {
      const eligible = students.filter((s) => studentMayBeBilledForPeriod(s, m.period) || have.has(`${s.id}:${m.period}`));
      const already = eligible.filter((s) => have.has(`${s.id}:${m.period}`)).length;
      return {
        period: m.period,
        label: new Date(m.year, m.monthIndex, 1).toLocaleString("en-IN", {
          month: "long",
          year: "numeric",
        }),
        already,
        missing: eligible.length - already,
      };
    }),
  };
}

export async function issueDueFeesCore(asOf = new Date(), classId?: string, sessionId?: string) {
  // A school action supplies its session. The scheduled cron has no school
  // context, so it must visit every configured template.
  const scoped = sessionId ? await sessionRange(sessionId, asOf) : null;
  const templates = await prisma.feeTemplate.findMany({
    where: {
      ...(scoped ? { sessionId: scoped.session.id } : {}),
      ...(classId ? { classId } : {}),
    },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });

  let created = 0;
  const added: string[] = [];

  for (const template of templates) {
    const months = scoped ? scoped.months : templateMonthsThrough(template, asOf);
    const result = await issueTemplateMonthlyInvoices(template, months);
    created += result.created;
    added.push(...result.months);
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
  metadataJson?: string | null;
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
