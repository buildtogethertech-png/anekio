import crypto from "crypto";
import Razorpay from "razorpay";
import { PaymentMethod } from "@prisma/client";
import { prisma } from "./prisma";
import { invoiceBalance, payRangeLabel, expandOldestUnpaidInvoiceIds, inrToPaise } from "./fees";
import { recordLedgerPayment, settleMonthPayments } from "./fee-ledger";
import { getSchoolPaySecrets } from "./pay-config";

export async function razorpayKeys(orgId?: string | null) {
  const pay = await getSchoolPaySecrets(orgId);
  return {
    keyId: pay.razorpayKeyId,
    keySecret: pay.razorpayKeySecret,
    webhookSecret: pay.razorpayWebhookSecret,
    configured: Boolean(pay.razorpayKeyId && pay.razorpayKeySecret),
  };
}

export async function getRazorpay(orgId?: string | null) {
  const { keyId, keySecret, configured } = await razorpayKeys(orgId);
  if (!configured) throw new Error("Add the school's Razorpay keys in Admin → School");
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export async function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, orgId?: string | null) {
  const { keySecret } = await razorpayKeys(orgId);
  if (!keySecret) return false;
  const expected = crypto.createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return expected === signature;
}

export async function verifyWebhookSignature(rawBody: string, signature: string) {
  const rows = await prisma.schoolConfig.findMany({ select: { razorpayWebhookSecret: true } });
  const secrets = [...new Set(rows.map((row) => row.razorpayWebhookSecret?.trim()).filter(Boolean))];
  for (const webhookSecret of secrets) {
    const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    if (expected === signature) return true;
  }
  return false;
}

export async function invoiceDueNow(invoiceId: string) {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { id: invoiceId },
    include: { payments: true, student: { select: { orgId: true } } },
  });
  if (!invoice) return null;
  const { paid, remaining, dueNow } = invoiceBalance(invoice);
  return { invoice, paid, remaining, dueNow };
}

export async function createFeeOrder(token: string) {
  const row = await prisma.feeInvoice.findUnique({
    where: { shareToken: token },
    include: {
      student: { include: { class: true, parent: { include: { user: true } } } },
      payments: true,
    },
  });
  if (!row) throw new Error("Invoice missing");
  const due = await invoiceDueNow(row.id);
  if (!due || due.dueNow <= 0) throw new Error("This invoice is already paid");
  const rzp = await getRazorpay(row.orgId || row.student.orgId);
  const order = await rzp.orders.create({
    amount: inrToPaise(due.dueNow),
    currency: "INR",
    receipt: row.id.slice(0, 40),
    notes: { token, invoiceId: row.id, student: row.student.name },
  });
  const { keyId } = await razorpayKeys(row.orgId || row.student.orgId);
  return {
    provider: "RAZORPAY" as const,
    keyId,
    orderId: order.id,
    amount: due.dueNow,
    amountPaise: inrToPaise(due.dueNow),
    name: row.student.name,
    email: row.student.parent.user.email ?? "",
    description: row.title,
  };
}

export async function createMonthsOrder(studentToken: string, invoiceIds: string[]) {
  const student = await prisma.student.findUnique({
    where: { payToken: studentToken },
    include: {
      parent: { include: { user: true } },
      feeInvoices: { include: { payments: true } },
    },
  });
  if (!student) throw new Error("Pay link is not valid");
  const familyInvoices = await prisma.feeInvoice.findMany({
    where: { student: { parentId: student.parentId } },
    include: { student: true, payments: true },
  });
  const wanted = new Set(
    expandOldestUnpaidInvoiceIds(
      familyInvoices.map((inv) => ({
        id: inv.id,
        studentId: inv.studentId,
        dueDate: inv.dueDate,
        title: inv.title,
        dueNow: invoiceBalance(inv).dueNow,
      })),
      invoiceIds
    )
  );
  const open = familyInvoices
    .filter((inv) => wanted.has(inv.id))
    .map((inv) => ({ inv, dueNow: invoiceBalance(inv).dueNow }))
    .filter((row) => row.dueNow > 0)
    .sort((a, b) => +a.inv.dueDate - +b.inv.dueDate);
  if (!open.length) throw new Error("Those months are already paid");
  const amount = open.reduce((sum, row) => sum + row.dueNow, 0);
  const titles = open.map((row) => `${row.inv.student.name} · ${row.inv.title}`);
  const range = payRangeLabel(titles);
  const periods = open.map((row) => row.inv.period).join(",");
  const rzp = await getRazorpay(student.orgId);
  const order = await rzp.orders.create({
    amount: inrToPaise(amount),
    currency: "INR",
    receipt: studentToken.replace(/-/g, "").slice(0, 40),
    notes: { studentToken, periods, student: student.name, invoiceIds: open.map((row) => row.inv.id).join(",") },
  });
  const { keyId } = await razorpayKeys(student.orgId);
  return {
    provider: "RAZORPAY" as const,
    keyId,
    orderId: order.id,
    amount,
    amountPaise: inrToPaise(amount),
    name: student.name,
    email: student.parent.user.email ?? "",
    description: open.length === 1 ? titles[0] : `${range} · ${open.length} invoices`,
    invoiceIds: open.map((row) => row.inv.id),
  };
}

export async function captureRazorpayPayment(opts: {
  invoiceId: string;
  paymentId: string;
  orderId?: string;
  amountRupees?: number;
}) {
  const due = await invoiceDueNow(opts.invoiceId);
  if (!due) throw new Error("Invoice missing");
  if (due.dueNow <= 0) {
    const existing = await prisma.payment.findFirst({
      where: { invoiceId: opts.invoiceId, method: PaymentMethod.RAZORPAY, reference: opts.paymentId },
    });
    if (existing) return existing;
    throw new Error("This invoice is already paid");
  }
  const invoice = due.invoice;
  const rzp = await getRazorpay(invoice.orgId || invoice.student?.orgId);
  const payment = await rzp.payments.fetch(opts.paymentId);
  const notes = (payment.notes || {}) as { invoiceId?: string; token?: string };
  if (notes.invoiceId && notes.invoiceId !== opts.invoiceId) throw new Error("Payment does not belong to this invoice");
  if (opts.orderId && payment.order_id && String(payment.order_id) !== opts.orderId) {
    throw new Error("Payment does not belong to this order");
  }
  if (payment.status === "authorized") {
    await rzp.payments.capture(opts.paymentId, payment.amount, payment.currency || "INR");
  } else if (payment.status !== "captured") {
    throw new Error(`Razorpay payment is ${payment.status}`);
  }
  const paidRupees = Math.round(Number(payment.amount) / 100);
  const rupees = Math.min(due.dueNow, Math.max(0, paidRupees));
  if (!rupees) throw new Error("Invalid payment");
  return recordLedgerPayment({
    invoiceId: opts.invoiceId,
    amount: rupees,
    method: PaymentMethod.RAZORPAY,
    reference: opts.paymentId,
    notes: opts.orderId ? `order ${opts.orderId}` : `Razorpay ${payment.status}`,
  });
}

export async function captureRazorpayMonths(opts: {
  invoiceIds: string[];
  paymentId: string;
  orderId?: string;
}) {
  const invoice = await prisma.feeInvoice.findFirst({
    where: { id: { in: opts.invoiceIds } },
    select: { orgId: true, student: { select: { orgId: true } } },
  });
  const rzp = await getRazorpay(invoice?.orgId || invoice?.student.orgId);
  const payment = await rzp.payments.fetch(opts.paymentId);
  if (payment.status === "authorized") {
    await rzp.payments.capture(opts.paymentId, payment.amount, payment.currency || "INR");
  } else if (payment.status !== "captured") {
    throw new Error(`Razorpay payment is ${payment.status}`);
  }
  const rupees = Math.round(Number(payment.amount) / 100);
  return settleMonthPayments({
    invoiceIds: opts.invoiceIds,
    amount: rupees,
    method: PaymentMethod.RAZORPAY,
    reference: opts.paymentId,
    notes: opts.orderId ? `order ${opts.orderId}` : `Razorpay ${payment.status}`,
  });
}
