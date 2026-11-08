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
  breaks?: { from: string; to: string; reason: string; minutes: number }[];
};
type Month = {
  month: string;
  days: Day[];
  summary: { present: number; late: number; early: number; leave: number; absent: number; avgMinutes: number; breakMinutes?: number };
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

function viaText(via: string) {
  return via === "location" ? "by location" : via === "qr" ? "by QR" : via === "office" || via === "" ? "by office" : "";
}

type Look = { text: string; fg: string; bg: string; dot: string };

/** One colour language for the calendar, the day card and the stats. */
function look(day: Day | undefined): Look {
  if (!day) return { text: "", fg: "#CBD5E1", bg: "transparent", dot: "#E2E8F0" };
  if (day.status === "OFF") return { text: day.note || "Off", fg: "#94A3B8", bg: "#F1F5F9", dot: "#CBD5E1" };
  if (day.status === "LEAVE") return { text: day.note || "Leave", fg: "#0369A1", bg: "#E0F2FE", dot: "#0EA5E9" };
  if (day.status === "ABSENT") return { text: "Absent", fg: "#B91C1C", bg: "#FEE2E2", dot: "#EF4444" };
  if (day.status === "NONE") return { text: "Not marked", fg: "#64748B", bg: "#FFFFFF", dot: "#E2E8F0" };
  if (day.early) return { text: "Left early", fg: "#C2410C", bg: "#FFEDD5", dot: "#F97316" };
  if (day.lateMin > 0 || day.status === "LATE") return { text: day.lateMin ? `Late ${hours(day.lateMin)}` : "Late", fg: "#B45309", bg: "#FEF3C7", dot: "#F59E0B" };
  if (day.status === "HALF_DAY") return { text: "Half day", fg: "#7C3AED", bg: "#EDE9FE", dot: "#8B5CF6" };
  return { text: "On time", fg: "#047857", bg: "#D1FAE5", dot: "#10B981" };
}

const WEEK = ["M", "T", "W", "T", "F", "S", "S"];

/** The month as a calendar: one coloured circle per day; tap one to see it below. */
function MonthGrid({ month, byDate, selected, onSelect }: { month: string; byDate: Map<string, Day>; selected: string; onSelect: (date: string) => void }) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstJs = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const lead = (firstJs + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = 1; d <= days; d += 1) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return (
    <View testID="month-grid" className="mx-4 rounded-3xl border border-ink-100 bg-white px-2 pb-2 pt-3">
      <View className="mb-1 flex-row">
        {WEEK.map((w, i) => (
          <Text key={`${w}${i}`} className="flex-1 text-center text-[11px] font-semibold text-ink-400">
            {w}
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} className="flex-row">
          {row.map((date, c) => {
            if (!date) return <View key={c} className="h-11 flex-1" />;
            const day = byDate.get(date);
            const l = look(day);
            const on = date === selected;
            const future = !day;
            return (
              <Pressable
                key={date}
                accessibilityRole="button"
                accessibilityLabel={`${date} ${l.text}`.trim()}
                disabled={future}
                onPress={() => onSelect(date)}
                className="h-11 flex-1 items-center justify-center"
              >
                <View
                  className="h-9 w-9 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: future ? "transparent" : day?.status === "NONE" ? "#FFFFFF" : l.bg,
                    borderWidth: on ? 2 : day?.status === "NONE" ? 1 : 0,
                    borderColor: on ? "#1F45C7" : "#E2E8F0",
                  }}
                >
                  <Text className="text-[14px] font-semibold" style={{ color: future ? "#CBD5E1" : l.fg }}>
                    {Number(date.slice(8))}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** One day, opened from the calendar: in → out, hours, why they left early, breaks, every out. */
function DayCard({ day }: { day: Day }) {
  const l = look(day);
  const d = new Date(`${day.date}T00:00:00`);
  // A break under a minute (tapped and resumed) is noise.
  const breaks = (day.breaks ?? []).filter((b) => b.minutes >= 1 || !b.to);
  const breakMin = breaks.reduce((n, b) => n + b.minutes, 0);
  const [allBreaks, setAllBreaks] = useState(false);
  const shown = allBreaks ? breaks : breaks.slice(0, 3);
  return (
    <View testID="day-card" className="mx-4 mt-3 rounded-3xl border border-ink-100 bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-[17px] font-bold text-ink-900">{d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</Text>
        <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: l.bg === "#FFFFFF" ? "#F1F5F9" : l.bg }}>
          <Text className="text-[12px] font-semibold" style={{ color: l.fg }}>
            {l.text}
          </Text>
        </View>
      </View>

      {day.inAt ? (
        <>
          <View className="mt-4 flex-row items-stretch gap-2">
            <View className="flex-1 rounded-2xl bg-[#ECFDF5] px-3 py-2.5">
              <Text className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">In</Text>
              <Text className="mt-0.5 text-[20px] font-bold tabular-nums text-ink-900">{clock(day.inAt)}</Text>
              <Text className="text-[11px] text-ink-500">{viaText(day.inVia)}</Text>
            </View>
            <View className="items-center justify-center">
              <Ionicons name="arrow-forward" size={16} color="#94A3B8" />
            </View>
            <View className="flex-1 rounded-2xl bg-[#FFF7ED] px-3 py-2.5">
              <Text className="text-[11px] font-semibold uppercase tracking-wider text-orange-700">Out</Text>
              <Text className="mt-0.5 text-[20px] font-bold tabular-nums text-ink-900">{day.outAt ? clock(day.outAt) : "—"}</Text>
              <Text className="text-[11px] text-ink-500">{day.outAt ? viaText(day.outVia) : "not checked out"}</Text>
            </View>
          </View>
          {day.minutes ? <Text className="mt-2 text-center text-[13px] text-ink-600">{`${hours(day.minutes)} at school`}</Text> : null}
        </>
      ) : (
        <Text className="mt-3 text-[14px] text-ink-600">
          {day.status === "OFF"
            ? "School was closed."
            : day.status === "LEAVE"
              ? `On leave · ${day.note || "Leave"}`
              : day.status === "ABSENT"
                ? "Marked absent."
                : day.status === "NONE"
                  ? "You did not check in."
                  : "Marked present by the office."}
        </Text>
      )}

      {day.early ? (
        <View className="mt-3 flex-row items-center gap-2 rounded-2xl bg-[#FFF7ED] px-3 py-2.5">
          <Ionicons name="home-outline" size={16} color="#C2410C" />
          <Text className="min-w-0 flex-1 text-[13px] text-orange-800">{`Left early · ${day.early}`}</Text>
        </View>
      ) : null}

      {breaks.length ? (
        <View className="mt-4">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-[13px] font-semibold text-ink-900">☕ Breaks</Text>
            <Text className="text-[12px] text-ink-500">{`${breaks.length} · ${hours(breakMin) || "0m"}`}</Text>
          </View>
          <View className="gap-1.5">
            {shown.map((b, i) => (
              <View key={`${b.from}-${i}`} className="flex-row items-center gap-3 rounded-xl bg-amber-50 px-3 py-2">
                <View className="h-2 w-2 rounded-full bg-amber-500" />
                <View className="min-w-0 flex-1">
                  <Text className="text-[14px] font-medium text-ink-900" numberOfLines={1}>
                    {b.reason || "Break"}
                  </Text>
                  <Text className="text-[12px] tabular-nums text-ink-500">{`${clock(b.from)} – ${b.to ? clock(b.to) : "now"}`}</Text>
                </View>
                <Text className="text-[13px] font-semibold tabular-nums text-amber-800">{hours(b.minutes) || "0m"}</Text>
              </View>
            ))}
            {breaks.length > 3 ? (
              <Pressable accessibilityRole="button" onPress={() => setAllBreaks((v) => !v)} className="items-center py-1.5">
                <Text className="text-[13px] font-semibold text-[#1F45C7]">{allBreaks ? "Show less" : `Show all ${breaks.length}`}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {day.outs.length > 1 ? (
        <View className="mt-4">
          <Text className="mb-2 text-[13px] font-semibold text-ink-900">{`Checked out ${day.outs.length} times`}</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {day.outs.map((o, i) => {
              const last = i === day.outs.length - 1;
              return (
                <View key={`${o.at}-${i}`} className={`rounded-full px-2.5 py-1 ${last ? "bg-orange-100" : "bg-ink-50"}`}>
                  <Text className={`text-[12px] tabular-nums ${last ? "font-semibold text-orange-800" : "text-ink-600"}`}>
                    {`${clock(o.at)}${o.via === "office" ? " · office" : ""}${last ? " · counts" : ""}`}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** "My attendance": a teacher's own month (same record the office sees). */
export function MyAttendanceSheet({ open, token, onClose }: { open: boolean; token: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Month | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");

  const load = useCallback(
    async (m: string) => {
      setBusy(true);
      setError("");
      try {
        const res = await act<{ ok: true } & Month>(token, "myAttendanceMonth", { month: m });
        setData(res);
        // Open on the latest day that has something to show.
        const first = res.days.find((d) => d.status !== "OFF" && d.status !== "NONE") || res.days[0];
        setSelected(first?.date || "");
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
  const byDate = new Map((data?.days ?? []).map((d) => [d.date, d]));
  const schoolDays = (data?.days ?? []).filter((d) => d.status !== "OFF").length;
  const pct = schoolDays && s ? Math.round((s.present / schoolDays) * 100) : 0;
  const day = selected ? byDate.get(selected) : undefined;
  const stat = (n: number | undefined, label: string, dot: string) => (
    <View className="flex-1 items-center">
      <View className="flex-row items-center gap-1.5">
        <View className="h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />
        <Text className="text-[18px] font-bold text-white">{n ?? 0}</Text>
      </View>
      <Text className="mt-0.5 text-[11px] text-white/70">{label}</Text>
    </View>
  );

  return (
    <RnModal visible={open} animationType="slide" onRequestClose={onClose}>
      <View testID="my-attendance" className="flex-1 bg-[#F5F7FB]" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View className="h-14 flex-row items-center px-2">
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} className="h-11 w-11 items-center justify-center">
            <Ionicons name="arrow-back" size={22} color="#0f2744" />
          </Pressable>
          <Text className="flex-1 text-[18px] font-bold text-ink-900">My attendance</Text>
        </View>

        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 28 }}>
          <View className="mx-4 overflow-hidden rounded-3xl px-4 pb-4 pt-3" style={{ backgroundColor: "#1F45C7" }}>
            <View pointerEvents="none" className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
            <View className="flex-row items-center justify-between">
              <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setMonth((m) => shiftMonth(m, -1))} hitSlop={8} className="h-8 w-8 items-center justify-center rounded-full bg-white/15">
                <Ionicons name="chevron-back" size={16} color="#fff" />
              </Pressable>
              <Text className="text-[15px] font-semibold text-white">{monthTitle(month)}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next month"
                disabled={month >= thisMonth()}
                onPress={() => setMonth((m) => shiftMonth(m, 1))}
                hitSlop={8}
                className={`h-8 w-8 items-center justify-center rounded-full bg-white/15 ${month >= thisMonth() ? "opacity-30" : ""}`}
              >
                <Ionicons name="chevron-forward" size={16} color="#fff" />
              </Pressable>
            </View>
            <View className="mt-3 flex-row items-end gap-2">
              <Text className="text-[34px] font-bold leading-[38px] text-white">{s?.present ?? 0}</Text>
              <Text className="mb-1 text-[15px] text-white/80">{`of ${schoolDays} school days present`}</Text>
            </View>
            <View className="mt-2 h-2 overflow-hidden rounded-full bg-white/20">
              <View className="h-full rounded-full bg-[#4ADE80]" style={{ width: `${pct}%` }} />
            </View>
            <View className="mt-4 flex-row">
              {stat(s?.late, "Late", "#FCD34D")}
              {stat(s?.early, "Left early", "#FDBA74")}
              {stat(s?.leave, "Leave", "#7DD3FC")}
              <View className="flex-1 items-center">
                <Text className="text-[18px] font-bold text-white">{s?.avgMinutes ? hours(s.avgMinutes) : "—"}</Text>
                <Text className="mt-0.5 text-[11px] text-white/70">Avg a day</Text>
              </View>
            </View>
          </View>

          {busy && !data ? (
            <View className="mt-10 items-center">
              <ActivityIndicator color="#1F45C7" />
            </View>
          ) : error ? (
            <Text className="mx-8 mt-10 text-center text-[14px] text-red-700">{error}</Text>
          ) : (
            <>
              <View className="mt-4">
                <MonthGrid month={data?.month || month} byDate={byDate} selected={selected} onSelect={setSelected} />
              </View>
              {day ? <DayCard key={day.date} day={day} /> : null}
              {s?.breakMinutes ? (
                <Text className="mt-3 text-center text-[12px] text-ink-500">{`☕ ${hours(s.breakMinutes)} of breaks this month`}</Text>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </RnModal>
  );
}

/** Dashboard quick action: opens My attendance. */
export function MyAttendanceTile({ token }: { token: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="My attendance" onPress={() => setOpen(true)} className="flex-1 items-center gap-1.5 active:opacity-70">
        <View className="h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF3FF]">
          <Ionicons name="calendar-outline" size={22} color="#1F45C7" />
        </View>
        <Text className="text-xs font-medium text-ink-800">My attendance</Text>
      </Pressable>
      <MyAttendanceSheet open={open} token={token} onClose={() => setOpen(false)} />
    </>
  );
}
