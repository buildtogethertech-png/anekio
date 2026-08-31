import { getSharedInvoice, getStudentPay } from "../lib/pay-public";
import { feeLineTotal, invoiceBalance, parseFeeLines } from "../lib/fees";
import { gatewayLabel, gatewayReady, getSchoolPaySecrets } from "../lib/pay-config";
import { schoolBankLine, schoolFromConfig } from "../lib/school";
import { feePayUrl, formatInr } from "../lib/utils";

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
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f6f3ee; color: #142033; }
    main { max-width: 32rem; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
    h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
    p { color: #3d4f66; line-height: 1.45; }
    .card { background: #fff; border: 1px solid #d9e0ea; border-radius: 10px; padding: 1rem 1.1rem; margin: .75rem 0; }
    .row { display: flex; justify-content: space-between; gap: 1rem; margin: .35rem 0; }
    button { width: 100%; border: 0; background: #1d4ed8; color: #fff; border-radius: 8px; padding: .85rem 1rem; font-size: 1rem; }
    button[disabled] { opacity: .6; }
    .err { color: #b42318; font-size: .85rem; }
    .ok { color: #067647; }
    @media print { button, .noprint { display: none; } body { background: #fff; } }
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

export async function renderPayPage(token: string, embed: boolean, paid: boolean) {
  const data = await getSharedInvoice(token);
  if (!data) return null;
  const school = schoolFromConfig(data.config);
  const inv = data.invoice;
  const { dueNow, lateLabel } = invoiceBalance(inv);
  const pay = await getSchoolPaySecrets();
  const ready = gatewayReady(pay) && dueNow > 0;
  const bank = schoolBankLine(school);
  const lines = feeLineTotal(parseFeeLines(inv.linesJson)).rows;
  const body = `
    <p class="noprint">${embed ? `<a href="/fees">Back to Anekio</a>` : escapeHtml(school.affiliation || "")}</p>
    <h1>${escapeHtml(school.name)}</h1>
    <p>${escapeHtml(inv.student.name)} · ${escapeHtml(inv.student.class.name)}-${escapeHtml(inv.student.class.section)}</p>
    ${paid ? `<p class="ok">Payment received.</p>` : ""}
    <div class="card">
      <div class="row"><span>${escapeHtml(inv.title)}</span><strong>${escapeHtml(formatInr(dueNow))}</strong></div>
      ${lateLabel ? `<p>${escapeHtml(lateLabel)}</p>` : ""}
      ${lines.map((l) => `<div class="row"><span>${escapeHtml(l.label)}</span><span>${escapeHtml(formatInr(l.value))}</span></div>`).join("")}
    </div>
    ${bank ? `<p>${escapeHtml(bank)}</p>` : ""}
    ${
      ready
        ? `<button id="pay">Pay ${escapeHtml(formatInr(dueNow))} with ${escapeHtml(gatewayLabel(pay.gateway))}</button><p id="err" class="err"></p>`
        : dueNow > 0
          ? `<p>Pay at the school desk, or ask the office to connect a gateway.</p>`
          : `<p class="ok">This bill is paid.</p>`
    }
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

export async function renderStudentPayPage(token: string, monthsRaw: string, embed: boolean, paid = false) {
  const data = await getStudentPay(token);
  if (!data) return null;
  const school = schoolFromConfig(data.config);
  const pay = await getSchoolPaySecrets();
  const wanted = new Set(monthsRaw.split(",").map((p) => p.trim()).filter(Boolean));
  const months = data.student.feeInvoices
    .filter((inv) => !wanted.size || wanted.has(inv.period) || wanted.has(inv.id))
    .map((inv) => {
      const b = invoiceBalance(inv);
      return { id: inv.id, title: inv.title, dueNow: b.dueNow, lateLabel: b.lateLabel };
    })
    .filter((row) => row.dueNow > 0);
  const dueNow = months.reduce((n, m) => n + m.dueNow, 0);
  const ready = gatewayReady(pay) && dueNow > 0;
  const bank = schoolBankLine(school);
  const body = `
    <p class="noprint">${embed ? `<a href="/fees">Back to Anekio</a>` : escapeHtml(school.affiliation || "")}</p>
    <h1>${escapeHtml(school.name)}</h1>
    <p>${escapeHtml(data.student.name)} · ${escapeHtml(data.student.class.name)}-${escapeHtml(data.student.class.section)}</p>
    ${paid ? `<p class="ok">Payment received.</p>` : ""}
    <div class="card">
      ${months.map((m) => `<div class="row"><span>${escapeHtml(m.title)}${m.lateLabel ? " · " + escapeHtml(m.lateLabel) : ""}</span><strong>${escapeHtml(formatInr(m.dueNow))}</strong></div>`).join("") || "<p>Nothing due.</p>"}
      ${months.length ? `<div class="row"><span>Total</span><strong>${escapeHtml(formatInr(dueNow))}</strong></div>` : ""}
    </div>
    ${bank ? `<p>${escapeHtml(bank)}</p>` : ""}
    ${
      ready
        ? `<button id="pay">Pay ${escapeHtml(formatInr(dueNow))} with ${escapeHtml(gatewayLabel(pay.gateway))}</button><p id="err" class="err"></p>`
        : dueNow > 0
          ? `<p>Pay at the school desk, or ask the office to connect a gateway.</p>`
          : `<p class="ok">Nothing due.</p>`
    }
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
  const data = await getSharedInvoice(token);
  if (!data) return null;
  const school = schoolFromConfig(data.config);
  const dueNow = invoiceBalance(data.invoice).dueNow;
  const pay = await getSchoolPaySecrets();
  const payUrl = dueNow > 0 ? feePayUrl(token) : "";
  const via = dueNow > 0 && gatewayReady(pay) ? gatewayLabel(pay.gateway) : "";
  const inv = data.invoice;
  const lines = feeLineTotal(parseFeeLines(inv.linesJson)).rows;
  const body = `
    <p class="noprint"><button onclick="window.print()">Print</button></p>
    <h1>${escapeHtml(school.name)}</h1>
    <p>${escapeHtml(school.address || "")} ${escapeHtml(school.city || "")}</p>
    <p>${escapeHtml(inv.student.name)} · ${escapeHtml(inv.student.class.name)}-${escapeHtml(inv.student.class.section)}</p>
    <div class="card">
      <div class="row"><span>${escapeHtml(inv.title)}</span><strong>${escapeHtml(formatInr(inv.amount))}</strong></div>
      ${lines.map((l) => `<div class="row"><span>${escapeHtml(l.label)}</span><span>${escapeHtml(formatInr(l.value))}</span></div>`).join("")}
      <div class="row"><span>Due now</span><strong>${escapeHtml(formatInr(dueNow))}</strong></div>
    </div>
    ${payUrl ? `<p class="noprint"><a href="${escapeHtml(payUrl)}">Pay${via ? " with " + escapeHtml(via) : ""}</a></p>` : `<p class="ok">Paid.</p>`}
  `;
  return layout(`${school.name} · Receipt`, body);
}
