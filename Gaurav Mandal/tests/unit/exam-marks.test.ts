import { describe, expect, it } from "vitest";
import { marksReviewCsv, parentSeesOfficialSeries, sheetCellState, subjectCompletion, teacherAssignedToPaper, validateExamMark } from "../../lib/exam-marks";
import { DEFAULT_EXAM_PLAN, marksVisible, studentSeriesScore } from "../../lib/exams";
import {
  adminCanPublish,
  adminCanReview,
  canTransitionExam,
  teacherCanEditMarks,
  teacherMayEnterMarks,
  teacherMayTakeExam,
  workflowLabel,
} from "../../lib/exam-workflow";

const kavita = "teacher-kavita";
const other = "teacher-other";

describe("exam marks integrity", () => {
  it("rejects negative marks and marks above the paper maximum", () => {
    expect(() => validateExamMark(-1, 80)).toThrow(/negative/);
    expect(() => validateExamMark(81, 80, "Rahul")).toThrow(/exceed/);
    expect(() => validateExamMark(Number.NaN, 80)).toThrow(/number/);
    expect(() => validateExamMark(0, 80)).not.toThrow();
    expect(() => validateExamMark(80, 80)).not.toThrow();
  });

  it("treats the assigned subject teacher as the mark-entry teacher", () => {
    expect(teacherAssignedToPaper({ teacherId: kavita }, kavita)).toBe(true);
    expect(teacherAssignedToPaper({ teacherId: kavita }, other)).toBe(false);
    expect(teacherAssignedToPaper({ teacherId: kavita, evaluatorIds: [other] }, other)).toBe(true);
  });
});

describe("exam date does not gate mark entry", () => {
  const paper = {
    workflowStatus: "SCHEDULED" as const,
    teacherId: kavita,
    paperAt: null,
    examDate: "2026-09-10",
    evaluatorIds: [kavita],
  };

  it("lets the granted teacher enter marks before, on, and after the exam date", () => {
    expect(teacherMayEnterMarks({ ...paper, examDate: "2026-09-10" }, kavita)).toBe(true);
    expect(teacherMayEnterMarks({ ...paper, examDate: "2026-09-04" }, kavita)).toBe(true);
    expect(teacherMayEnterMarks({ ...paper, examDate: "2026-09-01" }, kavita)).toBe(true);
    expect(teacherCanEditMarks("SCHEDULED")).toBe(true);
  });

  it("blocks another teacher from the same paper", () => {
    expect(teacherMayEnterMarks(paper, other)).toBe(false);
    expect(teacherMayTakeExam({ ...paper, paperAt: "2026-09-01", workflowStatus: "SCHEDULED" }, other)).toBe(false);
  });
});

describe("mark workflow visibility", () => {
  it("hides drafts, submitted work, and corrections from parents", () => {
    for (const status of ["SCHEDULED", "MARKS_DRAFT", "SUBMITTED", "CORRECTION_REQUIRED", "RESUBMITTED", "APPROVED"]) {
      expect(marksVisible({ workflowStatus: status })).toBe(false);
    }
    expect(marksVisible({ workflowStatus: "PUBLISHED" })).toBe(true);
    expect(
      parentSeesOfficialSeries({
        exams: [{ workflowStatus: "MARKS_DRAFT" }, { workflowStatus: "PUBLISHED" }],
      })
    ).toBe(false);
    expect(parentSeesOfficialSeries({ exams: [{ workflowStatus: "APPROVED" }] })).toBe(false);
  });

  it("walks submit → correction → resubmit → approve → publish", () => {
    expect(canTransitionExam("SCHEDULED", "MARKS_DRAFT")).toBe(true);
    expect(canTransitionExam("MARKS_DRAFT", "SUBMITTED")).toBe(true);
    expect(canTransitionExam("SUBMITTED", "CORRECTION_REQUIRED")).toBe(true);
    expect(canTransitionExam("CORRECTION_REQUIRED", "RESUBMITTED")).toBe(true);
    expect(adminCanReview("RESUBMITTED")).toBe(true);
    expect(canTransitionExam("RESUBMITTED", "APPROVED")).toBe(true);
    expect(adminCanPublish("APPROVED")).toBe(true);
    expect(canTransitionExam("APPROVED", "PUBLISHED")).toBe(true);
    expect(teacherMayEnterMarks({ workflowStatus: "SUBMITTED", teacherId: kavita, evaluatorIds: [kavita] }, kavita)).toBe(false);
    expect(teacherMayEnterMarks({ workflowStatus: "CORRECTION_REQUIRED", teacherId: kavita, evaluatorIds: [kavita] }, kavita)).toBe(true);
    expect(teacherMayEnterMarks({ workflowStatus: "RESUBMITTED", teacherId: kavita, evaluatorIds: [kavita] }, kavita)).toBe(false);
    expect(teacherMayEnterMarks({ workflowStatus: "PUBLISHED", teacherId: kavita, evaluatorIds: [kavita] }, kavita)).toBe(false);
  });
});

describe("exam module scenarios (logic)", () => {
  const policy = { bands: [{ min: 33, grade: "D" }, { min: 0, grade: "E" }], passPercent: 33, showRank: false };

  it("1–2. official plan is Unit Test 1, Term 1, Unit Test 2, Term 2", () => {
    expect(DEFAULT_EXAM_PLAN.map((row) => row.name)).toEqual([
      "Unit Test 1",
      "Term 1",
      "Unit Test 2",
      "Term 2",
    ]);
    expect(DEFAULT_EXAM_PLAN.find((row) => row.id === "unit1")?.name).toBe("Unit Test 1");
  });

  it("3–6. granted teacher may enter marks before, on, and after the exam date; another teacher may not", () => {
    const assigned = { workflowStatus: "SCHEDULED" as const, teacherId: kavita, paperAt: null, evaluatorIds: [kavita] };
    expect(teacherMayEnterMarks({ ...assigned, examDate: "2026-09-20" } as typeof assigned, kavita)).toBe(true);
    expect(teacherMayEnterMarks({ ...assigned, examDate: "2026-09-04" } as typeof assigned, kavita)).toBe(true);
    expect(teacherMayEnterMarks({ ...assigned, examDate: "2026-08-01" } as typeof assigned, kavita)).toBe(true);
    expect(teacherMayEnterMarks(assigned, other)).toBe(false);
    expect(teacherMayEnterMarks({ workflowStatus: "SCHEDULED" as const, teacherId: kavita, paperAt: null }, kavita)).toBe(false);
  });

  it("7–8. parents do not see drafts, submitted sheets, or approved sheets until publish", () => {
    expect(marksVisible({ workflowStatus: "MARKS_DRAFT" })).toBe(false);
    expect(marksVisible({ workflowStatus: "SUBMITTED" })).toBe(false);
    expect(marksVisible({ workflowStatus: "APPROVED" })).toBe(false);
    expect(parentSeesOfficialSeries({ exams: [{ workflowStatus: "APPROVED" }] })).toBe(false);
    expect(marksVisible({ workflowStatus: "PUBLISHED" })).toBe(true);
    expect(parentSeesOfficialSeries({ exams: [{ workflowStatus: "PUBLISHED" }] })).toBe(true);
  });

  it("9. timetable publish (series.publishedAt) does not make marks visible", () => {
    expect(marksVisible({ workflowStatus: "SUBMITTED", series: { publishedAt: "2026-09-04" } })).toBe(false);
    expect(marksVisible({ workflowStatus: "APPROVED", series: { publishedAt: "2026-09-04" } })).toBe(false);
  });

  it("10–14. correction, resubmit, approve, then publish — teacher locked except during correction", () => {
    expect(canTransitionExam("SUBMITTED", "CORRECTION_REQUIRED")).toBe(true);
    expect(canTransitionExam("CORRECTION_REQUIRED", "RESUBMITTED")).toBe(true);
    expect(adminCanReview("RESUBMITTED")).toBe(true);
    expect(canTransitionExam("RESUBMITTED", "APPROVED")).toBe(true);
    expect(adminCanPublish("APPROVED")).toBe(true);
    expect(adminCanPublish("SUBMITTED")).toBe(false);
    expect(canTransitionExam("APPROVED", "PUBLISHED")).toBe(true);
    expect(workflowLabel("CORRECTION_REQUIRED")).toBe("Returned for correction");
    expect(teacherMayEnterMarks({ workflowStatus: "CORRECTION_REQUIRED", teacherId: kavita, evaluatorIds: [kavita] }, kavita)).toBe(true);
    expect(teacherMayEnterMarks({ workflowStatus: "RESUBMITTED", teacherId: kavita, evaluatorIds: [kavita] }, kavita)).toBe(false);
  });

  it("15–17. negative, over-max, and non-numeric marks are rejected", () => {
    expect(() => validateExamMark(-2, 40)).toThrow(/negative/);
    expect(() => validateExamMark(41, 40)).toThrow(/exceed/);
    expect(() => validateExamMark(Number.NaN, 40)).toThrow(/number/);
  });

  it("18. parent totals only count published papers passed into the scorer", () => {
    const exams = [
      { id: "e1", title: "UT1 Math", maxMarks: 40, date: "2026-09-20", subject: { name: "Mathematics" } },
      { id: "e2", title: "UT1 Eng", maxMarks: 40, date: "2026-09-21", subject: { name: "English" } },
    ];
    const published = exams.filter((_, i) => i === 0);
    const marks = [
      { examId: "e1", studentId: "s1", marks: 32 },
      { examId: "e2", studentId: "s1", marks: 10 },
    ];
    const score = studentSeriesScore("s1", published, marks, policy);
    expect(score.total).toBe(32);
    expect(score.max).toBe(40);
    expect(score.entered).toBe(1);
  });

  it("19. take-exam still needs the question paper; mark entry needs office grant, not the paper file", () => {
    expect(teacherMayTakeExam({ workflowStatus: "SCHEDULED", teacherId: kavita, paperAt: null }, kavita)).toBe(false);
    expect(teacherMayEnterMarks({ workflowStatus: "SCHEDULED", teacherId: kavita, paperAt: null }, kavita)).toBe(false);
    expect(teacherMayEnterMarks({ workflowStatus: "SCHEDULED", teacherId: kavita, paperAt: null, evaluatorIds: [kavita] }, kavita)).toBe(true);
    expect(teacherCanEditMarks("SCHEDULED")).toBe(true);
  });
});

describe("master marksheet helpers", () => {
  it("shows PENDING when a student has no mark, and CORR only for requested students", () => {
    expect(sheetCellState({ workflowStatus: "SCHEDULED" }).label).toBe("PENDING");
    expect(sheetCellState({ workflowStatus: "SUBMITTED", mark: { marks: 18 } }).label).toBe("18");
    expect(sheetCellState({ workflowStatus: "APPROVED", mark: { marks: 18 } }).label).toBe("✓ 18");
    expect(sheetCellState({ workflowStatus: "SUBMITTED", mark: { marks: 15, correctionRequested: true } }).label).toBe("CORR");
  });

  it("exports admission number, subjects, totals, and pending cells", () => {
    const csv = marksReviewCsv({
      seriesName: "Unit Test 1",
      classLabel: "1-A",
      exams: [
        { id: "e1", subject: { name: "English" }, maxMarks: 20 },
        { id: "e2", subject: { name: "Mathematics" }, maxMarks: 20 },
      ],
      students: [{ id: "s1", name: "Aarav Sharma", admissionNo: "ADM001" }],
      marks: [{ examId: "e1", studentId: "s1", marks: 18 }],
    });
    expect(csv).toContain("Admission Number");
    expect(csv).toContain("ADM001");
    expect(csv).toContain("Aarav Sharma");
    expect(csv).toContain("PENDING");
    expect(csv).toContain("18");
  });

  it("counts subject completion without mixing papers", () => {
    const math = subjectCompletion({ id: "math" }, 2, [
      { examId: "math", studentId: "s1" },
      { examId: "eng", studentId: "s1" },
    ]);
    expect(math.entered).toBe(1);
    expect(math.pending).toBe(1);
  });
});

