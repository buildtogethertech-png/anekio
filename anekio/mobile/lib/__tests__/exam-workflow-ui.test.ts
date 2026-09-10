import {
  adminBucket,
  adminCanPublish,
  adminCanReview,
  officePaperAction,
  officeExamTimeline,
  officePaperDots,
  officePaperLabel,
  officePaperPulse,
  officePaperTone,
  officeSittingProgress,
  officeSittingStatus,
  officeSubmitted,
  filterMentionTeachers,
  teacherCanEditMarks,
  teacherCanTakeExam,
} from "../exam-workflow";
import { examTodoKind } from "../../components/exam-teacher-work";

const STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "MARKS_DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "CORRECTION_REQUIRED",
  "RESUBMITTED",
  "APPROVED",
  "PUBLISHED",
] as const;

function boardTimeline(status: (typeof STATUSES)[number]) {
  return officeExamTimeline({
    scheduled: true,
    paper: true,
    conducted: true,
    marksGranted: true,
    marksDone: true,
    submitted: officeSubmitted(status),
    correction: status === "CORRECTION_REQUIRED",
    approved: status === "APPROVED" || status === "PUBLISHED",
    published: status === "PUBLISHED",
  });
}

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
    expect(started.map((row) => row.label)).toEqual([
      "Exam scheduled",
      "Question paper",
      "Exam conducted",
      "Marks entry allowed",
      "Marks entered",
      "Submitted to office",
      "Approved",
      "Published to parents",
    ]);
    expect(started.find((row) => row.label === "Question paper")?.kind).toBe("now");
    expect(started.find((row) => row.label === "Exam conducted")?.kind).toBe("wait");

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
    expect(ready.find((row) => row.label === "Published to parents")?.kind).toBe("now");
  });

  it("keeps approval progress after office returns marks for correction", () => {
    const fromReview = officeExamTimeline({
      scheduled: true,
      paper: true,
      conducted: true,
      marksGranted: true,
      marksDone: true,
      submitted: false,
      approved: false,
      published: false,
      correction: true,
    });
    expect(fromReview.find((row) => row.label === "Submitted to office")?.kind).toBe("done");
    expect(fromReview.find((row) => row.label === "Returned for correction")?.kind).toBe("now");
    expect(fromReview.find((row) => row.label === "Approved")?.kind).toBe("wait");
    expect(fromReview.find((row) => row.label === "Published to parents")?.kind).toBe("wait");

    const fromApproved = officeExamTimeline({
      scheduled: true,
      paper: true,
      conducted: true,
      marksGranted: true,
      marksDone: true,
      submitted: true,
      approved: true,
      published: false,
      correction: true,
    });
    expect(fromApproved.find((row) => row.label === "Approved")?.kind).toBe("wait");
    expect(fromApproved.find((row) => row.label === "Returned for correction")?.kind).toBe("now");
    expect(fromApproved.find((row) => row.label === "Published to parents")?.kind).toBe("wait");
    expect(officePaperDots({ workflowStatus: "CORRECTION_REQUIRED", paperAt: "2026-09-01", entered: 10 }).review).toBe(
      true
    );
    expect(officeSubmitted("CORRECTION_REQUIRED")).toBe(true);
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

describe("exam module permutations", () => {
  it("maps every status to one office action, label, tone, bucket, and teacher gate", () => {
    const actionGranted: Record<(typeof STATUSES)[number], string> = {
      SCHEDULED: "View",
      IN_PROGRESS: "View",
      MARKS_DRAFT: "View",
      SUBMITTED: "Review",
      UNDER_REVIEW: "Review",
      CORRECTION_REQUIRED: "View issue",
      RESUBMITTED: "Review",
      APPROVED: "Publish",
      PUBLISHED: "View result",
    };
    const label: Record<(typeof STATUSES)[number], string> = {
      SCHEDULED: "Scheduled",
      IN_PROGRESS: "Marks in progress",
      MARKS_DRAFT: "Marks in progress",
      SUBMITTED: "Submitted",
      UNDER_REVIEW: "Submitted",
      CORRECTION_REQUIRED: "Returned for correction",
      RESUBMITTED: "Submitted",
      APPROVED: "Ready to publish",
      PUBLISHED: "Published",
    };
    for (const status of STATUSES) {
      expect(officePaperAction(status, true)).toBe(actionGranted[status]);
      expect(officePaperLabel(status)).toBe(label[status]);
      expect(officePaperTone(status)).toBeTruthy();
      expect(adminBucket(status)).toBeTruthy();
      expect(teacherCanTakeExam(status)).toBe(status === "SCHEDULED");
      expect(teacherCanEditMarks(status)).toBe(
        status === "SCHEDULED" ||
          status === "IN_PROGRESS" ||
          status === "MARKS_DRAFT" ||
          status === "CORRECTION_REQUIRED"
      );
      expect(adminCanReview(status)).toBe(
        status === "SUBMITTED" || status === "UNDER_REVIEW" || status === "RESUBMITTED"
      );
      expect(adminCanPublish(status)).toBe(status === "APPROVED");
    }
    expect(officePaperAction("SCHEDULED", false)).toBe("Allow marks");
    expect(officePaperPulse("CORRECTION_REQUIRED")).toBe(false);
    expect(officePaperPulse("SUBMITTED")).toBe(true);
  });

  it("keeps the approval timeline consistent for every post-submit status", () => {
    for (const status of ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"] as const) {
      const rows = boardTimeline(status);
      expect(rows.find((row) => row.label === "Submitted to office")?.kind).toBe("done");
      expect(rows.find((row) => row.label === "Approved")?.kind).toBe("now");
      expect(rows.find((row) => row.label === "Returned for correction")).toBeUndefined();
    }
    const correction = boardTimeline("CORRECTION_REQUIRED");
    expect(correction.find((row) => row.label === "Submitted to office")?.kind).toBe("done");
    expect(correction.find((row) => row.label === "Returned for correction")?.kind).toBe("now");
    expect(correction.find((row) => row.label === "Approved")?.kind).toBe("wait");
    const approved = boardTimeline("APPROVED");
    expect(approved.find((row) => row.label === "Approved")?.kind).toBe("done");
    expect(approved.find((row) => row.label === "Published to parents")?.kind).toBe("now");
    const published = boardTimeline("PUBLISHED");
    expect(published.every((row) => row.kind === "done")).toBe(true);
  });

  it("summarises mixed sittings: scheduled+published, correction+approved, all published", () => {
    expect(
      officeSittingStatus([{ workflowStatus: "SCHEDULED" }, { workflowStatus: "PUBLISHED" }])
    ).toBe("Scheduled");
    expect(
      officeSittingStatus([{ workflowStatus: "CORRECTION_REQUIRED" }, { workflowStatus: "APPROVED" }])
    ).toBe("Marks review");
    expect(
      officeSittingStatus([{ workflowStatus: "APPROVED" }, { workflowStatus: "PUBLISHED" }])
    ).toBe("Ready to publish");
    expect(
      officeSittingStatus([{ workflowStatus: "PUBLISHED" }, { workflowStatus: "PUBLISHED" }])
    ).toBe("Published");
    expect(
      officeSittingStatus([{ workflowStatus: "MARKS_DRAFT" }, { workflowStatus: "SCHEDULED" }])
    ).toBe("In progress");
    expect(officeSittingProgress([{ workflowStatus: "PUBLISHED" }, { workflowStatus: "SCHEDULED" }])).toEqual({
      done: 1,
      total: 2,
      pct: 50,
    });
  });

  it("classifies teacher todos: paper ready, take exam, marks, copies skipped", () => {
    const row = { hint: "" };
    expect(examTodoKind({ ...row, id: "paper-1", title: "Set English paper", kind: "paper" })).toBe("paper");
    expect(examTodoKind({ ...row, id: "take-1", title: "Take exam", kind: "take" })).toBe("take");
    expect(examTodoKind({ ...row, id: "marks-1", title: "Enter marks", kind: "marks" })).toBe("marks");
    expect(examTodoKind({ ...row, id: "x", title: "Correct marks · English" })).toBe("marks");
    expect(examTodoKind({ ...row, id: "copies-1", title: "Upload copies", kind: "copies" })).toBe("skip");
  });
});
