import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal as RnModal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Chip, ChipScroller, Empty, Field, Input, Modal, PageHeader, Sheet, Toast, useToast } from "./ui";
import { TeacherForm } from "./teacher-form";
import { DayTimetable } from "./routine-day";
import { ClearSheet, FillAllSheet, IconButton, MenuButton, type ClearSnapshot } from "./routine-fill";
import { formatSubjectLabel, labeledTeacherSkills } from "../lib/subject-label";
import { act } from "../lib/mutate";
import { openRoutinePdf } from "../lib/print-html";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";

type Hold = { teacherId: string; subjectId?: string; code?: string; subjectName: string };
type ModalKind = "teacher" | "addTeacher" | null;
type WeekSlot = {
  weekday: number;
  periodId?: string;
  period?: string;
  subject?: string;
  teacher?: string;
  covers?: { date: string; status?: string; substituteId: string; substitute: string; absentTeacher: string }[];
};

type DragEvt = {
  preventDefault?: () => void;
  dataTransfer?: {
    setData: (k: string, v: string) => void;
    getData: (k: string) => string;
    effectAllowed: string;
    dropEffect: string;
  };
};

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

function webNode(ref: RefObject<View | null>): HTMLElement | null {
  if (Platform.OS !== "web") return null;
  const node = ref.current as unknown;
  if (node && typeof node === "object" && "addEventListener" in node) return node as HTMLElement;
  return null;
}

function parseHold(raw: string): Hold | null {
  try {
    const p = JSON.parse(raw) as Hold;
    if (p?.teacherId && (p.subjectId || p.subjectName)) return p;
  } catch {
    /* ignore */
  }
  return null;
}

/** "MAT · Mathematics" (or a bare code) → the class subject's plain name. */
function plainSubjectName(label: string | undefined, subjects: { id: string; code?: string; name: string; label?: string }[]) {
  if (!label || label === "—") return label || "";
  const hit = subjects.find((row) => (row.label || formatSubjectLabel(row.code, row.name)) === label || row.name === label || (row.code && row.code === label));
  if (hit) return hit.name;
  const parts = label.split(" · ");
  return parts.length > 1 ? parts.slice(1).join(" · ").trim() : label;
}

function jsToWeekday(jsDay: number) {
  return jsDay === 0 ? 7 : jsDay;
}

/** Routine: the weekly timetable, or how it runs on one date (with one-day changes). */
export function WeekBoard() {
  const { data } = useRecord();
  const [view, setView] = useState<"week" | "date">("week");
  if (data?.teamWeek) return <WeeklyBoard />;
  return (
    <View className="min-h-0 flex-1">
      <View className="mb-2 shrink-0 flex-row self-start rounded-lg border border-ink-200 bg-white p-0.5">
        {(
          [
            ["week", "Weekly timetable"],
            ["date", "By date"],
          ] as const
        ).map(([key, label]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === key }}
            onPress={() => setView(key)}
            className={`rounded-md px-3 py-1.5 ${view === key ? "bg-clay-500" : ""}`}
          >
            <Text className={`text-[13px] font-medium ${view === key ? "text-white" : "text-ink-700"}`}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {view === "date" ? <DayTimetable /> : <WeeklyBoard />}
    </View>
  );
}

function WeeklyBoard() {
  const { data, reload } = useRecord();
  const [fillAllOpen, setFillAllOpen] = useState(false);
  const [lastFill, setLastFill] = useState<
    { kind: "fill"; ids: string[]; added: number } | { kind: "clear"; snapshot: ClearSnapshot; removed: number; label: string } | null
  >(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const { token, user } = useSession();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const split = width >= 1100;
  const phone = width < 700;
  const toast = useToast();
  const table = data?.timetable;
  const rawClasses = table?.classes ?? [];
  const rawTeachers = table?.teachers ?? [];
  // Subjects now carry codes: slots arrive as "MAT · Mathematics" and skills may be saved as a code.
  // The board works on plain subject names; dropOn sends the subject id so the server stores the right one.
  const classes = useMemo(
    () =>
      rawClasses.map((c) => ({
        ...c,
        slots: c.slots.map((slot) => ({ ...slot, subject: plainSubjectName(slot.subject, c.subjects ?? []) })),
      })),
    [rawClasses]
  );
  const teachers = useMemo(
    () =>
      rawTeachers.map((t) => ({
        ...t,
        skills: labeledTeacherSkills(t.skills, rawClasses),
      })),
    [rawClasses, rawTeachers]
  );
  const periods = table?.periods ?? [];
  const weekdays = table?.weekdays ?? [];
  const [classId, setClassId] = useState(classes[0]?.id || "");
  const klass = classes.find((c) => c.id === classId) || classes[0];
  useEffect(() => {
    if (!classId && classes[0]?.id) setClassId(classes[0].id);
  }, [classId, classes[0]?.id]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [over, setOver] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalKind>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [teacherFocusClass, setTeacherFocusClass] = useState("");
  const [addTeacherOpen, setAddTeacherOpen] = useState(false);
  /** Copy day: the weekday to copy from (0 = closed). */
  const [copyFrom, setCopyFrom] = useState(0);
  const [assign, setAssign] = useState<{
    periodId: string;
    weekday: number;
    periodName: string;
    current?: { subject: string; teacher: string };
  } | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [fillOpen, setFillOpen] = useState(false);
  const [filling, setFilling] = useState("");
  const todayN = jsToWeekday(new Date().getDay());
  const [day, setDay] = useState<number>(
    weekdays.some((d) => d.n === todayN) ? todayN : weekdays[0]?.n ?? 1
  );
  const activeDay = weekdays.some((d) => d.n === day) ? day : weekdays[0]?.n ?? 1;
  const teamWeek = Boolean(data?.teamWeek);
  const editable = can(user, "timetable.edit") || teamWeek;
  const periodsNotSet = periods.length === 0;
  const weekCapacity =
    table?.weekCapacity ?? weekdays.length * periods.filter((p) => !p.isBreak).length;
  const holdTeacher = hold ? teachers.find((t) => t.id === hold.teacherId)?.name : "";
  const teachable = periods.filter((p) => !p.isBreak).length;
  const dayFill = useMemo(() => {
    const slots = klass?.slots ?? [];
    return Object.fromEntries(
      weekdays.map((d) => [
        d.n,
        slots.filter((s) => s.weekday === d.n && s.subject && s.subject !== "—").length,
      ])
    ) as Record<number, number>;
  }, [klass?.slots, weekdays]);

  function pickSubject(teacherId: string, subjectName: string, toggle?: boolean) {
    if (!editable) return;
    setHold((cur) => {
      if (!toggle) return { teacherId, subjectName };
      return cur?.teacherId === teacherId && cur.subjectName === subjectName
        ? null
        : { teacherId, subjectName };
    });
  }

  useEffect(() => {
    if (!weekdays.length) return;
    if (!weekdays.some((d) => d.n === day)) {
      setDay(weekdays.some((d) => d.n === todayN) ? todayN : weekdays[0].n);
    }
  }, [weekdays, day, todayN]);

  const loadRows = useMemo(() => {
    if (!klass?.subjects?.length) return [] as { name: string; placed: number; need: number; state: "over" | "short" | "ok" | "none" }[];
    const rank = { over: 0, short: 1, ok: 2, none: 3 } as const;
    return klass.subjects
      .map((sub) => {
        const placed = klass.slots.filter((slot) => slot.subject === sub.name).length;
        const need = sub.weightage || 0;
        const state = (!need ? "none" : placed > need ? "over" : placed < need ? "short" : "ok") as "over" | "short" | "ok" | "none";
        return { name: sub.name, placed, need, state };
      })
      .sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));
  }, [klass?.subjects, klass?.slots]);

  const summary = useMemo(() => {
    let placed = 0;
    if (klass) {
      for (const d of weekdays) for (const p of periods) if (!p.isBreak && slotFilled(findSlot(klass.slots, p, d.n))) placed += 1;
    }
    return {
      placed: Math.min(placed, weekCapacity),
      empty: Math.max(0, weekCapacity - placed),
      over: loadRows.filter((r) => r.state === "over").length,
      short: loadRows.filter((r) => r.state === "short").length,
    };
  }, [klass?.slots, periods, weekdays, weekCapacity, loadRows]);

  /** Fill empty cells with the subjects furthest below target, using teachers who are free at that time. */
  const fillPlan = useMemo(() => {
    if (!klass?.id) return { moves: [] as { periodId: string; weekday: number; teacherId: string; teacherName: string; subjectName: string }[], left: 0 };
    const remaining = new Map(loadRows.filter((r) => r.state === "short").map((r) => [r.name, r.need - r.placed]));
    const busy = new Set<string>();
    for (const c of classes) {
      if (c.id === klass.id) continue;
      for (const o of c.slots as (WeekSlot & { teacherId?: string })[]) {
        const pid = o.periodId || periods.find((p) => p.name === o.period)?.id || "";
        if (o.teacherId) busy.add(`${o.teacherId}:${o.weekday}:${pid}`);
        if (o.teacher) busy.add(`n:${o.teacher}:${o.weekday}:${pid}`);
      }
    }
    const dayHas = new Set(klass.slots.filter((x) => slotSubject(x)).map((x) => `${x.weekday}:${slotSubject(x)}`));
    const moves: { periodId: string; weekday: number; teacherId: string; teacherName: string; subjectName: string }[] = [];
    let left = 0;
    for (const d of weekdays) {
      for (const p of periods) {
        if (p.isBreak) continue;
        if (slotFilled(findSlot(klass.slots, p, d.n))) continue;
        const options = [...remaining.entries()]
          .filter(([, n]) => n > 0)
          .sort((a, b) => Number(dayHas.has(`${d.n}:${a[0]}`)) - Number(dayHas.has(`${d.n}:${b[0]}`)) || b[1] - a[1]);
        let placed = false;
        for (const [subjectName] of options) {
          const t = teachers.find(
            (t) =>
              t.skills.some((sk) => sk.subjectName === subjectName && (!sk.classId || sk.classId === klass.id)) &&
              !busy.has(`${t.id}:${d.n}:${p.id}`) &&
              !busy.has(`n:${t.name}:${d.n}:${p.id}`)
          );
          if (!t) continue;
          moves.push({ periodId: p.id, weekday: d.n, teacherId: t.id, teacherName: t.name, subjectName });
          remaining.set(subjectName, (remaining.get(subjectName) || 0) - 1);
          busy.add(`${t.id}:${d.n}:${p.id}`);
          dayHas.add(`${d.n}:${subjectName}`);
          placed = true;
          break;
        }
        if (!placed) left += 1;
      }
    }
    return { moves, left };
  }, [klass?.id, klass?.slots, classes, loadRows, periods, weekdays, teachers]);

  async function runFill() {
    if (!klass?.id || !fillPlan.moves.length) return;
    setError("");
    let done = 0;
    try {
      for (const m of fillPlan.moves) {
        setFilling(`Placing ${done + 1} of ${fillPlan.moves.length}…`);
        await act(token, "saveTimetableSlot", {
          classId: klass.id,
          periodId: m.periodId,
          weekday: m.weekday,
          teacherId: m.teacherId,
          subjectName: m.subjectName,
        });
        done += 1;
      }
      toast.show(`${done} ${done === 1 ? "period" : "periods"} placed.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auto-fill stopped.");
    } finally {
      setFilling("");
      setFillOpen(false);
      await reload();
    }
  }

  async function dropOn(periodId: string, weekday: number, payload: Hold) {
    if (!klass?.id) return;
    setError("");
    try {
      await act(token, "saveTimetableSlot", {
        classId: klass.id,
        periodId,
        weekday,
        teacherId: payload.teacherId,
        subjectId: payload.subjectId || klass.subjects?.find((row) => row.name === payload.subjectName)?.id,
        subjectName: payload.subjectName,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  const [exportOpen, setExportOpen] = useState(false);
  const [exportIds, setExportIds] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const exportable = classes.filter((c) => c.id);

  async function exportRoutine() {
    if (!klass?.id) {
      toast.show("Pick a class first.");
      return;
    }
    // Office picks one class, several, or all. Others export the class on screen.
    if (user?.portal === "OFFICE" && exportable.length > 1) {
      setExportIds([klass.id]);
      setExportOpen(true);
      return;
    }
    try {
      await openRoutinePdf(token, { classId: klass.id });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not export the routine.");
    }
  }

  async function runExport() {
    if (!exportIds.length) return;
    setExporting(true);
    try {
      const all = exportIds.length === exportable.length;
      await openRoutinePdf(token, { classId: all ? "all" : exportIds.join(",") });
      setExportOpen(false);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not export the routine.");
    } finally {
      setExporting(false);
    }
  }

  function placeOrPick(
    periodId: string,
    weekday: number,
    slots: WeekSlot[]
  ) {
    if (!editable) return;
    if (hold) {
      dropOn(periodId, weekday, hold);
      return;
    }
    const period = periods.find((p) => p.id === periodId);
    const slot = findSlot(slots, period ?? { id: periodId, name: "" }, weekday);
    // Filled cell → open the same popup with "Now: …", Change and Clear period.
    setAssign({
      periodId,
      weekday,
      periodName: period?.name || "Period",
      current: slotFilled(slot) ? { subject: slotSubject(slot), teacher: slot?.teacher || "" } : undefined,
    });
  }

  async function clearCell(periodId: string, weekday: number) {
    if (!klass?.id) return;
    setError("");
    try {
      await act(token, "saveTimetableSlot", {
        classId: klass.id,
        periodId,
        weekday,
        clear: true,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear.");
    }
  }

  if (!table) return <Empty title="No timetable" body="Admin fills the grid." />;

  const railTeachers = useMemo(
    () =>
      [...teachers].sort(
        (a, b) =>
          Number(Boolean(b.team)) - Number(Boolean(a.team)) ||
          Number(Boolean(b.idle)) - Number(Boolean(a.idle)) ||
          a.name.localeCompare(b.name)
      ),
    [teachers]
  );

  const teacherRail = (
    <TeacherRail
      teachers={railTeachers}
      hold={hold}
      editable={editable}
      compact={phone}
      classId={klass?.id}
      classLabel={klass?.label}
      onAddTeacher={phone && klass?.id && can(user, "staff.edit") ? () => setAddTeacherOpen(true) : undefined}
      onEdit={
        can(user, "staff.edit")
          ? (id, addToClass) => {
              setTeacherId(id);
              setTeacherFocusClass(addToClass ? klass?.id || "" : "");
              setModal("teacher");
            }
          : undefined
      }
      onPick={pickSubject}
      scroll={split}
    />
  );

  return (
    <View className="min-h-0 flex-1">
      {phone ? null : (
        <PageHeader
          compact
          kicker={teamWeek ? "Team" : "Admin · One screen"}
          title={teamWeek ? "Team routine" : "Routine"}
          lede={
            teamWeek
              ? "Empty periods in your team’s classes. Free teachers are marked — drop one on the hole."
              : "Drag a subject onto a cell, or click a cell to choose. Changes here repeat every week; for one day, use By date."
          }
          action={
            <View className="flex-row flex-wrap items-center gap-2">
              <IconButton icon="download-outline" label="Export PDF" onPress={() => void exportRoutine()} />
              {editable && klass && !periodsNotSet && summary.placed > 0 ? (
                <IconButton icon="copy-outline" label="Copy day" onPress={() => setCopyFrom(weekdays[0]?.n || 1)} />
              ) : null}
              {editable && !periodsNotSet ? <IconButton icon="trash-outline" label="Clear" danger onPress={() => setClearOpen(true)} /> : null}
              {editable && !periodsNotSet ? (
                <MenuButton
                  primary
                  label="Auto-fill"
                  icon="sparkles-outline"
                  items={[
                    ...(klass && summary.empty > 0
                      ? [{ key: "one", label: `Only ${klass.label}`, hint: `Fill ${summary.empty} empty periods in this class`, icon: "square-outline" as const, onPress: () => setFillOpen(true) }]
                      : []),
                    ...(!teamWeek
                      ? [{ key: "all", label: "All classes", hint: "Check teachers, preview, then fill every class", icon: "grid-outline" as const, onPress: () => setFillAllOpen(true) }]
                      : []),
                  ]}
                />
              ) : null}
            </View>
          }
        />
      )}
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {lastFill ? (
        <View className="mb-2 flex-row items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
          <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
          <Text className="flex-1 text-[13px] text-emerald-900">
            {lastFill.kind === "fill" ? `Fill all classes added ${lastFill.added} periods.` : `Cleared ${lastFill.removed} periods from ${lastFill.label}.`}
          </Text>
          <Pressable
            disabled={undoing}
            onPress={async () => {
              setUndoing(true);
              try {
                if (lastFill.kind === "fill") {
                  const res = await act<{ ok: true; removed: number }>(token, "undoTimetableFill", { ids: lastFill.ids });
                  toast.show(`Undone · ${res.removed} periods removed.`);
                } else {
                  const res = await act<{ ok: true; restored: number; skipped: number }>(token, "restoreTimetable", { snapshot: lastFill.snapshot });
                  toast.show(res.skipped ? `Restored ${res.restored} periods · ${res.skipped} cells were already taken` : `Restored ${res.restored} periods.`);
                }
                setLastFill(null);
                await reload();
              } catch (e) {
                toast.show(e instanceof Error ? e.message : "Could not undo.");
              } finally {
                setUndoing(false);
              }
            }}
          >
            <Text className="text-[13px] font-semibold text-emerald-800 underline">{undoing ? "Undoing…" : "Undo"}</Text>
          </Pressable>
          <Pressable accessibilityLabel="Dismiss" onPress={() => setLastFill(null)}>
            <Ionicons name="close" size={16} color="#047857" />
          </Pressable>
        </View>
      ) : null}
      <ClearSheet
        open={clearOpen}
        klass={klass?.id ? { id: klass.id, label: klass.label } : null}
        canAll={editable && !teamWeek}
        onClose={() => setClearOpen(false)}
        onCleared={async (snapshot, removed, label) => {
          setClearOpen(false);
          setLastFill({ kind: "clear", snapshot, removed, label });
          toast.show(`Cleared ${removed} periods.`);
          await reload();
        }}
      />
      <FillAllSheet
        open={fillAllOpen}
        onClose={() => setFillAllOpen(false)}
        onApplied={async (ids, added) => {
          setFillAllOpen(false);
          setLastFill({ kind: "fill", ids, added });
          toast.show(`${added} periods added to the timetable.`);
          await reload();
        }}
      />
      <View className={split ? "mt-3 min-h-0 flex-1 flex-row gap-6" : phone ? "min-h-0 flex-1" : "mt-3 min-h-0 flex-1"}>
        {split && !periodsNotSet ? <View className="min-h-0 w-1/4 max-w-xs shrink-0">{teacherRail}</View> : null}

        <View className="min-h-0 min-w-0 flex-1">
          <View className="shrink-0 gap-2">
            {phone ? <Text className="text-[22px] font-bold tracking-tight text-ink-900">{teamWeek ? "Team routine" : "Timetable"}</Text> : null}
            <View className={phone ? "" : "flex-row items-center gap-4"}>
              <View className={phone ? "" : "min-w-0 flex-1"}>
                <ChipScroller>
                  {classes.map((c) => (
                    <Chip
                      key={c.id || c.label}
                      label={c.label}
                      active={klass?.id === c.id}
                      onPress={() => setClassId(c.id || "")}
                    />
                  ))}
                </ChipScroller>
              </View>
              {!phone && klass && !periodsNotSet ? (
                <View className="shrink-0 flex-row items-center gap-2">
                  <Ionicons
                    name={summary.empty || summary.over || summary.short ? "pie-chart-outline" : "checkmark-circle"}
                    size={15}
                    color={summary.empty || summary.over || summary.short ? "#64748b" : "#16a34a"}
                  />
                  <Text className="text-[13px] text-ink-700">
                    <Text className="font-semibold text-ink-900">{summary.placed}</Text> of {weekCapacity} placed
                    {summary.empty ? ` · ${summary.empty} empty` : ""}
                    {summary.over ? <Text className="text-red-700">{` · ${summary.over} over`}</Text> : null}
                    {summary.short ? <Text className="text-amber-700">{` · ${summary.short} short`}</Text> : null}
                    {!summary.empty && !summary.over && !summary.short ? " · all on target" : ""}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {phone && klass?.subjects?.length && !periodsNotSet ? (
            (() => {
              const load = klass.subjects!.map((sub) => {
                const placed = klass.slots.filter((slot) => slot.subject === sub.name).length;
                const need = sub.weightage || 0;
                return { name: sub.name, placed, need, state: !need ? "none" : placed > need ? "over" : placed < need ? "short" : "ok" };
              });
              const overN = load.filter((r) => r.state === "over").length;
              const shortN = load.filter((r) => r.state === "short").length;
              return (
                <View className="mt-3 shrink-0 overflow-hidden rounded-xl border border-ink-100 bg-white">
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setLoadOpen((v) => !v)}
                    className="flex-row items-center gap-2 px-3 py-2.5"
                  >
                    <Ionicons
                      name={overN || shortN ? "warning-outline" : "checkmark-circle-outline"}
                      size={16}
                      color={overN ? "#b91c1c" : shortN ? "#b45309" : "#15803d"}
                    />
                    <Text className="flex-1 text-sm text-ink-800">
                      {overN || shortN
                        ? [overN ? `${overN} ${overN === 1 ? "subject" : "subjects"} over` : "", shortN ? `${shortN} short` : ""].filter(Boolean).join(" · ")
                        : "All subjects on target"}
                    </Text>
                    {editable && !periodsNotSet && (summary.empty > 0 || !teamWeek) ? (
                      <MenuButton
                        primary
                        small
                        label="Auto-fill"
                        icon="sparkles"
                        items={[
                          ...(klass && summary.empty > 0
                            ? [{ key: "one", label: `Only ${klass.label}`, hint: `Fill ${summary.empty} empty periods`, icon: "square-outline" as const, onPress: () => setFillOpen(true) }]
                            : []),
                          ...(!teamWeek
                            ? [{ key: "all", label: "All classes", hint: "Check teachers, preview, then fill every class", icon: "grid-outline" as const, onPress: () => setFillAllOpen(true) }]
                            : []),
                        ]}
                      />
                    ) : (
                      <Text className="text-xs text-ink-500">Subject load</Text>
                    )}
                    <Ionicons name={loadOpen ? "chevron-up" : "chevron-down"} size={14} color="#64748b" />
                  </Pressable>
                  {loadOpen ? (
                    <View className="gap-2.5 border-t border-ink-100 px-3 py-3">
                      {load.map((r) => {
                        const tone = r.state === "over" ? "bg-red-500" : r.state === "short" ? "bg-amber-400" : "bg-emerald-500";
                        const pct = r.need ? Math.min(100, Math.round((r.placed / r.need) * 100)) : r.placed ? 100 : 0;
                        return (
                          <View key={r.name}>
                            <View className="flex-row items-center justify-between gap-2">
                              <Text className="text-sm text-ink-900">{r.name}</Text>
                              <Text
                                className={`text-xs ${
                                  r.state === "over" ? "font-semibold text-red-700" : r.state === "short" ? "font-semibold text-amber-800" : "text-ink-500"
                                }`}
                              >
                                {r.need ? `${r.placed} of ${r.need}` : `${r.placed} placed`}
                                {r.state === "over" ? ` · +${r.placed - r.need} over` : r.state === "short" ? ` · ${r.need - r.placed} short` : ""}
                              </Text>
                            </View>
                            <View className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                              <View className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
                            </View>
                          </View>
                        );
                      })}
                      <Text className="text-[11px] text-ink-500">Targets are periods per week, set under School settings → Subjects.</Text>
                    </View>
                  ) : null}
                </View>
              );
            })()
          ) : null}

          {!phone && loadRows.length && !periodsNotSet ? (
            <View className="mt-2.5 shrink-0 flex-row flex-wrap items-center gap-1.5">
              {loadRows.map((r) => {
                const on = focus === r.name;
                return (
                  <Pressable
                    key={r.name}
                    accessibilityRole="button"
                    accessibilityLabel={`Show only ${r.name}`}
                    onPress={() => setFocus(on ? "" : r.name)}
                    className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 ${on ? "border-ink-900 bg-ink-50" : "border-ink-200 bg-white"}`}
                  >
                    <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: subjectTone(r.name) }} />
                    <Text className="text-xs text-ink-700">{r.name}</Text>
                    <Text
                      className={`text-xs font-semibold ${
                        r.state === "over" ? "text-red-700" : r.state === "short" ? "text-amber-700" : "text-ink-500"
                      }`}
                    >
                      {r.placed}/{r.need || "—"}
                      {r.state === "over" ? ` +${r.placed - r.need}` : ""}
                    </Text>
                    {r.state === "ok" ? <Ionicons name="checkmark" size={12} color="#16a34a" /> : null}
                  </Pressable>
                );
              })}
              {focus ? (
                <Pressable onPress={() => setFocus("")} className="px-1 py-1">
                  <Text className="text-xs font-medium text-clay-600">Show all</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {error ? <Text className="mt-2 shrink-0 text-sm text-red-700">{error}</Text> : null}
          {hold ? (
            <View className="mt-2 shrink-0 flex-row items-center gap-2 rounded-md border border-clay-500 bg-blue-50 px-3 py-2.5">
              <Text className="flex-1 text-sm text-clay-600">
                {hold.subjectName}
                {holdTeacher ? ` · ${holdTeacher}` : ""} — tap a period
                {phone ? "" : " or drop it"}
              </Text>
              <Pressable onPress={() => setHold(null)} className="min-h-[40px] justify-center px-2">
                <Text className="text-sm font-medium text-ink-800">Cancel</Text>
              </Pressable>
            </View>
          ) : (phone || !periodsNotSet) && klass ? null : (
            <Text className="mt-2 shrink-0 text-sm text-ink-700">
              {periodsNotSet
                ? "No periods found. Set bell periods before placing teachers."
                : klass
                ? phone
                  ? `${klass.label} · ${weekCapacity} periods this week.`
                  : `${klass.label} · ${weekCapacity} periods this week. Drag a subject onto a cell.`
                : "Add a class to start the week."}
            </Text>
          )}

          <View className="mt-3 min-h-0 flex-1">
            {periodsNotSet ? (
              <MissingPeriodsGrid onPress={() => router.push("/school?tab=clock" as never)} />
            ) : klass ? (
              phone ? (
                <ScrollView className="min-h-0 flex-1" nestedScrollEnabled contentContainerStyle={{ paddingBottom: 110 }}>
                  <PhoneDaySchedule
                    weekdays={weekdays}
                    periods={periods}
                    slots={klass.slots}
                    others={classes.filter((c) => c.id !== klass.id)}
                    activeDay={activeDay}
                    fill={dayFill}
                    teachable={teachable}
                    hold={Boolean(hold)}
                    editable={editable}
                    onDay={setDay}
                    onCopy={editable ? () => setCopyFrom(activeDay) : undefined}
                    onClear={clearCell}
                    onPress={(periodId, weekday, slot) => {
                      if (!editable) return;
                      if (hold) {
                        void dropOn(periodId, weekday, hold);
                        return;
                      }
                      const period = periods.find((x) => x.id === periodId);
                      setAssign({
                        periodId,
                        weekday,
                        periodName: period?.name || "Period",
                        current: slotFilled(slot) ? { subject: slotSubject(slot), teacher: slot?.teacher || "" } : undefined,
                      });
                    }}
                  />
                  {!split ? <View className="mt-4">{teacherRail}</View> : null}
                </ScrollView>
              ) : (
                <WeekGrid
                  weekdays={weekdays}
                  periods={periods}
                  slots={klass.slots}
                  hold={Boolean(hold)}
                  over={over}
                  editable={editable}
                  onOver={setOver}
                  onLeave={() => setOver("")}
                  onDrop={dropOn}
                  onPlace={(periodId, weekday) => placeOrPick(periodId, weekday, klass.slots)}
                  onClear={clearCell}
                  onCopyDay={editable ? (n) => setCopyFrom(n) : undefined}
                  others={classes.filter((c) => c.id !== klass.id)}
                  focus={focus}
                  footer={!split ? teacherRail : null}
                />
              )
            ) : (
              <Empty title="Pick a class" body="Assign periods on the grid." />
            )}
          </View>
        </View>
      </View>

      {phone ? (
        <RnModal visible={Boolean(assign)} transparent animationType="slide" onRequestClose={() => setAssign(null)}>
          <View className="flex-1 justify-end">
            <Pressable accessibilityRole="button" accessibilityLabel="Close" className="absolute inset-0 bg-black/40" onPress={() => setAssign(null)} />
            <View className="rounded-t-3xl bg-white" style={{ maxHeight: "85%" }}>
              <SafeAreaView edges={["bottom"]}>
                <View className="items-center pt-2">
                  <View className="h-1 w-10 rounded-full bg-ink-200" />
                </View>
                <View className="flex-row items-start gap-3 px-5 pb-2 pt-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-lg font-semibold text-ink-900">
                      {assign ? `${weekdays.find((d) => d.n === assign.weekday)?.label || ""} · ${assign.periodName}` : ""}
                    </Text>
                    <Text className="text-xs text-ink-500">
                      {assign?.current ? `Now: ${assign.current.subject}${assign.current.teacher ? ` · ${assign.current.teacher}` : ""}` : "Empty period"}
                    </Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={() => setAssign(null)} className="h-8 w-8 items-center justify-center rounded-full bg-ink-100">
                    <Ionicons name="close" size={18} color="#3d4f66" />
                  </Pressable>
                </View>
                <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}>
                  <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                    {assign?.current ? "Change to" : "Who takes this period"}
                  </Text>
                  <PhoneAssignList
                    teachers={teachers}
                    classId={klass?.id}
                    current={assign?.current}
                    onPick={async (payload) => {
                      if (!assign) return;
                      await dropOn(assign.periodId, assign.weekday, payload);
                      setAssign(null);
                    }}
                  />
                </ScrollView>
                {assign?.current ? (
                  <View className="border-t border-ink-100 px-5 pb-2 pt-3">
                    <Pressable
                      accessibilityRole="button"
                      onPress={async () => {
                        if (!assign) return;
                        await clearCell(assign.periodId, assign.weekday);
                        setAssign(null);
                      }}
                      className="h-12 flex-row items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50"
                    >
                      <Ionicons name="trash-outline" size={17} color="#b91c1c" />
                      <Text className="text-[15px] font-semibold text-red-700">Clear period</Text>
                    </Pressable>
                  </View>
                ) : null}
              </SafeAreaView>
            </View>
          </View>
        </RnModal>
      ) : null}

      <Modal
        open={exportOpen}
        title="Export routine"
        onClose={() => (exporting ? undefined : setExportOpen(false))}
        footer={
          <View className="flex-row items-center justify-end gap-2">
            <Button variant="ghost" disabled={exporting} onPress={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!exportIds.length || exporting} onPress={() => void runExport()}>
              {exporting
                ? "Preparing…"
                : exportIds.length === exportable.length
                  ? "Export all classes"
                  : exportIds.length === 1
                    ? `Export ${exportable.find((c) => c.id === exportIds[0])?.label || "class"}`
                    : `Export ${exportIds.length} classes`}
            </Button>
          </View>
        }
      >
        <View className="gap-4">
          <View className="flex-row flex-wrap gap-2">
            <Pressable
              accessibilityRole="button"
              onPress={() => setExportIds(klass?.id ? [klass.id] : [])}
              className={`h-10 flex-row items-center gap-2 rounded-lg border px-3.5 ${exportIds.length === 1 && exportIds[0] === klass?.id ? "border-clay-500 bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
            >
              <Ionicons name="document-outline" size={15} color="#1F45C7" />
              <Text className="text-[14px] font-medium text-ink-900">{`This class (${klass?.label || ""})`}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setExportIds(exportable.map((c) => c.id || ""))}
              className={`h-10 flex-row items-center gap-2 rounded-lg border px-3.5 ${exportIds.length === exportable.length ? "border-clay-500 bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
            >
              <Ionicons name="documents-outline" size={15} color="#1F45C7" />
              <Text className="text-[14px] font-medium text-ink-900">{`All classes (${exportable.length})`}</Text>
            </Pressable>
          </View>
          <View className="gap-2">
            <Text className="text-xs font-medium text-ink-700">Or pick classes</Text>
            <View className="flex-row flex-wrap gap-2">
              {exportable.map((c) => {
                const on = exportIds.includes(c.id || "");
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    onPress={() => setExportIds((cur) => (on ? cur.filter((id) => id !== c.id) : [...cur, c.id || ""]))}
                    className={`h-9 flex-row items-center gap-1.5 rounded-full border px-3 ${on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}
                  >
                    {on ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                    <Text className={`text-[13px] font-medium ${on ? "text-white" : "text-ink-800"}`}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text className="text-[12px] text-ink-500">Each class prints on its own A4 page.</Text>
        </View>
      </Modal>

      <Modal
        open={fillOpen}
        sheetOnPhone
        title={`Auto-fill ${klass?.label || ""}`}
        onClose={() => (filling ? undefined : setFillOpen(false))}
        footer={
          <View className="flex-row items-center justify-end gap-2">
            <Button variant="ghost" disabled={Boolean(filling)} onPress={() => setFillOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!fillPlan.moves.length || Boolean(filling)} onPress={() => void runFill()}>
              {filling || (fillPlan.moves.length ? `Place ${fillPlan.moves.length} ${fillPlan.moves.length === 1 ? "period" : "periods"}` : "Nothing to place")}
            </Button>
          </View>
        }
      >
        <View className="gap-3">
          <Text className="text-sm leading-5 text-ink-700">
            Fills empty periods with the subjects that are furthest below target, using teachers who are free at that time. Filled periods are not touched.
          </Text>
          {fillPlan.moves.length ? (
            <View className="overflow-hidden rounded-xl border border-ink-200">
              {Object.entries(
                fillPlan.moves.reduce<Record<string, { n: number; who: Set<string> }>>((acc, m) => {
                  const row = acc[m.subjectName] || { n: 0, who: new Set<string>() };
                  row.n += 1;
                  row.who.add(m.teacherName);
                  acc[m.subjectName] = row;
                  return acc;
                }, {})
              ).map(([name, row], i) => (
                <View key={name} className={`flex-row items-center gap-3 px-4 py-2.5 ${i ? "border-t border-ink-100" : ""}`}>
                  <View className="h-2 w-2 rounded-full" style={{ backgroundColor: subjectTone(name) }} />
                  <View className="min-w-0 flex-1">
                    <Text className="text-[14px] font-semibold text-ink-900">{name}</Text>
                    <Text className="text-[12px] text-ink-500" numberOfLines={1}>
                      {[...row.who].join(", ")}
                    </Text>
                  </View>
                  <Text className="text-[13px] font-semibold text-ink-800">+{row.n}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text className="text-sm text-ink-500">No free teacher matches the subjects that are short. Add teachers or adjust targets.</Text>
          )}
          {fillPlan.left ? (
            <Text className="text-[12px] text-amber-700">
              {fillPlan.left} {fillPlan.left === 1 ? "period stays" : "periods stay"} empty — no subject is short or no teacher is free then.
            </Text>
          ) : null}
        </View>
      </Modal>

      <Modal
        open={!phone && Boolean(assign)}
        wide
        title={
          assign
            ? `${weekdays.find((d) => d.n === assign.weekday)?.label || ""} · ${assign.periodName}${
                periods.find((x) => x.id === assign.periodId)
                  ? ` (${periods.find((x) => x.id === assign.periodId)!.start}–${periods.find((x) => x.id === assign.periodId)!.end})`
                  : ""
              }`
            : "Place"
        }
        onClose={() => setAssign(null)}
        footer={
          assign ? (
            <View className="flex-row items-center justify-between gap-3">
              <Text className="min-w-0 flex-1 text-sm text-ink-500" numberOfLines={1}>
                {assign.current
                  ? `Now: ${assign.current.subject}${assign.current.teacher ? ` · ${assign.current.teacher}` : ""}`
                  : `${klass?.label || ""} · empty period`}
              </Text>
              {assign.current ? (
                <Button
                  variant="ghost"
                  onPress={async () => {
                    await clearCell(assign.periodId, assign.weekday);
                    setAssign(null);
                  }}
                >
                  Clear period
                </Button>
              ) : null}
              <Button variant="ghost" onPress={() => setAssign(null)}>
                Cancel
              </Button>
            </View>
          ) : null
        }
      >
        {assign && klass ? (
          <DeskAssignPanel
            teachers={teachers}
            classId={klass.id}
            subjects={klass.subjects || []}
            slots={klass.slots}
            others={classes.filter((c) => c.id !== klass.id)}
            periodId={assign.periodId}
            periodName={assign.periodName}
            weekday={assign.weekday}
            current={assign.current}
            onPick={async (payload) => {
              await dropOn(assign.periodId, assign.weekday, payload);
              setAssign(null);
            }}
          />
        ) : null}
      </Modal>

      <Modal open={modal === "addTeacher"} title="Add teacher" large onClose={() => setModal(null)}>
        <TeacherForm
          key="new-teacher"
          catalog={data?.school?.subjectCatalog ?? []}
          others={rawTeachers.map((t) => ({ id: t.id, name: t.name, skills: t.skills ?? [] }))}
          classes={rawClasses.map((c) => ({ id: c.id || "", label: c.label, name: c.name, subjects: c.subjects ?? [] }))}
          onCancel={() => setModal(null)}
          onSave={async (payload) => {
            await act(token, "createTeacher", payload);
            setModal(null);
            toast.show("Teacher added.");
            await reload();
          }}
        />
      </Modal>

      {klass?.id && copyFrom ? (
        <CopyDaySheet
          classId={klass.id}
          classLabel={klass.label}
          weekdays={weekdays}
          fromDay={copyFrom}
          filledOn={(n) => klass.slots.filter((x) => x.weekday === n && slotFilled(x)).length}
          onClose={() => setCopyFrom(0)}
          onDone={async (message) => {
            setCopyFrom(0);
            toast.show(message);
            await reload();
          }}
        />
      ) : null}
      {klass?.id ? (
        <AddTeacherSheet
          open={addTeacherOpen}
          classId={klass.id}
          classLabel={klass.label}
          subjects={(rawClasses.find((c) => c.id === klass.id)?.subjects ?? []).map((x) => x.name)}
          teachers={rawTeachers.map((t) => ({ id: t.id, name: t.name, skills: t.skills ?? [] }))}
          onClose={() => setAddTeacherOpen(false)}
          onSave={async (teacherId, subjects) => {
            const res = await act<{ ok: true; name: string; classLabel: string; subjects: string[] }>(token, "setTeacherClassSubjects", {
              teacherId,
              classId: klass.id,
              subjects,
            });
            setAddTeacherOpen(false);
            toast.show(`${res.name} now teaches ${res.subjects.join(", ")} in ${res.classLabel}.`);
            await reload();
          }}
        />
      ) : null}
      <Modal
        open={modal === "teacher" && Boolean(teacherId)}
        title={teacherFocusClass && klass?.label ? `Add to ${klass.label}` : "Edit teacher"}
        large
        sheetOnPhone
        onClose={() => setModal(null)}
      >
        {teacherId ? (
          <TeacherForm
            key={`${teacherId}:${teacherFocusClass}`}
            focusClassId={teacherFocusClass || undefined}
            teacher={rawTeachers.find((t) => t.id === teacherId)}
            catalog={data?.school?.subjectCatalog ?? []}
            others={rawTeachers.map((t) => ({ id: t.id, name: t.name, skills: t.skills ?? [] }))}
            classes={rawClasses.map((c) => ({ id: c.id || "", label: c.label, name: c.name, subjects: c.subjects ?? [] }))}
            onCancel={() => setModal(null)}
            onSave={async (payload) => {
              await act(token, "setTeacherResources", { ...payload, teacherId });
              setModal(null);
              toast.show("Teacher saved.");
              await reload();
            }}
          />
        ) : null}
      </Modal>
    </View>
  );
}

/** One-day change shown on the weekly grid. */
function coverWho(cover: { status?: string; substitute: string }) {
  if (cover.status === "FREE") return "No lesson";
  if (cover.status === "OPEN" || !cover.substitute) return "Needs cover";
  return cover.substitute;
}

function slotFilled(slot?: { subject?: string; teacher?: string } | null) {
  if (!slot) return false;
  return Boolean(slot.subject && slot.subject !== "—" ? slot.subject : slot.teacher);
}

function slotSubject(slot?: { subject?: string } | null) {
  return slot?.subject && slot.subject !== "—" ? slot.subject : "";
}

function findSlot(
  slots: WeekSlot[],
  period: { id: string; name: string },
  weekday: number
) {
  return slots.find((s) => s.weekday === weekday && (s.periodId === period.id || s.period === period.name));
}

function TeacherRail({
  teachers,
  hold,
  editable,
  compact,
  classId,
  classLabel,
  onAddTeacher,
  onEdit,
  onPick,
  scroll,
}: {
  teachers: {
    id: string;
    name: string;
    qualification?: string;
    idle?: boolean;
    team?: boolean;
    skills: { subjectName: string; classId: string }[];
  }[];
  hold: Hold | null;
  editable: boolean;
  compact?: boolean;
  classId?: string;
  classLabel?: string;
  /** Phone: "+ Add teacher to 2-A" in the header (opens a bottom sheet). */
  onAddTeacher?: () => void;
  /** addToClass: open the editor with this class ready ("Add to 1-A"). */
  onEdit?: (id: string, addToClass?: boolean) => void;
  onPick: (teacherId: string, subjectName: string, toggle?: boolean) => void;
  scroll?: boolean;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? teachers.filter((t) => t.name.toLowerCase().includes(needle) || t.skills.some((s) => s.subjectName.toLowerCase().includes(needle)))
    : teachers;
  const cards = (
    <>
      {shown.map((t) => {
        const skills = [
          ...new Set(
            t.skills
              .filter((s) => !classId || !s.classId || s.classId === classId)
              .map((s) => s.subjectName)
          ),
        ];
        // Phone: teachers not set up for this class are listed below under "Other teachers".
        if (compact && classId && !skills.length) return null;
        return (
          <TeacherCard
            key={t.id}
            teacherId={t.id}
            name={t.name}
            qualification={compact ? undefined : t.qualification}
            idle={t.idle}
            team={t.team}
            skills={skills.length ? skills : [...new Set(t.skills.map((s) => s.subjectName))]}
            hold={hold}
            editable={editable}
            compact={compact}
            onEdit={onEdit ? () => onEdit(t.id) : undefined}
            onPick={(subjectName, toggle) => onPick(t.id, subjectName, toggle)}
          />
        );
      })}
      {!teachers.length ? (
        <Text className="text-sm text-ink-700">Add teachers under Employees first.</Text>
      ) : !shown.length ? (
        <Text className="text-sm text-ink-500">No teacher matches "{q.trim()}".</Text>
      ) : null}
    </>
  );

  return (
    <View className={scroll ? "min-h-0 flex-1" : "gap-3"}>
      <View className="shrink-0 flex-row items-center justify-between gap-2">
        <Text className="text-xs uppercase tracking-widest text-ink-700">
          {compact ? "Or pick a subject to fill several" : "Teachers — drag a subject"}
        </Text>
        {compact && onAddTeacher ? (
          <Pressable
            onPress={onAddTeacher}
            accessibilityRole="button"
            className="min-h-[30px] flex-row items-center gap-1 rounded-full border border-clay-500 bg-white px-2.5"
          >
            <Ionicons name="person-add-outline" size={12} color="#1F45C7" />
            <Text className="text-[11px] font-semibold text-clay-600">Add teacher{classLabel ? ` to ${classLabel}` : ""}</Text>
          </Pressable>
        ) : null}
      </View>
      {teachers.length > 4 ? (
        <View className="mt-2 shrink-0 flex-row items-center gap-2 rounded-lg border border-ink-200 bg-white px-3">
          <Ionicons name="search" size={14} color="#94a3b8" />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Find teacher or subject"
            placeholderTextColor="#94a3b8"
            className="min-h-[36px] flex-1 text-sm text-ink-900"
          />
          {q ? (
            <Pressable accessibilityLabel="Clear search" onPress={() => setQ("")}>
              <Ionicons name="close-circle" size={16} color="#94a3b8" />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {scroll ? (
        <ScrollView className="min-h-0 flex-1" nestedScrollEnabled contentContainerClassName="gap-3 pb-4 pt-3">
          {cards}
        </ScrollView>
      ) : (
        <View className="gap-3">{cards}</View>
      )}
    </View>
  );
}

function DeskAssignPanel({
  teachers,
  classId,
  subjects,
  slots,
  others,
  periodId,
  periodName,
  weekday,
  current,
  onPick,
}: {
  teachers: { id: string; name: string; skills: { subjectName: string; classId: string }[] }[];
  classId?: string;
  subjects: { name: string; weightage?: number }[];
  slots: WeekSlot[];
  others: { label: string; slots: (WeekSlot & { teacherId?: string })[] }[];
  periodId: string;
  periodName: string;
  weekday: number;
  current?: { subject: string; teacher: string };
  onPick: (payload: Hold) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const needle = q.trim().toLowerCase();

  const busyIn = (t: { id: string; name: string }) =>
    others
      .filter((c) =>
        c.slots.some(
          (o) =>
            o.weekday === weekday &&
            (o.periodId === periodId || o.period === periodName) &&
            ((o.teacherId && o.teacherId === t.id) || (!o.teacherId && o.teacher === t.name))
        )
      )
      .map((c) => c.label);

  const names = [
    ...new Set([
      ...subjects.map((x) => x.name),
      ...teachers.flatMap((t) => t.skills.filter((sk) => !classId || !sk.classId || sk.classId === classId).map((sk) => sk.subjectName)),
    ]),
  ];
  const groups = names
    .map((name) => {
      const need = subjects.find((x) => x.name === name)?.weightage || 0;
      const placed = slots.filter((x) => x.subject === name).length;
      const state = !need ? "none" : placed > need ? "over" : placed < need ? "short" : "ok";
      const who = teachers
        .filter((t) => t.skills.some((sk) => sk.subjectName === name && (!classId || !sk.classId || sk.classId === classId)))
        .map((t) => ({ id: t.id, name: t.name, busy: busyIn(t) }))
        .sort((a, b) => a.busy.length - b.busy.length || a.name.localeCompare(b.name));
      return { name, need, placed, state, who };
    })
    .filter((g) => g.who.length)
    .filter((g) => !needle || g.name.toLowerCase().includes(needle) || g.who.some((w) => w.name.toLowerCase().includes(needle)))
    .sort((a, b) => {
      const rank = (x: string) => (x === "short" ? 0 : x === "none" ? 1 : x === "ok" ? 2 : 3);
      return rank(a.state) - rank(b.state) || (b.need - b.placed) - (a.need - a.placed) || a.name.localeCompare(b.name);
    });

  const rows = groups.flatMap((g) => g.who.map((w) => ({ ...g, teacher: w })));
  const many = rows.length > 6;

  return (
    <View className="gap-3">
      {many ? (
        <View className="flex-row items-center gap-2 rounded-lg border border-ink-200 bg-white px-3">
          <Ionicons name="search" size={14} color="#94a3b8" />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Find subject or teacher"
            placeholderTextColor="#94a3b8"
            className="min-h-[38px] flex-1 text-sm text-ink-900"
          />
        </View>
      ) : null}
      <View className="overflow-hidden rounded-xl border border-ink-200">
        {rows.map((r, ri) => {
          const key = `${r.teacher.id}:${r.name}`;
          const isCurrent = current?.subject === r.name && current?.teacher === r.teacher.name;
          const busy = r.teacher.busy.length > 0;
          const suggested = ri === 0 && !needle && !busy && r.state === "short" && !isCurrent;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`${r.name} with ${r.teacher.name}${busy ? `, busy in ${r.teacher.busy.join(", ")}` : ""}`}
              disabled={Boolean(busyKey) || isCurrent}
              onPress={async () => {
                setBusyKey(key);
                try {
                  await onPick({ teacherId: r.teacher.id, subjectName: r.name });
                } finally {
                  setBusyKey("");
                }
              }}
              className={`flex-row items-center gap-3 px-4 py-3 ${ri ? "border-t border-ink-100" : ""} ${
                isCurrent ? "bg-clay-50" : suggested ? "bg-[#F7F9FF]" : "bg-white"
              } hover:bg-ink-50`}
            >
              <View className="h-2 w-2 rounded-full" style={{ backgroundColor: subjectTone(r.name) }} />
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-[14px] font-semibold text-ink-900" numberOfLines={1}>
                    {r.name}
                  </Text>
                  {suggested ? (
                    <View className="rounded-full bg-clay-50 px-2 py-0.5">
                      <Text className="text-[10px] font-semibold uppercase tracking-wide text-clay-700">Suggested</Text>
                    </View>
                  ) : null}
                </View>
                <Text className="text-[12px] text-ink-500" numberOfLines={1}>
                  {r.teacher.name}
                </Text>
              </View>
              <Text
                className={`w-24 text-right text-[12px] ${
                  r.state === "short" ? "font-semibold text-amber-700" : r.state === "over" ? "font-semibold text-red-700" : "text-ink-500"
                }`}
              >
                {r.state === "short"
                  ? `needs ${r.need - r.placed}`
                  : r.state === "over"
                    ? `${r.placed - r.need} extra`
                    : r.state === "ok"
                      ? "on target"
                      : `${r.placed} placed`}
              </Text>
              <Text className="w-14 text-right text-[11px] text-ink-400">
                {r.placed}/{r.need || "—"}
              </Text>
              <View className="w-32 items-end">
                {isCurrent ? (
                  <Text className="text-[12px] font-semibold text-clay-700">Current</Text>
                ) : busyKey === key ? (
                  <Text className="text-[12px] text-ink-500">Placing…</Text>
                ) : busy ? (
                  <View className="rounded-full bg-red-50 px-2 py-0.5">
                    <Text className="text-[11px] font-medium text-red-700" numberOfLines={1}>
                      Busy · {r.teacher.busy.join(", ")}
                    </Text>
                  </View>
                ) : (
                  <View className="flex-row items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5">
                    <View className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <Text className="text-[11px] font-medium text-emerald-700">Free</Text>
                  </View>
                )}
              </View>
              <Ionicons name="chevron-forward" size={14} color="#cbd5e1" />
            </Pressable>
          );
        })}
        {!rows.length ? (
          <View className="items-center px-4 py-8">
            <Text className="text-sm text-ink-500">
              {needle ? `Nothing matches "${q.trim()}".` : "No teacher is set to teach this class yet."}
            </Text>
          </View>
        ) : null}
      </View>
      <Text className="text-[11px] text-ink-400">Subjects that still need periods are listed first. Click a row to place it.</Text>
    </View>
  );
}

const SUBJECT_TONES = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#db2777", "#0891b2", "#dc2626", "#4f46e5", "#65a30d", "#ea580c"];

function subjectTone(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SUBJECT_TONES[h % SUBJECT_TONES.length];
}

function PhoneAssignList({
  teachers,
  classId,
  current,
  onPick,
}: {
  teachers: { id: string; name: string; skills: { subjectName: string; classId: string }[] }[];
  classId?: string;
  current?: { subject: string; teacher: string };
  onPick: (payload: Hold) => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const offers = teachers.flatMap((t) =>
    [...new Set(t.skills.filter((s) => !classId || !s.classId || s.classId === classId).map((s) => s.subjectName))].map(
      (subjectName) => ({ teacherId: t.id, teacherName: t.name, subjectName })
    )
  );
  if (!offers.length) return <Text className="py-3 text-sm text-ink-600">No teacher is set to teach this class yet.</Text>;
  return (
    <View className="overflow-hidden rounded-xl border border-ink-100">
      {offers.map((o, i) => {
        const key = `${o.teacherId}:${o.subjectName}`;
        const isNow = current?.subject === o.subjectName && current?.teacher === o.teacherName;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            disabled={Boolean(busy) || isNow}
            onPress={async () => {
              setBusy(key);
              try {
                await onPick({ teacherId: o.teacherId, subjectName: o.subjectName });
              } finally {
                setBusy("");
              }
            }}
            className={`flex-row items-center gap-3 px-3 py-3 ${i ? "border-t border-ink-100" : ""} ${isNow ? "bg-[#EEF3FF]" : "active:bg-slate-50"}`}
          >
            <View className="h-8 w-1 rounded-full" style={{ backgroundColor: subjectTone(o.subjectName) }} />
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] font-semibold text-ink-900">{o.subjectName}</Text>
              <Text className="text-xs text-ink-500">{o.teacherName}</Text>
            </View>
            {isNow ? (
              <Text className="text-xs font-semibold text-[#1F45C7]">Current</Text>
            ) : busy === key ? (
              <Text className="text-xs text-ink-500">Saving…</Text>
            ) : (
              <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function PhoneDaySchedule({
  weekdays,
  periods,
  slots,
  others,
  activeDay,
  fill,
  teachable,
  hold,
  editable,
  onDay,
  onPress,
  onClear,
  onCopy,
}: {
  /** Copy this day's routine to other days. */
  onCopy?: () => void;
  /** Clear a filled period straight from the list (two taps: × then Clear). */
  onClear?: (periodId: string, weekday: number) => Promise<void> | void;
  weekdays: { n: number; label: string }[];
  periods: { id: string; name: string; start: string; end: string; isBreak?: boolean }[];
  slots: WeekSlot[];
  others: { label: string; slots: (WeekSlot & { teacherId?: string })[] }[];
  activeDay: number;
  fill: Record<number, number>;
  teachable: number;
  hold: boolean;
  editable: boolean;
  onDay: (n: number) => void;
  onPress: (periodId: string, weekday: number, slot?: WeekSlot) => void;
}) {
  const [confirmId, setConfirmId] = useState("");
  const [clearing, setClearing] = useState("");
  return (
    <View className="gap-3">
      <View className="flex-row items-stretch gap-1.5">
      <View className="flex-1 flex-row rounded-xl bg-ink-100 p-1">
        {weekdays.map((d) => {
          const on = d.n === activeDay;
          const gaps = teachable > 0 && (fill[d.n] ?? 0) < teachable;
          return (
            <Pressable
              key={d.n}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => onDay(d.n)}
              className={`flex-1 items-center rounded-lg py-2 ${on ? "bg-white shadow-sm" : ""}`}
            >
              <Text className={`text-[13px] font-semibold ${on ? "text-[#1F45C7]" : "text-ink-600"}`}>{d.label.slice(0, 3)}</Text>
              <View className={`mt-1 h-1.5 w-1.5 rounded-full ${gaps ? "bg-red-500" : "bg-transparent"}`} />
            </Pressable>
          );
        })}
      </View>
      {onCopy && (fill[activeDay] ?? 0) > 0 ? (
        <Pressable
          onPress={onCopy}
          accessibilityRole="button"
          accessibilityLabel="Copy this day to other days"
          className="w-12 items-center justify-center rounded-xl border border-ink-200 bg-white"
        >
          <Ionicons name="copy-outline" size={16} color="#1F45C7" />
          <Text className="mt-0.5 text-[10px] font-semibold text-[#1F45C7]">Copy</Text>
        </Pressable>
      ) : null}
      </View>
      <View className="overflow-hidden rounded-xl border border-ink-100 bg-white">
        {periods.map((p, i) => {
          if (p.isBreak) {
            return (
              <View key={p.id} className={`flex-row items-center gap-2 bg-ink-50 px-3 py-1.5 ${i ? "border-t border-ink-100" : ""}`}>
                <Ionicons name="cafe-outline" size={13} color="#94a3b8" />
                <Text className="text-xs text-ink-500">
                  {p.name} · {p.start}–{p.end}
                </Text>
              </View>
            );
          }
          const slot = findSlot(slots, p, activeDay) as (WeekSlot & { teacherId?: string }) | undefined;
          const filled = slotFilled(slot);
          const subject = slotSubject(slot);
          const clashes = filled
            ? others
                .filter((c) =>
                  c.slots.some(
                    (o) =>
                      o.weekday === activeDay &&
                      (o.periodId === p.id || o.period === p.name) &&
                      ((slot?.teacherId && o.teacherId === slot.teacherId) || (!slot?.teacherId && slot?.teacher && o.teacher === slot.teacher))
                  )
                )
                .map((c) => c.label)
            : [];
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`${p.name} ${subject || "empty"}`}
              disabled={!editable}
              onPress={() => onPress(p.id, activeDay, slot)}
              className={`flex-row items-center gap-3 px-3 py-2.5 ${i ? "border-t border-ink-100" : ""} ${hold && !filled ? "bg-[#EEF3FF]/60" : ""}`}
              style={{ minHeight: 56 }}
            >
              <View className="w-11">
                <Text className="text-xs font-semibold text-ink-800">{p.start}</Text>
                <Text className="text-[11px] text-ink-400">{p.end}</Text>
              </View>
              {filled ? (
                <>
                  <View className="h-9 w-1 rounded-full" style={{ backgroundColor: subjectTone(subject || slot?.teacher || "") }} />
                  <View className="min-w-0 flex-1">
                    <Text className="text-[15px] font-semibold text-ink-900" numberOfLines={1}>
                      {subject || "—"}
                    </Text>
                    <Text className="text-xs text-ink-500" numberOfLines={1}>
                      {slot?.teacher || "No teacher"}
                    </Text>
                    {clashes.length ? (
                      <Text className="mt-0.5 text-[11px] font-semibold text-red-600" numberOfLines={1}>
                        ⚠ Also in {clashes.join(", ")}
                      </Text>
                    ) : null}
                    {slot?.covers?.length ? (
                      <Text className="mt-0.5 text-[11px] font-medium text-emerald-700" numberOfLines={1}>
                        {new Date(`${slot.covers[0].date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} only · {coverWho(slot.covers[0])}
                        {slot.covers.length > 1 ? ` +${slot.covers.length - 1}` : ""}
                      </Text>
                    ) : null}
                  </View>
                  {editable && onClear && !hold ? (
                    confirmId === p.id ? (
                      <View className="flex-row items-center gap-1.5">
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Keep period"
                          hitSlop={6}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            setConfirmId("");
                          }}
                          className="h-8 items-center justify-center rounded-full border border-ink-200 bg-white px-2.5"
                        >
                          <Text className="text-[12px] font-semibold text-ink-600">Keep</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Clear ${p.name}`}
                          hitSlop={6}
                          disabled={clearing === p.id}
                          onPress={async (e) => {
                            e.stopPropagation?.();
                            setClearing(p.id);
                            try {
                              await onClear(p.id, activeDay);
                            } finally {
                              setClearing("");
                              setConfirmId("");
                            }
                          }}
                          className="h-8 items-center justify-center rounded-full bg-red-600 px-3"
                        >
                          <Text className="text-[12px] font-semibold text-white">{clearing === p.id ? "Clearing…" : "Clear"}</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Clear ${subject || p.name}`}
                        hitSlop={8}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          setConfirmId(p.id);
                        }}
                        className="h-8 w-8 items-center justify-center rounded-full bg-ink-50"
                      >
                        <Ionicons name="close" size={16} color="#64748b" />
                      </Pressable>
                    )
                  ) : editable ? (
                    <Ionicons name="chevron-forward" size={15} color="#cbd5e1" />
                  ) : null}
                </>
              ) : (
                <View className="flex-1 flex-row items-center justify-center rounded-lg border border-dashed border-ink-300 py-2">
                  <Text className="text-sm font-medium text-[#1F45C7]">
                    {hold ? "Tap to place" : editable ? "+ Assign" : "Free"}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function DaySchedule({
  weekdays,
  periods,
  slots,
  activeDay,
  fill,
  teachable,
  hold,
  over,
  editable,
  onDay,
  onOver,
  onLeave,
  onDrop,
  onPlace,
  onClear,
}: {
  weekdays: { n: number; label: string }[];
  periods: { id: string; name: string; start: string; end: string; isBreak?: boolean }[];
  slots: WeekSlot[];
  activeDay: number;
  fill: Record<number, number>;
  teachable: number;
  hold: boolean;
  over: string;
  editable: boolean;
  onDay: (n: number) => void;
  onOver: (key: string) => void;
  onLeave: () => void;
  onDrop: (periodId: string, weekday: number, payload: Hold) => void;
  onPlace: (periodId: string, weekday: number) => void;
  onClear: (periodId: string, weekday: number) => void;
}) {
  return (
    <View className="gap-3">
      <View className="flex-row gap-1">
        {weekdays.map((d) => {
          const on = d.n === activeDay;
          const n = fill[d.n] ?? 0;
          return (
            <Pressable
              key={d.n}
              onPress={() => onDay(d.n)}
              className={`min-h-[52px] flex-1 items-center justify-center rounded-md border px-1 py-1.5 ${
                on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"
              }`}
            >
              <Text numberOfLines={1} className={`text-xs font-medium ${on ? "text-white" : "text-ink-800"}`}>
                {d.label}
              </Text>
              <Text className={`mt-0.5 text-[10px] ${on ? "text-white" : "text-ink-700"}`}>
                {n}/{teachable || "—"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {periods.map((p) => {
        const slot = findSlot(slots, p, activeDay);
        const key = `${p.id}:${activeDay}`;
        return (
          <View key={p.id} className="gap-1.5">
            <View className="flex-row items-baseline justify-between gap-2">
              <Text className="font-medium text-ink-900">{p.name}</Text>
              <Text className="text-xs text-ink-700">
                {p.start}–{p.end}
              </Text>
            </View>
            {p.isBreak ? (
              <View className="min-h-[48px] items-center justify-center rounded-xl bg-ink-100 px-2">
                <Text className="text-xs text-ink-700">Break</Text>
              </View>
            ) : (
              <DropCell
                tall
                armed={hold}
                hot={over === key}
                filled={slotFilled(slot)}
                subject={slotSubject(slot)}
                teacher={slot?.teacher || ""}
                covers={slot?.covers}
                editable={editable}
                hint={hold ? "Tap to place" : editable ? "Tap to assign" : ""}
                onOver={() => onOver(key)}
                onLeave={onLeave}
                onDrop={(payload) => onDrop(p.id, activeDay, payload)}
                onPress={() => {
                  if (!editable) return;
                  onPlace(p.id, activeDay);
                }}
                onClear={() => onClear(p.id, activeDay)}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

function WeekGrid({
  weekdays,
  periods,
  slots,
  hold,
  over,
  editable,
  onOver,
  onLeave,
  onDrop,
  onPlace,
  onClear,
  onCopyDay,
  others,
  focus,
  footer,
}: {
  /** Copy a day's column to other days. */
  onCopyDay?: (weekday: number) => void;
  weekdays: { n: number; label: string }[];
  periods: { id: string; name: string; start: string; end: string; isBreak?: boolean }[];
  slots: WeekSlot[];
  hold: boolean;
  over: string;
  editable: boolean;
  onOver: (key: string) => void;
  onLeave: () => void;
  onDrop: (periodId: string, weekday: number, payload: Hold) => void;
  onPlace: (periodId: string, weekday: number) => void;
  onClear: (periodId: string, weekday: number) => void;
  others: { label: string; slots: (WeekSlot & { teacherId?: string })[] }[];
  focus?: string;
  footer?: ReactNode;
}) {
  const todayN = jsToWeekday(new Date().getDay());
  const PERIOD_W = 96;
  const DAY_MIN = 118;
  const minWidth = PERIOD_W + weekdays.length * DAY_MIN;
  const [boxW, setBoxW] = useState(0);
  const gridW = Math.max(minWidth, boxW);
  return (
    <Card className="min-h-0 flex-1 overflow-hidden">
      <ScrollView className="min-h-0 flex-1" nestedScrollEnabled contentContainerClassName="pb-4">
        <ScrollView
          horizontal
          nestedScrollEnabled
          onLayout={(e) => setBoxW(Math.floor(e.nativeEvent.layout.width))}
          showsHorizontalScrollIndicator={gridW > boxW}
        >
          <View style={{ width: gridW }}>
            <View className="flex-row bg-ink-50">
              <View className="shrink-0 px-3 py-2.5" style={{ width: PERIOD_W }}>
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Period</Text>
              </View>
              {weekdays.map((d) => (
                <View key={d.n} className="min-w-0 flex-1 flex-row items-center gap-1 px-2 py-2.5">
                  <Text
                    numberOfLines={1}
                    className={`min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide ${d.n === todayN ? "text-clay-600" : "text-ink-500"}`}
                  >
                    {d.label}
                    {d.n === todayN ? " · Today" : ""}
                  </Text>
                  {onCopyDay && slots.some((x) => x.weekday === d.n && slotFilled(x)) ? (
                    <Pressable
                      onPress={() => onCopyDay(d.n)}
                      accessibilityRole="button"
                      accessibilityLabel={`Copy ${d.label} to other days`}
                      hitSlop={6}
                      className="rounded p-0.5 hover:bg-ink-100"
                    >
                      <Ionicons name="copy-outline" size={13} color="#64748b" />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
            {periods.map((p) =>
              p.isBreak ? (
                <View key={p.id} className="flex-row items-center gap-2 border-t border-ink-100 bg-ink-50 px-3 py-1.5">
                  <Ionicons name="cafe-outline" size={13} color="#94a3b8" />
                  <Text className="text-xs text-ink-500">
                    {p.name} · {p.start}–{p.end}
                  </Text>
                </View>
              ) : (
                <View key={p.id} className="flex-row border-t border-ink-100">
                  <View className="shrink-0 justify-center px-3 py-2" style={{ width: PERIOD_W }}>
                    <Text className="text-[13px] font-semibold text-ink-900" numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text className="text-[11px] text-ink-500">
                      {p.start}–{p.end}
                    </Text>
                  </View>
                  {weekdays.map((d) => {
                    const slot = findSlot(slots, p, d.n) as (WeekSlot & { teacherId?: string }) | undefined;
                    const key = `${p.id}:${d.n}`;
                    const filled = slotFilled(slot);
                    const clashes = filled
                      ? others
                          .filter((c) =>
                            c.slots.some(
                              (o) =>
                                o.weekday === d.n &&
                                (o.periodId === p.id || o.period === p.name) &&
                                ((slot?.teacherId && o.teacherId === slot.teacherId) ||
                                  (!slot?.teacherId && slot?.teacher && o.teacher === slot.teacher))
                            )
                          )
                          .map((c) => c.label)
                      : [];
                    return (
                      <View
                        key={key}
                        className="min-w-0 flex-1 p-1"
                        style={{ opacity: focus && slotSubject(slot) !== focus ? 0.3 : 1 }}
                      >
                        <DropCell
                          compact
                          armed={hold}
                          hot={over === key}
                          filled={filled}
                          subject={slotSubject(slot)}
                          teacher={slot?.teacher || ""}
                          covers={slot?.covers}
                          clashes={clashes}
                          editable={editable}
                          hint={hold ? "Tap or drop" : ""}
                          onOver={() => onOver(key)}
                          onLeave={onLeave}
                          onDrop={(payload) => onDrop(p.id, d.n, payload)}
                          onPress={() => {
                            if (!editable) return;
                            onPlace(p.id, d.n);
                          }}
                          onClear={() => onClear(p.id, d.n)}
                        />
                      </View>
                    );
                  })}
                </View>
              )
            )}
          </View>
        </ScrollView>
        {footer ? <View className="mt-4 px-1">{footer}</View> : null}
      </ScrollView>
    </Card>
  );
}

function MissingPeriodsGrid({ onPress }: { onPress: () => void }) {
  return (
    <Card className="min-h-[320px] flex-1 items-center justify-center gap-3 p-6">
      <View className="h-12 w-12 items-center justify-center rounded-full bg-blue-50">
        <Ionicons name="time-outline" size={24} color="#1f5feb" />
      </View>
      <View className="items-center gap-1">
        <Text className="text-base font-semibold text-ink-900">No periods found</Text>
        <Text className="max-w-md text-center text-sm leading-6 text-ink-700">
          Set bell periods in School settings before building the routine.
        </Text>
      </View>
      <Button className="mt-1 px-6" onPress={onPress}>
        Set periods
      </Button>
    </Card>
  );
}

function SubjectChip({
  teacherId,
  subjectName,
  picked,
  editable,
  compact,
  onPick,
}: {
  teacherId: string;
  subjectName: string;
  picked: boolean;
  editable: boolean;
  compact?: boolean;
  onPick: (subjectName: string, toggle?: boolean) => void;
}) {
  const ref = useRef<View>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const className = `flex-row items-center gap-1.5 rounded-md border ${compact ? "min-h-[40px] px-3 py-2" : "px-2 py-1"} ${
    picked ? "border-clay-500 bg-clay-50" : "border-ink-200 bg-white"
  }`;
  const dot = <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: subjectTone(subjectName) }} />;
  const label = <Text className={`text-xs ${picked ? "font-semibold text-clay-700" : "text-ink-800"}`}>{subjectName}</Text>;

  useEffect(() => {
    const el = webNode(ref);
    if (!el || !editable) return;
    el.draggable = true;
    el.style.cursor = "grab";
    el.style.userSelect = "none";
    let dragging = false;
    const click = () => {
      if (!editable) return;
      if (dragging) {
        dragging = false;
        return;
      }
      pickRef.current(subjectName, true);
    };
    const start = (e: Event) => {
      dragging = true;
      const dt = (e as unknown as DragEvt).dataTransfer;
      const payload = JSON.stringify({ teacherId, subjectName });
      dt?.setData("text/plain", payload);
      try {
        dt?.setData("application/json", payload);
      } catch {
        /* some browsers only allow text/plain */
      }
      if (dt) dt.effectAllowed = "copy";
      pickRef.current(subjectName, false);
    };
    el.addEventListener("click", click);
    el.addEventListener("dragstart", start);
    return () => {
      el.draggable = false;
      el.removeEventListener("click", click);
      el.removeEventListener("dragstart", start);
    };
  }, [editable, teacherId, subjectName]);

  if (Platform.OS === "web") {
    return (
      <View ref={ref} className={className}>
        {dot}
        {label}
      </View>
    );
  }
  return (
    <Pressable disabled={!editable} onPress={() => onPick(subjectName, true)} className={className}>
      {dot}
      {label}
    </Pressable>
  );
}

function TeacherCard({
  teacherId,
  name,
  qualification,
  idle,
  team,
  skills,
  hold,
  editable,
  compact,
  onEdit,
  onPick,
}: {
  teacherId: string;
  name: string;
  qualification?: string;
  idle?: boolean;
  team?: boolean;
  skills: string[];
  hold: Hold | null;
  editable: boolean;
  compact?: boolean;
  onEdit?: () => void;
  onPick: (subjectName: string, toggle?: boolean) => void;
}) {
  return (
    <Card className={compact ? "p-2.5" : "p-3"}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="font-medium text-ink-900">{name}</Text>
          {idle || team ? (
            <Text className="mt-0.5 text-[11px] leading-4 text-leaf-600">
              {[idle ? "Free now" : "", team ? "Team" : ""].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          {qualification ? (
            <Text className="mt-0.5 text-[11px] leading-4 text-ink-700">{qualification}</Text>
          ) : null}
        </View>
        {onEdit ? (
          <Pressable onPress={onEdit} className="min-h-[36px] justify-center">
            <Text className="text-xs text-clay-600">Edit</Text>
          </Pressable>
        ) : null}
      </View>
      <View className="mt-2 flex-row flex-wrap gap-1.5">
        {skills.length ? (
          skills.map((subjectName) => {
            const picked = hold?.teacherId === teacherId && hold.subjectName === subjectName;
            return (
              <SubjectChip
                key={subjectName}
                teacherId={teacherId}
                subjectName={subjectName}
                picked={picked}
                editable={editable}
                compact={compact}
                onPick={onPick}
              />
            );
          })
        ) : (
          <Text className="text-xs text-ink-700">Edit to set what they teach</Text>
        )}
      </View>
    </Card>
  );
}

function DropCell({
  hot,
  filled,
  subject,
  teacher,
  covers,
  editable,
  hint,
  tall,
  compact,
  armed,
  clashes,
  onOver,
  onLeave,
  onDrop,
  onPress,
  onClear,
}: {
  hot: boolean;
  filled: boolean;
  subject: string;
  teacher: string;
  covers?: { date: string; status?: string; substituteId: string; substitute: string; absentTeacher: string }[];
  clashes?: string[];
  editable: boolean;
  hint: string;
  tall?: boolean;
  compact?: boolean;
  armed?: boolean;
  onOver: () => void;
  onLeave: () => void;
  onDrop: (p: Hold) => void;
  onPress: () => void;
  onClear: () => void;
}) {
  const ref = useRef<View>(null);
  const overRef = useRef(onOver);
  const leaveRef = useRef(onLeave);
  const dropRef = useRef(onDrop);
  overRef.current = onOver;
  leaveRef.current = onLeave;
  dropRef.current = onDrop;
  const waiting = Boolean(armed && !filled);
  const [hover, setHover] = useState(false);
  const tone = subjectTone(subject || teacher || "");
  const clash = Boolean(clashes?.length);

  useEffect(() => {
    if (!editable) return;
    const el = webNode(ref);
    if (!el) return;
    const dragOver = (e: Event) => {
      e.preventDefault();
      const dt = (e as unknown as DragEvt).dataTransfer;
      if (dt) dt.dropEffect = "copy";
      overRef.current();
    };
    const dragLeave = (e: Event) => {
      const ev = e as unknown as { currentTarget?: EventTarget | null; relatedTarget?: EventTarget | null };
      if (
        ev.currentTarget instanceof Node &&
        ev.relatedTarget instanceof Node &&
        ev.currentTarget.contains(ev.relatedTarget)
      ) {
        return;
      }
      leaveRef.current();
    };
    const dropped = (e: Event) => {
      e.preventDefault();
      leaveRef.current();
      const dt = (e as unknown as DragEvt).dataTransfer;
      const raw = dt?.getData("application/json") || dt?.getData("text/plain") || "";
      const payload = parseHold(raw);
      if (payload) dropRef.current(payload);
    };
    el.addEventListener("dragover", dragOver);
    el.addEventListener("dragenter", dragOver);
    el.addEventListener("dragleave", dragLeave);
    el.addEventListener("drop", dropped);
    return () => {
      el.removeEventListener("dragover", dragOver);
      el.removeEventListener("dragenter", dragOver);
      el.removeEventListener("dragleave", dragLeave);
      el.removeEventListener("drop", dropped);
    };
  }, [editable]);

  const tinted = filled && !hot && !waiting;
  return (
    <View
      ref={ref}
      className={`${compact ? "min-h-[56px] rounded-lg px-2 py-1.5" : tall ? "min-h-[64px] rounded-xl px-3 py-2.5" : "min-h-[72px] rounded-xl px-3 py-2.5"} border ${
        hot
          ? "border-clay-500 bg-blue-50"
          : waiting
            ? "border-clay-500/50 bg-blue-50/70"
            : filled
              ? ""
              : "border-dashed border-ink-200 bg-white"
      }`}
      style={
        tinted
          ? {
              backgroundColor: clash ? "#fef2f2" : hover ? "#f8fafc" : "#ffffff",
              borderColor: clash ? "#fca5a5" : "#e2e8f0",
            }
          : undefined
      }
    >
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        className={compact ? "min-h-[42px] justify-center" : tall ? "min-h-[48px] justify-center" : "min-h-[56px]"}
      >
        {filled ? (
          <View className="flex-row items-start gap-1">
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-1.5">
                <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone }} />
                <Text className={`min-w-0 flex-1 ${compact ? "text-[13px]" : "text-[15px]"} font-semibold text-ink-900`} numberOfLines={1}>
                  {subject || "—"}
                </Text>
              </View>
              {teacher ? (
                <View className="mt-0.5 flex-row items-center gap-1 pl-3">
                  <Text className="min-w-0 flex-1 text-[11px] text-ink-500" numberOfLines={1}>
                    {teacher}
                  </Text>
                </View>
              ) : null}
              {clash ? (
                <Text className="mt-0.5 text-[10px] font-semibold text-red-700" numberOfLines={1}>
                  Also in {clashes!.join(", ")}
                </Text>
              ) : null}
              {covers?.length ? (
                <View className="mt-1 rounded-md bg-emerald-50 px-1.5 py-0.5">
                  {covers.slice(0, 2).map((cover) => (
                    <Text key={`${cover.date}:${cover.substituteId}`} className="text-[10px] font-medium text-emerald-700" numberOfLines={1}>
                      {new Date(`${cover.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} only · {coverWho(cover)}
                    </Text>
                  ))}
                  {covers.length > 2 ? <Text className="text-[10px] text-emerald-700">+{covers.length - 2} more</Text> : null}
                </View>
              ) : null}
            </View>
            {editable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${subject || "period"}`}
                hitSlop={6}
                onPress={(e) => {
                  e.stopPropagation?.();
                  onClear();
                }}
                className={`h-6 w-6 items-center justify-center rounded-full ${hover ? "bg-red-50" : "bg-transparent"}`}
                style={{ opacity: hover || Platform.OS !== "web" ? 1 : 0.45 }}
              >
                <Ionicons name="close" size={14} color={hover ? "#b91c1c" : "#64748b"} />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View className="items-center justify-center">
            {editable && hint ? (
              <Text className="text-center text-xs text-ink-700">{hint}</Text>
            ) : editable && compact ? (
              <Ionicons name="add" size={16} color={hover ? "#2563eb" : "#cbd5e1"} />
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

/** Phone: pick any teacher not yet in this class, tick the class subjects they take, save. */
function AddTeacherSheet({
  open,
  classId,
  classLabel,
  subjects,
  teachers,
  onClose,
  onSave,
}: {
  open: boolean;
  classId: string;
  classLabel: string;
  subjects: string[];
  teachers: { id: string; name: string; skills: { subjectName: string; classId: string }[] }[];
  onClose: () => void;
  onSave: (teacherId: string, subjects: string[]) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [pickedId, setPickedId] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setQ("");
    setPickedId("");
    setChosen([]);
    setError("");
  }, [open]);

  const inClass = (t: { skills: { classId: string }[] }) => t.skills.some((s) => s.classId === classId);
  const needle = q.trim().toLowerCase();
  const others = teachers
    .filter((t) => !inClass(t))
    .filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.skills.some((s) => s.subjectName.toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const picked = teachers.find((t) => t.id === pickedId);
  const takenBy = (subject: string) =>
    teachers
      .filter((t) => t.id !== pickedId && t.skills.some((s) => s.classId === classId && s.subjectName.toLowerCase() === subject.toLowerCase()))
      .map((t) => t.name.split(" ")[0]);
  const initials = (name: string) => name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  async function save() {
    if (!picked || !chosen.length) return;
    setBusy(true);
    setError("");
    try {
      await onSave(picked.id, chosen);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} fixed={0.82}>
      {!picked ? (
        <View className="gap-3 px-4 pb-4">
          <View>
            <Text className="text-base font-semibold text-ink-900">Add teacher to {classLabel}</Text>
            <Text className="mt-0.5 text-xs text-ink-600">Pick a teacher, then the subjects they take in {classLabel}.</Text>
          </View>
          <View className="flex-row items-center gap-2 rounded-lg border border-ink-200 bg-white px-3">
            <Ionicons name="search" size={14} color="#94a3b8" />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Find teacher or subject"
              placeholderTextColor="#94a3b8"
              className="min-h-[40px] flex-1 text-sm text-ink-900"
            />
          </View>
          {others.length ? (
            <View className="overflow-hidden rounded-xl border border-ink-200">
              {others.map((t, i) => {
                const where = [...new Set(t.skills.map((s) => s.subjectName))].slice(0, 3).join(", ");
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => setPickedId(t.id)}
                    accessibilityRole="button"
                    className={`flex-row items-center gap-3 bg-white px-3 py-3 active:bg-ink-50 ${i ? "border-t border-ink-100" : ""}`}
                  >
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-[#EEF3FF]">
                      <Text className="text-xs font-semibold text-[#1F45C7]">{initials(t.name)}</Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>{t.name}</Text>
                      <Text className="text-xs text-ink-500" numberOfLines={1}>
                        {where ? `Teaches ${where}` : "No subjects yet"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text className="py-6 text-center text-sm text-ink-600">
              {needle ? `No teacher matches "${q.trim()}".` : `Every teacher already teaches in ${classLabel}.`}
            </Text>
          )}
        </View>
      ) : (
        <View className="gap-3 px-4 pb-4">
          <View className="flex-row items-center gap-3">
            <Pressable onPress={() => setPickedId("")} accessibilityLabel="Back" hitSlop={8}>
              <Ionicons name="chevron-back" size={20} color="#1F45C7" />
            </Pressable>
            <View className="h-9 w-9 items-center justify-center rounded-full bg-[#EEF3FF]">
              <Text className="text-xs font-semibold text-[#1F45C7]">{initials(picked.name)}</Text>
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold text-ink-900" numberOfLines={1}>{picked.name}</Text>
              <Text className="text-xs text-ink-600">Subjects in {classLabel}</Text>
            </View>
          </View>
          {subjects.length ? (
            <View className="flex-row flex-wrap gap-2">
              {subjects.map((name) => {
                const on = chosen.includes(name);
                const also = takenBy(name);
                return (
                  <Pressable
                    key={name}
                    onPress={() => setChosen((cur) => (on ? cur.filter((x) => x !== name) : [...cur, name]))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    className={`rounded-xl border px-3 py-2 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
                  >
                    <Text className={`text-sm font-medium ${on ? "text-white" : "text-ink-800"}`}>{name}</Text>
                    {also.length ? (
                      <Text className={`text-[10px] ${on ? "text-blue-100" : "text-ink-500"}`}>Also {also.join(", ")}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text className="text-sm text-ink-600">{classLabel} has no subjects yet. Add them in the class plan first.</Text>
          )}
          {error ? <Text className="text-xs text-red-700">{error}</Text> : null}
          <Button disabled={busy || !chosen.length} onPress={save}>
            {busy ? "Saving…" : chosen.length ? `Add to ${classLabel} · ${chosen.length} subject${chosen.length === 1 ? "" : "s"}` : "Pick at least one subject"}
          </Button>
        </View>
      )}
    </Sheet>
  );
}

type CopyPreview = {
  days: { weekday: number; copied: number; cleared: number; kept: number; skipped: { period: string; subject: string; reason: string }[] }[];
  copied: number;
  skipped: number;
  over: { subject: string; count: number; target: number }[];
};

/** Copy one day's routine to other days (phone: full-screen sheet; web: dialog). Preview comes from the server. */
function CopyDaySheet({
  classId,
  classLabel,
  weekdays,
  fromDay,
  filledOn,
  onClose,
  onDone,
}: {
  classId: string;
  classLabel: string;
  weekdays: { n: number; label: string }[];
  fromDay: number;
  filledOn: (n: number) => number;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const { token } = useSession();
  const [from, setFrom] = useState(fromDay);
  const [to, setTo] = useState<number[]>([]);
  const [mode, setMode] = useState<"empty" | "replace">("empty");
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const others = weekdays.filter((d) => d.n !== from);
  const name = (n: number) => weekdays.find((d) => d.n === n)?.label || "";
  const short = (n: number) => name(n).slice(0, 3);

  useEffect(() => {
    setTo((cur) => cur.filter((n) => n !== from));
  }, [from]);

  useEffect(() => {
    setPreview(null);
    setError("");
    if (!to.length || !filledOn(from)) return;
    let stale = false;
    setChecking(true);
    const t = setTimeout(() => {
      act<{ ok: true } & CopyPreview>(token, "copyTimetableDay", { classId, fromWeekday: from, toWeekdays: to, mode, dryRun: true })
        .then((res) => !stale && setPreview(res))
        .catch((e) => !stale && setError(e instanceof Error ? e.message : "Could not check."))
        .finally(() => !stale && setChecking(false));
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [classId, from, to, mode, token]);

  async function apply() {
    setBusy(true);
    setError("");
    try {
      const res = await act<{ ok: true } & CopyPreview>(token, "copyTimetableDay", { classId, fromWeekday: from, toWeekdays: to, mode });
      const msg = `${res.copied} ${res.copied === 1 ? "period" : "periods"} copied from ${name(from)}${res.skipped ? ` · ${res.skipped} skipped` : ""}.`;
      await onDone(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not copy.");
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean) => `rounded-xl border px-3 py-2 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`;
  const chipText = (on: boolean) => `text-sm font-semibold ${on ? "text-white" : "text-ink-800"}`;
  const changes = preview ? preview.copied + preview.days.reduce((n, d) => n + d.cleared, 0) : 0;

  return (
    <Modal
      open
      title={`Copy a day · ${classLabel}`}
      onClose={() => (busy ? undefined : onClose())}
      sheetOnPhone
      footer={
        <View className="flex-row items-center justify-end gap-2">
          <Button variant="ghost" disabled={busy} onPress={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || checking || !to.length || !changes} onPress={() => void apply()}>
            {busy
              ? "Copying…"
              : !to.length
                ? "Pick days"
                : preview && !changes
                  ? "Nothing to copy"
                  : `Copy to ${to.length} ${to.length === 1 ? "day" : "days"}`}
          </Button>
        </View>
      }
    >
      <View className="gap-4">
        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">1 · Copy from</Text>
          <View className="flex-row flex-wrap gap-2">
            {weekdays.map((d) => {
              const n = filledOn(d.n);
              const on = d.n === from;
              return (
                <Pressable key={d.n} disabled={!n} onPress={() => setFrom(d.n)} className={`${chip(on)} ${!n ? "opacity-40" : ""}`}>
                  <Text className={chipText(on)}>{short(d.n)}</Text>
                  <Text className={`text-[10px] ${on ? "text-blue-100" : "text-ink-500"}`}>{n} periods</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">2 · Copy to</Text>
            <Pressable onPress={() => setTo(to.length === others.length ? [] : others.map((d) => d.n))} hitSlop={6}>
              <Text className="text-xs font-semibold text-[#1F45C7]">{to.length === others.length ? "Clear" : "All other days"}</Text>
            </Pressable>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {others.map((d) => {
              const on = to.includes(d.n);
              return (
                <Pressable
                  key={d.n}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setTo((cur) => (on ? cur.filter((x) => x !== d.n) : [...cur, d.n]))}
                  className={`flex-row items-center gap-1.5 ${chip(on)}`}
                >
                  {on ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                  <Text className={chipText(on)}>{short(d.n)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">3 · If a period already has a lesson</Text>
          {(
            [
              { id: "empty", title: "Only fill empty periods", sub: "Lessons already there stay." },
              { id: "replace", title: "Replace the whole day", sub: `The day becomes exactly like ${name(from)}.` },
            ] as const
          ).map((opt) => {
            const on = mode === opt.id;
            return (
              <Pressable
                key={opt.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                onPress={() => setMode(opt.id)}
                className={`flex-row items-center gap-3 rounded-xl border px-3 py-2.5 ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
              >
                <View className={`h-4 w-4 items-center justify-center rounded-full border ${on ? "border-[#1F45C7]" : "border-ink-300"}`}>
                  {on ? <View className="h-2 w-2 rounded-full bg-[#1F45C7]" /> : null}
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-medium text-ink-900">{opt.title}</Text>
                  <Text className="text-xs text-ink-600">{opt.sub}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {to.length ? (
          <View className="gap-2 rounded-xl border border-ink-200 bg-ink-50 p-3">
            <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">Preview</Text>
            {checking && !preview ? <Text className="text-sm text-ink-600">Checking teachers and targets…</Text> : null}
            {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
            {preview?.days.map((d) => (
              <View key={d.weekday} className="gap-0.5">
                <Text className="text-sm text-ink-900">
                  <Text className="font-semibold">{name(d.weekday)}: </Text>
                  {[
                    d.copied ? `${d.copied} copied` : "",
                    d.cleared ? `${d.cleared} cleared` : "",
                    d.kept ? `${d.kept} already there` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "no change"}
                </Text>
                {d.skipped.map((x, i) => (
                  <Text key={i} className="text-xs text-amber-800">
                    {x.period} {x.subject ? `(${x.subject})` : ""} skipped: {x.reason}
                  </Text>
                ))}
              </View>
            ))}
            {preview?.over.length ? (
              <Text className="text-xs text-amber-800">
                Still over target: {preview.over.map((o) => `${o.subject} ${o.count}/${o.target}`).join(", ")}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
