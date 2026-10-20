import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";

/**
 * "Also a teacher" for office employees.
 *
 * The person stays ONE employee (their StaffMember row: payroll, attendance, leave). Turning teaching on adds a
 * teachingOnly Teacher row on the same login, so they can be picked for periods, class teacher and exam papers,
 * and get a Teacher hat (Office ↔ Teacher switch). Turning it off removes that row once nothing is assigned to it.
 */
export async function setStaffTeachingCore(user: AccessUser, input: { staffId?: string; on?: boolean }) {
  if (!can(user, "staff.edit")) throw new Error("You need permission to manage employees.");
  const staff = await prisma.staffMember.findUnique({
    where: { id: String(input.staffId || "") },
    select: { id: true, orgId: true, name: true, employeeId: true, joinedOn: true, userId: true, archivedAt: true },
  });
  if (!staff || staff.archivedAt) throw new Error("Employee not found.");

  const existing = await prisma.teacher.findFirst({
    where: { OR: [{ staffMemberId: staff.id }, ...(staff.userId ? [{ userId: staff.userId }] : [])] },
    select: { id: true, teachingOnly: true },
  });

  if (input.on) {
    if (!staff.userId) throw new Error(`Give ${staff.name} an app login first. Teachers open their periods and marks in the app.`);
    if (existing && !existing.teachingOnly) return { teacherId: existing.id, on: true };
    if (existing) return { teacherId: existing.id, on: true };
    let employeeId = staff.employeeId || `T-${staff.id.slice(-6)}`;
    const clash = await prisma.teacher.findFirst({ where: { orgId: staff.orgId, employeeId }, select: { id: true } });
    if (clash) employeeId = `${employeeId}-T`;
    const teacher = await prisma.teacher.create({
      data: {
        orgId: staff.orgId,
        userId: staff.userId,
        employeeId,
        joinedOn: staff.joinedOn || undefined,
        monthlySalary: 0, // salary is paid on the staff row, never here
        teachingOnly: true,
        staffMemberId: staff.id,
      },
      select: { id: true },
    });
    return { teacherId: teacher.id, on: true };
  }

  if (!existing) return { on: false };
  if (!existing.teachingOnly) throw new Error(`${staff.name} is a full teacher account; change their role instead.`);
  const id = existing.id;
  const [klass, periods, papersChecking, papersSetting] = await Promise.all([
    prisma.teacher.findUnique({ where: { id }, select: { classId: true } }),
    prisma.timetableSlot.count({ where: { teacherId: id } }),
    prisma.exam.count({ where: { teacherId: id, workflowStatus: { not: "PUBLISHED" } } }),
    prisma.exam.count({ where: { setterId: id, workflowStatus: { not: "PUBLISHED" } } }),
  ]);
  const left = [
    klass?.classId ? "class teacher of a class" : "",
    periods ? `${periods} timetable period${periods === 1 ? "" : "s"}` : "",
    papersChecking + papersSetting ? `${papersChecking + papersSetting} exam paper${papersChecking + papersSetting === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  if (left.length) throw new Error(`${staff.name} still has ${left.join(", ")}. Reassign them first, then turn teaching off.`);
  await prisma.examEvaluator.deleteMany({ where: { teacherId: id } }).catch(() => undefined);
  await prisma.teacher.delete({ where: { id } });
  return { on: false };
}
