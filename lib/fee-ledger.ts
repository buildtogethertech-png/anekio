import { randomBytes } from "node:crypto";
import { InvoiceStatus, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { invoiceBalance } from "./fees";

export async function refreshInvoiceStatus(invoiceId: string) {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { id: invoiceId },
    include: { payments: true },
  });
  if (!invoice) return;
  const { paid, remaining, lateDays } = invoiceBalance({ ...invoice, status: undefined });
  let status: InvoiceStatus = InvoiceStatus.DUE;
  if (remaining <= 0) status = InvoiceStatus.PAID;
  else if (paid > 0) status = InvoiceStatus.PARTIAL;
  else if (lateDays > 0) status = InvoiceStatus.OVERDUE;
  await prisma.feeInvoice.update({ where: { id: invoiceId }, data: { status } });
}

/** Indian financial year of a date: April 2026 to March 2027 is "26-27". */
export function receiptYear(at: Date) {
  const start = at.getMonth() >= 3 ? at.getFullYear() : at.getFullYear() - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

export function formatReceiptNo(year: string, n: number) {
  return `RCPT/${year}/${String(n).padStart(5, "0")}`;
}

/** Receipt number to show for a payment row: its receipt, or the old reference-based number. */
export function paymentReceiptNo(payment: { reference?: string | null; receipt?: { receiptNo: string } | null }, invoiceId = "") {
  if (payment.receipt?.receiptNo) return payment.receipt.receiptNo;
  const base = String(payment.reference || "").trim().split(":")[0];
  return (base || (invoiceId ? `RCPT-${invoiceId.slice(-8)}` : "")).toUpperCase();
}

async function nextReceiptNo(tx: Prisma.TransactionClient, orgId: string | null, at: Date) {
  const scope = orgId || "school";
  const year = receiptYear(at);
  const row = await tx.feeReceiptCounter.upsert({
    where: { scope_year: { scope, year } },
    create: { scope, year, next: 2 },
    update: { next: { increment: 1 } },
  });
  return formatReceiptNo(year, row.next - 1);
}

/** Receipt for a payment created inside another transaction (fee taken while admitting a student). */
export async function createReceiptTx(
  tx: Prisma.TransactionClient,
  input: { orgId: string | null; studentId: string; amount: number; method: PaymentMethod; reference?: string | null; notes?: string | null }
) {
  const paidAt = new Date();
  return tx.feeReceipt.create({
    data: {
      orgId: input.orgId,
      studentId: input.studentId,
      receiptNo: await nextReceiptNo(tx, input.orgId, paidAt),
      amount: input.amount,
      method: input.method,
      reference: input.reference || null,
      notes: input.notes || null,
      paidAt,
      shareToken: randomBytes(12).toString("base64url"),
    },
  });
}

export type ReceiptInput = {
  /** Student paying. Needed when `invoiceIds` is empty (then every open invoice, oldest first). */
  studentId?: string;
  /** Invoices this money is for, paid oldest due date first. */
  invoiceIds?: string[];
  /** Amount received. Omitted: everything due on the chosen invoices. */
  amount?: number | null;
  method: PaymentMethod;
  reference?: string | null;
  proofPath?: string | null;
  notes?: string | null;
  paidAt?: Date;
  /** Gateways: keep up to what is due instead of refusing a larger amount. */
  capAtDue?: boolean;
};

const receiptWithAllocations = { allocations: { orderBy: { paidAt: "asc" } } } satisfies Prisma.FeeReceiptInclude;
export type FeeReceiptWithAllocations = Prisma.FeeReceiptGetPayload<{ include: typeof receiptWithAllocations }>;

/**
 * Records money received once as one receipt and spreads it over the invoices, oldest due date
 * first. The last invoice it reaches can be part paid. The same UTR / gateway id never makes a
 * second receipt.
 */
export async function recordReceipt(input: ReceiptInput): Promise<{ receipt: FeeReceiptWithAllocations; duplicate: boolean }> {
  const reference = String(input.reference || "").trim() || null;
  const ids = [...new Set((input.invoiceIds || []).map(String).filter(Boolean))];
  const result = await prisma.$transaction(async (tx) => {
    const invoices = await tx.feeInvoice.findMany({
      where: ids.length ? { id: { in: ids } } : { studentId: String(input.studentId || "") },
      include: { payments: true },
      orderBy: [{ dueDate: "asc" }, { period: "asc" }],
    });
    if (ids.length && invoices.length !== ids.length) throw new Error("Invoice missing");
    if (!invoices.length) throw new Error("Nothing due for this student");
    const studentId = invoices[0].studentId;
    if (input.studentId && input.studentId !== studentId) throw new Error("Invoice belongs to another student");
    if (invoices.some((inv) => inv.studentId !== studentId)) throw new Error("One receipt is for one student");
    if (reference && input.method !== PaymentMethod.CASH) {
      // A family gateway payment makes one receipt per child with the same reference.
      const dup = await tx.feeReceipt.findFirst({
        where: { reference, method: input.method, status: "ACTIVE", studentId },
        include: receiptWithAllocations,
      });
      if (dup) return { receipt: dup, duplicate: true };
    }
    const open = invoices
      .map((inv) => ({ inv, dueNow: invoiceBalance({ ...inv, status: undefined }).dueNow }))
      .filter((row) => row.dueNow > 0);
    if (!open.length) throw new Error(ids.length === 1 ? "This invoice is already paid" : "Those months are already paid");
    const totalDue = open.reduce((sum, row) => sum + row.dueNow, 0);
    const omitted = input.amount == null || !Number.isFinite(Number(input.amount));
    let amount = omitted ? totalDue : Math.round(Number(input.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid payment");
    if (amount > totalDue) {
      if (!input.capAtDue) throw new Error(`Amount is more than what is due (₹${totalDue.toLocaleString("en-IN")})`);
      amount = totalDue;
    }

    const paidAt = input.paidAt || new Date();
    const orgId = open[0].inv.orgId ?? null;
    let left = amount;
    const allocations: Prisma.PaymentCreateWithoutReceiptInput[] = [];
    for (const row of open) {
      if (left <= 0) break;
      const part = Math.min(left, row.dueNow);
      left -= part;
      allocations.push({
        invoice: { connect: { id: row.inv.id } },
        org: row.inv.orgId ? { connect: { id: row.inv.orgId } } : undefined,
        amount: part,
        method: input.method,
        reference,
        proofPath: input.proofPath ?? null,
        notes: input.notes ?? null,
        paidAt,
      });
    }
    const receipt = await tx.feeReceipt.create({
      data: {
        orgId,
        studentId,
        receiptNo: await nextReceiptNo(tx, orgId, paidAt),
        amount,
        method: input.method,
        reference,
        proofPath: input.proofPath ?? null,
        notes: input.notes ?? null,
        paidAt,
        shareToken: randomBytes(12).toString("base64url"),
        allocations: { create: allocations },
      },
      include: receiptWithAllocations,
    });
    return { receipt, duplicate: false };
  });
  if (!result.duplicate) {
    for (const row of result.receipt.allocations) await refreshInvoiceStatus(row.invoiceId);
  }
  return result;
}

/** Cancels a receipt: its number stays, the money comes off the invoices it paid. */
export async function cancelReceipt(receiptId: string, reason: string) {
  const why = String(reason || "").trim();
  if (!why) throw new Error("Enter why this receipt is cancelled");
  const receipt = await prisma.feeReceipt.findUnique({ where: { id: receiptId }, include: { allocations: true } });
  if (!receipt) throw new Error("Receipt not found");
  if (receipt.status === "CANCELLED") throw new Error("This receipt is already cancelled");
  const invoiceIds = [...new Set(receipt.allocations.map((row) => row.invoiceId))];
  await prisma.$transaction([
    prisma.payment.deleteMany({ where: { receiptId } }),
    prisma.feeReceipt.update({
      where: { id: receiptId },
      data: { status: "CANCELLED", cancelReason: why.slice(0, 300), cancelledAt: new Date() },
    }),
  ]);
  for (const id of invoiceIds) await refreshInvoiceStatus(id);
  return { receiptNo: receipt.receiptNo, invoiceIds };
}

/** One invoice (gateway pay links): keeps the old return value, the payment row for that invoice. */
export async function recordLedgerPayment(data: {
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  proofPath?: string | null;
  notes?: string | null;
}) {
  if (data.reference) {
    // Paid before receipts existed.
    const legacy = await prisma.payment.findFirst({
      where: {
        method: data.method,
        receiptId: null,
        OR: [{ reference: data.reference }, { reference: { startsWith: `${data.reference}:` } }],
      },
    });
    if (legacy) return legacy;
  }
  const { receipt } = await recordReceipt({
    invoiceIds: [data.invoiceId],
    amount: data.amount,
    method: data.method,
    reference: data.reference,
    proofPath: data.proofPath,
    notes: data.notes,
    capAtDue: true,
  });
  return receipt.allocations.find((row) => row.invoiceId === data.invoiceId) || receipt.allocations[0];
}

/** Several months paid at once through a gateway: one receipt per child for all of their months. */
export async function settleMonthPayments(opts: {
  invoiceIds: string[];
  amount: number;
  method: PaymentMethod;
  reference: string;
  notes?: string | null;
}) {
  const existing = await prisma.feeReceipt.findMany({
    where: { reference: opts.reference, method: opts.method, status: "ACTIVE" },
    include: receiptWithAllocations,
  });
  if (existing.length) return existing.flatMap((r) => r.allocations);
  const invoices = await prisma.feeInvoice.findMany({
    where: { id: { in: [...new Set(opts.invoiceIds.filter(Boolean))] } },
    include: { payments: true },
  });
  const open = invoices
    .map((inv) => ({ inv, dueNow: invoiceBalance(inv).dueNow }))
    .filter((row) => row.dueNow > 0);
  if (!open.length) throw new Error("Those months are already paid");
  const expected = open.reduce((sum, row) => sum + row.dueNow, 0);
  if (Math.abs(expected - opts.amount) > 1) {
    throw new Error("Paid amount does not match the selected months");
  }
  const byStudent = new Map<string, typeof open>();
  for (const row of open) byStudent.set(row.inv.studentId, [...(byStudent.get(row.inv.studentId) || []), row]);
  const payments = [];
  for (const rows of byStudent.values()) {
    const { receipt } = await recordReceipt({
      invoiceIds: rows.map((row) => row.inv.id),
      amount: rows.reduce((sum, row) => sum + row.dueNow, 0),
      method: opts.method,
      reference: opts.reference,
      notes: opts.notes,
      capAtDue: true,
    });
    payments.push(...receipt.allocations);
  }
  return payments;
}

/**
 * Gives payments recorded before receipts existed a receipt. Payments of one student made together
 * become one receipt: same UTR / old receipt reference, or (no reference) same method, note and time.
 * Old generated numbers (RCPT-XXXXXXXX) are kept in the note. Safe to run again.
 */
export async function backfillLegacyReceipts(opts: { dryRun?: boolean } = {}) {
  const payments = await prisma.payment.findMany({
    where: { receiptId: null },
    include: { invoice: { select: { studentId: true, orgId: true } } },
    orderBy: { paidAt: "asc" },
  });
  const groups = new Map<string, typeof payments>();
  for (const p of payments) {
    const base = String(p.reference || "").trim().split(":")[0];
    const key = [
      p.invoice.studentId,
      p.method,
      base ? `ref:${base}` : `at:${Math.floor(+p.paidAt / 5000)}:${p.notes || ""}`,
    ].join("|");
    groups.set(key, [...(groups.get(key) || []), p]);
  }
  const ordered = [...groups.values()].sort((a, b) => +a[0].paidAt - +b[0].paidAt);
  if (opts.dryRun) {
    return { payments: payments.length, receipts: ordered.length, amount: payments.reduce((n, p) => n + p.amount, 0) };
  }
  let made = 0;
  for (const rows of ordered) {
    const first = rows[0];
    const base = String(first.reference || "").trim().split(":")[0];
    const oldNo = /^RCPT-/i.test(base) ? base.toUpperCase() : "";
    const reference = oldNo ? null : base || null;
    await prisma.$transaction(async (tx) => {
      const orgId = first.orgId ?? first.invoice.orgId ?? null;
      const receipt = await tx.feeReceipt.create({
        data: {
          orgId,
          studentId: first.invoice.studentId,
          receiptNo: await nextReceiptNo(tx, orgId, first.paidAt),
          amount: rows.reduce((n, p) => n + p.amount, 0),
          method: first.method,
          reference,
          proofPath: first.proofPath,
          notes: [first.notes, oldNo ? `Old receipt no. ${oldNo}` : ""].filter(Boolean).join("; ") || null,
          paidAt: first.paidAt,
          shareToken: randomBytes(12).toString("base64url"),
        },
      });
      await tx.payment.updateMany({ where: { id: { in: rows.map((p) => p.id) }, receiptId: null }, data: { receiptId: receipt.id } });
    });
    made += 1;
  }
  return { payments: payments.length, receipts: made, amount: payments.reduce((n, p) => n + p.amount, 0) };
}
