import { useEffect, useState } from "react";
import { Image, Pressable, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Dropdown } from "./form";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Switch, Toast, useToast } from "./ui";
import { DateField } from "./date-field";
import { UploadCsvPanel } from "./upload-csv-panel";
import { DocumentStudio } from "./document-studio";
import { ClockForm, SchoolSubjectsForm } from "./school-setup";
import { useAssetUrl } from "../lib/assets";
import { act } from "../lib/mutate";
import { useRecord, type AdmissionFormField, type RecordPayload } from "../lib/record";
import { useSession } from "../lib/session";
import { pickFile, uploadFile } from "../lib/upload";

const TABS = [
  { id: "identity", label: "Identity & brand assets", hint: "Name, address, logo, signatures, and stamps", group: "School Setup" },
  { id: "sessions", label: "Sessions", hint: "Academic years and current session", group: "School Setup" },
  { id: "classes", label: "Classes", hint: "Sections and class strength", group: "School Setup" },
  { id: "clock", label: "Clock", hint: "School days and bell times. Set once.", group: "School Setup" },
  { id: "calendar", label: "Calendar", hint: "Holidays exam papers skip. Weekly offs are on Clock.", group: "School Setup" },
  { id: "subjects", label: "Subjects", hint: "What the school teaches. Add at the start.", group: "Academics" },
  { id: "exams", label: "Exams", hint: "Grade scale and this year's sittings. Every class follows this.", group: "Academics" },
  { id: "leave", label: "Leave", hint: "Planned and sick. Who can use them, and how much notice.", group: "Staff & Leave" },
  { id: "collect", label: "Collect", hint: "UPI, bank, gateway", group: "Fees" },
  { id: "documents", label: "Document Studio", hint: "Design printable PDFs. Fee amounts stay in Fees.", group: "Documents" },
  { id: "forms", label: "Forms & Templates", hint: "Configure reusable student and staff forms", group: "Admissions" },
  { id: "website", label: "School website", hint: "Public school page, admissions, enquiry form, and incoming leads", group: "Admissions" },
] as const;

type Tab = (typeof TABS)[number]["id"];
type Door = (typeof TABS)[number]["group"];
type Level = "doors" | "group" | "page";

const TAB_GROUPS = ["School Setup", "Academics", "Staff & Leave", "Fees", "Documents", "Admissions"] as const;

const DOOR_LEDE: Record<Door, string> = {
  "School Setup": "Identity, sessions, classes, calendar, and days.",
  Academics: "Subjects and this year's exams.",
  "Staff & Leave": "Leave rules for teachers, staff, and students.",
  Fees: "How parents pay and how the school collects.",
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
  admissionCharge: string;
  sessionStart: string;
  sessionEnd: string;
};

const DEFAULT_ADMISSION_FIELDS: AdmissionFormField[] = [
  { id: "studentName", label: "Student name", type: "text", required: true, visible: true, options: [], builtin: true },
  { id: "classWanted", label: "Class interested", type: "text", required: true, visible: true, options: [], builtin: true },
  { id: "guardianName", label: "Guardian name", type: "text", required: true, visible: true, options: [], builtin: true },
  { id: "phone", label: "Phone", type: "phone", required: true, visible: true, options: [], builtin: true },
  { id: "email", label: "Email", type: "email", required: false, visible: true, options: [], builtin: true },
  { id: "message", label: "Message", type: "textarea", required: false, visible: true, options: [], builtin: true },
];

const ADMISSION_FIELD_TYPE_OPTIONS = [
  { id: "text", label: "Short text" },
  { id: "textarea", label: "Long text" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "select", label: "Dropdown" },
  { id: "radio", label: "Single choice" },
  { id: "multi", label: "Multiple choice" },
  { id: "checkbox", label: "Checkbox" },
  { id: "file", label: "File upload" },
] as const;

const SCHOOL_CLASSES_FIELD_TYPE = "schoolClasses";

const ADMISSION_FILE_TYPE_OPTIONS = [
  { id: "image_pdf", label: "Image or PDF" },
  { id: "pdf", label: "PDF only" },
  { id: "image", label: "Image only" },
] as const;

const COMMON_ADMISSION_DOCUMENTS = [
  { label: "Birth certificate", fileType: "image_pdf" },
  { label: "Student photo", fileType: "image" },
  { label: "Transfer certificate", fileType: "pdf" },
  { label: "Previous marksheet", fileType: "image_pdf" },
  { label: "Parent ID proof", fileType: "image_pdf" },
  { label: "Address proof", fileType: "image_pdf" },
] as const;

const DEFAULT_STAFF_ONBOARDING_FIELDS = [
  { label: "Staff name", type: "Short text", required: true },
  { label: "Phone", type: "Phone", required: true },
  { label: "Email", type: "Email", required: false },
  { label: "Role", type: "Dropdown", required: true },
  { label: "Department", type: "Short text", required: false },
  { label: "Joining date", type: "Date", required: true },
  { label: "Qualification", type: "Short text", required: false },
  { label: "Address", type: "Long text", required: false },
] as const;

const DEFAULT_STAFF_ONBOARDING_DOCUMENTS = ["Photo", "ID proof", "Address proof", "Qualification certificate", "Experience letter"] as const;

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadCsvTemplate(filename: string, headers: string[]) {
  if (typeof document === "undefined") return false;
  const csv = `${headers.map(csvCell).join(",")}\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}

function admissionFieldId(label: string) {
  return `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field"}_${Date.now()}`;
}

function newAdmissionField(overrides: Partial<AdmissionFormField> = {}): AdmissionFormField {
  const type = overrides.type || "text";
  return {
    id: overrides.id || admissionFieldId(overrides.label || "field"),
    label: overrides.label || "New field",
    type,
    required: Boolean(overrides.required),
    visible: overrides.visible ?? true,
    options: overrides.options || [],
    builtin: false,
    helpText: overrides.helpText || "",
    fileType: type === "file" ? overrides.fileType || "image_pdf" : undefined,
    maxFileSizeMb: type === "file" ? overrides.maxFileSizeMb || 5 : undefined,
  };
}

function fieldError(field: AdmissionFormField) {
  if (!field.visible) return "";
  if (!field.label.trim()) return "Field label is required.";
  if (["select", "radio", "multi"].includes(field.type) && !field.options.length) return "Add at least one option.";
  if (field.type === "file" && !field.fileType) return "Choose accepted file types.";
  return "";
}

function fileTypeSummary(field: AdmissionFormField) {
  if (field.fileType === "image") return "JPG, PNG";
  if (field.fileType === "pdf") return "PDF";
  return "JPG, PNG, PDF";
}

function schoolClassOptions(classes?: RecordPayload["classes"]) {
  return [...new Set((classes || []).map((row) => row.label || [row.name, row.section].filter(Boolean).join("-")).filter(Boolean))];
}

function sameOptions(left: string[], right: string[]) {
  return left.length === right.length && left.every((option, index) => option === right[index]);
}

function admissionFieldTypeValue(field: AdmissionFormField, classOptions: string[]) {
  if (field.id === "classWanted" && field.type === "select" && classOptions.length && sameOptions(field.options, classOptions)) {
    return SCHOOL_CLASSES_FIELD_TYPE;
  }
  return field.type;
}

function admissionFieldTypeOptions(field: AdmissionFormField) {
  if (field.id !== "classWanted") return [...ADMISSION_FIELD_TYPE_OPTIONS];
  return [
    ...ADMISSION_FIELD_TYPE_OPTIONS.slice(0, 6),
    { id: SCHOOL_CLASSES_FIELD_TYPE, label: "School classes" },
    ...ADMISSION_FIELD_TYPE_OPTIONS.slice(6),
  ];
}

function cloneAdmissionForm(fields: AdmissionFormField[]) {
  return fields.map((field) => ({ ...field, options: [...field.options] }));
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
  const [uploadingAsset, setUploadingAsset] = useState("");
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [admissionFormOpen, setAdmissionFormOpen] = useState(false);
  const [staffFormOpen, setStaffFormOpen] = useState(false);
  const [editingAdmissionFieldId, setEditingAdmissionFieldId] = useState("");
  const [savingYearPlan, setSavingYearPlan] = useState(false);
  const [plan, setPlan] = useState<ExamPlanDraft[]>(normalizeExamPlan(s?.plan));
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeDraft[]>(normalizeLeaveTypes(data?.leaveTypes));

  useEffect(() => {
    const nextTab = tabFromParam(tabParam);
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
    setPlan(normalizeExamPlan(s.plan));
    setCalendarSessionId((current) => current || s.sessionId || "");
    if (data?.leaveTypes?.length) setLeaveTypes(normalizeLeaveTypes(data.leaveTypes));
  }, [s, data?.leaveTypes]);

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

  function patchAdmissionField(id: string, change: Partial<AdmissionFormField>) {
    setForm((row) => ({
      ...row,
      admissionForm: row.admissionForm.map((field) => field.id === id ? { ...field, ...change } : field),
    }));
  }

  function openNewAdmissionField(overrides: Partial<AdmissionFormField> = {}) {
    const next = newAdmissionField(overrides);
    patch("admissionForm", [...form.admissionForm, next]);
    setEditingAdmissionFieldId(next.id);
  }

  function duplicateAdmissionField(field: AdmissionFormField) {
    const copy = newAdmissionField({
      ...field,
      id: undefined,
      label: `${field.label} copy`,
      builtin: false,
      options: [...field.options],
    });
    patch("admissionForm", [...form.admissionForm, copy]);
    setEditingAdmissionFieldId(copy.id);
  }

  function moveAdmissionField(id: string, direction: -1 | 1) {
    const index = form.admissionForm.findIndex((field) => field.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= form.admissionForm.length) return;
    const next = [...form.admissionForm];
    const [field] = next.splice(index, 1);
    next.splice(nextIndex, 0, field);
    patch("admissionForm", next);
  }

  function addSelectedDocuments() {
    const existing = new Set(form.admissionForm.map((field) => field.label.trim().toLowerCase()));
    const docs = COMMON_ADMISSION_DOCUMENTS.filter((doc) => selectedDocs.includes(doc.label) && !existing.has(doc.label.toLowerCase()));
    if (!docs.length) {
      toast.show("Selected documents are already added.");
      return;
    }
    patch("admissionForm", [
      ...form.admissionForm,
      ...docs.map((doc) => newAdmissionField({
        label: doc.label,
        type: "file",
        required: true,
        fileType: doc.fileType as AdmissionFormField["fileType"],
        helpText: doc.fileType === "image" ? "Upload a clear image." : "Upload a readable document.",
      })),
    ]);
    setSelectedDocs([]);
  }

  function downloadStaffOnboardingTemplate() {
    const headers = [
      ...DEFAULT_STAFF_ONBOARDING_FIELDS.map((field) => field.label),
      ...DEFAULT_STAFF_ONBOARDING_DOCUMENTS.map((label) => `${label} file`),
    ];
    if (downloadCsvTemplate("staff-onboarding-template.csv", headers)) {
      toast.show("Staff onboarding template downloaded.");
      return;
    }
    toast.show("Template download is available on web.");
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
      await act(token, "saveSchoolIdentity", form);
      if (tab === "website" || tab === "forms") await act(token, "saveAdmissionForm", { fields: form.admissionForm });
      toast.show("School saved.");
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
  const showSave = tab !== "calendar" && tab !== "exams" && tab !== "clock" && tab !== "subjects" && tab !== "sessions" && tab !== "classes" && tab !== "leave" && tab !== "documents";
  const showPreview = tab === "identity" || tab === "exams";

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
    const item = TABS.find((row) => row.id === id);
    if (item) setDoor(item.group);
    setTab(id);
    setLevel("page");
    showSchool({ tab: id });
  }

  function goBack() {
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
  const editingAdmissionField = form.admissionForm.find((field) => field.id === editingAdmissionFieldId);
  const admissionClassOptions = schoolClassOptions(data?.classes);

  return (
    <View>
      {level !== "doors" ? (
        <Pressable onPress={goBack} className="mb-1 min-h-[32px] flex-row items-center gap-1">
          <Ionicons name="chevron-back" size={19} color="#1d4ed8" />
          <Text className="text-sm font-medium text-clay-600">{level === "page" ? door : "School"}</Text>
        </Pressable>
      ) : null}
      <PageHeader title={title} lede={lede} compact />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {level === "doors" ? (
        <SchoolDoors onOpen={openDoor} />
      ) : level === "group" ? (
        <SchoolGroupList group={door} onPick={openPage} />
      ) : (
      <Card className={phone ? "p-4" : "p-5"}>
        <View className={wide ? "flex-row items-start gap-6" : ""}>
          <View className={wide ? "min-w-0 flex-1" : ""}>

            {tab === "documents" && data?.documentStudio ? <DocumentStudio studio={data.documentStudio} data={data} /> : null}

            {tab === "identity" ? (
              <View className="gap-3">
                <Text className="text-sm text-ink-700">
                  {phone
                    ? "This is what parents see on pay pages. They cannot edit it."
                    : "School name and address are the billing details on parent pay pages. They cannot edit this. If this campus has a branch name, put it in School name."}
                </Text>
                <View className="flex-row flex-wrap gap-3">
                  <Half>
                    <Field label="School name">
                      <Input value={form.name} onChangeText={(v) => patch("name", v)} />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="Affiliation">
                      <Input value={form.affiliation} placeholder="CBSE / State / ICSE" onChangeText={(v) => patch("affiliation", v)} />
                    </Field>
                  </Half>
                </View>
                <View className="flex-row flex-wrap gap-3">
                  <Half>
                    <Field label="Address">
                      <Input value={form.address} onChangeText={(v) => patch("address", v)} />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="City">
                      <Input value={form.city} onChangeText={(v) => patch("city", v)} />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="State">
                      <Input value={form.state} onChangeText={(v) => patch("state", v)} />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="PIN">
                      <Input keyboardType="number-pad" value={form.pincode} onChangeText={(v) => patch("pincode", v)} />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="Phone">
                      <Input keyboardType="phone-pad" value={form.phone} onChangeText={(v) => patch("phone", v)} />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="Email">
                      <Input autoCapitalize="none" keyboardType="email-address" value={form.email} onChangeText={(v) => patch("email", v)} />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="GSTIN">
                      <Input autoCapitalize="characters" value={form.gstin} placeholder="If you charge GST" onChangeText={(v) => patch("gstin", v)} />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="PAN">
                      <Input autoCapitalize="characters" value={form.pan} onChangeText={(v) => patch("pan", v)} />
                    </Field>
                  </Half>
                </View>
                <View className="rounded-md border border-ink-200 p-4">
                  <View className="gap-3">
                    <Text className="text-sm font-medium text-ink-900">Document brand assets</Text>
                    <Text className="text-xs leading-5 text-ink-700">
                      Logo, signature, and stamp appear on report cards, certificates, invoices, and custom documents.
                    </Text>
                    <View className="rounded-md border border-ink-200 p-4">
                      <View className="flex-row flex-wrap items-center justify-between gap-4">
                        <View className="flex-row items-center gap-3">
                          <View className="h-20 w-20 items-center justify-center rounded-md border border-ink-200 bg-white p-2">
                            {s?.logoPath ? (
                              <AssetImage path={s.logoPath} className="h-16 w-16" />
                            ) : (
                              <Ionicons name="school-outline" size={30} color="#3d4f66" />
                            )}
                          </View>
                          <View>
                            <Text className="text-sm font-medium text-ink-900">School logo</Text>
                            <Text className="mt-0.5 text-xs text-ink-700">
                              {s?.logoPath ? "Current logo preview." : "Used on report cards and invoices."}
                            </Text>
                          </View>
                        </View>
                        {edit ? (
                          <Button
                            variant="ghost"
                            disabled={Boolean(uploadingAsset)}
                            onPress={() => void uploadBrandAsset("logoPath", "Logo")}
                          >
                            {uploadingAsset === "logoPath" ? "Uploading…" : s?.logoPath ? "Replace logo" : "Upload logo"}
                          </Button>
                        ) : null}
                      </View>
                    </View>
                    <View className="flex-row flex-wrap gap-3">
                      <Half>
                        <Field label="Signatory name">
                          <Input value={form.signatory} placeholder="Principal" onChangeText={(v) => patch("signatory", v)} />
                        </Field>
                      </Half>
                    </View>
                    <View className="flex-row flex-wrap gap-3">
                      <View className="min-w-[45%] flex-1 rounded-md border border-ink-200 p-4">
                        <Text className="text-sm font-medium text-ink-900">Principal signature</Text>
                        <Text className="mt-1 text-xs text-ink-700">Transparent PNG works best.</Text>
                        {s?.signPath ? <AssetImage path={s.signPath} className="my-3 h-14 w-full" /> : null}
                        {edit ? (
                          <Button
                            variant="ghost"
                            disabled={Boolean(uploadingAsset)}
                            onPress={() => void uploadBrandAsset("signPath", "Signature")}
                            className="mt-3"
                          >
                            {uploadingAsset === "signPath" ? "Uploading…" : s?.signPath ? "Replace signature" : "Upload signature"}
                          </Button>
                        ) : null}
                      </View>
                      <View className="min-w-[45%] flex-1 rounded-md border border-ink-200 p-4">
                        <Text className="text-sm font-medium text-ink-900">School stamp</Text>
                        <Text className="mt-1 text-xs text-ink-700">Optional, shown on formal documents.</Text>
                        {s?.stampPath ? <AssetImage path={s.stampPath} className="my-3 h-14 w-full" /> : null}
                        {edit ? (
                          <Button
                            variant="ghost"
                            disabled={Boolean(uploadingAsset)}
                            onPress={() => void uploadBrandAsset("stampPath", "Stamp")}
                            className="mt-3"
                          >
                            {uploadingAsset === "stampPath" ? "Uploading…" : s?.stampPath ? "Replace stamp" : "Upload stamp"}
                          </Button>
                        ) : null}
                      </View>
                    </View>
                  </View>
                </View>
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
                        {edit && !row.current ? (
                          <View className="flex-row flex-wrap gap-3">
                            <Linkish
                              label="Use as current"
                              onPress={() => run("setCurrentSchoolSession", { sessionId: row.id }, `${row.label} is current.`)}
                            />
                            {sessions.length > 1 ? (
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

            {tab === "classes" ? (
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
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-medium text-ink-900">Holiday calendar</Text>
                    <Text className="mt-0.5 text-xs text-ink-700">
                      Exam papers skip these days for {calendarSession?.label || "this session"}. Weekly offs stay on Clock.
                    </Text>
                  </View>
                  <View className="flex-row flex-wrap items-center gap-2">
                    <View className="w-56">
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

                <View className="rounded-md border border-ink-200 p-3">
                  <View className="flex-row flex-wrap items-end gap-3">
                    <View className={wide ? "w-44" : "min-w-[12rem] flex-1"}>
                      <Field label="Date">
                        <DateField value={holiday.date} placeholder="Pick date" onChange={(date) => setHoliday({ ...holiday, date })} />
                      </Field>
                    </View>
                    <View className="min-w-[14rem] flex-1">
                      <Field label="Holiday name">
                        <Input value={holiday.name} placeholder="Gandhi Jayanti" onChangeText={(v) => setHoliday({ ...holiday, name: v })} />
                      </Field>
                    </View>
                    {edit ? (
                      <Button
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
                  <View className="overflow-hidden rounded-md border border-ink-200">
                    <View className="flex-row items-center justify-between gap-2 border-b border-ink-100 bg-ink-50 px-3 py-2">
                      <Text className="text-xs font-medium text-ink-700">{calendarSession?.label || "This session"}</Text>
                      <Text className="text-xs text-ink-700">{inSession.length} day{inSession.length === 1 ? "" : "s"}</Text>
                    </View>
                    {inSession.map((h) => (
                      <View key={h.id} className="flex-row items-center justify-between gap-3 border-b border-ink-100 px-3 py-2.5 last:border-b-0">
                        <View className="min-w-0 flex-1">
                          <Text className="text-sm font-medium text-ink-900">{h.name}</Text>
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

            {tab === "leave" ? (
              <View className="mt-4 gap-3">
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-medium text-ink-900">Leave types</Text>
                    <Text className="mt-0.5 text-xs text-ink-700">
                      Decide who can apply, notice days, and yearly limits.
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
                      <View className="w-32">
                        <Text className="text-xs font-medium text-ink-700">Yearly cap</Text>
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
                      <View className={wide ? "w-32" : ""}>
                        {!wide ? <Text className="mb-1 text-xs font-medium text-ink-700">Yearly cap</Text> : null}
                        <Input
                          keyboardType="number-pad"
                          value={String(row.yearlyCap)}
                          onChangeText={(v) =>
                            setLeaveTypes((cur) =>
                              cur.map((t, n) => (n === i ? { ...t, yearlyCap: Number(v.replace(/\D/g, "") || 0) } : t))
                            )
                          }
                        />
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
                {edit ? (
                  <View className="flex-row justify-end">
                    <Button
                      onPress={() =>
                        run(
                          "saveLeavePolicy",
                          { types: leaveTypes },
                          "Leave policy saved."
                        )
                      }
                    >
                      Save leave
                    </Button>
                  </View>
                ) : null}
              </View>
            ) : null}

            {tab === "exams" ? (
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
                      {examEdit ? (
                        <Button
                          variant="ghost"
                          onPress={() =>
                            run(
                              "saveGradePolicy",
                              { passPercent: Number(passPercent), showRank, bands, reportCardPaidMonths: Number(reportCardPaidMonths) || 0 },
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
              <View className="w-full max-w-[1160px] self-center">
                <View className="rounded-xl border border-ink-200 bg-white p-4">
                  <View className="flex-row flex-wrap items-start justify-between gap-3">
                    <View className="min-w-0 flex-1">
                      <Text className="text-base font-semibold text-ink-900">{form.name || "School website"}</Text>
                      <Text className="mt-1 text-sm text-ink-700">
                        Your public school website, admissions page, and enquiry form.
                      </Text>
                      <View className="mt-2 flex-row flex-wrap items-center gap-2">
                        <Ionicons name="globe-outline" size={14} color="#1d4ed8" />
                        <Text className="text-xs font-semibold text-blue-700">{form.websiteSlug || "demo"}.anekio.com</Text>
                        <View className={`h-2 w-2 rounded-full ${form.websiteEnabled ? "bg-green-600" : "bg-ink-400"}`} />
                        <Text className="text-xs font-semibold text-ink-800">{form.websiteEnabled ? "Live" : "Offline"}</Text>
                      </View>
                    </View>
                    <View className="flex-row flex-wrap items-center gap-2">
                      <View className="flex-row items-center gap-3 rounded-md border border-ink-200 bg-white px-3 py-2">
                        <View>
                          <Text className="text-xs font-medium text-ink-700">Admission form</Text>
                          <Text className="text-[11px] font-semibold text-ink-900">
                            {form.admissionForm.filter((field) => field.visible).length} shown · {form.admissionForm.filter((field) => field.required).length} required
                          </Text>
                        </View>
                        <Button variant="ghost" className="h-9 px-3" onPress={() => setAdmissionFormOpen(true)}>
                          Edit
                        </Button>
                      </View>
                      <Button
                        variant="ghost"
                        onPress={() => {
                          if (typeof window !== "undefined") window.open(`https://${form.websiteSlug || "demo"}.anekio.com`, "_blank");
                        }}
                      >
                        Preview website
                      </Button>
                      <View className="flex-row items-center gap-3 rounded-md border border-ink-200 bg-white px-3 py-2">
                        <View className="items-end">
                          <Text className="text-xs font-medium text-ink-700">Website</Text>
                          <Text className="text-[11px] font-medium text-ink-600">{form.websiteEnabled ? "On" : "Off"}</Text>
                        </View>
                        <Switch on={form.websiteEnabled} onPress={() => patch("websiteEnabled", !form.websiteEnabled)} />
                      </View>
                    </View>
                  </View>

                  <View className="mt-4 border-t border-ink-100 pt-4">
                    <Text className="mb-3 text-sm font-semibold text-ink-900">Website setup</Text>
                    <View className="flex-row flex-wrap gap-3">
                      <View className={phone ? "w-full min-w-full" : "min-w-[520px] flex-[1.6]"}>
                        <View className="h-full rounded-lg border border-ink-200 bg-white p-3">
                          <Text className="mb-2 text-xs font-medium text-ink-700">Website address</Text>
                          <View className="overflow-hidden rounded-md border border-ink-200 bg-white">
                            <View className="flex-row items-center">
                              <View className="border-r border-ink-100 bg-ink-50 px-3 py-2.5">
                                <Text className="text-sm font-medium text-ink-600">https://</Text>
                              </View>
                              <View className="min-w-0 flex-1">
                                <Input
                                  autoCapitalize="none"
                                  className="h-10 rounded-none border-0 bg-transparent"
                                  value={form.websiteSlug}
                                  placeholder="green-valley"
                                  onChangeText={(v) => patch("websiteSlug", v.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+/g, ""))}
                                />
                              </View>
                              <View className="border-l border-ink-100 bg-ink-50 px-3 py-2.5">
                                <Text className="text-sm font-medium text-ink-600">.anekio.com</Text>
                              </View>
                            </View>
                          </View>
                        </View>
                      </View>
                      <View className={phone ? "w-full min-w-full" : "min-w-[260px] flex-1"}>
                        <View className="h-full rounded-lg border border-ink-200 bg-white p-3">
                          <Dropdown
                            label="Theme"
                            value={form.websiteTheme}
                            options={[
                              { id: "blue", label: "Blue" },
                              { id: "green", label: "Green" },
                              { id: "purple", label: "Purple" },
                              { id: "orange", label: "Orange" },
                            ]}
                            onChange={(v) => patch("websiteTheme", v)}
                          />
                        </View>
                      </View>
                    </View>
                  </View>

                  <View className="mt-4 border-t border-ink-100 pt-4">
                    <Text className="text-sm font-semibold text-ink-900">Homepage hero</Text>
                    <Text className="mt-0.5 text-xs text-ink-700">The first thing parents see when they visit your website.</Text>
                    <View className="mt-3 flex-row flex-wrap gap-3">
                      <View className={phone ? "w-full min-w-full" : "min-w-[360px] flex-1"}>
                        <Field label="Hero title">
                          <Input
                            className="h-10"
                            value={form.websiteHeroTitle}
                            placeholder={`${form.name || "School"} admissions are open`}
                            onChangeText={(v) => patch("websiteHeroTitle", v)}
                          />
                        </Field>
                      </View>
                      <View className={phone ? "w-full min-w-full" : "min-w-[360px] flex-1"}>
                        <Field label="Hero subtitle">
                          <Input
                            className="h-10"
                            value={form.websiteHeroSubtitle}
                            placeholder="Tell parents why they should enquire."
                            onChangeText={(v) => patch("websiteHeroSubtitle", v)}
                          />
                        </Field>
                      </View>
                    </View>
                  </View>

                  <View className="mt-4 border-t border-ink-100 pt-4">
                    <Text className="text-sm font-semibold text-ink-900">About your school</Text>
                    <Text className="mt-0.5 text-xs text-ink-700">Tell parents what makes your school special.</Text>
                    <View className="mt-3">
                      <Field label="About school">
                        <Input
                          multiline
                          className="min-h-[72px]"
                          value={form.websiteAbout}
                          placeholder="Short intro, teaching style, campus, values..."
                          onChangeText={(v) => patch("websiteAbout", v)}
                        />
                      </Field>
                    </View>
                  </View>

                  <View className="mt-4 border-t border-ink-100 pt-4">
                    <Text className="text-sm font-semibold text-ink-900">Admissions</Text>
                    <Text className="mt-0.5 text-xs text-ink-700">How parents understand availability and next steps.</Text>
                    <View className="mt-3 flex-row flex-wrap gap-3">
                      <View className={phone ? "w-full min-w-full" : "min-w-[220px] flex-1"}>
                        <Dropdown
                          label="Admission status"
                          value={form.websiteAdmissionOpen ? "open" : "closed"}
                          options={[
                            { id: "open", label: "Admissions open" },
                            { id: "closed", label: "Only collect enquiries" },
                          ]}
                          onChange={(v) => patch("websiteAdmissionOpen", v === "open")}
                        />
                      </View>
                      <View className={phone ? "w-full min-w-full" : "min-w-[520px] flex-[2]"}>
                        <Field label="Admission note">
                          <Input className="h-10" value={form.websiteAdmissionNote} onChangeText={(v) => patch("websiteAdmissionNote", v)} />
                        </Field>
                      </View>
                    </View>
                  </View>

                  <View className="mt-4 border-t border-ink-100 pt-4">
                    <Text className="text-sm font-semibold text-ink-900">What parents will see</Text>
                    <Text className="mt-0.5 text-xs text-ink-700">Highlights and facilities displayed on your public website.</Text>
                    <View className="mt-3 flex-row flex-wrap gap-3">
                      <View className={phone ? "w-full min-w-full" : "min-w-[320px] flex-1"}>
                        <Field label="Highlights">
                          <View className="rounded-lg border border-ink-200 bg-white p-3">
                            <Input
                              multiline
                              className="min-h-[64px] border-0 bg-transparent p-0"
                              value={form.websiteHighlights}
                              placeholder="One per line: Admissions open, Safe campus, Smart updates"
                              onChangeText={(v) => patch("websiteHighlights", v)}
                            />
                            <View className="mt-3 flex-row flex-wrap gap-2">
                              {listLines(form.websiteHighlights).map((item) => (
                                <Text key={item} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
                                  {item}
                                </Text>
                              ))}
                            </View>
                          </View>
                        </Field>
                      </View>
                      <View className={phone ? "w-full min-w-full" : "min-w-[320px] flex-1"}>
                        <Field label="Facilities">
                          <View className="rounded-lg border border-ink-200 bg-white p-3">
                            <Input
                              multiline
                              className="min-h-[64px] border-0 bg-transparent p-0"
                              value={form.websiteFacilities}
                              placeholder="One per line: Library, Computer lab, Transport"
                              onChangeText={(v) => patch("websiteFacilities", v)}
                            />
                            <View className="mt-3 flex-row flex-wrap gap-2">
                              {listLines(form.websiteFacilities).map((item) => (
                                <Text key={item} className="rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-800">
                                  {item}
                                </Text>
                              ))}
                            </View>
                          </View>
                        </Field>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            ) : null}

            {tab === "forms" ? (
              <View className="w-full max-w-[1160px] self-center">
                <View className="rounded-xl border border-ink-200 bg-white p-4">
                  <View className="border-b border-ink-100 pb-4">
                    <Text className="text-base font-semibold text-ink-900">Forms & Templates</Text>
                    <Text className="mt-1 max-w-3xl text-sm text-ink-700">
                      Configure the fields once, then reuse the same structure across website forms, office entry, downloads, and imports.
                    </Text>
                  </View>

                  <View className="mt-4 flex-row flex-wrap gap-3">
                    <View className={phone ? "w-full min-w-full" : "min-w-[360px] flex-1"}>
                      <View className="h-full rounded-lg border border-blue-100 bg-blue-50 p-4">
                        <View className="flex-row items-start justify-between gap-3">
                          <View className="min-w-0 flex-1">
                            <Text className="text-sm font-semibold text-ink-900">Student admission form</Text>
                            <Text className="mt-1 text-xs leading-5 text-ink-700">
                              Used by the public school website, office walk-in leads, and future admission templates.
                            </Text>
                          </View>
                          <View className="rounded-md border border-blue-100 bg-white px-2.5 py-1.5">
                            <Text className="text-[11px] font-semibold text-blue-700">
                              {form.admissionForm.filter((field) => field.visible).length} shown · {form.admissionForm.filter((field) => field.required).length} required
                            </Text>
                          </View>
                        </View>
                        <View className="mt-4 flex-row flex-wrap gap-2">
                          <Button onPress={() => setAdmissionFormOpen(true)}>Edit form</Button>
                          <Button variant="ghost" disabled>
                            Download template
                          </Button>
                        </View>
                      </View>
                    </View>

                    <View className={phone ? "w-full min-w-full" : "min-w-[360px] flex-1"}>
                      <View className="h-full rounded-lg border border-ink-200 bg-white p-4">
                        <View className="flex-row items-start justify-between gap-3">
                          <View className="min-w-0 flex-1">
                            <Text className="text-sm font-semibold text-ink-900">Staff onboarding form</Text>
                            <Text className="mt-1 text-xs leading-5 text-ink-700">
                              Default staff intake fields for onboarding, upload templates, and document collection.
                            </Text>
                          </View>
                          <View className="rounded-md border border-ink-100 bg-ink-50 px-2.5 py-1.5">
                            <Text className="text-[11px] font-semibold text-ink-800">
                              {DEFAULT_STAFF_ONBOARDING_FIELDS.length} fields · {DEFAULT_STAFF_ONBOARDING_FIELDS.filter((field) => field.required).length} required
                            </Text>
                          </View>
                        </View>
                        <View className="mt-4 flex-row flex-wrap gap-2">
                          <Button variant="ghost" onPress={() => setStaffFormOpen(true)}>
                            View form
                          </Button>
                          <Button variant="ghost" onPress={downloadStaffOnboardingTemplate}>
                            Download template
                          </Button>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View className="mt-4 rounded-lg border border-ink-200 bg-ink-50 p-4">
                    <Text className="text-sm font-semibold text-ink-900">How this connects</Text>
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      {["Website form", "Office walk-in form", "Download template", "Import validation"].map((item) => (
                        <Text key={item} className="rounded-full bg-white px-3 py-1 text-xs font-medium text-ink-800">
                          {item}
                        </Text>
                      ))}
                    </View>
                  </View>
                </View>
              </View>
            ) : null}

            {showSave ? (
              <View className={`mt-5 flex-row flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4 ${tab === "website" || tab === "forms" ? "pr-20" : ""}`}>
                <Text className="text-[11px] text-ink-700">Saves school settings together.</Text>
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

      <Modal open={admissionFormOpen} title="Admission form" onClose={() => setAdmissionFormOpen(false)}>
        <View className="gap-4">
          <View className="rounded-md border border-blue-100 bg-white p-3">
            <View className="flex-row flex-wrap items-center justify-between gap-2">
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-semibold text-ink-900">Common documents</Text>
                <Text className="mt-1 text-[11px] leading-4 text-ink-700">Select proofs to request during enquiry.</Text>
              </View>
              <Button variant="ghost" disabled={!selectedDocs.length} onPress={addSelectedDocuments}>
                Add {selectedDocs.length || ""}
              </Button>
            </View>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {COMMON_ADMISSION_DOCUMENTS.map((doc) => {
                const selected = selectedDocs.includes(doc.label);
                const added = form.admissionForm.some((field) => field.label.trim().toLowerCase() === doc.label.toLowerCase());
                return (
                  <Pressable
                    key={doc.label}
                    disabled={added}
                    onPress={() => setSelectedDocs((rows) => selected ? rows.filter((row) => row !== doc.label) : [...rows, doc.label])}
                    className={`flex-row items-center gap-1 rounded-md border px-2.5 py-1.5 ${
                      added ? "border-ink-100 bg-ink-50" : selected ? "border-blue-300 bg-blue-50" : "border-ink-200 bg-white"
                    }`}
                  >
                    <Ionicons
                      name={added ? "checkmark-done-outline" : selected ? "checkbox-outline" : "square-outline"}
                      size={15}
                      color={added ? "#64748b" : selected ? "#1d4ed8" : "#3d4f66"}
                    />
                    <Text className={`text-[11px] font-medium ${added ? "text-ink-500" : selected ? "text-blue-900" : "text-ink-800"}`}>
                      {doc.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View className="overflow-hidden rounded-md border border-ink-200 bg-white">
            <View className="flex-row flex-wrap items-center justify-between gap-2 border-b border-ink-100 bg-ink-50 px-3 py-2.5">
              <View>
                <Text className="text-sm font-semibold text-ink-900">Form fields</Text>
                <Text className="mt-0.5 text-[11px] text-ink-700">{form.admissionForm.filter((field) => field.visible).length} shown to parents</Text>
              </View>
              <Button variant="ghost" onPress={() => openNewAdmissionField()} className="py-2">
                Add field
              </Button>
            </View>
            {!form.admissionForm.length ? (
              <View className="items-center p-5">
                <Ionicons name="document-text-outline" size={26} color="#64748b" />
                <Text className="mt-2 text-sm font-semibold text-ink-900">No fields yet</Text>
                <Button variant="ghost" className="mt-3" onPress={() => openNewAdmissionField()}>
                  Add field
                </Button>
              </View>
            ) : null}
            {form.admissionForm.map((field, index) => (
              <View key={field.id} className="border-b border-ink-100 px-3 py-2.5 last:border-b-0">
                <View className={phone ? "gap-2" : "flex-row items-center gap-3"}>
                  <View className="flex-row gap-1">
                    <Pressable
                      accessibilityLabel={`Move ${field.label} up`}
                      disabled={index === 0}
                      onPress={() => moveAdmissionField(field.id, -1)}
                      className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white"
                    >
                      <Ionicons name="chevron-up" size={16} color={index === 0 ? "#94a3b8" : "#3d4f66"} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Move ${field.label} down`}
                      disabled={index === form.admissionForm.length - 1}
                      onPress={() => moveAdmissionField(field.id, 1)}
                      className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white"
                    >
                      <Ionicons name="chevron-down" size={16} color={index === form.admissionForm.length - 1 ? "#94a3b8" : "#3d4f66"} />
                    </Pressable>
                  </View>
                  <Pressable onPress={() => setEditingAdmissionFieldId(field.id)} className="min-w-0 flex-1">
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-sm font-semibold text-ink-900">{field.label || "Untitled field"}</Text>
                      <Badge tone={field.visible ? "clay" : "ink"}>{field.visible ? "Shown" : "Hidden"}</Badge>
                      {field.required ? <Badge tone="warn">Required</Badge> : null}
                      {fieldError(field) ? <Badge tone="danger">Fix</Badge> : null}
                    </View>
                    <Text className="mt-1 text-[11px] text-ink-700" numberOfLines={1}>
                      {ADMISSION_FIELD_TYPE_OPTIONS.find((option) => option.id === field.type)?.label || field.type}
                      {field.type === "file" ? ` · ${fileTypeSummary(field)} · ${field.maxFileSizeMb || 5} MB` : ""}
                      {field.helpText ? ` · ${field.helpText}` : ""}
                    </Text>
                  </Pressable>
                  <View className="flex-row items-center gap-2">
                    <Pressable
                      accessibilityLabel={`${field.visible ? "Hide" : "Show"} ${field.label}`}
                      onPress={() => patchAdmissionField(field.id, { visible: !field.visible, required: field.visible ? false : field.required })}
                      className={`h-8 w-8 items-center justify-center rounded-md border ${field.visible ? "border-blue-200 bg-blue-50" : "border-ink-200 bg-white"}`}
                    >
                      <Ionicons name={field.visible ? "eye-outline" : "eye-off-outline"} size={16} color={field.visible ? "#1d4ed8" : "#64748b"} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Edit ${field.label}`}
                      onPress={() => setEditingAdmissionFieldId(field.id)}
                      className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white"
                    >
                      <Ionicons name="create-outline" size={16} color="#3d4f66" />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </View>
          <View className="items-end">
            <Button
              onPress={async () => {
                if (await save()) setAdmissionFormOpen(false);
              }}
            >
              Save
            </Button>
          </View>
        </View>
      </Modal>

      <Modal open={staffFormOpen} title="Staff onboarding form" onClose={() => setStaffFormOpen(false)}>
        <View className="gap-4">
          <View className="rounded-md border border-ink-200 bg-ink-50 p-3">
            <Text className="text-sm font-semibold text-ink-900">Default staff onboarding form</Text>
            <Text className="mt-1 text-xs leading-4 text-ink-700">
              This default structure can be used for staff onboarding and the staff upload template.
            </Text>
          </View>
          <View className="overflow-hidden rounded-md border border-ink-200 bg-white">
            <View className="border-b border-ink-100 bg-ink-50 px-3 py-2.5">
              <Text className="text-sm font-semibold text-ink-900">Fields</Text>
            </View>
            {DEFAULT_STAFF_ONBOARDING_FIELDS.map((field) => (
              <View key={field.label} className="flex-row items-center justify-between gap-3 border-b border-ink-100 px-3 py-2.5 last:border-b-0">
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-ink-900">{field.label}</Text>
                  <Text className="mt-0.5 text-[11px] text-ink-700">{field.type}</Text>
                </View>
                {field.required ? <Badge tone="warn">Required</Badge> : <Badge tone="ink">Optional</Badge>}
              </View>
            ))}
          </View>
          <View className="rounded-md border border-ink-200 bg-white p-3">
            <Text className="text-sm font-semibold text-ink-900">Documents</Text>
            <View className="mt-3 flex-row flex-wrap gap-2">
              {DEFAULT_STAFF_ONBOARDING_DOCUMENTS.map((doc) => (
                <Text key={doc} className="rounded-md border border-ink-200 bg-ink-50 px-2.5 py-1.5 text-[11px] font-medium text-ink-800">
                  {doc}
                </Text>
              ))}
            </View>
          </View>
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={downloadStaffOnboardingTemplate}>
              Download template
            </Button>
            <Button onPress={() => setStaffFormOpen(false)}>Done</Button>
          </View>
        </View>
      </Modal>

      <Modal open={Boolean(editingAdmissionField)} title="Edit admission field" onClose={() => setEditingAdmissionFieldId("")}>
        {editingAdmissionField ? (
          <View className="gap-3">
            <Field label="Field label">
              <Input
                value={editingAdmissionField.label}
                onChangeText={(label) => patchAdmissionField(editingAdmissionField.id, { label })}
              />
            </Field>
            <Dropdown
              label="Input type"
              value={admissionFieldTypeValue(editingAdmissionField, admissionClassOptions)}
              options={admissionFieldTypeOptions(editingAdmissionField)}
              onChange={(type) => {
                const useSchoolClasses = type === SCHOOL_CLASSES_FIELD_TYPE;
                const nextType = (useSchoolClasses ? "select" : type) as AdmissionFormField["type"];
                const choiceType = ["select", "radio", "multi"].includes(nextType);
                const seededOptions = useSchoolClasses
                  ? admissionClassOptions
                  : editingAdmissionField.options;
                patchAdmissionField(editingAdmissionField.id, {
                  type: nextType,
                  options: choiceType ? seededOptions : [],
                  fileType: nextType === "file" ? editingAdmissionField.fileType || "image_pdf" : undefined,
                  maxFileSizeMb: nextType === "file" ? editingAdmissionField.maxFileSizeMb || 5 : undefined,
                });
              }}
            />
            {["select", "radio", "multi"].includes(editingAdmissionField.type) ? (
              <Field
                label="Options"
                hint={admissionFieldTypeValue(editingAdmissionField, admissionClassOptions) === SCHOOL_CLASSES_FIELD_TYPE ? "Linked from School setup classes. Edit lines here to override." : "One option per line"}
              >
                <Input
                  multiline
                  value={editingAdmissionField.options.join("\n")}
                  onChangeText={(value) =>
                    patchAdmissionField(editingAdmissionField.id, {
                      options: value.split(/\n|,/).map((option) => option.trim()).filter(Boolean),
                    })
                  }
                />
              </Field>
            ) : null}
            {editingAdmissionField.type === "file" ? (
              <View className="flex-row flex-wrap gap-3">
                <View className="min-w-[180px] flex-1">
                  <Dropdown
                    label="Accepted files"
                    value={editingAdmissionField.fileType || "image_pdf"}
                    options={[...ADMISSION_FILE_TYPE_OPTIONS]}
                    onChange={(fileType) => patchAdmissionField(editingAdmissionField.id, { fileType: fileType as AdmissionFormField["fileType"] })}
                  />
                </View>
                <View className="min-w-[150px] flex-1">
                  <Field label="Max size (MB)">
                    <Input
                      keyboardType="number-pad"
                      value={String(editingAdmissionField.maxFileSizeMb || 5)}
                      onChangeText={(value) =>
                        patchAdmissionField(editingAdmissionField.id, {
                          maxFileSizeMb: Math.min(12, Math.max(1, Number(value.replace(/[^0-9]/g, "")) || 1)),
                        })
                      }
                    />
                  </Field>
                </View>
              </View>
            ) : null}
            <Field label="Help text">
              <Input
                value={editingAdmissionField.helpText || ""}
                placeholder={editingAdmissionField.type === "file" ? `Accepted: ${fileTypeSummary(editingAdmissionField)} · up to ${editingAdmissionField.maxFileSizeMb || 5} MB` : "Optional parent guidance"}
                onChangeText={(helpText) => patchAdmissionField(editingAdmissionField.id, { helpText })}
              />
            </Field>
            <View className="flex-row flex-wrap items-center gap-5">
              <View className="flex-row items-center gap-2">
                <Switch
                  on={editingAdmissionField.visible}
                  onPress={() =>
                    patchAdmissionField(editingAdmissionField.id, {
                      visible: !editingAdmissionField.visible,
                      required: editingAdmissionField.visible ? false : editingAdmissionField.required,
                    })
                  }
                />
                <Text className="text-xs font-medium text-ink-800">Show field</Text>
              </View>
              <View className="flex-row items-center gap-2">
                <Switch
                  disabled={!editingAdmissionField.visible}
                  on={editingAdmissionField.required}
                  onPress={() => patchAdmissionField(editingAdmissionField.id, { required: !editingAdmissionField.required })}
                />
                <Text className="text-xs font-medium text-ink-800">Required</Text>
              </View>
            </View>
            {fieldError(editingAdmissionField) ? <Text className="text-xs font-medium text-red-700">{fieldError(editingAdmissionField)}</Text> : null}
            <View className="mt-2 flex-row flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
              <View className="flex-row flex-wrap gap-2">
                <Button variant="ghost" onPress={() => duplicateAdmissionField(editingAdmissionField)}>
                  Duplicate
                </Button>
                {!editingAdmissionField.builtin ? (
                  <Button
                    variant="ghost"
                    onPress={() => {
                      patch("admissionForm", form.admissionForm.filter((row) => row.id !== editingAdmissionField.id));
                      setEditingAdmissionFieldId("");
                    }}
                  >
                    Delete
                  </Button>
                ) : null}
              </View>
              <Button onPress={() => setEditingAdmissionFieldId("")}>Done</Button>
            </View>
          </View>
        ) : null}
      </Modal>

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

      <Modal open={classOpen} title="New class" onClose={() => setClassOpen(false)}>
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
    websiteSlug: website?.slug || "demo",
    websiteTheme: website?.theme || "blue",
    websiteHeroTitle: website?.heroTitle || `${s?.name || "Anekio School"} admissions are open`,
    websiteHeroSubtitle: website?.heroSubtitle || "Enquire for admissions, campus visits, fees, and entrance test details.",
    websiteAbout: website?.about || "We help children learn with care, structure, regular parent communication, and a safe school environment.",
    websiteHighlights: (website?.highlights || ["Admissions open", "Safe campus", "Smart parent updates", "Entrance test support"]).join("\n"),
    websiteFacilities: (website?.facilities || ["Digital classrooms", "Library", "Computer lab", "Sports", "Transport"]).join("\n"),
    websiteAdmissionOpen: website?.admissionOpen ?? true,
    websiteAdmissionNote: website?.admissionNote || "Admissions are open. Submit an enquiry and our office will contact you.",
    admissionForm: cloneAdmissionForm(s?.admissionForm?.length ? s.admissionForm : DEFAULT_ADMISSION_FIELDS),
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
          {form.admissionForm.filter((field) => field.visible).slice(0, 8).map((field) => (
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
