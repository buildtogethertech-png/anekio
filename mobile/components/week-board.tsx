import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal as RnModal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Chip, ChipScroller, Empty, Field, Input, Modal, PageHeader, Toast, useToast } from "./ui";
import { DEFAULT_SUBJECTS } from "./school-setup";
import { act } from "../lib/mutate";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";

const QUALIFICATION_OPTIONS = [
  "B.Ed",
  "M.Ed",
  "B.El.Ed",
  "B.Sc",
  "M.Sc",
  "B.A",
  "M.A",
  "B.Tech",
  "CTET",
  "TET",
  "NET",
];

type Hold = { teacherId: string; subjectName: string };
type ModalKind = "teacher" | "addTeacher" | null;
type WeekSlot = {
  weekday: number;
  periodId?: string;
  period?: string;
  subject?: string;
  teacher?: string;
  covers?: { date: string; substituteId: string; substitute: string; absentTeacher: string }[];
};

type DragEvt = {
  preventDefault?: () => void;
  dataTransfer?: {
    setData: (k: string, v: string) => void;
    getData: (k: string) => string;
    effectAllowed: string;
    dropEffect: string;
  };
};

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

function webNode(ref: RefObject<View | null>): HTMLElement | null {
  if (Platform.OS !== "web") return null;
  const node = ref.current as unknown;
  if (node && typeof node === "object" && "addEventListener" in node) return node as HTMLElement;
  return null;
}

function parseHold(raw: string): Hold | null {
  try {
    const p = JSON.parse(raw) as Hold;
    if (p?.teacherId && p?.subjectName) return p;
  } catch {
    /* ignore */
  }
  return null;
}

function parseQualification(raw?: string | null) {
  if (!raw) return { tags: [] as string[], notes: "" };
  const [head, ...rest] = raw.split(" — ");
  const notes = rest.join(" — ").trim();
  const parts = head.split(" · ").map((s) => s.trim()).filter(Boolean);
  const tags = parts.filter((t) => QUALIFICATION_OPTIONS.includes(t));
  const leftover = parts.filter((t) => !QUALIFICATION_OPTIONS.includes(t));
  return { tags, notes: [notes, ...leftover].filter(Boolean).join(" · ") };
}

function jsToWeekday(jsDay: number) {
  return jsDay === 0 ? 7 : jsDay;
}

export function WeekBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const split = width >= 1100;
  const phone = width < 700;
  const toast = useToast();
  const table = data?.timetable;
  const classes = table?.classes ?? [];
  const teachers = table?.teachers ?? [];
  const periods = table?.periods ?? [];
  const weekdays = table?.weekdays ?? [];
  const [classId, setClassId] = useState(classes[0]?.id || "");
  const klass = classes.find((c) => c.id === classId) || classes[0];
  useEffect(() => {
    if (!classId && classes[0]?.id) setClassId(classes[0].id);
  }, [classId, classes[0]?.id]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [over, setOver] = useState("");
  const [error, setError] = useState("");
  const [modal, setModal] = useState<ModalKind>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [assign, setAssign] = useState<{
    periodId: string;
    weekday: number;
    periodName: string;
    current?: { subject: string; teacher: string };
  } | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [focus, setFocus] = useState("");
  const [fillOpen, setFillOpen] = useState(false);
  const [filling, setFilling] = useState("");
  const todayN = jsToWeekday(new Date().getDay());
  const [day, setDay] = useState<number>(
    weekdays.some((d) => d.n === todayN) ? todayN : weekdays[0]?.n ?? 1
  );
  const activeDay = weekdays.some((d) => d.n === day) ? day : weekdays[0]?.n ?? 1;
  const teamWeek = Boolean(data?.teamWeek);
  const editable = can(user, "timetable.edit") || teamWeek;
  const periodsNotSet = periods.length === 0;
  const weekCapacity =
    table?.weekCapacity ?? weekdays.length * periods.filter((p) => !p.isBreak).length;
  const holdTeacher = hold ? teachers.find((t) => t.id === hold.teacherId)?.name : "";
  const teachable = periods.filter((p) => !p.isBreak).length;
  const dayFill = useMemo(() => {
    const slots = klass?.slots ?? [];
    return Object.fromEntries(
      weekdays.map((d) => [
        d.n,
        slots.filter((s) => s.weekday === d.n && s.subject && s.subject !== "—").length,
      ])
    ) as Record<number, number>;
  }, [klass?.slots, weekdays]);

  function pickSubject(teacherId: string, subjectName: string, toggle?: boolean) {
    if (!editable) return;
    setHold((cur) => {
      if (!toggle) return { teacherId, subjectName };
      return cur?.teacherId === teacherId && cur.subjectName === subjectName
        ? null
        : { teacherId, subjectName };
    });
  }

  useEffect(() => {
    if (!weekdays.length) return;
    if (!weekdays.some((d) => d.n === day)) {
      setDay(weekdays.some((d) => d.n === todayN) ? todayN : weekdays[0].n);
    }
  }, [weekdays, day, todayN]);

  const loadRows = useMemo(() => {
    if (!klass?.subjects?.length) return [] as { name: string; placed: number; need: number; state: "over" | "short" | "ok" | "none" }[];
    const rank = { over: 0, short: 1, ok: 2, none: 3 } as const;
    return klass.subjects
      .map((sub) => {
        const placed = klass.slots.filter((slot) => slot.subject === sub.name).length;
        const need = sub.weightage || 0;
        const state = (!need ? "none" : placed > need ? "over" : placed < need ? "short" : "ok") as "over" | "short" | "ok" | "none";
        return { name: sub.name, placed, need, state };
      })
      .sort((a, b) => rank[a.state] - rank[b.state] || a.name.localeCompare(b.name));
  }, [klass?.subjects, klass?.slots]);

  const summary = useMemo(() => {
    let placed = 0;
    if (klass) {
      for (const d of weekdays) for (const p of periods) if (!p.isBreak && slotFilled(findSlot(klass.slots, p, d.n))) placed += 1;
    }
    return {
      placed: Math.min(placed, weekCapacity),
      empty: Math.max(0, weekCapacity - placed),
      over: loadRows.filter((r) => r.state === "over").length,
      short: loadRows.filter((r) => r.state === "short").length,
    };
  }, [klass?.slots, periods, weekdays, weekCapacity, loadRows]);

  /** Fill empty cells with the subjects furthest below target, using teachers who are free at that time. */
  const fillPlan = useMemo(() => {
    if (!klass?.id) return { moves: [] as { periodId: string; weekday: number; teacherId: string; teacherName: string; subjectName: string }[], left: 0 };
    const remaining = new Map(loadRows.filter((r) => r.state === "short").map((r) => [r.name, r.need - r.placed]));
    const busy = new Set<string>();
    for (const c of classes) {
      if (c.id === klass.id) continue;
      for (const o of c.slots as (WeekSlot & { teacherId?: string })[]) {
        const pid = o.periodId || periods.find((p) => p.name === o.period)?.id || "";
        if (o.teacherId) busy.add(`${o.teacherId}:${o.weekday}:${pid}`);
        if (o.teacher) busy.add(`n:${o.teacher}:${o.weekday}:${pid}`);
      }
    }
    const dayHas = new Set(klass.slots.filter((x) => slotSubject(x)).map((x) => `${x.weekday}:${slotSubject(x)}`));
    const moves: { periodId: string; weekday: number; teacherId: string; teacherName: string; subjectName: string }[] = [];
    let left = 0;
    for (const d of weekdays) {
      for (const p of periods) {
        if (p.isBreak) continue;
        if (slotFilled(findSlot(klass.slots, p, d.n))) continue;
        const options = [...remaining.entries()]
          .filter(([, n]) => n > 0)
          .sort((a, b) => Number(dayHas.has(`${d.n}:${a[0]}`)) - Number(dayHas.has(`${d.n}:${b[0]}`)) || b[1] - a[1]);
        let placed = false;
        for (const [subjectName] of options) {
          const t = teachers.find(
            (t) =>
              t.skills.some((sk) => sk.subjectName === subjectName && (!sk.classId || sk.classId === klass.id)) &&
              !busy.has(`${t.id}:${d.n}:${p.id}`) &&
              !busy.has(`n:${t.name}:${d.n}:${p.id}`)
          );
          if (!t) continue;
          moves.push({ periodId: p.id, weekday: d.n, teacherId: t.id, teacherName: t.name, subjectName });
          remaining.set(subjectName, (remaining.get(subjectName) || 0) - 1);
          busy.add(`${t.id}:${d.n}:${p.id}`);
          dayHas.add(`${d.n}:${subjectName}`);
          placed = true;
          break;
        }
        if (!placed) left += 1;
      }
    }
    return { moves, left };
  }, [klass?.id, klass?.slots, classes, loadRows, periods, weekdays, teachers]);

  async function runFill() {
    if (!klass?.id || !fillPlan.moves.length) return;
    setError("");
    let done = 0;
    try {
      for (const m of fillPlan.moves) {
        setFilling(`Placing ${done + 1} of ${fillPlan.moves.length}…`);
        await act(token, "saveTimetableSlot", {
          classId: klass.id,
          periodId: m.periodId,
          weekday: m.weekday,
          teacherId: m.teacherId,
          subjectName: m.subjectName,
        });
        done += 1;
      }
      toast.show(`${done} ${done === 1 ? "period" : "periods"} placed.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Auto-fill stopped.");
    } finally {
      setFilling("");
      setFillOpen(false);
      await reload();
    }
  }

  async function dropOn(periodId: string, weekday: number, payload: Hold) {
    if (!klass?.id) return;
    setError("");
    try {
      await act(token, "saveTimetableSlot", {
        classId: klass.id,
        periodId,
        weekday,
        teacherId: payload.teacherId,
        subjectName: payload.subjectName,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  function placeOrPick(
    periodId: string,
    weekday: number,
    slots: WeekSlot[]
  ) {
    if (!editable) return;
    if (hold) {
      dropOn(periodId, weekday, hold);
      return;
    }
    const period = periods.find((p) => p.id === periodId);
    const slot = findSlot(slots, period ?? { id: periodId, name: "" }, weekday);
    if (slotFilled(slot)) return;
    setAssign({ periodId, weekday, periodName: period?.name || "Period" });
  }

  async function clearCell(periodId: string, weekday: number) {
    if (!klass?.id) return;
    setError("");
    try {
      await act(token, "saveTimetableSlot", {
        classId: klass.id,
        periodId,
        weekday,
        clear: true,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear.");
    }
  }

  if (!table) return <Empty title="No timetable" body="Admin fills the grid." />;

  const railTeachers = useMemo(
    () =>
      [...teachers].sort(
        (a, b) =>
          Number(Boolean(b.team)) - Number(Boolean(a.team)) ||
          Number(Boolean(b.idle)) - Number(Boolean(a.idle)) ||
          a.name.localeCompare(b.name)
      ),
    [teachers]
  );

  const teacherRail = (
    <TeacherRail
      teachers={railTeachers}
      hold={hold}
      editable={editable}
      compact={phone}
      classId={klass?.id}
      canAdd={can(user, "staff.edit")}
      onAdd={() => setModal("addTeacher")}
      onEdit={
        can(user, "staff.edit")
          ? (id) => {
              setTeacherId(id);
              setModal("teacher");
            }
          : undefined
      }
      onPick={pickSubject}
      scroll={split}
    />
  );

  return (
    <View className="min-h-0 flex-1">
      {phone ? null : (
        <PageHeader
          compact
          kicker={teamWeek ? "Team" : "Admin · One screen"}
          title={teamWeek ? "Team routine" : "Routine"}
          lede={
            teamWeek
              ? "Empty periods in your team’s classes. Free teachers are marked — drop one on the hole."
              : "Drag a subject onto a cell, or click a cell to choose."
          }
          action={
            editable && klass && !periodsNotSet && summary.empty > 0 ? (
              <Button onPress={() => setFillOpen(true)}>
                {`Auto-fill ${summary.empty} empty`}
              </Button>
            ) : undefined
          }
        />
      )}
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className={split ? "mt-3 min-h-0 flex-1 flex-row gap-6" : phone ? "min-h-0 flex-1" : "mt-3 min-h-0 flex-1"}>
        {split && !periodsNotSet ? <View className="min-h-0 w-1/4 max-w-xs shrink-0">{teacherRail}</View> : null}

        <View className="min-h-0 min-w-0 flex-1">
          <View className="shrink-0 gap-2">
            {phone ? <Text className="text-[22px] font-bold tracking-tight text-ink-900">{teamWeek ? "Team routine" : "Timetable"}</Text> : null}
            <View className={phone ? "" : "flex-row items-center gap-4"}>
              <View className={phone ? "" : "min-w-0 flex-1"}>
                <ChipScroller>
                  {classes.map((c) => (
                    <Chip
                      key={c.id || c.label}
                      label={c.label}
                      active={klass?.id === c.id}
                      onPress={() => setClassId(c.id || "")}
                    />
                  ))}
                </ChipScroller>
              </View>
              {!phone && klass && !periodsNotSet ? (
                <View className="shrink-0 flex-row items-center gap-2">
                  <Ionicons
                    name={summary.empty || summary.over || summary.short ? "pie-chart-outline" : "checkmark-circle"}
                    size={15}
                    color={summary.empty || summary.over || summary.short ? "#64748b" : "#16a34a"}
                  />
                  <Text className="text-[13px] text-ink-700">
                    <Text className="font-semibold text-ink-900">{summary.placed}</Text> of {weekCapacity} placed
                    {summary.empty ? ` · ${summary.empty} empty` : ""}
                    {summary.over ? <Text className="text-red-700">{` · ${summary.over} over`}</Text> : null}
                    {summary.short ? <Text className="text-amber-700">{` · ${summary.short} short`}</Text> : null}
                    {!summary.empty && !summary.over && !summary.short ? " · all on target" : ""}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {phone && klass?.subjects?.length && !periodsNotSet ? (
            (() => {
              const load = klass.subjects!.map((sub) => {
                const placed = klass.slots.filter((slot) => slot.subject === sub.name).length;
                const need = sub.weightage || 0;
                return { name: sub.name, placed, need, state: !need ? "none" : placed > need ? "over" : placed < need ? "short" : "ok" };
              });
              const overN = load.filter((r) => r.state === "over").length;
              const shortN = load.filter((r) => r.state === "short").length;
              return (
                <View className="mt-3 shrink-0 overflow-hidden rounded-xl border border-ink-100 bg-white">
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setLoadOpen((v) => !v)}
                    className="flex-row items-center gap-2 px-3 py-2.5"
                  >
                    <Ionicons
                      name={overN || shortN ? "warning-outline" : "checkmark-circle-outline"}
                      size={16}
                      color={overN ? "#b91c1c" : shortN ? "#b45309" : "#15803d"}
                    />
                    <Text className="flex-1 text-sm text-ink-800">
                      {overN || shortN
                        ? [overN ? `${overN} ${overN === 1 ? "subject" : "subjects"} over` : "", shortN ? `${shortN} short` : ""].filter(Boolean).join(" · ")
                        : "All subjects on target"}
                    </Text>
                    <Text className="text-xs text-ink-500">Subject load</Text>
                    <Ionicons name={loadOpen ? "chevron-up" : "chevron-down"} size={14} color="#64748b" />
                  </Pressable>
                  {loadOpen ? (
                    <View className="gap-2.5 border-t border-ink-100 px-3 py-3">
                      {load.map((r) => {
                        const tone = r.state === "over" ? "bg-red-500" : r.state === "short" ? "bg-amber-400" : "bg-emerald-500";
                        const pct = r.need ? Math.min(100, Math.round((r.placed / r.need) * 100)) : r.placed ? 100 : 0;
                        return (
                          <View key={r.name}>
                            <View className="flex-row items-center justify-between gap-2">
                              <Text className="text-sm text-ink-900">{r.name}</Text>
                              <Text
                                className={`text-xs ${
                                  r.state === "over" ? "font-semibold text-red-700" : r.state === "short" ? "font-semibold text-amber-800" : "text-ink-500"
                                }`}
                              >
                                {r.need ? `${r.placed} of ${r.need}` : `${r.placed} placed`}
                                {r.state === "over" ? ` · +${r.placed - r.need} over` : r.state === "short" ? ` · ${r.need - r.placed} short` : ""}
                              </Text>
                            </View>
                            <View className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                              <View className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
                            </View>
                          </View>
                        );
                      })}
                      <Text className="text-[11px] text-ink-500">Targets are periods per week, set under School settings → Subjects.</Text>
                    </View>
                  ) : null}
                </View>
              );
            })()
          ) : null}

          {!phone && loadRows.length && !periodsNotSet ? (
            <View className="mt-2.5 shrink-0 flex-row flex-wrap items-center gap-1.5">
              {loadRows.map((r) => {
                const on = focus === r.name;
                return (
                  <Pressable
                    key={r.name}
                    accessibilityRole="button"
                    accessibilityLabel={`Show only ${r.name}`}
                    onPress={() => setFocus(on ? "" : r.name)}
                    className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 ${on ? "border-ink-900 bg-ink-50" : "border-ink-200 bg-white"}`}
                  >
                    <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: subjectTone(r.name) }} />
                    <Text className="text-xs text-ink-700">{r.name}</Text>
                    <Text
                      className={`text-xs font-semibold ${
                        r.state === "over" ? "text-red-700" : r.state === "short" ? "text-amber-700" : "text-ink-500"
                      }`}
                    >
                      {r.placed}/{r.need || "—"}
                      {r.state === "over" ? ` +${r.placed - r.need}` : ""}
                    </Text>
                    {r.state === "ok" ? <Ionicons name="checkmark" size={12} color="#16a34a" /> : null}
                  </Pressable>
                );
              })}
              {focus ? (
                <Pressable onPress={() => setFocus("")} className="px-1 py-1">
                  <Text className="text-xs font-medium text-clay-600">Show all</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {error ? <Text className="mt-2 shrink-0 text-sm text-red-700">{error}</Text> : null}
          {hold ? (
            <View className="mt-2 shrink-0 flex-row items-center gap-2 rounded-md border border-clay-500 bg-blue-50 px-3 py-2.5">
              <Text className="flex-1 text-sm text-clay-600">
                {hold.subjectName}
                {holdTeacher ? ` · ${holdTeacher}` : ""} — tap a period
                {phone ? "" : " or drop it"}
              </Text>
              <Pressable onPress={() => setHold(null)} className="min-h-[40px] justify-center px-2">
                <Text className="text-sm font-medium text-ink-800">Cancel</Text>
              </Pressable>
            </View>
          ) : (phone || !periodsNotSet) && klass ? null : (
            <Text className="mt-2 shrink-0 text-sm text-ink-700">
              {periodsNotSet
                ? "No periods found. Set bell periods before placing teachers."
                : klass
                ? phone
                  ? `${klass.label} · ${weekCapacity} periods this week.`
                  : `${klass.label} · ${weekCapacity} periods this week. Drag a subject onto a cell.`
                : "Add a class to start the week."}
            </Text>
          )}

          <View className="mt-3 min-h-0 flex-1">
            {periodsNotSet ? (
              <MissingPeriodsGrid onPress={() => router.push("/school?tab=clock" as never)} />
            ) : klass ? (
              phone ? (
                <ScrollView className="min-h-0 flex-1" nestedScrollEnabled contentContainerStyle={{ paddingBottom: 110 }}>
                  <PhoneDaySchedule
                    weekdays={weekdays}
                    periods={periods}
                    slots={klass.slots}
                    others={classes.filter((c) => c.id !== klass.id)}
                    activeDay={activeDay}
                    fill={dayFill}
                    teachable={teachable}
                    hold={Boolean(hold)}
                    editable={editable}
                    onDay={setDay}
                    onPress={(periodId, weekday, slot) => {
                      if (!editable) return;
                      if (hold) {
                        void dropOn(periodId, weekday, hold);
                        return;
                      }
                      const period = periods.find((x) => x.id === periodId);
                      setAssign({
                        periodId,
                        weekday,
                        periodName: period?.name || "Period",
                        current: slotFilled(slot) ? { subject: slotSubject(slot), teacher: slot?.teacher || "" } : undefined,
                      });
                    }}
                  />
                  {!split ? <View className="mt-4">{teacherRail}</View> : null}
                </ScrollView>
              ) : (
                <WeekGrid
                  weekdays={weekdays}
                  periods={periods}
                  slots={klass.slots}
                  hold={Boolean(hold)}
                  over={over}
                  editable={editable}
                  onOver={setOver}
                  onLeave={() => setOver("")}
                  onDrop={dropOn}
                  onPlace={(periodId, weekday) => placeOrPick(periodId, weekday, klass.slots)}
                  onClear={clearCell}
                  others={classes.filter((c) => c.id !== klass.id)}
                  focus={focus}
                  footer={!split ? teacherRail : null}
                />
              )
            ) : (
              <Empty title="Pick a class" body="Assign periods on the grid." />
            )}
          </View>
        </View>
      </View>

      {phone ? (
        <RnModal visible={Boolean(assign)} transparent animationType="slide" onRequestClose={() => setAssign(null)}>
          <View className="flex-1 justify-end">
            <Pressable accessibilityRole="button" accessibilityLabel="Close" className="absolute inset-0 bg-black/40" onPress={() => setAssign(null)} />
            <View className="rounded-t-3xl bg-white" style={{ maxHeight: "85%" }}>
              <SafeAreaView edges={["bottom"]}>
                <View className="items-center pt-2">
                  <View className="h-1 w-10 rounded-full bg-ink-200" />
                </View>
                <View className="flex-row items-start gap-3 px-5 pb-2 pt-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-lg font-semibold text-ink-900">
                      {assign ? `${weekdays.find((d) => d.n === assign.weekday)?.label || ""} · ${assign.periodName}` : ""}
                    </Text>
                    <Text className="text-xs text-ink-500">
                      {assign?.current ? `Now: ${assign.current.subject}${assign.current.teacher ? ` · ${assign.current.teacher}` : ""}` : "Empty period"}
                    </Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={() => setAssign(null)} className="h-8 w-8 items-center justify-center rounded-full bg-ink-100">
                    <Ionicons name="close" size={18} color="#3d4f66" />
                  </Pressable>
                </View>
                <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}>
                  <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                    {assign?.current ? "Change to" : "Who takes this period"}
                  </Text>
                  <PhoneAssignList
                    teachers={teachers}
                    classId={klass?.id}
                    current={assign?.current}
                    onPick={async (payload) => {
                      if (!assign) return;
                      await dropOn(assign.periodId, assign.weekday, payload);
                      setAssign(null);
                    }}
                  />
                </ScrollView>
                {assign?.current ? (
                  <View className="border-t border-ink-100 px-5 pb-2 pt-3">
                    <Pressable
                      accessibilityRole="button"
                      onPress={async () => {
                        if (!assign) return;
                        await clearCell(assign.periodId, assign.weekday);
                        setAssign(null);
                      }}
                      className="h-12 flex-row items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50"
                    >
                      <Ionicons name="trash-outline" size={17} color="#b91c1c" />
                      <Text className="text-[15px] font-semibold text-red-700">Clear period</Text>
                    </Pressable>
                  </View>
                ) : null}
              </SafeAreaView>
            </View>
          </View>
        </RnModal>
      ) : null}

      <Modal
        open={fillOpen}
        title={`Auto-fill ${klass?.label || ""}`}
        onClose={() => (filling ? undefined : setFillOpen(false))}
        footer={
          <View className="flex-row items-center justify-end gap-2">
            <Button variant="ghost" disabled={Boolean(filling)} onPress={() => setFillOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!fillPlan.moves.length || Boolean(filling)} onPress={() => void runFill()}>
              {filling || (fillPlan.moves.length ? `Place ${fillPlan.moves.length} ${fillPlan.moves.length === 1 ? "period" : "periods"}` : "Nothing to place")}
            </Button>
          </View>
        }
      >
        <View className="gap-3">
          <Text className="text-sm leading-5 text-ink-700">
            Fills empty periods with the subjects that are furthest below target, using teachers who are free at that time. Filled periods are not touched.
          </Text>
          {fillPlan.moves.length ? (
            <View className="overflow-hidden rounded-xl border border-ink-200">
              {Object.entries(
                fillPlan.moves.reduce<Record<string, { n: number; who: Set<string> }>>((acc, m) => {
                  const row = acc[m.subjectName] || { n: 0, who: new Set<string>() };
                  row.n += 1;
                  row.who.add(m.teacherName);
                  acc[m.subjectName] = row;
                  return acc;
                }, {})
              ).map(([name, row], i) => (
                <View key={name} className={`flex-row items-center gap-3 px-4 py-2.5 ${i ? "border-t border-ink-100" : ""}`}>
                  <View className="h-2 w-2 rounded-full" style={{ backgroundColor: subjectTone(name) }} />
                  <View className="min-w-0 flex-1">
                    <Text className="text-[14px] font-semibold text-ink-900">{name}</Text>
                    <Text className="text-[12px] text-ink-500" numberOfLines={1}>
                      {[...row.who].join(", ")}
                    </Text>
                  </View>
                  <Text className="text-[13px] font-semibold text-ink-800">+{row.n}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text className="text-sm text-ink-500">No free teacher matches the subjects that are short. Add teachers or adjust targets.</Text>
          )}
          {fillPlan.left ? (
            <Text className="text-[12px] text-amber-700">
              {fillPlan.left} {fillPlan.left === 1 ? "period stays" : "periods stay"} empty — no subject is short or no teacher is free then.
            </Text>
          ) : null}
        </View>
      </Modal>

      <Modal
        open={!phone && Boolean(assign)}
        wide
        title={
          assign
            ? `${weekdays.find((d) => d.n === assign.weekday)?.label || ""} · ${assign.periodName}${
                periods.find((x) => x.id === assign.periodId)
                  ? ` (${periods.find((x) => x.id === assign.periodId)!.start}–${periods.find((x) => x.id === assign.periodId)!.end})`
                  : ""
              }`
            : "Place"
        }
        onClose={() => setAssign(null)}
        footer={
          assign ? (
            <View className="flex-row items-center justify-between gap-3">
              <Text className="min-w-0 flex-1 text-sm text-ink-500" numberOfLines={1}>
                {assign.current
                  ? `Now: ${assign.current.subject}${assign.current.teacher ? ` · ${assign.current.teacher}` : ""}`
                  : `${klass?.label || ""} · empty period`}
              </Text>
              {assign.current ? (
                <Button
                  variant="ghost"
                  onPress={async () => {
                    await clearCell(assign.periodId, assign.weekday);
                    setAssign(null);
                  }}
                >
                  Clear period
                </Button>
              ) : null}
              <Button variant="ghost" onPress={() => setAssign(null)}>
                Cancel
              </Button>
            </View>
          ) : null
        }
      >
        {assign && klass ? (
          <DeskAssignPanel
            teachers={teachers}
            classId={klass.id}
            subjects={klass.subjects || []}
            slots={klass.slots}
            others={classes.filter((c) => c.id !== klass.id)}
            periodId={assign.periodId}
            periodName={assign.periodName}
            weekday={assign.weekday}
            current={assign.current}
            onPick={async (payload) => {
              await dropOn(assign.periodId, assign.weekday, payload);
              setAssign(null);
            }}
          />
        ) : null}
      </Modal>

      <Modal open={modal === "addTeacher"} title="Add teacher" wide onClose={() => setModal(null)}>
        <TeacherForm
          classes={classes.map((c) => ({ id: c.id || "", label: c.label }))}
          onCancel={() => setModal(null)}
          onSave={async (payload) => {
            await act(token, "createTeacher", payload);
            setModal(null);
            toast.show("Teacher added.");
            await reload();
          }}
        />
      </Modal>

      <Modal open={modal === "teacher" && Boolean(teacherId)} title="Edit teacher" wide onClose={() => setModal(null)}>
        {teacherId ? (
          <TeacherForm
            teacher={teachers.find((t) => t.id === teacherId)}
            classes={classes.map((c) => ({ id: c.id || "", label: c.label }))}
            onCancel={() => setModal(null)}
            onSave={async (payload) => {
              await act(token, "setTeacherResources", { ...payload, teacherId });
              setModal(null);
              toast.show("Teacher saved.");
              await reload();
            }}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function slotFilled(slot?: { subject?: string; teacher?: string } | null) {
  if (!slot) return false;
  return Boolean(slot.subject && slot.subject !== "—" ? slot.subject : slot.teacher);
}

function slotSubject(slot?: { subject?: string } | null) {
  return slot?.subject && slot.subject !== "—" ? slot.subject : "";
}

function findSlot(
  slots: WeekSlot[],
  period: { id: string; name: string },
  weekday: number
) {
  return slots.find((s) => s.weekday === weekday && (s.periodId === period.id || s.period === period.name));
}

function TeacherRail({
  teachers,
  hold,
  editable,
  compact,
  classId,
  canAdd,
  onAdd,
  onEdit,
  onPick,
  scroll,
}: {
  teachers: {
    id: string;
    name: string;
    qualification?: string;
    idle?: boolean;
    team?: boolean;
    skills: { subjectName: string; classId: string }[];
  }[];
  hold: Hold | null;
  editable: boolean;
  compact?: boolean;
  classId?: string;
  canAdd?: boolean;
  onAdd?: () => void;
  onEdit?: (id: string) => void;
  onPick: (teacherId: string, subjectName: string, toggle?: boolean) => void;
  scroll?: boolean;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? teachers.filter((t) => t.name.toLowerCase().includes(needle) || t.skills.some((s) => s.subjectName.toLowerCase().includes(needle)))
    : teachers;
  const cards = (
    <>
      {shown.map((t) => {
        const skills = [
          ...new Set(
            t.skills
              .filter((s) => !classId || !s.classId || s.classId === classId)
              .map((s) => s.subjectName)
          ),
        ];
        if (compact && classId && !skills.length) return null;
        return (
          <TeacherCard
            key={t.id}
            teacherId={t.id}
            name={t.name}
            qualification={compact ? undefined : t.qualification}
            idle={t.idle}
            team={t.team}
            skills={skills.length ? skills : [...new Set(t.skills.map((s) => s.subjectName))]}
            hold={hold}
            editable={editable}
            compact={compact}
            onEdit={onEdit ? () => onEdit(t.id) : undefined}
            onPick={(subjectName, toggle) => onPick(t.id, subjectName, toggle)}
          />
        );
      })}
      {!teachers.length ? (
        <Text className="text-sm text-ink-700">Add teachers under Employees first.</Text>
      ) : !shown.length ? (
        <Text className="text-sm text-ink-500">No teacher matches "{q.trim()}".</Text>
      ) : null}
    </>
  );

  return (
    <View className={scroll ? "min-h-0 flex-1" : "gap-3"}>
      <View className="shrink-0 flex-row items-center justify-between gap-2">
        <Text className="text-xs uppercase tracking-widest text-ink-700">
          {compact ? "Or pick a subject to fill several" : "Teachers — drag a subject"}
        </Text>
        {canAdd ? (
          <Pressable onPress={onAdd} className="min-h-[36px] justify-center">
            <Text className="text-xs font-medium text-clay-600">+ Teacher</Text>
          </Pressable>
        ) : null}
      </View>
      {!compact && teachers.length > 4 ? (
        <View className="mt-2 shrink-0 flex-row items-center gap-2 rounded-lg border border-ink-200 bg-white px-3">
          <Ionicons name="search" size={14} color="#94a3b8" />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Find teacher or subject"
            placeholderTextColor="#94a3b8"
            className="min-h-[36px] flex-1 text-sm text-ink-900"
          />
          {q ? (
            <Pressable accessibilityLabel="Clear search" onPress={() => setQ("")}>
              <Ionicons name="close-circle" size={16} color="#94a3b8" />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {scroll ? (
        <ScrollView className="min-h-0 flex-1" nestedScrollEnabled contentContainerClassName="gap-3 pb-4 pt-3">
          {cards}
        </ScrollView>
      ) : (
        <View className="gap-3">{cards}</View>
      )}
    </View>
  );
}

function DeskAssignPanel({
  teachers,
  classId,
  subjects,
  slots,
  others,
  periodId,
  periodName,
  weekday,
  current,
  onPick,
}: {
  teachers: { id: string; name: string; skills: { subjectName: string; classId: string }[] }[];
  classId?: string;
  subjects: { name: string; weightage?: number }[];
  slots: WeekSlot[];
  others: { label: string; slots: (WeekSlot & { teacherId?: string })[] }[];
  periodId: string;
  periodName: string;
  weekday: number;
  current?: { subject: string; teacher: string };
  onPick: (payload: Hold) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const needle = q.trim().toLowerCase();

  const busyIn = (t: { id: string; name: string }) =>
    others
      .filter((c) =>
        c.slots.some(
          (o) =>
            o.weekday === weekday &&
            (o.periodId === periodId || o.period === periodName) &&
            ((o.teacherId && o.teacherId === t.id) || (!o.teacherId && o.teacher === t.name))
        )
      )
      .map((c) => c.label);

  const names = [
    ...new Set([
      ...subjects.map((x) => x.name),
      ...teachers.flatMap((t) => t.skills.filter((sk) => !classId || !sk.classId || sk.classId === classId).map((sk) => sk.subjectName)),
    ]),
  ];
  const groups = names
    .map((name) => {
      const need = subjects.find((x) => x.name === name)?.weightage || 0;
      const placed = slots.filter((x) => x.subject === name).length;
      const state = !need ? "none" : placed > need ? "over" : placed < need ? "short" : "ok";
      const who = teachers
        .filter((t) => t.skills.some((sk) => sk.subjectName === name && (!classId || !sk.classId || sk.classId === classId)))
        .map((t) => ({ id: t.id, name: t.name, busy: busyIn(t) }))
        .sort((a, b) => a.busy.length - b.busy.length || a.name.localeCompare(b.name));
      return { name, need, placed, state, who };
    })
    .filter((g) => g.who.length)
    .filter((g) => !needle || g.name.toLowerCase().includes(needle) || g.who.some((w) => w.name.toLowerCase().includes(needle)))
    .sort((a, b) => {
      const rank = (x: string) => (x === "short" ? 0 : x === "none" ? 1 : x === "ok" ? 2 : 3);
      return rank(a.state) - rank(b.state) || (b.need - b.placed) - (a.need - a.placed) || a.name.localeCompare(b.name);
    });

  const rows = groups.flatMap((g) => g.who.map((w) => ({ ...g, teacher: w })));
  const many = rows.length > 6;

  return (
    <View className="gap-3">
      {many ? (
        <View className="flex-row items-center gap-2 rounded-lg border border-ink-200 bg-white px-3">
          <Ionicons name="search" size={14} color="#94a3b8" />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Find subject or teacher"
            placeholderTextColor="#94a3b8"
            className="min-h-[38px] flex-1 text-sm text-ink-900"
          />
        </View>
      ) : null}
      <View className="overflow-hidden rounded-xl border border-ink-200">
        {rows.map((r, ri) => {
          const key = `${r.teacher.id}:${r.name}`;
          const isCurrent = current?.subject === r.name && current?.teacher === r.teacher.name;
          const busy = r.teacher.busy.length > 0;
          const suggested = ri === 0 && !needle && !busy && r.state === "short" && !isCurrent;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`${r.name} with ${r.teacher.name}${busy ? `, busy in ${r.teacher.busy.join(", ")}` : ""}`}
              disabled={Boolean(busyKey) || isCurrent}
              onPress={async () => {
                setBusyKey(key);
                try {
                  await onPick({ teacherId: r.teacher.id, subjectName: r.name });
                } finally {
                  setBusyKey("");
                }
              }}
              className={`flex-row items-center gap-3 px-4 py-3 ${ri ? "border-t border-ink-100" : ""} ${
                isCurrent ? "bg-clay-50" : suggested ? "bg-[#F7F9FF]" : "bg-white"
              } hover:bg-ink-50`}
            >
              <View className="h-2 w-2 rounded-full" style={{ backgroundColor: subjectTone(r.name) }} />
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-[14px] font-semibold text-ink-900" numberOfLines={1}>
                    {r.name}
                  </Text>
                  {suggested ? (
                    <View className="rounded-full bg-clay-50 px-2 py-0.5">
                      <Text className="text-[10px] font-semibold uppercase tracking-wide text-clay-700">Suggested</Text>
                    </View>
                  ) : null}
                </View>
                <Text className="text-[12px] text-ink-500" numberOfLines={1}>
                  {r.teacher.name}
                </Text>
              </View>
              <Text
                className={`w-24 text-right text-[12px] ${
                  r.state === "short" ? "font-semibold text-amber-700" : r.state === "over" ? "font-semibold text-red-700" : "text-ink-500"
                }`}
              >
                {r.state === "short"
                  ? `needs ${r.need - r.placed}`
                  : r.state === "over"
                    ? `${r.placed - r.need} extra`
                    : r.state === "ok"
                      ? "on target"
                      : `${r.placed} placed`}
              </Text>
              <Text className="w-14 text-right text-[11px] text-ink-400">
                {r.placed}/{r.need || "—"}
              </Text>
              <View className="w-32 items-end">
                {isCurrent ? (
                  <Text className="text-[12px] font-semibold text-clay-700">Current</Text>
                ) : busyKey === key ? (
                  <Text className="text-[12px] text-ink-500">Placing…</Text>
                ) : busy ? (
                  <View className="rounded-full bg-red-50 px-2 py-0.5">
                    <Text className="text-[11px] font-medium text-red-700" numberOfLines={1}>
                      Busy · {r.teacher.busy.join(", ")}
                    </Text>
                  </View>
                ) : (
                  <View className="flex-row items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5">
                    <View className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <Text className="text-[11px] font-medium text-emerald-700">Free</Text>
                  </View>
                )}
              </View>
              <Ionicons name="chevron-forward" size={14} color="#cbd5e1" />
            </Pressable>
          );
        })}
        {!rows.length ? (
          <View className="items-center px-4 py-8">
            <Text className="text-sm text-ink-500">
              {needle ? `Nothing matches "${q.trim()}".` : "No teacher is set to teach this class yet."}
            </Text>
          </View>
        ) : null}
      </View>
      <Text className="text-[11px] text-ink-400">Subjects that still need periods are listed first. Click a row to place it.</Text>
    </View>
  );
}

const SUBJECT_TONES = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#db2777", "#0891b2", "#dc2626", "#4f46e5", "#65a30d", "#ea580c"];

function subjectTone(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SUBJECT_TONES[h % SUBJECT_TONES.length];
}

function PhoneAssignList({
  teachers,
  classId,
  current,
  onPick,
}: {
  teachers: { id: string; name: string; skills: { subjectName: string; classId: string }[] }[];
  classId?: string;
  current?: { subject: string; teacher: string };
  onPick: (payload: Hold) => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const offers = teachers.flatMap((t) =>
    [...new Set(t.skills.filter((s) => !classId || !s.classId || s.classId === classId).map((s) => s.subjectName))].map(
      (subjectName) => ({ teacherId: t.id, teacherName: t.name, subjectName })
    )
  );
  if (!offers.length) return <Text className="py-3 text-sm text-ink-600">No teacher is set to teach this class yet.</Text>;
  return (
    <View className="overflow-hidden rounded-xl border border-ink-100">
      {offers.map((o, i) => {
        const key = `${o.teacherId}:${o.subjectName}`;
        const isNow = current?.subject === o.subjectName && current?.teacher === o.teacherName;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            disabled={Boolean(busy) || isNow}
            onPress={async () => {
              setBusy(key);
              try {
                await onPick({ teacherId: o.teacherId, subjectName: o.subjectName });
              } finally {
                setBusy("");
              }
            }}
            className={`flex-row items-center gap-3 px-3 py-3 ${i ? "border-t border-ink-100" : ""} ${isNow ? "bg-[#EEF3FF]" : "active:bg-slate-50"}`}
          >
            <View className="h-8 w-1 rounded-full" style={{ backgroundColor: subjectTone(o.subjectName) }} />
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] font-semibold text-ink-900">{o.subjectName}</Text>
              <Text className="text-xs text-ink-500">{o.teacherName}</Text>
            </View>
            {isNow ? (
              <Text className="text-xs font-semibold text-[#1F45C7]">Current</Text>
            ) : busy === key ? (
              <Text className="text-xs text-ink-500">Saving…</Text>
            ) : (
              <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function PhoneDaySchedule({
  weekdays,
  periods,
  slots,
  others,
  activeDay,
  fill,
  teachable,
  hold,
  editable,
  onDay,
  onPress,
}: {
  weekdays: { n: number; label: string }[];
  periods: { id: string; name: string; start: string; end: string; isBreak?: boolean }[];
  slots: WeekSlot[];
  others: { label: string; slots: (WeekSlot & { teacherId?: string })[] }[];
  activeDay: number;
  fill: Record<number, number>;
  teachable: number;
  hold: boolean;
  editable: boolean;
  onDay: (n: number) => void;
  onPress: (periodId: string, weekday: number, slot?: WeekSlot) => void;
}) {
  return (
    <View className="gap-3">
      <View className="flex-row rounded-xl bg-ink-100 p-1">
        {weekdays.map((d) => {
          const on = d.n === activeDay;
          const gaps = teachable > 0 && (fill[d.n] ?? 0) < teachable;
          return (
            <Pressable
              key={d.n}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => onDay(d.n)}
              className={`flex-1 items-center rounded-lg py-2 ${on ? "bg-white shadow-sm" : ""}`}
            >
              <Text className={`text-[13px] font-semibold ${on ? "text-[#1F45C7]" : "text-ink-600"}`}>{d.label.slice(0, 3)}</Text>
              <View className={`mt-1 h-1.5 w-1.5 rounded-full ${gaps ? "bg-red-500" : "bg-transparent"}`} />
            </Pressable>
          );
        })}
      </View>
      <View className="overflow-hidden rounded-xl border border-ink-100 bg-white">
        {periods.map((p, i) => {
          if (p.isBreak) {
            return (
              <View key={p.id} className={`flex-row items-center gap-2 bg-ink-50 px-3 py-1.5 ${i ? "border-t border-ink-100" : ""}`}>
                <Ionicons name="cafe-outline" size={13} color="#94a3b8" />
                <Text className="text-xs text-ink-500">
                  {p.name} · {p.start}–{p.end}
                </Text>
              </View>
            );
          }
          const slot = findSlot(slots, p, activeDay) as (WeekSlot & { teacherId?: string }) | undefined;
          const filled = slotFilled(slot);
          const subject = slotSubject(slot);
          const clashes = filled
            ? others
                .filter((c) =>
                  c.slots.some(
                    (o) =>
                      o.weekday === activeDay &&
                      (o.periodId === p.id || o.period === p.name) &&
                      ((slot?.teacherId && o.teacherId === slot.teacherId) || (!slot?.teacherId && slot?.teacher && o.teacher === slot.teacher))
                  )
                )
                .map((c) => c.label)
            : [];
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`${p.name} ${subject || "empty"}`}
              disabled={!editable}
              onPress={() => onPress(p.id, activeDay, slot)}
              className={`flex-row items-center gap-3 px-3 py-2.5 ${i ? "border-t border-ink-100" : ""} ${hold && !filled ? "bg-[#EEF3FF]/60" : ""}`}
              style={{ minHeight: 56 }}
            >
              <View className="w-11">
                <Text className="text-xs font-semibold text-ink-800">{p.start}</Text>
                <Text className="text-[11px] text-ink-400">{p.end}</Text>
              </View>
              {filled ? (
                <>
                  <View className="h-9 w-1 rounded-full" style={{ backgroundColor: subjectTone(subject || slot?.teacher || "") }} />
                  <View className="min-w-0 flex-1">
                    <Text className="text-[15px] font-semibold text-ink-900" numberOfLines={1}>
                      {subject || "—"}
                    </Text>
                    <Text className="text-xs text-ink-500" numberOfLines={1}>
                      {slot?.teacher || "No teacher"}
                    </Text>
                    {clashes.length ? (
                      <Text className="mt-0.5 text-[11px] font-semibold text-red-600" numberOfLines={1}>
                        ⚠ Also in {clashes.join(", ")}
                      </Text>
                    ) : null}
                    {slot?.covers?.length ? (
                      <Text className="mt-0.5 text-[11px] font-medium text-emerald-700" numberOfLines={1}>
                        Cover {slot.covers[0].substitute}
                        {slot.covers.length > 1 ? ` +${slot.covers.length - 1}` : ""}
                      </Text>
                    ) : null}
                  </View>
                  {editable ? <Ionicons name="chevron-forward" size={15} color="#cbd5e1" /> : null}
                </>
              ) : (
                <View className="flex-1 flex-row items-center justify-center rounded-lg border border-dashed border-ink-300 py-2">
                  <Text className="text-sm font-medium text-[#1F45C7]">
                    {hold ? "Tap to place" : editable ? "+ Assign" : "Free"}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function DaySchedule({
  weekdays,
  periods,
  slots,
  activeDay,
  fill,
  teachable,
  hold,
  over,
  editable,
  onDay,
  onOver,
  onLeave,
  onDrop,
  onPlace,
  onClear,
}: {
  weekdays: { n: number; label: string }[];
  periods: { id: string; name: string; start: string; end: string; isBreak?: boolean }[];
  slots: WeekSlot[];
  activeDay: number;
  fill: Record<number, number>;
  teachable: number;
  hold: boolean;
  over: string;
  editable: boolean;
  onDay: (n: number) => void;
  onOver: (key: string) => void;
  onLeave: () => void;
  onDrop: (periodId: string, weekday: number, payload: Hold) => void;
  onPlace: (periodId: string, weekday: number) => void;
  onClear: (periodId: string, weekday: number) => void;
}) {
  return (
    <View className="gap-3">
      <View className="flex-row gap-1">
        {weekdays.map((d) => {
          const on = d.n === activeDay;
          const n = fill[d.n] ?? 0;
          return (
            <Pressable
              key={d.n}
              onPress={() => onDay(d.n)}
              className={`min-h-[52px] flex-1 items-center justify-center rounded-md border px-1 py-1.5 ${
                on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"
              }`}
            >
              <Text numberOfLines={1} className={`text-xs font-medium ${on ? "text-white" : "text-ink-800"}`}>
                {d.label}
              </Text>
              <Text className={`mt-0.5 text-[10px] ${on ? "text-white" : "text-ink-700"}`}>
                {n}/{teachable || "—"}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {periods.map((p) => {
        const slot = findSlot(slots, p, activeDay);
        const key = `${p.id}:${activeDay}`;
        return (
          <View key={p.id} className="gap-1.5">
            <View className="flex-row items-baseline justify-between gap-2">
              <Text className="font-medium text-ink-900">{p.name}</Text>
              <Text className="text-xs text-ink-700">
                {p.start}–{p.end}
              </Text>
            </View>
            {p.isBreak ? (
              <View className="min-h-[48px] items-center justify-center rounded-xl bg-ink-100 px-2">
                <Text className="text-xs text-ink-700">Break</Text>
              </View>
            ) : (
              <DropCell
                tall
                armed={hold}
                hot={over === key}
                filled={slotFilled(slot)}
                subject={slotSubject(slot)}
                teacher={slot?.teacher || ""}
                covers={slot?.covers}
                editable={editable}
                hint={hold ? "Tap to place" : editable ? "Tap to assign" : ""}
                onOver={() => onOver(key)}
                onLeave={onLeave}
                onDrop={(payload) => onDrop(p.id, activeDay, payload)}
                onPress={() => {
                  if (!editable) return;
                  onPlace(p.id, activeDay);
                }}
                onClear={() => onClear(p.id, activeDay)}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

function WeekGrid({
  weekdays,
  periods,
  slots,
  hold,
  over,
  editable,
  onOver,
  onLeave,
  onDrop,
  onPlace,
  onClear,
  others,
  focus,
  footer,
}: {
  weekdays: { n: number; label: string }[];
  periods: { id: string; name: string; start: string; end: string; isBreak?: boolean }[];
  slots: WeekSlot[];
  hold: boolean;
  over: string;
  editable: boolean;
  onOver: (key: string) => void;
  onLeave: () => void;
  onDrop: (periodId: string, weekday: number, payload: Hold) => void;
  onPlace: (periodId: string, weekday: number) => void;
  onClear: (periodId: string, weekday: number) => void;
  others: { label: string; slots: (WeekSlot & { teacherId?: string })[] }[];
  focus?: string;
  footer?: ReactNode;
}) {
  const todayN = jsToWeekday(new Date().getDay());
  const PERIOD_W = 96;
  const DAY_MIN = 118;
  const minWidth = PERIOD_W + weekdays.length * DAY_MIN;
  const [boxW, setBoxW] = useState(0);
  const gridW = Math.max(minWidth, boxW);
  return (
    <Card className="min-h-0 flex-1 overflow-hidden">
      <ScrollView className="min-h-0 flex-1" nestedScrollEnabled contentContainerClassName="pb-4">
        <ScrollView
          horizontal
          nestedScrollEnabled
          onLayout={(e) => setBoxW(Math.floor(e.nativeEvent.layout.width))}
          showsHorizontalScrollIndicator={gridW > boxW}
        >
          <View style={{ width: gridW }}>
            <View className="flex-row bg-ink-50">
              <View className="shrink-0 px-3 py-2.5" style={{ width: PERIOD_W }}>
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Period</Text>
              </View>
              {weekdays.map((d) => (
                <View key={d.n} className="min-w-0 flex-1 px-2 py-2.5">
                  <Text
                    className={`text-[11px] font-semibold uppercase tracking-wide ${d.n === todayN ? "text-clay-600" : "text-ink-500"}`}
                  >
                    {d.label}
                    {d.n === todayN ? " · Today" : ""}
                  </Text>
                </View>
              ))}
            </View>
            {periods.map((p) =>
              p.isBreak ? (
                <View key={p.id} className="flex-row items-center gap-2 border-t border-ink-100 bg-ink-50 px-3 py-1.5">
                  <Ionicons name="cafe-outline" size={13} color="#94a3b8" />
                  <Text className="text-xs text-ink-500">
                    {p.name} · {p.start}–{p.end}
                  </Text>
                </View>
              ) : (
                <View key={p.id} className="flex-row border-t border-ink-100">
                  <View className="shrink-0 justify-center px-3 py-2" style={{ width: PERIOD_W }}>
                    <Text className="text-[13px] font-semibold text-ink-900" numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text className="text-[11px] text-ink-500">
                      {p.start}–{p.end}
                    </Text>
                  </View>
                  {weekdays.map((d) => {
                    const slot = findSlot(slots, p, d.n) as (WeekSlot & { teacherId?: string }) | undefined;
                    const key = `${p.id}:${d.n}`;
                    const filled = slotFilled(slot);
                    const clashes = filled
                      ? others
                          .filter((c) =>
                            c.slots.some(
                              (o) =>
                                o.weekday === d.n &&
                                (o.periodId === p.id || o.period === p.name) &&
                                ((slot?.teacherId && o.teacherId === slot.teacherId) ||
                                  (!slot?.teacherId && slot?.teacher && o.teacher === slot.teacher))
                            )
                          )
                          .map((c) => c.label)
                      : [];
                    return (
                      <View
                        key={key}
                        className="min-w-0 flex-1 p-1"
                        style={{ opacity: focus && slotSubject(slot) !== focus ? 0.3 : 1 }}
                      >
                        <DropCell
                          compact
                          armed={hold}
                          hot={over === key}
                          filled={filled}
                          subject={slotSubject(slot)}
                          teacher={slot?.teacher || ""}
                          covers={slot?.covers}
                          clashes={clashes}
                          editable={editable}
                          hint={hold ? "Tap or drop" : ""}
                          onOver={() => onOver(key)}
                          onLeave={onLeave}
                          onDrop={(payload) => onDrop(p.id, d.n, payload)}
                          onPress={() => {
                            if (!editable) return;
                            onPlace(p.id, d.n);
                          }}
                          onClear={() => onClear(p.id, d.n)}
                        />
                      </View>
                    );
                  })}
                </View>
              )
            )}
          </View>
        </ScrollView>
        {footer ? <View className="mt-4 px-1">{footer}</View> : null}
      </ScrollView>
    </Card>
  );
}

function MissingPeriodsGrid({ onPress }: { onPress: () => void }) {
  return (
    <Card className="min-h-[320px] flex-1 items-center justify-center gap-3 p-6">
      <View className="h-12 w-12 items-center justify-center rounded-full bg-blue-50">
        <Ionicons name="time-outline" size={24} color="#1f5feb" />
      </View>
      <View className="items-center gap-1">
        <Text className="text-base font-semibold text-ink-900">No periods found</Text>
        <Text className="max-w-md text-center text-sm leading-6 text-ink-700">
          Set bell periods in School settings before building the routine.
        </Text>
      </View>
      <Button className="mt-1 px-6" onPress={onPress}>
        Set periods
      </Button>
    </Card>
  );
}

function SubjectChip({
  teacherId,
  subjectName,
  picked,
  editable,
  compact,
  onPick,
}: {
  teacherId: string;
  subjectName: string;
  picked: boolean;
  editable: boolean;
  compact?: boolean;
  onPick: (subjectName: string, toggle?: boolean) => void;
}) {
  const ref = useRef<View>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const className = `flex-row items-center gap-1.5 rounded-md border ${compact ? "min-h-[40px] px-3 py-2" : "px-2 py-1"} ${
    picked ? "border-clay-500 bg-clay-50" : "border-ink-200 bg-white"
  }`;
  const dot = <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: subjectTone(subjectName) }} />;
  const label = <Text className={`text-xs ${picked ? "font-semibold text-clay-700" : "text-ink-800"}`}>{subjectName}</Text>;

  useEffect(() => {
    const el = webNode(ref);
    if (!el || !editable) return;
    el.draggable = true;
    el.style.cursor = "grab";
    el.style.userSelect = "none";
    let dragging = false;
    const click = () => {
      if (!editable) return;
      if (dragging) {
        dragging = false;
        return;
      }
      pickRef.current(subjectName, true);
    };
    const start = (e: Event) => {
      dragging = true;
      const dt = (e as unknown as DragEvt).dataTransfer;
      const payload = JSON.stringify({ teacherId, subjectName });
      dt?.setData("text/plain", payload);
      try {
        dt?.setData("application/json", payload);
      } catch {
        /* some browsers only allow text/plain */
      }
      if (dt) dt.effectAllowed = "copy";
      pickRef.current(subjectName, false);
    };
    el.addEventListener("click", click);
    el.addEventListener("dragstart", start);
    return () => {
      el.draggable = false;
      el.removeEventListener("click", click);
      el.removeEventListener("dragstart", start);
    };
  }, [editable, teacherId, subjectName]);

  if (Platform.OS === "web") {
    return (
      <View ref={ref} className={className}>
        {dot}
        {label}
      </View>
    );
  }
  return (
    <Pressable disabled={!editable} onPress={() => onPick(subjectName, true)} className={className}>
      {dot}
      {label}
    </Pressable>
  );
}

function TeacherCard({
  teacherId,
  name,
  qualification,
  idle,
  team,
  skills,
  hold,
  editable,
  compact,
  onEdit,
  onPick,
}: {
  teacherId: string;
  name: string;
  qualification?: string;
  idle?: boolean;
  team?: boolean;
  skills: string[];
  hold: Hold | null;
  editable: boolean;
  compact?: boolean;
  onEdit?: () => void;
  onPick: (subjectName: string, toggle?: boolean) => void;
}) {
  return (
    <Card className={compact ? "p-2.5" : "p-3"}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1">
          <Text className="font-medium text-ink-900">{name}</Text>
          {idle || team ? (
            <Text className="mt-0.5 text-[11px] leading-4 text-leaf-600">
              {[idle ? "Free now" : "", team ? "Team" : ""].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
          {qualification ? (
            <Text className="mt-0.5 text-[11px] leading-4 text-ink-700">{qualification}</Text>
          ) : null}
        </View>
        {onEdit ? (
          <Pressable onPress={onEdit} className="min-h-[36px] justify-center">
            <Text className="text-xs text-clay-600">Edit</Text>
          </Pressable>
        ) : null}
      </View>
      <View className="mt-2 flex-row flex-wrap gap-1.5">
        {skills.length ? (
          skills.map((subjectName) => {
            const picked = hold?.teacherId === teacherId && hold.subjectName === subjectName;
            return (
              <SubjectChip
                key={subjectName}
                teacherId={teacherId}
                subjectName={subjectName}
                picked={picked}
                editable={editable}
                compact={compact}
                onPick={onPick}
              />
            );
          })
        ) : (
          <Text className="text-xs text-ink-700">Edit to set what they teach</Text>
        )}
      </View>
    </Card>
  );
}

function DropCell({
  hot,
  filled,
  subject,
  teacher,
  covers,
  editable,
  hint,
  tall,
  compact,
  armed,
  clashes,
  onOver,
  onLeave,
  onDrop,
  onPress,
  onClear,
}: {
  hot: boolean;
  filled: boolean;
  subject: string;
  teacher: string;
  covers?: { date: string; substituteId: string; substitute: string; absentTeacher: string }[];
  clashes?: string[];
  editable: boolean;
  hint: string;
  tall?: boolean;
  compact?: boolean;
  armed?: boolean;
  onOver: () => void;
  onLeave: () => void;
  onDrop: (p: Hold) => void;
  onPress: () => void;
  onClear: () => void;
}) {
  const ref = useRef<View>(null);
  const overRef = useRef(onOver);
  const leaveRef = useRef(onLeave);
  const dropRef = useRef(onDrop);
  overRef.current = onOver;
  leaveRef.current = onLeave;
  dropRef.current = onDrop;
  const waiting = Boolean(armed && !filled);
  const [hover, setHover] = useState(false);
  const tone = subjectTone(subject || teacher || "");
  const clash = Boolean(clashes?.length);

  useEffect(() => {
    if (!editable) return;
    const el = webNode(ref);
    if (!el) return;
    const dragOver = (e: Event) => {
      e.preventDefault();
      const dt = (e as unknown as DragEvt).dataTransfer;
      if (dt) dt.dropEffect = "copy";
      overRef.current();
    };
    const dragLeave = (e: Event) => {
      const ev = e as unknown as { currentTarget?: EventTarget | null; relatedTarget?: EventTarget | null };
      if (
        ev.currentTarget instanceof Node &&
        ev.relatedTarget instanceof Node &&
        ev.currentTarget.contains(ev.relatedTarget)
      ) {
        return;
      }
      leaveRef.current();
    };
    const dropped = (e: Event) => {
      e.preventDefault();
      leaveRef.current();
      const dt = (e as unknown as DragEvt).dataTransfer;
      const raw = dt?.getData("application/json") || dt?.getData("text/plain") || "";
      const payload = parseHold(raw);
      if (payload) dropRef.current(payload);
    };
    el.addEventListener("dragover", dragOver);
    el.addEventListener("dragenter", dragOver);
    el.addEventListener("dragleave", dragLeave);
    el.addEventListener("drop", dropped);
    return () => {
      el.removeEventListener("dragover", dragOver);
      el.removeEventListener("dragenter", dragOver);
      el.removeEventListener("dragleave", dragLeave);
      el.removeEventListener("drop", dropped);
    };
  }, [editable]);

  const tinted = filled && !hot && !waiting;
  return (
    <View
      ref={ref}
      className={`${compact ? "min-h-[56px] rounded-lg px-2 py-1.5" : tall ? "min-h-[64px] rounded-xl px-3 py-2.5" : "min-h-[72px] rounded-xl px-3 py-2.5"} border ${
        hot
          ? "border-clay-500 bg-blue-50"
          : waiting
            ? "border-clay-500/50 bg-blue-50/70"
            : filled
              ? ""
              : "border-dashed border-ink-200 bg-white"
      }`}
      style={
        tinted
          ? {
              backgroundColor: clash ? "#fef2f2" : hover ? "#f8fafc" : "#ffffff",
              borderColor: clash ? "#fca5a5" : "#e2e8f0",
            }
          : undefined
      }
    >
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        className={compact ? "min-h-[42px] justify-center" : tall ? "min-h-[48px] justify-center" : "min-h-[56px]"}
      >
        {filled ? (
          <View className="flex-row items-start gap-1">
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-1.5">
                <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tone }} />
                <Text className={`min-w-0 flex-1 ${compact ? "text-[13px]" : "text-[15px]"} font-semibold text-ink-900`} numberOfLines={1}>
                  {subject || "—"}
                </Text>
              </View>
              {teacher ? (
                <View className="mt-0.5 flex-row items-center gap-1 pl-3">
                  <Text className="min-w-0 flex-1 text-[11px] text-ink-500" numberOfLines={1}>
                    {teacher}
                  </Text>
                </View>
              ) : null}
              {clash ? (
                <Text className="mt-0.5 text-[10px] font-semibold text-red-700" numberOfLines={1}>
                  Also in {clashes!.join(", ")}
                </Text>
              ) : null}
              {covers?.length ? (
                <View className="mt-1 rounded-md bg-emerald-50 px-1.5 py-0.5">
                  {covers.slice(0, 2).map((cover) => (
                    <Text key={`${cover.date}:${cover.substituteId}`} className="text-[10px] font-medium text-emerald-700" numberOfLines={1}>
                      Cover {new Date(`${cover.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {cover.substitute}
                    </Text>
                  ))}
                  {covers.length > 2 ? <Text className="text-[10px] text-emerald-700">+{covers.length - 2} more</Text> : null}
                </View>
              ) : null}
            </View>
            {editable && (hover || Platform.OS !== "web") ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Clear ${subject || "period"}`}
                onPress={(e) => {
                  e.stopPropagation?.();
                  onClear();
                }}
                className="h-6 w-6 items-center justify-center rounded-full bg-white"
              >
                <Ionicons name="close" size={13} color="#64748b" />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View className="items-center justify-center">
            {editable && hint ? (
              <Text className="text-center text-xs text-ink-700">{hint}</Text>
            ) : editable && compact ? (
              <Ionicons name="add" size={16} color={hover ? "#2563eb" : "#cbd5e1"} />
            ) : null}
          </View>
        )}
      </Pressable>
    </View>
  );
}

function TeacherForm({
  teacher,
  classes,
  onCancel,
  onSave,
}: {
  teacher?: { id: string; name: string; qualification?: string; skills: { subjectName: string; classId: string }[] };
  classes: { id: string; label: string }[];
  onCancel: () => void;
  onSave: (payload: {
    name: string;
    email?: string;
    phone?: string;
    employeeId?: string;
    password?: string;
    qualification: string[];
    qualificationNotes: string;
    offers: { subjectName: string; classId: string }[];
  }) => Promise<void>;
}) {
  const parsed = parseQualification(teacher?.qualification);
  const startSubjects = [...new Set((teacher?.skills ?? []).map((s) => s.subjectName))];
  const startBy: Record<string, string[]> = {};
  for (const s of teacher?.skills ?? []) {
    startBy[s.subjectName] = [...(startBy[s.subjectName] ?? []), s.classId];
  }
  const [name, setName] = useState(teacher?.name || "");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("12345");
  const [tags, setTags] = useState<string[]>(parsed.tags);
  const [notes, setNotes] = useState(parsed.notes);
  const [subjects, setSubjects] = useState<string[]>(startSubjects);
  const [bySubject, setBySubject] = useState<Record<string, string[]>>(startBy);
  const [error, setError] = useState("");
  const editing = Boolean(teacher);

  function toggleSubject(s: string) {
    if (subjects.includes(s)) {
      setSubjects(subjects.filter((n) => n !== s));
      const next = { ...bySubject };
      delete next[s];
      setBySubject(next);
    } else {
      setSubjects([...subjects, s]);
    }
  }

  return (
    <View className="gap-3">
      <Field label="Name">
        <Input value={name} onChangeText={setName} />
      </Field>
      {!editing ? (
        <>
          <Field label="Email">
            <Input autoCapitalize="none" value={email} onChangeText={setEmail} />
          </Field>
          <Field label="Mobile">
            <Input keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="10-digit number" />
          </Field>
          <Field label="Employee id">
            <Input value={employeeId} onChangeText={setEmployeeId} placeholder="Auto if blank" />
          </Field>
          <Field label="Login password">
            <Input value={password} onChangeText={setPassword} />
          </Field>
        </>
      ) : null}
      <Text className="text-xs font-medium text-ink-700">Qualification</Text>
      <View className="flex-row flex-wrap gap-2">
        {QUALIFICATION_OPTIONS.map((q) => (
          <Chip
            key={q}
            label={q}
            active={tags.includes(q)}
            onPress={() => setTags(tags.includes(q) ? tags.filter((t) => t !== q) : [...tags, q])}
          />
        ))}
      </View>
      <Input value={notes} onChangeText={setNotes} placeholder="Specialisation — e.g. Physics, Mathematics" />
      <Text className="text-xs font-medium text-ink-700">Can teach — then pick classes for that subject</Text>
      <View className="flex-row flex-wrap gap-2">
        {DEFAULT_SUBJECTS.map((s) => (
          <Chip key={s} label={s} active={subjects.includes(s)} onPress={() => toggleSubject(s)} />
        ))}
      </View>
      {subjects.map((s) => (
        <View key={s} className="rounded-md border border-ink-100 bg-ink-50 px-3 py-2">
          <Text className="mb-1.5 text-xs font-medium text-ink-800">{s} — which classes</Text>
          <View className="flex-row flex-wrap gap-2">
            {classes.filter((c) => c.id).map((c) => {
              const on = (bySubject[s] ?? []).includes(c.id);
              return (
                <Chip
                  key={c.id}
                  label={c.label}
                  active={on}
                  onPress={() =>
                    setBySubject({
                      ...bySubject,
                      [s]: on
                        ? (bySubject[s] ?? []).filter((id) => id !== c.id)
                        : [...(bySubject[s] ?? []), c.id],
                    })
                  }
                />
              );
            })}
          </View>
        </View>
      ))}
      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      <View className="flex-row justify-end gap-2">
        <Button variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
        <Button
          onPress={async () => {
            setError("");
            if (!name.trim() || (!editing && !email.trim())) {
              setError("Name and email are required");
              return;
            }
            if (!editing && phone.replace(/\D/g, "").length < 10) {
              setError("Enter a 10-digit mobile number");
              return;
            }
            const offers = subjects.flatMap((subjectName) =>
              (bySubject[subjectName] ?? []).map((classId) => ({ subjectName, classId }))
            );
            try {
              await onSave({
                name: name.trim(),
                email: email.trim() || undefined,
                phone: phone.trim() || undefined,
                employeeId: employeeId.trim() || undefined,
                password: password || undefined,
                qualification: tags,
                qualificationNotes: notes,
                offers,
              });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not save.");
            }
          }}
        >
          {editing ? "Save" : "Add teacher"}
        </Button>
      </View>
    </View>
  );
}
