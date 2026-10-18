import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { apiBase } from "../lib/api";
import { act } from "../lib/mutate";
import { downloadAuthedFile } from "../lib/print-html";
import { pickFile, uploadFile } from "../lib/upload";
import { DateField } from "./date-field";
import { BackLink, Modal } from "./ui";

/**
 * "This year's exams": the school-wide exam list (Unit Test 1, Term 1, …) with where each one stands
 * across every class. Built to never block: an exam that already happened before the school joined
 * is just "Not tracked", with an optional "Add old marks".
 */

export type YearPlanItem = { id: string; name: string; kind: string; weight: number; maxMarks: number; expectedPeriod?: string; classIds?: string[] };

/** The classes an exam is for (none listed = every class). */
export function examClasses<T extends { id: string }>(item: YearPlanItem, classes: T[]) {
  return item.classIds?.length ? classes.filter((c) => item.classIds!.includes(c.id)) : classes;
}
export type YearSeries = {
  id: string;
  classId: string;
  sessionId: string;
  planItemId: string;
  name: string;
  exams: { workflowStatus?: string; date: string; copiesDueOn?: string | null }[];
};
export type YearClass = { id: string; label: string; subjects?: { id: string; name: string; code?: string; label?: string }[] };
export type YearStudent = { id: string; name: string; admissionNo?: string; rollNumber?: number | null; classId: string };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function monthIndex(period?: string) {
  const text = String(period || "").trim().toLowerCase();
  if (!text) return -1;
  return MONTHS.findIndex((m) => m.startsWith(text.slice(0, 3)));
}

/** The calendar month of a plan item inside the session (Jul 2026 … Mar 2027). */
function itemMonth(item: YearPlanItem, sessionStart?: string) {
  const m = monthIndex(item.expectedPeriod);
  if (m < 0 || !sessionStart) return null;
  const startYear = Number(sessionStart.slice(0, 4));
  const startMonth = Number(sessionStart.slice(5, 7)) - 1;
  const year = m >= startMonth ? startYear : startYear + 1;
  return { year, month: m };
}

function isPast(item: YearPlanItem, sessionStart?: string) {
  const at = itemMonth(item, sessionStart);
  if (!at) return false;
  const now = new Date();
  return at.year < now.getFullYear() || (at.year === now.getFullYear() && at.month < now.getMonth());
}

function defaultExamDate(item: YearPlanItem, sessionStart?: string) {
  const at = itemMonth(item, sessionStart);
  if (at) return `${at.year}-${String(at.month + 1).padStart(2, "0")}-15`;
  const d = new Date(Date.now() - 30 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

type Standing = {
  tone: "upcoming" | "untracked" | "active" | "done";
  label: string;
  detail: string;
  pct: number;
};

function standing(item: YearPlanItem, series: YearSeries[], classCount: number, past: boolean): Standing {
  const mine = series.filter((s) => s.planItemId === item.id && s.exams.length);
  const done = mine.filter((s) => s.exams.every((e) => e.workflowStatus === "PUBLISHED")).length;
  if (!mine.length) {
    return past
      ? { tone: "untracked", label: "Not tracked", detail: "Happened before Anekio. Adding old marks is optional.", pct: 0 }
      : { tone: "upcoming", label: "Not scheduled", detail: item.expectedPeriod ? `Usually in ${item.expectedPeriod}` : "Not scheduled yet", pct: 0 };
  }
  if (done === classCount && classCount > 0) {
    return { tone: "done", label: "Completed", detail: `All ${classCount} classes`, pct: 100 };
  }
  return {
    tone: "active",
    label: "In progress",
    detail: `${mine.length} of ${classCount} classes${done ? ` · ${done} done` : ""}`,
    pct: classCount ? Math.round((mine.length / classCount) * 100) : 0,
  };
}

const TONE = {
  upcoming: { icon: "ellipse-outline" as const, color: "#64748B", pill: "bg-ink-50", text: "text-ink-700" },
  untracked: { icon: "remove-circle-outline" as const, color: "#94A3B8", pill: "bg-ink-50", text: "text-ink-500" },
  active: { icon: "time-outline" as const, color: "#2563EB", pill: "bg-blue-50", text: "text-clay-600" },
  done: { icon: "checkmark-circle" as const, color: "#16A34A", pill: "bg-emerald-50", text: "text-emerald-700" },
};

const SENT = ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW", "APPROVED"];

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** What needs the admin on one exam: papers ready to publish, and papers whose marks are late. */
function attention(series: YearSeries[]) {
  const today = todayYmd();
  const exams = series.flatMap((s) => s.exams);
  return {
    toPublish: exams.filter((e) => SENT.includes(e.workflowStatus || "")).length,
    late: exams.filter(
      (e) => e.workflowStatus !== "PUBLISHED" && !SENT.includes(e.workflowStatus || "") && e.copiesDueOn && String(e.copiesDueOn).slice(0, 10) < today
    ).length,
  };
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12–20 Aug" or "28 Oct – 6 Nov" from the scheduled papers; "" if nothing is scheduled. */
function dateRange(series: YearSeries[]) {
  const days = series.flatMap((s) => s.exams.map((e) => String(e.date).slice(0, 10))).filter(Boolean).sort();
  if (!days.length) return "";
  const part = (v: string) => {
    const [, m, d] = v.split("-").map(Number);
    return { d, m: SHORT_MONTHS[m - 1] };
  };
  const a = part(days[0]);
  const b = part(days[days.length - 1]);
  if (days[0] === days[days.length - 1]) return `${a.d} ${a.m}`;
  return a.m === b.m ? `${a.d}–${b.d} ${a.m}` : `${a.d} ${a.m} – ${b.d} ${b.m}`;
}

/** Page 1: the year's exams. Click a row to open that exam. */
export function ExamYearOverview({
  plan,
  series,
  classes,
  sessionStart,
  canRun,
  onSchedule,
  onOpen,
  onAddOldMarks,
  onCreate,
  onAddCbse,
}: {
  onCreate?: () => void;
  onAddCbse?: () => void;
  plan: YearPlanItem[];
  series: YearSeries[];
  classes: YearClass[];
  sessionStart?: string;
  canRun: boolean;
  onSchedule: (planItemId: string) => void;
  onOpen: (planItemId: string) => void;
  onAddOldMarks: (planItemId: string) => void;
}) {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const [showDone, setShowDone] = useState(false);
  if (!plan.length) {
    return (
      <View className="items-center rounded-xl border border-dashed border-ink-200 bg-white px-6 py-12">
        <Ionicons name="clipboard-outline" size={34} color="#94A3B8" />
        <Text className="mt-3 text-[16px] font-semibold text-ink-900">No exams this year yet</Text>
        <Text className="mt-1 max-w-[420px] text-center text-[13px] text-ink-700">
          Create an exam with any name, for the classes you choose. You can add as many as you need.
        </Text>
        {canRun ? (
          <View className="mt-4 flex-row flex-wrap justify-center gap-2">
            {onCreate ? <RowButton label="New exam" icon="add" primary onPress={onCreate} /> : null}
            {onAddCbse ? <RowButton label="Start from CBSE pattern" onPress={onAddCbse} /> : null}
          </View>
        ) : null}
      </View>
    );
  }
  const doneIds = new Set(
    plan
      .filter((item) => {
        const n = examClasses(item, classes).length;
        return standing(item, series, n, isPast(item, sessionStart)).tone === "done";
      })
      .map((item) => item.id)
  );
  const ongoing = plan.filter((item) => !doneIds.has(item.id));
  const completed = plan.filter((item) => doneIds.has(item.id));
  const renderRow = (item: YearPlanItem, index: number) => {
        const itemClassCount = examClasses(item, classes).length;
        const past = isPast(item, sessionStart);
        const mine = series.filter((x) => x.planItemId === item.id && x.exams.length);
        const s = standing(item, series, itemClassCount, past);
        const tone = TONE[s.tone];
        const started = mine.length > 0;
        const need = attention(mine);
        const papers = mine.reduce((sum, x) => sum + x.exams.length, 0);
        const published = mine.reduce((sum, x) => sum + x.exams.filter((e) => e.workflowStatus === "PUBLISHED").length, 0);
        const pct = papers ? Math.round((published / papers) * 100) : 0;
        if (compact) {
          const action =
            started || !canRun ? null : s.tone === "untracked" ? (
              <RowButton label="Add old marks" icon="cloud-upload-outline" onPress={() => onAddOldMarks(item.id)} />
            ) : (
              <RowButton label="Schedule" onPress={() => onSchedule(item.id)} />
            );
          const details = [
            dateRange(mine) || item.expectedPeriod,
            `out of ${item.maxMarks}`,
            started ? "" : s.tone === "untracked" ? "Not tracked" : "Not scheduled",
          ].filter(Boolean).join(" · ");
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${s.label}`}
              onPress={() => onOpen(item.id)}
              className={`gap-1 px-4 py-4 active:bg-ink-50 ${index ? "border-t border-ink-100" : ""}`}
            >
              <View className="flex-row items-center gap-3">
                <Text className={`min-w-0 flex-1 text-[15px] font-semibold ${s.tone === "untracked" ? "text-ink-600" : "text-ink-900"}`} numberOfLines={1}>
                  {item.name}
                </Text>
                {action || <Ionicons name="chevron-forward" size={16} color="#94A3B8" />}
              </View>
              <Text className="text-[13px] text-ink-500" numberOfLines={1}>{details}</Text>
              {need.toPublish || need.late ? (
                <View className="mt-1.5 flex-row flex-wrap gap-2">
                  {need.toPublish ? (
                    <View className="rounded-full bg-violet-50 px-2.5 py-1">
                      <Text className="text-[12px] font-medium text-violet-700">{need.toPublish} to publish</Text>
                    </View>
                  ) : null}
                  {need.late ? (
                    <View className="rounded-full bg-red-50 px-2.5 py-1">
                      <Text className="text-[12px] font-medium text-red-700">{need.late} paper{need.late === 1 ? "" : "s"} late</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
              {started ? (
                <View className="mt-2 gap-1.5">
                  <View className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                    <View className={`h-full rounded-full ${s.tone === "done" ? "bg-emerald-500" : "bg-clay-500"}`} style={{ width: `${pct}%` }} />
                  </View>
                  <Text className="text-[13px] tabular-nums text-ink-500">
                    <Text className={`font-medium ${s.tone === "done" ? "text-emerald-700" : "text-ink-700"}`}>{s.tone === "done" ? "Completed" : "In progress"}</Text>
                    {` · ${published}/${papers} published · ${mine.length} of ${itemClassCount} classes`}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        }
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${s.label}`}
            onPress={() => onOpen(item.id)}
            className={`px-4 py-3.5 hover:bg-ink-50/60 ${index ? "border-t border-ink-100" : ""} ${compact ? "gap-2.5" : "flex-row items-center gap-4"}`}
          >
            <View className="min-w-0 flex-1 flex-row items-center gap-3">
              <Ionicons name={tone.icon} size={18} color={tone.color} />
              <View className="min-w-0 flex-1">
                <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                  <Text className={`text-[14px] font-semibold ${s.tone === "untracked" ? "text-ink-600" : "text-ink-900"}`}>{item.name}</Text>
                  {need.toPublish ? (
                    <View className="rounded-full bg-violet-50 px-2 py-0.5">
                      <Text className="text-[11px] font-medium text-violet-700">{need.toPublish} to publish</Text>
                    </View>
                  ) : null}
                  {need.late ? (
                    <View className="rounded-full bg-red-50 px-2 py-0.5">
                      <Text className="text-[11px] font-medium text-red-700">{need.late} paper{need.late === 1 ? "" : "s"} late</Text>
                    </View>
                  ) : null}
                </View>
                <Text className="mt-0.5 text-xs text-ink-500" numberOfLines={1}>
                  {[
                    dateRange(mine) || item.expectedPeriod,
                    item.classIds?.length ? `${itemClassCount} ${itemClassCount === 1 ? "class" : "classes"}` : "",
                    `out of ${item.maxMarks}`,
                    item.weight ? `${item.weight}% of final` : "Not in final result",
                  ].filter(Boolean).join(" · ")}
                </Text>
              </View>
            </View>
            <View className={`flex-row items-center gap-3 ${compact ? "pl-[30px]" : ""}`}>
              {started ? (
                <>
                  <View className="items-end">
                    <Text className={`text-[12px] font-medium ${s.tone === "done" ? "text-emerald-700" : "text-ink-700"}`}>{s.tone === "done" ? "Completed" : "In progress"}</Text>
                    <Text className="text-[11px] tabular-nums text-ink-500">
                      {mine.length} of {itemClassCount} classes · {published}/{papers} published
                    </Text>
                  </View>
                  <View className="w-24 h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <View className={`h-full rounded-full ${s.tone === "done" ? "bg-emerald-500" : "bg-clay-500"}`} style={{ width: `${papers ? Math.round((published / papers) * 100) : 0}%` }} />
                  </View>
                </>
              ) : s.tone === "untracked" ? (
                <>
                  <Text className="text-[12px] text-ink-500">Not tracked</Text>
                  {canRun ? <RowButton label="Add old marks" icon="cloud-upload-outline" onPress={() => onAddOldMarks(item.id)} /> : null}
                </>
              ) : (
                <>
                  <Text className="text-[12px] text-ink-500">Not scheduled</Text>
                  {canRun ? <RowButton label="Schedule" onPress={() => onSchedule(item.id)} /> : null}
                </>
              )}
              {!compact ? <Ionicons name="chevron-forward" size={16} color="#94A3B8" /> : null}
            </View>
          </Pressable>
        );
  };
  return (
    <View className="gap-4">
      {ongoing.length ? (
        <View className="gap-2">
          <Text className="text-[12px] font-semibold uppercase tracking-wider text-ink-500">Ongoing and upcoming</Text>
          <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">{ongoing.map((item, index) => renderRow(item, index))}</View>
        </View>
      ) : null}
      {completed.length ? (
        <View className="gap-2">
          <Pressable accessibilityRole="button" onPress={() => setShowDone((v) => !v)} className="flex-row items-center gap-1.5 self-start py-1">
            <Text className="text-[12px] font-semibold uppercase tracking-wider text-ink-500">{`Completed · ${completed.length}`}</Text>
            <Ionicons name={showDone ? "chevron-up" : "chevron-down"} size={14} color="#94A3B8" />
          </Pressable>
          {showDone || !ongoing.length ? (
            <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">{completed.map((item, index) => renderRow(item, index))}</View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Page 2: one exam across every class. Click a class to see its papers. */
export function ExamClassesPage({
  item,
  classes,
  series,
  sessionStart,
  sessionLabel,
  canRun,
  canPublish,
  busySeriesId,
  onBack,
  onOpenClass,
  onSchedule,
  onAddOldMarks,
  onPublishAll,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  item: YearPlanItem;
  classes: YearClass[];
  series: YearSeries[];
  sessionStart?: string;
  sessionLabel?: string;
  canRun: boolean;
  canPublish: boolean;
  busySeriesId?: string;
  onBack: () => void;
  onOpenClass: (classId: string, seriesId: string) => void;
  onSchedule: (classIds: string[] | null) => void;
  onAddOldMarks: () => void;
  onPublishAll: (seriesId: string) => void;
}) {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const mine = series.filter((s) => s.planItemId === item.id && s.exams.length);
  const unscheduled = classes.filter((c) => !mine.some((s) => s.classId === c.id));
  const past = isPast(item, sessionStart);
  const rows = mine
    .map((s) => {
      const klass = classes.find((c) => c.id === s.classId);
      const total = s.exams.length;
      const published = s.exams.filter((e) => e.workflowStatus === "PUBLISHED").length;
      const entered = s.exams.filter((e) => e.workflowStatus === "PUBLISHED" || SENT.includes(e.workflowStatus || "")).length;
      return klass ? { klass, s, total, published, entered, waiting: total - entered, ready: entered - published } : null;
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((x, y) => classes.indexOf(x.klass) - classes.indexOf(y.klass));
  const doneCount = rows.filter((r) => r.total && r.published === r.total).length;
  // Once any marks are in (or published), the exam is history — it can be edited, not deleted.
  const locked = rows.some((r) => r.entered > 0 || r.published > 0);

  function NextStep({ row }: { row: (typeof rows)[number] }) {
    const busy = busySeriesId === row.s.id;
    if (row.total && row.published === row.total) {
      return (
        <View className="flex-row items-center gap-1">
          <Ionicons name="checkmark-circle" size={15} color="#047857" />
          <Text className="text-[13px] font-medium text-emerald-700">Done</Text>
        </View>
      );
    }
    if (!row.waiting && row.ready && canPublish) {
      // Publishing happens on the class page, where the fee condition is set and every paper goes out together.
      return <RowButton label="Review & publish" primary disabled={busy} onPress={() => onOpenClass(row.klass.id, row.s.id)} />;
    }
    return (
      <View className={compact ? "" : "items-end"}>
        {row.waiting ? (
          <Text className="text-[13px] font-medium text-amber-700">{`${row.waiting} ${row.waiting === 1 ? "paper needs" : "papers need"} marks`}</Text>
        ) : null}
        {row.ready ? <Text className="text-[12px] text-ink-600">{`${row.ready} ready to publish`}</Text> : null}
      </View>
    );
  }

  function Meter({ value, total, tone }: { value: number; total: number; tone: "blue" | "green" }) {
    return (
      <View className="flex-row items-center gap-2">
        <View className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-100">
          <View className={`h-full rounded-full ${tone === "green" ? "bg-emerald-500" : "bg-clay-500"}`} style={{ width: `${total ? (value / total) * 100 : 0}%` }} />
        </View>
        <Text className="text-[12px] tabular-nums text-ink-700">{`${value} of ${total}`}</Text>
      </View>
    );
  }

  return (
    <View className="gap-4">
      <View className={compact ? "gap-4" : "flex-row items-end justify-between gap-4"}>
        <View className="min-w-0 flex-1">
          <BackLink label={sessionLabel ? `All ${sessionLabel} exams` : "All exams"} onPress={onBack} />
          <Text className={`${compact ? "text-[24px]" : "text-[28px]"} font-bold tracking-tight text-ink-900`}>{item.name}</Text>
          <View className="mt-2 flex-row flex-wrap items-center gap-x-5 gap-y-1.5">
            {[
              dateRange(mine) || item.expectedPeriod
                ? { icon: "calendar-outline" as const, text: dateRange(mine) || String(item.expectedPeriod) }
                : null,
              { icon: "ribbon-outline" as const, text: `Out of ${item.maxMarks}` },
              item.weight
                ? { icon: "pie-chart-outline" as const, text: `${item.weight}% of final result` }
                : { icon: "remove-circle-outline" as const, text: "Not in final result" },
            ]
              .filter(<T,>(m: T | null): m is T => Boolean(m))
              .map((m) => (
                <View key={m.icon} className="flex-row items-center gap-1.5">
                  <Ionicons name={m.icon} size={14} color="#64748B" />
                  <Text className="text-[13px] font-medium text-ink-800">{m.text}</Text>
                </View>
              ))}
          </View>
          {mine.length ? (
            <View className="mt-2.5 flex-row flex-wrap items-center gap-2">
              <View className="h-7 flex-row items-center gap-1.5 rounded-full bg-ink-100 px-3">
                <Ionicons name="school-outline" size={13} color="#334155" />
                <Text className="text-[12px] font-medium text-ink-800">{`${mine.length} of ${classes.length} classes scheduled`}</Text>
              </View>
              {doneCount ? (
                <View className="h-7 flex-row items-center gap-1.5 rounded-full bg-emerald-50 px-3">
                  <Ionicons name="checkmark-circle" size={13} color="#047857" />
                  <Text className="text-[12px] font-medium text-emerald-700">{`${doneCount} ${doneCount === 1 ? "class" : "classes"} published`}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        {canRun && (onEdit || onDuplicate || onDelete) ? (
          <View className="flex-row flex-wrap items-center gap-2">
            {onEdit ? <RowButton label="Edit" icon="create-outline" onPress={onEdit} /> : null}
            {onDuplicate ? <RowButton label="Duplicate" icon="copy-outline" onPress={onDuplicate} /> : null}
            {onDelete && !locked ? <RowButton label="Delete" icon="trash-outline" quiet onPress={onDelete} /> : null}
          </View>
        ) : null}
        {canRun && mine.length ? (
          <View className="flex-row flex-wrap items-center gap-2">
            {past ? <RowButton label="Add old marks" icon="cloud-upload-outline" onPress={onAddOldMarks} /> : null}
            {unscheduled.length ? (
              <RowButton label={mine.length ? `Schedule ${unscheduled.length} more class${unscheduled.length === 1 ? "" : "es"}` : `Schedule ${item.name}`} primary onPress={() => onSchedule(mine.length ? unscheduled.map((c) => c.id) : null)} />
            ) : null}
          </View>
        ) : null}
      </View>

      {compact && rows.length ? (
        <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
          {rows.map((row, index) => {
            const done = row.total > 0 && row.published === row.total;
            const busy = busySeriesId === row.s.id;
            const publishNow = !done && !row.waiting && row.ready > 0 && canPublish;
            return (
              <Pressable
                key={row.klass.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${row.klass.label}`}
                onPress={() => onOpenClass(row.klass.id, row.s.id)}
                className={`gap-1 px-4 py-4 active:bg-ink-50 ${index ? "border-t border-ink-100" : ""}`}
              >
                <View className="flex-row items-center gap-3">
                  <Text className="min-w-0 flex-1 text-[15px] font-semibold text-ink-900">{row.klass.label}</Text>
                  {done ? (
                    <View className="flex-row items-center gap-1">
                      <Ionicons name="checkmark-circle" size={15} color="#047857" />
                      <Text className="text-[13px] font-medium text-emerald-700">Done</Text>
                    </View>
                  ) : publishNow ? (
                    <RowButton label={busy ? "Publishing…" : `Publish ${row.ready}`} primary disabled={busy} onPress={() => onPublishAll(row.s.id)} />
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
                  )}
                </View>
                <Text className="text-[13px] text-ink-500">
                  {done ? `${row.total} papers · all published` : `${row.total} papers`}
                  {!done && row.waiting ? <Text className="font-medium text-amber-700">{` · ${row.waiting} need${row.waiting === 1 ? "s" : ""} marks`}</Text> : null}
                  {!done && row.ready && !publishNow ? <Text className="font-medium text-violet-700">{` · ${row.ready} to publish`}</Text> : null}
                </Text>
                {done ? null : (
                  <View className="mt-2 gap-1.5">
                    <View className="h-1.5 w-full flex-row overflow-hidden rounded-full bg-ink-100">
                      <View className="h-full bg-emerald-500" style={{ width: `${row.total ? (row.published / row.total) * 100 : 0}%` }} />
                      <View className="h-full bg-clay-400" style={{ width: `${row.total ? (row.ready / row.total) * 100 : 0}%` }} />
                    </View>
                    <Text className="text-[13px] tabular-nums text-ink-500">{`${row.entered}/${row.total} marks entered · ${row.published}/${row.total} published`}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
          {unscheduled.map((c, index) => (
            <View key={c.id} className={`flex-row items-center gap-3 px-4 py-3.5 ${index || rows.length ? "border-t border-ink-100" : ""}`}>
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-semibold text-ink-600">{c.label}</Text>
                <Text className="text-[13px] text-ink-500">Not scheduled</Text>
              </View>
              {canRun ? <RowButton label="Schedule" onPress={() => onSchedule([c.id])} /> : null}
            </View>
          ))}
        </View>
      ) : null}

      {rows.length && !compact ? (
        (
          <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
            <View className="flex-row items-center gap-4 border-b border-ink-100 bg-ink-50/60 px-4 py-2">
              <Text className="w-20 text-[11px] font-medium uppercase tracking-wide text-ink-500">Class</Text>
              <Text className="w-16 text-[11px] font-medium uppercase tracking-wide text-ink-500">Papers</Text>
              <Text className="w-40 text-[11px] font-medium uppercase tracking-wide text-ink-500">Marks entered</Text>
              <Text className="w-40 text-[11px] font-medium uppercase tracking-wide text-ink-500">Published</Text>
              <Text className="flex-1 text-right text-[11px] font-medium uppercase tracking-wide text-ink-500">Next step</Text>
              <View className="w-4" />
            </View>
            {rows.map((row, index) => (
              <Pressable
                key={row.klass.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${row.klass.label}`}
                onPress={() => onOpenClass(row.klass.id, row.s.id)}
                className={`min-h-[56px] flex-row items-center gap-4 px-4 py-2.5 hover:bg-ink-50/60 ${index ? "border-t border-ink-100" : ""}`}
              >
                <Text className="w-20 text-[14px] font-semibold text-ink-900">{row.klass.label}</Text>
                <Text className="w-16 text-[13px] tabular-nums text-ink-700">{row.total}</Text>
                <View className="w-40">
                  <Meter value={row.entered} total={row.total} tone="blue" />
                </View>
                <View className="w-40">
                  <Meter value={row.published} total={row.total} tone="green" />
                </View>
                <View className="flex-1 flex-row justify-end">
                  <NextStep row={row} />
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </Pressable>
            ))}
          </View>
        )
      ) : null}

      {!mine.length ? (
        <View className={`items-center rounded-xl border border-ink-200 bg-white ${compact ? "px-5 py-8" : "px-8 py-12"}`}>
          <View className="h-12 w-12 items-center justify-center rounded-full bg-clay-50">
            <Ionicons name="calendar-outline" size={22} color="#2563EB" />
          </View>
          <Text className="mt-4 text-center text-[17px] font-semibold text-ink-900">{`${item.name} isn't scheduled yet`}</Text>
          <Text className="mt-1.5 max-w-[440px] text-center text-[14px] leading-5 text-ink-600">
            Pick the classes and the exam dates. Each subject teacher gets one message with their papers and dates.
          </Text>
          <View className="mt-4 max-w-[520px] flex-row flex-wrap justify-center gap-1.5">
            {classes.map((c) => (
              <View key={c.id} className="rounded-full bg-ink-100 px-2.5 py-1">
                <Text className="text-[12px] font-medium text-ink-700">{c.label}</Text>
              </View>
            ))}
          </View>
          {canRun ? (
            <View className={`mt-6 items-center gap-2 ${compact ? "self-stretch" : ""}`}>
              <Pressable
                accessibilityRole="button"
                onPress={() => onSchedule(null)}
                className={`h-11 flex-row items-center justify-center gap-2 rounded-lg bg-clay-500 px-6 hover:bg-clay-600 ${compact ? "self-stretch" : ""}`}
              >
                <Ionicons name="calendar-outline" size={16} color="#fff" />
                <Text className="text-[15px] font-semibold text-white">{`Schedule ${item.name}`}</Text>
              </Pressable>
              {past ? <RowButton label="Add old marks instead" quiet onPress={onAddOldMarks} /> : null}
            </View>
          ) : (
            <Text className="mt-5 text-[13px] text-ink-500">The exam office schedules this.</Text>
          )}
        </View>
      ) : unscheduled.length && !compact ? (
        <View className="flex-row flex-wrap items-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-3">
          <Text className="mr-1 text-[13px] font-medium text-ink-700">Not scheduled yet</Text>
          {unscheduled.map((c) =>
            canRun ? (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`Schedule ${c.label}`}
                onPress={() => onSchedule([c.id])}
                className="flex-row items-center gap-1 rounded-full border border-ink-200 px-2.5 py-1 hover:border-clay-400 hover:bg-clay-50"
              >
                <Ionicons name="add" size={13} color="#2563EB" />
                <Text className="text-[12px] font-medium text-ink-800">{c.label}</Text>
              </Pressable>
            ) : (
              <View key={c.id} className="rounded-full bg-ink-100 px-2.5 py-1">
                <Text className="text-[12px] font-medium text-ink-700">{c.label}</Text>
              </View>
            )
          )}
        </View>
      ) : null}
    </View>
  );
}

function RowButton({
  label,
  onPress,
  primary,
  quiet,
  icon,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  quiet?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`h-8 flex-row items-center justify-center gap-1.5 rounded-md px-3 ${
        primary ? "bg-clay-500" : quiet ? "" : "border border-ink-200 bg-white"
      } ${disabled ? "opacity-50" : ""}`}
    >
      {icon ? <Ionicons name={icon} size={14} color={primary ? "#fff" : "#334155"} /> : null}
      <Text className={`text-[13px] font-medium ${primary ? "text-white" : quiet ? "text-ink-600" : "text-ink-800"}`}>{label}</Text>
    </Pressable>
  );
}

function cellProblem(raw: string, max: number) {
  const value = raw.trim();
  if (!value || /^(ab|a|absent)$/i.test(value)) return "";
  const n = Number(value);
  if (Number.isNaN(n) || n < 0) return "Not a mark";
  if (n > max) return `More than ${max}`;
  return "";
}

/** Add old marks: one class at a time, type in the grid or fill the Excel. Every step is optional. */
export function PastMarksModal({
  open,
  item,
  sessionId,
  sessionStart,
  classes,
  students,
  series,
  token,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: YearPlanItem | null;
  sessionId: string;
  sessionStart?: string;
  classes: YearClass[];
  students: YearStudent[];
  series: YearSeries[];
  token: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { width } = useWindowDimensions();
  const narrow = width < 720;
  const [classId, setClassId] = useState("");
  const [examDate, setExamDate] = useState("");
  const [maxMarks, setMaxMarks] = useState("80");
  const [values, setValues] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "upload" | "download">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const klass = classes.find((c) => c.id === classId) || null;
  const subjects = klass?.subjects ?? [];
  const roster = useMemo(
    () =>
      students
        .filter((s) => s.classId === classId)
        .sort((a, b) => (a.rollNumber ?? 9999) - (b.rollNumber ?? 9999) || a.name.localeCompare(b.name)),
    [students, classId]
  );
  const max = Math.max(1, Math.round(Number(maxMarks) || 0));
  const filled = Object.entries(values).filter(([, v]) => v.trim()).length;
  const totalCells = roster.length * subjects.length;
  const problems = Object.values(values).filter((v) => cellProblem(v, max)).length;
  const addedFor = new Set(
    series.filter((s) => s.planItemId === item?.id && s.exams.length && s.exams.every((e) => e.workflowStatus === "PUBLISHED")).map((s) => s.classId)
  );

  useEffect(() => {
    if (!open || !item) return;
    setClassId((cur) => cur || classes[0]?.id || "");
    setExamDate(defaultExamDate(item, sessionStart));
    setMaxMarks(String(item.maxMarks || 80));
    setError("");
    setNotice("");
  }, [open, item, sessionStart, classes]);

  useEffect(() => {
    if (!open || !item || !classId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setNotice("");
    setDirty(false);
    act<{ ok: true; values: Record<string, string>; live: boolean; maxMarks: number }>(token, "pastExamMarks", {
      sessionId,
      classId,
      planItemId: item.id,
    })
      .then((res) => {
        if (cancelled) return;
        setValues(res.values || {});
        setLive(Boolean(res.live));
        if (res.maxMarks) setMaxMarks(String(res.maxMarks));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load marks."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, item, classId, sessionId, token]);

  function setCell(studentId: string, subjectId: string, value: string) {
    setDirty(true);
    setValues((cur) => ({ ...cur, [`${studentId}:${subjectId}`]: value.replace(/[^0-9.aAbBsSeEnNtT]/g, "").slice(0, 6) }));
  }

  async function download() {
    if (!item || !classId) return;
    setBusy("download");
    setError("");
    try {
      const q = new URLSearchParams({ sessionId, classId, planItemId: item.id, maxMarks: String(max) });
      await downloadAuthedFile(
        `${apiBase()}/api/v1/exams/past-template?${q.toString()}`,
        token,
        `${item.name}-${klass?.label || "class"}-marks.xlsx`.replace(/\s+/g, "-")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download the sheet.");
    } finally {
      setBusy("");
    }
  }

  async function upload() {
    if (!item || !classId) return;
    setError("");
    setNotice("");
    try {
      const file = await pickFile(".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      if (!file) return;
      setBusy("upload");
      const uploaded = await uploadFile(token, file, { kind: "examMarks" });
      const res = await act<{ ok: true; values: Record<string, string>; unmatched: string[]; matchedSubjects: number; totalSubjects: number }>(
        token,
        "readPastExamSheet",
        { sessionId, classId, planItemId: item.id, uploadPath: uploaded.path }
      );
      setValues((cur) => ({ ...cur, ...res.values }));
      setDirty(true);
      const count = Object.keys(res.values).length;
      const parts = [`${count} marks filled from the sheet. Check them, then press Save.`];
      if (res.unmatched.length) parts.push(`${res.unmatched.length} row${res.unmatched.length === 1 ? "" : "s"} didn't match a student (${res.unmatched.slice(0, 3).join(", ")}${res.unmatched.length > 3 ? "…" : ""}).`);
      if (res.matchedSubjects < res.totalSubjects) parts.push(`${res.totalSubjects - res.matchedSubjects} subject column${res.totalSubjects - res.matchedSubjects === 1 ? " was" : "s were"} not found.`);
      setNotice(parts.join(" "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the sheet.");
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!item || !classId) return;
    if (problems) {
      setError(`Fix the ${problems} red mark${problems === 1 ? "" : "s"} first.`);
      return;
    }
    setBusy("save");
    setError("");
    try {
      const res = await act<{ ok: true; saved: number; subjects: number }>(token, "savePastExamMarks", {
        sessionId,
        classId,
        planItemId: item.id,
        examDate,
        maxMarks: max,
        values,
      });
      setDirty(false);
      setNotice(`Saved. ${res.saved} marks for ${klass?.label} are now on report cards. Pick another class or close.`);
      onSaved(`${item.name} · ${klass?.label}: ${res.saved} marks saved across ${res.subjects} subject${res.subjects === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save marks.");
    } finally {
      setBusy("");
    }
  }

  if (!item) return null;

  return (
    <Modal
      open={open}
      large
      title={`Add old marks · ${item.name}`}
      onClose={onClose}
      footer={
        <View className={`${narrow ? "gap-3" : "flex-row items-center justify-between gap-3"}`}>
          <Text className="text-xs text-ink-500">
            {totalCells ? `${filled} of ${totalCells} marks filled` : ""}
            {problems ? <Text className="font-medium text-red-700">{` · ${problems} to fix`}</Text> : null}
            {" · Empty is fine — add the rest later."}
          </Text>
          <View className="flex-row items-center justify-end gap-2">
            <RowButton label="Close" quiet onPress={onClose} />
            <Pressable
              accessibilityRole="button"
              disabled={busy === "save" || live || !classId || !dirty}
              onPress={() => void save()}
              className={`h-9 flex-row items-center gap-2 rounded-md bg-clay-500 px-4 ${busy === "save" || live || !classId || !dirty ? "opacity-50" : ""}`}
            >
              {busy === "save" ? <ActivityIndicator size="small" color="#fff" /> : null}
              <Text className="text-[13px] font-semibold text-white">Save marks</Text>
            </Pressable>
          </View>
        </View>
      }
    >
      <View className="gap-4">
        <View className="flex-row items-start gap-2.5 rounded-lg bg-blue-50 px-3 py-2.5">
          <Ionicons name="information-circle-outline" size={18} color="#2563EB" />
          <Text className="min-w-0 flex-1 text-[13px] leading-5 text-ink-800">
            Optional. Add {item.name} marks only if you want them on report cards. You can skip this and schedule new exams right away.
          </Text>
        </View>

        <View className="gap-2">
          <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500">Class</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-1.5">
              {classes.map((c) => {
                const on = c.id === classId;
                const added = addedFor.has(c.id);
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => setClassId(c.id)}
                    className={`h-8 flex-row items-center gap-1.5 rounded-full border px-3 ${on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}
                  >
                    {added ? <Ionicons name="checkmark-circle" size={13} color={on ? "#fff" : "#16A34A"} /> : null}
                    <Text className={`text-[13px] font-medium ${on ? "text-white" : "text-ink-800"}`}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        </View>

        <View className={`${narrow ? "gap-3" : "flex-row items-end gap-4"}`}>
          <View className={narrow ? "" : "w-56"}>
            <Text className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-500">When it happened</Text>
            <DateField plain value={examDate} onChange={setExamDate} />
          </View>
          <View className="w-28">
            <Text className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-500">Out of</Text>
            <TextInput
              value={maxMarks}
              onChangeText={(v) => {
                setDirty(true);
                setMaxMarks(v.replace(/\D/g, "").slice(0, 4));
              }}
              keyboardType="number-pad"
              className="h-11 rounded-md border border-ink-200 bg-white px-3 text-sm text-ink-900"
            />
          </View>
          <View className={`flex-1 flex-row flex-wrap items-center gap-2 ${narrow ? "" : "justify-end"}`}>
            <RowButton label={busy === "download" ? "Preparing…" : "Download Excel"} icon="download-outline" disabled={!classId || !!busy} onPress={() => void download()} />
            <RowButton label={busy === "upload" ? "Reading…" : "Upload filled Excel"} icon="cloud-upload-outline" disabled={!classId || !!busy || live} onPress={() => void upload()} />
          </View>
        </View>

        {notice ? (
          <View className="flex-row items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <Ionicons name="checkmark-circle-outline" size={16} color="#047857" />
            <Text className="min-w-0 flex-1 text-[13px] leading-5 text-emerald-900">{notice}</Text>
          </View>
        ) : null}
        {error ? (
          <View className="flex-row items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
            <Ionicons name="alert-circle-outline" size={16} color="#B91C1C" />
            <Text className="min-w-0 flex-1 text-[13px] leading-5 text-red-800">{error}</Text>
          </View>
        ) : null}

        {live ? (
          <View className="items-center rounded-lg border border-ink-200 px-6 py-8">
            <Text className="text-sm font-semibold text-ink-900">{item.name} is scheduled for {klass?.label}</Text>
            <Text className="mt-1 text-center text-[13px] text-ink-600">Its teachers enter marks from each paper, so old marks can't be added here.</Text>
          </View>
        ) : loading ? (
          <View className="items-center py-10">
            <ActivityIndicator color="#2563EB" />
          </View>
        ) : !subjects.length ? (
          <View className="items-center rounded-lg border border-ink-200 px-6 py-8">
            <Text className="text-sm font-semibold text-ink-900">No subjects for {klass?.label || "this class"}</Text>
            <Text className="mt-1 text-center text-[13px] text-ink-600">Add the class's subjects in Settings → Subjects first.</Text>
          </View>
        ) : !roster.length ? (
          <View className="items-center rounded-lg border border-ink-200 px-6 py-8">
            <Text className="text-sm font-semibold text-ink-900">No students in {klass?.label}</Text>
          </View>
        ) : (
          <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
            <View className="overflow-hidden rounded-lg border border-ink-200">
              <View className="flex-row border-b border-ink-200 bg-ink-50">
                <Text className="w-14 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-500">Roll</Text>
                <Text className="w-48 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-ink-500">Student</Text>
                {subjects.map((subject) => (
                  <Text key={subject.id} numberOfLines={1} className="w-24 px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-700">
                    {subject.code || subject.name}
                  </Text>
                ))}
              </View>
              {roster.map((student, rowIndex) => (
                <View key={student.id} className={`flex-row items-center ${rowIndex % 2 ? "bg-ink-50/40" : "bg-white"} ${rowIndex ? "border-t border-ink-100" : ""}`}>
                  <Text className="w-14 px-3 py-1.5 text-[13px] tabular-nums text-ink-500">{student.rollNumber ?? "—"}</Text>
                  <Text className="w-48 px-3 py-1.5 text-[13px] text-ink-900" numberOfLines={1}>{student.name}</Text>
                  {subjects.map((subject) => {
                    const raw = values[`${student.id}:${subject.id}`] || "";
                    const problem = cellProblem(raw, max);
                    const absent = /^(ab|a|absent)$/i.test(raw.trim());
                    return (
                      <View key={subject.id} className="w-24 px-2 py-1">
                        <TextInput
                          accessibilityLabel={`${student.name} ${subject.name} marks`}
                          value={raw}
                          placeholder="–"
                          placeholderTextColor="#CBD5E1"
                          onChangeText={(v) => setCell(student.id, subject.id, v)}
                          className={`h-8 rounded border text-center text-[13px] tabular-nums ${
                            problem ? "border-red-400 bg-red-50 text-red-700" : absent ? "border-amber-200 bg-amber-50 text-amber-800" : "border-ink-200 bg-white text-ink-900"
                          }`}
                        />
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        )}
        {!live && subjects.length && roster.length ? (
          <Text className="text-xs text-ink-500">Type a number, or AB for absent. Red means the mark is more than {max} or not a number.</Text>
        ) : null}
      </View>
    </Modal>
  );
}

