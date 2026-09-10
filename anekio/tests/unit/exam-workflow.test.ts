import { describe, expect, it } from "vitest";
import { marksVisible } from "../../lib/exams";
import {
  ADMIN_PAPER_TABS,
  adminBucket,
  adminCanPublish,
  adminCanReview,
  canGrantMarksEntry,
  eligibleMarksTeacherIds,
  grantedEvaluatorIds,
  teacherCanEditMarks,
  teacherMayEnterMarks,
  teacherMayTakeExam,
  teacherCanTakeExam,
  teacherBucket,
  canTransitionExam,
  compareExamNearness,
  examWorkStepOrder,
} from "../../lib/exam-workflow";

const kavita = "teacher-kavita";
const other = "teacher-other";

describe("exam workflow", () => {
  it("walks the teacher through paper, take exam, then marks", () => {
    expect(teacherCanTakeExam("SCHEDULED")).toBe(true);
    expect(teacherMayTakeExam({ workflowStatus: "SCHEDULED", teacherId: kavita, paperAt: null }, kavita)).toBe(false);
    expect(teacherMayTakeExam({ workflowStatus: "SCHEDULED", teacherId: kavita, paperAt: "2026-09-01" }, kavita)).toBe(true);
    expect(teacherMayTakeExam({ workflowStatus: "SCHEDULED", teacherId: kavita, paperAt: "2026-09-01" }, other)).toBe(false);
    expect(teacherCanEditMarks("SCHEDULED")).toBe(true);
    expect(teacherCanEditMarks("IN_PROGRESS")).toBe(true);
    expect(teacherCanEditMarks("MARKS_DRAFT")).toBe(true);
    expect(teacherCanEditMarks("CORRECTION_REQUIRED")).toBe(true);
    expect(teacherCanEditMarks("SUBMITTED")).toBe(false);
    expect(teacherCanEditMarks("PUBLISHED")).toBe(false);
  });

  it("does not use exam date to allow or deny take-exam or mark entry", () => {
    const grant = { evaluatorIds: [kavita] };
    const future = { workflowStatus: "IN_PROGRESS" as const, teacherId: kavita, paperAt: "2026-09-01", examDate: "2026-09-10", ...grant };
    const today = { workflowStatus: "IN_PROGRESS" as const, teacherId: kavita, paperAt: "2026-09-01", examDate: "2026-09-04", ...grant };
    const past = { workflowStatus: "IN_PROGRESS" as const, teacherId: kavita, paperAt: "2026-09-01", examDate: "2026-09-01", ...grant };
    expect(teacherMayEnterMarks(future, kavita)).toBe(true);
    expect(teacherMayEnterMarks(today, kavita)).toBe(true);
    expect(teacherMayEnterMarks(past, kavita)).toBe(true);
    expect(
      teacherMayTakeExam({ workflowStatus: "SCHEDULED", teacherId: kavita, paperAt: "2026-08-01" }, kavita)
    ).toBe(true);
  });

  it("does not let the assigned teacher enter marks until office grants entry", () => {
    expect(teacherMayEnterMarks({ workflowStatus: "SCHEDULED", teacherId: kavita, paperAt: null }, kavita)).toBe(false);
    expect(teacherMayEnterMarks({ workflowStatus: "IN_PROGRESS", teacherId: kavita, paperAt: "2026-09-01" }, kavita)).toBe(
      false
    );
    expect(teacherMayEnterMarks({ workflowStatus: "IN_PROGRESS", teacherId: kavita, paperAt: "2026-09-01" }, other)).toBe(
      false
    );
    expect(teacherMayEnterMarks({ workflowStatus: "IN_PROGRESS", teacherId: kavita, paperAt: "2026-09-01", evaluatorIds: [kavita] }, kavita)).toBe(
      true
    );
    expect(teacherMayTakeExam({ workflowStatus: "SCHEDULED", teacherId: kavita, paperAt: "2026-09-01" }, kavita)).toBe(true);
  });

  it("lets the assigned teacher edit until submit, then follows admin publish", () => {
    expect(teacherMayEnterMarks({ workflowStatus: "MARKS_DRAFT", teacherId: kavita, paperAt: "2026-09-01", evaluatorIds: [kavita] }, kavita)).toBe(
      true
    );
    expect(teacherMayEnterMarks({ workflowStatus: "SUBMITTED", teacherId: kavita, paperAt: "2026-09-01", evaluatorIds: [kavita] }, kavita)).toBe(
      false
    );
    expect(teacherMayEnterMarks({ workflowStatus: "PUBLISHED", teacherId: kavita, paperAt: "2026-09-01", evaluatorIds: [kavita] }, kavita)).toBe(
      false
    );
    expect(marksVisible({ workflowStatus: "APPROVED" })).toBe(false);
    expect(marksVisible({ workflowStatus: "PUBLISHED" })).toBe(true);
    expect(marksVisible({ resultsPublishedAt: "2026-09-18" })).toBe(true);
  });

  it("lets extra evaluators enter marks and reopen after office sends the paper back", () => {
    const shared = {
      workflowStatus: "IN_PROGRESS" as const,
      teacherId: kavita,
      evaluatorIds: [kavita, other],
      paperAt: "2026-09-01",
    };
    expect(teacherMayEnterMarks(shared, other)).toBe(true);
    expect(teacherMayEnterMarks({ ...shared, workflowStatus: "CORRECTION_REQUIRED" }, other)).toBe(true);
    expect(teacherMayEnterMarks({ ...shared, workflowStatus: "SUBMITTED" }, other)).toBe(false);
    expect(canTransitionExam("UNDER_REVIEW", "CORRECTION_REQUIRED")).toBe(true);
    expect(canTransitionExam("APPROVED", "CORRECTION_REQUIRED")).toBe(true);
    expect(adminBucket("CORRECTION_REQUIRED")).toBe("correction");
  });

  it("only allows office to grant marks entry to teachers of that subject", () => {
    const eligible = eligibleMarksTeacherIds({
      examTeacherId: kavita,
      subjectTeacherId: kavita,
      skillTeacherIds: [kavita],
    });
    expect(eligible).toEqual([kavita]);
    expect(canGrantMarksEntry(kavita, eligible)).toBe(true);
    expect(canGrantMarksEntry(other, eligible)).toBe(false);
    expect(grantedEvaluatorIds({ teacherId: kavita, evaluators: [{ id: kavita }] })).toEqual([kavita]);
    expect(grantedEvaluatorIds({ teacherId: kavita })).toEqual([]);
  });

  it("puts the nearest exam first and keeps paper → take → marks order", () => {
    const today = "2026-09-04";
    const dates = ["2026-07-14", "2026-09-09", "2026-09-04"];
    dates.sort((a, b) => compareExamNearness(a, b, today));
    expect(dates).toEqual(["2026-09-04", "2026-09-09", "2026-07-14"]);
    expect(examWorkStepOrder("paper")).toBeLessThan(examWorkStepOrder("take"));
    expect(examWorkStepOrder("take")).toBeLessThan(examWorkStepOrder("marks"));
  });

  it("treats approved papers as ready to publish to parents", () => {
    expect(adminCanPublish("APPROVED")).toBe(true);
    expect(adminCanPublish("UNDER_REVIEW")).toBe(false);
    expect(adminCanPublish("SUBMITTED")).toBe(false);
    expect(adminCanPublish("PUBLISHED")).toBe(false);
    expect(marksVisible({ workflowStatus: "APPROVED" })).toBe(false);
    expect(marksVisible({ workflowStatus: "PUBLISHED" })).toBe(true);
  });

  it("lists office paper tabs in lifecycle order", () => {
    expect(ADMIN_PAPER_TABS.map(([id]) => id)).toEqual([
      "all",
      "scheduled",
      "awaiting",
      "correction",
      "review",
      "published",
    ]);
  });

  it("buckets admin and teacher work by status", () => {
    expect(adminBucket("SCHEDULED")).toBe("scheduled");
    expect(adminBucket("MARKS_DRAFT")).toBe("awaiting");
    expect(adminBucket("CORRECTION_REQUIRED")).toBe("correction");
    expect(adminBucket("SUBMITTED")).toBe("review");
    expect(adminBucket("APPROVED")).toBe("review");
    expect(adminCanPublish("APPROVED")).toBe(true);
    expect(adminCanReview("RESUBMITTED")).toBe(true);
    expect(canTransitionExam("CORRECTION_REQUIRED", "RESUBMITTED")).toBe(true);
    expect(canTransitionExam("RESUBMITTED", "APPROVED")).toBe(true);
    expect(adminCanPublish("SUBMITTED")).toBe(false);
    expect(teacherBucket("SCHEDULED", "2026-09-20", "2026-09-03")).toBe("draft");
    expect(teacherBucket("MARKS_DRAFT", "2026-09-03", "2026-09-03")).toBe("draft");
    expect(teacherBucket("SUBMITTED", "2026-09-03", "2026-09-03")).toBe("submitted");
    expect(canTransitionExam("SCHEDULED", "PUBLISHED")).toBe(false);
    expect(canTransitionExam("SCHEDULED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionExam("SUBMITTED", "MARKS_DRAFT")).toBe(false);
    expect(canTransitionExam("UNDER_REVIEW", "CORRECTION_REQUIRED")).toBe(true);
    expect(canTransitionExam("APPROVED", "PUBLISHED")).toBe(true);
  });
});
