import { officePaperAction, officeExamTimeline, officePaperDots, officeSittingProgress, officeSittingStatus, filterMentionTeachers } from "../exam-workflow";

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
