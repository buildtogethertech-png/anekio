import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

/**
 * Timetable → Activities tab: put one of the class's activities (Games, Library…) in a period.
 * The list and periods/week come from Settings → Subjects → Activities. The teacher is optional.
 */
export function ActivityPicker({
  classId,
  classLabel,
  activities,
  teachers,
  busyTeacherIds,
  current,
  onPick,
}: {
  classId: string;
  classLabel: string;
  /** The class's activities with how many are already in the routine. */
  activities: { name: string; perWeek: number; placed: number }[];
  /** `activities`: what each teacher takes per class; they are listed first for that activity in this class. */
  teachers: { id: string; name: string; activities?: { name: string; classId: string }[] }[];
  /** Teachers already in another class in this period. */
  busyTeacherIds: Set<string>;
  current?: { subject: string; teacher: string };
  onPick: (payload: { activity: string; teacherId: string | null }) => Promise<void>;
}) {
  const [activity, setActivity] = useState("");
  const [busy, setBusy] = useState("");

  async function save(teacherId: string | null) {
    if (!activity) return;
    setBusy(teacherId || "none");
    try {
      await onPick({ activity, teacherId });
    } finally {
      setBusy("");
    }
  }

  if (!activities.length) {
    return (
      <View className="items-center gap-1 px-4 py-8" testID="activity-picker">
        <Ionicons name="football-outline" size={22} color="#94A3B8" />
        <Text className="text-center text-[14px] font-medium text-ink-800">{`No activities set for ${classLabel}`}</Text>
        <Text className="text-center text-[12px] text-ink-500">Add Games, Library… in Settings → Subjects → Activities.</Text>
      </View>
    );
  }

  const takes = (t: { activities?: { name: string; classId: string }[] }) =>
    Boolean(activity && t.activities?.some((a) => a.classId === classId && a.name.toLowerCase() === activity.toLowerCase()));
  const free = teachers
    .filter((t) => !busyTeacherIds.has(t.id))
    .sort((a, b) => Number(takes(b)) - Number(takes(a)) || a.name.localeCompare(b.name));
  return (
    <View testID="activity-picker">
      <View className="overflow-hidden rounded-xl border border-ink-100">
        {activities.map((row, i) => {
          const on = activity === row.name;
          const isNow = current?.subject === row.name;
          const full = row.perWeek > 0 && row.placed >= row.perWeek && !isNow;
          return (
            <Pressable
              key={row.name}
              accessibilityRole="button"
              accessibilityState={{ selected: on, disabled: full }}
              disabled={full}
              onPress={() => setActivity(on ? "" : row.name)}
              className={`flex-row items-center gap-3 px-3 py-2.5 ${i ? "border-t border-ink-100" : ""} ${on ? "bg-[#EEF3FF]" : "active:bg-ink-50"} ${full ? "opacity-50" : ""}`}
            >
              <View className="h-7 w-1 rounded-full bg-violet-400" />
              <Text className="min-w-0 flex-1 text-[14px] font-medium text-ink-900">{row.name}</Text>
              <Text className="text-[12px] text-ink-500">{`${row.placed}/${row.perWeek}`}</Text>
              {isNow ? (
                <Text className="rounded-full bg-[#EEF3FF] px-2 py-0.5 text-[11px] font-semibold text-[#1F45C7]">Now</Text>
              ) : full ? (
                <Text className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Full</Text>
              ) : (
                <Text className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{`Needs ${row.perWeek - row.placed}`}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
      {activity ? (
        <View className="mt-3">
          <Text className="mb-1.5 text-[12px] font-medium text-ink-600">{`Who takes ${activity}?`}</Text>
          <View className="overflow-hidden rounded-xl border border-ink-100">
            <Pressable
              accessibilityRole="button"
              disabled={Boolean(busy)}
              onPress={() => void save(null)}
              className="flex-row items-center gap-3 px-3 py-2.5 active:bg-ink-50"
            >
              <Text className="min-w-0 flex-1 text-[14px] text-ink-700">No teacher</Text>
              <Text className="text-[11px] text-ink-400">{busy === "none" ? "Saving…" : "e.g. Assembly"}</Text>
            </Pressable>
            {free.map((t) => (
              <Pressable
                key={t.id}
                accessibilityRole="button"
                disabled={Boolean(busy)}
                onPress={() => void save(t.id)}
                className="flex-row items-center gap-3 border-t border-ink-100 px-3 py-2.5 active:bg-ink-50"
              >
                <Text className="min-w-0 flex-1 text-[14px] text-ink-900">{t.name}</Text>
                {takes(t) ? (
                  <Text className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">{`Takes ${activity}`}</Text>
                ) : null}
                {busy === t.id ? (
                  <Text className="text-[11px] text-ink-500">Saving…</Text>
                ) : (
                  <Ionicons name="chevron-forward" size={14} color="#94A3B8" />
                )}
              </Pressable>
            ))}
          </View>
          {teachers.length > free.length ? (
            <Text className="mt-1.5 text-[11px] text-ink-400">{`${teachers.length - free.length} teacher${teachers.length - free.length === 1 ? " is" : "s are"} busy in another class then.`}</Text>
          ) : null}
        </View>
      ) : (
        <Text className="mt-2 text-[12px] text-ink-500">Pick an activity, then who takes it. Activities are never part of exams.</Text>
      )}
    </View>
  );
}

/** Subjects | Activities switch at the top of the period popup. */
export function AssignTabs({ tab, onChange }: { tab: "subjects" | "activities"; onChange: (tab: "subjects" | "activities") => void }) {
  return (
    <View className="mb-3 flex-row self-start rounded-lg border border-ink-200 bg-white p-0.5">
      {(
        [
          ["subjects", "Subjects"],
          ["activities", "Activities"],
        ] as const
      ).map(([key, label]) => (
        <Pressable
          key={key}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === key }}
          onPress={() => onChange(key)}
          className={`rounded-md px-3 py-1.5 ${tab === key ? "bg-clay-500" : ""}`}
        >
          <Text className={`text-[13px] font-medium ${tab === key ? "text-white" : "text-ink-700"}`}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
