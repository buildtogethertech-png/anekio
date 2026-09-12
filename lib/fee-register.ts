import { can, type AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { invoiceBalance, monthLabelFromTitle, parseFeeLines, PAYMENT_LABEL } from "./fees";
import { formatInr, publicOrigin } from "./utils";
import { ensureSchoolSessions } from "./school-session";
import { schoolFromConfig } from "./school";
import { issueDocumentCore } from "./document-studio";

export type FeeRegisterStatus = "paid" | "partial" | "unpaid" | "overdue";
export type ReceiptFilter = "all" | "available" | "missing";

export type FeeRegisterFilter = {
  q?: string;
  admissionNo?: string;
  sessionId?: string;
  classId?: string;
  section?: string;
  period?: string;
  periodFrom?: string;
  periodTo?: string;
  status?: FeeRegisterStatus | "";
  unpaidMonthsGte?: number;
  overdueDaysGte?: number;
  balanceGte?: number;
  methods?: string[];
  receipt?: ReceiptFilter;
  templateId?: string;
  dueFrom?: string;
  dueTo?: string;
  paidFrom?: string;
  paidTo?: string;
  page?: number;
  pageSize?: number;
};

export type FeeRegisterPayment = {
  amount: number;
  method: string;
  paidAt: Date | string;
};

export type FeeRegisterSourceInvoice = {
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
  templateId?: string | null;
  templateName?: string | null;
  payments: FeeRegisterPayment[];
};

export type FeeRegisterReceipt = {
  studentId: string;
  invoiceId?: string | null;
  period?: string | null;
  documentUrl: string;
  documentNumber: string;
  issuedAt: string;
};

export type FeeRegisterMonthLine = {
  invoiceId: string;
  period: string;
  label: string;
  total: number;
  paid: number;
  balance: number;
  status: FeeRegisterStatus;
};

export type FeeRegisterRow = {
  id: string;
  studentId: string;
  admissionNo: string;
  studentName: string;
  classId: string;
  className: string;
  section: string;
  classLabel: string;
  period: string;
  monthLabel: string;
  dueDate: string;
  dueAt: string;
  total: number;
  paid: number;
  balance: number;
  dueNow: number;
  lateFee: number;
  status: FeeRegisterStatus;
  daysOverdue: number;
  monthsDue: number;
  lastPaymentAt: string;
  lastPaymentLabel: string;
  paymentMode: string;
  paymentModeLabel: string;
  templateId: string;
  templateName: string;
  receipt: boolean;
  receiptNumber: string;
  receiptUrl: string;
  invoiceIds: string[];
};

export function compactInr(amount: number) {
  const n = Math.round(Number(amount) || 0);
  if (Math.abs(n) >= 100000) {
    const lakhs = n / 100000;
    const digits = Math.abs(lakhs) >= 10 ? 1 : 2;
    const text = lakhs.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
    return `₹${text}L`;
  }
  return formatInr(n);
}

export function feeMonthLabel(period: string, title?: string) {
  if (/^\d{4}-\d{2}$/.test(period)) {
    const year = Number(period.slice(0, 4));
    const month = Number(period.slice(5, 7));
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${names[month - 1] || period} ${year}`;
  }
  return monthLabelFromTitle(title || period);
}

export function monthsDueLabel(count: number) {
  if (count <= 0) return "—";
  return count === 1 ? "1 month" : `${count} months`;
}

export function parseReceiptLink(dataJson: string) {
  try {
    const data = JSON.parse(dataJson || "{}") as Record<string, unknown>;
    const fees = data.fees && typeof data.fees === "object" ? (data.fees as Record<string, unknown>) : {};
    const invoiceId = String(data.invoiceId || fees.invoiceId || "").trim() || null;
    const period = String(data.period || fees.period || "").trim() || null;
    return { invoiceId, period };
  } catch {
    return { invoiceId: null, period: null };
  }
}

export function receiptForInvoice(
  receipts: FeeRegisterReceipt[],
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

export function ymdOf(value: Date | string) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value || "").slice(0, 10);
}

function dateLabel(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(+date)) return "";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function periodInRange(period: string, from?: string, to?: string) {
  if (from && period < from) return false;
  if (to && period > to) return false;
  return true;
}

function inSession(period: string, startsOn?: string, endsOn?: string) {
  if (!startsOn && !endsOn) return true;
  const start = (startsOn || "").slice(0, 7);
  const end = (endsOn || "").slice(0, 7);
  return periodInRange(period, start || undefined, end || undefined);
}

function displayStatus(display: string): FeeRegisterStatus {
  if (display === "PAID") return "paid";
  if (display === "PARTIAL") return "partial";
  if (display === "OVERDUE") return "overdue";
  return "unpaid";
}

export function parseFeeRegisterQuery(input: Record<string, unknown>): FeeRegisterFilter {
  const num = (key: string) => {
    const n = Number(input[key]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const text = (key: string) => String(input[key] || "").trim();
  const methodsRaw = input.methods;
  const methods = Array.isArray(methodsRaw)
    ? methodsRaw.map(String)
    : text("methods")
      ? text("methods").split(",").map((row) => row.trim()).filter(Boolean)
      : [];
  const status = text("status") as FeeRegisterStatus | "";
  const receipt = text("receipt") as ReceiptFilter;
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(Number(input.pageSize) || 50)));
  return {
    q: text("q"),
    admissionNo: text("admissionNo"),
    sessionId: text("sessionId"),
    classId: text("classId"),
    section: text("section"),
    period: text("period"),
    periodFrom: text("periodFrom"),
    periodTo: text("periodTo"),
    status: status === "paid" || status === "partial" || status === "unpaid" || status === "overdue" ? status : "",
    unpaidMonthsGte: num("unpaidMonthsGte"),
    overdueDaysGte: num("overdueDaysGte"),
    balanceGte: num("balanceGte"),
    methods,
    receipt: receipt === "available" || receipt === "missing" ? receipt : "all",
    templateId: text("templateId"),
    dueFrom: text("dueFrom"),
    dueTo: text("dueTo"),
    paidFrom: text("paidFrom"),
    paidTo: text("paidTo"),
    page,
    pageSize,
  };
}

export function buildFeeRegister(
  invoices: FeeRegisterSourceInvoice[],
  receipts: FeeRegisterReceipt[],
  filter: FeeRegisterFilter,
  opts?: { sessionStart?: string; sessionEnd?: string; asOf?: Date }
) {
  const monthsDueByStudent = new Map<string, number>();
  const historyByStudent = new Map<string, FeeRegisterMonthLine[]>();
  for (const invoice of invoices) {
    const paidAmt = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balance = invoiceBalance({ ...invoice, paid: paidAmt });
    const status = displayStatus(balance.display);
    if (balance.dueNow > 0) {
      monthsDueByStudent.set(invoice.studentId, (monthsDueByStudent.get(invoice.studentId) || 0) + 1);
    }
    const line: FeeRegisterMonthLine = {
      invoiceId: invoice.id,
      period: invoice.period,
      label: feeMonthLabel(invoice.period, invoice.title),
      total: invoice.amount,
      paid: balance.paid,
      balance: balance.remaining,
      status,
    };
    const history = historyByStudent.get(invoice.studentId) || [];
    history.push(line);
    historyByStudent.set(invoice.studentId, history);
  }
  for (const history of historyByStudent.values()) {
    history.sort((a, b) => b.period.localeCompare(a.period) || a.label.localeCompare(b.label));
  }

  const q = (filter.q || "").toLowerCase();
  const admission = (filter.admissionNo || "").toLowerCase();
  const methods = new Set((filter.methods || []).map((row) => row.toUpperCase()));

  const rows: FeeRegisterRow[] = [];
  for (const invoice of invoices) {
    if (filter.classId && invoice.classId !== filter.classId) continue;
    if (filter.section && invoice.section !== filter.section) continue;
    if (filter.period && invoice.period !== filter.period) continue;
    if (!periodInRange(invoice.period, filter.periodFrom, filter.periodTo)) continue;
    if (!inSession(invoice.period, opts?.sessionStart, opts?.sessionEnd)) continue;
    if (filter.templateId && invoice.templateId !== filter.templateId) continue;
    if (q && !`${invoice.studentName} ${invoice.admissionNo}`.toLowerCase().includes(q)) continue;
    if (admission && !invoice.admissionNo.toLowerCase().includes(admission)) continue;

    const paidAmt = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balance = invoiceBalance({ ...invoice, paid: paidAmt });
    const status = displayStatus(balance.display);
    if (filter.status && status !== filter.status) continue;
    const monthsDue = monthsDueByStudent.get(invoice.studentId) || 0;
    if (filter.unpaidMonthsGte && monthsDue < filter.unpaidMonthsGte) continue;
    if (filter.overdueDaysGte && balance.lateDays < filter.overdueDaysGte) continue;
    if (filter.balanceGte && balance.remaining < filter.balanceGte) continue;

    const last = [...invoice.payments].sort((a, b) => +new Date(b.paidAt) - +new Date(a.paidAt))[0];
    const paymentMode = last?.method || "";
    if (methods.size && (!paymentMode || !methods.has(paymentMode.toUpperCase()))) continue;

    const dueAt = ymdOf(invoice.dueDate);
    if (filter.dueFrom && dueAt < filter.dueFrom) continue;
    if (filter.dueTo && dueAt > filter.dueTo) continue;
    const paidAt = last ? ymdOf(last.paidAt) : "";
    if (filter.paidFrom && (!paidAt || paidAt < filter.paidFrom)) continue;
    if (filter.paidTo && (!paidAt || paidAt > filter.paidTo)) continue;

    const receipt = receiptForInvoice(receipts, invoice.studentId, invoice.id, invoice.period);
    if (filter.receipt === "available" && !receipt) continue;
    if (filter.receipt === "missing" && receipt) continue;

    rows.push({
      id: invoice.id,
      studentId: invoice.studentId,
      admissionNo: invoice.admissionNo,
      studentName: invoice.studentName,
      classId: invoice.classId,
      className: invoice.className,
      section: invoice.section,
      classLabel: invoice.section ? `${invoice.className}-${invoice.section}` : invoice.className,
      period: invoice.period,
      monthLabel: feeMonthLabel(invoice.period, invoice.title),
      dueDate: dateLabel(invoice.dueDate),
      dueAt,
      total: invoice.amount,
      paid: balance.paid,
      balance: balance.remaining,
      dueNow: balance.dueNow,
      lateFee: balance.late,
      status,
      daysOverdue: balance.lateDays,
      monthsDue,
      lastPaymentAt: paidAt,
      lastPaymentLabel: last ? dateLabel(last.paidAt) : "",
      paymentMode,
      paymentModeLabel: PAYMENT_LABEL[paymentMode] || paymentMode,
      templateId: invoice.templateId || "",
      templateName: invoice.templateName || "",
      receipt: Boolean(receipt),
      receiptNumber: receipt?.documentNumber || "",
      receiptUrl: receipt?.documentUrl || "",
      invoiceIds: invoice.payments.length || balance.dueNow > 0 ? [invoice.id] : [invoice.id],
    });
  }

  rows.sort(
    (a, b) =>
      a.classLabel.localeCompare(b.classLabel) ||
      a.studentName.localeCompare(b.studentName) ||
      a.period.localeCompare(b.period)
  );

  const studentIds = new Set(rows.map((row) => row.studentId));
  const summary = {
    students: studentIds.size,
    billed: rows.reduce((sum, row) => sum + row.total, 0),
    paid: rows.reduce((sum, row) => sum + row.paid, 0),
    outstanding: rows.reduce((sum, row) => sum + row.dueNow, 0),
    overdue: rows.filter((row) => row.status === "overdue").length,
    partial: rows.filter((row) => row.status === "partial").length,
    noReceipt: rows.filter((row) => row.paid > 0 && !row.receipt).length,
  };

  const pageSize = filter.pageSize || 50;
  const page = filter.page || 1;
  const start = (page - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const history: Record<string, FeeRegisterMonthLine[]> = {};
  for (const row of pageRows) {
    if (!history[row.studentId]) history[row.studentId] = historyByStudent.get(row.studentId) || [];
  }

  return {
    asOf: (opts?.asOf || new Date()).toISOString(),
    summary,
    rows: pageRows,
    history,
    total: rows.length,
    page,
    pageSize,
  };
}

export async function queryFeeRegister(user: AccessUser, raw: Record<string, unknown>) {
  if (!can(user, "fees.view")) throw new Error("No access.");
  const filter = parseFeeRegisterQuery(raw);
  const { sessions, current } = await ensureSchoolSessions();
  const session = sessions.find((row) => row.id === filter.sessionId) || current || sessions[0];
  const teacher =
    user.portal === "TEACHER"
      ? await prisma.teacher.findUnique({ where: { userId: user.id }, select: { classId: true } })
      : null;
  if (user.portal === "TEACHER" && !teacher?.classId) {
    return {
      asOf: new Date().toISOString(),
      summary: { students: 0, billed: 0, paid: 0, outstanding: 0, overdue: 0, partial: 0, noReceipt: 0 },
      rows: [],
      history: {},
      total: 0,
      page: 1,
      pageSize: filter.pageSize || 50,
      sessions: sessions.map((row) => ({
        id: row.id,
        label: row.label,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        current: row.current,
      })),
      sessionId: current?.id || sessions[0]?.id || "",
      classes: [],
      templates: [],
      periods: [],
      methods: Object.entries(PAYMENT_LABEL).map(([id, label]) => ({ id, label })),
    };
  }
  const classWhere = teacher?.classId ? { classId: teacher.classId } : filter.classId ? { classId: filter.classId } : {};

  const invoices = await prisma.feeInvoice.findMany({
    where: classWhere,
    include: {
      student: { select: { id: true, name: true, admissionNo: true, classId: true, class: { select: { name: true, section: true } } } },
      template: { select: { id: true, name: true } },
      payments: { select: { amount: true, method: true, paidAt: true }, orderBy: { paidAt: "desc" } },
    },
    orderBy: [{ dueDate: "asc" }],
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
        select: { subjectId: true, dataJson: true, documentNumber: true, verifyToken: true, issuedAt: true },
      })
    : [];
  const origin = publicOrigin();
  const receipts: FeeRegisterReceipt[] = issued.map((row) => {
    const link = parseReceiptLink(row.dataJson);
    return {
      studentId: row.subjectId,
      invoiceId: link.invoiceId,
      period: link.period,
      documentUrl: `${origin}/documents/${row.verifyToken}`,
      documentNumber: row.documentNumber,
      issuedAt: row.issuedAt.toISOString(),
    };
  });
  const source: FeeRegisterSourceInvoice[] = invoices.map((row) => ({
    id: row.id,
    studentId: row.student.id,
    admissionNo: row.student.admissionNo,
    studentName: row.student.name,
    classId: row.student.classId,
    className: row.student.class.name,
    section: row.student.class.section,
    period: row.period,
    title: row.title,
    dueDate: row.dueDate,
    amount: row.amount,
    templateId: row.templateId,
    templateName: row.template?.name || "",
    payments: row.payments,
  }));
  const built = buildFeeRegister(source, receipts, { ...filter, classId: teacher?.classId || filter.classId }, {
    sessionStart: session?.startsOn,
    sessionEnd: session?.endsOn,
  });
  const classes = await prisma.class.findMany({
    where: { archivedAt: null, ...(teacher?.classId ? { id: teacher.classId } : {}) },
    select: { id: true, name: true, section: true },
    orderBy: [{ name: "asc" }, { section: "asc" }],
  });
  const templates = await prisma.feeTemplate.findMany({
    select: { id: true, name: true, classId: true },
    orderBy: { name: "asc" },
  });
  const periods = [...new Set(source.map((row) => row.period).filter(Boolean))].sort();
  return {
    ...built,
    sessions: sessions.map((row) => ({
      id: row.id,
      label: row.label,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      current: row.current,
    })),
    sessionId: session?.id || "",
    classes: classes.map((row) => ({
      id: row.id,
      name: row.name,
      section: row.section,
      label: `${row.name}-${row.section}`,
    })),
    templates,
    periods,
    methods: Object.entries(PAYMENT_LABEL).map(([id, label]) => ({ id, label })),
  };
}

export function receiptIssuePayload(invoice: {
  id: string;
  period: string;
  title: string;
  amount: number;
  linesJson?: string | null;
  student: { id: string; name: string; admissionNo: string; class?: { name: string; section: string } | null };
  payments: { amount: number }[];
}) {
  const paid = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const lines = parseFeeLines(invoice.linesJson).map((line) => ({
    item: line.label,
    amount: formatInr(line.amount),
  }));
  if (!lines.length) lines.push({ item: invoice.title, amount: formatInr(invoice.amount) });
  const classLabel = invoice.student.class
    ? `${invoice.student.class.name}-${invoice.student.class.section}`
    : "";
  return {
    invoiceId: invoice.id,
    period: invoice.period,
    student: {
      id: invoice.student.id,
      name: invoice.student.name,
      admissionNo: invoice.student.admissionNo,
      classLabel,
    },
    fees: {
      invoiceId: invoice.id,
      period: invoice.period,
      amount: formatInr(invoice.amount),
      paid: formatInr(paid),
      due: formatInr(Math.max(0, invoice.amount - paid)),
      lines,
    },
  };
}

export async function issueFeeReceiptCore(user: AccessUser, input: { invoiceId?: string }) {
  if (!can(user, "documents.issue") && !can(user, "school.edit")) throw new Error("No access.");
  if (!can(user, "fees.view") && !can(user, "fees.collect")) throw new Error("No access.");
  const invoiceId = String(input.invoiceId || "");
  if (!invoiceId) throw new Error("Invoice required");
  const invoice = await prisma.feeInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      student: { include: { class: true } },
      payments: true,
    },
  });
  if (!invoice) throw new Error("Invoice missing");
  if (invoice.payments.reduce((sum, payment) => sum + payment.amount, 0) <= 0) {
    throw new Error("Collect payment before issuing a receipt");
  }
  const existing = await prisma.issuedDocument.findFirst({
    where: {
      type: "PAYMENT_RECEIPT",
      status: "VALID",
      subjectType: "STUDENT",
      subjectId: invoice.studentId,
    },
    orderBy: { issuedAt: "desc" },
  });
  if (existing) {
    const link = parseReceiptLink(existing.dataJson);
    if (link.invoiceId === invoice.id || link.period === invoice.period) {
      return {
        id: existing.id,
        documentNumber: existing.documentNumber,
        documentUrl: `${publicOrigin()}/documents/${existing.verifyToken}`,
      };
    }
  }
  const published = await prisma.documentTemplate.findFirst({
    where: { type: { in: ["PAYMENT_RECEIPT", "CONSOLIDATED_RECEIPT"] }, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
    select: { id: true, type: true },
  });
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const payload = receiptIssuePayload(invoice);
  return issueDocumentCore(user, {
    templateId: published?.id || "builtin:PAYMENT_RECEIPT",
    subjectType: "STUDENT",
    subjectId: invoice.studentId,
    subjectLabel: invoice.student.name,
    data: {
      school: schoolFromConfig(config),
      ...payload,
      document: {},
    },
  });
}
