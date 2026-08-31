import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Linking, Modal as RnModal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { DateField } from "./date-field";
import { Badge, Button, Card, Chip, ChipScroller, CloseButton, Empty, Field, Input, Modal, PageHeader, Stat, Toast, useToast } from "./ui";
import { act } from "../lib/mutate";
import { webOrigin } from "../lib/api";
import {
  attendanceCbseNote,
  attendanceCountLine,
  attendanceHint,
  attendanceSummary,
  lastAttendanceDots,
  todayMark,
  todayMarkLabel,
} from "../lib/attendance-summary";
import { addDays, calendarFrom, closedCaption, closedReason, ymd, type SchoolCalendar } from "../lib/calendar";
import { AttendanceDots, DayMark, OnLeaveSign } from "./attendance-mark";
import { useRecord, type RecordPayload } from "../lib/record";
import { useSession } from "../lib/session";
import { ExamTodoCard, TeacherMarksModal, examTodoKind, examTodoTone } from "./exam-teacher-work";
import { ReportCardSheet } from "./report-card-sheet";
import { LeaveApplyCard, LeaveDecideList } from "./leave-apply";
import { ManagerPicker } from "./manager-picker";

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

function ChildSwitch() {
  const { data, childId, setChildId } = useRecord();
  const kids = data?.children ?? [];
  const child = data?.child;
  const triggerRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState({ x: 0, y: 0, w: 220 });
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

  function toggle() {
    if (!many) return;
    const node = triggerRef.current;
    if (!node?.measureInWindow) {
      setMenu({ x: 24, y: 88, w: 220 });
      setOpen(true);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      const screen = Dimensions.get("window");
      const width = Math.min(240, Math.max(200, w || 220));
      const left = Math.min(Math.max(8, x), screen.width - width - 8);
      const top = Math.min(y + h + 4, screen.height - 180);
      setMenu({ x: left, y: top, w: width });
      setOpen(true);
    });
  }

  return (
    <View collapsable={false} ref={triggerRef} style={{ width: 220 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Switch child"
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        className="h-[42px] flex-row items-center rounded-lg border border-ink-200 bg-white px-3"
      >
        <Text className="min-w-0 flex-1 text-[13px] font-medium text-ink-900" numberOfLines={1}>
          {child ? `${child.name} · Class ${child.classLabel}` : "Select child"}
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
                const adm = on && child?.id === c.id ? child.admissionNo : "";
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
                      Class {c.classLabel}
                      {adm ? ` · ${adm}` : ""}
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
  const pinRegister = Boolean(data?.classTeacher && !data.markedToday && !todayClosed && new Date().getHours() < 10);
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

  const team = data?.team;
  const teamLeave = (data?.pendingLeave ?? []).filter((r) => r.who === "teacher" || r.who === "staff");

  return (
    <View>
      <View className="mb-4 flex-row flex-wrap items-end justify-between gap-2">
        <View>
          <Text className="text-xs font-medium uppercase tracking-wide text-clay-600">Teacher desk</Text>
          <Text className="mt-1 text-xl font-semibold text-ink-900">{greeting}</Text>
        </View>
        <Text className="text-xs text-ink-700">Live school overview</Text>
      </View>

      <View className={`mb-4 ${wideDashboard ? "flex-row gap-3" : "flex-row flex-wrap gap-3"}`}>
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
      </View>

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

      <View className={`mb-4 gap-4 ${wideDashboard ? "flex-row" : ""}`}>
        {pinRegister ? registerCard() : nowCard()}
        {pinRegister ? nowCard() : registerCard()}
      </View>

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

export function TeacherLeaveBoard() {
  const { data, reload } = useRecord();
  const { token } = useSession();
  const toast = useToast();
  const pending = data?.pendingLeave ?? [];
  const studentLeave = pending.filter((r) => r.who === "student");
  const teamLeave = pending.filter((r) => r.who !== "student");
  return (
    <View>
      <PageHeader kicker="Teacher" title="Leave" lede="Plan time away and track your leave requests." />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <LeaveDecideList
        rows={studentLeave}
        token={token}
        onDone={async (ok) => {
          toast.show(ok);
          await reload();
        }}
        onError={(msg) => toast.show(msg)}
      />
      <LeaveDecideList
        rows={teamLeave}
        title="Team leave requests"
        token={token}
        onDone={async (ok) => {
          toast.show(ok);
          await reload();
        }}
        onError={(msg) => toast.show(msg)}
      />
      <LeaveApplyCard
        audience="teacher"
        token={token}
        onDone={async (ok) => {
          toast.show(ok);
          await reload();
        }}
        onError={(msg) => toast.show(msg)}
      />
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
      toast.show("Saved the day.");
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
    const normalizedCodes = [clean, ...clean.split(/[/:?#&=]+/).filter(Boolean)];
    const student = roster.find((s) => {
      const admission = String((s as { admissionNo?: string }).admissionNo || "").toLowerCase();
      const id = s.id.toLowerCase();
      return normalizedCodes.includes(admission) || normalizedCodes.includes(id) || s.name.toLowerCase() === clean;
    });
    let resolved = student;
    if (!resolved && /\/(verify|documents)\//i.test(raw)) {
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
  const shown = needle ? roster.filter((s) => s.name.toLowerCase().includes(needle)) : roster;

  return (
    <View className="min-h-0 flex-1">
      <PageHeader
        kicker="Class teacher"
        title="Attendance"
        lede={data?.classLabel ? `Mark P, A or late · ${data.classLabel}.` : "Mark P, A or late."}
      />
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
        <Card className="min-h-0 flex-1">
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
                  <View key={s.id} className="gap-2 border-t border-ink-100 px-4 py-3">
                    <View className="flex-row items-center justify-between gap-3">
                      <Text className="min-w-0 flex-1 text-sm font-medium text-ink-900" numberOfLines={1}>
                        {s.name}
                      </Text>
                      {mark}
                    </View>
                    <AttendanceDots dots={dots} compact activeDate={locked ? undefined : date} />
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
              Save the day
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
    </View>
  );
}

export function TeacherExamsBoard({ uploads }: { uploads?: boolean }) {
  const { data, reload } = useRecord();
  const { token } = useSession();
  const toast = useToast();
  const [pending, setPending] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [host, setHost] = useState({ title: "", subjectId: data?.subjects?.[0]?.id || "", date: "", maxMarks: "40" });
  const [sheetId, setSheetId] = useState("");
  const todos = (data?.todos ?? []).filter((t) => examTodoKind(t) !== "skip");
  const doneWork = data?.doneWork ?? [];
  const sheets = data?.markSheets ?? [];
  const openSheet = sheets.find((s) => s.examId === sheetId) || null;
  const { width, height } = useWindowDimensions();
  const phone = width < 768;
  const openWorkMaxHeight = phone ? 420 : Math.max(300, Math.min(520, height - 480));
  const overdueCount = todos.filter((todo) => examTodoTone(todo) === "overdue").length;
  const dueSoonCount = todos.filter((todo) => examTodoTone(todo) === "soon").length;

  function openMarks(examId: string) {
    setSheetId(examId);
  }

  async function postClassTest() {
    try {
      await act(token, "hostExam", { ...host, classId: data?.classId, maxMarks: Number(host.maxMarks) });
      toast.show("Class test added. The class has a notification.");
      setShowAdd(false);
      setHost({ title: "", subjectId: host.subjectId, date: "", maxMarks: "40" });
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return (
    <View>
      <PageHeader
        kicker="Reports"
        title="Exams"
        lede="Open work first. Finished work is folded away."
        action={
          data?.classTeacher && data.classId ? (
            <Button onPress={() => setShowAdd(true)}>+ Class test</Button>
          ) : undefined
        }
      />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className={`mb-4 gap-3 ${phone ? "" : "flex-row"}`}>
        {[
          { label: "Open work", value: todos.length, hint: "Tasks requiring action", color: "text-clay-600" },
          { label: "Due soon", value: dueSoonCount, hint: "Within five days", color: "text-amber-700" },
          { label: "Overdue", value: overdueCount, hint: "Needs attention", color: overdueCount ? "text-red-600" : "text-ink-700" },
          { label: "Completed", value: doneWork.length, hint: "Folded below", color: "text-green-700" },
        ].map((stat) => (
          <Card key={stat.label} className="flex-1 p-4">
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">{stat.label}</Text>
            <Text className={`mt-1 text-2xl font-semibold ${stat.color}`}>{stat.value}</Text>
            <Text className="mt-0.5 text-xs text-ink-700">{stat.hint}</Text>
          </Card>
        ))}
      </View>

      {todos.length ? (
        <Card className="mb-4 overflow-hidden">
          <View className="flex-row items-center justify-between bg-ink-50 px-4 py-3">
            <View>
              <Text className="text-sm font-semibold text-ink-900">Open work</Text>
              <Text className="mt-0.5 text-xs text-ink-700">Complete papers or open mark sheets.</Text>
            </View>
            <Badge tone={overdueCount ? "danger" : dueSoonCount ? "warn" : "ink"}>
              {`${todos.length} ${todos.length === 1 ? "task" : "tasks"}`}
            </Badge>
          </View>
          <ScrollView
            nestedScrollEnabled
            showsVerticalScrollIndicator={todos.length > 5}
            style={{ maxHeight: openWorkMaxHeight }}
          >
            {todos.map((t) => (
              <ExamTodoCard
                key={t.id}
                todo={t}
                embedded
                pending={pending === t.id}
                onDone={
                  examTodoKind(t) === "paper"
                    ? async () => {
                        const examId = t.examId || t.id.replace(/^paper-/, "");
                        setPending(t.id);
                        try {
                          await act(token, "completeExamWork", { examId, kind: "paper" });
                          toast.show("Moved to Done. Undo it there if that was a slip.");
                          await reload();
                        } catch (e) {
                          toast.show(e instanceof Error ? e.message : "Could not save.");
                        } finally {
                          setPending("");
                        }
                      }
                    : undefined
                }
                onOpenMarks={
                  examTodoKind(t) === "marks"
                    ? () => openMarks(t.examId || t.id.replace(/^marks-/, ""))
                    : undefined
                }
              />
            ))}
          </ScrollView>
        </Card>
      ) : (
        <Empty title="Nothing waiting" body="A paper or marks task shows from five days before it is due." />
      )}
      <Card className="overflow-hidden">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showDone ? "Hide completed work" : "Show completed work"}
          onPress={() => setShowDone((v) => !v)}
          className="flex-row items-center justify-between bg-ink-50 px-4 py-3"
        >
          <View>
            <Text className="text-sm font-semibold text-ink-900">Completed work</Text>
            <Text className="mt-0.5 text-xs text-ink-700">
              {doneWork.length ? `${doneWork.length} finished` : "Nothing finished yet"}
            </Text>
          </View>
          <Ionicons name={showDone ? "chevron-up" : "chevron-down"} size={18} color="#3d4f66" />
        </Pressable>
        {showDone ? (
          doneWork.length ? (
            doneWork.map((t) => (
              <ExamTodoCard
                key={t.id}
                todo={{ ...t, kind: t.kind }}
                done
                embedded
                pending={pending === t.id}
                onUndo={
                  t.kind === "paper"
                    ? async () => {
                        setPending(t.id);
                        try {
                          await act(token, "completeExamWork", { examId: t.examId, kind: "paper", done: false });
                          toast.show("Back on Waiting.");
                          await reload();
                        } catch (e) {
                          toast.show(e instanceof Error ? e.message : "Could not save.");
                        } finally {
                          setPending("");
                        }
                      }
                    : undefined
                }
                onOpenMarks={t.kind === "marks" ? () => openMarks(t.examId) : undefined}
              />
            ))
          ) : (
            <Text className="border-t border-ink-100 px-4 py-4 text-sm text-ink-700">Finished tasks will appear here.</Text>
          )
        ) : null}
      </Card>
      <TeacherMarksModal
        sheet={openSheet}
        token={token}
        onClose={() => setSheetId("")}
        onSaved={async () => {
          toast.show("Marks saved.");
          await reload();
        }}
      />
      <Modal
        open={showAdd}
        title="Add class test"
        onClose={() => setShowAdd(false)}
        footer={
          <Button
            disabled={!host.title.trim() || !host.subjectId || !host.date}
            onPress={postClassTest}
          >
            Post class test
          </Button>
        }
      >
        <Text className="mb-4 text-sm text-ink-700">
          Parents, students, and teachers of {data?.classLabel || "this class"} will receive a notification.
        </Text>
        <View className="gap-4">
          <Field label="Test name">
            <Input
              value={host.title}
              onChangeText={(value) => setHost({ ...host, title: value })}
              placeholder="For example, Unit test 3"
            />
          </Field>
          <Field label="Subject">
            <View className="flex-row flex-wrap gap-2">
              {(data?.subjects ?? []).map((subject) => (
                <Chip
                  key={subject.id}
                  label={subject.name}
                  active={host.subjectId === subject.id}
                  onPress={() => setHost({ ...host, subjectId: subject.id })}
                />
              ))}
            </View>
          </Field>
          <Field label="Test date">
            <DateField value={host.date} onChange={(date) => setHost({ ...host, date })} />
          </Field>
        </View>
      </Modal>
    </View>
  );
}

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
  const [queryMessage, setQueryMessage] = useState("");
  const [queryBusy, setQueryBusy] = useState(false);

  function openParentQuery(mode: "teacher" | "office", opts?: { subject?: string }) {
    setQueryMode(mode);
    setQuerySubject(
      opts?.subject
        ? `Question about ${opts.subject}`
        : mode === "teacher"
          ? "Need to discuss my child"
          : "General query"
    );
    setQueryMessage("");
  }

  async function sendParentQuery() {
    if (!child || !queryMode) return;
    setQueryBusy(true);
    try {
      await act(token, "submitParentQuery", {
        studentId: child.id,
        target: queryMode,
        subject: querySubject,
        message: queryMessage,
      });
      setQueryMode(null);
      setQueryMessage("");
      toast.show(queryMode === "teacher" ? "Sent to class teacher." : "Sent to office.");
      await reload();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : "Could not send query.");
    } finally {
      setQueryBusy(false);
    }
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
      <View className="mb-4 flex-row flex-wrap items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-[22px] font-semibold leading-7 text-ink-900">{child?.name || "Parent dashboard"}</Text>
          {child ? (
            <Text className="mt-0.5 text-[13px] text-ink-500">
              Class {child.classLabel} · {child.admissionNo}
            </Text>
          ) : (
            <Text className="mt-0.5 text-[13px] text-ink-500">No child linked yet.</Text>
          )}
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <ChildSwitch />
          <Button disabled={!child} variant="ghost" className="h-[42px] rounded-lg px-3 py-2" onPress={() => openParentQuery("office")}>
            Raise query
          </Button>
        </View>
      </View>
      {(() => {
        const attRows = child?.attendance ?? [];
        const att = attendanceSummary(attRows);
        const unpaid = (child?.fees ?? []).filter((f) => f.display !== "paid" && f.dueNow > 0);
        const totalDue = unpaid.reduce((sum, f) => sum + f.dueNow, 0);
        const totalDueLabel = totalDue ? `₹${totalDue.toLocaleString("en-IN")}` : "₹0";
        const avg = child?.subjects.length
          ? Math.round(child.subjects.reduce((n, s) => n + s.pct, 0) / child.subjects.length)
          : 0;
        const subjectsWithMarks = (child?.subjects ?? []).filter((s) => s.n > 0);
        const coming = (data?.upcoming ?? []).slice(0, 4);
        const notices = (data?.notices ?? []).slice(0, 3);
        const day = data ? todaySlots(data) : { label: "", periods: [] };
        const attWord = att.pct >= 90 ? "Excellent" : att.pct >= 75 ? "On track" : att.pct ? "Needs attention" : "No data";
        const lastAtt = attRows[0];
        return (
          <>
            <Text className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500">Today</Text>
            <View className={`mb-4 gap-4 ${twoCol ? "flex-row items-stretch" : ""}`}>
              <View style={twoCol ? { flex: 11, minWidth: 0 } : { width: "100%" }}>
                <Card className="px-4 py-4" style={twoCol ? { flex: 1 } : undefined}>
                  <Text className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-500">Today's classes</Text>
                  {day.periods.length ? (
                    <View>
                      {day.periods.map((p) => {
                        const phase = periodPhase(p);
                        const row =
                          phase === "now"
                            ? "rounded-lg border-l-[3px] border-clay-500 bg-[#EEF2FF] px-2 py-2"
                            : phase === "done"
                              ? "rounded-lg bg-[#F7FBF8] px-2 py-2"
                              : "px-2 py-2";
                        return (
                          <View key={`${p.period}-${p.start}-${p.subject}`} className={`mb-0.5 flex-row items-start ${row}`}>
                            <Text className="w-[46px] pt-0.5 text-[12px] tabular-nums text-ink-500">{p.start || p.period}</Text>
                            <View className="min-w-0 flex-1">
                              <Text className="text-[14px] font-semibold text-ink-900" numberOfLines={1}>
                                {p.subject}
                              </Text>
                              <Text className="mt-0.5 text-[12px] text-ink-500" numberOfLines={1}>
                                {p.teacher || p.room || " "}
                              </Text>
                            </View>
                            {phase === "done" ? (
                              <Text className="ml-2 pt-0.5 text-[11px] font-medium text-[#18794E]">✓ Completed</Text>
                            ) : phase === "now" ? (
                              <View className="ml-2 flex-row items-center pt-0.5">
                                <InProgressDot />
                                <Text className="text-[11px] font-medium text-clay-500">In progress</Text>
                              </View>
                            ) : (
                              <Text className="ml-2 pt-0.5 text-[11px] text-ink-500">○ Upcoming</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <Text className="text-[13px] text-ink-500">No timetable for today yet.</Text>
                  )}
                  <Pressable onPress={() => router.push("/timetable")} className="mt-3 self-start">
                    <Text className="text-[13px] font-medium text-clay-500">View timetable →</Text>
                  </Pressable>
                </Card>
              </View>

              <View style={twoCol ? { flex: 9, minWidth: 0 } : { width: "100%" }}>
                <Text className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-500">Needs attention</Text>
                <View className="gap-2.5" style={twoCol ? { flex: 1, justifyContent: "flex-start" } : undefined}>
                  <Pressable onPress={() => router.push("/fees")}>
                    <Card className={`rounded-[10px] px-3.5 py-3.5 ${unpaid.length ? "border-[#F0B4B4] bg-[#FDECEC]" : ""}`}>
                      <Text className={`text-[11px] font-semibold uppercase tracking-wide ${unpaid.length ? "text-[#B42318]" : "text-ink-500"}`}>
                        {unpaid.length ? "Fees due" : "Fees"}
                      </Text>
                      <Text className="mt-1.5 text-[22px] font-semibold leading-7 text-ink-900">{totalDueLabel}</Text>
                      <Text className="mt-0.5 text-[12px] text-ink-500">
                        {unpaid.length
                          ? `${unpaid.length} month${unpaid.length === 1 ? "" : "s"} pending`
                          : "Nothing pending"}
                      </Text>
                      <Text className={`mt-2.5 text-[13px] font-medium ${unpaid.length ? "text-clay-500" : "text-ink-500"}`}>
                        {unpaid.length ? "Pay fees →" : "View fees →"}
                      </Text>
                    </Card>
                  </Pressable>

                  <Pressable onPress={() => router.push("/attendance")}>
                    <Card className="rounded-[10px] px-3.5 py-3">
                      <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Attendance</Text>
                      <View className="mt-1.5 flex-row items-end justify-between">
                        <Text className="text-[22px] font-semibold leading-7 text-ink-900">{att.pct}%</Text>
                        <Text className="mb-0.5 text-[12px] font-medium text-[#18794E]">{attWord}</Text>
                      </View>
                      <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100">
                        <View
                          className="h-1.5 rounded-full bg-[#2BB673]"
                          style={{ width: `${Math.max(att.pct ? 4 : 0, Math.min(100, att.pct))}%` }}
                        />
                      </View>
                      <Text className="mt-2 text-[12px] text-ink-500">
                        {Math.max(0, att.inDays - att.late)} Present · {att.out} Absent · {att.late} Late
                      </Text>
                      <Text className="mt-1.5 text-[13px] font-medium text-clay-500">View attendance →</Text>
                    </Card>
                  </Pressable>

                  <Pressable onPress={() => router.push("/notices")}>
                    <Card className="rounded-[10px] px-3.5 py-2.5">
                      <View className="flex-row items-center gap-1.5">
                        <Ionicons name="megaphone-outline" size={13} color="#64748B" />
                        <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">School notice</Text>
                      </View>
                      <Text className="mt-1.5 text-[14px] font-semibold leading-5 text-ink-900" numberOfLines={2}>
                        {notices[0]?.title || "No new notices"}
                      </Text>
                      <Text className="mt-0.5 text-[12px] text-ink-500">
                        {notices[0] ? notices[0].createdAt : "School updates will appear here."}
                      </Text>
                      <Text className="mt-1.5 text-[13px] font-medium text-clay-500">Read notice →</Text>
                    </Card>
                  </Pressable>
                </View>
              </View>
            </View>

            <Text className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500">Child overview</Text>
            <View className="mb-4 flex-row flex-wrap gap-3">
              <Pressable className="min-w-[140px] flex-1" onPress={() => router.push("/attendance")}>
                <Card className="px-4 py-3">
                  <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Attendance</Text>
                  <Text className="mt-1 text-[22px] font-semibold text-ink-900">{att.pct}%</Text>
                  <Text className="mt-0.5 text-[12px] text-ink-500">{attWord}</Text>
                </Card>
              </Pressable>
              <Pressable className="min-w-[140px] flex-1" onPress={() => router.push("/tests")}>
                <Card className="px-4 py-3">
                  <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Academics</Text>
                  <Text className="mt-1 text-[22px] font-semibold text-ink-900">{avg ? `${avg}%` : "—"}</Text>
                  <Text className="mt-0.5 text-[12px] text-ink-500">
                    {subjectsWithMarks.length ? `${subjectsWithMarks.length} subjects marked` : "No marks yet"}
                  </Text>
                </Card>
              </Pressable>
              <Pressable className="min-w-[140px] flex-1" onPress={() => router.push("/fees")}>
                <Card className="px-4 py-3">
                  <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Fees</Text>
                  <Text className="mt-1 text-[22px] font-semibold text-ink-900">{totalDueLabel}</Text>
                  <Text className="mt-0.5 text-[12px] text-ink-500">{unpaid.length ? "Outstanding" : "Clear"}</Text>
                </Card>
              </Pressable>
            </View>

            <Text className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-500">Upcoming</Text>
            <View className={`mb-2 gap-3 ${twoCol ? "flex-row" : ""}`}>
              <Card className={`px-4 py-3 ${twoCol ? "flex-1" : "w-full"}`}>
                <Text className="text-[14px] font-semibold text-ink-900">Tests & events</Text>
                {coming.length ? (
                  coming.map((e) => (
                    <Pressable key={e.id} onPress={() => router.push("/tests")} className="mt-2">
                      <Text className="text-[13px] font-medium text-ink-900">{e.subject || e.title}</Text>
                      <Text className="mt-0.5 text-[12px] text-ink-500">
                        {e.title} · {e.date}
                      </Text>
                    </Pressable>
                  ))
                ) : (
                  <Text className="mt-2 text-[13px] text-ink-500">No upcoming tests yet.</Text>
                )}
              </Card>
              <Card className={`px-4 py-3 ${twoCol ? "flex-1" : "w-full"}`}>
                <Text className="text-[14px] font-semibold text-ink-900">Recent activity</Text>
                {lastAtt ? (
                  <Text className="mt-2 text-[13px] text-ink-800">
                    Attendance marked · {lastAtt.status} · {lastAtt.date}
                  </Text>
                ) : (
                  <Text className="mt-2 text-[13px] text-ink-500">No attendance yet this week.</Text>
                )}
                {unpaid[0] ? <Text className="mt-1.5 text-[13px] text-ink-800">Fee invoice · {unpaid[0].title}</Text> : null}
                {notices[0] ? <Text className="mt-1.5 text-[13px] text-ink-800">Notice · {notices[0].title}</Text> : null}
              </Card>
            </View>
          </>
        );
      })()}
      <Modal
        open={Boolean(queryMode)}
        title={queryMode === "teacher" ? "Ask teacher" : "Raise query"}
        onClose={() => setQueryMode(null)}
        footer={
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={queryBusy} onPress={() => setQueryMode(null)}>
              Cancel
            </Button>
            <Button disabled={queryBusy || !querySubject.trim() || !queryMessage.trim()} onPress={() => void sendParentQuery()}>
              Send
            </Button>
          </View>
        }
      >
        <View className="gap-3">
          <Text className="text-sm text-ink-700">
            {queryMode === "teacher"
              ? "This goes to the class teacher as an in-app notification."
              : "This goes to the school office/admin as an in-app notification."}
          </Text>
          <Field label="Subject">
            <Input value={querySubject} onChangeText={setQuerySubject} />
          </Field>
          <Field label="Message" hint="Mention the problem or feedback clearly.">
            <Input value={queryMessage} onChangeText={setQueryMessage} multiline className="min-h-[120px]" />
          </Field>
        </View>
      </Modal>
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
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${day} ${style.label}`}
        onPress={onPress}
        className={`min-h-[68px] justify-between rounded-[10px] border px-1.5 py-1.5 ${style.cell} ${today ? "border-2 border-clay-500" : ""}`}
      >
        <Text className="text-[13px] font-semibold text-ink-900">{day}</Text>
        <Text className={`text-[11px] font-medium ${style.text}`} numberOfLines={1}>
          {style.badge ? `${style.badge}  ${style.label}` : style.label}
        </Text>
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
          <Text className="min-w-[128px] text-center text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-800">
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
      </View>

      <View className="mb-3 flex-row flex-wrap gap-x-3 gap-y-1.5">
        {(Object.keys(PARENT_DAY_STYLE) as ParentDayKind[])
          .filter((k) => k !== "upcoming")
          .map((k) => {
            const s = PARENT_DAY_STYLE[k];
            return (
              <View key={k} className="flex-row items-center gap-1">
                <View className={`h-5 min-w-[22px] items-center justify-center rounded border px-1 ${s.cell}`}>
                  <Text className={`text-[10px] font-semibold ${s.text}`}>{s.badge || "·"}</Text>
                </View>
                <Text className="text-[11px] text-ink-700">{s.label}</Text>
              </View>
            );
          })}
      </View>

      {mode === "calendar" ? (
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
              <View key={cell.key} className="w-[14.285%] p-[3px]">
                <View className="min-h-[68px]" />
              </View>
            ))}
            {days.map((cell) => (
              <View key={cell.key} className="w-[14.285%] p-[3px]">
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
                className={`mb-1 flex-row items-center justify-between rounded-[10px] border px-3 py-2 ${s.cell}`}
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

      <View className="mt-3 flex-row flex-wrap gap-2 border-t border-ink-100 pt-3">
        {(
          [
            ["Present", counts.present, "present"],
            ["Absent", counts.absent, "absent"],
            ["Late", counts.late, "late"],
            ["Weekly off", counts.wo, "wo"],
            ["Holiday", counts.holiday, "holiday"],
            ["Planned leave", counts.pl, "pl"],
            ["Not marked", counts.nm, "nm"],
            ["Total days", days.length, "nm"],
          ] as const
        ).map(([label, value, kind]) => (
          <View key={label} className={`rounded-md border px-2 py-1.5 ${PARENT_DAY_STYLE[kind].cell}`}>
            <Text className={`text-[15px] font-semibold ${PARENT_DAY_STYLE[kind].text}`}>{value}</Text>
            <Text className="text-[10px] text-ink-500">{label}</Text>
          </View>
        ))}
      </View>
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
      <View className="mb-3 flex-row flex-wrap items-center justify-between gap-3 border-b border-ink-200 pb-3">
        <View>
          <Text className="text-2xl font-semibold text-ink-900">Attendance</Text>
          <Text className="mt-0.5 text-sm text-ink-700">
            {child ? `${child.name.split(" ")[0]}'s month at a glance.` : "Presence, punctuality, and leave."}
          </Text>
        </View>
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
      <ChildSwitch />
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
        <View>
          <View className="mb-4">
            <View className="overflow-hidden rounded-xl bg-ink-900 p-4">
              <View className="flex-row items-start justify-between gap-4">
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-center gap-2">
                    <View className={`h-2 w-2 rounded-full ${att.pct >= 75 ? "bg-emerald-400" : "bg-amber-400"}`} />
                    <Text className="text-xs font-semibold uppercase tracking-[1.5px] text-blue-100">Last {att.marked} marked days</Text>
                  </View>
                  <Text className="mt-2 text-4xl font-semibold tracking-tight text-white">{att.pct}%</Text>
                  <Text className="mt-1 text-base font-medium text-white">{attendanceMessage}</Text>
                </View>
                {todayLabel ? (
                  <View className="flex-row items-center gap-2 rounded-full bg-white/10 px-3 py-2">
                    <View className={`h-2 w-2 rounded-full ${today === "out" ? "bg-red-400" : today === "late" ? "bg-amber-400" : "bg-emerald-400"}`} />
                    <Text className="text-xs font-medium text-white">{todayLabel}</Text>
                  </View>
                ) : null}
              </View>

              <View className="mt-4">
                <View className="h-2 overflow-hidden rounded-full bg-white/15">
                  <View className={`h-2 rounded-full ${progressTone}`} style={{ width: `${Math.max(2, att.pct)}%` }} />
                </View>
                <View className="mt-2 flex-row justify-between">
                  <Text className="text-xs text-blue-100">Current attendance</Text>
                  <Text className="text-xs text-blue-100">75% required</Text>
                </View>
              </View>

              <View className="mt-4 flex-row overflow-hidden rounded-lg bg-white/10">
                {[
                  { label: "Present", value: att.inDays, color: "text-emerald-300" },
                  { label: "Late", value: att.late, color: "text-amber-300" },
                  { label: "Absent", value: att.out, color: "text-red-300" },
                  { label: "This month", value: `${att.thisMonth.inDays}/${att.thisMonth.marked}`, color: "text-white" },
                ].map((item, index) => (
                  <View key={item.label} className={`flex-1 px-3 py-3 ${index ? "border-l border-white/10" : ""}`}>
                    <Text className={`text-xl font-semibold ${item.color}`}>{item.value}</Text>
                    <Text className="mt-0.5 text-[11px] text-blue-100">{item.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>
      )}

          <View className="mb-3 mt-4 flex-row items-end justify-between gap-3">
            <View>
              <Text className="text-lg font-semibold text-ink-900">Attendance calendar</Text>
              <Text className="mt-1 text-xs text-ink-500">Each day is tinted by status so the month is scannable at a glance.</Text>
            </View>
            {cbse ? (
              <View className="rounded-full bg-amber-50 px-3 py-1.5">
                <Text className="text-xs font-medium text-amber-800">{cbse}</Text>
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
  const child = data?.child;
  const reports = data?.reports ?? [];
  const [seriesId, setSeriesId] = useState("");
  const open = reports.find((r) => r.seriesId === seriesId) ?? reports[0] ?? null;
  const student = data?.kind === "STUDENT";
  return (
    <View>
      <PageHeader
        kicker="Reports"
        title={student ? "Examination" : "Examination"}
        lede="Exam dates, papers, marks, and results in one place."
      />
      <ChildSwitch />
      {open && child ? (
        <View className="mb-6">
          <Text className="mb-3 font-semibold text-ink-900">Marksheet</Text>
          {reports.length > 1 ? (
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
          ) : (
            <Text className="mb-3 text-sm text-ink-700">{open.seriesName}</Text>
          )}
          <ReportCardSheet
            printLabel="Download marksheet"
            data={{
              school: open.school,
              seriesName: open.seriesName,
              sessionLabel: open.sessionLabel,
              classLabel: open.classLabel,
              student: {
                id: child.id,
                name: child.name,
                admissionNo: child.admissionNo,
                attendance: child.attendance,
              },
              classmates: open.classmates,
              exams: open.exams,
              marks: open.marks,
              policy: open.policy,
            }}
          />
        </View>
      ) : null}
      <Text className="mb-3 font-semibold text-ink-900">Upcoming</Text>
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
      <Text className="mb-3 font-semibold text-ink-900">Papers</Text>
      {!child?.tests.length ? (
        <Empty title="No results yet" body="When the school publishes a term, it appears here." />
      ) : (
        <Card>
          {child.tests.map((t) => (
            <View key={t.id} className="border-t border-ink-100 px-4 py-3 first:border-t-0">
              <Text className="font-medium text-ink-900">{t.title}</Text>
              <Text className="mt-1 text-sm text-ink-700">
                {t.subject} · {t.marks}/{t.max} ({t.pct}%)
              </Text>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

export function FamilyPapers() {
  const { data } = useRecord();
  const child = data?.child;
  return (
    <View>
      <PageHeader
        kicker="Reports"
        title={data?.kind === "STUDENT" ? "Papers" : "How the paper was marked"}
        lede={
          data?.kind === "STUDENT"
            ? "Answer sheets the teacher uploaded. Open them whenever you want."
            : "Answer sheets and evaluations. You see how the teacher read the child — not only a number."
        }
      />
      <ChildSwitch />
      {!child?.papers.length ? (
        <Empty title="No papers uploaded" body="When a teacher uploads a mark sheet, it opens here." />
      ) : (
        <View className="gap-3">
          {child.papers.map((p) => (
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
              {p.fileUrl ? (
                <Pressable className="mt-2" onPress={() => Linking.openURL(p.fileUrl!.replace(/https?:\/\/[^/]+/, webOrigin()))}>
                  <Text className="text-sm text-clay-600">{p.fileName}</Text>
                </Pressable>
              ) : (
                <Text className="mt-2 text-sm text-clay-600">{p.fileName}</Text>
              )}
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
  const toast = useToast();
  const child = data?.child;
  const student = data?.kind === "STUDENT";
  const rows = student
    ? [
        { label: "Name", value: child?.name || user?.name || "—" },
        { label: "Class", value: child?.classLabel || "—" },
        { label: "Admission no.", value: child?.admissionNo || "—" },
        { label: "Date of birth", value: child?.born || "—" },
        { label: "Login", value: child?.email || user?.email || "—" },
        { label: "Parent", value: child?.parentName || "—" },
        { label: "Parent phone", value: child?.parentPhone || "—" },
        { label: "Parent email", value: child?.parentEmail || "—" },
      ]
    : [
        { label: "Name", value: user?.name || "—" },
        { label: "Role", value: user?.roleName || "—" },
        { label: "Login", value: user?.email || "—" },
      ];
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

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
      toast.show("Password updated.");
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not change password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <PageHeader
        title="Profile"
        lede={
          student
            ? "How the school has you on record. Name, class, and admission number are set by the office."
            : "Your login. Change the password the office first gave you."
        }
      />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {user?.portal === "OFFICE" ? (
        <LeaveApplyCard
          audience="staff"
          token={token}
          onDone={async (ok) => {
            toast.show(ok);
            await reload();
          }}
          onError={(msg) => toast.show(msg)}
        />
      ) : null}
      <Card className="mb-4 p-5">
        {rows.map((row) => (
          <View
            key={row.label}
            className="mb-3 flex-row items-baseline justify-between gap-3 border-b border-ink-100 pb-3 last:mb-0 last:border-b-0 last:pb-0"
          >
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">{row.label}</Text>
            <Text className="flex-1 text-right text-sm text-ink-900">{row.value}</Text>
          </View>
        ))}
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
      <Card className="p-5">
        <Text className="text-sm font-medium text-ink-900">Password</Text>
        <Text className="mt-1 mb-3 text-xs text-ink-700">
          {student ? "This is the one thing you can change yourself." : "Change the first password the office gave you."}
        </Text>
        <View className="gap-3">
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
            {busy ? "Saving…" : "Change password"}
          </Button>
        </View>
      </Card>
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
    return [
      showTeacher ? slot.teacher : "",
      "classLabel" in slot ? slot.classLabel : "",
      slot.room,
    ].filter(Boolean).join(" · ");
  }

  return (
    <View>
      <PageHeader
        kicker="Reports"
        title={title}
        lede={
          child
            ? `${child.name.split(" ")[0]} · Class ${child.classLabel}. The week as the school actually runs it.`
            : "The week as the school actually runs it."
        }
      />
      <ChildSwitch />
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
            const isBreak = period.isBreak;
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
        <View>
          <ChipScroller>
            {weekdays.map((day) => (
              <Chip
                key={day.n}
                label={day.n === today ? `${day.label} · Today` : day.label}
                active={day.n === activeDay}
                onPress={() => setPickedDay(day.n)}
              />
            ))}
          </ChipScroller>
          <View className="mt-4 gap-2">
            {periods.map((period) => {
              const slot = periodSlot(activeDay, period);
              const isBreak = period.isBreak;
              return (
                <Card key={period.id} className={`flex-row overflow-hidden ${isBreak ? "bg-amber-50" : ""}`}>
                  <View className="w-24 justify-center border-r border-ink-200 bg-ink-50 px-3 py-3">
                    <Text className="text-xs font-semibold text-ink-900">{period.name}</Text>
                    {period.start ? (
                      <Text className="mt-1 text-[10px] text-ink-700">{period.start}</Text>
                    ) : null}
                  </View>
                  <View className="min-h-[72px] flex-1 justify-center px-4 py-3">
                    {isBreak ? (
                      <Text className="text-sm font-medium text-amber-800">Break</Text>
                    ) : slot ? (
                      <>
                        <Text className="font-semibold text-ink-900">{slot.subject}</Text>
                        {slotMeta(slot) ? <Text className="mt-1 text-sm text-ink-700">{slotMeta(slot)}</Text> : null}
                      </>
                    ) : (
                      <Text className="text-sm text-ink-400">Free period</Text>
                    )}
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

function openFeeMonths(fees: FeeInv[]) {
  const open = fees
    .map((inv) => ({ inv, dueNow: dueOf(inv) }))
    .filter((row) => row.dueNow > 0)
    .sort((a, b) => {
      const da = a.inv.dueAt ? Date.parse(a.inv.dueAt) : 0;
      const db = b.inv.dueAt ? Date.parse(b.inv.dueAt) : 0;
      return da - db || a.inv.title.localeCompare(b.inv.title);
    });
  const months: { period: string; label: string; dueNow: number; items: FeeInv[] }[] = [];
  for (const row of open) {
    const period = row.inv.period || row.inv.id;
    const last = months[months.length - 1];
    if (last && last.period === period) {
      last.dueNow += row.dueNow;
      last.items.push(row.inv);
      continue;
    }
    months.push({
      period,
      label: row.inv.title.split(" · ")[0]?.trim() || row.inv.title,
      dueNow: row.dueNow,
      items: [row.inv],
    });
  }
  return months;
}

export function FamilyFees() {
  const { data } = useRecord();
  const { token } = useSession();
  const router = useRouter();
  const toast = useToast();
  const child = data?.child;
  const months = useMemo(() => openFeeMonths(child?.fees ?? []), [child?.fees]);
  const paid = useMemo(
    () => (child?.fees ?? []).filter((inv) => inv.display === "paid" || dueOf(inv) <= 0),
    [child?.fees]
  );
  const [through, setThrough] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setThrough(null);
  }, [child?.id]);

  const activeThrough = months.length ? (through == null ? months.length - 1 : Math.min(through, months.length - 1)) : -1;
  const selected = months.slice(0, activeThrough + 1);
  const selectedIds = selected.flatMap((month) => month.items.map((inv) => inv.id));
  const selectedTotal = selected.reduce((sum, month) => sum + month.dueNow, 0);
  const allDue = months.length > 0 && activeThrough === months.length - 1;
  const payKind = data?.kind === "STUDENT" ? " with Razorpay" : "";
  const payLabel = !selected.length
    ? "Pick months to pay"
    : allDue
      ? `Pay all due · ${rupees(selectedTotal)}${payKind}`
      : `Pay ${selected.length} ${selected.length === 1 ? "month" : "months"} · ${rupees(selectedTotal)}${payKind}`;

  async function pay() {
    if (!child?.id || !selectedIds.length) return;
    setBusy(true);
    try {
      const res = await act<{ ok: true; path: string }>(token, "ensurePayLink", {
        studentId: child.id,
        invoiceIds: selectedIds,
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

  function toggleMonth(index: number) {
    if (index === activeThrough) setThrough(index - 1);
    else if (index > activeThrough) setThrough(index);
  }

  return (
    <View>
      <PageHeader
        kicker={data?.kind === "STUDENT" ? undefined : "Parent · Reports"}
        title="Fees"
        lede={
          child
            ? `${child.name} · ${child.classLabel}. Clear older dues first. Paying all at once is the usual way.`
            : "Dues and collection."
        }
      />
      <ChildSwitch />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {!child?.fees.length ? (
        <Empty title="No fee invoices yet" body="When the office raises a bill, it is here." />
      ) : (
        <View className="gap-3">
          {months.length ? (
            <>
              <ChipScroller>
                <Chip
                  label={`All due · ${rupees(months.reduce((sum, month) => sum + month.dueNow, 0))}`}
                  active={allDue}
                  onPress={() => setThrough(months.length - 1)}
                />
                {months.length > 1
                  ? months.slice(0, -1).map((month, i) => (
                      <Chip
                        key={month.period}
                        label={`${i + 1} ${i === 0 ? "month" : "months"}`}
                        active={activeThrough === i}
                        onPress={() => setThrough(i)}
                      />
                    ))
                  : null}
              </ChipScroller>
              <Text className="text-xs text-ink-700">
                Tick months in order. Older dues stay selected — you cannot skip them.
              </Text>
              <Button disabled={!selectedIds.length || busy} onPress={pay}>
                {busy ? "Opening pay…" : payLabel}
              </Button>
            </>
          ) : null}
          {months.flatMap((month, index) => {
            const on = index <= activeThrough;
            return month.items.map((inv) => (
              <Pressable key={inv.id} onPress={() => toggleMonth(index)}>
                <Card className={`p-5 ${on ? "border-clay-500" : ""}`}>
                  <View className="flex-row items-start gap-3">
                    <View
                      className={`mt-0.5 h-5 w-5 rounded border ${
                        on ? "border-clay-500 bg-clay-500" : "border-ink-300 bg-white"
                      }`}
                    />
                    <View className="flex-1">
                      <View className="flex-row items-start justify-between gap-3">
                        <View className="flex-1">
                          <Text className="font-semibold text-ink-900">{inv.title}</Text>
                          <Text className="mt-1 text-sm text-ink-700">
                            Due {inv.due} · {inv.amount} · paid {inv.paid}
                            {inv.remaining !== "₹0" ? ` · remaining ${inv.remaining}` : ""}
                          </Text>
                          {inv.lines.length ? (
                            <Text className="mt-1 text-xs text-ink-700">{inv.lines.join(" · ")}</Text>
                          ) : null}
                          {inv.lateLabel ? <Text className="mt-1 text-xs text-ink-700">{inv.lateLabel}</Text> : null}
                          {!on && index > 0 ? (
                            <Text className="mt-1 text-xs text-ink-700">
                              Clear {months[index - 1].label} first.
                            </Text>
                          ) : null}
                        </View>
                        <Badge tone={inv.display === "overdue" ? "warn" : "clay"}>{inv.display}</Badge>
                      </View>
                    </View>
                  </View>
                </Card>
              </Pressable>
            ));
          })}
          {paid.length ? (
            <View className="mt-2 gap-3">
              {paid.map((inv) => (
                <Card key={inv.id} className="p-5">
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text className="font-semibold text-ink-900">{inv.title}</Text>
                      <Text className="mt-1 text-sm text-ink-700">
                        Due {inv.due} · {inv.amount} · paid {inv.paid}
                      </Text>
                      {inv.lines.length ? (
                        <Text className="mt-1 text-xs text-ink-700">{inv.lines.join(" · ")}</Text>
                      ) : null}
                    </View>
                    <Badge tone="leaf">{inv.display === "paid" ? "paid" : inv.display}</Badge>
                  </View>
                </Card>
              ))}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}
