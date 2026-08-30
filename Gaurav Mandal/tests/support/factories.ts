import type { Portal, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { defaultGrants, scopePolicyFor, SYSTEM_ROLES } from "../../lib/permissions";

const FIXTURE_PASSWORD = "fixture-pass-123";

export type PortalFixture = {
  password: string;
  classId: string;
  studentId: string;
  users: Record<
    "office" | "teacher" | "parent" | "student",
    {
      id: string;
      email: string;
      phone: string | null;
      name: string;
      portal: Portal;
      expectedPermission: string;
    }
  >;
};

/** Build the smallest connected school graph that exercises all four record payloads. */
export async function seedPortalFixture(prisma: PrismaClient): Promise<PortalFixture> {
  const roleIds: Record<string, string> = {};
  for (const role of SYSTEM_ROLES) {
    const created = await prisma.role.create({
      data: {
        id: `role-${role.slug.toLowerCase()}`,
        name: role.name,
        slug: role.slug,
        portal: role.portal,
        description: role.description,
        isSystem: true,
        grants: {
          create: defaultGrants(role.slug).map((permission) => ({
            permission,
            scope: role.slug === "ADMIN" ? "SCHOOL" : scopePolicyFor(permission).defaultScope,
          })),
        },
      },
    });
    roleIds[role.slug] = created.id;
  }
  await prisma.role.create({
    data: {
      id: "role-legacy-office",
      name: "Legacy office",
      slug: "LEGACY_OFFICE",
      portal: "OFFICE",
      grants: { create: [{ permission: "desk.view" }, { permission: "leave.decide" }] },
    },
  });
  await prisma.role.create({
    data: {
      id: "role-legacy-teacher",
      name: "Legacy teacher manager",
      slug: "LEGACY_TEACHER_MANAGER",
      portal: "TEACHER",
      grants: { create: [{ permission: "leave.decide", scope: "SCHOOL" }] },
    },
  });

  const password = await bcrypt.hash(FIXTURE_PASSWORD, 4);
  const classId = "class-6-a";
  const studentId = "student-anaya";

  await prisma.schoolConfig.create({
    data: {
      id: "school",
      name: "Fixture Academy",
      weekdays: "[1,2,3,4,5,6]",
      sessionStart: "2026-04-01",
      sessionEnd: "2027-03-31",
      subjectCatalog: "[\"Mathematics\"]",
    },
  });
  await prisma.schoolSession.create({
    data: {
      id: "session-2026",
      label: "2026–27",
      startsOn: "2026-04-01",
      endsOn: "2027-03-31",
      current: true,
      examPlanJson: "[]",
    },
  });
  await prisma.class.create({ data: { id: classId, name: "6", section: "A" } });
  await prisma.period.create({
    data: { id: "period-1", name: "Period 1", startsAt: "09:00", endsAt: "09:40", sortOrder: 1 },
  });
  await prisma.room.create({ data: { id: "room-6-a", name: "Room 6-A" } });

  await prisma.user.create({
    data: {
      id: "user-office",
      email: "office.fixture@school.test",
      password,
      name: "Ojas Office",
      phone: "9876540001",
      roleId: roleIds.ADMIN,
    },
  });
  const teacherUser = await prisma.user.create({
    data: {
      id: "user-teacher",
      email: "teacher.fixture@school.test",
      password,
      name: "Tara Teacher",
      phone: "9876540002",
      roleId: roleIds.TEACHER,
      managerId: "user-office",
      teacher: {
        create: {
          id: "teacher-tara",
          employeeId: "T-FIX-1",
          classId,
          joinedOn: "2026-04-01",
        },
      },
    },
    include: { teacher: true },
  });
  await prisma.user.create({
    data: {
      id: "user-parent",
      email: "parent.fixture@school.test",
      password,
      name: "Pari Parent",
      phone: "9876540003",
      roleId: roleIds.PARENT,
      parent: {
        create: {
          id: "parent-pari",
          phone: "9876540003",
          address: "1 Fixture Road",
          city: "Bengaluru",
          state: "Karnataka",
          pincode: "560001",
        },
      },
    },
  });
  await prisma.user.create({
    data: {
      id: "user-student",
      email: "student.fixture@school.test",
      password,
      name: "Anaya Student",
      roleId: roleIds.STUDENT,
    },
  });

  const subject = await prisma.subject.create({
    data: {
      id: "subject-mathematics",
      name: "Mathematics",
      classId,
      teacherId: teacherUser.teacher!.id,
      weightage: 6,
    },
  });
  await prisma.timetableSlot.create({
    data: {
      id: "slot-monday-1",
      classId,
      periodId: "period-1",
      weekday: 1,
      subjectId: subject.id,
      teacherId: teacherUser.teacher!.id,
      roomId: "room-6-a",
    },
  });
  await prisma.student.create({
    data: {
      id: studentId,
      userId: "user-student",
      parentId: "parent-pari",
      classId,
      admissionNo: "ADM-FIX-1",
      name: "Anaya Student",
      dateOfBirth: new Date("2014-06-15T00:00:00.000Z"),
      payToken: "pay-anaya-fixture",
      interests: { create: [{ tag: "SCIENCE" }] },
      attendance: {
        create: [
          {
            id: "attendance-anaya-1",
            date: new Date("2026-08-20T00:00:00.000Z"),
            status: "PRESENT",
            markedById: "user-teacher",
          },
        ],
      },
      feeInvoices: {
        create: [
          {
            id: "invoice-anaya-april",
            classId,
            period: "2026-04",
            title: "April fees",
            amount: 250000,
            dueDate: new Date("2027-04-10T00:00:00.000Z"),
            shareToken: "invoice-anaya-april",
          },
        ],
      },
    },
  });
  await prisma.notice.create({
    data: {
      id: "notice-fixture",
      title: "Fixture circular",
      body: "The fixture school is open.",
      kind: "CIRCULAR",
      priority: "INFO",
      authorId: "user-office",
      audiences: {
        create: (["OFFICE", "TEACHER", "PARENT", "STUDENT"] as Portal[]).map((portal) => ({ portal })),
      },
      classes: { create: [{ classId }] },
    },
  });
  await prisma.leaveType.createMany({
    data: [
      { id: "leave-planned", name: "Planned", noticeDays: 1, yearlyCap: 10, sortOrder: 0 },
      { id: "leave-sick", name: "Sick", noticeDays: 0, yearlyCap: 8, sortOrder: 1 },
    ],
  });

  return {
    password: FIXTURE_PASSWORD,
    classId,
    studentId,
    users: {
      office: {
        id: "user-office",
        email: "office.fixture@school.test",
        phone: "9876540001",
        name: "Ojas Office",
        portal: "OFFICE",
        expectedPermission: "desk.view",
      },
      teacher: {
        id: "user-teacher",
        email: "teacher.fixture@school.test",
        phone: "9876540002",
        name: "Tara Teacher",
        portal: "TEACHER",
        expectedPermission: "attendance.mark",
      },
      parent: {
        id: "user-parent",
        email: "parent.fixture@school.test",
        phone: "9876540003",
        name: "Pari Parent",
        portal: "PARENT",
        expectedPermission: "children.view",
      },
      student: {
        id: "user-student",
        email: "student.fixture@school.test",
        phone: null,
        name: "Anaya Student",
        portal: "STUDENT",
        expectedPermission: "self.view",
      },
    },
  };
}
