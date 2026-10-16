import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { closedReason, weekdayOfYmd, ymd, type SchoolCalendar } from "../lib/calendar";
import { classifyFromIn, daysInMonth, liveMarkFromIn, monthTitle, normalizeHHmm, shiftMonth, type PayrollRules } from "../lib/payroll";
import type { RecordPayload } from "../lib/record";
import { act } from "../lib/mutate";
import { Button, Field, Input, Modal, Toast, useToast } from "./ui";

const WEEKDAYS = ["", "M", "T", "W", "T", "F", "S", "S"];
const NAME_W_WIDE = 188;
const NAME_W_PHONE = 128;
const DAY_W = 50;
/** Room under the last row so the floating launcher never covers it. */
const BOTTOM_CLEARANCE = 88;

type Person = NonNullable<RecordPayload["staff"]>[number];
type DayRow = NonNullable<Person["days"]>[number];

function dateKey(value?: string) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dt = new Date(raw);
  if (Number.isNaN(+dt)) return raw.slice(0, 10);
  if (dt.getTimezoneOffset() === -330 && dt.getHours() === 18 && dt.getMinutes() === 30 && dt.getSeconds() === 0) {
    const next = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : raw.slice(0, 10);
}

function cellFor(day: DayRow | undefined, future: boolean, off: string, rules: PayrollRules, overlayInAt?: string) {
  if (off) return { text: "Off", tone: "off" as const };
  if (future) return { text: "—", tone: "muted" as const };
  const inAt = overlayInAt || day?.inAt || "";
  if (inAt) {
    const status = liveMarkFromIn(day?.status || "PRESENT", inAt, rules.startTime, rules.graceMinutes);
    return { text: inAt, tone: status === "LATE" ? ("late" as const) : ("ok" as const) };
  }
  if ((day?.status || "").toUpperCase() === "ABSENT") return { text: "A", tone: "absent" as const };
  if ((day?.status || "").toUpperCase() === "LEAVE") return { text: "Lv", tone: "muted" as const };
  if ((day?.status || "").toUpperCase() === "LATE") return { text: "L", tone: "late" as const };
  if ((day?.status || "").toUpperCase() === "PRESENT") return { text: "P", tone: "ok" as const };
  return { text: "—", tone: "muted" as const };
}

type Tone = "ok" | "late" | "muted" | "off" | "absent";

/** Pill colours per state. A dash (not marked yet) gets no pill so it never looks like "Off". */
const TONE: Record<Tone, { fg: string; bg: string } | null> = {
  ok: { fg: "#047857", bg: "#ECFDF5" },
  late: { fg: "#92400e", bg: "#FFFBEB" },
  absent: { fg: "#b91c1c", bg: "#FEF2F2" },
  off: { fg: "#64748b", bg: "#EEF2F6" },
  muted: null,
};

function Cell({ text, tone }: { text: string; tone: Tone }) {
  const t = TONE[tone];
  if (!t) {
    return text === "—" ? <View className="h-1.5 w-1.5 rounded-full bg-ink-200" /> : <Text className="text-[12px] font-semibold text-ink-500">{text}</Text>;
  }
  return (
    <View className="min-w-[34px] items-center rounded-full px-1.5 py-1" style={{ backgroundColor: t.bg }}>
      <Text className="text-[11px] font-semibold" style={{ color: t.fg }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export function StaffTimesheet({
  staff,
  calendar,
  rules,
  token,
  canEdit,
  overlayDate,
  overlayTimes,
  onBack,
  onSaved,
  onStamp,
  showBack = true,
}: {
  staff: Person[];
  calendar: SchoolCalendar;
  rules: PayrollRules;
  token: string | null;
  canEdit: boolean;
  overlayDate?: string;
  overlayTimes?: Record<string, string>;
  onBack: () => void;
  onSaved: () => Promise<void>;
  onStamp?: (kind: string, id: string, inAt: string) => void;
  /** Hide the back arrow when the Timesheet sits inside the Staff tabs (the tabs already go back). */
  showBack?: boolean;
}) {
  const today = ymd(new Date());
  const toast = useToast();
  const teachers = useMemo(() => staff.filter((p) => p.kind === "teacher"), [staff]);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [edit, setEdit] = useState<{ person: Person; date: string; inAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dates = useMemo(() => daysInMonth(month), [month]);
  const { width: screenW } = useWindowDimensions();
  const NAME_W = screenW < 640 ? NAME_W_PHONE : NAME_W_WIDE;
  const tableWidth = NAME_W + dates.length * DAY_W;
  const webScroller = useRef<HTMLDivElement | null>(null);
  const nativeScroller = useRef<ScrollView | null>(null);
  const todayIndex = dates.indexOf(today);

  // Open on today's column (or the 1st for other months) instead of always showing days 1–4.
  useEffect(() => {
    const x = todayIndex > 1 ? (todayIndex - 1) * DAY_W : 0;
    const id = setTimeout(() => {
      if (Platform.OS === "web") webScroller.current?.scrollTo?.({ left: x });
      else nativeScroller.current?.scrollTo({ x, animated: false });
    }, 0);
    return () => clearTimeout(id);
  }, [month, todayIndex]);
  const stickyName = Platform.OS === "web" ? ({ position: "sticky", left: 0, zIndex: 3 } as const) : undefined;
  const stickyHead = Platform.OS === "web" ? ({ position: "sticky", top: 0, zIndex: 5 } as const) : undefined;

  function openEdit(person: Person) {
    const off = closedReason(today, calendar);
    if (off) {
      toast.show(off);
      return;
    }
    const byDate = new Map((person.days ?? []).map((d) => [dateKey(d.date), d]));
    const overlayInAt = overlayDate === today ? overlayTimes?.[`${person.kind}:${person.id}`] : undefined;
    setEdit({ person, date: today, inAt: overlayInAt || byDate.get(today)?.inAt || "" });
  }

  async function saveIn(clear = false) {
    if (!edit || busy) return;
    const inAt = clear ? "" : normalizeHHmm(edit.inAt.replace(".", ":"));
    if (!clear && edit.inAt.trim() && !inAt) {
      toast.show("Use HH:mm, for example 08:15.");
      return;
    }
    setBusy(true);
    try {
      await act(token, "markStaffAttendance", {
        date: today,
        rows: [
          {
            kind: edit.person.kind || "teacher",
            id: edit.person.id,
            status: inAt ? "PRESENT" : "ABSENT",
            inAt: inAt || "",
            outAt: "",
            clear: false,
          },
        ],
      });
      onStamp?.(edit.person.kind || "teacher", edit.person.id, inAt || "");
      toast.show(inAt ? "In time saved." : "In time cleared.");
      setEdit(null);
      await onSaved();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const table = (
    <View style={{ minWidth: tableWidth }}>
      <View className="flex-row border-b border-ink-200 bg-[#F8FAFC]" style={stickyHead}>
        <View className="justify-end border-r border-ink-100 bg-[#F8FAFC] px-3 py-2" style={{ width: NAME_W, ...stickyName, ...stickyHead, zIndex: 6 }}>
          <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Teacher</Text>
        </View>
        {dates.map((date) => {
          const n = Number(date.slice(8));
          const todayCell = date === today;
          const off = closedReason(date, calendar);
          return (
            <View key={date} className={`items-center justify-end py-2 ${off ? "bg-[#F1F5F9]" : "bg-[#F8FAFC]"}`} style={{ width: DAY_W }}>
              <Text className={`text-[10px] font-medium ${todayCell ? "text-[#2855F6]" : "text-ink-500"}`}>{WEEKDAYS[weekdayOfYmd(date)] || ""}</Text>
              <View className={`mt-0.5 h-7 w-7 items-center justify-center rounded-full ${todayCell ? "bg-[#2855F6]" : ""}`}>
                <Text className={`text-[13px] font-semibold ${todayCell ? "text-white" : "text-ink-900"}`}>{n}</Text>
              </View>
            </View>
          );
        })}
      </View>
      {teachers.map((person, index) => {
        const byDate = new Map((person.days ?? []).map((d) => [dateKey(d.date), d]));
        const rowBg = index % 2 ? "#F8FAFC" : "#fff";
        return (
          <View key={`${person.kind}:${person.id}`} className="flex-row border-b border-ink-50" style={{ backgroundColor: rowBg }}>
            <Pressable
              disabled={!canEdit}
              onPress={() => openEdit(person)}
              accessibilityRole={canEdit ? "button" : undefined}
              accessibilityLabel={canEdit ? `Edit ${person.name} in times` : undefined}
              className="flex-row items-center justify-between gap-1 border-r border-ink-100 px-3"
              style={{ width: NAME_W, minHeight: 52, backgroundColor: rowBg, ...stickyName }}
            >
              <Text className="min-w-0 flex-1 text-[14px] font-medium text-ink-900" numberOfLines={1}>
                {person.name}
              </Text>
              {canEdit ? <Ionicons name="create-outline" size={15} color="#94a3b8" /> : null}
            </Pressable>
            {dates.map((date) => {
              const off = closedReason(date, calendar);
              const day = byDate.get(date);
              const key = `${person.kind}:${person.id}`;
              const overlayInAt = date === overlayDate && overlayTimes && key in overlayTimes ? overlayTimes[key] : undefined;
              const hit = cellFor(day, date > today, off, rules, overlayInAt);
              const canOpen = canEdit && date === today && !off;
              return (
                <Pressable
                  key={`${person.id}-${date}`}
                  disabled={!canOpen}
                  onPress={() => openEdit(person)}
                  accessibilityRole={canOpen ? "button" : undefined}
                  accessibilityLabel={canOpen ? `Edit ${person.name} in time for ${date}` : undefined}
                  className={`items-center justify-center ${date === today ? "bg-[#F5F8FF]" : ""}`}
                  style={{ width: DAY_W, minHeight: 52 }}
                >
                  <Cell text={hit.text} tone={hit.tone} />
                </Pressable>
              );
            })}
          </View>
        );
      })}
      <View style={{ height: BOTTOM_CLEARANCE }} />
    </View>
  );

  const scroller =
    Platform.OS === "web"
      ? createElement("div", { ref: webScroller, className: "min-h-0 flex-1 overflow-auto rounded-xl border border-ink-200 bg-white", style: { WebkitOverflowScrolling: "touch", flex: 1, minHeight: 0 } }, table)
      : (
          <ScrollView ref={nativeScroller} horizontal className="min-h-0 flex-1 rounded-xl border border-ink-200 bg-white">
            <ScrollView>{table}</ScrollView>
          </ScrollView>
        );

  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const preview = edit ? classifyFromIn(normalizeHHmm(edit.inAt.replace(".", ":")) || edit.inAt, rules.startTime, rules.graceMinutes) : null;

  return (
    <View className="min-h-0 flex-1" style={{ flex: 1, minHeight: 0, flexDirection: "column" }}>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="mb-2 shrink-0 flex-row items-center gap-2">
        {showBack ? (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to register" className="h-10 w-8 items-center justify-center">
            <Ionicons name="chevron-back" size={18} color="#2855F6" />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setMonth(prev)}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          className="h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white"
        >
          <Ionicons name="chevron-back" size={16} color="#334155" />
        </Pressable>
        <View className="min-w-0 flex-1 items-center">
          <Text className="text-[16px] font-semibold text-ink-900" numberOfLines={1}>
            {monthTitle(month)}
          </Text>
          {month !== today.slice(0, 7) ? (
            <Pressable onPress={() => setMonth(today.slice(0, 7))} accessibilityRole="button" hitSlop={8}>
              <Text className="text-[12px] font-semibold text-[#2855F6]">Back to this month</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setMonth(next)}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          className="h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white"
        >
          <Ionicons name="chevron-forward" size={16} color="#334155" />
        </Pressable>
      </View>
      <View className="mb-2 shrink-0 flex-row flex-wrap items-center gap-x-3 gap-y-1.5">
        {(
          [
            ["P", "Present", "ok"],
            ["08:20", "In time", "ok"],
            ["L", "Late", "late"],
            ["A", "Absent", "absent"],
            ["Off", "Off day", "off"],
          ] as const
        ).map(([text, label, tone]) => (
          <View key={label} className="flex-row items-center gap-1.5">
            <Cell text={text} tone={tone} />
            <Text className="text-[12px] text-ink-600">{label}</Text>
          </View>
        ))}
      </View>
      {canEdit ? (
        <Text className="mb-2 shrink-0 text-[12px] leading-[17px] text-ink-600">Tap a teacher to set today's In time. Past days fill in after Save the day.</Text>
      ) : null}
      <View className="min-h-0 flex-1">{scroller}</View>
      <Modal
        open={Boolean(edit)}
        title={edit ? `Edit ${edit.person.name}` : "Edit In"}
        onClose={() => setEdit(null)}
        footer={
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button variant="ghost" onPress={() => setEdit(null)}>
              Cancel
            </Button>
            <Button variant="ghost" onPress={() => void saveIn(true)} disabled={busy}>
              Clear In
            </Button>
            <Button onPress={() => void saveIn()} disabled={busy}>
              {busy ? "Saving…" : "Save In time"}
            </Button>
          </View>
        }
      >
        <View className="gap-3">
          <Text className="text-sm text-ink-700">Today’s In time. This is saved to the register.</Text>
          <Field label="In time">
            <Input
              value={edit?.inAt || ""}
              onChangeText={(value) => setEdit((cur) => (cur ? { ...cur, inAt: value } : cur))}
              placeholder="08:15"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="In time"
            />
          </Field>
          {preview ? (
            <Text className={`text-sm font-semibold ${preview.status === "LATE" ? "text-amber-800" : "text-emerald-700"}`}>
              {preview.status === "LATE" ? `Late · ${preview.minutesLate} min after ${rules.startTime}` : "Present"}
            </Text>
          ) : (
            <Text className="text-sm text-ink-500">Empty In marks this teacher absent today.</Text>
          )}
        </View>
      </Modal>
    </View>
  );
}
