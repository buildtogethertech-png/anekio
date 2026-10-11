import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { scopePolicyFor, validScopeFor, type AccessScope } from "../../lib/permissions";
import { seedPortalFixture, type PortalFixture } from "./factories";

export const RBAC_PASSWORD = "12345";

export type RbacWorld = PortalFixture & {
  class1A: string;
  class2A: string;
  aishaId: string;
  rohanId: string;
  otherChildId: string;
  kavitaId: string;
  kavitaTeacherId: string;
  sandeepId: string;
  sandeepTeacherId: string;
  reportTeacherUserId: string;
  leaveTypeStudentId: string;
  leaveTypeStaffId: string;
};

export async function seedRbacWorld(prisma: PrismaClient): Promise<RbacWorld> {
  const fixture = await seedPortalFixture(prisma);
  const password = await bcrypt.hash(RBAC_PASSWORD, 4);
  const roleIds = Object.fromEntries(
    (await prisma.role.findMany({ select: { slug: true, id: true } })).map((row) => [row.slug, row.id])
  );

  const class1A = "class-1-a";
  const class2A = "class-2-a";
  const class3A = "class-3-a";
  const class4A = "class-4-a";
  const class5A = "class-5-a";
  for (const row of [
    { id: class1A, name: "1", section: "A" },
    { id: class2A, name: "2", section: "A" },
    { id: class3A, name: "3", section: "A" },
    { id: class4A, name: "4", section: "A" },
    { id: class5A, name: "5", section: "A" },
  ]) {
    await prisma.class.create({ data: row });
  }

  async function teacher(input: {
    id: string;
    teacherId: string;
    email: string;
    name: string;
    phone: string;
    employeeId: string;
    classId: string;
  }) {
    await prisma.user.create({
      data: {
        id: input.id,
        email: input.email,
        password,
        name: input.name,
        phone: input.phone,
        roleId: roleIds.TEACHER,
        managerId: fixture.users.office.id,
        teacher: {
          create: {
            id: input.teacherId,
            employeeId: input.employeeId,
            classId: input.classId,
            joinedOn: "2026-04-01",
          },
        },
      },
    });
  }

  await teacher({
    id: "user-kavita",
    teacherId: "teacher-kavita",
    email: "kavita.joshi@school.test",
    name: "Kavita Joshi",
    phone: "9876501001",
    employeeId: "T-KAV-1",
    classId: class1A,
  });
  await teacher({
    id: "user-sandeep",
    teacherId: "teacher-sandeep-rbac",
    email: "sandeep.gill@school.test",
    name: "Sandeep Gill",
    phone: "9876501002",
    employeeId: "T-SAN-1",
    classId: class2A,
  });
  await teacher({
    id: "user-rhea",
    teacherId: "teacher-rhea",
    email: "rhea.dsouza@school.test",
    name: "Rhea Dsouza",
    phone: "9876501003",
    employeeId: "T-RHE-1",
    classId: class3A,
  });
  await teacher({
    id: "user-manoj",
    teacherId: "teacher-manoj",
    email: "manoj.pillai@school.test",
    name: "Manoj Pillai",
    phone: "9876501004",
    employeeId: "T-MAN-1",
    classId: class4A,
  });
  await teacher({
    id: "user-shalini",
    teacherId: "teacher-shalini",
    email: "shalini.gupta@school.test",
    name: "Shalini Gupta",
    phone: "9876501005",
    employeeId: "T-SHA-1",
    classId: class5A,
  });

  await prisma.user.create({
    data: {
      id: "user-report-teacher",
      email: "report.teacher@school.test",
      password,
      name: "Neha Report",
      phone: "9876501006",
      roleId: roleIds.TEACHER,
      managerId: "user-kavita",
      teacher: { create: { id: "teacher-neha", employeeId: "T-NEH-1", joinedOn: "2026-04-01" } },
    },
  });

  await prisma.user.create({
    data: {
      id: "user-admin-named",
      email: "admin@school.test",
      password,
      name: "Named Admin",
      phone: "9876500001",
      roleId: roleIds.ADMIN,
    },
  });
  await prisma.user.create({
    data: {
      id: "user-fees-named",
      email: "fees@school.test",
      password,
      name: "Fees Clerk",
      phone: "9876500002",
      roleId: roleIds.FEES,
      managerId: fixture.users.office.id,
    },
  });
  await prisma.user.create({
    data: {
      id: "user-exams-named",
      email: "exams@school.test",
      password,
      name: "Exams Clerk",
      phone: "9876500003",
      roleId: roleIds.EXAMS,
      managerId: fixture.users.office.id,
    },
  });

  await prisma.user.create({
    data: {
      id: "user-parent-1a",
      email: "parent.1a.1@school.test",
      password,
      name: "Parent 1-A",
      phone: "9876502001",
      roleId: roleIds.PARENT,
      parent: { create: { id: "parent-1a", phone: "9876502001" } },
    },
  });
  await prisma.user.create({
    data: {
      id: "user-parent-other",
      email: "parent.other@school.test",
      password,
      name: "Other Parent",
      phone: "9876502002",
      roleId: roleIds.PARENT,
      parent: { create: { id: "parent-other", phone: "9876502002" } },
    },
  });
  await prisma.user.create({
    data: {
      id: "user-student-1a-01",
      email: "student.1a.01@school.test",
      password,
      name: "Aisha Khan",
      roleId: roleIds.STUDENT,
    },
  });

  await prisma.student.create({
    data: {
      id: "student-aisha",
      userId: "user-student-1a-01",
      parentId: "parent-1a",
      classId: class1A,
      admissionNo: "ADM-1A-01",
      name: "Aisha Khan",
      dateOfBirth: new Date("2018-01-15T00:00:00.000Z"),
      billingStartPeriod: "2026-04",
      feeInvoices: {
        create: {
          id: "invoice-aisha-april",
          title: "April",
          period: "2026-04",
          amount: 1000,
          dueDate: new Date("2026-04-10T00:00:00.000Z"),
          status: "DUE",
          linesJson: "[]",
        },
      },
    },
  });
  await prisma.student.create({
    data: {
      id: "student-rohan",
      parentId: "parent-1a",
      classId: class1A,
      admissionNo: "ADM-1A-02",
      name: "Rohan Khan",
      dateOfBirth: new Date("2019-03-20T00:00:00.000Z"),
      billingStartPeriod: "2026-04",
    },
  });
  await prisma.student.create({
    data: {
      id: "student-other-child",
      parentId: "parent-other",
      classId: class2A,
      admissionNo: "ADM-2A-01",
      name: "Other Child",
      dateOfBirth: new Date("2018-06-01T00:00:00.000Z"),
      billingStartPeriod: "2026-04",
      feeInvoices: {
        create: {
          id: "invoice-other-april",
          title: "April",
          period: "2026-04",
          amount: 1000,
          dueDate: new Date("2026-04-10T00:00:00.000Z"),
          status: "DUE",
          linesJson: "[]",
        },
      },
    },
  });

  await prisma.staffMember.create({
    data: {
      id: "staff-ramesh",
      name: "Ramesh Kulkarni",
      title: "Support staff",
      phone: "9876503001",
      employeeId: "S-RAM-1",
      kind: "SUPPORT",
      joinedOn: "2026-04-01",
    },
  });

  const studentLeave = await prisma.leaveType.create({
    data: { name: "Sick", forStudent: true, forTeacher: false, forStaff: false, noticeDays: 0 },
  });
  const staffLeave = await prisma.leaveType.create({
    data: { name: "Casual", forStudent: false, forTeacher: true, forStaff: true, noticeDays: 0 },
  });

  await prisma.subject.create({
    data: { id: "subject-1a-math", name: "Mathematics", classId: class1A, teacherId: "teacher-kavita", weightage: 6 },
  });
  await prisma.subject.create({
    data: { id: "subject-2a-math", name: "Mathematics", classId: class2A, teacherId: "teacher-sandeep-rbac", weightage: 6 },
  });

  return {
    ...fixture,
    class1A,
    class2A,
    aishaId: "student-aisha",
    rohanId: "student-rohan",
    otherChildId: "student-other-child",
    kavitaId: "user-kavita",
    kavitaTeacherId: "teacher-kavita",
    sandeepId: "user-sandeep",
    sandeepTeacherId: "teacher-sandeep-rbac",
    reportTeacherUserId: "user-report-teacher",
    leaveTypeStudentId: studentLeave.id,
    leaveTypeStaffId: staffLeave.id,
  };
}

export async function replaceRoleGrants(
  prisma: PrismaClient,
  roleId: string,
  permissions: string[],
  portal: "OFFICE" | "TEACHER" | "PARENT" | "STUDENT" = "OFFICE"
) {
  await prisma.roleGrant.deleteMany({ where: { roleId } });
  if (!permissions.length) return;
  await prisma.roleGrant.createMany({
    data: permissions.map((permission) => ({
      roleId,
      permission,
      scope: scopePolicyFor(permission, portal).defaultScope as AccessScope,
    })),
  });
}

export async function createOfficeActor(
  prisma: PrismaClient,
  permissions: string[],
  passwordHash: string
) {
  const slug = `ACT_${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const role = await prisma.role.create({
    data: {
      name: slug,
      slug,
      portal: "OFFICE",
      isSystem: false,
      grants: {
        create: permissions.map((permission) => ({
          permission,
          scope: validScopeFor(permission, "SCHOOL", "OFFICE")
            ? "SCHOOL"
            : scopePolicyFor(permission, "OFFICE").defaultScope,
        })),
      },
    },
  });
  const email = `${slug.toLowerCase()}@school.test`;
  const user = await prisma.user.create({
    data: {
      email,
      name: "Office actor",
      password: passwordHash,
      roleId: role.id,
    },
  });
  return { roleId: role.id, email, userId: user.id };
}
