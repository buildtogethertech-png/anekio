export const EXAM_WORKFLOW = [
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

export type ExamWorkflowStatus = (typeof EXAM_WORKFLOW)[number];

export function isExamWorkflowStatus(value: unknown): value is ExamWorkflowStatus {
  return typeof value === "string" && (EXAM_WORKFLOW as readonly string[]).includes(value);
}

export function teacherCanEditMarks(status?: string | null) {
  return (
    status === "SCHEDULED" ||
    status === "IN_PROGRESS" ||
    status === "MARKS_DRAFT" ||
    status === "CORRECTION_REQUIRED"
  );
}

function evaluatorRowId(row: { teacherId?: string; id?: string }) {
  return String(row.teacherId || row.id || "");
}

export function grantedEvaluatorIds(exam: {
  teacherId?: string | null;
  marksGrantedAt?: Date | string | null;
  evaluatorIds?: string[] | null;
  evaluators?: { teacherId?: string; id?: string }[] | null;
}) {
  const fromJoin = (exam.evaluators || []).map(evaluatorRowId).filter(Boolean);
  if (exam.evaluatorIds?.length) return [...new Set(exam.evaluatorIds.filter(Boolean))];
  if (fromJoin.length) return [...new Set(fromJoin)];
  if (exam.teacherId && exam.marksGrantedAt) return [exam.teacherId];
  return [];
}

export function eligibleMarksTeacherIds(input: {
  examTeacherId?: string | null;
  subjectTeacherId?: string | null;
  skillTeacherIds?: (string | null | undefined)[];
}) {
  return [
    ...new Set(
      [input.examTeacherId, input.subjectTeacherId, ...(input.skillTeacherIds || [])].filter(
        (id): id is string => Boolean(id)
      )
    ),
  ];
}

export function canGrantMarksEntry(teacherId: string, eligibleIds: string[]) {
  return Boolean(teacherId && eligibleIds.includes(teacherId));
}

export function examEvaluatorIds(exam: {
  teacherId?: string | null;
  evaluatorIds?: string[] | null;
  evaluators?: { teacherId?: string; id?: string }[] | null;
}) {
  const granted = grantedEvaluatorIds(exam);
  const ids = [...granted];
  if (exam.teacherId && !ids.includes(exam.teacherId)) ids.unshift(exam.teacherId);
  return ids.filter(Boolean);
}

export function teacherIsEvaluator(
  exam: {
    teacherId?: string | null;
    evaluatorIds?: string[] | null;
    evaluators?: { teacherId?: string; id?: string }[] | null;
  },
  teacherId?: string | null
) {
  return Boolean(teacherId && examEvaluatorIds(exam).includes(teacherId));
}

export function teacherMayEnterMarks(
  exam: {
    workflowStatus?: string | null;
    teacherId?: string | null;
    paperAt?: Date | string | null;
    marksGrantedAt?: Date | string | null;
    evaluatorIds?: string[] | null;
    evaluators?: { teacherId?: string; id?: string }[] | null;
  },
  teacherId?: string | null
) {
  if (!teacherId) return false;
  if (!grantedEvaluatorIds(exam).includes(teacherId)) return false;
  return teacherCanEditMarks(exam.workflowStatus);
}

export function teacherMayTakeExam(
  exam: {
    workflowStatus?: string | null;
    teacherId?: string | null;
    paperAt?: Date | string | null;
    evaluatorIds?: string[] | null;
    evaluators?: { teacherId?: string; id?: string }[] | null;
  },
  teacherId?: string | null
) {
  return Boolean(
    teacherId && exam.teacherId === teacherId && exam.paperAt && teacherCanTakeExam(exam.workflowStatus)
  );
}

export function teacherCanTakeExam(status?: string | null) {
  return !status || status === "SCHEDULED";
}

export function examNearnessDays(examDate: string, today: string) {
  const a = Date.parse(`${examDate.slice(0, 10)}T00:00:00`);
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((a - b) / 86_400_000));
}

export function compareExamNearness(dateA?: string | null, dateB?: string | null, today = "") {
  const da = examNearnessDays(String(dateA || ""), today);
  const db = examNearnessDays(String(dateB || ""), today);
  if (da !== db) return da - db;
  return String(dateB || "").localeCompare(String(dateA || ""));
}

const STEP_ORDER = { paper: 0, take: 1, marks: 2 } as const;

export function examWorkStepOrder(kind?: string | null) {
  return STEP_ORDER[kind as keyof typeof STEP_ORDER] ?? 9;
}

export function marksEntryGranted(exam: {
  teacherId?: string | null;
  paperAt?: Date | string | null;
  marksGrantedAt?: Date | string | null;
  evaluatorIds?: string[] | null;
  evaluators?: { teacherId?: string; id?: string }[] | null;
}) {
  return grantedEvaluatorIds(exam).length > 0;
}

export function adminCanReview(status?: string | null) {
  return status === "SUBMITTED" || status === "UNDER_REVIEW" || status === "RESUBMITTED";
}

export function adminCanPublish(status?: string | null) {
  return status === "APPROVED";
}

const TRANSITIONS: Record<ExamWorkflowStatus, ExamWorkflowStatus[]> = {
  SCHEDULED: ["IN_PROGRESS", "MARKS_DRAFT", "SUBMITTED"],
  IN_PROGRESS: ["MARKS_DRAFT", "SUBMITTED"],
  MARKS_DRAFT: ["MARKS_DRAFT", "SUBMITTED"],
  SUBMITTED: ["UNDER_REVIEW", "CORRECTION_REQUIRED", "APPROVED"],
  UNDER_REVIEW: ["CORRECTION_REQUIRED", "APPROVED"],
  CORRECTION_REQUIRED: ["MARKS_DRAFT", "SUBMITTED", "RESUBMITTED"],
  RESUBMITTED: ["UNDER_REVIEW", "CORRECTION_REQUIRED", "APPROVED"],
  APPROVED: ["PUBLISHED", "CORRECTION_REQUIRED"],
  PUBLISHED: [],
};

export function canTransitionExam(from?: string | null, to?: string | null) {
  if (!isExamWorkflowStatus(from) || !isExamWorkflowStatus(to)) return false;
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function assertExamTransition(from?: string | null, to?: string | null) {
  if (canTransitionExam(from, to)) return;
  throw new Error("That exam status change is not allowed.");
}

export function marksArePublished(exam: {
  workflowStatus?: string | null;
  resultsPublishedAt?: Date | string | null;
}) {
  return exam.workflowStatus === "PUBLISHED" || Boolean(exam.resultsPublishedAt);
}

export function workflowLabel(status?: string | null) {
  switch (status) {
    case "SCHEDULED":
      return "Scheduled";
    case "IN_PROGRESS":
      return "Exam in progress";
    case "MARKS_DRAFT":
      return "Marks in progress";
    case "SUBMITTED":
      return "Submitted — awaiting review";
    case "UNDER_REVIEW":
      return "Under review";
    case "CORRECTION_REQUIRED":
      return "Returned for correction";
    case "RESUBMITTED":
      return "Resubmitted";
    case "APPROVED":
      return "Approved";
    case "PUBLISHED":
      return "Results published";
    default:
      return "Scheduled";
  }
}

export const ADMIN_PAPER_TABS = [
  ["all", "All papers"],
  ["scheduled", "Scheduled"],
  ["awaiting", "Awaiting marks"],
  ["correction", "Returned for correction"],
  ["review", "Ready to publish"],
  ["published", "Published"],
] as const;

export function adminBucket(status?: string | null): "scheduled" | "awaiting" | "review" | "correction" | "published" {
  if (status === "PUBLISHED") return "published";
  if (status === "CORRECTION_REQUIRED") return "correction";
  if (status === "SUBMITTED" || status === "UNDER_REVIEW" || status === "RESUBMITTED" || status === "APPROVED") return "review";
  if (status === "IN_PROGRESS" || status === "MARKS_DRAFT") return "awaiting";
  return "scheduled";
}

export function teacherBucket(
  status?: string | null,
  examDate?: string,
  today = ""
): "today" | "upcoming" | "draft" | "submitted" {
  if (status === "SUBMITTED" || status === "UNDER_REVIEW" || status === "RESUBMITTED" || status === "APPROVED" || status === "PUBLISHED") {
    return "submitted";
  }
  if (status === "MARKS_DRAFT" || status === "CORRECTION_REQUIRED" || status === "IN_PROGRESS" || status === "SCHEDULED") {
    return "draft";
  }
  if (examDate && today && examDate > today) return "upcoming";
  return "today";
}
