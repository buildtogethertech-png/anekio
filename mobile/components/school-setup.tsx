import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Button, Chip, ChipScroller, Field, Input, Modal } from "./ui";
import { UploadCsvPanel } from "./upload-csv-panel";
import { pickFile } from "../lib/upload";
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

export type SubjectCatalogEntry = { code: string; name: string; previousCode?: string };

type ClassSubjectDraft = { id?: string; code: string; previousCode: string; name: string; periods: string };

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
    if (typeof item === "string") {
      const name = item.trim();
      if (!name) continue;
      const found = DEFAULT_SUBJECT_ENTRIES.find((row) => row.name.toLowerCase() === name.toLowerCase());
      const code = found?.code || normalizeSubjectCode(name).slice(0, 12);
      if (used.has(code)) continue;
      used.add(code);
      rows.push({ code, name, previousCode: code });
      continue;
    }
    const name = String(item.name || "").trim();
    const code = normalizeSubjectCode(item.code);
    if (!name || !code || used.has(code)) continue;
    used.add(code);
    rows.push({ code, name, previousCode: item.previousCode || code });
  }
  return rows.length ? rows : DEFAULT_SUBJECT_ENTRIES.slice(0, 8).map((row) => ({ ...row, previousCode: row.code }));
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
}: {
  catalog: (string | SubjectCatalogEntry)[];
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
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [classAddOpen, setClassAddOpen] = useState(false);
  const [classAddCode, setClassAddCode] = useState("");
  const [classAddQuery, setClassAddQuery] = useState("");
  const [classAddPeriods, setClassAddPeriods] = useState("4");
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [catalogEditIndex, setCatalogEditIndex] = useState<number | null>(null);
  const [catalogEditCode, setCatalogEditCode] = useState("");
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
  const [flash, setFlash] = useState<{ at: "catalog" | "class"; kind: "ok" | "err"; text: string } | null>(null);
  const [notice, setNotice] = useState("");
  const selected = classes.find((klass) => klass.id === classId) || classes[0];
  const selectedRows = selected ? classSubjects[selected.id] || [] : [];
  const selectedGrade = selected ? classGrade(selected) : "";
  const gradeSections = classes.filter((klass) => classGrade(klass) === selectedGrade);
  const codesOnOtherGrades = new Set(
    classes
      .filter((klass) => (klass.name || klass.label.split("-")[0] || "").trim() !== selectedGrade)
      .flatMap((klass) => (classSubjects[klass.id] || klass.subjects).map((row) => normalizeSubjectCode(row.code)))
      .filter(Boolean)
  );
  const remainingCatalog = entries.filter((entry) => {
    if (selectedRows.some((row) => row.code === entry.code || row.name === entry.name)) return false;
    if (codesOnOtherGrades.has(entry.code)) return false;
    return true;
  });
  const addQuery = classAddQuery.trim().toLowerCase();
  const remainingVisible = remainingCatalog.filter((row) => {
    if (!addQuery) return true;
    return `${row.code} ${row.name}`.toLowerCase().includes(addQuery);
  });

  function placedCount(subjectId?: string) {
    if (!subjectId) return 0;
    return (selected?.slots || []).filter((slot) => slot.subjectId === subjectId).length;
  }

  function removeClassSubject(index: number) {
    const row = selectedRows[index];
    if (!selected || !row) return;
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

  function openClassSubjectEdit(index: number) {
    const row = selectedRows[index];
    if (!row) return;
    setEditIndex(index);
    setEditCode(row.code);
    setEditName(row.name);
    setNotice("");
  }

  function applyClassSubjectEdit() {
    if (editIndex == null || !selected) return false;
    const name = editName.trim();
    const code = normalizeSubjectCode(editCode);
    const row = selectedRows[editIndex];
    if (!row || !name || !clientCodeOk(code)) {
      setNotice("Code must be 2–12 letters, numbers, or single hyphens.");
      return false;
    }
    if (selectedRows.some((item, i) => i !== editIndex && (item.code === code || item.name.trim().toLowerCase() === name.toLowerCase()))) {
      setNotice("That subject is already on this class.");
      return false;
    }
    if (codesOnOtherGrades.has(code) && code !== row.code) {
      setNotice(`That subject code is already used by another class.`);
      return false;
    }
    if (entries.some((entry) => entry.code === code && entry.code !== row.code && entry.code !== row.previousCode)) {
      setNotice("That subject code is already in the catalog.");
      return false;
    }
    const nextRows = selectedRows.map((item, i) => (i === editIndex ? { ...item, code, name } : item));
    const subjects = nextRows.flatMap((item) => {
      const weightage = parsePeriods(item.periods);
      const nextCode = normalizeSubjectCode(item.code);
      const nextName = item.name.trim();
      if (!nextName || !nextCode || weightage == null || weightage <= 0) return [];
      return [{ id: item.id, code: nextCode, previousCode: item.previousCode, name: nextName, weightage }];
    });
    setNotice("");
    void (async () => {
      try {
        await onSaveClass(selected.id, subjects);
        setClassSubjects(syncGradeSubjectDrafts(classSubjects, classes, selected.id, nextRows));
    setEntries(
      entries.some((entry) => entry.code === row.previousCode || entry.code === row.code)
        ? entries.map((entry) =>
            entry.code === row.previousCode || entry.code === row.code
              ? { ...entry, code, name }
              : entry
          )
        : [...entries, { code, name, previousCode: code }]
    );
        setEditIndex(null);
        setFlash({ at: "class", kind: "ok", text: "Subject updated for this class and the catalog." });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not save.");
      }
    })();
    return true;
  }

  function addCatalogEntry(codeRaw: string, nameRaw: string) {
    const name = nameRaw.trim();
    const code = normalizeSubjectCode(codeRaw);
    if (!name || !clientCodeOk(code)) {
      setNotice("Code must be 2–12 letters, numbers, or single hyphens.");
      return false;
    }
    if (entries.some((row) => row.code === code)) {
      setNotice("That subject code is already in the catalog.");
      return false;
    }
    setNotice("");
    setEntries([...entries, { code, name, previousCode: code }]);
    setAddCode("");
    setAddName("");
    return true;
  }

  function removeCatalog(code: string) {
    setEntries(entries.filter((row) => row.code !== code));
  }

  function openCatalogEdit(index: number) {
    const row = entries[index];
    if (!row) return;
    setCatalogEditIndex(index);
    setCatalogEditCode(row.code);
    setCatalogEditName(row.name);
    setNotice("");
  }

  function applyCatalogEdit() {
    if (catalogEditIndex == null) return false;
    const row = entries[catalogEditIndex];
    const name = catalogEditName.trim();
    const code = normalizeSubjectCode(catalogEditCode);
    if (!row || !name || !clientCodeOk(code)) {
      setNotice("Code must be 2–12 letters, numbers, or single hyphens.");
      return false;
    }
    if (entries.some((entry, i) => i !== catalogEditIndex && entry.code === code)) {
      setNotice("That subject code is already in the catalog.");
      return false;
    }
    if (codesOnOtherGrades.has(code) && code !== row.code) {
      setNotice("That subject code is already used by another class.");
      return false;
    }
    const previousCode = row.previousCode || row.code;
    const nextEntries = entries.map((entry, i) =>
      i === catalogEditIndex ? { ...entry, code, name, previousCode } : entry
    );
    const nextDrafts = Object.fromEntries(
      Object.entries(classSubjects).map(([id, rows]) => [
        id,
        rows.map((item) =>
          item.code === row.code || item.previousCode === row.code ? { ...item, code, name } : item
        ),
      ])
    );
    setNotice("");
    void (async () => {
      try {
        await onSaveCatalog(nextEntries, false);
        setEntries(nextEntries);
        setClassSubjects(nextDrafts);
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
      ["Code", "Name"],
      ...(sample && !entries.length ? DEFAULT_SUBJECT_ENTRIES.slice(0, 8) : entries).map((row) => [row.code, row.name]),
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

  async function uploadSheet() {
    const file = await pickFile(".csv,text/csv");
    if (!file) return;
    const text = await fetch(file.uri).then((response) => response.text());
    const [header, ...rows] = parseCsv(text);
    const head = (header || []).map((cell) => String(cell || "").toLowerCase());
    const codeIdx = head.findIndex((cell) => cell.includes("code"));
    const nameIdx = head.findIndex((cell) => cell.includes("name") || cell.includes("subject"));
    if (nameIdx < 0) {
      setFlash({ at: "catalog", kind: "err", text: "Use a CSV with Code and Name columns." });
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
    <View className="mt-3 gap-3">
      <View className="flex-row flex-wrap items-center justify-between gap-2 border-b border-ink-100 pb-3">
        <Text className="text-sm text-ink-700">
          School catalog · {entries.length} subject{entries.length === 1 ? "" : "s"}
        </Text>
        <Button
          variant="ghost"
          onPress={() => {
            setCatalogQuery("");
            setCatalogOpen(true);
          }}
        >
          Manage catalog
        </Button>
      </View>
      <SaveFlash at="catalog" flash={flash} />

      {classes.length && selected ? (
        <View className="gap-2">
          <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Class curriculum</Text>
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
                onPress={() => {
                  setFlash(null);
                  setClassId(klass.id);
                }}
              />
            ))}
          </ChipScroller>
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Text className="text-sm font-semibold text-ink-900">{selected.label} — Subjects</Text>
            <View className="flex-row flex-wrap gap-2">
              <Button variant="ghost" onPress={() => setClassAddOpen(true)}>
                + Add Subject
              </Button>
              <Button
                className="px-5"
                onPress={async () => {
                  setFlash(null);
                  const subjects = selectedRows.flatMap((row) => {
                    const weightage = parsePeriods(row.periods);
                    const code = normalizeSubjectCode(row.code);
                    const name = row.name.trim();
                    if (!name || !code || weightage == null || weightage <= 0) return [];
                    return [{ id: row.id, code, previousCode: row.previousCode, name, weightage }];
                  });
                  try {
                    await onSaveClass(selected.id, subjects);
                    const sectionNote =
                      gradeSections.length > 1
                        ? `Class ${selectedGrade} subjects saved for ${gradeSections.map((row) => row.label).join(", ")}.`
                        : subjects.length
                          ? `${selected.label} subjects saved.`
                          : `${selected.label} has no subjects.`;
                    setFlash({
                      at: "class",
                      kind: "ok",
                      text: sectionNote,
                    });
                  } catch (e) {
                    setFlash({ at: "class", kind: "err", text: e instanceof Error ? e.message : "Could not save." });
                  }
                }}
              >
                Save {selected.label}
              </Button>
            </View>
          </View>
          <View className="overflow-hidden rounded-md border border-ink-200">
            <View className="flex-row items-center gap-3 border-b border-ink-100 bg-ink-50 px-3 py-2">
              <Text className="min-w-0 flex-1 text-xs font-medium uppercase tracking-wide text-ink-700">Subject</Text>
              <Text className="w-24 text-center text-xs font-medium uppercase tracking-wide text-ink-700">Periods/week</Text>
              <View className="w-20" />
            </View>
            {selectedRows.map((row, index) => {
              const placed = placedCount(row.id);
              return (
                <View key={`${row.previousCode || row.code}-${index}`} className={`flex-row items-center gap-3 px-3 py-2 ${index ? "border-t border-ink-100" : ""}`}>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-semibold text-ink-900">{formatSubjectLabel(row.code, row.name)}</Text>
                    {placed ? (
                      <Text className="mt-0.5 text-xs text-ink-700">
                        {placed} period{placed === 1 ? "" : "s"} on the routine — remove those first
                      </Text>
                    ) : null}
                  </View>
                  <View className="w-24">
                    <Input
                      keyboardType="number-pad"
                      className="py-1 text-center"
                      value={row.periods}
                      onChangeText={(value) =>
                        setClassSubjects(
                          syncGradeSubjectDrafts(
                            classSubjects,
                            classes,
                            selected.id,
                            selectedRows.map((item, i) =>
                              i === index ? { ...item, periods: value.replace(/\D/g, "").slice(0, 2) } : item
                            )
                          )
                        )
                      }
                    />
                  </View>
                  <View className="w-20 flex-row items-center justify-end gap-1">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${formatSubjectLabel(row.code, row.name)}`}
                      onPress={() => openClassSubjectEdit(index)}
                      className="h-8 px-1 items-center justify-center"
                    >
                      <Text className="text-xs font-medium text-clay-600">Edit</Text>
                    </Pressable>
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
          <SaveFlash at="class" flash={flash} />
        </View>
      ) : (
        <Text className="text-sm text-ink-700">Add classes first.</Text>
      )}
      <Modal open={catalogOpen} title="School catalog" onClose={() => setCatalogOpen(false)} wide>
        <View className="gap-3">
          <Text className="text-sm text-ink-700">These are the subjects the school offers. Load them onto a class below — the catalog is not the class list.</Text>
          <View className="flex-row flex-wrap gap-2">
            <IconButton icon="add" label="Add subject" onPress={() => setAddOpen(true)} />
            <IconButton icon="cloud-upload-outline" label="Upload subjects" onPress={() => setImportOpen(true)} />
            <Button
              onPress={async () => {
                setFlash(null);
                try {
                  await onSaveCatalog(entries, false);
                  setFlash({ at: "catalog", kind: "ok", text: "Catalog saved." });
                  setCatalogOpen(false);
                } catch (e) {
                  setFlash({ at: "catalog", kind: "err", text: e instanceof Error ? e.message : "Could not save." });
                }
              }}
            >
              Save catalog
            </Button>
          </View>
          <Field label="Search subject">
            <Input value={catalogQuery} onChangeText={setCatalogQuery} placeholder="ENG or English" />
          </Field>
          <ScrollView className="max-h-80" nestedScrollEnabled>
            <View className="overflow-hidden rounded-md border border-ink-200">
              {entries
                .map((row, index) => ({ row, index }))
                .filter(({ row }) => {
                  const query = catalogQuery.trim().toLowerCase();
                  if (!query) return true;
                  return `${row.code} ${row.name}`.toLowerCase().includes(query);
                })
                .map(({ row, index }, visibleIndex) => (
                <View key={`${row.previousCode || row.code}-${index}`} className={`flex-row items-center gap-3 px-3 py-2 ${visibleIndex ? "border-t border-ink-100" : ""}`}>
                  <Text className="min-w-0 flex-1 text-sm font-semibold text-ink-900">{formatSubjectLabel(row.code, row.name)}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${formatSubjectLabel(row.code, row.name)} in catalog`}
                    onPress={() => openCatalogEdit(index)}
                    className="h-8 px-1 items-center justify-center"
                  >
                    <Text className="text-xs font-medium text-clay-600">Edit</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${row.code} from catalog`} onPress={() => removeCatalog(row.code)}>
                    <Text className="text-ink-700">×</Text>
                  </Pressable>
                </View>
              ))}
              {!entries.length ? (
                <View className="px-3 py-4">
                  <Text className="text-sm text-ink-700">No catalog subjects yet.</Text>
                </View>
              ) : catalogQuery.trim() &&
                !entries.some((row) => `${row.code} ${row.name}`.toLowerCase().includes(catalogQuery.trim().toLowerCase())) ? (
                <View className="px-3 py-4">
                  <Text className="text-sm text-ink-700">No subjects match that search.</Text>
                </View>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </Modal>
      <Modal open={addOpen} title="Add subject" onClose={() => setAddOpen(false)}>
        <View className="gap-3">
          <Field label="Code">
            <Input value={addCode} onChangeText={(value) => setAddCode(normalizeSubjectCode(value))} placeholder="ENG" autoCapitalize="characters" />
          </Field>
          <Field label="Name">
            <Input value={addName} onChangeText={setAddName} placeholder="English" />
          </Field>
          <View className="flex-row flex-wrap gap-2">
            <Button
              onPress={() => {
                if (addCatalogEntry(addCode, addName)) setAddOpen(false);
              }}
            >
              Add subject
            </Button>
          </View>
          <View className="border-t border-ink-100 pt-3">
            <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-700">Defaults</Text>
            <View className="flex-row flex-wrap gap-2">
              {DEFAULT_SUBJECT_ENTRIES.filter((row) => !entries.some((entry) => entry.code === row.code)).map((row) => (
                <Chip
                  key={row.code}
                  label={`+ ${formatSubjectLabel(row.code, row.name)}`}
                  onPress={() => addCatalogEntry(row.code, row.name)}
                />
              ))}
            </View>
          </View>
        </View>
      </Modal>
      <Modal open={classAddOpen} title={`Add subject to ${selected?.label || "class"}`} onClose={() => setClassAddOpen(false)}>
        <View className="gap-3">
          {!remainingCatalog.length ? (
            <Text className="text-sm text-ink-700">Every catalog subject is already on this class.</Text>
          ) : (
            <>
              {remainingCatalog.length > 8 ? (
                <Field label="Search catalog">
                  <Input value={classAddQuery} onChangeText={setClassAddQuery} placeholder="ENG or English" />
                </Field>
              ) : null}
              <ScrollView className="max-h-56" nestedScrollEnabled>
                <View className="flex-row flex-wrap gap-2">
                  {remainingVisible.map((row) => (
                    <Chip
                      key={row.code}
                      label={formatSubjectLabel(row.code, row.name)}
                      active={classAddCode === row.code}
                      onPress={() => setClassAddCode(row.code)}
                    />
                  ))}
                </View>
              </ScrollView>
            </>
          )}
          <Field label="Periods / week">
            <Input keyboardType="number-pad" value={classAddPeriods} onChangeText={(value) => setClassAddPeriods(value.replace(/\D/g, "").slice(0, 2))} />
          </Field>
          <Button
            onPress={() => {
              const picked = remainingCatalog.find((row) => row.code === classAddCode) || remainingCatalog[0];
              const periods = parsePeriods(classAddPeriods);
              if (!picked || periods == null || periods <= 0 || !selected) return;
              setClassSubjects(
                syncGradeSubjectDrafts(classSubjects, classes, selected.id, [
                  ...selectedRows,
                  { code: picked.code, previousCode: picked.code, name: picked.name, periods: String(periods) },
                ])
              );
              setClassAddCode("");
              setClassAddPeriods("4");
              setClassAddOpen(false);
            }}
          >
            Add to class
          </Button>
        </View>
      </Modal>
      <Modal
        open={catalogEditIndex != null}
        title="Edit catalog subject"
        onClose={() => {
          setCatalogEditIndex(null);
          setNotice("");
        }}
      >
        <View className="gap-3">
          <Text className="text-sm text-ink-700">
            This updates the school catalog and every class that already uses this subject, unless the code is already used.
          </Text>
          <Field label="Code">
            <Input
              value={catalogEditCode}
              onChangeText={(value) => setCatalogEditCode(normalizeSubjectCode(value))}
              placeholder="ENG"
              autoCapitalize="characters"
            />
          </Field>
          <Field label="Name">
            <Input value={catalogEditName} onChangeText={setCatalogEditName} placeholder="English" />
          </Field>
          <View className="flex-row justify-end">
            <Button onPress={() => applyCatalogEdit()}>Save</Button>
          </View>
        </View>
      </Modal>
      <Modal
        open={editIndex != null}
        title="Edit subject"
        onClose={() => {
          setEditIndex(null);
          setNotice("");
        }}
      >
        <View className="gap-3">
          <Text className="text-sm text-ink-700">
            This updates every section of Class {selectedGrade || "this class"} and the school catalog, unless the code is already used.
          </Text>
          <Field label="Code">
            <Input value={editCode} onChangeText={(value) => setEditCode(normalizeSubjectCode(value))} placeholder="ENG" autoCapitalize="characters" />
          </Field>
          <Field label="Name">
            <Input value={editName} onChangeText={setEditName} placeholder="English" />
          </Field>
          <View className="flex-row justify-end">
            <Button onPress={() => applyClassSubjectEdit()}>Save</Button>
          </View>
        </View>
      </Modal>
      <Modal open={importOpen} title="Upload subjects" onClose={() => setImportOpen(false)} wide>
        <UploadCsvPanel
          description="Upload the school subject catalog. Class periods stay on each class."
          requiredColumns="Code, Name"
          note="Use one subject per row. Existing catalog rows are replaced after you review and save."
          onBrowse={() => void uploadSheet()}
          onDownloadSample={() => downloadSheet(true)}
        />
      </Modal>
      <Modal
        open={Boolean(notice)}
        title={editIndex != null || catalogEditIndex != null ? "Can't edit subject" : "Can't add subject"}
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
