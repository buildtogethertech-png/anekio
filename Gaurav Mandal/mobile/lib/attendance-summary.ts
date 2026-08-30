import { addDays, isSchoolDay, weekdayOfYmd, type SchoolCalendar } from "./calendar";

export type AttendanceRow = {
  date: string | Date;
  status: string;
};

export type AttendanceSummary = {
  marked: number;
  inDays: number;
  late: number;
  out: number;
  pct: number;
  thisMonth: { inDays: number; marked: number };
};

export type TodayMark = "in" | "late" | "out" | "leave";

function parseDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function calendarKey(value: Date) {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

function monthKey(value: Date) {
  return `${value.getFullYear()}-${value.getMonth()}`;
}

export function attendanceKind(status: string) {
  return status.trim().toLowerCase();
}

export type AttendanceLetter = "P" | "A" | "L" | "";

export type AttendanceDot = {
  date: string;
  letter: AttendanceLetter;
  kind: string;
  weekday: string;
};

const WEEKDAY_TINY: Record<number, string> = {
  1: "Mo",
  2: "Tu",
  3: "We",
  4: "Th",
  5: "Fr",
  6: "Sa",
  7: "Su",
};

function rowDate(row: AttendanceRow): string {
  if (typeof row.date === "string") return row.date.slice(0, 10);
  const date = parseDate(row.date);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function weekdayLabel(date: string) {
  return WEEKDAY_TINY[weekdayOfYmd(date)] || "";
}

function toDot(date: string, status: string): AttendanceDot {
  return {
    date,
    letter: attendanceLetter(status),
    kind: attendanceKind(status),
    weekday: weekdayLabel(date),
  };
}

export function attendanceLetter(status: string): AttendanceLetter {
  const kind = attendanceKind(status);
  if (kind === "present" || kind === "in") return "P";
  if (kind === "absent" || kind === "out") return "A";
  if (kind === "late") return "L";
  return "";
}

export function attendanceStatusLabel(status: string) {
  const kind = attendanceKind(status);
  if (kind === "present" || kind === "in") return "Present";
  if (kind === "absent" || kind === "out") return "Absent";
  if (kind === "late") return "Late";
  if (kind === "leave") return "On leave";
  return status;
}

export function lastAttendanceDots(
  rows: AttendanceRow[],
  through: string,
  liveStatus?: string,
  count = 7,
  cal?: SchoolCalendar,
): AttendanceDot[] {
  const throughDay = through.slice(0, 10);
  const byDate = new Map<string, string>();
  for (const row of rows) {
    const date = rowDate(row);
    if (!date || date > throughDay) continue;
    byDate.set(date, row.status);
  }
  if (liveStatus) byDate.set(throughDay, liveStatus);

  if (cal) {
    const days: string[] = [];
    let cursor = throughDay;
    for (let i = 0; i < 60 && days.length < count; i += 1) {
      if (isSchoolDay(cursor, cal)) days.push(cursor);
      cursor = addDays(cursor, -1);
    }
    return days.reverse().map((date) => toDot(date, byDate.get(date) || ""));
  }

  const dots = [...byDate.keys()]
    .sort()
    .slice(-count)
    .map((date) => toDot(date, byDate.get(date) || ""));
  while (dots.length < count) dots.unshift({ date: "", letter: "", kind: "", weekday: "" });
  return dots;
}

export function attendanceSummary(rows: AttendanceRow[], now = new Date()): AttendanceSummary {
  let late = 0;
  let out = 0;
  let present = 0;
  for (const row of rows) {
    const kind = attendanceKind(row.status);
    if (kind === "late") late += 1;
    else if (kind === "absent") out += 1;
    else if (kind === "present" || kind === "leave") present += 1;
  }
  const marked = rows.length;
  const inDays = present + late;
  const thisY = now.getFullYear();
  const thisM = now.getMonth();
  const monthRows = rows.filter((row) => {
    const date = parseDate(row.date);
    return date && date.getFullYear() === thisY && date.getMonth() === thisM;
  });
  let monthIn = 0;
  for (const row of monthRows) {
    const kind = attendanceKind(row.status);
    if (kind === "present" || kind === "late" || kind === "leave") monthIn += 1;
  }
  return {
    marked,
    inDays,
    late,
    out,
    pct: marked ? Math.round((inDays / marked) * 100) : 0,
    thisMonth: { inDays: monthIn, marked: monthRows.length },
  };
}

export function todayMark(rows: AttendanceRow[], now = new Date()): TodayMark | null {
  const today = calendarKey(now);
  const row = rows.find((item) => {
    const date = parseDate(item.date);
    return date && calendarKey(date) === today;
  });
  if (!row) return null;
  const kind = attendanceKind(row.status);
  if (kind === "late") return "late";
  if (kind === "absent") return "out";
  if (kind === "leave") return "leave";
  if (kind === "present") return "in";
  return null;
}

export function todayMarkLabel(mark: TodayMark | null) {
  if (mark === "in") return "In today";
  if (mark === "late") return "Late today";
  if (mark === "out") return "Out today";
  if (mark === "leave") return "Leave today";
  return null;
}

export function attendanceCountLine(summary: AttendanceSummary) {
  if (!summary.marked) return "No days marked yet";
  return `${summary.inDays} in · ${summary.late} late · ${summary.out} out of ${summary.marked} marked days`;
}

export function attendanceHint(summary: AttendanceSummary, lastDate?: string) {
  if (summary.thisMonth.marked) return `This month ${summary.thisMonth.inDays}/${summary.thisMonth.marked}`;
  if (lastDate) return `Last marked ${lastDate}`;
  return "Showing up is cultivation.";
}

export function attendanceCbseNote(summary: AttendanceSummary) {
  return summary.marked && summary.pct < 75 ? "CBSE needs 75%" : null;
}

export function attendanceTone(status: string): "leaf" | "clay" | "warn" | "sky" {
  const kind = attendanceKind(status);
  if (kind === "present") return "leaf";
  if (kind === "late") return "clay";
  if (kind === "leave") return "sky";
  return "warn";
}

export function groupAttendanceByMonth<T extends AttendanceRow>(rows: T[]) {
  const groups: { key: string; label: string; rows: T[] }[] = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    const date = parseDate(row.date);
    const key = date ? monthKey(date) : "unknown";
    const label = date ? date.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : "Earlier";
    let at = index.get(key);
    if (at == null) {
      at = groups.length;
      index.set(key, at);
      groups.push({ key, label, rows: [] });
    }
    groups[at].rows.push(row);
  }
  return groups;
}
