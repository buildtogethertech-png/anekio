import crypto from "node:crypto";
import { prisma } from "./prisma";
import { couponProblem, normaliseCouponCode, quotePrice, type PriceQuote } from "./saas-quote";

export const PRICING_ID = "anekio";

export type SitePricing = {
  planName: string;
  listPrice: number;
  discountOn: boolean;
  discountType: "AMOUNT" | "PERCENT";
  discountValue: number;
  salePrice: number;
  saveAmount: number;
  savePercent: number;
  offerLabel: string;
  billingPeriod: string;
  trialDays: number;
  /** ₹ per student per month. */
  perStudentMonthly: number;
  /** Lowest yearly price (small schools). */
  minimumYearly: number;
};

const FALLBACK: Omit<SitePricing, "salePrice" | "saveAmount" | "savePercent"> = {
  planName: "Launch",
  listPrice: 29999,
  discountOn: true,
  discountType: "AMOUNT",
  discountValue: 15000,
  offerLabel: "Early bird",
  billingPeriod: "year",
  trialDays: 7,
  perStudentMonthly: 5,
  minimumYearly: 12000,
};

export function computeSitePricing(input: {
  planName?: string;
  listPrice?: number;
  discountOn?: boolean;
  discountType?: string;
  discountValue?: number;
  offerLabel?: string;
  billingPeriod?: string;
  trialDays?: number;
  perStudentMonthly?: number;
  minimumYearly?: number;
}): SitePricing {
  const listPrice = Math.max(0, Math.round(Number(input.listPrice) || FALLBACK.listPrice));
  const discountOn = Boolean(input.discountOn);
  const discountType = input.discountType === "PERCENT" ? "PERCENT" : "AMOUNT";
  const discountValue = Math.max(0, Math.round(Number(input.discountValue) || 0));
  let salePrice = listPrice;
  if (discountOn && discountValue > 0) {
    salePrice =
      discountType === "PERCENT"
        ? Math.round(listPrice * (1 - Math.min(100, discountValue) / 100))
        : listPrice - discountValue;
  }
  salePrice = Math.max(0, Math.min(listPrice, salePrice));
  const saveAmount = Math.max(0, listPrice - salePrice);
  const savePercent = listPrice ? Math.round((saveAmount / listPrice) * 100) : 0;
  return {
    planName: String(input.planName || FALLBACK.planName).trim() || FALLBACK.planName,
    listPrice,
    discountOn,
    discountType,
    discountValue,
    salePrice,
    saveAmount,
    savePercent,
    offerLabel: String(input.offerLabel ?? FALLBACK.offerLabel).trim(),
    billingPeriod: String(input.billingPeriod || FALLBACK.billingPeriod).trim() || "year",
    trialDays: Math.max(1, Math.round(Number(input.trialDays) || FALLBACK.trialDays)),
    perStudentMonthly: Math.max(0, Math.round(Number(input.perStudentMonthly ?? FALLBACK.perStudentMonthly))),
    minimumYearly: Math.max(0, Math.round(Number(input.minimumYearly ?? FALLBACK.minimumYearly))),
  };
}

export async function getSitePricing(): Promise<SitePricing> {
  const row = await prisma.saasSitePricing.upsert({
    where: { id: PRICING_ID },
    create: { id: PRICING_ID, ...FALLBACK },
    update: {},
  });
  return computeSitePricing(row);
}

export async function updateSitePricing(input: Record<string, unknown>, actorEmail: string) {
  const next = computeSitePricing({
    planName: String(input.planName || ""),
    listPrice: Number(input.listPrice),
    discountOn: input.discountOn === "on" || input.discountOn === true || input.discountOn === "true" || input.discountOn === "1",
    discountType: String(input.discountType || "AMOUNT"),
    discountValue: Number(input.discountValue),
    offerLabel: String(input.offerLabel || ""),
    billingPeriod: String(input.billingPeriod || "year"),
    trialDays: Number(input.trialDays),
    perStudentMonthly: input.perStudentMonthly === undefined ? undefined : Number(input.perStudentMonthly),
    minimumYearly: input.minimumYearly === undefined ? undefined : Number(input.minimumYearly),
  });
  await prisma.saasSitePricing.upsert({
    where: { id: PRICING_ID },
    create: {
      id: PRICING_ID,
      planName: next.planName,
      listPrice: next.listPrice,
      discountOn: next.discountOn,
      discountType: next.discountType,
      discountValue: next.discountValue,
      offerLabel: next.offerLabel,
      billingPeriod: next.billingPeriod,
      trialDays: next.trialDays,
      perStudentMonthly: next.perStudentMonthly,
      minimumYearly: next.minimumYearly,
    },
    update: {
      planName: next.planName,
      listPrice: next.listPrice,
      discountOn: next.discountOn,
      discountType: next.discountType,
      discountValue: next.discountValue,
      offerLabel: next.offerLabel,
      billingPeriod: next.billingPeriod,
      trialDays: next.trialDays,
      perStudentMonthly: next.perStudentMonthly,
      minimumYearly: next.minimumYearly,
    },
  });
  await prisma.saasAuditEvent.create({
    data: {
      actorEmail,
      action: "SITE_PRICING_UPDATED",
      entityType: "PRICING",
      entityId: PRICING_ID,
      detail: `${next.planName} · ₹${next.perStudentMonthly}/student/month · minimum ₹${next.minimumYearly}/year`,
    },
  });
  return next;
}

/* ---------------- Per-student quote and coupons ---------------- */

export async function findUsableCoupon(rawCode: unknown) {
  const code = normaliseCouponCode(rawCode);
  if (!code) return { coupon: null, problem: "" };
  const coupon = await prisma.saasCoupon.findUnique({ where: { code } });
  const problem = couponProblem(coupon);
  return { coupon: problem ? null : coupon, problem };
}

/**
 * Server-side price for a school. The public site prices from the student count only;
 * special pricing comes only from an admin-made payment link (`link` = its token).
 */
export async function quoteForSchool(input: { students: unknown; link?: unknown; strict?: boolean }): Promise<PriceQuote & { linkError: string; plan: { id: string; name: string; validityMonths: number } | null }> {
  const pricing = await getSitePricing();
  const { coupon, problem } = await findUsableCoupon(input.link);
  if (problem && input.strict) throw new Error(problem.replace("That coupon code is not valid.", "This payment link is not valid.").replace("coupon", "payment link"));
  // A payment link sells a plan: its price and validity replace the public website price.
  const plan = coupon?.planId ? await prisma.saasPlan.findUnique({ where: { id: coupon.planId } }) : null;
  const quote = quotePrice(plan || pricing, Number(input.students) || 0, coupon);
  return { ...quote, linkError: problem, plan: plan ? { id: plan.id, name: plan.name, validityMonths: plan.validityMonths } : null };
}

/* ---------------- Plans ---------------- */

/** All plans; creates a first plan from the website price the first time. */
export async function listPlans() {
  const count = await prisma.saasPlan.count();
  if (!count) {
    const p = await getSitePricing();
    await prisma.saasPlan.create({ data: { name: p.planName || "School", perStudentMonthly: p.perStudentMonthly, minimumYearly: p.minimumYearly, validityMonths: 12, createdBy: "system" } });
  }
  return prisma.saasPlan.findMany({ orderBy: [{ active: "desc" }, { createdAt: "asc" }] });
}

export async function createPlan(input: Record<string, unknown>, actorEmail: string) {
  const name = String(input.name ?? "").trim().slice(0, 60);
  if (!name) throw new Error("Enter a plan name.");
  if (input.planType === "TRIAL") {
    const trialDays = Math.round(Number(input.trialDays));
    if (!Number.isFinite(trialDays) || trialDays < 1 || trialDays > 90) throw new Error("Trial length must be between 1 and 90 days.");
    const row = await prisma.saasPlan.create({ data: { name, perStudentMonthly: 0, minimumYearly: 0, validityMonths: 1, trialDays, createdBy: actorEmail } });
    await prisma.saasAuditEvent.create({ data: { actorEmail, action: "PLAN_CREATED", entityType: "PLAN", entityId: row.id, detail: `${name} · free trial ${trialDays} days` } });
    return row;
  }
  const perStudentMonthly = Math.round(Number(input.perStudentMonthly));
  if (!Number.isFinite(perStudentMonthly) || perStudentMonthly < 0) throw new Error("Enter the ₹ per student per month.");
  const minimumYearly = Math.max(0, Math.round(Number(input.minimumYearly) || 0));
  const validityMonths = Math.round(Number(input.validityMonths));
  if (!Number.isFinite(validityMonths) || validityMonths < 1 || validityMonths > 60) throw new Error("Validity must be between 1 and 60 months.");
  const row = await prisma.saasPlan.create({ data: { name, perStudentMonthly, minimumYearly, validityMonths, createdBy: actorEmail } });
  await prisma.saasAuditEvent.create({
    data: { actorEmail, action: "PLAN_CREATED", entityType: "PLAN", entityId: row.id, detail: `${name} · ₹${perStudentMonthly}/student/month · min ₹${minimumYearly} · ${validityMonths} months` },
  });
  return row;
}

export async function setPlanActive(id: string, active: boolean, actorEmail: string) {
  const row = await prisma.saasPlan.update({ where: { id }, data: { active } });
  await prisma.saasAuditEvent.create({ data: { actorEmail, action: active ? "PLAN_ENABLED" : "PLAN_DISABLED", entityType: "PLAN", entityId: id, detail: row.name } });
  return row;
}

/** A payment link and whether it can still be paid. */
export async function getPaymentLink(token: unknown) {
  const code = normaliseCouponCode(token);
  if (!code) return { link: null, problem: "This payment link is not valid." };
  const link = await prisma.saasCoupon.findUnique({ where: { code } });
  const problem = couponProblem(link)
    .replace("That coupon code is not valid.", "This payment link is not valid.")
    .replace("That coupon is no longer active.", "This payment link is no longer active.")
    .replace("That coupon has expired.", "This payment link has expired.")
    .replace("That coupon has been fully used.", "This payment link has already been used.");
  return { link, problem };
}

function linkToken() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(12);
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

/** Admin: create a private payment link with agreed pricing for one school. */
export async function createPaymentLink(input: Record<string, unknown>, actorEmail: string) {
  const plan = await prisma.saasPlan.findUnique({ where: { id: String(input.planId ?? "") } });
  if (!plan || !plan.active) throw new Error("Choose a plan.");
  const trial = plan.trialDays > 0;
  if (trial) input = { ...input, kind: "NONE", value: 0, purpose: "NEW" }; // a free trial always creates a new school
  const kind = ["NONE", "RATE", "FIXED", "PERCENT", "AMOUNT"].includes(String(input.kind)) ? String(input.kind) : "NONE";
  const value = kind === "NONE" ? 0 : Math.round(Number(input.value));
  if (kind !== "NONE" && (!Number.isFinite(value) || value <= 0)) throw new Error("Enter the discount value.");
  if (kind === "PERCENT" && value > 100) throw new Error("Percent off cannot be more than 100.");
  // The plan carries the minimum and the validity; the link never expires on its own (switch it off instead).
  const minimumYearly = null;
  const studentsRaw = Math.round(Number(input.students) || 0);
  const students = studentsRaw > 0 ? Math.min(100000, studentsRaw) : null;
  const maxUses = Math.max(0, Math.round(Number(input.maxUses ?? 1) || 0));
  const validUntil = null;
  const purpose = input.purpose === "RENEWAL" ? "RENEWAL" : "NEW";
  let schoolName = String(input.schoolName ?? "").trim().slice(0, 120);
  let orgId: string | null = null;
  let studentsFinal = students;
  if (purpose === "RENEWAL") {
    const org = await prisma.saasOrg.findUnique({ where: { id: String(input.orgId ?? "") } });
    if (!org) throw new Error("Choose the school to renew.");
    orgId = org.id;
    schoolName = org.schoolName;
    studentsFinal = students ?? (org.studentCount && org.studentCount > 0 ? org.studentCount : null);
    if (!studentsFinal && kind !== "FIXED") throw new Error("Enter the student count for this renewal.");
  }
  if (!schoolName) throw new Error("Enter the school this link is for.");
  let code = linkToken();
  while (await prisma.saasCoupon.findUnique({ where: { code } })) code = linkToken();
  const row = await prisma.saasCoupon.create({
    data: { code, kind, value, minimumYearly, maxUses, validUntil, schoolName, students: studentsFinal, purpose, orgId, planId: plan.id, note: String(input.note ?? "").slice(0, 200), createdBy: actorEmail },
  });
  await prisma.saasAuditEvent.create({
    data: { actorEmail, action: "PAYMENT_LINK_CREATED", entityType: "PAYMENT_LINK", entityId: row.id, detail: `${purpose === "RENEWAL" ? "Renewal" : "New school"} · ${schoolName} · ${plan.name} · ${kind} ${value}${studentsFinal ? ` · ${studentsFinal} students` : ""}` },
  });
  return row;
}

export async function markCouponUsed(rawCode: unknown) {
  const code = normaliseCouponCode(rawCode);
  if (!code) return;
  await prisma.saasCoupon.updateMany({ where: { code }, data: { usedCount: { increment: 1 } } });
}

export async function listCoupons() {
  return prisma.saasCoupon.findMany({ orderBy: [{ active: "desc" }, { createdAt: "desc" }] });
}

export async function setCouponActive(id: string, active: boolean, actorEmail: string) {
  const row = await prisma.saasCoupon.update({ where: { id }, data: { active } });
  await prisma.saasAuditEvent.create({
    data: { actorEmail, action: active ? "PAYMENT_LINK_ENABLED" : "PAYMENT_LINK_DISABLED", entityType: "PAYMENT_LINK", entityId: id, detail: row.code },
  });
  return row;
}
