import { closedReason, holidayOn, type SchoolCalendar } from "./calendar";

export type LateDeductionMode = "NONE" | "FIXED_PER_LATE" | "DAY_FRACTION";

/**
 * What one day's pay is based on.
 * - CALENDAR: salary ÷ days in the month (28–31). Weekly offs and holidays are paid days. Most common in India.
 * - FIXED: salary ÷ a fixed number (30, or 26 for 6-day weeks), same every month.
 * - WORKING: salary ÷ that month's working days only (weekly offs and holidays left out).
 */
export type SalaryBasis = "CALENDAR" | "FIXED" | "WORKING";
export type UnmarkedAs = "PRESENT" | "ABSENT";

export type PayrollRules = {
  presentCredit: number;
  absentCredit: number;
  paidLeaveCredit: number;
  unpaidLeaveCredit: number;
  halfDayCredit: number;
  lateCredit: number;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  freeLateCount: number;
  lateDeductionMode: LateDeductionMode;
  lateDeductionAmount: number;
  lateDayFraction: number;
  /** 3 means 3 lates = 1 unpaid day. 0 turns the rule off. */
  latesPerLeaveDay: number;
  /** How much each batch of lates cuts: 1 = full day, 0.5 = half day. */
  latePenaltyDays: number;
  salaryBasis: SalaryBasis;
  /** Divisor for FIXED basis, usually 30 or 26. */
  fixedMonthDays: number;
  /** Weekly offs count as paid days (CALENDAR / FIXED). */
  paidWeeklyOffs: boolean;
  /** School holidays count as paid days (CALENDAR / FIXED). */
  paidHolidays: boolean;
  /** An off day squeezed between two unpaid days is also unpaid. */
  sandwichRule: boolean;
  /** Past working days nobody marked: count as Present (no cut) or Absent. */
  unmarkedAs: UnmarkedAs;
};

export const DEFAULT_PAYROLL_RULES: PayrollRules = {
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
  latesPerLeaveDay: 3,
  latePenaltyDays: 1,
  salaryBasis: "CALENDAR",
  fixedMonthDays: 30,
  paidWeeklyOffs: true,
  paidHolidays: true,
  sandwichRule: false,
  unmarkedAs: "PRESENT",
};

const SALARY_BASES = new Set<SalaryBasis>(["CALENDAR", "FIXED", "WORKING"]);

const LATE_MODES = new Set<LateDeductionMode>(["NONE", "FIXED_PER_LATE", "DAY_FRACTION"]);

export type PayrollMark = "PRESENT" | "ABSENT" | "LATE" | "LEAVE" | "HALF_DAY" | "";

export function parsePayrollRules(raw?: string | null): PayrollRules {
  if (!raw) return { ...DEFAULT_PAYROLL_RULES };
  try {
    const parsed = JSON.parse(raw) as Partial<PayrollRules>;
    return {
      presentCredit: num(parsed.presentCredit, DEFAULT_PAYROLL_RULES.presentCredit),
      absentCredit: num(parsed.absentCredit, DEFAULT_PAYROLL_RULES.absentCredit),
      paidLeaveCredit: num(parsed.paidLeaveCredit, DEFAULT_PAYROLL_RULES.paidLeaveCredit),
      unpaidLeaveCredit: num(parsed.unpaidLeaveCredit, DEFAULT_PAYROLL_RULES.unpaidLeaveCredit),
      halfDayCredit: num(parsed.halfDayCredit, DEFAULT_PAYROLL_RULES.halfDayCredit),
      lateCredit: num(parsed.lateCredit, DEFAULT_PAYROLL_RULES.lateCredit),
      startTime: hhmm(parsed.startTime, DEFAULT_PAYROLL_RULES.startTime),
      endTime: hhmm(parsed.endTime, DEFAULT_PAYROLL_RULES.endTime),
      graceMinutes: num(parsed.graceMinutes, DEFAULT_PAYROLL_RULES.graceMinutes),
      freeLateCount: Math.max(0, Math.floor(num(parsed.freeLateCount, DEFAULT_PAYROLL_RULES.freeLateCount))),
      lateDeductionMode: LATE_MODES.has(parsed.lateDeductionMode as LateDeductionMode)
        ? (parsed.lateDeductionMode as LateDeductionMode)
        : DEFAULT_PAYROLL_RULES.lateDeductionMode,
      lateDeductionAmount: Math.max(0, num(parsed.lateDeductionAmount, DEFAULT_PAYROLL_RULES.lateDeductionAmount)),
      lateDayFraction: Math.min(1, Math.max(0, num(parsed.lateDayFraction, DEFAULT_PAYROLL_RULES.lateDayFraction))),
      latesPerLeaveDay: Math.max(0, Math.floor(num(parsed.latesPerLeaveDay, DEFAULT_PAYROLL_RULES.latesPerLeaveDay))),
      latePenaltyDays: num(parsed.latePenaltyDays, DEFAULT_PAYROLL_RULES.latePenaltyDays) === 0.5 ? 0.5 : 1,
      salaryBasis: SALARY_BASES.has(parsed.salaryBasis as SalaryBasis) ? (parsed.salaryBasis as SalaryBasis) : DEFAULT_PAYROLL_RULES.salaryBasis,
      fixedMonthDays: Math.min(31, Math.max(20, Math.floor(num(parsed.fixedMonthDays, DEFAULT_PAYROLL_RULES.fixedMonthDays)))),
      paidWeeklyOffs: bool(parsed.paidWeeklyOffs, DEFAULT_PAYROLL_RULES.paidWeeklyOffs),
      paidHolidays: bool(parsed.paidHolidays, DEFAULT_PAYROLL_RULES.paidHolidays),
      sandwichRule: bool(parsed.sandwichRule, DEFAULT_PAYROLL_RULES.sandwichRule),
      unmarkedAs: parsed.unmarkedAs === "ABSENT" ? "ABSENT" : "PRESENT",
    };
  } catch {
    return { ...DEFAULT_PAYROLL_RULES };
  }
}

export function personKey(kind: "teacher" | "staff", id: string) {
  return `${kind}:${id}`;
}

export function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => {
    const day = i + 1;
    return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  });
}

export function monthTitle(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const next = new Date(y, m - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

export function roundMoney(amount: number) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function inr(amount: number, fractionDigits?: number) {
  const rounded = roundMoney(amount);
  const digits = fractionDigits ?? (Number.isInteger(rounded) ? 0 : 2);
  return `₹${rounded.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function creditForMark(mark: PayrollMark, paidLeave: boolean, rules: PayrollRules) {
  if (mark === "PRESENT") return rules.presentCredit;
  if (mark === "LATE") return rules.lateCredit;
  if (mark === "HALF_DAY") return rules.halfDayCredit;
  if (mark === "LEAVE") return paidLeave ? rules.paidLeaveCredit : rules.unpaidLeaveCredit;
  if (mark === "ABSENT") return rules.absentCredit;
  return rules.absentCredit;
}

export function dayKind(date: string, calendar: SchoolCalendar): "working" | "weekend" | "holiday" {
  if (holidayOn(date, calendar.holidays)) return "holiday";
  const closed = closedReason(date, calendar);
  if (closed) return "weekend";
  return "working";
}

export function lateLeaveBatch(lateCount: number, rules: PayrollRules) {
  const deductibleLates = Math.max(0, lateCount - Math.max(0, Math.floor(rules.freeLateCount || 0)));
  const per = Math.max(0, Math.floor(rules.latesPerLeaveDay || 0));
  if (per < 1) return { deductibleLates, lateLeaveDays: 0, leftoverLates: deductibleLates };
  return {
    deductibleLates,
    lateLeaveDays: Math.floor(deductibleLates / per),
    leftoverLates: deductibleLates % per,
  };
}

export function summarizePayroll(input: {
  dates: string[];
  today: string;
  calendar: SchoolCalendar;
  marks: Map<string, PayrollMark>;
  paidLeave: Map<string, boolean>;
  rules: PayrollRules;
  salary: number;
  otherAdj?: number;
}) {
  const rules = input.rules;
  const basis: SalaryBasis = rules.salaryBasis || "CALENDAR";
  const kinds = new Map(input.dates.map((date) => [date, dayKind(date, input.calendar)] as const));
  const workingDates = input.dates.filter((date) => kinds.get(date) === "working");
  const markOf = (date: string): PayrollMark =>
    input.marks.get(date) || (date > input.today ? "PRESENT" : rules.unmarkedAs === "ABSENT" ? "ABSENT" : "PRESENT");
  const creditOf = (date: string) => Math.min(1, Math.max(0, creditForMark(markOf(date), input.paidLeave.get(date) !== false, rules)));

  let present = 0;
  let absent = 0;
  let leave = 0;
  let halfDay = 0;
  let payable = 0;
  for (const date of workingDates) {
    const mark = markOf(date);
    if (mark === "PRESENT" || mark === "LATE") present += 1;
    else if (mark === "ABSENT") absent += 1;
    else if (mark === "LEAVE") leave += 1;
    else if (mark === "HALF_DAY") halfDay += 1;
    payable += creditOf(date);
  }
  const working = workingDates.length;

  // Off days only matter when they're part of the divisor (CALENDAR / FIXED).
  let unpaidOffDays = 0;
  let sandwichDays = 0;
  if (basis !== "WORKING") {
    input.dates.forEach((date, i) => {
      const kind = kinds.get(date);
      if (kind === "working") return;
      const paid = kind === "holiday" ? rules.paidHolidays : rules.paidWeeklyOffs;
      if (!paid) {
        unpaidOffDays += 1;
        return;
      }
      if (!rules.sandwichRule) return;
      let prev = "";
      for (let j = i - 1; j >= 0; j--) if (kinds.get(input.dates[j]) === "working") { prev = input.dates[j]; break; }
      let next = "";
      for (let j = i + 1; j < input.dates.length; j++) if (kinds.get(input.dates[j]) === "working") { next = input.dates[j]; break; }
      if (prev && next && next <= input.today && creditOf(prev) === 0 && creditOf(next) === 0) sandwichDays += 1;
    });
  }

  const attendancePct = working ? ((present + leave + halfDay * rules.halfDayCredit) / working) * 100 : 0;
  const otherAdj = input.otherAdj || 0;
  const lateDates = workingDates.filter((date) => markOf(date) === "LATE");
  const batch = lateLeaveBatch(lateDates.length, rules);
  const lateCutDays = batch.lateLeaveDays * (rules.latePenaltyDays || 1);
  const lopDays = Math.max(0, working - payable) + unpaidOffDays + sandwichDays + lateCutDays;
  const divisor = basis === "CALENDAR" ? input.dates.length : basis === "FIXED" ? rules.fixedMonthDays : working;
  const payableDays = roundHalf(Math.max(0, divisor - lopDays));
  const dailySalary = divisor ? roundMoney(input.salary / divisor) : 0;
  const earned = !working || !divisor ? 0 : payableDays === divisor ? input.salary : roundMoney(dailySalary * payableDays);
  const extraLateCut = 0;
  const finalAmount = roundMoney(earned + otherAdj - extraLateCut);
  const attendanceAdj = roundMoney(finalAmount - input.salary - otherAdj);
  return {
    basis,
    divisor,
    working,
    present,
    absent,
    leave,
    halfDay,
    late: lateDates.length,
    deductibleLates: batch.deductibleLates,
    lateLeaveDays: batch.lateLeaveDays,
    lateCutDays,
    unpaidOffDays,
    sandwichDays,
    lopDays,
    extraLateCut,
    payableDays,
    attendancePct,
    salary: input.salary,
    dailySalary,
    otherAdj,
    attendanceAdj,
    finalAmount,
  };
}

function bool(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/** Plain-language name of the salary basis, e.g. "Calendar days (31)". */
export function salaryBasisLabel(rules: PayrollRules, divisor?: number) {
  const n = divisor != null ? ` (${divisor})` : "";
  if (rules.salaryBasis === "FIXED") return `Fixed ${rules.fixedMonthDays} days`;
  if (rules.salaryBasis === "WORKING") return `Working days${n}`;
  return `Calendar days${n}`;
}

function num(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function hhmm(value: unknown, fallback: string) {
  return typeof value === "string" && parseMinutes(value) != null ? normalizeHHmm(value) : fallback;
}

function roundHalf(value: number) {
  return Math.round(value * 2) / 2;
}

export function parseMinutes(value: string) {
  let s = String(value || "").trim().toUpperCase().replace(".", ":");
  const am = /\s*AM$/.test(s);
  const pm = /\s*PM$/.test(s);
  s = s.replace(/\s*(AM|PM)$/, "").trim();
  let hour = 0;
  let minute = 0;
  const hm = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  const hOnly = /^(\d{1,2})$/.exec(s);
  if (hm) {
    hour = Number(hm[1]);
    minute = Number(hm[2]);
  } else if (hOnly) {
    hour = Number(hOnly[1]);
    minute = 0;
  } else {
    return null;
  }
  if (pm && hour > 0 && hour < 12) hour += 12;
  if (am && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function normalizeHHmm(value: string) {
  const minutes = parseMinutes(value);
  if (minutes == null) return "";
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function minutesLate(inAt: string, startTimeUsed: string) {
  const arrived = parseMinutes(inAt);
  const start = parseMinutes(startTimeUsed);
  if (arrived == null || start == null) return 0;
  return Math.max(0, arrived - start);
}

export function classifyFromIn(
  inAt: string,
  startTime: string,
  graceMinutes: number
): { status: "PRESENT" | "LATE"; minutesLate: number; startTimeUsed: string } | null {
  const arrived = parseMinutes(inAt);
  if (arrived == null) return null;
  const startTimeUsed = hhmm(startTime, DEFAULT_PAYROLL_RULES.startTime);
  const start = parseMinutes(startTimeUsed) ?? 0;
  const graceEnd = start + Math.max(0, graceMinutes);
  return {
    status: arrived > graceEnd ? "LATE" : "PRESENT",
    minutesLate: Math.max(0, arrived - start),
    startTimeUsed,
  };
}

export function liveMarkFromIn(
  status: string,
  inAt: string,
  startTime: string,
  graceMinutes: number
) {
  const st = (status || "").toUpperCase();
  if (st === "LEAVE") return st;
  if (inAt) return classifyFromIn(inAt, startTime, graceMinutes)?.status || st;
  return st;
}

export type SalaryPayState = "NOT_APPROVED" | "UNPAID" | "PART_PAID" | "PAID";

/**
 * Paid / still-owed for one person-month. Voided payments don't count.
 * A month marked PAID before payments were recorded counts as fully paid.
 */
export function salaryPayState(
  run: { status: string; finalAmount: number } | null | undefined,
  payments: { amount: number; voided?: boolean }[]
) {
  const due = Math.max(0, Math.round(run?.finalAmount || 0));
  const live = payments.filter((p) => !p.voided);
  const recorded = live.reduce((sum, p) => sum + Math.round(p.amount || 0), 0);
  const paid = run?.status === "PAID" && !live.length ? due : recorded;
  const balance = Math.max(0, due - paid);
  const state: SalaryPayState =
    !run || run.status === "PENDING" ? "NOT_APPROVED" : paid <= 0 ? "UNPAID" : balance > 0 ? "PART_PAID" : "PAID";
  return { due, paid, balance, state };
}

export const SALARY_PAY_MODES = ["CASH", "UPI", "BANK", "CHEQUE"] as const;
export type SalaryPayMode = (typeof SALARY_PAY_MODES)[number];
