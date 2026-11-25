import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";

/** Class teacher may add students to their own class (admin turns it on for onboarding, off after). */
export const CLASS_STUDENTS_ADD = "class.students.add";
/** Class teacher may edit students already in their own class. */
export const CLASS_STUDENTS_EDIT = "class.students.edit";

/** Class teacher may renumber this year's rolls in their own class. */
export const CLASS_ROLLS_EDIT = "class.rolls.edit";

/**
 * Who is class teacher of what lives only in TeacherClass.classTeacher. A teacher can be class teacher of
 * several classes, and a class can have several class teachers.
 */

/** Prisma `select`/`include` for a teacher's class-teacher classes: `classes: CLASS_TEACHER_LINKS`. */
export const CLASS_TEACHER_LINKS = {
  where: { classTeacher: true },
  select: { classId: true, class: { select: { id: true, name: true, section: true } } },
} satisfies Prisma.Teacher$classesArgs;

/** Teacher `where` for "class teacher of this class". */
export function classTeacherOf(classId: string): Prisma.TeacherWhereInput {
  return { classes: { some: { classId, classTeacher: true } } };
}

/** Class rows ordered the way the school reads them: 1-A, 1-B, 2-A, … 10-A. */
export function sortClassesByLabel<T extends { name: string; section: string }>(rows: T[]) {
  return [...rows].sort((a, b) => `${a.name}-${a.section}`.localeCompare(`${b.name}-${b.section}`, undefined, { numeric: true }));
}

/** Class ids from a teacher's CLASS_TEACHER_LINKS rows, in class order. */
export function classIdsFromLinks(links: { classId: string; class: { name: string; section: string } }[]) {
  return sortClassesByLabel(links.map((link) => ({ ...link.class, classId: link.classId }))).map((row) => row.classId);
}

/** Classes this teacher is class teacher of, in class order. */
export async function classTeacherClassIds(teacherId: string) {
  const links = await prisma.teacherClass.findMany({ where: { teacherId, classTeacher: true }, select: CLASS_TEACHER_LINKS.select });
  return classIdsFromLinks(links);
}

/** The classes this login is class teacher of (empty when none, or not a teacher login). */
export async function ownClassIdsFor(user: AccessUser) {
  if (user.portal !== "TEACHER") return [];
  const teacher = await prisma.teacher.findUnique({ where: { userId: user.id }, select: { id: true } });
  return teacher ? classTeacherClassIds(teacher.id) : [];
}

/** "Class teacher of" picks from a form: unique ids of live classes. Throws when one is missing or archived. */
export async function checkedClassTeacherPicks(classIds: unknown) {
  const ids = [...new Set((Array.isArray(classIds) ? classIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return [];
  const found = await prisma.class.findMany({ where: { id: { in: ids }, archivedAt: null }, select: { id: true } });
  if (found.length !== ids.length) throw new Error("Class missing");
  return ids;
}

/**
 * Make this teacher class teacher of exactly `classIds`. A class teacher also teaches the class, so the
 * TeacherClass row stays when a class is taken off; only its classTeacher flag goes.
 */
export async function setClassTeacherClasses(teacherId: string, classIds: string[], db: Prisma.TransactionClient = prisma) {
  const wanted = [...new Set(classIds.filter(Boolean))];
  await db.teacherClass.updateMany({ where: { teacherId, classTeacher: true, classId: { notIn: wanted } }, data: { classTeacher: false } });
  for (const classId of wanted) {
    await db.teacherClass.upsert({
      where: { teacherId_classId: { teacherId, classId } },
      update: { classTeacher: true },
      create: { teacherId, classId, classTeacher: true },
    });
  }
}

/** True when this user works on students only through the class-teacher permissions (no office people.edit). */
export function classTeacherOnly(user: AccessUser, ...keys: string[]) {
  return !can(user, "people.edit") && keys.some((key) => can(user, key));
}

/**
 * Office users with "Add and edit records" pass. A class teacher passes with one of `keys`
 * when the student is in a class they are class teacher of.
 */
export async function assertStudentAccess(user: AccessUser, studentId: string, keys: string[]) {
  if (can(user, "people.edit")) return;
  if (!keys.some((key) => can(user, key))) throw new Error("No access.");
  const classIds = await ownClassIdsFor(user);
  if (!classIds.length) throw new Error("Only a class teacher can do this.");
  const student = await prisma.student.findFirst({ where: { id: studentId }, select: { classId: true } });
  if (!student || !classIds.includes(student.classId || "")) throw new Error("This student is not in your class.");
}
