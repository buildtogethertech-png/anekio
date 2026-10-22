/**
 * Routine → "Fill all classes": school-wide check, preview and apply.
 * The solver (timetable-solver.ts) is pure; this file reads the database and saves the result.
 * Hand-placed periods are always kept. Apply saves in one transaction; Undo deletes only what Apply created.
 */
import { prisma } from "./prisma";
import { can, scopeFor, type AccessUser } from "./permissions";
import { parseWeekdays, WEEKDAY_SHORT } from "./schedule";
import { formatSubjectLabel, skillMatchesSubject } from "./subject-code";
import { checkTimetable, fillTimetable, type Placement, type SolverInput } from "./timetable-solver";

function needSchoolEdit(user: AccessUser) {
  if (!can(user, "timetable.edit")) throw new Error("Only the office can change the timetable.");
  if (scopeFor(user, "timetable.edit") !== "SCHOOL") throw new Error("Filling the whole school needs school-wide routine access.");
}

async function loadInput(): Promise<SolverInput & { names: { teachers: Map<string, string>; classes: Map<string, string>; subjects: Map<string, string>; periods: Map<string, string> } }> {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { weekdays: true } });
  const days = parseWeekdays(config?.weekdays);
  const [periods, classes, teachers, slots] = await Promise.all([
    prisma.period.findMany({ where: { isBreak: false }, orderBy: { sortOrder: "asc" } }),
    prisma.class.findMany({ where: { archivedAt: null }, include: { subjects: true }, orderBy: [{ name: "asc" }, { section: "asc" }] }),
    prisma.teacher.findMany({ include: { user: { select: { name: true } }, skills: true }, orderBy: { user: { name: "asc" } } }),
    prisma.timetableSlot.findMany({ where: { weekday: { in: days } }, select: { classId: true, weekday: true, periodId: true, subjectId: true, teacherId: true } }),
  ]);
  const periodIds = new Set(periods.map((p) => p.id));
  const classIds = new Set(classes.map((c) => c.id));
  return {
    days,
    dayLabels: Object.fromEntries(days.map((d) => [d, WEEKDAY_SHORT[d] || String(d)])),
    periods: periods.map((p) => ({ id: p.id, name: p.name })),
    teachers: teachers.map((t) => ({ id: t.id, name: t.user.name })),
    classes: classes.map((c) => ({
      id: c.id,
      label: `${c.name}-${c.section}`,
      subjects: c.subjects
        .filter((s) => s.weightage > 0)
        .map((s) => ({
          id: s.id,
          label: formatSubjectLabel(s.code, s.name),
          need: s.weightage,
          eligible: teachers.filter((t) => t.skills.some((k) => k.classId === c.id && skillMatchesSubject(k.subjectName, s))).map((t) => t.id),
          preferred: s.teacherId,
        })),
    })),
    existing: slots
      .filter((s) => periodIds.has(s.periodId) && classIds.has(s.classId))
      .map((s) => ({ classId: s.classId, day: s.weekday, periodId: s.periodId, subjectId: s.subjectId, teacherId: s.teacherId })),
    names: {
      teachers: new Map(teachers.map((t) => [t.id, t.user.name])),
      classes: new Map(classes.map((c) => [c.id, `${c.name}-${c.section}`])),
      subjects: new Map(classes.flatMap((c) => c.subjects.map((s) => [s.id, formatSubjectLabel(s.code, s.name)] as const))),
      periods: new Map(periods.map((p) => [p.id, p.name])),
    },
  };
}

/** Check + a full preview. Nothing is saved. */
export async function previewTimetableFill(user: AccessUser) {
  needSchoolEdit(user);
  const input = await loadInput();
  const check = checkTimetable(input);
  const filled = input.existing.length;
  if (!check.needed) return { check, filled, preview: null };
  const result = fillTimetable(input);
  const perClass = input.classes.map((c) => ({
    classId: c.id,
    label: c.label,
    adding: result.placements.filter((p) => p.classId === c.id).length,
    missing: result.unplaced.filter((u) => u.classId === c.id).reduce((n, u) => n + u.count, 0),
  }));
  const split = new Set(
    result.placements
      .map((p) => `${p.classId}|${p.subjectId}`)
      .filter((k, i, all) => all.indexOf(k) === i)
      .filter((k) => new Set(result.placements.filter((p) => `${p.classId}|${p.subjectId}` === k).map((p) => p.teacherId)).size > 1)
  );
  return {
    check,
    filled,
    preview: {
      needed: result.needed,
      placed: result.placed,
      perClass: perClass.filter((c) => c.adding || c.missing),
      unplaced: result.unplaced.map((u) => ({ ...u, teacher: input.names.teachers.get(u.teacherId) || "" })),
      splitSubjects: [...split].map((k) => {
        const [classId, subjectId] = k.split("|");
        return `${input.names.classes.get(classId)} ${input.names.subjects.get(subjectId)}`;
      }),
      placements: result.placements,
    },
  };
}

/** Save a previewed fill. Every period is re-checked against the timetable as it is now. */
export async function applyTimetableFill(user: AccessUser, input: { placements?: Placement[] }) {
  needSchoolEdit(user);
  const wanted = Array.isArray(input.placements) ? input.placements.slice(0, 5000) : [];
  if (!wanted.length) throw new Error("Nothing to add.");
  const fresh = await loadInput();
  const days = new Set(fresh.days);
  const periodIds = new Set(fresh.periods.map((p) => p.id));
  const classBusy = new Set(fresh.existing.map((s) => `${s.classId}|${s.day}|${s.periodId}`));
  const teacherBusy = new Set(fresh.existing.filter((s) => s.teacherId).map((s) => `${s.teacherId}|${s.day}|${s.periodId}`));
  const count = new Map<string, number>();
  for (const s of fresh.existing) if (s.subjectId) count.set(`${s.classId}|${s.subjectId}`, (count.get(`${s.classId}|${s.subjectId}`) || 0) + 1);
  const rows: { classId: string; weekday: number; periodId: string; subjectId: string; teacherId: string }[] = [];
  for (const p of wanted) {
    const klass = fresh.classes.find((c) => c.id === String(p.classId));
    const subject = klass?.subjects.find((s) => s.id === String(p.subjectId));
    const day = Number(p.day);
    const ck = `${p.classId}|${day}|${p.periodId}`;
    const tk = `${p.teacherId}|${day}|${p.periodId}`;
    const sk = `${p.classId}|${p.subjectId}`;
    if (!klass || !subject || !days.has(day) || !periodIds.has(String(p.periodId))) throw new Error("The timetable changed since the preview. Run Fill again.");
    if (!subject.eligible.includes(String(p.teacherId))) throw new Error("A teacher's subjects changed since the preview. Run Fill again.");
    if (classBusy.has(ck) || teacherBusy.has(tk)) throw new Error("Someone changed the timetable since the preview. Run Fill again.");
    if ((count.get(sk) || 0) >= subject.need) throw new Error("Subject periods changed since the preview. Run Fill again.");
    classBusy.add(ck);
    teacherBusy.add(tk);
    count.set(sk, (count.get(sk) || 0) + 1);
    rows.push({ classId: klass.id, weekday: day, periodId: String(p.periodId), subjectId: subject.id, teacherId: String(p.teacherId) });
  }
  // Link each subject to its main teacher when it has none yet (same as placing by hand).
  const mainTeacher = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = mainTeacher.get(r.subjectId) || new Map<string, number>();
    m.set(r.teacherId, (m.get(r.teacherId) || 0) + 1);
    mainTeacher.set(r.subjectId, m);
  }
  const created = await prisma.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const r of rows) ids.push((await tx.timetableSlot.create({ data: r, select: { id: true } })).id);
    for (const [subjectId, m] of mainTeacher) {
      const top = [...m].sort((a, b) => b[1] - a[1])[0][0];
      await tx.subject.updateMany({ where: { id: subjectId, teacherId: null }, data: { teacherId: top } });
    }
    return ids;
  });
  return { ok: true as const, added: created.length, undoIds: created };
}

/** Undo the last fill: delete exactly the periods it created. */
export async function undoTimetableFill(user: AccessUser, input: { ids?: string[] }) {
  needSchoolEdit(user);
  const ids = Array.isArray(input.ids) ? input.ids.map(String).slice(0, 5000) : [];
  if (!ids.length) return { ok: true as const, removed: 0 };
  const res = await prisma.timetableSlot.deleteMany({ where: { id: { in: ids } } });
  return { ok: true as const, removed: res.count };
}

type SlotSnapshot = {
  id: string;
  classId: string;
  periodId: string;
  weekday: number;
  subjectId: string | null;
  teacherId: string | null;
  roomId: string | null;
};
type ChangeSnapshot = {
  id: string;
  leaveRequestId: string | null;
  date: string;
  slotId: string;
  substituteId: string | null;
  status: string;
  reason: string;
  subjectId: string | null;
  absentTeacherId: string | null;
  note: string;
  assignedById: string;
};

async function clearScope(user: AccessUser, classId: string) {
  if (!classId) {
    needSchoolEdit(user);
    return {};
  }
  if (!can(user, "timetable.edit")) throw new Error("Only the office can change the timetable.");
  if (scopeFor(user, "timetable.edit") === "REPORTS") {
    const { teamClassIds } = await import("./reports");
    if (!(await teamClassIds(user.id)).includes(classId)) throw new Error("No access to this class.");
  }
  return { classId };
}

/** How much a clear would remove (for the confirm box). */
export async function countTimetableClear(user: AccessUser, input: { classId?: string }) {
  const where = await clearScope(user, String(input.classId || ""));
  const [periods, changes] = await Promise.all([
    prisma.timetableSlot.count({ where }),
    prisma.substituteAssignment.count({ where: { slot: where } }),
  ]);
  return { periods, changes };
}

/**
 * Clear the weekly timetable of one class (classId) or the whole school.
 * Returns a snapshot so Undo can put back exactly the same periods (same ids) and their one-day changes.
 */
export async function clearTimetable(user: AccessUser, input: { classId?: string }) {
  const where = await clearScope(user, String(input.classId || ""));
  const slots = await prisma.timetableSlot.findMany({
    where,
    select: { id: true, classId: true, periodId: true, weekday: true, subjectId: true, teacherId: true, roomId: true },
  });
  if (!slots.length) return { ok: true as const, removed: 0, snapshot: { slots: [] as SlotSnapshot[], changes: [] as ChangeSnapshot[] } };
  const ids = slots.map((s) => s.id);
  const changes = await prisma.substituteAssignment.findMany({
    where: { slotId: { in: ids } },
    select: {
      id: true,
      leaveRequestId: true,
      date: true,
      slotId: true,
      substituteId: true,
      status: true,
      reason: true,
      subjectId: true,
      absentTeacherId: true,
      note: true,
      assignedById: true,
    },
  });
  // One-day changes go with their period (cascade); they are in the snapshot for Undo.
  await prisma.timetableSlot.deleteMany({ where: { id: { in: ids } } });
  return { ok: true as const, removed: slots.length, snapshot: { slots: slots as SlotSnapshot[], changes: changes as ChangeSnapshot[] } };
}

/** Undo a clear: recreate the same periods (same ids) wherever the cell is still empty. */
export async function restoreTimetable(user: AccessUser, input: { snapshot?: { slots?: SlotSnapshot[]; changes?: ChangeSnapshot[] } }) {
  const slots = (input.snapshot?.slots || []).slice(0, 10000);
  const changes = (input.snapshot?.changes || []).slice(0, 20000);
  if (!slots.length) return { ok: true as const, restored: 0, skipped: 0 };
  const classIds = [...new Set(slots.map((s) => String(s.classId)))];
  if (classIds.length === 1) await clearScope(user, classIds[0]);
  else needSchoolEdit(user);
  const [classes, periods, teachers, subjects, taken] = await Promise.all([
    prisma.class.findMany({ where: { id: { in: classIds } }, select: { id: true } }),
    prisma.period.findMany({ select: { id: true } }),
    prisma.teacher.findMany({ select: { id: true } }),
    prisma.subject.findMany({ where: { classId: { in: classIds } }, select: { id: true } }),
    prisma.timetableSlot.findMany({ where: { classId: { in: classIds } }, select: { id: true, classId: true, periodId: true, weekday: true } }),
  ]);
  const has = (list: { id: string }[]) => new Set(list.map((x) => x.id));
  const [okClass, okPeriod, okTeacher, okSubject] = [has(classes), has(periods), has(teachers), has(subjects)];
  const busy = new Set(taken.map((s) => `${s.classId}|${s.periodId}|${s.weekday}`));
  const usedIds = has(taken);
  const back: SlotSnapshot[] = [];
  for (const s of slots) {
    const key = `${s.classId}|${s.periodId}|${s.weekday}`;
    if (!okClass.has(s.classId) || !okPeriod.has(s.periodId) || busy.has(key) || usedIds.has(s.id)) continue;
    busy.add(key);
    back.push({
      id: String(s.id),
      classId: s.classId,
      periodId: s.periodId,
      weekday: Number(s.weekday),
      subjectId: s.subjectId && okSubject.has(s.subjectId) ? s.subjectId : null,
      teacherId: s.teacherId && okTeacher.has(s.teacherId) ? s.teacherId : null,
      roomId: s.roomId || null,
    });
  }
  const backIds = new Set(back.map((s) => s.id));
  const keep = changes.filter((c) => backIds.has(c.slotId));
  const [leaves, users, existingChanges] = await Promise.all([
    prisma.leaveRequest.findMany({ where: { id: { in: keep.map((c) => c.leaveRequestId).filter((x): x is string => Boolean(x)) } }, select: { id: true } }),
    prisma.user.findMany({ where: { id: { in: [...new Set(keep.map((c) => c.assignedById))] } }, select: { id: true } }),
    prisma.substituteAssignment.findMany({ where: { id: { in: keep.map((c) => c.id) } }, select: { id: true } }),
  ]);
  const [okLeave, okUser, takenChange] = [has(leaves), has(users), has(existingChanges)];
  await prisma.$transaction(async (tx) => {
    for (const s of back) await tx.timetableSlot.create({ data: s });
    for (const c of keep) {
      if (takenChange.has(c.id)) continue;
      await tx.substituteAssignment.create({
          data: {
            id: c.id,
            leaveRequestId: c.leaveRequestId && okLeave.has(c.leaveRequestId) ? c.leaveRequestId : null,
            date: c.date,
            slotId: c.slotId,
            substituteId: c.substituteId && okTeacher.has(c.substituteId) ? c.substituteId : null,
            status: c.substituteId && !okTeacher.has(c.substituteId) ? "OPEN" : c.status,
            reason: c.reason,
            subjectId: c.subjectId,
            absentTeacherId: c.absentTeacherId,
            note: c.note,
            assignedById: okUser.has(c.assignedById) ? c.assignedById : user.id,
          },
        });
    }
  });
  return { ok: true as const, restored: back.length, skipped: slots.length - back.length };
}
