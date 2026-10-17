import { prisma } from "./prisma";
import { eligibleMarksTeacherIds, examEvaluatorIds, grantedEvaluatorIds } from "./exam-workflow";
import { formatSubjectLabel, skillMatchesSubject } from "./subject-code";

export { examEvaluatorIds, grantedEvaluatorIds, eligibleMarksTeacherIds };

export type ClassTestSubjectChoice = { id: string; name: string; code?: string; label?: string };
export type ClassTestClassChoice = { id: string; label: string; subjects: ClassTestSubjectChoice[] };

export function skillNameMatches(skillName: string, subjectName: string) {
  return skillMatchesSubject(skillName, { name: subjectName, code: subjectName });
}

function addClassTestChoice(
  byClass: Map<string, ClassTestClassChoice>,
  row: { id: string; name: string; code?: string | null; classId: string; class: { name: string; section: string } }
) {
  const current = byClass.get(row.classId) || {
    id: row.classId,
    label: `${row.class.name}-${row.class.section}`,
    subjects: [],
  };
  if (!current.subjects.some((subject) => subject.id === row.id)) {
    current.subjects.push({
      id: row.id,
      name: row.name,
      code: row.code || "",
      label: formatSubjectLabel(row.code, row.name),
    });
  }
  byClass.set(row.classId, current);
}

export async function teacherClassTestChoices(teacherId: string): Promise<ClassTestClassChoice[]> {
  const id = String(teacherId || "").trim();
  if (!id) return [];
  const [owned, skills] = await Promise.all([
    prisma.subject.findMany({
      where: { teacherId: id },
      select: { id: true, name: true, code: true, classId: true, class: { select: { name: true, section: true } } },
    }),
    prisma.teacherSkill.findMany({
      where: { teacherId: id },
      select: { classId: true, subjectName: true },
    }),
  ]);
  const skillClassIds = [...new Set(skills.map((row) => row.classId))];
  const skillSubjects = skillClassIds.length
    ? await prisma.subject.findMany({
        where: { classId: { in: skillClassIds } },
        select: { id: true, name: true, code: true, classId: true, class: { select: { name: true, section: true } } },
      })
    : [];
  const byClass = new Map<string, ClassTestClassChoice>();
  for (const row of owned) addClassTestChoice(byClass, row);
  for (const subject of skillSubjects) {
    if (skills.some((skill) => skill.classId === subject.classId && skillMatchesSubject(skill.subjectName, subject))) {
      addClassTestChoice(byClass, subject);
    }
  }
  return [...byClass.values()]
    .filter((row) => row.subjects.length)
    .map((row) => ({
      ...row,
      subjects: [...row.subjects].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function teacherMayHostClassTest(teacherId: string, classId: string, subjectId: string) {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { id: true, name: true, code: true, classId: true, teacherId: true },
  });
  if (!subject || subject.classId !== classId) return false;
  if (subject.teacherId === teacherId) return true;
  const skills = await prisma.teacherSkill.findMany({
    where: { teacherId, classId },
    select: { subjectName: true },
  });
  return skills.some((skill) => skillMatchesSubject(skill.subjectName, subject));
}

export async function teacherIdsBySubjectName(classId: string, subjectNames: string[]) {
  const names = [...new Set(subjectNames.map((name) => name.trim()).filter(Boolean))];
  if (!names.length) return new Map<string, string>();
  const [skills, subjects] = await Promise.all([
    prisma.teacherSkill.findMany({
      where: { classId },
      select: { teacherId: true, subjectName: true },
      orderBy: { id: "asc" },
    }),
    prisma.subject.findMany({
      where: { classId },
      select: { name: true, code: true },
    }),
  ]);
  const map = new Map<string, string>();
  for (const name of names) {
    const subject = subjects.find(
      (row) => row.name.trim().toLowerCase() === name.toLowerCase() || row.code.trim().toLowerCase() === name.toLowerCase()
    ) || { name, code: name };
    const skill = skills.find((row) => skillMatchesSubject(row.subjectName, subject));
    if (skill && !map.has(name)) map.set(name, skill.teacherId);
  }
  return map;
}

export async function eligibleTeacherIdsForExam(examId: string) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: { subject: true },
  });
  if (!exam) return [];
  const skills = await prisma.teacherSkill.findMany({
    where: { classId: exam.classId },
    select: { teacherId: true, subjectName: true },
  });
  const matching = skills.filter((skill) => skillMatchesSubject(skill.subjectName, exam.subject));
  return eligibleMarksTeacherIds({
    examTeacherId: exam.teacherId,
    subjectTeacherId: exam.subject.teacherId,
    skillTeacherIds: matching.map((row) => row.teacherId),
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
