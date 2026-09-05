import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import type { Response } from "supertest";
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
let otherTeacherToken = "";
let parentToken = "";
let examId = "";
let seriesId = "";
let secondSeriesId = "";
const classmateId = "student-rahul";
const otherClassStudentId = "student-other-class";

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

function expectOk(response: Response, hint: string) {
  if (response.status !== 200) {
    throw new Error(`${hint}: ${response.status} ${JSON.stringify(response.body)}`);
  }
}

describe.sequential("exam marks API flow", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "exam-flow-test-secret-with-enough-entropy";
    database = createPushedTestDatabase();
    vi.resetModules();
    const prismaModule = await import("../../lib/prisma");
    prisma = prismaModule.prisma;
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;

    const teacherRole = await prisma.role.findFirstOrThrow({ where: { slug: "TEACHER" } });
    const hashed = (await prisma.user.findUniqueOrThrow({ where: { id: fixture.users.teacher.id } })).password;
    await prisma.user.create({
      data: {
        id: "user-teacher-other",
        email: "other.teacher@school.test",
        password: hashed,
        name: "Sandeep Other",
        roleId: teacherRole.id,
        teacher: { create: { id: "teacher-sandeep", employeeId: "T-FIX-2" } },
      },
    });
    await prisma.class.create({ data: { id: "class-6-b", name: "6", section: "B" } });
    await prisma.student.create({
      data: {
        id: classmateId,
        parentId: "parent-pari",
        classId: fixture.classId,
        admissionNo: "ADM-FIX-2",
        name: "Rahul Classmate",
        dateOfBirth: new Date("2014-07-01T00:00:00.000Z"),
      },
    });
    await prisma.student.create({
      data: {
        id: otherClassStudentId,
        parentId: "parent-pari",
        classId: "class-6-b",
        admissionNo: "ADM-FIX-3",
        name: "Other Class Student",
        dateOfBirth: new Date("2014-08-01T00:00:00.000Z"),
      },
    });

    officeToken = (await login(fixture.users.office.email)).body.token;
    teacherToken = (await login(fixture.users.teacher.email)).body.token;
    otherTeacherToken = (await login("other.teacher@school.test")).body.token;
    parentToken = (await login(fixture.users.parent.email)).body.token;
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("1–3. office creates an official series assigned to the subject teacher on a future date", async () => {
    const created = await act(officeToken, "createExamSeries", {
      classId: fixture.classId,
      sessionId: "session-2026",
      planItemId: "unit1",
      papers: [
        {
          subjectId: "subject-mathematics",
          teacherId: "teacher-tara",
          maxMarks: 40,
          date: "2026-09-20",
          paperDueOn: "2026-09-13",
          copiesDueOn: "2026-09-27",
          resultOn: "2026-10-04",
        },
      ],
    });
    expectOk(created, "createExamSeries");
    const series = await prisma.examSeries.findFirstOrThrow({
      where: { classId: fixture.classId, planItemId: "unit1" },
      include: { exams: true },
    });
    expect(series.name).toBe("Unit Test 1");
    expect(series.exams).toHaveLength(1);
    expect(series.exams[0].teacherId).toBe("teacher-tara");
    expect(series.exams[0].date.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(series.exams[0].workflowStatus).toBe("SCHEDULED");
    seriesId = series.id;
    examId = series.exams[0].id;

    const beforeGrant = await act(teacherToken, "saveExamMarks", {
      examId,
      marks: [{ studentId: fixture.studentId, marks: 28 }],
    });
    expect(beforeGrant.status).toBe(400);
    expect(String(beforeGrant.body.error)).toMatch(/allow marks entry/i);

    const granted = await act(officeToken, "grantExamMarks", { examId, teacherId: "teacher-tara" });
    expectOk(granted, "grantExamMarks");
  });

  it("4–6. assigned teacher can save marks before the exam date; another teacher cannot", async () => {
    const blocked = await act(otherTeacherToken, "saveExamMarks", {
      examId,
      marks: [{ studentId: fixture.studentId, marks: 30 }],
    });
    expect(blocked.status).toBe(400);
    expect(String(blocked.body.error)).toMatch(/allow marks entry|assigned teacher|Not your class/i);

    const saved = await act(teacherToken, "saveExamMarks", {
      examId,
      marks: [
        { studentId: fixture.studentId, marks: 28 },
        { studentId: classmateId, marks: 31 },
      ],
    });
    expectOk(saved, "saveExamMarks before date");
    const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
    expect(exam.workflowStatus).toBe("MARKS_DRAFT");
    expect(await prisma.examResult.count({ where: { examId } })).toBe(2);
  });

  it("7. assigned teacher can still save on and after the exam date", async () => {
    await prisma.exam.update({ where: { id: examId }, data: { date: new Date("2026-09-04T00:00:00.000Z") } });
    const onDay = await act(teacherToken, "saveExamMarks", {
      examId,
      marks: [{ studentId: fixture.studentId, marks: 29 }],
    });
    expectOk(onDay, "save on exam date");
    await prisma.exam.update({ where: { id: examId }, data: { date: new Date("2026-08-01T00:00:00.000Z") } });
    const after = await act(teacherToken, "saveExamMarks", {
      examId,
      marks: [{ studentId: fixture.studentId, marks: 30 }],
    });
    expectOk(after, "save after exam date");
  });

  it("8. parents do not see draft marks", async () => {
    const payload = await record(parentToken);
    expectOk(payload, "parent record draft");
    expect(payload.body.child.tests).toEqual([]);
    expect(payload.body.reports).toEqual([]);
  });

  it("9. office master sheet already has the entered marks", async () => {
    const payload = await record(officeToken);
    expectOk(payload, "office record");
    const sitting = payload.body.examPack.series.find((row: { id: string }) => row.id === seriesId);
    expect(sitting.exams[0].workflowStatus).toBe("MARKS_DRAFT");
    expect(sitting.marks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ examId, studentId: fixture.studentId, marks: 30 }),
        expect.objectContaining({ examId, studentId: classmateId, marks: 31 }),
      ])
    );
  });

  it("10–13. rejects over-max, negative, other-class, and keeps one row per student", async () => {
    const over = await act(teacherToken, "saveExamMarks", {
      examId,
      marks: [{ studentId: fixture.studentId, marks: 41 }],
    });
    expect(over.status).toBe(400);
    expect(String(over.body.error)).toMatch(/exceed/i);

    const negative = await act(teacherToken, "saveExamMarks", {
      examId,
      marks: [{ studentId: fixture.studentId, marks: -1 }],
    });
    expect(negative.status).toBe(400);
    expect(String(negative.body.error)).toMatch(/negative/i);

    const otherClass = await act(teacherToken, "saveExamMarks", {
      examId,
      marks: [{ studentId: otherClassStudentId, marks: 20 }],
    });
    expect(otherClass.status).toBe(400);
    expect(String(otherClass.body.error)).toMatch(/not in this class/i);

    const again = await act(teacherToken, "saveExamMarks", {
      examId,
      marks: [{ studentId: fixture.studentId, marks: 32 }],
    });
    expectOk(again, "duplicate upsert");
    expect(await prisma.examResult.count({ where: { examId, studentId: fixture.studentId } })).toBe(1);
    const row = await prisma.examResult.findUniqueOrThrow({
      where: { examId_studentId: { examId, studentId: fixture.studentId } },
    });
    expect(row.marks).toBe(32);
  });

  it("14. submit requires the full class, then locks the assigned teacher", async () => {
    const submitted = await act(teacherToken, "submitExamMarks", {
      examId,
      marks: [
        { studentId: fixture.studentId, marks: 32 },
        { studentId: classmateId, marks: 31 },
      ],
    });
    expectOk(submitted, "submitExamMarks");
    const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
    expect(exam.workflowStatus).toBe("SUBMITTED");
    const locked = await act(teacherToken, "saveExamMarks", {
      examId,
      marks: [{ studentId: fixture.studentId, marks: 10 }],
    });
    expect(locked.status).toBe(400);
  });

  it("15. publishing the timetable does not show marks to parents", async () => {
    const published = await act(officeToken, "publishExamSeries", { seriesId, publish: true });
    expectOk(published, "publishExamSeries");
    const tooSoon = await act(officeToken, "publishExamResults", { examId });
    expect(tooSoon.status).toBe(400);
    const payload = await record(parentToken);
    expect(payload.body.child.tests).toEqual([]);
    expect(payload.body.reports).toEqual([]);
  });

  it("16–18. per-student correction reaches only the assigned teacher for that student", async () => {
    const correction = await act(officeToken, "requestExamMarkCorrection", {
      examId,
      studentId: fixture.studentId,
      note: "Recheck Anaya total",
    });
    expectOk(correction, "requestExamMarkCorrection");
    const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
    expect(exam.workflowStatus).toBe("CORRECTION_REQUIRED");

    const otherTeacher = await act(otherTeacherToken, "saveExamMarks", {
      examId,
      marks: [{ studentId: fixture.studentId, marks: 33 }],
    });
    expect(otherTeacher.status).toBe(400);
    expect(String(otherTeacher.body.error)).toMatch(/allow marks entry|assigned teacher|Not your class/i);

    const classmateBlocked = await act(teacherToken, "saveExamMarks", {
      examId,
      marks: [{ studentId: classmateId, marks: 20 }],
    });
    expect(classmateBlocked.status).toBe(400);
    expect(String(classmateBlocked.body.error)).toMatch(/requested student/i);

    const fix = await act(teacherToken, "saveExamMarks", {
      examId,
      marks: [{ studentId: fixture.studentId, marks: 34 }],
    });
    expectOk(fix, "correct requested student");
  });

  it("19–20. teacher resubmits; office can read history that parents never see", async () => {
    const resubmit = await act(teacherToken, "submitExamMarks", {
      examId,
      marks: [{ studentId: fixture.studentId, marks: 34 }],
    });
    expectOk(resubmit, "resubmit");
    const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
    expect(exam.workflowStatus).toBe("RESUBMITTED");

    const history = await act(officeToken, "examMarkHistory", { examId, studentId: fixture.studentId });
    expectOk(history, "examMarkHistory");
    const actions = (history.body.history as { action: string }[]).map((row) => row.action);
    expect(actions).toContain("SUBMITTED");
    expect(actions).toContain("CORRECTION_REQUESTED");
    expect(actions).toContain("RESUBMITTED");

    const parent = await record(parentToken);
    const blob = JSON.stringify(parent.body);
    expect(blob).not.toContain("CORRECTION_REQUESTED");
    expect(blob).not.toContain("Recheck Anaya");
    expect(parent.body.child.tests).toEqual([]);
  });

  it("21–23. approve then publish; parent sees the official series and marks only", async () => {
    const approve = await act(officeToken, "approveExamMarks", { examId });
    expectOk(approve, "approveExamMarks");
    expect((await prisma.exam.findUniqueOrThrow({ where: { id: examId } })).workflowStatus).toBe("APPROVED");
    const stillHidden = await record(parentToken);
    expect(stillHidden.body.child.tests).toEqual([]);

    const publish = await act(officeToken, "publishExamResults", { examId });
    expectOk(publish, "publishExamResults");
    const parent = await record(parentToken);
    expectOk(parent, "parent after publish");
    expect(parent.body.child.tests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          examId,
          seriesName: "Unit Test 1",
          subject: "Mathematics",
          marks: 34,
          max: 40,
        }),
      ])
    );
    expect(parent.body.reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          seriesId,
          seriesName: "Unit Test 1",
        }),
      ])
    );
    const blob = JSON.stringify(parent.body);
    expect(blob).not.toContain("CORRECTION_REQUESTED");
    expect(blob).not.toContain("Recheck Anaya");
  });

  it("24. a second official series can exist for the same class without replacing the first", async () => {
    const created = await act(officeToken, "createExamSeries", {
      classId: fixture.classId,
      sessionId: "session-2026",
      planItemId: "term1",
      papers: [
        {
          subjectId: "subject-mathematics",
          teacherId: "teacher-tara",
          maxMarks: 80,
          date: "2026-10-15",
          paperDueOn: "2026-10-08",
          copiesDueOn: "2026-10-22",
          resultOn: "2026-10-29",
        },
      ],
    });
    expectOk(created, "second series");
    const series = await prisma.examSeries.findFirstOrThrow({
      where: { classId: fixture.classId, planItemId: "term1" },
    });
    expect(series.name).toBe("Term 1");
    secondSeriesId = series.id;
    expect(secondSeriesId).not.toBe(seriesId);
    const parent = await record(parentToken);
    expect(parent.body.reports.map((row: { seriesName: string }) => row.seriesName)).toEqual(["Unit Test 1"]);
  });
});
