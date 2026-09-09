import { closedReason, holidayOn, type SchoolCalendar } from "./calendar";

export type LateDeductionMode = "NONE" | "FIXED_PER_LATE" | "DAY_FRACTION";

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
  latesPerLeaveDay: 0,
};

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
  const workingDates = input.dates.filter((date) => dayKind(date, input.calendar) === "working");
  let present = 0;
  let absent = 0;
  let leave = 0;
  let halfDay = 0;
  let payable = 0;
  for (const date of workingDates) {
    const future = date > input.today;
    const mark = input.marks.get(date) || (future ? "PRESENT" : "ABSENT");
    if (mark === "PRESENT" || mark === "LATE") present += 1;
    else if (mark === "ABSENT") absent += 1;
    else if (mark === "LEAVE") leave += 1;
    else if (mark === "HALF_DAY") halfDay += 1;
    payable += creditForMark(mark, input.paidLeave.get(date) !== false, input.rules);
  }
  const working = workingDates.length;
  const attendancePct = working ? ((present + leave + halfDay * input.rules.halfDayCredit) / working) * 100 : 0;
  const otherAdj = input.otherAdj || 0;
  const lateDates = workingDates.filter((date) => (input.marks.get(date) || (date > input.today ? "PRESENT" : "ABSENT")) === "LATE");
  const batch = lateLeaveBatch(lateDates.length, input.rules);
  const payableDays = roundHalf(Math.max(0, payable - batch.lateLeaveDays));
  const dailySalary = working ? roundMoney(input.salary / working) : 0;
  const earned = !working ? 0 : payableDays === working ? input.salary : roundMoney(dailySalary * payableDays);
  const deductibleLates = batch.deductibleLates;
  const mode = input.rules.lateDeductionMode || "NONE";
  const extraLateCut =
    mode === "FIXED_PER_LATE"
      ? roundMoney(batch.leftoverLates * Math.max(0, input.rules.lateDeductionAmount || 0))
      : mode === "DAY_FRACTION"
        ? roundMoney(batch.leftoverLates * dailySalary * Math.min(1, Math.max(0, input.rules.lateDayFraction || 0)))
        : 0;
  const finalAmount = roundMoney(earned + otherAdj - extraLateCut);
  const attendanceAdj = roundMoney(finalAmount - input.salary - otherAdj);
  return {
    working,
    present,
    absent,
    leave,
    halfDay,
    late: lateDates.length,
    deductibleLates,
    lateLeaveDays: batch.lateLeaveDays,
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
