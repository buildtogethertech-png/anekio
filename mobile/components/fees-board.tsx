import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { GeneratePayment } from "./generate-payment";
import { FilterBar, type FilterConfig, type FilterValues } from "./filter";
import { Button, Card, Field, Input, Modal, Switch, Toast, useToast } from "./ui";
import { DateField } from "./date-field";
import { Select } from "./form/select";
import { FeeReport } from "./fee-report";
import { act } from "../lib/mutate";
import { webOrigin } from "../lib/api";
import { datesForSessionYear, ordinalDay, SESSION_YEAR_OPTIONS, sessionYearId } from "../lib/fee-setup";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";
import { inr } from "../lib/payroll";

type Tab = "register" | "report" | "insight" | "setup";
type SetupPane = "academic" | "class" | "transport" | "other" | "late";
type Person = NonNullable<ReturnType<typeof useRecord>["data"]>["people"] extends (infer P)[] | undefined ? P : never;
type Invoice = NonNullable<Person["invoices"]>[number];

type FeeLineDraft = { id: string; label: string; amount: string; scope: "ALL" | "ADD_ON" };

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

const CLASS_CHARGE_SUGGESTIONS = ["Tuition", "Lab", "Books", "Hostel", "Computer", "Exam", "Activity", "Uniform"];
const CLASS_ADDON_SUGGESTIONS = ["Project", "Picnic", "Workshop", "Smart class", "Sports kit"];
const TRANSPORT_SUGGESTIONS = ["Route A", "Route B", "Route C", "Van", "Mini bus"];
const OTHER_FEE_SUGGESTIONS = ["Computer fee", "Exam fee", "Activity", "Uniform", "Smart class", "Annual function"];
const ADMISSION_SUGGESTIONS = ["Prospectus", "Registration", "ID card", "Caution deposit"];

function SuggestionPills({
  options,
  used = [],
  selected,
  onPick,
}: {
  options: string[];
  used?: string[];
  selected?: string;
  onPick: (label: string) => void;
}) {
  const usedSet = new Set(used.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const selectedKey = selected?.trim().toLowerCase() || "";
  const visible = options.filter((label) => !usedSet.has(label.toLowerCase()) || label.toLowerCase() === selectedKey);
  if (!visible.length) return null;
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {visible.map((label) => {
        const on = label.toLowerCase() === selectedKey;
        return (
          <Pressable
            key={label}
            accessibilityRole="button"
            onPress={() => onPick(label)}
            className={`rounded-md px-3 py-1.5 ${on ? "bg-blue-600" : "border border-ink-200 bg-white"}`}
          >
            <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-800"}`}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const LATE_RULES = [
  { id: "STATIC", label: "One-time amount" },
  { id: "DAILY", label: "Per day" },
  { id: "RECURRING_DAY", label: "Recurring every few days" },
  { id: "RECURRING_MONTH", label: "Per overdue month" },
  { id: "PERCENT", label: "Percent of unpaid fee (once)" },
  { id: "PERCENT_MONTH", label: "Percent of unpaid fee per overdue month" },
] as const;

function lateRuleFromPolicy(row?: { lateKind?: string | null; lateIntervalUnit?: string | null } | null) {
  const kind = String(row?.lateKind || "").toUpperCase();
  const unit = String(row?.lateIntervalUnit || "DAY").toUpperCase();
  if (kind === "STATIC") return "STATIC";
  if (kind === "DAILY") return "DAILY";
  if (kind === "PERCENT") return unit === "MONTH" ? "PERCENT_MONTH" : "PERCENT";
  if (kind === "RECURRING" && unit === "DAY") return "RECURRING_DAY";
  return "RECURRING_MONTH";
}

function moneyNumber(value?: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactInr(amount: number) {
  const rounded = Math.round(amount || 0);
  if (Math.abs(rounded) >= 100000) {
    const lakhs = rounded / 100000;
    const digits = Math.abs(lakhs) >= 10 ? 1 : 2;
    return `₹${lakhs.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1")}L`;
  }
  return inr(rounded);
}

function currentFeePeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function periodRangeLabel(start?: string, end?: string) {
  if (!start || !/^\d{4}-\d{2}$/.test(start)) return "";
  const format = (period: string, withYear: boolean) => {
    const [year, month] = period.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "short", ...(withYear ? { year: "numeric" } : {}) });
  };
  if (!end || !/^\d{4}-\d{2}$/.test(end) || end === start) return format(start, true);
  return start.slice(0, 4) === end.slice(0, 4) ? `${format(start, false)}–${format(end, true)}` : `${format(start, true)} – ${format(end, true)}`;
}

function periodLabel(period?: string) {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return "Not generated";
  const [year, month] = period.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function shortMonth(period?: string, title?: string) {
  if (period && /^\d{4}-\d{2}$/.test(period)) {
    const [year, month] = period.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "short", year: "numeric" });
  }
  return (title || "").split(" · ")[0] || title || "—";
}

function nextPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function newFeeLine(label = "", amount = "", scope: "ALL" | "ADD_ON" = "ALL"): FeeLineDraft {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, label, amount, scope };
}

function invoiceDueParts(inv: Invoice) {
  const remaining = moneyNumber(inv.remaining || moneyNumber(inv.amount) - moneyNumber(inv.paid));
  const late = typeof inv.late === "number" ? inv.late : Math.max(0, (inv.dueNow ?? remaining) - remaining);
  const dueNow = typeof inv.dueNow === "number" ? inv.dueNow : remaining + late;
  return { remaining, late, dueNow };
}

function timesLabel(count: number) {
  return count === 1 ? "1 month" : `${count} months`;
}

function dueBreakdown(open: Invoice[], fallbackLines: { label: string; amount: number }[]) {
  const buckets = new Map<string, { label: string; rate: number; months: number; total: number }>();
  function add(label: string, rate: number, months = 1) {
    const amount = Math.max(0, Math.round(rate));
    if (!label || amount <= 0 || months <= 0) return;
    const key = `${label.toLowerCase()}::${amount}`;
    const current = buckets.get(key) || { label, rate: amount, months: 0, total: 0 };
    current.months += months;
    current.total += amount * months;
    buckets.set(key, current);
  }
  for (const inv of open) {
    const parts = invoiceDueParts(inv);
    const billed = moneyNumber(inv.amount);
    const lines = (inv.lines || []).filter((line) => line.amount > 0);
    const source = lines.length ? lines : fallbackLines;
    const fullMonth = billed > 0 && parts.remaining >= billed;
    if (fullMonth && source.length) {
      for (const line of source) add(line.label, line.amount);
    } else if (parts.remaining > 0) {
      add(`${shortMonth(inv.period, inv.title)} balance`, parts.remaining);
    }
  }
  const lateGroups = new Map<number, number>();
  for (const inv of open) {
    const late = invoiceDueParts(inv).late;
    if (late > 0) lateGroups.set(late, (lateGroups.get(late) || 0) + 1);
  }
  const lateRows = [...lateGroups.entries()].map(([rate, months]) => ({
    label: "Late fine",
    rate,
    months,
    total: rate * months,
  }));
  const chargeRows = [...buckets.values()];
  const subtotal = chargeRows.reduce((sum, row) => sum + row.total, 0);
  const lateTotal = lateRows.reduce((sum, row) => sum + row.total, 0);
  return {
    months: open.length,
    monthLabels: open.map((inv) => shortMonth(inv.period, inv.title)),
    chargeRows,
    lateRows,
    subtotal,
    lateTotal,
    total: subtotal + lateTotal,
  };
}

function unpaidInvoices(person: Person) {
  return [...(person.invoices ?? [])]
    .filter((inv) => inv.status !== "paid" && invoiceDueParts(inv).dueNow > 0)
    .sort((a, b) => (a.period || a.title).localeCompare(b.period || b.title));
}

function unpaidPeriodLabel(open: Invoice[]) {
  if (!open.length) return "—";
  const periods = open.map((inv) => inv.period || "").filter((period) => /^\d{4}-\d{2}$/.test(period));
  if (periods.length === open.length) {
    const sorted = [...periods].sort();
    const consecutive = sorted.every((period, index) => index === 0 || period === nextPeriod(sorted[index - 1]));
    const labels = sorted.map((period) => shortMonth(period));
    if (consecutive && labels.length > 1) return `${labels[0]} – ${labels[labels.length - 1]}`;
    return labels.join(", ");
  }
  return open.map((inv) => shortMonth(inv.period, inv.title)).join(", ");
}

function paymentMethodLabel(method: string) {
  const labels: Record<string, string> = {
    CASH: "Cash",
    UPI: "UPI",
    BANK: "Bank",
    CHEQUE: "Cheque",
    RAZORPAY: "Razorpay",
    CASHFREE: "Cashfree",
    BILLDESK: "BillDesk",
  };
  return labels[method] || method || "Payment";
}

function clockLabel(value?: string) {
  if (!value) return { day: "—", time: "" };
  const date = new Date(value);
  if (Number.isNaN(+date)) return { day: value, time: "" };
  return {
    day: date.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
    time: date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }),
  };
}

function paymentHistory(person: Person) {
  return (person.invoices ?? [])
    .flatMap((inv) =>
      (inv.payments ?? []).map((payment, index) => ({
        key: `${inv.id}-${payment.paidAt || index}`,
        title: inv.title,
        amount: payment.amount,
        method: payment.method,
        paidAt: payment.paidAt || "",
        invoiceId: inv.id,
        invoiceUrl: inv.invoiceUrl,
        receiptUrl: inv.receiptUrl,
      }))
    )
    .sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));
}

function lastPaymentOf(person: Person) {
  const latest = paymentHistory(person)[0];
  if (!latest) return null;
  return {
    date: clockLabel(latest.paidAt).day,
    mode: paymentMethodLabel(latest.method),
    amount: latest.amount,
  };
}

function statusOf(open: Invoice[]) {
  if (!open.length) return { id: "paid", label: "Paid" };
  if (open.some((inv) => inv.status === "overdue")) return { id: "overdue", label: "Overdue" };
  if (open.some((inv) => inv.status === "partial" || moneyNumber(inv.paid) > 0)) return { id: "partial", label: "Partial" };
  return { id: "unpaid", label: "Unpaid" };
}

function Head({ label, flex, right }: { label: string; flex: number; right?: boolean }) {
  return (
    <View style={{ flex, minWidth: 0 }} className={`justify-center px-2 py-2 ${right ? "items-end" : ""}`}>
      <Text numberOfLines={1} className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        {label}
      </Text>
    </View>
  );
}

function Cell({ flex, right, children }: { flex: number; right?: boolean; children: ReactNode }) {
  return (
    <View style={{ flex, minWidth: 0 }} className={`justify-center px-2 py-2.5 ${right ? "items-end" : ""}`}>
      {typeof children === "string" || typeof children === "number" ? (
        <Text numberOfLines={1} className={`text-[13px] leading-5 text-ink-900 ${right ? "text-right" : ""}`}>
          {children}
        </Text>
      ) : (
        children
      )}
    </View>
  );
}

function studentMonths(person: Person) {
  return [...(person.invoices ?? [])].sort((a, b) => (b.period || b.title).localeCompare(a.period || a.title));
}

const stickyHead = Platform.OS === "web" ? { position: "sticky" as const, top: 0, zIndex: 2, backgroundColor: "#fff" } : { backgroundColor: "#fff" };

export function FeesBoard() {
  const { data, reload, refreshing } = useRecord();
  const { token, user } = useSession();
  const router = useRouter();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const didInitialRefresh = useRef(false);
  const [tab, setTab] = useState<Tab>("register");
  const [query, setQuery] = useState("");
  const [classId, setClassId] = useState("all");
  const [section, setSection] = useState("");
  const [status, setStatus] = useState("");
  const [monthsGte, setMonthsGte] = useState("");
  const [historyClassId, setHistoryClassId] = useState("");
  const [historyMode, setHistoryMode] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [selectedDueStudentId, setSelectedDueStudentId] = useState("");
  const [payDueStudentId, setPayDueStudentId] = useState("");
  const [feeEditorOpen, setFeeEditorOpen] = useState(false);
  const [setupPane, setSetupPane] = useState<SetupPane>("class");
  const [editorClassId, setEditorClassId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [tplName, setTplName] = useState("Monthly fee");
  const [tplDue, setTplDue] = useState("10");
  const [tplStartPeriod, setTplStartPeriod] = useState("");
  const [tplEndPeriod, setTplEndPeriod] = useState("");
  const [tplLines, setTplLines] = useState<FeeLineDraft[]>([newFeeLine("Tuition", "")]);
  const [tplAddOnLines, setTplAddOnLines] = useState<FeeLineDraft[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogKind, setCatalogKind] = useState<"TRANSPORT" | "OTHER">("TRANSPORT");
  const [catalogId, setCatalogId] = useState("");
  const [catalogLabel, setCatalogLabel] = useState("");
  const [catalogAmount, setCatalogAmount] = useState("");
  const [catalogActive, setCatalogActive] = useState(true);
  const [lateEnabled, setLateEnabled] = useState(false);
  const [lateAmount, setLateAmount] = useState("10");
  const [lateGrace, setLateGrace] = useState("5");
  const [lateRule, setLateRule] = useState("RECURRING_MONTH");
  const [lateEvery, setLateEvery] = useState("15");
  const [admissionLines, setAdmissionLines] = useState<FeeLineDraft[]>([newFeeLine("Admission fee", "")]);
  const [admissionClassId, setAdmissionClassId] = useState("");
  const [sessionStart, setSessionStart] = useState("");
  const [sessionEnd, setSessionEnd] = useState("");
  const [sessionDueDay, setSessionDueDay] = useState(10);

  const people = data?.people ?? [];
  const classes = data?.classes ?? [];
  const templates = data?.feeTemplates ?? [];
  const collect = can(user, "fees.collect");
  const configure = can(user, "fees.configure");
  const compact = width < 768;
  const currentSession = data?.school?.sessions?.find((row) => row.current) ?? data?.school?.sessions?.[0];
  const catalog = data?.feeCatalog ?? { items: [], late: { enabled: false, amount: 0, graceDays: 0 } };
  const transportItems = catalog.items.filter((item) => item.kind === "TRANSPORT");
  const otherItems = catalog.items.filter((item) => item.kind === "OTHER");
  const classTemplate =
    selectedTemplateId === "new" ? null : templates.find((row) => row.id === selectedTemplateId && (!currentSession || row.sessionId === currentSession.id || !row.sessionId)) || null;
  const defaultStartPeriod = currentSession?.startsOn?.slice(0, 7) || currentFeePeriod();
  const defaultEndPeriod = currentSession?.endsOn?.slice(0, 7) || defaultStartPeriod;
  const structureRange = periodRangeLabel(tplStartPeriod || defaultStartPeriod, tplEndPeriod || defaultEndPeriod);
  const tplTotal = tplLines.reduce((sum, line) => sum + Math.max(0, Math.round(Number(line.amount) || 0)), 0);
  const admissionByClass = useMemo(() => {
    const totals = new Map<string, number>();
    for (const line of data?.admissionFeeLines || []) {
      if (!line.classId) continue;
      totals.set(line.classId, (totals.get(line.classId) || 0) + Math.max(0, Math.round(Number(line.amount) || 0)));
    }
    return totals;
  }, [data?.admissionFeeLines]);
  const admissionTotal = admissionLines.reduce((sum, line) => sum + Math.max(0, Math.round(Number(line.amount) || 0)), 0);
  const feeStructures = useMemo(
    () =>
      templates
        .filter((row) => !currentSession || row.sessionId === currentSession.id || !row.sessionId)
        .sort((a, b) => {
          const classOrder = (classes.find((row) => row.id === a.classId)?.label || "").localeCompare(classes.find((row) => row.id === b.classId)?.label || "", undefined, { numeric: true });
          return classOrder || (a.startsPeriod || "").localeCompare(b.startsPeriod || "");
        }),
    [templates, classes, currentSession?.id]
  );
  const classRows = useMemo(
    () =>
      [...classes]
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
        .map((klass) => {
          const tpls = templates
            .filter((row) => row.classId === klass.id && (!currentSession || row.sessionId === currentSession.id || !row.sessionId))
            .sort((a, b) => (b.startsPeriod || "").localeCompare(a.startsPeriod || ""));
          const tpl = tpls[0];
          const monthly = (tpl?.lines || [])
            .filter((line) => line.scope !== "ADD_ON")
            .reduce((sum, line) => sum + Math.max(0, Math.round(Number(line.amount) || 0)), 0);
          return {
            klass,
            template: tpl,
            monthly,
            dueDay: tpl?.dueDay || 10,
            active: Boolean(tpl?.lines?.length),
          };
        }),
    [classes, templates, currentSession?.id]
  );

  const sections = useMemo(() => {
    const ids = [...new Set(classes.map((row) => row.section).filter(Boolean))] as string[];
    return ids.sort();
  }, [classes]);

  const registerRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .map((person) => {
        const open = unpaidInvoices(person);
        const fee = open.reduce((sum, inv) => sum + invoiceDueParts(inv).remaining, 0);
        const late = open.reduce((sum, inv) => sum + invoiceDueParts(inv).late, 0);
        const dueNow = open.reduce((sum, inv) => sum + invoiceDueParts(inv).dueNow, 0);
        const dueDates = open.map((inv) => inv.due).filter(Boolean);
        return {
          person,
          open,
          fee,
          late,
          dueNow,
          months: open.length,
          period: unpaidPeriodLabel(open),
          dueDate: dueDates[0] || "—",
          status: statusOf(open),
          lastPayment: lastPaymentOf(person),
        };
      })
      .filter((row) => {
        if (classId !== "all" && row.person.classId !== classId) return false;
        if (section) {
          const klass = classes.find((item) => item.id === row.person.classId);
          if ((klass?.section || "") !== section) return false;
        }
        if (status && row.status.id !== status) return false;
        if (monthsGte && row.months < Number(monthsGte)) return false;
        if (!q) return true;
        return [row.person.name, row.person.classLabel, row.person.admissionNo, row.person.parent, row.person.parentPhone].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(q)
        );
      })
      .sort((a, b) => b.dueNow - a.dueNow || a.person.name.localeCompare(b.person.name));
  }, [people, query, classId, section, status, monthsGte, classes]);

  const selectedDueStudent = selectedDueStudentId ? people.find((row) => row.id === selectedDueStudentId) || null : null;
  const payDueStudent = payDueStudentId ? people.find((row) => row.id === payDueStudentId) || null : null;

  const summary = useMemo(() => {
    const dueRows = registerRows.filter((row) => row.dueNow > 0);
    return {
      outstanding: dueRows.reduce((sum, row) => sum + row.dueNow, 0),
      overdue: dueRows.filter((row) => row.status.id === "overdue").reduce((sum, row) => sum + row.dueNow, 0),
      collected: people.reduce((sum, person) => sum + moneyNumber(person.paid), 0),
      students: dueRows.length,
      pending: dueRows.reduce((sum, row) => sum + row.months, 0),
    };
  }, [registerRows, people]);

  const reportEvents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = historyFrom.trim();
    const to = historyTo.trim();
    return people
      .flatMap((person) =>
        (person.invoices ?? []).flatMap((inv) =>
          (inv.payments ?? []).map((payment, index) => ({
            key: `${inv.id}-${payment.paidAt || index}`,
            studentId: person.id,
            admissionNo: person.admissionNo,
            studentName: person.name,
            classLabel: person.classLabel,
            classId: person.classId || "",
            fee: inv.title,
            amount: payment.amount,
            mode: paymentMethodLabel(payment.method),
            method: payment.method,
            paidAt: payment.paidAt || "",
            invoiceId: inv.id,
            invoiceUrl: inv.invoiceUrl,
            receiptUrl: inv.receiptUrl,
          }))
        )
      )
      .filter((row) => {
        if (historyClassId && row.classId !== historyClassId) return false;
        if (historyMode && row.method !== historyMode) return false;
        const day = row.paidAt.slice(0, 10);
        if (from && day && day < from) return false;
        if (to && day && day > to) return false;
        if (!q) return true;
        return [row.admissionNo, row.studentName, row.classLabel, row.fee, row.mode].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(q)
        );
      })
      .sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));
  }, [people, query, historyClassId, historyMode, historyFrom, historyTo]);

  const registerFilters: FilterConfig[] = [
    { key: "classId", label: "Class", type: "single-select", options: classes.map((row) => ({ id: row.id, label: row.label })) },
    { key: "section", label: "Section", type: "single-select", options: sections.map((id) => ({ id, label: id })) },
    {
      key: "status",
      label: "Status",
      type: "single-select",
      options: [
        { id: "unpaid", label: "Unpaid" },
        { id: "partial", label: "Partial" },
        { id: "overdue", label: "Overdue" },
        { id: "paid", label: "Paid" },
      ],
    },
    {
      key: "months",
      label: "Months due",
      type: "single-select",
      options: [
        { id: "1", label: "1+" },
        { id: "2", label: "2+" },
        { id: "3", label: "3+" },
      ],
    },
  ];

  const historyFilters: FilterConfig[] = [
    { key: "classId", label: "Class", type: "single-select", options: classes.map((row) => ({ id: row.id, label: row.label })) },
    {
      key: "mode",
      label: "Mode",
      type: "single-select",
      options: [
        { id: "CASH", label: "Cash" },
        { id: "UPI", label: "UPI" },
        { id: "BANK", label: "Bank" },
        { id: "CHEQUE", label: "Cheque" },
        { id: "RAZORPAY", label: "Razorpay" },
      ],
    },
    { key: "from", label: "From (YYYY-MM-DD)", type: "text", placeholder: "2026-04-01" },
    { key: "to", label: "To (YYYY-MM-DD)", type: "text", placeholder: "2026-09-13" },
  ];

  useEffect(() => {
    if (didInitialRefresh.current) return;
    didInitialRefresh.current = true;
    void reload();
  }, [reload]);

  useEffect(() => {
    if (tab !== "register" && tab !== "insight") setSelectedDueStudentId("");
  }, [tab]);

  useEffect(() => {
    if (!feeEditorOpen) return;
    setTplName(classTemplate?.name || "Monthly fee");
    setTplDue(String(classTemplate?.dueDay || 10));
    setTplStartPeriod(classTemplate?.startsPeriod || defaultStartPeriod);
    setTplEndPeriod(classTemplate?.endsPeriod || defaultEndPeriod);
    const allLines = (classTemplate?.lines || []).filter((line) => line.scope !== "ADD_ON");
    const addOnLines = (classTemplate?.lines || []).filter((line) => line.scope === "ADD_ON");
    setTplLines(allLines.length ? allLines.map((line) => newFeeLine(line.label, String(line.amount))) : [newFeeLine("Tuition", "")]);
    setTplAddOnLines(addOnLines.map((line) => newFeeLine(line.label, String(line.amount), "ADD_ON")));
  }, [feeEditorOpen, selectedTemplateId, classTemplate, defaultStartPeriod, defaultEndPeriod]);

  useEffect(() => {
    if (!feeEditorOpen || !editorClassId) return;
    const savedLines = (data?.admissionFeeLines || [])
      .filter((line) => line.classId === editorClassId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    setAdmissionLines(savedLines.length ? savedLines.map((line) => newFeeLine(line.label, String(line.amount))) : [newFeeLine("Admission fee", "")]);
  }, [feeEditorOpen, editorClassId, data?.admissionFeeLines]);

  useEffect(() => {
    const fromCatalog = catalog.late;
    const fromTemplate = templates.find((row) => row.lateKind && row.lateKind !== "NONE" && row.lateAmount > 0);
    const useCatalog = Boolean(fromCatalog?.enabled);
    const enabled = useCatalog || Boolean(fromTemplate);
    const amount = useCatalog ? fromCatalog.amount : fromTemplate?.lateAmount || 10;
    const graceDays = useCatalog ? fromCatalog.graceDays : fromTemplate?.lateGraceDays || 5;
    const rule = useCatalog ? fromCatalog.rule || "RECURRING_MONTH" : lateRuleFromPolicy(fromTemplate);
    setLateEnabled(enabled);
    setLateAmount(String(amount || 10));
    setLateGrace(String(graceDays || 0));
    setLateRule(rule);
    setLateEvery(String((useCatalog ? fromCatalog.intervalCount : fromTemplate?.lateIntervalCount) || 15));
  }, [catalog.late, templates]);

  async function openDueFeeDocument(inv: { id: string; invoiceUrl?: string; receiptUrl?: string }, paid: boolean) {
    const directUrl = paid ? inv.receiptUrl : inv.invoiceUrl;
    if (directUrl) {
      if (Platform.OS === "web") {
        window.open(directUrl, "_blank", "noopener,noreferrer");
        return;
      }
      await Linking.openURL(directUrl);
      return;
    }
    const pendingWindow = Platform.OS === "web" ? window.open("", "_blank") : null;
    if (pendingWindow) pendingWindow.opener = null;
    try {
      const result = await act<{ ok: true; token: string }>(token, "ensurePayToken", { invoiceId: inv.id });
      const shareToken = encodeURIComponent(result.token);
      const url = paid ? `${webOrigin()}/pay/${shareToken}?paid=1` : `${webOrigin()}/i/${shareToken}`;
      await reload();
      if (pendingWindow) pendingWindow.location.replace(url);
      else await Linking.openURL(url);
    } catch (error) {
      pendingWindow?.close();
      toast.show(error instanceof Error ? error.message : "Could not open fee document.");
    }
  }

  async function saveFeeTemplate() {
    if (!editorClassId) {
      toast.show("Choose a class.");
      return;
    }
    try {
      const lines = [
        ...tplLines.map((line) => ({
          label: line.label.trim() || "Charge",
          kind: "FLAT",
          amount: Math.max(0, Math.round(Number(line.amount) || 0)),
          scope: "ALL" as const,
        })),
        ...tplAddOnLines
          .map((line) => ({
            label: line.label.trim(),
            kind: "FLAT",
            amount: Math.max(0, Math.round(Number(line.amount) || 0)),
            scope: "ADD_ON" as const,
          }))
          .filter((line) => line.label && line.amount > 0),
      ].filter((line) => line.scope === "ADD_ON" || line.label || line.amount > 0);
      if (!lines.some((line) => line.scope === "ALL")) {
        toast.show("Add at least one charge.");
        return;
      }
      const saved = await act<{ ok: true; id: string }>(token, "saveFeeTemplate", {
        templateId: classTemplate?.id,
        classId: editorClassId,
        sessionId: currentSession?.id,
        name: tplName,
        startsPeriod: tplStartPeriod,
        endsPeriod: tplEndPeriod,
        dueDay: Number(tplDue),
        lines,
      });
      const admissionFeeLines = admissionLines
        .map((line) => ({ label: line.label.trim() || "Admission fee", amount: Math.max(0, Math.round(Number(line.amount) || 0)) }))
        .filter((line) => line.amount > 0);
      await act(token, "saveAdmissionFeeSetup", { classId: editorClassId, lines: admissionFeeLines });
      setSelectedTemplateId(saved.id);
      setFeeEditorOpen(false);
      toast.show("Class fee saved.");
      await reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not save.");
    }
  }

  async function saveCatalogItem() {
    try {
      const label = catalogLabel.trim();
      if (!label) {
        toast.show("Enter a name.");
        return;
      }
      await act(token, "saveFeeCatalog", {
        item: {
          id: catalogId || undefined,
          kind: catalogKind,
          label,
          amount: Math.max(0, Math.round(Number(catalogAmount) || 0)),
          active: catalogActive,
        },
      });
      setCatalogOpen(false);
      toast.show("Fee option saved.");
      await reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not save.");
    }
  }

  async function saveLateFee() {
    try {
      await act(token, "applySessionLateFee", {
        enabled: lateEnabled,
        amount: Math.max(0, Number(lateAmount) || 0),
        graceDays: Math.max(0, Math.round(Number(lateGrace) || 0)),
        rule: lateRule,
        intervalCount: Math.max(1, Math.round(Number(lateEvery) || 15)),
      });
      toast.show("Late fee saved for new invoices.");
      await reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not save.");
    }
  }

  function openNewClassFee() {
    setEditorClassId("");
    setSelectedTemplateId("new");
    setFeeEditorOpen(true);
  }

  function openClassFee(templateId: string, classId: string) {
    setEditorClassId(classId);
    setSelectedTemplateId(templateId);
    setFeeEditorOpen(true);
  }

  async function saveAdmissionFee(applyToAll = false) {
    try {
      if (!applyToAll && !admissionClassId) throw new Error("Pick a class card first.");
      const lines = admissionLines
        .map((line) => ({ label: line.label.trim() || "Admission fee", amount: Math.max(0, Math.round(Number(line.amount) || 0)) }))
        .filter((line) => line.amount > 0);
      await act(token, "saveAdmissionFeeSetup", applyToAll ? { lines } : { classId: admissionClassId, lines });
      toast.show(applyToAll ? "One-time admission fee saved for every class." : "One-time admission fee saved for this class.");
      await reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not save.");
    }
  }

  async function saveAcademicSession() {
    try {
      await act(token, "saveFeeAcademicSession", { startsOn: sessionStart, endsOn: sessionEnd });
      toast.show("Academic session saved.");
      await reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not save.");
    }
  }

  async function saveSessionDueDay() {
    try {
      await act(token, "applySessionDueDay", { dueDay: sessionDueDay });
      toast.show("Due day saved for this session.");
      await reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not save.");
    }
  }

  async function issueFeeTemplate(classIdToIssue?: string, templateId?: string) {
    if (!classIdToIssue || !templateId) {
      toast.show("Save this class fee first.");
      return;
    }
    try {
      await act(token, "issueClassFees", { classId: classIdToIssue, templateId });
      toast.show("Invoices generated.");
      await reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not issue.");
    }
  }

  const modeTabs = (
    <View className="flex-row rounded-xl border border-ink-200 bg-white p-1 shadow-sm">
      {(
        [
          ["register", "Register"],
          ["report", "History"],
          ["insight", "Report"],
          ["setup", "Setup"],
        ] as const
      ).map(([id, label]) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          onPress={() => setTab(id)}
          className={`min-w-[76px] items-center rounded-lg px-3 py-2 ${tab === id ? "bg-clay-500" : "bg-white"}`}
        >
          <Text className={`text-sm font-semibold ${tab === id ? "text-white" : "text-ink-800"}`}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );

  const metricChips = (
    <View className="flex-row flex-wrap gap-2">
      {(
        [
          ["Outstanding", compactInr(summary.outstanding), "text-amber-900", "border-amber-100 bg-amber-50/40"],
          ["Overdue", compactInr(summary.overdue), "text-red-700", "border-red-100 bg-red-50/50"],
          ["Collected", compactInr(summary.collected), "text-green-800", "border-green-100 bg-green-50/40"],
          ["Students with dues", String(summary.students), "text-ink-900", "border-ink-100 bg-white"],
        ] as const
      ).map(([label, value, tone, surface]) => (
        <View key={label} className={`min-w-[112px] rounded-xl border px-3 py-2.5 ${surface}`}>
          <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{label}</Text>
          <Text className={`mt-0.5 text-[16px] font-bold ${tone}`}>{value}</Text>
        </View>
      ))}
    </View>
  );

  const toolbar = (
    <View className="mb-3 gap-3">
      <View className="flex-row flex-wrap items-start justify-between gap-3">
        <View>
          <Text className="text-[22px] font-bold tracking-tight text-ink-900">Fees</Text>
          <Text className="mt-0.5 text-sm text-ink-600">
            {tab === "register" ? `${summary.pending} fee periods need attention across ${summary.students} students.` : tab === "report" ? "Review every payment and receipt in one place." : tab === "insight" ? "Collection performance for the current academic session." : "Configure the school’s fee structure."}
          </Text>
        </View>
        {modeTabs}
      </View>
      {tab !== "insight" && tab !== "setup" ? metricChips : null}
      <View className="min-w-[220px] flex-1">
        {tab === "setup" ? null : tab === "insight" ? (
          <Text className="text-sm text-ink-700">Collected is payment date. Billed and outstanding are invoices.</Text>
        ) : (
          <FilterBar
            searchValue={query}
            onSearchChange={setQuery}
            searchPlaceholder={tab === "report" ? "Search student, admission no, receipt..." : "Search student, admission no, parent..."}
            filters={tab === "report" ? historyFilters : registerFilters}
            values={
              tab === "report"
                ? { classId: historyClassId, mode: historyMode, from: historyFrom, to: historyTo }
                : { classId: classId === "all" ? "" : classId, section, status, months: monthsGte }
            }
            onApply={(values: FilterValues) => {
              if (tab === "report") {
                setHistoryClassId(String(values.classId || ""));
                setHistoryMode(String(values.mode || ""));
                setHistoryFrom(String(values.from || ""));
                setHistoryTo(String(values.to || ""));
                return;
              }
              setClassId(String(values.classId || "all"));
              setSection(String(values.section || ""));
              setStatus(String(values.status || ""));
              setMonthsGte(String(values.months || ""));
            }}
          />
        )}
      </View>
    </View>
  );

  const registerTable = (
    <View className="w-full">
      <View className="flex-row border-b border-ink-200 bg-slate-50/70" style={stickyHead}>
        <Head label="Student" flex={2.15} />
        <Head label="Amount due" flex={1.15} right />
        <Head label="Status" flex={0.9} />
        <Head label="Fee period" flex={1.25} />
        <Head label="Last payment" flex={1.45} right />
        <Head label="" flex={0.32} right />
      </View>
      {refreshing && !registerRows.length
        ? Array.from({ length: 8 }).map((_, index) => (
            <View key={`sk-${index}`} className="h-[52px] border-b border-ink-50 bg-white px-3 justify-center">
              <View className="h-3 w-2/3 rounded bg-ink-100" />
            </View>
          ))
        : registerRows.map((row) => {
            const active = selectedDueStudentId === row.person.id;
            return (
              <Pressable
                key={row.person.id}
                accessibilityRole="button"
                accessibilityLabel={`${row.person.name} fee detail`}
                onPress={() => setSelectedDueStudentId(row.person.id)}
                className={`flex-row border-b border-ink-100 ${active ? "bg-blue-50" : "bg-white hover:bg-slate-50"}`}
                style={{ minHeight: 68, cursor: "pointer" }}
              >
                <Cell flex={2.15}>
                  <Text numberOfLines={1} className="text-[13px] font-semibold leading-5 text-clay-600">
                    {row.person.name}
                  </Text>
                  <Text numberOfLines={1} className="mt-0.5 text-[11px] text-ink-500">
                    {row.person.classLabel} · {row.person.admissionNo || "No admission no."}
                  </Text>
                </Cell>
                <Cell flex={1.15} right>
                  <Text numberOfLines={1} className={`text-[14px] font-bold leading-5 ${row.dueNow ? "text-amber-900" : "text-green-700"}`}>
                    {row.dueNow ? compactInr(row.dueNow) : "No dues"}
                  </Text>
                  <Text numberOfLines={1} className="mt-0.5 text-[11px] text-ink-500">
                    {row.late ? `${compactInr(row.fee)} + ${compactInr(row.late)} late` : compactInr(row.fee)}
                  </Text>
                </Cell>
                <Cell flex={0.9}>
                  <Text
                    numberOfLines={1}
                    className={`self-start rounded-full px-2 py-1 text-[11px] font-semibold ${
                      row.status.id === "paid"
                        ? "bg-green-50 text-green-700"
                        : row.status.id === "overdue"
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    {row.status.label}
                  </Text>
                </Cell>
                <Cell flex={1.25}>
                  <Text numberOfLines={1} className="text-[13px] font-medium text-ink-900">{row.period}</Text>
                  <Text numberOfLines={1} className="mt-0.5 text-[11px] text-ink-500">
                    {row.months ? `${row.months} month${row.months === 1 ? "" : "s"} · due ${row.dueDate}` : `Due ${row.dueDate}`}
                  </Text>
                </Cell>
                <Cell flex={1.35} right>
                  {row.lastPayment ? (
                    <>
                      <Text numberOfLines={1} className="text-[12px] font-medium text-ink-900">{row.lastPayment.amount}</Text>
                      <Text numberOfLines={1} className="mt-0.5 text-[11px] text-ink-500">{row.lastPayment.date} · {row.lastPayment.mode}</Text>
                    </>
                  ) : (
                    <Text className="text-[12px] text-ink-400">No payment yet</Text>
                  )}
                </Cell>
                <Cell flex={0.32} right>
                  <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
                </Cell>
              </Pressable>
            );
          })}
    </View>
  );

  const historyTable = (
    <View className="w-full">
      <View className="flex-row border-b border-ink-200" style={stickyHead}>
        <Head label="Time" flex={1.3} />
        <Head label="Adm no." flex={1} />
        <Head label="Student" flex={1.6} />
        <Head label="Class" flex={0.8} />
        <Head label="Fee" flex={1.9} />
        <Head label="Amount" flex={1} right />
        <Head label="Mode" flex={0.9} />
        <Head label="Documents" flex={1.7} />
      </View>
      {reportEvents.map((row) => {
        const when = clockLabel(row.paidAt);
        return (
          <View key={row.key} className="flex-row border-b border-ink-50 bg-white" style={{ minHeight: 56 }}>
            <Cell flex={1.3}>
              <Text numberOfLines={1} className="text-[13px] leading-5 text-ink-900">
                {when.day}
                {when.time ? `, ${when.time}` : ""}
              </Text>
            </Cell>
            <Cell flex={1}>{row.admissionNo || "—"}</Cell>
            <Cell flex={1.6}>
              <Text numberOfLines={1} className="text-[13px] font-medium leading-5 text-ink-900">
                {row.studentName}
              </Text>
            </Cell>
            <Cell flex={0.8}>{row.classLabel}</Cell>
            <Cell flex={1.9}>{row.fee}</Cell>
            <Cell flex={1} right>
              {row.amount}
            </Cell>
            <Cell flex={0.9}>{row.mode}</Cell>
            <Cell flex={1.7}>
              <View className="flex-row flex-wrap gap-1.5">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open invoice for ${row.studentName}`}
                  onPress={() => {
                    void openDueFeeDocument({ id: row.invoiceId, invoiceUrl: row.invoiceUrl, receiptUrl: row.receiptUrl }, false);
                  }}
                  className="flex-row items-center gap-1 rounded-md bg-indigo-50 px-2 py-1"
                >
                  <Ionicons name="document-text-outline" size={13} color="#4338ca" />
                  <Text className="text-[11px] font-semibold text-indigo-800">Invoice</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open receipt for ${row.studentName}`}
                  onPress={() => {
                    void openDueFeeDocument({ id: row.invoiceId, invoiceUrl: row.invoiceUrl, receiptUrl: row.receiptUrl }, true);
                  }}
                  className="flex-row items-center gap-1 rounded-md bg-emerald-50 px-2 py-1"
                >
                  <Ionicons name="receipt-outline" size={13} color="#047857" />
                  <Text className="text-[11px] font-semibold text-emerald-800">Receipt</Text>
                </Pressable>
              </View>
            </Cell>
          </View>
        );
      })}
      {!reportEvents.length ? (
        <View className="px-3 py-8">
          <Text className="text-sm text-ink-600">No payments match these filters.</Text>
        </View>
      ) : null}
    </View>
  );

  const selectedOpen = selectedDueStudent ? unpaidInvoices(selectedDueStudent) : [];
  const selectedMonths = selectedDueStudent ? studentMonths(selectedDueStudent) : [];
  const selectedDue = selectedOpen.reduce((sum, inv) => sum + invoiceDueParts(inv).dueNow, 0);
  const selectedLate = selectedOpen.reduce((sum, inv) => sum + invoiceDueParts(inv).late, 0);
  const selectedStructure = (() => {
    if (!selectedDueStudent) return { name: "Monthly fee", lines: [] as { label: string; amount: number }[] };
    const classTpls = templates
      .filter((row) => row.classId === selectedDueStudent.classId && (!currentSession || row.sessionId === currentSession.id || !row.sessionId))
      .sort((a, b) => (b.startsPeriod || "").localeCompare(a.startsPeriod || ""));
    const tpl = classTpls[0];
    const classLines = (tpl?.lines || [])
      .filter((line) => line.scope !== "ADD_ON" && Number(line.amount) > 0)
      .map((line) => ({ label: line.label, amount: Number(line.amount) || 0 }));
    const addOns = (selectedDueStudent.feeAddOns || []).map((row) => ({ label: row.label, amount: row.amount }));
    return { name: tpl?.name || "Monthly fee", lines: [...classLines, ...addOns] };
  })();
  const breakdown = dueBreakdown(selectedOpen, selectedStructure.lines);

  function BreakdownRow({ label, rate, months, total, tone }: { label: string; rate: number; months: number; total: number; tone?: "late" }) {
    const color = tone === "late" ? "text-amber-900" : "text-ink-900";
    return (
      <View className="flex-row border-b border-ink-50" style={{ minHeight: 44 }}>
        <Cell flex={1.5}>
          <Text className={`text-[13px] leading-5 ${color}`}>{label}</Text>
        </Cell>
        <Cell flex={1} right>
          {inr(rate)}
        </Cell>
        <Cell flex={0.8} right>
          {String(months)}
        </Cell>
        <Cell flex={1.1} right>
          <Text className={`text-[13px] font-semibold leading-5 ${color}`}>{inr(total)}</Text>
        </Cell>
      </View>
    );
  }

  function MonthRow({ inv }: { inv: Invoice }) {
    const parts = invoiceDueParts(inv);
    const paid = inv.status === "paid" || parts.dueNow <= 0;
    const latestPay = [...(inv.payments ?? [])].sort((a, b) => String(b.paidAt || "").localeCompare(String(a.paidAt || "")))[0];
    const when = clockLabel(latestPay?.paidAt);
    return (
      <View className="border-b border-ink-50 py-2">
        <View className="flex-row items-start justify-between gap-2">
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-[13px] font-medium leading-5 text-ink-900">
              {shortMonth(inv.period, inv.title)}
            </Text>
            <Text numberOfLines={1} className="mt-0.5 text-[11px] leading-4 text-ink-600">
              {paid
                ? `${when.day !== "—" ? when.day : "Paid"} · ${inv.paid || inv.amount}`
                : `Due ${compactInr(parts.dueNow)}${parts.late ? ` · Late ${compactInr(parts.late)}` : ""}`}
            </Text>
          </View>
          <Text className={`text-[13px] font-semibold leading-5 ${paid ? "text-green-700" : "text-amber-900"}`}>
            {paid ? "Paid" : compactInr(parts.dueNow)}
          </Text>
        </View>
        <View className="mt-2 flex-row flex-wrap gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Invoice ${shortMonth(inv.period, inv.title)}`}
            onPress={() => void openDueFeeDocument(inv, false)}
            className="flex-row items-center gap-1 rounded-md bg-indigo-50 px-2.5 py-1"
          >
            <Ionicons name="document-text-outline" size={14} color="#4338ca" />
            <Text className="text-xs font-semibold text-indigo-800">Invoice</Text>
          </Pressable>
          {paid ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Receipt ${shortMonth(inv.period, inv.title)}`}
              onPress={() => void openDueFeeDocument(inv, true)}
              className="flex-row items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1"
            >
              <Ionicons name="receipt-outline" size={14} color="#047857" />
              <Text className="text-xs font-semibold text-emerald-800">Receipt</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  const dueStudentPanel = selectedDueStudent ? (
    <ScrollView className="min-h-0 flex-1 bg-white" contentContainerStyle={{ paddingBottom: 28 }}>
      <View className="border-b border-ink-100 px-4 py-4 sm:px-5">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1" style={{ flexShrink: 1 }}>
            <Text className="text-lg font-semibold leading-6 text-ink-900" numberOfLines={2}>
              {selectedDueStudent.name}
            </Text>
            <Text className="mt-1 text-sm leading-5 text-ink-600" numberOfLines={1}>
              {selectedDueStudent.classLabel} · {selectedDueStudent.admissionNo}
            </Text>
            <Text className="mt-0.5 text-sm leading-5 text-ink-700" numberOfLines={1}>
              Parent · {selectedDueStudent.parent || "—"}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close student" onPress={() => setSelectedDueStudentId("")} className="h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-50">
            <Ionicons name="close" size={18} color="#dc2626" />
          </Pressable>
        </View>
        {breakdown.monthLabels.length ? (
          <View className="mt-3 flex-row flex-wrap items-center gap-1.5">
            <Text className="text-sm leading-5 text-ink-600">Open months</Text>
            {breakdown.monthLabels.map((label) => (
              <View key={label} className="rounded-full bg-ink-50 px-2.5 py-1">
                <Text className="text-xs font-semibold text-ink-800">{label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View className="mt-3 flex-row gap-2">
          <View className="min-w-0 flex-1 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5">
            <Text className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">Due now</Text>
            <Text className="mt-0.5 text-base font-semibold text-amber-950" numberOfLines={1}>
              {selectedDue ? inr(selectedDue) : "No dues"}
            </Text>
            <Text className="mt-0.5 text-[11px] leading-4 text-ink-600" numberOfLines={1}>
              {breakdown.months ? `${timesLabel(breakdown.months)} open` : "Settled"}
            </Text>
          </View>
          <View className="min-w-0 flex-1 rounded-lg border border-ink-100 bg-ink-50 px-3 py-2.5">
            <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Late fine</Text>
            <Text className="mt-0.5 text-base font-semibold text-ink-900" numberOfLines={1}>
              {selectedLate ? inr(selectedLate) : "—"}
            </Text>
            <Text className="mt-0.5 text-[11px] leading-4 text-ink-600" numberOfLines={1}>
              {selectedLate ? "In due now" : "None"}
            </Text>
          </View>
        </View>
        <View className="mt-3 flex-row flex-wrap gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${selectedDueStudent.name} profile`}
            onPress={() => router.push({ pathname: "/people", params: { student: selectedDueStudent.id } } as never)}
            className="h-10 min-w-[96px] flex-1 flex-row items-center justify-center gap-1.5 rounded-md border border-sky-200 bg-sky-50"
          >
            <Ionicons name="person-outline" size={16} color="#0369a1" />
            <Text className="text-sm font-semibold text-sky-800">Student</Text>
          </Pressable>
          {selectedOpen[0] || selectedMonths[0] ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open invoice"
              onPress={() => void openDueFeeDocument(selectedOpen[0] || selectedMonths[0], false)}
              className="h-10 min-w-[96px] flex-1 flex-row items-center justify-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50"
            >
              <Ionicons name="document-text-outline" size={16} color="#4338ca" />
              <Text className="text-sm font-semibold text-indigo-800">Invoice</Text>
            </Pressable>
          ) : null}
          {collect && selectedDue > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setPayDueStudentId(selectedDueStudent.id)}
              className="h-10 min-w-[140px] flex-[1.2] flex-row items-center justify-center gap-1.5 rounded-md bg-blue-600"
            >
              <Ionicons name="cash-outline" size={16} color="#fff" />
              <Text className="text-sm font-semibold text-white">Collect payment</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View className="border-b border-ink-100 px-4 py-4 sm:px-5">
        {selectedStructure.lines.length || breakdown.chargeRows.length ? (
          compact ? (
            <View className="overflow-hidden rounded-lg border border-ink-100 bg-white">
              {(breakdown.chargeRows.length ? breakdown.chargeRows : selectedStructure.lines.map((line) => ({ label: line.label, rate: line.amount, months: 1, total: line.amount }))).map((row) => (
                <View key={`${row.label}-${row.rate}`} className="flex-row items-start justify-between gap-3 border-b border-ink-50 px-3 py-2.5">
                  <View className="min-w-0 flex-1" style={{ flexShrink: 1 }}>
                    <Text className="text-sm text-ink-900">{row.label}</Text>
                    <Text className="mt-0.5 text-xs text-ink-600">
                      {inr(row.rate)} × {row.months} month{row.months === 1 ? "" : "s"}
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold text-ink-900">{inr(row.total)}</Text>
                </View>
              ))}
              {breakdown.lateRows.map((row) => (
                <View key={`${row.label}-${row.rate}`} className="flex-row items-start justify-between gap-3 border-b border-ink-50 px-3 py-2.5">
                  <View className="min-w-0 flex-1" style={{ flexShrink: 1 }}>
                    <Text className="text-sm text-amber-900">{row.label}</Text>
                    <Text className="mt-0.5 text-xs text-ink-600">
                      {inr(row.rate)} × {row.months}
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold text-amber-900">{inr(row.total)}</Text>
                </View>
              ))}
              <View className="flex-row items-center justify-between bg-ink-50 px-3 py-3">
                <Text className="text-sm font-semibold text-ink-900">Total due</Text>
                <Text className="text-sm font-semibold text-ink-900">{inr(selectedDue || breakdown.total)}</Text>
              </View>
            </View>
          ) : (
          <View className="overflow-hidden rounded-lg border border-ink-100 bg-white">
            <View className="flex-row border-b border-ink-200 bg-ink-50">
              <Head label="Particular" flex={1.5} />
              <Head label="Rate" flex={1} right />
              <Head label="Months" flex={0.8} right />
              <Head label="Amount" flex={1.1} right />
            </View>
            {breakdown.chargeRows.length
              ? breakdown.chargeRows.map((row) => (
                  <BreakdownRow key={`${row.label}-${row.rate}`} label={row.label} rate={row.rate} months={row.months} total={row.total} />
                ))
              : selectedStructure.lines.map((line) => (
                  <BreakdownRow key={line.label} label={line.label} rate={line.amount} months={1} total={line.amount} />
                ))}
            {breakdown.lateRows.map((row) => (
              <BreakdownRow key={`${row.label}-${row.rate}`} label={row.label} rate={row.rate} months={row.months} total={row.total} tone="late" />
            ))}
            <View className="flex-row bg-ink-50" style={{ minHeight: 48 }}>
              <Cell flex={1.5}>
                <Text className="text-sm font-semibold text-ink-900">Total due</Text>
              </Cell>
              <Cell flex={1} right>
                {""}
              </Cell>
              <Cell flex={0.8} right>
                {""}
              </Cell>
              <Cell flex={1.1} right>
                <Text className="text-sm font-semibold text-ink-900">{inr(selectedDue || breakdown.total)}</Text>
              </Cell>
            </View>
          </View>
          )
        ) : (
          <Text className="mt-2 text-sm leading-5 text-ink-600">No fee structure on this class yet.</Text>
        )}
      </View>

      <View className="px-4 pt-4 sm:px-5">
        <Text className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Fee history</Text>
        {selectedMonths.map((inv) => (
          <MonthRow key={inv.id} inv={inv} />
        ))}
        {!selectedMonths.length ? <Text className="py-2 text-sm text-ink-600">No fee months yet.</Text> : null}
      </View>
    </ScrollView>
  ) : null;

  const setupTabs = (
    <View className="mb-3 flex-row flex-wrap gap-1 rounded-md border border-ink-200 bg-white p-0.5 self-start">
      {(
        [
          ["class", "Class Fees"],
          ["transport", "Transport"],
          ["other", "Other Fees"],
          ["late", "Late Fee"],
        ] as const
      ).map(([id, label]) => (
        <Pressable
          key={id}
          accessibilityRole="button"
          onPress={() => setSetupPane(id)}
          className={`rounded-md px-3 py-1.5 ${setupPane === id ? "bg-blue-600" : "bg-white"}`}
        >
          <Text className={`text-sm font-semibold ${setupPane === id ? "text-white" : "text-ink-800"}`}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );

  const catalogTable = (kind: "TRANSPORT" | "OTHER") => {
    const rows = kind === "TRANSPORT" ? transportItems : otherItems;
    return (
      <View className="overflow-hidden rounded-md border border-ink-100 bg-white">
        <View className="flex-row items-center justify-between border-b border-ink-100 px-3 py-2.5">
          <Text className="text-sm font-semibold text-ink-900">{kind === "TRANSPORT" ? "Transport fees" : "Other fees"}</Text>
          {configure ? (
            <Button
              variant="ghost"
              onPress={() => {
                setCatalogKind(kind);
                setCatalogId("");
                setCatalogLabel("");
                setCatalogAmount("");
                setCatalogActive(true);
                setCatalogOpen(true);
              }}
            >
              {kind === "TRANSPORT" ? "+ Add transport option" : "+ Add other fee"}
            </Button>
          ) : null}
        </View>
        <View className="flex-row border-b border-ink-200 px-3">
          <Head label={kind === "TRANSPORT" ? "Option" : "Fee name"} flex={2} />
          <Head label="Monthly fee" flex={1} right />
          <Head label="Status" flex={0.8} />
        </View>
        {rows.map((item) => (
          <Pressable
            key={item.id}
            disabled={!configure}
            onPress={() => {
              setCatalogKind(kind);
              setCatalogId(item.id);
              setCatalogLabel(item.label);
              setCatalogAmount(String(item.amount));
              setCatalogActive(item.active);
              setCatalogOpen(true);
            }}
            className="flex-row border-b border-ink-50 px-3"
            style={{ minHeight: 48 }}
          >
            <Cell flex={2}>{item.label}</Cell>
            <Cell flex={1} right>
              {inr(item.amount)}
            </Cell>
            <Cell flex={0.8}>
              <Text className={`text-[13px] ${item.active ? "text-green-700" : "text-ink-500"}`}>{item.active ? "Active" : "Inactive"}</Text>
            </Cell>
          </Pressable>
        ))}
        {!rows.length ? (
          <View className="px-3 py-6">
            <Text className="text-sm text-ink-600">
              {kind === "TRANSPORT" ? "No transport options yet. Add reusable monthly routes for optional assignment." : "No other fees yet. Add Computer, Activity, Library, and similar optional charges."}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  const setupBody =
    setupPane === "academic" ? (
      <View className="overflow-hidden rounded-md border border-ink-100 bg-white p-4">
        <View className="flex-row flex-wrap items-start justify-between gap-6">
          <View className="min-w-[280px] flex-1 gap-3">
            <Text className="text-sm font-semibold text-ink-900">Academic</Text>
            <Text className="text-xs leading-5 text-ink-600">Session dates, monthly due day, and one-time admission fee.</Text>
            <View className="max-w-[240px]">
              <Select
                label="Academic session"
                value={sessionYearId(sessionStart, sessionEnd)}
                options={SESSION_YEAR_OPTIONS}
                placeholder="Pick session"
                onChange={(id) => {
                  const next = datesForSessionYear(id, sessionStart, sessionEnd);
                  setSessionStart(next.startsOn);
                  setSessionEnd(next.endsOn);
                }}
              />
            </View>
            <View className="flex-row flex-wrap gap-3">
              <View className="min-w-[200px] flex-1">
                <Field label="Starts">
                  <DateField value={sessionStart} onChange={setSessionStart} />
                </Field>
              </View>
              <View className="min-w-[200px] flex-1">
                <Field label="Ends">
                  <DateField value={sessionEnd} onChange={setSessionEnd} />
                </Field>
              </View>
            </View>
            {configure ? (
              <View className="items-start">
                <Button onPress={() => void saveAcademicSession()}>Save session</Button>
              </View>
            ) : null}
          </View>
          <View className="gap-2 self-start" style={{ width: 168, flexShrink: 0 }}>
            <Text className="text-xs font-medium text-ink-700">Due day</Text>
            <View className="flex-row flex-wrap" style={{ width: 168 }}>
              {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => {
                const on = sessionDueDay === day;
                return (
                  <Pressable
                    key={day}
                    accessibilityRole="button"
                    onPress={() => setSessionDueDay(day)}
                    className="items-center justify-center"
                    style={{ width: 28, height: 28 }}
                  >
                    <View className={`h-6 w-6 items-center justify-center rounded-full ${on ? "bg-blue-600" : ""}`}>
                      <Text className={`text-[11px] font-semibold ${on ? "text-white" : "text-ink-800"}`}>{day}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text className="text-[11px] leading-4 text-ink-600">
              {ordinalDay(sessionDueDay)} each month.
            </Text>
            {configure ? (
              <View className="self-start">
                <Button onPress={() => void saveSessionDueDay()}>Save due day</Button>
              </View>
            ) : null}
          </View>
        </View>
        <View className="mt-5 border-t border-ink-100 pt-4">
          <Text className="text-sm font-semibold text-ink-900">Admission fee</Text>
          <Text className="mt-1 text-xs leading-5 text-ink-600">
            One-time charge at the start of the academic session. Pick a class card, then set that class’s admission fee. This is not a monthly class fee.
          </Text>
          {classRows.length ? (
            <View className="mt-3 flex-row flex-wrap gap-2">
              {classRows.map((row) => {
                const selected = admissionClassId === row.klass.id;
                const total = admissionByClass.get(row.klass.id) || 0;
                return (
                  <Pressable
                    key={row.klass.id}
                    accessibilityRole="button"
                    onPress={() => setAdmissionClassId(row.klass.id)}
                    className={`min-w-[140px] flex-1 rounded-md border px-3 py-3 ${selected ? "border-clay-500 bg-blue-50" : "border-ink-200 bg-white"}`}
                    style={{ maxWidth: 220 }}
                  >
                    <Text className={`text-sm font-semibold ${selected ? "text-ink-900" : "text-ink-800"}`}>{row.klass.label}</Text>
                    <Text className={`mt-1 text-base font-semibold ${total ? "text-ink-900" : "text-ink-500"}`}>
                      {total ? inr(total) : "Not set"}
                    </Text>
                    <Text className="mt-0.5 text-[11px] text-ink-600">One-time</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text className="mt-3 text-sm text-ink-600">Add classes in Settings first, then set each class’s one-time admission fee here.</Text>
          )}
          <View className="mt-4 gap-2">
            <View className="flex-row px-1">
              <Text className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Charge</Text>
              <Text className="w-32 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-500">Amount</Text>
              <View className="w-16" />
            </View>
            {admissionLines.map((line) => (
              <View key={line.id} className="flex-row items-center gap-2">
                <View className="min-w-0 flex-1">
                  <Input
                    placeholder="e.g. Admission fee"
                    value={line.label}
                    onChangeText={(label) => setAdmissionLines((rows) => rows.map((row) => (row.id === line.id ? { ...row, label } : row)))}
                  />
                </View>
                <View className="w-32">
                  <Input
                    keyboardType="number-pad"
                    value={line.amount}
                    onChangeText={(amount) => setAdmissionLines((rows) => rows.map((row) => (row.id === line.id ? { ...row, amount } : row)))}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setAdmissionLines((rows) => (rows.length > 1 ? rows.filter((row) => row.id !== line.id) : rows))}
                  className="w-16 items-center py-2"
                >
                  <Text className="text-xs font-semibold text-red-700">Remove</Text>
                </Pressable>
              </View>
            ))}
            {configure ? (
              <View className="gap-2 pt-1">
                <Pressable onPress={() => setAdmissionLines((rows) => [...rows, newFeeLine("Admission fee", "")])} className="self-start py-1">
                  <Text className="text-xs font-semibold text-blue-700">+ Add charge</Text>
                </Pressable>
                <SuggestionPills
                  options={ADMISSION_SUGGESTIONS}
                  used={admissionLines.map((line) => line.label)}
                  onPick={(label) =>
                    setAdmissionLines((rows) => {
                      if (rows.some((row) => row.label.trim().toLowerCase() === label.toLowerCase())) return rows;
                      const empty = rows.find((row) => !row.label.trim());
                      if (empty) return rows.map((row) => (row.id === empty.id ? { ...row, label } : row));
                      return [...rows, newFeeLine(label)];
                    })
                  }
                />
              </View>
            ) : null}
            <View className="mt-2 flex-row items-center justify-between border-t border-ink-100 pt-3">
              <View>
                <Text className="text-sm font-semibold text-ink-900">Admission total</Text>
                <Text className="mt-0.5 text-xs text-ink-600">
                  Type: One time · {classes.find((row) => row.id === admissionClassId)?.label || "Selected class"}
                </Text>
              </View>
              <Text className="text-sm font-semibold text-ink-900">{inr(admissionTotal)}</Text>
            </View>
            {configure ? (
              <View className="mt-3 flex-row flex-wrap justify-end gap-2">
                <Button variant="ghost" onPress={() => void saveAdmissionFee(true)}>
                  Save for all classes
                </Button>
                <Button onPress={() => void saveAdmissionFee()}>Save</Button>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    ) : setupPane === "class" ? (
      <View className="overflow-hidden rounded-md border border-ink-100 bg-white">
        <View className="flex-row items-center justify-between gap-3 border-b border-ink-100 px-3 py-3">
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-semibold text-ink-900">Class fees</Text>
            <Text className="mt-0.5 text-xs text-ink-600">Add a new structure whenever the fee changes. Periods for the same class cannot overlap.</Text>
          </View>
          {configure ? <Button onPress={openNewClassFee}>Add class fee</Button> : null}
        </View>
        <View className="flex-row border-b border-ink-200 px-3">
          <Head label="Class" flex={1.2} />
          <Head label="Monthly fee" flex={1} right />
          <Head label="Applies" flex={1.4} />
          <Head label="Due" flex={0.7} />
        </View>
        {feeStructures.map((template) => {
          const monthly = (template.lines || []).filter((line) => line.scope !== "ADD_ON").reduce((sum, line) => sum + Math.max(0, Math.round(Number(line.amount) || 0)), 0);
          return (
          <Pressable
            key={template.id}
            disabled={!configure}
            onPress={() => openClassFee(template.id, template.classId)}
            className="flex-row border-b border-ink-50 px-3"
            style={{ minHeight: 48 }}
          >
            <Cell flex={1.2}>
              <Text className="text-[13px] font-semibold text-ink-900">{classes.find((row) => row.id === template.classId)?.label || "Class"}</Text>
              <Text className="mt-0.5 text-[11px] text-ink-600">{template.name}</Text>
            </Cell>
            <Cell flex={1} right>
              {inr(monthly)}
            </Cell>
            <Cell flex={1.4}>{periodRangeLabel(template.startsPeriod, template.endsPeriod)}</Cell>
            <Cell flex={0.7}>{ordinalDay(template.dueDay || 10)}</Cell>
          </Pressable>
          );
        })}
        {!feeStructures.length ? (
          <View className="px-3 py-6">
            <Text className="text-sm text-ink-600">No class fee structures yet. Add one to start billing a class.</Text>
          </View>
        ) : null}
      </View>
    ) : setupPane === "transport" ? (
      catalogTable("TRANSPORT")
    ) : setupPane === "other" ? (
      catalogTable("OTHER")
    ) : (
      <Card className="p-4">
        <Text className="text-sm font-semibold text-ink-900">Late fee</Text>
        <Text className="mt-1 text-xs text-ink-600">Applies to newly generated invoices. Paid and historical invoices stay unchanged.</Text>
        <View className="mt-4 flex-row items-center justify-between">
          <Text className="text-sm text-ink-800">Late fee enabled</Text>
          <Switch on={lateEnabled} disabled={!configure} onPress={() => setLateEnabled((value) => !value)} />
        </View>
        {lateEnabled ? (
          <View className="mt-4 gap-3">
            <View className="max-w-2xl">
              <Text className="mb-1.5 text-xs font-medium text-ink-700">How to charge late fine</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {LATE_RULES.map((rule) => {
                  const on = lateRule === rule.id;
                  return (
                    <Pressable
                      key={rule.id}
                      accessibilityRole="button"
                      onPress={() => setLateRule(rule.id)}
                      className={`rounded-md px-3 py-1.5 ${on ? "bg-blue-600" : "border border-ink-200 bg-white"}`}
                    >
                      <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-800"}`}>{rule.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View className="flex-row flex-wrap gap-3">
              <View className="w-36">
                <Field label={lateRule.startsWith("PERCENT") ? "Percent" : "Amount (₹)"}>
                  <Input keyboardType="number-pad" value={lateAmount} onChangeText={setLateAmount} />
                </Field>
              </View>
              {lateRule === "RECURRING_DAY" ? (
                <View className="w-36">
                  <Field label="Every (days)">
                    <Input keyboardType="number-pad" value={lateEvery} onChangeText={setLateEvery} />
                  </Field>
                </View>
              ) : null}
              <View className="w-36">
                <Field label="Grace period (days)">
                  <Input keyboardType="number-pad" value={lateGrace} onChangeText={setLateGrace} />
                </Field>
              </View>
            </View>
            <Text className="max-w-xl text-xs leading-5 text-ink-600">
              {lateRule === "STATIC"
                ? `₹${Math.max(0, Math.round(Number(lateAmount) || 0))} is added once after the grace period.`
                : lateRule === "DAILY"
                  ? `₹${Math.max(0, Math.round(Number(lateAmount) || 0))} is added for each day after the grace period.`
                  : lateRule === "RECURRING_DAY"
                    ? `₹${Math.max(0, Math.round(Number(lateAmount) || 0))} is added every ${Math.max(1, Math.round(Number(lateEvery) || 15))} days after the grace period.`
                    : lateRule === "PERCENT"
                      ? `${Math.max(0, Number(lateAmount) || 0)}% of the unpaid invoice amount is added once after the grace period.`
                      : lateRule === "PERCENT_MONTH"
                        ? `${Math.max(0, Number(lateAmount) || 0)}% of the unpaid invoice amount is added for each overdue month after the grace period.`
                        : `₹${Math.max(0, Math.round(Number(lateAmount) || 0))} is added for each overdue fee month after the grace period.`}
            </Text>
          </View>
        ) : (
          <Text className="mt-3 text-sm text-ink-600">No late fee will be added on new invoices.</Text>
        )}
        {configure ? (
          <View className="mt-4 items-end">
            <Button onPress={() => void saveLateFee()}>Save late fee</Button>
          </View>
        ) : null}
      </Card>
    );

  return (
    <View className="min-h-0 flex-1">
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {compact && selectedDueStudent && (tab === "register" || tab === "insight") ? null : toolbar}
      {tab === "setup" ? (
        <ScrollView className="flex-1">
          {setupTabs}
          {setupBody}
        </ScrollView>
      ) : compact && selectedDueStudent && (tab === "register" || tab === "insight") ? (
        <View className="min-h-0 flex-1 overflow-hidden rounded-xl border border-ink-100 bg-white">
          {dueStudentPanel}
        </View>
      ) : tab === "insight" ? (
        <View className="min-h-0 flex-1 flex-row overflow-hidden rounded-xl border border-ink-100 bg-white">
          <View className="min-w-0 flex-1">
            <FeeReport
              people={people}
              classes={classes}
              sessions={data?.school?.sessions ?? []}
              refreshing={refreshing}
              onOpenPayment={(inv, paid) => void openDueFeeDocument(inv, paid)}
              onOpenStudent={(studentId) => {
                setSelectedDueStudentId(studentId);
              }}
            />
          </View>
          {!compact && selectedDueStudent ? (
            <View className="min-h-0 overflow-hidden border-l border-ink-200 bg-white" style={{ width: 480 }}>
              {dueStudentPanel}
            </View>
          ) : null}
        </View>
      ) : (
        <View className="min-h-0 flex-1 flex-row overflow-hidden rounded-xl border border-ink-100 bg-white">
          <View className="min-w-0 flex-1 overflow-hidden bg-white">
            {compact ? (
              <ScrollView>
                {(tab === "register" ? registerRows : reportEvents).map((row) =>
                  tab === "register" && "person" in row ? (
                    <Pressable
                      key={row.person.id}
                      onPress={() => {
                        setSelectedDueStudentId(row.person.id);
                      }}
                      className="border-b border-ink-50 px-3 py-3"
                    >
                      <Text className="text-sm font-semibold text-ink-900">{row.person.name}</Text>
                      <Text className="mt-0.5 text-xs text-ink-600">
                        {row.person.admissionNo} · {row.person.classLabel} · {row.period}
                      </Text>
                      <Text className="mt-1 text-sm font-semibold text-amber-900">{row.dueNow ? compactInr(row.dueNow) : "No dues"}</Text>
                    </Pressable>
                  ) : "key" in row ? (
                    <Pressable
                      key={row.key}
                      onPress={() => void openDueFeeDocument({ id: row.invoiceId, invoiceUrl: row.invoiceUrl, receiptUrl: row.receiptUrl }, true)}
                      className="border-b border-ink-50 px-3 py-3"
                    >
                      <Text className="text-sm font-semibold text-ink-900">{row.studentName}</Text>
                      <Text className="mt-0.5 text-xs text-ink-600">
                        {row.admissionNo} · {row.fee} · {row.mode}
                      </Text>
                      <Text className="mt-1 text-sm font-semibold text-ink-900">{row.amount}</Text>
                    </Pressable>
                  ) : null
                )}
              </ScrollView>
            ) : (
              <ScrollView
                style={{ flex: 1, ...(Platform.OS === "web" ? { overflowX: "hidden" as const } : {}) }}
                contentContainerStyle={{ flexGrow: 1, width: "100%" }}
                showsHorizontalScrollIndicator={false}
              >
                {tab === "register" ? registerTable : historyTable}
              </ScrollView>
            )}
          </View>
          {!compact && tab === "register" && selectedDueStudent ? (
            <View className="min-h-0 overflow-hidden border-l border-ink-200 bg-white" style={{ width: 480 }}>
              {dueStudentPanel}
            </View>
          ) : null}
        </View>
      )}

      <GeneratePayment
        open={Boolean(payDueStudent)}
        student={payDueStudent}
        title={payDueStudent ? `Payment · ${payDueStudent.name}` : undefined}
        onClose={() => setPayDueStudentId("")}
        onDone={async (message) => {
          setPayDueStudentId("");
          toast.show(message);
          await reload();
        }}
      />

      <Modal
        open={feeEditorOpen}
        wide
        title={classes.find((row) => row.id === editorClassId)?.label || "Class fee"}
        onClose={() => setFeeEditorOpen(false)}
        footer={
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button variant="ghost" onPress={() => setFeeEditorOpen(false)}>
              Cancel
            </Button>
            {collect && classTemplate ? (
              <Button variant="ghost" onPress={() => void issueFeeTemplate(editorClassId, classTemplate.id)}>
                Generate invoices
              </Button>
            ) : null}
            {configure ? <Button onPress={() => void saveFeeTemplate()}>Save</Button> : null}
          </View>
        }
      >
        <View className="gap-4">
          <View>
            <Text className="text-sm font-semibold text-ink-900">Fee structure</Text>
            <Text className="mt-1 text-xs text-ink-600">Each class can have consecutive fee structures, but their periods cannot overlap.</Text>
          </View>
          <View className="flex-row flex-wrap gap-3">
            <View className="min-w-[220px] flex-1">
              <Select
                label="Class"
                value={editorClassId}
                options={classes.map((row) => ({ id: row.id, label: row.label }))}
                placeholder="Choose class"
                onChange={setEditorClassId}
              />
            </View>
            <View className="min-w-[220px] flex-1">
              <Field label="Name">
                <Input value={tplName} onChangeText={setTplName} />
              </Field>
            </View>
            <View className="w-28">
              <Field label="Due day">
                <Input keyboardType="number-pad" value={tplDue} onChangeText={setTplDue} />
              </Field>
            </View>
          </View>
          <View className="flex-row flex-wrap gap-3">
            <View className="min-w-[160px] flex-1">
              <Field label="Starts (YYYY-MM)">
                <Input placeholder={defaultStartPeriod} value={tplStartPeriod} onChangeText={setTplStartPeriod} />
              </Field>
            </View>
            <View className="min-w-[160px] flex-1">
              <Field label="Ends (YYYY-MM)">
                <Input placeholder={defaultEndPeriod} value={tplEndPeriod} onChangeText={setTplEndPeriod} />
              </Field>
            </View>
          </View>
          {structureRange ? <Text className="-mt-1 text-xs text-ink-600">Applies {structureRange}</Text> : null}
          <View className="gap-2">
            <View className="flex-row px-1">
              <Text className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Charge</Text>
              <Text className="w-32 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-500">Amount</Text>
              <View className="w-16" />
            </View>
            {tplLines.map((line) => (
              <View key={line.id} className="flex-row items-center gap-2">
                <View className="min-w-0 flex-1">
                  <Input
                    placeholder="e.g. Lab"
                    value={line.label}
                    onChangeText={(label) => setTplLines((rows) => rows.map((row) => (row.id === line.id ? { ...row, label } : row)))}
                  />
                </View>
                <View className="w-32">
                  <Input
                    keyboardType="number-pad"
                    value={line.amount}
                    onChangeText={(amount) => setTplLines((rows) => rows.map((row) => (row.id === line.id ? { ...row, amount } : row)))}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setTplLines((rows) => (rows.length > 1 ? rows.filter((row) => row.id !== line.id) : rows))}
                  className="w-16 items-center py-2"
                >
                  <Text className="text-xs font-semibold text-red-700">Remove</Text>
                </Pressable>
              </View>
            ))}
            {configure ? (
              <View className="gap-2 pt-1">
                <Pressable onPress={() => setTplLines((rows) => [...rows, newFeeLine()])} className="self-start py-1">
                  <Text className="text-xs font-semibold text-blue-700">+ Add charge</Text>
                </Pressable>
                <SuggestionPills
                  options={CLASS_CHARGE_SUGGESTIONS}
                  used={tplLines.map((line) => line.label)}
                  onPick={(label) =>
                    setTplLines((rows) => {
                      if (rows.some((row) => row.label.trim().toLowerCase() === label.toLowerCase())) return rows;
                      const empty = rows.find((row) => !row.label.trim());
                      if (empty) return rows.map((row) => (row.id === empty.id ? { ...row, label } : row));
                      return [...rows, newFeeLine(label)];
                    })
                  }
                />
              </View>
            ) : null}
            <View className="mt-2 flex-row items-center justify-between border-t border-ink-100 pt-3">
              <Text className="text-sm font-semibold text-ink-900">Monthly total</Text>
              <Text className="text-sm font-semibold text-ink-900">{inr(tplTotal)}</Text>
            </View>
          </View>
          <View className="gap-2 border-t border-ink-100 pt-4">
            <Text className="text-sm font-semibold text-ink-900">Admission fee</Text>
            <Text className="text-xs leading-5 text-ink-600">
              One-time only. When a student is admitted to this class, Anekio creates this admission invoice and does not include the monthly fee above.
            </Text>
            <View className="mt-1 flex-row px-1">
              <Text className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Charge</Text>
              <Text className="w-32 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-500">Amount</Text>
              <View className="w-16" />
            </View>
            {admissionLines.map((line) => (
              <View key={line.id} className="flex-row items-center gap-2">
                <View className="min-w-0 flex-1">
                  <Input
                    placeholder="e.g. Admission fee"
                    value={line.label}
                    onChangeText={(label) => setAdmissionLines((rows) => rows.map((row) => (row.id === line.id ? { ...row, label } : row)))}
                  />
                </View>
                <View className="w-32">
                  <Input
                    keyboardType="number-pad"
                    value={line.amount}
                    onChangeText={(amount) => setAdmissionLines((rows) => rows.map((row) => (row.id === line.id ? { ...row, amount } : row)))}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setAdmissionLines((rows) => (rows.length > 1 ? rows.filter((row) => row.id !== line.id) : rows))}
                  className="w-16 items-center py-2"
                >
                  <Text className="text-xs font-semibold text-red-700">Remove</Text>
                </Pressable>
              </View>
            ))}
            {configure ? (
              <View className="gap-2 pt-1">
                <Pressable onPress={() => setAdmissionLines((rows) => [...rows, newFeeLine("Admission fee", "")])} className="self-start py-1">
                  <Text className="text-xs font-semibold text-blue-700">+ Add admission charge</Text>
                </Pressable>
                <SuggestionPills
                  options={ADMISSION_SUGGESTIONS}
                  used={admissionLines.map((line) => line.label)}
                  onPick={(label) =>
                    setAdmissionLines((rows) => {
                      if (rows.some((row) => row.label.trim().toLowerCase() === label.toLowerCase())) return rows;
                      const empty = rows.find((row) => !row.label.trim());
                      if (empty) return rows.map((row) => (row.id === empty.id ? { ...row, label } : row));
                      return [...rows, newFeeLine(label, "")];
                    })
                  }
                />
              </View>
            ) : null}
          </View>
          <View className="gap-2 border-t border-ink-100 pt-4">
            <Text className="text-sm font-semibold text-ink-900">Class add-ons</Text>
            <Text className="text-xs text-ink-600">
              Optional for this class only. Students opt in from Manage Fees — they are not billed automatically.
            </Text>
            {tplAddOnLines.map((line) => (
              <View key={line.id} className="flex-row items-center gap-2">
                <View className="min-w-0 flex-1">
                  <Input
                    placeholder="e.g. Project"
                    value={line.label}
                    onChangeText={(label) => setTplAddOnLines((rows) => rows.map((row) => (row.id === line.id ? { ...row, label } : row)))}
                  />
                </View>
                <View className="w-32">
                  <Input
                    keyboardType="number-pad"
                    value={line.amount}
                    onChangeText={(amount) => setTplAddOnLines((rows) => rows.map((row) => (row.id === line.id ? { ...row, amount } : row)))}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setTplAddOnLines((rows) => rows.filter((row) => row.id !== line.id))}
                  className="w-16 items-center py-2"
                >
                  <Text className="text-xs font-semibold text-red-700">Remove</Text>
                </Pressable>
              </View>
            ))}
            {configure ? (
              <View className="gap-2 pt-1">
                <Pressable onPress={() => setTplAddOnLines((rows) => [...rows, newFeeLine("", "", "ADD_ON")])} className="self-start py-1">
                  <Text className="text-xs font-semibold text-blue-700">+ Add class add-on</Text>
                </Pressable>
                <SuggestionPills
                  options={CLASS_ADDON_SUGGESTIONS}
                  used={tplAddOnLines.map((line) => line.label)}
                  onPick={(label) =>
                    setTplAddOnLines((rows) => {
                      if (rows.some((row) => row.label.trim().toLowerCase() === label.toLowerCase())) return rows;
                      const empty = rows.find((row) => !row.label.trim());
                      if (empty) return rows.map((row) => (row.id === empty.id ? { ...row, label } : row));
                      return [...rows, newFeeLine(label, "", "ADD_ON")];
                    })
                  }
                />
              </View>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        open={catalogOpen}
        title={catalogKind === "TRANSPORT" ? "Transport option" : "Other fee"}
        onClose={() => setCatalogOpen(false)}
        footer={
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={() => setCatalogOpen(false)}>
              Cancel
            </Button>
            {configure ? <Button onPress={() => void saveCatalogItem()}>Save</Button> : null}
          </View>
        }
      >
        <View className="gap-3">
          <Field label={catalogKind === "TRANSPORT" ? "Transport option" : "Fee name"}>
            <Input
              placeholder={catalogKind === "TRANSPORT" ? "e.g. Route A" : "e.g. Computer fee"}
              value={catalogLabel}
              onChangeText={setCatalogLabel}
            />
          </Field>
          <SuggestionPills
            options={catalogKind === "TRANSPORT" ? TRANSPORT_SUGGESTIONS : OTHER_FEE_SUGGESTIONS}
            used={(catalogKind === "TRANSPORT" ? transportItems : otherItems).map((item) => item.label)}
            selected={catalogLabel}
            onPick={setCatalogLabel}
          />
          <Field label="Monthly fee">
            <Input keyboardType="number-pad" value={catalogAmount} onChangeText={setCatalogAmount} />
          </Field>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-ink-800">Active</Text>
            <Switch on={catalogActive} onPress={() => setCatalogActive((value) => !value)} />
          </View>
          <Text className="text-xs text-ink-600">Price changes apply to future invoices only. Existing invoices stay unchanged.</Text>
        </View>
      </Modal>
    </View>
  );
}
