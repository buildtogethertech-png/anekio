import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View, Modal as RnModal } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams } from "expo-router";
import { DateField } from "./date-field";
import { Button, Chip, Field, Input, Modal, Toast, useToast } from "./ui";
import { TeacherMarksModal, examTodoKind, examTodoTone } from "./exam-teacher-work";
import { act } from "../lib/mutate";
import { ymd } from "../lib/calendar";
import { useRecord, type RecordPayload } from "../lib/record";
import { useSession } from "../lib/session";
import { teacherBucket, teacherCanEditMarks } from "../lib/exam-workflow";

type Todo = NonNullable<RecordPayload["todos"]>[number];
type Sheet = NonNullable<RecordPayload["markSheets"]>[number];
type EntryFilter = "all" | "action" | "pending" | "submitted" | "correction";
type Lane = "paper" | "take" | "marks" | "office" | "correction" | null;
type Glyph = keyof typeof Ionicons.glyphMap;

const PAGE_BG = "#F7F9FC";
const INK = "#0F172A";
const MUTED = "#64748B";
const LINE = "#E2E8F0";

const statusTheme = {
  correction: { accent: "#E11D48", tint: "#FFF1F2", fill: "#E11D48", icon: "warning-outline" as Glyph },
  available: { accent: "#2563EB", tint: "#EFF6FF", fill: "#2563EB", icon: "create-outline" as Glyph },
  submitted: { accent: "#16A34A", tint: "#ECFDF5", fill: "#16A34A", icon: "checkmark-circle-outline" as Glyph },
  scheduled: { accent: "#7C3AED", tint: "#F5F3FF", fill: "#7C3AED", icon: "calendar-outline" as Glyph },
  locked: { accent: "#64748B", tint: "#F8FAFC", fill: "#94A3B8", icon: "lock-closed-outline" as Glyph },
  office: { accent: "#16A34A", tint: "#ECFDF5", fill: "#16A34A", icon: "send-outline" as Glyph },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseIsoDate(value?: string) {
  const s = (value || "").slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function prettyDate(value?: string) {
  const p = parseIsoDate(value);
  if (!p) return "";
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

function prettyDue(value?: string) {
  const p = parseIsoDate(value);
  if (!p) return "";
  return `${p.d} ${MONTHS[p.m - 1]}`;
}

function todoDueOn(todo: Todo) {
  const match = (todo.hint || "").match(/due (\d{4}-\d{2}-\d{2})/i);
  return match?.[1] || todo.dueOn;
}

function prettyHint(hint?: string) {
  return (hint || "")
    .replace(/overdue · due (\d{4}-\d{2}-\d{2})/gi, (_, iso) => `Overdue · ${prettyDate(iso)}`)
    .replace(/due (\d{4}-\d{2}-\d{2})/gi, (_, iso) => `Due ${prettyDate(iso)}`);
}

function hintWithoutDue(hint?: string) {
  return prettyHint(hint)
    .replace(/\s·\sOverdue · .+$/i, "")
    .replace(/\s·\sDue .+$/i, "")
    .replace(/\s·\sdue today/i, "")
    .trim();
}

function subjectLook(name: string) {
  const n = name.toLowerCase();
  if (n.includes("math")) return { icon: "calculator-outline" as Glyph, bg: "#EDE9FE", color: "#7C3AED" };
  if (n.includes("sci") || n.includes("physics") || n.includes("chem") || n.includes("bio")) {
    return { icon: "flask-outline" as Glyph, bg: "#FFEDD5", color: "#EA580C" };
  }
  if (n.includes("hindi") || n.includes("sanskrit")) return { icon: "book-outline" as Glyph, bg: "#DCFCE7", color: "#16A34A" };
  if (n.includes("social") || n.includes("history") || n.includes("geo") || n.includes("civics")) {
    return { icon: "globe-outline" as Glyph, bg: "#F3E8FF", color: "#7C3AED" };
  }
  if (n.includes("english") || n.includes("lang")) return { icon: "book-outline" as Glyph, bg: "#DBEAFE", color: "#2563EB" };
  return { icon: "document-text-outline" as Glyph, bg: "#E0E7FF", color: "#4F46E5" };
}

function isListedSheet(sheet: Sheet) {
  return (
    teacherCanEditMarks(sheet.workflowStatus) ||
    ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED", "APPROVED", "PUBLISHED"].includes(sheet.workflowStatus || "")
  );
}

function sheetEntered(sheet: Sheet) {
  return sheet.entered ?? sheet.students.filter((row) => row.absent || row.marks != null).length;
}

function sheetIsSubmitted(sheet: Sheet) {
  return ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED", "APPROVED", "PUBLISHED"].includes(sheet.workflowStatus || "");
}

export function sheetRowModel(sheet: Sheet) {
  const entered = sheetEntered(sheet);
  const total = sheet.students.length;
  const pct = total ? Math.round((entered / total) * 100) : 0;
  const submitted = sheetIsSubmitted(sheet);
  const correction = sheet.workflowStatus === "CORRECTION_REQUIRED";
  const locked = submitted && !correction;
  const waitingGrant = !sheet.canEnterMarks && !locked;
  const officeWait = submitted && sheet.workflowStatus !== "PUBLISHED";
  if (correction) {
    return { kind: "correction" as const, theme: statusTheme.correction, label: "Correction", action: "Fix", progressFill: statusTheme.correction.fill };
  }
  if (waitingGrant) {
    return { kind: "locked" as const, theme: statusTheme.locked, label: "Locked", action: "View", progressFill: statusTheme.locked.fill };
  }
  if (sheet.workflowStatus === "PUBLISHED") {
    return { kind: "submitted" as const, theme: statusTheme.submitted, label: "Published", action: "View", progressFill: statusTheme.submitted.fill };
  }
  if (officeWait) {
    return { kind: "office" as const, theme: statusTheme.office, label: "Submitted", action: "View", progressFill: statusTheme.office.fill };
  }
  if (sheet.canEnterMarks && teacherCanEditMarks(sheet.workflowStatus)) {
    return {
      kind: "available" as const,
      theme: statusTheme.available,
      label: entered ? "In progress" : "Available",
      action: "Enter",
      progressFill: pct === 100 ? statusTheme.submitted.fill : statusTheme.available.fill,
    };
  }
  return { kind: "scheduled" as const, theme: statusTheme.scheduled, label: "Scheduled", action: "View", progressFill: statusTheme.scheduled.fill };
}

function entryBucket(sheet: Sheet): Exclude<EntryFilter, "all"> {
  const row = sheetRowModel(sheet);
  if (row.kind === "correction") return "correction";
  if (row.kind === "submitted" || row.kind === "office") return "submitted";
  if (row.kind === "available") return "action";
  return "pending";
}

function ProgressBar({ pct, fill }: { pct: number; fill: string }) {
  return (
    <View className="h-[6px] w-[72px] overflow-hidden rounded-full bg-[#E2E8F0]">
      <View className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: fill }} />
    </View>
  );
}

function CompactButton({
  label,
  tone = "ghost",
  onPress,
  disabled,
}: {
  label: string;
  tone?: "blue" | "rose" | "ghost";
  onPress: () => void;
  disabled?: boolean;
}) {
  const styles =
    tone === "rose" ? "bg-[#E11D48]" : tone === "blue" ? "bg-[#2563EB]" : "border border-[#E2E8F0] bg-white";
  const text = tone === "ghost" ? "text-slate-800" : "text-white";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`h-9 items-center justify-center rounded-[8px] px-3 ${styles} ${disabled ? "opacity-50" : ""}`}
    >
      <Text className={`text-[12px] font-semibold ${text}`}>{label}</Text>
    </Pressable>
  );
}

function MarkEntryRow({ sheet, onOpen, compact }: { sheet: Sheet; onOpen: () => void; compact?: boolean }) {
  const look = subjectLook(sheet.subject);
  const row = sheetRowModel(sheet);
  const entered = sheetEntered(sheet);
  const total = sheet.students.length;
  const tone = row.kind === "correction" ? "rose" : row.kind === "available" ? "blue" : "ghost";
  if (compact) {
    return (
      <Pressable
        onPress={onOpen}
        className="anekio-paper-row border-b border-[#F1F5F9] px-3 py-2.5"
        style={{ borderLeftWidth: 3, borderLeftColor: row.theme.accent }}
      >
        <View className="flex-row items-center gap-2">
          <View className="h-8 w-8 items-center justify-center rounded-[8px]" style={{ backgroundColor: look.bg }}>
            <Ionicons name={look.icon} size={15} color={look.color} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[13px] font-semibold" style={{ color: INK }} numberOfLines={1}>{sheet.seriesName || sheet.title}</Text>
            <Text className="text-[11px]" style={{ color: MUTED }} numberOfLines={1}>
              {sheet.subject} · {sheet.classLabel || "—"} · {total} students{sheet.date ? ` · ${prettyDue(sheet.date)}` : ""}
            </Text>
          </View>
          <CompactButton label={row.action} tone={tone} onPress={onOpen} />
        </View>
        <View className="mt-2 flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Text className="text-[11px] font-semibold" style={{ color: INK }}>{entered}/{total}</Text>
            <ProgressBar pct={total ? Math.round((entered / total) * 100) : 0} fill={row.progressFill} />
          </View>
          <Text className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ color: row.theme.accent, backgroundColor: row.theme.tint }}>{row.label}</Text>
        </View>
      </Pressable>
    );
  }
  return (
    <View className="anekio-paper-row min-h-[64px] flex-row items-center border-b border-[#F1F5F9] bg-white" style={{ borderLeftWidth: 3, borderLeftColor: row.theme.accent }}>
      <View className="min-w-0 flex-[1.6] flex-row items-center gap-2.5 px-3 py-2">
        <View className="h-8 w-8 items-center justify-center rounded-[8px]" style={{ backgroundColor: look.bg }}>
          <Ionicons name={look.icon} size={15} color={look.color} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[13px] font-semibold" style={{ color: INK }} numberOfLines={1}>{sheet.seriesName || sheet.title}</Text>
          <Text className="text-[11px]" style={{ color: MUTED }} numberOfLines={1}>{sheet.subject}</Text>
        </View>
      </View>
      <Text className="w-[72px] text-[12px] font-medium" style={{ color: INK }} numberOfLines={1}>{sheet.classLabel || "—"}</Text>
      <Text className="w-[56px] text-[12px]" style={{ color: MUTED }}>{total}</Text>
      <Text className="w-[72px] text-[12px]" style={{ color: MUTED }}>{prettyDue(sheet.date) || "—"}</Text>
      <View className="w-[108px]">
        <Text className="text-[11px] font-semibold" style={{ color: INK }}>{entered}/{total}</Text>
        <View className="mt-1"><ProgressBar pct={total ? Math.round((entered / total) * 100) : 0} fill={row.progressFill} /></View>
      </View>
      <View className="w-[110px]">
        <View className="h-6 flex-row items-center self-start rounded-full px-2" style={{ backgroundColor: row.theme.tint }}>
          <Ionicons name={row.theme.icon} size={11} color={row.theme.accent} />
          <Text className="ml-1 text-[10px] font-semibold" style={{ color: row.theme.accent }}>{row.label}</Text>
        </View>
      </View>
      <View className="w-[72px] items-end pr-3">
        <CompactButton label={row.action} tone={tone} onPress={onOpen} />
      </View>
    </View>
  );
}

function PaperTaskRow({
  todo,
  pending,
  compact,
  onTake,
  onDone,
}: {
  todo: Todo;
  pending?: boolean;
  compact?: boolean;
  onTake?: () => void;
  onDone?: () => void;
}) {
  const tone = examTodoTone(todo);
  const due = prettyDue(todoDueOn(todo));
  const kind = examTodoKind(todo);
  const look = subjectLook(todo.title + " " + (todo.hint || ""));
  const overdue = tone === "overdue";
  return (
    <View
      className={`anekio-paper-row border-b border-[#F1F5F9] px-3 py-2 ${compact ? "gap-2" : "min-h-[64px] flex-row items-center gap-2"}`}
      style={{ borderLeftWidth: 3, borderLeftColor: overdue ? "#E11D48" : tone === "soon" ? "#F59E0B" : "#2563EB" }}
    >
      <View className={compact ? "flex-row items-start gap-2" : "h-8 w-8 items-center justify-center rounded-[8px]"} style={compact ? undefined : { backgroundColor: look.bg }}>
        {compact ? (
          <>
            <View className="h-7 w-7 items-center justify-center rounded-[8px]" style={{ backgroundColor: look.bg }}>
              <Ionicons name={look.icon} size={14} color={look.color} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[13px] font-semibold" style={{ color: INK }} numberOfLines={2}>{todo.title}</Text>
              {todo.hint ? (
                <Text className="text-[11px]" style={{ color: MUTED }} numberOfLines={1}>{hintWithoutDue(todo.hint)}</Text>
              ) : null}
            </View>
          </>
        ) : (
          <Ionicons name={look.icon} size={15} color={look.color} />
        )}
      </View>
      {compact ? null : (
        <View className="min-w-0 flex-1">
          <Text className="text-[13px] font-semibold" style={{ color: INK }} numberOfLines={2}>{todo.title}</Text>
          {todo.hint ? (
            <Text className="text-[11px]" style={{ color: MUTED }} numberOfLines={1}>{hintWithoutDue(todo.hint)}</Text>
          ) : null}
        </View>
      )}
      <View className={compact ? "flex-row items-center justify-end gap-1.5" : "items-end gap-1.5"}>
        {due || tone ? (
          <Text
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{
              backgroundColor: overdue ? "#FFF1F2" : "#FFF7ED",
              color: overdue ? "#E11D48" : "#D97706",
            }}
          >
            {overdue ? `Overdue · ${due}` : due ? `Due ${due}` : "Due soon"}
          </Text>
        ) : null}
        <View className="flex-row items-center gap-1.5">
          {kind === "paper" && onDone ? (
            <CompactButton
              label={compact ? "Ready" : "Paper ready"}
              tone="blue"
              disabled={pending}
              onPress={onDone}
            />
          ) : null}
          {kind === "take" ? (
            <CompactButton
              label={compact ? "Take" : "Take exam"}
              tone="blue"
              disabled={pending}
              onPress={onTake || (() => undefined)}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

function ExamSummaryCard({
  card,
  selected,
  onPress,
  compact,
}: {
  card: {
    id: Exclude<Lane, null>;
    label: string;
    value: number;
    hint: string;
    bg: string;
    iconBg: string;
    accent: string;
    icon: Glyph;
    tip: string;
  };
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.label}: ${card.value}. ${card.hint}. ${card.tip}`}
      onPress={onPress}
      className={`anekio-exam-card justify-between rounded-[12px] border ${compact ? "h-full w-full px-2.5 py-2" : "min-h-0 min-w-0 flex-1 px-3.5 py-3"}`}
      style={{
        backgroundColor: card.bg,
        borderColor: selected ? card.accent : LINE,
        borderWidth: selected ? 2 : 1,
      }}
    >
      <View className="flex-row items-center gap-1.5">
        <View
          className={`items-center justify-center rounded-[8px] ${compact ? "h-6 w-6" : "h-8 w-8 rounded-[9px]"}`}
          style={{ backgroundColor: card.iconBg }}
        >
          <Ionicons name={card.icon} size={compact ? 14 : 18} color={card.accent} />
        </View>
        <Text
          className={`min-w-0 flex-1 font-bold uppercase ${compact ? "text-[9px] tracking-[0.2px]" : "text-[10px] tracking-[0.4px]"}`}
          style={{ color: card.accent }}
          numberOfLines={1}
        >
          {card.label}
        </Text>
        {compact ? null : <Ionicons name="chevron-forward" size={14} color={card.accent} />}
      </View>
      <View className={`flex-row items-end justify-between ${compact ? "mt-1" : ""}`}>
        <Text className={`font-bold ${compact ? "text-[18px] leading-5" : "text-[24px] leading-6"}`} style={{ color: INK }}>
          {card.value}
        </Text>
        <Text className={`mb-0.5 ${compact ? "max-w-[58%] text-[9px]" : "text-[10px]"}`} style={{ color: MUTED }} numberOfLines={1}>
          {compact ? card.hint : `● ${card.hint}`}
        </Text>
      </View>
    </Pressable>
  );
}

export function TeacherExamsBoard(_props: { uploads?: boolean }) {
  const { data, reload, error } = useRecord();
  const { token } = useSession();
  const params = useLocalSearchParams<{ examId?: string; view?: string }>();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const stacked = width < 1100;
  const compactRows = width < 768;
  const phone = width < 768;
  const [pending, setPending] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [filterFrame, setFilterFrame] = useState({ left: 12, top: 56 });
  const filterBtnRef = useRef<View>(null);
  const [doneQuery, setDoneQuery] = useState("");
  const [doneKind, setDoneKind] = useState<"all" | "paper" | "take" | "marks">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [host, setHost] = useState({ title: "", subjectId: data?.subjects?.[0]?.id || "", date: "", maxMarks: "40" });
  const [sheetId, setSheetId] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EntryFilter>("all");
  const [lane, setLane] = useState<Lane>(null);

  const todos = (data?.todos ?? []).filter((t) => examTodoKind(t) !== "skip");
  const doneWork = data?.doneWork ?? [];
  const today = ymd(new Date());
  const sheets = data?.markSheets ?? [];
  const listed = sheets.filter(isListedSheet);
  const openSheet = sheets.find((s) => s.examId === sheetId) || null;
  const submittedExams = sheets.filter((s) => teacherBucket(s.workflowStatus, s.date, today) === "submitted");
  const paperTodos = todos.filter((t) => examTodoKind(t) === "paper");
  const takeTodos = todos.filter((t) => examTodoKind(t) === "take");
  const marksTodos = todos.filter((t) => examTodoKind(t) === "marks");
  const correctionTodos = todos.filter((t) => (t.title || "").toLowerCase().includes("correct marks"));
  const correctionSheets = listed.filter((s) => s.workflowStatus === "CORRECTION_REQUIRED");
  const enterableSheets = listed.filter((s) => s.canEnterMarks && teacherCanEditMarks(s.workflowStatus) && s.workflowStatus !== "CORRECTION_REQUIRED");
  const paperOverdue = paperTodos.filter((todo) => examTodoTone(todo) === "overdue").length;

  function openMarks(examId: string) {
    setSheetId(examId);
  }

  useEffect(() => {
    const examId = String(params.examId || "");
    if (!examId) return;
    if (params.view === "marks" || params.view === "review" || params.view === "paper") openMarks(examId);
  }, [params.examId, params.view]);

  async function takeExam(examId: string) {
    setPending(examId);
    try {
      await act(token, "takeExam", { examId });
      toast.show("Exam taken. Enter marks when office has allowed marks entry.");
      await reload();
      setSheetId(examId);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setPending("");
    }
  }

  async function postClassTest() {
    try {
      await act(token, "hostExam", { ...host, classId: data?.classId, maxMarks: Number(host.maxMarks) });
      toast.show("Class test added. The class has a notification.");
      setShowAdd(false);
      setHost({ title: "", subjectId: host.subjectId, date: "", maxMarks: "40" });
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function completePaper(todo: Todo) {
    const examId = todo.examId || todo.id.replace(/^paper-/, "");
    setPending(todo.id);
    try {
      await act(token, "completeExamWork", { examId, kind: "paper" });
      toast.show("Paper marked ready. Office has been told.");
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setPending("");
    }
  }

  const counts = {
    paper: paperTodos.length,
    take: takeTodos.length,
    marks: enterableSheets.length || marksTodos.filter((t) => {
      const sheet = sheets.find((s) => s.examId === (t.examId || t.id.replace(/^marks-/, "")));
      return !sheet || sheet.canEnterMarks;
    }).length,
    office: submittedExams.length,
    correction: correctionSheets.length || correctionTodos.length,
  };

  function toggleFilter() {
    if (showFilter) {
      setShowFilter(false);
      return;
    }
    const place = (x: number, y: number, w: number, h: number) => {
      setFilterFrame({
        left: Math.max(12, x + Math.max(w, 94) - 228),
        top: y + Math.max(h, 40) + 6,
      });
      setTimeout(() => setShowFilter(true), 0);
    };
    if (typeof document !== "undefined") {
      const node = document.querySelector('[data-testid="teacher-exams-filter"]');
      if (node) {
        const r = node.getBoundingClientRect();
        if (r.width >= 1) {
          place(r.left, r.top, r.width, r.height);
          return;
        }
      }
    }
    filterBtnRef.current?.measureInWindow((x, y, w, h) => {
      if (Number.isFinite(x) && Number.isFinite(y) && w >= 1) place(x, y, w, h);
      else place(12, 56, 94, 40);
    });
  }

  function selectLane(id: Lane) {
    setLane(id);
    setShowFilter(false);
    if (id === "marks") setFilter("action");
    else if (id === "office") setFilter("submitted");
    else if (id === "correction") setFilter("correction");
    else setFilter("all");
  }

  function selectMarkFilter(id: EntryFilter) {
    setFilter(id);
    setShowFilter(false);
    if (id === "all") setLane(null);
    else if (id === "action") setLane("marks");
    else if (id === "submitted") setLane("office");
    else if (id === "correction") setLane("correction");
    else setLane(null);
  }

  const needle = query.trim().toLowerCase();
  const filteredSheets = listed.filter((sheet) => {
    if (filter !== "all" && entryBucket(sheet) !== filter) return false;
    if (!needle) return true;
    return `${sheet.seriesName} ${sheet.title} ${sheet.subject} ${sheet.classLabel}`.toLowerCase().includes(needle);
  });
  const filterCounts = {
    all: listed.length,
    action: listed.filter((s) => entryBucket(s) === "action").length,
    pending: listed.filter((s) => entryBucket(s) === "pending").length,
    submitted: listed.filter((s) => entryBucket(s) === "submitted").length,
    correction: listed.filter((s) => entryBucket(s) === "correction").length,
  };

  const rightTodos = lane === "take" ? takeTodos : paperTodos;
  const todayLabel = prettyDate(ymd(new Date()));
  const canHost = Boolean(data?.classTeacher && data.classId);
  const doneNeedle = doneQuery.trim().toLowerCase();
  const completedRows = doneWork.filter((row) => {
    if (doneKind !== "all" && row.kind !== doneKind) return false;
    if (!doneNeedle) return true;
    return `${row.title} ${row.hint}`.toLowerCase().includes(doneNeedle);
  });
  const completedKinds = [...new Set(doneWork.map((row) => row.kind))];

  const summary = [
    { id: "paper" as const, label: "Set paper", value: counts.paper, hint: counts.paper ? "Waiting" : "None", bg: "#EFF6FF", iconBg: "#DBEAFE", accent: "#2563EB", icon: "create-outline" as Glyph, tip: "View papers to set" },
    { id: "take" as const, label: "Take exam", value: counts.take, hint: counts.take ? "Upcoming" : "None", bg: "#F5F3FF", iconBg: "#EDE9FE", accent: "#7C3AED", icon: "clipboard-outline" as Glyph, tip: "View upcoming exams" },
    { id: "marks" as const, label: "Enter marks", value: counts.marks, hint: counts.marks ? "Action required" : "Office approval", bg: "#FFF7ED", iconBg: "#FFEDD5", accent: "#F59E0B", icon: "pencil-outline" as Glyph, tip: "View marks awaiting entry" },
    { id: "office" as const, label: "Sent to office", value: counts.office, hint: "Submitted", bg: "#ECFDF5", iconBg: "#D1FAE5", accent: "#16A34A", icon: "send-outline" as Glyph, tip: "View submitted marks" },
    { id: "correction" as const, label: "Correction", value: counts.correction, hint: counts.correction ? "Action required" : "No corrections", bg: "#FFF1F2", iconBg: "#FFE4E6", accent: "#E11D48", icon: "refresh-outline" as Glyph, tip: "View returned papers" },
  ];

  if (error) {
    return (
      <View className="min-h-0 flex-1 items-center justify-center">
        <Text className="text-[15px] font-semibold" style={{ color: INK }}>Unable to load exams.</Text>
        <View className="mt-3"><Button onPress={() => void reload()}>Try again</Button></View>
      </View>
    );
  }

  if (!data) {
    return (
      <View className="min-h-0 flex-1 overflow-hidden" style={{ backgroundColor: PAGE_BG }}>
        <View className="h-12 shrink-0 rounded-lg anekio-skeleton" />
        <View className="mt-3 min-h-0 flex-1 flex-row gap-4">
          <View className="min-h-0 min-w-0 flex-[68]">
            <View className="mb-3 h-[90px] flex-row gap-2.5">
              {[0, 1, 2].map((i) => <View key={i} className="min-w-0 flex-1 rounded-[12px] anekio-skeleton" />)}
            </View>
            <View className="min-h-0 flex-1 rounded-[14px] anekio-skeleton" />
          </View>
          <View className="min-h-0 min-w-0 flex-[32]">
            <View className="mb-3 h-[90px] flex-row gap-2.5">
              {[0, 1].map((i) => <View key={i} className="min-w-0 flex-1 rounded-[12px] anekio-skeleton" />)}
            </View>
            <View className="min-h-0 flex-1 rounded-[14px] anekio-skeleton" />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="min-h-0 flex-1 overflow-hidden" style={{ backgroundColor: PAGE_BG }} testID="teacher-exams-workspace">
      <View className={`shrink-0 flex-row items-center ${phone ? "flex-wrap justify-end gap-1.5" : "h-12 justify-end gap-2"}`}>
        <View className={`flex-row items-center justify-center gap-1.5 rounded-[9px] border bg-white ${phone ? "h-9 px-2.5" : "h-10 w-[138px] px-2.5"}`} style={{ borderColor: LINE }}>
          <Ionicons name="calendar-outline" size={phone ? 14 : 16} color="#64748B" />
          <View>
            {phone ? null : <Text className="text-[10px] leading-3" style={{ color: MUTED }}>Today</Text>}
            <Text className={`font-semibold ${phone ? "text-[11px] leading-4" : "text-[11px] leading-4"}`} style={{ color: INK }}>{todayLabel}</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Completed"
          onPress={() => { setShowFilter(false); setShowCompleted(true); }}
          className={`anekio-exam-btn anekio-completed-btn flex-row items-center justify-center gap-1 rounded-[9px] border bg-white ${phone ? "h-9 px-2.5" : "h-10 w-[118px] gap-1.5"}`}
          style={{ borderColor: "#D9E2F0" }}
        >
          <Ionicons name="checkmark-circle-outline" size={phone ? 16 : 17} color="#173B73" />
          <Text className={`font-semibold ${phone ? "text-[12px]" : "text-[13px]"}`} style={{ color: "#173B73" }}>{phone ? "Done" : "Completed"}</Text>
        </Pressable>
        <View ref={filterBtnRef} collapsable={false} testID="teacher-exams-filter">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={filter === "all" ? "Filter" : `Filter, ${filter} active`}
            onPress={toggleFilter}
            className={`anekio-exam-btn flex-row items-center justify-center rounded-[9px] border ${phone ? "h-9 w-9" : "h-10 w-[94px] gap-1.5"}`}
            style={{
              borderColor: filter === "all" ? LINE : "#BFDBFE",
              backgroundColor: filter === "all" ? "#FFFFFF" : "#EFF6FF",
            }}
          >
            <Ionicons name="filter-outline" size={16} color={filter === "all" ? "#173B73" : "#2563EB"} />
            {phone ? null : (
              <Text className="text-[13px] font-semibold" style={{ color: filter === "all" ? "#173B73" : "#2563EB" }}>Filter</Text>
            )}
          </Pressable>
        </View>
        <RnModal visible={showFilter} transparent animationType="fade" onRequestClose={() => setShowFilter(false)}>
          <Pressable className="flex-1" style={{ backgroundColor: "transparent" }} onPress={() => setShowFilter(false)}>
            <Pressable
              className="absolute rounded-[12px] border p-2"
              style={{
                left: phone ? 12 : filterFrame.left,
                top: filterFrame.top,
                width: phone ? Math.min(width - 24, 280) : 228,
                borderColor: LINE,
                backgroundColor: "#FFFFFF",
                shadowColor: "#0f172a",
                shadowOpacity: 0.16,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 8 },
                elevation: 12,
              }}
              onPress={() => {}}
            >
              {([
                ["all", `All (${filterCounts.all})`],
                ["action", `Action required (${filterCounts.action})`],
                ["pending", `Pending (${filterCounts.pending})`],
                ["submitted", `Submitted (${filterCounts.submitted})`],
                ["correction", `Correction (${filterCounts.correction})`],
              ] as const).map(([id, label]) => (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  onPress={() => selectMarkFilter(id)}
                  className={`mb-1 h-9 justify-center rounded-[8px] px-3 ${filter === id ? "bg-[#EFF6FF]" : ""}`}
                >
                  <Text className={`text-[12px] font-semibold ${filter === id ? "text-[#2563EB]" : "text-slate-800"}`}>{label}</Text>
                </Pressable>
              ))}
            </Pressable>
          </Pressable>
        </RnModal>
        {canHost ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Class test"
            onPress={() => setShowAdd(true)}
            className={`anekio-exam-btn anekio-class-test-btn flex-row items-center justify-center rounded-[9px] bg-[#2563EB] ${phone ? "h-9 px-2.5 gap-0.5" : "h-10 w-[128px] gap-1"}`}
          >
            <Ionicons name="add" size={16} color="#ffffff" />
            <Text className={`font-semibold text-white ${phone ? "text-[12px]" : "text-[13px]"}`}>{phone ? "Test" : "Class test"}</Text>
          </Pressable>
        ) : null}
      </View>

      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}

      {stacked ? (
        <ScrollView className="mt-2 min-h-0 flex-1" contentContainerStyle={{ paddingBottom: 28, gap: 12 }} showsVerticalScrollIndicator={false}>
          {phone ? (
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingRight: 8 }}
            >
              {summary.map((card) => (
                <View key={card.id} style={{ width: 148, height: 72 }}>
                  <ExamSummaryCard card={card} compact selected={lane === card.id} onPress={() => selectLane(card.id)} />
                </View>
              ))}
            </ScrollView>
          ) : (
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {summary.map((card) => (
                <View key={card.id} style={{ width: "48%", flexGrow: 1, minWidth: "47%", height: 68 }}>
                  <ExamSummaryCard card={card} compact selected={lane === card.id} onPress={() => selectLane(card.id)} />
                </View>
              ))}
            </View>
          )}
          <View className="overflow-hidden rounded-[16px] border bg-white" style={{ borderColor: LINE }}>
            <View className="px-3 pb-2 pt-3">
              <View className="min-w-0 flex-row items-center gap-2">
                <View className="h-7 w-7 items-center justify-center rounded-lg bg-[#EFF6FF]">
                  <Ionicons name="grid-outline" size={14} color="#2563EB" />
                </View>
                <Text className="min-w-0 flex-1 text-[15px] font-bold" style={{ color: INK }}>My mark entries</Text>
              </View>
              <View className="mt-2 h-9 flex-row items-center gap-2 rounded-[9px] border bg-[#F8FAFC] px-3" style={{ borderColor: LINE }}>
                <Ionicons name="search-outline" size={15} color="#64748B" />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search exams..." placeholderTextColor="#94A3B8" className="min-w-0 flex-1 text-[13px] text-slate-900" />
              </View>
              <View className="mt-2 flex-row flex-wrap gap-1.5">
                {([
                  ["all", `All (${filterCounts.all})`],
                  ["action", `Action (${filterCounts.action})`],
                  ["pending", `Pending (${filterCounts.pending})`],
                  ["submitted", `Sent (${filterCounts.submitted})`],
                  ["correction", `Fix (${filterCounts.correction})`],
                ] as const).map(([id, label]) => (
                  <Pressable
                    key={id}
                    onPress={() => selectMarkFilter(id)}
                    className={`h-7 items-center justify-center rounded-full border px-2.5 ${filter === id ? "border-[#2563EB] bg-[#2563EB]" : "border-[#E2E8F0] bg-white"}`}
                  >
                    <Text className={`text-[11px] font-semibold ${filter === id ? "text-white" : "text-slate-800"}`}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View testID="teacher-mark-entries">
              {filteredSheets.length ? (
                filteredSheets.map((sheet) => (
                  <MarkEntryRow key={sheet.examId} sheet={sheet} compact onOpen={() => openMarks(sheet.examId)} />
                ))
              ) : (
                <View className="items-center px-6 py-6">
                  <Text className="text-[14px] font-semibold" style={{ color: INK }}>No mark entries yet</Text>
                  <Text className="mt-1 text-center text-[12px]" style={{ color: MUTED }}>Your assigned exam papers will appear here.</Text>
                </View>
              )}
            </View>
          </View>
          <View className="overflow-hidden rounded-[16px] border bg-white" style={{ borderColor: LINE }}>
            <View className="flex-row items-center justify-between gap-2 px-3 pb-2 pt-3">
              <View className="min-w-0 flex-1 flex-row items-center gap-2">
                <View className="h-7 w-7 items-center justify-center rounded-lg bg-[#EFF6FF]">
                  <Ionicons name="document-text-outline" size={14} color="#2563EB" />
                </View>
                <Text className="min-w-0 flex-1 text-[15px] font-bold" style={{ color: INK }}>{lane === "take" ? "Exams to take" : "Papers to set"}</Text>
              </View>
              <Text className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-semibold text-[#2563EB]">
                {rightTodos.length} {rightTodos.length === 1 ? "task" : "tasks"}
              </Text>
            </View>
            <View testID="teacher-papers-to-set">
              {rightTodos.length ? (
                rightTodos.map((t) => (
                  <PaperTaskRow
                    key={t.id}
                    todo={t}
                    compact
                    pending={pending === t.id || pending === (t.examId || "")}
                    onTake={examTodoKind(t) === "take" ? () => void takeExam(t.examId || t.id.replace(/^take-/, "")) : undefined}
                    onDone={examTodoKind(t) === "paper" ? () => void completePaper(t) : undefined}
                  />
                ))
              ) : (
                <View className="px-4 py-5">
                  <Text className="text-[13px] font-semibold" style={{ color: INK }}>{lane === "take" ? "No exams to take" : "No papers to set"}</Text>
                  <Text className="mt-1 text-[12px]" style={{ color: MUTED }}>You're all caught up.</Text>
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      ) : (
      <View className={`mt-2.5 min-h-0 flex-1 gap-4 ${stacked ? "flex-col" : "flex-row"}`}>
        <View
          className="min-h-0 min-w-0"
          style={{ flexGrow: stacked ? 1.35 : 68, flexShrink: 1, flexBasis: 0, minHeight: 0 }}
        >
          <View className="mb-3 h-[90px] shrink-0 flex-row gap-2.5">
            {summary.filter((card) => card.id === "marks" || card.id === "office" || card.id === "correction").map((card) => (
              <ExamSummaryCard key={card.id} card={card} selected={lane === card.id} onPress={() => selectLane(card.id)} />
            ))}
          </View>
          <View className="min-h-0 flex-1 overflow-hidden rounded-[16px] border bg-white" style={{ borderColor: LINE }}>
          <View className="shrink-0 px-4 pb-2 pt-3">
            <View className={`gap-2.5 ${compactRows ? "" : "flex-row items-center justify-between"}`}>
              <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
                <View className="h-8 w-8 items-center justify-center rounded-lg bg-[#EFF6FF]">
                  <Ionicons name="grid-outline" size={16} color="#2563EB" />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className={`font-bold ${phone ? "text-[15px]" : "text-[17px]"}`} style={{ color: INK }}>My mark entries</Text>
                  {phone ? null : (
                    <Text className="text-[11px]" style={{ color: MUTED }} numberOfLines={1}>Marks assigned to you for entry and submission.</Text>
                  )}
                </View>
              </View>
              <View className={`h-10 flex-row items-center gap-2 rounded-[9px] border bg-[#F8FAFC] px-3 ${compactRows ? "w-full" : "w-[240px]"}`} style={{ borderColor: LINE }}>
                <Ionicons name="search-outline" size={15} color="#64748B" />
                <TextInput value={query} onChangeText={setQuery} placeholder="Search subject, exam, class..." placeholderTextColor="#94A3B8" className="min-w-0 flex-1 text-[13px] text-slate-900" />
              </View>
            </View>
            <View className="mt-2.5 flex-row flex-wrap gap-1.5">
              {([
                ["all", phone ? `All (${filterCounts.all})` : `All (${filterCounts.all})`],
                ["action", phone ? `Action (${filterCounts.action})` : `Action required (${filterCounts.action})`],
                ["pending", phone ? `Pending (${filterCounts.pending})` : `Pending (${filterCounts.pending})`],
                ["submitted", phone ? `Sent (${filterCounts.submitted})` : `Submitted (${filterCounts.submitted})`],
                ["correction", phone ? `Fix (${filterCounts.correction})` : `Correction (${filterCounts.correction})`],
              ] as const).map(([id, label]) => (
                <Pressable
                  key={id}
                  onPress={() => selectMarkFilter(id)}
                  className={`items-center justify-center rounded-full border ${phone ? "h-7 px-2.5" : "h-8 px-3"} ${filter === id ? "border-[#2563EB] bg-[#2563EB]" : "border-[#E2E8F0] bg-white"}`}
                >
                  <Text className={`text-[11px] font-semibold ${filter === id ? "text-white" : "text-slate-800"}`}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          {!compactRows ? (
            <View className="shrink-0 flex-row items-center border-y border-[#F1F5F9] bg-[#F8FAFC] px-3 py-1.5">
              <Text className="min-w-0 flex-[1.6] text-[10px] font-semibold uppercase tracking-wide text-slate-500">Exam</Text>
              <Text className="w-[72px] text-[10px] font-semibold uppercase tracking-wide text-slate-500">Class</Text>
              <Text className="w-[56px] text-[10px] font-semibold uppercase tracking-wide text-slate-500">Students</Text>
              <Text className="w-[72px] text-[10px] font-semibold uppercase tracking-wide text-slate-500">Date</Text>
              <Text className="w-[108px] text-[10px] font-semibold uppercase tracking-wide text-slate-500">Progress</Text>
              <Text className="w-[110px] text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</Text>
              <Text className="w-[72px] pr-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Action</Text>
            </View>
          ) : null}
          <ScrollView className="min-h-0 flex-1" style={{ minHeight: 0 }} nestedScrollEnabled testID="teacher-mark-entries">
            {filteredSheets.length ? (
              filteredSheets.map((sheet) => (
                <MarkEntryRow key={sheet.examId} sheet={sheet} compact={compactRows} onOpen={() => openMarks(sheet.examId)} />
              ))
            ) : (
              <View className="items-center px-6 py-8">
                <Text className="text-[14px] font-semibold" style={{ color: INK }}>No mark entries yet</Text>
                <Text className="mt-1 text-center text-[12px]" style={{ color: MUTED }}>Your assigned exam papers will appear here.</Text>
              </View>
            )}
          </ScrollView>
        </View>
        </View>

        <View
          className="min-h-0 min-w-0"
          style={{ flexGrow: stacked ? 1 : 32, flexShrink: 1, flexBasis: 0, minHeight: phone ? 220 : 0 }}
        >
          {phone ? null : (
            <View className="mb-3 h-[90px] shrink-0 flex-row gap-2.5">
              {summary.filter((card) => card.id === "paper" || card.id === "take").map((card) => (
                <ExamSummaryCard key={card.id} card={card} selected={lane === card.id} onPress={() => selectLane(card.id)} />
              ))}
            </View>
          )}
          <View className="min-h-0 flex-1 overflow-hidden rounded-[16px] border bg-white" style={{ borderColor: LINE }}>
            <View className="shrink-0 flex-row items-start justify-between gap-2 px-3 pb-2 pt-3">
              <View className="min-w-0 flex-1 flex-row items-start gap-2">
                <View className="h-8 w-8 items-center justify-center rounded-lg bg-[#EFF6FF]">
                  <Ionicons name="document-text-outline" size={16} color="#2563EB" />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-[16px] font-bold" style={{ color: INK }}>{lane === "take" ? "Exams to take" : "Papers to set"}</Text>
                  <Text className="text-[11px]" style={{ color: MUTED }} numberOfLines={2}>
                    {lane === "take" ? "Nearest exams first." : "Paper, then take exam, then marks. Nearest papers first."}
                  </Text>
                </View>
              </View>
              <Text className="rounded-full bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-semibold text-[#2563EB]">
                {rightTodos.length} {rightTodos.length === 1 ? "task" : "tasks"}
                {lane !== "take" && paperOverdue ? ` · ${paperOverdue} overdue` : ""}
              </Text>
            </View>
            <ScrollView className="min-h-0 flex-1" style={{ minHeight: 0 }} nestedScrollEnabled testID="teacher-papers-to-set">
              {rightTodos.length ? (
                rightTodos.map((t) => (
                  <PaperTaskRow
                    key={t.id}
                    todo={t}
                    compact={phone}
                    pending={pending === t.id || pending === (t.examId || "")}
                    onTake={examTodoKind(t) === "take" ? () => void takeExam(t.examId || t.id.replace(/^take-/, "")) : undefined}
                    onDone={examTodoKind(t) === "paper" ? () => void completePaper(t) : undefined}
                  />
                ))
              ) : (
                <View className="px-4 py-6">
                  <Text className="text-[13px] font-semibold" style={{ color: INK }}>{lane === "take" ? "No exams to take" : "No papers to set"}</Text>
                  <Text className="mt-1 text-[12px]" style={{ color: MUTED }}>You're all caught up.</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </View>
      )}

      <TeacherMarksModal
        sheet={openSheet}
        token={token}
        onClose={() => setSheetId("")}
        onSaved={async () => {
          toast.show("Marks saved.");
          await reload();
        }}
      />
      <Modal
        open={showCompleted}
        title="Completed"
        onClose={() => setShowCompleted(false)}
        wide
      >
        <Text className="mb-3 text-[12px]" style={{ color: MUTED }}>Completed exam work</Text>
        <View className="mb-3 h-10 flex-row items-center gap-2 rounded-[9px] border bg-[#F8FAFC] px-3" style={{ borderColor: LINE }}>
          <Ionicons name="search-outline" size={15} color="#64748B" />
          <TextInput
            value={doneQuery}
            onChangeText={setDoneQuery}
            placeholder="Search completed exams..."
            placeholderTextColor="#94A3B8"
            className="min-w-0 flex-1 text-[13px] text-slate-900"
          />
        </View>
        {completedKinds.length > 1 ? (
          <View className="mb-3 flex-row flex-wrap gap-1.5">
            {(["all", ...completedKinds] as Array<"all" | "paper" | "take" | "marks">).map((id) => (
              <Pressable
                key={id}
                onPress={() => setDoneKind(id)}
                className={`h-8 items-center justify-center rounded-full border px-3 ${doneKind === id ? "border-[#2563EB] bg-[#2563EB]" : "border-[#E2E8F0] bg-white"}`}
              >
                <Text className={`text-[11px] font-semibold ${doneKind === id ? "text-white" : "text-slate-800"}`}>
                  {id === "all" ? "All" : id === "paper" ? "Papers" : id === "take" ? "Taken" : "Marks"}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View testID="teacher-completed-work">
          {completedRows.length ? (
            completedRows.map((t) => (
              <View key={t.id} className="flex-row items-center justify-between border-b border-[#F1F5F9] py-2.5">
                <View className="min-w-0 flex-1 pr-3">
                  <Text className="text-[13px] font-semibold" style={{ color: INK }} numberOfLines={1}>{t.title}</Text>
                  <Text className="text-[11px]" style={{ color: MUTED }} numberOfLines={1}>{t.hint}</Text>
                </View>
                {t.kind === "marks" ? (
                  <CompactButton
                    label="View"
                    onPress={() => {
                      setShowCompleted(false);
                      openMarks(t.examId);
                    }}
                  />
                ) : null}
                {t.kind === "paper" ? (
                  <CompactButton
                    label="Undo"
                    onPress={async () => {
                      setPending(t.id);
                      try {
                        await act(token, "completeExamWork", { examId: t.examId, kind: "paper", done: false });
                        toast.show("Back on Waiting.");
                        await reload();
                      } catch (e) {
                        toast.show(e instanceof Error ? e.message : "Could not save.");
                      } finally {
                        setPending("");
                      }
                    }}
                  />
                ) : null}
              </View>
            ))
          ) : (
            <Text className="py-6 text-[13px]" style={{ color: MUTED }}>No completed work yet.</Text>
          )}
        </View>
      </Modal>
      <Modal
        open={showAdd}
        title="Add class test"
        onClose={() => setShowAdd(false)}
        footer={
          <Button disabled={!host.title.trim() || !host.subjectId || !host.date} onPress={postClassTest}>
            Post class test
          </Button>
        }
      >
        <Text className="mb-4 text-sm text-ink-700">
          Parents, students, and teachers of {data?.classLabel || "this class"} will receive a notification.
        </Text>
        <View className="gap-4">
          <Field label="Test name">
            <Input value={host.title} onChangeText={(value) => setHost({ ...host, title: value })} placeholder="For example, Unit test 3" />
          </Field>
          <Field label="Subject">
            <View className="flex-row flex-wrap gap-2">
              {(data?.subjects ?? []).map((subject) => (
                <Chip key={subject.id} label={subject.name} active={host.subjectId === subject.id} onPress={() => setHost({ ...host, subjectId: subject.id })} />
              ))}
            </View>
          </Field>
          <Field label="Test date">
            <DateField value={host.date} onChange={(date) => setHost({ ...host, date })} />
          </Field>
        </View>
      </Modal>
    </View>
  );
}
