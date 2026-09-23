import { officePaperAction, officeExamTimeline, officePaperDots, officeSittingProgress, officeSittingStatus, filterMentionTeachers, canSendResultsToParents, examSittingDocumentTypes, isHistoryImportPaper } from "../exam-workflow";

describe("office exam presentation", () => {
  it("summarises a sitting without exposing backend statuses", () => {
    expect(officeSittingStatus([])).toBe("Not scheduled");
    expect(officeSittingStatus([{ workflowStatus: "SCHEDULED" }])).toBe("Scheduled");
    expect(officeSittingStatus([{ workflowStatus: "IN_PROGRESS" }])).toBe("In progress");
    expect(officeSittingStatus([{ workflowStatus: "SUBMITTED" }])).toBe("Marks review");
    expect(officeSittingStatus([{ workflowStatus: "UNDER_REVIEW" }])).toBe("Marks review");
    expect(officeSittingStatus([{ workflowStatus: "APPROVED" }])).toBe("Ready to publish");
    expect(officeSittingStatus([{ workflowStatus: "PUBLISHED" }])).toBe("Published");
  });

  it("counts subjects that have moved past scheduled", () => {
    expect(
      officeSittingProgress([{ workflowStatus: "SCHEDULED" }, { workflowStatus: "MARKS_DRAFT" }])
    ).toEqual({ done: 1, total: 2, pct: 50 });
  });

  it("picks one primary paper action", () => {
    expect(officePaperAction("SCHEDULED", false)).toBe("Allow marks");
    expect(officePaperAction("SUBMITTED", true)).toBe("Review");
    expect(officePaperAction("APPROVED", true)).toBe("Publish");
    expect(officePaperAction("PUBLISHED", true)).toBe("View result");
  });

  it("does not keep Edit marks on a published paper that never had a question paper file", () => {
    expect(
      isHistoryImportPaper({
        paperAt: null,
        marksGrantedAt: "2026-08-01",
        entered: 10,
        workflowStatus: "PUBLISHED",
      })
    ).toBe(false);
    expect(
      isHistoryImportPaper({
        paperAt: null,
        marksGrantedAt: "2026-08-01",
        entered: 10,
        workflowStatus: "MARKS_DRAFT",
      })
    ).toBe(true);
  });

  it("only enables send-to-parents after every paper is published", () => {
    expect(canSendResultsToParents([{ workflowStatus: "APPROVED" }, { workflowStatus: "PUBLISHED" }])).toBe(false);
    expect(canSendResultsToParents([{ workflowStatus: "PUBLISHED" }, { workflowStatus: "PUBLISHED" }], false)).toBe(false);
    expect(canSendResultsToParents([{ workflowStatus: "PUBLISHED" }, { workflowStatus: "PUBLISHED" }])).toBe(true);
    expect(examSittingDocumentTypes(false)).toEqual(["ADMIT_CARD"]);
    expect(examSittingDocumentTypes(true)[0]).toBe("REPORT_CARD");
  });

  it("fills every progress dot when the paper is published", () => {
    expect(
      officePaperDots({ workflowStatus: "PUBLISHED", paperAt: "2026-09-01" })
    ).toEqual({ paper: true, exam: true, marks: true, review: true });
  });

  it("keeps later dots pending while a paper is only scheduled", () => {
    expect(officePaperDots({ workflowStatus: "SCHEDULED", paperAt: "2026-09-01" })).toEqual({
      paper: true,
      exam: false,
      marks: false,
      review: false,
    });
  });

  it("treats marks draft as past take-exam for the progress row", () => {
    expect(officePaperDots({ workflowStatus: "MARKS_DRAFT", entered: 4 }).exam).toBe(true);
    expect(officePaperDots({ workflowStatus: "IN_PROGRESS", conductedAt: "2026-09-08" }).exam).toBe(true);
  });

  it("follows the office exam timeline in process order", () => {
    const started = officeExamTimeline({
      scheduled: true,
      paper: false,
      conducted: false,
      marksGranted: false,
      marksDone: false,
      submitted: false,
      approved: false,
      published: false,
    });
    expect(
      started.map((row) => row.label)
    ).toEqual([
      "Exam scheduled",
      "Question paper",
      "Exam conducted",
      "Marks entry allowed",
      "Marks entered",
      "Submitted to office",
      "Approved",
      "Papers published",
      "Released to parents",
    ]);
    expect(started.find((row) => row.label === "Question paper")?.kind).toBe("now");
    expect(started.find((row) => row.label === "Exam conducted")?.kind).toBe("wait");
    expect(started.find((row) => row.label === "Released to parents")?.kind).toBe("wait");

    const ready = officeExamTimeline({
      scheduled: true,
      paper: true,
      conducted: true,
      marksGranted: true,
      marksDone: true,
      submitted: true,
      approved: true,
      published: false,
    });
    expect(ready.find((row) => row.label === "Papers published")?.kind).toBe("now");
    expect(ready.find((row) => row.label === "Released to parents")?.kind).toBe("wait");

    const locked = officeExamTimeline({
      scheduled: true,
      paper: true,
      conducted: true,
      marksGranted: true,
      marksDone: true,
      submitted: true,
      approved: true,
      published: true,
      released: false,
    });
    expect(locked.find((row) => row.label === "Papers published")?.kind).toBe("done");
    expect(locked.find((row) => row.label === "Released to parents")?.kind).toBe("now");

    const sent = officeExamTimeline({
      scheduled: true,
      paper: true,
      conducted: true,
      marksGranted: true,
      marksDone: true,
      submitted: true,
      approved: true,
      published: true,
      released: true,
    });
    expect(sent.every((row) => row.kind === "done")).toBe(true);
  });

  it("filters @ teacher mentions to ungranted names", () => {
    const people = [
      { id: "a", name: "Kavita Joshi" },
      { id: "b", name: "Asha Rao" },
      { id: "c", name: "Rohan Mehta" },
    ];
    expect(filterMentionTeachers("@kav", people, ["b"]).map((row) => row.name)).toEqual(["Kavita Joshi"]);
    expect(filterMentionTeachers("", people, ["a"]).map((row) => row.id)).toEqual(["b", "c"]);
  });
});
