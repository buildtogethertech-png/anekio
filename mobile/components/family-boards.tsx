import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Linking, Modal as RnModal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { DateField } from "./date-field";
import { NewConversationSheet } from "./inbox-board";
import { ChildPill } from "./child-pill";
import { DocViewer } from "./doc-viewer";
import { ParentDetailsCard, ParentDetailsSheet, useParentDetails } from "./parent-details";
import { Badge, Button, Card, Chip, ChipScroller, CloseButton, Empty, Field, Input, Modal, PageHeader, Stat, Toast, useToast } from "./ui";
import { act } from "../lib/mutate";
import { api, webOrigin } from "../lib/api";
import {
  attendanceCbseNote,
  attendanceCountLine,
  attendanceHint,
  attendanceSummary,
  attendanceLetter,
  lastAttendanceDots,
  todayMark,
  todayMarkLabel,
} from "../lib/attendance-summary";
import { addDays, calendarFrom, closedCaption, closedReason, ymd, type SchoolCalendar } from "../lib/calendar";
import { AttendanceDots, DayMark, OnLeaveSign } from "./attendance-mark";
import { useRecord, type RecordPayload } from "../lib/record";
import { useSession } from "../lib/session";
import { openAuthedFile, openMarksheetPdf } from "../lib/print-html";
import { examTodoKind, examTodoTone } from "./exam-teacher-work";
import { LeaveApplyCard, LeaveDecideList } from "./leave-apply";
import { ManagerPicker } from "./manager-picker";
import { TeacherMonthlyRegister } from "./teacher-monthly-register";
import { StaffAttendanceQrButton } from "./staff-attendance-qr";
import { studentMetaLine } from "../lib/student-label";

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

function ChildSwitch({ fullWidth = false }: { fullWidth?: boolean } = {}) {
  const { data, childId, setChildId } = useRecord();
  const kids = data?.children ?? [];
  const child = data?.child;
  const triggerRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState({ x: 0, y: 0, w: 220 });
  const { width: phoneWidth } = useWindowDimensions();
  const many = kids.length > 1;
  const activeId = childId || child?.id;

  function close() {
    setOpen(false);
  }

  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!child && !kids.length) return null;

  if (phoneWidth < 768) return <ChildPill />;

  function toggle() {
    if (!many) return;
    const node = triggerRef.current;
    if (!node?.measureInWindow) {
      setMenu({ x: 24, y: 88, w: fullWidth ? 300 : 220 });
      setOpen(true);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      const screen = Dimensions.get("window");
      const width = Math.min(fullWidth ? 320 : 240, Math.max(200, w || 220));
      const left = Math.min(Math.max(8, x), screen.width - width - 8);
      const top = Math.min(y + h + 4, screen.height - 180);
      setMenu({ x: left, y: top, w: width });
      setOpen(true);
    });
  }

  return (
    <View collapsable={false} ref={triggerRef} style={fullWidth ? { width: "100%" } : { width: 220 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Switch child"
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        className="h-[42px] flex-row items-center rounded-lg border border-ink-200 bg-white px-3"
      >
        <Text className="min-w-0 flex-1 text-[13px] font-medium text-ink-900" numberOfLines={1}>
          {child ? `${child.name} · ${studentMetaLine(child)}` : "Select child"}
        </Text>
        {many ? <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color="#64748B" /> : null}
      </Pressable>
      <RnModal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View className="flex-1">
          <Pressable className="absolute inset-0" onPress={close} />
          <View
            className="absolute overflow-hidden rounded-lg border border-ink-200 bg-white"
            style={{ top: menu.y, left: menu.x, width: menu.w, maxHeight: 260 }}
          >
            <Text className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Children</Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 220 }}>
              {kids.map((c) => {
                const on = activeId === c.id;
                const meta = studentMetaLine({
                  classLabel: c.classLabel,
                  rollNumber: c.rollNumber ?? (on && child?.id === c.id ? child.rollNumber : null),
                  admissionNo: c.admissionNo || (on && child?.id === c.id ? child.admissionNo : ""),
                });
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      void setChildId(c.id);
                      close();
                    }}
                    className={`px-3 py-2.5 ${on ? "bg-[#EEF2FF]" : "bg-white"}`}
                  >
                    <Text className={`text-[13px] ${on ? "font-semibold text-clay-500" : "font-medium text-ink-900"}`}>
                      {on ? "✓ " : ""}
                      {c.name}
                    </Text>
                    <Text className="mt-0.5 text-[12px] text-ink-500">
                      {meta}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </RnModal>
    </View>
  );
}

function birthdayToday(ymd?: string) {
  if (!ymd || ymd.length < 10) return false;
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return ymd.slice(5, 10) === `${mm}-${dd}`;
}

function parentTel(phone?: string) {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `tel:+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `tel:+${digits}`;
  if (digits.length >= 8) return `tel:+${digits}`;
  return "";
}

function parentWa(phone?: string, text?: string) {
  const digits = (phone || "").replace(/\D/g, "");
  const n =
    digits.length === 10
      ? `91${digits}`
      : digits.length === 12 && digits.startsWith("91")
        ? digits
        : digits.length >= 10
          ? digits
          : "";
  if (!n) return "";
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

const CARD_SHADOW = { shadowColor: "#0f2744", shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 };
const HERO_SHADOW = { shadowColor: "#1F45C7", shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 };

function dayGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** "14:30" → "2:30 PM". */
function prettyTime(value?: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!match) return value || "";
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

function timeRange(start?: string, end?: string) {
  if (!start) return "";
  return end ? `${prettyTime(start)} – ${prettyTime(end)}` : prettyTime(start);
}

/** How far into the current lesson we are. */
function lessonProgress(start?: string, end?: string) {
  const toMinutes = (value?: string) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null || to <= from) return null;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  if (current < from) return { started: false, done: 0, left: to - from };
  return { started: true, done: Math.min(1, (current - from) / (to - from)), left: Math.max(0, to - current) };
}

/** "due 2026-09-14" → "due 14 Sep". */
function friendlyHint(text?: string) {
  return String(text || "").replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y: string, m: string, d: string) =>
    new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
  );
}

export function TeacherDeskBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState("");
  const showDeskDetails = false;
  const first = (user?.name || "").split(" ")[0] || "there";
  const day = todaySlots(data ?? { kind: "TEACHER" });
  const next = nextPeriod(day.periods);
  const upcoming = nextScheduledPeriod(data ?? { kind: "TEACHER" });
  const rest = remainingPeriods(day.periods, next);
  const todos = (data?.todos ?? []).filter((t) => examTodoKind(t) !== "skip");
  const roster = data?.roster ?? [];
  const notices = data?.notices ?? [];
  const needsAttention = data?.needsAttention ?? [];
  const lateToday = roster.filter((s) => s.today === "late").map((s) => s.name);
  const outToday = data?.outToday ?? [];
  const birthdays = roster.filter((s) => birthdayToday(s.dateOfBirth)).map((s) => s.name);
  const taughtClasses = [...new Set((data?.timetable?.slots ?? []).map((s) => s.classLabel).filter(Boolean))];
  const taughtSubjects = [...new Set((data?.timetable?.slots ?? []).map((s) => s.subject).filter((s) => s && s !== "—"))];
  const classDays = roster.flatMap((s) => s.days ?? []);
  const classAtt = classDays.length ? attendanceSummary(classDays) : null;
  const cbse = classAtt ? attendanceCbseNote(classAtt) : null;
  const calendar = useMemo(
    () => calendarFrom(data?.calendar?.holidays, data?.calendar?.weekdays ?? data?.timetable?.weekdays),
    [data?.calendar, data?.timetable?.weekdays]
  );
  const todayClosed = closedReason(ymd(new Date()), calendar);
  const homeroomLabel = data?.classTeacher && data.classLabel ? data.classLabel : "";
  const { width } = useWindowDimensions();
  const wideDashboard = width >= 1000;
  const phoneDashboard = width < 768;
  const weekSlots = data?.timetable?.slots ?? [];
  const overdueTodos = todos.filter((todo) => examTodoTone(todo) === "overdue").length;
  const attendanceByDate = new Map<string, { inDays: number; marked: number }>();
  for (const student of roster) {
    for (const row of student.days ?? []) {
      const kind = row.status.trim().toLowerCase();
      if (!["present", "in", "absent", "out", "late", "leave"].includes(kind)) continue;
      const point = attendanceByDate.get(row.date) ?? { inDays: 0, marked: 0 };
      point.marked += 1;
      if (kind === "present" || kind === "in" || kind === "late") point.inDays += 1;
      attendanceByDate.set(row.date, point);
    }
  }
  const attendanceTrend = [...attendanceByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([date, point]) => ({
      date,
      label: new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short" }),
      pct: point.marked ? Math.round((point.inDays / point.marked) * 100) : 0,
    }));
  const weekLoad = (data?.timetable?.weekdays ?? []).map((weekday) => ({
    ...weekday,
    count: weekSlots.filter((slot) => slot.weekday === weekday.n).length,
  }));
  const maxDayLoad = Math.max(1, ...weekLoad.map((dayLoad) => dayLoad.count));
  const dashboardTodos = todos.slice(0, wideDashboard ? 5 : 4);
  const remainingTodoCount = Math.max(0, todos.length - dashboardTodos.length);

  function nextWorkingDayLabel() {
    for (let offset = 1; offset <= 14; offset += 1) {
      const date = addDays(ymd(new Date()), offset);
      if (!closedReason(date, calendar)) {
        return new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
      }
    }
    return "next working day";
  }

  function closedDayVoice(reason: string) {
    if (/^Sun off$/i.test(reason)) return { title: "Happy Sunday", register: "Sunday off", hint: "School is off. Monday the periods show here." };
    if (/^Sat off$/i.test(reason)) return { title: "Saturday off", register: "Saturday off", hint: "School is closed. Next school day the periods show here." };
    if (/\soff$/i.test(reason)) return { title: reason, register: reason, hint: "School is closed. Next school day the periods show here." };
    return { title: reason, register: reason, hint: closedCaption(reason) };
  }

  let greeting = `Hi ${first}`;
  if (data?.classTeacher && data.classLabel) {
    greeting = `Hi ${first} · Class teacher ${data.classLabel}${data.studentCount ? ` · ${data.studentCount}` : ""}`;
  } else if (taughtSubjects.length) {
    greeting = `Hi ${first} · ${taughtSubjects.join(", ")}${day.periods.length ? ` · ${day.periods.length} periods today` : ""}`;
  } else if (day.periods.length) {
    greeting = `Hi ${first} · ${day.periods.length} periods today`;
  }

  function nowCard() {
    return (
      <Pressable className="flex-1" onPress={() => router.push("/timetable")}>
        <Card className="h-full p-4">
          <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">
            Today{day.label ? ` · ${day.label}` : ""}
          </Text>
          {next ? (
            <>
              <Text className="mt-1 text-2xl font-semibold text-ink-900">{next.subject}</Text>
              <Text className="mt-1 text-sm text-ink-700">
                {next.period}
                {next.start ? ` · ${next.start}${next.end ? `–${next.end}` : ""}` : ""}
                {[next.classLabel, next.room].filter(Boolean).length
                  ? ` · ${[next.classLabel, next.room].filter(Boolean).join(" · ")}`
                  : ""}
              </Text>
              {rest.length ? (
                <View className="mt-3 gap-1">
                  <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Rest of the day</Text>
                  {rest.map((p) => (
                    <Text key={`${p.period}-${p.subject}-${p.classLabel}`} className="text-sm text-ink-700">
                      {p.subject}
                      {p.classLabel ? ` · ${p.classLabel}` : ""}
                      {p.start ? ` · ${p.start}${p.end ? `–${p.end}` : ""}` : p.period ? ` · ${p.period}` : ""}
                    </Text>
                  ))}
                </View>
              ) : null}
            </>
          ) : day.periods.length ? (
            <>
              <Text className="mt-1 text-2xl font-semibold text-ink-900">Done for today</Text>
              <Text className="mt-1 text-sm text-ink-700">
                Your scheduled lessons are complete.
              </Text>
            </>
          ) : todayClosed ? (
            <>
              <Text className="mt-1 text-2xl font-semibold text-ink-900">{closedDayVoice(todayClosed).title}</Text>
              <Text className="mt-1 text-sm text-ink-700">{closedDayVoice(todayClosed).hint}</Text>
            </>
          ) : (
            <>
              <Text className="mt-1 text-2xl font-semibold text-ink-900">No class now</Text>
              <Text className="mt-1 text-sm text-ink-700">When the week is filled, today’s periods show here.</Text>
            </>
          )}
        </Card>
      </Pressable>
    );
  }

  function registerCard() {
    if (!data?.classTeacher) return null;
    const out = outToday.length;
    const late = lateToday.length;
    const closed = todayClosed ? closedDayVoice(todayClosed) : null;
    const headline = closed
      ? closed.register
      : !data.markedToday
        ? "Not marked"
        : out && late
          ? `${out} out · ${late} late`
          : out
            ? `${out} out`
            : late
              ? `${late} late`
              : "All present";
    const names = [...outToday, ...lateToday].filter(Boolean);
    return (
      <Pressable className="flex-1" onPress={() => router.push("/attendance")}>
        <Card className={`h-full p-4 ${!closed && !data.markedToday ? "border-clay-500" : ""}`}>
          <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Today’s register</Text>
          <Text className={`mt-1 text-2xl font-semibold ${!closed && !data.markedToday ? "text-red-600" : "text-ink-900"}`}>
            {headline}
          </Text>
          <Text className="mt-1 text-sm text-ink-700">
            {closed
              ? "No register today."
              : data.markedToday
                ? names.length
                  ? names.join(", ")
                  : `${data.studentCount} marked. Open Attendance to change it.`
                : "Open Attendance and tick who is out."}
          </Text>
          {data.markedToday && classAtt ? (
            <Text className="mt-1 text-xs text-ink-700">
              {classAtt.pct}% class
              {cbse ? ` · ${cbse}` : ""}
            </Text>
          ) : null}
        </Card>
      </Pressable>
    );
  }

  function todayFocusCard() {
    const closed = todayClosed ? closedDayVoice(todayClosed) : null;
    const registerText = closed
      ? homeroomLabel
        ? `${homeroomLabel} register closed`
        : "Register closed"
      : data?.markedToday
        ? homeroomLabel
          ? `${homeroomLabel} register marked`
          : "Class register marked"
        : data?.classTeacher
          ? homeroomLabel
            ? `${homeroomLabel} register pending`
            : "Class register pending"
          : "No class register";
    const scheduleText = next
      ? `${next.subject}${next.start ? ` · ${next.start}${next.end ? `-${next.end}` : ""}` : ""}${next.classLabel ? ` · ${next.classLabel}` : ""}`
      : day.periods.length
        ? "Scheduled lessons complete"
        : closed
          ? closed.hint
          : "No lesson scheduled now";
    if (phoneDashboard) return PhoneHeroCard();
    return (
      <Card className="mb-4 p-4">
        <View className="flex-row flex-wrap items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-medium uppercase tracking-wide text-clay-600">Today</Text>
            <Text className="mt-1 text-2xl font-semibold text-ink-900">
              {closed ? closed.title : next ? next.subject : day.periods.length ? "Done for today" : "No class now"}
            </Text>
            <Text className="mt-1 text-sm leading-5 text-ink-700">{scheduleText}</Text>
          </View>
          {data?.staffAttendanceSelf ? (
            <View className={phoneDashboard ? "w-full" : "shrink-0"}>
              <StaffAttendanceQrButton token={token} disabled={Boolean(todayClosed)} onMessage={toast.show} />
            </View>
          ) : null}
        </View>
        <View className="mt-4 flex-row flex-wrap gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open attendance register"
            onPress={() => router.push("/attendance")}
            className="min-w-[160px] flex-1 rounded-md border border-ink-100 bg-ink-50 px-3 py-3"
          >
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Attendance</Text>
            <Text className={`mt-1 text-base font-semibold ${!closed && data?.classTeacher && !data.markedToday ? "text-red-700" : "text-ink-900"}`}>
              {registerText}
            </Text>
            <Text className="mt-1 text-xs text-ink-700">
              {closed ? "QR and register are unavailable today." : data?.markedToday ? "Open to review or correct." : "Open to mark the class."}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open timetable"
            onPress={() => router.push("/timetable")}
            className="min-w-[160px] flex-1 rounded-md border border-ink-100 bg-white px-3 py-3"
          >
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Schedule</Text>
            <Text className="mt-1 text-base font-semibold text-ink-900">
              {next ? next.period || "Now" : day.periods.length ? `${day.periods.length} today` : closed ? closed.register : "No class"}
            </Text>
            <Text className="mt-1 text-xs text-ink-700">{rest.length ? `${rest.length} more after this` : "Tap for the week."}</Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  /** Current lesson, as the one strong card on the phone dashboard. Owns the register call-to-action. */
  function PhoneHeroCard() {
    const closed = todayClosed ? closedDayVoice(todayClosed) : null;
    const registerDue = Boolean(data?.classTeacher && !data.markedToday && !closed);
    const progress = next ? lessonProgress(next.start, next.end) : null;
    const label = closed
      ? "Today"
      : next
        ? progress?.started === false
          ? `Up next${next.period ? ` · ${next.period}` : ""}`
          : `Now${next.period ? ` · ${next.period}` : ""}`
        : upcoming
          ? `Next · ${upcoming.dayLabel}`
          : "Today";
    const title = closed ? closed.title : next ? next.subject : upcoming ? upcoming.subject : day.periods.length ? "Done for today" : "No class now";
    const meta = closed
      ? closed.hint
      : next
        ? [timeRange(next.start, next.end), next.classLabel, next.room].filter(Boolean).join(" · ")
        : upcoming
          ? [prettyTime(upcoming.start), upcoming.classLabel].filter(Boolean).join(" · ")
          : day.periods.length
            ? "All your lessons for today are complete."
            : "Your periods show here once the timetable is set.";
    const out = outToday.length;
    const late = lateToday.length;
    return (
      <View className="mb-4 overflow-hidden rounded-3xl bg-[#1F45C7] px-5 pb-5 pt-4" style={HERO_SHADOW}>
        <View className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
        <View className="absolute -bottom-16 right-10 h-32 w-32 rounded-full bg-white/5" />
        <Pressable onPress={() => router.push("/timetable")}>
          <Text className="text-[11px] font-semibold uppercase tracking-[1.2px] text-white/70">{label}</Text>
          <Text className="mt-1.5 text-[28px] font-bold leading-[34px] text-white" numberOfLines={2}>{title}</Text>
          <Text className="mt-1 text-sm text-white/80">{meta}</Text>
          {progress && progress.started ? (
            <View className="mt-4">
              <View className="h-1.5 overflow-hidden rounded-full bg-white/20">
                <View className="h-full rounded-full bg-white" style={{ width: `${Math.round(progress.done * 100)}%` }} />
              </View>
              <Text className="mt-1.5 text-xs text-white/75">
                {progress.left > 0 ? `${progress.left} min left` : "Ending now"}
                {rest.length ? ` · ${rest.length} more today` : ""}
              </Text>
            </View>
          ) : rest.length && next ? (
            <Text className="mt-3 text-xs text-white/75">{rest.length} more lesson{rest.length === 1 ? "" : "s"} today</Text>
          ) : null}
        </Pressable>
        {registerDue ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/attendance")}
            className="mt-4 h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-white active:opacity-90"
          >
            <Ionicons name="checkmark-done" size={19} color="#1F45C7" />
            <Text className="text-[15px] font-semibold text-[#1F45C7]">Mark {homeroomLabel || "class"} attendance</Text>
          </Pressable>
        ) : data?.classTeacher && !closed ? (
          <Pressable onPress={() => router.push("/attendance")} className="mt-4 flex-row items-center gap-2 rounded-2xl bg-white/10 px-3 py-2.5">
            <Ionicons name="checkmark-circle" size={18} color="#BBF7D0" />
            <Text className="min-w-0 flex-1 text-sm font-medium text-white" numberOfLines={1}>
              {homeroomLabel || "Class"} register marked
              {out || late ? ` · ${[out ? `${out} absent` : "", late ? `${late} late` : ""].filter(Boolean).join(", ")}` : " · all present"}
            </Text>
            <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
          </Pressable>
        ) : null}
      </View>
    );
  }

  function phoneQuickActions() {
    if (!phoneDashboard) return null;
    const actions: { icon: keyof typeof Ionicons.glyphMap; label: string; route: string }[] = [
      { icon: "people-outline", label: "My class", route: "/class" },
      { icon: "create-outline", label: "Marks", route: "/exams" },
      { icon: "airplane-outline", label: "Leave", route: "/leave" },
    ];
    if (!data?.staffAttendanceSelf) actions.push({ icon: "time-outline", label: "Timetable", route: "/timetable" });
    return (
      <View className="mb-4 flex-row justify-between rounded-3xl bg-white px-3 py-4" style={CARD_SHADOW}>
        {data?.staffAttendanceSelf ? (
          <StaffAttendanceQrButton token={token} disabled={Boolean(todayClosed)} tile round onMessage={toast.show} />
        ) : null}
        {actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => router.push(action.route as never)}
            className="flex-1 items-center gap-1.5 active:opacity-70"
          >
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF3FF]">
              <Ionicons name={action.icon} size={22} color="#1F45C7" />
            </View>
            <Text className="text-xs font-medium text-ink-800">{action.label}</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  function phoneNeedsAttentionCard() {
    if (!phoneDashboard) return null;
    type Item = { key: string; icon: keyof typeof Ionicons.glyphMap; title: string; hint: string; route: string; tel?: string; status?: "Overdue" | "Soon" | "Absent" | "Late" | "Call" };
    const items: Item[] = [];
    for (const todo of todos) {
      const tone = examTodoTone(todo);
      const kind = examTodoKind(todo);
      items.push({
        key: todo.id,
        icon: kind === "paper" ? "document-text-outline" : kind === "marks" ? "create-outline" : "clipboard-outline",
        title: todo.title.replace(/^Take exam · /, ""),
        hint: friendlyHint(todo.hint),
        route: `/exams?lane=${kind === "take" ? "take" : kind === "marks" ? "marks" : "paper"}`,
        status: tone === "overdue" ? "Overdue" : tone === "soon" ? "Soon" : undefined,
      });
    }
    // Students absent 3+ school days in a row: the class teacher should call home.
    const streakNames = new Set<string>();
    for (const student of roster) {
      const days = (student.days ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
      let streak = 0;
      for (const day of days) {
        const status = day.status.trim().toLowerCase();
        if (status === "absent" || status === "out") streak += 1;
        else break;
      }
      if (streak < 3) continue;
      streakNames.add(student.name);
      const digits = String(student.phone || "").replace(/\D/g, "");
      items.push({
        key: `streak-${student.id}`,
        icon: "call-outline",
        title: student.name,
        hint: `Absent ${streak} days in a row${student.parentName ? ` · call ${student.parentName}` : " · call the parent"}`,
        route: "/class",
        tel: digits.length === 10 ? `tel:+91${digits}` : digits.length >= 8 ? `tel:+${digits}` : undefined,
        status: "Call",
      });
    }
    for (const name of outToday.slice(0, 3)) {
      if (streakNames.has(name)) continue;
      items.push({ key: `out-${name}`, icon: "person-remove-outline", title: name, hint: "Absent today", route: "/class", status: "Absent" });
    }
    for (const name of lateToday.slice(0, 3)) items.push({ key: `late-${name}`, icon: "time-outline", title: name, hint: "Came late today", route: "/class", status: "Late" });
    const rank = (item: Item) => (item.status === "Call" ? 0 : item.status === "Overdue" ? 1 : item.status === "Absent" ? 2 : item.status === "Late" ? 3 : item.status === "Soon" ? 4 : 5);
    items.sort((a, b) => rank(a) - rank(b));
    const shown = items.slice(0, 4);
    const statusStyle: Record<NonNullable<Item["status"]>, string> = {
      Call: "bg-red-600 text-white",
      Overdue: "bg-red-50 text-red-700",
      Absent: "bg-red-50 text-red-700",
      Late: "bg-amber-50 text-amber-800",
      Soon: "bg-amber-50 text-amber-800",
    };
    return (
      <View className="mb-4 overflow-hidden rounded-3xl bg-white" style={CARD_SHADOW}>
        <View className="flex-row items-center justify-between px-5 pb-2 pt-4">
          <View className="flex-row items-center gap-2">
            <Text className="text-base font-semibold text-ink-900">To do</Text>
            {items.length ? (
              <View className="rounded-full bg-[#EEF3FF] px-2 py-0.5">
                <Text className="text-xs font-semibold text-[#1F45C7]">{items.length}</Text>
              </View>
            ) : null}
          </View>
          {items.length > shown.length ? (
            <Pressable hitSlop={8} onPress={() => router.push("/exams")}>
              <Text className="text-sm font-medium text-[#1F45C7]">See all</Text>
            </Pressable>
          ) : null}
        </View>
        {shown.length ? (
          shown.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => (item.tel ? void Linking.openURL(item.tel) : router.push(item.route as never))}
              className="flex-row items-center gap-3 px-5 py-3 active:bg-ink-50"
            >
              <View className={`h-10 w-10 items-center justify-center rounded-xl ${item.status === "Call" ? "bg-red-50" : "bg-ink-50"}`}>
                <Ionicons name={item.icon} size={19} color={item.status === "Call" ? "#B91C1C" : "#1e3a5f"} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-medium text-ink-900" numberOfLines={1}>{item.title}</Text>
                <Text className="mt-0.5 text-xs text-ink-700" numberOfLines={1}>{item.hint}</Text>
              </View>
              {item.status ? (
                <View className={`rounded-full px-2 py-0.5 ${statusStyle[item.status].split(" ")[0]}`}>
                  <Text className={`text-[11px] font-semibold ${statusStyle[item.status].split(" ")[1]}`}>{item.status}</Text>
                </View>
              ) : (
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              )}
            </Pressable>
          ))
        ) : (
          <View className="flex-row items-center gap-3 px-5 pb-3 pt-2">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
              <Ionicons name="checkmark-done" size={20} color="#047857" />
            </View>
            <Text className="min-w-0 flex-1 text-sm text-ink-700">You're all caught up.</Text>
          </View>
        )}
        <View className="h-2" />
      </View>
    );
  }

  function phoneSummaryStrip() {
    if (!phoneDashboard) return null;
    const attendancePct = classAtt
      ? classAtt.pct
      : data?.markedToday
        ? Math.max(0, 100 - Math.round((outToday.length / Math.max(1, data.studentCount || roster.length)) * 100))
        : null;
    const stats: { value: string; label: string; route: string; tone?: string }[] = [
      {
        value: String(data?.classTeacher ? data.studentCount || roster.length : taughtClasses.length),
        label: data?.classTeacher ? `Students in ${homeroomLabel || "class"}` : "Classes you teach",
        route: "/class",
      },
      {
        value: attendancePct === null ? "—" : `${attendancePct}%`,
        label: "Attendance, recent",
        route: "/attendance",
        tone: attendancePct === null ? undefined : attendancePct < 75 ? "text-red-700" : attendancePct < 85 ? "text-amber-700" : undefined,
      },
      { value: String(weekSlots.length), label: "Lessons this week", route: "/timetable" },
      { value: String(todos.length), label: overdueTodos ? `Tasks · ${overdueTodos} overdue` : "Open tasks", route: "/exams", tone: overdueTodos ? "text-red-700" : undefined },
    ];
    return (
      <View className="mb-4 rounded-3xl bg-white px-4 pb-4 pt-4" style={CARD_SHADOW}>
        <Text className="mb-3 px-1 text-base font-semibold text-ink-900">This week</Text>
        <View className="flex-row flex-wrap justify-between gap-y-2.5">
          {stats.map((stat) => (
            <Pressable
              key={stat.label}
              accessibilityRole="button"
              accessibilityLabel={`${stat.label}: ${stat.value}`}
              onPress={() => router.push(stat.route as never)}
              className="w-[48.5%] rounded-2xl bg-ink-50 px-4 py-3.5 active:opacity-80"
            >
              <Text className={`text-[26px] font-bold leading-8 ${stat.tone || "text-ink-900"}`}>{stat.value}</Text>
              <Text className="mt-0.5 text-xs text-ink-700" numberOfLines={1}>{stat.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  const team = data?.team;
  const teamLeave = (data?.pendingLeave ?? []).filter((r) => r.who === "teacher" || r.who === "staff");

  return (
    <View>
      {phoneDashboard ? (
        <View className="mb-4 flex-row items-center justify-between gap-3 px-1">
          <View className="min-w-0 flex-1">
            <Text className="text-[22px] font-bold leading-7 text-ink-900" numberOfLines={1}>{dayGreeting()}, {first}</Text>
            <Text className="mt-0.5 text-sm text-ink-700" numberOfLines={1}>
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
              {homeroomLabel ? ` · Class teacher ${homeroomLabel}` : ""}
            </Text>
          </View>
          {homeroomLabel ? (
            <Pressable onPress={() => router.push("/class")} className="h-11 min-w-[44px] items-center justify-center rounded-2xl bg-[#EEF3FF] px-3">
              <Text className="text-sm font-bold text-[#1F45C7]">{homeroomLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
      <View className="mb-4 flex-row flex-wrap items-end justify-between gap-2">
        <View className="min-w-0 flex-1">
          <Text className="text-xs font-medium uppercase tracking-wide text-clay-600">{phoneDashboard ? "Teacher" : "Teacher desk"}</Text>
          <Text className={phoneDashboard ? "mt-1 text-3xl font-semibold text-ink-900" : "mt-1 text-xl font-semibold text-ink-900"}>
            {phoneDashboard ? "Today" : greeting}
          </Text>
          {phoneDashboard ? (
            <Text className="mt-1 text-sm text-ink-700">{todayClosed ? `Next: ${nextWorkingDayLabel()}` : next ? "Class in progress" : "Quick actions ready"}</Text>
          ) : null}
        </View>
        {phoneDashboard && homeroomLabel ? (
          <View className="mb-0.5 items-end">
            <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-700">Class teacher</Text>
            <Text className="mt-0.5 text-xl font-semibold text-ink-900">{homeroomLabel}</Text>
          </View>
        ) : !phoneDashboard ? (
          <Text className="text-xs text-ink-700">{todayClosed ? "Closed day" : data?.markedToday ? "Register marked" : "Needs attention"}</Text>
        ) : null}
      </View>
      )}

      {todayFocusCard()}

      {phoneQuickActions()}

      {phoneNeedsAttentionCard()}

      {phoneSummaryStrip()}

      {!phoneDashboard ? <View className={`mb-4 ${wideDashboard ? "flex-row gap-3" : "flex-row flex-wrap gap-3"}`}>
        {[
          {
            label: data?.classTeacher ? "Students" : "Classes",
            value: String(data?.classTeacher ? data.studentCount || roster.length : taughtClasses.length),
            hint: data?.classTeacher ? data.classLabel || "Your class" : "Taught this week",
            tone: "bg-blue-50 text-clay-600",
            route: "/class",
          },
          {
            label: "Attendance",
            value: classAtt ? `${classAtt.pct}%` : data?.markedToday ? `${Math.max(0, 100 - Math.round((outToday.length / Math.max(1, data.studentCount || roster.length)) * 100))}%` : "—",
            hint: classAtt ? "Recent class average" : data?.markedToday ? "Today" : "Register pending",
            tone: "bg-emerald-50 text-green-700",
            route: "/attendance",
          },
          {
            label: "Weekly lessons",
            value: String(weekSlots.length),
            hint: `${taughtSubjects.length} ${taughtSubjects.length === 1 ? "subject" : "subjects"}`,
            tone: "bg-violet-50 text-violet-700",
            route: "/timetable",
          },
          {
            label: "Action items",
            value: String(todos.length),
            hint: overdueTodos ? `${overdueTodos} overdue` : "Nothing overdue",
            tone: overdueTodos ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800",
            route: "/exams",
          },
        ].map((stat) => (
          <Pressable
            key={stat.label}
            accessibilityRole="button"
            accessibilityLabel={`${stat.label}: ${stat.value}`}
            className={wideDashboard ? "flex-1" : "w-[47%]"}
            onPress={() => router.push(stat.route as never)}
          >
            <Card className={wideDashboard ? "h-full p-4" : "min-h-[112px] p-4"}>
              <View className="flex-row items-center justify-between gap-2">
                <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">{stat.label}</Text>
                <Ionicons name="arrow-forward" size={15} color="#3d4f66" />
              </View>
              <Text className={`mt-2 text-2xl font-semibold ${stat.tone.split(" ")[1]}`}>{stat.value}</Text>
              <Text className="mt-1 text-xs text-ink-700">{stat.hint}</Text>
            </Card>
          </Pressable>
        ))}
      </View> : null}

      {!phoneDashboard ? <View className={`mb-4 gap-4 ${wideDashboard ? "flex-row" : ""}`}>
        <Card className="flex-1 p-4">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-sm font-semibold text-ink-900">Attendance trend</Text>
              <Text className="mt-0.5 text-xs text-ink-700">Last six marked school days</Text>
            </View>
            {classAtt ? <Badge tone="leaf">{`${classAtt.pct}% average`}</Badge> : null}
          </View>
          {attendanceTrend.length ? (
            <View className="mt-5 h-36 flex-row items-end gap-2">
              {attendanceTrend.map((point) => (
                <View key={point.date} className="flex-1 items-center">
                  <Text className="mb-1 text-[10px] font-medium text-ink-700">{point.pct}%</Text>
                  <View className="h-24 w-full max-w-10 justify-end overflow-hidden rounded-md bg-ink-100">
                    <View
                      className={`w-full rounded-md ${point.pct >= 90 ? "bg-emerald-500" : point.pct >= 75 ? "bg-amber-500" : "bg-red-500"}`}
                      style={{ height: `${Math.max(5, point.pct)}%` }}
                    />
                  </View>
                  <Text className="mt-1.5 text-[10px] text-ink-700">{point.label}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View className="mt-4 h-32 items-center justify-center rounded-md bg-ink-50 px-4">
              <Text className="text-center text-sm text-ink-700">Attendance history will build after registers are marked.</Text>
            </View>
          )}
        </Card>

        <Card className="flex-1 p-4">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-sm font-semibold text-ink-900">Teaching load</Text>
              <Text className="mt-0.5 text-xs text-ink-700">Lessons across the school week</Text>
            </View>
            <Badge tone="clay">{`${weekSlots.length} total`}</Badge>
          </View>
          <View className="mt-5 gap-3">
            {weekLoad.map((dayLoad) => (
              <View key={dayLoad.n} className="flex-row items-center gap-3">
                <Text className="w-8 text-xs font-medium text-ink-700">{dayLoad.label.slice(0, 3)}</Text>
                <View className="h-3 flex-1 overflow-hidden rounded-full bg-ink-100">
                  <View
                    className="h-full rounded-full bg-clay-500"
                    style={{ width: `${(dayLoad.count / maxDayLoad) * 100}%` }}
                  />
                </View>
                <Text className="w-5 text-right text-xs font-semibold text-ink-900">{dayLoad.count}</Text>
              </View>
            ))}
          </View>
        </Card>
      </View> : null}
      {showDeskDetails ? (
        <>
      {team ? (
        <Card className="mb-4">
          <View className="flex-row items-center justify-between border-b border-ink-100 px-4 py-3">
            <Text className="text-sm font-medium text-ink-900">Team</Text>
            {data?.teamWeek ? (
              <Pressable onPress={() => router.push("/timetable")}>
                <Text className="text-sm text-clay-600">Week</Text>
              </Pressable>
            ) : null}
          </View>
          {teamLeave.length ? (
            <View className="border-t border-ink-100 px-4 py-3">
              <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">On leave</Text>
              {teamLeave.map((row) => (
                <Text key={row.id} className="mt-1 text-sm text-ink-900">
                  {row.subjectName} · {row.typeName}
                  {row.from ? ` · ${row.from === row.to ? row.from : `${row.from}–${row.to}`}` : ""}
                  {row.halfDay ? ` · ${row.halfDay === "FIRST" ? "first half" : "second half"}` : ""}
                </Text>
              ))}
            </View>
          ) : null}
          {team.holes.length ? (
            <View className="border-t border-ink-100 px-4 py-3">
              <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Empty now</Text>
              {team.holes.map((h) => (
                <Text key={h.classId} className="mt-1 text-sm text-ink-900">
                  {h.classLabel} · {h.count} {h.count === 1 ? "period" : "periods"}
                </Text>
              ))}
            </View>
          ) : team.emptyPeriods ? (
            <View className="border-t border-ink-100 px-4 py-3">
              <Text className="text-sm text-ink-900">{team.emptyPeriods} empty periods</Text>
            </View>
          ) : null}
          <View className="border-t border-ink-100 px-4 py-3">
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Free now</Text>
            {team.idleNow.length ? (
              team.idleNow.map((t) => (
                <Text key={t.id} className="mt-1 text-sm text-ink-900">
                  {t.name}
                  {t.team ? " · team" : ""}
                </Text>
              ))
            ) : (
              <Text className="mt-1 text-sm text-ink-700">Nobody sitting idle.</Text>
            )}
          </View>
          {team.people.length ? (
            <View className="border-t border-ink-100 px-4 py-3">
              <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Reports to you</Text>
              {team.people.map((p) => (
                <View key={p.userId} className="mt-2">
                  <Text className="text-sm text-ink-900">
                    {p.name}
                    {p.role ? ` · ${p.role}` : ""}
                  </Text>
                  <View className="mt-1.5">
                    <ManagerPicker
                      user={user}
                      managers={data?.managers ?? []}
                      value={user?.id}
                      onPick={async (id) => {
                        try {
                          await act(token, "setManager", { userId: p.userId, managerId: id });
                          toast.show("Reporting manager saved.");
                          await reload();
                        } catch (e) {
                          toast.show(e instanceof Error ? e.message : "Could not save.");
                        }
                      }}
                    />
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}
      {taughtClasses.length > 1 && (data?.subjects ?? []).length ? (
        <View className="mb-4 flex-row flex-wrap gap-2">
          {(data?.subjects ?? []).map((s) => (
            <Badge key={s.id}>{s.name}</Badge>
          ))}
        </View>
      ) : null}
        </>
      ) : null}

      {!phoneDashboard ? <View className={`mb-4 gap-4 ${wideDashboard ? "flex-row" : ""}`}>
        {nowCard()}
        {registerCard()}
      </View> : null}

      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}

      {showDeskDetails ? (
        <>
      <Card className="mb-4">
        <View className="flex-row items-center justify-between border-b border-ink-100 px-4 py-3">
          <Text className="text-sm font-medium text-ink-900">Do now</Text>
          <Pressable onPress={() => router.push("/exams")}>
            <Text className="text-sm text-clay-600">Exams</Text>
          </Pressable>
        </View>
        {todos.length ? (
          <>
            {dashboardTodos.map((t) => {
              const tone = examTodoTone(t);
              const kind = examTodoKind(t);
              return (
                <View
                  key={t.id}
                  className={`flex-row items-center gap-3 border-t px-4 py-3 ${
                    tone === "overdue" ? "border-red-200 bg-red-50" : tone === "soon" ? "border-amber-200 bg-amber-50" : "border-ink-100"
                  }`}
                >
                  <Pressable className="min-w-0 flex-1" onPress={() => router.push("/exams")}>
                    <Text className="text-sm font-medium text-ink-900">{t.title}</Text>
                    <Text className={`mt-1 text-xs ${tone === "overdue" ? "text-red-700" : tone === "soon" ? "text-amber-800" : "text-ink-700"}`}>
                      {t.hint}
                    </Text>
                  </Pressable>
                  {kind === "paper" ? (
                    <Button
                      variant="ghost"
                      disabled={pending === t.id}
                      onPress={async () => {
                        const examId = t.examId || t.id.replace(/^paper-/, "");
                        setPending(t.id);
                        try {
                          await act(token, "completeExamWork", { examId, kind: "paper" });
                          toast.show("Marked done.");
                          await reload();
                        } catch (e) {
                          toast.show(e instanceof Error ? e.message : "Could not save.");
                        } finally {
                          setPending("");
                        }
                      }}
                    >
                      Done
                    </Button>
                  ) : null}
                </View>
              );
            })}
            {remainingTodoCount ? (
              <Pressable className="items-center border-t border-ink-100 px-4 py-3" onPress={() => router.push("/exams")}>
                <Text className="text-sm font-medium text-clay-600">
                  View {remainingTodoCount} more {remainingTodoCount === 1 ? "item" : "items"}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <Text className="px-4 py-4 text-sm text-ink-700">Nothing waiting.</Text>
        )}
      </Card>

      {data?.callHome?.length ? (
        <Card className="mb-4">
          <View className="border-b border-ink-100 px-4 py-3">
            <Text className="text-sm font-medium text-ink-900">Call home</Text>
            {todayClosed ? (
              <Text className="mt-1 text-xs text-ink-700">School is off — still fine to ring if you need to.</Text>
            ) : null}
          </View>
          {data.callHome.map((s) => {
            const tel = parentTel(s.phone);
            return (
              <View key={s.id} className="flex-row items-center justify-between border-t border-ink-100 px-4 py-3">
                <View className="flex-1 pr-2">
                  <Text className="text-sm text-ink-900">{s.name}</Text>
                  <Text className="text-xs text-ink-700">
                    {s.days} days · {s.parentName}
                  </Text>
                </View>
                <View className="flex-row items-center gap-3">
                  {s.wa ? (
                    <Pressable onPress={() => Linking.openURL(s.wa)} hitSlop={8} accessibilityLabel="WhatsApp">
                      <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
                    </Pressable>
                  ) : null}
                  {tel ? (
                    <Pressable onPress={() => Linking.openURL(tel)} hitSlop={8} accessibilityLabel="Call">
                      <Ionicons name="call-outline" size={20} color="#1d4ed8" />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      {needsAttention.length ? (
        <Pressable className="mb-4" onPress={() => router.push("/attendance")}>
          <Card>
            <View className="border-b border-ink-100 px-4 py-3">
              <Text className="text-sm font-medium text-ink-900">Needs attention</Text>
            </View>
            {needsAttention.map((name) => (
              <View key={name} className="border-t border-ink-100 px-4 py-3">
                <Text className="text-sm text-ink-900">{name}</Text>
              </View>
            ))}
          </Card>
        </Pressable>
      ) : null}

      {birthdays.length ? (
        <Card className="mb-4 p-4">
          <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Birthday</Text>
          <Text className="mt-1 text-sm text-ink-900">{birthdays.join(", ")}</Text>
        </Card>
      ) : null}

      {notices.length ? (
        <Card className="mb-4">
          <View className="flex-row items-center justify-between border-b border-ink-100 px-4 py-3">
            <Text className="text-sm font-medium text-ink-900">For you</Text>
            <Pressable onPress={() => router.push("/notices")}>
              <Text className="text-sm text-clay-600">Notices</Text>
            </Pressable>
          </View>
          {notices.map((n) => (
            <Pressable key={n.id} onPress={() => router.push("/notices")} className="border-t border-ink-100 px-4 py-3">
              <Text className="text-sm font-medium text-ink-900">{n.title}</Text>
              <Text className="mt-0.5 text-xs text-ink-700">
                {n.createdAt}
                {n.author ? ` · ${n.author}` : ""}
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {(data?.weekPapers ?? []).length ? (
        <Card className="mb-4">
          <View className="flex-row items-center justify-between border-b border-ink-100 px-4 py-3">
            <Text className="text-sm font-medium text-ink-900">This week’s papers</Text>
            <Pressable onPress={() => router.push("/exams")}>
              <Text className="text-sm text-clay-600">Exams</Text>
            </Pressable>
          </View>
          {(data?.weekPapers ?? []).map((e) => (
            <Pressable key={e.id} onPress={() => router.push("/exams")} className="border-t border-ink-100 px-4 py-3">
              <Text className="text-sm text-ink-900">{e.title}</Text>
              <Text className="text-xs text-ink-700">
                {e.subject}
                {e.classLabel ? ` · ${e.classLabel}` : ""} · {e.date}
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {(data?.breakout ?? 0) > 0 ? (
        <Card className="p-4">
          <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Stretch</Text>
          <Text className="mt-1 text-sm text-ink-900">
            {data?.breakout} {data?.breakout === 1 ? "student" : "students"} running ahead
          </Text>
        </Card>
      ) : null}
        </>
      ) : null}
    </View>
  );
}

const LEAVE_TINTS = [
  { bar: "#1F45C7", soft: "#EEF3FF", icon: "airplane-outline" as const },
  { bar: "#0F9F6E", soft: "#E8F7F0", icon: "medkit-outline" as const },
  { bar: "#C2410C", soft: "#FFF1E8", icon: "home-outline" as const },
  { bar: "#7C3AED", soft: "#F3EEFF", icon: "sparkles-outline" as const },
];

const LEAVE_STATUS: Record<string, { label: string; box: string; text: string }> = {
  ACTIVE: { label: "Approved", box: "bg-emerald-50", text: "text-emerald-700" },
  WAITING: { label: "Pending", box: "bg-amber-50", text: "text-amber-800" },
  REJECTED: { label: "Declined", box: "bg-red-50", text: "text-red-700" },
};

/** "16 Oct" or "16 – 18 Oct" or "30 Oct – 2 Nov". */
function leaveRange(from: string, to: string) {
  const a = new Date(`${from.slice(0, 10)}T00:00:00`);
  const b = new Date(`${(to || from).slice(0, 10)}T00:00:00`);
  const day = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric" });
  const dayMonth = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (a.getTime() === b.getTime()) return dayMonth(a);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${day(a)} – ${dayMonth(b)}`;
  return `${dayMonth(a)} – ${dayMonth(b)}`;
}

export function TeacherLeaveBoard() {
  const { data, reload } = useRecord();
  const { token } = useSession();
  const toast = useToast();
  const pending = data?.pendingLeave ?? [];
  const studentLeave = pending.filter((r) => r.who === "student");
  const teamLeave = pending.filter((r) => r.who !== "student");
  const today = ymd(new Date());

  // Leave year = the current school session, else the calendar year.
  const session = (data?.school?.sessions ?? []).find((row) => row.current);
  const yearStart = session?.startsOn?.slice(0, 10) || `${today.slice(0, 4)}-01-01`;
  const yearEnd = session?.endsOn?.slice(0, 10) || `${today.slice(0, 4)}-12-31`;
  const yearLabel = session?.label || today.slice(0, 4);

  const asStaff = data?.kind === "OFFICE";
  const types = (data?.leaveTypes ?? []).filter((type) => (asStaff ? type.forStaff : type.forTeacher)).sort((a, b) => a.sortOrder - b.sortOrder);
  const mine = (data?.myLeave ?? []).slice().sort((a, b) => b.from.localeCompare(a.from));
  const inYear = mine.filter((row) => row.from.slice(0, 10) >= yearStart && row.from.slice(0, 10) <= yearEnd);
  const balances = types.map((type, index) => {
    const rows = inYear.filter((row) => row.typeId === type.id);
    const server = (data?.leaveBalances ?? []).find((b) => b.typeId === type.id);
    const tint = LEAVE_TINTS[index % LEAVE_TINTS.length];
    if (server) {
      // Ledger-based balance: "cap" is what has been credited so far this leave year.
      return {
        type,
        used: server.used,
        waiting: server.pending,
        cap: server.limited ? server.earned : 0,
        left: server.limited ? Math.max(0, server.available) : null,
        tint,
      };
    }
    const used = rows.filter((row) => row.status === "ACTIVE").reduce((sum, row) => sum + (row.days || 0), 0);
    const waiting = rows.filter((row) => row.status === "WAITING").reduce((sum, row) => sum + (row.days || 0), 0);
    const cap = type.yearlyCap || 0;
    return { type, used, waiting, cap, left: cap ? Math.max(0, cap - used) : null, tint };
  });
  const [historyTab, setHistoryTab] = useState<"taken" | "credits">("taken");
  const [credits, setCredits] = useState<{ id: string; typeId: string; typeName: string; kind: string; days: number; note: string; at: string }[]>([]);
  const [showAllCredits, setShowAllCredits] = useState(false);
  useEffect(() => {
    if (!token) return;
    api<{ ledger: typeof credits }>("/leave-ledger?me=1", token)
      .then((res) => setCredits(res.ledger))
      .catch(() => setCredits([]));
  }, [token, data?.leaveBalances]);
  const capped = balances.filter((row) => row.cap > 0);
  const totalCap = capped.reduce((sum, row) => sum + row.cap, 0);
  const totalUsed = capped.reduce((sum, row) => sum + row.used, 0);
  const totalWaiting = balances.reduce((sum, row) => sum + row.waiting, 0);
  const totalLeft = Math.max(0, totalCap - totalUsed);
  const upcoming = mine.filter((row) => (row.to || row.from).slice(0, 10) >= today && row.status !== "REJECTED");
  const past = mine.filter((row) => !upcoming.includes(row)).slice(0, 8);
  const tintFor = (typeId: string) => balances.find((row) => row.type.id === typeId)?.tint || LEAVE_TINTS[0];

  const done = async (ok: string) => {
    toast.show(ok);
    await reload();
  };

  function requestRow(row: (typeof mine)[number]) {
    const tint = tintFor(row.typeId);
    const status = LEAVE_STATUS[row.status] || LEAVE_STATUS.WAITING;
    return (
      <View key={row.id} className="flex-row items-center gap-3 px-5 py-3">
        <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: tint.soft }}>
          <Ionicons name={tint.icon} size={19} color={tint.bar} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-medium text-ink-900" numberOfLines={1}>
            {leaveRange(row.from, row.to)}
            {row.halfDay ? ` · ${row.halfDay === "FIRST" ? "First half" : "Second half"}` : ""}
          </Text>
          <Text className="mt-0.5 text-xs text-ink-700" numberOfLines={1}>
            {row.typeName} · {row.halfDay ? "½ day" : `${row.days} day${row.days === 1 ? "" : "s"}`}
            {row.reason ? ` · ${row.reason}` : ""}
          </Text>
          <Text className="mt-0.5 text-[11px] text-ink-500" numberOfLines={1}>
            {row.autoApproved
              ? "Auto-approved · no reporting manager"
              : row.status === "WAITING"
                ? `Waiting on ${row.approverName || "your manager"}`
                : row.decidedBy
                  ? `${row.status === "REJECTED" ? "Declined" : "Approved"} by ${row.decidedBy}`
                  : ""}
          </Text>
        </View>
        <View className={`rounded-full px-2.5 py-1 ${status.box}`}>
          <Text className={`text-[11px] font-semibold ${status.text}`}>{status.label}</Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="mb-4 flex-row items-center justify-between gap-3 px-1">
        <View className="min-w-0 flex-1">
          <Text className="text-[22px] font-bold leading-7 text-ink-900">Leave</Text>
          <Text className="mt-0.5 text-sm text-ink-700">Session {yearLabel}</Text>
        </View>
        <LeaveApplyCard audience={asStaff ? "staff" : "teacher"} token={token} triggerOnly onDone={done} onError={(msg) => toast.show(msg)} />
      </View>

      {types.length ? (
        <View className="mb-4 overflow-hidden rounded-3xl bg-[#1F45C7] px-5 pb-5 pt-4" style={{ shadowColor: "#1F45C7", shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 5 }}>
          <View className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
          <Text className="text-[11px] font-semibold uppercase tracking-[1.2px] text-white/70">Leave balance</Text>
          {totalCap ? (
            <>
              <View className="mt-1 flex-row items-end gap-2">
                <Text className="text-[40px] font-bold leading-[46px] text-white">{totalLeft}</Text>
                <Text className="mb-1.5 text-base text-white/80">of {totalCap} days left</Text>
              </View>
              <View className="mt-3 h-2 flex-row overflow-hidden rounded-full bg-white/20">
                <View className="h-full bg-white" style={{ width: `${Math.min(100, (totalUsed / totalCap) * 100)}%` }} />
                <View className="h-full bg-white/50" style={{ width: `${Math.min(100, (totalWaiting / totalCap) * 100)}%` }} />
              </View>
              <View className="mt-2 flex-row gap-4">
                <Text className="text-xs text-white/80">● {totalUsed} used</Text>
                {totalWaiting ? <Text className="text-xs text-white/70">◐ {totalWaiting} pending</Text> : null}
                {upcoming.length ? <Text className="text-xs text-white/70">{upcoming.length} upcoming</Text> : null}
              </View>
            </>
          ) : (
            <Text className="mt-1 text-2xl font-bold text-white">No yearly limit</Text>
          )}
        </View>
      ) : null}

      {balances.length ? (
        <View className="mb-4 flex-row flex-wrap justify-between gap-y-3">
          {balances.map(({ type, used, waiting, cap, left, tint }) => (
            <View key={type.id} className="w-[48.5%] rounded-3xl bg-white p-4" style={CARD_SHADOW}>
              <View className="flex-row items-center justify-between">
                <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: tint.soft }}>
                  <Ionicons name={tint.icon} size={18} color={tint.bar} />
                </View>
                {waiting ? (
                  <View className="rounded-full bg-amber-50 px-2 py-0.5">
                    <Text className="text-[10px] font-semibold text-amber-800">{waiting} pending</Text>
                  </View>
                ) : null}
              </View>
              <Text className="mt-3 text-sm font-medium text-ink-800" numberOfLines={1}>{type.name}</Text>
              <View className="mt-0.5 flex-row items-end gap-1">
                <Text className="text-[26px] font-bold leading-8 text-ink-900">{left === null ? "∞" : left}</Text>
                <Text className="mb-1 text-xs text-ink-700">{cap ? `of ${cap} left` : "no limit"}</Text>
              </View>
              {cap ? (
                <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <View className="h-full rounded-full" style={{ width: `${Math.min(100, ((cap - used) / cap) * 100)}%`, backgroundColor: tint.bar }} />
                </View>
              ) : (
                <Text className="mt-2 text-[11px] text-ink-700">{used} used this session</Text>
              )}
              {type.noticeDays ? (
                <Text className="mt-2 text-[11px] text-ink-500">Apply {type.noticeDays} day{type.noticeDays === 1 ? "" : "s"} ahead</Text>
              ) : (
                <Text className="mt-2 text-[11px] text-ink-500">Same-day allowed</Text>
              )}
            </View>
          ))}
        </View>
      ) : (
        <View className="mb-4 rounded-3xl bg-white p-5" style={CARD_SHADOW}>
          <Text className="text-sm text-ink-700">The office hasn't set up leave types yet.</Text>
        </View>
      )}

      <LeaveDecideList rows={studentLeave} token={token} onDone={done} onError={(msg) => toast.show(msg)} />
      <LeaveDecideList rows={teamLeave} title="Team leave requests" token={token} onDone={done} onError={(msg) => toast.show(msg)} />

      <View className="mb-4 overflow-hidden rounded-3xl bg-white" style={CARD_SHADOW}>
        <View className="flex-row items-center gap-2 px-5 pb-1 pt-4">
          <Text className="text-base font-semibold text-ink-900">Upcoming</Text>
          {upcoming.length ? (
            <View className="rounded-full bg-[#EEF3FF] px-2 py-0.5">
              <Text className="text-xs font-semibold text-[#1F45C7]">{upcoming.length}</Text>
            </View>
          ) : null}
        </View>
        {upcoming.length ? (
          upcoming.map(requestRow)
        ) : (
          <View className="flex-row items-center gap-3 px-5 pb-2 pt-2">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
              <Ionicons name="sunny-outline" size={20} color="#047857" />
            </View>
            <Text className="min-w-0 flex-1 text-sm text-ink-700">No leave planned. Tap “Apply for leave” when you need time off.</Text>
          </View>
        )}
        <View className="h-3" />
      </View>

      {past.length || credits.length ? (
        <View className="mb-4 overflow-hidden rounded-3xl bg-white" style={CARD_SHADOW}>
          <View className="flex-row items-center justify-between gap-3 px-5 pb-1 pt-4">
            <Text className="text-base font-semibold text-ink-900">History</Text>
            {credits.length ? (
              <View className="flex-row rounded-xl bg-ink-100 p-0.5">
                {([
                  ["taken", "Leave taken"],
                  ["credits", "Credits"],
                ] as const).map(([key, label]) => (
                  <Pressable key={key} onPress={() => setHistoryTab(key)} className={`h-8 justify-center rounded-lg px-3 ${historyTab === key ? "bg-white" : ""}`}>
                    <Text className={`text-[12px] font-semibold ${historyTab === key ? "text-ink-900" : "text-ink-500"}`}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          {historyTab === "credits" && credits.length ? (
            <>
              {(showAllCredits ? credits : credits.slice(0, 8)).map((c) => {
                const tint = tintFor(c.typeId);
                const neg = c.days < 0;
                const label =
                  c.kind === "CREDIT" ? c.note : c.kind === "CARRY_FORWARD" ? c.note || "Carried forward" : c.kind === "LAPSE" ? c.note || "Lapsed" : c.kind === "OPENING" ? "Opening balance" : c.note || "Adjustment";
                return (
                  <View key={c.id} className="flex-row items-center gap-3 px-5 py-3">
                    <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: tint.soft }}>
                      <Ionicons name={neg ? "remove" : c.kind === "CARRY_FORWARD" ? "arrow-redo-outline" : "add"} size={19} color={tint.bar} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[15px] font-medium text-ink-900" numberOfLines={1}>{c.typeName}</Text>
                      <Text className="mt-0.5 text-xs text-ink-700" numberOfLines={1}>
                        {label} · {new Date(c.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </Text>
                    </View>
                    <Text className={`text-[15px] font-bold ${neg ? "text-[#B42318]" : "text-[#18794E]"}`}>
                      {neg ? "" : "+"}
                      {c.days % 1 ? c.days.toFixed(1) : c.days}
                    </Text>
                  </View>
                );
              })}
              {credits.length > 8 ? (
                <Pressable onPress={() => setShowAllCredits((v) => !v)} className="px-5 py-2">
                  <Text className="text-[13px] font-semibold text-[#1F45C7]">{showAllCredits ? "Show less" : `Show all ${credits.length}`}</Text>
                </Pressable>
              ) : null}
            </>
          ) : past.length ? (
            past.map(requestRow)
          ) : (
            <Text className="px-5 py-4 text-[13px] text-ink-500">No leave taken yet.</Text>
          )}
          <View className="h-3" />
        </View>
      ) : null}
    </View>
  );
}

export function TeacherClassBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const toast = useToast();
  const roster = data?.roster ?? [];
  const [q, setQ] = useState("");
  const [noteFor, setNoteFor] = useState<(typeof roster)[number] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const classLabel = data?.classLabel || "";
  const teacherName = user?.name || "class teacher";
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? roster.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) || (s.parentName || "").toLowerCase().includes(needle)
      )
    : roster;

  function classTeacherLine(child: string, extra?: string) {
    const lead = `Namaste, this is ${teacherName}, class teacher of ${classLabel || "this section"}.`;
    return extra ? `${lead} ${extra}` : `${lead} I wanted to speak with you about ${child}.`;
  }

  function openNote(s: (typeof roster)[number]) {
    setNoteFor(s);
    setTitle(`Note · ${s.name}`);
    setBody("");
  }

  async function sendNote() {
    if (!noteFor) return;
    setBusy(true);
    try {
      await act(token, "sendClassNote", { studentId: noteFor.id, title, body });
      toast.show("Sent to that family.");
      setNoteFor(null);
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  function whatsappNote() {
    if (!noteFor) return;
    const text = classTeacherLine(noteFor.name, [title.trim(), body.trim()].filter(Boolean).join(" "));
    const href = parentWa(noteFor.phone, text);
    if (!href) {
      toast.show("No parent number.");
      return;
    }
    void Linking.openURL(href);
  }

  return (
    <View className="min-h-0 flex-1">
      <PageHeader
        title={classLabel || "Class"}
        lede={roster.length ? "Call or WhatsApp home. A note reaches that family only." : undefined}
      />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {!roster.length ? (
        <Empty title="No class teacher section" body="When you are class teacher, your section is here." />
      ) : (
        <Card className="min-h-0 flex-1">
          <View className="border-b border-ink-100 px-4 py-4">
            <Field label="Search">
              <View className="flex-row items-center rounded-md border border-ink-200 bg-white pl-2.5">
                <Ionicons name="search-outline" size={18} color="#3d4f66" />
                <Input
                  value={q}
                  onChangeText={setQ}
                  placeholder="Name"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-w-0 flex-1 border-0"
                />
              </View>
            </Field>
          </View>
          <ScrollView className="min-h-0 flex-1" keyboardShouldPersistTaps="handled">
            {!shown.length ? (
              <View className="px-4 py-8">
                <Empty title="No match" body="Clear search to see the full class." />
              </View>
            ) : (
              shown.map((s) => {
                const tel = parentTel(s.phone);
                const wa = parentWa(s.phone, classTeacherLine(s.name));
                return (
                  <View key={s.id} className="flex-row items-center gap-3 border-t border-ink-100 px-4 py-3">
                    <Pressable className="min-w-0 flex-1" onPress={() => openNote(s)}>
                      <Text className="text-sm font-medium text-ink-900">{s.name}</Text>
                      <Text className="mt-0.5 text-xs text-ink-700">{s.parentName || "Parent"}</Text>
                    </Pressable>
                    <View className="flex-row items-center gap-3">
                      <Pressable onPress={() => openNote(s)} hitSlop={8} accessibilityLabel="Note">
                        <Ionicons name="create-outline" size={20} color="#9a3412" />
                      </Pressable>
                      {wa ? (
                        <Pressable onPress={() => Linking.openURL(wa)} hitSlop={8} accessibilityLabel="WhatsApp">
                          <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
                        </Pressable>
                      ) : null}
                      {tel ? (
                        <Pressable onPress={() => Linking.openURL(tel)} hitSlop={8} accessibilityLabel="Call">
                          <Ionicons name="call-outline" size={20} color="#1d4ed8" />
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Card>
      )}
      <Modal
        open={Boolean(noteFor)}
        title={noteFor ? noteFor.name : "Note"}
        onClose={() => setNoteFor(null)}
        footer={
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={busy || !noteFor?.phone} onPress={whatsappNote}>
              WhatsApp this
            </Button>
            <Button disabled={busy} onPress={() => void sendNote()}>
              Send
            </Button>
          </View>
        }
      >
        <View className="gap-3">
          <Text className="text-sm text-ink-700">
            This note goes to {noteFor?.parentName || "the parent"} only — not the whole class.
          </Text>
          <Field label="Title">
            <Input value={title} onChangeText={setTitle} />
          </Field>
          <Field label="Note" hint="Two or three lines.">
            <Input value={body} onChangeText={setBody} multiline className="min-h-[96px]" />
          </Field>
        </View>
      </Modal>
    </View>
  );
}

export function TeacherAttendanceBoard() {
  const { data, reload } = useRecord();
  const { token } = useSession();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const roster = data?.roster ?? [];
  const [q, setQ] = useState("");
  const [monthly, setMonthly] = useState(false);
  const calendar = useMemo(
    () => calendarFrom(data?.calendar?.holidays, data?.calendar?.weekdays ?? data?.timetable?.weekdays),
    [data?.calendar, data?.timetable?.weekdays]
  );
  const today = ymd(new Date());
  const [date, setDate] = useState(today);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCode, setScanCode] = useState("");
  const [scanHit, setScanHit] = useState("");
  const [scanStatus, setScanStatus] = useState("");
  const [scanResult, setScanResult] = useState<{ tone: "idle" | "success" | "warn" | "danger"; title: string; body: string }>({
    tone: "idle",
    title: "Ready to scan",
    body: "Point the camera at a student ID QR.",
  });
  const scanVideoRef = useRef<unknown>(null);
  const scanStreamRef = useRef<MediaStream | null>(null);
  const scanBusyRef = useRef(false);
  const dayClosed = closedReason(date, calendar);
  const dayFuture = date > today;
  const locked = Boolean(dayClosed || dayFuture);
  const lockedNote = dayFuture ? "That day has not come yet." : closedCaption(dayClosed);

  function statusOf(s: (typeof roster)[number]) {
    const hit = s.days?.find((d) => d.date === date);
    const saved = (hit?.status || (date === today && s.today !== "not marked" ? s.today : "")).toUpperCase();
    if (saved === "LEAVE") return "LEAVE";
    if (marks[s.id]) return marks[s.id];
    return saved || "PRESENT";
  }

  async function save() {
    if (locked) {
      toast.show(lockedNote || "Attendance is not marked.");
      return;
    }
    try {
      await act(token, "markAttendance", {
        date,
        rows: roster.map((s) => ({ studentId: s.id, status: statusOf(s).toUpperCase() })),
      });
      toast.show("Attendance saved.");
      setMarks({});
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function applyScan(raw: string) {
    const clean = raw.trim().toLowerCase();
    if (!clean) return;
    if (locked) {
      setScanResult({ tone: "warn", title: "Attendance locked", body: lockedNote || "Attendance is not marked for this day." });
      toast.show(lockedNote || "Attendance is not marked.");
      return;
    }
    const looksLikeIssuedQr = /\/(attendance\/scan|staff\/scan|verify|documents)\//i.test(raw) || /^https?:\/\//i.test(raw.trim());
    const student = looksLikeIssuedQr ? undefined : roster.find((s) => {
      const admission = String((s as { admissionNo?: string }).admissionNo || "").toLowerCase();
      const id = s.id.toLowerCase();
      return admission && (clean === admission || s.name.toLowerCase() === clean || id === clean);
    });
    let resolved = student;
    if (!resolved && looksLikeIssuedQr) {
      try {
        setScanResult({ tone: "idle", title: "Checking card", body: "Resolving this issued ID card..." });
        const result = await act<{ ok: true; studentId: string; documentNumber: string }>(token, "resolveStudentIdCardScan", { code: raw });
        resolved = roster.find((s) => s.id === result.studentId);
        if (!resolved) {
          setScanHit("");
          setScanResult({ tone: "danger", title: "Different class", body: `${result.documentNumber} belongs to a student outside this class register.` });
          toast.show("This ID card is not for this class.");
          return;
        }
      } catch (error) {
        setScanHit("");
        setScanResult({ tone: "danger", title: "Rejected", body: error instanceof Error ? error.message : "This is not a valid Student ID card." });
        toast.show(error instanceof Error ? error.message : "This is not a valid Student ID card.");
        return;
      }
    }
    if (!resolved) {
      setScanHit("");
      setScanResult({ tone: "danger", title: "Rejected", body: `No student in this class matched: ${raw.trim().slice(0, 80)}` });
      toast.show("No student found for this card.");
      return;
    }
    const before = statusOf(resolved).toUpperCase();
    setMarks((m) => ({ ...m, [resolved.id]: "PRESENT" }));
    setQ(resolved.name);
    setScanHit(resolved.name);
    setScanResult({
      tone: before === "PRESENT" ? "warn" : "success",
      title: before === "PRESENT" ? "Already present" : "Completed",
      body: `${resolved.name} is marked present for ${new Date(date).toLocaleDateString("en-IN")}.`,
    });
    setScanCode("");
    toast.show(`${resolved.name} marked present.`);
  }

  useEffect(() => {
    if (!scanOpen || Platform.OS !== "web") return;
    setScanHit("");
    setScanStatus("");
    setScanResult({ tone: "idle", title: "Ready to scan", body: "Point the camera at a student ID QR." });
    let stopped = false;
    let frame = 0;
    async function startCameraScan() {
      const nav = typeof navigator !== "undefined" ? navigator : null;
      const barcodeDetectorClass = typeof window !== "undefined" ? (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: unknown) => Promise<{ rawValue?: string }[]> } }).BarcodeDetector : undefined;
      if (!nav?.mediaDevices?.getUserMedia || !barcodeDetectorClass) {
        setScanStatus("Camera QR scan is not available in this browser. Paste the card code below.");
        setScanResult({ tone: "warn", title: "Camera scanner unavailable", body: "Paste the card code below or use a supported browser." });
        return;
      }
      try {
        setScanStatus("Opening camera...");
        setScanResult({ tone: "idle", title: "Opening camera", body: "Allow camera permission when the browser asks." });
        const stream = await nav.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        scanStreamRef.current = stream;
        const video = scanVideoRef.current as { srcObject?: MediaStream; play?: () => Promise<void>; readyState?: number } | null;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play?.();
        const detector = new barcodeDetectorClass({ formats: ["qr_code"] });
        setScanStatus("Point camera at the ID card QR.");
        setScanResult({ tone: "idle", title: "Scanning", body: "Hold the ID card inside the square." });
        const tick = async () => {
          if (stopped || !scanOpen) return;
          const liveVideo = scanVideoRef.current as { readyState?: number } | null;
          if (liveVideo?.readyState && liveVideo.readyState >= 2 && !scanBusyRef.current) {
            scanBusyRef.current = true;
            try {
              const hits = await detector.detect(liveVideo);
              const code = hits[0]?.rawValue || "";
              if (code) {
                void applyScan(code);
                return;
              }
            } catch {
              setScanStatus("Could not read the QR yet. Hold the card steady.");
              setScanResult({ tone: "warn", title: "Still scanning", body: "QR is not clear yet. Hold the card steady inside the square." });
            } finally {
              scanBusyRef.current = false;
            }
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch {
        setScanStatus("Camera permission was blocked. Allow camera access or paste the card code.");
        setScanResult({ tone: "danger", title: "Camera blocked", body: "Allow camera access in Chrome, then reopen Scan ID card." });
      }
    }
    void startCameraScan();
    return () => {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      scanStreamRef.current?.getTracks().forEach((track) => track.stop());
      scanStreamRef.current = null;
      scanBusyRef.current = false;
    };
  }, [scanOpen, roster, locked, lockedNote, date]);

  const yes = roster.filter((s) => statusOf(s).toUpperCase() === "PRESENT").length;
  const late = roster.filter((s) => statusOf(s).toUpperCase() === "LATE").length;
  const no = roster.filter((s) => statusOf(s).toUpperCase() === "ABSENT").length;
  const onLeave = roster.filter((s) => statusOf(s).toUpperCase() === "LEAVE").length;
  const needle = q.trim().toLowerCase();
  // Roll order, the way a class teacher calls the register.
  const ordered = [...roster].sort((a, b) => (a.rollNumber ?? 9999) - (b.rollNumber ?? 9999) || a.name.localeCompare(b.name));
  const shown = needle
    ? ordered.filter((s) => s.name.toLowerCase().includes(needle) || String(s.rollNumber ?? "") === needle)
    : ordered;
  const marked = roster.length - onLeave;
  const pctToday = marked > 0 ? Math.round(((yes + late) / marked) * 100) : null;
  const dirty = Object.keys(marks).length > 0;
  const savedForDate = date === today ? Boolean(data?.markedToday) : roster.some((s) => s.days?.some((d) => d.date === date));
  const [searchOpen, setSearchOpen] = useState(false);

  // The 3 school days before the selected date, oldest first (per-student history on phone).
  const historyDays = (() => {
    const days: string[] = [];
    let cursor = date;
    for (let i = 0; i < 30 && days.length < 3; i += 1) {
      cursor = addDays(cursor, -1);
      if (!closedReason(cursor, calendar)) days.push(cursor);
    }
    return days.reverse();
  })();

  /** ‹ › : previous / next school day (skips holidays and weekends), never past today. */
  function stepDay(direction: -1 | 1) {
    let next = date;
    for (let i = 0; i < 21; i += 1) {
      next = addDays(next, direction);
      if (direction > 0 && next > today) return;
      if (!closedReason(next, calendar)) {
        setDate(next);
        setMarks({});
        return;
      }
    }
  }

  function markAllPresent() {
    if (locked) return;
    const next: Record<string, string> = {};
    for (const student of roster) if (statusOf(student).toUpperCase() !== "LEAVE") next[student.id] = "PRESENT";
    setMarks(next);
    toast.show("Everyone marked present. Change the few who are absent, then save.");
  }

  return (
    <View className="min-h-0 flex-1">
      {monthly && roster.length ? (
        <TeacherMonthlyRegister
          classLabel={data?.classLabel || ""}
          roster={roster}
          people={data?.people}
          calendar={calendar}
          token={token}
          onBack={() => setMonthly(false)}
          onSaved={async () => {
            await reload();
          }}
        />
      ) : (
        <>
      {phone ? (
        <View className="mb-2 flex-row items-center justify-between gap-3 px-1">
          <Text className="min-w-0 flex-1 text-lg font-bold text-ink-900" numberOfLines={1}>
            Attendance
            <Text className="text-sm font-normal text-ink-700">{`  ${data?.classLabel ? `${data.classLabel} · ` : ""}${roster.length} students`}</Text>
          </Text>
          {roster.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Monthly attendance"
              onPress={() => setMonthly(true)}
              className="h-8 flex-row items-center gap-1.5 rounded-full bg-[#EEF3FF] px-3"
            >
              <Ionicons name="calendar-outline" size={14} color="#1F45C7" />
              <Text className="text-xs font-semibold text-[#1F45C7]">Month</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
      <View className="mb-3 flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <PageHeader
            kicker="Class teacher"
            title="Attendance"
            lede={data?.classLabel ? `Mark P, A or late · ${data.classLabel}.` : "Mark P, A or late."}
          />
        </View>
        {roster.length ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View Monthly Attendance"
            onPress={() => setMonthly(true)}
            className="mt-1 h-10 flex-row items-center gap-2 rounded-md border border-ink-200 bg-white px-3"
          >
            <Ionicons name="calendar-outline" size={16} color="#2855F6" />
            <Text className="text-sm font-medium text-ink-900">View Monthly Attendance</Text>
          </Pressable>
        ) : null}
      </View>
      )}
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <LeaveDecideList
        rows={data?.pendingLeave ?? []}
        token={token}
        onDone={async (ok) => {
          toast.show(ok);
          await reload();
        }}
        onError={(msg) => toast.show(msg)}
      />
      {!roster.length ? (
        <Empty title="No class teacher section" body="When you are class teacher, the register is here." />
      ) : (
        <Card className={`min-h-0 flex-1 ${phone ? "rounded-3xl border-0" : ""}`}>
          {phone ? (
            <View className="gap-2.5 border-b border-ink-100 px-3 pb-3 pt-3">
              <View className="flex-row items-center gap-1.5">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous school day"
                  onPress={() => stepDay(-1)}
                  className="h-11 w-10 items-center justify-center rounded-xl bg-ink-50 active:opacity-70"
                >
                  <Ionicons name="chevron-back" size={20} color="#1F45C7" />
                </Pressable>
                <View className="min-w-0 flex-1 items-center">
                  <DateField
                    plain
                    bare
                    value={date}
                    max={today}
                    closedReason={(value) => closedReason(value, calendar)}
                    onChange={(next) => {
                      setDate(next);
                      setMarks({});
                    }}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next school day"
                  disabled={date >= today}
                  onPress={() => stepDay(1)}
                  className={`h-11 w-10 items-center justify-center rounded-xl bg-ink-50 active:opacity-70 ${date >= today ? "opacity-40" : ""}`}
                >
                  <Ionicons name="chevron-forward" size={20} color="#1F45C7" />
                </Pressable>
                {pctToday !== null && !locked ? <Text className="ml-1 text-xl font-bold text-ink-900">{pctToday}%</Text> : null}
              </View>
              <View className="flex-row items-center gap-2">
                {locked ? (
                  <Text className="min-w-0 flex-1 text-sm text-amber-800" numberOfLines={2}>{lockedNote.replace(/\.$/, "")}.</Text>
                ) : (
                  <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-x-3 gap-y-0.5">
                    {[
                      { n: yes, label: "P", dot: "#10B981" },
                      { n: late, label: "L", dot: "#F59E0B" },
                      { n: no, label: "A", dot: "#EF4444" },
                      ...(onLeave ? [{ n: onLeave, label: "leave", dot: "#6366F1" }] : []),
                    ].map((row) => (
                      <View key={row.label} className="flex-row items-center gap-1">
                        <View className="h-2 w-2 rounded-full" style={{ backgroundColor: row.dot }} />
                        <Text className="text-sm text-ink-800">
                          <Text className="font-semibold text-ink-900">{row.n}</Text> {row.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mark all present"
                  disabled={locked}
                  onPress={markAllPresent}
                  className={`h-9 flex-row items-center gap-1 rounded-xl bg-emerald-50 px-2.5 ${locked ? "opacity-50" : ""}`}
                >
                  <Ionicons name="checkmark-done" size={16} color="#047857" />
                  <Text className="text-xs font-semibold text-emerald-800">All P</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Search"
                  onPress={() => {
                    setSearchOpen((open) => !open);
                    if (searchOpen) setQ("");
                  }}
                  className={`h-9 w-9 items-center justify-center rounded-xl ${searchOpen ? "bg-[#1F45C7]" : "bg-[#EEF3FF]"}`}
                >
                  <Ionicons name="search" size={16} color={searchOpen ? "#FFFFFF" : "#1F45C7"} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Scan ID card"
                  disabled={locked}
                  onPress={() => setScanOpen(true)}
                  className={`h-9 w-9 items-center justify-center rounded-xl bg-[#EEF3FF] ${locked ? "opacity-50" : ""}`}
                >
                  <Ionicons name="qr-code-outline" size={16} color="#1F45C7" />
                </Pressable>
              </View>
              {searchOpen ? (
                <View className="h-11 flex-row items-center gap-2 rounded-xl bg-ink-50 px-3">
                  <Ionicons name="search" size={16} color="#94A3B8" />
                  <Input
                    value={q}
                    onChangeText={setQ}
                    placeholder="Name or roll number"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    className="min-w-0 flex-1 border-0 bg-transparent"
                  />
                </View>
              ) : null}
            </View>
          ) : (
          <View className="gap-3 border-b border-ink-100 px-4 py-4">
            <View className="flex-row items-start gap-2">
              <View className="min-w-0 flex-1">
                <Field label="Search">
                  <View className="flex-row items-center rounded-md border border-ink-200 bg-white pl-2.5">
                    <Ionicons name="search-outline" size={18} color="#3d4f66" />
                    <Input
                      value={q}
                      onChangeText={setQ}
                      placeholder="Name"
                      autoCapitalize="none"
                      autoCorrect={false}
                      className="min-w-0 flex-1 border-0"
                    />
                  </View>
                </Field>
              </View>
              <View className="shrink-0 pt-6">
                <Button variant="ghost" disabled={locked} onPress={() => setScanOpen(true)}>
                  Scan ID card
                </Button>
              </View>
              <View className={`shrink-0 ${phone ? "w-[158px]" : "w-[220px]"}`}>
                <Field label="Date">
                  <DateField
                    plain
                    value={date}
                    max={today}
                    closedReason={(value) => closedReason(value, calendar)}
                    onChange={(next) => {
                      setDate(next);
                      setMarks({});
                    }}
                  />
                </Field>
              </View>
            </View>
            {locked ? (
              <Text className="text-sm text-amber-800">
                {lockedNote.replace(/\.$/, "")}.
              </Text>
            ) : (
              <View className="flex-row flex-wrap gap-2">
                <Badge tone="leaf">{`${yes} P`}</Badge>
                {late ? <Badge tone="warn">{`${late} late`}</Badge> : null}
                <Badge tone="danger">{`${no} A`}</Badge>
                {onLeave ? <Badge tone="sky">{`${onLeave} on leave`}</Badge> : null}
                {needle ? <Badge>{`${shown.length} shown`}</Badge> : null}
              </View>
            )}
          </View>
          )}
          <ScrollView className="min-h-0 flex-1" keyboardShouldPersistTaps="handled">
            {!shown.length ? (
              <View className="px-4 py-8">
                <Empty title="No match" body="Clear search to see the full register." />
              </View>
            ) : (
              shown.map((s) => {
                const st = statusOf(s).toUpperCase();
                const dots = lastAttendanceDots(s.days ?? [], date, locked ? undefined : st, 7, calendar);
                const mark =
                  st === "LEAVE" ? (
                    <OnLeaveSign />
                  ) : (
                    <DayMark
                      name={s.name}
                      status={st}
                      disabled={locked}
                      onChange={(next) => setMarks((m) => ({ ...m, [s.id]: next }))}
                    />
                  );
                return phone ? (
                  <View key={s.id} className="flex-row items-center gap-3 border-t border-ink-100 px-4 py-2.5">
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-[#EEF3FF]">
                      <Text className="text-[13px] font-bold text-[#1F45C7]">{s.rollNumber ?? "–"}</Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[15px] font-medium text-ink-900" numberOfLines={1}>
                        {s.name}
                      </Text>
                      <View className="mt-1 flex-row items-center gap-1" accessibilityLabel="Last 3 school days">
                        {historyDays.map((day) => {
                          const hit = s.days?.find((row) => row.date === day);
                          const letter = hit ? attendanceLetter(hit.status) : "";
                          const color = letter === "P" ? "#10B981" : letter === "A" ? "#EF4444" : letter === "L" ? "#F59E0B" : "#D5DEEA";
                          return <View key={day} className="h-1.5 w-4 rounded-full" style={{ backgroundColor: color }} />;
                        })}
                      </View>
                    </View>
                    {mark}
                  </View>
                ) : (
                  <View key={s.id} className="flex-row items-center gap-4 border-t border-ink-100 px-4 py-3">
                    <Text className="w-44 shrink-0 text-sm font-medium text-ink-900" numberOfLines={1}>
                      {s.name}
                    </Text>
                    <AttendanceDots dots={dots} activeDate={locked ? undefined : date} />
                    <View className="ml-auto">{mark}</View>
                  </View>
                );
              })
            )}
          </ScrollView>
          <View className="border-t border-ink-100 bg-white p-4">
            <Button onPress={save} disabled={locked}>
              {locked
                ? "Attendance closed"
                : dirty
                  ? `Save attendance · ${roster.length} students`
                  : savedForDate
                    ? "✓ Saved · tap to save again"
                    : `Save attendance · ${roster.length} students`}
            </Button>
          </View>
          <Modal
            open={scanOpen}
            title="Scan ID card"
            onClose={() => setScanOpen(false)}
            footer={
              <View className="flex-row justify-end gap-2">
                <Button variant="ghost" onPress={() => setScanOpen(false)}>
                  Close
                </Button>
                <Button onPress={() => void applyScan(scanCode)}>
                  Mark present
                </Button>
              </View>
            }
          >
            <View className="gap-4">
              <View className="overflow-hidden rounded-md border border-blue-200 bg-ink-900">
                {Platform.OS === "web" ? (
                  <View className="relative h-72">
                    {createElement("video", {
                      ref: scanVideoRef,
                      muted: true,
                      playsInline: true,
                      style: {
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        background: "#0f172a",
                      },
                    })}
                    <View className="absolute inset-0 items-center justify-center">
                      <View className="h-40 w-40 rounded-lg border-4 border-white/90 bg-transparent" />
                    </View>
                    <View className="absolute inset-x-0 bottom-0 bg-ink-900/80 px-4 py-3">
                      <Text className="text-center text-sm font-semibold text-white">Point camera at the ID card QR</Text>
                      <Text className="mt-1 text-center text-xs text-white/80">
                        {scanStatus || `Marks present for ${new Date(date).toLocaleDateString("en-IN")}`}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <View className="items-center bg-blue-50 p-6">
                    <Ionicons name="camera-outline" size={46} color="#1d4ed8" />
                    <Text className="mt-3 text-center text-sm font-semibold text-ink-900">Camera scanner needs the mobile camera module</Text>
                    <Text className="mt-1 text-center text-xs leading-5 text-ink-700">Paste or scan the card code below for now.</Text>
                  </View>
                )}
              </View>
              <View
                className={`rounded-md border p-3 ${
                  scanResult.tone === "success"
                    ? "border-green-200 bg-green-50"
                    : scanResult.tone === "danger"
                      ? "border-red-200 bg-red-50"
                      : scanResult.tone === "warn"
                        ? "border-amber-200 bg-amber-50"
                        : "border-ink-200 bg-ink-50"
                }`}
              >
                <View className="flex-row items-start gap-2">
                  <Ionicons
                    name={
                      scanResult.tone === "success"
                        ? "checkmark-circle"
                        : scanResult.tone === "danger"
                          ? "close-circle"
                          : scanResult.tone === "warn"
                            ? "alert-circle"
                            : "scan-outline"
                    }
                    size={18}
                    color={
                      scanResult.tone === "success"
                        ? "#166534"
                        : scanResult.tone === "danger"
                          ? "#b91c1c"
                          : scanResult.tone === "warn"
                            ? "#92400e"
                            : "#3d4f66"
                    }
                  />
                  <View className="min-w-0 flex-1">
                    <Text
                      className={`text-sm font-semibold ${
                        scanResult.tone === "success"
                          ? "text-green-900"
                          : scanResult.tone === "danger"
                            ? "text-red-900"
                            : scanResult.tone === "warn"
                              ? "text-amber-900"
                              : "text-ink-900"
                      }`}
                    >
                      {scanResult.title}
                    </Text>
                    <Text
                      className={`mt-1 text-xs leading-5 ${
                        scanResult.tone === "success"
                          ? "text-green-800"
                          : scanResult.tone === "danger"
                            ? "text-red-800"
                            : scanResult.tone === "warn"
                              ? "text-amber-800"
                              : "text-ink-700"
                      }`}
                    >
                      {scanResult.body}
                    </Text>
                  </View>
                </View>
              </View>
              <Field label="Card code">
                <Input
                  value={scanCode}
                  onChangeText={setScanCode}
                  placeholder="Scan or paste admission/card code"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onSubmitEditing={() => void applyScan(scanCode)}
                />
              </Field>
              {scanHit ? (
                <View className="rounded-md border border-green-200 bg-green-50 p-3">
                  <Text className="text-sm font-medium text-green-900">{scanHit} marked present</Text>
                  <Text className="mt-1 text-xs text-green-800">Save the day to confirm the register.</Text>
                </View>
              ) : null}
            </View>
          </Modal>
        </Card>
      )}
        </>
      )}
    </View>
  );
}

export { TeacherExamsBoard } from "./teacher-exams-workspace";


function jsToWeekday(jsDay: number) {
  return jsDay === 0 ? 7 : jsDay;
}

function hmToMin(value?: string) {
  const [h, m] = (value || "").split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  return h * 60 + (m || 0);
}

function todaySlots(data: RecordPayload) {
  const table = data.timetable;
  if (!table) {
    return {
      label: "",
      periods: [] as {
        period: string;
        start: string;
        end: string;
        subject: string;
        teacher: string;
        room: string;
        classLabel: string;
      }[],
    };
  }
  const n = jsToWeekday(new Date().getDay());
  const label = table.weekdays?.find((d) => d.n === n)?.label || "";
  const periods = (table.slots ?? [])
    .filter((s) => s.weekday === n && s.subject && s.subject !== "—")
    .map((s) => {
      const p = (table.periods ?? []).find((x) => x.id === s.periodId || x.name === s.period);
      return {
        period: s.period,
        start: p?.start || "",
        end: p?.end || "",
        subject: s.subject,
        teacher: s.teacher,
        room: s.room,
        classLabel: s.classLabel || "",
      };
    })
    .sort((a, b) => (hmToMin(a.start) ?? 0) - (hmToMin(b.start) ?? 0));
  return { label, periods };
}

function nextScheduledPeriod(data: RecordPayload) {
  const table = data.timetable;
  if (!table) return null;
  const today = ymd(new Date());
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  for (let offset = 0; offset <= 14; offset += 1) {
    const date = addDays(today, offset);
    const weekday = jsToWeekday(new Date(`${date}T00:00:00`).getDay());
    const dayLabel = offset === 0
      ? "Today"
      : new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    const periods = (table.slots ?? [])
      .filter((s) => s.weekday === weekday && s.subject && s.subject !== "—")
      .map((s) => {
        const p = (table.periods ?? []).find((x) => x.id === s.periodId || x.name === s.period);
        return {
          period: s.period,
          start: p?.start || "",
          end: p?.end || "",
          subject: s.subject,
          teacher: s.teacher,
          room: s.room,
          classLabel: s.classLabel || "",
          dayLabel,
        };
      })
      .sort((a, b) => (hmToMin(a.start) ?? 0) - (hmToMin(b.start) ?? 0));
    const hit = periods.find((period) => {
      if (offset > 0) return true;
      const end = hmToMin(period.end) ?? hmToMin(period.start);
      return end == null || end > nowMins;
    });
    if (hit) return hit;
  }
  return null;
}

function nextPeriod(periods: ReturnType<typeof todaySlots>["periods"]) {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  return (
    periods.find((p) => {
      const end = hmToMin(p.end) ?? hmToMin(p.start);
      return end == null || end > mins;
    }) || null
  );
}

function remainingPeriods(periods: ReturnType<typeof todaySlots>["periods"], next: ReturnType<typeof nextPeriod>) {
  if (!next) return [];
  const i = periods.indexOf(next);
  if (i < 0) return [];
  return periods.slice(i + 1, i + 4);
}

function periodPhase(period: { start: string; end: string }, nowMins = new Date().getHours() * 60 + new Date().getMinutes()) {
  const start = hmToMin(period.start);
  const end = hmToMin(period.end) ?? (start != null ? start + 40 : null);
  if (end != null && nowMins >= end) return "done" as const;
  if (start != null && nowMins >= start && (end == null || nowMins < end)) return "now" as const;
  if (start == null && end != null && nowMins < end) return "now" as const;
  return "next" as const;
}

function InProgressDot() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 900, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{
        opacity,
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: "#2855F6",
        marginRight: 5,
      }}
    />
  );
}

export function FamilyHomeBoard() {
  const { data, reload } = useRecord();
  const { token } = useSession();
  const router = useRouter();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const twoCol = width >= 900;
  const child = data?.child;
  const [queryMode, setQueryMode] = useState<"teacher" | "office" | null>(null);
  const [querySubject, setQuerySubject] = useState("");

  function openParentQuery(mode: "teacher" | "office", opts?: { subject?: string }) {
    setQuerySubject(opts?.subject || "");
    setQueryMode(mode);
  }

  if (data?.kind === "STUDENT") {
    const attRows = child?.attendance ?? [];
    const att = attendanceSummary(attRows);
    const today = todayMark(attRows);
    const todayLabel = todayMarkLabel(today);
    const cbse = attendanceCbseNote(att);
    const papers = child?.tests.length
      ? Math.round(child.tests.reduce((n, t) => n + t.pct, 0) / child.tests.length)
      : 0;
    const lastDay = attRows[0];
    const unpaid = (child?.fees ?? []).filter((f) => f.display !== "paid" && f.remaining && f.remaining !== "₹0");
    const day = todaySlots(data);
    const next = nextPeriod(day.periods);
    const rest = remainingPeriods(day.periods, next);
    const notices = data.notices ?? [];
    const coming = (data.upcoming ?? []).slice(0, 3);
    const subjects = child?.subjects ?? [];
    const strongest = subjects[0] ?? null;
    const weakest = subjects.length > 1 ? subjects[subjects.length - 1] : null;
    const latest = child?.tests[0] ?? null;
    const first = (child?.name || "").split(" ")[0] || "there";
    return (
      <View>
        <Text className="mb-3 text-sm text-ink-700">Hi {first}</Text>

        <Pressable className="mb-4" onPress={() => router.push("/timetable")}>
          <Card className="p-4">
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">
              Today{day.label ? ` · ${day.label}` : ""}
            </Text>
            {next ? (
              <>
                <Text className="mt-1 text-2xl font-semibold text-ink-900">{next.subject}</Text>
                <Text className="mt-1 text-sm text-ink-700">
                  {next.period}
                  {next.start ? ` · ${next.start}${next.end ? `–${next.end}` : ""}` : ""}
                  {[next.teacher, next.room].filter(Boolean).length
                    ? ` · ${[next.teacher, next.room].filter(Boolean).join(" · ")}`
                    : ""}
                </Text>
                {rest.length ? (
                  <View className="mt-3 gap-1">
                    <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Rest of the day</Text>
                    {rest.map((p) => (
                      <Text key={`${p.period}-${p.subject}`} className="text-sm text-ink-700">
                        {p.subject}
                        {p.start ? ` · ${p.start}${p.end ? `–${p.end}` : ""}` : p.period ? ` · ${p.period}` : ""}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </>
            ) : day.periods.length ? (
              <>
                <Text className="mt-1 text-2xl font-semibold text-ink-900">Done for today</Text>
                <Text className="mt-1 text-sm text-ink-700">Open Timetable for the week.</Text>
              </>
            ) : (
              <>
                <Text className="mt-1 text-2xl font-semibold text-ink-900">No class now</Text>
                <Text className="mt-1 text-sm text-ink-700">When the week is filled, today’s periods show here.</Text>
              </>
            )}
          </Card>
        </Pressable>

        <Card className="mb-4">
          <View className="flex-row items-center justify-between border-b border-ink-100 px-4 py-3">
            <Text className="text-sm font-medium text-ink-900">For you</Text>
            <Pressable onPress={() => router.push("/notices")}>
              <Text className="text-sm text-clay-600">Notices</Text>
            </Pressable>
          </View>
          {notices.length ? (
            notices.map((n) => (
              <Pressable key={n.id} onPress={() => router.push("/notices")} className="border-t border-ink-100 px-4 py-3">
                <Text className="text-sm font-medium text-ink-900">{n.title}</Text>
                <Text className="mt-0.5 text-xs text-ink-700">
                  {n.createdAt}
                  {n.author ? ` · ${n.author}` : ""}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text className="px-4 py-4 text-sm text-ink-700">No circulars for your class yet.</Text>
          )}
        </Card>

        <Pressable className="mb-4" onPress={() => router.push("/attendance")}>
          <Card className="p-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Attendance</Text>
              {todayLabel ? (
                <Badge
                  tone={today === "out" ? "warn" : today === "late" ? "clay" : today === "leave" ? "sky" : "leaf"}
                >
                  {todayLabel}
                </Badge>
              ) : null}
            </View>
            <Text className="mt-1 text-2xl font-semibold text-ink-900">{att.pct}%</Text>
            <Text className="mt-1 text-sm text-ink-700">{attendanceCountLine(att)}</Text>
            <Text className="mt-1 text-xs text-ink-700">{attendanceHint(att, lastDay?.date)}</Text>
            {cbse ? <Text className="mt-1 text-xs text-amber-800">{cbse}</Text> : null}
          </Card>
        </Pressable>

        <View className="mb-4 flex-row flex-wrap gap-3">
          <Pressable className="min-w-0 flex-1" onPress={() => router.push("/tests")}>
            <Stat label="Papers" value={papers ? `${papers}%` : "—"} hint="Context, not the goal." />
          </Pressable>
          {unpaid.length ? (
            <Pressable className="min-w-0 flex-1" onPress={() => router.push("/fees")}>
              <Stat label="Due" value={unpaid[0].remaining} hint="Clear older dues first — pay all on Fees." />
            </Pressable>
          ) : null}
        </View>

        {data.reports?.[0] ? (
          <Pressable className="mb-4" onPress={() => router.push("/tests")}>
            <Card className="p-4">
              <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Marksheet</Text>
              <Text className="mt-1 text-2xl font-semibold text-ink-900">{data.reports[0].seriesName}</Text>
              <Text className="mt-1 text-sm text-ink-700">
                Download whenever you want · {data.reports[0].sessionLabel}
              </Text>
            </Card>
          </Pressable>
        ) : null}

        <Card className="mb-4">
          <View className="flex-row items-center justify-between border-b border-ink-100 px-4 py-3">
            <Text className="text-sm font-medium text-ink-900">Coming up</Text>
            <Pressable onPress={() => router.push("/tests")}>
              <Text className="text-sm text-clay-600">Tests</Text>
            </Pressable>
          </View>
          {coming.length ? (
            coming.map((e) => (
              <View key={e.id} className="border-t border-ink-100 px-4 py-3">
                <Text className="text-sm font-medium text-ink-900">{e.title}</Text>
                <Text className="mt-0.5 text-xs text-ink-700">
                  {e.date} · {e.subject}
                  {e.teacher ? ` · ${e.teacher}` : ""}
                </Text>
              </View>
            ))
          ) : (
            <Text className="px-4 py-4 text-sm text-ink-700">No upcoming tests on the calendar yet.</Text>
          )}
        </Card>

        {latest ? (
          <Pressable className="mb-4" onPress={() => router.push("/tests")}>
            <Card className="p-4">
              <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Latest paper</Text>
              <Text className="mt-1 text-2xl font-semibold text-ink-900">{latest.subject}</Text>
              <Text className="mt-1 text-sm text-ink-700">
                {latest.marks}/{latest.max} · {latest.pct}%
                {latest.title ? ` · ${latest.title}` : ""}
              </Text>
            </Card>
          </Pressable>
        ) : null}

        {child?.letter.lines[0] ? (
          <Text className="mb-4 text-xl font-semibold leading-6 text-ink-900">{child.letter.lines[0]}</Text>
        ) : null}

        {strongest ? (
          <View>
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-sm font-medium text-ink-900">Courses</Text>
              <Pressable onPress={() => router.push("/subjects")}>
                <Text className="text-sm text-clay-600">All courses</Text>
              </Pressable>
            </View>
            <View className="flex-row flex-wrap gap-3">
              <View className="min-w-0 flex-1">
                <Card className="p-4">
                  <Text className="text-xs uppercase tracking-wide text-ink-700">Strongest</Text>
                  <Text className="mt-1 text-2xl font-semibold text-ink-900">
                    {strongest.n ? `${strongest.pct}%` : "—"}
                  </Text>
                  <Text className="mt-1 text-sm text-ink-700">{strongest.name}</Text>
                </Card>
              </View>
              {weakest && weakest.name !== strongest.name ? (
                <View className="min-w-0 flex-1">
                  <Card className="p-4">
                    <Text className="text-xs uppercase tracking-wide text-ink-700">Needs work</Text>
                    <Text className="mt-1 text-2xl font-semibold text-ink-900">
                      {weakest.n ? `${weakest.pct}%` : "—"}
                    </Text>
                    <Text className="mt-1 text-sm text-ink-700">{weakest.name}</Text>
                  </Card>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>
    );
  }
  return (
    <View>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <ParentPhoneHome wide={width >= 768} onMessage={() => openParentQuery("office")} />
      <NewConversationSheet
        open={Boolean(queryMode)}
        onClose={() => setQueryMode(null)}
        studentId={child?.id}
        studentName={child?.name}
        initialTarget={queryMode === "teacher" ? "CLASS_TEACHER" : "OFFICE"}
        initialSubject={querySubject}
        onSent={(id) => {
          toast.show("Message sent.");
          router.push(`/inbox?thread=${encodeURIComponent(id)}`);
        }}
      />
    </View>
  );
}

type ParentDayKind = "present" | "absent" | "late" | "wo" | "holiday" | "pl" | "nm" | "upcoming";

const PARENT_DAY_STYLE: Record<ParentDayKind, { cell: string; text: string; badge: string; label: string }> = {
  present: { cell: "bg-[#ECF8F0] border-[#B7E4C7]", text: "text-[#18794E]", badge: "P", label: "Present" },
  absent: { cell: "bg-[#FDECEC] border-[#F0B4B4]", text: "text-[#B42318]", badge: "A", label: "Absent" },
  late: { cell: "bg-[#FFF7E8] border-[#F0D19A]", text: "text-[#B45309]", badge: "L", label: "Late" },
  wo: { cell: "bg-[#F3F4F6] border-[#E5E7EB]", text: "text-[#6B7280]", badge: "WO", label: "Weekly off" },
  holiday: { cell: "bg-[#F5F0FB] border-[#D8C9F0]", text: "text-[#6D28D9]", badge: "H", label: "Holiday" },
  pl: { cell: "bg-[#EEF4FF] border-[#C7D7FE]", text: "text-[#1D4ED8]", badge: "PL", label: "Planned leave" },
  nm: { cell: "bg-[#F7F8FA] border-[#E6EAF0]", text: "text-[#64748B]", badge: "NM", label: "Not marked" },
  upcoming: { cell: "bg-white border-[#E6EAF0]", text: "text-[#94A3B8]", badge: "", label: "Upcoming" },
};

const PARENT_DAY_DOT: Record<ParentDayKind, string> = {
  present: "#2BB673",
  absent: "#E5484D",
  late: "#F59E0B",
  wo: "#CBD5E1",
  holiday: "#8B5CF6",
  pl: "#3B82F6",
  nm: "#E2E8F0",
  upcoming: "transparent",
};

function parentDayKind(opts: {
  key: string;
  status: string;
  calendar: SchoolCalendar;
  planned: Set<string>;
  todayKey: string;
}): ParentDayKind {
  const kind = opts.status.trim().toLowerCase();
  if (kind === "present" || kind === "in") return "present";
  if (kind === "absent" || kind === "out") return "absent";
  if (kind === "late") return "late";
  if (kind === "leave") return "pl";
  const closed = closedReason(opts.key, opts.calendar);
  if (closed && !/\soff$/i.test(closed)) return "holiday";
  if (closed) return "wo";
  if (opts.planned.has(opts.key)) return "pl";
  if (opts.key > opts.todayKey) return "upcoming";
  return "nm";
}

function ParentAttendanceCalendar({
  activeMonth,
  calendar,
  childClass,
  marks,
  plannedLeaveDates,
  onMonth,
  shiftMonth,
  monthLabel,
}: {
  activeMonth: string;
  calendar: SchoolCalendar;
  childClass: string;
  marks: Map<string, string>;
  plannedLeaveDates: Set<string>;
  onMonth: (month: string) => void;
  shiftMonth: (month: string, delta: number) => string;
  monthLabel: (month: string) => string;
}) {
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const [mode, setMode] = useState<"calendar" | "list">("calendar");
  const [picked, setPicked] = useState<string | null>(null);
  const todayKey = ymd(new Date());
  const [year, monthNo] = activeMonth.split("-").map(Number);
  const month = monthNo - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const kind = parentDayKind({
      key,
      status: marks.get(key) || "",
      calendar,
      planned: plannedLeaveDates,
      todayKey,
    });
    return { key, day, kind, today: key === todayKey };
  });
  const blanks = Array.from({ length: leading }, (_, index) => ({ key: `blank-${index}` }));
  const counts = {
    present: days.filter((d) => d.kind === "present").length,
    absent: days.filter((d) => d.kind === "absent").length,
    late: days.filter((d) => d.kind === "late").length,
    wo: days.filter((d) => d.kind === "wo").length,
    holiday: days.filter((d) => d.kind === "holiday").length,
    pl: days.filter((d) => d.kind === "pl").length,
    nm: days.filter((d) => d.kind === "nm").length,
  };
  const pickedDay = days.find((d) => d.key === picked) || null;
  const closedNote = pickedDay ? closedReason(pickedDay.key, calendar) : "";

  function DayCell({ day, kind, today, onPress }: { day: number; kind: ParentDayKind; today: boolean; onPress: () => void }) {
    const style = PARENT_DAY_STYLE[kind];
    if (compact) {
      const isPicked = picked === days.find((d) => d.day === day)?.key;
      const muted = kind === "wo" || kind === "upcoming" || kind === "nm";
      return (
        <Pressable accessibilityRole="button" accessibilityLabel={`${day} ${style.label}`} onPress={onPress} className="h-[46px] items-center justify-center">
          <View
            className={`h-8 w-8 items-center justify-center rounded-full ${isPicked ? "bg-[#1F45C7]" : today ? "border-2 border-[#1F45C7]" : ""}`}
          >
            <Text className={`text-[14px] ${isPicked ? "font-semibold text-white" : muted ? "text-ink-400" : "font-semibold text-ink-900"}`}>{day}</Text>
          </View>
          <View className="mt-0.5 h-[5px] w-[5px] rounded-full" style={{ backgroundColor: PARENT_DAY_DOT[kind] }} />
        </Pressable>
      );
    }
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${day} ${style.label}`}
        onPress={onPress}
        className={`h-[46px] items-center justify-center rounded-lg border ${style.cell} ${today ? "border-clay-500" : ""}`}
      >
        <Text className="text-[13px] font-semibold leading-4 text-ink-900">{day}</Text>
        {style.badge ? <Text className={`mt-0.5 text-[9px] font-semibold leading-3 ${style.text}`}>{style.badge}</Text> : null}
      </Pressable>
    );
  }

  return (
    <Card className="p-3">
      <View className="mb-3 flex-row flex-wrap items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <Pressable onPress={() => onMonth(shiftMonth(activeMonth, -1))} hitSlop={8} accessibilityLabel="Previous month">
            <Ionicons name="chevron-back" size={18} color="#2855F6" />
          </Pressable>
          <Text
            className={
              compact
                ? "min-w-[150px] text-center text-[16px] font-semibold text-ink-900"
                : "min-w-[128px] text-center text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-800"
            }
          >
            {monthLabel(activeMonth)}
          </Text>
          <Pressable onPress={() => onMonth(shiftMonth(activeMonth, 1))} hitSlop={8} accessibilityLabel="Next month">
            <Ionicons name="chevron-forward" size={18} color="#2855F6" />
          </Pressable>
          <Pressable
            onPress={() => onMonth(todayKey.slice(0, 7))}
            className="h-7 justify-center rounded-md border border-ink-200 bg-white px-2"
          >
            <Text className="text-[12px] font-medium text-ink-800">Today</Text>
          </Pressable>
        </View>
        {compact ? null : (
        <View className="flex-row overflow-hidden rounded-md border border-ink-200">
          {(["calendar", "list"] as const).map((id) => (
            <Pressable
              key={id}
              onPress={() => setMode(id)}
              className={`h-7 px-2.5 ${mode === id ? "bg-[#EEF2FF]" : "bg-white"}`}
            >
              <Text className={`text-[12px] font-medium leading-7 ${mode === id ? "text-clay-500" : "text-ink-700"}`}>
                {id === "calendar" ? "Calendar" : "List"}
              </Text>
            </Pressable>
          ))}
        </View>
        )}
      </View>

      {compact ? (
        <View className="mb-2 flex-row flex-wrap gap-x-3 gap-y-1.5">
          {(
            [
              ["present", counts.present],
              ["absent", counts.absent],
              ["late", counts.late],
              ["pl", counts.pl],
              ["holiday", counts.holiday],
              ["wo", counts.wo],
              ["nm", counts.nm],
            ] as [ParentDayKind, number][]
          )
            .filter(([, n]) => n > 0)
            .map(([k, n]) => (
              <View key={k} className="flex-row items-center gap-1.5">
                <View className="h-2 w-2 rounded-full" style={{ backgroundColor: PARENT_DAY_DOT[k] === "#E2E8F0" ? "#CBD5E1" : PARENT_DAY_DOT[k] }} />
                <Text className="text-[12px] text-ink-600">
                  <Text className="font-semibold text-ink-900">{n}</Text> {PARENT_DAY_STYLE[k].label}
                </Text>
              </View>
            ))}
        </View>
      ) : (
      <View className="mb-2.5 flex-row flex-wrap gap-x-3 gap-y-1">
        {(Object.keys(PARENT_DAY_STYLE) as ParentDayKind[])
          .filter((k) => k !== "upcoming")
          .map((k) => {
            const s = PARENT_DAY_STYLE[k];
            return (
              <View key={k} className="flex-row items-center gap-1">
                <View className={`h-2.5 w-2.5 rounded-sm border ${s.cell}`} />
                <Text className="text-[11px] text-ink-600">{s.badge ? `${s.badge} ${s.label}` : s.label}</Text>
              </View>
            );
          })}
      </View>
      )}

      {mode === "calendar" || compact ? (
        <>
          <View className="mb-1.5 flex-row">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <Text key={day} className="flex-1 text-center text-[11px] font-medium text-ink-500">
                {compact ? day.slice(0, 1) : day}
              </Text>
            ))}
          </View>
          <View className="flex-row flex-wrap">
            {blanks.map((cell) => (
              <View key={cell.key} className="w-[14.285%] p-[2px]">
                <View className="h-[46px]" />
              </View>
            ))}
            {days.map((cell) => (
              <View key={cell.key} className="w-[14.285%] p-[2px]">
                <DayCell day={cell.day} kind={cell.kind} today={cell.today} onPress={() => setPicked(cell.key)} />
              </View>
            ))}
          </View>
        </>
      ) : (
        <View>
          {days.map((cell) => {
            const s = PARENT_DAY_STYLE[cell.kind];
            return (
              <Pressable
                key={cell.key}
                onPress={() => setPicked(cell.key)}
                className={`mb-1 flex-row items-center justify-between rounded-lg border px-3 py-1.5 ${s.cell}`}
              >
                <Text className="text-[13px] font-semibold text-ink-900">
                  {cell.day} {monthLabel(activeMonth).split(" ")[0]}
                </Text>
                <Text className={`text-[12px] font-medium ${s.text}`}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {pickedDay ? (
        <View className={`mt-3 rounded-[10px] border px-3 py-2.5 ${PARENT_DAY_STYLE[pickedDay.kind].cell}`}>
          <Text className="text-[13px] font-semibold text-ink-900">
            {new Date(`${pickedDay.key}T00:00:00`).toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </Text>
          <Text className={`mt-0.5 text-[13px] ${PARENT_DAY_STYLE[pickedDay.kind].text}`}>
            {PARENT_DAY_STYLE[pickedDay.kind].label}
            {closedNote ? ` · ${closedCaption(closedNote)}` : ""}
            {childClass ? ` · Class ${childClass}` : ""}
          </Text>
        </View>
      ) : null}

      {compact ? null : (
      <View className="mt-3 flex-row flex-wrap gap-x-4 gap-y-1 border-t border-ink-100 pt-3">
        {(
          [
            ["Present", counts.present],
            ["Absent", counts.absent],
            ["Late", counts.late],
            ["Leave", counts.pl],
            ["Off / holiday", counts.wo + counts.holiday],
          ] as const
        ).map(([label, value]) => (
          <Text key={label} className="text-[12px] text-ink-600">
            <Text className="font-semibold text-ink-900">{value}</Text> {label}
          </Text>
        ))}
      </View>
      )}
    </Card>
  );
}

export function FamilyAttendance() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const toast = useToast();
  const child = data?.child;
  const rows = child?.attendance ?? [];
  const att = attendanceSummary(rows);
  const today = todayMark(rows);
  const todayLabel = todayMarkLabel(today);
  const cbse = attendanceCbseNote(att);
  const pending = (data?.pendingLeave ?? []).filter((r) => !child || r.subjectId === child.id);
  const { width: attWidth } = useWindowDimensions();
  const phone = attWidth < 768;
  const manyKids = (data?.children ?? []).length > 1;
  const attParams = useLocalSearchParams<{ leave?: string | string[] }>();
  const openLeave = (Array.isArray(attParams.leave) ? attParams.leave[0] : attParams.leave) === "1";
  const progressTone = att.pct >= 75 ? "bg-emerald-400" : att.pct >= 60 ? "bg-amber-400" : "bg-red-400";
  const attendanceMessage = att.pct >= 90
    ? "Excellent consistency"
    : att.pct >= 75
      ? "On track"
      : "Needs attention";
  const calendar = useMemo(
    () => calendarFrom(data?.calendar?.holidays, data?.calendar?.weekdays ?? data?.timetable?.weekdays),
    [data?.calendar, data?.timetable?.weekdays]
  );
  const plannedLeaveDates = useMemo(() => {
    const dates = new Set<string>();
    for (const leave of data?.myLeave ?? []) {
      if (leave.who !== "student" || leave.status === "REJECTED") continue;
      if (child?.id && leave.subjectId !== child.id) continue;
      let cursor = leave.from;
      for (let i = 0; cursor && cursor <= leave.to && i < 370; i += 1) {
        dates.add(cursor);
        cursor = addDays(cursor, 1);
      }
    }
    return dates;
  }, [child?.id, data?.myLeave]);
  const latestMonth = rows[0]?.rawDate?.slice(0, 7) || attendanceDateKey(rows[0]?.date || new Date()).slice(0, 7);
  const [calendarMonth, setCalendarMonth] = useState(latestMonth);
  const activeMonth = calendarMonth || latestMonth;

  useEffect(() => {
    setCalendarMonth(latestMonth);
  }, [latestMonth]);

  function attendanceDateKey(value: string | Date | undefined) {
    if (!value) return "";
    if (typeof value === "string") {
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return "";
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }
    if (Number.isNaN(value.getTime())) return "";
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }

  function monthLabel(monthKey: string) {
    const [year, month] = monthKey.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }

  function shiftMonth(monthKey: string, delta: number) {
    const [year, month] = monthKey.split("-").map(Number);
    const next = new Date(year, month - 1 + delta, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  }

  return (
    <View>
      {phone ? (
        <View className="mb-4">
          <View className="flex-row items-center gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-[22px] font-semibold leading-7 text-ink-900">Attendance</Text>
              <Text className="mt-0.5 text-[13px] text-ink-500" numberOfLines={1}>
                {child ? `${child.name} · ${child.classLabel}` : "Presence, punctuality, and leave."}
              </Text>
            </View>
            {user?.portal === "PARENT" ? (
              <LeaveApplyCard
                key={openLeave ? "leave-open" : "leave"}
                audience="student"
                token={token}
                onDone={async (ok) => { toast.show(ok); await reload(); }}
                onError={(msg) => toast.show(msg)}
                openByDefault={openLeave}
                triggerOnly
              />
            ) : null}
          </View>
          {manyKids ? (
            <View className="mt-3">
              <ChildSwitch fullWidth />
            </View>
          ) : null}
        </View>
      ) : (
      <View className="mb-4 flex-row flex-wrap items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-[22px] font-semibold leading-7 text-ink-900">Attendance</Text>
          <Text className="mt-0.5 text-[13px] text-ink-500">
            {child ? `${child.name.split(" ")[0]} · Class ${child.classLabel}` : "Presence, punctuality, and leave."}
          </Text>
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <ChildSwitch />
          {user?.portal === "PARENT" ? (
            <LeaveApplyCard
              audience="student"
              token={token}
              onDone={async (ok) => { toast.show(ok); await reload(); }}
              onError={(msg) => toast.show(msg)}
              triggerOnly
            />
          ) : null}
        </View>
      </View>
      )}
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {user?.portal === "PARENT" ? (
        <LeaveDecideList
          rows={pending}
          token={token}
          yesLabel="Send to class teacher"
          onDone={async (ok) => {
            toast.show(ok);
            await reload();
          }}
          onError={(msg) => toast.show(msg)}
        />
      ) : null}
      {!rows.length ? (
        <Empty title="No days marked yet" body="When the teacher marks the class, it appears here. Open days still show as weekly off, holiday, upcoming, or not marked." />
      ) : (
        phone ? (
          <View className="mb-4 rounded-3xl border border-ink-100 bg-white p-4">
            <View className="flex-row items-center gap-4">
              <View
                className="h-[72px] w-[72px] items-center justify-center rounded-full border-[6px]"
                style={{ borderColor: att.pct >= 75 ? "#2BB673" : att.pct >= 60 ? "#F59E0B" : "#E5484D" }}
              >
                <Text className="text-[18px] font-bold text-ink-900">{att.pct}%</Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[17px] font-semibold text-ink-900">{attendanceMessage}</Text>
                <Text className="mt-0.5 text-[12px] text-ink-500">
                  Over the last {att.marked} school day{att.marked === 1 ? "" : "s"} · 75% needed
                </Text>
                {todayLabel ? (
                  <View className="mt-2 self-start rounded-full bg-[#EEF3FF] px-2.5 py-1">
                    <Text className="text-[11px] font-semibold text-[#1F45C7]">{todayLabel}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <View className="mt-4 flex-row gap-2">
              {[
                { label: "Present", value: att.inDays, bg: "bg-[#ECF8F0]", tone: "text-[#18794E]" },
                { label: "Late", value: att.late, bg: "bg-[#FFF7E8]", tone: "text-[#B45309]" },
                { label: "Absent", value: att.out, bg: "bg-[#FDECEC]", tone: "text-[#B42318]" },
              ].map((item) => (
                <View key={item.label} className={`flex-1 rounded-2xl px-3 py-2.5 ${item.bg}`}>
                  <Text className={`text-[20px] font-bold ${item.tone}`}>{item.value}</Text>
                  <Text className="text-[12px] text-ink-600">{item.label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : (
        <Card className="mb-4 p-4">
          <View className="flex-row flex-wrap items-end justify-between gap-3">
            <View>
              <Text className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                Last {att.marked} marked days
              </Text>
              <View className="mt-1 flex-row items-baseline gap-2">
                <Text className="text-3xl font-semibold tracking-tight text-ink-900">{att.pct}%</Text>
                <Text className="text-[13px] font-medium text-ink-600">{attendanceMessage}</Text>
              </View>
            </View>
            {todayLabel ? (
              <View className="rounded-full bg-[#EEF2FF] px-3 py-1.5">
                <Text className="text-[12px] font-medium text-clay-500">{todayLabel}</Text>
              </View>
            ) : null}
          </View>
          <View className="mt-3">
            <View className="h-1.5 overflow-hidden rounded-full bg-ink-100">
              <View className={`h-1.5 rounded-full ${progressTone}`} style={{ width: `${Math.max(2, att.pct)}%` }} />
            </View>
            <Text className="mt-1.5 text-[11px] text-ink-500">75% required for CBSE</Text>
          </View>
          <View className="mt-3 flex-row overflow-hidden rounded-lg border border-ink-100">
            {[
              { label: "Present", value: String(att.inDays), tone: "text-emerald-700" },
              { label: "Late", value: String(att.late), tone: "text-amber-700" },
              { label: "Absent", value: String(att.out), tone: "text-red-700" },
              { label: "This month", value: `${att.thisMonth.inDays}/${att.thisMonth.marked}`, tone: "text-ink-900" },
            ].map((item, index) => (
              <View key={item.label} className={`flex-1 px-3 py-2.5 ${index ? "border-l border-ink-100" : ""}`}>
                <Text className={`text-lg font-semibold ${item.tone}`}>{item.value}</Text>
                <Text className="mt-0.5 text-[11px] text-ink-500">{item.label}</Text>
              </View>
            ))}
          </View>
        </Card>
        )
      )}

          <View className="mb-2 mt-1 flex-row items-end justify-between gap-3">
            <Text className="text-[15px] font-semibold text-ink-900">{phone ? "Calendar" : "Month"}</Text>
            {cbse ? (
              <View className="rounded-full bg-amber-50 px-3 py-1">
                <Text className="text-[11px] font-medium text-amber-800">{cbse}</Text>
              </View>
            ) : null}
          </View>
          <ParentAttendanceCalendar
            activeMonth={activeMonth}
            calendar={calendar}
            childClass={child?.classLabel || ""}
            marks={new Map(rows.map((row) => [row.rawDate || attendanceDateKey(row.date), row.status]))}
            plannedLeaveDates={plannedLeaveDates}
            onMonth={(next) => setCalendarMonth(next)}
            shiftMonth={shiftMonth}
            monthLabel={monthLabel}
          />
    </View>
  );
}

export function FamilySubjects() {
  const { data } = useRecord();
  const router = useRouter();
  const child = data?.child;
  const student = data?.kind === "STUDENT";
  const subjects = child?.subjects ?? [];
  return (
    <View>
      <PageHeader
        kicker="Reports"
        title={student ? "Courses" : "Subjects"}
        lede={
          student
            ? "Your subjects this year — teacher, marks, and upcoming tests."
            : child
              ? `A simple picture of ${child.name}'s teachers, marks, and upcoming tests.`
              : "Teachers, marks, and upcoming tests in one place."
        }
      />
      <ChildSwitch />
      {!subjects.length ? (
        <Empty
          title={student ? "No courses on the timetable yet" : "No subject picture yet"}
          body={student ? "When the office fills the week, subjects land here." : "Marks land after a teacher enters them."}
        />
      ) : (
        <View className="gap-4">
          <View className="gap-3">
            {subjects.map((s) => {
              const hasMarks = s.n > 0;
              const statusTone = !hasMarks ? "sky" : s.pct >= 75 ? "leaf" : s.pct >= 50 ? "warn" : "danger";
              const statusLabel = !hasMarks ? "No marks yet" : s.pct >= 75 ? "Doing well" : s.pct >= 50 ? "Steady" : "Needs attention";
              return (
                <Card key={s.name} className="overflow-hidden">
                  <View className="flex-row flex-wrap items-start justify-between gap-3 p-5">
                    <View className="min-w-[220px] flex-1">
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Text className="text-xl font-semibold text-ink-900">{s.name}</Text>
                        <Badge tone={statusTone}>{statusLabel}</Badge>
                      </View>
                      <Text className="mt-1 text-sm text-ink-700">
                        {s.teacher ? `Teacher: ${s.teacher}` : "Teacher not assigned yet"}
                      </Text>
                    </View>
                    <View className="items-end">
                      <Text className="text-xs font-semibold uppercase tracking-wide text-ink-600">Average</Text>
                      <Text className="text-3xl font-semibold text-ink-900">{hasMarks ? `${s.pct}%` : "—"}</Text>
                    </View>
                  </View>

                  <View className="mx-5 h-2 overflow-hidden rounded-full bg-ink-100">
                    <View
                      className={`h-full ${hasMarks ? "bg-clay-500" : "bg-ink-200"}`}
                      style={{ width: `${hasMarks ? Math.min(100, s.pct) : 8}%` }}
                    />
                  </View>

                  <View className="px-5 pb-5 pt-4">
                    <View className="rounded-2xl bg-clay-50 p-4">
                      <Text className="text-xs font-semibold uppercase tracking-wide text-ink-600">Next test</Text>
                      <Text className="mt-1 text-sm font-medium text-ink-900">
                        {s.nextTest ? s.nextTest.title : "No test scheduled"}
                      </Text>
                      {s.nextTest ? <Text className="mt-1 text-xs text-ink-700">{s.nextTest.date}</Text> : null}
                    </View>
                  </View>

                  <View className="flex-row flex-wrap gap-2 border-t border-ink-100 px-5 py-3">
                    <Pressable className="rounded-xl border border-ink-200 px-3 py-2" onPress={() => router.push("/tests")}>
                      <Text className="text-sm font-semibold text-ink-800">View examination</Text>
                    </Pressable>
                  </View>
                </Card>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

export function FamilyTests() {
  const { data } = useRecord();
  const { token } = useSession();
  const toast = useToast();
  const params = useLocalSearchParams<{ seriesId?: string; view?: string }>();
  const child = data?.child;
  const reports = data?.reports ?? [];
  const [seriesId, setSeriesId] = useState(String(params.seriesId || ""));
  const open = reports.find((r) => r.seriesId === seriesId) ?? reports[0] ?? null;
  const student = data?.kind === "STUDENT";

  async function download(query: { seriesId?: string; examId?: string }) {
    try {
      await openMarksheetPdf(token, { ...query, studentId: child?.id });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not open the marksheet.");
    }
  }

  return (
    <View>
      <PageHeader
        kicker="Reports"
        title="Examination"
        lede={
          student
            ? "One report card per exam, after every subject is published."
            : "One report card per sitting once every subject is published. Only families who have paid the required fee months can open it."
        }
      />
      <ChildSwitch />
      {open && child ? (
        <View className="mb-6">
          <Text className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-700">Academic results</Text>
          <Text className="mb-3 font-semibold text-ink-900">{open.sessionLabel}</Text>
          <View className="mb-3 flex-row flex-wrap gap-2">
            {reports.map((r) => (
              <Chip
                key={r.seriesId}
                label={r.seriesName}
                active={(open.seriesId || "") === r.seriesId}
                onPress={() => setSeriesId(r.seriesId)}
              />
            ))}
          </View>
          <View className="mb-4 flex-row flex-wrap gap-2">
            <Button onPress={() => download({ seriesId: open.seriesId })}>Download report card</Button>
          </View>
          {(() => {
            const rows = open.exams.map((exam) => {
              const mark = open.marks.find((row) => row.examId === exam.id && row.studentId === child.id);
              return {
                subject: exam.subject.name,
                marks: mark?.absent ? null : mark?.marks ?? null,
                max: exam.maxMarks,
                absent: Boolean(mark?.absent),
              };
            });
            const total = rows.reduce((sum, row) => sum + (row.absent || row.marks == null ? 0 : Number(row.marks)), 0);
            const max = rows.reduce((sum, row) => sum + row.max, 0);
            const pct = max ? Math.round((total / max) * 1000) / 10 : 0;
            return (
              <Card className="overflow-hidden">
                <View className="px-4 py-4">
                  <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-700">{open.seriesName}</Text>
                  <Text className="mt-1 text-sm text-ink-800">{child.name} · {studentMetaLine(child)}</Text>
                  <Text className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">
                    {total} / {max}
                  </Text>
                  <Text className="mt-0.5 text-sm text-ink-700">{pct}%</Text>
                </View>
                {rows.map((row) => (
                  <View key={row.subject} className="flex-row border-t border-ink-100 px-4 py-2.5">
                    <Text className="min-w-0 flex-1 text-sm text-ink-900">{row.subject}</Text>
                    <Text className="text-sm text-ink-900">{row.absent ? "Absent" : row.marks == null ? "—" : `${row.marks}/${row.max}`}</Text>
                  </View>
                ))}
              </Card>
            );
          })()}
        </View>
      ) : (
        <Empty
          title={data?.reportCardHold ? "Report card held for fees" : "No published results yet"}
          body={
            data?.reportCardHold
              ? data.reportCardHold.reason === "unpaid"
                ? `This exam is complete. Pay until unpaid fee months are below ${data.reportCardHold.unpaidThreshold}. ${data.reportCardHold.unpaidMonths} month${data.reportCardHold.unpaidMonths === 1 ? "" : "s"} still due.`
                : `This exam is complete. The report card opens after ${data.reportCardHold.requiredMonths} paid fee month${data.reportCardHold.requiredMonths === 1 ? "" : "s"}. Paid so far: ${data.reportCardHold.paidMonths}.`
              : "When every subject in an exam is published, one report card with all subjects appears here."
          }
        />
      )}
      <Text className="mb-3 mt-2 font-semibold text-ink-900">Examination timetable</Text>
      {!data?.upcoming?.length ? (
        <Text className="mb-6 text-sm text-ink-700">No upcoming tests on the calendar yet.</Text>
      ) : (
        <View className="mb-6 gap-2">
          {data.upcoming.map((e) => (
            <Card key={e.id} className="flex-row items-center justify-between p-4">
              <View className="flex-1 pr-2">
                <Text className="font-medium text-ink-900">{e.title}</Text>
                <Text className="text-xs text-ink-700">
                  {e.subject}
                  {e.teacher ? ` · ${e.teacher}` : ""}
                </Text>
              </View>
              <Badge>{e.date}</Badge>
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}

export function FamilyPapers() {
  const { data } = useRecord();
  const { token } = useSession();
  const toast = useToast();
  const child = data?.child;

  async function openPaper(p: NonNullable<typeof child>["papers"][number]) {
    if (!p.fileUrl) {
      toast.show("This copy has no file yet.");
      return;
    }
    try {
      const url = p.fileUrl.replace(/https?:\/\/[^/]+/, webOrigin());
      await openAuthedFile(url, token);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not open this paper.");
    }
  }

  return (
    <View>
      <PageHeader
        kicker="Reports"
        title={data?.kind === "STUDENT" ? "Papers" : "How the paper was marked"}
        lede={
          data?.kind === "STUDENT"
            ? "Scanned copies the teacher uploaded."
            : "Scanned answer copies open with your login. The sitting report card is on Examination."
        }
      />
      <ChildSwitch />
      {!child?.papers.length ? (
        <Empty title="No papers uploaded" body="Scanned copies appear here after the teacher uploads them. The report card is on Examination." />
      ) : (
        <View className="gap-3">
          {(child?.papers ?? []).map((p) => (
            <Card key={p.id} className="p-5">
              <Text className="text-xl font-semibold text-ink-900">{p.title}</Text>
              <View className="mt-2 flex-row flex-wrap gap-2">
                <Badge>{p.type}</Badge>
                <Badge>{p.subject}</Badge>
              </View>
              {p.notes ? <Text className="mt-2 text-sm text-ink-700">{p.notes}</Text> : null}
              <Text className="mt-2 text-xs text-ink-700">
                Evaluated by {p.teacher} · {p.date}
              </Text>
              <Pressable className="mt-2" onPress={() => openPaper(p)}>
                <Text className="text-sm font-medium text-clay-600">{p.fileName || "Open PDF"}</Text>
              </Pressable>
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}

export function FamilyPath() {
  const { data } = useRecord();
  const child = data?.child;
  return (
    <View>
      <PageHeader
        kicker={data?.kind === "STUDENT" ? undefined : "Reports"}
        title={data?.kind === "STUDENT" ? "Path" : "The path"}
        lede={
          data?.kind === "STUDENT"
            ? "Contests and what you are into."
            : "Spelling. Sport. Olympiad. Science. Arts. This is what the child is into."
        }
      />
      <ChildSwitch />
      <View className="mb-6 flex-row flex-wrap gap-2">
        {child?.interests.length ? (
          child.interests.map((i) => (
            <Badge key={i} tone="clay">
              {i}
            </Badge>
          ))
        ) : (
          <Text className="text-sm text-ink-700">No path tagged yet.</Text>
        )}
      </View>
      {!child?.path.length ? (
        <Empty title="No contests on this path yet" body="When they enter a bee, an olympiad, a race — it lives here." />
      ) : (
        <View className="gap-3">
          {child.path.map((e) => (
            <Card key={e.id} className="p-5">
              <Text className="text-xl font-semibold text-ink-900">{e.title}</Text>
              <View className="mt-2 flex-row flex-wrap gap-2">
                <Badge>{e.type}</Badge>
                <Badge>{e.level}</Badge>
              </View>
              {e.description ? <Text className="mt-2 text-sm text-ink-700">{e.description}</Text> : null}
              <Text className="mt-3 text-sm text-ink-900">
                {e.rank ? `Rank ${e.rank}` : "Entered — result pending"}
                {e.result ? ` · ${e.result}` : ""}
                {e.score != null ? ` · score ${e.score}` : ""}
              </Text>
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}

export function FamilyProfile() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const router = useRouter();
  const toast = useToast();
  const child = data?.child;
  const student = data?.kind === "STUDENT";
  const parent = data?.kind === "PARENT";
  const familyKids =
    parent && (data.children?.length || child)
      ? (data.children?.length
          ? data.children
          : child
            ? [
                {
                  id: child.id,
                  name: child.name,
                  classLabel: child.classLabel,
                  admissionNo: child.admissionNo,
                  born: child.born,
                  email: child.email,
                  interests: child.interests,
                },
              ]
            : [])
      : [];
  const parentRows = parent
    ? [
        { label: "Name", value: data.parent?.name || user?.name || "—" },
        { label: "Email", value: data.parent?.email || user?.email || "—" },
        { label: "Phone", value: data.parent?.phone || child?.parentPhone || "—" },
        { label: "Address", value: data.parent?.address || "—" },
        { label: "City", value: data.parent?.city || "—" },
        { label: "State", value: data.parent?.state || "—" },
        { label: "Pincode", value: data.parent?.pincode || "—" },
      ]
    : [];
  const studentRows = student
    ? [
        { label: "Name", value: child?.name || user?.name || "—" },
        { label: "Class", value: child?.classLabel || "—" },
        { label: "Roll no.", value: child?.rollNumber ? String(child.rollNumber) : "—" },
        { label: "Admission no.", value: child?.admissionNo || "—" },
        { label: "Date of birth", value: child?.born || "—" },
        { label: "Login", value: child?.email || user?.email || "—" },
        { label: "Parent", value: child?.parentName || "—" },
        { label: "Parent phone", value: child?.parentPhone || "—" },
        { label: "Parent email", value: child?.parentEmail || "—" },
      ]
    : [];
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const staffLike = !parent && !student;
  const isAdmin = user?.role === "ADMIN";
  const displayName = (parent ? data?.parent?.name : student ? child?.name : "") || user?.name || "—";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
  const subline = student
    ? [child?.classLabel, child?.email || user?.email].filter(Boolean).join(" · ")
    : [parent ? "Parent" : user?.roleName, parent ? data?.parent?.email || user?.email : user?.email].filter(Boolean).join(" · ");

  async function savePassword() {
    if (next !== confirm) {
      toast.show("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await act(token, "changePassword", { current, next });
      setCurrent("");
      setNext("");
      setConfirm("");
      setPwOpen(false);
      toast.show("Password updated.");
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not change password.");
    } finally {
      setBusy(false);
    }
  }

  function DetailRows({ rows }: { rows: { label: string; value: string }[] }) {
    return (
      <>
        {rows.map((row) => (
          <View
            key={row.label}
            className="mb-3 flex-row items-baseline justify-between gap-3 border-b border-ink-100 pb-3 last:mb-0 last:border-b-0 last:pb-0"
          >
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">{row.label}</Text>
            <Text className="flex-1 text-right text-sm text-ink-900">{row.value || "—"}</Text>
          </View>
        ))}
      </>
    );
  }

  return (
    <View>
      <PageHeader
        title="Profile"
        lede={
          student
            ? "How the school has you on record. Name, class, and admission number are set by the office."
            : parent
              ? "Your details as given to the school, and each child linked to this login."
              : "Your account and login."
        }
      />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <Card className="mb-4 flex-row items-center gap-4 p-5">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-[#EEF3FF]">
          <Text className="text-[18px] font-bold text-[#1F45C7]">{initials || "?"}</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[18px] font-semibold text-ink-900" numberOfLines={1}>
            {displayName}
          </Text>
          {subline ? (
            <Text className="mt-0.5 text-[13px] text-ink-600" numberOfLines={2}>
              {subline}
            </Text>
          ) : null}
        </View>
      </Card>
      {staffLike ? null : parent ? (
        <Card className="mb-4 p-5">
          <Text className="mb-3 text-[13px] font-semibold text-ink-900">Parent</Text>
          <DetailRows rows={parentRows} />
        </Card>
      ) : (
        <Card className="mb-4 p-5">
          <DetailRows rows={studentRows} />
          {student && child?.interests?.length ? (
            <View className="mt-3 flex-row flex-wrap gap-2">
              {child.interests.map((i) => (
                <Badge key={i} tone="clay">
                  {i}
                </Badge>
              ))}
            </View>
          ) : null}
          {student ? (
            <Text className="mt-4 text-xs text-ink-700">
              Students cannot edit this record. If something is wrong, ask the office or your parent.
            </Text>
          ) : null}
        </Card>
      )}
      {parent
        ? familyKids.map((kid) => (
            <Card key={kid.id} className="mb-4 p-5">
              <Text className="mb-3 text-[13px] font-semibold text-ink-900">
                Child · {kid.name}
              </Text>
              <DetailRows
                rows={[
                  { label: "Name", value: kid.name },
                  { label: "Class", value: kid.classLabel },
                  { label: "Roll no.", value: kid.rollNumber ? String(kid.rollNumber) : kid.id === child?.id && child.rollNumber ? String(child.rollNumber) : "—" },
                  { label: "Admission no.", value: kid.admissionNo || (kid.id === child?.id ? child.admissionNo : "") || "—" },
                  { label: "Date of birth", value: kid.born || (kid.id === child?.id ? child.born || "" : "") || "—" },
                  { label: "Student login", value: kid.email || (kid.id === child?.id ? child.email || "" : "") || "—" },
                ]}
              />
              {(kid.interests?.length || (kid.id === child?.id && child.interests?.length)) ? (
                <View className="mt-3 flex-row flex-wrap gap-2">
                  {(kid.interests?.length ? kid.interests : child?.interests || []).map((i) => (
                    <Badge key={i} tone="clay">
                      {i}
                    </Badge>
                  ))}
                </View>
              ) : null}
            </Card>
          ))
        : null}
      <Card className="mb-4 overflow-hidden">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: pwOpen }}
          onPress={() => setPwOpen((v) => !v)}
          className="flex-row items-center gap-3 px-5 py-4"
        >
          <View className="h-9 w-9 items-center justify-center rounded-full bg-ink-50">
            <Ionicons name="key-outline" size={17} color="#334155" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold text-ink-900">Change password</Text>
            <Text className="text-xs text-ink-600">
              {student ? "The one thing you can change yourself." : "Pick a new password only you know."}
            </Text>
          </View>
          <Ionicons name={pwOpen ? "chevron-up" : "chevron-down"} size={18} color="#94a3b8" />
        </Pressable>
        {pwOpen ? (
          <View className="gap-3 border-t border-ink-100 px-5 pb-5 pt-4">
            <Field label="Current password">
              <Input secureTextEntry value={current} onChangeText={setCurrent} />
            </Field>
            <Field label="New password">
              <Input secureTextEntry value={next} onChangeText={setNext} />
            </Field>
            <Field label="Confirm new password">
              <Input secureTextEntry value={confirm} onChangeText={setConfirm} />
            </Field>
            <Button disabled={busy || !current || !next} onPress={savePassword}>
              {busy ? "Saving…" : "Save new password"}
            </Button>
          </View>
        ) : null}
      </Card>
      {user?.portal === "OFFICE" ? (
        isAdmin ? (
          <Card className="mb-4 flex-row items-center gap-3 px-5 py-4">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-ink-50">
              <Ionicons name="airplane-outline" size={17} color="#334155" />
            </View>
            <Pressable onPress={() => router.push("/leave" as never)} className="min-w-0 flex-1">
              <Text className="text-[15px] font-semibold text-ink-900">My leave</Text>
              <Text className="text-xs font-semibold text-[#1F45C7]">Balance & history ›</Text>
            </Pressable>
            <LeaveApplyCard
              audience="staff"
              token={token}
              triggerOnly
              onDone={async (ok) => {
                toast.show(ok);
                await reload();
              }}
              onError={(msg) => toast.show(msg)}
            />
          </Card>
        ) : (
          <View className="mb-4">
            <LeaveApplyCard
              audience="staff"
              token={token}
              compact
              onDone={async (ok) => {
                toast.show(ok);
                await reload();
              }}
              onError={(msg) => toast.show(msg)}
            />
          </View>
        )
      ) : null}
    </View>
  );
}

export function FamilyLetter() {
  const { data } = useRecord();
  const child = data?.child;
  return (
    <View>
      <PageHeader kicker="Reports" title="Letter of the student" lede="A reading of marks, path, contests, and where to grow next." />
      <ChildSwitch />
      <Card className="p-6">
        <Text className="text-xs uppercase text-clay-600">Strength, not percentage</Text>
        <View className="mt-4 gap-4">
          {(child?.letter.lines ?? []).map((line) => (
            <Text key={line} className="text-xl font-semibold leading-6 text-ink-900">
              {line}
            </Text>
          ))}
        </View>
        <View className="mt-6 flex-row flex-wrap gap-2">
          {(child?.letter.paths ?? []).map((p) => (
            <Badge key={p} tone="clay">
              {p}
            </Badge>
          ))}
        </View>
      </Card>
    </View>
  );
}

export function FamilyTimetable() {
  const { data } = useRecord();
  const { width } = useWindowDimensions();
  const child = data?.child;
  const table = data?.timetable;
  const title = data?.kind === "TEACHER" ? "Your week" : data?.kind === "OFFICE" ? "The week" : "Timetable";
  const slots = table?.slots ?? table?.classes?.flatMap((c) => c.slots.map((s) => ({ ...s, classLabel: c.label }))) ?? [];
  const weekdays = table?.weekdays ?? [];
  const today = new Date().getDay();
  const firstDay = weekdays.find((day) => day.n === today)?.n ?? weekdays[0]?.n ?? 1;
  const [pickedDay, setPickedDay] = useState<number | null>(null);
  const activeDay = weekdays.some((day) => day.n === pickedDay) ? pickedDay! : firstDay;
  const showWeekGrid = width >= 1100;
  const showTeacher = data?.kind !== "TEACHER";
  const periods: { id: string; name: string; start?: string; end?: string; isBreak?: boolean }[] = table?.periods?.length
    ? [...table.periods].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    : Array.from(
        new Map(
          slots.map((slot) => [slot.periodId || slot.period, { id: slot.periodId || slot.period, name: slot.period }])
        ).values()
      );

  function periodSlot(day: number, period: (typeof periods)[number]) {
    return slots.find(
      (slot) => slot.weekday === day && (slot.periodId ? slot.periodId === period.id : slot.period === period.name)
    );
  }

  function slotMeta(slot: (typeof slots)[number]) {
    const classLabel = "classLabel" in slot ? String(slot.classLabel || "") : "";
    const ownRoom = Boolean(slot.room && classLabel && slot.room.toLowerCase().replace(/\s+/g, "") === `classroom${classLabel}`.toLowerCase().replace(/\s+/g, ""));
    const showClass = data?.kind === "TEACHER" || data?.kind === "OFFICE";
    return [showTeacher ? slot.teacher : "", showClass ? classLabel : "", ownRoom ? "" : slot.room].filter(Boolean).join(" · ");
  }

  return (
    <View>
      {showWeekGrid || !slots.length ? <PageHeader
        kicker="Reports"
        title={title}
        lede={
          child
            ? `${child.name.split(" ")[0]} · Class ${child.classLabel}`
            : "Periods for every school day."
        }
      /> : null}
      {showWeekGrid || !slots.length ? <ChildSwitch /> : null}
      {!slots.length ? (
        <Empty title="No periods assigned" body="When admin fills the grid, it appears here." />
      ) : showWeekGrid ? (
        <View className="overflow-hidden rounded-lg border border-ink-200 bg-white">
          <View className="flex-row bg-ink-50">
            <View className="w-32 justify-center px-4 py-3">
              <Text className="text-xs font-semibold uppercase tracking-wide text-ink-700">Period</Text>
            </View>
            {weekdays.map((day) => (
              <View
                key={day.n}
                className={`flex-1 items-center border-l border-ink-200 px-2 py-3 ${
                  day.n === today ? "bg-blue-50" : ""
                }`}
              >
                <Text className={`text-sm font-semibold ${day.n === today ? "text-clay-600" : "text-ink-900"}`}>
                  {day.label}
                </Text>
                {day.n === today ? <Text className="mt-0.5 text-[10px] font-medium text-clay-600">TODAY</Text> : null}
              </View>
            ))}
          </View>
          {periods.map((period) => {
            const isBreak = isBreakPeriod(period);
            return (
              <View key={period.id} className="flex-row border-t border-ink-200">
                <View className="w-32 justify-center bg-ink-50 px-4 py-3">
                  <Text className="text-sm font-semibold text-ink-900">{period.name}</Text>
                  {period.start ? (
                    <Text className="mt-1 text-[11px] text-ink-700">
                      {period.start}{period.end ? `–${period.end}` : ""}
                    </Text>
                  ) : null}
                </View>
                {isBreak ? (
                  <View className="flex-1 items-center justify-center border-l border-ink-200 bg-amber-50 px-3 py-4">
                    <Text className="text-xs font-medium text-amber-800">Break</Text>
                  </View>
                ) : (
                  weekdays.map((day) => {
                    const slot = periodSlot(day.n, period);
                    return (
                      <View
                        key={`${day.n}-${period.id}`}
                        className={`min-h-[82px] flex-1 justify-center border-l border-ink-200 p-2 ${
                          day.n === today ? "bg-blue-50" : ""
                        }`}
                      >
                        {slot ? (
                          <View className="rounded-md border-l-4 border-clay-400 bg-ink-50 px-3 py-2.5">
                            <Text className="text-sm font-semibold text-ink-900" numberOfLines={2}>
                              {slot.subject}
                            </Text>
                            {slotMeta(slot) ? (
                              <Text className="mt-1 text-xs leading-4 text-ink-700" numberOfLines={2}>
                                {slotMeta(slot)}
                              </Text>
                            ) : null}
                          </View>
                        ) : (
                          <Text className="text-center text-xs text-ink-400">Free</Text>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <PhoneTimetable
          weekdays={weekdays}
          periods={periods}
          activeDay={activeDay}
          today={today}
          onPickDay={setPickedDay}
          slotFor={periodSlot}
          metaFor={slotMeta}
          switcher={<ChildSwitch />}
        />
      )}
    </View>
  );
}

const SUBJECT_COLORS = ["#2563EB", "#F97316", "#10B981", "#8B5CF6", "#E11D48", "#0EA5E9", "#CA8A04", "#14B8A6", "#DB2777", "#64748B"];

/** Same subject, same colour, on every screen. */
function subjectColor(subject: string) {
  let hash = 0;
  for (const char of subject.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SUBJECT_COLORS[hash % SUBJECT_COLORS.length];
}

function isBreakPeriod(period: { name: string; isBreak?: boolean }) {
  return Boolean(period.isBreak) || /recess|lunch|break|assembly/i.test(period.name);
}

function minutesOf(value?: string) {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

type TimetablePeriod = { id: string; name: string; start?: string; end?: string; isBreak?: boolean };

/** Phone timetable: day pills with dates, then a timeline with Now/Next, breaks as dividers and free periods as gaps. */
function PhoneTimetable<Slot extends { subject: string }>({
  weekdays,
  periods,
  activeDay,
  today,
  onPickDay,
  slotFor,
  metaFor,
  switcher,
}: {
  switcher?: React.ReactNode;
  weekdays: { n: number; label: string }[];
  periods: TimetablePeriod[];
  activeDay: number;
  today: number;
  onPickDay: (day: number) => void;
  slotFor: (day: number, period: TimetablePeriod) => Slot | undefined;
  metaFor: (slot: Slot) => string;
}) {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isToday = activeDay === today;
  const dateFor = (day: number) => {
    const date = new Date(now);
    date.setDate(now.getDate() + (day - today));
    return date;
  };
  const teaching = periods.filter((period) => !isBreakPeriod(period) && slotFor(activeDay, period));
  const doneCount = isToday ? teaching.filter((period) => (minutesOf(period.end) ?? 0) <= nowMinutes).length : 0;
  // "Now" = running lesson; otherwise the next one still to come today.
  const nowId = isToday
    ? teaching.find((period) => {
        const from = minutesOf(period.start);
        const to = minutesOf(period.end);
        return from !== null && to !== null && nowMinutes >= from && nowMinutes < to;
      })?.id
    : undefined;
  const nextId = isToday && !nowId ? teaching.find((period) => (minutesOf(period.start) ?? 0) > nowMinutes)?.id : undefined;
  const dayDate = dateFor(activeDay);

  return (
    <View>
      <View className="mb-3 flex-row items-center justify-between gap-3 px-1">
        <View className="min-w-0 flex-1">
          <Text className="text-[22px] font-bold leading-7 text-ink-900">Timetable</Text>
          <Text className="mt-0.5 text-[13px] text-ink-500" numberOfLines={1}>
            {dayDate.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
            {" · "}
            {teaching.length
              ? isToday
                ? `${doneCount} of ${teaching.length} done`
                : `${teaching.length} lesson${teaching.length === 1 ? "" : "s"}`
              : "No lessons"}
          </Text>
        </View>
        {switcher}
      </View>

      <View className="mb-4 flex-row gap-1.5">
        {weekdays.map((day) => {
          const on = day.n === activeDay;
          const date = dateFor(day.n);
          return (
            <Pressable
              key={day.n}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${day.label}${day.n === today ? ", today" : ""}`}
              onPress={() => onPickDay(day.n)}
              className={`flex-1 items-center rounded-2xl py-2 ${on ? "bg-[#1F45C7]" : "bg-white"}`}
              style={on ? undefined : { shadowColor: "#0f2744", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 }}
            >
              <Text className={`text-[11px] font-medium ${on ? "text-white/80" : "text-ink-700"}`}>{day.label.slice(0, 3)}</Text>
              <Text className={`mt-0.5 text-base font-bold ${on ? "text-white" : "text-ink-900"}`}>{date.getDate()}</Text>
              <View className={`mt-1 h-1 w-1 rounded-full ${day.n === today ? (on ? "bg-white" : "bg-[#1F45C7]") : "bg-transparent"}`} />
            </Pressable>
          );
        })}
      </View>

      <View className="mb-6 overflow-hidden rounded-3xl bg-white py-1" style={{ shadowColor: "#0f2744", shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 }}>
        {periods.map((period, index) => {
          if (isBreakPeriod(period)) {
            return (
              <View key={period.id} className="flex-row items-center gap-2 px-4 py-2">
                <View className="h-px flex-1 bg-ink-100" />
                <Ionicons name={/lunch/i.test(period.name) ? "restaurant-outline" : "cafe-outline"} size={13} color="#B45309" />
                <Text className="text-xs font-medium text-amber-800">
                  {period.name}
                  {period.start ? ` · ${prettyTime(period.start)}${period.end ? ` – ${prettyTime(period.end)}` : ""}` : ""}
                </Text>
                <View className="h-px flex-1 bg-ink-100" />
              </View>
            );
          }
          const slot = slotFor(activeDay, period);
          const past = isToday && (minutesOf(period.end) ?? -1) <= nowMinutes && (minutesOf(period.end) ?? -1) >= 0;
          const isNow = period.id === nowId;
          const isNext = period.id === nextId;
          const color = slot ? subjectColor(slot.subject) : "#CBD5E1";
          const from = minutesOf(period.start);
          const to = minutesOf(period.end);
          const progress = isNow && from !== null && to !== null ? Math.min(1, (nowMinutes - from) / Math.max(1, to - from)) : 0;
          return (
            <View
              key={period.id}
              className={`flex-row gap-3 px-4 py-2.5 ${index ? "" : ""} ${isNow ? "bg-[#F3F6FF]" : ""}`}
              style={{ opacity: past && !isNow ? 0.5 : 1 }}
            >
              <View className="w-[58px] pt-0.5">
                <Text className={`text-[13px] font-semibold ${isNow ? "text-[#1F45C7]" : "text-ink-900"}`}>{period.start ? prettyTime(period.start) : period.name}</Text>
                {period.end ? <Text className="text-[11px] text-ink-500">{prettyTime(period.end)}</Text> : null}
              </View>
              <View className="w-1 rounded-full" style={{ backgroundColor: slot ? color : "transparent", borderWidth: slot ? 0 : 1, borderColor: "#E2E8F0", borderStyle: "dashed" }} />
              <View className="min-w-0 flex-1 justify-center">
                {slot ? (
                  <>
                    <View className="flex-row items-center gap-2">
                      <Text className="min-w-0 flex-shrink text-[15px] font-semibold text-ink-900" numberOfLines={1}>{slot.subject}</Text>
                      {isNow ? (
                        <View className="rounded-full bg-[#1F45C7] px-2 py-0.5">
                          <Text className="text-[10px] font-bold text-white">NOW</Text>
                        </View>
                      ) : isNext ? (
                        <View className="rounded-full bg-[#EEF3FF] px-2 py-0.5">
                          <Text className="text-[10px] font-bold text-[#1F45C7]">NEXT</Text>
                        </View>
                      ) : null}
                    </View>
                    {metaFor(slot) ? <Text className="mt-0.5 text-xs text-ink-700" numberOfLines={1}>{metaFor(slot)}</Text> : null}
                    {isNow ? (
                      <View className="mt-2 h-1 overflow-hidden rounded-full bg-[#DCE5FF]">
                        <View className="h-full rounded-full bg-[#1F45C7]" style={{ width: `${Math.round(progress * 100)}%` }} />
                      </View>
                    ) : null}
                  </>
                ) : (
                  <Text className="text-sm text-ink-500">Free · no class</Text>
                )}
              </View>
              <Text className="self-center text-[10px] font-medium text-ink-400">{period.name.replace(/^Period\s*/i, "P")}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

type FeeInv = NonNullable<NonNullable<RecordPayload["child"]>["fees"]>[number];

function rupees(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function dueOf(inv: FeeInv) {
  if (inv.display === "paid") return 0;
  if (typeof inv.dueNow === "number" && inv.dueNow > 0) return inv.dueNow;
  const n = Number(String(inv.remaining || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

type StatementFee = FeeInv & {
  childId: string;
  childName: string;
  classLabel: string;
};

function amountOf(value?: string) {
  const n = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function feeStatus(inv: FeeInv) {
  if (inv.display === "paid" || dueOf(inv) <= 0) return "Paid";
  if (inv.display === "overdue") return "Overdue";
  if (amountOf(inv.paid) > 0) return "Partial";
  return "Due";
}

function feeTone(status: string): "leaf" | "warn" | "danger" | "clay" {
  if (status === "Paid") return "leaf";
  if (status === "Overdue") return "danger";
  if (status === "Partial") return "warn";
  return "clay";
}

function shortDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function FamilyFees() {
  const { data } = useRecord();
  const { token } = useSession();
  const router = useRouter();
  const toast = useToast();
  const child = data?.child;
  const children = data?.children ?? [];
  const familyChildren = useMemo(() => children.filter((kid) => (kid.fees ?? []).length), [children]);
  const familyMode = data?.kind === "PARENT" && familyChildren.length > 1;
  const [tab, setTab] = useState<"overdue" | "paid">("overdue");
  const [picked, setPicked] = useState<string[]>([]);
  const { width: screenWidth } = useWindowDimensions();
  const [doc, setDoc] = useState<{ url: string; title: string } | null>(null);

  const allFees = useMemo<StatementFee[]>(() => {
    if (familyMode) {
      return familyChildren.flatMap((kid) =>
        (kid.fees ?? []).map((fee) => ({
          ...fee,
          childId: kid.id,
          childName: kid.name,
          classLabel: kid.classLabel,
        }))
      );
    }
    if (!child) return [];
    return child.fees.map((fee) => ({
      ...fee,
      childId: child.id,
      childName: child.name,
      classLabel: child.classLabel,
    }));
  }, [child?.classLabel, child?.fees, child?.id, child?.name, familyChildren, familyMode]);
  const openInvoices = useMemo(() => allFees.filter((inv) => dueOf(inv) > 0), [allFees]);
  const paidInvoices = useMemo(() => allFees.filter((inv) => dueOf(inv) <= 0), [allFees]);

  useEffect(() => {
    setPicked(openInvoices.map((inv) => inv.id));
  }, [openInvoices]);

  const selectedInvoices = openInvoices.filter((inv) => picked.includes(inv.id));
  const totalDue = openInvoices.reduce((sum, inv) => sum + dueOf(inv), 0);
  const selectedDue = selectedInvoices.reduce((sum, inv) => sum + dueOf(inv), 0);
  const overdueCount = openInvoices.filter((inv) => inv.display === "overdue").length;
  const overdueDue = openInvoices
    .filter((inv) => inv.display === "overdue")
    .reduce((sum, inv) => sum + dueOf(inv), 0);
  const nextDue = openInvoices
    .slice()
    .sort((a, b) => Date.parse(a.dueAt || "") - Date.parse(b.dueAt || ""))[0];
  const [busy, setBusy] = useState(false);

  const selectedIds = selectedInvoices.map((inv) => inv.id);
  const payKind = data?.kind === "STUDENT" ? " with Razorpay" : "";
  const payLabel = selectedDue > 0 ? `Pay ${rupees(selectedDue)}${payKind}` : "Pick dues";

  async function pay() {
    if (!child?.id || !selectedIds.length) return;
    setBusy(true);
    try {
      const res = await act<{ ok: true; path: string }>(token, "ensurePayLink", {
        studentId: child.id,
        invoiceIds: selectedIds,
        combineFamily: familyMode,
      });
      if (!res.path) throw new Error("Could not open pay link");
      const payUrl = `${res.path}${res.path.includes("?") ? "&" : "?"}embed=1`;
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.assign(payUrl);
        return;
      }
      router.push(`/pay?path=${encodeURIComponent(res.path)}`);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not open pay.");
    } finally {
      setBusy(false);
    }
  }

  function openDocument(url?: string, title = "Invoice") {
    if (!url) return;
    setDoc({ url, title });
  }
  const docViewer = <DocViewer url={doc?.url ?? null} title={doc?.title ?? ""} onClose={() => setDoc(null)} />;

  function toggleInvoice(id: string) {
    setPicked((ids) => (ids.includes(id) ? ids.filter((row) => row !== id) : [...ids, id]));
  }

  const visibleRows = tab === "paid" ? paidInvoices : openInvoices;

  if (screenWidth < 768 && allFees.length) {
    const order: string[] = [];
    const byChild = new Map<string, { id: string; name: string; classLabel: string; open: StatementFee[]; paid: StatementFee[] }>();
    for (const inv of allFees) {
      if (!byChild.has(inv.childId)) {
        order.push(inv.childId);
        byChild.set(inv.childId, { id: inv.childId, name: inv.childName, classLabel: inv.classLabel, open: [], paid: [] });
      }
      const g = byChild.get(inv.childId)!;
      (dueOf(inv) > 0 ? g.open : g.paid).push(inv);
    }
    const byDate = (a: StatementFee, b: StatementFee) => Date.parse(a.dueAt || "") - Date.parse(b.dueAt || "");
    const groups = order.map((id) => {
      const g = byChild.get(id)!;
      return { ...g, open: g.open.sort(byDate), paid: g.paid.sort((a, b) => byDate(b, a)) };
    });
    return (
      <View>
        {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
        <FeesPhoneView
          groups={groups}
          openInvoices={openInvoices}
          paidInvoices={paidInvoices}
          picked={picked}
          setPicked={setPicked}
          busy={busy}
          onPay={() => void pay()}
          onOpen={openDocument}
        />
        {docViewer}
      </View>
    );
  }

  return (
    <View>
      <PageHeader
        kicker={data?.kind === "STUDENT" ? undefined : "Parent · Reports"}
        title="Fees"
        lede={
          child
            ? `${familyMode ? "Family" : `${child.name} · ${child.classLabel}`}. Pay dues and keep invoices and receipts in one place.`
            : "Dues and collection."
        }
      />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {!allFees.length ? (
        <Empty title="No fee invoices yet" body="When the office raises a bill, it is here." />
      ) : (
        <View className="gap-3">
          <Card className="overflow-hidden">
            <View className="gap-4 border-b border-ink-100 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">{familyMode ? "Family dues" : "Selected child"}</Text>
                <Text className="mt-1 text-lg font-semibold text-ink-900">
                  {familyMode ? `${familyChildren.length} children` : `${child?.name} · ${child?.classLabel}`}
                </Text>
                <Text className="mt-1 text-xs leading-5 text-ink-700">
                  This statement includes older dues first, so payment records stay in order.
                </Text>
              </View>
              {openInvoices.length ? (
                <Button className="sm:min-w-[220px]" disabled={!selectedIds.length || busy} onPress={pay}>
                  {busy ? "Opening pay..." : payLabel}
                </Button>
              ) : null}
            </View>
            <View className="flex-row flex-wrap gap-2 p-4">
              <View className="min-w-[150px] flex-1 rounded-md border border-ink-100 bg-ink-50 p-3">
                <Text className="text-xs font-medium text-ink-700">Total due</Text>
                <Text className="mt-1 text-2xl font-semibold text-ink-900">{rupees(totalDue)}</Text>
              </View>
              <View className="min-w-[150px] flex-1 rounded-md border border-red-100 bg-red-50 p-3">
                <Text className="text-xs font-medium text-red-800">Overdue</Text>
                <Text className="mt-1 text-2xl font-semibold text-red-900">{rupees(overdueDue)}</Text>
              </View>
              <View className="min-w-[150px] flex-1 rounded-md border border-sky-100 bg-sky-50 p-3">
                <Text className="text-xs font-medium text-sky-900">Next due date</Text>
                <Text className="mt-1 text-2xl font-semibold text-sky-950">{shortDate(nextDue?.dueAt) || "All clear"}</Text>
              </View>
            </View>
          </Card>
          <Card className="overflow-hidden">
            <View className="flex-row items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
              <Text className="text-sm font-semibold text-ink-900">Invoices</Text>
              <View className="flex-row rounded-md border border-ink-200 bg-ink-50 p-0.5">
                {([
                  { id: "overdue", label: `${overdueCount ? "Overdue" : "Due"} ${openInvoices.length}` },
                  { id: "paid", label: `Paid ${paidInvoices.length}` },
                ] as const).map((item) => {
                  const on = tab === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      onPress={() => setTab(item.id)}
                      className={`h-8 justify-center rounded px-3 ${on ? "bg-white shadow-sm" : ""}`}
                    >
                      <Text className={`text-xs font-semibold ${on ? "text-ink-900" : "text-ink-600"}`}>{item.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {visibleRows.map((inv, index) => {
              const status = feeStatus(inv);
              const selected = picked.includes(inv.id);
              return (
                <View key={inv.id} className={`px-4 py-3 ${index ? "border-t border-ink-100" : ""}`}>
                  <View className="gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <View className="min-w-0 flex-1 flex-row items-start gap-2">
                      {tab === "overdue" ? (
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected }}
                          onPress={() => toggleInvoice(inv.id)}
                          hitSlop={8}
                          className={`mt-0.5 h-3.5 w-3.5 items-center justify-center rounded border ${
                            selected ? "border-clay-500 bg-clay-500" : "border-ink-300 bg-white"
                          }`}
                        >
                          {selected ? <Ionicons name="checkmark" size={10} color="#ffffff" /> : null}
                        </Pressable>
                      ) : null}
                      <View className="min-w-0 flex-1">
                        <Text className="text-sm font-semibold text-ink-900" numberOfLines={1}>
                          {familyMode ? `${inv.childName} · ` : ""}{inv.title}
                        </Text>
                        <Text className="mt-1 text-xs text-ink-700" numberOfLines={1}>
                          {familyMode ? `${inv.classLabel} · ` : ""}Due {inv.due} · Amt <Text className="font-semibold text-ink-900">{inv.amount}</Text> · Paid <Text className="font-semibold text-ink-900">{inv.paid}</Text> · Bal <Text className="font-semibold text-ink-900">{inv.remaining}</Text>
                        </Text>
                      </View>
                    </View>
                    <View className="flex-row flex-wrap items-center justify-end gap-x-3 gap-y-1">
                      <Badge tone={feeTone(status)}>{status}</Badge>
                      {inv.invoiceUrl ? (
                        <Pressable onPress={() => openDocument(inv.invoiceUrl)} hitSlop={8}>
                          <View className="flex-row items-center gap-1">
                            <Ionicons name="document-text-outline" size={14} color="#2456d6" />
                            <Text className="text-xs font-semibold text-clay-600">Invoice</Text>
                          </View>
                        </Pressable>
                      ) : null}
                      {inv.receiptUrl ? (
                        <Pressable onPress={() => openDocument(inv.receiptUrl, "Receipt")} hitSlop={8}>
                          <View className="flex-row items-center gap-1">
                            <Ionicons name="receipt-outline" size={14} color="#2456d6" />
                            <Text className="text-xs font-semibold text-clay-600">Receipt</Text>
                          </View>
                        </Pressable>
                      ) : null}
                      {inv.lateLabel ? <Text className="text-xs font-medium text-red-700">{inv.lateLabel}</Text> : null}
                    </View>
                  </View>
                  <View className="mt-2 flex-row flex-wrap gap-x-4 gap-y-1 pl-5">
                    {inv.lines.length ? (
                      <Text className="text-xs leading-5 text-ink-700">{inv.lines.join(" · ")}</Text>
                    ) : <Text />}
                  </View>
                </View>
              );
            })}
            {!visibleRows.length ? (
              <Text className="px-4 py-6 text-center text-sm text-ink-700">
                {tab === "paid" ? "No paid invoices yet." : "No overdue dues."}
              </Text>
            ) : null}
          </Card>
        </View>
      )}
      {docViewer}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Parent home on phones: one hero, what needs doing, quick access.     */
/* ------------------------------------------------------------------ */

type QuickTile = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  tint: string;
  color: string;
  badge?: number;
  onPress: () => void;
};

function ParentPhoneHome({ onMessage, wide = false }: { onMessage: () => void; wide?: boolean }) {
  const { data, childId, setChildId } = useRecord();
  const { token, user } = useSession();
  const router = useRouter();
  const [switchOpen, setSwitchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [inbox, setInbox] = useState<{ unread: number; reply: { id: string; subject: string } | null }>({ unread: 0, reply: null });

  useEffect(() => {
    if (!token) return;
    let live = true;
    api<{ threads: { id: string; subject: string; unread: boolean; status: string }[] }>("/inbox", token)
      .then((res) => {
        if (!live) return;
        const unread = res.threads.filter((t) => t.unread);
        setInbox({ unread: unread.length, reply: unread[0] ? { id: unread[0].id, subject: unread[0].subject } : null });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token, childId]);

  const child = data?.child;
  const kids = data?.children ?? [];
  const details = useParentDetails(child?.id);
  const detailsDue = Boolean(details.data && (details.data.counts.toSend || details.data.counts.waiting));
  const attRows = child?.attendance ?? [];
  const att = attendanceSummary(attRows);
  const unpaid = (child?.fees ?? []).filter((f) => f.display !== "paid" && f.dueNow > 0);
  const totalDue = unpaid.reduce((sum, f) => sum + f.dueNow, 0);
  const marked = (child?.subjects ?? []).filter((s) => s.n > 0);
  const lastTest = (child?.tests ?? []).find((t) => !t.absent && t.max > 0) || null;
  const lastPct = lastTest ? Math.round((lastTest.marks / lastTest.max) * 100) : null;
  const avg = marked.length ? Math.round(marked.reduce((n, s) => n + s.pct, 0) / marked.length) : null;
  const notices = (data?.notices ?? []).slice(0, 2);
  const coming = (data?.upcoming ?? []).slice(0, 3);
  const day = data ? todaySlots(data) : { label: "", periods: [] as ReturnType<typeof todaySlots>["periods"] };
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const current = day.periods.find((p) => periodPhase(p, nowMins) === "now") || null;
  const upNext = day.periods.find((p) => periodPhase(p, nowMins) === "next") || null;
  const left = day.periods.filter((p) => periodPhase(p, nowMins) !== "done");
  const later = data && !left.length ? nextScheduledPeriod(data) : null;
  const focus = current || upNext;
  const initialsOf = (name: string) =>
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  const tiles: QuickTile[] = [
    { key: "message", label: "Message school", icon: "paper-plane-outline", tint: "bg-[#EEF3FF]", color: "#1F45C7", onPress: onMessage },
    { key: "leave", label: "Apply leave", icon: "airplane-outline", tint: "bg-[#EEF4FF]", color: "#1D4ED8", onPress: () => router.push("/attendance?leave=1" as never) },
    { key: "attendance", label: "Attendance", icon: "checkmark-done-circle-outline", tint: "bg-[#ECF8F0]", color: "#18794E", onPress: () => router.push("/attendance" as never) },
    { key: "exams", label: "Exams", icon: "document-text-outline", tint: "bg-[#F3EEFF]", color: "#6D28D9", onPress: () => router.push("/tests" as never) },
  ];

  const sectionTitle = (title: string, action?: { label: string; onPress: () => void }) => (
    <View className="mb-2 mt-5 flex-row items-center justify-between">
      <Text className="text-[15px] font-semibold text-ink-900">{title}</Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text className="text-[13px] font-semibold text-[#1F45C7]">{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  const heroEl = (
    <>
      <View className="overflow-hidden rounded-3xl bg-[#1F45C7] p-4">
        <View className="flex-row items-center gap-3">
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
            <Text className="text-[17px] font-bold text-white">{initialsOf(child?.name || "")}</Text>
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[19px] font-bold text-white" numberOfLines={1}>
              {child?.name || "No child linked"}
            </Text>
            <Text className="mt-0.5 text-[12px] text-white/75" numberOfLines={1}>
              {child ? studentMetaLine(child) : "Ask the school to link your child."}
            </Text>
          </View>
          {kids.length > 1 ? (
            <Pressable onPress={() => setSwitchOpen(true)} className="h-8 flex-row items-center gap-1 rounded-full bg-white/15 px-3">
              <Ionicons name="swap-horizontal" size={14} color="#fff" />
              <Text className="text-[12px] font-semibold text-white">Switch</Text>
            </Pressable>
          ) : null}
        </View>
        <View className="mt-4 flex-row rounded-2xl bg-white/10">
          {[
            { label: "Attendance", value: attRows.length ? `${att.pct}%` : "—", go: "/attendance" },
            { label: "Last result", value: lastPct == null ? "—" : `${lastPct}%`, go: "/tests" },
            { label: totalDue ? "Fees due" : "Fees", value: totalDue ? money(totalDue) : "Paid", go: "/fees" },
          ].map((s, i) => (
            <Pressable key={s.label} onPress={() => router.push(s.go as never)} className={`flex-1 px-3 py-2.5 ${i ? "border-l border-white/15" : ""}`}>
              <Text className="text-[17px] font-bold text-white" numberOfLines={1}>
                {s.value}
              </Text>
              <Text className="mt-0.5 text-[11px] text-white/70">{s.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

    </>
  );
  const attentionEl = (
    <>
      {totalDue || inbox.reply || detailsDue ? (
        <View className="mt-4 gap-2.5">
          <ParentDetailsCard data={details.data} onOpen={() => setDetailsOpen(true)} />
          {totalDue ? (
            <View className="flex-row items-center gap-3 rounded-2xl border border-[#F5C2C2] bg-[#FFF5F5] p-3.5">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#FDE2E2]">
                <Ionicons name="receipt-outline" size={20} color="#B42318" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-semibold text-ink-900">{money(totalDue)} due</Text>
                <Text className="mt-0.5 text-[12px] text-ink-600" numberOfLines={1}>
                  {unpaid.length === 1 ? unpaid[0].title : `${unpaid.length} months pending`}
                </Text>
              </View>
              <Pressable onPress={() => router.push("/fees" as never)} className="h-9 items-center justify-center rounded-xl bg-[#1F45C7] px-4">
                <Text className="text-[13px] font-semibold text-white">Pay now</Text>
              </Pressable>
            </View>
          ) : null}
          {inbox.reply ? (
            <Pressable
              onPress={() => router.push(`/inbox?thread=${encodeURIComponent(inbox.reply!.id)}` as never)}
              className="flex-row items-center gap-3 rounded-2xl border border-[#C7D7FE] bg-[#F5F8FF] p-3.5"
            >
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#E0E8FF]">
                <Ionicons name="chatbubble-ellipses" size={19} color="#1F45C7" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-semibold text-ink-900">School replied</Text>
                <Text className="mt-0.5 text-[12px] text-ink-600" numberOfLines={1}>
                  {inbox.unread > 1 ? `${inbox.unread} unread conversations` : inbox.reply.subject}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </Pressable>
          ) : null}
        </View>
      ) : null}

    </>
  );
  const quickEl = (
    <>
      {sectionTitle("Quick access")}
      <View className="flex-row flex-wrap rounded-2xl border border-ink-100 bg-white py-2">
        {tiles.map((t) => (
          <Pressable key={t.key} onPress={t.onPress} className="w-1/4 items-center px-1 py-2.5">
            <View className={`h-12 w-12 items-center justify-center rounded-2xl ${t.tint}`}>
              <Ionicons name={t.icon} size={22} color={t.color} />
              {t.badge ? (
                <View className="absolute -right-1.5 -top-1.5 h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-white bg-[#E5484D] px-1">
                  <Text className="text-[10px] font-bold text-white">{t.badge > 9 ? "9+" : t.badge}</Text>
                </View>
              ) : null}
            </View>
            <Text className="mt-1.5 text-center text-[11px] font-medium text-ink-700" numberOfLines={2}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

    </>
  );
  const todayEl = (
    <>
      {sectionTitle(day.label ? `Today · ${day.label}` : "Today")}
      <View className="rounded-2xl border border-ink-100 bg-white p-3.5">
        {focus ? (
          <>
            <View className="flex-row items-center gap-3 rounded-xl bg-[#F5F8FF] p-3">
              <View className="items-center">
                <Text className="text-[15px] font-bold tabular-nums text-[#1F45C7]">{focus.start || focus.period}</Text>
                {focus.end ? <Text className="text-[11px] tabular-nums text-ink-500">{focus.end}</Text> : null}
              </View>
              <View className="h-9 w-px bg-[#C7D7FE]" />
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-1.5">
                  {current ? <InProgressDot /> : null}
                  <Text className={`text-[11px] font-semibold uppercase tracking-wide ${current ? "text-[#1F45C7]" : "text-ink-500"}`}>
                    {current ? "In class now" : "Up next"}
                  </Text>
                </View>
                <Text className="mt-0.5 text-[16px] font-semibold text-ink-900" numberOfLines={1}>
                  {focus.subject}
                </Text>
                <Text className="text-[12px] text-ink-500" numberOfLines={1}>
                  {[focus.teacher, focus.room].filter(Boolean).join(" · ") || " "}
                </Text>
              </View>
            </View>
            {(() => {
              const rest = left.filter((p) => p !== focus);
              if (!rest.length) return null;
              const shown = rest.slice(0, 4);
              return (
                <View className="mt-2">
                  {shown.map((p) => (
                    <View key={`${p.period}-${p.start}-${p.subject}`} className="flex-row items-center gap-3 border-t border-ink-50 px-1 py-2.5">
                      <Text className="w-12 text-[12px] tabular-nums text-ink-500">{p.start || p.period}</Text>
                      <View className="h-5 w-1 rounded-full" style={{ backgroundColor: subjectColor(p.subject) }} />
                      <Text className="min-w-0 flex-1 text-[14px] font-medium text-ink-900" numberOfLines={1}>
                        {p.subject}
                      </Text>
                      {p.teacher ? (
                        <Text className="max-w-[40%] text-[12px] text-ink-500" numberOfLines={1}>
                          {p.teacher}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                  {rest.length > shown.length ? (
                    <Pressable onPress={() => router.push("/timetable" as never)} className="border-t border-ink-50 px-1 pt-2.5">
                      <Text className="text-[13px] font-semibold text-[#1F45C7]">
                        +{rest.length - shown.length} more class{rest.length - shown.length === 1 ? "" : "es"} today
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })()}
          </>
        ) : (
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-ink-50">
              <Ionicons name={day.periods.length ? "checkmark-done" : "cafe-outline"} size={20} color="#64748B" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[14px] font-semibold text-ink-900">
                {day.periods.length ? "Classes are over for today" : "No classes today"}
              </Text>
              <Text className="mt-0.5 text-[12px] text-ink-500" numberOfLines={1}>
                {later ? `Next: ${later.subject} · ${later.dayLabel}${later.start ? ` ${later.start}` : ""}` : "Enjoy the break."}
              </Text>
            </View>
          </View>
        )}
      </View>

    </>
  );
  const upcomingExams = (data?.upcoming ?? [])
    .map((e) => {
      const at = Date.parse(String(e.date || "").replace(/Sept/g, "Sep"));
      const days = Number.isFinite(at) ? Math.ceil((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000) : null;
      return { ...e, at, days };
    })
    .filter((e) => e.days == null || e.days >= 0)
    .sort((x, y) => (Number.isFinite(x.at) ? x.at : Infinity) - (Number.isFinite(y.at) ? y.at : Infinity));
  const whenLabel = (days: number | null) => (days == null ? "" : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`);
  const testsEl = (
    <>
      {sectionTitle("Upcoming exams", wide && upcomingExams.length ? { label: "Exams", onPress: () => router.push("/tests" as never) } : undefined)}
      <View className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
        {upcomingExams.length ? (
          upcomingExams.slice(0, 4).map((e, i) => {
            const soon = e.days != null && e.days <= 3;
            const d = Number.isFinite(e.at) ? new Date(e.at) : null;
            return (
              <View key={e.id} className={`flex-row items-center gap-3 px-3.5 py-3 ${i ? "border-t border-ink-100" : ""}`}>
                <View className={`h-11 w-11 items-center justify-center rounded-xl ${soon ? "bg-[#FDECEC]" : "bg-[#F3EEFF]"}`}>
                  {d ? (
                    <>
                      <Text className={`text-[15px] font-bold leading-4 ${soon ? "text-[#B42318]" : "text-[#6D28D9]"}`}>{d.getDate()}</Text>
                      <Text className={`text-[10px] font-semibold uppercase ${soon ? "text-[#B42318]" : "text-[#6D28D9]"}`}>
                        {d.toLocaleDateString("en-IN", { month: "short" })}
                      </Text>
                    </>
                  ) : (
                    <Ionicons name="create-outline" size={17} color="#6D28D9" />
                  )}
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-[14px] font-semibold text-ink-900" numberOfLines={1}>
                    {e.subject || e.title}
                  </Text>
                  <Text className="text-[12px] text-ink-500" numberOfLines={1}>
                    {[e.seriesName || e.title, (e as { time?: string }).time].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                {e.days != null ? (
                  <View className={`rounded-full px-2 py-0.5 ${soon ? "bg-[#FDECEC]" : "bg-ink-100"}`}>
                    <Text className={`text-[11px] font-semibold ${soon ? "text-[#B42318]" : "text-ink-600"}`}>{whenLabel(e.days)}</Text>
                  </View>
                ) : null}
              </View>
            );
          })
        ) : (
          <View className="flex-row items-center gap-3 p-3.5">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#F3EEFF]">
              <Ionicons name="calendar-clear-outline" size={19} color="#6D28D9" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[14px] font-semibold text-ink-900">No exams scheduled yet</Text>
              <Text className="mt-0.5 text-[12px] text-ink-500">Dates show here as soon as the school publishes them.</Text>
            </View>
          </View>
        )}
        {upcomingExams.length > 4 ? (
          <Pressable onPress={() => router.push("/tests" as never)} className="border-t border-ink-100 px-3.5 py-2.5">
            <Text className="text-[13px] font-semibold text-[#1F45C7]">+{upcomingExams.length - 4} more papers</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
  const recentExams = (() => {
    const groups = new Map<string, { name: string; at: number; marks: number; max: number; papers: number }>();
    for (const t of child?.tests ?? []) {
      const key = t.seriesId || t.seriesName || (t.title || "").split(/\s*[·•|]\s*/)[0] || "Exam";
      const name = t.seriesName || (t.title || "").split(/\s*[·•|]\s*/)[0] || "Exam";
      const at = Date.parse(String(t.date || "").replace(/Sept/g, "Sep"));
      const g = groups.get(key) || { name, at: 0, marks: 0, max: 0, papers: 0 };
      g.papers += 1;
      if (!t.absent && t.max > 0) {
        g.marks += t.marks;
        g.max += t.max;
      }
      if (Number.isFinite(at) && at > g.at) g.at = at;
      groups.set(key, g);
    }
    return [...groups.values()].sort((x, y) => y.at - x.at).slice(0, 3);
  })();
  const recentEl = (
    <>
      {sectionTitle("Recent exams")}
      <View className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
        {recentExams.length ? (
          recentExams.map((g, i) => {
            const pct = g.max ? Math.round((g.marks / g.max) * 100) : null;
            const tone = pct == null ? "#64748B" : pct >= 75 ? "#18794E" : pct >= 50 ? "#B45309" : "#B42318";
            return (
              <Pressable key={`${g.name}-${i}`} onPress={() => router.push("/tests" as never)} className={`flex-row items-center gap-3 px-3.5 py-3 ${i ? "border-t border-ink-100" : ""}`}>
                <View className="h-11 w-11 items-center justify-center rounded-xl bg-[#ECF8F0]">
                  <Ionicons name="ribbon-outline" size={19} color="#18794E" />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-[14px] font-semibold text-ink-900" numberOfLines={1}>{g.name}</Text>
                  <Text className="text-[12px] text-ink-500" numberOfLines={1}>
                    {[g.at ? new Date(g.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "", `${g.papers} subject${g.papers === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <Text className="text-[16px] font-bold" style={{ color: tone }}>{pct == null ? "—" : `${pct}%`}</Text>
                <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
              </Pressable>
            );
          })
        ) : (
          <View className="flex-row items-center gap-3 p-3.5">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#ECF8F0]">
              <Ionicons name="ribbon-outline" size={19} color="#18794E" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[14px] font-semibold text-ink-900">No results yet</Text>
              <Text className="mt-0.5 text-[12px] text-ink-500">Results appear once the school publishes them.</Text>
            </View>
          </View>
        )}
      </View>
    </>
  );
  const noticesEl = (
    <>
      {sectionTitle("Notices", { label: "See all", onPress: () => router.push("/notices" as never) })}
      <View className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
        {notices.length ? (
          notices.map((n, i) => (
            <Pressable
              key={n.id}
              onPress={() => router.push("/notices" as never)}
              className={`flex-row items-center gap-3 px-3.5 py-3 ${i ? "border-t border-ink-100" : ""}`}
            >
              <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#FFF4E5]">
                <Ionicons name="megaphone-outline" size={17} color="#C2410C" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[14px] font-medium text-ink-900" numberOfLines={1}>
                  {n.title}
                </Text>
                <Text className="text-[12px] text-ink-500" numberOfLines={1}>
                  {n.createdAt}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
            </Pressable>
          ))
        ) : (
          <Text className="px-3.5 py-4 text-[13px] text-ink-500">No notices yet. School updates will show here.</Text>
        )}
      </View>

    </>
  );
  const switcherEl = (
    <>
      <ParentDetailsSheet open={detailsOpen} onClose={() => setDetailsOpen(false)} data={details.data} onChanged={details.reload} />
      <RnModal visible={switchOpen} transparent animationType={wide ? "fade" : "slide"} onRequestClose={() => setSwitchOpen(false)}>
        <View className={`flex-1 ${wide ? "items-center justify-center px-4" : "justify-end"}`}>
          <Pressable className="absolute inset-0 bg-black/40" onPress={() => setSwitchOpen(false)} />
          <View className={wide ? "w-full max-w-[420px] rounded-3xl bg-white px-5 pb-6 pt-3" : "rounded-t-3xl bg-white px-5 pb-8 pt-3"}>
            <View className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-200" />
            <Text className="mb-2 text-[17px] font-semibold text-ink-900">Switch child</Text>
            {kids.map((k) => {
              const on = (childId || child?.id) === k.id;
              return (
                <Pressable
                  key={k.id}
                  onPress={() => {
                    void setChildId(k.id);
                    setSwitchOpen(false);
                  }}
                  className={`mt-2 flex-row items-center gap-3 rounded-2xl border p-3 ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200"}`}
                >
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#1F45C7]">
                    <Text className="text-[14px] font-bold text-white">{initialsOf(k.name)}</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[15px] font-semibold text-ink-900">{k.name}</Text>
                    <Text className="text-[12px] text-ink-500">{k.classLabel}</Text>
                  </View>
                  {on ? <Ionicons name="checkmark-circle" size={22} color="#1F45C7" /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </RnModal>
    </>
  );


  // ---- extra phone sections: greeting, this week, subjects ----
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const parentFirst = (user?.name || "").split(" ")[0] || "there";
  const childFirst = (child?.name || "").split(" ")[0] || "your child";
  const weekCal = calendarFrom(data?.calendar?.holidays, data?.calendar?.weekdays ?? data?.timetable?.weekdays);
  const todayKey = ymd(new Date());
  const markByDate = new Map<string, string>();
  for (const r of attRows) {
    const key = r.rawDate || (() => {
      const d = new Date(r.date);
      return Number.isNaN(+d) ? "" : ymd(d);
    })();
    if (key) markByDate.set(key, (r.status || "").toUpperCase());
  }
  const mondayOffset = (new Date().getDay() + 6) % 7;
  const monday = addDays(todayKey, -mondayOffset);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d, i) => i < 6 || !closedReason(d, weekCal));
  const weekCells = weekDays.map((d) => {
    const closed = closedReason(d, weekCal);
    const mark = markByDate.get(d) || "";
    const future = d > todayKey;
    const kind = closed ? (/off$/i.test(closed) ? "off" : "holiday") : future ? "future" : mark === "PRESENT" || mark === "IN" ? "present" : mark === "ABSENT" || mark === "OUT" ? "absent" : mark === "LATE" ? "late" : mark === "LEAVE" ? "leave" : "none";
    return { d, kind, label: new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 1), n: Number(d.slice(8)), today: d === todayKey };
  });
  const schoolSoFar = weekCells.filter((c) => ["present", "absent", "late", "leave", "none"].includes(c.kind));
  const presentSoFar = weekCells.filter((c) => c.kind === "present" || c.kind === "late").length;
  const WEEK_STYLE: Record<string, { bg: string; icon?: React.ComponentProps<typeof Ionicons>["name"]; color: string }> = {
    present: { bg: "bg-[#2BB673]", icon: "checkmark", color: "#fff" },
    late: { bg: "bg-[#F59E0B]", icon: "time", color: "#fff" },
    absent: { bg: "bg-[#E5484D]", icon: "close", color: "#fff" },
    leave: { bg: "bg-[#3B82F6]", icon: "airplane", color: "#fff" },
    holiday: { bg: "bg-[#EDE9FE]", icon: "sunny", color: "#7C3AED" },
    off: { bg: "bg-ink-100", color: "#94A3B8" },
    future: { bg: "bg-white border border-dashed border-ink-200", color: "#CBD5E1" },
    none: { bg: "bg-white border border-ink-200", color: "#CBD5E1" },
  };
  const subjectRows = (child?.subjects ?? [])
    .filter((x) => x.n > 0)
    .slice()
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);
  const latestTest = (child?.tests ?? []).find((t) => !t.absent) || null;

  const greetingEl = (
    <View className="mb-3 px-1">
      <Text className="text-[22px] font-bold text-ink-900">{greeting}, {parentFirst}</Text>
      <Text className="mt-0.5 text-[13px] text-ink-500">
        {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
      </Text>
    </View>
  );

  const todayClosed = closedReason(todayKey, weekCal);
  const todayMark = markByDate.get(todayKey) || "";
  const todayKind = todayClosed
    ? /off$/i.test(todayClosed) ? "off" : "holiday"
    : todayMark === "PRESENT" || todayMark === "IN" ? "present" : todayMark === "ABSENT" || todayMark === "OUT" ? "absent" : todayMark === "LATE" ? "late" : todayMark === "LEAVE" ? "leave" : "none";
  const TODAY_TEXT: Record<string, { title: string; sub: string; tone: string }> = {
    present: { title: "Present", sub: `${childFirst} is in school today`, tone: "text-[#18794E]" },
    late: { title: "Late", sub: `${childFirst} reached school late today`, tone: "text-[#B45309]" },
    absent: { title: "Absent", sub: `${childFirst} was marked absent today`, tone: "text-[#B42318]" },
    leave: { title: "On leave", sub: "Leave approved for today", tone: "text-[#1D4ED8]" },
    holiday: { title: "Holiday", sub: todayClosed || "School is closed today", tone: "text-[#6D28D9]" },
    off: { title: "No school", sub: todayClosed || "Weekly off", tone: "text-ink-500" },
    none: { title: "Not marked yet", sub: "The class teacher hasn't taken attendance yet", tone: "text-ink-500" },
  };
  const todayStyle = WEEK_STYLE[todayKind] || WEEK_STYLE.none;
  const weekEl = (
    <>
      {sectionTitle("Attendance today", wide ? { label: "Attendance", onPress: () => router.push("/attendance" as never) } : undefined)}
      <Pressable onPress={() => router.push("/attendance" as never)} className="flex-row items-center gap-3 rounded-2xl border border-ink-100 bg-white p-3.5">
        <View className={`h-10 w-10 items-center justify-center rounded-full ${todayStyle.bg}`}>
          {todayStyle.icon ? <Ionicons name={todayStyle.icon} size={18} color={todayStyle.color} /> : <Ionicons name="time-outline" size={18} color="#94A3B8" />}
        </View>
        <View className="min-w-0 flex-1">
          <Text className={`text-[15px] font-semibold ${TODAY_TEXT[todayKind].tone}`}>{TODAY_TEXT[todayKind].title}</Text>
          <Text className="mt-0.5 text-[12px] text-ink-500" numberOfLines={1}>{TODAY_TEXT[todayKind].sub}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
      </Pressable>
    </>
  );

  const subjectsEl = subjectRows.length ? (
    <>
      {sectionTitle(`How ${childFirst} is doing`, wide ? { label: "Results", onPress: () => router.push("/tests" as never) } : undefined)}
      <View className="rounded-2xl border border-ink-100 bg-white p-3.5">
        {latestTest ? (
          <View className="mb-3 flex-row items-center gap-3 rounded-xl bg-[#F5F8FF] p-3">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-white">
              <Ionicons name="ribbon-outline" size={19} color="#1F45C7" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Latest result</Text>
              <Text className="text-[14px] font-semibold text-ink-900" numberOfLines={1}>
                {latestTest.subject}
                {latestTest.title ? <Text className="font-normal text-ink-500"> · {latestTest.title}</Text> : null}
              </Text>
            </View>
            <Text className="text-[16px] font-bold text-[#1F45C7]">
              {latestTest.marks}/{latestTest.max}
            </Text>
          </View>
        ) : null}
        {subjectRows.map((x, i) => {
          const tone = x.pct >= 75 ? "#2BB673" : x.pct >= 50 ? "#F59E0B" : "#E5484D";
          return (
            <View key={x.name} className={i ? "mt-3" : ""}>
              <View className="flex-row items-center justify-between">
                <Text className="text-[13px] font-medium text-ink-800" numberOfLines={1}>{x.name}</Text>
                <Text className="text-[13px] font-semibold" style={{ color: tone }}>{x.pct}%</Text>
              </View>
              <View className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100">
                <View className="h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, x.pct))}%`, backgroundColor: tone }} />
              </View>
            </View>
          );
        })}
      </View>
    </>
  ) : null;

  if (wide) {
    const stats = [
      { label: "Attendance", value: attRows.length ? `${att.pct}%` : "—", go: "/attendance" },
      { label: "Last result", value: lastPct == null ? "—" : `${lastPct}%`, go: "/tests" },
      { label: totalDue ? "Fees due" : "Fees", value: totalDue ? money(totalDue) : "Paid", go: "/fees" },
    ];
    return (
      <View className="pb-8">
        <View className="flex-row flex-wrap items-center gap-5 rounded-3xl bg-[#1F45C7] px-6 py-5">
          <View className="min-w-[240px] flex-1 flex-row items-center gap-4">
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-white/15">
              <Text className="text-[20px] font-bold text-white">{initialsOf(child?.name || "")}</Text>
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[22px] font-bold text-white" numberOfLines={1}>
                {child?.name || "No child linked"}
              </Text>
              <Text className="mt-0.5 text-[13px] text-white/75" numberOfLines={1}>
                {child ? studentMetaLine(child) : "Ask the school to link your child."}
              </Text>
            </View>
          </View>
          <View className="flex-row">
            {stats.map((st, i) => (
              <Pressable key={st.label} onPress={() => router.push(st.go as never)} className={`px-5 ${i ? "border-l border-white/20" : ""}`}>
                <Text className="text-[22px] font-bold text-white">{st.value}</Text>
                <Text className="mt-0.5 text-[12px] text-white/70">{st.label}</Text>
              </Pressable>
            ))}
          </View>
          <View className="flex-row gap-2">
            {kids.length > 1 ? (
              <Pressable onPress={() => setSwitchOpen(true)} className="h-10 flex-row items-center gap-1.5 rounded-xl bg-white/15 px-3.5">
                <Ionicons name="swap-horizontal" size={16} color="#fff" />
                <Text className="text-[13px] font-semibold text-white">Switch child</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onMessage} className="h-10 flex-row items-center gap-1.5 rounded-xl bg-white px-3.5">
              <Ionicons name="paper-plane-outline" size={15} color="#1F45C7" />
              <Text className="text-[13px] font-semibold text-[#1F45C7]">Message school</Text>
            </Pressable>
          </View>
        </View>

        <View className="mt-1 flex-row items-start gap-6">
          <View style={{ flex: 3, minWidth: 0 }}>
            {sectionTitle(day.label ? `Today · ${day.label}` : "Today", { label: "Full timetable", onPress: () => router.push("/timetable" as never) })}
            <View className="overflow-hidden rounded-2xl border border-ink-100 bg-white py-1">
              {day.periods.length ? (
                day.periods.map((p, i) => {
                  const phase = periodPhase(p, nowMins);
                  const isFocus = p === focus;
                  const color = subjectColor(p.subject);
                  return (
                    <View
                      key={`${p.period}-${p.start}-${p.subject}`}
                      className={`flex-row items-center gap-4 px-4 py-3 ${i ? "border-t border-ink-50" : ""} ${isFocus ? "bg-[#F5F8FF]" : ""}`}
                      style={{ opacity: phase === "done" ? 0.55 : 1 }}
                    >
                      <View className="w-14">
                        <Text className={`text-[14px] font-semibold tabular-nums ${isFocus ? "text-[#1F45C7]" : "text-ink-900"}`}>{p.start || p.period}</Text>
                        {p.end ? <Text className="text-[11px] tabular-nums text-ink-500">{p.end}</Text> : null}
                      </View>
                      <View className="h-9 w-1 rounded-full" style={{ backgroundColor: color }} />
                      <View className="min-w-0 flex-1">
                        <Text className="text-[15px] font-semibold text-ink-900" numberOfLines={1}>
                          {p.subject}
                        </Text>
                        <Text className="text-[12px] text-ink-500" numberOfLines={1}>
                          {p.teacher || " "}
                        </Text>
                      </View>
                      {phase === "done" ? (
                        <Text className="text-[12px] font-medium text-[#18794E]">Done</Text>
                      ) : phase === "now" ? (
                        <View className="flex-row items-center gap-1.5 rounded-full bg-[#1F45C7] px-2.5 py-1">
                          <View className="h-1.5 w-1.5 rounded-full bg-white" />
                          <Text className="text-[11px] font-bold text-white">In class now</Text>
                        </View>
                      ) : isFocus ? (
                        <View className="rounded-full bg-[#EEF3FF] px-2.5 py-1">
                          <Text className="text-[11px] font-bold text-[#1F45C7]">Up next</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })
              ) : (
                <View className="flex-row items-center gap-3 p-4">
                  <Ionicons name="cafe-outline" size={20} color="#64748B" />
                  <Text className="text-[14px] text-ink-600">
                    No classes today{later ? ` · Next: ${later.subject}, ${later.dayLabel}${later.start ? ` ${later.start}` : ""}` : ""}
                  </Text>
                </View>
              )}
            </View>
            {testsEl}
            {recentEl}
          </View>
          <View style={{ flex: 2, minWidth: 0 }}>
            {totalDue || inbox.reply || detailsDue ? (
              <>
                {sectionTitle("Needs attention")}
                <View className="-mt-4">{attentionEl}</View>
              </>
            ) : null}
            {weekEl}
            {noticesEl}
          </View>
        </View>
        {switcherEl}
      </View>
    );
  }

  return (
    <View className="pb-6">
      {greetingEl}
      {heroEl}
      {attentionEl}
      {quickEl}
      {todayEl}
      {testsEl}
      {recentEl}
      {weekEl}
      {noticesEl}
      {switcherEl}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Parent fees on phones: one total, grouped by child, tap for detail.  */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

function daysLate(inv: FeeInv) {
  const at = Date.parse(inv.dueAt || "");
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.floor((Date.now() - at) / DAY_MS));
}

function lateFeeOf(inv: FeeInv) {
  return Math.max(0, Math.round(dueOf(inv) - amountOf(inv.remaining)));
}

/** "Aisha Sharma · September 2026 · Monthly fee" → { month: "September 2026", kind: "Monthly fee" } */
function splitFeeTitle(title: string, childName: string) {
  const parts = title
    .split("·")
    .map((p) => p.trim())
    .filter((p) => p && p !== childName);
  return { month: parts[0] || title, kind: parts.slice(1).join(" · ") };
}

function FeesPhoneView({
  groups,
  openInvoices,
  paidInvoices,
  picked,
  setPicked,
  busy,
  onPay,
  onOpen,
}: {
  groups: { id: string; name: string; classLabel: string; open: StatementFee[]; paid: StatementFee[] }[];
  openInvoices: StatementFee[];
  paidInvoices: StatementFee[];
  picked: string[];
  setPicked: (ids: string[] | ((cur: string[]) => string[])) => void;
  busy: boolean;
  onPay: () => void;
  onOpen: (url?: string, title?: string) => void;
}) {
  const [tab, setTab] = useState<"due" | "receipts">("due");
  const [choosing, setChoosing] = useState(false);
  const [expanded, setExpanded] = useState<string>("");

  const totalDue = openInvoices.reduce((n, inv) => n + dueOf(inv), 0);
  const selected = openInvoices.filter((inv) => picked.includes(inv.id));
  const selectedDue = selected.reduce((n, inv) => n + dueOf(inv), 0);
  const overdue = openInvoices.filter((inv) => inv.display === "overdue");
  const oldest = overdue.slice().sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];
  const nextUp = openInvoices
    .filter((inv) => inv.display !== "overdue")
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];
  const months = openInvoices.length;

  function stopChoosing() {
    setChoosing(false);
    setPicked(openInvoices.map((inv) => inv.id));
  }

  const payText = busy
    ? "Opening payment…"
    : choosing
      ? selected.length
        ? `Pay ${rupees(selectedDue)} for ${selected.length} month${selected.length === 1 ? "" : "s"}`
        : "Pick at least one month"
      : `Pay ${rupees(totalDue)}`;

  const initials = (name: string) =>
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("");

  return (
    <View className="pb-6">
      <Text className="mb-3 text-[22px] font-semibold text-ink-900">Fees</Text>

      {/* Hero */}
      <View className="rounded-3xl border border-ink-100 bg-white p-4">
        {totalDue > 0 ? (
          <>
            <Text className="text-[13px] font-medium text-ink-500">Total due</Text>
            <Text className="mt-0.5 text-[32px] font-bold leading-10 text-ink-900">{rupees(totalDue)}</Text>
            <View className="mt-1 flex-row items-center gap-1.5">
              {oldest ? <View className="h-2 w-2 rounded-full bg-[#E5484D]" /> : null}
              <Text className={`text-[13px] font-medium ${oldest ? "text-[#B42318]" : "text-ink-600"}`}>
                {months} month{months === 1 ? "" : "s"}
                {oldest ? ` · overdue since ${shortDate(oldest.dueAt)}` : nextUp ? ` · due by ${shortDate(nextUp.dueAt)}` : ""}
              </Text>
            </View>
            <Pressable
              onPress={onPay}
              disabled={busy || (choosing && !selected.length)}
              className={`mt-4 h-12 items-center justify-center rounded-2xl ${busy || (choosing && !selected.length) ? "bg-ink-200" : "bg-[#1F45C7]"}`}
            >
              <Text className={`text-[16px] font-semibold ${busy || (choosing && !selected.length) ? "text-ink-500" : "text-white"}`}>{payText}</Text>
            </Pressable>
            {months > 1 ? (
              <Pressable onPress={() => (choosing ? stopChoosing() : (setChoosing(true), setTab("due")))} className="mt-3 items-center" hitSlop={8}>
                <Text className="text-[13px] font-semibold text-[#1F45C7]">{choosing ? "Pay everything instead" : "Pay for selected months only"}</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-[#ECF8F0]">
              <Ionicons name="checkmark-circle" size={26} color="#18794E" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[17px] font-semibold text-ink-900">All paid up</Text>
              <Text className="mt-0.5 text-[13px] text-ink-500">Nothing due right now. Receipts are below.</Text>
            </View>
          </View>
        )}
      </View>

      {/* Tabs */}
      <View className="mt-4 flex-row rounded-xl bg-ink-100 p-1">
        {([
          { id: "due", label: `Due${months ? ` · ${months}` : ""}` },
          { id: "receipts", label: `Receipts${paidInvoices.length ? ` · ${paidInvoices.length}` : ""}` },
        ] as const).map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} className={`h-9 flex-1 items-center justify-center rounded-lg ${tab === t.id ? "bg-white" : ""}`}>
            <Text className={`text-[13px] font-semibold ${tab === t.id ? "text-ink-900" : "text-ink-500"}`}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {choosing && tab === "due" ? (
        <Text className="mt-3 text-[12px] text-ink-500">Tick the months you want to pay now. Older months first is best.</Text>
      ) : null}

      {/* Lists, one card per child */}
      {groups.map((g) => {
        const rows = tab === "due" ? g.open : g.paid;
        if (!rows.length) return null;
        const childDue = g.open.reduce((n, inv) => n + dueOf(inv), 0);
        return (
          <View key={g.id} className="mt-4">
            <View className="mb-2 flex-row items-center gap-2.5">
              <View className="h-8 w-8 items-center justify-center rounded-xl bg-[#EEF3FF]">
                <Text className="text-[12px] font-bold text-[#1F45C7]">{initials(g.name)}</Text>
              </View>
              <Text className="min-w-0 flex-1 text-[15px] font-semibold text-ink-900" numberOfLines={1}>
                {g.name}
                {g.classLabel ? <Text className="font-normal text-ink-500"> · {g.classLabel}</Text> : null}
              </Text>
              {tab === "due" ? <Text className="text-[14px] font-semibold text-ink-900">{rupees(childDue)}</Text> : null}
            </View>
            <View className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
              {rows.map((inv, i) => {
                const { month, kind } = splitFeeTitle(inv.title, g.name);
                const open = expanded === inv.id;
                const late = inv.display === "overdue" ? daysLate(inv) : 0;
                const lateFee = lateFeeOf(inv);
                const on = picked.includes(inv.id);
                const paidSoFar = amountOf(inv.paid);
                return (
                  <View key={inv.id} className={i ? "border-t border-ink-100" : ""}>
                    <Pressable
                      onPress={() => (choosing && tab === "due" ? setPicked((cur) => (on ? cur.filter((id) => id !== inv.id) : [...cur, inv.id])) : setExpanded(open ? "" : inv.id))}
                      className="flex-row items-center gap-3 px-3.5 py-3"
                    >
                      {choosing && tab === "due" ? (
                        <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? "#1F45C7" : "#CBD5E1"} />
                      ) : null}
                      <View className="min-w-0 flex-1">
                        <Text className="text-[15px] font-semibold text-ink-900" numberOfLines={1}>
                          {month}
                        </Text>
                        <Text className="mt-0.5 text-[12px] text-ink-500" numberOfLines={1}>
                          {tab === "due" ? kind || "Fee" : `Paid ${inv.paid}${kind ? ` · ${kind}` : ""}`}
                        </Text>
                      </View>
                      <View className="items-end">
                        <Text className="text-[15px] font-semibold text-ink-900">{tab === "due" ? rupees(dueOf(inv)) : inv.amount}</Text>
                        {tab === "due" ? (
                          late ? (
                            <View className="mt-1 rounded-full bg-[#FDECEC] px-2 py-0.5">
                              <Text className="text-[11px] font-semibold text-[#B42318]">{late} day{late === 1 ? "" : "s"} late</Text>
                            </View>
                          ) : (
                            <Text className="mt-1 text-[11px] text-ink-500">Due {shortDate(inv.dueAt)}</Text>
                          )
                        ) : (
                          <View className="mt-1 rounded-full bg-[#ECF8F0] px-2 py-0.5">
                            <Text className="text-[11px] font-semibold text-[#18794E]">Paid</Text>
                          </View>
                        )}
                      </View>
                      {!choosing || tab !== "due" ? (
                        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color="#94A3B8" />
                      ) : null}
                    </Pressable>
                    {open && !(choosing && tab === "due") ? (
                      <View className="mx-3.5 mb-3 rounded-xl bg-ink-50 p-3">
                        {inv.lines.map((line) => {
                          const m = line.match(/^(.*)\s(₹[\d,.]+)$/);
                          return (
                            <View key={line} className="flex-row justify-between py-0.5">
                              <Text className="text-[13px] text-ink-600">{m ? m[1] : line}</Text>
                              <Text className="text-[13px] text-ink-800">{m ? m[2] : ""}</Text>
                            </View>
                          );
                        })}
                        {lateFee ? (
                          <View className="flex-row justify-between py-0.5">
                            <Text className="text-[13px] text-[#B42318]">Late fee{late ? ` (${late} days)` : ""}</Text>
                            <Text className="text-[13px] text-[#B42318]">{rupees(lateFee)}</Text>
                          </View>
                        ) : null}
                        {paidSoFar && tab === "due" ? (
                          <View className="flex-row justify-between py-0.5">
                            <Text className="text-[13px] text-[#18794E]">Paid so far</Text>
                            <Text className="text-[13px] text-[#18794E]">−{inv.paid}</Text>
                          </View>
                        ) : null}
                        <View className="mt-1.5 flex-row justify-between border-t border-ink-200 pt-1.5">
                          <Text className="text-[13px] font-semibold text-ink-900">{tab === "due" ? "To pay" : "Total paid"}</Text>
                          <Text className="text-[13px] font-semibold text-ink-900">{tab === "due" ? rupees(dueOf(inv)) : inv.paid}</Text>
                        </View>
                        <View className="mt-3 flex-row gap-2">
                          {inv.invoiceUrl ? (
                            <Pressable onPress={() => onOpen(inv.invoiceUrl, `Invoice · ${month}`)} className="h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-white">
                              <Ionicons name="document-text-outline" size={15} color="#1F45C7" />
                              <Text className="text-[13px] font-semibold text-[#1F45C7]">Invoice</Text>
                            </Pressable>
                          ) : null}
                          {inv.receiptUrl ? (
                            <Pressable onPress={() => onOpen(inv.receiptUrl, `Receipt · ${month}`)} className="h-9 flex-1 flex-row items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-white">
                              <Ionicons name="receipt-outline" size={15} color="#18794E" />
                              <Text className="text-[13px] font-semibold text-[#18794E]">Receipt</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}

      {tab === "receipts" && !paidInvoices.length ? (
        <View className="mt-8 items-center px-6">
          <Ionicons name="receipt-outline" size={30} color="#CBD5E1" />
          <Text className="mt-2 text-center text-[14px] font-semibold text-ink-700">No receipts yet</Text>
          <Text className="mt-1 text-center text-[12px] text-ink-500">Once you pay, your receipts show up here to download any time.</Text>
        </View>
      ) : null}
      {tab === "due" && !openInvoices.length && paidInvoices.length ? (
        <Text className="mt-6 text-center text-[13px] text-ink-500">Nothing due. See your receipts in the other tab.</Text>
      ) : null}
    </View>
  );
}
