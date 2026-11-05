/**
 * Class attendance cover: when a class teacher is out, the office hands that class's student
 * attendance to another teacher for one date (ClassAttendanceCover). The row only works on its date.
 *
 * Also builds the office "Today's gaps" list: each teacher who is out on a date, how many of their
 * periods still need cover, and whether their class still needs someone to take attendance.
 */
import { prisma } from "./prisma";
import { can, scopeFor, type AccessUser } from "./permissions";
import { teamClassIds } from "./reports";
import { loadSchoolCalendar } from "./leave";
import { closedReason, prettyDay, weekdayOfYmd } from "./calendar";
import { staffDayWindow, staffDayYmd } from "./staff-day";
import { notifyNoticeRecipients } from "./push";

const OUT_MARKS = new Set(["ABSENT", "LEAVE"]);

export function schoolToday() {
  return staffDayYmd(new Date());
}

function cleanDate(value: unknown) {
  const date = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Pick a date");
  return date;
}

async function needCoverEdit(user: AccessUser, classId: string) {
  if (!can(user, "timetable.edit")) throw new Error("Only the office can hand over attendance.");
  if (scopeFor(user, "timetable.edit") === "REPORTS" && !(await teamClassIds(user.id)).includes(classId)) {
    throw new Error("No access to this class.");
  }
}

async function noticeTeacher(authorId: string, teacherId: string, title: string, body: string, key: string) {
  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId }, select: { userId: true } });
  if (!teacher?.userId) return;
  const notice = await prisma.notice
    .create({
      data: {
        eventKey: `ATTENDANCE_COVER:${key}:${Date.now()}`,
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
  return date === schoolToday() ? "today" : `on ${prettyDay(date)}`;
}

/** Teachers who are out on a date: approved leave, marked out on the routine, or marked absent / leave in staff attendance. */
async function teachersOutOn(date: string) {
  const { from, to } = staffDayWindow(date);
  const [leaves, outRows, staffDays] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { status: "ACTIVE", teacherId: { not: null }, from: { lte: date }, to: { gte: date } },
      select: { id: true, teacherId: true, halfDay: true, type: { select: { name: true } } },
    }),
    prisma.substituteAssignment.findMany({
      where: { date, leaveRequestId: null, reason: { in: ["ABSENT", "DUTY"] }, absentTeacherId: { not: null } },
      select: { absentTeacherId: true, reason: true },
    }),
    prisma.staffDay.findMany({
      where: { teacherId: { not: null }, date: { gte: from, lte: to } },
      select: { teacherId: true, status: true, date: true },
    }),
  ]);
  const out = new Map<string, { why: string; leaveRequestId: string | null; halfDay: boolean }>();
  for (const leave of leaves) {
    out.set(leave.teacherId as string, {
      why: `${leave.type.name}${leave.halfDay ? " (half day)" : ""}`,
      leaveRequestId: leave.id,
      halfDay: Boolean(leave.halfDay),
    });
  }
  for (const row of staffDays) {
    if (!row.teacherId || out.has(row.teacherId) || staffDayYmd(row.date) !== date) continue;
    if (OUT_MARKS.has(row.status)) out.set(row.teacherId, { why: row.status === "LEAVE" ? "On leave" : "Absent", leaveRequestId: null, halfDay: false });
  }
  for (const row of outRows) {
    const id = row.absentTeacherId as string;
    if (!out.has(id)) out.set(id, { why: row.reason === "DUTY" ? "On duty" : "Absent", leaveRequestId: null, halfDay: false });
  }
  return out;
}

/**
 * Who should take a class's attendance on a date, best first: whoever teaches the class's first
 * period that day, then teachers who teach the class, then everyone else who is in.
 */
async function attendanceCandidates(date: string, classId: string, out: Map<string, unknown>) {
  const weekday = weekdayOfYmd(date);
  const [slots, changes, teachers] = await Promise.all([
    prisma.timetableSlot.findMany({ where: { classId, weekday }, include: { period: true } }),
    prisma.substituteAssignment.findMany({ where: { date, slot: { classId } }, select: { slotId: true, status: true, substituteId: true } }),
    prisma.teacher.findMany({
      select: {
        id: true,
        classId: true,
        user: { select: { name: true } },
        classes: { select: { classId: true } },
        subjects: { select: { classId: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
  ]);
  const changeBySlot = new Map(changes.map((c) => [c.slotId, c]));
  const firstPeriodTeacher = slots
    .filter((s) => !s.period.isBreak)
    .sort((a, b) => a.period.sortOrder - b.period.sortOrder)
    .map((slot) => {
      const change = changeBySlot.get(slot.id);
      if (change) return change.status === "COVERED" ? change.substituteId : null;
      return slot.teacherId && !out.has(slot.teacherId) ? slot.teacherId : null;
    })
    .find(Boolean);
  const teachesClass = (t: (typeof teachers)[number]) =>
    t.classes.some((c) => c.classId === classId) || t.subjects.some((s) => s.classId === classId) || slots.some((s) => s.teacherId === t.id);
  return teachers
    .filter((t) => !out.has(t.id) && t.classId !== classId)
    .map((t) => {
      const tier = t.id === firstPeriodTeacher ? 1 : teachesClass(t) ? 2 : 3;
      const hint = tier === 1 ? "1st period in this class" : tier === 2 ? "Teaches this class" : "";
      return { id: t.id, name: t.user.name, tier, hint };
    })
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

export type DayGap = {
  teacherId: string;
  teacherName: string;
  why: string;
  periods: number;
  openPeriods: number;
  classId: string;
  classLabel: string;
  /** Class teacher only: who takes attendance that day (null = nobody yet). */
  attendanceBy: { id: string; name: string } | null;
  attendanceDone: boolean;
  candidates: { id: string; name: string; hint: string }[];
};

/** Office list of teachers out on a date with what still needs doing. Only teachers with something open are returned. */
export async function dayGaps(user: AccessUser, input: { date?: string } = {}) {
  const date = cleanDate(input.date || schoolToday());
  const cal = await loadSchoolCalendar();
  const closed = closedReason(date, cal);
  if (closed || !can(user, "timetable.edit")) return { date, closed: closed || "", gaps: [] as DayGap[] };
  const out = await teachersOutOn(date);
  if (!out.size) return { date, closed: "", gaps: [] as DayGap[] };
  const team = scopeFor(user, "timetable.edit") === "REPORTS" ? await teamClassIds(user.id) : null;
  const weekday = weekdayOfYmd(date);
  const ids = [...out.keys()];
  const [teachers, slots, changes, covers] = await Promise.all([
    prisma.teacher.findMany({
      where: { id: { in: ids } },
      select: { id: true, classId: true, user: { select: { name: true } }, class: { select: { id: true, name: true, section: true } } },
    }),
    prisma.timetableSlot.findMany({ where: { teacherId: { in: ids }, weekday }, include: { period: true } }),
    prisma.substituteAssignment.findMany({ where: { date }, select: { slotId: true, status: true } }),
    prisma.classAttendanceCover.findMany({ where: { date }, include: { teacher: { select: { id: true, user: { select: { name: true } } } } } }),
  ]);
  const changeBySlot = new Map(changes.map((c) => [c.slotId, c]));
  const coverByClass = new Map(covers.map((c) => [c.classId, c]));
  // A class with another class teacher who is in that day needs no hand-over.
  const classIds = [...new Set(teachers.map((t) => t.classId).filter(Boolean))] as string[];
  const coClassTeachers = classIds.length
    ? await prisma.teacher.findMany({ where: { classId: { in: classIds } }, select: { id: true, classId: true } })
    : [];
  const classTeacherIn = (classId: string) => coClassTeachers.some((t) => t.classId === classId && !out.has(t.id));
  const gaps: DayGap[] = [];
  for (const teacher of teachers) {
    const mine = slots.filter((s) => s.teacherId === teacher.id && !s.period.isBreak && (!team || team.includes(s.classId)));
    const openPeriods = mine.filter((s) => {
      const change = changeBySlot.get(s.id);
      return !change || change.status === "OPEN";
    }).length;
    const classId =
      teacher.classId && (!team || team.includes(teacher.classId)) && !classTeacherIn(teacher.classId) ? teacher.classId : "";
    let attendanceBy: DayGap["attendanceBy"] = null;
    let attendanceDone = false;
    let candidates: DayGap["candidates"] = [];
    if (classId) {
      const cover = coverByClass.get(classId);
      attendanceBy = cover ? { id: cover.teacher.id, name: cover.teacher.user.name } : null;
      const { from, to } = staffDayWindow(date);
      attendanceDone = (await prisma.attendance.count({ where: { date: { gte: from, lte: to }, student: { classId } } })) > 0;
      if (!attendanceBy && !attendanceDone) {
        candidates = (await attendanceCandidates(date, classId, out)).map(({ id, name, hint }) => ({ id, name, hint }));
      }
    }
    const classPending = Boolean(classId) && !attendanceBy && !attendanceDone;
    if (!openPeriods && !classPending) continue;
    gaps.push({
      teacherId: teacher.id,
      teacherName: teacher.user.name,
      why: out.get(teacher.id)?.why || "Absent",
      periods: mine.length,
      openPeriods,
      classId,
      classLabel: teacher.class ? `${teacher.class.name}-${teacher.class.section}` : "",
      attendanceBy,
      attendanceDone,
      candidates,
    });
  }
  gaps.sort((a, b) => a.teacherName.localeCompare(b.teacherName));
  return { date, closed: "", gaps };
}

/** Hand a class's attendance on one date to a teacher (replaces an earlier pick for that date). */
export async function assignAttendanceCover(user: AccessUser, input: { date?: string; classId?: string; teacherId?: string }) {
  const date = cleanDate(input.date);
  const classId = String(input.classId || "");
  const teacherId = String(input.teacherId || "");
  if (!classId) throw new Error("Pick a class");
  if (!teacherId) throw new Error("Pick who takes attendance");
  await needCoverEdit(user, classId);
  if (date < schoolToday()) throw new Error("Past days cannot be changed.");
  const closed = closedReason(date, await loadSchoolCalendar());
  if (closed) throw new Error(`School is closed ${prettyDay(date)} (${closed}).`);
  const [klass, teacher, classTeachers] = await Promise.all([
    prisma.class.findUnique({ where: { id: classId }, select: { name: true, section: true } }),
    prisma.teacher.findUnique({ where: { id: teacherId }, select: { id: true, classId: true, user: { select: { name: true } } } }),
    prisma.teacher.findMany({ where: { classId }, select: { id: true, user: { select: { name: true } } } }),
  ]);
  if (!klass) throw new Error("Class not found");
  if (!teacher) throw new Error("Teacher not found");
  if (teacher.classId === classId) throw new Error(`${teacher.user.name} is already this class's teacher.`);
  const out = await teachersOutOn(date);
  if (out.has(teacherId)) throw new Error(`${teacher.user.name} is out ${whenText(date)}.`);
  const classTeacher = classTeachers.find((t) => out.has(t.id)) || classTeachers[0] || null;
  const leaveRequestId = classTeacher ? out.get(classTeacher.id)?.leaveRequestId || null : null;
  const before = await prisma.classAttendanceCover.findUnique({ where: { date_classId: { date, classId } } });
  const data = { teacherId, absentTeacherId: classTeacher?.id || null, leaveRequestId, assignedById: user.id };
  await prisma.classAttendanceCover.upsert({
    where: { date_classId: { date, classId } },
    update: data,
    create: { ...data, date, classId },
  });
  const label = `${klass.name}-${klass.section}`;
  if (before?.teacherId !== teacherId) {
    await noticeTeacher(
      user.id,
      teacherId,
      `Attendance ${whenText(date)}: ${label}`,
      `You take ${label}'s attendance ${whenText(date)}${classTeacher ? ` for ${classTeacher.user.name}` : ""}. Open Attendance and pick ${label}.`,
      `${classId}:${date}:${teacherId}`
    );
  }
  if (before && before.teacherId !== teacherId) {
    await noticeTeacher(user.id, before.teacherId, `Attendance cancelled: ${label}`, `You no longer take ${label}'s attendance ${whenText(date)}.`, `${classId}:${date}:cancel`);
  }
  return { ok: true as const };
}

/** Take back a one-day attendance hand-over. */
export async function clearAttendanceCover(user: AccessUser, input: { date?: string; classId?: string }) {
  const date = cleanDate(input.date);
  const classId = String(input.classId || "");
  await needCoverEdit(user, classId);
  const row = await prisma.classAttendanceCover.findUnique({
    where: { date_classId: { date, classId } },
    include: { class: { select: { name: true, section: true } } },
  });
  if (!row) return { ok: true as const };
  await prisma.classAttendanceCover.delete({ where: { id: row.id } });
  const label = `${row.class.name}-${row.class.section}`;
  await noticeTeacher(user.id, row.teacherId, `Attendance cancelled: ${label}`, `You no longer take ${label}'s attendance ${whenText(date)}.`, `${classId}:${date}:cancel`);
  return { ok: true as const };
}

/** Class teacher is back on a date: drop that day's hand-over (leave hand-overs go with the leave). */
export async function clearAttendanceCoversFor(authorId: string, absentTeacherId: string, date: string) {
  const rows = await prisma.classAttendanceCover.findMany({
    where: { date, absentTeacherId, leaveRequestId: null },
    include: { class: { select: { name: true, section: true } } },
  });
  for (const row of rows) {
    await prisma.classAttendanceCover.delete({ where: { id: row.id } });
    const label = `${row.class.name}-${row.class.section}`;
    await noticeTeacher(authorId, row.teacherId, `Attendance cancelled: ${label}`, `${label}'s class teacher is back. You no longer take its attendance ${whenText(date)}.`, `${row.classId}:${date}:back`);
  }
  return rows.length;
}

/** Classes handed to this teacher for attendance on a date. */
export async function attendanceCoversFor(teacherId: string, date = schoolToday()) {
  return prisma.classAttendanceCover.findMany({
    where: { teacherId, date },
    include: { class: { select: { id: true, name: true, section: true } } },
  });
}

/**
 * Teacher logins may save attendance only for their own class, or a class handed to them for that date.
 * Office logins (people.edit / timetable.edit) and non-teacher portals keep their current access.
 */
export async function assertAttendanceClasses(user: AccessUser, date: string, studentIds: string[]) {
  if (user.portal !== "TEACHER" || can(user, "people.edit") || !studentIds.length) return;
  const teacher = await prisma.teacher.findUnique({ where: { userId: user.id }, select: { id: true, classId: true } });
  const allowed = new Set<string>();
  if (teacher?.classId) allowed.add(teacher.classId);
  if (teacher) for (const row of await attendanceCoversFor(teacher.id, date)) allowed.add(row.classId);
  const students = await prisma.student.findMany({ where: { id: { in: [...new Set(studentIds)] } }, select: { classId: true } });
  if (students.length !== new Set(studentIds).size || students.some((s) => !s.classId || !allowed.has(s.classId))) {
    throw new Error("You can only mark attendance for your own class, or a class given to you for that day.");
  }
}
