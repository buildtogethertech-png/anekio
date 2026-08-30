import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { Badge, Button, Card, Chip, ChipScroller, Modal, Toast, useToast } from "./ui";
import { ExamScheduleSheet, type ExamScheduleSheetHandle, type SchedulePaper } from "./exam-schedule-sheet";
import { act } from "../lib/mutate";
import { calendarFrom } from "../lib/calendar";
import { examPlanWeight } from "../lib/exams";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";
import { QuickDocumentButton } from "./document-studio";

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

function day(value?: string | null) {
  return (value || "").slice(0, 10);
}

function prettyDay(value?: string | null) {
  const s = day(value);
  const [y, m, d] = s.split("-").map(Number);
  if (!y) return "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function pill(active: boolean) {
  return `rounded-md border px-2.5 py-1 ${
    active ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"
  }`;
}

function pillText(active: boolean) {
  return `text-xs ${active ? "text-white" : "text-ink-800"}`;
}

export function ExamsBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const toast = useToast();
  const canRun = can(user, "exams.edit");
  const classes = data?.classes ?? [];
  const school = data?.school;
  const pack = data?.examPack;
  const sessions = school?.sessions ?? [];
  const currentSession = sessions.find((s) => s.current) ?? sessions[0];
  const [sessionId, setSessionId] = useState(currentSession?.id || school?.sessionId || "");
  const [classId, setClassId] = useState(classes[0]?.id || "");
  const [seriesId, setSeriesId] = useState("");
  const [pending, setPending] = useState("");
  const [copyIds, setCopyIds] = useState<string[]>([]);
  const [sheet, setSheet] = useState<"create" | "edit" | "">("");
  const scheduleRef = useRef<ExamScheduleSheetHandle>(null);

  useEffect(() => {
    if (!classId && classes[0]?.id) setClassId(classes[0].id);
  }, [classId, classes]);

  useEffect(() => {
    if (!sessionId && currentSession?.id) setSessionId(currentSession.id);
  }, [sessionId, currentSession?.id]);

  const session = sessions.find((s) => s.id === sessionId) ?? currentSession;
  const plan = (sessionId && pack?.planBySession?.[sessionId]) || school?.plan || [];
  const klass = classes.find((c) => c.id === classId) || classes[0];
  const classLabel = klass ? klass.label : "";
  const studentCount =
    klass?.students ?? data?.exams?.find((e) => e.id === klass?.id)?.students ?? 0;
  const seriesForClass = (pack?.series ?? []).filter(
    (s) => s.classId === (klass?.id || classId) && s.sessionId === (session?.id || sessionId)
  );
  const series = seriesForClass.find((s) => s.id === seriesId) || seriesForClass[0] || null;
  const scheduledIds = [...new Set(seriesForClass.map((s) => s.planItemId).filter(Boolean))];
  const nextSitting = plan.find((p) => !scheduledIds.includes(p.id));
  const scheduledCount = plan.filter((p) => scheduledIds.includes(p.id)).length;
  const weight = examPlanWeight(plan);
  const published = Boolean(series?.published);
  const calendar = useMemo(
    () => calendarFrom(school?.holidays, data?.timetable?.weekdays),
    [data?.timetable?.weekdays, school?.holidays]
  );
  const subjects = klass?.subjects ?? [];
  const sheetSitting =
    sheet === "edit"
      ? {
          name: series?.name || "Exam",
          kind: plan.find((p) => p.id === series?.planItemId)?.kind || "",
          maxMarks: plan.find((p) => p.id === series?.planItemId)?.maxMarks ?? series?.exams[0]?.maxMarks ?? 80,
        }
      : {
          name: nextSitting?.name || "Exam",
          kind: nextSitting?.kind || "",
          maxMarks: nextSitting?.maxMarks ?? 80,
        };

  async function run(op: string, body: Record<string, unknown>, ok: string) {
    setPending(op);
    try {
      await act(token, op, body);
      toast.show(ok);
      await reload();
      return true;
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setPending("");
    }
  }

  function openSchedule(mode: "create" | "edit") {
    if (!klass?.subjects?.length) {
      toast.show("Add subjects on The week first. Exam papers need a subject list.");
      return;
    }
    setSheet(mode);
  }

  async function savePapers(papers: SchedulePaper[]) {
    if (sheet === "edit" && series) {
      if (await run("updateExamSeriesPapers", { seriesId: series.id, papers }, "Dates saved.")) {
        setSheet("");
      }
      return;
    }
    if (!klass || !session) return;
    const ok = await run(
      "createExamSeries",
      {
        classId: klass.id,
        sessionId: session.id,
        planItemId: nextSitting?.id || "",
        name: nextSitting?.name || "Exam",
        papers,
      },
      `${nextSitting?.name || "Exam"} scheduled.`
    );
    if (ok) setSheet("");
  }

  const sittingHint = series
    ? `${series.exams.length} papers · ${studentCount} students · results ${prettyDay(series.exams[0]?.resultOn)}${
        published ? " · visible to parents" : " · hidden from parents"
      }`
    : nextSitting
      ? `${scheduledCount}/${plan.length || 0} sittings in this class`
      : plan.length
        ? "Every sitting in this year's plan is scheduled."
        : "Teachers enter marks for the papers they evaluate.";

  return (
    <View className={wide ? "min-h-0 flex-1" : undefined}>
      <View className="mb-3 shrink-0 flex-row items-center justify-between gap-3">
        <Text className="text-xl font-semibold text-ink-900">Exams</Text>
        <Pressable onPress={() => router.push("/school?tab=exams")}>
          <Text className="text-sm font-medium text-clay-600">Grades on School</Text>
        </Pressable>
      </View>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}

      <View className="mb-3 shrink-0 gap-2">
        <ChipScroller>
          {sessions.map((s) => {
            const on = s.id === session?.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => {
                  setSessionId(s.id);
                  setSeriesId("");
                }}
                className={pill(on)}
              >
                <Text className={pillText(on)}>
                  {s.label}
                  {s.current ? " · now" : ""}
                </Text>
              </Pressable>
            );
          })}
          {plan.map((row) => {
            const sitting = seriesForClass.find((s) => s.planItemId === row.id);
            const on = Boolean(sitting && sitting.id === series?.id);
            const scheduled = Boolean(sitting);
            return (
              <Pressable
                key={row.id}
                disabled={!sitting}
                onPress={() => {
                  if (!sitting) return;
                  setSeriesId(sitting.id);
                }}
                className={`rounded-md border px-2 py-1 ${
                  on ? "border-ink-900 bg-ink-900" : scheduled ? "border-ink-300 bg-ink-50" : "border-ink-200 bg-white"
                }`}
              >
                <Text className={`text-xs ${on ? "text-white" : "text-ink-800"}`}>
                  {row.name}
                  <Text className={on ? "text-white/70" : "text-ink-700"}> · {row.weight}%</Text>
                </Text>
              </Pressable>
            );
          })}
          {seriesForClass
            .filter((s) => !s.planItemId || !plan.some((p) => p.id === s.planItemId))
            .map((s) => {
              const on = s.id === series?.id;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => {
                    setSeriesId(s.id);
                  }}
                  className={`rounded-md border px-2 py-1 ${on ? "border-ink-900 bg-ink-900" : "border-ink-300 bg-ink-50"}`}
                >
                  <Text className={`text-xs ${on ? "text-white" : "text-ink-800"}`}>{s.name}</Text>
                </Pressable>
              );
            })}
          {weight !== 100 ? <Text className="text-[11px] text-ink-700">Weight {weight}</Text> : null}
        </ChipScroller>
        <ChipScroller>
          {classes.map((c) => (
            <Chip
              key={c.id}
              label={c.label}
              active={c.id === (klass?.id || classId)}
              onPress={() => {
                setClassId(c.id);
                setSeriesId("");
              }}
            />
          ))}
        </ChipScroller>
      </View>

      {!klass ? (
        <Card className="items-center justify-center p-6">
          <Text className="text-sm text-ink-700">Add a class on The week first.</Text>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <View className="flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
            <View className="min-w-0 flex-1">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-base font-semibold text-ink-900">
                  {series?.name ?? "No exam"} · {classLabel}
                </Text>
                {series ? (
                  <Badge tone={published ? "leaf" : "ink"}>{published ? "dates live" : "draft"}</Badge>
                ) : null}
              </View>
              <Text className="mt-0.5 text-xs text-ink-700">{sittingHint}</Text>
            </View>
            {series ? (
              <View className="flex-row flex-wrap gap-2">
                {data ? <QuickDocumentButton data={data} subjectType="EXAM_SERIES" subjectId={series.id} subjectLabel={`${series.name} · ${classLabel}`} allowedTypes={["ADMIT_CARD", "EXAM_DATE_SHEET", "SEATING_PLAN", "DESK_SLIP", "INVIGILATOR_DUTY", "SUBJECT_MARKSHEET", "REPORT_CARD", "CONSOLIDATED_REPORT", "GRADE_SHEET", "RESULT_SUMMARY", "PROGRESS_REPORT"]} label="Generate documents" batchSubjects={(data.people || []).filter((student) => student.classLabel === classLabel).map((student) => ({ subjectType: "STUDENT", subjectId: student.id, subjectLabel: student.name }))} extraData={{ exam: { name: series.name, classLabel, schedule: series.exams.map((exam) => ({ subject: exam.subject.name, date: prettyDay(exam.date), maxMarks: exam.maxMarks })) } }} /> : null}
                {canRun ? <Button variant="ghost" disabled={Boolean(pending)} onPress={() => openSchedule("edit")}>
                    Edit dates
                  </Button> : null}
                {canRun && nextSitting ? (
                    <Button disabled={Boolean(pending)} onPress={() => openSchedule("create")}>
                      {`Schedule ${nextSitting.name}`}
                    </Button>
                  ) : null}
              </View>
            ) : null}
          </View>

          {!series ? (
            <View className="items-center justify-center border-t border-ink-100 px-6 py-10">
              <Text className="text-center font-medium text-ink-900">No exam in this class yet</Text>
              <Text className="mt-1 max-w-sm text-center text-sm text-ink-700">
                {nextSitting
                  ? `Schedule ${nextSitting.name} from this year's plan.`
                  : "Create the paper timetable for this class."}
              </Text>
              {canRun ? (
                <View className="mt-3">
                  <Button disabled={Boolean(pending)} onPress={() => openSchedule("create")}>
                    {nextSitting ? `Schedule ${nextSitting.name}` : "Create exam"}
                  </Button>
                </View>
              ) : null}
            </View>
          ) : null}

          {series ? (
            <View className="border-t border-ink-100">
              <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
                <View className="min-w-full px-4 pb-2">
                  <View className="flex-row border-b border-ink-200 bg-ink-50">
                    {["Paper", "Teacher", "Paper due", "Exam date", "Checking due"].map((h) => (
                      <Text
                        key={h}
                        className="min-w-[9rem] basis-0 flex-1 px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-700"
                      >
                        {h}
                      </Text>
                    ))}
                  </View>
                  {[...series.exams]
                    .sort((a, b) => day(a.date).localeCompare(day(b.date)) || a.subject.name.localeCompare(b.subject.name))
                    .map((exam) => (
                    <View
                      key={exam.id}
                      className="flex-row border-b border-ink-100 bg-white"
                    >
                      <View className="min-w-[9rem] basis-0 flex-1 px-3 py-3">
                        <Text className="font-medium text-ink-900">{exam.subject.name}</Text>
                        <Text className="text-[11px] text-ink-700">/{exam.maxMarks}</Text>
                      </View>
                      <View className="min-w-[9rem] basis-0 flex-1 px-3 py-3">
                        <Text className="text-sm text-ink-800">{exam.teacherName || "—"}</Text>
                        <Text className="text-[11px] text-ink-700">
                          {exam.setterName && exam.setterName !== exam.teacherName
                            ? `Paper · ${exam.setterName}`
                            : "Sets and marks"}
                        </Text>
                      </View>
                      <Text className="min-w-[9rem] basis-0 flex-1 px-3 py-3 text-sm text-ink-800">
                        {prettyDay(exam.paperDueOn)}
                      </Text>
                      <Text className="min-w-[9rem] basis-0 flex-1 px-3 py-3 text-sm font-medium text-ink-900">
                        {prettyDay(exam.date)}
                      </Text>
                      <Text className="min-w-[9rem] basis-0 flex-1 px-3 py-3 text-sm text-ink-800">
                        {prettyDay(exam.copiesDueOn)}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          ) : null}

          {series && canRun ? (
            <View className="flex-row flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-3">
              <View className="min-w-0 flex-1 flex-row items-center gap-2">
                <Text className="shrink-0 text-xs text-ink-700">Copy to</Text>
                <View className="min-w-0 flex-1">
                  <ChipScroller>
                    {classes
                      .filter((c) => c.id !== klass?.id)
                      .map((c) => (
                        <Pressable
                          key={c.id}
                          onPress={() =>
                            setCopyIds((cur) => (cur.includes(c.id) ? cur.filter((id) => id !== c.id) : [...cur, c.id]))
                          }
                          className={pill(copyIds.includes(c.id))}
                        >
                          <Text className={pillText(copyIds.includes(c.id))}>{c.label}</Text>
                        </Pressable>
                      ))}
                  </ChipScroller>
                </View>
                <Button
                  disabled={!copyIds.length || Boolean(pending)}
                  onPress={async () => {
                    await run("copyExamSeries", { seriesId: series.id, classIds: copyIds }, "Copied to those classes.");
                    setCopyIds([]);
                  }}
                >
                  Copy
                </Button>
              </View>
              <View className="flex-row flex-wrap items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  disabled={Boolean(pending)}
                  onPress={() =>
                    run(
                      "publishExamSeries",
                      { seriesId: series.id, publish: published ? "0" : "1" },
                      published ? "Unpublished" : "Published to parents"
                    )
                  }
                >
                  {published ? "Hide from parents" : "Show dates to parents"}
                </Button>
                <Button
                  variant="danger"
                  disabled={Boolean(pending)}
                  onPress={() => run("deleteExamSeries", { seriesId: series.id }, "Series removed")}
                >
                  Remove series
                </Button>
              </View>
            </View>
          ) : null}
        </Card>
      )}

      <Modal
        open={Boolean(sheet)}
        title={sheet === "edit" ? `Edit ${sheetSitting.name}` : `Schedule ${sheetSitting.name}`}
        onClose={() => setSheet("")}
        wide
        centerTitle
        footer={
          sheet ? (
            <View className="flex-row items-center justify-end">
              <Button disabled={Boolean(pending)} onPress={() => scheduleRef.current?.save()}>
                {sheet === "edit" ? "Save dates" : `Schedule ${sheetSitting.name}`}
              </Button>
            </View>
          ) : null
        }
      >
        {sheet ? (
          <ExamScheduleSheet
            ref={scheduleRef}
            key={`${sheet}:${sheet === "edit" ? series?.id || "" : nextSitting?.id || "new"}:${klass?.id || ""}`}
            sittingName={sheetSitting.name}
            kind={sheetSitting.kind}
            maxMarks={sheetSitting.maxMarks}
            subjects={subjects}
            calendar={calendar}
            existing={sheet === "edit" ? series?.exams : undefined}
            deadlineSource={sheet === "create" ? seriesForClass.find((item) => item.exams.length)?.exams : undefined}
            pending={Boolean(pending)}
            hideConfirm
            onOpenRoutine={() => {
              setSheet("");
              router.push("/timetable");
            }}
            onSave={savePapers}
          />
        ) : null}
      </Modal>
    </View>
  );
}
