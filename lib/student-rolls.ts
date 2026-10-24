import { Prisma } from "@prisma/client";
import { DEFAULT_EXAM_PLAN } from "./exams";
import { prisma } from "./prisma";
import { defaultAcademicSession } from "./school";
import { sessionLabel } from "./school-session";
import { currentTenantOrg } from "./tenant-context";

type RollDb = Pick<
  Prisma.TransactionClient,
  "schoolConfig" | "schoolSession" | "student" | "studentClassEnrollment"
>;
// Model queries only, no raw SQL: raw SQL is not scoped to the current school by the tenant extension
// (lib/prisma.ts), and unquoted table names like SchoolSession fail on Postgres (42P01).

type EnrollmentRow = {
  id: string;
  studentId: string;
  classId: string;
  sessionId: string;
  rollNumber: number;
  orgId: string | null;
  active: boolean;
};

function asBool(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function mapEnrollment(row: Record<string, unknown>): EnrollmentRow {
  return {
    id: String(row.id),
    studentId: String(row.studentId),
    classId: String(row.classId),
    sessionId: String(row.sessionId),
    rollNumber: Number(row.rollNumber),
    orgId: row.orgId == null ? null : String(row.orgId),
    active: asBool(row.active),
  };
}

async function currentSession(db: RollDb) {
  const sessions = await db.schoolSession.findMany({ orderBy: { startsOn: "desc" } });
  if (!sessions.length) {
    const config = await db.schoolConfig.findUnique({ where: { id: "school" } });
    const fallback = defaultAcademicSession();
    const startsOn = config?.sessionStart || fallback.sessionStart;
    const endsOn = config?.sessionEnd || fallback.sessionEnd;
    return db.schoolSession.create({
      data: {
        label: sessionLabel(startsOn, endsOn),
        startsOn,
        endsOn,
        current: true,
        examPlanJson: JSON.stringify(DEFAULT_EXAM_PLAN),
      },
    });
  }
  const current = sessions.find((row) => row.current) ?? sessions[0];
  if (!current.current) {
    await db.schoolSession.updateMany({ data: { current: false } });
    return db.schoolSession.update({ where: { id: current.id }, data: { current: true } });
  }
  return current;
}

async function nextRollNumber(db: RollDb, sessionId: string, classId: string) {
  const rows = await db.studentClassEnrollment.findMany({
    where: { sessionId, classId },
    select: { rollNumber: true },
    orderBy: { rollNumber: "asc" },
  });
  const used = new Set(rows.map((row) => Number(row.rollNumber)));
  let roll = 1;
  while (used.has(roll)) roll += 1;
  return roll;
}

async function enrollmentForStudentSession(db: RollDb, studentId: string, sessionId: string): Promise<EnrollmentRow | null> {
  const row = await db.studentClassEnrollment.findFirst({ where: { studentId, sessionId } });
  return row ? mapEnrollment(row as unknown as Record<string, unknown>) : null;
}

async function saveEnrollment(
  db: RollDb,
  id: string,
  data: { classId: string; rollNumber: number; orgId: string | null; active: boolean }
) {
  await db.studentClassEnrollment.update({
    where: { id },
    data: { classId: data.classId, rollNumber: data.rollNumber, orgId: data.orgId, active: data.active },
  });
  return {
    id,
    classId: data.classId,
    rollNumber: data.rollNumber,
    orgId: data.orgId,
    active: data.active,
  };
}

function stampOrg(existingOrgId: string | null | undefined, inputOrgId?: string | null) {
  return inputOrgId !== undefined ? inputOrgId : currentTenantOrg() ?? existingOrgId ?? null;
}

let assignChain = Promise.resolve();

function serializeAssign<T>(run: () => Promise<T>) {
  const next = assignChain.then(run, run);
  assignChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export async function assignStudentRollNumber(
  db: RollDb = prisma,
  input: { studentId: string; classId: string; orgId?: string | null; rollNumber?: number | null }
) {
  return serializeAssign(() => assignStudentRollNumberUnlocked(db, input));
}

async function assignStudentRollNumberUnlocked(
  db: RollDb,
  input: { studentId: string; classId: string; orgId?: string | null; rollNumber?: number | null }
) {
  const session = await currentSession(db);
  const existing = await enrollmentForStudentSession(db, input.studentId, session.id);
  const requested =
    input.rollNumber != null && Number.isInteger(input.rollNumber) && input.rollNumber > 0
      ? input.rollNumber
      : null;
  if (requested) {
    const clash = await db.studentClassEnrollment.findFirst({
      where: { sessionId: session.id, classId: input.classId, rollNumber: requested, NOT: { studentId: input.studentId } },
      select: { id: true },
    });
    if (clash) throw new Error(`Roll ${requested} is already used in this class.`);
  }
  if (existing?.classId === input.classId) {
    if (!requested || existing.rollNumber === requested) {
      const orgId = stampOrg(existing.orgId, input.orgId);
      if (orgId === existing.orgId && existing.active) return existing;
      return saveEnrollment(db, existing.id, {
        classId: existing.classId,
        rollNumber: existing.rollNumber,
        orgId,
        active: true,
      });
    }
    return saveEnrollment(db, existing.id, {
      classId: existing.classId,
      rollNumber: requested,
      orgId: stampOrg(existing.orgId, input.orgId),
      active: true,
    });
  }

  const rollNumber = requested ?? (await nextRollNumber(db, session.id, input.classId));
  const orgId = stampOrg(existing?.orgId, input.orgId);
  if (existing) {
    return saveEnrollment(db, existing.id, {
      classId: input.classId,
      rollNumber,
      orgId,
      active: true,
    });
  }
  return db.studentClassEnrollment.create({
    data: {
      orgId,
      studentId: input.studentId,
      classId: input.classId,
      sessionId: session.id,
      rollNumber,
    },
  });
}

let backfill: Promise<void> | null = null;

export async function ensureCurrentSessionStudentRollNumbers(db: RollDb = prisma) {
  if (!backfill) {
    backfill = runRollNumberBackfill(db).finally(() => {
      backfill = null;
    });
  }
  return backfill;
}

async function runRollNumberBackfill(db: RollDb) {
  try {
    const session = await currentSession(db);
    const [students, enrolled] = await Promise.all([
      db.student.findMany({
        select: {
          id: true,
          orgId: true,
          classId: true,
          name: true,
        },
        orderBy: [{ classId: "asc" }, { name: "asc" }],
      }),
      db.studentClassEnrollment.findMany({ where: { sessionId: session.id }, select: { studentId: true } }),
    ]);
    const have = new Set(enrolled.map((row) => row.studentId));
    for (const student of students) {
      if (have.has(student.id)) continue;
      await assignStudentRollNumber(db, { studentId: student.id, classId: student.classId, orgId: student.orgId });
      have.add(student.id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/enrollments|StudentClassEnrollment|studentClassEnrollment|no such table|Unknown (arg|field)/i.test(message)) {
      console.warn("Skipping roll-number backfill:", message.split("\n")[0]);
      return;
    }
    throw error;
  }
}

/** Current-year roll numbers for one class: studentId → roll. */
export async function classRollNumbers(classId: string, db: RollDb = prisma) {
  const session = await currentSession(db);
  const rows = await db.studentClassEnrollment.findMany({
    where: { sessionId: session.id, classId },
    select: { id: true, studentId: true, rollNumber: true },
  });
  return { sessionId: session.id, rows };
}

/**
 * Sets roll numbers for students of one class in the current academic year, all at once.
 * Students not listed keep their roll. The final set must have no repeats. Saved in two steps
 * (park changed rows on temporary negative numbers, then write the new ones) so swaps don't hit
 * the unique (session, class, roll) rule half-way.
 */
export async function setClassRollNumbers(input: { classId: string; rolls: { studentId: string; rollNumber: number }[] }) {
  return serializeAssign(async () => {
    const { rows } = await classRollNumbers(input.classId);
    const byStudent = new Map(rows.map((row) => [row.studentId, row]));
    const final = new Map(rows.map((row) => [row.studentId, Number(row.rollNumber)]));
    for (const item of input.rolls) {
      const roll = Number(item.rollNumber);
      if (!byStudent.has(item.studentId)) throw new Error("A student in the list is not in this class this year.");
      if (!Number.isInteger(roll) || roll < 1 || roll > 9999) throw new Error("Roll numbers must be whole numbers from 1 to 9999.");
      final.set(item.studentId, roll);
    }
    const seen = new Map<number, string>();
    for (const [studentId, roll] of final) {
      if (seen.has(roll)) throw new Error(`Roll ${roll} is given to two students.`);
      seen.set(roll, studentId);
    }
    const changed = rows.filter((row) => final.get(row.studentId) !== Number(row.rollNumber));
    if (!changed.length) return { changed: 0 };
    const write = async (tx: Pick<Prisma.TransactionClient, "studentClassEnrollment">) => {
      for (let i = 0; i < changed.length; i += 1) {
        await tx.studentClassEnrollment.update({ where: { id: changed[i].id }, data: { rollNumber: -(i + 1) } });
      }
      for (const row of changed) {
        await tx.studentClassEnrollment.update({ where: { id: row.id }, data: { rollNumber: final.get(row.studentId)! } });
      }
    };
    await prisma.$transaction(async (tx) => write(tx));
    return { changed: changed.length };
  });
}
