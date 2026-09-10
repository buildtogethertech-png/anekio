import { AttendanceStatus, RoomKind } from "@prisma/client";
import { WEEKDAY_LABEL, WEEKDAY_SHORT } from "./schedule";

export const STAFF_KIND_LABEL: Record<string, string> = {
  OFFICE: "Office",
  LAB: "Lab",
  SUPPORT: "Support",
  OTHER: "Other",
};

export function jsToWeekday(d: Date) {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function minutesNow(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

function parseHm(raw: string) {
  const [h, m] = raw.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function pickPeriod(
  periods: { id: string; name: string; startsAt: string; endsAt: string; isBreak: boolean; sortOrder: number }[],
  now: Date
) {
  const teaching = periods.filter((p) => !p.isBreak).sort((a, b) => a.sortOrder - b.sortOrder);
  if (!teaching.length) return { period: null as (typeof teaching)[number] | null, when: "none" as const };
  const mins = minutesNow(now);
  const live = teaching.find((p) => mins >= parseHm(p.startsAt) && mins < parseHm(p.endsAt));
  if (live) return { period: live, when: "now" as const };
  const next = teaching.find((p) => mins < parseHm(p.startsAt));
  if (next) return { period: next, when: "next" as const };
  return { period: teaching[teaching.length - 1], when: "done" as const };
}

export function startOfDay(d = new Date()) {
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return day;
}

export function collectionWindow(now = new Date()) {
  const days: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = startOfDay(now);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  return { from: days[0], days };
}

export function buildCollectionSeries(
  payments: { amount: number; paidAt: Date }[],
  now = new Date()
) {
  const { days } = collectionWindow(now);
  const today = startOfDay(now).getTime();
  const series = days.map((day) => {
    const start = day.getTime();
    const end = start + 86400000;
    const amount = payments
      .filter((p) => {
        const t = new Date(p.paidAt).getTime();
        return t >= start && t < end;
      })
      .reduce((s, p) => s + p.amount, 0);
    return {
      date: day,
      label: WEEKDAY_SHORT[jsToWeekday(day)] ?? "",
      amount,
      isToday: day.getTime() === today,
    };
  });
  const todayAmount = series.find((d) => d.isToday)?.amount ?? 0;
  const weekAmount = series.reduce((s, d) => s + d.amount, 0);
  return { series, todayAmount, weekAmount };
}

export function deskCopy(when: "now" | "next" | "done" | "none" | "closed", weekday: number) {
  const day = WEEKDAY_LABEL[weekday] ?? "Today";
  if (when === "closed") return `${day} · school is closed`;
  if (when === "now") return `${day} · this period`;
  if (when === "next") return `${day} · next period`;
  if (when === "done") return `${day} · today so far`;
  return day;
}

export function isAway(status?: AttendanceStatus | null) {
  return status === "ABSENT" || status === "LEAVE";
}

export function isIn(status?: AttendanceStatus | null) {
  return status === "PRESENT" || status === "LATE";
}

export type DeskSlot = {
  id: string;
  weekday: number;
  teacherId: string | null;
  classId: string;
  class: { name: string; section: string };
  subject: { name: string } | null;
  room: { name: string; kind: RoomKind } | null;
  period: { id: string; name: string; startsAt?: string; endsAt?: string };
  teacher: { user: { name: string } } | null;
};

export type UnassignedCell = {
  key: string;
  classId: string;
  classLabel: string;
  weekday: number;
  day: string;
  periodName: string;
  time: string;
};

export function findUnassigned(input: {
  classes: { id: string; name: string; section: string }[];
  weekdays: number[];
  periods: { id: string; name: string; startsAt: string; endsAt: string; isBreak: boolean; sortOrder: number }[];
  slots: DeskSlot[];
}): UnassignedCell[] {
  const teaching = input.periods.filter((p) => !p.isBreak).sort((a, b) => a.sortOrder - b.sortOrder);
  const filled = new Set(
    input.slots.filter((s) => s.teacherId).map((s) => `${s.classId}:${s.period.id}:${s.weekday}`)
  );
  const holes: UnassignedCell[] = [];
  for (const klass of input.classes) {
    const label = `${klass.name}-${klass.section}`;
    for (const weekday of input.weekdays) {
      for (const period of teaching) {
        const key = `${klass.id}:${period.id}:${weekday}`;
        if (filled.has(key)) continue;
        holes.push({
          key,
          classId: klass.id,
          classLabel: label,
          weekday,
          day: WEEKDAY_SHORT[weekday] ?? String(weekday),
          periodName: period.name,
          time: `${period.startsAt}–${period.endsAt}`,
        });
      }
    }
  }
  return holes;
}

export function buildDeskPulse(input: {
  now: Date;
  weekdays: number[];
  periods: { id: string; name: string; startsAt: string; endsAt: string; isBreak: boolean; sortOrder: number }[];
  classes: { id: string; name: string; section: string }[];
  slots: DeskSlot[];
  teachers: { id: string; user: { name: string }; employeeId: string }[];
  attendance: { teacherId: string | null; status: AttendanceStatus }[];
}) {
  const weekday = jsToWeekday(input.now);
  const open = input.weekdays.includes(weekday);
  const picked = open ? pickPeriod(input.periods, input.now) : { period: null, when: "closed" as const };
  const todaySlots = input.slots.filter((s) => s.weekday === weekday);
  const statusOf = (teacherId: string) =>
    input.attendance.find((a) => a.teacherId === teacherId)?.status ?? null;
  const focusSlots =
    (picked.when === "now" || picked.when === "next") && picked.period
      ? todaySlots.filter((s) => s.period.id === picked.period!.id)
      : todaySlots;

  const wasted = focusSlots.filter((s) => s.teacherId && isAway(statusOf(s.teacherId)));
  const emptyClasses = wasted.filter((s) => s.room?.kind !== "LAB");
  const emptyLabs = wasted.filter((s) => s.room?.kind === "LAB");

  const idleTeachers = input.teachers.filter((t) => {
    if (!isIn(statusOf(t.id))) return false;
    return !focusSlots.some((s) => s.teacherId === t.id);
  });

  const unassigned = findUnassigned({
    classes: input.classes,
    weekdays: input.weekdays,
    periods: input.periods,
    slots: input.slots,
  });

  return {
    weekday,
    open,
    when: picked.when,
    period: picked.period,
    label: deskCopy(picked.when, weekday),
    emptyClasses,
    emptyLabs,
    idleTeachers,
    unassigned,
    unmarked: input.teachers.filter((t) => !statusOf(t.id)).length,
  };
}
