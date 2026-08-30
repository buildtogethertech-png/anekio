import Razorpay from "razorpay";
import crypto from "node:crypto";
import { prisma } from "./prisma";
import { normalizeMobile } from "./phone";

const PRODUCT_NAME = "Anekio";
const PLAN_PRICE = 29999;
const EARLY_BIRD_PRICE = 14999;
const TRIAL_DAYS = 7;

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

export type SaasSubscriptionLock = {
  locked: true;
  orgId: string;
  schoolName: string;
  status: string;
  renewalOn: string;
  renewUrl: string;
  amount: number;
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

function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN").format(amount);
}

function normalEmail(value: unknown) {
  return text(value).toLowerCase();
}

function normalPhone(value: unknown) {
  return normalizeMobile(text(value));
}

function addOneYear(date: Date) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + 1);
  return next;
}

function renewalUrl(orgId: string) {
  return pageUrl(`/anekio/renew?org=${encodeURIComponent(orgId)}`);
}

function isRenewalRequired(org: { subscriptionStatus: string; renewalOn: Date | null }) {
  const status = org.subscriptionStatus.toUpperCase();
  if (["PAUSED", "CANCELLED", "CLOSED", "INACTIVE", "EXPIRED", "OVERDUE"].includes(status)) return true;
  if (status === "ACTIVE" && org.renewalOn && org.renewalOn.getTime() < Date.now()) return true;
  return false;
}

async function findSaasOrgByContact(input: { ownerEmail?: unknown; ownerPhone?: unknown }) {
  const email = normalEmail(input.ownerEmail);
  const phone = normalPhone(input.ownerPhone);
  const conditions = [
    email ? { ownerEmail: { equals: email } } : null,
    phone ? { ownerPhone: { equals: phone } } : null,
  ].filter(Boolean) as { ownerEmail?: { equals: string }; ownerPhone?: { equals: string } }[];
  if (!conditions.length) return null;
  return prisma.saasOrg.findFirst({
    where: { OR: conditions },
    orderBy: { updatedAt: "desc" },
  });
}

function pageUrl(path = "/") {
  const base = (process.env.ANEKIO_PUBLIC_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || "").replace(/\/$/, "");
  if (!base) return path;
  const origin = base.startsWith("http") ? base : `https://${base}`;
  return `${origin}${path}`;
}

function adminUrl() {
  const configured = (process.env.ANEKIO_ADMIN_URL || "").trim();
  if (configured) return configured;
  const publicUrl = pageUrl("/");
  if (!publicUrl.startsWith("http")) return "/anekio-admin";
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
    return "/anekio-admin";
  }
  return "/anekio-admin";
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
    :root{color-scheme:light;--ink:#102033;--muted:#5d6f86;--blue:#2855f6;--sky:#21b6e8;--mint:#14b889;--gold:#f5b93f;--cream:#fffaf1;--paper:#ffffff;--soft:#f3f7fd;--line:#dbe6f4;--shadow:0 24px 70px rgba(16,32,51,.12)}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:linear-gradient(180deg,#fbfdff 0%,#f4f8fe 46%,#fff 100%);color:var(--ink);line-height:1.5}
    a{color:inherit;text-decoration:none}.wrap{width:min(1160px,calc(100% - 36px));margin:0 auto}.nav{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.88);backdrop-filter:blur(18px);border-bottom:1px solid rgba(219,230,244,.9)}
    .nav .wrap{height:76px;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand{display:flex;align-items:center;gap:12px;font-size:24px;font-weight:950;letter-spacing:-.02em}.brand .mark{width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,var(--blue),var(--sky));display:grid;place-items:center;color:white;box-shadow:0 12px 30px rgba(40,85,246,.28);font-size:20px}.brand .tag{display:block;font-size:12px;color:var(--muted);letter-spacing:0;font-weight:850}
    .navlinks{display:flex;align-items:center;gap:20px;color:#334761;font-weight:850}.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:14px;border:1px solid #bed0ea;padding:12px 18px;font-weight:950;background:white;cursor:pointer;box-shadow:0 8px 22px rgba(16,32,51,.05)}.btn.primary{background:var(--blue);border-color:var(--blue);color:white;box-shadow:0 16px 34px rgba(40,85,246,.25)}.btn.dark{background:var(--ink);border-color:var(--ink);color:white}.btn.light{background:#f8fbff}
    .hero{padding:78px 0 38px}.hero-grid{display:grid;grid-template-columns:1.02fr .98fr;gap:48px;align-items:center}.eyebrow{color:var(--blue);font-weight:950;text-transform:uppercase;letter-spacing:.16em;font-size:12px}.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid #cfe0f8;background:#fff;border-radius:999px;padding:8px 12px;font-size:13px;font-weight:900;color:#31506f}
    h1{font-size:68px;line-height:.96;letter-spacing:-.055em;margin:16px 0 20px}.lead{font-size:21px;color:var(--muted);max-width:720px}.cta{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}.proof{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:30px}.proof div{border:1px solid var(--line);background:white;border-radius:18px;padding:15px}.proof b{display:block;font-size:22px}.proof span{font-size:12px;color:var(--muted);font-weight:850;text-transform:uppercase;letter-spacing:.08em}
    .product-card{background:white;border:1px solid var(--line);border-radius:26px;box-shadow:var(--shadow);overflow:hidden}.product-top{padding:18px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}.dots{display:flex;gap:7px}.dots i{width:10px;height:10px;border-radius:50%;background:#d6e2f0}.dash{padding:18px;display:grid;gap:14px}.metric-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.metric{background:#f7fbff;border:1px solid #e0eaf6;border-radius:18px;padding:16px}.metric strong{font-size:30px}.metric span{display:block;color:var(--muted);font-size:13px}.flow{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mini{border:1px solid var(--line);border-radius:18px;padding:14px}.bar{height:10px;border-radius:999px;background:linear-gradient(90deg,var(--mint) 0 55%,#f04444 55%);margin-top:12px}
    .sections{padding:54px 0}.section-title{font-size:42px;letter-spacing:-.04em;line-height:1.08;margin:8px 0 12px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:24px}.card{background:white;border:1px solid var(--line);border-radius:22px;padding:24px;box-shadow:0 14px 38px rgba(16,32,51,.06)}.card h3{margin:10px 0 8px;font-size:20px}.icon{width:42px;height:42px;border-radius:14px;background:#eef5ff;display:grid;place-items:center;color:var(--blue);font-weight:950}.muted{color:var(--muted)}
    .band{background:#0f2034;color:white;border-radius:30px;padding:34px;box-shadow:var(--shadow)}.band .muted{color:#c7d5e8}.split{display:grid;grid-template-columns:.95fr 1.05fr;gap:24px;align-items:start}.price-card{background:linear-gradient(145deg,#fff,var(--cream));border:1px solid #f1dec0;border-radius:26px;padding:28px;box-shadow:var(--shadow)}.price-old{text-decoration:line-through;color:#7b8795;font-size:22px;font-weight:900}.price{font-size:62px;font-weight:980;letter-spacing:-.06em;line-height:1}.save{display:inline-flex;background:#e9fff7;color:#077354;border:1px solid #bdf4df;border-radius:999px;padding:8px 12px;font-weight:950;margin:12px 0}.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.chip{border:1px solid #d6e4f4;background:#fff;border-radius:999px;padding:8px 11px;font-weight:850;font-size:13px}
    .form-shell{position:relative;overflow:hidden;border-radius:30px;background:linear-gradient(145deg,#ffffff 0%,#f8fbff 58%,#eef6ff 100%);border:1px solid #d7e4f5;box-shadow:0 24px 70px rgba(16,32,51,.1)}.form-shell:before{content:"";position:absolute;inset:-120px auto auto -110px;width:260px;height:260px;border-radius:50%;background:rgba(33,182,232,.16)}.form-shell:after{content:"";position:absolute;right:-120px;bottom:-140px;width:280px;height:280px;border-radius:50%;background:rgba(40,85,246,.12)}.form-content{position:relative;z-index:1;display:grid;grid-template-columns:.9fr 1.1fr;gap:30px;padding:30px}.form-panel{background:rgba(255,255,255,.86);border:1px solid #dbe7f6;border-radius:24px;padding:22px;box-shadow:0 18px 45px rgba(16,32,51,.08)}.form{display:grid;gap:14px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:grid;gap:7px;font-weight:900;color:#314861;font-size:13px}input,select,textarea{width:100%;border:1px solid #c9d8ec;border-radius:16px;padding:14px 15px;font:inherit;background:white;color:var(--ink);box-shadow:0 8px 20px rgba(16,32,51,.035);outline:none}input:focus,select:focus,textarea:focus{border-color:var(--blue);box-shadow:0 0 0 4px rgba(40,85,246,.12)}textarea{min-height:116px;resize:vertical}.form-note{display:flex;align-items:flex-start;gap:10px;border:1px solid #cfe7ff;background:#f4faff;color:#36516f;border-radius:18px;padding:12px 13px;font-size:13px;font-weight:750}.form-note b{color:#102033}.check-list{display:grid;gap:10px;margin:22px 0}.check-list span{display:flex;gap:10px;align-items:flex-start;color:#4c6078;font-weight:750}.check-list span:before{content:"✓";display:grid;place-items:center;flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:#e9fff7;color:#07825e;font-weight:950}.fine{font-size:13px;color:var(--muted)}.admin{padding:38px 0 70px}.table{width:100%;border-collapse:separate;border-spacing:0;background:white;border:1px solid var(--line);border-radius:18px;overflow:hidden}.table th,.table td{padding:12px;border-bottom:1px solid #edf2fa;text-align:left;vertical-align:top}.table th{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#52657d;background:#f8fbff}.badge{display:inline-block;border-radius:999px;padding:4px 8px;background:#eaf2ff;color:#174ea6;font-weight:900;font-size:12px}.admin-card{background:white;border:1px solid var(--line);border-radius:20px;padding:18px;margin-top:18px}footer{border-top:1px solid var(--line);padding:26px 0;color:var(--muted);background:white}
    @media(max-width:900px){.hero-grid,.grid,.two,.split,.flow,.form-content{grid-template-columns:1fr}.navlinks{display:none}h1{font-size:44px}.hero{padding-top:48px}.proof,.metric-grid{grid-template-columns:1fr}.price{font-size:48px}.table{font-size:14px}.form-content{padding:18px}.form-panel{padding:16px}}
  </style>
</head>
<body>${body}</body>
</html>`;
}

export function marketingHtml(message = "") {
  const title = "Anekio | School ERP for India-first schools";
  const description =
    "Anekio helps schools manage admissions, fees, attendance, exams, documents, parent communication, teachers, and daily operations in one connected school ERP.";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: PRODUCT_NAME,
    applicationCategory: "School management software",
    operatingSystem: "Web, Android, iOS",
    offers: { "@type": "Offer", price: String(EARLY_BIRD_PRICE), priceCurrency: "INR", availability: "https://schema.org/InStock" },
    audience: { "@type": "EducationalAudience", educationalRole: "School administrator" },
    description,
  };
  return shell(
    title,
    description,
    `<nav class="nav"><div class="wrap"><a class="brand" href="/"><span class="mark">A</span><span><strong>Anekio</strong><span class="tag">One system. Infinite possibilities.</span></span></a><div class="navlinks"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#trial">Free trial</a><a href="#enquiry">Enquire</a><a class="btn primary" href="#trial">Start free trial</a></div></div></nav>
<main>
  <section class="hero wrap">
    <div class="hero-grid">
      <div>
        <span class="pill">School ERP for growing Indian schools</span>
        <h1>Run the whole school from one calm system.</h1>
        <p class="lead">Anekio connects fees, admissions, attendance, exams, documents, parent communication, staff work, and student records so every team sees the same truth.</p>
        <div class="cta"><a class="btn primary" href="#trial">Start 7-day free trial</a><a class="btn light" href="#pricing">See launch price</a></div>
        <div class="proof"><div><b>4</b><span>Portals</span></div><div><b>12+</b><span>School flows</span></div><div><b>1</b><span>Source of truth</span></div></div>
        ${message ? `<p class="card" style="margin-top:18px;border-color:#bbf7d0;color:#166534">${escapeHtml(message)}</p>` : ""}
      </div>
      <div class="product-card" aria-label="Anekio product preview">
        <div class="product-top"><strong>Live school desk</strong><div class="dots"><i></i><i></i><i></i></div></div>
        <div class="dash">
          <div class="metric-grid">
            <div class="metric"><span>Fees overdue</span><strong>60</strong><span>₹4,93,500 pending</span></div>
            <div class="metric"><span>Attendance</span><strong>92%</strong><span>Classes marked today</span></div>
            <div class="metric"><span>Admissions</span><strong>18</strong><span>New leads this week</span></div>
            <div class="metric"><span>Staff tasks</span><strong>7</strong><span>Need attention</span></div>
          </div>
          <div class="flow">
            <div class="mini"><strong>Parent request</strong><p class="muted">Admit card blocked. Assigned to office with full history.</p></div>
            <div class="mini"><strong>Fee health</strong><p class="muted">Paid vs overdue is visible before follow-up calls.</p><div class="bar"></div></div>
          </div>
        </div>
      </div>
    </div>
  </section>
  <section id="features" class="sections wrap">
    <div class="eyebrow">Product modules</div>
    <h2 class="section-title">The daily operating system for school teams.</h2>
    <p class="lead">One app for office, teachers, parents, and students, designed around real Indian school workflows.</p>
    <div class="grid" style="margin-top:22px">
      ${[
        ["Fees and receipts", "Invoices, payment links, receipts, outstanding reports, and follow-up workflows."],
        ["Admissions CRM", "Capture enquiries, update stages, record calls, and keep every lead history clean."],
        ["Parent request desk", "Mail-style tickets with numbers, staff mentions, replies, notes, and closures."],
        ["Attendance and leave", "Class attendance, staff leave, approvals, substitute planning, and notifications."],
        ["Exams and documents", "Exam setup, marks, report cards, certificates, admit cards, and verification links."],
        ["Roles and portals", "Office, teacher, parent, and student portals with permissions for real teams."],
      ]
        .map(([head, copy], index) => `<article class="card"><div class="icon">${index + 1}</div><h3>${head}</h3><p class="muted">${copy}</p></article>`)
        .join("")}
    </div>
  </section>
  <section class="sections wrap">
    <div class="band split">
      <div><div class="eyebrow" style="color:#8bd8ff">Why schools switch</div><h2 class="section-title" style="color:white">Less chasing.<br>More control.</h2><p class="muted">Most schools run on WhatsApp groups, spreadsheets, notebooks, and memory. Anekio turns those scattered tasks into trackable workflows for the office, teachers, parents, and students.</p></div>
      <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:0"><div class="mini"><strong>Before</strong><p class="muted">Fees in one file, admissions in another, parent issues in chats.</p></div><div class="mini"><strong>After</strong><p class="muted">One school record, one ticket trail, one dashboard for decisions.</p></div></div>
    </div>
  </section>
  <section id="pricing" class="sections wrap" style="padding-top:0">
    <div class="split">
      <div class="price-card">
        <div class="eyebrow">Launch pricing</div>
        <h2 class="section-title">Early bird for the first schools.</h2>
        <div class="price-old">₹${formatInr(PLAN_PRICE)}</div>
        <div class="price">₹${formatInr(EARLY_BIRD_PRICE)}</div>
        <span class="save">50% early-bird discount</span>
        <p class="muted">For schools joining during the launch window. Includes the complete school ERP setup for the Anekio core modules.</p>
        <div class="chips"><span class="chip">Fees</span><span class="chip">Attendance</span><span class="chip">Admissions</span><span class="chip">Exams</span><span class="chip">Documents</span><span class="chip">Parent desk</span></div>
      </div>
      <div class="card">
        <div class="eyebrow">Reserve your launch plan</div>
        <h2 style="margin:8px 0 8px">Lock the early-bird price</h2>
        <p class="muted">Enter school owner details. Secure checkout opens after your order is created.</p>
        <form class="form" method="post" action="/api/saas/payment/order">
          <div class="two"><label>School name<input name="schoolName" required placeholder="Example Public School"></label><label>City<input name="city" placeholder="Bengaluru"></label></div>
          <div class="two"><label>Owner name<input name="ownerName" required placeholder="Principal / Owner"></label><label>Phone<input name="ownerPhone" required placeholder="+91 98765 43210"></label></div>
          <label>Email<input name="ownerEmail" type="email" required placeholder="owner@school.in"></label>
          <input type="hidden" name="teacherCount" value="0">
          <button class="btn primary" type="submit">Pay ₹${formatInr(EARLY_BIRD_PRICE)} securely</button>
          <p class="fine">Secure payment opens on the next screen. If online payment is not available, submit the free-trial form and our team will help.</p>
        </form>
      </div>
    </div>
  </section>
  <section id="trial" class="sections wrap" style="padding-top:0">
    <div class="form-shell">
      <div class="form-content">
        <div>
          <div class="eyebrow">Self-serve trial</div>
          <h2 class="section-title">Try Anekio free for ${TRIAL_DAYS} days.</h2>
          <p class="lead">No payment needed. Share your school details and we will prepare a trial workspace so your team can explore the product flow first.</p>
          <div class="check-list">
            <span>Trial request created instantly for your school.</span>
            <span>Explore fees, attendance, admissions, parent desk, exams, and documents.</span>
            <span>Upgrade later only when you are ready.</span>
          </div>
          <p class="form-note">Best for school owners and principals who want to see the system before paying.</p>
        </div>
        <div class="form-panel">
          <form class="form" method="post" action="/api/saas/trial">
            <div class="two"><label>School name<input name="schoolName" required placeholder="VidyaPith Public School"></label><label>City<input name="city" placeholder="Bengaluru"></label></div>
            <div class="two"><label>Your name<input name="ownerName" required placeholder="Principal / Owner"></label><label>Phone<input name="ownerPhone" required placeholder="+91 98765 43210"></label></div>
            <div class="two"><label>Email<input name="ownerEmail" type="email" required placeholder="owner@school.in"></label><label>Teachers<input name="teacherCount" type="number" min="0" placeholder="60"></label></div>
            <label>What do you want to try first?<textarea name="notes" placeholder="Example: fees collection, parent queries, attendance, admissions..."></textarea></label>
            <button class="btn primary" type="submit" style="width:100%">Start my ${TRIAL_DAYS}-day free trial</button>
            <p class="fine">We will use this to create your trial request and contact you for workspace setup.</p>
          </form>
        </div>
      </div>
    </div>
  </section>
  <section id="enquiry" class="sections wrap" style="padding-top:0">
    <div class="form-shell">
      <div class="form-content">
        <div>
          <div class="eyebrow">Talk to us</div>
          <h2 class="section-title">Want a demo before payment?</h2>
          <p class="lead">Send your details and we will walk you through the school workflows that matter first.</p>
          <div class="check-list">
            <span>Personal walkthrough for your school team.</span>
            <span>We map your current fees, admissions, attendance, and communication flow.</span>
            <span>You get a clear rollout suggestion before buying.</span>
          </div>
        </div>
        <div class="form-panel">
          <form class="form" method="post" action="/anekio/enquiry">
            <div class="two"><label>School name<input name="schoolName" required placeholder="VidyaPith Public School"></label><label>City<input name="city" placeholder="Bengaluru"></label></div>
            <div class="two"><label>Your name<input name="ownerName" required placeholder="Owner / Principal"></label><label>Phone<input name="ownerPhone" required placeholder="+91 98765 43210"></label></div>
            <div class="two"><label>Email<input name="ownerEmail" type="email" required placeholder="owner@school.in"></label><label>Teachers<input name="teacherCount" type="number" min="0" placeholder="60"></label></div>
            <label>Notes<textarea name="notes" placeholder="Tell us what you want to manage first: fees, admissions, parent queries, report cards..."></textarea></label>
            <button class="btn dark" type="submit" style="width:100%">Book a demo</button>
          </form>
        </div>
      </div>
    </div>
  </section>
</main>
<footer><div class="wrap">© ${new Date().getFullYear()} Anekio · One system. Infinite possibilities.</div></footer>`,
    `<script type="application/ld+json">${escapeHtml(JSON.stringify(jsonLd))}</script>`
  );
}

export async function createSaasEnquiry(input: EnquiryInput) {
  const schoolName = text(input.schoolName);
  const ownerName = text(input.ownerName);
  const ownerEmail = normalEmail(input.ownerEmail);
  const ownerPhone = normalPhone(input.ownerPhone) || text(input.ownerPhone);
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
      plan: "Early bird school ERP",
      monthlyPrice: EARLY_BIRD_PRICE,
      paymentStatus: "PENDING",
      subscriptionStatus: "LEAD",
      followUpStatus: "NEW",
    },
  });
}

export async function createSaasTrial(input: EnquiryInput) {
  const org = await createSaasEnquiry({
    ...input,
    notes: ["7-day free trial requested", text(input.notes)].filter(Boolean).join(" · "),
  });
  return prisma.saasOrg.update({
    where: { id: org.id },
    data: {
      plan: `${TRIAL_DAYS}-day free trial`,
      monthlyPrice: 0,
      paymentStatus: "TRIAL",
      subscriptionStatus: "TRIAL",
      followUpStatus: "TRIAL_REQUESTED",
    },
  });
}

export function trialStartedHtml(org: Awaited<ReturnType<typeof createSaasTrial>>) {
  return shell(
    "Free trial started | Anekio",
    "Your Anekio free trial request has been received.",
    `<main class="wrap" style="min-height:100vh;display:grid;place-items:center;padding:40px 0">
      <section class="form-shell" style="max-width:760px;width:100%">
        <div class="form-content" style="grid-template-columns:1fr">
          <div>
            <div class="eyebrow">Trial request received</div>
            <h1 style="font-size:52px;margin-bottom:12px">Your ${TRIAL_DAYS}-day Anekio trial is ready to start.</h1>
            <p class="lead">Thanks, ${escapeHtml(org.ownerName)}. We have saved the trial request for ${escapeHtml(org.schoolName)} and will help you open the workspace.</p>
            <div class="check-list">
              <span>No payment is needed for the trial.</span>
              <span>Your school details are saved for setup.</span>
              <span>Our team will contact you on ${escapeHtml(org.ownerPhone)}.</span>
            </div>
            <a class="btn primary" href="/">Back to Anekio</a>
          </div>
        </div>
      </section>
    </main>`
  );
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
  if (input.monthlyPrice !== undefined) data.monthlyPrice = intOrNull(input.monthlyPrice) ?? EARLY_BIRD_PRICE;
  return prisma.saasOrg.update({ where: { id }, data });
}

export async function listSaasOrgs() {
  return prisma.saasOrg.findMany({
    orderBy: { updatedAt: "desc" },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
}

export async function createSaasRazorpayOrder(input: EnquiryInput & { orgId?: unknown }) {
  const keyId = text(process.env.ANEKIO_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID);
  const keySecret = text(process.env.ANEKIO_RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET);
  if (!keyId || !keySecret) throw new Error("Anekio secure payment is not configured yet.");
  const orgId = text(input.orgId);
  const existing = orgId ? null : await findSaasOrgByContact(input);
  const org = orgId
    ? await prisma.saasOrg.findUnique({ where: { id: orgId } })
    : existing
      ? await prisma.saasOrg.update({
          where: { id: existing.id },
          data: {
            monthlyPrice: EARLY_BIRD_PRICE,
            paymentStatus: existing.paymentStatus === "PAID" ? "RENEWAL_DUE" : existing.paymentStatus,
            followUpStatus: "RENEWAL_STARTED",
          },
        })
      : await createSaasEnquiry(input);
  if (!org) throw new Error("Organisation not found.");
  const renewal = Boolean(orgId || existing);
  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const order = await razorpay.orders.create({
    amount: EARLY_BIRD_PRICE * 100,
    currency: "INR",
    receipt: org.id.slice(0, 40),
    notes: { orgId: org.id, schoolName: org.schoolName, product: PRODUCT_NAME, purpose: renewal ? "renewal" : "new" },
  });
  await prisma.saasPayment.create({
    data: {
      orgId: org.id,
      amount: EARLY_BIRD_PRICE,
      orderId: order.id,
      status: "CREATED",
      notes: renewal ? "Renewal order created" : "Subscription order created",
    },
  });
  return { keyId, orderId: order.id, amount: EARLY_BIRD_PRICE, amountPaise: EARLY_BIRD_PRICE * 100, org, renewal };
}

export function saasCheckoutHtml(order: Awaited<ReturnType<typeof createSaasRazorpayOrder>>) {
  const verifyPayload = { orgId: order.org.id, amount: order.amount };
  const heading = order.renewal ? "Renew your Anekio plan" : "Complete your Anekio payment";
  const description = order.renewal ? "Anekio launch plan renewal" : "Early bird school ERP plan";
  const successTitle = order.renewal ? "Renewal received" : "Payment received";
  const successHeading = order.renewal ? "Your Anekio access is renewing" : "Welcome to Anekio";
  const successCopy = order.renewal
    ? "Your renewal payment is recorded. You can continue using Anekio while our account manager follows up."
    : "Your early-bird payment is recorded. One of our account managers will connect with you for onboarding.";
  return shell(
    "Complete payment | Anekio",
    "Complete your Anekio early-bird payment securely.",
    `<main class="wrap" style="min-height:100vh;display:grid;place-items:center;padding:40px 0">
      <section class="price-card" style="max-width:620px;width:100%">
        <div class="eyebrow">Secure checkout</div>
        <h1 style="font-size:44px;margin-bottom:10px">${heading}</h1>
        <p class="lead" style="font-size:18px">School: ${escapeHtml(order.org.schoolName)}</p>
        <div class="price">₹${formatInr(order.amount)}</div>
        <p class="muted">Secure checkout should open automatically. If it does not, use the button below.</p>
        <button id="pay" class="btn primary" type="button" style="width:100%;margin-top:12px">Open secure checkout</button>
        <p id="status" class="fine"></p>
      </section>
    </main>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <script>
      const statusEl = document.getElementById("status");
      const button = document.getElementById("pay");
      const verifyPayload = ${JSON.stringify(verifyPayload)};
      function setStatus(message) { statusEl.textContent = message; }
      async function verify(response) {
        setStatus("Verifying payment...");
        const res = await fetch("/api/saas/payment/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...verifyPayload, ...response })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Payment verification failed.");
        document.body.innerHTML = '<main class="wrap" style="min-height:100vh;display:grid;place-items:center;padding:40px 0"><section class="price-card" style="max-width:620px;width:100%"><div class="eyebrow">${successTitle}</div><h1 style="font-size:44px;margin-bottom:10px">${successHeading}</h1><p class="lead" style="font-size:18px">${successCopy}</p><a class="btn primary" href="/">Back to Anekio</a></section></main>';
      }
      function openCheckout() {
        if (!window.Razorpay) {
          setStatus("Secure checkout could not load. Please refresh and try again.");
          return;
        }
        const checkout = new window.Razorpay({
          key: "${escapeHtml(order.keyId)}",
          amount: ${order.amountPaise},
          currency: "INR",
          name: "Anekio",
          description: "${description}",
          order_id: "${escapeHtml(order.orderId)}",
          prefill: {
            name: "${escapeHtml(order.org.ownerName)}",
            email: "${escapeHtml(order.org.ownerEmail)}",
            contact: "${escapeHtml(order.org.ownerPhone)}"
          },
          theme: { color: "#2855f6" },
          method: { upi: true, card: true, netbanking: true, wallet: true, emi: true, paylater: true },
          config: { display: { preferences: { show_default_blocks: true } } },
          handler: (response) => verify(response).catch((error) => setStatus(error.message || "Could not verify payment.")),
          modal: { ondismiss: () => setStatus("Payment window closed. You can reopen checkout when ready.") }
        });
        checkout.open();
      }
      button.addEventListener("click", openCheckout);
      window.addEventListener("load", () => setTimeout(openCheckout, 400));
    </script>`
  );
}

export async function verifySaasRazorpayPayment(input: Record<string, unknown>) {
  const keySecret = text(process.env.ANEKIO_RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET);
  if (!keySecret) throw new Error("Anekio secure payment is not configured.");
  const orgId = text(input.orgId);
  const razorpayOrderId = text(input.razorpay_order_id);
  const razorpayPaymentId = text(input.razorpay_payment_id);
  const razorpaySignature = text(input.razorpay_signature);
  if (!orgId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw new Error("Missing payment verification fields.");
  }
  const expected = crypto.createHmac("sha256", keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest("hex");
  if (expected !== razorpaySignature.trim().toLowerCase()) throw new Error("Payment signature verification failed.");
  const org = await prisma.saasOrg.findUnique({ where: { id: orgId } });
  if (!org) throw new Error("Organisation not found.");
  const existing = await prisma.saasPayment.findFirst({ where: { paymentId: razorpayPaymentId } });
  if (!existing) {
    await prisma.saasPayment.create({
      data: {
        orgId,
        amount: EARLY_BIRD_PRICE,
        orderId: razorpayOrderId,
        paymentId: razorpayPaymentId,
        status: "PAID",
        notes: "Secure checkout verified",
        paidAt: new Date(),
      },
    });
  }
  await prisma.saasOrg.update({
    where: { id: orgId },
    data: {
      monthlyPrice: EARLY_BIRD_PRICE,
      paymentStatus: "PAID",
      subscriptionStatus: "ACTIVE",
      followUpStatus: org.subscriptionStatus === "ACTIVE" ? "RENEWED" : "ONBOARDING",
      subscriptionStart: org.subscriptionStart || new Date(),
      renewalOn: addOneYear(new Date()),
    },
  });
  return { ok: true, alreadyProcessed: Boolean(existing) };
}

export async function saasRenewalHtml(input: { orgId?: unknown; contact?: unknown } = {}) {
  const orgId = text(input.orgId);
  const contact = text(input.contact);
  const org = orgId
    ? await prisma.saasOrg.findUnique({ where: { id: orgId } })
    : contact
      ? await findSaasOrgByContact({ ownerEmail: contact, ownerPhone: contact })
      : null;
  return shell(
    "Renew Anekio | Anekio",
    "Renew your Anekio school ERP plan.",
    `<main class="wrap" style="min-height:100vh;display:grid;place-items:center;padding:40px 0">
      <section class="price-card" style="max-width:680px;width:100%">
        <div class="eyebrow">Renew Anekio</div>
        <h1 style="font-size:48px;margin-bottom:12px">Renew to continue.</h1>
        ${
          org
            ? `<p class="lead" style="font-size:18px">School: ${escapeHtml(org.schoolName)}</p>
              <div class="price">₹${formatInr(EARLY_BIRD_PRICE)}</div>
              <p class="muted">This renews the current Anekio launch plan. After payment, access is marked active again and our account manager will connect with you.</p>
              <form method="post" action="/api/saas/payment/order">
                <input type="hidden" name="orgId" value="${escapeHtml(org.id)}">
                <button class="btn primary" type="submit" style="width:100%;margin-top:14px">Renew ₹${formatInr(EARLY_BIRD_PRICE)} securely</button>
              </form>`
            : `<p class="lead" style="font-size:18px">Enter the email or phone used for your school account. We will find your organisation and open renewal checkout.</p>
              <form class="form" method="get" action="/anekio/renew">
                <label>Email or phone<input name="contact" required placeholder="owner@school.in or +91 98765 43210"></label>
                <button class="btn primary" type="submit">Find renewal</button>
              </form>`
        }
        <p class="fine">If you need help, our account manager can complete the renewal with you.</p>
      </section>
    </main>`
  );
}

export async function subscriptionLockForUser(userId: string): Promise<SaasSubscriptionLock | null> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, phone: true } });
  if (!row) return null;
  let org = await findSaasOrgByContact({ ownerEmail: row.email || "", ownerPhone: row.phone || "" });
  if (!org) {
    const school = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { email: true, phone: true } });
    org = await findSaasOrgByContact({ ownerEmail: school?.email || "", ownerPhone: school?.phone || "" });
  }
  if (!org || !isRenewalRequired(org)) return null;
  return {
    locked: true,
    orgId: org.id,
    schoolName: org.schoolName,
    status: org.subscriptionStatus,
    renewalOn: org.renewalOn ? org.renewalOn.toISOString() : "",
    renewUrl: renewalUrl(org.id),
    amount: EARLY_BIRD_PRICE,
  };
}

export async function markSaasPayment(input: { orgId: string; orderId?: string; paymentId?: string; status?: string; notes?: string }) {
  const payment = await prisma.saasPayment.create({
    data: {
      orgId: input.orgId,
      amount: EARLY_BIRD_PRICE,
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

export async function adminHtml(saved = "", basePath = "/anekio-admin") {
  const orgs = await listSaasOrgs();
  const actionBase = basePath.replace(/\/$/, "");
  return shell(
    "Anekio SaaS Admin",
    "Internal Anekio School SaaS admin portal.",
    `<main class="admin wrap">
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:end;flex-wrap:wrap">
        <div><div class="eyebrow">Internal admin</div><h1 style="font-size:38px;margin-bottom:6px">Onboarded schools</h1><p class="muted">Manage owners, subscription status, payment records, URLs, notes, and follow-ups.</p></div>
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
