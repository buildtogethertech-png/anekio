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
let taraToken = "";
let parentToken = "";
const today = staffDayYmd(new Date());

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

function saveTaraClasses(classIds: string[]) {
  return act(officeToken, "updateTeacher", {
    teacherId: "teacher-tara",
    name: "Tara Teacher",
    email: "teacher.fixture@school.test",
    phone: "9876540002",
    employeeId: "T-FIX-1",
    classIds,
  });
}

/** One teacher as class teacher of several classes, and a class with several class teachers. */
describe.sequential("one teacher, several classes", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "multi-class-teacher-test-secret-long";
    database = createPushedTestDatabase();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    // Fixture: Tara is class teacher of 6-A, where Anaya studies. Add 7-A (with Kabir) and 8-A (with Mira).
    await prisma.class.create({ data: { id: "class-7-a", name: "7", section: "A" } });
    await prisma.class.create({ data: { id: "class-8-a", name: "8", section: "A" } });
    for (const [id, classId, name, admissionNo] of [
      ["student-kabir", "class-7-a", "Kabir Seven", "ADM-FIX-7"],
      ["student-mira", "class-8-a", "Mira Eight", "ADM-FIX-8"],
    ]) {
      await prisma.student.create({ data: { id, classId, name, admissionNo, parentId: "parent-pari", billingStartPeriod: "2026-04" } });
    }
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
    taraToken = (await login(fixture.users.teacher.email)).body.token;
    parentToken = (await login(fixture.users.parent.email)).body.token;
  }, 90_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("Edit employee saves every class picked under Class teacher of", async () => {
    expect((await saveTaraClasses([fixture.classId, "class-7-a"])).status).toBe(200);
    const links = await prisma.teacherClass.findMany({ where: { teacherId: "teacher-tara", classTeacher: true }, orderBy: { classId: "asc" } });
    expect(links.map((l) => l.classId)).toEqual([fixture.classId, "class-7-a"].sort());
  });

  it("the teacher gets a homeroom per class, each with its own register", async () => {
    const res = await record(taraToken);
    expect(res.status).toBe(200);
    expect(res.body.classTeacher).toBe(true);
    expect(res.body.homerooms.map((h: { classLabel: string }) => h.classLabel)).toEqual(["6-A", "7-A"]);
    const seven = res.body.homerooms.find((h: { classId: string }) => h.classId === "class-7-a");
    expect(seven.roster.map((s: { id: string }) => s.id)).toEqual(["student-kabir"]);
    expect(res.body.people.map((p: { id: string }) => p.id).sort()).toEqual([fixture.studentId, "student-kabir"].sort());
  });

  it("the teacher can mark attendance in both classes, but not in a class that is not theirs", async () => {
    const both = await act(taraToken, "markAttendance", {
      date: today,
      rows: [
        { studentId: fixture.studentId, status: "PRESENT" },
        { studentId: "student-kabir", status: "ABSENT" },
      ],
    });
    // A closed day (Sunday or a holiday) refuses every date before the class check runs.
    if (both.status !== 200) {
      expect(both.body.error).toMatch(/closed|off/i);
      return;
    }
    const other = await act(taraToken, "markAttendance", { date: today, rows: [{ studentId: "student-mira", status: "PRESENT" }] });
    expect(other.status).toBe(400);
    expect(other.body.error).toMatch(/own class/);
  });

  it("the office dashboard names the teacher on each of their classes, and both teachers on a shared class", async () => {
    const res = await record(officeToken);
    const row = (classId: string) =>
      res.body.desk.classAttendance.find((c: { classId: string }) => c.classId === classId)?.classTeachers.map((t: { name: string }) => t.name);
    expect(row(fixture.classId)).toEqual(["Tara Teacher"]);
    expect(row("class-7-a")).toEqual(["Tara Teacher"]);
    expect(row("class-8-a")).toEqual([]);

    const login = await prisma.user.findUniqueOrThrow({ where: { id: "user-teacher" } });
    await prisma.teacher.create({
      data: {
        id: "teacher-co",
        employeeId: "T-FIX-CO",
        classes: { create: [{ classId: "class-7-a", classTeacher: true }] },
        user: { create: { id: "user-co", email: "co.fixture@school.test", password: login.password, name: "Co Teacher", roleId: login.roleId } },
      },
    });
    const shared = await record(officeToken);
    const names = shared.body.desk.classAttendance.find((c: { classId: string }) => c.classId === "class-7-a").classTeachers.map((t: { name: string }) => t.name);
    expect(names.sort()).toEqual(["Co Teacher", "Tara Teacher"]);
  });

  it("parents of either class can write to the class teacher", async () => {
    const res = await act(parentToken, "startInboxThread", { studentId: "student-kabir", target: "CLASS_TEACHER", message: "Kabir will be late tomorrow." });
    expect(res.status).toBe(200);
    const thread = await prisma.inboxThread.findFirstOrThrow({ where: { studentId: "student-kabir" }, include: { members: true } });
    expect(thread.members.map((m) => m.userId)).toEqual(expect.arrayContaining(["user-teacher", "user-co"]));
  });

  it("taking a class off keeps the teaching link but drops class teacher", async () => {
    expect((await saveTaraClasses(["class-7-a"])).status).toBe(200);
    const six = await prisma.teacherClass.findUniqueOrThrow({ where: { teacherId_classId: { teacherId: "teacher-tara", classId: fixture.classId } } });
    expect(six.classTeacher).toBe(false);
    const res = await record(taraToken);
    expect(res.body.homerooms.map((h: { classLabel: string }) => h.classLabel)).toEqual(["7-A"]);
  });
});
