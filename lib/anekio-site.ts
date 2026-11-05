import Razorpay from "razorpay";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "./prisma";
import { normalizeMobile } from "./phone";
import { roleIdBySlug } from "./roles";
import { captureWebsiteLead, createDemo, createTrialSubscription, ensureOnboardingTasks, fulfillPaidSubscription, startOnboarding } from "./saas-crm";
import { getPaymentLink, getSitePricing, markCouponUsed, quoteForSchool } from "./saas-pricing";
import { marketingBottom, marketingCss, marketingHead, marketingScript, marketingTop } from "./anekio-marketing";
import { birthdayBanner } from "./birthday-banner";
import { blogSitemapPaths } from "./anekio-blog";
import { emptyUnusedBakedSubjectCatalog } from "./subject-code";

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

/** Which of email / phone already belong to an Anekio organisation (owner contact). */
export async function existingContactFields(input: { ownerEmail?: unknown; ownerPhone?: unknown }) {
  const email = normalEmail(input.ownerEmail);
  const phone = normalPhone(input.ownerPhone);
  const rawPhone = text(input.ownerPhone);
  const phones = [...new Set([phone, rawPhone].filter(Boolean))];
  const [byEmail, byPhone] = await Promise.all([
    email ? prisma.saasOrg.findFirst({ where: { ownerEmail: { equals: email } }, select: { id: true } }) : null,
    phones.length ? prisma.saasOrg.findFirst({ where: { ownerPhone: { in: phones } }, select: { id: true } }) : null,
  ]);
  return [byEmail ? "email" : null, byPhone ? "phone" : null].filter(Boolean) as ("email" | "phone")[];
}

export function existingContactMessage(fields: ("email" | "phone")[]) {
  const what = fields.length === 2 ? "This email and phone number are" : fields[0] === "email" ? "This email is" : "This phone number is";
  return `${what} already registered with an Anekio school, so a new school can't be created with it. Use a different ${fields.length === 2 ? "email and phone" : fields[0] === "email" ? "email" : "phone number"}, or ask us for a renewal link if this is your school.`;
}

export class ExistingTrialSignupError extends Error {
  status = 409;
  loginUrl = "/login";
  conflictFields: ("email" | "phone")[];

  constructor(conflictFields: ("email" | "phone")[]) {
    const contact = conflictFields[0] || "contact";
    super(conflictFields.length === 2
      ? "Your email and phone are already registered with Anekio. Please log in to continue."
      : `This ${contact} is already registered with Anekio. Please log in to continue.`);
    this.conflictFields = conflictFields;
  }
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

function shouldProvisionTrialWorkspace() {
  return process.env.ANEKIO_PROVISION_TRIAL_WORKSPACE !== "false";
}

function trialAdminPassword() {
  if (process.env.NODE_ENV === "production") return crypto.randomBytes(4).toString("hex");
  return "12345";
}

async function provisionTrialWorkspace(org: { id: string; schoolName: string; ownerName: string; ownerEmail: string; ownerPhone: string; city: string; billingState: string; gstin: string }, trialDays?: number) {
  if (!shouldProvisionTrialWorkspace()) return null;
  const phone = normalizeMobile(org.ownerPhone) || org.ownerPhone;
  const email = normalEmail(org.ownerEmail);
  if (!phone || !email) return null;
  const roleId = await roleIdBySlug("ADMIN");
  const configId = `school:${org.id}`;
  const ownedConfig = await prisma.schoolConfig.findFirst({ where: { orgId: org.id }, select: { id: true } });
  const legacyConfig = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { orgId: true } });
  const upsertId = ownedConfig?.id || (legacyConfig && !legacyConfig.orgId ? "school" : configId);
  await prisma.schoolConfig.upsert({
    where: { id: upsertId },
    update: {
      orgId: org.id,
      name: org.schoolName,
      city: org.city,
      state: org.billingState,
      gstin: org.gstin,
      phone,
      email,
    },
    create: {
      id: upsertId,
      orgId: org.id,
      name: org.schoolName,
      city: org.city,
      state: org.billingState,
      gstin: org.gstin,
      phone,
      email,
      subjectCatalog: "[]",
    },
  });
  await emptyUnusedBakedSubjectCatalog(org.id);
  const existingInOrg = await prisma.user.findFirst({
    where: { orgId: org.id, OR: [{ email }, { phone }] },
  });
  if (existingInOrg) {
    await prisma.saasOrg.update({
      where: { id: org.id },
      data: { loginUrl: "/login", apiUrl: "/api/v1" },
    });
    return { login: phone, created: false as const };
  }
  const password = trialAdminPassword();
  const hashed = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { name: org.ownerName, email, phone, password: hashed, roleId, orgId: org.id },
  });
  const activeSubscription = await prisma.saasSubscription.findFirst({
    where: { orgId: org.id, status: { in: ["TRIAL", "ACTIVE"] } },
  });
  if (!activeSubscription) await createTrialSubscription(org.id, trialDays);
  await ensureOnboardingTasks(org.id);
  await startOnboarding(org.id, email);
  await prisma.saasOrg.update({
    where: { id: org.id },
    data: {
      loginUrl: "/login",
      apiUrl: "/api/v1",
      onboardingStatus: "IN_PROGRESS",
    },
  });
  return { login: phone, created: true as const };
}

function shell(title: string, description: string, body: string, extraHead = "", bodyClass = "") {
  return `<!doctype html>
<html lang="en-IN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/x-icon" href="/favicon.ico" />
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
    .calc-box{display:grid;gap:10px;margin:0 0 16px;padding:14px;border:1px solid #d7e4f5;border-radius:18px;background:#f8fbff}.calc-out{font-weight:800;color:#314861;line-height:1.5}.trial-error{border:1px solid #f2b8b5;background:#fff5f4;color:#842820;border-radius:14px;padding:14px 16px;outline:none}.trial-error[hidden]{display:none}.trial-error strong{display:block;color:#842820;font-size:15px}.trial-error p{margin:5px 0 0;font-size:13px;line-height:1.5}.trial-error a{display:inline-block;margin-top:10px;color:#174ea6;font-weight:850;text-decoration:underline}.trial-error a[hidden]{display:none}
    @media(prefers-reduced-motion:reduce){.demo-frame,.path-card,.path-card .icon,#start .btn.primary,#features .card,#features .icon{transition:none}body:before,body:after,.path-card.is-on,.offer-block:not([hidden]),.journey:not([hidden]),.j-step:not([hidden]){animation:none}}
    @media(max-width:1024px){.hero-grid{grid-template-columns:.9fr 1.1fr;gap:32px}h1{font-size:44px}.laptop{width:calc(100% - 48px);margin-right:48px}.phone-shell{right:8px;bottom:12px}}
    @media(max-width:768px){.hero-grid,.grid,.two,.split,.flow,.form-content,.app-band,.intent,.provide,.stats-row,.compare,.closeout-grid,.path-grid,.cal-grid{grid-template-columns:1fr}.compare-vs{min-height:44px}.navlinks,.nav-call{display:none}.nav .wrap{height:72px}.hero{padding:32px 0 40px}.hero-grid{text-align:center}.hero-copy{align-items:center}.cta{justify-content:center}.hero-visual{margin-top:12px}.device-stage{padding:0 0 12px;max-width:420px;margin:0 auto}.laptop{width:calc(100% - 40px);margin-right:40px}.phone-shell{width:120px;right:4px;bottom:10px}h1{font-size:36px;max-width:none}.lead{max-width:36em}.price{font-size:48px}.table{font-size:14px}.form-content{padding:18px}.form-panel{padding:16px}#start .price{font-size:36px}.wrap{width:min(1360px,calc(100% - 40px))}}
  </style>
  ${extraHead}
</head>
<body class="${escapeHtml(bodyClass)}">${body}</body>
</html>`;
}


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
  const title = "Anekio | School Management Software & ERP for Indian Schools";
  const description =
    "School management software for Indian schools: admissions, fees with UPI and receipts, attendance, exams and report cards, timetable and a parent app, on web and Android. Book a free demo.";
  const rate = pricing.perStudentMonthly;
  const minimum = formatInr(pricing.minimumYearly);
  const minStudents = rate > 0 ? Math.ceil(pricing.minimumYearly / (rate * 12)) : 0;
  const ctx = { trial, sale, list, save, savePercent: pricing.savePercent || 0, period, message, esc: escapeHtml, rate, minimum, minStudents };
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: PRODUCT_NAME,
    applicationCategory: "School management software",
    operatingSystem: "Web, Android, iOS",
    offers: { "@type": "Offer", price: String(pricing.minimumYearly), priceCurrency: "INR", description: `₹${rate} per student per month, minimum ₹${minimum} per year`, availability: "https://schema.org/InStock" },
    audience: { "@type": "EducationalAudience", educationalRole: "School administrator" },
    description,
  };
  return shell(
    title,
    description,
    `${birthdayBanner()}${marketingTop(ctx)}
  <section id="start" class="sections wrap">
    <span id="pricing"></span><span id="trial"></span><span id="enquiry"></span>
    <div class="start-head">
      <div class="eyebrow">Get started</div>
      <h2 class="section-title">Choose how you want to begin</h2>
      <p class="muted" style="margin:0">See it first, or start today. Pay only for the students you have.</p>
    </div>
    <div class="path-grid" role="group" aria-label="How to get started" style="grid-template-columns:repeat(2,1fr);max-width:760px;margin-left:auto;margin-right:auto">
      <button type="button" class="path-card is-on" data-path="demo" aria-pressed="true"><span class="icon">▶</span><b>Book a demo</b><p>See Anekio in action. 20 minutes, online.</p></button>
      <button type="button" class="path-card path-launch" data-path="pay" aria-pressed="false"><span class="icon">₹</span><b>Buy now</b><p><strong>₹${rate} / student / month</strong> · min ₹${minimum}/year</p></button>
    </div>
    <div class="split start-split">
      <div class="price-card" id="start-offer">
        <div class="offer-block" data-offer="demo">
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
        <div class="offer-block" data-offer="pay" hidden>
          <div class="eyebrow">Simple per-student pricing</div>
          <h2 class="section-title">${escapeHtml(planName)} plan</h2>
          <div class="price">₹${rate}<span class="price-unit"> / student / month</span></div>
          <p class="fine" style="margin:4px 0 14px">Billed yearly · Minimum ₹${minimum} / year (covers up to ${minStudents} students)</p>
          <div class="calc-box">
            <label>How many students?<input id="calc-students" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 500"></label>
            <div class="calc-out" id="calc-out">Enter your student count to see the yearly price.</div>
          </div>
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
            <div class="journey" data-journey="demo">
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
            <div class="journey" data-journey="pay" hidden>
              <div class="j-step form" data-step="1">
                <div class="eyebrow">Buy Anekio</div>
                <h2 class="start-heading">Your price, based on your students.</h2>
                <label>Number of students<input id="pay-students" type="number" min="1" step="1" inputmode="numeric" required placeholder="e.g. 500"></label>
                <div class="form-note" id="pay-quote" aria-live="polite">Enter your student count to see the yearly price.</div>
                <button class="btn primary" id="pay-continue" type="button" style="width:100%" disabled>Continue →</button>
                <p class="fine">₹${rate} per student per month, billed yearly. Minimum ₹${minimum} / year.</p>
              </div>
              <form id="pay-form" class="form j-step" data-step="2" hidden method="post" action="/api/saas/payment/order">
                <input type="hidden" name="studentCount" id="pay-form-students">
                <div class="eyebrow">School information</div>
                <h2 class="start-heading">Billing details</h2>
                <label>School name<input name="schoolName" required placeholder="VidyaPith Public School"></label>
                <label>Contact person<input name="ownerName" required placeholder="Principal / Owner"></label>
                <label>Email<input name="ownerEmail" type="email" required placeholder="owner@school.in"></label>
                <label>Phone<div class="two" style="grid-template-columns:110px 1fr"><select name="ownerCountryCode"><option value="+91" selected>🇮🇳 +91</option></select><input name="ownerPhone" required inputmode="tel" placeholder="98765 43210"></div></label>
                <div class="two"><label>State<select name="state" required><option value="">Select state</option><option>Karnataka</option><option>Maharashtra</option><option>Tamil Nadu</option><option>Delhi</option><option>Telangana</option><option>Gujarat</option><option>Uttar Pradesh</option><option>West Bengal</option><option>Rajasthan</option><option>Kerala</option><option>Other</option></select></label><label><span>GSTIN <span class="fine" style="display:inline">(optional)</span></span><input name="gstin" maxlength="15" placeholder="29ABCDE1234F1Z5"></label></div>
                <button class="btn primary" type="button" id="pay-summary" style="width:100%">Continue to payment →</button>
              </form>
              <div class="j-step" data-step="3" hidden>
                <div class="eyebrow">Order summary</div>
                <h2 class="start-heading">${escapeHtml(planName)} Plan</h2>
                <div id="pay-breakdown" class="check-list" style="margin:12px 0"></div>
                <p class="fine">GST is applied at secure checkout if required. Total due now: <b id="pay-total"></b> / year</p>
                <button class="btn light" type="button" id="pay-back" style="width:100%;margin-bottom:8px">← Change student count</button>
                <button class="btn primary" type="submit" form="pay-form" style="width:100%">Pay securely →</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
${marketingBottom(ctx)}
${marketingScript()}
<script>
  (function () {
    var root = document.getElementById("start");
    if (!root) return;
    var path = "demo";
    var demoSlot = null;
    var demoPayload = null;
    function show(el, on) {
      if (!el) return;
      if (on) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
    }
    function selectPath(next) {
      path = next === "pay" ? "pay" : "demo";
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
        if (value === "pay" || value === "demo") {
          selectPath(value);
          gotoStep(path, 1);
        }
      });
    });
    function applyHash() {
      var hash = (location.hash || "").replace("#", "");
      if (hash === "trial" || hash === "enquiry" || hash === "demo") selectPath("demo");
      if (hash === "pricing") selectPath("pay");
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);

    // Website forms create a new school, so an email / phone already registered with Anekio is refused.
    var contactState = new WeakMap();
    function contactBox(form) {
      var box = form.querySelector(".contact-taken");
      if (!box) { box = document.createElement("div"); box.className = "trial-error contact-taken"; box.setAttribute("role", "alert"); var h = form.querySelector(".start-heading"); (h || form.firstChild).insertAdjacentElement(h ? "afterend" : "beforebegin", box); }
      return box;
    }
    function checkContact(form) {
      var emailIn = form.querySelector("[name=ownerEmail]"), phoneIn = form.querySelector("[name=ownerPhone]");
      if (!emailIn || !phoneIn) return Promise.resolve(true);
      var e = emailIn.value.trim(), p = phoneIn.value.replace(/[^0-9]/g, "");
      return fetch("/api/saas/contact-check", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ ownerEmail: e.indexOf("@") > 0 ? e : "", ownerPhone: p.length >= 10 ? p : "" }) })
        .then(function (r) { return r.json(); }).then(function (out) {
          var taken = (out && out.taken) || [];
          emailIn.classList.toggle("is-taken", taken.indexOf("email") >= 0);
          phoneIn.classList.toggle("is-taken", taken.indexOf("phone") >= 0);
          var box = form.querySelector(".contact-taken");
          if (taken.length) { contactBox(form).textContent = out.message; return false; }
          if (box) box.remove();
          return true;
        }).catch(function () { return true; });
    }
    ["demo-form", "pay-form"].forEach(function (id) {
      var form = document.getElementById(id); if (!form) return;
      ["ownerEmail", "ownerPhone"].forEach(function (n) {
        var el = form.querySelector("[name=" + n + "]"); if (!el) return;
        var t = null;
        el.addEventListener("blur", function () { checkContact(form); });
        el.addEventListener("input", function () { el.classList.remove("is-taken"); clearTimeout(t); t = setTimeout(function () { checkContact(form); }, 700); });
      });
    });
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
        checkContact(demoForm).then(function (ok) {
          if (!ok) return;
          demoPayload = new FormData(demoForm);
          renderCal();
          gotoStep("demo", 2);
        });
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

    function appLoginUrl() {
      var host = location.hostname;
      var port = location.port;
      if ((host === "localhost" || host === "127.0.0.1") && port === "4000") return "http://localhost:8081/login";
      if (host === "anekio.com" || host === "www.anekio.com") return "https://app.anekio.com/login";
      if (host === "staging.anekio.com") return "https://app.staging.anekio.com/login";
      return "/login";
    }
    var payContinue = document.getElementById("pay-continue");
    var paySummary = document.getElementById("pay-summary");
    var payForm = document.getElementById("pay-form");
    var payStudents = document.getElementById("pay-students");
    var payQuote = document.getElementById("pay-quote");
    var calcStudents = document.getElementById("calc-students");
    var calcOut = document.getElementById("calc-out");
    var lastQuote = null;
    var quoteSeq = 0;
    function inr(n) { return "₹" + Number(n || 0).toLocaleString("en-IN"); }
    function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function getQuote(students) {
      return fetch("/api/saas/price-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ students: students })
      }).then(function (r) { return r.json(); }).then(function (out) {
        if (!out || !out.ok) throw new Error((out && out.error) || "Could not price this.");
        return out.quote;
      });
    }
    function quoteLines(q) {
      var lines = [];
      lines.push(q.students + " students × " + inr(q.rate) + " × 12 months = " + inr(q.students * q.rate * 12));
      if (q.usedMinimum) lines.push("Minimum yearly price " + inr(q.minimumYearly) + " applies");
      return lines;
    }
    var calcTimer = null;
    if (calcStudents && calcOut) {
      calcStudents.addEventListener("input", function () {
        clearTimeout(calcTimer);
        var n = Math.floor(Number(calcStudents.value) || 0);
        if (n < 1) { calcOut.textContent = "Enter your student count to see the yearly price."; return; }
        calcTimer = setTimeout(function () {
          getQuote(n).then(function (q) {
            calcOut.innerHTML = "<b style='font-size:22px'>" + inr(q.total) + " / year</b><br><span class='fine'>" + quoteLines(q).map(esc).join("<br>") + "</span>";
            if (payStudents && !payStudents.value) payStudents.value = String(n);
          }).catch(function () { calcOut.textContent = "Could not calculate right now."; });
        }, 250);
      });
    }
    function refreshPayQuote() {
      if (!payStudents || !payQuote || !payContinue) return;
      var n = Math.floor(Number(payStudents.value) || 0);
      lastQuote = null;
      payContinue.disabled = true;
      if (n < 1) { payQuote.textContent = "Enter your student count to see the yearly price."; return; }
      var seq = ++quoteSeq;
      payQuote.textContent = "Calculating…";
      getQuote(n).then(function (q) {
        if (seq !== quoteSeq) return;
        lastQuote = q;
        var html = "<div><b style='font-size:20px'>" + inr(q.total) + " / year</b><br>" + quoteLines(q).map(esc).join("<br>");
        payQuote.innerHTML = html + "</div>";
        payContinue.disabled = q.total < 1;
        if (q.total < 1) payQuote.innerHTML += "<div>Please contact us to activate this plan.</div>";
      }).catch(function (err) {
        if (seq !== quoteSeq) return;
        payQuote.textContent = err.message || "Could not calculate right now.";
      });
    }
    var payTimer = null;
    if (payStudents) payStudents.addEventListener("input", function () {
      clearTimeout(payTimer); payTimer = setTimeout(refreshPayQuote, 300);
      if (calcStudents && calcStudents.value !== payStudents.value) { calcStudents.value = payStudents.value; calcStudents.dispatchEvent(new Event("input")); }
    });
    if (payContinue) payContinue.addEventListener("click", function () {
      if (!lastQuote) return;
      var fs = document.getElementById("pay-form-students");
      if (fs) fs.value = String(lastQuote.students);
      gotoStep("pay", 2);
    });
    if (paySummary && payForm) {
      paySummary.addEventListener("click", function () {
        if (!payForm.reportValidity() || !lastQuote) return;
        var self = this;
        if (!self.dataset.checked) { checkContact(payForm).then(function (ok) { if (ok) { self.dataset.checked = "1"; self.click(); } }); return; }
        delete self.dataset.checked;
        var box = document.getElementById("pay-breakdown");
        var total = document.getElementById("pay-total");
        if (box) box.innerHTML = quoteLines(lastQuote).map(function (l) { return "<span>" + esc(l) + "</span>"; }).join("");
        if (total) total.textContent = inr(lastQuote.total);
        gotoStep("pay", 3);
      });
    }
    var payBack = document.getElementById("pay-back");
    if (payBack) payBack.addEventListener("click", function () { gotoStep("pay", 1); });
    // Pay without leaving the page: errors appear in the form so details can be corrected.
    function payError(msg, toDetails) {
      var host = toDetails ? payForm : document.querySelector('[data-journey="pay"] [data-step="3"]');
      if (toDetails) gotoStep("pay", 2);
      var box = host.querySelector(".pay-error");
      if (!box) { box = document.createElement("div"); box.className = "trial-error pay-error"; box.setAttribute("role", "alert"); var h = host.querySelector(".start-heading"); h.insertAdjacentElement("afterend", box); }
      box.textContent = msg;
      box.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    function loadRzp() {
      return new Promise(function (resolve, reject) {
        if (window.Razorpay) return resolve();
        var sc = document.createElement("script"); sc.src = "https://checkout.razorpay.com/v1/checkout.js";
        sc.onload = function () { resolve(); }; sc.onerror = function () { reject(new Error("The payment window could not load. Check your connection and try again.")); };
        document.head.appendChild(sc);
      });
    }
    if (payForm) payForm.addEventListener("submit", function (e) {
      if (!window.fetch) return;
      e.preventDefault();
      if (!payForm.reportValidity()) return;
      var btn = document.querySelector('button[form="pay-form"]'), label = btn ? btn.textContent : "";
      document.querySelectorAll(".pay-error").forEach(function (b) { b.remove(); });
      if (btn) { btn.disabled = true; btn.textContent = "Opening payment…"; }
      function reset() { if (btn) { btn.disabled = false; btn.textContent = label; } }
      Promise.all([
        fetch(payForm.action, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(new FormData(payForm)) })
          .then(function (r) { return r.json().then(function (d) { if (!r.ok || !d.ok) throw new Error(d.error || "Could not start the payment."); return d.order; }); }),
        loadRzp()
      ]).then(function (res) {
        var order = res[0];
        new window.Razorpay({
          key: order.keyId, amount: order.amountPaise, currency: "INR", name: "Anekio", description: order.planName + " plan · 1 year", order_id: order.orderId,
          prefill: { name: order.org.ownerName, email: order.org.ownerEmail, contact: order.org.ownerPhone }, theme: { color: "#2563eb" },
          handler: function (resp) {
            fetch("/api/saas/payment/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId: order.org.id, amount: order.amount, razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }) })
              .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || "We could not confirm the payment."); }); })
              .then(function () {
                var step = document.querySelector('[data-journey="pay"] [data-step="3"]');
                step.innerHTML = '<div class="eyebrow">Payment received</div><h2 class="start-heading">Welcome to Anekio.</h2><p class="lead" style="max-width:none">A receipt is on its way to ' + esc(order.org.ownerEmail) + '. Our team will call you within one working day to set up your school.</p><p class="fine">Payment ID ' + esc(resp.razorpay_payment_id) + '</p>';
              })
              .catch(function (err) { reset(); payError((err.message || "We could not confirm the payment.") + " If money was deducted, write to support@anekio.com with payment ID " + resp.razorpay_payment_id + ".", false); });
          },
          modal: { ondismiss: reset }
        }).open();
      }).catch(function (err) {
        reset();
        var msg = err.message || "Could not start the payment.";
        payError(msg, /already registered|email|phone|state|school name/i.test(msg));
      });
    });
  })();
</script>`,
    `${marketingHead()}${marketingCss()}<script type="application/ld+json">${escapeHtml(JSON.stringify(jsonLd))}</script>`,
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
  // A website demo always starts a new school: an email or phone already registered with Anekio is refused.
  const takenContact = await existingContactFields(input);
  if (takenContact.length) throw new Error(existingContactMessage(takenContact));
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

export async function createSaasTrial(input: EnquiryInput, opts: { trialDays?: number; source?: string; note?: string } = {}) {
  const pricing = await getSitePricing();
  const days = opts.trialDays || pricing.trialDays;
  const existing = await findSaasOrgByContact(input);
  if (existing) {
    const existingLogin = await provisionTrialWorkspace(existing);
    if (existingLogin?.created) {
      return { ...existing, login: existingLogin.login, loginUrl: "/login" };
    }
    const email = normalEmail(input.ownerEmail);
    const phones = [...new Set([normalPhone(input.ownerPhone), text(input.ownerPhone)].filter(Boolean))];
    const [emailMatches, phoneMatches] = await Promise.all([
      email ? prisma.saasOrg.count({ where: { ownerEmail: email } }) : 0,
      phones.length ? prisma.saasOrg.count({ where: { ownerPhone: { in: phones } } }) : 0,
    ]);
    throw new ExistingTrialSignupError([
      ...(emailMatches ? ["email" as const] : []),
      ...(phoneMatches ? ["phone" as const] : []),
    ]);
  }
  const org = await createSaasEnquiry({
    ...input,
    notes: [`${days}-day free trial ${opts.source === "PAYMENT_LINK" ? "via admin link" : "requested"}`, opts.note || "", text(input.notes)].filter(Boolean).join(" · "),
  });
  const trial = await prisma.saasOrg.update({
    where: { id: org.id },
    data: {
      plan: `${days}-day free trial`,
      monthlyPrice: 0,
      paymentStatus: "TRIAL",
      subscriptionStatus: "TRIAL",
      followUpStatus: "QUALIFIED",
      source: opts.source || "WEBSITE_TRIAL",
    },
  });
  await captureWebsiteLead(trial.id, "TRIAL");
  const workspace = await provisionTrialWorkspace(trial, days);
  return {
    ...trial,
    login: workspace?.login || "",
    loginUrl: "/login",
  };
}

export function trialStartedHtml(org: Awaited<ReturnType<typeof createSaasTrial>>) {
  const loginLine = org.login ? `<span>After setting your password, sign in with ${escapeHtml(org.login)}.</span>` : "";
  return shell(
    "Free trial started | Anekio",
    "Your Anekio school workspace is ready.",
    `<main class="wrap" style="min-height:100vh;display:grid;place-items:center;padding:40px 0">
      <section class="form-shell" style="max-width:760px;width:100%">
        <div class="form-content" style="grid-template-columns:1fr">
          <div>
            <div class="eyebrow">Trial started</div>
            <h1 style="font-size:52px;margin-bottom:12px">${escapeHtml(org.plan)} is ready.</h1>
            <p class="lead">Thanks, ${escapeHtml(org.ownerName)}. ${escapeHtml(org.schoolName)} now has its own Anekio workspace.</p>
            <div class="check-list">
              <span>No payment is needed for the trial.</span>
              <span>You can sign in as the school administrator.</span>
              <span>Check ${escapeHtml(org.ownerEmail)} for your secure password setup link.</span>
              <span>If the email does not arrive, use Forgot password on the sign-in page.</span>
              ${loginLine}
            </div>
            <a class="btn primary" href="/login">Open Anekio ERP →</a>
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

export async function createSaasRazorpayOrder(input: EnquiryInput & { orgId?: unknown; link?: unknown; students?: unknown }) {
  const pricing = await getSitePricing();
  const keyId = text(process.env.ANEKIO_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID);
  const keySecret = text(process.env.ANEKIO_RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET);
  if (!keyId || !keySecret) throw new Error("Anekio secure payment is not configured yet.");
  // Price is always worked out here, never taken from the browser. Special pricing only comes from an
  // admin-made payment link (input.link); a typed coupon code is never accepted.
  const linkToken = text(input.link);
  const paymentLink = linkToken ? await getPaymentLink(linkToken) : null;
  if (paymentLink?.problem) throw new Error(`${paymentLink.problem} Please contact support@anekio.com for a new link.`);
  // A renewal link always pays for the organisation it was made for; nothing in the request can change that.
  const renewalLink = paymentLink?.link?.purpose === "RENEWAL" ? paymentLink.link : null;
  if (renewalLink && !renewalLink.orgId) throw new Error("This renewal link is not linked to a school. Please contact support@anekio.com.");
  // A new-school link must create a new organisation: an email or phone that already belongs to a school is refused.
  if (paymentLink?.link && !renewalLink) {
    const taken = await existingContactFields(input);
    if (taken.length) throw new Error(existingContactMessage(taken));
  }
  // Website "Buy now" (no link, no organisation) is for new schools only.
  if (!paymentLink?.link && !text(input.orgId)) {
    const taken = await existingContactFields(input);
    if (taken.length) throw new Error(existingContactMessage(taken));
  }
  const orgId = renewalLink ? String(renewalLink.orgId) : paymentLink?.link ? "" : text(input.orgId);
  const existing = orgId ? null : await findSaasOrgByContact(input);
  const known = orgId ? await prisma.saasOrg.findUnique({ where: { id: orgId } }) : existing;
  if (renewalLink && !known) throw new Error("The school on this renewal link was not found. Please contact support@anekio.com.");
  const students = paymentLink?.link?.students ?? intOrNull(input.studentCount ?? input.students) ?? known?.studentCount ?? 0;
  if (!students || students < 1) throw new Error("Enter the number of students in your school.");
  const quote = await quoteForSchool({ students, link: linkToken, strict: Boolean(linkToken) });
  if (quote.total < 1) throw new Error("This plan has no amount to pay. Please contact us at support@anekio.com to activate it.");
  const org = known
    ? await prisma.saasOrg.update({
        where: { id: known.id },
        data: {
          ...(orgId
            ? {}
            : {
                ownerCountryCode: countryCode(input.ownerCountryCode || known.ownerCountryCode),
                city: text(input.city, known.city),
                billingState: text(input.state, known.billingState),
                gstin: text(input.gstin, known.gstin).toUpperCase(),
                followUpStatus: "RENEWAL_STARTED",
                paymentStatus: known.paymentStatus === "PAID" ? "RENEWAL_DUE" : known.paymentStatus,
              }),
          studentCount: students,
          monthlyPrice: quote.total,
          plan: quote.plan?.name || pricing.planName,
        },
      })
    : await createSaasEnquiry({ ...input, studentCount: students });
  if (!org) throw new Error("Organisation not found.");
  if (!known) await prisma.saasOrg.update({ where: { id: org.id }, data: { monthlyPrice: quote.total, studentCount: students } });
  const renewal = Boolean(known);
  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const order = await razorpay.orders.create({
    amount: quote.total * 100,
    currency: "INR",
    receipt: org.id.slice(0, 40),
    notes: {
      orgId: org.id,
      schoolName: org.schoolName,
      product: PRODUCT_NAME,
      purpose: renewal ? "renewal" : "new",
      plan: quote.plan?.name || pricing.planName,
      students: String(students),
      paymentLink: quote.coupon?.code || "",
    },
  });
  const couponNote = paymentLink?.link ? ` · payment link ${paymentLink.link.code}${quote.plan ? ` · ${quote.plan.name} (${quote.plan.validityMonths} months)` : ""} · ${quote.coupon?.label || ""}` : "";
  await prisma.saasPayment.create({
    data: {
      orgId: org.id,
      amount: quote.total,
      orderId: order.id,
      status: "CREATED",
      couponCode: paymentLink?.link?.code || "",
      studentCount: students,
      notes: `${renewal ? "Renewal" : "Subscription"} order · ${students} students${couponNote}`,
    },
  });
  return {
    keyId,
    orderId: order.id,
    amount: quote.total,
    amountPaise: quote.total * 100,
    org,
    renewal,
    planName: quote.plan?.name || pricing.planName,
    quote,
  };
}

export function saasCheckoutHtml(order: Awaited<ReturnType<typeof createSaasRazorpayOrder>>) {
  const verifyPayload = { orgId: order.org.id, amount: order.amount };
  const heading = order.renewal ? "Renew your Anekio plan" : "Complete your Anekio payment";
  const description = order.renewal ? `${order.planName} plan renewal` : `${order.planName} plan`;
  const successTitle = order.renewal ? "Renewal received" : "Payment received";
  const successHeading = order.renewal ? "Your Anekio access is renewing" : "Welcome to Anekio";
  const successCopy = order.renewal
    ? "Your renewal payment is recorded. You can continue using Anekio while our account manager follows up."
    : "Your payment is recorded. One of our account managers will connect with you for onboarding.";
  const q = order.quote;
  const breakdown = [
    q.coupon && q.baseYearly === q.total && !q.discount && q.rate === q.standardRate
      ? `${q.students} students · agreed price for your school`
      : `${q.students} students × ₹${q.rate} × 12 months${q.usedMinimum ? ` (minimum ₹${formatInr(q.minimumYearly)} a year applies)` : ""}`,
    q.coupon && q.discount ? `Agreed discount for your school: −₹${formatInr(q.discount)}` : "",
  ].filter(Boolean);
  return shell(
    "Complete payment | Anekio",
    "Complete your Anekio payment securely.",
    `<main class="wrap" style="min-height:100vh;display:grid;place-items:center;padding:40px 0">
      <section class="price-card" style="max-width:620px;width:100%">
        <div class="eyebrow">Secure checkout</div>
        <h1 style="font-size:44px;margin-bottom:10px">${heading}</h1>
        <p class="lead" style="font-size:18px">School: ${escapeHtml(order.org.schoolName)}</p>
        <div class="price">₹${formatInr(order.amount)}<span class="price-unit"> / year</span></div>
        ${breakdown.map((line) => `<p class="fine" style="margin:4px 0">${line}</p>`).join("")}
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
  // The order row holds the exact amount, students and coupon priced at checkout.
  const ordered = await prisma.saasPayment.findFirst({ where: { orderId: razorpayOrderId, orgId }, orderBy: { createdAt: "asc" } });
  const amount = ordered?.amount ?? org.monthlyPrice ?? pricing.salePrice;
  if (!existing) {
    await prisma.saasPayment.create({
      data: {
        orgId,
        amount,
        orderId: razorpayOrderId,
        paymentId: razorpayPaymentId,
        status: "PAID",
        couponCode: ordered?.couponCode || "",
        studentCount: ordered?.studentCount ?? null,
        notes: `Secure checkout verified${ordered?.couponCode ? ` · coupon ${ordered.couponCode}` : ""}`,
        paidAt: new Date(),
      },
    });
    if (ordered?.couponCode) await markCouponUsed(ordered.couponCode);
  }
  // A payment made through an admin link buys that link's plan (name + validity).
  const linkRow = ordered?.couponCode ? await prisma.saasCoupon.findUnique({ where: { code: ordered.couponCode } }) : null;
  const linkPlan = linkRow?.planId ? await prisma.saasPlan.findUnique({ where: { id: linkRow.planId } }) : null;
  if (!existing) {
    await fulfillPaidSubscription({
      orgId,
      amount,
      validityMonths: linkPlan?.validityMonths || 12,
      plan: linkPlan?.name || pricing.planName,
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
  const renewQuote = org ? await quoteForSchool({ students: org.studentCount || 0 }) : null;
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
              <div class="price">₹${formatInr(renewQuote?.total || pricing.minimumYearly)}<span class="price-unit"> / year</span></div>
              <p class="muted">₹${pricing.perStudentMonthly} per student per month, minimum ₹${formatInr(pricing.minimumYearly)} a year. Update your student count below; the final price is shown at checkout.</p>
              <form class="form" method="post" action="/api/saas/payment/order">
                <input type="hidden" name="orgId" value="${escapeHtml(org.id)}">
                <div class="two"><label>Number of students<input name="studentCount" type="number" min="1" required value="${org.studentCount || ""}"></label></div>
                <button class="btn primary" type="submit" style="width:100%;margin-top:14px">Continue to secure checkout →</button>
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
  const lockQuote = await quoteForSchool({ students: org.studentCount || 0 });
  return {
    locked: true,
    orgId: org.id,
    schoolName: org.schoolName,
    status: org.subscriptionStatus,
    renewalOn: org.renewalOn ? org.renewalOn.toISOString() : "",
    renewUrl: renewalUrl(org.id),
    amount: lockQuote.total || pricing.minimumYearly,
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
  const urls = ["/", "/features", "/pricing", ...blogSitemapPaths()].map(
    (path) => `<url><loc>${escapeHtml(pageUrl(path))}</loc><changefreq>weekly</changefreq><priority>${path === "/" ? "1.0" : "0.8"}</priority></url>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
}
