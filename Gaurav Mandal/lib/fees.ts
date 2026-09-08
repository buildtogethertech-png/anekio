import { daysLate, formatInr, lateAmountForDays, lateFee, type LateKind } from "./utils";
import { defaultAcademicSession, parseSchoolDate } from "./school";

export type FeeLineDraft = {
  label: string;
  kind: "FLAT" | "PERCENT";
  amount: number;
};

export type FeePart = FeeLineDraft & { hint: string };

export const FEE_PARTS: FeePart[] = [
  { label: "Tuition", kind: "FLAT", amount: 8000, hint: "Monthly class fee" },
  { label: "Books", kind: "FLAT", amount: 800, hint: "Books / workbook" },
  { label: "Lab", kind: "FLAT", amount: 500, hint: "Science / computer lab" },
  { label: "Transport", kind: "FLAT", amount: 1500, hint: "Bus" },
  { label: "Activity", kind: "FLAT", amount: 400, hint: "Sports / arts" },
  { label: "Computer", kind: "FLAT", amount: 300, hint: "Lab period" },
  { label: "Exam", kind: "FLAT", amount: 500, hint: "Term exam" },
  { label: "GST", kind: "PERCENT", amount: 18, hint: "On the lines above it" },
];

export function parseFeeLines(raw?: string | null): FeeLineDraft[] {
  try {
    const parsed = JSON.parse(raw || "[]") as FeeLineDraft[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((l) => l && l.label);
  } catch {
    return [];
  }
}

export function feeLineTotal(lines: FeeLineDraft[]) {
  let taxable = 0;
  let total = 0;
  const rows = lines.map((line) => {
    if (line.kind === "PERCENT") {
      const value = Math.round((taxable * Math.max(0, line.amount)) / 100);
      total += value;
      return { ...line, value };
    }
    const value = Math.max(0, Math.round(line.amount));
    taxable += value;
    total += value;
    return { ...line, value };
  });
  return { rows, taxable, total };
}

export function lateFromSlabs(days: number, policy: {
  lateKind?: string | null;
  lateGraceDays?: number | null;
  lateAmount?: number | null;
  lateFeePerDay?: number;
  lateAfter10?: number;
  lateAfter20?: number;
}) {
  return lateAmountForDays(days, policy);
}

export function dueDateForMonth(year: number, monthIndex: number, dueDay: number) {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(Math.max(1, dueDay), last));
}

export const PAYMENT_METHODS = [
  { id: "CASH", label: "Cash", hint: "Collected at the desk" },
  { id: "UPI", label: "UPI", hint: "GPay / PhonePe / school QR — enter UTR" },
  { id: "RAZORPAY", label: "Pay link", hint: "Parent pays themselves. Copy or send the link." },
  { id: "BANK", label: "Bank transfer", hint: "NEFT / IMPS — upload the receipt" },
  { id: "CHEQUE", label: "Cheque", hint: "Cheque number and bank" },
] as const;

export const PAYMENT_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  RAZORPAY: "Online",
  CASHFREE: "Cashfree",
  BILLDESK: "BillDesk",
  BANK: "Bank",
  CHEQUE: "Cheque",
};

export function payRangeLabel(titles: string[]) {
  const months = titles.map((title) => title.split(" · ")[0]?.trim() || title).filter(Boolean);
  if (!months.length) return "Selected months";
  if (months.length === 1) return months[0];
  return `${months[0]} to ${months[months.length - 1]}`;
}

export type OpenFeeItem = {
  id: string;
  title: string;
  period?: string | null;
  dueAt: number;
  dueNow: number;
};

export function monthLabelFromTitle(title: string) {
  return title.split(" · ")[0]?.trim() || title;
}

export function unpaidFeeMonths<T extends OpenFeeItem>(items: T[]) {
  const open = items
    .filter((item) => item.dueNow > 0)
    .sort((a, b) => a.dueAt - b.dueAt || a.title.localeCompare(b.title));
  const months: {
    period: string;
    label: string;
    dueNow: number;
    invoiceIds: string[];
    items: T[];
  }[] = [];
  for (const item of open) {
    const period = item.period || item.id;
    const last = months[months.length - 1];
    if (last && last.period === period) {
      last.dueNow += item.dueNow;
      last.invoiceIds.push(item.id);
      last.items.push(item);
      continue;
    }
    months.push({
      period,
      label: monthLabelFromTitle(item.title),
      dueNow: item.dueNow,
      invoiceIds: [item.id],
      items: [item],
    });
  }
  return months;
}

export function monthFeeTitle(year: number, monthIndex: number, templateName: string) {
  const month = new Date(year, monthIndex, 1).toLocaleString("en-IN", { month: "long" });
  return `${month} ${year} · ${templateName}`;
}

export function feePeriod(year: number, monthIndex: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function periodFromDate(date: Date) {
  return feePeriod(date.getFullYear(), date.getMonth());
}

export function sessionMonthsThrough(
  asOf = new Date(),
  range?: { start?: string | null; end?: string | null }
) {
  const fallback = defaultAcademicSession(asOf);
  const start = parseSchoolDate(range?.start) ?? parseSchoolDate(fallback.sessionStart)!;
  const end = parseSchoolDate(range?.end) ?? parseSchoolDate(fallback.sessionEnd)!;
  const last = asOf < end ? asOf : end;
  if (last < start) return [];
  const months: { year: number; monthIndex: number; period: string }[] = [];
  let year = start.getFullYear();
  let monthIndex = start.getMonth();
  const endYear = last.getFullYear();
  const endMonth = last.getMonth();
  while (year < endYear || (year === endYear && monthIndex <= endMonth)) {
    months.push({ year, monthIndex, period: feePeriod(year, monthIndex) });
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
  }
  return months;
}

export function latePolicyFrom(row: {
  lateKind?: string | null;
  lateGraceDays?: number | null;
  lateAmount?: number | null;
  lateAfter10?: number | null;
  lateAfter20?: number | null;
  lateFeePerDay?: number | null;
}) {
  const kind = (row.lateKind || "").toUpperCase();
  if (kind === "NONE" || kind === "STATIC" || kind === "DAILY") {
    return {
      lateKind: kind as LateKind,
      lateGraceDays: Math.max(0, row.lateGraceDays || 0),
      lateAmount: Math.max(0, row.lateAmount || 0),
    };
  }
  if ((row.lateAfter10 || 0) > 0 || (row.lateAfter20 || 0) > 0) {
    return { lateKind: "STATIC" as const, lateGraceDays: 10, lateAmount: row.lateAfter10 || row.lateAfter20 || 0 };
  }
  if ((row.lateFeePerDay || 0) > 0) {
    return { lateKind: "DAILY" as const, lateGraceDays: 0, lateAmount: row.lateFeePerDay || 0 };
  }
  return { lateKind: "NONE" as const, lateGraceDays: 0, lateAmount: 0 };
}

export function invoiceLateStamp(row: {
  lateKind?: string | null;
  lateGraceDays?: number | null;
  lateAmount?: number | null;
  lateAfter10?: number | null;
  lateAfter20?: number | null;
  lateFeePerDay?: number | null;
}) {
  const policy = latePolicyFrom(row);
  return {
    lateKind: policy.lateKind,
    lateGraceDays: policy.lateGraceDays,
    lateAmount: policy.lateAmount,
    lateFeePerDay: policy.lateKind === "DAILY" ? policy.lateAmount : 0,
    lateAfter10: policy.lateKind === "STATIC" ? policy.lateAmount : 0,
    lateAfter20: 0,
  };
}

export function latePolicyLabel(row: {
  lateKind?: string | null;
  lateGraceDays?: number | null;
  lateAmount?: number | null;
  lateAfter10?: number | null;
  lateAfter20?: number | null;
  lateFeePerDay?: number | null;
}) {
  const policy = latePolicyFrom(row);
  if (policy.lateKind === "NONE" || !policy.lateAmount) return "no late fee";
  const grace =
    policy.lateGraceDays > 0 ? ` after ${policy.lateGraceDays} days` : " from the day after due";
  if (policy.lateKind === "DAILY") return `${formatInr(policy.lateAmount)}/day${grace}`;
  return `${formatInr(policy.lateAmount)} one-time${grace}`;
}

export function invoiceBalance(inv: {
  amount: number;
  dueDate: Date | string;
  status?: string;
  lateFeePerDay?: number;
  lateAfter10?: number;
  lateAfter20?: number;
  lateKind?: string | null;
  lateGraceDays?: number | null;
  lateAmount?: number | null;
  payments?: { amount: number }[];
  paid?: number;
}) {
  const due = inv.dueDate instanceof Date ? inv.dueDate : new Date(inv.dueDate);
  const paid =
    inv.paid ??
    (inv.payments ?? []).reduce((sum, payment) => sum + payment.amount, 0);
  const remaining = Math.max(0, inv.amount - paid);
  const settled = remaining <= 0 || inv.status === "PAID";
  const lateDays = settled ? 0 : daysLate(due);
  const late = lateFee(due, settled, inv);
  const dueNow = remaining + (remaining > 0 ? late : 0);
  const lateLabel = lateDays > 0 ? `Late by ${lateDays} days · ${formatInr(late)}` : "";
  const display = settled ? "PAID" : lateDays > 0 ? "OVERDUE" : paid > 0 ? "PARTIAL" : "DUE";
  return { paid, remaining, late, lateDays, dueNow, lateLabel, display };
}

export function paidFeeMonthCount(
  invoices: Parameters<typeof invoiceBalance>[0][] | null | undefined
) {
  return (invoices || []).filter((invoice) => invoiceBalance(invoice).dueNow <= 0).length;
}

export function reportCardFeeMonthsRequired(row?: { reportCardPaidMonths?: number | null } | null) {
  const n = Math.floor(Number(row?.reportCardPaidMonths));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(24, n);
}

export function reportCardUnlocked(paidMonths: number, requiredMonths: number) {
  return requiredMonths <= 0 || paidMonths >= requiredMonths;
}

export function groupStudentFees<
  T extends {
    id: string;
    title: string;
    amount: number;
    dueDate: Date;
    lateFeePerDay?: number;
    lateAfter10?: number;
    lateAfter20?: number;
    lateKind?: string | null;
    lateGraceDays?: number | null;
    lateAmount?: number | null;
    status?: string;
    studentId: string;
    student: { name: string; class?: { name: string; section: string } | null };
    linesJson?: string;
    payments?: { id: string; amount: number; method: string; reference?: string | null; proofPath?: string | null }[];
    reminders?: { message: string }[];
  },
>(invoices: T[]) {
  const rows = new Map<
    string,
    {
      studentId: string;
      name: string;
      classLabel: string;
      dueNow: number;
      paid: number;
      remaining: number;
      months: number;
      overdueMonths: number;
      oldestTitle: string;
      lastNudge?: string;
      remindId: string;
      invoiceIds: string[];
      invoices: T[];
    }
  >();
  for (const inv of invoices) {
    const b = invoiceBalance(inv);
    if (b.dueNow <= 0) continue;
    const classLabel = inv.student.class ? `${inv.student.class.name}-${inv.student.class.section}` : "";
    const current = rows.get(inv.studentId);
    if (!current) {
      rows.set(inv.studentId, {
        studentId: inv.studentId,
        name: inv.student.name,
        classLabel,
        dueNow: b.dueNow,
        paid: b.paid,
        remaining: b.remaining,
        months: 1,
        overdueMonths: b.lateDays > 0 ? 1 : 0,
        oldestTitle: inv.title,
        lastNudge: inv.reminders?.[0]?.message,
        remindId: inv.id,
        invoiceIds: [inv.id],
        invoices: [inv],
      });
      continue;
    }
    current.dueNow += b.dueNow;
    current.paid += b.paid;
    current.remaining += b.remaining;
    current.months += 1;
    if (b.lateDays > 0) current.overdueMonths += 1;
    current.invoiceIds.push(inv.id);
    current.invoices.push(inv);
    if (!current.lastNudge && inv.reminders?.[0]?.message) current.lastNudge = inv.reminders[0].message;
  }
  return [...rows.values()].sort((a, b) => b.dueNow - a.dueNow || a.name.localeCompare(b.name));
}
