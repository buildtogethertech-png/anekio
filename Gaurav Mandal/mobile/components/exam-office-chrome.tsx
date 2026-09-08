import { type ReactNode, useMemo, useState } from "react";
import {
  Modal as RnModal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  OFFICE_SETUP_FILTERS,
  officePaperLabel,
  officePaperPulse,
  officePaperTone,
  officeExamTimeline,
  filterMentionTeachers,
} from "../lib/exam-workflow";
import { Button, CloseButton, Input } from "./ui";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const cardShadow =
  Platform.OS === "web"
    ? ({ boxShadow: "0 16px 40px rgba(16,32,51,0.18)" } as const)
    : {
        shadowColor: "#102033",
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 16,
      };

const drawerShadow =
  Platform.OS === "web"
    ? ({ boxShadow: "-8px 0 28px rgba(16,32,51,0.12)" } as const)
    : {
        shadowColor: "#102033",
        shadowOpacity: 0.16,
        shadowRadius: 18,
        shadowOffset: { width: -4, height: 0 },
        elevation: 18,
      };

export function ExamEnter({
  delay,
  children,
}: {
  delay?: 1 | 2 | 3 | 4 | 5;
  children: ReactNode;
}) {
  return (
    <View className={`anekio-enter${delay ? ` anekio-enter-${delay}` : ""}`}>
      {children}
    </View>
  );
}

export function ExamStatusPill({ status }: { status?: string | null }) {
  const tone = officePaperTone(status);
  const pulse = officePaperPulse(status);
  const dot =
    tone === "leaf"
      ? "bg-[#10B981]"
      : tone === "warn"
        ? "bg-[#F59E0B]"
        : tone === "grape"
          ? "bg-[#7C3AED]"
          : tone === "clay"
            ? "bg-clay-500"
            : "bg-ink-500";
  const wrap =
    tone === "leaf"
      ? "bg-emerald-50"
      : tone === "warn"
        ? "bg-amber-50"
        : tone === "grape"
          ? "bg-violet-50"
          : tone === "clay"
            ? "bg-[#EFF6FF]"
            : "bg-slate-100";
  const text =
    tone === "leaf"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-800"
        : tone === "grape"
          ? "text-violet-700"
          : tone === "clay"
            ? "text-clay-600"
            : "text-ink-800";
  return (
    <View
      className={`anekio-pill h-6 flex-row items-center gap-1.5 rounded-full px-2.5 ${wrap}`}
    >
      <View
        className={`h-1.5 w-1.5 rounded-full ${dot} ${pulse ? "anekio-dot-pulse" : ""}`}
      />
      <Text className={`text-[10px] font-semibold ${text}`}>
        {officePaperLabel(status)}
      </Text>
    </View>
  );
}

export function ExamProgress({
  paper,
  conducted,
  entered,
  total,
}: {
  paper: boolean;
  conducted: boolean;
  entered: number;
  total: number;
}) {
  const pct = total
    ? Math.round((entered / total) * 100)
    : paper || conducted
      ? 33
      : 0;
  const fill = Math.min(
    100,
    paper && conducted ? Math.max(pct, entered ? 50 : 66) : paper ? 33 : 0,
  );
  return (
    <View className="gap-1.5">
      <Text className="text-[11px] text-ink-700">
        Paper {paper ? "✓" : "○"} · Exam {conducted ? "✓" : "○"} · Marks{" "}
        {entered}/{total || 0}
      </Text>
      <View className="h-0.5 overflow-hidden rounded-full bg-ink-100">
        <View
          className="anekio-progress-fill h-full rounded-full bg-clay-500"
          style={{ width: `${Math.max(0, Math.min(100, fill))}%` }}
        />
      </View>
    </View>
  );
}

export function ExamFilterTabs({
  value,
  counts,
  onChange,
}: {
  value: string;
  counts: Record<string, number>;
  onChange: (id: (typeof OFFICE_SETUP_FILTERS)[number][0]) => void;
}) {
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      className="grow-0"
    >
      <View className="flex-row flex-nowrap gap-2">
        {OFFICE_SETUP_FILTERS.map(([id, label]) => {
          const on = value === id;
          const n = id === "all" ? counts.all ?? 0 : counts[id] || 0;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${label} ${n}`}
              onPress={() => onChange(id)}
              className={`anekio-filter-pill h-8 flex-row items-center gap-1.5 rounded-full border px-3 ${
                on ? "anekio-filter-on border-clay-500 bg-clay-500" : "border-ink-200 bg-white"
              }`}
            >
              <Text className={`text-[12px] font-medium ${on ? "text-white" : "text-ink-900"}`}>
                {label}
              </Text>
              <View className={`h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 ${on ? "bg-white/20" : "bg-ink-50"}`}>
                <Text className={`text-[10px] font-semibold ${on ? "text-white" : "text-ink-700"}`}>{n}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function ExamPaperDots({
  paper,
  exam,
  marks,
  review,
  correction,
}: {
  paper: boolean;
  exam: boolean;
  marks: boolean;
  review: boolean;
  correction?: boolean;
}) {
  const steps = [
    { on: paper, label: "Paper" },
    { on: exam, label: "Exam" },
    { on: marks, label: "Marks" },
    { on: review, label: "Review" },
  ];
  const current = steps.findIndex((d) => !d.on);
  return (
    <View
      className="flex-row items-center gap-1.5"
      accessibilityLabel={steps.map((d) => `${d.label} ${d.on ? "done" : "pending"}`).join(", ")}
    >
      {steps.map((d, i) => (
        <View
          key={d.label}
          className={`h-2 w-2 rounded-full ${
            d.on
              ? correction && i === 3
                ? "bg-amber-500"
                : "bg-[#10B981]"
              : i === current && current >= 0
                ? "border-2 border-[#10B981] bg-white"
                : "bg-ink-200"
          }`}
        />
      ))}
    </View>
  );
}

export function ExamDrawerTabs({
  value,
  onChange,
}: {
  value: "overview" | "marks" | "activity";
  onChange: (id: "overview" | "marks" | "activity") => void;
}) {
  const tabs = [
    ["overview", "Overview"],
    ["marks", "Marks"],
    ["activity", "Activity"],
  ] as const;
  return (
    <View className="flex-row gap-1 border-b border-ink-100">
      {tabs.map(([id, label]) => {
        const on = value === id;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(id)}
            className="px-3 py-2"
          >
            <Text className={`text-sm ${on ? "font-semibold text-clay-600" : "text-ink-700"}`}>
              {label}
            </Text>
            {on ? (
              <View className="anekio-filter-ink mt-1.5 h-0.5 rounded-full bg-clay-500" />
            ) : (
              <View className="mt-1.5 h-0.5" />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function ExamEmptyFilter({ bucket }: { bucket: string }) {
  const copy =
    bucket === "correction"
      ? {
            title: "No papers need correction",
            body: "Everything is currently up to date.",
        }
      : bucket === "review"
        ? {
            title: "Nothing ready to publish",
            body: "Approve submitted marksheets first.",
          }
        : bucket === "published"
          ? {
              title: "No published papers",
              body: "Results appear here after you publish to parents.",
            }
          : bucket === "scheduled"
            ? {
                title: "No scheduled papers",
                body: "Papers still awaiting the exam day show here.",
              }
            : {
                title: "No papers found",
                body: "There are no papers in this status.",
              };
  return (
    <View className="items-center px-6 py-12">
      <Ionicons name="documents-outline" size={28} color="#94a3b8" />
      <Text className="mt-3 text-sm font-semibold text-ink-900">
        {copy.title}
      </Text>
      <Text className="mt-1 text-center text-sm text-ink-700">{copy.body}</Text>
    </View>
  );
}

export function ExamSkeleton() {
  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap gap-3">
        {[0, 1, 2].map((row) => (
          <View key={row} className="anekio-skeleton h-36 min-w-[220px] flex-1 rounded-2xl" />
        ))}
      </View>
      <View className="anekio-skeleton h-20 rounded-2xl" />
      {[0, 1, 2].map((row) => (
        <View key={row} className="anekio-skeleton h-14 rounded-xl" />
      ))}
    </View>
  );
}

export function ExamAction({
  children,
  busy,
  done,
  variant = "primary",
  disabled,
  className,
  onPress,
}: {
  children: string;
  busy?: boolean;
  done?: boolean;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
  onPress?: () => void;
}) {
  return (
    <Button
      variant={variant}
      disabled={disabled || busy}
      onPress={onPress}
      className={`anekio-btn active:translate-y-px ${className || ""}`}
    >
      {busy
        ? children.toLowerCase().includes("allow")
          ? "Allowing marks..."
          : "Working…"
        : done
          ? children.toLowerCase().includes("allow")
            ? "✓ Marks entry enabled"
            : "✓ Approved"
          : children}
    </Button>
  );
}

export function ExamConfirm({
  open,
  title,
  body,
  action,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  action: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <RnModal visible={open} transparent animationType="fade" onRequestClose={onClose} presentationStyle="overFullScreen" statusBarTranslucent>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-4" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-5" style={cardShadow}>
          <Text className="text-base font-semibold text-ink-900">{title}</Text>
          <Text className="mt-2 text-sm leading-5 text-ink-700">{body}</Text>
          <View className="mt-4 flex-row justify-end gap-2">
            <Button variant="ghost" onPress={onClose}>
              Cancel
            </Button>
            <ExamAction busy={busy} onPress={onConfirm}>
              {action}
            </ExamAction>
          </View>
        </Pressable>
      </Pressable>
    </RnModal>
  );
}

export function ExamReturnNote({
  open,
  note,
  busy,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  note: string;
  busy?: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  return (
    <RnModal visible={open} transparent animationType="fade" onRequestClose={onClose} presentationStyle="overFullScreen" statusBarTranslucent>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-4" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-5" style={cardShadow}>
          <Text className="text-base font-semibold text-ink-900">
            Return marks for correction
          </Text>
          <Text className="mt-2 text-sm text-ink-700">Add a note for the teacher.</Text>
          <Input
            value={note}
            onChangeText={onChange}
            placeholder="Please check Rahul's marks."
            className="mt-3"
          />
          <View className="mt-4 flex-row justify-end gap-2">
            <Button variant="ghost" onPress={onClose}>
              Cancel
            </Button>
            <ExamAction busy={busy} disabled={!note.trim()} onPress={onSubmit}>
              Return to teacher
            </ExamAction>
          </View>
        </Pressable>
      </Pressable>
    </RnModal>
  );
}

export function ExamTeacherMention({
  subject,
  people,
  granted,
  primaryId,
  canEdit,
  busy,
  onGrant,
  onRemove,
}: {
  subject: string;
  people: { id: string; name: string }[];
  granted: { id: string; name: string }[];
  primaryId?: string | null;
  canEdit: boolean;
  busy?: boolean;
  onGrant: (teacherId: string) => void;
  onRemove: (teacherId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(
    () => filterMentionTeachers(query, people, granted.map((person) => person.id)),
    [granted, people, query]
  );
  return (
    <View className="gap-2">
      <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-700">Teachers</Text>
      <Text className="text-[11px] text-ink-500">
        Subject teacher plus other {subject} teachers who can enter marks.
      </Text>
      {granted.length ? (
        <View className="flex-row flex-wrap gap-1.5">
          {granted.map((person) => (
            <View
              key={person.id}
              className="h-8 flex-row items-center rounded-full border border-ink-200 bg-white px-2.5"
            >
              <Text className="text-[12px] font-semibold text-clay-500">@{person.name}</Text>
              {person.id === primaryId ? (
                <Text className="ml-1 text-[10px] text-ink-500">primary</Text>
              ) : (
                <Text className="ml-1 text-[10px] text-ink-500">marks</Text>
              )}
              {canEdit ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${person.name}`}
                  disabled={busy}
                  onPress={() => onRemove(person.id)}
                  className="ml-1"
                >
                  <Ionicons name="close" size={12} color="#64748B" />
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text className="text-sm text-ink-700">No teacher has marks entry yet.</Text>
      )}
      {canEdit ? (
        <View>
          <Input
            accessibilityLabel={`Add ${subject} teacher`}
            value={query}
            onChangeText={(value) => {
              setQuery(value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={`@ Add a ${subject} teacher`}
            editable={!busy}
          />
          {open && matches.length ? (
            <View className="mt-1 overflow-hidden rounded-lg border border-ink-200 bg-white">
              {matches.map((person) => (
                <Pressable
                  key={person.id}
                  accessibilityRole="button"
                  onPress={() => {
                    onGrant(person.id);
                    setQuery("");
                    setOpen(false);
                  }}
                  className="flex-row items-center border-b border-ink-100 px-3 py-2.5 last:border-b-0"
                >
                  <Text className="text-[13px] font-semibold text-clay-500">@{person.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {open && query && !matches.length ? (
            <Text className="mt-1 text-[11px] text-ink-500">
              Only teachers of {subject} can be added. Assign them on Routine first.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function ExamTimeline({
  paper,
  paperHint,
  scheduled,
  scheduledHint,
  conducted,
  conductedHint,
  marksGranted,
  marksGrantedHint,
  marksDone,
  marksHint,
  submitted,
  submittedHint,
  approved,
  approvedHint,
  published,
  publishedHint,
}: {
  paper: boolean;
  paperHint?: string;
  scheduled?: boolean;
  scheduledHint?: string;
  conducted: boolean;
  conductedHint?: string;
  marksGranted?: boolean;
  marksGrantedHint?: string;
  marksDone: boolean;
  marksHint?: string;
  submitted: boolean;
  submittedHint?: string;
  approved: boolean;
  approvedHint?: string;
  published: boolean;
  publishedHint?: string;
}) {
  const hints: Record<string, string | undefined> = {
    scheduled: scheduledHint,
    paper: paperHint,
    conducted: conductedHint,
    granted: marksGrantedHint,
    marks: marksHint,
    submitted: submittedHint,
    approved: approvedHint,
    published: publishedHint,
  };
  const steps = officeExamTimeline({
    scheduled: Boolean(scheduled),
    paper,
    conducted,
    marksGranted: Boolean(marksGranted),
    marksDone,
    submitted,
    approved,
    published,
  }).map((row) => ({ ...row, hint: hints[row.key] }));
  return (
    <View>
      {steps.map((row, i) => (
        <View key={row.label} className="flex-row gap-3">
          <View className="items-center">
            <View
              className={`h-[22px] w-[22px] items-center justify-center rounded-full ${
                row.kind === "done"
                  ? "bg-[#10B981] anekio-check"
                  : row.kind === "now"
                    ? "border-2 border-[#10B981] bg-white anekio-dot-pulse"
                    : "border border-ink-200 bg-white"
              }`}
            >
              {row.kind === "done" ? (
                <Ionicons name="checkmark" size={12} color="#fff" />
              ) : null}
            </View>
            {i < steps.length - 1 ? (
              <View
                className="my-1 w-0.5 flex-1 bg-ink-200"
                style={{ minHeight: 16 }}
              />
            ) : null}
          </View>
          <View className="min-w-0 flex-1 pb-3">
            <Text
              className={`text-[13px] font-medium ${row.kind === "wait" ? "text-ink-500" : "text-ink-900"}`}
            >
              {row.label}
            </Text>
            <Text className="mt-0.5 text-[11px] text-ink-500">
              {row.hint || (row.kind === "wait" ? "Pending" : "")}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function ExamDrawer({
  open,
  onClose,
  children,
  docked,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  docked?: boolean;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const phone = width < 768;
  const panel = Math.min(360, Math.max(320, Math.round(width * 0.24)));
  if (docked && !phone) {
    if (!open) return null;
    return (
      <View
        className="h-full shrink-0 border-l border-ink-200 bg-white"
        style={[{ width: panel }, drawerShadow]}
      >
        <View className="flex-row items-center justify-end px-3 pt-3">
          <Pressable
            accessibilityLabel="Close"
            onPress={onClose}
            className="anekio-icon-btn h-8 w-8 items-center justify-center rounded-full"
          >
            <Ionicons name="close" size={18} color="#64748B" />
          </Pressable>
        </View>
        <ScrollView className="flex-1" contentContainerClassName="px-5 pb-8" keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    );
  }
  return (
    <RnModal visible={open} transparent animationType={phone ? "slide" : "fade"} onRequestClose={onClose} presentationStyle="overFullScreen" statusBarTranslucent>
      <View className={phone ? "flex-1 bg-white" : "flex-1 flex-row bg-black/40"}>
        {phone ? null : <Pressable className="flex-1" onPress={onClose} />}
        <View
          className="flex-1 bg-white"
          style={
            phone
              ? { paddingTop: insets.top, paddingBottom: insets.bottom }
              : [
                  {
                    width: panel,
                    maxWidth: width,
                    flexGrow: 0,
                    flexShrink: 0,
                    paddingTop: insets.top,
                    borderTopLeftRadius: 20,
                    borderBottomLeftRadius: 20,
                  },
                  drawerShadow,
                ]
          }
        >
          <View className="flex-row items-center justify-end border-b border-ink-100 px-4 py-3">
            <CloseButton onPress={onClose} />
          </View>
          <ScrollView className="flex-1" contentContainerClassName="px-5 pb-8 pt-2" keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </RnModal>
  );
}
