import { Prisma } from "@prisma/client";
import { DEFAULT_EXAM_PLAN } from "./exams";
import { prisma } from "./prisma";
import { defaultAcademicSession } from "./school";
import { sessionLabel } from "./school-session";

type RollDb = Pick<
  Prisma.TransactionClient,
  "schoolConfig" | "schoolSession" | "student" | "studentClassEnrollment"
>;

async function currentSession(db: RollDb) {
  let sessions = await db.schoolSession.findMany({ orderBy: { startsOn: "desc" } });
  if (!sessions.length) {
    const config = await db.schoolConfig.findUnique({ where: { id: "school" } });
    const fallback = defaultAcademicSession();
    const startsOn = config?.sessionStart || fallback.sessionStart;
    const endsOn = config?.sessionEnd || fallback.sessionEnd;
    const row = await db.schoolSession.create({
      data: {
        label: sessionLabel(startsOn, endsOn),
        startsOn,
        endsOn,
        current: true,
        examPlanJson: JSON.stringify(DEFAULT_EXAM_PLAN),
      },
    });
    return row;
  }
  let current = sessions.find((row) => row.current) ?? sessions[0];
  if (!current.current) {
    await db.schoolSession.updateMany({ data: { current: false } });
    current = await db.schoolSession.update({
      where: { id: current.id },
      data: { current: true },
    });
  }
  return current;
}

async function nextRollNumber(db: RollDb, sessionId: string, classId: string) {
  const latest = await db.studentClassEnrollment.findFirst({
    where: { sessionId, classId },
    orderBy: { rollNumber: "desc" },
    select: { rollNumber: true },
  });
  return (latest?.rollNumber || 0) + 1;
}

export async function assignStudentRollNumber(
  db: RollDb = prisma,
  input: { studentId: string; classId: string; orgId?: string | null; rollNumber?: number | null }
) {
  const session = await currentSession(db);
  const existing = await db.studentClassEnrollment.findUnique({
    where: { studentId_sessionId: { studentId: input.studentId, sessionId: session.id } },
  });
  const requested =
    input.rollNumber != null && Number.isInteger(input.rollNumber) && input.rollNumber > 0
      ? input.rollNumber
      : null;
  if (requested) {
    const clash = await db.studentClassEnrollment.findFirst({
      where: {
        sessionId: session.id,
        classId: input.classId,
        rollNumber: requested,
        NOT: { studentId: input.studentId },
      },
      select: { id: true },
    });
    if (clash) throw new Error(`Roll ${requested} is already used in this class.`);
  }
  if (existing?.classId === input.classId) {
    if (!requested || existing.rollNumber === requested) return existing;
    return db.studentClassEnrollment.update({
      where: { id: existing.id },
      data: {
        rollNumber: requested,
        active: true,
        ...(input.orgId !== undefined ? { orgId: input.orgId } : {}),
      },
    });
  }
  const rollNumber = requested ?? (await nextRollNumber(db, session.id, input.classId));
  if (existing) {
    return db.studentClassEnrollment.update({
      where: { id: existing.id },
      data: {
        classId: input.classId,
        rollNumber,
        active: true,
        ...(input.orgId !== undefined ? { orgId: input.orgId } : {}),
      },
    });
  }
  return db.studentClassEnrollment.create({
    data: {
      orgId: input.orgId ?? null,
      studentId: input.studentId,
      classId: input.classId,
      sessionId: session.id,
      rollNumber,
    },
  });
}

export async function ensureCurrentSessionStudentRollNumbers(db: RollDb = prisma) {
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
      db.studentClassEnrollment.findMany({
        where: { sessionId: session.id },
        select: { studentId: true },
      }),
    ]);
    const have = new Set(enrolled.map((row) => row.studentId));
    for (const student of students) {
      if (have.has(student.id)) continue;
      await assignStudentRollNumber(db, { studentId: student.id, classId: student.classId, orgId: student.orgId });
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
