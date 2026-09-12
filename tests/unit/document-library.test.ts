import { describe, expect, it } from "vitest";
import {
  LIBRARY_DOCUMENT_TYPE_IDS,
  defaultLayout,
  libraryBuiltInTemplates,
  libraryDocumentCategories,
  libraryDocumentTypes,
  pickAttachedReportCardType,
  attachedZoneForDocumentType,
} from "../../lib/document-studio";

describe("document studio library", () => {
  it("exposes exactly the ten office templates in the requested order", () => {
    expect([...LIBRARY_DOCUMENT_TYPE_IDS]).toEqual([
      "STUDENT_ID",
      "EMPLOYEE_ID",
      "ADMIT_CARD",
      "FEE_INVOICE",
      "PAYMENT_RECEIPT",
      "REPORT_CARD",
      "ADMISSION_CONFIRMATION",
      "EXAM_DATE_SHEET",
      "CONSOLIDATED_REPORT",
      "SALARY_SLIP",
    ]);
    expect(libraryDocumentTypes().map((row) => row.id)).toEqual([...LIBRARY_DOCUMENT_TYPE_IDS]);
    expect(libraryBuiltInTemplates().map((row) => row.type)).toEqual([...LIBRARY_DOCUMENT_TYPE_IDS]);
    expect(libraryDocumentCategories().map((row) => row.id)).toEqual(["STUDENT", "ACADEMIC", "FEES", "EMPLOYEE"]);
  });

  it("keeps ID cards as landscape CR80 with a large verification QR", () => {
    for (const type of ["STUDENT_ID", "EMPLOYEE_ID"] as const) {
      const row = libraryBuiltInTemplates().find((item) => item.type === type);
      expect(row?.pageSize).toBe("CR80");
      expect(row?.orientation).toBe("LANDSCAPE");
      const qr = defaultLayout(type).elements.find((item) => item.type === "VERIFY_QR");
      expect(qr?.width).toBeGreaterThanOrEqual(16);
      expect(defaultLayout(type).elements.some((item) => item.type === "BARCODE")).toBe(true);
      expect(defaultLayout(type).elements.some((item) => item.type === "PHOTO")).toBe(true);
      const name = defaultLayout(type).elements.find((item) => item.field === (type === "STUDENT_ID" ? "student.name" : "employee.name"));
      expect(name?.fontSize).toBeGreaterThanOrEqual(16);
    }
  });

  it("gives A4 templates readable titles and a verification QR", () => {
    for (const type of LIBRARY_DOCUMENT_TYPE_IDS.filter((id) => id !== "STUDENT_ID" && id !== "EMPLOYEE_ID" && id !== "ADMIT_CARD")) {
      const layout = defaultLayout(type);
      expect(layout.elements.some((item) => item.type === "VERIFY_QR")).toBe(true);
      const title = layout.elements.find((item) => item.id === "title");
      expect(title?.fontSize || 0).toBeGreaterThanOrEqual(14);
    }
  });

  it("keeps every report-card field and a display-size title", () => {
    const layout = defaultLayout("REPORT_CARD");
    const fields = layout.elements.map((item) => item.field).filter(Boolean);
    expect(fields).toEqual(expect.arrayContaining([
      "school.name",
      "school.address",
      "school.contact",
      "school.academicYear",
      "school.sessionTitle",
      "document.number",
      "student.name",
      "student.admissionNo",
      "student.className",
      "student.sectionName",
      "student.rollNo",
      "student.born",
      "student.id",
      "results.marks",
      "results.totalMarks",
      "results.marksObtained",
      "results.percentage",
      "results.overallGrade",
      "results.attendancePercentage",
      "results.classRank",
      "results.workingDays",
      "results.daysPresent",
      "results.daysAbsent",
      "results.attendanceBar",
      "results.activities",
      "results.teacherRemark",
      "results.promotionStatus",
      "results.nextClass",
      "staff.classTeacherName",
      "staff.principalName",
      "school.website",
    ]));
    expect(layout.elements.find((item) => item.id === "title")?.fontSize).toBeGreaterThanOrEqual(16);
    expect(layout.elements.find((item) => item.field === "student.name")?.fontSize).toBeGreaterThanOrEqual(16);
  });

  it("makes fee invoice and payment receipt show billing and payment details", () => {
    const invoice = defaultLayout("FEE_INVOICE").elements.map((item) => item.field).filter(Boolean);
    expect(invoice).toEqual(expect.arrayContaining([
      "student.name",
      "student.classLabel",
      "student.admissionNo",
      "student.parent",
      "student.parentPhone",
      "document.issueDate",
      "document.dueDate",
      "fees.term",
      "fees.status",
      "fees.lines",
      "fees.amount",
      "fees.paid",
      "fees.due",
      "fees.upiId",
      "fees.bankName",
      "fees.account",
    ]));
    const receipt = defaultLayout("PAYMENT_RECEIPT").elements.map((item) => item.field).filter(Boolean);
    expect(receipt).toEqual(expect.arrayContaining([
      "fees.method",
      "fees.reference",
      "fees.receivedBy",
      "fees.receivedAt",
      "fees.receivedNote",
      "fees.paid",
      "fees.lines",
    ]));
    expect(defaultLayout("FEE_INVOICE").elements.find((item) => item.id === "title")?.fontSize).toBeGreaterThanOrEqual(16);
    expect(defaultLayout("FEE_INVOICE").elements.find((item) => item.id === "page-bg")?.background).toBe("#FFFFFF");
    expect(defaultLayout("PAYMENT_RECEIPT").elements.find((item) => item.field === "fees.method")).toBeTruthy();
  });

  it("prints the student admit card on A5 as a compact hall ticket", () => {
    const row = libraryBuiltInTemplates().find((item) => item.type === "ADMIT_CARD");
    expect(row?.pageSize).toBe("A5");
    expect(row?.orientation).toBe("LANDSCAPE");
    const layout = defaultLayout("ADMIT_CARD");
    expect(layout.elements.length).toBeLessThan(32);
    const fields = layout.elements.map((item) => item.field).filter(Boolean);
    expect(fields).toEqual(expect.arrayContaining([
      "school.name",
      "exam.name",
      "student.name",
      "student.classLabel",
      "student.rollNo",
      "student.admissionNo",
      "student.born",
      "exam.schedule",
      "document.number",
    ]));
    expect(layout.elements.some((item) => item.type === "PHOTO")).toBe(true);
    expect(layout.elements.some((item) => item.type === "VERIFY_QR")).toBe(true);
    expect(layout.elements.find((item) => item.id === "title")?.fontSize).toBeGreaterThanOrEqual(14);
  });

  it("keeps navy fills on the report card so print matches the screen design", () => {
    const layout = defaultLayout("REPORT_CARD");
    expect(layout.elements.find((item) => item.id === "header-a")?.background).toBe("#1B365D");
    expect(layout.elements.find((item) => item.id === "title-bg")?.background).toBe("#1B365D");
    expect(layout.elements.find((item) => item.id === "acad-head")?.background).toBe("#1B365D");
    expect(layout.elements.find((item) => item.id === "sum-grade")?.background).toBe("#1B365D");
  });

  it("attaches each published library template to its live zone", () => {
    expect(attachedZoneForDocumentType("FEE_INVOICE")).toBe("Fees invoices and parent pay links");
    expect(attachedZoneForDocumentType("PAYMENT_RECEIPT")).toBe("Fees payment receipts");
    expect(attachedZoneForDocumentType("STUDENT_ID")).toBe("People · student ID cards");
    expect(attachedZoneForDocumentType("SALARY_SLIP")).toBe("Staff payroll salary slips");
    expect(attachedZoneForDocumentType("ADMIT_CARD")).toBe("Exams · admit cards");
    expect(attachedZoneForDocumentType("REPORT_CARD")).toBe("Examination downloads and Exams");
  });

  it("attaches the published report-card family template to sitting and paper downloads", () => {
    expect(pickAttachedReportCardType(["REPORT_CARD"], "sitting")).toBe("REPORT_CARD");
    expect(pickAttachedReportCardType(["CONSOLIDATED_REPORT"], "sitting")).toBe("CONSOLIDATED_REPORT");
    expect(pickAttachedReportCardType(["GRADE_SHEET", "REPORT_CARD"], "paper")).toBe("GRADE_SHEET");
    expect(pickAttachedReportCardType(["FEE_INVOICE"], "sitting")).toBeNull();
  });
});
