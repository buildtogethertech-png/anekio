import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR } from "../../lib/calendar";
import { classifyFromIn, liveMarkFromIn, summarizePayroll, type PayrollRules } from "../../lib/payroll";

const RULES: PayrollRules = {
  presentCredit: 1,
  absentCredit: 0,
  paidLeaveCredit: 1,
  unpaidLeaveCredit: 0,
  halfDayCredit: 0.5,
  lateCredit: 1,
  startTime: "08:00",
  endTime: "14:00",
  graceMinutes: 10,
  freeLateCount: 0,
  lateDeductionMode: "NONE",
  lateDeductionAmount: 0,
  lateDayFraction: 0.25,
  latesPerLeaveDay: 0,
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

  it("treats 08:15 as 15 minutes late and LATE when grace ends at 08:10", () => {
    const hit = classifyFromIn("08:15", "08:00", 10);
    expect(hit?.minutesLate).toBe(15);
    expect(hit?.status).toBe("LATE");
    expect(hit?.startTimeUsed).toBe("08:00");
    expect(classifyFromIn("08:10", "08:00", 10)?.status).toBe("PRESENT");
    expect(classifyFromIn("08:15", "9:00", 0)?.status).toBe("PRESENT");
  });

  it("reclassifies a stored Present In time when grace rules change", () => {
    expect(liveMarkFromIn("PRESENT", "08:15", "08:00", 10)).toBe("LATE");
    expect(liveMarkFromIn("PRESENT", "08:05", "08:00", 10)).toBe("PRESENT");
    expect(liveMarkFromIn("LEAVE", "08:15", "08:00", 10)).toBe("LEAVE");
    expect(liveMarkFromIn("ABSENT", "08:15", "08:00", 10)).toBe("LATE");
  });

  it("keeps lateCredit as a payable day and cuts extra rupees only after free lates", () => {
    const dates = datesOf(22);
    const marks = new Map(dates.map((date, i) => [date, i < 3 ? "LATE" : "PRESENT"] as const));
    const summary = summarizePayroll({
      dates,
      today: "2026-09-22",
      calendar,
      marks,
      paidLeave: new Map(),
      rules: { ...RULES, freeLateCount: 1, lateDeductionMode: "FIXED_PER_LATE", lateDeductionAmount: 50 },
      salary: 22000,
    });
    expect(summary.present).toBe(22);
    expect(summary.late).toBe(3);
    expect(summary.deductibleLates).toBe(2);
    expect(summary.payableDays).toBe(22);
    expect(summary.extraLateCut).toBe(100);
    expect(summary.finalAmount).toBe(21900);
    expect(summary.attendanceAdj).toBe(-100);
  });

  it("converts every 3 or 5 lates into one unpaid payable day", () => {
    const dates = datesOf(22);
    const threeLate = new Map(dates.map((date, i) => [date, i < 6 ? "LATE" : "PRESENT"] as const));
    const three = summarizePayroll({
      dates,
      today: "2026-09-22",
      calendar,
      marks: threeLate,
      paidLeave: new Map(),
      rules: { ...RULES, latesPerLeaveDay: 3 },
      salary: 22000,
    });
    expect(three.late).toBe(6);
    expect(three.lateLeaveDays).toBe(2);
    expect(three.payableDays).toBe(20);
    expect(three.finalAmount).toBe(20000);

    const fiveLate = new Map(dates.map((date, i) => [date, i < 5 ? "LATE" : "PRESENT"] as const));
    const five = summarizePayroll({
      dates,
      today: "2026-09-22",
      calendar,
      marks: fiveLate,
      paidLeave: new Map(),
      rules: { ...RULES, latesPerLeaveDay: 5 },
      salary: 22000,
    });
    expect(five.late).toBe(5);
    expect(five.lateLeaveDays).toBe(1);
    expect(five.payableDays).toBe(21);

    const leftover = summarizePayroll({
      dates,
      today: "2026-09-22",
      calendar,
      marks: fiveLate,
      paidLeave: new Map(),
      rules: { ...RULES, latesPerLeaveDay: 3 },
      salary: 22000,
    });
    expect(leftover.lateLeaveDays).toBe(1);
    expect(leftover.payableDays).toBe(21);
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
