import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AccessUser } from "../../lib/permissions";
import { seedPortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase;
let prisma: PrismaClient;
let user: AccessUser;

describe("onboarding student roll import", () => {
  beforeAll(async () => {
    database = createPushedTestDatabase();
    process.env.UPLOADS_DIR = `${database.directory}/uploads`;
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    const fixture = await seedPortalFixture(prisma);
    const org = await prisma.saasOrg.create({
      data: {
        id: "org-onboarding-roll",
        schoolName: "Fixture Academy",
        ownerName: "Ojas Office",
        ownerEmail: "office.fixture@school.test",
        ownerPhone: "9876540001",
      },
    });
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
      orgId: org.id,
      portal: "OFFICE",
      permissions: office.role.grants.map((grant) => grant.permission),
      scopes: Object.fromEntries(office.role.grants.map((grant) => [grant.permission, grant.scope || "SCHOOL"])) as AccessUser["scopes"],
      isSystemRole: true,
    };
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("puts roll number first in the template and test data, and applies those rolls", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { onboardingSpreadsheetTemplate, previewOnboardingImport, applyOnboardingImport } = await import("../../lib/onboarding");
    const { saveUploadPath } = await import("../../lib/uploads");

    const blank = await onboardingSpreadsheetTemplate(user, "students");
    const blankBook = new ExcelJS.Workbook();
    await blankBook.xlsx.load(blank.buffer.buffer.slice(blank.buffer.byteOffset, blank.buffer.byteOffset + blank.buffer.byteLength) as ArrayBuffer);
    const blankSheet = blankBook.worksheets[0]!;
    expect((blankSheet.getRow(1).values as unknown[]).slice(1, 3)).toEqual(["Roll number", "Student name"]);
    expect(blankSheet.getRow(2).getCell(1).value).toBe(1);

    const sample = await onboardingSpreadsheetTemplate(user, "students", { sampleData: true });
    const sampleBook = new ExcelJS.Workbook();
    await sampleBook.xlsx.load(sample.buffer.buffer.slice(sample.buffer.byteOffset, sample.buffer.byteOffset + sample.buffer.byteLength) as ArrayBuffer);
    const sampleSheet = sampleBook.getWorksheet("6-A")!;
    expect(String(sampleSheet.getRow(1).getCell(1).value)).toBe("Roll number");
    const sampleRolls = (sampleSheet.getRows(2, Math.max(0, sampleSheet.rowCount - 1)) || [])
      .map((row) => Number(row.getCell(1).value))
      .filter((value) => Number.isFinite(value) && value > 0);
    expect(sampleRolls[0]).toBe(1);
    expect(sampleRolls.length).toBeGreaterThan(0);
    expect(new Set(sampleRolls).size).toBe(sampleRolls.length);
    expect(sampleRolls).toEqual([...sampleRolls].sort((a, b) => a - b));
    const exampleFlags = (sampleSheet.getRows(2, Math.max(0, sampleSheet.rowCount - 1)) || [])
      .map((row) => String(row.getCell(sampleSheet.columnCount).value || "").toLowerCase());
    expect(exampleFlags.some((flag) => flag === "yes")).toBe(false);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("6-A");
    sheet.addRow(["Roll number", "Student name", "Date of birth", "Parent name", "Parent mobile", "Parent email", "Example only"]);
    sheet.addRow(["12", "Roll Twelve Student", "2014-02-10", "Zara Parent", "9876508881", "", ""]);
    sheet.addRow(["15", "Roll Fifteen Student", "2014-03-11", "Anita Parent", "9876508882", "", ""]);
    const uploadPath = "private/schools/test/onboarding/imports/students-rolls.xlsx";
    await saveUploadPath(
      uploadPath,
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    const preview = await previewOnboardingImport(user, { kind: "students", uploadPath, fileName: "students-rolls.xlsx" });
    expect(preview).toMatchObject({ rowCount: 2, validCount: 2, errors: [] });
    await applyOnboardingImport(user, { batchId: preview.batchId });
    const klass = await prisma.class.findFirstOrThrow({ where: { name: "6", section: "A" } });
    const rolls = await prisma.studentClassEnrollment.findMany({
      where: { classId: klass.id, student: { name: { in: ["Roll Twelve Student", "Roll Fifteen Student"] } } },
      include: { student: true },
      orderBy: { rollNumber: "asc" },
    });
    expect(rolls.map((row) => [row.student.name, row.rollNumber])).toEqual([
      ["Roll Twelve Student", 12],
      ["Roll Fifteen Student", 15],
    ]);
  }, 30_000);

  it("rejects two students in the same class with the same roll number", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { previewOnboardingImport } = await import("../../lib/onboarding");
    const { saveUploadPath } = await import("../../lib/uploads");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("6-A");
    sheet.addRow(["Roll number", "Student name", "Date of birth", "Parent name", "Parent mobile", "Parent email", "Example only"]);
    sheet.addRow(["3", "Same Roll A", "2014-02-10", "Parent A", "9876507771", "", ""]);
    sheet.addRow(["3", "Same Roll B", "2014-03-11", "Parent B", "9876507772", "", ""]);
    const uploadPath = "private/schools/test/onboarding/imports/students-dup-roll.xlsx";
    await saveUploadPath(
      uploadPath,
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    const preview = await previewOnboardingImport(user, { kind: "students", uploadPath, fileName: "students-dup-roll.xlsx" });
    expect(preview.validCount).toBe(1);
    expect(preview.errors.join(" ")).toMatch(/roll 3 is already used/i);
  }, 20_000);
});
