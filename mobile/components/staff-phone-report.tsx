import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ymd } from "../lib/calendar";
import { act } from "../lib/mutate";
import { DateField } from "./date-field";

type Break = { from: string; to: string | null; reason: string; minutes: number; endedBy: string };
type Row = {
  teacherId: string;
  name: string;
  started: string | null;
  ended: string | null;
  endedBy: string;
  breaks: Break[];
  breakMinutes: number;
  guardOff: number;
  outside: number;
  timeline: { type: string; at: string; reason: string }[];
};

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).replace(" ", " ") : "";

function duration(m: number) {
  if (m < 1) return "<1 min";
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}

const ENDED_BY: Record<string, string> = {
  resume: "Came back",
  class_started: "Class started",
  end: "Day ended",
  auto_end: "School closed",
  "": "Still on break",
};

const EVENT_LABEL: Record<string, string> = {
  start: "Day started",
  break: "Break",
  resume: "Back from break",
  class_started: "Break ended by class",
  guard_off: "Turned the guard off",
  outside: "Opened another app from Anekio (WhatsApp, call, camera…)",
  end: "Day ended",
  auto_end: "Day ended (school closed)",
};

function initials(name: string) {
  return name.split(" ").map((w) => w[0] || "").slice(0, 2).join("").toUpperCase();
}

function Stat({ label, value, tone = "ink" }: { label: string; value: string; tone?: "ink" | "amber" | "red" }) {
  const color = tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-ink-900";
  return (
    <View className="min-w-[120px] flex-1 rounded-xl bg-ink-50 px-3.5 py-2.5">
      <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</Text>
      <Text className={`mt-0.5 text-[20px] font-semibold ${color}`}>{value}</Text>
    </View>
  );
}

/** The day as one bar: blue = focus, amber = break, red tick = guard turned off. */
function DayBar({ row }: { row: Row }) {
  const start = row.started ? +new Date(row.started) : 0;
  const end = row.ended ? +new Date(row.ended) : Date.now();
  const span = Math.max(1, end - start);
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - start) / span) * 100))}%`;
  return (
    <View className="gap-1">
      <View className="h-3 overflow-hidden rounded-full bg-[#2855F6]">
        {row.breaks.map((b, i) => {
          const from = +new Date(b.from);
          const to = b.to ? +new Date(b.to) : end;
          return (
            <View
              key={`${b.from}-${i}`}
              className="absolute bottom-0 top-0 bg-amber-400"
              style={{ left: pct(from) as never, width: `${Math.max(0.6, ((to - from) / span) * 100)}%` as never }}
            />
          );
        })}
        {row.timeline
          .filter((e) => e.type === "guard_off")
          .map((e, i) => (
            <View key={`g-${i}`} className="absolute bottom-0 top-0 w-1 bg-red-600" style={{ left: pct(+new Date(e.at)) as never }} />
          ))}
      </View>
      <View className="flex-row justify-between">
        <Text className="text-[11px] text-ink-500">{time(row.started)}</Text>
        <Text className="text-[11px] text-ink-500">{row.ended ? time(row.ended) : "now"}</Text>
      </View>
    </View>
  );
}

/** Staff → Phone use: each teacher's school day on a date (Settings → HR & Payroll → Teacher phones). */
export function StaffPhoneReport({ token, phone }: { token: string | null; phone: boolean }) {
  const [date, setDate] = useState(ymd(new Date()));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");
  const [allEvents, setAllEvents] = useState("");

  useEffect(() => {
    let live = true;
    setRows(null);
    setError("");
    act<{ ok: true; rows: Row[] }>(token, "schoolDayReport", { date })
      .then((res) => live && setRows(res.rows))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load the report."));
    return () => {
      live = false;
    };
  }, [token, date]);

  const withDay = (rows ?? []).filter((r) => r.started);
  const notStarted = (rows ?? []).filter((r) => !r.started);
  const totalBreaks = withDay.reduce((n, r) => n + r.breaks.length, 0);
  const totalBreakMin = withDay.reduce((n, r) => n + r.breakMinutes, 0);
  const guardOff = withDay.reduce((n, r) => n + r.guardOff, 0);

  return (
    <View className="min-h-0 flex-1" testID="staff-phone-report">
      <View className={`flex-row flex-wrap items-center gap-3 border-b border-ink-100 ${phone ? "px-3 py-3" : "px-5 py-3"}`}>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-ink-900">Phone use</Text>
          <Text className="text-[12px] text-ink-500">From check-in to day end. Android app only.</Text>
        </View>
        <View className="w-44">
          <DateField value={date} onChange={setDate} max={ymd(new Date())} compact />
        </View>
      </View>

      <ScrollView className="min-h-0 flex-1" contentContainerClassName={phone ? "p-3 gap-3" : "p-5 gap-3"}>
        <View className="w-full gap-3" style={{ maxWidth: 860 }}>
          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
          {!rows && !error ? <Text className="text-sm text-ink-500">Loading…</Text> : null}

          {rows ? (
            <View className="flex-row flex-wrap gap-2">
              <Stat label="Teachers on" value={`${withDay.length} / ${rows.length}`} />
              <Stat label="Breaks" value={String(totalBreaks)} tone={totalBreaks ? "amber" : "ink"} />
              <Stat label="Break time" value={duration(totalBreakMin)} tone={totalBreakMin ? "amber" : "ink"} />
              <Stat label="Guard off" value={String(guardOff)} tone={guardOff ? "red" : "ink"} />
            </View>
          ) : null}

          {rows && !withDay.length ? (
            <View className="items-center rounded-xl border border-dashed border-ink-200 px-4 py-8">
              <Ionicons name="phone-portrait-outline" size={22} color="#94A3B8" />
              <Text className="mt-2 text-sm text-ink-600">No teacher started a school day on this date.</Text>
            </View>
          ) : null}

          {withDay.map((r) => {
            const open = openId === r.teacherId;
            const span = Math.max(0, Math.round(((r.ended ? +new Date(r.ended) : Date.now()) - +new Date(r.started as string)) / 60_000));
            const focus = Math.max(0, span - r.breakMinutes);
            return (
              <View key={r.teacherId} className={`overflow-hidden rounded-2xl border bg-white ${open ? "border-[#BFD0FF]" : "border-ink-100"}`}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setOpenId(open ? "" : r.teacherId)}
                  className="flex-row flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 active:bg-ink-50"
                >
                  <View className="min-w-[180px] flex-1 flex-row items-center gap-3">
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-[#EEF3FF]">
                      <Text className="text-[12px] font-bold text-[#1F45C7]">{initials(r.name)}</Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[14px] font-semibold text-ink-900" numberOfLines={1}>{r.name}</Text>
                      <Text className="text-[12px] text-ink-500">
                        {`${time(r.started)} → ${r.ended ? time(r.ended) : "on now"}`}
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row flex-wrap items-center gap-1.5">
                    <Text className="rounded-full bg-[#EEF3FF] px-2.5 py-1 text-[12px] font-semibold text-[#1F45C7]">{`Focus ${duration(focus)}`}</Text>
                    <Text className="rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-800">
                      {`${r.breaks.length} break${r.breaks.length === 1 ? "" : "s"} · ${duration(r.breakMinutes)}`}
                    </Text>
                    {r.outside ? (
                      <Text className="rounded-full bg-ink-100 px-2.5 py-1 text-[12px] font-semibold text-ink-700">{`From Anekio ×${r.outside}`}</Text>
                    ) : null}
                    {r.guardOff ? (
                      <Text className="rounded-full bg-red-50 px-2.5 py-1 text-[12px] font-semibold text-red-700">{`Guard off ×${r.guardOff}`}</Text>
                    ) : null}
                    <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color="#94A3B8" />
                  </View>
                </Pressable>

                {open ? (
                  <View className="gap-4 border-t border-ink-100 px-4 py-4">
                    <DayBar row={r} />
                    <View className="flex-row flex-wrap gap-3">
                      {[
                        ["bg-[#2855F6]", "Focus"],
                        ["bg-amber-400", "Break"],
                        ["bg-red-600", "Guard off"],
                      ].map(([c, l]) => (
                        <View key={l} className="flex-row items-center gap-1.5">
                          <View className={`h-2.5 w-2.5 rounded-full ${c}`} />
                          <Text className="text-[11px] text-ink-500">{l}</Text>
                        </View>
                      ))}
                    </View>

                    {r.breaks.length ? (
                      <View className="overflow-hidden rounded-xl border border-ink-100">
                        {r.breaks.map((b, i) => (
                          <View key={`${b.from}-${i}`} className={`flex-row flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 ${i ? "border-t border-ink-100" : ""}`}>
                            <Text className="w-[132px] text-[13px] font-medium text-ink-900">{`${time(b.from)} – ${b.to ? time(b.to) : "now"}`}</Text>
                            <Text className="w-16 text-[13px] text-ink-600">{duration(b.minutes)}</Text>
                            <View className="min-w-0 flex-1 flex-row">
                              <Text className={`rounded-full px-2 py-0.5 text-[12px] ${b.reason ? "bg-amber-50 font-medium text-amber-800" : "bg-ink-50 text-ink-400"}`}>
                                {b.reason || "No reason"}
                              </Text>
                            </View>
                            <Text className={`text-[12px] ${b.endedBy === "class_started" ? "font-semibold text-red-700" : "text-ink-500"}`}>
                              {ENDED_BY[b.endedBy] ?? b.endedBy}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text className="text-[13px] text-ink-500">No breaks.</Text>
                    )}

                    <Pressable accessibilityRole="button" onPress={() => setAllEvents(allEvents === r.teacherId ? "" : r.teacherId)} className="self-start">
                      <Text className="text-[13px] font-medium text-clay-600">{allEvents === r.teacherId ? "Hide all events" : `Show all events (${r.timeline.length})`}</Text>
                    </Pressable>
                    {allEvents === r.teacherId ? (
                      <View className="gap-1.5">
                        {r.timeline.map((e, i) => (
                          <View key={`${e.at}-${i}`} className="flex-row items-center gap-2.5">
                            <View className={`h-2 w-2 rounded-full ${e.type === "guard_off" ? "bg-red-600" : e.type === "break" ? "bg-amber-400" : "bg-[#2855F6]"}`} />
                            <Text className="w-[68px] text-[12px] text-ink-500">{time(e.at)}</Text>
                            <Text className={`min-w-0 flex-1 text-[13px] ${e.type === "guard_off" ? "font-semibold text-red-700" : "text-ink-800"}`}>
                              {`${EVENT_LABEL[e.type] || e.type}${e.reason ? ` · ${e.reason}` : ""}`}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}

          {notStarted.length && withDay.length ? (
            <Text className="text-[12px] text-ink-500">{`No school day: ${notStarted.map((r) => r.name).join(", ")}`}</Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
