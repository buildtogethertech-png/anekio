import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View, type ViewStyle } from "react-native";
import { act } from "../lib/mutate";
import { marksReviewCsv, sheetCellState, sheetRowScore, subjectCompletion } from "../lib/exam-marks";
import { workflowLabel } from "../lib/exam-workflow";
import { Badge, Button, Chip, ChipScroller, Input, Modal } from "./ui";

type Exam = {
  id: string;
  maxMarks: number;
  teacherId?: string | null;
  teacherName?: string;
  subject: { id: string; name: string };
  workflowStatus?: string;
};

type Mark = {
  examId: string;
  studentId: string;
  marks: number;
  absent?: boolean;
  correctionNote?: string;
  correctionRequested?: boolean;
};

type Student = { id: string; name: string; admissionNo?: string; classId: string };

type HistoryRow = { id: string; action: string; marks: number; absent: boolean; note: string; at: string; actorName: string };

function cellClass(kind: string) {
  if (kind === "pending") return "bg-amber-50";
  if (kind === "correction") return "bg-amber-50";
  if (kind === "approved" || kind === "published") return "bg-emerald-50/70";
  return "bg-white";
}

function cellColor(kind: string) {
  if (kind === "pending" || kind === "correction") return "text-amber-900";
  if (kind === "approved" || kind === "published") return "text-emerald-900";
  return "text-ink-900";
}

function downloadCsv(filename: string, csv: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const sticky = Platform.OS === "web" ? ({ position: "sticky", zIndex: 2 } as unknown as ViewStyle) : undefined;

export function ExamMarksReview({
  token,
  sessionLabel,
  seriesName,
  classLabel,
  exams,
  marks,
  students,
  pending,
  canEdit,
  canPublish,
  approvedCount,
  onPublish,
  onRan,
}: {
  token: string | null;
  sessionLabel: string;
  seriesName: string;
  classLabel: string;
  exams: Exam[];
  marks: Mark[];
  students: Student[];
  pending: string;
  canEdit?: boolean;
  canPublish?: boolean;
  approvedCount?: number;
  onPublish?: () => void;
  onRan: (ok: string) => Promise<void>;
}) {
  const [subjectId, setSubjectId] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"admission" | "name">("admission");
  const [picked, setPicked] = useState<{ examId: string; studentId: string } | null>(null);
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState("");

  const papers = exams.filter((exam) => {
    if (subjectId && exam.subject.id !== subjectId) return false;
    if (status === "PENDING") return true;
    if (status && exam.workflowStatus !== status) return false;
    return true;
  });
  const byKey = useMemo(() => {
    const map = new Map<string, Mark>();
    for (const row of marks) map.set(`${row.examId}:${row.studentId}`, row);
    return map;
  }, [marks]);
  const needle = query.trim().toLowerCase();
  const rows = [...students]
    .filter((student) => {
      if (!needle) return true;
      return `${student.name} ${student.admissionNo || ""}`.toLowerCase().includes(needle);
    })
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name) || String(a.admissionNo).localeCompare(String(b.admissionNo))
        : String(a.admissionNo).localeCompare(String(b.admissionNo)) || a.name.localeCompare(b.name)
    );
  const completions = exams.map((exam) => ({ exam, ...subjectCompletion(exam, students.length, marks) }));
  const completeCells = completions.reduce((sum, row) => sum + row.entered, 0);
  const totalCells = exams.length * students.length;
  const pendingCells = Math.max(0, totalCells - completeCells);
  const correctionCells = marks.filter((row) => row.correctionRequested).length;
  const pickedExam = exams.find((exam) => exam.id === picked?.examId);
  const pickedStudent = students.find((row) => row.id === picked?.studentId);
  const pickedMark = picked ? byKey.get(`${picked.examId}:${picked.studentId}`) : undefined;

  async function openCell(examId: string, studentId: string) {
    setPicked({ examId, studentId });
    setReason("");
    setHistory([]);
    try {
      const res = (await act(token, "examMarkHistory", { examId, studentId })) as { history?: HistoryRow[] };
      setHistory(res.history || []);
    } catch {
      setHistory([]);
    }
  }

  async function requestCorrection() {
    if (!picked || !reason.trim()) return;
    setBusy("correct");
    try {
      await act(token, "requestExamMarkCorrection", { examId: picked.examId, studentId: picked.studentId, note: reason.trim() });
      setPicked(null);
      await onRan("Correction requested from the subject teacher");
    } finally {
      setBusy("");
    }
  }

  async function remind(examId: string) {
    setBusy("remind");
    try {
      await act(token, "remindExamMarks", { examId });
      await onRan("Reminder sent to the subject teacher");
    } finally {
      setBusy("");
    }
  }

  async function approvePaper(examId: string) {
    setBusy("approve");
    try {
      await act(token, "approveExamMarks", { examId });
      setPicked(null);
      await onRan("Mark sheet approved");
    } finally {
      setBusy("");
    }
  }

  function exportSheet() {
    const csv = marksReviewCsv({
      seriesName,
      classLabel,
      exams: papers,
      students: rows,
      marks,
    });
    downloadCsv(`${seriesName} ${classLabel}.csv`.replace(/\s+/g, "-"), csv);
  }

  if (!exams.length) {
    return (
      <View className="items-center px-4 py-10">
        <Text className="text-sm font-medium text-ink-900">No papers in this sitting yet</Text>
        <Text className="mt-1 text-center text-sm text-ink-700">Schedule the exam on Exam setup first. This sheet is built from those papers.</Text>
      </View>
    );
  }

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-base font-semibold text-ink-900">
          {seriesName} · {classLabel}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {canPublish && approvedCount ? (
            <Button disabled={Boolean(pending)} onPress={onPublish}>
              Publish {approvedCount} to parents
            </Button>
          ) : null}
          <Button variant="ghost" onPress={exportSheet}>
            Export
          </Button>
        </View>
      </View>
      <View className="flex-row flex-wrap items-center gap-2">
        <View className="min-w-[220px] flex-1">
          <Input value={query} onChangeText={setQuery} placeholder="Search student or admission no." />
        </View>
        <ChipScroller>
          {(
            [
              ["", "All"],
              ["PENDING", "Pending"],
              ["CORRECTION_REQUIRED", "Correction"],
              ["SUBMITTED", "Submitted"],
              ["APPROVED", "Approved"],
              ["PUBLISHED", "Published"],
            ] as const
          ).map(([id, label]) => (
            <Chip key={id || "all"} label={label} active={status === id} onPress={() => setStatus(id)} />
          ))}
        </ChipScroller>
      </View>
      <Text className="text-xs text-ink-700">
        {sessionLabel ? `${sessionLabel} · ` : ""}
        {students.length} students · {exams.length} subjects · {completeCells}/{totalCells || 0} complete · {pendingCells} pending
        {correctionCells ? ` · ${correctionCells} correction` : ""}
      </Text>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-1.5 pb-1">
          <Chip label="All subjects" active={!subjectId} onPress={() => setSubjectId("")} />
          {completions.map((row) => {
            const on = subjectId === row.exam.subject.id;
            return (
              <Pressable
                key={row.exam.id}
                onPress={() => setSubjectId(on ? "" : row.exam.subject.id)}
                className={`rounded-md border px-2.5 py-1.5 ${on ? "border-ink-900 bg-ink-900" : "border-ink-200 bg-white"}`}
              >
                <Text className={`text-xs ${on ? "text-white" : "text-ink-900"}`}>
                  {row.exam.subject.name}
                  <Text className={on ? "text-white/70" : row.pending || row.correction ? "text-amber-800" : "text-ink-700"}>
                    {`  ${row.entered}/${row.studentCount}`}
                  </Text>
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
        <ScrollView horizontal nestedScrollEnabled>
          <View>
            <View className="flex-row border-b border-ink-200 bg-ink-50">
              <Pressable onPress={() => setSort("admission")} className="w-[108px] justify-center border-r border-ink-100 bg-ink-50 px-3 py-2.5" style={sticky ? { ...sticky, left: 0 } : undefined}>
                <Text className="text-[10px] font-medium uppercase tracking-wide text-ink-700">Admission</Text>
              </Pressable>
              <Pressable onPress={() => setSort("name")} className="w-[156px] justify-center border-r border-ink-100 bg-ink-50 px-3 py-2.5" style={sticky ? { ...sticky, left: 108 } : undefined}>
                <Text className="text-[10px] font-medium uppercase tracking-wide text-ink-700">Student</Text>
              </Pressable>
              {papers.map((exam) => (
                <Pressable key={exam.id} onPress={() => setSubjectId(exam.subject.id)} className="w-[92px] items-center border-r border-ink-100 px-1.5 py-2">
                  <Text className="text-center text-xs font-semibold text-ink-900" numberOfLines={1}>
                    {exam.subject.name}
                  </Text>
                  <Text className="text-[10px] text-ink-700">/{exam.maxMarks}</Text>
                </Pressable>
              ))}
              <View className="w-[72px] items-center justify-center px-2 py-2">
                <Text className="text-[10px] font-medium uppercase tracking-wide text-ink-700">Total</Text>
              </View>
              <View className="w-[56px] items-center justify-center px-2 py-2">
                <Text className="text-[10px] font-medium uppercase tracking-wide text-ink-700">%</Text>
              </View>
            </View>
            <ScrollView nestedScrollEnabled style={{ maxHeight: 520 }}>
              {rows.map((student) => {
                const studentMarks = marks.filter((row) => row.studentId === student.id);
                const score = sheetRowScore(papers, studentMarks);
                return (
                  <View key={student.id} className="flex-row border-b border-ink-50">
                    <View className="w-[108px] justify-center border-r border-ink-100 bg-white px-3 py-2" style={sticky ? { ...sticky, left: 0 } : undefined}>
                      <Text className="text-xs text-ink-800" numberOfLines={1}>
                        {student.admissionNo || "—"}
                      </Text>
                    </View>
                    <View className="w-[156px] justify-center border-r border-ink-100 bg-white px-3 py-2" style={sticky ? { ...sticky, left: 108 } : undefined}>
                      <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>
                        {student.name}
                      </Text>
                    </View>
                    {papers.map((exam) => {
                      const mark = byKey.get(`${exam.id}:${student.id}`);
                      if (status === "PENDING" && mark) return <View key={exam.id} className="w-[92px] border-r border-ink-50" />;
                      const cell = sheetCellState({ workflowStatus: exam.workflowStatus, mark });
                      return (
                        <Pressable
                          key={exam.id}
                          onPress={() => void openCell(exam.id, student.id)}
                          className={`w-[92px] items-center justify-center border-r border-ink-50 py-2 ${cellClass(cell.kind)}`}
                        >
                          <Text className={`text-xs font-medium ${cellColor(cell.kind)}`}>
                            {cell.kind === "pending" || cell.kind === "correction" || cell.label.startsWith("✓") || cell.label === "Ab"
                              ? cell.label
                              : `${cell.label}/${exam.maxMarks}`}
                          </Text>
                        </Pressable>
                      );
                    })}
                    <View className="w-[72px] items-center justify-center px-2 py-2">
                      <Text className="text-xs font-medium text-ink-900">{score.entered ? `${score.total}/${score.max}` : "—"}</Text>
                    </View>
                    <View className="w-[56px] items-center justify-center px-2 py-2">
                      <Text className="text-xs text-ink-700">{score.entered ? `${score.pct}` : "—"}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </ScrollView>
      </View>
      <Modal
        open={Boolean(picked)}
        onClose={() => setPicked(null)}
        title={pickedExam?.subject.name || "Mark"}
        footer={
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button variant="ghost" onPress={() => setPicked(null)}>
              Close
            </Button>
            {pickedExam && canEdit && pickedExam.workflowStatus !== "PUBLISHED" && pickedExam.workflowStatus !== "APPROVED" ? (
              <Button variant="ghost" disabled={Boolean(busy || pending)} onPress={() => void remind(pickedExam.id)}>
                Send reminder
              </Button>
            ) : null}
            {pickedExam && canEdit && (pickedExam.workflowStatus === "SUBMITTED" || pickedExam.workflowStatus === "UNDER_REVIEW" || pickedExam.workflowStatus === "RESUBMITTED") ? (
              <Button disabled={Boolean(busy || pending)} onPress={() => void approvePaper(pickedExam.id)}>
                Approve paper
              </Button>
            ) : null}
            {pickedExam && canEdit && pickedExam.workflowStatus !== "PUBLISHED" && pickedMark ? (
              <Button disabled={Boolean(busy || pending) || !reason.trim()} onPress={() => void requestCorrection()}>
                Request correction
              </Button>
            ) : null}
          </View>
        }
      >
        {pickedExam && pickedStudent ? (
          <View className="gap-3">
            <View className="gap-1">
              <Text className="text-sm font-medium text-ink-900">{pickedStudent.name}</Text>
              <Text className="text-xs text-ink-700">Admission {pickedStudent.admissionNo || "—"}</Text>
            </View>
            <Text className="text-sm text-ink-700">
              {seriesName} · {classLabel}
              {"\n"}Status: {pickedMark ? workflowLabel(pickedExam.workflowStatus) : "Awaiting marks"}
              {"\n"}Teacher: {pickedExam.teacherName || "—"}
              {"\n"}Maximum: {pickedExam.maxMarks}
              {"\n"}Current: {pickedMark ? (pickedMark.absent ? "Absent" : `${pickedMark.marks} / ${pickedExam.maxMarks}`) : "PENDING"}
            </Text>
            {pickedMark?.correctionNote ? (
              <Text className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{pickedMark.correctionNote}</Text>
            ) : null}
            {pickedExam.workflowStatus !== "PUBLISHED" && pickedMark && canEdit ? (
              <Input value={reason} onChangeText={setReason} placeholder="Reason for the subject teacher" />
            ) : null}
            <View>
              <Text className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-700">History</Text>
              {history.length ? (
                history.map((row) => (
                  <Text key={row.id} className="mb-2 text-xs text-ink-700">
                    {row.action.replace(/_/g, " ")} · {row.absent ? "Absent" : row.marks} · {row.actorName}
                    {row.note ? `\n${row.note}` : ""}
                    {`\n${new Date(row.at).toLocaleString("en-IN")}`}
                  </Text>
                ))
              ) : (
                <Text className="text-xs text-ink-700">No history yet for this cell.</Text>
              )}
            </View>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}
