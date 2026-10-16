import { useEffect, useState, type ReactNode } from "react";
import { Image, KeyboardAvoidingView, Linking, Modal as RnModal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Dropdown } from "./form";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Switch, Toast, useToast } from "./ui";
import { LeaveCreditFields, LeaveYearStart, leaveCreditSummary } from "./leave-credit";
import { LeaveBalancesSheet } from "./leave-balances";
import { DateField } from "./date-field";
import { UploadCsvPanel } from "./upload-csv-panel";
import { DocumentStudio } from "./document-studio";
import { ClockForm, SchoolSubjectsForm } from "./school-setup";
import { useAssetUrl } from "../lib/assets";
import { act } from "../lib/mutate";
import { webOrigin } from "../lib/api";
import { useRecord, type AdmissionFormField, type RecordPayload } from "../lib/record";
import { useSession } from "../lib/session";
import { pickFile, uploadFile } from "../lib/upload";
import { cloneFields, FormBuilderModal } from "./form-builder";

/** Mirrors LOCKED_ADMISSION_FIELD_IDS on the server: every admission needs these. */
const LOCKED_ADMISSION_FIELDS = ["studentName", "classWanted", "guardianName", "phone"];
/** Student admission also locks the billing month (mirrors LOCKED_STUDENT_ADMISSION_FIELD_IDS). */
const LOCKED_STUDENT_ADMISSION_FIELDS = [...LOCKED_ADMISSION_FIELDS, "billingStartPeriod"];

const TABS = [
  { id: "identity", label: "Identity & brand assets", hint: "Name, address, logo, signatures, and stamps", group: "School Setup" },
  { id: "sessions", label: "Sessions", hint: "Academic years and current session", group: "School Setup" },
  { id: "classes", label: "Classes", hint: "Sections and class strength", group: "School Setup" },
  { id: "clock", label: "Clock", hint: "School days and bell times. Set once.", group: "School Setup" },
  { id: "calendar", label: "Calendar", hint: "Holidays exam papers skip. Weekly offs are on Clock.", group: "School Setup" },
  { id: "subjects", label: "Subjects", hint: "What the school teaches. Add at the start.", group: "Academics" },
  { id: "exams", label: "Exams", hint: "Grade scale and this year's sittings. Every class follows this.", group: "Academics" },
  { id: "leave", label: "Leave", hint: "Planned and sick. Who can use them, and how much notice.", group: "Staff & Leave" },
  { id: "feeClasses", label: "Class fees", hint: "Monthly and admission fee for each class", group: "Fees" },
  { id: "feeAddons", label: "Add-ons", hint: "Optional charges like transport or meals", group: "Fees" },
  { id: "feeLate", label: "Late fee & due date", hint: "When fees are due and the late charge", group: "Fees" },
  { id: "collect", label: "Payment methods", hint: "UPI, bank, gateway", group: "Fees" },
  { id: "documents", label: "Document Studio", hint: "Design printable PDFs. Fee amounts stay in Fees.", group: "Documents" },
  { id: "forms", label: "Forms & Templates", hint: "Configure reusable student and staff forms", group: "Admissions" },
  { id: "website", label: "School website", hint: "Public school page, admissions, enquiry form, and incoming leads", group: "Admissions" },
] as const;

type Tab = (typeof TABS)[number]["id"];
/** Fee structure pages live in the Fees setup screen; Settings links straight to the right pane. */
const FEE_SETUP_PANE: Partial<Record<Tab, string>> = { feeClasses: "class", feeAddons: "other", feeLate: "late" };
type Door = (typeof TABS)[number]["group"];
type Level = "doors" | "group" | "page";

const TAB_GROUPS = ["School Setup", "Academics", "Staff & Leave", "Fees", "Documents", "Admissions"] as const;

const DOOR_LEDE: Record<Door, string> = {
  "School Setup": "Identity, sessions, classes, calendar, and days.",
  Academics: "Subjects and this year's exams.",
  "Staff & Leave": "Leave rules for teachers, staff, and students.",
  Fees: "Fee structure, add-ons, late fee, and how parents pay.",
  Documents: "Design report cards, IDs, receipts, certificates, and letters.",
  Admissions: "Admissions website and incoming enquiries.",
};

const PAY_GATEWAYS = [
  { id: "NONE", label: "None", hint: "Cash, UPI, and bank only" },
  { id: "RAZORPAY", label: "Razorpay", hint: "School's own Razorpay account" },
  { id: "CASHFREE", label: "Cashfree", hint: "School's own Cashfree account" },
  { id: "BILLDESK", label: "BillDesk", hint: "School's own BillDesk merchant" },
] as const;

const DEFAULT_GRADE_BANDS = [
  { min: 91, grade: "A1" },
  { min: 81, grade: "A2" },
  { min: 71, grade: "B1" },
  { min: 61, grade: "B2" },
  { min: 51, grade: "C1" },
  { min: 41, grade: "C2" },
  { min: 33, grade: "D" },
  { min: 0, grade: "E" },
];

const DEFAULT_EXAM_PLAN = [
  { id: "unit1", name: "Unit Test 1", kind: "unit", weight: 10, maxMarks: 40, expectedPeriod: "July" },
  { id: "term1", name: "Term 1", kind: "term1", weight: 30, maxMarks: 80, expectedPeriod: "September" },
  { id: "unit2", name: "Unit Test 2", kind: "unit", weight: 10, maxMarks: 40, expectedPeriod: "November" },
  { id: "term2", name: "Term 2", kind: "term2", weight: 50, maxMarks: 80, expectedPeriod: "March" },
];

const EXAM_PERIOD_OPTIONS = [
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
  "March",
] as const;

const EXAM_PERIOD_SELECT_OPTIONS = EXAM_PERIOD_OPTIONS.map((month) => ({ id: month, label: month }));

const SAMPLE_CSV = "date,name\n2026-08-15,Independence Day\n2026-10-02,Gandhi Jayanti\n2026-10-20,Dussehra\n2026-11-08,Diwali\n2026-12-25,Christmas\n";

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function prettyDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  if (!y) return value;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function prettyDay(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  if (!y) return value;
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function nextSessionDates(endsOn: string) {
  const [y, m, d] = (endsOn || "2026-03-31").split("-").map(Number);
  const start = new Date(y, (m || 1) - 1, (d || 1) + 1);
  const close = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
  return { startsOn: ymd(start), endsOn: ymd(close) };
}

function inr(n: number) {
  return `₹${n.toLocaleString("en-IN")}`;
}

function listLines(value: string) {
  return value.split(/\n|,/).map((line) => line.trim()).filter(Boolean).slice(0, 6);
}

function AssetImage({ path, className }: { path?: string | null; className: string }) {
  const uri = useAssetUrl(path);
  if (!uri) return null;
  return <Image source={{ uri }} className={className} resizeMode="contain" />;
}

function Half({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  return <View className={width < 640 ? "w-full min-w-full" : "min-w-[45%] flex-1"}>{children}</View>;
}

function SchoolDoors({ onOpen }: { onOpen: (group: Door) => void }) {
  const { width } = useWindowDimensions();
  const stack = width < 640;
  return (
    <View className="flex-row flex-wrap gap-3">
      {TAB_GROUPS.map((group) => {
        const items = TABS.filter((item) => item.group === group);
        return (
          <Pressable
            key={group}
            onPress={() => onOpen(group)}
            className={`min-h-[132px] justify-between rounded-lg border border-ink-200 bg-white p-5 ${
              stack ? "w-full min-w-full" : "min-w-[45%] flex-1"
            }`}
          >
            <View>
              <View className="flex-row items-center justify-between gap-2">
                <Text className="text-lg font-semibold text-ink-900">{group}</Text>
                <Ionicons name="chevron-forward" size={18} color="#3d4f66" />
              </View>
              <Text className="mt-1 text-sm text-ink-700">{DOOR_LEDE[group]}</Text>
            </View>
            <Text className="mt-6 text-xs text-ink-700">{items.map((item) => item.label).join(" · ")}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const TAB_ICONS: Record<Tab, { icon: keyof typeof Ionicons.glyphMap; tone: string }> = {
  identity: { icon: "school-outline", tone: "#1F45C7" },
  sessions: { icon: "calendar-number-outline", tone: "#7c3aed" },
  classes: { icon: "people-outline", tone: "#0891b2" },
  clock: { icon: "time-outline", tone: "#d97706" },
  calendar: { icon: "calendar-outline", tone: "#dc2626" },
  subjects: { icon: "book-outline", tone: "#16a34a" },
  exams: { icon: "clipboard-outline", tone: "#9333ea" },
  leave: { icon: "airplane-outline", tone: "#0284c7" },
  collect: { icon: "wallet-outline", tone: "#059669" },
  feeClasses: { icon: "cash-outline", tone: "#059669" },
  feeAddons: { icon: "add-circle-outline", tone: "#0d9488" },
  feeLate: { icon: "alarm-outline", tone: "#d97706" },
  documents: { icon: "document-text-outline", tone: "#4f46e5" },
  forms: { icon: "list-outline", tone: "#db2777" },
  website: { icon: "globe-outline", tone: "#0f766e" },
};

const PHONE_SECTIONS: { title: string; groups: Door[] }[] = [
  { title: "School", groups: ["School Setup"] },
  { title: "Academics", groups: ["Academics"] },
  { title: "People", groups: ["Staff & Leave"] },
  { title: "Money", groups: ["Fees"] },
  { title: "Documents & admissions", groups: ["Documents", "Admissions"] },
];

function PhoneSettingsList({
  status,
  setup,
  onOpen,
  onSetup,
}: {
  status: Partial<Record<Tab, { text: string; warn?: boolean }>>;
  setup?: { percent: number; left: number } | null;
  onOpen: (id: Tab) => void;
  onSetup: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q
    ? TABS.filter((item) => `${item.label} ${item.hint} ${item.group}`.toLowerCase().includes(q))
    : [];
  const row = (item: (typeof TABS)[number], i: number) => {
    const meta = TAB_ICONS[item.id];
    const st = status[item.id];
    return (
      <Pressable
        key={item.id}
        accessibilityRole="button"
        onPress={() => onOpen(item.id)}
        className={`flex-row items-center gap-3 px-3 py-3 active:bg-slate-50 ${i ? "border-t border-ink-100" : ""}`}
        style={{ minHeight: 52 }}
      >
        <View className="h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: `${meta.tone}1A` }}>
          <Ionicons name={meta.icon} size={17} color={meta.tone} />
        </View>
        <Text className="min-w-0 flex-1 text-[15px] text-ink-900" numberOfLines={1}>
          {item.label}
        </Text>
        {st?.text ? (
          <Text className={`max-w-[45%] text-sm ${st.warn ? "font-medium text-amber-700" : "text-ink-500"}`} numberOfLines={1}>
            {st.text}
          </Text>
        ) : null}
        <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
      </Pressable>
    );
  };
  return (
    <View className="gap-4 pb-28">
      <View className="flex-row items-center rounded-xl border border-ink-200 bg-white pl-3">
        <Ionicons name="search-outline" size={16} color="#94a3b8" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search settings"
          placeholderTextColor="#94a3b8"
          className="min-w-0 flex-1 px-2 py-2.5 text-sm text-ink-900"
          style={{ includeFontPadding: false }}
        />
        {query ? (
          <Pressable hitSlop={8} onPress={() => setQuery("")} className="pr-3">
            <Ionicons name="close-circle" size={16} color="#94a3b8" />
          </Pressable>
        ) : null}
      </View>
      {q ? (
        matches.length ? (
          <View className="overflow-hidden rounded-xl border border-ink-100 bg-white">{matches.map(row)}</View>
        ) : (
          <Text className="px-1 text-sm text-ink-500">No setting matches “{query}”.</Text>
        )
      ) : (
        <>
          {setup ? (
            <Pressable accessibilityRole="button" onPress={onSetup} className="rounded-xl bg-[#1F45C7] px-4 py-3.5">
              <View className="flex-row items-center gap-2">
                <Ionicons name="rocket-outline" size={18} color="#fff" />
                <Text className="flex-1 text-[15px] font-semibold text-white">
                  Setup {setup.percent}% · {setup.left} {setup.left === 1 ? "step" : "steps"} left
                </Text>
                <Ionicons name="chevron-forward" size={16} color="#fff" />
              </View>
              <View className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/25">
                <View className="h-full rounded-full bg-white" style={{ width: `${setup.percent}%` }} />
              </View>
            </Pressable>
          ) : null}
          {PHONE_SECTIONS.map((section) => {
            const items = TABS.filter((item) => section.groups.includes(item.group));
            return (
              <View key={section.title}>
                <Text className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-ink-500">{section.title}</Text>
                <View className="overflow-hidden rounded-xl border border-ink-100 bg-white">{items.map(row)}</View>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

type GradeBand = { min: number; grade: string };

function NumStepper({ value, onChange, suffix, max = 99, disabled }: { value: string; onChange: (v: string) => void; suffix?: string; max?: number; disabled?: boolean }) {
  const n = Number(value) || 0;
  const btn = (icon: "remove" | "add", next: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={icon === "add" ? "Increase" : "Decrease"}
      disabled={disabled || next < 0 || next > max}
      onPress={() => onChange(String(next))}
      className={`h-9 w-9 items-center justify-center rounded-full bg-ink-100 ${disabled || next < 0 || next > max ? "opacity-40" : ""}`}
    >
      <Ionicons name={icon} size={18} color="#1F45C7" />
    </Pressable>
  );
  return (
    <View className="flex-row items-center gap-2">
      {btn("remove", n - 1)}
      <View className="min-w-[44px] flex-row items-baseline justify-center">
        <TextInput
          value={value}
          editable={!disabled}
          keyboardType="number-pad"
          onChangeText={(v) => onChange(v.replace(/\D/g, "").slice(0, 3))}
          className="min-w-[24px] text-center text-base font-bold text-ink-900"
          style={{ includeFontPadding: false }}
        />
        {suffix ? <Text className="text-sm font-semibold text-ink-500">{suffix}</Text> : null}
      </View>
      {btn("add", n + 1)}
    </View>
  );
}

const BAND_TONES = ["#16a34a", "#22c55e", "#2563eb", "#3b82f6", "#d97706", "#f59e0b", "#ea580c", "#dc2626", "#7f1d1d"];

function PhoneExamSettings(props: {
  canEdit: boolean;
  passPercent: string;
  setPassPercent: (v: string) => void;
  showRank: boolean;
  setShowRank: (v: boolean) => void;
  bands: GradeBand[];
  setBands: (v: GradeBand[]) => void;
  paidMonths: string;
  setPaidMonths: (v: string) => void;
  unpaidMonths: string;
  setUnpaidMonths: (v: string) => void;
  admitMonths: string;
  setAdmitMonths: (v: string) => void;
  saved: { passPercent: string; showRank: boolean; bands: string; paid: string; unpaid: string; admit: string; plan: string };
  plan: ExamPlanDraft[];
  setPlan: (v: ExamPlanDraft[]) => void;
  sessionLabel: string;
  weight: number;
  planChecks: { ok: boolean; label: string }[];
  planComplete: boolean;
  onSave: (policyDirty: boolean, planDirty: boolean) => Promise<void>;
}) {
  const { bands, setBands, plan, setPlan, canEdit } = props;
  const [bandAt, setBandAt] = useState<number | null>(null);
  const [examAt, setExamAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const sorted = bands.map((b, i) => ({ ...b, i })).sort((a, b) => b.min - a.min);
  const rangeOf = (i: number) => {
    const pos = sorted.findIndex((row) => row.i === i);
    const top = pos > 0 ? sorted[pos - 1].min - 1 : 100;
    return `${bands[i].min}–${Math.max(bands[i].min, top)}%`;
  };
  const toneOf = (i: number) => BAND_TONES[Math.min(BAND_TONES.length - 1, sorted.findIndex((row) => row.i === i))];
  const policyDirty =
    props.passPercent !== props.saved.passPercent ||
    props.showRank !== props.saved.showRank ||
    JSON.stringify(bands) !== props.saved.bands ||
    props.paidMonths !== props.saved.paid ||
    props.unpaidMonths !== props.saved.unpaid ||
    props.admitMonths !== props.saved.admit;
  const planDirty = JSON.stringify(plan) !== props.saved.plan;
  const dirty = policyDirty || planDirty;
  const planBlocked = planDirty && !props.planComplete;

  const section = (title: string, children: ReactNode, aside?: ReactNode) => (
    <View>
      <View className="mb-1.5 flex-row items-center justify-between px-1">
        <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">{title}</Text>
        {aside}
      </View>
      <View className="overflow-hidden rounded-xl border border-ink-100 bg-white">{children}</View>
    </View>
  );

  const ruleRow = (label: string, value: string, set: (v: string) => void, onText: (n: number) => string, first?: boolean) => {
    const n = Number(value) || 0;
    return (
      <View className={`gap-2 px-3 py-3 ${first ? "" : "border-t border-ink-100"}`}>
        <View className="flex-row items-center gap-3">
          <Text className="flex-1 text-[15px] font-medium text-ink-900">{label}</Text>
          <NumStepper value={value} onChange={set} suffix=" mo" max={12} disabled={!canEdit} />
        </View>
        <Text className={`text-xs ${n ? "text-amber-700" : "text-ink-500"}`}>{n ? onText(n) : "Off · every family gets it"}</Text>
      </View>
    );
  };

  const band = bandAt !== null ? bands[bandAt] : null;
  const exam = examAt !== null ? plan[examAt] : null;

  return (
    <View className="gap-5 pb-28">
      {section(
        "Pass & rank",
        <>
          <View className="flex-row items-center gap-3 px-3 py-3">
            <Text className="flex-1 text-[15px] font-medium text-ink-900">Pass mark</Text>
            <NumStepper value={props.passPercent} onChange={props.setPassPercent} suffix="%" max={100} disabled={!canEdit} />
          </View>
          <View className="flex-row items-center gap-3 border-t border-ink-100 px-3 py-3">
            <View className="flex-1">
              <Text className="text-[15px] font-medium text-ink-900">Show class rank</Text>
              <Text className="text-xs text-ink-500">On report cards</Text>
            </View>
            <Switch on={props.showRank} disabled={!canEdit} onPress={() => props.setShowRank(!props.showRank)} />
          </View>
        </>
      )}

      {section(
        "Grade scale",
        <>
          <View className="flex-row overflow-hidden px-3 pt-3">
            {[...sorted].reverse().map((row, k, arr) => {
              const nextMin = k < arr.length - 1 ? arr[k + 1].min : 101;
              const span = Math.max(1, nextMin - row.min);
              return <View key={row.i} style={{ flex: span, backgroundColor: toneOf(row.i), height: 8 }} />;
            })}
          </View>
          {sorted.map((row, k) => (
            <Pressable
              key={row.i}
              accessibilityRole="button"
              disabled={!canEdit}
              onPress={() => setBandAt(row.i)}
              className={`flex-row items-center gap-3 px-3 py-2.5 ${k ? "border-t border-ink-100" : "mt-2"}`}
            >
              <View className="h-8 min-w-[40px] items-center justify-center rounded-lg px-2" style={{ backgroundColor: `${toneOf(row.i)}22` }}>
                <Text className="text-sm font-bold" style={{ color: toneOf(row.i) }}>
                  {row.grade || "—"}
                </Text>
              </View>
              <Text className="flex-1 text-[15px] text-ink-800">{rangeOf(row.i)}</Text>
              {canEdit ? <Ionicons name="chevron-forward" size={16} color="#cbd5e1" /> : null}
            </Pressable>
          ))}
          {canEdit ? (
            <View className="flex-row items-center justify-between border-t border-dashed border-ink-200 px-3 py-3">
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setBands([...bands, { min: 0, grade: "" }]);
                  setBandAt(bands.length);
                }}
                className="flex-row items-center gap-1"
              >
                <Ionicons name="add" size={17} color="#1F45C7" />
                <Text className="text-sm font-semibold text-[#1F45C7]">Add grade</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setBands(DEFAULT_GRADE_BANDS)}>
                <Text className="text-sm text-ink-500">Reset to CBSE scale</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}

      {section(
        "Results & dues",
        <>
          {ruleRow("Report card", props.paidMonths, props.setPaidMonths, (n) => `Only families who have paid ${n}+ month${n === 1 ? "" : "s"} get it`, true)}
          {ruleRow("Results", props.unpaidMonths, props.setUnpaidMonths, (n) => `Held for families with ${n}+ unpaid month${n === 1 ? "" : "s"}`)}
          {ruleRow("Admit card", props.admitMonths, props.setAdmitMonths, (n) => `Blocked for students with ${n}+ unpaid month${n === 1 ? "" : "s"}`)}
        </>
      )}

      {section(
        `Exams this year${props.sessionLabel ? ` · ${props.sessionLabel}` : ""}`,
        <>
          {plan.map((row, i) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              disabled={!canEdit}
              onPress={() => setExamAt(i)}
              className={`flex-row items-center gap-3 px-3 py-3 ${i ? "border-t border-ink-100" : ""}`}
            >
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-semibold text-ink-900" numberOfLines={1}>
                  {row.name || "Untitled exam"}
                </Text>
                <Text className="text-xs text-ink-500">
                  {row.expectedPeriod || "No month"} · out of {row.maxMarks}
                </Text>
              </View>
              <Text className="text-sm font-semibold text-ink-700">{row.weight}%</Text>
              {canEdit ? <Ionicons name="chevron-forward" size={16} color="#cbd5e1" /> : null}
            </Pressable>
          ))}
          {canEdit ? (
            <View className="flex-row items-center justify-between border-t border-dashed border-ink-200 px-3 py-3">
              <Pressable
                accessibilityRole="button"
                disabled={plan.length >= 20}
                onPress={() => {
                  setPlan([...plan, { id: `sitting-${Date.now()}`, name: `Sitting ${plan.length + 1}`, kind: "custom", weight: 0, maxMarks: 80, expectedPeriod: "" }]);
                  setExamAt(plan.length);
                }}
                className="flex-row items-center gap-1"
              >
                <Ionicons name="add" size={17} color="#1F45C7" />
                <Text className="text-sm font-semibold text-[#1F45C7]">Add exam</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setPlan(normalizeExamPlan())}>
                <Text className="text-sm text-ink-500">CBSE-style year</Text>
              </Pressable>
            </View>
          ) : null}
        </>,
        <Text className={`text-xs font-semibold ${props.weight === 100 ? "text-emerald-600" : "text-amber-700"}`}>Weight {props.weight}/100%</Text>
      )}
      {!props.planComplete ? (
        <View className="-mt-3 gap-1 px-1">
          {props.planChecks
            .filter((c) => !c.ok)
            .map((c) => (
              <View key={c.label} className="flex-row items-center gap-1.5">
                <Ionicons name="ellipse-outline" size={12} color="#b45309" />
                <Text className="text-xs text-amber-800">{c.label}</Text>
              </View>
            ))}
        </View>
      ) : null}

      {dirty && canEdit ? (
        <View
          className="absolute bottom-0 left-0 right-0 rounded-2xl border border-ink-100 bg-white px-3 pb-3 pt-3 shadow-lg"
          style={Platform.OS === "web" ? ({ position: "fixed", left: 12, right: 12, bottom: 76, zIndex: 40 } as never) : undefined}
        >
          <Pressable
            accessibilityRole="button"
            disabled={saving || planBlocked}
            onPress={async () => {
              setSaving(true);
              try {
                await props.onSave(policyDirty, planDirty);
              } finally {
                setSaving(false);
              }
            }}
            className={`h-12 items-center justify-center rounded-xl ${saving || planBlocked ? "bg-ink-200" : "bg-[#1F45C7]"}`}
          >
            <Text className="text-[15px] font-semibold text-white">
              {saving ? "Saving…" : planBlocked ? "Finish the exam list to save" : "Save changes"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <RnModal visible={Boolean(band)} transparent animationType="slide" onRequestClose={() => setBandAt(null)}>
        <View className="flex-1 justify-end">
          <Pressable className="absolute inset-0 bg-black/40" onPress={() => setBandAt(null)} />
          <View className="rounded-t-3xl bg-white px-5 pb-8 pt-3">
            <View className="mb-3 items-center">
              <View className="h-1 w-10 rounded-full bg-ink-200" />
            </View>
            {band && bandAt !== null ? (
              <View className="gap-4">
                <Text className="text-lg font-semibold text-ink-900">Grade {band.grade || ""}</Text>
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">Name</Text>
                    <TextInput
                      value={band.grade}
                      autoCapitalize="characters"
                      onChangeText={(v) => setBands(bands.map((b, j) => (j === bandAt ? { ...b, grade: v.slice(0, 4) } : b)))}
                      className="rounded-xl border border-ink-200 px-3 py-3 text-[15px] text-ink-900"
                      style={{ includeFontPadding: false }}
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">Starts at</Text>
                    <NumStepper
                      value={String(band.min)}
                      max={100}
                      suffix="%"
                      onChange={(v) => setBands(bands.map((b, j) => (j === bandAt ? { ...b, min: Math.min(100, Number(v) || 0) } : b)))}
                    />
                  </View>
                </View>
                <View className="flex-row gap-2">
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setBands(bands.filter((_, j) => j !== bandAt));
                      setBandAt(null);
                    }}
                    className="h-12 flex-1 items-center justify-center rounded-xl border border-red-200 bg-red-50"
                  >
                    <Text className="text-[15px] font-semibold text-red-700">Delete</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setBandAt(null)} className="h-12 flex-[2] items-center justify-center rounded-xl bg-[#1F45C7]">
                    <Text className="text-[15px] font-semibold text-white">Done</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </RnModal>

      <RnModal visible={Boolean(exam)} transparent animationType="slide" onRequestClose={() => setExamAt(null)}>
        <View className="flex-1 justify-end">
          <Pressable className="absolute inset-0 bg-black/40" onPress={() => setExamAt(null)} />
          <View className="rounded-t-3xl bg-white px-5 pb-8 pt-3" style={{ maxHeight: "90%" }}>
            <View className="mb-3 items-center">
              <View className="h-1 w-10 rounded-full bg-ink-200" />
            </View>
            {exam && examAt !== null ? (
              <ScrollView contentContainerStyle={{ gap: 16 }} keyboardShouldPersistTaps="handled">
                <View>
                  <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">Exam name</Text>
                  <TextInput
                    value={exam.name}
                    maxLength={80}
                    onChangeText={(v) => setPlan(plan.map((r, j) => (j === examAt ? { ...r, name: v } : r)))}
                    className="rounded-xl border border-ink-200 px-3 py-3 text-[15px] text-ink-900"
                    style={{ includeFontPadding: false }}
                  />
                </View>
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-[15px] font-medium text-ink-900">Result weight</Text>
                    <Text className="text-xs text-ink-500">Share of the final result</Text>
                  </View>
                  <NumStepper value={String(exam.weight)} max={100} suffix="%" onChange={(v) => setPlan(plan.map((r, j) => (j === examAt ? { ...r, weight: Number(v) || 0 } : r)))} />
                </View>
                <View className="flex-row items-center justify-between">
                  <Text className="text-[15px] font-medium text-ink-900">Paper out of</Text>
                  <TextInput
                    value={String(exam.maxMarks)}
                    keyboardType="number-pad"
                    onChangeText={(v) => setPlan(plan.map((r, j) => (j === examAt ? { ...r, maxMarks: Number(v.replace(/\D/g, "") || 0) } : r)))}
                    className="w-24 rounded-xl border border-ink-200 px-3 py-2.5 text-center text-[15px] font-semibold text-ink-900"
                    style={{ includeFontPadding: false }}
                  />
                </View>
                <View>
                  <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">Month</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {EXAM_PERIOD_OPTIONS.map((month) => {
                      const on = exam.expectedPeriod === month;
                      return (
                        <Pressable
                          key={month}
                          onPress={() => setPlan(plan.map((r, j) => (j === examAt ? { ...r, expectedPeriod: month } : r)))}
                          className={`rounded-full border px-3 py-1.5 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
                        >
                          <Text className={`text-sm font-medium ${on ? "text-white" : "text-ink-700"}`}>{month.slice(0, 3)}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <View className="flex-row gap-2">
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setPlan(plan.filter((_, j) => j !== examAt));
                      setExamAt(null);
                    }}
                    className="h-12 flex-1 items-center justify-center rounded-xl border border-red-200 bg-red-50"
                  >
                    <Text className="text-[15px] font-semibold text-red-700">Delete</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setExamAt(null)} className="h-12 flex-[2] items-center justify-center rounded-xl bg-[#1F45C7]">
                    <Text className="text-[15px] font-semibold text-white">Done</Text>
                  </Pressable>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </RnModal>
    </View>
  );
}

const CLASS_GRADES = ["Nursery", "LKG", "UKG", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const CLASS_SECTIONS = ["A", "B", "C", "D", "E"];

function NewClassSheet({
  open,
  classes,
  onClose,
  onCreate,
}: {
  open: boolean;
  classes: { label: string; name?: string; section?: string }[];
  onClose: () => void;
  onCreate: (name: string, section: string) => Promise<void>;
}) {
  const [grade, setGrade] = useState("");
  const [otherGrade, setOtherGrade] = useState(false);
  const [section, setSection] = useState("A");
  const [otherSection, setOtherSection] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = (name: string, sec: string) => `${name.trim()}-${sec.trim()}`.toLowerCase();
  const taken = new Set(classes.map((c) => (c.name ? key(c.name, c.section || "") : c.label.toLowerCase())));
  const gradeHas = (g: string) => classes.some((c) => (c.name || c.label.split("-")[0] || "").trim().toLowerCase() === g.toLowerCase());
  const nextFree = (g: string) => CLASS_SECTIONS.find((sec) => !taken.has(key(g, sec))) || "";

  useEffect(() => {
    if (!open) return;
    setGrade("");
    setOtherGrade(false);
    setSection("A");
    setOtherSection(false);
    setBusy(false);
  }, [open]);

  const name = grade.trim();
  const sec = section.trim().toUpperCase();
  const label = name && sec ? `${name}-${sec}` : "";
  const duplicate = Boolean(label && taken.has(key(name, sec)));
  const ready = Boolean(label) && !duplicate && !busy;

  const chip = (text: string, on: boolean, onPress: () => void, dot?: boolean) => (
    <Pressable
      key={text}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      className={`min-w-[52px] items-center rounded-xl border px-3 py-2.5 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
    >
      <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-800"}`}>{text}</Text>
      {dot ? <View className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${on ? "bg-white" : "bg-[#1F45C7]"}`} /> : null}
    </Pressable>
  );

  return (
    <RnModal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end">
        <Pressable accessibilityRole="button" accessibilityLabel="Close" className="absolute inset-0 bg-black/40" onPress={onClose} />
        <View className="rounded-t-3xl bg-white" style={{ maxHeight: "90%" }}>
          <SafeAreaView edges={["bottom"]}>
            <View className="items-center pt-2">
              <View className="h-1 w-10 rounded-full bg-ink-200" />
            </View>
            <View className="flex-row items-center px-5 pb-1 pt-3">
              <Text className="flex-1 text-lg font-semibold text-ink-900">New class</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full bg-ink-100">
                <Ionicons name="close" size={18} color="#3d4f66" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
              <View className="items-center py-3">
                <View className={`min-w-[96px] items-center rounded-2xl px-5 py-3 ${duplicate ? "bg-red-50" : label ? "bg-[#EEF3FF]" : "bg-ink-50"}`}>
                  <Text className={`text-[28px] font-bold ${duplicate ? "text-red-700" : label ? "text-[#1F45C7]" : "text-ink-300"}`}>{label || "—"}</Text>
                </View>
                <Text className={`mt-1.5 text-xs ${duplicate ? "font-semibold text-red-700" : "text-ink-500"}`}>
                  {duplicate ? `${label} already exists` : label ? "New class" : "Pick a class"}
                </Text>
              </View>

              <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">Class</Text>
              <View className="flex-row flex-wrap gap-2">
                {CLASS_GRADES.map((g) =>
                  chip(g, !otherGrade && grade === g, () => {
                    setOtherGrade(false);
                    setGrade(g);
                    if (!otherSection) {
                      const free = nextFree(g);
                      if (free) setSection(free);
                    }
                  }, gradeHas(g))
                )}
                {chip("Other", otherGrade, () => {
                  setOtherGrade(true);
                  setGrade("");
                })}
              </View>
              {otherGrade ? (
                <TextInput
                  value={grade}
                  onChangeText={setGrade}
                  autoFocus
                  placeholder="Class name, e.g. Playgroup"
                  placeholderTextColor="#94a3b8"
                  className="mt-2 rounded-xl border border-ink-200 px-3 py-3 text-sm text-ink-900"
                  style={{ includeFontPadding: false }}
                />
              ) : null}

              <Text className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-ink-500">Section</Text>
              <View className="flex-row flex-wrap gap-2">
                {CLASS_SECTIONS.map((sc) =>
                  chip(sc, !otherSection && section === sc, () => {
                    setOtherSection(false);
                    setSection(sc);
                  }, Boolean(name) && taken.has(key(name, sc)))
                )}
                {chip("Other", otherSection, () => {
                  setOtherSection(true);
                  setSection("");
                })}
              </View>
              {otherSection ? (
                <TextInput
                  value={section}
                  onChangeText={(v) => setSection(v.slice(0, 12))}
                  autoFocus
                  autoCapitalize="characters"
                  placeholder="Section, e.g. Rose"
                  placeholderTextColor="#94a3b8"
                  className="mt-2 rounded-xl border border-ink-200 px-3 py-3 text-sm text-ink-900"
                  style={{ includeFontPadding: false }}
                />
              ) : null}
              <Text className="mt-3 text-[11px] text-ink-400">● already has a class</Text>
            </ScrollView>
            <View className="border-t border-ink-100 px-5 pb-2 pt-3">
              <Pressable
                accessibilityRole="button"
                disabled={!ready}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await onCreate(name, sec);
                  } finally {
                    setBusy(false);
                  }
                }}
                className={`h-12 items-center justify-center rounded-xl ${ready ? "bg-[#1F45C7]" : "bg-ink-200"}`}
              >
                <Text className="text-[15px] font-semibold text-white">
                  {busy ? "Creating…" : label && !duplicate ? `Create ${label}` : "Create class"}
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </RnModal>
  );
}

function PhoneClassList({
  classes,
  staff,
  templates,
  sessionId,
  canAdd,
  onAdd,
  onGo,
}: {
  classes: { id: string; label: string; students?: number }[];
  staff: { kind?: string; name: string; classId?: string | null }[];
  templates: { classId: string; sessionId: string; startsPeriod?: string; lines: { amount: number; scope?: string }[] }[];
  sessionId: string;
  canAdd: boolean;
  onAdd: () => void;
  onGo: (href: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const total = classes.reduce((sum, c) => sum + (c.students || 0), 0);
  const rows = classes.map((c) => {
    const teacher = staff.find((row) => row.kind === "teacher" && row.classId === c.id)?.name || "";
    const tpl = templates
      .filter((row) => row.classId === c.id && (!sessionId || !row.sessionId || row.sessionId === sessionId))
      .sort((a, b) => (b.startsPeriod || "").localeCompare(a.startsPeriod || ""))[0];
    const monthly = (tpl?.lines ?? []).filter((line) => line.scope !== "ADD_ON").reduce((sum, line) => sum + line.amount, 0);
    return { ...c, teacher, monthly };
  });
  const open = rows.find((row) => row.id === openId) || null;
  return (
    <View className="gap-3 pb-28">
      <Text className="-mt-1 text-sm text-ink-500">
        {classes.length} {classes.length === 1 ? "class" : "classes"} · {total} {total === 1 ? "student" : "students"}
      </Text>
      <View className="overflow-hidden rounded-xl border border-ink-100 bg-white">
        {rows.map((c, i) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            onPress={() => setOpenId(c.id)}
            className={`flex-row items-center gap-3 px-3 py-3 active:bg-slate-50 ${i ? "border-t border-ink-100" : ""}`}
            style={{ minHeight: 60 }}
          >
            <View className="h-10 min-w-[44px] items-center justify-center rounded-lg bg-[#EEF3FF] px-2">
              <Text className="text-sm font-bold text-[#1F45C7]">{c.label}</Text>
            </View>
            <View className="min-w-0 flex-1">
              <Text className={`text-[15px] font-semibold ${c.students ? "text-ink-900" : "text-amber-700"}`}>
                {c.students ? `${c.students} ${c.students === 1 ? "student" : "students"}` : "No students"}
              </Text>
              <Text className="text-xs text-ink-500" numberOfLines={1}>
                {c.teacher ? `Class teacher · ${c.teacher}` : "No class teacher"}
              </Text>
            </View>
            <Text className={`text-sm ${c.monthly ? "font-medium text-ink-800" : "font-medium text-amber-700"}`}>
              {c.monthly ? `₹${c.monthly.toLocaleString("en-IN")}/mo` : "No fee"}
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
          </Pressable>
        ))}
        {!rows.length ? <Text className="px-4 py-6 text-sm text-ink-600">No classes yet. Add 1-A, 2-B, and so on.</Text> : null}
        {canAdd ? (
          <Pressable
            accessibilityRole="button"
            onPress={onAdd}
            className={`flex-row items-center justify-center gap-1.5 px-3 py-3.5 ${rows.length ? "border-t border-dashed border-ink-200" : ""}`}
          >
            <Ionicons name="add" size={18} color="#1F45C7" />
            <Text className="text-[15px] font-semibold text-[#1F45C7]">New class</Text>
          </Pressable>
        ) : null}
      </View>

      <RnModal visible={Boolean(open)} transparent animationType="slide" onRequestClose={() => setOpenId(null)}>
        <View className="flex-1 justify-end">
          <Pressable accessibilityRole="button" accessibilityLabel="Close" className="absolute inset-0 bg-black/40" onPress={() => setOpenId(null)} />
          <View className="rounded-t-3xl bg-white pb-6">
            <View className="items-center pt-2">
              <View className="h-1 w-10 rounded-full bg-ink-200" />
            </View>
            {open ? (
              <>
                <View className="flex-row items-center gap-3 px-5 pb-3 pt-3">
                  <View className="h-12 min-w-[52px] items-center justify-center rounded-xl bg-[#EEF3FF] px-2">
                    <Text className="text-base font-bold text-[#1F45C7]">{open.label}</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-lg font-semibold text-ink-900">Class {open.label}</Text>
                    <Text className="text-xs text-ink-500" numberOfLines={1}>
                      {open.students || 0} students{open.teacher ? ` · ${open.teacher}` : ""}
                    </Text>
                  </View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={() => setOpenId(null)} className="h-8 w-8 items-center justify-center rounded-full bg-ink-100">
                    <Ionicons name="close" size={18} color="#3d4f66" />
                  </Pressable>
                </View>
                <View className="mx-5 overflow-hidden rounded-xl border border-ink-100">
                  {(
                    [
                      ["people-outline", "Students", `${open.students || 0}`, "/people"],
                      ["wallet-outline", "Fees", open.monthly ? `₹${open.monthly.toLocaleString("en-IN")}/mo` : "Set up", "/fees?tab=setup"],
                      ["grid-outline", "Timetable", "", "/timetable"],
                      ["checkbox-outline", "Attendance", "", "/attendance"],
                    ] as const
                  ).map(([icon, label, meta, href], i) => (
                    <Pressable
                      key={label}
                      accessibilityRole="button"
                      onPress={() => {
                        setOpenId(null);
                        onGo(href);
                      }}
                      className={`flex-row items-center gap-3 px-3 py-3.5 active:bg-slate-50 ${i ? "border-t border-ink-100" : ""}`}
                    >
                      <Ionicons name={icon} size={19} color="#1F45C7" />
                      <Text className="flex-1 text-[15px] text-ink-900">{label}</Text>
                      {meta ? (
                        <Text className={`text-sm ${label === "Fees" && !open.monthly ? "font-medium text-amber-700" : "text-ink-500"}`}>{meta}</Text>
                      ) : null}
                      <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        </View>
      </RnModal>
    </View>
  );
}

function SchoolGroupList({ group, onPick }: { group: Door; onPick: (id: Tab) => void }) {
  const items = TABS.filter((item) => item.group === group);
  return (
    <View className="overflow-hidden rounded-lg border border-ink-200 bg-white">
      {items.map((item, i) => (
        <Pressable
          key={item.id}
          onPress={() => onPick(item.id)}
          className={`min-h-[56px] flex-row items-center gap-3 px-4 py-3 ${i ? "border-t border-ink-100" : ""}`}
        >
          <View className="min-w-0 flex-1">
            <Text className="text-base text-ink-900">{item.label}</Text>
            <Text className="mt-0.5 text-xs text-ink-700" numberOfLines={1}>
              {item.hint}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#3d4f66" />
        </Pressable>
      ))}
    </View>
  );
}

function tabFromParam(tabParam?: string) {
  if (tabParam === "invoice") return TABS.find((item) => item.id === "identity");
  return TABS.find((item) => item.id === tabParam);
}

function groupFromParam(groupParam?: string) {
  return TAB_GROUPS.find((item) => item === groupParam);
}

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function Linkish({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress}>
      <Text className={`text-xs font-medium underline ${danger ? "text-ink-700" : "text-clay-600"}`}>{label}</Text>
    </Pressable>
  );
}

function SmallToggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      className={`rounded-md border px-2.5 py-1.5 ${on ? "border-green-200 bg-green-50" : "border-ink-200 bg-white"}`}
    >
      <Text className={`text-xs font-medium ${on ? "text-green-800" : "text-ink-700"}`}>{label}</Text>
    </Pressable>
  );
}

type ExamPlanDraft = {
  id: string;
  name: string;
  kind: string;
  weight: number;
  maxMarks: number;
  expectedPeriod?: string;
};

type LeaveGender = "ANY" | "FEMALE" | "MALE";
type LeaveTypeDraft = NonNullable<RecordPayload["leaveTypes"]>[number] & { eligibilityGender: LeaveGender };

function normalizeLeaveTypes(rows?: RecordPayload["leaveTypes"]): LeaveTypeDraft[] {
  const source: (NonNullable<RecordPayload["leaveTypes"]>[number] | LeaveTypeDraft)[] = rows?.length
    ? rows
    : [
        { id: "", name: "Planned", forTeacher: true, forStaff: true, forStudent: true, eligibilityGender: "ANY", noticeDays: 1, yearlyCap: 10, sortOrder: 0 },
        { id: "", name: "Sick", forTeacher: true, forStaff: true, forStudent: true, eligibilityGender: "ANY", noticeDays: 0, yearlyCap: 8, sortOrder: 1 },
      ];
  return source.map((row) => {
    const gender = String(row.eligibilityGender || "ANY").toUpperCase();
    return {
      ...row,
      eligibilityGender: (gender === "FEMALE" || gender === "MALE" ? gender : "ANY") as LeaveGender,
    };
  });
}

function defaultExpectedPeriod(row: Pick<ExamPlanDraft, "id" | "name">) {
  const key = row.id || row.name.trim().toLowerCase();
  return DEFAULT_EXAM_PLAN.find((item) => item.id === key || item.name.toLowerCase() === key)?.expectedPeriod || "";
}

function normalizeExamPlan(rows?: ExamPlanDraft[]) {
  const source = rows?.length ? rows : DEFAULT_EXAM_PLAN;
  return source.map((row) => ({
    ...row,
    expectedPeriod: row.expectedPeriod?.trim() || defaultExpectedPeriod(row),
  }));
}

type SchoolForm = {
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  affiliation: string;
  gstin: string;
  pan: string;
  upiId: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  payGateway: string;
  payTestMode: boolean;
  razorpayKeyId: string;
  razorpayKeySecret: string;
  razorpayWebhookSecret: string;
  cashfreeAppId: string;
  cashfreeSecretKey: string;
  billdeskMerchantId: string;
  billdeskClientId: string;
  billdeskSecret: string;
  aisensyApiKey: string;
  aisensyCampaign: string;
  resendApiKey: string;
  resendFromEmail: string;
  signatory: string;
  invoiceStyle: string;
  whatsappCommunityUrl: string;
  websiteEnabled: boolean;
  websiteSlug: string;
  websiteTheme: string;
  websiteHeroTitle: string;
  websiteHeroSubtitle: string;
  websiteAbout: string;
  websiteHighlights: string;
  websiteFacilities: string;
  websiteAdmissionOpen: boolean;
  websiteAdmissionNote: string;
  admissionForm: AdmissionFormField[];
  websiteForm: AdmissionFormField[];
  staffOnboardingForm: AdmissionFormField[];
  admissionCharge: string;
  sessionStart: string;
  sessionEnd: string;
};

function schoolClassOptions(classes?: RecordPayload["classes"]) {
  return [...new Set((classes || []).map((row) => row.label || [row.name, row.section].filter(Boolean).join("-")).filter(Boolean))];
}

const WEBSITE_THEMES = [
  { id: "blue", label: "Blue", color: "#2563EB" },
  { id: "green", label: "Green", color: "#059669" },
  { id: "purple", label: "Purple", color: "#7C3AED" },
  { id: "orange", label: "Orange", color: "#EA580C" },
];

/** One collapsible block of the website editor. Closed blocks show a one-line summary. */
function WebSection({ title, summary, open, onToggle, children }: { title: string; summary: string; open?: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <View className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: Boolean(open) }} onPress={onToggle} className="flex-row items-center gap-3 px-4 py-3.5">
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold text-ink-900">{title}</Text>
          {!open ? <Text className="mt-0.5 text-xs text-ink-700" numberOfLines={1}>{summary}</Text> : null}
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color="#64748B" />
      </Pressable>
      {open ? <View className="border-t border-ink-100 px-4 pb-4 pt-3">{children}</View> : null}
    </View>
  );
}

/** One titled group on the Identity page; optional status ("⚠ Missing") and collapse. */
function IdentitySection({
  title,
  status,
  warn,
  collapsible,
  defaultOpen,
  children,
}: {
  title: string;
  status?: string;
  warn?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!collapsible || Boolean(defaultOpen));
  return (
    <View className="rounded-2xl border border-ink-200 bg-white">
      <Pressable disabled={!collapsible} onPress={() => setOpen((v) => !v)} className="flex-row items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <Text className="text-[15px] font-semibold text-ink-900">{title}</Text>
        <View className="flex-row items-center gap-1.5">
          {status ? <Text className={`text-xs font-medium ${warn && status.startsWith("⚠") ? "text-amber-700" : "text-ink-600"}`}>{status}</Text> : null}
          {collapsible ? <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color="#64748B" /> : null}
        </View>
      </Pressable>
      {open ? <View className="px-4 pb-4">{children}</View> : <View className="h-1.5" />}
    </View>
  );
}

function leaveTypeIcon(name: string): keyof typeof Ionicons.glyphMap {
  const n = name.toLowerCase();
  if (/sick|medical/.test(n)) return "medkit-outline";
  if (/casual/.test(n)) return "cafe-outline";
  if (/plan|earned|annual/.test(n)) return "airplane-outline";
  if (/matern|patern/.test(n)) return "heart-outline";
  if (/duty/.test(n)) return "briefcase-outline";
  return "calendar-outline";
}

function Stepper({ value, onChange, min = 0, max = 365 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <View className="flex-row items-center rounded-xl border border-ink-200 bg-white">
      <Pressable accessibilityLabel="Less" onPress={() => onChange(Math.max(min, value - 1))} className="h-10 w-10 items-center justify-center">
        <Ionicons name="remove" size={18} color="#1F45C7" />
      </Pressable>
      <Text className="w-9 text-center text-[15px] font-semibold text-ink-900">{value}</Text>
      <Pressable accessibilityLabel="More" onPress={() => onChange(Math.min(max, value + 1))} className="h-10 w-10 items-center justify-center">
        <Ionicons name="add" size={18} color="#1F45C7" />
      </Pressable>
    </View>
  );
}

/** Phone list of leave types: one row each, tap to edit in a bottom sheet. Saves the whole policy. */
function PhoneLeaveTypes({
  types,
  setTypes,
  canEdit,
  onSave,
  startMonth,
}: {
  startMonth: number;
  types: LeaveTypeDraft[];
  setTypes: (rows: LeaveTypeDraft[]) => void;
  canEdit: boolean;
  onSave: (rows: LeaveTypeDraft[]) => Promise<void>;
}) {
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<LeaveTypeDraft | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function open(index: number | null) {
    const base: LeaveTypeDraft =
      index === null
        ? { id: "", name: "", forTeacher: true, forStaff: true, forStudent: false, eligibilityGender: "ANY", noticeDays: 0, yearlyCap: 0, sortOrder: types.length }
        : { ...types[index] };
    setEditIndex(index);
    setDraft(base);
    setMoreOpen(base.eligibilityGender !== "ANY");
  }

  async function commit(next: LeaveTypeDraft[]) {
    setBusy(true);
    try {
      setTypes(next);
      await onSave(next);
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }

  const who = (row: LeaveTypeDraft) =>
    [row.forTeacher ? "Teachers" : "", row.forStaff ? "Staff" : "", row.forStudent ? "Students" : ""].filter(Boolean).join(" · ") || "Nobody yet";

  return (
    <View className="mt-3 gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-ink-900">Leave types</Text>
        {canEdit ? (
          <Pressable onPress={() => open(null)} className="h-9 flex-row items-center gap-1 rounded-full bg-[#1F45C7] px-3.5">
            <Ionicons name="add" size={16} color="#FFFFFF" />
            <Text className="text-[13px] font-semibold text-white">Add</Text>
          </Pressable>
        ) : null}
      </View>
      <View className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
        {types.map((row, index) => (
          <Pressable
            key={row.id || `new-${index}`}
            disabled={!canEdit}
            onPress={() => open(index)}
            className={`flex-row items-center gap-3 px-4 py-3 active:bg-ink-50 ${index ? "border-t border-ink-100" : ""}`}
          >
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#EEF3FF]">
              <Ionicons name={leaveTypeIcon(row.name)} size={19} color="#1F45C7" />
            </View>
            <View className="min-w-0 flex-1">
              <View className="flex-row items-baseline justify-between gap-2">
                <Text className="text-[15px] font-semibold text-ink-900" numberOfLines={1}>{row.name || "Untitled"}</Text>
                <Text className="text-xs text-ink-700">
                  {row.noticeDays ? `${row.noticeDays} day notice` : "same day"}
                </Text>
              </View>
              <Text className="mt-0.5 text-xs text-ink-500" numberOfLines={1}>
                {who(row)}
                {row.eligibilityGender !== "ANY" ? ` · ${row.eligibilityGender === "FEMALE" ? "Female" : "Male"} only` : ""}
              </Text>
              <Text className="mt-0.5 text-xs font-medium text-[#1F45C7]" numberOfLines={1}>
                {leaveCreditSummary(row)}
              </Text>
            </View>
            {canEdit ? <Ionicons name="chevron-forward" size={15} color="#94A3B8" /> : null}
          </Pressable>
        ))}
      </View>

      <RnModal visible={Boolean(draft)} transparent animationType="slide" onRequestClose={() => setDraft(null)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setDraft(null)}>
          <Pressable className="max-h-[92%] rounded-t-3xl bg-white px-5 pb-8 pt-3" onPress={() => {}}>
            <View className="mb-3 items-center">
              <View className="h-1 w-10 rounded-full bg-ink-200" />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {draft ? (
              <View className="gap-4">
                <Text className="text-lg font-bold text-ink-900">{editIndex === null ? "New leave type" : "Edit leave type"}</Text>
                <Field label="Name">
                  <Input value={draft.name} placeholder="e.g. Casual" onChangeText={(name) => setDraft({ ...draft, name })} className="h-12 text-[15px]" />
                </Field>
                <View>
                  <Text className="mb-2 text-xs font-medium text-ink-700">Who can apply</Text>
                  <View className="flex-row gap-2">
                    {(
                      [
                        ["forTeacher", "Teachers"],
                        ["forStaff", "Staff"],
                        ["forStudent", "Students"],
                      ] as const
                    ).map(([key, label]) => {
                      const on = draft[key];
                      return (
                        <Pressable
                          key={key}
                          onPress={() => setDraft({ ...draft, [key]: !on })}
                          className={`h-10 flex-1 flex-row items-center justify-center gap-1 rounded-xl border ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
                        >
                          {on ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                          <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-700"}`}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <LeaveCreditFields row={draft} onChange={setDraft} startMonth={startMonth} existing={editIndex !== null && Boolean(draft.id)} />
                <View className="flex-row items-center justify-between">
                  <View>
                    <Text className="text-sm font-medium text-ink-900">Notice (school days)</Text>
                    <Text className="text-[11px] text-ink-500">0 = same-day allowed</Text>
                  </View>
                  <Stepper value={draft.noticeDays} max={30} onChange={(noticeDays) => setDraft({ ...draft, noticeDays })} />
                </View>
                <Pressable onPress={() => setMoreOpen((v) => !v)} className="flex-row items-center gap-1">
                  <Text className="text-xs font-semibold text-[#1F45C7]">More options</Text>
                  <Ionicons name={moreOpen ? "chevron-up" : "chevron-down"} size={14} color="#1F45C7" />
                </Pressable>
                {moreOpen ? (
                  <View>
                    <Text className="mb-2 text-xs font-medium text-ink-700">Only for (e.g. maternity / paternity)</Text>
                    <View className="flex-row gap-2">
                      {(
                        [
                          ["ANY", "Anyone"],
                          ["FEMALE", "Female"],
                          ["MALE", "Male"],
                        ] as const
                      ).map(([gender, label]) => {
                        const on = draft.eligibilityGender === gender;
                        return (
                          <Pressable
                            key={gender}
                            onPress={() => setDraft({ ...draft, eligibilityGender: gender })}
                            className={`h-9 flex-1 items-center justify-center rounded-xl border ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                          >
                            <Text className={`text-sm ${on ? "font-semibold text-[#1F45C7]" : "text-ink-700"}`}>{label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
                <Pressable
                  disabled={busy || !draft.name.trim()}
                  onPress={() =>
                    void commit(
                      editIndex === null ? [...types, { ...draft, name: draft.name.trim() }] : types.map((row, i) => (i === editIndex ? { ...draft, name: draft.name.trim() } : row))
                    )
                  }
                  className={`h-12 items-center justify-center rounded-2xl bg-[#1F45C7] ${busy || !draft.name.trim() ? "opacity-50" : ""}`}
                >
                  <Text className="text-[15px] font-semibold text-white">{busy ? "Saving…" : "Save"}</Text>
                </Pressable>
                {editIndex !== null && types.length > 1 ? (
                  <Pressable
                    disabled={busy}
                    onPress={() => void commit(types.filter((_, i) => i !== editIndex))}
                    className="h-10 flex-row items-center justify-center gap-1.5"
                  >
                    <Ionicons name="trash-outline" size={16} color="#B91C1C" />
                    <Text className="text-sm font-semibold text-red-700">Delete leave type</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </RnModal>
    </View>
  );
}

export function SchoolBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const wide = width >= 1024;
  const phone = width < 640;
  const s = data?.school;
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[]; group?: string | string[] }>();
  const tabParam = firstParam(params.tab);
  const groupParam = firstParam(params.group);
  const linked = tabFromParam(tabParam);
  const linkedGroup = groupFromParam(groupParam);
  const [tab, setTab] = useState<Tab>(linked?.id ?? "identity");
  const [door, setDoor] = useState<Door>(linked?.group ?? linkedGroup ?? "School Setup");
  const [level, setLevel] = useState<Level>(linked ? "page" : linkedGroup ? "group" : "doors");
  const [form, setForm] = useState<SchoolForm>(blankForm(s));
  const [websiteSlugStatus, setWebsiteSlugStatus] = useState<{ slug: string; kind: "idle" | "checking" | "available" | "taken" | "invalid"; message: string }>({ slug: "", kind: "idle", message: "" });
  const [webOpen, setWebOpen] = useState<Record<string, boolean>>({ address: true, hero: true, about: true });
  const [holiday, setHoliday] = useState({ date: "", name: "" });
  const [addOpen, setAddOpen] = useState(false);
  const [classOpen, setClassOpen] = useState(false);
  const [calendarImportOpen, setCalendarImportOpen] = useState(false);
  const [classDraft, setClassDraft] = useState({ name: "", section: "A" });
  const [sessionDraft, setSessionDraft] = useState({ startsOn: "", endsOn: "", copyFromId: "", makeCurrent: true });
  const [calendarSessionId, setCalendarSessionId] = useState(s?.sessionId || "");
  const [bands, setBands] = useState(s?.policy?.bands?.length ? s.policy.bands : DEFAULT_GRADE_BANDS);
  const [passPercent, setPassPercent] = useState(String(s?.policy?.passPercent ?? 33));
  const [showRank, setShowRank] = useState(Boolean(s?.policy?.showRank));
  const [reportCardPaidMonths, setReportCardPaidMonths] = useState(String(s?.policy?.reportCardPaidMonths ?? 0));
  const [reportCardUnpaidMonths, setReportCardUnpaidMonths] = useState(String(s?.policy?.reportCardUnpaidMonths ?? 0));
  const [admitCardPendingMonths, setAdmitCardPendingMonths] = useState(String(s?.policy?.admitCardPendingMonths ?? 0));
  const [uploadingAsset, setUploadingAsset] = useState("");
  const [admissionFormOpen, setAdmissionFormOpen] = useState(false);
  const [websiteFormOpen, setWebsiteFormOpen] = useState(false);
  const [staffFormOpen, setStaffFormOpen] = useState(false);
  const [savingYearPlan, setSavingYearPlan] = useState(false);
  const [plan, setPlan] = useState<ExamPlanDraft[]>(normalizeExamPlan(s?.plan));
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeDraft[]>(normalizeLeaveTypes(data?.leaveTypes));
  const [leaveYearStart, setLeaveYearStart] = useState<number>(data?.leaveYearStartMonth || 4);
  const [creditEdit, setCreditEdit] = useState<number | null>(null);
  const [balancesOpen, setBalancesOpen] = useState(false);

  useEffect(() => {
    const nextTab = tabFromParam(tabParam);
    if (nextTab && FEE_SETUP_PANE[nextTab.id]) {
      router.replace(`/fees?tab=setup&pane=${FEE_SETUP_PANE[nextTab.id]}` as never);
      return;
    }
    if (nextTab) {
      setTab(nextTab.id);
      setDoor(nextTab.group);
      setLevel("page");
      return;
    }
    const nextGroup = groupFromParam(groupParam);
    if (nextGroup) {
      setDoor(nextGroup);
      setLevel("group");
      return;
    }
    setLevel("doors");
  }, [tabParam, groupParam]);

  useEffect(() => {
    if (!s) return;
    setForm(blankForm(s));
    setBands(s.policy?.bands?.length ? s.policy.bands : DEFAULT_GRADE_BANDS);
    setPassPercent(String(s.policy?.passPercent ?? 33));
    setShowRank(Boolean(s.policy?.showRank));
    setReportCardPaidMonths(String(s.policy?.reportCardPaidMonths ?? 0));
    setReportCardUnpaidMonths(String(s.policy?.reportCardUnpaidMonths ?? 0));
    setAdmitCardPendingMonths(String(s.policy?.admitCardPendingMonths ?? 0));
    setPlan(normalizeExamPlan(s.plan));
    setCalendarSessionId((current) => current || s.sessionId || "");
    if (data?.leaveTypes?.length) setLeaveTypes(normalizeLeaveTypes(data.leaveTypes));
    if (data?.leaveYearStartMonth) setLeaveYearStart(data.leaveYearStartMonth);
  }, [s, data?.leaveTypes, data?.leaveYearStartMonth]);

  useEffect(() => {
    if (tab !== "website" || !token) return;
    const slug = form.websiteSlug.trim();
    if (!slug) {
      setWebsiteSlugStatus({ slug, kind: "idle", message: form.websiteEnabled ? "Enter a website address to publish your school website." : "Choose an address when you are ready to publish." });
      return;
    }
    setWebsiteSlugStatus({ slug, kind: "checking", message: "Checking address…" });
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await act<{ ok: true; slug: string; available: boolean }>(token, "checkSchoolWebsiteSlug", { websiteSlug: slug });
        if (!cancelled) setWebsiteSlugStatus({ slug, kind: result.available ? "available" : "taken", message: result.available ? "This address is available." : "This address is already used by another school. Choose a different one." });
      } catch (error) {
        if (!cancelled) setWebsiteSlugStatus({ slug, kind: "invalid", message: error instanceof Error ? error.message : "Could not check this address." });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [tab, token, form.websiteSlug, form.websiteEnabled]);

  const sessions = s?.sessions ?? [];
  const calendarSession = sessions.find((row) => row.id === calendarSessionId) ?? sessions.find((row) => row.current) ?? sessions[0];
  const activeCalendarSessionId = calendarSession?.id || s?.sessionId || "";
  const sessionOptions = sessions.map((row) => ({
    id: row.id,
    label: row.current ? `${row.label} (Current)` : row.label,
    searchText: row.label,
  }));
  const holidays = s?.holidays ?? [];
  const inSession = holidays.filter((h) => {
    if ((h.sessionId || s?.sessionId || "") !== activeCalendarSessionId) return false;
    if (calendarSession?.startsOn && h.date < calendarSession.startsOn) return false;
    if (calendarSession?.endsOn && h.date > calendarSession.endsOn) return false;
    return true;
  });
  const weight = plan.reduce((n, r) => n + r.weight, 0);
  const planNames = plan.map((row) => row.name.trim().toLowerCase()).filter(Boolean);
  const planChecks = [
    { ok: plan.length > 0 && plan.length <= 20, label: "1–20 exams" },
    {
      ok: plan.length > 0 && plan.every((row) => row.name.trim()) && new Set(planNames).size === plan.length,
      label: "Exam names are filled and unique",
    },
    { ok: plan.length > 0 && plan.every((row) => row.weight > 0) && weight === 100, label: "Result weight totals 100%" },
    { ok: plan.length > 0 && plan.every((row) => row.maxMarks > 0 && row.maxMarks <= 1000), label: "Maximum marks are set" },
    { ok: plan.length > 0 && plan.every((row) => row.expectedPeriod?.trim()), label: "Expected periods are set" },
  ];
  const planChecksDone = planChecks.filter((check) => check.ok).length;
  const planComplete = planChecksDone === planChecks.length;
  const planCompletion = Math.round((planChecksDone / planChecks.length) * 100);
  const edit = can(user, "school.edit");
  const examEdit = can(user, "exams.edit") || edit;

  function patch<K extends keyof SchoolForm>(key: K, value: SchoolForm[K]) {
    setForm((row) => ({ ...row, [key]: value }));
  }

  async function saveForm(op: string, fields: AdmissionFormField[], ok: string, close: () => void) {
    try {
      await act(token, op, { fields });
      toast.show(ok);
      await reload();
      close();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not save the form.");
    }
  }

  async function run(op: string, body: Record<string, unknown>, ok: string) {
    try {
      await act(token, op, body);
      toast.show(ok);
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function saveYearPlan() {
    if (!planComplete || savingYearPlan) return;
    setSavingYearPlan(true);
    try {
      await run("saveExamPlan", { sessionId: s?.sessionId, plan }, "Year plan saved.");
    } finally {
      setSavingYearPlan(false);
    }
  }

  async function save() {
    try {
      if (tab === "website") {
        const slug = form.websiteSlug.trim();
        if (form.websiteEnabled && !slug) {
          setWebsiteSlugStatus({ slug, kind: "invalid", message: "Enter a website address before publishing." });
          return false;
        }
        if (slug) {
          const result = await act<{ ok: true; slug: string; available: boolean }>(token, "checkSchoolWebsiteSlug", { websiteSlug: slug });
          if (!result.available) {
            setWebsiteSlugStatus({ slug, kind: "taken", message: "This address is already used by another school. Choose a different one." });
            return false;
          }
        }
      }
      if (tab === "website") {
        await act(token, "saveSchoolWebsite", {
          websiteEnabled: form.websiteEnabled,
          websiteSlug: form.websiteSlug,
          websiteTheme: form.websiteTheme,
          websiteHeroTitle: form.websiteHeroTitle,
          websiteHeroSubtitle: form.websiteHeroSubtitle,
          websiteAbout: form.websiteAbout,
          websiteHighlights: form.websiteHighlights,
          websiteFacilities: form.websiteFacilities,
          websiteAdmissionOpen: form.websiteAdmissionOpen,
          websiteAdmissionNote: form.websiteAdmissionNote,
        });
      } else if (tab === "forms") {
        await act(token, "saveAdmissionForm", { fields: form.admissionForm });
        await act(token, "saveWebsiteForm", { fields: form.websiteForm });
        await act(token, "saveStaffOnboardingForm", { fields: form.staffOnboardingForm });
      } else {
        await act(token, "saveSchoolIdentity", form);
      }
      toast.show(tab === "website" ? "Website settings saved." : tab === "forms" ? "Form settings saved." : "School settings saved.");
      await reload();
      return true;
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
      return false;
    }
  }

  async function uploadBrandAsset(field: "logoPath" | "signPath" | "stampPath", label: string) {
    try {
      const file = await pickFile("image/png,image/jpeg,image/webp");
      if (!file) return;
      setUploadingAsset(field);
      const uploaded = await uploadFile(token, file, { kind: "school", asset: field });
      await act(token, "saveSchoolIdentity", { ...form, [field]: uploaded.path });
      toast.show(`${label} saved.`);
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : `Could not save ${label.toLowerCase()}.`);
    } finally {
      setUploadingAsset("");
    }
  }

  function downloadCalendarSampleCsv() {
    if (typeof document === "undefined") {
      toast.show("Download is available on web.");
      return;
    }
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "anekio-holiday-calendar-sample.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importHolidayCsv(csv: string) {
    await run("importSchoolHolidays", { pasted: csv, sessionId: activeCalendarSessionId }, "Holiday calendar imported.");
    setCalendarImportOpen(false);
  }

  async function uploadHolidayCsv() {
    try {
      const file = await pickFile(".csv,text/csv,text/plain");
      if (!file) return;
      const text = await fetch(file.uri).then((response) => response.text());
      if (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls") || text.startsWith("PK")) {
        throw new Error("Save the Excel file as CSV, then upload that.");
      }
      await importHolidayCsv(text);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not import calendar.");
    }
  }

  const hint = TABS.find((t) => t.id === tab)?.hint;
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const savedWebsite = (s as unknown as { website?: { slug?: string; enabled?: boolean } } | undefined)?.website;
  const slugIsOwn = Boolean(form.websiteSlug && savedWebsite?.slug && form.websiteSlug.trim() === savedWebsite.slug);
  const websiteDirtyHint = Boolean(savedWebsite) && Boolean(savedWebsite?.enabled) !== form.websiteEnabled;
  const showSave = tab !== "forms" && tab !== "calendar" && tab !== "exams" && tab !== "clock" && tab !== "subjects" && tab !== "sessions" && tab !== "classes" && tab !== "leave" && tab !== "documents";
  const showPreview = tab === "exams" && !phone;

  function showSchool(next: { tab?: Tab; group?: Door } = {}) {
    if (next.tab) router.replace(`/school?tab=${next.tab}` as never);
    else if (next.group) router.replace(`/school?group=${next.group}` as never);
    else router.replace("/school" as never);
  }

  function openDoor(group: Door) {
    setDoor(group);
    const items = TABS.filter((item) => item.group === group);
    if (items.length === 1) {
      setTab(items[0].id);
      setLevel("page");
      showSchool({ tab: items[0].id });
      return;
    }
    setLevel("group");
    showSchool({ group });
  }

  function openPage(id: Tab) {
    if (FEE_SETUP_PANE[id]) {
      router.push(`/fees?tab=setup&pane=${FEE_SETUP_PANE[id]}` as never);
      return;
    }
    const item = TABS.find((row) => row.id === id);
    if (item) setDoor(item.group);
    setTab(id);
    setLevel("page");
    showSchool({ tab: id });
  }

  function goBack() {
    if (phone && level === "page") {
      setLevel("doors");
      showSchool();
      return;
    }
    if (level === "page") {
      const items = TABS.filter((item) => item.group === door);
      if (items.length === 1) {
        setLevel("doors");
        showSchool();
        return;
      }
      setLevel("group");
      showSchool({ group: door });
      return;
    }
    setLevel("doors");
    showSchool();
  }

  const title = level === "doors" ? "School" : level === "group" ? door : current.label;
  const lede =
    level === "doors"
      ? "Campus, teaching, fees, and messages."
      : level === "group"
        ? DOOR_LEDE[door]
        : current.hint;
  const admissionClassOptions = schoolClassOptions(data?.classes);
  const phoneStatus: Partial<Record<Tab, { text: string; warn?: boolean }>> = (() => {
    const out: Partial<Record<Tab, { text: string; warn?: boolean }>> = {};
    const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
    out.identity = s?.name ? { text: s.name } : { text: "Not set", warn: true };
    const cur = sessions.find((row) => row.current);
    out.sessions = cur ? { text: cur.label } : { text: "Not set", warn: true };
    const classCount = data?.classes?.length ?? 0;
    out.classes = classCount ? { text: plural(classCount, "class", "classes") } : { text: "None yet", warn: true };
    const bell = (data?.timetable?.periods ?? []).filter((row) => !row.isBreak).length;
    out.clock = bell ? { text: plural(bell, "period") } : { text: "Not set", warn: true };
    out.calendar = { text: plural(inSession.length, "holiday") };
    const subjectNames = new Set((data?.timetable?.classes ?? []).flatMap((c) => (c.subjects ?? []).map((x) => x.name)));
    out.subjects = subjectNames.size ? { text: String(subjectNames.size) } : { text: "None yet", warn: true };
    out.exams = plan.length ? { text: plural(plan.length, "exam") } : { text: "Not set", warn: true };
    out.leave = leaveTypes.length ? { text: plural(leaveTypes.length, "type") } : { text: "Not set", warn: true };
    const pay = [s?.upiId ? "UPI" : "", s?.pay?.gateway && s.pay.gateway !== "NONE" ? s.pay.gateway.charAt(0) + s.pay.gateway.slice(1).toLowerCase() : ""].filter(Boolean);
    out.collect = pay.length ? { text: `Cash, ${pay.join(", ")}` } : { text: "Cash only" };
    const curSession = sessions.find((row) => row.current)?.id || s?.sessionId || "";
    const feeClassIds = new Set(
      (data?.feeTemplates ?? [])
        .filter((t) => (!curSession || !t.sessionId || t.sessionId === curSession) && (t.lines ?? []).some((l) => Number(l.amount) > 0))
        .map((t) => t.classId)
    );
    const allClasses = data?.classes ?? [];
    const setCount = allClasses.filter((c) => feeClassIds.has(c.id)).length;
    out.feeClasses = allClasses.length ? { text: `${setCount} of ${allClasses.length} set`, warn: setCount < allClasses.length } : { text: "No classes", warn: true };
    const addOns = (data?.feeCatalog?.items ?? []).filter((i) => i.active).length;
    out.feeAddons = { text: addOns ? `${addOns} item${addOns === 1 ? "" : "s"}` : "None" };
    const cat = data?.feeCatalog;
    out.feeLate = {
      text: `Due ${cat?.dueDay || 10}${cat?.late?.enabled && cat.late.amount ? ` · ₹${cat.late.amount} late` : " · no late fee"}`,
    };
    const tpl = data?.documentStudio?.templates?.length ?? 0;
    out.documents = { text: tpl ? plural(tpl, "template") : "None yet", warn: !tpl };
    out.website = form.websiteEnabled ? { text: "Live" } : { text: "Off" };
    return out;
  })();

  return (
    <View>
      {level !== "doors" ? (
        <Pressable onPress={goBack} className="mb-1 min-h-[32px] flex-row items-center gap-1">
          <Ionicons name="chevron-back" size={19} color="#1d4ed8" />
          <Text className="text-sm font-medium text-clay-600">
            {!phone && level === "page" && TABS.filter((item) => item.group === door).length > 1 ? door : "Settings"}
          </Text>
        </Pressable>
      ) : null}
      {phone && level === "doors" ? (
        <Text className="mb-3 text-[22px] font-bold tracking-tight text-ink-900">Settings</Text>
      ) : (
        <PageHeader title={title} lede={phone && level === "page" ? undefined : lede} compact />
      )}
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {level === "doors" && phone ? (
        <PhoneSettingsList
          status={phoneStatus}
          setup={
            data?.onboarding && data.onboarding.progress.percent < 100
              ? {
                  percent: data.onboarding.progress.percent,
                  left: Math.max(0, data.onboarding.progress.total - data.onboarding.progress.completed),
                }
              : null
          }
          onOpen={openPage}
          onSetup={() => router.push("/onboarding" as never)}
        />
      ) : level === "doors" ? (
        <SchoolDoors onOpen={openDoor} />
      ) : level === "group" ? (
        <SchoolGroupList group={door} onPick={openPage} />
      ) : (
      <Card
        className={phone ? "p-4" : "p-5"}
        style={phone && (tab === "classes" || tab === "exams") ? { borderWidth: 0, backgroundColor: "transparent", padding: 0 } : undefined}
      >
        <View className={wide ? "flex-row items-start gap-6" : ""}>
          <View className={wide ? "min-w-0 flex-1" : ""}>

            {tab === "documents" && data?.documentStudio ? <DocumentStudio studio={data.documentStudio} data={data} /> : null}

            {tab === "identity" ? (
              <View className="gap-4">
                {/* Live header: how the school appears on receipts, ID cards and pay pages. */}
                <View className="rounded-2xl border border-ink-200 bg-white p-4">
                  <View className="flex-row items-center gap-3">
                    <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-ink-100 bg-ink-50">
                      {s?.logoPath ? <AssetImage path={s.logoPath} className="h-12 w-12" /> : <Ionicons name="school-outline" size={24} color="#94A3B8" />}
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-base font-bold text-ink-900" numberOfLines={1}>{form.name || "Your school name"}</Text>
                      <Text className="mt-0.5 text-xs text-ink-700" numberOfLines={1}>
                        {[form.affiliation, [form.address, form.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "Board · address"}
                      </Text>
                      <Text className="text-xs text-ink-700" numberOfLines={1}>
                        {[form.phone, form.email].filter(Boolean).join(" · ") || "Phone · email"}
                      </Text>
                    </View>
                  </View>
                </View>
                <Text className="-mt-2 px-1 text-xs text-ink-600">Shown on receipts, ID cards and parent pay pages.</Text>

                <IdentitySection title="School">
                  <Field label="School name">
                    <Input value={form.name} onChangeText={(v) => patch("name", v)} />
                  </Field>
                  <Text className="mb-1.5 mt-3 text-xs font-medium text-ink-700">Board</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {["CBSE", "ICSE", "State board", "IB", "Other"].map((board) => {
                      const on = (form.affiliation || "").toLowerCase() === board.toLowerCase();
                      return (
                        <Pressable
                          key={board}
                          onPress={() => patch("affiliation", on ? "" : board)}
                          className={`h-9 justify-center rounded-full border px-3.5 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
                        >
                          <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-800"}`}>{board}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {form.affiliation && !["cbse", "icse", "state board", "ib", "other"].includes(form.affiliation.toLowerCase()) ? (
                    <Text className="mt-1.5 text-[11px] text-ink-600">Currently: {form.affiliation}</Text>
                  ) : null}
                </IdentitySection>

                <IdentitySection
                  title="Brand"
                  status={`${[s?.logoPath, s?.signPath, s?.stampPath].filter(Boolean).length} of 3 added`}
                >
                  <View className="flex-row gap-2">
                    {([
                      ["logoPath", "Logo", s?.logoPath, "school-outline"],
                      ["signPath", "Signature", s?.signPath, "create-outline"],
                      ["stampPath", "Stamp", s?.stampPath, "ribbon-outline"],
                    ] as const).map(([key, label, path, icon]) => (
                      <Pressable
                        key={key}
                        disabled={!edit || Boolean(uploadingAsset)}
                        onPress={() => void uploadBrandAsset(key, label)}
                        className={`flex-1 items-center gap-1.5 rounded-xl border p-3 ${path ? "border-ink-200 bg-white" : "border-dashed border-ink-300 bg-ink-50"}`}
                      >
                        <View className="h-12 w-full items-center justify-center">
                          {path ? <AssetImage path={path} className="h-12 w-full" /> : <Ionicons name={icon} size={22} color="#94A3B8" />}
                        </View>
                        <Text className="text-xs font-semibold text-ink-900">{label}</Text>
                        <Text className={`text-[11px] ${path ? "text-emerald-700" : "text-[#1F45C7]"}`}>
                          {uploadingAsset === key ? "Uploading…" : path ? "✓ Tap to replace" : "+ Upload"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View className="mt-3">
                    <Field label="Signatory name">
                      <Input value={form.signatory} placeholder="Principal" onChangeText={(v) => patch("signatory", v)} />
                    </Field>
                  </View>
                </IdentitySection>

                <IdentitySection title="Address" status={form.address && form.city && form.pincode ? "" : "⚠ Missing"} warn>
                  <Field label="Street / area">
                    <Input value={form.address} onChangeText={(v) => patch("address", v)} />
                  </Field>
                  <View className="mt-3 flex-row gap-3">
                    <View className="min-w-0 flex-1">
                      <Field label="City">
                        <Input value={form.city} onChangeText={(v) => patch("city", v)} />
                      </Field>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Field label="State">
                        <Input value={form.state} onChangeText={(v) => patch("state", v)} />
                      </Field>
                    </View>
                  </View>
                  <View className="mt-3 w-1/2 pr-1.5">
                    <Field label="PIN">
                      <Input keyboardType="number-pad" maxLength={6} value={form.pincode} onChangeText={(v) => patch("pincode", v.replace(/\D/g, ""))} />
                    </Field>
                  </View>
                </IdentitySection>

                <IdentitySection title="Contact" status={form.phone || form.email ? "" : "⚠ Missing"} warn>
                  <View className={phone ? "gap-3" : "flex-row gap-3"}>
                    <View className="min-w-0 flex-1">
                      <Field label="Phone">
                        <Input keyboardType="phone-pad" value={form.phone} onChangeText={(v) => patch("phone", v)} />
                      </Field>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Field label="Email">
                        <Input autoCapitalize="none" keyboardType="email-address" value={form.email} onChangeText={(v) => patch("email", v)} />
                      </Field>
                    </View>
                  </View>
                </IdentitySection>

                <IdentitySection title="Tax (optional)" collapsible defaultOpen={Boolean(form.gstin || form.pan)} status={form.gstin || form.pan ? "" : "Only if you charge GST"}>
                  <View className={phone ? "gap-3" : "flex-row gap-3"}>
                    <View className="min-w-0 flex-1">
                      <Field label="GSTIN">
                        <Input autoCapitalize="characters" value={form.gstin} onChangeText={(v) => patch("gstin", v)} />
                      </Field>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Field label="PAN">
                        <Input autoCapitalize="characters" value={form.pan} onChangeText={(v) => patch("pan", v)} />
                      </Field>
                    </View>
                  </View>
                </IdentitySection>
              </View>
            ) : null}

            {tab === "sessions" ? (
              <View className="gap-3">
                <Text className="text-sm text-ink-700">
                  Academic years control which fee templates, exam plans, and records are current. Older years stay available when a new session starts.
                </Text>
                <View className="rounded-md border border-ink-200 p-4">
                  <View className={phone ? "gap-3" : "flex-row items-start justify-between gap-3"}>
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-ink-900">Academic sessions</Text>
                      <Text className="mt-0.5 text-xs text-ink-700">
                        Fees for 2026-27 stay when you add 2027-28.
                      </Text>
                    </View>
                    {edit ? (
                      <View className="flex-row flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          onPress={async () => {
                            await run("startNextSchoolSession", {}, "Next year started.");
                          }}
                        >
                          Start next year
                        </Button>
                        <Button
                          variant="ghost"
                          onPress={() => {
                            const current = sessions.find((row) => row.current) ?? sessions[0];
                            const next = nextSessionDates(current?.endsOn || form.sessionEnd || "2026-03-31");
                            setSessionDraft({
                              startsOn: next.startsOn,
                              endsOn: next.endsOn,
                              copyFromId: current?.id || "",
                              makeCurrent: true,
                            });
                            setAddOpen(true);
                          }}
                        >
                          Add session
                        </Button>
                      </View>
                    ) : null}
                  </View>
                  <View className="mt-3 overflow-hidden rounded-md border border-ink-100">
                    {sessions.map((row) => (
                      <View key={row.id} className="flex-row flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2.5 last:border-b-0">
                        <View>
                          <View className="flex-row flex-wrap items-center gap-2">
                            <Text className="text-sm font-medium text-ink-900">{row.label}</Text>
                            {row.current ? <Badge tone="clay">Current</Badge> : null}
                          </View>
                          <Text className="text-xs text-ink-700">
                            {prettyDate(row.startsOn)} - {prettyDate(row.endsOn)}
                          </Text>
                        </View>
                        {edit ? (
                          <View className="flex-row flex-wrap gap-3">
                            <Linkish
                              label={row.current ? "Confirm dates" : "Use as current"}
                              onPress={() => run("setCurrentSchoolSession", { sessionId: row.id }, `${row.label} confirmed for this school.`)}
                            />
                            {!row.current && sessions.length > 1 ? (
                              <Linkish
                                label="Remove"
                                danger
                                onPress={() => run("deleteSchoolSession", { sessionId: row.id }, `${row.label} removed.`)}
                              />
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            ) : null}

            {tab === "classes" && phone ? (
              <PhoneClassList
                classes={data?.classes ?? []}
                staff={(data?.staff ?? []).map((row) => ({ kind: row.kind, name: row.name, classId: row.classId }))}
                templates={(data?.feeTemplates ?? []).map((row) => ({
                  classId: row.classId,
                  sessionId: row.sessionId,
                  startsPeriod: row.startsPeriod,
                  lines: (row.lines ?? []).map((line) => ({ amount: Number(line.amount) || 0, scope: line.scope })),
                }))}
                sessionId={sessions.find((row) => row.current)?.id || s?.sessionId || ""}
                canAdd={edit}
                onAdd={() => {
                  setClassDraft({ name: "", section: "A" });
                  setClassOpen(true);
                }}
                onGo={(href) => router.push(href as never)}
              />
            ) : null}
            {tab === "classes" && !phone ? (
              <View className="gap-3">
                <Text className="text-sm text-ink-700">
                  Set the school sections here. Subjects and weekly timetable stay in their own teaching setup pages.
                </Text>
                <View className="rounded-md border border-ink-200 p-4">
                  <View className={phone ? "gap-3" : "flex-row items-start justify-between gap-3"}>
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-ink-900">Classes</Text>
                      <Text className="mt-0.5 text-xs text-ink-700">
                        Sections of the school, with current student strength.
                      </Text>
                    </View>
                    {edit ? (
                      <Button
                        variant="ghost"
                        onPress={() => {
                          setClassDraft({ name: "", section: "A" });
                          setClassOpen(true);
                        }}
                      >
                        New class
                      </Button>
                    ) : null}
                  </View>
                  {(data?.classes ?? []).length ? (
                    <View className="mt-3 flex-row flex-wrap gap-1.5">
                      {(data?.classes ?? []).map((c) => (
                        <View key={c.id} className="rounded-md border border-ink-100 bg-ink-50 px-2.5 py-1">
                          <Text className="text-xs text-ink-800">
                            {c.label}
                            {c.students ? ` · ${c.students}` : ""}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text className="mt-3 text-sm text-ink-700">No classes yet. Add 1-A, 2-B, and so on.</Text>
                  )}
                </View>
              </View>
            ) : null}

            {tab === "clock" ? (
              <View className="mt-4 gap-4">
              <ClockForm
                key={(data?.timetable?.periods ?? []).map((p) => p.id).join(",")}
                weekdays={(data?.timetable?.weekdays ?? []).map((d) => d.n)}
                periods={data?.timetable?.periods ?? []}
                onSave={async (payload) => {
                  await run("saveSchoolClock", payload, "Clock saved.");
                }}
                onAdd={async (payload) => {
                  const result = await act<
                    {
                      ok: true;
                      period?: { id: string; name: string; startsAt: string; endsAt: string; isBreak: boolean; sortOrder?: number };
                    }
                  >(token, "addPeriod", payload);
                  toast.show("Period added.");
                  void reload();
                  return result;
                }}
                onDelete={async (id) => {
                  await run("deletePeriod", { id }, "Period removed.");
                }}
              />
              </View>
            ) : null}

            {tab === "subjects" ? (
              <SchoolSubjectsForm
                catalog={s?.subjectCatalog ?? []}
                classes={(data?.timetable?.classes ?? [])
                  .filter((c) => c.id)
                  .map((c) => ({
                    id: c.id as string,
                    label: c.label,
                    subjects: c.subjects ?? [],
                  }))}
                onSaveCatalog={async (names, applyToAllClasses) => {
                  await act(token, "saveSchoolSubjects", { names, applyToAllClasses });
                  toast.show("Saved successfully.");
                  await reload();
                }}
                onSaveClass={async (classId, subjects) => {
                  await act(token, "saveClassCurriculum", { classId, subjects });
                  toast.show("Saved successfully.");
                  await reload();
                }}
              />
            ) : null}

            {tab === "calendar" ? (
              <View className="mt-4 gap-3">
                <View className={phone ? "gap-3" : "flex-row flex-wrap items-start justify-between gap-3"}>
                  <View className={phone ? "" : "min-w-0 flex-1"}>
                    <Text className="text-sm font-medium text-ink-900">Holiday calendar</Text>
                    <Text className="mt-0.5 text-xs text-ink-700">
                      Exam papers skip these days for {calendarSession?.label || "this session"}. Weekly offs stay on Clock.
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <View className={phone ? "min-w-0 flex-1" : "w-56"}>
                      <Dropdown
                        value={activeCalendarSessionId}
                        options={sessionOptions}
                        placeholder="Pick session"
                        onChange={setCalendarSessionId}
                        className="w-full"
                      />
                    </View>
                    {edit ? (
                      <Button variant="ghost" onPress={() => setCalendarImportOpen(true)}>
                        Import CSV
                      </Button>
                    ) : null}
                  </View>
                </View>

                <View className="rounded-2xl border border-ink-200 bg-white p-3">
                  <Text className="mb-2 text-sm font-semibold text-ink-900">Add a holiday</Text>
                  <View className={phone ? "gap-3" : "flex-row flex-wrap items-end gap-3"}>
                    <View className={phone ? "" : wide ? "w-44" : "min-w-[12rem] flex-1"}>
                      <Field label="Date">
                        <DateField value={holiday.date} placeholder="Pick date" onChange={(date) => setHoliday({ ...holiday, date })} />
                      </Field>
                    </View>
                    <View className={phone ? "" : "min-w-[14rem] flex-1"}>
                      <Field label="Holiday name">
                        <Input value={holiday.name} placeholder="Gandhi Jayanti" onChangeText={(v) => setHoliday({ ...holiday, name: v })} />
                      </Field>
                    </View>
                    {edit ? (
                      <Button
                        className={phone ? "w-full" : undefined}
                        disabled={!holiday.date || !holiday.name.trim()}
                        onPress={async () => {
                          await run("addSchoolHoliday", { ...holiday, sessionId: activeCalendarSessionId }, "Holiday added.");
                          setHoliday({ date: "", name: "" });
                        }}
                      >
                        Add holiday
                      </Button>
                    ) : null}
                  </View>
                </View>

                {inSession.length ? (
                  <View className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
                    <View className="flex-row items-center justify-between gap-2 border-b border-ink-100 bg-ink-50 px-3 py-2">
                      <Text className="text-xs font-medium text-ink-700">{calendarSession?.label || "This session"}</Text>
                      <Text className="text-xs text-ink-700">{inSession.length} day{inSession.length === 1 ? "" : "s"}</Text>
                    </View>
                    {inSession.map((h) => (
                      <View key={h.id} className="flex-row items-center gap-3 border-b border-ink-100 px-3 py-2.5 last:border-b-0">
                        <View className="h-11 w-11 items-center justify-center rounded-xl bg-amber-50">
                          <Text className="text-[10px] font-semibold uppercase text-amber-800">
                            {new Date(`${h.date.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { month: "short" })}
                          </Text>
                          <Text className="text-base font-bold leading-5 text-amber-900">{Number(h.date.slice(8, 10))}</Text>
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>{h.name}</Text>
                          <Text className="text-xs text-ink-700">{prettyDay(h.date)}</Text>
                        </View>
                        {edit ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Remove ${h.name}`}
                            hitSlop={8}
                            className="h-8 w-8 items-center justify-center"
                            onPress={() => run("deleteSchoolHoliday", { id: h.id }, "Holiday removed.")}
                          >
                            <Ionicons name="close-circle-outline" size={20} color="#b91c1c" />
                          </Pressable>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text className="text-sm text-ink-700">
                    No holidays yet. Import a calendar so Annual and Term papers jump over those days.
                  </Text>
                )}

                <Modal open={calendarImportOpen} title="Upload holiday CSV" onClose={() => setCalendarImportOpen(false)} wide>
                  <UploadCsvPanel
                    description={`Upload holidays for ${calendarSession?.label || "this session"}.`}
                    requiredColumns="date, name"
                    note="No fixed column order needed. Existing holiday dates are skipped during import."
                    onBrowse={() => void uploadHolidayCsv()}
                    onDownloadSample={downloadCalendarSampleCsv}
                  />
                </Modal>
              </View>
            ) : null}

            {tab === "leave" && phone ? (
              <View className="mt-3 gap-3">
                <LeaveYearStart
                  value={leaveYearStart}
                  disabled={!edit}
                  onChange={(m) => {
                    setLeaveYearStart(m);
                    void run("saveLeavePolicy", { types: leaveTypes, leaveYearStartMonth: m }, "Leave year updated.");
                  }}
                />
                {edit ? (
                  <Pressable
                    onPress={() => setBalancesOpen(true)}
                    className="flex-row items-center gap-3 rounded-2xl border border-ink-200 bg-white p-3.5"
                  >
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#EEF3FF]">
                      <Ionicons name="people-outline" size={19} color="#1F45C7" />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[14px] font-semibold text-ink-900">Current balances</Text>
                      <Text className="text-[12px] text-ink-500">Enter what each employee has left today (one-time import from your old register)</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
                  </Pressable>
                ) : null}
                <LeaveBalancesSheet open={balancesOpen} onClose={() => setBalancesOpen(false)} />
                <PhoneLeaveTypes
                  types={leaveTypes}
                  setTypes={setLeaveTypes}
                  canEdit={edit}
                  startMonth={leaveYearStart}
                  onSave={async (rows) => {
                    await run("saveLeavePolicy", { types: rows, leaveYearStartMonth: leaveYearStart }, "Leave types saved.");
                  }}
                />
              </View>
            ) : null}

            {tab === "leave" && !phone ? (
              <View className="mt-4 gap-3">
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-medium text-ink-900">Leave types</Text>
                    <Text className="mt-0.5 text-xs text-ink-700">
                      Decide who can apply, notice days, and how leave builds up for teachers and staff.
                    </Text>
                  </View>
                  {edit ? (
                    <Button
                      variant="ghost"
                      onPress={() =>
                        setLeaveTypes((cur) => [
                          ...cur,
                          {
                            id: "",
                            name: "Duty",
                            forTeacher: true,
                            forStaff: true,
                            forStudent: false,
                            eligibilityGender: "ANY",
                            noticeDays: 0,
                            yearlyCap: 0,
                            sortOrder: cur.length,
                          },
                        ])
                      }
                    >
                      Add type
                    </Button>
                  ) : null}
                </View>

                <View className="overflow-hidden rounded-md border border-ink-200">
                  {wide ? (
                    <View className="flex-row items-center gap-3 border-b border-ink-100 bg-ink-50 px-3 py-2">
                      <View className="min-w-0 flex-1">
                        <Text className="text-xs font-medium text-ink-700">Type</Text>
                      </View>
                      <View className="w-56">
                        <Text className="text-xs font-medium text-ink-700">Allowed for</Text>
                      </View>
                      <View className="w-48">
                        <Text className="text-xs font-medium text-ink-700">Gender</Text>
                      </View>
                      <View className="w-32">
                        <Text className="text-xs font-medium text-ink-700">Notice days</Text>
                      </View>
                      <View className="w-64">
                        <Text className="text-xs font-medium text-ink-700">Leave credit</Text>
                      </View>
                      <View className="w-8" />
                    </View>
                  ) : null}
                  {leaveTypes.map((row, i) => (
                    <View
                      key={row.id || `new-${i}`}
                      className={`gap-3 border-b border-ink-100 px-3 py-3 last:border-b-0 ${wide ? "flex-row items-center" : ""}`}
                    >
                      <View className={wide ? "min-w-0 flex-1" : ""}>
                        {!wide ? <Text className="mb-1 text-xs font-medium text-ink-700">Type</Text> : null}
                        <Input
                          value={row.name}
                          onChangeText={(name) =>
                            setLeaveTypes((cur) => cur.map((t, n) => (n === i ? { ...t, name } : t)))
                          }
                        />
                      </View>
                      <View className={wide ? "w-56" : ""}>
                        {!wide ? <Text className="mb-1 text-xs font-medium text-ink-700">Allowed for</Text> : null}
                        <View className="flex-row flex-wrap gap-2">
                          {(
                            [
                              ["forTeacher", "Teachers"],
                              ["forStaff", "Staff"],
                              ["forStudent", "Students"],
                            ] as const
                          ).map(([key, label]) => (
                            <SmallToggle
                              key={key}
                              label={label}
                              on={row[key]}
                              onPress={() =>
                                setLeaveTypes((cur) => cur.map((t, n) => (n === i ? { ...t, [key]: !t[key] } : t)))
                              }
                            />
                          ))}
                        </View>
                      </View>
                      <View className={wide ? "w-48" : ""}>
                        {!wide ? <Text className="mb-1 text-xs font-medium text-ink-700">Gender</Text> : null}
                        <View className="flex-row flex-wrap gap-2">
                          {(
                            [
                              ["ANY", "Any"],
                              ["FEMALE", "Female"],
                              ["MALE", "Male"],
                            ] as const
                          ).map(([gender, label]) => (
                            <SmallToggle
                              key={gender}
                              label={label}
                              on={(row.eligibilityGender || "ANY") === gender}
                              onPress={() =>
                                setLeaveTypes((cur) => cur.map((t, n) => (n === i ? { ...t, eligibilityGender: gender } : t)))
                              }
                            />
                          ))}
                        </View>
                      </View>
                      <View className={wide ? "w-32" : ""}>
                        {!wide ? <Text className="mb-1 text-xs font-medium text-ink-700">Notice days</Text> : null}
                        <Input
                          keyboardType="number-pad"
                          value={String(row.noticeDays)}
                          onChangeText={(v) =>
                            setLeaveTypes((cur) =>
                              cur.map((t, n) => (n === i ? { ...t, noticeDays: Number(v.replace(/\D/g, "") || 0) } : t))
                            )
                          }
                        />
                      </View>
                      <View className={wide ? "w-64" : ""}>
                        {!wide ? <Text className="mb-1 text-xs font-medium text-ink-700">Leave credit</Text> : null}
                        <Pressable
                          disabled={!edit}
                          onPress={() => setCreditEdit(i)}
                          className="min-h-[40px] flex-row items-center gap-2 rounded-md border border-ink-200 bg-white px-3 py-2"
                        >
                          <Text className="min-w-0 flex-1 text-[13px] text-ink-900" numberOfLines={2}>
                            {leaveCreditSummary(row)}
                          </Text>
                          {edit ? <Ionicons name="create-outline" size={15} color="#1F45C7" /> : null}
                        </Pressable>
                      </View>
                      {edit && leaveTypes.length > 1 ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${row.name || "leave type"}`}
                          hitSlop={8}
                          className="h-8 w-8 items-center justify-center self-start"
                          onPress={() => setLeaveTypes((cur) => cur.filter((_, n) => n !== i))}
                        >
                          <Ionicons name="close-circle-outline" size={20} color="#b91c1c" />
                        </Pressable>
                      ) : wide ? (
                        <View className="w-8" />
                      ) : null}
                    </View>
                  ))}
                </View>
                <View className="flex-row flex-wrap gap-3">
                  <View className="min-w-[320px] flex-1">
                    <LeaveYearStart value={leaveYearStart} disabled={!edit} onChange={setLeaveYearStart} />
                  </View>
                  {edit ? (
                    <View className="min-w-[320px] flex-1">
                      <Pressable
                    onPress={() => setBalancesOpen(true)}
                    className="flex-row items-center gap-3 rounded-2xl border border-ink-200 bg-white p-3.5"
                  >
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#EEF3FF]">
                      <Ionicons name="people-outline" size={19} color="#1F45C7" />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[14px] font-semibold text-ink-900">Current balances</Text>
                      <Text className="text-[12px] text-ink-500">Enter what each employee has left today (one-time import from your old register)</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
                  </Pressable>
                    </View>
                  ) : null}
                </View>
                <LeaveBalancesSheet open={balancesOpen} onClose={() => setBalancesOpen(false)} />
                {edit ? (
                  <View className="flex-row justify-end">
                    <Button
                      onPress={() =>
                        run(
                          "saveLeavePolicy",
                          { types: leaveTypes, leaveYearStartMonth: leaveYearStart },
                          "Leave policy saved."
                        )
                      }
                    >
                      Save leave
                    </Button>
                  </View>
                ) : null}
                <Modal
                  open={creditEdit !== null && Boolean(leaveTypes[creditEdit ?? -1])}
                  title={`${leaveTypes[creditEdit ?? -1]?.name || "Leave"} · how it builds up`}
                  onClose={() => setCreditEdit(null)}
                  footer={
                    <View className="flex-row justify-end">
                      <Button onPress={() => setCreditEdit(null)}>Done</Button>
                    </View>
                  }
                >
                  {creditEdit !== null && leaveTypes[creditEdit] ? (
                    <LeaveCreditFields
                      row={leaveTypes[creditEdit]}
                      startMonth={leaveYearStart}
                      existing={Boolean(leaveTypes[creditEdit].id)}
                      onChange={(next) => setLeaveTypes((cur) => cur.map((t, n) => (n === creditEdit ? next : t)))}
                    />
                  ) : null}
                </Modal>
              </View>
            ) : null}

            {tab === "exams" && phone ? (
              <PhoneExamSettings
                canEdit={examEdit}
                passPercent={passPercent}
                setPassPercent={setPassPercent}
                showRank={showRank}
                setShowRank={setShowRank}
                bands={bands}
                setBands={setBands}
                paidMonths={reportCardPaidMonths}
                setPaidMonths={setReportCardPaidMonths}
                unpaidMonths={reportCardUnpaidMonths}
                setUnpaidMonths={setReportCardUnpaidMonths}
                admitMonths={admitCardPendingMonths}
                setAdmitMonths={setAdmitCardPendingMonths}
                saved={{
                  passPercent: String(s?.policy?.passPercent ?? 33),
                  showRank: Boolean(s?.policy?.showRank),
                  bands: JSON.stringify(s?.policy?.bands?.length ? s.policy.bands : DEFAULT_GRADE_BANDS),
                  paid: String(s?.policy?.reportCardPaidMonths ?? 0),
                  unpaid: String(s?.policy?.reportCardUnpaidMonths ?? 0),
                  admit: String(s?.policy?.admitCardPendingMonths ?? 0),
                  plan: JSON.stringify(normalizeExamPlan(s?.plan)),
                }}
                plan={plan}
                setPlan={setPlan}
                sessionLabel={s?.sessionLabel || ""}
                weight={weight}
                planChecks={planChecks}
                planComplete={planComplete}
                onSave={async (policyDirty, planDirty) => {
                  if (policyDirty) {
                    await run(
                      "saveGradePolicy",
                      {
                        passPercent: Number(passPercent),
                        showRank,
                        bands,
                        reportCardPaidMonths: Number(reportCardPaidMonths) || 0,
                        reportCardUnpaidMonths: Number(reportCardUnpaidMonths) || 0,
                        admitCardPendingMonths: Number(admitCardPendingMonths) || 0,
                      },
                      "Exam settings saved."
                    );
                  }
                  if (planDirty) await saveYearPlan();
                }}
              />
            ) : null}
            {tab === "exams" && !phone ? (
              <View className="mt-4 gap-6">
                <View>
                  <View className="flex-row flex-wrap items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-ink-900">Grades — the school decides</Text>
                      <Text className="mt-0.5 text-xs text-ink-700">Bands apply to every class. Rank stays off unless you turn it on.</Text>
                    </View>
                    <Pressable className="flex-row items-center gap-2" onPress={() => setShowRank(!showRank)}>
                      <View className={`h-4 w-4 rounded border ${showRank ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`} />
                      <Text className="text-sm text-ink-800">Show class rank</Text>
                    </Pressable>
                  </View>
                  <View className="mt-3 gap-3">
                    <View className="flex-row flex-wrap items-end justify-between gap-3">
                      <Field label="Pass from">
                        <View className="flex-row items-center gap-1.5">
                          <Input
                            keyboardType="number-pad"
                            value={passPercent}
                            onChangeText={setPassPercent}
                            className="w-20"
                          />
                          <Text className="text-xs text-ink-700">%</Text>
                        </View>
                      </Field>
                      <Field label="Report card if paid months ≥" hint="0 sends every family. 3 means only parents who have paid 3 fee months get the sitting report card.">
                        <Input
                          keyboardType="number-pad"
                          value={reportCardPaidMonths}
                          onChangeText={setReportCardPaidMonths}
                          className="w-20"
                        />
                      </Field>
                      <Field label="Hold results if unpaid months ≥" hint="0 publishes to every family. 3 means parents with 3 or more unpaid fee months see results only after they pay.">
                        <Input
                          keyboardType="number-pad"
                          value={reportCardUnpaidMonths}
                          onChangeText={setReportCardUnpaidMonths}
                          className="w-20"
                        />
                      </Field>
                      <Field label="Block admit card if unpaid months ≥" hint="0 issues everyone. 3 means a student with 3 or more unpaid fee months cannot get an admit card.">
                        <Input
                          keyboardType="number-pad"
                          value={admitCardPendingMonths}
                          onChangeText={setAdmitCardPendingMonths}
                          className="w-20"
                        />
                      </Field>
                      {examEdit ? (
                        <Button
                          variant="ghost"
                          onPress={() =>
                            run(
                              "saveGradePolicy",
                              {
                                passPercent: Number(passPercent),
                                showRank,
                                bands,
                                reportCardPaidMonths: Number(reportCardPaidMonths) || 0,
                                reportCardUnpaidMonths: Number(reportCardUnpaidMonths) || 0,
                                admitCardPendingMonths: Number(admitCardPendingMonths) || 0,
                              },
                              "Grade scale saved."
                            )
                          }
                        >
                          Save scale
                        </Button>
                      ) : null}
                    </View>
                    <View className="overflow-hidden rounded-md border border-ink-100">
                      <View className="flex-row items-center gap-2 border-b border-ink-100 bg-ink-50 px-3 py-2">
                        <View className="w-24">
                          <Text className="text-xs font-medium text-ink-700">Grade</Text>
                        </View>
                        <View className="w-24">
                          <Text className="text-xs font-medium text-ink-700">From %</Text>
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text className="text-xs text-ink-700">Applies from this percent and above</Text>
                        </View>
                        <View className="w-8" />
                      </View>
                      {bands.map((band, i) => (
                        <View
                          key={`${band.grade}-${i}`}
                          className={`flex-row items-center gap-2 px-3 py-2 ${i ? "border-t border-ink-100" : ""}`}
                        >
                          <View className="w-24">
                            <Input
                              value={band.grade}
                              onChangeText={(v) => {
                                const next = [...bands];
                                next[i] = { ...next[i], grade: v };
                                setBands(next);
                              }}
                              className="py-2"
                            />
                          </View>
                          <View className="w-24">
                            <Input
                              keyboardType="number-pad"
                              value={String(band.min)}
                              onChangeText={(v) => {
                                const next = [...bands];
                                next[i] = { ...next[i], min: Number(v.replace(/\D/g, "") || 0) };
                                setBands(next);
                              }}
                              className="py-2"
                            />
                          </View>
                          <Text className="min-w-0 flex-1 text-xs text-ink-700">
                            {band.grade || "Grade"} starts at {Number(band.min) || 0}%
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Remove grade ${band.grade || i + 1}`}
                            hitSlop={8}
                            className="h-8 w-8 items-center justify-center"
                            onPress={() => setBands(bands.filter((_, j) => j !== i))}
                          >
                            <Ionicons name="close-circle-outline" size={20} color="#b91c1c" />
                          </Pressable>
                        </View>
                      ))}
                      <Pressable
                        className="flex-row items-center gap-2 border-t border-dashed border-ink-200 px-3 py-2"
                        onPress={() => setBands([...bands, { min: 0, grade: "" }])}
                      >
                        <Ionicons name="add-circle-outline" size={18} color="#3d4f66" />
                        <Text className="text-xs font-medium text-ink-700">Add band</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
                <View>
                  <View className="flex-row flex-wrap items-start justify-between gap-3">
                    <View className="flex-1">
                      <Text className="text-sm font-medium text-ink-900">
                        This year's exam plan · {s?.sessionLabel || ""}
                      </Text>
                      <Text className="mt-0.5 text-xs text-ink-700">
                        Set the sittings once for the session. Each class then schedules Term 1, unit tests, and annual
                        when that exam is due — not the whole timetable on day one.
                      </Text>
                    </View>
                    <View className={`rounded-md px-3 py-2 ${planComplete ? "bg-green-50" : "bg-amber-50"}`}>
                      <Text className={`text-xs font-medium ${planComplete ? "text-green-800" : "text-amber-900"}`}>
                        Setup {planCompletion}% complete
                      </Text>
                      <Text className={`text-[11px] ${weight === 100 ? "text-green-800" : "text-amber-900"}`}>
                        Result weight: {weight}% of 100%
                      </Text>
                    </View>
                  </View>
                  <View className="mt-3 flex-row flex-wrap gap-x-4 gap-y-1 rounded-md border border-ink-100 bg-ink-50 p-3">
                    {planChecks.map((check) => (
                      <View key={check.label} className="flex-row items-center gap-1.5">
                        <Ionicons
                          name={check.ok ? "checkmark-circle" : "ellipse-outline"}
                          size={15}
                          color={check.ok ? "#166534" : "#92400e"}
                        />
                        <Text className="text-xs text-ink-700">{check.label}</Text>
                      </View>
                    ))}
                  </View>
                  <View className="mt-3 gap-2">
                    <View className={`flex-row items-end gap-2 px-3 ${wide ? "flex-nowrap" : "flex-wrap"}`}>
                      <View className={wide ? "min-w-0 flex-1" : "min-w-[12rem] flex-1"}>
                        <Text className="text-xs font-medium text-ink-700">Exam / sitting</Text>
                      </View>
                      <View className={wide ? "w-32 shrink-0" : "w-36"}>
                        <Text className="text-xs font-medium text-ink-700">Result weight (%)</Text>
                        <Text className="text-[11px] text-ink-700">Share of final result</Text>
                      </View>
                      <View className={wide ? "w-32 shrink-0" : "w-36"}>
                        <Text className="text-xs font-medium text-ink-700">Maximum marks</Text>
                        <Text className="text-[11px] text-ink-700">Paper is out of</Text>
                      </View>
                      <View className={wide ? "w-40 shrink-0" : "w-48"}>
                        <Text className="text-xs font-medium text-ink-700">Expected period</Text>
                        <Text className="text-[11px] text-ink-700">Approximate is fine</Text>
                      </View>
                      <View className="w-8" />
                    </View>
                    {plan.map((row, i) => (
                      <View
                        key={row.id}
                        className={`flex-row items-center gap-2 rounded-md border border-ink-100 p-3 ${
                          wide ? "flex-nowrap" : "flex-wrap"
                        }`}
                      >
                        <View className={wide ? "min-w-0 flex-1" : "min-w-[12rem] flex-1"}>
                          <Input
                            value={row.name}
                            placeholder="e.g. Term 1"
                            maxLength={80}
                            onChangeText={(v) => {
                              const next = [...plan];
                              next[i] = { ...next[i], name: v };
                              setPlan(next);
                            }}
                          />
                        </View>
                        <View className={wide ? "w-32 shrink-0" : "w-36"}>
                          <Input
                            keyboardType="number-pad"
                            value={String(row.weight)}
                            onChangeText={(v) => {
                              const next = [...plan];
                              next[i] = { ...next[i], weight: Number(v.replace(/\D/g, "") || 0) };
                              setPlan(next);
                            }}
                          />
                        </View>
                        <View className={wide ? "w-32 shrink-0" : "w-36"}>
                          <Input
                            keyboardType="number-pad"
                            value={String(row.maxMarks)}
                            onChangeText={(v) => {
                              const next = [...plan];
                              next[i] = { ...next[i], maxMarks: Number(v.replace(/\D/g, "") || 0) };
                              setPlan(next);
                            }}
                          />
                        </View>
                        <View className={wide ? "w-40 shrink-0" : "w-48"}>
                          <Dropdown
                            value={row.expectedPeriod || ""}
                            options={EXAM_PERIOD_SELECT_OPTIONS}
                            placeholder="Pick month"
                            className="w-full"
                            onChange={(v) => {
                              const next = [...plan];
                              next[i] = { ...next[i], expectedPeriod: v };
                              setPlan(next);
                            }}
                          />
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${row.name || "exam"}`}
                          hitSlop={8}
                          className="h-10 w-8 shrink-0 items-center justify-center rounded-full"
                          onPress={() => setPlan(plan.filter((_, j) => j !== i))}
                        >
                          <Ionicons name="close-circle-outline" size={22} color="#b91c1c" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                  <View className="mt-3 flex-row flex-wrap items-center justify-between gap-2">
                    <View className="flex-row flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        disabled={plan.length >= 20}
                        onPress={() =>
                          setPlan([
                            ...plan,
                            { id: `sitting-${Date.now()}`, name: `Sitting ${plan.length + 1}`, kind: "custom", weight: 0, maxMarks: 80, expectedPeriod: "" },
                          ])
                        }
                      >
                        Add sitting
                      </Button>
                      <Button variant="ghost" onPress={() => setPlan(normalizeExamPlan())}>
                        CBSE-style year
                      </Button>
                    </View>
                    {examEdit ? (
                      <Button
                        disabled={!planComplete || savingYearPlan}
                        onPress={saveYearPlan}
                      >
                        {savingYearPlan
                          ? "Saving..."
                          : planComplete
                            ? "Save year plan"
                            : `Complete ${planChecks.length - planChecksDone} item${planChecks.length - planChecksDone === 1 ? "" : "s"}`}
                      </Button>
                    ) : null}
                  </View>
                </View>
              </View>
            ) : null}

            {tab === "collect" ? (
              <View className="mt-4 gap-5">
                <View className="flex-row flex-wrap gap-3">
                  <Half>
                    <Field label="UPI id">
                      <Input autoCapitalize="none" value={form.upiId} placeholder="school@okaxis" onChangeText={(v) => patch("upiId", v)} />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="Bank name">
                      <Input value={form.bankName} placeholder="HDFC Bank" onChangeText={(v) => patch("bankName", v)} />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="Account holder">
                      <Input value={form.bankAccountName} placeholder="Anekio School" onChangeText={(v) => patch("bankAccountName", v)} />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="Account number">
                      <Input keyboardType="number-pad" value={form.bankAccountNumber} placeholder="School current account" onChangeText={(v) => patch("bankAccountNumber", v)} />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="IFSC">
                      <Input autoCapitalize="characters" value={form.bankIfsc} placeholder="HDFC0001234" onChangeText={(v) => patch("bankIfsc", v)} />
                    </Field>
                  </Half>
                </View>
                <View className="gap-3">
                  <Text className="text-sm font-medium text-ink-900">Online gateway</Text>
                  <Text className="text-sm text-ink-700">School's own Razorpay, Cashfree, or BillDesk. Anekio never receives the fee.</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {PAY_GATEWAYS.map((g) => {
                      const on = form.payGateway === g.id;
                      return (
                        <Pressable
                          key={g.id}
                          onPress={() => patch("payGateway", g.id)}
                          className={`min-w-[45%] flex-1 rounded-md border px-3 py-2 ${on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}
                        >
                          <Text className={`text-sm font-medium ${on ? "text-white" : "text-ink-900"}`}>{g.label}</Text>
                          <Text className={`mt-0.5 text-[11px] ${on ? "text-white/80" : "text-ink-700"}`}>{g.hint}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {form.payGateway !== "NONE" ? (
                    <Pressable className="flex-row items-center gap-2" onPress={() => patch("payTestMode", !form.payTestMode)}>
                      <View className={`h-4 w-4 rounded border ${form.payTestMode ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`} />
                      <Text className="text-sm text-ink-800">Test / sandbox mode</Text>
                    </Pressable>
                  ) : null}
                  {form.payGateway === "RAZORPAY" ? (
                    <View className="flex-row flex-wrap gap-3">
                      <Half>
                        <Field label="Key ID">
                          <Input autoCapitalize="none" value={form.razorpayKeyId} placeholder="rzp_live_… or rzp_test_…" onChangeText={(v) => patch("razorpayKeyId", v)} />
                        </Field>
                      </Half>
                      <Half>
                        <Field label="Key secret">
                          <Input
                            secureTextEntry
                            autoCapitalize="none"
                            value={form.razorpayKeySecret}
                            placeholder={s?.pay?.razorpaySecretSet ? "Saved — leave blank to keep" : "From Razorpay Dashboard"}
                            onChangeText={(v) => patch("razorpayKeySecret", v)}
                          />
                        </Field>
                      </Half>
                      <Half>
                        <Field label="Webhook secret">
                          <Input
                            secureTextEntry
                            autoCapitalize="none"
                            value={form.razorpayWebhookSecret}
                            placeholder={s?.pay?.razorpayWebhookSet ? "Saved — leave blank to keep" : "Optional"}
                            onChangeText={(v) => patch("razorpayWebhookSecret", v)}
                          />
                        </Field>
                      </Half>
                      <Text className="w-full text-[11px] text-ink-700">Webhook URL: /api/pay/webhook?provider=razorpay</Text>
                    </View>
                  ) : null}
                  {form.payGateway === "CASHFREE" ? (
                    <View className="flex-row flex-wrap gap-3">
                      <Half>
                        <Field label="App ID / Client ID">
                          <Input autoCapitalize="none" value={form.cashfreeAppId} placeholder="From Cashfree Dashboard" onChangeText={(v) => patch("cashfreeAppId", v)} />
                        </Field>
                      </Half>
                      <Half>
                        <Field label="Secret key">
                          <Input
                            secureTextEntry
                            autoCapitalize="none"
                            value={form.cashfreeSecretKey}
                            placeholder={s?.pay?.cashfreeSecretSet ? "Saved — leave blank to keep" : "From Cashfree Dashboard"}
                            onChangeText={(v) => patch("cashfreeSecretKey", v)}
                          />
                        </Field>
                      </Half>
                    </View>
                  ) : null}
                  {form.payGateway === "BILLDESK" ? (
                    <View className="flex-row flex-wrap gap-3">
                      <Half>
                        <Field label="Merchant ID">
                          <Input autoCapitalize="none" value={form.billdeskMerchantId} placeholder="mercid" onChangeText={(v) => patch("billdeskMerchantId", v)} />
                        </Field>
                      </Half>
                      <Half>
                        <Field label="Client ID">
                          <Input autoCapitalize="none" value={form.billdeskClientId} placeholder="clientid" onChangeText={(v) => patch("billdeskClientId", v)} />
                        </Field>
                      </Half>
                      <Half>
                        <Field label="Secret">
                          <Input
                            secureTextEntry
                            autoCapitalize="none"
                            value={form.billdeskSecret}
                            placeholder={s?.pay?.billdeskSecretSet ? "Saved — leave blank to keep" : "From BillDesk"}
                            onChangeText={(v) => patch("billdeskSecret", v)}
                          />
                        </Field>
                      </Half>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {tab === "website" ? (
              <View className="w-full max-w-[1240px] gap-4 self-center">
                {/* Live / offline banner: the most important state on this page. */}
                <View
                  className={`flex-row flex-wrap items-center gap-3 rounded-2xl px-4 py-3 ${form.websiteEnabled ? "bg-emerald-50" : "bg-amber-50"}`}
                >
                  <View className={`h-2.5 w-2.5 rounded-full ${form.websiteEnabled ? "bg-emerald-500" : "bg-amber-500"}`} />
                  <View className="min-w-0 flex-1">
                    <Text className={`text-sm font-semibold ${form.websiteEnabled ? "text-emerald-900" : "text-amber-900"}`}>
                      {form.websiteEnabled ? "Live" : "Offline — parents can't see your website yet"}
                    </Text>
                    {form.websiteSlug ? (
                      <Pressable onPress={() => { if (typeof window !== "undefined") window.open(`https://${form.websiteSlug}.anekio.com`, "_blank"); }}>
                        <Text className="mt-0.5 text-xs font-medium text-blue-700">{form.websiteSlug}.anekio.com ↗</Text>
                      </Pressable>
                    ) : (
                      <Text className="mt-0.5 text-xs text-ink-700">Choose a website address below to publish.</Text>
                    )}
                  </View>
                  {savedWebsite?.slug ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        const url = `${webOrigin()}/school/${encodeURIComponent(savedWebsite.slug || "")}?preview=1`;
                        if (Platform.OS === "web" && typeof window !== "undefined") window.open(url, "_blank", "noopener");
                        else void Linking.openURL(url);
                      }}
                      className="h-10 flex-row items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3.5"
                    >
                      <Ionicons name="eye-outline" size={16} color="#1F45C7" />
                      <Text className="text-sm font-semibold text-[#1F45C7]">Preview</Text>
                    </Pressable>
                  ) : null}
                  {edit ? (
                    form.websiteEnabled ? (
                      <Pressable onPress={() => patch("websiteEnabled", false)} hitSlop={8}>
                        <Text className="text-xs font-semibold text-ink-700">Take offline</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        disabled={!form.websiteSlug}
                        onPress={() => patch("websiteEnabled", true)}
                        className={`h-10 items-center justify-center rounded-xl bg-[#1F45C7] px-4 ${form.websiteSlug ? "" : "opacity-40"}`}
                      >
                        <Text className="text-sm font-semibold text-white">Publish site</Text>
                      </Pressable>
                    )
                  ) : null}
                </View>
                {websiteDirtyHint ? (
                  <Text className="-mt-2 px-1 text-[11px] text-ink-700">Press Save below to apply {form.websiteEnabled ? "publishing" : "taking the site offline"}.</Text>
                ) : null}

                <View>
                  <View className="min-w-0 flex-1 gap-3">
                    <WebSection
                      title="Address & theme"
                      summary={`${form.websiteSlug || "no address"}.anekio.com · ${form.websiteTheme}`}
                      open={webOpen.address}
                      onToggle={() => setWebOpen((o) => ({ ...o, address: !o.address }))}
                    >
                      <Text className="mb-1.5 text-xs font-medium text-ink-700">Website address</Text>
                      <View className="flex-row items-center overflow-hidden rounded-xl border border-ink-200 bg-white">
                        <Text className="bg-ink-50 px-3 py-2.5 text-sm text-ink-600">https://</Text>
                        <View className="min-w-0 flex-1">
                          <Input
                            autoCapitalize="none"
                            className="h-10 rounded-none border-0 bg-transparent"
                            value={form.websiteSlug}
                            placeholder="green-valley"
                            onChangeText={(v) => patch("websiteSlug", v.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+/g, "").slice(0, 48))}
                          />
                        </View>
                        <Text className="bg-ink-50 px-3 py-2.5 text-sm text-ink-600">.anekio.com</Text>
                      </View>
                      <Text
                        className={`mt-1.5 text-xs font-medium ${
                          slugIsOwn ? "text-emerald-700" : ["taken", "invalid"].includes(websiteSlugStatus.kind) ? "text-red-700" : websiteSlugStatus.kind === "available" ? "text-emerald-700" : "text-ink-600"
                        }`}
                      >
                        {slugIsOwn
                          ? "✓ Your address"
                          : websiteSlugStatus.slug === form.websiteSlug.trim()
                            ? websiteSlugStatus.message
                            : "Checking address…"}
                      </Text>
                      <Text className="mb-2 mt-4 text-xs font-medium text-ink-700">Theme</Text>
                      <View className="flex-row flex-wrap gap-2">
                        {WEBSITE_THEMES.map((theme) => {
                          const on = form.websiteTheme === theme.id;
                          return (
                            <Pressable
                              key={theme.id}
                              accessibilityRole="button"
                              accessibilityLabel={`${theme.label} theme`}
                              onPress={() => patch("websiteTheme", theme.id)}
                              className={`flex-row items-center gap-2 rounded-full border px-3 py-1.5 ${on ? "border-ink-900 bg-white" : "border-ink-200 bg-white"}`}
                            >
                              <View className="h-4 w-4 items-center justify-center rounded-full" style={{ backgroundColor: theme.color }}>
                                {on ? <Ionicons name="checkmark" size={11} color="#FFFFFF" /> : null}
                              </View>
                              <Text className={`text-xs ${on ? "font-semibold text-ink-900" : "text-ink-700"}`}>{theme.label}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </WebSection>

                    <WebSection
                      title="Homepage hero"
                      summary={form.websiteHeroTitle || `${form.name || "School"} admissions are open`}
                      open={webOpen.hero}
                      onToggle={() => setWebOpen((o) => ({ ...o, hero: !o.hero }))}
                    >
                      <Field label="Headline">
                        <Input className="h-10" value={form.websiteHeroTitle} placeholder={`${form.name || "School"} admissions are open`} onChangeText={(v) => patch("websiteHeroTitle", v)} />
                      </Field>
                      <View className="mt-3">
                        <Field label="Subheading">
                          <Input className="h-10" value={form.websiteHeroSubtitle} placeholder="Tell parents why they should enquire." onChangeText={(v) => patch("websiteHeroSubtitle", v)} />
                        </Field>
                      </View>
                    </WebSection>

                    <WebSection
                      title="About your school"
                      summary={form.websiteAbout ? form.websiteAbout.slice(0, 70) : "Not written yet"}
                      open={webOpen.about}
                      onToggle={() => setWebOpen((o) => ({ ...o, about: !o.about }))}
                    >
                      <Input multiline className="min-h-[88px]" value={form.websiteAbout} placeholder="Short intro, teaching style, campus, values..." onChangeText={(v) => patch("websiteAbout", v)} />
                    </WebSection>

                    <WebSection
                      title="Admissions"
                      summary={form.websiteAdmissionOpen ? "Admissions open" : "Only collecting enquiries"}
                      open={webOpen.admissions}
                      onToggle={() => setWebOpen((o) => ({ ...o, admissions: !o.admissions }))}
                    >
                      <View className="flex-row gap-2">
                        {([
                          [true, "Admissions open"],
                          [false, "Only collect enquiries"],
                        ] as const).map(([value, label]) => (
                          <Pressable
                            key={label}
                            onPress={() => patch("websiteAdmissionOpen", value)}
                            className={`h-10 flex-1 items-center justify-center rounded-xl border ${form.websiteAdmissionOpen === value ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                          >
                            <Text className={`text-sm ${form.websiteAdmissionOpen === value ? "font-semibold text-[#1F45C7]" : "text-ink-800"}`}>{label}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <View className="mt-3">
                        <Field label="Note for parents">
                          <Input className="h-10" value={form.websiteAdmissionNote} onChangeText={(v) => patch("websiteAdmissionNote", v)} />
                        </Field>
                      </View>
                    </WebSection>

                    <WebSection
                      title="Highlights & facilities"
                      summary={`${listLines(form.websiteHighlights).length} highlights · ${listLines(form.websiteFacilities).length} facilities`}
                      open={webOpen.highlights}
                      onToggle={() => setWebOpen((o) => ({ ...o, highlights: !o.highlights }))}
                    >
                      <Field label="Highlights (one per line)">
                        <Input multiline className="min-h-[72px]" value={form.websiteHighlights} placeholder={"Admissions open\nSafe campus\nSmart updates"} onChangeText={(v) => patch("websiteHighlights", v)} />
                      </Field>
                      <View className="mt-3">
                        <Field label="Facilities (one per line)">
                          <Input multiline className="min-h-[72px]" value={form.websiteFacilities} placeholder={"Library\nComputer lab\nTransport"} onChangeText={(v) => patch("websiteFacilities", v)} />
                        </Field>
                      </View>
                    </WebSection>

                    <View className="flex-row items-center gap-3 rounded-2xl border border-ink-200 bg-white px-4 py-3.5">
                      <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#EEF3FF]">
                        <Ionicons name="document-text-outline" size={18} color="#1F45C7" />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="text-sm font-semibold text-ink-900">Enquiry form</Text>
                        <Text className="mt-0.5 text-xs text-ink-700">
                          {form.websiteForm.filter((field) => field.visible).length} fields shown · {form.websiteForm.filter((field) => field.required).length} required
                        </Text>
                      </View>
                      <Button variant="ghost" className="h-9 px-3" onPress={() => setWebsiteFormOpen(true)}>
                        Edit form
                      </Button>
                    </View>
                  </View>

                </View>
              </View>
            ) : null}

            {tab === "forms" ? (
              <View className="w-full max-w-[1160px] gap-4 self-center">
                <View className="flex-row items-start gap-3 rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3">
                  <Ionicons name="link-outline" size={18} color="#1d4ed8" style={{ marginTop: 1 }} />
                  <Text className="min-w-0 flex-1 text-sm leading-5 text-ink-800">
                    <Text className="font-semibold text-ink-900">Fields with the same name share answers.</Text> What a parent fills on the website enquiry is already filled in when you admit the student.
                  </Text>
                </View>
                <View className="flex-row flex-wrap gap-4">
                  {([
                    { key: "website", title: "Website enquiry form", body: "Short form for your school website and walk-in enquiries.", who: "Parents", where: "School website", icon: "globe-outline", fields: form.websiteForm, open: () => setWebsiteFormOpen(true) },
                    { key: "admission", title: "Student admission form", body: "The full record the office needs to enrol a student.", who: "Office", where: "Add student", icon: "school-outline", fields: form.admissionForm, open: () => setAdmissionFormOpen(true) },
                    { key: "staff", title: "Staff onboarding form", body: "Employee details, upload templates and document collection.", who: "Office & staff", where: "Add employee", icon: "briefcase-outline", fields: form.staffOnboardingForm, open: () => setStaffFormOpen(true) },
                  ] as const).map((card) => {
                    const shownCount = card.fields.filter((field) => field.visible).length;
                    const requiredCount = card.fields.filter((field) => field.required).length;
                    const hiddenCount = card.fields.length - shownCount;
                    const ready = card.fields.length > 0;
                    return (
                      <Pressable
                        key={card.key}
                        accessibilityRole="button"
                        accessibilityLabel={`${edit ? "Edit" : "View"} ${card.title}`}
                        onPress={card.open}
                        className={`${phone ? "w-full" : "min-w-[280px] flex-1"} rounded-xl border border-ink-200 bg-white p-5 hover:border-blue-300 hover:bg-slate-50`}
                      >
                        <View className="flex-row items-start justify-between gap-3">
                          <View className="h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
                            <Ionicons name={card.icon} size={22} color="#1d4ed8" />
                          </View>
                          <Badge tone={ready ? "leaf" : "warn"}>{ready ? "Ready" : "Not set up"}</Badge>
                        </View>
                        <Text className="mt-4 text-base font-semibold text-ink-900">{card.title}</Text>
                        <Text className="mt-1 text-sm leading-5 text-ink-700">{card.body}</Text>

                        <View className="mt-4 gap-1.5">
                          <View className="flex-row items-center gap-2">
                            <Ionicons name="person-outline" size={13} color="#64748b" />
                            <Text className="text-xs text-ink-700">Filled by <Text className="font-semibold text-ink-900">{card.who}</Text></Text>
                          </View>
                          <View className="flex-row items-center gap-2">
                            <Ionicons name="location-outline" size={13} color="#64748b" />
                            <Text className="text-xs text-ink-700">Used in <Text className="font-semibold text-ink-900">{card.where}</Text></Text>
                          </View>
                        </View>

                        <View className="mt-auto pt-5">
                          <View className="flex-row overflow-hidden rounded-lg border border-ink-100 bg-ink-50">
                            {[
                              { label: "Shown", value: shownCount },
                              { label: "Required", value: requiredCount },
                              { label: "Hidden", value: hiddenCount },
                            ].map((stat, i) => (
                              <View key={stat.label} className={`flex-1 items-center py-2.5 ${i ? "border-l border-ink-100" : ""}`}>
                                <Text className="text-lg font-semibold text-ink-900">{stat.value}</Text>
                                <Text className="text-[11px] text-ink-600">{stat.label}</Text>
                              </View>
                            ))}
                          </View>
                          <View className="mt-4 flex-row items-center justify-between border-t border-ink-100 pt-3">
                            <Text className="text-sm font-semibold text-blue-700">{edit ? (ready ? "Edit form" : "Set up form") : "View form"}</Text>
                            <Ionicons name="arrow-forward" size={16} color="#1d4ed8" />
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {showSave ? (
              <View className={`mt-5 flex-row flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4 ${tab === "website" ? "sticky bottom-0 z-10 bg-white pb-3 pr-20" : ""}`}>
                <Text className="text-[11px] text-ink-700">{tab === "website" ? "Changes go live on your website when you save." : "Saves school identity and settings only."}</Text>
                {edit ? <Button onPress={save}>Save</Button> : null}
              </View>
            ) : null}
          </View>

          {showPreview ? (
          <View className={wide ? "sticky top-6 w-80 shrink-0" : "mt-6"}>
            <View className="rounded-md border border-ink-200 bg-ink-50 p-3">
              <Text className="mb-2 text-xs font-medium text-ink-700">
                {tab === "exams"
                      ? "This year"
                      : "Asset preview"}
              </Text>
              {tab === "exams" ? (
                <View className="gap-3">
                  <Text className="text-sm text-ink-800">
                    Pass {passPercent}%{showRank ? " · rank on" : ""}
                  </Text>
                  {plan.map((row) => (
                    <View key={row.id} className="flex-row justify-between gap-2">
                      <Text className="text-sm text-ink-900">{row.name}</Text>
                      <View className="items-end">
                        <Text className="text-sm text-ink-700">
                          {row.weight}% weight · {row.maxMarks} marks
                        </Text>
                        {row.expectedPeriod ? <Text className="text-[11px] text-ink-700">{row.expectedPeriod}</Text> : null}
                      </View>
                    </View>
                  ))}
                  {plan.length ? (
                    <Text className={`text-xs ${weight === 100 ? "text-green-800" : "text-amber-900"}`}>
                      {weight === 100 ? "100% result weight allocated" : `${weight}% of 100% result weight allocated`}
                    </Text>
                  ) : (
                    <Text className="text-sm text-ink-700">No sittings yet. Add the year plan on the left.</Text>
                  )}
                </View>
              ) : tab === "identity" ? (
                <BrandAssetPreview form={form} logoPath={s?.logoPath} signPath={s?.signPath} stampPath={s?.stampPath} />
              ) : (
                <InvoicePreview form={form} logoPath={s?.logoPath} />
              )}
            </View>
          </View>
          ) : null}
        </View>
      </Card>
      )}

      <FormBuilderModal
        open={admissionFormOpen}
        title="Student admission form"
        intro="Used by Add student in the office. The full record your school needs to enrol a student."
        audience="the office"
        fields={form.admissionForm}
        suggestions={data?.school?.platformForms?.admission ?? []}
        lockedIds={LOCKED_STUDENT_ADMISSION_FIELDS}
        classOptions={admissionClassOptions}
        canEdit={edit}
        onChange={(fields) => patch("admissionForm", fields)}
        onSave={() => saveForm("saveAdmissionForm", form.admissionForm, "Admission form saved.", () => setAdmissionFormOpen(false))}
        onClose={() => setAdmissionFormOpen(false)}
      />

      <FormBuilderModal
        open={websiteFormOpen}
        title="Website enquiry form"
        intro="Shown to parents on your school website and used for walk-in enquiries. Keep it short so more parents submit it."
        audience="parents"
        fields={form.websiteForm}
        suggestions={data?.school?.platformForms?.website ?? []}
        lockedIds={LOCKED_ADMISSION_FIELDS}
        classOptions={admissionClassOptions}
        canEdit={edit}
        onChange={(fields) => patch("websiteForm", fields)}
        onSave={() => saveForm("saveWebsiteForm", form.websiteForm, "Website enquiry form saved.", () => setWebsiteFormOpen(false))}
        onClose={() => setWebsiteFormOpen(false)}
      />

      <FormBuilderModal
        open={staffFormOpen}
        title="Staff onboarding form"
        intro="Used when adding employees, for staff upload templates and document collection."
        audience="staff"
        fields={form.staffOnboardingForm}
        lockedIds={["staffName", "phone", "role", "joiningDate"]}
        suggestions={data?.school?.platformForms?.staff ?? []}
        canEdit={edit}
        onChange={(fields) => patch("staffOnboardingForm", fields)}
        onSave={() => saveForm("saveStaffOnboardingForm", form.staffOnboardingForm, "Staff onboarding form saved.", () => setStaffFormOpen(false))}
        onClose={() => setStaffFormOpen(false)}
      />

      <Modal open={addOpen} title="Add session" onClose={() => setAddOpen(false)}>
        <View className="gap-3">
          <Text className="text-sm text-ink-700">Create a year such as 2026–27. Each session keeps its own class bills.</Text>
          <View className="flex-row flex-wrap gap-3">
            <Half>
              <Field label="Starts (YYYY-MM-DD)">
                <Input value={sessionDraft.startsOn} onChangeText={(v) => setSessionDraft({ ...sessionDraft, startsOn: v })} />
              </Field>
            </Half>
            <Half>
              <Field label="Ends (YYYY-MM-DD)">
                <Input value={sessionDraft.endsOn} onChangeText={(v) => setSessionDraft({ ...sessionDraft, endsOn: v })} />
              </Field>
            </Half>
          </View>
          <Text className="text-xs font-medium text-ink-700">Copy bills from</Text>
          <View className="flex-row flex-wrap gap-2">
            <Pressable
              onPress={() => setSessionDraft({ ...sessionDraft, copyFromId: "" })}
              className={`rounded-md border px-3 py-1.5 ${!sessionDraft.copyFromId ? "border-clay-500 bg-clay-500" : "border-ink-200"}`}
            >
              <Text className={`text-sm ${!sessionDraft.copyFromId ? "text-white" : "text-ink-800"}`}>Blank</Text>
            </Pressable>
            {sessions.map((row) => (
              <Pressable
                key={row.id}
                onPress={() => setSessionDraft({ ...sessionDraft, copyFromId: row.id })}
                className={`rounded-md border px-3 py-1.5 ${sessionDraft.copyFromId === row.id ? "border-clay-500 bg-clay-500" : "border-ink-200"}`}
              >
                <Text className={`text-sm ${sessionDraft.copyFromId === row.id ? "text-white" : "text-ink-800"}`}>
                  {row.label}
                  {row.current ? " (current)" : ""}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            className="flex-row items-center gap-2"
            onPress={() => setSessionDraft({ ...sessionDraft, makeCurrent: !sessionDraft.makeCurrent })}
          >
            <View className={`h-4 w-4 rounded border ${sessionDraft.makeCurrent ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`} />
            <Text className="text-sm text-ink-800">Make this the current session</Text>
          </Pressable>
          <Button
            onPress={async () => {
              await run("createSchoolSession", sessionDraft, "Session added.");
              setAddOpen(false);
            }}
          >
            Add session
          </Button>
        </View>
      </Modal>

      {phone ? (
        <NewClassSheet
          open={classOpen}
          classes={(data?.classes ?? []).map((c) => ({ label: c.label, name: c.name, section: c.section }))}
          onClose={() => setClassOpen(false)}
          onCreate={async (name, section) => {
            await run("createClass", { name, section }, `Class ${name}-${section} added.`);
            setClassOpen(false);
          }}
        />
      ) : null}
      <Modal open={!phone && classOpen} title="New class" onClose={() => setClassOpen(false)}>
        <View className="gap-3">
          <Text className="text-sm text-ink-700">Name the section. It gets the school subject list from Subjects.</Text>
          <View className="flex-row flex-wrap gap-3">
            <Half>
              <Field label="Class">
                <Input value={classDraft.name} placeholder="3" onChangeText={(v) => setClassDraft({ ...classDraft, name: v })} />
              </Field>
            </Half>
            <Half>
              <Field label="Section">
                <Input value={classDraft.section} placeholder="A" onChangeText={(v) => setClassDraft({ ...classDraft, section: v })} />
              </Field>
            </Half>
          </View>
          <Button
            disabled={!classDraft.name.trim()}
            onPress={async () => {
              await run(
                "createClass",
                { name: classDraft.name, section: classDraft.section || "A" },
                "Class added."
              );
              setClassOpen(false);
            }}
          >
            Create class
          </Button>
        </View>
      </Modal>
    </View>
  );
}

function blankForm(s?: RecordPayload["school"]): SchoolForm {
  const website = (s as unknown as { website?: {
    enabled?: boolean;
    slug?: string;
    theme?: string;
    heroTitle?: string;
    heroSubtitle?: string;
    about?: string;
    highlights?: string[];
    facilities?: string[];
    admissionOpen?: boolean;
    admissionNote?: string;
  } })?.website;
  return {
    name: s?.name || "Anekio School",
    address: s?.address || "",
    city: s?.city || "",
    state: s?.state || "",
    pincode: s?.pincode || "",
    phone: s?.phone || "",
    email: s?.email || "",
    affiliation: s?.affiliation || "",
    gstin: s?.gstin || "",
    pan: s?.pan || "",
    upiId: s?.upiId || "",
    bankName: s?.bankName || "",
    bankAccountName: s?.bankAccountName || "",
    bankAccountNumber: s?.bankAccountNumber || "",
    bankIfsc: s?.bankIfsc || "",
    payGateway: s?.pay?.gateway || "NONE",
    payTestMode: s?.pay?.testMode ?? true,
    razorpayKeyId: s?.pay?.razorpayKeyId || "",
    razorpayKeySecret: "",
    razorpayWebhookSecret: "",
    cashfreeAppId: s?.pay?.cashfreeAppId || "",
    cashfreeSecretKey: "",
    billdeskMerchantId: s?.pay?.billdeskMerchantId || "",
    billdeskClientId: s?.pay?.billdeskClientId || "",
    billdeskSecret: "",
    aisensyApiKey: "",
    aisensyCampaign: s?.pay?.aisensyCampaign || "fee_reminder",
    resendApiKey: "",
    resendFromEmail: s?.pay?.resendFromEmail || "",
    signatory: s?.signatory || "Principal",
    invoiceStyle: s?.invoiceStyle || "classic",
    whatsappCommunityUrl: s?.whatsappCommunityUrl || "",
    websiteEnabled: website?.enabled ?? false,
    websiteSlug: website?.slug || "",
    websiteTheme: website?.theme || "blue",
    websiteHeroTitle: website?.heroTitle || `${s?.name || "Anekio School"} admissions are open`,
    websiteHeroSubtitle: website?.heroSubtitle || "Enquire for admissions, campus visits, fees, and entrance test details.",
    websiteAbout: website?.about || "We help children learn with care, structure, regular parent communication, and a safe school environment.",
    websiteHighlights: (website?.highlights || ["Admissions open", "Safe campus", "Smart parent updates", "Entrance test support"]).join("\n"),
    websiteFacilities: (website?.facilities || ["Digital classrooms", "Library", "Computer lab", "Sports", "Transport"]).join("\n"),
    websiteAdmissionOpen: website?.admissionOpen ?? true,
    websiteAdmissionNote: website?.admissionNote || "Admissions are open. Submit an enquiry and our office will contact you.",
    admissionForm: cloneFields(s?.admissionForm || []),
    websiteForm: cloneFields(s?.websiteForm || []),
    staffOnboardingForm: cloneFields(s?.staffOnboardingForm || []),
    admissionCharge: String(s?.admissionCharge || 0),
    sessionStart: s?.sessionStart || "",
    sessionEnd: s?.sessionEnd || "",
  };
}

function WebsiteMiniPreview({ form, logoPath }: { form: SchoolForm; logoPath?: string }) {
  const colors: Record<string, { main: string; soft: string; accent: string }> = {
    blue: { main: "#1d4ed8", soft: "#dbeafe", accent: "#f59e0b" },
    green: { main: "#047857", soft: "#d1fae5", accent: "#f59e0b" },
    purple: { main: "#6d28d9", soft: "#ede9fe", accent: "#f59e0b" },
    orange: { main: "#ea580c", soft: "#ffedd5", accent: "#2563eb" },
  };
  const theme = colors[form.websiteTheme] || colors.blue;
  return (
    <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <View style={{ backgroundColor: theme.main }} className="p-4">
        <View className="flex-row items-center gap-2">
          <View className="h-10 w-10 items-center justify-center rounded-lg bg-white p-1">
            {logoPath ? <AssetImage path={logoPath} className="h-8 w-8" /> : <Ionicons name="school-outline" size={22} color={theme.main} />}
          </View>
          <View className="min-w-0 flex-1">
            <Text className="font-semibold text-white" numberOfLines={1}>{form.name}</Text>
            <Text className="text-[11px] text-white/80" numberOfLines={1}>{form.affiliation || "Admissions"}</Text>
          </View>
        </View>
        <Text className="mt-5 text-xl font-semibold leading-6 text-white">{form.websiteHeroTitle || `${form.name} admissions are open`}</Text>
        <Text className="mt-2 text-xs leading-5 text-white/85">{form.websiteHeroSubtitle || "Parents can enquire online."}</Text>
      </View>
      <View className="p-4">
        <Text className="text-xs font-semibold text-ink-900">Admission enquiry form</Text>
        <View className="mt-2 gap-2">
          {form.websiteForm.filter((field) => field.visible).slice(0, 8).map((field) => (
            <View key={field.id} className="rounded-md border border-ink-200 bg-ink-50 px-3 py-2">
              <Text className="text-xs text-ink-700">{field.label}{field.required ? " *" : ""}</Text>
            </View>
          ))}
        </View>
        <View style={{ backgroundColor: theme.main }} className="mt-3 rounded-md px-3 py-2">
          <Text className="text-center text-xs font-semibold text-white">Send enquiry</Text>
        </View>
        <View className="mt-4 flex-row flex-wrap gap-1">
          {listLines(form.websiteHighlights).map((row) => (
            <View key={row} style={{ backgroundColor: theme.soft }} className="rounded-full px-2 py-1">
              <Text style={{ color: theme.main }} className="text-[10px] font-semibold">{row}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

function BrandAssetPreview({
  form,
  logoPath,
  signPath,
  stampPath,
}: {
  form: SchoolForm;
  logoPath?: string;
  signPath?: string;
  stampPath?: string;
}) {
  return (
    <View className="gap-3">
      <View className="rounded-md bg-white p-4">
        <Text className="text-[11px] font-medium uppercase text-ink-700">Letterhead</Text>
        <View className="mt-3 flex-row items-center gap-3 border-b border-ink-100 pb-3">
          <View className="h-12 w-12 items-center justify-center rounded-md border border-ink-200 bg-ink-50 p-1.5">
            {logoPath ? (
              <AssetImage path={logoPath} className="h-10 w-10" />
            ) : (
              <Ionicons name="school-outline" size={22} color="#60748d" />
            )}
          </View>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-ink-900">{form.name || "Anekio School"}</Text>
            <Text className="mt-0.5 text-[11px] text-ink-700" numberOfLines={2}>
              {[form.address, form.city, form.state].filter(Boolean).join(" · ") || "School address appears here"}
            </Text>
          </View>
        </View>
        <View className="mt-4 gap-3">
          <View className="rounded-md border border-dashed border-ink-200 bg-ink-50 p-3">
            <Text className="text-[11px] font-medium uppercase text-ink-700">Authorised signature</Text>
            <View className="mt-2 h-14 items-center justify-center rounded bg-white">
              {signPath ? (
                <AssetImage path={signPath} className="h-12 w-full" />
              ) : (
                <Text className="text-xs text-ink-500">Upload signature</Text>
              )}
            </View>
            <Text className="mt-2 text-xs font-medium text-ink-900">{form.signatory || "Principal"}</Text>
          </View>
          <View className="rounded-md border border-dashed border-ink-200 bg-ink-50 p-3">
            <Text className="text-[11px] font-medium uppercase text-ink-700">School stamp</Text>
            <View className="mt-2 h-16 items-center justify-center rounded bg-white">
              {stampPath ? (
                <AssetImage path={stampPath} className="h-14 w-20" />
              ) : (
                <Text className="text-xs text-ink-500">Upload stamp</Text>
              )}
            </View>
          </View>
        </View>
      </View>
      <View className="rounded-md border border-ink-200 bg-white p-3">
        <Text className="text-xs font-medium text-ink-900">Used in templates</Text>
        <Text className="mt-1 text-[11px] leading-4 text-ink-700">
          These assets appear in ID cards, admit cards, report cards, certificates, invoices, and custom documents.
        </Text>
      </View>
    </View>
  );
}

function InvoicePreview({ form, logoPath }: { form: SchoolForm; logoPath?: string }) {
  const place = [form.address, [form.city, form.state, form.pincode].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  const ids = [form.gstin && `GSTIN ${form.gstin}`, form.pan && `PAN ${form.pan}`].filter(Boolean).join(" · ");
  const compact = form.invoiceStyle === "compact";
  return (
    <View className="origin-top scale-[0.92] rounded-md bg-white p-4">
      <View className={`flex-row items-start justify-between gap-3 ${compact ? "border-b border-ink-200 pb-3" : "border-b-2 border-clay-500 pb-3"}`}>
        <View className="flex-1">
          {compact ? null : <Text className="text-[10px] font-medium uppercase tracking-widest text-clay-600">Proforma invoice</Text>}
          <Text className="text-base font-semibold text-ink-900">{form.name || "Anekio School"}</Text>
          {place ? <Text className="mt-1 text-[11px] text-ink-700">{place}</Text> : null}
          {form.phone || form.email ? (
            <Text className="mt-0.5 text-[11px] text-ink-700">
              {form.phone ? `Tel ${form.phone}` : ""}
              {form.phone && form.email ? " · " : ""}
              {form.email}
            </Text>
          ) : null}
          {form.affiliation ? <Text className="mt-0.5 text-[11px] text-ink-700">{form.affiliation}</Text> : null}
          {ids ? <Text className="mt-0.5 text-[11px] text-ink-700">{ids}</Text> : null}
          {compact ? <Text className="mt-2 text-[10px] font-medium uppercase text-ink-700">Proforma invoice</Text> : null}
        </View>
        {logoPath ? <AssetImage path={logoPath} className="h-12 w-12" /> : null}
      </View>
      <View className="mt-4 flex-row justify-between gap-3">
        <View>
          <Text className="text-[10px] uppercase text-ink-700">Bill to</Text>
          <Text className="text-sm font-medium text-ink-900">Sample student</Text>
          <Text className="text-xs text-ink-700">Class 2-A</Text>
        </View>
        <View className="items-end">
          <Text className="text-sm font-medium text-ink-900">August 2026 · Monthly fee</Text>
        </View>
      </View>
      <View className="mt-4 border-t border-ink-100">
        <View className="flex-row justify-between border-b border-ink-100 py-1.5">
          <Text className="text-sm text-ink-900">Tuition</Text>
          <Text className="text-sm text-ink-900">{inr(8000)}</Text>
        </View>
        <View className="flex-row justify-between border-b border-ink-100 py-1.5">
          <Text className="text-sm text-ink-900">Books</Text>
          <Text className="text-sm text-ink-900">{inr(600)}</Text>
        </View>
        <View className="flex-row justify-between py-2">
          <Text className="text-sm font-semibold text-ink-900">Total</Text>
          <Text className="text-sm font-semibold text-ink-900">{inr(8600)}</Text>
        </View>
      </View>
      <View className="mt-3 border border-ink-200 p-3">
        <Text className="text-[10px] font-medium uppercase tracking-wide text-ink-700">Pay online · Razorpay</Text>
        <Text className="mt-1 text-xs font-medium text-ink-900">https://your-school.com/pay/sample</Text>
      </View>
    </View>
  );
}
