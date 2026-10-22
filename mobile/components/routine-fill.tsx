/**
 * Routine → "Fill all classes": check if the school has enough teacher time, preview the
 * whole-school fill, apply it in one go, and undo it if needed. Hand-placed periods stay.
 */
import { useEffect, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Modal } from "./ui";
import { Popover } from "./form/popover";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";

type Issue = { level: "error" | "warn"; kind: string; text: string };
type Preview = {
  check: { cellsPerWeek: number; teachers: number; needed: number; capacity: number; issues: Issue[]; ok: boolean };
  filled: number;
  preview: null | {
    needed: number;
    placed: number;
    perClass: { classId: string; label: string; adding: number; missing: number }[];
    unplaced: { classLabel: string; subjectLabel: string; count: number; reason: string }[];
    splitSubjects: string[];
    placements: unknown[];
  };
};

export function FillAllSheet({ open, onClose, onApplied }: { open: boolean; onClose: () => void; onApplied: (ids: string[], added: number) => void }) {
  const { token } = useSession();
  const router = useRouter();
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [anyway, setAnyway] = useState(false);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setError("");
    setAnyway(false);
    setLoading(true);
    act<Preview & { ok: true }>(token, "previewTimetableFill", {})
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not check the timetable."))
      .finally(() => setLoading(false));
  }, [open, token]);

  const check = data?.check;
  const preview = data?.preview;
  const errors = check?.issues.filter((i) => i.level === "error") ?? [];
  const warns = check?.issues.filter((i) => i.level === "warn") ?? [];
  const canApply = Boolean(preview && preview.placed > 0 && (check?.ok || anyway));
  const pct = check && check.needed ? Math.min(100, Math.round((check.capacity / check.needed) * 100)) : 100;

  async function apply() {
    if (!preview) return;
    setSaving(true);
    setError("");
    try {
      const res = await act<{ ok: true; added: number; undoIds: string[] }>(token, "applyTimetableFill", { placements: preview.placements });
      onApplied(res.undoIds, res.added);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      sheetOnPhone
      title="Fill all classes"
      onClose={onClose}
      footer={
        <View className="flex-row items-center justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          {preview && preview.placed > 0 ? (
            <Button disabled={!canApply || saving} onPress={() => void apply()}>
              {saving ? "Saving…" : `Add ${preview.placed} periods`}
            </Button>
          ) : null}
        </View>
      }
    >
      <View className="gap-4">
        {loading ? (
          <View className="items-center py-8">
            <Ionicons name="hourglass-outline" size={20} color="#64748B" />
            <Text className="mt-2 text-[14px] text-ink-700">Checking teachers and periods for every class…</Text>
          </View>
        ) : null}
        {error ? <Text className="text-[13px] text-red-700">{error}</Text> : null}

        {check && !check.needed ? (
          <View className="items-center rounded-xl bg-emerald-50 px-4 py-6">
            <Ionicons name="checkmark-circle" size={22} color="#16a34a" />
            <Text className="mt-2 text-[15px] font-semibold text-emerald-900">Every class is already full</Text>
            <Text className="mt-0.5 text-[13px] text-emerald-800">All subjects have their periods for the week.</Text>
          </View>
        ) : null}

        {check && check.needed ? (
          <>
            <View className="rounded-xl border border-ink-200 bg-white p-4">
              <View className="flex-row items-end justify-between">
                <View>
                  <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Periods still to place</Text>
                  <Text className="mt-0.5 text-[22px] font-bold tabular-nums text-ink-900">{check.needed}</Text>
                </View>
                <View className="items-end">
                  <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Teachers can take</Text>
                  <Text className={`mt-0.5 text-[22px] font-bold tabular-nums ${check.capacity >= check.needed ? "text-emerald-700" : "text-red-700"}`}>{check.capacity}</Text>
                </View>
              </View>
              <View className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100">
                <View className={`h-full rounded-full ${check.capacity >= check.needed ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
              </View>
              <Text className="mt-2 text-[12px] text-ink-500">
                {`${check.teachers} teachers × ${check.cellsPerWeek} periods a week, minus periods already placed. Nothing to set up.`}
              </Text>
            </View>

            {errors.length ? (
              <View className="gap-2">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-red-700">{`Fix first · ${errors.length}`}</Text>
                {errors.map((issue) => (
                  <View key={issue.text} className="flex-row items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
                    <Ionicons name="close-circle" size={16} color="#dc2626" />
                    <Text className="flex-1 text-[13px] leading-5 text-red-900">{issue.text}</Text>
                  </View>
                ))}
                <View className="flex-row flex-wrap gap-2">
                  <Button variant="ghost" className="anekio-btn h-9 px-3 py-1.5" onPress={() => { onClose(); router.push("/school?tab=subjects" as never); }}>
                    Subjects & periods
                  </Button>
                  <Button variant="ghost" className="anekio-btn h-9 px-3 py-1.5" onPress={() => { onClose(); router.push("/staff" as never); }}>
                    Teachers
                  </Button>
                </View>
              </View>
            ) : (
              <View className="flex-row items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5">
                <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
                <Text className="flex-1 text-[13px] text-emerald-900">Enough teachers for every subject in every class.</Text>
              </View>
            )}
            {warns.map((issue) => (
              <View key={issue.text} className="flex-row items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
                <Ionicons name="alert-circle" size={16} color="#d97706" />
                <Text className="flex-1 text-[13px] text-amber-900">{issue.text}</Text>
              </View>
            ))}

            {preview ? (
              <View className="gap-2">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Preview · nothing saved yet</Text>
                <Text className="text-[14px] text-ink-900">
                  {preview.placed === preview.needed
                    ? `All ${preview.placed} periods fit, with no teacher in two classes at once.`
                    : `${preview.placed} of ${preview.needed} periods fit. ${preview.needed - preview.placed} could not be placed.`}
                </Text>
                <View className="flex-row flex-wrap gap-1.5">
                  {preview.perClass.map((c) => (
                    <View key={c.classId} className={`rounded-md px-2 py-1 ${c.missing ? "bg-amber-50" : "bg-ink-50"}`}>
                      <Text className={`text-[12px] ${c.missing ? "text-amber-900" : "text-ink-700"}`}>
                        {`${c.label} +${c.adding}${c.missing ? ` · ${c.missing} left` : ""}`}
                      </Text>
                    </View>
                  ))}
                </View>
                {preview.unplaced.length ? (
                  <View className="gap-1 rounded-lg bg-amber-50 px-3 py-2">
                    {preview.unplaced.slice(0, 8).map((u) => (
                      <Text key={`${u.classLabel}${u.subjectLabel}`} className="text-[12px] text-amber-900">
                        {`${u.classLabel} ${u.subjectLabel} (${u.count}): ${u.reason}`}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {preview.splitSubjects.length ? (
                  <Text className="text-[12px] text-ink-500">{`Shared between two teachers to make it fit: ${preview.splitSubjects.join(", ")}`}</Text>
                ) : null}
                <Text className="text-[12px] text-ink-500">Periods you placed by hand stay where they are. You can undo after saving.</Text>
                {!check.ok && preview.placed > 0 ? (
                  <Pressable onPress={() => setAnyway(!anyway)} className="flex-row items-center gap-2 py-1">
                    <Ionicons name={anyway ? "checkbox" : "square-outline"} size={18} color={anyway ? "#1F45C7" : "#94A3B8"} />
                    <Text className="text-[13px] text-ink-700">Fill what fits now, fix the rest later</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </Modal>
  );
}

export type ClearSnapshot = { slots: unknown[]; changes: unknown[] };

/** Clear the weekly timetable of one class or all classes, with counts up front. Undo lives on the board. */
export function ClearSheet({
  open,
  klass,
  canAll,
  onClose,
  onCleared,
}: {
  open: boolean;
  klass: { id: string; label: string } | null;
  canAll: boolean;
  onClose: () => void;
  onCleared: (snapshot: ClearSnapshot, removed: number, label: string) => void;
}) {
  const { token } = useSession();
  const [scope, setScope] = useState<"class" | "all">("class");
  const [counts, setCounts] = useState<{ class?: { periods: number; changes: number }; all?: { periods: number; changes: number } }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setScope("class");
    setError("");
    setCounts({});
    const load = async () => {
      const next: typeof counts = {};
      if (klass?.id) next.class = await act<{ ok: true; periods: number; changes: number }>(token, "countTimetableClear", { classId: klass.id });
      if (canAll) next.all = await act<{ ok: true; periods: number; changes: number }>(token, "countTimetableClear", {});
      setCounts(next);
    };
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not count periods."));
  }, [open, klass?.id, canAll, token]);

  const chosen = scope === "all" ? counts.all : counts.class;
  const label = scope === "all" ? "all classes" : klass?.label || "this class";

  async function clear() {
    setBusy(true);
    setError("");
    try {
      const res = await act<{ ok: true; removed: number; snapshot: ClearSnapshot }>(token, "clearTimetable", scope === "all" ? {} : { classId: klass?.id });
      onCleared(res.snapshot, res.removed, label);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear.");
    } finally {
      setBusy(false);
    }
  }

  const options: { key: "class" | "all"; title: string; n?: { periods: number; changes: number } }[] = [
    ...(klass ? [{ key: "class" as const, title: `Only ${klass.label}`, n: counts.class }] : []),
    ...(canAll ? [{ key: "all" as const, title: "All classes", n: counts.all }] : []),
  ];

  return (
    <Modal
      open={open}
      sheetOnPhone
      title="Clear timetable"
      onClose={onClose}
      footer={
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy || !chosen?.periods} onPress={() => void clear()}>
            {busy ? "Clearing…" : chosen ? `Remove ${chosen.periods} periods` : "Remove"}
          </Button>
        </View>
      }
    >
      <View className="gap-3">
        <Text className="text-[13px] text-ink-600">The weekly timetable for these classes becomes empty. Subjects, teachers and periods per week stay as they are.</Text>
        {options.map((o) => {
          const on = scope === o.key;
          return (
            <Pressable
              key={o.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setScope(o.key)}
              className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${on ? "border-red-300 bg-red-50" : "border-ink-200 bg-white"}`}
            >
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={16} color={on ? "#dc2626" : "#94A3B8"} />
              <Text className="flex-1 text-[14px] font-medium text-ink-900">{o.title}</Text>
              <Text className="text-[13px] tabular-nums text-ink-600">{o.n ? `${o.n.periods} periods` : "…"}</Text>
            </Pressable>
          );
        })}
        {chosen?.changes ? (
          <View className="flex-row items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
            <Ionicons name="alert-circle" size={15} color="#d97706" />
            <Text className="flex-1 text-[13px] text-amber-900">{`${chosen.changes} one-day changes (covers, "this day only") are linked to these periods and will be removed too. Undo brings them back.`}</Text>
          </View>
        ) : null}
        <Text className="text-[12px] text-ink-500">You can undo right after. Undo works until you leave or reload this page.</Text>
        {error ? <Text className="text-[13px] text-red-700">{error}</Text> : null}
      </View>
    </Modal>
  );
}

export type MenuItem = { key: string; label: string; hint?: string; icon: keyof typeof Ionicons.glyphMap; danger?: boolean; onPress: () => void };

/** A button that opens a short menu. Keeps the Routine header to two buttons. */
export function MenuButton({ label, icon, primary, small, items }: { label?: string; icon?: keyof typeof Ionicons.glyphMap; primary?: boolean; small?: boolean; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const tint = primary ? "#FFFFFF" : "#334155";
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      minWidth={240}
      panel={
        <View className="py-1">
          {items.map((item, i) => (
            <Pressable
              key={item.key}
              accessibilityRole="menuitem"
              onPress={() => {
                setOpen(false);
                item.onPress();
              }}
              className={`flex-row items-center gap-3 px-3 py-2.5 active:bg-ink-50 ${item.danger && i ? "mt-1 border-t border-ink-100" : ""}`}
            >
              <Ionicons name={item.icon} size={16} color={item.danger ? "#b91c1c" : "#475569"} />
              <View className="min-w-0 flex-1">
                <Text className={`text-[14px] ${item.danger ? "text-red-700" : "text-ink-900"}`}>{item.label}</Text>
                {item.hint ? <Text className="text-[12px] text-ink-500">{item.hint}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label || "More actions"}
        onPress={() => setOpen((v) => !v)}
        hitSlop={small ? 6 : undefined}
        className={
          small
            ? "flex-row items-center gap-1 rounded-full bg-[#1F45C7] px-2.5 py-1"
            : `h-10 flex-row items-center gap-1.5 rounded-md px-3 ${primary ? "bg-clay-500" : "border border-ink-200 bg-white"}`
        }
      >
        {icon ? <Ionicons name={icon} size={small ? 11 : 16} color={tint} /> : null}
        {label ? <Text className={small ? "text-[11px] font-semibold text-white" : `text-sm font-medium ${primary ? "text-white" : "text-ink-800"}`}>{label}</Text> : null}
        {label ? <Ionicons name="chevron-down" size={small ? 10 : 14} color={tint} /> : null}
      </Pressable>
    </Popover>
  );
}

/** Small outlined button with an icon and a short label, for the Routine header. */
export function IconButton({ icon, label, danger, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`h-10 flex-row items-center gap-1.5 rounded-md border bg-white px-3 active:opacity-80 ${danger ? "border-red-200 hover:bg-red-50" : "border-ink-200 hover:bg-ink-50"}`}
    >
      <Ionicons name={icon} size={16} color={danger ? "#b91c1c" : "#475569"} />
      <Text className={`text-sm font-medium ${danger ? "text-red-700" : "text-ink-800"}`}>{label}</Text>
    </Pressable>
  );
}
