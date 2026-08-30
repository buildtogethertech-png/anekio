import Razorpay from "razorpay";
import { prisma } from "./prisma";

const PRODUCT_NAME = "Cultivate School";
const MONTHLY_PRICE = 1000;

type EnquiryInput = {
  schoolName?: unknown;
  ownerName?: unknown;
  ownerEmail?: unknown;
  ownerPhone?: unknown;
  city?: unknown;
  teacherCount?: unknown;
  studentCount?: unknown;
  notes?: unknown;
};

type OrgUpdateInput = Partial<{
  schoolName: unknown;
  ownerName: unknown;
  ownerEmail: unknown;
  ownerPhone: unknown;
  city: unknown;
  teacherCount: unknown;
  studentCount: unknown;
  plan: unknown;
  monthlyPrice: unknown;
  paymentStatus: unknown;
  subscriptionStatus: unknown;
  loginUrl: unknown;
  apiUrl: unknown;
  notes: unknown;
  followUpStatus: unknown;
  razorpayCustomerId: unknown;
}>;

function text(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function intOrNull(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pageUrl(path = "/") {
  const base = (process.env.CULTIVATE_PUBLIC_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || "").replace(/\/$/, "");
  if (!base) return path;
  const origin = base.startsWith("http") ? base : `https://${base}`;
  return `${origin}${path}`;
}

function adminUrl() {
  const configured = (process.env.CULTIVATE_ADMIN_URL || "").trim();
  if (configured) return configured;
  const publicUrl = pageUrl("/");
  if (!publicUrl.startsWith("http")) return "/cultivate-admin";
  try {
    const url = new URL(publicUrl);
    const parts = url.hostname.split(".");
    if (parts.length >= 2) {
      url.hostname = ["admin", ...parts.slice(parts[0] === "www" ? 1 : 0)].join(".");
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.toString();
    }
  } catch {
    return "/cultivate-admin";
  }
  return "/cultivate-admin";
}

function shell(title: string, description: string, body: string, extraHead = "") {
  return `<!doctype html>
<html lang="en-IN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="canonical" href="${escapeHtml(pageUrl("/"))}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(pageUrl("/"))}" />
  <meta name="twitter:card" content="summary_large_image" />
  ${extraHead}
  <style>
    :root{color-scheme:light;--ink:#0f2542;--muted:#52657d;--blue:#2454e6;--soft:#eef5ff;--line:#d9e3f2;--green:#15803d;--orange:#b45309}
    *{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f9fe;color:var(--ink);line-height:1.5}
    a{color:inherit;text-decoration:none}.wrap{width:min(1120px,calc(100% - 32px));margin:0 auto}.nav{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.9);backdrop-filter:blur(18px);border-bottom:1px solid var(--line)}
    .nav .wrap{height:68px;display:flex;align-items:center;justify-content:space-between}.brand{font-size:22px;font-weight:900;letter-spacing:-.03em}.brand span{display:block;font-size:13px;color:var(--blue);letter-spacing:0;font-weight:800}
    .navlinks{display:flex;align-items:center;gap:18px;color:#334761;font-weight:800}.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:14px;border:1px solid #bcd0ee;padding:12px 18px;font-weight:900;background:white;cursor:pointer}
    .btn.primary{background:var(--blue);border-color:var(--blue);color:white;box-shadow:0 12px 28px rgba(36,84,230,.22)}.btn.orange{color:#9a3412;border-color:#fed7aa;background:#fff7ed}
    .hero{padding:76px 0 42px}.hero-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:34px;align-items:center}.eyebrow{color:var(--blue);font-weight:900;text-transform:uppercase;letter-spacing:.14em;font-size:13px}
    h1{font-size:58px;line-height:1.02;letter-spacing:-.055em;margin:12px 0 18px}.lead{font-size:21px;color:var(--muted);max-width:700px}.cta{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}
    .hero-card{background:white;border:1px solid var(--line);border-radius:28px;padding:24px;box-shadow:0 24px 60px rgba(15,37,66,.08)}.screen{border:1px solid var(--line);border-radius:22px;overflow:hidden;background:#fff}
    .screen-head{padding:14px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;font-weight:900}.ticket{padding:16px;border-bottom:1px solid #e9eff8}.ticket small,.muted{color:var(--muted)}
    .chips{display:flex;gap:8px;flex-wrap:wrap}.chip{border:1px solid #cfe0f8;background:#f8fbff;border-radius:999px;padding:6px 10px;font-weight:800;font-size:13px}.sections{padding:34px 0 70px}.section-title{font-size:34px;letter-spacing:-.035em;margin:0 0 10px}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{background:white;border:1px solid var(--line);border-radius:22px;padding:22px}.card h3{margin:0 0 8px;font-size:20px}.price{font-size:50px;font-weight:950;letter-spacing:-.06em}
    .form{display:grid;gap:12px}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{font-weight:850;color:#3b4f68;font-size:14px}input,select,textarea{width:100%;border:1px solid #c9d8ec;border-radius:14px;padding:13px 14px;font:inherit;background:white;color:var(--ink)}textarea{min-height:110px}
    .admin{padding:38px 0 70px}.table{width:100%;border-collapse:separate;border-spacing:0;background:white;border:1px solid var(--line);border-radius:18px;overflow:hidden}.table th,.table td{padding:12px;border-bottom:1px solid #edf2fa;text-align:left;vertical-align:top}.table th{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#52657d;background:#f8fbff}.badge{display:inline-block;border-radius:999px;padding:4px 8px;background:#eaf2ff;color:#174ea6;font-weight:900;font-size:12px}
    .admin-card{background:white;border:1px solid var(--line);border-radius:20px;padding:18px;margin-top:18px}.fine{font-size:13px;color:var(--muted)}footer{border-top:1px solid var(--line);padding:26px 0;color:var(--muted);background:white}
    @media(max-width:850px){.hero-grid,.grid,.two{grid-template-columns:1fr}.navlinks{display:none}h1{font-size:42px}.hero{padding-top:44px}.table{font-size:14px}}
  </style>
</head>
<body>${body}</body>
</html>`;
}

export function marketingHtml(message = "") {
  const title = "Cultivate School | School management software for small Indian schools";
  const description =
    "Cultivate School helps small Indian schools manage admissions, fees, attendance, exams, documents, parent tickets, teachers, and school communication for ₹1000 per month.";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: PRODUCT_NAME,
    applicationCategory: "School management software",
    operatingSystem: "Web, Android, iOS",
    offers: { "@type": "Offer", price: "1000", priceCurrency: "INR", availability: "https://schema.org/InStock" },
    audience: { "@type": "EducationalAudience", educationalRole: "School administrator" },
    description,
  };
  return shell(
    title,
    description,
    `<nav class="nav"><div class="wrap"><a class="brand" href="/">Cultivate<span>India first school OS</span></a><div class="navlinks"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#enquiry">Enquire</a><a class="btn" href="${escapeHtml(adminUrl())}">Admin</a></div></div></nav>
<main>
  <section class="hero wrap">
    <div class="hero-grid">
      <div>
        <div class="eyebrow">Built for small schools with 60–70 teachers</div>
        <h1>Run your school office without ten different tools.</h1>
        <p class="lead">Cultivate School brings fees, admissions, attendance, exams, documents, parent requests, teacher work, and school communication into one simple product.</p>
        <div class="cta"><a class="btn primary" href="#enquiry">Book a demo</a><a class="btn" href="#pricing">See ₹${MONTHLY_PRICE}/month plan</a></div>
        ${message ? `<p class="card" style="margin-top:18px;border-color:#bbf7d0;color:#166534">${escapeHtml(message)}</p>` : ""}
      </div>
      <div class="hero-card" aria-label="Product preview">
        <div class="screen">
          <div class="screen-head"><span>Parent request inbox</span><span class="badge">REQ-1042</span></div>
          <div class="ticket"><strong>Aisha Sharma</strong><br><small>Parent: Meera Sharma · Admit card blocked</small></div>
          <div class="ticket"><strong>Office replied</strong><br><small>Assigned to class teacher with @mention and full timeline.</small></div>
          <div class="ticket"><strong>Closed with history</strong><br><small>Every reply, note, status change and follow-up stays in one ticket.</small></div>
        </div>
      </div>
    </div>
  </section>
  <section id="features" class="sections wrap">
    <h2 class="section-title">Everything a growing school needs</h2>
    <p class="lead">One app for office, teachers, parents, and students — designed around Indian school workflows.</p>
    <div class="grid" style="margin-top:22px">
      ${[
        ["Fees & payment links", "Invoices, parent pay links, receipts, fee status, and online collection workflows."],
        ["Admissions CRM", "Capture enquiries, update stages, record follow-ups, and keep every lead history clean."],
        ["Parent request tickets", "Mail-style query inbox with ticket numbers, staff @mentions, replies, notes, and closures."],
        ["Attendance & leave", "Class attendance, staff leave, approvals, substitute planning, and notifications."],
        ["Exams & documents", "Exam setup, marks, report cards, certificates, admit cards, and verification links."],
        ["Roles & school control", "Office, teacher, parent, and student portals with permissions built for real teams."],
      ]
        .map(([head, copy]) => `<article class="card"><h3>${head}</h3><p class="muted">${copy}</p></article>`)
        .join("")}
    </div>
  </section>
  <section id="pricing" class="sections wrap" style="padding-top:0">
    <div class="card">
      <div class="two" style="align-items:center">
        <div>
          <div class="eyebrow">Simple pricing</div>
          <h2 class="section-title">₹${MONTHLY_PRICE}/month per school</h2>
          <p class="lead">For small schools that want a serious system without enterprise pricing. Setup and onboarding can be handled after enquiry.</p>
          <div class="chips"><span class="chip">Unlimited core modules</span><span class="chip">School staff onboarding</span><span class="chip">Web + mobile-ready</span></div>
        </div>
        <form class="form" method="post" action="/api/saas/razorpay/order">
          <input type="hidden" name="schoolName" value="New school subscription" />
          <button class="btn primary" type="submit">Start Razorpay payment</button>
          <p class="fine">If payment keys are not configured yet, use the enquiry form and collect payment manually.</p>
        </form>
      </div>
    </div>
  </section>
  <section id="enquiry" class="sections wrap" style="padding-top:0">
    <div class="card">
      <h2 class="section-title">Enquire for your school</h2>
      <form class="form" method="post" action="/cultivate/enquiry">
        <div class="two"><p><label>School name<input name="schoolName" required placeholder="Example Public School"></label></p><p><label>City<input name="city" placeholder="Bengaluru"></label></p></div>
        <div class="two"><p><label>Owner name<input name="ownerName" required placeholder="Owner / Principal name"></label></p><p><label>Phone<input name="ownerPhone" required placeholder="+91 98765 43210"></label></p></div>
        <div class="two"><p><label>Email<input name="ownerEmail" type="email" required placeholder="owner@school.in"></label></p><p><label>Teachers<input name="teacherCount" type="number" min="0" placeholder="60"></label></p></div>
        <p><label>Notes<textarea name="notes" placeholder="Tell us what you want to manage first: fees, admissions, parent queries, report cards..."></textarea></label></p>
        <button class="btn primary" type="submit">Send enquiry</button>
      </form>
    </div>
  </section>
</main>
<footer><div class="wrap">© ${new Date().getFullYear()} Cultivate School · School management software for India-first schools.</div></footer>`,
    `<script type="application/ld+json">${escapeHtml(JSON.stringify(jsonLd))}</script>`
  );
}

export async function createSaasEnquiry(input: EnquiryInput) {
  const schoolName = text(input.schoolName);
  const ownerName = text(input.ownerName);
  const ownerEmail = text(input.ownerEmail);
  const ownerPhone = text(input.ownerPhone);
  if (!schoolName || !ownerName || !ownerEmail || !ownerPhone) {
    throw new Error("School name, owner name, email, and phone are required.");
  }
  return prisma.saasOrg.create({
    data: {
      schoolName,
      ownerName,
      ownerEmail,
      ownerPhone,
      city: text(input.city),
      teacherCount: intOrNull(input.teacherCount),
      studentCount: intOrNull(input.studentCount),
      notes: text(input.notes),
      plan: "Monthly school",
      monthlyPrice: MONTHLY_PRICE,
      paymentStatus: "PENDING",
      subscriptionStatus: "LEAD",
      followUpStatus: "NEW",
    },
  });
}

export async function updateSaasOrg(id: string, input: OrgUpdateInput) {
  const data: Record<string, string | number | null> = {};
  for (const key of [
    "schoolName",
    "ownerName",
    "ownerEmail",
    "ownerPhone",
    "city",
    "plan",
    "paymentStatus",
    "subscriptionStatus",
    "loginUrl",
    "apiUrl",
    "notes",
    "followUpStatus",
    "razorpayCustomerId",
  ] as const) {
    if (input[key] !== undefined) data[key] = text(input[key]);
  }
  if (input.teacherCount !== undefined) data.teacherCount = intOrNull(input.teacherCount);
  if (input.studentCount !== undefined) data.studentCount = intOrNull(input.studentCount);
  if (input.monthlyPrice !== undefined) data.monthlyPrice = intOrNull(input.monthlyPrice) ?? MONTHLY_PRICE;
  return prisma.saasOrg.update({ where: { id }, data });
}

export async function listSaasOrgs() {
  return prisma.saasOrg.findMany({
    orderBy: { updatedAt: "desc" },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
}

export async function createSaasRazorpayOrder(input: EnquiryInput & { orgId?: unknown }) {
  const keyId = text(process.env.CULTIVATE_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID);
  const keySecret = text(process.env.CULTIVATE_RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET);
  if (!keyId || !keySecret) throw new Error("Cultivate Razorpay keys are not configured yet.");
  const orgId = text(input.orgId);
  const org = orgId ? await prisma.saasOrg.findUnique({ where: { id: orgId } }) : await createSaasEnquiry(input);
  if (!org) throw new Error("Organisation not found.");
  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const order = await razorpay.orders.create({
    amount: org.monthlyPrice * 100,
    currency: "INR",
    receipt: org.id.slice(0, 40),
    notes: { orgId: org.id, schoolName: org.schoolName, product: PRODUCT_NAME },
  });
  await prisma.saasPayment.create({
    data: {
      orgId: org.id,
      amount: org.monthlyPrice,
      orderId: order.id,
      status: "CREATED",
      notes: "Subscription order created",
    },
  });
  return { keyId, orderId: order.id, amount: org.monthlyPrice, amountPaise: org.monthlyPrice * 100, org };
}

export async function markSaasPayment(input: { orgId: string; orderId?: string; paymentId?: string; status?: string; notes?: string }) {
  const payment = await prisma.saasPayment.create({
    data: {
      orgId: input.orgId,
      amount: MONTHLY_PRICE,
      orderId: input.orderId || "",
      paymentId: input.paymentId || "",
      status: input.status || "PAID",
      notes: input.notes || "Payment recorded manually",
      paidAt: input.status === "FAILED" ? null : new Date(),
    },
  });
  await prisma.saasOrg.update({
    where: { id: input.orgId },
    data: { paymentStatus: payment.status, subscriptionStatus: payment.status === "PAID" ? "ACTIVE" : undefined },
  });
  return payment;
}

export async function adminHtml(saved = "", basePath = "/cultivate-admin") {
  const orgs = await listSaasOrgs();
  const actionBase = basePath.replace(/\/$/, "");
  return shell(
    "Cultivate SaaS Admin",
    "Internal Cultivate School SaaS admin portal.",
    `<main class="admin wrap">
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:end;flex-wrap:wrap">
        <div><div class="eyebrow">Internal admin</div><h1 style="font-size:38px;margin-bottom:6px">Onboarded schools</h1><p class="muted">Manage owners, subscription status, Razorpay records, URLs, notes, and follow-ups.</p></div>
        <a class="btn" href="/">Marketing page</a>
      </div>
      ${saved ? `<p class="card" style="border-color:#bbf7d0;color:#166534">${escapeHtml(saved)}</p>` : ""}
      <section class="admin-card">
        <h2 style="margin-top:0">Add organisation</h2>
        <form class="form" method="post" action="${actionBase}/orgs">
          <div class="two"><label>School<input name="schoolName" required></label><label>City<input name="city"></label></div>
          <div class="two"><label>Owner<input name="ownerName" required></label><label>Phone<input name="ownerPhone" required></label></div>
          <div class="two"><label>Email<input name="ownerEmail" type="email" required></label><label>Teachers<input name="teacherCount" type="number" min="0"></label></div>
          <label>Notes<textarea name="notes"></textarea></label>
          <button class="btn primary" type="submit">Save org</button>
        </form>
      </section>
      <section class="admin-card">
        <h2 style="margin-top:0">Schools</h2>
        <table class="table">
          <thead><tr><th>School</th><th>Owner</th><th>Plan</th><th>Status</th><th>URLs</th><th>Payment records</th><th>Update</th></tr></thead>
          <tbody>
          ${orgs
            .map(
              (org) => `<tr>
                <td><strong>${escapeHtml(org.schoolName)}</strong><br><span class="fine">${escapeHtml(org.city)} · ${org.teacherCount ?? "-"} teachers</span></td>
                <td>${escapeHtml(org.ownerName)}<br><span class="fine">${escapeHtml(org.ownerEmail)}<br>${escapeHtml(org.ownerPhone)}</span></td>
                <td>${escapeHtml(org.plan)}<br><strong>₹${org.monthlyPrice}/mo</strong></td>
                <td><span class="badge">${escapeHtml(org.subscriptionStatus)}</span><br><span class="fine">${escapeHtml(org.paymentStatus)} · ${escapeHtml(org.followUpStatus)}</span></td>
                <td><span class="fine">Login: ${escapeHtml(org.loginUrl || "-")}<br>API: ${escapeHtml(org.apiUrl || "-")}</span></td>
                <td>${org.payments.length ? org.payments.map((p) => `<span class="fine">${escapeHtml(p.status)} ₹${p.amount} ${escapeHtml(p.paymentId || p.orderId || "")}</span>`).join("<br>") : "<span class=\"fine\">No records</span>"}</td>
                <td>
                  <form class="form" method="post" action="${actionBase}/orgs/${encodeURIComponent(org.id)}" style="min-width:260px">
                    <div class="two"><select name="subscriptionStatus"><option>${escapeHtml(org.subscriptionStatus)}</option><option>LEAD</option><option>ACTIVE</option><option>INACTIVE</option></select><select name="paymentStatus"><option>${escapeHtml(org.paymentStatus)}</option><option>PENDING</option><option>PAID</option><option>OVERDUE</option><option>FAILED</option></select></div>
                    <div class="two"><input name="loginUrl" placeholder="Login URL" value="${escapeHtml(org.loginUrl)}"><input name="apiUrl" placeholder="API URL" value="${escapeHtml(org.apiUrl)}"></div>
                    <input name="followUpStatus" placeholder="Follow-up status" value="${escapeHtml(org.followUpStatus)}">
                    <textarea name="notes" placeholder="Notes">${escapeHtml(org.notes)}</textarea>
                    <button class="btn primary" type="submit">Update</button>
                  </form>
                </td>
              </tr>`
            )
            .join("")}
          </tbody>
        </table>
      </section>
    </main>`
  );
}

export function robotsTxt() {
  return `User-agent: *
Allow: /
Sitemap: ${pageUrl("/sitemap.xml")}
`;
}

export function sitemapXml() {
  const urls = ["/", "/features", "/pricing"].map(
    (path) => `<url><loc>${escapeHtml(pageUrl(path))}</loc><changefreq>weekly</changefreq><priority>${path === "/" ? "1.0" : "0.8"}</priority></url>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
}
