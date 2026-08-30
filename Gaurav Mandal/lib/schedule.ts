export const WEEKDAY_LABEL: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

export const WEEKDAY_SHORT: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

export function weekCapacity(weekdayCount: number, teachingPeriodCount: number) {
  return Math.max(0, weekdayCount) * Math.max(0, teachingPeriodCount);
}

export const DEFAULT_SUBJECT_CATALOG = [
  "English",
  "Mathematics",
  "Hindi",
  "Science",
  "Social Science",
  "Computer",
];

export function parseSubjectCatalog(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_SUBJECT_CATALOG];
    const names = [...new Set(parsed.map((s) => String(s || "").trim()).filter(Boolean))];
    return names.length ? names : [...DEFAULT_SUBJECT_CATALOG];
  } catch {
    return [...DEFAULT_SUBJECT_CATALOG];
  }
}

export function parseWeekdays(raw: string | null | undefined): number[] {
  try {
    const parsed = JSON.parse(raw || "[1,2,3,4,5,6]") as number[];
    return parsed.filter((n) => n >= 1 && n <= 7);
  } catch {
    return [1, 2, 3, 4, 5, 6];
  }
}

export const QUALIFICATION_OPTIONS = [
  "B.Ed",
  "M.Ed",
  "B.El.Ed",
  "B.Sc",
  "M.Sc",
  "B.A",
  "M.A",
  "B.Tech",
  "CTET",
  "TET",
  "NET",
];

export function formatQualification(tags: string[], notes: string) {
  const head = tags.filter(Boolean).join(" · ");
  const extra = notes.trim();
  if (head && extra) return `${head} — ${extra}`;
  return head || extra || null;
}

export function parseQualification(raw?: string | null) {
  if (!raw) return { tags: [] as string[], notes: "" };
  const [head, ...rest] = raw.split(" — ");
  const notes = rest.join(" — ").trim();
  const parts = head.split(" · ").map((s) => s.trim()).filter(Boolean);
  const tags = parts.filter((t) => QUALIFICATION_OPTIONS.includes(t));
  const leftover = parts.filter((t) => !QUALIFICATION_OPTIONS.includes(t));
  return { tags, notes: [notes, ...leftover].filter(Boolean).join(" · ") };
}

export const SUBJECT_CATALOG = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "English",
  "Hindi",
  "Science",
  "Social Science",
  "Computer",
  "Physical Education",
  "Arts",
];

export const ROOM_KIND_LABEL: Record<string, string> = {
  CLASSROOM: "Classroom",
  LAB: "Lab",
  GROUND: "Ground",
  OTHER: "Other",
};

export type SlotClash =
  | "teacher_busy"
  | "room_busy"
  | "teacher_not_on_subject"
  | "day_closed"
  | "break_period";

export const CLASH_LABEL: Record<SlotClash, string> = {
  teacher_busy: "This teacher is already in another class this period.",
  room_busy: "This room is already taken this period.",
  teacher_not_on_subject: "This teacher is not assigned that subject for this class.",
  day_closed: "School is not in session that day.",
  break_period: "A break cannot take a lesson.",
};
