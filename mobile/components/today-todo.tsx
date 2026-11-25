import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { webOrigin } from "../lib/api";
import { act } from "../lib/mutate";
import { useRecord, type DayGap, type DayGaps, type LeaveRow, type UpcomingTeacherLeaveRow } from "../lib/record";
import { useSession } from "../lib/session";
import { Modal, Toast, useToast } from "./ui";

type Candidate = {
  id: string;
  name: string;
  tier: number;
  reason: string;
  periodsToday: number;
  sameSubject: boolean;
  subjects: { id: string; name: string }[];
};
type Row = {
  slotId: string;
  classId: string;
  classLabel: string;
  period: string;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
  subjectId: string;
  subject: string;
  coverSubject: string;
  classSubjects: { id: string; name: string }[];
  weeklyTeacherId: string;
  weeklyTeacher: string;
  status: "" | "COVERED" | "FREE" | "OPEN";
  reasonLabel: string;
  teacher: string;
  candidates: Candidate[];
};
type Day = { date: string; closed: string; canEdit: boolean; rows: Row[] };

function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hmNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0] || "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

const first = (name: string) => name.split(" ")[0] || name;

function prettyRange(from: string, to: string) {
  const pretty = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return from === to ? pretty(from) : `${pretty(from)}–${pretty(to)}`;
}

/** Free teachers who already teach this class (same subject first). Others are only offered on request. */
const fitOf = (row: Row) => row.candidates.filter((c) => c.tier <= 3);

/** Subject the cover teacher takes by default: the routine one if they teach it, else their own subject in that class. */
const defaultSubject = (row: Row, teacher: Candidate) => (teacher.sameSubject || !row.subjectId ? "" : teacher.subjects[0]?.id || "");

const TONE = {
  red: { bg: "bg-red-50", fg: "text-red-700", icon: "#B91C1C" },
  amber: { bg: "bg-amber-50", fg: "text-amber-800", icon: "#B45309" },
  violet: { bg: "bg-violet-50", fg: "text-violet-700", icon: "#6D28D9" },
  blue: { bg: "bg-[#EEF3FF]", fg: "text-[#1F45C7]", icon: "#1F45C7" },
} as const;

/** One compact line in the list: badge, two lines of text, actions on the right. */
function Item({
  tone,
  badge,
  icon,
  title,
  sub,
  onPress,
  open,
  right,
  children,
}: {
  tone: keyof typeof TONE;
  badge?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  onPress?: () => void;
  open?: boolean;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <View className="border-t border-ink-100">
      <View className="flex-row items-center gap-3 px-4 py-2.5">
        <Pressable onPress={onPress} disabled={!onPress} className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-70">
          <View className={`h-9 w-9 items-center justify-center rounded-full ${t.bg}`}>
            {icon ? <Ionicons name={icon} size={16} color={t.icon} /> : <Text className={`text-[11px] font-bold ${t.fg}`}>{badge}</Text>}
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[14px] font-semibold text-ink-900" numberOfLines={1}>{title}</Text>
            <Text className="text-[12px] text-ink-500" numberOfLines={2}>{sub}</Text>
          </View>
          {open !== undefined ? <Ionicons name={open ? "chevron-up" : "chevron-down"} size={15} color="#94A3B8" /> : null}
        </Pressable>
        {right}
      </View>
      {open && children ? <View className="mx-4 mb-3 overflow-hidden rounded-xl border border-ink-100 bg-ink-50/40">{children}</View> : null}
    </View>
  );
}

function SmallButton({ label, onPress, disabled, ghost }: { label: string; onPress: () => void; disabled?: boolean; ghost?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`rounded-lg px-3 py-1.5 active:opacity-80 ${ghost ? "border border-ink-200 bg-white" : "bg-[#1F45C7]"} ${disabled ? "opacity-60" : ""}`}
    >
      <Text className={`text-[12px] font-semibold ${ghost ? "text-ink-700" : "text-white"}`}>{label}</Text>
    </Pressable>
  );
}

/**
 * Office home "To do": one short line per thing the admin should act on, best answer already picked.
 * Teachers out today (tap to see each period), class attendance hand-overs, leave waiting for approval,
 * future leave that still needs cover, then money.
 */
export function TodayTodo({
  fees,
  leave,
}: {
  fees: { show: boolean; overdue: number; dueNow: string };
  leave: {
    waiting: LeaveRow[];
    upcoming: UpcomingTeacherLeaveRow[];
    busy: string;
    onReview: (id: string) => void;
    onDecide: (id: string, yes: boolean) => void;
  };
}) {
  const { data, reload } = useRecord();
  const { token } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [day, setDay] = useState<Day | null>(null);
  const [gaps, setGaps] = useState<DayGaps | null>(null);
  const [busy, setBusy] = useState("");
  const [openKey, setOpenKey] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [pick, setPick] = useState<{ row: Row; on: string } | null>(null);
  const pickRow = pick?.row ?? null;
  const [pickGap, setPickGap] = useState<DayGap | null>(null);
  const [subjectFor, setSubjectFor] = useState<{ row: Row; teacher: Candidate; subjectId: string; on: string } | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [showOtherAtt, setShowOtherAtt] = useState(false);
  const [plan, setPlan] = useState<{ leave: UpcomingTeacherLeaveRow; days: { date: string; rows: Row[] }[] | null } | null>(null);
  const canCover = Boolean(data?.dayGaps);
  const date = ymdLocal(new Date());

  const load = useCallback(async () => {
    if (!canCover) return;
    try {
      const [dayRes, gapRes] = await Promise.all([
        act<Day & { ok: true }>(token, "loadDayTimetable", { date }),
        act<DayGaps & { ok: true }>(token, "loadDayGaps", { date }),
      ]);
      setDay(dayRes);
      setGaps(gapRes);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not load today's list.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, date, canCover]);

  useEffect(() => {
    void load();
  }, [load, data]);

  // Future leave: that teacher's periods on each leave day after today, as the day will actually run.
  async function loadPlan(l: UpcomingTeacherLeaveRow) {
    const dates = [...new Set(l.slots.map((s) => s.date).filter((d) => d > date))].sort();
    const days = await Promise.all(
      dates.map(async (d) => {
        const res = await act<Day & { ok: true }>(token, "loadDayTimetable", { date: d });
        const rows = (res.rows ?? []).filter((r) => r.weeklyTeacherId === l.teacherId).sort((a, b) => a.sortOrder - b.sortOrder);
        return { date: d, rows };
      })
    );
    setPlan({ leave: l, days });
  }
  function openPlan(l: UpcomingTeacherLeaveRow) {
    setPlan({ leave: l, days: null });
    loadPlan(l).catch((e) => toast.show(e instanceof Error ? e.message : "Could not load the leave days."));
  }

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      const said = await fn();
      toast.show(typeof said === "string" ? said : ok);
      setPick(null);
      setShowOthers(false);
      setPickGap(null);
      setShowOtherAtt(false);
      setSubjectFor(null);
      await load();
      if (plan) await loadPlan(plan.leave).catch(() => undefined);
      void reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
      await load();
    } finally {
      setBusy("");
    }
  }

  const saveCover = (row: Row, teacher: Candidate, subjectId: string, on = date) => {
    const other = subjectId && subjectId !== row.subjectId ? row.classSubjects.find((x) => x.id === subjectId)?.name || "" : "";
    return run(
      row.slotId + on,
      () => act(token, "saveDayChange", { date: on, slotId: row.slotId, status: "COVERED", substituteId: teacher.id, subjectId: other ? subjectId : "" }),
      `${teacher.name} takes ${row.period} · ${row.classLabel}${other ? ` (${other})` : ""}. They've been told.`
    );
  };
  // Same subject (or no choice): assign straight away. Otherwise ask what they will teach.
  // Only the subjects that teacher takes in this class: none = routine subject, one = that one, more = ask.
  const coverTo = (row: Row, teacher: Candidate, on = date) => {
    if (teacher.sameSubject || !row.subjectId || teacher.subjects.length < 2) return saveCover(row, teacher, defaultSubject(row, teacher), on);
    setPick(null);
    setSubjectFor({ row, teacher, subjectId: teacher.subjects[0].id, on });
  };
  const noLesson = (row: Row, on = date) =>
    run(row.slotId + on, () => act(token, "saveDayChange", { date: on, slotId: row.slotId, status: "FREE" }), `${row.period} · ${row.classLabel} marked free.`);
  const attendanceTo = (gap: DayGap, teacher: { id: string; name: string }) =>
    run(
      `att:${gap.classId}`,
      () => act(token, "assignAttendanceCover", { date, classId: gap.classId, teacherId: teacher.id }),
      `${teacher.name} takes ${gap.classLabel}'s attendance.`
    );
  // Every coming period of one teacher to its best free teacher; periods already over are marked free.
  const settleTeacher = (key: string, coming: Row[], over: Row[], on = date) =>
    run(
      `t:${key}`,
      async () => {
        let given = 0;
        let left = 0;
        for (const row of coming) {
          const best = fitOf(row)[0];
          if (!best) {
            left += 1;
            continue;
          }
          try {
            await act(token, "saveDayChange", { date: on, slotId: row.slotId, status: "COVERED", substituteId: best.id, subjectId: defaultSubject(row, best) });
            given += 1;
          } catch {
            left += 1;
          }
        }
        for (const row of over) await act(token, "saveDayChange", { date: on, slotId: row.slotId, status: "FREE" });
        const parts = [given ? `${given} period${given === 1 ? "" : "s"} assigned` : "", over.length ? `${over.length} marked free` : "", left ? `${left} still need someone` : ""];
        return parts.filter(Boolean).join(" · ") + ".";
      },
      "Done."
    );

  const now = hmNow();
  const rows = day && !day.closed && day.canEdit ? day.rows : [];
  const open = rows.filter((r) => r.status === "OPEN").sort((a, b) => a.sortOrder - b.sortOrder);
  const isOver = (r: Row) => Boolean(r.endsAt) && r.endsAt <= now;
  const teachers = [...new Map(open.map((r) => [r.weeklyTeacherId || r.weeklyTeacher, r])).values()].map((r) => {
    const key = r.weeklyTeacherId || r.weeklyTeacher;
    const mine = open.filter((x) => (x.weeklyTeacherId || x.weeklyTeacher) === key);
    return { key, name: r.weeklyTeacher || "Teacher", why: (r.reasonLabel || "Out").toLowerCase(), coming: mine.filter((x) => !isOver(x)), over: mine.filter(isOver) };
  });
  const covered = rows.filter((r) => r.status === "COVERED" || r.status === "FREE").sort((a, b) => a.sortOrder - b.sortOrder);
  const attendance = (gaps?.gaps ?? []).filter((g) => g.classId && !g.attendanceBy && !g.attendanceDone);
  const waiting = leave.waiting;
  const planAhead = leave.upcoming
    .map((l) => ({ ...l, need: l.slots.filter((s) => !s.substituteId && s.date > date).length }))
    .filter((l) => l.need > 0);
  const money = fees.show && fees.overdue > 0;

  const items: { key: string; node: ReactNode }[] = [];

  for (const t of teachers) {
    const comingNeed = t.coming.length;
    // Their classes' attendance today (one row per class): a co-class teacher who is in, someone handed it, or already taken.
    const attendance = (gaps?.gaps ?? [])
      .filter((g) => g.teacherId === t.key && g.classLabel)
      .map((gap) => {
        const klass = gap.classLabel;
        return gap.attendanceDone
          ? `${klass} attendance taken`
          : gap.attendanceBy
            ? `${klass} attendance: ${first(gap.attendanceBy.name)}`
            : gap.coClassTeacher
              ? `${klass} attendance: ${first(gap.coClassTeacher)} (class teacher)`
              : "";
      })
      .filter(Boolean)
      .join(" · ");
    const sub = [comingNeed ? `${comingNeed} period${comingNeed === 1 ? "" : "s"} need a teacher` : "", t.over.length ? `${t.over.length} already over` : "", attendance]
      .filter(Boolean)
      .join(" · ");
    const action = comingNeed && t.coming.some((r) => fitOf(r).length) ? (t.over.length ? "Assign all" : "Assign") : "Mark free";
    items.push({
      key: `t:${t.key}`,
      node: (
        <Item
          key={`t:${t.key}`}
          tone="red"
          badge={initials(t.name)}
          title={`${t.name} · ${t.why}`}
          sub={sub}
          open={openKey === `t:${t.key}`}
          onPress={() => setOpenKey(openKey === `t:${t.key}` ? "" : `t:${t.key}`)}
          right={
            <SmallButton
              label={busy === `t:${t.key}` ? "Saving…" : action}
              disabled={Boolean(busy)}
              onPress={() => void settleTeacher(t.key, t.coming, t.over)}
            />
          }
        >
          {[...t.coming, ...t.over].map((row, i) => periodLine(row, i, isOver(row)))}
        </Item>
      ),
    });
  }

  for (const gap of attendance) {
    const best = gap.candidates[0];
    items.push({
      key: `att:${gap.classId}`,
      node: (
        <Item
          key={`att:${gap.classId}`}
          tone="amber"
          icon="people-outline"
          title={`${gap.classLabel} attendance`}
          sub={`Class teacher ${gap.teacherName} is ${gap.why.toLowerCase()}${best?.hint ? ` · ${first(best.name)}: ${best.hint.toLowerCase()}` : ""}`}
          onPress={gap.candidates.length ? () => setPickGap(gap) : undefined}
          right={
            best ? (
              <View className="flex-row items-center gap-1.5">
                <SmallButton
                  label={busy === `att:${gap.classId}` ? "Saving…" : `Give to ${first(best.name)}`}
                  disabled={Boolean(busy)}
                  onPress={() => void attendanceTo(gap, best)}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Pick another teacher for ${gap.classLabel} attendance`}
                  onPress={() => setPickGap(gap)}
                  className="h-8 flex-row items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 active:opacity-70"
                >
                  <Text className="text-[12px] font-semibold text-ink-700">Others</Text>
                  <Ionicons name="chevron-down" size={13} color="#475569" />
                </Pressable>
              </View>
            ) : null
          }
        />
      ),
    });
  }

  for (const row of waiting) {
    const days = row.halfDay ? "½ day" : row.days ? `${row.days} day${row.days === 1 ? "" : "s"}` : "";
    items.push({
      key: `lv:${row.id}`,
      node: (
        <Item
          key={`lv:${row.id}`}
          tone="amber"
          badge={initials(row.subjectName)}
          title={`${row.subjectName} · ${row.typeName}`}
          sub={`Asks for leave · ${prettyRange(row.from, row.to)}${days ? ` · ${days}` : ""}`}
          onPress={() => leave.onReview(row.id)}
          right={
            <View className="flex-row items-center gap-1.5">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reject"
                disabled={Boolean(leave.busy)}
                onPress={() => leave.onDecide(row.id, false)}
                className="h-8 w-8 items-center justify-center rounded-lg border border-ink-200 bg-white active:opacity-70"
              >
                <Ionicons name="close" size={15} color="#475569" />
              </Pressable>
              <SmallButton label={leave.busy === row.id ? "Saving…" : "Approve"} disabled={Boolean(leave.busy)} onPress={() => leave.onDecide(row.id, true)} />
            </View>
          }
        />
      ),
    });
  }

  for (const l of planAhead) {
    items.push({
      key: `up:${l.requestId}`,
      node: (
        <Item
          key={`up:${l.requestId}`}
          tone="violet"
          badge={initials(l.teacherName)}
          title={`${l.teacherName} · on leave ${prettyRange(l.from, l.to)}`}
          sub={`${l.need} period${l.need === 1 ? "" : "s"} to plan cover for`}
          onPress={() => openPlan(l)}
          right={<SmallButton label="Plan" ghost onPress={() => openPlan(l)} />}
        />
      ),
    });
  }

  const seats = data?.subscription?.seats;
  const upgradeLink = data?.subscription?.upgradeUrl || "";
  if (seats?.full && upgradeLink) {
    items.push({
      key: "seats",
      node: (
        <Item
          key="seats"
          tone="amber"
          icon="people-outline"
          title={`Student seats full · ${seats.active} of ${seats.paid}`}
          sub="New students can't be added until you upgrade"
          onPress={() => void Linking.openURL(/^https?:/i.test(upgradeLink) ? upgradeLink : `${webOrigin()}${upgradeLink}`)}
          right={
            <SmallButton
              label="Upgrade"
              onPress={() => void Linking.openURL(/^https?:/i.test(upgradeLink) ? upgradeLink : `${webOrigin()}${upgradeLink}`)}
            />
          }
        />
      ),
    });
  }

  if (money) {
    items.push({
      key: "fees",
      node: (
        <Item
          key="fees"
          tone="red"
          icon="wallet-outline"
          title={`${fees.overdue} fee${fees.overdue === 1 ? "" : "s"} overdue`}
          sub={`${fees.dueNow} pending · send reminders`}
          onPress={() => router.push("/fees" as never)}
          right={<Ionicons name="chevron-forward" size={15} color="#94A3B8" />}
        />
      ),
    });
  }

  function periodLine(row: Row, index: number, past: boolean, on = date) {
    const best = fitOf(row)[0];
    const live = on === date && !past && row.startsAt <= now && now < row.endsAt;
    return (
      <View key={row.slotId} className={`flex-row items-center gap-3 px-3 py-2 ${index ? "border-t border-ink-100" : ""}`}>
        <View className="w-[46px]">
          <Text className={`text-[12px] font-bold ${live ? "text-red-700" : past ? "text-ink-400" : "text-ink-800"}`} numberOfLines={1}>
            {row.period.replace(/^Period\s*/i, "P")}
          </Text>
          <Text className={`text-[10px] ${live ? "text-red-600" : "text-ink-400"}`}>{live ? "Now" : past ? "Over" : row.startsAt}</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[13px] font-semibold text-ink-900" numberOfLines={1}>{`${row.classLabel}${row.subject ? ` · ${row.subject}` : ""}`}</Text>
          <Text className="text-[11px] text-ink-500" numberOfLines={2}>{best ? `${first(best.name)} · ${best.reason}` : row.candidates.length ? `No ${row.classLabel} teacher is free · ⋯ for others` : "No teacher is free"}</Text>
        </View>
        {past ? (
          <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => void noLesson(row, on)} hitSlop={6}>
            <Text className="text-[12px] font-semibold text-ink-600">Free</Text>
          </Pressable>
        ) : null}
        {best ? (
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(busy)}
            onPress={() => void coverTo(row, best, on)}
            className="rounded-full bg-[#EEF3FF] px-2.5 py-1 active:opacity-80"
          >
            <Text className="text-[12px] font-semibold text-[#1F45C7]">{busy === row.slotId + on ? "…" : first(best.name)}</Text>
          </Pressable>
        ) : !past ? (
          <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => void noLesson(row, on)} hitSlop={6}>
            <Text className="text-[12px] font-semibold text-ink-600">Free</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="More teachers" onPress={() => setPick({ row, on })} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={16} color="#64748B" />
        </Pressable>
      </View>
    );
  }

  const planOpen = (plan?.days ?? []).flatMap((d) => d.rows.filter((r) => r.status === "OPEN").map((row) => ({ row, on: d.date })));
  const planFit = planOpen.filter(({ row }) => fitOf(row).length).length;
  const assignPlan = () =>
    run(
      "plan",
      async () => {
        let given = 0;
        let left = 0;
        for (const { row, on } of planOpen) {
          const best = fitOf(row)[0];
          if (!best) {
            left += 1;
            continue;
          }
          try {
            await act(token, "saveDayChange", { date: on, slotId: row.slotId, status: "COVERED", substituteId: best.id, subjectId: defaultSubject(row, best) });
            given += 1;
          } catch {
            left += 1;
          }
        }
        return `${given} period${given === 1 ? "" : "s"} assigned${left ? ` · ${left} still need someone` : ""}. Teachers have been told.`;
      },
      "Done."
    );

  if (!canCover && !items.length) return null;
  const LIMIT = 5;
  const shown = showAll ? items : items.slice(0, LIMIT);
  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

  return (
    <View className="mb-4 overflow-hidden rounded-2xl border border-ink-100 bg-white" testID="today-todo">
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="flex-row items-center gap-2 px-4 py-3">
        <Text className="text-[15px] font-semibold text-ink-900">To do</Text>
        {items.length ? (
          <View className="min-w-[20px] items-center rounded-full bg-red-50 px-1.5 py-0.5">
            <Text className="text-[11px] font-bold text-red-700">{items.length}</Text>
          </View>
        ) : null}
        <View className="flex-1" />
        <Text className="text-[12px] text-ink-400">{todayLabel}</Text>
      </View>

      {canCover && !day ? (
        <View className="items-center border-t border-ink-100 py-5">
          <ActivityIndicator color="#1F45C7" />
        </View>
      ) : items.length ? (
        <>
          {shown.map((it) => it.node)}
          {items.length > LIMIT ? (
            <Pressable onPress={() => setShowAll((v) => !v)} className="border-t border-ink-100 px-4 py-2.5 active:bg-ink-50">
              <Text className="text-[12px] font-semibold text-[#1F45C7]">{showAll ? "Show less" : `Show ${items.length - LIMIT} more`}</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <View className="flex-row items-center gap-3 border-t border-ink-100 px-4 py-3">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-emerald-50">
            <Ionicons name="checkmark" size={18} color="#15803D" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[14px] font-semibold text-ink-900">{day?.closed ? `School is closed (${day.closed})` : "All set"}</Text>
            <Text className="text-[12px] text-ink-500">Every class has a teacher and nothing is waiting on you.</Text>
          </View>
        </View>
      )}

      {covered.length ? (
        <View className="border-t border-ink-100 bg-ink-50/60 px-4 py-2">
          <Pressable onPress={() => setShowDone((v) => !v)} className="flex-row items-center gap-2" hitSlop={6}>
            <Text className="text-[12px] font-medium text-emerald-700">{`✓ ${covered.length} done today`}</Text>
            <View className="flex-1" />
            <Ionicons name={showDone ? "chevron-up" : "chevron-down"} size={14} color="#64748B" />
          </Pressable>
          {showDone
            ? covered.map((row) => (
                <View key={row.slotId} className="mt-1.5 flex-row items-center gap-2">
                  <Ionicons name="checkmark-circle" size={14} color="#059669" />
                  <Text className="min-w-0 flex-1 text-[12px] text-ink-700" numberOfLines={1}>
                    {`${row.period} · ${row.classLabel}${row.subject ? ` ${row.subject}` : ""} → ${
                      row.status === "FREE" ? "free period" : `${row.teacher}${row.coverSubject ? ` (${row.coverSubject})` : ""}`
                    }`}
                  </Text>
                </View>
              ))
            : null}
        </View>
      ) : null}

      <Modal
        open={Boolean(plan)}
        sheetOnPhone
        title={plan ? `Cover ${plan.leave.teacherName}` : ""}
        onClose={() => setPlan(null)}
        footer={
          plan?.days && planFit ? (
            <Pressable
              accessibilityRole="button"
              disabled={Boolean(busy)}
              onPress={() => void assignPlan()}
              className="items-center rounded-xl bg-[#1F45C7] py-3 active:opacity-80"
            >
              <Text className="text-[14px] font-semibold text-white">
                {busy === "plan" ? "Assigning…" : planFit === 1 ? "Give 1 period to its best fit" : `Give ${planFit} periods to their best fit`}
              </Text>
            </Pressable>
          ) : null
        }
      >
        {plan ? (
          <View className="gap-4">
            <Text className="text-[13px] text-ink-600">
              {`${plan.leave.typeName} · ${prettyRange(plan.leave.from, plan.leave.to)}. Pick who takes each period. The best free teacher is shown first; tap ⋯ for others.`}
            </Text>
            {!plan.days ? (
              <ActivityIndicator color="#1F45C7" />
            ) : !plan.days.some((d) => d.rows.length) ? (
              <Text className="text-[13px] text-ink-500">No periods on these days.</Text>
            ) : (
              plan.days
                .filter((d) => d.rows.length)
                .map((d) => {
                  const need = d.rows.filter((r) => r.status === "OPEN");
                  const done = d.rows.filter((r) => r.status !== "OPEN" && r.status !== "");
                  return (
                    <View key={d.date}>
                      <View className="mb-1.5 flex-row items-center">
                        <Text className="flex-1 text-[12px] font-semibold uppercase tracking-wide text-ink-500">
                          {new Date(`${d.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                        </Text>
                        <Text className={`text-[12px] font-medium ${need.length ? "text-amber-700" : "text-emerald-700"}`}>
                          {need.length ? `${need.length} to assign` : "All covered"}
                        </Text>
                      </View>
                      <View className="overflow-hidden rounded-xl border border-ink-100">
                        {need.map((row, i) => periodLine(row, i, false, d.date))}
                        {done.map((row, i) => (
                          <View key={row.slotId} className={`flex-row items-center gap-3 px-3 py-2 ${need.length || i ? "border-t border-ink-100" : ""}`}>
                            <View className="w-[46px]">
                              <Text className="text-[12px] font-bold text-ink-800">{row.period.replace(/^Period\s*/i, "P")}</Text>
                              <Text className="text-[10px] text-ink-400">{row.startsAt}</Text>
                            </View>
                            <View className="min-w-0 flex-1">
                              <Text className="text-[13px] font-semibold text-ink-900" numberOfLines={1}>{`${row.classLabel}${row.subject ? ` · ${row.subject}` : ""}`}</Text>
                              <Text className="text-[11px] text-emerald-700" numberOfLines={1}>
                                {row.status === "FREE" ? "✓ Free period" : `✓ ${first(row.teacher)}${row.coverSubject ? ` · teaches ${row.coverSubject}` : ""}`}
                              </Text>
                            </View>
                            <Pressable accessibilityRole="button" accessibilityLabel="Change" onPress={() => setPick({ row, on: d.date })} hitSlop={8}>
                              <Text className="text-[12px] font-semibold text-ink-600">Change</Text>
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                })
            )}
          </View>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(pickRow)}
        sheetOnPhone
        title={pickRow ? `${pickRow.period} · ${pickRow.classLabel}${pickRow.subject ? ` ${pickRow.subject}` : ""}` : ""}
        onClose={() => {
          setPick(null);
          setShowOthers(false);
        }}
      >
        {pickRow ? (
          <View className="gap-3">
            <Text className="text-[13px] text-ink-600">
              {`${pickRow.weeklyTeacher || "The teacher"} is ${(pickRow.reasonLabel || "out").toLowerCase()}. Teachers of ${pickRow.classLabel} who are free in ${pickRow.period}, best fit first.`}
            </Text>
            <View className="overflow-hidden rounded-xl border border-ink-100">
              {!fitOf(pickRow).length ? (
                <View className="items-center px-4 py-5">
                  <View className="h-11 w-11 items-center justify-center rounded-full bg-amber-50">
                    <Ionicons name="people-outline" size={20} color="#B45309" />
                  </View>
                  <Text className="mt-2.5 text-center text-[14px] font-semibold text-ink-900">{`No ${pickRow.classLabel} teacher is free`}</Text>
                  <Text className="mt-1 text-center text-[12px] leading-5 text-ink-500">
                    {`Everyone who teaches ${pickRow.classLabel} is busy or out in ${pickRow.period}. Add more teachers to ${pickRow.classLabel} so they show up here next time.`}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      const classId = pickRow.classId;
                      setPick(null);
                      setPlan(null);
                      setShowOthers(false);
                      router.push(`/timetable?class=${encodeURIComponent(classId)}&addTeacher=1` as never);
                    }}
                    className="mt-3 flex-row items-center gap-1.5 rounded-lg bg-[#1F45C7] px-3.5 py-2 active:opacity-80"
                  >
                    <Ionicons name="person-add-outline" size={14} color="#fff" />
                    <Text className="text-[13px] font-semibold text-white">{`Add a teacher to ${pickRow.classLabel}`}</Text>
                  </Pressable>
                  <Text className="mt-4 self-stretch border-t border-ink-100 pt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-400">For this period</Text>
                </View>
              ) : null}
              {[...fitOf(pickRow), ...(showOthers ? pickRow.candidates.filter((c) => c.tier > 3) : [])].map((c, i) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  disabled={Boolean(busy)}
                  onPress={() => void coverTo(pickRow, c, pick?.on)}
                  className={`flex-row items-center gap-3 px-3 py-2.5 active:bg-ink-50 ${i || !fitOf(pickRow).length ? "border-t border-ink-100" : ""} ${c.tier > 3 ? "bg-ink-50/50" : ""}`}
                >
                  <View className={`h-8 w-8 items-center justify-center rounded-full ${c.tier > 3 ? "bg-ink-100" : "bg-[#EEF3FF]"}`}>
                    <Text className={`text-[10px] font-bold ${c.tier > 3 ? "text-ink-600" : "text-[#1F45C7]"}`}>{initials(c.name)}</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[14px] font-medium text-ink-900">{c.name}</Text>
                    <Text className="text-[12px] text-ink-500">{`${c.reason} · ${c.periodsToday} period${c.periodsToday === 1 ? "" : "s"} that day`}</Text>
                  </View>
                  {i === 0 && c.tier <= 3 ? <Text className="text-[11px] font-semibold text-emerald-700">Best fit</Text> : null}
                </Pressable>
              ))}
              {!showOthers && pickRow.candidates.some((c) => c.tier > 3) ? (
                <Pressable onPress={() => setShowOthers(true)} className="border-t border-ink-100 px-3 py-2.5 active:bg-ink-50">
                  <Text className="text-[13px] font-medium text-ink-600">
                    {`Other free teachers (${pickRow.candidates.filter((c) => c.tier > 3).length}) · don't teach ${pickRow.classLabel}`}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={Boolean(busy)}
                onPress={() => void noLesson(pickRow, pick?.on)}
                className={`flex-row items-center gap-3 px-3 py-2.5 active:bg-ink-50 border-t border-ink-100`}
              >
                <View className="h-8 w-8 items-center justify-center rounded-full bg-ink-100">
                  <Ionicons name="remove" size={16} color="#475569" />
                </View>
                <Text className="text-[14px] text-ink-900">Free period (no lesson)</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(subjectFor)}
        sheetOnPhone
        title={subjectFor ? `What will ${first(subjectFor.teacher.name)} teach?` : ""}
        onClose={() => setSubjectFor(null)}
        footer={
          subjectFor ? (
            <View className="flex-row justify-end">
              <Pressable
                accessibilityRole="button"
                disabled={Boolean(busy)}
                onPress={() => void saveCover(subjectFor.row, subjectFor.teacher, subjectFor.subjectId, subjectFor.on)}
                className="rounded-xl bg-[#1F45C7] px-4 py-2.5 active:opacity-80"
              >
                <Text className="text-[14px] font-semibold text-white">{busy ? "Assigning…" : `Give to ${first(subjectFor.teacher.name)}`}</Text>
              </Pressable>
            </View>
          ) : null
        }
      >
        {subjectFor ? (
          <View className="gap-3">
            <Text className="text-[13px] text-ink-600">
              {`${subjectFor.row.period} · ${subjectFor.row.classLabel} (${subjectFor.row.subject} in the routine). ${first(subjectFor.teacher.name)} teaches these in ${subjectFor.row.classLabel}. Pick one.`}
            </Text>
            <View className="overflow-hidden rounded-xl border border-ink-100">
              {subjectFor.teacher.subjects.map((x) => ({ id: x.id, label: x.name, hint: "" })).map((opt, i) => {
                const on = subjectFor.subjectId === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => setSubjectFor({ ...subjectFor, subjectId: opt.id })}
                    className={`flex-row items-center gap-3 px-3 py-2.5 ${i ? "border-t border-ink-100" : ""} ${on ? "bg-[#EEF3FF]" : "active:bg-ink-50"}`}
                  >
                    <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={17} color={on ? "#1F45C7" : "#94A3B8"} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-[14px] font-medium text-ink-900">{opt.label}</Text>
                      {opt.hint ? <Text className="text-[12px] text-ink-500">{opt.hint}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(pickGap)}
        sheetOnPhone
        title={pickGap ? `Who takes ${pickGap.classLabel} attendance?` : ""}
        onClose={() => {
          setPickGap(null);
          setShowOtherAtt(false);
        }}
      >
        {pickGap
          ? (() => {
              const ofClass = pickGap.candidates.filter((c) => c.hint);
              const others = pickGap.candidates.filter((c) => !c.hint);
              const list = [...ofClass, ...(showOtherAtt || !ofClass.length ? others : [])];
              return (
                <View className="gap-3">
                  <Text className="text-[13px] text-ink-600">
                    {`${pickGap.teacherName} is ${pickGap.why.toLowerCase()}. Teachers of ${pickGap.classLabel} who are in today come first. It is for today only, and they get a notice.`}
                  </Text>
                  <View className="overflow-hidden rounded-xl border border-ink-100">
                    {!ofClass.length ? (
                      <Text className="px-3 py-2.5 text-[12px] text-ink-500">{`No teacher of ${pickGap.classLabel} is in today. Pick anyone below.`}</Text>
                    ) : null}
                    {list.map((c, i) => (
                      <Pressable
                        key={c.id}
                        accessibilityRole="button"
                        disabled={Boolean(busy)}
                        onPress={() => void attendanceTo(pickGap, c)}
                        className={`flex-row items-center gap-3 px-3 py-2.5 active:bg-ink-50 ${i || !ofClass.length ? "border-t border-ink-100" : ""} ${c.hint ? "" : "bg-ink-50/50"}`}
                      >
                        <View className={`h-8 w-8 items-center justify-center rounded-full ${c.hint ? "bg-[#EEF3FF]" : "bg-ink-100"}`}>
                          <Text className={`text-[10px] font-bold ${c.hint ? "text-[#1F45C7]" : "text-ink-600"}`}>{initials(c.name)}</Text>
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text className="text-[14px] font-medium text-ink-900">{c.name}</Text>
                          <Text className="text-[12px] text-ink-500">{c.hint || `Doesn't teach ${pickGap.classLabel}`}</Text>
                        </View>
                        {i === 0 && c.hint ? <Text className="text-[11px] font-semibold text-emerald-700">Best fit</Text> : null}
                      </Pressable>
                    ))}
                    {ofClass.length && others.length && !showOtherAtt ? (
                      <Pressable onPress={() => setShowOtherAtt(true)} className="border-t border-ink-100 px-3 py-2.5 active:bg-ink-50">
                        <Text className="text-[13px] font-medium text-ink-600">{`Other teachers (${others.length}) · don't teach ${pickGap.classLabel}`}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })()
          : null}
      </Modal>
    </View>
  );
}
