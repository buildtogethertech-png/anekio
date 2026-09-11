import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AccessUser } from "../../lib/permissions";
import { seedPortalFixture } from "../support/factories";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase;
let prisma: PrismaClient;
let user: AccessUser;

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
    const studentWorkbook = new ExcelJS.Workbook();
    const studentSource = studentsTemplate.buffer.buffer.slice(
      studentsTemplate.buffer.byteOffset,
      studentsTemplate.buffer.byteOffset + studentsTemplate.buffer.byteLength
    ) as ArrayBuffer;
    await studentWorkbook.xlsx.load(studentSource);
    const studentSheet = studentWorkbook.getWorksheet("Students");
    studentSheet!.addRow(["", "", "Kabir Student", "2015-04-12", "6-A", "Kavita Parent", "9876540099", ""]);
    const studentUploadPath = "private/schools/test/onboarding/imports/students.xlsx";
    await saveUploadPath(
      studentUploadPath,
      Buffer.from(await studentWorkbook.xlsx.writeBuffer()),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    const studentPreview = await previewOnboardingImport(user, {
      kind: "students",
      uploadPath: studentUploadPath,
      fileName: "students.xlsx",
    });
    expect(studentPreview).toMatchObject({ rowCount: 2, validCount: 2, errors: [] });
    await applyOnboardingImport(user, { batchId: studentPreview.batchId });
    const kabir = await prisma.student.findFirstOrThrow({ where: { name: "Kabir Student" } });
    expect(kabir.admissionNo).toMatch(/^ANE-\d{5}$/);

    const generated = await onboardingTemplate(user, "opening_balances");
    expect(generated.fileName).toBe("anekio-opening-balances.xlsx");

    const workbook = new ExcelJS.Workbook();
    const source = generated.buffer.buffer.slice(
      generated.buffer.byteOffset,
      generated.buffer.byteOffset + generated.buffer.byteLength
    ) as ArrayBuffer;
    await workbook.xlsx.load(source);
    const sheet = workbook.getWorksheet("Opening balances");
    expect(sheet).toBeTruthy();
    const anayaRow = Array.from({ length: sheet!.rowCount - 1 }, (_, index) => index + 2)
      .find((row) => sheet!.getCell(row, 3).text === "Anaya Student")!;
    sheet!.getCell(anayaRow, 5).value = 12_345;
    sheet!.getCell(anayaRow, 6).value = "2026-08-31";
    sheet!.getCell(anayaRow, 7).value = "2026-08";

    const output = Buffer.from(await workbook.xlsx.writeBuffer());
    const uploadPath = "private/schools/test/onboarding/imports/opening.xlsx";
    await saveUploadPath(uploadPath, output, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    const preview = await previewOnboardingImport(user, {
      kind: "opening_balances",
      uploadPath,
      fileName: "opening.xlsx",
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
