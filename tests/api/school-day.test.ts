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
let teacherToken = "";

async function login(email: string, password = fixture.password) {
  return request(app).post("/api/v1/login").send({ login: email, password });
}

async function act(token: string, op: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/v1/act")
    .set({ Authorization: `Bearer ${token}` })
    .send({ op, ...body });
}

function record(token: string) {
  return request(app).get("/api/v1/record").set({ Authorization: `Bearer ${token}` });
}

describe.sequential("teacher phones setting", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "school-day-setting-test-secret-long-one";
    database = createPushedTestDatabase();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
    teacherToken = (await login(fixture.users.teacher.email)).body.token;
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("is off until the school turns it on", async () => {
    const teacher = await record(teacherToken);
    expect(teacher.body.schoolDay).toMatchObject({ enabled: false, breakDuringClass: "never", endsAt: "last_period", openAppSeconds: 30 });
  });

  it("the office turns it on and teachers get the rules", async () => {
    const saved = await act(officeToken, "saveSchoolDay", {
      enabled: true,
      breakDuringClass: "with_reason",
      endsAt: "14:30",
      breakReasons: ["Lunch", "  Parent meeting ", "lunch"],
      openAppSeconds: 60,
    });
    expect(saved.status).toBe(200);
    const teacher = await record(teacherToken);
    expect(teacher.body.schoolDay).toEqual({ enabled: true, breakDuringClass: "with_reason", endsAt: "14:30", breakReasons: ["Lunch", "Parent meeting"], openAppSeconds: 60 });
    const office = await record(officeToken);
    expect(office.body.school.schoolDay.enabled).toBe(true);
  });

  it("keeps the free time for apps opened from Anekio between 10 seconds and 10 minutes", async () => {
    await act(officeToken, "saveSchoolDay", { enabled: true, breakReasons: ["Lunch"], openAppSeconds: 2 });
    expect((await record(teacherToken)).body.schoolDay.openAppSeconds).toBe(10);
    await act(officeToken, "saveSchoolDay", { enabled: true, breakReasons: ["Lunch"], openAppSeconds: 9999 });
    expect((await record(teacherToken)).body.schoolDay.openAppSeconds).toBe(600);
    await act(officeToken, "saveSchoolDay", { enabled: true, breakReasons: ["Lunch"] });
    expect((await record(teacherToken)).body.schoolDay.openAppSeconds).toBe(30);
  });

  it("refuses a bad end time or no reasons", async () => {
    expect((await act(officeToken, "saveSchoolDay", { enabled: true, endsAt: "25:99", breakReasons: ["Lunch"] })).status).toBe(400);
    expect((await act(officeToken, "saveSchoolDay", { enabled: true, endsAt: "last_period", breakReasons: [] })).status).toBe(400);
  });

  it("keeps the teacher's phone log once and builds the day report", async () => {
    const date = "2026-11-06";
    const at = (h: number, m: number) => new Date(2026, 10, 6, h, m).getTime();
    const events = [
      { id: "a1", type: "start", at: at(8, 0), date },
      { id: "a2", type: "break", at: at(10, 0), date, reason: "Lunch" },
      { id: "a3", type: "resume", at: at(10, 20), date },
      { id: "a4", type: "guard_off", at: at(11, 0), date },
      { id: "a5", type: "break", at: at(12, 0), date, reason: "Personal call" },
      { id: "a6", type: "class_started", at: at(12, 5), date },
      { id: "a7", type: "end", at: at(14, 30), date },
      { id: "a8", type: "outside", at: at(9, 30), date, reason: "Opened from Anekio" },
      { id: "bad", type: "hack", at: at(9, 0), date },
    ];
    expect((await act(teacherToken, "logSchoolDay", { events })).body.saved).toBe(8);
    // Sent again (phone retry): nothing is stored twice.
    expect((await act(teacherToken, "logSchoolDay", { events })).status).toBe(200);
    expect(await prisma.staffPhoneEvent.count()).toBe(8);

    const report = await act(officeToken, "schoolDayReport", { date });
    expect(report.status).toBe(200);
    const tara = report.body.rows.find((r: { name: string }) => r.name === "Tara Teacher");
    expect(tara).toMatchObject({ breakMinutes: 25, guardOff: 1, outside: 1, endedBy: "end" });
    expect(tara.breaks.map((b: { reason: string; minutes: number; endedBy: string }) => [b.reason, b.minutes, b.endedBy])).toEqual([
      ["Lunch", 20, "resume"],
      ["Personal call", 5, "class_started"],
    ]);
    expect(tara.timeline).toHaveLength(8);
  });

  it("only the office can see the report, only teachers can log", async () => {
    expect((await act(teacherToken, "schoolDayReport", { date: "2026-11-06" })).status).toBe(400);
    expect((await act(officeToken, "logSchoolDay", { events: [] })).status).toBe(400);
  });

  it("teachers cannot change it", async () => {
    expect((await act(teacherToken, "saveSchoolDay", { enabled: false, breakReasons: ["Lunch"] })).status).toBe(400);
  });
});
