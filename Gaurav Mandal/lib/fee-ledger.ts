import { InvoiceStatus, PaymentMethod } from "@prisma/client";
import { prisma } from "./prisma";
import { invoiceBalance } from "./fees";

export async function refreshInvoiceStatus(invoiceId: string) {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { id: invoiceId },
    include: { payments: true },
  });
  if (!invoice) return;
  const { paid, remaining, lateDays, dueNow } = invoiceBalance(invoice);
  let status: InvoiceStatus = InvoiceStatus.DUE;
  if (paid >= dueNow || remaining <= 0) status = InvoiceStatus.PAID;
  else if (paid > 0) status = InvoiceStatus.PARTIAL;
  else if (lateDays > 0) status = InvoiceStatus.OVERDUE;
  await prisma.feeInvoice.update({ where: { id: invoiceId }, data: { status } });
}

export async function recordLedgerPayment(data: {
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  proofPath?: string | null;
  notes?: string | null;
}) {
  if (data.reference) {
    const dup = await prisma.payment.findFirst({
      where: { reference: data.reference, method: data.method },
    });
    if (dup) return dup;
  }
  const payment = await prisma.payment.create({
    data: {
      invoiceId: data.invoiceId,
      amount: data.amount,
      method: data.method,
      reference: data.reference ?? null,
      proofPath: data.proofPath ?? null,
      notes: data.notes ?? null,
    },
  });
  await refreshInvoiceStatus(data.invoiceId);
  return payment;
}

export async function settleMonthPayments(opts: {
  invoiceIds: string[];
  amount: number;
  method: PaymentMethod;
  reference: string;
  notes?: string | null;
}) {
  const invoices = await prisma.feeInvoice.findMany({
    where: { id: { in: opts.invoiceIds } },
    include: { payments: true },
    orderBy: { dueDate: "asc" },
  });
  const open = invoices
    .map((inv) => ({ inv, dueNow: invoiceBalance(inv).dueNow }))
    .filter((row) => row.dueNow > 0);
  if (!open.length) throw new Error("Those months are already paid");
  const expected = open.reduce((sum, row) => sum + row.dueNow, 0);
  if (Math.abs(expected - opts.amount) > 1) {
    throw new Error("Paid amount does not match the selected months");
  }
  const payments = [];
  for (const row of open) {
    payments.push(
      await recordLedgerPayment({
        invoiceId: row.inv.id,
        amount: row.dueNow,
        method: opts.method,
        reference: `${opts.reference}:${row.inv.id.slice(-8)}`,
        notes: opts.notes || row.inv.title,
      })
    );
  }
  return payments;
}
