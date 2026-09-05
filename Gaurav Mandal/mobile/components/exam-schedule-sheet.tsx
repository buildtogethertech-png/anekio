import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { DateField } from "./date-field";
import {
  cadenceForKind,
  closedReason as dayClosed,
  defaultExamStart,
  inferDeadlineOffsets,
  paperOffsets,
  paperDates,
  prettyDay,
  sittingDeadlines,
  type DeadlineOffsets,
  type SchoolCalendar,
} from "../lib/calendar";

export type ScheduleSubject = { id: string; name: string; teacherId?: string };
export type ScheduleExisting = {
  date: string;
  paperDueOn?: string | null;
  copiesDueOn?: string | null;
  resultOn?: string | null;
  teacherId?: string | null;
  setterId?: string | null;
  maxMarks?: number;
  subject: { id: string; name: string };
};
export type SchedulePaper = {
  subjectId: string;
  date: string;
  teacherId: string;
  setterId: string;
  maxMarks: number;
  paperDueOn: string;
  copiesDueOn: string;
  resultOn: string;
};
export type ExamScheduleSheetHandle = { save: () => void };

type Row = {
  subjectId: string;
  name: string;
  date: string;
  teacherId: string;
  setterId: string;
  maxMarks: number;
  paperDueOn: string;
  copiesDueOn: string;
  split: boolean;
};

function day(value?: string | null) {
  return (value || "").slice(0, 10);
}

function seedRows(
  subjects: ScheduleSubject[],
  start: string,
  kind: string,
  maxMarks: number,
  calendar: SchoolCalendar,
  existing?: ScheduleExisting[]
): Row[] {
  const bySubject = new Map((existing || []).map((e) => [e.subject.id, e]));
  const dates = paperDates(subjects.length, start, cadenceForKind(kind), calendar);
  return subjects.map((subject, i) => {
    const found = bySubject.get(subject.id);
    const teacherId = found?.teacherId || subject.teacherId || "";
    const setterId = found?.setterId || teacherId;
    return {
      subjectId: subject.id,
      name: subject.name,
      date: day(found?.date) || dates[i] || start,
      teacherId,
      setterId,
      maxMarks: found?.maxMarks || maxMarks,
      paperDueOn: day(found?.paperDueOn),
      copiesDueOn: day(found?.copiesDueOn),
      split: Boolean(setterId && teacherId && setterId !== teacherId),
    };
  });
}

function DeadlineControl({
  title,
  days,
  relation,
  onDays,
  date,
  onDate,
}: {
  title: string;
  days: number;
  relation: string;
  onDays: (days: number) => void;
  date?: string;
  onDate?: (date: string) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-ink-900">{title}</Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          accessibilityLabel={`${title} working days`}
          keyboardType="number-pad"
          selectTextOnFocus
          value={String(days)}
          onChangeText={(value) => onDays(Math.max(0, Number(value.replace(/\D/g, "") || 0)))}
          className="w-11 border-b-2 border-clay-500 px-1 py-1 text-center text-lg font-semibold text-ink-900"
        />
        <Text className="min-w-0 flex-1 text-xs leading-4 text-ink-700">working days {relation}</Text>
      </View>
      {date && onDate ? (
        <View className="flex-row items-center gap-1.5">
          <Text className="text-xs text-ink-700">Publishes</Text>
          <View className="min-w-0 flex-1">
            <DateField plain bare value={date} onChange={onDate} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export const ExamScheduleSheet = forwardRef<
  ExamScheduleSheetHandle,
  {
    sittingName: string;
    kind?: string;
    maxMarks: number;
    subjects: ScheduleSubject[];
    calendar: SchoolCalendar;
    existing?: ScheduleExisting[];
    deadlineSource?: ScheduleExisting[];
    pending?: boolean;
    confirmLabel?: string;
    hideConfirm?: boolean;
    onOpenRoutine?: () => void;
    onSave: (papers: SchedulePaper[]) => void;
  }
>(function ExamScheduleSheet(
  {
    sittingName,
    kind,
    maxMarks,
    subjects,
    calendar,
    existing,
    deadlineSource,
    pending,
    confirmLabel,
    hideConfirm,
    onOpenRoutine,
    onSave,
  },
  ref
) {
  const sittingKind = kind || "term1";
  const sameDay = cadenceForKind(sittingKind) === "same";
  const firstExisting = day(existing?.[0]?.date);
  const initialStart = firstExisting || defaultExamStart(calendar);
  const seededRows = seedRows(subjects, initialStart, sittingKind, maxMarks, calendar, existing);
  const savedDeadlines = existing?.length ? existing : deadlineSource;
  const deadlinesVaryByPaper = Boolean(
    savedDeadlines?.length &&
      [
        savedDeadlines.map((item) => day(item.paperDueOn)),
        savedDeadlines.map((item) => day(item.copiesDueOn)),
      ].some((dates) => new Set(dates).size > 1)
  );
  const savedDates = savedDeadlines?.map((item) => day(item.date)) || seededRows.map((row) => row.date);
  const paperOffsetDates = deadlinesVaryByPaper
    ? [day(savedDeadlines?.[0]?.date)]
    : savedDates;
  const paperDeadlineOffsets = inferDeadlineOffsets(paperOffsetDates, savedDeadlines?.[0] || {}, calendar);
  const resultDeadlineOffset = inferDeadlineOffsets(savedDates, savedDeadlines?.[0] || {}, calendar).resultAfter;
  const seededOffsets = { ...paperDeadlineOffsets, resultAfter: resultDeadlineOffset };
  const [offsets, setOffsets] = useState<DeadlineOffsets>(seededOffsets);
  const [rows, setRows] = useState<Row[]>(() =>
    seededRows
      .map((row) => {
        const calculated = paperOffsets(row.date, seededOffsets, calendar);
        return {
          ...row,
          paperDueOn: row.paperDueOn || calculated.paperDueOn,
          copiesDueOn: row.copiesDueOn || calculated.copiesDueOn,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
  );
  const [resultDate, setResultDate] = useState(
    () =>
      day(existing?.[0]?.resultOn) ||
      sittingDeadlines(
        seededRows.map((row) => row.date),
        seededOffsets,
        calendar
      ).resultOn
  );
  const [resultDateChanged, setResultDateChanged] = useState(false);
  const [stagger, setStagger] = useState(() => rows.some((row) => row.date !== initialStart));
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);

  const reasonFor = useMemo(() => (value: string) => dayClosed(value, calendar), [calendar]);
  const orderedExamDates = rows.map((row) => row.date).filter(Boolean).sort();
  const firstDate = orderedExamDates[0] || initialStart;
  const lastDate = orderedExamDates[orderedExamDates.length - 1] || firstDate;

  function updateResultDate(nextRows: Row[], nextOffsets = offsets) {
    if (resultDateChanged) return;
    setResultDate(
      sittingDeadlines(
        nextRows.map((row) => row.date),
        nextOffsets,
        calendar
      ).resultOn
    );
  }

  function patch(subjectId: string, next: Partial<Row>) {
    setRows((cur) => {
      const nextRows = cur.map((row) => {
        if (row.subjectId !== subjectId) return row;
        const updated = { ...row, ...next };
        return next.date ? { ...updated, ...paperOffsets(updated.date, offsets, calendar) } : updated;
      }).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
      if (next.date) updateResultDate(nextRows);
      return nextRows;
    });
  }

  function setDeadlineDays(kind: "paper" | "copies" | "result", days: number) {
    const nextOffsets = {
      ...offsets,
      paperBefore: kind === "paper" ? days : offsets.paperBefore,
      copiesAfter: kind === "copies" ? days : offsets.copiesAfter,
      resultAfter: kind === "result" ? days : offsets.resultAfter,
    };
    setOffsets(nextOffsets);
    if (kind === "result") {
      setResultDateChanged(false);
      setResultDate(
        sittingDeadlines(
          rows.map((row) => row.date),
          nextOffsets,
          calendar
        ).resultOn
      );
      return;
    }
    setRows((cur) =>
      cur.map((row) => {
        const calculated = paperOffsets(row.date, nextOffsets, calendar);
        if (kind === "paper") return { ...row, paperDueOn: calculated.paperDueOn };
        return { ...row, copiesDueOn: calculated.copiesDueOn };
      })
    );
  }

  function save() {
    const unassigned = rows.filter((row) => !row.teacherId);
    if (unassigned.length) {
      setError(
        `Schedule not saved. Assign teachers to ${unassigned.map((row) => row.name).join(", ")} in Routine first.`
      );
      return;
    }
    if (rows.some((row) => !row.date)) {
      setError("Every paper needs an exam date.");
      return;
    }
    if (rows.some((row) => !row.paperDueOn || !row.copiesDueOn) || !resultDate) {
      setError("Every paper needs paper-ready and checking dates, and the sitting needs a result date.");
      return;
    }
    setError("");
    onSave(
      rows.map((row) => ({
        subjectId: row.subjectId,
        date: row.date,
        teacherId: row.teacherId,
        setterId: row.split ? row.setterId || row.teacherId : row.teacherId,
        maxMarks: row.maxMarks,
        paperDueOn: row.paperDueOn,
        copiesDueOn: row.copiesDueOn,
        resultOn: resultDate,
      }))
    );
  }

  useImperativeHandle(ref, () => ({ save }));

  return (
    <View className="gap-5">
      <View className="flex-row flex-wrap gap-x-10 gap-y-3 border-b border-ink-100 pb-4">
        <View>
          <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-700">First exam</Text>
          <Text className="mt-1 text-sm font-medium text-ink-900">{prettyDay(firstDate, true)}</Text>
        </View>
        <View>
          <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-700">Last exam</Text>
          <Text className="mt-1 text-sm font-medium text-ink-900">{prettyDay(lastDate, true)}</Text>
        </View>
        <View>
          <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-700">Papers</Text>
          <Text className="mt-1 text-sm font-medium text-ink-900">{rows.length}</Text>
        </View>
      </View>

      {rows.some((row) => !row.teacherId) ? (
        <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-semibold text-amber-900">Teacher assignment needed</Text>
            <Text className="mt-0.5 text-xs leading-4 text-amber-900">
              {rows.filter((row) => !row.teacherId).map((row) => row.name).join(", ")} {rows.filter((row) => !row.teacherId).length === 1 ? "has" : "have"} no teacher. The assigned teacher checks the paper and enters marks.
            </Text>
          </View>
          {onOpenRoutine ? (
            <Pressable accessibilityRole="button" onPress={onOpenRoutine} className="rounded-md border border-amber-400 bg-white px-3 py-2">
              <Text className="text-xs font-semibold text-amber-900">Open Routine</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View>
        <Pressable onPress={() => setAdvanced((v) => !v)} className="flex-row items-center justify-between py-1">
          <Text className="text-sm font-medium text-ink-900">Advanced scheduling options {advanced ? "▴" : "▾"}</Text>
        </Pressable>
        {advanced ? (
        <View>
        <Text className="text-sm font-medium text-ink-900">Deadline rules</Text>
        <Text className="mt-0.5 text-xs leading-4 text-ink-700">
          Change a number to update every paper. Individual dates can still be adjusted below.
        </Text>
        <View className="mt-4 flex-row flex-wrap gap-y-5 border-b border-ink-100 pb-5">
          <View className="min-w-[14rem] flex-1 pr-5">
            <DeadlineControl
              title="Paper due"
              days={offsets.paperBefore}
              relation="before each exam"
              onDays={(days) => setDeadlineDays("paper", days)}
            />
          </View>
          <View className="min-w-[14rem] flex-1 border-l border-ink-100 px-5">
            <DeadlineControl
              title="Checking due"
              days={offsets.copiesAfter}
              relation="after each exam"
              onDays={(days) => setDeadlineDays("copies", days)}
            />
          </View>
          <View className="min-w-[14rem] flex-1 border-l border-ink-100 pl-5">
            <DeadlineControl
              title="Results out"
              days={offsets.resultAfter}
              relation="after the final exam"
              onDays={(days) => setDeadlineDays("result", days)}
              date={resultDate}
              onDate={(date) => {
                setResultDateChanged(true);
                setResultDate(date);
              }}
            />
          </View>
        </View>
        </View>
        ) : null}
      </View>
      <View className="gap-3">
        <View className="flex-row items-end justify-between gap-3">
          <View className="flex-1">
            <Text className="text-sm font-medium text-ink-900">Papers</Text>
          </View>
          {sameDay ? (
            <Pressable onPress={() => setStagger((v) => !v)}>
              <Text className="text-xs font-medium text-clay-600">{stagger ? "Same day" : "Different days"}</Text>
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
          <View className="min-w-full">
            <View className="flex-row gap-3 border-b border-ink-200 pb-2">
              <Text className="w-36 shrink-0 text-[11px] font-medium uppercase tracking-wide text-ink-700">Paper</Text>
              <Text className="min-w-[11rem] basis-0 flex-1 text-center text-[11px] font-medium uppercase tracking-wide text-ink-700">Paper due</Text>
              <Text className="min-w-[11rem] basis-0 flex-1 text-center text-[11px] font-medium uppercase tracking-wide text-ink-700">Exam date</Text>
              <Text className="min-w-[11rem] basis-0 flex-1 text-center text-[11px] font-medium uppercase tracking-wide text-ink-700">Checking due</Text>
            </View>
            {rows.map((row) => (
              <View key={row.subjectId} className="flex-row items-center gap-3 border-b border-ink-100 py-2.5">
                <Text className="w-36 shrink-0 text-sm font-medium text-ink-900" numberOfLines={2}>
                  {row.name}
                  <Text className="font-normal text-ink-700"> /{row.maxMarks}</Text>
                </Text>
                <View className="min-w-[11rem] basis-0 flex-1">
                  <DateField
                    plain
                    value={row.paperDueOn}
                    onChange={(paperDueOn) => patch(row.subjectId, { paperDueOn })}
                  />
                </View>
                <View className="min-w-[11rem] basis-0 flex-1">
                  <DateField
                    plain
                    value={row.date}
                    onChange={(date) => {
                      setStagger(true);
                      patch(row.subjectId, { date });
                    }}
                    closedReason={reasonFor}
                  />
                </View>
                <View className="min-w-[11rem] basis-0 flex-1">
                  <DateField
                    plain
                    value={row.copiesDueOn}
                    onChange={(copiesDueOn) => patch(row.subjectId, { copiesDueOn })}
                  />
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      {hideConfirm ? null : (
        <View className="items-end">
          <Pressable
            disabled={pending || !rows.length}
            onPress={save}
            className={`items-center rounded-md bg-clay-500 px-4 py-2.5 ${pending || !rows.length ? "opacity-50" : ""}`}
          >
            <Text className="text-sm font-medium text-white">{confirmLabel || `Schedule ${sittingName}`}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
});
