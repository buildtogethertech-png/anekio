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

describe.sequential("subject code API", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "subject-code-test-secret-with-enough-entropy";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    await prisma.class.create({ data: { id: "class-6-b", name: "6", section: "B" } });
    await prisma.class.create({ data: { id: "class-2-a", name: "2", section: "A" } });
    app = (await import("../../server/index")).default;
    const signed = await login(fixture.users.office.email);
    officeToken = signed.body.token;
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("stores catalog as code + name objects and exposes them on record", async () => {
    const saved = await act(officeToken, "saveSchoolSubjects", {
      entries: [
        { code: "ENG", name: "English" },
        { code: "MAT", name: "Mathematics" },
        { code: "HIN", name: "Hindi" },
      ],
    });
    expect(saved.status).toBe(200);
    const record = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${officeToken}` });
    expect(record.body.school.subjectCatalog).toEqual([
      { code: "ENG", name: "English" },
      { code: "MAT", name: "Mathematics" },
      { code: "HIN", name: "Hindi" },
    ]);
  });

  it("allows the same code on 6-A and 6-B and rejects it on class 2", async () => {
    const first = await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [
        { code: "ENG", name: "English", weightage: 1 },
        { code: "MAT", name: "Mathematics", weightage: 2 },
        { code: "HIN", name: "Hindi", weightage: 1 },
      ],
    });
    expect(first.status).toBe(200);
    const sibling = await act(officeToken, "saveClassCurriculum", {
      classId: "class-6-b",
      subjects: [{ code: "ENG", name: "English", weightage: 1 }],
    });
    expect(sibling.status).toBe(200);
    const otherGrade = await act(officeToken, "saveClassCurriculum", {
      classId: "class-2-a",
      subjects: [{ code: "ENG", name: "English", weightage: 1 }],
    });
    expect(otherGrade.status).toBe(400);
    expect(otherGrade.body.error).toMatch(/already used by Class 6/i);
    const duplicate = await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [
        { code: "ENG", name: "English", weightage: 4 },
        { code: "ENG", name: "English Language", weightage: 3 },
      ],
    });
    expect(duplicate.status).not.toBe(200);
    expect(await prisma.subject.count({ where: { classId: fixture.classId, code: "ENG" } })).toBe(1);
    expect(await prisma.subject.count({ where: { classId: "class-6-b", code: "ENG" } })).toBe(1);
    expect(await prisma.subject.count({ where: { classId: "class-2-a", code: "ENG" } })).toBe(0);
  });

  it("updates code and name in place without changing Subject.id", async () => {
    const before = await prisma.subject.findFirstOrThrow({ where: { classId: fixture.classId, code: "ENG" } });
    const renamed = await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [
        { id: before.id, previousCode: "ENG", code: "ENG", name: "English Language", weightage: 1 },
        { code: "MAT", name: "Mathematics", weightage: 2 },
        { code: "HIN", name: "Hindi", weightage: 1 },
      ],
    });
    expect(renamed.status).toBe(200);
    const afterName = await prisma.subject.findUniqueOrThrow({ where: { id: before.id } });
    expect(afterName.code).toBe("ENG");
    expect(afterName.name).toBe("English Language");
    const recoded = await act(officeToken, "saveClassCurriculum", {
      classId: fixture.classId,
      subjects: [
        { id: before.id, previousCode: "ENG", code: "ENGL", name: "English Language", weightage: 1 },
        { code: "MAT", name: "Mathematics", weightage: 2 },
        { code: "HIN", name: "Hindi", weightage: 1 },
      ],
    });
    expect(recoded.status).toBe(200);
    const afterCode = await prisma.subject.findUniqueOrThrow({ where: { id: before.id } });
    expect(afterCode.id).toBe(before.id);
    expect(afterCode.code).toBe("ENGL");
    const record = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${officeToken}` });
    const klass = record.body.timetable.classes.find((row: { id: string }) => row.id === fixture.classId);
    const english = klass.subjects.find((row: { id: string }) => row.id === before.id);
    expect(english.code).toBe("ENGL");
    expect(english.label).toBe("ENGL · English Language");
  });

  it("does not duplicate when applying the catalog twice", async () => {
    const payload = {
      entries: [
        { code: "ENG", name: "English" },
        { code: "ENGL", name: "English Language" },
        { code: "MAT", name: "Mathematics" },
        { code: "HIN", name: "Hindi" },
      ],
      applyToAllClasses: true,
    };
    expect((await act(officeToken, "saveSchoolSubjects", payload)).status).toBe(200);
    expect((await act(officeToken, "saveSchoolSubjects", payload)).status).toBe(200);
    const count = await prisma.subject.count({ where: { classId: "class-6-b", code: "MAT" } });
    expect(count).toBe(1);
  });
});
