export type ExamWorkflowStatus =
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "MARKS_DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "CORRECTION_REQUIRED"
  | "RESUBMITTED"
  | "APPROVED"
  | "PUBLISHED";

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

export function teacherAssignedToPaper(
  exam: {
    teacherId?: string | null;
    evaluatorIds?: string[] | null;
    evaluators?: { teacherId?: string; id?: string }[] | null;
  },
  teacherId?: string | null
) {
  if (!teacherId) return false;
  if (exam.teacherId === teacherId) return true;
  const listed = exam.evaluatorIds?.filter(Boolean) || [];
  if (listed.includes(teacherId)) return true;
  return (exam.evaluators || []).some((row) => String(row.teacherId || row.id || "") === teacherId);
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

export const OFFICE_SETUP_FILTERS = [
  ["all", "All papers"],
  ["scheduled", "Scheduled"],
  ["correction", "Returned for correction"],
  ["review", "Ready to publish"],
  ["published", "Published"],
] as const;

export function officePaperLabel(status?: string | null) {
  if (status === "IN_PROGRESS" || status === "MARKS_DRAFT") return "Marks in progress";
  if (status === "SUBMITTED" || status === "UNDER_REVIEW" || status === "RESUBMITTED") return "Submitted";
  if (status === "CORRECTION_REQUIRED") return "Returned for correction";
  if (status === "APPROVED") return "Ready to publish";
  if (status === "PUBLISHED") return "Published";
  return "Scheduled";
}

export function officePaperPulse(status?: string | null) {
  return (
    status === "IN_PROGRESS" ||
    status === "MARKS_DRAFT" ||
    status === "SUBMITTED" ||
    status === "UNDER_REVIEW" ||
    status === "RESUBMITTED"
  );
}

export function officePaperTone(status?: string | null): "ink" | "clay" | "leaf" | "warn" | "grape" {
  if (status === "PUBLISHED" || status === "APPROVED") return "leaf";
  if (status === "CORRECTION_REQUIRED") return "warn";
  if (status === "SUBMITTED" || status === "UNDER_REVIEW" || status === "RESUBMITTED") return "grape";
  if (officePaperPulse(status)) return "clay";
  return "ink";
}

export function officeSittingStatus(papers: { workflowStatus?: string | null }[]) {
  if (!papers.length) return "Not scheduled";
  if (papers.every((p) => p.workflowStatus === "PUBLISHED")) return "Published";
  if (papers.every((p) => p.workflowStatus === "APPROVED" || p.workflowStatus === "PUBLISHED")) {
    return "Ready to publish";
  }
  if (
    papers.some((p) =>
      ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED", "CORRECTION_REQUIRED"].includes(p.workflowStatus || "")
    )
  ) {
    return "Marks review";
  }
  if (papers.some((p) => p.workflowStatus === "IN_PROGRESS" || p.workflowStatus === "MARKS_DRAFT")) {
    return "In progress";
  }
  return "Scheduled";
}

export function officeSittingProgress(papers: { workflowStatus?: string | null }[]) {
  const total = papers.length;
  const done = papers.filter((p) => p.workflowStatus && p.workflowStatus !== "SCHEDULED").length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function officePaperAction(status?: string | null, granted?: boolean) {
  if (status === "PUBLISHED") return "View result";
  if (status === "APPROVED") return "View result";
  if (status === "CORRECTION_REQUIRED") return "View issue";
  if (status === "SUBMITTED" || status === "UNDER_REVIEW" || status === "RESUBMITTED") return "Review";
  if (status === "IN_PROGRESS" || status === "MARKS_DRAFT") return "View";
  return granted ? "View" : "Allow marks";
}

export function officePaperDots(exam: {
  paperAt?: string | null;
  conductedAt?: string | null;
  workflowStatus?: string | null;
  entered?: number;
  studentCount?: number;
}) {
  const status = exam.workflowStatus || "";
  const reviewed =
    status === "SUBMITTED" ||
    status === "UNDER_REVIEW" ||
    status === "RESUBMITTED" ||
    status === "CORRECTION_REQUIRED" ||
    status === "APPROVED" ||
    status === "PUBLISHED";
  const marked =
    reviewed ||
    status === "MARKS_DRAFT" ||
    status === "CORRECTION_REQUIRED" ||
    (exam.entered || 0) > 0;
  const taken = marked || status === "IN_PROGRESS" || Boolean(exam.conductedAt);
  const paperSet = taken || Boolean(exam.paperAt);
  return {
    paper: paperSet,
    exam: taken,
    marks: marked,
    review: reviewed,
  };
}

export function officeSubmitted(status?: string | null) {
  return (
    status === "SUBMITTED" ||
    status === "UNDER_REVIEW" ||
    status === "RESUBMITTED" ||
    status === "CORRECTION_REQUIRED" ||
    status === "APPROVED" ||
    status === "PUBLISHED"
  );
}

export function officeExamTimeline(flags: {
  scheduled: boolean;
  paper: boolean;
  conducted: boolean;
  marksGranted: boolean;
  marksDone: boolean;
  submitted: boolean;
  approved: boolean;
  correction?: boolean;
}) {
  const correction = Boolean(flags.correction);
  const items = [
    { key: "scheduled", label: "Exam scheduled", done: flags.scheduled },
    { key: "paper", label: "Question paper", done: flags.paper },
    { key: "conducted", label: "Exam conducted", done: flags.conducted },
    { key: "granted", label: "Marks entry allowed", done: flags.marksGranted },
    { key: "marks", label: "Marks entered", done: flags.marksDone },
    { key: "submitted", label: "Submitted to office", done: Boolean(flags.submitted) || correction },
    ...(correction ? [{ key: "correction", label: "Returned for correction", done: false }] : []),
    { key: "approved", label: "Approved", done: Boolean(flags.approved) && !correction },
  ];
  let sawPending = false;
  return items.map((item) => {
    if (item.done) return { ...item, kind: "done" as const };
    if (!sawPending) {
      sawPending = true;
      return { ...item, kind: "now" as const };
    }
    return { ...item, kind: "wait" as const };
  });
}

export function mentionTeacherQuery(value: string) {
  return String(value || "")
    .replace(/^@+/, "")
    .trim()
    .toLowerCase();
}

export function filterMentionTeachers<T extends { id: string; name: string }>(
  query: string,
  people: T[],
  grantedIds: string[]
) {
  const granted = new Set(grantedIds);
  const needle = mentionTeacherQuery(query);
  return people.filter(
    (person) => !granted.has(person.id) && (!needle || person.name.toLowerCase().includes(needle))
  );
}

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
