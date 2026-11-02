/**
 * Anekio subscription price. Pure: no database.
 *
 *   yearly = max(minimum, students × ₹ per student per month × 12)
 *
 * Coupons:
 *   RATE    – a different ₹ per student per month (the minimum still applies unless the coupon sets its own)
 *   PERCENT – % off the yearly price
 *   AMOUNT  – ₹ off the yearly price
 *   FIXED   – an agreed ₹ per year, whatever the student count
 *   NONE    – no discount: the plan's own price
 * A coupon's own minimum (if set) replaces the standard minimum.
 */

export type QuoteCoupon = {
  code: string;
  kind: string;
  value: number;
  minimumYearly?: number | null;
};

export type PriceQuote = {
  students: number;
  /** ₹ per student per month actually used. */
  rate: number;
  standardRate: number;
  minimumYearly: number;
  /** Yearly price before any coupon (standard rate and minimum). */
  standardYearly: number;
  /** Yearly price after the rate/minimum but before % or ₹ off. */
  baseYearly: number;
  discount: number;
  total: number;
  usedMinimum: boolean;
  /** Months the price covers (the plan validity). */
  months: number;
  coupon: null | { code: string; label: string };
};

export function couponLabel(c: QuoteCoupon) {
  if (c.kind === "NONE") return "Plan price";
  if (c.kind === "RATE") return `₹${c.value} per student / month`;
  if (c.kind === "AMOUNT") return `₹${c.value.toLocaleString("en-IN")} off`;
  if (c.kind === "FIXED") return `₹${c.value.toLocaleString("en-IN")} per year`;
  return `${c.value}% off`;
}

/** "1 year", "6 months", "2 years". */
export function validityLabel(months: number) {
  const m = Math.max(1, Math.round(months || 12));
  if (m % 12 === 0) return m === 12 ? "1 year" : `${m / 12} years`;
  return m === 1 ? "1 month" : `${m} months`;
}

export function quotePrice(
  pricing: { perStudentMonthly: number; minimumYearly: number; validityMonths?: number },
  studentsIn: number,
  coupon?: QuoteCoupon | null
): PriceQuote {
  const students = Math.max(0, Math.floor(Number(studentsIn) || 0));
  const months = Math.max(1, Math.round(pricing.validityMonths || 12));
  const standardRate = Math.max(0, pricing.perStudentMonthly);
  const standardMin = Math.max(0, pricing.minimumYearly);
  const standardYearly = Math.max(standardMin, students * standardRate * months);

  const rate = coupon?.kind === "RATE" ? Math.max(0, coupon.value) : standardRate;
  const minimumYearly = coupon && coupon.minimumYearly != null && coupon.minimumYearly >= 0 ? coupon.minimumYearly : standardMin;
  const perStudent = students * rate * months;
  const baseYearly = coupon?.kind === "FIXED" ? Math.max(0, coupon.value) : Math.max(minimumYearly, perStudent);
  let discount = 0;
  if (coupon?.kind === "PERCENT") discount = Math.round((baseYearly * Math.min(100, Math.max(0, coupon.value))) / 100);
  if (coupon?.kind === "AMOUNT") discount = Math.min(baseYearly, Math.max(0, coupon.value));
  const total = Math.max(0, baseYearly - discount);
  return {
    students,
    rate,
    standardRate,
    minimumYearly,
    standardYearly,
    baseYearly,
    discount,
    total,
    usedMinimum: coupon?.kind !== "FIXED" && minimumYearly > perStudent,
    months,
    coupon: coupon ? { code: coupon.code, label: couponLabel(coupon) } : null,
  };
}

/** Why a coupon cannot be used right now, or "" if it can. */
export function couponProblem(
  c: { active: boolean; validUntil?: Date | null; maxUses: number; usedCount: number } | null,
  now = new Date()
) {
  if (!c) return "That coupon code is not valid.";
  if (!c.active) return "That coupon is no longer active.";
  if (c.validUntil && c.validUntil.getTime() < now.getTime()) return "That coupon has expired.";
  if (c.maxUses > 0 && c.usedCount >= c.maxUses) return "That coupon has been fully used.";
  return "";
}

export function normaliseCouponCode(raw: unknown) {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}
