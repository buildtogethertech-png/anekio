import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { act } from "../lib/mutate";
import { marksReviewCsv, sheetCellState, sheetRowScore, subjectCompletion } from "../lib/exam-marks";
import { workflowLabel } from "../lib/exam-workflow";
import { Badge, Button, Chip, ChipScroller, Input, Modal } from "./ui";
import { studentMetaLine } from "../lib/student-label";
import { subjectLabel } from "../lib/subject-label";

type Exam = {
  id: string;
  maxMarks: number;
  teacherId?: string | null;
  teacherName?: string;
  subject: { id: string; name: string; code?: string; label?: string };
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

type Student = { id: string; name: string; admissionNo?: string; rollNumber?: number | null; classId: string };

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
  const [missingOnly, setMissingOnly] = useState(false);
  const { width } = useWindowDimensions();
  const narrow = width < 760;

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
      return [student.name, student.rollNumber, student.admissionNo].join(" ").toLowerCase().includes(needle);
    })
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name) || String(a.admissionNo).localeCompare(String(b.admissionNo))
        : (a.rollNumber || 0) - (b.rollNumber || 0) || String(a.admissionNo).localeCompare(String(b.admissionNo)) || a.name.localeCompare(b.name)
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

  async function remind(examId: string) {
    setBusy("remind");
    try {
      await act(token, "remindExamMarks", { examId });
      await onRan("Reminder sent to the subject teacher");
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

  const waiting = completions.filter((c) => c.pending > 0);
  const allPublished = exams.length > 0 && exams.every((e) => e.workflowStatus === "PUBLISHED");
  const ready = !waiting.length && !allPublished;
  const shown = missingOnly
    ? rows.filter((student) => papers.some((exam) => !byKey.get(`${exam.id}:${student.id}`)))
    : rows;
  const nameOf = (exam: Exam) => exam.subject.name;
  const shortOf = (exam: Exam) => (exam.subject.code || exam.subject.name).replace(/-\d+$/, "").slice(0, 4).toUpperCase();

  function cellText(exam: Exam, studentId: string) {
    const mark = byKey.get(`${exam.id}:${studentId}`);
    if (!mark) return { text: "—", tone: "missing" as const };
    if (mark.absent) return { text: "AB", tone: "absent" as const };
    return { text: String(mark.marks), tone: "ok" as const };
  }
  const toneClass = { missing: "bg-amber-50", absent: "", ok: "" };
  const toneText = { missing: "text-amber-700", absent: "text-ink-500", ok: "text-ink-900" };

  return (
    <View className="gap-4">
      <View className="flex-row items-center justify-between gap-3">
        <Text className={`min-w-0 flex-1 ${narrow ? "text-[22px]" : "text-[26px]"} font-bold tracking-tight text-ink-900`}>
          {seriesName} · {classLabel} · Marks
        </Text>
        {narrow ? (
          <Pressable accessibilityRole="button" onPress={exportSheet} className="h-9 flex-row items-center gap-1 rounded-lg border border-ink-200 bg-white px-3">
            <Text className="text-[13px] font-medium text-ink-800">Export</Text>
          </Pressable>
        ) : (
          <Button variant="ghost" onPress={exportSheet}>
            Export
          </Button>
        )}
      </View>

      <View className={`rounded-xl border border-ink-200 bg-white px-4 py-3 ${narrow ? "gap-3" : "flex-row items-center gap-4"}`}>
        <View className="min-w-0 flex-1">
          <Text className="text-[14px] font-semibold text-ink-900">
            {allPublished
              ? "All papers published"
              : `${exams.length - waiting.length} of ${exams.length} papers complete`}
          </Text>
          <Text className="mt-0.5 text-[13px] text-ink-600">
            {allPublished
              ? "Parents can see these marks."
              : waiting.length
                ? `${waiting.map((c) => nameOf(c.exam as Exam)).join(", ")} still ${waiting.length === 1 ? "needs" : "need"} marks`
                : "Every paper has marks. Publish when you are ready."}
          </Text>
        </View>
        {canPublish && !allPublished ? (
          <Button disabled={!ready || Boolean(pending)} onPress={onPublish}>
            Publish results
          </Button>
        ) : null}
      </View>

      <View className="flex-row flex-wrap items-center gap-2">
        <View className="min-w-[200px] flex-1">
          <Input value={query} onChangeText={setQuery} placeholder="Search student" />
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: missingOnly }}
          onPress={() => setMissingOnly((v) => !v)}
          className={`h-10 flex-row items-center gap-2 rounded-lg border px-3 ${missingOnly ? "border-amber-300 bg-amber-50" : "border-ink-200 bg-white"}`}
        >
          <View className={`h-4 w-7 justify-center rounded-full px-0.5 ${missingOnly ? "items-end bg-amber-500" : "items-start bg-ink-200"}`}>
            <View className="h-3 w-3 rounded-full bg-white" />
          </View>
          <Text className={`text-[13px] font-medium ${missingOnly ? "text-amber-800" : "text-ink-700"}`}>Missing marks only</Text>
        </Pressable>
      </View>

      {narrow ? (
        <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
          {shown.length ? (
            shown.map((student, index) => {
              const score = sheetRowScore(papers, marks.filter((row) => row.studentId === student.id));
              return (
                <View key={student.id} className={`px-4 py-3 ${index ? "border-t border-ink-100" : ""}`}>
                  <View className="flex-row items-center gap-3">
                    <Text className="w-6 text-[13px] tabular-nums text-ink-400">{student.rollNumber ?? ""}</Text>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[15px] font-semibold text-ink-900" numberOfLines={1}>{student.name}</Text>
                      <Text className="text-[12px] text-ink-500">{student.admissionNo || ""}</Text>
                    </View>
                    <Text className="text-[15px] font-semibold tabular-nums text-ink-900">
                      {score.entered ? `${Math.round(score.pct)}%` : "—"}
                    </Text>
                  </View>
                  <View className="ml-9 mt-2 flex-row flex-wrap gap-1.5">
                    {papers.map((exam) => {
                      const c = cellText(exam, student.id);
                      return (
                        <Pressable
                          key={exam.id}
                          onPress={() => void openCell(exam.id, student.id)}
                          className={`flex-row items-center gap-1 rounded-md border px-2 py-1 ${c.tone === "missing" ? "border-amber-200 bg-amber-50" : "border-ink-100 bg-ink-50/60"}`}
                        >
                          <Text className="text-[11px] text-ink-500">{shortOf(exam)}</Text>
                          <Text className={`text-[12px] font-semibold tabular-nums ${toneText[c.tone]}`}>{c.text}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })
          ) : (
            <Text className="px-4 py-8 text-center text-[13px] text-ink-500">{missingOnly ? "No missing marks." : "No one matches that search."}</Text>
          )}
        </View>
      ) : (
        <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
          <ScrollView horizontal nestedScrollEnabled>
            <View>
              <View className="flex-row border-b border-ink-200 bg-ink-50">
                <View className="w-[44px] justify-center bg-ink-50 px-3 py-2.5" style={sticky ? { ...sticky, left: 0 } : undefined}>
                  <Text className="text-[11px] font-medium text-ink-500">#</Text>
                </View>
                <View className="w-[200px] justify-center border-r border-ink-200 bg-ink-50 px-3 py-2.5" style={sticky ? { ...sticky, left: 44 } : undefined}>
                  <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500">Student</Text>
                </View>
                {papers.map((exam) => (
                  <View key={exam.id} className="w-[84px] items-center justify-center px-1.5 py-2">
                    <View className="flex-row items-center gap-1">
                      <Text className="text-[12px] font-semibold text-ink-900" numberOfLines={1}>{shortOf(exam)}</Text>
                      {exam.workflowStatus === "PUBLISHED" ? <View className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> : null}
                    </View>
                    <Text className="text-[10px] text-ink-500">/{exam.maxMarks}</Text>
                  </View>
                ))}
                <View className="w-[72px] items-center justify-center border-l border-ink-200 px-2 py-2">
                  <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500">Total</Text>
                </View>
                <View className="w-[56px] items-center justify-center px-2 py-2">
                  <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500">%</Text>
                </View>
              </View>
              <ScrollView nestedScrollEnabled style={{ maxHeight: 560 }}>
                {shown.length ? (
                  shown.map((student) => {
                    const score = sheetRowScore(papers, marks.filter((row) => row.studentId === student.id));
                    return (
                      <View key={student.id} className="flex-row border-b border-ink-100">
                        <View className="w-[44px] justify-center bg-white px-3 py-2" style={sticky ? { ...sticky, left: 0 } : undefined}>
                          <Text className="text-[13px] tabular-nums text-ink-400">{student.rollNumber ?? ""}</Text>
                        </View>
                        <View className="w-[200px] justify-center border-r border-ink-200 bg-white px-3 py-2" style={sticky ? { ...sticky, left: 44 } : undefined}>
                          <Text className="text-[14px] font-medium text-ink-900" numberOfLines={1}>{student.name}</Text>
                          <Text className="text-[11px] text-ink-500" numberOfLines={1}>{student.admissionNo || ""}</Text>
                        </View>
                        {papers.map((exam) => {
                          const c = cellText(exam, student.id);
                          return (
                            <Pressable
                              key={exam.id}
                              onPress={() => void openCell(exam.id, student.id)}
                              className={`w-[84px] items-center justify-center py-2 hover:bg-ink-50 ${toneClass[c.tone]}`}
                            >
                              <Text className={`text-[14px] tabular-nums ${c.tone === "ok" ? "font-medium" : "font-semibold"} ${toneText[c.tone]}`}>{c.text}</Text>
                            </Pressable>
                          );
                        })}
                        <View className="w-[72px] items-center justify-center border-l border-ink-200 px-2 py-2">
                          <Text className="text-[14px] font-semibold tabular-nums text-ink-900">{score.entered ? score.total : "—"}</Text>
                        </View>
                        <View className="w-[56px] items-center justify-center px-2 py-2">
                          <Text className="text-[13px] tabular-nums text-ink-600">{score.entered ? `${Math.round(score.pct)}%` : "—"}</Text>
                        </View>
                      </View>
                    );
                  })
                ) : (
                  <Text className="px-4 py-8 text-center text-[13px] text-ink-500">{missingOnly ? "No missing marks." : "No one matches that search."}</Text>
                )}
              </ScrollView>
            </View>
          </ScrollView>
        </View>
      )}
      <Text className="text-[12px] text-ink-500">Tap a mark to see its history. Amber “—” = not entered yet · AB = absent · green dot = published.</Text>
      <Modal
        open={Boolean(picked)}
        onClose={() => setPicked(null)}
        title={pickedExam && pickedStudent ? `${pickedStudent.name} · ${nameOf(pickedExam)}` : "Mark"}
        footer={
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button variant="ghost" onPress={() => setPicked(null)}>
              Close
            </Button>
            {pickedExam && canEdit && !pickedMark && pickedExam.workflowStatus !== "PUBLISHED" ? (
              <Button disabled={Boolean(busy || pending)} onPress={() => void remind(pickedExam.id)}>
                Remind teacher
              </Button>
            ) : null}
          </View>
        }
      >
        {pickedExam && pickedStudent ? (
          <View className="gap-3">
            <View className="flex-row items-end justify-between rounded-xl bg-ink-50 px-4 py-3">
              <View>
                <Text className="text-[12px] text-ink-500">Mark</Text>
                <Text className="text-[22px] font-bold tabular-nums text-ink-900">
                  {pickedMark ? (pickedMark.absent ? "Absent" : `${pickedMark.marks} / ${pickedExam.maxMarks}`) : "Not entered"}
                </Text>
              </View>
              <Text className="text-[12px] text-ink-500">{pickedExam.teacherName || ""}</Text>
            </View>
            <View>
              <Text className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-500">History</Text>
              {history.length ? (
                history.map((row) => (
                  <View key={row.id} className="mb-2">
                    <Text className="text-[13px] text-ink-800">
                      {row.absent ? "Absent" : row.marks} · {row.actorName}
                    </Text>
                    <Text className="text-[11px] text-ink-500">
                      {new Date(row.at).toLocaleString("en-IN")}
                      {row.note ? ` · ${row.note}` : ""}
                    </Text>
                  </View>
                ))
              ) : (
                <Text className="text-[13px] text-ink-500">No changes yet.</Text>
              )}
            </View>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}
