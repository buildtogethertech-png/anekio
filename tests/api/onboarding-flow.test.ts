import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AccessUser } from "../../lib/permissions";
import { parseCsv } from "../../lib/sheet";
import { seedPortalFixture } from "../support/factories";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase;
let prisma: PrismaClient;
let user: AccessUser;

function csvRow(values: unknown[]) {
  return values.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",");
}

function csvFromObjects(rows: Record<string, string>[]) {
  const headers = Object.keys(rows[0] || {});
  return `\uFEFF${[csvRow(headers), ...rows.map((row) => csvRow(headers.map((header) => row[header] || "")))].join("\r\n")}\r\n`;
}

describe("school onboarding imports", () => {
  beforeAll(async () => {
    database = createTestDatabase();
    process.env.UPLOADS_DIR = `${database.directory}/uploads`;
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    const fixture = await seedPortalFixture(prisma);
    const office = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.users.office.id },
      include: { role: { include: { grants: true } } },
    });
    user = {
      id: office.id,
      name: office.name,
      email: office.email,
      role: office.role.slug,
      roleName: office.role.name,
      roleId: office.roleId,
      portal: "OFFICE",
      permissions: office.role.grants.map((grant) => grant.permission),
      scopes: Object.fromEntries(office.role.grants.map((grant) => [grant.permission, grant.scope || "SCHOOL"])) as AccessUser["scopes"],
      isSystemRole: true,
    };
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("generates admission IDs, imports one opening balance, and starts recurring fees after its cut-off", async () => {
    const { onboardingTemplate, previewOnboardingImport, applyOnboardingImport } = await import("../../lib/onboarding");
    const { issueClassFeesCore } = await import("../../lib/core-office");
    const { saveUploadPath } = await import("../../lib/uploads");

    const studentsTemplate = await onboardingTemplate(user, "students");
    expect(studentsTemplate).toMatchObject({ fileName: "anekio-students.csv", contentType: "text/csv; charset=utf-8" });
    const studentCsv = studentsTemplate.buffer.toString("utf8");
    expect(studentCsv).toContain("Aarav Sharma (example)");
    expect(studentCsv).toContain('"YES"');
    const studentUploadPath = "private/schools/test/onboarding/imports/students.csv";
    await saveUploadPath(
      studentUploadPath,
      Buffer.from(`${studentCsv}${csvRow(["", "", "Kabir Student", "2015-04-12", "6-A", "Kavita Parent", "9876540099", "", ""])}\r\n`),
      "text/csv"
    );
    const studentPreview = await previewOnboardingImport(user, {
      kind: "students",
      uploadPath: studentUploadPath,
      fileName: "students.csv",
    });
    expect(studentPreview).toMatchObject({ rowCount: 2, validCount: 2, errors: [] });
    await applyOnboardingImport(user, { batchId: studentPreview.batchId });
    const kabir = await prisma.student.findFirstOrThrow({ where: { name: "Kabir Student" } });
    expect(kabir.admissionNo).toMatch(/^ANE-\d{5}$/);
    expect(await prisma.student.count({ where: { name: "Aarav Sharma (example)" } })).toBe(0);

    const generated = await onboardingTemplate(user, "opening_balances");
    expect(generated.fileName).toBe("anekio-opening-balances.csv");
    const openingRows = parseCsv(generated.buffer.toString("utf8"));
    const anayaRow = openingRows.find((row) => row.studentname === "Anaya Student")!;
    anayaRow.openingdueamount = "12345";
    anayaRow.duedate = "2026-08-31";
    anayaRow.generatedthrough = "2026-08";

    const uploadPath = "private/schools/test/onboarding/imports/opening.csv";
    await saveUploadPath(uploadPath, Buffer.from(csvFromObjects(openingRows)), "text/csv");

    const preview = await previewOnboardingImport(user, {
      kind: "opening_balances",
      uploadPath,
      fileName: "opening.csv",
    });
    expect(preview).toMatchObject({ rowCount: 2, validCount: 2, errors: [] });

    await applyOnboardingImport(user, { batchId: preview.batchId });
    const opening = await prisma.feeInvoice.findUniqueOrThrow({
      where: { studentId_period: { studentId: "student-anaya", period: "OPENING" } },
    });
    expect(opening).toMatchObject({ kind: "OPENING", amount: 12_345, generatedThrough: "2026-08" });
    expect((await prisma.student.findUniqueOrThrow({ where: { id: "student-anaya" } })).feeGeneratedThrough).toBe("2026-08");

    const template = await prisma.feeTemplate.create({
      data: {
        classId: "class-6-a",
        sessionId: "session-2026",
        name: "Monthly fee",
        startsPeriod: "2026-06",
        endsPeriod: "2026-09",
        lines: { create: [{ label: "Tuition", amount: 5000 }] },
      },
    });
    await issueClassFeesCore(user, { classId: "class-6-a", templateId: template.id });
    const periods = (await prisma.feeInvoice.findMany({
      where: { studentId: "student-anaya" },
      select: { period: true },
      orderBy: { period: "asc" },
    })).map((invoice) => invoice.period);
    expect(periods).toEqual(["2026-04", "2026-09", "OPENING"]);
  });
});
