import { createElement, useMemo, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Toast, useToast } from "./ui";
import { act } from "../lib/mutate";
import { closedReason, holidayOn, weekdayOfYmd, ymd, type SchoolCalendar } from "../lib/calendar";
import type { IoniconName } from "../lib/nav-icons";

type RosterStudent = {
  id: string;
  name: string;
  admissionNo?: string;
  days?: { date: string; status: string }[];
};

type DayKind = "working" | "weekend" | "holiday";
type Mark = "PRESENT" | "ABSENT" | "LATE" | "LEAVE" | "";
type FilterKey = "all" | "present" | "absent" | "leave" | "low";

const WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COL = { adm: 108, name: 188, day: 42, pct: 96 };
const PHONE_COL = { adm: 64, name: 92, day: 34, pct: 40 };

function shortName(name: string, max = 12) {
  const text = name.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}.`;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number);
  const next = new Date(y, m - 1 + delta, 1);
  return monthKey(next);
}

function monthTitle(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function monthTitleShort(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function daysInMonth(key: string) {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return Array.from({ length: last }, (_, i) => {
    const day = i + 1;
    return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  });
}

function dayKind(date: string, calendar: SchoolCalendar): DayKind {
  if (holidayOn(date, calendar.holidays)) return "holiday";
  const closed = closedReason(date, calendar);
  if (closed) return "weekend";
  return "working";
}

function letterFor(mark: Mark, kind: DayKind, future: boolean) {
  if (kind === "holiday") return "H";
  if (kind === "weekend") return "—";
  if (future && !mark) return "—";
  if (mark === "PRESENT") return "P";
  if (mark === "ABSENT") return "A";
  if (mark === "LEAVE") return "L";
  if (mark === "LATE") return "Lt";
  return "—";
}

function badgeClass(letter: string) {
  if (letter === "P") return "bg-emerald-50 text-emerald-700";
  if (letter === "A") return "bg-red-50 text-red-700";
  if (letter === "L") return "bg-sky-50 text-sky-800";
  if (letter === "Lt") return "bg-amber-50 text-amber-800";
  if (letter === "H") return "bg-violet-50 text-violet-700";
  return "text-ink-400";
}

function parseMark(status?: string): Mark {
  const s = (status || "").toUpperCase();
  if (s === "PRESENT" || s === "IN") return "PRESENT";
  if (s === "ABSENT" || s === "OUT") return "ABSENT";
  if (s === "LEAVE") return "LEAVE";
  if (s === "LATE") return "LATE";
  return "";
}

function cycleMark(current: Mark): Mark {
  if (current === "PRESENT") return "ABSENT";
  if (current === "ABSENT") return "LEAVE";
  if (current === "LEAVE") return "LATE";
  if (current === "LATE") return "PRESENT";
  return "PRESENT";
}

function IconBtn({
  label,
  icon,
  onPress,
  primary,
}: {
  label: string;
  icon: IoniconName;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`h-9 flex-row items-center gap-1.5 rounded-md border px-3 ${
        primary ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"
      }`}
    >
      <Ionicons name={icon} size={15} color={primary ? "#fff" : "#2855F6"} />
      <Text className={`text-[12px] font-medium ${primary ? "text-white" : "text-ink-800"}`}>{label}</Text>
    </Pressable>
  );
}

function StatChip({
  icon,
  label,
  value,
  nowrap,
  fit,
}: {
  icon: IoniconName;
  label: string;
  value: string;
  nowrap?: boolean;
  fit?: boolean;
}) {
  if (fit) {
    return (
      <View className="h-[46px] min-w-0 flex-1 items-center justify-center rounded-lg border border-ink-100 bg-[#F8FAFC] px-0.5">
        <Text className="text-[13px] font-semibold leading-4 text-ink-900" numberOfLines={1}>{value}</Text>
        <Text className="mt-0.5 text-[8px] font-medium uppercase tracking-wide text-ink-500" numberOfLines={1}>{label}</Text>
      </View>
    );
  }
  return (
    <View className={`${nowrap ? "h-[52px] w-[136px] shrink-0 px-2 py-1.5" : "min-w-[108px] flex-1 px-3 py-2"} flex-row items-center gap-2 rounded-lg border border-ink-100 bg-[#F8FAFC]`}>
      <View className={`${nowrap ? "h-6 w-6" : "h-8 w-8"} items-center justify-center rounded-md bg-white`}>
        <Ionicons name={icon} size={nowrap ? 13 : 16} color="#2855F6" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className={`${nowrap ? "text-[14px] leading-4" : "text-[16px] leading-5"} font-semibold text-ink-900`} numberOfLines={1}>{value}</Text>
        <Text className={`${nowrap ? "text-[8px]" : "text-[10px]"} font-medium uppercase tracking-wide text-ink-500`} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

function PhoneStrip({ height, children, flush }: { height: number; children: ReactNode; flush?: boolean }) {
  const marginBottom = flush ? 0 : 8;
  if (Platform.OS === "web") {
    return createElement(
      "div",
      {
        style: {
          height,
          maxHeight: height,
          flexGrow: flush ? 1 : 0,
          flexShrink: flush ? 1 : 0,
          flexBasis: flush ? 0 : "auto",
          minWidth: flush ? 0 : undefined,
          overflowX: "auto",
          overflowY: "hidden",
          WebkitOverflowScrolling: "touch",
          marginBottom,
        },
      },
      createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            height,
            paddingRight: 8,
          },
        },
        children
      )
    );
  }
  return (
    <View style={{ height, maxHeight: height, flexGrow: flush ? 1 : 0, flexShrink: flush ? 1 : 0, minWidth: flush ? 0 : undefined, marginBottom }}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        style={{ height, flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ alignItems: "center", gap: 8, height, paddingRight: 8 }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function TeacherMonthlyRegister({
  classLabel,
  roster,
  people,
  calendar,
  token,
  onBack,
  onSaved,
}: {
  classLabel: string;
  roster: RosterStudent[];
  people?: { id: string; admissionNo?: string }[];
  calendar: SchoolCalendar;
  token: string | null;
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const today = ymd(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [monthOpen, setMonthOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => Number(today.slice(0, 4)));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, Mark>>({});
  const [busy, setBusy] = useState(false);
  const admission = useMemo(
    () => Object.fromEntries((people ?? []).map((p) => [p.id, p.admissionNo || ""])),
    [people]
  );

  const dates = useMemo(() => daysInMonth(month), [month]);
  const meta = useMemo(
    () =>
      dates.map((date) => ({
        date,
        n: Number(date.slice(8)),
        wd: WEEKDAYS[weekdayOfYmd(date)] || "",
        kind: dayKind(date, calendar),
        future: date > today,
        today: date === today,
      })),
    [calendar, dates, today]
  );

  const built = useMemo(() => {
    return roster.map((student) => {
      const adm = student.admissionNo || admission[student.id] || "—";
      const byDate = new Map((student.days ?? []).map((d) => [d.date, parseMark(d.status)]));
      const marks = meta.map((day) => {
        const key = `${student.id}:${day.date}`;
        const mark = draft[key] ?? byDate.get(day.date) ?? "";
        return { day, mark, letter: letterFor(mark, day.kind, day.future) };
      });
      const counted = marks.filter((m) => m.day.kind === "working" && !m.day.future);
      const present = counted.filter((m) => m.mark === "PRESENT" || m.mark === "LATE").length;
      const absent = counted.filter((m) => m.mark === "ABSENT").length;
      const leave = counted.filter((m) => m.mark === "LEAVE").length;
      const denom = present + absent;
      const pct = denom ? Math.round((present / denom) * 100) : 0;
      return { student, adm, marks, present, absent, leave, pct };
    });
  }, [admission, draft, meta, roster]);

  const focusDate = useMemo(() => {
    if (meta.some((d) => d.today)) return today;
    return [...meta].reverse().find((d) => d.kind === "working" && !d.future)?.date || "";
  }, [meta, today]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return built.filter((row) => {
      if (needle && !row.student.name.toLowerCase().includes(needle) && !row.adm.toLowerCase().includes(needle)) {
        return false;
      }
      const focus = row.marks.find((m) => m.day.date === focusDate)?.mark || "";
      if (filter === "present") return focus === "PRESENT" || focus === "LATE";
      if (filter === "absent") return focus === "ABSENT";
      if (filter === "leave") return focus === "LEAVE";
      if (filter === "low") return row.pct > 0 && row.pct < 75;
      return true;
    });
  }, [built, filter, focusDate, query]);

  const summary = useMemo(() => {
    const working = meta.filter((d) => d.kind === "working" && !d.future);
    let present = 0;
    let absent = 0;
    let leave = 0;
    for (const row of roster) {
      const byDate = new Map((row.days ?? []).map((d) => [d.date, parseMark(d.status)]));
      for (const day of working) {
        const mark = draft[`${row.id}:${day.date}`] ?? byDate.get(day.date) ?? "";
        if (mark === "PRESENT" || mark === "LATE") present += 1;
        else if (mark === "ABSENT") absent += 1;
        else if (mark === "LEAVE") leave += 1;
      }
    }
    const denom = present + absent;
    return {
      students: roster.length,
      working: working.length,
      pct: denom ? ((present / denom) * 100).toFixed(1) : "0.0",
      present,
      absent,
      leave,
    };
  }, [draft, meta, roster]);

  function setCell(studentId: string, date: string, kind: DayKind, future: boolean) {
    if (!editing || kind !== "working" || future) return;
    const key = `${studentId}:${date}`;
    const existing = parseMark(roster.find((s) => s.id === studentId)?.days?.find((d) => d.date === date)?.status);
    setDraft((cur) => ({ ...cur, [key]: cycleMark(cur[key] ?? existing) }));
  }

  async function saveEdits() {
    const byDate = new Map<string, { studentId: string; status: Mark }[]>();
    for (const [key, status] of Object.entries(draft)) {
      if (!status) continue;
      const cut = key.indexOf(":");
      const studentId = key.slice(0, cut);
      const date = key.slice(cut + 1);
      const list = byDate.get(date) || [];
      list.push({ studentId, status });
      byDate.set(date, list);
    }
    if (!byDate.size) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      for (const [date, rowsForDay] of byDate) {
        await act(token, "markAttendance", {
          date,
          rows: rowsForDay.map((r) => ({ studentId: r.studentId, status: r.status })),
        });
      }
      setDraft({});
      setEditing(false);
      toast.show("Monthly register saved.");
      await onSaved();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const head = ["Admission No.", "Student Name", ...meta.map((d) => `${String(d.n).padStart(2, "0")} ${d.wd}`), "Attendance %"];
    const lines = [head.join(",")];
    for (const row of built) {
      lines.push(
        [row.adm, `"${row.student.name.replace(/"/g, '""')}"`, ...row.marks.map((m) => m.letter), `${row.pct}%`].join(",")
      );
    }
    const csv = `\uFEFF${lines.join("\n")}`;
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance-${classLabel.replace(/\s+/g, "-")}-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.show("Register exported.");
      return;
    }
    toast.show("Export is available on web.");
  }

  function printRegister() {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      toast.show("Print is available on web.");
      return;
    }
    const cells = meta
      .map((d) => `<th>${String(d.n).padStart(2, "0")}<br/><span>${d.wd}</span></th>`)
      .join("");
    const body = built
      .map(
        (row) =>
          `<tr><td>${row.adm}</td><td>${row.student.name}</td>${row.marks
            .map((m) => `<td>${m.letter}</td>`)
            .join("")}<td>${row.pct}%</td></tr>`
      )
      .join("");
    const html = `<!doctype html><html><head><title>Monthly Attendance · ${classLabel}</title>
      <style>
        body{font-family:Inter,Arial,sans-serif;color:#102033;padding:24px}
        h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#5d6f86}
        table{border-collapse:collapse;width:100%;font-size:11px}
        th,td{border:1px solid #dbe4ee;padding:6px 7px;text-align:center}
        th:nth-child(1),th:nth-child(2),td:nth-child(1),td:nth-child(2){text-align:left}
        th{background:#f4f7fb}
      </style></head><body>
      <h1>Monthly Attendance</h1>
      <p>Class: ${classLabel} · ${monthTitle(month)}</p>
      <table><thead><tr><th>Admission No.</th><th>Student Name</th>${cells}<th>%</th></tr></thead>
      <tbody>${body}</tbody></table></body></html>`;
    const frame = window.open("", "_blank");
    if (!frame) {
      toast.show("Allow pop-ups to print.");
      return;
    }
    frame.document.write(html);
    frame.document.close();
    frame.focus();
    frame.print();
  }

  const cols = phone ? PHONE_COL : COL;
  const tableWidth = cols.adm + cols.name + meta.length * cols.day + cols.pct;
  const stickyHead = Platform.OS === "web" ? ({ position: "sticky", top: 0, zIndex: 5 } as const) : undefined;
  const stickyAdm = Platform.OS === "web" ? ({ position: "sticky", left: 0, zIndex: 3 } as const) : undefined;
  const stickyName = Platform.OS === "web" ? ({ position: "sticky", left: cols.adm, zIndex: 3 } as const) : undefined;
  const stickyPct = Platform.OS === "web" ? ({ position: "sticky", right: 0, zIndex: 3 } as const) : undefined;
  const pctPad = phone ? "items-center px-0.5" : "items-end px-3";
  const idPad = phone ? "px-1 py-2" : "px-3 py-2";

  const table = (
    <View style={{ minWidth: tableWidth }}>
      <View className="flex-row border-b border-ink-200 bg-[#F8FAFC]" style={stickyHead}>
        <View className={`justify-end border-r border-ink-100 bg-[#F8FAFC] ${idPad}`} style={{ width: cols.adm, ...stickyAdm, ...stickyHead, zIndex: 6 }}>
          <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{phone ? "Adm" : "Admission No."}</Text>
        </View>
        <View className={`justify-end border-r border-ink-100 bg-[#F8FAFC] ${idPad}`} style={{ width: cols.name, ...stickyName, ...stickyHead, zIndex: 6 }}>
          <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{phone ? "Name" : "Student Name"}</Text>
        </View>
        {meta.map((day) => (
          <View
            key={day.date}
            className={`items-center justify-end border-r border-ink-50 py-1.5 ${
              day.today ? "bg-[#EEF2FF]" : day.kind === "holiday" ? "bg-violet-50/70" : day.kind === "weekend" ? "bg-ink-50" : "bg-[#F8FAFC]"
            }`}
            style={{ width: cols.day }}
          >
            <Text className={`text-[12px] font-semibold ${day.today ? "text-clay-500" : "text-ink-900"}`}>
              {String(day.n).padStart(2, "0")}
            </Text>
            <Text className="text-[9px] text-ink-500">{day.wd}</Text>
            {day.today ? <Text className="text-[8px] font-semibold uppercase text-clay-500">Today</Text> : null}
          </View>
        ))}
        <View className={`justify-end border-l border-ink-100 bg-[#F8FAFC] py-2 ${pctPad}`} style={{ width: cols.pct, ...stickyPct, ...stickyHead, zIndex: 6 }}>
          <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{phone ? "%" : "Attendance %"}</Text>
        </View>
      </View>
      {rows.map((row, index) => (
        <View key={row.student.id} className={`flex-row border-b border-ink-50 ${index % 2 ? "bg-[#FCFDFE]" : "bg-white"}`}>
          <View className={`justify-center border-r border-ink-100 ${idPad}`} style={{ width: cols.adm, backgroundColor: index % 2 ? "#FCFDFE" : "#fff", ...stickyAdm }}>
            <Text className={`${phone ? "text-[10px]" : "text-[11px]"} text-ink-700`}>{row.adm}</Text>
          </View>
          <View className={`justify-center border-r border-ink-100 ${idPad}`} style={{ width: cols.name, backgroundColor: index % 2 ? "#FCFDFE" : "#fff", ...stickyName }}>
            {phone ? (
              <Text accessibilityLabel={row.student.name} className="text-[12px] font-semibold text-ink-900">
                {shortName(row.student.name)}
              </Text>
            ) : (
              <View className="flex-row items-center gap-2">
                <View className="h-6 w-6 items-center justify-center rounded-full bg-[#EEF2FF]">
                  <Text className="text-[10px] font-semibold text-clay-500">{row.student.name.slice(0, 1)}</Text>
                </View>
                <Text className="min-w-0 flex-1 text-[13px] font-semibold text-ink-900" numberOfLines={1}>
                  {row.student.name}
                </Text>
              </View>
            )}
          </View>
          {row.marks.map(({ day, letter, mark }) => {
            const editable = editing && day.kind === "working" && !day.future;
            return (
              <Pressable
                key={`${row.student.id}-${day.date}`}
                disabled={!editable}
                onPress={() => setCell(row.student.id, day.date, day.kind, day.future)}
                className={`items-center justify-center border-r border-ink-50 ${
                  day.today ? "bg-[#F5F8FF]" : day.kind === "holiday" ? "bg-violet-50/40" : day.kind === "weekend" ? "bg-ink-50/80" : ""
                }`}
                style={{ width: cols.day, minHeight: 44 }}
              >
                <View className={`h-6 min-w-[22px] items-center justify-center rounded-md px-1 ${badgeClass(letter)}`}>
                  <Text className={`text-[11px] font-semibold ${badgeClass(letter)}`}>{letter}</Text>
                </View>
                {editable && mark ? <View className="mt-0.5 h-0.5 w-3 rounded-full bg-clay-500" /> : null}
              </Pressable>
            );
          })}
          <View
            className={`justify-center border-l border-ink-100 ${pctPad}`}
            style={{ width: cols.pct, backgroundColor: index % 2 ? "#FCFDFE" : "#fff", ...stickyPct }}
          >
            <Text className={`${phone ? "text-[11px]" : "text-[13px]"} font-semibold ${row.pct && row.pct < 75 ? "text-amber-700" : "text-ink-900"}`}>
              {row.pct ? `${row.pct}%` : "—"}
            </Text>
          </View>
        </View>
      ))}
      {!rows.length ? (
        <View className="items-center py-10">
          <Text className="text-sm text-ink-500">No students match this search or filter.</Text>
        </View>
      ) : null}
    </View>
  );

  const scroller =
    Platform.OS === "web"
      ? createElement(
          "div",
          {
            className: "min-h-0 flex-1 overflow-auto rounded-xl border border-ink-200 bg-white",
            style: { WebkitOverflowScrolling: "touch", flex: 1, minHeight: 0, height: "100%" },
          },
          table
        )
      : (
          <ScrollView horizontal className="min-h-0 flex-1 rounded-xl border border-ink-200 bg-white">
            <ScrollView>{table}</ScrollView>
          </ScrollView>
        );

  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  return (
    <View className="min-h-0 flex-1" style={{ flex: 1, minHeight: 0, flexDirection: "column" }}>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {phone ? (
        <View className="shrink-0" style={{ flexGrow: 0, flexShrink: 0, marginBottom: 8 }}>
          <View className="flex-row items-center gap-1.5">
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Daily register"
              className="h-9 w-8 items-center justify-center"
            >
              <Ionicons name="chevron-back" size={18} color="#2855F6" />
            </Pressable>
            <Text className="shrink-0 text-[15px] font-bold text-ink-900" numberOfLines={1}>
              Class {classLabel || "—"}
            </Text>
            <View className="h-9 shrink-0 flex-row overflow-hidden rounded-md border border-ink-200 bg-white">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Previous month, ${monthTitle(prev)}`}
                onPress={() => setMonth(prev)}
                className="h-9 w-7 items-center justify-center"
              >
                <Ionicons name="chevron-back" size={14} color="#1D4ED8" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Choose month, ${monthTitle(month)}`}
                onPress={() => {
                  setPickerYear(Number(month.slice(0, 4)));
                  setMonthOpen((open) => !open);
                }}
                className="h-9 min-w-[86px] flex-row items-center justify-center gap-0.5 bg-[#2563EB] px-1.5"
              >
                <Text className="text-[11px] font-bold text-white" numberOfLines={1}>{monthTitleShort(month)}</Text>
                <Ionicons name={monthOpen ? "chevron-up" : "chevron-down"} size={12} color="#fff" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Next month, ${monthTitle(next)}`}
                onPress={() => setMonth(next)}
                className="h-9 w-7 items-center justify-center"
              >
                <Ionicons name="chevron-forward" size={14} color="#1D4ED8" />
              </Pressable>
            </View>
            <View className="min-w-0 flex-1 flex-row items-center rounded-md border border-ink-200 bg-white px-2">
              <Ionicons name="search-outline" size={14} color="#64748B" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                autoCorrect={false}
                className="h-9 min-w-0 flex-1 px-1.5 text-[12px] text-ink-900"
              />
            </View>
          </View>
          {monthOpen ? (
            <View className="mt-1.5 rounded-lg border border-ink-200 bg-white p-2">
              <View className="mb-1.5 flex-row items-center justify-between">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous year"
                  onPress={() => setPickerYear((y) => y - 1)}
                  className="h-8 w-8 items-center justify-center"
                >
                  <Ionicons name="chevron-back" size={16} color="#1D4ED8" />
                </Pressable>
                <Text className="text-[13px] font-semibold text-ink-900">{pickerYear}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next year"
                  onPress={() => setPickerYear((y) => y + 1)}
                  className="h-8 w-8 items-center justify-center"
                >
                  <Ionicons name="chevron-forward" size={16} color="#1D4ED8" />
                </Pressable>
              </View>
              <View className="flex-row flex-wrap">
                {MONTH_SHORT.map((label, index) => {
                  const key = `${pickerYear}-${String(index + 1).padStart(2, "0")}`;
                  const on = key === month;
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="button"
                      accessibilityLabel={`${label} ${pickerYear}`}
                      onPress={() => {
                        setMonth(key);
                        setMonthOpen(false);
                      }}
                      className={`mb-1 w-1/4 items-center justify-center rounded-md py-2 ${on ? "bg-[#2563EB]" : ""}`}
                    >
                      <Text className={`text-[12px] font-semibold ${on ? "text-white" : "text-ink-800"}`}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      ) : (
      <View className="mb-3 flex-row flex-wrap items-start justify-between gap-3">
        <View>
          <Pressable onPress={onBack} className="mb-1 flex-row items-center gap-1">
            <Ionicons name="chevron-back" size={16} color="#2855F6" />
            <Text className="text-[12px] font-medium text-clay-500">Daily register</Text>
          </Pressable>
          <Text className="text-[22px] font-semibold text-ink-900">Monthly Attendance</Text>
          <Text className="mt-0.5 text-[13px] text-ink-500">
            Class: {classLabel || "—"} · Month: {monthTitle(month)}
          </Text>
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <Pressable
            accessibilityLabel="Previous month"
            onPress={() => setMonth(prev)}
            className="h-9 flex-row items-center gap-1 rounded-md border border-ink-200 bg-white px-2.5"
          >
            <Ionicons name="chevron-back" size={14} color="#334155" />
            <Text className="text-[12px] font-medium text-ink-700">{monthTitle(prev)}</Text>
          </Pressable>
          <View className="h-9 min-w-[148px] items-center justify-center rounded-md border border-ink-200 bg-[#EEF2FF] px-3">
            <Text className="text-[12px] font-semibold text-clay-500">{monthTitle(month)}</Text>
          </View>
          <Pressable
            accessibilityLabel="Next month"
            onPress={() => setMonth(next)}
            className="h-9 flex-row items-center gap-1 rounded-md border border-ink-200 bg-white px-2.5"
          >
            <Text className="text-[12px] font-medium text-ink-700">{monthTitle(next)}</Text>
            <Ionicons name="chevron-forward" size={14} color="#334155" />
          </Pressable>
          <Pressable
            accessibilityLabel="Today"
            onPress={() => setMonth(today.slice(0, 7))}
            className="h-9 items-center justify-center rounded-md border border-ink-200 bg-white px-3"
          >
            <Text className="text-[12px] font-medium text-ink-800">Today</Text>
          </Pressable>
        </View>
      </View>
      )}

      {phone ? (
        <View className="mb-2 shrink-0 flex-row gap-1.5" style={{ flexGrow: 0, flexShrink: 0 }}>
          <StatChip fit icon="people-outline" label="Students" value={String(summary.students)} />
          <StatChip fit icon="stats-chart-outline" label="Attend %" value={`${summary.pct}%`} />
          <StatChip fit icon="checkmark-circle-outline" label="Present" value={String(summary.present)} />
          <StatChip fit icon="close-circle-outline" label="Absent" value={String(summary.absent)} />
          <StatChip fit icon="walk-outline" label="Leave" value={String(summary.leave)} />
        </View>
      ) : (
        <View className="mb-3 flex-row flex-wrap gap-2">
          <StatChip icon="people-outline" label="Total students" value={String(summary.students)} />
          <StatChip icon="calendar-outline" label="Working days" value={String(summary.working)} />
          <StatChip icon="stats-chart-outline" label="Class attendance" value={`${summary.pct}%`} />
          <StatChip icon="checkmark-circle-outline" label="Present" value={String(summary.present)} />
          <StatChip icon="close-circle-outline" label="Absent" value={String(summary.absent)} />
          <StatChip icon="walk-outline" label="On leave" value={String(summary.leave)} />
        </View>
      )}

      {phone ? (
        <View className="shrink-0" style={{ flexGrow: 0, flexShrink: 0, marginBottom: 8 }}>
          <View className="flex-row items-center gap-2">
            <PhoneStrip height={32} flush>
              <View className="flex-row overflow-hidden rounded-md border border-ink-200">
                {(
                  [
                    ["all", "All"],
                    ["present", "P"],
                    ["absent", "A"],
                    ["leave", "L"],
                    ["low", "<75%"],
                  ] as const
                ).map(([id, label]) => (
                  <Pressable key={id} onPress={() => setFilter(id)} className={`h-8 px-2.5 ${filter === id ? "bg-[#EEF2FF]" : "bg-white"}`}>
                    <Text className={`text-[11px] font-medium leading-8 ${filter === id ? "text-clay-500" : "text-ink-700"}`}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </PhoneStrip>
            <IconBtn
              label={editing ? (busy ? "Saving…" : "Save") : "Edit"}
              icon={editing ? "save-outline" : "create-outline"}
              primary={editing}
              onPress={() => (editing ? void saveEdits() : setEditing(true))}
            />
          </View>
        </View>
      ) : (
      <View className="mb-3 flex-row flex-wrap items-center justify-between gap-3">
        <View className="min-w-[220px] flex-1 flex-row items-center rounded-md border border-ink-200 bg-white px-2.5">
          <Ionicons name="search-outline" size={16} color="#64748B" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search student name or admission number..."
            placeholderTextColor="#94A3B8"
            autoCapitalize="none"
            autoCorrect={false}
            className="h-9 min-w-0 flex-1 px-2 text-[13px] text-ink-900"
          />
        </View>
        <View className="flex-row overflow-hidden rounded-md border border-ink-200">
          {(
            [
              ["all", "All"],
              ["present", "Present"],
              ["absent", "Absent"],
              ["leave", "Leave"],
              ["low", "Below 75%"],
            ] as const
          ).map(([id, label]) => (
            <Pressable key={id} onPress={() => setFilter(id)} className={`h-9 px-3 ${filter === id ? "bg-[#EEF2FF]" : "bg-white"}`}>
              <Text className={`text-[12px] font-medium leading-9 ${filter === id ? "text-clay-500" : "text-ink-700"}`}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <View className="flex-row flex-wrap gap-2">
          <IconBtn
            label={editing ? (busy ? "Saving…" : "Save edits") : "Edit Attendance"}
            icon={editing ? "save-outline" : "create-outline"}
            primary={editing}
            onPress={() => (editing ? void saveEdits() : setEditing(true))}
          />
          <IconBtn label="Export" icon="download-outline" onPress={exportCsv} />
          <IconBtn label="Print" icon="print-outline" onPress={printRegister} />
        </View>
      </View>
      )}

      {editing ? (
        <Text className="mb-2 shrink-0 text-[12px] text-ink-500">Tap a working-day cell to cycle P → A → L → Lt. Holidays and future dates stay locked.</Text>
      ) : null}

      <View className="min-h-0 flex-1" style={{ flex: 1, minHeight: 0 }}>
        {scroller}
      </View>

      {phone ? (
        <Text className="mt-1 shrink-0 text-[10px] text-ink-500">{rows.length} of {roster.length} students · P A L Lt H</Text>
      ) : (
      <View className="mt-2 flex-row flex-wrap justify-between gap-2">
        <Text className="text-[11px] text-ink-500">P present · A absent · L leave · Lt late · H holiday · — no attendance</Text>
        <Text className="text-[11px] text-ink-500">{rows.length} of {roster.length} students</Text>
      </View>
      )}
    </View>
  );
}
