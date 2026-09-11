import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { InvoiceStatus, type Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { can, type AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { normalizeMobile } from "./phone";
import { roleIdBySlug } from "./roles";
import { parseClassLabel, parseCsv } from "./sheet";
import { readUpload } from "./uploads";

const ONBOARDING_STATE_ID = "school";
export const IMPORT_KINDS = ["classes", "students", "teachers", "class_teachers", "opening_balances"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
type ImportRow = Record<string, string> & { _row: string };
type OnboardingDb = Prisma.TransactionClient;

const TEMPLATE_DETAILS: Record<ImportKind, { sheet: string; file: string; title: string }> = {
  classes: { sheet: "Classes", file: "anekio-classes.csv", title: "Classes and sections" },
  students: { sheet: "Students", file: "anekio-students.csv", title: "Students and parents" },
  teachers: { sheet: "Teachers", file: "anekio-teachers.csv", title: "Teachers" },
  class_teachers: { sheet: "Class teachers", file: "anekio-class-teachers.csv", title: "Class teacher assignments" },
  opening_balances: { sheet: "Opening balances", file: "anekio-opening-balances.csv", title: "Opening fee balances" },
};

function need(user: AccessUser) {
  if (!can(user, "onboarding.manage")) throw new Error("No access.");
}

function asKind(value: unknown): ImportKind {
  const kind = String(value || "") as ImportKind;
  if (!IMPORT_KINDS.includes(kind)) throw new Error("Choose a valid onboarding template.");
  return kind;
}

function normalizeHeader(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function dateText(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return dateText(value);
  if (typeof value === "object") {
    if ("result" in value && value.result != null) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text || "");
  }
  return String(value).trim();
}

function monthBefore(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 0).toISOString().slice(0, 7);
}

function validPeriod(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function parseClass(value: string) {
  const parsed = parseClassLabel(value);
  if (parsed) return parsed;
  const parts = value.trim().split(/\s*[-/]\s*/);
  if (parts.length >= 2 && parts[0] && parts[1]) return { name: parts[0], section: parts.slice(1).join("-").toUpperCase() };
  return null;
}

function sheetCell(row: ImportRow, ...keys: string[]) {
  for (const key of keys) {
    const value = row[normalizeHeader(key)];
    if (value) return value.trim();
  }
  return "";
}

type CsvCell = string | number;

function csvBuffer(rows: CsvCell[][]) {
  const encoded = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
  return Buffer.from(`\uFEFF${encoded.join("\r\n")}\r\n`, "utf8");
}

async function csvRowsFor(kind: ImportKind): Promise<CsvCell[][]> {
  const classes = await prisma.class.findMany({
    where: { archivedAt: null },
    orderBy: [{ name: "asc" }, { section: "asc" }],
  });
  const classLabels = classes.map((row) => `${row.name}-${row.section}`);

  if (kind === "classes") {
    return [
      ["Anekio class ID", "Class name", "Section", "Example only"],
      ["", "1", "A", "YES"],
      ...classes.map((row) => [row.id, row.name, row.section, ""]),
    ];
  }

  if (kind === "students") {
    const students = await prisma.student.findMany({
      include: { class: true, parent: { include: { user: true } } },
      orderBy: { name: "asc" },
    });
    return [
      ["Anekio student ID", "Admission number", "Student name", "Date of birth", "Class", "Parent name", "Parent mobile", "Parent email", "Example only"],
      ["", "", "Aarav Sharma (example)", "2015-04-12", classLabels[0] || "1-A", "Neha Sharma", "9876543210", "parent@example.com", "YES"],
      ...students.map((student) => [
        student.id,
        student.admissionNo,
        student.name,
        dateText(student.dateOfBirth),
        `${student.class.name}-${student.class.section}`,
        student.parent.user.name,
        student.parent.phone || student.parent.user.phone || "",
        student.parent.user.email.endsWith("@local.anekio.invalid") ? "" : student.parent.user.email,
        "",
      ]),
    ];
  }

  if (kind === "teachers") {
    const teachers = await prisma.teacher.findMany({ include: { user: true }, orderBy: { user: { name: "asc" } } });
    return [
      ["Anekio teacher ID", "Employee ID", "Teacher name", "Mobile", "Email", "Qualification", "Example only"],
      ["", "", "Meera Singh (example)", "9876543211", "teacher@example.com", "B.Ed, Mathematics", "YES"],
      ...teachers.map((teacher) => [
        teacher.id,
        teacher.employeeId,
        teacher.user.name,
        teacher.user.phone || "",
        teacher.user.email.endsWith("@local.anekio.invalid") ? "" : teacher.user.email,
        teacher.qualification || "",
        "",
      ]),
    ];
  }

  if (kind === "class_teachers") {
    const teachers = await prisma.teacher.findMany({ include: { user: true }, orderBy: { user: { name: "asc" } } });
    const teacherLabels = teachers.map((teacher) => `${teacher.employeeId} · ${teacher.user.name}`);
    return [
      ["Class", "Class teacher employee ID", "Class teacher name", "Example only"],
      [classLabels[0] || "1-A", teachers[0]?.employeeId || "T-101", teachers[0]?.user.name || "Meera Singh (example)", "YES"],
      ...classes.map((klass, index) => {
        const teacher = teachers[index] || null;
        return [`${klass.name}-${klass.section}`, teacher?.employeeId || "", teacher?.user.name || "", ""];
      }),
      ...(teacherLabels.length ? [["Available teachers", teacherLabels.join("; "), "", "YES"] as CsvCell[]] : []),
    ];
  }

  const students = await prisma.student.findMany({ include: { class: true }, orderBy: { name: "asc" } });
  const opening = await prisma.feeInvoice.findMany({ where: { period: "OPENING" }, include: { payments: true } });
  const openingByStudent = new Map(opening.map((row) => [row.studentId, row]));
  const defaultThrough = monthBefore();
  return [
    ["Anekio student ID", "Admission number", "Student name", "Class", "Opening due amount", "Due date", "Generated through", "Example only"],
    ["", "", "Aarav Sharma (example)", classLabels[0] || "1-A", 2500, dateText(new Date()), defaultThrough, "YES"],
    ...students.map((student) => {
    const current = openingByStudent.get(student.id);
    const paid = current?.payments.reduce((total, payment) => total + payment.amount, 0) || 0;
      return [
      student.id,
      student.admissionNo,
      student.name,
      `${student.class.name}-${student.class.section}`,
      current ? Math.max(0, current.amount - paid) : 0,
      current ? dateText(current.dueDate) : dateText(new Date()),
      student.feeGeneratedThrough || current?.generatedThrough || defaultThrough,
        "",
      ];
    }),
  ];
}

export async function onboardingTemplate(user: AccessUser, rawKind: string) {
  need(user);
  const kind = asKind(rawKind);
  return {
    fileName: TEMPLATE_DETAILS[kind].file,
    contentType: "text/csv; charset=utf-8",
    buffer: csvBuffer(await csvRowsFor(kind)),
  };
}

export async function onboardingSpreadsheetTemplate(user: AccessUser, rawKind: string) {
  need(user);
  const kind = asKind(rawKind);
  if (kind !== "students") return onboardingTemplate(user, kind);
  const classes = await prisma.class.findMany({
    where: { archivedAt: null },
    orderBy: [{ name: "asc" }, { section: "asc" }],
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Anekio";
  const labels = classes.length ? classes.map((row) => `${row.name}-${row.section}`) : ["1-A", "1-B", "1-C"];
  const headers = ["Anekio student ID", "Admission number", "Student name", "Date of birth", "Parent name", "Parent mobile", "Parent email", "Example only"];
  labels.forEach((label, index) => {
    const sheet = workbook.addWorksheet(label);
    sheet.addRow(headers);
    sheet.addRow(["", "", index === 0 ? "Aarav Sharma (example)" : "", "2015-04-12", "Neha Sharma", "9876543210", "parent@example.com", "YES"]);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.columns = headers.map((header) => ({ header, key: normalizeHeader(header), width: Math.max(18, header.length + 2) }));
    sheet.getRow(1).font = { bold: true };
  });
  return {
    fileName: "anekio-students.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}

function realRows(rows: ImportRow[]) {
  return rows.filter((row) => !["yes", "true", "sample", "example"].includes(sheetCell(row, "Example only", "Row type").toLowerCase()));
}

export function rowsFromCsvContent(csv: string): ImportRow[] {
  return realRows(parseCsv(csv).map((row, index) => ({ ...row, _row: String(index + 2) })));
}

function rowsFromWorksheet(sheet: ExcelJS.Worksheet, classLabel = "") {
  const headers = new Map<number, string>();
  sheet.getRow(1).eachCell((cell, column) => headers.set(column, normalizeHeader(cellText(cell.value))));
  const rows: ImportRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: ImportRow = { _row: classLabel ? `${sheet.name}!${rowNumber}` : String(rowNumber) };
    headers.forEach((header, column) => {
      if (header) record[header] = cellText(row.getCell(column).value);
    });
    if (classLabel && !sheetCell(record, "Class")) record[normalizeHeader("Class")] = classLabel;
    if (Object.entries(record).some(([key, value]) => key !== "_row" && value.trim())) rows.push(record);
  });
  return rows;
}

export async function rowsFromWorkbookBuffer(kind: ImportKind, buf: Buffer): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  if (kind === "students") {
    const studentsSheet = workbook.getWorksheet(TEMPLATE_DETAILS.students.sheet);
    const sheets = studentsSheet
      ? [studentsSheet]
      : workbook.worksheets.filter((sheet) => Boolean(parseClass(sheet.name)));
    if (!sheets.length) throw new Error("This workbook needs a Students sheet, or tabs named like 1-A, 1-B, 2-C.");
    return realRows(sheets.flatMap((sheet) => rowsFromWorksheet(sheet, studentsSheet ? "" : sheet.name)));
  }
  const sheet = workbook.getWorksheet(TEMPLATE_DETAILS[kind].sheet);
  if (!sheet) throw new Error(`This workbook has no “${TEMPLATE_DETAILS[kind].sheet}” sheet. Download the current Anekio template.`);
  return realRows(rowsFromWorksheet(sheet));
}

async function rowsFromUpload(kind: ImportKind, uploadPath: string): Promise<ImportRow[]> {
  if (!uploadPath.includes("/onboarding/imports/") || uploadPath.includes("..")) throw new Error("Use a file uploaded from School setup.");
  const { buf, type } = await readUpload(uploadPath);
  if (type === "text/csv" || uploadPath.toLowerCase().endsWith(".csv")) {
    return rowsFromCsvContent(buf.toString("utf8"));
  }
  return rowsFromWorkbookBuffer(kind, buf);
}

function rowError(row: ImportRow, message: string) {
  return `Row ${row._row}: ${message}`;
}

async function validateRows(kind: ImportKind, rows: ImportRow[]) {
  const errors: string[] = [];
  const classes = await prisma.class.findMany({ where: { archivedAt: null } });
  const classKeys = new Set(classes.map((row) => `${row.name}-${row.section}`.toLowerCase()));
  const students = kind === "opening_balances" || kind === "students"
    ? await prisma.student.findMany({ select: { id: true, admissionNo: true } })
    : [];
  const studentIds = new Set(students.map((row) => row.id));
  const admissionNos = new Set(students.map((row) => row.admissionNo.toLowerCase()));

  rows.forEach((row) => {
    if (kind === "classes") {
      const name = sheetCell(row, "Class name", "Class");
      const section = sheetCell(row, "Section");
      if (!name || !section) errors.push(rowError(row, "class name and section are required."));
      return;
    }
    if (kind === "students") {
      const name = sheetCell(row, "Student name", "Name");
      const dob = sheetCell(row, "Date of birth", "DOB");
      const klass = parseClass(sheetCell(row, "Class"));
      const phone = normalizeMobile(sheetCell(row, "Parent mobile", "Parent phone"));
      const studentId = sheetCell(row, "Anekio student ID");
      const admissionNo = sheetCell(row, "Admission number", "Admission no").toLowerCase();
      if (!name) errors.push(rowError(row, "student name is required."));
      if (!validDate(dob)) errors.push(rowError(row, "date of birth must be YYYY-MM-DD."));
      if (!klass) errors.push(rowError(row, "class must be a value like 1-A."));
      if (!sheetCell(row, "Parent name")) errors.push(rowError(row, "parent name is required."));
      if (!phone) errors.push(rowError(row, "parent mobile must be a 10-digit number."));
      if (studentId && !studentIds.has(studentId)) errors.push(rowError(row, "Anekio student ID was not found."));
      if (!studentId && admissionNo && admissionNos.has(admissionNo)) {
        // An admission number is a safe update key, so this row is valid.
      }
      return;
    }
    if (kind === "teachers") {
      if (!sheetCell(row, "Teacher name", "Name")) errors.push(rowError(row, "teacher name is required."));
      if (!normalizeMobile(sheetCell(row, "Mobile", "Phone"))) errors.push(rowError(row, "mobile must be a 10-digit number."));
      return;
    }
    if (kind === "class_teachers") {
      const classText = sheetCell(row, "Class");
      const employeeId = sheetCell(row, "Class teacher employee ID", "Employee ID", "Teacher employee ID");
      const teacherName = sheetCell(row, "Class teacher name", "Teacher name");
      const klass = parseClass(classText);
      if (!klass || !classKeys.has(`${klass.name}-${klass.section}`.toLowerCase())) errors.push(rowError(row, "class must use an existing class like 1-A."));
      if (!employeeId && !teacherName) errors.push(rowError(row, "teacher employee ID or teacher name is required."));
      return;
    }
    const studentId = sheetCell(row, "Anekio student ID");
    const admissionNo = sheetCell(row, "Admission number", "Admission no").toLowerCase();
    const amount = Number(sheetCell(row, "Opening due amount", "Due amount", "Amount"));
    const dueDate = sheetCell(row, "Due date");
    const through = sheetCell(row, "Generated through", "Last generated month");
    if ((!studentId || !studentIds.has(studentId)) && (!admissionNo || !admissionNos.has(admissionNo))) {
      errors.push(rowError(row, "student ID or admission number was not found."));
    }
    if (!Number.isFinite(amount) || amount < 0) errors.push(rowError(row, "opening due amount must be zero or more."));
    if (!validDate(dueDate)) errors.push(rowError(row, "due date must be YYYY-MM-DD."));
    if (!validPeriod(through)) errors.push(rowError(row, "generated through must be YYYY-MM."));
  });
  return errors;
}

async function ensureState() {
  return prisma.schoolOnboardingState.upsert({
    where: { id: ONBOARDING_STATE_ID },
    update: {},
    create: { id: ONBOARDING_STATE_ID },
  });
}

export async function previewOnboardingImport(user: AccessUser, input: { kind?: string; uploadPath?: string; fileName?: string }) {
  need(user);
  const kind = asKind(input.kind);
  const uploadPath = String(input.uploadPath || "");
  if (!uploadPath) throw new Error("Upload a completed template first.");
  const rows = await rowsFromUpload(kind, uploadPath);
  return previewOnboardingRows(user, {
    kind,
    fileName: String(input.fileName || TEMPLATE_DETAILS[kind].file),
    uploadPath,
    rows,
  });
}

export async function previewOnboardingRows(
  user: AccessUser,
  input: { kind: ImportKind; fileName: string; uploadPath: string; rows: ImportRow[] }
) {
  need(user);
  const kind = asKind(input.kind);
  const rows = input.rows;
  if (!rows.length) throw new Error("No data rows found. Add school data below the example row, or copy it and clear Example only.");
  const errors = await validateRows(kind, rows);
  await ensureState();
  const batch = await prisma.schoolOnboardingImport.create({
    data: {
      stateId: ONBOARDING_STATE_ID,
      kind,
      fileName: input.fileName || TEMPLATE_DETAILS[kind].file,
      uploadPath: input.uploadPath,
      rowsJson: JSON.stringify(rows),
      errorsJson: JSON.stringify(errors),
    },
  });
  return {
    batchId: batch.id,
    kind,
    rowCount: rows.length,
    validCount: errors.length ? Math.max(0, rows.length - new Set(errors.map((error) => error.match(/^Row (\d+)/)?.[1])).size) : rows.length,
    errors,
    sample: rows.slice(0, 5),
  };
}

function placeholderEmail(kind: "parent" | "teacher", phone: string) {
  return `${kind}.${phone}@local.anekio.invalid`;
}

async function applyClasses(db: OnboardingDb, rows: ImportRow[]) {
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const id = sheetCell(row, "Anekio class ID");
    const name = sheetCell(row, "Class name", "Class");
    const section = sheetCell(row, "Section").toUpperCase();
    const existing = id
      ? await db.class.findUnique({ where: { id } })
      : await db.class.findUnique({ where: { name_section: { name, section } } });
    if (existing) {
      await db.class.update({ where: { id: existing.id }, data: { name, section, archivedAt: null } });
      updated += 1;
    } else {
      await db.class.create({ data: { name, section } });
      created += 1;
    }
  }
  return { created, updated };
}

async function nextCodes() {
  const [students, teachers] = await Promise.all([
    prisma.student.findMany({ select: { admissionNo: true } }),
    prisma.teacher.findMany({ select: { employeeId: true } }),
  ]);
  const studentNumbers = students.map((row) => Number(row.admissionNo.replace(/\D/g, ""))).filter(Number.isFinite);
  const teacherNumbers = teachers.map((row) => Number(row.employeeId.replace(/\D/g, ""))).filter(Number.isFinite);
  return {
    admission: (studentNumbers.length ? Math.max(...studentNumbers) : 0) + 1,
    employee: (teacherNumbers.length ? Math.max(...teacherNumbers) : 100) + 1,
  };
}

async function applyStudents(
  db: OnboardingDb,
  rows: ImportRow[],
  setup: { roleId: string; password: string; admission: number }
) {
  let created = 0;
  let updated = 0;
  let nextAdmission = setup.admission;
  for (const row of rows) {
    const klass = parseClass(sheetCell(row, "Class"))!;
    const classRow = await db.class.upsert({
      where: { name_section: { name: klass.name, section: klass.section } },
      update: { archivedAt: null },
      create: { name: klass.name, section: klass.section },
    });
    const phone = normalizeMobile(sheetCell(row, "Parent mobile", "Parent phone"));
    const suppliedEmail = sheetCell(row, "Parent email").toLowerCase();
    const email = suppliedEmail || placeholderEmail("parent", phone);
    const user = await db.user.findFirst({ where: { OR: [{ email }, { phone }] }, include: { parent: true } });
    let parentId = user?.parent?.id || "";
    if (user && !parentId) throw new Error(rowError(row, `${user.email} is already used by a non-parent account.`));
    if (!parentId) {
      const parentUser = await db.user.create({
        data: {
          name: sheetCell(row, "Parent name"),
          email,
          phone,
          password: setup.password,
          roleId: setup.roleId,
          parent: { create: { phone } },
        },
        include: { parent: true },
      });
      parentId = parentUser.parent!.id;
    } else if (user) {
      await db.user.update({ where: { id: user.id }, data: { name: sheetCell(row, "Parent name") || user.name } });
    }
    const studentId = sheetCell(row, "Anekio student ID");
    let admissionNo = sheetCell(row, "Admission number", "Admission no");
    const existing = studentId
      ? await db.student.findUnique({ where: { id: studentId } })
      : admissionNo
        ? await db.student.findUnique({ where: { admissionNo } })
        : null;
    if (!admissionNo) {
      do {
        admissionNo = `ANE-${String(nextAdmission).padStart(5, "0")}`;
        nextAdmission += 1;
      } while (await db.student.findUnique({ where: { admissionNo }, select: { id: true } }));
    }
    const data = {
      name: sheetCell(row, "Student name", "Name"),
      admissionNo,
      dateOfBirth: new Date(`${sheetCell(row, "Date of birth", "DOB")}T00:00:00`),
      classId: classRow.id,
      parentId,
    };
    if (existing) {
      await db.student.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await db.student.create({ data });
      created += 1;
    }
  }
  return { created, updated };
}

async function applyTeachers(
  db: OnboardingDb,
  rows: ImportRow[],
  setup: { roleId: string; password: string; employee: number }
) {
  let created = 0;
  let updated = 0;
  let nextEmployee = setup.employee;
  for (const row of rows) {
    const phone = normalizeMobile(sheetCell(row, "Mobile", "Phone"));
    const email = sheetCell(row, "Email").toLowerCase() || placeholderEmail("teacher", phone);
    const teacherId = sheetCell(row, "Anekio teacher ID");
    let employeeId = sheetCell(row, "Employee ID");
    const existing = teacherId
      ? await db.teacher.findUnique({ where: { id: teacherId }, include: { user: true } })
      : employeeId
        ? await db.teacher.findUnique({ where: { employeeId }, include: { user: true } })
        : await db.teacher.findFirst({ where: { user: { OR: [{ email }, { phone }] } }, include: { user: true } });
    if (!employeeId) {
      do {
        employeeId = `T-${nextEmployee}`;
        nextEmployee += 1;
      } while (await db.teacher.findUnique({ where: { employeeId }, select: { id: true } }));
    }
    if (existing) {
      await db.user.update({ where: { id: existing.userId }, data: { name: sheetCell(row, "Teacher name", "Name"), email, phone } });
      await db.teacher.update({
        where: { id: existing.id },
        data: { employeeId, qualification: sheetCell(row, "Qualification") || null },
      });
      updated += 1;
    } else {
      await db.user.create({
        data: {
          name: sheetCell(row, "Teacher name", "Name"),
          email,
          phone,
          password: setup.password,
          roleId: setup.roleId,
          teacher: {
            create: {
              employeeId,
              qualification: sheetCell(row, "Qualification") || null,
            },
          },
        },
      });
      created += 1;
    }
  }
  return { created, updated };
}

async function applyClassTeachers(db: OnboardingDb, rows: ImportRow[]) {
  let updated = 0;
  for (const row of rows) {
    const klass = parseClass(sheetCell(row, "Class"))!;
    const classRow = await db.class.findUnique({ where: { name_section: klass } });
    if (!classRow) throw new Error(rowError(row, "class no longer exists."));
    const employeeId = sheetCell(row, "Class teacher employee ID", "Employee ID", "Teacher employee ID");
    const teacherName = sheetCell(row, "Class teacher name", "Teacher name");
    const teacher = employeeId
      ? await db.teacher.findUnique({ where: { employeeId }, include: { user: true } })
      : await db.teacher.findFirst({ where: { user: { name: { equals: teacherName } } }, include: { user: true } });
    if (!teacher) throw new Error(rowError(row, "teacher no longer exists."));
    await db.teacher.update({ where: { id: teacher.id }, data: { classId: classRow.id } });
    updated += 1;
  }
  return { created: 0, updated };
}

async function applyOpeningBalances(db: OnboardingDb, rows: ImportRow[], orgId?: string | null) {
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const studentId = sheetCell(row, "Anekio student ID");
    const admissionNo = sheetCell(row, "Admission number", "Admission no");
    const student = studentId
      ? await db.student.findUnique({ where: { id: studentId } })
      : await db.student.findUnique({ where: { admissionNo } });
    if (!student) throw new Error(rowError(row, "student no longer exists."));
    const amount = Math.round(Number(sheetCell(row, "Opening due amount", "Due amount", "Amount")));
    const generatedThrough = sheetCell(row, "Generated through", "Last generated month");
    const dueDate = new Date(`${sheetCell(row, "Due date")}T00:00:00`);
    const existing = await db.feeInvoice.findUnique({
      where: { studentId_period: { studentId: student.id, period: "OPENING" } },
      include: { payments: true },
    });
    const paid = existing?.payments.reduce((total, payment) => total + payment.amount, 0) || 0;
    if (amount < paid) throw new Error(rowError(row, `opening balance cannot be below ₹${paid} already collected.`));
    if (existing) {
      await db.feeInvoice.update({
        where: { id: existing.id },
        data: {
          kind: "OPENING",
          generatedThrough,
          title: "Opening balance",
          amount,
          linesJson: JSON.stringify([{ label: "Opening balance", kind: "FLAT", amount }]),
          dueDate,
          classId: student.classId,
          status: amount <= paid ? InvoiceStatus.PAID : paid ? InvoiceStatus.PARTIAL : InvoiceStatus.DUE,
        },
      });
      updated += 1;
    } else if (amount > 0) {
      await db.feeInvoice.create({
        data: {
          orgId: orgId ?? null,
          studentId: student.id,
          classId: student.classId,
          period: "OPENING",
          kind: "OPENING",
          generatedThrough,
          title: "Opening balance",
          amount,
          linesJson: JSON.stringify([{ label: "Opening balance", kind: "FLAT", amount }]),
          dueDate,
          shareToken: randomUUID(),
          status: InvoiceStatus.DUE,
        },
      });
      created += 1;
    }
    await db.student.update({
      where: { id: student.id },
      data: { feeGeneratedThrough: student.feeGeneratedThrough > generatedThrough ? student.feeGeneratedThrough : generatedThrough },
    });
  }
  return { created, updated };
}

export async function applyOnboardingImport(user: AccessUser, input: { batchId?: string }) {
  need(user);
  const batchId = String(input.batchId || "");
  const batch = await prisma.schoolOnboardingImport.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("Import review not found.");
  if (batch.status === "APPLIED") throw new Error("This import was already applied.");
  const errors = JSON.parse(batch.errorsJson) as string[];
  if (errors.length) throw new Error("Fix the review errors and upload the template again.");
  const kind = asKind(batch.kind);
  const rows = JSON.parse(batch.rowsJson) as ImportRow[];
  try {
    const codes = kind === "students" || kind === "teachers" ? await nextCodes() : null;
    const peopleSetup = kind === "students"
      ? { roleId: await roleIdBySlug("PARENT"), password: await bcrypt.hash("12345", 10), admission: codes!.admission }
      : kind === "teachers"
        ? { roleId: await roleIdBySlug("TEACHER"), password: await bcrypt.hash("12345", 10), employee: codes!.employee }
        : null;
    const result = await prisma.$transaction(async (db) => kind === "classes"
      ? applyClasses(db, rows)
      : kind === "students"
        ? applyStudents(db, rows, peopleSetup as { roleId: string; password: string; admission: number })
        : kind === "teachers"
          ? applyTeachers(db, rows, peopleSetup as { roleId: string; password: string; employee: number })
          : kind === "class_teachers"
            ? applyClassTeachers(db, rows)
            : applyOpeningBalances(db, rows, user.orgId));
    await prisma.schoolOnboardingImport.update({
      where: { id: batch.id },
      data: { status: "APPLIED", appliedAt: new Date(), createdCount: result.created, updatedCount: result.updated },
    });
    return { ...result, batchId: batch.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    await prisma.schoolOnboardingImport.update({
      where: { id: batch.id },
      data: { status: "FAILED", errorsJson: JSON.stringify([message]) },
    });
    throw error;
  }
}

export async function saveOnboardingPlan(user: AccessUser, input: { modules?: unknown }) {
  need(user);
  const requested = Array.isArray(input.modules) ? input.modules.map(String) : [];
  const allowed = ["students", "teachers", "fees"];
  const modules = [...new Set(requested.filter((item) => allowed.includes(item)))];
  if (!modules.length) throw new Error("Choose at least one onboarding area.");
  const state = await prisma.schoolOnboardingState.upsert({
    where: { id: ONBOARDING_STATE_ID },
    update: { selectedModulesJson: JSON.stringify(modules) },
    create: { id: ONBOARDING_STATE_ID, selectedModulesJson: JSON.stringify(modules) },
  });
  return { modules: JSON.parse(state.selectedModulesJson) as string[] };
}

export async function onboardingBundle(user: AccessUser) {
  need(user);
  const [state, school, classCount, studentCount, teacherCount, templateCount, openingCount, latestImports, latestSheets] = await Promise.all([
    prisma.schoolOnboardingState.findUnique({ where: { id: ONBOARDING_STATE_ID } }),
    prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { name: true } }),
    prisma.class.count({ where: { archivedAt: null } }),
    prisma.student.count(),
    prisma.teacher.count(),
    prisma.feeTemplate.count(),
    prisma.feeInvoice.count({ where: { period: "OPENING" } }),
    prisma.schoolOnboardingImport.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.onboardingGoogleSheet.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const modules = state ? JSON.parse(state.selectedModulesJson) as string[] : ["students", "fees"];
  const importDone = new Set(latestImports.filter((row) => row.status === "APPLIED").map((row) => row.kind));
  const wants = (module: string) => modules.includes(module);
  const step = (key: string, number: number, title: string, body: string, complete: boolean, blocked = false, optional = false) => ({
    key,
    number,
    title,
    body,
    status: complete ? "complete" : optional ? "optional" : blocked ? "blocked" : "ready",
  });
  const steps = [
    step("school", 1, "School identity", "Confirm school name, session, contact details, and branding in Settings.", Boolean(school?.name && school.name !== "School")),
    step("classes", 2, "Classes and sections", "Create the structure that student and teacher files will reference.", classCount > 0 || importDone.has("classes")),
    step("students", 3, "Students and parents", "Import family records with generated admission numbers when needed.", studentCount > 0 || importDone.has("students"), classCount === 0, !wants("students")),
    step("teachers", 4, "Teachers", "Import staff records first; assignments come from the next generated template.", teacherCount > 0 || importDone.has("teachers"), classCount === 0, !wants("teachers")),
    step("class_teachers", 5, "Class teacher assignments", "Generated after classes and staff exist, so the team only chooses who owns each class.", importDone.has("class_teachers"), classCount === 0 || teacherCount === 0, !wants("teachers")),
    step("opening_balances", 6, "Opening fee balances", "One consolidated due per student, with the old system's last generated month.", importDone.has("opening_balances") || (studentCount > 0 && openingCount >= studentCount), studentCount === 0, !wants("fees")),
    step("recurring_fees", 7, "Recurring fee rules", "Set class fee ranges. New invoices begin after each student's imported cut-off month.", templateCount > 0, classCount === 0, !wants("fees")),
    step("review", 8, "Review and launch", "Check counts, spot-check families and fees, then hand the workspace to the school.", false, classCount === 0 || (wants("students") && studentCount === 0)),
  ];
  const required = steps.filter((row) => row.status !== "optional");
  const completed = required.filter((row) => row.status === "complete").length;
  return {
    modules,
    progress: { completed, total: required.length, percent: required.length ? Math.round((completed / required.length) * 100) : 0 },
    counts: { classes: classCount, students: studentCount, teachers: teacherCount, openingBalances: openingCount, feeTemplates: templateCount },
    steps,
    templates: IMPORT_KINDS.map((kind) => ({
      kind,
      title: TEMPLATE_DETAILS[kind].title,
      fileName: TEMPLATE_DETAILS[kind].file,
      disabled: (kind !== "classes" && classCount === 0) || (kind === "opening_balances" && studentCount === 0) || (kind === "class_teachers" && teacherCount === 0),
      prerequisite: kind === "classes" ? "None" : kind === "opening_balances" ? "Students" : kind === "class_teachers" ? "Classes + teachers" : "Classes",
    })),
    imports: latestImports.map((row) => ({
      id: row.id,
      kind: row.kind,
      fileName: row.fileName,
      status: row.status,
      created: row.createdCount,
      updated: row.updatedCount,
      createdAt: row.createdAt.toISOString(),
      appliedAt: row.appliedAt?.toISOString() || "",
      errors: JSON.parse(row.errorsJson) as string[],
    })),
    googleSheets: latestSheets.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      webViewLink: row.webViewLink,
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() || "",
      importId: row.importId || "",
    })),
  };
}
