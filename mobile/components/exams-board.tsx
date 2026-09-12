import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Chip, Modal, Toast, useToast } from "./ui";
import {
  ExamScheduleSheet,
  type ExamScheduleSheetHandle,
  type SchedulePaper,
} from "./exam-schedule-sheet";
import { ExamMarksReview } from "./exam-marks-review";
import { TeacherMarksModal } from "./exam-teacher-work";
import { act } from "../lib/mutate";
import { calendarFrom } from "../lib/calendar";
import {
  adminBucket,
  adminCanReview,
  officePaperAction,
  officePaperDots,
  officeSittingProgress,
  officeSittingStatus,
  officeSubmitted,
} from "../lib/exam-workflow";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";
import { QuickDocumentButton } from "./document-studio";
import { Select } from "./form/select";
import { Popover } from "./form/popover";
import {
  ExamAction,
  ExamConfirm,
  ExamDrawer,
  ExamDrawerTabs,
  ExamEmptyFilter,
  ExamEnter,
  ExamFilterTabs,
  ExamPaperDots,
  ExamReturnNote,
  ExamSkeleton,
  ExamStatusPill,
  ExamTeacherMention,
  ExamTimeline,
} from "./exam-office-chrome";

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
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function prettyFull(value?: string | null) {
  const s = day(value);
  const [y, m, d] = s.split("-").map(Number);
  if (!y) return "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function sittingIcon(kind: string, name: string) {
  const key = `${kind} ${name}`.toLowerCase();
  if (key.includes("annual") || key.includes("final")) return "trophy-outline" as const;
  if (key.includes("term")) return "book-outline" as const;
  return "calculator-outline" as const;
}

function classGroup(c: { label: string; name?: string }) {
  if (c.name) return `Class ${c.name}`;
  const match = String(c.label).match(/^(\d+)/);
  return match ? `Class ${match[1]}` : "Classes";
}

function subjectIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("math")) return "calculator-outline" as const;
  if (n.includes("sci") || n.includes("chem") || n.includes("bio") || n.includes("phy")) return "flask-outline" as const;
  if (n.includes("comp") || n.includes("ict") || n.includes("info")) return "desktop-outline" as const;
  if (n.includes("art") || n.includes("draw")) return "color-palette-outline" as const;
  if (n.includes("sport") || n.includes("physical") || n === "pe") return "basketball-outline" as const;
  if (n.includes("hindi") || n.includes("sanskrit") || n.includes("lang")) return "language-outline" as const;
  return "book-outline" as const;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase() || "—";
}

export function ExamsBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ examId?: string; view?: string }>();
  const toast = useToast();
  const canRun = can(user, "exams.edit");
  const canPublish = can(user, "exams.publish");
  const classes = data?.classes ?? [];
  const school = data?.school;
  const pack = data?.examPack;
  const sessions = school?.sessions ?? [];
  const currentSession = sessions.find((s) => s.current) ?? sessions[0];
  const [sessionId, setSessionId] = useState(
    currentSession?.id || school?.sessionId || "",
  );
  const [classId, setClassId] = useState(classes[0]?.id || "");
  const [seriesId, setSeriesId] = useState("");
  const [pending, setPending] = useState("");
  const [copyIds, setCopyIds] = useState<string[]>([]);
  const [sheet, setSheet] = useState<"create" | "edit" | "">("");
  const [schedulePlanId, setSchedulePlanId] = useState("");
  const [bucket, setBucket] = useState<
    "all" | "scheduled" | "review" | "correction" | "published"
  >("all");
  const [desk, setDesk] = useState<"setup" | "review">("setup");
  const [reviewExamId, setReviewExamId] = useState("");
  const [detailExamId, setDetailExamId] = useState("");
  const [returnExamId, setReturnExamId] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [approveExamId, setApproveExamId] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [leavingIds, setLeavingIds] = useState<string[]>([]);
  const [approvedFlash, setApprovedFlash] = useState("");
  const [setupFocus, setSetupFocus] = useState<"gallery" | "detail">("gallery");
  const [focusPlanId, setFocusPlanId] = useState("");
  const [drawerTab, setDrawerTab] = useState<"overview" | "marks" | "activity">("overview");
  const [moreOpen, setMoreOpen] = useState(false);
  const scheduleRef = useRef<ExamScheduleSheetHandle>(null);
  const teachers = data?.peopleTeachers ?? [];
  useEffect(() => {
    if (!classId && classes[0]?.id) setClassId(classes[0].id);
  }, [classId, classes]);
  useEffect(() => {
    if (!sessionId && currentSession?.id) setSessionId(currentSession.id);
  }, [sessionId, currentSession?.id]);
  const session = sessions.find((s) => s.id === sessionId) ?? currentSession;
  const plan =
    (sessionId && pack?.planBySession?.[sessionId]) || school?.plan || [];
  const klass = classes.find((c) => c.id === classId) || classes[0];
  const classLabel = klass ? klass.label : "";
  const studentCount =
    klass?.students ??
    data?.exams?.find((e) => e.id === klass?.id)?.students ??
    0;
  const seriesForClass = (pack?.series ?? []).filter(
    (s) =>
      s.classId === (klass?.id || classId) &&
      s.sessionId === (session?.id || sessionId),
  );
  useEffect(() => {
    if (desk !== "setup") return;
    if (seriesId && seriesForClass.some((s) => s.id === seriesId)) return;
    const firstScheduled = plan.find((item) => seriesForClass.some((s) => s.planItemId === item.id));
    const sitting =
      seriesForClass.find((s) => s.planItemId === firstScheduled?.id) || seriesForClass[0];
    if (sitting?.id) setSeriesId(sitting.id);
  }, [desk, seriesId, seriesForClass, plan]);
  const series =
    seriesForClass.find((s) => s.id === seriesId) ||
    (desk === "review" ? seriesForClass[0] || null : null);
  const scheduledIds = [
    ...new Set(seriesForClass.map((s) => s.planItemId).filter(Boolean)),
  ];
  const nextSitting = plan.find((p) => !scheduledIds.includes(p.id));
  const published = Boolean(series?.published);
  const papers = [...(series?.exams ?? [])].sort(
    (a, b) =>
      day(a.date).localeCompare(day(b.date)) ||
      a.subject.name.localeCompare(b.subject.name),
  );
  const visiblePapers =
    bucket === "all"
      ? papers
      : papers.filter((exam) => adminBucket(exam.workflowStatus) === bucket);
  const students = (data?.examStudents ?? []).filter(
    (s) => s.classId === (klass?.id || classId),
  );
  const reviewExam = papers.find((exam) => exam.id === reviewExamId) || null;
  useEffect(() => {
    const examId = String(params.examId || "");
    if (!examId || !pack?.series?.length) return;
    const sitting = pack.series.find((s) =>
      s.exams.some((e) => e.id === examId),
    );
    const exam = sitting?.exams.find((e) => e.id === examId);
    if (!sitting || !exam) return;
    setSessionId(sitting.sessionId);
    setClassId(sitting.classId);
    setSeriesId(sitting.id);
    setDesk("setup");
    setSetupFocus("detail");
    setDetailExamId(exam.id);
    setDrawerTab("overview");
    if (
      params.view === "review" ||
      adminCanReview(exam.workflowStatus) ||
      exam.workflowStatus === "APPROVED"
    ) {
      setReviewExamId(exam.id);
    }
  }, [params.examId, params.view, pack?.series]);
  const reviewSheet = reviewExam
    ? {
        examId: reviewExam.id,
        title: reviewExam.title,
        subject: reviewExam.subject.name,
        maxMarks: reviewExam.maxMarks,
        classLabel,
        date: day(reviewExam.date),
        seriesName: series?.name,
        workflowStatus: reviewExam.workflowStatus,
        correctionNote: reviewExam.correctionNote,
        entered: reviewExam.entered,
        students: students.map((s) => {
          const row = (series?.marks ?? []).find(
            (m) => m.examId === reviewExam.id && m.studentId === s.id,
          );
          return {
            id: s.id,
            name: s.name,
            admissionNo: s.admissionNo || "",
            marks: row && !row.absent ? row.marks : null,
            absent: Boolean(row?.absent),
            correctionNote: row?.correctionNote || "",
            correctionRequested: Boolean(row?.correctionRequested),
          };
        }),
      }
    : null;
  const allApproved =
    papers.length > 0 &&
    papers.every(
      (exam) =>
        exam.workflowStatus === "APPROVED" ||
        exam.workflowStatus === "PUBLISHED",
    );
  const approvedPapers = papers.filter(
    (exam) => exam.workflowStatus === "APPROVED",
  );
  const calendar = useMemo(
    () => calendarFrom(school?.holidays, data?.timetable?.weekdays),
    [data?.timetable?.weekdays, school?.holidays],
  );
  const subjects = klass?.subjects ?? [];
  const creatingItem = plan.find((p) => p.id === schedulePlanId) || nextSitting;
  const sheetSitting =
    sheet === "edit"
      ? {
          name: series?.name || "Exam",
          kind: plan.find((p) => p.id === series?.planItemId)?.kind || "",
          maxMarks:
            plan.find((p) => p.id === series?.planItemId)?.maxMarks ??
            series?.exams[0]?.maxMarks ??
            80,
        }
      : {
          name: creatingItem?.name || "Exam",
          kind: creatingItem?.kind || "",
          maxMarks: creatingItem?.maxMarks ?? 80,
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
  async function publishToParents() {
    if (!series) return;
    if (!allApproved) {
      toast.show("Finish and approve every subject first, then show results to parents.");
      return;
    }
    await run(
      "publishExamResults",
      { seriesId: series.id },
      "Results are visible to parents now.",
    );
  }
  function openSchedule(mode: "create" | "edit", planItemId?: string) {
    if (!klass?.subjects?.length) {
      toast.show(
        "Add subjects on The week first. Exam papers need a subject list.",
      );
      return;
    }
    setSchedulePlanId(planItemId || nextSitting?.id || "");
    setSheet(mode);
  }
  async function savePapers(papers: SchedulePaper[]) {
    if (sheet === "edit" && series) {
      if (
        await run(
          "updateExamSeriesPapers",
          { seriesId: series.id, papers },
          "Dates saved.",
        )
      ) {
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
        planItemId: creatingItem?.id || "",
        name: creatingItem?.name || "Exam",
        papers,
      },
      `${creatingItem?.name || "Exam"} scheduled.`,
    );
    if (ok) {
      setSheet("");
      setFocusPlanId(creatingItem?.id || "");
      setSetupFocus("detail");
    }
  }
  useEffect(() => {
    if (!focusPlanId) return;
    const sitting = seriesForClass.find((s) => s.planItemId === focusPlanId);
    if (!sitting) return;
    setSeriesId(sitting.id);
    setFocusPlanId("");
  }, [focusPlanId, seriesForClass]);
  const sittingCounts = {
    all: papers.length,
    scheduled: papers.filter(
      (e) => adminBucket(e.workflowStatus) === "scheduled",
    ).length,
    correction: papers.filter(
      (e) => adminBucket(e.workflowStatus) === "correction",
    ).length,
    review: papers.filter((e) => adminBucket(e.workflowStatus) === "review")
      .length,
    published: papers.filter(
      (e) => adminBucket(e.workflowStatus) === "published",
    ).length,
  };
  const allPublished =
    papers.length > 0 &&
    papers.every((exam) => exam.workflowStatus === "PUBLISHED");
  const firstDate = papers[0]?.date;
  const lastDate = papers[papers.length - 1]?.date;
  const resultOn = papers.find((exam) => exam.resultOn)?.resultOn;
  const expectedSubjects = klass?.subjects?.length || papers.length || 0;
  const detailExam = papers.find((exam) => exam.id === detailExamId) || null;
  const approveExam = papers.find((exam) => exam.id === approveExamId) || null;
  const { width: screenWidth } = useWindowDimensions();
  const compact = screenWidth < 768;
  const showDetail = Boolean(series);
  const sittingStatus = officeSittingStatus(papers);
  function marksGranted(exam: (typeof papers)[number]) {
    return Boolean((exam.evaluators || []).length || exam.marksGrantedAt);
  }
  async function handlePaperAction(exam: (typeof papers)[number]) {
    const action = officePaperAction(exam.workflowStatus, marksGranted(exam));
    if (action === "Allow marks" && exam.teacherId && canRun) {
      await run(
        "grantExamMarks",
        { examId: exam.id, teacherId: exam.teacherId },
        "Subject teacher can enter marks",
      );
      return;
    }
    if (action === "Review" && canRun) {
      if (exam.workflowStatus === "SUBMITTED") {
        await run("reviewExamMarks", { examId: exam.id }, "Opened for review");
      }
      setReviewExamId(exam.id);
      return;
    }
    setDrawerTab("overview");
    setDetailExamId(exam.id);
  }
  const docsButton =
    series && data ? (
      <QuickDocumentButton
        data={data}
        subjectType="EXAM_SERIES"
        subjectId={series.id}
        subjectLabel={`${series.name} · ${classLabel}`}
        allowedTypes={
          allPublished
            ? ["REPORT_CARD"]
            : ["ADMIT_CARD", "EXAM_DATE_SHEET", "SEATING_PLAN", "DESK_SLIP", "INVIGILATOR_DUTY", "SUBJECT_MARKSHEET"]
        }
        label={allPublished ? "Report card" : "Generate documents"}
        resultIssue={allPublished}
        batchSubjects={(data.people || [])
          .filter((student) => student.classLabel === classLabel)
          .map((student) => ({
            subjectType: "STUDENT",
            subjectId: student.id,
            subjectLabel: student.name,
            data: {
              results: {
                marks: papers.map((exam) => {
                  const mark = (series.marks || []).find((row) => row.examId === exam.id && row.studentId === student.id);
                  return {
                    Subject: exam.subject.name,
                    Marks: mark?.absent ? "Absent" : mark?.marks ?? "—",
                    Max: exam.maxMarks,
                  };
                }),
              },
            },
          }))}
        extraData={{
          exam: {
            name: series.name,
            classLabel,
            schedule: series.exams.map((exam) => ({
              subject: exam.subject.name,
              date: prettyDay(exam.date),
              maxMarks: exam.maxMarks,
            })),
          },
        }}
      />
    ) : null;
  return (
    <View className="min-h-0 flex-1 flex-row">
      <ScrollView className="min-h-0 flex-1" contentContainerClassName="pb-8" nestedScrollEnabled>
      <ExamEnter>
      <View className="mb-5 flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
        <Text className="text-[28px] font-bold tracking-tight text-ink-900">
          Exams
        </Text>
        <Text className="mt-1 text-[13px] text-ink-700">
          {desk === "review"
            ? "Class marksheet: missing cells, per-student correction, approve, then publish scores. Dates stay on Exam setup."
            : "Manage exam schedules, track progress, review marks, and publish results."}
        </Text>
        </View>
      <View className="flex-row flex-wrap gap-2">
        <Chip
          className="anekio-chip anekio-desk-tab"
          label="Exam Setup"
          active={desk === "setup"}
          onPress={() => setDesk("setup")}
        />
        <Chip
          className="anekio-chip anekio-desk-tab"
          label="Marks Review"
          active={desk === "review"}
          onPress={() => setDesk("review")}
        />
      </View>
      </View>
      </ExamEnter>
      {toast.message ? (
        <Toast message={toast.message} onDone={toast.clear} />
      ) : null}
      {desk === "review" ? (
        <View className="gap-3">
          <View className="flex-row flex-wrap gap-2">
            <View className="min-w-[140px] flex-1">
              <Select
                value={session?.id || ""}
                options={sessions.map((s) => ({
                  id: s.id,
                  label: s.current ? `${s.label} · now` : s.label,
                }))}
                onChange={(id) => {
                  setSessionId(id);
                  setSeriesId("");
                }}
              />
            </View>
            <View className="min-w-[140px] flex-1">
              <Select
                value={series?.id || ""}
                options={seriesForClass.map((s) => ({ id: s.id, label: s.name }))}
                onChange={setSeriesId}
                placeholder="Sitting"
              />
            </View>
            <View className="min-w-[140px] flex-1">
              <Select
                value={klass?.id || ""}
                options={classes.map((c) => ({
                  id: c.id,
                  label: c.label,
                  group: classGroup(c),
                }))}
                onChange={(id) => {
                  setClassId(id);
                  setSeriesId("");
                  setSetupFocus("gallery");
                }}
                placeholder="Class"
              />
            </View>
          </View>
          {series ? (
            <ExamMarksReview
              token={token}
              sessionLabel={session?.label || ""}
              seriesName={series.name}
              classLabel={classLabel}
              exams={papers}
              marks={(series.marks || []).map((row) => ({
                examId: row.examId,
                studentId: row.studentId,
                marks: row.marks,
                absent: row.absent,
                correctionNote: row.correctionNote,
                correctionRequested: row.correctionRequested,
              }))}
              students={students}
              pending={pending}
              canEdit={canRun}
              canPublish={canPublish}
              approvedCount={approvedPapers.length}
              onPublish={() => void publishToParents()}
              onRan={async (ok) => {
                toast.show(ok);
                await reload();
              }}
            />
          ) : (
            <Card className="items-center px-6 py-10">
              <Text className="text-center font-medium text-ink-900">
                No sitting for this class yet
              </Text>
              <Text className="mt-1 text-center text-sm text-ink-700">
                Schedule it on Exam setup, then return here to review marks.
              </Text>
            </Card>
          )}
        </View>
      ) : !data ? (
        <ExamSkeleton />
      ) : (
        <View className="gap-4">
          <ExamEnter delay={1}>
            <View className="mb-3 flex-row flex-wrap items-center justify-between gap-3">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-[16px] font-semibold text-ink-900">
                  Exam Sessions
                </Text>
                <Text className="text-[13px] text-ink-700">({session?.label || ""})</Text>
                <View className="w-[148px]">
                  <Select
                    value={session?.id || ""}
                    options={sessions.map((s) => ({
                      id: s.id,
                      label: s.current ? `${s.label} · now` : s.label,
                    }))}
                    onChange={(id) => {
                      setSessionId(id);
                      setSeriesId("");
                      setSetupFocus("gallery");
                    }}
                  />
                </View>
                <View className="w-[148px]">
                  <Select
                    value={klass?.id || ""}
                    options={classes.map((c) => ({
                      id: c.id,
                      label: c.label,
                      group: classGroup(c),
                    }))}
                    onChange={(id) => {
                      setClassId(id);
                      setSeriesId("");
                      setSetupFocus("gallery");
                    }}
                    placeholder="Class"
                  />
                </View>
              </View>
              {canRun ? (
                <ExamAction
                  busy={pending === "createExamSeries"}
                  onPress={() => openSchedule("create")}
                >
                  + Schedule New Exam
                </ExamAction>
              ) : null}
            </View>
          </ExamEnter>
          <ExamEnter delay={2}>
            <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} className="grow-0">
            <View className="flex-row gap-3 pb-1">
              {plan.map((item) => {
                const sitting = seriesForClass.find((s) => s.planItemId === item.id);
                const exams = sitting?.exams || [];
                const progress = exams.length
                  ? officeSittingProgress(exams)
                  : { done: 0, total: expectedSubjects, pct: 0 };
                const status = sitting ? officeSittingStatus(exams) : "Not scheduled";
                const selected = series?.id === sitting?.id && Boolean(sitting);
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.name}, ${item.weight}% weightage, ${status}`}
                    onPress={() => {
                      if (!sitting) {
                        if (canRun) openSchedule("create", item.id);
                        return;
                      }
                      setSeriesId(sitting.id);
                      setSetupFocus("detail");
                    }}
                    className={`anekio-session-card ${sitting ? "" : "anekio-session-unscheduled"} h-[136px] w-[168px] rounded-xl border bg-white p-3.5 ${
                      selected ? "anekio-session-card-on border-clay-500 bg-[#EFF6FF]" : "border-ink-200"
                    }`}
                  >
                    <View className="flex-row items-start justify-between gap-1">
                      <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
                        <Ionicons name={sittingIcon(item.kind, item.name)} size={16} color="#2563EB" />
                        <Text className="text-[14px] font-semibold text-ink-900" numberOfLines={1}>{item.name}</Text>
                      </View>
                    </View>
                    <Text className="mt-1 text-[11px] text-ink-700">{item.weight}% weightage</Text>
                    <View className="mt-3 h-1 overflow-hidden rounded-full bg-ink-100">
                      <View
                        className="anekio-progress-fill h-full rounded-full bg-clay-500"
                        style={{ width: `${sitting ? progress.pct : 0}%` }}
                      />
                    </View>
                    <View className="mt-2 flex-row items-center justify-between">
                      <Text className="text-[11px] text-ink-800">
                        {sitting ? `${progress.done} / ${progress.total || expectedSubjects} subjects` : "Not scheduled"}
                      </Text>
                      <View
                        className={`anekio-session-go h-6 w-6 items-center justify-center rounded-full ${
                          selected ? "bg-clay-500" : "bg-ink-50"
                        }`}
                      >
                        <Ionicons name="arrow-forward" size={12} color={selected ? "#fff" : "#2563EB"} />
                      </View>
                    </View>
                    {!sitting ? (
                      <Text className="anekio-schedule-hint mt-1 text-[10px] font-medium text-clay-500">
                        Schedule {item.name}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            </ScrollView>
          </ExamEnter>
          {showDetail && series ? (
            <>
              <ExamEnter delay={3}>
                <View className="rounded-xl border border-ink-200 bg-white px-4 py-3.5">
                  <View className="flex-row flex-wrap items-start justify-between gap-3">
                    <View className="min-w-0 flex-1">
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Ionicons name={sittingIcon(plan.find((p) => p.id === series.planItemId)?.kind || "", series.name)} size={16} color="#2563EB" />
                        <Text className="text-[16px] font-semibold text-ink-900">{series.name}</Text>
                        <View className="h-6 flex-row items-center gap-1.5 rounded-full bg-emerald-50 px-2.5">
                          <View className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                          <Text className="text-[10px] font-semibold text-emerald-700">{sittingStatus}</Text>
                        </View>
                      </View>
                      <View className="mt-2 flex-row flex-wrap items-center gap-x-4 gap-y-1">
                        <Text className="text-[12px] text-ink-700">
                          {prettyDay(firstDate)} – {prettyFull(lastDate)}
                        </Text>
                        <Text className="text-[12px] text-ink-700">{papers.length} subjects</Text>
                        <Text className="text-[12px] text-ink-700">{studentCount} students</Text>
                      </View>
                      <Text className="mt-1 text-[11px] text-ink-500">
                        Result date: {prettyFull(resultOn)} (Manual publish)
                      </Text>
                    </View>
                    <View className="flex-row flex-wrap items-center gap-2">
                      {allPublished ? docsButton : null}
                      {canRun ? (
                        <Button variant="ghost" disabled={Boolean(pending)} onPress={() => openSchedule("edit")} className="anekio-btn h-9 px-3 py-1.5">
                          Edit dates
                        </Button>
                      ) : null}
                      <Popover
                        open={moreOpen}
                        onClose={() => setMoreOpen(false)}
                        align="end"
                        minWidth={220}
                        panel={
                          <View className="py-1">
            {allPublished ? null : docsButton}
                            {canRun && series ? (
                              <>
                                <Pressable
                                  className="px-3 py-2"
                                  onPress={() =>
                                    void run(
                                      "publishExamSeries",
                                      { seriesId: series.id, publish: published ? "0" : "1" },
                                      published ? "Dates hidden from parents" : "Dates visible to parents",
                                    )
                                  }
                                >
                                  <Text className="text-[13px] text-ink-900">
                                    {published ? "Hide dates from parents" : "Show dates to parents"}
                                  </Text>
                                </Pressable>
                                <View className="px-3 py-2">
                                  <Select
                                    value=""
                                    placeholder={copyIds.length ? `${copyIds.length} classes` : "Copy exam"}
                                    options={classes
                                      .filter((c) => c.id !== klass?.id)
                                      .map((c) => ({ id: c.id, label: c.label, group: classGroup(c) }))}
                                    onChange={(id) =>
                                      setCopyIds((cur) => (cur.includes(id) ? cur.filter((row) => row !== id) : [...cur, id]))
                                    }
                                  />
                                  {copyIds.length ? (
                                    <Button
                                      className="mt-2"
                                      onPress={async () => {
                                        await run("copyExamSeries", { seriesId: series.id, classIds: copyIds }, "Copied to those classes.");
                                        setCopyIds([]);
                                        setMoreOpen(false);
                                      }}
                                    >
                                      Copy
                                    </Button>
                                  ) : null}
                                </View>
                                <Pressable
                                  className="px-3 py-2"
                                  onPress={async () => {
                                    await run("deleteExamSeries", { seriesId: series.id }, "Series removed");
                                    setMoreOpen(false);
                                    setSeriesId("");
                                  }}
                                >
                                  <Text className="text-[13px] text-red-600">Remove exam</Text>
                                </Pressable>
                              </>
                            ) : null}
                          </View>
                        }
                      >
                        <Pressable
                          accessibilityLabel="More actions"
                          onPress={() => setMoreOpen((v) => !v)}
                          className="anekio-icon-btn h-9 w-9 items-center justify-center rounded-lg border border-ink-200"
                        >
                          <Ionicons name="ellipsis-vertical" size={16} color="#64748B" />
                        </Pressable>
                      </Popover>
                    </View>
                  </View>
                  <View className="mt-3 flex-row flex-wrap items-center gap-x-6 gap-y-2 border-t border-ink-200 pt-3">
                    <Text className="text-[11px] font-semibold text-ink-700">Family Access</Text>
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-[12px] text-ink-800">Timetable</Text>
                      <Pressable
                        accessibilityRole="switch"
                        accessibilityState={{ checked: published }}
                        disabled={Boolean(pending)}
                        onPress={() =>
                          void run(
                            "publishExamSeries",
                            { seriesId: series.id, publish: published ? "0" : "1" },
                            published ? "Dates hidden from parents" : "Dates visible to parents",
                          )
                        }
                        className={`anekio-switch h-5 w-9 justify-center rounded-full ${published ? "bg-[#10B981]" : "bg-ink-200"}`}
                      >
                        <View className={`anekio-switch-knob h-4 w-4 rounded-full bg-white ${published ? "ml-4" : "ml-0.5"}`} />
                      </Pressable>
                      <Text className="text-[11px] text-ink-700">
                        {published ? "Visible to parents" : "Hidden from parents"}
                      </Text>
                    </View>
                    {allPublished ? (
                      <Text className="text-[11px] text-ink-700">Results visible to parents</Text>
                    ) : null}
                  </View>
                </View>
              </ExamEnter>
              {allApproved && !allPublished && canPublish ? (
                <View className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                  <Text className="text-[13px] font-semibold text-ink-900">
                    ✓ {papers.length} / {papers.length} subjects ready
                  </Text>
                  <Text className="mt-0.5 text-[12px] text-ink-700">Marks are approved for every paper. Show this sitting to parents when you are ready.</Text>
                  <View className="mt-2 flex-row flex-wrap gap-2">
                    <Button variant="ghost" onPress={() => setDesk("review")}>
                      Preview results
                    </Button>
                    <ExamAction busy={pending === "publishExamResults"} onPress={() => setPublishOpen(true)}>
                      Show to parent
                    </ExamAction>
                  </View>
                </View>
              ) : null}
              <ExamEnter delay={4}>
                <ExamFilterTabs value={bucket} counts={sittingCounts} onChange={setBucket} />
              </ExamEnter>
              <ExamEnter delay={5}>
                <View key={bucket} className="anekio-list-swap overflow-hidden rounded-xl border border-ink-200 bg-white">
                  {compact ? null : (
                    <View className="flex-row items-center gap-3 border-b border-ink-200 px-4 py-2">
                      <Text className="min-w-0 flex-[1.4] text-[11px] font-medium uppercase tracking-wide text-ink-500">Subject</Text>
                      <Text className="w-[92px] text-[11px] font-medium uppercase tracking-wide text-ink-500">Exam Date</Text>
                      <Text className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wide text-ink-500">Teacher</Text>
                      <Text className="w-[72px] text-[11px] font-medium uppercase tracking-wide text-ink-500">Progress</Text>
                      <Text className="w-[148px] text-[11px] font-medium uppercase tracking-wide text-ink-500">Status</Text>
                      <Text className="w-[120px] text-right text-[11px] font-medium uppercase tracking-wide text-ink-500">Action</Text>
                    </View>
                  )}
                  {visiblePapers.length ? (
                    visiblePapers.map((exam) => {
                      const dots = officePaperDots({
                        paperAt: exam.paperAt,
                        conductedAt: exam.conductedAt,
                        workflowStatus: exam.workflowStatus,
                        entered: exam.entered,
                        studentCount,
                      });
                      const teacherName = teachers.find((t) => t.id === exam.teacherId)?.name || exam.teacherName || "—";
                      const extraTeachers = (exam.evaluators || []).filter((person) => person.id !== exam.teacherId);
                      const selectedRow = detailExamId === exam.id;
                      const action = officePaperAction(exam.workflowStatus, marksGranted(exam));
                      return (
                        <Pressable
                          key={exam.id}
                          onPress={() => {
                            setDrawerTab("overview");
                            setDetailExamId(exam.id);
                          }}
                          className={`anekio-paper-row h-[48px] flex-row items-center gap-3 border-b border-ink-200 px-4 ${
                            selectedRow ? "border-l-2 border-l-clay-500 bg-[#EFF6FF]" : "bg-white"
                          }`}
                        >
                          <View className="min-w-0 flex-[1.4] flex-row items-center gap-2">
                            <View className="h-7 w-7 items-center justify-center rounded-lg bg-[#EEF4FF]">
                              <Ionicons name={subjectIcon(exam.subject.name)} size={14} color="#2563EB" />
                            </View>
                            <Text className="text-[13px] font-semibold text-ink-900" numberOfLines={1}>{exam.subject.name}</Text>
                          </View>
                          {compact ? null : (
                            <>
                              <Text className="w-[92px] text-[12px] text-ink-700">{prettyDay(exam.date)}</Text>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Teachers for ${exam.subject.name}`}
                                onPress={(e) => {
                                  e.stopPropagation?.();
                                  setDrawerTab("overview");
                                  setDetailExamId(exam.id);
                                }}
                                className="min-w-0 flex-1 flex-row items-center gap-2"
                              >
                                <View className="h-7 w-7 items-center justify-center rounded-full bg-[#EEF4FF]">
                                  <Text className="text-[9px] font-semibold text-clay-500">{initials(teacherName)}</Text>
                                </View>
                                <Text className="min-w-0 flex-1 text-[12px] text-ink-800" numberOfLines={1}>
                                  {teacherName}
                                  {extraTeachers.length ? ` +${extraTeachers.length}` : ""}
                                </Text>
                              </Pressable>
                              <View className="w-[72px]">
                                <ExamPaperDots
                                  paper={dots.paper}
                                  exam={dots.exam}
                                  marks={dots.marks}
                                  review={dots.review}
                                  correction={exam.workflowStatus === "CORRECTION_REQUIRED"}
                                />
                              </View>
                            </>
                          )}
                          <View className={compact ? "" : "w-[148px]"}>
                            <ExamStatusPill status={exam.workflowStatus} />
                          </View>
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation?.();
                              void handlePaperAction(exam);
                            }}
                            className="anekio-row-action ml-auto h-8 w-[120px] flex-row items-center justify-end gap-1 rounded-lg border border-ink-200 bg-white px-2"
                          >
                            <Text className="anekio-row-action-label text-[12px] font-medium text-ink-800">{action}</Text>
                            <View className="anekio-paper-arrow">
                              <Ionicons name="arrow-forward" size={12} color="#2563EB" />
                            </View>
                          </Pressable>
                        </Pressable>
                      );
                    })
                  ) : (
                    <ExamEmptyFilter bucket={bucket} />
                  )}
                </View>
              </ExamEnter>
            </>
          ) : null}
        </View>

      )}
      </ScrollView>
      <Modal
        open={Boolean(sheet)}
        title={
          sheet === "edit"
            ? `Edit ${sheetSitting.name}`
            : `Schedule ${sheetSitting.name}`
        }
        onClose={() => setSheet("")}
        wide
        centerTitle
        footer={
          sheet ? (
            <View className="flex-row items-center justify-end">
              <Button
                disabled={Boolean(pending)}
                onPress={() => scheduleRef.current?.save()}
              >
                {sheet === "edit"
                  ? "Save dates"
                  : `Schedule ${sheetSitting.name}`}
              </Button>
            </View>
          ) : null
        }
      >
        {sheet ? (
          <ExamScheduleSheet
            ref={scheduleRef}
            key={`${sheet}:${sheet === "edit" ? series?.id || "" : creatingItem?.id || "new"}:${klass?.id || ""}`}
            sittingName={sheetSitting.name}
            kind={sheetSitting.kind}
            maxMarks={sheetSitting.maxMarks}
            subjects={subjects}
            calendar={calendar}
            existing={sheet === "edit" ? series?.exams : undefined}
            deadlineSource={
              sheet === "create"
                ? seriesForClass.find((item) => item.exams.length)?.exams
                : undefined
            }
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
      <ExamReturnNote
        open={Boolean(returnExamId)}
        note={returnNote}
        busy={pending === "returnExamMarks"}
        onChange={setReturnNote}
        onClose={() => {
          setReturnExamId("");
          setReturnNote("");
        }}
        onSubmit={async () => {
          const ok = await run(
            "returnExamMarks",
            { examId: returnExamId, note: returnNote.trim() },
            "Sent back to the evaluators",
          );
          if (ok) {
            setReturnExamId("");
            setReturnNote("");
            setBucket("correction");
          }
        }}
      />
      <ExamConfirm
        open={Boolean(approveExam)}
        title={`Approve ${approveExam?.subject.name || ""} marks?`}
        body={`${approveExam?.entered ?? 0}/${studentCount} students have marks entered.\n${Math.max(0, studentCount - (approveExam?.entered ?? 0))} missing marks.`}
        action="Approve marks"
        busy={pending === "approveExamMarks"}
        onClose={() => setApproveExamId("")}
        onConfirm={async () => {
          if (!approveExam) return;
          setLeavingIds((cur) => [...cur, approveExam.id]);
          setApprovedFlash(approveExam.id);
          await new Promise((resolve) => setTimeout(resolve, 180));
          const ok = await run(
            "approveExamMarks",
            { examId: approveExam.id },
            "Approved. Show to parent when every subject is ready.",
          );
          setApproveExamId("");
          setLeavingIds((cur) => cur.filter((id) => id !== approveExam.id));
          if (!ok) setApprovedFlash("");
        }}
      />
      <ExamConfirm
        open={publishOpen}
        title={`Show ${series?.name || "exam"} results to parents?`}
        body={`${approvedPapers.length} papers approved\n${studentCount} students\n\nParents and students will see marks for this sitting.`}
        action="Show to parent"
        busy={pending === "publishExamResults"}
        onClose={() => setPublishOpen(false)}
        onConfirm={async () => {
          await publishToParents();
          setPublishOpen(false);
        }}
      />
      <ExamDrawer
        docked={!compact}
        open={Boolean(detailExam)}
        onClose={() => {
          setDetailExamId("");
          setDrawerTab("overview");
        }}
      >
        {detailExam ? (
          <View className="gap-4">
            <View className="flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-[#EEF4FF]">
                <Ionicons name={subjectIcon(detailExam.subject.name)} size={20} color="#2563EB" />
              </View>
              <View className="min-w-0 flex-1">
              <Text className="text-[17px] font-bold text-ink-900">{detailExam.subject.name}</Text>
              <Text className="mt-0.5 text-[12px] text-ink-700">
                {series?.name} · Class {classLabel}
              </Text>
              </View>
            </View>
            <ExamDrawerTabs value={drawerTab} onChange={setDrawerTab} />
            {drawerTab === "overview" ? (
              <>
                <View className="flex-row flex-wrap gap-3">
                  <View className="min-w-[120px] flex-1 rounded-xl border border-ink-100 bg-ink-50 px-3 py-2.5">
                    <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Exam date</Text>
                    <Text className="mt-1 text-sm text-ink-900">{prettyFull(detailExam.date)}</Text>
                  </View>
                  <View className="min-w-[120px] flex-1 rounded-xl border border-ink-100 bg-ink-50 px-3 py-2.5">
                    <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Max marks</Text>
                    <Text className="mt-1 text-sm text-ink-900">{detailExam.maxMarks}</Text>
                  </View>
                </View>
                {(() => {
                  const granted = detailExam.evaluators || [];
                  const subjectTeacherId = klass?.subjects?.find(
                    (subject) => subject.name === detailExam.subject.name,
                  )?.teacherId;
                  const eligibleIds = new Set(
                    (detailExam.eligibleTeacherIds?.length
                      ? detailExam.eligibleTeacherIds
                      : [detailExam.teacherId, subjectTeacherId]
                    ).filter(Boolean) as string[],
                  );
                  const people = teachers
                    .filter((teacher) => eligibleIds.has(teacher.id))
                    .map((teacher) => ({ id: teacher.id, name: teacher.name }));
                  if (
                    detailExam.teacherId &&
                    !people.some((person) => person.id === detailExam.teacherId)
                  ) {
                    people.unshift({
                      id: detailExam.teacherId,
                      name: detailExam.teacherName || "Subject teacher",
                    });
                  }
                  return (
                    <ExamTeacherMention
                      subject={detailExam.subject.name}
                      people={people}
                      granted={granted}
                      primaryId={detailExam.teacherId}
                      canEdit={canRun && detailExam.workflowStatus !== "PUBLISHED"}
                      busy={pending === "grantExamMarks"}
                      onGrant={(teacherId) =>
                        void run(
                          "grantExamMarks",
                          { examId: detailExam.id, teacherId },
                          "Marks entry granted",
                        )
                      }
                      onRemove={(teacherId) =>
                        void run(
                          "grantExamMarks",
                          { examId: detailExam.id, teacherId, remove: true },
                          "Marks entry removed",
                        )
                      }
                    />
                  );
                })()}
                <View className="gap-2">
                  <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-700">Exam progress</Text>
                  <ExamTimeline
                    paper={Boolean(detailExam.paperAt)}
                    paperHint={detailExam.paperAt ? `Prepared on ${prettyDay(detailExam.paperAt)}` : undefined}
                    scheduled={Boolean(detailExam.date)}
                    scheduledHint={prettyFull(detailExam.date)}
                    conducted={Boolean(detailExam.conductedAt)}
                    conductedHint={detailExam.conductedAt ? prettyDay(detailExam.conductedAt) : undefined}
                    marksGranted={marksGranted(detailExam)}
                    marksGrantedHint={
                      marksGranted(detailExam)
                        ? `${(detailExam.evaluators || []).length || 1} teacher${(detailExam.evaluators || []).length === 1 ? "" : "s"} can enter marks`
                        : "Office must allow marks entry"
                    }
                    marksDone={(detailExam.entered ?? 0) >= studentCount && studentCount > 0}
                    marksHint={`${detailExam.entered ?? 0}/${studentCount} entered`}
                    submitted={officeSubmitted(detailExam.workflowStatus)}
                    correction={detailExam.workflowStatus === "CORRECTION_REQUIRED"}
                    correctionHint={
                      detailExam.workflowStatus === "CORRECTION_REQUIRED"
                        ? detailExam.correctionNote || "Sent back to the teacher"
                        : undefined
                    }
                    approved={detailExam.workflowStatus === "APPROVED" || detailExam.workflowStatus === "PUBLISHED"}
                  />
                </View>
                <View className="flex-row flex-wrap gap-2">
                  {canRun &&
                  (adminCanReview(detailExam.workflowStatus) ||
                    detailExam.workflowStatus === "APPROVED" ||
                    detailExam.workflowStatus === "PUBLISHED" ||
                    detailExam.workflowStatus === "MARKS_DRAFT" ||
                    detailExam.workflowStatus === "CORRECTION_REQUIRED") ? (
                    <ExamAction
                      variant="ghost"
                      busy={pending === "reviewExamMarks"}
                      onPress={async () => {
                        if (detailExam.workflowStatus === "SUBMITTED") {
                          await run("reviewExamMarks", { examId: detailExam.id }, "Opened for review");
                        }
                        setReviewExamId(detailExam.id);
                      }}
                    >
                      Review marks
                    </ExamAction>
                  ) : null}
                  {canRun && adminCanReview(detailExam.workflowStatus) ? (
                    <ExamAction
                      done={approvedFlash === detailExam.id}
                      onPress={() => setApproveExamId(detailExam.id)}
                    >
                      Approve marks
                    </ExamAction>
                  ) : null}
                  {canRun &&
                  (detailExam.workflowStatus === "SUBMITTED" ||
                    detailExam.workflowStatus === "UNDER_REVIEW" ||
                    detailExam.workflowStatus === "APPROVED") ? (
                    <Button
                      variant="ghost"
                      onPress={() => {
                        setReturnExamId(detailExam.id);
                        setReturnNote(detailExam.correctionNote || "");
                      }}
                    >
                      Return for correction
                    </Button>
                  ) : null}
                  {canRun ? (
                    <Button variant="ghost" className="w-full" onPress={() => openSchedule("edit")}>
                      Edit paper details
                    </Button>
                  ) : null}
                </View>
              </>
            ) : null}
            {drawerTab === "marks" ? (
              <View className="gap-2">
                <Text className="text-sm text-ink-700">
                  {detailExam.entered ?? 0}/{studentCount} entered
                  {Math.max(0, studentCount - (detailExam.entered ?? 0))
                    ? ` · ${Math.max(0, studentCount - (detailExam.entered ?? 0))} missing`
                    : ""}
                </Text>
                {students.map((student) => {
                  const row = (series?.marks ?? []).find(
                    (m) => m.examId === detailExam.id && m.studentId === student.id,
                  );
                  return (
                    <View key={student.id} className="flex-row items-center justify-between border-b border-ink-100 py-2">
                      <Text className="min-w-0 flex-1 text-sm text-ink-900">{student.name}</Text>
                      <Text className="text-sm text-ink-700">
                        {row?.absent ? "Absent" : row ? String(row.marks) : "—"}
                      </Text>
                    </View>
                  );
                })}
                <Button
                  onPress={async () => {
                    if (detailExam.workflowStatus === "SUBMITTED") {
                      await run("reviewExamMarks", { examId: detailExam.id }, "Opened for review");
                    }
                    setReviewExamId(detailExam.id);
                  }}
                >
                  Open marksheet
                </Button>
              </View>
            ) : null}
            {drawerTab === "activity" ? (
              <View className="gap-3">
                {[
                  detailExam.resultsPublishedAt
                    ? { at: detailExam.resultsPublishedAt, label: "Results published" }
                    : null,
                  detailExam.workflowStatus === "APPROVED" || detailExam.workflowStatus === "PUBLISHED"
                    ? { at: detailExam.date, label: "Marks approved" }
                    : null,
                  detailExam.conductedAt ? { at: detailExam.conductedAt, label: "Exam conducted" } : null,
                  detailExam.paperAt ? { at: detailExam.paperAt, label: "Question paper prepared" } : null,
                  { at: detailExam.date, label: "Exam scheduled" },
                ]
                  .filter((row): row is { at: string; label: string } => Boolean(row?.at))
                  .map((row, i) => (
                    <View key={`${row.label}-${i}`}>
                      <Text className="text-xs text-ink-500">{prettyFull(row.at)}</Text>
                      <Text className="text-sm text-ink-900">{row.label}</Text>
                    </View>
                  ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ExamDrawer>
      <TeacherMarksModal
        mode="admin"
        sheet={desk === "setup" ? reviewSheet : null}
        token={token}
        onClose={() => setReviewExamId("")}
        onSaved={async () => {
          toast.show("Saved.");
          await reload();
        }}
      />
    </View>
  );
}
