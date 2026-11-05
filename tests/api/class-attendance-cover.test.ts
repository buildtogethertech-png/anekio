import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { staffDayYmd } from "../../lib/staff-day";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fixture: PortalFixture;
let officeToken = "";
let rheaToken = "";
let taraToken = "";
const today = staffDayYmd(new Date());
// The fixture school works Monday to Saturday.
const schoolDay = new Date().getDay() !== 0;

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 1 = Monday … 7 = Sunday, like TimetableSlot.weekday. */
function weekdayOf(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 ? 7 : day;
}

async function login(email: string, password = fixture.password) {
  return request(app).post("/api/v1/login").send({ login: email, password });
}

async function act(token: string, op: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/v1/act")
    .set({ Authorization: `Bearer ${token}` })
    .send({ op, ...body });
}

async function record(token: string) {
  return request(app).get("/api/v1/record").set({ Authorization: `Bearer ${token}` });
}

function markTara(status: string) {
  return act(officeToken, "markStaffAttendance", { date: today, rows: [{ kind: "teacher", id: "teacher-tara", status }] });
}

describe.sequential.skipIf(!schoolDay)("class attendance cover", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "class-attendance-cover-test-secret-long";
    database = createPushedTestDatabase();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    const teacherLogin = await prisma.user.findUniqueOrThrow({ where: { id: "user-teacher" } });
    await prisma.teacher.create({
      data: {
        id: "teacher-rhea",
        employeeId: "T-FIX-2",
        user: {
          create: {
            id: "user-rhea",
            email: "rhea.fixture@school.test",
            password: teacherLogin.password,
            name: "Rhea Fixture",
            roleId: teacherLogin.roleId,
          },
        },
      },
    });
    await prisma.timetableSlot.create({
      data: { id: "slot-tara-today", classId: fixture.classId, periodId: "period-1", weekday: weekdayOf(today), teacherId: "teacher-tara" },
    });
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
    taraToken = (await login(fixture.users.teacher.email)).body.token;
    rheaToken = (await login("rhea.fixture@school.test")).body.token;
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("marking a class teacher absent opens their periods and shows the gap on the office home", async () => {
    expect((await markTara("ABSENT")).status).toBe(200);
    const open = await prisma.substituteAssignment.findMany({ where: { date: today, absentTeacherId: "teacher-tara" } });
    expect(open).toHaveLength(1);
    expect(open[0].status).toBe("OPEN");

    const office = await record(officeToken);
    const gap = office.body.dayGaps.gaps.find((g: { teacherId: string }) => g.teacherId === "teacher-tara");
    expect(gap).toMatchObject({ openPeriods: 1, classId: fixture.classId, classLabel: "6-A", attendanceBy: null, attendanceDone: false });
    expect(gap.candidates.map((c: { id: string }) => c.id)).toContain("teacher-rhea");
  });

  it("another teacher cannot mark the class until the office hands it over", async () => {
    const before = await act(rheaToken, "markAttendance", { date: today, rows: [{ studentId: fixture.studentId, status: "PRESENT" }] });
    expect(before.status).toBe(400);
    expect(before.body.error).toMatch(/own class/i);

    const assigned = await act(officeToken, "assignAttendanceCover", { date: today, classId: fixture.classId, teacherId: "teacher-rhea" });
    expect(assigned.status).toBe(200);

    const rhea = await record(rheaToken);
    expect(rhea.body.attendanceCovers).toHaveLength(1);
    expect(rhea.body.attendanceCovers[0]).toMatchObject({ classId: fixture.classId, classLabel: "6-A", forTeacher: "Tara Teacher" });
    expect(rhea.body.attendanceCovers[0].roster.map((s: { id: string }) => s.id)).toContain(fixture.studentId);
    expect(await prisma.notice.count({ where: { recipients: { some: { userId: "user-rhea" } }, title: { contains: "6-A" } } })).toBeGreaterThan(0);

    const saved = await act(rheaToken, "markAttendance", { date: today, rows: [{ studentId: fixture.studentId, status: "PRESENT" }] });
    expect(saved.status).toBe(200);
    const yesterday = await act(rheaToken, "markAttendance", { date: addDays(today, -1), rows: [{ studentId: fixture.studentId, status: "PRESENT" }] });
    expect(yesterday.status).toBe(400);

    const office = await record(officeToken);
    const gap = office.body.dayGaps.gaps.find((g: { teacherId: string }) => g.teacherId === "teacher-tara");
    expect(gap.attendanceBy).toMatchObject({ id: "teacher-rhea" });
  });

  it("the class teacher keeps their own class", async () => {
    const own = await act(taraToken, "markAttendance", { date: today, rows: [{ studentId: fixture.studentId, status: "PRESENT" }] });
    expect(own.status).toBe(200);
  });

  it("refuses a hand-over to someone who is out, or for a past day", async () => {
    const toTara = await act(officeToken, "assignAttendanceCover", { date: today, classId: fixture.classId, teacherId: "teacher-tara" });
    expect(toTara.status).toBe(400);
    const past = await act(officeToken, "assignAttendanceCover", { date: addDays(today, -1), classId: fixture.classId, teacherId: "teacher-rhea" });
    expect(past.status).toBe(400);
  });

  it("marking the class teacher present again takes back the periods and the hand-over", async () => {
    expect((await markTara("PRESENT")).status).toBe(200);
    expect(await prisma.substituteAssignment.count({ where: { date: today, absentTeacherId: "teacher-tara" } })).toBe(0);
    expect(await prisma.classAttendanceCover.count({ where: { date: today } })).toBe(0);
    const after = await act(rheaToken, "markAttendance", { date: today, rows: [{ studentId: fixture.studentId, status: "PRESENT" }] });
    expect(after.status).toBe(400);
    const office = await record(officeToken);
    expect(office.body.dayGaps.gaps.find((g: { teacherId: string }) => g.teacherId === "teacher-tara")).toBeUndefined();
  });

  it("the office can remove a hand-over", async () => {
    expect((await markTara("ABSENT")).status).toBe(200);
    expect((await act(officeToken, "assignAttendanceCover", { date: today, classId: fixture.classId, teacherId: "teacher-rhea" })).status).toBe(200);
    expect((await act(officeToken, "clearAttendanceCover", { date: today, classId: fixture.classId })).status).toBe(200);
    expect(await prisma.classAttendanceCover.count({ where: { date: today } })).toBe(0);
    expect((await record(rheaToken)).body.attendanceCovers).toHaveLength(0);
  });

  it("does not ask for a hand-over when another class teacher of the class is in", async () => {
    const teacherLogin = await prisma.user.findUniqueOrThrow({ where: { id: "user-teacher" } });
    await prisma.teacher.create({
      data: {
        id: "teacher-co",
        employeeId: "T-FIX-3",
        class: { connect: { id: fixture.classId } },
        user: { create: { id: "user-co", email: "co.fixture@school.test", password: teacherLogin.password, name: "Co Teacher", roleId: teacherLogin.roleId } },
      },
    });
    const office = await record(officeToken);
    const gap = office.body.dayGaps.gaps.find((g: { teacherId: string }) => g.teacherId === "teacher-tara");
    expect(gap).toMatchObject({ openPeriods: 1, classId: "" });
    await prisma.teacher.delete({ where: { id: "teacher-co" } });
  });

  it("teachers cannot hand over attendance themselves", async () => {
    const res = await act(rheaToken, "assignAttendanceCover", { date: today, classId: fixture.classId, teacherId: "teacher-rhea" });
    expect(res.status).toBe(400);
  });
});
