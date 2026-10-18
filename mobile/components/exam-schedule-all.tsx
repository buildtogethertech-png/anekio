import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import {
  addDays,
  cadenceForKind,
  closedReason as dayClosed,
  DEFAULT_DEADLINE_OFFSETS,
  defaultExamStart,
  paperDates,
  paperOffsets,
  prettyDay,
  schoolDaysBetween,
  shiftSchoolDays,
  type DeadlineOffsets,
  type SchoolCalendar,
} from "../lib/calendar";
import { act } from "../lib/mutate";
import { DateField } from "./date-field";
import { Select } from "./form/select";
import { Modal } from "./ui";
import { ExamTimeField, prettyTimeRange } from "./exam-time-field";
import type { YearClass, YearPlanItem, YearSeries } from "./exam-year-overview";

/**
 * Schedule one school exam for every class at once.
 * Sections of the same class (5-A, 5-B) share one timetable by default; any section can be split
 * out to get its own dates. Teachers default to each class's subject teacher and can be changed.
 */

type Subject = { id: string; name: string; code?: string; label?: string; teacherId?: string };
type ClassRow = YearClass & { name?: string; section?: string; subjects?: Subject[] };
type Dates = { date: string; paperDueOn: string; copiesDueOn: string; startTime?: string; endTime?: string };
const DEFAULT_TIME = { start: "09:00", end: "12:00" };
const AFTERNOON_TIME = { start: "13:00", end: "15:00" };
/** How papers are spread over days. */
type Pattern = "daily" | "alternate" | "double";
type PastExam = { date: string; startTime?: string | null; endTime?: string | null; subject?: { name?: string } };
type PastSeries = { id: string; classId: string; planItemId?: string; name?: string; exams: PastExam[] };
const nameKey = (value?: string) => (value || "").trim().toLowerCase();
type Group = { key: string; title: string; classIds: string[]; split: boolean };
/** Edit an exam that is already scheduled for one class: same screen, dates filled in. */
export type ScheduleEdit = {
  seriesId: string;
  resultOn?: string | null;
  classId: string;
  exams: {
    subjectId: string;
    date: string;
    paperDueOn?: string | null;
    copiesDueOn?: string | null;
    teacherId?: string | null;
    setterId?: string | null;
    maxMarks: number;
    startTime?: string;
    endTime?: string;
  }[];
};

const TIPS: Record<string, string> = {
  papers: "Dates fill in from the start date. Sundays and school holidays are skipped.",
  time: "Used for every paper. Tap a subject in the date sheet to change just that one.",
  deadlines: "Paper due: teacher gives the question paper to the office. Checking due: marks entered. Results: sent to parents after the last checking. All counted in school days.",
  paperBefore: "The teacher gives the question paper to the office this many school days before the exam.",
  copiesAfter: "The teacher finishes checking and enters marks this many school days after the exam.",
  resultAfter: "Results go to parents this many school days after the last paper is checked.",
};

/** A setting name with an ⓘ that shows a tooltip on hover (web) or tap (phone). */
function RuleLabel({ id, title, tip, onTip }: { id: string; title: string; tip: string; onTip: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  const show = hover || tip === id;
  return (
    <View className="relative z-20 self-start">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`About ${title}`}
        onPress={() => onTip(tip === id ? "" : id)}
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        className="flex-row items-center gap-1.5"
        style={Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined}
      >
        <Text className="text-[13px] text-ink-700">{title}</Text>
        <Ionicons name={show ? "information-circle" : "information-circle-outline"} size={15} color={show ? "#2563EB" : "#94A3B8"} />
      </Pressable>
      {show && TIPS[id] ? (
        <View pointerEvents="none" className="absolute left-0 top-6 z-50 w-64 rounded-lg bg-ink-900 px-3 py-2" style={{ elevation: 6, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}>
          <Text className="text-[12px] leading-[18px] text-white">{TIPS[id]}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Web: drag one subject onto another in the same class column to swap their days. */
function DragCell({ groupKey, itemKey, onSwap, children }: { groupKey: string; itemKey: string; onSwap: (from: string, to: string) => void; children: ReactNode }) {
  const ref = useRef<View>(null);
  const swap = useRef(onSwap);
  swap.current = onSwap;
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = ref.current as unknown as HTMLElement | null;
    if (!el) return;
    el.draggable = true;
    el.style.cursor = "grab";
    const start = (e: DragEvent) => {
      e.dataTransfer?.setData("text/plain", JSON.stringify({ g: groupKey, k: itemKey }));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      el.style.opacity = "0.5";
    };
    const end = () => {
      el.style.opacity = "";
    };
    const over = (e: DragEvent) => {
      e.preventDefault();
      el.style.outline = "2px dashed #2563EB";
      el.style.borderRadius = "6px";
    };
    const leave = () => {
      el.style.outline = "";
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      el.style.outline = "";
      try {
        const from = JSON.parse(e.dataTransfer?.getData("text/plain") || "{}") as { g?: string; k?: string };
        if (from.g === groupKey && from.k && from.k !== itemKey) swap.current(from.k, itemKey);
      } catch {
        /* not one of ours */
      }
    };
    el.addEventListener("dragstart", start);
    el.addEventListener("dragend", end);
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragstart", start);
      el.removeEventListener("dragend", end);
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, [groupKey, itemKey]);
  return <View ref={ref}>{children}</View>;
}

function gradeOf(c: ClassRow) {
  return (c.name || c.label.split("-")[0] || c.label).trim();
}

function subjectKey(s: Subject) {
  return (s.code || s.name).trim().toUpperCase();
}

function subjectTitle(s: Subject) {
  return s.code ? `${s.code} · ${s.name}` : s.name;
}

export function ScheduleExamModal({
  open,
  item,
  sessionId,
  initialClassIds,
  classes,
  teachers,
  series,
  calendar,
  token,
  onClose,
  onDone,
  edit,
  plan,
}: {
  edit?: ScheduleEdit | null;
  /** The year's exam list, so the timetable can copy the last exam of the same kind. */
  plan?: YearPlanItem[];
  open: boolean;
  item: YearPlanItem | null;
  sessionId: string;
  /** Pre-pick these classes (e.g. "Schedule for 1-A"); null = every class that still needs it. */
  initialClassIds?: string[] | null;
  classes: ClassRow[];
  teachers: { id: string; name: string }[];
  series: YearSeries[];
  calendar: SchoolCalendar;
  token: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { width, height } = useWindowDimensions();
  const narrow = width < 760;
  const paneHeight = Math.max(320, Math.min(640, height - 280));
  const scheduled = useMemo(
    () => new Set(series.filter((s) => s.planItemId === item?.id && s.exams.length).map((s) => s.classId)),
    [series, item?.id]
  );
  const available = useMemo(() => classes.filter((c) => !scheduled.has(c.id) && (c.subjects?.length ?? 0) > 0), [classes, scheduled]);
  const [selected, setSelected] = useState<string[]>([]);
  const [splitIds, setSplitIds] = useState<string[]>([]);
  const [offsets, setOffsets] = useState<DeadlineOffsets>(DEFAULT_DEADLINE_OFFSETS);
  const [starts, setStarts] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, Record<string, Dates>>>({});
  const [teacherPick, setTeacherPick] = useState<Record<string, string>>({});
  /** Who makes the question paper, when it is not the checking teacher. */
  const [setterPick, setSetterPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [gapsOpen, setGapsOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [teacherOpen, setTeacherOpen] = useState<string[]>([]);
  const [examTime, setExamTime] = useState(DEFAULT_TIME);
  const [secondTime, setSecondTime] = useState(AFTERNOON_TIME);
  const [pattern, setPattern] = useState<Pattern>("daily");
  const [order, setOrder] = useState<Record<string, string[]>>({});
  const [skipped, setSkipped] = useState<Record<string, string[]>>({});
  const [fresh, setFresh] = useState(false);
  const [tip, setTip] = useState("");
  const [cell, setCell] = useState<{ group: string; key: string } | null>(null);
  const [phoneTab, setPhoneTab] = useState("");
  const [step, setStep] = useState<1 | 2>(1);
  const [review, setReview] = useState(false);

  const teacherName = useMemo(() => new Map(teachers.map((t) => [t.id, t.name])), [teachers]);
  const classById = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const reasonFor = useMemo(() => (value: string) => dayClosed(value, calendar), [calendar]);

  // Past exams (newest first), the same kind of exam before others. The timetable copies their pattern.
  const history = useMemo(() => {
    const kindOf = new Map((plan || []).map((p) => [p.id, p.kind]));
    const past = (series as unknown as PastSeries[])
      .filter((x) => x.planItemId !== item?.id && x.exams?.length && x.exams.some((e) => e.subject?.name))
      .map((x) => ({ ...x, last: x.exams.map((e) => String(e.date).slice(0, 10)).sort().at(-1) || "", same: kindOf.get(x.planItemId || "") === item?.kind }));
    return past.sort((a, b) => Number(b.same) - Number(a.same) || b.last.localeCompare(a.last));
  }, [series, plan, item?.id, item?.kind]);
  const basis = fresh ? undefined : history[0];
  const basisLabel = basis ? `${(plan || []).find((p) => p.id === basis.planItemId)?.name || basis.name || "last exam"} · ${classById.get(basis.classId)?.label || ""}` : "";

  function sortedExams(x: PastSeries) {
    return [...x.exams].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.startTime || "").localeCompare(String(b.startTime || "")));
  }

  function patternOf(x: PastSeries): { pattern: Pattern; first?: { start: string; end: string }; second?: { start: string; end: string } } {
    const exs = sortedExams(x);
    const days = exs.map((e) => String(e.date).slice(0, 10));
    const double = days.some((d, i) => i > 0 && d === days[i - 1]);
    const unique = [...new Set(days)];
    const gaps = unique.slice(1).map((d, i) => schoolDaysBetween(unique[i], d, calendar));
    const alternate = !double && gaps.length > 0 && gaps.filter((g) => g >= 2).length > gaps.length / 2;
    const timed = exs.find((e) => e.startTime && e.endTime);
    const secondExam = double ? exs.find((e, i) => i > 0 && String(e.date).slice(0, 10) === days[i - 1] && e.startTime && e.endTime) : undefined;
    return {
      pattern: double ? "double" : alternate ? "alternate" : "daily",
      first: timed ? { start: String(timed.startTime), end: String(timed.endTime) } : undefined,
      second: secondExam ? { start: String(secondExam.startTime), end: String(secondExam.endTime) } : undefined,
    };
  }

  useEffect(() => {
    if (!open) return;
    if (edit) {
      const klass = classById.get(edit.classId);
      const key = klass ? `grade:${gradeOf(klass)}` : "";
      const byKey: Record<string, Dates> = {};
      const picks: Record<string, string> = {};
      const setterPicks: Record<string, string> = {};
      for (const exam of edit.exams) {
        const subject = klass?.subjects?.find((x) => x.id === exam.subjectId);
        if (!subject) continue;
        const date = exam.date.slice(0, 10);
        const fallback = paperOffsets(date, DEFAULT_DEADLINE_OFFSETS, calendar);
        byKey[subjectKey(subject)] = {
          date,
          paperDueOn: (exam.paperDueOn || "").slice(0, 10) || fallback.paperDueOn,
          copiesDueOn: (exam.copiesDueOn || "").slice(0, 10) || fallback.copiesDueOn,
          startTime: exam.startTime || "",
          endTime: exam.endTime || "",
        };
        if (exam.teacherId) picks[`${edit.classId}:${subject.id}`] = exam.teacherId;
        if (exam.setterId && exam.setterId !== exam.teacherId) setterPicks[`${edit.classId}:${subject.id}`] = exam.setterId;
      }
      const first = edit.exams.map((e) => e.date.slice(0, 10)).sort()[0] || "";
      setSelected([edit.classId]);
      setSplitIds([]);
      setOffsets(DEFAULT_DEADLINE_OFFSETS);
      setStarts(first ? { [key]: first } : {});
      setDates({ [key]: byKey });
      setTeacherPick(picks);
      setSetterPick(setterPicks);
      setExpanded([]);
      setTeacherOpen([]);
      setCell(null);
      setStep(1);
    setReview(false);
      setReview(false);
      setError("");
      return;
    }
    setSelected(initialClassIds?.length ? available.filter((c) => initialClassIds.includes(c.id)).map((c) => c.id) : available.map((c) => c.id));
    setSplitIds([]);
    setOffsets(DEFAULT_DEADLINE_OFFSETS);
    setStarts({});
    setDates({});
    setTeacherPick({});
    setSetterPick({});
    setExpanded([]);
    setTeacherOpen([]);
    setExamTime(DEFAULT_TIME);
    setSecondTime(AFTERNOON_TIME);
    setPattern("daily");
    setOrder({});
    setSkipped({});
    setFresh(false);
    setCell(null);
    setStep(1);
    setReview(false);
    const start = history[0];
    if (start) {
      const found = patternOf(start);
      setPattern(found.pattern);
      if (found.first) setExamTime(found.first);
      if (found.second) setSecondTime(found.second);
    }
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id, edit?.seriesId]);

  // Grades in class order; a split section becomes its own group.
  const groups: Group[] = useMemo(() => {
    const out: Group[] = [];
    const byGrade = new Map<string, string[]>();
    for (const c of classes) {
      if (!selected.includes(c.id)) continue;
      if (splitIds.includes(c.id)) {
        out.push({ key: `class:${c.id}`, title: c.label, classIds: [c.id], split: true });
        continue;
      }
      const grade = gradeOf(c);
      byGrade.set(grade, [...(byGrade.get(grade) || []), c.id]);
    }
    for (const [grade, ids] of byGrade) {
      out.push({ key: `grade:${grade}`, title: ids.length > 1 ? `Class ${grade}` : classById.get(ids[0])?.label || grade, classIds: ids, split: false });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  }, [classes, selected, splitIds, classById]);

  function groupSubjects(group: Group) {
    const map = new Map<string, Subject>();
    const onlyThese = edit ? new Set(edit.exams.map((e) => e.subjectId)) : null;
    for (const id of group.classIds)
      for (const s of classById.get(id)?.subjects || []) if ((!onlyThese || onlyThese.has(s.id)) && !map.has(subjectKey(s))) map.set(subjectKey(s), s);
    const all = [...map.entries()].map(([key, s]) => ({ key, subject: s }));
    if (edit) return all;
    const keys = orderFor(group, all);
    return keys.map((k) => all.find((x) => x.key === k)!).filter(Boolean);
  }

  /** The past exam this class group copies: its own last exam first, else the school's last one. */
  function referenceFor(group: Group) {
    if (fresh) return undefined;
    return history.find((x) => group.classIds.includes(x.classId)) || basis;
  }

  function orderFor(group: Group, all: { key: string; subject: Subject }[]) {
    const saved = order[group.key];
    if (saved) return [...saved.filter((k) => all.some((x) => x.key === k)), ...all.map((x) => x.key).filter((k) => !saved.includes(k))];
    const ref = referenceFor(group);
    if (!ref) return all.map((x) => x.key);
    const rank = sortedExams(ref).map((e) => nameKey(e.subject?.name));
    const pos = (x: { subject: Subject }) => {
      const i = rank.indexOf(nameKey(x.subject.name));
      return i < 0 ? 999 : i;
    };
    return [...all].sort((a, b) => pos(a) - pos(b)).map((x) => x.key);
  }

  function skippedFor(group: Group, all?: { key: string; subject: Subject }[]) {
    if (edit) return [] as string[];
    const saved = skipped[group.key];
    if (saved) return saved;
    // Copy "not examined" only from this class's own last exam of the same kind (a unit test without Art, say).
    const ref = fresh ? undefined : history.find((x) => group.classIds.includes(x.classId));
    if (!ref || !(ref as { same?: boolean }).same) return [];
    const names = new Set(ref.exams.map((e) => nameKey(e.subject?.name)));
    const list = all || [...new Map(group.classIds.flatMap((id) => (classById.get(id)?.subjects || []).map((s) => [subjectKey(s), s] as const))).entries()].map(([key, subject]) => ({ key, subject }));
    return list.filter((x) => !names.has(nameKey(x.subject.name))).map((x) => x.key);
  }

  function moveSubject(group: Group, key: string, step: -1 | 1) {
    const keys = groupSubjects(group).map((x) => x.key);
    const i = keys.indexOf(key);
    const j = i + step;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    setOrder((cur) => ({ ...cur, [group.key]: keys }));
  }

  function toggleSkip(group: Group, key: string) {
    const current = skippedFor(group);
    setSkipped((cur) => ({ ...cur, [group.key]: current.includes(key) ? current.filter((k) => k !== key) : [...current, key] }));
    setDates((cur) => {
      const own = { ...(cur[group.key] || {}) };
      delete own[key];
      return { ...cur, [group.key]: own };
    });
  }

  function seedGroup(group: Group, start: string): Record<string, Dates> {
    const all = groupSubjects(group);
    const off = skippedFor(group, all);
    const subjects = all.filter((x) => !off.includes(x.key));
    const perDay = pattern === "double" ? 2 : 1;
    const dayCount = Math.ceil(subjects.length / perDay);
    const days = paperDates(dayCount, start, pattern === "alternate" ? "gap" : "school", calendar);
    return Object.fromEntries(
      subjects.map(({ key }, i) => {
        const date = days[Math.floor(i / perDay)] || start;
        const slot = perDay === 2 && i % 2 === 1 ? secondTime : examTime;
        const { paperDueOn, copiesDueOn } = paperOffsets(date, offsets, calendar);
        return [key, { date, paperDueOn, copiesDueOn, startTime: slot.start, endTime: slot.end }];
      })
    );
  }

  function groupStart(group: Group) {
    return starts[group.key] || defaultExamStart(calendar);
  }

  function groupDates(group: Group) {
    const saved = dates[group.key] || {};
    const seeded = seedGroup(group, groupStart(group));
    return Object.fromEntries(Object.entries(seeded).map(([k, v]) => [k, saved[k] || v]));
  }

  function setGroupStart(group: Group, start: string) {
    if (edit) {
      // Editing: move every paper by the same number of days, keeping the order and gaps.
      const before = groupStart(group);
      const delta = Math.round((Date.parse(`${start}T00:00:00Z`) - Date.parse(`${before}T00:00:00Z`)) / 86400000);
      const current = groupDates(group);
      setStarts((cur) => ({ ...cur, [group.key]: start }));
      setDates((cur) => ({
        ...cur,
        [group.key]: Object.fromEntries(
          Object.entries(current).map(([k, v]) => [
            k,
            { ...v, date: addDays(v.date, delta), paperDueOn: addDays(v.paperDueOn, delta), copiesDueOn: addDays(v.copiesDueOn, delta) },
          ])
        ),
      }));
      return;
    }
    setStarts((cur) => ({ ...cur, [group.key]: start }));
    setDates((cur) => ({ ...cur, [group.key]: {} }));
  }

  function setRow(group: Group, key: string, next: Partial<Dates>) {
    const current = groupDates(group);
    const row = { ...current[key], ...next };
    const shifted = next.date ? paperOffsets(row.date, offsets, calendar) : null;
    const moved = shifted ? { ...row, paperDueOn: shifted.paperDueOn, copiesDueOn: shifted.copiesDueOn } : row;
    setDates((cur) => ({ ...cur, [group.key]: edit ? { ...current, [key]: moved } : { ...(cur[group.key] || {}), [key]: moved } }));
  }

  function applyGaps(next: DeadlineOffsets) {
    setOffsets(next);
    setDates((cur) => {
      const out: typeof cur = {};
      for (const group of groups) {
        const current = cur[group.key] || {};
        out[group.key] = Object.fromEntries(
          Object.entries(current).map(([k, v]) => {
            const d = paperOffsets(v.date, next, calendar);
            return [k, { ...v, paperDueOn: d.paperDueOn, copiesDueOn: d.copiesDueOn }];
          })
        );
      }
      return out;
    });
  }

  function applyExamTime(start: string, end: string) {
    const before = examTime;
    setExamTime({ start, end });
    setDates((cur) => {
      const out: typeof cur = {};
      for (const group of groups) {
        const current = cur[group.key] || {};
        out[group.key] = Object.fromEntries(
          Object.entries(current).map(([k, v]) => [
            k,
            (v.startTime || "") === before.start && (v.endTime || "") === before.end ? { ...v, startTime: start, endTime: end } : v,
          ])
        );
      }
      return { ...cur, ...out };
    });
  }

  function teacherFor(classId: string, subject: Subject | undefined) {
    if (!subject) return "";
    return teacherPick[`${classId}:${subject.id}`] || subject.teacherId || "";
  }

  function setterFor(classId: string, subject: Subject | undefined) {
    if (!subject) return "";
    return setterPick[`${classId}:${subject.id}`] || teacherFor(classId, subject);
  }

  // Everything the server needs, plus a list of what still blocks scheduling.
  const payload = groups.flatMap((group) => {
    const rows = groupDates(group);
    return group.classIds.map((classId) => {
      const klass = classById.get(classId);
      return {
        classId,
        papers: (klass?.subjects || []).filter((s) => (edit ? edit.exams.some((e) => e.subjectId === s.id) : !skippedFor(group).includes(subjectKey(s)))).map((s) => ({
          subjectId: s.id,
          teacherId: teacherFor(classId, s) || null,
          setterId: setterFor(classId, s) || null,
          ...(rows[subjectKey(s)] || { date: "", paperDueOn: "", copiesDueOn: "" }),
        })),
      };
    });
  });
  const missingTeachers = payload.flatMap((c) =>
    c.papers.filter((p) => !p.teacherId).map((p) => `${classById.get(c.classId)?.label} ${classById.get(c.classId)?.subjects?.find((s) => s.id === p.subjectId)?.name}`)
  );
  const badOrder = payload.some((c) => c.papers.some((p) => !(p.paperDueOn < p.date && p.date < p.copiesDueOn)));
  const paperCount = payload.reduce((sum, c) => sum + c.papers.length, 0);
  const teacherCount = new Set(payload.flatMap((c) => c.papers.flatMap((p) => [p.teacherId, p.setterId]).filter(Boolean))).size;
  const lastCheck = payload.flatMap((c) => c.papers.map((p) => p.copiesDueOn)).filter(Boolean).sort().at(-1) || "";
  const keptResult = (edit?.resultOn || "").slice(0, 10);
  const resultOn = keptResult && keptResult >= lastCheck ? keptResult : lastCheck ? shiftSchoolDays(lastCheck, offsets.resultAfter, calendar) : "";

  async function submit() {
    if (!item) return;
    if (!payload.length) return setError("Pick at least one class.");
    if (badOrder) return setError("Some dates are in the wrong order. Paper ready → exam day → checking done.");
    setBusy(true);
    setError("");
    if (edit) {
      try {
        const max = new Map(edit.exams.map((e) => [e.subjectId, e.maxMarks]));
        await act(token, "updateExamSeriesPapers", {
          seriesId: edit.seriesId,
          papers: (payload[0]?.papers || []).map((p) => ({
            ...p,
            teacherId: p.teacherId || "",
            setterId: p.setterId || p.teacherId || "",
            maxMarks: max.get(p.subjectId) || item.maxMarks || 80,
            resultOn,
          })),
        });
        onDone("Dates saved.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const res = await act<{ ok: true; classes: number; papers: number; teachers: number }>(token, "scheduleExamForClasses", {
        sessionId,
        planItemId: item.id,
        resultOn,
        classes: payload,
      });
      onDone(`${item.name} scheduled for ${res.classes} class${res.classes === 1 ? "" : "es"} · ${res.papers} papers · ${res.teachers} teacher${res.teachers === 1 ? "" : "s"} notified.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not schedule.");
    } finally {
      setBusy(false);
    }
  }

  if (!item) return null;
  const startValue = groups[0] ? groupStart(groups[0]) : defaultExamStart(calendar);
  function setAllStart(value: string) {
    for (const group of groups) setGroupStart(group, value);
  }
  const weekday = (value: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${value}T00:00:00`).getDay()];

  // The date sheet: one column per class group, one row per exam slot (day + time).
  const sheet = groups.map((group) => {
    const all = groupSubjects(group);
    const off = skippedFor(group, all);
    const rows = groupDates(group);
    return { group, all, off, rows, active: all.filter((x) => !off.includes(x.key)) };
  });
  const slots = [
    ...new Map(
      sheet
        .flatMap((col) => col.active.map((x) => col.rows[x.key]).filter(Boolean))
        .map((r) => [`${r.date}|${r.startTime || ""}`, { date: r.date, start: r.startTime || "", end: r.endTime || "" }] as const)
    ).values(),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  const multiTime = new Set(slots.map((x) => `${x.start}-${x.end}`)).size > 1;
  const [picked, setPicked] = [cell, setCell];
  const pickedCol = picked ? sheet.find((c) => c.group.key === picked.group) : undefined;
  const pickedSub = pickedCol?.all.find((x) => x.key === picked?.key);
  const pickedRow = pickedCol && picked ? pickedCol.rows[picked.key] : undefined;
  const [tabKey, setTabKey] = [phoneTab, setPhoneTab];
  const phoneCol = sheet.find((c) => c.group.key === tabKey) || sheet[0];

  function swapWith(groupKey: string, a: string, b: string) {
    const col = sheet.find((c) => c.group.key === groupKey);
    if (!col) return;
    const keys = col.all.map((x) => x.key);
    const i = keys.indexOf(a);
    const j = keys.indexOf(b);
    if (i < 0 || j < 0) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    setOrder((cur) => ({ ...cur, [groupKey]: keys }));
    setDates((cur) => {
      const own = { ...(cur[groupKey] || {}) };
      delete own[a];
      delete own[b];
      return { ...cur, [groupKey]: own };
    });
  }

  function teacherNames(group: Group, key: string) {
    return [
      ...new Set(
        group.classIds
          .map((classId) => {
            const own = classById.get(classId)?.subjects?.find((s) => subjectKey(s) === key);
            return own ? teacherName.get(teacherFor(classId, own)) || "" : "";
          })
          .filter(Boolean)
      ),
    ].join(", ");
  }

  const settings = (
    <View className="gap-4">
      {edit ? null : (
        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-[13px] font-semibold text-ink-900">Classes</Text>
            {available.length ? (
              <Pressable onPress={() => setSelected(selected.length === available.length ? [] : available.map((c) => c.id))}>
                <Text className="text-xs font-medium text-clay-600">{selected.length === available.length ? "Clear" : "All"}</Text>
              </Pressable>
            ) : null}
          </View>
          <View className="flex-row flex-wrap gap-1.5">
            {classes.map((c) => {
              const done = scheduled.has(c.id);
              const noSubjects = !c.subjects?.length;
              const on = selected.includes(c.id);
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: done || noSubjects }}
                  disabled={done || noSubjects}
                  onPress={() => setSelected((cur) => (on ? cur.filter((id) => id !== c.id) : [...cur, c.id]))}
                  className={`h-8 flex-row items-center gap-1 rounded-full border px-3 ${done ? "border-emerald-200 bg-emerald-50" : on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"} ${noSubjects ? "opacity-40" : ""}`}
                >
                  {done ? <Ionicons name="checkmark" size={12} color="#16A34A" /> : null}
                  <Text className={`text-[13px] font-medium ${done ? "text-emerald-700" : on ? "text-white" : "text-ink-800"}`}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {scheduled.size ? <Text className="text-[11px] text-ink-500">Green = already scheduled</Text> : null}
        </View>
      )}

      <View className="gap-3 rounded-xl border border-ink-200 bg-white p-3">
        <View className="gap-1.5">
          <Text className="text-[12px] font-medium text-ink-600">{edit ? "Move all papers to start on" : "Starts on"}</Text>
          <DateField plain value={startValue} onChange={setAllStart} closedReason={reasonFor} />
        </View>
        {edit ? null : (
          <>
            <View className="gap-1.5">
              <RuleLabel id="papers" title="Papers" tip={tip} onTip={setTip} />
              <View className="flex-row flex-wrap gap-1.5">
                {(
                  [
                    ["daily", "Daily"],
                    ["alternate", "Alternate days"],
                    ["double", "2 a day"],
                  ] as const
                ).map(([id, label]) => (
                  <Pressable
                    key={id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: pattern === id }}
                    onPress={() => setPattern(id)}
                    className={`h-8 justify-center rounded-full border px-3 ${pattern === id ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}
                  >
                    <Text className={`text-[13px] font-medium ${pattern === id ? "text-white" : "text-ink-800"}`}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View className="gap-1.5">
              <RuleLabel id="time" title="Exam time" tip={tip} onTip={setTip} />
              <View className="flex-row flex-wrap items-center gap-2">
                <ExamTimeField compact start={examTime.start} end={examTime.end} onChange={applyExamTime} />
                {pattern === "double" ? <ExamTimeField compact start={secondTime.start} end={secondTime.end} onChange={(start, end) => setSecondTime({ start, end })} /> : null}
              </View>
            </View>
            <View className="gap-1.5">
              <View className="flex-row items-center justify-between">
                <RuleLabel id="deadlines" title="Deadlines" tip={tip} onTip={setTip} />
                <Pressable onPress={() => setGapsOpen((v) => !v)}>
                  <Text className="text-[12px] font-medium text-clay-600">{gapsOpen ? "Done" : "Edit"}</Text>
                </Pressable>
              </View>
              {gapsOpen ? (
                <View className="gap-2">
                  {(
                    [
                      ["paperBefore", "Paper due", "days before"],
                      ["copiesAfter", "Checking due", "days after"],
                      ["resultAfter", "Results", "days after checking"],
                    ] as const
                  ).map(([key, title, hint]) => (
                    <View key={key} className="flex-row items-center gap-2">
                      <Text className="w-[88px] text-[12px] text-ink-700">{title}</Text>
                      <View className="flex-row items-center overflow-hidden rounded-lg border border-ink-200">
                        <Pressable accessibilityLabel={`${title} fewer days`} onPress={() => applyGaps({ ...offsets, [key]: Math.max(1, offsets[key] - 1) })} className="h-7 w-7 items-center justify-center">
                          <Ionicons name="remove" size={13} color="#334155" />
                        </Pressable>
                        <Text className="w-7 text-center text-[13px] font-semibold tabular-nums text-ink-900">{offsets[key]}</Text>
                        <Pressable accessibilityLabel={`${title} more days`} onPress={() => applyGaps({ ...offsets, [key]: Math.min(60, offsets[key] + 1) })} className="h-7 w-7 items-center justify-center">
                          <Ionicons name="add" size={13} color="#334155" />
                        </Pressable>
                      </View>
                      <Text className="text-[12px] text-ink-500">{hint}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text className="text-[12px] text-ink-500">{`Paper ${offsets.paperBefore}d before · checking ${offsets.copiesAfter}d after · results ${offsets.resultAfter}d later`}</Text>
              )}
            </View>

          </>
        )}
      </View>
      {basis && !edit ? (
        <Pressable onPress={() => { setFresh(true); setOrder({}); setSkipped({}); }} className="flex-row flex-wrap items-center gap-1">
          <Ionicons name="copy-outline" size={13} color="#64748B" />
          <Text className="text-[12px] text-ink-500">{`Same as ${basisLabel}`}</Text>
          <Text className="text-[12px] font-medium text-clay-600">· Reset</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const editor =
    picked && pickedCol && pickedSub ? (
      <View className="gap-3 rounded-xl border border-clay-200 bg-clay-50/40 p-3">
        <View className="flex-row items-center gap-2">
          <Text className="min-w-0 flex-1 text-[14px] font-semibold text-ink-900">{`${pickedSub.subject.name} · ${pickedCol.group.title}`}</Text>
          <Pressable accessibilityLabel="Close" onPress={() => setPicked(null)} className="h-7 w-7 items-center justify-center rounded-full bg-white">
            <Ionicons name="close" size={14} color="#334155" />
          </Pressable>
        </View>
        {!edit ? (
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-[12px] text-ink-600">Swap with</Text>
            {pickedCol.active
              .filter((x) => x.key !== pickedSub.key)
              .map((x) => (
                <Pressable key={x.key} onPress={() => swapWith(pickedCol.group.key, pickedSub.key, x.key)} className="h-7 justify-center rounded-full border border-ink-200 bg-white px-2.5">
                  <Text className="text-[12px] text-ink-800">{x.subject.name}</Text>
                </Pressable>
              ))}
          </View>
        ) : null}
        <View className={narrow ? "gap-2" : "flex-row gap-2"}>
          <View className="flex-1 gap-1">
            <Text className="text-[11px] font-medium text-ink-600">Exam day</Text>
            <DateField plain value={pickedRow?.date || ""} closedReason={reasonFor} onChange={(v) => setRow(pickedCol.group, pickedSub.key, { date: v })} />
          </View>
          <View className="gap-1">
            <Text className="text-[11px] font-medium text-ink-600">Time</Text>
            <ExamTimeField start={pickedRow?.startTime || ""} end={pickedRow?.endTime || ""} onChange={(startTime, endTime) => setRow(pickedCol.group, pickedSub.key, { startTime, endTime })} />
          </View>
        </View>
        <View className={narrow ? "gap-2" : "flex-row gap-2"}>
          <View className="flex-1 gap-1">
            <Text className="text-[11px] font-medium text-ink-600">Paper due</Text>
            <DateField plain value={pickedRow?.paperDueOn || ""} max={pickedRow?.date ? addDays(pickedRow.date, -1) : undefined} onChange={(v) => setRow(pickedCol.group, pickedSub.key, { paperDueOn: v })} />
          </View>
          <View className="flex-1 gap-1">
            <Text className="text-[11px] font-medium text-ink-600">Checking due</Text>
            <DateField plain value={pickedRow?.copiesDueOn || ""} min={pickedRow?.date ? addDays(pickedRow.date, 1) : undefined} onChange={(v) => setRow(pickedCol.group, pickedSub.key, { copiesDueOn: v })} />
          </View>
        </View>
        <View className="gap-1">
          {pickedCol.group.classIds.map((classId) => {
            const own = classById.get(classId)?.subjects?.find((s) => subjectKey(s) === pickedSub.key);
            if (!own) return null;
            const key = `${classId}:${own.id}`;
            return (
              <View key={classId} className="gap-1.5">
                {pickedCol.group.classIds.length > 1 ? <Text className="text-[12px] font-medium text-ink-700">{classById.get(classId)?.label}</Text> : null}
                <View className={narrow ? "gap-2" : "flex-row gap-2"}>
                  <View className="flex-1 gap-1">
                    <Text className="text-[11px] font-medium text-ink-600">Paper setter</Text>
                    <Select value={setterFor(classId, own)} placeholder="Pick the teacher" options={teachers.map((t) => ({ id: t.id, label: t.name }))} onChange={(id) => setSetterPick((cur) => ({ ...cur, [key]: id }))} />
                  </View>
                  <View className="flex-1 gap-1">
                    <Text className="text-[11px] font-medium text-ink-600">Copy checker</Text>
                    <Select value={teacherFor(classId, own)} placeholder="Pick the teacher" options={teachers.map((t) => ({ id: t.id, label: t.name }))} onChange={(id) => setTeacherPick((cur) => ({ ...cur, [key]: id }))} />
                  </View>
                </View>
              </View>
            );
          })}
        </View>
        {!edit ? (
          <Pressable onPress={() => { toggleSkip(pickedCol.group, pickedSub.key); setPicked(null); }} className="flex-row items-center gap-1.5 self-start">
            <Ionicons name="remove-circle-outline" size={14} color="#64748B" />
            <Text className="text-[12px] font-medium text-ink-600">{`Not examined in ${item.name}`}</Text>
          </Pressable>
        ) : null}
      </View>
    ) : null;

  const cellButton = (col: (typeof sheet)[number], key: string, label: string) => {
    const on = picked?.group === col.group.key && picked?.key === key;
    const missing = col.group.classIds.some((classId) => {
      const own = classById.get(classId)?.subjects?.find((s) => subjectKey(s) === key);
      return own && !teacherFor(classId, own);
    });
    const split = col.group.classIds.some((classId) => {
      const own = classById.get(classId)?.subjects?.find((s) => subjectKey(s) === key);
      return own && setterFor(classId, own) !== teacherFor(classId, own);
    });
    return (
      <Pressable
        key={key}
        onPress={() => setPicked(on ? null : { group: col.group.key, key })}
        className={`rounded-md px-2 py-1.5 ${on ? "bg-clay-500" : "bg-white hover:bg-clay-50"} border ${on ? "border-clay-500" : missing ? "border-amber-300" : "border-ink-100"}`}
      >
        <Text className={`text-[13px] font-medium ${on ? "text-white" : "text-ink-900"}`} numberOfLines={1}>{label}</Text>
        {split ? <Text className={`text-[10px] ${on ? "text-white/80" : "text-ink-500"}`}>2 teachers</Text> : null}
      </Pressable>
    );
  };

  const restingList = sheet.filter((c) => c.off.length).length ? (
    <View className="flex-row flex-wrap items-center gap-1.5">
      <Text className="text-[12px] text-ink-500">Not examined:</Text>
      {sheet.flatMap((col) =>
        col.off.map((key) => {
          const sub = col.all.find((x) => x.key === key);
          return (
            <Pressable key={`${col.group.key}:${key}`} onPress={() => toggleSkip(col.group, key)} className="flex-row items-center gap-1 rounded-full border border-ink-200 bg-white px-2 py-0.5">
              <Text className="text-[12px] text-ink-500 line-through">{`${col.group.title} ${sub?.subject.name || key}`}</Text>
              <Ionicons name="add" size={12} color="#2563EB" />
            </Pressable>
          );
        })
      )}
    </View>
  ) : null;

  const teacherBanner = missingTeachers.length ? (
    <View className="flex-row items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <Ionicons name="alert-circle-outline" size={15} color="#B45309" />
      <Text className="min-w-0 flex-1 text-[12px] text-amber-900">
        {`${missingTeachers.length} paper${missingTeachers.length === 1 ? " needs" : "s need"} a teacher — tap the amber subjects to pick one.`}
      </Text>
    </View>
  ) : null;

  const desktopSheet = (
    <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <ScrollView horizontal nestedScrollEnabled>
        <View style={{ minWidth: "100%" }}>
          <View className="flex-row border-b border-ink-200 bg-ink-50">
            <View className="w-[110px] px-3 py-2">
              <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500">Date</Text>
            </View>
            {sheet.map((col) => (
              <View key={col.group.key} className="min-w-[130px] flex-1 border-l border-ink-200 px-2 py-2">
                <Text className="text-[13px] font-semibold text-ink-900">{col.group.title}</Text>
                {col.group.classIds.length > 1 && !col.group.split ? (
                  <Select value="" placeholder="Split…" options={col.group.classIds.map((id) => ({ id, label: classById.get(id)?.label || id }))} onChange={(id) => setSplitIds((cur) => [...cur, id])} />
                ) : col.group.split ? (
                  <Pressable onPress={() => setSplitIds((cur) => cur.filter((id) => id !== col.group.classIds[0]))}>
                    <Text className="text-[11px] font-medium text-clay-600">Use class dates</Text>
                  </Pressable>
                ) : (
                  <Text className="text-[11px] text-ink-500">{`${col.active.length} papers`}</Text>
                )}
              </View>
            ))}
          </View>
          {slots.map((slot) => (
            <View key={`${slot.date}|${slot.start}`} className="flex-row border-b border-ink-100">
              <View className="w-[110px] justify-center px-3 py-2">
                <Text className="text-[13px] font-semibold text-ink-900">{`${weekday(slot.date)}, ${prettyDay(slot.date)}`}</Text>
                {multiTime && slot.start ? <Text className="text-[11px] text-ink-500">{prettyTimeRange(slot.start, slot.end)}</Text> : null}
              </View>
              {sheet.map((col) => {
                const here = col.active.filter((x) => col.rows[x.key]?.date === slot.date && (col.rows[x.key]?.startTime || "") === slot.start);
                return (
                  <View key={col.group.key} className="min-w-[130px] flex-1 gap-1 border-l border-ink-100 px-2 py-1.5">
                    {here.length ? (
                      here.map((x) =>
                        edit ? (
                          cellButton(col, x.key, x.subject.name)
                        ) : (
                          <DragCell key={x.key} groupKey={col.group.key} itemKey={x.key} onSwap={(from, to) => swapWith(col.group.key, from, to)}>
                            {cellButton(col, x.key, x.subject.name)}
                          </DragCell>
                        )
                      )
                    ) : (
                      <Text className="py-1.5 text-[13px] text-ink-300">—</Text>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );

  const phoneSheet = phoneCol ? (
    <View className="gap-3">
      {sheet.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
          {sheet.map((col) => (
            <Pressable key={col.group.key} onPress={() => setTabKey(col.group.key)} className={`h-8 justify-center rounded-full border px-3 ${col.group.key === phoneCol.group.key ? "border-ink-900 bg-ink-900" : "border-ink-200 bg-white"}`}>
              <Text className={`text-[13px] font-medium ${col.group.key === phoneCol.group.key ? "text-white" : "text-ink-800"}`}>{col.group.title}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
        {phoneCol.active
          .slice()
          .sort((a, b) => (phoneCol.rows[a.key]?.date || "").localeCompare(phoneCol.rows[b.key]?.date || "") || (phoneCol.rows[a.key]?.startTime || "").localeCompare(phoneCol.rows[b.key]?.startTime || ""))
          .map((x, i) => {
            const r = phoneCol.rows[x.key];
            const on = picked?.group === phoneCol.group.key && picked?.key === x.key;
            return (
              <View key={x.key} className={i ? "border-t border-ink-100" : ""}>
              <Pressable onPress={() => setPicked(on ? null : { group: phoneCol.group.key, key: x.key })} className={`flex-row items-center gap-3 px-3 py-2.5 ${on ? "bg-clay-50" : ""}`}>
                <View className="w-[122px]">
                  <Text className="text-[13px] font-semibold text-ink-900">{r ? `${weekday(r.date)}, ${prettyDay(r.date)}` : "—"}</Text>
                  {r?.startTime && r?.endTime ? <Text className="text-[11px] text-ink-500">{prettyTimeRange(r.startTime, r.endTime)}</Text> : null}
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-[14px] font-medium text-ink-900" numberOfLines={1}>{x.subject.name}</Text>
                  <Text className="text-[12px] text-ink-500" numberOfLines={1}>{teacherNames(phoneCol.group, x.key) || "Pick a teacher"}</Text>
                </View>
                <Ionicons name={on ? "chevron-up" : "chevron-down"} size={14} color="#94A3B8" />
              </Pressable>
              {on ? <View className="px-2 pb-2">{editor}</View> : null}
              </View>
            );
          })}
      </View>
    </View>
  ) : null;

  const empty = !groups.length ? (
    <View className="items-center rounded-xl border border-dashed border-ink-200 px-6 py-10">
      <Text className="text-[14px] font-medium text-ink-900">{available.length ? "Pick the classes to schedule" : `Every class already has ${item.name}`}</Text>
    </View>
  ) : null;

  const summary = edit
    ? `${paperCount} papers · ${teacherCount} teacher${teacherCount === 1 ? "" : "s"}`
    : `${payload.length} class${payload.length === 1 ? "" : "es"} · ${paperCount} papers · ${teacherCount} teacher${teacherCount === 1 ? "" : "s"}`;
  const primaryLabel = edit ? "Save dates" : `Schedule ${item.name}`;

  // Review: the date sheet as teachers and the office will see it, then who gets a message.
  const allDays = payload.flatMap((c) => c.papers.map((p) => p.date)).filter(Boolean).sort();
  const timeOf = (p: (typeof payload)[number]["papers"][number]) =>
    prettyTimeRange(String((p as { startTime?: string }).startTime || ""), String((p as { endTime?: string }).endTime || ""));
  const times = [...new Set(payload.flatMap((c) => c.papers.map(timeOf)))];
  const sharedTime = times.length === 1 ? times[0] : "";
  const notified = new Map<string, { name: string; sets: number; checks: number }>();
  for (const c of payload) {
    for (const p of c.papers) {
      const setter = (p as { setterId?: string | null }).setterId || p.teacherId;
      for (const [id, role] of [[setter, "sets"], [p.teacherId, "checks"]] as const) {
        if (!id) continue;
        const row = notified.get(id) || { name: teacherName.get(id) || "Teacher", sets: 0, checks: 0 };
        row[role] += 1;
        notified.set(id, row);
      }
    }
  }
  const teacherCards = [...notified.values()].sort((a, b) => a.name.localeCompare(b.name));
  const facts = [
    `${payload.length} ${payload.length === 1 ? "class" : "classes"}`,
    `${paperCount} papers`,
    allDays.length ? `${prettyDay(allDays[0])} – ${prettyDay(allDays[allDays.length - 1])}` : "",
    sharedTime,
    resultOn ? `Results ${prettyDay(resultOn)}` : "",
  ].filter(Boolean);
  function reviewEditTarget(classId: string, subjectId: string) {
    const group = groups.find((g) => g.classIds.includes(classId));
    const subject = classById.get(classId)?.subjects?.find((x) => x.id === subjectId);
    return group && subject ? { group, subject, key: subjectKey(subject) } : null;
  }
  const reviewPanel = (
    <View className="gap-5">
      <Text className="text-[13px] text-ink-700">Check every paper. Change any day, time or teacher right here; deadlines move with the day.</Text>
      <View className="flex-row flex-wrap gap-2">
        {facts.map((fact) => (
          <View key={fact} className="h-8 justify-center rounded-full bg-ink-100 px-3">
            <Text className="text-[13px] font-medium text-ink-800">{fact}</Text>
          </View>
        ))}
      </View>

      {missingTeachers.length ? (
        <View className="flex-row items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <Ionicons name="alert-circle-outline" size={16} color="#B91C1C" />
          <Text className="min-w-0 flex-1 text-[13px] text-red-800">{`${missingTeachers.length} paper${missingTeachers.length === 1 ? " has" : "s have"} no teacher (${missingTeachers.slice(0, 3).join(", ")}${missingTeachers.length > 3 ? "…" : ""}). Go back and pick one.`}</Text>
        </View>
      ) : null}

      {payload.map((c) => {
        const klass = classById.get(c.classId);
        const papers = c.papers.slice().sort((x, y) => x.date.localeCompare(y.date) || timeOf(x).localeCompare(timeOf(y)));
        return (
          <View key={c.classId} className="gap-2">
            <Text className="text-[13px] font-semibold text-ink-900">{`${klass?.label || "Class"} · date sheet`}</Text>
            <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
              {narrow ? null : (
                <View className="flex-row items-center gap-3 border-b border-ink-100 bg-ink-50/70 px-3 py-2">
                  <Text className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Subject</Text>
                  <Text className="w-[150px] text-[11px] font-semibold uppercase tracking-wide text-ink-500">Day</Text>
                  <Text className="w-[184px] text-[11px] font-semibold uppercase tracking-wide text-ink-500">Time</Text>
                  <Text className="w-[184px] text-[11px] font-semibold uppercase tracking-wide text-ink-500">Teacher</Text>
                  <Text className="w-[112px] text-[11px] font-semibold uppercase tracking-wide text-ink-500">Deadlines</Text>
                </View>
              )}
              {papers.map((p, i) => {
                const subject = klass?.subjects?.find((x) => x.id === p.subjectId)?.name || "";
                const setter = (p as { setterId?: string | null }).setterId || p.teacherId;
                const checker = teacherName.get(p.teacherId || "") || "No teacher";
                const who = setter && setter !== p.teacherId ? `${teacherName.get(setter) || "Teacher"} sets · ${checker} checks` : checker;
                const deadlines = `by ${prettyDay(p.paperDueOn)} · by ${prettyDay(p.copiesDueOn)}`;
                const day = `${weekday(p.date)}, ${prettyDay(p.date)}`;
                const target = reviewEditTarget(c.classId, p.subjectId);
                const ownSubject = classById.get(c.classId)?.subjects?.find((x) => x.id === p.subjectId);
                const pt = p as { startTime?: string; endTime?: string };
                const dayField = target ? (
                  <DateField compact plain value={p.date} closedReason={reasonFor} onChange={(v) => setRow(target.group, target.key, { date: v })} />
                ) : (
                  <Text className="text-[13px] text-ink-900">{day}</Text>
                );
                const timeField = target ? (
                  <ExamTimeField compact start={pt.startTime || ""} end={pt.endTime || ""} onChange={(startTime, endTime) => setRow(target.group, target.key, { startTime, endTime })} />
                ) : null;
                const teacherField = ownSubject ? (
                  <View className={p.teacherId ? "" : "rounded-md border border-red-300"}>
                    <Select
                      value={p.teacherId || ""}
                      placeholder="Pick teacher"
                      options={teachers.map((t) => ({ id: t.id, label: t.name }))}
                      onChange={(id) => setTeacherPick((cur) => ({ ...cur, [`${c.classId}:${ownSubject.id}`]: id }))}
                    />
                  </View>
                ) : (
                  <Text className="text-[13px] text-ink-700">{who}</Text>
                );
                return narrow ? (
                  <View key={p.subjectId} className={`gap-2 px-3 py-3 ${i ? "border-t border-ink-100" : ""}`}>
                    <Text className="text-[14px] font-semibold text-ink-900">{subject}</Text>
                    <View className="flex-row flex-wrap gap-2">
                      <View className="min-w-[150px] flex-1">{dayField}</View>
                      {timeField}
                    </View>
                    {teacherField}
                    {setter && setter !== p.teacherId ? <Text className="text-[12px] text-ink-600">{`${teacherName.get(setter) || "Teacher"} sets the paper`}</Text> : null}
                    <Text className="text-[12px] text-ink-500">{`Paper by ${prettyDay(p.paperDueOn)} · checking by ${prettyDay(p.copiesDueOn)}`}</Text>
                  </View>
                ) : (
                  <View key={p.subjectId} className={`flex-row items-center gap-3 px-3 py-2 ${i ? "border-t border-ink-100" : ""}`}>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[14px] font-semibold text-ink-900" numberOfLines={1}>{subject}</Text>
                      {setter && setter !== p.teacherId ? <Text className="text-[11px] text-ink-500" numberOfLines={1}>{`${teacherName.get(setter) || "Teacher"} sets the paper`}</Text> : null}
                    </View>
                    <View className="w-[150px]">{dayField}</View>
                    <View className="w-[184px]">{timeField}</View>
                    <View className="w-[184px]">{teacherField}</View>
                    <View className="w-[112px] gap-0.5">
                      <View className="flex-row items-center gap-1.5">
                        <Ionicons name="document-text-outline" size={12} color="#94A3B8" />
                        <Text className="text-[12px] text-ink-700">{`Paper ${prettyDay(p.paperDueOn)}`}</Text>
                      </View>
                      <View className="flex-row items-center gap-1.5">
                        <Ionicons name="checkmark-done-outline" size={12} color="#94A3B8" />
                        <Text className="text-[12px] text-ink-700">{`Check ${prettyDay(p.copiesDueOn)}`}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}

      <View className="gap-2">
        <Text className="text-[13px] font-semibold text-ink-900">{`${teacherCards.length} teacher${teacherCards.length === 1 ? "" : "s"} get one message with their papers and dates`}</Text>
        <View className="flex-row flex-wrap gap-2">
          {teacherCards.map((t) => (
            <View key={t.name} className="flex-row items-center gap-2 rounded-full border border-ink-200 bg-white py-1 pl-1 pr-3">
              <View className="h-6 w-6 items-center justify-center rounded-full bg-clay-50">
                <Text className="text-[10px] font-semibold text-clay-600">{t.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</Text>
              </View>
              <Text className="text-[13px] font-medium text-ink-900">{t.name}</Text>
              <Text className="text-[12px] text-ink-500">
                {[t.checks ? `${t.checks} to check` : "", t.sets && t.sets !== t.checks ? `${t.sets} to set` : ""].filter(Boolean).join(" · ")}
              </Text>
            </View>
          ))}
        </View>
        <Text className="text-[12px] text-ink-500">Parents see these dates only after you turn on "Dates visible to parents" on the class page.</Text>
      </View>
    </View>
  );

  return (
    <Modal
      open={open}
      large
      sheetOnPhone
      scroll={narrow}
      title={edit ? `Edit dates · ${item.name} · ${classById.get(edit.classId)?.label || ""}` : review ? `Review · ${item.name}` : `Schedule ${item.name}`}
      onClose={onClose}
      footer={
        narrow ? (
          <View className="gap-2.5">
            <Text className="text-center text-[13px] text-ink-600">{`${summary}${resultOn ? ` · results ${prettyDay(resultOn)}` : ""}`}</Text>
            <View className="flex-row gap-2">
              {step === 2 ? (
                <Pressable accessibilityRole="button" onPress={() => (review ? setReview(false) : setStep(1))} className="h-12 w-24 items-center justify-center rounded-lg border border-ink-200">
                  <Text className="text-[15px] font-medium text-ink-800">Back</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={busy || !payload.length || (review && missingTeachers.length > 0)}
                onPress={() => (step === 1 ? setStep(2) : edit || review ? void submit() : setReview(true))}
                className={`h-12 flex-1 flex-row items-center justify-center gap-2 rounded-lg bg-clay-500 ${busy || !payload.length || (review && missingTeachers.length > 0) ? "opacity-50" : ""}`}
              >
                {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
                <Text className="text-[15px] font-semibold text-white">{step === 1 ? "Next: date sheet" : edit ? primaryLabel : review ? "Confirm & schedule" : "Review"}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-[13px] font-medium text-ink-900">{summary}</Text>
              <Text className="mt-0.5 text-xs text-ink-500">{`${resultOn ? `Results ${prettyDay(resultOn, true)} · ` : ""}Each teacher gets one message and reminders.`}</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Pressable accessibilityRole="button" onPress={() => (review ? setReview(false) : onClose())} className="h-9 justify-center px-3">
                <Text className="text-[13px] font-medium text-ink-600">{review ? "Back to edit" : "Cancel"}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy || !payload.length || (review && missingTeachers.length > 0)}
                onPress={() => (edit || review ? void submit() : setReview(true))}
                className={`h-9 flex-row items-center gap-2 rounded-md bg-clay-500 px-4 ${busy || !payload.length || (review && missingTeachers.length > 0) ? "opacity-50" : ""}`}
              >
                {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
                <Text className="text-[13px] font-semibold text-white">{edit ? primaryLabel : review ? `Confirm & notify ${teacherCards.length} teacher${teacherCards.length === 1 ? "" : "s"}` : "Review schedule"}</Text>
              </Pressable>
            </View>
          </View>
        )
      }
    >
      {review ? (
        <ScrollView style={narrow ? undefined : { maxHeight: paneHeight }} contentContainerClassName="pr-1">
          {reviewPanel}
          {error ? <Text className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</Text> : null}
        </ScrollView>
      ) : narrow ? (
        <View className="gap-4">
          {step === 1 ? settings : (
            <>
              {empty || phoneSheet}
              {teacherBanner}
              {restingList}
            </>
          )}
          {error ? <Text className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</Text> : null}
        </View>
      ) : (
        <View className="flex-row items-start gap-5">
          <ScrollView style={{ width: 280, flexGrow: 0, flexShrink: 0, maxHeight: paneHeight }} contentContainerClassName="pr-1">{settings}</ScrollView>
          <ScrollView style={{ flex: 1, minWidth: 0, maxHeight: paneHeight }} contentContainerClassName="gap-3 pr-1" keyboardShouldPersistTaps="handled">
            <View className="flex-row items-center justify-between">
              <Text className="text-[13px] font-semibold text-ink-900">Date sheet</Text>
              {groups.length ? <Text className="text-[12px] text-ink-500">{Platform.OS === "web" ? "Drag a subject onto another to swap · click to change" : "Tap a subject to swap or change it"}</Text> : null}
            </View>
            {empty || desktopSheet}
            {editor}
            {teacherBanner}
            {restingList}
            {error ? <Text className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</Text> : null}
          </ScrollView>
        </View>
      )}
    </Modal>
  );
}
