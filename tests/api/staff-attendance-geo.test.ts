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
let teacherToken = "";

const SCHOOL = { lat: 28.6139, lng: 77.209 };
/** About 50 m north of the school point. */
const INSIDE = { lat: 28.61435, lng: 77.209, accuracy: 15 };
/** About 500 m north. */
const FAR = { lat: 28.6184, lng: 77.209, accuracy: 15 };

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

describe.sequential("staff attendance by location", () => {
  beforeAll(async () => {
    // A fixed school day (Wednesday, noon in India): the tests never land on a Sunday or just after midnight.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T06:30:00Z"));
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "staff-attendance-geo-test-secret-long-one";
    database = createPushedTestDatabase();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
    teacherToken = (await login(fixture.users.teacher.email)).body.token;
    await prisma.staffDay.deleteMany({ where: { teacherId: "teacher-tara" } });
  }, 90_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("says metres under a kilometre and kilometres after", async () => {
    const { formatDistance } = await import("../../lib/staff-attendance-setup");
    expect([9, 450, 999, 1000, 1234, 5040, 12_600].map(formatDistance)).toEqual(["9 m", "450 m", "999 m", "1 km", "1.2 km", "5 km", "13 km"]);
  });

  it("measures distance in metres", async () => {
    // Imported here: lib/staff-attendance-setup loads prisma, which must see the test database first.
    const { distanceMeters } = await import("../../lib/staff-attendance-setup");
    expect(Math.round(distanceMeters(SCHOOL, INSIDE))).toBeGreaterThan(45);
    expect(Math.round(distanceMeters(SCHOOL, INSIDE))).toBeLessThan(55);
  });

  it("is off until the office saves a location", async () => {
    const res = await act(teacherToken, "markStaffAttendanceHere", INSIDE);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/off for your school/);
    expect((await record(teacherToken)).body.staffAttendanceSelf.attendanceSetup).toMatchObject({ qr: true, location: false });
  });

  it("only the office can save it, with a known distance", async () => {
    expect((await act(teacherToken, "saveStaffAttendanceSetup", { qr: false, location: true, ...SCHOOL, radiusM: 150 })).status).toBe(400);
    const odd = await act(officeToken, "saveStaffAttendanceSetup", { qr: false, location: true, ...SCHOOL, radiusM: 37 });
    expect(odd.status).toBe(400);
    const saved = await act(officeToken, "saveStaffAttendanceSetup", { qr: false, location: true, ...SCHOOL, radiusM: 150 });
    expect(saved.status).toBe(200);
    expect(saved.body.staffAttendanceSetup).toEqual({ qr: false, location: true, ...SCHOOL, radiusM: 150 });
    expect((await record(officeToken)).body.staffAttendanceSetup).toMatchObject({ location: true, radiusM: 150 });
    expect((await record(teacherToken)).body.staffAttendanceSelf.attendanceSetup).toMatchObject({ location: true, radiusM: 150 });
  });

  it("refuses far away, a rough fix and a fake location", async () => {
    const far = await act(teacherToken, "markStaffAttendanceHere", FAR);
    expect(far.status).toBe(400);
    expect(far.body.error).toMatch(/You are 5\d\d m from school/);
    const rough = await act(teacherToken, "markStaffAttendanceHere", { ...INSIDE, accuracy: 120 });
    expect(rough.body.error).toMatch(/Weak GPS/);
    const fake = await act(teacherToken, "markStaffAttendanceHere", { ...INSIDE, mocked: true });
    expect(fake.body.error).toMatch(/Fake location/);
    expect(await prisma.staffDay.count({ where: { teacherId: "teacher-tara" } })).toBe(0);
  });

  it("marks the entry at school, and the very next mark is an out (no minimum gap)", async () => {
    const res = await act(teacherToken, "markStaffAttendanceHere", INSIDE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ checkedOut: false, outAt: "", accuracy: 15 });
    expect(res.body.meters).toBeGreaterThan(40);
    expect(res.body.inAt).toMatch(/^\d{2}:\d{2}$/);
    const day = await prisma.staffDay.findFirstOrThrow({ where: { teacherId: "teacher-tara" } });
    expect(day.inVia).toBe("location");
    expect(JSON.parse(day.geoJson).in).toMatchObject({ acc: 15 });

    const again = await act(teacherToken, "markStaffAttendanceHere", INSIDE);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ checkedOut: true, inAt: res.body.inAt });
    const after = await prisma.staffDay.findFirstOrThrow({ where: { teacherId: "teacher-tara" } });
    expect(after.inAt).toBe(res.body.inAt);
    expect(JSON.parse(after.outLogJson)).toHaveLength(1);
  });

  it("a later mark is the exit, and the office board says how", async () => {
    await prisma.staffDay.updateMany({ where: { teacherId: "teacher-tara" }, data: { inAt: "00:00" } });
    const out = await act(teacherToken, "markStaffAttendanceHere", INSIDE);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ checkedOut: true, inAt: "00:00" });
    expect(out.body.outAt).toEqual(expect.stringMatching(/^\d{2}:\d{2}$/));
    const day = await prisma.staffDay.findFirstOrThrow({ where: { teacherId: "teacher-tara" } });
    expect(day).toMatchObject({ inVia: "location", outVia: "location" });
    expect(Object.keys(JSON.parse(day.geoJson))).toEqual(["in", "out"]);
  });

  it("in is set once; out can be marked again and every out is kept", async () => {
    const again = await act(teacherToken, "markStaffAttendanceHere", INSIDE);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ checkedOut: true, inAt: "00:00" });
    let day = await prisma.staffDay.findFirstOrThrow({ where: { teacherId: "teacher-tara" } });
    expect(day.inAt).toBe("00:00");
    expect(JSON.parse(day.outLogJson)).toHaveLength(3);
    expect(JSON.parse(day.outLogJson).every((o: { via: string }) => o.via === "location")).toBe(true);

    const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(day.date);
    const office = await act(officeToken, "markStaffAttendance", {
      date: stamp,
      rows: [{ kind: "teacher", id: "teacher-tara", status: "PRESENT", inAt: "00:00", outAt: "23:00" }],
    });
    expect(office.status).toBe(200);
    day = await prisma.staffDay.findFirstOrThrow({ where: { teacherId: "teacher-tara" } });
    expect(day).toMatchObject({ inAt: "00:00", outAt: "23:00" });
    const log = JSON.parse(day.outLogJson);
    expect(log).toHaveLength(4);
    expect(log[3]).toEqual({ at: "23:00", via: "office" });
    const me = await record(teacherToken);
    expect(me.body.staffAttendanceSelf.today.outLog).toHaveLength(4);
  });

  it("office Save the day keeps a time staff marked themselves, and Absent clears in and out", async () => {
    const today = (await prisma.staffDay.findFirstOrThrow({ where: { teacherId: "teacher-tara" } })).date;
    const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(today);
    const save = (status: string) =>
      act(officeToken, "markStaffAttendance", { date: stamp, rows: [{ kind: "teacher", id: "teacher-tara", status, inAt: "", outAt: "" }] });
    expect((await save("PRESENT")).status).toBe(200);
    const kept = await prisma.staffDay.findFirstOrThrow({ where: { teacherId: "teacher-tara" } });
    expect(kept.inAt).toBe("00:00");
    expect(kept.outAt).toMatch(/^\d{2}:\d{2}$/);
    expect((await save("ABSENT")).status).toBe(200);
    expect(await prisma.staffDay.findFirstOrThrow({ where: { teacherId: "teacher-tara" } })).toMatchObject({ status: "ABSENT", inAt: "", outAt: "" });
  });

  it("an office employee who also teaches is marked on their staff record, where the board reads it", async () => {
    const officeUser = await prisma.user.findFirstOrThrow({ where: { email: fixture.users.office.email } });
    const staff =
      (await prisma.staffMember.findFirst({ where: { userId: officeUser.id } })) ||
      (await prisma.staffMember.create({ data: { name: officeUser.name, title: "Admin", employeeId: "S-GEO-1", userId: officeUser.id } }));
    await prisma.teacher.create({ data: { employeeId: "T-GEO-1", userId: officeUser.id, teachingOnly: true, staffMemberId: staff.id } });
    const res = await act(officeToken, "markStaffAttendanceHere", INSIDE);
    expect(res.status).toBe(200);
    expect(res.body.person).toMatchObject({ kind: "staff", id: staff.id });
    expect(await prisma.staffDay.count({ where: { staffId: staff.id, inVia: "location" } })).toBe(1);
    expect((await record(officeToken)).body.staffAttendanceSelf).toMatchObject({ kind: "staff", id: staff.id, today: { marked: true } });
  });

  it("turning location off keeps the saved point", async () => {
    const off = await act(officeToken, "saveStaffAttendanceSetup", { qr: true, location: false, ...SCHOOL, radiusM: 150 });
    expect(off.body.staffAttendanceSetup).toMatchObject({ location: false, ...SCHOOL });
    expect((await act(teacherToken, "markStaffAttendanceHere", INSIDE)).body.error).toMatch(/off for your school/);
  });

  it("takes one way only: QR or location, never both or neither", async () => {
    const both = await act(officeToken, "saveStaffAttendanceSetup", { qr: true, location: true, ...SCHOOL, radiusM: 150 });
    expect(both.status).toBe(400);
    expect(both.body.error).toMatch(/Pick one way/);
    const none = await act(officeToken, "saveStaffAttendanceSetup", { qr: false, location: false, ...SCHOOL, radiusM: 150 });
    expect(none.body.error).toMatch(/Pick one way/);
  });

  it("with QR off, no QR is made or scanned", async () => {
    const qr = await act(teacherToken, "generateStaffAttendanceQr");
    expect(qr.status).toBe(200);
    await act(officeToken, "saveStaffAttendanceSetup", { qr: false, location: true, ...SCHOOL, radiusM: 150 });
    const none = await act(teacherToken, "generateStaffAttendanceQr");
    expect(none.status).toBe(400);
    expect(none.body.error).toMatch(/QR attendance is off/);
    const scan = await act(officeToken, "scanStaffAttendanceQr", { code: qr.body.qrText });
    expect(scan.body.error).toMatch(/QR attendance is off/);
  });
});
