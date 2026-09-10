import { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Modal as RnModal,
  Platform,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";
import { openMarksheetPdf } from "../lib/print-html";
import { parentTimetableGroups, parentUpcomingPapers, type ParentUpcomingPaper } from "../lib/parent-examination";
import { Toast, useToast } from "./ui";

type IonName = ComponentProps<typeof Ionicons>["name"];

type ExamSession = {
  id: string;
  name: string;
  sessionLabel: string;
  status: "published" | "upcoming" | "held" | "unpublished";
  examLabel: string;
  examDate: string;
  resultDate: string;
};

function Skeleton({ className }: { className: string }) {
  return <View className={`rounded-xl bg-ink-100 ${className}`} />;
}

function parseLabelDate(label: string) {
  const t = Date.parse(String(label || "").replace(/Sept/g, "Sep"));
  return Number.isNaN(t) ? 0 : t;
}

function pickDate(dates: string[], last: boolean) {
  const real = dates.filter(Boolean);
  if (!real.length) return "—";
  const sorted = real.slice().sort((a, b) => parseLabelDate(a) - parseLabelDate(b));
  return last ? sorted[sorted.length - 1] : sorted[0];
}

function sessionYear(label: string) {
  if (!label) return "";
  return /academic/i.test(label) ? label : `Academic Year ${label}`;
}

function sittingTone(name: string, index: number) {
  const n = name.toLowerCase();
  if (n.includes("term 2") || n.includes("annual")) return { bg: "#ECFDF5", fg: "#059669" };
  if (n.includes("term")) return { bg: "#EFF6FF", fg: "#2563EB" };
  if (n.includes("2") && n.includes("unit")) return { bg: "#FFF7ED", fg: "#EA580C" };
  if (n.includes("unit") || n.includes("test")) return { bg: "#F5F3FF", fg: "#7C3AED" };
  const palette = [
    { bg: "#EFF6FF", fg: "#2563EB" },
    { bg: "#F5F3FF", fg: "#7C3AED" },
    { bg: "#FFF7ED", fg: "#EA580C" },
    { bg: "#ECFDF5", fg: "#059669" },
  ];
  return palette[index % palette.length];
}

function sittingIcon(name: string, status: ExamSession["status"]): IonName {
  const n = name.toLowerCase();
  if (status === "upcoming") return "calendar-outline";
  if (n.includes("term") || n.includes("annual") || n.includes("final")) return "trophy-outline";
  return "document-text-outline";
}

function subjectTone(name: string): { icon: IonName; bg: string; fg: string } {
  const n = name.toLowerCase();
  if (n.includes("math")) return { icon: "calculator-outline", bg: "#EFF6FF", fg: "#2563EB" };
  if (n.includes("eng")) return { icon: "book-outline", bg: "#F5F3FF", fg: "#7C3AED" };
  if (n.includes("sci") || n.includes("chem") || n.includes("bio") || n.includes("phy")) {
    return { icon: "flask-outline", bg: "#FFF7ED", fg: "#EA580C" };
  }
  if (n.includes("hindi") || n.includes("sanskrit")) return { icon: "language-outline", bg: "#ECFDF5", fg: "#059669" };
  if (n.includes("social") || n.includes("history") || n.includes("civics") || n.includes("geo")) {
    return { icon: "globe-outline", bg: "#EEF2FF", fg: "#4F46E5" };
  }
  if (n.includes("comp") || n.includes("ict") || n.includes("info")) {
    return { icon: "desktop-outline", bg: "#F0F9FF", fg: "#0284C7" };
  }
  if (n.includes("art") || n.includes("draw")) return { icon: "color-palette-outline", bg: "#FDF2F8", fg: "#DB2777" };
  if (n.includes("sport") || n.includes("physical") || n === "pe") {
    return { icon: "basketball-outline", bg: "#FFFBEB", fg: "#D97706" };
  }
  return { icon: "book-outline", bg: "#F8FAFC", fg: "#475569" };
}

function dateParts(label: string) {
  const match = String(label || "").match(/^(\d{1,2})\s+([A-Za-z]+)/);
  if (!match) return { day: label, month: "" };
  return { day: match[1].padStart(2, "0"), month: match[2].slice(0, 3).toUpperCase() };
}

function weekdayLabel(label: string) {
  const t = parseLabelDate(label);
  if (!t) return "";
  return new Date(t).toLocaleDateString("en-IN", { weekday: "short" });
}

function weekdayLong(label: string) {
  const t = parseLabelDate(label);
  if (!t) return "";
  return new Date(t).toLocaleDateString("en-IN", { weekday: "long" });
}

function statusStyle(session: ExamSession) {
  if (session.status === "published") return { bg: "#ECFDF5", fg: "#047857", label: "Published" };
  if (session.status === "held") return { bg: "#FFFBEB", fg: "#B45309", label: "Held for fees" };
  if (session.status === "upcoming") return { bg: "#EFF6FF", fg: "#2563EB", label: "Upcoming" };
  if (session.examLabel === "Exam completed") return { bg: "#F8FAFC", fg: "#64748B", label: "Result unavailable" };
  return { bg: "#F1F5F9", fg: "#64748B", label: "Not published" };
}

export function ParentExaminationLoading() {
  return (
    <View className="parent-examination-page mx-auto w-full max-w-[1140px]">
      <Skeleton className="parent-exam-hero mb-8 h-[188px] w-full rounded-[18px]" />
      <Skeleton className="h-7 w-44" />
      <Skeleton className="mt-2 h-3.5 w-full max-w-lg" />
      <View className="mt-4 flex-row flex-wrap gap-3">
        <Skeleton className="h-[44px] w-full max-w-[300px]" />
        <Skeleton className="h-[44px] w-[160px]" />
      </View>
      <View className="mt-5 flex-row flex-wrap gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[196px] min-w-[250px] flex-1" />
        ))}
      </View>
    </View>
  );
}

export function ParentExaminationError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View className="parent-examination-page mx-auto w-full max-w-[1140px] items-start">
      <Text className="text-[16px] font-semibold text-ink-900">Could not load Examination</Text>
      <Text className="mt-1 text-[12px] text-ink-700">{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        className="parent-exam-btn mt-4 h-10 items-center justify-center rounded-[9px] bg-clay-500 px-4"
      >
        <Text className="text-[13px] font-semibold text-white">Try again</Text>
      </Pressable>
    </View>
  );
}

function ParentExamHero({ wide }: { wide: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel="Anekio. One platform, infinite possibilities. At Anekio, we celebrate every step of your child's learning journey. Learn, grow, achieve."
      className="parent-exam-hero"
    >
      <View className="parent-exam-hero-bg" pointerEvents="none" />
      <View className="parent-exam-hero-grid">
        <View className="parent-exam-hero-copy">
          <View className="parent-exam-hero-brand">
            <Text className="parent-exam-hero-kicker">ANEKIO</Text>
            <View className="parent-exam-hero-brand-line" />
          </View>
          <Text className="parent-exam-hero-title" maxFontSizeMultiplier={1.12}>
            One platform{"\n"}infinite possibilities
          </Text>
          <Text className="parent-exam-hero-lede" numberOfLines={wide ? 2 : 3}>
            At Anekio, we celebrate every step of your child's learning journey.
          </Text>
          <Text className="parent-exam-hero-signature">
            <Text className="parent-exam-hero-sig-word">Learn</Text>
            {"  ·  "}
            <Text className="parent-exam-hero-sig-word">Grow</Text>
            {"  ·  "}
            <Text className="parent-exam-hero-sig-word">Achieve</Text>
          </Text>
        </View>
        <View className="parent-exam-hero-art" pointerEvents="none">
          <View className="parent-exam-hero-glow" />
          <View className="parent-exam-hero-particle parent-exam-hero-p1" />
          <View className="parent-exam-hero-particle parent-exam-hero-p2" />
          <View className="parent-exam-hero-particle parent-exam-hero-p3" />
          <View className="parent-exam-hero-particle parent-exam-hero-p4" />
          <View className="parent-exam-hero-particle parent-exam-hero-p5" />
          <View className="parent-exam-hero-particle parent-exam-hero-p6" />
          <Text className="parent-exam-hero-glyph parent-exam-hero-glyph-book">{"\u{1F4DA}"}</Text>
          <Text className="parent-exam-hero-glyph parent-exam-hero-glyph-star">{"\u2726"}</Text>
          <View className="parent-exam-hero-float">
            <Image
              source={require("../assets/parent-exam-hero.png")}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              resizeMode="contain"
              className="parent-exam-hero-photo"
              style={{ width: 168, height: 200 }}
            />
          </View>
          <View className="parent-exam-hero-badge">
            <Text className="parent-exam-hero-badge-text">{"\u2726"} Learn & Grow</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function ParentChildSwitcher({ wide }: { wide: boolean }) {
  const { data, childId, setChildId } = useRecord();
  const kids = data?.children ?? [];
  const child = data?.child;
  const triggerRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState({ x: 0, y: 0, w: 300 });
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

  function placeAndOpen(x: number, y: number, w: number, h: number) {
    const screen = Dimensions.get("window");
    const width = Math.min(330, Math.max(wide ? 300 : w || 300, w || 300));
    const left = Math.min(Math.max(12, x), screen.width - width - 12);
    const top = Math.min(y + h + 6, screen.height - 220);
    setMenu({ x: left, y: top, w: width });
    setTimeout(() => setOpen(true), 0);
  }

  function toggle() {
    if (!many) return;
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const el = document.querySelector('[data-testid="parent-exam-child"]');
      if (el) {
        const r = el.getBoundingClientRect();
        placeAndOpen(r.left, r.top, r.width, r.height);
        return;
      }
    }
    const node = triggerRef.current;
    if (!node?.measureInWindow) {
      placeAndOpen(24, 88, 300, 44);
      return;
    }
    node.measureInWindow((x, y, w, h) => placeAndOpen(x, y, w, h));
  }

  const label = child ? `${child.name} · Class ${child.classLabel}` : "Select child";

  return (
    <View
      collapsable={false}
      ref={triggerRef}
      className={wide ? "w-[300px]" : "w-full"}
      style={wide ? { width: 300 } : undefined}
    >
      <Pressable
        testID="parent-exam-child"
        accessibilityRole={many ? "button" : undefined}
        accessibilityLabel={many ? "Switch child" : label}
        accessibilityState={many ? { expanded: open } : undefined}
        disabled={!many}
        onPress={toggle}
        className="h-[44px] flex-row items-center rounded-[12px] border bg-white px-3"
        style={{ borderColor: "#E2E8F0" }}
      >
        <Text className="min-w-0 flex-1 text-[13px] font-medium text-ink-900" numberOfLines={1}>
          {label}
        </Text>
        {many ? <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color="#64748B" /> : null}
      </Pressable>
      <RnModal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View className="flex-1">
          <Pressable className="absolute inset-0" onPress={close} accessibilityLabel="Close children" />
          <View
            className="absolute overflow-hidden rounded-[12px] border bg-white"
            style={{
              top: menu.y,
              left: menu.x,
              width: menu.w,
              maxHeight: 280,
              borderColor: "#E2E8F0",
              ...(Platform.OS === "web"
                ? ({ boxShadow: "0 1px 3px rgba(15,23,42,0.12)" } as const)
                : {
                    shadowColor: "#0F172A",
                    shadowOpacity: 0.08,
                    shadowRadius: 4,
                    shadowOffset: { width: 0, height: 1 },
                    elevation: 3,
                  }),
            }}
          >
            <Text className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
              Children
            </Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 240 }}>
              {kids.map((c) => {
                const on = activeId === c.id;
                const admission = c.admissionNo || (child?.id === c.id ? child.admissionNo : "");
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      void setChildId(c.id);
                      close();
                    }}
                    className="min-h-[54px] flex-row items-center px-3 py-2.5"
                    style={{ backgroundColor: on ? "#EEF2FF" : "#FFFFFF" }}
                  >
                    <View className="min-w-0 flex-1">
                      <Text className={`text-[13px] ${on ? "font-semibold text-ink-900" : "font-medium text-ink-900"}`}>
                        {c.name}
                      </Text>
                      <Text className="mt-0.5 text-[12px] text-ink-500">
                        Class {c.classLabel}
                        {admission ? ` · ${admission}` : ""}
                      </Text>
                    </View>
                    {on ? <Ionicons name="checkmark" size={18} color="#2563EB" /> : null}
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

function BackLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back to examinations"
      onPress={onPress}
      className="h-9 flex-row items-center self-start"
    >
      <Ionicons name="chevron-back" size={16} color="#2563EB" />
      <Text className="ml-0.5 text-[13px] font-semibold text-clay-500">Back to examinations</Text>
    </Pressable>
  );
}

export function ParentExamination() {
  const { data, childId, reload, refreshing } = useRecord();
  const { token } = useSession();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams<{ seriesId?: string; view?: string }>();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const child = data?.child;
  const reports = data?.reports ?? [];
  const upcoming = parentUpcomingPapers<ParentUpcomingPaper>(data);
  const sessions = data?.examSessions ?? [];
  const hold = data?.reportCardHold || null;
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [showTimetable, setShowTimetable] = useState(false);
  const [timetableExamId, setTimetableExamId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const prevChild = useRef(childId);
  const timetableGroups = parentTimetableGroups(upcoming, sessions);
  const timetableGroup =
    timetableGroups.find((group) => group.id === timetableExamId) || timetableGroups[0] || null;

  useEffect(() => {
    if (prevChild.current && prevChild.current !== childId) {
      setSelectedExamId(null);
      setShowTimetable(false);
      setTimetableExamId(null);
    }
    prevChild.current = childId;
  }, [childId]);

  useEffect(() => {
    if (!showTimetable) return;
    const tabs = parentTimetableGroups(upcoming, sessions);
    if (timetableExamId && tabs.some((tab) => tab.id === timetableExamId)) return;
    setTimetableExamId(tabs[0]?.id || null);
  }, [showTimetable, timetableExamId, upcoming, sessions]);

  useEffect(() => {
    if (String(params.view || "") === "timetable") {
      setShowTimetable(true);
      setSelectedExamId(null);
      return;
    }
    const id = String(params.seriesId || "");
    if (id) {
      setSelectedExamId(id);
      setShowTimetable(false);
    }
  }, [params.seriesId, params.view]);

  const selected = selectedExamId ? reports.find((r) => r.seriesId === selectedExamId) || null : null;
  const selectedSession = selectedExamId ? sessions.find((s) => s.id === selectedExamId) || null : null;

  function backToOverview() {
    setSelectedExamId(null);
    setShowTimetable(false);
    if (params.seriesId || params.view) router.replace("/tests" as never);
  }

  async function download() {
    if (!selected || !child) return;
    setOpening(true);
    try {
      await openMarksheetPdf(token, { seriesId: selected.seriesId, studentId: child.id });
    } catch {
      toast.show("Could not open the marksheet.");
    } finally {
      setOpening(false);
    }
  }

  const rows =
    selected && child
      ? selected.exams.map((exam) => {
          const mark = selected.marks.find((row) => row.examId === exam.id && row.studentId === child.id);
          const marks = mark?.absent ? null : mark?.marks ?? null;
          return {
            id: exam.id,
            subject: exam.subject.name,
            marks,
            max: exam.maxMarks,
            absent: Boolean(mark?.absent),
            pct: marks == null || mark?.absent ? null : exam.maxMarks ? Math.round((Number(marks) / exam.maxMarks) * 1000) / 10 : null,
          };
        })
      : [];
  const total = rows.reduce((sum, row) => sum + (row.absent || row.marks == null ? 0 : Number(row.marks)), 0);
  const max = rows.reduce((sum, row) => sum + row.max, 0);
  const pct = max ? Math.round((total / max) * 1000) / 10 : 0;

  return (
    <View className="parent-examination-page mx-auto min-h-0 w-full max-w-[1140px] flex-1">
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}

      {showTimetable ? (
        <View className="min-h-0 flex-1">
          <View className="parent-timetable-sticky z-10 flex-row flex-wrap items-center gap-2 pb-3">
            <BackLink onPress={backToOverview} />
            {timetableGroups.map((tab) => {
              const on = timetableGroup?.id === tab.id;
              return (
                <Pressable
                  key={tab.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setTimetableExamId(tab.id)}
                  className={`parent-sitting-chip h-9 items-center justify-center rounded-full border px-3.5 ${on ? "parent-sitting-chip-on" : ""}`}
                  style={{
                    backgroundColor: on ? "#2563EB" : "#FFFFFF",
                    borderColor: on ? "#2563EB" : "#E2E8F0",
                  }}
                >
                  <Text className="text-[13px] font-semibold" style={{ color: on ? "#FFFFFF" : "#0F172A" }} numberOfLines={1}>
                    {tab.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <ScrollView
            className="min-h-0 flex-1"
            contentContainerStyle={{ paddingBottom: 28, gap: 12 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => reload()} />}
          >
            {!timetableGroups.length ? (
              <View className="py-5">
                <Text className="text-[16px] font-bold text-ink-900">Examination timetable</Text>
                <Text className="mt-1 text-[14px] leading-5 text-ink-700">No upcoming tests on the calendar yet.</Text>
              </View>
            ) : (
              (timetableGroup?.papers ?? []).map((exam) => {
                const parts = dateParts(exam.date);
                const dayName = weekdayLong(exam.date) || weekdayLabel(exam.date);
                const paperTone = subjectTone(exam.subject || exam.title);
                return (
                  <View
                    key={exam.id}
                    className="parent-timetable-paper flex-row items-stretch overflow-hidden rounded-[14px] border bg-white"
                    style={{ borderColor: "#E5EAF2" }}
                  >
                    <View className="w-[72px] items-center justify-center py-3.5" style={{ backgroundColor: paperTone.bg }}>
                      <Text className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: paperTone.fg }}>
                        {dayName.slice(0, 3)}
                      </Text>
                      <Text className="mt-1 text-[22px] font-bold leading-6 text-ink-900">{parts.day}</Text>
                      {parts.month ? (
                        <Text className="mt-0.5 text-[11px] font-bold tracking-[0.06em]" style={{ color: paperTone.fg }}>
                          {parts.month}
                        </Text>
                      ) : null}
                    </View>
                    <View className="min-w-0 flex-1 justify-center px-4 py-3.5">
                      <View className={wide ? "flex-row items-center justify-between gap-3" : ""}>
                        <View className="min-w-0 flex-1">
                          <Text className="text-[16px] font-bold text-ink-900">
                            {exam.seriesName ? `${exam.seriesName} · ${exam.subject || exam.title}` : exam.subject || exam.title}
                          </Text>
                          <Text className="mt-1 text-[13px] font-medium text-ink-700">
                            {exam.subject || exam.title}
                            {exam.teacher ? ` · ${exam.teacher}` : ""}
                          </Text>
                        </View>
                        <View className={`flex-row items-center ${wide ? "" : "mt-2"}`}>
                          <Ionicons name="time-outline" size={15} color="#475569" />
                          <Text className="ml-1.5 text-[14px] font-semibold text-ink-900">{exam.time || "—"}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : selectedExamId ? (
        <ScrollView className="min-h-0 flex-1" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => reload()} />}>
          <View className="mb-4">
            <BackLink onPress={backToOverview} />
          </View>
          {selected && child ? (
            <View className="parent-exam-detail overflow-hidden rounded-[14px] border bg-white px-4 py-4 sm:px-5 sm:py-5" style={{ borderColor: "#E5EAF2" }}>
              <View className={wide ? "flex-row items-start justify-between gap-3" : ""}>
                <View className="min-w-0 flex-1">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="text-[20px] font-bold text-ink-900">{selected.seriesName}</Text>
                    {selectedSession ? (
                      <View className="h-6 items-center justify-center rounded-full px-2.5" style={{ backgroundColor: statusStyle(selectedSession).bg }}>
                        <Text className="text-[10px] font-semibold" style={{ color: statusStyle(selectedSession).fg }}>
                          {statusStyle(selectedSession).label}
                        </Text>
                      </View>
                    ) : (
                      <View className="h-6 items-center justify-center rounded-full bg-emerald-50 px-2.5">
                        <Text className="text-[10px] font-semibold text-emerald-700">Published</Text>
                      </View>
                    )}
                  </View>
                  <Text className="mt-1 text-[12px] text-ink-600">
                    {child.name}
                    {child.admissionNo ? ` · ${child.admissionNo}` : ""}
                    {child.classLabel ? ` · Class ${child.classLabel}` : ""}
                  </Text>
                  <Text className="mt-0.5 text-[12px] text-ink-500">{sessionYear(selected.sessionLabel)}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Download report card"
                  onPress={() => void download()}
                  className={`parent-exam-btn mt-3 h-[40px] flex-row items-center justify-center gap-1.5 rounded-[9px] bg-clay-500 px-4 ${wide ? "mt-0" : "w-full"}`}
                >
                  <Ionicons name="download-outline" size={15} color="#ffffff" />
                  <Text className="text-[12px] font-semibold text-white">{opening ? "Opening..." : "Download report card"}</Text>
                </Pressable>
              </View>

              <View className="mt-4 flex-row flex-wrap rounded-[12px] border border-ink-100 bg-[#F8FAFC] px-3 py-3">
                {[
                  { label: "Total marks", value: `${total} / ${max}` },
                  { label: "Percentage", value: `${pct}%` },
                  { label: "Exam completed", value: selectedSession?.examDate || pickDate(selected.exams.map((exam) => exam.date), true) },
                  { label: "Schedule published", value: selectedSession?.resultDate || "—" },
                ].map((item, index) => (
                  <View key={item.label} className="min-w-[140px] flex-1 px-2 py-1" style={{ borderLeftWidth: index && wide ? 1 : 0, borderLeftColor: "#E2E8F0" }}>
                    <Text className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-500">{item.label}</Text>
                    <Text className="mt-1 text-[16px] font-bold text-ink-900">{item.value}</Text>
                  </View>
                ))}
              </View>

              <Text className="mb-1 mt-5 text-[14px] font-bold text-ink-900">Subject-wise marks</Text>
              {rows.map((row, index) => {
                const tone = subjectTone(row.subject);
                return (
                  <View
                    key={row.id}
                    className="min-h-[48px] flex-row items-center"
                    style={{ borderTopWidth: index ? 1 : 0, borderTopColor: "#F1F5F9" }}
                  >
                    <View className="h-7 w-7 items-center justify-center rounded-[8px]" style={{ backgroundColor: tone.bg }}>
                      <Ionicons name={tone.icon} size={14} color={tone.fg} />
                    </View>
                    <Text className="ml-2.5 min-w-0 flex-1 text-[13px] font-semibold text-ink-900">{row.subject}</Text>
                    {row.absent ? (
                      <View className="h-[22px] items-center justify-center rounded-full bg-rose-50 px-2">
                        <Text className="text-[11px] font-semibold text-rose-700">Absent</Text>
                      </View>
                    ) : (
                      <>
                        <Text className="w-[78px] text-right text-[13px] font-semibold text-ink-900">
                          {row.marks == null ? "—" : `${row.marks} / ${row.max}`}
                        </Text>
                        <Text className="ml-3 w-[52px] text-right text-[12px] font-semibold text-ink-500">
                          {row.pct == null ? "—" : `${row.pct}%`}
                        </Text>
                      </>
                    )}
                  </View>
                );
              })}
            </View>
          ) : selectedSession?.status === "held" ? (
            <View className="flex-row items-start gap-3 rounded-[14px] border p-4" style={{ borderColor: "#FDE68A", backgroundColor: "#FFFBEB" }}>
              <View className="h-8 w-8 items-center justify-center rounded-full bg-amber-100">
                <Ionicons name="lock-closed-outline" size={16} color="#B45309" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[16px] font-bold text-ink-900">{selectedSession.name}</Text>
                <Text className="mt-1 text-[14px] font-semibold text-ink-900">Report card held for fees</Text>
                <Text className="mt-0.5 text-[12px] leading-4 text-ink-700">
                  This exam is complete. The report card opens after {hold?.requiredMonths} paid fee month
                  {hold?.requiredMonths === 1 ? "" : "s"}. Paid so far: {hold?.paidMonths}.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/fees")}
                  className="parent-exam-btn mt-3 h-9 self-start items-center justify-center rounded-[9px] bg-clay-500 px-3.5"
                >
                  <Text className="text-[12px] font-semibold text-white">View fees</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View className="rounded-[14px] border border-ink-200 bg-white px-4 py-5">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-[18px] font-bold text-ink-900">{selectedSession?.name || "Examination"}</Text>
                {selectedSession ? (
                  <View className="h-6 items-center justify-center rounded-full px-2.5" style={{ backgroundColor: statusStyle(selectedSession).bg }}>
                    <Text className="text-[10px] font-semibold" style={{ color: statusStyle(selectedSession).fg }}>
                      {statusStyle(selectedSession).label}
                    </Text>
                  </View>
                ) : null}
              </View>
              {child ? (
                <Text className="mt-1 text-[12px] text-ink-600">
                  {child.name}
                  {child.admissionNo ? ` · ${child.admissionNo}` : ""}
                  {child.classLabel ? ` · Class ${child.classLabel}` : ""}
                </Text>
              ) : null}
              <Text className="mt-2 text-[13px] text-ink-600">Result not available</Text>
              <Text className="mt-1 text-[12px] text-ink-500">
                {selectedSession?.examLabel || "Exam scheduled"}
                {selectedSession?.examDate && selectedSession.examDate !== "—" ? ` · ${selectedSession.examDate}` : ""}
              </Text>
            </View>
          )}
        </ScrollView>
      ) : (
        <ScrollView className="min-h-0 flex-1" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => reload()} />}>
          <ParentExamHero wide={wide} />
          <View className="mb-3.5">
            <Text accessibilityRole="header" className="text-[22px] font-bold text-ink-900">
              Examination
            </Text>
          </View>

          <View className={`mb-5 ${wide ? "flex-row items-center justify-between gap-3" : "gap-3"}`}>
            <ParentChildSwitcher wide={wide} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View timetable"
              onPress={() => setShowTimetable(true)}
              className={`parent-exam-outline-btn h-[44px] flex-row items-center justify-center gap-1.5 rounded-[10px] border border-ink-200 bg-white px-3.5 ${wide ? "w-[160px]" : "w-full"}`}
            >
              <Ionicons name="calendar-outline" size={16} color="#2563EB" />
              <Text className="text-[13px] font-semibold text-ink-900">View timetable</Text>
            </Pressable>
          </View>

          <Text className="text-[17px] font-bold text-ink-900">Exam sessions</Text>
          <Text className="mt-0.5 text-[12px] text-ink-500">Select an examination to view the report card</Text>

          {!sessions.length ? (
            <View className="mt-4 items-center rounded-[14px] border border-ink-200 bg-white px-4 py-6">
              <Text className="text-center text-[14px] font-semibold text-ink-900">No exam sessions yet</Text>
              <Text className="mt-1 max-w-md text-center text-[12px] leading-4 text-ink-600">
                When the school schedules examinations for this class, they will appear here.
              </Text>
            </View>
          ) : (
            <View
              className="parent-exam-session-grid mt-4"
              style={Platform.OS === "web" ? undefined : { flexDirection: "row", flexWrap: "wrap", gap: 14 }}
            >
              {sessions.map((session, index) => {
                const tone = sittingTone(session.name, index);
                const badge = statusStyle(session);
                return (
                  <Pressable
                    key={session.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${session.name} ${badge.label}`}
                    onPress={() => setSelectedExamId(session.id)}
                    className="parent-exam-session-card rounded-[14px] border bg-white p-4"
                    style={{
                      borderColor: "#E5EAF2",
                      minHeight: 188,
                      ...(Platform.OS === "web" ? {} : { minWidth: 250, maxWidth: 290, flexGrow: 0 }),
                    }}
                  >
                    <View className="flex-row items-start justify-between">
                      <View className="h-10 w-10 items-center justify-center rounded-[12px]" style={{ backgroundColor: tone.bg }}>
                        <Ionicons name={sittingIcon(session.name, session.status)} size={18} color={tone.fg} />
                      </View>
                      <View className="h-6 items-center justify-center rounded-full px-2" style={{ backgroundColor: badge.bg }}>
                        <Text className="text-[10px] font-semibold" style={{ color: badge.fg }}>
                          {badge.label}
                        </Text>
                      </View>
                    </View>
                    <Text className="mt-3 text-[16px] font-bold text-ink-900" numberOfLines={1}>
                      {session.name}
                    </Text>
                    {session.sessionLabel ? (
                      <Text className="mt-0.5 text-[11px] text-ink-500">{sessionYear(session.sessionLabel)}</Text>
                    ) : null}
                    <View className="mt-3 gap-1.5">
                      <View className="flex-row items-center">
                        <Ionicons name="calendar-outline" size={12} color="#94A3B8" />
                        <Text className="ml-1.5 flex-1 text-[11px] text-ink-500">{session.examLabel}</Text>
                        <Text className="text-[12px] font-medium text-ink-800">{session.examDate}</Text>
                      </View>
                      <View className="flex-row items-center">
                        <Ionicons name="document-text-outline" size={12} color="#94A3B8" />
                        <Text className="ml-1.5 flex-1 text-[11px] text-ink-500">Schedule published</Text>
                        <Text className="text-[12px] font-medium text-ink-800">{session.resultDate}</Text>
                      </View>
                    </View>
                    <View className="mt-3 flex-row items-center justify-between">
                      <Text className="text-[12px] font-semibold" style={{ color: tone.fg }}>
                        {session.status === "published" || session.status === "held" ? "View report" : "Not available"}
                      </Text>
                      <View className="parent-exam-card-arrow h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: tone.bg }}>
                        <Ionicons name="arrow-forward" size={12} color={tone.fg} />
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
