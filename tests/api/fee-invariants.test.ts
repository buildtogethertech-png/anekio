import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { invoiceBalance } from "../../lib/fees";
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

describe.sequential("fee P0 invariants", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "fee-invariants-test-secret-with-enough-entropy";
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

  it("enforces one monthly invoice per student+period at the database, and lets admission coexist", async () => {
    const classId = "class-inv-unique";
    await prisma.class.create({ data: { id: classId, name: "Inv", section: "U" } });
    const studentA = await prisma.student.create({
      data: {
        id: "student-inv-a",
        parentId: "parent-pari",
        classId,
        admissionNo: "ADM-INV-A",
        name: "Inv A",
        dateOfBirth: new Date("2015-01-01T00:00:00Z"),
      },
    });
    const studentB = await prisma.student.create({
      data: {
        id: "student-inv-b",
        parentId: "parent-pari",
        classId,
        admissionNo: "ADM-INV-B",
        name: "Inv B",
        dateOfBirth: new Date("2015-01-01T00:00:00Z"),
      },
    });
    const base = {
      classId,
      title: "June",
      amount: 1000,
      linesJson: "[]",
      dueDate: new Date("2026-06-10T00:00:00.000Z"),
      status: "DUE" as const,
    };
    await prisma.feeInvoice.create({ data: { ...base, studentId: studentA.id, period: "2026-06" } });
    await expect(
      prisma.feeInvoice.create({ data: { ...base, studentId: studentA.id, period: "2026-06" } })
    ).rejects.toMatchObject({ code: "P2002" });
    await prisma.feeInvoice.create({ data: { ...base, studentId: studentA.id, period: "2026-07", title: "July" } });
    await prisma.feeInvoice.create({ data: { ...base, studentId: studentB.id, period: "2026-06" } });
    await prisma.feeInvoice.create({
      data: { ...base, studentId: studentA.id, period: `ADMISSION-${studentA.id}`, title: "Admission", amount: 4000 },
    });
    const periods = (await prisma.feeInvoice.findMany({ where: { studentId: studentA.id } })).map((row) => row.period).sort();
    expect(periods).toEqual(["2026-06", "2026-07", `ADMISSION-${studentA.id}`]);
  });

  it("creates admission once, then a June monthly invoice, and does not rebill on edit or monthly issue", async () => {
    const classId = "class-inv-admit";
    await prisma.class.create({ data: { id: classId, name: "Inv", section: "A" } });
    const setup = await act(officeToken, "saveAdmissionFeeSetup", {
      classId,
      lines: [{ label: "Admission fee", amount: 4000 }],
    });
    expect(setup.status).toBe(200);
    const created = await act(officeToken, "createStudent", {
      name: "Admit Coexist",
      classId,
      parentId: "parent-pari",
      dateOfBirth: "2015-06-01",
      dateOfJoining: "2026-06-15",
    });
    expect(created.status).toBe(200);
    const student = await prisma.student.findFirstOrThrow({ where: { admissionNo: created.body.admissionNo } });
    expect(created.body.admissionInvoiceId).toBeTruthy();
    expect(
      await prisma.feeInvoice.count({ where: { studentId: student.id, period: `ADMISSION-${student.id}` } })
    ).toBe(1);

    const renamed = await act(officeToken, "updateStudent", {
      studentId: student.id,
      name: "Admit Coexist Edited",
      admissionNo: student.admissionNo,
      classId,
      parentId: "parent-pari",
      dateOfBirth: "2015-06-01",
      parentPhone: "9876540003",
      parentName: "Pari Parent",
      address: "1 Fixture Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
    });
    expect(renamed.status).toBe(200);
    expect(
      await prisma.feeInvoice.count({ where: { studentId: student.id, period: { startsWith: "ADMISSION-" } } })
    ).toBe(1);

    const saved = await act(officeToken, "saveFeeTemplate", {
      classId,
      sessionId: "session-2026",
      name: "Monthly fee",
      startsPeriod: "2026-06",
      endsPeriod: "2026-07",
      dueDay: 10,
      lines: [{ label: "Tuition", amount: 2500, scope: "ALL" }],
    });
    expect(saved.status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 2, 12, 0, 0));
    expect((await act(officeToken, "issueClassFees", { classId, templateId: saved.body.id })).status).toBe(200);
    expect((await act(officeToken, "issueDueFees", { classId })).status).toBe(200);
    vi.useRealTimers();

    const invoices = await prisma.feeInvoice.findMany({ where: { studentId: student.id } });
    const periods = invoices.map((row) => row.period).sort();
    expect(periods.filter((period) => period.startsWith("ADMISSION-"))).toHaveLength(1);
    expect(periods).toContain("2026-06");
    expect(periods).toContain("2026-07");
    expect(invoices.find((row) => row.period === "2026-06")?.amount).toBe(2500);
    expect(invoices.find((row) => row.period.startsWith("ADMISSION-"))?.amount).toBe(4000);
  });

  it("collect-all pays open months including late, skips PAID, and is idempotent", async () => {
    const classId = "class-inv-collect";
    await prisma.class.create({ data: { id: classId, name: "Inv", section: "C" } });
    const student = await prisma.student.create({
      data: {
        id: "student-inv-collect",
        parentId: "parent-pari",
        classId,
        admissionNo: "ADM-INV-COL",
        name: "Collect All",
        dateOfBirth: new Date("2015-01-01T00:00:00Z"),
      },
    });
    const late = { lateKind: "STATIC", lateGraceDays: 0, lateAmount: 100 };
    await prisma.feeInvoice.create({
      data: {
        studentId: student.id,
        classId,
        period: "2026-04",
        title: "April",
        amount: 2000,
        linesJson: "[]",
        dueDate: new Date(2026, 3, 10),
        status: "PAID",
        ...late,
        payments: { create: { amount: 2000, method: "CASH", notes: "April paid" } },
      },
    });
    const may = await prisma.feeInvoice.create({
      data: {
        studentId: student.id,
        classId,
        period: "2026-05",
        title: "May",
        amount: 2000,
        linesJson: "[]",
        dueDate: new Date(2026, 4, 10),
        status: "DUE",
        ...late,
      },
    });
    const june = await prisma.feeInvoice.create({
      data: {
        studentId: student.id,
        classId,
        period: "2026-06",
        title: "June",
        amount: 2000,
        linesJson: "[]",
        dueDate: new Date(2026, 5, 10),
        status: "PARTIAL",
        ...late,
        payments: { create: { amount: 1000, method: "UPI", reference: "UTR-JUNE-1" } },
      },
    });
    const july = await prisma.feeInvoice.create({
      data: {
        studentId: student.id,
        classId,
        period: "2026-07",
        title: "July",
        amount: 2500,
        linesJson: "[]",
        dueDate: new Date(2026, 6, 10),
        status: "OVERDUE",
        ...late,
      },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
    const mayDue = invoiceBalance(await prisma.feeInvoice.findUniqueOrThrow({ where: { id: may.id }, include: { payments: true } })).dueNow;
    const juneDue = invoiceBalance(await prisma.feeInvoice.findUniqueOrThrow({ where: { id: june.id }, include: { payments: true } })).dueNow;
    const julyDue = invoiceBalance(await prisma.feeInvoice.findUniqueOrThrow({ where: { id: july.id }, include: { payments: true } })).dueNow;
    const collected = await act(officeToken, "collectAllStudentFees", { studentId: student.id, method: "CASH" });
    expect(collected.status).toBe(200);
    const again = await act(officeToken, "collectAllStudentFees", { studentId: student.id, method: "CASH" });
    expect(again.status).toBe(400);
    vi.useRealTimers();

    const payments = await prisma.payment.findMany({ where: { invoice: { studentId: student.id } } });
    expect(payments.filter((row) => row.notes === "April paid")).toHaveLength(1);
    const later = payments.filter((row) => row.notes === "Full payment");
    expect(later.reduce((sum, row) => sum + row.amount, 0)).toBe(mayDue + juneDue + julyDue);
    for (const invoice of await prisma.feeInvoice.findMany({ where: { studentId: student.id }, include: { payments: true } })) {
      expect(invoiceBalance(invoice).dueNow).toBe(0);
      expect(invoice.status).toBe("PAID");
    }
  });

  it("rejects a second cashier collection after the invoice is paid", async () => {
    const invoice = await prisma.feeInvoice.create({
      data: {
        studentId: fixture.studentId,
        classId: fixture.classId,
        period: "2026-11",
        title: "November",
        amount: 5000,
        linesJson: "[]",
        dueDate: new Date(2026, 10, 10),
        status: "DUE",
      },
    });
    const first = await act(officeToken, "collectFee", { invoiceId: invoice.id, amount: 5000, method: "CASH" });
    const second = await act(officeToken, "collectFee", { invoiceId: invoice.id, amount: 5000, method: "CASH" });
    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(payments.reduce((sum, row) => sum + row.amount, 0)).toBe(5000);
  });

  it("caps concurrent cashier collections at dueNow", async () => {
    const invoice = await prisma.feeInvoice.create({
      data: {
        studentId: fixture.studentId,
        classId: fixture.classId,
        period: "2026-12",
        title: "December",
        amount: 5000,
        linesJson: "[]",
        dueDate: new Date(2026, 11, 10),
        status: "DUE",
      },
    });
    const [first, second] = await Promise.all([
      act(officeToken, "collectFee", { invoiceId: invoice.id, amount: 5000, method: "CASH" }),
      act(officeToken, "collectFee", { invoiceId: invoice.id, amount: 5000, method: "CASH" }),
    ]);
    expect([first.status, second.status].some((status) => status === 200)).toBe(true);
    const paid = (await prisma.payment.findMany({ where: { invoiceId: invoice.id } })).reduce(
      (sum, row) => sum + row.amount,
      0
    );
    expect(paid).toBeLessThanOrEqual(5000);
  });

  it("reconciles Register billed/paid/outstanding with invoice and payment rows", async () => {
    const classId = "class-inv-report";
    await prisma.class.create({ data: { id: classId, name: "Inv", section: "R" } });
    const student = await prisma.student.create({
      data: {
        id: "student-inv-report",
        parentId: "parent-pari",
        classId,
        admissionNo: "ADM-INV-REP",
        name: "Report Child",
        dateOfBirth: new Date("2015-01-01T00:00:00Z"),
      },
    });
    await prisma.studentClassEnrollment.create({
      data: { studentId: student.id, classId, sessionId: "session-2026", rollNumber: 9, joinedAt: new Date("2026-04-01") },
    });
    await prisma.feeInvoice.create({
      data: {
        studentId: student.id,
        classId,
        period: "2026-08",
        title: "August",
        amount: 3000,
        linesJson: "[]",
        dueDate: new Date(2026, 7, 10),
        status: "PARTIAL",
        payments: { create: { amount: 1000, method: "CASH" } },
      },
    });
    await prisma.feeInvoice.create({
      data: {
        studentId: student.id,
        classId,
        period: "2026-09",
        title: "September",
        amount: 3000,
        linesJson: "[]",
        dueDate: new Date(2026, 8, 10),
        status: "DUE",
      },
    });
    const register = await request(app)
      .get("/api/v1/fee-register")
      .query({ classId, sessionId: "session-2026", pageSize: 50 })
      .set({ Authorization: `Bearer ${officeToken}` });
    expect(register.status).toBe(200);
    const invoices = await prisma.feeInvoice.findMany({
      where: { studentId: student.id },
      include: { payments: true },
    });
    const billed = invoices.reduce((sum, row) => sum + row.amount, 0);
    const paid = invoices.reduce((sum, row) => sum + row.payments.reduce((inner, payment) => inner + payment.amount, 0), 0);
    const outstanding = invoices.reduce((sum, row) => sum + invoiceBalance(row).dueNow, 0);
    const rows = (register.body.rows as { studentId: string }[]).filter((row) => row.studentId === student.id);
    expect(rows.reduce((sum, row) => sum + Number((row as { total: number }).total), 0)).toBe(billed);
    expect(rows.reduce((sum, row) => sum + Number((row as { paid: number }).paid), 0)).toBe(paid);
    expect(rows.reduce((sum, row) => sum + Number((row as { dueNow: number }).dueNow), 0)).toBe(outstanding);
    expect(register.body.history[student.id]).toHaveLength(2);
  });
});
