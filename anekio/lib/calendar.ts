import { addDays, parseYmd, ymd } from "./exams";
import { WEEKDAY_SHORT } from "./schedule";
import { cell, parseCsv, parseDob } from "./sheet";

export type Holiday = { date: string; name: string };
export type SchoolCalendar = {
  weekdays: number[];
  holidays: Holiday[];
};
export type PaperCadence = "school" | "gap" | "week" | "same" | "custom";

export const DEFAULT_CALENDAR: SchoolCalendar = {
  weekdays: [1, 2, 3, 4, 5, 6],
  holidays: [],
};

export const PAPER_CADENCE = [
  {
    id: "school" as const,
    label: "One paper a school day",
    hint: "Skip weekly offs and holidays",
  },
  {
    id: "gap" as const,
    label: "Rest day between papers",
    hint: "Paper, then a school day off, then the next",
  },
  {
    id: "week" as const,
    label: "Same weekday each week",
    hint: "From the first paper, one a week",
  },
  {
    id: "same" as const,
    label: "All papers the same day",
    hint: "Unit tests and short sittings",
  },
  {
    id: "custom" as const,
    label: "Custom dates",
    hint: "Type a date on each subject yourself",
  },
];

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

export function paperDates(
  count: number,
  start: string,
  cadence: PaperCadence,
  cal: SchoolCalendar
) {
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

export function skippedBetween(from: string, to: string, cal: SchoolCalendar) {
  const skipped: { date: string; reason: string }[] = [];
  if (!from || !to || from > to) return skipped;
  let date = from;
  while (date <= to) {
    const reason = closedReason(date, cal);
    if (reason) skipped.push({ date, reason });
    date = addDays(date, 1);
    if (skipped.length > 40) break;
  }
  return skipped;
}

export function prettyDay(value?: string) {
  if (!value) return "—";
  const dt = parseYmd(value);
  if (!dt) return value;
  return dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export function parseHolidayText(raw: string): Holiday[] {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) return [];
  if (/BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(text)) return parseIcsHolidays(text);
  return parseHolidayCsv(text);
}

function parseHolidayCsv(text: string): Holiday[] {
  const rows = parseCsv(text);
  const out: Holiday[] = [];
  for (const row of rows) {
    const date = toYmd(cell(row, "date", "day", "on", "starts", "start"));
    const name = cell(row, "name", "holiday", "title", "summary", "event", "occasion");
    if (date && name) out.push({ date, name });
  }
  if (out.length) return mergeHolidays(out);
  return mergeHolidays(
    text
      .split(/\r?\n/)
      .map((line) => line.split(/[,\t;]/).map((p) => p.trim().replace(/^"|"$/g, "")))
      .filter((parts) => parts[0] && parts[1] && !/^date$/i.test(parts[0]))
      .flatMap((parts) => {
        const date = toYmd(parts[0]);
        const name = parts.slice(1).join(" ").trim();
        return date && name ? [{ date, name }] : [];
      })
  );
}

function parseIcsHolidays(text: string): Holiday[] {
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const year = new Date().getFullYear();
  const years = [year - 1, year, year + 1, year + 2];
  const out: Holiday[] = [];
  for (const chunk of unfolded.split(/BEGIN:VEVENT/i).slice(1)) {
    const body = chunk.split(/END:VEVENT/i)[0] || "";
    const summary = unescapeIcs(icsValue(body, "SUMMARY"));
    const start = icsDate(icsValue(body, "DTSTART"));
    if (!summary || !start) continue;
    const rrule = icsValue(body, "RRULE");
    if (/FREQ=YEARLY/i.test(rrule)) {
      const month = start.slice(5, 7);
      const day = start.slice(8, 10);
      for (const y of years) out.push({ date: `${y}-${month}-${day}`, name: summary });
    } else {
      out.push({ date: start, name: summary });
    }
  }
  return mergeHolidays(out);
}

function icsValue(block: string, key: string) {
  const match = block.match(new RegExp(`^${key}[^:\\n]*:(.*)$`, "im"));
  return (match?.[1] || "").trim();
}

function icsDate(raw: string) {
  const match = raw.replace(/[^0-9T]/g, "").match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function unescapeIcs(value: string) {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function toYmd(raw: string) {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const compact = icsDate(s);
  if (compact) return compact;
  const parsed = parseDob(s);
  return parsed ? ymd(parsed) : "";
}

function mergeHolidays(rows: Holiday[]) {
  const map = new Map<string, string>();
  for (const row of rows) {
    const date = toYmd(row.date);
    const name = row.name.trim();
    if (!date || !name) continue;
    const prev = map.get(date);
    if (!prev) map.set(date, name);
    else if (!prev.split(" · ").includes(name)) map.set(date, `${prev} · ${name}`);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, name]) => ({ date, name }));
}
