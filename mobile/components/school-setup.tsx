import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal as RnModal, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Button, Chip, ChipScroller, Field, Input, Modal } from "./ui";
import { UploadCsvPanel } from "./upload-csv-panel";
import { pickFile, type PickedFile } from "../lib/upload";
import { formatSubjectLabel, normalizeSubjectCode } from "../lib/subject-label";

export const DEFAULT_SUBJECT_ENTRIES = [
  { code: "ENG", name: "English" },
  { code: "MAT", name: "Mathematics" },
  { code: "SCI", name: "Science" },
  { code: "HIN", name: "Hindi" },
  { code: "SST", name: "Social Studies" },
  { code: "CSC", name: "Computer" },
  { code: "ART", name: "Art" },
  { code: "PED", name: "Physical Education" },
  { code: "PHY", name: "Physics" },
  { code: "CHE", name: "Chemistry" },
  { code: "BIO", name: "Biology" },
];

export const DEFAULT_SUBJECTS = DEFAULT_SUBJECT_ENTRIES.map((row) => row.name);

export type SubjectCatalogEntry = { code: string; name: string; previousCode?: string; previousName?: string };

type ClassSubjectDraft = { id?: string; code: string; previousCode: string; name: string; periods: string };

/** What counts as "changed" for the unsaved-changes guard: which subjects are on the class and their periods. */
function draftSignature(rows: ClassSubjectDraft[] | undefined) {
  return (rows || []).map((row) => `${row.id || row.previousCode || row.code}:${row.code}:${row.periods}`).join("|");
}

/** Grade part of a catalog code: "ENG-2" → "2", "MATH6" → "6", "ENG" → "" (fits any grade). */
function codeGradeSuffix(code: string) {
  const normalized = normalizeSubjectCode(code);
  const dashed = normalized.match(/-([A-Z0-9]+)$/);
  if (dashed) return dashed[1];
  const digits = normalized.match(/^[A-Z]+(\d+)$/);
  return digits ? digits[1] : "";
}

function sameGrade(a: string, b: string) {
  const x = a.trim().toUpperCase();
  const y = b.trim().toUpperCase();
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) return Number(x) === Number(y);
  return x === y;
}

/**
 * Catalog codes that belong to a grade: its own grade code (ENG-2 for Class 2), or a plain code (ENG)
 * when the catalog has no grade-specific code for that subject.
 */
function catalogFitsGrade(entry: SubjectCatalogEntry, grade: string, all: SubjectCatalogEntry[]) {
  if (!grade) return true;
  const suffix = codeGradeSuffix(entry.code);
  if (suffix) return sameGrade(suffix, grade);
  const name = entry.name.trim().toLowerCase();
  return !all.some((other) => other.name.trim().toLowerCase() === name && sameGrade(codeGradeSuffix(other.code) || "-", grade));
}

function PeriodStepper({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const n = parsePeriods(value) || 0;
  return (
    <View className="flex-row items-center justify-center gap-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Fewer ${label} periods`}
        disabled={n <= 1}
        onPress={() => onChange(String(Math.max(1, n - 1)))}
        className={`h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white ${n <= 1 ? "opacity-40" : ""}`}
      >
        <Text className="text-base text-ink-700">−</Text>
      </Pressable>
      <TextInput
        accessibilityLabel={`${label} periods per week`}
        keyboardType="number-pad"
        value={value}
        onChangeText={(next) => onChange(next.replace(/\D/g, "").slice(0, 2))}
        className="h-8 w-10 rounded-md border border-ink-200 bg-white text-center text-sm font-semibold text-ink-900"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`More ${label} periods`}
        disabled={n >= 99}
        onPress={() => onChange(String(Math.min(99, n + 1)))}
        className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white"
      >
        <Text className="text-base text-ink-700">+</Text>
      </Pressable>
    </View>
  );
}

function CatalogCodeRow({
  code,
  name,
  usage,
  unused,
  label,
  first,
  onPress,
}: {
  code: string;
  name: string;
  usage: string;
  unused: boolean;
  label: string;
  first: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`flex-row items-center gap-3 px-3 py-2.5 ${first ? "" : "border-t border-ink-100"}`}
    >
      <View className="min-w-0 flex-1">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-sm font-semibold text-ink-900">{name || code}</Text>
        </View>
        <Text className={`mt-0.5 text-xs ${unused ? "text-amber-700" : "text-ink-700"}`} numberOfLines={1}>
          {usage}
        </Text>
      </View>
      <Text className="text-xs font-medium text-clay-600">Edit</Text>
    </Pressable>
  );
}

function SubjectNameWithCode({ code, name }: { code: string; name: string }) {
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      <Text className="text-sm font-semibold text-ink-900">{name || code}</Text>
    </View>
  );
}

function classGrade(klass: { name?: string; label: string }) {
  return (klass.name || klass.label.split("-")[0] || "").trim();
}

export function syncGradeSubjectDrafts(
  drafts: Record<string, ClassSubjectDraft[]>,
  classes: { id: string; name?: string; label: string }[],
  selectedId: string,
  nextRows: ClassSubjectDraft[]
) {
  const selected = classes.find((klass) => klass.id === selectedId);
  if (!selected) return { ...drafts, [selectedId]: nextRows };
  const grade = classGrade(selected);
  const next = { ...drafts };
  for (const klass of classes) {
    if (classGrade(klass) !== grade) continue;
    if (klass.id === selectedId) {
      next[klass.id] = nextRows;
      continue;
    }
    const current = next[klass.id] || [];
    next[klass.id] = nextRows.map((row) => {
      const match =
        current.find((item) => item.code === row.code) ||
        current.find((item) => item.previousCode && item.previousCode === row.previousCode) ||
        current.find((item) => item.name.trim().toLowerCase() === row.name.trim().toLowerCase());
      return {
        ...row,
        id: match?.id,
        previousCode: match?.previousCode || row.previousCode || row.code,
      };
    });
  }
  return next;
}

function asCatalog(catalog: (string | SubjectCatalogEntry)[]): SubjectCatalogEntry[] {
  const rows: SubjectCatalogEntry[] = [];
  const used = new Set<string>();
  for (const item of catalog) {
    const name = typeof item === "string" ? item.trim() : String(item.name || "").trim();
    if (!name || used.has(name.toLowerCase())) continue;
    used.add(name.toLowerCase());
    const found = DEFAULT_SUBJECT_ENTRIES.find((row) => row.name.toLowerCase() === name.toLowerCase());
    const code =
      (typeof item === "object" && normalizeSubjectCode(item.code)) ||
      found?.code ||
      normalizeSubjectCode(name).replace(/[^A-Z0-9]/g, "").slice(0, 12);
    rows.push({
      code,
      name,
      previousCode: typeof item === "object" ? item.previousCode || code : code,
      previousName: typeof item === "object" ? item.previousName || name : name,
    });
  }
  return rows;
}

function clientCodeOk(raw: string) {
  const code = normalizeSubjectCode(raw);
  return /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code) && code.length >= 2 && code.length <= 12;
}

const ROOM_KIND_LABEL: Record<string, string> = {
  CLASSROOM: "Classroom",
  LAB: "Lab",
  GROUND: "Ground",
  OTHER: "Other",
};

const ALL_WEEKDAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 7, label: "Sun" },
];

type ClockPeriodRow = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isBreak: boolean;
  sortOrder?: number;
};

function nextPeriodName(rows: { name: string; isBreak?: boolean }[]) {
  const highest = rows.reduce((max, row) => {
    if (row.isBreak) return max;
    const match = row.name.match(/\d+/);
    return match ? Math.max(max, Number(match[0])) : max;
  }, 0);
  return `Period ${highest + 1}`;
}

function periodsDraft(value?: number) {
  if (value == null || !Number.isFinite(value) || value <= 0) return "4";
  return String(Math.trunc(value));
}

function parsePeriods(value: string) {
  const n = Number(value);
  if (!value.trim()) return 0;
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

function csvEscape(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((items) => items.some(Boolean));
}

function SaveFlash({ at, flash }: { at: "catalog" | "class"; flash: { at: "catalog" | "class"; kind: "ok" | "err"; text: string } | null }) {
  if (!flash || flash.at !== at) return null;
  if (flash.kind === "ok") {
    return (
      <View className="rounded-md border border-clay-500/40 bg-blue-50 px-3 py-2">
        <Text className="text-sm text-clay-600">{flash.text}</Text>
      </View>
    );
  }
  return <Text className="text-sm text-red-700">{flash.text}</Text>;
}

function IconButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="h-11 w-11 items-center justify-center rounded-md border border-ink-200 bg-white"
    >
      <Ionicons name={icon} size={20} color="#1f5feb" />
    </Pressable>
  );
}

function clockMin(value: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function clockHm(minutes: number) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function clock12(value: string) {
  const m = clockMin(value);
  if (m === null) return value || "—";
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Keeps the day continuous: each row starts when the previous one ends, keeping its own length. */
function chainFrom(rows: ClockPeriodRow[], index: number) {
  const next = rows.map((row) => ({ ...row }));
  for (let i = Math.max(1, index + 1); i < next.length; i += 1) {
    const prevEnd = clockMin(next[i - 1].endsAt);
    const start = clockMin(next[i].startsAt);
    const end = clockMin(next[i].endsAt);
    if (prevEnd === null || start === null || end === null) continue;
    const length = Math.max(5, end - start);
    next[i].startsAt = clockHm(prevEnd);
    next[i].endsAt = clockHm(prevEnd + length);
  }
  return next;
}

const LENGTH_CHOICES = [30, 35, 40, 45, 50];
const BREAK_CHOICES = [10, 15, 20, 30, 45];

type ClockApply = (
  payload: { weekdays: number[]; periods: ClockPeriodRow[]; force?: boolean },
  message: string
) => Promise<void>;

let newRowSeq = 0;
function newRowId() {
  newRowSeq += 1;
  return `new-${Date.now()}-${newRowSeq}`;
}

function rowLength(row?: ClockPeriodRow | null) {
  if (!row) return 0;
  const s = clockMin(row.startsAt);
  const e = clockMin(row.endsAt);
  return s !== null && e !== null ? e - s : 0;
}

/** The usual period length in this school (most common), for new periods. */
function typicalLength(rows: ClockPeriodRow[]) {
  const counts = new Map<number, number>();
  for (const r of rows) if (!r.isBreak && rowLength(r) > 0) counts.set(rowLength(r), (counts.get(rowLength(r)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 40;
}

/** "Period 1, Period 2 …" stay in order after adding / removing; custom names are kept. */
function renumber(rows: ClockPeriodRow[]) {
  let n = 0;
  return rows.map((r) => {
    if (r.isBreak) return r;
    n += 1;
    return /^period\s*\d+$/i.test(r.name.trim()) || !r.name.trim() ? { ...r, name: `Period ${n}` } : r;
  });
}

function dayEnd(rows: ClockPeriodRow[]) {
  return rows.length ? rows[rows.length - 1].endsAt : "";
}

function endNote(before: ClockPeriodRow[], after: ClockPeriodRow[]) {
  const a = clockMin(dayEnd(before));
  const b = clockMin(dayEnd(after));
  if (b === null) return "";
  const diff = a === null ? 0 : b - a;
  return ` School now ends ${clock12(dayEnd(after))}${diff ? ` (${diff > 0 ? "+" : "−"}${Math.abs(diff)} min)` : ""}.`;
}

type QuickBreak = { after: number; name: string; minutes: number };
type QuickPlan = { start: string; length: number; count: number; gap: number; breaks: QuickBreak[] };

const QUICK_PRESETS: { label: string; plan: QuickPlan }[] = [
  { label: "8 × 40 min", plan: { start: "09:00", length: 40, count: 8, gap: 0, breaks: [{ after: 3, name: "Recess", minutes: 20 }, { after: 6, name: "Lunch", minutes: 30 }] } },
  { label: "7 × 45 min", plan: { start: "08:30", length: 45, count: 7, gap: 0, breaks: [{ after: 3, name: "Recess", minutes: 15 }, { after: 5, name: "Lunch", minutes: 30 }] } },
  { label: "6 × 50 min", plan: { start: "09:00", length: 50, count: 6, gap: 0, breaks: [{ after: 3, name: "Lunch", minutes: 30 }] } },
];

function buildDay(plan: QuickPlan) {
  const start = clockMin(plan.start) ?? 9 * 60;
  const out: { name: string; startsAt: string; endsAt: string; isBreak: boolean }[] = [];
  let t = start;
  for (let i = 1; i <= plan.count; i += 1) {
    out.push({ name: `Period ${i}`, startsAt: clockHm(t), endsAt: clockHm(t + plan.length), isBreak: false });
    t += plan.length;
    const brk = plan.breaks.find((b) => b.after === i && b.minutes > 0);
    if (brk && i < plan.count) {
      out.push({ name: brk.name || "Break", startsAt: clockHm(t), endsAt: clockHm(t + brk.minutes), isBreak: true });
      t += brk.minutes;
    } else if (i < plan.count) {
      t += plan.gap;
    }
  }
  return out;
}

/** Reuse existing rows (so lessons stay with Period 1, 2 …): teaching rows map to teaching rows, breaks to breaks. */
function mergeDay(existing: ClockPeriodRow[], target: ReturnType<typeof buildDay>) {
  const teach = existing.filter((r) => !r.isBreak);
  const breaks = existing.filter((r) => r.isBreak);
  let ti = 0;
  let bi = 0;
  return target.map((t) => {
    const reuse = t.isBreak ? breaks[bi++] : teach[ti++];
    return { id: reuse?.id || newRowId(), sortOrder: undefined, ...t };
  });
}

function QuickSetup({
  rows,
  phone,
  onApply,
}: {
  rows: ClockPeriodRow[];
  phone: boolean;
  onApply: (rows: ClockPeriodRow[], message: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(!rows.length);
  const [plan, setPlan] = useState<QuickPlan>(() => {
    const teaching = rows.filter((r) => !r.isBreak);
    if (!teaching.length) return QUICK_PRESETS[0].plan;
    const breaks: QuickBreak[] = [];
    let n = 0;
    for (const r of rows) {
      if (r.isBreak) breaks.push({ after: n, name: r.name, minutes: rowLength(r) || 15 });
      else n += 1;
    }
    return { start: rows[0].startsAt, length: typicalLength(rows), count: teaching.length, gap: 0, breaks };
  });
  const [busy, setBusy] = useState(false);
  const day = buildDay(plan);
  const ends = day.length ? day[day.length - 1].endsAt : plan.start;
  const total = (clockMin(ends) ?? 0) - (clockMin(plan.start) ?? 0);
  const patch = (p: Partial<QuickPlan>) => setPlan((cur) => ({ ...cur, ...p }));
  const setBreak = (i: number, p: Partial<QuickBreak>) => patch({ breaks: plan.breaks.map((b, j) => (j === i ? { ...b, ...p } : b)) });
  const chip = (on: boolean) => `h-9 justify-center rounded-full border px-3 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`;
  const chipText = (on: boolean) => `text-sm font-semibold ${on ? "text-white" : "text-ink-800"}`;
  const stepper = (value: number, set: (v: number) => void, min: number, max: number) => (
    <View className="flex-row items-center overflow-hidden rounded-lg border border-ink-200 bg-white">
      <Pressable onPress={() => set(Math.max(min, value - 1))} className="h-9 w-9 items-center justify-center">
        <Ionicons name="remove" size={16} color="#1F45C7" />
      </Pressable>
      <Text className="w-8 text-center text-sm font-semibold text-ink-900">{value}</Text>
      <Pressable onPress={() => set(Math.min(max, value + 1))} className="h-9 w-9 items-center justify-center">
        <Ionicons name="add" size={16} color="#1F45C7" />
      </Pressable>
    </View>
  );
  const totalMinutes = Math.max(1, total);

  return (
    <View className="overflow-hidden rounded-2xl border border-[#1F45C7]/30 bg-[#F5F8FF]">
      <Pressable onPress={() => setOpen((v) => !v)} className="flex-row items-center gap-2 px-4 py-3" accessibilityRole="button">
        <Ionicons name="flash-outline" size={17} color="#1F45C7" />
        <View className="flex-1">
          <Text className="text-sm font-semibold text-ink-900">Quick setup</Text>
          <Text className="text-xs text-ink-600">Start time, period length and breaks. We fill the whole day.</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color="#3d4f66" />
      </Pressable>
      {open ? (
        <View className="gap-4 border-t border-[#1F45C7]/15 px-4 py-4">
          <View className="flex-row flex-wrap gap-2">
            {QUICK_PRESETS.map((p) => (
              <Pressable key={p.label} onPress={() => setPlan(p.plan)} className="h-8 justify-center rounded-full border border-ink-200 bg-white px-3">
                <Text className="text-xs font-semibold text-ink-800">{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <View className={phone ? "gap-3" : "flex-row flex-wrap gap-6"}>
            <View className="gap-1.5">
              <Text className="text-xs font-medium text-ink-700">School starts (24h)</Text>
              <Input value={plan.start} onChangeText={(v) => patch({ start: v })} keyboardType="numbers-and-punctuation" className="h-10 w-28" />
            </View>
            <View className="gap-1.5">
              <Text className="text-xs font-medium text-ink-700">Periods a day</Text>
              {stepper(plan.count, (count) => patch({ count }), 1, 14)}
            </View>
            <View className="gap-1.5">
              <Text className="text-xs font-medium text-ink-700">Period length</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {LENGTH_CHOICES.map((m) => (
                  <Pressable key={m} onPress={() => patch({ length: m })} className={chip(plan.length === m)}>
                    <Text className={chipText(plan.length === m)}>{m}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View className="gap-1.5">
              <Text className="text-xs font-medium text-ink-700">Gap between periods</Text>
              <View className="flex-row gap-1.5">
                {[0, 5].map((m) => (
                  <Pressable key={m} onPress={() => patch({ gap: m })} className={chip(plan.gap === m)}>
                    <Text className={chipText(plan.gap === m)}>{m ? `${m} min` : "None"}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>

          <View className="gap-2">
            <Text className="text-xs font-medium text-ink-700">Breaks</Text>
            {plan.breaks.map((b, i) => (
              <View key={i} className="flex-row flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
                <Ionicons name={/lunch/i.test(b.name) ? "restaurant-outline" : "cafe-outline"} size={15} color="#B45309" />
                <Text className="text-xs text-amber-900">After period</Text>
                {stepper(b.after, (after) => setBreak(i, { after }), 1, Math.max(1, plan.count - 1))}
                <Input value={b.name} onChangeText={(name) => setBreak(i, { name })} className="h-9 w-28" />
                <View className="flex-row gap-1">
                  {BREAK_CHOICES.map((m) => (
                    <Pressable key={m} onPress={() => setBreak(i, { minutes: m })} className={`h-8 justify-center rounded-full border px-2.5 ${b.minutes === m ? "border-amber-600 bg-amber-600" : "border-amber-200 bg-white"}`}>
                      <Text className={`text-xs font-semibold ${b.minutes === m ? "text-white" : "text-amber-900"}`}>{m}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={() => patch({ breaks: plan.breaks.filter((_, j) => j !== i) })} hitSlop={8} accessibilityLabel="Remove break">
                  <Ionicons name="close" size={16} color="#92400e" />
                </Pressable>
              </View>
            ))}
            <Pressable
              onPress={() => patch({ breaks: [...plan.breaks, { after: Math.min(plan.count - 1, (plan.breaks.at(-1)?.after ?? 2) + 2), name: plan.breaks.length ? "Lunch" : "Recess", minutes: plan.breaks.length ? 30 : 15 }] })}
              className="self-start"
            >
              <Text className="text-xs font-semibold text-[#1F45C7]">+ Add break</Text>
            </Pressable>
          </View>

          <View className="gap-1.5">
            <View className="h-7 flex-row overflow-hidden rounded-lg bg-white">
              {day.map((d, i) => {
                const len = (clockMin(d.endsAt) ?? 0) - (clockMin(d.startsAt) ?? 0);
                return (
                  <View
                    key={i}
                    style={{ flex: Math.max(1, len) / totalMinutes }}
                    className={`items-center justify-center border-r border-white ${d.isBreak ? "bg-amber-300" : "bg-[#1F45C7]/80"}`}
                  >
                    <Text className="text-[9px] font-semibold text-white" numberOfLines={1}>
                      {d.isBreak ? "" : d.name.replace("Period ", "P")}
                    </Text>
                  </View>
                );
              })}
            </View>
            <Text className="text-xs text-ink-700">
              {clock12(plan.start)} – <Text className="font-semibold text-ink-900">{clock12(ends)}</Text> · {plan.count} periods
              {plan.breaks.length ? ` · ${plan.breaks.length} break${plan.breaks.length === 1 ? "" : "s"}` : ""}
            </Text>
          </View>
          {rows.length ? (
            <Text className="text-[11px] leading-4 text-ink-500">
              Replaces the bell times below. Lessons stay with Period 1, 2, 3 … at their new times.
            </Text>
          ) : null}
          <Button
            disabled={busy || clockMin(plan.start) === null}
            onPress={async () => {
              setBusy(true);
              try {
                await onApply(mergeDay(rows, day), `Bell times filled: ${plan.count} periods, ${clock12(plan.start)} – ${clock12(ends)}.`);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Filling…" : "Fill bell times"}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

/** Thin "+" line between two rows: add a period or break right here. */
function InsertLine({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Add a period or break here" className="h-5 flex-row items-center px-4">
      <View className="h-px flex-1 bg-ink-100" />
      <View className="mx-2 h-5 w-5 items-center justify-center rounded-full border border-ink-200 bg-white">
        <Ionicons name="add" size={12} color="#1F45C7" />
      </View>
      <View className="h-px flex-1 bg-ink-100" />
    </Pressable>
  );
}

export function ClockForm({
  weekdays,
  periods,
  onApply,
}: {
  weekdays: number[];
  periods: { id: string; name: string; start: string; end: string; isBreak?: boolean; sortOrder?: number }[];
  /** Saves the whole day (creates / updates / deletes / orders). Throws "LESSONS|names|count|classes" when lessons would be removed. */
  onApply: ClockApply;
}) {
  const [days, setDays] = useState<number[]>(weekdays);
  const [rows, setRows] = useState<ClockPeriodRow[]>(
    periods.map((p) => ({ id: p.id, name: p.name, startsAt: p.start, endsAt: p.end, isBreak: Boolean(p.isBreak), sortOrder: p.sortOrder }))
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [editId, setEditId] = useState("");
  const [confirm, setConfirm] = useState<{ rows: ClockPeriodRow[]; message: string; names: string; lessons: number; classes: number } | null>(null);
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const saved = periods.map((p) => `${p.id}|${p.name}|${p.start}|${p.end}|${p.isBreak ? 1 : 0}`).join(",");
  const dirty =
    rows.map((r) => `${r.id}|${r.name}|${r.startsAt}|${r.endsAt}|${r.isBreak ? 1 : 0}`).join(",") !== saved ||
    days.join(",") !== weekdays.join(",");
  const teaching = rows.filter((r) => !r.isBreak).length;
  const editing = rows.find((r) => r.id === editId) || null;
  const editIndex = rows.findIndex((r) => r.id === editId);

  async function commit(next: ClockPeriodRow[], message: string, force = false) {
    setError("");
    setBusy(true);
    try {
      await onApply({ weekdays: days, periods: next, force }, message);
      setRows(next);
      setConfirm(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save.";
      const m = /^LESSONS\|(.*)\|(\d+)\|(\d+)$/.exec(msg);
      if (m) setConfirm({ rows: next, message, names: m[1], lessons: Number(m[2]), classes: Number(m[3]) });
      else setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function insert(index: number, isBreak: boolean) {
    const prev = rows[index - 1];
    const start = prev ? prev.endsAt : rows[0]?.startsAt || "09:00";
    const s = clockMin(start) ?? 9 * 60;
    const length = isBreak ? 15 : typicalLength(rows);
    const row: ClockPeriodRow = { id: newRowId(), name: isBreak ? "Break" : "Period", startsAt: clockHm(s), endsAt: clockHm(s + length), isBreak };
    const next = renumber(chainFrom([...rows.slice(0, index), row, ...rows.slice(index)], index));
    setInsertAt(null);
    void commit(next, `${isBreak ? "Break" : next[index].name} added.${endNote(rows, next)}`);
  }

  function remove(index: number) {
    const gone = rows[index];
    let next = rows.filter((_, i) => i !== index);
    if (index === 0 && next.length) {
      const len = rowLength(next[0]) || 40;
      const s = clockMin(gone.startsAt) ?? 9 * 60;
      next[0] = { ...next[0], startsAt: clockHm(s), endsAt: clockHm(s + len) };
      next = chainFrom(next, 0);
    } else {
      next = chainFrom(next, index - 1);
    }
    next = renumber(next);
    setEditId("");
    void commit(next, `${gone.name} removed.${endNote(rows, next)}`);
  }

  /** Edit one row; later rows follow so the day stays continuous. */
  function patchRow(index: number, part: Partial<ClockPeriodRow>) {
    const next = rows.map((r, i) => (i === index ? { ...r, ...part } : r));
    setRows(chainFrom(next, index));
  }

  function setLength(index: number, minutes: number) {
    const s = clockMin(rows[index]?.startsAt);
    if (s === null) return;
    patchRow(index, { endsAt: clockHm(s + minutes) });
  }

  const daysPicker = phone ? (
    <View className="flex-row justify-between">
      {ALL_WEEKDAYS.map((d) => {
        const on = days.includes(d.n);
        return (
          <Pressable
            key={d.n}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={d.label}
            onPress={() => setDays(on ? days.filter((n) => n !== d.n) : [...days, d.n].sort((a, b) => a - b))}
            className={`h-10 w-10 items-center justify-center rounded-full ${on ? "bg-[#1F45C7]" : "border border-ink-200 bg-white"}`}
          >
            <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-600"}`}>{d.label.slice(0, 1)}</Text>
          </Pressable>
        );
      })}
    </View>
  ) : (
    <View className="flex-row flex-wrap gap-1.5">
      {ALL_WEEKDAYS.map((d) => (
        <Chip
          key={d.n}
          label={d.label}
          active={days.includes(d.n)}
          onPress={() => setDays(days.includes(d.n) ? days.filter((n) => n !== d.n) : [...days, d.n].sort((a, b) => a - b))}
        />
      ))}
    </View>
  );

  return (
    <View className="mt-3 gap-5">
      <View>
        <Text className="mb-2 text-sm font-semibold text-ink-900">School days</Text>
        {daysPicker}
      </View>

      <QuickSetup key={rows.length ? "has" : "none"} rows={rows} phone={phone} onApply={(next, message) => commit(next, message)} />

      <View>
        <View className="flex-row flex-wrap items-end justify-between gap-2">
          <View>
            <Text className="text-sm font-semibold text-ink-900">Bell times</Text>
            <Text className="mt-0.5 text-xs text-ink-600">
              {rows.length
                ? `${teaching} period${teaching === 1 ? "" : "s"} · ${clock12(rows[0].startsAt)} – ${clock12(dayEnd(rows))}`
                : "No periods yet. Use Quick setup above."}
            </Text>
          </View>
          {!phone ? (
            <Text className="text-[11px] text-ink-500">Tap ⊕ between rows to add a period or break there.</Text>
          ) : null}
        </View>
        <View className="mt-2 overflow-hidden rounded-2xl border border-ink-200 bg-white py-1">
          {rows.length ? <InsertLine onPress={() => setInsertAt(0)} /> : null}
          {rows.map((row, index) => {
            const length = rowLength(row);
            const line =
              phone ? (
                <Pressable
                  onPress={() => setEditId(row.id)}
                  className={`flex-row items-center gap-3 px-4 py-2.5 ${row.isBreak ? "bg-amber-50/60" : ""} active:bg-ink-50`}
                >
                  {row.isBreak ? (
                    <Ionicons name={/lunch/i.test(row.name) ? "restaurant-outline" : "cafe-outline"} size={15} color="#B45309" />
                  ) : null}
                  <Text className={`${row.isBreak ? "text-amber-900" : "w-[76px] text-ink-900"} text-[15px] font-medium`} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text className={`min-w-0 flex-1 text-sm ${row.isBreak ? "text-amber-900" : "text-ink-800"}`} numberOfLines={1}>
                    {clock12(row.startsAt)} – {clock12(row.endsAt)}
                  </Text>
                  <Text className={`text-xs ${row.isBreak ? "text-amber-800" : "text-ink-500"}`}>{length} min</Text>
                  <Ionicons name="chevron-forward" size={15} color={row.isBreak ? "#B45309" : "#94A3B8"} />
                </Pressable>
              ) : (
                <View className={`flex-row flex-wrap items-center gap-2 px-3 py-1.5 ${row.isBreak ? "bg-amber-50/60" : ""}`}>
                  <View className="min-w-[9rem] flex-1">
                    <Input value={row.name} onChangeText={(name) => patchRow(index, { name })} />
                  </View>
                  <View className="w-24">
                    <Input
                      value={row.startsAt}
                      onChangeText={(v) => {
                        const s = clockMin(v);
                        if (s === null || !/^\d{1,2}:\d{2}$/.test(v)) return setRows(rows.map((r, i) => (i === index ? { ...r, startsAt: v } : r)));
                        patchRow(index, { startsAt: clockHm(s), endsAt: clockHm(s + Math.max(5, length || 40)) });
                      }}
                    />
                  </View>
                  <View className="w-24">
                    <Input
                      value={row.endsAt}
                      onChangeText={(v) => {
                        if (clockMin(v) === null || !/^\d{1,2}:\d{2}$/.test(v)) return setRows(rows.map((r, i) => (i === index ? { ...r, endsAt: v } : r)));
                        patchRow(index, { endsAt: clockHm(clockMin(v)!) });
                      }}
                    />
                  </View>
                  <Text className="w-14 text-xs text-ink-500">{length > 0 ? `${length} min` : ""}</Text>
                  <Chip label="Break" active={row.isBreak} onPress={() => patchRow(index, { isBreak: !row.isBreak })} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${row.name}`}
                    onPress={() => remove(index)}
                    className="h-10 w-10 items-center justify-center rounded-md border border-ink-200 bg-white"
                  >
                    <Ionicons name="trash-outline" size={18} color="#3d4f66" />
                  </Pressable>
                </View>
              );
            return (
              <View key={row.id}>
                {line}
                <InsertLine onPress={() => setInsertAt(index + 1)} />
              </View>
            );
          })}
        </View>
        {!phone ? (
          <Text className="mt-2 text-[11px] text-ink-500">Change a time and the later periods move with it. Removing a period moves the rest earlier.</Text>
        ) : null}
      </View>

      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      <Button disabled={busy || !dirty} onPress={() => void commit(renumber(rows), "Bell times saved.")}>
        {busy ? "Saving…" : dirty ? "Save bell times" : "Saved"}
      </Button>

      {/* Add here: period or break */}
      <Modal open={insertAt !== null} title="Add here" onClose={() => setInsertAt(null)}>
        <View className="gap-2">
          <Text className="text-xs text-ink-600">
            {insertAt !== null && rows[insertAt - 1] ? `After ${rows[insertAt - 1].name} (${clock12(rows[insertAt - 1].endsAt)}).` : "At the start of the day."} Later rows move later.
          </Text>
          <Pressable onPress={() => insertAt !== null && insert(insertAt, false)} className="flex-row items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3">
            <Ionicons name="time-outline" size={18} color="#1F45C7" />
            <Text className="flex-1 text-sm font-semibold text-ink-900">Period</Text>
            <Text className="text-xs text-ink-500">{typicalLength(rows)} min</Text>
          </Pressable>
          <Pressable onPress={() => insertAt !== null && insert(insertAt, true)} className="flex-row items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
            <Ionicons name="cafe-outline" size={18} color="#B45309" />
            <Text className="flex-1 text-sm font-semibold text-amber-900">Break</Text>
            <Text className="text-xs text-amber-800">15 min</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Lessons would be removed */}
      <Modal
        open={Boolean(confirm)}
        title="Remove periods with lessons?"
        onClose={() => setConfirm(null)}
        footer={
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={() => setConfirm(null)}>
              Keep them
            </Button>
            <Button variant="danger" disabled={busy} onPress={() => confirm && void commit(confirm.rows, confirm.message, true)}>
              Remove anyway
            </Button>
          </View>
        }
      >
        <Text className="text-sm leading-5 text-ink-800">
          {confirm ? `${confirm.names} ${confirm.names.includes(",") ? "have" : "has"} ${confirm.lessons} lessons in ${confirm.classes} ${confirm.classes === 1 ? "class" : "classes"}. Removing ${confirm.names.includes(",") ? "them" : "it"} clears those lessons from the routine.` : ""}
        </Text>
      </Modal>

      {/* Phone: edit one row */}
      <RnModal visible={Boolean(editing)} transparent animationType="slide" onRequestClose={() => setEditId("")}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setEditId("")}>
          <Pressable className="rounded-t-3xl bg-white px-5 pb-8 pt-3" onPress={() => {}}>
            <View className="mb-3 items-center">
              <View className="h-1 w-10 rounded-full bg-ink-200" />
            </View>
            {editing ? (
              <View className="gap-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-lg font-bold text-ink-900">{editing.isBreak ? "Edit break" : "Edit period"}</Text>
                  <Pressable onPress={() => setEditId("")} hitSlop={8}>
                    <Text className="text-sm font-semibold text-[#1F45C7]">Done</Text>
                  </Pressable>
                </View>
                <Field label="Name">
                  <Input value={editing.name} onChangeText={(name) => patchRow(editIndex, { name })} className="h-12 text-[15px]" />
                </Field>
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Field label="Starts (24h)">
                      <Input
                        value={editing.startsAt}
                        keyboardType="numbers-and-punctuation"
                        className="h-12 text-[15px]"
                        onChangeText={(value) => {
                          const s = clockMin(value);
                          if (s === null || !/^\d{1,2}:\d{2}$/.test(value)) return setRows(rows.map((r, i) => (i === editIndex ? { ...r, startsAt: value } : r)));
                          patchRow(editIndex, { startsAt: clockHm(s), endsAt: clockHm(s + Math.max(5, rowLength(editing) || 40)) });
                        }}
                      />
                    </Field>
                  </View>
                  <View className="flex-1">
                    <Field label="Ends">
                      <View className="h-12 justify-center rounded-md bg-ink-50 px-3">
                        <Text className="text-[15px] text-ink-900">{clock12(editing.endsAt)}</Text>
                      </View>
                    </Field>
                  </View>
                </View>
                <View>
                  <Text className="mb-2 text-xs font-medium text-ink-700">Length</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {(editing.isBreak ? BREAK_CHOICES : LENGTH_CHOICES).map((minutes) => {
                      const on = rowLength(editing) === minutes;
                      return (
                        <Pressable
                          key={minutes}
                          onPress={() => setLength(editIndex, minutes)}
                          className={`h-9 justify-center rounded-full border px-3.5 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
                        >
                          <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-800"}`}>{minutes} min</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text className="mt-2 text-[11px] text-ink-500">Later periods move automatically to follow this one. School ends {clock12(dayEnd(rows))}.</Text>
                </View>
                <Pressable
                  onPress={() => patchRow(editIndex, { isBreak: !editing.isBreak })}
                  className="flex-row items-center justify-between rounded-xl bg-ink-50 px-4 py-3"
                >
                  <Text className="text-sm font-medium text-ink-900">This is a break (recess / lunch)</Text>
                  <Ionicons name={editing.isBreak ? "checkbox" : "square-outline"} size={20} color={editing.isBreak ? "#1F45C7" : "#94A3B8"} />
                </Pressable>
                <Pressable onPress={() => remove(editIndex)} className="h-11 flex-row items-center justify-center gap-1.5 rounded-xl">
                  <Ionicons name="trash-outline" size={16} color="#B91C1C" />
                  <Text className="text-sm font-semibold text-red-700">Delete {editing.isBreak ? "break" : "period"}</Text>
                </Pressable>
              </View>
            ) : null}
          </Pressable>
        </Pressable>
      </RnModal>
    </View>
  );
}

export function RoomsForm({
  rooms,
  onSave,
  onAdd,
  onDelete,
}: {
  rooms: { id: string; name: string; kind: string }[];
  onSave: (rooms: { id: string; name: string; kind: string }[]) => Promise<void>;
  onAdd: (payload: { name: string; kind: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [rows, setRows] = useState(rooms);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("CLASSROOM");
  const [error, setError] = useState("");
  return (
    <View className="mt-4 gap-4">
      {rows.map((r) => (
        <View key={r.id} className="flex-row flex-wrap items-center gap-2 border-t border-ink-100 py-2">
          <View className="min-w-[8rem] flex-1">
            <Input
              value={r.name}
              onChangeText={(v) => setRows(rows.map((x) => (x.id === r.id ? { ...x, name: v } : x)))}
            />
          </View>
          <View className="flex-row flex-wrap gap-1.5">
            {Object.entries(ROOM_KIND_LABEL).map(([k, label]) => (
              <Chip
                key={k}
                label={label}
                active={r.kind === k}
                onPress={() => setRows(rows.map((x) => (x.id === r.id ? { ...x, kind: k } : x)))}
              />
            ))}
          </View>
          <Pressable onPress={() => onDelete(r.id)}>
            <Text className="text-ink-700">×</Text>
          </Pressable>
        </View>
      ))}
      {!rows.length ? <Text className="text-sm text-ink-700">No rooms yet. Add labs and classrooms here.</Text> : null}
      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      <Button
        onPress={async () => {
          setError("");
          try {
            await onSave(rows);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not save.");
          }
        }}
      >
        Save rooms
      </Button>
      <View className="gap-2 border-t border-ink-100 pt-4">
        <Text className="text-xs font-medium text-ink-700">Add a room</Text>
        <Field label="Name">
          <Input value={name} onChangeText={setName} placeholder="Room 12 / Comp lab" />
        </Field>
        <View className="flex-row flex-wrap gap-1.5">
          {Object.entries(ROOM_KIND_LABEL).map(([k, label]) => (
            <Chip key={k} label={label} active={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>
        <Button
          variant="ghost"
          onPress={async () => {
            if (!name.trim()) return;
            await onAdd({ name: name.trim(), kind });
            setName("");
          }}
        >
          Add
        </Button>
      </View>
    </View>
  );
}

export function SchoolSubjectsForm({
  catalog,
  classes,
  onSaveCatalog,
  onSaveClass,
  weeklyPeriods,
}: {
  catalog: (string | SubjectCatalogEntry)[];
  /** Teaching periods a class can hold in a week (school days × non-break periods). Optional. */
  weeklyPeriods?: number;
  classes: {
    id: string;
    label: string;
    name?: string;
    subjects: { id?: string; code?: string; name: string; label?: string; weightage?: number }[];
    slots?: { subjectId?: string }[];
  }[];
  onSaveCatalog: (entries: SubjectCatalogEntry[], applyToAllClasses: boolean) => Promise<void>;
  onSaveClass: (
    classId: string,
    subjects: { id?: string; code: string; previousCode?: string; name: string; weightage: number }[]
  ) => Promise<void>;
}) {
  const [entries, setEntries] = useState(() => asCatalog(catalog));
  const [addCode, setAddCode] = useState("");
  const [addName, setAddName] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  /** Per-class codes the user crossed out in the Add subject popup (keys like "1", "2", or "*" for the plain code). */
  const [addSkip, setAddSkip] = useState<string[]>(["*"]);
  const [addCodeTouched, setAddCodeTouched] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [classAddOpen, setClassAddOpen] = useState(false);
  /** "Copy from": take another class's subjects and periods/week into this class (draft until Save). */
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyFromId, setCopyFromId] = useState("");
  const [copyMode, setCopyMode] = useState<"merge" | "replace">("merge");
  const [classAddCodes, setClassAddCodes] = useState<string[]>([]);
  const [classAddQuery, setClassAddQuery] = useState("");
  const [classAddAllGrades, setClassAddAllGrades] = useState(false);
  const [savedEntries, setSavedEntries] = useState(() => asCatalog(catalog));
  const [confirmRemoveCode, setConfirmRemoveCode] = useState("");
  const [classAddPeriods, setClassAddPeriods] = useState("4");
  const [catalogEditIndex, setCatalogEditIndex] = useState<number | null>(null);
  const [catalogEditName, setCatalogEditName] = useState("");
  const [classId, setClassId] = useState(classes[0]?.id || "");
  const [classSubjects, setClassSubjects] = useState<Record<string, ClassSubjectDraft[]>>(() =>
    Object.fromEntries(
      classes.map((klass) => [
        klass.id,
        klass.subjects.map((subject) => ({
          id: subject.id,
          code: normalizeSubjectCode(subject.code) || DEFAULT_SUBJECT_ENTRIES.find((row) => row.name === subject.name)?.code || "",
          previousCode: normalizeSubjectCode(subject.code),
          name: subject.name,
          periods: periodsDraft(subject.weightage),
        })),
      ])
    )
  );
  const [savedSubjects, setSavedSubjects] = useState<Record<string, ClassSubjectDraft[]>>(() => classSubjects);
  const [pendingClassId, setPendingClassId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [flash, setFlash] = useState<{ at: "catalog" | "class"; kind: "ok" | "err"; text: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [blockedRemoveKey, setBlockedRemoveKey] = useState("");
  const selected = classes.find((klass) => klass.id === classId) || classes[0];
  const selectedRows = selected ? classSubjects[selected.id] || [] : [];
  const selectedGrade = selected ? classGrade(selected) : "";
  const gradeSections = classes.filter((klass) => classGrade(klass) === selectedGrade);
  const unsaved = !!selected && draftSignature(selectedRows) !== draftSignature(savedSubjects[selected.id]);
  const plannedPeriods = selectedRows.reduce((sum, row) => sum + (parsePeriods(row.periods) || 0), 0);
  const capacity = weeklyPeriods && weeklyPeriods > 0 ? weeklyPeriods : 0;
  const codesOnOtherGrades = new Set<string>();
  const usedNames = new Set(selectedRows.map((row) => row.name.trim().toLowerCase()).filter(Boolean));
  const addPool = entries.filter((entry) => !usedNames.has(entry.name.trim().toLowerCase()));
  const otherGradeCount = 0;
  const addQuery = classAddQuery.trim().toLowerCase();
  const sameNameRow = (entry: { name: string }) =>
    selectedRows.find((row) => row.name.trim().toLowerCase() === entry.name.trim().toLowerCase());
  const pickedForAdd = addPool.filter((row) => classAddCodes.includes(row.code));
  const remainingVisible = addPool.filter((row) => {
    if (!addQuery) return true;
    return `${row.code} ${row.name}`.toLowerCase().includes(addQuery);
  });
  const catalogUnsaved =
    JSON.stringify(entries.map((row) => [row.code, row.name])) !== JSON.stringify(savedEntries.map((row) => [row.code, row.name]));
  const catalogQueryText = catalogQuery.trim().toLowerCase();
  const catalogGroups = (() => {
    const groups: { key: string; name: string; items: { row: SubjectCatalogEntry; index: number }[] }[] = [];
    entries.forEach((row, index) => {
      if (catalogQueryText && !`${row.code} ${row.name}`.toLowerCase().includes(catalogQueryText)) return;
      const key = row.name.trim().toLowerCase();
      const group = groups.find((item) => item.key === key);
      if (group) group.items.push({ row, index });
      else groups.push({ key, name: row.name.trim(), items: [{ row, index }] });
    });
    return groups;
  })();

  // Which classes use each catalog code, so unused codes are easy to spot and clean up.
  const nameUsage = (() => {
    const map = new Map<string, string[]>();
    for (const klass of classes) {
      for (const row of classSubjects[klass.id] || []) {
        const key = row.name.trim().toLowerCase();
        if (!key) continue;
        map.set(key, [...(map.get(key) || []), klass.label]);
      }
    }
    return map;
  })();
  const usageText = (name: string) => {
    const used = nameUsage.get(name.trim().toLowerCase()) || [];
    return used.length ? `Used by ${used.join(", ")}` : "Not used by any class";
  };
  const totalSubjects = new Set(entries.map((row) => row.name.trim().toLowerCase())).size;

  function closeClassAdd() {
    setClassAddOpen(false);
    setClassAddCodes([]);
    setClassAddQuery("");
    setClassAddAllGrades(false);
    setClassAddPeriods("4");
  }

  async function saveCatalog() {
    setFlash(null);
    try {
      await onSaveCatalog(entries, false);
      setSavedEntries(entries);
      setFlash({ at: "catalog", kind: "ok", text: "Catalog saved." });
      setCatalogOpen(false);
    } catch (e) {
      setFlash({ at: "catalog", kind: "err", text: e instanceof Error ? e.message : "Could not save." });
    }
  }

  function markGradeSaved(drafts: Record<string, ClassSubjectDraft[]>) {
    setSavedSubjects((prev) => {
      const next = { ...prev };
      for (const section of gradeSections) next[section.id] = drafts[section.id] || [];
      return next;
    });
  }

  function setRowPeriods(index: number, value: string) {
    if (!selected) return;
    setClassSubjects(
      syncGradeSubjectDrafts(
        classSubjects,
        classes,
        selected.id,
        selectedRows.map((item, i) => (i === index ? { ...item, periods: value.replace(/\D/g, "").slice(0, 2) } : item))
      )
    );
  }

  function pickClass(id: string) {
    const target = classes.find((klass) => klass.id === id);
    // Sections of the same class share one draft, so moving between them loses nothing.
    if (unsaved && target && classGrade(target) !== selectedGrade) {
      setPendingClassId(id);
      return;
    }
    setFlash(null);
    setClassId(id);
  }

  function discardAndSwitch() {
    const next = { ...classSubjects };
    for (const section of gradeSections) next[section.id] = savedSubjects[section.id] || [];
    setClassSubjects(next);
    setFlash(null);
    if (pendingClassId) setClassId(pendingClassId);
    setPendingClassId(null);
  }

  function undoClassChanges() {
    const next = { ...classSubjects };
    for (const section of gradeSections) next[section.id] = savedSubjects[section.id] || [];
    setClassSubjects(next);
    setSaveError("");
  }

  async function saveSelectedClass() {
    if (!selected) return false;
    setFlash(null);
    const subjects = selectedRows.flatMap((row) => {
      const weightage = parsePeriods(row.periods);
      const name = row.name.trim();
      const code = normalizeSubjectCode(row.code) || name.replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase();
      if (!name || weightage == null || weightage <= 0) return [];
      return [{ id: row.id, code, previousCode: row.previousCode, name, weightage }];
    });
    try {
      await onSaveClass(selected.id, subjects);
      markGradeSaved(classSubjects);
      const sectionNote =
        gradeSections.length > 1
          ? `Class ${selectedGrade} subjects saved for ${gradeSections.map((row) => row.label).join(", ")}.`
          : subjects.length
            ? `${selected.label} subjects saved.`
            : `${selected.label} has no subjects.`;
      setFlash({ at: "class", kind: "ok", text: sectionNote });
      return true;
    } catch (e) {
      // Shown as a popup: an inline line under a long table is easy to miss, especially on phone.
      setPendingClassId(null);
      setSaveError(e instanceof Error && e.message ? e.message : "Could not save. Try again.");
      return false;
    }
  }

  function placedCount(subjectId?: string) {
    if (!subjectId) return 0;
    return (selected?.slots || []).filter((slot) => slot.subjectId === subjectId).length;
  }

  function copySubjectsFrom(sourceId: string, mode: "merge" | "replace") {
    if (!selected) return;
    const source = classSubjects[sourceId] || [];
    const sourceLabel = classes.find((k) => k.id === sourceId)?.label || "that class";
    const key = (r: { name: string }) => r.name.trim().toLowerCase();
    const sourceByName = new Map(source.map((r) => [key(r), r]));
    let kept = 0;
    // Existing rows: take the source's periods; in "replace", drop subjects the source lacks (unless already in the routine).
    const next: ClassSubjectDraft[] = [];
    for (const row of selectedRows) {
      const src = sourceByName.get(key(row));
      if (src) next.push({ ...row, periods: src.periods });
      else if (mode === "merge") next.push(row);
      else if (placedCount(row.id)) {
        next.push(row);
        kept += 1;
      }
    }
    // Subjects only the source has.
    for (const src of source) {
      if (next.some((r) => key(r) === key(src))) continue;
      next.push({ code: src.code, previousCode: "", name: src.name, periods: src.periods });
    }
    setClassSubjects(syncGradeSubjectDrafts(classSubjects, classes, selected.id, next));
    setCopyOpen(false);
    setFlash({
      at: "class",
      kind: "ok",
      text: `Copied ${source.length} subjects from ${sourceLabel}.${kept ? ` ${kept} kept because they are already in the routine.` : ""} Check and tap Save ${selected.label}.`,
    });
  }

  function removeClassSubject(index: number) {
    const row = selectedRows[index];
    if (!selected || !row) return;
    if (placedCount(row.id)) {
      const key = row.id || row.code;
      setBlockedRemoveKey(key);
      setTimeout(() => setBlockedRemoveKey((current) => (current === key ? "" : current)), 3000);
      return;
    }
    setBlockedRemoveKey("");
    setFlash(null);
    setClassSubjects(
      syncGradeSubjectDrafts(
        classSubjects,
        classes,
        selected.id,
        selectedRows.filter((_, i) => i !== index)
      )
    );
  }

  function addCatalogEntry(codeRaw: string, nameRaw: string) {
    const name = nameRaw.trim();
    if (!name) {
      setNotice("Type the subject name.");
      return false;
    }
    if (entries.some((row) => row.name.trim().toLowerCase() === name.toLowerCase())) {
      setNotice("That subject is already in the catalog.");
      return false;
    }
    const found = DEFAULT_SUBJECT_ENTRIES.find((row) => row.name.toLowerCase() === name.toLowerCase());
    const code = normalizeSubjectCode(codeRaw) || found?.code || normalizeSubjectCode(name.replace(/[^A-Za-z0-9]/g, "")).slice(0, 12);
    setNotice("");
    setEntries([{ code, name, previousCode: code, previousName: name }, ...entries]);
    setAddCode("");
    setAddName("");
    setCatalogQuery("");
    setAddOpen(false);
    setFlash({ at: "catalog", kind: "ok", text: `${name} added.` });
    return true;
  }

  /** Classes in the school by grade, e.g. ["1","2",…,"10"], for the per-class codes in Add subject. */
  const schoolGrades = [...new Set(classes.map((klass) => classGrade(klass)).filter(Boolean))].sort((a, b) => {
    const x = Number(a);
    const y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) ? x - y : a.localeCompare(b);
  });

  function addCodeOptions(baseRaw: string) {
    const base = normalizeSubjectCode(baseRaw).replace(/-?\d+$/, "") || normalizeSubjectCode(baseRaw);
    if (!base) return [];
    const rows = [
      { key: "*", label: "Any class", code: base },
      ...schoolGrades.map((grade) => ({ key: grade, label: `Class ${grade}`, code: normalizeSubjectCode(`${base}-${grade}`) })),
    ];
    return rows.map((row) => ({
      ...row,
      exists: entries.some((entry) => entry.code === row.code),
      valid: clientCodeOk(row.code),
    }));
  }

  function openCatalogAdd() {
    setAddCode("");
    setAddName("");
    setAddSkip(["*"]);
    setAddCodeTouched(false);
    setNotice("");
    setAddOpen(true);
  }

  function addCatalogCodes() {
    return addCatalogEntry(addCode, addName);
  }

  function removeCatalog(code: string) {
    setEntries(entries.filter((row) => row.code !== code));
  }

  function openCatalogEdit(index: number) {
    const row = entries[index];
    if (!row) return;
    setCatalogEditIndex(index);
    setCatalogEditName(row.name);
    setNotice("");
  }

  function applyCatalogEdit() {
    if (catalogEditIndex == null) return false;
    const row = entries[catalogEditIndex];
    const name = catalogEditName.trim();
    if (!row || !name) {
      setNotice("Give this subject a name.");
      return false;
    }
    if (entries.some((entry, i) => i !== catalogEditIndex && entry.name.trim().toLowerCase() === name.toLowerCase())) {
      setNotice("That subject is already in the catalog.");
      return false;
    }
    const previousCode = row.previousCode || row.code;
    const previousName = row.previousName || row.name;
    const nextEntries = entries.map((entry, i) =>
      i === catalogEditIndex ? { ...entry, code: row.code, name, previousCode, previousName } : entry
    );
    const sameSubject = (item: { code: string; previousCode: string; name: string }) =>
      item.name.trim().toLowerCase() === row.name.trim().toLowerCase() ||
      item.code === row.code ||
      item.previousCode === row.code;
    const nextDrafts = Object.fromEntries(
      Object.entries(classSubjects).map(([id, rows]) => [
        id,
        rows.map((item) => (sameSubject(item) ? { ...item, name } : item)),
      ])
    );
    setNotice("");
    void (async () => {
      try {
        await onSaveCatalog(nextEntries, false);
        setEntries(nextEntries);
        setSavedEntries(nextEntries);
        setClassSubjects(nextDrafts);
        setSavedSubjects((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([id, rows]) => [
              id,
              rows.map((item) => (sameSubject(item) ? { ...item, name } : item)),
            ])
          )
        );
        setCatalogEditIndex(null);
        setFlash({ at: "catalog", kind: "ok", text: "Catalog subject updated." });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not save.");
      }
    })();
    return true;
  }

  function sheetCsv(sample = false) {
    const rows = [
      ["Name"],
      ...(sample && !entries.length ? DEFAULT_SUBJECT_ENTRIES.slice(0, 8) : entries).map((row) => [row.name]),
    ];
    return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  }

  function downloadSheet(sample = false) {
    if (typeof document === "undefined") {
      setFlash({ at: "catalog", kind: "err", text: "Download is available on web." });
      return;
    }
    const blob = new Blob([sheetCsv(sample)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = sample ? "anekio-subjects-sample.csv" : "anekio-subjects.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function uploadSheet(dropped?: PickedFile) {
    const file = dropped ?? (await pickFile(".csv,text/csv"));
    if (!file) return;
    const text = await fetch(file.uri).then((response) => response.text());
    const [header, ...rows] = parseCsv(text);
    const head = (header || []).map((cell) => String(cell || "").toLowerCase());
    const codeIdx = head.findIndex((cell) => cell.includes("code"));
    const nameIdx = head.findIndex((cell) => cell.includes("name") || cell.includes("subject"));
    if (nameIdx < 0) {
      setFlash({ at: "catalog", kind: "err", text: "Use a CSV with a Name column." });
      return;
    }
    const imported = asCatalog(
      rows
        .map((row) => ({
          code: codeIdx >= 0 ? row[codeIdx] : "",
          name: row[nameIdx],
        }))
        .filter((row) => row.name)
    );
    if (!imported.length) {
      setFlash({ at: "catalog", kind: "err", text: "No subjects found in the sheet." });
      return;
    }
    setEntries(imported);
    setImportOpen(false);
    setFlash({ at: "catalog", kind: "ok", text: "Subjects loaded. Review and save the catalog." });
  }

  return (
    <View className="w-full gap-3" style={{ maxWidth: 820 }}>
      {classes.length && selected ? (
        <View className="gap-2">
          <View className="flex-row items-center justify-between gap-2">
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Class curriculum</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setCatalogQuery("");
                setCatalogOpen(true);
              }}
              className="flex-row items-center gap-1 rounded-md px-2 py-1"
            >
              <Ionicons name="library-outline" size={15} color="#2563eb" />
              <Text className="text-sm font-medium text-clay-600">Manage catalog</Text>
            </Pressable>
          </View>
          {!catalogOpen ? <SaveFlash at="catalog" flash={flash} /> : null}
          {gradeSections.length > 1 ? (
            <Text className="text-sm text-ink-700">
              Class {selectedGrade} sections share these subjects. Each section keeps its own routine and teachers.
            </Text>
          ) : null}
          <ChipScroller>
            {classes.map((klass) => (
              <Chip
                key={klass.id}
                label={klass.label}
                active={klass.id === selected.id}
                onPress={() => pickClass(klass.id)}
              />
            ))}
          </ChipScroller>
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold text-ink-900">{selected.label} — Subjects</Text>
              {selectedRows.length ? (
                <Text className="mt-0.5 text-xs text-ink-700">
                  {capacity ? `${plannedPeriods} of ${capacity} periods a week` : `${plannedPeriods} periods a week`}
                  {capacity && plannedPeriods > capacity ? (
                    <Text className="font-semibold text-red-700">{` · ${plannedPeriods - capacity} over`}</Text>
                  ) : capacity && plannedPeriods < capacity ? (
                    <Text>{` · ${capacity - plannedPeriods} free`}</Text>
                  ) : capacity ? (
                    <Text className="font-semibold text-emerald-700"> · Full week</Text>
                  ) : null}
                </Text>
              ) : null}
            </View>
            <View className="flex-row flex-wrap items-center gap-2">
              {unsaved ? (
                <View className="rounded-full bg-amber-50 px-2.5 py-1">
                  <Text className="text-xs font-medium text-amber-700">Unsaved changes</Text>
                </View>
              ) : null}
              {classes.length > 1 ? (
                <Button
                  variant="ghost"
                  onPress={() => {
                    setCopyFromId("");
                    setCopyMode(selectedRows.length ? "merge" : "replace");
                    setCopyOpen(true);
                  }}
                >
                  ⧉ Copy from
                </Button>
              ) : null}
              <Button variant="ghost" onPress={() => setClassAddOpen(true)}>
                + Add Subject
              </Button>
              <Button className="px-5" onPress={() => void saveSelectedClass()}>
                Save {selected.label}
              </Button>
            </View>
          </View>
          <SaveFlash at="class" flash={flash} />
          <Modal
            open={copyOpen}
            title={`Copy subjects into ${selected.label}`}
            onClose={() => setCopyOpen(false)}
            sheetOnPhone
            footer={
              <View className="flex-row justify-end gap-2">
                <Button variant="ghost" onPress={() => setCopyOpen(false)}>
                  Cancel
                </Button>
                <Button disabled={!copyFromId} onPress={() => copySubjectsFrom(copyFromId, copyMode)}>
                  {copyFromId ? `Copy from ${classes.find((k) => k.id === copyFromId)?.label}` : "Pick a class"}
                </Button>
              </View>
            }
          >
            <View className="gap-4">
              <View className="gap-2">
                <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">1 · Copy from</Text>
                <View className="flex-row flex-wrap gap-2">
                  {classes
                    .filter((k) => k.id !== selected.id && (classSubjects[k.id] || []).length)
                    .map((k) => {
                      const rows = classSubjects[k.id] || [];
                      const total = rows.reduce((n, r) => n + (parsePeriods(r.periods) || 0), 0);
                      const on = copyFromId === k.id;
                      return (
                        <Pressable
                          key={k.id}
                          onPress={() => setCopyFromId(k.id)}
                          className={`rounded-xl border px-3 py-2 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
                        >
                          <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-900"}`}>{k.label}</Text>
                          <Text className={`text-[10px] ${on ? "text-blue-100" : "text-ink-500"}`}>
                            {rows.length} subjects · {total}/wk
                          </Text>
                        </Pressable>
                      );
                    })}
                </View>
              </View>
              {copyFromId ? (
                <View className="gap-1 rounded-xl border border-ink-200 bg-ink-50 p-3">
                  {(classSubjects[copyFromId] || []).map((r) => (
                    <View key={r.name} className="flex-row items-center justify-between">
                      <Text className="text-sm text-ink-800">{r.name}</Text>
                      <Text className="text-xs text-ink-600">{r.periods}/week</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <View className="gap-2">
                <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">2 · {selected.label} already has subjects</Text>
                {(
                  [
                    { id: "merge", title: "Add missing, update periods", sub: `Keeps ${selected.label}'s other subjects.` },
                    { id: "replace", title: "Make it exactly the same", sub: "Removes subjects the other class doesn't have (not ones already in the routine)." },
                  ] as const
                ).map((opt) => {
                  const on = copyMode === opt.id;
                  return (
                    <Pressable
                      key={opt.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      onPress={() => setCopyMode(opt.id)}
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
              <Text className="text-xs text-ink-500">Nothing is saved until you tap Save {selected.label}.</Text>
            </View>
          </Modal>
          <View className="overflow-hidden rounded-md border border-ink-200">
            <View className="flex-row items-center gap-3 border-b border-ink-100 bg-ink-50 px-3 py-2">
              <Text className="min-w-0 flex-1 text-xs font-medium uppercase tracking-wide text-ink-700">Subject</Text>
              <Text className="w-28 text-center text-xs font-medium uppercase tracking-wide text-ink-700">Periods/week</Text>
              <View className="w-8" />
            </View>
            {selectedRows.map((row, index) => {
              const placed = placedCount(row.id);
              return (
                <View key={`${row.previousCode || row.code}-${index}`} className={`flex-row items-center gap-3 px-3 py-2 ${index ? "border-t border-ink-100" : ""}`}>
                  <View className="min-w-0 flex-1">
                    <SubjectNameWithCode code={row.code} name={row.name} />
                    {placed && blockedRemoveKey === (row.id || row.code) ? (
                      <Text className="mt-0.5 text-xs font-medium text-red-700">Can't remove</Text>
                    ) : null}
                  </View>
                  <View className="w-28 items-center">
                    <PeriodStepper label={row.name} value={row.periods} onChange={(value) => setRowPeriods(index, value)} />
                  </View>
                  <View className="w-8 flex-row items-center justify-end">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${formatSubjectLabel(row.code, row.name)}`}
                      onPress={() => removeClassSubject(index)}
                      className="h-8 w-8 items-center justify-center"
                    >
                      <Text className="text-ink-700">×</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
            {!selectedRows.length ? (
              <View className="px-3 py-4">
                <Text className="text-sm text-ink-700">No subjects on this class yet. Add from the school catalog.</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : (
        <View className="gap-2">
          <Text className="text-sm text-ink-700">Add classes first.</Text>
          <Button
            variant="ghost"
            className="self-start"
            onPress={() => {
              setCatalogQuery("");
              setCatalogOpen(true);
            }}
          >
            Manage catalog
          </Button>
          {!catalogOpen ? <SaveFlash at="catalog" flash={flash} /> : null}
        </View>
      )}
      <Modal open={pendingClassId != null} title="Unsaved changes" onClose={() => setPendingClassId(null)}>
        <View className="gap-4">
          <Text className="text-sm leading-5 text-ink-700">
            {`You changed ${selected?.label || "this class"}'s subjects. Save them before switching, or discard the changes.`}
          </Text>
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button variant="ghost" onPress={() => setPendingClassId(null)}>
              Keep editing
            </Button>
            <Button variant="ghost" onPress={discardAndSwitch}>
              Discard
            </Button>
            <Button
              onPress={async () => {
                const target = pendingClassId;
                if (await saveSelectedClass()) {
                  setPendingClassId(null);
                  if (target) setClassId(target);
                }
              }}
            >
              Save and switch
            </Button>
          </View>
        </View>
      </Modal>

      <Modal
        open={catalogOpen}
        title="School catalog"
        onClose={() => {
          setCatalogOpen(false);
        }}
        wide
        footer={
          <View className="flex-row flex-wrap items-center justify-end gap-2">
            {catalogUnsaved ? (
              <View className="mr-auto rounded-full bg-amber-50 px-2.5 py-1">
                <Text className="text-xs font-medium text-amber-700">Unsaved changes</Text>
              </View>
            ) : null}
            <Button
              variant="ghost"
              onPress={() => {
                setCatalogOpen(false);
              }}
            >
              Close
            </Button>
            <Button onPress={() => void saveCatalog()}>Save catalog</Button>
          </View>
        }
      >
        <View className="gap-3">
          <>
            <SaveFlash at="catalog" flash={flash} />
            <View className="flex-row items-center justify-between gap-2">
              <Text className="text-xs text-ink-700">{`${totalSubjects} ${totalSubjects === 1 ? "subject" : "subjects"}`}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Upload subjects" onPress={() => setImportOpen(true)} className="flex-row items-center gap-1 py-1">
                <Ionicons name="cloud-upload-outline" size={15} color="#2563eb" />
                <Text className="text-sm font-medium text-clay-600">Upload CSV</Text>
              </Pressable>
            </View>
            <View className="flex-row items-center gap-2">
              <View className="min-w-0 flex-1">
                <Input accessibilityLabel="Search subject" value={catalogQuery} onChangeText={setCatalogQuery} placeholder="English" />
              </View>
              <Button variant="ghost" accessibilityLabel="Add subject" onPress={openCatalogAdd}>
                + Add
              </Button>
            </View>
            <View className="overflow-hidden rounded-md border border-ink-200">
              {catalogGroups.flatMap((group) => group.items).map(({ row, index }, i) => (
                <CatalogCodeRow
                  key={`${row.previousCode || row.code}-${index}`}
                  code={row.code}
                  name={row.name.trim()}
                  usage={usageText(row.name)}
                  unused={!nameUsage.has(row.name.trim().toLowerCase())}
                  label={`Edit ${formatSubjectLabel(row.code, row.name)} in catalog`}
                  first={i === 0}
                  onPress={() => openCatalogEdit(index)}
                />
              ))}
              {!entries.length ? (
                <View className="px-3 py-4">
                  <Text className="text-sm text-ink-700">No catalog subjects yet. Add one or upload a CSV.</Text>
                </View>
              ) : catalogQueryText && !catalogGroups.length ? (
                <View className="px-3 py-4">
                  <Text className="text-sm text-ink-700">No subjects match that search.</Text>
                </View>
              ) : null}
            </View>
          </>
        </View>
      </Modal>
      <Modal open={addOpen} title="Add subject" onClose={() => setAddOpen(false)}>
        <View className="gap-3">
          <Field label="Name">
            <Input
              accessibilityLabel="Subject name"
              value={addName}
              onChangeText={setAddName}
              placeholder="English"
              onSubmitEditing={() => {
                if (addCatalogEntry("", addName)) {
                  setAddName("");
                }
              }}
            />
          </Field>
          {notice ? <Text className="text-xs text-red-700">{notice}</Text> : (
            <Text className="text-xs text-ink-500">Add as many subjects as you need. Save catalog when you are done.</Text>
          )}
          <Button
            disabled={!addName.trim()}
            onPress={() => {
              if (addCatalogEntry("", addName)) setAddName("");
            }}
          >
            Add to catalog
          </Button>
          <View className="border-t border-ink-100 pt-3">
            <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-700">Defaults</Text>
            <View className="flex-row flex-wrap gap-2">
              {DEFAULT_SUBJECT_ENTRIES.filter((row) => !entries.some((entry) => entry.name.toLowerCase() === row.name.toLowerCase())).map((row) => (
                <Chip
                  key={row.name}
                  label={`+ ${row.name}`}
                  onPress={() => addCatalogEntry(row.code, row.name)}
                />
              ))}
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        open={classAddOpen}
        title={`Add subject to ${selected?.label || "class"}`}
        onClose={closeClassAdd}
        footer={
          <Button
            disabled={!pickedForAdd.length || !(parsePeriods(classAddPeriods) || 0)}
            onPress={() => {
              const periods = parsePeriods(classAddPeriods);
              if (!pickedForAdd.length || !selected || periods == null || periods <= 0) return;
              const next = pickedForAdd.filter((row) => !sameNameRow(row));
              if (!next.length) return;
              setClassSubjects(
                syncGradeSubjectDrafts(classSubjects, classes, selected.id, [
                  ...selectedRows,
                  ...next.map((picked) => ({
                    code: picked.code,
                    previousCode: picked.code,
                    name: picked.name,
                    periods: String(periods),
                  })),
                ])
              );
              closeClassAdd();
            }}
          >
            {!pickedForAdd.length ? "Pick a subject" : pickedForAdd.length === 1 ? "Add to class" : `Add ${pickedForAdd.length} to class`}
          </Button>
        }
      >
        <View className="gap-3">
          {!addPool.length ? (
            <Text className="text-sm text-ink-700">
              {"Every catalog subject is already on this class. Add a new subject in Manage catalog."}
            </Text>
          ) : (
            <>
              {addPool.length > 6 ? (
                <Field label="Search catalog">
                  <Input value={classAddQuery} onChangeText={setClassAddQuery} placeholder="English" />
                </Field>
              ) : null}
              <View className="flex-row flex-wrap gap-2">
                {remainingVisible.map((row) => {
                  const active = classAddCodes.includes(row.code);
                  return (
                    <Pressable
                      key={row.code}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={formatSubjectLabel(row.code, row.name)}
                      onPress={() =>
                        setClassAddCodes((codes) =>
                          codes.includes(row.code) ? codes.filter((code) => code !== row.code) : [...codes, row.code]
                        )
                      }
                      className={`flex-row items-center gap-2 rounded-md border px-3 py-2 ${active ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}
                    >
                      {active ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                      <Text className={`text-sm font-medium ${active ? "text-white" : "text-ink-900"}`}>{row.name}</Text>
                    </Pressable>
                  );
                })}
                {addQuery && !remainingVisible.length ? <Text className="text-sm text-ink-700">No subjects match that search.</Text> : null}
              </View>
            </>
          )}
          {otherGradeCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setClassAddAllGrades((value) => !value);
                setClassAddCodes([]);
              }}
              className="self-start py-1"
            >
              <Text className="text-xs font-medium text-clay-600">
                {classAddAllGrades ? `Show only Class ${selectedGrade} codes` : `Show codes from other classes (${otherGradeCount})`}
              </Text>
            </Pressable>
          ) : null}
          <View className="flex-row items-center justify-between gap-3 border-t border-ink-100 pt-3">
            <Text className="text-sm font-medium text-ink-800">Periods / week</Text>
            <PeriodStepper label="new subject" value={classAddPeriods} onChange={setClassAddPeriods} />
          </View>
        </View>
      </Modal>
      <Modal
        open={catalogEditIndex != null}
        title="Edit catalog subject"
        onClose={() => {
          setCatalogEditIndex(null);
          setConfirmRemoveCode("");
          setNotice("");
        }}
      >
        <View className="gap-3">
          <Text className="text-sm text-ink-700">
            This updates the school catalog and every class that already uses this subject.
          </Text>
          <Field label="Name">
            <Input value={catalogEditName} onChangeText={setCatalogEditName} placeholder="English" />
          </Field>
          {catalogEditIndex != null && entries[catalogEditIndex] ? (
            confirmRemoveCode === entries[catalogEditIndex].code ? (
              <View className="gap-2 rounded-md border border-red-200 bg-red-50 p-3">
                <Text className="text-sm text-red-800">
                  {`Remove ${formatSubjectLabel(entries[catalogEditIndex].code, entries[catalogEditIndex].name)} from the catalog? Tap Save catalog afterwards to keep the change.`}
                </Text>
                <View className="flex-row flex-wrap justify-end gap-2">
                  <Button variant="ghost" onPress={() => setConfirmRemoveCode("")}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onPress={() => {
                      removeCatalog(confirmRemoveCode);
                      setConfirmRemoveCode("");
                      setCatalogEditIndex(null);
                    }}
                  >
                    Remove
                  </Button>
                </View>
              </View>
            ) : null
          ) : null}
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${catalogEditIndex != null ? entries[catalogEditIndex]?.name || "" : ""} from catalog`}
              onPress={() => catalogEditIndex != null && setConfirmRemoveCode(entries[catalogEditIndex]?.code || "")}
              className="py-2"
            >
              <Text className="text-sm font-medium text-red-700">Remove from catalog</Text>
            </Pressable>
            <Button onPress={() => applyCatalogEdit()}>Save</Button>
          </View>
        </View>
      </Modal>
      <Modal open={importOpen} title="Upload subjects" onClose={() => setImportOpen(false)} wide>
        <UploadCsvPanel
          description="Upload the school subject catalog. Class periods stay on each class."
          requiredColumns="Name"
          note="Use one subject per row. Existing catalog rows are replaced after you review and save."
          onBrowse={() => void uploadSheet()}
          onDropFile={(file) => void uploadSheet(file)}
          onDownloadSample={() => downloadSheet(true)}
        />
      </Modal>
      <Modal open={Boolean(saveError)} title={`Couldn't save ${selected?.label || "class"}`} onClose={() => setSaveError("")}>
        <View className="gap-3">
          <Text className="text-sm leading-5 text-ink-900">{saveError}</Text>
          <Text className="text-sm leading-5 text-ink-700">
            Nothing was saved. Undo your changes to this class, or fix the problem and save again.
          </Text>
          <View className="flex-row flex-wrap justify-end gap-2">
            {unsaved ? (
              <Button variant="ghost" onPress={undoClassChanges}>
                Undo changes
              </Button>
            ) : null}
            <Button onPress={() => setSaveError("")}>OK</Button>
          </View>
        </View>
      </Modal>
      <Modal
        open={Boolean(notice) && !addOpen}
        title={catalogEditIndex != null ? "Can't edit subject" : "Can't add subject"}
        onClose={() => setNotice("")}
      >
        <View className="gap-3">
          <Text className="text-sm leading-5 text-ink-900">{notice}</Text>
          <View className="flex-row justify-end">
            <Button onPress={() => setNotice("")}>OK</Button>
          </View>
        </View>
      </Modal>
    </View>
  );
}
