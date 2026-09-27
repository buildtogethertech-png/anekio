import { describe, expect, it } from "vitest";
import {
  canFinalizeSittingPapers,
  canSendResultsToParents,
  examSittingDocumentTypes,
  parentMaySeeExamResult,
  parentSeesOfficialSeries,
  sittingAllPapersPublished,
} from "../../lib/exam-marks";
import { admitCardBlocked, reportCardFeeHold } from "../../lib/fees";
import {
  LIBRARY_DOCUMENT_TYPE_IDS,
  attachesOnSaveDocumentType,
  documentModuleOwner,
  examReleaseUsesTemplate,
  isFeeDocumentType,
} from "../../lib/document-studio";

const published = { workflowStatus: "PUBLISHED" as const };
const approved = { workflowStatus: "APPROVED" as const };
const submitted = { workflowStatus: "SUBMITTED" as const };
const draft = { workflowStatus: "MARKS_DRAFT" as const };

describe("exam sitting release", () => {
  it.each([
    { name: "empty sitting", papers: [], ready: false },
    { name: "one draft", papers: [draft], ready: false },
    { name: "mixed approved and published", papers: [approved, published], ready: false },
    { name: "all approved", papers: [approved, approved], ready: false },
    { name: "one published paper", papers: [published], ready: true },
    { name: "every paper published", papers: [published, published], ready: true },
    { name: "published via timestamp", papers: [{ resultsPublishedAt: "2026-09-22" }], ready: true },
  ])("sittingAllPapersPublished: $name", ({ papers, ready }) => {
    expect(sittingAllPapersPublished(papers)).toBe(ready);
    expect(parentSeesOfficialSeries({ exams: papers })).toBe(ready);
  });

  it.each([
    { name: "no papers", papers: [], ok: false },
    { name: "still in review", papers: [submitted, approved], ok: false },
    { name: "all approved", papers: [approved, approved], ok: true },
    { name: "one left to lock", papers: [approved, published], ok: true },
    { name: "already locked", papers: [published, published], ok: false },
  ])("canFinalizeSittingPapers: $name", ({ papers, ok }) => {
    expect(canFinalizeSittingPapers(papers)).toBe(ok);
  });

  it.each([
    { name: "cannot publish without permission", papers: [published], canPublish: false, ok: false },
    { name: "cannot send while a paper is only approved", papers: [published, approved], canPublish: true, ok: false },
    { name: "sends only after every paper is published", papers: [published, published], canPublish: true, ok: true },
  ])("canSendResultsToParents: $name", ({ papers, canPublish, ok }) => {
    expect(canSendResultsToParents(papers, canPublish)).toBe(ok);
  });

  it("hides a published paper until the whole sitting is published", () => {
    expect(parentMaySeeExamResult({ workflowStatus: "PUBLISHED" })).toBe(true);
    expect(
      parentMaySeeExamResult({
        workflowStatus: "PUBLISHED",
        series: { exams: [published, approved] },
      })
    ).toBe(false);
    expect(
      parentMaySeeExamResult({
        workflowStatus: "PUBLISHED",
        series: { exams: [published, published] },
      })
    ).toBe(true);
    expect(parentMaySeeExamResult({ workflowStatus: "APPROVED", series: { exams: [published, published] } })).toBe(false);
  });
});

describe("exam documents vs fees documents", () => {
  it("issues admit cards until the sitting is fully published, then report cards", () => {
    expect(examSittingDocumentTypes(false)).toEqual(["ADMIT_CARD"]);
    expect(examSittingDocumentTypes(true)).toEqual([
      "REPORT_CARD",
      "GRADE_SHEET",
      "PROGRESS_REPORT",
      "CONSOLIDATED_REPORT",
    ]);
  });

  it.each(LIBRARY_DOCUMENT_TYPE_IDS)("maps %s to a live module", (type) => {
    const owner = documentModuleOwner(type);
    if (type === "FEE_INVOICE" || type === "PAYMENT_RECEIPT") expect(owner).toBe("fees");
    else if (type === "STUDENT_ID") expect(owner).toBe("people");
    else if (type === "EMPLOYEE_ID") expect(owner).toBe("staff");
    else if (type === "SALARY_SLIP") expect(owner).toBe("payroll");
    else if (type === "ADMISSION_CONFIRMATION") expect(owner).toBe("admissions");
    else expect(owner).toBe("exams");
  });

  it("keeps fee templates auto-attached and exam templates released from Exams", () => {
    expect(isFeeDocumentType("FEE_INVOICE")).toBe(true);
    expect(attachesOnSaveDocumentType("FEE_INVOICE")).toBe(true);
    expect(attachesOnSaveDocumentType("PAYMENT_RECEIPT")).toBe(true);
    expect(examReleaseUsesTemplate("ADMIT_CARD")).toBe(true);
    expect(examReleaseUsesTemplate("REPORT_CARD")).toBe(true);
    expect(examReleaseUsesTemplate("CONSOLIDATED_REPORT")).toBe(true);
    expect(examReleaseUsesTemplate("FEE_INVOICE")).toBe(false);
    expect(examReleaseUsesTemplate("STUDENT_ID")).toBe(false);
  });
});

describe("release fee conditions", () => {
  const unpaid = [
    { amount: 1000, dueDate: "2026-04-10", payments: [] },
    { amount: 1000, dueDate: "2026-05-10", payments: [] },
    { amount: 1000, dueDate: "2026-06-10", payments: [] },
  ];

  it("blocks admit cards once unpaid months reach the sitting rule", () => {
    expect(admitCardBlocked(0, 1)).toBe(false);
    expect(admitCardBlocked(1, 1)).toBe(true);
    expect(admitCardBlocked(2, 3)).toBe(false);
    expect(admitCardBlocked(3, 3)).toBe(true);
    expect(admitCardBlocked(4, 0)).toBe(false);
  });

  it("holds parent results when unpaid months meet the send-to-parent rule", () => {
    expect(reportCardFeeHold(unpaid, { reportCardUnpaidMonths: 0 })).toBeNull();
    expect(reportCardFeeHold(unpaid, { reportCardUnpaidMonths: 3 })?.reason).toBe("unpaid");
    expect(reportCardFeeHold(unpaid.slice(0, 2), { reportCardUnpaidMonths: 3 })).toBeNull();
  });
});
