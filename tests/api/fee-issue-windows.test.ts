import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fixture: PortalFixture;
let officeToken = "";

async function login(email: string, password = fixture.password) {
  return request(app).post("/api/v1/login").send({ login: email, password });
}

async function act(token: string, op: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/v1/act")
    .set({ Authorization: `Bearer ${token}` })
    .send({ op, ...body });
}

function freezeOn(when: Date | string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(when instanceof Date ? when : new Date(when));
}

async function periodsFor(studentId: string) {
  return (await prisma.feeInvoice.findMany({ where: { studentId } })).map((row) => row.period).sort();
}

async function prepareClass(input: { classId: string; studentId: string; admissionNo: string; joinedAt?: string }) {
  await prisma.class.create({ data: { id: input.classId, name: "Issue", section: input.classId.slice(-1) } });
  const student = await prisma.student.create({
    data: {
      id: input.studentId,
      parentId: "parent-pari",
      classId: input.classId,
      admissionNo: input.admissionNo,
      name: input.studentId,
      dateOfBirth: new Date("2015-01-01T00:00:00Z"),
    },
  });
  await enroll({
    studentId: student.id,
    classId: input.classId,
    rollNumber: 1,
    joinedAt: input.joinedAt || "2026-04-01T00:00:00.000Z",
  });
  const saved = await act(officeToken, "saveFeeTemplate", {
    classId: input.classId,
    sessionId: "session-2026",
    name: "Monthly fee",
    startsPeriod: "2026-04",
    endsPeriod: "2027-03",
    dueDay: 10,
    lines: [{ label: "Tuition", amount: 2000, scope: "ALL" }],
  });
  expect(saved.status).toBe(200);
  return { student, templateId: saved.body.id as string };
}

async function enroll(input: { studentId: string; classId: string; rollNumber: number; joinedAt: string }) {
  await prisma.studentClassEnrollment.create({
    data: {
      studentId: input.studentId,
      classId: input.classId,
      sessionId: "session-2026",
      rollNumber: input.rollNumber,
      joinedAt: new Date(input.joinedAt),
      active: true,
    },
  });
}

describe.sequential("fee issue month windows", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "fee-issue-windows-test-secret-with-enough-entropy";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
  }, 120_000);

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("issueClassFees on 2026-10-04 bills through September and issueDueFees also bills October", async () => {
    const classId = "class-issue-window";
    await prisma.class.create({ data: { id: classId, name: "Issue", section: "W" } });
    const student = await prisma.student.create({
      data: {
        id: "student-issue-window",
        parentId: "parent-pari",
        classId,
        admissionNo: "ADM-WIN-1",
        name: "Window Child",
        dateOfBirth: new Date("2015-01-01T00:00:00Z"),
      },
    });
    await enroll({ studentId: student.id, classId, rollNumber: 1, joinedAt: "2026-04-01T00:00:00.000Z" });
    const saved = await act(officeToken, "saveFeeTemplate", {
      classId,
      sessionId: "session-2026",
      name: "Monthly fee",
      startsPeriod: "2026-04",
      endsPeriod: "2027-03",
      dueDay: 10,
      lines: [{ label: "Tuition", amount: 2000, scope: "ALL" }],
    });
    expect(saved.status).toBe(200);

    freezeOn("2026-10-04T06:30:00.000Z");
    const classIssue = await act(officeToken, "issueClassFees", { classId, templateId: saved.body.id });
    expect(classIssue.status).toBe(200);
    const afterClass = (await prisma.feeInvoice.findMany({ where: { studentId: student.id } }))
      .map((row) => row.period)
      .sort();
    expect(afterClass).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(afterClass).not.toContain("2026-10");

    const dueIssue = await act(officeToken, "issueDueFees", { classId });
    expect(dueIssue.status).toBe(200);
    const afterDue = (await prisma.feeInvoice.findMany({ where: { studentId: student.id } }))
      .map((row) => row.period)
      .sort();
    expect(afterDue).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);

    await act(officeToken, "issueClassFees", { classId, templateId: saved.body.id });
    await act(officeToken, "issueClassFees", { classId, templateId: saved.body.id });
    await act(officeToken, "issueDueFees", { classId });
    await act(officeToken, "issueDueFees", { classId });
    const counted = await prisma.feeInvoice.groupBy({
      by: ["studentId", "period"],
      where: { studentId: student.id },
      _count: { _all: true },
    });
    expect(counted.every((row) => row._count._all === 1)).toBe(true);
    expect(counted).toHaveLength(7);
  });

  it("starts billing from the enrollment month, not months before the student joined", async () => {
    const classId = "class-issue-join";
    await prisma.class.create({ data: { id: classId, name: "Join", section: "W" } });
    const students = [
      { id: "student-join-a", admissionNo: "ADM-JOIN-A", rollNumber: 1, joinedAt: "2026-03-01T00:00:00.000Z" },
      { id: "student-join-b", admissionNo: "ADM-JOIN-B", rollNumber: 2, joinedAt: "2026-05-15T00:00:00.000Z" },
      { id: "student-join-c", admissionNo: "ADM-JOIN-C", rollNumber: 3, joinedAt: "2026-06-20T00:00:00.000Z" },
      { id: "student-join-d", admissionNo: "ADM-JOIN-D", rollNumber: 4, joinedAt: "2026-10-01T00:00:00.000Z", feeGeneratedThrough: "2026-09" },
    ];
    for (const row of students) {
      await prisma.student.create({
        data: {
          id: row.id,
          parentId: "parent-pari",
          classId,
          admissionNo: row.admissionNo,
          name: row.id,
          dateOfBirth: new Date("2015-01-01T00:00:00Z"),
          ...(row.feeGeneratedThrough ? { feeGeneratedThrough: row.feeGeneratedThrough } : {}),
        },
      });
      await enroll({ studentId: row.id, classId, rollNumber: row.rollNumber, joinedAt: row.joinedAt });
    }
    const saved = await act(officeToken, "saveFeeTemplate", {
      classId,
      sessionId: "session-2026",
      name: "Monthly fee",
      startsPeriod: "2026-04",
      endsPeriod: "2027-03",
      dueDay: 10,
      lines: [{ label: "Tuition", amount: 1000, scope: "ALL" }],
    });
    expect(saved.status).toBe(200);

    freezeOn("2026-10-04T06:30:00.000Z");
    const issued = await act(officeToken, "issueClassFees", { classId, templateId: saved.body.id });
    expect(issued.status).toBe(200);

    async function periods(studentId: string) {
      return (await prisma.feeInvoice.findMany({ where: { studentId } })).map((row) => row.period).sort();
    }
    expect(await periods("student-join-a")).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(await periods("student-join-b")).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(await periods("student-join-c")).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(await periods("student-join-d")).toEqual([]);

    const due = await act(officeToken, "issueDueFees", { classId });
    expect(due.status).toBe(200);
    expect(await periods("student-join-d")).toEqual(["2026-10"]);
    expect(await periods("student-join-a")).toContain("2026-10");
  });

  it("at local Sep 30 23:59 class-issue stops at August and due-fees includes September", async () => {
    const classId = "class-issue-sep30";
    const { student, templateId } = await prepareClass({
      classId,
      studentId: "student-issue-sep30",
      admissionNo: "ADM-WIN-SEP30",
    });
    freezeOn(new Date(2026, 8, 30, 23, 59, 0));
    expect((await act(officeToken, "issueClassFees", { classId, templateId })).status).toBe(200);
    expect(await periodsFor(student.id)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    expect((await act(officeToken, "issueDueFees", { classId })).status).toBe(200);
    expect(await periodsFor(student.id)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  });

  it("at local Oct 1 00:00 class-issue includes September and due-fees includes October", async () => {
    const classId = "class-issue-oct1";
    const { student, templateId } = await prepareClass({
      classId,
      studentId: "student-issue-oct1",
      admissionNo: "ADM-WIN-OCT1",
    });
    freezeOn(new Date(2026, 9, 1, 0, 0, 0));
    expect((await act(officeToken, "issueClassFees", { classId, templateId })).status).toBe(200);
    expect(await periodsFor(student.id)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect((await act(officeToken, "issueDueFees", { classId })).status).toBe(200);
    expect(await periodsFor(student.id)).toContain("2026-10");
    expect(await periodsFor(student.id)).not.toContain("2026-11");
  });

  it("at local Nov 1 00:00 class-issue includes October and due-fees includes November", async () => {
    const classId = "class-issue-nov1";
    const { student, templateId } = await prepareClass({
      classId,
      studentId: "student-issue-nov1",
      admissionNo: "ADM-WIN-NOV1",
    });
    freezeOn(new Date(2026, 10, 1, 0, 0, 0));
    expect((await act(officeToken, "issueClassFees", { classId, templateId })).status).toBe(200);
    expect(await periodsFor(student.id)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect((await act(officeToken, "issueDueFees", { classId })).status).toBe(200);
    expect(await periodsFor(student.id)).toContain("2026-11");
    expect(await periodsFor(student.id)).not.toContain("2026-12");
  });

  it("catches up missing Jul–Sep via issueClassFees and only then adds October via issueDueFees", async () => {
    const classId = "class-issue-catchup";
    const { student, templateId } = await prepareClass({
      classId,
      studentId: "student-issue-catchup",
      admissionNo: "ADM-WIN-CATCH",
    });
    for (const period of ["2026-04", "2026-05", "2026-06"] as const) {
      await prisma.feeInvoice.create({
        data: {
          studentId: student.id,
          classId,
          period,
          title: `${period} · Monthly fee`,
          amount: 2000,
          linesJson: "[]",
          dueDate: new Date(`${period}-10T00:00:00.000Z`),
          status: "DUE",
        },
      });
    }
    freezeOn(new Date(2026, 9, 4, 12, 0, 0));
    expect((await act(officeToken, "issueClassFees", { classId, templateId })).status).toBe(200);
    expect(await periodsFor(student.id)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect((await act(officeToken, "issueDueFees", { classId })).status).toBe(200);
    expect(await periodsFor(student.id)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    await act(officeToken, "issueClassFees", { classId, templateId });
    await act(officeToken, "issueDueFees", { classId });
    expect(await periodsFor(student.id)).toHaveLength(7);
  });

  it("does not recreate PAID, PARTIAL, or OVERDUE months", async () => {
    const classId = "class-issue-status";
    const { student, templateId } = await prepareClass({
      classId,
      studentId: "student-issue-status",
      admissionNo: "ADM-WIN-STAT",
    });
    await prisma.feeInvoice.createMany({
      data: [
        {
          studentId: student.id,
          classId,
          period: "2026-04",
          title: "April",
          amount: 2000,
          linesJson: "[]",
          dueDate: new Date("2026-04-10T00:00:00.000Z"),
          status: "PAID",
        },
        {
          studentId: student.id,
          classId,
          period: "2026-05",
          title: "May",
          amount: 2000,
          linesJson: "[]",
          dueDate: new Date("2026-05-10T00:00:00.000Z"),
          status: "PARTIAL",
        },
        {
          studentId: student.id,
          classId,
          period: "2026-06",
          title: "June",
          amount: 2000,
          linesJson: "[]",
          dueDate: new Date("2026-06-10T00:00:00.000Z"),
          status: "OVERDUE",
        },
      ],
    });
    freezeOn(new Date(2026, 9, 4, 12, 0, 0));
    await act(officeToken, "issueClassFees", { classId, templateId });
    await act(officeToken, "issueDueFees", { classId });
    const rows = await prisma.feeInvoice.findMany({ where: { studentId: student.id } });
    expect(rows.filter((row) => row.period === "2026-04")).toHaveLength(1);
    expect(rows.find((row) => row.period === "2026-04")?.status).toBe("PAID");
    expect(rows.find((row) => row.period === "2026-05")?.status).toBe("PARTIAL");
    expect(rows.find((row) => row.period === "2026-06")?.status).toBe("OVERDUE");
  });

  it("does not create an invoice when the due date passes, Register is viewed, or a reminder is sent", async () => {
    const classId = "class-issue-neg";
    const { student } = await prepareClass({
      classId,
      studentId: "student-issue-neg",
      admissionNo: "ADM-WIN-NEG",
    });
    await prisma.feeInvoice.create({
      data: {
        studentId: student.id,
        classId,
        period: "2026-09",
        title: "September",
        amount: 2000,
        linesJson: "[]",
        dueDate: new Date(2026, 8, 10, 0, 0, 0),
        status: "DUE",
      },
    });
    freezeOn(new Date(2026, 9, 4, 12, 0, 0));
    const before = await prisma.feeInvoice.count({ where: { studentId: student.id } });
    const register = await request(app).get("/api/v1/fee-register").set({ Authorization: `Bearer ${officeToken}` });
    expect(register.status).toBe(200);
    const record = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${officeToken}` });
    expect(record.status).toBe(200);
    const reminder = await act(officeToken, "sendFeeReminders", { invoiceIds: [] });
    expect(reminder.status).toBe(400);
    expect(await prisma.feeInvoice.count({ where: { studentId: student.id } })).toBe(before);
  });

  it("does not mint an admission invoice from monthly issue operations", async () => {
    const classId = "class-issue-noadm";
    const { student, templateId } = await prepareClass({
      classId,
      studentId: "student-issue-noadm",
      admissionNo: "ADM-WIN-NOADM",
    });
    await prisma.feeInvoice.create({
      data: {
        studentId: student.id,
        classId,
        period: `ADMISSION-${student.id}`,
        title: "One-time admission fee",
        amount: 5000,
        linesJson: "[]",
        dueDate: new Date("2026-06-01T00:00:00.000Z"),
        status: "DUE",
      },
    });
    freezeOn(new Date(2026, 9, 4, 12, 0, 0));
    await act(officeToken, "issueClassFees", { classId, templateId });
    await act(officeToken, "issueDueFees", { classId });
    const admissions = await prisma.feeInvoice.findMany({
      where: { studentId: student.id, period: { startsWith: "ADMISSION-" } },
    });
    expect(admissions).toHaveLength(1);
    expect(await periodsFor(student.id)).toContain("2026-06");
  });
});
