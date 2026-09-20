import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";
import { invoiceBalance } from "../../lib/fees";

const razorpayMock = vi.hoisted(() => ({
  createOrder: vi.fn(async (input: { amount: number }) => ({ id: "order_test", amount: input.amount, currency: "INR" })),
  fetchPayment: vi.fn(async () => ({
    id: "pay_test",
    status: "captured",
    amount: 25000000,
    currency: "INR",
    order_id: "order_test",
    notes: { invoiceId: "invoice-anaya-april", token: "invoice-anaya-april" },
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
});
