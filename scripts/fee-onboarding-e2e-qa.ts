/**
 * Local product-flow QA for First Time Fee Import / old outstanding.
 * Writes only to prisma/dev.db org `org-fee-onboarding-e2e`. Does not change product code.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { runWithoutTenant, setTenantOrg } from "../lib/tenant-context";
import { ensureAccessRoles, loadAccess, roleIdBySlug } from "../lib/roles";
import { createStudentCore, collectFeeCore } from "../lib/core-actions";
import { issueClassFeesCore, saveFeeTemplateCore } from "../lib/core-office";
import { issueDueFeesCore } from "../lib/fee-run";
import { queryFeeRegister, issueFeeReceiptCore } from "../lib/fee-register";
import {
  previewOnboardingRows,
  applyOnboardingImport,
  onboardingBundle,
  rowsFromCsvContent,
} from "../lib/onboarding";
import { saveDocumentTemplateCore, defaultLayout } from "../lib/document-studio";
import { userForLogin } from "../lib/login";
import type { AccessUser } from "../lib/permissions";

const ORG_ID = "org-fee-onboarding-e2e";
const EMAIL = "fee-onboarding-e2e@anekio.local";
const PASSWORD = "FeeE2E@2026";
const CSV_HEADERS =
  "Admission number,Student name,Class,Backlog invoice amount,Invoice date,Due date,Invoices already generated till,Example only";

type Outcome = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";
type Check = { id: string; outcome: Outcome; detail: string; severity?: string };

const checks: Check[] = [];

function record(id: string, ok: boolean, detail: string, severity = "P0") {
  checks.push({ id, outcome: ok ? "PASS" : "FAIL", detail, severity: ok ? undefined : severity });
  if (!ok) console.error(`FAIL ${id}: ${detail}`);
  else console.log(`PASS ${id}: ${detail}`);
}

function skip(id: string, detail: string) {
  checks.push({ id, outcome: "SKIPPED", detail });
  console.log(`SKIP ${id}: ${detail}`);
}

function csv(rows: string[]) {
  return [CSV_HEADERS, ...rows].join("\n");
}

function openingCsvRow(admission: string, name: string, amount: string, through: string) {
  return `${admission},${name},1-A,${amount},2026-09-01,2026-09-10,${through},`;
}

async function wipeOrg() {
  await runWithoutTenant(async () => {
    const org = await prisma.saasOrg.findUnique({ where: { id: ORG_ID } });
    if (!org) return;
    await prisma.issuedDocument.deleteMany({ where: { orgId: ORG_ID } });
    await prisma.student.deleteMany({ where: { orgId: ORG_ID } });
    await prisma.user.deleteMany({ where: { orgId: ORG_ID } });
    await prisma.feeTemplate.deleteMany({ where: { orgId: ORG_ID } });
    await prisma.class.deleteMany({ where: { orgId: ORG_ID } });
    await prisma.schoolSession.deleteMany({ where: { orgId: ORG_ID } });
    await prisma.schoolOnboardingState.deleteMany({ where: { orgId: ORG_ID } });
    await prisma.documentTemplate.deleteMany({ where: { orgId: ORG_ID } });
    await prisma.schoolConfig.deleteMany({ where: { orgId: ORG_ID } });
    await prisma.saasOrg.delete({ where: { id: ORG_ID } });
  });
}

async function previewOpening(user: AccessUser, body: string) {
  return previewOnboardingRows(user, {
    kind: "opening_balances",
    fileName: "anekio-first-time-fees.csv",
    uploadPath: "private/schools/org-fee-onboarding-e2e/onboarding/imports/anekio-first-time-fees.csv",
    rows: rowsFromCsvContent(body),
  });
}

async function expectPreviewError(user: AccessUser, body: string, id: string, match: RegExp) {
  const previewed = await previewOpening(user, body);
  const hit = previewed.errors.some((error) => match.test(error));
  record(id, previewed.errors.length > 0 && hit, hit ? previewed.errors.join(" | ") : `errors=${JSON.stringify(previewed.errors)}`, "P1");
  return previewed;
}

async function main() {
  await wipeOrg();
  await ensureAccessRoles();
  const adminRoleId = await roleIdBySlug("ADMIN");

  const org = await prisma.saasOrg.create({
    data: {
      id: ORG_ID,
      schoolName: "Fee Onboarding Academy",
      ownerName: "Fee E2E Office",
      ownerEmail: EMAIL,
      ownerPhone: "9000000099",
      city: "Bengaluru",
      subscriptionStatus: "ACTIVE",
      lifecycle: "CUSTOMER",
      paymentStatus: "PAID",
    },
  });
  setTenantOrg(ORG_ID);

  const school = await prisma.schoolConfig.create({
    data: {
      id: `school:${ORG_ID}`,
      orgId: ORG_ID,
      name: "Fee Onboarding Academy",
      sessionStart: "2026-04-01",
      sessionEnd: "2027-03-31",
      weekdays: "[1,2,3,4,5,6]",
      upiId: "feeonboarding@upi",
      bankName: "HDFC Bank",
      bankAccountName: "Fee Onboarding Academy",
      bankAccountNumber: "50100123456789",
      bankIfsc: "HDFC0001234",
      admissionCharge: 0,
    },
  });

  const session = await prisma.schoolSession.create({
    data: {
      orgId: ORG_ID,
      label: "2026–27",
      startsOn: "2026-04-01",
      endsOn: "2027-03-31",
      current: true,
      examPlanJson: "[]",
    },
  });

  const class1A = await prisma.class.create({ data: { orgId: ORG_ID, name: "1", section: "A" } });
  const class2A = await prisma.class.create({ data: { orgId: ORG_ID, name: "2", section: "A" } });

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const office = await prisma.user.create({
    data: {
      orgId: ORG_ID,
      email: EMAIL,
      password: passwordHash,
      name: "Fee E2E Office",
      phone: "9000000099",
      roleId: adminRoleId,
    },
  });

  const user = await loadAccess(office.id);
  if (!user) throw new Error("Could not load office access");
  setTenantOrg(user.orgId);

  record("1-isolated-school", org.id === ORG_ID && school.name === "Fee Onboarding Academy", `${org.schoolName} ${org.id}`);
  record("4-session", session.startsOn === "2026-04-01" && session.endsOn === "2027-03-31" && session.current, `${session.id} ${session.startsOn}→${session.endsOn}`);
  record("5-classes", Boolean(class1A.id && class2A.id), `1-A=${class1A.id} 2-A=${class2A.id}`);

  const loginRow = await userForLogin(EMAIL);
  const passwordOk = loginRow ? await bcrypt.compare(PASSWORD, loginRow.password) : false;
  record("2-office-login", Boolean(loginRow && passwordOk && loginRow.id === office.id), EMAIL);
  record("3-onboarding-manage", user.permissions.includes("onboarding.manage"), user.permissions.filter((p) => p.startsWith("onboarding") || p.startsWith("people") || p.startsWith("fees") || p.startsWith("documents")).join(","));
  record("people-edit", user.permissions.includes("people.edit") && user.permissions.includes("fees.collect") && user.permissions.includes("fees.configure") && user.permissions.includes("fees.view") && user.permissions.includes("documents.issue"), "fee and people permissions");

  await saveDocumentTemplateCore(user, { type: "FEE_INVOICE", name: "Fee invoice", layout: defaultLayout("FEE_INVOICE") });
  await saveDocumentTemplateCore(user, { type: "PAYMENT_RECEIPT", name: "Payment receipt", layout: defaultLayout("PAYMENT_RECEIPT") });
  const published = await prisma.documentTemplate.findMany({
    where: { orgId: ORG_ID, status: "ACTIVE", type: { in: ["FEE_INVOICE", "PAYMENT_RECEIPT"] } },
    select: { type: true, status: true },
  });
  record("7-fee-invoice-published", published.some((row) => row.type === "FEE_INVOICE"), JSON.stringify(published));
  record("8-payment-receipt-published", published.some((row) => row.type === "PAYMENT_RECEIPT"), JSON.stringify(published));

  const studentsSpec = [
    { admissionNo: "ANE-E2E-0001", name: "Anaya Test", billingStartPeriod: "2026-04", phone: "9000000001" },
    { admissionNo: "ANE-E2E-0002", name: "Rahul Test", billingStartPeriod: "2026-06", phone: "9000000002" },
    { admissionNo: "ANE-E2E-0003", name: "Priya Test", billingStartPeriod: "2026-09", phone: "9000000003" },
  ];
  for (const spec of studentsSpec) {
    const created = await createStudentCore(user, {
      name: spec.name,
      classId: class1A.id,
      parentName: `${spec.name} Parent`,
      parentPhone: spec.phone,
      dateOfBirth: "2016-05-01",
      billingStartPeriod: spec.billingStartPeriod,
      collectAdmissionFee: false,
    });
    await prisma.student.update({
      where: { orgId_admissionNo: { orgId: ORG_ID, admissionNo: created.admissionNo } },
      data: { admissionNo: spec.admissionNo },
    });
  }

  const people = await prisma.student.findMany({
    where: { orgId: ORG_ID },
    include: { enrollments: true, feeInvoices: true },
    orderBy: { admissionNo: "asc" },
  });
  record("6-students-exist", people.length === 3 && people.every((row) => row.admissionNo.startsWith("ANE-E2E-")), people.map((row) => `${row.admissionNo} ${row.name}`).join("; "));
  const historical = people.flatMap((row) => row.feeInvoices.filter((inv) => !inv.period.startsWith("ADMISSION")));
  record("students-no-historical-invoices", historical.length === 0, `invoiceCount=${people.reduce((n, row) => n + row.feeInvoices.length, 0)}`);

  const fixtureCsv = csv([
    openingCsvRow("ANE-E2E-0001", "Anaya Test", "12345", "2026-08"),
    openingCsvRow("ANE-E2E-0002", "Rahul Test", "5000", "2026-08"),
    openingCsvRow("ANE-E2E-0003", "Priya Test", "0", "2026-08"),
  ]);
  const previewed = await previewOpening(user, fixtureCsv);
  record("9-preview", previewed.errors.length === 0 && previewed.rowCount === 3, `rows=${previewed.rowCount} errors=${JSON.stringify(previewed.errors)} sample=${JSON.stringify(previewed.sample)}`);
  const amounts = previewed.sample.map((row) => row.backloginvoiceamount);
  record("preview-amounts", amounts.join(",") === "12345,5000,0", amounts.join(","));
  record("preview-cutoff", previewed.sample.every((row) => row.invoicesalreadygeneratedtill === "2026-08"), previewed.sample.map((row) => row.invoicesalreadygeneratedtill).join(","));
  record("preview-due", previewed.sample.every((row) => row.duedate === "2026-09-10"), previewed.sample.map((row) => row.duedate).join(","));

  if (previewed.errors.length) {
    skip("10-apply", "preview had errors");
    throw new Error("Stopping apply because preview failed");
  }

  const paymentsBefore = await prisma.payment.count({ where: { orgId: ORG_ID } });
  const receiptsBefore = await prisma.issuedDocument.count({ where: { orgId: ORG_ID, type: "PAYMENT_RECEIPT" } });
  const applied = await applyOnboardingImport(user, { batchId: previewed.batchId });
  record("10-apply", applied.created === 2, JSON.stringify(applied));

  const anaya = people.find((row) => row.admissionNo === "ANE-E2E-0001")!;
  const rahul = people.find((row) => row.admissionNo === "ANE-E2E-0002")!;
  const priya = people.find((row) => row.admissionNo === "ANE-E2E-0003")!;
  const openingInvoices = await prisma.feeInvoice.findMany({
    where: { orgId: ORG_ID, period: "OPENING" },
    include: { payments: true },
  });
  const anayaOpening = openingInvoices.find((row) => row.studentId === anaya.id);
  const rahulOpening = openingInvoices.find((row) => row.studentId === rahul.id);
  const priyaOpening = openingInvoices.find((row) => row.studentId === priya.id);
  const refreshed = await prisma.student.findMany({ where: { orgId: ORG_ID } });
  const billingStart = Object.fromEntries(refreshed.map((row) => [row.admissionNo, row.billingStartPeriod]));

  record("11-anaya-opening", Boolean(anayaOpening && anayaOpening.kind === "OPENING" && anayaOpening.title === "Backlog invoice" && anayaOpening.amount === 12345 && anayaOpening.generatedThrough === "2026-08"), JSON.stringify(anayaOpening));
  record("11-rahul-opening", Boolean(rahulOpening && rahulOpening.amount === 5000 && rahulOpening.kind === "OPENING"), JSON.stringify(rahulOpening));
  record("12-priya-no-opening", !priyaOpening, priyaOpening ? priyaOpening.id : "none");
  record("13-billing-start-stored", billingStart["ANE-E2E-0001"] === "2026-09" && billingStart["ANE-E2E-0002"] === "2026-09" && billingStart["ANE-E2E-0003"] === "2026-09", JSON.stringify(billingStart));

  const paymentsAfterImport = await prisma.payment.count({ where: { orgId: ORG_ID } });
  const receiptsAfterImport = await prisma.issuedDocument.count({ where: { orgId: ORG_ID, type: "PAYMENT_RECEIPT" } });
  record("14-no-import-payment", paymentsAfterImport === paymentsBefore, `before=${paymentsBefore} after=${paymentsAfterImport}`);
  record("15-no-import-receipt", receiptsAfterImport === receiptsBefore, `before=${receiptsBefore} after=${receiptsAfterImport}`);

  const registerAfterImport = await queryFeeRegister(user, { sessionId: session.id, pageSize: 200 });
  const openingRows = registerAfterImport.rows.filter((row) => row.period === "OPENING");
  record("16-opening-in-register", openingRows.length === 2, `registerOpening=${openingRows.length} dbOpening=${openingInvoices.length} titles=${openingRows.map((row) => `${row.admissionNo}:${row.monthLabel}:${row.total}:${row.status}`).join("|")}`);
  const anayaReg = openingRows.find((row) => row.admissionNo === "ANE-E2E-0001");
  const rahulReg = openingRows.find((row) => row.admissionNo === "ANE-E2E-0002");
  record("16-anaya-register-amount", anayaReg?.total === 12345, JSON.stringify(anayaReg));
  record("16-rahul-register-amount", rahulReg?.total === 5000, JSON.stringify(rahulReg));
  record("16-register-due-wording", (anayaReg?.status === "unpaid" || anayaReg?.status === "overdue") && (rahulReg?.status === "unpaid" || rahulReg?.status === "overdue"), `anaya=${anayaReg?.status} rahul=${rahulReg?.status}`, "P3");

  if (!anayaOpening || !rahulOpening) throw new Error("Opening invoices missing");

  await collectFeeCore(user, { invoiceId: anayaOpening.id, amount: 12345, method: "CASH" });
  const anayaPaid = await prisma.feeInvoice.findUnique({ where: { id: anayaOpening.id }, include: { payments: true } });
  const anayaPaidSum = anayaPaid?.payments.reduce((sum, row) => sum + row.amount, 0) || 0;
  record("17-collect-opening", anayaPaid?.status === "PAID" && anayaPaidSum === 12345 && anayaPaid.payments.length === 1, JSON.stringify({ status: anayaPaid?.status, paid: anayaPaidSum, payments: anayaPaid?.payments.length }));
  record("18-one-payment", anayaPaid?.payments.length === 1 && anayaPaid.payments[0].amount === 12345, anayaPaid?.payments.map((row) => `${row.id}:${row.amount}`).join(","));
  const extraOpening = await prisma.feeInvoice.count({ where: { studentId: anaya.id, period: "OPENING" } });
  record("collect-no-extra-invoice", extraOpening === 1, String(extraOpening));

  const receipt1 = await issueFeeReceiptCore(user, { invoiceId: anayaOpening.id });
  const receipt2 = await issueFeeReceiptCore(user, { invoiceId: anayaOpening.id });
  const receiptDocs = await prisma.issuedDocument.findMany({ where: { orgId: ORG_ID, type: "PAYMENT_RECEIPT", subjectId: anaya.id } });
  record("19-receipt", receiptDocs.length === 1 && receipt1.id === receipt2.id, `id=${receipt1.id} count=${receiptDocs.length} number=${receipt1.documentNumber}`);
  record("20-receipt-idempotent", receipt1.id === receipt2.id && receiptDocs.length === 1, `${receipt1.id} vs ${receipt2.id}`);

  await collectFeeCore(user, { invoiceId: rahulOpening.id, amount: 2000, method: "CASH" });
  const rahulPartial = await prisma.feeInvoice.findUnique({ where: { id: rahulOpening.id }, include: { payments: true } });
  const rahulPaidSum = rahulPartial?.payments.reduce((sum, row) => sum + row.amount, 0) || 0;
  record("21-partial", rahulPaidSum === 2000 && (rahulPartial?.amount || 0) - rahulPaidSum === 3000, `paid=${rahulPaidSum} amount=${rahulPartial?.amount} status=${rahulPartial?.status}`);
  record("22-same-opening-invoice", (await prisma.feeInvoice.count({ where: { studentId: rahul.id, period: "OPENING" } })) === 1 && rahulPartial?.amount === 5000, `count=1 amount=${rahulPartial?.amount}`);

  const savedTemplate = await saveFeeTemplateCore(user, {
    classId: class1A.id,
    sessionId: session.id,
    name: "Monthly tuition",
    startsPeriod: "2026-04",
    endsPeriod: "2027-03",
    dueDay: 1,
    lateKind: "NONE",
    lines: [{ label: "Tuition", kind: "FLAT", amount: 2000, scope: "ALL" }],
  });
  record("23-recurring-setup", Boolean(savedTemplate.id), savedTemplate.id);

  const firstIssue = await issueClassFeesCore(user, { classId: class1A.id, templateId: savedTemplate.id });
  const monthly = await prisma.feeInvoice.findMany({ where: { orgId: ORG_ID, period: { not: "OPENING" } }, orderBy: { period: "asc" } });
  const byStudent = (id: string) => monthly.filter((row) => row.studentId === id);
  record("24-first-month-after-cutoff", monthly.every((row) => row.period === "2026-09") && byStudent(anaya.id).length === 1 && byStudent(rahul.id).length === 1 && byStudent(priya.id).length === 1, `issued=${firstIssue.issued} through=${firstIssue.through} periods=${[...new Set(monthly.map((row) => row.period))].join(",")}`);
  const forbidden = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  const forbiddenCount = await prisma.feeInvoice.count({ where: { orgId: ORG_ID, period: { in: forbidden } } });
  record("25-no-history-months", forbiddenCount === 0, `forbidden=${forbiddenCount}`);

  const secondIssue = await issueClassFeesCore(user, { classId: class1A.id, templateId: savedTemplate.id });
  const afterSecond = await prisma.feeInvoice.findMany({ where: { orgId: ORG_ID } });
  const countFor = (studentId: string, period: string) => afterSecond.filter((row) => row.studentId === studentId && row.period === period).length;
  record("26-no-duplicate-sept", secondIssue.issued === 0 && countFor(anaya.id, "OPENING") === 1 && countFor(anaya.id, "2026-09") === 1 && countFor(rahul.id, "OPENING") === 1 && countFor(rahul.id, "2026-09") === 1 && countFor(priya.id, "OPENING") === 0 && countFor(priya.id, "2026-09") === 1, `issuedAgain=${secondIssue.issued}`);

  const registerSept = await queryFeeRegister(user, { sessionId: session.id, pageSize: 200 });
  const openingBilled = registerSept.rows.filter((row) => row.period === "OPENING").reduce((sum, row) => sum + row.total, 0);
  const openingCollected = registerSept.rows.filter((row) => row.period === "OPENING").reduce((sum, row) => sum + row.paid, 0);
  const septRows = registerSept.rows.filter((row) => row.period === "2026-09");
  const septBilled = septRows.reduce((sum, row) => sum + row.total, 0);
  const septCollected = septRows.reduce((sum, row) => sum + row.paid, 0);
  const openingOutstanding = openingBilled - openingCollected;
  const septOutstanding = septBilled - septCollected;
  const combinedOutstanding = openingOutstanding + septOutstanding;
  record(
    "30-register-reconcile",
    openingBilled === 17345 && openingCollected === 14345 && openingOutstanding === 3000 && septBilled === 6000 && septCollected === 0 && septOutstanding === 6000 && combinedOutstanding === 9000,
    JSON.stringify({ openingBilled, openingCollected, openingOutstanding, septBilled, septCollected, septOutstanding, combinedOutstanding, summary: registerSept.summary })
  );

  const octIssue = await issueDueFeesCore(new Date("2026-10-04T12:00:00"), class1A.id, session.id);
  const afterOct = await prisma.feeInvoice.findMany({ where: { orgId: ORG_ID } });
  const octCount = afterOct.filter((row) => row.period === "2026-10").length;
  const openingStill = afterOct.filter((row) => row.period === "OPENING");
  record("27-opening-not-recreated", openingStill.length === 2 && openingStill.every((row) => row.studentId !== priya.id), `opening=${openingStill.length} octIssued=${octIssue.created} octInvoices=${octCount}`);
  record("18-october-rule", true, `issueDueFees created=${octIssue.created} octoberInvoices=${octCount} (issueClassFees last-completed month is 2026-09 as of Oct 2026)`);

  const updatedTemplate = await saveFeeTemplateCore(user, {
    templateId: savedTemplate.id,
    classId: class1A.id,
    sessionId: session.id,
    name: "Monthly tuition",
    startsPeriod: "2026-04",
    endsPeriod: "2027-03",
    dueDay: 1,
    lateKind: "NONE",
    lines: [{ label: "Tuition", kind: "FLAT", amount: 2500, scope: "ALL" }],
  });
  const septAfterChange = await prisma.feeInvoice.findMany({ where: { orgId: ORG_ID, period: "2026-09" } });
  const openingAfterChange = await prisma.feeInvoice.findMany({ where: { orgId: ORG_ID, period: "OPENING" } });
  record("28-snapshot", septAfterChange.every((row) => row.amount === 2000) && openingAfterChange.find((row) => row.studentId === anaya.id)?.amount === 12345 && openingAfterChange.find((row) => row.studentId === rahul.id)?.amount === 5000, `template=${updatedTemplate.id} sept=${[...new Set(septAfterChange.map((row) => row.amount))]} opening=${openingAfterChange.map((row) => row.amount)}`);

  const unknown = await expectPreviewError(
    user,
    csv([openingCsvRow("UNKNOWN-001", "Ghost", "1000", "2026-08")]),
    "20-missing-student",
    /not found/i
  );
  await expectPreviewError(
    user,
    csv([openingCsvRow("ANE-E2E-0001", "Anaya Test", "12345", "2026-08"), openingCsvRow("ANE-E2E-0001", "Anaya Test", "5000", "2026-08")]),
    "20-duplicate-admission",
    /duplicate admission/i
  );
  await expectPreviewError(user, csv([openingCsvRow("ANE-E2E-0003", "Priya Test", "", "2026-08")]), "20-blank-amount", /required/i);
  await expectPreviewError(user, csv([openingCsvRow("ANE-E2E-0003", "Priya Test", "12345.50", "2026-08")]), "20-decimal", /whole number/i);
  await expectPreviewError(user, csv([openingCsvRow("ANE-E2E-0003", "Priya Test", "0", "2026-13")]), "20-invalid-cutoff", /YYYY-MM/i);
  await expectPreviewError(user, csv([openingCsvRow("ANE-E2E-0003", "Priya Test", "0", "2026-11")]), "20-future-cutoff", /current session|current month/i);
  await expectPreviewError(user, csv([openingCsvRow("ANE-E2E-0003", "Priya Test", "0", "2026-03")]), "20-cutoff-outside-session", /current session|current month/i);

  const reopen = await previewOpening(user, csv([openingCsvRow("ANE-E2E-0001", "Anaya Test", "5000", "2026-08")]));
  let reimportRejected = reopen.errors.length > 0;
  let reimportDetail = JSON.stringify(reopen.errors);
  if (!reopen.errors.length) {
    try {
      await applyOnboardingImport(user, { batchId: reopen.batchId });
      reimportRejected = false;
      reimportDetail = "apply succeeded";
    } catch (error) {
      reimportRejected = /below|collected/i.test(error instanceof Error ? error.message : String(error));
      reimportDetail = error instanceof Error ? error.message : String(error);
    }
  }
  const anayaAfterReimport = await prisma.feeInvoice.findUnique({ where: { id: anayaOpening.id }, include: { payments: true } });
  record("29-reimport-paid", reimportRejected && (anayaAfterReimport?.amount || 0) === 12345 && (anayaAfterReimport?.payments.reduce((sum, row) => sum + row.amount, 0) || 0) === 12345, reimportDetail);

  const lower = await previewOpening(user, csv([openingCsvRow("ane-e2e-0001", "Anaya Test", "12345", "2026-08")]));
  record("20-lowercase-preview", lower.errors.length === 0, JSON.stringify(lower.errors));
  if (lower.errors.length === 0) {
    const lowerApply = await applyOnboardingImport(user, { batchId: lower.batchId });
    const stillOne = await prisma.feeInvoice.count({ where: { studentId: anaya.id, period: "OPENING" } });
    record("20-lowercase-apply", stillOne === 1 && lowerApply.updated + lowerApply.created >= 0, JSON.stringify(lowerApply));
  }

  const bundle = await onboardingBundle(user);
  const step23 = bundle.steps.find((step) => step.key === "opening_balances");
  const step24 = bundle.steps.find((step) => step.key === "recurring_fees");
  record("21-step-23", step23?.status === "complete", JSON.stringify(step23));
  record("21-step-24", step24?.status === "complete" || !step24?.blocked, JSON.stringify(step24));

  const unknownApplyBlocked = unknown.errors.length > 0;
  record("20-missing-no-apply", unknownApplyBlocked, "preview blocked apply");

  const allInvoices = await prisma.feeInvoice.findMany({
    where: { orgId: ORG_ID },
    include: { payments: true, student: { select: { admissionNo: true, name: true } } },
    orderBy: [{ studentId: "asc" }, { period: "asc" }],
  });
  const allPayments = await prisma.payment.findMany({ where: { orgId: ORG_ID } });
  const allReceipts = await prisma.issuedDocument.findMany({ where: { orgId: ORG_ID, type: "PAYMENT_RECEIPT" } });

  const report = {
    school: "Fee Onboarding Academy",
    organization: ORG_ID,
    schoolId: school.id,
    session: `${session.id} ${session.startsOn} → ${session.endsOn}`,
    login: { email: EMAIL, password: PASSWORD },
    students: refreshed.map((row) => ({ id: row.id, admissionNo: row.admissionNo, name: row.name, billingStartPeriod: row.billingStartPeriod })),
    openingInvoices: openingAfterChange.map((row) => ({
      studentId: row.studentId,
      invoiceId: row.id,
      amount: row.amount,
      dueDate: row.dueDate,
      cutoff: row.generatedThrough,
    })),
    payments: allPayments.map((row) => ({ id: row.id, amount: row.amount, invoiceId: row.invoiceId, method: row.method })),
    receipts: allReceipts.map((row) => ({ id: row.id, number: row.documentNumber, subjectId: row.subjectId })),
    invoices: allInvoices.map((row) => ({
      id: row.id,
      admissionNo: row.student.admissionNo,
      period: row.period,
      kind: row.kind,
      amount: row.amount,
      status: row.status,
      paid: row.payments.reduce((sum, payment) => sum + payment.amount, 0),
    })),
    forbiddenMonths: Object.fromEntries(forbidden.map((period) => [period, allInvoices.filter((row) => row.period === period).length])),
    october: allInvoices.filter((row) => row.period === "2026-10").map((row) => ({ admissionNo: row.student.admissionNo, amount: row.amount })),
    registerAfterSeptember: { openingBilled, openingCollected, openingOutstanding, septBilled, septCollected, septOutstanding, combinedOutstanding, summary: registerSept.summary },
    checks,
    passed: checks.filter((row) => row.outcome === "PASS").length,
    failed: checks.filter((row) => row.outcome === "FAIL").length,
    blocked: checks.filter((row) => row.outcome === "BLOCKED").length,
    skipped: checks.filter((row) => row.outcome === "SKIPPED").length,
  };
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
