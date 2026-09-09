import { describe, expect, it } from "vitest";
import {
  parentSeesOfficialSeries,
  sheetCellState,
  subjectCompletion,
  teacherAssignedToPaper,
  validateExamMark,
} from "../../lib/exam-marks";
import { examLocked, marksVisible, studentSeriesScore } from "../../lib/exams";
import {
  EXAM_WORKFLOW,
  adminBucket,
  adminCanPublish,
  adminCanReview,
  canGrantMarksEntry,
  canTransitionExam,
  eligibleMarksTeacherIds,
  grantedEvaluatorIds,
  isExamWorkflowStatus,
  marksEntryGranted,
  teacherBucket,
  teacherCanEditMarks,
  teacherCanTakeExam,
  teacherMayEnterMarks,
  teacherMayTakeExam,
  workflowLabel,
  type ExamWorkflowStatus,
} from "../../lib/exam-workflow";

const kavita = "teacher-kavita";
const other = "teacher-other";

/** Product graph: every allowed next status, including self. */
const ALLOWED_NEXT: Record<ExamWorkflowStatus, ExamWorkflowStatus[]> = {
  SCHEDULED: ["SCHEDULED", "IN_PROGRESS", "MARKS_DRAFT", "SUBMITTED"],
  IN_PROGRESS: ["IN_PROGRESS", "MARKS_DRAFT", "SUBMITTED"],
  MARKS_DRAFT: ["MARKS_DRAFT", "SUBMITTED"],
  SUBMITTED: ["SUBMITTED", "UNDER_REVIEW", "CORRECTION_REQUIRED", "APPROVED"],
  UNDER_REVIEW: ["UNDER_REVIEW", "CORRECTION_REQUIRED", "APPROVED"],
  CORRECTION_REQUIRED: ["CORRECTION_REQUIRED", "MARKS_DRAFT", "SUBMITTED", "RESUBMITTED"],
  RESUBMITTED: ["RESUBMITTED", "UNDER_REVIEW", "CORRECTION_REQUIRED", "APPROVED"],
  APPROVED: ["APPROVED", "PUBLISHED", "CORRECTION_REQUIRED"],
  PUBLISHED: ["PUBLISHED"],
};

const EDITABLE = new Set<ExamWorkflowStatus>(["SCHEDULED", "IN_PROGRESS", "MARKS_DRAFT", "CORRECTION_REQUIRED"]);
const REVIEWABLE = new Set<ExamWorkflowStatus>(["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"]);
const PARENT_SEES = new Set<ExamWorkflowStatus>(["PUBLISHED"]);
const LOCKED = new Set<ExamWorkflowStatus>(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "PUBLISHED"]);

function granted(status: ExamWorkflowStatus) {
  return {
    workflowStatus: status,
    teacherId: kavita,
    paperAt: "2026-09-01",
    evaluatorIds: [kavita],
  };
}

describe("exam module matrix", () => {
  it("recognises every workflow status and rejects junk", () => {
    for (const status of EXAM_WORKFLOW) expect(isExamWorkflowStatus(status)).toBe(true);
    expect(isExamWorkflowStatus("DRAFT")).toBe(false);
    expect(isExamWorkflowStatus("")).toBe(false);
    expect(isExamWorkflowStatus(null)).toBe(false);
  });

  it("allows only the documented transitions for every from × to pair", () => {
    for (const from of EXAM_WORKFLOW) {
      for (const to of EXAM_WORKFLOW) {
        expect(canTransitionExam(from, to), `${from} → ${to}`).toBe(ALLOWED_NEXT[from].includes(to));
      }
    }
    expect(canTransitionExam("SCHEDULED", "PUBLISHED")).toBe(false);
    expect(canTransitionExam("PUBLISHED", "CORRECTION_REQUIRED")).toBe(false);
    expect(canTransitionExam("MARKS_DRAFT", "APPROVED")).toBe(false);
    expect(canTransitionExam("nope", "SCHEDULED")).toBe(false);
  });

  it("covers teacher take, marks, office review, publish, parent visibility, and lock for every status", () => {
    for (const status of EXAM_WORKFLOW) {
      const exam = granted(status);
      expect(teacherCanTakeExam(status), `take gate ${status}`).toBe(status === "SCHEDULED");
      expect(teacherMayTakeExam(exam, kavita), `take ${status}`).toBe(status === "SCHEDULED");
      expect(teacherMayTakeExam(exam, other), `other take ${status}`).toBe(false);
      expect(teacherMayTakeExam({ ...exam, paperAt: null }, kavita), `take without paper ${status}`).toBe(false);

      expect(teacherCanEditMarks(status), `edit ${status}`).toBe(EDITABLE.has(status));
      expect(teacherMayEnterMarks(exam, kavita), `enter ${status}`).toBe(EDITABLE.has(status));
      expect(teacherMayEnterMarks(exam, other), `other enter ${status}`).toBe(false);
      expect(teacherMayEnterMarks({ ...exam, evaluatorIds: [] }, kavita), `ungranted ${status}`).toBe(false);

      expect(adminCanReview(status), `review ${status}`).toBe(REVIEWABLE.has(status));
      expect(adminCanPublish(status), `publish ${status}`).toBe(status === "APPROVED");
      expect(marksVisible({ workflowStatus: status }), `parent marks ${status}`).toBe(PARENT_SEES.has(status));
      expect(parentSeesOfficialSeries({ exams: [{ workflowStatus: status }] }), `parent series ${status}`).toBe(
        PARENT_SEES.has(status)
      );
      expect(examLocked({ workflowStatus: status }), `locked ${status}`).toBe(LOCKED.has(status));
    }
  });

  it("buckets every status for office and teacher lists", () => {
    const admin: Record<ExamWorkflowStatus, ReturnType<typeof adminBucket>> = {
      SCHEDULED: "scheduled",
      IN_PROGRESS: "awaiting",
      MARKS_DRAFT: "awaiting",
      SUBMITTED: "review",
      UNDER_REVIEW: "review",
      CORRECTION_REQUIRED: "correction",
      RESUBMITTED: "review",
      APPROVED: "review",
      PUBLISHED: "published",
    };
    const teacher: Record<ExamWorkflowStatus, ReturnType<typeof teacherBucket>> = {
      SCHEDULED: "draft",
      IN_PROGRESS: "draft",
      MARKS_DRAFT: "draft",
      SUBMITTED: "submitted",
      UNDER_REVIEW: "submitted",
      CORRECTION_REQUIRED: "draft",
      RESUBMITTED: "submitted",
      APPROVED: "submitted",
      PUBLISHED: "submitted",
    };
    for (const status of EXAM_WORKFLOW) {
      expect(adminBucket(status), `admin ${status}`).toBe(admin[status]);
      expect(teacherBucket(status, "2026-09-20", "2026-09-03"), `teacher ${status}`).toBe(teacher[status]);
      expect(workflowLabel(status)).toBeTruthy();
    }
  });

  it("walks the happy office path and the correction loops", () => {
    const happy: ExamWorkflowStatus[] = [
      "SCHEDULED",
      "IN_PROGRESS",
      "MARKS_DRAFT",
      "SUBMITTED",
      "UNDER_REVIEW",
      "APPROVED",
      "PUBLISHED",
    ];
    for (let i = 0; i < happy.length - 1; i += 1) {
      expect(canTransitionExam(happy[i], happy[i + 1]), `${happy[i]} → ${happy[i + 1]}`).toBe(true);
    }
    expect(canTransitionExam("SUBMITTED", "APPROVED")).toBe(true);
    expect(canTransitionExam("SUBMITTED", "CORRECTION_REQUIRED")).toBe(true);
    expect(canTransitionExam("UNDER_REVIEW", "CORRECTION_REQUIRED")).toBe(true);
    expect(canTransitionExam("RESUBMITTED", "CORRECTION_REQUIRED")).toBe(true);
    expect(canTransitionExam("APPROVED", "CORRECTION_REQUIRED")).toBe(true);
    expect(canTransitionExam("CORRECTION_REQUIRED", "RESUBMITTED")).toBe(true);
    expect(canTransitionExam("CORRECTION_REQUIRED", "SUBMITTED")).toBe(true);
    expect(canTransitionExam("CORRECTION_REQUIRED", "MARKS_DRAFT")).toBe(true);
  });

  it("grants marks only to subject teachers, including extra evaluators", () => {
    const eligible = eligibleMarksTeacherIds({
      examTeacherId: kavita,
      subjectTeacherId: kavita,
      skillTeacherIds: [other],
    });
    expect(eligible.sort()).toEqual([kavita, other].sort());
    expect(canGrantMarksEntry(kavita, eligible)).toBe(true);
    expect(canGrantMarksEntry(other, eligible)).toBe(true);
    expect(canGrantMarksEntry("stranger", eligible)).toBe(false);
    expect(grantedEvaluatorIds({ teacherId: kavita })).toEqual([]);
    expect(grantedEvaluatorIds({ teacherId: kavita, marksGrantedAt: "2026-09-01" })).toEqual([kavita]);
    expect(grantedEvaluatorIds({ teacherId: kavita, evaluatorIds: [other] })).toEqual([other]);
    expect(marksEntryGranted({ teacherId: kavita, evaluatorIds: [kavita] })).toBe(true);
    expect(teacherAssignedToPaper({ teacherId: kavita }, kavita)).toBe(true);
    expect(teacherAssignedToPaper({ teacherId: kavita, evaluatorIds: [other] }, other)).toBe(true);
    expect(teacherAssignedToPaper({ teacherId: kavita }, other)).toBe(false);
  });

  it("validates marks for empty, zero, max, over, negative, and absent-style numbers", () => {
    expect(() => validateExamMark(0, 40)).not.toThrow();
    expect(() => validateExamMark(40, 40)).not.toThrow();
    expect(() => validateExamMark(20.5, 40)).not.toThrow();
    expect(() => validateExamMark(-0.1, 40)).toThrow(/negative/);
    expect(() => validateExamMark(40.01, 40)).toThrow(/exceed/);
    expect(() => validateExamMark(Number.NaN, 40)).toThrow(/number/);
  });

  it("renders a sheet cell for every status × mark shape", () => {
    const mark = { marks: 18 };
    const absent = { marks: 0, absent: true as const };
    const corr = { marks: 12, correctionRequested: true as const };
    for (const status of EXAM_WORKFLOW) {
      expect(sheetCellState({ workflowStatus: status }).kind).toBe("pending");
      expect(sheetCellState({ workflowStatus: status, mark: corr }).label).toBe("CORR");
      const numbered = sheetCellState({ workflowStatus: status, mark });
      if (status === "PUBLISHED") expect(numbered.label).toBe("✓ 18");
      else if (status === "APPROVED") expect(numbered.label).toBe("✓ 18");
      else expect(numbered.label).toBe("18");
      const ab = sheetCellState({ workflowStatus: status, mark: absent });
      if (status === "PUBLISHED" || status === "APPROVED") expect(ab.label).toBe("✓ Ab");
      else expect(ab.label).toBe("Ab");
    }
  });

  it("scores a mixed series: missing, absent, and published papers stay isolated", () => {
    const policy = {
      bands: [
        { min: 33, grade: "D" },
        { min: 0, grade: "E" },
      ],
      passPercent: 33,
      showRank: false,
      reportCardPaidMonths: 0,
    };
    const exams = [
      { id: "math", title: "Math", maxMarks: 40, date: "2026-09-01", subject: { name: "Mathematics" } },
      { id: "eng", title: "Eng", maxMarks: 40, date: "2026-09-02", subject: { name: "English" } },
      { id: "sci", title: "Sci", maxMarks: 40, date: "2026-09-03", subject: { name: "Science" } },
    ];
    const marks = [
      { examId: "math", studentId: "s1", marks: 32 },
      { examId: "eng", studentId: "s1", marks: 10, absent: true },
    ];
    const score = studentSeriesScore("s1", exams, marks, policy);
    expect(score.entered).toBe(2);
    expect(score.total).toBe(32);
    expect(score.max).toBe(80);
    expect(score.rows.find((row) => row.examId === "sci")?.missing).toBe(true);
    expect(subjectCompletion({ id: "math", workflowStatus: "CORRECTION_REQUIRED" }, 3, marks).correction).toBe(true);
    expect(subjectCompletion({ id: "math" }, 2, marks).pending).toBe(1);
  });

  it("does not show parents a sitting until every paper is published", () => {
    expect(
      parentSeesOfficialSeries({
        exams: [{ workflowStatus: "PUBLISHED" }, { workflowStatus: "APPROVED" }],
      })
    ).toBe(false);
    expect(
      parentSeesOfficialSeries({
        exams: [{ workflowStatus: "PUBLISHED" }, { workflowStatus: "PUBLISHED" }],
      })
    ).toBe(true);
    expect(parentSeesOfficialSeries({ exams: [] })).toBe(false);
    expect(marksVisible({ workflowStatus: "APPROVED", series: { publishedAt: "2026-09-01" } })).toBe(false);
    expect(marksVisible({ resultsPublishedAt: "2026-09-09" })).toBe(true);
  });
});
