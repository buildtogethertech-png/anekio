import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";
import { invoiceBalance, parseFeeLines } from "../../lib/fees";

const razorpayMock = vi.hoisted(() => ({
  createOrder: vi.fn(async (input: { amount: number }) => ({ id: "order_life", amount: input.amount, currency: "INR" })),
  fetchPayment: vi.fn(async () => ({
    id: "pay_life",
    status: "captured",
    amount: 490000,
    currency: "INR",
    order_id: "order_life",
    notes: { studentToken: "", invoiceIds: "" },
  })),
}));

vi.mock("razorpay", () => ({
  default: class {
    orders = { create: razorpayMock.createOrder };
    payments = { fetch: razorpayMock.fetchPayment, capture: vi.fn() };
  },
}));

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fixture: PortalFixture;
let officeToken = "";
let parentToken = "";
let teacherToken = "";
let studentToken = "";

async function login(email: string, password = fixture.password) {
  return request(app).post("/api/v1/login").send({ login: email, password });
}

async function act(token: string, op: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/v1/act")
    .set({ Authorization: `Bearer ${token}` })
    .send({ op, ...body });
}

function sign(orderId: string, paymentId: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

describe.sequential("fees module lifecycle API", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "fees-lifecycle-test-secret-with-enough-entropy";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
    parentToken = (await login(fixture.users.parent.email)).body.token;
    teacherToken = (await login(fixture.users.teacher.email)).body.token;
    studentToken = (await login(fixture.users.student.email)).body.token;
  }, 120_000);

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("rejects setup without a class and without fee lines; clamps due day to 1–30", async () => {
    const noClass = await act(officeToken, "saveFeeTemplate", {
      name: "Monthly fee",
      dueDay: 10,
      lines: [{ label: "Tuition", amount: 8000, scope: "ALL" }],
    });
    expect(noClass.status).toBe(400);
    expect(noClass.body.error).toMatch(/class/i);

    const noLines = await act(officeToken, "saveFeeTemplate", {
      classId: fixture.classId,
      sessionId: "session-2026",
      name: "Monthly fee",
      dueDay: 10,
      lines: [],
    });
    expect(noLines.status).toBe(400);
    expect(noLines.body.error).toMatch(/charge/i);

    const zeroDue = await act(officeToken, "saveFeeTemplate", {
      classId: fixture.classId,
      sessionId: "session-2026",
      name: "Monthly fee",
      startsPeriod: "2026-04",
      endsPeriod: "2026-04",
      dueDay: 0,
      lines: [{ label: "Tuition", amount: 100, scope: "ALL" }],
    });
    expect(zeroDue.status).toBe(200);
    const zeroTpl = await prisma.feeTemplate.findUniqueOrThrow({ where: { id: zeroDue.body.id } });
    expect(zeroTpl.dueDay).toBe(10);

    const highDue = await act(officeToken, "saveFeeTemplate", {
      templateId: zeroDue.body.id,
      classId: fixture.classId,
      sessionId: "session-2026",
      name: "Monthly fee",
      startsPeriod: "2026-04",
      endsPeriod: "2026-04",
      dueDay: 99,
      lines: [{ label: "Tuition", amount: 100, scope: "ALL" }],
    });
    expect(highDue.status).toBe(200);
    expect((await prisma.feeTemplate.findUniqueOrThrow({ where: { id: highDue.body.id } })).dueDay).toBe(30);
  });

  it("saves academic session dates and a school-wide due day", async () => {
    const session = await act(officeToken, "saveFeeAcademicSession", {
      label: "2026 - 2027",
      startsOn: "2026-04-01",
      endsOn: "2027-03-31",
      dueDay: 10,
    });
    expect(session.status).toBe(200);
    expect(session.body.startsOn).toBe("2026-04-01");
    expect(session.body.endsOn).toBe("2027-03-31");
    expect(session.body.dueDay).toBe(10);
  });

  it("creates a 1-A class template with tuition, books, due day 10, and no duplicate overlapping range", async () => {
    const klass = await prisma.class.create({ data: { id: "class-1-a-life", name: "1", section: "A" } });
    const saved = await act(officeToken, "saveFeeTemplate", {
      classId: klass.id,
      sessionId: "session-2026",
      name: "Monthly fee",
      startsPeriod: "2026-04",
      endsPeriod: "2026-04",
      dueDay: 10,
      lateKind: "STATIC",
      lateGraceDays: 5,
      lateAmount: 100,
      lines: [
        { label: "Tuition", amount: 8000, scope: "ALL" },
        { label: "Books", amount: 800, scope: "ALL" },
        { label: "Picnic", amount: 500, scope: "ADD_ON" },
      ],
    });
    expect(saved.status).toBe(200);
    const template = await prisma.feeTemplate.findUniqueOrThrow({
      where: { id: saved.body.id },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
    expect(template.classId).toBe(klass.id);
    expect(template.sessionId).toBe("session-2026");
    expect(template.dueDay).toBe(10);
    expect(template.lines.filter((line) => line.scope !== "ADD_ON").map((line) => line.amount).reduce((a, b) => a + b, 0)).toBe(8800);
    expect(template.lines.some((line) => line.label === "Picnic" && line.scope === "ADD_ON")).toBe(true);

    const overlap = await act(officeToken, "saveFeeTemplate", {
      classId: klass.id,
      sessionId: "session-2026",
      name: "Monthly fee copy",
      startsPeriod: "2026-04",
      endsPeriod: "2026-05",
      dueDay: 10,
      lines: [{ label: "Tuition", amount: 8000, scope: "ALL" }],
    });
    expect(overlap.status).toBe(400);
    expect(overlap.body.error).toMatch(/overlap/i);
  });

  it("issues picnic only to the opted-in classmate and snapshots catalog extras", async () => {
    const studentA = await prisma.student.create({
      data: {
        id: "student-a-life",
        parentId: "parent-pari",
        classId: "class-1-a-life",
        admissionNo: "ADM-LIFE-A",
        name: "Student A Life",
        dateOfBirth: new Date("2015-01-01T00:00:00Z"),
      },
    });
    const studentB = await prisma.student.create({
      data: {
        id: "student-b-life",
        parentId: "parent-pari",
        classId: "class-1-a-life",
        admissionNo: "ADM-LIFE-B",
        name: "Student B Life",
        dateOfBirth: new Date("2015-02-02T00:00:00Z"),
      },
    });
    const catalog = await act(officeToken, "saveFeeCatalog", {
      item: { kind: "TRANSPORT", label: "Route A", amount: 1500, active: true },
    });
    expect(catalog.status).toBe(200);
    const transportId = catalog.body.items.find((item: { kind: string; label: string }) => item.kind === "TRANSPORT" && item.label === "Route A").id;
    const other = await act(officeToken, "saveFeeCatalog", {
      item: { kind: "OTHER", label: "Computer fee", amount: 300, active: true },
    });
    const otherId = other.body.items.find((item: { kind: string; label: string }) => item.label === "Computer fee").id;

    const assigned = await act(officeToken, "assignStudentFees", {
      studentId: studentA.id,
      transportItemId: transportId,
      otherItemIds: [otherId],
      classAddOnLabels: ["Picnic"],
    });
    expect(assigned.status).toBe(200);
    const skipped = await act(officeToken, "assignStudentFees", {
      studentId: studentB.id,
      classAddOnLabels: [],
    });
    expect(skipped.status).toBe(200);

    const issued = await act(officeToken, "issueClassFees", {
      classId: "class-1-a-life",
      startsPeriod: "2026-04",
      endsPeriod: "2026-04",
    });
    expect(issued.status).toBe(200);

    const invA = await prisma.feeInvoice.findFirstOrThrow({ where: { studentId: studentA.id, period: "2026-04" } });
    const invB = await prisma.feeInvoice.findFirstOrThrow({ where: { studentId: studentB.id, period: "2026-04" } });
    const labelsA = parseFeeLines(invA.linesJson).map((line) => line.label);
    const labelsB = parseFeeLines(invB.linesJson).map((line) => line.label);
    expect(invA.amount).toBe(8000 + 800 + 500 + 1500 + 300);
    expect(labelsA).toEqual(expect.arrayContaining(["Tuition", "Books", "Picnic"]));
    expect(invB.amount).toBe(8800);
    expect(labelsB).toEqual(["Tuition", "Books"]);
    expect(invA.shareToken).toBeTruthy();
    expect(invA.status).toBe("DUE");

    const again = await act(officeToken, "issueClassFees", {
      classId: "class-1-a-life",
      startsPeriod: "2026-04",
      endsPeriod: "2026-04",
    });
    expect(again.status).toBe(200);
    expect(await prisma.feeInvoice.count({ where: { studentId: studentA.id, period: "2026-04" } })).toBe(1);
  });

  it("does not mutate issued invoices when class fee or catalog amounts change", async () => {
    const before = await prisma.feeInvoice.findFirstOrThrow({ where: { studentId: "student-a-life", period: "2026-04" } });
    const template = await prisma.feeTemplate.findFirstOrThrow({ where: { classId: "class-1-a-life" } });
    const updated = await act(officeToken, "saveFeeTemplate", {
      templateId: template.id,
      classId: "class-1-a-life",
      sessionId: "session-2026",
      name: "Monthly fee",
      startsPeriod: "2026-04",
      endsPeriod: "2026-04",
      dueDay: 10,
      lateKind: "DAILY",
      lateGraceDays: 0,
      lateAmount: 100,
      lines: [
        { label: "Tuition", amount: 9000, scope: "ALL" },
        { label: "Books", amount: 800, scope: "ALL" },
        { label: "Picnic", amount: 500, scope: "ADD_ON" },
      ],
    });
    expect(updated.status).toBe(200);
    const after = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.amount).toBe(before.amount);
    expect(after.lateKind).toBe("STATIC");
    expect(after.lateAmount).toBe(100);
  });

  it("skips months at or before feeGeneratedThrough for a mid-session joiner", async () => {
    const joiner = await prisma.student.create({
      data: {
        id: "student-joiner-life",
        parentId: "parent-pari",
        classId: "class-1-a-life",
        admissionNo: "ADM-LIFE-J",
        name: "Joiner Life",
        dateOfBirth: new Date("2015-08-01T00:00:00Z"),
        feeGeneratedThrough: "2026-07",
      },
    });
    const template = await prisma.feeTemplate.findFirstOrThrow({ where: { classId: "class-1-a-life" } });
    await act(officeToken, "saveFeeTemplate", {
      templateId: template.id,
      classId: "class-1-a-life",
      sessionId: "session-2026",
      name: "Monthly fee",
      startsPeriod: "2026-04",
      endsPeriod: "2026-08",
      dueDay: 10,
      lateKind: "STATIC",
      lateGraceDays: 5,
      lateAmount: 100,
      lines: [
        { label: "Tuition", amount: 9000, scope: "ALL" },
        { label: "Books", amount: 800, scope: "ALL" },
      ],
    });
    const issued = await act(officeToken, "issueClassFees", { classId: "class-1-a-life" });
    expect(issued.status).toBe(200);
    const periods = (await prisma.feeInvoice.findMany({ where: { studentId: joiner.id } })).map((row) => row.period).sort();
    expect(periods.every((period) => period > "2026-07")).toBe(true);
    expect(periods).toContain("2026-08");
    expect(periods).not.toContain("2026-04");
  });

  it("walks the golden path: grace, late, partial cash, parent Razorpay remainder, then immutable history", async () => {
    await prisma.schoolConfig.update({
      where: { id: "school" },
      data: { payGateway: "RAZORPAY", razorpayKeyId: "rzp_test_ok", razorpayKeySecret: "school-secret" },
    });
    const goldClass = await prisma.class.create({ data: { id: "class-gold-1a", name: "Gold", section: "A" } });
    const child = await prisma.student.create({
      data: {
        id: "student-gold",
        parentId: "parent-pari",
        classId: goldClass.id,
        admissionNo: "ADM-GOLD",
        name: "Golden Child",
        dateOfBirth: new Date("2014-04-01T00:00:00Z"),
        payToken: "pay-gold-child",
      },
    });
    const saved = await act(officeToken, "saveFeeTemplate", {
      classId: goldClass.id,
      sessionId: "session-2026",
      name: "Monthly fee",
      startsPeriod: "2026-04",
      endsPeriod: "2026-04",
      dueDay: 10,
      lateKind: "STATIC",
      lateGraceDays: 5,
      lateAmount: 100,
      lines: [
        { label: "Tuition", amount: 8000, scope: "ALL" },
        { label: "Books", amount: 800, scope: "ALL" },
      ],
    });
    expect(saved.status).toBe(200);
    const issued = await act(officeToken, "issueClassFees", { classId: goldClass.id, templateId: saved.body.id });
    expect(issued.status).toBe(200);
    const april = await prisma.feeInvoice.findFirstOrThrow({ where: { studentId: child.id, period: "2026-04" } });
    expect(april.amount).toBe(8800);
    expect(april.dueDate.getDate()).toBe(10);
    expect(april.dueDate.getMonth()).toBe(3);
    expect(april.status).toBe("DUE");
    expect(april.lateKind).toBe("STATIC");
    expect(april.lateAmount).toBe(100);
    expect(april.lateGraceDays).toBe(5);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 15, 12, 0, 0));
    expect(invoiceBalance(april).late).toBe(0);
    expect(invoiceBalance(april).dueNow).toBe(8800);

    vi.setSystemTime(new Date(2026, 3, 16, 0, 1, 0));
    expect(invoiceBalance(april).late).toBe(100);
    expect(invoiceBalance(april).dueNow).toBe(8900);
    vi.useRealTimers();

    const partial = await act(officeToken, "collectFee", {
      invoiceId: april.id,
      amount: 4000,
      method: "CASH",
    });
    expect(partial.status).toBe(200);
    const afterPartial = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: april.id }, include: { payments: true } });
    expect(afterPartial.status).toBe("PARTIAL");
    expect(invoiceBalance(afterPartial).remaining).toBe(4800);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 20, 10, 0, 0));
    const dueNow = invoiceBalance(afterPartial).dueNow;
    expect(dueNow).toBe(4900);
    vi.useRealTimers();

    const link = await act(parentToken, "ensurePayLink", { studentId: child.id, invoiceIds: [april.id] });
    expect(link.status).toBe(200);
    expect(link.body.path).toMatch(/\/pay\/s\//);

    razorpayMock.createOrder.mockClear();
    razorpayMock.fetchPayment.mockResolvedValue({
      id: "pay_gold",
      status: "captured",
      amount: dueNow * 100,
      currency: "INR",
      order_id: "order_gold",
      notes: { studentToken: "pay-gold-child", invoiceIds: april.id },
    });
    const order = await request(app).post("/api/pay/order").send({
      studentToken: "pay-gold-child",
      invoiceIds: [april.id],
    });
    expect(order.status).toBe(200);
    expect(order.body.currency || "INR").toBe("INR");
    expect(JSON.stringify(order.body)).not.toMatch(/school-secret|key_secret/i);

    const verified = await request(app).post("/api/pay/verify").send({
      studentToken: "pay-gold-child",
      invoiceIds: [april.id],
      razorpay_order_id: "order_gold",
      razorpay_payment_id: "pay_gold",
      razorpay_signature: sign("order_gold", "pay_gold", "school-secret"),
    });
    expect(verified.status).toBe(200);
    const paid = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: april.id }, include: { payments: true } });
    expect(invoiceBalance(paid).dueNow).toBe(0);
    expect(paid.status).toBe("PAID");

    const parentRecord = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${parentToken}` });
    expect(parentRecord.status).toBe(200);
    const goldChild = (parentRecord.body.children || []).find((row: { id: string }) => row.id === child.id);
    expect(goldChild || parentRecord.body.child?.id === child.id).toBeTruthy();

    await act(officeToken, "saveFeeTemplate", {
      templateId: saved.body.id,
      classId: goldClass.id,
      sessionId: "session-2026",
      name: "Monthly fee",
      startsPeriod: "2026-04",
      endsPeriod: "2026-05",
      dueDay: 10,
      lateKind: "STATIC",
      lateGraceDays: 5,
      lateAmount: 100,
      lines: [
        { label: "Tuition", amount: 9000, scope: "ALL" },
        { label: "Books", amount: 800, scope: "ALL" },
      ],
    });
    const mayIssue = await act(officeToken, "issueClassFees", { classId: goldClass.id, templateId: saved.body.id });
    expect(mayIssue.status).toBe(200);
    const may = await prisma.feeInvoice.findFirstOrThrow({ where: { studentId: child.id, period: "2026-05" } });
    expect(may.amount).toBe(9800);
    expect((await prisma.feeInvoice.findUniqueOrThrow({ where: { id: april.id } })).amount).toBe(8800);
  });

  it("stores UPI, bank, and cheque references and caps overpayment at dueNow", async () => {
    const invoice = await prisma.feeInvoice.create({
      data: {
        id: "invoice-methods-life",
        studentId: fixture.studentId,
        classId: fixture.classId,
        period: "2026-11",
        title: "November 2026 · Monthly fee",
        amount: 1000,
        dueDate: new Date("2026-11-10T00:00:00Z"),
        shareToken: "invoice-methods-life",
      },
    });
    const upi = await act(officeToken, "collectFee", { invoiceId: invoice.id, amount: 200, method: "UPI", reference: "UTR123456" });
    expect(upi.status).toBe(200);
    expect((await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id, method: "UPI" } })).reference).toBe("UTR123456");

    const bank = await act(officeToken, "collectFee", { invoiceId: invoice.id, amount: 200, method: "BANK", reference: "NEFT999" });
    expect(bank.status).toBe(200);
    expect((await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id, method: "BANK" } })).reference).toBe("NEFT999");

    const chequeMissing = await act(officeToken, "collectFee", { invoiceId: invoice.id, amount: 100, method: "CHEQUE" });
    expect(chequeMissing.status).toBe(400);
    expect(chequeMissing.body.error).toMatch(/cheque/i);

    const cheque = await act(officeToken, "collectFee", { invoiceId: invoice.id, amount: 100, method: "CHEQUE", reference: "CHQ-88" });
    expect(cheque.status).toBe(200);

    const zero = await act(officeToken, "collectFee", { invoiceId: invoice.id, amount: 0, method: "CASH" });
    expect(zero.status).toBe(400);

    const negative = await act(officeToken, "collectFee", { invoiceId: invoice.id, amount: -50, method: "CASH" });
    expect(negative.status).toBe(400);

    const before = invoiceBalance(await prisma.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: true } }));
    const over = await act(officeToken, "collectFee", { invoiceId: invoice.id, amount: 999999, method: "CASH" });
    expect(over.status).toBe(200);
    const after = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: true } });
    const credited = after.payments.reduce((sum, row) => sum + row.amount, 0) - (1000 - before.remaining);
    expect(credited).toBe(before.dueNow);
    expect(invoiceBalance(after).dueNow).toBe(0);
  });

  it("expands parent pay links to older unpaid months for the same student", async () => {
    const april = await prisma.feeInvoice.create({
      data: {
        studentId: fixture.studentId,
        classId: fixture.classId,
        period: "2026-01",
        title: "January 2026 · Monthly fee",
        amount: 100,
        dueDate: new Date("2026-01-10T00:00:00Z"),
        shareToken: "inv-old-jan",
      },
    });
    const june = await prisma.feeInvoice.create({
      data: {
        studentId: fixture.studentId,
        classId: fixture.classId,
        period: "2026-03",
        title: "March 2026 · Monthly fee",
        amount: 100,
        dueDate: new Date("2026-03-10T00:00:00Z"),
        shareToken: "inv-old-mar",
      },
    });
    const link = await act(parentToken, "ensurePayLink", { studentId: fixture.studentId, invoiceIds: [june.id] });
    expect(link.status).toBe(200);
    expect(String(link.body.path)).toContain("2026-01");
    expect(String(link.body.path)).toContain("2026-03");
    expect(link.body.invoiceIds).toEqual(expect.arrayContaining([april.id, june.id]));
  });

  it("saves a one-time admission fee and stamps it once when a student is admitted", async () => {
    const setup = await act(officeToken, "saveAdmissionFeeSetup", {
      lines: [
        { label: "Admission fee", amount: 4000 },
        { label: "Prospectus", amount: 1000 },
      ],
    });
    expect(setup.status).toBe(200);
    expect(setup.body.amount).toBe(5000);
    const lead = await prisma.admissionLead.create({
      data: {
        studentName: "Admit Life",
        guardianName: "Guardian Life",
        phone: "9876500111",
        email: "admit.life@school.test",
        classWanted: "1-A",
      },
    });
    const admitted = await act(officeToken, "admitLeadAsStudent", {
      leadId: lead.id,
      studentName: "Admit Life",
      admissionNo: "ADM-ADMIT-1",
      classId: "class-1-a-life",
      dateOfBirth: "2015-03-03",
      guardianName: "Guardian Life",
      parentEmail: "guardian.life@school.test",
      parentPhone: "9876500111",
      address: "1 Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      paymentMethod: "CASH",
    });
    expect(admitted.status).toBe(200);
    const invoices = await prisma.feeInvoice.findMany({ where: { studentId: admitted.body.studentId, period: { startsWith: "ADMISSION-" } } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].amount).toBe(5000);
    expect(invoices[0].status).toBe("PAID");
    await act(officeToken, "saveAdmissionFeeSetup", { amount: 7000 });
    expect((await prisma.feeInvoice.findUniqueOrThrow({ where: { id: invoices[0].id } })).amount).toBe(5000);
  });

  it("keeps a different one-time admission fee on each class", async () => {
    const classA = await prisma.class.create({ data: { id: "class-adm-a", name: "9", section: "A" } });
    const classB = await prisma.class.create({ data: { id: "class-adm-b", name: "9", section: "B" } });
    const savedA = await act(officeToken, "saveAdmissionFeeSetup", {
      classId: classA.id,
      lines: [
        { label: "Admission fee", amount: 3000 },
        { label: "ID card", amount: 100 },
      ],
    });
    expect(savedA.status).toBe(200);
    const savedB = await act(officeToken, "saveAdmissionFeeSetup", {
      classId: classB.id,
      lines: [{ label: "Admission fee", amount: 8000 }],
    });
    expect(savedB.status).toBe(200);
    const rowsA = await prisma.admissionFeeLine.findMany({ where: { classId: classA.id }, orderBy: { sortOrder: "asc" } });
    const rowsB = await prisma.admissionFeeLine.findMany({ where: { classId: classB.id }, orderBy: { sortOrder: "asc" } });
    expect(rowsA.map((row) => [row.label, row.amount])).toEqual([
      ["Admission fee", 3000],
      ["ID card", 100],
    ]);
    expect(rowsB.map((row) => [row.label, row.amount])).toEqual([["Admission fee", 8000]]);
  });

  it("blocks parent, student, and teacher from office fee writes", async () => {
    for (const [token, op] of [
      [parentToken, "saveFeeTemplate"],
      [parentToken, "issueClassFees"],
      [parentToken, "issueDueFees"],
      [parentToken, "collectFee"],
      [parentToken, "saveFeeCatalog"],
      [parentToken, "sendFeeReminders"],
      [studentToken, "collectFee"],
      [studentToken, "saveFeeTemplate"],
      [teacherToken, "collectFee"],
      [teacherToken, "saveFeeTemplate"],
      [teacherToken, "issueDueFees"],
      [teacherToken, "sendFeeReminders"],
    ] as const) {
      const response = await act(token, op, { classId: fixture.classId, invoiceId: "invoice-anaya-april", invoiceIds: ["invoice-anaya-april"] });
      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/access/i);
    }
  });

  it("keeps parent and student records on their own family", async () => {
    const strangerParent = await prisma.user.create({
      data: {
        id: "user-stranger-parent",
        email: "stranger.parent@school.test",
        password: fixture.users.parent.email,
        name: "Stranger Parent",
        roleId: "role-parent",
        parent: { create: { id: "parent-stranger", phone: "9000000099" } },
      },
    });
    await prisma.student.create({
      data: {
        id: "student-stranger",
        parentId: "parent-stranger",
        classId: fixture.classId,
        admissionNo: "ADM-STRANGER",
        name: "Stranger Child",
        dateOfBirth: new Date("2014-01-01T00:00:00Z"),
      },
    });
    const parentRecord = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${parentToken}` });
    expect(parentRecord.status).toBe(200);
    expect(JSON.stringify(parentRecord.body)).toContain("Anaya");
    expect(JSON.stringify(parentRecord.body)).not.toContain("Stranger Child");

    const studentRecord = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${studentToken}` });
    expect(studentRecord.status).toBe(200);
    expect(JSON.stringify(studentRecord.body)).toContain("Anaya");
    expect(JSON.stringify(studentRecord.body)).not.toContain("Stranger Child");

    const stolen = await act(parentToken, "ensurePayToken", { invoiceId: "missing-invoice" });
    expect(stolen.status).toBe(400);

    void strangerParent;
    const foreignInvoice = await prisma.feeInvoice.create({
      data: {
        studentId: "student-stranger",
        classId: fixture.classId,
        period: "2026-12",
        title: "December 2026 · Monthly fee",
        amount: 100,
        dueDate: new Date("2026-12-10T00:00:00Z"),
        shareToken: "inv-stranger-dec",
      },
    });
    const otherFamily = await act(parentToken, "ensurePayToken", { invoiceId: foreignInvoice.id });
    expect(otherFamily.status).toBe(400);
  });

  it("does not remind a paid invoice and rejects an empty reminder list", async () => {
    const empty = await act(officeToken, "sendFeeReminders", { invoiceIds: [] });
    expect(empty.status).toBe(400);
    const paid = await prisma.feeInvoice.findFirstOrThrow({ where: { studentId: "student-gold", period: "2026-04" } });
    const reminded = await act(officeToken, "sendFeeReminders", { invoiceIds: [paid.id] });
    expect(reminded.status).toBe(400);
    expect(reminded.body.error).not.toMatch(/overdue/i);
  });

  it("never returns another school's Razorpay secret on order errors", async () => {
    await prisma.schoolConfig.update({
      where: { id: "school" },
      data: { payGateway: "RAZORPAY", razorpayKeyId: "rzp_test_visible", razorpayKeySecret: "" },
    });
    const response = await request(app).post("/api/pay/order").send({ token: "invoice-anaya-april" });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).not.toContain("rzp_test_visible");
    expect(response.body.error).toMatch(/secret/i);
  });
});
