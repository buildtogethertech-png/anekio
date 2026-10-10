import { daysLate, formatInr, lateAmountForDays, lateFee, type LateKind } from "./utils";
import { defaultAcademicSession, parseSchoolDate } from "./school";

export type FeeLineDraft = {
  label: string;
  kind: "FLAT" | "PERCENT";
  amount: number;
  scope?: string;
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
    const value = Math.round(line.amount);
    if (value > 0) taxable += value;
    total += value;
    return { ...line, value };
  });
  return { rows, taxable, total: Math.max(0, total) };
}

export type AdmissionFeeCharge = { label: string; kind: "FLAT"; amount: number };

export function pickAdmissionFeeLines(
  schoolWide: { label: string; amount: number }[],
  classLines: { label: string; amount: number }[] = [],
  legacyCharge = 0
): AdmissionFeeCharge[] {
  const source = (schoolWide.length ? schoolWide : classLines)
    .map((line) => ({
      label: String(line.label || "").trim() || "Admission fee",
      kind: "FLAT" as const,
      amount: Math.max(0, Math.round(Number(line.amount) || 0)),
    }))
    .filter((line) => line.amount > 0);
  if (source.length) return source;
  const amount = Math.max(0, Math.round(Number(legacyCharge) || 0));
  return amount > 0 ? [{ label: "Admission fee", kind: "FLAT", amount }] : [];
}

export function lateFromSlabs(days: number, policy: {
  lateKind?: string | null;
  lateGraceDays?: number | null;
  lateAmount?: number | null;
  lateIntervalCount?: number | null;
  lateIntervalUnit?: string | null;
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

export function inrToPaise(rupees: number) {
  return Math.round(Number(rupees) || 0) * 100;
}

export function expandOldestUnpaidInvoiceIds(
  invoices: { id: string; studentId: string; dueDate: Date | string; title: string; dueNow: number }[],
  wantedIds: string[]
) {
  const wanted = new Set(wantedIds.filter(Boolean));
  if (!wanted.size) return [];
  const byStudent = new Map<string, typeof invoices>();
  for (const invoice of invoices) {
    if (invoice.dueNow <= 0) continue;
    const rows = byStudent.get(invoice.studentId) || [];
    rows.push(invoice);
    byStudent.set(invoice.studentId, rows);
  }
  const picked: string[] = [];
  for (const rows of byStudent.values()) {
    const months = unpaidFeeMonths(
      rows.map((invoice) => ({
        id: invoice.id,
        title: invoice.title,
        period: invoice.id,
        dueAt: +new Date(invoice.dueDate),
        dueNow: invoice.dueNow,
      }))
    );
    let last = -1;
    months.forEach((month, index) => {
      if (month.invoiceIds.some((id) => wanted.has(id))) last = index;
    });
    if (last >= 0) picked.push(...months.slice(0, last + 1).flatMap((month) => month.invoiceIds));
  }
  return [...new Set(picked)];
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
  lateIntervalCount?: number | null;
  lateIntervalUnit?: string | null;
  lateAfter10?: number | null;
  lateAfter20?: number | null;
  lateFeePerDay?: number | null;
}) {
  const kind = (row.lateKind || "").toUpperCase();
  if (kind === "NONE" || kind === "STATIC" || kind === "DAILY" || kind === "RECURRING" || kind === "PERCENT" || kind === "PERCENT_RECURRING") {
    const intervalCount = Math.max(1, Math.round(Number(row.lateIntervalCount) || 1));
    const intervalUnit = String(row.lateIntervalUnit || "DAY").toUpperCase() === "MONTH" ? "MONTH" : "DAY";
    return {
      lateKind: kind as LateKind,
      lateGraceDays: Math.max(0, row.lateGraceDays || 0),
      lateAmount: Math.max(0, row.lateAmount || 0),
      lateIntervalCount: kind === "DAILY" ? 1 : intervalCount,
      lateIntervalUnit: kind === "DAILY" ? "DAY" : intervalUnit,
    };
  }
  if ((row.lateAfter10 || 0) > 0 || (row.lateAfter20 || 0) > 0) {
    return { lateKind: "STATIC" as const, lateGraceDays: 10, lateAmount: row.lateAfter10 || row.lateAfter20 || 0, lateIntervalCount: 1, lateIntervalUnit: "DAY" };
  }
  if ((row.lateFeePerDay || 0) > 0) {
    return { lateKind: "DAILY" as const, lateGraceDays: 0, lateAmount: row.lateFeePerDay || 0, lateIntervalCount: 1, lateIntervalUnit: "DAY" };
  }
  return { lateKind: "NONE" as const, lateGraceDays: 0, lateAmount: 0, lateIntervalCount: 1, lateIntervalUnit: "DAY" };
}

export function invoiceLateStamp(row: {
  lateKind?: string | null;
  lateGraceDays?: number | null;
  lateAmount?: number | null;
  lateIntervalCount?: number | null;
  lateIntervalUnit?: string | null;
  lateAfter10?: number | null;
  lateAfter20?: number | null;
  lateFeePerDay?: number | null;
}) {
  const policy = latePolicyFrom(row);
  return {
    lateKind: policy.lateKind,
    lateGraceDays: policy.lateGraceDays,
    lateAmount: policy.lateAmount,
    lateIntervalCount: policy.lateIntervalCount,
    lateIntervalUnit: policy.lateIntervalUnit,
    lateFeePerDay: policy.lateKind === "DAILY" || (policy.lateKind === "RECURRING" && policy.lateIntervalCount === 1 && policy.lateIntervalUnit === "DAY") ? policy.lateAmount : 0,
    lateAfter10: policy.lateKind === "STATIC" ? policy.lateAmount : 0,
    lateAfter20: 0,
  };
}

/** FeeTemplate has no lateFeePerDay column — invoices keep that field via invoiceLateStamp. */
export function feeTemplateLateWrite(stamp: {
  lateKind: string;
  lateGraceDays: number;
  lateAmount: number;
  lateIntervalCount: number;
  lateIntervalUnit: string;
  lateAfter10: number;
  lateAfter20: number;
}) {
  return {
    lateKind: stamp.lateKind,
    lateGraceDays: stamp.lateGraceDays,
    lateAmount: stamp.lateAmount,
    lateIntervalCount: stamp.lateIntervalCount,
    lateIntervalUnit: stamp.lateIntervalUnit,
    lateAfter10: stamp.lateAfter10,
    lateAfter20: stamp.lateAfter20,
  };
}

export function latePolicyLabel(row: {
  lateKind?: string | null;
  lateGraceDays?: number | null;
  lateAmount?: number | null;
  lateIntervalCount?: number | null;
  lateIntervalUnit?: string | null;
  lateAfter10?: number | null;
  lateAfter20?: number | null;
  lateFeePerDay?: number | null;
}) {
  const policy = latePolicyFrom(row);
  if (policy.lateKind === "NONE" || !policy.lateAmount) return "no late fee";
  const grace =
    policy.lateGraceDays > 0 ? ` after ${policy.lateGraceDays} days` : " from the day after due";
  if (policy.lateKind === "PERCENT") {
    const unit = policy.lateIntervalUnit === "MONTH" ? " unpaid per overdue month" : " of the unpaid amount, one-time";
    return `${policy.lateAmount}%${unit}${grace}`;
  }
  if (policy.lateKind === "DAILY") return `${formatInr(policy.lateAmount)}/day${grace}`;
  if (policy.lateKind === "RECURRING") {
    const count = Math.max(1, Number(policy.lateIntervalCount) || 1);
    const unit = policy.lateIntervalUnit === "MONTH" ? "month" : "day";
    return `${formatInr(policy.lateAmount)} every ${count} ${unit}${count === 1 ? "" : "s"}${grace}`;
  }
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
  lateIntervalCount?: number | null;
  lateIntervalUnit?: string | null;
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
  const late = lateFee(due, settled, { ...inv, remaining });
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

export function unpaidFeeMonthCount(
  invoices: Parameters<typeof invoiceBalance>[0][] | null | undefined
) {
  return (invoices || []).filter((invoice) => invoiceBalance(invoice).dueNow > 0).length;
}

export function reportCardFeeMonthsRequired(row?: { reportCardPaidMonths?: number | null } | null) {
  const n = Math.floor(Number(row?.reportCardPaidMonths));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(24, n);
}

export function reportCardUnpaidMonthsRequired(row?: { reportCardUnpaidMonths?: number | null } | null) {
  const n = Math.floor(Number(row?.reportCardUnpaidMonths));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(24, n);
}

export function reportCardUnlocked(paidMonths: number, requiredMonths: number) {
  return requiredMonths <= 0 || paidMonths >= requiredMonths;
}

export function reportCardFeeHold(
  invoices: Parameters<typeof invoiceBalance>[0][] | null | undefined,
  config?: { reportCardPaidMonths?: number | null; reportCardUnpaidMonths?: number | null } | null
) {
  const paidMonths = paidFeeMonthCount(invoices);
  const unpaidMonths = unpaidFeeMonthCount(invoices);
  const requiredMonths = reportCardFeeMonthsRequired(config);
  const unpaidThreshold = reportCardUnpaidMonthsRequired(config);
  const paidHold = requiredMonths > 0 && paidMonths < requiredMonths;
  const unpaidHold = unpaidThreshold > 0 && unpaidMonths >= unpaidThreshold;
  if (!paidHold && !unpaidHold) return null;
  return {
    requiredMonths,
    paidMonths,
    unpaidMonths,
    unpaidThreshold,
    reason: unpaidHold ? ("unpaid" as const) : ("paid" as const),
  };
}

export function reportCardFeeHoldFromConfig(
  invoices: Parameters<typeof invoiceBalance>[0][] | null | undefined,
  config?: {
    reportCardPaidMonths?: number | null;
    reportCardUnpaidMonths?: number | null;
    feeCatalogJson?: string | null;
  } | null
) {
  const catalog = parseFeeCatalogState(config?.feeCatalogJson).resultsUnpaidMonths;
  return reportCardFeeHold(invoices, {
    reportCardPaidMonths: config?.reportCardPaidMonths,
    reportCardUnpaidMonths: catalog > 0 ? catalog : config?.reportCardUnpaidMonths,
  });
}

export function admitCardPendingMonthsRequired(row?: { admitCardPendingMonths?: number | null } | null) {
  const n = Math.floor(Number(row?.admitCardPendingMonths));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(24, n);
}

export function admitCardBlocked(pendingMonths: number, threshold: number) {
  return threshold > 0 && pendingMonths >= threshold;
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

export type FeeCatalogKind = "OTHER";

export type FeeCatalogItem = {
  id: string;
  kind: FeeCatalogKind;
  label: string;
  amount: number;
  active: boolean;
};

export type FeeCatalogLate = {
  enabled: boolean;
  amount: number;
  graceDays: number;
  rule?: string;
  intervalCount?: number;
};

export type FeeCatalogState = {
  items: FeeCatalogItem[];
  late: FeeCatalogLate;
  dueDay: number;
  resultsUnpaidMonths: number;
};

const EMPTY_FEE_CATALOG: FeeCatalogState = {
  items: [],
  late: { enabled: false, amount: 0, graceDays: 0, rule: "RECURRING_MONTH", intervalCount: 1 },
  dueDay: 10,
  resultsUnpaidMonths: 0,
};

export function clampFeeDueDay(day?: number | null) {
  return Math.min(30, Math.max(1, Math.round(Number(day) || 10)));
}

export function catalogAddOnKind(kind: FeeCatalogKind, id: string) {
  return `${kind}:${id}`;
}

export function parseCatalogAddOnKind(kind?: string | null): { kind: FeeCatalogKind; id: string } | null {
  const match = /^OTHER:(.+)$/.exec(String(kind || "").trim());
  if (!match) return null;
  return { kind: "OTHER", id: match[1] };
}

export function catalogAddOnLabel(item: Pick<FeeCatalogItem, "kind" | "label">) {
  return item.label;
}

export function classAddOnKey(label: string) {
  return String(label || "").trim().toLowerCase();
}

export function classAddOnKind(label: string) {
  return `CLASS:${classAddOnKey(label)}`;
}

export function parseClassAddOnKind(kind?: string | null) {
  const match = /^CLASS:(.+)$/i.exec(String(kind || "").trim());
  return match ? match[1].toLowerCase() : null;
}

export function studentHasClassAddOn(
  addOns: { kind?: string | null; label?: string | null }[],
  optionLabel: string
) {
  const key = classAddOnKey(optionLabel);
  if (!key) return false;
  return addOns.some((row) => {
    const parsed = parseClassAddOnKind(row.kind);
    if (parsed) return parsed === key;
    const kind = String(row.kind || "CHARGE").toUpperCase();
    if (kind.startsWith("OTHER:") || kind === "DISCOUNT" || kind === "CONCESSION") {
      return false;
    }
    return classAddOnKey(String(row.label || "")) === key;
  });
}

export function parseFeeCatalogState(raw?: string | null): FeeCatalogState {
  try {
    const parsed = JSON.parse(raw || "{}") as { items?: unknown; late?: Partial<FeeCatalogLate>; dueDay?: number; resultsUnpaidMonths?: number } | FeeCatalogItem[];
    const rows = Array.isArray(parsed) ? parsed : parsed.items;
    const late = Array.isArray(parsed) ? undefined : parsed.late;
    const dueDay = Array.isArray(parsed) ? undefined : parsed.dueDay;
    const resultsUnpaidMonths = Array.isArray(parsed) ? undefined : parsed.resultsUnpaidMonths;
    const items = (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const item = row as Partial<FeeCatalogItem>;
        const kind = String(item.kind || "").toUpperCase() === "OTHER" ? "OTHER" : "";
        if (kind !== "OTHER") return null;
        const label = String(item.label || "").trim();
        if (!label) return null;
        return {
          id: String(item.id || "").trim() || `fee-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          kind,
          label,
          amount: Math.max(0, Math.round(Number(item.amount) || 0)),
          active: item.active === false ? false : true,
        } satisfies FeeCatalogItem;
      })
      .filter((row): row is FeeCatalogItem => Boolean(row));
    return {
      items,
      late: {
        enabled: Boolean(late?.enabled) && Math.max(0, Number(late?.amount) || 0) > 0,
        amount: Math.max(0, Number(late?.amount) || 0),
        graceDays: Math.max(0, Math.round(Number(late?.graceDays) || 0)),
        rule: String(late?.rule || "RECURRING_MONTH"),
        intervalCount: Math.max(1, Math.round(Number(late?.intervalCount) || 1)),
      },
      dueDay: clampFeeDueDay(dueDay),
      resultsUnpaidMonths: reportCardUnpaidMonthsRequired({ reportCardUnpaidMonths: resultsUnpaidMonths }),
    };
  } catch {
    return { ...EMPTY_FEE_CATALOG, items: [] };
  }
}

export function serializeFeeCatalogState(state: FeeCatalogState) {
  return JSON.stringify({
    items: state.items,
    dueDay: clampFeeDueDay(state.dueDay),
    resultsUnpaidMonths: reportCardUnpaidMonthsRequired({ reportCardUnpaidMonths: state.resultsUnpaidMonths }),
    late: {
      enabled: Boolean(state.late.enabled) && state.late.amount > 0,
      amount: Math.max(0, Number(state.late.amount) || 0),
      graceDays: Math.max(0, Math.round(state.late.graceDays || 0)),
      rule: state.late.rule || "RECURRING_MONTH",
      intervalCount: Math.max(1, Math.round(state.late.intervalCount || 1)),
    },
  });
}

export function lateStampFromSetup(input: {
  enabled?: boolean;
  rule?: string;
  amount?: number;
  graceDays?: number;
  intervalCount?: number;
}) {
  const amount = Math.max(0, Number(input.amount) || 0);
  const graceDays = Math.max(0, Math.round(Number(input.graceDays) || 0));
  const intervalCount = Math.max(1, Math.round(Number(input.intervalCount) || 1));
  const enabled = input.enabled !== false && amount > 0;
  const rule = String(input.rule || "RECURRING_MONTH").toUpperCase();
  if (!enabled) {
    return {
      enabled: false,
      catalog: { enabled: false, amount, graceDays, rule, intervalCount },
      stamp: {
        lateKind: "NONE",
        lateGraceDays: 0,
        lateAmount: 0,
        lateIntervalCount: 1,
        lateIntervalUnit: "DAY",
        lateAfter10: 0,
        lateAfter20: 0,
        lateFeePerDay: 0,
      },
    };
  }
  const stamp =
    rule === "STATIC"
      ? invoiceLateStamp({ lateKind: "STATIC", lateAmount: Math.round(amount), lateGraceDays: graceDays })
      : rule === "DAILY"
        ? invoiceLateStamp({ lateKind: "DAILY", lateAmount: Math.round(amount), lateGraceDays: graceDays })
        : rule === "RECURRING_DAY"
          ? invoiceLateStamp({
              lateKind: "RECURRING",
              lateAmount: Math.round(amount),
              lateGraceDays: graceDays,
              lateIntervalCount: intervalCount,
              lateIntervalUnit: "DAY",
            })
        : rule === "PERCENT"
            ? invoiceLateStamp({
                lateKind: "PERCENT",
                lateAmount: Math.round(amount),
                lateGraceDays: graceDays,
                lateIntervalCount: 1,
                lateIntervalUnit: "DAY",
              })
            : rule === "PERCENT_MONTH"
              ? invoiceLateStamp({
                  lateKind: "PERCENT",
                  lateAmount: Math.round(amount),
                  lateGraceDays: graceDays,
                  lateIntervalCount: 1,
                  lateIntervalUnit: "MONTH",
                })
              : rule === "PERCENT_RECURRING_DAY" || rule === "PERCENT_RECURRING_MONTH"
                ? invoiceLateStamp({
                    lateKind: "PERCENT_RECURRING",
                    lateAmount: Math.round(amount),
                    lateGraceDays: graceDays,
                    lateIntervalCount: intervalCount,
                    lateIntervalUnit: rule === "PERCENT_RECURRING_MONTH" ? "MONTH" : "DAY",
                  })
                : invoiceLateStamp({
                  lateKind: "RECURRING",
                  lateAmount: Math.round(amount),
                  lateGraceDays: graceDays,
                  lateIntervalCount: intervalCount,
                  lateIntervalUnit: "MONTH",
                });
  return {
    enabled: true,
    catalog: { enabled: true, amount, graceDays, rule, intervalCount },
    stamp,
  };
}

export function lateRuleFromPolicy(row: {
  lateKind?: string | null;
  lateIntervalUnit?: string | null;
}) {
  const kind = String(row.lateKind || "").toUpperCase();
  const unit = String(row.lateIntervalUnit || "DAY").toUpperCase();
  if (kind === "STATIC") return "STATIC";
  if (kind === "DAILY") return "DAILY";
  if (kind === "PERCENT_RECURRING") return unit === "MONTH" ? "PERCENT_RECURRING_MONTH" : "PERCENT_RECURRING_DAY";
  if (kind === "PERCENT") return unit === "MONTH" ? "PERCENT_MONTH" : "PERCENT";
  if (kind === "RECURRING" && unit === "DAY") return "RECURRING_DAY";
  return "RECURRING_MONTH";
}

export function feePeriodRangeLabel(start?: string | null, end?: string | null) {
  const startPeriod = String(start || "");
  const endPeriod = String(end || "");
  if (!/^\d{4}-\d{2}$/.test(startPeriod)) return "";
  const format = (period: string, withYear: boolean) => {
    const [year, month] = period.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleString("en-IN", {
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    });
  };
  if (!/^\d{4}-\d{2}$/.test(endPeriod) || endPeriod === startPeriod) return format(startPeriod, true);
  const sameYear = startPeriod.slice(0, 4) === endPeriod.slice(0, 4);
  return sameYear ? `${format(startPeriod, false)}–${format(endPeriod, true)}` : `${format(startPeriod, true)} – ${format(endPeriod, true)}`;
}

export function classAllFeeLines(lines: { label: string; kind?: string; amount: number; scope?: string | null }[]) {
  return lines
    .filter((line) => String(line.scope || "ALL").toUpperCase() !== "ADD_ON")
    .map((line) => ({
      label: line.label,
      kind: (line.kind === "PERCENT" ? "PERCENT" : "FLAT") as "FLAT" | "PERCENT",
      amount: line.amount,
    }));
}

export function feeAddOnApplies(
  addOn: { startsPeriod?: string | null; endsPeriod?: string | null; cadence?: string | null; active?: boolean | null },
  period: string
) {
  if (addOn.active === false) return false;
  const starts = String(addOn.startsPeriod || "");
  const ends = String(addOn.endsPeriod || "");
  if (starts && starts > period) return false;
  if (ends && ends < period) return false;
  if (String(addOn.cadence || "MONTHLY").toUpperCase() === "ONE_TIME") return starts === period;
  return true;
}

export function feeAddOnInvoiceLines(
  addOns: { label: string; kind?: string | null; amount: number; startsPeriod?: string | null; endsPeriod?: string | null; cadence?: string | null; active?: boolean | null }[],
  period: string,
  discountBase = 0
) {
  const applicable = addOns.filter((addOn) => feeAddOnApplies(addOn, period));
  const charges = applicable
    .filter((addOn) => !["DISCOUNT", "DISCOUNT_PERCENT", "CONCESSION"].includes(String(addOn.kind || "").toUpperCase()))
    .map((addOn) => ({ label: addOn.label, kind: "FLAT" as const, amount: Math.abs(addOn.amount) }));
  const subtotal = Math.max(0, discountBase + charges.reduce((sum, line) => sum + line.amount, 0));
  const discounts = applicable
    .filter((addOn) => ["DISCOUNT", "DISCOUNT_PERCENT", "CONCESSION"].includes(String(addOn.kind || "").toUpperCase()))
    .map((addOn) => {
      const percentage = String(addOn.kind || "").toUpperCase() === "DISCOUNT_PERCENT";
      const raw = Math.max(0, Math.round(addOn.amount || 0));
      const amount = percentage ? Math.round(subtotal * Math.min(100, raw) / 100) : Math.min(subtotal, raw);
      return {
        label: percentage ? `${addOn.label} (${Math.min(100, raw)}%)` : addOn.label,
        kind: "FLAT" as const,
        amount: -amount,
      };
    });
  return [...charges, ...discounts];
}

export function composeStudentFeeLines(
  classLines: { label: string; kind?: string; amount: number; scope?: string | null }[],
  addOns: { label: string; kind?: string | null; amount: number; startsPeriod?: string | null; endsPeriod?: string | null; cadence?: string | null; active?: boolean | null }[],
  period: string
) {
  const classCharges = classAllFeeLines(classLines);
  return [...classCharges, ...feeAddOnInvoiceLines(addOns, period, feeLineTotal(classCharges).total)];
}

export function applicableMonthlyFee(input: {
  classLines: { label: string; amount: number; scope?: string | null }[];
  addOns: { label: string; kind?: string | null; amount: number; startsPeriod?: string | null; endsPeriod?: string | null; cadence?: string | null; active?: boolean | null }[];
  period: string;
}) {
  const lines = composeStudentFeeLines(input.classLines, input.addOns, input.period);
  const classFee = classAllFeeLines(input.classLines).reduce((sum, line) => sum + Math.max(0, Math.round(line.amount || 0)), 0);
  const extras = feeAddOnInvoiceLines(input.addOns, input.period, classFee);
  const total = feeLineTotal(lines).total;
  return { classFee, extras, lines, total };
}
