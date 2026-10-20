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

describe.sequential("catalog / class plan / routine sync", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "subject-routine-sync-test-secret-with-enough";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    await prisma.class.create({ data: { id: "class-2-a", name: "2", section: "A" } });
    await prisma.class.create({ data: { id: "class-6-b", name: "6", section: "B" } });
    await prisma.teacherSkill.create({
      data: { teacherId: "teacher-tara", classId: fixture.classId, subjectName: "English" },
    });
    await prisma.schoolConfig.update({
      where: { id: "school" },
      data: {
        subjectCatalog: JSON.stringify([
          { code: "ENG", name: "English" },
          { code: "MAT", name: "Mathematics" },
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

  it("does not create a class subject when dropping a skill that is not on the class plan", async () => {
    const before = await prisma.subject.count({ where: { classId: fixture.classId } });
    const dropped = await act(officeToken, "saveTimetableSlot", {
      classId: fixture.classId,
      periodId: "period-1",
      weekday: 2,
      teacherId: "teacher-tara",
      subjectName: "English",
    });
    expect(dropped.status).toBe(400);
    expect(dropped.body.error).toMatch(/not configured for this class|class curriculum/i);
    expect(await prisma.subject.count({ where: { classId: fixture.classId } })).toBe(before);
  });

  it("cannot assign a catalog subject to a class that has not loaded it", async () => {
    const assigned = await act(officeToken, "setTeacherResources", {
      teacherId: "teacher-tara",
      offers: [{ subjectCode: "ENG", subjectName: "English", classId: "class-2-a" }],
    });
    expect(assigned.status).toBe(400);
    expect(assigned.body.error).toMatch(/2-A's class curriculum/i);
  });

  it("rejects loading a subject that is not in the catalog", async () => {
    const loaded = await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [{ code: "ROB", name: "Robotics", weightage: 2 }],
    });
    expect(loaded.status).toBe(400);
    expect(loaded.body.error).toMatch(/catalog/i);
  });

  it("places a slot only for an existing class subject that is in the catalog", async () => {
    await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [
        { code: "MAT", name: "Mathematics", weightage: 2 },
        { code: "ENG", name: "English", weightage: 2 },
      ],
    });
    const english = await prisma.subject.findFirstOrThrow({ where: { classId: fixture.classId, code: "ENG" } });
    const placed = await act(officeToken, "saveTimetableSlot", {
      classId: fixture.classId,
      periodId: "period-1",
      weekday: 2,
      teacherId: "teacher-tara",
      subjectId: english.id,
      subjectName: "English",
    });
    expect(placed.status).toBe(200);
    const slot = await prisma.timetableSlot.findFirst({
      where: { classId: fixture.classId, periodId: "period-1", weekday: 2 },
    });
    expect(slot?.subjectId).toBe(english.id);
  });

  it("counts placed periods by subjectId on the record payload", async () => {
    const record = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${officeToken}` });
    const klass = record.body.timetable.classes.find((row: { id: string }) => row.id === fixture.classId);
    const english = klass.subjects.find((row: { code: string }) => row.code === "ENG");
    const placed = klass.slots.filter((slot: { subjectId: string }) => slot.subjectId === english.id).length;
    expect(english.label).toBe("ENG · English");
    expect(placed).toBe(1);
  });

  it("rejects catalog removal while any class still uses the code", async () => {
    const blocked = await act(officeToken, "saveSchoolSubjects", {
      entries: [{ code: "MAT", name: "Mathematics" }],
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/ENG is still used by 6-A/i);
    expect(await prisma.subject.count({ where: { classId: fixture.classId, code: "ENG" } })).toBe(1);
  });

  it("allows the same code on 6-B and rejects it on class 2", async () => {
    expect(await prisma.subject.count({ where: { classId: "class-6-b", code: "ENG" } })).toBe(1);
    const otherGrade = await act(officeToken, "saveClassCurriculum", {
      classId: "class-2-a",
      subjects: [{ code: "ENG", name: "English", weightage: 2 }],
    });
    expect(otherGrade.status).toBe(400);
    expect(otherGrade.body.error).toMatch(/already used by Class 6/i);
  });

  it("renames class subjects and leftover skill codes when the catalog name changes", async () => {
    await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [
        { code: "ENG", name: "English", weightage: 2 },
        { code: "MAT", name: "Mathematics", weightage: 2 },
      ],
    });
    await prisma.teacherSkill.deleteMany({ where: { teacherId: "teacher-tara", classId: fixture.classId } });
    await prisma.teacherSkill.createMany({
      data: [
        { teacherId: "teacher-tara", classId: fixture.classId, subjectName: "English" },
        { teacherId: "teacher-tara", classId: fixture.classId, subjectName: "ENG" },
      ],
    });
    const renamed = await act(officeToken, "saveSchoolSubjects", {
      entries: [
        { code: "ENG", name: "English Language", previousName: "English", previousCode: "ENG" },
        { code: "MAT", name: "Mathematics" },
      ],
    });
    expect(renamed.status).toBe(200);
    const english = await prisma.subject.findFirstOrThrow({ where: { classId: fixture.classId, code: "ENG" } });
    expect(english.name).toBe("English Language");
    const skills = await prisma.teacherSkill.findMany({
      where: { teacherId: "teacher-tara", classId: fixture.classId },
    });
    expect(skills.map((row) => row.subjectName).sort()).toEqual(["English Language"]);
    const record = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${officeToken}` });
    const teacher = record.body.timetable.teachers.find((row: { id: string }) => row.id === "teacher-tara");
    expect(teacher.skills.map((row: { subjectName: string }) => row.subjectName)).toContain("English Language");
    expect(teacher.skills.map((row: { subjectName: string }) => row.subjectName)).not.toContain("ENG");
  });

  it("creates a new class without copying the catalog onto it", async () => {
    const created = await act(officeToken, "createClass", { name: "3", section: "A" });
    expect(created.status).toBe(200);
    const klass = await prisma.class.findFirstOrThrow({ where: { name: "3", section: "A" } });
    expect(await prisma.subject.count({ where: { classId: klass.id } })).toBe(0);
  });

  it("does not add catalog subjects to a blank class of another grade", async () => {
    expect(await prisma.subject.count({ where: { classId: "class-2-a" } })).toBe(0);
    await act(officeToken, "saveSchoolSubjects", {
      entries: [
        { code: "ENG", name: "English Language" },
        { code: "MAT", name: "Mathematics" },
        { code: "BIO", name: "Biology" },
      ],
    });
    expect(await prisma.subject.count({ where: { classId: "class-2-a" } })).toBe(0);
    const applied = await act(officeToken, "saveSchoolSubjects", {
      entries: [
        { code: "ENG", name: "English Language" },
        { code: "MAT", name: "Mathematics" },
        { code: "BIO", name: "Biology" },
      ],
      applyToAllClasses: true,
    });
    expect(applied.status).toBe(200);
    expect(await prisma.subject.count({ where: { classId: "class-2-a", code: "BIO" } })).toBe(0);
    expect(await prisma.subject.count({ where: { classId: "class-6-b", code: "ENG" } })).toBe(1);
    expect(await prisma.subject.count({ where: { classId: fixture.classId, code: "BIO" } })).toBe(0);
  });

  it("stores new teacher assignments as subject code and sets Subject.teacherId", async () => {
    const saved = await act(officeToken, "setTeacherResources", {
      teacherId: "teacher-tara",
      offers: [
        { subjectCode: "ENG", subjectName: "English Language", classId: fixture.classId },
        { subjectCode: "MAT", subjectName: "Mathematics", classId: fixture.classId },
      ],
    });
    expect(saved.status).toBe(200);
    const skills = await prisma.teacherSkill.findMany({ where: { teacherId: "teacher-tara" } });
    expect(skills.map((row) => row.subjectName).sort()).toEqual(["ENG", "MAT"]);
    const english = await prisma.subject.findFirstOrThrow({ where: { classId: fixture.classId, code: "ENG" } });
    expect(english.teacherId).toBe("teacher-tara");
  });

  it("rejects placing a teacher who is not assigned that class subject", async () => {
    const english = await prisma.subject.findFirstOrThrow({ where: { classId: "class-6-b", code: "ENG" } });
    const placed = await act(officeToken, "saveTimetableSlot", {
      classId: "class-6-b",
      periodId: "period-1",
      weekday: 1,
      teacherId: "teacher-tara",
      subjectId: english.id,
      subjectName: "ENG",
    });
    expect(placed.status).toBe(400);
    expect(placed.body.error).toMatch(/not assigned ENG for class 6-B/i);
  });

  it("rejects a teacher who is already in another class that period", async () => {
    await act(officeToken, "setTeacherResources", {
      teacherId: "teacher-tara",
      offers: [
        { subjectCode: "ENG", classId: fixture.classId },
        { subjectCode: "ENG", classId: "class-6-b" },
      ],
    });
    const english = await prisma.subject.findFirstOrThrow({ where: { classId: "class-6-b", code: "ENG" } });
    const busy = await act(officeToken, "saveTimetableSlot", {
      classId: "class-6-b",
      periodId: "period-1",
      weekday: 2,
      teacherId: "teacher-tara",
      subjectId: english.id,
      subjectName: "ENG",
    });
    expect(busy.status).toBe(400);
    expect(busy.body.error).toMatch(/already in another class/i);
  });

  it("rejects placing more periods than the class subject weightage", async () => {
    const english = await prisma.subject.findFirstOrThrow({ where: { classId: fixture.classId, code: "ENG" } });
    await prisma.subject.update({ where: { id: english.id }, data: { weightage: 1 } });
    const extra = await act(officeToken, "saveTimetableSlot", {
      classId: fixture.classId,
      periodId: "period-1",
      weekday: 3,
      teacherId: "teacher-tara",
      subjectId: english.id,
      subjectName: "ENG",
    });
    expect(extra.status).toBe(400);
    expect(extra.body.error).toMatch(/already 1\/1/i);
    const slot = await prisma.timetableSlot.findFirst({
      where: { classId: fixture.classId, periodId: "period-1", weekday: 2 },
    });
    expect(slot?.subjectId).toBe(english.id);
  });

  it("replaces a filled cell instead of failing the write", async () => {
    const english = await prisma.subject.findFirstOrThrow({ where: { classId: fixture.classId, code: "ENG" } });
    const maths = await prisma.subject.findFirstOrThrow({ where: { classId: fixture.classId, code: "MAT" } });
    await prisma.subject.update({ where: { id: english.id }, data: { weightage: 6 } });
    const filled = await prisma.timetableSlot.findFirst({
      where: { classId: fixture.classId, periodId: "period-1", weekday: 2 },
    });
    expect(filled?.subjectId).toBe(english.id);
    const again = await act(officeToken, "saveTimetableSlot", {
      classId: fixture.classId,
      periodId: "period-1",
      weekday: 2,
      teacherId: "teacher-tara",
      subjectId: english.id,
      subjectName: "ENG",
    });
    expect(again.status).toBe(200);
    expect(again.body.error).toBeUndefined();
    await act(officeToken, "setTeacherResources", {
      teacherId: "teacher-tara",
      offers: [
        { subjectCode: "ENG", classId: fixture.classId },
        { subjectCode: "MAT", classId: fixture.classId },
      ],
    });
    const swapped = await act(officeToken, "saveTimetableSlot", {
      classId: fixture.classId,
      periodId: "period-1",
      weekday: 2,
      teacherId: "teacher-tara",
      subjectId: maths.id,
      subjectName: "MAT",
    });
    expect(swapped.status).toBe(200);
    expect(swapped.body.error).toBeUndefined();
    const after = await prisma.timetableSlot.findFirst({
      where: { classId: fixture.classId, periodId: "period-1", weekday: 2 },
    });
    expect(after?.id).toBe(filled?.id);
    expect(after?.subjectId).toBe(maths.id);
    const restored = await act(officeToken, "saveTimetableSlot", {
      classId: fixture.classId,
      periodId: "period-1",
      weekday: 2,
      teacherId: "teacher-tara",
      subjectId: english.id,
      subjectName: "ENG",
    });
    expect(restored.status).toBe(200);
    const back = await prisma.timetableSlot.findFirst({
      where: { classId: fixture.classId, periodId: "period-1", weekday: 2 },
    });
    expect(back?.subjectId).toBe(english.id);
  });

  it("clears routine slots and teacher assignment when a class subject is removed", async () => {
    const english = await prisma.subject.findFirstOrThrow({ where: { classId: fixture.classId, code: "ENG" } });
    expect(await prisma.timetableSlot.count({ where: { subjectId: english.id } })).toBeGreaterThan(0);
    const saved = await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [{ code: "MAT", name: "Mathematics", weightage: 2 }],
    });
    expect(saved.status).toBe(200);
    expect(await prisma.subject.count({ where: { id: english.id } })).toBe(0);
    expect(await prisma.timetableSlot.count({ where: { subjectId: english.id } })).toBe(0);
    expect(
      await prisma.teacherSkill.count({
        where: { classId: fixture.classId, subjectName: { in: ["ENG", "English Language", "English"] } },
      })
    ).toBe(0);
    expect(await prisma.subject.count({ where: { classId: "class-6-b", code: "ENG" } })).toBe(0);
    expect(await prisma.subject.count({ where: { classId: "class-6-b", code: "MAT" } })).toBe(1);
    const catalog = JSON.parse(
      (await prisma.schoolConfig.findUniqueOrThrow({ where: { id: "school" } })).subjectCatalog
    ) as { code: string }[];
    expect(catalog.some((row) => row.code === "ENG")).toBe(true);
  });

  it("keeps the catalog entry after the last class reference is removed", async () => {
    expect(await prisma.subject.count({ where: { code: "ENG" } })).toBe(0);
    expect(await prisma.teacherSkill.count({ where: { classId: fixture.classId, subjectName: { in: ["ENG", "English Language", "English"] } } })).toBe(0);
    const catalog = JSON.parse(
      (await prisma.schoolConfig.findUniqueOrThrow({ where: { id: "school" } })).subjectCatalog
    ) as { code: string }[];
    expect(catalog.some((row) => row.code === "ENG")).toBe(true);
  });

  it("does not blame the routine when only exams still use the subject", async () => {
    const mat = await prisma.subject.findFirstOrThrow({ where: { classId: fixture.classId, code: "MAT" } });
    await prisma.exam.create({
      data: {
        title: "MAT paper",
        subjectId: mat.id,
        classId: fixture.classId,
        date: new Date("2026-09-15T00:00:00.000Z"),
        maxMarks: 80,
      },
    });
    const blocked = await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [],
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toMatch(/exams/i);
    expect(await prisma.subject.count({ where: { id: mat.id } })).toBe(1);
  });
});
