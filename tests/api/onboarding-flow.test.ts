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

  it("generates a student workbook with one tab per class section", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { onboardingSpreadsheetTemplate, onboardingBundle } = await import("../../lib/onboarding");
    await prisma.class.upsert({
      where: { id: "class-7-b" },
      update: { name: "7", section: "B", archivedAt: null },
      create: { id: "class-7-b", name: "7", section: "B" },
    });

    const bundle = await onboardingBundle(user);
    const studentTemplate = bundle.templates.find((template) => template.kind === "students");
    expect(studentTemplate?.fileName).toBe("anekio-students.xlsx");

    const template = await onboardingSpreadsheetTemplate(user, "students");
    expect(template).toMatchObject({
      fileName: "anekio-students.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = template.buffer.buffer.slice(template.buffer.byteOffset, template.buffer.byteOffset + template.buffer.byteLength) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(expect.arrayContaining(["6-A", "7-B"]));

    const sheet = workbook.getWorksheet("7-B")!;
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual([
      "Student name",
      "Date of birth",
      "Class",
      "Parent name",
      "Parent mobile",
      "Parent email",
      "Example only",
    ]);
    expect(sheet.getRow(2).getCell(3).value).toBe("7-B");
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("generates a staff workbook with role and class dropdowns", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { onboardingSpreadsheetTemplate, onboardingBundle } = await import("../../lib/onboarding");

    const bundle = await onboardingBundle(user);
    const staffTemplate = bundle.templates.find((template) => template.kind === "teachers");
    expect(staffTemplate?.fileName).toBe("anekio-teachers.xlsx");

    const template = await onboardingSpreadsheetTemplate(user, "teachers");
    expect(template).toMatchObject({
      fileName: "anekio-teachers.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = template.buffer.buffer.slice(template.buffer.byteOffset, template.buffer.byteOffset + template.buffer.byteLength) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
    const sheet = workbook.getWorksheet("Teachers")!;
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual([
      "Name",
      "Mobile",
      "Email",
      "Role",
      "Class teacher of",
      "Monthly salary",
      "Qualification",
      "Example only",
    ]);
    expect(sheet.getCell("D2").dataValidation).toMatchObject({ type: "list" });
    expect(sheet.getCell("E2").dataValidation).toMatchObject({ type: "list" });
  });

  it("imports students from workbook tabs named as class sections and creates those classes", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { previewOnboardingImport, applyOnboardingImport } = await import("../../lib/onboarding");
    const { saveUploadPath } = await import("../../lib/uploads");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("8-Z");
    sheet.addRow(["Anekio student ID", "Admission number", "Student name", "Date of birth", "Parent name", "Parent mobile", "Parent email", "Example only"]);
    sheet.addRow(["", "", "Zoya Tab Student", "2014-02-10", "Zara Parent", "9876501234", "", ""]);
    const uploadPath = "private/schools/test/onboarding/imports/students-tabs.xlsx";
    await saveUploadPath(
      uploadPath,
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    const preview = await previewOnboardingImport(user, {
      kind: "students",
      uploadPath,
      fileName: "students-tabs.xlsx",
    });
    expect(preview).toMatchObject({ rowCount: 1, validCount: 1, errors: [] });

    await applyOnboardingImport(user, { batchId: preview.batchId });
    const klass = await prisma.class.findFirstOrThrow({ where: { name: "8", section: "Z" } });
    const student = await prisma.student.findFirstOrThrow({ where: { name: "Zoya Tab Student" } });
    expect(student.classId).toBe(klass.id);
    expect(student.admissionNo).toMatch(/^ANE-\d{5}$/);
  });

  it("imports staff roles from the teacher sheet and creates missing class teacher classes", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { previewOnboardingImport, applyOnboardingImport } = await import("../../lib/onboarding");
    const { saveUploadPath } = await import("../../lib/uploads");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Teachers");
    sheet.addRow(["Anekio teacher ID", "Employee ID", "Name", "Mobile", "Email", "Role", "Class teacher of", "Monthly salary", "Qualification", "Example only"]);
    sheet.addRow(["", "", "New Sheet Teacher", "9876505678", "", "TEACHER", "9-C", "41000", "M.Sc", ""]);
    sheet.addRow(["", "", "Sheet Fees Admin", "9876505679", "", "FEES", "", "32000", "Accounts", ""]);
    const uploadPath = "private/schools/test/onboarding/imports/teachers.xlsx";
    await saveUploadPath(
      uploadPath,
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    const preview = await previewOnboardingImport(user, {
      kind: "teachers",
      uploadPath,
      fileName: "teachers.xlsx",
    });
    expect(preview).toMatchObject({ rowCount: 2, validCount: 2, errors: [] });

    await applyOnboardingImport(user, { batchId: preview.batchId });
    const klass = await prisma.class.findFirstOrThrow({ where: { name: "9", section: "C" } });
    const teacher = await prisma.teacher.findFirstOrThrow({ where: { user: { name: "New Sheet Teacher" } }, include: { user: { include: { role: true } } } });
    expect(teacher.user.role.slug).toBe("TEACHER");
    expect(teacher.classId).toBe(klass.id);
    expect(teacher.monthlySalary).toBe(41000);
    await expect(prisma.teacherClass.findUniqueOrThrow({ where: { teacherId_classId: { teacherId: teacher.id, classId: klass.id } } })).resolves.toBeTruthy();

    const staff = await prisma.staffMember.findFirstOrThrow({ where: { name: "Sheet Fees Admin" }, include: { user: { include: { role: true } }, role: true } });
    expect(staff.role?.slug || staff.user?.role.slug).toBe("FEES");
    expect(staff.monthlySalary).toBe(32000);
  });

  it("assigns class teachers from the generated assignment template", async () => {
    const { onboardingTemplate, previewOnboardingImport, applyOnboardingImport } = await import("../../lib/onboarding");
    const { saveUploadPath } = await import("../../lib/uploads");
    const existingTeacher = await prisma.teacher.findFirstOrThrow({ include: { user: true }, orderBy: { employeeId: "asc" } });
    const template = await onboardingTemplate(user, "class_teachers");
    expect(template).toMatchObject({ fileName: "anekio-class-teachers.csv", contentType: "text/csv; charset=utf-8" });
    const rows = parseCsv(template.buffer.toString("utf8"));
    const assignment = rows.find((row) => row.class === "6-A")!;
    assignment.classteacheremployeeid = existingTeacher.employeeId;
    assignment.classteachername = "";
    assignment.exampleonly = "";
    const uploadPath = "private/schools/test/onboarding/imports/class-teachers.csv";
    await saveUploadPath(uploadPath, Buffer.from(csvFromObjects([assignment])), "text/csv");

    const preview = await previewOnboardingImport(user, {
      kind: "class_teachers",
      uploadPath,
      fileName: "class-teachers.csv",
    });
    expect(preview).toMatchObject({ rowCount: 1, validCount: 1, errors: [] });

    await applyOnboardingImport(user, { batchId: preview.batchId });
    const teacher = await prisma.teacher.findUniqueOrThrow({ where: { employeeId: existingTeacher.employeeId } });
    expect(teacher.classId).toBe("class-6-a");
  });

  it("creates the same class-section label in a different tenant", async () => {
    const { createClassCore } = await import("../../lib/core-actions");
    const { runWithoutTenant, setTenantOrg } = await import("../../lib/tenant-context");

    await prisma.class.create({ data: { name: "1", section: "A", orgId: "org-existing" } });
    await runWithoutTenant(async () => {
      setTenantOrg("org-new");
      await createClassCore({ ...user, orgId: "org-new" }, { name: "1", section: "A", subjects: [] });
    });

    const rows = await prisma.class.findMany({
      where: { name: "1", section: "A" },
      select: { orgId: true },
      orderBy: { orgId: "asc" },
    });
    expect(rows).toEqual([{ orgId: "org-existing" }, { orgId: "org-new" }]);
  });
});
