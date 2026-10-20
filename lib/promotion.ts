import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";
import { createNextSchoolSession, ensureSchoolSessions, sessionLabel } from "./school-session";
import { ensureCurrentSessionStudentRollNumbers } from "./student-rolls";

/**
 * School-year rollover.
 *
 * 1. "Prepare next year" creates the next SchoolSession WITHOUT making it current.
 * 2. The office decides, per class, what happens to each student (PromotionDecision rows; undecided = default).
 * 3. "Make current" applies every decision in one transaction: new-year enrollments (roll numbers A→Z per class),
 *    Student.classId moves, leavers / pass-outs are archived (leftOn), then the new session becomes current.
 *
 * History stays: old-year enrollments, attendance, marks and fees are never touched.
 */

export type PromotionOutcome = "PROMOTE" | "DETAIN" | "LEAVE" | "PASS_OUT";
const OUTCOMES = new Set<PromotionOutcome>(["PROMOTE", "DETAIN", "LEAVE", "PASS_OUT"]);
const PAST_CLASS = { name: "Past students", section: "—" };
const JOINING_CLASS = { name: "Joining next year", section: "—" };
/** Admitted in the last 3 months of the year: flagged on the promotion board (they may not be ready to move up). */
const LATE_ADMISSION_DAYS = 90;
const LOW_ATTENDANCE = 75;

function needSchoolEdit(user: AccessUser) {
  if (!can(user, "school.edit")) throw new Error("You need permission to change school settings.");
}

const PRE_PRIMARY: Record<string, number> = {
  playgroup: -4, "play group": -4, pg: -4, prenursery: -4, "pre nursery": -4, "pre-nursery": -4,
  nursery: -3, nur: -3, lkg: -2, kg1: -2, "kg 1": -2, "kg-1": -2, kg: -2, pp1: -2,
  ukg: -1, kg2: -1, "kg 2": -1, "kg-2": -1, pp2: -1,
};
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

/** Grade order for a class name: "Nursery" < "LKG" < "UKG" < "1" < "Class 2" < "IX" < "11 Science". null = unknown. */
export function gradeRank(name: string): number | null {
  const raw = String(name || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw in PRE_PRIMARY) return PRE_PRIMARY[raw];
  const cleaned = raw.replace(/^(class|grade|std\.?|standard)\s*/, "").trim();
  if (cleaned in PRE_PRIMARY) return PRE_PRIMARY[cleaned];
  const num = cleaned.match(/^(\d{1,2})(st|nd|rd|th)?\b/);
  if (num) return Number(num[1]);
  const roman = cleaned.match(/^([ivx]+)\b/);
  if (roman && ROMAN[roman[1]]) return ROMAN[roman[1]];
  return null;
}

type ClassLite = { id: string; name: string; section: string };

export function classLabel(c: { name: string; section: string }) {
  return c.section && c.section !== "—" ? `${c.name}-${c.section}` : c.name;
}

/** Where a student of `from` goes next year by default. null = top class (passes out). */
export function defaultNextClass(from: ClassLite, classes: ClassLite[]): ClassLite | null {
  const rank = gradeRank(from.name);
  if (rank == null) return null;
  const higher = classes
    .map((c) => ({ c, r: gradeRank(c.name) }))
    .filter((x): x is { c: ClassLite; r: number } => x.r != null && x.r > rank);
  if (!higher.length) return null;
  const nextRank = Math.min(...higher.map((x) => x.r));
  const options = higher.filter((x) => x.r === nextRank).map((x) => x.c);
  return (
    options.find((c) => c.section.toLowerCase() === from.section.toLowerCase()) ??
    options.sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name))[0]
  );
}

function sortClasses<T extends ClassLite>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const ra = gradeRank(a.name);
    const rb = gradeRank(b.name);
    if (ra != null && rb != null && ra !== rb) return ra - rb;
    if (ra == null && rb != null) return 1;
    if (ra != null && rb == null) return -1;
    return a.name.localeCompare(b.name) || a.section.localeCompare(b.section);
  });
}

async function liveClasses() {
  const rows = await prisma.class.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true, section: true },
  });
  return sortClasses(rows);
}

/** The prepared (future, not current) session, if any. */
async function preparedSession() {
  const { sessions, current } = await ensureSchoolSessions();
  const next = sessions
    .filter((s) => !s.current && s.startsOn > current.startsOn)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
  return { current, next: next ?? null };
}

export async function prepareNextYearCore(user: AccessUser, input: { startsOn?: string; endsOn?: string } = {}) {
  needSchoolEdit(user);
  const { next } = await preparedSession();
  if (next) return { sessionId: next.id, label: next.label, existed: true };
  const created = await createNextSchoolSession({
    makeCurrent: false,
    startsOn: String(input.startsOn || "").trim() || undefined,
    endsOn: String(input.endsOn || "").trim() || undefined,
  });
  return { sessionId: created.id, label: created.label, existed: false };
}

export type PromotionStudentRow = {
  id: string;
  name: string;
  admissionNo: string;
  rollNumber: number | null;
  attendancePct: number | null;
  outcome: PromotionOutcome;
  toClassId: string | null;
  provisional: boolean;
  note: string;
  decided: boolean;
  flags: string[];
};

export type PromotionClassCard = {
  id: string;
  label: string;
  defaultToClassId: string | null;
  defaultToLabel: string;
  students: PromotionStudentRow[];
  decided: number;
  toCheck: number;
  done: boolean;
};

export async function promotionBoardCore(user: AccessUser) {
  needSchoolEdit(user);
  const { current, next } = await preparedSession();
  const classes = await liveClasses();
  const pastCount = await prisma.student.count({ where: { leftOn: { not: null } } });
  if (!next) {
    return {
      current: { id: current.id, label: current.label, startsOn: current.startsOn, endsOn: current.endsOn },
      next: null,
      undo: await undoState(current),
      classes: [] as PromotionClassCard[],
      targets: classes.map((c) => ({ id: c.id, label: classLabel(c), rank: gradeRank(c.name) })),
      totals: { students: 0, promote: 0, detain: 0, leave: 0, passOut: 0, classesDone: 0, classes: 0, toCheck: 0 },
      pastCount,
      joining: { total: 0, byClass: [] as { label: string; count: number }[] },
    };
  }

  await ensureCurrentSessionStudentRollNumbers().catch(() => undefined);
  const [students, decisions, enrollments, attendance] = await Promise.all([
    prisma.student.findMany({
      where: { classId: { in: classes.map((c) => c.id) } },
      select: { id: true, name: true, admissionNo: true, classId: true, admittedAt: true },
      orderBy: { name: "asc" },
    }),
    prisma.promotionDecision.findMany({ where: { sessionId: next.id } }),
    prisma.studentClassEnrollment.findMany({
      where: { sessionId: current.id },
      select: { studentId: true, rollNumber: true },
    }),
    prisma.attendance.groupBy({
      by: ["studentId", "status"],
      where: {
        date: { gte: new Date(`${current.startsOn}T00:00:00`), lte: new Date(`${current.endsOn}T23:59:59`) },
      },
      _count: { _all: true },
    }),
  ]);

  const decisionBy = new Map(decisions.map((d) => [d.studentId, d]));
  const lateFrom = new Date(new Date(`${current.endsOn}T00:00:00`).getTime() - LATE_ADMISSION_DAYS * 86_400_000);
  const rollBy = new Map(enrollments.map((e) => [e.studentId, e.rollNumber]));
  const att = new Map<string, { present: number; total: number }>();
  for (const row of attendance) {
    const a = att.get(row.studentId) ?? { present: 0, total: 0 };
    const n = row._count._all;
    a.total += n;
    if (row.status === "PRESENT" || row.status === "LATE") a.present += n;
    else if (row.status === "HALF_DAY") a.present += n / 2;
    else if (row.status === "LEAVE") a.total -= n;
    att.set(row.studentId, a);
  }

  const byClass = new Map<string, typeof students>();
  for (const s of students) byClass.set(s.classId, [...(byClass.get(s.classId) ?? []), s]);
  const classById = new Map(classes.map((c) => [c.id, c]));

  const totals = { students: 0, promote: 0, detain: 0, leave: 0, passOut: 0, classesDone: 0, classes: 0, toCheck: 0 };
  const cards: PromotionClassCard[] = [];
  for (const c of classes) {
    const list = byClass.get(c.id) ?? [];
    if (!list.length) continue;
    // Unknown class names ("Sports batch") never pass out by accident: they stay in their class by default.
    const unknown = gradeRank(c.name) == null;
    const target = unknown ? c : defaultNextClass(c, classes);
    const defaultOutcome: PromotionOutcome = unknown ? "DETAIN" : target ? "PROMOTE" : "PASS_OUT";
    const rows: PromotionStudentRow[] = list.map((s) => {
      const d = decisionBy.get(s.id);
      const a = att.get(s.id);
      const pct = a && a.total > 0 ? Math.round((a.present / a.total) * 100) : null;
      const flags: string[] = [];
      if (pct != null && pct < LOW_ATTENDANCE) flags.push(`Attendance ${pct}%`);
      if (s.admittedAt && s.admittedAt >= lateFrom) flags.push(`Joined ${s.admittedAt.toISOString().slice(0, 10).split("-").reverse().join("/")}`);
      const outcome = (d?.outcome as PromotionOutcome) || defaultOutcome;
      const toClassId = d
        ? d.toClassId && classById.has(d.toClassId) ? d.toClassId : outcome === "DETAIN" ? c.id : outcome === "PROMOTE" ? target?.id ?? null : null
        : target?.id ?? null;
      return {
        id: s.id,
        name: s.name,
        admissionNo: s.admissionNo,
        rollNumber: rollBy.get(s.id) ?? null,
        attendancePct: pct,
        outcome,
        toClassId,
        provisional: Boolean(d?.provisional),
        note: d?.note ?? "",
        decided: Boolean(d),
        flags,
      };
    });
    const decided = rows.filter((r) => r.decided).length;
    const toCheck = rows.filter((r) => r.flags.length && !r.decided).length;
    const done = decided === rows.length;
    cards.push({
      id: c.id,
      label: classLabel(c),
      defaultToClassId: target?.id ?? null,
      defaultToLabel: unknown ? `Stays in ${classLabel(c)}` : target ? classLabel(target) : "Pass out",
      students: rows,
      decided,
      toCheck,
      done,
    });
    totals.classes += 1;
    if (done) totals.classesDone += 1;
    totals.toCheck += toCheck;
    for (const r of rows) {
      totals.students += 1;
      if (r.outcome === "PROMOTE") totals.promote += 1;
      else if (r.outcome === "DETAIN") totals.detain += 1;
      else if (r.outcome === "LEAVE") totals.leave += 1;
      else totals.passOut += 1;
    }
  }

  return {
    current: { id: current.id, label: current.label, startsOn: current.startsOn, endsOn: current.endsOn },
    next: { id: next.id, label: next.label, startsOn: next.startsOn, endsOn: next.endsOn },
    undo: null as UndoState | null,
    classes: cards,
    targets: classes.map((c) => ({ id: c.id, label: classLabel(c), rank: gradeRank(c.name) })),
    totals,
    pastCount,
    joining: await joiningSummary(next.id, classes),
  };
}

/** Students admitted for the prepared year, per class they will start in. */
async function joiningSummary(sessionId: string, classes: ClassLite[]) {
  const rows = await prisma.student.findMany({
    where: { joinsSessionId: sessionId, leftOn: null },
    select: { id: true, name: true, joinsClassId: true },
  });
  const byId = new Map(classes.map((c) => [c.id, classLabel(c)]));
  const counts = new Map<string, number>();
  for (const r of rows) {
    const label = (r.joinsClassId && byId.get(r.joinsClassId)) || "No class";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return { total: rows.length, byClass: [...counts.entries()].map(([label, count]) => ({ label, count })) };
}

async function holdingClassId(db: typeof prisma, spec: { name: string; section: string }) {
  const found = await db.class.findFirst({ where: { name: spec.name, section: spec.section }, select: { id: true } });
  if (found) return found.id;
  const created = await db.class.create({ data: { name: spec.name, section: spec.section, archivedAt: new Date() }, select: { id: true } });
  return created.id;
}

/** The prepared next year; prepares it now if nobody has yet (admitting for next year needs it). */
export async function ensurePreparedYear() {
  const { next } = await preparedSession();
  if (next) return next;
  return createNextSchoolSession({ makeCurrent: false });
}

/**
 * A student admitted for next year: park them in the hidden "Joining next year" class (so this year's
 * registers, fee runs and promotion skip them) and remember the class they start in.
 */
export async function markJoiningNextYear(studentId: string, classId: string) {
  const next = await ensurePreparedYear();
  const { current } = await ensureSchoolSessions();
  const holdId = await holdingClassId(prisma, JOINING_CLASS);
  await prisma.studentClassEnrollment.deleteMany({ where: { studentId, sessionId: current.id } });
  await prisma.student.update({
    where: { id: studentId },
    data: { classId: holdId, joinsSessionId: next.id, joinsClassId: classId },
  });
  return next;
}

export async function savePromotionDecisionsCore(
  user: AccessUser,
  input: {
    rows?: Array<{ studentId?: string; outcome?: string; toClassId?: string | null; provisional?: boolean; note?: string }>;
  }
) {
  needSchoolEdit(user);
  const { next } = await preparedSession();
  if (!next) throw new Error("Prepare next year first.");
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) return { saved: 0 };
  const classes = await liveClasses();
  const classIds = new Set(classes.map((c) => c.id));
  const students = await prisma.student.findMany({
    where: { id: { in: rows.map((r) => String(r.studentId || "")) }, leftOn: null },
    select: { id: true, classId: true },
  });
  const fromBy = new Map(students.map((s) => [s.id, s.classId]));
  let saved = 0;
  for (const row of rows) {
    const studentId = String(row.studentId || "");
    const fromClassId = fromBy.get(studentId);
    if (!fromClassId) continue;
    const outcome = String(row.outcome || "").toUpperCase() as PromotionOutcome;
    if (!OUTCOMES.has(outcome)) throw new Error("Pick what happens to each student.");
    let toClassId: string | null = null;
    if (outcome === "PROMOTE" || outcome === "DETAIN") {
      toClassId = String(row.toClassId || (outcome === "DETAIN" ? fromClassId : ""));
      if (!classIds.has(toClassId)) throw new Error("Pick the class for next year.");
    }
    const data = {
      fromClassId,
      outcome,
      toClassId,
      provisional: outcome === "PROMOTE" && Boolean(row.provisional),
      note: String(row.note || "").trim().slice(0, 300),
      decidedById: user.id,
    };
    await prisma.promotionDecision.upsert({
      where: { sessionId_studentId: { sessionId: next.id, studentId } },
      update: data,
      create: { ...data, sessionId: next.id, studentId },
    });
    saved += 1;
  }
  return { saved };
}

/** Undo the choices for one class (back to the defaults). */
export async function resetPromotionClassCore(user: AccessUser, input: { classId?: string }) {
  needSchoolEdit(user);
  const { next } = await preparedSession();
  if (!next) return;
  await prisma.promotionDecision.deleteMany({ where: { sessionId: next.id, fromClassId: String(input.classId || "") } });
}

async function pastStudentsClassId(db: typeof prisma) {
  const found = await db.class.findFirst({
    where: { name: PAST_CLASS.name, section: PAST_CLASS.section },
    select: { id: true },
  });
  if (found) return found.id;
  const created = await db.class.create({
    data: { name: PAST_CLASS.name, section: PAST_CLASS.section, archivedAt: new Date() },
    select: { id: true },
  });
  return created.id;
}

/**
 * Applies every decision and makes the prepared year current.
 * Students without a saved decision get the default (next class, or pass out from the top class).
 */
export async function switchToNextYearCore(user: AccessUser, input: { sessionId?: string }) {
  needSchoolEdit(user);
  const { current, next } = await preparedSession();
  if (!next) throw new Error("Prepare next year first.");
  if (input.sessionId && input.sessionId !== next.id) throw new Error("That year is not the one being prepared.");

  // Every current student must have this year's enrollment so the class they were in stays on record.
  await ensureCurrentSessionStudentRollNumbers().catch(() => undefined);

  const board = await promotionBoardCore(user);
  const plan = board.classes.flatMap((c) => c.students.map((s) => ({ ...s, fromClassId: c.id })));
  const liveIds = new Set(board.targets.map((t) => t.id));
  const joiners = (
    await prisma.student.findMany({
      where: { joinsSessionId: next.id, leftOn: null },
      select: { id: true, name: true, classId: true, joinsClassId: true },
    })
  ).filter((j) => j.joinsClassId && liveIds.has(j.joinsClassId));
  const yearLabel = current.label || sessionLabel(current.startsOn, current.endsOn);
  const today = new Date().toISOString().slice(0, 10);
  const leftOn = current.endsOn && current.endsOn < today ? current.endsOn : today;

  const result = await prisma.$transaction(
    async (tx) => {
      const db = tx as unknown as typeof prisma;
      const pastId = await pastStudentsClassId(db);
      const missing = plan.filter((p) => (p.outcome === "PROMOTE" || p.outcome === "DETAIN") && !p.toClassId);
      if (missing.length) throw new Error(`Pick next year's class for ${missing[0].name}${missing.length > 1 ? ` and ${missing.length - 1} more` : ""}.`);

      // Clean slate for the new year (in case a roll backfill ran early).
      await db.studentClassEnrollment.deleteMany({ where: { sessionId: next.id } });

      const staying = plan.filter((p) => p.outcome === "PROMOTE" || p.outcome === "DETAIN");
      const byTarget = new Map<string, { id: string; name: string }[]>();
      for (const p of staying) byTarget.set(p.toClassId!, [...(byTarget.get(p.toClassId!) ?? []), p]);
      // New admissions for this year join their class with everyone else (roll numbers A→Z together).
      for (const j of joiners) byTarget.set(j.joinsClassId!, [...(byTarget.get(j.joinsClassId!) ?? []), j]);
      if (joiners.length) {
        await db.student.updateMany({ where: { id: { in: joiners.map((j) => j.id) } }, data: { joinsSessionId: null, joinsClassId: null } });
        for (const j of joiners) {
          await db.promotionDecision.upsert({
            where: { sessionId_studentId: { sessionId: next.id, studentId: j.id } },
            update: { fromClassId: j.classId, outcome: "JOIN", toClassId: j.joinsClassId, decidedById: user.id },
            create: { sessionId: next.id, studentId: j.id, fromClassId: j.classId, outcome: "JOIN", toClassId: j.joinsClassId, decidedById: user.id },
          });
        }
      }
      for (const [classId, list] of byTarget) {
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
        await db.studentClassEnrollment.createMany({
          data: sorted.map((p, i) => ({ studentId: p.id, classId, sessionId: next.id, rollNumber: i + 1, active: true })),
        });
        await db.student.updateMany({ where: { id: { in: sorted.map((p) => p.id) } }, data: { classId } });
      }

      const leaving = plan.filter((p) => p.outcome === "LEAVE");
      const passing = plan.filter((p) => p.outcome === "PASS_OUT");
      if (leaving.length) {
        await db.student.updateMany({
          where: { id: { in: leaving.map((p) => p.id) } },
          data: { classId: pastId, leftOn, leftReason: `Left school · ${yearLabel}` },
        });
      }
      if (passing.length) {
        await db.student.updateMany({
          where: { id: { in: passing.map((p) => p.id) } },
          data: { classId: pastId, leftOn, leftReason: `Passed out · ${yearLabel}` },
        });
      }

      // Keep the record of what was decided (including defaults).
      for (const p of plan) {
        const data = {
          fromClassId: p.fromClassId,
          outcome: p.outcome,
          toClassId: p.outcome === "PROMOTE" || p.outcome === "DETAIN" ? p.toClassId : null,
          provisional: p.provisional,
          note: p.note,
          decidedById: p.decided ? undefined : user.id,
        };
        await db.promotionDecision.upsert({
          where: { sessionId_studentId: { sessionId: next.id, studentId: p.id } },
          update: data,
          create: { ...data, decidedById: user.id, sessionId: next.id, studentId: p.id },
        });
      }

      await db.schoolSession.updateMany({ data: { current: false } });
      await db.schoolSession.update({
        where: { id: next.id },
        data: { current: true, switchedAt: new Date(), switchedFromId: current.id },
      });
      await db.schoolConfig.upsert({
        where: { id: "school" },
        update: { sessionStart: next.startsOn, sessionEnd: next.endsOn },
        create: { id: "school", sessionStart: next.startsOn, sessionEnd: next.endsOn },
      });
      return { moved: staying.length, left: leaving.length, passedOut: passing.length, joined: joiners.length };
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
  return { label: next.label, ...result };
}

/** Former students (left / passed out), newest first. */
export async function pastStudentsCore(user: AccessUser, input: { q?: string } = {}) {
  needSchoolEdit(user);
  const q = String(input.q || "").trim();
  const rows = await prisma.student.findMany({
    where: {
      leftOn: { not: null },
      ...(q ? { OR: [{ name: { contains: q } }, { admissionNo: { contains: q } }] } : {}),
    },
    select: {
      id: true,
      name: true,
      admissionNo: true,
      leftOn: true,
      leftReason: true,
      enrollments: {
        select: { class: { select: { name: true, section: true } }, session: { select: { label: true, startsOn: true } } },
      },
    },
    orderBy: [{ leftOn: "desc" }, { name: "asc" }],
    take: 300,
  });
  return {
    students: rows.map((r) => {
      const last = [...r.enrollments].sort((a, b) => b.session.startsOn.localeCompare(a.session.startsOn))[0];
      return {
        id: r.id,
        name: r.name,
        admissionNo: r.admissionNo,
        leftOn: r.leftOn,
        leftReason: r.leftReason,
        lastClass: last ? `${classLabel(last.class)} · ${last.session.label}` : "",
      };
    }),
  };
}

/** Mark one student as left school (TC issued, moved city …) at any time of the year. */
export async function markStudentLeftCore(user: AccessUser, input: { studentId?: string; reason?: string; leftOn?: string }) {
  needSchoolEdit(user);
  const student = await prisma.student.findUnique({ where: { id: String(input.studentId || "") }, select: { id: true, name: true, leftOn: true } });
  if (!student) throw new Error("Student not found.");
  if (student.leftOn) throw new Error(`${student.name} is already marked as left.`);
  await ensureCurrentSessionStudentRollNumbers().catch(() => undefined);
  const pastId = await pastStudentsClassId(prisma);
  const leftOn = /^\d{4}-\d{2}-\d{2}$/.test(String(input.leftOn || "")) ? String(input.leftOn) : new Date().toISOString().slice(0, 10);
  await prisma.student.update({
    where: { id: student.id },
    data: {
      classId: pastId,
      leftOn,
      leftReason: String(input.reason || "").trim().slice(0, 120) || "Left school",
      joinsSessionId: null,
      joinsClassId: null,
    },
  });
  return { name: student.name };
}

/** Bring a former student back into a class this year. */
export async function restoreStudentCore(user: AccessUser, input: { studentId?: string; classId?: string }) {
  needSchoolEdit(user);
  const student = await prisma.student.findUnique({ where: { id: String(input.studentId || "") }, select: { id: true, name: true, leftOn: true } });
  if (!student) throw new Error("Student not found.");
  const klass = await prisma.class.findFirst({ where: { id: String(input.classId || ""), archivedAt: null }, select: { id: true } });
  if (!klass) throw new Error("Pick a class.");
  const { current } = await ensureSchoolSessions();
  await prisma.$transaction(async (tx) => {
    const db = tx as unknown as typeof prisma;
    await db.student.update({ where: { id: student.id }, data: { classId: klass.id, leftOn: null, leftReason: "", joinsSessionId: null, joinsClassId: null } });
    const enrolled = await db.studentClassEnrollment.findFirst({ where: { studentId: student.id, sessionId: current.id } });
    const used = await db.studentClassEnrollment.findMany({ where: { sessionId: current.id, classId: klass.id }, select: { rollNumber: true } });
    const taken = new Set(used.map((u) => u.rollNumber));
    let roll = 1;
    while (taken.has(roll)) roll += 1;
    if (enrolled) {
      if (enrolled.classId !== klass.id) {
        await db.studentClassEnrollment.update({ where: { id: enrolled.id }, data: { classId: klass.id, rollNumber: roll, active: true } });
      }
    } else {
      await db.studentClassEnrollment.create({ data: { studentId: student.id, classId: klass.id, sessionId: current.id, rollNumber: roll } });
    }
  });
  return { name: student.name };
}

// ── Undo a switch made by mistake ─────────────────────────────────────────

const UNDO_DAYS = 7;

export type UndoState = { fromLabel: string; label: string; switchedAt: string; until: string; blocked: string };

async function undoState(current: { id: string; label: string; startsOn: string; switchedAt?: Date | null; switchedFromId?: string | null }): Promise<UndoState | null> {
  const row = await prisma.schoolSession.findUnique({ where: { id: current.id }, select: { switchedAt: true, switchedFromId: true } });
  if (!row?.switchedAt || !row.switchedFromId) return null;
  const from = await prisma.schoolSession.findUnique({ where: { id: row.switchedFromId }, select: { label: true } });
  if (!from) return null;
  const until = new Date(row.switchedAt.getTime() + UNDO_DAYS * 86_400_000);
  if (until < new Date()) return null;
  return {
    fromLabel: from.label,
    label: current.label,
    switchedAt: row.switchedAt.toISOString(),
    until: until.toISOString(),
    blocked: await undoBlocker(current.id, row.switchedAt),
  };
}

/** Something already happened in the new year → the switch stays. */
async function undoBlocker(sessionId: string, switchedAt: Date) {
  const session = await prisma.schoolSession.findUnique({ where: { id: sessionId } });
  if (!session) return "Year missing.";
  const from = new Date(`${session.startsOn}T00:00:00`);
  const to = new Date(`${session.endsOn}T23:59:59`);
  const decided = await prisma.promotionDecision.findMany({ where: { sessionId }, select: { studentId: true } });
  const decidedIds = new Set(decided.map((d) => d.studentId));
  const [attendance, exams, invoices, enrolled] = await Promise.all([
    prisma.attendance.count({ where: { date: { gte: from, lte: to } } }),
    prisma.examSeries.count({ where: { sessionId } }),
    prisma.feeInvoice.count({ where: { OR: [{ template: { sessionId } }, { dueDate: { gte: from, lte: to } }] } }),
    prisma.studentClassEnrollment.findMany({ where: { sessionId }, select: { studentId: true } }),
  ]);
  const admitted = enrolled.filter((e) => !decidedIds.has(e.studentId)).length;
  if (attendance) return `Attendance is already marked in ${session.label}.`;
  if (exams) return `Exams are already set up in ${session.label}.`;
  if (invoices) return `Fee bills are already made for ${session.label}.`;
  if (admitted) return `${admitted} students were admitted after the switch.`;
  void switchedAt;
  return "";
}

/**
 * Puts the school back into the previous year exactly as it was before the switch:
 * old classes back, passed-out / left students back, new-year class records removed.
 * The decisions are kept, so switching again gives the same result.
 */
export async function undoYearSwitchCore(user: AccessUser) {
  needSchoolEdit(user);
  const { current } = await ensureSchoolSessions();
  const state = await undoState(current);
  if (!state) throw new Error(`The switch to ${current.label} can no longer be undone.`);
  if (state.blocked) throw new Error(`${state.blocked} The switch can no longer be undone.`);
  const row = await prisma.schoolSession.findUnique({ where: { id: current.id }, select: { switchedFromId: true } });
  const prev = await prisma.schoolSession.findUnique({ where: { id: row!.switchedFromId! } });
  if (!prev) throw new Error("Last year is missing.");

  const decisions = await prisma.promotionDecision.findMany({ where: { sessionId: current.id } });
  const liveClassIds = new Set((await prisma.class.findMany({ where: { archivedAt: null }, select: { id: true } })).map((c) => c.id));
  const result = await prisma.$transaction(
    async (tx) => {
      const db = tx as unknown as typeof prisma;
      const byClass = new Map<string, string[]>();
      const joined = decisions.filter((d) => d.outcome === "JOIN");
      for (const d of joined) {
        await db.student.update({
          where: { id: d.studentId },
          data: { classId: d.fromClassId, joinsSessionId: current.id, joinsClassId: d.toClassId },
        });
      }
      for (const d of decisions) {
        if (d.outcome === "JOIN" || !liveClassIds.has(d.fromClassId)) continue;
        byClass.set(d.fromClassId, [...(byClass.get(d.fromClassId) ?? []), d.studentId]);
      }
      let restored = 0;
      for (const [classId, ids] of byClass) {
        // Back to last year's class; students archived by the switch come back too.
        const r = await db.student.updateMany({ where: { id: { in: ids } }, data: { classId, leftOn: null, leftReason: "" } });
        restored += r.count;
      }
      await db.studentClassEnrollment.deleteMany({ where: { sessionId: current.id } });
      await db.schoolSession.updateMany({ data: { current: false } });
      await db.schoolSession.update({ where: { id: current.id }, data: { switchedAt: null, switchedFromId: null } });
      await db.schoolSession.update({ where: { id: prev.id }, data: { current: true } });
      await db.schoolConfig.upsert({
        where: { id: "school" },
        update: { sessionStart: prev.startsOn, sessionEnd: prev.endsOn },
        create: { id: "school", sessionStart: prev.startsOn, sessionEnd: prev.endsOn },
      });
      return { restored };
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
  return { label: prev.label, nextLabel: current.label, ...result };
}

// ── Read-only look at any year ─────────────────────────────────────────────

export async function schoolYearSummaryCore(user: AccessUser, input: { sessionId?: string }) {
  needSchoolEdit(user);
  const session = await prisma.schoolSession.findUnique({ where: { id: String(input.sessionId || "") } });
  if (!session) throw new Error("Year not found.");
  const from = new Date(`${session.startsOn}T00:00:00`);
  const to = new Date(`${session.endsOn}T23:59:59`);
  const [enrollments, decisions, exams, invoices, attendance] = await Promise.all([
    prisma.studentClassEnrollment.findMany({
      where: { sessionId: session.id },
      select: { classId: true, class: { select: { name: true, section: true } } },
    }),
    prisma.promotionDecision.groupBy({ by: ["outcome"], where: { sessionId: session.id }, _count: { _all: true } }),
    prisma.examSeries.count({ where: { sessionId: session.id } }),
    prisma.feeInvoice.findMany({
      where: { OR: [{ template: { sessionId: session.id } }, { dueDate: { gte: from, lte: to } }] },
      select: { amount: true, payments: { select: { amount: true } } },
    }),
    prisma.attendance.count({ where: { date: { gte: from, lte: to } } }),
  ]);
  const classMap = new Map<string, { label: string; students: number }>();
  for (const e of enrollments) {
    const c = classMap.get(e.classId) ?? { label: classLabel(e.class), students: 0 };
    c.students += 1;
    classMap.set(e.classId, c);
  }
  const billed = invoices.reduce((n, i) => n + i.amount, 0);
  const paid = invoices.reduce((n, i) => n + i.payments.reduce((m, p) => m + p.amount, 0), 0);
  return {
    year: { id: session.id, label: session.label, startsOn: session.startsOn, endsOn: session.endsOn, current: session.current },
    students: enrollments.length,
    classes: sortClasses([...classMap.entries()].map(([id, c]) => {
      const [name, ...rest] = c.label.split("-");
      return { id, name, section: rest.join("-"), label: c.label, students: c.students };
    })),
    // How this year started (the switch into it).
    cameIn: Object.fromEntries(decisions.map((d) => [d.outcome, d._count._all])),
    exams,
    fees: { bills: invoices.length, billed, paid, due: Math.max(0, billed - paid) },
    attendanceMarks: attendance,
  };
}
