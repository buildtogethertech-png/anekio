export type Holiday = { date: string; name: string };
export type SchoolCalendar = {
  weekdays: number[];
  holidays: Holiday[];
};
export type PaperCadence = "school" | "gap" | "week" | "same" | "custom";

const WEEKDAY_SHORT: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

export const DEFAULT_CALENDAR: SchoolCalendar = {
  weekdays: [1, 2, 3, 4, 5, 6],
  holidays: [],
};

export function ymd(d: Date | string) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(+dt)) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function addDays(value: string, days: number) {
  const [y, m, d] = value.split("-").map(Number);
  if (!y) return value;
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days);
  return ymd(dt);
}

export function parseYmd(value?: string | null) {
  const s = (value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00`);
}

export function weekdayOfYmd(value: string) {
  const dt = parseYmd(value);
  if (!dt) return 0;
  const js = dt.getDay();
  return js === 0 ? 7 : js;
}

export function holidayOn(value: string, holidays: Holiday[]) {
  return holidays.find((h) => h.date === value) ?? null;
}

export function closedReason(value: string, cal: SchoolCalendar) {
  const holiday = holidayOn(value, cal.holidays);
  if (holiday) return holiday.name;
  const wd = weekdayOfYmd(value);
  if (!cal.weekdays.includes(wd)) return `${WEEKDAY_SHORT[wd] || "Day"} off`;
  return "";
}

export function closedCaption(reason: string) {
  if (!reason) return "";
  if (/\soff$/i.test(reason)) return reason;
  return `${reason} — school closed`;
}

export function isSchoolDay(value: string, cal: SchoolCalendar) {
  return !closedReason(value, cal);
}

export function snapToSchoolDay(value: string, cal: SchoolCalendar) {
  let date = value;
  for (let i = 0; i < 400; i += 1) {
    if (isSchoolDay(date, cal)) return date;
    date = addDays(date, 1);
  }
  return date;
}

export function nextSchoolDay(value: string, cal: SchoolCalendar) {
  return snapToSchoolDay(addDays(value, 1), cal);
}

export function shiftSchoolDays(value: string, days: number, cal: SchoolCalendar) {
  if (!value || !days) return value;
  const direction = days < 0 ? -1 : 1;
  let remaining = Math.abs(days);
  let date = value;
  for (let i = 0; i < 2000 && remaining > 0; i += 1) {
    date = addDays(date, direction);
    if (isSchoolDay(date, cal)) remaining -= 1;
  }
  return date;
}

export function schoolDaysBetween(from: string, to: string, cal: SchoolCalendar) {
  if (!from || !to || from === to) return 0;
  const direction = from < to ? 1 : -1;
  let count = 0;
  let date = from;
  for (let i = 0; i < 2000 && date !== to; i += 1) {
    date = addDays(date, direction);
    if (isSchoolDay(date, cal)) count += 1;
  }
  return count;
}

export function paperDates(count: number, start: string, cadence: PaperCadence, cal: SchoolCalendar) {
  if (count <= 0 || !start) return [] as string[];
  if (cadence === "custom") return [];
  const first = snapToSchoolDay(start, cal);
  if (cadence === "same") return Array.from({ length: count }, () => first);
  const dates: string[] = [];
  let date = first;
  for (let i = 0; i < count; i += 1) {
    dates.push(date);
    if (cadence === "week") {
      date = snapToSchoolDay(addDays(date, 7), cal);
    } else {
      date = nextSchoolDay(date, cal);
      if (cadence === "gap") date = nextSchoolDay(date, cal);
    }
  }
  return dates;
}

export function cadenceForKind(kind?: string): PaperCadence {
  return kind === "unit" ? "same" : "school";
}

export function diffDays(from: string, to: string) {
  const a = parseYmd(from);
  const b = parseYmd(to);
  if (!a || !b) return 0;
  return Math.round((+b - +a) / 86_400_000);
}

export type DeadlineOffsets = {
  paperBefore: number;
  copiesAfter: number;
  resultAfter: number;
};

export const DEFAULT_DEADLINE_OFFSETS: DeadlineOffsets = {
  paperBefore: 7,
  copiesAfter: 7,
  resultAfter: 14,
};

export function paperOffsets(
  examDate: string,
  offsets: DeadlineOffsets = DEFAULT_DEADLINE_OFFSETS,
  cal: SchoolCalendar = DEFAULT_CALENDAR
) {
  return {
    paperDueOn: shiftSchoolDays(examDate, -Math.max(0, offsets.paperBefore), cal),
    copiesDueOn: shiftSchoolDays(examDate, Math.max(0, offsets.copiesAfter), cal),
    resultOn: shiftSchoolDays(examDate, Math.max(0, offsets.resultAfter), cal),
  };
}

export function sittingDeadlines(
  dates: string[],
  offsets: DeadlineOffsets = DEFAULT_DEADLINE_OFFSETS,
  cal: SchoolCalendar = DEFAULT_CALENDAR
) {
  const ordered = dates.filter(Boolean).sort();
  const first = ordered[0] || "";
  const last = ordered[ordered.length - 1] || first;
  if (!first) return { paperDueOn: "", copiesDueOn: "", resultOn: "" };
  return {
    paperDueOn: shiftSchoolDays(first, -Math.max(0, offsets.paperBefore), cal),
    copiesDueOn: shiftSchoolDays(last, Math.max(0, offsets.copiesAfter), cal),
    resultOn: shiftSchoolDays(last, Math.max(0, offsets.resultAfter), cal),
  };
}

export function inferDeadlineOffsets(
  dates: string[],
  deadlines: { paperDueOn?: string | null; copiesDueOn?: string | null; resultOn?: string | null },
  cal: SchoolCalendar = DEFAULT_CALENDAR
): DeadlineOffsets {
  const ordered = dates.filter(Boolean).sort();
  const first = ordered[0] || "";
  const last = ordered[ordered.length - 1] || first;
  return {
    paperBefore:
      first && deadlines.paperDueOn
        ? schoolDaysBetween(deadlines.paperDueOn.slice(0, 10), first, cal)
        : DEFAULT_DEADLINE_OFFSETS.paperBefore,
    copiesAfter:
      last && deadlines.copiesDueOn
        ? schoolDaysBetween(last, deadlines.copiesDueOn.slice(0, 10), cal)
        : DEFAULT_DEADLINE_OFFSETS.copiesAfter,
    resultAfter:
      last && deadlines.resultOn
        ? schoolDaysBetween(last, deadlines.resultOn.slice(0, 10), cal)
        : DEFAULT_DEADLINE_OFFSETS.resultAfter,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function prettyDay(value?: string | null, withYear = false) {
  const dt = parseYmd(value);
  if (!dt) return "—";
  const day = dt.getDate();
  const month = MONTHS[dt.getMonth()];
  return withYear ? `${day} ${month} ${dt.getFullYear()}` : `${day} ${month}`;
}

export function calendarFrom(
  holidays?: { date: string; name: string }[],
  weekdays?: { n: number }[] | number[]
): SchoolCalendar {
  const days = (weekdays || [])
    .map((w) => (typeof w === "number" ? w : w.n))
    .filter((n) => n >= 1 && n <= 7);
  return {
    weekdays: days.length ? days : DEFAULT_CALENDAR.weekdays,
    holidays: (holidays || []).map((h) => ({ date: h.date.slice(0, 10), name: h.name })),
  };
}

export function defaultExamStart(cal: SchoolCalendar, now = new Date()) {
  return snapToSchoolDay(addDays(ymd(now), 14), cal);
}
