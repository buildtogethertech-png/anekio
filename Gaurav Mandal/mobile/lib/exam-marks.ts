export type SheetMark = {
  marks: number;
  absent?: boolean;
  correctionRequested?: boolean;
};

export type SheetCellKind = "pending" | "draft" | "submitted" | "correction" | "resubmitted" | "approved" | "published" | "absent";

export function sheetCellState(input: {
  workflowStatus?: string | null;
  mark?: SheetMark | null;
}): { kind: SheetCellKind; label: string } {
  const status = input.workflowStatus || "SCHEDULED";
  const mark = input.mark;
  if (!mark) return { kind: "pending", label: "PENDING" };
  if (mark.correctionRequested) {
    return { kind: "correction", label: "CORR" };
  }
  if (mark.absent) {
    return {
      kind: status === "PUBLISHED" || status === "APPROVED" ? "approved" : "absent",
      label: status === "PUBLISHED" || status === "APPROVED" ? "✓ Ab" : "Ab",
    };
  }
  if (status === "PUBLISHED" || status === "APPROVED") return { kind: status === "PUBLISHED" ? "published" : "approved", label: `✓ ${mark.marks}` };
  if (status === "RESUBMITTED") return { kind: "resubmitted", label: String(mark.marks) };
  if (status === "SUBMITTED" || status === "UNDER_REVIEW") return { kind: "submitted", label: String(mark.marks) };
  return { kind: "draft", label: String(mark.marks) };
}

export function sheetRowScore(
  exams: { id: string; maxMarks: number }[],
  marksForStudent: { examId: string; marks: number; absent?: boolean }[]
) {
  let total = 0;
  let max = 0;
  let entered = 0;
  for (const exam of exams) {
    const row = marksForStudent.find((m) => m.examId === exam.id);
    if (!row) continue;
    entered += 1;
    max += exam.maxMarks;
    total += row.absent ? 0 : Number(row.marks);
  }
  const pct = max ? Math.round((total / max) * 1000) / 10 : 0;
  return { total, max, pct, entered };
}

export function subjectCompletion(
  exam: { id: string; workflowStatus?: string | null },
  studentCount: number,
  marks: { examId: string; studentId: string }[]
) {
  const entered = new Set(marks.filter((row) => row.examId === exam.id).map((row) => row.studentId)).size;
  const pending = Math.max(0, studentCount - entered);
  const complete = studentCount > 0 && pending === 0;
  const correction = exam.workflowStatus === "CORRECTION_REQUIRED";
  return { entered, pending, complete, correction, studentCount };
}

export function csvEscape(value: string | number) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function marksReviewCsv(input: {
  seriesName: string;
  classLabel: string;
  exams: { id: string; subject: { name: string }; maxMarks: number }[];
  students: { admissionNo?: string; name: string; id: string }[];
  marks: { examId: string; studentId: string; marks: number; absent?: boolean }[];
}) {
  const headers = [
    "Admission Number",
    "Student Name",
    ...input.exams.flatMap((exam) => [`${exam.subject.name} (/${exam.maxMarks})`, `${exam.subject.name} max`]),
    "Total",
    "Maximum",
    "Percentage",
  ];
  const lines = [headers.map(csvEscape).join(",")];
  for (const student of input.students) {
    const rows = input.marks.filter((row) => row.studentId === student.id);
    const score = sheetRowScore(input.exams, rows);
    const cells = input.exams.flatMap((exam) => {
      const mark = rows.find((row) => row.examId === exam.id);
      const value = !mark ? "PENDING" : mark.absent ? "Absent" : String(mark.marks);
      return [csvEscape(value), csvEscape(exam.maxMarks)];
    });
    lines.push(
      [
        csvEscape(student.admissionNo || ""),
        csvEscape(student.name),
        ...cells,
        csvEscape(score.total),
        csvEscape(score.max),
        csvEscape(score.pct),
      ].join(",")
    );
  }
  return lines.join("\n");
}
