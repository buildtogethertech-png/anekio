import { createHash, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { toBuffer as barcodeBuffer } from "bwip-js/node";
import type { AccessUser } from "./permissions";
import { can } from "./permissions";
import { prisma } from "./prisma";
import { formatInr, publicOrigin } from "./utils";
import { feeLineTotal, invoiceBalance, paidFeeMonthCount, parseFeeLines } from "./fees";
import { buildStudentMonthPayPath } from "./pay";
import { notifyNoticePublished } from "./push";
import {
  academicYearLabel,
  buildReportCardResults,
  mergeReportCardData,
  sampleReportCardPreviewData,
  splitClassLabel,
} from "./report-card-fields";
import { gradePolicyFrom, marksVisible, seriesRanks, studentSeriesScore } from "./exams";
import { schoolFromConfig } from "./school";
import { readUploadDataUrl, resolveUploadPath } from "./uploads";

const DEFAULT_DOCUMENT_SCHOOL_ID = "school";

export type DocumentCategory = "STUDENT" | "ACADEMIC" | "FEES" | "EMPLOYEE" | "GENERAL";
export type DocumentElementType =
  | "TEXT"
  | "FIELD"
  | "IMAGE"
  | "PHOTO"
  | "TABLE"
  | "SIGNATURE"
  | "STAMP"
  | "VERIFY_QR"
  | "CUSTOM_QR"
  | "BARCODE"
  | "SHAPE"
  | "LINE"
  | "PAGE_NUMBER";

export type DocumentElement = {
  id: string;
  type: DocumentElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  value?: string;
  field?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  align?: "left" | "center" | "right";
  color?: string;
  background?: string;
  borderColor?: string;
  locked?: boolean;
};

export type DocumentLayout = { elements: DocumentElement[] };

export const DOCUMENT_CATEGORIES: { id: DocumentCategory; label: string; hint: string }[] = [
  { id: "STUDENT", label: "Students", hint: "Identity, admission, certificates, and passes" },
  { id: "ACADEMIC", label: "Exams & academics", hint: "Admit cards, marksheets, reports, and awards" },
  { id: "FEES", label: "Fees & finance", hint: "Invoices, receipts, challans, statements, and notices" },
  { id: "EMPLOYEE", label: "Employees", hint: "Identity, appointment, salary, and service documents" },
  { id: "GENERAL", label: "Letters & school", hint: "Letterhead, circulars, invitations, labels, and custom designs" },
];

export const DOCUMENT_TYPES: { id: string; label: string; category: DocumentCategory; hint: string; priority?: boolean }[] = [
  { id: "STUDENT_ID", label: "Student ID card", category: "STUDENT", hint: "Front/back identity card with photo and scan codes", priority: true },
  { id: "ADMISSION_FORM", label: "Admission form", category: "STUDENT", hint: "Printable admission record" },
  { id: "ADMISSION_ACK", label: "Admission acknowledgement", category: "STUDENT", hint: "Receipt for an admission submission" },
  { id: "ADMISSION_CONFIRMATION", label: "Admission confirmation", category: "STUDENT", hint: "Confirmation letter for a new admission" },
  { id: "STUDENT_PROFILE", label: "Student profile", category: "STUDENT", hint: "Cumulative student information record" },
  { id: "BONAFIDE", label: "Bonafide certificate", category: "STUDENT", hint: "Confirms current enrolment", priority: true },
  { id: "STUDY_CERTIFICATE", label: "Study certificate", category: "STUDENT", hint: "Confirms period and class of study" },
  { id: "DOB_CERTIFICATE", label: "Date-of-birth certificate", category: "STUDENT", hint: "Issued from school records" },
  { id: "CHARACTER_CERTIFICATE", label: "Character certificate", category: "STUDENT", hint: "Conduct and character statement" },
  { id: "ATTENDANCE_CERTIFICATE", label: "Attendance certificate", category: "STUDENT", hint: "Attendance statement for a period" },
  { id: "PROMOTION_CERTIFICATE", label: "Promotion certificate", category: "STUDENT", hint: "Class promotion confirmation" },
  { id: "TRANSFER_CERTIFICATE", label: "Transfer certificate", category: "STUDENT", hint: "School leaving and transfer record", priority: true },
  { id: "MIGRATION_LETTER", label: "Migration support letter", category: "STUDENT", hint: "Support letter, not a board-issued migration certificate" },
  { id: "NO_DUES", label: "Student no-dues certificate", category: "STUDENT", hint: "Confirms school clearances" },
  { id: "STUDENT_DECLARATION", label: "Student declaration", category: "STUDENT", hint: "Undertaking or declaration" },
  { id: "PARENT_CONSENT", label: "Parent consent form", category: "STUDENT", hint: "Reusable parent permission form" },
  { id: "GATE_PASS", label: "Gate pass", category: "STUDENT", hint: "Temporary campus exit pass" },
  { id: "LIBRARY_CARD", label: "Library card", category: "STUDENT", hint: "Student library identification" },
  { id: "TRANSPORT_CARD", label: "Transport card", category: "STUDENT", hint: "Bus route and transport identity" },
  { id: "BUS_PASS", label: "Bus pass", category: "STUDENT", hint: "Printable school transport pass" },
  { id: "ADMIT_CARD", label: "Admit card / hall ticket", category: "ACADEMIC", hint: "Exam identity, timetable, and instructions", priority: true },
  { id: "EXAM_DATE_SHEET", label: "Exam date sheet", category: "ACADEMIC", hint: "Class examination schedule" },
  { id: "SEATING_PLAN", label: "Seating plan", category: "ACADEMIC", hint: "Room and seat allocation" },
  { id: "DESK_SLIP", label: "Desk slip", category: "ACADEMIC", hint: "Small student exam desk label" },
  { id: "INVIGILATOR_DUTY", label: "Invigilator duty sheet", category: "ACADEMIC", hint: "Teacher examination duties" },
  { id: "SUBJECT_MARKSHEET", label: "Subject marksheet", category: "ACADEMIC", hint: "Subject results for a class" },
  { id: "REPORT_CARD", label: "Report card", category: "ACADEMIC", hint: "Marks, grades, attendance, and remarks", priority: true },
  { id: "CONSOLIDATED_REPORT", label: "Consolidated report card", category: "ACADEMIC", hint: "Multiple exam sittings in one report" },
  { id: "GRADE_SHEET", label: "Grade sheet", category: "ACADEMIC", hint: "Grade-focused academic record" },
  { id: "RESULT_SUMMARY", label: "Result summary", category: "ACADEMIC", hint: "Class or session result summary" },
  { id: "PROGRESS_REPORT", label: "Progress report", category: "ACADEMIC", hint: "Periodic progress communication" },
  { id: "ACHIEVEMENT_CERTIFICATE", label: "Achievement certificate", category: "ACADEMIC", hint: "Recognises an achievement" },
  { id: "PARTICIPATION_CERTIFICATE", label: "Participation certificate", category: "ACADEMIC", hint: "Recognises participation" },
  { id: "MERIT_CERTIFICATE", label: "Merit certificate", category: "ACADEMIC", hint: "Recognises academic merit" },
  { id: "FEE_INVOICE", label: "Fee invoice / demand note", category: "FEES", hint: "Amount due with line items", priority: true },
  { id: "FEE_CHALLAN", label: "Fee challan", category: "FEES", hint: "Bank or counter payment challan" },
  { id: "PAYMENT_RECEIPT", label: "Payment receipt", category: "FEES", hint: "Immutable payment acknowledgement", priority: true },
  { id: "CONSOLIDATED_RECEIPT", label: "Consolidated receipt", category: "FEES", hint: "Multiple payments in one receipt" },
  { id: "FEE_STATEMENT", label: "Fee statement", category: "FEES", hint: "Student ledger statement" },
  { id: "DUES_NOTICE", label: "Outstanding-dues notice", category: "FEES", hint: "Formal outstanding balance reminder" },
  { id: "LATE_FEE_NOTICE", label: "Late-fee notice", category: "FEES", hint: "Overdue fee communication" },
  { id: "REFUND_RECEIPT", label: "Refund receipt / credit note", category: "FEES", hint: "Refund or adjustment record" },
  { id: "CONCESSION_CONFIRMATION", label: "Concession confirmation", category: "FEES", hint: "Scholarship or fee concession record" },
  { id: "FEE_CLEARANCE", label: "Fee clearance certificate", category: "FEES", hint: "Confirms cleared fee account" },
  { id: "EMPLOYEE_ID", label: "Employee ID card", category: "EMPLOYEE", hint: "Front/back employee identity card", priority: true },
  { id: "OFFER_LETTER", label: "Offer letter", category: "EMPLOYEE", hint: "Employment offer" },
  { id: "APPOINTMENT_LETTER", label: "Appointment letter", category: "EMPLOYEE", hint: "Formal appointment terms" },
  { id: "CONFIRMATION_LETTER", label: "Confirmation letter", category: "EMPLOYEE", hint: "Employment confirmation" },
  { id: "SALARY_SLIP", label: "Salary slip", category: "EMPLOYEE", hint: "Monthly salary statement", priority: true },
  { id: "EXPERIENCE_CERTIFICATE", label: "Experience certificate", category: "EMPLOYEE", hint: "Employment experience record" },
  { id: "RELIEVING_LETTER", label: "Relieving letter", category: "EMPLOYEE", hint: "Employment release confirmation" },
  { id: "SERVICE_CERTIFICATE", label: "Service certificate", category: "EMPLOYEE", hint: "Service period and role" },
  { id: "LEAVE_APPROVAL", label: "Leave approval letter", category: "EMPLOYEE", hint: "Approved employee leave" },
  { id: "DISCIPLINARY_LETTER", label: "Warning / disciplinary letter", category: "EMPLOYEE", hint: "Controlled employee communication" },
  { id: "STAFF_ATTENDANCE", label: "Staff attendance statement", category: "EMPLOYEE", hint: "Employee attendance for a period" },
  { id: "LETTERHEAD", label: "School letterhead", category: "GENERAL", hint: "Reusable branded letter page", priority: true },
  { id: "CIRCULAR", label: "Circular", category: "GENERAL", hint: "Formal school circular" },
  { id: "NOTICE", label: "Notice", category: "GENERAL", hint: "Printable notice" },
  { id: "INVITATION", label: "Invitation", category: "GENERAL", hint: "Event invitation" },
  { id: "EVENT_PASS", label: "Event pass", category: "GENERAL", hint: "Entry pass with scan code" },
  { id: "ACKNOWLEDGEMENT", label: "Acknowledgement", category: "GENERAL", hint: "General receipt or acknowledgement" },
  { id: "MAILING_LABEL", label: "Mailing label / envelope", category: "GENERAL", hint: "Address labels and envelope print" },
  { id: "CUSTOM_CERTIFICATE", label: "Custom certificate", category: "GENERAL", hint: "Start from a certificate canvas" },
  { id: "CUSTOM_LETTER", label: "Custom letter", category: "GENERAL", hint: "Start from a letter canvas", priority: true },
  { id: "BLANK", label: "Custom blank document", category: "GENERAL", hint: "Choose any supported page size" },
];

export const DOCUMENT_FIELDS = [
  { group: "School", id: "school.name", label: "School name" },
  { group: "School", id: "school.address", label: "School address" },
  { group: "School", id: "school.affiliation", label: "Affiliation" },
  { group: "School", id: "school.phone", label: "School phone" },
  { group: "School", id: "school.email", label: "School email" },
  { group: "School", id: "school.contact", label: "School contact" },
  { group: "School", id: "school.academicYear", label: "Academic year" },
  { group: "School", id: "school.sessionTitle", label: "Academic session title" },
  { group: "School", id: "school.website", label: "School website" },
  { group: "School", id: "school.logoPath", label: "School logo" },
  { group: "School", id: "school.signPath", label: "Principal signature" },
  { group: "School", id: "school.stampPath", label: "School stamp" },
  { group: "Student", id: "student.name", label: "Student name" },
  { group: "Student", id: "student.admissionNo", label: "Admission number" },
  { group: "Student", id: "student.classLabel", label: "Class and section" },
  { group: "Student", id: "student.className", label: "Class" },
  { group: "Student", id: "student.sectionName", label: "Section" },
  { group: "Student", id: "student.rollNo", label: "Roll number" },
  { group: "Student", id: "student.id", label: "Student ID" },
  { group: "Student", id: "student.gender", label: "Gender" },
  { group: "Student", id: "student.dateOfBirth", label: "Date of birth" },
  { group: "Student", id: "student.born", label: "Date of birth label" },
  { group: "Student", id: "student.photo", label: "Student photo" },
  { group: "Guardian", id: "guardian.name", label: "Guardian name" },
  { group: "Guardian", id: "guardian.phone", label: "Guardian phone" },
  { group: "Guardian", id: "student.parent", label: "Guardian name" },
  { group: "Guardian", id: "student.parentPhone", label: "Guardian phone" },
  { group: "Employee", id: "employee.name", label: "Employee name" },
  { group: "Employee", id: "employee.employeeId", label: "Employee ID" },
  { group: "Employee", id: "employee.role", label: "Role / designation" },
  { group: "Exam", id: "exam.name", label: "Exam name" },
  { group: "Exam", id: "exam.rollNo", label: "Exam roll number" },
  { group: "Exam", id: "exam.schedule", label: "Exam schedule table" },
  { group: "Results", id: "results.marks", label: "Marks and grades table" },
  { group: "Results", id: "results.activities", label: "Co-scholastic table" },
  { group: "Results", id: "results.attendance", label: "Attendance" },
  { group: "Results", id: "results.totalMarks", label: "Total marks" },
  { group: "Results", id: "results.marksObtained", label: "Marks obtained" },
  { group: "Results", id: "results.percentage", label: "Percentage" },
  { group: "Results", id: "results.overallGrade", label: "Overall grade" },
  { group: "Results", id: "results.classRank", label: "Class rank" },
  { group: "Results", id: "results.workingDays", label: "Working days" },
  { group: "Results", id: "results.daysPresent", label: "Days present" },
  { group: "Results", id: "results.daysAbsent", label: "Days absent" },
  { group: "Results", id: "results.attendancePercentage", label: "Attendance percentage" },
  { group: "Results", id: "results.attendanceBar", label: "Attendance progress" },
  { group: "Results", id: "results.teacherRemark", label: "Teacher remark" },
  { group: "Results", id: "results.promotionStatus", label: "Promotion status" },
  { group: "Results", id: "results.nextClass", label: "Next class" },
  { group: "Staff", id: "staff.classTeacherName", label: "Class teacher name" },
  { group: "Staff", id: "staff.principalName", label: "Principal name" },
  { group: "Fees", id: "fees.lines", label: "Fee line items" },
  { group: "Fees", id: "fees.amount", label: "Amount" },
  { group: "Fees", id: "fees.paid", label: "Amount paid" },
  { group: "Fees", id: "fees.due", label: "Amount due" },
  { group: "Fees", id: "fees.status", label: "Fee status" },
  { group: "Fees", id: "fees.receiptLabel", label: "Receipt label" },
  { group: "Fees", id: "fees.receiptNumber", label: "Receipt number" },
  { group: "Fees", id: "fees.term", label: "Fee term" },
  { group: "Fees", id: "fees.method", label: "Payment method" },
  { group: "Fees", id: "fees.reference", label: "Payment reference" },
  { group: "Fees", id: "fees.receivedBy", label: "Received by" },
  { group: "Fees", id: "fees.receivedAt", label: "Received at" },
  { group: "Fees", id: "fees.receivedNote", label: "Payment note" },
  { group: "Fees", id: "fees.upiId", label: "UPI ID" },
  { group: "Fees", id: "fees.bankName", label: "Bank name" },
  { group: "Fees", id: "fees.account", label: "Bank account" },
  { group: "Fees", id: "fees.paymentUrl", label: "Payment link" },
  { group: "Document", id: "document.number", label: "Document number" },
  { group: "Document", id: "document.issueDate", label: "Issue date" },
  { group: "Document", id: "document.dueDate", label: "Due date" },
  { group: "Document", id: "document.verifyId", label: "Verify ID" },
];

function element(id: string, type: DocumentElementType, x: number, y: number, width: number, height: number, extra: Partial<DocumentElement> = {}): DocumentElement {
  return { id, type, x, y, width, height, fontSize: 14, color: "#102a43", ...extra };
}

export function isReportCardType(type: string) {
  return type === "REPORT_CARD" || type.startsWith("REPORT_CARD_") || type === "GRADE_SHEET" || type === "CONSOLIDATED_REPORT" || type === "PROGRESS_REPORT";
}

type ReportCardTheme = {
  title: string;
  pageBg: string;
  paper: string;
  headerA: string;
  headerB: string;
  headerC: string;
  accent: string;
  accent2: string;
  onHeader: string;
  onHeaderMuted: string;
  titleBg: string;
  titleColor: string;
  pillBg: string;
  pillBorder: string;
  pillText: string;
  studentBg: string;
  studentBorder: string;
  photoBorder: string;
  sectionA: string;
  sectionB: string;
  card1: string;
  card1Line: string;
  card1Text: string;
  card2: string;
  card2Line: string;
  card2Text: string;
  card3: string;
  card3Line: string;
  card3Text: string;
  card4: string;
  card4Text: string;
  metric1: string;
  metric2: string;
  metric3: string;
  metric4: string;
  remarkHead: string;
  remarkHeadText: string;
  remarkBg: string;
  resultBg: string;
  resultLine: string;
  resultText: string;
};

const REPORT_THEMES: Record<string, ReportCardTheme> = {
  REPORT_CARD: {
    title: "STUDENT REPORT CARD",
    pageBg: "#EEF2FF",
    paper: "#FFFFFF",
    headerA: "#2563EB",
    headerB: "#7C3AED",
    headerC: "#DB2777",
    accent: "#06B6D4",
    accent2: "#F59E0B",
    onHeader: "#FFFFFF",
    onHeaderMuted: "#FCE7F3",
    titleBg: "#2563EB",
    titleColor: "#FFFFFF",
    pillBg: "#F5F3FF",
    pillBorder: "#C4B5FD",
    pillText: "#6D28D9",
    studentBg: "#ECFEFF",
    studentBorder: "#67E8F9",
    photoBorder: "#22D3EE",
    sectionA: "#7C3AED",
    sectionB: "#DB2777",
    card1: "#DBEAFE",
    card1Line: "#93C5FD",
    card1Text: "#1D4ED8",
    card2: "#EDE9FE",
    card2Line: "#C4B5FD",
    card2Text: "#6D28D9",
    card3: "#CFFAFE",
    card3Line: "#67E8F9",
    card3Text: "#0E7490",
    card4: "#DB2777",
    card4Text: "#FFFFFF",
    metric1: "#FEF3C7",
    metric2: "#DCFCE7",
    metric3: "#FCE7F3",
    metric4: "#E0E7FF",
    remarkHead: "#FDE68A",
    remarkHeadText: "#92400E",
    remarkBg: "#FFFBEB",
    resultBg: "#DCFCE7",
    resultLine: "#86EFAC",
    resultText: "#166534",
  },
};

function reportThemeFor(type: string): ReportCardTheme {
  if (type === "GRADE_SHEET") {
    return {
      ...REPORT_THEMES.REPORT_CARD,
      title: "GRADE SHEET",
      headerA: "#1D4ED8",
      headerB: "#2563EB",
      headerC: "#0EA5E9",
      titleBg: "#1D4ED8",
      sectionA: "#1D4ED8",
      sectionB: "#0EA5E9",
    };
  }
  if (type === "PROGRESS_REPORT") {
    return {
      ...REPORT_THEMES.REPORT_CARD,
      title: "PROGRESS REPORT",
      headerA: "#0F766E",
      headerB: "#0E7490",
      headerC: "#7C3AED",
      titleBg: "#0F766E",
      sectionA: "#0E7490",
      sectionB: "#7C3AED",
      studentBg: "#F0FDFA",
      studentBorder: "#99F6E4",
    };
  }
  if (type === "CONSOLIDATED_REPORT") {
    return {
      ...REPORT_THEMES.REPORT_CARD,
      title: "CONSOLIDATED REPORT CARD",
      headerA: "#15803D",
      headerB: "#0F766E",
      headerC: "#1D4ED8",
      titleBg: "#15803D",
      sectionA: "#15803D",
      sectionB: "#0F766E",
    };
  }
  return REPORT_THEMES.REPORT_CARD;
}

function reportCardLayout(type = "REPORT_CARD"): DocumentLayout {
  const t = reportThemeFor(type);
  const e = element;
  const label = (id: string, x: number, y: number, w: number, value: string) =>
    e(id, "TEXT", x, y, w, 1.2, { value, fontSize: 7, fontWeight: "bold", color: "#64748B" });
  const value = (id: string, x: number, y: number, w: number, field: string, name: string, extra: Partial<DocumentElement> = {}) =>
    e(id, "FIELD", x, y, w, 1.8, { field, label: name, fontSize: 11, fontWeight: "bold", color: "#0F172A", ...extra });
  return {
    elements: [
      e("page-bg", "SHAPE", 0, 0, 100, 100, { background: t.pageBg, locked: true }),
      e("rail", "SHAPE", 0, 0, 1.6, 100, { background: t.accent, locked: true }),
      e("rail-2", "SHAPE", 1.6, 0, 1.1, 100, { background: t.accent2, locked: true }),
      e("paper", "SHAPE", 4.2, 1.6, 93.2, 96.6, { background: t.paper, borderColor: t.studentBorder, locked: true }),
      e("blob-a", "SHAPE", 86, 12.4, 10, 4.2, { background: t.accent, locked: true }),
      e("blob-b", "SHAPE", 4.2, 96.4, 18, 1.8, { background: t.headerC, locked: true }),
      e("header-a", "SHAPE", 4.2, 1.6, 48, 10.4, { background: t.headerA, locked: true }),
      e("header-b", "SHAPE", 42, 1.6, 26, 10.4, { background: t.headerB, locked: true }),
      e("header-c", "SHAPE", 62, 1.6, 35.4, 10.4, { background: t.headerC, locked: true }),
      e("header-accent", "SHAPE", 4.2, 12, 93.2, 0.55, { background: t.accent, locked: true }),
      e("logo-frame", "SHAPE", 6, 3.1, 7.4, 7.2, { background: "#FFFFFF", borderColor: t.accent, locked: true }),
      e("school-logo", "IMAGE", 6.5, 3.6, 6.4, 6.2, { field: "school.logoPath", label: "Logo", locked: true }),
      e("school-name", "FIELD", 15.2, 3.2, 49, 3.4, { field: "school.name", label: "School name", fontSize: 18, fontWeight: "bold", color: t.onHeader, locked: true }),
      e("school-address", "FIELD", 15.2, 6.7, 49, 1.6, { field: "school.address", label: "School address", fontSize: 8, color: t.onHeaderMuted }),
      e("school-contact", "FIELD", 15.2, 8.4, 49, 1.6, { field: "school.contact", label: "School contact", fontSize: 8, color: t.onHeaderMuted }),
      e("year-label", "TEXT", 69, 3.4, 25.5, 1.4, { value: "ACADEMIC SESSION", fontSize: 7, fontWeight: "bold", align: "right", color: t.onHeaderMuted }),
      e("academic-year", "FIELD", 69, 5, 25.5, 2.2, { field: "school.academicYear", label: "Academic year", fontSize: 12, fontWeight: "bold", align: "right", color: t.onHeader }),
      e("document-number", "FIELD", 69, 7.6, 25.5, 1.6, { field: "document.number", label: "Document number", fontSize: 7, align: "right", color: t.onHeaderMuted }),
      e("title-bg", "SHAPE", 18, 13.2, 64, 2.8, { background: t.titleBg, locked: true }),
      e("title", "TEXT", 18, 13.45, 64, 2.3, { value: t.title, fontSize: 14, fontWeight: "bold", align: "center", color: t.titleColor }),
      e("session-pill", "SHAPE", 35, 16.4, 30, 2.2, { background: t.pillBg, borderColor: t.pillBorder, locked: true }),
      e("session-title", "FIELD", 35, 16.55, 30, 1.9, { field: "school.sessionTitle", label: "Academic session", fontSize: 8, fontWeight: "bold", align: "center", color: t.pillText }),
      e("student-card", "SHAPE", 6.2, 19.2, 89, 11.2, { background: t.studentBg, borderColor: t.studentBorder, locked: true }),
      e("photo", "PHOTO", 7.3, 20, 9.2, 9.6, { field: "student.photo", label: "Photo", borderColor: t.photoBorder }),
      label("name-label", 18.2, 20, 22, "STUDENT NAME"),
      e("student-name", "FIELD", 18.2, 21.2, 34, 2.2, { field: "student.name", label: "Student name", fontSize: 13, fontWeight: "bold", color: "#0F172A" }),
      e("status-pill", "SHAPE", 53.2, 20.1, 16.5, 2, { background: "#DCFCE7", borderColor: "#86EFAC", locked: true }),
      e("promotion-status", "FIELD", 53.2, 20.25, 16.5, 1.7, { field: "results.promotionStatus", label: "Promotion status", fontSize: 7, fontWeight: "bold", align: "center", color: "#16A34A" }),
      label("adm-label", 18.2, 23.7, 16, "ADMISSION NO"),
      value("admission", 18.2, 24.8, 16, "student.admissionNo", "Admission number", { fontSize: 10 }),
      label("class-label", 35.6, 23.7, 10, "CLASS"),
      value("class-name", 35.6, 24.8, 10, "student.className", "Class", { fontSize: 10 }),
      label("sec-label", 46.8, 23.7, 10, "SECTION"),
      value("section-name", 46.8, 24.8, 10, "student.sectionName", "Section", { fontSize: 10 }),
      label("roll-label", 58, 23.7, 10, "ROLL NO"),
      value("roll", 58, 24.8, 10, "student.rollNo", "Roll number", { fontSize: 10 }),
      label("dob-label", 72, 20, 21, "DATE OF BIRTH"),
      value("dob", 72, 21.2, 21, "student.born", "Date of birth", { fontSize: 10 }),
      label("year-meta-label", 72, 23.7, 10, "YEAR"),
      value("year-meta", 72, 24.8, 10, "school.academicYear", "Academic year", { fontSize: 10 }),
      label("id-label", 83, 23.7, 10, "STUDENT ID"),
      value("student-id", 83, 24.8, 10.2, "student.id", "Student ID", { fontSize: 8 }),
      e("acad-head", "SHAPE", 6.2, 31.3, 89, 2.3, { background: t.sectionA, locked: true }),
      e("acad-title", "TEXT", 7.6, 31.55, 50, 1.8, { value: "ACADEMIC PERFORMANCE", fontSize: 9, fontWeight: "bold", color: "#FFFFFF" }),
      e("marks-table", "TABLE", 6.2, 33.6, 89, 15.2, { field: "results.marks", label: "Marks and grades table", fontSize: 8, background: t.sectionA }),
      e("sum-total", "SHAPE", 6.2, 49.5, 21, 5.2, { background: t.card1, borderColor: t.card1Line, locked: true }),
      label("sum-total-l", 7, 49.8, 19.4, "TOTAL"),
      value("total-marks", 7, 51.3, 19.4, "results.totalMarks", "Total marks", { fontSize: 16, color: t.card1Text }),
      e("sum-obt", "SHAPE", 28.6, 49.5, 21, 5.2, { background: t.card2, borderColor: t.card2Line, locked: true }),
      label("sum-obt-l", 29.4, 49.8, 19.4, "OBTAINED"),
      value("marks-obtained", 29.4, 51.3, 19.4, "results.marksObtained", "Marks obtained", { fontSize: 16, color: t.card2Text }),
      e("sum-pct", "SHAPE", 51, 49.5, 21, 5.2, { background: t.card3, borderColor: t.card3Line, locked: true }),
      label("sum-pct-l", 51.8, 49.8, 19.4, "PERCENTAGE"),
      e("percentage", "FIELD", 51.8, 51.3, 19.4, 2.4, { field: "results.percentage", label: "Percentage", fontSize: 16, fontWeight: "bold", color: t.card3Text }),
      e("sum-grade", "SHAPE", 73.4, 49.5, 21.8, 5.2, { background: t.card4, locked: true }),
      e("sum-grade-l", "TEXT", 74.2, 49.8, 20.2, 1.2, { value: "OVERALL GRADE", fontSize: 7, fontWeight: "bold", color: t.card4Text }),
      e("overall-grade", "FIELD", 74.2, 51.3, 20.2, 2.4, { field: "results.overallGrade", label: "Overall grade", fontSize: 18, fontWeight: "bold", color: t.card4Text }),
      e("metric-pct", "SHAPE", 6.2, 55.5, 21, 5, { background: t.metric1, borderColor: t.card1Line, locked: true }),
      label("metric-pct-l", 7, 55.8, 19.4, "PERCENTAGE"),
      e("metric-pct-v", "FIELD", 7, 57.2, 19.4, 2.4, { field: "results.percentage", label: "Percentage", fontSize: 15, fontWeight: "bold", color: t.card1Text }),
      e("metric-grade", "SHAPE", 28.6, 55.5, 21, 5, { background: t.metric2, borderColor: t.card2Line, locked: true }),
      label("metric-grade-l", 29.4, 55.8, 19.4, "OVERALL GRADE"),
      e("metric-grade-v", "FIELD", 29.4, 57.2, 19.4, 2.4, { field: "results.overallGrade", label: "Overall grade", fontSize: 15, fontWeight: "bold", color: t.card2Text }),
      e("metric-att", "SHAPE", 51, 55.5, 21, 5, { background: t.metric3, borderColor: t.card3Line, locked: true }),
      label("metric-att-l", 51.8, 55.8, 19.4, "ATTENDANCE"),
      e("metric-att-v", "FIELD", 51.8, 57.2, 19.4, 2.4, { field: "results.attendancePercentage", label: "Attendance percentage", fontSize: 15, fontWeight: "bold", color: t.card3Text }),
      e("metric-rank", "SHAPE", 73.4, 55.5, 21.8, 5, { background: t.metric4, borderColor: t.pillBorder, locked: true }),
      label("metric-rank-l", 74.2, 55.8, 20.2, "CLASS RANK"),
      e("metric-rank-v", "FIELD", 74.2, 57.2, 20.2, 2.4, { field: "results.classRank", label: "Class rank", fontSize: 15, fontWeight: "bold", color: "#0F172A" }),
      e("att-head", "SHAPE", 6.2, 61.3, 43, 2.1, { background: t.sectionB, locked: true }),
      e("att-title", "TEXT", 7.4, 61.5, 30, 1.7, { value: "ATTENDANCE", fontSize: 8, fontWeight: "bold", color: "#FFFFFF" }),
      e("att-card", "SHAPE", 6.2, 63.4, 43, 8.3, { background: t.studentBg, borderColor: t.studentBorder, locked: true }),
      label("wd-l", 7.2, 63.8, 9.5, "WORKING"),
      value("working-days", 7.2, 65, 9.5, "results.workingDays", "Working days", { fontSize: 12, color: t.card1Text }),
      label("dp-l", 17.4, 63.8, 9.5, "PRESENT"),
      value("days-present", 17.4, 65, 9.5, "results.daysPresent", "Days present", { fontSize: 12, color: "#16A34A" }),
      label("da-l", 27.6, 63.8, 9.5, "ABSENT"),
      value("days-absent", 27.6, 65, 9.5, "results.daysAbsent", "Days absent", { fontSize: 12, color: "#DC2626" }),
      label("ap-l", 37.8, 63.8, 10.2, "PERCENT"),
      value("att-pct", 37.8, 65, 10.2, "results.attendancePercentage", "Attendance percentage", { fontSize: 12, color: t.card3Text }),
      e("att-bar", "FIELD", 7.2, 67.6, 40.6, 3.2, { field: "results.attendanceBar", label: "Attendance progress", fontSize: 9, color: "#0F172A" }),
      e("act-head", "SHAPE", 50.8, 61.3, 44.4, 2.1, { background: t.sectionA, locked: true }),
      e("act-title", "TEXT", 52.1, 61.5, 40, 1.7, { value: "CO-SCHOLASTIC & ACTIVITIES", fontSize: 8, fontWeight: "bold", color: "#FFFFFF" }),
      e("activities-table", "TABLE", 50.8, 63.4, 44.4, 8.3, { field: "results.activities", label: "Co-scholastic table", fontSize: 7, background: t.sectionA }),
      e("remark-head", "SHAPE", 6.2, 72.5, 89, 2.1, { background: t.remarkHead, locked: true }),
      e("remark-title", "TEXT", 7.6, 72.7, 40, 1.7, { value: "TEACHER'S REMARKS", fontSize: 8, fontWeight: "bold", color: t.remarkHeadText }),
      e("remark-card", "SHAPE", 6.2, 74.6, 89, 5.5, { background: t.remarkBg, borderColor: t.resultLine, locked: true }),
      e("teacher-remark", "FIELD", 7.6, 75.2, 86, 4.3, { field: "results.teacherRemark", label: "Teacher remark", fontSize: 10, color: "#334155" }),
      e("result-box", "SHAPE", 6.2, 80.8, 89, 5.6, { background: t.resultBg, borderColor: t.resultLine, locked: true }),
      e("result-label", "TEXT", 8.4, 81.1, 84.6, 1.3, { value: "FINAL RESULT", fontSize: 7, fontWeight: "bold", align: "center", color: t.resultText }),
      e("result-status", "FIELD", 8.4, 82.4, 84.6, 2, { field: "results.promotionStatus", label: "Promotion status", fontSize: 16, fontWeight: "bold", align: "center", color: t.resultText }),
      e("next-class", "FIELD", 8.4, 84.3, 84.6, 1.6, { field: "results.nextClass", label: "Next class", fontSize: 9, fontWeight: "bold", align: "center", color: t.resultText }),
      e("sign-teacher", "SIGNATURE", 7.4, 87.4, 22, 4.6, { field: "school.signPath", label: "Class teacher signature" }),
      e("sign-teacher-name", "FIELD", 7.4, 92.1, 22, 1.4, { field: "staff.classTeacherName", label: "Class teacher name", fontSize: 8, fontWeight: "bold", align: "center", color: "#0F172A" }),
      e("sign-teacher-l", "TEXT", 7.4, 93.4, 22, 1.2, { value: "Class Teacher", fontSize: 7, align: "center", color: "#64748B" }),
      e("sign-principal", "SIGNATURE", 39.4, 87.4, 22, 4.6, { field: "school.signPath", label: "Principal signature" }),
      e("sign-principal-name", "FIELD", 39.4, 92.1, 22, 1.4, { field: "staff.principalName", label: "Principal name", fontSize: 8, fontWeight: "bold", align: "center", color: "#0F172A" }),
      e("sign-principal-l", "TEXT", 39.4, 93.4, 22, 1.2, { value: "Principal", fontSize: 7, align: "center", color: "#64748B" }),
      e("sign-parent-line", "LINE", 68.4, 91.6, 18, 0.4, { color: "#94A3B8" }),
      e("sign-parent-l", "TEXT", 68.4, 92.1, 18, 1.4, { value: "Parent / Guardian", fontSize: 8, fontWeight: "bold", align: "center", color: "#0F172A" }),
      e("sign-parent-sub", "TEXT", 68.4, 93.4, 18, 1.2, { value: "Signature", fontSize: 7, align: "center", color: "#64748B" }),
      e("verify", "VERIFY_QR", 88.6, 87.4, 5.4, 5.6, { label: "Verification QR", locked: true }),
      e("verify-l", "TEXT", 87, 93.2, 8.6, 1.6, { value: "VERIFY REPORT CARD", fontSize: 6, fontWeight: "bold", align: "center", color: "#64748B" }),
      e("footer-line", "LINE", 6.2, 95.2, 89, 0.25, { color: t.accent }),
      e("footer", "TEXT", 6.2, 95.6, 50, 1.4, { value: "Generated by Anekio", fontSize: 7, color: "#64748B" }),
      e("footer-web", "FIELD", 40, 95.6, 36, 1.4, { field: "school.website", label: "School website", fontSize: 7, align: "center", color: "#64748B" }),
      e("page-number", "PAGE_NUMBER", 82, 95.6, 12.5, 1.4, { value: "1", fontSize: 7, align: "right", color: "#64748B" }),
    ],
  };
}

function catalogPagePalette(kind: string, category?: string) {
  if (kind.includes("FEE") || kind.includes("RECEIPT") || kind.includes("CHALLAN") || kind.includes("DUES") || kind.includes("REFUND") || kind.includes("CONCESSION") || category === "FEES") {
    return { page: "#F0FDFA", header: "#0F766E", header2: "#0D9488", accent: "#14B8A6", titleBg: "#CCFBF1", line: "#99F6E4", card: "#F0FDFA", onHeaderMuted: "#CCFBF1" };
  }
  if (kind.startsWith("ADMISSION") || kind === "PARENT_CONSENT" || kind === "STUDENT_DECLARATION") {
    return { page: "#FFF7ED", header: "#EA580C", header2: "#F59E0B", accent: "#FDBA74", titleBg: "#FFEDD5", line: "#FED7AA", card: "#FFFBEB", onHeaderMuted: "#FFEDD5" };
  }
  if (kind.includes("CERTIFICATE") || kind === "BONAFIDE" || kind === "NO_DUES" || kind === "MIGRATION_LETTER") {
    return { page: "#FAF5FF", header: "#7C3AED", header2: "#DB2777", accent: "#C084FC", titleBg: "#F3E8FF", line: "#E9D5FF", card: "#FAF5FF", onHeaderMuted: "#F5D0FE" };
  }
  if (category === "EMPLOYEE" || kind.startsWith("EMPLOYEE") || kind.includes("SALARY") || kind.includes("APPOINTMENT") || kind.includes("EXPERIENCE") || kind.includes("RELIEVING") || kind.includes("LEAVE") || kind.includes("DISCIPLINARY")) {
    return { page: "#FFF7ED", header: "#C2410C", header2: "#E11D48", accent: "#FB7185", titleBg: "#FFE4E6", line: "#FECDD3", card: "#FFF1F2", onHeaderMuted: "#FECDD3" };
  }
  if (category === "GENERAL" || kind.includes("LETTER") || kind === "CIRCULAR" || kind === "NOTICE" || kind === "INVITATION") {
    return { page: "#EEF2FF", header: "#4338CA", header2: "#7C3AED", accent: "#818CF8", titleBg: "#E0E7FF", line: "#C7D2FE", card: "#F8FAFF", onHeaderMuted: "#C7D2FE" };
  }
  if (kind === "STUDENT_ID" || kind === "STUDENT_PROFILE" || kind.includes("PASS") || kind.includes("CARD")) {
    return { page: "#ECFEFF", header: "#0284C7", header2: "#06B6D4", accent: "#22D3EE", titleBg: "#CFFAFE", line: "#A5F3FC", card: "#F0FDFF", onHeaderMuted: "#CFFAFE" };
  }
  return { page: "#EEF2FF", header: "#2563EB", header2: "#7C3AED", accent: "#818CF8", titleBg: "#E0E7FF", line: "#C7D2FE", card: "#F8FAFF", onHeaderMuted: "#DDD6FE" };
}

export function defaultLayout(type: string): DocumentLayout {
  const meta = DOCUMENT_TYPES.find((row) => row.id === type);
  const isCard = type === "STUDENT_ID" || type === "EMPLOYEE_ID" || type.endsWith("_CARD") || type.endsWith("_PASS");
  if (isReportCardType(type)) return reportCardLayout(type);
  if (type === "STUDENT_ID") {
    return {
      elements: [
        element("card-bg", "SHAPE", 0, 0, 100, 100, { background: "#ecfeff", locked: true }),
        element("top-band", "SHAPE", 0, 0, 100, 24, { background: "#0284C7", locked: true }),
        element("left-accent", "SHAPE", 0, 0, 4, 100, { background: "#06B6D4", locked: true }),
        element("bottom-band", "SHAPE", 0, 87, 100, 13, { background: "#cffafe", locked: true }),
        element("card-border", "SHAPE", 2, 4, 96, 92, { borderColor: "#0284C7", locked: true }),
        element("school-logo", "IMAGE", 7, 5, 11, 14, { field: "school.logoPath", label: "Logo", locked: true }),
        element("school-name", "FIELD", 20, 5, 60, 7, { field: "school.name", label: "School name", fontSize: 13, fontWeight: "bold", align: "center", color: "#ffffff", locked: true }),
        element("school-address", "FIELD", 20, 13, 60, 4, { field: "school.address", label: "School address", fontSize: 5, align: "center", color: "#e0f2fe" }),
        element("card-kind", "TEXT", 81, 6, 12, 7, { value: "ID", fontSize: 14, fontWeight: "bold", align: "center", color: "#ffffff" }),
        element("title", "TEXT", 37, 25, 29, 5, { value: "STUDENT ID CARD", fontSize: 7, fontWeight: "bold", align: "center", color: "#0284C7", background: "#cffafe" }),
        element("photo", "PHOTO", 8, 33, 22, 34, { field: "student.photo", label: "Photo", borderColor: "#0284C7" }),
        element("student-name", "FIELD", 34, 34, 42, 7, { field: "student.name", label: "Student name", fontSize: 12, fontWeight: "bold", color: "#0f172a" }),
        element("admission-label", "TEXT", 34, 45, 16, 4, { value: "Admission no", fontSize: 5, color: "#64748b" }),
        element("identity", "FIELD", 51, 45, 25, 4, { field: "student.admissionNo", label: "Admission number", fontSize: 7, fontWeight: "bold", color: "#0f172a" }),
        element("class-label", "TEXT", 34, 52, 9, 4, { value: "Class", fontSize: 5, color: "#64748b" }),
        element("class", "FIELD", 44, 52, 18, 4, { field: "student.classLabel", label: "Class", fontSize: 7, fontWeight: "bold", color: "#0f172a" }),
        element("dob-label", "TEXT", 63, 52, 8, 4, { value: "DOB", fontSize: 5, color: "#64748b" }),
        element("dob", "FIELD", 71, 52, 22, 4, { field: "student.born", label: "Date of birth", fontSize: 7, fontWeight: "bold", color: "#0f172a" }),
        element("guardian-label", "TEXT", 34, 59, 16, 4, { value: "Guardian", fontSize: 5, color: "#64748b" }),
        element("guardian", "FIELD", 51, 59, 28, 4, { field: "student.parent", label: "Guardian name", fontSize: 7, color: "#0f172a" }),
        element("phone-label", "TEXT", 34, 66, 11, 4, { value: "Phone", fontSize: 5, color: "#64748b" }),
        element("phone", "FIELD", 46, 66, 25, 4, { field: "student.parentPhone", label: "Guardian phone", fontSize: 7, color: "#0f172a" }),
        element("document-number", "FIELD", 8, 78, 43, 5, { field: "document.number", label: "Card number", fontSize: 6, fontWeight: "bold", color: "#0284C7" }),
        element("signature", "SIGNATURE", 55, 72, 20, 9, { label: "Signature" }),
        element("signature-label", "TEXT", 53, 82, 24, 3, { value: "Authorised signature", fontSize: 5, align: "center", color: "#64748b" }),
        element("verify", "VERIFY_QR", 80, 62, 14, 21, { label: "Attendance QR", locked: true }),
        element("qr-label", "TEXT", 77, 84, 20, 4, { value: "Scan for attendance", fontSize: 5, align: "center", fontWeight: "bold", color: "#0284C7" }),
      ],
    };
  }
  if (type === "ADMIT_CARD") {
    return {
      elements: [
        element("page-border", "SHAPE", 5, 4, 90, 92, { borderColor: "#1d4ed8", locked: true }),
        element("left-accent", "SHAPE", 5, 4, 1.4, 92, { background: "#f59e0b", locked: true }),
        element("top-band", "SHAPE", 6.4, 4, 88.6, 11, { background: "#1d4ed8", locked: true }),
        element("school-logo", "IMAGE", 9, 5.5, 8, 7, { field: "school.logoPath", label: "Logo", locked: true }),
        element("school-name", "FIELD", 20, 5.3, 48, 4.2, { field: "school.name", label: "School name", fontSize: 21, fontWeight: "bold", align: "center", color: "#ffffff", locked: true }),
        element("school-address", "FIELD", 20, 10, 48, 2, { field: "school.address", label: "School address", fontSize: 8, align: "center", color: "#dbeafe" }),
        element("stamp", "STAMP", 84, 5.5, 8, 7, { field: "school.stampPath", label: "Stamp" }),
        element("title-bg", "SHAPE", 31, 17, 38, 5.2, { background: "#dbeafe", locked: true }),
        element("title", "TEXT", 32, 18.2, 36, 2.8, { value: "ADMIT CARD / HALL TICKET", fontSize: 14, fontWeight: "bold", align: "center", color: "#1d4ed8" }),
        element("meta-bg", "SHAPE", 9, 24, 82, 7, { background: "#f8fbff", borderColor: "#d9e2ec", locked: true }),
        element("exam-name-label", "TEXT", 11, 25.2, 12, 1.7, { value: "EXAMINATION", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("exam-name", "FIELD", 24, 25.1, 22, 2.8, { field: "exam.name", label: "Exam name", fontSize: 11, fontWeight: "bold" }),
        element("class-label", "TEXT", 50, 25.2, 9, 1.7, { value: "CLASS", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("class", "FIELD", 59, 25.1, 10, 2.8, { field: "student.classLabel", label: "Class", fontSize: 11, fontWeight: "bold" }),
        element("document-number-label", "TEXT", 71, 25.2, 12, 1.7, { value: "CARD NO.", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("document-number", "FIELD", 78, 25.1, 11, 2.8, { field: "document.number", label: "Admit card no.", fontSize: 7, fontWeight: "bold", align: "right", color: "#1d4ed8" }),
        element("info-bg", "SHAPE", 9, 34, 82, 24, { background: "#ffffff", borderColor: "#d9e2ec", locked: true }),
        element("photo", "PHOTO", 11, 36, 14, 18, { field: "student.photo", label: "Photo", borderColor: "#94a3b8" }),
        element("candidate-label", "TEXT", 29, 36, 18, 1.8, { value: "CANDIDATE NAME", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("student-name", "FIELD", 29, 38.2, 33, 3.4, { field: "student.name", label: "Student name", fontSize: 15, fontWeight: "bold" }),
        element("roll-card", "SHAPE", 68, 36, 18, 8, { background: "#eff6ff", borderColor: "#bfdbfe", locked: true }),
        element("roll-label", "TEXT", 70, 37.2, 14, 1.6, { value: "ROLL NO", fontSize: 7, fontWeight: "bold", align: "center", color: "#1d4ed8" }),
        element("roll", "FIELD", 70, 39.4, 14, 3, { field: "student.rollNo", label: "Roll number", fontSize: 15, fontWeight: "bold", align: "center" }),
        element("admission-label", "TEXT", 29, 45, 17, 1.8, { value: "ADMISSION NO", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("admission", "FIELD", 46, 44.8, 17, 2.4, { field: "student.admissionNo", label: "Admission number", fontSize: 9, fontWeight: "bold" }),
        element("dob-label", "TEXT", 66, 45, 8, 1.8, { value: "DOB", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("dob", "FIELD", 74, 44.8, 15, 2.4, { field: "student.born", label: "Date of birth", fontSize: 9, fontWeight: "bold" }),
        element("guardian-label", "TEXT", 29, 50.5, 17, 1.8, { value: "GUARDIAN", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("guardian", "FIELD", 46, 50.3, 22, 2.4, { field: "student.parent", label: "Guardian name", fontSize: 9 }),
        element("phone-label", "TEXT", 70, 50.5, 9, 1.8, { value: "PHONE", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("phone", "FIELD", 79, 50.3, 10, 2.4, { field: "student.parentPhone", label: "Phone", fontSize: 8 }),
        element("centre-label", "TEXT", 29, 55, 14, 1.8, { value: "EXAM CENTRE", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("centre", "FIELD", 46, 54.8, 43, 2.4, { field: "school.name", label: "Exam centre", fontSize: 9, fontWeight: "bold" }),
        element("schedule-title-bg", "SHAPE", 9, 61, 82, 4, { background: "#1d4ed8", locked: true }),
        element("schedule-title", "TEXT", 11, 62.1, 25, 1.8, { value: "DATE SHEET", fontSize: 8, fontWeight: "bold", color: "#ffffff" }),
        element("data-table", "TABLE", 9, 65.5, 82, 12, { field: "exam.schedule", label: "Exam schedule table", fontSize: 8 }),
        element("instructions-title", "TEXT", 9, 80, 25, 2, { value: "IMPORTANT INSTRUCTIONS", fontSize: 8, fontWeight: "bold", color: "#1d4ed8" }),
        element("instructions", "TEXT", 9, 82.5, 50, 8, { value: "1. Carry this admit card and school ID card.  2. Reach the centre 30 minutes before the exam.  3. Mobile phones, smart watches and unauthorised items are not allowed.", fontSize: 7 }),
        element("signature", "SIGNATURE", 61, 80.5, 15, 6.5, { field: "school.signPath", label: "Principal signature" }),
        element("signature-label", "TEXT", 57, 88, 23, 2.2, { value: "Signature of Principal", fontSize: 7, align: "center", color: "#64748b" }),
        element("verify", "VERIFY_QR", 84, 80.2, 7, 7, { label: "Verification QR", locked: true }),
        element("qr-label", "TEXT", 80, 88, 14, 2, { value: "Verify document", fontSize: 6, align: "center", color: "#64748b" }),
      ],
    };
  }
  if (type === "ADMISSION_FORM") {
    return {
      elements: [
        element("page-bg", "SHAPE", 0, 0, 100, 100, { background: "#fff7ed", locked: true }),
        element("paper", "SHAPE", 4, 3, 92, 94, { background: "#ffffff", borderColor: "#fed7aa", locked: true }),
        element("top-band", "SHAPE", 4, 3, 92, 12, { background: "#ea580c", locked: true }),
        element("accent", "SHAPE", 4, 3, 1.2, 94, { background: "#f59e0b", locked: true }),
        element("logo", "IMAGE", 7, 5, 8, 8, { field: "school.logoPath", label: "Logo" }),
        element("school-name", "FIELD", 17, 5, 48, 4.6, { field: "school.name", label: "School name", fontSize: 21, fontWeight: "bold", color: "#ffffff", locked: true }),
        element("school-address", "FIELD", 17, 10, 48, 2.2, { field: "school.address", label: "Address", fontSize: 8, color: "#ffedd5" }),
        element("doc-label", "TEXT", 72, 6, 18, 2, { value: "ADMISSION RECORD", fontSize: 8, fontWeight: "bold", align: "right", color: "#ffffff" }),
        element("document-number", "FIELD", 68, 10, 22, 2.2, { field: "document.number", label: "Document number", fontSize: 8, fontWeight: "bold", align: "right", color: "#ffffff" }),
        element("title-bg", "SHAPE", 32, 18, 36, 5.5, { background: "#ffedd5", locked: true }),
        element("title", "TEXT", 33, 19.2, 34, 3, { value: "STUDENT ADMISSION FORM", fontSize: 15, fontWeight: "bold", align: "center", color: "#c2410c" }),
        element("session-label", "TEXT", 10, 27, 12, 2, { value: "SESSION", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("session-box", "TEXT", 22, 26.2, 18, 3.8, { value: "2026–27", fontSize: 10, fontWeight: "bold", align: "center", borderColor: "#cbd5e1" }),
        element("class-label", "TEXT", 47, 27, 17, 2, { value: "CLASS APPLIED", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("class", "FIELD", 64, 26.2, 14, 3.8, { field: "student.classLabel", label: "Class", fontSize: 10, fontWeight: "bold", align: "center", borderColor: "#cbd5e1" }),
        element("date-label", "TEXT", 80, 27, 8, 2, { value: "DATE", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("date", "FIELD", 87, 26.2, 6, 3.8, { field: "document.issueDate", label: "Date", fontSize: 7, align: "center", borderColor: "#cbd5e1" }),
        element("student-card", "SHAPE", 8, 33, 84, 22, { background: "#ffffff", borderColor: "#d9e2ec", locked: true }),
        element("section-1", "TEXT", 10, 35, 30, 2, { value: "Student details", fontSize: 10, fontWeight: "bold", color: "#c2410c" }),
        element("photo", "PHOTO", 10, 39, 16, 13, { field: "student.photo", label: "Photo", borderColor: "#94a3b8" }),
        element("name-label", "TEXT", 30, 39, 20, 2, { value: "STUDENT NAME", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("student-name", "FIELD", 30, 41.5, 36, 3, { field: "student.name", label: "Student name", fontSize: 15, fontWeight: "bold", color: "#0f172a" }),
        element("admission-label", "TEXT", 30, 47.5, 18, 2, { value: "ADMISSION NO", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("admission", "FIELD", 48, 47.2, 18, 2.5, { field: "student.admissionNo", label: "Admission number", fontSize: 9, fontWeight: "bold" }),
        element("dob-label", "TEXT", 69, 47.5, 8, 2, { value: "DOB", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("dob", "FIELD", 77, 47.2, 13, 2.5, { field: "student.born", label: "Date of birth", fontSize: 9, fontWeight: "bold" }),
        element("guardian-card", "SHAPE", 8, 58, 84, 14, { background: "#f8fafc", borderColor: "#d9e2ec", locked: true }),
        element("section-2", "TEXT", 10, 60, 35, 2, { value: "Parent / guardian information", fontSize: 10, fontWeight: "bold", color: "#c2410c" }),
        element("guardian-label", "TEXT", 10, 65, 14, 2, { value: "GUARDIAN", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("guardian", "FIELD", 24, 64.8, 24, 2.4, { field: "student.parent", label: "Guardian", fontSize: 9, fontWeight: "bold" }),
        element("phone-label", "TEXT", 52, 65, 10, 2, { value: "PHONE", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("phone", "FIELD", 62, 64.8, 26, 2.4, { field: "student.parentPhone", label: "Phone", fontSize: 9, fontWeight: "bold" }),
        element("checklist-title", "TEXT", 8, 76, 30, 2, { value: "Admission checklist", fontSize: 10, fontWeight: "bold", color: "#ea580c" }),
        element("checklist", "TEXT", 8, 79, 48, 7, { value: "☐ Birth certificate  ☐ Previous report card  ☐ Aadhaar / ID proof\n☐ Transfer certificate  ☐ Photos  ☐ Fee receipt", fontSize: 8, color: "#334155" }),
        element("declare-title", "TEXT", 8, 89, 18, 2, { value: "Declaration", fontSize: 8, fontWeight: "bold", color: "#c2410c" }),
        element("declare", "TEXT", 8, 91.5, 45, 3.5, { value: "I confirm that the above details are correct as per school records.", fontSize: 7, color: "#334155" }),
        element("verify", "VERIFY_QR", 60, 77, 10, 10, { label: "Verification QR", locked: true }),
        element("stamp", "STAMP", 72, 76, 10, 10, { field: "school.stampPath", label: "Stamp" }),
        element("signature", "SIGNATURE", 78, 86, 12, 5, { field: "school.signPath", label: "Principal signature" }),
        element("signature-label", "TEXT", 72, 92, 20, 2, { value: "Authorised signatory", fontSize: 7, align: "center", color: "#64748b" }),
      ],
    };
  }
  if (type === "FEE_INVOICE" || type === "PAYMENT_RECEIPT") {
    const paid = type === "PAYMENT_RECEIPT";
    const header = paid ? "#059669" : "#0F766E";
    const header2 = paid ? "#0D9488" : "#14B8A6";
    const page = paid ? "#ECFDF5" : "#F0FDFA";
    const titleBg = paid ? "#D1FAE5" : "#CCFBF1";
    const title = paid ? "PAYMENT RECEIPT" : "FEE INVOICE";
    return {
      elements: [
        element("page-bg", "SHAPE", 0, 0, 100, 100, { background: page, locked: true }),
        element("paper", "SHAPE", 4, 3, 92, 94, { background: "#ffffff", borderColor: "#99F6E4", locked: true }),
        element("top-band", "SHAPE", 4, 3, 58, 11, { background: header, locked: true }),
        element("top-band-2", "SHAPE", 50, 3, 46, 11, { background: header2, locked: true }),
        element("accent", "SHAPE", 4, 3, 1.4, 94, { background: "#22D3EE", locked: true }),
        element("school-logo", "IMAGE", 7, 5, 7, 7, { field: "school.logoPath", label: "Logo" }),
        element("school-name", "FIELD", 16, 5, 48, 4, { field: "school.name", label: "School name", fontSize: 18, fontWeight: "bold", color: "#ffffff", locked: true }),
        element("school-address", "FIELD", 16, 9.4, 48, 2, { field: "school.address", label: "School address", fontSize: 8, color: "#CCFBF1" }),
        element("document-number", "FIELD", 70, 6.5, 20, 2.5, { field: "document.number", label: "Document number", fontSize: 8, fontWeight: "bold", align: "right", color: "#ffffff" }),
        element("title-bg", "SHAPE", 28, 17, 44, 5.4, { background: titleBg, locked: true }),
        element("title", "TEXT", 29, 18.2, 42, 3, { value: title, fontSize: 15, fontWeight: "bold", align: "center", color: header }),
        element("info-card", "SHAPE", 8, 26, 84, 16, { background: page, borderColor: "#99F6E4", locked: true }),
        element("name-label", "TEXT", 10, 28, 18, 2, { value: "STUDENT NAME", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("student-name", "FIELD", 10, 30.4, 38, 3, { field: "student.name", label: "Student name", fontSize: 14, fontWeight: "bold" }),
        element("class-label", "TEXT", 50, 28, 12, 2, { value: "CLASS", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("class", "FIELD", 50, 30.4, 18, 3, { field: "student.classLabel", label: "Class", fontSize: 12, fontWeight: "bold" }),
        element("adm-label", "TEXT", 70, 28, 18, 2, { value: "ADMISSION NO", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("admission", "FIELD", 70, 30.4, 20, 3, { field: "student.admissionNo", label: "Admission number", fontSize: 11, fontWeight: "bold" }),
        element("date-label", "TEXT", 10, 35.5, 12, 2, { value: "DATE", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("date", "FIELD", 22, 35.3, 20, 2.4, { field: "document.issueDate", label: "Issue date", fontSize: 10, fontWeight: "bold" }),
        element("table-title", "TEXT", 8, 45, 40, 2.2, { value: paid ? "PAYMENT DETAILS" : "FEE DETAILS", fontSize: 8, fontWeight: "bold", color: header }),
        element("data-table", "TABLE", 8, 48, 84, 20, { field: "fees.lines", label: "Fee line items", fontSize: 8, background: header }),
        element("total-card", "SHAPE", 8, 70, 40, 10, { background: titleBg, borderColor: "#99F6E4", locked: true }),
        element("total-label", "TEXT", 10, 72, 18, 2, { value: paid ? "AMOUNT PAID" : "AMOUNT DUE", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("total", "FIELD", 10, 74.5, 36, 4, { field: paid ? "fees.paid" : "fees.amount", label: paid ? "Amount paid" : "Amount", fontSize: 18, fontWeight: "bold", color: header }),
        element("note", "TEXT", 8, 82, 52, 6, { value: paid ? "This receipt acknowledges payment recorded in the school fee ledger." : "This invoice shows amounts due. Fee lines and due rules are configured in Fees → Configure fees.", fontSize: 8, color: "#334155" }),
        element("signature", "SIGNATURE", 62, 70, 16, 8, { field: "school.signPath", label: "Authorised signature" }),
        element("signature-label", "TEXT", 58, 79, 24, 2, { value: "Authorised signature", fontSize: 7, align: "center", color: "#64748b" }),
        element("verify", "VERIFY_QR", 82, 70, 10, 10, { label: "Verification QR", locked: true }),
        element("qr-label", "TEXT", 80, 81, 14, 2, { value: "Verify document", fontSize: 6, align: "center", color: "#64748b" }),
        element("footer", "FIELD", 8, 90, 84, 3, { field: "school.contact", label: "School contact", fontSize: 8, align: "center", color: "#64748b" }),
      ],
    };
  }
  if (type === "BONAFIDE" || type === "TRANSFER_CERTIFICATE" || type === "EXPERIENCE_CERTIFICATE") {
    const bonafide = type === "BONAFIDE";
    const transfer = type === "TRANSFER_CERTIFICATE";
    const header = bonafide ? "#7C3AED" : transfer ? "#3730A3" : "#BE185D";
    const header2 = bonafide ? "#DB2777" : transfer ? "#2563EB" : "#EA580C";
    const page = bonafide ? "#FAF5FF" : transfer ? "#EEF2FF" : "#FFF1F2";
    const titleBg = bonafide ? "#F3E8FF" : transfer ? "#E0E7FF" : "#FFE4E6";
    const title = bonafide ? "BONAFIDE CERTIFICATE" : transfer ? "TRANSFER CERTIFICATE" : "EXPERIENCE CERTIFICATE";
    const employee = type === "EXPERIENCE_CERTIFICATE";
    return {
      elements: [
        element("page-bg", "SHAPE", 0, 0, 100, 100, { background: page, locked: true }),
        element("paper", "SHAPE", 5, 4, 90, 92, { background: "#ffffff", borderColor: header2, locked: true }),
        element("top-band", "SHAPE", 5, 4, 52, 12, { background: header, locked: true }),
        element("top-band-2", "SHAPE", 48, 4, 47, 12, { background: header2, locked: true }),
        element("school-logo", "IMAGE", 8, 6, 8, 8, { field: "school.logoPath", label: "Logo" }),
        element("school-name", "FIELD", 18, 6, 48, 4.2, { field: "school.name", label: "School name", fontSize: 20, fontWeight: "bold", color: "#ffffff", locked: true }),
        element("school-address", "FIELD", 18, 10.8, 48, 2.2, { field: "school.address", label: "School address", fontSize: 8, color: "#F5D0FE" }),
        element("document-number", "FIELD", 70, 8, 20, 2.5, { field: "document.number", label: "Document number", fontSize: 8, fontWeight: "bold", align: "right", color: "#ffffff" }),
        element("title-bg", "SHAPE", 22, 20, 56, 6, { background: titleBg, locked: true }),
        element("title", "TEXT", 23, 21.4, 54, 3.2, { value: title, fontSize: 16, fontWeight: "bold", align: "center", color: header }),
        ...(employee
          ? [
              element("name-label", "TEXT", 10, 31, 22, 2, { value: "EMPLOYEE NAME", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
              element("person-name", "FIELD", 10, 33.5, 62, 4, { field: "employee.name", label: "Employee name", fontSize: 16, fontWeight: "bold" }),
              element("id-label", "TEXT", 10, 39, 20, 2, { value: "EMPLOYEE ID", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
              element("identity", "FIELD", 30, 38.8, 22, 2.6, { field: "employee.employeeId", label: "Employee ID", fontSize: 11, fontWeight: "bold" }),
              element("class-or-role-label", "TEXT", 54, 39, 10, 2, { value: "ROLE", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
              element("class-or-role", "FIELD", 64, 38.8, 26, 2.6, { field: "employee.role", label: "Role / designation", fontSize: 11, fontWeight: "bold" }),
            ]
          : [
              element("photo", "PHOTO", 10, 30, 16, 18, { field: "student.photo", label: "Photo", borderColor: header }),
              element("name-label", "TEXT", 30, 31, 22, 2, { value: "STUDENT NAME", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
              element("person-name", "FIELD", 30, 33.5, 42, 4, { field: "student.name", label: "Student name", fontSize: 16, fontWeight: "bold" }),
              element("id-label", "TEXT", 30, 39, 20, 2, { value: "ADMISSION NO", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
              element("identity", "FIELD", 50, 38.8, 22, 2.6, { field: "student.admissionNo", label: "Admission number", fontSize: 11, fontWeight: "bold" }),
              element("class-or-role-label", "TEXT", 30, 43.5, 14, 2, { value: "CLASS", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
              element("class-or-role", "FIELD", 44, 43.3, 28, 2.6, { field: "student.classLabel", label: "Class and section", fontSize: 11, fontWeight: "bold" }),
            ]),
        element("body", "TEXT", 10, 54, 80, 16, {
          value: bonafide
            ? "This is to certify that the student named above is a bona fide student of this school for the current academic session, as recorded in the official school register."
            : transfer
              ? "This is to certify that the student named above is leaving this school. The particulars above are as maintained in the official school records."
              : "This is to certify that the employee named above has served this school in the role recorded above. This certificate is issued from official school records.",
          fontSize: 12,
          color: "#334155",
        }),
        element("date", "FIELD", 10, 74, 28, 3, { field: "document.issueDate", label: "Issue date", fontSize: 10, fontWeight: "bold" }),
        element("signature", "SIGNATURE", 58, 72, 16, 8, { field: "school.signPath", label: "Principal signature" }),
        element("signature-label", "TEXT", 54, 81, 24, 2, { value: "Principal / authorised signatory", fontSize: 7, align: "center", color: "#64748b" }),
        element("stamp", "STAMP", 42, 72, 10, 10, { field: "school.stampPath", label: "School stamp" }),
        element("verify", "VERIFY_QR", 80, 72, 10, 10, { label: "Verification QR", locked: true }),
        element("qr-label", "TEXT", 78, 83, 14, 2, { value: "Verify document", fontSize: 6, align: "center", color: "#64748b" }),
        element("footer", "FIELD", 10, 88, 80, 3, { field: "school.contact", label: "School contact", fontSize: 8, align: "center", color: "#64748b" }),
      ],
    };
  }
  if (type === "ADMISSION_ACK" || type === "ADMISSION_CONFIRMATION") {
    const ack = type === "ADMISSION_ACK";
    const header = ack ? "#0F766E" : "#4338CA";
    const header2 = ack ? "#059669" : "#7C3AED";
    const page = ack ? "#F0FDFA" : "#EEF2FF";
    const titleBg = ack ? "#CCFBF1" : "#E0E7FF";
    return {
      elements: [
        element("page-bg", "SHAPE", 0, 0, 100, 100, { background: page, locked: true }),
        element("paper", "SHAPE", 5, 4, 90, 92, { background: "#ffffff", borderColor: titleBg, locked: true }),
        element("top-band", "SHAPE", 5, 4, 90, 12, { background: header, locked: true }),
        element("accent", "SHAPE", 5, 4, 1.4, 92, { background: header2, locked: true }),
        element("school-logo", "IMAGE", 9, 6, 8, 8, { field: "school.logoPath", label: "Logo" }),
        element("school-name", "FIELD", 19, 6.2, 50, 4.2, { field: "school.name", label: "School name", fontSize: 20, fontWeight: "bold", color: "#ffffff", locked: true }),
        element("school-address", "FIELD", 19, 11, 50, 2, { field: "school.address", label: "School address", fontSize: 8, color: "#E0E7FF" }),
        element("document-number", "FIELD", 70, 8, 20, 2.5, { field: "document.number", label: "Document number", fontSize: 8, fontWeight: "bold", align: "right", color: "#ffffff" }),
        element("title-bg", "SHAPE", 24, 20, 52, 6, { background: titleBg, locked: true }),
        element("title", "TEXT", 25, 21.4, 50, 3.2, { value: ack ? "ADMISSION ACKNOWLEDGEMENT" : "ADMISSION CONFIRMATION", fontSize: 14, fontWeight: "bold", align: "center", color: header }),
        element("photo", "PHOTO", 10, 30, 16, 18, { field: "student.photo", label: "Photo", borderColor: header }),
        element("name-label", "TEXT", 30, 31, 20, 2, { value: "STUDENT NAME", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("student-name", "FIELD", 30, 33.5, 42, 4, { field: "student.name", label: "Student name", fontSize: 16, fontWeight: "bold" }),
        element("class-label", "TEXT", 30, 40, 12, 2, { value: "CLASS", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("class", "FIELD", 42, 39.8, 20, 2.6, { field: "student.classLabel", label: "Class", fontSize: 11, fontWeight: "bold" }),
        element("adm-label", "TEXT", 64, 40, 16, 2, { value: "ADMISSION NO", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("admission", "FIELD", 80, 39.8, 12, 2.6, { field: "student.admissionNo", label: "Admission number", fontSize: 10, fontWeight: "bold" }),
        element("body", "TEXT", 10, 54, 80, 14, {
          value: ack
            ? "This acknowledges receipt of the admission application / record for the student named above. Keep this document for school records."
            : "This confirms that the student named above has been admitted as recorded in the official school register.",
          fontSize: 12,
          color: "#334155",
        }),
        element("date", "FIELD", 10, 72, 28, 3, { field: "document.issueDate", label: "Issue date", fontSize: 10, fontWeight: "bold" }),
        element("signature", "SIGNATURE", 58, 70, 16, 8, { field: "school.signPath", label: "Authorised signature" }),
        element("signature-label", "TEXT", 54, 79, 24, 2, { value: "Authorised signatory", fontSize: 7, align: "center", color: "#64748b" }),
        element("verify", "VERIFY_QR", 80, 70, 10, 10, { label: "Verification QR", locked: true }),
        element("footer", "FIELD", 10, 88, 80, 3, { field: "school.contact", label: "School contact", fontSize: 8, align: "center", color: "#64748b" }),
      ],
    };
  }
  const palette = catalogPagePalette(type, meta?.category);
  const tableField = type === "REPORT_CARD" || type.includes("MARK") || type.includes("RESULT") || type.includes("PROGRESS")
    ? "results.marks"
    : type === "EXAM_DATE_SHEET" || type === "SEATING_PLAN" || type === "INVIGILATOR_DUTY"
      ? "exam.schedule"
      : meta?.category === "FEES"
        ? "fees.lines"
        : "";
  const title = meta?.label || "School document";
  const isEmployee = meta?.category === "EMPLOYEE";
  const isFinance = meta?.category === "FEES";
  const isAcademic = meta?.category === "ACADEMIC";
  const subjectField = isEmployee ? "employee.name" : "student.name";
  const subjectIdField = isEmployee ? "employee.employeeId" : "student.admissionNo";
  const subjectLabel = isEmployee ? "Employee" : meta?.category === "GENERAL" ? "Reference" : "Student";
  const subjectIdLabel = isEmployee ? "Employee ID" : "Admission No.";
  const classField = isEmployee ? "employee.role" : "student.classLabel";
  const classLabel = isEmployee ? "Role" : "Class";
  const isCertificate = /CERTIFICATE|BONAFIDE|CLEARANCE|CONFIRMATION|NO_DUES|PARTICIPATION|MERIT|ACHIEVEMENT/.test(type);
  const isLetter = /LETTER|CIRCULAR|NOTICE|INVITATION|DECLARATION|CONSENT|ACKNOWLEDGEMENT/.test(type) || meta?.category === "GENERAL";
  const bodyText = isFinance
    ? "Please find the fee details below. Payments are posted to the student ledger after verification by the school office."
    : isAcademic
      ? "This academic document is issued from the official records maintained by the school for the current session."
      : isEmployee
        ? "This employee document is issued for the staff record stated below as maintained by the school office."
        : isCertificate
          ? "This is to certify that the details recorded below are true as per the official records maintained by the school."
          : isLetter
            ? "This document is issued by the school office for formal communication and record purposes."
            : "This document is issued from the official school records.";
  const statementText = isCertificate
    ? "Issued on request, based on the particulars available in the school records on the issue date."
    : isEmployee
      ? "The above staff details may be verified with the school office using the document reference and verification code."
      : isLetter
        ? "Please use this section for the final communication text before issuing the document."
        : "The above particulars are recorded for reference and may be verified with the school office.";
  const elements: DocumentElement[] = [
    element("page-bg", "SHAPE", 0, 0, 100, 100, { background: palette.page, locked: true }),
    element("paper", "SHAPE", 4, 3, 92, 94, { background: "#ffffff", borderColor: palette.line, locked: true }),
    element("top-band", "SHAPE", 4, 3, 62, 10, { background: palette.header, locked: true }),
    element("top-band-2", "SHAPE", 54, 3, 42, 10, { background: palette.header2, locked: true }),
    element("accent", "SHAPE", 4, 3, 1.4, 94, { background: palette.accent, locked: true }),
    element("header-line", "SHAPE", 4, 13, 92, 0.5, { background: palette.accent, locked: true }),
    element("school-logo", "IMAGE", 7, 5, 7, 6, { field: "school.logoPath", label: "Logo" }),
    element("school-name", "FIELD", 16, 5, 52, 3.6, { field: "school.name", label: "School name", fontSize: isCard ? 12 : 20, fontWeight: "bold", align: "center", color: "#ffffff", locked: true }),
    element("school-address", "FIELD", 16, 9.2, 52, 1.8, { field: "school.address", label: "School address", fontSize: isCard ? 6 : 8, align: "center", color: palette.onHeaderMuted }),
    element("document-number", "FIELD", 72, 7, 18, 2.5, { field: "document.number", label: "Document number", fontSize: 7, fontWeight: "bold", align: "right", color: "#ffffff" }),
    element("title-bg", "SHAPE", 24, isCard ? 18 : 17, 52, 5.5, { background: palette.titleBg, locked: true }),
    element("title", "TEXT", 25, isCard ? 19.3 : 18.3, 50, 2.8, { value: meta?.label || "School document", fontSize: isCard ? 11 : 14, fontWeight: "bold", align: "center", color: palette.header }),
    element("info-card", "SHAPE", 8, isCard ? 30 : 28, 84, isCard ? 36 : 24, { background: palette.card, borderColor: palette.line, locked: true }),
    element("photo", "PHOTO", 10, isCard ? 33 : 31, isCard ? 18 : 16, isCard ? 25 : 17, { field: meta?.category === "EMPLOYEE" ? "employee.photo" : "student.photo", label: "Photo", borderColor: "#bcccdc" }),
    element("name-label", "TEXT", 30, isCard ? 35 : 32, 20, 2, { value: meta?.category === "EMPLOYEE" ? "EMPLOYEE NAME" : "STUDENT NAME", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
    element("student-name", "FIELD", 30, isCard ? 38 : 35, 36, 3.5, { field: meta?.category === "EMPLOYEE" ? "employee.name" : "student.name", label: meta?.category === "EMPLOYEE" ? "Employee name" : "Student name", fontSize: isCard ? 11 : 15, fontWeight: "bold" }),
    element("id-label", "TEXT", 30, isCard ? 46 : 43, 18, 2, { value: meta?.category === "EMPLOYEE" ? "EMPLOYEE ID" : "ADMISSION NO", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
    element("identity", "FIELD", 48, isCard ? 45.8 : 42.8, 20, 2.6, { field: meta?.category === "EMPLOYEE" ? "employee.employeeId" : "student.admissionNo", label: meta?.category === "EMPLOYEE" ? "Employee ID" : "Admission number", fontSize: isCard ? 8 : 10, fontWeight: "bold" }),
    element("verify", "VERIFY_QR", 78, isCard ? 42 : 41, isCard ? 12 : 10, isCard ? 12 : 10, { label: "Verification QR", locked: true }),
    element("signature", "SIGNATURE", 66, isCard ? 70 : 84, 16, 7, { label: "Authorised signature" }),
    element("signature-label", "TEXT", 61, isCard ? 78 : 92, 26, 2, { value: "Authorised signature", fontSize: 7, align: "center", color: "#64748b" }),
  ];
  if (tableField) {
    elements.push(element("table-title", "TEXT", 8, 57, 28, 2.2, { value: tableField === "fees.lines" ? "FEE DETAILS" : tableField === "results.marks" ? "ACADEMIC DETAILS" : "DETAILS", fontSize: 8, fontWeight: "bold", color: palette.header }));
    elements.push(element("data-table", "TABLE", 8, 60, 84, 17, { field: tableField, label: DOCUMENT_FIELDS.find((f) => f.id === tableField)?.label, fontSize: 8, background: palette.header }));
  } else if (!isCard) {
    elements.push(element("body", "TEXT", 10, 58, 80, 15, { value: "This document certifies that the information recorded above is maintained in the official school records.", fontSize: 11, align: "left", color: "#334155" }));
  }
  elements.push(
    element("footer-line", "LINE", 8, 88, 84, 0.2, { borderColor: "#d8e1ef", locked: true }),
    element("prepared-label", "TEXT", 8, 91, 18, 1.4, { value: "Prepared by", fontSize: 10, color: "#64748b" }),
    element("prepared-by", "TEXT", 8, 93, 32, 1.6, { value: "School Office", fontSize: 12, color: "#16253a" }),
    element("stamp", "STAMP", 45, 88.8, 11, 7, { field: "school.stampPath", label: "Stamp" }),
    element("signature", "SIGNATURE", 70, 89, 20, 5, { field: "school.signPath", label: "Signature" }),
    element("signature-label", "TEXT", 68, 94.8, 24, 1.6, { value: "Authorized Signatory", fontSize: 11, align: "right", color: "#16253a" }),
  );
  return { elements };
}

export function parseDocumentLayout(value: string | null | undefined): DocumentLayout {
  try {
    const row = JSON.parse(value || "{}") as Partial<DocumentLayout>;
    return { elements: Array.isArray(row.elements) ? row.elements : [] };
  } catch {
    return { elements: [] };
  }
}

function withRequiredOfficialElements(type: string, layout: DocumentLayout): DocumentLayout {
  let elements = layout.elements;
  if ((type === "FEE_INVOICE" || type === "PAYMENT_RECEIPT") && !elements.some((item) => item.type === "VERIFY_QR")) {
    elements = [
      ...elements,
      element("verify-qr", "VERIFY_QR", 84, 35.4, 6.5, 6.5, { label: "Verification QR", locked: true }),
      element("verify-caption", "TEXT", 81.8, 42.1, 11, 1.4, { value: "VERIFY", fontSize: 7, fontWeight: "bold", align: "center", color: "#64748b" }),
    ];
  }
  if (type === "PAYMENT_RECEIPT" && !elements.some((item) => item.field === "fees.method")) {
    elements = [
      ...elements,
      element("audit-method-label", "TEXT", 8, 81.5, 14, 1.4, { value: "Method", fontSize: 9, fontWeight: "bold", color: "#64748b" }),
      element("audit-method", "FIELD", 8, 83.2, 16, 1.8, { field: "fees.method", label: "Payment method", fontSize: 10, fontWeight: "bold", color: "#16253a" }),
      element("audit-ref-label", "TEXT", 28, 81.5, 16, 1.4, { value: "Reference", fontSize: 9, fontWeight: "bold", color: "#64748b" }),
      element("audit-ref", "FIELD", 28, 83.2, 22, 1.8, { field: "fees.reference", label: "Payment reference", fontSize: 10, fontWeight: "bold", color: "#16253a" }),
      element("audit-by-label", "TEXT", 54, 81.5, 16, 1.4, { value: "Received by", fontSize: 9, fontWeight: "bold", color: "#64748b" }),
      element("audit-by", "FIELD", 54, 83.2, 17, 1.8, { field: "fees.receivedBy", label: "Received by", fontSize: 10, fontWeight: "bold", color: "#16253a" }),
      element("audit-at-label", "TEXT", 76, 81.5, 14, 1.4, { value: "Received at", fontSize: 9, fontWeight: "bold", color: "#64748b" }),
      element("audit-at", "FIELD", 76, 83.2, 16, 1.8, { field: "fees.receivedAt", label: "Received at", fontSize: 10, fontWeight: "bold", color: "#16253a" }),
      element("audit-note-label", "TEXT", 8, 85.6, 9, 1.4, { value: "Note", fontSize: 9, fontWeight: "bold", color: "#64748b" }),
      element("audit-note", "FIELD", 17, 85.6, 75, 1.8, { field: "fees.receivedNote", label: "Payment note", fontSize: 9, color: "#334155" }),
    ];
  }
  return { elements };
}

export function builtInTemplates() {
  return DOCUMENT_TYPES.map((type) => ({
    id: `builtin:${type.id}`,
    builtIn: true,
    type: type.id,
    category: type.category,
    name: type.label,
    description: type.hint,
    pageSize: type.id === "STUDENT_ID" || type.id === "EMPLOYEE_ID" ? "CR80" : "A4",
    orientation: type.id === "STUDENT_ID" || type.id === "EMPLOYEE_ID" ? "LANDSCAPE" : "PORTRAIT",
    status: "DEFAULT",
    activeVersion: null,
    hasDraft: false,
    updatedAt: null,
    layout: defaultLayout(type.id),
  }));
}

export async function documentStudioBundle(user: AccessUser) {
  const schoolId = schoolIdFor(user);
  const [templates, issued] = await Promise.all([
    prisma.documentTemplate.findMany({ where: { schoolId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } }),
    prisma.issuedDocument.findMany({ where: { schoolId }, include: { templateVersion: { include: { template: true } } }, orderBy: { issuedAt: "desc" }, take: 100 }),
  ]);
  return {
    categories: DOCUMENT_CATEGORIES,
    types: DOCUMENT_TYPES,
    fields: DOCUMENT_FIELDS,
    defaults: builtInTemplates(),
    templates: templates.map((row) => ({
      id: row.id,
      builtIn: false,
      type: row.type,
      category: row.category,
      name: row.name,
      description: row.description,
      pageSize: row.pageSize,
      orientation: row.orientation,
      scope: safeObject(row.scopeJson),
      status: row.status,
      activeVersion: row.activeVersion,
      hasDraft: Boolean(row.activeVersion && row.versions[0] && row.draftJson !== row.versions[0].layoutJson),
      updatedAt: row.updatedAt.toISOString(),
      layout: withRequiredOfficialElements(row.type, parseDocumentLayout(row.draftJson)),
    })),
    issued: issued.map((row) => ({
      id: row.id,
      documentNumber: row.documentNumber,
      type: row.type,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      subjectLabel: row.subjectLabel,
      status: row.status,
      issuedAt: row.issuedAt.toISOString(),
      batchId: row.batchId,
      verifyUrl: `${publicOrigin()}/verify/${row.verifyToken}`,
      documentUrl: `${publicOrigin()}/documents/${row.verifyToken}`,
      templateName: row.templateVersion.template.name,
      version: row.templateVersion.version,
    })),
  };
}

function safeObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function need(user: AccessUser, ...keys: string[]) {
  if (!keys.some((key) => can(user, key))) throw new Error("No access.");
}

function schoolIdFor(user: AccessUser) {
  return String((user as AccessUser & { schoolId?: string | null }).schoolId || DEFAULT_DOCUMENT_SCHOOL_ID);
}

function cleanLayout(input: unknown): DocumentLayout {
  const row = (input && typeof input === "object" ? input : {}) as Partial<DocumentLayout>;
  const allowedTypes = new Set<DocumentElementType>(["TEXT", "FIELD", "IMAGE", "PHOTO", "TABLE", "SIGNATURE", "STAMP", "VERIFY_QR", "CUSTOM_QR", "BARCODE", "SHAPE", "LINE", "PAGE_NUMBER"]);
  const elements = (Array.isArray(row.elements) ? row.elements : []).slice(0, 200).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const value = raw as Partial<DocumentElement>;
    if (!value.type || !allowedTypes.has(value.type)) return [];
    const bounded = (n: unknown, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, Number(n) || fallback));
    return [{
      id: String(value.id || `element-${index}`).slice(0, 80),
      type: value.type,
      x: bounded(value.x, 0, 0, 100),
      y: bounded(value.y, 0, 0, 100),
      width: bounded(value.width, 20, 2, 100),
      height: bounded(value.height, 6, 0.2, 100),
      label: String(value.label || "").slice(0, 120),
      value: String(value.value || "").slice(0, 4000),
      field: String(value.field || "").slice(0, 120),
      fontSize: bounded(value.fontSize, 14, 6, 72),
      fontWeight: value.fontWeight === "bold" ? "bold" as const : "normal" as const,
      align: value.align === "center" || value.align === "right" ? value.align : "left" as const,
      color: /^#[0-9a-f]{6}$/i.test(String(value.color || "")) ? String(value.color) : "#102a43",
      background: /^#[0-9a-f]{6}$/i.test(String(value.background || "")) ? String(value.background) : undefined,
      borderColor: /^#[0-9a-f]{6}$/i.test(String(value.borderColor || "")) ? String(value.borderColor) : undefined,
      locked: Boolean(value.locked),
    }];
  });
  return { elements };
}

export async function saveDocumentTemplateCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.design", "school.edit");
  const schoolId = schoolIdFor(user);
  const type = String(input.type || "");
  const meta = DOCUMENT_TYPES.find((row) => row.id === type);
  if (!meta) throw new Error("Choose a supported document type.");
  const name = String(input.name || meta.label).trim().slice(0, 100);
  if (!name) throw new Error("Template name is required.");
  const layout = withRequiredOfficialElements(type, cleanLayout(input.layout));
  if (!layout.elements.length) throw new Error("Add at least one element to the template.");
  const data = {
    schoolId,
    type,
    category: meta.category,
    name,
    description: String(input.description || meta.hint).trim().slice(0, 300),
    pageSize: ["A4", "A5", "LETTER", "CR80", "CUSTOM"].includes(String(input.pageSize || "")) ? String(input.pageSize) : "A4",
    orientation: String(input.orientation || "").toUpperCase() === "LANDSCAPE" ? "LANDSCAPE" : "PORTRAIT",
    scopeJson: JSON.stringify(input.scope && typeof input.scope === "object" ? input.scope : {}),
    draftJson: JSON.stringify(layout),
    updatedById: user.id,
  };
  const id = String(input.id || "");
  if (id && !id.startsWith("builtin:")) {
    const existing = await prisma.documentTemplate.findUnique({ where: { id } });
    if (!existing || existing.schoolId !== schoolId) throw new Error("Template not found.");
    return prisma.documentTemplate.update({ where: { id }, data: { ...data, status: existing.status === "ARCHIVED" ? "DRAFT" : existing.status } });
  }
  return prisma.documentTemplate.create({ data: { ...data, createdById: user.id, status: "DRAFT" } });
}

export async function publishDocumentTemplateCore(user: AccessUser, input: { id?: string }) {
  need(user, "documents.publish", "school.edit");
  const schoolId = schoolIdFor(user);
  const id = String(input.id || "");
  const row = await prisma.documentTemplate.findFirst({ where: { id, schoolId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!row) throw new Error("Template not found.");
  const layout = withRequiredOfficialElements(row.type, parseDocumentLayout(row.draftJson));
  if (!layout.elements.length) throw new Error("Template is empty.");
  if (!layout.elements.some((item) => item.type === "VERIFY_QR")) throw new Error("Verification QR is required before publishing this template.");
  const version = (row.versions[0]?.version || 0) + 1;
  const layoutJson = JSON.stringify(layout);
  await prisma.$transaction([
    prisma.documentTemplate.updateMany({
      where: { schoolId, type: row.type, status: "ACTIVE", id: { not: row.id } },
      data: { status: "PUBLISHED", updatedById: user.id },
    }),
    prisma.documentTemplateVersion.create({ data: { schoolId, templateId: row.id, version, layoutJson, pageSize: row.pageSize, orientation: row.orientation, scopeJson: row.scopeJson, publishedById: user.id } }),
    prisma.documentTemplate.update({ where: { id: row.id }, data: { status: "ACTIVE", activeVersion: version, draftJson: layoutJson, updatedById: user.id } }),
  ]);
  return { id: row.id, version };
}

export async function archiveDocumentTemplateCore(user: AccessUser, input: { id?: string }) {
  need(user, "documents.publish", "school.edit");
  const schoolId = schoolIdFor(user);
  const id = String(input.id || "");
  const row = await prisma.documentTemplate.findFirst({ where: { id, schoolId } });
  if (!row) throw new Error("Template not found.");
  await prisma.documentTemplate.update({ where: { id }, data: { status: "ARCHIVED", updatedById: user.id } });
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function atPath(data: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, data);
}

async function assetSrc(value: unknown) {
  const path = String(value || "");
  if (!path) return "";
  if (/^(https?:\/\/|data:)/i.test(path)) return path;
  const rel = path.replace(/^\/+/, "");
  if (resolveUploadPath(rel).publicFile) return `${publicOrigin()}/api/files/${rel}`;
  try {
    return await readUploadDataUrl(rel);
  } catch {
    return "";
  }
}

function gradeBadgeHtml(grade: unknown) {
  const text = String(grade ?? "—");
  const g = text.toUpperCase();
  let bg = "#DBEAFE";
  let color = "#2563EB";
  if (g.includes("A+") || g === "A1" || g === "A") { bg = "#DCFCE7"; color = "#16A34A"; }
  else if (g.startsWith("A")) { bg = "#DBEAFE"; color = "#2563EB"; }
  else if (g.includes("B+") || g === "B1") { bg = "#EDE9FE"; color = "#7C3AED"; }
  else if (g.startsWith("B")) { bg = "#FEF3C7"; color = "#D97706"; }
  else if (g.startsWith("C")) { bg = "#FFEDD5"; color = "#EA580C"; }
  else if (g.startsWith("D") || g.startsWith("E") || g.startsWith("F") || g.includes("FAIL")) { bg = "#FEE2E2"; color = "#DC2626"; }
  return `<span style="display:inline-block;padding:1px 7px;border-radius:999px;background:${bg};color:${color};font-weight:700;font-size:8px;letter-spacing:.02em">${escapeHtml(text)}</span>`;
}

function tableHtml(value: unknown, label: string, headerColor = "#2563EB") {
  if (!Array.isArray(value) || !value.length) return `<div class="empty-table">${escapeHtml(label)}</div>`;
  const rows = value.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  if (!rows.length) return `<div class="empty-table">${escapeHtml(label)}</div>`;
  const keys = Object.keys(rows[0]).slice(0, 8);
  return `<table><thead><tr>${keys.map((key) => `<th style="background:${headerColor}">${escapeHtml(key.replace(/([A-Z])/g, " $1").trim())}</th>`).join("")}</tr></thead><tbody>${rows.map((row, index) => `<tr class="${index % 2 ? "alt" : ""}">${keys.map((key) => {
    const cell = row[key];
    const header = key.toLowerCase();
    const align = /mark|max|percent|point|grade/.test(header) ? "num" : "";
    const body = /grade/.test(header) && !/point/.test(header) ? gradeBadgeHtml(cell) : escapeHtml(cell);
    return `<td class="${align}">${body}</td>`;
  }).join("")}</tr>`).join("")}</tbody></table>`;
}

function attendanceBarHtml(value: unknown) {
  const n = Math.max(0, Math.min(100, Number(String(value ?? "").replace("%", "")) || 0));
  const color = n >= 90 ? "#16A34A" : n >= 75 ? "#2563EB" : n >= 60 ? "#F59E0B" : "#DC2626";
  return `<div style="display:flex;align-items:center;gap:8px;height:100%;padding:0 2px;box-sizing:border-box">
    <div style="flex:1;height:8px;background:#E2E8F0;border-radius:999px;overflow:hidden"><div style="width:${n}%;height:100%;background:${color}"></div></div>
    <span style="font-size:10px;font-weight:700;color:${color};min-width:32px">${n}%</span>
  </div>`;
}

function promotionTone(value: unknown) {
  const text = String(value || "").toUpperCase();
  if (text.includes("FAIL")) return { color: "#DC2626", background: "#FEF2F2" };
  if (text.includes("NEED") || text.includes("HOLD") || text.includes("PENDING")) return { color: "#D97706", background: "#FFFBEB" };
  return { color: "#16A34A", background: "#ECFDF3" };
}

function pageDimensions(pageSize: string, orientation: string) {
  const sizes: Record<string, [number, number]> = {
    A4: [210, 297],
    A5: [148, 210],
    LETTER: [216, 279],
    CR80: [54, 85.6],
    CUSTOM: [210, 297],
  };
  const size = sizes[pageSize] || sizes.A4;
  return orientation === "LANDSCAPE" ? [size[1], size[0]] : size;
}

async function renderIssuedHtml(layout: DocumentLayout, data: Record<string, unknown>, verifyUrl: string, pageSize: string, orientation: string) {
  const [pageWidth, pageHeight] = pageDimensions(pageSize, orientation);
  const content = (await Promise.all(layout.elements.map(async (item) => {
    const base = `position:absolute;left:${item.x}%;top:${item.y}%;width:${item.width}%;height:${item.height}%;font-size:${item.fontSize || 14}px;font-weight:${item.fontWeight || "normal"};text-align:${item.align || "left"};color:${item.color || "#102a43"};overflow:hidden;box-sizing:border-box;`;
    if (item.type === "VERIFY_QR" || item.type === "CUSTOM_QR") {
      const studentId = String(atPath(data, "student.id") || "");
      const documentType = String(atPath(data, "document.type") || "");
      const isAttendanceQr = item.type === "VERIFY_QR" && studentId && (documentType === "STUDENT_ID" || /attendance/i.test(item.label || ""));
      const url = item.type === "VERIFY_QR"
        ? isAttendanceQr ? `${publicOrigin()}/attendance/scan/${encodeURIComponent(studentId)}` : verifyUrl
        : String((item.field ? atPath(data, item.field) : "") || item.value || "");
      if (!/^https?:\/\//i.test(url)) return `<div style="${base}border:1px dashed #bcccdc;display:flex;align-items:center;justify-content:center">QR URL missing</div>`;
      const image = await QRCode.toDataURL(url, { errorCorrectionLevel: "Q", margin: 4, width: 320, color: { dark: "#000000", light: "#ffffff" } });
      return `<img alt="${isAttendanceQr ? "Attendance scan QR" : item.type === "VERIFY_QR" ? "Document verification QR" : "QR code"}" src="${image}" style="${base}object-fit:contain">`;
    }
    if (item.type === "BARCODE") {
      const value = String(atPath(data, item.field || "document.number") || atPath(data, "document.number") || "");
      const image = await barcodeBuffer({ bcid: "code128", text: value, scale: 3, height: 10, includetext: true, textxalign: "center" });
      return `<img alt="Barcode ${escapeHtml(value)}" src="data:image/png;base64,${image.toString("base64")}" style="${base}object-fit:contain">`;
    }
    if (item.type === "SIGNATURE" || item.type === "STAMP" || item.type === "PHOTO" || item.type === "IMAGE") {
      const field = item.field || (item.type === "SIGNATURE" ? "school.signPath" : item.type === "STAMP" ? "school.stampPath" : item.type === "IMAGE" ? "school.logoPath" : "student.photo");
      const src = assetSrc(atPath(data, field));
      const round = item.type === "PHOTO" ? "border-radius:8px;" : item.type === "IMAGE" ? "border-radius:10px;" : "";
      return src ? `<img alt="${escapeHtml(item.label || item.type)}" src="${escapeHtml(src)}" style="${base}${round}object-fit:${item.type === "PHOTO" ? "cover" : "contain"}">` : `<div style="${base}${round}border:1px dashed #bcccdc;display:flex;align-items:center;justify-content:center">${escapeHtml(item.label || item.type)}</div>`;
    }
    if (item.type === "TABLE") return `<div style="${base}">${tableHtml(atPath(data, item.field || ""), item.label || "Table", item.background || "#2563EB")}</div>`;
    if (item.type === "LINE") return `<div style="${base}height:1px;background:${item.borderColor || item.color || "#102a43"}"></div>`;
    if (item.type === "SHAPE") {
      const radius = item.borderColor || (item.width < 40 && item.height < 14) ? "8px" : item.height <= 2.5 && item.width > 40 ? "0" : "0";
      return `<div style="${base}border-radius:${radius};${item.background ? `background:${item.background};` : ""}${item.borderColor ? `border:1px solid ${item.borderColor};` : ""}"></div>`;
    }
    if (item.type === "FIELD" && item.field === "results.attendanceBar") {
      return `<div style="${base}">${attendanceBarHtml(atPath(data, "results.attendanceBar") ?? atPath(data, "results.attendancePercentage"))}</div>`;
    }
    const value = item.type === "FIELD" ? atPath(data, item.field || "") : item.type === "PAGE_NUMBER" ? (item.value || "1") : item.value || item.label || "";
    const display = item.field === "results.percentage" || item.field === "results.attendancePercentage"
      ? (String(value || "").includes("%") ? String(value || "") : value === "" || value == null ? "" : `${value}%`)
      : value;
    let color = item.color || "#102a43";
    let background = item.background;
    if (item.field === "results.promotionStatus") {
      const tone = promotionTone(display);
      color = item.color && item.color !== "#102a43" ? item.color : tone.color;
    }
    const justify = item.align === "center" ? "center" : item.align === "right" ? "flex-end" : "flex-start";
    const alignItems = item.height > 3.5 ? "flex-start" : "center";
    return `<div style="${base}display:flex;align-items:${alignItems};justify-content:${justify};padding:1px 3px;line-height:1.25;white-space:pre-wrap;${background ? `background:${background};` : ""}${item.borderColor ? `border:1px solid ${item.borderColor};` : ""}color:${color}">${escapeHtml(display)}</div>`;
  }))).join("");
  const previewScale = pageSize === "CR80" ? 3.2 : 1;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(atPath(data, "document.number"))}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&display=swap" rel="stylesheet"><style>@page{size:${pageWidth}mm ${pageHeight}mm;margin:0}body{margin:0;background:#eef2f7;font-family:Inter,system-ui,"Segoe UI",sans-serif;color:#0f172a}.toolbar{position:sticky;top:0;z-index:2;padding:12px;text-align:center;background:#eef2f7}.page-wrap{display:flex;justify-content:center;padding:24px}.page{position:relative;width:${pageWidth}mm;height:${pageHeight}mm;background:white;box-shadow:0 2px 18px #102a4322;overflow:hidden;transform:scale(${previewScale});transform-origin:top center;margin-bottom:${pageSize === "CR80" ? "260px" : "24px"}}table{width:100%;height:100%;border-collapse:collapse;font-size:inherit}th{background:#2563EB;color:#fff;padding:5px 6px;font-size:7.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;border:none;text-align:left}td{padding:4px 6px;border-bottom:1px solid #E2E8F0;color:#0f172a}tr.alt td{background:#F8FAFC}td.num,th.num{text-align:center}.empty-table{border:1px dashed #E2E8F0;border-radius:8px;padding:8px;color:#64748b;font-size:8px}@media print{body{background:white}.toolbar{display:none}.page-wrap{display:block;padding:0}.page{margin:0;box-shadow:none;transform:none}}</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save PDF</button></div><div class="page-wrap"><main class="page">${content}</main></div></body></html>`;
}

function schoolContactLine(school: Record<string, unknown>) {
  return [school.phone, school.email].filter(Boolean).join(" • ");
}

function incomingMarkRows(raw: unknown) {
  if (!Array.isArray(raw) || !raw.length) return null;
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const subject = String(row.Subject || row.subject || "");
    if (!subject) return [];
    return [{
      subject,
      marks: (row["Marks Obtained"] ?? row.Marks ?? row.marks ?? "—") as string | number,
      maxMarks: Number(row["Max Marks"] ?? row.Max ?? row.maxMarks ?? 0),
      absent: String(row.Marks ?? row.marks ?? "").toLowerCase() === "absent" || String(row["Marks Obtained"] || "").toLowerCase() === "ab",
      remarks: String(row.Remark || row.remarks || ""),
      grade: String(row.Grade || row.grade || ""),
    }];
  });
}

async function hydrateIssuedDocumentData(type: string, subjectType: string, subjectId: string, data: Record<string, unknown>) {
  const schoolIn = (data.school && typeof data.school === "object" ? data.school : {}) as Record<string, unknown>;
  const studentIn = (data.student && typeof data.student === "object" ? data.student : {}) as Record<string, unknown>;
  const year = academicYearLabel(String(schoolIn.sessionStart || ""), String(schoolIn.sessionEnd || ""));
  const parts = splitClassLabel(String(studentIn.classLabel || ""));
  let next: Record<string, unknown> = {
    ...data,
    school: {
      ...schoolIn,
      academicYear: schoolIn.academicYear || year,
      sessionTitle: schoolIn.sessionTitle || `Academic Session ${schoolIn.academicYear || year}`,
      contact: schoolIn.contact || schoolContactLine(schoolIn),
    },
    student: {
      ...studentIn,
      className: studentIn.className || parts.className,
      sectionName: studentIn.sectionName || parts.sectionName,
      id: studentIn.id || subjectId,
    },
    staff: {
      ...((data.staff && typeof data.staff === "object" ? data.staff : {}) as Record<string, unknown>),
      principalName: ((data.staff as Record<string, unknown> | undefined)?.principalName) || schoolIn.signatory || "Principal",
    },
  };
  const reportType = isReportCardType(type);
  if (!reportType || subjectType !== "STUDENT" || !subjectId) return next;

  try {
    const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
    const school = schoolFromConfig(config);
    const policy = gradePolicyFrom(config);
    const dbStudent = await prisma.student.findUnique({
      where: { id: subjectId },
      include: {
        class: { include: { students: { select: { id: true, name: true } }, teachers: { include: { user: true } } } },
        attendance: { select: { status: true } },
      },
    });
    if (dbStudent) {
      const classLabel = `${dbStudent.class.name}-${dbStudent.class.section}`;
      const classParts = splitClassLabel(classLabel);
      const classTeacher = dbStudent.class.teachers.find((row) => row.classId === dbStudent.classId);
      next = mergeReportCardData(next, {
        school: {
          name: school.name,
          address: [school.address, school.city, school.state, school.pincode].filter(Boolean).join(", "),
          phone: school.phone,
          email: school.email,
          contact: schoolContactLine({ phone: school.phone, email: school.email }),
          academicYear: academicYearLabel(school.sessionStart, school.sessionEnd),
          sessionTitle: `Academic Session ${academicYearLabel(school.sessionStart, school.sessionEnd)}`,
          logoPath: school.logoPath,
          signPath: school.signPath,
          stampPath: school.stampPath,
          signatory: school.signatory,
        },
        student: {
          id: dbStudent.id,
          name: dbStudent.name,
          admissionNo: dbStudent.admissionNo,
          classLabel,
          className: classParts.className,
          sectionName: classParts.sectionName,
          dateOfBirth: dbStudent.dateOfBirth.toISOString().slice(0, 10),
          born: dbStudent.dateOfBirth.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
        },
        staff: {
          classTeacherName: classTeacher?.user.name || "",
          principalName: school.signatory || "Principal",
        },
      });
      const series = await prisma.examSeries.findFirst({
        where: { classId: dbStudent.classId, publishedAt: { not: null } },
        orderBy: { publishedAt: "desc" },
        include: { session: true, exams: { include: { subject: true, results: true }, orderBy: { date: "asc" } } },
      });
      if (series) {
        const exams = series.exams.filter((exam) => marksVisible({ ...exam, series }));
        const marks = exams.flatMap((exam) => exam.results.map((row) => ({
          examId: exam.id,
          studentId: row.studentId,
          marks: row.marks,
          absent: row.absent,
          remarks: row.remarks,
        })));
        const score = studentSeriesScore(dbStudent.id, exams, marks, policy);
        const ranks = policy.showRank ? seriesRanks(dbStudent.class.students, exams, marks, policy) : new Map<string, number>();
        const remark = score.rows.map((row) => row.remarks).filter(Boolean).join(" ") || "";
        const built = buildReportCardResults({
          rows: score.rows.map((row) => ({
            subject: row.subject,
            marks: row.missing ? "—" : row.absent ? "Absent" : row.marks ?? "—",
            maxMarks: row.maxMarks,
            absent: row.absent,
            remarks: row.remarks,
            pct: row.pct,
            grade: row.missing || row.absent ? "—" : undefined,
          })),
          policy,
          attendance: dbStudent.attendance,
          classRank: ranks.get(dbStudent.id),
          className: classParts.className,
          teacherRemark: remark,
        });
        next = mergeReportCardData(next, {
          exam: { name: series.name },
          school: {
            ...((next.school as Record<string, unknown>) || {}),
            sessionTitle: `${series.session.label} · ${series.name}`,
          },
          results: built,
        });
      } else {
        const existing = incomingMarkRows((next.results as Record<string, unknown> | undefined)?.marks);
        if (existing?.length) {
          next = mergeReportCardData(next, {
            results: buildReportCardResults({
              rows: existing,
              policy,
              attendance: dbStudent.attendance,
              className: classParts.className,
            }),
          });
        }
      }
    }
  } catch {
    // Keep supplied issue data if live academic records are unavailable.
  }
  return next;
}

export async function previewDocumentTemplateCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.design", "documents.issue", "school.edit");
  const layout = cleanLayout(input.layout);
  if (!layout.elements.length) throw new Error("Add at least one element before previewing.");
  const pageSize = ["A4", "A5", "LETTER", "CR80", "CUSTOM"].includes(String(input.pageSize || "")) ? String(input.pageSize) : "A4";
  const orientation = String(input.orientation || "").toUpperCase() === "LANDSCAPE" ? "LANDSCAPE" : "PORTRAIT";
  const incoming = input.data && typeof input.data === "object" ? { ...(input.data as Record<string, unknown>) } : {};
  let data: Record<string, unknown> = isReportCardType(String(input.type || ""))
    ? mergeReportCardData(sampleReportCardPreviewData() as Record<string, unknown>, incoming)
    : incoming;
  if (isReportCardType(String(input.type || ""))) {
    const studentId = String(atPath(data, "student.id") || "");
    if (studentId) data = await hydrateIssuedDocumentData(String(input.type || ""), "STUDENT", studentId, data);
  }
  data.document = {
    ...((data.document && typeof data.document === "object") ? data.document : {}),
    type: String(input.type || ""),
    number: "PREVIEW-2026-000001",
    issueDate: new Date().toISOString().slice(0, 10),
    verifyId: "PREVIEW",
  };
  return renderIssuedHtml(layout, data, "https://verify.anekio.example/preview", pageSize, orientation);
}

async function resolveIssuableTemplate(user: AccessUser, templateId: string) {
  const schoolId = schoolIdFor(user);
  const include = { versions: { orderBy: { version: "desc" as const }, take: 1 } };
  if (templateId.startsWith("builtin:")) {
    const type = templateId.slice("builtin:".length);
    const active = await prisma.documentTemplate.findFirst({
      where: { schoolId, type, status: "ACTIVE" },
      include,
    });
    if (active?.versions[0]) return active;
    const builtin = builtInTemplates().find((row) => row.type === type || row.id === templateId);
    if (!builtin) throw new Error("Unknown document type.");
    const created = await prisma.documentTemplate.create({
      data: {
        schoolId,
        type: builtin.type,
        category: builtin.category,
        name: builtin.name,
        description: builtin.description,
        pageSize: builtin.pageSize,
        orientation: builtin.orientation,
        scopeJson: "{}",
        draftJson: JSON.stringify(builtin.layout),
        createdById: user.id,
        updatedById: user.id,
        status: "DRAFT",
      },
    });
    await publishDocumentTemplateCore(user, { id: created.id });
    return prisma.documentTemplate.findUniqueOrThrow({ where: { id: created.id }, include });
  }
  const template = await prisma.documentTemplate.findFirst({ where: { id: templateId, schoolId }, include });
  if (!template || template.status !== "ACTIVE" || !template.versions[0]) {
    throw new Error("Publish an active template before issuing documents.");
  }
  return template;
}

export async function issueDocumentCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.issue", "school.edit");
  const schoolId = schoolIdFor(user);
  const template = await resolveIssuableTemplate(user, String(input.templateId || ""));
  const subjectType = String(input.subjectType || "CUSTOM").slice(0, 40);
  const subjectId = String(input.subjectId || "").slice(0, 120);
  if (!subjectId) throw new Error("Choose who or what this document is for.");
  const now = new Date();
  const year = now.getFullYear();
  const count = await prisma.issuedDocument.count({ where: { schoolId, type: template.type, issuedAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
  const code = template.type.split("_").map((word) => word[0]).join("").slice(0, 4);
  const documentNumber = `${code}-${year}-${String(count + 1).padStart(6, "0")}`;
  const verifyToken = randomBytes(24).toString("base64url");
  const verifyUrl = `${publicOrigin()}/verify/${verifyToken}`;
  const incoming = input.data && typeof input.data === "object" ? { ...(input.data as Record<string, unknown>) } : {};
  const data = await hydrateIssuedDocumentData(template.type, subjectType, subjectId, incoming);
  data.document = { ...((data.document && typeof data.document === "object") ? data.document : {}), type: template.type, number: documentNumber, issueDate: now.toISOString().slice(0, 10), verifyId: verifyToken.slice(0, 10).toUpperCase() };
  const renderedHtml = await renderIssuedHtml(parseDocumentLayout(template.versions[0].layoutJson), data, verifyUrl, template.versions[0].pageSize, template.versions[0].orientation);
  const fileHash = createHash("sha256").update(renderedHtml).digest("hex");
  const issued = await prisma.issuedDocument.create({ data: { schoolId, documentNumber, verifyToken, templateVersionId: template.versions[0].id, type: template.type, subjectType, subjectId, subjectLabel: String(input.subjectLabel || "").slice(0, 200), batchId: String(input.batchId || "").slice(0, 80) || null, supersedesId: String(input.supersedesId || "").slice(0, 120) || null, dataJson: JSON.stringify(data), renderedHtml, fileHash, issuedById: user.id, events: { create: { action: "ISSUED", actorId: user.id, metadataJson: JSON.stringify({ ...(input.batchId ? { batchId: String(input.batchId) } : {}), ...(input.supersedesId ? { supersedesId: String(input.supersedesId) } : {}) }) } } } });
  return { id: issued.id, documentNumber, verifyUrl, documentUrl: `${publicOrigin()}/documents/${verifyToken}` };
}

export async function renderActiveFeeInvoiceTemplateHtml(token: string) {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { shareToken: token },
    include: {
      student: { include: { class: true, parent: { include: { user: true } } } },
      payments: true,
    },
  });
  if (!invoice) return null;
  const template = await prisma.documentTemplate.findFirst({
    where: { schoolId: DEFAULT_DOCUMENT_SCHOOL_ID, type: "FEE_INVOICE", status: "ACTIVE" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!template?.versions[0]) return null;
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const school = schoolFromConfig(config);
  const balance = invoiceBalance(invoice);
  const latestPayment = [...invoice.payments].sort((a, b) => +b.paidAt - +a.paidAt)[0];
  const receiptNumber = balance.paid > 0 ? paymentReceiptNumber(latestPayment?.reference, invoice.id) : "";
  const lines = feeLineTotal(parseFeeLines(invoice.linesJson)).rows.map((row) => ({
    item: row.label,
    amount: formatInr(row.value),
  }));
  const payUrl = `${publicOrigin()}/pay/${encodeURIComponent(token)}`;
  const data = {
    school,
    student: {
      id: invoice.student.id,
      name: invoice.student.name,
      admissionNo: invoice.student.admissionNo,
      classLabel: `${invoice.student.class.name}-${invoice.student.class.section}`,
      parent: invoice.student.parent.user.name,
      parentPhone: invoice.student.parent.phone || invoice.student.parent.user.phone || "",
    },
    guardian: {
      name: invoice.student.parent.user.name,
      phone: invoice.student.parent.phone || invoice.student.parent.user.phone || "",
      email: invoice.student.parent.user.email,
    },
    fees: {
      lines,
      amount: formatInr(invoice.amount),
      paid: formatInr(balance.paid),
      due: formatInr(balance.dueNow),
      status: balance.display === "PAID" ? "Paid" : balance.display === "OVERDUE" ? "Overdue" : balance.display === "PARTIAL" ? "Part paid" : "Unpaid",
      receiptLabel: receiptNumber ? "Receipt No." : "",
      receiptNumber,
      term: invoice.title,
      upiId: school.upiId,
      bankName: school.bankName,
      account: [school.bankAccountName, school.bankAccountNumber, school.bankIfsc].filter(Boolean).join(" · "),
      paymentUrl: payUrl,
    },
    document: {
      type: "FEE_INVOICE",
      number: invoice.id.slice(-8).toUpperCase(),
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: invoice.dueDate.toISOString().slice(0, 10),
      verifyId: token.slice(0, 10).toUpperCase(),
    },
  };
  return renderIssuedHtml(
    parseDocumentLayout(template.versions[0].layoutJson),
    data,
    `${publicOrigin()}/i/${encodeURIComponent(token)}`,
    template.versions[0].pageSize,
    template.versions[0].orientation
  );
}

function paymentReceiptNumber(reference: string | null | undefined, invoiceId: string) {
  const value = String(reference || "").trim();
  const base = value ? value.split(":")[0] || value : "";
  return (base || `RCPT-${invoiceId.slice(-8)}`).toUpperCase();
}

function paymentReceiptBase(reference: string | null | undefined) {
  return String(reference || "").trim().split(":")[0] || "";
}

function receiptTerm(rows: { title: string; period: string }[]) {
  if (!rows.length) return "";
  if (rows.length === 1) return rows[0].title;
  const sorted = [...rows].sort((a, b) => a.period.localeCompare(b.period) || a.title.localeCompare(b.title));
  const parsed = sorted.map((row) => row.title.split(" · ").map((part) => part.trim()));
  const commonSuffix = parsed[0]?.[1] && parsed.every((parts) => parts[1] === parsed[0][1]) ? parsed[0][1] : "";
  if (commonSuffix && parsed.every((parts) => parts[0])) return `${parsed[0][0]} to ${parsed[parsed.length - 1][0]} · ${commonSuffix}`;
  return `${sorted[0].title} to ${sorted[sorted.length - 1].title}`;
}

function paymentMethodLabel(method: unknown) {
  const labels: Record<string, string> = {
    CASH: "Cash",
    UPI: "UPI",
    RAZORPAY: "Razorpay",
    CASHFREE: "Cashfree",
    BILLDESK: "BillDesk",
    BANK: "Bank transfer",
    CHEQUE: "Cheque",
  };
  return labels[String(method || "")] || String(method || "Payment");
}

function paymentNoteParts(notes: unknown) {
  const value = String(notes || "").trim();
  const match = value.match(/^Collected by:\s*([^;]+)(?:;\s*Note:\s*(.+))?$/i);
  if (!match) return { receivedBy: "", note: value };
  return { receivedBy: match[1]?.trim() || "", note: match[2]?.trim() || "" };
}

function paymentReceivedAt(value: Date | string | null | undefined) {
  const date = value ? new Date(value) : new Date();
  return `${date.toISOString().slice(0, 10)} ${date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

export async function renderActivePaymentReceiptTemplateHtml(token: string) {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { shareToken: token },
    include: {
      student: { include: { class: true, parent: { include: { user: true } } } },
      payments: true,
    },
  });
  if (!invoice) return null;
  const paidAmount = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (paidAmount <= 0) return null;
  const template = await prisma.documentTemplate.findFirst({
    where: { schoolId: DEFAULT_DOCUMENT_SCHOOL_ID, type: "PAYMENT_RECEIPT", status: "ACTIVE" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!template?.versions[0]) return null;
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const school = schoolFromConfig(config);
  const latestPayment = [...invoice.payments].sort((a, b) => +b.paidAt - +a.paidAt)[0];
  const receiptNumber = paymentReceiptNumber(latestPayment?.reference, invoice.id);
  const receiptBase = paymentReceiptBase(latestPayment?.reference);
  const noteParts = paymentNoteParts(latestPayment?.notes);
  const manualMethod = latestPayment ? ["CASH", "UPI", "BANK", "CHEQUE"].includes(String(latestPayment.method)) : false;
  const paidInvoices = receiptBase
    ? (await prisma.feeInvoice.findMany({
        where: { studentId: invoice.studentId },
        include: { payments: true },
        orderBy: { dueDate: "asc" },
      }))
        .map((paidInvoice) => ({
          invoice: paidInvoice,
          paid: paidInvoice.payments
            .filter((payment) => paymentReceiptBase(payment.reference) === receiptBase)
            .reduce((sum, payment) => sum + payment.amount, 0),
        }))
        .filter((row) => row.paid > 0)
    : [{ invoice, paid: paidAmount }];
  const receiptRows = paidInvoices.map((row) => ({
    invoice: row.invoice.id.slice(-8).toUpperCase(),
    title: row.invoice.title,
    period: row.invoice.period || row.invoice.id,
    paid: row.paid,
  }));
  const lines = receiptRows.map((row) => ({
    invoiceNumber: row.invoice,
    term: row.title,
    amount: formatInr(row.paid),
  }));
  const totalPaid = paidInvoices.reduce((sum, row) => sum + row.paid, 0);
  const data = {
    school,
    student: {
      id: invoice.student.id,
      name: invoice.student.name,
      admissionNo: invoice.student.admissionNo,
      classLabel: `${invoice.student.class.name}-${invoice.student.class.section}`,
      parent: invoice.student.parent.user.name,
      parentPhone: invoice.student.parent.phone || invoice.student.parent.user.phone || "",
    },
    guardian: {
      name: invoice.student.parent.user.name,
      phone: invoice.student.parent.phone || invoice.student.parent.user.phone || "",
      email: invoice.student.parent.user.email,
    },
    fees: {
      lines,
      amount: formatInr(invoice.amount),
      paid: formatInr(totalPaid),
      due: formatInr(invoiceBalance(invoice).dueNow),
      status: "Paid",
      receiptLabel: "Receipt No.",
      receiptNumber,
      term: receiptTerm(receiptRows) || invoice.title,
      method: paymentMethodLabel(latestPayment?.method),
      reference: receiptBase || latestPayment?.reference || receiptNumber,
      receivedBy: noteParts.receivedBy || (manualMethod ? "School office" : "Payment gateway"),
      receivedAt: paymentReceivedAt(latestPayment?.paidAt),
      receivedNote: noteParts.note,
      upiId: school.upiId,
      bankName: school.bankName,
      account: [school.bankAccountName, school.bankAccountNumber, school.bankIfsc].filter(Boolean).join(" · "),
      paymentUrl: "",
    },
    document: {
      type: "PAYMENT_RECEIPT",
      number: receiptNumber,
      issueDate: (latestPayment?.paidAt || new Date()).toISOString().slice(0, 10),
      dueDate: invoice.dueDate.toISOString().slice(0, 10),
      verifyId: token.slice(0, 10).toUpperCase(),
    },
  };
  return renderIssuedHtml(
    withRequiredOfficialElements("PAYMENT_RECEIPT", parseDocumentLayout(template.versions[0].layoutJson)),
    data,
    `${publicOrigin()}/pay/${encodeURIComponent(token)}?paid=1`,
    template.versions[0].pageSize,
    template.versions[0].orientation
  );
}

type BlockedDocumentStudent = {
  subjectId: string;
  subjectLabel: string;
  error: string;
  pendingMonths?: number;
  paidMonths?: number;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  payUrl?: string;
  noticeSent?: boolean;
};

async function pendingFeeStatusForStudent(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      class: true,
      parent: { include: { user: true } },
      feeInvoices: { include: { payments: true } },
    },
  });
  if (!student) return null;
  const billed = student.feeInvoices.map((invoice) => {
    const dueNow = invoiceBalance(invoice).dueNow;
    return { invoice, dueNow };
  });
  const openInvoices = billed
    .filter((row) => row.dueNow > 0)
    .map((row) => row.invoice)
    .sort((a, b) => +a.dueDate - +b.dueDate || a.title.localeCompare(b.title));
  const paidMonths = paidFeeMonthCount(student.feeInvoices);
  const invoiceIds = openInvoices.map((invoice) => invoice.id);
  let payUrl = "";
  if (invoiceIds.length) {
    try {
      const pay = await buildStudentMonthPayPath(student.id, invoiceIds, { forceOlderPrefix: true });
      payUrl = `${publicOrigin()}${pay.path}`;
    } catch {
      payUrl = "";
    }
  }
  return {
    student,
    pendingMonths: openInvoices.length,
    paidMonths,
    invoiceIds,
    payUrl,
    parentName: student.parent.user.name,
    parentPhone: student.parent.phone || student.parent.user.phone || "",
    parentEmail: student.parent.user.email,
  };
}

async function createBlockedFeeNotice(
  user: AccessUser,
  status: NonNullable<Awaited<ReturnType<typeof pendingFeeStatusForStudent>>>,
  examName: string,
  kind: "ADMIT_CARD" | "REPORT_CARD"
) {
  const title = kind === "REPORT_CARD" ? "Report card held — fees pending" : "Admit card blocked — fees pending";
  const payLine = status.payUrl ? ` Pay here: ${status.payUrl}` : "";
  const body =
    kind === "REPORT_CARD"
      ? `Please clear pending fees for ${status.student.name}. The ${examName} report card is issued only after the required fee months are paid.${payLine}`
      : `Please clear pending fees for ${status.student.name}. We are unable to generate the ${examName} admit card until dues are cleared.${payLine}`;
  const notice = await prisma.notice.create({
    data: {
      title,
      body,
      kind: "FEE",
      priority: "HIGH",
      authorId: user.id,
      studentId: status.student.id,
      audiences: { create: [{ portal: "PARENT" }, { portal: "STUDENT" }] },
      classes: { create: [{ classId: status.student.classId }] },
    },
  });
  void notifyNoticePublished({
    noticeId: notice.id,
    title,
    body,
    portals: ["PARENT", "STUDENT"],
    classIds: [status.student.classId],
    authorId: user.id,
    studentId: status.student.id,
  });
  return notice.id;
}

export async function issueDocumentBatchCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.batch", "documents.issue", "school.edit");
  const rows = Array.isArray(input.subjects) ? input.subjects.slice(0, 200) : [];
  if (!rows.length) throw new Error("Choose at least one record for the batch.");
  const resolved = await resolveIssuableTemplate(user, String(input.templateId || ""));
  const blockIfPendingMonths = Math.max(0, Math.floor(Number(input.blockIfPendingMonths) || 0));
  const requirePaidMonths = Math.max(0, Math.floor(Number(input.requirePaidMonths) || 0));
  const examName = resolved.name || "exam";
  const batchId = `batch_${randomBytes(12).toString("hex")}`;
  const issued: Awaited<ReturnType<typeof issueDocumentCore>>[] = [];
  const blocked: BlockedDocumentStudent[] = [];
  for (const raw of rows) {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    try {
      const isStudent = String(row.subjectType || input.subjectType || "") === "STUDENT";
      if (isStudent && (blockIfPendingMonths > 0 || requirePaidMonths > 0)) {
        const feeStatus = await pendingFeeStatusForStudent(String(row.subjectId || ""));
        const pendingMonths = feeStatus?.pendingMonths || 0;
        const paidMonths = feeStatus?.paidMonths || 0;
        const unpaidBlock = Boolean(blockIfPendingMonths > 0 && pendingMonths >= blockIfPendingMonths);
        const unpaidRequired = Boolean(requirePaidMonths > 0 && paidMonths < requirePaidMonths);
        if (unpaidBlock || unpaidRequired) {
          let noticeSent = false;
          if (feeStatus && (resolved.type === "ADMIT_CARD" || isReportCardType(resolved.type))) {
            try {
              await createBlockedFeeNotice(
                user,
                feeStatus,
                examName,
                resolved.type === "ADMIT_CARD" ? "ADMIT_CARD" : "REPORT_CARD"
              );
              noticeSent = true;
            } catch {
              noticeSent = false;
            }
          }
          blocked.push({
            subjectId: String(row.subjectId || ""),
            subjectLabel: String(row.subjectLabel || feeStatus?.student.name || "Student"),
            error: requirePaidMonths > 0
              ? `${String(row.subjectLabel || feeStatus?.student.name || "Student")} has paid ${paidMonths} fee month${paidMonths === 1 ? "" : "s"} (need ${requirePaidMonths}).`
              : `${String(row.subjectLabel || feeStatus?.student.name || "Student")} has ${pendingMonths} pending fee month${pendingMonths === 1 ? "" : "s"}.`,
            pendingMonths,
            paidMonths,
            parentName: feeStatus?.parentName,
            parentPhone: feeStatus?.parentPhone,
            parentEmail: feeStatus?.parentEmail,
            payUrl: feeStatus?.payUrl,
            noticeSent,
          });
          continue;
        }
      }
      issued.push(await issueDocumentCore(user, {
        templateId: resolved.id,
        subjectType: row.subjectType || input.subjectType || "STUDENT",
        subjectId: row.subjectId,
        subjectLabel: row.subjectLabel,
        data: row.data,
        batchId,
      }));
    } catch (error) {
      blocked.push({ subjectId: String(row.subjectId || ""), subjectLabel: String(row.subjectLabel || "Student"), error: error instanceof Error ? error.message : "Could not issue document." });
    }
  }
  if (!issued.length && blocked.length) return { batchId, issued, blocked, combinedUrl: "" };
  if (!issued.length) throw new Error("No documents could be issued.");
  return { batchId, issued, blocked, combinedUrl: `${publicOrigin()}/document-batches/${batchId}` };
}

export async function findBatchDocuments(batchId: string) {
  return prisma.issuedDocument.findMany({ where: { batchId }, orderBy: { issuedAt: "asc" } });
}

export function batchDocumentsHtml(rows: Awaited<ReturnType<typeof findBatchDocuments>>) {
  const pages = rows.flatMap((row) => {
    const match = row.renderedHtml.match(/<main class="page">([\s\S]*?)<\/main>/i);
    return match ? [match[1]] : [];
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Document batch</title><style>body{margin:0;background:#eef2f7;font-family:Arial,sans-serif}.toolbar{position:sticky;top:0;z-index:2;padding:12px;text-align:center;background:white;border-bottom:1px solid #d9e2ec}.page{position:relative;width:210mm;height:297mm;margin:18px auto;background:white;box-shadow:0 2px 18px #102a4322;overflow:hidden;break-after:page}@media print{body{background:white}.toolbar{display:none}.page{margin:0;box-shadow:none}}</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save combined PDF</button> · ${rows.length} documents</div>${pages.map((page) => `<main class="page">${page}</main>`).join("")}</body></html>`;
}

export async function resolveStudentIdCardScanCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "attendance.mark");
  const schoolId = schoolIdFor(user);
  const raw = String(input.code || "").trim();
  const token = raw.match(/\/verify\/([^/?#]+)/)?.[1] || raw.match(/\/documents\/([^/?#]+)/)?.[1] || "";
  if (!token) throw new Error("Scan a Student ID card QR.");
  const row = await prisma.issuedDocument.findUnique({ where: { verifyToken: token } });
  if (!row || row.schoolId !== schoolId || row.type !== "STUDENT_ID" || row.subjectType !== "STUDENT" || row.status !== "VALID") {
    throw new Error("This is not a valid Student ID card.");
  }
  return { studentId: row.subjectId, documentNumber: row.documentNumber };
}

export async function changeIssuedDocumentStatusCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.revoke", "school.edit");
  const schoolId = schoolIdFor(user);
  const id = String(input.id || "");
  const status = String(input.status || "").toUpperCase();
  if (!['VALID', 'REVOKED', 'SUPERSEDED', 'EXPIRED'].includes(status)) throw new Error("Choose a valid document status.");
  const reason = String(input.reason || "").trim().slice(0, 500);
  if (status !== "VALID" && !reason) throw new Error("Give a reason for this status change.");
  const row = await prisma.issuedDocument.findFirst({ where: { id, schoolId } });
  if (!row) throw new Error("Issued document not found.");
  await prisma.$transaction([
    prisma.issuedDocument.update({ where: { id }, data: { status, statusReason: reason } }),
    prisma.documentEvent.create({ data: { issuedDocumentId: id, action: status, actorId: user.id, reason } }),
  ]);
}

export async function reissueDocumentCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.issue", "school.edit");
  const schoolId = schoolIdFor(user);
  const id = String(input.id || "");
  const reason = String(input.reason || "").trim().slice(0, 500);
  if (!reason) throw new Error("Give a reason for reissuing this document.");
  const previous = await prisma.issuedDocument.findFirst({ where: { id, schoolId }, include: { templateVersion: true } });
  if (!previous) throw new Error("Issued document not found.");
  if (previous.status !== "VALID") throw new Error("Only a valid document can be reissued.");
  const next = await issueDocumentCore(user, {
    templateId: previous.templateVersion.templateId,
    subjectType: previous.subjectType,
    subjectId: previous.subjectId,
    subjectLabel: previous.subjectLabel,
    data: safeObject(previous.dataJson),
    supersedesId: previous.id,
  });
  await prisma.$transaction([
    prisma.issuedDocument.update({ where: { id: previous.id }, data: { status: "SUPERSEDED", statusReason: reason } }),
    prisma.documentEvent.create({ data: { issuedDocumentId: previous.id, action: "SUPERSEDED", actorId: user.id, reason, metadataJson: JSON.stringify({ replacementId: next.id }) } }),
    prisma.documentEvent.create({ data: { issuedDocumentId: next.id, action: "REISSUED", actorId: user.id, reason, metadataJson: JSON.stringify({ previousId: previous.id }) } }),
  ]);
  return next;
}

export async function findIssuedDocument(token: string) {
  return prisma.issuedDocument.findUnique({ where: { verifyToken: token }, include: { templateVersion: { include: { template: true } } } });
}

export function verificationHtml(row: NonNullable<Awaited<ReturnType<typeof findIssuedDocument>>>) {
  const statusTone = row.status === "VALID" ? "#15803d" : row.status === "REVOKED" ? "#b91c1c" : "#92400e";
  const masked = row.subjectLabel ? `${row.subjectLabel.slice(0, 2)}${"•".repeat(Math.min(8, Math.max(2, row.subjectLabel.length - 2)))}` : "Protected";
  const snapshot = safeObject(row.dataJson);
  const school = snapshot.school && typeof snapshot.school === "object" ? snapshot.school as Record<string, unknown> : {};
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Verify ${escapeHtml(row.documentNumber)}</title><style>body{margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#102a43}.card{max-width:560px;margin:8vh auto;background:white;padding:28px;border:1px solid #d9e2ec;border-radius:14px}.status{display:inline-block;background:${statusTone}18;color:${statusTone};padding:8px 12px;border-radius:999px;font-weight:700}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:24px}.label{font-size:11px;text-transform:uppercase;color:#52667d}.value{margin-top:4px;font-weight:600}.note{margin-top:24px;padding-top:18px;border-top:1px solid #e6edf5;font-size:13px;line-height:1.5;color:#52667d}@media(max-width:600px){.card{margin:0;min-height:100vh;border:0;border-radius:0}.grid{grid-template-columns:1fr}}</style></head><body><main class="card"><div class="status">${escapeHtml(row.status)}</div><h1>${escapeHtml(row.templateVersion.template.name)}</h1><p>Issued by <strong>${escapeHtml(school.name || "the school")}</strong> through Anekio.</p><div class="grid"><div><div class="label">Document number</div><div class="value">${escapeHtml(row.documentNumber)}</div></div><div><div class="label">Issued</div><div class="value">${escapeHtml(row.issuedAt.toLocaleDateString("en-IN"))}</div></div><div><div class="label">Document type</div><div class="value">${escapeHtml(DOCUMENT_TYPES.find((item) => item.id === row.type)?.label || row.type)}</div></div><div><div class="label">Holder</div><div class="value">${escapeHtml(masked)}</div></div></div>${row.statusReason ? `<p class="note"><strong>Status note:</strong> ${escapeHtml(row.statusReason)}</p>` : ""}<p class="note">Compare these details with the printed document. Verification confirms that the school issued this record and its current status; it does not independently certify the school’s underlying data.</p></main></body></html>`;
}
