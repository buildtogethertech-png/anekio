export type GradeBand = { min: number; grade: string };

export type GradePolicy = {
  bands: GradeBand[];
  passPercent: number;
  showRank: boolean;
  reportCardPaidMonths?: number;
};

export type ExamPlanItem = {
  id: string;
  name: string;
  kind: string;
  weight: number;
  maxMarks: number;
  expectedPeriod?: string;
};

function percent(marks: number, max: number) {
  if (!max) return 0;
  return Math.round((marks / max) * 100);
}

export function gradeForPercent(pct: number, bands: GradeBand[]) {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  return sorted.find((b) => pct >= b.min)?.grade ?? "";
}

export type SeriesExam = {
  id: string;
  title: string;
  maxMarks: number;
  date: string;
  subject: { id?: string; name: string };
};

export type SeriesMark = {
  examId: string;
  studentId: string;
  marks: number;
  absent?: boolean;
  remarks?: string | null;
};

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
  students: { id: string; name: string }[],
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

export function examPlanWeight(items: ExamPlanItem[]) {
  return items.reduce((sum, row) => sum + row.weight, 0);
}

export function studentYearScore(
  studentId: string,
  plan: ExamPlanItem[],
  sittings: { planItemId: string; exams: SeriesExam[]; marks: SeriesMark[] }[],
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
