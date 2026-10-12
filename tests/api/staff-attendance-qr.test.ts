import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("lets a teacher generate a QR before they are marked, then rejects generate after the scan", async () => {
    const generated = await act(teacherToken, "generateStaffAttendanceQr");
    expect(generated.status).toBe(200);
    expect(generated.body.qrText).toMatch(/^anekio:staff-attendance:/);

    const scanned = await act(officeToken, "scanStaffAttendanceQr", { code: generated.body.qrText });
    expect(scanned.status).toBe(200);
    expect(scanned.body.person.id).toBe("teacher-tara");
    const firstInAt = scanned.body.inAt;
    expect(firstInAt).toMatch(/^\d{2}:\d{2}$/);

    const again = await act(teacherToken, "generateStaffAttendanceQr");
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already marked for today/i);

    const reused = await act(officeToken, "scanStaffAttendanceQr", { code: generated.body.qrText });
    expect(reused.status).toBe(400);
    expect(reused.body.error).toMatch(/already used|already marked/i);

    const day = await prisma.staffDay.findFirst({ where: { teacherId: "teacher-tara" } });
    expect(staffAttendanceInMark(day)).toBe(true);
    expect(day?.inAt).toBe(firstInAt);
  });

  it("exposes today's mark on the teacher record without a refresh race", async () => {
    const record = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${teacherToken}` });
    expect(record.status).toBe(200);
    expect(record.body.staffAttendanceSelf.today.marked).toBe(true);
    expect(record.body.staffAttendanceSelf.today.date).toBe(staffDayYmd(new Date()));
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
