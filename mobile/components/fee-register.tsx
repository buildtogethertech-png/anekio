import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { api, apiBase } from "../lib/api";
import { act } from "../lib/mutate";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";
import { GeneratePayment } from "./generate-payment";
import { Select } from "./form";
import { Badge, Button, Card, Chip, Empty, Field, Input, Modal, PageHeader, Toast, useToast } from "./ui";

type Status = "paid" | "partial" | "unpaid" | "overdue";
type ExtraCol = "dueDate" | "daysOverdue" | "lastPayment" | "paymentMode" | "template" | "lateFee";

type Row = {
  id: string;
  studentId: string;
  admissionNo: string;
  studentName: string;
  classId: string;
  className: string;
  section: string;
  classLabel: string;
  period: string;
  monthLabel: string;
  dueDate: string;
  total: number;
  paid: number;
  balance: number;
  dueNow: number;
  lateFee: number;
  status: Status;
  daysOverdue: number;
  monthsDue: number;
  lastPaymentLabel: string;
  paymentMode: string;
  paymentModeLabel: string;
  templateName: string;
  receipt: boolean;
  receiptUrl: string;
};

type HistoryLine = {
  invoiceId: string;
  period: string;
  label: string;
  total: number;
  paid: number;
  balance: number;
  status: Status;
};

type Payload = {
  asOf: string;
  summary: {
    students: number;
    billed: number;
    paid: number;
    outstanding: number;
    overdue: number;
    partial: number;
    noReceipt: number;
  };
  rows: Row[];
  history: Record<string, HistoryLine[]>;
  total: number;
  page: number;
  pageSize: number;
  sessionId: string;
  sessions: { id: string; label: string; current: boolean }[];
  classes: { id: string; name: string; section: string; label: string }[];
  templates: { id: string; name: string }[];
  periods: string[];
  methods: { id: string; label: string }[];
};

const DEFAULT_EXTRA: Record<ExtraCol, boolean> = {
  dueDate: false,
  daysOverdue: false,
  lastPayment: false,
  paymentMode: false,
  template: false,
  lateFee: false,
};

const EXTRA_LABEL: Record<ExtraCol, string> = {
  dueDate: "Due date",
  daysOverdue: "Days overdue",
  lastPayment: "Last payment",
  paymentMode: "Payment mode",
  template: "Fee template",
  lateFee: "Late fee",
};

const CHECK_W = 40;
const ADM_W = 108;
const NAME_W = 168;

function money(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function compact(amount: number) {
  const n = Math.round(amount);
  if (Math.abs(n) >= 100000) {
    const lakhs = n / 100000;
    const digits = Math.abs(lakhs) >= 10 ? 1 : 2;
    const text = lakhs.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
    return `₹${text}L`;
  }
  return money(n);
}

function monthsLabel(count: number) {
  if (count <= 0) return "—";
  return count === 1 ? "1 month" : `${count} months`;
}

function statusTone(status: Status): "leaf" | "warn" | "danger" {
  if (status === "paid") return "leaf";
  if (status === "partial") return "warn";
  return "danger";
}

function statusLabel(status: Status) {
  if (status === "unpaid") return "Unpaid";
  if (status === "overdue") return "Overdue";
  if (status === "partial") return "Partial";
  return "Paid";
}

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

function periodLabel(period: string) {
  if (!/^\d{4}-\d{2}$/.test(period)) return period;
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  return new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "short", year: "numeric" });
}

function asOfLabel(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(+date)) return "";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function FeeRegister() {
  const { token, user } = useSession();
  const { data, reload } = useRecord();
  const router = useRouter();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const phone = width < 700;
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [classId, setClassId] = useState("");
  const [section, setSection] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState<Status | "">("");
  const [unpaidMonthsGte, setUnpaidMonthsGte] = useState(0);
  const [overdueDaysGte, setOverdueDaysGte] = useState(0);
  const [balanceGte, setBalanceGte] = useState("");
  const [methods, setMethods] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<"all" | "available" | "missing">("all");
  const [templateId, setTemplateId] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [paidFrom, setPaidFrom] = useState("");
  const [paidTo, setPaidTo] = useState("");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [extra, setExtra] = useState(DEFAULT_EXTRA);
  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payStudentId, setPayStudentId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    unpaidMonthsGte: 0,
    overdueDaysGte: 0,
    balanceGte: "",
    methods: [] as string[],
    receipt: "all" as "all" | "available" | "missing",
    templateId: "",
    dueFrom: "",
    dueTo: "",
    paidFrom: "",
    paidTo: "",
    admissionNo: "",
  });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debounced) params.set("q", debounced);
      if (sessionId) params.set("sessionId", sessionId);
      if (classId) params.set("classId", classId);
      if (section) params.set("section", section);
      if (period) params.set("period", period);
      if (status) params.set("status", status);
      if (unpaidMonthsGte) params.set("unpaidMonthsGte", String(unpaidMonthsGte));
      if (overdueDaysGte) params.set("overdueDaysGte", String(overdueDaysGte));
      if (Number(balanceGte) > 0) params.set("balanceGte", String(Number(balanceGte)));
      if (methods.length) params.set("methods", methods.join(","));
      if (receipt !== "all") params.set("receipt", receipt);
      if (templateId) params.set("templateId", templateId);
      if (dueFrom) params.set("dueFrom", dueFrom);
      if (dueTo) params.set("dueTo", dueTo);
      if (paidFrom) params.set("paidFrom", paidFrom);
      if (paidTo) params.set("paidTo", paidTo);
      params.set("page", String(page));
      params.set("pageSize", "50");
      const next = await api<Payload>(`/fee-register?${params.toString()}`, token);
      setPayload(next);
      if (!sessionId && next.sessionId) setSessionId(next.sessionId);
      setSelected([]);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not load fee register.");
    } finally {
      setLoading(false);
    }
    // toast.show is stable enough for this screen; omitting it avoids reload loops.
  }, [
    token,
    debounced,
    sessionId,
    classId,
    section,
    period,
    status,
    unpaidMonthsGte,
    overdueDaysGte,
    balanceGte,
    methods,
    receipt,
    templateId,
    dueFrom,
    dueTo,
    paidFrom,
    paidTo,
    page,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [debounced, sessionId, classId, section, period, status, unpaidMonthsGte, overdueDaysGte, balanceGte, methods, receipt, templateId, dueFrom, dueTo, paidFrom, paidTo]);

  const classes = payload?.classes ?? [];
  const sections = [...new Set(classes.filter((row) => !classId || row.id === classId).map((row) => row.section))];
  const people = data?.people ?? [];
  const collect = can(user, "fees.collect");
  const remind = can(user, "fees.remind");
  const sticky = Platform.OS === "web" ? ({ position: "sticky", zIndex: 2 } as const) : undefined;
  const stickyHead = Platform.OS === "web" ? ({ position: "sticky", top: 0, zIndex: 5 } as const) : undefined;

  const chips = useMemo(() => {
    const rows: { key: string; label: string; clear: () => void }[] = [];
    if (classId) {
      const label = classes.find((row) => row.id === classId)?.label || "Class";
      rows.push({ key: "class", label: `Class: ${label}`, clear: () => { setClassId(""); setSection(""); } });
    }
    if (section) rows.push({ key: "section", label: `Section: ${section}`, clear: () => setSection("") });
    if (period) rows.push({ key: "period", label: `Month: ${periodLabel(period)}`, clear: () => setPeriod("") });
    if (status) rows.push({ key: "status", label: `Status: ${statusLabel(status)}`, clear: () => setStatus("") });
    if (unpaidMonthsGte) rows.push({ key: "months", label: `Unpaid ≥ ${unpaidMonthsGte} months`, clear: () => setUnpaidMonthsGte(0) });
    if (overdueDaysGte) rows.push({ key: "overdue", label: `Overdue ≥ ${overdueDaysGte} days`, clear: () => setOverdueDaysGte(0) });
    if (Number(balanceGte) > 0) rows.push({ key: "balance", label: `Balance ≥ ₹${Number(balanceGte).toLocaleString("en-IN")}`, clear: () => setBalanceGte("") });
    if (receipt !== "all") rows.push({ key: "receipt", label: receipt === "available" ? "Receipt available" : "Receipt not issued", clear: () => setReceipt("all") });
    if (methods.length) rows.push({ key: "methods", label: `Mode: ${methods.join(", ")}`, clear: () => setMethods([]) });
    return rows;
  }, [classId, classes, section, period, status, unpaidMonthsGte, overdueDaysGte, balanceGte, receipt, methods]);

  function clearAll() {
    setQ("");
    setClassId("");
    setSection("");
    setPeriod("");
    setStatus("");
    setUnpaidMonthsGte(0);
    setOverdueDaysGte(0);
    setBalanceGte("");
    setMethods([]);
    setReceipt("all");
    setTemplateId("");
    setDueFrom("");
    setDueTo("");
    setPaidFrom("");
    setPaidTo("");
  }

  function applyFocus(id: string) {
    clearAll();
    if (id === "outstanding") setStatus("unpaid");
    if (id === "months") setUnpaidMonthsGte(3);
    if (id === "month") setPeriod(currentPeriod());
    if (id === "receipt") {
      setStatus("paid");
      setReceipt("missing");
    }
    if (id === "partial") setStatus("partial");
    setFocusOpen(false);
  }

  function payStudent(studentId: string) {
    const fromPeople = people.find((row) => row.id === studentId);
    const history = payload?.history[studentId] || [];
    if (fromPeople) {
      return {
        ...fromPeople,
        invoices: (fromPeople.invoices || []).map((inv) => ({
          ...inv,
          dueNow: inv.dueNow,
        })),
      };
    }
    const row = payload?.rows.find((item) => item.studentId === studentId);
    if (!row) return null;
    return {
      id: row.studentId,
      name: row.studentName,
      classId: row.classId,
      classLabel: row.classLabel,
      invoices: history.map((line) => ({
        id: line.invoiceId,
        title: line.label,
        amount: money(line.total),
        remaining: line.balance ? money(line.balance) : "",
        dueNow: line.balance,
        status: line.status,
      })),
    };
  }

  async function openFeeDocument(invoiceId: string, paid: boolean) {
    try {
      const result = await act<{ ok: true; token: string }>(token, "ensurePayToken", { invoiceId });
      const shareToken = encodeURIComponent(result.token);
      const url = paid ? `${apiBase()}/pay/${shareToken}?paid=1` : `${apiBase()}/i/${shareToken}`;
      await Linking.openURL(url);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : paid ? "Could not open the receipt." : "Could not open the invoice.");
    }
  }

  async function remindSelected() {
    const ids = (payload?.rows || []).filter((row) => selected.includes(row.id) && row.dueNow > 0).map((row) => row.id);
    if (!ids.length) {
      toast.show("Select unpaid rows to remind.");
      return;
    }
    try {
      const result = await act<{ ok: true; sent: number }>(token, "sendFeeReminders", { invoiceIds: ids });
      toast.show(`Reminded ${result.sent}.`);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not remind.");
    }
  }

  const extraWidth =
    (extra.dueDate ? 108 : 0) +
    (extra.daysOverdue ? 88 : 0) +
    (extra.lastPayment ? 108 : 0) +
    (extra.paymentMode ? 92 : 0) +
    (extra.template ? 128 : 0) +
    (extra.lateFee ? 88 : 0);
  const tableWidth = CHECK_W + ADM_W + NAME_W + 56 + 48 + 92 + 88 + 88 + 96 + 92 + 92 + 108 + 176 + extraWidth;

  function Head({ label, width: colW, align, left, stickyCol }: { label: string; width: number; align?: "left" | "right" | "center"; left?: number; stickyCol?: boolean }) {
    return (
      <View
        className="justify-end border-r border-ink-100 bg-[#F8FAFC] px-2 py-2"
        style={{
          width: colW,
          alignItems: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
          ...(stickyCol && sticky ? { ...sticky, ...stickyHead, left, zIndex: 6, backgroundColor: "#F8FAFC" } : stickyHead),
        }}
      >
        <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">{label}</Text>
      </View>
    );
  }

  function Cell({
    children,
    width: colW,
    align,
    left,
    stickyCol,
    bg,
    strong,
  }: {
    children: string | number;
    width: number;
    align?: "left" | "right" | "center";
    left?: number;
    stickyCol?: boolean;
    bg: string;
    strong?: boolean;
  }) {
    return (
      <View
        className="justify-center border-r border-ink-100 px-2"
        style={{
          width: colW,
          minHeight: 48,
          backgroundColor: bg,
          alignItems: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
          ...(stickyCol && sticky ? { ...sticky, left, zIndex: 3, backgroundColor: bg } : null),
        }}
      >
        <Text className={`text-[12px] ${strong ? "font-semibold" : ""} ${strong && Number(String(children).replace(/[^\d]/g, "")) ? "text-ink-950" : "text-ink-900"}`} numberOfLines={1}>
          {children}
        </Text>
      </View>
    );
  }

  const table = (
    <View style={{ minWidth: tableWidth }}>
      <View className="flex-row border-b border-ink-200 bg-[#F8FAFC]" style={stickyHead}>
        <View className="items-center justify-end border-r border-ink-100 bg-[#F8FAFC] py-2" style={{ width: CHECK_W, ...(sticky ? { ...sticky, ...stickyHead, left: 0, zIndex: 6 } : null) }}>
          <Pressable
            onPress={() => {
              const ids = payload?.rows.map((row) => row.id) || [];
              setSelected(selected.length === ids.length ? [] : ids);
            }}
          >
            <Ionicons name={payload?.rows.length && selected.length === payload.rows.length ? "checkbox" : "square-outline"} size={16} color="#3d4f66" />
          </Pressable>
        </View>
        <Head label="Admission No." width={ADM_W} left={CHECK_W} stickyCol />
        <Head label="Student" width={NAME_W} left={CHECK_W + ADM_W} stickyCol />
        <Head label="Class" width={56} />
        <Head label="Section" width={48} />
        <Head label="Month" width={92} />
        {extra.dueDate ? <Head label="Due date" width={108} align="right" /> : null}
        <Head label="Total" width={88} align="right" />
        <Head label="Paid" width={88} align="right" />
        <Head label="Balance" width={96} align="right" />
        <Head label="Status" width={92} align="center" />
        <Head label="Months due" width={92} align="center" />
        {extra.daysOverdue ? <Head label="Days overdue" width={88} align="right" /> : null}
        {extra.lastPayment ? <Head label="Last payment" width={108} align="right" /> : null}
        {extra.paymentMode ? <Head label="Mode" width={92} /> : null}
        {extra.template ? <Head label="Template" width={128} /> : null}
        {extra.lateFee ? <Head label="Late fee" width={88} align="right" /> : null}
        <Head label="Receipt" width={108} />
        <Head label="Action" width={176} />
      </View>
      {(payload?.rows || []).map((row, index) => {
        const bg = index % 2 ? "#FCFDFE" : "#fff";
        const open = expanded === row.id;
        const history = payload?.history[row.studentId] || [];
        return (
          <View key={row.id}>
            <View className="flex-row border-b border-ink-50" style={{ backgroundColor: bg }}>
              <View className="items-center justify-center border-r border-ink-100" style={{ width: CHECK_W, minHeight: 48, backgroundColor: bg, ...(sticky ? { ...sticky, left: 0, zIndex: 3 } : null) }}>
                <Pressable onPress={() => setSelected((cur) => (cur.includes(row.id) ? cur.filter((id) => id !== row.id) : [...cur, row.id]))}>
                  <Ionicons name={selected.includes(row.id) ? "checkbox" : "square-outline"} size={16} color="#3d4f66" />
                </Pressable>
              </View>
              <Cell width={ADM_W} left={CHECK_W} stickyCol bg={bg}>
                {row.admissionNo}
              </Cell>
              <View
                className="flex-row items-center gap-1 border-r border-ink-100 px-2"
                style={{ width: NAME_W, minHeight: 48, backgroundColor: bg, ...(sticky ? { ...sticky, left: CHECK_W + ADM_W, zIndex: 3 } : null) }}
              >
                <Pressable onPress={() => setExpanded(open ? null : row.id)} hitSlop={6}>
                  <Text className="text-[12px] text-ink-500">{open ? "▾" : "▸"}</Text>
                </Pressable>
                <Pressable className="min-w-0 flex-1" onPress={() => router.push({ pathname: "/people", params: { student: row.studentId } } as never)}>
                  <Text className="text-[12px] font-semibold text-ink-900" numberOfLines={1}>
                    {row.studentName}
                  </Text>
                </Pressable>
              </View>
              <Cell width={56} bg={bg}>{row.className}</Cell>
              <Cell width={48} bg={bg}>{row.section}</Cell>
              <Cell width={92} bg={bg}>{row.monthLabel}</Cell>
              {extra.dueDate ? <Cell width={108} align="right" bg={bg}>{row.dueDate}</Cell> : null}
              <Cell width={88} align="right" bg={bg}>{money(row.total)}</Cell>
              <Cell width={88} align="right" bg={bg}>{money(row.paid)}</Cell>
              <View className="justify-center border-r border-ink-100 px-2" style={{ width: 96, minHeight: 48, backgroundColor: bg, alignItems: "flex-end" }}>
                <Text className={`text-[12px] font-semibold ${row.balance > 0 ? "text-red-800" : "text-ink-900"}`}>{money(row.balance)}</Text>
              </View>
              <View className="items-center justify-center border-r border-ink-100 px-2" style={{ width: 92, minHeight: 48, backgroundColor: bg }}>
                <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
              </View>
              <View className="items-center justify-center border-r border-ink-100 px-2" style={{ width: 92, minHeight: 48, backgroundColor: bg }}>
                {row.monthsDue > 0 ? (
                  <View className={`rounded-md px-1.5 py-0.5 ${row.monthsDue >= 3 ? "bg-red-50" : "bg-amber-50"}`}>
                    <Text className={`text-[11px] font-semibold ${row.monthsDue >= 3 ? "text-red-800" : "text-amber-800"}`}>{monthsLabel(row.monthsDue)}</Text>
                  </View>
                ) : (
                  <Text className="text-[12px] text-ink-500">—</Text>
                )}
              </View>
              {extra.daysOverdue ? <Cell width={88} align="right" bg={bg}>{row.daysOverdue || "—"}</Cell> : null}
              {extra.lastPayment ? <Cell width={108} align="right" bg={bg}>{row.lastPaymentLabel || "—"}</Cell> : null}
              {extra.paymentMode ? <Cell width={92} bg={bg}>{row.paymentModeLabel || "—"}</Cell> : null}
              {extra.template ? <Cell width={128} bg={bg}>{row.templateName || "—"}</Cell> : null}
              {extra.lateFee ? <Cell width={88} align="right" bg={bg}>{row.lateFee ? money(row.lateFee) : "—"}</Cell> : null}
              <View className="justify-center border-r border-ink-100 px-2" style={{ width: 108, minHeight: 48, backgroundColor: bg }}>
                <Text className={`text-[12px] ${row.receipt ? "text-emerald-700" : row.paid > 0 ? "text-amber-800" : "text-ink-500"}`}>
                  {row.receipt ? "Available" : row.paid > 0 ? "Not issued" : "—"}
                </Text>
              </View>
              <View className="flex-row flex-wrap items-center gap-2 px-2" style={{ width: 176, minHeight: 48, backgroundColor: bg }}>
                <Pressable onPress={() => router.push({ pathname: "/people", params: { student: row.studentId } } as never)}>
                  <Text className="text-[12px] font-medium text-clay-600">View</Text>
                </Pressable>
                {collect && row.dueNow > 0 ? (
                  <Pressable onPress={() => setPayStudentId(row.studentId)}>
                    <Text className="text-[12px] font-medium text-clay-600">Collect</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => void openFeeDocument(row.id, false)}>
                  <Text className="text-[12px] font-medium text-clay-600">Invoice</Text>
                </Pressable>
                {row.paid > 0 ? (
                  <Pressable onPress={() => void openFeeDocument(row.id, true)}>
                    <Text className="text-[12px] font-medium text-clay-600">Receipt</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            {open ? (
              <View className="border-b border-ink-100 bg-ink-50 px-4 py-3">
                <Text className="mb-2 text-xs font-semibold text-ink-800">
                  {row.studentName} · {row.classLabel}
                </Text>
                {history.map((line) => (
                  <View key={line.invoiceId} className="mb-2 border-b border-ink-100 pb-2 last:mb-0 last:border-0 last:pb-0">
                    <Text className="text-[12px] font-medium text-ink-900">{line.label}</Text>
                    <Text className="mt-0.5 text-[12px] text-ink-700">
                      Invoice {money(line.total)} · Paid {money(line.paid)} · Balance {money(line.balance)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
      {!payload?.rows.length ? (
        <View className="items-center py-10">
          <Text className="text-sm text-ink-500">{loading ? "Loading register…" : "No invoices match these filters."}</Text>
        </View>
      ) : null}
    </View>
  );

  const scroller =
    Platform.OS === "web"
      ? createElement("div", {
          className: "min-h-0 flex-1 overflow-auto rounded-xl border border-ink-200 bg-white",
          style: { WebkitOverflowScrolling: "touch", flex: 1, minHeight: 0 },
        }, table)
      : (
          <ScrollView horizontal className="min-h-0 flex-1 rounded-xl border border-ink-200 bg-white">
            <ScrollView nestedScrollEnabled>{table}</ScrollView>
          </ScrollView>
        );

  const pay = payStudentId ? payStudent(payStudentId) : null;
  const pages = Math.max(1, Math.ceil((payload?.total || 0) / (payload?.pageSize || 50)));

  return (
    <View className="min-h-0 flex-1 gap-3">
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <PageHeader
        title="Fee Register"
        lede="Track invoices, payments, outstanding balances and receipts."
        action={
          collect ? (
            <Button onPress={() => setPayStudentId(selected[0] ? payload?.rows.find((row) => row.id === selected[0])?.studentId || people[0]?.id || null : people[0]?.id || payload?.rows[0]?.studentId || null)}>
              Collect payment
            </Button>
          ) : undefined
        }
      />

      <View className="flex-row flex-wrap items-end gap-2">
        <View className="min-w-[180px] flex-1">
          <Input value={q} onChangeText={setQ} placeholder="Search student..." />
        </View>
        <Select
          className="w-[150px]"
          value={sessionId}
          onChange={setSessionId}
          options={(payload?.sessions || []).map((row) => ({ id: row.id, label: row.label }))}
          placeholder="Academic year"
        />
        <Select
          className="w-[130px]"
          value={classId || "all"}
          onChange={(id) => { setClassId(id === "all" ? "" : id); setSection(""); }}
          options={[{ id: "all", label: "All classes" }, ...classes.map((row) => ({ id: row.id, label: row.label }))]}
        />
        <Select
          className="w-[120px]"
          value={section || "all"}
          onChange={(id) => setSection(id === "all" ? "" : id)}
          options={[{ id: "all", label: "All sections" }, ...sections.map((id) => ({ id, label: id }))]}
        />
        <Select
          className="w-[130px]"
          value={period || "all"}
          onChange={(id) => setPeriod(id === "all" ? "" : id)}
          options={[{ id: "all", label: "All months" }, ...(payload?.periods || []).map((id) => ({ id, label: periodLabel(id) }))]}
        />
        <Select
          className="w-[140px]"
          value={status || "all"}
          onChange={(id) => setStatus(id === "all" ? "" : (id as Status))}
          options={[
            { id: "all", label: "All statuses" },
            { id: "paid", label: "Paid" },
            { id: "partial", label: "Partial" },
            { id: "unpaid", label: "Unpaid" },
            { id: "overdue", label: "Overdue" },
          ]}
        />
        <Chip label="More filters" active={moreOpen} onPress={() => {
          setDraft({ unpaidMonthsGte, overdueDaysGte, balanceGte, methods, receipt, templateId, dueFrom, dueTo, paidFrom, paidTo, admissionNo: "" });
          setMoreOpen(true);
        }} />
        <Chip label="Columns" active={columnsOpen} onPress={() => setColumnsOpen(true)} />
        <Chip label="Collection Focus" active={focusOpen} onPress={() => setFocusOpen(true)} />
      </View>

      {chips.length ? (
        <View className="flex-row flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <Pressable key={chip.key} onPress={chip.clear} className="flex-row items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1">
              <Text className="text-xs text-ink-800">{chip.label}</Text>
              <Text className="text-xs text-ink-500">×</Text>
            </Pressable>
          ))}
          <Pressable onPress={clearAll}><Text className="text-xs font-medium text-clay-600">Clear all</Text></Pressable>
        </View>
      ) : null}

      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1 border-y border-ink-100 py-2">
        <Text className="text-xs text-ink-700"><Text className="font-semibold text-ink-900">{payload?.summary.students ?? 0}</Text> Students</Text>
        <Text className="text-xs text-ink-700"><Text className="font-semibold text-ink-900">{compact(payload?.summary.billed || 0)}</Text> Billed</Text>
        <Text className="text-xs text-ink-700"><Text className="font-semibold text-ink-900">{compact(payload?.summary.paid || 0)}</Text> Paid</Text>
        <Text className="text-xs text-ink-700"><Text className="font-semibold text-ink-900">{compact(payload?.summary.outstanding || 0)}</Text> Outstanding</Text>
        {payload?.asOf ? <Text className="text-xs text-ink-500">As of {asOfLabel(payload.asOf)}</Text> : null}
      </View>

      {selected.length ? (
        <View className="flex-row flex-wrap items-center gap-2 rounded-md border border-ink-200 bg-white px-3 py-2">
          <Text className="text-sm text-ink-800">{selected.length} selected</Text>
          {remind ? <Button variant="ghost" onPress={() => void remindSelected()}>Send reminder</Button> : null}
          {collect ? (
            <Button
              variant="ghost"
              onPress={() => setPayStudentId(payload?.rows.find((row) => row.id === selected[0])?.studentId || null)}
            >
              Collect payment
            </Button>
          ) : null}
        </View>
      ) : null}

      {phone ? (
        <ScrollView className="min-h-0 flex-1">
          <View className="gap-3 pb-6">
            {(payload?.rows || []).map((row) => (
              <Card key={row.id} className="p-4">
                <View className="flex-row items-start justify-between gap-2">
                  <View className="min-w-0 flex-1">
                    <Text className="font-semibold text-ink-900">{row.studentName}</Text>
                    <Text className="mt-0.5 text-xs text-ink-700">{row.admissionNo} · {row.classLabel} · {row.monthLabel}</Text>
                  </View>
                  <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                </View>
                <View className="mt-3 gap-1">
                  <Text className="text-sm text-ink-700">Total {money(row.total)}</Text>
                  <Text className="text-sm text-ink-700">Paid {money(row.paid)}</Text>
                  <Text className={`text-sm font-semibold ${row.balance ? "text-red-800" : "text-ink-900"}`}>Balance {money(row.balance)}</Text>
                  {row.monthsDue ? <Text className="text-xs text-ink-700">{monthsLabel(row.monthsDue)} due</Text> : null}
                </View>
                <View className="mt-3 flex-row flex-wrap gap-2">
                  <Button variant="ghost" onPress={() => router.push({ pathname: "/people", params: { student: row.studentId } } as never)}>View</Button>
                  {collect && row.dueNow > 0 ? <Button onPress={() => setPayStudentId(row.studentId)}>Collect</Button> : null}
                  <Button variant="ghost" onPress={() => void openFeeDocument(row.id, false)}>Invoice</Button>
                  {row.paid > 0 ? <Button variant="ghost" onPress={() => void openFeeDocument(row.id, true)}>Receipt</Button> : null}
                </View>
              </Card>
            ))}
            {!payload?.rows.length ? <Empty title="Nothing to show" body="No invoices match these filters." /> : null}
          </View>
        </ScrollView>
      ) : (
        <View className="min-h-0 flex-1">{scroller}</View>
      )}

      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-ink-600">
          Showing {payload?.rows.length ? (page - 1) * 50 + 1 : 0}–{(page - 1) * 50 + (payload?.rows.length || 0)} of {payload?.total || 0}
        </Text>
        <View className="flex-row gap-2">
          <Chip label="Prev" active={false} onPress={() => setPage(Math.max(1, page - 1))} />
          <Text className="self-center text-xs text-ink-700">{page} / {pages}</Text>
          <Chip label="Next" active={false} onPress={() => setPage(Math.min(pages, page + 1))} />
        </View>
      </View>

      <GeneratePayment
        open={Boolean(pay)}
        student={pay}
        title={pay ? `Payment · ${pay.name}` : undefined}
        onClose={() => setPayStudentId(null)}
        onDone={async (message) => {
          setPayStudentId(null);
          toast.show(message);
          await reload();
          await load();
        }}
      />

      <Modal open={moreOpen} title="More filters" onClose={() => setMoreOpen(false)}>
        <ScrollView className="max-h-[70vh]">
          <View className="gap-3 pb-2">
            <Field label="Unpaid for ≥ months">
              <View className="flex-row flex-wrap gap-2">
                {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                  <Chip key={n} label={n === 0 ? "Any" : `${n}+`} active={draft.unpaidMonthsGte === n} onPress={() => setDraft({ ...draft, unpaidMonthsGte: n })} />
                ))}
              </View>
            </Field>
            <Field label="Overdue by ≥ days">
              <View className="flex-row flex-wrap gap-2">
                {[0, 7, 30, 60].map((n) => (
                  <Chip key={n} label={n === 0 ? "Any" : `${n}+`} active={draft.overdueDaysGte === n} onPress={() => setDraft({ ...draft, overdueDaysGte: n })} />
                ))}
              </View>
            </Field>
            <Field label="Balance ≥ ₹">
              <Input keyboardType="number-pad" value={draft.balanceGte} onChangeText={(v) => setDraft({ ...draft, balanceGte: v })} placeholder="Amount" />
            </Field>
            <Field label="Payment mode">
              <View className="flex-row flex-wrap gap-2">
                {(payload?.methods || []).map((row) => (
                  <Chip
                    key={row.id}
                    label={row.label}
                    active={draft.methods.includes(row.id)}
                    onPress={() =>
                      setDraft({
                        ...draft,
                        methods: draft.methods.includes(row.id) ? draft.methods.filter((id) => id !== row.id) : [...draft.methods, row.id],
                      })
                    }
                  />
                ))}
              </View>
            </Field>
            <Field label="Receipt">
              <View className="flex-row flex-wrap gap-2">
                {([["all", "All"], ["available", "Receipt available"], ["missing", "Receipt not issued"]] as const).map(([id, label]) => (
                  <Chip key={id} label={label} active={draft.receipt === id} onPress={() => setDraft({ ...draft, receipt: id })} />
                ))}
              </View>
            </Field>
            <Field label="Fee template">
              <Select
                value={draft.templateId || "all"}
                onChange={(id) => setDraft({ ...draft, templateId: id === "all" ? "" : id })}
                options={[{ id: "all", label: "All templates" }, ...(payload?.templates || []).map((row) => ({ id: row.id, label: row.name }))]}
              />
            </Field>
            <Field label="Due from (YYYY-MM-DD)">
              <Input value={draft.dueFrom} onChangeText={(v) => setDraft({ ...draft, dueFrom: v })} />
            </Field>
            <Field label="Due to">
              <Input value={draft.dueTo} onChangeText={(v) => setDraft({ ...draft, dueTo: v })} />
            </Field>
            <Field label="Paid from">
              <Input value={draft.paidFrom} onChangeText={(v) => setDraft({ ...draft, paidFrom: v })} />
            </Field>
            <Field label="Paid to">
              <Input value={draft.paidTo} onChangeText={(v) => setDraft({ ...draft, paidTo: v })} />
            </Field>
            <View className="flex-row justify-end gap-2">
              <Button variant="ghost" onPress={() => setMoreOpen(false)}>Cancel</Button>
              <Button
                onPress={() => {
                  setUnpaidMonthsGte(draft.unpaidMonthsGte);
                  setOverdueDaysGte(draft.overdueDaysGte);
                  setBalanceGte(draft.balanceGte);
                  setMethods(draft.methods);
                  setReceipt(draft.receipt);
                  setTemplateId(draft.templateId);
                  setDueFrom(draft.dueFrom);
                  setDueTo(draft.dueTo);
                  setPaidFrom(draft.paidFrom);
                  setPaidTo(draft.paidTo);
                  setMoreOpen(false);
                }}
              >
                Apply filters
              </Button>
            </View>
          </View>
        </ScrollView>
      </Modal>

      <Modal open={columnsOpen} title="Columns" onClose={() => setColumnsOpen(false)}>
        <View className="gap-2">
          {(Object.keys(EXTRA_LABEL) as ExtraCol[]).map((key) => (
            <Chip key={key} label={EXTRA_LABEL[key]} active={extra[key]} onPress={() => setExtra({ ...extra, [key]: !extra[key] })} />
          ))}
        </View>
      </Modal>

      <Modal open={focusOpen} title="Collection Focus" onClose={() => setFocusOpen(false)}>
        <View className="gap-2">
          <Button variant="ghost" onPress={() => applyFocus("outstanding")}>Highest outstanding</Button>
          <Button variant="ghost" onPress={() => applyFocus("months")}>Unpaid 3+ months</Button>
          <Button variant="ghost" onPress={() => applyFocus("month")}>Due this month</Button>
          <Button variant="ghost" onPress={() => applyFocus("receipt")}>Paid but receipt missing</Button>
          <Button variant="ghost" onPress={() => applyFocus("partial")}>Partial payments</Button>
        </View>
      </Modal>
    </View>
  );
}
