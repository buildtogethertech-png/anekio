import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal as RnModal, Pressable, ScrollView, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { act } from "../lib/mutate";

type Day = {
  date: string;
  status: "PRESENT" | "LATE" | "HALF_DAY" | "ABSENT" | "LEAVE" | "OFF" | "NONE";
  inAt: string;
  outAt: string;
  inVia: string;
  outVia: string;
  minutes: number;
  lateMin: number;
  early: string;
  note: string;
  outs: { at: string; via: string }[];
};
type Month = {
  month: string;
  days: Day[];
  summary: { present: number; late: number; early: number; leave: number; absent: number; avgMinutes: number };
};

function clock(value?: string) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

function hours(min: number) {
  if (!min) return "";
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
}

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthTitle(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function viaIcon(via: string) {
  return via === "location" ? "location" : via === "qr" ? "qr-code" : via ? "create" : "create-outline";
}

function chip(day: Day): { text: string; fg: string; bg: string } {
  if (day.status === "OFF") return { text: day.note || "Off", fg: "#64748B", bg: "#F1F5F9" };
  if (day.status === "LEAVE") return { text: day.note || "Leave", fg: "#0369A1", bg: "#E0F2FE" };
  if (day.status === "ABSENT") return { text: "Absent", fg: "#B91C1C", bg: "#FEE2E2" };
  if (day.status === "NONE") return { text: "Not marked", fg: "#64748B", bg: "#F1F5F9" };
  if (day.early) return { text: "Left early", fg: "#C2410C", bg: "#FFEDD5" };
  if (day.lateMin > 0 || day.status === "LATE") return { text: day.lateMin ? `Late ${hours(day.lateMin)}` : "Late", fg: "#B45309", bg: "#FEF3C7" };
  if (day.status === "HALF_DAY") return { text: "Half day", fg: "#7C3AED", bg: "#EDE9FE" };
  return { text: "On time", fg: "#047857", bg: "#D1FAE5" };
}

function DayRow({ day }: { day: Day }) {
  const [open, setOpen] = useState(false);
  const d = new Date(`${day.date}T00:00:00`);
  const c = chip(day);
  const quiet = day.status === "OFF" || day.status === "NONE";
  const moreOuts = day.outs.length > 1;
  return (
    <Pressable
      accessibilityRole={moreOuts ? "button" : undefined}
      accessibilityLabel={`${day.date} ${c.text}`}
      disabled={!moreOuts}
      onPress={() => setOpen((v) => !v)}
      className={`flex-row gap-3 border-b border-ink-100 px-4 py-3 ${quiet ? "opacity-60" : ""}`}
    >
      <View className="w-11 items-center">
        <Text className="text-[11px] font-semibold uppercase text-ink-500">{d.toLocaleDateString("en-IN", { weekday: "short" })}</Text>
        <Text className="text-[20px] font-bold text-ink-900">{d.getDate()}</Text>
      </View>
      <View className="min-w-0 flex-1 justify-center">
        {day.inAt ? (
          <View className="flex-row flex-wrap items-center gap-1">
            <Ionicons name={viaIcon(day.inVia)} size={12} color="#64748B" />
            <Text className="text-[15px] font-semibold tabular-nums text-ink-900">{clock(day.inAt)}</Text>
            <Ionicons name="arrow-forward" size={12} color="#94A3B8" />
            {day.outAt ? (
              <>
                <Ionicons name={viaIcon(day.outVia)} size={12} color="#64748B" />
                <Text className="text-[15px] font-semibold tabular-nums text-ink-900">{clock(day.outAt)}</Text>
              </>
            ) : (
              <Text className="text-[15px] text-ink-400">no out</Text>
            )}
          </View>
        ) : (
          <Text className="text-[14px] text-ink-500">
            {day.status === "OFF"
              ? "School closed"
              : day.status === "LEAVE"
                ? "On leave"
                : day.status === "ABSENT"
                  ? "Marked absent"
                  : day.status === "NONE"
                    ? "No check in"
                    : "Marked present by office"}
          </Text>
        )}
        {day.minutes || day.early || (moreOuts && !open) ? (
          <Text className="mt-0.5 text-[12px] text-ink-500" numberOfLines={2}>
            {[hours(day.minutes), day.early ? `Left early · ${day.early}` : "", moreOuts ? `${day.outs.length} outs${open ? "" : " · tap to see"}` : ""].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
        {open ? (
          <View className="mt-1.5 gap-0.5">
            {day.outs.map((o, i) => (
              <Text key={`${o.at}-${i}`} className="text-[12px] tabular-nums text-ink-600">{`Out ${clock(o.at)}${o.via === "office" ? " · by office" : ""}${i === day.outs.length - 1 ? " · counts" : ""}`}</Text>
            ))}
          </View>
        ) : null}
      </View>
      <View className="justify-center">
        <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: c.bg }}>
          <Text className="text-[12px] font-semibold" style={{ color: c.fg }} numberOfLines={1}>
            {c.text}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** "My attendance": a teacher's own month (same record the office sees). */
export function MyAttendanceSheet({ open, token, onClose }: { open: boolean; token: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Month | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (m: string) => {
      setBusy(true);
      setError("");
      try {
        setData(await act<{ ok: true } & Month>(token, "myAttendanceMonth", { month: m }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load your attendance.");
      } finally {
        setBusy(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (open) void load(month);
  }, [open, month, load]);

  const s = data?.summary;
  const stat = (n: number | undefined, label: string, color: string) => (
    <View className="flex-1 items-center">
      <Text className="text-[22px] font-bold" style={{ color }}>{n ?? "—"}</Text>
      <Text className="text-[11px] font-medium text-ink-500">{label}</Text>
    </View>
  );

  return (
    <RnModal visible={open} animationType="slide" onRequestClose={onClose}>
      <View testID="my-attendance" className="flex-1 bg-white" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="h-14 flex-row items-center px-2">
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} className="h-11 w-11 items-center justify-center">
            <Ionicons name="chevron-back" size={24} color="#0f2744" />
          </Pressable>
          <Text className="flex-1 text-center text-[17px] font-semibold text-ink-900">My attendance</Text>
          <View className="w-11" />
        </View>

        <View className="flex-row items-center justify-between px-4 pb-2">
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setMonth((m) => shiftMonth(m, -1))} className="h-10 w-10 items-center justify-center rounded-full bg-ink-50">
            <Ionicons name="chevron-back" size={18} color="#1F45C7" />
          </Pressable>
          <Text className="text-[16px] font-semibold text-ink-900">{monthTitle(month)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            disabled={month >= thisMonth()}
            onPress={() => setMonth((m) => shiftMonth(m, 1))}
            className={`h-10 w-10 items-center justify-center rounded-full bg-ink-50 ${month >= thisMonth() ? "opacity-30" : ""}`}
          >
            <Ionicons name="chevron-forward" size={18} color="#1F45C7" />
          </Pressable>
        </View>

        <View className="mx-4 rounded-2xl bg-[#F5F8FF] px-2 py-3">
          <View className="flex-row">
            {stat(s?.present, "Present", "#047857")}
            {stat(s?.late, "Late", "#B45309")}
            {stat(s?.early, "Left early", "#C2410C")}
            {stat(s?.leave, "Leave", "#0369A1")}
          </View>
          {s?.avgMinutes ? (
            <Text className="mt-2 text-center text-[12px] text-ink-600">{`Average ${hours(s.avgMinutes)} a day at school`}</Text>
          ) : null}
        </View>

        {busy && !data ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#1F45C7" />
          </View>
        ) : error ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-center text-[14px] text-red-700">{error}</Text>
          </View>
        ) : (
          <ScrollView className="mt-3 flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
            {(data?.days ?? []).map((d) => (
              <DayRow key={d.date} day={d} />
            ))}
            {data && !data.days.length ? <Text className="mt-8 text-center text-[14px] text-ink-500">Nothing yet this month.</Text> : null}
            <View className="mt-4 flex-row flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4">
              <View className="flex-row items-center gap-1">
                <Ionicons name="location" size={12} color="#64748B" />
                <Text className="text-[11px] text-ink-500">Location</Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Ionicons name="qr-code" size={12} color="#64748B" />
                <Text className="text-[11px] text-ink-500">QR</Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Ionicons name="create-outline" size={12} color="#64748B" />
                <Text className="text-[11px] text-ink-500">By office</Text>
              </View>
            </View>
          </ScrollView>
        )}
      </View>
    </RnModal>
  );
}
