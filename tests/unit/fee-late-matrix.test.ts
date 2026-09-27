import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoiceBalance } from "../../lib/fees";
import { reminderCopy } from "../../lib/fee-run";
import { daysLate } from "../../lib/utils";

const dueApr10 = () => new Date(2026, 3, 10, 0, 0, 0, 0);

describe("fee late matrix against implemented invoiceBalance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("charges no fine when lateKind is NONE even after many days", () => {
    vi.setSystemTime(new Date(2026, 3, 30, 10, 0, 0));
    const balance = invoiceBalance({
      amount: 1000,
      dueDate: dueApr10(),
      lateKind: "NONE",
      lateAmount: 50,
    });
    expect(balance.late).toBe(0);
    expect(balance.dueNow).toBe(1000);
  });

  it("keeps STATIC fine at zero on the due date and a flat amount after", () => {
    const invoice = {
      amount: 1000,
      dueDate: dueApr10(),
      lateKind: "STATIC" as const,
      lateGraceDays: 0,
      lateAmount: 50,
    };
    vi.setSystemTime(new Date(2026, 3, 10, 23, 59, 0));
    expect(invoiceBalance(invoice).late).toBe(0);

    vi.setSystemTime(new Date(2026, 3, 11, 0, 0, 0));
    expect(invoiceBalance(invoice).late).toBe(50);

    vi.setSystemTime(new Date(2026, 3, 20, 12, 0, 0));
    expect(invoiceBalance(invoice).late).toBe(50);
  });

  it("charges DAILY ₹10 from the day after due", () => {
    const invoice = {
      amount: 1000,
      dueDate: dueApr10(),
      lateKind: "DAILY" as const,
      lateGraceDays: 0,
      lateAmount: 10,
    };
    vi.setSystemTime(new Date(2026, 3, 10, 18, 0, 0));
    expect(invoiceBalance(invoice).late).toBe(0);

    vi.setSystemTime(new Date(2026, 3, 11, 10, 0, 0));
    expect(invoiceBalance(invoice).late).toBe(10);

    vi.setSystemTime(new Date(2026, 3, 12, 10, 0, 0));
    expect(invoiceBalance(invoice).late).toBe(20);

    vi.setSystemTime(new Date(2026, 3, 20, 10, 0, 0));
    expect(invoiceBalance(invoice).late).toBe(100);
  });

  it("charges RECURRING ₹50 every 15 days from the day after grace", () => {
    const invoice = {
      amount: 1000,
      dueDate: dueApr10(),
      lateKind: "RECURRING" as const,
      lateGraceDays: 0,
      lateAmount: 50,
      lateIntervalCount: 15,
      lateIntervalUnit: "DAY",
    };
    vi.setSystemTime(new Date(2026, 3, 11, 10, 0, 0));
    expect(invoiceBalance(invoice).late).toBe(50);

    vi.setSystemTime(new Date(2026, 3, 25, 10, 0, 0));
    expect(invoiceBalance(invoice).late).toBe(50);

    vi.setSystemTime(new Date(2026, 3, 26, 10, 0, 0));
    expect(invoiceBalance(invoice).late).toBe(100);
  });

  it("uses local calendar days so late starts at local midnight after due", () => {
    const due = new Date(2026, 3, 10);
    vi.setSystemTime(new Date(2026, 3, 10, 23, 59, 0));
    expect(daysLate(due)).toBe(0);

    vi.setSystemTime(new Date(2026, 3, 11, 0, 0, 0));
    expect(daysLate(due)).toBe(1);
  });

  it("grace 5: still zero on day 15 and STATIC from day 16", () => {
    const invoice = {
      amount: 8800,
      dueDate: dueApr10(),
      lateKind: "STATIC" as const,
      lateGraceDays: 5,
      lateAmount: 100,
    };
    vi.setSystemTime(new Date(2026, 3, 15, 18, 0, 0));
    expect(invoiceBalance(invoice).late).toBe(0);
    expect(invoiceBalance(invoice).dueNow).toBe(8800);

    vi.setSystemTime(new Date(2026, 3, 16, 0, 5, 0));
    expect(invoiceBalance(invoice).late).toBe(100);
    expect(invoiceBalance(invoice).dueNow).toBe(8900);
  });

  it("does not keep charging late against principal that is already paid", () => {
    vi.setSystemTime(new Date(2026, 3, 20, 10, 0, 0));
    const unpaid = invoiceBalance({
      amount: 3000,
      dueDate: dueApr10(),
      lateKind: "STATIC",
      lateGraceDays: 0,
      lateAmount: 50,
    });
    expect(unpaid.remaining).toBe(3000);
    expect(unpaid.late).toBe(50);
    expect(unpaid.dueNow).toBe(3050);

    const partial = invoiceBalance({
      amount: 3000,
      paid: 2000,
      dueDate: dueApr10(),
      lateKind: "STATIC",
      lateGraceDays: 0,
      lateAmount: 50,
    });
    expect(partial.remaining).toBe(1000);
    expect(partial.late).toBe(50);
    expect(partial.dueNow).toBe(1050);

    const settled = invoiceBalance({
      amount: 3000,
      paid: 3050,
      dueDate: dueApr10(),
      lateKind: "STATIC",
      lateGraceDays: 0,
      lateAmount: 50,
    });
    expect(settled.remaining).toBe(0);
    expect(settled.late).toBe(0);
    expect(settled.dueNow).toBe(0);
    expect(settled.display).toBe("PAID");
  });
});

describe("fee reminder copy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("includes late information for overdue invoices and a simple due amount otherwise", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 20, 10, 0, 0));
    const overdue = reminderCopy({
      title: "April 2026 · Monthly fee",
      student: { name: "Aanya" },
      amount: 8800,
      dueDate: dueApr10(),
      lateKind: "STATIC",
      lateGraceDays: 0,
      lateAmount: 100,
      payments: [],
    });
    expect(overdue.dueNow).toBe(8900);
    expect(overdue.message).toMatch(/Aanya/);
    expect(overdue.message).toMatch(/Late/i);

    const noneOverdue = reminderCopy({
      title: "April 2026 · Monthly fee",
      student: { name: "Aanya" },
      amount: 8800,
      dueDate: dueApr10(),
      lateKind: "NONE",
      payments: [],
    });
    expect(noneOverdue.message).toMatch(/Late by 10 days/);
    expect(noneOverdue.message).toMatch(/₹0/);

    const notYetDue = reminderCopy({
      title: "April 2026 · Monthly fee",
      student: { name: "Aanya" },
      amount: 8800,
      dueDate: new Date(2026, 3, 25),
      lateKind: "NONE",
      payments: [],
    });
    expect(notYetDue.message).toContain("₹8800");
    expect(notYetDue.message).not.toMatch(/Late by/);
  });
});
