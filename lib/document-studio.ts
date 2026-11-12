import { createHash, randomBytes } from "node:crypto";
import { invoicePaymentTable, paymentsReceivedHtml } from "./invoice-payments";
import QRCode from "qrcode";
import { toBuffer as barcodeBuffer } from "bwip-js/node";
import type { AccessUser } from "./permissions";
import { can } from "./permissions";
import { prisma } from "./prisma";
import { formatInr, publicOrigin } from "./utils";
import {
  admitCardBlocked,
  admitCardPendingMonthsRequired,
  feeLineTotal,
  invoiceBalance,
  invoiceFeeStatement,
  paidFeeMonthCount,
  parseFeeLines,
  reportCardFeeMonthsRequired,
} from "./fees";
import { buildStudentMonthPayPath } from "./pay";
import { notifyNoticePublished } from "./push";
import { storedNoticeKind } from "./notices";
import {
  academicYearLabel,
  buildReportCardResults,
  mergeReportCardData,
  sampleReportCardPreviewData,
  splitClassLabel,
} from "./report-card-fields";
import { gradePolicyFrom, seriesRanks, studentSeriesScore } from "./exams";
import { parentSeesOfficialSeries } from "./exam-marks";
import { schoolFromConfig } from "./school";
import { readUploadDataUrl, resolveUploadPath } from "./uploads";
import { admissionCustomValues, admissionFormFields, type AdmissionFormField } from "./admission-form";
import { configuredAdmissionFormJson } from "./admission-form-config";

const DEFAULT_DOCUMENT_SCHOOL_ID = "school";
const DESIGNER_QR_PREVIEW_URL = "https://verify.anekio.example/preview";

export function issuedScanTokenFromUrl(raw: string) {
  const text = String(raw || "").trim();
  const match = text.match(/\/(?:attendance\/scan|staff\/scan|verify|documents)\/([^/?#]+)/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  if (/^[A-Za-z0-9_-]{16,}$/.test(text)) return text;
  return "";
}

export function issuedQrUrl(documentType: string, verifyUrl: string) {
  const token = issuedScanTokenFromUrl(verifyUrl) || String(verifyUrl || "").split("/").filter(Boolean).pop() || "preview";
  let origin = publicOrigin();
  try {
    origin = new URL(verifyUrl).origin;
  } catch {
    /* keep public origin */
  }
  if (documentType === "STUDENT_ID") return `${origin}/attendance/scan/${encodeURIComponent(token)}`;
  if (documentType === "EMPLOYEE_ID") return `${origin}/staff/scan/${encodeURIComponent(token)}`;
  return verifyUrl;
}

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
  { id: "STUDENT_ID", label: "Student ID card", category: "STUDENT", hint: "Modern CR80 photo ID with attendance QR, barcode, and student details", priority: true },
  { id: "ADMISSION_FORM", label: "Admission form", category: "STUDENT", hint: "Printable admission record" },
  { id: "ADMISSION_ACK", label: "Admission acknowledgement", category: "STUDENT", hint: "Receipt for an admission submission" },
  { id: "ADMISSION_CONFIRMATION", label: "Admission confirmation", category: "STUDENT", hint: "Confirms a student has been admitted", priority: true },
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
  { id: "ADMIT_CARD", label: "Student admit card", category: "ACADEMIC", hint: "Half-page A5 hall ticket with photo and date sheet", priority: true },
  { id: "EXAM_DATE_SHEET", label: "Exam date sheet", category: "ACADEMIC", hint: "Class exam timetable for notice boards and parents", priority: true },
  { id: "SEATING_PLAN", label: "Seating plan", category: "ACADEMIC", hint: "Room and seat allocation" },
  { id: "DESK_SLIP", label: "Desk slip", category: "ACADEMIC", hint: "Small student exam desk label" },
  { id: "INVIGILATOR_DUTY", label: "Invigilator duty sheet", category: "ACADEMIC", hint: "Teacher examination duties" },
  { id: "SUBJECT_MARKSHEET", label: "Subject marksheet", category: "ACADEMIC", hint: "Subject results for a class" },
  { id: "REPORT_CARD", label: "Report card", category: "ACADEMIC", hint: "Published exam results using the active report card design", priority: true },
  { id: "CONSOLIDATED_REPORT", label: "Consolidated report card", category: "ACADEMIC", hint: "Published results across sittings in one report", priority: true },
  { id: "GRADE_SHEET", label: "Grade sheet", category: "ACADEMIC", hint: "Grade-focused academic record" },
  { id: "RESULT_SUMMARY", label: "Result summary", category: "ACADEMIC", hint: "Class or session result summary" },
  { id: "PROGRESS_REPORT", label: "Progress report", category: "ACADEMIC", hint: "Periodic progress communication" },
  { id: "ACHIEVEMENT_CERTIFICATE", label: "Achievement certificate", category: "ACADEMIC", hint: "Recognises an achievement" },
  { id: "PARTICIPATION_CERTIFICATE", label: "Participation certificate", category: "ACADEMIC", hint: "Recognises participation" },
  { id: "MERIT_CERTIFICATE", label: "Merit certificate", category: "ACADEMIC", hint: "Recognises academic merit" },
  { id: "FEE_INVOICE", label: "Fee invoice", category: "FEES", hint: "Amount due with fee lines", priority: true },
  { id: "FEE_CHALLAN", label: "Fee challan", category: "FEES", hint: "Bank or counter payment challan" },
  { id: "PAYMENT_RECEIPT", label: "Payment receipt", category: "FEES", hint: "Immutable payment acknowledgement", priority: true },
  { id: "CONSOLIDATED_RECEIPT", label: "Consolidated receipt", category: "FEES", hint: "Multiple payments in one receipt" },
  { id: "FEE_STATEMENT", label: "Fee statement", category: "FEES", hint: "Student ledger statement" },
  { id: "DUES_NOTICE", label: "Outstanding-dues notice", category: "FEES", hint: "Formal outstanding balance reminder" },
  { id: "LATE_FEE_NOTICE", label: "Late-fee notice", category: "FEES", hint: "Overdue fee communication" },
  { id: "REFUND_RECEIPT", label: "Refund receipt / credit note", category: "FEES", hint: "Refund or adjustment record" },
  { id: "CONCESSION_CONFIRMATION", label: "Concession confirmation", category: "FEES", hint: "Scholarship or fee concession record" },
  { id: "FEE_CLEARANCE", label: "Fee clearance certificate", category: "FEES", hint: "Confirms cleared fee account" },
  { id: "EMPLOYEE_ID", label: "Staff ID card", category: "EMPLOYEE", hint: "Modern CR80 staff ID with verification QR, barcode, role, and campus details", priority: true },
  { id: "OFFER_LETTER", label: "Offer letter", category: "EMPLOYEE", hint: "Employment offer" },
  { id: "APPOINTMENT_LETTER", label: "Appointment letter", category: "EMPLOYEE", hint: "Formal appointment terms" },
  { id: "CONFIRMATION_LETTER", label: "Confirmation letter", category: "EMPLOYEE", hint: "Employment confirmation" },
  { id: "SALARY_SLIP", label: "Salary slip", category: "EMPLOYEE", hint: "Monthly staff pay statement", priority: true },
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

export const LIBRARY_DOCUMENT_TYPE_IDS = [
  "STUDENT_ID",
  "EMPLOYEE_ID",
  "ADMIT_CARD",
  "FEE_INVOICE",
  "PAYMENT_RECEIPT",
  "REPORT_CARD",
  "ADMISSION_CONFIRMATION",
  "EXAM_DATE_SHEET",
  "CONSOLIDATED_REPORT",
  "TRANSFER_CERTIFICATE",
  "SALARY_SLIP",
] as const;

const LIBRARY_TYPE_SET = new Set<string>(LIBRARY_DOCUMENT_TYPE_IDS);

export function libraryDocumentTypes() {
  return LIBRARY_DOCUMENT_TYPE_IDS.map((id) => DOCUMENT_TYPES.find((row) => row.id === id)).filter(
    (row): row is (typeof DOCUMENT_TYPES)[number] => Boolean(row)
  );
}

export function libraryDocumentCategories() {
  const used = new Set(libraryDocumentTypes().map((row) => row.category));
  return DOCUMENT_CATEGORIES.filter((row) => used.has(row.id)).map((row) =>
    row.id === "STUDENT"
      ? { ...row, hint: "Student ID and admission confirmation" }
      : row.id === "ACADEMIC"
        ? { ...row, hint: "Admit card, date sheet, and report cards" }
        : row.id === "FEES"
          ? { ...row, hint: "Fee invoice and payment receipt" }
          : row.id === "EMPLOYEE"
            ? { ...row, label: "Staff", hint: "Staff ID and salary slip" }
            : row
  );
}

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
  { group: "Exam", id: "admit.rollNo", label: "Admit card roll number" },
  { group: "Exam", id: "admit.centre", label: "Exam centre" },
  { group: "Exam", id: "admit.reporting", label: "Reporting time" },
  { group: "Exam", id: "admit.sessionLine", label: "Academic session line" },
  { group: "Exam", id: "admit.signLine", label: "Principal signature line" },
  { group: "Transfer", id: "tc.leavingDate", label: "Date of leaving" },
  { group: "Transfer", id: "tc.reason", label: "Reason for leaving" },
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
  { group: "Results", id: "results.score", label: "Marks (obtained / total)" },
  { group: "Results", id: "results.outcome", label: "Result (pass / needs improvement)" },
  { group: "Results", id: "results.rankLine", label: "Class rank line" },
  { group: "Results", id: "results.gradeScale", label: "Grade scale" },
  { group: "Results", id: "results.bestSubject", label: "Strongest subject" },
  { group: "Results", id: "results.focusSubject", label: "Subject needing practice" },
  { group: "Exam", id: "exam.name", label: "Exam name" },
  { group: "Exam", id: "exam.session", label: "Exam session" },
  { group: "Staff", id: "staff.classTeacherName", label: "Class teacher name" },
  { group: "Staff", id: "staff.principalName", label: "Principal name" },
  { group: "Fees", id: "fees.lines", label: "Fee line items" },
  { group: "Fees", id: "fees.amount", label: "Amount" },
  { group: "Fees", id: "fees.paid", label: "Amount paid" },
  { group: "Fees", id: "fees.paidEarlier", label: "Paid earlier (receipt)" },
  { group: "Fees", id: "fees.due", label: "Amount due" },
  { group: "Fees", id: "fees.status", label: "Fee status" },
  { group: "Fees", id: "fees.receiptLabel", label: "Receipt label" },
  { group: "Fees", id: "fees.receiptNumber", label: "Receipt number" },
  { group: "Fees", id: "fees.payments", label: "Payments received (receipts)" },
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
  { group: "Fees", id: "fees.amountWords", label: "Amount in words" },
  { group: "Fees", id: "fees.payQr", label: "UPI pay QR link" },
  { group: "Fees", id: "fees.payHint", label: "Pay hint" },
  { group: "Fees", id: "fees.accountName", label: "Account name" },
  { group: "Fees", id: "fees.accountNumber", label: "Account number" },
  { group: "Fees", id: "fees.ifscBank", label: "IFSC and bank" },
  { group: "Fees", id: "fees.forSchool", label: "For school (signature line)" },
  { group: "Fees", id: "fees.thanksLine", label: "Receipt summary line" },
  { group: "School", id: "school.gstinLine", label: "GSTIN line" },
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

export const REPORT_CARD_TEMPLATE_TYPES = ["REPORT_CARD", "GRADE_SHEET", "PROGRESS_REPORT", "CONSOLIDATED_REPORT"] as const;

export const DOCUMENT_ZONE_BY_TYPE: Record<string, string> = {
  STUDENT_ID: "People · student ID cards",
  EMPLOYEE_ID: "People · staff ID cards",
  ADMIT_CARD: "Exams · admit cards",
  FEE_INVOICE: "Fees invoices and parent pay links",
  PAYMENT_RECEIPT: "Fees payment receipts",
  REPORT_CARD: "Examination downloads and Exams",
  GRADE_SHEET: "Examination downloads and Exams",
  PROGRESS_REPORT: "Examination downloads and Exams",
  CONSOLIDATED_REPORT: "Examination downloads and Exams",
  ADMISSION_CONFIRMATION: "Admissions confirmations",
  EXAM_DATE_SHEET: "Exams · date sheets",
  SALARY_SLIP: "Staff payroll salary slips",
};

export function attachedZoneForDocumentType(type: string) {
  if (isReportCardType(type)) return DOCUMENT_ZONE_BY_TYPE.REPORT_CARD;
  return DOCUMENT_ZONE_BY_TYPE[type] || "this school’s documents";
}

export function pickAttachedReportCardType(
  publishedTypes: string[],
  kind: "sitting" | "paper" | "consolidated" = "sitting"
) {
  const available = publishedTypes.filter((type) => isReportCardType(type));
  const preferred =
    kind === "paper"
      ? ["GRADE_SHEET", "REPORT_CARD", "PROGRESS_REPORT", "CONSOLIDATED_REPORT"]
      : kind === "consolidated"
        ? ["CONSOLIDATED_REPORT", "REPORT_CARD", "GRADE_SHEET", "PROGRESS_REPORT"]
        : ["REPORT_CARD", "GRADE_SHEET", "PROGRESS_REPORT", "CONSOLIDATED_REPORT"];
  return preferred.find((type) => available.includes(type)) || available[0] || null;
}

export function isFeeDocumentType(type: string) {
  return type === "FEE_INVOICE" || type === "PAYMENT_RECEIPT";
}

export function documentModuleOwner(
  type: string
): "fees" | "exams" | "people" | "staff" | "admissions" | "payroll" | "office" {
  if (isFeeDocumentType(type)) return "fees";
  if (
    type === "ADMIT_CARD" ||
    type === "EXAM_DATE_SHEET" ||
    type === "REPORT_CARD" ||
    type === "GRADE_SHEET" ||
    type === "PROGRESS_REPORT" ||
    type === "CONSOLIDATED_REPORT"
  ) {
    return "exams";
  }
  if (type === "STUDENT_ID") return "people";
  if (type === "EMPLOYEE_ID") return "staff";
  if (type === "SALARY_SLIP") return "payroll";
  if (type === "ADMISSION_CONFIRMATION") return "admissions";
  return "office";
}

export function examReleaseUsesTemplate(type: string) {
  return type === "ADMIT_CARD" || type === "REPORT_CARD" || type === "CONSOLIDATED_REPORT";
}

export function attachesOnSaveDocumentType(type: string) {
  return (
    isFeeDocumentType(type) ||
    type === "ADMIT_CARD" ||
    type === "EXAM_DATE_SHEET" ||
    type === "REPORT_CARD" ||
    type === "CONSOLIDATED_REPORT"
  );
}

export function sampleFeePreviewData(type: string): Record<string, unknown> {
  const paid = type === "PAYMENT_RECEIPT";
  return {
    school: {
      name: "Springfield Public School",
      address: "12, Lake Road, Bengaluru, Karnataka 560001",
      contact: "080 4000 1200 • office@springfield.school",
      academicYear: "2026–27",
      website: "www.springfield.school",
    },
    student: {
      name: "Aarav Sharma",
      admissionNo: "ADM-2026-0142",
      classLabel: "VIII-A",
      parent: "Meera Sharma",
      parentPhone: "9800000042",
    },
    guardian: {
      name: "Meera Sharma",
      phone: "9800000042",
      email: "meera.sharma@email.test",
    },
    fees: {
      lines: paid
        ? [
            { for: "Term 1 fee", detail: "Tuition ₹12,000, Transport ₹6,000 · Invoice INV-0142", paidNow: "₹18,000", balance: "₹0" },
            { for: "Examination fee", detail: "Examination ₹4,000, Activity & lab ₹2,000 · Invoice INV-0143 · ₹2,000 paid earlier", paidNow: "₹4,000", balance: "₹0" },
          ]
        : [
            { Particulars: "Tuition fee", Period: "Apr–Jun 2026", Amount: "₹12,000" },
            { Particulars: "Transport fee", Period: "Quarter 1", Amount: "₹6,000" },
            { Particulars: "Examination fee", Period: "Term 1", Amount: "₹4,000" },
            { Particulars: "Activity & lab", Period: "Annual", Amount: "₹2,000" },
          ],
      amount: "₹24,000",
      paidEarlier: "₹2,000",
      paid: paid ? "₹22,000" : "₹18,000",
      due: paid ? "₹0" : "₹6,000",
      status: paid ? "Paid" : "Part paid",
      receiptLabel: "Receipt No.",
      receiptNumber: "RCPT-2026-014",
      term: "Term 1 · 2026–27",
      method: "UPI",
      reference: "UPI/2026/091201",
      receivedBy: "Vikram Rao",
      receivedAt: "2026-09-12 14:30",
      receivedNote: "Collected against Term 1 fees",
      upiId: "springfield.school@upi",
      bankName: "HDFC Bank",
      account: "Springfield Education Trust · 501000112233 · HDFC0001234",
    },
    document: { dueDate: "15 Apr 2026" },
  };
}

function mergeFeePreviewData(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const nest = (key: string) => ({
    ...((base[key] && typeof base[key] === "object" ? base[key] : {}) as Record<string, unknown>),
    ...((overlay[key] && typeof overlay[key] === "object" ? overlay[key] : {}) as Record<string, unknown>),
  });
  const fees = nest("fees");
  const overlayFees = (overlay.fees && typeof overlay.fees === "object" ? overlay.fees : {}) as Record<string, unknown>;
  const baseFees = (base.fees && typeof base.fees === "object" ? base.fees : {}) as Record<string, unknown>;
  if (!Array.isArray(overlayFees.lines) || overlayFees.lines.length < 3) fees.lines = baseFees.lines;
  return { ...base, ...overlay, school: nest("school"), student: nest("student"), guardian: nest("guardian"), fees, document: nest("document") };
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
    pageBg: "#EEF2F6",
    paper: "#FFFFFF",
    headerA: "#1B365D",
    headerB: "#1B365D",
    headerC: "#152A49",
    accent: "#1B365D",
    accent2: "#1B365D",
    onHeader: "#FFFFFF",
    onHeaderMuted: "#C5D0DE",
    titleBg: "#1B365D",
    titleColor: "#FFFFFF",
    pillBg: "#F8FAFC",
    pillBorder: "#CBD5E1",
    pillText: "#334155",
    studentBg: "#F8FAFC",
    studentBorder: "#CBD5E1",
    photoBorder: "#1B365D",
    sectionA: "#1B365D",
    sectionB: "#1B365D",
    card1: "#FFFFFF",
    card1Line: "#CBD5E1",
    card1Text: "#0F172A",
    card2: "#FFFFFF",
    card2Line: "#CBD5E1",
    card2Text: "#0F172A",
    card3: "#FFFFFF",
    card3Line: "#CBD5E1",
    card3Text: "#0F172A",
    card4: "#1B365D",
    card4Text: "#FFFFFF",
    metric1: "#FFFFFF",
    metric2: "#FFFFFF",
    metric3: "#FFFFFF",
    metric4: "#FFFFFF",
    remarkHead: "#1B365D",
    remarkHeadText: "#FFFFFF",
    remarkBg: "#F8FAFC",
    resultBg: "#F8FAFC",
    resultLine: "#CBD5E1",
    resultText: "#1B365D",
  },
};

function reportThemeFor(type: string): ReportCardTheme {
  if (type === "GRADE_SHEET") {
    return { ...REPORT_THEMES.REPORT_CARD, title: "GRADE SHEET" };
  }
  if (type === "PROGRESS_REPORT") {
    return { ...REPORT_THEMES.REPORT_CARD, title: "PROGRESS REPORT" };
  }
  if (type === "CONSOLIDATED_REPORT") {
    return { ...REPORT_THEMES.REPORT_CARD, title: "CONSOLIDATED REPORT CARD" };
  }
  return REPORT_THEMES.REPORT_CARD;
}

function reportCardLayout(type = "REPORT_CARD"): DocumentLayout {
  const t = reportThemeFor(type);
  const e = element;
  const label = (id: string, x: number, y: number, w: number, value: string) =>
    e(id, "TEXT", x, y, w, 1.3, { value, fontSize: 8, fontWeight: "bold", color: "#64748B" });
  const value = (id: string, x: number, y: number, w: number, field: string, name: string, extra: Partial<DocumentElement> = {}) =>
    e(id, "FIELD", x, y, w, 2, { field, label: name, fontSize: 12, fontWeight: "bold", color: "#0F172A", ...extra });
  return {
    elements: [
      e("page-bg", "SHAPE", 0, 0, 100, 100, { background: t.pageBg, locked: true }),
      e("rail", "SHAPE", 0, 0, 1.2, 100, { background: t.accent, locked: true }),
      e("paper", "SHAPE", 3.6, 1.6, 93.8, 96.6, { background: t.paper, borderColor: t.studentBorder, locked: true }),
      e("header-a", "SHAPE", 3.6, 1.6, 93.8, 10.4, { background: t.headerA, locked: true }),
      e("header-rule", "SHAPE", 3.6, 12, 93.8, 0.28, { background: t.accent, locked: true }),
      e("logo-frame", "SHAPE", 6, 3.1, 7.4, 7.2, { background: "#FFFFFF", borderColor: t.accent, locked: true }),
      e("school-logo", "IMAGE", 6.5, 3.6, 6.4, 6.2, { field: "school.logoPath", label: "Logo", locked: true }),
      e("school-name", "FIELD", 15.2, 3.1, 49, 3.6, { field: "school.name", label: "School name", fontSize: 21, fontWeight: "bold", color: t.onHeader, locked: true }),
      e("school-address", "FIELD", 15.2, 6.7, 49, 1.6, { field: "school.address", label: "School address", fontSize: 8, color: t.onHeaderMuted }),
      e("school-contact", "FIELD", 15.2, 8.4, 49, 1.6, { field: "school.contact", label: "School contact", fontSize: 8, color: t.onHeaderMuted }),
      e("year-label", "TEXT", 69, 3.4, 25.5, 1.4, { value: "ACADEMIC SESSION", fontSize: 7, fontWeight: "bold", align: "right", color: t.onHeaderMuted }),
      e("academic-year", "FIELD", 69, 5, 25.5, 2.2, { field: "school.academicYear", label: "Academic year", fontSize: 12, fontWeight: "bold", align: "right", color: t.onHeader }),
      e("document-number", "FIELD", 69, 7.6, 25.5, 1.6, { field: "document.number", label: "Document number", fontSize: 7, align: "right", color: t.onHeaderMuted }),
      e("title-bg", "SHAPE", 18, 13.2, 64, 2.8, { background: t.titleBg, locked: true }),
      e("title", "TEXT", 18, 13.4, 64, 2.4, { value: t.title, fontSize: 17, fontWeight: "bold", align: "center", color: t.titleColor }),
      e("session-pill", "SHAPE", 35, 16.4, 30, 2.2, { background: t.pillBg, borderColor: t.pillBorder, locked: true }),
      e("session-title", "FIELD", 35, 16.55, 30, 1.9, { field: "school.sessionTitle", label: "Academic session", fontSize: 8, fontWeight: "bold", align: "center", color: t.pillText }),
      e("student-card", "SHAPE", 6.2, 19.2, 89, 11.2, { background: t.studentBg, borderColor: t.studentBorder, locked: true }),
      e("photo", "PHOTO", 7.3, 20, 9.2, 9.6, { field: "student.photo", label: "Photo", borderColor: t.photoBorder }),
      label("name-label", 18.2, 20, 22, "STUDENT NAME"),
      e("student-name", "FIELD", 18.2, 21.15, 34, 2.4, { field: "student.name", label: "Student name", fontSize: 16, fontWeight: "bold", color: "#0F172A" }),
      e("status-pill", "SHAPE", 53.2, 20.1, 16.5, 2, { background: "#F1F5F9", borderColor: "#CBD5E1", locked: true }),
      e("promotion-status", "FIELD", 53.2, 20.25, 16.5, 1.7, { field: "results.promotionStatus", label: "Promotion status", fontSize: 8, fontWeight: "bold", align: "center", color: "#1B365D" }),
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
      e("acad-title", "TEXT", 7.6, 31.5, 50, 1.9, { value: "ACADEMIC PERFORMANCE", fontSize: 10, fontWeight: "bold", color: "#FFFFFF" }),
      e("marks-table", "TABLE", 6.2, 33.6, 89, 15.2, { field: "results.marks", label: "Marks and grades table", fontSize: 10, background: t.sectionA }),
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
      e("att-title", "TEXT", 7.4, 61.45, 30, 1.8, { value: "ATTENDANCE", fontSize: 9, fontWeight: "bold", color: "#FFFFFF" }),
      e("att-card", "SHAPE", 6.2, 63.4, 43, 8.3, { background: t.studentBg, borderColor: t.studentBorder, locked: true }),
      label("wd-l", 7.2, 63.8, 9.5, "WORKING"),
      value("working-days", 7.2, 65, 9.5, "results.workingDays", "Working days", { fontSize: 12 }),
      label("dp-l", 17.4, 63.8, 9.5, "PRESENT"),
      value("days-present", 17.4, 65, 9.5, "results.daysPresent", "Days present", { fontSize: 12 }),
      label("da-l", 27.6, 63.8, 9.5, "ABSENT"),
      value("days-absent", 27.6, 65, 9.5, "results.daysAbsent", "Days absent", { fontSize: 12, color: "#9F1239" }),
      label("ap-l", 37.8, 63.8, 10.2, "PERCENT"),
      value("att-pct", 37.8, 65, 10.2, "results.attendancePercentage", "Attendance percentage", { fontSize: 12 }),
      e("att-bar", "FIELD", 7.2, 67.6, 40.6, 3.2, { field: "results.attendanceBar", label: "Attendance progress", fontSize: 9, color: "#0F172A" }),
      e("act-head", "SHAPE", 50.8, 61.3, 44.4, 2.1, { background: t.sectionA, locked: true }),
      e("act-title", "TEXT", 52.1, 61.45, 40, 1.8, { value: "CO-SCHOLASTIC & ACTIVITIES", fontSize: 9, fontWeight: "bold", color: "#FFFFFF" }),
      e("activities-table", "TABLE", 50.8, 63.4, 44.4, 8.3, { field: "results.activities", label: "Co-scholastic table", fontSize: 8, background: t.sectionA }),
      e("remark-head", "SHAPE", 6.2, 72.5, 89, 2.1, { background: t.remarkHead, locked: true }),
      e("remark-title", "TEXT", 7.6, 72.7, 40, 1.7, { value: "TEACHER'S REMARKS", fontSize: 8, fontWeight: "bold", color: t.remarkHeadText }),
      e("remark-card", "SHAPE", 6.2, 74.6, 89, 5.5, { background: t.remarkBg, borderColor: t.resultLine, locked: true }),
      e("teacher-remark", "FIELD", 7.6, 75.2, 86, 4.3, { field: "results.teacherRemark", label: "Teacher remark", fontSize: 11, color: "#334155" }),
      e("result-box", "SHAPE", 6.2, 80.8, 89, 5.6, { background: t.resultBg, borderColor: t.resultLine, locked: true }),
      e("result-label", "TEXT", 8.4, 81.1, 84.6, 1.3, { value: "FINAL RESULT", fontSize: 7, fontWeight: "bold", align: "center", color: t.resultText }),
      e("result-status", "FIELD", 8.4, 82.3, 84.6, 2.2, { field: "results.promotionStatus", label: "Promotion status", fontSize: 17, fontWeight: "bold", align: "center", color: t.resultText }),
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

/**
 * Exam result: one sitting, marks only. Attendance, co-scholastic and promotion belong on the consolidated
 * report card. The marks table draws a bar per subject (TABLE value "bars"); the remark block follows the table.
 */
function examResultLayout(): DocumentLayout {
  const e = element;
  const navy = "#1E2A44";
  const muted = "#7A8699";
  const soft = "#F7F8FA";
  const line = "#E5E8EE";
  const label = (id: string, x: number, y: number, w: number, value: string, color = muted, align: "left" | "right" | "center" = "left") =>
    e(id, "TEXT", x, y, w, 1.2, { value, fontSize: 7, fontWeight: "bold", color, align });
  const tile = (id: string, x: number, title: string, field: string, name: string, dark = false) => [
    e(`${id}-bg`, "SHAPE", x, 28.2, 21.6, 6, { background: dark ? navy : "#FFFFFF", borderColor: dark ? undefined : line, locked: true }),
    label(`${id}-l`, x + 1.8, 29.1, 18, title, dark ? "#A9B8D1" : muted),
    e(id, "FIELD", x + 1.8, 30.4, 18, 3, { field, label: name, fontSize: 22, fontWeight: "bold", color: dark ? "#FFFFFF" : navy }),
  ];
  return {
    elements: [
      e("page-bg", "SHAPE", 0, 0, 100, 100, { background: "#FFFFFF", locked: true }),
      e("header", "SHAPE", 0, 0, 100, 13.4, { background: navy, locked: true }),
      e("header-stripe", "SHAPE", 0, 13.4, 100, 0.3, { background: "#8FA6C8", locked: true }),
      e("header-stripe-2", "SHAPE", 0, 13.4, 24, 0.3, { background: "#D4B06A", locked: true }),
      e("logo-frame", "SHAPE", 5, 2.9, 9.6, 6.9, { background: "#FFFFFF", locked: true }),
      e("school-logo", "IMAGE", 5.7, 3.4, 8.2, 5.9, { field: "school.logoPath", label: "Logo", background: "#4A5D80", locked: true }),
      e("school-name", "FIELD", 17, 3.2, 47, 3.2, { field: "school.name", label: "School name", fontSize: 20, fontWeight: "bold", color: "#FFFFFF", locked: true }),
      e("school-address", "FIELD", 17, 6.6, 47, 1.5, { field: "school.address", label: "School address", fontSize: 8, color: "#B8C4DA" }),
      e("school-contact", "FIELD", 17, 8.2, 47, 1.5, { field: "school.contact", label: "School contact", fontSize: 8, color: "#B8C4DA" }),
      label("doc-kind", 62, 3.3, 33, "EXAM RESULT", "#A9B8D1", "right"),
      e("title", "FIELD", 55, 4.8, 40, 2.8, { field: "exam.name", label: "Exam name", fontSize: 17, fontWeight: "bold", align: "right", color: "#FFFFFF" }),
      e("exam-session", "FIELD", 55, 7.7, 40, 1.5, { field: "exam.session", label: "Exam session", fontSize: 9, fontWeight: "bold", align: "right", color: "#DBEAFE" }),
      e("document-number", "FIELD", 55, 9.6, 40, 1.4, { field: "document.number", label: "Document number", fontSize: 7, align: "right", color: "#93A4C3" }),

      e("student-card", "SHAPE", 5, 16.2, 90, 9.6, { background: soft, borderColor: line, locked: true }),
      e("photo", "PHOTO", 6.6, 17.3, 7.4, 7.4, { field: "student.photo", label: "Photo", background: "#DDE3EC" }),
      label("name-l", 16.4, 17.5, 30, "STUDENT"),
      e("student-name", "FIELD", 16.4, 18.8, 63, 2.8, { field: "student.name", label: "Student name", fontSize: 18, fontWeight: "bold", color: navy }),
      label("class-l", 16.4, 22.3, 12, "CLASS"),
      e("class", "FIELD", 16.4, 23.4, 12, 1.8, { field: "student.classLabel", label: "Class and section", fontSize: 11, fontWeight: "bold", color: navy }),
      label("roll-l", 27.6, 22.3, 9, "ROLL NO"),
      e("roll", "FIELD", 27.6, 23.4, 9, 1.8, { field: "student.rollNo", label: "Roll number", fontSize: 11, fontWeight: "bold", color: navy }),
      label("admission-l", 37.4, 22.3, 15, "ADMISSION NO"),
      e("admission", "FIELD", 37.4, 23.4, 15, 1.8, { field: "student.admissionNo", label: "Admission number", fontSize: 11, fontWeight: "bold", color: navy }),
      label("dob-l", 53.2, 22.3, 13, "DATE OF BIRTH"),
      e("dob", "FIELD", 53.2, 23.4, 13, 1.8, { field: "student.born", label: "Date of birth", fontSize: 11, fontWeight: "bold", color: navy }),
      label("parent-l", 67, 22.3, 13.5, "PARENT"),
      e("parent", "FIELD", 67, 23.4, 13.5, 1.8, { field: "student.parent", label: "Guardian name", fontSize: 11, fontWeight: "bold", color: navy }),
      e("rank-bg", "SHAPE", 82.2, 17.4, 11.6, 7.2, { background: "#FBF6EA", borderColor: "#E9D9B0", locked: true }),
      label("rank-l", 82.2, 18.4, 11.6, "CLASS RANK", "#A6844A", "center"),
      e("rank", "FIELD", 82.2, 19.8, 11.6, 3.6, { field: "results.classRank", label: "Rank", fontSize: 26, fontWeight: "bold", align: "center", color: navy }),

      ...tile("score", 5, "MARKS", "results.score", "Marks"),
      ...tile("percentage", 27.8, "PERCENTAGE", "results.percentage", "Percentage"),
      ...tile("grade", 50.6, "OVERALL GRADE", "results.overallGrade", "Overall grade", true),
      e("outcome-bg", "SHAPE", 73.4, 28.2, 21.6, 6, { background: "#FFFFFF", borderColor: line, locked: true }),
      label("outcome-l", 75.2, 29.1, 18, "RESULT"),
      e("outcome", "FIELD", 75.2, 30.4, 18, 3, { field: "results.outcome", label: "Result", fontSize: 22, fontWeight: "bold", color: navy }),

      e("marks-title", "TEXT", 5, 36.6, 50, 1.7, { value: "SUBJECT-WISE MARKS", fontSize: 10, fontWeight: "bold", color: navy }),
      e("marks-table", "TABLE", 5, 38.8, 90, 32, { field: "results.marks", label: "Marks and grades table", value: "bars", fontSize: 10, background: navy }),

      e("hl-best-bg", "SHAPE", 5, 72.2, 44.4, 4.4, { background: "#FFFFFF", borderColor: line, locked: true }),
      label("hl-best-l", 6.8, 72.9, 40, "STRONGEST SUBJECT", "#5E8A70"),
      e("hl-best", "FIELD", 6.8, 74.1, 41, 2, { field: "results.bestSubject", label: "Strongest subject", fontSize: 13, fontWeight: "bold", color: navy }),
      e("hl-focus-bg", "SHAPE", 50.6, 72.2, 44.4, 4.4, { background: "#FFFFFF", borderColor: line, locked: true }),
      label("hl-focus-l", 52.4, 72.9, 40, "NEEDS MORE PRACTICE", "#A6844A"),
      e("hl-focus", "FIELD", 52.4, 74.1, 41, 2, { field: "results.focusSubject", label: "Subject needing practice", fontSize: 13, fontWeight: "bold", color: navy }),
      e("remark-title", "TEXT", 5, 77.7, 50, 1.7, { value: "CLASS TEACHER'S REMARK", fontSize: 10, fontWeight: "bold", color: navy }),
      e("remark-card", "SHAPE", 5, 79.7, 90, 4, { background: soft, borderColor: line, locked: true }),
      e("teacher-remark", "FIELD", 6.6, 80.1, 86.8, 3.2, { field: "results.teacherRemark", label: "Teacher remark", fontSize: 11, color: "#334155" }),

      label("scale-l", 5, 85.2, 14, "GRADE SCALE"),
      e("grade-scale", "FIELD", 16, 84.8, 79, 2, { field: "results.gradeScale", label: "Grade scale", fontSize: 8, fontWeight: "bold", color: "#475569" }),
      e("sign-teacher", "SIGNATURE", 6, 88.2, 20, 3.6, { field: "school.signPath", label: "Class teacher signature" }),
      e("sign-teacher-line", "LINE", 6, 92, 20, 0.3, { color: "#CBD5E1" }),
      e("sign-teacher-name", "FIELD", 6, 92.3, 20, 1.4, { field: "staff.classTeacherName", label: "Class teacher name", fontSize: 8, fontWeight: "bold", align: "center", color: navy }),
      e("sign-teacher-l", "TEXT", 6, 93.6, 20, 1.2, { value: "Class Teacher", fontSize: 7, align: "center", color: muted }),
      e("sign-principal", "SIGNATURE", 32, 88.2, 20, 3.6, { field: "school.signPath", label: "Principal signature" }),
      e("sign-principal-line", "LINE", 32, 92, 20, 0.3, { color: "#CBD5E1" }),
      e("sign-principal-name", "FIELD", 32, 92.3, 20, 1.4, { field: "staff.principalName", label: "Principal name", fontSize: 8, fontWeight: "bold", align: "center", color: navy }),
      e("sign-principal-l", "TEXT", 32, 93.6, 20, 1.2, { value: "Principal", fontSize: 7, align: "center", color: muted }),
      e("sign-parent-line", "LINE", 58, 92, 20, 0.3, { color: "#CBD5E1" }),
      e("sign-parent-l", "TEXT", 58, 92.3, 20, 1.4, { value: "Parent / Guardian", fontSize: 8, fontWeight: "bold", align: "center", color: navy }),
      e("sign-parent-sub", "TEXT", 58, 93.6, 20, 1.2, { value: "Signature", fontSize: 7, align: "center", color: muted }),
      e("verify", "VERIFY_QR", 87.4, 87.6, 7.6, 5.4, { label: "Verification QR", locked: true }),
      e("verify-l", "TEXT", 84, 93.2, 11, 1.3, { value: "SCAN TO VERIFY", fontSize: 6, fontWeight: "bold", align: "right", color: muted }),
      e("footer-bg", "SHAPE", 0, 96.2, 100, 3.8, { background: soft, locked: true }),
      e("footer", "TEXT", 5, 97.3, 40, 1.5, { value: "Generated by Anekio", fontSize: 7, color: muted }),
      e("footer-web", "FIELD", 35, 97.3, 30, 1.5, { field: "school.website", label: "School website", fontSize: 7, align: "center", color: muted }),
      e("issue-date", "FIELD", 65, 97.3, 30, 1.5, { field: "document.issueDate", label: "Issue date", fontSize: 7, align: "right", color: muted }),
    ],
  };
}

/**
 * Transfer certificate: formal, register-style. Numbered particulars with ruled lines, leaving date and
 * reason from the Move out step (tc.*), principal's signature, school stamp and a verify QR.
 */
function transferCertificateLayout(): DocumentLayout {
  const e = element;
  const navy = "#1E2A44";
  const gold = "#B8954A";
  const muted = "#6B778C";
  const rows: [string, string, string][] = [
    ["Name of the student", "student.name", "Student name"],
    ["Parent / guardian's name", "student.parent", "Guardian name"],
    ["Date of birth", "student.born", "Date of birth"],
    ["Gender", "student.gender", "Gender"],
    ["Admission number", "student.admissionNo", "Admission number"],
    ["Class last studied", "student.classLabel", "Class and section"],
    ["Roll number", "student.rollNo", "Roll number"],
    ["Date of leaving", "tc.leavingDate", "Date of leaving"],
    ["Reason for leaving", "tc.reason", "Reason for leaving"],
  ];
  const top = 35.5;
  const step = 4.3;
  return {
    elements: [
      e("page-bg", "SHAPE", 0, 0, 100, 100, { background: "#FFFFFF", locked: true }),
      e("frame-outer", "SHAPE", 3.5, 2.5, 93, 95, { borderColor: navy, locked: true }),
      e("frame-inner", "SHAPE", 5, 3.6, 90, 92.8, { borderColor: gold, locked: true }),
      e("school-logo", "IMAGE", 44, 5.6, 12, 8, { field: "school.logoPath", label: "Logo", background: "#4A5D80", locked: true }),
      e("school-name", "FIELD", 10, 14.4, 80, 3.4, { field: "school.name", label: "School name", fontSize: 22, fontWeight: "bold", align: "center", color: navy, locked: true }),
      e("school-address", "FIELD", 10, 18, 80, 1.6, { field: "school.address", label: "School address", fontSize: 9, align: "center", color: muted }),
      e("school-contact", "FIELD", 10, 19.7, 80, 1.6, { field: "school.contact", label: "School contact", fontSize: 9, align: "center", color: muted }),
      e("school-affiliation", "FIELD", 10, 21.4, 80, 1.6, { field: "school.affiliation", label: "Affiliation", fontSize: 9, fontWeight: "bold", align: "center", color: muted }),
      e("rule-left", "LINE", 12, 26.4, 22, 0.3, { color: gold }),
      e("title", "TEXT", 30, 25, 40, 3, { value: "TRANSFER CERTIFICATE", fontSize: 17, fontWeight: "bold", align: "center", color: navy }),
      e("rule-right", "LINE", 66, 26.4, 22, 0.3, { color: gold }),
      e("no-l", "TEXT", 12, 30.6, 10, 1.6, { value: "TC No.", fontSize: 9, fontWeight: "bold", color: muted }),
      e("document-number", "FIELD", 20, 30.5, 30, 1.8, { field: "document.number", label: "Document number", fontSize: 10, fontWeight: "bold", color: navy }),
      e("date-l", "TEXT", 60, 30.6, 14, 1.6, { value: "Date of issue", fontSize: 9, fontWeight: "bold", align: "right", color: muted }),
      e("date", "FIELD", 74.5, 30.5, 14, 1.8, { field: "document.issueDate", label: "Issue date", fontSize: 10, fontWeight: "bold", align: "right", color: navy }),
      e("photo", "PHOTO", 76.5, 35.2, 12, 14.5, { field: "student.photo", label: "Photo", borderColor: "#CBD5E1" }),
      ...rows.flatMap(([label, field, name], i) => {
        const y = top + i * step;
        const width = y < 50.5 ? 40 : 53;
        return [
          e(`row-${i}-n`, "TEXT", 12, y, 3.5, 2, { value: `${i + 1}.`, fontSize: 10, fontWeight: "bold", color: gold }),
          e(`row-${i}-l`, "TEXT", 15.5, y, 20, 2, { value: label, fontSize: 10, color: muted }),
          e(`row-${i}-v`, "FIELD", 35.5, y - 0.2, width, 2.3, { field, label: name, fontSize: 12, fontWeight: "bold", color: navy }),
          e(`row-${i}-line`, "LINE", 35.5, y + 2.3, width, 0.2, { color: "#D5DBE5" }),
        ];
      }),
      e("body", "TEXT", 12, 73.8, 76, 5.5, {
        value: "Certified that the above particulars are true as per the school admission register. We wish the student every success in the future.",
        fontSize: 10,
        color: "#334155",
      }),
      e("verify", "VERIFY_QR", 12, 82, 9, 6.5, { label: "Verification QR", locked: true }),
      e("verify-l", "TEXT", 10.5, 88.8, 12, 1.4, { value: "Scan to verify", fontSize: 7, align: "center", color: muted }),
      e("stamp", "STAMP", 42, 81.5, 13, 9, { field: "school.stampPath", label: "School stamp" }),
      e("signature", "SIGNATURE", 66, 81.8, 22, 6, { field: "school.signPath", label: "Principal signature" }),
      e("signature-line", "LINE", 66, 88.2, 22, 0.3, { color: "#94A3B8" }),
      e("signature-label", "TEXT", 66, 88.7, 22, 1.6, { value: "Principal", fontSize: 9, fontWeight: "bold", align: "center", color: navy }),
      e("footer", "TEXT", 10, 93.6, 80, 1.4, { value: "This certificate is computer generated and can be verified by scanning the QR code.", fontSize: 7, align: "center", color: "#94A3B8" }),
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
  if (type === "REPORT_CARD") return examResultLayout();
  if (type === "TRANSFER_CERTIFICATE") return transferCertificateLayout();
  if (isReportCardType(type)) return reportCardLayout(type);
  if (type === "STUDENT_ID") {
    return {
      elements: [
        element("card-bg", "SHAPE", 0, 0, 100, 100, { background: "#F8FBFF", locked: true }),
        element("left-rail", "SHAPE", 0, 0, 1.8, 100, { background: "#0EA5E9", locked: true }),
        element("top-band", "SHAPE", 0, 0, 100, 17, { background: "#E0F2FE", locked: true }),
        element("top-line", "SHAPE", 0, 17, 100, 1.2, { background: "#0EA5E9", locked: true }),
        element("logo-mat", "SHAPE", 3, 2.5, 11, 12, { background: "#FFFFFF", borderColor: "#38BDF8", locked: true }),
        element("school-logo", "IMAGE", 3.6, 3.2, 9.8, 10.6, { field: "school.logoPath", label: "Logo", locked: true }),
        element("school-name", "FIELD", 16, 2.8, 56, 8, { field: "school.name", label: "School name", fontSize: 13, fontWeight: "bold", color: "#0F172A", locked: true }),
        element("card-kind", "TEXT", 16, 10.6, 56, 5, { value: "STUDENT IDENTITY CARD", fontSize: 8, fontWeight: "bold", color: "#0369A1" }),
        element("year-pill", "SHAPE", 74, 3.5, 23, 10, { background: "#FFFFFF", borderColor: "#7DD3FC", locked: true }),
        element("year", "FIELD", 74.4, 4.8, 22.2, 7.4, { field: "school.academicYear", label: "Academic year", fontSize: 10, fontWeight: "bold", align: "center", color: "#0F172A" }),
        element("photo-mat", "SHAPE", 3, 21, 20, 52, { background: "#FFFFFF", borderColor: "#38BDF8", locked: true }),
        element("photo", "PHOTO", 3.6, 22, 18.8, 50, { field: "student.photo", label: "Photo", borderColor: "#0EA5E9" }),
        element("panel", "SHAPE", 25, 21, 49, 52, { background: "#FFFFFF", borderColor: "#BAE6FD", locked: true }),
        element("name-label", "TEXT", 26.5, 22.4, 46, 5, { value: "STUDENT NAME", fontSize: 8, fontWeight: "bold", color: "#0369A1" }),
        element("student-name", "FIELD", 26.5, 27.2, 46, 11, { field: "student.name", label: "Student name", fontSize: 16, fontWeight: "bold", color: "#0B1220" }),
        element("class-label", "TEXT", 26.5, 39.2, 21, 5, { value: "CLASS", fontSize: 8, fontWeight: "bold", color: "#0E7490" }),
        element("class", "FIELD", 26.5, 44, 21, 8, { field: "student.classLabel", label: "Class", fontSize: 12, fontWeight: "bold", color: "#0F172A" }),
        element("roll-label", "TEXT", 50, 39.2, 22, 5, { value: "ROLL", fontSize: 8, fontWeight: "bold", color: "#4338CA" }),
        element("roll", "FIELD", 50, 44, 22, 8, { field: "student.rollNo", label: "Roll number", fontSize: 12, fontWeight: "bold", color: "#0F172A" }),
        element("adm-label", "TEXT", 26.5, 53, 21, 5, { value: "ADM NO", fontSize: 8, fontWeight: "bold", color: "#0369A1" }),
        element("identity", "FIELD", 26.5, 57.8, 21, 8, { field: "student.admissionNo", label: "Admission number", fontSize: 11, fontWeight: "bold", color: "#0F172A" }),
        element("dob-label", "TEXT", 50, 53, 22, 5, { value: "DOB", fontSize: 8, fontWeight: "bold", color: "#0369A1" }),
        element("dob", "FIELD", 50, 57.8, 22, 8, { field: "student.born", label: "Date of birth", fontSize: 11, fontWeight: "bold", color: "#0F172A" }),
        element("qr-mat", "SHAPE", 76, 21, 21, 52, { background: "#FFFFFF", borderColor: "#7DD3FC", locked: true }),
        element("verify", "VERIFY_QR", 77, 22.5, 19, 38, { label: "Attendance verification QR", locked: true }),
        element("qr-label", "TEXT", 76.2, 61.5, 20.6, 9.5, { value: "SCAN TO VERIFY", fontSize: 8, fontWeight: "bold", align: "center", color: "#0369A1" }),
        element("bottom-band", "SHAPE", 0, 75, 100, 25, { background: "#F0F9FF", locked: true }),
        element("bottom-line", "SHAPE", 0, 75, 100, 1.2, { background: "#7DD3FC", locked: true }),
        element("barcode", "BARCODE", 4, 78, 52, 10, { field: "document.number", label: "Card barcode" }),
        element("footer", "TEXT", 4, 89, 52, 7, { value: "Keep this ID with you", fontSize: 9, fontWeight: "bold", color: "#0F172A" }),
        element("document-number", "FIELD", 58, 80, 38, 14, { field: "document.number", label: "Card number", fontSize: 9, fontWeight: "bold", align: "right", color: "#0369A1" }),
      ],
    };
  }
  if (type === "EMPLOYEE_ID") {
    return {
      elements: [
        element("card-bg", "SHAPE", 0, 0, 100, 100, { background: "#FFFCF7", locked: true }),
        element("left-rail", "SHAPE", 0, 0, 1.8, 100, { background: "#F59E0B", locked: true }),
        element("top-band", "SHAPE", 0, 0, 100, 17, { background: "#FEF3C7", locked: true }),
        element("top-line", "SHAPE", 0, 17, 100, 1.2, { background: "#F59E0B", locked: true }),
        element("logo-mat", "SHAPE", 3, 2.5, 11, 12, { background: "#FFFFFF", borderColor: "#FBBF24", locked: true }),
        element("school-logo", "IMAGE", 3.6, 3.2, 9.8, 10.6, { field: "school.logoPath", label: "Logo", locked: true }),
        element("school-name", "FIELD", 16, 2.8, 56, 8, { field: "school.name", label: "School name", fontSize: 13, fontWeight: "bold", color: "#0F172A", locked: true }),
        element("card-kind", "TEXT", 16, 10.6, 56, 5, { value: "STAFF IDENTITY CARD", fontSize: 8, fontWeight: "bold", color: "#B45309" }),
        element("badge", "SHAPE", 74, 3.5, 23, 10, { background: "#FFFFFF", borderColor: "#FBBF24", locked: true }),
        element("badge-text", "TEXT", 74.4, 5, 22.2, 7.2, { value: "STAFF", fontSize: 11, fontWeight: "bold", align: "center", color: "#0F766E" }),
        element("photo-mat", "SHAPE", 3, 21, 20, 52, { background: "#FFFFFF", borderColor: "#FBBF24", locked: true }),
        element("photo", "PHOTO", 3.6, 22, 18.8, 50, { field: "employee.photo", label: "Photo", borderColor: "#D97706" }),
        element("panel", "SHAPE", 25, 21, 49, 52, { background: "#FFFFFF", borderColor: "#FDE68A", locked: true }),
        element("name-label", "TEXT", 26.5, 22.4, 46, 5, { value: "EMPLOYEE NAME", fontSize: 8, fontWeight: "bold", color: "#B45309" }),
        element("employee-name", "FIELD", 26.5, 27.2, 46, 11, { field: "employee.name", label: "Employee name", fontSize: 16, fontWeight: "bold", color: "#0B1220" }),
        element("id-label", "TEXT", 26.5, 39.2, 21, 5, { value: "STAFF ID", fontSize: 8, fontWeight: "bold", color: "#0F766E" }),
        element("identity", "FIELD", 26.5, 44, 21, 8, { field: "employee.employeeId", label: "Employee ID", fontSize: 12, fontWeight: "bold", color: "#0F172A" }),
        element("role-label", "TEXT", 50, 39.2, 22, 5, { value: "ROLE", fontSize: 8, fontWeight: "bold", color: "#B45309" }),
        element("role", "FIELD", 50, 44, 22, 8, { field: "employee.role", label: "Role", fontSize: 12, fontWeight: "bold", color: "#0F172A" }),
        element("phone-label", "TEXT", 26.5, 53, 46, 5, { value: "PHONE", fontSize: 8, fontWeight: "bold", color: "#B45309" }),
        element("phone", "FIELD", 26.5, 57.8, 46, 12, { field: "school.phone", label: "School phone", fontSize: 12, fontWeight: "bold", color: "#0F172A" }),
        element("qr-mat", "SHAPE", 76, 21, 21, 52, { background: "#FFFFFF", borderColor: "#FBBF24", locked: true }),
        element("verify", "VERIFY_QR", 77, 22.5, 19, 38, { label: "Staff verification QR", locked: true }),
        element("qr-label", "TEXT", 76.2, 61.5, 20.6, 9.5, { value: "SCAN TO VERIFY", fontSize: 8, fontWeight: "bold", align: "center", color: "#B45309" }),
        element("bottom-band", "SHAPE", 0, 75, 100, 25, { background: "#FFFBEB", locked: true }),
        element("bottom-line", "SHAPE", 0, 75, 100, 1.2, { background: "#FBBF24", locked: true }),
        element("barcode", "BARCODE", 4, 78, 52, 10, { field: "document.number", label: "Card barcode" }),
        element("footer", "TEXT", 4, 89, 52, 7, { value: "Official staff identity", fontSize: 9, fontWeight: "bold", color: "#0F172A" }),
        element("document-number", "FIELD", 58, 80, 38, 14, { field: "document.number", label: "Card number", fontSize: 9, fontWeight: "bold", align: "right", color: "#B45309" }),
      ],
    };
  }
  if (type === "ADMIT_CARD") return admitCardLayout();

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
    return feeDocumentLayout(type === "PAYMENT_RECEIPT");
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
              ...(transfer
                ? [
                    element("leaving-label", "TEXT", 10, 49.5, 18, 2, { value: "DATE OF LEAVING", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
                    element("leaving-date", "FIELD", 28, 49.3, 22, 2.6, { field: "tc.leavingDate", label: "Date of leaving", fontSize: 11, fontWeight: "bold" }),
                    element("reason-label", "TEXT", 52, 49.5, 12, 2, { value: "REASON", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
                    element("reason", "FIELD", 64, 49.3, 26, 2.6, { field: "tc.reason", label: "Reason for leaving", fontSize: 11, fontWeight: "bold" }),
                  ]
                : []),
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
  if (type === "ADMISSION_ACK") {
    return {
      elements: [
        element("page-bg", "SHAPE", 0, 0, 100, 100, { background: "#F0FDFA", locked: true }),
        element("paper", "SHAPE", 5, 4, 90, 92, { background: "#ffffff", borderColor: "#CCFBF1", locked: true }),
        element("top-band", "SHAPE", 5, 4, 90, 12, { background: "#0F766E", locked: true }),
        element("accent", "SHAPE", 5, 4, 1.4, 92, { background: "#059669", locked: true }),
        element("school-logo", "IMAGE", 9, 6, 8, 8, { field: "school.logoPath", label: "Logo" }),
        element("school-name", "FIELD", 19, 6.2, 50, 4.2, { field: "school.name", label: "School name", fontSize: 20, fontWeight: "bold", color: "#ffffff", locked: true }),
        element("school-address", "FIELD", 19, 11, 50, 2, { field: "school.address", label: "School address", fontSize: 8, color: "#CCFBF1" }),
        element("document-number", "FIELD", 70, 8, 20, 2.5, { field: "document.number", label: "Document number", fontSize: 8, fontWeight: "bold", align: "right", color: "#ffffff" }),
        element("title-bg", "SHAPE", 24, 20, 52, 6, { background: "#CCFBF1", locked: true }),
        element("title", "TEXT", 25, 21.4, 50, 3.2, { value: "ADMISSION ACKNOWLEDGEMENT", fontSize: 14, fontWeight: "bold", align: "center", color: "#0F766E" }),
        element("photo", "PHOTO", 10, 30, 16, 18, { field: "student.photo", label: "Photo", borderColor: "#0F766E" }),
        element("name-label", "TEXT", 30, 31, 20, 2, { value: "STUDENT NAME", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("student-name", "FIELD", 30, 33.5, 42, 4, { field: "student.name", label: "Student name", fontSize: 16, fontWeight: "bold" }),
        element("class-label", "TEXT", 30, 40, 12, 2, { value: "CLASS", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("class", "FIELD", 42, 39.8, 20, 2.6, { field: "student.classLabel", label: "Class", fontSize: 11, fontWeight: "bold" }),
        element("adm-label", "TEXT", 64, 40, 16, 2, { value: "ADMISSION NO", fontSize: 7, fontWeight: "bold", color: "#64748b" }),
        element("admission", "FIELD", 80, 39.8, 12, 2.6, { field: "student.admissionNo", label: "Admission number", fontSize: 10, fontWeight: "bold" }),
        element("body", "TEXT", 10, 54, 80, 14, {
          value: "This acknowledges receipt of the admission application / record for the student named above. Keep this document for school records.",
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
  if (type === "ADMISSION_CONFIRMATION") {
    return {
      elements: [
        element("page-bg", "SHAPE", 0, 0, 100, 100, { background: "#EEF2FF", locked: true }),
        element("paper", "SHAPE", 5, 3.5, 90, 93, { background: "#FFFFFF", borderColor: "#C7D2FE", locked: true }),
        element("top-band", "SHAPE", 5, 3.5, 90, 13, { background: "#4338CA", locked: true }),
        element("accent", "SHAPE", 5, 3.5, 1.6, 93, { background: "#F59E0B", locked: true }),
        element("school-logo", "IMAGE", 8.5, 5.5, 9, 9, { field: "school.logoPath", label: "Logo" }),
        element("school-name", "FIELD", 19, 5.6, 52, 5, { field: "school.name", label: "School name", fontSize: 22, fontWeight: "bold", color: "#FFFFFF", locked: true }),
        element("school-address", "FIELD", 19, 11.2, 52, 2.4, { field: "school.address", label: "School address", fontSize: 10, color: "#E0E7FF" }),
        element("document-number", "FIELD", 72, 8, 20, 3, { field: "document.number", label: "Document number", fontSize: 11, fontWeight: "bold", align: "right", color: "#FFFFFF" }),
        element("title-bg", "SHAPE", 18, 20, 64, 6, { background: "#4338CA", locked: true }),
        element("title", "TEXT", 19, 21.2, 62, 3.6, { value: "ADMISSION CONFIRMATION", fontSize: 18, fontWeight: "bold", align: "center", color: "#FFFFFF" }),
        element("photo", "PHOTO", 10, 30, 16, 18, { field: "student.photo", label: "Photo", borderColor: "#4338CA" }),
        element("name-label", "TEXT", 30, 31, 22, 2.2, { value: "STUDENT NAME", fontSize: 8, fontWeight: "bold", color: "#64748B" }),
        element("student-name", "FIELD", 30, 33.6, 54, 4.2, { field: "student.name", label: "Student name", fontSize: 20, fontWeight: "bold" }),
        element("class-label", "TEXT", 30, 40, 12, 2.2, { value: "CLASS", fontSize: 8, fontWeight: "bold", color: "#64748B" }),
        element("class", "FIELD", 42, 39.6, 22, 3, { field: "student.classLabel", label: "Class", fontSize: 14, fontWeight: "bold" }),
        element("adm-label", "TEXT", 66, 40, 16, 2.2, { value: "ADMISSION NO", fontSize: 8, fontWeight: "bold", color: "#64748B" }),
        element("admission", "FIELD", 82, 39.6, 8, 3, { field: "student.admissionNo", label: "Admission number", fontSize: 13, fontWeight: "bold" }),
        element("body", "TEXT", 10, 52, 80, 14, {
          value: "This confirms that the student named above has been admitted as recorded in the official school register for the current academic session.",
          fontSize: 14,
          color: "#334155",
        }),
        element("date-label", "TEXT", 10, 70, 16, 2, { value: "ISSUE DATE", fontSize: 8, fontWeight: "bold", color: "#64748B" }),
        element("date", "FIELD", 10, 72.2, 28, 3.2, { field: "document.issueDate", label: "Issue date", fontSize: 13, fontWeight: "bold" }),
        element("signature", "SIGNATURE", 52, 68, 18, 9, { field: "school.signPath", label: "Authorised signature" }),
        element("signature-label", "TEXT", 50, 78, 22, 2.2, { value: "Authorised signatory", fontSize: 8, align: "center", color: "#64748B" }),
        element("verify", "VERIFY_QR", 78, 67, 12, 12, { label: "Verification QR", locked: true }),
        element("qr-label", "TEXT", 76, 80, 16, 2.2, { value: "Verify document", fontSize: 8, align: "center", color: "#64748B" }),
        element("footer", "FIELD", 10, 88, 80, 3.4, { field: "school.contact", label: "School contact", fontSize: 10, align: "center", color: "#64748B" }),
      ],
    };
  }
  if (type === "EXAM_DATE_SHEET") {
    return {
      elements: [
        element("page-bg", "SHAPE", 0, 0, 100, 100, { background: "#F8FAFC", locked: true }),
        element("paper", "SHAPE", 4, 3, 92, 94, { background: "#FFFFFF", borderColor: "#CBD5E1", locked: true }),
        element("top-band", "SHAPE", 4, 3, 92, 13, { background: "#0F172A", locked: true }),
        element("accent", "SHAPE", 4, 16, 92, 1.2, { background: "#F59E0B", locked: true }),
        element("school-logo", "IMAGE", 7, 5, 8, 8, { field: "school.logoPath", label: "Logo" }),
        element("school-name", "FIELD", 17, 5.2, 52, 5, { field: "school.name", label: "School name", fontSize: 22, fontWeight: "bold", color: "#FFFFFF", locked: true }),
        element("school-address", "FIELD", 17, 10.6, 52, 2.4, { field: "school.address", label: "School address", fontSize: 10, color: "#CBD5E1" }),
        element("year", "FIELD", 72, 7, 20, 4, { field: "school.academicYear", label: "Academic year", fontSize: 12, fontWeight: "bold", align: "right", color: "#FDE68A" }),
        element("title", "TEXT", 8, 20, 84, 5, { value: "EXAM DATE SHEET", fontSize: 22, fontWeight: "bold", align: "center", color: "#0F172A" }),
        element("exam-label", "TEXT", 8, 27, 16, 2.2, { value: "EXAMINATION", fontSize: 8, fontWeight: "bold", color: "#64748B" }),
        element("exam-name", "FIELD", 8, 29.4, 42, 4, { field: "exam.name", label: "Exam name", fontSize: 16, fontWeight: "bold" }),
        element("class-label", "TEXT", 54, 27, 12, 2.2, { value: "CLASS", fontSize: 8, fontWeight: "bold", color: "#64748B" }),
        element("class", "FIELD", 54, 29.4, 20, 4, { field: "student.classLabel", label: "Class", fontSize: 16, fontWeight: "bold" }),
        element("doc-label", "TEXT", 78, 27, 14, 2.2, { value: "REF NO", fontSize: 8, fontWeight: "bold", color: "#64748B" }),
        element("document-number", "FIELD", 78, 29.4, 14, 4, { field: "document.number", label: "Document number", fontSize: 12, fontWeight: "bold" }),
        element("table-head", "SHAPE", 8, 36, 84, 4, { background: "#0F172A", locked: true }),
        element("table-title", "TEXT", 10, 36.8, 50, 2.6, { value: "SUBJECT · DATE · TIME", fontSize: 11, fontWeight: "bold", color: "#FFFFFF" }),
        element("data-table", "TABLE", 8, 40.5, 84, 36, { field: "exam.schedule", label: "Exam schedule table", fontSize: 12 }),
        element("note", "TEXT", 8, 79, 60, 6, { value: "Students must report 30 minutes before each paper with their admit card and school ID.", fontSize: 11, color: "#334155" }),
        element("signature", "SIGNATURE", 70, 78, 16, 8, { field: "school.signPath", label: "Authorised signature" }),
        element("signature-label", "TEXT", 68, 86.4, 20, 2, { value: "Controller of examinations", fontSize: 8, align: "center", color: "#64748B" }),
        element("verify", "VERIFY_QR", 8, 86, 8, 8, { label: "Verification QR", locked: true }),
        element("footer", "FIELD", 18, 88, 70, 3, { field: "school.contact", label: "School contact", fontSize: 10, color: "#64748B" }),
      ],
    };
  }
  if (type === "SALARY_SLIP") {
    return {
      elements: [
        element("page-bg", "SHAPE", 0, 0, 100, 100, { background: "#F8FAFC", locked: true }),
        element("paper", "SHAPE", 4, 3, 92, 94, { background: "#FFFFFF", borderColor: "#CBD5E1", locked: true }),
        element("top-band", "SHAPE", 4, 3, 92, 13, { background: "#0F172A", locked: true }),
        element("accent", "SHAPE", 4, 16, 92, 1.2, { background: "#14B8A6", locked: true }),
        element("school-logo", "IMAGE", 7, 5, 8, 8, { field: "school.logoPath", label: "Logo" }),
        element("school-name", "FIELD", 17, 5.2, 52, 5, { field: "school.name", label: "School name", fontSize: 22, fontWeight: "bold", color: "#FFFFFF", locked: true }),
        element("school-address", "FIELD", 17, 10.6, 52, 2.4, { field: "school.address", label: "School address", fontSize: 10, color: "#CBD5E1" }),
        element("document-number", "FIELD", 72, 7, 20, 4, { field: "document.number", label: "Document number", fontSize: 11, fontWeight: "bold", align: "right", color: "#99F6E4" }),
        element("title", "TEXT", 8, 20, 84, 5, { value: "SALARY SLIP", fontSize: 22, fontWeight: "bold", align: "center", color: "#0F172A" }),
        element("info-card", "SHAPE", 8, 27, 84, 16, { background: "#F1F5F9", borderColor: "#E2E8F0", locked: true }),
        element("name-label", "TEXT", 10, 28.4, 20, 2, { value: "EMPLOYEE NAME", fontSize: 8, fontWeight: "bold", color: "#64748B" }),
        element("employee-name", "FIELD", 10, 30.8, 40, 4, { field: "employee.name", label: "Employee name", fontSize: 16, fontWeight: "bold" }),
        element("id-label", "TEXT", 54, 28.4, 16, 2, { value: "STAFF ID", fontSize: 8, fontWeight: "bold", color: "#64748B" }),
        element("identity", "FIELD", 54, 30.8, 16, 4, { field: "employee.employeeId", label: "Employee ID", fontSize: 14, fontWeight: "bold" }),
        element("role-label", "TEXT", 74, 28.4, 14, 2, { value: "ROLE", fontSize: 8, fontWeight: "bold", color: "#64748B" }),
        element("role", "FIELD", 74, 30.8, 16, 4, { field: "employee.role", label: "Role", fontSize: 13, fontWeight: "bold" }),
        element("period-label", "TEXT", 10, 36.4, 16, 2, { value: "PAY PERIOD", fontSize: 8, fontWeight: "bold", color: "#64748B" }),
        element("period", "FIELD", 10, 38.4, 28, 3, { field: "document.issueDate", label: "Pay period", fontSize: 13, fontWeight: "bold" }),
        element("table-title", "TEXT", 8, 46, 50, 3, { value: "EARNINGS AND DEDUCTIONS", fontSize: 12, fontWeight: "bold", color: "#0F172A" }),
        element("data-table", "TABLE", 8, 50, 84, 24, { field: "fees.lines", label: "Pay line items", fontSize: 11, background: "#0F172A" }),
        element("note", "TEXT", 8, 76, 54, 8, { value: "Amounts are taken from school payroll records for the period shown. This slip is for the employee record only.", fontSize: 11, color: "#334155" }),
        element("signature", "SIGNATURE", 64, 76, 16, 8, { field: "school.signPath", label: "Authorised signature" }),
        element("signature-label", "TEXT", 62, 85, 20, 2, { value: "Authorised signatory", fontSize: 8, align: "center", color: "#64748B" }),
        element("verify", "VERIFY_QR", 84, 76, 8, 8, { label: "Verification QR", locked: true }),
        element("footer", "FIELD", 8, 90, 84, 3, { field: "school.contact", label: "School contact", fontSize: 10, align: "center", color: "#64748B" }),
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
  if (!elements.some((item) => item.type === "VERIFY_QR")) {
    elements = [
      ...elements,
      element("verify-qr", "VERIFY_QR", 86, 78, 11, 16, { label: "Verification QR", locked: true }),
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
    pageSize: type.id === "STUDENT_ID" || type.id === "EMPLOYEE_ID" ? "CR80" : type.id === "ADMIT_CARD" ? "A5" : "A4",
    orientation: type.id === "STUDENT_ID" || type.id === "EMPLOYEE_ID" || type.id === "ADMIT_CARD" ? "LANDSCAPE" : "PORTRAIT",
    status: "DEFAULT",
    activeVersion: null,
    hasDraft: false,
    updatedAt: null,
    layout: defaultLayout(type.id),
  }));
}

export function libraryBuiltInTemplates() {
  const byId = new Map(builtInTemplates().map((row) => [row.type, row]));
  return LIBRARY_DOCUMENT_TYPE_IDS.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export async function documentStudioBundle(user: AccessUser) {
  const [templates, issued] = await Promise.all([
    prisma.documentTemplate.findMany({ include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } }),
    prisma.issuedDocument.findMany({ include: { templateVersion: { include: { template: true } } }, orderBy: { issuedAt: "desc" }, take: 100 }),
  ]);
  return {
    categories: libraryDocumentCategories(),
    types: libraryDocumentTypes(),
    fields: [...DOCUMENT_FIELDS, ...(await admissionTemplateFields())],
    defaults: libraryBuiltInTemplates(),
    verifyQrPreviewSrc: await QRCode.toDataURL(issuedQrUrl("STUDENT_ID", DESIGNER_QR_PREVIEW_URL), {
      errorCorrectionLevel: "Q",
      margin: 1,
      width: 240,
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(() => ""),
    templates: templates.filter((row) => LIBRARY_TYPE_SET.has(row.type) && !row.name.startsWith("Uploaded ")).map((row) => ({
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
      layout: withRequiredOfficialElements(row.type, upgradeLegacyFeeLayout(row.type, parseDocumentLayout(row.draftJson))),
    })),
    issued: issued.map((row) => {
      const snapshot = safeObject(row.dataJson);
      const upload = snapshot.upload && typeof snapshot.upload === "object" ? snapshot.upload as Record<string, unknown> : {};
      return {
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
        uploadLabel: typeof upload.label === "string" ? upload.label : "",
        uploadSourceType: typeof upload.sourceType === "string" ? upload.sourceType : "",
      };
    }),
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

async function schoolIdFor(user: AccessUser) {
  const hinted = String((user as AccessUser & { schoolId?: string | null }).schoolId || "").trim();
  const config = await prisma.schoolConfig.findFirst({ select: { id: true } });
  if (config?.id) return config.id;
  if (hinted) return hinted;
  if (user.orgId) return `school:${user.orgId}`;
  return DEFAULT_DOCUMENT_SCHOOL_ID;
}

function friendlyDocumentError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (/foreign key|schoolId/i.test(message)) return new Error("Could not save against this school. Refresh Document Studio and publish again.");
  if (error instanceof Error && error.message) return error;
  return new Error(fallback);
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
  const schoolId = await schoolIdFor(user);
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
  let saved;
  if (id && !id.startsWith("builtin:")) {
    const existing = await prisma.documentTemplate.findFirst({ where: { id } });
    if (!existing) throw new Error("Template not found.");
    try {
      saved = await prisma.documentTemplate.update({
        where: { id },
        data: { ...data, schoolId: existing.schoolId || schoolId, status: existing.status === "ARCHIVED" ? "DRAFT" : existing.status },
      });
    } catch (error) {
      throw friendlyDocumentError(error, "Could not save this template.");
    }
  } else {
    try {
      saved = await prisma.documentTemplate.create({ data: { ...data, createdById: user.id, status: "DRAFT" } });
    } catch (error) {
      throw friendlyDocumentError(error, "Could not save this template.");
    }
  }
  if (attachesOnSaveDocumentType(type)) {
    await activateSavedDocumentTemplate(user, saved.id);
    return prisma.documentTemplate.findUniqueOrThrow({ where: { id: saved.id } });
  }
  return saved;
}

async function activateSavedDocumentTemplate(user: AccessUser, id: string) {
  const schoolId = await schoolIdFor(user);
  const row = await prisma.documentTemplate.findFirst({ where: { id }, include: { versions: { orderBy: { version: "desc" as const }, take: 1 } } });
  if (!row) throw new Error("Template not found. Save the draft, then publish again.");
  const layout = withRequiredOfficialElements(row.type, parseDocumentLayout(row.draftJson));
  if (!layout.elements.length) throw new Error("Template is empty.");
  if (!layout.elements.some((item) => item.type === "VERIFY_QR")) throw new Error("Verification QR is required before publishing this template.");
  const version = (row.versions[0]?.version || 0) + 1;
  const layoutJson = JSON.stringify(layout);
  try {
    await prisma.$transaction([
      prisma.documentTemplate.updateMany({
        where: { type: row.type, status: "ACTIVE", id: { not: row.id } },
        data: { status: "PUBLISHED", updatedById: user.id },
      }),
      prisma.documentTemplateVersion.create({
        data: {
          schoolId,
          templateId: row.id,
          version,
          layoutJson,
          pageSize: row.pageSize,
          orientation: row.orientation,
          scopeJson: row.scopeJson,
          publishedById: user.id,
        },
      }),
      prisma.documentTemplate.update({
        where: { id: row.id },
        data: { status: "ACTIVE", activeVersion: version, draftJson: layoutJson, updatedById: user.id, schoolId },
      }),
    ]);
  } catch (error) {
    throw friendlyDocumentError(error, "Could not publish this template.");
  }
  return { id: row.id, version };
}

export async function publishDocumentTemplateCore(user: AccessUser, input: { id?: string }) {
  need(user, "documents.publish", "school.edit");
  return activateSavedDocumentTemplate(user, String(input.id || ""));
}

export async function archiveDocumentTemplateCore(user: AccessUser, input: { id?: string }) {
  need(user, "documents.publish", "school.edit");
  const id = String(input.id || "");
  const row = await prisma.documentTemplate.findFirst({ where: { id } });
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

/** On a phone the A4 page is wider than the screen: scale it to fit (printing still uses full size). */
const PHONE_FIT_SCRIPT = `<script>(function(){function fit(){var p=document.querySelector(".page"),w=p&&p.parentElement;if(!p)return;p.style.transform="";w.style.height="";var room=document.documentElement.clientWidth-16,s=Math.min(1,room/p.offsetWidth);if(s<1){p.style.transform="scale("+s+")";p.style.transformOrigin="top left";w.style.display="block";w.style.padding="8px";w.style.overflow="hidden";w.style.height=Math.ceil(p.offsetHeight*s+16)+"px";p.style.marginBottom="0"}else{w.style.display="";w.style.padding="";w.style.overflow=""}}addEventListener("resize",fit);addEventListener("load",fit);fit()})()</script>`;

/** WhatsApp button next to Download PDF: shares this page's link; #wa=<number> opens that chat directly. */
const WHATSAPP_SHARE_SCRIPT = `<script>(function(){var a=document.getElementById("wa-share");if(!a||!/^https?:$/.test(location.protocol))return;var url=location.href.split("#")[0],m=location.hash.match(/wa=(\\d{10,13})/),n=m?m[1]:"";a.href="https://wa.me/"+n+"?text="+encodeURIComponent(a.getAttribute("data-text")+" "+url);a.hidden=false})()</script>`;

const PRINT_COLOR_CSS = "-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact";
const PRINT_COLOR_CSS_IMPORTANT = "-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important";

function printFillStyle(color: string) {
  return `background-color:${color} !important;background-image:linear-gradient(${color},${color}) !important;${PRINT_COLOR_CSS};`;
}

function printFillLayer(color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none"><rect width="100" height="100" fill="${escapeHtml(color)}"/></svg>`;
}

function gradeBadgeHtml(grade: unknown) {
  const text = String(grade ?? "—");
  const g = text.toUpperCase();
  let bg = "#F1F5F9";
  let color = "#1B365D";
  if (g.startsWith("D") || g.startsWith("E") || g.startsWith("F") || g.includes("FAIL")) { bg = "#F8E8EC"; color = "#9F1239"; }
  return `<span style="position:relative;display:inline-block;overflow:hidden;padding:1px 7px;border-radius:2px;color:${color};font-weight:700;font-size:8px;letter-spacing:.04em;${printFillStyle(bg)}">${printFillLayer(bg)}<span style="position:relative;z-index:1">${escapeHtml(text)}</span></span>`;
}

function isLightColor(color: string) {
  const hex = color.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}

function tableHtml(value: unknown, label: string, headerColor = "#2563EB", total?: { label: string; value: string }) {
  if (!Array.isArray(value) || !value.length) return `<div class="empty-table">${escapeHtml(label)}</div>`;
  const rows = value.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  if (!rows.length) return `<div class="empty-table">${escapeHtml(label)}</div>`;
  const keys = Object.keys(rows[0]).slice(0, 8);
  const light = isLightColor(headerColor);
  const headText = light ? "#334155" : "#fff";
  const money = (key: string) => /amount|paid|due|total|balance/.test(key.toLowerCase());
  const table = `<table><thead><tr>${keys.map((key) => `<th class="${money(key) ? "amt" : ""}" style="position:relative;overflow:hidden;color:${headText};${printFillStyle(headerColor)}">${printFillLayer(headerColor)}<span style="position:relative;z-index:1">${escapeHtml(key.replace(/([A-Z])/g, " $1").trim())}</span></th>`).join("")}</tr></thead><tbody>${rows.map((row, index) => `<tr class="${index % 2 ? "alt" : ""}">${keys.map((key) => {
    const cell = row[key];
    const header = key.toLowerCase();
    const align = money(key) ? "amt" : /mark|max|percent|point|grade/.test(header) ? "num" : "";
    const body = /grade/.test(header) && !/point/.test(header) ? gradeBadgeHtml(cell) : escapeHtml(cell);
    const alt = index % 2 ? `position:relative;overflow:hidden;${printFillStyle("#F8FAFC")}` : "";
    return `<td class="${align}" style="${alt}">${index % 2 ? printFillLayer("#F8FAFC") : ""}<span style="position:relative;z-index:1">${body}</span></td>`;
  }).join("")}</tr>`).join("")}</tbody></table>`;
  if (!total) return table;
  return `<div class="framed-table"><div>${table}</div><div class="table-total"><span>${escapeHtml(total.label)}</span><b>${escapeHtml(total.value)}</b></div></div>`;
}

/**
 * Receipts get their own box under the fee lines. The fee-lines box keeps the space its rows need and the
 * receipts take the rest of the same slot (down to a `fees.payments` table, if the design has one).
 * With no receipts the fee-lines box fills the slot as before.
 */
function placeFeePayments(layout: DocumentLayout, data: Record<string, unknown>, pageHeight: number): DocumentLayout {
  const lines = layout.elements.find((item) => item.type === "TABLE" && item.field === "fees.lines");
  if (!lines) return layout;
  const pay = layout.elements.find((item) => item.type === "TABLE" && item.field === "fees.payments");
  const rows = (Array.isArray(atPath(data, "fees.payments")) ? (atPath(data, "fees.payments") as unknown[]) : []).filter((row) => row && typeof row === "object");
  const others = layout.elements.filter((item) => item !== lines && item !== pay && item.id !== "payments-l");
  const bottom = Math.max(lines.y + lines.height, pay && pay.y > lines.y ? pay.y + pay.height : 0);
  if (!rows.length) return { elements: [...others, { ...lines, height: bottom - lines.y }] };
  const pct = (mm: number) => (mm / pageHeight) * 100;
  const lineCount = Array.isArray(atPath(data, "fees.lines")) ? (atPath(data, "fees.lines") as unknown[]).length : 1;
  const linesNeed = pct(6.5 + Math.max(1, lineCount) * 6.6 + 8.5);
  const caption = pct(6);
  const payHead = pct(6.5);
  const payRow = pct(6);
  const room = bottom - lines.y - linesNeed - caption - payHead;
  const fit = Math.max(1, Math.min(rows.length, Math.floor(room / payRow)));
  const payHeight = payHead + fit * payRow + pct(1);
  const payY = bottom - payHeight;
  const label = layout.elements.find((item) => item.id === "table-l");
  const shownNote = rows.length > fit ? ` · LAST ${fit} OF ${rows.length}` : "";
  return {
    elements: [
      ...others,
      { ...lines, height: Math.max(pct(20), payY - caption - lines.y) },
      {
        id: "payments-l",
        type: "TEXT",
        x: lines.x,
        y: payY - pct(4.6),
        width: lines.width,
        height: pct(4),
        value: `PAYMENTS RECEIVED${shownNote}`,
        fontSize: label?.fontSize || 8,
        fontWeight: "bold",
        color: label?.color || "#64748B",
      },
      { ...(pay || lines), id: pay?.id || "payments", field: "fees.payments", label: "Payments received", x: lines.x, width: lines.width, y: payY, height: payHeight, value: String(fit) },
    ],
  };
}

/** Receipt rows: what the money was for (with the fee heads under it), what this receipt paid, what is left. */
function receiptLinesHtml(rows: Record<string, unknown>[], headerColor: string, total: string) {
  const light = isLightColor(headerColor);
  const head = (label: string, cls = "") =>
    `<th class="${cls}" style="position:relative;overflow:hidden;color:${light ? "#334155" : "#fff"};${printFillStyle(headerColor)}">${printFillLayer(headerColor)}<span style="position:relative;z-index:1">${label}</span></th>`;
  const body = rows
    .map(
      (row) =>
        `<tr><td style="padding:7px 10px"><div style="font-weight:700">${escapeHtml(row.for)}</div>${row.detail ? `<div style="margin-top:2px;font-size:8.5px;font-weight:500;color:#64748B">${escapeHtml(row.detail)}</div>` : ""}</td><td class="amt" style="width:18%">${escapeHtml(row.paidNow)}</td><td class="amt" style="width:16%;color:#64748B">${escapeHtml(row.balance)}</td></tr>`
    )
    .join("");
  const table = `<table><thead><tr>${head("For")}${head("Paid now", "amt")}${head("Balance", "amt")}</tr></thead><tbody>${body}</tbody></table>`;
  return `<div class="framed-table"><div>${table}</div><div class="table-total"><span>Total received</span><b>${escapeHtml(total)}</b></div></div>`;
}

function attendanceBarHtml(value: unknown) {
  const n = Math.max(0, Math.min(100, Number(String(value ?? "").replace("%", "")) || 0));
  const color = n >= 75 ? "#1B365D" : n >= 60 ? "#64748B" : "#9F1239";
  return `<div style="display:flex;align-items:center;gap:8px;height:100%;padding:0 2px;box-sizing:border-box">
    <div style="position:relative;flex:1;height:8px;border-radius:999px;overflow:hidden;${printFillStyle("#E2E8F0")}">${printFillLayer("#E2E8F0")}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 8" preserveAspectRatio="none" width="100%" height="8" aria-hidden="true" style="position:absolute;inset:0;width:${n}%;height:100%;display:block"><rect width="100" height="8" fill="${escapeHtml(color)}"/></svg></div>
    <span style="font-size:10px;font-weight:700;color:${color};min-width:32px">${n}%</span>
  </div>`;
}

function scoreTone(pct: number) {
  if (pct >= 75) return { bar: "#7FA88E", chipBg: "#EAF2EC", chip: "#3F6B50" };
  if (pct >= 50) return { bar: "#7E97BD", chipBg: "#EAEFF6", chip: "#3E5677" };
  if (pct >= 33) return { bar: "#CDA866", chipBg: "#F7F0E1", chip: "#7A5F2A" };
  return { bar: "#C98A82", chipBg: "#F6E9E7", chip: "#8A4A42" };
}

/** Subject rows with a score bar each, for the exam result design. */
function marksBarsHtml(value: unknown, headerColor: string, rowMm: number) {
  const rows = (Array.isArray(value) ? value : []).filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  if (!rows.length) return `<div class="empty-table">No marks yet</div>`;
  const fill = (color: string) => `${printFillStyle(color)}`;
  const body = rows.map((row, index) => {
    const subject = String(row.Subject ?? "").split(" · ").pop() || "—";
    const got = row["Marks Obtained"];
    const max = Number(row["Max Marks"]) || 0;
    const numeric = typeof got === "number" ? got : Number(got);
    const scored = Number.isFinite(numeric) && max > 0;
    const pct = scored ? Math.max(0, Math.min(100, Math.round((numeric / max) * 1000) / 10)) : 0;
    const tone = scored ? scoreTone(pct) : { bar: "#CBD5E1", chipBg: "#F1F5F9", chip: "#475569" };
    const marks = got === "Ab" ? `<span style="color:#B45309">Absent</span>` : scored ? `<b>${escapeHtml(numeric)}</b><span class="of"> / ${escapeHtml(max)}</span>` : "—";
    const grade = String(row.Grade ?? "—");
    const alt = index % 2 ? `position:relative;${fill("#FAFBFC")}` : "";
    return `<tr style="height:${rowMm}mm;${alt}">
      <td class="sub">${escapeHtml(subject)}</td>
      <td class="mk">${marks}</td>
      <td class="bar"><div class="barline"><div class="track" style="${fill("#EFF1F4")}"><div class="fill" style="width:${pct}%;${fill(tone.bar)}">${printFillLayer(tone.bar)}</div>${printFillLayer("#EFF1F4")}</div><span class="pc">${scored ? `${pct}%` : ""}</span></div></td>
      <td class="gr"><span class="chip" style="color:${tone.chip};${fill(tone.chipBg)}">${printFillLayer(tone.chipBg)}<span style="position:relative;z-index:1">${escapeHtml(grade)}</span></span></td>
    </tr>`;
  }).join("");
  const head = (text: string, cls = "") => `<th class="${cls}" style="position:relative;overflow:hidden;${fill(headerColor)}">${printFillLayer(headerColor)}<span style="position:relative;z-index:1">${text}</span></th>`;
  return `<div class="bars-table"><table><thead><tr>${head("Subject")}${head("Marks", "mk")}${head("Score", "bar")}${head("Grade", "gr")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Exam result: the marks table keeps the height its rows need and the remark block moves up under it. */
function placeExamMarks(layout: DocumentLayout, data: Record<string, unknown>, pageHeight: number): DocumentLayout {
  const table = layout.elements.find((item) => item.type === "TABLE" && item.field === "results.marks" && item.value === "bars");
  if (!table) return layout;
  const count = Math.max(1, Array.isArray(atPath(data, "results.marks")) ? (atPath(data, "results.marks") as unknown[]).length : 1);
  const pct = (mm: number) => (mm / pageHeight) * 100;
  const need = pct(8 + count * (count <= 4 ? 13 : 11) + 0.5);
  if (need >= table.height) return layout;
  const shift = table.height - need;
  const top = table.y + table.height;
  const card = layout.elements.find((item) => item.id === "remark-card");
  const scale = layout.elements.find((item) => item.id === "scale-l");
  const room = card && scale ? scale.y - 1.6 - (card.y - shift) - card.height : 0;
  const grow = card && card.y >= top ? Math.max(0, Math.min(room, 15 - card.height)) : 0;
  return {
    elements: layout.elements.map((item) => {
      if (item === table) return { ...item, height: need };
      if (item.y < top || !(item.id.startsWith("remark") || item.id.startsWith("hl-") || item.id === "teacher-remark")) return item;
      const moved = { ...item, y: item.y - shift };
      return item.id === "remark-card" ? { ...moved, height: item.height + grow } : moved;
    }),
  };
}

function promotionTone(value: unknown) {
  const text = String(value || "").toUpperCase();
  if (text.includes("FAIL")) return { color: "#9F1239", background: "#F8E8EC" };
  if (text.includes("NEED") || text.includes("HOLD") || text.includes("PENDING")) return { color: "#92400E", background: "#F8FAFC" };
  return { color: "#1B365D", background: "#F1F5F9" };
}

/* ---------------------------------------------------------------------------
 * Fee invoice + payment receipt: default design and data helpers.
 * One calm brand colour, readable sizes, amount in words, UPI pay QR,
 * status badge, and a single "Amount due / Amount received" highlight.
 * ------------------------------------------------------------------------- */

const FEE_THEME = {
  invoice: { brand: "#1E40AF", soft: "#EFF4FF", line: "#C7D7FE" },
  receipt: { brand: "#047857", soft: "#ECFDF5", line: "#A7F3D0" },
};

function feeDocumentLayout(paid: boolean): DocumentLayout {
  const t = paid ? FEE_THEME.receipt : FEE_THEME.invoice;
  const ink = "#0F172A";
  const slate = "#475569";
  const muted = "#64748B";
  const rule = "#E2E8F0";
  const panel = "#F8FAFC";
  const e = element;
  const cap = (id: string, x: number, y: number, w: number, value: string, extra: Partial<DocumentElement> = {}) =>
    e(id, "TEXT", x, y, w, 1.3, { value, fontSize: 7.5, fontWeight: "bold", color: muted, ...extra });
  const val = (id: string, x: number, y: number, w: number, field: string, name: string, extra: Partial<DocumentElement> = {}) =>
    e(id, "FIELD", x, y, w, 1.8, { field, label: name, fontSize: 10.5, fontWeight: "bold", color: ink, ...extra });
  const metaRow = (n: number, y: number, key: string, field: string, name: string) => [
    e(`meta-${n}-k`, "TEXT", 61.6, y, 14, 1.7, { value: key, fontSize: 8.5, color: slate }),
    e(`meta-${n}-v`, "FIELD", 74, y, 18.6, 1.7, { field, label: name, fontSize: 9.5, fontWeight: "bold", align: "right", color: ink }),
  ];
  const sumRow = (n: number, y: number, key: string, field: string, name: string) => [
    e(`sum-${n}-k`, "TEXT", 60, y, 18, 1.8, { value: key, fontSize: 9.5, color: slate }),
    e(`sum-${n}-v`, "FIELD", 76, y, 18, 1.8, { field, label: name, fontSize: 10.5, fontWeight: "bold", align: "right", color: ink }),
  ];
  const kv = (n: number, y: number, key: string, field: string, name: string) => [
    e(`pay-${n}-k`, "TEXT", 8, y, 13, 1.7, { value: key, fontSize: 8.5, color: slate }),
    e(`pay-${n}-v`, "FIELD", 21, y, 36, 1.7, { field, label: name, fontSize: 9.5, fontWeight: "bold", color: ink }),
  ];
  return {
    elements: [
      e("page-bg", "SHAPE", 0, 0, 100, 100, { background: "#FFFFFF", locked: true }),
      e("top-bar", "SHAPE", 0, 0, 100, 0.9, { background: t.brand, locked: true }),
      // Header: school on the left, document identity on the right.
      e("school-logo", "IMAGE", 6, 3.2, 8, 5.66, { field: "school.logoPath", label: "Logo", background: t.brand }),
      e("school-name", "FIELD", 16.5, 3.3, 43, 2.4, { field: "school.name", label: "School name", fontSize: 17, fontWeight: "bold", color: ink, locked: true }),
      e("school-address", "FIELD", 16.5, 5.9, 43, 1.5, { field: "school.address", label: "School address", fontSize: 8.5, color: slate }),
      e("school-contact", "FIELD", 16.5, 7.4, 43, 1.5, { field: "school.contact", label: "School contact", fontSize: 8.5, color: slate }),
      e("school-gstin", "FIELD", 16.5, 8.9, 43, 1.4, { field: "school.gstinLine", label: "GSTIN", fontSize: 8, color: muted }),
      e("title", "TEXT", 58, 3.1, 36, 2.7, { value: paid ? "PAYMENT RECEIPT" : "FEE INVOICE", fontSize: 19, fontWeight: "bold", align: "right", color: t.brand }),
      cap("number-l", 58, 6.2, 36, paid ? "RECEIPT NO." : "INVOICE NO.", { align: "right" }),
      e("document-number", "FIELD", 58, 7.5, 36, 1.8, { field: "document.number", label: "Document number", fontSize: 11.5, fontWeight: "bold", align: "right", color: ink }),
      e("status", "FIELD", 74, 9.7, 20, 1.9, { field: "fees.status", label: "Fee status", fontSize: 8.5, fontWeight: "bold", align: "right" }),
      e("head-rule", "LINE", 6, 12.4, 88, 0.2, { color: rule }),
      // Who it is for.
      cap("party-l", 6, 13.8, 40, paid ? "RECEIVED FROM" : "BILLED TO"),
      e("student-name", "FIELD", 6, 15.2, 50, 2.3, { field: "student.name", label: "Student name", fontSize: 15, fontWeight: "bold", color: ink }),
      cap("class-l", 6, 18.2, 12, "CLASS"),
      val("class", 6, 19.4, 12, "student.classLabel", "Class"),
      cap("adm-l", 19, 18.2, 18, "ADMISSION NO."),
      val("admission", 19, 19.4, 20, "student.admissionNo", "Admission number"),
      cap("parent-l", 6, 21.6, 22, "PARENT / GUARDIAN"),
      val("parent", 6, 22.8, 24, "student.parent", "Guardian"),
      cap("phone-l", 31, 21.6, 16, "PHONE"),
      val("phone", 31, 22.8, 20, "student.parentPhone", "Guardian phone"),
      e("meta-card", "SHAPE", 60, 13.6, 34, 11.4, { background: panel, borderColor: rule, locked: true }),
      ...(paid
        ? [
            ...metaRow(1, 14.6, "Payment date", "fees.receivedAt", "Received at"),
            ...metaRow(2, 17.1, "Mode", "fees.method", "Payment method"),
            ...metaRow(3, 19.6, "Fee term", "fees.term", "Fee term"),
            ...metaRow(4, 22.1, "Academic year", "school.academicYear", "Academic year"),
          ]
        : [
            ...metaRow(1, 14.6, "Issue date", "document.issueDate", "Issue date"),
            ...metaRow(2, 17.1, "Due date", "document.dueDate", "Due date"),
            ...metaRow(3, 19.6, "Fee term", "fees.term", "Fee term"),
            ...metaRow(4, 22.1, "Academic year", "school.academicYear", "Academic year"),
          ]),
      // Line items with the total pinned to the bottom of the box.
      cap("table-l", 6, 26.8, 40, paid ? "PAYMENT TOWARDS" : "FEE DETAILS"),
      e("data-table", "TABLE", 6, 28.4, 88, 21.4, { field: "fees.lines", label: "Fee line items", fontSize: 10, background: t.soft }),
      // Totals.
      cap("words-l", 6, 52, 46, "AMOUNT IN WORDS"),
      e("amount-words", "FIELD", 6, 53.2, 48, 4, { field: "fees.amountWords", label: "Amount in words", fontSize: 10.5, fontWeight: "bold", color: ink }),
      ...(paid
        ? [
            ...sumRow(1, 51.4, "Total fees", "fees.amount", "Amount"),
            ...sumRow(2, 53.5, "Paid earlier", "fees.paidEarlier", "Paid earlier"),
            ...sumRow(3, 55.6, "Balance due", "fees.due", "Amount due"),
          ]
        : [...sumRow(1, 51.8, "Total fees", "fees.amount", "Amount"), ...sumRow(2, 54, "Amount paid", "fees.paid", "Amount paid")]),
      e("total-box", "SHAPE", 58.4, paid ? 58.2 : 56.6, 35.6, 4.8, { background: t.brand, locked: true }),
      e("total-l", "TEXT", 60, paid ? 59.1 : 57.5, 16, 3, { value: paid ? "AMOUNT\nRECEIVED" : "AMOUNT\nDUE", fontSize: 8, fontWeight: "bold", color: "#FFFFFF" }),
      e("total", "FIELD", 72, paid ? 58.8 : 57.2, 20.4, 3.6, { field: paid ? "fees.paid" : "fees.due", label: paid ? "Amount paid" : "Amount due", fontSize: 20, fontWeight: "bold", align: "right", color: "#FFFFFF" }),
      // How to pay (invoice) or payment details (receipt).
      e("pay-card", "SHAPE", 6, 66, 88, 12.6, { background: panel, borderColor: rule, locked: true }),
      cap("pay-title", 8, 67, 40, paid ? "PAYMENT DETAILS" : "HOW TO PAY", { color: t.brand, fontSize: 8 }),
      ...(paid
        ? [
            ...kv(1, 68.8, "Mode", "fees.method", "Payment method"),
            ...kv(2, 70.8, "Reference", "fees.reference", "Payment reference"),
            ...kv(3, 72.8, "Received by", "fees.receivedBy", "Received by"),
            ...kv(4, 74.8, "Note", "fees.receivedNote", "Payment note"),
            e("thanks", "TEXT", 62, 68.6, 30, 2.2, { value: "Thank you for your payment", fontSize: 12, fontWeight: "bold", align: "right", color: t.brand }),
            e("thanks-line", "FIELD", 60, 71.2, 32, 5, { field: "fees.thanksLine", label: "Receipt summary", fontSize: 9, align: "right", color: slate }),
          ]
        : [
            ...kv(1, 68.8, "UPI ID", "fees.upiId", "UPI ID"),
            ...kv(2, 70.8, "Account name", "fees.accountName", "Account name"),
            ...kv(3, 72.8, "Account no.", "fees.accountNumber", "Account number"),
            ...kv(4, 74.8, "IFSC · Bank", "fees.ifscBank", "IFSC and bank"),
            e("pay-qr", "CUSTOM_QR", 82.6, 67.2, 9.6, 6.8, { field: "fees.payQr", label: "Pay QR" }),
            e("pay-qr-l", "TEXT", 60, 68.6, 21.6, 2, { value: "Scan to pay", fontSize: 11, fontWeight: "bold", align: "right", color: t.brand }),
            e("pay-qr-s", "FIELD", 60, 70.8, 21.6, 4.6, { field: "fees.payHint", label: "Pay hint", fontSize: 8.5, align: "right", color: slate }),
          ]),
      // Verification, stamp and signature.
      e("verify", "VERIFY_QR", 6, 81.2, 8.4, 5.94, { label: "Verification QR", locked: true }),
      e("verify-l", "TEXT", 15.6, 81.9, 28, 1.7, { value: "Scan to verify", fontSize: 9.5, fontWeight: "bold", color: ink }),
      e("verify-s", "TEXT", 15.6, 83.6, 28, 4, { value: paid ? "Scan with any phone camera to confirm this receipt is genuine." : "Scan with any phone camera to confirm this invoice is genuine.", fontSize: 8, color: slate }),
      e("stamp", "STAMP", 49, 80.6, 13, 6.6, { field: "school.stampPath", label: "School stamp" }),
      e("sign", "SIGNATURE", 68, 80.8, 26, 5.2, { field: "school.signPath", label: "Authorised signature" }),
      e("sign-line", "LINE", 68, 86.4, 26, 0.2, { color: "#CBD5E1" }),
      e("sign-l", "TEXT", 68, 86.9, 26, 1.5, { value: "Authorised signatory", fontSize: 8, align: "center", color: slate }),
      e("sign-for", "FIELD", 68, 88.4, 26, 1.5, { field: "fees.forSchool", label: "For school", fontSize: 8, fontWeight: "bold", align: "center", color: ink }),
      // Footer.
      e("footer-line", "LINE", 6, 93.6, 88, 0.2, { color: rule }),
      e("footer", "TEXT", 6, 94.3, 60, 1.5, { value: paid ? "Computer-generated receipt. Please keep it for your records." : "Computer-generated invoice. Fees once paid are subject to the school's fee policy.", fontSize: 7.5, color: muted }),
      e("footer-web", "FIELD", 66, 94.3, 28, 1.5, { field: "school.footerContact", label: "School website", fontSize: 7.5, align: "right", color: muted }),
      e("bottom-bar", "SHAPE", 0, 99.1, 100, 0.9, { background: t.brand, locked: true }),
    ],
  };
}

/** Old built-in fee designs (before the 2026-11 redesign) are swapped for the current default. */
function upgradeLegacyFeeLayout(type: string, layout: DocumentLayout): DocumentLayout {
  const ids = new Set(layout.elements.map((item) => item.id));
  if (type === "ADMIT_CARD") {
    return ids.has("header") && ids.has("sheet-l") && ids.has("centre-l") && ids.has("card-l") && !ids.has("roll-card") ? defaultLayout(type) : layout;
  }
  if (!isFeeDocumentType(type)) return layout;
  if (ids.has("bill-card") && ids.has("sum-3") && ids.has("rail") && ids.has("header")) return defaultLayout(type);
  return layout;
}

const WORD_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const WORD_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function wordsBelowHundred(n: number) {
  if (n < 20) return WORD_ONES[n];
  return `${WORD_TENS[Math.floor(n / 10)]}${n % 10 ? ` ${WORD_ONES[n % 10]}` : ""}`;
}

function wordsBelowThousand(n: number) {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  return [hundred ? `${WORD_ONES[hundred]} Hundred` : "", rest ? wordsBelowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Indian numbering: 1,23,45,678 → "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight". */
export function rupeesInWords(amount: number) {
  const n = Math.round(Math.abs(Number(amount) || 0));
  if (!n) return "Rupees Zero Only";
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts = [
    crore ? `${crore >= 100 ? wordsBelowThousand(crore) : wordsBelowHundred(crore)} Crore` : "",
    lakh ? `${wordsBelowHundred(lakh)} Lakh` : "",
    thousand ? `${wordsBelowHundred(thousand)} Thousand` : "",
    rest ? wordsBelowThousand(rest) : "",
  ].filter(Boolean);
  return `Rupees ${parts.join(" ")} Only`;
}

function moneyNumber(value: unknown) {
  if (typeof value === "number") return value;
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function niceDate(value: unknown) {
  const raw = String(value ?? "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return raw;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = `${m[3]} ${months[Number(m[2]) - 1] || m[2]} ${m[1]}`;
  return m[4] ? `${day}, ${m[4]}:${m[5]}` : day;
}

function feeStatusTone(status: string) {
  const s = status.toLowerCase();
  if (s.includes("overdue")) return { bg: "#FEE2E2", fg: "#B91C1C" };
  if (s.includes("part")) return { bg: "#FEF3C7", fg: "#B45309" };
  if (s === "paid" || s.includes("received")) return { bg: "#D1FAE5", fg: "#047857" };
  return { bg: "#E0E7FF", fg: "#3730A3" };
}

/** Fills the derived fields the fee designs use. Safe to run on preview, live and issued data. */
function feeDocumentData(type: string, data: Record<string, unknown>): Record<string, unknown> {
  const paid = type === "PAYMENT_RECEIPT";
  const obj = (key: string) => ((data[key] && typeof data[key] === "object" ? data[key] : {}) as Record<string, unknown>);
  const school = { ...obj("school") };
  const student = obj("student");
  const fees = { ...obj("fees") };
  const document = { ...obj("document") };
  const str = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");

  const address = str(school.address);
  const extra = [school.city, school.state, school.pincode].map(str).filter((part) => part && !address.includes(part));
  school.address = [address, ...extra].filter(Boolean).join(", ");
  school.contact = str(school.contact) || [str(school.phone), str(school.email)].filter(Boolean).join(" • ");
  if (!str(school.academicYear) && school.sessionStart && school.sessionEnd) {
    school.academicYear = academicYearLabel(str(school.sessionStart), str(school.sessionEnd));
  }
  school.website = str(school.website);
  school.gstinLine = str(school.gstin) ? `GSTIN ${str(school.gstin)}` : "";
  school.footerContact = school.website || str(school.email);

  const amount = moneyNumber(fees.amount);
  const paidAmount = moneyNumber(fees.paid);
  const due = moneyNumber(fees.due);
  let status = str(fees.status) || (paid ? "Paid" : due > 0 ? "Unpaid" : "Paid");
  const dueTime = Date.parse(str(document.dueDate));
  if (!paid && due > 0 && Number.isFinite(dueTime) && dueTime < Date.now() - 86400000 && !/overdue/i.test(status)) status = "Overdue";
  fees.status = status;
  fees.linesTotal = paid ? str(fees.paid) : str(fees.amount);
  fees.amountWords = rupeesInWords(paid ? paidAmount : due > 0 ? due : amount);

  const accountParts = str(fees.account).split(" · ").map((part) => part.trim()).filter(Boolean);
  fees.accountName = str(fees.accountName) || str(school.bankAccountName) || (accountParts.length >= 2 ? accountParts[0] : "");
  fees.accountNumber = str(fees.accountNumber) || str(school.bankAccountNumber) || accountParts.find((part) => /^\d{6,}$/.test(part.replace(/\s/g, ""))) || "";
  fees.ifsc = str(fees.ifsc) || str(school.bankIfsc) || accountParts.find((part) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(part)) || "";
  fees.ifscBank = [str(fees.ifsc), str(fees.bankName)].filter(Boolean).join(" · ");
  fees.upiId = str(fees.upiId) || str(school.upiId);

  const docNo = str(document.number);
  const upi = str(fees.upiId);
  if (!paid && upi && due > 0) {
    const params = new URLSearchParams({ pa: upi, pn: str(school.name).slice(0, 40), am: String(Math.round(due)), cu: "INR", tn: `Fees ${docNo}`.slice(0, 40) });
    fees.payQr = `upi://pay?${params.toString().replace(/\+/g, "%20")}`;
    fees.payHint = `Any UPI app. ${str(fees.due)} is filled in for you.`;
  } else if (!paid && due > 0 && str(fees.paymentUrl)) {
    fees.payQr = str(fees.paymentUrl);
    fees.payHint = "Opens the secure online payment page.";
  } else {
    fees.payQr = "";
    fees.payHint = due > 0 ? "Pay at the school office or with the details on the left." : "Nothing is due on this invoice.";
  }
  fees.forSchool = str(school.name) ? `For ${str(school.name)}` : "";
  fees.thanksLine = `Received ${str(fees.paid)} for ${str(student.name) || "the student"}${str(fees.term) ? ` towards ${str(fees.term)}` : ""}.${due > 0 ? ` Balance still due: ${str(fees.due)}.` : " No balance is due."}`;
  fees.receivedAt = niceDate(fees.receivedAt);
  if (paid) fees.receivedNote = str(fees.receivedNote) || "—";

  document.issueDate = niceDate(document.issueDate);
  document.dueDate = niceDate(document.dueDate);
  return { ...data, school, fees, document };
}

function feeStatusPillHtml(base: string, align: string | undefined, status: string) {
  const tone = feeStatusTone(status);
  const justify = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
  return `<div style="${base}display:flex;align-items:center;justify-content:${justify}"><span style="position:relative;display:inline-flex;align-items:center;gap:5px;overflow:hidden;padding:2px 10px;border-radius:999px;color:${tone.fg};letter-spacing:.06em;text-transform:uppercase;${printFillStyle(tone.bg)}">${printFillLayer(tone.bg)}<span style="position:relative;z-index:1;width:6px;height:6px;border-radius:50%;background:${tone.fg}"></span><span style="position:relative;z-index:1">${escapeHtml(status)}</span></span></div>`;
}

/* ---------------------------------------------------------------------------
 * Admit card (A5 landscape): default design + data normaliser.
 * ------------------------------------------------------------------------- */

function admitCardLayout(): DocumentLayout {
  const brand = "#1D4ED8";
  const soft = "#EFF4FF";
  const ink = "#0F172A";
  const slate = "#475569";
  const muted = "#64748B";
  const rule = "#E2E8F0";
  const e = element;
  const cap = (id: string, x: number, y: number, w: number, value: string, extra: Partial<DocumentElement> = {}) =>
    e(id, "TEXT", x, y, w, 2.8, { value, fontSize: 7, fontWeight: "bold", color: muted, ...extra });
  const val = (id: string, x: number, y: number, w: number, field: string, name: string, extra: Partial<DocumentElement> = {}) =>
    e(id, "FIELD", x, y, w, 3.8, { field, label: name, fontSize: 10.5, fontWeight: "bold", color: ink, ...extra });
  return {
    elements: [
      e("page-bg", "SHAPE", 0, 0, 100, 100, { background: "#FFFFFF", locked: true }),
      e("top-bar", "SHAPE", 0, 0, 100, 1.6, { background: brand, locked: true }),
      // Header.
      e("school-logo", "IMAGE", 3, 4.6, 7, 10, { field: "school.logoPath", label: "Logo", background: brand }),
      e("school-name", "FIELD", 11.6, 4.4, 50, 5.4, { field: "school.name", label: "School name", fontSize: 15, fontWeight: "bold", color: ink, locked: true }),
      e("school-address", "FIELD", 11.6, 10.2, 50, 3.4, { field: "school.address", label: "School address", fontSize: 8, color: slate }),
      e("school-contact", "FIELD", 11.6, 13.6, 50, 3.2, { field: "school.contact", label: "School contact", fontSize: 7.5, color: muted }),
      e("title", "TEXT", 60, 4.2, 37, 5.6, { value: "ADMIT CARD", fontSize: 17, fontWeight: "bold", align: "right", color: brand }),
      e("exam-name", "FIELD", 52, 10.2, 45, 3.8, { field: "exam.name", label: "Exam name", fontSize: 10.5, fontWeight: "bold", align: "right", color: ink }),
      e("session", "FIELD", 52, 14, 45, 3.2, { field: "admit.sessionLine", label: "Session", fontSize: 8, align: "right", color: slate }),
      e("head-rule", "LINE", 3, 19.6, 94, 0.3, { color: rule }),
      // Photo and candidate signature.
      e("photo-frame", "SHAPE", 3, 22.4, 13.4, 22.6, { background: "#FFFFFF", borderColor: "#CBD5E1", locked: true }),
      e("photo", "PHOTO", 3.6, 23.3, 12.2, 20.8, { field: "student.photo", label: "Photo" }),
      e("cand-sign", "SHAPE", 3, 46.2, 13.4, 5.6, { background: "#FFFFFF", borderColor: "#CBD5E1", locked: true }),
      e("cand-sign-l", "TEXT", 2, 52, 15.4, 2.6, { value: "Candidate's signature", fontSize: 6.5, align: "center", color: muted }),
      // Candidate details.
      cap("name-l", 19.4, 22.4, 30, "CANDIDATE"),
      e("student-name", "FIELD", 19.4, 25.2, 52, 6, { field: "student.name", label: "Student name", fontSize: 17, fontWeight: "bold", color: ink }),
      cap("class-l", 19.4, 32.8, 12, "CLASS"),
      val("class", 19.4, 35.4, 12, "student.classLabel", "Class"),
      cap("adm-l", 32.4, 32.8, 19, "ADMISSION NO."),
      val("admission", 32.4, 35.4, 20, "student.admissionNo", "Admission number"),
      cap("dob-l", 54, 32.8, 17, "DATE OF BIRTH"),
      val("dob", 54, 35.4, 17, "student.born", "Date of birth"),
      cap("centre-l", 19.4, 41.2, 30, "EXAM CENTRE"),
      val("centre", 19.4, 43.8, 33, "admit.centre", "Exam centre"),
      cap("report-l", 54, 41.2, 20, "REPORTING TIME"),
      val("report", 54, 43.8, 20, "admit.reporting", "Reporting time"),
      e("roll-card", "SHAPE", 75, 22.4, 22, 14.6, { background: soft, borderColor: "#C7D7FE", locked: true }),
      cap("roll-l", 76.6, 23.8, 19, "ROLL NO.", { color: brand }),
      e("roll", "FIELD", 76.6, 27, 19, 8.2, { field: "admit.rollNo", label: "Roll number", fontSize: 26, fontWeight: "bold", color: brand }),
      cap("card-l", 75, 39.2, 22, "CARD NO."),
      val("document-number", 75, 41.8, 22, "document.number", "Admit card no.", { fontSize: 8.5, fontWeight: "normal", color: slate }),
      // Date sheet with a sign column for the invigilator.
      cap("sheet-l", 3, 55, 40, "DATE SHEET", { color: brand, fontSize: 7.5 }),
      e("data-table", "TABLE", 3, 58, 94, 28.4, { field: "exam.schedule", label: "Exam schedule table", fontSize: 9, background: soft }),
      // Instructions, principal, verification.
      e("rules", "TEXT", 3, 87.6, 52, 10.8, { value: "• Carry this card and your school ID card to every paper.\n• Report at the time shown above; late entry may be refused.\n• Phones, smart watches and calculators are not allowed.\n• Valid only with the principal's signature or QR verification.", fontSize: 7, color: slate }),
      e("signature", "SIGNATURE", 58, 86.4, 20, 7.4, { field: "school.signPath", label: "Principal signature" }),
      e("sign-line", "LINE", 58, 94, 20, 0.3, { color: "#CBD5E1" }),
      e("sign-l", "FIELD", 56, 94.8, 24, 3, { field: "admit.signLine", label: "Principal", fontSize: 7.5, align: "center", color: slate }),
      e("verify-l", "TEXT", 80, 89.4, 6.4, 6, { value: "Scan to\nverify", fontSize: 7, fontWeight: "bold", align: "right", color: muted }),
      e("verify", "VERIFY_QR", 87, 85.2, 9.6, 13.7, { label: "Verification QR", locked: true }),
      e("bottom-bar", "SHAPE", 0, 99, 100, 1, { background: brand, locked: true }),
    ],
  };
}

function prettyClock(h: number, m: number) {
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function clockParts(value: string) {
  return [...value.matchAll(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/gi)].map((m) => {
    let h = Number(m[1]);
    const ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return { h, m: Number(m[2]) };
  });
}

/** Normalises exam.schedule rows to Date · Subject · Time · Invigilator sign, and fills admit.* helpers. */
function admitCardData(data: Record<string, unknown>): Record<string, unknown> {
  const obj = (key: string) => ((data[key] && typeof data[key] === "object" ? data[key] : {}) as Record<string, unknown>);
  const str = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");
  const school = { ...obj("school") };
  const student = obj("student");
  const exam = { ...obj("exam") };
  const staff = obj("staff");
  const pick = (row: Record<string, unknown>, ...names: string[]) => {
    for (const key of Object.keys(row)) if (names.includes(key.toLowerCase().replace(/[^a-z]/g, ""))) return str(row[key]);
    return "";
  };
  let earliest: number | null = null;
  const rows = (Array.isArray(exam.schedule) ? exam.schedule : []).filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  exam.schedule = rows.map((row) => {
    const rawDate = pick(row, "date", "day", "examdate");
    const parsed = Date.parse(rawDate);
    const date = Number.isFinite(parsed) && !/^[A-Za-z]{3},/.test(rawDate)
      ? (() => {
          const d = new Date(parsed);
          const utc = /^\d{4}-\d{2}-\d{2}/.test(rawDate);
          const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const [wd, dd, mm, yy] = utc ? [d.getUTCDay(), d.getUTCDate(), d.getUTCMonth(), d.getUTCFullYear()] : [d.getDay(), d.getDate(), d.getMonth(), d.getFullYear()];
          return `${days[wd]}, ${String(dd).padStart(2, "0")} ${months[mm]} ${yy}`;
        })()
      : rawDate;
    const start = pick(row, "starttime", "start");
    const end = pick(row, "endtime", "end");
    const clocks = clockParts(start || end ? `${start} ${end}` : pick(row, "time", "timing", "slot"));
    if (clocks[0]) {
      const minutes = clocks[0].h * 60 + clocks[0].m;
      earliest = earliest === null ? minutes : Math.min(earliest, minutes);
    }
    const time = clocks.length >= 2
      ? `${prettyClock(clocks[0].h, clocks[0].m)} – ${prettyClock(clocks[1].h, clocks[1].m)}`
      : clocks.length === 1 ? prettyClock(clocks[0].h, clocks[0].m) : pick(row, "time", "timing", "slot") || "—";
    return { Date: date || "—", Subject: pick(row, "subject", "paper") || "—", Time: time, "Invigilator sign": "" };
  });
  const year = str(school.academicYear) || (school.sessionStart && school.sessionEnd ? academicYearLabel(str(school.sessionStart), str(school.sessionEnd)) : "");
  const admit = {
    sessionLine: year ? `Academic session ${year}` : "",
    rollNo: str(exam.rollNo) || str(student.rollNo) || "—",
    centre: str(exam.centre) || str(school.name),
    reporting: str(exam.reportingTime) || (earliest !== null ? `${prettyClock(Math.floor(Math.max(0, earliest - 30) / 60), Math.max(0, earliest - 30) % 60)} (30 min early)` : "30 min before each paper"),
    signLine: `Principal${str(staff.principalName) && str(staff.principalName) !== "Principal" ? ` · ${str(staff.principalName)}` : str(school.signatory) && str(school.signatory) !== "Principal" ? ` · ${str(school.signatory)}` : ""}`,
  };
  school.contact = str(school.contact) || [str(school.phone), str(school.email)].filter(Boolean).join(" • ");
  return { ...data, school, exam, admit };
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
  const docType = String(atPath(data, "document.type") || "");
  const feeDoc = isFeeDocumentType(docType);
  const isPreview = verifyUrl === DESIGNER_QR_PREVIEW_URL;
  const admitDoc = docType === "ADMIT_CARD";
  if (feeDoc || admitDoc) layout = upgradeLegacyFeeLayout(docType, layout);
  if (feeDoc) data = feeDocumentData(docType, data);
  if (feeDoc) layout = placeFeePayments(layout, data, pageHeight);
  const examDoc = layout.elements.some((item) => item.type === "TABLE" && item.field === "results.marks" && item.value === "bars");
  if (examDoc) layout = placeExamMarks(layout, data, pageHeight);
  const tcDoc = docType === "TRANSFER_CERTIFICATE";
  if (tcDoc) {
    // Certificates read dates as "12 Nov 2026", not ISO.
    const issued = String(atPath(data, "document.issueDate") || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(issued)) {
      const pretty = new Date(`${issued}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
      data = { ...data, document: { ...((data.document as Record<string, unknown>) || {}), issueDate: pretty } };
    }
  }
  const designedDoc = feeDoc || admitDoc || examDoc || tcDoc;
  const docLabel = examDoc || isReportCardType(docType) ? "exam result" : docType === "PAYMENT_RECEIPT" || docType === "CONSOLIDATED_RECEIPT" ? "payment receipt" : docType === "FEE_INVOICE" ? "fee invoice" : tcDoc ? "transfer certificate" : "document";
  const studentName = String(atPath(data, "student.name") || "");
  const schoolName = String(atPath(data, "school.name") || "");
  const shareLine = `${studentName ? `${studentName}'s ` : "Your "}${docLabel}${schoolName ? ` from ${schoolName}` : ""}:`;
  if (examDoc) {
    const exam = (data.exam && typeof data.exam === "object" ? data.exam : {}) as Record<string, unknown>;
    if (!exam.session) data = { ...data, exam: { ...exam, session: atPath(data, "school.academicYear") || "" } };
    const outcome = String(atPath(data, "results.outcome") || "");
    const tint = ["#FFFFFF", "#E5E8EE"];
    const hide = new Set<string>();
    if (!atPath(data, "results.bestSubject")) ["hl-best-bg", "hl-best-bar", "hl-best-l", "hl-best"].forEach((id) => hide.add(id));
    if (!atPath(data, "results.focusSubject")) ["hl-focus-bg", "hl-focus-bar", "hl-focus-l", "hl-focus"].forEach((id) => hide.add(id));
    if (!String(atPath(data, "results.classRank") ?? "").trim()) ["rank-bg", "rank-l", "rank"].forEach((id) => hide.add(id));
    // A label with nothing under it reads as a mistake: drop both.
    for (const item of layout.elements) {
      if (item.type !== "FIELD" || !item.field?.startsWith("student.")) continue;
      if (String(atPath(data, item.field) ?? "").trim()) continue;
      hide.add(item.id);
      hide.add(`${item.id}-l`);
    }
    layout = {
      elements: layout.elements
        .filter((item) => !hide.has(item.id))
        .map((item) =>
          item.id === "outcome-bg"
            ? { ...item, background: tint[0], borderColor: tint[1] }
            : item.id === "outcome" && outcome.length > 8
              ? { ...item, fontSize: 12 }
              : item
        ),
    };
  }
  if (admitDoc) data = admitCardData(data);
  const content = (await Promise.all(layout.elements.map(async (item) => {
    const maxFont = Math.max(7, Math.round((item.height / 100) * pageHeight * 3.2));
    const fontSize = Math.min(item.fontSize || 14, maxFont);
    const base = `position:absolute;left:${item.x}%;top:${item.y}%;width:${item.width}%;height:${item.height}%;font-size:${fontSize}px;font-weight:${item.fontWeight || "normal"};text-align:${item.align || "left"};color:${item.color || "#102a43"};overflow:hidden;box-sizing:border-box;`;
    // Nothing to pay: no "Scan to pay" label next to the empty pay QR.
    if (feeDoc && item.id === "pay-qr-l" && !String(atPath(data, "fees.payQr") || "")) return "";
    if (item.type === "VERIFY_QR" || item.type === "CUSTOM_QR") {
      const studentId = String(atPath(data, "student.id") || "");
      const documentType = String(atPath(data, "document.type") || "");
      const url = item.type === "VERIFY_QR"
        ? issuedQrUrl(documentType, verifyUrl)
        : String((item.field ? atPath(data, item.field) : "") || item.value || "");
      if (!/^(https?:\/\/|upi:\/\/pay\?)/i.test(url)) return designedDoc && !isPreview ? "" : `<div style="${base}border:1px dashed #bcccdc;display:flex;align-items:center;justify-content:center">QR URL missing</div>`;
      const image = await QRCode.toDataURL(url, { errorCorrectionLevel: "Q", margin: 4, width: 320, color: { dark: "#000000", light: "#ffffff" } });
      const isIdentityQr = documentType === "STUDENT_ID" || documentType === "EMPLOYEE_ID";
      return `<img alt="${item.type === "VERIFY_QR" ? (isIdentityQr ? "Identity verification QR" : "Document verification QR") : "QR code"}" src="${image}" style="${base}object-fit:contain;background:#ffffff">`;
    }
    if (item.type === "BARCODE") {
      const value = String(atPath(data, item.field || "document.number") || atPath(data, "document.number") || "");
      const image = await barcodeBuffer({ bcid: "code128", text: value, scale: 3, height: 10, includetext: item.height >= 12, textxalign: "center" });
      return `<img alt="Barcode ${escapeHtml(value)}" src="data:image/png;base64,${image.toString("base64")}" style="${base}object-fit:contain">`;
    }
    if (item.type === "SIGNATURE" || item.type === "STAMP" || item.type === "PHOTO" || item.type === "IMAGE") {
      const field = item.field || (item.type === "SIGNATURE" ? "school.signPath" : item.type === "STAMP" ? "school.stampPath" : item.type === "IMAGE" ? "school.logoPath" : "student.photo");
      const src = await assetSrc(atPath(data, field));
      const round = item.type === "PHOTO" ? "border-radius:8px;" : item.type === "IMAGE" ? "border-radius:10px;" : "";
      if (!src && (admitDoc || tcDoc) && !isPreview && item.type === "PHOTO") {
        return `<div style="${base}border:1px dashed #94A3B8;display:flex;align-items:center;justify-content:center;text-align:center;font-size:8px;color:#64748B;padding:4px">Affix recent passport-size photograph</div>`;
      }
      if (!src && examDoc && item.type === "PHOTO") {
        const name = String(atPath(data, "student.name") || "");
        const initials = name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "S";
        const fill = item.background || "#DDE3EC";
        return `<div style="${base}border-radius:10px;display:flex;align-items:center;justify-content:center;color:#4A5D80;font-size:20px;font-weight:800;${printFillStyle(fill)}">${printFillLayer(fill)}<span style="position:relative;z-index:1">${escapeHtml(initials)}</span></div>`;
      }
      if (!src && designedDoc && item.type === "IMAGE" && item.field === "school.logoPath") {
        const name = String(atPath(data, "school.name") || "");
        const initials = name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "S";
        const fill = item.background || "#1E40AF";
        return `<div style="${base}border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:800;letter-spacing:.02em;${printFillStyle(fill)}">${printFillLayer(fill)}<span style="position:relative;z-index:1">${escapeHtml(initials)}</span></div>`;
      }
      if (!src && designedDoc && !isPreview && (item.type === "SIGNATURE" || item.type === "STAMP" || item.type === "IMAGE")) return "";
      return src ? `<img alt="${escapeHtml(item.label || item.type)}" src="${escapeHtml(src)}" style="${base}${round}object-fit:${item.type === "PHOTO" ? "cover" : "contain"}">` : `<div style="${base}${round}border:1px dashed #bcccdc;display:flex;align-items:center;justify-content:center">${escapeHtml(item.label || item.type)}</div>`;
    }
    if (item.type === "TABLE") {
      const linesTotal = feeDoc && item.field === "fees.lines" ? String(atPath(data, "fees.linesTotal") || "") : "";
      if (feeDoc && item.field === "fees.payments") {
        const rows = atPath(data, "fees.payments");
        const shown = Array.isArray(rows) ? rows.slice(-Math.max(1, Number(item.value) || rows.length)) : [];
        if (!shown.length) return "";
        return `<div style="${base}"><div class="framed-table pay-box">${tableHtml(shown, item.label || "Payments received", item.background || "#2563EB")}</div></div>`;
      }
      const tableRows = atPath(data, item.field || "");
      if (item.field === "results.marks" && item.value === "bars") {
        const rowMm = Math.max(6, Math.min(Array.isArray(tableRows) && tableRows.length <= 4 ? 13 : 11, ((item.height / 100) * pageHeight - 8) / Math.max(1, Array.isArray(tableRows) ? tableRows.length : 1)));
        return `<div style="${base}">${marksBarsHtml(tableRows, item.background || "#0F1E3D", rowMm)}</div>`;
      }
      if (feeDoc && item.field === "fees.lines" && Array.isArray(tableRows) && tableRows.some((row) => row && typeof row === "object" && "paidNow" in row)) {
        return `<div style="${base}">${receiptLinesHtml(tableRows as Record<string, unknown>[], item.background || "#2563EB", linesTotal)}</div>`;
      }
      const tableClass = admitDoc && item.field === "exam.schedule" ? `admit-table${Array.isArray(tableRows) && tableRows.length > 6 ? " tight" : ""}` : "";
      return `<div class="${tableClass}" style="${base}">${tableHtml(tableRows, item.label || "Table", item.background || "#2563EB", linesTotal ? { label: "Total", value: linesTotal } : undefined)}</div>`;
    }
    if (item.type === "LINE") {
      const lineColor = item.borderColor || item.color || "#102a43";
      return `<div style="${base}height:1px;overflow:hidden;${printFillStyle(lineColor)}">${printFillLayer(lineColor)}</div>`;
    }
    if (item.type === "SHAPE") {
      const radius = item.borderColor || (item.width < 40 && item.height < 14) ? "8px" : item.height <= 2.5 && item.width > 40 ? "0" : "0";
      const border = item.borderColor ? `border:1px solid ${item.borderColor};` : "";
      if (!item.background) return `<div style="${base}border-radius:${radius};${border}"></div>`;
      return `<div style="${base}border-radius:${radius};overflow:hidden;${border}${printFillStyle(item.background)}">${printFillLayer(item.background)}</div>`;
    }
    if (item.type === "FIELD" && item.field === "results.attendanceBar") {
      return `<div style="${base}">${attendanceBarHtml(atPath(data, "results.attendanceBar") ?? atPath(data, "results.attendancePercentage"))}</div>`;
    }
    if (item.type === "FIELD" && item.field === "fees.status" && feeDoc) {
      const status = String(atPath(data, "fees.status") || "");
      return status ? feeStatusPillHtml(base, item.align, status) : "";
    }
    const rawValue = item.type === "FIELD" ? atPath(data, item.field || "") : item.type === "PAGE_NUMBER" ? (item.value || "1") : item.value || item.label || "";
    const value = rawValue && typeof rawValue === "object" ? "" : rawValue;
    const display = item.field === "results.percentage" || item.field === "results.attendancePercentage"
      ? (String(value || "").includes("%") ? String(value || "") : value === "" || value == null ? "" : `${value}%`)
      : value;
    let color = item.color || "#102a43";
    let background = item.background;
    if (item.field === "results.outcome") {
      const text = String(display || "");
      color = text === "PASS" ? "#4F7F62" : text ? "#A6773A" : color;
    }
    if (item.field === "results.promotionStatus") {
      const tone = promotionTone(display);
      color = item.color && item.color !== "#102a43" ? item.color : tone.color;
    }
    const justify = item.align === "center" ? "center" : item.align === "right" ? "flex-end" : "flex-start";
    const wrap = item.height >= 4 ? "pre-wrap" : "nowrap";
    const fill = background ? `${printFillStyle(background)}overflow:hidden;` : "";
    return `<div style="${base}display:flex;align-items:center;justify-content:${justify};padding:0 2px;line-height:1.15;white-space:${wrap};${fill}${item.borderColor ? `border:1px solid ${item.borderColor};` : ""}color:${color}">${background ? printFillLayer(background) : ""}<span style="position:relative;z-index:1">${escapeHtml(display)}</span></div>`;
  }))).join("");
  const previewScale = pageSize === "CR80" ? 3.2 : 1;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(atPath(data, "document.number"))}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&display=swap" rel="stylesheet"><style>@page{size:${pageWidth}mm ${pageHeight}mm;margin:0}html,body,.page,table,th,td,div,span,svg{${PRINT_COLOR_CSS}}body{margin:0;background:#e8edf2;font-family:Inter,system-ui,"Segoe UI",sans-serif;color:#0f172a}.toolbar{position:sticky;top:0;z-index:2;padding:12px;text-align:center;background:#eef2f7}.page-wrap{display:flex;justify-content:center;padding:24px}.page{position:relative;flex-shrink:0;width:${pageWidth}mm;height:${pageHeight}mm;background:white;box-shadow:0 2px 18px #102a4322;overflow:hidden;transform:scale(${previewScale});transform-origin:top center;margin-bottom:${pageSize === "CR80" ? "260px" : "24px"}}table{width:100%;height:auto;border-collapse:collapse;font-size:inherit}th{color:#fff;padding:6px 8px;font-size:8px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;border:none;text-align:left}td{padding:5px 8px;border-bottom:1px solid #E2E8F0;color:#0f172a;font-weight:600;vertical-align:middle}td.num,th.num{text-align:center}td.amt,th.amt{text-align:right;font-variant-numeric:tabular-nums}.admit-table table{border:1px solid #E2E8F0}.admit-table th{padding:5px 8px;font-size:7px}.admit-table td{padding:6px 8px;border-right:1px solid #EEF2F7}.admit-table td:last-child{width:22%}.admit-table th:first-child,.admit-table td:first-child{width:24%;white-space:nowrap}.admit-table.tight td{padding:3px 8px;font-size:8px}.framed-table{display:flex;flex-direction:column;justify-content:space-between;height:100%;box-sizing:border-box;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden}.framed-table th{padding:7px 10px}.framed-table td{padding:6px 10px}.table-total{display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-top:1px solid #CBD5E1;font-size:11px;color:#0F172A;font-weight:700;font-variant-numeric:tabular-nums}.table-total b{font-size:12px}.framed-table.pay-box{justify-content:flex-start}.pay-box td{padding:4px 10px;font-weight:500;color:#334155}.pay-box tr:last-child td{border-bottom:none}.bars-table{height:100%;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;box-sizing:border-box}.bars-table table{height:auto}.bars-table th{height:8mm;padding:0 12px;font-size:8px}.bars-table td{padding:0 12px;border-bottom:1px solid #EEF2F7;font-size:12px}.bars-table tr:last-child td{border-bottom:none}.bars-table td.sub{font-weight:700;color:#0F1E3D;width:28%}.bars-table td.mk,.bars-table th.mk{width:15%;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.bars-table td.mk b{font-size:14px;color:#0F1E3D}.bars-table td.mk .of{color:#94A3B8;font-weight:600}.bars-table td.bar,.bars-table th.bar{width:46%;padding-left:20px}.bars-table .barline{display:flex;align-items:center;gap:10px}.bars-table .track{position:relative;flex:1;height:8px;border-radius:99px;overflow:hidden}.bars-table .pc{width:40px;text-align:right;color:#475569;font-variant-numeric:tabular-nums;font-size:10px;font-weight:700}.bars-table .fill{position:relative;height:100%;border-radius:99px;overflow:hidden;z-index:1}.bars-table td.gr,.bars-table th.gr{width:11%;text-align:center}.bars-table .chip{position:relative;display:inline-block;min-width:26px;padding:2px 8px;border-radius:99px;overflow:hidden;font-weight:800;font-size:10px}.empty-table{border:1px dashed #E2E8F0;border-radius:8px;padding:8px;color:#64748b;font-size:8px}.toolbar button{font:600 14px Inter,system-ui,sans-serif;padding:10px 20px;border:0;border-radius:999px;background:#1E2A44;color:#fff;cursor:pointer;box-shadow:0 1px 3px #0f172a33}.toolbar{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}.toolbar .wa{display:inline-flex;align-items:center;gap:6px;font:600 14px Inter,system-ui,sans-serif;padding:10px 18px;border-radius:999px;background:#16A34A;color:#fff;text-decoration:none;box-shadow:0 1px 3px #0f172a33}.toolbar .wa[hidden]{display:none}@media print{html,body,.page,*{${PRINT_COLOR_CSS_IMPORTANT}}body{background:white}.toolbar{display:none}.page-wrap{display:block !important;padding:0 !important;height:auto !important;overflow:visible !important}.page{margin:0;box-shadow:none;transform:none !important}}</style></head><body><div class="toolbar"><button onclick="window.print()">Download PDF</button><a id="wa-share" class="wa" target="_blank" rel="noopener" hidden data-text="${escapeHtml(shareLine)}"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 2s.8 2.3 1 2.5c.1.2 1.6 2.5 4 3.5 1.5.6 2 .7 2.8.6.4-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.3Z"/></svg>WhatsApp</a></div><div class="page-wrap"><main class="page">${content}</main></div>${pageSize === "CR80" ? "" : PHONE_FIT_SCRIPT}${WHATSAPP_SHARE_SCRIPT}</body></html>`;
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

/** The school's student admission form (its own, else the Anekio default). */
async function schoolAdmissionForm() {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { admissionFormJson: true } });
  return admissionFormFields(await configuredAdmissionFormJson(config?.admissionFormJson));
}

/** `student.photo` maps to the first image-only file field on the admission form (e.g. "Student photo"). */
function admissionPhotoField(fields: AdmissionFormField[]) {
  return fields.find((field) => field.type === "file" && !field.builtin && field.fileType === "image");
}

/** Template fields built from the school's admission form, so templates can map any answer or uploaded file. */
async function admissionTemplateFields() {
  const fields = await schoolAdmissionForm().catch(() => [] as AdmissionFormField[]);
  return fields
    .filter((field) => !field.builtin)
    .map((field) => ({ group: "Admission form", id: `admission.${field.id}`, label: field.label, ...(field.type === "file" ? { media: true } : {}) }));
}

const SAMPLE_PHOTO_SRC = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150"><rect width="120" height="150" fill="#dbe7f7"/><circle cx="60" cy="58" r="26" fill="#8aa4c8"/><path d="M14 150c4-34 24-52 46-52s42 18 46 52z" fill="#8aa4c8"/></svg>').toString("base64")}`;

/** Adds the student's admission answers as `admission.*` and fills `student.photo` from the mapped photo field. Server-side, so issued documents never depend on what the app sent. */
async function withAdmissionData(data: Record<string, unknown>, studentId: string) {
  if (!studentId) return data;
  const student = await prisma.student.findFirst({ where: { id: studentId }, select: { admissionDataJson: true } }).catch(() => null);
  if (!student) return data;
  const values = admissionCustomValues(student.admissionDataJson);
  const photoField = admissionPhotoField(await schoolAdmissionForm().catch(() => [] as AdmissionFormField[]));
  const studentIn = (data.student && typeof data.student === "object" ? data.student : {}) as Record<string, unknown>;
  return {
    ...data,
    admission: { ...((data.admission && typeof data.admission === "object" ? data.admission : {}) as Record<string, unknown>), ...values },
    student: { ...studentIn, photo: (photoField && values[photoField.id]) || studentIn.photo || "" },
  };
}

async function hydrateIssuedDocumentData(
  type: string,
  subjectType: string,
  subjectId: string,
  data: Record<string, unknown>,
  opts?: { officialOnly?: boolean }
) {
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
      rollNo: studentIn.rollNo || studentIn.rollNumber || "",
      id: studentIn.id || subjectId,
    },
    staff: {
      ...((data.staff && typeof data.staff === "object" ? data.staff : {}) as Record<string, unknown>),
      principalName: ((data.staff as Record<string, unknown> | undefined)?.principalName) || schoolIn.signatory || "Principal",
    },
  };
  if (subjectType === "STUDENT" && subjectId) next = await withAdmissionData(next, subjectId);
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
        enrollments: { where: { active: true, session: { current: true } }, select: { classId: true, rollNumber: true } },
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
          rollNo: activeRollNumber(dbStudent) || "",
          classLabel,
          className: classParts.className,
          sectionName: classParts.sectionName,
          dateOfBirth: dbStudent.dateOfBirth ? dbStudent.dateOfBirth.toISOString().slice(0, 10) : "",
          born: dbStudent.dateOfBirth ? dbStudent.dateOfBirth.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
        },
        staff: {
          classTeacherName: classTeacher?.user.name || "",
          principalName: school.signatory || "Principal",
        },
      });
      const seriesId = String(atPath(data, "exam.seriesId") || atPath(data, "seriesId") || "");
      const examId = String(atPath(data, "exam.examId") || atPath(data, "examId") || "");
      const seriesInclude = { session: true, exams: { include: { subject: true, results: true }, orderBy: { date: "asc" as const } } };
      const series = seriesId
        ? await prisma.examSeries.findFirst({ where: { id: seriesId, classId: dbStudent.classId }, include: seriesInclude })
        : examId
          ? await prisma.examSeries.findFirst({ where: { classId: dbStudent.classId, exams: { some: { id: examId } } }, include: seriesInclude })
          : await prisma.examSeries.findFirst({ where: { classId: dbStudent.classId }, orderBy: { publishedAt: "desc" }, include: seriesInclude });
      const official = Boolean(series && parentSeesOfficialSeries(series));
      const exams = series
        ? examId
          ? series.exams.filter((exam) => exam.id === examId)
          : series.exams
        : [];
      const paperReady = Boolean(
        examId &&
          exams.some((exam) => exam.workflowStatus === "PUBLISHED" || Boolean(exam.resultsPublishedAt))
      );
      const usable = official || paperReady;
      if (opts?.officialOnly && !usable) {
        throw new Error("Report card not available yet.");
      }
      if (usable && series && exams.length) {
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
          exam: {
            ...((next.exam && typeof next.exam === "object" ? next.exam : {}) as Record<string, unknown>),
            name: series.name,
            session: series.session.label,
            seriesId: series.id,
            ...(examId ? { examId } : {}),
          },
          seriesId: series.id,
          school: {
            ...((next.school as Record<string, unknown>) || {}),
            sessionTitle: `${series.session.label} · ${series.name}`,
          },
          results: built,
        });
      } else if (!opts?.officialOnly) {
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
    } else if (opts?.officialOnly) {
      throw new Error("Report card not available yet.");
    }
  } catch (error) {
    if (opts?.officialOnly && error instanceof Error && error.message === "Report card not available yet.") throw error;
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
  const type = String(input.type || "");
  let data: Record<string, unknown> = isReportCardType(type)
    ? mergeReportCardData(sampleReportCardPreviewData() as Record<string, unknown>, incoming)
    : isFeeDocumentType(type)
      ? mergeFeePreviewData(sampleFeePreviewData(type), incoming)
      : incoming;
  const previewStudentId = String(atPath(data, "student.id") || "");
  if (isReportCardType(type)) {
    if (previewStudentId) data = await hydrateIssuedDocumentData(type, "STUDENT", previewStudentId, data);
  } else if (previewStudentId) {
    data = await withAdmissionData(data, previewStudentId);
  }
  // Preview with the sample student: show a placeholder face so the layout can be judged.
  const previewStudent = (data.student && typeof data.student === "object" ? data.student : null) as Record<string, unknown> | null;
  if (previewStudent && !previewStudent.photo) data = { ...data, student: { ...previewStudent, photo: SAMPLE_PHOTO_SRC } };
  const documentIn = (data.document && typeof data.document === "object" ? data.document : {}) as Record<string, unknown>;
  data.document = {
    ...documentIn,
    type,
    number: "PREVIEW-2026-000001",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: documentIn.dueDate || "15 Apr 2026",
    verifyId: "PREVIEW",
  };
  return renderIssuedHtml(layout, data, DESIGNER_QR_PREVIEW_URL, pageSize, orientation);
}

async function resolveIssuableTemplate(user: AccessUser, templateId: string) {
  const schoolId = await schoolIdFor(user);
  const include = { versions: { orderBy: { version: "desc" as const }, take: 1 } };
  if (templateId.startsWith("builtin:")) {
    const type = templateId.slice("builtin:".length);
    const active = await prisma.documentTemplate.findFirst({
      where: { type, status: "ACTIVE" },
      include,
    });
    if (active?.versions[0]) return active;
    if (isReportCardType(type)) {
      throw new Error("Report card template required. The result is published, but no Student Report Card design has been published yet.");
    }
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
  const template = await prisma.documentTemplate.findFirst({ where: { id: templateId }, include });
  if (!template || template.status !== "ACTIVE" || !template.versions[0]) {
    throw new Error("Publish an active template before issuing documents.");
  }
  return template;
}

export async function issueDocumentCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.issue", "school.edit");
  const schoolId = await schoolIdFor(user);
  const template = await resolveIssuableTemplate(user, String(input.templateId || ""));
  const subjectType = String(input.subjectType || "CUSTOM").slice(0, 40);
  const subjectId = String(input.subjectId || "").slice(0, 120);
  if (!subjectId) throw new Error("Choose who or what this document is for.");
  if (subjectType === "STUDENT" && template.type === "ADMIT_CARD") {
    const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
    const threshold = admitCardPendingMonthsRequired(config);
    if (threshold > 0) {
      const feeStatus = await pendingFeeStatusForStudent(subjectId);
      if (feeStatus && admitCardBlocked(feeStatus.pendingMonths, threshold)) {
        throw new Error(
          `${feeStatus.student.name} has ${feeStatus.pendingMonths} unpaid fee month${feeStatus.pendingMonths === 1 ? "" : "s"}. Admit cards are blocked at ${threshold} unpaid months.`
        );
      }
    }
  }
  const now = new Date();
  const year = now.getFullYear();
  const count = await prisma.issuedDocument.count({ where: { schoolId, type: template.type, issuedAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
  const code = template.type.split("_").map((word) => word[0]).join("").slice(0, 4);
  const documentNumber = `${code}-${year}-${String(count + 1).padStart(6, "0")}`;
  const verifyToken = randomBytes(24).toString("base64url");
  const verifyUrl = `${publicOrigin()}/verify/${verifyToken}`;
  const incoming = input.data && typeof input.data === "object" ? { ...(input.data as Record<string, unknown>) } : {};
  const data = await hydrateIssuedDocumentData(template.type, subjectType, subjectId, incoming, {
    officialOnly: isReportCardType(template.type),
  });
  data.document = { ...((data.document && typeof data.document === "object") ? data.document : {}), type: template.type, number: documentNumber, issueDate: now.toISOString().slice(0, 10), verifyId: verifyToken.slice(0, 10).toUpperCase() };
  const renderedHtml = await renderIssuedHtml(parseDocumentLayout(template.versions[0].layoutJson), data, verifyUrl, template.versions[0].pageSize, template.versions[0].orientation);
  const fileHash = createHash("sha256").update(renderedHtml).digest("hex");
  const issued = await prisma.issuedDocument.create({ data: { schoolId, documentNumber, verifyToken, templateVersionId: template.versions[0].id, type: template.type, subjectType, subjectId, subjectLabel: String(input.subjectLabel || "").slice(0, 200), batchId: String(input.batchId || "").slice(0, 80) || null, supersedesId: String(input.supersedesId || "").slice(0, 120) || null, dataJson: JSON.stringify(data), renderedHtml, fileHash, issuedById: user.id, events: { create: { action: "ISSUED", actorId: user.id, metadataJson: JSON.stringify({ ...(input.batchId ? { batchId: String(input.batchId) } : {}), ...(input.supersedesId ? { supersedesId: String(input.supersedesId) } : {}) }) } } } });
  return { id: issued.id, documentNumber, verifyUrl, documentUrl: `${publicOrigin()}/documents/${verifyToken}` };
}

const STUDENT_UPLOAD_TYPES = new Set(["STUDENT_ID", "DOB_CERTIFICATE", "TRANSFER_CERTIFICATE", "CUSTOM_LETTER"]);

async function resolveUploadTemplate(user: AccessUser, type: string, schoolId: string) {
  const include = { versions: { orderBy: { version: "desc" as const }, take: 1 } };
  const active = await prisma.documentTemplate.findFirst({ where: { schoolId, type, status: "ACTIVE" }, include });
  if (active?.versions[0]) return active;
  const existing = await prisma.documentTemplate.findFirst({ where: { schoolId, type, status: "PUBLISHED", name: { startsWith: "Uploaded " } }, include });
  if (existing?.versions[0]) return existing;
  const builtin = builtInTemplates().find((row) => row.type === type || row.id === `builtin:${type}`);
  if (!builtin) throw new Error("Unknown document type.");
  return prisma.documentTemplate.create({
    data: {
      schoolId,
      type: builtin.type,
      category: builtin.category,
      name: `Uploaded ${builtin.name}`,
      description: "Register placeholder for uploaded student files.",
      pageSize: builtin.pageSize,
      orientation: builtin.orientation,
      scopeJson: "{}",
      draftJson: JSON.stringify(builtin.layout),
      createdById: user.id,
      updatedById: user.id,
      status: "PUBLISHED",
      activeVersion: 1,
      versions: {
        create: {
          schoolId,
          version: 1,
          layoutJson: JSON.stringify(builtin.layout),
          pageSize: builtin.pageSize,
          orientation: builtin.orientation,
          scopeJson: "{}",
          publishedById: user.id,
        },
      },
    },
    include,
  });
}

function uploadedDocumentHtml(input: {
  documentNumber: string;
  fileName: string;
  label: string;
  subjectLabel: string;
  token: string;
  verifyUrl: string;
}) {
  const fileUrl = `/documents/${encodeURIComponent(input.token)}/file`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.label)}</title><style>body{margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#102a43}.bar{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:16px 20px;background:#fff;border-bottom:1px solid #d9e2ec}.title{min-width:0}.title h1{margin:0;font-size:18px}.title p{margin:4px 0 0;color:#52667d;font-size:13px}.actions{display:flex;gap:10px;flex-wrap:wrap}a{color:#1d4ed8;font-weight:700;text-decoration:none}.viewer{height:calc(100vh - 75px)}iframe{width:100%;height:100%;border:0;background:#fff}.fallback{padding:24px}@media(max-width:700px){.bar{align-items:flex-start;flex-direction:column}.viewer{height:calc(100vh - 130px)}}</style></head><body><header class="bar"><div class="title"><h1>${escapeHtml(input.label)}</h1><p>${escapeHtml(input.subjectLabel || "Student")} · ${escapeHtml(input.documentNumber)} · ${escapeHtml(input.fileName)}</p></div><div class="actions"><a href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener">Open file</a><a href="${escapeHtml(input.verifyUrl)}" target="_blank" rel="noopener">Verify</a></div></header><main class="viewer"><iframe src="${escapeHtml(fileUrl)}"><p class="fallback"><a href="${escapeHtml(fileUrl)}">Open uploaded file</a></p></iframe></main></body></html>`;
}

export async function uploadStudentDocumentCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.issue", "people.edit", "school.edit");
  const rawType = String(input.type || "").trim().toUpperCase();
  const type = rawType === "OTHER" ? "CUSTOM_LETTER" : rawType;
  if (!STUDENT_UPLOAD_TYPES.has(type)) throw new Error("Choose a supported student document type.");
  const subjectId = String(input.studentId || input.subjectId || "").slice(0, 120);
  if (!subjectId) throw new Error("Choose a student.");
  const filePath = String(input.filePath || "").replace(/^\/+/, "");
  const fileName = String(input.fileName || "Uploaded document").trim().slice(0, 180) || "Uploaded document";
  resolveUploadPath(filePath);

  const schoolId = await schoolIdFor(user);
  const template = await resolveUploadTemplate(user, type, schoolId);
  const now = new Date();
  const year = now.getFullYear();
  const count = await prisma.issuedDocument.count({ where: { schoolId, type, issuedAt: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } } });
  const code = type.split("_").map((word) => word[0]).join("").slice(0, 4);
  const documentNumber = `${code}-${year}-${String(count + 1).padStart(6, "0")}`;
  const verifyToken = randomBytes(24).toString("base64url");
  const verifyUrl = `${publicOrigin()}/verify/${verifyToken}`;
  const subjectLabel = String(input.subjectLabel || "").slice(0, 200);
  const label = String(input.label || DOCUMENT_TYPES.find((row) => row.id === type)?.label || "Student document").slice(0, 120);
  const incoming = input.data && typeof input.data === "object" ? { ...(input.data as Record<string, unknown>) } : {};
  const data = await hydrateIssuedDocumentData(type, "STUDENT", subjectId, incoming);
  data.document = {
    ...((data.document && typeof data.document === "object") ? data.document : {}),
    type,
    number: documentNumber,
    issueDate: now.toISOString().slice(0, 10),
    verifyId: verifyToken.slice(0, 10).toUpperCase(),
  };
  data.upload = { filePath, fileName, label, sourceType: rawType || type };
  const renderedHtml = uploadedDocumentHtml({ documentNumber, fileName, label, subjectLabel, token: verifyToken, verifyUrl });
  const fileHash = createHash("sha256").update(`${filePath}:${fileName}`).digest("hex");
  const issued = await prisma.issuedDocument.create({
    data: {
      schoolId,
      documentNumber,
      verifyToken,
      templateVersionId: template.versions[0].id,
      type,
      subjectType: "STUDENT",
      subjectId,
      subjectLabel,
      dataJson: JSON.stringify(data),
      renderedHtml,
      fileHash,
      issuedById: user.id,
      events: { create: { action: "UPLOADED", actorId: user.id, metadataJson: JSON.stringify({ fileName, sourceType: rawType || type }) } },
    },
  });
  return { id: issued.id, documentNumber, verifyUrl, documentUrl: `${publicOrigin()}/documents/${verifyToken}` };
}

async function findActiveTemplateByTypes(types: string[], schoolId?: string) {
  for (const type of types) {
    const row = await prisma.documentTemplate.findFirst({
      where: { type, status: "ACTIVE", ...(schoolId ? { schoolId } : {}) },
      include: { versions: { orderBy: { version: "desc" as const }, take: 1 } },
      orderBy: { updatedAt: "desc" },
    });
    if (row?.versions[0]) return row;
  }
  return null;
}

async function schoolConfigForDocumentOrg(orgId?: string | null) {
  if (orgId) return prisma.schoolConfig.findFirst({ where: { orgId } });
  return prisma.schoolConfig.findUnique({ where: { id: "school" } });
}

export async function renderActiveReportCardTemplateHtml(input: {
  studentId: string;
  seriesId?: string;
  examId?: string;
}) {
  const kind = input.examId && !input.seriesId ? "paper" : "sitting";
  const preferred = pickAttachedReportCardType([...REPORT_CARD_TEMPLATE_TYPES], kind);
  const types = preferred
    ? [preferred, ...REPORT_CARD_TEMPLATE_TYPES.filter((type) => type !== preferred)]
    : [...REPORT_CARD_TEMPLATE_TYPES];
  const template = await findActiveTemplateByTypes(types);
  if (!template?.versions[0]) return null;
  const issued = await prisma.issuedDocument.findFirst({
    where: { subjectId: input.studentId, type: template.type, status: { not: "REVOKED" } },
    orderBy: { issuedAt: "desc" },
  });
  const verifyUrl = issued
    ? `${publicOrigin()}/verify/${issued.verifyToken}`
    : `${publicOrigin()}/verify/${template.id}`;
  const data = await hydrateIssuedDocumentData(
    template.type,
    "STUDENT",
    input.studentId,
    {
      exam: {
        seriesId: input.seriesId || "",
        examId: input.examId || "",
      },
      seriesId: input.seriesId || "",
      examId: input.examId || "",
    },
    { officialOnly: false }
  );
  data.document = {
    ...((data.document && typeof data.document === "object" ? data.document : {}) as Record<string, unknown>),
    type: template.type,
    number: issued?.documentNumber || `RC-${input.studentId.slice(-6).toUpperCase()}`,
    issueDate: new Date().toISOString().slice(0, 10),
    verifyId: (issued?.verifyToken || template.id).slice(0, 10).toUpperCase(),
  };
  return renderIssuedHtml(
    parseDocumentLayout(template.versions[0].layoutJson),
    data,
    verifyUrl,
    template.versions[0].pageSize,
    template.versions[0].orientation
  );
}

export async function renderActiveFeeInvoiceTemplateHtml(token: string) {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { shareToken: token },
    include: {
      student: { include: { class: true, parent: { include: { user: true } }, enrollments: { where: { active: true, session: { current: true } }, select: { classId: true, rollNumber: true } } } },
      payments: { include: { receipt: { select: { receiptNo: true, amount: true, shareToken: true } } } },
    },
  });
  if (!invoice) return null;
  const config = await schoolConfigForDocumentOrg(invoice.orgId || invoice.student.orgId);
  if (!config) return null;
  const template = await findActiveTemplateByTypes(["FEE_INVOICE"], config.id);
  if (!template?.versions[0]) return null;
  const school = schoolFromConfig(config);
  const { balance, lines: statementLines, totalBilled } = invoiceFeeStatement(invoice);
  const latestPayment = [...invoice.payments].sort((a, b) => +b.paidAt - +a.paidAt)[0];
  const paymentRows = invoicePaymentTable(invoice.payments);
  const receiptNumber = balance.paid > 0
    ? `${paymentReceiptNumber(latestPayment, invoice.id)}${paymentRows.length > 1 ? ` +${paymentRows.length - 1} more` : ""}`
    : "";
  const lines = statementLines.map((row) => ({
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
      rollNo: activeRollNumber(invoice.student) || "",
      classLabel: `${invoice.student.class.name}-${invoice.student.class.section}`,
      parent: invoice.student.parent?.user.name || "",
      parentPhone: invoice.student.parent?.phone || invoice.student.parent?.user.phone || "",
    },
    guardian: {
      name: invoice.student.parent?.user.name || "",
      phone: invoice.student.parent?.phone || invoice.student.parent?.user.phone || "",
      email: invoice.student.parent?.user.email || "",
    },
    fees: {
      lines,
      amount: formatInr(totalBilled),
      paid: formatInr(balance.paid),
      due: formatInr(balance.dueNow),
      status: balance.display === "PAID" ? "Paid" : balance.display === "OVERDUE" ? "Overdue" : balance.display === "PARTIAL" ? "Part paid" : "Unpaid",
      receiptLabel: receiptNumber ? "Receipt No." : "",
      receiptNumber,
      payments: paymentRows,
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
  const html = await renderIssuedHtml(
    parseDocumentLayout(template.versions[0].layoutJson),
    data,
    `${publicOrigin()}/i/${encodeURIComponent(token)}`,
    template.versions[0].pageSize,
    template.versions[0].orientation
  );
  const layout = parseDocumentLayout(template.versions[0].layoutJson);
  const inBox = layout.elements.some((item) => item.type === "TABLE" && (item.field === "fees.lines" || item.field === "fees.payments"));
  const received = inBox ? "" : paymentsReceivedHtml(invoice.payments, balance.dueNow);
  return received ? html.replace("</main></div></body>", `</main></div><div class="page-wrap" style="padding-top:0">${received}</div></body>`) : html;
}

function paymentReceiptNumber(payment: { reference?: string | null; receipt?: { receiptNo: string } | null } | undefined, invoiceId: string) {
  if (payment?.receipt?.receiptNo) return payment.receipt.receiptNo;
  const value = String(payment?.reference || "").trim();
  const base = value ? value.split(":")[0] || value : "";
  return (base || `RCPT-${invoiceId.slice(-8)}`).toUpperCase();
}

function paymentReceiptBase(reference: string | null | undefined) {
  return String(reference || "").trim().split(":")[0] || "";
}

function receiptTerm(rows: { title: string; period: string }[]) {
  if (!rows.length) return "";
  const months = rows.map((row) => row.period).filter((period) => /^\d{4}-\d{2}$/.test(period)).sort();
  if (months.length === rows.length) {
    const label = (period: string, withYear: boolean) =>
      new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: months.length === 1 ? "long" : "short", year: withYear ? "numeric" : undefined, timeZone: "UTC" });
    const first = months[0];
    const last = months[months.length - 1];
    if (first === last) return label(first, true);
    return first.slice(0, 4) === last.slice(0, 4) ? `${label(first, false)}–${label(last, true)}` : `${label(first, true)} – ${label(last, true)}`;
  }
  if (rows.length === 1) return rows[0].title;
  const sorted = [...rows].sort((a, b) => a.period.localeCompare(b.period) || a.title.localeCompare(b.title));
  const parsed = sorted.map((row) => row.title.split(" · ").map((part) => part.trim()));
  const commonSuffix = parsed[0]?.[1] && parsed.every((parts) => parts[1] === parsed[0][1]) ? parsed[0][1] : "";
  if (commonSuffix && parsed.every((parts) => parts[0])) return `${parsed[0][0]} to ${parsed[parsed.length - 1][0]} · ${commonSuffix}`;
  return `${sorted[0].title} to ${sorted[sorted.length - 1].title}`;
}

function receiptRowLabel(row: { title: string; period: string }) {
  if (/^\d{4}-\d{2}$/.test(row.period)) {
    return `${new Date(`${row.period}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })} fee`;
  }
  if (row.period === "OPENING") return "Previous balance";
  return row.title.split(" · ")[0] || row.title;
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

function activeRollNumber(row: { classId: string; enrollments?: { classId: string; rollNumber: number }[] }) {
  return row.enrollments?.find((enrollment) => enrollment.classId === row.classId)?.rollNumber || null;
}

/** One receipt (by its own share token) in the active receipt design; null when there is no design or it was cancelled. */
export async function renderReceiptHtmlByReceiptToken(receiptToken: string) {
  const receipt = await prisma.feeReceipt.findUnique({
    where: { shareToken: receiptToken },
    include: { allocations: { include: { invoice: { select: { shareToken: true } } }, orderBy: { paidAt: "asc" } } },
  });
  if (!receipt || receipt.status === "CANCELLED") return null;
  const invoiceToken = receipt.allocations.find((row) => row.invoice?.shareToken)?.invoice?.shareToken;
  if (!invoiceToken) return null;
  return renderActivePaymentReceiptTemplateHtml(invoiceToken, receipt.id);
}

export async function renderActivePaymentReceiptTemplateHtml(token: string, receiptIdWanted?: string) {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { shareToken: token },
    include: {
      student: { include: { class: true, parent: { include: { user: true } }, enrollments: { where: { active: true, session: { current: true } }, select: { classId: true, rollNumber: true } } } },
      payments: { include: { receipt: { select: { receiptNo: true } } } },
    },
  });
  if (!invoice) return null;
  const paidAmount = invoice.payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (paidAmount <= 0) return null;
  const config = await schoolConfigForDocumentOrg(invoice.orgId || invoice.student.orgId);
  if (!config) return null;
  const template = await findActiveTemplateByTypes(["PAYMENT_RECEIPT", "CONSOLIDATED_RECEIPT"], config.id);
  if (!template?.versions[0]) return null;
  const school = schoolFromConfig(config);
  const latestPayment = [...invoice.payments]
    .filter((payment) => !receiptIdWanted || payment.receiptId === receiptIdWanted)
    .sort((a, b) => +b.paidAt - +a.paidAt)[0];
  if (receiptIdWanted && !latestPayment) return null;
  const receiptNumber = paymentReceiptNumber(latestPayment, invoice.id);
  const receiptId = latestPayment?.receiptId || "";
  const receiptBase = receiptId ? "" : paymentReceiptBase(latestPayment?.reference);
  const noteParts = paymentNoteParts(latestPayment?.notes);
  const manualMethod = latestPayment ? ["CASH", "UPI", "BANK", "CHEQUE"].includes(String(latestPayment.method)) : false;
  const paidInvoices = receiptId
    ? (await prisma.payment.findMany({ where: { receiptId }, include: { invoice: { include: { payments: true } } }, orderBy: { paidAt: "asc" } })).map((payment) => ({
        invoice: payment.invoice,
        paid: payment.amount,
      }))
    : receiptBase
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
  const receivedAt = latestPayment?.paidAt || new Date();
  const receiptRows = paidInvoices.map((row) => {
    const statement = invoiceFeeStatement(row.invoice);
    const earlier = row.invoice.payments
      .filter((payment) => +payment.paidAt < +receivedAt && (receiptId ? payment.receiptId !== receiptId : true))
      .reduce((sum, payment) => sum + payment.amount, 0);
    return {
      invoice: row.invoice.id.slice(-8).toUpperCase(),
      title: row.invoice.title,
      period: row.invoice.period || row.invoice.id,
      paid: row.paid,
      billed: statement.totalBilled,
      earlier,
      balance: Math.max(0, statement.totalBilled - earlier - row.paid),
      heads: statement.lines.map((line) => `${line.label} ${formatInr(line.value)}`).join(", "),
    };
  });
  receiptRows.sort((a, b) => a.period.localeCompare(b.period));
  const lines = receiptRows.map((row) => ({
    for: receiptRowLabel(row),
    detail: [row.heads, `Invoice ${row.invoice}`, row.earlier > 0 ? `${formatInr(row.earlier)} paid earlier` : ""].filter(Boolean).join(" · "),
    paidNow: formatInr(row.paid),
    balance: formatInr(row.balance),
  }));
  const totalPaid = paidInvoices.reduce((sum, row) => sum + row.paid, 0);
  const data = {
    school,
    student: {
      id: invoice.student.id,
      name: invoice.student.name,
      admissionNo: invoice.student.admissionNo,
      rollNo: activeRollNumber(invoice.student) || "",
      classLabel: `${invoice.student.class.name}-${invoice.student.class.section}`,
      parent: invoice.student.parent?.user.name || "",
      parentPhone: invoice.student.parent?.phone || invoice.student.parent?.user.phone || "",
    },
    guardian: {
      name: invoice.student.parent?.user.name || "",
      phone: invoice.student.parent?.phone || invoice.student.parent?.user.phone || "",
      email: invoice.student.parent?.user.email || "",
    },
    fees: {
      lines,
      amount: formatInr(receiptRows.reduce((sum, row) => sum + row.billed, 0)),
      paidEarlier: formatInr(receiptRows.reduce((sum, row) => sum + row.earlier, 0)),
      paid: formatInr(totalPaid),
      due: formatInr(receiptRows.reduce((sum, row) => sum + row.balance, 0)),
      status: "Paid",
      receiptLabel: "Receipt No.",
      receiptNumber,
      term: receiptTerm(receiptRows) || invoice.title,
      method: paymentMethodLabel(latestPayment?.method),
      reference: (receiptId ? latestPayment?.reference : receiptBase || latestPayment?.reference) || receiptNumber,
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
    parentName: student.parent?.user.name || "",
    parentPhone: student.parent?.phone || student.parent?.user.phone || "",
    parentEmail: student.parent?.user.email || "",
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
      kind: storedNoticeKind("FEE"),
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
  const config = await prisma.schoolConfig.findUnique({
    where: { id: "school" },
  });
  const requestedBlock = Math.max(0, Math.floor(Number(input.blockIfPendingMonths) || 0));
  const requestedPaid = Math.max(0, Math.floor(Number(input.requirePaidMonths) || 0));
  const hasRequestedBlock = input.blockIfPendingMonths != null && String(input.blockIfPendingMonths).trim() !== "";
  const blockIfPendingMonths =
    resolved.type === "ADMIT_CARD"
      ? hasRequestedBlock
        ? requestedBlock
        : admitCardPendingMonthsRequired(config)
      : requestedBlock;
  const requirePaidMonths = isReportCardType(resolved.type)
    ? Math.max(reportCardFeeMonthsRequired(config), requestedPaid)
    : requestedPaid;
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
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Document batch</title><style>html,body,.page,svg{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}body{margin:0;background:#eef2f7;font-family:Arial,sans-serif}.toolbar{position:sticky;top:0;z-index:2;padding:12px;text-align:center;background:white;border-bottom:1px solid #d9e2ec}.page{position:relative;width:210mm;height:297mm;margin:18px auto;background:white;box-shadow:0 2px 18px #102a4322;overflow:hidden;break-after:page}@media print{html,body,.page,svg{-webkit-print-color-adjust:exact !important;print-color-adjust:exact !important;color-adjust:exact !important}body{background:white}.toolbar{display:none}.page{margin:0;box-shadow:none}}</style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save combined PDF</button> · ${rows.length} documents</div>${pages.map((page) => `<main class="page">${page}</main>`).join("")}</body></html>`;
}

export async function resolveStudentIdCardScanCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "attendance.mark");
  const schoolId = await schoolIdFor(user);
  const token = issuedScanTokenFromUrl(String(input.code || ""));
  if (!token) throw new Error("Scan a Student ID card QR.");
  const row = await prisma.issuedDocument.findUnique({ where: { verifyToken: token } });
  if (!row || row.type !== "STUDENT_ID" || row.subjectType !== "STUDENT") {
    throw new Error("This is not a valid Student ID card.");
  }
  if (row.schoolId !== schoolId) throw new Error("This ID card belongs to another school.");
  if (row.status !== "VALID") throw new Error("This Student ID card is no longer valid.");
  return { studentId: row.subjectId, documentNumber: row.documentNumber };
}

export async function changeIssuedDocumentStatusCore(user: AccessUser, input: Record<string, unknown>) {
  need(user, "documents.revoke", "school.edit");
  const schoolId = await schoolIdFor(user);
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
  const schoolId = await schoolIdFor(user);
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

export function uploadedIssuedDocumentFile(row: NonNullable<Awaited<ReturnType<typeof findIssuedDocument>>>) {
  const snapshot = safeObject(row.dataJson);
  const upload = snapshot.upload && typeof snapshot.upload === "object" ? snapshot.upload as Record<string, unknown> : {};
  return {
    filePath: String(upload.filePath || ""),
    fileName: String(upload.fileName || ""),
  };
}

export function verificationHtml(row: NonNullable<Awaited<ReturnType<typeof findIssuedDocument>>>) {
  const statusTone = row.status === "VALID" ? "#15803d" : row.status === "REVOKED" ? "#b91c1c" : "#92400e";
  const masked = row.subjectLabel ? `${row.subjectLabel.slice(0, 2)}${"•".repeat(Math.min(8, Math.max(2, row.subjectLabel.length - 2)))}` : "Protected";
  const snapshot = safeObject(row.dataJson);
  const school = snapshot.school && typeof snapshot.school === "object" ? snapshot.school as Record<string, unknown> : {};
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Verify ${escapeHtml(row.documentNumber)}</title><style>body{margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#102a43}.card{max-width:560px;margin:8vh auto;background:white;padding:28px;border:1px solid #d9e2ec;border-radius:14px}.status{display:inline-block;background:${statusTone}18;color:${statusTone};padding:8px 12px;border-radius:999px;font-weight:700}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:24px}.label{font-size:11px;text-transform:uppercase;color:#52667d}.value{margin-top:4px;font-weight:600}.note{margin-top:24px;padding-top:18px;border-top:1px solid #e6edf5;font-size:13px;line-height:1.5;color:#52667d}@media(max-width:600px){.card{margin:0;min-height:100vh;border:0;border-radius:0}.grid{grid-template-columns:1fr}}</style></head><body><main class="card"><div class="status">${escapeHtml(row.status)}</div><h1>${escapeHtml(row.templateVersion.template.name)}</h1><p>Issued by <strong>${escapeHtml(school.name || "the school")}</strong> through Anekio.</p><div class="grid"><div><div class="label">Document number</div><div class="value">${escapeHtml(row.documentNumber)}</div></div><div><div class="label">Issued</div><div class="value">${escapeHtml(row.issuedAt.toLocaleDateString("en-IN"))}</div></div><div><div class="label">Document type</div><div class="value">${escapeHtml(DOCUMENT_TYPES.find((item) => item.id === row.type)?.label || row.type)}</div></div><div><div class="label">Holder</div><div class="value">${escapeHtml(masked)}</div></div></div>${row.statusReason ? `<p class="note"><strong>Status note:</strong> ${escapeHtml(row.statusReason)}</p>` : ""}<p class="note">Compare these details with the printed document. Verification confirms that the school issued this record and its current status; it does not independently certify the school’s underlying data.</p></main></body></html>`;
}

export function missingIssuedScanHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Not found</title></head><body style="margin:0;font-family:Inter,Arial,sans-serif;background:#f4f7fb;color:#102a43"><main style="max-width:420px;margin:10vh auto;background:white;padding:28px;border:1px solid #d9e2ec;border-radius:16px"><p style="margin:0 0 8px;font-size:12px;letter-spacing:.16em;font-weight:700;color:#c45c26">ANEKIO</p><h1 style="margin:0 0 12px;font-size:22px">Card not found</h1><p style="margin:0;line-height:1.5;color:#52667d">This code is invalid or unavailable. Check the printed QR with the issuing school.</p></main></body></html>`;
}

export function identityScanHtml(row: NonNullable<Awaited<ReturnType<typeof findIssuedDocument>>>, kind: "STUDENT_ID" | "EMPLOYEE_ID") {
  if (!row || row.type !== kind) return missingIssuedScanHtml();
  const snapshot = safeObject(row.dataJson);
  const school = snapshot.school && typeof snapshot.school === "object" ? snapshot.school as Record<string, unknown> : {};
  const student = snapshot.student && typeof snapshot.student === "object" ? snapshot.student as Record<string, unknown> : {};
  const employee = snapshot.employee && typeof snapshot.employee === "object" ? snapshot.employee as Record<string, unknown> : {};
  const valid = row.status === "VALID";
  const name = String((kind === "STUDENT_ID" ? student.name : employee.name) || row.subjectLabel || "Verified");
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "ID";
  const classLabel = String(student.classLabel || "");
  const admission = String(student.admissionNo || "");
  const role = String(employee.role || "");
  const staffId = String(employee.employeeId || "");
  const title = kind === "STUDENT_ID" ? "Student Attendance" : "Staff identity";
  const statusLine = valid ? (kind === "STUDENT_ID" ? "Student verified" : "Staff verified") : row.status;
  const attendanceHint = kind === "STUDENT_ID" && valid
    ? "<p class=\"hint\">Attendance can be marked only by an authorised Anekio user from Attendance. Scanning this page does not change the register.</p>"
    : kind === "STUDENT_ID"
      ? `<p class="hint">${escapeHtml(row.statusReason || "This card is not valid for attendance.")}</p>`
      : "<p class=\"hint\">This confirms school identity only. It does not show payroll or punch attendance.</p>";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#f4f7fb;font-family:Inter,Arial,sans-serif;color:#102a43}.wrap{max-width:420px;margin:8vh auto;padding:16px}.brand{font-size:12px;letter-spacing:.18em;font-weight:800;color:#c45c26}.card{margin-top:16px;background:white;border:1px solid #d9e2ec;border-radius:20px;padding:28px 24px;text-align:center;box-shadow:0 10px 30px #102a4314}.avatar{width:72px;height:72px;margin:0 auto 14px;border-radius:999px;background:#ecfeff;color:#0f766e;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px}.name{margin:0;font-size:22px}.meta{margin:8px 0 0;color:#52667d}.ok{margin:18px 0 0;color:#15803d;font-weight:700}.hint{margin:18px 0 0;font-size:13px;line-height:1.5;color:#52667d;text-align:left}@media(max-width:600px){.wrap{margin:0;min-height:100vh}}</style></head><body><main class="wrap"><div class="brand">ANEKIO</div><h1 style="margin:8px 0 0;font-size:20px">${escapeHtml(title)}</h1><section class="card"><div class="avatar">${escapeHtml(initials)}</div><p class="name">${escapeHtml(name)}</p>${kind === "STUDENT_ID" ? `<p class="meta">${escapeHtml(classLabel || "Class")}</p><p class="meta">${escapeHtml(admission || "Admission")}</p>` : `<p class="meta">${escapeHtml(role || "Staff")}</p><p class="meta">${escapeHtml(staffId || "Staff ID")}</p>`}<p class="ok">${valid ? "✓ " : ""}${escapeHtml(statusLine)}</p>${attendanceHint}</section><p class="hint">Issued by ${escapeHtml(String(school.name || "the school"))}. Document ${escapeHtml(row.documentNumber)}.</p></main></body></html>`;
}
