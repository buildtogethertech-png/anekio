import { Prisma } from "@prisma/client";
import { DEFAULT_EXAM_PLAN } from "./exams";
import { prisma } from "./prisma";
import { defaultAcademicSession } from "./school";
import { sessionLabel } from "./school-session";
import { currentTenantOrg } from "./tenant-context";

type RollDb = Pick<
  Prisma.TransactionClient,
  "schoolConfig" | "schoolSession" | "student" | "studentClassEnrollment" | "$queryRaw" | "$executeRaw"
>;

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
  const sessions = await db.$queryRaw<Array<{ id: string; current: unknown; startsOn: string }>>`
    SELECT id, current, startsOn FROM SchoolSession ORDER BY startsOn DESC
  `;
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
  const current = sessions.find((row) => asBool(row.current)) ?? sessions[0];
  if (!asBool(current.current)) {
    await db.$executeRaw`UPDATE SchoolSession SET current = 0`;
    await db.$executeRaw`UPDATE SchoolSession SET current = 1 WHERE id = ${current.id}`;
  }
  return current;
}

async function nextRollNumber(db: RollDb, sessionId: string, classId: string) {
  const rows = await db.$queryRaw<Array<{ rollNumber: number }>>`
    SELECT rollNumber FROM StudentClassEnrollment
    WHERE sessionId = ${sessionId} AND classId = ${classId}
    ORDER BY rollNumber ASC
  `;
  const used = new Set(rows.map((row) => Number(row.rollNumber)));
  let roll = 1;
  while (used.has(roll)) roll += 1;
  return roll;
}

async function enrollmentForStudentSession(db: RollDb, studentId: string, sessionId: string) {
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
    SELECT id, studentId, classId, sessionId, rollNumber, orgId, active
    FROM StudentClassEnrollment
    WHERE studentId = ${studentId} AND sessionId = ${sessionId}
    LIMIT 1
  `;
  return rows[0] ? mapEnrollment(rows[0]) : null;
}

async function saveEnrollment(
  db: RollDb,
  id: string,
  data: { classId: string; rollNumber: number; orgId: string | null; active: boolean }
) {
  await db.$executeRaw`
    UPDATE StudentClassEnrollment
    SET classId = ${data.classId},
        rollNumber = ${data.rollNumber},
        orgId = ${data.orgId},
        active = ${data.active ? 1 : 0}
    WHERE id = ${id}
  `;
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
    const clash = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM StudentClassEnrollment
      WHERE sessionId = ${session.id}
        AND classId = ${input.classId}
        AND rollNumber = ${requested}
        AND studentId != ${input.studentId}
      LIMIT 1
    `;
    if (clash[0]) throw new Error(`Roll ${requested} is already used in this class.`);
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
      db.$queryRaw<Array<{ studentId: string }>>`
        SELECT studentId FROM StudentClassEnrollment WHERE sessionId = ${session.id}
      `,
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
