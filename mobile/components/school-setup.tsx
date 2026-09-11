import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import { Button, Chip, Field, Input, Modal } from "./ui";
import { UploadCsvPanel } from "./upload-csv-panel";
import { pickFile } from "../lib/upload";

export const DEFAULT_SUBJECTS = [
  "English",
  "Mathematics",
  "Hindi",
  "Science",
  "Social Science",
  "Computer",
  "Physics",
  "Chemistry",
  "Biology",
  "Physical Education",
  "Arts",
];

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
  onAdd: (payload: { name: string; startsAt: string; endsAt: string; isBreak: boolean }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [days, setDays] = useState<number[]>(weekdays);
  const [rows, setRows] = useState(
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
  return (
    <View className="mt-4 gap-4">
      <View>
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
      <View>
        <Text className="mb-2 text-xs font-medium text-ink-700">Bell times · {rows.length} periods</Text>
        {rows.map((p) => (
          <View key={p.id} className="flex-row flex-wrap items-center gap-2 border-t border-ink-100 py-2">
            <View className="min-w-[8rem] flex-1">
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
            <Pressable onPress={() => onDelete(p.id)}>
              <Text className="text-ink-700">×</Text>
            </Pressable>
          </View>
        ))}
      </View>
      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      <Button
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
      <View className="gap-2 border-t border-ink-100 pt-4">
        <Text className="text-xs font-medium text-ink-700">Add a period</Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <View className="w-28">
            <Input value={add.name} onChangeText={(v) => setAdd({ ...add, name: v })} placeholder="Period 9" />
          </View>
          <View className="w-24">
            <Input value={add.startsAt} onChangeText={(v) => setAdd({ ...add, startsAt: v })} />
          </View>
          <View className="w-24">
            <Input value={add.endsAt} onChangeText={(v) => setAdd({ ...add, endsAt: v })} />
          </View>
          <Chip label="Break" active={add.isBreak} onPress={() => setAdd({ ...add, isBreak: !add.isBreak })} />
          <Button
            variant="ghost"
            onPress={async () => {
              if (!add.name.trim()) return;
              await onAdd({ ...add, name: add.name.trim() });
              setAdd({ name: "", startsAt: "15:10", endsAt: "15:50", isBreak: false });
            }}
          >
            Add
          </Button>
        </View>
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
  catalog: string[];
  classes: { id: string; label: string; subjects: { name: string; weightage?: number }[] }[];
  onSaveCatalog: (names: string[], applyToAllClasses: boolean) => Promise<void>;
  onSaveClass: (classId: string, subjects: { name: string; weightage: number }[]) => Promise<void>;
}) {
  const initialNames = [
    ...new Set([
      ...catalog,
      ...classes.flatMap((c) => c.subjects.map((s) => s.name)),
      ...DEFAULT_SUBJECTS.slice(0, 6),
    ].map((s) => s.trim()).filter(Boolean)),
  ];
  const [names, setNames] = useState(initialNames);
  const [custom, setCustom] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>(
    Object.fromEntries(
      classes.map((klass) => [
        klass.id,
        Object.fromEntries(klass.subjects.map((subject) => [subject.name, periodsDraft(subject.weightage)])),
      ])
    )
  );
  const [flash, setFlash] = useState<{ at: "catalog" | "class"; kind: "ok" | "err"; text: string } | null>(null);

  function addSubject(raw: string) {
    const name = raw.trim();
    if (!name || names.includes(name)) return;
    setNames([...names, name]);
    setCustom("");
  }

  function removeSubject(name: string) {
    setNames(names.filter((n) => n !== name));
    setGrid(
      Object.fromEntries(
        Object.entries(grid).map(([classId, cells]) => {
          const next = { ...cells };
          delete next[name];
          return [classId, next];
        })
      )
    );
  }

  function setCell(classId: string, subject: string, value: string) {
    setGrid({
      ...grid,
      [classId]: {
        ...(grid[classId] ?? {}),
        [subject]: value.replace(/\D/g, "").slice(0, 2),
      },
    });
  }

  function sheetCsv(sample = false) {
    const rows = [
      ["Subject"],
      ...(sample && !names.length ? DEFAULT_SUBJECTS.slice(0, 6) : names).map((subject) => [subject]),
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
    if (!header?.length || !String(header[0] || "").toLowerCase().includes("subject")) {
      setFlash({ at: "catalog", kind: "err", text: "Use a CSV with Subject as the first column." });
      return;
    }
    const importedNames = rows.map((row) => row[0]).filter(Boolean);
    if (!importedNames.length) {
      setFlash({ at: "catalog", kind: "err", text: "No subjects found in the sheet." });
      return;
    }
    const nextNames = [...new Set(importedNames)];
    setNames(nextNames);
    setImportOpen(false);
    setFlash({ at: "catalog", kind: "ok", text: "Subjects loaded. Review and save the plan." });
  }

  return (
    <View className="mt-3 gap-3">
      <View className="gap-2 border-b border-ink-100 pb-3">
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <View className="min-w-[12rem] flex-1 flex-row flex-wrap items-center gap-2">
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Subjects</Text>
            <Text className="text-lg font-semibold text-ink-900">{names.length}</Text>
            {names.map((s) => (
              <Chip key={s} label={s} active onPress={() => removeSubject(s)} className="px-2 py-1" />
            ))}
          </View>
          <View className="flex-row flex-wrap gap-2">
            <IconButton icon="add" label="Add subject" onPress={() => setAddOpen(true)} />
            <IconButton icon="cloud-upload-outline" label="Upload subjects" onPress={() => setImportOpen(true)} />
          </View>
        </View>
        <SaveFlash at="catalog" flash={flash} />
      </View>

      {classes.length ? (
        <View className="gap-2">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <View className="flex-row items-center gap-2">
              <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Class plan</Text>
              <Text className="text-xs text-ink-700">Blank = not taught</Text>
            </View>
            <Button
              className="px-5"
              onPress={async () => {
                setFlash(null);
                for (const klass of classes) {
                  const subjects = names
                    .map((name) => ({ name, weightage: parsePeriods(grid[klass.id]?.[name] || "") }))
                    .filter((row): row is { name: string; weightage: number } => row.weightage != null && row.weightage > 0);
                  if (!subjects.length) {
                    setFlash({ at: "class", kind: "err", text: `${klass.label} needs at least one subject.` });
                    return;
                  }
                  const bad = names.find((name) => parsePeriods(grid[klass.id]?.[name] || "") == null);
                  if (bad) {
                    setFlash({ at: "class", kind: "err", text: `${klass.label} ${bad} needs a number or blank.` });
                    return;
                  }
                }
                try {
                  await onSaveCatalog(names, false);
                  for (const klass of classes) {
                    await onSaveClass(
                      klass.id,
                      names
                        .map((name) => ({ name, weightage: parsePeriods(grid[klass.id]?.[name] || "") }))
                        .filter((row): row is { name: string; weightage: number } => row.weightage != null && row.weightage > 0)
                    );
                  }
                  setFlash({ at: "class", kind: "ok", text: "Class plan saved." });
                } catch (e) {
                  setFlash({ at: "class", kind: "err", text: e instanceof Error ? e.message : "Could not save." });
                }
              }}
            >
              Save plan
            </Button>
          </View>
          <View className="overflow-hidden rounded-md border border-ink-200">
            <View className="flex-row bg-ink-50">
              <View className="w-24 border-r border-ink-100 px-3 py-2">
                <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Class</Text>
              </View>
              {names.map((subject) => (
                <View key={subject} className="min-w-[7.25rem] flex-1 border-r border-ink-100 px-2 py-2 last:border-r-0">
                  <Text className="text-center text-xs font-medium text-ink-800">{subject}</Text>
                </View>
              ))}
            </View>
            {classes.map((klass) => (
              <View key={klass.id} className="flex-row border-t border-ink-100">
                <View className="w-24 justify-center border-r border-ink-100 px-3 py-2">
                  <Text className="text-sm font-semibold text-ink-900">{klass.label}</Text>
                </View>
                {names.map((subject) => (
                  <View key={subject} className="min-w-[7.25rem] flex-1 border-r border-ink-100 px-2 py-1.5 last:border-r-0">
                    <Input
                      keyboardType="number-pad"
                      className="py-1 text-center"
                      value={grid[klass.id]?.[subject] || ""}
                      onChangeText={(value) => setCell(klass.id, subject, value)}
                      placeholder="–"
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Button
              variant="ghost"
              onPress={() =>
                setGrid(
                  Object.fromEntries(
                    classes.map((klass) => [
                      klass.id,
                      Object.fromEntries(names.map((name) => [name, grid[klass.id]?.[name] || "4"])),
                    ])
                  )
                )
              }
            >
              Fill blanks with 4
            </Button>
            <Button
              variant="ghost"
              onPress={() =>
                setGrid(
                  Object.fromEntries(
                    classes.map((klass) => [
                      klass.id,
                      Object.fromEntries(names.map((name) => [name, grid[klass.id]?.[name] || ""])),
                    ])
                  )
                )
              }
            >
              Clear blanks
            </Button>
          </View>
          <SaveFlash at="class" flash={flash} />
        </View>
      ) : (
        <Text className="text-sm text-ink-700">Add classes first.</Text>
      )}
      <Modal open={addOpen} title="Add subject" onClose={() => setAddOpen(false)}>
        <View className="gap-3">
          <Field label="Subject name">
            <Input value={custom} onChangeText={setCustom} placeholder="Sanskrit" />
          </Field>
          <View className="flex-row flex-wrap gap-2">
            <Button
              onPress={() => {
                addSubject(custom);
                setAddOpen(false);
              }}
            >
              Add subject
            </Button>
          </View>
          <View className="border-t border-ink-100 pt-3">
            <Text className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-700">Defaults</Text>
            <View className="flex-row flex-wrap gap-2">
              {DEFAULT_SUBJECTS.filter((s) => !names.includes(s)).map((s) => (
                <Chip key={s} label={`+ ${s}`} onPress={() => addSubject(s)} />
              ))}
            </View>
          </View>
        </View>
      </Modal>
      <Modal open={importOpen} title="Upload subjects" onClose={() => setImportOpen(false)} wide>
        <UploadCsvPanel
          description="Upload the subjects this school teaches. Class periods stay in the table."
          requiredColumns="Subject"
          note="Use one subject per row. Existing subjects are replaced after you review and save."
          onBrowse={() => void uploadSheet()}
          onDownloadSample={() => downloadSheet(true)}
        />
      </Modal>
    </View>
  );
}
