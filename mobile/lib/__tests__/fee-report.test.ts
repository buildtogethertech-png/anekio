import { collectionRate, datePresetRange, parseDay, previousRange, ymd } from "../fee-report";

describe("fee report money rules", () => {
  it("treats collected as the payment amount on paidAt, not invoice period", () => {
    const payment = { amount: 1010, paidAt: "2026-09-11T10:00:00.000Z", period: "2026-07" };
    expect(parseDay(payment.paidAt).startsWith("2026-09")).toBe(true);
    expect(payment.period).toBe("2026-07");
  });

  it("sums two payments as collected", () => {
    expect([1000, 2000].reduce((sum, amount) => sum + amount, 0)).toBe(3000);
  });

  it("returns no collection rate when billed is zero", () => {
    expect(collectionRate(1000, 0)).toBeNull();
    expect(collectionRate(284500, 340000)).toBe(83.7);
  });

  it("defaults the date preset to the current month", () => {
    expect(datePresetRange("month", "2026-09-13")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("builds a previous equal-length range for comparison", () => {
    expect(previousRange("2026-09-01", "2026-09-30")).toEqual({ from: "2026-08-02", to: "2026-08-31" });
  });

  it("formats local ymd without UTC shift for a calendar date", () => {
    expect(ymd(new Date(2026, 8, 11))).toBe("2026-09-11");
  });
});
