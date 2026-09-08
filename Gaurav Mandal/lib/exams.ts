import { percent } from "./utils";

export type GradeBand = { min: number; grade: string };

export const DEFAULT_GRADE_BANDS: GradeBand[] = [
  { min: 91, grade: "A1" },
  { min: 81, grade: "A2" },
  { min: 71, grade: "B1" },
  { min: 61, grade: "B2" },
  { min: 51, grade: "C1" },
  { min: 41, grade: "C2" },
  { min: 33, grade: "D" },
  { min: 0, grade: "E" },
];

export type GradePolicy = {
  bands: GradeBand[];
  passPercent: number;
  showRank: boolean;
  reportCardPaidMonths: number;
};

export function parseGradeBands(raw?: string | null): GradeBand[] {
  if (raw === "[]") return [];
  try {
    const parsed = JSON.parse(raw || "[]") as GradeBand[];
    if (!Array.isArray(parsed)) return DEFAULT_GRADE_BANDS;
    const bands = parsed
      .map((b) => ({
        min: Math.max(0, Math.min(100, Math.round(Number(b.min) || 0))),
        grade: String(b.grade || "").trim(),
      }))
      .filter((b) => b.grade);
    return bands.length ? bands.sort((a, b) => b.min - a.min) : DEFAULT_GRADE_BANDS;
  } catch {
    return DEFAULT_GRADE_BANDS;
  }
}

export function gradePolicyFrom(row?: {
  gradeBandsJson?: string | null;
  passPercent?: number | null;
  showRank?: boolean | null;
  reportCardPaidMonths?: number | null;
} | null): GradePolicy {
  const months = Math.floor(Number(row?.reportCardPaidMonths));
  return {
    bands: parseGradeBands(row?.gradeBandsJson),
    passPercent: Math.max(0, Math.min(100, Math.round(Number(row?.passPercent) || 33))),
    showRank: Boolean(row?.showRank),
    reportCardPaidMonths: Number.isFinite(months) && months > 0 ? Math.min(24, months) : 0,
  };
}

export function gradeForPercent(pct: number, bands: GradeBand[]) {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return sorted.find((b) => pct >= b.min)?.grade ?? "";
}

export type SeriesExam = {
  id: string;
  title: string;
  maxMarks: number;
  date: Date | string;
  subject: { name: string };
};

export type SeriesMark = {
  examId: string;
  studentId: string;
  marks: number;
  absent?: boolean;
  remarks?: string | null;
};

export type SeriesStudent = {
  id: string;
  name: string;
  admissionNo?: string;
};

export function ymd(d: Date | string) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(+dt)) return "";
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function addDays(value: string, days: number) {
  const [y, m, d] = value.split("-").map(Number);
  if (!y) return value;
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days);
  return ymd(dt);
}

export function parseYmd(value?: string | null) {
  const s = (value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00`);
}

function dayStamp(value: Date | string) {
  const dt = value instanceof Date ? value : new Date(value);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
}

export function onOrAfter(when: Date | string, now = new Date()) {
  return dayStamp(now) >= dayStamp(when);
}

export function afterDay(when: Date | string, now = new Date()) {
  return dayStamp(now) > dayStamp(when);
}

export function timetableVisible(exam: {
  seriesId?: string | null;
  series?: { publishedAt?: Date | string | null } | null;
}) {
  if (!exam.seriesId) return true;
  return Boolean(exam.series?.publishedAt);
}

export function marksVisible(exam: {
  workflowStatus?: string | null;
  resultsPublishedAt?: Date | string | null;
  seriesId?: string | null;
  resultOn?: Date | string | null;
  series?: { publishedAt?: Date | string | null } | null;
}) {
  return exam.workflowStatus === "PUBLISHED" || Boolean(exam.resultsPublishedAt);
}

export function examLocked(exam: {
  workflowStatus?: string | null;
  resultOn?: Date | string | null;
}) {
  const status = exam.workflowStatus || "";
  if (status === "SUBMITTED" || status === "UNDER_REVIEW" || status === "APPROVED" || status === "PUBLISHED") {
    return true;
  }
  return false;
}

export function studentSeriesScore(
  studentId: string,
  exams: SeriesExam[],
  marks: SeriesMark[],
  policy: GradePolicy
) {
  let total = 0;
  let max = 0;
  let entered = 0;
  const rows = exams.map((exam) => {
    const row = marks.find((m) => m.examId === exam.id && m.studentId === studentId);
    const missing = !row;
    const absent = Boolean(row?.absent);
    const value = missing ? null : absent ? 0 : Number(row?.marks);
    if (!missing) {
      entered += 1;
      total += value ?? 0;
      max += exam.maxMarks;
    }
    return {
      examId: exam.id,
      subject: exam.subject.name,
      maxMarks: exam.maxMarks,
      marks: value,
      absent,
      missing,
      remarks: row?.remarks ?? "",
      pct: missing || absent ? 0 : percent(value ?? 0, exam.maxMarks),
    };
  });
  const pct = max ? percent(total, max) : 0;
  const grade = max ? gradeForPercent(pct, policy.bands) : "";
  const passed = max ? pct >= policy.passPercent : false;
  return { studentId, total, max, pct, grade, passed, entered, rows };
}

export function seriesRanks(
  students: SeriesStudent[],
  exams: SeriesExam[],
  marks: SeriesMark[],
  policy: GradePolicy
) {
  const scored = students
    .map((s) => ({ student: s, score: studentSeriesScore(s.id, exams, marks, policy) }))
    .filter((row) => row.score.entered > 0)
    .sort((a, b) => b.score.pct - a.score.pct || a.student.name.localeCompare(b.student.name));
  const rankByStudent = new Map<string, number>();
  let lastPct = -1;
  let lastRank = 0;
  scored.forEach((row, i) => {
    const rank = row.score.pct === lastPct ? lastRank : i + 1;
    rankByStudent.set(row.student.id, rank);
    lastPct = row.score.pct;
    lastRank = rank;
  });
  return rankByStudent;
}

export function attendancePct(rows: { status: string }[]) {
  if (!rows.length) return null;
  const present = rows.filter((a) => a.status !== "ABSENT").length;
  return Math.round((present / rows.length) * 100);
}

export type ExamPlanItem = {
  id: string;
  name: string;
  kind: string;
  weight: number;
  maxMarks: number;
  expectedPeriod?: string;
};

export const DEFAULT_EXAM_PLAN: ExamPlanItem[] = [
  { id: "unit1", name: "Unit Test 1", kind: "unit", weight: 10, maxMarks: 40, expectedPeriod: "July" },
  { id: "term1", name: "Term 1", kind: "term1", weight: 30, maxMarks: 80, expectedPeriod: "September" },
  { id: "unit2", name: "Unit Test 2", kind: "unit", weight: 10, maxMarks: 40, expectedPeriod: "November" },
  { id: "term2", name: "Term 2", kind: "term2", weight: 50, maxMarks: 80, expectedPeriod: "March" },
];

export function parseExamPlan(raw?: string | null, fallback = true): ExamPlanItem[] {
  try {
    const parsed = JSON.parse(raw || "[]") as ExamPlanItem[];
    if (!Array.isArray(parsed) || !parsed.length) {
      return fallback ? DEFAULT_EXAM_PLAN.map((row) => ({ ...row })) : [];
    }
    return parsed
      .map((row, i) => ({
        id: String(row?.id || `item-${i}`),
        name: String(row?.name || "").trim() || `Sitting ${i + 1}`,
        kind: String(row?.kind || "custom"),
        weight: Math.max(0, Math.round(Number(row?.weight) || 0)),
        maxMarks: Math.max(1, Math.round(Number(row?.maxMarks) || 80)),
        expectedPeriod: String(row?.expectedPeriod || "").trim(),
      }))
      .filter((row) => row.name);
  } catch {
    return fallback ? DEFAULT_EXAM_PLAN.map((row) => ({ ...row })) : [];
  }
}

export function examPlanWeight(items: ExamPlanItem[]) {
  return items.reduce((sum, row) => sum + row.weight, 0);
}

export type SeriesPaperDraft = {
  subjectId: string;
  maxMarks: number;
  date: string;
};

export function paperSetterId(exam: { setterId?: string | null; teacherId?: string | null }) {
  return exam.setterId || exam.teacherId || "";
}

export function mapSitting(
  exam: {
    id: string;
    title: string;
    maxMarks: number;
    date: Date;
    paperDueOn?: Date | null;
    copiesDueOn?: Date | null;
    resultOn?: Date | null;
    paperFileName?: string | null;
    paperFilePath?: string | null;
    teacherId?: string | null;
    setterId?: string | null;
    subject: { id: string; name: string };
    teacher?: { user: { name: string } } | null;
    setter?: { user: { name: string } } | null;
    class?: { name: string; section: string } | null;
    papers?: { type: string }[];
  },
  studentCount = 0,
  assigned = false
) {
  const setterId = paperSetterId(exam);
  return {
    id: exam.id,
    title: exam.title,
    subjectId: exam.subject.id,
    subject: exam.subject.name,
    teacherId: exam.teacherId ?? "",
    teacherName: exam.teacher?.user.name || "",
    setterId,
    setterName: exam.setter?.user.name || exam.teacher?.user.name || "",
    classLabel: exam.class ? `${exam.class.name}-${exam.class.section}` : undefined,
    maxMarks: exam.maxMarks,
    date: ymd(exam.date),
    paperDueOn: exam.paperDueOn ? ymd(exam.paperDueOn) : "",
    copiesDueOn: exam.copiesDueOn ? ymd(exam.copiesDueOn) : "",
    resultOn: exam.resultOn ? ymd(exam.resultOn) : "",
    paperFileName: exam.paperFileName || "",
    paperFilePath: exam.paperFilePath || "",
    copiesCount: (exam.papers ?? []).filter((p) => p.type !== "QUESTION").length,
    studentCount,
    assigned,
  };
}

export function studentYearScore(
  studentId: string,
  plan: ExamPlanItem[],
  sittings: {
    planItemId: string;
    exams: SeriesExam[];
    marks: SeriesMark[];
  }[],
  policy: GradePolicy
) {
  let weighted = 0;
  let weightUsed = 0;
  const rows = plan.map((item) => {
    const sitting = sittings.find((s) => s.planItemId === item.id);
    if (!sitting) {
      return { id: item.id, name: item.name, weight: item.weight, missing: true, pct: 0, grade: "" };
    }
    const score = studentSeriesScore(studentId, sitting.exams, sitting.marks, policy);
    if (!score.entered) {
      return { id: item.id, name: item.name, weight: item.weight, missing: true, pct: 0, grade: "" };
    }
    weighted += score.pct * item.weight;
    weightUsed += item.weight;
    return {
      id: item.id,
      name: item.name,
      weight: item.weight,
      missing: false,
      pct: score.pct,
      grade: score.grade,
    };
  });
  const pct = weightUsed ? Math.round(weighted / weightUsed) : 0;
  return {
    studentId,
    pct,
    grade: weightUsed ? gradeForPercent(pct, policy.bands) : "",
    weightUsed,
    entered: rows.filter((r) => !r.missing).length,
    rows,
  };
}
