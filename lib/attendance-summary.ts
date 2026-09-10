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

export type TodayMark = "in" | "late" | "out";

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

export function attendanceSummary(rows: AttendanceRow[], now = new Date()): AttendanceSummary {
  let late = 0;
  let out = 0;
  let present = 0;
  for (const row of rows) {
    const kind = attendanceKind(row.status);
    if (kind === "late") late += 1;
    else if (kind === "absent") out += 1;
    else if (kind === "present") present += 1;
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
    if (kind === "present" || kind === "late") monthIn += 1;
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
  if (kind === "present") return "in";
  return null;
}

export function todayMarkLabel(mark: TodayMark | null) {
  if (mark === "in") return "In today";
  if (mark === "late") return "Late today";
  if (mark === "out") return "Out today";
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

export function attendanceTone(status: string): "leaf" | "clay" | "warn" {
  const kind = attendanceKind(status);
  if (kind === "present") return "leaf";
  if (kind === "late") return "clay";
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
