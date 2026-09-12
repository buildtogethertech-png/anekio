import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { InvoiceStatus, type Prisma, type Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { can, type AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { normalizeMobile } from "./phone";
import { ensureAccessRoles, roleIdBySlug } from "./roles";
import { parseClassLabel, parseCsv } from "./sheet";
import { readUpload } from "./uploads";
import { DOCUMENT_TYPES } from "./document-studio";

const ONBOARDING_STATE_ID = "school";
export const IMPORT_KINDS = ["classes", "students", "teachers", "class_teachers", "opening_balances"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
type ImportRow = Record<string, string> & { _row: string };
type OnboardingDb = Prisma.TransactionClient;
type OnboardingSetupArea = "school" | "teaching" | "money" | "documents";
type OnboardingStepKey =
  | "school"
  | "classes"
  | "students"
  | "teachers"
  | "class_teachers"
  | "collection_account"
  | "fee_documents"
  | "opening_balances"
  | "recurring_fees"
  | "documents"
  | "review";
type OnboardingPlanState = { modules: string[]; manualSteps: string[] };
type OnboardingTarget = { href: string; label: string };

const TEMPLATE_DETAILS: Record<ImportKind, { sheet: string; file: string; title: string }> = {
  classes: { sheet: "Classes", file: "anekio-classes.csv", title: "Classes and sections" },
  students: { sheet: "Students", file: "anekio-students.csv", title: "Students and parents" },
  teachers: { sheet: "Teachers", file: "anekio-teachers.csv", title: "Teachers" },
  class_teachers: { sheet: "Class teachers", file: "anekio-class-teachers.csv", title: "Class teacher assignments" },
  opening_balances: { sheet: "First time fees", file: "anekio-first-time-fees.csv", title: "First time fee import" },
};
const DEFAULT_ONBOARDING_MODULES = ["school", "teaching", "money", "documents"];
const ONBOARDING_STEP_KEYS = new Set<OnboardingStepKey>([
  "school",
  "classes",
  "students",
  "teachers",
  "class_teachers",
  "collection_account",
  "fee_documents",
  "opening_balances",
  "recurring_fees",
  "documents",
  "review",
]);

function parsePlanState(value: string | null | undefined): OnboardingPlanState {
  try {
    const parsed = JSON.parse(value || "null") as unknown;
    if (Array.isArray(parsed)) return { modules: DEFAULT_ONBOARDING_MODULES, manualSteps: [] };
    if (parsed && typeof parsed === "object") {
      const row = parsed as Partial<OnboardingPlanState>;
      return {
        modules: DEFAULT_ONBOARDING_MODULES,
        manualSteps: Array.isArray(row.manualSteps) ? row.manualSteps.map(String).filter((key) => ONBOARDING_STEP_KEYS.has(key as OnboardingStepKey)) : [],
      };
    }
  } catch {
    // Keep onboarding usable if an older or broken state value is present.
  }
  return { modules: DEFAULT_ONBOARDING_MODULES, manualSteps: [] };
}

function serializePlanState(state: OnboardingPlanState) {
  return JSON.stringify({
    modules: DEFAULT_ONBOARDING_MODULES,
    manualSteps: [...new Set(state.manualSteps.filter((key) => ONBOARDING_STEP_KEYS.has(key as OnboardingStepKey)))],
  });
}

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

function tenthOfMonth(date = new Date()) {
  return dateText(new Date(date.getFullYear(), date.getMonth(), 10));
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
type StaffImportRole = Pick<Role, "id" | "name" | "slug" | "portal">;

function csvBuffer(rows: CsvCell[][]) {
  const encoded = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","));
  return Buffer.from(`\uFEFF${encoded.join("\r\n")}\r\n`, "utf8");
}

const SAMPLE_STUDENT_FIRST_NAMES = [
  "Aarav",
  "Aanya",
  "Aditya",
  "Advait",
  "Aisha",
  "Ali",
  "Ananya",
  "Anika",
  "Anvi",
  "Arjun",
  "Arnav",
  "Avni",
  "Ayaan",
  "Dev",
  "Devika",
  "Diya",
  "Hana",
  "Harsh",
  "Inaaya",
  "Ira",
  "Ishaan",
  "Kabir",
  "Kiara",
  "Krish",
  "Lavanya",
  "Meera",
  "Mihir",
  "Myra",
  "Navya",
  "Neel",
  "Nisha",
  "Parth",
  "Prisha",
  "Raghav",
  "Reyansh",
  "Riya",
  "Ruhi",
  "Samaira",
  "Samar",
  "Sara",
  "Shaurya",
  "Siya",
  "Tara",
  "Ved",
  "Vihaan",
  "Vivaan",
  "Yash",
  "Zara",
  "Zoya",
  "Aryan",
];

const SAMPLE_LAST_NAMES = [
  "Sharma",
  "Menon",
  "Nair",
  "Reddy",
  "Rao",
  "Qureshi",
  "Iyer",
  "Bose",
  "Kapoor",
  "Patil",
];

function sampleStudentRows(labels: string[]) {
  const usableLabels = labels.length ? labels : ["1-A", "2-A", "3-A", "4-A", "5-A"];
  return SAMPLE_STUDENT_FIRST_NAMES.map((first, index) => {
    const last = SAMPLE_LAST_NAMES[index % SAMPLE_LAST_NAMES.length];
    const classLabel = usableLabels[index % usableLabels.length];
    const parentFirst = ["Neha", "Rahul", "Pooja", "Amit", "Farah", "Vikram", "Ritu", "Sanjay", "Kavita", "Imran"][index % 10];
    return {
      admissionNo: `TEST-${String(index + 1).padStart(3, "0")}`,
      name: `${first} ${last}`,
      dob: `201${index % 7}-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
      classLabel,
      parentName: `${parentFirst} ${last}`,
      parentMobile: `98765${String(40000 + index).padStart(5, "0")}`,
      parentEmail: `parent${String(index + 1).padStart(3, "0")}@example.com`,
    };
  });
}

function sampleStaffRows(labels: string[], roles: StaffImportRole[]) {
  const usableLabels = labels.length ? labels : ["1-A", "2-A", "3-A", "4-A", "5-A"];
  const roleLabels = new Set(roles.map((role) => roleLabel(role)));
  const teacherRows = [
    "Meera Singh",
    "Rohan Verma",
    "Nisha Khan",
    "Amit Das",
    "Priya Nair",
    "Farhan Ali",
    "Sneha Rao",
    "Karan Mehta",
    "Pallavi Iyer",
    "Deepak Joshi",
  ].map((name, index) => [
    name,
    `98766${String(10000 + index).padStart(5, "0")}`,
    `teacher${String(index + 1).padStart(2, "0")}@example.com`,
    "TEACHER",
    usableLabels[index % usableLabels.length],
    30000 + index * 1000,
    ["B.Ed", "M.Sc Mathematics", "B.A English", "M.A History", "B.Sc Physics"][index % 5],
    "",
  ] as CsvCell[]);
  const officeRows = [
    ["Vikram Rao", "9876670001", "admin.import@example.com", "ADMIN", "", 50000, "Principal", ""],
    ["Ritu Shah", "9876670002", "fees.import@example.com", "FEES", "", 36000, "Accounts", ""],
    ["Kiran Mehta", "9876670003", "exams.import@example.com", "EXAMS", "", 38000, "Exam controller", ""],
    ["Asha Gupta", "9876670004", "admissions.import@example.com", "ADMISSIONS", "", 34000, "Admissions", ""],
  ].filter((row) => roleLabels.has(String(row[3]))) as CsvCell[][];
  return [...teacherRows, ...officeRows];
}

function blankRowsFor(kind: ImportKind, labels: string[]): CsvCell[][] {
  const firstClass = labels[0] || "1-A";
  if (kind === "teachers") {
    return [
      ["Name", "Mobile", "Email", "Role", "Class teacher of", "Monthly salary", "Qualification", "Example only"],
      ["Meera Singh (example)", "9876543211", "teacher@example.com", "TEACHER", firstClass, 30000, "B.Ed, Mathematics", "YES"],
    ];
  }
  if (kind === "opening_balances") {
    return [
      ["Admission number", "Student name", "Class", "Backlog invoice amount", "Invoice date", "Due date", "Invoices already generated till", "Example only"],
      ["", "Aarav Sharma (example)", firstClass, 2500, dateText(new Date()), tenthOfMonth(), monthBefore(), "YES"],
    ];
  }
  return [];
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
    await ensureAccessRoles();
    const [teachers, staffMembers] = await Promise.all([
      prisma.teacher.findMany({ include: { user: { include: { role: true } }, class: true }, orderBy: { user: { name: "asc" } } }),
      prisma.staffMember.findMany({ include: { user: { include: { role: true } }, role: true }, orderBy: { name: "asc" } }),
    ]);
    return [
      ["Name", "Mobile", "Email", "Role", "Class teacher of", "Monthly salary", "Qualification", "Example only"],
      ["Meera Singh (example)", "9876543211", "teacher@example.com", "TEACHER", classLabels[0] || "1-A", 30000, "B.Ed, Mathematics", "YES"],
      ...teachers.map((teacher) => [
        teacher.user.name,
        teacher.user.phone || "",
        teacher.user.email.endsWith("@local.anekio.invalid") ? "" : teacher.user.email,
        roleLabel(teacher.user.role),
        teacher.class ? `${teacher.class.name}-${teacher.class.section}` : "",
        teacher.monthlySalary,
        teacher.qualification || "",
        "",
      ]),
      ...staffMembers.map((staff) => [
        staff.name,
        staff.phone || staff.user?.phone || "",
        staff.user?.email && !staff.user.email.endsWith("@local.anekio.invalid") && !staff.user.email.endsWith("@mobile.local") ? staff.user.email : "",
        staff.role || staff.user?.role ? roleLabel((staff.role || staff.user?.role)!) : "ADMIN",
        "",
        staff.monthlySalary,
        staff.title || "",
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
  const generatedOn = dateText(new Date());
  const defaultDueDate = tenthOfMonth();
  return [
    ["Admission number", "Student name", "Class", "Backlog invoice amount", "Invoice date", "Due date", "Invoices already generated till", "Example only"],
    ["", "Aarav Sharma (example)", classLabels[0] || "1-A", 2500, generatedOn, defaultDueDate, defaultThrough, "YES"],
    ...students.map((student) => {
    const current = openingByStudent.get(student.id);
    const paid = current?.payments.reduce((total, payment) => total + payment.amount, 0) || 0;
      return [
      student.admissionNo,
      student.name,
      `${student.class.name}-${student.class.section}`,
      current ? Math.max(0, current.amount - paid) : 0,
      generatedOn,
      current ? dateText(current.dueDate) : defaultDueDate,
      student.feeGeneratedThrough || current?.generatedThrough || defaultThrough,
        "",
      ];
    }),
  ];
}

function xlsxFileName(kind: ImportKind) {
  return TEMPLATE_DETAILS[kind].file.replace(/\.csv$/i, ".xlsx");
}

function applyHeaderStyle(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
}

async function staffImportRoles(db: Pick<typeof prisma, "role"> = prisma): Promise<StaffImportRole[]> {
  await ensureAccessRoles();
  return db.role.findMany({
    where: { portal: { in: ["OFFICE", "TEACHER"] } },
    select: { id: true, name: true, slug: true, portal: true },
    orderBy: [{ portal: "asc" }, { isSystem: "desc" }, { name: "asc" }],
  });
}

function roleLabel(role: StaffImportRole) {
  return role.slug === "TEACHER" ? "TEACHER" : role.name.toUpperCase();
}

function roleLookupKey(value: string) {
  return normalizeHeader(value);
}

function resolveStaffImportRole(roles: StaffImportRole[], row: ImportRow) {
  const raw = sheetCell(row, "Role", "Role ID", "Role slug") || "TEACHER";
  const key = roleLookupKey(raw);
  return roles.find((role) => [role.id, role.slug, role.name, roleLabel(role)].some((value) => roleLookupKey(value) === key)) || null;
}

function monthlySalaryFrom(row: ImportRow, fallback: number) {
  const raw = sheetCell(row, "Monthly salary", "Salary");
  if (!raw) return fallback;
  const value = Number(raw.replace(/[₹,\s]/g, ""));
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

function salaryIsValid(row: ImportRow) {
  const raw = sheetCell(row, "Monthly salary", "Salary");
  if (!raw) return true;
  const value = Number(raw.replace(/[₹,\s]/g, ""));
  return Number.isFinite(value) && value >= 0;
}

async function ensureClassForImport(db: OnboardingDb, klass: { name: string; section: string }) {
  const existing = await db.class.findFirst({ where: { name: klass.name, section: klass.section } });
  if (existing) return existing.archivedAt
    ? db.class.update({ where: { id: existing.id }, data: { archivedAt: null } })
    : existing;
  return db.class.create({ data: { name: klass.name, section: klass.section } });
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

export async function onboardingSpreadsheetTemplate(user: AccessUser, rawKind: string, options: { sampleData?: boolean } = {}) {
  need(user);
  const kind = asKind(rawKind);
  const classes = await prisma.class.findMany({
    where: { archivedAt: null },
    orderBy: [{ name: "asc" }, { section: "asc" }],
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Anekio";
  const labels = classes.length ? classes.map((row) => `${row.name}-${row.section}`) : ["1-A", "2-A", "3-A", "4-A", "5-A"];
  if (kind !== "students") {
    const blankRows = blankRowsFor(kind, labels);
    const rows = options.sampleData || !blankRows.length ? await csvRowsFor(kind) : blankRows;
    if (kind === "teachers") {
      const roles = await staffImportRoles();
      if (options.sampleData) {
        rows.push(...sampleStaffRows(labels, roles));
      }
    }
    const sheet = workbook.addWorksheet(TEMPLATE_DETAILS[kind].sheet);
    rows.forEach((row) => sheet.addRow(row));
    applyHeaderStyle(sheet);
    sheet.columns = (rows[0] || []).map((header) => ({ header: String(header), key: normalizeHeader(header), width: Math.max(16, String(header).length + 2) }));

    if (kind === "teachers" || kind === "class_teachers") {
      const roles = kind === "teachers" ? await staffImportRoles() : [];
      const lists = workbook.addWorksheet("_Lists");
      lists.state = "veryHidden";
      lists.getCell("A1").value = "Roles";
      lists.getCell("B1").value = "Classes";
      roles.forEach((role, index) => { lists.getCell(index + 2, 1).value = roleLabel(role); });
      labels.forEach((label, index) => { lists.getCell(index + 2, 2).value = label; });
      const roleEnd = Math.max(2, roles.length + 1);
      const classEnd = Math.max(2, labels.length + 1);
      const headers = (rows[0] || []).map((header) => normalizeHeader(header));
      const roleColumn = headers.indexOf("role") + 1;
      const classColumn = kind === "teachers"
        ? headers.indexOf(normalizeHeader("Class teacher of")) + 1
        : headers.indexOf("class") + 1;
      for (let rowNumber = 2; rowNumber <= 250; rowNumber += 1) {
        if (roleColumn > 0) {
          sheet.getCell(rowNumber, roleColumn).dataValidation = {
            type: "list",
            allowBlank: true,
            formulae: [`'_Lists'!$A$2:$A$${roleEnd}`],
          };
        }
        if (classColumn > 0) {
          sheet.getCell(rowNumber, classColumn).dataValidation = {
            type: "list",
            allowBlank: true,
            formulae: [`'_Lists'!$B$2:$B$${classEnd}`],
          };
        }
      }
    }

    return {
      fileName: xlsxFileName(kind),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }
  const headers = ["Student name", "Date of birth", "Class", "Parent name", "Parent mobile", "Parent email", "Example only"];
  const samplesByClass = new Map<string, ReturnType<typeof sampleStudentRows>>();
  if (options.sampleData) {
    sampleStudentRows(labels).forEach((row) => {
      const rows = samplesByClass.get(row.classLabel) || [];
      rows.push(row);
      samplesByClass.set(row.classLabel, rows);
    });
  }
  labels.forEach((label, index) => {
    const sheet = workbook.addWorksheet(label);
    sheet.addRow(headers);
    sheet.addRow([index === 0 ? "Aarav Sharma (example)" : "", "2015-04-12", label, "Neha Sharma", "9876543210", "parent@example.com", "YES"]);
    (samplesByClass.get(label) || []).forEach((row) => {
      sheet.addRow([row.name, row.dob, row.classLabel, row.parentName, row.parentMobile, row.parentEmail, ""]);
    });
    applyHeaderStyle(sheet);
    sheet.columns = headers.map((header) => ({ header, key: normalizeHeader(header), width: Math.max(18, header.length + 2) }));
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
  const roles = kind === "teachers" ? await staffImportRoles() : [];
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
      if (!sheetCell(row, "Teacher name", "Name")) errors.push(rowError(row, "name is required."));
      if (!normalizeMobile(sheetCell(row, "Mobile", "Phone"))) errors.push(rowError(row, "mobile must be a 10-digit number."));
      if (!resolveStaffImportRole(roles, row)) errors.push(rowError(row, "role must be one of the office or teacher roles."));
      const classText = sheetCell(row, "Class teacher of", "Class teacher", "Class");
      if (classText && !parseClass(classText)) errors.push(rowError(row, "class teacher value must look like 1-A."));
      if (!salaryIsValid(row)) errors.push(rowError(row, "monthly salary must be zero or more."));
      return;
    }
    if (kind === "class_teachers") {
      const classText = sheetCell(row, "Class");
      const employeeId = sheetCell(row, "Class teacher employee ID", "Employee ID", "Teacher employee ID");
      const teacherName = sheetCell(row, "Class teacher name", "Teacher name");
      const klass = parseClass(classText);
      if (!klass) errors.push(rowError(row, "class must use a value like 1-A."));
      if (!employeeId && !teacherName) errors.push(rowError(row, "teacher employee ID or teacher name is required."));
      return;
    }
    const studentId = sheetCell(row, "Anekio student ID");
    const admissionNo = sheetCell(row, "Admission number", "Admission no").toLowerCase();
    const amount = Number(sheetCell(row, "Backlog invoice amount", "Opening due amount", "Previous system due", "Due amount", "Amount"));
    const invoiceDate = sheetCell(row, "Invoice date", "Generated date");
    const dueDate = sheetCell(row, "Due date");
    const through = sheetCell(row, "Invoices already generated till", "Invoices generated till", "Last invoice month", "Generated through", "Last generated month");
    if ((!studentId || !studentIds.has(studentId)) && (!admissionNo || !admissionNos.has(admissionNo))) {
      errors.push(rowError(row, "student ID or admission number was not found."));
    }
    if (!Number.isFinite(amount) || amount < 0) errors.push(rowError(row, "backlog invoice amount must be zero or more."));
    if (invoiceDate && !validDate(invoiceDate)) errors.push(rowError(row, "invoice date must be YYYY-MM-DD."));
    if (!validDate(dueDate)) errors.push(rowError(row, "due date must be YYYY-MM-DD."));
    if (!validPeriod(through)) errors.push(rowError(row, "invoices already generated till must be YYYY-MM."));
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

function staffPlaceholderEmail(phone: string) {
  return `staff.${phone}@local.anekio.invalid`;
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
      : await db.class.findFirst({ where: { name, section } });
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
  const [students, teachers, staffMembers] = await Promise.all([
    prisma.student.findMany({ select: { admissionNo: true } }),
    prisma.teacher.findMany({ select: { employeeId: true } }),
    prisma.staffMember.findMany({ select: { employeeId: true } }),
  ]);
  const studentNumbers = students.map((row) => Number(row.admissionNo.replace(/\D/g, ""))).filter(Number.isFinite);
  const teacherNumbers = teachers.map((row) => Number(row.employeeId.replace(/\D/g, ""))).filter(Number.isFinite);
  const staffNumbers = staffMembers.map((row) => Number(row.employeeId.replace(/\D/g, ""))).filter(Number.isFinite);
  return {
    admission: (studentNumbers.length ? Math.max(...studentNumbers) : 0) + 1,
    employee: (teacherNumbers.length ? Math.max(...teacherNumbers) : 100) + 1,
    staffEmployee: (staffNumbers.length ? Math.max(...staffNumbers) : 200) + 1,
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
    const existingClass = await db.class.findFirst({ where: { name: klass.name, section: klass.section } });
    const classRow = existingClass
      ? await db.class.update({ where: { id: existingClass.id }, data: { archivedAt: null } })
      : await db.class.create({ data: { name: klass.name, section: klass.section } });
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
  setup: { password: string; employee: number; staffEmployee: number; roles: StaffImportRole[] }
) {
  let created = 0;
  let updated = 0;
  let nextEmployee = setup.employee;
  let nextStaffEmployee = setup.staffEmployee;
  for (const row of rows) {
    const role = resolveStaffImportRole(setup.roles, row);
    if (!role) throw new Error(rowError(row, "role no longer exists."));
    const name = sheetCell(row, "Teacher name", "Name");
    const phone = normalizeMobile(sheetCell(row, "Mobile", "Phone"));
    const email = sheetCell(row, "Email").toLowerCase() || (role.portal === "TEACHER" ? placeholderEmail("teacher", phone) : staffPlaceholderEmail(phone));
    const teacherId = sheetCell(row, "Anekio teacher ID");
    let employeeId = sheetCell(row, "Employee ID");
    const classText = sheetCell(row, "Class teacher of", "Class teacher", "Class");
    const klass = classText ? parseClass(classText) : null;
    const classRow = klass ? await ensureClassForImport(db, klass) : null;
    const salary = monthlySalaryFrom(row, role.portal === "TEACHER" ? 30000 : 25000);

    if (role.portal === "TEACHER") {
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
        await db.user.update({ where: { id: existing.userId }, data: { name, email, phone, roleId: role.id } });
        await db.teacher.update({
          where: { id: existing.id },
          data: { employeeId, monthlySalary: salary, qualification: sheetCell(row, "Qualification") || null, ...(classRow ? { classId: classRow.id } : {}) },
        });
        if (classRow) {
          await db.teacherClass.upsert({
            where: { teacherId_classId: { teacherId: existing.id, classId: classRow.id } },
            update: {},
            create: { teacherId: existing.id, classId: classRow.id },
          });
        }
        updated += 1;
      } else {
        const createdUser = await db.user.create({
          data: {
            name,
            email,
            phone,
            password: setup.password,
            roleId: role.id,
            teacher: {
              create: {
                employeeId,
                monthlySalary: salary,
                qualification: sheetCell(row, "Qualification") || null,
                ...(classRow ? { classId: classRow.id } : {}),
              },
            },
          },
          include: { teacher: true },
        });
        if (classRow && createdUser.teacher) {
          await db.teacherClass.create({ data: { teacherId: createdUser.teacher.id, classId: classRow.id } });
        }
        created += 1;
      }
    } else {
      const existing = employeeId
        ? await db.staffMember.findUnique({ where: { employeeId }, include: { user: true } })
        : await db.staffMember.findFirst({ where: { user: { OR: [{ email }, { phone }] } }, include: { user: true } });
      if (!employeeId) {
        do {
          employeeId = `S-${nextStaffEmployee}`;
          nextStaffEmployee += 1;
        } while (await db.staffMember.findUnique({ where: { employeeId }, select: { id: true } }));
      }
      if (existing) {
        if (existing.userId) await db.user.update({ where: { id: existing.userId }, data: { name, email, phone, roleId: role.id } });
        await db.staffMember.update({
          where: { id: existing.id },
          data: { name, title: role.name, phone, employeeId, roleId: role.id, monthlySalary: salary, kind: "OFFICE", archivedAt: null },
        });
        updated += 1;
      } else {
        await db.user.create({
          data: {
            name,
            email,
            phone,
            password: setup.password,
            roleId: role.id,
            staffMember: { create: { name, title: role.name, phone, employeeId, roleId: role.id, monthlySalary: salary, kind: "OFFICE" } },
          },
        });
        created += 1;
      }
    }
  }
  return { created, updated };
}

async function applyClassTeachers(db: OnboardingDb, rows: ImportRow[]) {
  let updated = 0;
  for (const row of rows) {
    const klass = parseClass(sheetCell(row, "Class"))!;
    const classRow = await ensureClassForImport(db, klass);
    const employeeId = sheetCell(row, "Class teacher employee ID", "Employee ID", "Teacher employee ID");
    const teacherName = sheetCell(row, "Class teacher name", "Teacher name");
    const teacher = employeeId
      ? await db.teacher.findUnique({ where: { employeeId }, include: { user: true } })
      : await db.teacher.findFirst({ where: { user: { name: { equals: teacherName } } }, include: { user: true } });
    if (!teacher) throw new Error(rowError(row, "teacher no longer exists."));
    await db.teacher.update({ where: { id: teacher.id }, data: { classId: classRow.id } });
    await db.teacherClass.upsert({
      where: { teacherId_classId: { teacherId: teacher.id, classId: classRow.id } },
      update: {},
      create: { teacherId: teacher.id, classId: classRow.id },
    });
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
    const amount = Math.round(Number(sheetCell(row, "Backlog invoice amount", "Opening due amount", "Previous system due", "Due amount", "Amount")));
    const generatedThrough = sheetCell(row, "Invoices already generated till", "Invoices generated till", "Last invoice month", "Generated through", "Last generated month");
    const dueDate = new Date(`${sheetCell(row, "Due date")}T00:00:00`);
    const existing = await db.feeInvoice.findUnique({
      where: { studentId_period: { studentId: student.id, period: "OPENING" } },
      include: { payments: true },
    });
    const paid = existing?.payments.reduce((total, payment) => total + payment.amount, 0) || 0;
    if (amount < paid) throw new Error(rowError(row, `backlog invoice amount cannot be below ₹${paid} already collected.`));
    if (existing) {
      await db.feeInvoice.update({
        where: { id: existing.id },
        data: {
          kind: "OPENING",
          generatedThrough,
          title: "Backlog invoice",
          amount,
          linesJson: JSON.stringify([{ label: "Backlog invoice", kind: "FLAT", amount }]),
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
          title: "Backlog invoice",
          amount,
          linesJson: JSON.stringify([{ label: "Backlog invoice", kind: "FLAT", amount }]),
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
        ? { password: await bcrypt.hash("12345", 10), employee: codes!.employee, staffEmployee: codes!.staffEmployee, roles: await staffImportRoles() }
        : null;
    const result = await prisma.$transaction(async (db) => kind === "classes"
      ? applyClasses(db, rows)
      : kind === "students"
        ? applyStudents(db, rows, peopleSetup as { roleId: string; password: string; admission: number })
        : kind === "teachers"
          ? applyTeachers(db, rows, peopleSetup as { password: string; employee: number; staffEmployee: number; roles: StaffImportRole[] })
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
  const state = await prisma.schoolOnboardingState.findUnique({ where: { id: ONBOARDING_STATE_ID } });
  const current = parsePlanState(state?.selectedModulesJson);
  const modules = requested.length ? DEFAULT_ONBOARDING_MODULES : current.modules;
  const selectedModulesJson = serializePlanState({ modules, manualSteps: current.manualSteps });
  const saved = await prisma.schoolOnboardingState.upsert({
    where: { id: ONBOARDING_STATE_ID },
    update: { selectedModulesJson },
    create: { id: ONBOARDING_STATE_ID, selectedModulesJson },
  });
  return parsePlanState(saved.selectedModulesJson);
}

export async function toggleOnboardingStep(user: AccessUser, input: { key?: unknown; complete?: unknown }) {
  need(user);
  const key = String(input.key || "") as OnboardingStepKey;
  if (!ONBOARDING_STEP_KEYS.has(key)) throw new Error("Choose a valid onboarding step.");
  const state = await prisma.schoolOnboardingState.findUnique({ where: { id: ONBOARDING_STATE_ID } });
  const current = parsePlanState(state?.selectedModulesJson);
  const manual = new Set(current.manualSteps);
  if (input.complete === false) manual.delete(key);
  else manual.add(key);
  const saved = await prisma.schoolOnboardingState.upsert({
    where: { id: ONBOARDING_STATE_ID },
    update: { selectedModulesJson: serializePlanState({ modules: current.modules, manualSteps: [...manual] }) },
    create: { id: ONBOARDING_STATE_ID, selectedModulesJson: serializePlanState({ modules: current.modules, manualSteps: [...manual] }) },
  });
  return parsePlanState(saved.selectedModulesJson);
}

export async function onboardingBundle(user: AccessUser) {
  need(user);
  const schoolId = String((user as AccessUser & { schoolId?: string | null }).schoolId || "school");
  const priorityDocumentTypes = DOCUMENT_TYPES.filter((item) => item.priority).map((item) => item.id);
  const [state, school, classCount, studentCount, teacherCount, templateCount, openingCount, feeDocumentCount, documentTemplateCount, latestImports, latestSheets] = await Promise.all([
    prisma.schoolOnboardingState.findUnique({ where: { id: ONBOARDING_STATE_ID } }),
    prisma.schoolConfig.findUnique({
      where: { id: "school" },
      select: {
        name: true,
        upiId: true,
        bankName: true,
        bankAccountName: true,
        bankAccountNumber: true,
        bankIfsc: true,
        payGateway: true,
        razorpayKeyId: true,
        cashfreeAppId: true,
        billdeskMerchantId: true,
      },
    }),
    prisma.class.count({ where: { archivedAt: null } }),
    prisma.student.count(),
    prisma.teacher.count(),
    prisma.feeTemplate.count(),
    prisma.feeInvoice.count({ where: { period: "OPENING" } }),
    prisma.documentTemplate.count({ where: { schoolId, status: "ACTIVE", type: { in: ["FEE_INVOICE", "PAYMENT_RECEIPT"] } } }),
    prisma.documentTemplate.count({ where: { schoolId, status: "ACTIVE", type: { in: priorityDocumentTypes } } }),
    prisma.schoolOnboardingImport.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.onboardingGoogleSheet.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const planState = parsePlanState(state?.selectedModulesJson);
  const modules = planState.modules;
  const manualDone = new Set(planState.manualSteps);
  const importDone = new Set(latestImports.filter((row) => row.status === "APPLIED").map((row) => row.kind));
  const hasBank = Boolean(school?.bankName && school.bankAccountName && school.bankAccountNumber && school.bankIfsc);
  const hasUpi = Boolean(school?.upiId);
  const hasGateway =
    school?.payGateway === "RAZORPAY" ? Boolean(school.razorpayKeyId)
      : school?.payGateway === "CASHFREE" ? Boolean(school.cashfreeAppId)
        : school?.payGateway === "BILLDESK" ? Boolean(school.billdeskMerchantId)
          : false;
  const step = (
    key: OnboardingStepKey,
    area: OnboardingSetupArea,
    number: number,
    title: string,
    body: string,
    complete: boolean,
    blocked = false,
    missingReason = "",
    target: OnboardingTarget = { href: "/school", label: "Open setup" },
  ) => ({
    key,
    area,
    number,
    title,
    body,
    target,
    dataComplete: complete,
    manualComplete: manualDone.has(key),
    missingReason,
    status: complete || manualDone.has(key) ? "complete" : blocked ? "blocked" : "ready",
  });
  const steps = [
    step("school", "school", 1, "School identity", "Confirm school name, session, contact details, and branding in Settings.", Boolean(school?.name && school.name !== "School"), false, "School identity appears on receipts, documents, logins, and parent-facing pages.", { href: "/school?tab=identity", label: "Open identity" }),
    step("classes", "school", 2, "Classes in CRM", "Create classes in School setup, or let student and staff sheets create valid class labels like 1-A.", classCount > 0, false, "Classes connect students, teachers, fees, attendance, exams, and document batches.", { href: "/school?tab=classes", label: "Open classes" }),
    step("students", "teaching", 3, "Students and parents", "Import family records with generated admission numbers when needed.", studentCount > 0 || importDone.has("students"), false, "Students and parent links are needed for attendance, fees, notices, documents, and parent app access.", { href: "/people", label: "Open students" }),
    step("teachers", "teaching", 4, "Teachers", "Import staff records with role and class-teacher columns when needed.", teacherCount > 0 || importDone.has("teachers"), false, "Teachers are needed for class ownership, timetable, attendance, exams, and staff documents.", { href: "/staff", label: "Open staff" }),
    step("class_teachers", "teaching", 5, "Class teacher assignments", "Use class labels from the sheet and choose which teacher owns each class.", importDone.has("class_teachers"), teacherCount === 0, "Class teacher assignments decide who manages attendance, class messages, and class-level follow-up.", { href: "/school?tab=classes", label: "Open classes" }),
    step("collection_account", "money", 6, "Bank and collection account", "Add UPI, bank account, or the school's payment gateway before asking parents to pay.", hasUpi || hasBank || hasGateway, false, "Collection details appear on pay pages, invoices, receipts, and office collection workflows.", { href: "/school?tab=collect", label: "Open collection setup" }),
    step("fee_documents", "money", 7, "Invoice and receipt documents", "Set up the fee invoice and payment receipt templates before the first billing cycle.", feeDocumentCount >= 2, false, "Invoice and receipt templates decide what parents see, print, download, and verify after payment.", { href: "/school?tab=documents&document=FEE_INVOICE", label: "Open invoice sample" }),
    step("opening_balances", "money", 8, "First time fee import", "Put any previous-system dues in a backlog invoice and tell Anekio the last month already invoiced.", importDone.has("opening_balances") || (studentCount > 0 && openingCount >= studentCount), studentCount === 0, "Opening balances prevent missed old dues and duplicate first invoices.", { href: "/fees", label: "Open fees" }),
    step("recurring_fees", "money", 9, "Recurring fee rules", "Set class fee ranges. New invoices begin after each student's imported cut-off month.", templateCount > 0, classCount === 0, "Recurring fee rules are needed before monthly billing can run correctly.", { href: "/fees", label: "Open fees" }),
    step("documents", "documents", 10, "Important documents", "Preview and publish priority templates like ID card, bonafide, transfer certificate, admit card, report card, invoice, and receipt.", documentTemplateCount >= Math.min(priorityDocumentTypes.length, 3), false, "Important documents need published templates before the office can issue IDs, certificates, report cards, invoices, and receipts.", { href: "/school?tab=documents&document=STUDENT_ID", label: "Open document samples" }),
    step("review", "documents", 11, "Review and launch", "Check counts, spot-check families, fees, and documents, then hand the workspace to the school.", false, classCount === 0 || studentCount === 0, "Review catches missing setup before the school starts using the workspace live.", { href: "/school", label: "Open school setup" }),
  ];
  const required = steps;
  const completed = required.filter((row) => row.status === "complete").length;
  return {
    modules,
    progress: { completed, total: required.length, percent: required.length ? Math.round((completed / required.length) * 100) : 0 },
    counts: { classes: classCount, students: studentCount, teachers: teacherCount, openingBalances: openingCount, feeTemplates: templateCount },
    steps,
    templates: (IMPORT_KINDS.filter((kind) => kind !== "classes" && kind !== "class_teachers") as ImportKind[]).map((kind) => ({
      kind,
      title: TEMPLATE_DETAILS[kind].title,
      fileName: xlsxFileName(kind),
      disabled: kind === "opening_balances" && studentCount === 0,
      prerequisite: kind === "opening_balances" ? "Students" : "Class labels can be created from the sheet",
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
