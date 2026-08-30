import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Chip, Field, Input } from "./ui";

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
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
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
  const [names, setNames] = useState(catalog);
  const [custom, setCustom] = useState("");
  const [classId, setClassId] = useState(classes[0]?.id || "");
  const klass = classes.find((c) => c.id === classId) || classes[0];
  const [rows, setRows] = useState(
    (klass?.subjects ?? []).map((s) => ({ name: s.name, weightage: periodsDraft(s.weightage) }))
  );
  const [flash, setFlash] = useState<{ at: "catalog" | "class"; kind: "ok" | "err"; text: string } | null>(null);

  function pickClass(id: string) {
    const next = classes.find((c) => c.id === id);
    setClassId(id);
    setFlash(null);
    setRows((next?.subjects ?? []).map((s) => ({ name: s.name, weightage: periodsDraft(s.weightage) })));
  }

  return (
    <View className="mt-4 gap-5">
      <View className="gap-2">
        <Text className="text-xs font-medium text-ink-700">School subjects</Text>
        <Text className="text-sm text-ink-700">
          Set once at the start. New classes get this list. Add a name only when the school starts teaching it.
        </Text>
        <View className="flex-row flex-wrap gap-1.5">
          {names.map((s) => (
            <Chip key={s} label={s} active onPress={() => setNames(names.filter((n) => n !== s))} />
          ))}
        </View>
        <View className="flex-row flex-wrap gap-1.5">
          {DEFAULT_SUBJECTS.filter((s) => !names.includes(s)).map((s) => (
            <Chip key={s} label={`+ ${s}`} onPress={() => setNames([...names, s])} />
          ))}
        </View>
        <View className="flex-row flex-wrap items-end gap-2">
          <View className="min-w-[10rem] flex-1">
            <Field label="Or type a subject">
              <Input value={custom} onChangeText={setCustom} placeholder="Sanskrit" />
            </Field>
          </View>
          <Button
            variant="ghost"
            onPress={() => {
              const name = custom.trim();
              if (!name || names.includes(name)) return;
              setNames([...names, name]);
              setCustom("");
            }}
          >
            Add
          </Button>
        </View>
        <SaveFlash at="catalog" flash={flash} />
        <View className="flex-row flex-wrap gap-2">
          <Button
            onPress={async () => {
              setFlash(null);
              try {
                await onSaveCatalog(names, false);
                setFlash({ at: "catalog", kind: "ok", text: "Saved successfully." });
              } catch (e) {
                setFlash({ at: "catalog", kind: "err", text: e instanceof Error ? e.message : "Could not save." });
              }
            }}
          >
            Save subjects
          </Button>
          <Button
            variant="ghost"
            onPress={async () => {
              setFlash(null);
              try {
                await onSaveCatalog(names, true);
                setFlash({ at: "catalog", kind: "ok", text: "Saved successfully." });
              } catch (e) {
                setFlash({ at: "catalog", kind: "err", text: e instanceof Error ? e.message : "Could not save." });
              }
            }}
          >
            Put on every class
          </Button>
        </View>
      </View>

      {klass ? (
        <View className="gap-2 border-t border-ink-100 pt-4">
          <Text className="text-xs font-medium text-ink-700">This class</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {classes.map((c) => (
              <Chip key={c.id} label={c.label} active={klass.id === c.id} onPress={() => pickClass(c.id)} />
            ))}
          </View>
          {rows.map((row) => (
            <View key={row.name} className="flex-row items-center gap-3 rounded-md border border-ink-200 px-3 py-2">
              <Text className="flex-1 text-sm font-medium text-ink-900">{row.name}</Text>
              <Text className="text-xs text-ink-700">Periods / week</Text>
              <Input
                keyboardType="number-pad"
                className="w-16 py-1"
                value={row.weightage}
                onChangeText={(v) =>
                  setRows(rows.map((r) => (r.name === row.name ? { ...r, weightage: v.replace(/\D/g, "").slice(0, 2) } : r)))
                }
              />
              <Pressable onPress={() => setRows(rows.filter((r) => r.name !== row.name))}>
                <Text className="text-xs text-ink-700">Remove</Text>
              </Pressable>
            </View>
          ))}
          <View className="flex-row flex-wrap gap-1.5">
            {names
              .filter((s) => !rows.some((r) => r.name === s))
              .map((s) => (
                <Chip key={s} label={`+ ${s}`} onPress={() => setRows([...rows, { name: s, weightage: "4" }])} />
              ))}
          </View>
          <SaveFlash at="class" flash={flash} />
          <Button
            onPress={async () => {
              setFlash(null);
              const missing = rows.find((r) => parsePeriods(r.weightage) == null);
              if (missing) {
                setFlash({ at: "class", kind: "err", text: `${missing.name} needs periods / week — a number from 1.` });
                return;
              }
              try {
                await onSaveClass(
                  klass.id,
                  rows.map((r) => ({ name: r.name, weightage: parsePeriods(r.weightage) as number }))
                );
                setFlash({ at: "class", kind: "ok", text: "Saved successfully." });
              } catch (e) {
                setFlash({ at: "class", kind: "err", text: e instanceof Error ? e.message : "Could not save." });
              }
            }}
          >
            Save {klass.label}
          </Button>
        </View>
      ) : (
        <Text className="text-sm text-ink-700">Add a class under Identity first.</Text>
      )}
    </View>
  );
}
