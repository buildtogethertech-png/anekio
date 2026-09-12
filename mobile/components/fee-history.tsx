import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { DateField, Select } from "./form";
import { Badge, Button, Chip, Empty, Input, Modal, Sheet } from "./ui";

type StatusFilter = "paid" | "partial";
type DatePreset = "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "custom";

type HistoryEvent = {
  id: string;
  dateYmd: string;
  dateLabel: string;
  timeLabel: string;
  studentName: string;
  admissionNo: string;
  classLabel: string;
  monthLabel: string;
  amount: number;
  paymentModeLabel: string;
  invoiceNumber: string;
  receiptNumber: string;
  badge: "paid" | "partial" | "due" | "overdue" | "generated" | "issued";
  badgeLabel: string;
  remark: string;
  collectedBy: string;
  billed: number;
  paid: number;
  balance: number;
};

type Payload = {
  asOf: string;
  datePreset: DatePreset;
  from: string;
  to: string;
  summary: { collected: number; billed: number; outstanding: number; payments: number; receipts: number };
  events: HistoryEvent[];
  total: number;
  page: number;
  pageSize: number;
  sessionId: string;
  sessions: { id: string; label: string; current?: boolean }[];
  classes: { id: string; name: string; section: string; label: string }[];
  methods: { id: string; label: string }[];
};

function money(amount: number) {
  return `₹${Math.round(Number(amount) || 0).toLocaleString("en-IN")}`;
}

function compact(amount: number) {
  const n = Math.round(Number(amount) || 0);
  if (Math.abs(n) >= 100000) {
    const lakhs = n / 100000;
    const digits = Math.abs(lakhs) >= 10 ? 1 : 2;
    const text = lakhs.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
    return `₹${text}L`;
  }
  return money(n);
}

function badgeTone(badge: HistoryEvent["badge"]): "leaf" | "warn" | "ink" {
  if (badge === "paid") return "leaf";
  if (badge === "partial") return "warn";
  return "ink";
}

function groupLabel(ymd: string, asOfIso: string) {
  const asOf = new Date(asOfIso);
  const today = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, "0")}-${String(asOf.getDate()).padStart(2, "0")}`;
  const y = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() - 1);
  const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  if (ymd === today) return "TODAY";
  if (ymd === yesterday) return "YESTERDAY";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const date = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "long" }).toUpperCase();
}

function dateChip(preset: DatePreset, from: string, to: string) {
  if (preset === "today") return "Today";
  if (preset === "yesterday") return "Yesterday";
  if (preset === "this_week") return "This week";
  if (preset === "custom" && from && to) return from === to ? from : `${from} – ${to}`;
  const stamp = from || to;
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp) && (preset === "this_month" || preset === "last_month")) {
    return new Date(Number(stamp.slice(0, 4)), Number(stamp.slice(5, 7)) - 1, 1).toLocaleDateString("en-IN", { month: "long" });
  }
  return preset === "last_month" ? "Last month" : "This month";
}

function pageWindow(page: number, pages: number) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set([1, pages, page, page - 1, page + 1]);
  return [...set].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
}

function Head({ width, label, right }: { width: number | string; label: string; right?: boolean }) {
  return (
    <Text
      className={`px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-500 ${right ? "text-right" : ""}`}
      style={{ width }}
    >
      {label}
    </Text>
  );
}

function Cell({ width, children, right }: { width: number | string; children: string; right?: boolean }) {
  return (
    <View className={`justify-center px-2 ${right ? "items-end" : ""}`} style={{ width }}>
      <Text className={`text-[12px] text-ink-800 ${right ? "font-semibold text-ink-900" : ""}`} numberOfLines={2}>
        {children || "—"}
      </Text>
    </View>
  );
}

export function FeeHistory() {
  const { token } = useSession();
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [className, setClassName] = useState("");
  const [section, setSection] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<StatusFilter | "">("");
  const [method, setMethod] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 280);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debounced, sessionId, className, section, datePreset, from, to, status, method, pageSize]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams();
      if (debounced) params.set("q", debounced);
      if (sessionId) params.set("sessionId", sessionId);
      if (className) params.set("className", className);
      if (section) params.set("section", section);
      params.set("datePreset", datePreset);
      if (datePreset === "custom") {
        if (from) params.set("from", from);
        if (to) params.set("to", to);
      }
      if (status) params.set("status", status);
      if (method) params.set("method", method);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const next = await api<Payload>(`/fee-history?${params.toString()}`, token);
      setPayload(next);
      if (!sessionId && next.sessionId) setSessionId(next.sessionId);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token, debounced, sessionId, className, section, datePreset, from, to, status, method, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const classes = payload?.classes || [];
  const classNames = useMemo(() => [...new Set(classes.map((row) => row.name))], [classes]);
  const sections = useMemo(
    () => [...new Set(classes.filter((row) => !className || row.name === className).map((row) => row.section).filter(Boolean))],
    [classes, className]
  );
  const pages = Math.max(1, Math.ceil((payload?.total || 0) / (payload?.pageSize || pageSize)));
  const start = payload ? (payload.page - 1) * payload.pageSize + (payload.total ? 1 : 0) : 0;
  const end = payload ? Math.min(payload.page * payload.pageSize, payload.total) : 0;

  function clearAll() {
    setQ("");
    setDebounced("");
    setClassName("");
    setSection("");
    setDatePreset("this_month");
    setFrom("");
    setTo("");
    setStatus("");
    setMethod("");
    setPage(1);
    const current = payload?.sessions.find((row) => row.current);
    if (current) setSessionId(current.id);
  }

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (className) chips.push({ key: "class", label: `Class: ${className}`, clear: () => { setClassName(""); setSection(""); } });
  if (section) chips.push({ key: "section", label: `Section: ${section}`, clear: () => setSection("") });
  if (payload?.from) chips.push({ key: "date", label: dateChip(datePreset, payload.from, payload.to), clear: () => { setDatePreset("this_month"); setFrom(""); setTo(""); } });
  if (status) chips.push({ key: "status", label: status[0].toUpperCase() + status.slice(1), clear: () => setStatus("") });
  if (method) chips.push({ key: "method", label: payload?.methods.find((row) => row.id === method)?.label || method, clear: () => setMethod("") });
  if (debounced) chips.push({ key: "q", label: `“${debounced}”`, clear: () => { setQ(""); setDebounced(""); } });

  const filters = (
    <View className="gap-2">
      <Input value={q} onChangeText={setQ} placeholder="Search student, admission no., invoice or receipt..." />
      {phone ? (
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
          <View className="flex-row items-center gap-1.5">
            <Select className="w-[110px]" value={className || "all"} onChange={(id) => { setClassName(id === "all" ? "" : id); setSection(""); }} options={[{ id: "all", label: "Class" }, ...classNames.map((name) => ({ id: name, label: `Class ${name}` }))]} />
            <Select className="w-[120px]" value={datePreset} onChange={(id) => setDatePreset(id as DatePreset)} options={[
              { id: "today", label: "Today" },
              { id: "yesterday", label: "Yesterday" },
              { id: "this_week", label: "This week" },
              { id: "this_month", label: "This month" },
              { id: "last_month", label: "Last month" },
              { id: "custom", label: "Custom" },
            ]} />
            <Select className="w-[120px]" value={status || "all"} onChange={(id) => setStatus(id === "all" ? "" : (id as StatusFilter))} options={[
              { id: "all", label: "Status" },
              { id: "paid", label: "Paid" },
              { id: "partial", label: "Partial" },
            ]} />
            <Chip label="More" active={moreOpen} onPress={() => setMoreOpen(true)} />
          </View>
        </ScrollView>
      ) : (
        <View className="flex-row flex-wrap items-end gap-2">
          <Select className="w-[150px]" value={sessionId} onChange={setSessionId} options={(payload?.sessions || []).map((row) => ({ id: row.id, label: row.label }))} placeholder="Academic Year" />
          <Select className="w-[130px]" value={className || "all"} onChange={(id) => { setClassName(id === "all" ? "" : id); setSection(""); }} options={[{ id: "all", label: "All classes" }, ...classNames.map((name) => ({ id: name, label: `Class ${name}` }))]} />
          <Select className="w-[120px]" value={section || "all"} onChange={(id) => setSection(id === "all" ? "" : id)} options={className ? [{ id: "all", label: "All sections" }, ...sections.map((id) => ({ id, label: id }))] : [{ id: "all", label: "Section" }]} />
          <Select className="w-[140px]" value={datePreset} onChange={(id) => setDatePreset(id as DatePreset)} options={[
            { id: "today", label: "Today" },
            { id: "yesterday", label: "Yesterday" },
            { id: "this_week", label: "This week" },
            { id: "this_month", label: "This month" },
            { id: "last_month", label: "Last month" },
            { id: "custom", label: "Custom range" },
          ]} />
          <Select className="w-[130px]" value={status || "all"} onChange={(id) => setStatus(id === "all" ? "" : (id as StatusFilter))} options={[
            { id: "all", label: "All statuses" },
            { id: "paid", label: "Paid" },
            { id: "partial", label: "Partial" },
          ]} />
          <Chip label="More filters" active={moreOpen || Boolean(method)} onPress={() => setMoreOpen(true)} />
        </View>
      )}
      {datePreset === "custom" ? (
        <View className="flex-row flex-wrap gap-3">
          <View className="w-[180px]"><DateField compact value={from} onChange={setFrom} placeholder="From" /></View>
          <View className="w-[180px]"><DateField compact value={to} onChange={setTo} placeholder="To" /></View>
        </View>
      ) : null}
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
    </View>
  );

  const summary = (
    <View className="flex-row flex-wrap items-center gap-x-5 gap-y-1 border-y border-ink-100 py-2">
      <Text className="text-xs text-ink-700"><Text className="text-sm font-semibold text-ink-900">{compact(payload?.summary.collected || 0)}</Text>  Collected</Text>
      <Text className="text-xs text-ink-700"><Text className="text-sm font-semibold text-ink-900">{compact(payload?.summary.billed || 0)}</Text>  Billed</Text>
      <Text className="text-xs text-ink-700"><Text className="text-sm font-semibold text-ink-900">{compact(payload?.summary.outstanding || 0)}</Text>  Outstanding</Text>
      <Text className="text-xs text-ink-700"><Text className="text-sm font-semibold text-ink-900">{payload?.summary.payments ?? 0}</Text>  Payments</Text>
      <Text className="text-xs text-ink-700"><Text className="text-sm font-semibold text-ink-900">{payload?.summary.receipts ?? 0}</Text>  Receipts</Text>
    </View>
  );

  const rows = payload?.events || [];

  const table = (
    <View>
      <View className="flex-row border-b border-ink-200 bg-[#F8FAFC]" style={{ minHeight: 40 }}>
        <Head width={132} label="Paid at" />
        <Text className="min-w-[150px] flex-1 px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-500">Student</Text>
        <Head width={72} label="Class" />
        <Head width={88} label="Fee month" />
        <Head width={88} label="Paid" right />
        <Head width={72} label="Mode" />
        <Head width={108} label="Invoice" />
        <Head width={108} label="Receipt" />
        <Head width={80} label="Status" />
        <Head width={88} label="Invoice amt" right />
        <Head width={80} label="Balance" right />
        <Head width={110} label="Collected by" />
        <Head width={120} label="Remark" />
      </View>
      {loading && !rows.length
        ? [0, 1, 2, 3, 4, 5, 6].map((i) => <View key={i} className="anekio-skeleton mx-2 my-1 h-12 rounded-md" />)
        : null}
      {rows.map((event, index) => {
        const prev = rows[index - 1];
        const showGroup = event.dateYmd && event.dateYmd !== prev?.dateYmd;
        return (
          <View key={event.id}>
            {showGroup ? (
              <Text className="bg-ink-50 px-3 py-1 text-[10px] font-semibold tracking-wide text-ink-500">
                {groupLabel(event.dateYmd, payload?.asOf || new Date().toISOString())}
              </Text>
            ) : null}
            <View className="flex-row items-stretch border-b border-ink-50" style={{ minHeight: 52 }}>
              <View className="w-[132px] justify-center px-2">
                <Text className="text-[12px] font-medium text-ink-900">{event.dateLabel}</Text>
                {event.timeLabel ? <Text className="text-[11px] text-ink-500">{event.timeLabel}</Text> : null}
              </View>
              <View className="min-w-[150px] flex-1 justify-center px-2">
                <Text className="text-[12px] font-semibold text-ink-900" numberOfLines={1}>{event.studentName}</Text>
                <Text className="text-[11px] text-ink-500" numberOfLines={1}>{event.admissionNo || "—"}</Text>
              </View>
              <Cell width={72} children={event.classLabel} />
              <Cell width={88} children={event.monthLabel} />
              <Cell width={88} children={money(event.amount)} right />
              <Cell width={72} children={event.paymentModeLabel} />
              <Cell width={108} children={event.invoiceNumber} />
              <Cell width={108} children={event.receiptNumber} />
              <View className="w-[80px] justify-center px-2">
                <Badge tone={badgeTone(event.badge)}>{event.badgeLabel}</Badge>
              </View>
              <Cell width={88} children={money(event.billed)} right />
              <Cell width={80} children={money(event.balance)} right />
              <Cell width={110} children={event.collectedBy} />
              <Cell width={120} children={event.remark} />
            </View>
          </View>
        );
      })}
    </View>
  );

  const mobileList = (
    <View className="gap-2">
      {loading && !rows.length
        ? [0, 1, 2, 3, 4, 5].map((i) => <View key={i} className="anekio-skeleton h-[88px] rounded-md" />)
        : null}
      {rows.map((event) => (
        <View key={event.id} className="rounded-md border border-ink-100 bg-white px-3 py-2.5">
          <View className="flex-row items-start justify-between gap-2">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold text-ink-900">{event.studentName}</Text>
              <Text className="text-[12px] text-ink-500">{event.classLabel} · {event.admissionNo || "—"}</Text>
            </View>
            <Badge tone={badgeTone(event.badge)}>{event.badgeLabel}</Badge>
          </View>
          <Text className="mt-1 text-[12px] text-ink-500">{event.dateLabel}{event.timeLabel ? ` · ${event.timeLabel}` : ""} · {event.monthLabel}</Text>
          <Text className="mt-1 text-[13px] font-semibold text-ink-900">{money(event.amount)}{event.paymentModeLabel && event.paymentModeLabel !== "—" ? ` · ${event.paymentModeLabel}` : ""}</Text>
          <Text className="mt-1 text-[12px] text-ink-700">Invoice {event.invoiceNumber || "—"} · Receipt {event.receiptNumber || "—"}</Text>
          <Text className="text-[12px] text-ink-500">Invoice amt {money(event.billed)} · Balance {money(event.balance)}</Text>
          {event.collectedBy ? <Text className="text-[12px] text-ink-500">Collected by {event.collectedBy}</Text> : null}
          {event.remark ? <Text className="text-[12px] text-ink-500">{event.remark}</Text> : null}
        </View>
      ))}
    </View>
  );

  const pager = payload && !loading ? (
    <View className="flex-row flex-wrap items-center justify-between gap-2 pt-2">
      <Text className="text-xs text-ink-600">
        {payload.total ? `Showing ${start}–${end} of ${payload.total} payments` : "Showing 0 payments"}
      </Text>
      <View className="flex-row flex-wrap items-center gap-2">
        <Select
          className="w-[110px]"
          value={String(pageSize)}
          onChange={(id) => setPageSize(Number(id))}
          options={[
            { id: "10", label: "10 / page" },
            { id: "25", label: "25 / page" },
            { id: "50", label: "50 / page" },
          ]}
        />
        <Pressable disabled={page <= 1} onPress={() => setPage((p) => Math.max(1, p - 1))} className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white">
          <Text className="text-ink-700">←</Text>
        </Pressable>
        {pageWindow(page, pages).map((n, i, arr) => (
          <View key={n} className="flex-row items-center">
            {i > 0 && n - arr[i - 1] > 1 ? <Text className="px-1 text-xs text-ink-400">…</Text> : null}
            <Pressable onPress={() => setPage(n)} className={`h-8 min-w-8 items-center justify-center rounded-md px-2 ${n === page ? "bg-clay-500" : "bg-white"}`}>
              <Text className={`text-xs font-medium ${n === page ? "text-white" : "text-ink-800"}`}>{n}</Text>
            </Pressable>
          </View>
        ))}
        <Pressable disabled={page >= pages} onPress={() => setPage((p) => Math.min(pages, p + 1))} className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white">
          <Text className="text-ink-700">→</Text>
        </Pressable>
      </View>
    </View>
  ) : null;

  const empty = !loading && !error && payload && !payload.events.length;
  const scroller = phone
    ? (
        <ScrollView className="min-h-0 flex-1" nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {mobileList}
        </ScrollView>
      )
    : Platform.OS === "web"
      ? createElement("div", {
          className: "min-h-0 flex-1 overflow-auto rounded-md border border-ink-200 bg-white",
          style: { WebkitOverflowScrolling: "touch", flex: 1, minHeight: 0 },
        }, table)
      : (
          <ScrollView horizontal className="min-h-0 flex-1 rounded-md border border-ink-200 bg-white">
            <ScrollView nestedScrollEnabled className="min-h-0 flex-1">{table}</ScrollView>
          </ScrollView>
        );

  const moreBody = (
    <View className="gap-3">
      <Select
        label="Payment mode"
        value={method || "all"}
        onChange={(id) => setMethod(id === "all" ? "" : id)}
        options={[{ id: "all", label: "All modes" }, ...(payload?.methods || []).map((row) => ({ id: row.id, label: row.label }))]}
      />
      {phone ? (
        <>
          <Select label="Section" value={section || "all"} onChange={(id) => setSection(id === "all" ? "" : id)} options={className ? [{ id: "all", label: "All sections" }, ...sections.map((id) => ({ id, label: id }))] : [{ id: "all", label: "Pick a class first" }]} />
          <Select label="Status" value={status || "all"} onChange={(id) => setStatus(id === "all" ? "" : (id as StatusFilter))} options={[
            { id: "all", label: "All statuses" },
            { id: "paid", label: "Paid" },
            { id: "partial", label: "Partial" },
          ]} />
          <Select label="Academic year" value={sessionId} onChange={setSessionId} options={(payload?.sessions || []).map((row) => ({ id: row.id, label: row.label }))} />
        </>
      ) : null}
      <Button onPress={() => setMoreOpen(false)}>Done</Button>
    </View>
  );

  return (
    <View className="relative min-h-0 flex-1 gap-3">
      <View className="shrink-0">{filters}</View>
      <View className="shrink-0">{summary}</View>
      {error ? (
        <View className="items-center rounded-md border border-ink-100 bg-white px-4 py-10">
          <Text className="text-base font-semibold text-ink-900">Fee history couldn't be loaded.</Text>
          <Text className="mt-1 text-sm text-ink-600">Please try again.</Text>
          <Button className="mt-3" onPress={() => void load()}>Retry</Button>
        </View>
      ) : empty ? (
        <View className="items-center rounded-md border border-ink-100 bg-white px-4 py-10">
          <Empty title="No payments found" body="Try changing your filters or search." />
          <Button className="mt-3" variant="ghost" onPress={clearAll}>Clear filters</Button>
        </View>
      ) : (
        scroller
      )}
      {empty || error ? null : <View className="shrink-0">{pager}</View>}

      {phone ? (
        <Sheet open={moreOpen} onClose={() => setMoreOpen(false)}>{moreBody}</Sheet>
      ) : (
        <Modal open={moreOpen} title="More filters" onClose={() => setMoreOpen(false)}>{moreBody}</Modal>
      )}
    </View>
  );
}
