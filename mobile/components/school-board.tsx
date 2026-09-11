import { useEffect, useState } from "react";
import { Image, Pressable, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Dropdown } from "./form";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Switch, Toast, useToast } from "./ui";
import { DocumentStudio } from "./document-studio";
import { ClockForm, SchoolSubjectsForm } from "./school-setup";
import { StaffHoursForm } from "./staff-hours-form";
import { webOrigin } from "../lib/api";
import { act, saveLateTiming } from "../lib/mutate";
import { useRecord, type AdmissionFormField, type RecordPayload } from "../lib/record";
import { useSession } from "../lib/session";
import { pickFile, uploadFile } from "../lib/upload";

const TABS = [
  { id: "identity", label: "Identity & brand assets", hint: "Name, address, logo, signatures, and stamps", group: "School" },
  { id: "sessions", label: "Sessions", hint: "Academic years and current session", group: "School" },
  { id: "classes", label: "Classes", hint: "Sections and class strength", group: "School" },
  { id: "clock", label: "Clock", hint: "School days and bell times. Set once.", group: "School" },
  { id: "subjects", label: "Subjects", hint: "What the school teaches. Add at the start.", group: "Teaching" },
  { id: "calendar", label: "Calendar", hint: "Holidays exam papers skip. Weekly offs are on Clock.", group: "Teaching" },
  { id: "leave", label: "Leave", hint: "Planned and sick. Who can use them, and how much notice.", group: "Teaching" },
  { id: "exams", label: "Exams", hint: "Grade scale and this year's sittings. Every class follows this.", group: "Teaching" },
  { id: "collect", label: "Collect", hint: "UPI, bank, gateway", group: "Money" },
  { id: "documents", label: "Document Studio", hint: "Design printable PDFs. Fee amounts stay in Fees. WhatsApp stays in Communication.", group: "Documents" },
  { id: "website", label: "Admissions website", hint: "Public school page, enquiry form, and incoming leads", group: "Reach" },
  { id: "communication", label: "Communication", hint: "Configure campaign: AiSensy API key and campaign name. Message wording stays in Meta / AiSensy.", group: "Reach" },
] as const;

type Tab = (typeof TABS)[number]["id"];
type Door = (typeof TABS)[number]["group"];
type Level = "doors" | "group" | "page";

const TAB_GROUPS = ["School", "Teaching", "Money", "Documents", "Reach"] as const;

const DOOR_LEDE: Record<Door, string> = {
  School: "Name, logo, academic years, classes, and days.",
  Teaching: "Subjects, holidays, leave, and this year's exams.",
  Money: "How parents pay and how the school collects.",
  Documents: "Design report cards, IDs, receipts, certificates, and letters.",
  Reach: "School WhatsApp and email.",
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

const WHATSAPP_TEMPLATE = `Dear Parent,

This is a reminder that the school fee for *{{1}}* ({{2}}) is pending.

Amount due: *₹{{3}}*

Please complete the payment using this secure link:
{{4}}

If you have already paid, please ignore this message.

Thank you.`;

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

function assetUrl(rel?: string) {
  if (!rel) return "";
  return `${webOrigin()}/api/files/${rel}`;
}

function listLines(value: string) {
  return value.split(/\n|,/).map((line) => line.trim()).filter(Boolean).slice(0, 6);
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
  const [door, setDoor] = useState<Door>(linked?.group ?? linkedGroup ?? "School");
  const [level, setLevel] = useState<Level>(linked ? "page" : linkedGroup ? "group" : "doors");
  const [form, setForm] = useState<SchoolForm>(blankForm(s));
  const [holiday, setHoliday] = useState({ date: "", name: "" });
  const [pasted, setPasted] = useState("");
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
      if (tab === "website") await act(token, "saveAdmissionForm", { fields: form.admissionForm });
      toast.show("School saved.");
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function uploadBrandAsset(field: "logoPath" | "signPath" | "stampPath", label: string) {
    try {
      const file = await pickFile("image/png,image/jpeg,image/webp");
      if (!file) return;
      setUploadingAsset(field);
      const uploaded = await uploadFile(token, file, { kind: "school" });
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
    setPasted("");
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
  const showPreview = tab === "identity" || tab === "communication" || tab === "exams" || tab === "website";

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

  return (
    <View>
      {level !== "doors" ? (
        <Pressable onPress={goBack} className="mb-2 min-h-[44px] flex-row items-center gap-1">
          <Ionicons name="chevron-back" size={20} color="#1d4ed8" />
          <Text className="text-sm font-medium text-clay-600">{level === "page" ? door : "School"}</Text>
        </Pressable>
      ) : null}
      <PageHeader title={title} lede={lede} />
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
                              <Image source={{ uri: assetUrl(s.logoPath) }} className="h-16 w-16" resizeMode="contain" />
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
                        {s?.signPath ? <Image source={{ uri: assetUrl(s.signPath) }} className="my-3 h-14 w-full" resizeMode="contain" /> : null}
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
                        {s?.stampPath ? <Image source={{ uri: assetUrl(s.stampPath) }} className="my-3 h-14 w-full" resizeMode="contain" /> : null}
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
                  await run("addPeriod", payload, "Period added.");
                }}
                onDelete={async (id) => {
                  await run("deletePeriod", { id }, "Period removed.");
                }}
              />
              <StaffHoursForm
                rules={data?.payrollRules}
                canEdit={edit}
                onSave={async (payload) => {
                  await saveLateTiming(token, payload);
                  toast.show("Attendance hours saved.");
                  await reload();
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
                        <Input value={holiday.date} placeholder="2026-10-02" onChangeText={(v) => setHoliday({ ...holiday, date: v })} />
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

                <Modal open={calendarImportOpen} title="Import holiday CSV" onClose={() => setCalendarImportOpen(false)}>
                  <View className="gap-4">
                    <View className="rounded-md bg-ink-50 p-3">
                      <Text className="text-sm font-medium text-ink-900">Use columns date and name.</Text>
                      <Text className="mt-1 text-xs text-ink-700">
                        Holidays import into {calendarSession?.label || "this session"}. Existing dates are skipped.
                      </Text>
                    </View>
                    <View className="flex-row flex-wrap gap-2">
                      <Button variant="ghost" onPress={downloadCalendarSampleCsv}>
                        Download sample
                      </Button>
                      <Button onPress={() => void uploadHolidayCsv()}>
                        Upload CSV
                      </Button>
                    </View>
                    <Field label="Or paste CSV">
                      <Input
                        multiline
                        numberOfLines={4}
                        value={pasted}
                        placeholder={"date,name\n2026-10-02,Gandhi Jayanti"}
                        onChangeText={setPasted}
                        className="min-h-[96px]"
                      />
                    </Field>
                    <View className="flex-row justify-end gap-2">
                      <Button variant="ghost" onPress={() => setPasted(SAMPLE_CSV)}>
                        Fill sample
                      </Button>
                      <Button disabled={!pasted.trim()} onPress={() => void importHolidayCsv(pasted)}>
                        Import
                      </Button>
                    </View>
                  </View>
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
              <View className="gap-4">
                <View className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <View className="flex-row flex-wrap items-start justify-between gap-3">
                    <View className="min-w-0 flex-1">
                      <Text className="text-base font-semibold text-blue-950">School admissions website</Text>
                      <Text className="mt-1 text-sm leading-5 text-blue-900">
                        A simple public page with school details and an enquiry form. Every submitted form becomes a lead here.
                      </Text>
                      <Text className="mt-2 text-xs font-semibold text-blue-800">
                        https://{form.websiteSlug || "demo"}.anekio.com
                      </Text>
                    </View>
                    <Button variant={form.websiteEnabled ? "primary" : "ghost"} onPress={() => patch("websiteEnabled", !form.websiteEnabled)}>
                      {form.websiteEnabled ? "Website on" : "Website off"}
                    </Button>
                  </View>
                </View>
                <View className="flex-row flex-wrap gap-3">
                  <Half>
                    <Field label="Website slug">
                      <Input
                        autoCapitalize="none"
                        value={form.websiteSlug}
                        placeholder="green-valley"
                        onChangeText={(v) => patch("websiteSlug", v.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                      />
                    </Field>
                  </Half>
                  <Half>
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
                  </Half>
                </View>
                <Field label="Hero title">
                  <Input value={form.websiteHeroTitle} placeholder={`${form.name || "School"} admissions are open`} onChangeText={(v) => patch("websiteHeroTitle", v)} />
                </Field>
                <Field label="Hero subtitle">
                  <Input
                    multiline
                    value={form.websiteHeroSubtitle}
                    placeholder="Tell parents why they should enquire."
                    onChangeText={(v) => patch("websiteHeroSubtitle", v)}
                  />
                </Field>
                <Field label="About school">
                  <Input multiline value={form.websiteAbout} placeholder="Short intro, teaching style, campus, values…" onChangeText={(v) => patch("websiteAbout", v)} />
                </Field>
                <View className="flex-row flex-wrap gap-3">
                  <Half>
                    <Field label="Highlights">
                      <Input
                        multiline
                        value={form.websiteHighlights}
                        placeholder="One per line: Admissions open, Safe campus, Smart updates"
                        onChangeText={(v) => patch("websiteHighlights", v)}
                      />
                    </Field>
                  </Half>
                  <Half>
                    <Field label="Facilities">
                      <Input
                        multiline
                        value={form.websiteFacilities}
                        placeholder="One per line: Library, Computer lab, Transport"
                        onChangeText={(v) => patch("websiteFacilities", v)}
                      />
                    </Field>
                  </Half>
                </View>
                <View className="flex-row flex-wrap gap-3">
                  <Half>
                    <Dropdown
                      label="Admission status"
                      value={form.websiteAdmissionOpen ? "open" : "closed"}
                      options={[
                        { id: "open", label: "Admissions open" },
                        { id: "closed", label: "Only collect enquiries" },
                      ]}
                      onChange={(v) => patch("websiteAdmissionOpen", v === "open")}
                    />
                  </Half>
                  <Half>
                    <Field label="Admission note">
                      <Input value={form.websiteAdmissionNote} onChangeText={(v) => patch("websiteAdmissionNote", v)} />
                    </Field>
                  </Half>
                </View>
                <Field label="Admission charge" hint="Default amount collected before a lead becomes a student. Use 0 when no charge applies.">
                  <Input
                    keyboardType="number-pad"
                    value={form.admissionCharge}
                    placeholder="0"
                    onChangeText={(v) => patch("admissionCharge", v.replace(/[^0-9]/g, ""))}
                  />
                </Field>
                <View className="mt-2 rounded-xl border border-ink-200 bg-ink-50 p-4">
                  <View className="flex-row flex-wrap items-start justify-between gap-3">
                    <View className="min-w-0 flex-1">
                      <Text className="text-base font-semibold text-ink-900">Admission form fields</Text>
                      <Text className="mt-1 text-xs leading-5 text-ink-700">
                        This form is used on the public admissions website and when the office adds a walk-in lead.
                      </Text>
                    </View>
                    <Button
                      variant="ghost"
                      onPress={() => {
                        const id = `custom_${Date.now()}`;
                        patch("admissionForm", [...form.admissionForm, { id, label: "New field", type: "text", required: false, visible: true, options: [], builtin: false }]);
                      }}
                    >
                      Add field
                    </Button>
                  </View>
                  <View className="mt-4 gap-3">
                    {form.admissionForm.map((field) => (
                      <View key={field.id} className="rounded-md border border-ink-200 bg-white p-3">
                        <View className="flex-row flex-wrap items-end gap-3">
                          <View className="min-w-[210px] flex-1">
                            <Field label="Field label">
                              <Input value={field.label} onChangeText={(label) => patchAdmissionField(field.id, { label })} />
                            </Field>
                          </View>
                          <View className="min-w-[180px] flex-1">
                            <Dropdown
                              label="Input type"
                              value={field.type}
                              options={[
                                { id: "text", label: "Short text" },
                                { id: "textarea", label: "Long text" },
                                { id: "email", label: "Email" },
                                { id: "phone", label: "Phone" },
                                { id: "number", label: "Number" },
                                { id: "date", label: "Date" },
                                { id: "select", label: "Dropdown" },
                              ]}
                              onChange={(type) => patchAdmissionField(field.id, { type: type as AdmissionFormField["type"], options: type === "select" ? field.options : [] })}
                            />
                          </View>
                          {!field.builtin ? (
                            <Button variant="ghost" onPress={() => patch("admissionForm", form.admissionForm.filter((row) => row.id !== field.id))}>
                              Remove
                            </Button>
                          ) : null}
                        </View>
                        {field.type === "select" ? (
                          <Field label="Dropdown options" hint="One option per line">
                            <Input
                              multiline
                              value={field.options.join("\n")}
                              onChangeText={(value) => patchAdmissionField(field.id, { options: value.split(/\n|,/).map((option) => option.trim()).filter(Boolean) })}
                            />
                          </Field>
                        ) : null}
                        <View className="mt-3 flex-row flex-wrap items-center gap-5">
                          <View className="flex-row items-center gap-2">
                            <Switch on={field.visible} onPress={() => patchAdmissionField(field.id, { visible: !field.visible, required: field.visible ? false : field.required })} />
                            <Text className="text-xs font-medium text-ink-800">Show field</Text>
                          </View>
                          <View className="flex-row items-center gap-2">
                            <Switch disabled={!field.visible} on={field.required} onPress={() => patchAdmissionField(field.id, { required: !field.required })} />
                            <Text className="text-xs font-medium text-ink-800">Required</Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            ) : null}

            {tab === "communication" ? (
              <View className="mt-4 gap-6">
                <View className="gap-3">
                  <Text className="text-sm font-medium text-ink-900">Configure campaign</Text>
                  <Text className="text-sm text-ink-700">
                    School's own AiSensy account. The message body is managed in Meta / AiSensy. Anekio only stores the API key and campaign name, then fills {"{{1}}"}–{"{{4}}"}.
                  </Text>
                  <Field label="School community / whole-school group">
                    <Input
                      autoCapitalize="none"
                      value={form.whatsappCommunityUrl}
                      placeholder="https://chat.whatsapp.com/…"
                      onChangeText={(v) => patch("whatsappCommunityUrl", v)}
                    />
                  </Field>
                  <Text className="text-xs text-ink-700">
                    Optional parents community. Notices go out in the app, not this group.
                  </Text>
                  <View className="flex-row flex-wrap gap-3">
                    <Half>
                      <Field label="AiSensy API key">
                        <Input
                          secureTextEntry
                          autoCapitalize="none"
                          value={form.aisensyApiKey}
                          placeholder={s?.pay?.aisensyKeySet ? "Saved — leave blank to keep" : "Manage → API Key"}
                          onChangeText={(v) => patch("aisensyApiKey", v)}
                        />
                      </Field>
                    </Half>
                    <Half>
                      <Field label="API campaign name">
                        <Input autoCapitalize="none" value={form.aisensyCampaign} placeholder="fee_reminder" onChangeText={(v) => patch("aisensyCampaign", v)} />
                      </Field>
                    </Half>
                  </View>
                  <View className="rounded-md border border-ink-200 bg-ink-50 p-3">
                    <View className="flex-row items-center justify-between gap-2">
                      <Text className="text-xs font-medium text-ink-900">Copy this into AiSensy (Utility)</Text>
                      <Linkish
                        label="Copy"
                        onPress={async () => {
                          const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
                          if (!clip?.writeText) {
                            toast.show("Copy from the box below.");
                            return;
                          }
                          try {
                            await clip.writeText(WHATSAPP_TEMPLATE);
                            toast.show("Copied.");
                          } catch {
                            toast.show("Copy from the box below.");
                          }
                        }}
                      />
                    </View>
                    <Text className="mt-2 text-[12px] leading-5 text-ink-800">{WHATSAPP_TEMPLATE}</Text>
                    <Text className="mt-2 text-[11px] text-ink-700">
                      Category: Utility. Then Campaigns → API Campaign named {form.aisensyCampaign || "fee_reminder"}, set
                      it Live.
                    </Text>
                  </View>
                </View>
                <View className="gap-3">
                  <Text className="text-sm font-medium text-ink-900">Email</Text>
                  <Text className="text-sm text-ink-700">
                    School's own Resend account. Messages come from the school's address, not Anekio.
                  </Text>
                  <View className="flex-row flex-wrap gap-3">
                    <Half>
                      <Field label="Resend API key">
                        <Input
                          secureTextEntry
                          autoCapitalize="none"
                          value={form.resendApiKey}
                          placeholder={s?.pay?.resendKeySet ? "Saved — leave blank to keep" : "re_… from API Keys"}
                          onChangeText={(v) => patch("resendApiKey", v)}
                        />
                      </Field>
                    </Half>
                    <Half>
                      <Field label="From email">
                        <Input
                          autoCapitalize="none"
                          keyboardType="email-address"
                          value={form.resendFromEmail}
                          placeholder="fees@your-school.edu.in"
                          onChangeText={(v) => patch("resendFromEmail", v)}
                        />
                      </Field>
                    </Half>
                  </View>
                </View>
              </View>
            ) : null}

            {showSave ? (
              <View className="mt-5 flex-row flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-4">
                <Text className="text-[11px] text-ink-700">Saves letterhead, bank, gateway, WhatsApp, and email together.</Text>
                {edit ? <Button onPress={save}>Save</Button> : null}
              </View>
            ) : null}
          </View>

          {showPreview ? (
          <View className={wide ? "sticky top-6 w-80 shrink-0" : "mt-6"}>
            <View className="rounded-md border border-ink-200 bg-ink-50 p-3">
              <Text className="mb-2 text-xs font-medium text-ink-700">
                {tab === "communication"
                  ? "Message preview"
                  : tab === "exams"
                      ? "This year"
                      : tab === "website"
                        ? "Website preview"
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
              ) : tab === "communication" ? (
                <MessagePreview schoolName={form.name} fromEmail={form.resendFromEmail} />
              ) : tab === "identity" ? (
                <BrandAssetPreview form={form} logoPath={s?.logoPath} signPath={s?.signPath} stampPath={s?.stampPath} />
              ) : tab === "website" ? (
                <WebsiteMiniPreview form={form} logoPath={s?.logoPath} />
              ) : (
                <InvoicePreview form={form} logoPath={s?.logoPath} />
              )}
            </View>
          </View>
          ) : null}
        </View>
      </Card>
      )}

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
    admissionForm: s?.admissionForm?.length ? s.admissionForm.map((field) => ({ ...field, options: [...field.options] })) : DEFAULT_ADMISSION_FIELDS.map((field) => ({ ...field, options: [] })),
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
            {logoPath ? <Image source={{ uri: assetUrl(logoPath) }} className="h-8 w-8" resizeMode="contain" /> : <Ionicons name="school-outline" size={22} color={theme.main} />}
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
              <Image source={{ uri: assetUrl(logoPath) }} className="h-10 w-10" resizeMode="contain" />
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
                <Image source={{ uri: assetUrl(signPath) }} className="h-12 w-full" resizeMode="contain" />
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
                <Image source={{ uri: assetUrl(stampPath) }} className="h-14 w-20" resizeMode="contain" />
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
        {logoPath ? <Image source={{ uri: assetUrl(logoPath) }} className="h-12 w-12" resizeMode="contain" /> : null}
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

function MessagePreview({ schoolName, fromEmail }: { schoolName: string; fromEmail: string }) {
  return (
    <View className="gap-4">
      <View>
        <Text className="mb-1.5 text-[11px] font-medium text-ink-700">WhatsApp</Text>
        <View className="rounded-xl bg-[#e5ddd5] p-3">
          <View className="rounded-lg bg-white px-3 py-2.5">
            <Text className="text-[13px] leading-5 text-ink-900">Dear Parent,</Text>
            <Text className="mt-2 text-[13px] leading-5 text-ink-900">
              This is a reminder that the school fee for Aarav Sharma (April 2026) is pending.
            </Text>
            <Text className="mt-2 text-[13px] leading-5 text-ink-900">Amount due: ₹4500</Text>
            <Text className="mt-2 text-[13px] leading-5 text-ink-900">Please complete the payment using this secure link:</Text>
            <Text className="mt-0.5 text-[13px] text-[#027eb5] underline">https://your-school.com/pay/sample</Text>
            <Text className="mt-2 text-[11px] text-ink-700">{schoolName || "Anekio School"}</Text>
          </View>
        </View>
      </View>
      <View>
        <Text className="mb-1.5 text-[11px] font-medium text-ink-700">Email</Text>
        <View className="rounded-md border border-ink-200 bg-white p-3">
          <Text className="text-[11px] text-ink-700">
            From {schoolName || "Anekio School"} &lt;{fromEmail || "fees@your-school.edu.in"}&gt;
          </Text>
          <Text className="mt-1 text-[13px] font-medium text-ink-900">Fee reminder · Aarav Sharma · April 2026</Text>
          <Text className="mt-3 text-[13px] leading-5 text-ink-900">Dear Parent,</Text>
          <Text className="mt-2 text-[13px] leading-5 text-ink-900">
            This is a reminder that the school fee for Aarav Sharma (April 2026) is pending.
          </Text>
          <View className="mt-3 self-start rounded-md bg-clay-500 px-3 py-1.5">
            <Text className="text-xs font-medium text-white">Pay now</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
