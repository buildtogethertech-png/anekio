import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { invoiceBalance } from "../../lib/fees";
import type { AccessUser } from "../../lib/permissions";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fixture: PortalFixture;
let officeUser: AccessUser;
let officeToken = "";
let parentToken = "";
let previewOnboardingRows: typeof import("../../lib/onboarding").previewOnboardingRows;
let applyOnboardingImport: typeof import("../../lib/onboarding").applyOnboardingImport;
let onboardingBundle: typeof import("../../lib/onboarding").onboardingBundle;
let rowsFromCsvContent: typeof import("../../lib/onboarding").rowsFromCsvContent;
let issueClassFeesCore: typeof import("../../lib/core-office").issueClassFeesCore;
let collectFeeCore: typeof import("../../lib/core-actions").collectFeeCore;
let issueDueFeesCore: typeof import("../../lib/fee-run").issueDueFeesCore;
let issueFeeReceiptCore: typeof import("../../lib/fee-register").issueFeeReceiptCore;
let queryFeeRegister: typeof import("../../lib/fee-register").queryFeeRegister;

type OpeningRow = Record<string, string> & { _row: string };

function openingRow(overrides: Partial<OpeningRow> = {}): OpeningRow {
  return {
    _row: "2",
    admissionnumber: "TEST-OPENING-001",
    studentname: "Opening Child",
    class: "6-A",
    backloginvoiceamount: "12345",
    invoicedate: "2026-09-01",
    duedate: "2026-09-10",
    invoicesalreadygeneratedtill: "2026-08",
    exampleonly: "",
    ...overrides,
  };
}

async function login(email: string) {
  return request(app).post("/api/v1/login").send({ login: email, password: fixture.password });
}

async function preview(rows: OpeningRow[]) {
  return previewOnboardingRows(officeUser, {
    kind: "opening_balances",
    fileName: "anekio-first-time-fees.csv",
    uploadPath: "private/schools/test/onboarding/imports/opening.csv",
    rows,
  });
}

async function createOpeningStudent(input: {
  id: string;
  admissionNo: string;
  joinedAt?: string;
  feeGeneratedThrough?: string;
  parentId?: string;
}) {
  const student = await prisma.student.create({
    data: {
      id: input.id,
      parentId: input.parentId || "parent-pari",
      classId: fixture.classId,
      orgId: officeUser.orgId ?? null,
      admissionNo: input.admissionNo,
      name: input.id,
      dateOfBirth: new Date("2015-01-01T00:00:00Z"),
      ...(input.feeGeneratedThrough ? { feeGeneratedThrough: input.feeGeneratedThrough } : {}),
    },
  });
  const latest = await prisma.studentClassEnrollment.findFirst({
    where: { classId: fixture.classId, sessionId: "session-2026" },
    orderBy: { rollNumber: "desc" },
    select: { rollNumber: true },
  });
  await prisma.studentClassEnrollment.create({
    data: {
      studentId: student.id,
      classId: fixture.classId,
      sessionId: "session-2026",
      rollNumber: (latest?.rollNumber || 0) + 1,
      joinedAt: new Date(input.joinedAt || "2026-04-01T00:00:00.000Z"),
      active: true,
    },
  });
  return student;
}

async function ensureFeeDocument(type: "FEE_INVOICE" | "PAYMENT_RECEIPT") {
  const existing = await prisma.documentTemplate.findFirst({
    where: { orgId: officeUser.orgId, type },
  });
  if (existing) {
    await prisma.documentTemplate.update({ where: { id: existing.id }, data: { status: "ACTIVE" } });
    return existing;
  }
  return prisma.documentTemplate.create({
    data: {
      orgId: officeUser.orgId,
      schoolId: "school",
      type,
      category: "FEES",
      name: type === "FEE_INVOICE" ? "Fee invoice" : "Payment receipt",
      status: "ACTIVE",
      activeVersion: 1,
      createdById: officeUser.id,
      updatedById: officeUser.id,
      versions: {
        create: {
          schoolId: "school",
          version: 1,
          layoutJson: JSON.stringify({ elements: [] }),
          pageSize: "A4",
          orientation: "PORTRAIT",
          publishedById: officeUser.id,
        },
      },
    },
  });
}

async function setFeeDocumentStatus(type: "FEE_INVOICE" | "PAYMENT_RECEIPT", status: "ACTIVE" | "DRAFT") {
  await prisma.documentTemplate.updateMany({ where: { orgId: officeUser.orgId, type }, data: { status } });
}

async function snapshotOpeningMoney(studentId: string) {
  const invoices = await prisma.feeInvoice.findMany({
    where: { studentId, period: "OPENING" },
    include: { payments: true },
  });
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { feeGeneratedThrough: true } });
  return {
    invoices: invoices.map((row) => ({ id: row.id, amount: row.amount, generatedThrough: row.generatedThrough, payments: row.payments.length })),
    feeGeneratedThrough: student?.feeGeneratedThrough,
    payments: await prisma.payment.count(),
    receipts: await prisma.issuedDocument.count(),
  };
}

describe.sequential("first-time fees opening balances", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "opening-balances-test-secret-with-enough-entropy";
    process.env.CRON_SECRET = "opening-cron-secret";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    const org = await prisma.saasOrg.create({
      data: {
        id: "org-opening-fixture",
        schoolName: "Opening Academy",
        ownerName: "Ojas Office",
        ownerEmail: "office.fixture@school.test",
        ownerPhone: "9876540001",
      },
    });
    await prisma.user.update({ where: { id: fixture.users.office.id }, data: { orgId: org.id } });
    const office = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.users.office.id },
      include: { role: { include: { grants: true } } },
    });
    officeUser = {
      id: office.id,
      name: office.name,
      email: office.email,
      role: office.role.slug,
      roleName: office.role.name,
      roleId: office.roleId,
      orgId: org.id,
      portal: "OFFICE",
      permissions: office.role.grants.map((grant) => grant.permission),
      scopes: Object.fromEntries(office.role.grants.map((grant) => [grant.permission, grant.scope || "SCHOOL"])) as AccessUser["scopes"],
      isSystemRole: true,
    };
    ({ previewOnboardingRows, applyOnboardingImport, onboardingBundle, rowsFromCsvContent } = await import("../../lib/onboarding"));
    ({ issueClassFeesCore } = await import("../../lib/core-office"));
    ({ collectFeeCore } = await import("../../lib/core-actions"));
    ({ issueDueFeesCore } = await import("../../lib/fee-run"));
    ({ issueFeeReceiptCore, queryFeeRegister } = await import("../../lib/fee-register"));
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
    parentToken = (await login(fixture.users.parent.email)).body.token;
  }, 120_000);

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("blocks the opening-balance template when the school has no students", async () => {
    await prisma.payment.deleteMany();
    await prisma.feeInvoice.deleteMany();
    await prisma.attendance.deleteMany();
    await prisma.studentClassEnrollment.deleteMany();
    await prisma.studentInterest.deleteMany();
    await prisma.student.deleteMany();
    const bundle = await onboardingBundle(officeUser);
    expect(bundle.templates.find((row) => row.kind === "opening_balances")).toMatchObject({
      disabled: true,
      prerequisite: "Students",
    });
    expect(bundle.steps.find((row) => row.key === "opening_balances")?.status).toBe("blocked");
    await expect(preview([openingRow()])).resolves.toMatchObject({
      errors: expect.arrayContaining([expect.stringMatching(/admission number was not found/i)]),
    });
    expect(await prisma.feeInvoice.count({ where: { period: "OPENING" } })).toBe(0);
  });

  it("rejects first-time fee import until fee invoice and receipt templates are published", async () => {
    await createOpeningStudent({ id: "student-opening-001", admissionNo: "TEST-OPENING-001" });
    const unpublished = await onboardingBundle(officeUser);
    expect(unpublished.templates.find((row) => row.kind === "opening_balances")).toMatchObject({
      disabled: true,
      prerequisite: "Fee invoice and payment receipt templates",
    });
    expect(unpublished.steps.find((row) => row.key === "opening_balances")?.status).toBe("blocked");
    expect(unpublished.steps.find((row) => row.key === "fee_invoice_document")?.status).toBe("blocked");
    expect(unpublished.steps.find((row) => row.key === "payment_receipt_document")?.status).toBe("blocked");
    const bothMissing = await preview([openingRow()]);
    expect(bothMissing.errors.join("\n")).toMatch(/fee invoice template/i);
    expect(bothMissing.errors.join("\n")).toMatch(/payment receipt template/i);
    await expect(applyOnboardingImport(officeUser, { batchId: bothMissing.batchId })).rejects.toThrow(/fix the review errors/i);
    expect(await snapshotOpeningMoney("student-opening-001")).toMatchObject({
      invoices: [],
      feeGeneratedThrough: "",
      payments: 0,
      receipts: 0,
    });

    await ensureFeeDocument("FEE_INVOICE");
    const invoiceOnly = await preview([openingRow()]);
    expect(invoiceOnly.errors.join("\n")).toMatch(/payment receipt template/i);
    expect(invoiceOnly.errors.join("\n")).not.toMatch(/fee invoice template/i);

    await setFeeDocumentStatus("FEE_INVOICE", "DRAFT");
    await ensureFeeDocument("PAYMENT_RECEIPT");
    const receiptOnly = await preview([openingRow()]);
    expect(receiptOnly.errors.join("\n")).toMatch(/fee invoice template/i);
    expect(receiptOnly.errors.join("\n")).not.toMatch(/payment receipt template/i);

    await setFeeDocumentStatus("PAYMENT_RECEIPT", "DRAFT");
    const stillBoth = await preview([openingRow()]);
    expect(stillBoth.errors.join("\n")).toMatch(/fee invoice template/i);
    expect(stillBoth.errors.join("\n")).toMatch(/payment receipt template/i);
    expect(await prisma.feeInvoice.count({ where: { period: "OPENING" } })).toBe(0);

    await ensureFeeDocument("FEE_INVOICE");
    await ensureFeeDocument("PAYMENT_RECEIPT");
    const published = await onboardingBundle(officeUser);
    expect(published.templates.find((row) => row.kind === "opening_balances")?.disabled).toBe(false);
    const ready = await preview([openingRow()]);
    expect(ready.errors).toEqual([]);
    expect(ready.validCount).toBe(1);
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.issuedDocument.count()).toBe(0);
  });

  it("validates first-time-fees rows without creating invoices", async () => {
    const cases: { name: string; row: OpeningRow; match: RegExp | null }[] = [
      { name: "valid", row: openingRow(), match: null },
      { name: "unknown admission", row: openingRow({ admissionnumber: "MISSING-001" }), match: /not found/i },
      { name: "missing admission", row: openingRow({ admissionnumber: "" }), match: /not found/i },
      { name: "negative", row: openingRow({ backloginvoiceamount: "-100" }), match: /zero or more|whole number of rupees/i },
      { name: "invalid due date", row: openingRow({ duedate: "2026-99-99" }), match: /due date must be YYYY-MM-DD/i },
      { name: "missing due date", row: openingRow({ duedate: "" }), match: /due date must be YYYY-MM-DD/i },
      { name: "invalid cutoff", row: openingRow({ invoicesalreadygeneratedtill: "2026-99" }), match: /YYYY-MM/i },
      { name: "missing cutoff", row: openingRow({ invoicesalreadygeneratedtill: "" }), match: /YYYY-MM/i },
      { name: "malformed month", row: openingRow({ invoicesalreadygeneratedtill: "2026-13" }), match: /YYYY-MM/i },
      { name: "invalid format", row: openingRow({ invoicesalreadygeneratedtill: "August 2026" }), match: /YYYY-MM/i },
      { name: "exact case", row: openingRow({ admissionnumber: "TEST-OPENING-001" }), match: null },
      { name: "lowercase", row: openingRow({ admissionnumber: "test-opening-001" }), match: null },
      { name: "uppercase", row: openingRow({ admissionnumber: "TEST-OPENING-001" }), match: null },
      { name: "whitespace admission", row: openingRow({ admissionnumber: "  TEST-OPENING-001  " }), match: null },
    ];
    for (const row of cases) {
      const result = await preview([row.row]);
      if (row.match) expect(result.errors.join("\n"), row.name).toMatch(row.match);
      else expect(result.errors, row.name).toEqual([]);
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
    expect((await preview([openingRow({ invoicesalreadygeneratedtill: "2026-10" })])).errors).toEqual([]);
    expect((await preview([openingRow({ invoicesalreadygeneratedtill: "2025-03" })])).errors.join("\n")).toMatch(/current session/i);
    expect((await preview([openingRow({ invoicesalreadygeneratedtill: "2027-02" })])).errors.join("\n")).toMatch(/current month/i);
    vi.useRealTimers();
    const extra = await preview([{ ...openingRow(), mysterycolumn: "ignored" }]);
    expect(extra.errors).toEqual([]);
    const blank = await preview([openingRow({ admissionnumber: "", backloginvoiceamount: "", duedate: "", invoicesalreadygeneratedtill: "", studentname: "" })]);
    expect(blank.errors.length).toBeGreaterThan(0);
    expect(await prisma.feeInvoice.count({ where: { period: "OPENING" } })).toBe(0);
  });

  it("rejects blank backlog amounts while accepting a true zero", async () => {
    const before = await snapshotOpeningMoney("student-opening-001");
    for (const [name, row] of [
      ["empty", openingRow({ backloginvoiceamount: "" })],
      ["whitespace", openingRow({ backloginvoiceamount: "   " })],
      ["missing", (() => {
        const next = openingRow();
        delete next.backloginvoiceamount;
        return next;
      })()],
    ] as const) {
      const previewed = await preview([row]);
      expect(previewed.errors.join("\n"), name).toMatch(/backlog invoice amount is required/i);
      await expect(applyOnboardingImport(officeUser, { batchId: previewed.batchId })).rejects.toThrow(/fix the review errors/i);
    }
    expect((await preview([openingRow({ backloginvoiceamount: "0" })])).errors).toEqual([]);
    expect(await snapshotOpeningMoney("student-opening-001")).toEqual(before);
  });

  it("rejects decimal backlog amounts instead of rounding", async () => {
    const before = await snapshotOpeningMoney("student-opening-001");
    const previewed = await preview([openingRow({ backloginvoiceamount: "12345.50" })]);
    expect(previewed.errors.join("\n")).toMatch(/whole number of rupees/i);
    await expect(applyOnboardingImport(officeUser, { batchId: previewed.batchId })).rejects.toThrow(/fix the review errors/i);
    expect(await snapshotOpeningMoney("student-opening-001")).toEqual(before);
  });

  it("rejects duplicate admission numbers in the same import file", async () => {
    const before = await snapshotOpeningMoney("student-opening-001");
    const rows = rowsFromCsvContent(`Admission number,Student name,Class,Backlog invoice amount,Invoice date,Due date,Invoices already generated till,Example only
,Aarav Sharma (example),6-A,2500,2026-09-01,2026-09-10,2026-08,YES
TEST-OPENING-001,Opening Child,6-A,12345,2026-09-01,2026-09-10,2026-08,
TEST-OPENING-001,Opening Child,6-A,5000,2026-09-01,2026-09-10,2026-08,
`);
    expect(rows).toHaveLength(2);
    const exact = await preview(rows);
    expect(exact.errors.join("\n")).toMatch(/Duplicate admission number in import file/i);
    await expect(applyOnboardingImport(officeUser, { batchId: exact.batchId })).rejects.toThrow(/fix the review errors/i);

    const mixedCase = await preview([
      openingRow({ _row: "2", admissionnumber: "TEST-OPENING-001", backloginvoiceamount: "12345" }),
      openingRow({ _row: "3", admissionnumber: "test-opening-001", backloginvoiceamount: "5000" }),
    ]);
    expect(mixedCase.errors.join("\n")).toMatch(/Duplicate admission number in import file/i);

    const spaced = await preview([
      openingRow({ _row: "2", admissionnumber: "TEST-OPENING-001", backloginvoiceamount: "12345" }),
      openingRow({ _row: "3", admissionnumber: "  TEST-OPENING-001  ", backloginvoiceamount: "5000" }),
    ]);
    expect(spaced.errors.join("\n")).toMatch(/Duplicate admission number in import file/i);
    expect(await snapshotOpeningMoney("student-opening-001")).toEqual(before);
  });

  it("applies a valid opening row as one backlog invoice with cutoff and no payment or receipt", async () => {
    const previewed = await preview([openingRow()]);
    expect(previewed.sample[0]).toMatchObject({
      admissionnumber: "TEST-OPENING-001",
      backloginvoiceamount: "12345",
      duedate: "2026-09-10",
      invoicesalreadygeneratedtill: "2026-08",
    });
    const applied = await applyOnboardingImport(officeUser, { batchId: previewed.batchId });
    expect(applied.created).toBe(1);
    await expect(applyOnboardingImport(officeUser, { batchId: previewed.batchId })).rejects.toThrow(/already applied/i);
    const opening = await prisma.feeInvoice.findUniqueOrThrow({
      where: { studentId_period: { studentId: "student-opening-001", period: "OPENING" } },
      include: { payments: true },
    });
    expect(opening).toMatchObject({
      kind: "OPENING",
      title: "Backlog invoice",
      amount: 12345,
      generatedThrough: "2026-08",
      status: "DUE",
    });
    expect(opening.payments).toHaveLength(0);
    expect(await prisma.issuedDocument.count()).toBe(0);
    expect(await prisma.feeInvoice.count({ where: { studentId: "student-opening-001", period: { startsWith: "2026-" } } })).toBe(0);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: "student-opening-001" } })).feeGeneratedThrough).toBe("2026-08");
  });

  it("applies lowercase and uppercase admission numbers the same way as preview", async () => {
    for (const admission of ["TEST-OPENING-001", "test-opening-001", "TEST-OPENING-001", "  test-opening-001  "]) {
      const previewed = await preview([openingRow({ admissionnumber: admission })]);
      expect(previewed.errors, admission).toEqual([]);
      await applyOnboardingImport(officeUser, { batchId: previewed.batchId });
    }
    expect(await prisma.feeInvoice.count({ where: { studentId: "student-opening-001", period: "OPENING" } })).toBe(1);
    const missing = await preview([openingRow({ admissionnumber: "NO-SUCH-STUDENT" })]);
    expect(missing.errors.join("\n")).toMatch(/not found/i);
    await expect(applyOnboardingImport(officeUser, { batchId: missing.batchId })).rejects.toThrow(/fix the review errors/i);
  });

  it("does not let re-import erase collected money, and never decreases feeGeneratedThrough", async () => {
    const opening = await prisma.feeInvoice.findUniqueOrThrow({
      where: { studentId_period: { studentId: "student-opening-001", period: "OPENING" } },
    });
    await collectFeeCore(officeUser, { invoiceId: opening.id, amount: 5000, method: "CASH" });
    await expect(applyOnboardingImport(officeUser, { batchId: (await preview([openingRow({ backloginvoiceamount: "4000" })])).batchId })).rejects.toThrow(/cannot be below ₹5000/i);
    await applyOnboardingImport(officeUser, { batchId: (await preview([openingRow({ backloginvoiceamount: "7345" })])).batchId });
    expect((await prisma.feeInvoice.findUniqueOrThrow({ where: { id: opening.id }, include: { payments: true } })).amount).toBe(7345);
    expect((await prisma.payment.aggregate({ where: { invoiceId: opening.id }, _sum: { amount: true } }))._sum.amount).toBe(5000);
    await applyOnboardingImport(officeUser, { batchId: (await preview([openingRow({ invoicesalreadygeneratedtill: "2026-05" })])).batchId });
    expect((await prisma.student.findUniqueOrThrow({ where: { id: "student-opening-001" } })).feeGeneratedThrough).toBe("2026-08");
    await applyOnboardingImport(officeUser, { batchId: (await preview([openingRow()])).batchId });
  });

  it("collects the remaining opening balance by cash, issues one receipt, and keeps late on dueNow", async () => {
    const opening = await prisma.feeInvoice.findUniqueOrThrow({
      where: { studentId_period: { studentId: "student-opening-001", period: "OPENING" } },
      include: { payments: true },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 9, 12, 0, 0));
    expect(invoiceBalance(opening).late).toBe(0);
    vi.setSystemTime(new Date(2026, 8, 11, 12, 0, 0));
    const afterDue = invoiceBalance(opening);
    expect(afterDue.remaining).toBe(afterDue.dueNow - afterDue.late);
    expect(await prisma.feeInvoice.count({ where: { studentId: "student-opening-001" } })).toBe(1);
    vi.useRealTimers();
    await collectFeeCore(officeUser, { invoiceId: opening.id, method: "CASH" });
    const paid = await prisma.feeInvoice.findUniqueOrThrow({ where: { id: opening.id }, include: { payments: true } });
    expect(invoiceBalance(paid)).toMatchObject({ remaining: 0, late: 0, dueNow: 0, display: "PAID" });
    expect(paid.payments.reduce((sum, row) => sum + row.amount, 0)).toBe(12345);
    await ensureFeeDocument("PAYMENT_RECEIPT");
    await ensureFeeDocument("FEE_INVOICE");
    const receipt = await issueFeeReceiptCore(officeUser, { invoiceId: opening.id });
    const again = await issueFeeReceiptCore(officeUser, { invoiceId: opening.id });
    expect(again.id).toBe(receipt.id);
    expect(await prisma.issuedDocument.count({ where: { type: "PAYMENT_RECEIPT", subjectId: "student-opening-001" } })).toBe(1);
    const bundle = await onboardingBundle(officeUser);
    expect(bundle.steps.find((row) => row.key === "fee_invoice_document")?.status).toBe("complete");
    expect(bundle.steps.find((row) => row.key === "payment_receipt_document")?.status).toBe("complete");
  });

  it("lists a paid OPENING invoice on the session Register with collected totals", async () => {
    const register = await queryFeeRegister(officeUser, {
      admissionNo: "TEST-OPENING-001",
      sessionId: "session-2026",
      pageSize: 50,
    });
    const opening = (register.rows as { period: string; status: string; total: number; paid: number; balance: number }[]).find((row) => row.period === "OPENING");
    expect(opening).toMatchObject({ period: "OPENING", status: "paid", total: 12345, paid: 12345, balance: 0 });
    expect(register.summary.paid).toBeGreaterThanOrEqual(12345);
    expect((register.history as Record<string, { period: string }[]>)["student-opening-001"]?.some((row) => row.period === "OPENING")).toBe(true);
  });

  it("records a zero backlog cutoff without an OPENING invoice, then bills September first", async () => {
    await createOpeningStudent({ id: "student-opening-002", admissionNo: "TEST-OPENING-002" });
    await applyOnboardingImport(officeUser, {
      batchId: (await preview([openingRow({ admissionnumber: "TEST-OPENING-002", backloginvoiceamount: "0" })])).batchId,
    });
    expect(await prisma.feeInvoice.count({ where: { studentId: "student-opening-002" } })).toBe(0);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: "student-opening-002" } })).feeGeneratedThrough).toBe("2026-08");
    const saved = await prisma.feeTemplate.create({
      data: {
        classId: fixture.classId,
        sessionId: "session-2026",
        name: "Monthly fee",
        startsPeriod: "2026-04",
        endsPeriod: "2027-03",
        dueDay: 10,
        lines: { create: [{ label: "Tuition", amount: 2000, scope: "ALL" }] },
      },
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
    await issueClassFeesCore(officeUser, { classId: fixture.classId, templateId: saved.id });
    vi.useRealTimers();
    const periods = (await prisma.feeInvoice.findMany({ where: { studentId: "student-opening-002" } })).map((row) => row.period).sort();
    expect(periods).toEqual(["2026-09"]);
  });

  it("issues September after an August cutoff, never another OPENING, and due-fees may add October", async () => {
    const template = await prisma.feeTemplate.findFirstOrThrow({ where: { classId: fixture.classId, sessionId: "session-2026" } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
    await issueClassFeesCore(officeUser, { classId: fixture.classId, templateId: template.id });
    const afterClass = (await prisma.feeInvoice.findMany({ where: { studentId: "student-opening-001" } })).map((row) => row.period).sort();
    expect(afterClass).toEqual(["2026-09", "OPENING"]);
    await issueDueFeesCore(new Date(), fixture.classId, "session-2026");
    const afterDue = (await prisma.feeInvoice.findMany({ where: { studentId: "student-opening-001" } })).map((row) => row.period).sort();
    expect(afterDue).toEqual(["2026-09", "2026-10", "OPENING"]);
    await issueClassFeesCore(officeUser, { classId: fixture.classId, templateId: template.id });
    await issueDueFeesCore(new Date(), fixture.classId, "session-2026");
    vi.useRealTimers();
    expect(await prisma.feeInvoice.count({ where: { studentId: "student-opening-001", period: "OPENING" } })).toBe(1);
    expect(await prisma.feeInvoice.count({ where: { studentId: "student-opening-001", period: "2026-09" } })).toBe(1);
    const register = await queryFeeRegister(officeUser, {
      admissionNo: "TEST-OPENING-001",
      sessionId: "session-2026",
      pageSize: 50,
    });
    const periods = (register.rows as { period: string }[]).map((row) => row.period).sort();
    expect(periods).toEqual(expect.arrayContaining(["2026-09", "2026-10", "OPENING"]));
    expect(periods.filter((period) => period === "OPENING")).toHaveLength(1);
    const billedOpening = (register.rows as { period: string; total: number }[]).filter((row) => row.period === "OPENING");
    expect(billedOpening).toHaveLength(1);
    expect(billedOpening[0]?.total).toBe(12345);
  });

  it("uses the later of join-month and cutoff as the first billable month", async () => {
    const template = await prisma.feeTemplate.findFirstOrThrow({ where: { classId: fixture.classId, sessionId: "session-2026" } });
    const rows = [
      { id: "student-cut-apr", admissionNo: "TEST-CUT-APR", through: "2026-04", first: "2026-05" },
      { id: "student-cut-may", admissionNo: "TEST-CUT-MAY", through: "2026-05", first: "2026-06" },
      { id: "student-cut-aug", admissionNo: "TEST-CUT-AUG", through: "2026-08", first: "2026-09" },
      { id: "student-join-jun", admissionNo: "TEST-JOIN-JUN", through: "2026-08", joinedAt: "2026-06-15T00:00:00.000Z", first: "2026-09" },
      { id: "student-join-sep", admissionNo: "TEST-JOIN-SEP", through: "2026-08", joinedAt: "2026-09-01T00:00:00.000Z", first: "2026-09" },
      { id: "student-join-oct", admissionNo: "TEST-JOIN-OCT", through: "2026-08", joinedAt: "2026-10-01T00:00:00.000Z", first: "2026-10" },
    ];
    for (const row of rows) {
      await createOpeningStudent({
        id: row.id,
        admissionNo: row.admissionNo,
        joinedAt: row.joinedAt,
        feeGeneratedThrough: row.through,
      });
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 2, 12, 0, 0));
    await issueClassFeesCore(officeUser, { classId: fixture.classId, templateId: template.id });
    vi.useRealTimers();
    for (const row of rows) {
      const periods = (await prisma.feeInvoice.findMany({ where: { studentId: row.id, period: { startsWith: "2026-" } } }))
        .map((invoice) => invoice.period)
        .sort();
      expect(periods[0], row.id).toBe(row.first);
      expect(periods).not.toContain("2026-04");
    }
  });

  it("keeps OPENING amount unchanged after catalog edits and keeps admission on a separate period", async () => {
    await prisma.student.update({
      where: { id: "student-opening-002" },
      data: { feeAddOns: { create: [{ kind: "TRANSPORT:route-a", label: "Bus", amount: 1000, active: true }] } },
    });
    const opening = await prisma.feeInvoice.findUniqueOrThrow({
      where: { studentId_period: { studentId: "student-opening-001", period: "OPENING" } },
    });
    expect(opening.amount).toBe(12345);
    await prisma.feeInvoice.create({
      data: {
        studentId: "student-opening-001",
        classId: fixture.classId,
        period: "ADMISSION-student-opening-001",
        title: "One-time admission fee",
        amount: 10000,
        linesJson: "[]",
        dueDate: new Date("2026-06-01T00:00:00.000Z"),
        status: "DUE",
      },
    });
    const periods = (await prisma.feeInvoice.findMany({ where: { studentId: "student-opening-001" } })).map((row) => row.period);
    expect(periods).toEqual(expect.arrayContaining(["OPENING", "ADMISSION-student-opening-001", "2026-09"]));
    const register = await queryFeeRegister(officeUser, {
      admissionNo: "TEST-OPENING-001",
      sessionId: "session-2026",
      pageSize: 50,
    });
    const registerPeriods = (register.rows as { period: string }[]).map((row) => row.period);
    expect(registerPeriods).toContain("OPENING");
    expect(registerPeriods.some((period) => period.startsWith("ADMISSION-"))).toBe(false);
  });

  it("never shows another school's OPENING invoice on this Register", async () => {
    const otherOrg = await prisma.saasOrg.create({
      data: {
        id: "org-opening-other",
        schoolName: "Other Academy",
        ownerName: "Other Office",
        ownerEmail: "office.other@school.test",
        ownerPhone: "9876540002",
      },
    });
    const otherStudent = await prisma.student.create({
      data: {
        id: "student-opening-other",
        parentId: "parent-pari",
        classId: fixture.classId,
        orgId: otherOrg.id,
        admissionNo: "OTHER-OPENING-001",
        name: "Other Child",
        dateOfBirth: new Date("2015-01-01T00:00:00Z"),
      },
    });
    await prisma.feeInvoice.create({
      data: {
        orgId: otherOrg.id,
        studentId: otherStudent.id,
        classId: fixture.classId,
        period: "OPENING",
        kind: "OPENING",
        generatedThrough: "2026-08",
        title: "Backlog invoice",
        amount: 99999,
        linesJson: "[]",
        dueDate: new Date("2026-09-10T00:00:00.000Z"),
        shareToken: "opening-other-share",
        status: "DUE",
      },
    });
    const register = await request(app)
      .get("/api/v1/fee-register")
      .query({ sessionId: "session-2026", pageSize: 100 })
      .set({ Authorization: `Bearer ${officeToken}` });
    expect(register.status).toBe(200);
    const admissions = (register.body.rows as { admissionNo: string }[]).map((row) => row.admissionNo);
    expect(admissions).not.toContain("OTHER-OPENING-001");
    expect(JSON.stringify(register.body)).not.toMatch(/99999/);
  });

  it("collects UPI on an isolated opening invoice and caps concurrent cashiers", async () => {
    await createOpeningStudent({ id: "student-opening-upi", admissionNo: "TEST-OPENING-UPI" });
    await applyOnboardingImport(officeUser, {
      batchId: (await preview([openingRow({ admissionnumber: "TEST-OPENING-UPI" })])).batchId,
    });
    const invoice = await prisma.feeInvoice.findUniqueOrThrow({
      where: { studentId_period: { studentId: "student-opening-upi", period: "OPENING" } },
    });
    await collectFeeCore(officeUser, { invoiceId: invoice.id, method: "UPI", reference: "UTR-OPENING-1" });
    expect((await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } })).method).toBe("UPI");

    await createOpeningStudent({ id: "student-opening-race", admissionNo: "TEST-OPENING-RACE" });
    await applyOnboardingImport(officeUser, {
      batchId: (await preview([openingRow({ admissionnumber: "TEST-OPENING-RACE" })])).batchId,
    });
    const race = await prisma.feeInvoice.findUniqueOrThrow({
      where: { studentId_period: { studentId: "student-opening-race", period: "OPENING" } },
    });
    await Promise.allSettled([
      collectFeeCore(officeUser, { invoiceId: race.id, amount: 12345, method: "CASH" }),
      collectFeeCore(officeUser, { invoiceId: race.id, amount: 12345, method: "CASH" }),
    ]);
    const paid = (await prisma.payment.findMany({ where: { invoiceId: race.id } })).reduce((sum, row) => sum + row.amount, 0);
    expect(paid).toBeLessThanOrEqual(12345);
  });

  it("keeps parent records on their own children and rejects parent office collection", async () => {
    const parentRecord = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${parentToken}` });
    expect(parentRecord.status).toBe(200);
    const fees = JSON.stringify(parentRecord.body);
    expect(fees).not.toMatch(/onboarding|opening_balances|applyOnboardingImport/i);
    const collect = await request(app)
      .post("/api/v1/act")
      .set({ Authorization: `Bearer ${parentToken}` })
      .send({ op: "collectFee", invoiceId: "missing" });
    expect(collect.status).toBe(400);
    const apply = await request(app)
      .post("/api/v1/act")
      .set({ Authorization: `Bearer ${parentToken}` })
      .send({ op: "applyOnboardingImport", batchId: "x" });
    expect(apply.status).toBe(400);
  });
});
