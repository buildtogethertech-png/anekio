import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR } from "../../lib/calendar";
import { summarizePayroll, type PayrollRules } from "../../lib/payroll";

const RULES: PayrollRules = {
  presentCredit: 1,
  absentCredit: 0,
  paidLeaveCredit: 1,
  unpaidLeaveCredit: 0,
  halfDayCredit: 0.5,
  lateCredit: 1,
};

const calendar = {
  ...DEFAULT_CALENDAR,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  holidays: [],
};

function datesOf(n: number) {
  return Array.from({ length: n }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
}

describe("summarizePayroll", () => {
  it("deducts absent days from monthly salary using payable days", () => {
    const dates = datesOf(22);
    const marks = new Map(dates.map((date, i) => [date, i === 2 ? "ABSENT" : "PRESENT"] as const));
    const summary = summarizePayroll({
      dates,
      today: "2026-09-22",
      calendar,
      marks,
      paidLeave: new Map(),
      rules: RULES,
      salary: 30000,
    });
    expect(summary.working).toBe(22);
    expect(summary.present).toBe(21);
    expect(summary.absent).toBe(1);
    expect(summary.payableDays).toBe(21);
    expect(summary.dailySalary).toBe(1363.64);
    expect(summary.finalAmount).toBe(28636.44);
    expect(summary.attendanceAdj).toBe(-1363.56);
  });

  it("keeps the full monthly salary when every working day is payable", () => {
    const dates = datesOf(26);
    const marks = new Map(dates.map((date) => [date, "PRESENT"] as const));
    const summary = summarizePayroll({
      dates,
      today: "2026-09-26",
      calendar,
      marks,
      paidLeave: new Map(),
      rules: RULES,
      salary: 30000,
    });
    expect(summary.dailySalary).toBe(1153.85);
    expect(summary.payableDays).toBe(26);
    expect(summary.finalAmount).toBe(30000);
    expect(summary.attendanceAdj).toBe(0);
  });

  it("does not reduce pay for paid leave", () => {
    const dates = datesOf(26);
    const marks = new Map(dates.map((date, i) => [date, i >= 24 ? "LEAVE" : "PRESENT"] as const));
    const paidLeave = new Map(dates.map((date, i) => [date, i >= 24]));
    const summary = summarizePayroll({
      dates,
      today: "2026-09-26",
      calendar,
      marks,
      paidLeave,
      rules: RULES,
      salary: 30000,
    });
    expect(summary.present).toBe(24);
    expect(summary.leave).toBe(2);
    expect(summary.payableDays).toBe(26);
    expect(summary.finalAmount).toBe(30000);
  });

  it("reduces pay for unpaid leave using daily salary times payable days", () => {
    const dates = datesOf(26);
    const marks = new Map(dates.map((date, i) => [date, i >= 24 ? "LEAVE" : "PRESENT"] as const));
    const paidLeave = new Map(dates.map((date) => [date, false]));
    const summary = summarizePayroll({
      dates,
      today: "2026-09-26",
      calendar,
      marks,
      paidLeave,
      rules: RULES,
      salary: 30000,
    });
    expect(summary.present).toBe(24);
    expect(summary.leave).toBe(2);
    expect(summary.payableDays).toBe(24);
    expect(summary.dailySalary).toBe(1153.85);
    expect(summary.finalAmount).toBe(27692.4);
    expect(summary.attendanceAdj).toBe(-2307.6);
  });

  it("credits half days at half a payable day", () => {
    const dates = datesOf(26);
    const marks = new Map(
      dates.map((date, i) => {
        if (i === 24) return [date, "HALF_DAY"] as const;
        if (i === 25) return [date, "ABSENT"] as const;
        return [date, "PRESENT"] as const;
      })
    );
    const summary = summarizePayroll({
      dates,
      today: "2026-09-26",
      calendar,
      marks,
      paidLeave: new Map(),
      rules: RULES,
      salary: 30000,
    });
    expect(summary.present).toBe(24);
    expect(summary.halfDay).toBe(1);
    expect(summary.payableDays).toBe(24.5);
    expect(summary.finalAmount).toBe(28269.32);
  });
});
