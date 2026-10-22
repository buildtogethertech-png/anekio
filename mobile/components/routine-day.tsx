/**
 * Routine "By date": the weekly timetable as it actually runs on one day, plus one-day changes.
 * Office (timetable.edit) can change a period for that date only, or for every week (permanent).
 * Teachers never change anything here.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Button, Chip, ChipScroller, Field, Input, Modal, Toast, useToast } from "./ui";
import { act } from "../lib/mutate";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";

type Candidate = { id: string; name: string; tier: number; reason: string; periodsToday: number };
type Row = {
  slotId: string;
  classId: string;
  classLabel: string;
  periodId: string;
  period: string;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
  subjectId: string;
  subject: string;
  room: string;
  weeklyTeacherId: string;
  weeklyTeacher: string;
  status: "" | "COVERED" | "FREE" | "OPEN";
  reason: string;
  reasonLabel: string;
  note: string;
  teacherId: string;
  teacher: string;
  fromLeave: boolean;
  candidates: Candidate[];
};
type Day = {
  date: string;
  weekday: number;
  closed: string;
  canEdit: boolean;
  periods: { id: string; name: string; startsAt: string; endsAt: string; isBreak: boolean }[];
  rows: Row[];
  needsCover: number;
  teachersOut: { id: string; name: string; why: string; onLeave: boolean; periods: number; open: number }[];
  teachers?: { id: string; name: string }[];
};

function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shiftDate(value: string, days: number) {
  const [y, m, d] = value.split("-").map(Number);
  return ymdLocal(new Date(y, m - 1, d + days));
}
function dayTitle(value: string) {
  const today = ymdLocal(new Date());
  const label = new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  if (value === today) return `Today · ${label}`;
  if (value === shiftDate(today, 1)) return `Tomorrow · ${label}`;
  return label;
}
function weekdayName(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long" });
}
function shortDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

const NEEDS_COVER = "__needs_cover__";

export function DayTimetable() {
  const { data, reload } = useRecord();
  const { token } = useSession();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const phone = width < 700;
  const classes = data?.timetable?.classes ?? [];
  const [date, setDate] = useState(ymdLocal(new Date()));
  const [day, setDay] = useState<Day | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [classId, setClassId] = useState(classes[0]?.id || "");
  const [editing, setEditing] = useState<Row | null>(null);
  const [outOpen, setOutOpen] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setDay(await act<Day & { ok: true }>(token, "loadDayTimetable", { date }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this day.");
    } finally {
      setLoading(false);
    }
  }, [token, date]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!classId && classes[0]?.id) setClassId(classes[0].id);
  }, [classes, classId]);

  async function run(op: string, body: Record<string, unknown>, ok: string) {
    setBusy(op);
    try {
      await act(token, op, body);
      toast.show(ok);
      await load();
      void reload();
      return true;
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setBusy("");
    }
  }

  const canEdit = Boolean(day?.canEdit);
  const showAllOpen = classId === NEEDS_COVER;
  const rows = useMemo(() => {
    if (!day) return [];
    if (showAllOpen) return day.rows.filter((r) => r.status === "OPEN").sort((a, b) => a.sortOrder - b.sortOrder);
    return day.rows.filter((r) => r.classId === classId);
  }, [day, classId, showAllOpen]);
  const changedHere = rows.filter((r) => r.status).length;

  return (
    <View className="min-h-0 flex-1">
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="shrink-0 gap-3">
        <View className={phone ? "gap-2" : "flex-row items-center justify-between gap-3"}>
          <View className="flex-row items-center gap-1">
            <Pressable accessibilityLabel="Previous day" onPress={() => setDate(shiftDate(date, -1))} className="h-9 w-9 items-center justify-center rounded-lg border border-ink-200 bg-white">
              <Ionicons name="chevron-back" size={16} color="#334155" />
            </Pressable>
            <View className="min-w-[180px] items-center px-2">
              <Text className="text-[16px] font-semibold text-ink-900">{dayTitle(date)}</Text>
            </View>
            <Pressable accessibilityLabel="Next day" onPress={() => setDate(shiftDate(date, 1))} className="h-9 w-9 items-center justify-center rounded-lg border border-ink-200 bg-white">
              <Ionicons name="chevron-forward" size={16} color="#334155" />
            </Pressable>
            {date !== ymdLocal(new Date()) ? (
              <Pressable onPress={() => setDate(ymdLocal(new Date()))} className="ml-1 h-9 justify-center rounded-lg px-2">
                <Text className="text-[13px] font-medium text-clay-600">Today</Text>
              </Pressable>
            ) : null}
          </View>
          {canEdit && day && !day.closed ? (
            <View className="flex-row flex-wrap items-center gap-2">
              <Button variant="ghost" className="anekio-btn h-9 px-3 py-1.5" onPress={() => setOutOpen(true)}>
                Mark teacher out
              </Button>
              {day.needsCover ? (
                <Button
                  className="h-9 px-3 py-1.5"
                  disabled={Boolean(busy)}
                  onPress={async () => {
                    setBusy("autoCoverDay");
                    try {
                      const res = await act<{ ok: true; covered: number; left: number }>(token, "autoCoverDay", { date });
                      toast.show(res.left ? `${res.covered} covered · ${res.left} still need a teacher` : `${res.covered} periods covered.`);
                      await load();
                      void reload();
                    } catch (e) {
                      toast.show(e instanceof Error ? e.message : "Could not auto-assign.");
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  {busy === "autoCoverDay" ? "Assigning…" : `Auto-assign ${day.needsCover}`}
                </Button>
              ) : null}
            </View>
          ) : null}
        </View>

        {day?.teachersOut.length ? (
          <View className="flex-row flex-wrap gap-2">
            {day.teachersOut.map((t) => (
              <View key={t.id} className="flex-row items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5">
                <Ionicons name="person-remove-outline" size={14} color="#B45309" />
                <Text className="text-[13px] text-amber-900">
                  <Text className="font-semibold">{t.name}</Text> · {t.why}
                  {t.open ? ` · ${t.open} need cover` : t.periods ? " · all covered" : ""}
                </Text>
                {canEdit && !t.onLeave ? (
                  <Pressable
                    accessibilityLabel={`${t.name} is back`}
                    onPress={() => void run("clearTeacherOut", { date, teacherId: t.id }, `${t.name} is back on the timetable.`)}
                    className="ml-1 rounded px-1"
                  >
                    <Text className="text-[12px] font-medium text-amber-800 underline">Undo</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <ChipScroller>
          {day?.needsCover ? (
            <Chip label={`Needs cover · ${day.needsCover}`} active={showAllOpen} onPress={() => setClassId(NEEDS_COVER)} />
          ) : null}
          {classes.map((c) => {
            const open = day?.rows.filter((r) => r.classId === c.id && r.status === "OPEN").length ?? 0;
            return <Chip key={c.id || c.label} label={open ? `${c.label} · ${open}` : c.label} active={classId === c.id} onPress={() => setClassId(c.id || "")} />;
          })}
        </ChipScroller>
      </View>

      <ScrollView className="mt-3 min-h-0 flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
        {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
        {loading && !day ? <Text className="text-sm text-ink-500">Loading…</Text> : null}
        {day?.closed ? (
          <View className="items-center rounded-xl border border-ink-100 bg-white px-4 py-10">
            <Ionicons name="moon-outline" size={22} color="#94A3B8" />
            <Text className="mt-2 text-[15px] font-semibold text-ink-900">School closed</Text>
            <Text className="mt-0.5 text-[13px] text-ink-500">{day.closed}</Text>
          </View>
        ) : day ? (
          <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
            {!showAllOpen ? (
              <View className="flex-row items-center justify-between border-b border-ink-100 px-4 py-2">
                <Text className="text-[12px] text-ink-500">
                  {changedHere ? `${changedHere} ${changedHere === 1 ? "change" : "changes"} only for ${shortDate(date)} · everything else as every ${weekdayName(date)}` : `Same as every ${weekdayName(date)}`}
                </Text>
              </View>
            ) : null}
            {rows.length ? (
              rows.map((row, i) => (
                <PeriodRow key={row.slotId} row={row} first={i === 0} showClass={showAllOpen} canEdit={canEdit} onPress={() => setEditing(row)} />
              ))
            ) : (
              <Text className="px-4 py-8 text-center text-[13px] text-ink-500">
                {showAllOpen ? "Every period has a teacher." : "No lessons for this class on this day."}
              </Text>
            )}
          </View>
        ) : null}
      </ScrollView>

      {editing && day ? (
        <ChangeSheet
          row={editing}
          date={date}
          teachers={day.teachers ?? []}
          busy={Boolean(busy)}
          onClose={() => setEditing(null)}
          onToday={async (body, ok) => {
            if (await run("saveDayChange", { date, slotId: editing.slotId, ...body }, ok)) setEditing(null);
          }}
          onUndo={async () => {
            if (await run("clearDayChange", { date, slotId: editing.slotId }, "Back to the usual timetable for this day.")) setEditing(null);
          }}
          onPermanent={async (teacherId) => {
            const ok = await run(
              "saveTimetableSlot",
              { classId: editing.classId, periodId: editing.periodId, weekday: day.weekday, teacherId, subjectId: editing.subjectId },
              `Changed for every ${weekdayName(date)}.`,
            );
            if (ok) setEditing(null);
          }}
        />
      ) : null}

      {outOpen && day ? (
        <TeacherOutSheet
          date={date}
          teachers={(day.teachers ?? []).filter((t) => !day.teachersOut.some((o) => o.id === t.id))}
          busy={Boolean(busy)}
          onClose={() => setOutOpen(false)}
          onSave={async (teacherId, reason, note, name) => {
            if (await run("markTeacherOut", { date, teacherId, reason, note }, `${name} marked out. Their periods need cover.`)) {
              setOutOpen(false);
              setClassId(NEEDS_COVER);
            }
          }}
        />
      ) : null}
    </View>
  );
}

function PeriodRow({ row, first, showClass, canEdit, onPress }: { row: Row; first: boolean; showClass: boolean; canEdit: boolean; onPress: () => void }) {
  const changed = Boolean(row.status);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!canEdit}
      onPress={onPress}
      className={`flex-row items-center gap-3 px-4 py-3 ${first ? "" : "border-t border-ink-100"} ${row.status === "OPEN" ? "bg-red-50/60" : changed ? "bg-amber-50/50" : ""} ${canEdit ? "active:bg-ink-50" : ""}`}
    >
      <View className="w-[64px]">
        <Text className="text-[13px] font-semibold text-ink-900">{row.period}</Text>
        <Text className="text-[11px] tabular-nums text-ink-500">{row.startsAt}</Text>
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-medium text-ink-900" numberOfLines={1}>
          {showClass ? `${row.classLabel} · ` : ""}
          {row.subject}
        </Text>
        <View className="mt-0.5 flex-row flex-wrap items-center gap-1.5">
          {changed && row.weeklyTeacher ? (
            <Text className="text-[12px] text-ink-400 line-through" numberOfLines={1}>{row.weeklyTeacher}</Text>
          ) : null}
          <Text className={`text-[12px] ${row.status === "OPEN" ? "font-semibold text-red-700" : changed ? "font-semibold text-ink-900" : "text-ink-600"}`} numberOfLines={1}>
            {row.status === "OPEN" ? "Needs a teacher" : row.status === "FREE" ? "No lesson" : row.teacher || "No teacher"}
          </Text>
        </View>
      </View>
      {changed ? (
        <View className={`rounded-full px-2 py-0.5 ${row.status === "OPEN" ? "bg-red-100" : "bg-amber-100"}`}>
          <Text className={`text-[11px] font-semibold ${row.status === "OPEN" ? "text-red-700" : "text-amber-800"}`}>
            {row.reasonLabel ? `${row.reasonLabel} · ` : ""}this day only
          </Text>
        </View>
      ) : null}
      {canEdit ? <Ionicons name="chevron-forward" size={15} color="#CBD5E1" /> : null}
    </Pressable>
  );
}

type TodayBody = { status: "COVERED" | "FREE"; substituteId?: string; reason?: string; note?: string };

function ChangeSheet({
  row,
  date,
  teachers,
  busy,
  onClose,
  onToday,
  onUndo,
  onPermanent,
}: {
  row: Row;
  date: string;
  teachers: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onToday: (body: TodayBody, ok: string) => void;
  onUndo: () => void;
  onPermanent: (teacherId: string) => void;
}) {
  const [scope, setScope] = useState<"today" | "always">("today");
  const [pick, setPick] = useState<string>(row.status === "FREE" ? "FREE" : row.status === "COVERED" ? row.teacherId : "");
  const [reason, setReason] = useState(row.reason && row.reason !== "LEAVE" ? row.reason : "ABSENT");
  const [note, setNote] = useState(row.note);
  const [always, setAlways] = useState(row.weeklyTeacherId);
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? row.candidates : row.candidates.slice(0, 6);
  const day = weekdayName(date);
  const pickedName = row.candidates.find((c) => c.id === pick)?.name || "";

  return (
    <Modal
      open
      sheetOnPhone
      title={`${row.period} · ${row.classLabel} ${row.subject}`}
      onClose={onClose}
      footer={
        <View className="flex-row items-center justify-end gap-2">
          {scope === "today" && row.status && !(row.fromLeave && row.status === "OPEN") ? (
            <Button variant="ghost" disabled={busy} onPress={onUndo} className="mr-auto">
              Undo change
            </Button>
          ) : null}
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          {scope === "today" ? (
            <Button
              disabled={busy || !pick}
              onPress={() =>
                pick === "FREE"
                  ? onToday({ status: "FREE", reason, note }, `${row.period} has no lesson on ${shortDate(date)}.`)
                  : onToday({ status: "COVERED", substituteId: pick, reason, note }, `${pickedName} takes ${row.period} on ${shortDate(date)}. They've been told.`)
              }
            >
              {`Save for ${shortDate(date)}`}
            </Button>
          ) : (
            <Button disabled={busy || !always || always === row.weeklyTeacherId} onPress={() => onPermanent(always)}>
              {`Save for every ${day}`}
            </Button>
          )}
        </View>
      }
    >
      <View className="gap-4">
        <View>
          <Text className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Change for</Text>
          <View className="flex-row gap-2">
            {(
              [
                ["today", `Only ${shortDate(date)}`, "Weekly timetable stays the same"],
                ["always", `Every ${day}`, "Permanent change to the weekly timetable"],
              ] as const
            ).map(([key, title, hint]) => {
              const on = scope === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setScope(key)}
                  className={`flex-1 rounded-xl border px-3 py-2.5 ${on ? "border-clay-500 bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                >
                  <View className="flex-row items-center gap-2">
                    <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={16} color={on ? "#1F45C7" : "#94A3B8"} />
                    <Text className="text-[14px] font-semibold text-ink-900">{title}</Text>
                  </View>
                  <Text className="ml-6 mt-0.5 text-[12px] text-ink-500">{hint}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {scope === "today" ? (
          <>
            {row.fromLeave ? (
              <View className="flex-row items-center gap-2 rounded-lg bg-amber-50 px-3 py-2">
                <Ionicons name="airplane-outline" size={14} color="#B45309" />
                <Text className="text-[13px] text-amber-900">{row.weeklyTeacher} is on leave this day.</Text>
              </View>
            ) : null}
            <View>
              <Text className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Who takes this period</Text>
              <View className="overflow-hidden rounded-xl border border-ink-200">
                {list.map((c, i) => {
                  const on = pick === c.id;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setPick(c.id)}
                      className={`flex-row items-center gap-3 px-3 py-2.5 ${i ? "border-t border-ink-100" : ""} ${on ? "bg-[#EEF3FF]" : "active:bg-ink-50"}`}
                    >
                      <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={16} color={on ? "#1F45C7" : "#94A3B8"} />
                      <View className="min-w-0 flex-1">
                        <Text className="text-[14px] font-medium text-ink-900">{c.name}</Text>
                        <Text className="text-[12px] text-ink-500">{`${c.reason} · ${c.periodsToday} ${c.periodsToday === 1 ? "period" : "periods"} that day`}</Text>
                      </View>
                      {i === 0 && !showAll ? <Text className="text-[11px] font-semibold text-emerald-700">Best fit</Text> : null}
                    </Pressable>
                  );
                })}
                {!row.candidates.length ? <Text className="px-3 py-3 text-[13px] text-ink-500">No teacher is free in this period.</Text> : null}
                {row.candidates.length > 6 && !showAll ? (
                  <Pressable onPress={() => setShowAll(true)} className="border-t border-ink-100 px-3 py-2">
                    <Text className="text-[13px] font-medium text-clay-600">{`Show all ${row.candidates.length} free teachers`}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => setPick("FREE")}
                  className={`flex-row items-center gap-3 border-t border-ink-100 px-3 py-2.5 ${pick === "FREE" ? "bg-[#EEF3FF]" : "active:bg-ink-50"}`}
                >
                  <Ionicons name={pick === "FREE" ? "radio-button-on" : "radio-button-off"} size={16} color={pick === "FREE" ? "#1F45C7" : "#94A3B8"} />
                  <Text className="text-[14px] text-ink-900">No lesson (free period)</Text>
                </Pressable>
              </View>
            </View>
            {!row.fromLeave ? (
              <View>
                <Text className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{`Why${row.weeklyTeacher ? ` isn't ${row.weeklyTeacher} taking it` : ""}`}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {[
                    ["ABSENT", "Absent"],
                    ["DUTY", "On duty"],
                    ["OTHER", "Other"],
                  ].map(([key, label]) => (
                    <Chip key={key} label={label} active={reason === key} onPress={() => setReason(key)} />
                  ))}
                </View>
              </View>
            ) : null}
            <Field label="Note (optional)">
              <Input value={note} onChangeText={setNote} placeholder="e.g. Sports day duty" maxLength={200} />
            </Field>
          </>
        ) : (
          <>
            <View className="flex-row items-start gap-2 rounded-lg bg-[#EEF3FF] px-3 py-2">
              <Ionicons name="information-circle-outline" size={15} color="#1F45C7" />
              <Text className="flex-1 text-[13px] text-ink-700">
                {`This changes ${row.period} of ${row.classLabel} on every ${day} from now on. To change the subject, use the weekly timetable.`}
              </Text>
            </View>
            <View>
              <Text className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Teacher every {day}</Text>
              <ScrollView style={{ maxHeight: 320 }} className="rounded-xl border border-ink-200">
                {teachers.map((t, i) => {
                  const on = always === t.id;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => setAlways(t.id)}
                      className={`flex-row items-center gap-3 px-3 py-2.5 ${i ? "border-t border-ink-100" : ""} ${on ? "bg-[#EEF3FF]" : "active:bg-ink-50"}`}
                    >
                      <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={16} color={on ? "#1F45C7" : "#94A3B8"} />
                      <Text className="flex-1 text-[14px] text-ink-900">{t.name}</Text>
                      {t.id === row.weeklyTeacherId ? <Text className="text-[11px] text-ink-500">Now</Text> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

function TeacherOutSheet({
  date,
  teachers,
  busy,
  onClose,
  onSave,
}: {
  date: string;
  teachers: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onSave: (teacherId: string, reason: string, note: string, name: string) => void;
}) {
  const [teacherId, setTeacherId] = useState("");
  const [reason, setReason] = useState("ABSENT");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const shown = teachers.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));
  const name = teachers.find((t) => t.id === teacherId)?.name || "";
  return (
    <Modal
      open
      sheetOnPhone
      title={`Teacher out · ${shortDate(date)}`}
      onClose={onClose}
      footer={
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !teacherId} onPress={() => onSave(teacherId, reason, note, name)}>
            {name ? `Mark ${name} out` : "Mark out"}
          </Button>
        </View>
      }
    >
      <View className="gap-4">
        <Text className="text-[13px] text-ink-600">
          {`Their periods on ${shortDate(date)} move to "Needs cover". Only this day changes. For leave, approve the leave instead and it shows up here on its own.`}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {[
            ["ABSENT", "Absent"],
            ["DUTY", "On duty"],
          ].map(([key, label]) => (
            <Chip key={key} label={label} active={reason === key} onPress={() => setReason(key)} />
          ))}
        </View>
        <Input value={q} onChangeText={setQ} placeholder="Search teacher" />
        <ScrollView style={{ maxHeight: 300 }} className="rounded-xl border border-ink-200">
          {shown.map((t, i) => {
            const on = teacherId === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setTeacherId(t.id)}
                className={`flex-row items-center gap-3 px-3 py-2.5 ${i ? "border-t border-ink-100" : ""} ${on ? "bg-[#EEF3FF]" : "active:bg-ink-50"}`}
              >
                <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={16} color={on ? "#1F45C7" : "#94A3B8"} />
                <Text className="text-[14px] text-ink-900">{t.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Field label="Note (optional)">
          <Input value={note} onChangeText={setNote} placeholder="e.g. Exam duty at board centre" maxLength={200} />
        </Field>
      </View>
    </Modal>
  );
}
