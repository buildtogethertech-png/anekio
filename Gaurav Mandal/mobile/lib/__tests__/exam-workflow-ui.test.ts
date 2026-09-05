import { officePaperAction, officeSittingProgress, officeSittingStatus } from "../exam-workflow";

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
});
