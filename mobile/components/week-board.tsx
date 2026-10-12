import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Button, Card, Chip, ChipScroller, Empty, Modal, PageHeader, Toast, useToast } from "./ui";
import { TeacherForm } from "./teacher-form";
import { formatSubjectLabel, skillMatchesSubject } from "../lib/subject-label";
import { act } from "../lib/mutate";
import { openRoutinePdf } from "../lib/print-html";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";

type Hold = { teacherId: string; subjectId?: string; code?: string; subjectName: string };
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
    if (p?.teacherId && (p.subjectId || p.subjectName)) return p;
  } catch {
    /* ignore */
  }
  return null;
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
  const [assign, setAssign] = useState<{ periodId: string; weekday: number; periodName: string } | null>(null);
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

  function pickSubject(payload: Hold, toggle?: boolean) {
    if (!editable) return;
    setHold((cur) => {
      if (!toggle) return payload;
      return cur?.teacherId === payload.teacherId && cur.subjectId === payload.subjectId ? null : payload;
    });
  }

  useEffect(() => {
    if (!weekdays.length) return;
    if (!weekdays.some((d) => d.n === day)) {
      setDay(weekdays.some((d) => d.n === todayN) ? todayN : weekdays[0].n);
    }
  }, [weekdays, day, todayN]);

  async function dropOn(periodId: string, weekday: number, payload: Hold) {
    if (!klass?.id) return;
    setError("");
    try {
      await act(token, "saveTimetableSlot", {
        classId: klass.id,
        periodId,
        weekday,
        teacherId: payload.teacherId,
        subjectId: payload.subjectId,
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
    setHold(null);
    try {
      await act(token, "saveTimetableSlot", {
        classId: klass.id,
        periodId,
        weekday,
        teacherId: null,
        subjectId: null,
        subjectName: "",
        clear: true,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear.");
    }
  }

  async function exportRoutine() {
    if (!klass?.id) {
      toast.show("Pick a class first.");
      return;
    }
    try {
      await openRoutinePdf(token, { classId: klass.id });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not export the routine.");
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
      classes={classes.map((c) => ({ id: c.id || "", label: c.label }))}
      hold={hold}
      editable={editable}
      compact={phone}
      classId={klass?.id}
      classSubjects={klass?.subjects ?? []}
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
          kicker={teamWeek ? "Team" : "Admin · One screen"}
          title={teamWeek ? "Team routine" : "Routine"}
          lede={
            teamWeek
              ? "Empty periods in your team’s classes. Free teachers are marked — drop one on the hole."
              : "Pick a class and place teachers. Clock and subjects are set once under School settings."
          }
          action={
            <View className="flex-row items-center gap-2">
              <Button variant="ghost" onPress={() => router.push("/school?tab=subjects" as never)}>
                Subjects
              </Button>
              <Button variant="ghost" onPress={() => void exportRoutine()}>
                Export PDF
              </Button>
            </View>
          }
        />
      )}
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className={split ? "mt-3 min-h-0 flex-1 flex-row gap-6" : phone ? "min-h-0 flex-1" : "mt-3 min-h-0 flex-1"}>
        {split && !periodsNotSet ? <View className="min-h-0 w-1/4 max-w-xs shrink-0">{teacherRail}</View> : null}

        <View className="min-h-0 min-w-0 flex-1">
          <View className="shrink-0 gap-2">
            {phone ? (
              <View className="flex-row items-center justify-end gap-2">
                <Button variant="ghost" onPress={() => router.push("/school?tab=subjects" as never)}>
                  Subjects
                </Button>
                <Button variant="ghost" onPress={() => void exportRoutine()}>
                  Export PDF
                </Button>
              </View>
            ) : null}
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

          {!klass?.subjects?.length && !periodsNotSet ? (
            <Text className="mt-3 shrink-0 text-sm text-ink-700">
              No subjects on this class plan. Add them under School → Subjects, then save the class.
            </Text>
          ) : null}
          {klass?.subjects?.length && !periodsNotSet ? (
            <View className="mt-3 shrink-0 flex-row flex-wrap gap-2">
              {klass.subjects.map((s) => {
                const placed = klass.slots.filter((slot) => slot.subjectId === s.id).length;
                const need = s.weightage || 0;
                const impossible = need > weekCapacity;
                const done = need > 0 && placed >= need;
                return (
                  <View
                    key={s.id}
                    className={`rounded-md border px-3 py-1.5 ${
                      impossible
                        ? "border-red-300 bg-red-50"
                        : done
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-ink-200 bg-white"
                    }`}
                  >
                    <Text
                      className={`text-xs ${
                        impossible ? "text-red-800" : done ? "text-green-800" : "text-ink-800"
                      }`}
                    >
                      {s.label || formatSubjectLabel(s.code, s.name)} · {placed}/{need || "—"}
                      {impossible ? " — over the week" : ""}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {error ? <Text className="mt-2 shrink-0 text-sm text-red-700">{error}</Text> : null}
          {hold ? (
            <View className="mt-2 shrink-0 flex-row items-center gap-2 rounded-md border border-clay-500 bg-blue-50 px-3 py-2.5">
              <Text className="flex-1 text-sm text-clay-600">
                {hold.subjectName && hold.code ? formatSubjectLabel(hold.code, hold.subjectName) : hold.subjectName}
                {holdTeacher ? ` · ${holdTeacher}` : ""} — tap a period
                {phone ? "" : " or drop it"}
              </Text>
              <Pressable onPress={() => setHold(null)} className="min-h-[40px] justify-center px-2">
                <Text className="text-sm font-medium text-ink-800">Cancel</Text>
              </Pressable>
            </View>
          ) : (
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
                <ScrollView className="min-h-0 flex-1" nestedScrollEnabled contentContainerClassName="pb-6">
                  <DaySchedule
                    weekdays={weekdays}
                    periods={periods}
                    slots={klass.slots}
                    activeDay={activeDay}
                    fill={dayFill}
                    teachable={teachable}
                    hold={Boolean(hold)}
                    over={over}
                    editable={editable}
                    onDay={setDay}
                    onOver={setOver}
                    onLeave={() => setOver("")}
                    onDrop={dropOn}
                    onPlace={(periodId, weekday) => placeOrPick(periodId, weekday, klass.slots)}
                    onClear={clearCell}
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
                  footer={!split ? teacherRail : null}
                />
              )
            ) : (
              <Empty title="Pick a class" body="Assign periods on the grid." />
            )}
          </View>
        </View>
      </View>

      <Modal
        open={Boolean(assign)}
        title={
          assign
            ? `${assign.periodName} · ${weekdays.find((d) => d.n === assign.weekday)?.label || ""}`
            : "Place"
        }
        onClose={() => setAssign(null)}
      >
        <AssignSheet
          teachers={teachers}
          classId={klass?.id}
          classSubjects={klass?.subjects ?? []}
          onCancel={() => setAssign(null)}
          onPick={async (payload) => {
            if (!assign) return;
            await dropOn(assign.periodId, assign.weekday, payload);
            setAssign(null);
          }}
        />
      </Modal>

      <Modal open={modal === "addTeacher"} title="Add teacher" large onClose={() => setModal(null)}>
        <TeacherForm
          key="new-teacher"
          classes={classes.map((c) => ({
            id: c.id || "",
            label: c.label,
            name: c.name,
            subjects: c.subjects ?? [],
          }))}
          onCancel={() => setModal(null)}
          onSave={async (payload) => {
            await act(token, "createTeacher", payload);
            setModal(null);
            toast.show("Teacher added.");
            await reload();
          }}
        />
      </Modal>

      <Modal open={modal === "teacher" && Boolean(teacherId)} title="Edit teacher" large onClose={() => setModal(null)}>
        {teacherId ? (
          <TeacherForm
            key={teacherId}
            teacher={teachers.find((t) => t.id === teacherId)}
            classes={classes.map((c) => ({
            id: c.id || "",
            label: c.label,
            name: c.name,
            subjects: c.subjects ?? [],
          }))}
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

function splitSubjectLabel(label: string) {
  const parts = label.split(" · ");
  if (parts.length < 2) return { code: "", name: label.trim() };
  return { code: parts[0].trim(), name: parts.slice(1).join(" · ").trim() };
}

function findSlot(
  slots: WeekSlot[],
  period: { id: string; name: string },
  weekday: number
) {
  return slots.find((s) => s.weekday === weekday && (s.periodId === period.id || s.period === period.name));
}

function otherClassLabels(
  skills: { classId: string }[],
  classId: string | undefined,
  classes: { id: string; label: string }[]
) {
  const ids = [...new Set(skills.map((row) => row.classId).filter((id) => id && id !== classId))];
  return ids.map((id) => classes.find((row) => row.id === id)?.label || "").filter(Boolean);
}

function TeacherRail({
  teachers,
  classes,
  hold,
  editable,
  compact,
  classId,
  classSubjects,
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
  classes: { id: string; label: string }[];
  hold: Hold | null;
  editable: boolean;
  compact?: boolean;
  classId?: string;
  classSubjects: { id: string; code?: string; name: string; label?: string }[];
  canAdd?: boolean;
  onAdd?: () => void;
  onEdit?: (id: string) => void;
  onPick: (payload: Hold, toggle?: boolean) => void;
  scroll?: boolean;
}) {
  const cards = (
    <>
      {teachers.map((t) => {
        const skills = classSkillOffers(
          t.skills.filter((s) => !classId || !s.classId || s.classId === classId),
          classSubjects
        );
        const alsoTeaches = otherClassLabels(t.skills, classId, classes);
        if (compact && classId && !skills.length && !alsoTeaches.length) return null;
        return (
          <TeacherCard
            key={t.id}
            teacherId={t.id}
            name={t.name}
            qualification={compact ? undefined : t.qualification}
            idle={t.idle}
            team={t.team}
            skills={skills}
            alsoTeaches={alsoTeaches}
            hold={hold}
            editable={editable}
            compact={compact}
            onEdit={onEdit ? () => onEdit(t.id) : undefined}
            onPick={(subject, toggle) => onPick({ teacherId: t.id, ...subject }, toggle)}
          />
        );
      })}
      {!teachers.length ? (
        <Text className="text-sm text-ink-700">Add teachers under Employees first.</Text>
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

function classSkillOffers(
  skills: { subjectName: string; classId?: string }[],
  classSubjects: { id: string; code?: string; name: string; label?: string }[]
) {
  const offers: { subjectId: string; code?: string; subjectName: string; label: string }[] = [];
  for (const skill of skills) {
    const subject = classSubjects.find((row) => skillMatchesSubject(skill.subjectName, row));
    if (!subject || offers.some((row) => row.subjectId === subject.id)) continue;
    offers.push({
      subjectId: subject.id,
      code: subject.code,
      subjectName: subject.name,
      label: subject.label || formatSubjectLabel(subject.code, subject.name),
    });
  }
  return offers;
}

function AssignSheet({
  teachers,
  classId,
  classSubjects,
  onCancel,
  onPick,
}: {
  teachers: { id: string; name: string; skills: { subjectName: string; classId: string }[] }[];
  classId?: string;
  classSubjects: { id: string; code?: string; name: string; label?: string }[];
  onCancel: () => void;
  onPick: (payload: Hold) => Promise<void>;
}) {
  const offers = teachers.flatMap((t) =>
    classSkillOffers(
      t.skills.filter((s) => !classId || !s.classId || s.classId === classId),
      classSubjects
    ).map((subject) => ({ teacherId: t.id, teacherName: t.name, ...subject }))
  );
  return (
    <View className="gap-2">
      <Text className="text-sm text-ink-700">Tap who takes this period.</Text>
      {offers.map((o) => (
        <Pressable
          key={`${o.teacherId}:${o.subjectId}`}
          onPress={() =>
            onPick({
              teacherId: o.teacherId,
              subjectId: o.subjectId,
              code: o.code,
              subjectName: o.subjectName,
            })
          }
          className="min-h-[48px] flex-row items-center justify-between rounded-md border border-ink-200 px-3 py-3"
        >
          <View>
            <Text className="font-medium text-ink-900">{o.label}</Text>
            <Text className="text-xs text-ink-700">{o.teacherName}</Text>
          </View>
          <Text className="text-sm text-clay-600">Place</Text>
        </Pressable>
      ))}
      {!offers.length ? (
        <Text className="text-sm text-ink-700">No teacher is set to teach this class yet.</Text>
      ) : null}
      <View className="mt-2 flex-row justify-end">
        <Button variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
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
  footer?: ReactNode;
}) {
  return (
    <Card className="min-h-0 flex-1 overflow-hidden">
      <ScrollView className="min-h-0 flex-1" nestedScrollEnabled contentContainerClassName="pb-4">
      <ScrollView horizontal nestedScrollEnabled>
        <View style={{ minWidth: 120 + weekdays.length * 176 }}>
          <View className="flex-row bg-ink-100">
            <View className="shrink-0 px-3 py-3" style={{ width: 120 }}>
              <Text className="text-xs uppercase tracking-wide text-ink-700">Period</Text>
            </View>
            {weekdays.map((d) => (
              <View key={d.n} className="shrink-0 px-3 py-3" style={{ width: 176 }}>
                <Text className="text-xs uppercase tracking-wide text-ink-700">{d.label}</Text>
              </View>
            ))}
          </View>
          {periods.map((p) => (
            <View key={p.id} className="flex-row border-t border-ink-100">
              <View className="shrink-0 justify-center px-3 py-3" style={{ width: 120 }}>
                <Text className="font-medium text-ink-900">{p.name}</Text>
                <Text className="text-xs text-ink-700">
                  {p.start}–{p.end}
                </Text>
              </View>
              {weekdays.map((d) => {
                const slot = findSlot(slots, p, d.n);
                const key = `${p.id}:${d.n}`;
                return (
                  <View key={key} className="shrink-0 px-1.5 py-2" style={{ width: 176 }}>
                    {p.isBreak ? (
                      <View className="min-h-[72px] items-center justify-center rounded-xl bg-ink-100 px-2 py-4">
                        <Text className="text-xs text-ink-700">Break</Text>
                      </View>
                    ) : (
                      <DropCell
                        armed={hold}
                        hot={over === key}
                        filled={slotFilled(slot)}
                        subject={slotSubject(slot)}
                        teacher={slot?.teacher || ""}
                        covers={slot?.covers}
                        editable={editable}
                        hint={hold ? "Tap or drop" : editable ? "Drop here" : ""}
                        onOver={() => onOver(key)}
                        onLeave={onLeave}
                        onDrop={(payload) => onDrop(p.id, d.n, payload)}
                        onPress={() => {
                          if (!editable) return;
                          onPlace(p.id, d.n);
                        }}
                        onClear={() => onClear(p.id, d.n)}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          ))}
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
  subject,
  picked,
  editable,
  compact,
  onPick,
}: {
  teacherId: string;
  subject: { subjectId: string; code?: string; subjectName: string; label: string };
  picked: boolean;
  editable: boolean;
  compact?: boolean;
  onPick: (subject: { subjectId: string; code?: string; subjectName: string }, toggle?: boolean) => void;
}) {
  const ref = useRef<View>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const className = `rounded-md ${compact ? "min-h-[40px] justify-center px-3 py-2" : "px-2.5 py-1"} ${
    picked ? "bg-clay-600" : "bg-clay-500"
  }`;

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
      pickRef.current(subject, true);
    };
    const start = (e: Event) => {
      dragging = true;
      const dt = (e as unknown as DragEvt).dataTransfer;
      const payload = JSON.stringify({
        teacherId,
        subjectId: subject.subjectId,
        code: subject.code,
        subjectName: subject.subjectName,
      });
      dt?.setData("text/plain", payload);
      try {
        dt?.setData("application/json", payload);
      } catch {
        /* some browsers only allow text/plain */
      }
      if (dt) dt.effectAllowed = "copy";
      pickRef.current(subject, false);
    };
    el.addEventListener("click", click);
    el.addEventListener("dragstart", start);
    return () => {
      el.draggable = false;
      el.removeEventListener("click", click);
      el.removeEventListener("dragstart", start);
    };
  }, [editable, teacherId, subject]);

  if (Platform.OS === "web") {
    return (
      <View ref={ref} className={className}>
        <Text className="text-xs text-white">{subject.label}</Text>
      </View>
    );
  }
  return (
    <Pressable disabled={!editable} onPress={() => onPick(subject, true)} className={className}>
      <Text className="text-xs text-white">{subject.label}</Text>
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
  alsoTeaches,
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
  skills: { subjectId: string; code?: string; subjectName: string; label: string }[];
  alsoTeaches?: string[];
  hold: Hold | null;
  editable: boolean;
  compact?: boolean;
  onEdit?: () => void;
  onPick: (subject: { subjectId: string; code?: string; subjectName: string }, toggle?: boolean) => void;
}) {
  const other = alsoTeaches?.length ? `Also ${alsoTeaches.join(", ")}` : "";
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
          skills.map((subject) => {
            const picked = hold?.teacherId === teacherId && hold.subjectId === subject.subjectId;
            return (
              <SubjectChip
                key={subject.subjectId}
                teacherId={teacherId}
                subject={subject}
                picked={picked}
                editable={editable}
                compact={compact}
                onPick={onPick}
              />
            );
          })
        ) : (
          <Text className="text-xs text-ink-700">
            {other ? "No subjects for this class" : "Edit to set what they teach"}
          </Text>
        )}
        {other ? <Text className="mt-1 w-full text-[11px] leading-4 text-ink-700">{other}</Text> : null}
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
  armed,
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
  editable: boolean;
  hint: string;
  tall?: boolean;
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
  const { code, name } = splitSubjectLabel(subject);

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

  return (
    <View
      ref={ref}
      className={`${tall ? "min-h-[88px]" : "min-h-[104px]"} rounded-xl border px-2.5 py-2 ${
        hot
          ? "border-clay-500 bg-blue-50"
          : waiting
            ? "border-clay-500/50 bg-blue-50/70"
            : filled
              ? "border-ink-200 bg-ink-50"
              : "border-dashed border-ink-200 bg-white"
      }`}
    >
      {filled ? (
        <View className="gap-1">
          <View className="flex-row items-start justify-between gap-1">
            {code ? (
              <Text className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-clay-600">{code}</Text>
            ) : (
              <View />
            )}
            {editable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Clear ${subject}`}
                hitSlop={8}
                onPress={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                className="shrink-0 rounded-md px-1.5 py-0.5"
              >
                <Text className="text-[11px] font-semibold text-clay-600">Clear</Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable onPress={onPress} className="gap-0.5">
            <Text className="shrink-0 text-sm font-semibold leading-5 text-ink-900">{name || subject}</Text>
            {teacher ? <Text className="shrink-0 text-xs leading-4 text-ink-700">{teacher}</Text> : null}
            {covers?.length ? (
              <View className="mt-1 rounded-md bg-emerald-50 px-2 py-1">
                {covers.slice(0, 2).map((cover) => (
                  <Text key={`${cover.date}:${cover.substituteId}`} className="text-[10px] font-medium text-emerald-700">
                    Cover {new Date(`${cover.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {cover.substitute}
                  </Text>
                ))}
                {covers.length > 2 ? <Text className="text-[10px] text-emerald-700">+{covers.length - 2} more</Text> : null}
              </View>
            ) : null}
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={onPress} className={tall ? "min-h-[64px] justify-center" : "min-h-[80px] justify-center"}>
          <View className="items-center justify-center">
            {editable && hint ? <Text className="text-center text-xs text-ink-700">{hint}</Text> : null}
          </View>
        </Pressable>
      )}
    </View>
  );
}
