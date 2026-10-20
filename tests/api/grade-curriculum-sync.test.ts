import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fixture: PortalFixture;
let officeToken = "";

async function login(email: string, password = fixture.password) {
  return request(app).post("/api/v1/login").send({ login: email, password });
}

async function act(token: string, op: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/v1/act")
    .set({ Authorization: `Bearer ${token}` })
    .send({ op, ...body });
}

describe.sequential("grade curriculum sync", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "grade-curriculum-sync-test-secret-ok";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    await prisma.class.create({ data: { id: "class-6-b", name: "6", section: "B" } });
    await prisma.class.create({ data: { id: "class-7-a", name: "7", section: "A" } });
    await prisma.class.create({ data: { id: "class-7-b", name: "7", section: "B" } });
    await prisma.schoolConfig.update({
      where: { id: "school" },
      data: {
        subjectCatalog: JSON.stringify([
          { code: "MATH6", name: "Mathematics" },
          { code: "ENG6", name: "English" },
          { code: "SCI6", name: "Science" },
          { code: "HIN6", name: "Hindi" },
          { code: "MATH7", name: "Mathematics" },
        ]),
      },
    });
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("adds a class subject to every section of that grade", async () => {
    const saved = await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [
        { code: "MATH6", name: "Mathematics", weightage: 2 },
        { code: "ENG6", name: "English", weightage: 2 },
      ],
    });
    expect(saved.status).toBe(200);
    expect(await prisma.subject.count({ where: { classId: fixture.classId, code: "MATH6" } })).toBe(1);
    expect(await prisma.subject.count({ where: { classId: "class-6-b", code: "MATH6" } })).toBe(1);
    expect(await prisma.subject.count({ where: { classId: "class-6-b", code: "ENG6" } })).toBe(1);
    expect(await prisma.subject.count({ where: { classId: "class-7-a", code: "MATH6" } })).toBe(0);
  });

  it("edits name and code on every section of the grade", async () => {
    const beforeA = await prisma.subject.findFirstOrThrow({ where: { classId: fixture.classId, code: "ENG6" } });
    const beforeB = await prisma.subject.findFirstOrThrow({ where: { classId: "class-6-b", code: "ENG6" } });
    const renamed = await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [
        { code: "MATH6", name: "Mathematics", weightage: 2 },
        { id: beforeA.id, previousCode: "ENG6", code: "ENG6A", name: "English Language", weightage: 2 },
      ],
    });
    expect(renamed.status).toBe(200);
    const afterA = await prisma.subject.findUniqueOrThrow({ where: { id: beforeA.id } });
    const afterB = await prisma.subject.findUniqueOrThrow({ where: { id: beforeB.id } });
    expect(afterA.id).not.toBe(afterB.id);
    expect(afterA.code).toBe("ENG6A");
    expect(afterB.code).toBe("ENG6A");
    expect(afterA.name).toBe("English Language");
    expect(afterB.name).toBe("English Language");
    const catalog = JSON.parse(
      (await prisma.schoolConfig.findUniqueOrThrow({ where: { id: "school" } })).subjectCatalog
    ) as { code: string; name: string }[];
    expect(catalog).toEqual(expect.arrayContaining([{ code: "ENG6A", name: "English Language" }]));
    expect(catalog.some((row) => row.code === "ENG6")).toBe(false);
  });

  it("rejects a duplicate code inside the same grade", async () => {
    const duplicate = await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [
        { code: "MATH6", name: "Mathematics", weightage: 2 },
        { code: "MATH6", name: "Math Lab", weightage: 2 },
      ],
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error).toMatch(/already used in Class 6/i);
  });

  it("lets a different grade keep an independent catalog and code", async () => {
    const saved = await act(officeToken, "saveClassCurriculum", {
      classId: "class-7-a",
      subjects: [{ code: "MATH7", name: "Mathematics", weightage: 2 }],
    });
    expect(saved.status).toBe(200);
    expect(await prisma.subject.count({ where: { classId: "class-7-a", code: "MATH7" } })).toBe(1);
    expect(await prisma.subject.count({ where: { classId: "class-7-b", code: "MATH7" } })).toBe(1);
    expect(await prisma.subject.count({ where: { classId: "class-7-a", code: "MATH6" } })).toBe(0);
    expect(await prisma.subject.findFirst({ where: { classId: fixture.classId, code: "MATH6" } })).toBeTruthy();
  });

  it("keeps section routines independent for the same grade subject", async () => {
    const mathA = await prisma.subject.findFirstOrThrow({ where: { classId: fixture.classId, code: "MATH6" } });
    const mathB = await prisma.subject.findFirstOrThrow({ where: { classId: "class-6-b", code: "MATH6" } });
    await act(officeToken, "setTeacherResources", {
      teacherId: "teacher-tara",
      offers: [
        { subjectCode: "MATH6", subjectName: "Mathematics", classId: fixture.classId },
        { subjectCode: "MATH6", subjectName: "Mathematics", classId: "class-6-b" },
      ],
    });
    const slotA = await act(officeToken, "saveTimetableSlot", {
      classId: fixture.classId,
      periodId: "period-1",
      weekday: 2,
      teacherId: "teacher-tara",
      subjectId: mathA.id,
      subjectName: "MATH6",
    });
    const slotB = await act(officeToken, "saveTimetableSlot", {
      classId: "class-6-b",
      periodId: "period-1",
      weekday: 3,
      teacherId: "teacher-tara",
      subjectId: mathB.id,
      subjectName: "MATH6",
    });
    expect(slotA.status).toBe(200);
    expect(slotB.status).toBe(200);
    const placedA = await prisma.timetableSlot.findFirstOrThrow({
      where: { classId: fixture.classId, periodId: "period-1", weekday: 2 },
    });
    const placedB = await prisma.timetableSlot.findFirstOrThrow({
      where: { classId: "class-6-b", periodId: "period-1", weekday: 3 },
    });
    expect(placedA.subjectId).toBe(mathA.id);
    expect(placedB.subjectId).toBe(mathB.id);
    expect(placedA.subjectId).not.toBe(placedB.subjectId);

    const replaced = await act(officeToken, "saveTimetableSlot", {
      classId: fixture.classId,
      periodId: "period-1",
      weekday: 2,
      clear: true,
    });
    expect(replaced.status).toBe(200);
    expect(
      await prisma.timetableSlot.count({ where: { classId: fixture.classId, periodId: "period-1", weekday: 2 } })
    ).toBe(0);
    expect(
      await prisma.timetableSlot.findFirst({ where: { classId: "class-6-b", periodId: "period-1", weekday: 3 } })
    ).toMatchObject({ subjectId: mathB.id });
  });

  it("cleans sibling slots and assignments when a grade subject is removed", async () => {
    const mathB = await prisma.subject.findFirstOrThrow({ where: { classId: "class-6-b", code: "MATH6" } });
    expect(await prisma.timetableSlot.count({ where: { subjectId: mathB.id } })).toBe(1);
    const saved = await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [{ code: "ENG6A", name: "English Language", weightage: 2 }],
    });
    expect(saved.status).toBe(200);
    expect(await prisma.subject.count({ where: { code: "MATH6" } })).toBe(0);
    expect(await prisma.timetableSlot.count({ where: { subjectId: mathB.id } })).toBe(0);
    expect(
      await prisma.teacherSkill.count({
        where: { subjectName: { in: ["MATH6", "Mathematics"] } },
      })
    ).toBe(0);
    expect(await prisma.subject.count({ where: { classId: "class-6-b", code: "ENG6A" } })).toBe(1);
    expect(await prisma.subject.count({ where: { classId: "class-7-a", code: "MATH7" } })).toBe(1);
  });

  it("copies the shared grade catalog onto a new section", async () => {
    const created = await act(officeToken, "createClass", { name: "6", section: "C" });
    expect(created.status).toBe(200);
    const klass = await prisma.class.findFirstOrThrow({ where: { name: "6", section: "C" } });
    expect(await prisma.subject.count({ where: { classId: klass.id, code: "ENG6A" } })).toBe(1);
    expect(await prisma.timetableSlot.count({ where: { classId: klass.id } })).toBe(0);
  });

  it("renames a class without changing its id", async () => {
    const created = await act(officeToken, "createClass", { name: "8", section: "A" });
    expect(created.status).toBe(200);
    const klass = await prisma.class.findFirstOrThrow({ where: { name: "8", section: "A" } });
    const renamed = await act(officeToken, "updateClass", { classId: klass.id, name: "BODH", section: "A" });
    expect(renamed.status).toBe(200);
    expect(await prisma.class.findUniqueOrThrow({ where: { id: klass.id } })).toMatchObject({
      name: "BODH",
      section: "A",
    });
    const clash = await act(officeToken, "updateClass", { classId: klass.id, name: "7", section: "A" });
    expect(clash.status).toBe(400);
  });
});
