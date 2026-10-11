import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";
import { invoiceBalance, invoiceLatePolicy } from "../../lib/fees";

const razorpayMock = vi.hoisted(() => ({
  createOrder: vi.fn(async (input: { amount: number }) => ({ id: "order_test", amount: input.amount, currency: "INR" })),
  fetchPayment: vi.fn(async () => ({
    id: "pay_test",
    status: "captured",
    amount: 25000000,
    currency: "INR",
    order_id: "order_test",
    notes: { invoiceId: "invoice-anaya-april", token: "invoice-anaya-april" } as Record<string, string>,
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

describe.sequential("fee payment integrity API", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "fee-pay-integrity-test-secret-with-enough-entropy";
    database = createPushedTestDatabase();
    vi.resetModules();
    const prismaModule = await import("../../lib/prisma");
    prisma = prismaModule.prisma;
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
    parentToken = (await login(fixture.users.parent.email)).body.token;
    teacherToken = (await login(fixture.users.teacher.email)).body.token;
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not start Razorpay when gateway is NONE", async () => {
    await prisma.schoolConfig.update({
      where: { id: "school" },
      data: { payGateway: "NONE", razorpayKeyId: "", razorpayKeySecret: "" },
    });
    const response = await request(app).post("/api/pay/order").send({ token: "invoice-anaya-april" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not connected a payment gateway/i);
    expect(razorpayMock.createOrder).not.toHaveBeenCalled();
  });

  it("returns a clear error when Razorpay secret is missing", async () => {
    await prisma.schoolConfig.update({
      where: { id: "school" },
      data: { payGateway: "RAZORPAY", razorpayKeyId: "rzp_test_missing_secret", razorpayKeySecret: "" },
    });
    const response = await request(app).post("/api/pay/order").send({ token: "invoice-anaya-april" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/secret/i);
    expect(JSON.stringify(response.body)).not.toContain("rzp_test_missing_secret");
  });

  it("never uses another school's Razorpay credentials", async () => {
    await prisma.saasOrg.create({
      data: {
        id: "org-school-a",
        schoolName: "School A",
        ownerName: "A",
        ownerEmail: "a-owner@school.test",
        ownerPhone: "9000000001",
      },
    });
    await prisma.saasOrg.create({
      data: {
        id: "org-school-b",
        schoolName: "School B",
        ownerName: "B",
        ownerEmail: "b-owner@school.test",
        ownerPhone: "9000000002",
      },
    });
    await prisma.schoolConfig.create({
      data: {
        id: "school:org-school-a",
        orgId: "org-school-a",
        name: "School A",
        payGateway: "RAZORPAY",
        razorpayKeyId: "rzp_test_school_a",
        razorpayKeySecret: "secret-a",
      },
    });
    await prisma.schoolConfig.create({
      data: {
        id: "school:org-school-b",
        orgId: "org-school-b",
        name: "School B",
        payGateway: "RAZORPAY",
        razorpayKeyId: "rzp_test_school_b",
        razorpayKeySecret: "secret-b",
      },
    });
    const { getSchoolPaySecrets } = await import("../../lib/pay-config");
    const a = await getSchoolPaySecrets("org-school-a");
    const b = await getSchoolPaySecrets("org-school-b");
    expect(a.razorpayKeyId).toBe("rzp_test_school_a");
    expect(b.razorpayKeyId).toBe("rzp_test_school_b");
    expect(a.razorpayKeySecret).not.toBe(b.razorpayKeySecret);
  });

  it("collects cash without creating a Razorpay order", async () => {
    const before = await prisma.payment.count();
    const response = await act(officeToken, "collectFee", {
      invoiceId: "invoice-anaya-april",
      amount: 500,
      method: "CASH",
    });
    expect(response.status).toBe(200);
    expect(razorpayMock.createOrder).not.toHaveBeenCalled();
    const payments = await prisma.payment.findMany({ where: { invoiceId: "invoice-anaya-april" } });
    expect(payments.length).toBeGreaterThan(before);
    expect(payments.some((row) => row.method === "CASH" && row.amount === 500)).toBe(true);
    const invoice = await prisma.feeInvoice.findUniqueOrThrow({
      where: { id: "invoice-anaya-april" },
      include: { payments: true },
    });
    expect(invoiceBalance(invoice).paid).toBe(500);
    expect(invoice.status).toBe("PARTIAL");
  });

  it("collects remaining UPI without Razorpay", async () => {
    const invoice = await prisma.feeInvoice.findUniqueOrThrow({
      where: { id: "invoice-anaya-april" },
      include: { payments: true },
    });
    const due = invoiceBalance(invoice).dueNow;
    const response = await act(officeToken, "collectFee", {
      invoiceId: "invoice-anaya-april",
      amount: due,
      method: "UPI",
      reference: "UPI-TEST-REF-1",
    });
    expect(response.status).toBe(200);
    expect(razorpayMock.createOrder).not.toHaveBeenCalled();
    const paid = await prisma.feeInvoice.findUniqueOrThrow({
      where: { id: "invoice-anaya-april" },
      include: { payments: true },
    });
    expect(invoiceBalance(paid).dueNow).toBe(0);
    expect(paid.status).toBe("PAID");
    expect(paid.payments.some((row) => row.method === "UPI" && row.reference === "UPI-TEST-REF-1")).toBe(true);
  });

  it("rejects a second collection after the invoice is paid", async () => {
    const response = await act(officeToken, "collectFee", {
      invoiceId: "invoice-anaya-april",
      method: "CASH",
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/already paid/i);
  });

  it("rejects office collection from a teacher", async () => {
    const response = await act(teacherToken, "collectFee", {
      invoiceId: "invoice-anaya-april",
      method: "CASH",
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/access/i);
  });

  it("keeps parent records isolated to their children", async () => {
    const mine = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${parentToken}` });
    expect(mine.status).toBe(200);
    const blob = JSON.stringify(mine.body);
    expect(blob).toContain("Anaya");
    expect(blob).not.toContain(officeToken);
  });

  it("rejects an invalid Razorpay checkout signature", async () => {
    await prisma.schoolConfig.update({
      where: { id: "school" },
      data: { payGateway: "RAZORPAY", razorpayKeyId: "rzp_test_ok", razorpayKeySecret: "school-secret" },
    });
    await prisma.feeInvoice.create({
      data: {
        id: "invoice-anaya-may",
        studentId: fixture.studentId,
        classId: fixture.classId,
        period: "2026-05",
        title: "May fees",
        amount: 5000,
        dueDate: new Date("2026-05-10T00:00:00Z"),
        shareToken: "invoice-anaya-may",
      },
    });
    const response = await request(app).post("/api/pay/verify").send({
      token: "invoice-anaya-may",
      razorpay_order_id: "order_test",
      razorpay_payment_id: "pay_test",
      razorpay_signature: "deadbeef",
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/signature/i);
    expect(await prisma.payment.count({ where: { invoiceId: "invoice-anaya-may" } })).toBe(0);
  });

  it("settles a verified Razorpay payment once and ignores a duplicate", async () => {
    razorpayMock.fetchPayment.mockResolvedValue({
      id: "pay_ok_1",
      status: "captured",
      amount: 500000,
      currency: "INR",
      order_id: "order_ok_1",
      notes: { invoiceId: "invoice-anaya-may", token: "invoice-anaya-may" },
    });
    const signature = sign("order_ok_1", "pay_ok_1", "school-secret");
    const first = await request(app).post("/api/pay/verify").send({
      token: "invoice-anaya-may",
      razorpay_order_id: "order_ok_1",
      razorpay_payment_id: "pay_ok_1",
      razorpay_signature: signature,
    });
    expect(first.status).toBe(200);
    const second = await request(app).post("/api/pay/verify").send({
      token: "invoice-anaya-may",
      razorpay_order_id: "order_ok_1",
      razorpay_payment_id: "pay_ok_1",
      razorpay_signature: signature,
    });
    expect(second.status).toBe(200);
    expect(await prisma.payment.count({ where: { invoiceId: "invoice-anaya-may", method: "RAZORPAY" } })).toBe(1);
    const invoice = await prisma.feeInvoice.findUniqueOrThrow({
      where: { id: "invoice-anaya-may" },
      include: { payments: true },
    });
    expect(invoiceBalance(invoice).dueNow).toBe(0);
  });

  it("rejects a webhook with a bad signature", async () => {
    await prisma.schoolConfig.update({
      where: { id: "school" },
      data: { razorpayWebhookSecret: "whsec_test" },
    });
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_wh" } } } });
    const response = await request(app)
      .post("/api/pay/webhook?provider=razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", "nope")
      .send(body);
    expect(response.status).toBe(400);
  });

  it("ignores payment.failed webhooks", async () => {
    const body = JSON.stringify({
      event: "payment.failed",
      payload: {
        payment: {
          entity: { id: "pay_fail", notes: { invoiceId: "invoice-anaya-may", token: "invoice-anaya-may" } },
        },
      },
    });
    const signature = crypto.createHmac("sha256", "whsec_test").update(body).digest("hex");
    const count = await prisma.payment.count({ where: { invoiceId: "invoice-anaya-may" } });
    const response = await request(app)
      .post("/api/pay/webhook?provider=razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signature)
      .send(body);
    expect(response.status).toBe(200);
    expect(await prisma.payment.count({ where: { invoiceId: "invoice-anaya-may" } })).toBe(count);
  });

  it("does not let a parent open another family's pay token", async () => {
    const response = await act(parentToken, "ensurePayToken", { invoiceId: "missing-other-family" });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("loads the office fees record after roll-number backfill", async () => {
    const response = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${officeToken}` });
    expect(response.status).toBe(200);
    expect(response.body.school?.sessionStart).toBeTruthy();
    expect(response.body.school?.admissionCharge).toBeTypeOf("number");
  });

  it("saves academic session, one-time admission fee, and class due/fine onto new invoices", async () => {
    const session = await act(officeToken, "saveFeeAcademicSession", {
      label: "2026 - 2027",
      startsOn: "2026-04-01",
      endsOn: "2027-03-31",
      dueDay: 10,
    });
    expect(session.status).toBe(200);
    expect(session.body.label).toBe("2026 - 2027");
    expect(session.body.dueDay).toBe(10);

    const admission = await act(officeToken, "saveAdmissionFeeSetup", { amount: 5000 });
    expect(admission.status).toBe(200);
    expect(admission.body.amount).toBe(5000);
    const config = await prisma.schoolConfig.findUniqueOrThrow({ where: { id: "school" } });
    expect(config.admissionCharge).toBe(5000);
    expect(config.sessionStart).toBe("2026-04-01");
    expect(config.sessionEnd).toBe("2027-03-31");

    await prisma.studentClassEnrollment.upsert({
      where: { studentId_sessionId: { studentId: fixture.studentId, sessionId: "session-2026" } },
      create: {
        studentId: fixture.studentId,
        classId: fixture.classId,
        sessionId: "session-2026",
        rollNumber: 1,
      },
      update: { classId: fixture.classId, active: true },
    });

    const saved = await act(officeToken, "saveFeeTemplate", {
      classId: fixture.classId,
      sessionId: "session-2026",
      name: "Monthly fee",
      startsPeriod: "2026-06",
      endsPeriod: "2026-06",
      dueDay: 10,
      lateKind: "STATIC",
      lateGraceDays: 0,
      lateAmount: 50,
      lines: [{ label: "Tuition", kind: "FLAT", amount: 3000, scope: "ALL" }],
    });
    expect(saved.status).toBe(200);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-02T06:30:00.000Z"));
    const issued = await act(officeToken, "issueClassFees", {
      classId: fixture.classId,
      templateId: saved.body.id,
    });
    vi.useRealTimers();
    expect(issued.status).toBe(200);

    const june = await prisma.feeInvoice.findFirstOrThrow({
      where: { studentId: fixture.studentId, period: "2026-06" },
    });
    expect(june.amount).toBe(3000);
    expect(june.dueDate.getFullYear()).toBe(2026);
    expect(june.dueDate.getMonth()).toBe(5);
    expect(june.dueDate.getDate()).toBe(10);
    expect(invoiceLatePolicy(june)).toMatchObject({ lateKind: "STATIC", lateAmount: 50, lateGraceDays: 0 });

    const existingApril = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: "invoice-anaya-april" } });
    expect(existingApril.amount).toBe(250000);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 18, 0, 0));
    expect(invoiceBalance(june).late).toBe(0);
    vi.setSystemTime(new Date(2026, 5, 11, 10, 0, 0));
    expect(invoiceBalance(june).late).toBe(50);
    vi.useRealTimers();
  });

  it("settles a parent Razorpay checkout that covers more than one child", async () => {
    await prisma.schoolConfig.update({
      where: { id: "school" },
      data: { payGateway: "RAZORPAY", razorpayKeyId: "rzp_test_ok", razorpayKeySecret: "school-secret" },
    });
    await prisma.student.create({
      data: {
        id: "student-arjun-fix",
        parentId: "parent-pari",
        classId: fixture.classId,
        admissionNo: "ADM-FIX-2",
        name: "Arjun Fixture",
        dateOfBirth: new Date("2013-05-10T00:00:00.000Z"),
      },
    });
    await prisma.feeInvoice.create({
      data: {
        id: "invoice-arjun-aug",
        studentId: "student-arjun-fix",
        classId: fixture.classId,
        period: "2026-08",
        title: "August 2026 · Monthly fee",
        amount: 8600,
        dueDate: new Date("2026-08-10T00:00:00Z"),
        metadataJson: JSON.stringify({ late: { lateKind: "STATIC", lateAmount: 100, lateGraceDays: 0 } }),
        shareToken: "invoice-arjun-aug",
      },
    });
    const siblingDue = invoiceBalance({
      amount: 8600,
      dueDate: new Date("2026-08-10T00:00:00Z"),
      lateKind: "STATIC",
      lateAmount: 100,
      lateGraceDays: 0,
    }).dueNow;
    const anayaDue = invoiceBalance(await prisma.feeInvoice.findUniqueOrThrow({
      where: { id: "invoice-anaya-april" },
      include: { payments: true },
    })).dueNow;
    const total = anayaDue + siblingDue;
    razorpayMock.createOrder.mockClear();
    razorpayMock.fetchPayment.mockResolvedValue({
      id: "pay_family_1",
      status: "captured",
      amount: total * 100,
      currency: "INR",
      order_id: "order_family_1",
      notes: {
        studentToken: "pay-anaya-fixture",
        invoiceIds: "invoice-anaya-april,invoice-arjun-aug",
      },
    });
    const order = await request(app).post("/api/pay/order").send({
      studentToken: "pay-anaya-fixture",
      invoiceIds: ["invoice-anaya-april", "invoice-arjun-aug"],
    });
    expect(order.status).toBe(200);
    expect(order.body.amount).toBe(total);
    const signature = sign("order_family_1", "pay_family_1", "school-secret");
    const verified = await request(app).post("/api/pay/verify").send({
      studentToken: "pay-anaya-fixture",
      invoiceIds: ["invoice-anaya-april", "invoice-arjun-aug"],
      razorpay_order_id: "order_family_1",
      razorpay_payment_id: "pay_family_1",
      razorpay_signature: signature,
    });
    expect(verified.status).toBe(200);
    expect(verified.body.error).toBeUndefined();
    expect(
      invoiceBalance(
        await prisma.feeInvoice.findUniqueOrThrow({ where: { id: "invoice-anaya-april" }, include: { payments: true } })
      ).dueNow
    ).toBe(0);
    expect(
      invoiceBalance(
        await prisma.feeInvoice.findUniqueOrThrow({ where: { id: "invoice-arjun-aug" }, include: { payments: true } })
      ).dueNow
    ).toBe(0);
  });
});
