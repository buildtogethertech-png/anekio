import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { AttendanceStatus, ExamWorkflowStatus, InvoiceStatus, Prisma, type Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { can, type AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { normalizeMobile } from "./phone";
import { ensureAccessRoles, roleIdBySlug } from "./roles";
import { parseClassLabel, parseCsv } from "./sheet";
import { readUpload } from "./uploads";
import { parseWeekdays } from "./schedule";
import { examPlanWeight, parseExamPlan } from "./exams";
import { currentTenantOrg, runWithoutTenant } from "./tenant-context";

const ONBOARDING_STATE_ID = "school";
function onboardingStateId(orgId: string) {
  return `${ONBOARDING_STATE_ID}:${orgId}`;
}

export const IMPORT_KINDS = ["classes", "students", "teachers", "class_teachers", "attendance", "staff_attendance", "exam_marks", "opening_balances"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
type ImportRow = Record<string, string> & { _row: string };
type OnboardingDb = Prisma.TransactionClient;
type OnboardingSetupArea = "school" | "teaching" | "exams" | "money";
type OnboardingStepKey =
  | "school"
  | "sessions"
  | "classes"
  | "students"
  | "student_id_document"
  | "student_admit_card_document"
  | "admission_confirmation_document"
  | "teachers"
  | "staff_id_document"
  | "salary_slip_document"
  | "working_days"
  | "holiday_calendar"
  | "attendance"
  | "staff_attendance"
  | "exam_plan"
  | "exam_history"
  | "exam_marks"
  | "report_card_document"
  | "exam_date_sheet_document"
  | "consolidated_report_document"
  | "class_teachers"
  | "collection_account"
  | "fee_invoice_document"
  | "payment_receipt_document"
  | "opening_balances"
  | "recurring_fees"
  | "review";
type OnboardingPlanState = { modules: string[]; manualSteps: string[] };
type OnboardingTarget = { href: string; label: string };

const TEMPLATE_DETAILS: Record<ImportKind, { sheet: string; file: string; title: string }> = {
  classes: { sheet: "Classes", file: "anekio-classes.csv", title: "Classes and sections" },
  students: { sheet: "Students", file: "anekio-students.csv", title: "Students and parents" },
  teachers: { sheet: "Staff", file: "anekio-staff.csv", title: "Staff" },
  class_teachers: { sheet: "Class teachers", file: "anekio-class-teachers.csv", title: "Class teacher assignments" },
  attendance: { sheet: "Student attendance", file: "anekio-student-attendance.csv", title: "Student attendance history" },
  staff_attendance: { sheet: "Staff attendance", file: "anekio-staff-attendance.csv", title: "Staff attendance history" },
  exam_marks: { sheet: "Exam marks", file: "anekio-exam-marks.csv", title: "Exam marks history" },
  opening_balances: { sheet: "First time fees", file: "anekio-first-time-fees.csv", title: "First time fee import" },
};
const DEFAULT_ONBOARDING_MODULES = ["school", "teaching", "exams", "money"];
const ONBOARDING_STEP_KEYS = new Set<OnboardingStepKey>([
  "school",
  "sessions",
  "classes",
  "students",
  "student_id_document",
  "student_admit_card_document",
  "admission_confirmation_document",
  "teachers",
  "staff_id_document",
  "salary_slip_document",
  "working_days",
  "holiday_calendar",
  "attendance",
  "staff_attendance",
  "exam_plan",
  "exam_history",
  "exam_marks",
  "report_card_document",
  "exam_date_sheet_document",
  "consolidated_report_document",
  "class_teachers",
  "collection_account",
  "fee_invoice_document",
  "payment_receipt_document",
  "opening_balances",
  "recurring_fees",
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

function addDaysYmd(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateText(date);
}

function dateRange(from: string, to: string, limit = 430) {
  const dates: string[] = [];
  if (!validDate(from) || !validDate(to) || from > to) return dates;
  let date = from;
  while (date <= to && dates.length < limit) {
    dates.push(date);
    date = addDaysYmd(date, 1);
  }
  return dates;
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
type AttendanceImportMark = AttendanceStatus | "HOLIDAY";
type StaffAttendancePerson = { kind: "teacher" | "staff"; id: string; employeeId: string; name: string; role: string };
type ExamMarkColumn = { key: string; examId: string; classId: string; classLabel: string; maxMarks: number; label: string };
type OpeningBalanceStudent = Prisma.StudentGetPayload<{ include: { class: true } }>;
type OpeningBalanceInvoice = Prisma.FeeInvoiceGetPayload<{ include: { payments: true } }>;
const OPENING_BALANCE_HEADERS = ["Admission number", "Student name", "Class", "Backlog invoice amount", "Invoice date", "Due date", "Invoices already generated till", "Example only"];

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
  const classTeacherLabels = usableLabels.slice(1);
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
    classTeacherLabels[index] || "",
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

function sampleOpeningBalanceAmount(index: number) {
  return 900 + ((index * 1379) % 8) * 500;
}

function openingBalanceRows(
  students: OpeningBalanceStudent[],
  openingByStudent: Map<string, OpeningBalanceInvoice>,
  classLabels: string[],
  options: { sampleData?: boolean; includeExampleOnEmpty?: boolean } = {}
): CsvCell[][] {
  const defaultThrough = monthBefore();
  const generatedOn = dateText(new Date());
  const defaultDueDate = tenthOfMonth();
  const rows: CsvCell[][] = [
    OPENING_BALANCE_HEADERS,
  ];

  if (!students.length && options.includeExampleOnEmpty !== false) {
    rows.push(["", "Aarav Sharma (example)", classLabels[0] || "1-A", 2500, generatedOn, defaultDueDate, defaultThrough, "YES"]);
    return rows;
  }

  students.forEach((student, index) => {
    const current = openingByStudent.get(student.id);
    rows.push([
      student.admissionNo,
      student.name,
      `${student.class.name}-${student.class.section}`,
      options.sampleData ? sampleOpeningBalanceAmount(index) : current?.amount || 0,
      generatedOn,
      current ? dateText(current.dueDate) : defaultDueDate,
      student.feeGeneratedThrough || current?.generatedThrough || defaultThrough,
      "",
    ]);
  });
  return rows;
}

async function openingBalanceRowsForTemplate(classLabels: string[], options: { sampleData?: boolean } = {}) {
  const students = await prisma.student.findMany({ include: { class: true }, orderBy: { name: "asc" } });
  const opening = await prisma.feeInvoice.findMany({ where: { period: "OPENING" }, include: { payments: true } });
  return openingBalanceRows(students, new Map(opening.map((row) => [row.studentId, row])), classLabels, { includeExampleOnEmpty: true, ...options });
}

async function openingBalanceTemplateWorkbook(classLabels: string[], options: { sampleData?: boolean } = {}) {
  const [students, opening] = await Promise.all([
    prisma.student.findMany({ include: { class: true }, orderBy: [{ class: { name: "asc" } }, { class: { section: "asc" } }, { name: "asc" }] }),
    prisma.feeInvoice.findMany({ where: { period: "OPENING" }, include: { payments: true } }),
  ]);
  const openingByStudent = new Map(opening.map((row) => [row.studentId, row]));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Anekio";
  workbook.subject = "First time fee import";
  const labels = classLabels.length ? classLabels : ["1-A"];

  labels.forEach((label) => {
    const sheet = workbook.addWorksheet(label);
    const classStudents = students.filter((student) => `${student.class.name}-${student.class.section}` === label);
    const rows = openingBalanceRows(classStudents, openingByStudent, labels, { ...options, includeExampleOnEmpty: students.length === 0 });
    rows.forEach((row) => sheet.addRow(row));
    applyHeaderStyle(sheet);
    sheet.columns = OPENING_BALANCE_HEADERS.map((header) => ({ header, key: normalizeHeader(header), width: Math.max(16, header.length + 2) }));
  });

  return workbook;
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
      OPENING_BALANCE_HEADERS,
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
  const classLabels = [...new Set(classes.map((row) => `${row.name}-${row.section}`))];

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

  if (kind === "attendance") {
    return [
      ["Anekio student ID", "Admission number", "Student name", "Class", dateText(new Date()), "Example only"],
      ["", "ADM-001", "Aarav Sharma (example)", classLabels[0] || "1-A", "P", "YES"],
    ];
  }

  if (kind === "staff_attendance") {
    return [
      ["Anekio staff ID", "Staff type", "Employee ID", "Staff name", "Role", dateText(new Date()), "Example only"],
      ["", "teacher", "T-101", "Meera Singh (example)", "Teacher", "P", "YES"],
    ];
  }

  if (kind === "exam_marks") {
    return [
      ["Anekio student ID", "Admission number", "Student name", "Class", "Midterm - Mathematics (/80)", "Example only"],
      ["", "ADM-001", "Aarav Sharma (example)", classLabels[0] || "1-A", 72, "YES"],
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

  return openingBalanceRowsForTemplate(classLabels);
}

async function attendanceTemplateWorkbook(options: { sampleData?: boolean } = {}) {
  const session = await prisma.schoolSession.findFirst({
    where: { current: true },
    orderBy: { startsOn: "desc" },
  });
  if (!session) throw new Error("Create a school session before downloading attendance.");
  const today = dateText(new Date());
  const through = [session.endsOn, today].filter(Boolean).sort()[0] || today;
  const dates = dateRange(session.startsOn, through);
  if (!dates.length) throw new Error("This session has no dates to export yet.");
  const [config, holidays, classes] = await Promise.all([
    prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { weekdays: true } }),
    prisma.schoolHoliday.findMany({ where: { sessionId: session.id }, orderBy: { date: "asc" } }),
    prisma.class.findMany({
      where: { archivedAt: null },
      include: { students: { orderBy: { name: "asc" } } },
      orderBy: [{ name: "asc" }, { section: "asc" }],
    }),
  ]);
  if (!classes.length) throw new Error("Create classes before downloading attendance.");
  const holidayByDate = new Map(holidays.map((row) => [row.date, row.name]));
  const weekdays = parseWeekdays(config?.weekdays);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Anekio";
  workbook.subject = `Attendance import for ${session.label}`;
  const headers = ["Anekio student ID", "Admission number", "Student name", "Class", ...dates, "Example only"];
  for (const klass of classes) {
    const label = `${klass.name}-${klass.section}`;
    const sheet = workbook.addWorksheet(label);
    sheet.addRow(headers);
    sheet.addRow([
      "",
      "ADM-001",
      "Aarav Sharma (example)",
      label,
      ...dates.map((date) => holidayByDate.has(date) ? "H" : weekdays.includes(new Date(`${date}T00:00:00`).getDay() || 7) ? "P" : "H"),
      "YES",
    ]);
    klass.students.forEach((student) => {
      sheet.addRow([
        student.id,
        student.admissionNo,
        student.name,
        label,
        ...dates.map((date) => holidayByDate.has(date) ? "H" : weekdays.includes(new Date(`${date}T00:00:00`).getDay() || 7) ? "P" : "H"),
        "",
      ]);
    });
    applyHeaderStyle(sheet);
    sheet.columns = headers.map((header, index) => ({ header, key: normalizeHeader(header), width: index < 4 ? Math.max(18, header.length + 2) : 13 }));
  }
  return workbook;
}

async function staffAttendanceTemplateWorkbook(options: { sampleData?: boolean } = {}) {
  const session = await prisma.schoolSession.findFirst({
    where: { current: true },
    orderBy: { startsOn: "desc" },
  });
  if (!session) throw new Error("Create a school session before downloading staff attendance.");
  const today = dateText(new Date());
  const through = [session.endsOn, today].filter(Boolean).sort()[0] || today;
  const dates = dateRange(session.startsOn, through);
  if (!dates.length) throw new Error("This session has no dates to export yet.");
  const [config, holidays, teachers, staffMembers] = await Promise.all([
    prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { weekdays: true } }),
    prisma.schoolHoliday.findMany({ where: { sessionId: session.id }, orderBy: { date: "asc" } }),
    prisma.teacher.findMany({
      include: { user: { include: { role: true } }, class: true },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.staffMember.findMany({
      where: { archivedAt: null },
      include: { role: true, user: { include: { role: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!teachers.length && !staffMembers.length) throw new Error("Create staff before downloading staff attendance.");
  const holidayByDate = new Map(holidays.map((row) => [row.date, row.name]));
  const weekdays = parseWeekdays(config?.weekdays);
  const markForDate = (date: string) => holidayByDate.has(date) ? "H" : weekdays.includes(new Date(`${date}T00:00:00`).getDay() || 7) ? "P" : "H";
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Anekio";
  workbook.subject = `Staff attendance import for ${session.label}`;
  const headers = ["Anekio staff ID", "Staff type", "Employee ID", "Staff name", "Role", ...dates, "Example only"];
  const sheet = workbook.addWorksheet(TEMPLATE_DETAILS.staff_attendance.sheet);
  sheet.addRow(headers);
  sheet.addRow(["", "teacher", "T-101", "Meera Singh (example)", "Teacher", ...dates.map(markForDate), "YES"]);
  if (options.sampleData) {
    teachers.slice(0, 2).forEach((teacher) => {
      sheet.addRow([
        teacher.id,
        "teacher",
        teacher.employeeId,
        teacher.user.name,
        teacher.class ? `Class teacher ${teacher.class.name}-${teacher.class.section}` : roleLabel(teacher.user.role),
        ...dates.map(markForDate),
        "",
      ]);
    });
    staffMembers.slice(0, Math.max(0, 2 - Math.min(2, teachers.length))).forEach((staff) => {
      sheet.addRow([
        staff.id,
        "staff",
        staff.employeeId,
        staff.name,
        staff.role ? roleLabel(staff.role) : staff.user?.role ? roleLabel(staff.user.role) : staff.title || "Staff",
        ...dates.map(markForDate),
        "",
      ]);
    });
  } else {
    teachers.forEach((teacher) => {
      sheet.addRow([
        teacher.id,
        "teacher",
        teacher.employeeId,
        teacher.user.name,
        teacher.class ? `Class teacher ${teacher.class.name}-${teacher.class.section}` : roleLabel(teacher.user.role),
        ...dates.map(markForDate),
        "",
      ]);
    });
    staffMembers.forEach((staff) => {
      sheet.addRow([
        staff.id,
        "staff",
        staff.employeeId,
        staff.name,
        staff.role ? roleLabel(staff.role) : staff.user?.role ? roleLabel(staff.user.role) : staff.title || "Staff",
        ...dates.map(markForDate),
        "",
      ]);
    });
  }
  applyHeaderStyle(sheet);
  sheet.columns = headers.map((header, index) => ({ header, key: normalizeHeader(header), width: index < 5 ? Math.max(16, header.length + 2) : 13 }));
  return workbook;
}

function examColumnLabel(exam: { series?: { name: string } | null; subject: { name: string }; maxMarks: number }) {
  return `${exam.series?.name || "Exam"} - ${exam.subject.name} (/${exam.maxMarks})`;
}

function sampleExamMark(studentIndex: number, examIndex: number, maxMarks: number): CsvCell {
  if ((studentIndex + examIndex) % 13 === 5) return "Ab";
  const floor = Math.max(1, Math.round(maxMarks * 0.45));
  const range = Math.max(1, maxMarks - floor);
  return Math.min(maxMarks, floor + ((studentIndex * 11 + examIndex * 7) % (range + 1)));
}

async function examMarksTemplateWorkbook(options: { sampleData?: boolean } = {}) {
  const session = await prisma.schoolSession.findFirst({
    where: { current: true },
    orderBy: { startsOn: "desc" },
  });
  if (!session) throw new Error("Create a school session before downloading exam marks.");
  const classes = await prisma.class.findMany({
    where: { archivedAt: null },
    include: {
      students: { orderBy: { name: "asc" } },
      examSeries: {
        where: { sessionId: session.id },
        include: { exams: { include: { subject: true }, orderBy: [{ date: "asc" }, { title: "asc" }] } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ name: "asc" }, { section: "asc" }],
  });
  const classesWithExams = classes.filter((klass) => klass.examSeries.some((series) => series.exams.length));
  if (!classesWithExams.length) throw new Error("Create past exam series in Exams before downloading marks history.");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Anekio";
  workbook.subject = `Exam marks import for ${session.label}`;
  for (const klass of classesWithExams) {
    const label = `${klass.name}-${klass.section}`;
    const exams = klass.examSeries.flatMap((series) => series.exams.map((exam) => ({ ...exam, series })));
    const headers = ["Anekio student ID", "Admission number", "Student name", "Class", ...exams.map(examColumnLabel), "Remarks", "Example only"];
    const sheet = workbook.addWorksheet(label);
    sheet.addRow(headers);
    sheet.addRow(["", "ADM-001", "Aarav Sharma (example)", label, ...exams.map((exam, index) => index === 0 ? Math.min(72, exam.maxMarks) : ""), "", "YES"]);
    klass.students.forEach((student, studentIndex) => {
      sheet.addRow([
        student.id,
        student.admissionNo,
        student.name,
        label,
        ...exams.map((exam, examIndex) => options.sampleData ? sampleExamMark(studentIndex, examIndex, exam.maxMarks) : ""),
        "",
        "",
      ]);
    });
    applyHeaderStyle(sheet);
    sheet.columns = headers.map((header, index) => ({ header, key: normalizeHeader(header), width: index < 4 ? Math.max(18, header.length + 2) : Math.max(16, Math.min(28, header.length + 2)) }));
  }
  return workbook;
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
  if (kind === "attendance") {
    const workbook = await attendanceTemplateWorkbook(options);
    return {
      fileName: xlsxFileName(kind),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }
  if (kind === "staff_attendance") {
    const workbook = await staffAttendanceTemplateWorkbook(options);
    return {
      fileName: xlsxFileName(kind),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }
  if (kind === "exam_marks") {
    const workbook = await examMarksTemplateWorkbook(options);
    return {
      fileName: xlsxFileName(kind),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }
  const classes = await prisma.class.findMany({
    where: { archivedAt: null },
    orderBy: [{ name: "asc" }, { section: "asc" }],
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Anekio";
  const labels = classes.length ? [...new Set(classes.map((row) => `${row.name}-${row.section}`))] : ["1-A", "2-A", "3-A", "4-A", "5-A"];
  if (kind === "opening_balances") {
    const openingWorkbook = await openingBalanceTemplateWorkbook(labels, options);
    return {
      fileName: xlsxFileName(kind),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await openingWorkbook.xlsx.writeBuffer()),
    };
  }
  if (kind !== "students") {
    const blankRows = blankRowsFor(kind, labels);
    const rows = options.sampleData && kind === "teachers"
      ? blankRows
      : options.sampleData || !blankRows.length
        ? await csvRowsFor(kind)
        : blankRows;
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
  if (kind === "students" || kind === "attendance" || kind === "exam_marks" || kind === "opening_balances") {
    const studentsSheet = kind === "students" ? workbook.getWorksheet(TEMPLATE_DETAILS.students.sheet) : undefined;
    const openingSheet = kind === "opening_balances" ? workbook.getWorksheet(TEMPLATE_DETAILS.opening_balances.sheet) : undefined;
    const namedSheet = studentsSheet || openingSheet;
    const sheets = namedSheet ? [namedSheet] : workbook.worksheets.filter((sheet) => Boolean(parseClass(sheet.name)));
    if (!sheets.length) {
      throw new Error(kind === "students" ? "This workbook needs a Students sheet, or tabs named like 1-A, 1-B, 2-C." : "This workbook needs class tabs named like 1-A, 1-B, 2-C.");
    }
    return realRows(sheets.flatMap((sheet) => rowsFromWorksheet(sheet, namedSheet ? "" : sheet.name)));
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

function onboardingImportWriteError(row: ImportRow, error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.map(String).join(", ") : "email or mobile";
    return new Error(rowError(row, `${target} is already used by another account. Use the existing ID or change the duplicate contact detail.`));
  }
  return error;
}

function attendanceDateFromHeader(header: string) {
  if (/^\d{8}$/.test(header)) return `${header.slice(0, 4)}-${header.slice(4, 6)}-${header.slice(6, 8)}`;
  return "";
}

function attendanceCells(row: ImportRow) {
  return Object.entries(row)
    .map(([key, value]) => ({ date: attendanceDateFromHeader(key), value: value.trim() }))
    .filter((cell) => cell.date);
}

function examMarkValue(value: string) {
  const raw = value.trim();
  const normalized = raw.toUpperCase().replace(/[\s_-]+/g, "");
  if (!raw || raw === "-") return { skip: true, absent: false, marks: 0 };
  if (["A", "AB", "ABSENT"].includes(normalized)) return { skip: false, absent: true, marks: 0 };
  const marks = Number(raw);
  return Number.isFinite(marks) ? { skip: false, absent: false, marks } : null;
}

async function examMarkColumns(): Promise<ExamMarkColumn[]> {
  const orgId = currentTenantOrg();
  const session = await (orgId ? runWithoutTenant(() => prisma.schoolSession.findFirst({
    where: { current: true, orgId },
    orderBy: { startsOn: "desc" },
  })) : prisma.schoolSession.findFirst({
    where: { current: true },
    orderBy: { startsOn: "desc" },
  }));
  if (!session) return [];
  const where: Prisma.ExamWhereInput = {
    series: { sessionId: session.id, ...(orgId ? { orgId } : {}) },
  };
  const exams = await (orgId ? runWithoutTenant(() => prisma.exam.findMany({
    where,
    include: { subject: true, series: true, class: true },
    orderBy: [{ classId: "asc" }, { date: "asc" }, { title: "asc" }],
  })) : prisma.exam.findMany({
    where,
    include: { subject: true, series: true, class: true },
    orderBy: [{ classId: "asc" }, { date: "asc" }, { title: "asc" }],
  }));
  return exams.map((exam) => {
    const label = examColumnLabel(exam);
    return { key: normalizeHeader(label), examId: exam.id, classId: exam.classId, classLabel: `${exam.class.name}-${exam.class.section}`, maxMarks: exam.maxMarks, label };
  });
}

function examMarkCells(row: ImportRow, columns: ExamMarkColumn[]) {
  const rowClass = parseClass(sheetCell(row, "Class"));
  const classLabel = rowClass ? `${rowClass.name}-${rowClass.section}` : "";
  return columns
    .filter((column) => !classLabel || column.classLabel === classLabel)
    .map((column) => ({ ...column, value: row[column.key]?.trim() || "" }))
    .filter((cell) => cell.value);
}

function parseAttendanceMark(value: string): AttendanceImportMark | null {
  const mark = value.trim().toUpperCase().replace(/[\s_-]+/g, "");
  if (!mark || mark === "-") return null;
  if (["H", "HOLIDAY", "OFF", "CLOSED"].includes(mark)) return "HOLIDAY";
  if (["P", "PRESENT"].includes(mark)) return AttendanceStatus.PRESENT;
  if (["A", "ABSENT"].includes(mark)) return AttendanceStatus.ABSENT;
  if (["LT", "LATE"].includes(mark)) return AttendanceStatus.LATE;
  if (["L", "LEAVE"].includes(mark)) return AttendanceStatus.LEAVE;
  if (["HD", "HALF", "HALFDAY"].includes(mark)) return AttendanceStatus.HALF_DAY;
  return null;
}

function normalizeStaffKind(value: string): StaffAttendancePerson["kind"] | "" {
  const kind = value.trim().toLowerCase();
  if (["teacher", "teaching"].includes(kind)) return "teacher";
  if (["staff", "employee", "support", "office"].includes(kind)) return "staff";
  return "";
}

async function staffAttendancePeople(db: Pick<typeof prisma, "teacher" | "staffMember"> = prisma): Promise<StaffAttendancePerson[]> {
  const [teachers, staffMembers] = await Promise.all([
    db.teacher.findMany({ include: { user: { include: { role: true } }, class: true } }),
    db.staffMember.findMany({ where: { archivedAt: null }, include: { role: true, user: { include: { role: true } } } }),
  ]);
  return [
    ...teachers.map((teacher) => ({
      kind: "teacher" as const,
      id: teacher.id,
      employeeId: teacher.employeeId,
      name: teacher.user.name,
      role: teacher.class ? `Class teacher ${teacher.class.name}-${teacher.class.section}` : roleLabel(teacher.user.role),
    })),
    ...staffMembers.map((staff) => ({
      kind: "staff" as const,
      id: staff.id,
      employeeId: staff.employeeId,
      name: staff.name,
      role: staff.role ? roleLabel(staff.role) : staff.user?.role ? roleLabel(staff.user.role) : staff.title || "Staff",
    })),
  ];
}

function resolveStaffAttendancePerson(row: ImportRow, people: StaffAttendancePerson[]) {
  const kind = normalizeStaffKind(sheetCell(row, "Staff type", "Type", "Kind"));
  const staffId = sheetCell(row, "Anekio staff ID", "Staff ID", "Anekio employee ID");
  const employeeId = sheetCell(row, "Employee ID", "Employee number").toLowerCase();
  const byId = staffId ? people.filter((person) => person.id === staffId) : [];
  const byEmployee = employeeId ? people.filter((person) => person.employeeId.toLowerCase() === employeeId) : [];
  const matches = (byId.length ? byId : byEmployee).filter((person) => !kind || person.kind === kind);
  return matches.length === 1 ? matches[0] : null;
}

async function validateRows(kind: ImportKind, rows: ImportRow[]) {
  const errors: string[] = [];
  const roles = kind === "teachers" ? await staffImportRoles() : [];
  const students = kind === "opening_balances" || kind === "students" || kind === "attendance"
    ? await prisma.student.findMany({ select: { id: true, admissionNo: true } })
    : [];
  const examStudents = kind === "exam_marks"
    ? await prisma.student.findMany({ select: { id: true, admissionNo: true, classId: true } })
    : [];
  const examColumns = kind === "exam_marks" ? await examMarkColumns() : [];
  const examsById = kind === "exam_marks" && examColumns.length
    ? new Map((await prisma.exam.findMany({ where: { id: { in: examColumns.map((column) => column.examId) } }, select: { id: true, classId: true, maxMarks: true } })).map((exam) => [exam.id, exam]))
    : new Map<string, { id: string; classId: string; maxMarks: number }>();
  const staffPeople = kind === "staff_attendance" ? await staffAttendancePeople() : [];
  const studentIds = new Set(students.map((row) => row.id));
  const admissionNos = new Set(students.map((row) => row.admissionNo.toLowerCase()));
  const examStudentsById = new Map(examStudents.map((row) => [row.id, row]));
  const examStudentsByAdmission = new Map(examStudents.map((row) => [row.admissionNo.toLowerCase(), row]));
  const classTeacherRows = new Map<string, string>();

  if (kind === "exam_marks") {
    if (!examColumns.length) {
      return ["No saved exam papers were found for this school. Schedule the past exam papers in Exams, then download a fresh exam marks template."];
    }
    const hasGeneratedMarkColumn = rows.some((row) =>
      examColumns.some((column) => Object.prototype.hasOwnProperty.call(row, column.key))
    );
    if (!hasGeneratedMarkColumn) {
      return ["This file does not contain the generated exam mark columns for saved exams. Download the latest exam marks template or test data, fill marks, then upload that file."];
    }
  }

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
    if (kind === "attendance") {
      const studentId = sheetCell(row, "Anekio student ID");
      const admissionNo = sheetCell(row, "Admission number", "Admission no").toLowerCase();
      if ((!studentId || !studentIds.has(studentId)) && (!admissionNo || !admissionNos.has(admissionNo))) {
        errors.push(rowError(row, "student ID or admission number was not found."));
      }
      const cells = attendanceCells(row);
      if (!cells.length) errors.push(rowError(row, "at least one date column is required."));
      for (const cell of cells) {
        if (!validDate(cell.date)) errors.push(rowError(row, `${cell.date} is not a valid date column.`));
        if (cell.date > dateText(new Date())) errors.push(rowError(row, `${cell.date} cannot be in the future.`));
        if (cell.value && !parseAttendanceMark(cell.value)) errors.push(rowError(row, `${cell.date} must be P, A, H, L, LT, or half day.`));
      }
      return;
    }
    if (kind === "staff_attendance") {
      const rawKind = sheetCell(row, "Staff type", "Type", "Kind");
      if (rawKind && !normalizeStaffKind(rawKind)) errors.push(rowError(row, "staff type must be teacher or staff."));
      if (!resolveStaffAttendancePerson(row, staffPeople)) {
        errors.push(rowError(row, "staff ID or employee ID was not found."));
      }
      const cells = attendanceCells(row);
      if (!cells.length) errors.push(rowError(row, "at least one date column is required."));
      for (const cell of cells) {
        if (!validDate(cell.date)) errors.push(rowError(row, `${cell.date} is not a valid date column.`));
        if (cell.date > dateText(new Date())) errors.push(rowError(row, `${cell.date} cannot be in the future.`));
        if (cell.value && !parseAttendanceMark(cell.value)) errors.push(rowError(row, `${cell.date} must be P, A, H, L, LT, or half day.`));
      }
      return;
    }
    if (kind === "exam_marks") {
      const studentId = sheetCell(row, "Anekio student ID");
      const admissionNo = sheetCell(row, "Admission number", "Admission no").toLowerCase();
      const student = studentId ? examStudentsById.get(studentId) : admissionNo ? examStudentsByAdmission.get(admissionNo) : null;
      if (!student) {
        errors.push(rowError(row, "student ID or admission number was not found."));
        return;
      }
      const cells = examMarkCells(row, examColumns);
      for (const cell of cells) {
        const exam = examsById.get(cell.examId);
        const parsed = examMarkValue(cell.value);
        if (!exam) errors.push(rowError(row, `${cell.label} no longer exists.`));
        else if (exam.classId !== student.classId) errors.push(rowError(row, `${cell.label} does not belong to this student's class.`));
        else if (!parsed) errors.push(rowError(row, `${cell.label} must be a number, Ab, or blank.`));
        else if (!parsed.skip && !parsed.absent && (parsed.marks < 0 || parsed.marks > exam.maxMarks)) errors.push(rowError(row, `${cell.label} must be between 0 and ${exam.maxMarks}.`));
      }
      return;
    }
    if (kind === "teachers") {
      if (!sheetCell(row, "Teacher name", "Name")) errors.push(rowError(row, "name is required."));
      if (!normalizeMobile(sheetCell(row, "Mobile", "Phone"))) errors.push(rowError(row, "mobile must be a 10-digit number."));
      if (!resolveStaffImportRole(roles, row)) errors.push(rowError(row, "role must be one of the office or teacher roles."));
      const classText = sheetCell(row, "Class teacher of", "Class teacher", "Class");
      const klass = classText ? parseClass(classText) : null;
      if (classText && !klass) errors.push(rowError(row, "class teacher value must look like 1-A."));
      if (klass) {
        const classKey = `${klass.name}-${klass.section}`;
        const firstRow = classTeacherRows.get(classKey);
        if (firstRow) errors.push(rowError(row, `${classKey} already has a class teacher in row ${firstRow}.`));
        else classTeacherRows.set(classKey, row._row);
      }
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

export async function ensureOnboardingState(user: AccessUser) {
  const orgId = await onboardingOrgId(user);
  const id = onboardingStateId(orgId);
  const legacy = await runWithoutTenant(() =>
    prisma.schoolOnboardingState.findUnique({
      where: { id: ONBOARDING_STATE_ID },
      select: { orgId: true, selectedModulesJson: true },
    })
  );
  const selectedModulesJson = legacy && (!legacy.orgId || legacy.orgId === orgId) ? legacy.selectedModulesJson : undefined;
  return prisma.schoolOnboardingState.upsert({
    where: { id },
    update: { orgId },
    create: { id, orgId, ...(selectedModulesJson ? { selectedModulesJson } : {}) },
  });
}

async function onboardingOrgId(user: AccessUser) {
  const orgId = user.orgId || "";
  if (!orgId) throw new Error("Your login is not linked to a school organisation. Sign in again with a school admin account.");
  const org = await prisma.saasOrg.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) throw new Error("Your login is linked to an organisation that was not found. Sign in again or repair this user's organisation.");
  return org.id;
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
  const state = await ensureOnboardingState(user);
  const orgId = await onboardingOrgId(user);
  const batch = await prisma.schoolOnboardingImport.create({
    data: {
      orgId,
      stateId: state.id,
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
  const [students, teachers, staffMembers] = await runWithoutTenant(() => Promise.all([
    prisma.student.findMany({ select: { admissionNo: true } }),
    prisma.teacher.findMany({ select: { employeeId: true } }),
    prisma.staffMember.findMany({ select: { employeeId: true } }),
  ]));
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
  setup: { orgId: string; roleId: string; password: string; admission: number }
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
    const user = await db.user.findFirst({ where: { orgId: setup.orgId, OR: [{ email }, { phone }] }, include: { parent: true } });
    let parentId = user?.parent?.id || "";
    if (user && !parentId) throw new Error(rowError(row, `${user.email} is already used by a non-parent account.`));
    if (!parentId) {
      let parentUser: { parent: { id: string } | null };
      try {
        parentUser = await db.user.create({
          data: {
            orgId: setup.orgId,
            name: sheetCell(row, "Parent name"),
            email,
            phone,
            password: setup.password,
            roleId: setup.roleId,
            parent: { create: { orgId: setup.orgId, phone } },
          },
          include: { parent: true },
        });
      } catch (error) {
        throw onboardingImportWriteError(row, error);
      }
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
      orgId: setup.orgId,
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
  setup: { orgId: string; password: string; employee: number; staffEmployee: number; roles: StaffImportRole[] }
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
        await db.user.update({ where: { id: existing.userId }, data: { orgId: setup.orgId, name, email, phone, roleId: role.id } });
        await db.teacher.update({
          where: { id: existing.id },
          data: { orgId: setup.orgId, employeeId, monthlySalary: salary, qualification: sheetCell(row, "Qualification") || null, ...(classRow ? { classId: classRow.id } : {}) },
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
        let createdUser: { teacher: { id: string } | null };
        try {
          createdUser = await db.user.create({
            data: {
              orgId: setup.orgId,
              name,
              email,
              phone,
              password: setup.password,
              roleId: role.id,
              teacher: {
                create: {
                  orgId: setup.orgId,
                  employeeId,
                  monthlySalary: salary,
                  qualification: sheetCell(row, "Qualification") || null,
                  ...(classRow ? { classId: classRow.id } : {}),
                },
              },
            },
            include: { teacher: true },
          });
        } catch (error) {
          throw onboardingImportWriteError(row, error);
        }
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
        if (existing.userId) await db.user.update({ where: { id: existing.userId }, data: { orgId: setup.orgId, name, email, phone, roleId: role.id } });
        await db.staffMember.update({
          where: { id: existing.id },
          data: { orgId: setup.orgId, name, title: role.name, phone, employeeId, roleId: role.id, monthlySalary: salary, kind: "OFFICE", archivedAt: null },
        });
        updated += 1;
      } else {
        try {
          await db.user.create({
            data: {
              orgId: setup.orgId,
              name,
              email,
              phone,
              password: setup.password,
              roleId: role.id,
              staffMember: { create: { orgId: setup.orgId, name, title: role.name, phone, employeeId, roleId: role.id, monthlySalary: salary, kind: "OFFICE" } },
            },
          });
        } catch (error) {
          throw onboardingImportWriteError(row, error);
        }
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

async function applyAttendance(db: OnboardingDb, rows: ImportRow[], user: AccessUser) {
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const studentId = sheetCell(row, "Anekio student ID");
    const admissionNo = sheetCell(row, "Admission number", "Admission no");
    const student = studentId
      ? await db.student.findUnique({ where: { id: studentId }, select: { id: true } })
      : await db.student.findUnique({ where: { admissionNo }, select: { id: true } });
    if (!student) throw new Error(rowError(row, "student no longer exists."));
    for (const cell of attendanceCells(row)) {
      const status = parseAttendanceMark(cell.value);
      if (!status || status === "HOLIDAY") continue;
      const date = new Date(`${cell.date}T00:00:00`);
      const existing = await db.attendance.findUnique({ where: { studentId_date: { studentId: student.id, date } }, select: { id: true } });
      await db.attendance.upsert({
        where: { studentId_date: { studentId: student.id, date } },
        update: { status, markedById: user.id },
        create: { orgId: user.orgId ?? null, studentId: student.id, date, status, markedById: user.id },
      });
      if (existing) updated += 1;
      else created += 1;
    }
  }
  return { created, updated };
}

async function applyStaffAttendance(db: OnboardingDb, rows: ImportRow[], user: AccessUser) {
  let created = 0;
  let updated = 0;
  const people = await staffAttendancePeople(db);
  for (const row of rows) {
    const person = resolveStaffAttendancePerson(row, people);
    if (!person) throw new Error(rowError(row, "staff no longer exists."));
    for (const cell of attendanceCells(row)) {
      const status = parseAttendanceMark(cell.value);
      if (!status || status === "HOLIDAY") continue;
      const date = new Date(`${cell.date}T00:00:00`);
      const where = person.kind === "teacher"
        ? { teacherId_date: { teacherId: person.id, date } }
        : { staffId_date: { staffId: person.id, date } };
      const existing = await db.staffDay.findUnique({ where, select: { id: true } });
      await db.staffDay.upsert({
        where,
        update: { status, markedById: user.id, inAt: "", outAt: "", startTimeUsed: "", computedStatus: null },
        create: {
          orgId: user.orgId ?? null,
          teacherId: person.kind === "teacher" ? person.id : null,
          staffId: person.kind === "staff" ? person.id : null,
          date,
          status,
          markedById: user.id,
        },
      });
      if (existing) updated += 1;
      else created += 1;
    }
  }
  return { created, updated };
}

async function applyExamMarks(db: OnboardingDb, rows: ImportRow[], user: AccessUser) {
  let created = 0;
  let updated = 0;
  const [columns, students] = await Promise.all([
    examMarkColumns(),
    db.student.findMany({ select: { id: true, admissionNo: true, classId: true } }),
  ]);
  const studentsById = new Map(students.map((row) => [row.id, row]));
  const studentsByAdmission = new Map(students.map((row) => [row.admissionNo.toLowerCase(), row]));
  const touchedExamIds = new Set<string>();
  for (const row of rows) {
    const studentId = sheetCell(row, "Anekio student ID");
    const admissionNo = sheetCell(row, "Admission number", "Admission no").toLowerCase();
    const student = studentId ? studentsById.get(studentId) : studentsByAdmission.get(admissionNo);
    if (!student) throw new Error(rowError(row, "student no longer exists."));
    for (const cell of examMarkCells(row, columns)) {
      const parsed = examMarkValue(cell.value);
      if (!parsed || parsed.skip) continue;
      const existing = await db.examResult.findUnique({ where: { examId_studentId: { examId: cell.examId, studentId: student.id } }, select: { id: true } });
      await db.examResult.upsert({
        where: { examId_studentId: { examId: cell.examId, studentId: student.id } },
        update: { marks: parsed.absent ? 0 : parsed.marks, absent: parsed.absent, remarks: sheetCell(row, "Remarks") || null },
        create: {
          orgId: user.orgId ?? null,
          examId: cell.examId,
          studentId: student.id,
          marks: parsed.absent ? 0 : parsed.marks,
          absent: parsed.absent,
          remarks: sheetCell(row, "Remarks") || null,
        },
      });
      touchedExamIds.add(cell.examId);
      if (existing) updated += 1;
      else created += 1;
    }
  }
  if (touchedExamIds.size) {
    await db.exam.updateMany({
      where: { id: { in: [...touchedExamIds] }, workflowStatus: { in: [ExamWorkflowStatus.SCHEDULED, ExamWorkflowStatus.IN_PROGRESS] } },
      data: { workflowStatus: ExamWorkflowStatus.MARKS_DRAFT, marksGrantedAt: new Date(), conductedAt: new Date() },
    });
  }
  return { created, updated };
}

function onboardingApplyErrorMessage(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025" || error.code === "P2003") {
      return "Import could not be applied because one of the linked records changed after review. Download the latest template, review it again, and apply.";
    }
    if (error.code === "P2028") {
      return "Import took too long to apply. Try again, or split the file into smaller date ranges if it still fails.";
    }
  }
  const message = error instanceof Error ? error.message : "";
  if (/Record not found/i.test(message)) {
    return "Import could not be applied because one of the linked records changed after review. Download the latest template, review it again, and apply.";
  }
  if (/Transaction.*not found|closed transaction|timed out/i.test(message)) {
    return "Import took too long to apply. Try again, or split the file into smaller date ranges if it still fails.";
  }
  return message || "Import failed.";
}

export async function applyOnboardingImport(user: AccessUser, input: { batchId?: string }) {
  need(user);
  const batchId = String(input.batchId || "");
  const orgId = await onboardingOrgId(user);
  const batch = await prisma.schoolOnboardingImport.findUnique({ where: { id: batchId } });
  if (!batch) throw new Error("Import review not found.");
  if (batch.orgId && batch.orgId !== orgId) throw new Error("Import review not found.");
  if (batch.status === "APPLIED") throw new Error("This import was already applied.");
  const errors = JSON.parse(batch.errorsJson) as string[];
  if (errors.length && batch.status !== "FAILED") throw new Error("Fix the review errors and upload the template again.");
  const kind = asKind(batch.kind);
  const rows = JSON.parse(batch.rowsJson) as ImportRow[];
  try {
    const codes = kind === "students" || kind === "teachers" ? await nextCodes() : null;
    const peopleSetup = kind === "students"
      ? { orgId, roleId: await roleIdBySlug("PARENT"), password: await bcrypt.hash("12345", 10), admission: codes!.admission }
      : kind === "teachers"
        ? { orgId, password: await bcrypt.hash("12345", 10), employee: codes!.employee, staffEmployee: codes!.staffEmployee, roles: await staffImportRoles() }
        : null;
    const result = await prisma.$transaction(async (db) => kind === "classes"
      ? applyClasses(db, rows)
      : kind === "students"
        ? applyStudents(db, rows, peopleSetup as { orgId: string; roleId: string; password: string; admission: number })
        : kind === "teachers"
          ? applyTeachers(db, rows, peopleSetup as { orgId: string; password: string; employee: number; staffEmployee: number; roles: StaffImportRole[] })
          : kind === "attendance"
            ? applyAttendance(db, rows, user)
            : kind === "staff_attendance"
              ? applyStaffAttendance(db, rows, user)
              : kind === "exam_marks"
                ? applyExamMarks(db, rows, user)
          : kind === "class_teachers"
            ? applyClassTeachers(db, rows)
            : applyOpeningBalances(db, rows, orgId), { maxWait: 10_000, timeout: 60_000 });
    await prisma.schoolOnboardingImport.update({
      where: { id: batch.id },
      data: { status: "APPLIED", appliedAt: new Date(), createdCount: result.created, updatedCount: result.updated, errorsJson: "[]" },
    });
    return { ...result, batchId: batch.id };
  } catch (error) {
    const message = onboardingApplyErrorMessage(error);
    await prisma.schoolOnboardingImport.update({
      where: { id: batch.id },
      data: { status: "FAILED", errorsJson: JSON.stringify([message]) },
    });
    throw new Error(message);
  }
}

export async function saveOnboardingPlan(user: AccessUser, input: { modules?: unknown }) {
  need(user);
  const requested = Array.isArray(input.modules) ? input.modules.map(String) : [];
  const state = await ensureOnboardingState(user);
  const current = parsePlanState(state.selectedModulesJson);
  const modules = requested.length ? DEFAULT_ONBOARDING_MODULES : current.modules;
  const selectedModulesJson = serializePlanState({ modules, manualSteps: current.manualSteps });
  const orgId = await onboardingOrgId(user);
  const saved = await prisma.schoolOnboardingState.upsert({
    where: { id: state.id },
    update: { orgId, selectedModulesJson },
    create: { id: state.id, orgId, selectedModulesJson },
  });
  return parsePlanState(saved.selectedModulesJson);
}

export async function toggleOnboardingStep(user: AccessUser, input: { key?: unknown; complete?: unknown }) {
  need(user);
  const key = String(input.key || "") as OnboardingStepKey;
  if (!ONBOARDING_STEP_KEYS.has(key)) throw new Error("Choose a valid onboarding step.");
  const state = await ensureOnboardingState(user);
  const current = parsePlanState(state.selectedModulesJson);
  const manual = new Set(current.manualSteps);
  if (input.complete === false) manual.delete(key);
  else manual.add(key);
  const orgId = await onboardingOrgId(user);
  const saved = await prisma.schoolOnboardingState.upsert({
    where: { id: state.id },
    update: { orgId, selectedModulesJson: serializePlanState({ modules: current.modules, manualSteps: [...manual] }) },
    create: { id: state.id, orgId, selectedModulesJson: serializePlanState({ modules: current.modules, manualSteps: [...manual] }) },
  });
  return parsePlanState(saved.selectedModulesJson);
}

export async function onboardingBundle(user: AccessUser) {
  need(user);
  const state = await ensureOnboardingState(user);
  const schoolId = String((user as AccessUser & { schoolId?: string | null }).schoolId || "school");
  const importantDocumentTypes = [
    "FEE_INVOICE",
    "PAYMENT_RECEIPT",
    "STUDENT_ID",
    "ADMIT_CARD",
    "ADMISSION_CONFIRMATION",
    "EMPLOYEE_ID",
    "SALARY_SLIP",
    "REPORT_CARD",
    "EXAM_DATE_SHEET",
    "CONSOLIDATED_REPORT",
  ];
  const [school, classCount, studentCount, teacherCount, staffMemberCount, attendanceCount, staffAttendanceCount, currentSession, holidayCount, examCount, examMarkCount, templateCount, openingCount, documentTemplates, latestImports, latestSheets] = await Promise.all([
    prisma.schoolConfig.findUnique({
      where: { id: "school" },
      select: {
        name: true,
        weekdays: true,
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
    prisma.staffMember.count({ where: { archivedAt: null } }),
    prisma.attendance.count(),
    prisma.staffDay.count(),
    prisma.schoolSession.findFirst({ where: { current: true }, select: { examPlanJson: true } }),
    prisma.schoolHoliday.count(),
    prisma.examSeries.count({ where: { exams: { some: {} } } }),
    prisma.examResult.count(),
    prisma.feeTemplate.count(),
    prisma.feeInvoice.count({ where: { period: "OPENING" } }),
    prisma.documentTemplate.findMany({ where: { schoolId, status: "ACTIVE", type: { in: importantDocumentTypes } }, select: { type: true } }),
    prisma.schoolOnboardingImport.findMany({ where: { stateId: state.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.onboardingGoogleSheet.findMany({ where: { stateId: state.id }, orderBy: { createdAt: "desc" }, take: 8 }),
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
  const savedDocumentTypes = new Set(documentTemplates.map((row) => row.type));
  const hasInvoiceDocument = savedDocumentTypes.has("FEE_INVOICE");
  const hasReceiptDocument = savedDocumentTypes.has("PAYMENT_RECEIPT");
  const hasFeeDocuments = hasInvoiceDocument && hasReceiptDocument;
  const hasStudentIdDocument = savedDocumentTypes.has("STUDENT_ID");
  const hasStudentAdmitCardDocument = savedDocumentTypes.has("ADMIT_CARD");
  const hasAdmissionConfirmationDocument = savedDocumentTypes.has("ADMISSION_CONFIRMATION");
  const hasStaffIdDocument = savedDocumentTypes.has("EMPLOYEE_ID");
  const hasSalarySlipDocument = savedDocumentTypes.has("SALARY_SLIP");
  const hasReportCardDocument = savedDocumentTypes.has("REPORT_CARD");
  const hasExamDateSheetDocument = savedDocumentTypes.has("EXAM_DATE_SHEET");
  const hasConsolidatedReportDocument = savedDocumentTypes.has("CONSOLIDATED_REPORT");
  const hasImportantDocuments = importantDocumentTypes.every((type) => savedDocumentTypes.has(type));
  const staffCount = teacherCount + staffMemberCount;
  const hasWorkingDays = parseWeekdays(school?.weekdays).length > 0;
  const hasHolidayCalendar = holidayCount > 0 || manualDone.has("holiday_calendar");
  const hasStudentAttendanceHistory = attendanceCount > 0 || importDone.has("attendance");
  const hasStaffAttendanceHistory = staffAttendanceCount > 0 || importDone.has("staff_attendance");
  const currentExamPlan = parseExamPlan(currentSession?.examPlanJson, false);
  const hasExamPlan = currentExamPlan.length > 0 && examPlanWeight(currentExamPlan) === 100 && currentExamPlan.every((row) => row.maxMarks > 0 && row.expectedPeriod);
  const hasExamHistory = examCount > 0;
  const hasExamMarksHistory = examMarkCount > 0 || importDone.has("exam_marks");
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
    manualAllowed = true,
  ) => ({
    key,
    area,
    number,
    title,
    body,
    target,
    dataComplete: complete,
    manualComplete: manualAllowed && manualDone.has(key),
    missingReason,
    manualAllowed,
    status: complete || (manualAllowed && manualDone.has(key)) ? "complete" : blocked ? "blocked" : "ready",
  });
  const steps = [
    step("school", "school", 1, "Identity & brand assets", "Confirm school name, contact details, logo, signatures, and stamps.", Boolean(school?.name && school.name !== "School"), false, "School identity appears on receipts, documents, logins, and parent-facing pages.", { href: "/school?tab=identity", label: "Open identity" }),
    step("sessions", "school", 2, "Sessions", "Create the current academic session before planning classes, attendance, and exams.", Boolean(currentSession), false, "A current session anchors classes, holidays, exams, attendance, and fee cycles.", { href: "/school?tab=sessions", label: "Open sessions" }),
    step("classes", "school", 3, "Classes", "Create classes in School setup, or let student and staff sheets create valid class labels like 1-A.", classCount > 0, false, "Classes connect students, teachers, fees, attendance, exams, and document batches.", { href: "/school?tab=classes", label: "Open classes" }),
    step("working_days", "school", 4, "Clock", "Choose school days and bell times before attendance templates are generated.", hasWorkingDays, !hasWorkingDays, "Attendance uses Clock working days to prefill school days and weekly offs.", { href: "/school?tab=clock", label: "Open clock" }, false),
    step("holiday_calendar", "school", 5, "Calendar", "Add or import holidays before attendance templates are generated.", hasHolidayCalendar, !hasHolidayCalendar, "Attendance imports need holidays marked first so those dates are skipped.", { href: "/school?tab=calendar", label: "Open calendar" }),
    step("students", "teaching", 6, "Students and parents", "Import family records with generated admission numbers when needed.", studentCount > 0 || importDone.has("students"), false, "Students and parent links are needed for attendance, fees, notices, documents, and parent app access.", { href: "/people", label: "Open students" }),
    step("student_id_document", "teaching", 7, "Student ID card template", "Save and publish the student ID card template.", hasStudentIdDocument, !hasStudentIdDocument, "Student ID cards need a published template before the office can issue cards.", { href: "/school?tab=documents&document=STUDENT_ID", label: "Open student ID template" }, false),
    step("student_admit_card_document", "teaching", 8, "Student admit card template", "Save and publish the student admit card template.", hasStudentAdmitCardDocument, !hasStudentAdmitCardDocument, "Admit cards need a published template before exams can issue hall tickets.", { href: "/school?tab=documents&document=ADMIT_CARD", label: "Open admit card template" }, false),
    step("admission_confirmation_document", "teaching", 9, "Admission confirmation template", "Save and publish the admission confirmation template.", hasAdmissionConfirmationDocument, !hasAdmissionConfirmationDocument, "Admission confirmation needs a published template before admitted families can receive it.", { href: "/school?tab=documents&document=ADMISSION_CONFIRMATION", label: "Open admission template" }, false),
    step("teachers", "teaching", 10, "Staff", "Import staff records with role and class-teacher columns when needed.", staffCount > 0 || importDone.has("teachers"), false, "Staff are needed for class ownership, timetable, attendance, payroll, and documents.", { href: "/staff", label: "Open staff" }),
    step("staff_id_document", "teaching", 11, "Staff ID card template", "Save and publish the staff ID card template.", hasStaffIdDocument, !hasStaffIdDocument, "Staff ID cards need a published template before the office can issue cards.", { href: "/school?tab=documents&document=EMPLOYEE_ID", label: "Open staff ID template" }, false),
    step("salary_slip_document", "teaching", 12, "Salary slip template", "Save and publish the salary slip template.", hasSalarySlipDocument, !hasSalarySlipDocument, "Salary slips need a published template before payroll documents can be issued.", { href: "/school?tab=documents&document=SALARY_SLIP", label: "Open salary slip template" }, false),
    step("attendance", "teaching", 13, "Student attendance history", "Import old student attendance with class sheets, holiday calendar days, and dates through today.", hasStudentAttendanceHistory && hasWorkingDays && hasHolidayCalendar, studentCount === 0 || classCount === 0 || !hasWorkingDays || !hasHolidayCalendar, "Student attendance history needs classes, students, working days, and the holiday calendar first.", { href: "/attendance", label: "Open student attendance" }),
    step("staff_attendance", "teaching", 14, "Staff attendance history", "Import old staff attendance with holidays already marked through today.", hasStaffAttendanceHistory && hasWorkingDays && hasHolidayCalendar, staffCount === 0 || !hasWorkingDays || !hasHolidayCalendar, "Staff attendance history needs staff, working days, and the holiday calendar first.", { href: "/staff", label: "Open staff attendance" }),
    step("exam_plan", "exams", 15, "This year's exam plan", "Save the session plan with exam sittings, result weight, maximum marks, and expected periods.", hasExamPlan, classCount === 0, "Create classes first, then save this year's exam plan.", { href: "/school?tab=exams", label: "Open year plan" }),
    step("exam_marks", "exams", 16, "Exam marks history", "Download the marks sheet generated from saved exam history, then upload completed marks for review.", hasExamMarksHistory, studentCount === 0 || !hasExamPlan || !hasExamHistory, "Save this year's exam plan, schedule past exams, and add students before importing marks.", { href: "/exams", label: "Open marks import" }),
    step("report_card_document", "exams", 17, "Report card template", "Save and publish the report card template.", hasReportCardDocument, !hasReportCardDocument, "Report cards need a published template before results can be shared.", { href: "/school?tab=documents&document=REPORT_CARD", label: "Open report card template" }, false),
    step("exam_date_sheet_document", "exams", 18, "Exam date sheet template", "Save and publish the exam date sheet template.", hasExamDateSheetDocument, !hasExamDateSheetDocument, "Exam date sheets need a published template before schedules can be issued.", { href: "/school?tab=documents&document=EXAM_DATE_SHEET", label: "Open date sheet template" }, false),
    step("consolidated_report_document", "exams", 19, "Consolidated report card template", "Save and publish the consolidated report card template.", hasConsolidatedReportDocument, !hasConsolidatedReportDocument, "Consolidated report cards need a published template before full-session results can be shared.", { href: "/school?tab=documents&document=CONSOLIDATED_REPORT", label: "Open consolidated report template" }, false),
    step("collection_account", "money", 20, "Bank and collection account", "Add UPI, bank account, or the school's payment gateway before asking parents to pay.", hasUpi || hasBank || hasGateway, false, "Collection details appear on pay pages, invoices, receipts, and office collection workflows.", { href: "/school?tab=collect", label: "Open collection setup" }),
    step("fee_invoice_document", "money", 21, "Fee invoice template", "Save and publish the fee invoice template before the first billing cycle.", hasInvoiceDocument, !hasInvoiceDocument, "Fee invoice template is required before fee setup can continue.", { href: "/school?tab=documents&document=FEE_INVOICE", label: "Open invoice template" }, false),
    step("payment_receipt_document", "money", 22, "Payment receipt template", "Save and publish the payment receipt template before the first billing cycle.", hasReceiptDocument, !hasReceiptDocument, "Payment receipt template is required before fee setup can continue.", { href: "/school?tab=documents&document=PAYMENT_RECEIPT", label: "Open receipt template" }, false),
    step("opening_balances", "money", 23, "First time fee import", "Put any previous-system dues in a backlog invoice and tell Anekio the last month already invoiced.", importDone.has("opening_balances") || (studentCount > 0 && openingCount >= studentCount), studentCount === 0, "Opening balances prevent missed old dues and duplicate first invoices.", { href: "/fees", label: "Open fees" }),
    step("recurring_fees", "money", 24, "Recurring fee rules", "Set class fee ranges. New invoices begin after each student's imported cut-off month.", templateCount > 0, classCount === 0, "Recurring fee rules are needed before monthly billing can run correctly.", { href: "/fees", label: "Open fees" }),
    step("review", "money", 25, "Review and launch", "Check counts, spot-check families, fees, exams, staff, and templates, then hand the workspace to the school.", false, classCount === 0 || studentCount === 0 || !hasImportantDocuments, !hasImportantDocuments ? "Save and publish the important student, staff, exam, invoice, and receipt templates before launch review." : "Review catches missing setup before the school starts using the workspace live.", { href: "/school", label: "Open school setup" }, false),
  ];
  const required = steps;
  const completed = required.filter((row) => row.status === "complete").length;
  return {
    modules,
    progress: { completed, total: required.length, percent: required.length ? Math.round((completed / required.length) * 100) : 0 },
    counts: { classes: classCount, students: studentCount, teachers: staffCount, openingBalances: openingCount, feeTemplates: templateCount },
    steps,
    templates: (IMPORT_KINDS.filter((kind) => kind !== "classes" && kind !== "class_teachers") as ImportKind[]).map((kind) => ({
      kind,
      title: TEMPLATE_DETAILS[kind].title,
      fileName: xlsxFileName(kind),
      disabled: (kind === "opening_balances" && studentCount === 0) || (kind === "attendance" && (studentCount === 0 || classCount === 0 || !hasWorkingDays || !hasHolidayCalendar)) || (kind === "staff_attendance" && (staffCount === 0 || !hasWorkingDays || !hasHolidayCalendar)) || (kind === "exam_marks" && (studentCount === 0 || !hasExamPlan || !hasExamHistory)),
      prerequisite: kind === "opening_balances" ? "Students" : kind === "attendance" ? "Classes, students, working days, and holiday calendar" : kind === "staff_attendance" ? "Staff, working days, and holiday calendar" : kind === "exam_marks" ? "Year exam plan, setup exams, and students" : "Class labels can be created from the sheet",
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
