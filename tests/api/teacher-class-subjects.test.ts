import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";
import { skillMatchesSubject } from "../../lib/subject-code";
import { teacherMayHostClassTest } from "../../lib/exam-evaluators";

let prisma: PrismaClient;
let database: TestDatabase;

describe("teacher class subject compatibility", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "teacher-subject-test-secret-with-enough-entropy";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    await seedPortalFixture(prisma);
    await prisma.teacherSkill.create({
      data: { teacherId: "teacher-tara", classId: "class-6-a", subjectName: "English" },
    });
    await prisma.subject.create({
      data: {
        id: "subject-english",
        code: "ENG",
        name: "English",
        classId: "class-6-a",
        teacherId: "teacher-tara",
        weightage: 4,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("matches a legacy TeacherSkill name to a coded Subject", () => {
    expect(skillMatchesSubject("English", { code: "ENG", name: "English" })).toBe(true);
    expect(skillMatchesSubject("ENG", { code: "ENG", name: "English" })).toBe(true);
  });

  it("lets the assigned teacher host a class test after codes are added", async () => {
    await expect(teacherMayHostClassTest("teacher-tara", "class-6-a", "subject-english")).resolves.toBe(true);
    await expect(teacherMayHostClassTest("teacher-tara", "class-6-a", "subject-mathematics")).resolves.toBe(true);
  });
});
