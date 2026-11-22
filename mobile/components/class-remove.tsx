import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { act } from "../lib/mutate";
import { Modal } from "./ui";

/**
 * Settings → Classes → a class → Delete class. Checks everything that uses the class first:
 * nothing important → delete (its setup links go with it); students, routine, exams, fees… → say what and where,
 * and offer "Archive" (hidden everywhere, history kept, can be restored).
 */
type Usage = { label: string; canDelete: boolean; blockers: { key: string; label: string; fix: string }[]; links: string[] };

export function ClassRemoveModal({
  classId,
  token,
  onClose,
  onDone,
}: {
  classId: string;
  token: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUsage(null);
    setError("");
    if (!classId) return;
    act<Usage>(token, "classUsage", { classId })
      .then(setUsage)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not check this class."));
  }, [classId, token]);

  async function go(op: "deleteClass" | "archiveClass") {
    if (!usage) return;
    setBusy(true);
    setError("");
    try {
      await act(token, op, { classId });
      onDone(op === "deleteClass" ? `Class ${usage.label} deleted.` : `Class ${usage.label} archived. Restore it any time under Archived classes.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not do that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(classId)} title={usage ? `Delete class ${usage.label}?` : "Delete class"} onClose={onClose}>
      {!usage && !error ? (
        <View className="items-center py-8">
          <ActivityIndicator color="#1F45C7" />
          <Text className="mt-2 text-[13px] text-ink-500">Checking where this class is used…</Text>
        </View>
      ) : null}
      {error ? <Text className="mb-3 text-[13px] text-red-700">{error}</Text> : null}
      {usage ? (
        <View className="gap-3">
          {usage.canDelete ? (
            <View className="flex-row items-start gap-2.5 rounded-xl bg-emerald-50 p-3">
              <Ionicons name="checkmark-circle" size={18} color="#047857" />
              <Text className="min-w-0 flex-1 text-[13px] text-emerald-900">No students, routine, exams or fees use this class. It can be deleted.</Text>
            </View>
          ) : (
            <View className="gap-2">
              <View className="flex-row items-start gap-2.5 rounded-xl bg-amber-50 p-3">
                <Ionicons name="alert-circle" size={18} color="#B45309" />
                <Text className="min-w-0 flex-1 text-[13px] text-amber-900">This class is still in use, so it can't be deleted:</Text>
              </View>
              {usage.blockers.map((b) => (
                <View key={b.key} className="gap-0.5 rounded-xl border border-ink-100 px-3 py-2.5">
                  <Text className="text-[14px] font-semibold text-ink-900">{b.label}</Text>
                  <Text className="text-[12px] text-ink-500">{b.fix}</Text>
                </View>
              ))}
            </View>
          )}

          {usage.canDelete && usage.links.length ? (
            <View className="gap-1">
              <Text className="text-[12px] font-semibold uppercase tracking-wider text-ink-500">Also removed</Text>
              {usage.links.map((l) => (
                <Text key={l} className="text-[13px] text-ink-700">{`• ${l}`}</Text>
              ))}
            </View>
          ) : null}

          <View className="mt-1 flex-row flex-wrap items-center justify-end gap-2">
            <Pressable accessibilityRole="button" onPress={onClose} className="h-10 justify-center rounded-lg px-4">
              <Text className="text-[13px] font-semibold text-ink-700">Cancel</Text>
            </Pressable>
            {usage.canDelete ? (
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void go("deleteClass")} className="h-10 flex-row items-center gap-1.5 rounded-lg bg-red-600 px-4">
                <Ionicons name="trash-outline" size={15} color="#fff" />
                <Text className="text-[13px] font-semibold text-white">{busy ? "Deleting…" : "Delete class"}</Text>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void go("archiveClass")} className="h-10 flex-row items-center gap-1.5 rounded-lg bg-ink-900 px-4">
                <Ionicons name="archive-outline" size={15} color="#fff" />
                <Text className="text-[13px] font-semibold text-white">{busy ? "Archiving…" : "Archive instead"}</Text>
              </Pressable>
            )}
          </View>
          {!usage.canDelete ? (
            <Text className="text-right text-[11px] text-ink-500">Archive hides the class everywhere and keeps its history. You can restore it later.</Text>
          ) : null}
        </View>
      ) : null}
    </Modal>
  );
}

/** Settings → Classes: archived (hidden) classes, with Restore. Shows nothing when there are none. */
export function ArchivedClasses({ token, refreshKey, onRestored }: { token: string | null; refreshKey: number; onRestored: (message: string) => void }) {
  const [rows, setRows] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    act<{ classes: { id: string; label: string }[] }>(token, "archivedClasses", {})
      .then((r) => setRows(r.classes ?? []))
      .catch(() => setRows([]));
  }, [token, refreshKey]);
  if (!rows.length) return null;
  return (
    <View className="gap-2 rounded-2xl border border-dashed border-ink-200 p-3">
      <Text className="text-[12px] font-semibold uppercase tracking-wider text-ink-500">{`Archived classes · ${rows.length}`}</Text>
      {rows.map((c) => (
        <View key={c.id} className="flex-row items-center justify-between gap-2">
          <Text className="text-[14px] text-ink-700">{c.label}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy === c.id}
            onPress={async () => {
              setBusy(c.id);
              try {
                await act(token, "archiveClass", { classId: c.id, restore: true });
                setRows((r) => r.filter((x) => x.id !== c.id));
                onRestored(`Class ${c.label} restored.`);
              } finally {
                setBusy("");
              }
            }}
            className="h-8 justify-center rounded-lg border border-ink-200 bg-white px-3"
          >
            <Text className="text-[12px] font-semibold text-ink-800">{busy === c.id ? "Restoring…" : "Restore"}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
