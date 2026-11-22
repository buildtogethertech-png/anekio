import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { closedReason, ymd, type SchoolCalendar } from "../lib/calendar";
import { daysInMonth, liveMarkFromIn, minutesLate, monthTitle, parseMinutes, shiftMonth, type PayrollRules } from "../lib/payroll";
import type { RecordPayload } from "../lib/record";

type Person = NonNullable<RecordPayload["staff"]>[number];

export type MonthRow = {
  person: Person;
  present: number;
  absent: number;
  leave: number;
  /** Past school days with nothing marked: counted as absent, same as salary. */
  notMarked: number;
  late: number;
  lateMin: number;
  /** Late days with no In time: their minutes are unknown, so the late time is a minimum. */
  lateUntimed: number;
  /** Days attended that have an In time. */
  timed: number;
  /** Sum and count of believable In times (for the usual arrival time). */
  inSum: number;
  inCount: number;
};

/** A "late" In time beyond this is a wrong scan or typo (e.g. 21:52), not lateness: the day counts, its minutes don't. */
const MAX_LATE_MIN = 240;

const day10 = (v?: string) => String(v || "").slice(0, 10);

/** One month of attendance per person, from the days already loaded. Only counts what was recorded: never guesses. */
export function monthRows(staff: Person[], month: string, calendar: SchoolCalendar, rules: PayrollRules, today = ymd(new Date())): MonthRow[] {
  const dates = daysInMonth(month).filter((d) => d <= today);
  // Before the school's first attendance in the app, an empty day means "not using the app yet", not absent.
  const started = staff.reduce((min, p) => (p.days ?? []).reduce((m, d) => (day10(d.date) && day10(d.date) < m ? day10(d.date) : m), min), "9999-12-31");
  return staff.map((person) => {
    const byDate = new Map((person.days ?? []).map((d) => [day10(d.date), d]));
    const leaveOn = new Set((person.leaveDays ?? []).map((d) => day10(d.date)));
    const joined = day10(person.joinedOn);
    const row: MonthRow = { person, present: 0, absent: 0, leave: 0, notMarked: 0, late: 0, lateMin: 0, lateUntimed: 0, timed: 0, inSum: 0, inCount: 0 };
    for (const date of dates) {
      if (joined && date < joined) continue;
      const d = byDate.get(date);
      const status = String(d?.status || "").toUpperCase();
      if (!d && !leaveOn.has(date) && closedReason(date, calendar)) continue;
      if (status === "LEAVE" || (!d && leaveOn.has(date))) {
        row.leave += 1;
        continue;
      }
      if (status === "ABSENT") {
        row.absent += 1;
        continue;
      }
      if (status === "PRESENT" || status === "LATE" || status === "HALF_DAY") {
        row.present += 1;
        const inAt = d?.inAt || "";
        if (inAt) row.timed += 1;
        const arrived = inAt ? parseMinutes(inAt) : null;
        const start = parseMinutes(d?.startTimeUsed || rules.startTime);
        if (arrived != null && start != null && arrived >= start - 120 && arrived <= start + MAX_LATE_MIN) {
          row.inSum += arrived;
          row.inCount += 1;
        }
        const late = status === "LATE" || String(d?.computedStatus || "").toUpperCase() === "LATE" || (inAt && liveMarkFromIn(status, inAt, rules.startTime, rules.graceMinutes) === "LATE");
        if (late) {
          row.late += 1;
          const min = inAt ? minutesLate(inAt, d?.startTimeUsed || rules.startTime) : 0;
          if (min > 0 && min <= MAX_LATE_MIN) row.lateMin += min;
          else row.lateUntimed += 1;
        }
        continue;
      }
      // Not marked on a past school day = absent (same as salary).
      if (date < today && date >= started) {
        row.notMarked += 1;
        row.absent += 1;
      }
    }
    return row;
  });
}

export function hm(min: number) {
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/** Present share of working days (leave left out), or null when nothing counts yet. */
export function attendancePct(r: Pick<MonthRow, "present" | "absent">) {
  const days = r.present + r.absent;
  return days ? Math.round((r.present * 100) / days) : null;
}

/** Usual arrival, e.g. "8:12 AM", from believable In times only. */
export function usualIn(r: Pick<MonthRow, "inSum" | "inCount">) {
  if (!r.inCount) return "";
  const avg = Math.round(r.inSum / r.inCount);
  const h = Math.floor(avg / 60);
  return `${h % 12 || 12}:${String(avg % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const pctColor = (pct: number | null) => (pct == null ? "#94a3b8" : pct >= 90 ? "#047857" : pct >= 75 ? "#b45309" : "#b91c1c");

/** Below this share of attended days with an In time, the late time is shown as a minimum. */
const TRUST = 0.7;
const lowCover = (r: MonthRow) => r.present > 0 && r.timed / r.present < TRUST;

type SortId = "attendance" | "late" | "lateMin" | "name";

export function StaffMonthlyReport({
  staff,
  calendar,
  rules,
  phone,
  onOpen,
  onEditTimes,
}: {
  staff: Person[];
  calendar: SchoolCalendar;
  rules: PayrollRules;
  phone: boolean;
  onOpen: (person: Person, month: string) => void;
  onEditTimes?: () => void;
}) {
  const today = ymd(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [sort, setSort] = useState<SortId>("attendance");
  const rows = useMemo(() => monthRows(staff, month, calendar, rules, today), [staff, month, calendar, rules, today]);
  const sorted = useMemo(() => {
    const out = [...rows];
    if (sort === "name") out.sort((a, b) => a.person.name.localeCompare(b.person.name));
    if (sort === "lateMin") out.sort((a, b) => b.lateMin - a.lateMin || b.late - a.late || a.person.name.localeCompare(b.person.name));
    if (sort === "late") out.sort((a, b) => b.late - a.late || b.lateMin - a.lateMin || a.person.name.localeCompare(b.person.name));
    // Worst attendance first; people with nothing to count go last.
    if (sort === "attendance") out.sort((a, b) => (attendancePct(a) ?? 101) - (attendancePct(b) ?? 101) || a.person.name.localeCompare(b.person.name));
    return out;
  }, [rows, sort]);
  const totals = rows.reduce(
    (t, r) => ({ late: t.late + r.late, lateMin: t.lateMin + r.lateMin, absent: t.absent + r.absent, present: t.present + r.present }),
    { late: 0, lateMin: 0, absent: 0, present: 0 }
  );
  const overall = attendancePct(totals);
  const isNow = month === today.slice(0, 7);


  const initials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("");
  const lateLabel = (r: MonthRow) => {
    if (!r.lateMin) return "";
    return `${hm(r.lateMin)}${r.lateUntimed || lowCover(r) ? "+" : ""}`;
  };
  const stats: [string, string, string, SortId][] = [
    ["Attendance", overall == null ? "—" : `${overall}%`, pctColor(overall), "attendance"],
    ["Late days", String(totals.late), totals.late ? "#b45309" : "#0f172a", "late"],
    ["Late time", totals.lateMin ? `${hm(totals.lateMin)}${rows.some((r) => r.lateUntimed || lowCover(r)) ? "+" : ""}` : "0m", "#0f172a", "lateMin"],
  ];

  /** Month at a glance: one thin bar, coloured by what each day was. */
  const bar = (r: MonthRow) => {
    const onTime = Math.max(0, r.present - r.late);
    const parts: [number, string][] = [
      [onTime, "#10b981"],
      [r.late, "#f59e0b"],
      [r.absent - r.notMarked, "#ef4444"],
      [r.notMarked, "#fca5a5"],
      [r.leave, "#38bdf8"],
    ];
    const total = parts.reduce((t, [n]) => t + n, 0);
    if (!total) return <View className="h-1.5 rounded-full bg-ink-100" />;
    return (
      <View className="h-1.5 flex-row gap-[2px] overflow-hidden rounded-full">
        {parts
          .filter(([n]) => n > 0)
          .map(([n, color], i) => (
            <View key={i} style={{ flex: n, backgroundColor: color }} />
          ))}
      </View>
    );
  };

  const counts = (r: MonthRow) =>
    [
      `${r.present} present`,
      r.absent ? `${r.absent} absent` : "",
      r.leave ? `${r.leave} leave` : "",
      usualIn(r) ? `in ~${usualIn(r)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <ScrollView className="min-h-0 flex-1" contentContainerStyle={{ paddingBottom: 96 }}>
      <View className={phone ? "gap-3 border-b border-ink-100 px-3 py-3" : "gap-3 border-b border-ink-100 px-4 py-4"}>
        <View className="flex-row items-center gap-2">
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setMonth(shiftMonth(month, -1))} className="h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white">
            <Ionicons name="chevron-back" size={18} color="#1F45C7" />
          </Pressable>
          <Text className={phone ? "min-w-0 flex-1 text-center text-[16px] font-semibold text-ink-900" : "min-w-[150px] text-center text-[16px] font-semibold text-ink-900"}>{monthTitle(month)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            disabled={isNow}
            onPress={() => setMonth(shiftMonth(month, 1))}
            className={`h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white ${isNow ? "opacity-40" : ""}`}
          >
            <Ionicons name="chevron-forward" size={18} color="#1F45C7" />
          </Pressable>
          {onEditTimes ? (
            <>
              <View className="flex-1" />
              <Pressable accessibilityRole="button" accessibilityLabel="Edit times" onPress={onEditTimes} className="h-10 flex-row items-center gap-1.5 rounded-xl border border-ink-200 px-3 hover:bg-ink-50">
                <Ionicons name="time-outline" size={17} color="#334155" />
                <Text className="text-[13px] font-medium text-ink-700">Edit times</Text>
              </Pressable>
            </>
          ) : null}
        </View>
        <View className="flex-row gap-2">
          {stats.map(([label, value, color, by]) => {
            const on = sort === by;
            return (
              <Pressable
                key={label}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`Sort by ${label.toLowerCase()}`}
                onPress={() => setSort(on ? "name" : by)}
                className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 ${on ? "border-[#C7D5FF] bg-[#EEF3FF]" : "border-ink-100 bg-white"}`}
              >
                <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500" numberOfLines={1}>{label}</Text>
                <Text className="mt-0.5 text-[16px] font-semibold" style={{ color }} numberOfLines={1}>
                  {value}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View>
        {sorted.map((r, i) => (
          <Pressable
            key={`${r.person.kind}:${r.person.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${r.person.name} monthly attendance`}
            onPress={() => onOpen(r.person, month)}
            className={`flex-row items-center gap-3 active:bg-ink-50 hover:bg-ink-50 ${phone ? "px-3 py-3" : "px-4 py-3"} ${i ? "border-t border-ink-100" : ""}`}
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-[#EEF3FF]">
              <Text className="text-[13px] font-semibold text-[#1F45C7]">{initials(r.person.name)}</Text>
            </View>
            <View className="min-w-0 flex-1 gap-1.5">
              <Text numberOfLines={1} className="text-[15px] font-semibold text-ink-900">{r.person.name}</Text>
              {bar(r)}
              <Text numberOfLines={1} className="text-[12px] text-ink-500">{counts(r)}</Text>
            </View>
            <View className="min-w-[56px] items-end">
              <Text className="text-[17px] font-bold" style={{ color: pctColor(attendancePct(r)) }}>
                {attendancePct(r) == null ? "—" : `${attendancePct(r)}%`}
              </Text>
              {r.late ? (
                <Text numberOfLines={1} className="text-[11px] font-semibold text-amber-700">
                  {`${r.late} late${lateLabel(r) ? ` · ${lateLabel(r)}` : ""}`}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
          </Pressable>
        ))}
        {!rows.length ? <Text className="px-4 py-10 text-center text-[13px] text-ink-500">No employees yet.</Text> : null}
      </View>

      <View className={`flex-row flex-wrap gap-x-4 gap-y-1 ${phone ? "px-3 pt-3" : "px-4 pt-3"}`}>
        {(
          [
            ["On time", "#10b981"],
            ["Late", "#f59e0b"],
            ["Absent", "#ef4444"],
            ["Not marked (absent)", "#fca5a5"],
            ["Leave", "#38bdf8"],
          ] as const
        ).map(([label, color]) => (
          <View key={label} className="flex-row items-center gap-1.5">
            <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            <Text className="text-[11px] text-ink-500">{label}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
