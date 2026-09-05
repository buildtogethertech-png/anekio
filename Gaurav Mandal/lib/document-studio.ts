import { createHash, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { toBuffer as barcodeBuffer } from "bwip-js/node";
import type { AccessUser } from "./permissions";
import { can } from "./permissions";
import { prisma } from "./prisma";
import { publicOrigin } from "./utils";
import { invoiceBalance } from "./fees";
import { buildStudentMonthPayPath } from "./pay";
import { notifyNoticePublished } from "./push";

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
  { group: "School", id: "school.logoPath", label: "School logo" },
  { group: "School", id: "school.signPath", label: "Principal signature" },
  { group: "School", id: "school.stampPath", label: "School stamp" },
  { group: "Student", id: "student.name", label: "Student name" },
  { group: "Student", id: "student.admissionNo", label: "Admission number" },
  { group: "Student", id: "student.classLabel", label: "Class and section" },
  { group: "Student", id: "student.rollNo", label: "Roll number" },
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
  { group: "Results", id: "results.attendance", label: "Attendance" },
  { group: "Fees", id: "fees.lines", label: "Fee line items" },
  { group: "Fees", id: "fees.amount", label: "Amount" },
  { group: "Fees", id: "fees.paid", label: "Amount paid" },
  { group: "Document", id: "document.number", label: "Document number" },
  { group: "Document", id: "document.issueDate", label: "Issue date" },
  { group: "Document", id: "document.verifyId", label: "Verify ID" },
];

function element(id: string, type: DocumentElementType, x: number, y: number, width: number, height: number, extra: Partial<DocumentElement> = {}): DocumentElement {
  return { id, type, x, y, width, height, fontSize: 14, color: "#102a43", ...extra };
}

export function defaultLayout(type: string): DocumentLayout {
  const meta = DOCUMENT_TYPES.find((row) => row.id === type);
  const isCard = type === "STUDENT_ID" || type === "EMPLOYEE_ID" || type.endsWith("_CARD") || type.endsWith("_PASS");
  if (type === "STUDENT_ID") {
    return {
      elements: [
        element("card-bg", "SHAPE", 0, 0, 100, 100, { background: "#f8fbff", locked: true }),
        element("top-band", "SHAPE", 0, 0, 100, 24, { background: "#1d4ed8", locked: true }),
        element("left-accent", "SHAPE", 0, 0, 4, 100, { background: "#f59e0b", locked: true }),
        element("bottom-band", "SHAPE", 0, 87, 100, 13, { background: "#e0f2fe", locked: true }),
        element("card-border", "SHAPE", 2, 4, 96, 92, { borderColor: "#1d4ed8", locked: true }),
        element("school-logo", "IMAGE", 7, 5, 11, 14, { field: "school.logoPath", label: "Logo", locked: true }),
        element("school-name", "FIELD", 20, 5, 60, 7, { field: "school.name", label: "School name", fontSize: 13, fontWeight: "bold", align: "center", color: "#ffffff", locked: true }),
        element("school-address", "FIELD", 20, 13, 60, 4, { field: "school.address", label: "School address", fontSize: 5, align: "center", color: "#dbeafe" }),
        element("card-kind", "TEXT", 81, 6, 12, 7, { value: "ID", fontSize: 14, fontWeight: "bold", align: "center", color: "#ffffff" }),
        element("title", "TEXT", 37, 25, 29, 5, { value: "STUDENT ID CARD", fontSize: 7, fontWeight: "bold", align: "center", color: "#1d4ed8", background: "#dbeafe" }),
        element("photo", "PHOTO", 8, 33, 22, 34, { field: "student.photo", label: "Photo", borderColor: "#1d4ed8" }),
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
        element("document-number", "FIELD", 8, 78, 43, 5, { field: "document.number", label: "Card number", fontSize: 6, fontWeight: "bold", color: "#1d4ed8" }),
        element("signature", "SIGNATURE", 55, 72, 20, 9, { label: "Signature" }),
        element("signature-label", "TEXT", 53, 82, 24, 3, { value: "Authorised signature", fontSize: 5, align: "center", color: "#64748b" }),
        element("verify", "VERIFY_QR", 80, 62, 14, 21, { label: "Attendance QR", locked: true }),
        element("qr-label", "TEXT", 77, 84, 20, 4, { value: "Scan for attendance", fontSize: 5, align: "center", fontWeight: "bold", color: "#1d4ed8" }),
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
        element("page-bg", "SHAPE", 0, 0, 100, 100, { background: "#f8fbff", locked: true }),
        element("paper", "SHAPE", 4, 3, 92, 94, { background: "#ffffff", borderColor: "#cbd5e1", locked: true }),
        element("top-band", "SHAPE", 4, 3, 92, 12, { background: "#0f766e", locked: true }),
        element("accent", "SHAPE", 4, 3, 1.2, 94, { background: "#f59e0b", locked: true }),
        element("logo", "IMAGE", 7, 5, 8, 8, { field: "school.logoPath", label: "Logo" }),
        element("school-name", "FIELD", 17, 5, 48, 4.6, { field: "school.name", label: "School name", fontSize: 21, fontWeight: "bold", color: "#ffffff", locked: true }),
        element("school-address", "FIELD", 17, 10, 48, 2.2, { field: "school.address", label: "Address", fontSize: 8, color: "#ccfbf1" }),
        element("doc-label", "TEXT", 72, 6, 18, 2, { value: "ADMISSION RECORD", fontSize: 8, fontWeight: "bold", align: "right", color: "#ffffff" }),
        element("document-number", "FIELD", 68, 10, 22, 2.2, { field: "document.number", label: "Document number", fontSize: 8, fontWeight: "bold", align: "right", color: "#ffffff" }),
        element("title-bg", "SHAPE", 32, 18, 36, 5.5, { background: "#dbeafe", locked: true }),
        element("title", "TEXT", 33, 19.2, 34, 3, { value: "STUDENT ADMISSION FORM", fontSize: 15, fontWeight: "bold", align: "center", color: "#1d4ed8" }),
        element("session-label", "TEXT", 10, 27, 12, 2, { value: "SESSION", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("session-box", "TEXT", 22, 26.2, 18, 3.8, { value: "2026–27", fontSize: 10, fontWeight: "bold", align: "center", borderColor: "#cbd5e1" }),
        element("class-label", "TEXT", 47, 27, 17, 2, { value: "CLASS APPLIED", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("class", "FIELD", 64, 26.2, 14, 3.8, { field: "student.classLabel", label: "Class", fontSize: 10, fontWeight: "bold", align: "center", borderColor: "#cbd5e1" }),
        element("date-label", "TEXT", 80, 27, 8, 2, { value: "DATE", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("date", "FIELD", 87, 26.2, 6, 3.8, { field: "document.issueDate", label: "Date", fontSize: 7, align: "center", borderColor: "#cbd5e1" }),
        element("student-card", "SHAPE", 8, 33, 84, 22, { background: "#ffffff", borderColor: "#d9e2ec", locked: true }),
        element("section-1", "TEXT", 10, 35, 30, 2, { value: "Student details", fontSize: 10, fontWeight: "bold", color: "#0f766e" }),
        element("photo", "PHOTO", 10, 39, 16, 13, { field: "student.photo", label: "Photo", borderColor: "#94a3b8" }),
        element("name-label", "TEXT", 30, 39, 20, 2, { value: "STUDENT NAME", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("student-name", "FIELD", 30, 41.5, 36, 3, { field: "student.name", label: "Student name", fontSize: 15, fontWeight: "bold", color: "#0f172a" }),
        element("admission-label", "TEXT", 30, 47.5, 18, 2, { value: "ADMISSION NO", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("admission", "FIELD", 48, 47.2, 18, 2.5, { field: "student.admissionNo", label: "Admission number", fontSize: 9, fontWeight: "bold" }),
        element("dob-label", "TEXT", 69, 47.5, 8, 2, { value: "DOB", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("dob", "FIELD", 77, 47.2, 13, 2.5, { field: "student.born", label: "Date of birth", fontSize: 9, fontWeight: "bold" }),
        element("guardian-card", "SHAPE", 8, 58, 84, 14, { background: "#f8fafc", borderColor: "#d9e2ec", locked: true }),
        element("section-2", "TEXT", 10, 60, 35, 2, { value: "Parent / guardian information", fontSize: 10, fontWeight: "bold", color: "#0f766e" }),
        element("guardian-label", "TEXT", 10, 65, 14, 2, { value: "GUARDIAN", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("guardian", "FIELD", 24, 64.8, 24, 2.4, { field: "student.parent", label: "Guardian", fontSize: 9, fontWeight: "bold" }),
        element("phone-label", "TEXT", 52, 65, 10, 2, { value: "PHONE", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("phone", "FIELD", 62, 64.8, 26, 2.4, { field: "student.parentPhone", label: "Phone", fontSize: 9, fontWeight: "bold" }),
        element("checklist-title", "TEXT", 8, 76, 30, 2, { value: "Admission checklist", fontSize: 10, fontWeight: "bold", color: "#1d4ed8" }),
        element("checklist", "TEXT", 8, 79, 48, 7, { value: "☐ Birth certificate  ☐ Previous report card  ☐ Aadhaar / ID proof\n☐ Transfer certificate  ☐ Photos  ☐ Fee receipt", fontSize: 8, color: "#334155" }),
        element("declare-title", "TEXT", 8, 89, 18, 2, { value: "Declaration", fontSize: 8, fontWeight: "bold", color: "#0f766e" }),
        element("declare", "TEXT", 8, 91.5, 45, 3.5, { value: "I confirm that the above details are correct as per school records.", fontSize: 7, color: "#334155" }),
        element("verify", "VERIFY_QR", 60, 77, 10, 10, { label: "Verification QR", locked: true }),
        element("stamp", "STAMP", 72, 76, 10, 10, { field: "school.stampPath", label: "Stamp" }),
        element("signature", "SIGNATURE", 78, 86, 12, 5, { field: "school.signPath", label: "Principal signature" }),
        element("signature-label", "TEXT", 72, 92, 20, 2, { value: "Authorised signatory", fontSize: 7, align: "center", color: "#64748b" }),
      ],
    };
  }
  const tableField = type === "REPORT_CARD" || type.includes("MARK") || type.includes("RESULT") || type.includes("PROGRESS")
    ? "results.marks"
    : type.includes("FEE") || type.includes("RECEIPT") || type.includes("CHALLAN")
      ? "fees.lines"
      : type === "ADMIT_CARD" || type === "EXAM_DATE_SHEET"
        ? "exam.schedule"
        : "";
  const elements: DocumentElement[] = [
    element("page-bg", "SHAPE", 0, 0, 100, 100, { background: "#f8fbff", locked: true }),
    element("paper", "SHAPE", 4, 3, 92, 94, { background: "#ffffff", borderColor: "#cbd5e1", locked: true }),
    element("top-band", "SHAPE", 4, 3, 92, 10, { background: "#1d4ed8", locked: true }),
    element("accent", "SHAPE", 4, 3, 1.2, 94, { background: "#f59e0b", locked: true }),
    element("school-logo", "IMAGE", 7, 5, 7, 6, { field: "school.logoPath", label: "Logo" }),
    element("school-name", "FIELD", 16, 5, 52, 3.6, { field: "school.name", label: "School name", fontSize: isCard ? 12 : 20, fontWeight: "bold", align: "center", color: "#ffffff", locked: true }),
    element("school-address", "FIELD", 16, 9.2, 52, 1.8, { field: "school.address", label: "School address", fontSize: isCard ? 6 : 8, align: "center", color: "#dbeafe" }),
    element("document-number", "FIELD", 72, 7, 18, 2.5, { field: "document.number", label: "Document number", fontSize: 7, fontWeight: "bold", align: "right", color: "#ffffff" }),
    element("title-bg", "SHAPE", 24, isCard ? 18 : 17, 52, 5.5, { background: "#dbeafe", locked: true }),
    element("title", "TEXT", 25, isCard ? 19.3 : 18.3, 50, 2.8, { value: meta?.label || "School document", fontSize: isCard ? 11 : 14, fontWeight: "bold", align: "center", color: "#1d4ed8" }),
    element("info-card", "SHAPE", 8, isCard ? 30 : 28, 84, isCard ? 36 : 24, { background: "#ffffff", borderColor: "#d9e2ec", locked: true }),
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
    elements.push(element("table-title", "TEXT", 8, 57, 28, 2.2, { value: tableField === "fees.lines" ? "FEE DETAILS" : tableField === "results.marks" ? "ACADEMIC DETAILS" : "DETAILS", fontSize: 8, fontWeight: "bold", color: "#1d4ed8" }));
    elements.push(element("data-table", "TABLE", 8, 60, 84, 17, { field: tableField, label: DOCUMENT_FIELDS.find((f) => f.id === tableField)?.label, fontSize: 8 }));
  } else if (!isCard) {
    elements.push(element("body", "TEXT", 10, 58, 80, 15, { value: "This document certifies that the information recorded above is maintained in the official school records.", fontSize: 11, align: "left", color: "#334155" }));
  }
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
    updatedAt: null,
    layout: defaultLayout(type.id),
  }));
}

export async function documentStudioBundle() {
  const [templates, issued] = await Promise.all([
    prisma.documentTemplate.findMany({ include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } }),
    prisma.issuedDocument.findMany({ include: { templateVersion: { include: { template: true } } }, orderBy: { issuedAt: "desc" }, take: 100 }),
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
      updatedAt: row.updatedAt.toISOString(),
      layout: parseDocumentLayout(row.draftJson),
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
      height: bounded(value.height, 6, 1, 100),
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
  const type = String(input.type || "");
  const meta = DOCUMENT_TYPES.find((row) => row.id === type);
  if (!meta) throw new Error("Choose a supported document type.");
  const name = String(input.name || meta.label).trim().slice(0, 100);
  if (!name) throw new Error("Template name is required.");
  const layout = cleanLayout(input.layout);
  if (!layout.elements.length) throw new Error("Add at least one element to the template.");
  const data = {
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
    if (!existing) throw new Error("Template not found.");
    return prisma.documentTemplate.update({ where: { id }, data: { ...data, status: existing.status === "ARCHIVED" ? "DRAFT" : existing.status } });
  }
  return prisma.documentTemplate.create({ data: { ...data, createdById: user.id, status: "DRAFT" } });
}

export async function publishDocumentTemplateCore(user: AccessUser, input: { id?: string }) {
  need(user, "documents.publish", "school.edit");
  const id = String(input.id || "");
  const row = await prisma.documentTemplate.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!row) throw new Error("Template not found.");
  const layout = parseDocumentLayout(row.draftJson);
  if (!layout.elements.length) throw new Error("Template is empty.");
  if (!layout.elements.some((item) => item.type === "VERIFY_QR")) throw new Error("Add a Verification QR before publishing this official template.");
  const version = (row.versions[0]?.version || 0) + 1;
  await prisma.$transaction([
    prisma.documentTemplate.updateMany({
      where: { type: row.type, status: "ACTIVE", id: { not: row.id } },
      data: { status: "PUBLISHED", updatedById: user.id },
    }),
    prisma.documentTemplateVersion.create({ data: { templateId: row.id, version, layoutJson: row.draftJson, pageSize: row.pageSize, orientation: row.orientation, scopeJson: row.scopeJson, publishedById: user.id } }),
    prisma.documentTemplate.update({ where: { id: row.id }, data: { status: "ACTIVE", activeVersion: version, updatedById: user.id } }),
  ]);
  return { id: row.id, version };
}

export async function archiveDocumentTemplateCore(user: AccessUser, input: { id?: string }) {
  need(user, "documents.publish", "school.edit");
  const id = String(input.id || "");
  const row = await prisma.documentTemplate.findUnique({ where: { id } });
  if (!row) throw new Error("Template not found.");
  await prisma.documentTemplate.update({ where: { id }, data: { status: "ARCHIVED", updatedById: user.id } });
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function atPath(data: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, data);
}

function assetSrc(value: unknown) {
  const path = String(value || "");
  if (!path) return "";
  return /^https?:\/\//i.test(path) ? path : `${publicOrigin()}/api/files/${path.replace(/^\/+/, "")}`;
}

function tableHtml(value: unknown, label: string) {
  if (!Array.isArray(value) || !value.length) return `<div class="empty-table">${escapeHtml(label)}</div>`;
  const rows = value.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  if (!rows.length) return `<div class="empty-table">${escapeHtml(label)}</div>`;
  const keys = Object.keys(rows[0]).slice(0, 8);
  return `<table><thead><tr>${keys.map((key) => `<th>${escapeHtml(key.replace(/([A-Z])/g, " $1"))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${keys.map((key) => `<td>${escapeHtml(row[key])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
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
        : String(item.value || "");
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
      return src ? `<img alt="${escapeHtml(item.label || item.type)}" src="${escapeHtml(src)}" style="${base}object-fit:contain">` : `<div style="${base}border:1px dashed #bcccdc;display:flex;align-items:center;justify-content:center">${escapeHtml(item.label || item.type)}</div>`;
    }
    if (item.type === "TABLE") return `<div style="${base}">${tableHtml(atPath(data, item.field || ""), item.label || "Table")}</div>`;
    if (item.type === "LINE") return `<div style="${base}height:1px;background:${item.borderColor || item.color || "#102a43"}"></div>`;
    if (item.type === "SHAPE") return `<div style="${base}${item.background ? `background:${item.background};` : ""}${item.borderColor ? `border:1px solid ${item.borderColor};` : ""}"></div>`;
    const value = item.type === "FIELD" ? atPath(data, item.field || "") : item.value || item.label || "";
    return `<div style="${base}${item.background ? `background:${item.background};` : ""}${item.borderColor ? `border:1px solid ${item.borderColor};` : ""}">${escapeHtml(value)}</div>`;
  }))).join("");
  const previewScale = pageSize === "CR80" ? 3.2 : 1;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(atPath(data, "document.number"))}</title><style>@page{size:${pageWidth}mm ${pageHeight}mm;margin:0}body{margin:0;background:#eef2f7;font-family:Arial,sans-serif;color:#102a43}.toolbar{position:sticky;top:0;z-index:2;padding:12px;text-align:center;background:#eef2f7}.page-wrap{display:flex;justify-content:center;padding:24px}.page{position:relative;width:${pageWidth}mm;height:${pageHeight}mm;background:white;box-shadow:0 2px 18px #102a4322;transform:scale(${previewScale});transform-origin:top center;margin-bottom:${pageSize === "CR80" ? "260px" : "24px"}}table{width:100%;border-collapse:collapse;font-size:inherit}th,td{border:1px solid #bcccdc;padding:4px;text-align:left}.empty-table{border:1px solid #bcccdc;padding:6px}@media print{body{background:white}.toolbar{display:none}.page-wrap{display:block;padding:0}.page{margin:0;box-shadow:none;transform:none}}</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save PDF</button></div><div class="page-wrap"><main class="page">${content}</main></div></body></html>`;
}

export async function previewDocumentTemplateCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.design", "documents.issue", "school.edit");
  const layout = cleanLayout(input.layout);
  if (!layout.elements.length) throw new Error("Add at least one element before previewing.");
  const pageSize = ["A4", "A5", "LETTER", "CR80", "CUSTOM"].includes(String(input.pageSize || "")) ? String(input.pageSize) : "A4";
  const orientation = String(input.orientation || "").toUpperCase() === "LANDSCAPE" ? "LANDSCAPE" : "PORTRAIT";
  const data = input.data && typeof input.data === "object" ? { ...(input.data as Record<string, unknown>) } : {};
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
  const include = { versions: { orderBy: { version: "desc" as const }, take: 1 } };
  if (templateId.startsWith("builtin:")) {
    const type = templateId.slice("builtin:".length);
    const active = await prisma.documentTemplate.findFirst({
      where: { type, status: "ACTIVE" },
      include,
    });
    if (active?.versions[0]) return active;
    const builtin = builtInTemplates().find((row) => row.type === type || row.id === templateId);
    if (!builtin) throw new Error("Unknown document type.");
    const created = await prisma.documentTemplate.create({
      data: {
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
  const template = await prisma.documentTemplate.findUnique({ where: { id: templateId }, include });
  if (!template || template.status !== "ACTIVE" || !template.versions[0]) {
    throw new Error("Publish an active template before issuing documents.");
  }
  return template;
}

export async function issueDocumentCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.issue", "school.edit");
  const template = await resolveIssuableTemplate(user, String(input.templateId || ""));
  const subjectType = String(input.subjectType || "CUSTOM").slice(0, 40);
  const subjectId = String(input.subjectId || "").slice(0, 120);
  if (!subjectId) throw new Error("Choose who or what this document is for.");
  const now = new Date();
  const year = now.getFullYear();
  const count = await prisma.issuedDocument.count({ where: { type: template.type, issuedAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
  const code = template.type.split("_").map((word) => word[0]).join("").slice(0, 4);
  const documentNumber = `${code}-${year}-${String(count + 1).padStart(6, "0")}`;
  const verifyToken = randomBytes(24).toString("base64url");
  const verifyUrl = `${publicOrigin()}/verify/${verifyToken}`;
  const data = input.data && typeof input.data === "object" ? { ...(input.data as Record<string, unknown>) } : {};
  data.document = { ...((data.document && typeof data.document === "object") ? data.document : {}), type: template.type, number: documentNumber, issueDate: now.toISOString().slice(0, 10), verifyId: verifyToken.slice(0, 10).toUpperCase() };
  const renderedHtml = await renderIssuedHtml(parseDocumentLayout(template.versions[0].layoutJson), data, verifyUrl, template.versions[0].pageSize, template.versions[0].orientation);
  const fileHash = createHash("sha256").update(renderedHtml).digest("hex");
  const issued = await prisma.issuedDocument.create({ data: { documentNumber, verifyToken, templateVersionId: template.versions[0].id, type: template.type, subjectType, subjectId, subjectLabel: String(input.subjectLabel || "").slice(0, 200), batchId: String(input.batchId || "").slice(0, 80) || null, supersedesId: String(input.supersedesId || "").slice(0, 120) || null, dataJson: JSON.stringify(data), renderedHtml, fileHash, issuedById: user.id, events: { create: { action: "ISSUED", actorId: user.id, metadataJson: JSON.stringify({ ...(input.batchId ? { batchId: String(input.batchId) } : {}), ...(input.supersedesId ? { supersedesId: String(input.supersedesId) } : {}) }) } } } });
  return { id: issued.id, documentNumber, verifyUrl, documentUrl: `${publicOrigin()}/documents/${verifyToken}` };
}

type BlockedDocumentStudent = {
  subjectId: string;
  subjectLabel: string;
  error: string;
  pendingMonths?: number;
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
      feeInvoices: { where: { status: { not: "PAID" } }, include: { payments: true } },
    },
  });
  if (!student) return null;
  const openInvoices = student.feeInvoices.filter((invoice) => {
    const paid = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
    return invoiceBalance({ ...invoice, paid }).dueNow > 0;
  }).sort((a, b) => +a.dueDate - +b.dueDate || a.title.localeCompare(b.title));
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
    invoiceIds,
    payUrl,
    parentName: student.parent.user.name,
    parentPhone: student.parent.phone || student.parent.user.phone || "",
    parentEmail: student.parent.user.email,
  };
}

async function createBlockedAdmitCardNotice(user: AccessUser, status: NonNullable<Awaited<ReturnType<typeof pendingFeeStatusForStudent>>>, examName: string) {
  const title = "Admit card blocked — fees pending";
  const payLine = status.payUrl ? ` Pay here: ${status.payUrl}` : "";
  const body = `Please clear pending fees for ${status.student.name}. We are unable to generate the ${examName} admit card until dues are cleared.${payLine}`;
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
  const blockIfPendingMonths = Math.max(0, Math.floor(Number(input.blockIfPendingMonths) || 0));
  const template = await prisma.documentTemplate.findUnique({ where: { id: String(input.templateId || "") }, select: { type: true, name: true } });
  const examName = String(template?.name || "exam");
  const batchId = `batch_${randomBytes(12).toString("hex")}`;
  const issued: Awaited<ReturnType<typeof issueDocumentCore>>[] = [];
  const blocked: BlockedDocumentStudent[] = [];
  for (const raw of rows) {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    try {
      if (blockIfPendingMonths > 0 && String(row.subjectType || input.subjectType || "") === "STUDENT") {
        const feeStatus = await pendingFeeStatusForStudent(String(row.subjectId || ""));
        const pendingMonths = feeStatus?.pendingMonths || 0;
        if (feeStatus && pendingMonths >= blockIfPendingMonths) {
          let noticeSent = false;
          if (template?.type === "ADMIT_CARD") {
            try {
              await createBlockedAdmitCardNotice(user, feeStatus, examName);
              noticeSent = true;
            } catch {
              noticeSent = false;
            }
          }
          blocked.push({
            subjectId: String(row.subjectId || ""),
            subjectLabel: String(row.subjectLabel || feeStatus.student.name || "Student"),
            error: `${String(row.subjectLabel || feeStatus.student.name || "Student")} has ${pendingMonths} pending fee month${pendingMonths === 1 ? "" : "s"}.`,
            pendingMonths,
            parentName: feeStatus.parentName,
            parentPhone: feeStatus.parentPhone,
            parentEmail: feeStatus.parentEmail,
            payUrl: feeStatus.payUrl,
            noticeSent,
          });
          continue;
        }
      }
      issued.push(await issueDocumentCore(user, {
        templateId: input.templateId,
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
  const raw = String(input.code || "").trim();
  const token = raw.match(/\/verify\/([^/?#]+)/)?.[1] || raw.match(/\/documents\/([^/?#]+)/)?.[1] || "";
  if (!token) throw new Error("Scan a Student ID card QR.");
  const row = await prisma.issuedDocument.findUnique({ where: { verifyToken: token } });
  if (!row || row.type !== "STUDENT_ID" || row.subjectType !== "STUDENT" || row.status !== "VALID") {
    throw new Error("This is not a valid Student ID card.");
  }
  return { studentId: row.subjectId, documentNumber: row.documentNumber };
}

export async function changeIssuedDocumentStatusCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.revoke", "school.edit");
  const id = String(input.id || "");
  const status = String(input.status || "").toUpperCase();
  if (!['VALID', 'REVOKED', 'SUPERSEDED', 'EXPIRED'].includes(status)) throw new Error("Choose a valid document status.");
  const reason = String(input.reason || "").trim().slice(0, 500);
  if (status !== "VALID" && !reason) throw new Error("Give a reason for this status change.");
  const row = await prisma.issuedDocument.findUnique({ where: { id } });
  if (!row) throw new Error("Issued document not found.");
  await prisma.$transaction([
    prisma.issuedDocument.update({ where: { id }, data: { status, statusReason: reason } }),
    prisma.documentEvent.create({ data: { issuedDocumentId: id, action: status, actorId: user.id, reason } }),
  ]);
}

export async function reissueDocumentCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.issue", "school.edit");
  const id = String(input.id || "");
  const reason = String(input.reason || "").trim().slice(0, 500);
  if (!reason) throw new Error("Give a reason for reissuing this document.");
  const previous = await prisma.issuedDocument.findUnique({ where: { id }, include: { templateVersion: true } });
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
