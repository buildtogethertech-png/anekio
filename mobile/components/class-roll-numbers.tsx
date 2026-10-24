import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Modal } from "./ui";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";

type RollStudent = { id: string; name: string; admissionNo?: string; rollNumber?: number | null };

/**
 * Class teacher (or office) fixes this year's roll numbers for one class.
 * Quick ways: A–Z by name from a start number, or keep the current order and renumber from a start number.
 * Rows can also be moved up / down (swaps their rolls) or typed one by one. Saves only what changed.
 */
export function ClassRollNumbers({
  open,
  onClose,
  classId,
  classLabel,
  students,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  classId: string;
  classLabel?: string;
  students: RollStudent[];
  onSaved: (message: string) => void | Promise<void>;
}) {
  const { token } = useSession();
  const [order, setOrder] = useState<string[]>([]);
  const [rolls, setRolls] = useState<Record<string, string>>({});
  const [start, setStart] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const studentsRef = useRef(students);
  studentsRef.current = students;

  // Fresh copy each time the window opens: sorted by current roll, students without one last.
  useEffect(() => {
    if (!open) return;
    // Only on open: a background refresh of the class must not wipe edits in progress.
    const sorted = [...studentsRef.current].sort(
      (a, b) => (a.rollNumber || 99999) - (b.rollNumber || 99999) || a.name.localeCompare(b.name)
    );
    setOrder(sorted.map((s) => s.id));
    setRolls(Object.fromEntries(sorted.map((s) => [s.id, s.rollNumber ? String(s.rollNumber) : ""])));
    setStart("1");
    setError("");
  }, [open]);

  const startNo = Math.max(1, Number.parseInt(start, 10) || 1);

  function numberFrom(ids: string[]) {
    setError("");
    setOrder(ids);
    setRolls(Object.fromEntries(ids.map((id, i) => [id, String(startNo + i)])));
  }

  function sortByName() {
    numberFrom([...order].sort((a, b) => (byId.get(a)?.name || "").localeCompare(byId.get(b)?.name || "")));
  }

  function move(index: number, dir: -1 | 1) {
    const to = index + dir;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[index], next[to]] = [next[to], next[index]];
    // Moving a student swaps the two roll numbers, so the list stays in roll order.
    const a = order[index];
    const b = order[to];
    setRolls((prev) => ({ ...prev, [a]: prev[b], [b]: prev[a] }));
    setOrder(next);
    setError("");
  }

  const counts = new Map<string, number>();
  for (const id of order) {
    const v = (rolls[id] || "").trim();
    if (v) counts.set(v, (counts.get(v) || 0) + 1);
  }
  const problem = (() => {
    for (const id of order) {
      const v = (rolls[id] || "").trim();
      const n = Number(v);
      if (!v) return `Give ${byId.get(id)?.name || "every student"} a roll number.`;
      if (!Number.isInteger(n) || n < 1 || n > 9999) return `Roll ${v} is not a valid number.`;
      if ((counts.get(v) || 0) > 1) return `Roll ${v} is given to two students.`;
    }
    return "";
  })();
  const changed = order.filter((id) => String(byId.get(id)?.rollNumber || "") !== (rolls[id] || "").trim());

  async function save() {
    if (problem) {
      setError(problem);
      return;
    }
    if (!changed.length) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await act(token, "setClassRollNumbers", {
        classId,
        rolls: changed.map((id) => ({ studentId: id, rollNumber: Number(rolls[id]) })),
      });
      onClose();
      await onSaved(`Roll numbers saved · ${changed.length} changed`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Roll numbers${classLabel ? ` · ${classLabel}` : ""}`}
      onClose={onClose}
      wide
      sheetOnPhone
      footer={
        <View className="gap-2">
          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
          <View className="flex-row items-center justify-between gap-2">
            <Text className="flex-1 text-xs text-ink-600">
              {changed.length ? `${changed.length} change${changed.length === 1 ? "" : "s"} · this academic year only` : "No changes yet"}
            </Text>
            <Button variant="ghost" onPress={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || !changed.length} onPress={save}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </View>
        </View>
      }
    >
      <View className="gap-4">
        <View className="gap-2 rounded-lg border border-ink-100 bg-ink-50/60 p-3">
          <Text className="text-sm font-semibold text-ink-900">Renumber the class</Text>
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-sm text-ink-700">Start from</Text>
            <TextInput
              value={start}
              onChangeText={(v) => setStart(v.replace(/\D/g, "").slice(0, 4))}
              keyboardType="number-pad"
              accessibilityLabel="Start roll numbers from"
              className="w-16 rounded-md border border-ink-200 bg-white px-2 py-1.5 text-center text-sm text-ink-900"
            />
            <Button variant="ghost" onPress={sortByName}>
              A–Z by name
            </Button>
            <Button variant="ghost" onPress={() => numberFrom(order)}>
              Keep this order
            </Button>
          </View>
          <Text className="text-xs text-ink-600">Or move students with the arrows, or type a roll number. Nothing is saved until you press Save.</Text>
        </View>

        <View className="overflow-hidden rounded-lg border border-ink-100">
          {order.map((id, index) => {
            const s = byId.get(id);
            if (!s) return null;
            const value = rolls[id] || "";
            const dup = Boolean(value.trim()) && (counts.get(value.trim()) || 0) > 1;
            const was = s.rollNumber ? String(s.rollNumber) : "";
            const edited = was !== value.trim();
            return (
              <View key={id} className={`flex-row items-center gap-2 px-3 py-2 ${index ? "border-t border-ink-100" : ""}`}>
                <TextInput
                  value={value}
                  onChangeText={(v) => {
                    setError("");
                    setRolls((prev) => ({ ...prev, [id]: v.replace(/\D/g, "").slice(0, 4) }));
                  }}
                  keyboardType="number-pad"
                  accessibilityLabel={`Roll number for ${s.name}`}
                  className={`w-14 rounded-md border px-2 py-1.5 text-center text-sm font-semibold ${
                    dup ? "border-red-400 bg-red-50 text-red-700" : edited ? "border-[#1F45C7] bg-[#EEF3FF] text-[#1F45C7]" : "border-ink-200 bg-white text-ink-900"
                  }`}
                />
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text className="text-xs text-ink-500" numberOfLines={1}>
                    {[s.admissionNo, edited && was ? `was ${was}` : ""].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${s.name} up`}
                  disabled={index === 0}
                  onPress={() => move(index, -1)}
                  hitSlop={6}
                  className={`h-8 w-8 items-center justify-center rounded-md border border-ink-200 ${index === 0 ? "opacity-30" : ""}`}
                >
                  <Ionicons name="chevron-up" size={16} color="#334155" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${s.name} down`}
                  disabled={index === order.length - 1}
                  onPress={() => move(index, 1)}
                  hitSlop={6}
                  className={`h-8 w-8 items-center justify-center rounded-md border border-ink-200 ${index === order.length - 1 ? "opacity-30" : ""}`}
                >
                  <Ionicons name="chevron-down" size={16} color="#334155" />
                </Pressable>
              </View>
            );
          })}
          {!order.length ? <Text className="px-3 py-6 text-center text-sm text-ink-600">No students in this class yet.</Text> : null}
        </View>
      </View>
    </Modal>
  );
}
