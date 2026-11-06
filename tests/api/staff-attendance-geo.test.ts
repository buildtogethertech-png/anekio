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
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("measures distance in metres", async () => {
    // Imported here: lib/staff-geo loads prisma, which must see the test database first.
    const { distanceMeters } = await import("../../lib/staff-geo");
    expect(Math.round(distanceMeters(SCHOOL, INSIDE))).toBeGreaterThan(45);
    expect(Math.round(distanceMeters(SCHOOL, INSIDE))).toBeLessThan(55);
  });

  it("is off until the office saves a location", async () => {
    const res = await act(teacherToken, "markStaffAttendanceHere", INSIDE);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/off for your school/);
    expect((await record(teacherToken)).body.staffAttendanceSelf.attendanceGeo.enabled).toBe(false);
  });

  it("only the office can save it, with a known distance", async () => {
    expect((await act(teacherToken, "saveAttendanceGeo", { enabled: true, ...SCHOOL, radiusM: 150 })).status).toBe(400);
    const odd = await act(officeToken, "saveAttendanceGeo", { enabled: true, ...SCHOOL, radiusM: 37 });
    expect(odd.status).toBe(400);
    const saved = await act(officeToken, "saveAttendanceGeo", { enabled: true, ...SCHOOL, radiusM: 150 });
    expect(saved.status).toBe(200);
    expect(saved.body.attendanceGeo).toEqual({ enabled: true, ...SCHOOL, radiusM: 150 });
    expect((await record(officeToken)).body.attendanceGeo).toMatchObject({ enabled: true, radiusM: 150 });
    expect((await record(teacherToken)).body.staffAttendanceSelf.attendanceGeo).toMatchObject({ enabled: true, radiusM: 150 });
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

  it("marks the entry at school, then a double tap is refused", async () => {
    const res = await act(teacherToken, "markStaffAttendanceHere", INSIDE);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ checkedOut: false, outAt: "" });
    expect(res.body.inAt).toMatch(/^\d{2}:\d{2}$/);
    const day = await prisma.staffDay.findFirstOrThrow({ where: { teacherId: "teacher-tara" } });
    expect(day.inVia).toBe("location");
    expect(JSON.parse(day.geoJson).in).toMatchObject({ acc: 15 });

    const again = await act(teacherToken, "markStaffAttendanceHere", INSIDE);
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/Mark again when leaving/);
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

  it("turning it off keeps the saved point", async () => {
    const off = await act(officeToken, "saveAttendanceGeo", { enabled: false, ...SCHOOL, radiusM: 150 });
    expect(off.body.attendanceGeo).toMatchObject({ enabled: false, ...SCHOOL });
    expect((await act(teacherToken, "markStaffAttendanceHere", INSIDE)).body.error).toMatch(/off for your school/);
  });
});
