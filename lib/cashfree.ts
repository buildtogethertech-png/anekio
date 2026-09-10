import crypto from "crypto";
import { PaymentMethod } from "@prisma/client";
import { prisma } from "./prisma";
import { recordLedgerPayment } from "./fee-ledger";
import { getSchoolPaySecrets } from "./pay-config";
import { invoiceDueNow } from "./razorpay";

function cashfreeHost(testMode: boolean) {
  return testMode ? "https://sandbox.cashfree.com/pg" : "https://api.cashfree.com/pg";
}

async function cashfreeFetch(path: string, init?: RequestInit) {
  const pay = await getSchoolPaySecrets();
  if (!pay.cashfreeAppId || !pay.cashfreeSecretKey) {
    throw new Error("Add the school's Cashfree keys in Admin → School");
  }
  const res = await fetch(`${cashfreeHost(pay.testMode)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": pay.cashfreeAppId,
      "x-client-secret": pay.cashfreeSecretKey,
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (body as { message?: string }).message ||
      (body as { error?: string }).error ||
      "Cashfree request failed";
    throw new Error(message);
  }
  return body as Record<string, unknown>;
}

export async function createCashfreeOrder(token: string, origin: string) {
  const row = await prisma.feeInvoice.findUnique({
    where: { shareToken: token },
    include: {
      student: { include: { parent: { include: { user: true } } } },
    },
  });
  if (!row) throw new Error("Invoice missing");
  const due = await invoiceDueNow(row.id);
  if (!due || due.dueNow <= 0) throw new Error("This invoice is already paid");
  const pay = await getSchoolPaySecrets();
  const orderId = `cf_${row.id.slice(0, 18)}_${Date.now().toString().slice(-6)}`;
  const phone = row.student.parent.phone?.replace(/\D/g, "").slice(-10) || "9999999999";
  const created = await cashfreeFetch("/orders", {
    method: "POST",
    body: JSON.stringify({
      order_id: orderId,
      order_amount: due.dueNow,
      order_currency: "INR",
      order_note: row.title,
      customer_details: {
        customer_id: row.student.id.slice(0, 40),
        customer_name: row.student.name,
        customer_email: row.student.parent.user.email || "parent@school.test",
        customer_phone: phone.length === 10 ? phone : "9999999999",
      },
      order_meta: {
        return_url: `${origin}/pay/${token}/return?provider=cashfree&order_id={order_id}`,
        notify_url: `${origin}/api/pay/webhook?provider=cashfree`,
      },
      order_tags: { token, invoiceId: row.id },
    }),
  });
  return {
    provider: "CASHFREE" as const,
    mode: pay.testMode ? "sandbox" : "production",
    orderId: String(created.order_id || orderId),
    paymentSessionId: String(created.payment_session_id || ""),
    amount: due.dueNow,
    name: row.student.name,
    email: row.student.parent.user.email ?? "",
    description: row.title,
  };
}

export async function captureCashfreePayment(opts: { invoiceId: string; orderId: string }) {
  const order = await cashfreeFetch(`/orders/${encodeURIComponent(opts.orderId)}`);
  const status = String(order.order_status || "");
  if (status !== "PAID") throw new Error(`Cashfree order is ${status || "unpaid"}`);
  const rupees = Math.round(Number(order.order_amount || 0));
  return recordLedgerPayment({
    invoiceId: opts.invoiceId,
    amount: rupees,
    method: PaymentMethod.CASHFREE,
    reference: opts.orderId,
    notes: "Cashfree PAID",
  });
}

export async function verifyCashfreeWebhook(rawBody: string, timestamp: string, signature: string) {
  const pay = await getSchoolPaySecrets();
  if (!pay.cashfreeSecretKey || !timestamp || !signature) return false;
  const expected = crypto
    .createHmac("sha256", pay.cashfreeSecretKey)
    .update(timestamp + rawBody)
    .digest("base64");
  return expected === signature;
}
