import { can, type AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { invoiceBalance, PAYMENT_LABEL } from "./fees";
import { compactInr, feeMonthLabel, parseReceiptLink, ymdOf } from "./fee-register";
import { publicOrigin } from "./utils";
import { ensureSchoolSessions } from "./school-session";

export type FeeHistoryEventType = "payment" | "invoice" | "partial" | "receipt" | "overdue";
export type FeeHistoryDatePreset = "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "custom";
export type FeeHistoryStatusFilter = "paid" | "partial" | "due" | "overdue";
export type FeeHistoryBadge = "paid" | "partial" | "due" | "overdue" | "generated" | "issued";

export type FeeHistoryFilter = {
  q?: string;
  sessionId?: string;
  className?: string;
  section?: string;
  datePreset?: FeeHistoryDatePreset;
  from?: string;
  to?: string;
  eventType?: FeeHistoryEventType | "";
  status?: FeeHistoryStatusFilter | "";
  method?: string;
  page?: number;
  pageSize?: number;
};

export type FeeHistoryPayment = {
  id?: string;
  amount: number;
  method: string;
  paidAt: Date | string;
  notes?: string | null;
  reference?: string | null;
};

export type FeeHistorySourceInvoice = {
  id: string;
  studentId: string;
  admissionNo: string;
  studentName: string;
  classId: string;
  className: string;
  section: string;
  period: string;
  title: string;
  dueDate: Date | string;
  amount: number;
  payments: FeeHistoryPayment[];
};

export type FeeHistoryReceipt = {
  studentId: string;
  invoiceId?: string | null;
  period?: string | null;
  documentUrl: string;
  documentNumber: string;
  issuedAt: string;
  issuedByName?: string;
};

export type FeeHistoryEvent = {
  id: string;
  type: FeeHistoryEventType;
  at: string;
  sortAt: number;
  dateYmd: string;
  dateLabel: string;
  timeLabel: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  classId: string;
  className: string;
  section: string;
  classLabel: string;
  period: string;
  monthLabel: string;
  amount: number;
  paymentMode: string;
  paymentModeLabel: string;
  reference: string;
  invoiceId: string;
  invoiceNumber: string;
  receiptNumber: string;
  receiptUrl: string;
  badge: FeeHistoryBadge;
  badgeLabel: string;
  paymentStatus: FeeHistoryStatusFilter;
  remark: string;
  collectedBy: string;
  billed: number;
  paid: number;
  balance: number;
  dueDate: string;
};

const EVENT_TYPES: FeeHistoryEventType[] = ["payment", "invoice", "partial", "receipt", "overdue"];
const DATE_PRESETS: FeeHistoryDatePreset[] = [
  "today",
  "yesterday",
  "this_week",
  "this_month",
  "last_month",
  "custom",
];

export function invoiceDisplayNumber(id: string) {
  const compact = String(id || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase();
  return compact ? `INV-${compact}` : "—";
}

export function ymdLocal(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveDateRange(
  filter: { datePreset?: string; from?: string; to?: string },
  asOf = new Date()
) {
  const preset = DATE_PRESETS.includes(filter.datePreset as FeeHistoryDatePreset)
    ? (filter.datePreset as FeeHistoryDatePreset)
    : "this_month";
  const start = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  if (preset === "today") return { preset, from: ymdLocal(start), to: ymdLocal(start) };
  if (preset === "yesterday") {
    const y = new Date(start);
    y.setDate(y.getDate() - 1);
    return { preset, from: ymdLocal(y), to: ymdLocal(y) };
  }
  if (preset === "this_week") {
    const from = new Date(start);
    from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
    return { preset, from: ymdLocal(from), to: ymdLocal(start) };
  }
  if (preset === "this_month") {
    const from = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
    const to = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0);
    return { preset, from: ymdLocal(from), to: ymdLocal(to) };
  }
  if (preset === "last_month") {
    const from = new Date(asOf.getFullYear(), asOf.getMonth() - 1, 1);
    const to = new Date(asOf.getFullYear(), asOf.getMonth(), 0);
    return { preset, from: ymdLocal(from), to: ymdLocal(to) };
  }
  const customFrom = String(filter.from || "").slice(0, 10);
  const customTo = String(filter.to || "").slice(0, 10);
  if (customFrom || customTo) return { preset, from: customFrom, to: customTo };
  const monthFrom = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  const monthTo = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0);
  return { preset, from: ymdLocal(monthFrom), to: ymdLocal(monthTo) };
}

export function dateChipLabel(preset: string, from: string, to: string) {
  if (preset === "today") return "Today";
  if (preset === "yesterday") return "Yesterday";
  if (preset === "this_week") return "This week";
  if (preset === "this_month" || preset === "last_month") {
    const stamp = from || to;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return preset === "last_month" ? "Last month" : "This month";
    const date = new Date(Number(stamp.slice(0, 4)), Number(stamp.slice(5, 7)) - 1, 1);
    return date.toLocaleDateString("en-IN", { month: "long" });
  }
  if (from && to && from !== to) return `${from} – ${to}`;
  return from || to || "Custom";
}

export function eventClock(value: Date | string, dateOnly: boolean) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(+date)) {
    return { dateLabel: "—", timeLabel: "", iso: "", ymd: "", sortAt: 0 };
  }
  const dateLabel = date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  let timeLabel = "";
  if (!dateOnly) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    if (hours || minutes || seconds) {
      timeLabel = date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
    }
  }
  return {
    dateLabel,
    timeLabel,
    iso: date.toISOString(),
    ymd: ymdOf(date),
    sortAt: +date,
  };
}

export function parseFeeHistoryQuery(input: Record<string, unknown>): FeeHistoryFilter {
  const text = (key: string) => String(input[key] || "").trim();
  const eventType = text("eventType") as FeeHistoryEventType | "";
  const status = text("status") as FeeHistoryStatusFilter | "";
  const datePreset = text("datePreset") as FeeHistoryDatePreset;
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const requested = Math.floor(Number(input.pageSize) || 25);
  const pageSize = requested === 10 || requested === 50 ? requested : 25;
  return {
    q: text("q"),
    sessionId: text("sessionId"),
    className: text("className"),
    section: text("section"),
    datePreset: DATE_PRESETS.includes(datePreset) ? datePreset : "this_month",
    from: text("from").slice(0, 10),
    to: text("to").slice(0, 10),
    eventType: EVENT_TYPES.includes(eventType as FeeHistoryEventType) ? eventType : "",
    status: status === "paid" || status === "partial" || status === "due" || status === "overdue" ? status : "",
    method: text("method").toUpperCase(),
    page,
    pageSize,
  };
}

function paymentStatusOf(display: string): FeeHistoryStatusFilter {
  if (display === "PAID") return "paid";
  if (display === "PARTIAL") return "partial";
  if (display === "OVERDUE") return "overdue";
  return "due";
}

function inSession(period: string, startsOn?: string, endsOn?: string) {
  if (!startsOn && !endsOn) return true;
  const start = (startsOn || "").slice(0, 7);
  const end = (endsOn || "").slice(0, 7);
  if (start && period < start) return false;
  if (end && period > end) return false;
  return true;
}

function receiptFor(
  receipts: FeeHistoryReceipt[],
  studentId: string,
  invoiceId: string,
  period: string
) {
  const mine = receipts.filter((row) => row.studentId === studentId);
  return (
    mine.find((row) => row.invoiceId && row.invoiceId === invoiceId) ||
    mine.find((row) => row.period && row.period === period) ||
    null
  );
}

function baseEvent(
  invoice: FeeHistorySourceInvoice,
  clock: ReturnType<typeof eventClock>,
  extra: Partial<FeeHistoryEvent>
): FeeHistoryEvent {
  const paidAmt = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const balance = invoiceBalance({ ...invoice, paid: paidAmt });
  const classLabel = invoice.section ? `${invoice.className}-${invoice.section}` : invoice.className;
  const invoiceNumber = invoiceDisplayNumber(invoice.id);
  return {
    id: extra.id || invoice.id,
    type: extra.type || "invoice",
    at: clock.iso,
    sortAt: clock.sortAt,
    dateYmd: clock.ymd,
    dateLabel: clock.dateLabel,
    timeLabel: clock.timeLabel,
    studentId: invoice.studentId,
    studentName: invoice.studentName,
    admissionNo: invoice.admissionNo,
    classId: invoice.classId,
    className: invoice.className,
    section: invoice.section,
    classLabel,
    period: invoice.period,
    monthLabel: feeMonthLabel(invoice.period, invoice.title),
    amount: extra.amount ?? invoice.amount,
    paymentMode: extra.paymentMode || "",
    paymentModeLabel: extra.paymentModeLabel || "—",
    reference: extra.reference || invoiceNumber,
    invoiceId: invoice.id,
    invoiceNumber,
    receiptNumber: extra.receiptNumber || "",
    receiptUrl: extra.receiptUrl || "",
    badge: extra.badge || "generated",
    badgeLabel: extra.badgeLabel || "Generated",
    paymentStatus: extra.paymentStatus || paymentStatusOf(balance.display),
    remark: extra.remark || "",
    collectedBy: extra.collectedBy || "",
    billed: extra.billed ?? invoice.amount,
    paid: extra.paid ?? balance.paid,
    balance: extra.balance ?? balance.remaining,
    dueDate: ymdOf(invoice.dueDate),
  };
}

export function buildFeeHistory(
  invoices: FeeHistorySourceInvoice[],
  receipts: FeeHistoryReceipt[],
  filter: FeeHistoryFilter,
  opts?: { sessionStart?: string; sessionEnd?: string; asOf?: Date }
) {
  const asOf = opts?.asOf || new Date();
  const range = resolveDateRange(filter, asOf);
  const q = (filter.q || "").toLowerCase();
  const method = (filter.method || "").toUpperCase();
  const events: FeeHistoryEvent[] = [];

  for (const invoice of invoices) {
    if (filter.className && invoice.className !== filter.className) continue;
    if (filter.section && invoice.section !== filter.section) continue;
    if (!inSession(invoice.period, opts?.sessionStart, opts?.sessionEnd)) continue;

    const paidAmt = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const receipt = receiptFor(receipts, invoice.studentId, invoice.id, invoice.period);

    const ordered = [...invoice.payments].sort((a, b) => +new Date(a.paidAt) - +new Date(b.paidAt) || String(a.id).localeCompare(String(b.id)));
    let running = 0;
    for (const payment of ordered) {
      running += payment.amount;
      const remaining = Math.max(0, invoice.amount - running);
      const partial = remaining > 0;
      const clock = eventClock(payment.paidAt, false);
      const payId = payment.id || `${invoice.id}:${clock.iso}:${payment.amount}`;
      events.push(
        baseEvent(invoice, clock, {
          id: `payment:${payId}`,
          type: partial ? "partial" : "payment",
          amount: payment.amount,
          paymentMode: payment.method || "",
          paymentModeLabel: PAYMENT_LABEL[payment.method] || payment.method || "—",
          reference: receipt?.documentNumber || payment.reference || invoiceDisplayNumber(invoice.id),
          receiptNumber: receipt?.documentNumber || "",
          receiptUrl: receipt?.documentUrl || "",
          badge: partial ? "partial" : "paid",
          badgeLabel: partial ? "Partial" : "Paid",
          paymentStatus: partial ? "partial" : "paid",
          remark: String(payment.notes || "").trim(),
          collectedBy: receipt?.issuedByName || "",
          paid: running,
          balance: remaining,
        })
      );
    }
  }

  const matched = events.filter((event) => {
    if (range.from && event.dateYmd < range.from) return false;
    if (range.to && event.dateYmd > range.to) return false;
    if (filter.eventType && event.type !== filter.eventType) return false;
    if (filter.status && event.paymentStatus !== filter.status) return false;
    if (method && event.paymentMode.toUpperCase() !== method) return false;
    if (q) {
      const hay = `${event.studentName} ${event.admissionNo} ${event.invoiceNumber} ${event.invoiceId} ${event.receiptNumber} ${event.reference}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  matched.sort((a, b) => b.sortAt - a.sortAt || a.id.localeCompare(b.id));

  const billedByInvoice = new Map<string, number>();
  const outstandingByInvoice = new Map<string, number>();
  for (const event of matched) {
    billedByInvoice.set(event.invoiceId, event.billed);
    outstandingByInvoice.set(event.invoiceId, event.balance);
  }
  const summary = {
    collected: matched
      .filter((event) => event.type === "payment" || event.type === "partial")
      .reduce((sum, event) => sum + event.amount, 0),
    billed: [...billedByInvoice.values()].reduce((sum, n) => sum + n, 0),
    outstanding: [...outstandingByInvoice.values()].reduce((sum, n) => sum + n, 0),
    payments: matched.filter((event) => event.type === "payment" || event.type === "partial").length,
    receipts: matched.filter((event) => event.receiptNumber).length,
  };

  const pageSize = filter.pageSize || 25;
  const page = filter.page || 1;
  const start = (page - 1) * pageSize;

  return {
    asOf: asOf.toISOString(),
    datePreset: range.preset,
    from: range.from,
    to: range.to,
    summary,
    events: matched.slice(start, start + pageSize),
    total: matched.length,
    page,
    pageSize,
  };
}

export async function queryFeeHistory(user: AccessUser, raw: Record<string, unknown>) {
  if (!can(user, "fees.view")) throw new Error("No access.");
  const filter = parseFeeHistoryQuery(raw);
  const { sessions, current } = await ensureSchoolSessions();
  const session = sessions.find((row) => row.id === filter.sessionId) || current || sessions[0];
  const teacher =
    user.portal === "TEACHER"
      ? await prisma.teacher.findUnique({ where: { userId: user.id }, select: { classId: true } })
      : null;
  const emptyMeta = {
    sessions: sessions.map((row) => ({
      id: row.id,
      label: row.label,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      current: row.current,
    })),
    sessionId: session?.id || "",
    classes: [] as { id: string; name: string; section: string; label: string }[],
    methods: Object.entries(PAYMENT_LABEL).map(([id, label]) => ({ id, label })),
  };
  if (user.portal === "TEACHER" && !teacher?.classId) {
    const built = buildFeeHistory([], [], filter, {
      sessionStart: session?.startsOn,
      sessionEnd: session?.endsOn,
    });
    return { ...built, ...emptyMeta };
  }

  const classRows = await prisma.class.findMany({
    where: { archivedAt: null, ...(teacher?.classId ? { id: teacher.classId } : {}) },
    select: { id: true, name: true, section: true },
    orderBy: [{ name: "asc" }, { section: "asc" }],
  });
  const classIds = classRows
    .filter((row) => (!filter.className || row.name === filter.className) && (!filter.section || row.section === filter.section))
    .map((row) => row.id);
  const classWhere = teacher?.classId
    ? { classId: teacher.classId }
    : filter.className || filter.section
      ? { classId: { in: classIds.length ? classIds : ["__none__"] } }
      : {};

  const invoices = await prisma.feeInvoice.findMany({
    where: classWhere,
    include: {
      student: { select: { id: true, name: true, admissionNo: true, classId: true, class: { select: { name: true, section: true } } } },
      payments: { select: { id: true, amount: true, method: true, paidAt: true, notes: true, reference: true }, orderBy: { paidAt: "asc" } },
    },
  });
  const studentIds = [...new Set(invoices.map((row) => row.studentId))];
  const issued = studentIds.length
    ? await prisma.issuedDocument.findMany({
        where: {
          type: "PAYMENT_RECEIPT",
          status: "VALID",
          subjectType: "STUDENT",
          subjectId: { in: studentIds },
        },
        select: { subjectId: true, dataJson: true, documentNumber: true, verifyToken: true, issuedAt: true, issuedById: true },
      })
    : [];
  const issuerIds = [...new Set(issued.map((row) => row.issuedById).filter(Boolean))];
  const issuers = issuerIds.length
    ? await prisma.user.findMany({ where: { id: { in: issuerIds } }, select: { id: true, name: true } })
    : [];
  const issuerName = new Map(issuers.map((row) => [row.id, row.name]));
  const origin = publicOrigin();
  const receipts: FeeHistoryReceipt[] = issued.map((row) => {
    const link = parseReceiptLink(row.dataJson);
    return {
      studentId: row.subjectId,
      invoiceId: link.invoiceId,
      period: link.period,
      documentUrl: `${origin}/documents/${row.verifyToken}`,
      documentNumber: row.documentNumber,
      issuedAt: row.issuedAt.toISOString(),
      issuedByName: issuerName.get(row.issuedById) || "",
    };
  });
  const source: FeeHistorySourceInvoice[] = invoices.flatMap((row) => {
    const klass = row.student.class;
    if (!klass) return [];
    return [{
      id: row.id,
      studentId: row.student.id,
      admissionNo: row.student.admissionNo,
      studentName: row.student.name,
      classId: row.student.classId,
      className: klass.name,
      section: klass.section,
      period: row.period,
      title: row.title,
      dueDate: row.dueDate,
      amount: row.amount,
      payments: row.payments,
    }];
  });
  const built = buildFeeHistory(source, receipts, filter, {
    sessionStart: session?.startsOn,
    sessionEnd: session?.endsOn,
  });
  return {
    ...built,
    sessions: emptyMeta.sessions,
    sessionId: session?.id || "",
    classes: classRows.map((row) => ({
      id: row.id,
      name: row.name,
      section: row.section,
      label: `${row.name}-${row.section}`,
    })),
    methods: emptyMeta.methods,
  };
}

export { compactInr };
