import { describe, expect, it } from "vitest";
import { couponProblem, normaliseCouponCode, quotePrice } from "../../lib/saas-quote";

const P = { perStudentMonthly: 5, minimumYearly: 12000 };

describe("quotePrice", () => {
  it("uses the minimum for small schools", () => {
    const q = quotePrice(P, 100);
    expect(q.total).toBe(12000);
    expect(q.usedMinimum).toBe(true);
  });
  it("charges ₹5 × 12 per student above the minimum", () => {
    expect(quotePrice(P, 500).total).toBe(30000);
    expect(quotePrice(P, 1000).total).toBe(60000);
    expect(quotePrice(P, 200).total).toBe(12000);
    expect(quotePrice(P, 201).total).toBe(12060);
  });
  it("applies a per-student rate coupon, keeping the minimum", () => {
    const q = quotePrice(P, 1000, { code: "EARLY3", kind: "RATE", value: 3 });
    expect(q.total).toBe(36000);
    expect(q.standardYearly).toBe(60000);
    expect(quotePrice(P, 100, { code: "EARLY3", kind: "RATE", value: 3 }).total).toBe(12000);
  });
  it("lets a coupon set its own minimum", () => {
    expect(quotePrice(P, 100, { code: "PARTNER", kind: "RATE", value: 3, minimumYearly: 6000 }).total).toBe(6000);
  });
  it("applies % and ₹ off on the yearly price", () => {
    expect(quotePrice(P, 500, { code: "PILOT20", kind: "PERCENT", value: 20 }).total).toBe(24000);
    expect(quotePrice(P, 100, { code: "PILOT20", kind: "PERCENT", value: 20 }).total).toBe(9600);
    expect(quotePrice(P, 500, { code: "OFF2000", kind: "AMOUNT", value: 2000 }).total).toBe(28000);
    expect(quotePrice(P, 10, { code: "BIG", kind: "AMOUNT", value: 99999 }).total).toBe(0);
  });
  it("charges an agreed fixed yearly price whatever the student count", () => {
    const q = quotePrice(P, 800, { code: "LINK", kind: "FIXED", value: 20000 });
    expect(q.total).toBe(20000);
    expect(q.usedMinimum).toBe(false);
    expect(quotePrice(P, 50, { code: "LINK", kind: "FIXED", value: 8000 }).total).toBe(8000);
  });
  it("never goes negative or breaks on bad input", () => {
    expect(quotePrice(P, -5).total).toBe(12000);
    expect(quotePrice(P, Number.NaN).total).toBe(12000);
    expect(quotePrice(P, 500, { code: "X", kind: "PERCENT", value: 150 }).total).toBe(0);
  });
});

describe("couponProblem", () => {
  const ok = { active: true, validUntil: null, maxUses: 0, usedCount: 0 };
  it("accepts a valid coupon", () => expect(couponProblem(ok)).toBe(""));
  it("rejects missing, inactive, expired and used-up coupons", () => {
    expect(couponProblem(null)).toMatch(/not valid/);
    expect(couponProblem({ ...ok, active: false })).toMatch(/no longer active/);
    expect(couponProblem({ ...ok, validUntil: new Date("2020-01-01") })).toMatch(/expired/);
    expect(couponProblem({ ...ok, maxUses: 3, usedCount: 3 })).toMatch(/fully used/);
  });
  it("normalises codes", () => expect(normaliseCouponCode(" pilot-20 !")).toBe("PILOT-20"));
});
