import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal as RnModal, Pressable, Text, View } from "react-native";
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

/** How far back the list goes while scrolling. */
const MONTHS_BACK = 12;

/** Fixed column widths so In and Out line up on every row. */
const COL_DATE = 54;
const COL_STATUS = 92;

/** Short status for the chip; the detail (how late) goes under it. */
function chipText(day: Day) {
  if (day.status === "LEAVE") return "Leave";
  if (day.status === "ABSENT") return "Absent";
  if (day.status === "NONE") return "Not marked";
  if (day.early) return "Left early";
  if (day.lateMin > 0 || day.status === "LATE") return "Late";
  if (day.status === "HALF_DAY") return "Half day";
  return "On time";
}

function DayLine({ day, last }: { day: Day; last: boolean }) {
  const l = look(day);
  const d = new Date(`${day.date}T00:00:00`);
  const sunday = d.getDay() === 0;
  const border = last ? "" : "border-b border-ink-100";
  const date = (
    <View style={{ width: COL_DATE }} className="items-center">
      <Text className={`text-[11px] font-semibold uppercase ${sunday ? "text-red-500" : "text-ink-400"}`}>
        {d.toLocaleDateString("en-IN", { weekday: "short" })}
      </Text>
      <Text className={`text-[20px] font-bold leading-6 ${sunday ? "text-red-600" : "text-ink-900"}`}>{d.getDate()}</Text>
    </View>
  );
  if (day.status === "OFF") {
    return (
      <View accessibilityLabel={`${day.date} ${l.text}`} className={`flex-row items-center bg-[#FAFBFD] py-2.5 ${border}`}>
        {date}
        <View className="min-w-0 flex-1 flex-row items-center gap-1.5 pl-1">
          <Ionicons name="moon-outline" size={14} color="#94A3B8" />
          <Text className="text-[13px] text-ink-500" numberOfLines={1}>
            {day.note || "School closed"}
          </Text>
        </View>
      </View>
    );
  }
  const timeCell = (value: string, sub?: string) => (
    <View className="flex-1 pl-1">
      <Text className={`text-[16px] font-semibold tabular-nums ${value ? "text-ink-900" : "text-ink-300"}`}>{value || "—"}</Text>
      {sub ? <Text className="text-[11px] tabular-nums text-ink-500">{sub}</Text> : null}
    </View>
  );
  const detail = day.lateMin > 0 && !day.early ? `by ${hours(day.lateMin)}` : day.early ? day.early : "";
  return (
    <View accessibilityLabel={`${day.date} ${l.text}`} className={`flex-row items-center py-3 ${border}`}>
      {date}
      {day.inAt ? (
        <>
          {timeCell(clock(day.inAt))}
          {timeCell(day.outAt ? clock(day.outAt) : "", day.minutes ? hours(day.minutes) : undefined)}
        </>
      ) : (
        <Text className="min-w-0 flex-1 pl-1 text-[14px] text-ink-500" numberOfLines={1}>
          {day.status === "LEAVE" ? day.note || "On leave" : day.status === "ABSENT" ? "Marked absent" : day.status === "NONE" ? "No check in" : "Marked present by office"}
        </Text>
      )}
      <View style={{ width: COL_STATUS }} className="items-center pr-2">
        <View className="w-full items-center rounded-full py-1" style={{ backgroundColor: l.bg === "#FFFFFF" ? "#F1F5F9" : l.bg }}>
          <Text className="text-[12px] font-semibold" style={{ color: l.fg }} numberOfLines={1}>
            {chipText(day)}
          </Text>
        </View>
        {detail ? (
          <Text className="mt-0.5 text-[11px]" style={{ color: l.fg }} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** One month: a wide white card with a column header, then a row per day. */
function MonthBlock({ page, title }: { page: Month; title?: string }) {
  return (
    <View className="mx-3 mb-3">
      {title ? <Text className="mb-2 ml-2 text-[13px] font-semibold uppercase tracking-wider text-ink-500">{title}</Text> : null}
      <View className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
        <View className="flex-row items-center border-b border-ink-100 bg-[#F8FAFC] py-2">
          <Text style={{ width: COL_DATE }} className="text-center text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Date
          </Text>
          <Text className="flex-1 pl-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">In</Text>
          <Text className="flex-1 pl-1 text-[11px] font-semibold uppercase tracking-wider text-orange-700">Out</Text>
          <Text style={{ width: COL_STATUS }} className="pr-2 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-400">
            Status
          </Text>
        </View>
        {page.days.length ? (
          page.days.map((d, i) => <DayLine key={d.date} day={d} last={i === page.days.length - 1} />)
        ) : (
          <Text className="py-6 text-center text-[13px] text-ink-500">Nothing this month.</Text>
        )}
      </View>
    </View>
  );
}

/**
 * "My attendance": the teacher's own days as one list, newest first: In and Out for each day.
 * Scrolling to the end loads the month before (up to a year back).
 */
export function MyAttendanceSheet({ open, token, onClose }: { open: boolean; token: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [pages, setPages] = useState<Month[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const loading = useRef(false);

  const load = useCallback(
    async (m: string, reset: boolean) => {
      if (loading.current) return;
      loading.current = true;
      setBusy(true);
      setError("");
      try {
        const res = await act<{ ok: true } & Month>(token, "myAttendanceMonth", { month: m });
        setPages((cur) => (reset ? [res] : cur.some((p) => p.month === res.month) ? cur : [...cur, res]));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load your attendance.");
      } finally {
        loading.current = false;
        setBusy(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (open) void load(thisMonth(), true);
    else setPages([]);
  }, [open, load]);

  const last = pages[pages.length - 1];
  const more = Boolean(last) && pages.length < MONTHS_BACK;
  const loadOlder = () => {
    if (last && more && !busy) void load(shiftMonth(last.month, -1), false);
  };

  const now = pages[0];
  const s = now?.summary;
  const schoolDays = (now?.days ?? []).filter((d) => d.status !== "OFF").length;
  const pct = schoolDays && s ? Math.round((s.present / schoolDays) * 100) : 0;
  const stat = (n: number | undefined, label: string, dot: string) => (
    <View className="flex-1 items-center">
      <View className="flex-row items-center gap-1.5">
        <View className="h-2 w-2 rounded-full" style={{ backgroundColor: dot }} />
        <Text className="text-[18px] font-bold text-white">{n ?? 0}</Text>
      </View>
      <Text className="mt-0.5 text-[11px] text-white/70">{label}</Text>
    </View>
  );


  const header = (
    <View className="mx-3 mb-3 overflow-hidden rounded-3xl px-4 pb-4 pt-3" style={{ backgroundColor: "#1F45C7" }}>
      <View pointerEvents="none" className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
      <Text className="text-[13px] font-semibold uppercase tracking-wider text-white/70">{monthTitle(now?.month || thisMonth())}</Text>
      <View className="mt-1 flex-row items-end gap-2">
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
        {error && !pages.length ? (
          <Text className="mx-8 mt-10 text-center text-[14px] text-red-700">{error}</Text>
        ) : (
          <FlatList
            testID="attendance-list"
            data={pages}
            keyExtractor={(p) => p.month}
            ListHeaderComponent={header}
            renderItem={({ item, index }) => <MonthBlock page={item} title={index > 0 ? monthTitle(item.month) : undefined} />}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              busy ? (
                <View className="items-center py-5">
                  <ActivityIndicator color="#1F45C7" />
                </View>
              ) : more ? (
                <Pressable accessibilityRole="button" onPress={loadOlder} className="items-center py-5">
                  <Text className="text-[13px] font-semibold text-[#1F45C7]">Load older</Text>
                </Pressable>
              ) : (
                <View className="h-6" />
              )
            }
            contentContainerStyle={{ paddingBottom: 24 }}
          />
        )}
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
