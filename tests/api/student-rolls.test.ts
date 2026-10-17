import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase;
let prisma: PrismaClient;

describe("student roll backfill", () => {
  beforeAll(async () => {
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    await seedPortalFixture(prisma);
    await prisma.student.create({
      data: {
        id: "student-kabir",
        parentId: "parent-pari",
        classId: "class-6-a",
        admissionNo: "ADM-FIX-2",
        name: "Kabir Student",
        dateOfBirth: new Date("2014-08-01T00:00:00.000Z"),
      },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("gives classmates distinct rolls when many record loads race", async () => {
    const { assignStudentRollNumber, ensureCurrentSessionStudentRollNumbers } = await import("../../lib/student-rolls");

    await Promise.all([
      assignStudentRollNumber(prisma, { studentId: "student-anaya", classId: "class-6-a" }),
      assignStudentRollNumber(prisma, { studentId: "student-kabir", classId: "class-6-a" }),
      ensureCurrentSessionStudentRollNumbers(prisma),
      ensureCurrentSessionStudentRollNumbers(prisma),
    ]);

    const rows = await prisma.studentClassEnrollment.findMany({
      where: { classId: "class-6-a" },
      orderBy: { rollNumber: "asc" },
    });
    expect(rows.map((row) => row.studentId).sort()).toEqual(["student-anaya", "student-kabir"]);
    expect(rows.map((row) => row.rollNumber)).toEqual([1, 2]);
  });

  it("updates a legacy null-org enrollment instead of inserting again", async () => {
    const { assignStudentRollNumber } = await import("../../lib/student-rolls");
    const { runWithoutTenant, setTenantOrg } = await import("../../lib/tenant-context");

    await prisma.student.create({
      data: {
        id: "student-meera",
        orgId: "org-roll-test",
        parentId: "parent-pari",
        classId: "class-6-a",
        admissionNo: "ADM-FIX-3",
        name: "Meera Student",
        dateOfBirth: new Date("2014-09-01T00:00:00.000Z"),
      },
    });
    await runWithoutTenant(() =>
      prisma.studentClassEnrollment.create({
        data: {
          studentId: "student-meera",
          classId: "class-6-a",
          sessionId: "session-2026",
          rollNumber: 9,
          orgId: null,
        },
      })
    );

    setTenantOrg("org-roll-test");
    const row = await assignStudentRollNumber(prisma, {
      studentId: "student-meera",
      classId: "class-6-a",
      orgId: "org-roll-test",
    });
    expect(row.id).toBeDefined();
    expect(row.rollNumber).toBe(9);
    const copies = await runWithoutTenant(() =>
      prisma.studentClassEnrollment.findMany({ where: { studentId: "student-meera" } })
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]?.sessionId).toBe("session-2026");
    expect(copies[0]?.orgId).toBe("org-roll-test");
  });
});
