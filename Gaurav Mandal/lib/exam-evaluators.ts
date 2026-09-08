import { prisma } from "./prisma";
import { eligibleMarksTeacherIds, examEvaluatorIds, grantedEvaluatorIds } from "./exam-workflow";

export { examEvaluatorIds, grantedEvaluatorIds, eligibleMarksTeacherIds };

export async function eligibleTeacherIdsForExam(examId: string) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: { subject: true },
  });
  if (!exam) return [];
  const skills = await prisma.teacherSkill.findMany({
    where: { classId: exam.classId, subjectName: exam.subject.name },
    select: { teacherId: true },
  });
  return eligibleMarksTeacherIds({
    examTeacherId: exam.teacherId,
    subjectTeacherId: exam.subject.teacherId,
    skillTeacherIds: skills.map((row) => row.teacherId),
  });
}

export async function ensureExamEvaluator(examId: string, teacherId?: string | null) {
  if (!teacherId) return;
  await prisma.examEvaluator.upsert({
    where: { examId_teacherId: { examId, teacherId } },
    create: { examId, teacherId },
    update: {},
  });
}

export async function ensureExamEvaluators(examId: string, teacherIds: (string | null | undefined)[]) {
  for (const teacherId of [...new Set(teacherIds.filter(Boolean) as string[])]) {
    await ensureExamEvaluator(examId, teacherId);
  }
}

export function packedEvaluators(exam: {
  teacherId?: string | null;
  teacher?: { user?: { name?: string | null } | null } | null;
  teacherName?: string;
  evaluators?: {
    teacherId: string;
    teacher?: { user?: { name?: string | null } | null } | null;
  }[];
}) {
  const names = new Map<string, string>();
  if (exam.teacherId) names.set(exam.teacherId, exam.teacher?.user?.name || exam.teacherName || "");
  for (const row of exam.evaluators || []) {
    names.set(row.teacherId, row.teacher?.user?.name || names.get(row.teacherId) || "");
  }
  return grantedEvaluatorIds(exam).map((id) => ({ id, name: names.get(id) || "" }));
}
