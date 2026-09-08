import { closedReason, holidayOn, type SchoolCalendar } from "./calendar";

export type PayrollRules = {
  presentCredit: number;
  absentCredit: number;
  paidLeaveCredit: number;
  unpaidLeaveCredit: number;
  halfDayCredit: number;
  lateCredit: number;
};

export const DEFAULT_PAYROLL_RULES: PayrollRules = {
  presentCredit: 1,
  absentCredit: 0,
  paidLeaveCredit: 1,
  unpaidLeaveCredit: 0,
  halfDayCredit: 0.5,
  lateCredit: 1,
};

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
  const payableDays = roundHalf(payable);
  const dailySalary = working ? roundMoney(input.salary / working) : 0;
  const earned = !working ? 0 : payableDays === working ? input.salary : roundMoney(dailySalary * payableDays);
  const finalAmount = roundMoney(earned + otherAdj);
  const attendanceAdj = roundMoney(finalAmount - input.salary - otherAdj);
  return {
    working,
    present,
    absent,
    leave,
    halfDay,
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
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function roundHalf(value: number) {
  return Math.round(value * 2) / 2;
}
