import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isCircularNotice } from "../../lib/notices";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fixture: PortalFixture;
let officeToken = "";
let parentAToken = "";
let teacherAToken = "";
let studentAToken = "";
let parentBToken = "";
let studentBToken = "";
let teacherBToken = "";

async function login(email: string, password = fixture.password) {
  return request(app).post("/api/v1/login").send({ login: email, password });
}

async function act(token: string, op: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/v1/act")
    .set({ Authorization: `Bearer ${token}` })
    .send({ op, ...body });
}

async function inbox(token: string) {
  return request(app).get("/api/v1/notices").set({ Authorization: `Bearer ${token}` });
}

function titles(response: { body: { notices?: { title: string }[] } }) {
  return (response.body.notices ?? []).map((notice) => notice.title);
}

function boardTitles(response: { body: { notices?: { title: string; kind?: string; body?: string }[] } }) {
  return (response.body.notices ?? []).filter((notice) => isCircularNotice(notice)).map((notice) => notice.title);
}

describe("notice targeting and kinds", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "integration-test-secret-with-enough-entropy";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;

    await prisma.class.create({ data: { id: "class-7-b", name: "7", section: "B" } });
    const password = (await prisma.user.findUniqueOrThrow({ where: { id: fixture.users.office.id } })).password;
    await prisma.user.create({
      data: {
        id: "user-parent-b",
        email: "parent.b@school.test",
        password,
        name: "Parent B",
        roleId: "role-parent",
        parent: { create: { id: "parent-b", phone: "9876540099" } },
      },
    });
    await prisma.user.create({
      data: {
        id: "user-student-b",
        email: "student.b@school.test",
        password,
        name: "Student B",
        roleId: "role-student",
      },
    });
    await prisma.student.create({
      data: {
        id: "student-b",
        userId: "user-student-b",
        parentId: "parent-b",
        classId: "class-7-b",
        admissionNo: "ADM-FIX-B",
        name: "Student B",
        dateOfBirth: new Date("2013-01-01T00:00:00.000Z"),
      },
    });
    await prisma.user.create({
      data: {
        id: "user-teacher-b",
        email: "teacher.b@school.test",
        password,
        name: "Teacher B",
        roleId: "role-teacher",
        teacher: { create: { id: "teacher-b", employeeId: "T-FIX-B", classId: "class-7-b" } },
      },
    });

    officeToken = (await login(fixture.users.office.email)).body.token;
    parentAToken = (await login(fixture.users.parent.email)).body.token;
    teacherAToken = (await login(fixture.users.teacher.email)).body.token;
    studentAToken = (await login(fixture.users.student.email)).body.token;
    parentBToken = (await login("parent.b@school.test")).body.token;
    studentBToken = (await login("student.b@school.test")).body.token;
    teacherBToken = (await login("teacher.b@school.test")).body.token;
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("keeps GET /api/v1/notices server-side: parent B cannot read parent A's student notice", async () => {
    await prisma.notice.create({
      data: {
        id: "notice-student-a-only",
        title: "Only Student A",
        body: "Private to Anaya.",
        kind: "FEES",
        authorId: fixture.users.office.id,
        studentId: fixture.studentId,
        audiences: { create: [{ portal: "PARENT" }, { portal: "STUDENT" }] },
        classes: { create: [{ classId: fixture.classId }] },
      },
    });
    const parentA = await inbox(parentAToken);
    const parentB = await inbox(parentBToken);
    const studentA = await inbox(studentAToken);
    const studentB = await inbox(studentBToken);
    expect(titles(parentA)).toContain("Only Student A");
    expect(titles(studentA)).toContain("Only Student A");
    expect(titles(parentB)).not.toContain("Only Student A");
    expect(titles(studentB)).not.toContain("Only Student A");
  });

  it("limits named recipients to those users", async () => {
    await prisma.notice.create({
      data: {
        id: "notice-named-teacher-a",
        title: "Named teacher A exam",
        body: "Only Tara.",
        kind: "EXAM",
        authorId: fixture.users.office.id,
        recipients: { create: [{ userId: fixture.users.teacher.id }] },
      },
    });
    expect(titles(await inbox(teacherAToken))).toContain("Named teacher A exam");
    expect(titles(await inbox(teacherBToken))).not.toContain("Named teacher A exam");
    expect(titles(await inbox(parentAToken))).not.toContain("Named teacher A exam");
    expect(titles(await inbox(officeToken))).not.toContain("Named teacher A exam");
  });

  it("lets office see OFFICE-audience circulars and named office rows, not parent feedback", async () => {
    await prisma.notice.create({
      data: {
        id: "notice-office-circular",
        title: "Office circular",
        body: "Staff only.",
        kind: "CIRCULAR",
        authorId: fixture.users.office.id,
        audiences: { create: [{ portal: "OFFICE" }] },
      },
    });
    await prisma.notice.create({
      data: {
        id: "notice-parent-feedback",
        title: "Parent query private",
        body: "For office inbox targeting PARENT? actually OFFICE wait",
        kind: "FEEDBACK",
        authorId: fixture.users.parent.id,
        studentId: fixture.studentId,
        audiences: { create: [{ portal: "OFFICE" }] },
      },
    });
    await prisma.notice.create({
      data: {
        id: "notice-named-office",
        title: "Named office exam",
        body: "Exact recipient.",
        kind: "EXAM",
        authorId: fixture.users.teacher.id,
        recipients: { create: [{ userId: fixture.users.office.id }] },
      },
    });
    await prisma.notice.create({
      data: {
        id: "notice-teacher-only-note",
        title: "Teacher class note",
        body: "Not for office broadcast.",
        kind: "FEEDBACK",
        authorId: fixture.users.parent.id,
        audiences: { create: [{ portal: "TEACHER" }] },
        classes: { create: [{ classId: fixture.classId }] },
      },
    });
    const office = await inbox(officeToken);
    expect(titles(office)).toContain("Office circular");
    expect(titles(office)).toContain("Named office exam");
    expect(titles(office)).toContain("Parent query private");
    expect(titles(office)).not.toContain("Teacher class note");
    const parent = await inbox(parentAToken);
    expect(titles(parent)).not.toContain("Office circular");
    expect(titles(parent)).not.toContain("Named office exam");
  });

  it("targets class A circulars to class A families only", async () => {
    await prisma.notice.create({
      data: {
        id: "notice-class-a-circular",
        title: "Class 6 circular",
        body: "For 6-A.",
        kind: "CIRCULAR",
        authorId: fixture.users.office.id,
        audiences: { create: [{ portal: "PARENT" }, { portal: "STUDENT" }, { portal: "TEACHER" }] },
        classes: { create: [{ classId: fixture.classId }] },
      },
    });
    expect(titles(await inbox(parentAToken))).toContain("Class 6 circular");
    expect(titles(await inbox(studentAToken))).toContain("Class 6 circular");
    expect(titles(await inbox(teacherAToken))).toContain("Class 6 circular");
    expect(titles(await inbox(parentBToken))).not.toContain("Class 6 circular");
    expect(titles(await inbox(studentBToken))).not.toContain("Class 6 circular");
  });

  it("keeps the Notices board on CIRCULAR only after FEE/FEES/EXAM/LEAVE/ADMISSION/FEEDBACK posts", async () => {
    await prisma.notice.createMany({
      data: [
        { id: "board-circular", title: "Board circular", body: "On the board.", kind: "CIRCULAR", authorId: fixture.users.office.id },
        { id: "board-exam", title: "Board exam", body: "Exam.", kind: "EXAM", authorId: fixture.users.office.id },
        { id: "board-fees", title: "Board fees", body: "Fees.", kind: "FEES", authorId: fixture.users.office.id },
        { id: "board-fee-alias", title: "Board fee alias", body: "Legacy fee hold.", kind: "FEE", authorId: fixture.users.office.id },
        { id: "board-leave", title: "Board leave", body: "Leave.", kind: "LEAVE", authorId: fixture.users.office.id },
        { id: "board-admission", title: "Board admission", body: "Lead.", kind: "ADMISSION", authorId: fixture.users.office.id },
        { id: "board-feedback", title: "Board feedback", body: "Inbox.", kind: "FEEDBACK", authorId: fixture.users.office.id },
        { id: "board-unknown", title: "Board unknown", body: "Future kind.", kind: "SOMETHING_NEW", authorId: fixture.users.office.id },
      ],
    });
    await prisma.noticeAudience.createMany({
      data: ["board-circular", "board-exam", "board-fees", "board-fee-alias", "board-leave", "board-admission", "board-feedback", "board-unknown"].flatMap(
        (noticeId) =>
          (["PARENT", "STUDENT", "TEACHER", "OFFICE"] as const).map((portal) => ({ noticeId, portal }))
      ),
    });
    const parent = await inbox(parentAToken);
    const onBoard = boardTitles(parent);
    expect(onBoard).toContain("Board circular");
    expect(onBoard).not.toContain("Board exam");
    expect(onBoard).not.toContain("Board fees");
    expect(onBoard).not.toContain("Board fee alias");
    expect(onBoard).not.toContain("Board leave");
    expect(onBoard).not.toContain("Board admission");
    expect(onBoard).not.toContain("Board feedback");
    expect(onBoard).not.toContain("Board unknown");
    expect(titles(parent)).toContain("Board fee alias");
    expect(titles(parent)).toContain("Board fees");
    expect((await prisma.notice.findUniqueOrThrow({ where: { id: "board-fee-alias" } })).kind).toBe("FEE");
    expect(parent.body.notices.find((n: { title: string }) => n.title === "Board fee alias").kind).toBe("FEES");
  });

  it("stores office FEE posts as FEES and keeps them off the Notices board", async () => {
    const posted = await act(officeToken, "publishNotice", {
      title: "Fee reminder",
      body: "Please pay April.",
      audience: ["PARENT"],
      allClasses: true,
      kind: "FEE",
    });
    expect(posted.status).toBe(200);
    const row = await prisma.notice.findFirst({ where: { title: "Fee reminder" } });
    expect(row?.kind).toBe("FEES");
    const parent = await inbox(parentAToken);
    expect(titles(parent)).toContain("Fee reminder");
    expect(boardTitles(parent)).not.toContain("Fee reminder");
    const teacherDenied = await act(teacherAToken, "publishNotice", {
      title: "Teacher circular",
      body: "Should fail.",
      audience: ["PARENT"],
      allClasses: true,
      kind: "CIRCULAR",
    });
    expect(teacherDenied.status).toBe(400);
  });

  it("replaces a push token on the same user and never shares it", async () => {
    const first = await act(parentAToken, "savePushToken", { token: "ExponentPushToken[parent-a-old]" });
    expect(first.status).toBe(200);
    const second = await act(parentAToken, "savePushToken", { token: "ExponentPushToken[parent-a-new]" });
    expect(second.status).toBe(200);
    await act(parentBToken, "savePushToken", { token: "ExponentPushToken[parent-a-new]" });
    const parentA = await prisma.user.findUniqueOrThrow({ where: { id: fixture.users.parent.id } });
    const parentB = await prisma.user.findUniqueOrThrow({ where: { id: "user-parent-b" } });
    expect(parentB.pushToken).toBe("ExponentPushToken[parent-a-new]");
    expect(parentA.pushToken).toBeNull();
  });

  it("still creates a Notice when Expo push returns 500", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);
    const posted = await act(officeToken, "publishNotice", {
      title: "Push fail circular",
      body: "Should persist.",
      audience: ["PARENT"],
      allClasses: true,
      kind: "CIRCULAR",
    });
    expect(posted.status).toBe(200);
    expect(await prisma.notice.count({ where: { title: "Push fail circular" } })).toBe(1);
    fetchMock.mockRestore();
  });

  it("does not create a Notice when attendance is marked", async () => {
    const before = await prisma.notice.count();
    const marked = await act(teacherAToken, "markAttendance", {
      date: "2026-08-21",
      rows: [{ studentId: fixture.studentId, status: "PRESENT" }],
    });
    expect(marked.status).toBe(200);
    expect(await prisma.notice.count()).toBe(before);
  });

  it("walks the golden path: circular on board, exam and fees on bell only", async () => {
    await act(officeToken, "publishNotice", {
      title: "Golden circular",
      body: "Assembly tomorrow.",
      audience: ["PARENT"],
      allClasses: false,
      classIds: [fixture.classId],
      kind: "CIRCULAR",
    });
    await prisma.notice.create({
      data: {
        title: "Golden exam",
        body: "Paper due.",
        kind: "EXAM",
        authorId: fixture.users.office.id,
        recipients: { create: [{ userId: fixture.users.teacher.id }] },
      },
    });
    await prisma.notice.create({
      data: {
        title: "Golden fees",
        body: "Report card held.",
        kind: "FEES",
        authorId: fixture.users.office.id,
        studentId: fixture.studentId,
        audiences: { create: [{ portal: "PARENT" }] },
        classes: { create: [{ classId: fixture.classId }] },
      },
    });
    const parent = await inbox(parentAToken);
    const teacher = await inbox(teacherAToken);
    expect(titles(parent)).toContain("Golden circular");
    expect(boardTitles(parent)).toContain("Golden circular");
    expect(titles(parent)).toContain("Golden fees");
    expect(boardTitles(parent)).not.toContain("Golden fees");
    expect(titles(parent)).not.toContain("Golden exam");
    expect(titles(teacher)).toContain("Golden exam");
    expect(boardTitles(teacher)).not.toContain("Golden exam");
  });
});
