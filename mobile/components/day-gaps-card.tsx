import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { act } from "../lib/mutate";
import { useRecord, type DayGap, type DayGaps } from "../lib/record";
import { useSession } from "../lib/session";
import { ymd } from "../lib/calendar";
import { Modal, Toast, useToast } from "./ui";

function tomorrowYmd() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return ymd(d);
}

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0] || "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Office home: teachers who are out today (or tomorrow), one compact row each, with what still
 * needs doing — periods to cover and who takes their class's attendance. Hidden when nobody is out.
 */
export function DayGapsCard() {
  const { data, reload } = useRecord();
  const { token } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [day, setDay] = useState<"today" | "tomorrow">("today");
  const [tomorrow, setTomorrow] = useState<DayGaps | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickFor, setPickFor] = useState<DayGap | null>(null);

  const today = data?.dayGaps;
  if (!today) return null;
  const shown = day === "today" ? today : tomorrow;
  if (day === "today" && !today.gaps.length) return null;

  async function openTomorrow() {
    setDay("tomorrow");
    try {
      setTomorrow(await act<DayGaps & { ok: true }>(token, "loadDayGaps", { date: tomorrowYmd() }));
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not load tomorrow.");
    }
  }

  async function refresh() {
    if (day === "today") await reload();
    else setTomorrow(await act<DayGaps & { ok: true }>(token, "loadDayGaps", { date: tomorrowYmd() }));
  }

  async function save(gap: DayGap, teacherId: string | null) {
    if (!shown) return;
    setBusy(true);
    try {
      if (teacherId) await act(token, "assignAttendanceCover", { date: shown.date, classId: gap.classId, teacherId });
      else await act(token, "clearAttendanceCover", { date: shown.date, classId: gap.classId });
      setPickFor(null);
      toast.show(teacherId ? `${gap.classLabel} attendance handed over.` : "Hand-over removed.");
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const gaps = shown?.gaps ?? [];
  return (
    <View className="mb-4 overflow-hidden rounded-2xl border border-ink-100 bg-white" testID="day-gaps">
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="flex-row items-center gap-2 border-b border-ink-100 px-4 py-2.5">
        <Text className="text-[14px] font-semibold text-ink-900">Teachers out</Text>
        {gaps.length ? (
          <View className="min-w-[20px] items-center rounded-full bg-red-50 px-1.5 py-0.5">
            <Text className="text-[11px] font-bold text-red-700">{gaps.length}</Text>
          </View>
        ) : null}
        <View className="flex-1" />
        {(["today", "tomorrow"] as const).map((key) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: day === key }}
            onPress={() => (key === "today" ? setDay("today") : void openTomorrow())}
            hitSlop={6}
          >
            <Text className={`text-[12px] font-semibold ${day === key ? "text-[#1F45C7]" : "text-ink-400"}`}>
              {key === "today" ? "Today" : "Tomorrow"}
            </Text>
          </Pressable>
        ))}
      </View>

      {!shown ? (
        <Text className="px-4 py-3 text-[13px] text-ink-500">Loading…</Text>
      ) : shown.closed ? (
        <Text className="px-4 py-3 text-[13px] text-ink-500">School is closed ({shown.closed}).</Text>
      ) : !gaps.length ? (
        <Text className="px-4 py-3 text-[13px] text-ink-500">Nobody is out.</Text>
      ) : (
        gaps.map((gap, index) => {
          const pending = Boolean(gap.classId) && !gap.attendanceBy && !gap.attendanceDone;
          return (
            <View
              key={gap.teacherId}
              className={`flex-row flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 ${index ? "border-t border-ink-100" : ""}`}
            >
              <View className="min-w-[160px] flex-1 flex-row items-center gap-2.5">
                <View className="h-7 w-7 items-center justify-center rounded-full bg-ink-100">
                  <Text className="text-[10px] font-bold text-ink-700">{initials(gap.teacherName)}</Text>
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-[13px] font-semibold text-ink-900" numberOfLines={1}>{gap.teacherName}</Text>
                  <Text className="text-[11px] text-ink-500" numberOfLines={1}>
                    {gap.why}
                    {gap.classLabel ? ` · Class teacher ${gap.classLabel}` : ""}
                  </Text>
                </View>
              </View>
              <View className="flex-row flex-wrap items-center gap-1.5">
                {gap.openPeriods ? (
                  <Pill
                    tone="warn"
                    icon="time-outline"
                    label={`${gap.openPeriods} period${gap.openPeriods === 1 ? "" : "s"} uncovered`}
                    onPress={() => router.push("/timetable?view=date" as never)}
                  />
                ) : null}
                {pending ? (
                  <Pill tone="warn" icon="people-outline" label={`${gap.classLabel} attendance`} onPress={() => setPickFor(gap)} />
                ) : gap.classId && gap.attendanceBy ? (
                  <Pill tone="ok" icon="checkmark-circle" label={`${gap.classLabel} · ${gap.attendanceBy.name.split(" ")[0]}`} onPress={() => setPickFor(gap)} />
                ) : null}
              </View>
            </View>
          );
        })
      )}

      <Modal open={Boolean(pickFor)} title={pickFor ? `${pickFor.classLabel} attendance` : ""} onClose={() => setPickFor(null)} sheetOnPhone>
        {pickFor ? (
          <View className="gap-3">
            <Text className="text-[13px] text-ink-600">
              {`${pickFor.teacherName} is out ${day === "today" ? "today" : "tomorrow"}. Pick who marks ${pickFor.classLabel}'s attendance. It works for that day only.`}
            </Text>
            {pickFor.attendanceBy ? (
              <View className="flex-row items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5">
                <Ionicons name="checkmark-circle" size={16} color="#059669" />
                <Text className="min-w-0 flex-1 text-[13px] text-ink-800">
                  Given to <Text className="font-semibold">{pickFor.attendanceBy.name}</Text>
                </Text>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save(pickFor, null)} hitSlop={8}>
                  <Text className="text-[13px] font-semibold text-red-600">Remove</Text>
                </Pressable>
              </View>
            ) : null}
            {pickFor.candidates.length ? (
              <View className="overflow-hidden rounded-xl border border-ink-100">
                {pickFor.candidates.map((c, i) => (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void save(pickFor, c.id)}
                    className={`flex-row items-center gap-3 px-3 py-2.5 active:bg-ink-50 ${i ? "border-t border-ink-100" : ""}`}
                  >
                    <View className="h-7 w-7 items-center justify-center rounded-full bg-[#EEF3FF]">
                      <Text className="text-[10px] font-bold text-[#1F45C7]">{initials(c.name)}</Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[13px] font-medium text-ink-900">{c.name}</Text>
                      {c.hint ? <Text className="text-[11px] text-ink-500">{c.hint}</Text> : null}
                    </View>
                    {i === 0 && !pickFor.attendanceBy ? (
                      <Text className="rounded-full bg-[#EEF3FF] px-2 py-0.5 text-[10px] font-semibold text-[#1F45C7]">Suggested</Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : !pickFor.attendanceBy ? (
              <Text className="text-[13px] text-ink-500">No teacher is free that day.</Text>
            ) : null}
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

function Pill({
  label,
  icon,
  tone,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: "warn" | "ok";
  onPress: () => void;
}) {
  const warn = tone === "warn";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`h-7 flex-row items-center gap-1 rounded-full px-2.5 active:opacity-70 ${warn ? "bg-amber-50" : "bg-emerald-50"}`}
    >
      <Ionicons name={icon} size={13} color={warn ? "#B45309" : "#047857"} />
      <Text className={`text-[12px] font-semibold ${warn ? "text-amber-800" : "text-emerald-700"}`} numberOfLines={1}>
        {label}
      </Text>
      {warn ? <Ionicons name="chevron-forward" size={12} color="#B45309" /> : null}
    </Pressable>
  );
}
