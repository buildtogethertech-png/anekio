import crypto from "crypto";
import Razorpay from "razorpay";
import { PaymentMethod } from "@prisma/client";
import { prisma } from "./prisma";
import { invoiceBalance, payRangeLabel } from "./fees";
import { recordLedgerPayment, settleMonthPayments } from "./fee-ledger";
import { getSchoolPaySecrets } from "./pay-config";

export async function razorpayKeys() {
  const pay = await getSchoolPaySecrets();
  return {
    keyId: pay.razorpayKeyId,
    keySecret: pay.razorpayKeySecret,
    webhookSecret: pay.razorpayWebhookSecret,
    configured: Boolean(pay.razorpayKeyId && pay.razorpayKeySecret),
  };
}

export async function getRazorpay() {
  const { keyId, keySecret, configured } = await razorpayKeys();
  if (!configured) throw new Error("Add the school's Razorpay keys in Admin → School");
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export async function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  const { keySecret } = await razorpayKeys();
  if (!keySecret) return false;
  const expected = crypto.createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return expected === signature;
}

export async function verifyWebhookSignature(rawBody: string, signature: string) {
  const { webhookSecret } = await razorpayKeys();
  if (!webhookSecret) return false;
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return expected === signature;
}

export async function invoiceDueNow(invoiceId: string) {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { id: invoiceId },
    include: { payments: true },
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
  const rzp = await getRazorpay();
  const order = await rzp.orders.create({
    amount: due.dueNow * 100,
    currency: "INR",
    receipt: row.id.slice(0, 40),
    notes: { token, invoiceId: row.id, student: row.student.name },
  });
  const { keyId } = await razorpayKeys();
  return {
    provider: "RAZORPAY" as const,
    keyId,
    orderId: order.id,
    amount: due.dueNow,
    amountPaise: due.dueNow * 100,
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
  const wanted = new Set(invoiceIds);
  const open = student.feeInvoices
    .filter((inv) => wanted.has(inv.id))
    .map((inv) => ({ inv, dueNow: invoiceBalance(inv).dueNow }))
    .filter((row) => row.dueNow > 0)
    .sort((a, b) => +a.inv.dueDate - +b.inv.dueDate);
  if (!open.length) throw new Error("Those months are already paid");
  const amount = open.reduce((sum, row) => sum + row.dueNow, 0);
  const titles = open.map((row) => row.inv.title);
  const range = payRangeLabel(titles);
  const periods = open.map((row) => row.inv.period).join(",");
  const rzp = await getRazorpay();
  const order = await rzp.orders.create({
    amount: amount * 100,
    currency: "INR",
    receipt: studentToken.replace(/-/g, "").slice(0, 40),
    notes: { studentToken, periods, student: student.name },
  });
  const { keyId } = await razorpayKeys();
  return {
    provider: "RAZORPAY" as const,
    keyId,
    orderId: order.id,
    amount,
    amountPaise: amount * 100,
    name: student.name,
    email: student.parent.user.email ?? "",
    description: open.length === 1 ? titles[0] : `${range} · ${open.length} months`,
    invoiceIds: open.map((row) => row.inv.id),
  };
}

export async function captureRazorpayPayment(opts: {
  invoiceId: string;
  paymentId: string;
  orderId?: string;
  amountRupees?: number;
}) {
  const rzp = await getRazorpay();
  const payment = await rzp.payments.fetch(opts.paymentId);
  if (payment.status === "authorized") {
    await rzp.payments.capture(opts.paymentId, payment.amount, payment.currency || "INR");
  } else if (payment.status !== "captured") {
    throw new Error(`Razorpay payment is ${payment.status}`);
  }
  const rupees = opts.amountRupees ?? Math.round(Number(payment.amount) / 100);
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
  const rzp = await getRazorpay();
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
