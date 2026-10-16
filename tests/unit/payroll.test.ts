import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR } from "../../lib/calendar";
import { classifyFromIn, liveMarkFromIn, salaryPayState, summarizePayroll, type PayrollRules } from "../../lib/payroll";

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
  latePenaltyDays: 1,
  // These older cases pin the working-days basis; the new defaults are covered below.
  salaryBasis: "WORKING",
  fixedMonthDays: 30,
  paidWeeklyOffs: true,
  paidHolidays: true,
  sandwichRule: false,
  unmarkedAs: "ABSENT",
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

  it("does not apply a separate rupee late cut", () => {
    const dates = datesOf(22);
    const marks = new Map(dates.map((date, i) => [date, i < 3 ? "LATE" : "PRESENT"] as const));
    const summary = summarizePayroll({
      dates,
      today: "2026-09-22",
      calendar,
      marks,
      paidLeave: new Map(),
      rules: { ...RULES, latesPerLeaveDay: 0, lateDeductionMode: "FIXED_PER_LATE", lateDeductionAmount: 50 },
      salary: 22000,
    });
    expect(summary.late).toBe(3);
    expect(summary.payableDays).toBe(22);
    expect(summary.extraLateCut).toBe(0);
    expect(summary.finalAmount).toBe(22000);
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
    expect(three.attendanceAdj).toBe(-2000);

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

  it("cuts one unpaid day of salary when there are exactly 3 lates", () => {
    const dates = datesOf(22);
    const marks = new Map(dates.map((date, i) => [date, i < 3 ? "LATE" : "PRESENT"] as const));
    const summary = summarizePayroll({
      dates,
      today: "2026-09-22",
      calendar,
      marks,
      paidLeave: new Map(),
      rules: { ...RULES, latesPerLeaveDay: 3 },
      salary: 22000,
    });
    expect(summary.late).toBe(3);
    expect(summary.lateLeaveDays).toBe(1);
    expect(summary.payableDays).toBe(21);
    expect(summary.dailySalary).toBe(1000);
    expect(summary.finalAmount).toBe(21000);
    expect(summary.attendanceAdj).toBe(-1000);
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

describe("summarizePayroll salary basis", () => {
  // March 2026: 31 days, Sundays off (1, 8, 15, 22, 29) → 26 working days.
  const march = Array.from({ length: 31 }, (_, i) => `2026-03-${String(i + 1).padStart(2, "0")}`);
  const sundaysOff = { ...DEFAULT_CALENDAR, weekdays: [1, 2, 3, 4, 5, 6], holidays: [] };
  const twoAbsent = new Map(
    march.map((date) => [date, date === "2026-03-10" || date === "2026-03-11" ? "ABSENT" : "PRESENT"] as const)
  );
  const run = (rules: Partial<PayrollRules>, marks: Parameters<typeof summarizePayroll>[0]["marks"] = twoAbsent) =>
    summarizePayroll({
      dates: march,
      today: "2026-03-31",
      calendar: sundaysOff,
      marks,
      paidLeave: new Map(),
      rules: { ...RULES, ...rules },
      salary: 31000,
    });

  it("divides by days in the month on calendar basis", () => {
    const s = run({ salaryBasis: "CALENDAR" });
    expect(s.divisor).toBe(31);
    expect(s.dailySalary).toBe(1000);
    expect(s.payableDays).toBe(29);
    expect(s.finalAmount).toBe(29000);
  });

  it("divides by a fixed number on fixed basis", () => {
    const s = run({ salaryBasis: "FIXED", fixedMonthDays: 30 });
    expect(s.divisor).toBe(30);
    expect(s.payableDays).toBe(28);
    expect(s.finalAmount).toBeCloseTo((31000 / 30) * 28, 0);
  });

  it("divides by working days on working basis", () => {
    const s = run({ salaryBasis: "WORKING" });
    expect(s.divisor).toBe(26);
    expect(s.payableDays).toBe(24);
  });

  it("cuts the Sunday between two absences with the sandwich rule", () => {
    const marks = new Map(
      march.map((date) => [date, date === "2026-03-07" || date === "2026-03-09" ? "ABSENT" : "PRESENT"] as const)
    );
    expect(run({ salaryBasis: "CALENDAR" }, marks).payableDays).toBe(29);
    const s = run({ salaryBasis: "CALENDAR", sandwichRule: true }, marks);
    expect(s.sandwichDays).toBe(1);
    expect(s.payableDays).toBe(28);
  });

  it("treats unmarked past days as present by default", () => {
    const s = run({ salaryBasis: "CALENDAR", unmarkedAs: "PRESENT" }, new Map());
    expect(s.payableDays).toBe(31);
    expect(s.finalAmount).toBe(31000);
  });

  it("can cut half a day per batch of lates", () => {
    const marks = new Map(
      march.map((date) => [date, ["2026-03-02", "2026-03-03", "2026-03-04"].includes(date) ? "LATE" : "PRESENT"] as const)
    );
    const s = run({ salaryBasis: "CALENDAR", latesPerLeaveDay: 3, latePenaltyDays: 0.5 }, marks);
    expect(s.lateCutDays).toBe(0.5);
    expect(s.payableDays).toBe(30.5);
  });
});

describe("salaryPayState", () => {
  const approved = { status: "APPROVED", finalAmount: 28000 };

  it("is not approved while the month is pending", () => {
    expect(salaryPayState({ status: "PENDING", finalAmount: 28000 }, []).state).toBe("NOT_APPROVED");
    expect(salaryPayState(null, []).state).toBe("NOT_APPROVED");
  });

  it("shows the full amount owed before any payment", () => {
    expect(salaryPayState(approved, [])).toEqual({ due: 28000, paid: 0, balance: 28000, state: "UNPAID" });
  });

  it("adds up part payments and keeps the rest owed", () => {
    const s = salaryPayState(approved, [{ amount: 20000 }, { amount: 3000 }]);
    expect(s).toEqual({ due: 28000, paid: 23000, balance: 5000, state: "PART_PAID" });
  });

  it("ignores cancelled payments", () => {
    const s = salaryPayState(approved, [{ amount: 20000 }, { amount: 8000, voided: true }]);
    expect(s.paid).toBe(20000);
    expect(s.balance).toBe(8000);
    expect(s.state).toBe("PART_PAID");
  });

  it("is paid when payments cover the amount", () => {
    expect(salaryPayState(approved, [{ amount: 28000 }]).state).toBe("PAID");
  });

  it("treats an older month marked paid without payments as fully paid", () => {
    expect(salaryPayState({ status: "PAID", finalAmount: 28000 }, [])).toEqual({ due: 28000, paid: 28000, balance: 0, state: "PAID" });
  });
});
