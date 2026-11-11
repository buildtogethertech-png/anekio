import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";
import { invoiceBalance } from "../../lib/fees";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fixture: PortalFixture;
let officeToken = "";
let formatReceiptNo: typeof import("../../lib/fee-ledger").formatReceiptNo;
let receiptYear: typeof import("../../lib/fee-ledger").receiptYear;

async function act(op: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/v1/act")
    .set({ Authorization: `Bearer ${officeToken}` })
    .send({ op, ...body });
}

async function dueOf(id: string) {
  const inv = await prisma.feeInvoice.findUniqueOrThrow({ where: { id }, include: { payments: true } });
  return { dueNow: invoiceBalance({ ...inv, status: undefined }).dueNow, status: inv.status, paid: inv.payments.reduce((n, p) => n + p.amount, 0) };
}

/** Three open invoices for the fixture student, no late fee, due in the future. */
async function freshInvoices() {
  await prisma.payment.deleteMany({});
  await prisma.feeReceipt.deleteMany({});
  await prisma.feeReceiptCounter.deleteMany({});
  await prisma.feeInvoice.deleteMany({ where: { studentId: fixture.studentId } });
  const rows = [
    { id: "inv-backlog", period: "OPENING", title: "Backlog invoice", amount: 8000, dueDate: new Date("2030-01-05T00:00:00Z") },
    { id: "inv-oct", period: "2030-10", title: "October fee", amount: 1800, dueDate: new Date("2030-10-10T00:00:00Z") },
    { id: "inv-nov", period: "2030-11", title: "November fee", amount: 1800, dueDate: new Date("2030-11-10T00:00:00Z") },
  ];
  for (const row of rows) {
    await prisma.feeInvoice.create({
      data: { ...row, studentId: fixture.studentId, classId: fixture.classId, shareToken: `tok-${row.id}` },
    });
  }
}

describe.sequential("fee receipts", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "fee-receipts-test-secret-with-enough-entropy";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    ({ formatReceiptNo, receiptYear } = await import("../../lib/fee-ledger"));
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
    officeToken = (await request(app).post("/api/v1/login").send({ login: fixture.users.office.email, password: fixture.password })).body.token;
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  beforeEach(freshInvoices);

  it("numbers receipts in order per financial year", () => {
    expect(receiptYear(new Date("2026-04-01T10:00:00"))).toBe("26-27");
    expect(receiptYear(new Date("2027-03-31T10:00:00"))).toBe("26-27");
    expect(formatReceiptNo("26-27", 42)).toBe("RCPT/26-27/00042");
  });

  it("gives each part payment on one invoice its own receipt", async () => {
    const first = await act("collectFee", { invoiceId: "inv-oct", amount: 1000, method: "CASH" });
    expect(first.status).toBe(200);
    expect(await dueOf("inv-oct")).toMatchObject({ dueNow: 800, status: "PARTIAL" });

    const second = await act("collectFee", { invoiceId: "inv-oct", amount: 800, method: "UPI", reference: "UTR-OCT-2" });
    expect(second.status).toBe(200);
    expect(await dueOf("inv-oct")).toMatchObject({ dueNow: 0, status: "PAID" });

    const receipts = await prisma.feeReceipt.findMany({ orderBy: { createdAt: "asc" }, include: { allocations: true } });
    expect(receipts.map((r) => r.amount)).toEqual([1000, 800]);
    expect(receipts.map((r) => r.allocations.map((a) => [a.invoiceId, a.amount]))).toEqual([[["inv-oct", 1000]], [["inv-oct", 800]]]);
    const year = receiptYear(new Date());
    expect(receipts.map((r) => r.receiptNo)).toEqual([formatReceiptNo(year, 1), formatReceiptNo(year, 2)]);
    expect(first.body.receiptNo).toBe(formatReceiptNo(year, 1));
  });

  it("spreads one amount over months, oldest first, the last part paid", async () => {
    const res = await act("collectPartialFees", {
      studentId: fixture.studentId,
      invoiceIds: ["inv-nov", "inv-oct", "inv-backlog"],
      amount: 10000,
      method: "UPI",
      reference: "UTR-10K",
    });
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(10000);
    expect(await dueOf("inv-backlog")).toMatchObject({ dueNow: 0, status: "PAID" });
    expect(await dueOf("inv-oct")).toMatchObject({ dueNow: 0, status: "PAID" });
    expect(await dueOf("inv-nov")).toMatchObject({ dueNow: 1600, status: "PARTIAL" });

    const receipt = await prisma.feeReceipt.findUniqueOrThrow({ where: { id: res.body.receiptId }, include: { allocations: true } });
    expect(receipt.allocations.map((a) => [a.invoiceId, a.amount]).sort()).toEqual([["inv-backlog", 8000], ["inv-nov", 200], ["inv-oct", 1800]]);

    const invoicePage = await request(app).get("/i/tok-inv-nov");
    expect(invoicePage.status).toBe(200);
    expect(invoicePage.text).toContain(res.body.receiptNo);
    expect(invoicePage.text).toMatch(/₹200.*of ₹10,000/);

    const pdf = await request(app).get(`/pay/r/${res.body.receiptToken}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect((await request(app).get("/pay/r/not-a-receipt")).status).toBe(404);
  });

  it("collects the ticked months in full when no amount is given", async () => {
    const res = await act("collectPartialFees", { studentId: fixture.studentId, invoiceIds: ["inv-oct", "inv-nov"], method: "CASH" });
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(3600);
    expect(await dueOf("inv-backlog")).toMatchObject({ dueNow: 8000 });
  });

  it("refuses more than is due and a UTR already used", async () => {
    const tooMuch = await act("collectPartialFees", { studentId: fixture.studentId, invoiceIds: ["inv-oct"], amount: 5000, method: "CASH" });
    expect(tooMuch.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(tooMuch.body)).toContain("more than what is due");

    const ok = await act("collectPartialFees", { studentId: fixture.studentId, invoiceIds: ["inv-oct"], amount: 500, method: "UPI", reference: "UTR-SAME" });
    expect(ok.status).toBe(200);
    const again = await act("collectPartialFees", { studentId: fixture.studentId, invoiceIds: ["inv-oct"], amount: 500, method: "UPI", reference: "UTR-SAME" });
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(again.body)).toContain(ok.body.receiptNo);
    expect(await prisma.feeReceipt.count()).toBe(1);
  });

  it("cancels a receipt: money comes off, the number stays", async () => {
    const res = await act("collectPartialFees", {
      studentId: fixture.studentId,
      invoiceIds: ["inv-backlog", "inv-oct"],
      amount: 9000,
      method: "CASH",
    });
    expect(await dueOf("inv-oct")).toMatchObject({ dueNow: 800, status: "PARTIAL" });

    const noReason = await act("cancelFeeReceipt", { receiptId: res.body.receiptId });
    expect(noReason.status).toBeGreaterThanOrEqual(400);

    const cancelled = await act("cancelFeeReceipt", { receiptId: res.body.receiptId, reason: "Entered twice" });
    expect(cancelled.status).toBe(200);
    expect(await dueOf("inv-backlog")).toMatchObject({ dueNow: 8000, status: "DUE" });
    expect(await dueOf("inv-oct")).toMatchObject({ dueNow: 1800, status: "DUE" });
    const receipt = await prisma.feeReceipt.findUniqueOrThrow({ where: { id: res.body.receiptId } });
    expect(receipt).toMatchObject({ status: "CANCELLED", receiptNo: res.body.receiptNo });
    expect(receipt.cancelReason).toContain("Entered twice");

    const twice = await act("cancelFeeReceipt", { receiptId: res.body.receiptId, reason: "again" });
    expect(twice.status).toBeGreaterThanOrEqual(400);

    const next = await act("collectFee", { invoiceId: "inv-oct", method: "CASH" });
    expect(next.body.receiptNo).toBe(formatReceiptNo(receiptYear(new Date()), 2));
    expect((await request(app).get(`/pay/r/${receipt.shareToken}`)).status).toBe(200);
  });

  it("shows receipt numbers with each payment in the office record", async () => {
    const res = await act("collectPartialFees", { studentId: fixture.studentId, invoiceIds: ["inv-backlog", "inv-oct"], amount: 8500, method: "CASH" });
    const record = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${officeToken}` });
    expect(record.status).toBe(200);
    const person = (record.body.people as { id: string; invoices: { id: string; dueAt: string; payments: { receiptNo: string; receiptUrl: string; amountValue: number; receiptTotal: number }[] }[] }[]).find(
      (p) => p.id === fixture.studentId
    );
    const oct = person?.invoices.find((inv) => inv.id === "inv-oct");
    expect(oct?.dueAt).toBe("2030-10-10T00:00:00.000Z");
    expect(oct?.payments).toEqual([
      expect.objectContaining({ receiptNo: res.body.receiptNo, amountValue: 500, receiptTotal: 8500, receiptUrl: expect.stringContaining(`/pay/r/${res.body.receiptToken}`) }),
    ]);
  });
  it("gives old payments a receipt, grouping one collection into one receipt", async () => {
    const at = new Date("2026-05-02T10:00:00Z");
    await prisma.payment.createMany({
      data: [
        { invoiceId: "inv-backlog", amount: 8000, method: "UPI", reference: "RCPT-AB12CD34:backlog", paidAt: at },
        { invoiceId: "inv-oct", amount: 1800, method: "UPI", reference: "RCPT-AB12CD34:oct", paidAt: at },
        { invoiceId: "inv-nov", amount: 500, method: "CASH", reference: null, notes: "Full payment", paidAt: new Date("2026-06-01T10:00:00Z") },
      ],
    });
    const { backfillLegacyReceipts } = await import("../../lib/fee-ledger");
    expect(await backfillLegacyReceipts({ dryRun: true })).toEqual({ payments: 3, receipts: 2, amount: 10300 });
    await backfillLegacyReceipts();
    const receipts = await prisma.feeReceipt.findMany({ orderBy: { paidAt: "asc" }, include: { allocations: true } });
    expect(receipts.map((r) => [r.receiptNo, r.amount, r.allocations.length])).toEqual([
      ["RCPT/26-27/00001", 9800, 2],
      ["RCPT/26-27/00002", 500, 1],
    ]);
    expect(receipts[0].notes).toContain("Old receipt no. RCPT-AB12CD34");
    expect(await backfillLegacyReceipts()).toMatchObject({ payments: 0, receipts: 0 });
  });
});
