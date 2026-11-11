import { formatInr, publicOrigin } from "./utils";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

type PaymentWithReceipt = {
  id: string;
  amount: number;
  method: string;
  reference?: string | null;
  paidAt: Date;
  receiptId?: string | null;
  receipt?: { receiptNo: string; amount: number; shareToken: string } | null;
};

const MODE: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK: "Bank transfer",
  CHEQUE: "Cheque",
  RAZORPAY: "Online",
  CASHFREE: "Online",
  BILLDESK: "Online",
};

/**
 * The money an invoice received, one row per receipt, oldest first. `amount` is only what went to
 * this invoice; `receiptTotal` is the whole receipt when it also paid other invoices.
 */
export function invoicePaymentRows(payments: PaymentWithReceipt[]) {
  const rows = new Map<string, { receiptNo: string; paidAt: Date; mode: string; amount: number; receiptTotal: number; url: string }>();
  for (const p of [...payments].sort((a, b) => +a.paidAt - +b.paidAt)) {
    const key = p.receiptId || p.id;
    const row = rows.get(key);
    if (row) {
      row.amount += p.amount;
      continue;
    }
    rows.set(key, {
      receiptNo: p.receipt?.receiptNo || (String(p.reference || "").split(":")[0] || `RCPT-${p.id.slice(-8)}`).toUpperCase(),
      paidAt: p.paidAt,
      mode: MODE[String(p.method)] || String(p.method),
      amount: p.amount,
      receiptTotal: p.receipt?.amount || 0,
      url: p.receipt ? `${publicOrigin()}/pay/r/${p.receipt.shareToken}` : "",
    });
  }
  return [...rows.values()];
}

function day(at: Date) {
  return at.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Rows for a document-studio TABLE (`fees.payments`). */
export function invoicePaymentTable(payments: PaymentWithReceipt[]) {
  return invoicePaymentRows(payments).map((r) => ({
    receipt: r.receiptNo,
    date: day(r.paidAt),
    mode: r.mode,
    amount: `${formatInr(r.amount)}${r.receiptTotal > r.amount ? ` (of ${formatInr(r.receiptTotal)})` : ""}`,
  }));
}

/** "Payments received" block shown under the invoice. Empty when nothing was paid. */
export function paymentsReceivedHtml(payments: PaymentWithReceipt[], balanceDue: number) {
  const rows = invoicePaymentRows(payments);
  if (!rows.length) return "";
  const paid = rows.reduce((n, r) => n + r.amount, 0);
  const body = rows
    .map(
      (r) => `<tr>
        <td>${r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.receiptNo)}</a>` : escapeHtml(r.receiptNo)}</td>
        <td>${escapeHtml(day(r.paidAt))}</td>
        <td>${escapeHtml(r.mode)}</td>
        <td class="amt">${escapeHtml(formatInr(r.amount))}${r.receiptTotal > r.amount ? `<div class="of">of ${escapeHtml(formatInr(r.receiptTotal))} receipt</div>` : ""}</td>
      </tr>`
    )
    .join("");
  return `<section class="pay-received">
    <style>
      .pay-received{width:min(190mm,100%);box-sizing:border-box;background:#fff;border-radius:8px;box-shadow:0 2px 18px #102a4322;padding:18px 22px;margin:0 auto 24px;font-family:Inter,system-ui,"Segoe UI",sans-serif;color:#0f172a}
      .pay-received h2{margin:0 0 10px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#475569}
      .pay-received table{width:100%;border-collapse:collapse;font-size:12px}
      .pay-received th{background:#F1F5F9;color:#475569;text-align:left;padding:7px 8px;font-size:10px;letter-spacing:.06em;text-transform:uppercase}
      .pay-received td{padding:7px 8px;border-bottom:1px solid #E2E8F0;font-weight:500;vertical-align:top}
      .pay-received .amt{text-align:right;font-variant-numeric:tabular-nums}
      .pay-received .of{font-size:10px;color:#64748B;font-weight:400}
      .pay-received a{color:#1F45C7;text-decoration:none;font-weight:600}
      .pay-received .sum{display:flex;justify-content:flex-end;gap:28px;margin-top:10px;font-size:12px}
      .pay-received .sum b{font-variant-numeric:tabular-nums}
      @media print{.pay-received{box-shadow:none;break-inside:avoid;margin:0 auto}}
    </style>
    <h2>Payments received</h2>
    <table><thead><tr><th>Receipt No.</th><th>Date</th><th>Mode</th><th class="amt">Amount</th></tr></thead><tbody>${body}</tbody></table>
    <div class="sum"><span>Total paid <b>${escapeHtml(formatInr(paid))}</b></span><span>Balance due <b>${escapeHtml(formatInr(Math.max(0, balanceDue)))}</b></span></div>
  </section>`;
}
