import Razorpay from "razorpay";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "./prisma";
import { normalizeMobile } from "./phone";
import { roleIdBySlug } from "./roles";
import { captureWebsiteLead, createDemo, fulfillPaidSubscription } from "./saas-crm";
import { getSitePricing } from "./saas-pricing";

const PRODUCT_NAME = "Anekio";
const TAGLINE = "One Platform, Infinite Possibilities.";

type EnquiryInput = {
  schoolName?: unknown;
  ownerName?: unknown;
  ownerEmail?: unknown;
  ownerCountryCode?: unknown;
  ownerPhone?: unknown;
  city?: unknown;
  state?: unknown;
  gstin?: unknown;
  teacherCount?: unknown;
  studentCount?: unknown;
  notes?: unknown;
};

type DemoEnquiryInput = EnquiryInput & {
  demoScheduledAt?: unknown;
  demoSlotLabel?: unknown;
  demoTopic?: unknown;
  topic?: unknown;
  website?: unknown;
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

export type SaasSubscriptionOverview = {
  orgId: string;
  schoolName: string;
  plan: string;
  status: string;
  paymentStatus: string;
  subscriptionStart: string;
  renewalOn: string;
  daysLeft: number | null;
  renewUrl: string;
  amount: number;
  invoices: {
    id: string;
    number: string;
    description: string;
    status: string;
    issueDate: string;
    dueDate: string;
    total: number;
    paid: number;
    balance: number;
    notes: string;
    printUrl: string;
  }[];
};

type OrgUpdateInput = Partial<{
  schoolName: unknown;
  ownerName: unknown;
  ownerEmail: unknown;
  ownerCountryCode: unknown;
  ownerPhone: unknown;
  city: unknown;
  state: unknown;
  gstin: unknown;
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

function androidPhoneHtml(label: string) {
  return `<div class="device-stage">
    <div class="product-window" aria-label="Anekio school ERP workspace">
      <div class="product-chrome">
        <span class="chrome-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>Office workspace</span>
        <span class="product-live"><i></i> Live school record</span>
      </div>
      <div class="product-screen"><img class="product-shot" src="/demo/current/office-dashboard.png" alt="Current Anekio office dashboard showing live school operations"></div>
    </div>
    <div class="phone-shell" aria-label="${escapeHtml(label)}">
      <div class="phone-notch" aria-hidden="true"></div>
      <div class="phone-screen">
        <img class="phone-shot" src="/demo/current/office-mobile.png" alt="Current Anekio office mobile dashboard">
      </div>
    </div>
    <div class="product-caption" aria-hidden="true"><span><i></i> Web ERP</span><span><i></i> Android app</span><span><i></i> Role-based access</span></div>
  </div>`;
}

function normalEmail(value: unknown) {
  return text(value).toLowerCase();
}

function validEmail(value: unknown) {
  const candidate = normalEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : "";
}

function normalPhone(value: unknown) {
  return normalizeMobile(text(value));
}

function countryCode(value: unknown) {
  const digits = text(value, "+91").replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "+91";
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

function daysUntil(value: Date | null) {
  if (!value) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const renewal = new Date(value);
  renewal.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((renewal.getTime() - today.getTime()) / 86_400_000));
}

async function findSaasOrgByContact(input: { ownerEmail?: unknown; ownerPhone?: unknown }) {
  const email = normalEmail(input.ownerEmail);
  const phone = normalPhone(input.ownerPhone);
  const rawPhone = text(input.ownerPhone);
  const conditions = [
    email ? { ownerEmail: { equals: email } } : null,
    phone ? { ownerPhone: { equals: phone } } : null,
    rawPhone && rawPhone !== phone ? { ownerPhone: { equals: rawPhone } } : null,
  ].filter(Boolean) as { ownerEmail?: { equals: string }; ownerPhone?: { equals: string } }[];
  if (!conditions.length) return null;
  return prisma.saasOrg.findFirst({
    where: { OR: conditions },
    orderBy: { updatedAt: "desc" },
  });
}

function demoBookingTime(value: unknown) {
  const source = text(value);
  // The public form sends a timezone-aware ISO value. Requiring it keeps a browser's
  // local timezone from silently moving an India booking to a different time.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(source)) {
    throw new Error("Choose a valid demo time first.");
  }
  const scheduledAt = new Date(source);
  if (!Number.isFinite(scheduledAt.getTime())) throw new Error("Choose a valid demo time first.");
  const now = Date.now();
  if (scheduledAt.getTime() < now - 5 * 60_000 || scheduledAt.getTime() > now + 370 * 24 * 60 * 60_000) {
    throw new Error("Choose a future demo time within the next year.");
  }
  return scheduledAt;
}

function demoSlotLabel(scheduledAt: Date) {
  const formatted = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(scheduledAt);
  return `${formatted} IST`;
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

function shouldProvisionLocalTrial() {
  return process.env.NODE_ENV !== "production" && process.env.ANEKIO_PROVISION_TRIAL_WORKSPACE !== "false";
}

async function provisionLocalTrialWorkspace(org: { id: string; schoolName: string; ownerName: string; ownerEmail: string; ownerPhone: string; city: string; billingState: string; gstin: string }) {
  if (!shouldProvisionLocalTrial()) return null;
  const phone = normalizeMobile(org.ownerPhone) || org.ownerPhone;
  const email = normalEmail(org.ownerEmail);
  if (!phone || !email) return null;
  const roleId = await roleIdBySlug("ADMIN");
  const password = "12345";
  const hashed = await bcrypt.hash(password, 10);
  await prisma.schoolConfig.upsert({
    where: { id: "school" },
    update: {
      name: org.schoolName,
      city: org.city,
      state: org.billingState,
      gstin: org.gstin,
      phone,
      email,
    },
    create: {
      id: "school",
      name: org.schoolName,
      city: org.city,
      state: org.billingState,
      gstin: org.gstin,
      phone,
      email,
    },
  });
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { phone }] },
    include: { role: true },
  });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { name: org.ownerName, email, phone, password: hashed, roleId },
    });
  } else {
    await prisma.user.create({
      data: { name: org.ownerName, email, phone, password: hashed, roleId },
    });
  }
  await prisma.saasOrg.update({
    where: { id: org.id },
    data: {
      loginUrl: "/login",
      apiUrl: "/api/v1",
      onboardingStatus: "IN_PROGRESS",
      lifecycle: "CUSTOMER",
    },
  });
  return { login: phone, password };
}

function shell(title: string, description: string, body: string, extraHead = "", bodyClass = "") {
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
  <style>
    :root{color-scheme:light;--ink:#102033;--muted:#5d6f86;--blue:#2855f6;--sky:#21b6e8;--mint:#14b889;--gold:#f5b93f;--cream:#fffaf1;--paper:#ffffff;--soft:#f3f7fd;--line:#dbe6f4;--shadow:0 24px 70px rgba(16,32,51,.12)}
    *{box-sizing:border-box}html{scroll-behavior:smooth;background:#eef4ff}body{margin:0;position:relative;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:transparent;color:var(--ink);line-height:1.5}
    body:before,body:after{content:"";position:fixed;inset:0;pointer-events:none}
    body:before{z-index:-2;background:radial-gradient(900px 560px at 6% -8%,rgba(40,85,246,.2),transparent 58%),radial-gradient(780px 520px at 96% 4%,rgba(33,182,232,.2),transparent 56%),radial-gradient(700px 480px at 80% 92%,rgba(20,184,137,.1),transparent 62%),radial-gradient(520px 360px at 12% 78%,rgba(245,185,63,.1),transparent 60%),linear-gradient(180deg,#fbfdff 0%,#eef4ff 46%,#f7fbff 100%);animation:bg-glow 22s ease-in-out infinite alternate}
    body:after{z-index:-1;opacity:.4;background-image:radial-gradient(rgba(40,85,246,.16) 1px,transparent 1.2px),linear-gradient(rgba(40,85,246,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(40,85,246,.045) 1px,transparent 1px);background-size:22px 22px,56px 56px,56px 56px;mask-image:radial-gradient(ellipse 90% 80% at 50% 30%,#000 10%,transparent 78%);animation:bg-drift 32s linear infinite}
    @keyframes bg-glow{from{filter:hue-rotate(-8deg) saturate(1)}to{filter:hue-rotate(12deg) saturate(1.12)}}
    @keyframes bg-drift{from{background-position:0 0,0 0,0 0}to{background-position:120px 80px,56px 56px,-56px 56px}}
    a{color:inherit;text-decoration:none}.wrap{width:min(1360px,90vw);margin:0 auto}.nav{position:sticky;top:0;z-index:30;width:100%;background:#fff;border-bottom:1px solid rgba(219,230,244,.85);box-shadow:0 1px 0 rgba(16,32,51,.04)}
    .nav .wrap{height:90px;display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{display:flex;align-items:center;gap:12px;font-size:24px;font-weight:950;letter-spacing:-.02em}.brand .mark{width:42px;height:42px;border-radius:14px;background:linear-gradient(135deg,var(--blue),var(--sky));display:grid;place-items:center;color:white;box-shadow:0 12px 30px rgba(40,85,246,.28);font-size:20px}
    .nav-end{display:flex;align-items:center;gap:18px}.navlinks{display:flex;align-items:center;gap:20px;color:#334761;font-weight:850}.navlinks a{position:relative;padding:6px 0;transition:color .2s ease}.navlinks a:hover{color:var(--blue)}.navlinks a:after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--blue);transform:scaleX(0);transition:transform .2s ease}.navlinks a:hover:after{transform:scaleX(1)}.nav-call{width:42px;height:42px;border-radius:50%;border:1px solid #bed0ea;display:grid;place-items:center;background:#fff;flex:0 0 42px}.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:14px;border:1px solid #bed0ea;padding:12px 18px;font-weight:950;background:white;cursor:pointer;box-shadow:0 8px 22px rgba(16,32,51,.05)}.btn.primary{background:var(--blue);border-color:var(--blue);color:white;box-shadow:0 16px 34px rgba(40,85,246,.25)}.btn.dark{background:var(--ink);border-color:var(--ink);color:white}.btn.light{background:#f8fbff}
    .hero{padding:clamp(40px,6vh,72px) 0 56px}.hero-grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:clamp(40px,5vw,70px);align-items:center}.hero-copy{display:flex;flex-direction:column;align-items:flex-start;gap:18px}.hero-visual{position:relative;min-width:0}.eyebrow{color:var(--blue);font-weight:950;text-transform:uppercase;letter-spacing:.16em;font-size:12px}.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid #cfe0f8;background:#fff;border-radius:999px;padding:8px 12px;font-size:13px;font-weight:900;color:#31506f}
    h1{font-size:clamp(40px,4.6vw,64px);line-height:1.05;letter-spacing:-.055em;margin:0;max-width:560px}.lead{font-size:clamp(16px,1.35vw,19px);color:var(--muted);max-width:600px;margin:0}.cta{display:flex;gap:14px;flex-wrap:wrap;margin:6px 0 0}.proof{display:none}
    .product-card{background:white;border:1px solid var(--line);border-radius:26px;box-shadow:var(--shadow);overflow:hidden}.product-top{padding:18px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}.dots{display:flex;gap:7px}.dots i{width:10px;height:10px;border-radius:50%;background:#d6e2f0}.dash{padding:18px;display:grid;gap:14px}.metric-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.metric{background:#f7fbff;border:1px solid #e0eaf6;border-radius:18px;padding:16px}.metric strong{font-size:30px}.metric span{display:block;color:var(--muted);font-size:13px}.flow{display:grid;grid-template-columns:1fr 1fr;gap:12px}.mini{border:1px solid var(--line);border-radius:18px;padding:14px}.bar{height:10px;border-radius:999px;background:linear-gradient(90deg,var(--mint) 0 55%,#f04444 55%);margin-top:12px}
    .provide{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:24px}.provide .card ul{margin:12px 0 0;padding:0;list-style:none;display:grid;gap:8px}.provide .card li{color:var(--muted);font-size:14px;font-weight:750;padding-left:18px;position:relative}.provide .card li:before{content:"";position:absolute;left:0;top:8px;width:7px;height:7px;border-radius:50%;background:var(--blue)}#features{padding-top:36px;padding-bottom:36px}#features .provide{gap:12px;margin-top:16px}#features .grid{gap:12px;margin-top:16px}#features .card{padding:14px 16px;border-radius:18px;transition:transform .28s cubic-bezier(.22,1,.36,1),box-shadow .28s ease,border-color .28s ease}#features .card:hover{transform:translateY(-10px);border-color:var(--blue);box-shadow:0 20px 44px rgba(40,85,246,.18)}#features .card h3{margin:6px 0 4px;font-size:16px}#features .card .muted{font-size:12px;margin:0;line-height:1.4}#features .icon{width:32px;height:32px;border-radius:10px;font-size:13px;transition:transform .28s cubic-bezier(.22,1,.36,1)}#features .card:hover .icon{transform:scale(1.15) rotate(-8deg)}#features .provide .card ul{margin:8px 0 0;gap:4px}#features .provide .card li{font-size:12px;padding-left:14px}#features .provide .card li:before{top:6px;width:5px;height:5px}.feature-strip{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}.sections{padding:54px 0}.section-title{font-size:42px;letter-spacing:-.04em;line-height:1.08;margin:8px 0 12px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:24px}.card{background:white;border:1px solid var(--line);border-radius:22px;padding:24px;box-shadow:0 14px 38px rgba(16,32,51,.06)}.card h3{margin:10px 0 8px;font-size:20px}.icon{width:42px;height:42px;border-radius:14px;background:#eef5ff;display:grid;place-items:center;color:var(--blue);font-weight:950}.muted{color:var(--muted)}.compare{display:grid;grid-template-columns:1fr 56px 1fr;gap:0;margin:28px 0 8px;border:1px solid var(--line);border-radius:26px;overflow:hidden;background:#fff;box-shadow:0 14px 38px rgba(16,32,51,.06)}.compare-col{padding:22px 20px}.compare-col.old{background:#f8f4ee}.compare-col.new{background:#f3f8ff}.compare-head{display:flex;align-items:center;gap:10px;margin-bottom:16px}.compare-head strong{font-size:20px;letter-spacing:-.03em}.compare-head span{font-size:12px;font-weight:850;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.compare-vs{display:grid;place-items:center;background:linear-gradient(180deg,#fff,#eef4ff);font-weight:950;color:var(--blue);font-size:13px;letter-spacing:.08em}.compare-list{display:grid;gap:10px}.compare-item{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border-radius:14px;background:rgba(255,255,255,.78);font-size:14px;font-weight:750;line-height:1.35;color:#334761}.compare-item b{display:block;color:var(--ink);font-size:13px;margin-bottom:2px}.compare-item i{flex:0 0 28px;width:28px;height:28px;border-radius:9px;display:grid;place-items:center;font-style:normal;font-weight:950;font-size:13px}.compare-col.old .compare-item i{background:#fde8e8;color:#b42318}.compare-col.new .compare-item i{background:#e9fff7;color:#077354}
    .band{background:#0f2034;color:white;border-radius:30px;padding:34px;box-shadow:var(--shadow)}.band .muted{color:#c7d5e8}.closeout{background:#0f2034;color:#fff;border-radius:30px;padding:clamp(32px,5vw,52px) clamp(22px,4vw,48px);text-align:center;box-shadow:var(--shadow)}.closeout .eyebrow{color:#8bd8ff}.closeout .section-title{color:#fff;max-width:18ch;margin-left:auto;margin-right:auto}.closeout .lead{color:#c7d5e8;max-width:42em;margin:0 auto}.closeout-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:28px 0 32px;text-align:left}.closeout-grid article{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:18px}.closeout-grid strong{display:block;margin-bottom:6px;font-size:16px}.closeout-grid p{margin:0;color:#c7d5e8;font-size:14px;font-weight:750}.closeout .cta{justify-content:center;margin-top:0}.closeout .btn.light{background:#fff;color:#102033;border-color:#fff}.split{display:grid;grid-template-columns:.95fr 1.05fr;gap:24px;align-items:start}.price-card{background:linear-gradient(145deg,#fff,var(--cream));border:1px solid #f1dec0;border-radius:26px;padding:28px;box-shadow:var(--shadow)}.price-old{text-decoration:line-through;color:#7b8795;font-size:22px;font-weight:900}.price{font-size:62px;font-weight:980;letter-spacing:-.06em;line-height:1}.price-unit{font-size:18px;font-weight:850;letter-spacing:0;color:#5d6f86}.save{display:inline-flex;background:#e9fff7;color:#077354;border:1px solid #bdf4df;border-radius:999px;padding:8px 12px;font-weight:950;margin:12px 0}.start-heading{margin:4px 0 8px;font-size:28px;letter-spacing:-.04em;line-height:1.15}.start-steps{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 16px;font-size:12px;font-weight:850;color:#5d6f86}.start-steps .on{color:var(--blue)}.start-steps i{flex:1;height:1px;min-width:20px;background:#dbe6f4}.form-kicker{margin:0;font-size:13px;font-weight:900;color:#314861}.form-block{display:grid;gap:8px}.form-block h3{margin:6px 0 0;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#5d6f86}.trust-row{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:12px;font-size:12px;font-weight:850;color:#31506f}.start-reassure{margin:8px 0 0;text-align:center}.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.chip{border:1px solid #d6e4f4;background:#fff;border-radius:999px;padding:8px 11px;font-weight:850;font-size:13px}
    .form-shell{position:relative;overflow:hidden;border-radius:30px;background:linear-gradient(145deg,#ffffff 0%,#f8fbff 58%,#eef6ff 100%);border:1px solid #d7e4f5;box-shadow:0 24px 70px rgba(16,32,51,.1)}.form-shell:before{content:"";position:absolute;inset:-120px auto auto -110px;width:260px;height:260px;border-radius:50%;background:rgba(33,182,232,.16)}.form-shell:after{content:"";position:absolute;right:-120px;bottom:-140px;width:280px;height:280px;border-radius:50%;background:rgba(40,85,246,.12)}.form-content{position:relative;z-index:1;display:grid;grid-template-columns:.9fr 1.1fr;gap:30px;padding:30px}.form-panel{background:rgba(255,255,255,.86);border:1px solid #dbe7f6;border-radius:24px;padding:22px;box-shadow:0 18px 45px rgba(16,32,51,.08)}.form{display:grid;gap:14px}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:grid;gap:7px;font-weight:900;color:#314861;font-size:13px}input,select,textarea{width:100%;border:1px solid #c9d8ec;border-radius:16px;padding:14px 15px;font:inherit;background:white;color:var(--ink);box-shadow:0 8px 20px rgba(16,32,51,.035);outline:none}input:focus,select:focus,textarea:focus{border-color:var(--blue);box-shadow:0 0 0 4px rgba(40,85,246,.12)}textarea{min-height:116px;resize:vertical}.form-note{display:flex;align-items:flex-start;gap:10px;border:1px solid #cfe7ff;background:#f4faff;color:#36516f;border-radius:18px;padding:12px 13px;font-size:13px;font-weight:750}.form-note b{color:#102033}.check-list{display:grid;gap:10px;margin:22px 0}.check-list span{display:flex;gap:10px;align-items:flex-start;color:#4c6078;font-weight:750}.check-list span:before{content:"✓";display:grid;place-items:center;flex:0 0 22px;width:22px;height:22px;border-radius:50%;background:#e9fff7;color:#07825e;font-weight:950}.fine{font-size:13px;color:var(--muted)}.intent{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.intent label{border:1px solid #d6e4f4;border-radius:16px;padding:11px 10px;cursor:pointer;background:#fff;font-size:12px;line-height:1.35;font-weight:850;color:#314861}.intent label strong{display:block;font-size:13px;color:var(--ink);margin-bottom:2px}.intent input{accent-color:var(--blue);margin-right:6px}.intent label:has(input:checked){border-color:var(--blue);background:#eef4ff;box-shadow:0 0 0 3px rgba(40,85,246,.12)}.app-band{display:grid;grid-template-columns:1.05fr .95fr;gap:36px;align-items:center}.device-stage{position:relative;width:100%;max-width:none;margin:0 0 0 auto;padding:0 0 12px;display:block}.laptop{position:relative;width:calc(100% - 56px);margin-right:56px;margin-left:auto}.laptop-lid{background:#1b232e;border-radius:16px 16px 8px 8px;padding:12px 12px 10px;box-shadow:0 30px 70px rgba(16,32,51,.2)}.laptop-screen{position:relative;aspect-ratio:16/10;background:#0b1220;border-radius:6px;overflow:hidden}.laptop-screen video,.laptop-screen img,.phone-screen video,.phone-screen img{position:absolute;inset:0;width:100%;height:100%;background:#0b1220}.laptop-screen img{object-fit:contain;object-position:center}.phone-screen img{object-fit:cover}.demo-frame{opacity:0;transition:opacity .2s ease;z-index:0;pointer-events:none}.demo-frame.is-on{opacity:1;z-index:1}.laptop-base{height:12px;margin:0 7%;background:linear-gradient(#e2e7ee,#9aa4b0);border-radius:0 0 14px 14px;position:relative;box-shadow:0 8px 20px rgba(16,32,51,.1)}.laptop-base:after{content:"";position:absolute;left:50%;top:0;transform:translateX(-50%);width:86px;height:6px;border-radius:0 0 8px 8px;background:#848e9b}.phone-shell{position:absolute;right:8px;bottom:12px;z-index:3;width:132px;margin:0;background:#102033;border-radius:24px;padding:8px 7px 10px;box-shadow:0 18px 40px rgba(16,32,51,.28)}.phone-notch{width:52px;height:5px;border-radius:999px;background:#2a415c;margin:2px auto 6px}.phone-screen{position:relative;background:#0b1220;border-radius:16px;overflow:hidden;aspect-ratio:9/19.5;min-height:0}.stats-bar{width:100%;background:#0f2034;color:#fff;padding:32px 0}.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;align-items:center}.stats-row article{display:flex;align-items:center;gap:14px}.stats-row .mark{flex:0 0 42px;width:42px;height:42px;border-radius:12px;background:rgba(255,255,255,.1);display:grid;place-items:center;font-weight:950}.stats-row b{display:block;font-size:26px;line-height:1.1}.stats-row span{display:block;font-size:13px;color:#c7d5e8;font-weight:750}.phone-screen video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#0b1220}.phone-screen .metric{padding:12px}.phone-screen .metric strong{font-size:22px}.store-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.store-badge{display:inline-flex;align-items:center;gap:8px;border:1px solid #c9d8ec;background:#102033;color:#fff;border-radius:14px;padding:12px 16px;font-weight:900;font-size:13px}.store-badge span{display:block;font-size:10px;font-weight:750;opacity:.75;text-transform:uppercase;letter-spacing:.08em}.admin{padding:38px 0 70px}.table{width:100%;border-collapse:separate;border-spacing:0;background:white;border:1px solid var(--line);border-radius:18px;overflow:hidden}.table th,.table td{padding:12px;border-bottom:1px solid #edf2fa;text-align:left;vertical-align:top}.table th{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#52657d;background:#f8fbff}.badge{display:inline-block;border-radius:999px;padding:4px 8px;background:#eaf2ff;color:#174ea6;font-weight:900;font-size:12px}.admin-card{background:white;border:1px solid var(--line);border-radius:20px;padding:18px;margin-top:18px}footer{border-top:1px solid var(--line);padding:26px 0;color:var(--muted);background:white}#start,#features,#android,#why,#pricing{scroll-margin-top:100px}#start{padding:36px 0 48px}#start .section-title{font-size:32px;margin:6px 0 8px;line-height:1.12}#start .price{font-size:48px}#start .price-card,#start .form-shell{padding:0}#start .price-card{padding:26px 24px}#start .form-content{padding:16px!important;gap:0}#start .form-panel{padding:18px 20px}#start .form{gap:12px}#start label{gap:4px;font-size:12px}#start input,#start select,#start textarea{padding:10px 12px;border-radius:12px;font-size:14px}#start textarea{min-height:48px}#start .intent{gap:8px}#start .intent label{padding:10px 9px;font-size:12px;border-radius:14px}#start .intent label strong{font-size:13px;margin-bottom:2px}#start .two{gap:10px}#start .btn{padding:12px 16px}.path-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:8px 0 22px}.path-card{position:relative;text-align:left;border:1px solid var(--line);background:#fff;border-radius:20px;padding:16px;cursor:pointer;box-shadow:0 10px 24px rgba(16,32,51,.05)}.path-card b{display:block;font-size:16px;margin:4px 0 2px}.path-card p{margin:0;color:var(--muted);font-size:13px;font-weight:750}.path-card.is-on{border-color:var(--blue);box-shadow:0 0 0 3px rgba(40,85,246,.14)}.path-card.is-popular{border-color:#c9d8ec}.path-pop{position:absolute;top:-10px;right:12px;background:var(--blue);color:#fff;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:950;letter-spacing:.06em;text-transform:uppercase}.offer-block[hidden],.journey[hidden],.j-step[hidden]{display:none!important}.cal-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.cal-day{border:1px solid var(--line);border-radius:14px;padding:8px;background:#fff;text-align:center}.cal-day strong{display:block;font-size:12px}.cal-day button{width:100%;margin-top:6px;border:1px solid #d6e4f4;border-radius:10px;background:#f8fbff;padding:6px 4px;font-size:11px;font-weight:850;cursor:pointer}.cal-day button.is-on{background:var(--blue);color:#fff;border-color:var(--blue)}.start-head{text-align:center;margin-bottom:8px}.start-head .section-title{font-size:32px;margin:4px 0 6px}.path-card{transition:transform .28s cubic-bezier(.22,1,.36,1),box-shadow .28s ease,border-color .28s ease,background .28s ease}.path-card:hover{transform:translateY(-12px) scale(1.04);border-color:var(--blue);background:#f7faff;box-shadow:0 22px 50px rgba(40,85,246,.22)}.path-card.is-on{transform:translateY(-8px);border-color:var(--blue);box-shadow:0 0 0 4px rgba(40,85,246,.18),0 18px 40px rgba(40,85,246,.16);animation:path-pulse 1.5s ease-in-out infinite}.path-card.is-on:hover{transform:translateY(-14px) scale(1.05);animation:none}.path-card .icon{transition:transform .28s cubic-bezier(.22,1,.36,1)}.path-card:hover .icon,.path-card.is-on .icon{transform:scale(1.18) rotate(-10deg)}.path-old{text-decoration:line-through;color:#8b97a6;font-weight:800;margin-right:6px}.path-launch p strong{color:#077354}.path-save{position:absolute;top:-10px;left:12px;background:#e9fff7;color:#077354;border:1px solid #bdf4df;border-radius:999px;padding:3px 8px;font-size:10px;font-weight:950}.offer-block:not([hidden]),.journey:not([hidden]),.j-step:not([hidden]){animation:start-fade .35s ease}#start .btn.primary{transition:transform .25s ease,box-shadow .25s ease}#start .btn.primary:hover{transform:translateY(-3px);box-shadow:0 18px 36px rgba(40,85,246,.32)}@keyframes start-fade{from{opacity:0}to{opacity:1}}@keyframes path-pulse{0%,100%{box-shadow:0 0 0 4px rgba(40,85,246,.16),0 16px 36px rgba(40,85,246,.14)}50%{box-shadow:0 0 0 8px rgba(40,85,246,.28),0 22px 48px rgba(40,85,246,.22)}}
    @media(prefers-reduced-motion:reduce){.demo-frame,.path-card,.path-card .icon,#start .btn.primary,#features .card,#features .icon{transition:none}body:before,body:after,.path-card.is-on,.offer-block:not([hidden]),.journey:not([hidden]),.j-step:not([hidden]){animation:none}}
    @media(max-width:1024px){.hero-grid{grid-template-columns:.9fr 1.1fr;gap:32px}h1{font-size:44px}.laptop{width:calc(100% - 48px);margin-right:48px}.phone-shell{right:8px;bottom:12px}}
    @media(max-width:768px){.hero-grid,.grid,.two,.split,.flow,.form-content,.app-band,.intent,.provide,.stats-row,.compare,.closeout-grid,.path-grid,.cal-grid{grid-template-columns:1fr}.compare-vs{min-height:44px}.navlinks,.nav-call{display:none}.nav .wrap{height:72px}.hero{padding:32px 0 40px}.hero-grid{text-align:center}.hero-copy{align-items:center}.cta{justify-content:center}.hero-visual{margin-top:12px}.device-stage{padding:0 0 12px;max-width:420px;margin:0 auto}.laptop{width:calc(100% - 40px);margin-right:40px}.phone-shell{width:120px;right:4px;bottom:10px}h1{font-size:36px;max-width:none}.lead{max-width:36em}.price{font-size:48px}.table{font-size:14px}.form-content{padding:18px}.form-panel{padding:16px}#start .price{font-size:36px}.wrap{width:min(1360px,calc(100% - 40px))}}
  </style>
  ${extraHead}
</head>
<body class="${escapeHtml(bodyClass)}">${body}</body>
</html>`;
}

const MARKETING_CSS = `<style>
  body.marketing-page{--ink:#111827;--muted:#667085;--blue:#2456e8;--blue-deep:#173fbd;--line:#dfe4ec;--soft:#f6f8fb;--green:#07865c;--amber:#b54708;background:#fff;color:var(--ink);font-size:16px;line-height:1.55;overflow-x:hidden}
  body.marketing-page:before{background:linear-gradient(180deg,#f7f9ff 0,#fff 21%,#fff 100%);animation:none}
  body.marketing-page:after{opacity:.45;background-image:linear-gradient(rgba(36,86,232,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(36,86,232,.045) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(#000 0,transparent 22%);animation:none}
  body.marketing-page *{letter-spacing:0!important}
  body.marketing-page .wrap{width:min(1180px,calc(100% - 48px));margin-inline:auto}
  body.marketing-page .nav{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.9);border-bottom:1px solid rgba(223,228,236,.9);box-shadow:none;backdrop-filter:blur(16px)}
  body.marketing-page .nav .wrap{height:72px;display:flex;align-items:center;justify-content:space-between;gap:28px}
  body.marketing-page .brand{display:flex;align-items:center;gap:10px;font-size:21px;font-weight:800}
  body.marketing-page .brand .mark{width:34px;height:34px;border-radius:8px;background:var(--blue);box-shadow:none;font-size:15px}
  body.marketing-page .nav-end{gap:12px}
  body.marketing-page .navlinks{gap:26px;color:#475467;font-size:14px;font-weight:650}
  body.marketing-page .navlinks a{padding:24px 0;border-bottom:2px solid transparent;transition:color .18s ease,border-color .18s ease}
  body.marketing-page .navlinks a:after{display:none}
  body.marketing-page .navlinks a:hover{color:var(--ink);border-color:#b8c5eb}
  body.marketing-page .nav-actions{display:flex;align-items:center;gap:10px}
  body.marketing-page .btn{min-height:42px;border-radius:8px;border:1px solid #cfd6e3;padding:10px 16px;background:#fff;color:#26364d;font-size:14px;font-weight:750;box-shadow:none;transition:background .18s ease,border-color .18s ease,color .18s ease,transform .18s ease}
  body.marketing-page .btn:hover{transform:translateY(-1px);border-color:#98a7be;background:#f8fafc}
  body.marketing-page .btn.primary{background:var(--blue);border-color:var(--blue);color:#fff;box-shadow:0 8px 20px rgba(36,86,232,.18)}
  body.marketing-page .btn.primary:hover{background:var(--blue-deep);border-color:var(--blue-deep)}
  body.marketing-page .btn.light{background:#fff;color:var(--ink)}
  body.marketing-page .mobile-nav{display:none;position:relative}
  body.marketing-page .mobile-nav summary{list-style:none;width:42px;height:42px;border:1px solid #d6dce7;border-radius:8px;display:grid;place-items:center;cursor:pointer;font-size:21px}
  body.marketing-page .mobile-nav summary::-webkit-details-marker{display:none}
  body.marketing-page .mobile-nav-menu{position:absolute;right:0;top:50px;width:250px;padding:10px;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 48px rgba(16,24,40,.16);display:grid;gap:2px}
  body.marketing-page .mobile-nav-menu a{padding:11px 12px;border-radius:6px;color:#344054;font-weight:700}
  body.marketing-page .mobile-nav-menu a:last-child{margin-top:6px;background:var(--blue);color:#fff;text-align:center}
  body.marketing-page .hero{padding:78px 0 0;text-align:center}
  body.marketing-page .hero-copy{align-items:center;gap:18px;max-width:900px;margin:0 auto}
  body.marketing-page .eyebrow{display:flex;align-items:center;gap:9px;color:var(--blue);font-size:12px;font-weight:800;text-transform:uppercase}
  body.marketing-page .hero .eyebrow:before,body.marketing-page .section-head .eyebrow:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--blue)}
  body.marketing-page .hero h1{max-width:860px;margin:0;font-size:68px;line-height:1.02;font-weight:780}
  body.marketing-page .hero .lead{max-width:720px;font-size:19px;line-height:1.6;color:#526078}
  body.marketing-page .hero .cta{justify-content:center;margin-top:2px}
  body.marketing-page .hero .btn{min-height:48px;padding:12px 20px;font-size:15px}
  body.marketing-page .trust-note{margin:0;color:#667085;font-size:13px;font-weight:650}
  body.marketing-page .module-rail{margin-top:56px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:rgba(255,255,255,.76)}
  body.marketing-page .module-row{min-height:78px;display:grid;grid-template-columns:repeat(6,1fr);align-items:center}
  body.marketing-page .module-row span{display:flex;align-items:center;justify-content:center;gap:8px;min-height:38px;border-right:1px solid #e8ebf1;color:#4b5870;font-size:13px;font-weight:750}
  body.marketing-page .module-row span:last-child{border-right:0}
  body.marketing-page .module-row i{width:7px;height:7px;border:2px solid var(--blue);border-radius:50%}
  body.marketing-page .hero-visual{position:relative;max-width:1120px;margin:44px auto -56px;text-align:left}
  body.marketing-page .device-stage{position:relative;width:100%;padding:0 52px 44px 0}
  body.marketing-page .product-window{overflow:hidden;border:1px solid #ccd4e1;border-radius:8px;background:#fff;box-shadow:0 30px 80px rgba(23,36,65,.16),0 2px 8px rgba(23,36,65,.08)}
  body.marketing-page .product-chrome{height:42px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 14px;border-bottom:1px solid #e4e8ef;background:#f7f8fa;color:#667085;font-size:11px;font-weight:700}
  body.marketing-page .chrome-dots{display:flex;gap:6px}
  body.marketing-page .chrome-dots i{width:8px;height:8px;border-radius:50%;background:#cbd2dd}
  body.marketing-page .product-live{justify-self:end;display:flex;align-items:center;gap:7px;color:#475467}
  body.marketing-page .product-live i,body.marketing-page .product-caption i{width:7px;height:7px;border-radius:50%;background:#13a373;box-shadow:0 0 0 3px rgba(19,163,115,.11)}
  body.marketing-page .product-screen{position:relative;overflow:hidden;aspect-ratio:16/7.2;background:#eef2f8}
  body.marketing-page .product-shot{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
  body.marketing-page .phone-shell{position:absolute;right:0;bottom:24px;width:168px;padding:8px 7px 10px;border:1px solid #253247;border-radius:27px;background:#101828;box-shadow:0 22px 50px rgba(16,24,40,.3)}
  body.marketing-page .phone-notch{width:50px;height:5px;margin:1px auto 6px;background:#344054}
  body.marketing-page .phone-screen{position:relative;aspect-ratio:9/19.5;border-radius:19px;background:#eef2f8;overflow:hidden}
  body.marketing-page .phone-shot{display:block;width:100%;height:100%;object-fit:cover;background:#eef2f8}
  body.marketing-page .product-caption{position:absolute;left:20px;bottom:18px;display:flex;gap:18px;padding:9px 12px;border:1px solid #d9dfe8;border-radius:8px;background:rgba(255,255,255,.92);box-shadow:0 10px 26px rgba(16,24,40,.1);backdrop-filter:blur(10px)}
  body.marketing-page .product-caption span{display:flex;align-items:center;gap:7px;color:#475467;font-size:10px;font-weight:750}
  body.marketing-page .market-section{padding:112px 0}
  body.marketing-page .section-head{max-width:720px;margin-bottom:56px}
  body.marketing-page .section-head.center{margin-inline:auto;text-align:center;display:flex;flex-direction:column;align-items:center}
  body.marketing-page .section-title{margin:10px 0 14px;font-size:46px;line-height:1.1;font-weight:760}
  body.marketing-page .section-head .lead{font-size:17px;line-height:1.65;color:#667085;max-width:680px}
  body.marketing-page .value-section{padding-top:152px;padding-bottom:104px;background:#fff}
  body.marketing-page .value-statement{display:grid;grid-template-columns:1.1fr .9fr;gap:88px;align-items:end;padding-bottom:54px;border-bottom:1px solid var(--line)}
  body.marketing-page .value-statement h2{margin:0;max-width:700px;font-size:50px;line-height:1.08;font-weight:760}
  body.marketing-page .value-statement p{margin:0;color:#667085;font-size:17px;line-height:1.7}
  body.marketing-page .record-flow{display:grid;grid-template-columns:repeat(3,1fr);margin-top:36px}
  body.marketing-page .record-flow article{position:relative;padding:18px 34px 10px 0;border-right:1px solid var(--line)}
  body.marketing-page .record-flow article+article{padding-left:34px}
  body.marketing-page .record-flow article:last-child{border-right:0}
  body.marketing-page .record-flow span{display:block;color:var(--blue);font-size:12px;font-weight:800;text-transform:uppercase}
  body.marketing-page .record-flow strong{display:block;margin-top:5px;font-size:20px}
  body.marketing-page .record-flow p{margin:5px 0 0;color:#667085;font-size:14px}
  body.marketing-page .workflow-section{background:var(--soft);box-shadow:0 0 0 100vmax var(--soft);clip-path:inset(0 -100vmax)}
  body.marketing-page .workflow-list{display:grid;gap:96px}
  body.marketing-page .workflow{display:grid;grid-template-columns:1.08fr .92fr;gap:72px;align-items:center}
  body.marketing-page .workflow.is-reverse{grid-template-columns:.92fr 1.08fr}
  body.marketing-page .workflow.is-reverse .workflow-copy{order:-1}
  body.marketing-page .workflow-copy .eyebrow{margin-bottom:12px}
  body.marketing-page .workflow-copy h3{margin:0 0 14px;font-size:36px;line-height:1.14}
  body.marketing-page .workflow-copy>p{margin:0;color:#667085;font-size:16px;line-height:1.7}
  body.marketing-page .workflow-points{display:grid;gap:0;margin-top:24px;border-top:1px solid #d8dee8}
  body.marketing-page .workflow-points span{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid #d8dee8;color:#344054;font-size:14px;font-weight:700}
  body.marketing-page .workflow-points span:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--blue)}
  body.marketing-page .shot-frame{overflow:hidden;border:1px solid #ccd4e1;border-radius:8px;background:#fff;box-shadow:0 18px 45px rgba(23,36,65,.11)}
  body.marketing-page .shot-top{height:36px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;border-bottom:1px solid #e4e8ef;background:#fff;color:#667085;font-size:10px;font-weight:700}
  body.marketing-page .shot-top b{color:#344054}
  body.marketing-page .static-app-crop{position:relative;aspect-ratio:16/9.2;overflow:hidden;background:#eef2f8}
  body.marketing-page .static-app-crop img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top;background:#eef2f8}
  body.marketing-page .role-section{background:#fff}
  body.marketing-page .role-shell{border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  body.marketing-page .role-tabs{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line)}
  body.marketing-page .role-tab{position:relative;border:0;border-right:1px solid var(--line);padding:18px 14px;background:#fff;color:#667085;font:inherit;font-size:14px;font-weight:750;cursor:pointer}
  body.marketing-page .role-tab:last-child{border-right:0}
  body.marketing-page .role-tab[aria-selected="true"]{color:var(--blue);background:#f8faff}
  body.marketing-page .role-tab[aria-selected="true"]:after{content:"";position:absolute;left:24px;right:24px;bottom:-1px;height:2px;background:var(--blue)}
  body.marketing-page .role-panel{display:grid;grid-template-columns:.82fr 1.18fr;gap:72px;align-items:center;padding:50px 0}
  body.marketing-page .role-panel[hidden]{display:none}
  body.marketing-page .role-copy h3{margin:0 0 12px;font-size:32px}
  body.marketing-page .role-copy p{margin:0;color:#667085;line-height:1.7}
  body.marketing-page .role-list{display:grid;gap:10px;margin-top:22px}
  body.marketing-page .role-list span{display:flex;gap:9px;color:#344054;font-size:14px;font-weight:700}
  body.marketing-page .role-list span:before{content:"✓";color:var(--green);font-weight:900}
  body.marketing-page .role-visual{max-width:620px;justify-self:end;width:100%}
  body.marketing-page .switch-section{padding-top:0}
  body.marketing-page .switch-band{display:grid;grid-template-columns:.85fr 1.15fr;gap:76px;padding:62px;border-radius:8px;background:#111827;color:#fff}
  body.marketing-page .switch-band .eyebrow{color:#a9bfff}
  body.marketing-page .switch-band h2{margin:10px 0 14px;font-size:42px;line-height:1.1}
  body.marketing-page .switch-band p{margin:0;color:#bdc6d5;line-height:1.7}
  body.marketing-page .switch-steps{display:grid;gap:0}
  body.marketing-page .switch-step{display:grid;grid-template-columns:38px 1fr;gap:14px;padding:14px 0;border-bottom:1px solid rgba(255,255,255,.13)}
  body.marketing-page .switch-step:last-child{border-bottom:0}
  body.marketing-page .switch-step span{width:30px;height:30px;border:1px solid rgba(255,255,255,.24);border-radius:50%;display:grid;place-items:center;color:#a9bfff;font-size:12px;font-weight:800}
  body.marketing-page .switch-step strong{display:block;font-size:15px}
  body.marketing-page .switch-step p{margin:3px 0 0;font-size:13px}
  body.marketing-page .india-strip{display:grid;grid-template-columns:1.1fr repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  body.marketing-page .india-strip>*{padding:24px;border-right:1px solid var(--line)}
  body.marketing-page .india-strip>*:last-child{border-right:0}
  body.marketing-page .india-strip h3{margin:0;font-size:22px}
  body.marketing-page .india-strip strong{display:block;font-size:14px}
  body.marketing-page .india-strip p{margin:4px 0 0;color:#667085;font-size:12px}
  body.marketing-page #start{padding:104px 0;scroll-margin-top:72px;background:var(--soft);box-shadow:0 0 0 100vmax var(--soft);clip-path:inset(0 -100vmax)}
  body.marketing-page #start .start-head{max-width:650px;margin:0 auto 34px}
  body.marketing-page #start .start-head .section-title{font-size:44px}
  body.marketing-page #start .path-grid{max-width:900px;margin:0 auto 26px;gap:8px}
  body.marketing-page #start .path-card{min-height:108px;border-radius:8px;padding:16px;background:#fff;border-color:#d9dfe8;box-shadow:none;transition:border-color .18s ease,background .18s ease}
  body.marketing-page #start .path-card:hover{transform:none;border-color:#9aabe0;background:#fbfcff;box-shadow:none}
  body.marketing-page #start .path-card.is-on{transform:none;border-color:var(--blue);background:#f7f9ff;box-shadow:0 0 0 2px rgba(36,86,232,.12);animation:none}
  body.marketing-page #start .path-card .icon{width:30px;height:30px;border-radius:7px;font-size:12px;transform:none;background:#edf2ff}
  body.marketing-page #start .path-card b{font-size:15px}
  body.marketing-page #start .path-card p{font-size:12px;font-weight:650}
  body.marketing-page #start .path-pop,body.marketing-page #start .path-save{top:8px;right:10px;left:auto;border:0;border-radius:4px;padding:3px 6px;background:#edf2ff;color:#214bbf}
  body.marketing-page #start .start-split{max-width:980px;margin:0 auto;grid-template-columns:.8fr 1.2fr;gap:16px}
  body.marketing-page #start .price-card,body.marketing-page #start .form-shell{border-radius:8px;border-color:#d9dfe8;background:#fff;box-shadow:none}
  body.marketing-page #start .price-card{padding:26px}
  body.marketing-page #start .form-shell:before,body.marketing-page #start .form-shell:after{display:none}
  body.marketing-page #start .form-content{padding:8px!important}
  body.marketing-page #start .form-panel{border:0;border-radius:6px;padding:18px;box-shadow:none;background:#fff}
  body.marketing-page #start input,body.marketing-page #start select,body.marketing-page #start textarea{border-radius:7px;box-shadow:none}
  body.marketing-page #start .check-list span:before{border-radius:50%;background:#e8f7f1;color:var(--green)}
  body.marketing-page #start .cal-day,body.marketing-page #start .cal-day button{border-radius:7px}
  body.marketing-page .closeout{border-radius:8px;padding:72px 42px;background:#111827;box-shadow:none}
  body.marketing-page .closeout .eyebrow{justify-content:center;color:#a9bfff}
  body.marketing-page .closeout .section-title{max-width:760px;margin:12px auto 16px;font-size:46px}
  body.marketing-page .closeout .lead{max-width:660px;color:#bdc6d5}
  body.marketing-page .closeout-grid{display:none}
  body.marketing-page .closeout .cta{margin-top:28px}
  body.marketing-page .closeout .btn.light{background:transparent;color:#fff;border-color:#647086}
  body.marketing-page footer{padding:44px 0 30px;background:#fff;border-top:1px solid var(--line)}
  body.marketing-page .footer-grid{display:grid;grid-template-columns:1fr auto;gap:30px;align-items:start}
  body.marketing-page .footer-brand p{max-width:420px;margin:10px 0 0;color:#667085;font-size:13px}
  body.marketing-page .footer-links{display:flex;gap:24px;color:#475467;font-size:13px;font-weight:700}
  body.marketing-page .footer-base{margin-top:34px;padding-top:20px;border-top:1px solid #eceff3;color:#98a2b3;font-size:12px}
  body.marketing-page #product,body.marketing-page #solutions,body.marketing-page #roles,body.marketing-page #why,body.marketing-page #pricing{scroll-margin-top:72px}
  @media(max-width:1024px){
    body.marketing-page .hero h1{font-size:58px}
    body.marketing-page .workflow,body.marketing-page .workflow.is-reverse{grid-template-columns:1fr 1fr;gap:44px}
    body.marketing-page .value-statement{gap:48px}
    body.marketing-page .switch-band{gap:48px;padding:48px}
  }
  @media(max-width:820px){
    body.marketing-page .wrap{width:min(100% - 32px,720px)}
    body.marketing-page .desktop-nav{display:none}
    body.marketing-page .mobile-nav{display:block}
    body.marketing-page .hero{padding-top:58px}
    body.marketing-page .hero h1{font-size:50px}
    body.marketing-page .hero .lead{font-size:17px}
    body.marketing-page .module-row{grid-template-columns:repeat(3,1fr);padding:8px 0}
    body.marketing-page .module-row span:nth-child(3){border-right:0}
    body.marketing-page .module-row span:nth-child(-n+3){border-bottom:1px solid #e8ebf1}
    body.marketing-page .hero-visual{margin-top:34px;margin-bottom:-34px}
    body.marketing-page .device-stage{padding-right:34px}
    body.marketing-page .phone-shell{width:130px}
    body.marketing-page .market-section{padding:86px 0}
    body.marketing-page .value-section{padding-top:120px}
    body.marketing-page .value-statement,body.marketing-page .workflow,body.marketing-page .workflow.is-reverse,body.marketing-page .role-panel,body.marketing-page .switch-band{grid-template-columns:1fr;gap:34px}
    body.marketing-page .workflow.is-reverse .workflow-copy{order:0}
    body.marketing-page .value-statement h2{font-size:42px}
    body.marketing-page .role-visual{justify-self:start}
    body.marketing-page .switch-band{padding:42px 34px}
    body.marketing-page .india-strip{grid-template-columns:1fr 1fr}
    body.marketing-page .india-strip>*:nth-child(2){border-right:0}
    body.marketing-page .india-strip>*:nth-child(-n+2){border-bottom:1px solid var(--line)}
    body.marketing-page #start .start-split{grid-template-columns:1fr}
  }
  @media(max-width:560px){
    body.marketing-page .wrap{width:calc(100% - 28px)}
    body.marketing-page .nav .wrap{height:64px}
    body.marketing-page .brand{font-size:19px}
    body.marketing-page .hero{padding-top:44px}
    body.marketing-page .hero h1{font-size:40px;line-height:1.06}
    body.marketing-page .hero .lead{font-size:16px;line-height:1.55}
    body.marketing-page .hero .cta{width:100%;display:grid;grid-template-columns:1fr}
    body.marketing-page .hero .btn{width:100%}
    body.marketing-page .module-rail{margin-top:40px}
    body.marketing-page .module-row{grid-template-columns:repeat(2,1fr)}
    body.marketing-page .module-row span{min-height:44px;font-size:11px;border-bottom:1px solid #e8ebf1}
    body.marketing-page .module-row span:nth-child(2n){border-right:0}
    body.marketing-page .module-row span:nth-last-child(-n+2){border-bottom:0}
    body.marketing-page .hero-visual{margin:24px auto -22px}
    body.marketing-page .device-stage{padding:0 18px 34px 0}
    body.marketing-page .product-chrome{height:34px;grid-template-columns:1fr auto;font-size:9px}
    body.marketing-page .product-chrome>span:nth-child(2){display:none}
    body.marketing-page .phone-shell{width:86px;right:-2px;bottom:20px;padding:5px 4px 6px;border-radius:18px}
    body.marketing-page .phone-screen{border-radius:12px}
    body.marketing-page .phone-notch{width:30px;height:3px;margin-bottom:4px}
    body.marketing-page .product-caption{left:8px;bottom:12px;gap:8px;padding:6px 7px}
    body.marketing-page .product-caption span{font-size:6px;gap:4px}
    body.marketing-page .product-caption i{width:5px;height:5px}
    body.marketing-page .market-section{padding:72px 0}
    body.marketing-page .section-head{margin-bottom:36px}
    body.marketing-page .section-title,body.marketing-page #start .start-head .section-title,body.marketing-page .closeout .section-title{font-size:34px}
    body.marketing-page .value-section{padding-top:98px}
    body.marketing-page .value-statement{gap:20px;padding-bottom:34px}
    body.marketing-page .value-statement h2{font-size:35px}
    body.marketing-page .value-statement p{font-size:15px}
    body.marketing-page .record-flow{grid-template-columns:1fr}
    body.marketing-page .record-flow article,body.marketing-page .record-flow article+article{padding:16px 0;border-right:0;border-bottom:1px solid var(--line)}
    body.marketing-page .record-flow article:last-child{border-bottom:0}
    body.marketing-page .workflow-list{gap:64px}
    body.marketing-page .workflow-copy h3{font-size:29px}
    body.marketing-page .role-tabs{grid-template-columns:1fr 1fr}
    body.marketing-page .role-tab:nth-child(2){border-right:0}
    body.marketing-page .role-tab:nth-child(-n+2){border-bottom:1px solid var(--line)}
    body.marketing-page .role-panel{padding:34px 0}
    body.marketing-page .switch-band{padding:34px 24px}
    body.marketing-page .switch-band h2{font-size:34px}
    body.marketing-page .india-strip{grid-template-columns:1fr}
    body.marketing-page .india-strip>*{border-right:0;border-bottom:1px solid var(--line)!important;padding:18px 0}
    body.marketing-page .india-strip>*:last-child{border-bottom:0!important}
    body.marketing-page #start{padding:76px 0}
    body.marketing-page #start .path-grid{grid-template-columns:1fr;gap:8px}
    body.marketing-page #start .path-card{min-height:88px}
    body.marketing-page #start .two{grid-template-columns:1fr!important}
    body.marketing-page #start .cal-grid{grid-template-columns:1fr 1fr}
    body.marketing-page .closeout{padding:50px 20px}
    body.marketing-page .footer-grid{grid-template-columns:1fr}
    body.marketing-page .footer-links{flex-wrap:wrap;gap:14px 22px}
  }
  @media(prefers-reduced-motion:reduce){body.marketing-page .btn{transition:none}}
</style>`;

export async function marketingHtml(message = "") {
  const pricing = await getSitePricing();
  const sale = formatInr(pricing.salePrice);
  const list = formatInr(pricing.listPrice);
  const save = formatInr(pricing.saveAmount);
  const trial = pricing.trialDays;
  const period = pricing.billingPeriod;
  const planName = pricing.planName;
  const offer = pricing.offerLabel || "Launch offer";
  const saveChip = pricing.saveAmount > 0 ? `<span class="path-save">Save ₹${save}${pricing.savePercent ? ` · ${pricing.savePercent}% off` : ""}</span>` : "";
  const oldInline = pricing.saveAmount > 0 ? `<span class="path-old">₹${list}</span> ` : "";
  const oldBlock = pricing.saveAmount > 0 ? `<div class="price-old">₹${list}</div>` : "";
  const saveBlock = pricing.saveAmount > 0 ? `<span class="save">${escapeHtml(pricing.offerLabel ? `${pricing.offerLabel} · ` : "")}Save ₹${save}</span>` : "";
  const title = "Anekio | School ERP for India-first schools";
  const description =
    "Anekio helps schools manage admissions, fees, attendance, exams, documents, parent communication, teachers, and daily operations in one connected school ERP.";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: PRODUCT_NAME,
    applicationCategory: "School management software",
    operatingSystem: "Web, Android, iOS",
    offers: { "@type": "Offer", price: String(pricing.salePrice), priceCurrency: "INR", availability: "https://schema.org/InStock" },
    audience: { "@type": "EducationalAudience", educationalRole: "School administrator" },
    description,
  };
  return shell(
    title,
    description,
    `<nav class="nav" aria-label="Primary navigation"><div class="wrap"><a class="brand" href="/"><span class="mark">A</span><strong>Anekio</strong></a><div class="nav-end desktop-nav"><div class="navlinks"><a href="#product">Product</a><a href="#solutions">Solutions</a><a href="#roles">For every role</a><a href="#pricing" data-intent="pay">Pricing</a></div><div class="nav-actions"><a class="btn light" href="#start" data-intent="demo">Book a demo</a><a class="btn primary" href="#start" data-intent="trial">Start free trial</a></div></div><details class="mobile-nav"><summary aria-label="Open navigation">☰</summary><div class="mobile-nav-menu"><a href="#product">Product</a><a href="#solutions">Solutions</a><a href="#roles">For every role</a><a href="#pricing" data-intent="pay">Pricing</a><a href="#start" data-intent="demo">Book a demo</a><a href="#start" data-intent="trial">Start free trial</a></div></details></div></nav>
<main>
  <section class="hero">
    <div class="wrap">
      <div class="hero-copy">
        <div class="eyebrow">School ERP for growing Indian schools</div>
        <h1>Run your entire school from one place.</h1>
        <p class="lead">Admissions, fees, attendance, exams, documents, parent communication, and staff operations — connected in one school record.</p>
        <div class="cta"><a class="btn primary" href="#start" data-intent="trial">Start ${trial}-day free trial</a><a class="btn light" href="#start" data-intent="demo">Book a demo</a></div>
        <p class="trust-note">No credit card required · Setup support included</p>
        ${message ? `<p style="margin:4px 0 0;padding:10px 14px;border:1px solid #b7e4d1;border-radius:8px;background:#f2fbf7;color:#06724d;font-size:13px;font-weight:700">${escapeHtml(message)}</p>` : ""}
      </div>
    </div>
    <div class="module-rail" aria-label="Connected Anekio modules">
      <div class="wrap module-row"><span><i></i>Admissions</span><span><i></i>Fees</span><span><i></i>Attendance</span><span><i></i>Exams</span><span><i></i>Parent app</span><span><i></i>Staff</span></div>
    </div>
    <div class="wrap hero-visual">${androidPhoneHtml("Anekio Android app connected to the same school record")}</div>
  </section>

  <section id="product" class="market-section value-section">
    <div class="wrap">
      <div class="value-statement">
        <h2>One platform. One school record. Every team connected.</h2>
        <p>Anekio keeps daily school work attached to the same people, classes, and records. The office gets control, teachers lose paperwork, and families get answers without chasing the school.</p>
      </div>
      <div class="record-flow" aria-label="How Anekio connects a school">
        <article><span>01 · Capture once</span><strong>One student record</strong><p>Admission details become the working school file.</p></article>
        <article><span>02 · Work together</span><strong>Every operation stays linked</strong><p>Fees, attendance, exams, documents, and messages.</p></article>
        <article><span>03 · Share clearly</span><strong>Each role sees what it needs</strong><p>Office, teacher, parent, and student portals.</p></article>
      </div>
    </div>
  </section>

  <section id="solutions" class="market-section workflow-section">
    <div class="wrap">
      <div class="section-head center"><div class="eyebrow">Real school workflows</div><h2 class="section-title">Everything your school needs, connected.</h2><p class="lead">Anekio follows the work from the first enquiry to the parent’s phone, without sending teams back to separate registers and spreadsheets.</p></div>
      <div class="workflow-list">
        <article class="workflow">
          <div class="shot-frame"><div class="shot-top"><b>Student records</b><span>Current office portal</span></div><div class="static-app-crop"><img src="/demo/current/student-records.png" alt="Current Anekio student record with family, fee, academic, and document details" loading="lazy"></div></div>
          <div class="workflow-copy"><div class="eyebrow">Admissions and student records</div><h3>From enquiry to enrolled student, without retyping.</h3><p>Track admission leads, follow-ups, calls, test schedules, and remarks. When a student is admitted, their working file is ready for fees, attendance, reports, and documents.</p><div class="workflow-points"><span>Admission lead history and follow-ups</span><span>Student and family records</span><span>Documents, reports, and class details</span></div></div>
        </article>
        <article class="workflow is-reverse">
          <div class="shot-frame"><div class="shot-top"><b>Fees and collections</b><span>Current office portal</span></div><div class="static-app-crop"><img src="/demo/current/fees-operations.png" alt="Current Anekio fees workspace with pending invoices and overdue collections" loading="lazy"></div></div>
          <div class="workflow-copy"><div class="eyebrow">Fees and collections</div><h3>Fees that stay visible from bill to receipt.</h3><p>Issue invoices, collect cash or UPI, share payment links, send due reminders, and keep receipts attached to the student record. Parents see their own invoices and payment status.</p><div class="workflow-points"><span>Class fee structures and late rules</span><span>Invoices, receipts, dues, and reminders</span><span>School-owned payment gateway support</span></div></div>
        </article>
        <article class="workflow">
          <div class="shot-frame"><div class="shot-top"><b>Teacher operations</b><span>Current teacher portal</span></div><div class="static-app-crop"><img src="/demo/current/teacher-dashboard.png" alt="Current Anekio teacher dashboard with attendance and weekly teaching load" loading="lazy"></div></div>
          <div class="workflow-copy"><div class="eyebrow">Attendance, exams, and documents</div><h3>Daily class work moves forward without the paper chase.</h3><p>Teachers mark attendance and enter marks from their own workspace. The office schedules exams, reviews papers, publishes results, and issues report cards, admit cards, certificates, and other school documents.</p><div class="workflow-points"><span>Class and staff attendance</span><span>Exam series, papers, marks, and publishing</span><span>Template-based documents with verification</span></div></div>
        </article>
      </div>
    </div>
  </section>

  <section id="roles" class="market-section role-section">
    <div class="wrap">
      <div class="section-head"><div class="eyebrow">One system, four experiences</div><h2 class="section-title">The right workspace for every person.</h2><p class="lead">Everyone works from the same school data, while permissions keep each portal focused on the job at hand.</p></div>
      <div class="role-shell">
        <div class="role-tabs" role="tablist" aria-label="Anekio portals">
          <button class="role-tab" id="role-office" type="button" role="tab" aria-selected="true" aria-controls="panel-office" data-role-tab="office">Admin and office</button>
          <button class="role-tab" id="role-teacher" type="button" role="tab" aria-selected="false" aria-controls="panel-teacher" data-role-tab="teacher">Teachers</button>
          <button class="role-tab" id="role-parent" type="button" role="tab" aria-selected="false" aria-controls="panel-parent" data-role-tab="parent">Parents</button>
          <button class="role-tab" id="role-student" type="button" role="tab" aria-selected="false" aria-controls="panel-student" data-role-tab="student">Students</button>
        </div>
        <div class="role-panel" id="panel-office" role="tabpanel" aria-labelledby="role-office" data-role-panel="office"><div class="role-copy"><h3>Control the whole school day.</h3><p>See live operations, collection health, attendance, staffing, parent requests, and work that needs attention.</p><div class="role-list"><span>Dashboard and student records</span><span>Admissions, fees, exams, and documents</span><span>Roles, access, notices, and settings</span></div></div><div class="role-visual shot-frame"><div class="shot-top"><b>Admin desk</b><span>Current web portal</span></div><div class="static-app-crop"><img src="/demo/current/office-dashboard.png" alt="Current Anekio admin dashboard" loading="lazy"></div></div></div>
        <div class="role-panel" id="panel-teacher" role="tabpanel" aria-labelledby="role-teacher" data-role-panel="teacher" hidden><div class="role-copy"><h3>Keep class work in the teacher’s hand.</h3><p>Teachers see assigned classes and routines, mark attendance, prepare exams, enter marks, communicate, and apply for leave.</p><div class="role-list"><span>Class register and attendance</span><span>Timetable, papers, marks, and exams</span><span>Inbox, notices, and leave</span></div></div><div class="role-visual shot-frame"><div class="shot-top"><b>Teacher desk</b><span>Current web portal</span></div><div class="static-app-crop"><img src="/demo/current/teacher-dashboard.png" alt="Current Anekio teacher dashboard with class attendance and teaching load" loading="lazy"></div></div></div>
        <div class="role-panel" id="panel-parent" role="tabpanel" aria-labelledby="role-parent" data-role-panel="parent" hidden><div class="role-copy"><h3>Give families visibility without another phone call.</h3><p>Parents see attendance, fees, exam results, papers, notices, and their child’s timetable. Questions stay in a numbered request thread.</p><div class="role-list"><span>Child overview and attendance</span><span>Invoices, receipts, exams, and papers</span><span>Parent-school inbox and notices</span></div></div><div class="role-visual shot-frame"><div class="shot-top"><b>Parent portal</b><span>Current web portal</span></div><div class="static-app-crop"><img src="/demo/current/parent-dashboard.png" alt="Current Anekio parent portal showing attendance, fees, timetable, and notices" loading="lazy"></div></div></div>
        <div class="role-panel" id="panel-student" role="tabpanel" aria-labelledby="role-student" data-role-panel="student" hidden><div class="role-copy"><h3>Make the school day easy to follow.</h3><p>Students get a focused view of today’s schedule, attendance, subjects, exams, papers, fees, profile, and published school notices.</p><div class="role-list"><span>Today view and timetable</span><span>Courses, exams, and attendance</span><span>Papers, fees, path, and profile</span></div></div><div class="role-visual shot-frame"><div class="shot-top"><b>Student portal</b><span>Current web portal</span></div><div class="static-app-crop"><img src="/demo/current/student-dashboard.png" alt="Current Anekio student dashboard built from the same school record" loading="lazy"></div></div></div>
      </div>
    </div>
  </section>

  <section id="why" class="market-section switch-section wrap">
    <div class="switch-band">
      <div><div class="eyebrow">Why schools switch</div><h2>Less chasing. More control.</h2><p>Most school work becomes difficult when every desk keeps its own version. Anekio replaces that fragmentation with one traceable operating record.</p></div>
      <div class="switch-steps"><div class="switch-step"><span>1</span><div><strong>Capture the work where it happens</strong><p>Admissions, class attendance, fee collection, and parent requests enter one system.</p></div></div><div class="switch-step"><span>2</span><div><strong>Keep every update attached</strong><p>People, classes, payments, exams, messages, and documents stay connected.</p></div></div><div class="switch-step"><span>3</span><div><strong>Give each team a clear next action</strong><p>Office, teachers, parents, and students see the right view of the same record.</p></div></div></div>
    </div>
  </section>

  <section class="market-section wrap" aria-label="Built for Indian school operations">
    <div class="india-strip"><div><h3>Built around Indian school operations.</h3></div><div><strong>Fees in INR</strong><p>Cash, UPI, receipts, payment links, dues, and late rules.</p></div><div><strong>School-owned channels</strong><p>Your payment gateway and messaging accounts stay under school control.</p></div><div><strong>Web and mobile</strong><p>One Expo product for office, teacher, parent, and student access.</p></div></div>
  </section>

  <section id="start" class="sections wrap">
    <span id="pricing"></span><span id="trial"></span><span id="enquiry"></span>
    <div class="start-head">
      <div class="eyebrow">Get started</div>
      <h2 class="section-title">Choose how you want to begin</h2>
      <p class="muted" style="margin:0">See it, try it, or launch it. Each path is a different next step.</p>
    </div>
    <div class="path-grid" role="group" aria-label="How to get started">
      <button type="button" class="path-card" data-path="demo" aria-pressed="false"><span class="icon">▶</span><b>Book a demo</b><p>See Anekio in action. 20 minutes, online.</p></button>
      <button type="button" class="path-card is-popular is-on" data-path="trial" aria-pressed="true"><span class="path-pop">Most popular</span><span class="icon">${trial}</span><b>Free trial</b><p>Try Anekio for ${trial} days. No payment.</p></button>
      <button type="button" class="path-card path-launch" data-path="pay" aria-pressed="false">${saveChip}<span class="icon">₹</span><b>Launch now</b><p>${oldInline}<strong>₹${sale} / ${escapeHtml(period)}</strong></p></button>
    </div>
    <div class="split start-split">
      <div class="price-card" id="start-offer">
        <div class="offer-block" data-offer="demo" hidden>
          <div class="eyebrow">See Anekio in action</div>
          <h2 class="section-title">20-minute personalized demo</h2>
          <div class="check-list">
            <span>See the complete ERP</span>
            <span>Web + Android walkthrough</span>
            <span>Ask questions live</span>
            <span>Get recommendations for your school</span>
          </div>
          <p class="fine">No payment required.</p>
        </div>
        <div class="offer-block" data-offer="trial">
          <div class="eyebrow">Try Anekio free</div>
          <h2 class="section-title">${trial} days · No payment required</h2>
          <div class="check-list">
            <span>Full ERP access</span>
            <span>Web + Android</span>
            <span>School workspace</span>
            <span>Setup assistance</span>
          </div>
        </div>
        <div class="offer-block" data-offer="pay" hidden>
          <div class="eyebrow">${escapeHtml(offer)}</div>
          <h2 class="section-title">${escapeHtml(planName)} plan</h2>
          ${oldBlock}
          <div class="price">₹${sale}<span class="price-unit"> / ${escapeHtml(period)}</span></div>
          ${saveBlock}
          <div class="check-list">
            <span>Web ERP + Android app</span>
            <span>Fees, attendance, admissions, exams</span>
            <span>Parent and teacher portals</span>
            <span>Setup assistance</span>
          </div>
        </div>
      </div>
      <div class="form-shell">
        <div class="form-content" style="grid-template-columns:1fr">
          <div class="form-panel">
            <div class="journey" data-journey="demo" hidden>
              <form id="demo-form" class="form j-step" data-step="1">
                <div class="eyebrow">Book a demo</div>
                <h2 class="start-heading">See how Anekio can work for your school.</h2>
                <label>School name<input name="schoolName" required placeholder="VidyaPith Public School"></label>
                <label>Your name<input name="ownerName" required placeholder="Principal / Owner"></label>
                <label>Phone<div class="two" style="grid-template-columns:110px 1fr"><select name="ownerCountryCode"><option value="+91" selected>🇮🇳 +91</option></select><input name="ownerPhone" required inputmode="tel" placeholder="98765 43210"></div></label>
                <label>Work email<input name="ownerEmail" type="email" required placeholder="owner@school.in"></label>
                <label>City<input name="city" required placeholder="Bengaluru"></label>
                <label>What do you want to see?<select name="topic"><option>Full ERP</option><option>Fees and collections</option><option>Attendance</option><option>Admissions</option><option>Parent app</option></select></label>
                <div aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden"><label>Website<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
                <button class="btn primary" type="submit" style="width:100%">Continue →</button>
              </form>
              <div class="j-step" data-step="2" hidden>
                <div class="eyebrow">Choose your demo time</div>
                <h2 class="start-heading">Pick a 20-minute online slot.</h2>
                <p class="fine" id="demo-month"></p>
                <div class="cal-grid" id="demo-cal"></div>
                <button class="btn primary" id="demo-confirm" type="button" style="width:100%;margin-top:12px" disabled>Confirm demo</button>
              </div>
              <div class="j-step" data-step="3" hidden>
                <div class="eyebrow">Demo confirmed</div>
                <h2 class="start-heading">Your Anekio demo is booked.</h2>
                <p class="lead" id="demo-when" style="max-width:none"></p>
                <p class="fine">20 minutes · Online. We'll send the meeting details to your email and phone.</p>
                <a class="btn light" id="demo-ics" href="#">Add to calendar</a>
              </div>
            </div>
            <div class="journey" data-journey="trial">
              <form id="trial-form" class="form j-step" data-step="1" method="post" action="/api/saas/trial">
                <div class="eyebrow">Start your ${trial}-day free trial</div>
                <h2 class="start-heading">No payment required.</h2>
                <label>School name<input name="schoolName" required placeholder="VidyaPith Public School"></label>
                <label>Your name<input name="ownerName" required placeholder="Principal / Owner"></label>
                <label>Work email<input name="ownerEmail" type="email" required placeholder="owner@school.in"></label>
                <label>Phone<div class="two" style="grid-template-columns:110px 1fr"><select name="ownerCountryCode"><option value="+91" selected>🇮🇳 +91</option></select><input name="ownerPhone" required inputmode="tel" placeholder="98765 43210"></div></label>
                <div class="two"><label>City<input name="city" required placeholder="Bengaluru"></label><label>Number of students<input name="studentCount" type="number" min="0" placeholder="480"></label></div>
                <button class="btn primary" type="submit" style="width:100%">Create my school →</button>
                <p class="fine start-reassure">No payment required · Takes less than 2 minutes</p>
              </form>
              <div class="j-step" data-step="2" hidden>
                <div class="eyebrow">Creating your school</div>
                <h2 class="start-heading">Setting up your workspace…</h2>
                <div class="check-list"><span>Creating school workspace</span><span>Setting up administrator</span><span>Enabling ERP modules</span><span>Sending login details</span></div>
              </div>
              <div class="j-step" data-step="3" hidden>
                <div class="eyebrow">Welcome to Anekio</div>
                <h2 class="start-heading">Your ${trial}-day trial has started.</h2>
                <p class="lead" id="trial-ready" style="max-width:none"></p>
                <a class="btn primary" href="/">Open Anekio ERP →</a>
              </div>
            </div>
            <div class="journey" data-journey="pay" hidden>
              <div class="j-step" data-step="1">
                <div class="eyebrow">Launch Anekio</div>
                <h2 class="start-heading">Lock ₹${sale} / ${escapeHtml(period)} for your school.</h2>
                <p class="muted">Next we take school billing details, then secure checkout.</p>
                <button class="btn primary" id="pay-continue" type="button" style="width:100%">Continue →</button>
              </div>
              <form id="pay-form" class="form j-step" data-step="2" hidden method="post" action="/api/saas/payment/order">
                <div class="eyebrow">School information</div>
                <h2 class="start-heading">Billing details</h2>
                <label>School name<input name="schoolName" required placeholder="VidyaPith Public School"></label>
                <label>Contact person<input name="ownerName" required placeholder="Principal / Owner"></label>
                <label>Email<input name="ownerEmail" type="email" required placeholder="owner@school.in"></label>
                <label>Phone<div class="two" style="grid-template-columns:110px 1fr"><select name="ownerCountryCode"><option value="+91" selected>🇮🇳 +91</option></select><input name="ownerPhone" required inputmode="tel" placeholder="98765 43210"></div></label>
                <div class="two"><label>State<select name="state" required><option value="">Select state</option><option>Karnataka</option><option>Maharashtra</option><option>Tamil Nadu</option><option>Delhi</option><option>Telangana</option><option>Gujarat</option><option>Uttar Pradesh</option><option>West Bengal</option><option>Rajasthan</option><option>Kerala</option><option>Other</option></select></label><label>GSTIN <span class="fine">(optional)</span><input name="gstin" maxlength="15" placeholder="29ABCDE1234F1Z5"></label></div>
                <button class="btn primary" type="button" id="pay-summary" style="width:100%">Continue to payment →</button>
              </form>
              <div class="j-step" data-step="3" hidden>
                <div class="eyebrow">Order summary</div>
                <h2 class="start-heading">${escapeHtml(planName)} Plan</h2>
                <p class="muted">₹${sale} / ${escapeHtml(period)}</p>
                <p class="fine">GST is applied at secure checkout if required. Total due now: ₹${sale}</p>
                <button class="btn primary" type="submit" form="pay-form" style="width:100%">Pay securely →</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
  <section id="close" class="market-section wrap">
    <div class="closeout">
      <div class="eyebrow">Bring the school together</div>
      <h2 class="section-title">Give every team one reliable place to work.</h2>
      <p class="lead">Start with a ${trial}-day trial or see how Anekio fits your school in a focused 20-minute demo.</p>
      <div class="cta">
        <a class="btn primary" href="#start" data-intent="trial">Start ${trial}-day free trial</a>
        <a class="btn light" href="#start" data-intent="demo">Book a demo</a>
      </div>
    </div>
  </section>
</main>
<footer><div class="wrap"><div class="footer-grid"><div class="footer-brand"><a class="brand" href="/"><span class="mark">A</span><strong>Anekio</strong></a><p>School ERP for growing Indian schools. One platform, one school record, every team connected.</p></div><div class="footer-links"><a href="#product">Product</a><a href="#solutions">Solutions</a><a href="#roles">For every role</a><a href="#pricing" data-intent="pay">Pricing</a><a href="#start" data-intent="demo">Book a demo</a></div></div><div class="footer-base">© ${new Date().getFullYear()} Anekio. All rights reserved.</div></div></footer>
<script>
  (function () {
    var root = document.getElementById("start");
    if (!root) return;
    var path = "trial";
    var demoSlot = null;
    var demoPayload = null;
    function show(el, on) {
      if (!el) return;
      if (on) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
    }
    function selectPath(next) {
      path = next === "pay" || next === "demo" ? next : "trial";
      root.querySelectorAll(".path-card").forEach(function (card) {
        var isCurrent = card.getAttribute("data-path") === path;
        card.classList.toggle("is-on", isCurrent);
        card.setAttribute("aria-pressed", isCurrent ? "true" : "false");
      });
      root.querySelectorAll("[data-offer]").forEach(function (el) {
        show(el, el.getAttribute("data-offer") === path);
      });
      root.querySelectorAll(".journey").forEach(function (el) {
        show(el, el.getAttribute("data-journey") === path);
      });
    }
    function journey(name) {
      return root.querySelector('.journey[data-journey="' + name + '"]');
    }
    function gotoStep(name, step) {
      var box = journey(name);
      if (!box) return;
      box.querySelectorAll(".j-step").forEach(function (el) {
        show(el, Number(el.getAttribute("data-step")) === step);
      });
    }
    window.selectAnekioPath = function (next) {
      selectPath(next);
      gotoStep(path, 1);
    };
    root.querySelectorAll(".path-card").forEach(function (card) {
      card.addEventListener("click", function () {
        selectPath(card.getAttribute("data-path"));
        gotoStep(path, 1);
      });
    });
    document.querySelectorAll("[data-intent]").forEach(function (el) {
      el.addEventListener("click", function () {
        var value = el.getAttribute("data-intent");
        if (value === "pay" || value === "demo" || value === "trial") {
          selectPath(value);
          gotoStep(path, 1);
        }
      });
    });
    function applyHash() {
      var hash = (location.hash || "").replace("#", "");
      if (hash === "trial") selectPath("trial");
      if (hash === "enquiry" || hash === "demo") selectPath("demo");
      if (hash === "pricing") selectPath("pay");
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);

    var demoForm = document.getElementById("demo-form");
    var demoCal = document.getElementById("demo-cal");
    var demoMonth = document.getElementById("demo-month");
    var demoConfirm = document.getElementById("demo-confirm");
    function kolkataDateParts(date) {
      var values = {};
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).forEach(function (part) {
        if (part.type !== "literal") values[part.type] = Number(part.value);
      });
      return values;
    }
    function formatKolkataDay(day, options) {
      return day.toLocaleDateString("en-IN", Object.assign({ timeZone: "UTC" }, options));
    }
    function weekdayDays() {
      var days = [];
      var today = kolkataDateParts(new Date());
      var d = new Date(Date.UTC(today.year, today.month - 1, today.day));
      while (days.length < 4) {
        d.setUTCDate(d.getUTCDate() + 1);
        if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(new Date(d));
      }
      return days;
    }
    var slots = ["10:00 AM", "11:30 AM", "2:00 PM", "4:00 PM"];
    function slotTime(slot) {
      var match = /^(\\d{1,2}):(\\d{2})\\s*(AM|PM)$/.exec(slot);
      if (!match) return null;
      var hour = Number(match[1]);
      var minute = Number(match[2]);
      if (match[3] === "PM" && hour !== 12) hour += 12;
      if (match[3] === "AM" && hour === 12) hour = 0;
      return { hour: hour, minute: minute };
    }
    function twoDigits(value) {
      return String(value).padStart(2, "0");
    }
    function scheduledAtInKolkata(day, slot) {
      var time = slotTime(slot);
      if (!time) return "";
      return day.getUTCFullYear() + "-" + twoDigits(day.getUTCMonth() + 1) + "-" + twoDigits(day.getUTCDate()) + "T" + twoDigits(time.hour) + ":" + twoDigits(time.minute) + ":00+05:30";
    }
    function calendarStamp(date) {
      return date.toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
    }
    function renderCal() {
      if (!demoCal) return;
      var days = weekdayDays();
      demoSlot = null;
      demoConfirm.disabled = true;
      demoMonth.textContent = formatKolkataDay(days[0], { month: "long", year: "numeric" });
      demoCal.innerHTML = days.map(function (day, i) {
        var label = formatKolkataDay(day, { weekday: "short", day: "numeric", month: "short" });
        return '<div class="cal-day" data-day="' + i + '"><strong>' + label + "</strong>" +
          slots.map(function (slot) {
            return '<button type="button" data-day="' + i + '" data-slot="' + slot + '">' + slot + "</button>";
          }).join("") + "</div>";
      }).join("");
      demoCal.querySelectorAll("button").forEach(function (btn) {
        btn.addEventListener("click", function () {
          demoCal.querySelectorAll("button").forEach(function (b) { b.classList.remove("is-on"); });
          btn.classList.add("is-on");
          var day = days[Number(btn.getAttribute("data-day"))];
          var slot = btn.getAttribute("data-slot") || "";
          var scheduledAt = scheduledAtInKolkata(day, slot);
          demoSlot = {
            label: formatKolkataDay(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + " · " + slot + " IST",
            scheduledAt: scheduledAt
          };
          demoConfirm.disabled = !scheduledAt;
        });
      });
    }
    if (demoForm) {
      demoForm.addEventListener("submit", function (e) {
        e.preventDefault();
        demoPayload = new FormData(demoForm);
        renderCal();
        gotoStep("demo", 2);
      });
    }
    if (demoConfirm) {
      demoConfirm.addEventListener("click", function () {
        if (!demoPayload || !demoSlot) return;
        demoConfirm.disabled = true;
        var body = new URLSearchParams();
        demoPayload.forEach(function (value, key) { body.append(key, value); });
        var demoTopic = String(demoPayload.get("topic") || "Full ERP");
        body.set("demoScheduledAt", demoSlot.scheduledAt);
        body.set("demoSlotLabel", demoSlot.label);
        body.set("demoTopic", demoTopic);
        body.set("notes", "Demo booked · " + demoTopic + " · " + demoSlot.label);
        fetch("/api/saas/enquiry", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString()
        }).then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
          .then(function (out) {
            if (!out.res.ok) throw new Error((out.data && out.data.error) || "Could not book demo.");
            document.getElementById("demo-when").textContent = demoSlot.label;
            var ics = document.getElementById("demo-ics");
            if (ics) {
              var start = new Date(demoSlot.scheduledAt);
              var end = new Date(start.getTime() + 20 * 60 * 1000);
              var icsBody = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Anekio//Demo Booking//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", "UID:anekio-demo-" + start.getTime() + "@anekio.com", "DTSTAMP:" + calendarStamp(new Date()), "DTSTART:" + calendarStamp(start), "DTEND:" + calendarStamp(end), "SUMMARY:Anekio demo", "DESCRIPTION:Your 20-minute Anekio demo.", "END:VEVENT", "END:VCALENDAR", ""].join("\\r\\n");
              ics.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(icsBody);
              ics.setAttribute("download", "anekio-demo.ics");
            }
            gotoStep("demo", 3);
          })
          .catch(function (err) {
            demoConfirm.disabled = false;
            alert(err.message || "Could not book demo.");
          });
      });
    }

    var trialForm = document.getElementById("trial-form");
    if (trialForm) {
      trialForm.addEventListener("submit", function (e) {
        e.preventDefault();
        gotoStep("trial", 2);
        var body = new URLSearchParams(new FormData(trialForm));
        fetch("/api/saas/trial", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString()
        }).then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
          .then(function (out) {
            if (!out.res.ok) throw new Error((out.data && out.data.error) || "Could not start trial.");
            var org = out.data.org || {};
            document.getElementById("trial-ready").textContent = "School: " + (org.schoolName || "") + ". Admin: " + (org.ownerName || "") + ".";
            setTimeout(function () { gotoStep("trial", 3); }, 900);
          })
          .catch(function (err) {
            gotoStep("trial", 1);
            alert(err.message || "Could not start trial.");
          });
      });
    }

    var payContinue = document.getElementById("pay-continue");
    var paySummary = document.getElementById("pay-summary");
    var payForm = document.getElementById("pay-form");
    if (payContinue) payContinue.addEventListener("click", function () { gotoStep("pay", 2); });
    if (paySummary && payForm) {
      paySummary.addEventListener("click", function () {
        if (!payForm.reportValidity()) return;
        gotoStep("pay", 3);
      });
    }
  })();
  (function () {
    var tabs = document.querySelectorAll("[data-role-tab]");
    var panels = document.querySelectorAll("[data-role-panel]");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var role = tab.getAttribute("data-role-tab");
        tabs.forEach(function (item) {
          item.setAttribute("aria-selected", item === tab ? "true" : "false");
          item.setAttribute("tabindex", item === tab ? "0" : "-1");
        });
        panels.forEach(function (panel) {
          if (panel.getAttribute("data-role-panel") === role) panel.removeAttribute("hidden");
          else panel.setAttribute("hidden", "");
        });
      });
      tab.addEventListener("keydown", function (event) {
        var keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
        if (keys.indexOf(event.key) === -1) return;
        event.preventDefault();
        var items = Array.prototype.slice.call(tabs);
        var index = items.indexOf(tab);
        if (event.key === "Home") index = 0;
        else if (event.key === "End") index = items.length - 1;
        else index = (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
        items[index].focus();
        items[index].click();
      });
    });
    tabs.forEach(function (tab) {
      tab.setAttribute("tabindex", tab.getAttribute("aria-selected") === "true" ? "0" : "-1");
    });
    document.querySelectorAll(".mobile-nav-menu a").forEach(function (link) {
      link.addEventListener("click", function () {
        var menu = link.closest("details");
        if (menu) menu.removeAttribute("open");
      });
    });
  })();
</script>`,
    `${MARKETING_CSS}<script type="application/ld+json">${escapeHtml(JSON.stringify(jsonLd))}</script>`,
    "marketing-page"
  );
}

export async function createSaasEnquiry(input: EnquiryInput) {
  const schoolName = text(input.schoolName);
  const ownerName = text(input.ownerName);
  const ownerEmail = normalEmail(input.ownerEmail);
  const ownerCountryCode = countryCode(input.ownerCountryCode);
  const ownerPhone = normalPhone(input.ownerPhone) || text(input.ownerPhone);
  if (!schoolName || !ownerName || !ownerEmail || !ownerPhone) {
    throw new Error("School name, owner name, email, and phone are required.");
  }
  const followUp = text(input.notes).toLowerCase().includes("demo booked") ? "DEMO_SCHEDULED" : "NEW";
  const payload = {
    schoolName,
    ownerName,
    ownerEmail,
    ownerCountryCode,
    ownerPhone,
    city: text(input.city),
    billingState: text(input.state),
    gstin: text(input.gstin).toUpperCase(),
    teacherCount: intOrNull(input.teacherCount),
    studentCount: intOrNull(input.studentCount),
  };
  const extraNote = text(input.notes);
  const pricing = await getSitePricing();
  const existing = await findSaasOrgByContact(input);
  const org = existing
    ? await prisma.saasOrg.update({
        where: { id: existing.id },
        data: {
          ...payload,
          notes: [existing.notes, extraNote].filter(Boolean).join(" · "),
          followUpStatus: existing.subscriptionStatus === "LEAD" ? followUp : existing.followUpStatus,
        },
      })
    : await prisma.saasOrg.create({
        data: {
          ...payload,
          notes: extraNote,
          plan: pricing.planName,
          monthlyPrice: pricing.salePrice,
          paymentStatus: "PENDING",
          subscriptionStatus: "LEAD",
          followUpStatus: followUp === "DEMO_SCHEDULED" ? "DEMO" : "NEW",
          pipelineStage: followUp === "DEMO_SCHEDULED" ? "DEMO" : "NEW",
          lifecycle: "LEAD",
          source: "WEBSITE_DEMO",
        },
      });
  if (!existing) await captureWebsiteLead(org.id, "DEMO");
  return org;
}

/**
 * Captures a website demo booking as a CRM lead plus a concrete demo slot.
 * This intentionally owns the public booking fields rather than trusting a
 * client-provided note or display label.
 */
export async function createSaasDemoEnquiry(input: DemoEnquiryInput) {
  if (text(input.website)) {
    // A filled honeypot is treated as a successful no-op so it gives bots no
    // signal while creating neither a CRM record nor an outbound email.
    return null;
  }

  const ownerEmail = validEmail(input.ownerEmail);
  if (!ownerEmail) throw new Error("Enter a valid work email address.");
  const scheduledAt = demoBookingTime(input.demoScheduledAt);
  const topic = text(input.demoTopic ?? input.topic, "Full ERP").slice(0, 120) || "Full ERP";
  const slotLabel = demoSlotLabel(scheduledAt);
  const note = [`Website demo booked`, topic, slotLabel].filter(Boolean).join(" · ");
  const org = await createSaasEnquiry({ ...input, ownerEmail, notes: note });
  const updatedOrg = await prisma.saasOrg.update({
    where: { id: org.id },
    data: {
      interestedIn: topic,
      pipelineStage: "DEMO",
      followUpStatus: "DEMO",
      nextFollowUpOn: scheduledAt,
    },
  });

  const existingDemo = await prisma.saasDemo.findFirst({
    where: { orgId: org.id, scheduledAt },
    orderBy: { createdAt: "desc" },
  });
  const demo = existingDemo || (await createDemo(org.id, { scheduledAt, notes: note }, "website"));
  return { org: updatedOrg, demo, topic, slotLabel };
}

export async function createSaasTrial(input: EnquiryInput) {
  const pricing = await getSitePricing();
  const org = await createSaasEnquiry({
    ...input,
    notes: [`${pricing.trialDays}-day free trial requested`, text(input.notes)].filter(Boolean).join(" · "),
  });
  const trial = await prisma.saasOrg.update({
    where: { id: org.id },
    data: {
      plan: `${pricing.trialDays}-day free trial`,
      monthlyPrice: 0,
      paymentStatus: "TRIAL",
      subscriptionStatus: "TRIAL",
      followUpStatus: "QUALIFIED",
      source: "WEBSITE_TRIAL",
    },
  });
  await captureWebsiteLead(trial.id, "TRIAL");
  await provisionLocalTrialWorkspace(trial);
  return trial;
}

export function trialStartedHtml(org: Awaited<ReturnType<typeof createSaasTrial>>) {
  const localLogin = shouldProvisionLocalTrial()
    ? `<span>Local workspace login: ${escapeHtml(org.ownerPhone)} / 12345.</span>`
    : "";
  return shell(
    "Free trial started | Anekio",
    "Your Anekio free trial request has been received.",
    `<main class="wrap" style="min-height:100vh;display:grid;place-items:center;padding:40px 0">
      <section class="form-shell" style="max-width:760px;width:100%">
        <div class="form-content" style="grid-template-columns:1fr">
          <div>
            <div class="eyebrow">Trial request received</div>
            <h1 style="font-size:52px;margin-bottom:12px">${escapeHtml(org.plan)} is ready to start.</h1>
            <p class="lead">Thanks, ${escapeHtml(org.ownerName)}. We have saved the trial request for ${escapeHtml(org.schoolName)} and will help you open the workspace.</p>
            <div class="check-list">
              <span>No payment is needed for the trial.</span>
              <span>Your school details are saved for setup.</span>
              <span>Our team will contact you on ${escapeHtml(org.ownerPhone)}.</span>
              ${localLogin}
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
    "ownerCountryCode",
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
  if (input.monthlyPrice !== undefined) data.monthlyPrice = intOrNull(input.monthlyPrice) ?? (await getSitePricing()).salePrice;
  if (input.state !== undefined) data.billingState = text(input.state);
  if (input.gstin !== undefined) data.gstin = text(input.gstin).toUpperCase();
  return prisma.saasOrg.update({ where: { id }, data });
}

export async function listSaasOrgs() {
  return prisma.saasOrg.findMany({
    orderBy: { updatedAt: "desc" },
    include: { payments: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
}

export async function createSaasRazorpayOrder(input: EnquiryInput & { orgId?: unknown }) {
  const pricing = await getSitePricing();
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
            ownerCountryCode: countryCode(input.ownerCountryCode || existing.ownerCountryCode),
            city: text(input.city, existing.city),
            billingState: text(input.state, existing.billingState),
            gstin: text(input.gstin, existing.gstin).toUpperCase(),
            monthlyPrice: pricing.salePrice,
            plan: pricing.planName,
            paymentStatus: existing.paymentStatus === "PAID" ? "RENEWAL_DUE" : existing.paymentStatus,
            followUpStatus: "RENEWAL_STARTED",
          },
        })
      : await createSaasEnquiry(input);
  if (!org) throw new Error("Organisation not found.");
  const renewal = Boolean(orgId || existing);
  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const order = await razorpay.orders.create({
    amount: pricing.salePrice * 100,
    currency: "INR",
    receipt: org.id.slice(0, 40),
    notes: { orgId: org.id, schoolName: org.schoolName, product: PRODUCT_NAME, purpose: renewal ? "renewal" : "new", plan: pricing.planName },
  });
  await prisma.saasPayment.create({
    data: {
      orgId: org.id,
      amount: pricing.salePrice,
      orderId: order.id,
      status: "CREATED",
      notes: renewal ? "Renewal order created" : "Subscription order created",
    },
  });
  return { keyId, orderId: order.id, amount: pricing.salePrice, amountPaise: pricing.salePrice * 100, org, renewal, planName: pricing.planName };
}

export function saasCheckoutHtml(order: Awaited<ReturnType<typeof createSaasRazorpayOrder>>) {
  const verifyPayload = { orgId: order.org.id, amount: order.amount };
  const heading = order.renewal ? "Renew your Anekio plan" : "Complete your Anekio payment";
  const description = order.renewal ? `${order.planName} plan renewal` : `${order.planName} plan`;
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
  const pricing = await getSitePricing();
  const org = await prisma.saasOrg.findUnique({ where: { id: orgId } });
  if (!org) throw new Error("Organisation not found.");
  const existing = await prisma.saasPayment.findFirst({ where: { paymentId: razorpayPaymentId } });
  if (!existing) {
    await prisma.saasPayment.create({
      data: {
        orgId,
        amount: pricing.salePrice,
        orderId: razorpayOrderId,
        paymentId: razorpayPaymentId,
        status: "PAID",
        notes: "Secure checkout verified",
        paidAt: new Date(),
      },
    });
  }
  if (!existing) {
    await fulfillPaidSubscription({
      orgId,
      amount: pricing.salePrice,
      plan: pricing.planName,
      actorEmail: "razorpay",
      paymentId: razorpayPaymentId,
    });
  }
  return { ok: true, alreadyProcessed: Boolean(existing) };
}

export async function saasRenewalHtml(input: { orgId?: unknown; contact?: unknown } = {}) {
  const pricing = await getSitePricing();
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
              <div class="price">₹${formatInr(pricing.salePrice)}</div>
              <p class="muted">This renews the current ${escapeHtml(pricing.planName)} plan. After payment, access is marked active again and our account manager will connect with you.</p>
              <form method="post" action="/api/saas/payment/order">
                <input type="hidden" name="orgId" value="${escapeHtml(org.id)}">
                <button class="btn primary" type="submit" style="width:100%;margin-top:14px">Renew ₹${formatInr(pricing.salePrice)} securely</button>
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
  const pricing = await getSitePricing();
  return {
    locked: true,
    orgId: org.id,
    schoolName: org.schoolName,
    status: org.subscriptionStatus,
    renewalOn: org.renewalOn ? org.renewalOn.toISOString() : "",
    renewUrl: renewalUrl(org.id),
    amount: pricing.salePrice,
  };
}

export async function subscriptionOverviewForUser(userId: string): Promise<SaasSubscriptionOverview | null> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, phone: true } });
  if (!row) return null;
  let org = await findSaasOrgByContact({ ownerEmail: row.email || "", ownerPhone: row.phone || "" });
  if (!org) {
    const school = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { email: true, phone: true } });
    org = await findSaasOrgByContact({ ownerEmail: school?.email || "", ownerPhone: school?.phone || "" });
  }
  if (!org) return null;
  const pricing = await getSitePricing();
  const invoices = await prisma.saasInvoice.findMany({
    where: { orgId: org.id },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: 24,
  });
  return {
    orgId: org.id,
    schoolName: org.schoolName,
    plan: org.plan,
    status: org.subscriptionStatus,
    paymentStatus: org.paymentStatus,
    subscriptionStart: org.subscriptionStart ? org.subscriptionStart.toISOString() : "",
    renewalOn: org.renewalOn ? org.renewalOn.toISOString() : "",
    daysLeft: daysUntil(org.renewalOn),
    renewUrl: renewalUrl(org.id),
    amount: org.monthlyPrice || pricing.salePrice,
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      description: invoice.description,
      status: invoice.status,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      total: invoice.total,
      paid: invoice.paidAmount,
      balance: Math.max(0, invoice.total - invoice.paidAmount),
      notes: invoice.notes,
      printUrl: `/api/v1/subscription/invoices/${encodeURIComponent(invoice.id)}/print`,
    })),
  };
}

export async function markSaasPayment(input: { orgId: string; orderId?: string; paymentId?: string; status?: string; notes?: string }) {
  const pricing = await getSitePricing();
  const payment = await prisma.saasPayment.create({
    data: {
      orgId: input.orgId,
      amount: pricing.salePrice,
      orderId: input.orderId || "",
      paymentId: input.paymentId || "",
      status: input.status || "PAID",
      notes: input.notes || "Payment recorded manually",
      paidAt: input.status === "FAILED" ? null : new Date(),
    },
  });
  if (payment.status === "PAID") {
    await fulfillPaidSubscription({
      orgId: input.orgId,
      amount: pricing.salePrice,
      plan: pricing.planName,
      actorEmail: "system",
      paymentId: payment.paymentId || payment.id,
    });
  } else {
    await prisma.saasOrg.update({
      where: { id: input.orgId },
      data: { paymentStatus: payment.status },
    });
  }
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
