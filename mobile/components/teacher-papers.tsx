import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal as RnModal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { act } from "../lib/mutate";
import { useRecord, type RecordPayload } from "../lib/record";
import { useSession } from "../lib/session";
import { Toast, useToast } from "./ui";
import { PaperHandoverSheet } from "./paper-handover";
import { prettyTimeRange } from "./exam-time-field";

/**
 * Teacher exams, kept simple: every paper is three steps.
 *   1 Paper ready (one tap: "I gave it to the office")  →  2 Exam day (ticks itself)  →  3 Enter marks.
 * Marks are typed on one screen in roll-number order, with a number keypad and Next to jump down.
 */

type Sheet = NonNullable<RecordPayload["markSheets"]>[number];
type Student = Sheet["students"][number];

const SENT = ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW", "APPROVED", "PUBLISHED"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pretty(value?: string, withDay = false) {
  const s = (value || "").slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return "";
  const day = withDay ? `${DAYS[new Date(y, m - 1, d).getDay()]}, ` : "";
  return `${day}${d} ${MONTHS[m - 1]}`;
}

export function isSent(sheet: Sheet) {
  // Only makes the paper (someone else checks): done once the office has it.
  if (sheet.isChecker === false) return Boolean(sheet.paperDone);
  return SENT.includes(sheet.workflowStatus || "");
}

function filledCount(sheet: Sheet) {
  return sheet.students.filter((s) => s.absent || s.marks != null).length;
}

export function TeacherPapersBoard() {
  const { data, reload } = useRecord();
  const { token } = useSession();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const sheets = data?.markSheets ?? [];
  const [tab, setTab] = useState<"todo" | "done">("todo");
  const [openId, setOpenId] = useState("");
  const [busy, setBusy] = useState("");

  const todo = sheets.filter((s) => !isSent(s));
  const done = sheets.filter(isSent);
  const lateCount = todo.filter((s) => paperInfo(s).late).length;
  const list = (tab === "todo" ? todo : done)
    .slice()
    .sort((a, b) =>
      tab === "todo"
        ? paperInfo(a).rank - paperInfo(b).rank || (a.date || "").localeCompare(b.date || "")
        : (b.date || "").localeCompare(a.date || "")
    );
  const leadId = tab === "todo" ? list.find((s) => paperInfo(s).primary)?.examId : undefined;
  const groups = useMemo(() => {
    const map = new Map<string, Sheet[]>();
    for (const sheet of list) {
      const key = [sheet.seriesName || "Exams", sheet.classLabel].filter(Boolean).join(" · ");
      map.set(key, [...(map.get(key) || []), sheet]);
    }
    return [...map.entries()];
  }, [list]);
  const open = sheets.find((s) => s.examId === openId) || null;

  const [handoverId, setHandoverId] = useState("");
  const handoverSheet = sheets.find((s) => s.examId === handoverId) || null;

  return (
    <ScrollView className="min-h-0 flex-1 bg-[#F7F9FC]" contentContainerClassName={wide ? "w-full max-w-[920px] self-center px-8 py-6" : "px-4 pb-8 pt-4"}>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="mb-4 flex-row flex-wrap items-end justify-between gap-3">
        <View className="flex-row items-center gap-2">
          <Text className="text-[24px] font-bold tracking-tight text-ink-900">My exam papers</Text>
          {lateCount ? (
            <View className="rounded-full bg-red-50 px-2.5 py-1">
              <Text className="text-[12px] font-semibold text-red-700">{lateCount} late</Text>
            </View>
          ) : null}
        </View>
        <View className="flex-row rounded-lg bg-ink-100 p-0.5">
          {(["todo", "done"] as const).map((key) => (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              onPress={() => setTab(key)}
              className={`h-8 justify-center rounded-md px-4 ${tab === key ? "border border-ink-200 bg-white" : "border border-transparent"}`}
              style={tab === key ? { shadowColor: "#0F172A", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : undefined}
            >
              <Text className={`text-[13px] ${tab === key ? "font-semibold text-ink-900" : "font-medium text-ink-500"}`}>
                {key === "todo" ? `To do · ${todo.length}` : `Done · ${done.length}`}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {!list.length ? (
        <View className="items-center rounded-xl border border-dashed border-ink-200 bg-white px-6 py-12">
          <Ionicons name={tab === "todo" ? "checkmark-done-circle-outline" : "documents-outline"} size={34} color="#94A3B8" />
          <Text className="mt-3 text-[15px] font-semibold text-ink-900">{tab === "todo" ? "You're all caught up" : "No finished papers yet"}</Text>
          <Text className="mt-1 text-center text-[13px] text-ink-600">
            {tab === "todo" ? "When the office schedules an exam, your papers show up here." : "Papers move here after you send the marks."}
          </Text>
        </View>
      ) : (
        groups.map(([name, rows]) => (
          <View key={name} className="mb-5">
            <Text className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-500">{name}</Text>
            <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
              {rows.map((sheet, i) => (
                <PaperRow
                  key={sheet.examId}
                  sheet={sheet}
                  first={i === 0}
                  lead={sheet.examId === leadId}
                  busy={busy === sheet.examId}
                  onPaperGiven={() => setHandoverId(sheet.examId)}
                  onMarks={() => setOpenId(sheet.examId)}
                />
              ))}
            </View>
          </View>
        ))
      )}

      <PaperHandoverSheet
        sheet={handoverSheet}
        token={token}
        onClose={() => setHandoverId("")}
        onDone={async (message) => {
          setHandoverId("");
          toast.show(message);
          await reload();
        }}
      />
      <MarkEntryScreen
        sheet={open}
        token={token}
        onClose={() => setOpenId("")}
        onSaved={async (message) => {
          setOpenId("");
          if (message) toast.show(message);
          await reload();
        }}
        onDraft={() => void reload()}
      />
    </ScrollView>
  );
}

type StepState = "done" | "action" | "waiting" | "late";

function Step({ n, title, state, detail, last, stack }: { n: number; title: string; state: StepState; detail: string; last?: boolean; stack?: boolean }) {
  const dot =
    state === "done" ? "bg-emerald-500" : state === "late" ? "bg-red-500" : state === "action" ? "bg-clay-500" : "bg-ink-200";
  if (stack) {
    return (
      <View className="flex-row items-center gap-2.5">
        <View className={`h-5 w-5 items-center justify-center rounded-full ${dot}`}>
          {state === "done" ? <Ionicons name="checkmark" size={12} color="#fff" /> : <Text className={`text-[10px] font-bold ${state === "waiting" ? "text-ink-600" : "text-white"}`}>{n}</Text>}
        </View>
        <Text className={`w-24 text-[13px] font-semibold ${state === "waiting" ? "text-ink-600" : "text-ink-900"}`}>{title}</Text>
        <Text className={`min-w-0 flex-1 text-[13px] ${state === "late" ? "font-medium text-red-700" : "text-ink-500"}`} numberOfLines={1}>{detail}</Text>
      </View>
    );
  }
  return (
    <View className="min-w-0 flex-1 flex-row items-start gap-2">
      <View className="items-center">
        <View className={`h-6 w-6 items-center justify-center rounded-full ${dot}`}>
          {state === "done" ? <Ionicons name="checkmark" size={14} color="#fff" /> : <Text className={`text-[11px] font-bold ${state === "waiting" ? "text-ink-600" : "text-white"}`}>{n}</Text>}
        </View>
      </View>
      <View className="min-w-0 flex-1 pr-1">
        <Text className={`text-[13px] font-semibold ${state === "waiting" ? "text-ink-600" : "text-ink-900"}`} numberOfLines={1}>{title}</Text>
        <Text className={`text-[12px] ${state === "late" ? "font-medium text-red-700" : "text-ink-500"}`} numberOfLines={2}>{detail}</Text>
      </View>
      {!last ? <View className="mt-3 hidden h-px w-4 bg-ink-200 sm:flex" /> : null}
    </View>
  );
}

/** Subject without its short code: "MAT · Mathematics" → "Mathematics". */
export function subjectName(subject: string) {
  return subject.replace(/^[A-Z0-9-]{2,12}\s*·\s*/, "");
}

type PaperInfo = {
  late: boolean;
  parts: { text: string; tone?: "late" | "fix" }[];
  primary: { label: string; kind: "marks" | "paper" | "waiting" | "view"; danger?: boolean } | null;
  rank: number;
};

/** Only the step the teacher is on, said as one sentence. */
export function paperInfo(sheet: Sheet): PaperInfo {
  const now = today();
  const examDay = sheet.date || "";
  const held = Boolean(examDay && examDay <= now);
  const sent = isSent(sheet);
  const correction = sheet.workflowStatus === "CORRECTION_REQUIRED";
  const filled = filledCount(sheet);
  const total = sheet.students.length;
  const owesPaper = sheet.isSetter && !sheet.paperDone && !held;
  const paperLate = Boolean(owesPaper && sheet.paperDueOn && sheet.paperDueOn < now);
  const marksLate = Boolean(!sent && held && sheet.copiesDueOn && sheet.copiesDueOn < now);

  if (sent && sheet.isChecker === false) {
    return { late: false, parts: [{ text: "Question paper with the office" }, { text: `exam ${pretty(examDay)}` }], primary: null, rank: 9 };
  }
  if (sent) {
    return {
      late: false,
      parts: [{ text: `Held ${pretty(examDay)}` }, { text: sheet.workflowStatus === "PUBLISHED" ? "Published to parents" : "Sent to the office" }],
      primary: { label: "View marks", kind: "view" },
      rank: 9,
    };
  }
  if (correction) {
    return {
      late: true,
      parts: [{ text: "Office asked for a fix", tone: "fix" }],
      primary: sheet.canEnterMarks ? { label: "Fix marks", kind: "marks", danger: true } : null,
      rank: 0,
    };
  }
  if (owesPaper && sheet.paperWaiting) {
    return {
      late: false,
      parts: [{ text: "With the exam office · waiting to confirm" }, { text: `exam ${pretty(examDay)}` }],
      primary: { label: "Waiting", kind: "waiting" },
      rank: 3,
    };
  }
  if (owesPaper && sheet.paperReturnNote) {
    return {
      late: true,
      parts: [{ text: `Sent back: ${sheet.paperReturnNote}`, tone: "fix" }],
      primary: { label: "Hand over again", kind: "paper", danger: true },
      rank: 0,
    };
  }
  if (sheet.isChecker === false && held && !sheet.paperDone && !sheet.paperWaiting) {
    return { late: true, parts: [{ text: "Question paper not given yet" }, { text: `exam was ${pretty(examDay)}` }], primary: { label: "Paper given", kind: "paper" }, rank: 1 };
  }
  if (owesPaper) {
    return {
      late: paperLate,
      parts: [
        { text: `Give paper to office by ${pretty(sheet.paperDueOn)}` },
        { text: `exam ${pretty(examDay)}` },
        ...(paperLate ? [{ text: "Late", tone: "late" as const }] : []),
      ],
      primary: { label: "Paper given", kind: "paper" },
      rank: paperLate ? 1 : 3,
    };
  }
  if (!held) {
    const time = prettyTimeRange(sheet.startTime, sheet.endTime);
    return { late: false, parts: [{ text: `Exam on ${pretty(examDay, true)}${time ? `, ${time}` : ""}` }, { text: "marks after that" }], primary: null, rank: 4 };
  }
  return {
    late: marksLate,
    parts: [
      { text: `${filled}/${total} marks entered` },
      marksLate ? { text: "Late", tone: "late" } : { text: `due ${pretty(sheet.copiesDueOn)}` },
    ],
    primary: sheet.canEnterMarks ? { label: filled ? "Continue" : "Enter marks", kind: "marks" } : null,
    rank: marksLate ? 1 : 2,
  };
}

function PaperRow({
  sheet,
  first,
  lead,
  busy,
  onPaperGiven,
  onMarks,
}: {
  sheet: Sheet;
  first: boolean;
  lead: boolean;
  busy: boolean;
  onPaperGiven: () => void;
  onMarks: () => void;
}) {
  const [openSteps, setOpenSteps] = useState(false);
  const info = paperInfo(sheet);
  const now = today();
  const examDay = sheet.date || "";
  const held = Boolean(examDay && examDay <= now);
  const sent = isSent(sheet);
  const correction = sheet.workflowStatus === "CORRECTION_REQUIRED";
  const filled = filledCount(sheet);
  const paperLate = !sheet.paperDone && sheet.paperDueOn && sheet.paperDueOn < now;
  const marksLate = !sent && sheet.copiesDueOn && sheet.copiesDueOn < now;
  const paperState: StepState = sheet.paperDone || !sheet.isSetter || held ? "done" : paperLate ? "late" : "action";
  const marksState: StepState = sent ? "done" : correction ? "late" : !held ? "waiting" : marksLate ? "late" : "action";
  const p = info.primary;
  const filledBtn = p && (lead || p.danger);

  return (
    <View className={first ? "" : "border-t border-ink-100"}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${subjectName(sheet.subject)}, show steps`}
        onPress={() => setOpenSteps((v) => !v)}
        className="flex-row items-center gap-3 px-4 py-3.5 active:bg-ink-50 hover:bg-ink-50/60"
      >
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
            <Text className="shrink text-[15px] font-semibold text-ink-900" numberOfLines={2}>
              {subjectName(sheet.subject)}
            </Text>
            {info.late ? (
              <View className="rounded-full bg-red-50 px-2 py-0.5">
                <Text className="text-[11px] font-semibold text-red-700">{correction ? "Fix" : "Late"}</Text>
              </View>
            ) : null}
          </View>
          <Text className={`text-[13px] ${correction ? "text-red-700" : "text-ink-500"}`} numberOfLines={2}>
            {info.parts.filter((part) => part.tone !== "late").map((part) => part.text).join(" · ")}
          </Text>
        </View>
        {p ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={p.kind === "paper" || p.kind === "waiting" ? onPaperGiven : onMarks}
            className={`min-h-[34px] shrink-0 flex-row items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 ${
              p.kind === "waiting" ? "border border-amber-200 bg-amber-50" : p.danger ? "bg-red-600" : filledBtn ? "bg-clay-500" : "border border-ink-200 bg-white"
            } ${busy ? "opacity-60" : ""}`}
          >
            {p.kind === "waiting" ? <Ionicons name="time-outline" size={13} color="#B45309" /> : null}
            {busy ? <ActivityIndicator size="small" color={filledBtn ? "#fff" : "#2563EB"} /> : null}
            <Text className={`text-[13px] font-semibold ${p.kind === "waiting" ? "text-amber-800" : filledBtn ? "text-white" : "text-ink-800"}`} numberOfLines={1}>{p.label}</Text>
          </Pressable>
        ) : (
          <Ionicons name={openSteps ? "chevron-up" : "chevron-down"} size={16} color="#94A3B8" />
        )}
      </Pressable>
      {openSteps ? (
        <View className="mx-4 mb-3.5 gap-1.5 rounded-lg bg-ink-50/70 px-3 py-2.5">
          <Step stack n={1} title="Paper ready" state={paperState} detail={sheet.paperDone ? "Received by the office" : sheet.paperWaiting ? "With the office · waiting to confirm" : !sheet.isSetter ? "Another teacher sets it" : held ? "Exam already held" : `By ${pretty(sheet.paperDueOn, true)}`} />
          <Step stack n={2} title="Exam day" state={held ? "done" : "waiting"} detail={held ? `Held ${pretty(examDay)}` : pretty(examDay, true)} />
          <Step stack n={3} title="Marks" state={marksState} detail={sent ? (sheet.workflowStatus === "PUBLISHED" ? "Published to parents" : "Sent to the office") : `${filled}/${sheet.students.length} · due ${pretty(sheet.copiesDueOn)}`} last />
        </View>
      ) : null}
      {correction && sheet.correctionNote ? (
        <View className="mx-4 mb-3.5 flex-row items-start gap-2 rounded-lg bg-red-50 px-3 py-2">
          <Ionicons name="chatbubble-ellipses-outline" size={15} color="#B91C1C" />
          <Text className="min-w-0 flex-1 text-[13px] text-red-800">{sheet.correctionNote}</Text>
        </View>
      ) : null}
    </View>
  );
}

type Cell = { value: string; absent: boolean };

function cellFor(s: Student): Cell {
  return { value: s.absent ? "" : s.marks != null ? String(s.marks) : "", absent: s.absent };
}

/** Full-screen marks: one row per student, roll order, keypad + Next, autosave, Submit at the bottom. */
/** Full-screen marks entry (autosaves). Also opened from the teacher home "Enter marks" to-do. */
export function MarkEntryScreen({
  sheet,
  token,
  onClose,
  onSaved,
  onDraft,
}: {
  sheet: Sheet | null;
  token: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
  onDraft: () => void;
}) {
  const { width } = useWindowDimensions();
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [pending, setPending] = useState<Record<string, Cell>>({});
  const [saving, setSaving] = useState<"" | "draft" | "submit">("");
  const [savedAt, setSavedAt] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  // Published marks: teacher can still change them (parent query). Needs a reason; goes live at once.
  const [editPublished, setEditPublished] = useState(false);
  const [reason, setReason] = useState("");
  const inputs = useRef<(TextInput | null)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedOnce = useRef(false);

  const students = useMemo(
    () => (sheet?.students ?? []).slice().sort((a, b) => (a.rollNumber ?? 9999) - (b.rollNumber ?? 9999) || a.name.localeCompare(b.name)),
    [sheet]
  );
  const max = sheet?.maxMarks ?? 100;
  const published = sheet?.workflowStatus === "PUBLISHED";
  const readOnly = !sheet || (isSent(sheet) ? !editPublished : !sheet.canEnterMarks);
  const correction = sheet?.workflowStatus === "CORRECTION_REQUIRED";
  const fixOnly = correction && students.some((s) => s.correctionRequested);

  useEffect(() => {
    if (!sheet) return;
    setCells(Object.fromEntries(sheet.students.map((s) => [s.id, cellFor(s)])));
    setPending({});
    setSavedAt("");
    setError("");
    setConfirm(false);
    setEditPublished(false);
    setReason("");
    savedOnce.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet?.examId]);

  const problem = (c?: Cell) => {
    if (!c || c.absent || !c.value.trim()) return "";
    const n = Number(c.value);
    if (Number.isNaN(n) || n < 0) return "Not a mark";
    if (n > max) return `Max ${max}`;
    return "";
  };
  const done = students.filter((s) => cells[s.id]?.absent || (cells[s.id]?.value.trim() && !problem(cells[s.id]))).length;
  const left = students.length - done;
  const problems = students.filter((s) => problem(cells[s.id])).length;

  async function flush(next: Record<string, Cell>) {
    if (!sheet || readOnly) return;
    const rows = Object.entries(next)
      .filter(([, c]) => !problem(c))
      .map(([studentId, c]) => ({ studentId, marks: c.absent ? "" : c.value.trim(), absent: c.absent }));
    if (!rows.length) return;
    setSaving("draft");
    try {
      await act(token, "saveExamMarks", { examId: sheet.examId, marks: rows });
      setPending((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => !(id in next))));
      const d = new Date();
      setSavedAt(`${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
      savedOnce.current = true;
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Check the internet and keep typing — we'll retry.");
    } finally {
      setSaving("");
    }
  }

  function update(studentId: string, patch: Partial<Cell>) {
    if (readOnly) return;
    const nextCell = { ...(cells[studentId] || { value: "", absent: false }), ...patch };
    setCells((cur) => ({ ...cur, [studentId]: nextCell }));
    const nextPending = { ...pending, [studentId]: nextCell };
    setPending(nextPending);
    if (editPublished) return; // saved together with a reason
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(nextPending), 900);
  }

  async function close() {
    if (timer.current) clearTimeout(timer.current);
    if (Object.keys(pending).length && !editPublished) await flush(pending);
    if (savedOnce.current) onDraft();
    onClose();
  }

  async function submit() {
    if (!sheet) return;
    if (problems) return setError(`Fix the ${problems} red mark${problems === 1 ? "" : "s"} first.`);
    if (left && !fixOnly) return setError(`${left} student${left === 1 ? "" : "s"} still need marks or Absent.`);
    if (timer.current) clearTimeout(timer.current);
    setSaving("submit");
    setError("");
    try {
      await act(token, "submitExamMarks", {
        examId: sheet.examId,
        marks: students.map((s) => ({ studentId: s.id, marks: cells[s.id]?.absent ? "" : (cells[s.id]?.value || "").trim(), absent: Boolean(cells[s.id]?.absent) })),
      });
      onSaved(`${subjectName(sheet.subject)} · ${sheet.classLabel}: marks sent to the office.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit.");
      setConfirm(false);
    } finally {
      setSaving("");
    }
  }

  const original = new Map((sheet?.students ?? []).map((s) => [s.id, cellFor(s)]));
  const changedIds = students.filter((s) => {
    const a = cells[s.id];
    const b = original.get(s.id);
    return a && b && (a.absent !== b.absent || a.value.trim() !== b.value.trim());
  });

  async function savePublishedChanges() {
    if (!sheet) return;
    if (problems) return setError(`Fix the ${problems} red mark${problems === 1 ? "" : "s"} first.`);
    if (!changedIds.length) return setError("Change at least one mark.");
    if (reason.trim().length < 3) return setError("Write a short reason, e.g. \"Parent query — rechecked\".");
    setSaving("submit");
    setError("");
    try {
      const res = await act<{ ok: true; changed: number }>(token, "editPublishedMarks", {
        examId: sheet.examId,
        reason: reason.trim(),
        changes: changedIds.map((s) => ({ studentId: s.id, marks: cells[s.id]?.absent ? "" : cells[s.id]?.value.trim(), absent: Boolean(cells[s.id]?.absent) })),
      });
      onSaved(`${res.changed} mark${res.changed === 1 ? "" : "s"} changed. Parents see the new marks now; the office was told.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the change.");
    } finally {
      setSaving("");
    }
  }

  if (!sheet) return null;
  const pct = students.length ? Math.round((done / students.length) * 100) : 0;
  const narrow = width < 640;

  return (
    <RnModal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => void close()}>
      <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {/* Header */}
          <View className="border-b border-ink-100 px-4 pb-3 pt-2">
            <View className={`mx-auto w-full ${narrow ? "" : "max-w-2xl"}`}>
            <View className="flex-row items-center gap-3">
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => void close()} className="h-10 w-10 items-center justify-center rounded-full bg-ink-50">
                <Ionicons name="close" size={20} color="#0F172A" />
              </Pressable>
              <View className="min-w-0 flex-1">
                <Text className="text-[16px] font-semibold text-ink-900" numberOfLines={1}>{subjectName(sheet.subject)} · {sheet.classLabel}</Text>
                <Text className="text-[12px] text-ink-500" numberOfLines={1}>
                  {sheet.seriesName} · out of {max}
                  {readOnly ? " · view only" : saving === "draft" ? " · saving…" : savedAt ? ` · saved ${savedAt}` : ""}
                </Text>
              </View>
            </View>
            <View className="mt-3 flex-row items-center gap-3">
              <View className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                <View className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </View>
              <Text className="text-[13px] font-semibold tabular-nums text-ink-900">{done}/{students.length}</Text>
            </View>
            {correction && sheet.correctionNote ? (
              <Text className="mt-2 text-[13px] text-red-700">Office: {sheet.correctionNote}</Text>
            ) : null}
            </View>
          </View>

          {/* Students */}
          <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" contentContainerClassName="pb-6">
            <View className={`mx-auto w-full ${narrow ? "" : "max-w-2xl"}`}>
              {students.map((s, i) => {
                const c = cells[s.id] || { value: "", absent: false };
                const bad = problem(c);
                const locked = readOnly || (fixOnly && !s.correctionRequested);
                return (
                  <View key={s.id} className={`flex-row items-center gap-3 px-4 py-2.5 ${i ? "border-t border-ink-100" : ""} ${s.correctionRequested ? "bg-red-50/60" : ""}`}>
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-ink-50">
                      <Text className="text-[13px] font-semibold tabular-nums text-ink-700">{s.rollNumber ?? "–"}</Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[15px] font-medium text-ink-900" numberOfLines={1}>{s.name}</Text>
                      {bad ? <Text className="text-[12px] font-medium text-red-700">{bad}</Text> : s.correctionRequested ? <Text className="text-[12px] text-red-700">{s.correctionNote || "Check this mark"}</Text> : null}
                    </View>
                    {c.absent ? (
                      <View className="h-12 w-20 items-center justify-center rounded-lg border border-amber-300 bg-amber-50">
                        <Text className="text-[14px] font-semibold text-amber-800">Absent</Text>
                      </View>
                    ) : (
                      <TextInput
                        ref={(el) => {
                          inputs.current[i] = el;
                        }}
                        accessibilityLabel={`Marks for ${s.name}`}
                        editable={!locked}
                        value={c.value}
                        onChangeText={(v) => update(s.id, { value: v.replace(/[^0-9.]/g, "").slice(0, 5) })}
                        keyboardType="decimal-pad"
                        returnKeyType={i < students.length - 1 ? "next" : "done"}
                        blurOnSubmit={false}
                        onSubmitEditing={() => inputs.current[i + 1]?.focus()}
                        placeholder="–"
                        placeholderTextColor="#CBD5E1"
                        selectTextOnFocus
                        className={`h-12 w-20 rounded-lg border text-center text-[18px] font-semibold tabular-nums ${
                          bad ? "border-red-400 bg-red-50 text-red-700" : locked ? "border-ink-100 bg-ink-50 text-ink-600" : "border-ink-300 bg-white text-ink-900"
                        }`}
                      />
                    )}
                    {!locked ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={c.absent ? `Mark ${s.name} present` : `Mark ${s.name} absent`}
                        onPress={() => update(s.id, { absent: !c.absent, value: "" })}
                        className={`h-12 w-12 items-center justify-center rounded-lg border ${c.absent ? "border-amber-300 bg-amber-100" : "border-ink-200 bg-white"}`}
                      >
                        <Text className={`text-[13px] font-bold ${c.absent ? "text-amber-800" : "text-ink-500"}`}>AB</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {/* Footer */}
          {published && !editPublished ? (
            <View className="border-t border-ink-100 bg-white px-4 py-3">
              <View className={`mx-auto w-full ${narrow ? "" : "max-w-2xl"}`}>
                <Pressable onPress={() => setEditPublished(true)} className="h-12 flex-row items-center justify-center gap-2 rounded-lg border border-ink-200">
                  <Ionicons name="create-outline" size={18} color="#0F172A" />
                  <Text className="text-[15px] font-semibold text-ink-900">Change marks</Text>
                </Pressable>
                <Text className="mt-2 text-center text-[11px] text-ink-500">For a parent query or a counting mistake. The change shows to parents straight away.</Text>
              </View>
            </View>
          ) : editPublished ? (
            <View className="border-t border-ink-100 bg-white px-4 py-3">
              <View className={`mx-auto w-full gap-2 ${narrow ? "" : "max-w-2xl"}`}>
                {error ? <Text className="text-[13px] text-red-700">{error}</Text> : null}
                <Text className="text-[13px] font-medium text-ink-900">
                  {changedIds.length ? `${changedIds.length} mark${changedIds.length === 1 ? "" : "s"} changed` : "Tap a mark above to change it"}
                </Text>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder="Reason (e.g. Parent query — rechecked page 3)"
                  placeholderTextColor="#94A3B8"
                  className="h-11 rounded-lg border border-ink-300 px-3 text-[14px] text-ink-900"
                />
                <View className="flex-row gap-2">
                  <Pressable
                    onPress={() => {
                      setEditPublished(false);
                      setReason("");
                      setError("");
                      setCells(Object.fromEntries(sheet.students.map((s) => [s.id, cellFor(s)])));
                    }}
                    className="h-12 flex-1 items-center justify-center rounded-lg border border-ink-200"
                  >
                    <Text className="text-[15px] font-semibold text-ink-800">Cancel</Text>
                  </Pressable>
                  <Pressable
                    disabled={saving === "submit"}
                    onPress={() => void savePublishedChanges()}
                    className={`h-12 flex-[2] flex-row items-center justify-center gap-2 rounded-lg ${changedIds.length && reason.trim().length >= 3 ? "bg-clay-500" : "bg-ink-200"}`}
                  >
                    {saving === "submit" ? <ActivityIndicator size="small" color="#fff" /> : null}
                    <Text className={`text-[15px] font-semibold ${changedIds.length && reason.trim().length >= 3 ? "text-white" : "text-ink-600"}`}>Save changes</Text>
                  </Pressable>
                </View>
                <Text className="text-center text-[11px] text-ink-500">Old and new marks are kept in history.</Text>
              </View>
            </View>
          ) : !readOnly ? (
            <View className="border-t border-ink-100 bg-white px-4 py-3">
              <View className={`mx-auto w-full ${narrow ? "" : "max-w-2xl"}`}>
              {error ? <Text className="mb-2 text-[13px] text-red-700">{error}</Text> : null}
              {(
                <Pressable
                  accessibilityRole="button"
                  onPress={() => (left && !fixOnly) || problems ? void submit() : setConfirm(true)}
                  className={`h-12 items-center justify-center rounded-lg ${(left && !fixOnly) || problems ? "bg-ink-200" : "bg-clay-500"}`}
                >
                  <Text className={`text-[15px] font-semibold ${(left && !fixOnly) || problems ? "text-ink-600" : "text-white"}`}>
                    {problems ? `Fix ${problems} mark${problems === 1 ? "" : "s"}` : left && !fixOnly ? `${left} left to enter` : "Send marks to office"}
                  </Text>
                </Pressable>
              )}
              <Text className="mt-2 text-center text-[11px] text-ink-500">Marks save on their own as you type. Type a number, or tap AB if absent.</Text>
              </View>
            </View>
          ) : null}
          {confirm ? (
            <View className="absolute inset-0 justify-end">
              <Pressable accessibilityLabel="Not yet" onPress={() => setConfirm(false)} className="absolute inset-0 bg-black/40" />
              <View className="rounded-t-2xl bg-white px-5 pb-6 pt-5">
                <View className={`mx-auto w-full ${narrow ? "" : "max-w-md"}`}>
                  <View className="h-11 w-11 items-center justify-center rounded-full bg-clay-50">
                    <Ionicons name="paper-plane-outline" size={20} color="#2563EB" />
                  </View>
                  <Text className="mt-3 text-[18px] font-semibold text-ink-900">Send marks to the office?</Text>
                  <View className="mt-3 rounded-xl border border-ink-200">
                    <View className="flex-row items-center justify-between px-4 py-2.5">
                      <Text className="text-[14px] text-ink-600">Paper</Text>
                      <Text className="text-[14px] font-semibold text-ink-900">{`${subjectName(sheet.subject)} · ${sheet.classLabel}`}</Text>
                    </View>
                    <View className="flex-row items-center justify-between border-t border-ink-100 px-4 py-2.5">
                      <Text className="text-[14px] text-ink-600">Marks entered</Text>
                      <Text className="text-[14px] font-semibold tabular-nums text-ink-900">{`${done}/${students.length}`}</Text>
                    </View>
                    <View className="flex-row items-center justify-between border-t border-ink-100 px-4 py-2.5">
                      <Text className="text-[14px] text-ink-600">Absent</Text>
                      <Text className="text-[14px] font-semibold tabular-nums text-ink-900">{students.filter((st) => cells[st.id]?.absent).length}</Text>
                    </View>
                  </View>
                  <Text className="mt-3 text-[13px] leading-5 text-ink-500">You can still change a mark later. Every change is saved in history.</Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={saving === "submit"}
                    onPress={() => void submit()}
                    className="mt-5 h-12 flex-row items-center justify-center gap-2 rounded-lg bg-clay-500"
                  >
                    {saving === "submit" ? <ActivityIndicator size="small" color="#fff" /> : null}
                    <Text className="text-[15px] font-semibold text-white">Yes, send marks</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setConfirm(false)} className="mt-2 h-11 items-center justify-center">
                    <Text className="text-[15px] font-medium text-ink-600">Not yet, keep checking</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </RnModal>
  );
}
