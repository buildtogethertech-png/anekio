import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

function saveSlot(body: Record<string, unknown>) {
  return act(officeToken, "saveTimetableSlot", { classId: fixture.classId, periodId: "period-1", weekday: 1, ...body });
}

describe.sequential("timetable activities", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "timetable-activity-test-secret-long-one";
    database = createPushedTestDatabase();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    await prisma.class.create({ data: { id: "class-6-b", name: "6", section: "B" } });
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("keeps a school activity list (defaults until saved) and per-class periods a week", async () => {
    const before = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${officeToken}` });
    expect(before.body.school.activityCatalog).toContain("Games");

    const saved = await act(officeToken, "saveActivityCatalog", { entries: [{ name: "Games" }, { name: "Assembly" }, { name: "Library" }] });
    expect(saved.status).toBe(200);
    const plan = await act(officeToken, "saveClassActivities", { classId: fixture.classId, activities: [{ name: "games", perWeek: 2 }, { name: "Assembly", perWeek: 3 }] });
    expect(plan.status).toBe(200);
    const unknown = await act(officeToken, "saveClassActivities", { classId: fixture.classId, activities: [{ name: "Robotics", perWeek: 1 }] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/not in the school's activities/);

    const office = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${officeToken}` });
    const klass = office.body.timetable.classes.find((c: { id: string }) => c.id === fixture.classId);
    expect(klass.activities).toEqual([
      { name: "Games", perWeek: 2 },
      { name: "Assembly", perWeek: 3 },
    ]);
  });

  it("refuses an activity the class does not have", async () => {
    const res = await saveSlot({ activity: "Library", teacherId: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not set for 6-A/);
  });

  it("puts an activity in a period without making it a subject", async () => {
    const subjectsBefore = await prisma.subject.count({ where: { classId: fixture.classId } });
    const res = await saveSlot({ activity: "  Games ", teacherId: "teacher-tara" });
    expect(res.status).toBe(200);
    const slot = await prisma.timetableSlot.findFirstOrThrow({ where: { classId: fixture.classId, periodId: "period-1", weekday: 1 } });
    expect(slot).toMatchObject({ activity: "Games", subjectId: null, teacherId: "teacher-tara" });
    expect(await prisma.subject.count({ where: { classId: fixture.classId } })).toBe(subjectsBefore);
  });

  it("shows the activity in the office timetable, and not as a class subject", async () => {
    const office = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${officeToken}` });
    const klass = office.body.timetable.classes.find((c: { id: string }) => c.id === fixture.classId);
    const slot = klass.slots.find((s: { weekday: number; periodId: string }) => s.weekday === 1 && s.periodId === "period-1");
    expect(slot).toMatchObject({ subject: "Games", activity: true, teacher: "Tara Teacher" });
    expect((klass.subjects || []).map((s: { name: string }) => s.name)).not.toContain("Games");
  });

  it("allows an activity with no teacher", async () => {
    const res = await saveSlot({ activity: "Assembly", teacherId: null });
    expect(res.status).toBe(200);
    const slot = await prisma.timetableSlot.findFirstOrThrow({ where: { classId: fixture.classId, periodId: "period-1", weekday: 1 } });
    expect(slot).toMatchObject({ activity: "Assembly", teacherId: null });
  });

  it("refuses a teacher who is in another class that period", async () => {
    await prisma.timetableSlot.create({ data: { classId: "class-6-b", periodId: "period-1", weekday: 2, teacherId: "teacher-tara", activity: "Library" } });
    await prisma.timetableSlot.create({ data: { classId: fixture.classId, periodId: "period-1", weekday: 4, activity: "Games" } });
    const res = await saveSlot({ weekday: 2, activity: "Games", teacherId: "teacher-tara" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already in 6-B/);
  });

  it("stops at the class's periods a week", async () => {
    // Games is 2 a week: Thursday has one, so Wednesday is the second and Friday is one too many.
    expect((await saveSlot({ weekday: 3, activity: "Games", teacherId: null })).status).toBe(200);
    const third = await saveSlot({ weekday: 5, activity: "Games", teacherId: null });
    expect(third.status).toBe(400);
    expect(third.body.error).toMatch(/already 2\/2/);
    expect((await saveSlot({ weekday: 3, clear: true })).status).toBe(200);
  });

  it("stores the activities a teacher takes per class, only where the class has them", async () => {
    const bad = await act(officeToken, "setTeacherResources", { teacherId: "teacher-tara", activities: [{ name: "Library", classId: fixture.classId }], offers: [] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Library is not set for 6-A/);
    const ok = await act(officeToken, "setTeacherResources", {
      teacherId: "teacher-tara",
      activities: [{ name: "games", classId: fixture.classId }, { name: "Assembly", classId: fixture.classId }],
      offers: [],
    });
    expect(ok.status).toBe(200);
    const office = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${officeToken}` });
    const tara = office.body.timetable.teachers.find((t: { id: string }) => t.id === "teacher-tara");
    expect(tara.activities).toEqual([
      { name: "Games", classId: fixture.classId },
      { name: "Assembly", classId: fixture.classId },
    ]);
    // Saving the form without activities leaves them as they are.
    expect((await act(officeToken, "setTeacherResources", { teacherId: "teacher-tara", offers: [] })).status).toBe(200);
    const kept = await prisma.teacher.findUniqueOrThrow({ where: { id: "teacher-tara" } });
    expect(JSON.parse(kept.activities)).toHaveLength(2);
  });

  it("renames an activity everywhere, and will not remove one still in use", async () => {
    const renamed = await act(officeToken, "saveActivityCatalog", {
      entries: [{ name: "Sports", previousName: "Games" }, { name: "Assembly", previousName: "Assembly" }, { name: "Library", previousName: "Library" }],
    });
    expect(renamed.status).toBe(200);
    expect(await prisma.timetableSlot.count({ where: { activity: "Sports" } })).toBe(1);
    const klass = await prisma.class.findUniqueOrThrow({ where: { id: fixture.classId } });
    expect(JSON.parse(klass.activityPlan)[0]).toEqual({ name: "Sports", perWeek: 2 });
    const tara = await prisma.teacher.findUniqueOrThrow({ where: { id: "teacher-tara" } });
    expect(JSON.parse(tara.activities)).toEqual([
      { name: "Sports", classId: fixture.classId },
      { name: "Assembly", classId: fixture.classId },
    ]);

    const removeUsed = await act(officeToken, "saveActivityCatalog", { entries: [{ name: "Assembly", previousName: "Assembly" }, { name: "Library", previousName: "Library" }] });
    expect(removeUsed.status).toBe(400);
    expect(removeUsed.body.error).toMatch(/Sports is still on 6-A/);
  });

  it("copies activities with Copy day", async () => {
    const res = await act(officeToken, "copyTimetableDay", { classId: fixture.classId, fromWeekday: 1, toWeekdays: [3], mode: "empty" });
    expect(res.status).toBe(200);
    const copied = await prisma.timetableSlot.findFirst({ where: { classId: fixture.classId, periodId: "period-1", weekday: 3 } });
    expect(copied).toMatchObject({ activity: "Assembly", subjectId: null });
  });

  it("dropping an activity from a class drops it from that class's teachers", async () => {
    expect((await act(officeToken, "saveClassActivities", { classId: fixture.classId, activities: [{ name: "Sports", perWeek: 2 }] })).status).toBe(200);
    const tara = await prisma.teacher.findUniqueOrThrow({ where: { id: "teacher-tara" } });
    expect(JSON.parse(tara.activities)).toEqual([{ name: "Sports", classId: fixture.classId }]);
  });

  it("clearing the period removes the activity", async () => {
    expect((await saveSlot({ clear: true })).status).toBe(200);
    expect(await prisma.timetableSlot.count({ where: { classId: fixture.classId, periodId: "period-1", weekday: 1 } })).toBe(0);
  });
});
