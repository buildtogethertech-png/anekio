import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { SchoolDaySettings } from "../lib/record";
import { Button, Switch } from "./ui";

const DEFAULTS: SchoolDaySettings = {
  enabled: false,
  breakDuringClass: "never",
  endsAt: "last_period",
  breakReasons: ["Free period", "Lunch", "Personal call", "Office work"],
  openAppSeconds: 30,
};

const OPEN_APP_CHOICES = [
  { s: 15, label: "15 sec" },
  { s: 30, label: "30 sec" },
  { s: 60, label: "1 min" },
  { s: 120, label: "2 min" },
  { s: 300, label: "5 min" },
];

function Choice({ on, title, hint, onPress }: { on: boolean; title: string; hint: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      className={`flex-row items-start gap-3 rounded-xl border px-3.5 py-3 ${on ? "border-[#2855F6] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
    >
      <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={18} color={on ? "#2855F6" : "#94A3B8"} style={{ marginTop: 1 }} />
      <View className="min-w-0 flex-1">
        <Text className={`text-[14px] font-semibold ${on ? "text-[#1F45C7]" : "text-ink-900"}`}>{title}</Text>
        <Text className="mt-0.5 text-[12px] text-ink-600">{hint}</Text>
      </View>
    </Pressable>
  );
}

/** Settings → HR & Payroll → Teacher phones. */
export function SchoolDaySettingsForm({
  value,
  canEdit,
  onSave,
}: {
  value?: SchoolDaySettings | null;
  canEdit: boolean;
  onSave: (next: SchoolDaySettings) => Promise<void>;
}) {
  const start = value ?? DEFAULTS;
  const [draft, setDraft] = useState<SchoolDaySettings>(start);
  const [newReason, setNewReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(start);
  const fixed = draft.endsAt !== "last_period";
  const set = (patch: Partial<SchoolDaySettings>) => setDraft((cur) => ({ ...cur, ...patch }));

  function addReason() {
    const r = newReason.replace(/\s+/g, " ").trim().slice(0, 40);
    if (!r || draft.breakReasons.some((x) => x.toLowerCase() === r.toLowerCase())) return;
    set({ breakReasons: [...draft.breakReasons, r] });
    setNewReason("");
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="w-full gap-5" style={{ maxWidth: 720 }} testID="school-day-settings">
      <View className="flex-row items-start gap-3 rounded-2xl border border-ink-200 bg-white p-4">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#EEF3FF]">
          <Ionicons name="phone-portrait-outline" size={20} color="#1F45C7" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-ink-900">Keep teachers' phones on Anekio</Text>
          <Text className="mt-0.5 text-[13px] leading-5 text-ink-600">
            From a teacher's check-in until the day ends, other apps on their phone are paused. Anekio keeps working as usual. Breaks are recorded. Android only.
          </Text>
        </View>
        <Switch on={draft.enabled} onPress={() => set({ enabled: !draft.enabled })} disabled={!canEdit} />
      </View>

      {draft.enabled ? (
        <>
          <View className="gap-2">
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Break during a class</Text>
            <Choice
              on={draft.breakDuringClass === "never"}
              title="Not allowed"
              hint="While one of their classes is on, the phone stays on Anekio. Breaks only in free periods."
              onPress={() => canEdit && set({ breakDuringClass: "never" })}
            />
            <Choice
              on={draft.breakDuringClass === "with_reason"}
              title="Allowed"
              hint="Teachers can take a break any time, even during a class."
              onPress={() => canEdit && set({ breakDuringClass: "with_reason" })}
            />
          </View>

          <View className="gap-2">
            <View>
              <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Apps opened from Anekio</Text>
              <Text className="mt-0.5 text-[12px] text-ink-500">
                When a teacher opens WhatsApp, a call or a link from Anekio, that app stays free for this long. A call stays free until it ends.
              </Text>
            </View>
            <View className="flex-row flex-wrap gap-1.5">
              {OPEN_APP_CHOICES.map((c) => {
                const on = (draft.openAppSeconds ?? 30) === c.s;
                return (
                  <Pressable
                    key={c.s}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Free for ${c.label}`}
                    onPress={() => canEdit && set({ openAppSeconds: c.s })}
                    className={`h-9 items-center justify-center rounded-full border px-4 ${on ? "border-[#2855F6] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                  >
                    <Text className={`text-[13px] font-semibold ${on ? "text-[#1F45C7]" : "text-ink-700"}`}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="gap-2">
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Day ends</Text>
            <Choice on={!fixed} title="After the last period" hint="Uses the school's bell times." onPress={() => canEdit && set({ endsAt: "last_period" })} />
            <Choice on={fixed} title="At a fixed time" hint="Same time every school day." onPress={() => canEdit && !fixed && set({ endsAt: "14:30" })} />
            {fixed ? (
              <View className="flex-row items-center gap-2 pl-1">
                <Text className="text-[13px] text-ink-600">Ends at</Text>
                <TextInput
                  value={draft.endsAt}
                  editable={canEdit}
                  onChangeText={(t) => set({ endsAt: t.replace(/[^\d:]/g, "").slice(0, 5) })}
                  placeholder="14:30"
                  className="h-10 w-24 rounded-lg border border-ink-200 bg-white px-3 text-center text-[15px] text-ink-900"
                />
                <Text className="text-[12px] text-ink-500">24-hour, like 14:30</Text>
              </View>
            ) : null}
          </View>

          <View className="gap-2">
            <View>
              <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Break reasons</Text>
              <Text className="mt-0.5 text-[12px] text-ink-500">Every break needs a reason. Teachers pick one of these or write their own.</Text>
            </View>
            <View className="flex-row flex-wrap gap-1.5">
              {draft.breakReasons.map((r) => (
                <View key={r} className="h-8 flex-row items-center gap-1 rounded-full border border-ink-200 bg-white pl-3 pr-1.5">
                  <Text className="text-[13px] text-ink-800">{r}</Text>
                  {canEdit ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${r}`}
                      onPress={() => set({ breakReasons: draft.breakReasons.filter((x) => x !== r) })}
                      hitSlop={6}
                    >
                      <Ionicons name="close" size={14} color="#64748B" />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              <View className="h-8 flex-row items-center rounded-full border border-dashed border-ink-300 bg-white px-3">
                <Text className="text-[13px] text-ink-500">Other (teacher writes it)</Text>
              </View>
            </View>
            {canEdit ? (
              <View className="flex-row gap-2">
                <TextInput
                  value={newReason}
                  onChangeText={setNewReason}
                  onSubmitEditing={addReason}
                  placeholder="Add a reason, e.g. Parent meeting"
                  maxLength={40}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 text-[14px] text-ink-900"
                />
                <Button variant="ghost" onPress={addReason}>
                  Add
                </Button>
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      {canEdit && dirty ? (
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={() => setDraft(start)}>
            Discard
          </Button>
          <Button onPress={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </View>
      ) : null}
    </View>
  );
}
