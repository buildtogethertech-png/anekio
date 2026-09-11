import { getSharedInvoice, getStudentPay } from "../lib/pay-public";
import { feeLineTotal, invoiceBalance, parseFeeLines } from "../lib/fees";
import { gatewayLabel, gatewayReady, getSchoolPaySecrets } from "../lib/pay-config";
import { schoolBankLine, schoolFromConfig, schoolLines } from "../lib/school";
import { feePayUrl, formatInr } from "../lib/utils";
import { renderActiveFeeInvoiceTemplateHtml, renderActivePaymentReceiptTemplateHtml } from "../lib/document-studio";

function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --ink: #172033; --muted: #5f6d7e; --line: #d7dee8; --soft: #f7f4ef; --panel: #ffffff; --blue: #2456d6; --blue-dark: #1d45ad; --green: #067647; --red: #b42318; --amber: #9a5b13; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: var(--soft); color: var(--ink); }
    main { width: min(1120px, 100%); margin: 0 auto; padding: 32px 20px 48px; }
    h1, h2, h3, p { margin-top: 0; }
    h1 { font-size: clamp(1.55rem, 2.4vw, 2.25rem); line-height: 1.08; margin-bottom: 10px; letter-spacing: 0; }
    h2 { font-size: 1rem; margin-bottom: 14px; letter-spacing: 0; }
    h3 { font-size: .98rem; margin-bottom: 4px; }
    p { color: var(--muted); line-height: 1.5; }
    a { color: var(--blue-dark); font-weight: 700; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .checkout { display: grid; grid-template-columns: minmax(0, .9fr) minmax(420px, 1.1fr); gap: 22px; align-items: start; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 16px 40px rgba(23, 32, 51, .07); }
    .context { padding: 24px; }
    .summary { overflow: hidden; }
    .summary-head, .section, .paybox { padding: 22px 24px; border-bottom: 1px solid var(--line); }
    .paybox { border-bottom: 0; background: #fbfcff; }
    .eyebrow { color: #49617f; font-size: .78rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 10px; }
    .school-mark { width: 46px; height: 46px; border-radius: 8px; display: grid; place-items: center; background: #eaf0ff; color: var(--blue-dark); font-weight: 900; margin-bottom: 18px; }
    .meta { color: var(--muted); margin-bottom: 0; }
    .info-grid { display: grid; gap: 12px; margin-top: 24px; }
    .info { border-top: 1px solid var(--line); padding-top: 14px; }
    .label { color: var(--muted); display: block; font-size: .72rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; margin-bottom: 5px; }
    .value { font-weight: 750; }
    .small { color: var(--muted); font-size: .88rem; line-height: 1.45; }
    .trust { display: grid; gap: 10px; margin-top: 22px; }
    .trust-item { display: flex; gap: 10px; align-items: flex-start; color: #34445a; font-size: .92rem; }
    .dot { width: 20px; height: 20px; border-radius: 999px; flex: 0 0 20px; display: grid; place-items: center; background: #e7f7ef; color: var(--green); font-size: .8rem; font-weight: 900; }
    .invoice-list { display: grid; gap: 12px; }
    .invoice { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: #fff; }
    .invoice-top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .invoice-title { font-weight: 850; margin-bottom: 4px; }
    .amount { font-size: 1.1rem; font-weight: 900; white-space: nowrap; }
    .status { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 9px; font-size: .74rem; font-weight: 850; background: #edf4ff; color: #204b9b; margin-top: 8px; }
    .status.overdue { background: #fff4e5; color: var(--amber); }
    .status.paid { background: #e7f7ef; color: var(--green); }
    .line-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .line-table td { padding: 7px 0; border-top: 1px solid #eef1f5; color: #3b4a5d; vertical-align: top; }
    .line-table td:last-child { text-align: right; color: var(--ink); font-weight: 750; white-space: nowrap; padding-left: 18px; }
    .invoice-actions { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-top: 12px; }
    .total-row { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; font-size: 1.1rem; margin-bottom: 16px; }
    .total-row strong { font-size: 1.75rem; letter-spacing: 0; }
    button, .button { width: 100%; border: 0; background: var(--blue); color: #fff; border-radius: 8px; padding: 1rem 1.1rem; font-size: 1rem; font-weight: 850; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    button:hover, .button:hover { background: var(--blue-dark); text-decoration: none; }
    button[disabled] { opacity: .6; cursor: progress; }
    .err { color: var(--red); font-size: .9rem; margin: 12px 0 0; }
    .ok { color: var(--green); font-weight: 750; }
    .warn { color: var(--amber); font-weight: 700; }
    .empty { padding: 18px; border: 1px dashed var(--line); border-radius: 8px; color: var(--muted); background: #fff; }
    @media (max-width: 840px) {
      main { padding: 18px 12px 32px; }
      .checkout { grid-template-columns: 1fr; }
      .context, .summary-head, .section, .paybox { padding: 18px; }
      .invoice-top, .invoice-actions, .total-row { align-items: stretch; flex-direction: column; }
      .line-table td:last-child { white-space: normal; }
    }
    @media print {
      button, .button, .noprint { display: none; }
      body { background: #fff; }
      main { width: 100%; padding: 0; }
      .panel { box-shadow: none; }
    }
  </style>
</head>
<body><main>${body}</main>
<script>
(function () {
  function notifyPaid() {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: "anekio-pay", paid: true }, "*");
      }
    } catch (e) {}
  }
  window.anekioNotifyPaid = notifyPaid;
  if (new URLSearchParams(location.search).get("paid") === "1") notifyPaid();
})();
</script>
</body>
</html>`;
}

function checkoutScript(opts: {
  token?: string;
  studentToken?: string;
  invoiceIds?: string[];
  schoolName: string;
  amountLabel: string;
  provider: string;
}) {
  return `<script>
const payload = ${JSON.stringify(opts)};
function hostWin() {
  try {
    if (window.parent && window.parent !== window && window.parent.location.origin === window.location.origin) {
      return window.parent;
    }
  } catch (e) {}
  return window;
}
function notifyPaid() {
  if (typeof window.anekioNotifyPaid === "function") window.anekioNotifyPaid();
}
async function pay() {
  const err = document.getElementById("err");
  const btn = document.getElementById("pay");
  err.textContent = "";
  btn.disabled = true;
  try {
    const res = await fetch("/api/pay/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: payload.token,
        studentToken: payload.studentToken,
        invoiceIds: payload.invoiceIds,
      }),
    });
    const order = await res.json();
    if (!res.ok) throw new Error(order.error || "Could not start payment");
    const w = hostWin();
    if (order.provider === "CASHFREE") {
      await load("https://sdk.cashfree.com/js/v3/cashfree.js");
      const cashfree = w.Cashfree({ mode: order.mode || "sandbox" });
      const result = await cashfree.checkout({ paymentSessionId: order.paymentSessionId, redirectTarget: "_modal" });
      if (result && result.error && result.error.message) throw new Error(result.error.message);
      await verify({ provider: "CASHFREE", orderId: (result && result.paymentDetails && result.paymentDetails.orderId) || order.orderId });
      return;
    }
    if (order.provider === "BILLDESK") {
      window.location.href = "/pay/" + (payload.token || "s/" + payload.studentToken) + "/return?provider=billdesk&order_id=" + encodeURIComponent(order.bdOrderId || "");
      return;
    }
    await load("https://checkout.razorpay.com/v1/checkout.js");
    await new Promise((resolve, reject) => {
      const rzp = new w.Razorpay({
        key: order.keyId,
        amount: order.amountPaise,
        currency: "INR",
        name: payload.schoolName,
        description: order.description,
        order_id: order.orderId,
        handler: async (response) => {
          try {
            await verify({ provider: "RAZORPAY", ...response });
            resolve();
          } catch (e) { reject(e); }
        },
        modal: { ondismiss: () => resolve() },
      });
      rzp.open();
    });
  } catch (e) {
    err.textContent = e.message || "Payment failed";
  } finally {
    btn.disabled = false;
  }
}
async function verify(extra) {
  const res = await fetch("/api/pay/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: payload.token, studentToken: payload.studentToken, invoiceIds: payload.invoiceIds, ...extra }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Verification failed");
  notifyPaid();
  const next = new URL(window.location.href);
  next.searchParams.set("paid", "1");
  window.location.replace(next.toString());
}
function load(src) {
  const w = hostWin();
  return new Promise((resolve, reject) => {
    const existing = Array.from(w.document.getElementsByTagName("script")).some((s) => s.src === src);
    if (existing) return resolve();
    const s = w.document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load checkout"));
    w.document.body.appendChild(s);
  });
}
document.getElementById("pay").addEventListener("click", pay);
</script>`;
}

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function dateLabel(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(+date) ? "" : dateFormatter.format(date);
}

function classLabel(student: { class: { name: string; section: string } }) {
  return `${student.class.name}-${student.class.section}`;
}

function paymentPeriod(rows: { title: string; period: string }[]) {
  if (!rows.length) return "No open invoices";
  if (rows.length === 1) return rows[0].title;
  const parsed = rows.map((row) => row.title.split(" · ").map((part) => part.trim()));
  const commonSuffix = parsed[0]?.[1] && parsed.every((parts) => parts[1] === parsed[0][1]) ? parsed[0][1] : "";
  if (commonSuffix && parsed.every((parts) => parts[0])) {
    return `${parsed[0][0]} to ${parsed[parsed.length - 1][0]} · ${commonSuffix}`;
  }
  return `${rows[0].title} to ${rows[rows.length - 1].title}`;
}

function contactLine(school: { phone: string; email: string }) {
  return [school.phone, school.email].filter(Boolean).join(" · ");
}

function parentLine(parent?: { user?: { name?: string | null; email?: string | null } | null; phone?: string | null } | null) {
  if (!parent) return "";
  return [parent.user?.name, parent.phone, parent.user?.email].filter(Boolean).join(" · ");
}

function schoolContext(opts: {
  school: ReturnType<typeof schoolFromConfig>;
  student: { name: string; admissionNo?: string; class: { name: string; section: string }; parent?: { user?: { name?: string | null; email?: string | null } | null; phone?: string | null } | null };
  period: string;
  gateway: string;
  embed: boolean;
}) {
  const schoolAddress = schoolLines(opts.school);
  const payer = parentLine(opts.student.parent);
  const contact = contactLine(opts.school);
  return `<section class="panel context">
    <div class="school-mark">${escapeHtml(opts.school.name.slice(0, 1).toUpperCase())}</div>
    <div class="eyebrow">${escapeHtml(opts.embed ? "School payment" : opts.school.affiliation || "School payment")}</div>
    <h1>${escapeHtml(opts.school.name)}</h1>
    ${schoolAddress.length ? `<p class="meta">${schoolAddress.map(escapeHtml).join("<br>")}</p>` : ""}
    <div class="info-grid">
      <div class="info">
        <span class="label">Paying for</span>
        <div class="value">${escapeHtml(opts.student.name)} · ${escapeHtml(classLabel(opts.student))}</div>
        ${opts.student.admissionNo ? `<div class="small">Admission no. ${escapeHtml(opts.student.admissionNo)}</div>` : ""}
      </div>
      ${payer ? `<div class="info"><span class="label">Billed to</span><div class="value">${escapeHtml(payer)}</div></div>` : ""}
      <div class="info"><span class="label">Payment period</span><div class="value">${escapeHtml(opts.period)}</div></div>
      ${contact ? `<div class="info"><span class="label">Need help?</span><div class="value">Contact school admin</div><div class="small">${escapeHtml(contact)}</div></div>` : ""}
    </div>
    <div class="trust">
      <div class="trust-item"><span class="dot">✓</span><span>Review every invoice before paying. The amount shown here is calculated from the school fee ledger.</span></div>
      <div class="trust-item"><span class="dot">✓</span><span>Payment opens through ${escapeHtml(opts.gateway)} and is verified before the receipt is shown.</span></div>
    </div>
  </section>`;
}

function invoiceCard(row: {
  title: string;
  dueDate: Date | string;
  dueNow: number;
  remaining: number;
  late: number;
  lateDays: number;
  paid: number;
  display: string;
  lines: { label: string; value: number }[];
  shareToken?: string | null;
}) {
  const overdue = row.lateDays > 0;
  const paid = row.display === "PAID";
  const statusClass = paid ? "paid" : overdue ? "overdue" : "";
  const status = paid ? "Paid" : overdue ? `Late by ${row.lateDays} days` : "Due";
  return `<article class="invoice">
    <div class="invoice-top">
      <div>
        <div class="invoice-title">${escapeHtml(row.title)}</div>
        <div class="small">Due ${escapeHtml(dateLabel(row.dueDate))}</div>
        <span class="status ${statusClass}">${escapeHtml(status)}</span>
      </div>
      <div class="amount">${escapeHtml(formatInr(row.dueNow))}</div>
    </div>
    <table class="line-table">
      <tbody>
        ${row.lines.map((l) => `<tr><td>${escapeHtml(l.label)}</td><td>${escapeHtml(formatInr(l.value))}</td></tr>`).join("")}
        ${row.paid > 0 ? `<tr><td>Already paid</td><td>-${escapeHtml(formatInr(row.paid))}</td></tr>` : ""}
        ${row.late > 0 ? `<tr><td>Late fee</td><td>${escapeHtml(formatInr(row.late))}</td></tr>` : ""}
        <tr><td><strong>Invoice payable</strong></td><td><strong>${escapeHtml(formatInr(row.dueNow))}</strong></td></tr>
      </tbody>
    </table>
    <div class="invoice-actions">
      <span class="small">Base balance ${escapeHtml(formatInr(row.remaining))}</span>
      ${row.shareToken ? `<a class="noprint" target="_blank" rel="noopener" href="/i/${escapeHtml(row.shareToken)}">View PDF</a>` : `<span class="small">PDF unavailable</span>`}
    </div>
  </article>`;
}

function paidReceiptBody(opts: {
  school: ReturnType<typeof schoolFromConfig>;
  student: { name: string; admissionNo?: string; class: { name: string; section: string }; parent?: { user?: { name?: string | null; email?: string | null } | null; phone?: string | null } | null };
  rows: { title: string; period: string; paid: number; shareToken?: string | null }[];
  totalPaid: number;
  receiptReference: string;
  pending: number;
  embed: boolean;
  gateway: string;
}) {
  return `<div class="checkout">
    ${schoolContext({ school: opts.school, student: opts.student, period: paymentPeriod(opts.rows), gateway: opts.gateway, embed: opts.embed })}
    <section class="panel summary">
      <div class="summary-head">
        <div class="eyebrow">Receipt</div>
        <h2>Payment received</h2>
        <p class="ok">The school ledger has recorded this payment.</p>
      </div>
      <div class="section">
        <div class="invoice-list">
          ${
            opts.rows
              .map(
                (m) => `<article class="invoice"><div class="invoice-top"><div><div class="invoice-title">${escapeHtml(m.title)}</div>${m.shareToken ? `<a class="noprint" target="_blank" rel="noopener" href="/i/${escapeHtml(m.shareToken)}">View PDF</a>` : ""}</div><div class="amount">${escapeHtml(formatInr(m.paid))}</div></div></article>`
              )
              .join("") || `<div class="empty">No payment is posted yet. Please refresh after the gateway confirms it.</div>`
          }
        </div>
      </div>
      <div class="paybox">
        ${opts.receiptReference ? `<p class="small">Reference ${escapeHtml(opts.receiptReference)}</p>` : ""}
        <div class="total-row"><span>Total paid</span><strong>${escapeHtml(formatInr(opts.totalPaid))}</strong></div>
        ${opts.pending > 0 ? `<p class="warn">${escapeHtml(formatInr(opts.pending))} is still pending.</p>` : `<p class="ok">Selected invoices are paid.</p>`}
      </div>
    </section>
  </div>`;
}

export async function renderPayPage(token: string, embed: boolean, paid: boolean) {
  const data = await getSharedInvoice(token);
  if (!data) return null;
  const school = schoolFromConfig(data.config);
  const inv = data.invoice;
  const balance = invoiceBalance(inv);
  const { dueNow } = balance;
  const pay = await getSchoolPaySecrets();
  const ready = gatewayReady(pay) && dueNow > 0;
  const bank = schoolBankLine(school);
  const lines = feeLineTotal(parseFeeLines(inv.linesJson)).rows;
  if (paid) {
    const activeReceiptHtml = await renderActivePaymentReceiptTemplateHtml(token);
    if (activeReceiptHtml) return activeReceiptHtml;
    const paidAmount = inv.payments.reduce((sum, payment) => sum + payment.amount, 0);
    return layout(
      `${school.name} · Receipt`,
      paidReceiptBody({
        school,
        student: inv.student,
        rows: [{ title: inv.title, period: inv.period || inv.id, paid: paidAmount, shareToken: token }],
        totalPaid: paidAmount,
        receiptReference: paymentReferenceBase([...inv.payments].sort((a, b) => +b.paidAt - +a.paidAt)[0]?.reference),
        pending: dueNow,
        embed,
        gateway: gatewayLabel(pay.gateway),
      })
    );
  }
  const body = `<div class="checkout">
    ${schoolContext({ school, student: inv.student, period: inv.title, gateway: gatewayLabel(pay.gateway), embed })}
    <section class="panel summary">
      <div class="summary-head">
        <div class="eyebrow">Invoice review</div>
        <h2>Check the bill before payment</h2>
        <p class="meta">Open the invoice PDF, confirm the fee lines, then continue to secure payment.</p>
      </div>
      <div class="section">
        <div class="invoice-list">
          ${invoiceCard({ ...balance, title: inv.title, dueDate: inv.dueDate, lines, shareToken: token })}
        </div>
      </div>
      <div class="paybox">
        <div class="total-row"><span>Total payable</span><strong>${escapeHtml(formatInr(dueNow))}</strong></div>
        ${bank ? `<p class="small">${escapeHtml(bank)}</p>` : ""}
        ${
          ready
            ? `<button id="pay">Pay ${escapeHtml(formatInr(dueNow))} securely</button><p class="small">Powered by ${escapeHtml(gatewayLabel(pay.gateway))}. You will return here after verification.</p><p id="err" class="err"></p>`
            : dueNow > 0
              ? `<p>Pay at the school desk, or ask the office to connect a gateway.</p>`
              : `<p class="ok">This bill is paid.</p>`
        }
      </div>
    </section>
  </div>
    ${
      ready
        ? checkoutScript({
            token,
            invoiceIds: [inv.id],
            schoolName: school.name,
            amountLabel: formatInr(dueNow),
            provider: pay.gateway,
          })
        : ""
    }
  `;
  return layout(`${school.name} · Pay`, body);
}

function paymentReferenceBase(reference?: string | null) {
  const value = String(reference || "").trim();
  if (!value) return "";
  return value.split(":")[0] || value;
}

function receiptNumber(reference: string | null | undefined, invoiceId: string) {
  return (paymentReferenceBase(reference) || `RCPT-${invoiceId.slice(-8)}`).toUpperCase();
}

export async function renderStudentPayPage(token: string, monthsRaw: string, embed: boolean, paid = false) {
  const data = await getStudentPay(token);
  if (!data) return null;
  const school = schoolFromConfig(data.config);
  const pay = await getSchoolPaySecrets();
  const wanted = new Set(monthsRaw.split(",").map((p) => p.trim()).filter(Boolean));
  const selected = data.student.feeInvoices
    .filter((inv) => !wanted.size || wanted.has(inv.period) || wanted.has(inv.id))
    .map((inv) => {
      const b = invoiceBalance(inv);
      const latestPayment = [...inv.payments].sort((a, b) => +b.paidAt - +a.paidAt)[0];
      return {
        id: inv.id,
        period: inv.period || inv.id,
        title: inv.title,
        amount: inv.amount,
        dueDate: inv.dueDate,
        dueNow: b.dueNow,
        remaining: b.remaining,
        late: b.late,
        lateDays: b.lateDays,
        lateLabel: b.lateLabel,
        paid: b.paid,
        display: b.display,
        lines: feeLineTotal(parseFeeLines(inv.linesJson)).rows,
        shareToken: inv.shareToken,
        latestReference: paymentReferenceBase(latestPayment?.reference),
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period) || a.title.localeCompare(b.title));
  const months = selected.filter((row) => row.dueNow > 0);
  const dueNow = months.reduce((n, m) => n + m.dueNow, 0);
  const canCombine = pay.gateway === "RAZORPAY" || months.length <= 1;
  const ready = gatewayReady(pay) && dueNow > 0 && canCombine;
  const bank = schoolBankLine(school);
  const references = [...new Set(selected.map((m) => m.latestReference).filter(Boolean))];
  const receiptReference = references.length === 1 ? references[0] : "";
  if (paid) {
    const paidRows = selected.filter((m) => m.display === "PAID" || m.paid > 0);
    const totalPaid = paidRows.reduce((sum, m) => sum + m.paid, 0);
    const body = paidReceiptBody({
      school,
      student: data.student,
      rows: paidRows,
      totalPaid,
      receiptReference,
      pending: dueNow,
      embed,
      gateway: gatewayLabel(pay.gateway),
    });
    return layout(`${school.name} · Receipt`, body);
  }
  const body = `<div class="checkout">
    ${schoolContext({ school, student: data.student, period: paymentPeriod(months), gateway: gatewayLabel(pay.gateway), embed })}
    <section class="panel summary">
      <div class="summary-head">
        <div class="eyebrow">Invoice review</div>
        <h2>${months.length > 1 ? "Selected invoices" : "Selected invoice"}</h2>
        <p class="meta">Check each invoice and open the PDF before making the payment.</p>
      </div>
      <div class="section">
        <div class="invoice-list">
          ${months.map((m) => invoiceCard(m)).join("") || `<div class="empty">Nothing due for the selected period.</div>`}
        </div>
      </div>
      <div class="paybox">
        ${months.length ? `<div class="total-row"><span>Total payable</span><strong>${escapeHtml(formatInr(dueNow))}</strong></div>` : ""}
        ${bank ? `<p class="small">${escapeHtml(bank)}</p>` : ""}
        ${
          ready
            ? `<button id="pay">Pay ${escapeHtml(formatInr(dueNow))} securely</button><p class="small">Powered by ${escapeHtml(gatewayLabel(pay.gateway))}. You will return here after verification.</p><p id="err" class="err"></p>`
            : dueNow > 0 && !canCombine
              ? `<p>Pick one invoice at a time for ${escapeHtml(gatewayLabel(pay.gateway))}, or ask the school to enable Razorpay for combined checkout.</p>`
            : dueNow > 0
              ? `<p>Pay at the school desk, or ask the office to connect a gateway.</p>`
              : `<p class="ok">Nothing due.</p>`
        }
      </div>
    </section>
  </div>
    ${
      ready
        ? checkoutScript({
            studentToken: token,
            invoiceIds: months.map((m) => m.id),
            schoolName: school.name,
            amountLabel: formatInr(dueNow),
            provider: pay.gateway,
          })
        : ""
    }
  `;
  return layout(`${school.name} · Pay`, body);
}

export async function renderInvoicePage(token: string) {
  const activeTemplateHtml = await renderActiveFeeInvoiceTemplateHtml(token);
  if (activeTemplateHtml) return activeTemplateHtml;
  const data = await getSharedInvoice(token);
  if (!data) return null;
  const school = schoolFromConfig(data.config);
  const dueNow = invoiceBalance(data.invoice).dueNow;
  const pay = await getSchoolPaySecrets();
  const payUrl = dueNow > 0 ? feePayUrl(token) : "";
  const via = dueNow > 0 && gatewayReady(pay) ? gatewayLabel(pay.gateway) : "";
  const inv = data.invoice;
  const lines = feeLineTotal(parseFeeLines(inv.linesJson)).rows;
  const latestPayment = [...inv.payments].sort((a, b) => +b.paidAt - +a.paidAt)[0];
  const receipt = latestPayment ? receiptNumber(latestPayment.reference, inv.id) : "";
  const body = `
    <p class="noprint"><button onclick="window.print()">Print</button></p>
    <h1>${escapeHtml(school.name)}</h1>
    <p>${escapeHtml(school.address || "")} ${escapeHtml(school.city || "")}</p>
    <p>${escapeHtml(inv.student.name)} · ${escapeHtml(inv.student.class.name)}-${escapeHtml(inv.student.class.section)}</p>
    <div class="card">
      <div class="row"><span>${escapeHtml(inv.title)}</span><strong>${escapeHtml(formatInr(inv.amount))}</strong></div>
      ${lines.map((l) => `<div class="row"><span>${escapeHtml(l.label)}</span><span>${escapeHtml(formatInr(l.value))}</span></div>`).join("")}
      <div class="row"><span>Due now</span><strong>${escapeHtml(formatInr(dueNow))}</strong></div>
      ${receipt ? `<div class="row"><span>Receipt no.</span><strong>${escapeHtml(receipt)}</strong></div>` : ""}
    </div>
    ${payUrl ? `<p class="noprint"><a href="${escapeHtml(payUrl)}">Pay${via ? " with " + escapeHtml(via) : ""}</a></p>` : `<p class="ok">Paid.</p>`}
  `;
  return layout(`${school.name} · Receipt`, body);
}
