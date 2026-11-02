/**
 * Private payment link page: /pay/<token>.
 * The admin portal creates the link with agreed pricing for one school; the school only fills basic
 * details and pays. The price is always worked out on the server from the link — nothing typed here
 * can change it, and the public website never shows coupon codes.
 */
import { marketingCss, marketingHead } from "./anekio-marketing";
import { getPaymentLink, getSitePricing } from "./saas-pricing";
import { quotePrice, validityLabel } from "./saas-quote";
import { prisma } from "./prisma";
import { nextSubscriptionPeriod } from "./saas-crm";

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const STATES = ["Andhra Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Odisha", "Punjab", "Rajasthan", "Tamil Nadu", "Telangana", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Other"];

const MARK = `<svg viewBox="0 30 200 142" aria-hidden="true" style="width:34px"><path d="M100 115C65 60 15 68 15 115c0 45 50 55 85 0Z" fill="none" stroke="#3B82F6" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/><path d="M100 115c35-55 85-47 85 0 0 45-50 55-85 0Z" fill="none" stroke="#22C55E" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/><circle cx="100" cy="75" r="10" fill="#60A5FA"/><path d="M80 110c10-20 20-22 20-22s10 2 20 22" fill="none" stroke="#60A5FA" stroke-width="9" stroke-linecap="round"/><circle cx="100" cy="40" r="5" fill="#4ADE80"/><circle cx="88" cy="52" r="4.5" fill="#4ADE80"/><circle cx="112" cy="52" r="4.5" fill="#4ADE80"/></svg>`;

/* Checkout layout modelled on hosted checkouts (Stripe / Razorpay): order summary on the left,
   one compact form on the right, everything inside one screen on desktop and phone.
   Trust comes from clarity — seller name, exact amount, line items, payment partner — not from the word "secure". */
const CSS = `<style>
html:has(body.paylink-page){background:#fff}
body.paylink-page{margin:0;background:#fff;color:var(--ink)}
body.paylink-page a{color:inherit;text-decoration:none}
.co{display:grid;grid-template-columns:1fr 1fr;min-height:100vh;min-height:100dvh}
.co-sum{position:relative;overflow:hidden;color:#fff;background:radial-gradient(70% 55% at 85% 0%,rgba(59,130,246,.35),transparent 70%),radial-gradient(50% 40% at 0% 100%,rgba(34,197,94,.14),transparent 70%),linear-gradient(165deg,#0a0f1c,#111b33);display:flex;justify-content:flex-end;align-items:center}
.co-pay{display:flex;justify-content:flex-start;align-items:center}
.co-in{width:100%;max-width:560px;padding:72px 64px;display:flex;flex-direction:column;box-sizing:border-box}
.co-pay .co-in{max-width:540px}
.co-sum .co-in{margin-left:auto}
.co-brand{display:inline-flex;align-items:center;gap:10px;font:600 22px/1 var(--font);letter-spacing:-.04em;color:inherit}
.co-sum .co-brand-desk{position:absolute;top:40px;left:max(64px,calc(100% - 496px))}
.co-label{margin:0 0 10px;font-size:16px;color:#9aa1ad}
.co-amount{font-size:56px;font-weight:600;letter-spacing:-.05em;line-height:1;margin:0;color:#fff}
.co-amount small{font-size:16px;font-weight:400;color:#9aa1ad;letter-spacing:0;margin-left:8px}
.co-wait{font-size:26px;font-weight:500;color:#cfd3da;letter-spacing:-.02em}
.co-valid{margin:14px 0 0;font-size:14px;color:#cfd3da}
.co-valid b{color:#fff;font-weight:600}
.co-items{margin:40px 0 0;padding:0;list-style:none}
.co-item{display:flex;justify-content:space-between;gap:16px;padding:18px 0;border-bottom:1px solid rgba(255,255,255,.09);font-size:15px}
.co-item b{display:block;font-weight:500;font-size:15px;color:#fff}
.co-item span{display:block;color:#9aa1ad;font-size:13px;margin-top:3px}
.co-item em{font-style:normal;font-weight:500;white-space:nowrap;color:#e6e8ec}
.co-total{display:flex;justify-content:space-between;padding:18px 0 0;font-size:17px;font-weight:600;color:#fff}
.co-note{margin:8px 0 0;font-size:13px;color:#8b919c}
.co-foot{position:absolute;bottom:32px;left:max(64px,calc(100% - 496px));display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:#8b919c}
.co-foot a:hover{color:#fff}
.co-h{font-size:26px;font-weight:600;letter-spacing:-.035em;margin:0 0 6px}
.co-sub{margin:0 0 28px;font-size:15px;color:var(--muted)}
.co-form{display:grid;gap:16px}
.co-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.co-form label{display:grid;gap:6px;font-size:13px;font-weight:500;color:var(--ink-2)}
.co-form input,.co-form select{height:48px;padding:0 12px;border:1px solid var(--line-2);border-radius:8px;font:400 15px var(--font);color:var(--ink);background:#fff;width:100%;box-sizing:border-box;box-shadow:0 1px 1px rgba(11,13,18,.03);transition:border-color .15s ease,box-shadow .15s ease}
.co-form input::placeholder{color:#a3a8b2}
.co-form input:focus,.co-form select:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(37,99,235,.15)}
.co-phone{position:relative}
.co-phone span{position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:15px;color:var(--ink-2);pointer-events:none}
.co-phone input{padding-left:46px}
.co-gst summary{list-style:none;cursor:pointer;font-size:13px;font-weight:500;color:var(--brand);width:max-content}
.co-gst summary::-webkit-details-marker{display:none}
.co-gst[open] summary{margin-bottom:8px}
.co-btn{height:54px;width:100%;margin-top:8px;border:0;border-radius:10px;background:var(--brand);color:#fff;font:600 16px var(--font);letter-spacing:-.01em;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.18),0 1px 2px rgba(11,13,18,.2);transition:background-color .15s ease}
.co-btn:hover{background:var(--brand-hover)}
.co-btn:disabled{opacity:.7;cursor:progress}
.co-methods{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:14px}
.co-methods span{font-size:11px;font-weight:600;letter-spacing:.02em;color:#5b6170;border:1px solid var(--line);border-radius:5px;padding:3px 7px;background:#fff}
.co-by{text-align:center;font-size:12px;color:var(--muted);margin:10px 0 0}
.co-by b{color:var(--ink-2);font-weight:600}
.co-ro{margin:0 0 6px;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.co-ro div{display:grid;grid-template-columns:120px 1fr;gap:12px;padding:14px 16px;border-top:1px solid var(--line)}
.co-ro div:first-child{border-top:0}
.co-ro dt{font-size:13px;color:var(--muted)}
.co-ro dd{margin:0;font-size:15px;font-weight:500;color:var(--ink)}
.co-ro dd span{display:block;font-size:13px;font-weight:400;color:var(--muted);margin-top:2px}
.co-form input.co-bad{border-color:#e5484d;box-shadow:0 0 0 3px rgba(229,72,77,.12)}
.co-error{border:1px solid #f2b8b5;background:#fff5f4;color:#842820;border-radius:8px;padding:10px 12px;font-size:14px}
.co-dead{max-width:480px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column;justify-content:center;text-align:center;padding:24px}
.co-dead svg{width:52px;margin:0 auto}
.co-dead h1{font-size:26px;letter-spacing:-.035em;margin:18px 0 8px}
.co-dead p{color:var(--muted);margin:0 0 22px}
@media(max-height:780px) and (min-width:861px){.co-in{padding-top:88px;padding-bottom:64px}.co-amount{font-size:46px}.co-items{margin-top:24px}.co-item{padding:12px 0}.co-form{gap:12px}.co-form input,.co-form select{height:44px}.co-sub{margin-bottom:18px}}
/* Phone: short summary on top, form, plan details folded underneath, Pay bar always visible at the bottom. */
@media(max-width:860px){
  html:has(body.paylink-page),body.paylink-page{background:#fff}
  .co{display:block;min-height:0}
  .co-sum{background:#fff;border:0;display:block;color:var(--ink);overflow:visible}
  .co-sub{display:none}
  .co-pay{display:block}
  .co-in,.co-sum .co-in{max-width:560px;margin:0 auto;padding:0 20px}
  .co-sum .co-in{padding-top:18px}
  .co-mtop{display:flex!important;align-items:center;justify-content:space-between}
  .co-mtop a.co-help{font-size:14px;font-weight:500;color:var(--muted)}
  .co-hero{margin-top:26px;padding:22px 20px;border-radius:18px;background:linear-gradient(160deg,#0b1220,#13213f);color:#fff;position:relative;overflow:hidden}
  .co-hero:after{content:"";position:absolute;right:-60px;top:-60px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(59,130,246,.45),transparent 70%)}
  .co-label{margin:0 0 8px;font-size:13px;color:#9aa1ad;position:relative;z-index:1}
  .co-label .co-desk-only{display:none}.co-label .co-mob-only{display:inline}
  .co-amount,.co-sum .co-mob{position:relative;z-index:1}
  .co-amount{font-size:40px;color:#fff}
  .co-amount small{color:#9aa1ad}
  .co-wait{color:#cfd3da}
  .co-sum .co-mob{display:block;font-size:14px;color:#cfd3da;margin-top:8px}
  .co-valid{position:relative;z-index:1;font-size:13px;margin-top:6px}
  .co-for{display:inline-flex!important;align-items:center;gap:6px;margin-top:16px;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);font-size:13px;color:#e6e8ec;position:relative;z-index:1}
  .co-items,.co-total,.co-note,.co-foot,.co-sum .co-brand-desk{display:none}
  .co-pay .co-in{padding-top:28px;padding-bottom:calc(120px + env(safe-area-inset-bottom))}
  .co-h{font-size:18px;margin:0 0 16px}
  .co-form{gap:16px}
  .co-row{grid-template-columns:1fr;gap:16px}
  .co-form label{font-size:14px;gap:7px}
  .co-form input,.co-form select{height:50px;font-size:16px;border-radius:12px;padding:0 14px;background:#fafbfc}
  .co-form input:focus,.co-form select:focus{background:#fff}
  .co-phone input{padding-left:50px}
  .co-phone span{left:14px;font-size:16px}
  .co-gst summary{font-size:14px;padding:2px 0}
  .co-form .co-paybar{display:block;position:fixed;left:0;right:0;bottom:0;z-index:20;padding:12px 16px calc(12px + env(safe-area-inset-bottom));background:rgba(255,255,255,.94);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-top:1px solid var(--line)}
  .co-btn{height:54px;font-size:17px;border-radius:14px;margin:0}
  .co-paybar .co-by{margin-top:8px;font-size:12px}
  .co-methods{margin-top:20px}
  .co-methods span{font-size:12px;padding:4px 8px}
  .co-mdetails{display:block!important;margin-top:24px;border:1px solid var(--line);border-radius:16px;overflow:hidden}
  .co-mdetails summary{list-style:none;display:flex;justify-content:space-between;align-items:center;padding:16px;font-size:15px;font-weight:500;cursor:pointer}
  .co-mdetails summary::-webkit-details-marker{display:none}
  .co-mdetails summary:after{content:"";width:8px;height:8px;border-right:1.6px solid var(--muted);border-bottom:1.6px solid var(--muted);transform:rotate(45deg);margin-top:-4px;transition:transform .2s ease}
  .co-mdetails[open] summary:after{transform:rotate(-135deg);margin-top:4px}
  .co-mdetails ul{list-style:none;margin:0;padding:0 16px 6px}
  .co-mdetails li{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-top:1px solid var(--line);font-size:14px}
  .co-mdetails li span{display:block;color:var(--muted);font-size:13px;margin-top:2px}
  .co-mdetails li em{font-style:normal;font-weight:500;white-space:nowrap}
  .co-pay .co-mfoot{display:flex;justify-content:center;gap:16px;flex-wrap:wrap;margin-top:24px;font-size:13px;color:var(--muted)}
}
.co-mfoot,.co-mtop,.co-mdetails,.co-for{display:none}
.co-paybar{display:contents}
.co-hero{display:block}
.co-mob-only{display:none}
.co-mob{display:none;font-size:13px;color:var(--muted);margin-top:4px}
</style>`;

const LOCK = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" style="vertical-align:-2px;margin-right:6px"><rect x="3" y="7" width="10" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;

function doc(title: string, body: string) {
  return `<!doctype html>
<html lang="en-IN"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex,nofollow" /><meta name="referrer" content="same-origin" /><link rel="icon" type="image/x-icon" href="/favicon.ico" />
<title>${esc(title)}</title>${marketingHead()}${marketingCss()}${CSS}
</head><body class="marketing-page paylink-page">
${body}
</body></html>`;
}

export async function paymentLinkHtml(token: string, message = "", values: Record<string, unknown> = {}) {
  const { link, problem } = await getPaymentLink(token);
  if (!link || problem) {
    return doc(
      "Payment link | Anekio",
      `<main class="co-dead">${MARK}<h1>${esc(problem || "This payment link is not valid.")}</h1><p>Please ask your Anekio contact for a new link, or write to us and we'll sort it out.</p><a class="btn primary" href="mailto:support@anekio.com">Email support@anekio.com</a></main>`
    );
  }
  const pricing = await getSitePricing();
  // Renewal links pay for an existing school: no sign-up form, the plan year is shown up front.
  const renewal = link.purpose === "RENEWAL";
  const org = renewal && link.orgId ? await prisma.saasOrg.findUnique({ where: { id: link.orgId } }) : null;
  if (renewal && !org) {
    return doc("Payment link | Anekio", `<main class="co-dead">${MARK}<h1>This renewal link is not linked to a school.</h1><p>Please ask your Anekio contact for a new link.</p><a class="btn primary" href="mailto:support@anekio.com">Email support@anekio.com</a></main>`);
  }
  // The link sells a plan: its price per student, minimum and validity (how long the school stays active).
  const planRow = link.planId ? await prisma.saasPlan.findUnique({ where: { id: link.planId } }) : null;
  const sell = planRow || { ...pricing, name: pricing.planName, validityMonths: 12 };
  // Free-trial plan: no payment — the link creates the school and its login straight away.
  const trial = Boolean(planRow && planRow.trialDays > 0);
  const trialDays = planRow?.trialDays || 0;
  const months = sell.validityMonths || 12;
  const dur = validityLabel(months);
  // Every link shows the exact dates the payment covers (new schools: from the day they pay).
  const period = await nextSubscriptionPeriod(renewal && org ? org.id : null, new Date(), months);
  const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  if (trial) period.renewsAt = new Date(period.startedAt.getTime() + trialDays * 86400000);
  const lastDay = day(new Date(period.renewsAt.getTime() - 86400000));
  const periodText = `${day(period.startedAt)} – ${lastDay}`;
  const periodNote = period.extendsCurrent ? "Starts when your current plan ends — no days lost" : renewal ? "Starts today" : trial ? "Starts as soon as your school is created" : "Starts the day you pay";
  const locked = link.students && link.students > 0 ? link.students : null;
  const fixed = link.kind === "FIXED";
  const students = locked || Number(values.studentCount) || 0;
  const q = quotePrice(sell, students, link);
  const rateShown = link.kind === "RATE" ? link.value : sell.perStudentMonthly;
  const known = Boolean(fixed || students);
  const v = (k: string) => esc(values[k] ?? (k === "schoolName" ? link.schoolName : ""));
  const plan = trial ? `Anekio full access · ${trialDays} days` : `Anekio ${esc(sell.name)} plan · ${dur}`;
  const itemDetail = fixed
    ? "Agreed yearly price"
    : link.kind === "RATE"
      ? `${students ? `${students.toLocaleString("en-IN")} students × ` : ""}₹${rateShown} per student / month × ${months}`
      : `${students ? `${students.toLocaleString("en-IN")} students × ` : ""}₹${rateShown} per student / month × ${months}${q.discount ? ` − ₹${q.discount.toLocaleString("en-IN")} discount` : ""}`;
  const mobLine = trial ? `All features · no payment needed` : fixed ? `${dur} · agreed price` : `${students ? `${students.toLocaleString("en-IN")} students · ` : ""}₹${rateShown}/student/month · ${dur}`;
  const amountHtml = trial ? `Free<small>for ${trialDays} days</small>` : known ? `${inr(q.total)}<small>for ${dur}</small>` : `<span class="co-wait">Enter your student count</span>`;
  const studentField = trial || locked || fixed ? "" : `<label>Number of students<input id="co-students" name="studentCount" type="number" min="1" required inputmode="numeric" value="${students || ""}" placeholder="e.g. 500"></label>`;
  const gstOpen = values.gstin ? " open" : "";
  const body = `<main class="co">
    <section class="co-sum"><div class="co-in">
      <a class="co-brand co-brand-desk" href="/">${MARK}<span>anekio</span></a>
      <div class="co-mtop"><a class="co-brand" href="/">${MARK}<span>anekio</span></a><a class="co-help" href="mailto:support@anekio.com">Help</a></div>
      <div class="co-hero">
        <p class="co-label"><span class="co-desk-only">${trial ? "Free trial" : renewal ? "Renew Anekio" : "Pay Anekio"} · for ${esc(link.schoolName)}</span><span class="co-mob-only">${trial ? `Free trial · ${trialDays} days` : `${renewal ? "Renewal" : "New subscription"} · Anekio ${esc(sell.name)} plan`}</span></p>
        <p class="co-amount" id="co-amount">${amountHtml}</p>
        <p class="co-mob" id="co-mob">${esc(mobLine)}</p>
        <p class="co-valid">${period.extendsCurrent ? `From ${esc(day(period.startedAt))} · ` : ""}Valid till <b>${esc(lastDay)}</b></p>
        <span class="co-for">For ${esc(link.schoolName)}</span>
      </div>
      <ul class="co-items">
        <li class="co-item"><div><b>${plan}</b><span id="co-detail">${trial ? "Admissions, fees, attendance, exams, routine and notices" : esc(itemDetail)}</span></div><em id="co-line">${trial ? "Free" : known ? inr(q.total) : "—"}</em></li>
        <li class="co-item"><div><b>${trial ? "Trial period" : renewal ? "Renewal period" : "Subscription period"}</b><span>${esc(periodNote)}</span></div><em>${esc(periodText)}</em></li>
        ${renewal ? "" : `<li class="co-item"><div><b>Setup and onboarding</b><span>School setup, data import and staff training</span></div><em>Included</em></li>`}
        <li class="co-item"><div><b>Parent and teacher Android app</b><span>Unlimited parents and staff</span></div><em>Included</em></li>
      </ul>
      <div class="co-total"><span>${trial ? "To pay" : "Total due today"}</span><span id="co-total">${trial ? "₹0" : known ? inr(q.total) : "—"}</span></div>
      <p class="co-note" id="co-note">${trial ? "No card or payment details needed." : `${!fixed && known && q.usedMinimum ? `Minimum ${inr(q.minimumYearly)} a year applies. ` : ""}GST, if applicable, is added at payment.`}</p>
      <div class="co-foot"><span>Sold by Anekio</span><a href="/privacy">Privacy</a><a href="mailto:support@anekio.com">support@anekio.com</a></div>
    </div></section>
    <section class="co-pay"><div class="co-in">
      <h1 class="co-h">${trial ? "Create your school" : renewal ? "Renew your plan" : "Billing details"}</h1>
      <p class="co-sub">${trial ? `Free for ${trialDays} days. We'll email you a link to set your password.` : renewal ? "Your Anekio access continues without a break." : "For your invoice and to set up your school."}</p>
      <form class="co-form" method="post" action="/api/saas/payment/order" id="co-form">
        ${message ? `<div class="co-error" role="alert">${esc(message)}</div>` : ""}
        <input type="hidden" name="link" value="${esc(link.code)}">
        ${renewal && org ? `<dl class="co-ro">
          <div><dt>School</dt><dd>${esc(org.schoolName)}</dd></div>
          <div><dt>Billed to</dt><dd>${esc(org.ownerName)}<span>${esc([org.ownerEmail, org.ownerPhone].filter(Boolean).join(" · "))}</span></dd></div>
          <div><dt>Renewal period</dt><dd>${esc(periodText)}<span>${esc(periodNote)}</span></dd></div>
          <div><dt>Students</dt><dd>${locked ? locked.toLocaleString("en-IN") : "—"}</dd></div>
        </dl>` : `${studentField}
        <div class="co-row"><label>Email<input name="ownerEmail" type="email" required autocomplete="email" value="${v("ownerEmail")}" placeholder="owner@school.in"></label>
        <label>Phone<div class="co-phone"><span aria-hidden="true">+91</span><input type="hidden" name="ownerCountryCode" value="+91"><input name="ownerPhone" required inputmode="tel" autocomplete="tel-national" maxlength="14" aria-label="Phone number (+91)" value="${v("ownerPhone")}" placeholder="98765 43210"></div></label></div>
        <div class="co-row"><label>Your name<input name="ownerName" required autocomplete="name" value="${v("ownerName")}" placeholder="Principal / Owner"></label>
        <label>School name<input name="schoolName" required autocomplete="organization" value="${v("schoolName")}"></label></div>
        <div class="co-row"><label>City<input name="city" required autocomplete="address-level2" value="${v("city")}" placeholder="Bengaluru"></label>
        <label>State<select name="state" required autocomplete="address-level1"><option value="">Select</option>${STATES.map((st) => `<option${values.state === st ? " selected" : ""}>${st}</option>`).join("")}</select></label></div>
        `}
        ${renewal ? "" : `<details class="co-gst"${gstOpen}><summary>+ Add GSTIN for a GST invoice</summary><label>GSTIN<input name="gstin" maxlength="15" value="${v("gstin")}" placeholder="29ABCDE1234F1Z5" style="text-transform:uppercase"></label></details>`}
        <div class="co-paybar"><button class="co-btn" type="submit" id="co-btn">${trial ? "" : LOCK}<span id="co-btn-text">${trial ? "Create my school" : known ? `Pay ${inr(q.total)}` : "Continue to payment"}</span></button><p class="co-by">${trial ? "No card or payment needed" : "Payments processed by <b>Razorpay</b>"}</p></div>
        ${trial ? "" : `<div class="co-methods" aria-label="Payment methods"><span>UPI</span><span>RuPay</span><span>VISA</span><span>Mastercard</span><span>Net banking</span></div>`}
        <details class="co-mdetails"><summary>What's included</summary><ul>
          <li><div>${plan}<span id="co-mdetail">${trial ? "All features" : esc(itemDetail)}</span></div><em id="co-mline">${trial ? "Free" : known ? inr(q.total) : "—"}</em></li>
          <li><div>${trial ? "Trial period" : renewal ? "Renewal period" : "Subscription period"}<span>${esc(periodNote)}</span></div><em>${esc(periodText)}</em></li>
          ${renewal ? "" : `<li><div>Setup and onboarding<span>School setup, data import and staff training</span></div><em>Included</em></li>`}
          <li><div>Parent and teacher Android app<span>Unlimited parents and staff</span></div><em>Included</em></li>
          <li><div><b>${trial ? "To pay" : "Total due today"}</b><span>${trial ? "No payment needed" : "GST, if applicable, is added at payment"}</span></div><em id="co-mtotal">${trial ? "₹0" : known ? inr(q.total) : "—"}</em></li>
        </ul></details>
        <div class="co-mfoot"><span>Sold by Anekio</span><a href="/privacy">Privacy</a><a href="mailto:support@anekio.com">support@anekio.com</a></div>
      </form>
    </div></section>
  </main>
  <script>
  (function () {
    var form = document.getElementById("co-form"), btn = document.getElementById("co-btn"), text = document.getElementById("co-btn-text");
    var idle = text.textContent;
    function esc(v) { return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function showError(msg) {
      var box = form.querySelector(".co-error");
      if (!box) { box = document.createElement("div"); box.className = "co-error"; box.setAttribute("role", "alert"); form.insertBefore(box, form.firstChild.nextSibling); }
      box.textContent = msg; btn.disabled = false; text.textContent = idle;
    }
    function loadCheckout() {
      return new Promise(function (resolve, reject) {
        if (window.Razorpay) return resolve();
        var sc = document.createElement("script"); sc.src = "https://checkout.razorpay.com/v1/checkout.js";
        sc.onload = function () { resolve(); }; sc.onerror = function () { reject(new Error("The payment window could not load. Check your connection and try again.")); };
        document.head.appendChild(sc);
      });
    }
    function done(order, paymentId) {
      var pane = document.querySelector(".co-pay .co-in");
      pane.innerHTML = '<div style="margin:auto 0;text-align:center"><div style="width:56px;height:56px;border-radius:50%;background:#e8f7ee;color:#16a34a;display:grid;place-items:center;margin:0 auto 18px"><svg viewBox="0 0 16 16" width="26" height="26"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>'
        + '<h1 class="co-h" style="font-size:24px;margin-bottom:8px">Payment received</h1>'
        + '<p style="color:var(--muted);margin:0 0 20px;line-height:1.6">₹' + Number(order.amount).toLocaleString("en-IN") + ' paid for ' + esc(order.org.schoolName) + '. A receipt is on its way to ' + esc(order.org.ownerEmail) + '.<br>Your plan is active till ${esc(lastDay)}.<br>${renewal ? "Thank you for renewing — nothing else to do." : "Our team will call you within one working day to set up your school."}</p>'
        + '<p style="font-size:12px;color:var(--muted);margin:0">Payment ID ' + esc(paymentId) + '</p></div>';
    }
    var TRIAL = ${trial ? "true" : "false"};
    form.addEventListener("submit", function (e) {
      if (TRIAL) {
        e.preventDefault();
        if (!form.reportValidity()) return;
        btn.disabled = true; text.textContent = "Creating your school…";
        var data = {}; new FormData(form).forEach(function (v, k) { data[k] = v; });
        fetch("/api/saas/paylink-trial", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data) })
          .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.ok) throw new Error(d.error || "Could not create the school."); return d; }); })
          .then(function (d) {
            var ends = d.trialEnds ? new Date(d.trialEnds).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
            document.querySelector(".co-pay .co-in").innerHTML = '<div style="margin:auto 0;text-align:center"><div style="width:56px;height:56px;border-radius:50%;background:#e8f7ee;color:#16a34a;display:grid;place-items:center;margin:0 auto 18px"><svg viewBox="0 0 16 16" width="26" height="26"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>'
              + '<h1 class="co-h" style="font-size:24px;margin-bottom:8px">' + esc(d.schoolName) + ' is ready</h1>'
              + '<p style="color:var(--muted);margin:0 0 22px;line-height:1.6">A link to set your password is on its way to ' + esc(d.ownerEmail) + '.' + (d.login ? '<br>Then sign in with <b style="color:var(--ink)">' + esc(d.login) + '</b>.' : '') + (ends ? '<br>Your free trial runs till ' + esc(ends) + '.' : '') + '</p>'
              + '<a class="co-btn" style="display:grid;place-items:center;text-decoration:none;color:#fff" href="' + esc(d.loginUrl) + '">Open Anekio</a></div>';
          })
          .catch(function (err) { showError(err.message || "Could not create the school."); });
        return;
      }
      if (!window.fetch || !window.Promise) return; // plain form post still works
      e.preventDefault();
      if (!form.reportValidity()) return;
      btn.disabled = true; text.textContent = "Opening payment…";
      var body = new URLSearchParams(new FormData(form));
      Promise.all([
        fetch(form.action, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: body }).then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.ok) throw new Error(d.error || "Could not start the payment."); return d.order; }); }),
        loadCheckout()
      ]).then(function (res) {
        var order = res[0];
        var rz = new window.Razorpay({
          key: order.keyId, amount: order.amountPaise, currency: "INR", name: "Anekio", description: order.planName + " plan · ${dur}", order_id: order.orderId,
          prefill: { name: order.org.ownerName, email: order.org.ownerEmail, contact: order.org.ownerPhone },
          notes: { school: order.org.schoolName }, theme: { color: "#2563eb" },
          handler: function (resp) {
            text.textContent = "Confirming payment…";
            fetch("/api/saas/payment/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId: order.org.id, amount: order.amount, razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }) })
              .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "We could not confirm the payment."); }); })
              .then(function () { done(order, resp.razorpay_payment_id); })
              .catch(function (err) { showError((err.message || "We could not confirm the payment.") + " If money was deducted, write to support@anekio.com with payment ID " + resp.razorpay_payment_id + "."); });
          },
          modal: { ondismiss: function () { btn.disabled = false; text.textContent = idle; } }
        });
        rz.open();
      }).catch(function (err) { showError(err.message || "Could not start the payment."); });
    });
    // New school: warn as soon as the email / phone is already registered (the server checks again on Pay).
    var emailIn = form.querySelector("[name=ownerEmail]"), phoneIn = form.querySelector("[name=ownerPhone]"), ct = null, cseq = 0;
    function contactCheck() {
      if (!emailIn || !phoneIn) return;
      var e = emailIn.value.trim(), p = phoneIn.value.replace(/[^0-9]/g, ""), s = ++cseq;
      if (!(e.indexOf("@") > 0) && p.length < 10) return;
      fetch("/api/saas/paylink-contact", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ link: ${JSON.stringify(link.code)}, ownerEmail: e.indexOf("@") > 0 ? e : "", ownerPhone: p.length >= 10 ? p : "" }) })
        .then(function (r) { return r.json(); }).then(function (out) {
          if (s !== cseq || !out) return;
          var taken = out.taken || [];
          emailIn.setCustomValidity(taken.indexOf("email") >= 0 ? out.message : "");
          phoneIn.setCustomValidity(taken.indexOf("phone") >= 0 ? out.message : "");
          emailIn.classList.toggle("co-bad", taken.indexOf("email") >= 0); phoneIn.classList.toggle("co-bad", taken.indexOf("phone") >= 0);
          var box = form.querySelector(".co-taken");
          if (taken.length) { if (!box) { box = document.createElement("div"); box.className = "co-error co-taken"; box.setAttribute("role", "alert"); emailIn.closest(".co-row").insertAdjacentElement("afterend", box); } box.textContent = out.message; }
          else if (box) box.remove();
        }).catch(function () {});
    }
    if (emailIn && phoneIn) [emailIn, phoneIn].forEach(function (el) { el.addEventListener("blur", contactCheck); el.addEventListener("input", function () { el.setCustomValidity(""); clearTimeout(ct); ct = setTimeout(contactCheck, 600); }); });
    var input = document.getElementById("co-students");
    if (!input) return;
    var token = ${JSON.stringify(link.code)}, rate = ${JSON.stringify(rateShown)}, t = null, seq = 0;
    function inr(n) { return "₹" + Number(n || 0).toLocaleString("en-IN"); }
    function set(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
    function refresh() {
      var n = Math.floor(Number(input.value) || 0), s = ++seq;
      if (n < 1) { set("co-amount", "<span class='co-wait'>Enter your student count</span>"); set("co-line", "—"); set("co-total", "—"); text.textContent = idle = "Continue to payment"; return; }
      fetch("/api/saas/paylink-quote", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ link: token, students: n }) })
        .then(function (r) { return r.json(); }).then(function (out) {
          if (s !== seq || !out || !out.ok) return;
          var q = out.quote, k = n.toLocaleString("en-IN");
          set("co-amount", inr(q.total) + "<small>for ${dur}</small>");
          set("co-line", inr(q.total)); set("co-total", inr(q.total)); set("co-mline", inr(q.total)); set("co-mtotal", inr(q.total));
          var line = k + " students × ₹" + rate + " per student / month × ${months}";
          set("co-mdetail", line); set("co-detail", line);
          set("co-mob", k + " students · ₹" + rate + "/student/month · ${dur}");
          set("co-note", (q.usedMinimum ? "Minimum " + inr(q.minimumYearly) + " a year applies. " : "") + "GST, if applicable, is added at payment.");
          text.textContent = idle = "Pay " + inr(q.total);
        }).catch(function () {});
    }
    input.addEventListener("input", function () { clearTimeout(t); t = setTimeout(refresh, 250); });
  })();
  </script>`;
  return doc(`${trial ? "Free trial" : "Pay Anekio"} · ${link.schoolName}`, body);
}
