import { createBilldeskOrder, captureBilldeskPayment } from "./billdesk";
import { createCashfreeOrder, captureCashfreePayment } from "./cashfree";
import { randomUUID } from "node:crypto";
import { invoiceBalance, unpaidFeeMonths } from "./fees";
import { gatewayReady, getSchoolPaySecrets } from "./pay-config";
import {
  createFeeOrder,
  createMonthsOrder,
  captureRazorpayPayment,
  captureRazorpayMonths,
} from "./razorpay";
import { prisma } from "./prisma";

export async function invoicesForStudentMonths(studentToken: string, invoiceIds: string[]) {
  const student = await prisma.student.findUnique({
    where: { payToken: studentToken },
    include: { feeInvoices: { include: { payments: true } } },
  });
  if (!student) throw new Error("Pay link is not valid");
  const wanted = new Set(invoiceIds);
  const open = student.feeInvoices
    .filter((inv) => wanted.has(inv.id))
    .filter((inv) => invoiceBalance(inv).dueNow > 0)
    .sort((a, b) => +a.dueDate - +b.dueDate);
  if (!open.length) throw new Error("Those months are already paid");
  return open;
}

export async function buildStudentMonthPayPath(
  studentId: string,
  invoiceIds: string[],
  opts?: { forceOlderPrefix?: boolean }
) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { feeInvoices: { include: { payments: true } } },
  });
  if (!student) throw new Error("Student missing");
  const wanted = new Set(invoiceIds.filter(Boolean));
  if (!wanted.size) throw new Error("Pick the months to pay");

  const unpaid = student.feeInvoices
    .map((inv) => ({ inv, dueNow: invoiceBalance(inv).dueNow }))
    .filter((row) => row.dueNow > 0)
    .sort((a, b) => +a.inv.dueDate - +b.inv.dueDate || a.inv.title.localeCompare(b.inv.title));

  let picked = unpaid.filter((row) => wanted.has(row.inv.id)).map((row) => row.inv);
  if (opts?.forceOlderPrefix) {
    const months = unpaidFeeMonths(
      unpaid.map((row) => ({
        id: row.inv.id,
        title: row.inv.title,
        period: row.inv.period || row.inv.id,
        dueAt: +row.inv.dueDate,
        dueNow: row.dueNow,
        inv: row.inv,
      }))
    );
    let last = -1;
    months.forEach((month, index) => {
      if (month.invoiceIds.some((id) => wanted.has(id))) last = index;
    });
    if (last < 0) throw new Error("Those months are already paid");
    picked = months.slice(0, last + 1).flatMap((month) => month.items.map((item) => item.inv));
  }
  if (!picked.length) throw new Error("Those months are already paid");
  picked.sort((a, b) => +a.dueDate - +b.dueDate || a.title.localeCompare(b.title));

  let payToken = student.payToken;
  if (!payToken) {
    payToken = randomUUID();
    await prisma.student.update({ where: { id: studentId }, data: { payToken } });
  }
  for (const inv of picked) {
    if (!inv.shareToken) {
      await prisma.feeInvoice.update({
        where: { id: inv.id },
        data: { shareToken: randomUUID() },
      });
    }
  }
  const periods = picked.map((inv) => inv.period || inv.id).join(",");
  return {
    payToken,
    periods,
    invoiceIds: picked.map((inv) => inv.id),
    path: `/pay/s/${payToken}?m=${encodeURIComponent(periods)}`,
  };
}

export async function invoicesFromPeriods(studentToken: string, periods: string) {
  const list = periods.split(",").map((p) => p.trim()).filter(Boolean);
  const student = await prisma.student.findUnique({
    where: { payToken: studentToken },
    include: { feeInvoices: { include: { payments: true } } },
  });
  if (!student) return [];
  return student.feeInvoices
    .filter((inv) => list.includes(inv.period))
    .sort((a, b) => +a.dueDate - +b.dueDate);
}

export async function createSchoolFeeOrder(
  token: string,
  origin: string,
  extras?: { studentToken?: string; invoiceIds?: string[] }
) {
  const pay = await getSchoolPaySecrets();
  if (!gatewayReady(pay)) {
    throw new Error("School has not connected a payment gateway yet");
  }
  const studentToken = extras?.studentToken;
  const invoiceIds = extras?.invoiceIds?.filter(Boolean) || [];
  if (studentToken && invoiceIds.length) {
    if (pay.gateway === "RAZORPAY") return createMonthsOrder(studentToken, invoiceIds);
    if (invoiceIds.length === 1) {
      const inv = await prisma.feeInvoice.findUnique({ where: { id: invoiceIds[0] } });
      if (!inv?.shareToken) throw new Error("Invoice missing");
      if (pay.gateway === "CASHFREE") return createCashfreeOrder(inv.shareToken, origin);
      if (pay.gateway === "BILLDESK") return createBilldeskOrder(inv.shareToken, origin);
    }
    throw new Error("This gateway can take one month at a time. Pick one month, or use Razorpay.");
  }
  if (pay.gateway === "CASHFREE") return createCashfreeOrder(token, origin);
  if (pay.gateway === "BILLDESK") return createBilldeskOrder(token, origin);
  return createFeeOrder(token);
}

export async function verifySchoolPayment(input: {
  token?: string;
  studentToken?: string;
  invoiceIds?: string[];
  provider?: string;
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  razorpay_signature?: string;
  orderId?: string;
}) {
  const pay = await getSchoolPaySecrets();
  const provider = input.provider || pay.gateway;
  const invoiceIds = input.invoiceIds?.filter(Boolean) || [];
  const studentToken = input.studentToken || "";

  if (studentToken && invoiceIds.length) {
    const open = await invoicesForStudentMonths(studentToken, invoiceIds);
    const ids = open.map((inv) => inv.id);
    if (provider === "RAZORPAY") {
      const { verifyCheckoutSignature } = await import("./razorpay");
      const orderId = input.razorpay_order_id || input.orderId || "";
      const paymentId = input.razorpay_payment_id || "";
      const signature = input.razorpay_signature || "";
      if (!orderId || !paymentId || !signature) throw new Error("Incomplete payment");
      if (!(await verifyCheckoutSignature(orderId, paymentId, signature))) {
        throw new Error("Signature failed");
      }
      return captureRazorpayMonths({ invoiceIds: ids, paymentId, orderId });
    }
    throw new Error("This gateway can take one month at a time. Pick one month, or use Razorpay.");
  }

  const invoice = input.token
    ? await prisma.feeInvoice.findUnique({ where: { shareToken: input.token } })
    : null;
  if (!invoice) throw new Error("Invoice missing");

  if (provider === "RAZORPAY") {
    const { verifyCheckoutSignature } = await import("./razorpay");
    const orderId = input.razorpay_order_id || input.orderId || "";
    const paymentId = input.razorpay_payment_id || "";
    const signature = input.razorpay_signature || "";
    if (!orderId || !paymentId || !signature) throw new Error("Incomplete payment");
    if (!(await verifyCheckoutSignature(orderId, paymentId, signature))) {
      throw new Error("Signature failed");
    }
    return captureRazorpayPayment({ invoiceId: invoice.id, paymentId, orderId });
  }

  if (provider === "CASHFREE") {
    const orderId = input.orderId || "";
    if (!orderId) throw new Error("Incomplete payment");
    return captureCashfreePayment({ invoiceId: invoice.id, orderId });
  }

  if (provider === "BILLDESK") {
    const orderId = input.orderId || "";
    if (!orderId) throw new Error("Incomplete payment");
    return captureBilldeskPayment({ invoiceId: invoice.id, orderId });
  }

  throw new Error("No payment gateway is connected");
}
