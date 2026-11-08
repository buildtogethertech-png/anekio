import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { staffAttendanceInMark, staffDayYmd } from "../../lib/staff-day";
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

describe.sequential("staff attendance QR", () => {
  beforeAll(async () => {
    // A fixed school day (Wednesday, noon in India): never a Sunday, a holiday or just after midnight.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T06:30:00Z"));
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "staff-attendance-qr-test-secret-with-enough";
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
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
    teacherToken = (await login(fixture.users.teacher.email)).body.token;
  }, 90_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("lets a teacher generate a QR before they are marked, and again after the scan (for the exit)", async () => {
    const generated = await act(teacherToken, "generateStaffAttendanceQr");
    expect(generated.status).toBe(200);
    expect(generated.body.qrText).toMatch(/^anekio:staff-attendance:/);

    const scanned = await act(officeToken, "scanStaffAttendanceQr", { code: generated.body.qrText });
    expect(scanned.status).toBe(200);
    expect(scanned.body.person.id).toBe("teacher-tara");
    const firstInAt = scanned.body.inAt;
    expect(firstInAt).toMatch(/^\d{2}:\d{2}$/);

    const again = await act(teacherToken, "generateStaffAttendanceQr");
    expect(again.status).toBe(200);
    expect(again.body.checkedInAt).toBe(firstInAt);

    const reused = await act(officeToken, "scanStaffAttendanceQr", { code: generated.body.qrText });
    expect(reused.status).toBe(400);
    expect(reused.body.error).toMatch(/already used/i);

    const day = await prisma.staffDay.findFirst({ where: { teacherId: "teacher-tara" } });
    expect(staffAttendanceInMark(day)).toBe(true);
    expect(day?.inAt).toBe(firstInAt);

    const officeRecord = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${officeToken}` });
    expect(officeRecord.status).toBe(200);
    const tara = officeRecord.body.staff.find((row: { id: string }) => row.id === "teacher-tara");
    const today = staffDayYmd(new Date());
    const timesheetDay = (tara?.days || []).find((row: { date: string }) => row.date === today);
    expect(timesheetDay?.inAt).toBe(firstInAt);
    expect(timesheetDay?.status).toMatch(/PRESENT|LATE/);
  });

  it("exposes today's mark on the teacher record without a refresh race", async () => {
    const record = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${teacherToken}` });
    expect(record.status).toBe(200);
    expect(record.body.staffAttendanceSelf.today.marked).toBe(true);
    expect(record.body.staffAttendanceSelf.today.date).toBe(staffDayYmd(new Date()));
  });

  it("takes any scan after check-in as the exit, even right away (last scan wins)", async () => {
    const before = await prisma.staffDay.findFirstOrThrow({ where: { teacherId: "teacher-tara" } });
    const quick = await act(teacherToken, "generateStaffAttendanceQr");
    const right = await act(officeToken, "scanStaffAttendanceQr", { code: quick.body.qrText });
    expect(right.status).toBe(200);
    expect(right.body).toMatchObject({ checkedOut: true, inAt: before.inAt });

    const day = await prisma.staffDay.findFirstOrThrow({ where: { teacherId: "teacher-tara" } });
    await prisma.staffDay.update({ where: { id: day.id }, data: { inAt: "00:00" } });

    for (let i = 0; i < 2; i++) {
      const qr = await act(teacherToken, "generateStaffAttendanceQr");
      const out = await act(officeToken, "scanStaffAttendanceQr", { code: qr.body.qrText });
      expect(out.status).toBe(200);
      expect(out.body).toMatchObject({ checkedOut: true, inAt: "00:00", outAt: expect.stringMatching(/^\d{2}:\d{2}$/) });
    }
    const after = await prisma.staffDay.findUniqueOrThrow({ where: { id: day.id } });
    expect(after).toMatchObject({ inAt: "00:00", outAt: expect.stringMatching(/^\d{2}:\d{2}$/), status: day.status });
    expect(await prisma.staffDay.count({ where: { teacherId: "teacher-tara" } })).toBe(1);

    const record = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${teacherToken}` });
    expect(record.body.staffAttendanceSelf.today).toMatchObject({ inAt: "00:00", outAt: expect.stringMatching(/^\d{2}:\d{2}$/) });
  });

  it("marks a second teacher without changing the first teacher's in time", async () => {
    const first = await prisma.staffDay.findFirst({ where: { teacherId: "teacher-tara" } });
    const rheaLogin = await login("rhea.fixture@school.test");
    const rheaToken = rheaLogin.body.token;
    const generated = await act(rheaToken, "generateStaffAttendanceQr");
    expect(generated.status).toBe(200);
    const scanned = await act(officeToken, "scanStaffAttendanceQr", { code: generated.body.qrText });
    expect(scanned.status).toBe(200);
    expect(scanned.body.person.id).toBe("teacher-rhea");
    const tara = await prisma.staffDay.findFirst({ where: { teacherId: "teacher-tara" } });
    expect(tara?.inAt).toBe(first?.inAt);
  });

  it("rejects an expired or junk QR", async () => {
    const junk = await act(officeToken, "scanStaffAttendanceQr", { code: "not-a-qr" });
    expect(junk.status).toBe(400);
    const teacherScan = await act(teacherToken, "scanStaffAttendanceQr", { code: "anekio:staff-attendance:nope" });
    expect(teacherScan.status).toBe(400);
  });
});
