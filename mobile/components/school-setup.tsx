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

/** Phone bell-times editor: one line per period, tap to edit in a sheet, times chain automatically. */
function PhoneClock({
  days,
  setDays,
  rows,
  setRows,
  onSave,
  onAdd,
  onDelete,
}: {
  days: number[];
  setDays: (days: number[]) => void;
  rows: ClockPeriodRow[];
  setRows: (rows: ClockPeriodRow[]) => void;
  onSave: () => Promise<void>;
  onAdd: (payload: { name: string; startsAt: string; endsAt: string; isBreak: boolean }) => Promise<{ period?: ClockPeriodRow } | void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editId, setEditId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = rows.find((row) => row.id === editId) || null;
  const editIndex = rows.findIndex((row) => row.id === editId);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const teaching = rows.filter((row) => !row.isBreak).length;

  function patchEditing(part: Partial<ClockPeriodRow>) {
    if (editIndex < 0) return;
    const next = rows.map((row, i) => (i === editIndex ? { ...row, ...part } : row));
    setRows(chainFrom(next, editIndex));
  }

  function setLength(minutes: number) {
    if (!editing) return;
    const start = clockMin(editing.startsAt);
    if (start === null) return;
    patchEditing({ endsAt: clockHm(start + minutes) });
  }

  async function addRow(isBreak: boolean) {
    setError("");
    const lastEnd = last ? clockMin(last.endsAt) : 9 * 60;
    const start = lastEnd ?? 9 * 60;
    const length = isBreak ? 20 : (() => {
      const sample = [...rows].reverse().find((row) => !row.isBreak);
      const s = sample ? clockMin(sample.startsAt) : null;
      const e = sample ? clockMin(sample.endsAt) : null;
      return s !== null && e !== null ? Math.max(10, e - s) : 40;
    })();
    try {
      const result = await onAdd({
        name: isBreak ? "Recess" : nextPeriodName(rows),
        startsAt: clockHm(start),
        endsAt: clockHm(start + length),
        isBreak,
      });
      if (result?.period) {
        setRows([...rows, result.period]);
        setEditId(result.period.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add.");
    }
  }

  const editStart = editing ? clockMin(editing.startsAt) : null;
  const editEnd = editing ? clockMin(editing.endsAt) : null;
  const editLength = editStart !== null && editEnd !== null ? editEnd - editStart : 0;

  return (
    <View className="mt-3 gap-5">
      <View>
        <Text className="mb-2 text-sm font-semibold text-ink-900">School days</Text>
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
      </View>

      <View>
        <Text className="text-sm font-semibold text-ink-900">Bell times</Text>
        <Text className="mt-0.5 text-xs text-ink-600">
          {rows.length
            ? `${teaching} period${teaching === 1 ? "" : "s"} · ${clock12(first.startsAt)} – ${clock12(last.endsAt)}`
            : "No periods yet"}
        </Text>
        <View className="mt-2 overflow-hidden rounded-2xl border border-ink-200 bg-white">
          {rows.map((row, index) => {
            const s = clockMin(row.startsAt);
            const e = clockMin(row.endsAt);
            const length = s !== null && e !== null ? e - s : 0;
            if (row.isBreak) {
              return (
                <Pressable
                  key={row.id}
                  onPress={() => setEditId(row.id)}
                  className={`flex-row items-center gap-2 bg-amber-50/60 px-4 py-2.5 active:bg-amber-50 ${index ? "border-t border-ink-100" : ""}`}
                >
                  <Ionicons name={/lunch/i.test(row.name) ? "restaurant-outline" : "cafe-outline"} size={15} color="#B45309" />
                  <Text className="min-w-0 flex-1 text-sm font-medium text-amber-900" numberOfLines={1}>
                    {row.name} · {clock12(row.startsAt)} – {clock12(row.endsAt)}
                  </Text>
                  <Text className="text-xs text-amber-800">{length} min</Text>
                  <Ionicons name="chevron-forward" size={15} color="#B45309" />
                </Pressable>
              );
            }
            return (
              <Pressable
                key={row.id}
                onPress={() => setEditId(row.id)}
                className={`flex-row items-center gap-3 px-4 py-3 active:bg-ink-50 ${index ? "border-t border-ink-100" : ""}`}
              >
                <Text className="w-[76px] text-[15px] font-medium text-ink-900" numberOfLines={1}>{row.name}</Text>
                <Text className="min-w-0 flex-1 text-sm text-ink-800" numberOfLines={1}>
                  {clock12(row.startsAt)} – {clock12(row.endsAt)}
                </Text>
                <Text className="text-xs text-ink-500">{length} min</Text>
                <Ionicons name="chevron-forward" size={15} color="#94A3B8" />
              </Pressable>
            );
          })}
          {!rows.length ? <Text className="px-4 py-5 text-sm text-ink-600">Add the first period to start the school day.</Text> : null}
        </View>
        <View className="mt-3 flex-row gap-2">
          <Pressable onPress={() => void addRow(false)} className="h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-ink-200 bg-white">
            <Ionicons name="add" size={17} color="#1F45C7" />
            <Text className="text-sm font-semibold text-[#1F45C7]">Add period</Text>
          </Pressable>
          <Pressable onPress={() => void addRow(true)} className="h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-ink-200 bg-white">
            <Ionicons name="cafe-outline" size={16} color="#B45309" />
            <Text className="text-sm font-semibold text-amber-800">Add break</Text>
          </Pressable>
        </View>
      </View>

      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      <Pressable
        disabled={busy}
        onPress={async () => {
          setError("");
          setBusy(true);
          try {
            await onSave();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not save.");
          } finally {
            setBusy(false);
          }
        }}
        className={`h-12 items-center justify-center rounded-2xl bg-[#1F45C7] ${busy ? "opacity-60" : ""}`}
      >
        <Text className="text-[15px] font-semibold text-white">{busy ? "Saving…" : "Save bell times"}</Text>
      </Pressable>

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
                  <Input value={editing.name} onChangeText={(name) => patchEditing({ name })} className="h-12 text-[15px]" />
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
                          if (s === null) {
                            patchEditing({ startsAt: value });
                            return;
                          }
                          patchEditing({ startsAt: clockHm(s), endsAt: clockHm(s + Math.max(5, editLength || 40)) });
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
                    {(editing.isBreak ? [10, 15, 20, 30, 45] : LENGTH_CHOICES).map((minutes) => {
                      const on = editLength === minutes;
                      return (
                        <Pressable
                          key={minutes}
                          onPress={() => setLength(minutes)}
                          className={`h-9 justify-center rounded-full border px-3.5 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
                        >
                          <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-800"}`}>{minutes} min</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text className="mt-2 text-[11px] text-ink-500">Later periods move automatically to follow this one.</Text>
                </View>
                <Pressable
                  onPress={() => patchEditing({ isBreak: !editing.isBreak })}
                  className="flex-row items-center justify-between rounded-xl bg-ink-50 px-4 py-3"
                >
                  <Text className="text-sm font-medium text-ink-900">This is a break (recess / lunch)</Text>
                  <Ionicons name={editing.isBreak ? "checkbox" : "square-outline"} size={20} color={editing.isBreak ? "#1F45C7" : "#94A3B8"} />
                </Pressable>
                <Pressable
                  onPress={async () => {
                    const id = editing.id;
                    setError("");
                    try {
                      await onDelete(id);
                      const index = rows.findIndex((row) => row.id === id);
                      setRows(chainFrom(rows.filter((row) => row.id !== id), Math.max(0, index - 1)));
                      setEditId("");
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Could not delete.");
                      setEditId("");
                    }
                  }}
                  className="h-11 flex-row items-center justify-center gap-1.5 rounded-xl"
                >
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

export function ClockForm({
  weekdays,
  periods,
  onSave,
  onAdd,
  onDelete,
}: {
  weekdays: number[];
  periods: { id: string; name: string; start: string; end: string; isBreak?: boolean; sortOrder?: number }[];
  onSave: (payload: {
    weekdays: number[];
    periods: { id: string; name: string; startsAt: string; endsAt: string; isBreak: boolean; sortOrder?: number }[];
  }) => Promise<void>;
  onAdd: (payload: { name: string; startsAt: string; endsAt: string; isBreak: boolean }) => Promise<
    | {
        period?: ClockPeriodRow;
      }
    | void
  >;
  onDelete: (id: string) => Promise<void>;
}) {
  const [days, setDays] = useState<number[]>(weekdays);
  const [rows, setRows] = useState<ClockPeriodRow[]>(
    periods.map((p) => ({
      id: p.id,
      name: p.name,
      startsAt: p.start,
      endsAt: p.end,
      isBreak: Boolean(p.isBreak),
      sortOrder: p.sortOrder,
    }))
  );
  const [add, setAdd] = useState({ name: "", startsAt: "15:10", endsAt: "15:50", isBreak: false });
  const [error, setError] = useState("");
  const draftName = add.name.trim() || nextPeriodName(rows);
  const { width } = useWindowDimensions();
  if (width < 768) {
    return (
      <PhoneClock
        days={days}
        setDays={setDays}
        rows={rows}
        setRows={setRows}
        onSave={() => onSave({ weekdays: days, periods: rows })}
        onAdd={onAdd}
        onDelete={onDelete}
      />
    );
  }
  return (
    <View className="mt-4 gap-4">
      <View className="gap-2">
        <Text className="mb-2 text-xs font-medium text-ink-700">Days the school runs</Text>
        <View className="flex-row flex-wrap gap-1.5">
          {ALL_WEEKDAYS.map((d) => (
            <Chip
              key={d.n}
              label={d.label}
              active={days.includes(d.n)}
              onPress={() =>
                setDays(days.includes(d.n) ? days.filter((n) => n !== d.n) : [...days, d.n].sort((a, b) => a - b))
              }
            />
          ))}
        </View>
      </View>

      <View className="gap-3 rounded-lg border border-ink-100 bg-ink-50 p-3">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <View>
            <Text className="text-xs font-medium uppercase text-ink-700">Bell times</Text>
            <Text className="mt-0.5 text-sm font-semibold text-ink-900">{rows.length} {rows.length === 1 ? "period" : "periods"}</Text>
          </View>
          <Button
            variant="ghost"
            className="px-5"
            onPress={async () => {
              setError("");
              try {
                await onSave({ weekdays: days, periods: rows });
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not save.");
              }
            }}
          >
            Save clock
          </Button>
        </View>

        {rows.length ? (
          <View className="gap-2">
            {rows.map((p) => (
              <View key={p.id} className="flex-row flex-wrap items-center gap-2 rounded-md border border-ink-100 bg-white p-2">
                <View className="min-w-[9rem] flex-1">
                  <Input value={p.name} onChangeText={(v) => setRows(rows.map((r) => (r.id === p.id ? { ...r, name: v } : r)))} />
                </View>
                <View className="w-24">
                  <Input
                    value={p.startsAt}
                    onChangeText={(v) => setRows(rows.map((r) => (r.id === p.id ? { ...r, startsAt: v } : r)))}
                  />
                </View>
                <View className="w-24">
                  <Input
                    value={p.endsAt}
                    onChangeText={(v) => setRows(rows.map((r) => (r.id === p.id ? { ...r, endsAt: v } : r)))}
                  />
                </View>
                <Chip
                  label="Break"
                  active={p.isBreak}
                  onPress={() => setRows(rows.map((r) => (r.id === p.id ? { ...r, isBreak: !r.isBreak } : r)))}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${p.name}`}
                  onPress={async () => {
                    setError("");
                    try {
                      await onDelete(p.id);
                      setRows(rows.filter((row) => row.id !== p.id));
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Could not delete period.");
                    }
                  }}
                  className="h-10 w-10 items-center justify-center rounded-md border border-ink-200 bg-white"
                >
                  <Ionicons name="trash-outline" size={18} color="#3d4f66" />
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <View className="rounded-md border border-dashed border-ink-200 bg-white px-3 py-4">
            <Text className="text-sm font-medium text-ink-900">No bell times yet</Text>
            <Text className="mt-1 text-xs leading-5 text-ink-700">Add periods below, then save the clock for timetable planning.</Text>
          </View>
        )}

        <View className="gap-2 rounded-md border border-ink-100 bg-white p-3">
          <Text className="text-xs font-medium text-ink-700">Add a period</Text>
          <View className="flex-row flex-wrap items-center gap-2">
            <View className="min-w-[9rem] flex-1">
              <Input value={add.name} onChangeText={(v) => setAdd({ ...add, name: v })} placeholder={draftName} />
            </View>
            <View className="w-24">
              <Input value={add.startsAt} onChangeText={(v) => setAdd({ ...add, startsAt: v })} />
            </View>
            <View className="w-24">
              <Input value={add.endsAt} onChangeText={(v) => setAdd({ ...add, endsAt: v })} />
            </View>
            <Chip label="Break" active={add.isBreak} onPress={() => setAdd({ ...add, isBreak: !add.isBreak })} />
            <Button
              className="px-6"
              onPress={async () => {
                setError("");
                try {
                  const result = await onAdd({ ...add, name: draftName });
                  if (result?.period) setRows([...rows, result.period]);
                  setAdd({ name: "", startsAt: "15:10", endsAt: "15:50", isBreak: false });
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not add period.");
                }
              }}
            >
              Add period
            </Button>
          </View>
        </View>
        {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      </View>
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
  const [classAddCode, setClassAddCode] = useState("");
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
  const pickedForAdd = addPool.find((row) => row.code === classAddCode);
  const replacing = pickedForAdd ? sameNameRow(pickedForAdd) : undefined;
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
    setClassAddCode("");
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
              <Button variant="ghost" onPress={() => setClassAddOpen(true)}>
                + Add Subject
              </Button>
              <Button className="px-5" onPress={() => void saveSelectedClass()}>
                Save {selected.label}
              </Button>
            </View>
          </View>
          <SaveFlash at="class" flash={flash} />
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
            disabled={!addPool.some((row) => row.code === classAddCode) || !(parsePeriods(classAddPeriods) || 0)}
            onPress={() => {
              const picked = addPool.find((row) => row.code === classAddCode);
              const periods = parsePeriods(classAddPeriods);
              if (!picked || !selected) return;
              if (sameNameRow(picked) || periods == null || periods <= 0) return;
              setClassSubjects(
                syncGradeSubjectDrafts(classSubjects, classes, selected.id, [
                  ...selectedRows,
                  { code: picked.code, previousCode: picked.code, name: picked.name, periods: String(periods) },
                ])
              );
              closeClassAdd();
            }}
          >
            {!pickedForAdd ? "Pick a subject" : "Add to class"}
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
                  const active = classAddCode === row.code;
                  const swapsWith = sameNameRow(row);
                  return (
                    <Pressable
                      key={row.code}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={formatSubjectLabel(row.code, row.name)}
                      onPress={() => setClassAddCode(row.code)}
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
                setClassAddCode("");
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
