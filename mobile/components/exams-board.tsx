import { useEffect, useMemo, useRef, useState } from "react";
import { openSalaryProof as openPrivateFile } from "./salary-pay-sheet";
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Chip, Input, Modal, Toast, useToast } from "./ui";
import {
  ExamScheduleSheet,
  type ExamScheduleSheetHandle,
  type SchedulePaper,
} from "./exam-schedule-sheet";
import { ExamMarksReview } from "./exam-marks-review";
import { TeacherMarksModal } from "./exam-teacher-work";
import { act } from "../lib/mutate";
import { subjectLabel } from "../lib/subject-label";
import { calendarFrom } from "../lib/calendar";
import {
  adminBucket,
  adminCanPublish,
  adminCanReview,
  officePaperAction,
  officePaperDots,
  officeSittingProgress,
  officeSittingStatus,
  officeSubmitted,
  canSendResultsToParents,
  examSittingDocumentTypes,
  isHistoryImportPaper,
} from "../lib/exam-workflow";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";
import { QuickDocumentButton } from "./document-studio";
import { Select } from "./form/select";
import { Popover } from "./form/popover";
import { ExamClassesPage, ExamYearOverview, PastMarksModal, examClasses } from "./exam-year-overview";
import { ExamFormModal, type ExamFormValue } from "./exam-form";
import { ScheduleExamModal } from "./exam-schedule-all";
import { prettyTimeRange } from "./exam-time-field";
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
  ExamSimpleSteps,
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

/** Table header with an ⓘ that shows what the column means on hover (tap on touch). */
function HeaderTip({ title, tip }: { title: string; tip: string }) {
  const [show, setShow] = useState(false);
  return (
    <View className="relative z-30 min-w-0 flex-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`About ${title}`}
        onPress={() => setShow((v) => !v)}
        onHoverIn={() => setShow(true)}
        onHoverOut={() => setShow(false)}
        className="flex-row items-center gap-1 self-start"
      >
        <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{title}</Text>
        <Ionicons name={show ? "information-circle" : "information-circle-outline"} size={13} color={show ? "#2563EB" : "#94A3B8"} />
      </Pressable>
      {show ? (
        <View pointerEvents="none" className="absolute bottom-6 left-0 z-50 w-64 rounded-lg bg-ink-900 px-3 py-2" style={{ elevation: 6, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }}>
          <Text className="text-[12px] normal-case leading-[18px] text-white">{tip}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function ExamsBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const router = useRouter();
  const params = useLocalSearchParams<{ examId?: string; view?: string; exam?: string; cls?: string }>();
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
  const [holdUnpaidMonths, setHoldUnpaidMonths] = useState("");
  const [leavingIds, setLeavingIds] = useState<string[]>([]);
  const [approvedFlash, setApprovedFlash] = useState("");
  const [setupFocus, setSetupFocus] = useState<"gallery" | "detail">("gallery");
  const [focusPlanId, setFocusPlanId] = useState("");
  const [drawerTab, setDrawerTab] = useState<"overview" | "marks" | "activity">("overview");
  const [historyMode, setHistoryMode] = useState(false);
  const [pastPlanId, setPastPlanId] = useState("");
  const [allPlanId, setAllPlanId] = useState("");
  const [allClassIds, setAllClassIds] = useState<string[] | null>(null);
  const [examForm, setExamForm] = useState<{ mode: "create" | "edit" | "duplicate"; initial: ExamFormValue | null } | null>(null);
  const [deleteExamId, setDeleteExamId] = useState("");
  // After "New exam → Next", open scheduling once the new exam has loaded.
  const [scheduleAfter, setScheduleAfter] = useState<{ id: string; classIds: string[] } | null>(null);
  // Exams → one exam (all classes) → one class's papers.
  const [examPlanId, setExamPlanId] = useState("");
  const [pageClassId, setPageClassId] = useState("");
  const scheduleRef = useRef<ExamScheduleSheetHandle>(null);
  const teachers = data?.peopleTeachers ?? [];
  useEffect(() => {
    if (!classId && classes[0]?.id) setClassId(classes[0].id);
  }, [classId, classes]);
  useEffect(() => {
    if (!sessionId && currentSession?.id) setSessionId(currentSession.id);
  }, [sessionId, currentSession?.id]);
  useEffect(() => {
    if (!publishOpen) return;
    setHoldUnpaidMonths(String(pack?.policy?.reportCardUnpaidMonths ?? school?.policy?.reportCardUnpaidMonths ?? ""));
  }, [publishOpen, pack?.policy?.reportCardUnpaidMonths, school?.policy?.reportCardUnpaidMonths]);
  const session = sessions.find((s) => s.id === sessionId) ?? currentSession;
  const plan = (session?.id && pack?.planBySession?.[session.id]) || (sessionId && pack?.planBySession?.[sessionId]) || [];
  useEffect(() => {
    if (!scheduleAfter) return;
    if (!plan.some((p) => p.id === scheduleAfter.id)) return;
    setAllClassIds(scheduleAfter.classIds);
    setAllPlanId(scheduleAfter.id);
    setScheduleAfter(null);
  }, [plan, scheduleAfter]);
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
    setExamPlanId(sitting.planItemId);
    setPageClassId(sitting.classId);
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

  // Keep the open exam / class in the address, so a refresh lands on the same page.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !pack?.series) return;
    restored.current = true;
    const planId = String(params.exam || "");
    const cls = String(params.cls || "");
    if (!planId || params.examId) return;
    const sitting = cls ? pack.series.find((x) => x.planItemId === planId && x.classId === cls) : undefined;
    const anyOfPlan = sitting || pack.series.find((x) => x.planItemId === planId);
    if (anyOfPlan) setSessionId(anyOfPlan.sessionId);
    setExamPlanId(planId);
    if (sitting) {
      setClassId(sitting.classId);
      setSeriesId(sitting.id);
      setPageClassId(sitting.classId);
      setDesk(params.view === "marks" ? "review" : "setup");
      setSetupFocus("detail");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack?.series]);
  useEffect(() => {
    if (!restored.current) return;
    const cls = (examPlanId && pageClassId) || undefined;
    const next = { exam: examPlanId || undefined, cls, view: cls && desk === "review" ? "marks" : undefined };
    if ((params.exam || undefined) === next.exam && (params.cls || undefined) === next.cls && (params.view || undefined) === next.view) return;
    router.setParams(next as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examPlanId, pageClassId, desk]);
  const reviewSheet = reviewExam
    ? {
        examId: reviewExam.id,
        title: reviewExam.title,
        subject: subjectLabel(reviewExam.subject),
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
            rollNumber: s.rollNumber ?? null,
            admissionNo: s.admissionNo || "",
            marks: row && !row.absent ? row.marks : null,
            absent: Boolean(row?.absent),
            correctionNote: row?.correctionNote || "",
            correctionRequested: Boolean(row?.correctionRequested),
          };
        }),
      }
    : null;
  // "Approved" now means "teacher sent marks": admin can publish straight away.
  const allApproved =
    papers.length > 0 &&
    papers.every(
      (exam) => exam.workflowStatus === "PUBLISHED" || adminCanPublish(exam.workflowStatus),
    );
  const approvedPapers = papers.filter((exam) => adminCanPublish(exam.workflowStatus));
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
  /** The only way results go out: every paper of this exam at once, to parents, after all marks are in. */
  async function publishToParents(_examId?: string, holdIfUnpaidMonths?: number) {
    if (!series) return;
    if (!allApproved) {
      const waiting = papers.filter((exam) => exam.workflowStatus !== "PUBLISHED" && !adminCanPublish(exam.workflowStatus)).length;
      toast.show(`Results go out together. ${waiting} ${waiting === 1 ? "paper still needs" : "papers still need"} marks.`);
      return;
    }
    const feeHold = holdIfUnpaidMonths != null ? { holdIfUnpaidMonths } : {};
    const holdNote =
      holdIfUnpaidMonths && holdIfUnpaidMonths > 0
        ? ` Families with ${holdIfUnpaidMonths} or more unpaid fee months will see results after they pay.`
        : " Families can see the report card now.";
    await run("publishExamResults", { seriesId: series.id, sendToParents: true, ...feeHold }, `Results published to parents.${holdNote}`);
  }
  const [editDatesOpen, setEditDatesOpen] = useState(false);
  const [teacherPickFor, setTeacherPickFor] = useState("");
  const [phoneMenu, setPhoneMenu] = useState(false);
  function openSchedule(mode: "create" | "edit", planItemId?: string) {
    if (!klass?.subjects?.length) {
      toast.show("Add subjects for this class first. Exam papers need a subject list.");
      return;
    }
    setSchedulePlanId(planItemId || nextSitting?.id || "");
    setHistoryMode(false);
    setSheet(mode);
  }
  async function savePapers(papers: SchedulePaper[], meta?: { history?: boolean }) {
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
        history: Boolean(meta?.history),
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
  const resultsPublished = papers.some(
    (exam) => exam.workflowStatus === "PUBLISHED",
  );
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
  async function openMarksEditor(exam: (typeof papers)[number]) {
    if (exam.workflowStatus === "SUBMITTED") {
      await run("reviewExamMarks", { examId: exam.id }, "Opened for review");
    }
    setReviewExamId(exam.id);
  }
  /** A paper with any marks opens its marks straight away; others open the paper panel. */
  function paperHasMarks(exam: (typeof papers)[number]) {
    return (exam.entered ?? 0) > 0 || ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED", "APPROVED", "PUBLISHED"].includes(exam.workflowStatus || "");
  }
  async function handlePaperAction(exam: (typeof papers)[number]) {
    if (isHistoryImportPaper(exam)) {
      await openMarksEditor(exam);
      return;
    }
    if (paperHasMarks(exam)) {
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
        allowedTypes={examSittingDocumentTypes(allPublished)}
        label={allPublished ? "Issue results" : "Issue admit cards"}
        resultIssue={allPublished}
        buttonClassName="anekio-btn h-9 px-3 py-1.5"
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
                    Subject: subjectLabel(exam.subject),
                    Marks: mark?.absent ? "Absent" : mark?.marks ?? "—",
                    Max: exam.maxMarks,
                  };
                }),
              },
            },
          }))}
        extraData={{
          seriesId: series.id,
          exam: {
            name: series.name,
            seriesId: series.id,
            classLabel,
            schedule: series.exams.map((exam) => ({
              subject: subjectLabel(exam.subject),
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
      {/* Inside one exam the exam's own title leads; the page title would just repeat "Exams". */}
      {/* Inside an exam the year picker isn't needed (the exam belongs to one year), so no empty header row. */}
      {examPlanId ? null : (
      <ExamEnter>
      <View className={compact ? "mb-4 flex-row flex-wrap items-center justify-between gap-3" : "mb-5 flex-row flex-wrap items-center justify-between gap-3"}>
        <View className="min-w-0 flex-1">
        {examPlanId ? null : (
        <Text className={`${compact ? "text-[24px]" : "text-[28px]"} font-bold tracking-tight text-ink-900`}>
          Exams
        </Text>
        )}
        </View>
        <View className="flex-row items-center gap-2">
      {sessions.length <= 1 ? (
        session?.label ? (
          <View className="h-10 flex-row items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3">
            <Ionicons name="calendar-outline" size={15} color="#64748B" />
            <Text className="text-[14px] font-medium text-ink-800">{session.label}</Text>
          </View>
        ) : null
      ) : (
      <View className={compact ? "w-[150px]" : "w-[170px]"}>
        <Select
          value={session?.id || ""}
          options={sessions.map((s) => ({
            id: s.id,
            label: s.current ? `${s.label} · now` : s.label,
          }))}
          onChange={(id) => {
            setSessionId(id);
            setSeriesId("");
            setExamPlanId("");
            setPageClassId("");
          }}
        />
      </View>
      )}
      {!examPlanId && canRun ? (
        <Button className="h-10 justify-center px-4" onPress={() => setExamForm({ mode: "create", initial: null })}>
          + New exam
        </Button>
      ) : null}
        </View>
      </View>
      </ExamEnter>
      )}
      {toast.message ? (
        <Toast message={toast.message} onDone={toast.clear} />
      ) : null}
      {desk === "review" ? (
        <View className="gap-4">
          <View className="flex-row flex-wrap items-center gap-1">
            <Pressable onPress={() => { setDesk("setup"); setExamPlanId(""); setPageClassId(""); }}>
              <Text className="text-[13px] font-medium text-clay-600">Exams</Text>
            </Pressable>
            {series ? (
              <>
                <Ionicons name="chevron-forward" size={12} color="#94A3B8" />
                <Pressable onPress={() => { setDesk("setup"); setPageClassId(""); }}>
                  <Text className="text-[13px] font-medium text-clay-600">{series.name}</Text>
                </Pressable>
                <Ionicons name="chevron-forward" size={12} color="#94A3B8" />
                <Pressable onPress={() => setDesk("setup")}>
                  <Text className="text-[13px] font-medium text-clay-600">{classLabel}</Text>
                </Pressable>
              </>
            ) : null}
            <Ionicons name="chevron-forward" size={12} color="#94A3B8" />
            <Text className="text-[13px] font-medium text-ink-700">Marks</Text>
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
              onPublish={() => setPublishOpen(true)}
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
          {!examPlanId ? (
            <ExamEnter delay={1}>
              <ExamYearOverview
                plan={plan}
                series={(pack?.series ?? []).filter((s) => s.sessionId === (session?.id || sessionId))}
                classes={classes}
                sessionStart={session?.startsOn}
                canRun={canRun}
                onSchedule={(planItemId) => {
                  setAllClassIds(null);
                  setAllPlanId(planItemId);
                }}
                onAddOldMarks={setPastPlanId}
                onCreate={() => setExamForm({ mode: "create", initial: null })}
                onAddCbse={() => void run("addCbseExams", { sessionId: session?.id || sessionId }, "Standard CBSE exams added. Rename or remove any you don't use.")}
                onOpen={(planItemId) => {
                  setExamPlanId(planItemId);
                  setPageClassId("");
                }}
              />
            </ExamEnter>
          ) : !pageClassId ? (
            (() => {
              const item = plan.find((p) => p.id === examPlanId);
              if (!item) return null;
              return (
                <ExamClassesPage
                  item={item}
                  classes={examClasses(item, classes)}
                  onEdit={() =>
                    setExamForm({
                      mode: "edit",
                      initial: { id: item.id, name: item.name, sessionId: session?.id || sessionId, classIds: examClasses(item, classes).map((c) => c.id), maxMarks: item.maxMarks, weight: item.weight },
                    })
                  }
                  onDuplicate={() =>
                    setExamForm({
                      mode: "duplicate",
                      initial: { name: item.name, sessionId: session?.id || sessionId, classIds: examClasses(item, classes).map((c) => c.id), maxMarks: item.maxMarks, weight: item.weight },
                    })
                  }
                  onDelete={() => setDeleteExamId(item.id)}
                  series={(pack?.series ?? []).filter((s) => s.sessionId === (session?.id || sessionId))}
                  sessionStart={session?.startsOn}
                  sessionLabel={session?.label || ""}
                  canRun={canRun}
                  canPublish={canPublish}
                  busySeriesId={pending === "publishExamResults" ? series?.id : undefined}
                  onBack={() => setExamPlanId("")}
                  onOpenClass={(id, sid) => {
                    setClassId(id);
                    setSeriesId(sid);
                    setPageClassId(id);
                    setSetupFocus("detail");
                    setBucket("all");
                  }}
                  onSchedule={(ids) => {
                    setAllClassIds(ids);
                    setAllPlanId(item.id);
                  }}
                  onAddOldMarks={() => setPastPlanId(item.id)}
                  onPublishAll={(sid) => {
                    setSeriesId(sid);
                    void run("publishExamResults", { seriesId: sid }, "All papers published. Send results to parents from the class page when ready.");
                  }}
                />
              );
            })()
          ) : null}
          {examPlanId && pageClassId && showDetail && series ? (
            <>
              <View className="flex-row flex-wrap items-center gap-1">
                <Pressable onPress={() => { setExamPlanId(""); setPageClassId(""); }} className="flex-row items-center">
                  <Text className="text-[13px] font-medium text-clay-600">Exams</Text>
                </Pressable>
                <Ionicons name="chevron-forward" size={12} color="#94A3B8" />
                <Pressable onPress={() => setPageClassId("")}>
                  <Text className="text-[13px] font-medium text-clay-600">{series.name}</Text>
                </Pressable>
                <Ionicons name="chevron-forward" size={12} color="#94A3B8" />
                <Text className="text-[13px] font-medium text-ink-700">{classLabel}</Text>
              </View>
              <ExamEnter delay={3}>
                <View>
                  <View className={compact ? "flex-row flex-wrap items-start gap-2" : "flex-row flex-wrap items-start justify-between gap-3"}>
                    <View className="min-w-0 flex-1">
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Text className={`${compact ? "text-[22px]" : "text-[26px]"} font-bold tracking-tight text-ink-900`}>
                          {series.name} · {classLabel}
                        </Text>
                        <View className="h-6 flex-row items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-2.5">
                          <View className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                          <Text className="text-[12px] font-semibold text-emerald-700">{sittingStatus}</Text>
                        </View>
                      </View>
                    </View>
                    {compact ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="More actions"
                        onPress={() => setPhoneMenu((v) => !v)}
                        className={`h-9 w-9 items-center justify-center rounded-lg border ${phoneMenu ? "border-clay-300 bg-clay-50" : "border-ink-200 bg-white"}`}
                      >
                        <Ionicons name="ellipsis-horizontal" size={18} color="#334155" />
                      </Pressable>
                    ) : null}
                    <View className={compact ? (phoneMenu ? "w-full flex-row flex-wrap items-center gap-2 rounded-xl border border-ink-200 bg-white p-2" : "hidden") : "flex-row flex-wrap items-center gap-2"}>
                      {canRun ? (
                        <Pressable
                          accessibilityRole="switch"
                          accessibilityLabel="Exam dates visible to parents"
                          accessibilityState={{ checked: published }}
                          disabled={Boolean(pending)}
                          onPress={() =>
                            void run(
                              "publishExamSeries",
                              { seriesId: series.id, publish: published ? "0" : "1" },
                              published ? "Dates hidden from parents" : "Dates visible to parents",
                            )
                          }
                          className="h-9 flex-row items-center gap-2 rounded-lg px-2 active:bg-ink-50"
                        >
                          <View className={`h-[18px] w-8 justify-center rounded-full px-0.5 ${published ? "items-end bg-emerald-500" : "items-start bg-ink-200"}`}>
                            <View className="h-3.5 w-3.5 rounded-full bg-white" />
                          </View>
                          <Text className="text-[13px] font-medium text-ink-700">Dates visible to parents</Text>
                        </Pressable>
                      ) : null}
                      {canRun ? (
                        <Button variant="ghost" disabled={Boolean(pending)} onPress={() => setEditDatesOpen(true)} className="anekio-btn h-9 px-3 py-1.5">
                          Edit dates
                        </Button>
                      ) : null}
                      {allPublished ? null : docsButton}
                    </View>
                  </View>
                  <View className={`flex-row ${compact ? "mt-3" : "mt-4 flex-wrap items-stretch gap-y-3"}`}>
                    {[
                      { label: compact ? "Exams" : "Exam days", value: firstDate ? `${prettyDay(firstDate)} – ${prettyDay(lastDate)}` : "—" },
                      { label: compact ? "Papers" : "Subjects", value: String(papers.length) },
                      { label: "Students", value: String(studentCount) },
                      { label: compact ? "Results" : "Results on", value: resultOn ? prettyDay(resultOn) : "Not set" },
                    ].map((fact, i) => (
                      <View key={fact.label} className={compact ? `${i === 0 ? "flex-[1.6]" : "flex-1"} ${i ? "border-l border-ink-200 pl-2.5" : ""}` : `pr-6 ${i ? "border-l border-ink-200 pl-6" : ""}`}>
                        <Text className={`${compact ? "text-[10px]" : "text-[11px]"} font-medium uppercase tracking-wide text-ink-500`}>{fact.label}</Text>
                        <Text className={`mt-0.5 ${compact ? "text-[13px]" : "text-[15px]"} font-semibold tabular-nums text-ink-900`} numberOfLines={1}>{fact.value}</Text>
                      </View>
                    ))}
                    {canRun ? null : (
                      <View className={compact ? "w-1/2" : "border-l border-ink-200 pl-6"}>
                        <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500">Parents see dates</Text>
                        <Text className="mt-0.5 text-[15px] font-semibold text-ink-900">{published ? "Yes" : "No"}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </ExamEnter>
              {canRun && papers.some((exam) => !exam.paperAt && exam.paperHandedAt) ? (
                <View className="flex-row flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
                  <Ionicons name="document-text-outline" size={16} color="#B45309" />
                  <Text className="text-[13px] font-semibold text-amber-900">
                    {(() => {
                      const n = papers.filter((exam) => !exam.paperAt && exam.paperHandedAt).length;
                      return `${n} ${n === 1 ? "paper" : "papers"} handed over · confirm you received ${n === 1 ? "it" : "them"}`;
                    })()}
                  </Text>
                  <View className="flex-row flex-wrap gap-1.5">
                    {papers
                      .filter((exam) => !exam.paperAt && exam.paperHandedAt)
                      .map((exam) => (
                        <Pressable
                          key={exam.id}
                          accessibilityRole="button"
                          onPress={() => {
                            setDrawerTab("overview");
                            setDetailExamId(exam.id);
                          }}
                          className="h-7 flex-row items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5"
                        >
                          <Text className="text-[12px] font-medium text-amber-900">{exam.subject.name}</Text>
                          <Ionicons name="chevron-forward" size={12} color="#B45309" />
                        </Pressable>
                      ))}
                  </View>
                </View>
              ) : null}
              {papers.length ? (
                <ResultsBar
                  total={papers.length}
                  ready={papers.filter((exam) => exam.workflowStatus === "PUBLISHED" || adminCanPublish(exam.workflowStatus)).length}
                  allPublished={allPublished}
                  canPublish={canPublish}
                  busy={pending === "publishExamResults"}
                  onPreview={() => setDesk("review")}
                  onPublish={() => setPublishOpen(true)}
                  issueButton={allPublished ? docsButton : null}
                />
              ) : null}
              <ExamEnter delay={4}>
                <ExamFilterTabs value={bucket} counts={sittingCounts} onChange={setBucket} />
              </ExamEnter>
              <ExamEnter delay={5}>
                <View key={bucket} className={`anekio-list-swap rounded-xl border border-ink-200 bg-white ${compact ? "overflow-hidden" : ""}`}>
                  {compact ? null : (
                    <View className="relative flex-row items-center gap-3 border-b border-ink-200 px-4 py-2" style={{ zIndex: 40 }}>
                      <Text className="min-w-0 flex-[1.4] text-[11px] font-medium uppercase tracking-wide text-ink-500">Subject</Text>
                      <Text className="w-[92px] text-[11px] font-medium uppercase tracking-wide text-ink-500">Exam Date</Text>
                      <HeaderTip title="Paper setter" tip="Makes the question paper and gives it to the exam office before the paper due date. ✓ = office has received it." />
                      <HeaderTip title="Copy checker" tip="Checks the answer sheets after the exam and enters marks in Anekio. ✓ = all marks entered. You can hand it to another teacher until marks entry starts." />
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
                      const historyImportPaper = isHistoryImportPaper(exam);
                      const action = historyImportPaper ? "Edit marks" : paperHasMarks(exam) ? "View marks" : officePaperAction(exam.workflowStatus, marksGranted(exam));
                      if (compact) {
                        return (
                          <Pressable
                            key={exam.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Open ${exam.subject.name}`}
                            onPress={() => void handlePaperAction(exam)}
                            className="flex-row items-center gap-3 border-b border-ink-100 px-4 py-3 active:bg-ink-50"
                          >
                            <View className="h-8 w-8 items-center justify-center rounded-lg bg-[#EEF4FF]">
                              <Ionicons name={subjectIcon(exam.subject.name)} size={15} color="#2563EB" />
                            </View>
                            <View className="min-w-0 flex-1">
                              <Text className="text-[15px] font-semibold text-ink-900" numberOfLines={1}>{exam.subject.name}</Text>
                              <Text className="text-[12px] text-ink-500" numberOfLines={1}>
                                {(() => {
                                  const makerId = exam.setterId || exam.teacherId || "";
                                  const maker = teachers.find((t) => t.id === makerId)?.name || exam.setterName || teacherName;
                                  const who = makerId && makerId !== exam.teacherId ? `Setter: ${maker} · Checker: ${teacherName}` : teacherName !== "—" ? teacherName : "";
                                  return [prettyDay(exam.date), who].filter(Boolean).join(" · ");
                                })()}
                              </Text>
                            </View>
                            <ExamStatusPill status={exam.workflowStatus} />
                            <Ionicons name="chevron-forward" size={15} color="#94A3B8" />
                          </Pressable>
                        );
                      }
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
                            <Text className="text-[13px] font-semibold text-ink-900" numberOfLines={1}>{subjectLabel(exam.subject)}</Text>
                          </View>
                          {compact ? null : (
                            <>
                              <View className="w-[92px]">
                                <Text className="text-[12px] text-ink-700">{prettyDay(exam.date)}</Text>
                                {exam.startTime && exam.endTime ? (
                                  <Text className="text-[11px] text-ink-500" numberOfLines={1}>{prettyTimeRange(exam.startTime, exam.endTime)}</Text>
                                ) : null}
                              </View>
                              {(() => {
                                const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
                                const makerId = exam.setterId || exam.teacherId || "";
                                const makerName = teachers.find((t) => t.id === makerId)?.name || exam.setterName || teacherName;
                                // Late only matters before the exam; afterwards the paper clearly reached the hall.
                                const paperLate = !exam.paperAt && String(exam.date).slice(0, 10) >= today && Boolean(exam.paperDueOn) && String(exam.paperDueOn).slice(0, 10) < today;
                                const marksIn = ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED", "APPROVED", "PUBLISHED"].includes(exam.workflowStatus || "");
                                const checkLate = !marksIn && Boolean(exam.copiesDueOn) && String(exam.copiesDueOn).slice(0, 10) < today;
                                const cell = (role: "paper" | "checking") => {
                                  const isPaper = role === "paper";
                                  const name = isPaper ? makerName : teacherName;
                                  const currentId = isPaper ? makerId : exam.teacherId || "";
                                  const done = isPaper ? Boolean(exam.paperAt) : marksIn;
                                  const late = isPaper ? paperLate : checkLate;
                                  const locked = !canRun || historyImportPaper || (isPaper ? Boolean(exam.paperAt) : marksIn || (exam.entered ?? 0) > 0 || exam.workflowStatus === "IN_PROGRESS" || exam.workflowStatus === "MARKS_DRAFT");
                                  const key = `${exam.id}:${role}`;
                                  return (
                                    <View className="min-w-0 flex-1">
                                      <Popover
                                        open={teacherPickFor === key}
                                        onClose={() => setTeacherPickFor("")}
                                        align="start"
                                        minWidth={240}
                                        maxHeight={300}
                                        panel={
                                          <View className="py-1">
                                            <Text className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-500">
                                              {isPaper ? "Paper setter" : "Copy checker"}
                                            </Text>
                                            {teachers.map((t) => {
                                              const current = t.id === currentId;
                                              return (
                                                <Pressable
                                                  key={t.id}
                                                  accessibilityRole="button"
                                                  onPress={() => {
                                                    setTeacherPickFor("");
                                                    if (!current)
                                                      void run(
                                                        "reassignExamRole",
                                                        { examId: exam.id, role, teacherId: t.id },
                                                        `${exam.subject.name}: ${isPaper ? "paper setter" : "copy checker"} is now ${t.name}. Both teachers were told.`,
                                                      );
                                                  }}
                                                  className={`flex-row items-center gap-2 px-3 py-2 ${current ? "bg-[#EEF4FF]" : "active:bg-ink-50"}`}
                                                >
                                                  <View className="h-6 w-6 items-center justify-center rounded-full bg-[#EEF4FF]">
                                                    <Text className="text-[9px] font-semibold text-clay-500">{initials(t.name)}</Text>
                                                  </View>
                                                  <Text className="min-w-0 flex-1 text-[13px] text-ink-900" numberOfLines={1}>{t.name}</Text>
                                                  {current ? <Ionicons name="checkmark" size={14} color="#2563EB" /> : null}
                                                </Pressable>
                                              );
                                            })}
                                          </View>
                                        }
                                      >
                                        <Pressable
                                          accessibilityRole="button"
                                          accessibilityLabel={`${isPaper ? "Paper" : "Checking"} teacher for ${exam.subject.name}`}
                                          disabled={locked || Boolean(pending)}
                                          onPress={(e) => {
                                            e.stopPropagation?.();
                                            setTeacherPickFor(teacherPickFor === key ? "" : key);
                                          }}
                                          className={`flex-row items-center gap-1.5 self-start rounded-lg py-1 pl-1 pr-2 ${locked ? "" : "hover:bg-ink-50"}`}
                                        >
                                          {done ? (
                                            <Ionicons name="checkmark-circle" size={15} color="#10B981" />
                                          ) : (
                                            <View className="h-6 w-6 items-center justify-center rounded-full bg-[#EEF4FF]">
                                              <Text className="text-[9px] font-semibold text-clay-500">{initials(name)}</Text>
                                            </View>
                                          )}
                                          <Text className="min-w-0 shrink text-[12px] text-ink-800" numberOfLines={1}>{name}</Text>
                                          {late ? (
                                            <View className="rounded bg-amber-50 px-1.5 py-0.5">
                                              <Text className="text-[10px] font-semibold text-amber-700">late</Text>
                                            </View>
                                          ) : null}
                                          {locked ? null : <Ionicons name="chevron-down" size={11} color="#94A3B8" />}
                                        </Pressable>
                                      </Popover>
                                    </View>
                                  );
                                };
                                return (
                                  <>
                                    {cell("paper")}
                                    {cell("checking")}
                                  </>
                                );
                              })()}
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
                  : historyMode
                    ? `Create past ${sheetSitting.name}`
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
            onHistoryModeChange={setHistoryMode}
            onOpenStaff={() => {
              setSheet("");
              router.push("/staff");
            }}
            onSave={savePapers}
          />
        ) : null}
      </Modal>
      <ScheduleExamModal
        plan={plan}
        open={editDatesOpen && Boolean(series)}
        item={
          series
            ? plan.find((p) => p.id === series.planItemId) || {
                id: series.planItemId || "",
                name: series.name,
                kind: "term1",
                weight: 0,
                maxMarks: series.exams[0]?.maxMarks || 80,
              }
            : null
        }
        edit={
          series
            ? {
                seriesId: series.id,
                classId: series.classId,
                resultOn: series.exams.map((e) => e.resultOn || "").filter(Boolean).sort().at(-1) || null,
                exams: series.exams.map((e) => ({
                  subjectId: e.subject.id || "",
                  date: e.date,
                  paperDueOn: e.paperDueOn,
                  copiesDueOn: e.copiesDueOn,
                  teacherId: e.teacherId,
                  setterId: e.setterId,
                  maxMarks: e.maxMarks,
                  startTime: e.startTime || "",
                  endTime: e.endTime || "",
                })),
              }
            : null
        }
        sessionId={session?.id || sessionId}
        classes={classes}
        teachers={teachers.map((t) => ({ id: t.id, name: t.name }))}
        series={(pack?.series ?? []).filter((s) => s.sessionId === (session?.id || sessionId))}
        calendar={calendar}
        token={token}
        onClose={() => setEditDatesOpen(false)}
        onDone={async (message) => {
          setEditDatesOpen(false);
          toast.show(message);
          await reload();
        }}
      />
      <ScheduleExamModal
        plan={plan}
        open={Boolean(allPlanId)}
        item={plan.find((p) => p.id === allPlanId) || null}
        sessionId={session?.id || sessionId}
        initialClassIds={allClassIds}
        classes={(() => {
          const it = plan.find((p) => p.id === allPlanId);
          return it ? examClasses(it, classes) : classes;
        })()}
        teachers={teachers.map((t) => ({ id: t.id, name: t.name }))}
        series={(pack?.series ?? []).filter((s) => s.sessionId === (session?.id || sessionId))}
        calendar={calendar}
        token={token}
        onClose={() => setAllPlanId("")}
        onDone={async (message) => {
          setAllPlanId("");
          toast.show(message);
          await reload();
        }}
      />
      <ExamFormModal
        open={Boolean(examForm)}
        mode={examForm?.mode || "create"}
        initial={examForm?.initial || null}
        sessions={sessions.map((x) => ({ id: x.id, label: x.label, current: x.current }))}
        classes={classes.map((c) => ({ id: c.id, label: c.label }))}
        otherWeights={(sid, exceptId) =>
          ((pack?.planBySession?.[sid] as { id: string; weight: number }[] | undefined) || []).filter((p) => p.id !== exceptId).reduce((sum, p) => sum + (p.weight || 0), 0)
        }
        token={token}
        onClose={() => setExamForm(null)}
        onSaved={async (res) => {
          setExamForm(null);
          if (!res.created) {
            toast.show("Exam saved.");
            await reload();
            return;
          }
          if (res.sessionId !== (session?.id || sessionId)) {
            setSessionId(res.sessionId);
            setExamPlanId("");
            setPageClassId("");
          }
          await reload();
          setScheduleAfter({ id: res.id, classIds: res.classIds });
        }}
      />
      <ExamConfirm
        open={Boolean(deleteExamId)}
        title={`Delete ${plan.find((p) => p.id === deleteExamId)?.name || "exam"}?`}
        body="Its scheduled papers are removed too. Exams that already have marks can't be deleted."
        action="Delete exam"
        busy={pending === "deleteExamItem"}
        onClose={() => setDeleteExamId("")}
        onConfirm={async () => {
          const ok = await run("deleteExamItem", { sessionId: session?.id || sessionId, id: deleteExamId }, "Exam deleted.");
          setDeleteExamId("");
          if (ok) setExamPlanId("");
        }}
      />
      <PastMarksModal
        open={Boolean(pastPlanId)}
        item={plan.find((p) => p.id === pastPlanId) || null}
        sessionId={session?.id || sessionId}
        sessionStart={session?.startsOn}
        classes={classes}
        students={data?.examStudents ?? []}
        series={(pack?.series ?? []).filter((s) => s.sessionId === (session?.id || sessionId))}
        token={token}
        onClose={() => setPastPlanId("")}
        onSaved={async (message) => {
          toast.show(message);
          await reload();
        }}
      />
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
        title={`Approve ${approveExam ? subjectLabel(approveExam.subject) : ""} marks?`}
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
            "Approved. Publish to parents when ready.",
          );
          setApproveExamId("");
          setLeavingIds((cur) => cur.filter((id) => id !== approveExam.id));
          if (!ok) setApprovedFlash("");
        }}
      />
      <Modal
        open={publishOpen}
        title={allPublished ? `Send ${series?.name || "exam"} results again` : `Publish ${series?.name || "exam"} results`}
        onClose={() => setPublishOpen(false)}
        footer={
          <View className="flex-row items-center justify-end gap-2">
            <Button variant="ghost" onPress={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending === "publishExamResults"}
              onPress={async () => {
                await publishToParents(undefined, Math.max(0, Math.floor(Number(holdUnpaidMonths) || 0)));
                setPublishOpen(false);
              }}
            >
              {pending === "publishExamResults" ? "Publishing…" : allPublished ? "Send again" : `Publish to ${studentCount} families`}
            </Button>
          </View>
        }
      >
        <View className="gap-4">
          <Text className="text-[14px] leading-5 text-ink-600">
            All papers go out together. Parents get the report card in the app.
          </Text>
          <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
            <View className="flex-row items-center gap-3 px-4 py-3">
              <Ionicons name="school-outline" size={18} color="#64748B" />
              <Text className="flex-1 text-[14px] text-ink-700">Class</Text>
              <Text className="text-[14px] font-semibold text-ink-900">{classLabel}</Text>
            </View>
            <View className="flex-row items-center gap-3 border-t border-ink-100 px-4 py-3">
              <Ionicons name="document-text-outline" size={18} color="#64748B" />
              <Text className="flex-1 text-[14px] text-ink-700">Papers</Text>
              <Text className="text-[14px] font-semibold tabular-nums text-ink-900">{papers.length}</Text>
            </View>
            <View className="flex-row items-center gap-3 border-t border-ink-100 px-4 py-3">
              <Ionicons name="people-outline" size={18} color="#64748B" />
              <Text className="flex-1 text-[14px] text-ink-700">Students</Text>
              <Text className="text-[14px] font-semibold tabular-nums text-ink-900">{studentCount}</Text>
            </View>
            <View className="border-t border-ink-100 px-4 py-3">
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: Math.max(0, Math.floor(Number(holdUnpaidMonths) || 0)) > 0 }}
                onPress={() => setHoldUnpaidMonths(Math.max(0, Math.floor(Number(holdUnpaidMonths) || 0)) > 0 ? "0" : "1")}
                className="flex-row items-center gap-3"
              >
                <Ionicons name="wallet-outline" size={18} color="#64748B" />
                <View className="flex-1">
                  <Text className="text-[14px] text-ink-700">Hold back if fees are unpaid</Text>
                  <Text className="mt-0.5 text-[12px] text-ink-500">
                    {Math.max(0, Math.floor(Number(holdUnpaidMonths) || 0)) > 0 ? "Those families see results after they pay." : "Every family sees results, paid or not."}
                  </Text>
                </View>
                <View className={`h-6 w-10 justify-center rounded-full px-0.5 ${Math.max(0, Math.floor(Number(holdUnpaidMonths) || 0)) > 0 ? "items-end bg-clay-500" : "items-start bg-ink-200"}`}>
                  <View className="h-5 w-5 rounded-full bg-white" />
                </View>
              </Pressable>
              {Math.max(0, Math.floor(Number(holdUnpaidMonths) || 0)) > 0 ? (
                <View className="ml-[30px] mt-3 flex-row flex-wrap items-center gap-2">
                  <Text className="text-[13px] text-ink-700">Hold back if</Text>
                  <View className="flex-row items-center overflow-hidden rounded-lg border border-ink-200">
                    <Pressable accessibilityLabel="Fewer months" onPress={() => setHoldUnpaidMonths(String(Math.max(1, Math.max(0, Math.floor(Number(holdUnpaidMonths) || 0)) - 1)))} className="h-8 w-8 items-center justify-center">
                      <Ionicons name="remove" size={14} color="#334155" />
                    </Pressable>
                    <Text className="w-8 text-center text-[14px] font-semibold tabular-nums text-ink-900">{Math.max(0, Math.floor(Number(holdUnpaidMonths) || 0))}</Text>
                    <Pressable accessibilityLabel="More months" onPress={() => setHoldUnpaidMonths(String(Math.max(0, Math.floor(Number(holdUnpaidMonths) || 0)) + 1))} className="h-8 w-8 items-center justify-center">
                      <Ionicons name="add" size={14} color="#334155" />
                    </Pressable>
                  </View>
                  <Text className="text-[13px] text-ink-700">{`or more month${Math.max(0, Math.floor(Number(holdUnpaidMonths) || 0)) === 1 ? " is" : "s are"} unpaid`}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
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
              <Text className="text-[17px] font-bold text-ink-900">{subjectLabel(detailExam.subject)}</Text>
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
                    {detailExam.startTime && detailExam.endTime ? (
                      <Text className="mt-0.5 text-[12px] text-ink-700">{prettyTimeRange(detailExam.startTime, detailExam.endTime)}</Text>
                    ) : null}
                  </View>
                  <View className="min-w-[120px] flex-1 rounded-xl border border-ink-100 bg-ink-50 px-3 py-2.5">
                    <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Max marks</Text>
                    <Text className="mt-1 text-sm text-ink-900">{detailExam.maxMarks}</Text>
                  </View>
                </View>
                {!isHistoryImportPaper(detailExam) ? (
                  <View className="overflow-hidden rounded-lg border border-ink-100">
                    {(["paper", "checking"] as const).map((role, i) => {
                      const isPaper = role === "paper";
                      const currentId = isPaper ? detailExam.setterId || detailExam.teacherId || "" : detailExam.teacherId || "";
                      const name = teachers.find((t) => t.id === currentId)?.name || (isPaper ? detailExam.setterName : detailExam.teacherName) || "No teacher yet";
                      const locked = !canRun || (isPaper ? Boolean(detailExam.paperAt) : (detailExam.entered ?? 0) > 0 || ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED", "APPROVED", "PUBLISHED", "IN_PROGRESS", "MARKS_DRAFT"].includes(detailExam.workflowStatus || ""));
                      return (
                        <View key={role} className={`flex-row items-center gap-2.5 px-3 py-2.5 ${i ? "border-t border-ink-100" : ""}`}>
                          <View className="h-7 w-7 items-center justify-center rounded-full bg-[#EEF4FF]">
                            <Text className="text-[10px] font-semibold text-clay-500">{initials(name)}</Text>
                          </View>
                          <View className="min-w-0 flex-1">
                            <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{isPaper ? "Paper setter" : "Copy checker"}</Text>
                            {locked ? (
                              <Text className="text-[13px] font-medium text-ink-900" numberOfLines={1}>{name}</Text>
                            ) : (
                              <Select
                                value={currentId}
                                placeholder="Pick the teacher"
                                options={teachers.map((t) => ({ id: t.id, label: t.name }))}
                                onChange={(id) => {
                                  if (id !== currentId)
                                    void run(
                                      "reassignExamRole",
                                      { examId: detailExam.id, role, teacherId: id },
                                      `${detailExam.subject.name}: ${isPaper ? "paper setter" : "copy checker"} changed. Both teachers were told.`,
                                    );
                                }}
                              />
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
                <View className="gap-2">
                  <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-700">
                    {isHistoryImportPaper(detailExam) ? "History status" : "Exam progress"}
                  </Text>
                  {isHistoryImportPaper(detailExam) ? (
                    <View className="rounded-xl border border-ink-100 bg-ink-50 px-3 py-3">
                      <View className="flex-row items-center gap-2">
                        <View className="h-6 w-6 items-center justify-center rounded-full bg-[#10B981]">
                          <Ionicons name="checkmark" size={13} color="#fff" />
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text className="text-[13px] font-semibold text-ink-900">
                            {detailExam.workflowStatus === "PUBLISHED"
                              ? "History marks published"
                              : detailExam.workflowStatus === "APPROVED"
                                ? "History marks approved"
                                : "History marks imported"}
                          </Text>
                          <Text className="mt-0.5 text-[12px] text-ink-600">
                            {detailExam.entered ?? 0}/{studentCount} marks saved from backlog import
                          </Text>
                        </View>
                      </View>
                    </View>
                  ) : (
                    <ExamSimpleSteps
                      steps={[
                        { title: "Scheduled", done: true, hint: prettyFull(detailExam.date) },
                        {
                          title: "Paper ready",
                          done: Boolean(detailExam.paperAt) || day(detailExam.date) <= day(new Date().toISOString()),
                          hint: detailExam.paperAt
                            ? `Received on ${prettyDay(detailExam.paperAt)}`
                            : detailExam.paperHandedAt
                              ? "Handed over · waiting for you to confirm"
                            : detailExam.paperDueOn
                              ? `Due by ${prettyDay(detailExam.paperDueOn)}`
                              : "",
                        },
                        {
                          title: "Exam done",
                          done: Boolean(detailExam.conductedAt) || day(detailExam.date) <= day(new Date().toISOString()),
                          hint: prettyDay(detailExam.date),
                        },
                        {
                          title: "Marks entered",
                          done: officeSubmitted(detailExam.workflowStatus) || detailExam.workflowStatus === "PUBLISHED",
                          hint: `${detailExam.entered ?? 0}/${studentCount} entered`,
                        },
                        {
                          title: "Published",
                          done: detailExam.workflowStatus === "PUBLISHED",
                          hint:
                            detailExam.workflowStatus === "PUBLISHED"
                              ? "Parents can see these marks"
                              : adminCanPublish(detailExam.workflowStatus)
                                ? "Press Publish when ready"
                                : "",
                        },
                      ]}
                    />
                  )}
                </View>
                {!isHistoryImportPaper(detailExam) ? (
                  <OfficePaperHandover
                    exam={detailExam}
                    canRun={canRun}
                    busy={pending === "receiveExamPaper" || pending === "returnExamPaper"}
                    onReceive={() => void run("receiveExamPaper", { examId: detailExam.id }, `${detailExam.subject.name} paper received. The teacher has been told.`)}
                    onReturn={(reason) => run("returnExamPaper", { examId: detailExam.id, reason }, `${detailExam.subject.name} paper sent back to the teacher.`)}
                    onOpenFile={(path) => void openPrivateFile(token, path).catch((e) => toast.show(e instanceof Error ? e.message : "Could not open the file."))}
                  />
                ) : null}
                <View className="flex-row flex-wrap gap-2">
                  {canRun && isHistoryImportPaper(detailExam) ? (
                    <Button className="w-full" onPress={() => void openMarksEditor(detailExam)}>
                      Edit marks
                    </Button>
                  ) : null}
                  {canRun &&
                  !isHistoryImportPaper(detailExam) &&
                  (adminCanReview(detailExam.workflowStatus) ||
                    detailExam.workflowStatus === "APPROVED" ||
                    detailExam.workflowStatus === "PUBLISHED" ||
                    detailExam.workflowStatus === "MARKS_DRAFT" ||
                    detailExam.workflowStatus === "CORRECTION_REQUIRED") ? (
                    <ExamAction
                      variant="ghost"
                      busy={pending === "reviewExamMarks"}
                      onPress={async () => {
                        await openMarksEditor(detailExam);
                      }}
                    >
                      View marks
                    </ExamAction>
                  ) : null}
                  {canPublish && papers.length === 1 && !isHistoryImportPaper(detailExam) && adminCanPublish(detailExam.workflowStatus) ? (
                    <ExamAction onPress={() => setPublishOpen(true)}>Publish result</ExamAction>
                  ) : null}
                  {canRun && !isHistoryImportPaper(detailExam) ? (
                    <Button variant="ghost" className="w-full" onPress={() => setEditDatesOpen(true)}>
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

/** One place for results: locked until every paper has marks, then a single "Publish results" for the whole exam. */
function ResultsBar({
  total,
  ready,
  allPublished,
  canPublish,
  busy,
  onPreview,
  onPublish,
  issueButton,
}: {
  total: number;
  ready: number;
  allPublished: boolean;
  canPublish: boolean;
  busy: boolean;
  onPreview: () => void;
  onPublish: () => void;
  issueButton?: React.ReactNode;
}) {
  const waiting = total - ready;
  const tone = allPublished ? "border-emerald-100 bg-emerald-50" : waiting ? "border-ink-200 bg-white" : "border-clay-100 bg-[#EEF3FF]";
  return (
    <View className={`flex-row flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 ${tone}`}>
      {allPublished ? (
        <View className="h-8 w-8 items-center justify-center rounded-full bg-emerald-500">
          <Ionicons name="checkmark" size={16} color="#FFFFFF" />
        </View>
      ) : null}
      <View className="min-w-[220px] flex-1">
        <Text className="text-[14px] font-semibold text-ink-900">
          {allPublished ? "Results published to parents" : waiting ? `Results · ${ready} of ${total} papers have marks` : `All ${total} papers have marks`}
        </Text>
        <Text className="mt-0.5 text-[12px] text-ink-700">
          {allPublished
            ? "Families can see the report card."
            : waiting
              ? `Publishing unlocks when every paper is in. ${waiting} still ${waiting === 1 ? "needs" : "need"} marks.`
              : "Check the marks, then publish once. Every paper goes to parents together."}
        </Text>
        {!allPublished ? (
          <View className="mt-2 h-1.5 w-full max-w-[280px] overflow-hidden rounded-full bg-ink-100">
            <View className="h-full rounded-full bg-clay-500" style={{ width: `${total ? (ready / total) * 100 : 0}%` }} />
          </View>
        ) : null}
      </View>
      {canPublish ? (
        <View className="flex-row flex-wrap items-center gap-2">
          {allPublished ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={onPublish} className="h-9 flex-row items-center gap-1.5 rounded-lg px-2 active:bg-emerald-100">
              <Ionicons name="refresh" size={14} color="#047857" />
              <Text className="text-[13px] font-medium text-emerald-700">{busy ? "Sending…" : "Send again"}</Text>
            </Pressable>
          ) : null}
          {!waiting ? (
            <Button variant="ghost" onPress={onPreview} className="anekio-btn h-9 px-3 py-1.5">
              Preview results
            </Button>
          ) : null}
          {allPublished ? (
            issueButton
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(waiting) || busy }}
              disabled={Boolean(waiting) || busy}
              onPress={onPublish}
              className={`h-9 items-center justify-center rounded-lg px-4 ${waiting ? "bg-ink-200" : "bg-clay-500"}`}
            >
              <Text className={`text-[14px] font-semibold ${waiting ? "text-ink-500" : "text-white"}`}>{busy ? "Publishing…" : "Publish results"}</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** Office side of the paper handover: Received / Send back, or mark received directly. */
function OfficePaperHandover({
  exam,
  canRun,
  busy,
  onReceive,
  onReturn,
  onOpenFile,
}: {
  exam: {
    paperAt?: string | null;
    paperHandedAt?: string | null;
    paperHandNote?: string;
    paperReturnNote?: string;
    paperFilePath?: string;
    paperFileName?: string | null;
    setterName?: string;
    teacherName?: string;
  };
  canRun: boolean;
  busy: boolean;
  onReceive: () => void;
  onReturn: (reason: string) => Promise<unknown>;
  onOpenFile: (path: string) => void;
}) {
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const who = exam.setterName || exam.teacherName || "The teacher";
  const when = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
  const file = exam.paperFilePath ? (
    <Pressable accessibilityRole="button" onPress={() => onOpenFile(String(exam.paperFilePath))} className="flex-row items-center gap-1.5 self-start py-0.5">
      <Ionicons name="attach-outline" size={14} color="#2563EB" />
      <Text className="text-[12px] font-medium text-clay-600" numberOfLines={1}>{exam.paperFileName || "Soft copy"}</Text>
    </Pressable>
  ) : null;

  if (exam.paperAt) {
    return (
      <View className="gap-1 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-3">
        <Text className="text-[13px] font-semibold text-emerald-800">{`✓ Question paper received · ${when(exam.paperAt)}`}</Text>
        {file}
      </View>
    );
  }
  if (exam.paperHandedAt) {
    return (
      <View className="gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
        <Text className="text-[13px] font-semibold text-amber-900">{`${who} handed over the paper · ${when(exam.paperHandedAt)}`}</Text>
        {exam.paperHandNote ? <Text className="text-[12px] text-amber-900">{`Note: ${exam.paperHandNote}`}</Text> : null}
        {file}
        {canRun ? (
          returning ? (
            <View className="gap-2">
              <TextInput
                value={reason}
                onChangeText={setReason}
                maxLength={300}
                autoFocus
                placeholder="What needs fixing? e.g. page 2 missing"
                placeholderTextColor="#94A3B8"
                className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13px] text-ink-900"
              />
              <View className="flex-row flex-wrap justify-end gap-2">
                <Button variant="ghost" onPress={() => setReturning(false)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={busy || reason.trim().length < 3}
                  onPress={async () => {
                    await onReturn(reason.trim());
                    setReturning(false);
                    setReason("");
                  }}
                >
                  Send back
                </Button>
              </View>
            </View>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              <Button disabled={busy} onPress={onReceive}>
                Received ✓
              </Button>
              <Button variant="ghost" disabled={busy} onPress={() => setReturning(true)}>
                Send back
              </Button>
            </View>
          )
        ) : null}
      </View>
    );
  }
  return (
    <View className="gap-2 rounded-xl border border-ink-200 bg-white px-3.5 py-3">
      <Text className="text-[13px] font-semibold text-ink-900">
        {exam.paperReturnNote ? "Paper sent back to the teacher" : "Question paper not handed over yet"}
      </Text>
      {exam.paperReturnNote ? <Text className="text-[12px] text-red-700">{`Reason: ${exam.paperReturnNote}`}</Text> : null}
      {canRun ? (
        <Pressable accessibilityRole="button" disabled={busy} onPress={onReceive} className="self-start py-0.5">
          <Text className="text-[12px] font-medium text-clay-600">Already have it? Mark received</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
