/**
 * One-day timetable changes.
 *
 * The weekly timetable (TimetableSlot) never changes here. A SubstituteAssignment row
 * changes one slot on one date:
 *   COVERED -> another teacher takes it that day
 *   FREE    -> no lesson that day
 *   OPEN    -> the weekly teacher is out and nobody is assigned yet
 * Periods of a teacher on approved leave count as OPEN even without a row.
 * Only people with timetable.edit can change anything; teachers only see the result.
 */
import { prisma } from "./prisma";
import { can, scopeFor, type AccessUser } from "./permissions";
import { teamClassIds } from "./reports";
import { loadSchoolCalendar } from "./leave";
import { closedReason, prettyDay, weekdayOfYmd } from "./calendar";
import { ymd } from "./exams";
import { formatSubjectLabel, skillMatchesSubject } from "./subject-code";
import { notifyNoticeRecipients } from "./push";

export type DayChangeStatus = "COVERED" | "FREE" | "OPEN";
const REASONS = ["LEAVE", "ABSENT", "DUTY", "OTHER"] as const;
type Reason = (typeof REASONS)[number];

export const REASON_LABEL: Record<string, string> = {
  LEAVE: "On leave",
  ABSENT: "Absent",
  DUTY: "On duty",
  OTHER: "Changed",
};

function cleanDate(value: unknown) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date");
  return date;
}

function cleanReason(value: unknown, fallback: Reason): Reason {
  const r = String(value || "").toUpperCase();
  return (REASONS as readonly string[]).includes(r) ? (r as Reason) : fallback;
}

async function needEdit(user: AccessUser, classIds: string[]) {
  if (!can(user, "timetable.edit")) throw new Error("Only the office can change the timetable.");
  if (scopeFor(user, "timetable.edit") === "REPORTS") {
    const team = await teamClassIds(user.id);
    if (classIds.some((id) => !team.includes(id))) throw new Error("No access to this class.");
  }
}

function canView(user: AccessUser) {
  return can(user, "timetable.edit") || can(user, "timetable.view");
}

async function openDay(date: string) {
  const cal = await loadSchoolCalendar();
  const closed = closedReason(date, cal);
  return { weekday: weekdayOfYmd(date), closed };
}

/** Everything needed to work out who is busy on a date. */
async function dayContext(date: string, weekday: number) {
  const [slots, changes, leaves, teachers] = await Promise.all([
    prisma.timetableSlot.findMany({
      where: { weekday },
      include: {
        period: true,
        subject: true,
        class: true,
        room: true,
        teacher: { include: { user: { select: { id: true, name: true } } } },
      },
    }),
    prisma.substituteAssignment.findMany({
      where: { date },
      include: { substitute: { include: { user: { select: { id: true, name: true } } } } },
    }),
    prisma.leaveRequest.findMany({
      where: { status: "ACTIVE", teacherId: { not: null }, from: { lte: date }, to: { gte: date } },
      select: { id: true, teacherId: true, halfDay: true, type: { select: { name: true } } },
    }),
    prisma.teacher.findMany({
      include: {
        user: { select: { id: true, name: true } },
        skills: true,
        subjects: { select: { name: true, classId: true } },
        classes: { select: { classId: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
  ]);
  const changeBySlot = new Map(changes.map((c) => [c.slotId, c]));
  const leaveByTeacher = new Map(leaves.map((l) => [l.teacherId as string, l]));
  // Teachers marked out for the day without a leave (they have OPEN/COVERED rows with reason ABSENT/DUTY).
  const outToday = new Set(
    changes.filter((c) => c.absentTeacherId && (c.reason === "ABSENT" || c.reason === "DUTY")).map((c) => c.absentTeacherId as string)
  );
  return { slots, changes, changeBySlot, leaveByTeacher, outToday, teachers };
}

type Ctx = Awaited<ReturnType<typeof dayContext>>;

/** Is this teacher teaching in this period on the date (after one-day changes)? */
function busyIn(ctx: Ctx, teacherId: string, periodId: string, exceptSlotId?: string) {
  const weekly = ctx.slots.some(
    (s) => s.teacherId === teacherId && s.periodId === periodId && s.id !== exceptSlotId && !ctx.changeBySlot.has(s.id)
  );
  if (weekly) return true;
  return ctx.changes.some((c) => {
    if (c.substituteId !== teacherId || c.slotId === exceptSlotId) return false;
    const slot = ctx.slots.find((s) => s.id === c.slotId);
    return slot?.periodId === periodId;
  });
}

function isOut(ctx: Ctx, teacherId: string) {
  return ctx.leaveByTeacher.has(teacherId) || ctx.outToday.has(teacherId);
}

function coverCount(ctx: Ctx, teacherId: string) {
  return ctx.changes.filter((c) => c.substituteId === teacherId).length;
}

/** Free teachers for a slot, best first: teaches this class > teaches this subject > anyone free. */
function rankCandidates(ctx: Ctx, slot: Ctx["slots"][number]) {
  const subjectName = (slot.subject?.name || "").toLowerCase();
  return ctx.teachers
    .filter((t) => t.id !== slot.teacherId)
    .filter((t) => !isOut(ctx, t.id))
    .filter((t) => !busyIn(ctx, t.id, slot.periodId, slot.id))
    .map((t) => {
      const teachesClass =
        t.classId === slot.classId ||
        t.classes.some((c) => c.classId === slot.classId) ||
        t.subjects.some((s) => s.classId === slot.classId) ||
        t.skills.some((s) => s.classId === slot.classId) ||
        ctx.slots.some((s) => s.teacherId === t.id && s.classId === slot.classId);
      const teachesSubject =
        Boolean(slot.subject) &&
        (t.skills.some((s) => skillMatchesSubject(s.subjectName, slot.subject!)) ||
          t.subjects.some((s) => s.name.toLowerCase() === subjectName));
      const tier = teachesClass ? 1 : teachesSubject ? 2 : 3;
      const reason =
        tier === 1
          ? `Teaches ${slot.class.name}-${slot.class.section}`
          : tier === 2
            ? `Teaches ${slot.subject?.name || "this subject"}`
            : "Free this period";
      const periodsToday =
        ctx.slots.filter((s) => s.teacherId === t.id && !ctx.changeBySlot.has(s.id) && !s.period.isBreak).length + coverCount(ctx, t.id);
      return { id: t.id, name: t.user.name, tier, reason, periodsToday };
    })
    .sort((a, b) => a.tier - b.tier || a.periodsToday - b.periodsToday || a.name.localeCompare(b.name));
}

function rowFor(ctx: Ctx, slot: Ctx["slots"][number]) {
  const change = ctx.changeBySlot.get(slot.id);
  const leave = slot.teacherId ? ctx.leaveByTeacher.get(slot.teacherId) : undefined;
  let status: DayChangeStatus | "" = "";
  let reason = "";
  if (change) {
    status = (change.status as DayChangeStatus) || "COVERED";
    reason = change.reason;
  } else if (leave && !slot.period.isBreak) {
    status = "OPEN";
    reason = "LEAVE";
  }
  const subTeacher = change?.substitute ? { id: change.substitute.id, name: change.substitute.user.name } : null;
  return {
    slotId: slot.id,
    classId: slot.classId,
    classLabel: `${slot.class.name}-${slot.class.section}`,
    periodId: slot.periodId,
    period: slot.period.name,
    startsAt: slot.period.startsAt,
    endsAt: slot.period.endsAt,
    sortOrder: slot.period.sortOrder,
    subjectId: slot.subjectId || "",
    subject: slot.subject ? formatSubjectLabel(slot.subject.code, slot.subject.name) : "—",
    room: slot.room?.name || "",
    weeklyTeacherId: slot.teacherId || "",
    weeklyTeacher: slot.teacher?.user.name || "",
    /** "" = as per weekly timetable. */
    status,
    reason,
    reasonLabel: reason ? REASON_LABEL[reason] || "Changed" : "",
    note: change?.note || "",
    teacherId: status === "COVERED" ? subTeacher?.id || "" : status ? "" : slot.teacherId || "",
    teacher: status === "COVERED" ? subTeacher?.name || "" : status ? "" : slot.teacher?.user.name || "",
    fromLeave: Boolean(change?.leaveRequestId || (!change && leave)),
  };
}

/** The timetable as it actually runs on one date, for the whole school. */
export async function loadDayTimetable(user: AccessUser, input: { date?: string }) {
  if (!canView(user)) throw new Error("No access.");
  const date = cleanDate(input.date || ymd(new Date()));
  const { weekday, closed } = await openDay(date);
  const periods = await prisma.period.findMany({ orderBy: { sortOrder: "asc" } });
  const base = {
    date,
    weekday,
    closed,
    canEdit: can(user, "timetable.edit"),
    periods: periods.map((p) => ({ id: p.id, name: p.name, startsAt: p.startsAt, endsAt: p.endsAt, isBreak: p.isBreak })),
  };
  if (closed) return { ...base, rows: [], needsCover: 0, teachersOut: [] };
  const ctx = await dayContext(date, weekday);
  let slots = ctx.slots;
  if (scopeFor(user, can(user, "timetable.edit") ? "timetable.edit" : "timetable.view") === "REPORTS") {
    const team = await teamClassIds(user.id);
    slots = slots.filter((s) => team.includes(s.classId));
  }
  const rows = slots.filter((s) => !s.period.isBreak).map((slot) => {
    const row = rowFor(ctx, slot);
    return { ...row, candidates: rankCandidates(ctx, slot) };
  });
  rows.sort((a, b) => a.classLabel.localeCompare(b.classLabel, undefined, { numeric: true }) || a.sortOrder - b.sortOrder);
  const outIds = new Set<string>([...ctx.leaveByTeacher.keys(), ...ctx.outToday]);
  const teachersOut = ctx.teachers
    .filter((t) => outIds.has(t.id))
    .map((t) => {
      const leave = ctx.leaveByTeacher.get(t.id);
      const mine = rows.filter((r) => r.weeklyTeacherId === t.id);
      return {
        id: t.id,
        name: t.user.name,
        why: leave ? `${leave.type.name}${leave.halfDay ? " (half day)" : ""}` : REASON_LABEL[ctx.changes.find((c) => c.absentTeacherId === t.id)?.reason || "ABSENT"],
        onLeave: Boolean(leave),
        periods: mine.length,
        open: mine.filter((r) => r.status === "OPEN").length,
      };
    });
  return {
    ...base,
    rows,
    needsCover: rows.filter((r) => r.status === "OPEN").length,
    teachersOut,
    teachers: ctx.teachers.map((t) => ({ id: t.id, name: t.user.name })),
  };
}

async function noticeTo(authorId: string, teacherId: string | null | undefined, title: string, body: string, key: string) {
  if (!teacherId) return;
  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId }, select: { userId: true } });
  if (!teacher?.userId) return;
  const notice = await prisma.notice
    .create({
      data: {
        eventKey: `TIMETABLE_DAY:${key}:${Date.now()}`,
        title,
        body,
        kind: "TIMETABLE",
        priority: "ACTION",
        authorId,
        recipients: { create: [{ userId: teacher.userId }] },
      },
    })
    .catch(() => null);
  if (notice) void notifyNoticeRecipients({ noticeId: notice.id, title, body, userIds: [teacher.userId] }).catch(() => undefined);
}

function whenText(date: string) {
  return date === ymd(new Date()) ? "today" : `on ${prettyDay(date)}`;
}

/** Change one period for one date. The weekly timetable is not touched. */
export async function saveDayChange(
  user: AccessUser,
  input: { date?: string; slotId?: string; status?: string; substituteId?: string; reason?: string; note?: string }
) {
  const date = cleanDate(input.date);
  const slotId = String(input.slotId || "");
  const status = String(input.status || "COVERED").toUpperCase() as DayChangeStatus;
  if (!["COVERED", "FREE", "OPEN"].includes(status)) throw new Error("Pick what happens in this period");
  const slot = await prisma.timetableSlot.findUnique({
    where: { id: slotId },
    include: { period: true, class: true, subject: true, teacher: { include: { user: { select: { name: true } } } } },
  });
  if (!slot) throw new Error("Period not found");
  await needEdit(user, [slot.classId]);
  if (slot.period.isBreak) throw new Error("A break cannot be changed.");
  const { weekday, closed } = await openDay(date);
  if (closed) throw new Error(`School is closed ${prettyDay(date)} (${closed}).`);
  if (slot.weekday !== weekday) throw new Error("That period is not on this day.");
  if (date < ymd(new Date())) throw new Error("Past days cannot be changed.");

  const ctx = await dayContext(date, weekday);
  const before = ctx.changeBySlot.get(slot.id);
  const leave = slot.teacherId ? ctx.leaveByTeacher.get(slot.teacherId) : undefined;
  const substituteId = status === "COVERED" ? String(input.substituteId || "") : "";
  if (status === "COVERED") {
    if (!substituteId) throw new Error("Pick who takes this period");
    if (substituteId === slot.teacherId && !leave) {
      // Back to the weekly teacher: no change needed.
      await prisma.substituteAssignment.deleteMany({ where: { date, slotId } });
      return { ok: true as const, cleared: true };
    }
    if (substituteId === slot.teacherId) throw new Error(`${slot.teacher?.user.name || "This teacher"} is on leave that day.`);
    const sub = ctx.teachers.find((t) => t.id === substituteId);
    if (!sub) throw new Error("Teacher not found");
    if (isOut(ctx, substituteId)) throw new Error(`${sub.user.name} is out that day.`);
    if (busyIn(ctx, substituteId, slot.periodId, slot.id)) throw new Error(`${sub.user.name} already has a class in ${slot.period.name}.`);
  }
  const reason = leave ? "LEAVE" : cleanReason(input.reason, before ? (before.reason as Reason) : "OTHER");
  const data = {
    status,
    reason,
    note: String(input.note ?? before?.note ?? "").slice(0, 200),
    substituteId: substituteId || null,
    leaveRequestId: leave?.id || null,
    absentTeacherId: slot.teacherId,
    assignedById: user.id,
  };
  await prisma.substituteAssignment.upsert({
    where: { date_slotId: { date, slotId } },
    update: data,
    create: { ...data, date, slotId },
  });

  const label = `${slot.period.name} · ${slot.class.name}-${slot.class.section}${slot.subject ? ` ${slot.subject.name}` : ""}`;
  if (substituteId && before?.substituteId !== substituteId) {
    await noticeTo(
      user.id,
      substituteId,
      `Cover ${whenText(date)}: ${label}`,
      `You take ${label} ${whenText(date)}${slot.teacher ? ` for ${slot.teacher.user.name}` : ""}.`,
      `${slot.id}:${date}:${substituteId}`
    );
  }
  if (before?.substituteId && before.substituteId !== substituteId) {
    await noticeTo(user.id, before.substituteId, `Cover cancelled: ${label}`, `You no longer take ${label} ${whenText(date)}.`, `${slot.id}:${date}:cancel`);
  }
  if (!leave && !before && slot.teacherId) {
    const what = status === "FREE" ? "has no lesson" : status === "COVERED" ? "is taken by someone else" : "is being re-arranged";
    await noticeTo(user.id, slot.teacherId, `Timetable change ${whenText(date)}`, `Your ${label} ${what} ${whenText(date)}.`, `${slot.id}:${date}:owner`);
  }
  return { ok: true as const };
}

/** Undo a one-day change: the period goes back to the weekly timetable (or back to "needs cover" if on leave). */
export async function clearDayChange(user: AccessUser, input: { date?: string; slotId?: string }) {
  const date = cleanDate(input.date);
  const slotId = String(input.slotId || "");
  const row = await prisma.substituteAssignment.findUnique({
    where: { date_slotId: { date, slotId } },
    include: { slot: { include: { period: true, class: true } } },
  });
  if (!row) return { ok: true as const };
  await needEdit(user, [row.slot.classId]);
  await prisma.substituteAssignment.delete({ where: { id: row.id } });
  if (row.substituteId) {
    const label = `${row.slot.period.name} · ${row.slot.class.name}-${row.slot.class.section}`;
    await noticeTo(user.id, row.substituteId, `Cover cancelled: ${label}`, `You no longer take ${label} ${whenText(date)}.`, `${slotId}:${date}:cancel`);
  }
  return { ok: true as const };
}

/** Teacher is out for the day (no leave applied): all their periods that day need cover. */
export async function markTeacherOut(user: AccessUser, input: { date?: string; teacherId?: string; reason?: string; note?: string }) {
  const date = cleanDate(input.date);
  const teacherId = String(input.teacherId || "");
  if (!teacherId) throw new Error("Pick a teacher");
  const { weekday, closed } = await openDay(date);
  if (closed) throw new Error(`School is closed ${prettyDay(date)} (${closed}).`);
  if (date < ymd(new Date())) throw new Error("Past days cannot be changed.");
  const slots = await prisma.timetableSlot.findMany({ where: { teacherId, weekday }, include: { period: true } });
  await needEdit(user, [...new Set(slots.map((s) => s.classId))]);
  if (!can(user, "timetable.edit")) throw new Error("No access.");
  const reason = cleanReason(input.reason, "ABSENT");
  const note = String(input.note || "").slice(0, 200);
  let added = 0;
  for (const slot of slots.filter((s) => !s.period.isBreak)) {
    const existing = await prisma.substituteAssignment.findUnique({ where: { date_slotId: { date, slotId: slot.id } } });
    if (existing) continue;
    await prisma.substituteAssignment.create({
      data: { date, slotId: slot.id, status: "OPEN", reason, note, absentTeacherId: teacherId, assignedById: user.id },
    });
    added += 1;
  }
  return { ok: true as const, periods: added };
}

/** Teacher is back: remove the day's changes that came from marking them out (not leave). */
export async function clearTeacherOut(user: AccessUser, input: { date?: string; teacherId?: string }) {
  const date = cleanDate(input.date);
  const teacherId = String(input.teacherId || "");
  const rows = await prisma.substituteAssignment.findMany({
    where: { date, absentTeacherId: teacherId, leaveRequestId: null, reason: { in: ["ABSENT", "DUTY"] } },
    include: { slot: { include: { period: true, class: true } } },
  });
  await needEdit(user, [...new Set(rows.map((r) => r.slot.classId))]);
  for (const row of rows) {
    await prisma.substituteAssignment.delete({ where: { id: row.id } });
    if (row.substituteId) {
      const label = `${row.slot.period.name} · ${row.slot.class.name}-${row.slot.class.section}`;
      await noticeTo(user.id, row.substituteId, `Cover cancelled: ${label}`, `You no longer take ${label} ${whenText(date)}.`, `${row.slotId}:${date}:cancel`);
    }
  }
  return { ok: true as const, removed: rows.length };
}

/** Give every period that needs cover on this date to the best free teacher. */
export async function autoCoverDay(user: AccessUser, input: { date?: string }) {
  const date = cleanDate(input.date);
  if (!can(user, "timetable.edit")) throw new Error("Only the office can change the timetable.");
  const day = await loadDayTimetable(user, { date });
  if (day.closed) throw new Error(`School is closed ${prettyDay(date)}.`);
  let covered = 0;
  let left = 0;
  // Re-read busy state after each pick so one teacher is not given two classes in the same period.
  for (const row of day.rows.filter((r) => r.status === "OPEN")) {
    const { weekday } = await openDay(date);
    const ctx = await dayContext(date, weekday);
    const slot = ctx.slots.find((s) => s.id === row.slotId);
    const best = slot ? rankCandidates(ctx, slot)[0] : undefined;
    if (!best) {
      left += 1;
      continue;
    }
    await saveDayChange(user, { date, slotId: row.slotId, status: "COVERED", substituteId: best.id, reason: row.reason || undefined });
    covered += 1;
  }
  return { ok: true as const, covered, left };
}

/** Next 7 days of changes that affect one teacher (periods they cover, periods taken from them). */
export async function teacherDayChanges(teacherId: string) {
  const from = ymd(new Date());
  const until = new Date();
  until.setDate(until.getDate() + 7);
  const rows = await prisma.substituteAssignment.findMany({
    where: { date: { gte: from, lte: ymd(until) }, OR: [{ substituteId: teacherId }, { absentTeacherId: teacherId }] },
    include: {
      slot: { include: { period: true, class: true, subject: true, teacher: { include: { user: { select: { name: true } } } } } },
      substitute: { include: { user: { select: { name: true } } } },
    },
    orderBy: [{ date: "asc" }],
  });
  return rows
    .map((row) => ({
      date: row.date,
      period: row.slot.period.name,
      startsAt: row.slot.period.startsAt,
      sortOrder: row.slot.period.sortOrder,
      classLabel: `${row.slot.class.name}-${row.slot.class.section}`,
      subject: row.slot.subject?.name || "",
      kind: row.substituteId === teacherId ? ("COVER" as const) : ("AWAY" as const),
      /** For COVER: whose period. For AWAY: who takes it ("" = free / not yet). */
      other: row.substituteId === teacherId ? row.slot.teacher?.user.name || "" : row.substitute?.user.name || "",
      status: row.status,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.sortOrder - b.sortOrder);
}
