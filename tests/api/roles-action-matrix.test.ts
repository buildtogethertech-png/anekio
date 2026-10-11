import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";
import { createOfficeActor, RBAC_PASSWORD, seedRbacWorld, type RbacWorld } from "../support/rbac-world";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let world: RbacWorld;
let passwordHash = "";
let adminToken = "";
let templateId = "";
let issuedId = "";
let examId = "";
let feedbackId = "";
let leaveId = "";
let orgId = "";

async function login(email: string, password = RBAC_PASSWORD) {
  return request(app).post("/api/v1/login").send({ login: email, password });
}

async function tokenFor(email: string) {
  const response = await login(email);
  expect(response.status).toBe(200);
  return response.body.token as string;
}

async function act(token: string, op: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/v1/act")
    .set({ Authorization: `Bearer ${token}` })
    .send({ op, ...body });
}

async function actor(permissions: string[]) {
  const created = await createOfficeActor(prisma, permissions, passwordHash);
  return tokenFor(created.email);
}

describe.sequential("office action permission matrix", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "rbac-matrix-test-secret-with-enough-entropy";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    world = await seedRbacWorld(prisma);
    passwordHash = await bcrypt.hash(RBAC_PASSWORD, 4);
    app = (await import("../../server/index")).default;
    adminToken = (await login(world.users.office.email, world.password)).body.token;

    const org = await prisma.saasOrg.create({
      data: {
        schoolName: "Matrix Academy",
        ownerName: "Ojas Office",
        ownerEmail: world.users.office.email,
        ownerPhone: "9876540001",
      },
    });
    orgId = org.id;

    const saved = await act(adminToken, "saveDocumentTemplate", {
      type: "BONAFIDE",
      name: "Matrix bonafide",
      pageSize: "A4",
      orientation: "PORTRAIT",
      layout: {
        elements: [
          { id: "title", type: "TEXT", x: 10, y: 10, width: 80, height: 8, value: "Bonafide" },
          { id: "verify", type: "VERIFY_QR", x: 75, y: 75, width: 16, height: 16 },
        ],
      },
    });
    if (saved.status !== 200) throw new Error(`saveDocumentTemplate: ${JSON.stringify(saved.body)}`);
    templateId = saved.body.template.id;
    await act(adminToken, "publishDocumentTemplate", { id: templateId });
    const issued = await act(adminToken, "issueDocument", {
      templateId,
      subjectType: "STUDENT",
      subjectId: world.aishaId,
      subjectLabel: "Aisha Khan",
      data: { school: { name: "Fixture Academy" }, student: { name: "Aisha Khan" } },
    });
    issuedId = issued.body.id;

    const exam = await prisma.exam.create({
      data: {
        title: "Matrix exam",
        classId: world.class1A,
        subjectId: "subject-1a-math",
        date: new Date("2026-10-01T00:00:00.000Z"),
        maxMarks: 40,
        workflowStatus: "APPROVED",
      },
    });
    examId = exam.id;

    const notice = await prisma.notice.create({
      data: {
        title: "Parent query: Books",
        body: "Aisha Khan · 1-A\nNeed books",
        kind: "FEEDBACK",
        authorId: world.users.parent.id,
        studentId: world.aishaId,
      },
    });
    feedbackId = notice.id;

    const leave = await prisma.leaveRequest.create({
      data: {
        typeId: world.leaveTypeStaffId,
        from: "2026-10-16",
        to: "2026-10-16",
        status: "WAITING",
        requesterId: world.reportTeacherUserId,
        teacherId: "teacher-neha",
      },
    });
    leaveId = leave.id;
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  async function matrix(permission: string, op: string, body: Record<string, unknown>) {
    const off = await actor(["desk.view"]);
    const denied = await act(off, op, body);
    expect(denied.status).toBe(400);
    expect(denied.body.error).toBe("No access.");
    const on = await actor([permission]);
    if (permission === "onboarding.manage") {
      const user = await prisma.user.findFirstOrThrow({
        where: { role: { grants: { some: { permission: "onboarding.manage" } } } },
        orderBy: { createdAt: "desc" },
      });
      await prisma.user.update({ where: { id: user.id }, data: { orgId } });
    }
    const allowed = await act(on, op, body);
    expect(allowed.body?.error === "No access.").toBe(false);
    expect(allowed.status === 200 || allowed.body?.error !== "No access.").toBe(true);
    return allowed;
  }

  it("people.edit", async () => {
    const allowed = await matrix("people.edit", "createStudent", {
      name: "Matrix Child",
      classId: world.class1A,
      parentName: "Matrix Parent",
      parentPhone: "9876505101",
      dateOfBirth: "2018-04-04",
      billingStartPeriod: "2026-04",
    });
    expect(allowed.status).toBe(200);
  });

  it("people.import", async () => {
    const allowed = await matrix("people.import", "importPeopleSheet", {
      kind: "student",
      csv: "name,admissionNo,dateOfBirth,class,parentEmail,parentName,parentPhone,billingStartPeriod\nMatrix Import,ADM-MX-1,2015-01-01,1-A,parent.1a.1@school.test,,,2026-04\n",
    });
    expect(allowed.status).toBe(200);
  });

  it("admissions.manage", async () => {
    await matrix("admissions.manage", "createAdmissionLead", {
      studentName: "Walk In",
      classWanted: "1-A",
      guardianName: "Guardian",
      phone: "9876505102",
    });
  });

  it("staff.edit", async () => {
    const allowed = await matrix("staff.edit", "createTeacher", {
      name: "Matrix Teacher",
      email: `mx.teacher.${randomUUID().slice(0, 6)}@school.test`,
      phone: "9876505103",
      employeeId: `T-MX-${randomUUID().slice(0, 4)}`,
    });
    expect(allowed.status).toBe(200);
  });

  it("school.edit", async () => {
    const allowed = await matrix("school.edit", "saveSchoolIdentity", { name: "Matrix School" });
    expect(allowed.status).toBe(200);
  });

  it("fees.remind", async () => {
    await matrix("fees.remind", "sendFeeReminders", { invoiceIds: ["invoice-other-april"] });
  });

  it("fees.configure", async () => {
    const allowed = await matrix("fees.configure", "saveFeeTemplate", {
      classId: world.class1A,
      name: "Monthly",
      startsPeriod: "2026-04",
      endsPeriod: "2027-03",
      lines: [{ label: "Tuition", amount: 1000 }],
    });
    expect(allowed.status).toBe(200);
  });

  it("exams.edit", async () => {
    const allowed = await matrix("exams.edit", "hostExam", {
      title: "Matrix class test",
      subjectId: "subject-1a-math",
      classId: world.class1A,
      date: "2026-10-08",
    });
    expect(allowed.status).toBe(200);
  });

  it("exams.publish", async () => {
    const allowed = await matrix("exams.publish", "publishExamResults", { examId });
    expect(allowed.status).toBe(200);
  });

  it("marks.enter", async () => {
    const draft = await prisma.exam.create({
      data: {
        title: "Marks exam",
        classId: world.class1A,
        subjectId: "subject-1a-math",
        date: new Date("2026-10-03T00:00:00.000Z"),
        maxMarks: 40,
        workflowStatus: "MARKS_DRAFT",
      },
    });
    const allowed = await matrix("marks.enter", "enterMarks", {
      examId: draft.id,
      studentId: world.aishaId,
      marks: 30,
    });
    expect(allowed.status).toBe(200);
  });

  it("papers.upload", async () => {
    const allowed = await matrix("papers.upload", "uploadPaper", {
      examId,
      studentId: world.aishaId,
      fileName: "sheet.pdf",
      filePath: "papers/sheet.pdf",
    });
    expect(allowed.status).toBe(200);
  });

  it("notices.publish", async () => {
    const allowed = await matrix("notices.publish", "publishNotice", {
      title: "Notice",
      body: "Hello",
      audience: ["TEACHER"],
      allClasses: true,
    });
    expect(allowed.status).toBe(200);
  });

  it("documents.design", async () => {
    const allowed = await matrix("documents.design", "saveDocumentTemplate", {
      type: "BONAFIDE",
      name: "Designed",
      layout: { elements: [{ id: "t", type: "TEXT", x: 10, y: 10, width: 80, height: 8, value: "Hi" }] },
    });
    expect(allowed.status).toBe(200);
  });

  it("documents.publish", async () => {
    const draft = await act(adminToken, "saveDocumentTemplate", {
      type: "BONAFIDE",
      name: "To publish",
      layout: { elements: [{ id: "t", type: "TEXT", x: 10, y: 10, width: 80, height: 8, value: "Hi" }] },
    });
    const allowed = await matrix("documents.publish", "publishDocumentTemplate", { id: draft.body.template.id });
    expect(allowed.status).toBe(200);
  });

  it("documents.issue", async () => {
    await act(adminToken, "publishDocumentTemplate", { id: templateId });
    const allowed = await matrix("documents.issue", "issueDocument", {
      templateId,
      subjectType: "STUDENT",
      subjectId: world.rohanId,
      subjectLabel: "Rohan Khan",
      data: { school: { name: "Fixture Academy" }, student: { name: "Rohan Khan" } },
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
  });

  it("documents.batch", async () => {
    await act(adminToken, "publishDocumentTemplate", { id: templateId });
    const allowed = await matrix("documents.batch", "issueDocumentBatch", {
      templateId,
      subjects: [{ subjectType: "STUDENT", subjectId: world.aishaId, subjectLabel: "Aisha", data: {} }],
    });
    expect(allowed.status).toBe(200);
  });

  it("documents.revoke", async () => {
    const allowed = await matrix("documents.revoke", "changeIssuedDocumentStatus", {
      id: issuedId,
      status: "REVOKED",
      reason: "Issued in error",
    });
    expect(allowed.status).toBe(200);
  });

  it("onboarding.manage", async () => {
    const allowed = await matrix("onboarding.manage", "saveOnboardingPlan", { modules: ["school"] });
    expect(allowed.status).toBe(200);
  });

  it("inbox.manage", async () => {
    const allowed = await matrix("inbox.manage", "replyParentQuery", {
      noticeId: feedbackId,
      reply: "Received",
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
  });

  it("timetable.edit", async () => {
    const allowed = await matrix("timetable.edit", "saveTimetableSlot", {
      classId: world.class1A,
      periodId: "period-1",
      weekday: 1,
      subjectId: "subject-1a-math",
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
  });

  it("leave.decide", async () => {
    const allowed = await matrix("leave.decide", "decideLeave", { requestId: leaveId, yes: false });
    expect(allowed.status).toBe(200);
  });
});
