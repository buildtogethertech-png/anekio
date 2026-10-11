import { afterEach, describe, expect, it, vi } from "vitest";
import { invoiceBalance, invoiceLatePolicy, invoiceLateStamp, latePolicyLabel, lateStampFromSetup, dueDateForMonth, replaceInvoiceLateMetadata } from "../../lib/fees";

describe("fee late rules", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the current late rule in metadata without invoice late-fee columns", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T08:00:00Z"));
    const invoice = { amount: 1000, dueDate: new Date("2026-09-10T00:00:00Z"), metadataJson: "{}" };
    expect(invoiceBalance(invoice).late).toBe(0);
    invoice.metadataJson = replaceInvoiceLateMetadata(invoice.metadataJson, { lateKind: "STATIC", lateGraceDays: 5, lateAmount: 100 });
    expect(invoiceLatePolicy(invoice).lateKind).toBe("STATIC");
    expect(invoiceBalance(invoice).late).toBe(100);
    invoice.metadataJson = replaceInvoiceLateMetadata(invoice.metadataJson, { lateKind: "NONE" });
    expect(invoiceBalance(invoice).late).toBe(0);
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

  it("builds the monthly due date from period plus due day", () => {
    const due = dueDateForMonth(2026, 3, 10);
    expect(due.getFullYear()).toBe(2026);
    expect(due.getMonth()).toBe(3);
    expect(due.getDate()).toBe(10);
  });

  it("clamps due day 30 to the last day of shorter months", () => {
    const february = dueDateForMonth(2026, 1, 30);
    expect(february.getFullYear()).toBe(2026);
    expect(february.getMonth()).toBe(1);
    expect(february.getDate()).toBe(28);
    expect(dueDateForMonth(2026, 3, 30).getDate()).toBe(30);
  });

  it("does not add a fine on the due date and adds it the next day", () => {
    vi.useFakeTimers();
    const due = new Date(2026, 3, 10);
    const invoice = {
      amount: 3000,
      dueDate: due,
      lateKind: "STATIC",
      lateGraceDays: 0,
      lateAmount: 50,
    };

    vi.setSystemTime(new Date(2026, 3, 10, 18, 0, 0));
    expect(invoiceBalance(invoice).late).toBe(0);

    vi.setSystemTime(new Date(2026, 3, 11, 10, 0, 0));
    const afterDue = invoiceBalance(invoice);
    expect(afterDue.late).toBe(50);
    expect(afterDue.dueNow).toBe(3050);
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

  it("charges a percent of unpaid remaining once after grace", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T08:00:00Z"));

    const unpaid = invoiceBalance({
      amount: 1000,
      dueDate: new Date("2026-09-10T00:00:00Z"),
      lateKind: "PERCENT",
      lateGraceDays: 5,
      lateAmount: 10,
      lateIntervalUnit: "DAY",
    });
    expect(unpaid.late).toBe(100);

    const partial = invoiceBalance({
      amount: 1000,
      paid: 400,
      dueDate: new Date("2026-09-10T00:00:00Z"),
      lateKind: "PERCENT",
      lateGraceDays: 5,
      lateAmount: 10,
      lateIntervalUnit: "DAY",
    });
    expect(partial.late).toBe(60);
  });

  it("charges percent of unpaid remaining for each overdue calendar month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T08:00:00Z"));

    const balance = invoiceBalance({
      amount: 1000,
      dueDate: new Date("2026-09-10T00:00:00Z"),
      lateKind: "PERCENT",
      lateGraceDays: 5,
      lateAmount: 10,
      lateIntervalCount: 1,
      lateIntervalUnit: "MONTH",
    });
    expect(balance.late).toBe(300);
  });

  it("maps setup rules onto invoice late stamps", () => {
    expect(lateStampFromSetup({ enabled: true, rule: "PERCENT", amount: 10, graceDays: 5 }).stamp).toMatchObject({
      lateKind: "PERCENT",
      lateAmount: 10,
      lateIntervalUnit: "DAY",
    });
    expect(lateStampFromSetup({ enabled: true, rule: "PERCENT_MONTH", amount: 5, graceDays: 3 }).stamp).toMatchObject({
      lateKind: "PERCENT",
      lateAmount: 5,
      lateIntervalUnit: "MONTH",
    });
    expect(lateStampFromSetup({ enabled: true, rule: "STATIC", amount: 50, graceDays: 7 }).stamp.lateKind).toBe("STATIC");
    expect(lateStampFromSetup({ enabled: true, rule: "DAILY", amount: 2, graceDays: 0 }).stamp.lateKind).toBe("DAILY");
    expect(lateStampFromSetup({ enabled: true, rule: "RECURRING_DAY", amount: 20, graceDays: 5, intervalCount: 15 }).stamp).toMatchObject({
      lateKind: "RECURRING",
      lateIntervalCount: 15,
      lateIntervalUnit: "DAY",
    });
    expect(lateStampFromSetup({ enabled: true, rule: "PERCENT_RECURRING_MONTH", amount: 5, graceDays: 3, intervalCount: 2 }).stamp).toMatchObject({
      lateKind: "PERCENT_RECURRING",
      lateAmount: 5,
      lateIntervalCount: 2,
      lateIntervalUnit: "MONTH",
    });
  });
});
