import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";

/** Class teacher may add students to their own class (admin turns it on for onboarding, off after). */
export const CLASS_STUDENTS_ADD = "class.students.add";
/** Class teacher may edit students already in their own class. */
export const CLASS_STUDENTS_EDIT = "class.students.edit";

/** Class teacher may renumber this year's rolls in their own class. */
export const CLASS_ROLLS_EDIT = "class.rolls.edit";

/** The class this login is class teacher of ("" when none, or not a teacher login). */
export async function ownClassIdFor(user: AccessUser) {
  if (user.portal !== "TEACHER") return "";
  const teacher = await prisma.teacher.findUnique({ where: { userId: user.id }, select: { classId: true } });
  return teacher?.classId || "";
}

/** True when this user works on students only through the class-teacher permissions (no office people.edit). */
export function classTeacherOnly(user: AccessUser, ...keys: string[]) {
  return !can(user, "people.edit") && keys.some((key) => can(user, key));
}

/**
 * Office users with "Add and edit records" pass. A class teacher passes with one of `keys`
 * when the student is in the class they are class teacher of.
 */
export async function assertStudentAccess(user: AccessUser, studentId: string, keys: string[]) {
  if (can(user, "people.edit")) return;
  if (!keys.some((key) => can(user, key))) throw new Error("No access.");
  const classId = await ownClassIdFor(user);
  if (!classId) throw new Error("Only a class teacher can do this.");
  const student = await prisma.student.findFirst({ where: { id: studentId }, select: { classId: true } });
  if (!student || student.classId !== classId) throw new Error("This student is not in your class.");
}
