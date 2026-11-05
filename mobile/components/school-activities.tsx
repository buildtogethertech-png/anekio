import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Button, Modal } from "./ui";

export type ClassActivity = { name: string; perWeek: number };

function same(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <View className="flex-row items-center justify-center gap-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Fewer ${label} periods`}
        disabled={value <= 1}
        onPress={() => onChange(Math.max(1, value - 1))}
        className={`h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white ${value <= 1 ? "opacity-40" : ""}`}
      >
        <Text className="text-base text-ink-700">−</Text>
      </Pressable>
      <Text accessibilityLabel={`${label} periods per week`} className="w-10 text-center text-sm font-semibold text-ink-900">
        {value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`More ${label} periods`}
        disabled={value >= 20}
        onPress={() => onChange(Math.min(20, value + 1))}
        className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white"
      >
        <Text className="text-base text-ink-700">+</Text>
      </Pressable>
    </View>
  );
}

/**
 * Settings → Subjects → class curriculum: the class's activities (Games 2 a week, Library 1…).
 * Saved on its own; never part of exams.
 */
export function ClassActivitiesSection({
  classLabel,
  catalog,
  plan,
  placed,
  onSave,
  onManage,
}: {
  classLabel: string;
  catalog: string[];
  plan: ClassActivity[];
  /** Periods already in the timetable per activity name. */
  placed: Record<string, number>;
  onSave: (plan: ClassActivity[]) => Promise<void>;
  onManage: () => void;
}) {
  const [rows, setRows] = useState<ClassActivity[]>(plan);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(rows) !== JSON.stringify(plan);
  const addable = catalog.filter((name) => !rows.some((row) => same(row.name, name)));

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="mt-4 gap-2" testID="class-activities">
      <View className="flex-row flex-wrap items-center gap-2">
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-ink-900">{`${classLabel} — Activities`}</Text>
          <Text className="text-xs text-ink-500">Games, Library, Assembly… Placed in the routine, never in exams or report cards.</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onManage} className="flex-row items-center gap-1 rounded-md px-2 py-1">
          <Ionicons name="list-outline" size={15} color="#2563eb" />
          <Text className="text-sm font-medium text-clay-600">Manage activities</Text>
        </Pressable>
      </View>
      <View className="overflow-hidden rounded-lg border border-ink-200 bg-white">
        <View className="flex-row items-center gap-3 border-b border-ink-100 bg-ink-50 px-3 py-2">
          <Text className="min-w-0 flex-1 text-xs font-medium uppercase tracking-wide text-ink-700">Activity</Text>
          <Text className="w-28 text-center text-xs font-medium uppercase tracking-wide text-ink-700">Periods/week</Text>
          <View className="w-8" />
        </View>
        {rows.map((row, index) => {
          const inRoutine = placed[row.name.toLowerCase()] || 0;
          return (
            <View key={row.name} className={`flex-row items-center gap-3 px-3 py-2 ${index ? "border-t border-ink-100" : ""}`}>
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] text-ink-900">{row.name}</Text>
                {inRoutine ? <Text className="text-xs text-ink-500">{`${inRoutine} in the routine`}</Text> : null}
              </View>
              <View className="w-28 items-center">
                <Stepper
                  label={row.name}
                  value={row.perWeek}
                  onChange={(value) => setRows((cur) => cur.map((r, i) => (i === index ? { ...r, perWeek: value } : r)))}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${row.name}`}
                onPress={() => setRows((cur) => cur.filter((_, i) => i !== index))}
                className="h-8 w-8 items-center justify-center"
              >
                <Text className="text-ink-700">×</Text>
              </Pressable>
            </View>
          );
        })}
        {!rows.length ? (
          <Text className="px-3 py-3 text-sm text-ink-600">No activities on this class yet.</Text>
        ) : null}
        <View className="border-t border-ink-100 px-3 py-2">
          {adding ? (
            addable.length ? (
              <View className="flex-row flex-wrap gap-1.5">
                {addable.map((name) => (
                  <Pressable
                    key={name}
                    accessibilityRole="button"
                    onPress={() => {
                      setRows((cur) => [...cur, { name, perWeek: 1 }]);
                      setAdding(false);
                    }}
                    className="h-8 flex-row items-center gap-1 rounded-full border border-ink-200 bg-white px-3"
                  >
                    <Ionicons name="add" size={14} color="#475569" />
                    <Text className="text-[13px] text-ink-800">{name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text className="text-sm text-ink-600">All school activities are on this class. Add more in Manage activities.</Text>
            )
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setAdding(true)} className="self-start py-1">
              <Text className="text-sm font-medium text-clay-600">+ Add activity</Text>
            </Pressable>
          )}
        </View>
      </View>
      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      {dirty ? (
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={() => setRows(plan)}>
            Discard
          </Button>
          <Button onPress={() => void save()} disabled={saving}>
            {saving ? "Saving…" : `Save ${classLabel} activities`}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

/** "Manage activities": the school's list. Rename keeps the old name so class plans and the routine follow. */
export function ActivityCatalogModal({
  open,
  catalog,
  onClose,
  onSave,
}: {
  open: boolean;
  catalog: string[];
  onClose: () => void;
  onSave: (entries: { name: string; previousName?: string }[]) => Promise<void>;
}) {
  const [rows, setRows] = useState(() => catalog.map((name) => ({ name, previousName: name })));
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function add() {
    const name = draft.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name) return;
    if (rows.some((row) => same(row.name, name))) {
      setError(`${name} is already on the list.`);
      return;
    }
    setRows((cur) => [...cur, { name, previousName: "" }]);
    setDraft("");
    setError("");
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(rows.map((row) => ({ name: row.name.trim(), previousName: row.previousName || undefined })));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Activities"
      onClose={onClose}
      sheetOnPhone
      footer={
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button onPress={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </View>
      }
    >
      <View className="gap-3">
        <Text className="text-[13px] text-ink-600">Periods that are not subjects. They can go in the routine but never show up in exams, marks or report cards.</Text>
        <View className="overflow-hidden rounded-lg border border-ink-200">
          {rows.map((row, index) => (
            <View key={`${row.previousName}-${index}`} className={`flex-row items-center gap-2 px-3 py-1.5 ${index ? "border-t border-ink-100" : ""}`}>
              <TextInput
                accessibilityLabel={`Activity ${index + 1} name`}
                value={row.name}
                maxLength={40}
                onChangeText={(name) => setRows((cur) => cur.map((r, i) => (i === index ? { ...r, name } : r)))}
                className="h-9 min-w-0 flex-1 text-[15px] text-ink-900"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${row.name}`}
                onPress={() => setRows((cur) => cur.filter((_, i) => i !== index))}
                className="h-8 w-8 items-center justify-center"
              >
                <Text className="text-ink-700">×</Text>
              </Pressable>
            </View>
          ))}
          {!rows.length ? <Text className="px-3 py-3 text-sm text-ink-600">No activities yet.</Text> : null}
        </View>
        <View className="flex-row gap-2">
          <TextInput
            accessibilityLabel="New activity"
            value={draft}
            maxLength={40}
            onChangeText={setDraft}
            onSubmitEditing={add}
            placeholder="e.g. Yoga, Robotics club"
            className="h-10 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[14px] text-ink-900"
          />
          <Button variant="ghost" onPress={add}>
            Add
          </Button>
        </View>
        {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      </View>
    </Modal>
  );
}
