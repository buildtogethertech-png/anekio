import { afterEach, describe, expect, it, vi } from "vitest";
import { invoiceBalance, invoiceLateStamp, latePolicyLabel } from "../../lib/fees";

describe("fee late rules", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a one-time late fine only after the grace period ends", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T08:00:00Z"));

    const beforeGraceEnds = invoiceBalance({
      amount: 1000,
      dueDate: new Date("2026-09-10T00:00:00Z"),
      lateKind: "STATIC",
      lateGraceDays: 5,
      lateAmount: 100,
    });
    expect(beforeGraceEnds.late).toBe(0);

    vi.setSystemTime(new Date("2026-09-16T08:00:00Z"));
    const afterGraceEnds = invoiceBalance({
      amount: 1000,
      dueDate: new Date("2026-09-10T00:00:00Z"),
      lateKind: "STATIC",
      lateGraceDays: 5,
      lateAmount: 100,
    });
    expect(afterGraceEnds.late).toBe(100);
  });

  it("charges recurring day intervals from the day after grace", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T08:00:00Z"));

    const balance = invoiceBalance({
      amount: 1000,
      dueDate: new Date("2026-09-10T00:00:00Z"),
      lateKind: "RECURRING",
      lateGraceDays: 5,
      lateAmount: 100,
      lateIntervalCount: 15,
      lateIntervalUnit: "DAY",
    });

    expect(balance.late).toBe(200);
  });

  it("charges recurring month intervals by calendar month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T08:00:00Z"));

    const balance = invoiceBalance({
      amount: 1000,
      dueDate: new Date("2026-09-10T00:00:00Z"),
      lateKind: "RECURRING",
      lateGraceDays: 5,
      lateAmount: 100,
      lateIntervalCount: 1,
      lateIntervalUnit: "MONTH",
    });

    expect(balance.late).toBe(300);
  });

  it("maps legacy daily rules to recurring every 1 day on invoice stamps", () => {
    expect(invoiceLateStamp({ lateKind: "DAILY", lateAmount: 25 })).toMatchObject({
      lateKind: "DAILY",
      lateIntervalCount: 1,
      lateIntervalUnit: "DAY",
      lateFeePerDay: 25,
    });
    expect(latePolicyLabel({ lateKind: "RECURRING", lateAmount: 100, lateIntervalCount: 15, lateIntervalUnit: "DAY" })).toBe(
      "₹100 every 15 days from the day after due"
    );
  });
});
