import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
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
          kicker={teamWeek ? "Team" : "Admin · One screen"}
          title={teamWeek ? "Team routine" : "Routine"}
          lede={
            teamWeek
              ? "Empty periods in your team’s classes. Free teachers are marked — drop one on the hole."
              : "Pick a class and place teachers. Clock and subjects are set once under School settings."
          }
        />
      )}
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className={split ? "mt-3 min-h-0 flex-1 flex-row gap-6" : phone ? "min-h-0 flex-1" : "mt-3 min-h-0 flex-1"}>
        {split ? <View className="min-h-0 w-1/4 max-w-xs shrink-0">{teacherRail}</View> : null}

        <View className="min-h-0 min-w-0 flex-1">
          <View className="shrink-0 gap-2">
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

          {klass?.subjects?.length ? (
            <View className="mt-3 shrink-0 flex-row flex-wrap gap-2">
              {klass.subjects.map((s) => {
                const placed = klass.slots.filter((slot) => slot.subject === s.name).length;
                const need = s.weightage || 0;
                const impossible = need > weekCapacity;
                const done = need > 0 && placed >= need;
                return (
                  <View
                    key={s.name}
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
                      {s.name} · {placed}/{need || "—"}
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
                {hold.subjectName}
                {holdTeacher ? ` · ${holdTeacher}` : ""} — tap a period
                {phone ? "" : " or drop it"}
              </Text>
              <Pressable onPress={() => setHold(null)} className="min-h-[40px] justify-center px-2">
                <Text className="text-sm font-medium text-ink-800">Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <Text className="mt-2 shrink-0 text-sm text-ink-700">
              {klass
                ? phone
                  ? `${klass.label} · ${weekCapacity} periods this week.`
                  : `${klass.label} · ${weekCapacity} periods this week. Drag a subject onto a cell.`
                : "Add a class to start the week."}
            </Text>
          )}

          <View className="mt-3 min-h-0 flex-1">
            {klass ? (
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
          onCancel={() => setAssign(null)}
          onPick={async (payload) => {
            if (!assign) return;
            await dropOn(assign.periodId, assign.weekday, payload);
            setAssign(null);
          }}
        />
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
  const cards = (
    <>
      {teachers.map((t) => {
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

function AssignSheet({
  teachers,
  classId,
  onCancel,
  onPick,
}: {
  teachers: { id: string; name: string; skills: { subjectName: string; classId: string }[] }[];
  classId?: string;
  onCancel: () => void;
  onPick: (payload: Hold) => Promise<void>;
}) {
  const offers = teachers.flatMap((t) =>
    [...new Set(t.skills.filter((s) => !classId || !s.classId || s.classId === classId).map((s) => s.subjectName))].map(
      (subjectName) => ({ teacherId: t.id, teacherName: t.name, subjectName })
    )
  );
  return (
    <View className="gap-2">
      <Text className="text-sm text-ink-700">Tap who takes this period.</Text>
      {offers.map((o) => (
        <Pressable
          key={`${o.teacherId}:${o.subjectName}`}
          onPress={() => onPick({ teacherId: o.teacherId, subjectName: o.subjectName })}
          className="min-h-[48px] flex-row items-center justify-between rounded-md border border-ink-200 px-3 py-3"
        >
          <View>
            <Text className="font-medium text-ink-900">{o.subjectName}</Text>
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
        <View className="min-w-full">
          <View className="flex-row bg-ink-100">
            <View className="w-1/6 shrink-0 px-3 py-3">
              <Text className="text-xs uppercase tracking-wide text-ink-700">Period</Text>
            </View>
            {weekdays.map((d) => (
              <View key={d.n} className="min-w-0 flex-1 px-3 py-3">
                <Text className="text-xs uppercase tracking-wide text-ink-700">{d.label}</Text>
              </View>
            ))}
          </View>
          {periods.map((p) => (
            <View key={p.id} className="flex-row border-t border-ink-100">
              <View className="w-1/6 shrink-0 justify-center px-3 py-3">
                <Text className="font-medium text-ink-900">{p.name}</Text>
                <Text className="text-xs text-ink-700">
                  {p.start}–{p.end}
                </Text>
              </View>
              {weekdays.map((d) => {
                const slot = findSlot(slots, p, d.n);
                const key = `${p.id}:${d.n}`;
                return (
                  <View key={key} className="min-w-0 flex-1 px-2 py-2">
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
        <Text className="text-xs text-white">{subjectName}</Text>
      </View>
    );
  }
  return (
    <Pressable disabled={!editable} onPress={() => onPick(subjectName, true)} className={className}>
      <Text className="text-xs text-white">{subjectName}</Text>
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
      className={`${tall ? "min-h-[64px]" : "min-h-[72px]"} rounded-xl border px-3 py-2.5 ${
        hot
          ? "border-clay-500 bg-blue-50"
          : waiting
            ? "border-clay-500/50 bg-blue-50/70"
            : "border-dashed border-ink-200 bg-white"
      }`}
    >
      <Pressable onPress={onPress} className={tall ? "min-h-[48px] justify-center" : "min-h-[56px]"}>
        {filled ? (
          <View className="flex-row items-start justify-between gap-2">
            <View className="min-w-0 flex-1">
              <Text className="font-medium text-ink-900">{subject}</Text>
              {teacher ? <Text className="text-xs text-ink-700">Regular · {teacher}</Text> : null}
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
            </View>
            {editable ? (
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  onClear();
                }}
                className="min-h-[36px] justify-center px-1"
              >
                <Text className="text-[11px] text-clay-600">Clear</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View className="items-center justify-center">
            {editable && hint ? (
              <Text className="text-center text-xs text-ink-700">{hint}</Text>
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
