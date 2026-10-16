import { describe, expect, it } from "vitest";
import { creditFor, isLimited, leaveYearFor, periodsOf } from "../../lib/leave-balance";

const year = leaveYearFor("2026-10-16", 4);

describe("leave year", () => {
  it("April start: Oct 2026 is in 2026-27", () => {
    expect(year).toMatchObject({ key: "LY2026", from: "2026-04-01", to: "2027-03-31", label: "2026-27" });
  });
  it("April start: Feb 2027 is still 2026-27", () => {
    expect(leaveYearFor("2027-02-10", 4).key).toBe("LY2026");
  });
  it("January start uses the calendar year", () => {
    expect(leaveYearFor("2026-10-16", 1)).toMatchObject({ key: "LY2026", from: "2026-01-01", to: "2026-12-31", label: "2026" });
  });
  it("June start", () => {
    expect(leaveYearFor("2026-05-31", 6).from).toBe("2025-06-01");
  });
});

describe("periods", () => {
  it("monthly gives 12 periods starting at the leave year", () => {
    const p = periodsOf({ creditMode: "MONTHLY" }, year, 4);
    expect(p).toHaveLength(12);
    expect(p[0]).toMatchObject({ key: "LY2026-M0", start: "2026-04-01", end: "2026-04-30" });
    expect(p[11]).toMatchObject({ start: "2027-03-01", end: "2027-03-31" });
  });
  it("quarterly gives 4", () => {
    const p = periodsOf({ creditMode: "QUARTERLY" }, year, 4);
    expect(p.map((x) => x.start)).toEqual(["2026-04-01", "2026-07-01", "2026-10-01", "2027-01-01"]);
  });
});

describe("credits", () => {
  const monthly = { creditMode: "MONTHLY", creditAmount: 1, yearlyCap: 0, prorateJoiners: true };
  const oct = periodsOf({ creditMode: "MONTHLY" }, year, 4)[6];
  it("credits a month to someone who joined before it", () => {
    expect(creditFor(monthly, oct, "2025-01-10")).toBe(1);
  });
  it("credits the joining month if joined by the middle", () => {
    expect(creditFor(monthly, oct, "2026-10-10")).toBe(1);
  });
  it("skips the month if joined late in it", () => {
    expect(creditFor(monthly, oct, "2026-10-25")).toBe(0);
  });
  it("yearly prorates a mid-year joiner", () => {
    const yearly = { creditMode: "YEARLY", creditAmount: 0, yearlyCap: 12, prorateJoiners: true };
    const y = periodsOf(yearly, year, 4)[0];
    expect(creditFor(yearly, y, "2025-06-01")).toBe(12);
    expect(creditFor(yearly, y, "2026-10-10")).toBe(6); // Oct..Mar = 6 months
    expect(creditFor(yearly, y, "2026-10-20")).toBe(5); // joined after the 15th: Nov..Mar
    expect(creditFor({ ...yearly, prorateJoiners: false }, y, "2026-10-20")).toBe(12);
  });
  it("no cap / no amount means unlimited", () => {
    expect(isLimited({ creditMode: "YEARLY", yearlyCap: 0, creditAmount: 0 })).toBe(false);
    expect(isLimited({ creditMode: "MONTHLY", yearlyCap: 10, creditAmount: 0 })).toBe(false);
    expect(isLimited({ creditMode: "MONTHLY", yearlyCap: 0, creditAmount: 1.5 })).toBe(true);
  });
});
