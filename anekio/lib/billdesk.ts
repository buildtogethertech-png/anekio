import crypto from "crypto";
import { PaymentMethod } from "@prisma/client";
import { prisma } from "./prisma";
import { recordLedgerPayment } from "./fee-ledger";
import { getSchoolPaySecrets } from "./pay-config";
import { invoiceDueNow } from "./razorpay";

function billdeskHost(testMode: boolean) {
  return testMode
    ? "https://uat1.billdesk.com/u2/payments/ve1_2"
    : "https://api.billdesk.com/payments/ve1_2";
}

function b64url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJose(payload: Record<string, unknown>, clientId: string, secret: string) {
  const header = b64url(JSON.stringify({ alg: "HS256", clientid: clientId }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  return `${data}.${b64url(sig)}`;
}

function decodeJose(token: string, secret: string) {
  const [header, body, sig] = token.split(".");
  if (!header || !body || !sig) throw new Error("BillDesk response was not signed");
  const expected = b64url(crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest());
  if (expected !== sig) throw new Error("BillDesk signature failed");
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function billdeskPost(path: string, payload: Record<string, unknown>) {
  const pay = await getSchoolPaySecrets();
  if (!pay.billdeskMerchantId || !pay.billdeskClientId || !pay.billdeskSecret) {
    throw new Error("Add the school's BillDesk keys in Admin → School");
  }
  const jws = signJose(payload, pay.billdeskClientId, pay.billdeskSecret);
  const res = await fetch(`${billdeskHost(pay.testMode)}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/jose",
      Accept: "application/jose",
      Authorization: `Bearer ${jws}`,
      "BD-Traceid": crypto.randomUUID(),
      "BD-Timestamp": String(Math.floor(Date.now() / 1000)),
    },
    body: jws,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text.slice(0, 180) || "BillDesk request failed");
  }
  return decodeJose(text.replace(/^Bearer\s+/i, "").trim(), pay.billdeskSecret);
}

export async function createBilldeskOrder(token: string, origin: string) {
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
  const orderid = `bd${Date.now().toString().slice(-10)}${row.id.slice(-6)}`.slice(0, 20);
  const created = await billdeskPost("/orders/create", {
    mercid: pay.billdeskMerchantId,
    orderid,
    amount: due.dueNow.toFixed(2),
    order_date: new Date().toISOString(),
    currency: "356",
    ru: `${origin}/pay/${token}/return?provider=billdesk`,
    itemcode: "DIRECT",
    additional_info: {
      additional_info1: row.id,
      additional_info2: token,
      additional_info3: row.student.name,
    },
    device: {
      init_channel: "internet",
      ip: "127.0.0.1",
      user_agent: "Mozilla/5.0",
      accept_header: "text/html",
      fingerprintid: "anekio",
    },
  });
  const links = (created.links as { href?: string; rel?: string; headers?: { authorization?: string } }[]) || [];
  const redirect = links.find((l) => l.rel === "redirect" || l.headers?.authorization);
  return {
    provider: "BILLDESK" as const,
    merchantId: pay.billdeskMerchantId,
    bdOrderId: String(created.bdorderid || created.orderid || orderid),
    authToken: redirect?.headers?.authorization || String(created.authorization || ""),
    returnUrl: `${origin}/pay/${token}/return?provider=billdesk`,
    amount: due.dueNow,
    name: row.student.name,
    email: row.student.parent.user.email ?? "",
    description: row.title,
  };
}

export async function captureBilldeskPayment(opts: { invoiceId: string; orderId: string }) {
  const pay = await getSchoolPaySecrets();
  const retrieved = await billdeskPost("/orders/get", {
    mercid: pay.billdeskMerchantId,
    orderid: opts.orderId,
  });
  const status = String(retrieved.auth_status || retrieved.status || "").toUpperCase();
  if (status !== "0300" && status !== "SUCCESS" && status !== "PAID") {
    throw new Error(`BillDesk order is ${status || "unpaid"}`);
  }
  const rupees = Math.round(Number(retrieved.amount || 0));
  return recordLedgerPayment({
    invoiceId: opts.invoiceId,
    amount: rupees,
    method: PaymentMethod.BILLDESK,
    reference: String(retrieved.transactionid || retrieved.orderid || opts.orderId),
    notes: `BillDesk ${opts.orderId}`,
  });
}

export function parseBilldeskReturn(raw: string, secret: string) {
  return decodeJose(raw.replace(/^Bearer\s+/i, "").trim(), secret);
}
