import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { DailySpendChart, HeadSplit, MonthBars } from "./expenses-charts";
import { DateField } from "./date-field";
import { Badge, Button, Card, Chip, Empty, Modal, PageHeader, Segmented, Sheet, Toast, useToast } from "./ui";
import { PayMethodTiles, ProofAttach, payMethodLabel, openSalaryProof } from "./salary-pay-sheet";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";
import { uploadFile, type PickedFile } from "../lib/upload";

type Status = "PAID" | "PARTIAL" | "OVERDUE" | "DUE" | "UPCOMING";
type Row = {
  id: string;
  source: "EXPENSE" | "SALARY";
  paidOn: string;
  forMonth: string;
  amount: number;
  categoryId: string | null;
  category: string;
  recurringId: string | null;
  recurringName: string;
  mode: string;
  payee: string;
  reference: string;
  note: string;
  proofPath: string;
  createdBy: string;
  createdAt: string;
  voided: boolean;
  voidReason: string;
  canEdit: boolean;
};
type Period = { forMonth: string; dueOn: string; amount: number; paid: number; status: Status };
type Recurring = {
  id: string;
  name: string;
  categoryId: string | null;
  category: string;
  amount: number;
  every: string;
  dueDay: number;
  startMonth: string;
  payee: string;
  note: string;
  archived: boolean;
  periods: Period[];
};
type Pending = Period & { recurringId: string; name: string };
type Data = {
  today: string;
  canAdd: boolean;
  canSeeAll: boolean;
  canManage: boolean;
  categories: { id: string; name: string; archived: boolean }[];
  rows: Row[];
  range: { from: string; to: string; total: number; count: number; today: number; byDay: { date: string; amount: number }[]; byHead: { name: string; amount: number }[] };
  recurring: Recurring[];
  pending: Pending[];
  profitLoss: null | {
    month: string;
    income: number;
    expense: number;
    net: number;
    byHead: { name: string; amount: number }[];
    planned: { id: string; name: string; expected: number; paid: number }[];
    salary: { expected: number; paid: number };
    expected: { fees: number; costs: number; net: number };
    trend: { month: string; income: number; expense: number; net: number }[];
  };
};

const EVERY: { id: string; label: string; short: string }[] = [
  { id: "MONTHLY", label: "Monthly", short: "month" },
  { id: "QUARTERLY", label: "Quarterly", short: "quarter" },
  { id: "HALF_YEARLY", label: "Half-yearly", short: "6 months" },
  { id: "YEARLY", label: "Yearly", short: "year" },
];

const HEAD_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  Salary: "people-outline",
  Rent: "home-outline",
  Electricity: "flash-outline",
  "Internet & phone": "wifi-outline",
  "Transport & fuel": "bus-outline",
  "Stationery & printing": "pencil-outline",
  "Repairs & maintenance": "construct-outline",
  "Cleaning & housekeeping": "sparkles-outline",
  "Events & functions": "balloon-outline",
};

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function dayLabel(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function shortDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function monthLabel(month: string, long = false) {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: long ? "long" : "short", year: "numeric" });
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function lastDayOf(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : "Could not save. Try again.";
}

function statusTone(s: Status): "leaf" | "warn" | "danger" | "ink" | "sky" {
  if (s === "PAID") return "leaf";
  if (s === "OVERDUE") return "danger";
  if (s === "PARTIAL" || s === "DUE") return "warn";
  return "sky";
}

function statusLabel(s: Status) {
  return s === "PAID" ? "Paid" : s === "PARTIAL" ? "Part paid" : s === "OVERDUE" ? "Overdue" : s === "DUE" ? "Due" : "Upcoming";
}

const RANGES = ["today", "yesterday", "week", "month", "lastMonth"] as const;
type RangeKey = (typeof RANGES)[number];
const RANGE_LABEL: Record<RangeKey, string> = { today: "Today", yesterday: "Yesterday", week: "This week", month: "This month", lastMonth: "Last month" };

function rangeFor(key: RangeKey, today: string) {
  if (key === "today") return { from: today, to: today };
  if (key === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };
  if (key === "week") {
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    return { from: addDays(today, -dow), to: today };
  }
  if (key === "lastMonth") {
    const m = addMonths(today.slice(0, 7), -1);
    return { from: `${m}-01`, to: lastDayOf(m) };
  }
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function localToday() {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

// ─── Board ─────────────────────────────────────────────────────────────────────

export function ExpensesBoard() {
  const { token } = useSession();
  const toast = useToast();
  const phone = useWindowDimensions().width < 640;
  const [tab, setTab] = useState<"spent" | "recurring" | "report">("spent");
  const [rangeKey, setRangeKey] = useState<RangeKey | "custom">("month");
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [by, setBy] = useState("");
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const [head, setHead] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<null | Partial<Row> & { pendingFor?: Pending }>(null);
  const [detail, setDetail] = useState<Row | null>(null);
  const [recurringForm, setRecurringForm] = useState<null | Partial<Recurring>>(null);
  const [headsOpen, setHeadsOpen] = useState(false);

  const today = data?.today ?? localToday();
  const range = rangeKey === "custom" && custom ? custom : rangeFor(rangeKey === "custom" ? "month" : rangeKey, today);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dates = rangeKey === "custom" && custom ? custom : rangeFor(rangeKey === "custom" ? "month" : rangeKey, localToday());
      const res = await act<Data & { ok: true }>(token, "loadExpenses", { ...dates, month });
      setData(res);
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [token, rangeKey, custom, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const done = (message: string) => {
    toast.show(message);
    void load();
  };

  if (!data) {
    return (
      <View className="gap-3">
        <PageHeader title="Expenses" />
        {error ? <Empty title="Could not load expenses" body={error} /> : <ActivityIndicator className="mt-10" />}
      </View>
    );
  }

  const tabs = [
    { id: "spent", label: "Spent" },
    { id: "recurring", label: data.pending.length ? `Recurring (${data.pending.length})` : "Recurring" },
    ...(data.profitLoss ? [{ id: "report", label: "Profit & loss" }] : []),
  ];

  return (
    <View className="gap-3">
      {phone ? (
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-xl font-semibold text-ink-900">Expenses</Text>
          {data.canManage ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Expense categories" onPress={() => setHeadsOpen(true)} className="h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white">
              <Ionicons name="pricetags-outline" size={18} color="#3d4f66" />
            </Pressable>
          ) : null}
          {data.canAdd ? (
            <Pressable accessibilityRole="button" onPress={() => setForm({})} className="h-10 flex-row items-center gap-1 rounded-full bg-[#1F45C7] px-4">
              <Ionicons name="add" size={18} color="#fff" />
              <Text className="text-sm font-semibold text-white">Add</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <PageHeader
          title="Expenses"
          lede={data.canSeeAll ? "Every rupee spent, salaries included. Recurring costs remind you when they fall due." : "Money you spent for the school, with the bill."}
          action={
            <View className="flex-row gap-2">
              {data.canManage ? (
                <Button variant="ghost" onPress={() => setHeadsOpen(true)}>
                  Categories
                </Button>
              ) : null}
              {data.canAdd ? <Button onPress={() => setForm({})}>+ Add expense</Button> : null}
            </View>
          }
        />
      )}
      <Segmented options={tabs} value={tab} onChange={(id) => setTab(id as typeof tab)} />

      {tab === "spent" ? (
        <SpentTab
          data={data}
          rangeKey={rangeKey}
          range={range}
          head={head}
          loading={loading}
          onRange={(k) => {
            setRangeKey(k);
            setHead("");
          }}
          onCustom={() => setCustomOpen(true)}
          by={by}
          onBy={setBy}
          onHead={setHead}
          onOpen={setDetail}
          onPending={() => setTab("recurring")}
        />
      ) : null}
      {tab === "recurring" ? (
        <RecurringTab
          data={data}
          onPay={(p) => {
            const r = data.recurring.find((x) => x.id === p.recurringId);
            setForm({
              recurringId: p.recurringId,
              recurringName: p.name,
              forMonth: p.forMonth,
              amount: Math.max(0, p.amount - p.paid),
              categoryId: r?.categoryId ?? null,
              payee: r?.payee ?? "",
              pendingFor: p,
            });
          }}
          onEdit={(r) => setRecurringForm(r)}
          onAdd={() => setRecurringForm({})}
        />
      ) : null}
      {tab === "report" && data.profitLoss ? <ReportTab pl={data.profitLoss} month={month} today={today} onMonth={setMonth} loading={loading} order={data.categories.map((c) => c.name)} /> : null}

      <ExpenseForm
        open={Boolean(form)}
        initial={form}
        data={data}
        onClose={() => setForm(null)}
        onSaved={(msg) => {
          setForm(null);
          done(msg);
        }}
      />
      <ExpenseDetail
        row={detail}
        onClose={() => setDetail(null)}
        onEdit={(r) => {
          setDetail(null);
          setForm(r);
        }}
        onCancelled={() => {
          setDetail(null);
          done("Expense cancelled.");
        }}
      />
      <RecurringForm
        open={Boolean(recurringForm)}
        initial={recurringForm}
        data={data}
        onClose={() => setRecurringForm(null)}
        onSaved={(msg) => {
          setRecurringForm(null);
          done(msg);
        }}
      />
      <CustomRange
        open={customOpen}
        today={today}
        initial={range}
        activeKey={rangeKey}
        onPreset={(k) => {
          setRangeKey(k);
          setHead("");
          setCustomOpen(false);
        }}
        onClose={() => setCustomOpen(false)}
        onApply={(r) => {
          setCustom(r);
          setRangeKey("custom");
          setHead("");
          setCustomOpen(false);
        }}
      />
      <HeadsModal open={headsOpen} data={data} onClose={() => setHeadsOpen(false)} onChanged={() => void load()} />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
    </View>
  );
}

// ─── Spent ─────────────────────────────────────────────────────────────────────

function SpentTab({
  data,
  rangeKey,
  range,
  head,
  loading,
  onRange,
  onCustom,
  by,
  onBy,
  onHead,
  onOpen,
  onPending,
}: {
  data: Data;
  rangeKey: RangeKey | "custom";
  onCustom: () => void;
  by: string;
  onBy: (name: string) => void;
  range: { from: string; to: string };
  head: string;
  loading: boolean;
  onRange: (k: RangeKey) => void;
  onHead: (h: string) => void;
  onOpen: (r: Row) => void;
  onPending: () => void;
}) {
  const base = by ? data.rows.filter((r) => r.createdBy === by) : data.rows;
  const rows = head ? base.filter((r) => r.category === head) : base;
  const liveBase = base.filter((r) => !r.voided);
  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of liveBase) map.set(r.paidOn, (map.get(r.paidOn) ?? 0) + r.amount);
    return [...map.entries()].map(([date, amount]) => ({ date, amount }));
  }, [liveBase]);
  const byHead = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of liveBase) map.set(r.category, (map.get(r.category) ?? 0) + r.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount }));
  }, [liveBase]);
  const people = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of data.rows) if (!r.voided && r.createdBy) map.set(r.createdBy, (map.get(r.createdBy) ?? 0) + r.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [data.rows]);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const liveTotalAll = data.rows.filter((r) => !r.voided).reduce((sum, r) => sum + r.amount, 0);
  const todayTotal = liveBase.filter((r) => r.paidOn === data.today).reduce((s, r) => s + r.amount, 0);
  const days = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) map.set(r.paidOn, [...(map.get(r.paidOn) ?? []), r]);
    return [...map.entries()];
  }, [rows]);
  const shownTotal = rows.filter((r) => !r.voided).reduce((s, r) => s + r.amount, 0);
  const overdue = data.pending.filter((p) => p.status === "OVERDUE");
  const single = range.from === range.to;

  return (
    <View className="gap-3">
      {data.pending.length && data.canAdd ? (
        <Pressable accessibilityRole="button" onPress={onPending} className={`flex-row items-center gap-3 rounded-xl border px-3 py-2.5 ${overdue.length ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
          <Ionicons name="alarm-outline" size={20} color={overdue.length ? "#b91c1c" : "#92400e"} />
          <View className="min-w-0 flex-1">
            <Text className={`text-sm font-semibold ${overdue.length ? "text-red-800" : "text-amber-900"}`} numberOfLines={1}>
              {data.pending.length === 1 ? `${data.pending[0].name} is ${overdue.length ? "overdue" : "due"}` : `${data.pending.length} recurring payments due`}
            </Text>
            <Text className="text-xs text-ink-700" numberOfLines={1}>
              {data.pending
                .slice(0, 3)
                .map((p) => `${p.name} ${inr(p.amount - p.paid)}`)
                .join(" · ")}
            </Text>
          </View>
          <Text className="text-xs font-semibold text-[#1F45C7]">Pay</Text>
        </Pressable>
      ) : null}

      <View className="flex-row gap-2">
        <FilterPill icon="calendar-outline" label={rangeKey === "custom" ? `${shortDate(range.from)} – ${shortDate(range.to)}` : RANGE_LABEL[rangeKey]} onPress={onCustom} />
        {data.canSeeAll ? (
          <FilterPill icon="person-outline" label={by || "Everyone"} active={Boolean(by)} onPress={() => setPeopleOpen(true)} />
        ) : null}
      </View>

      <Card className="p-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-xs text-ink-500">{single ? dayLabel(range.from, data.today) : `${shortDate(range.from)} – ${shortDate(range.to)}`}</Text>
            <Text className="mt-0.5 text-[28px] font-bold text-ink-900">{inr(shownTotal)}</Text>
            <Text className="text-xs text-ink-500" numberOfLines={1}>{`${plural(rows.filter((r) => !r.voided).length, "entry", "entries")}${[head, by && `by ${by}`].filter(Boolean).map((x) => ` · ${x}`).join("")}`}</Text>
          </View>
          {!single ? (
            <View className="items-end rounded-lg bg-ink-50 px-3 py-2">
              <Text className="text-[11px] text-ink-500">Today</Text>
              <Text className="text-base font-semibold text-ink-900">{inr(todayTotal)}</Text>
            </View>
          ) : null}
        </View>
        {!single && liveBase.length ? (
          <View className="mt-3 border-t border-ink-100 pt-3">
            <DailySpendChart bare from={range.from} to={range.to} byDay={byDay} today={data.today} />
          </View>
        ) : null}
      </Card>

      <PickerSheet open={peopleOpen} title="Spent by" onClose={() => setPeopleOpen(false)}>
        {[["", liveTotalAll] as [string, number], ...people].map(([name, amount]) => (
          <OptionRow
            key={name || "all"}
            icon={name ? "person-circle-outline" : "people-outline"}
            label={name || "Everyone"}
            sub={inr(amount)}
            on={by === name}
            onPress={() => {
              onBy(name);
              setPeopleOpen(false);
            }}
          />
        ))}
        <View className="h-3" />
      </PickerSheet>


      {byHead.length > 1 ? (
        <HeadSplit
          title="By category"
          heads={byHead}
          order={data.categories.map((c) => c.name)}
          active={head || undefined}
          onPick={(name) => onHead(head === name ? "" : name)}
        />
      ) : null}

      {data.canSeeAll && people.length && !by ? (
        <Card className="p-3">
          <View className="flex-row items-baseline justify-between">
            <Text className="text-sm font-semibold text-ink-900">Who spent</Text>
            <Text className="text-xs text-ink-500">Tap a name to see their entries</Text>
          </View>
          <View className="mt-2">
            {people.map(([name, amount], i) => {
              const count = data.rows.filter((r) => !r.voided && r.createdBy === name).length;
              const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
              return (
                <Pressable key={name} accessibilityRole="button" onPress={() => onBy(name)} className={`flex-row items-center gap-3 py-2.5 ${i ? "border-t border-ink-100" : ""}`}>
                  <View className="h-9 w-9 items-center justify-center rounded-full bg-[#EEF3FF]">
                    <Text className="text-xs font-semibold text-[#1F45C7]">{initials}</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>{name}</Text>
                    <Text className="text-xs text-ink-500">{plural(count, "entry", "entries")}</Text>
                  </View>
                  <Text className="text-sm font-semibold text-ink-900">{inr(amount)}</Text>
                  <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}

      {head ? (
        <View className="flex-row items-center gap-2">
          <Text className="text-sm text-ink-700">{`Showing ${head}`}</Text>
          <Pressable accessibilityRole="button" onPress={() => onHead("")} className="flex-row items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1">
            <Ionicons name="close" size={12} color="#3d4f66" />
            <Text className="text-xs font-medium text-ink-800">Show all</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? <ActivityIndicator /> : null}
      {!rows.length && !loading ? (
        <Empty title="No expenses here" body={data.canAdd ? "Tap + Add expense when money is spent. Add the bill photo so it's easy to check later." : "Nothing spent in these dates."} />
      ) : null}

      {days.map(([date, list]) => {
        const total = list.filter((r) => !r.voided).reduce((s, r) => s + r.amount, 0);
        return (
          <Card key={date} className="overflow-hidden">
            <View className="flex-row items-center justify-between border-b border-ink-100 bg-ink-50 px-3 py-2">
              <Text className="text-xs font-semibold uppercase tracking-wide text-ink-700">{dayLabel(date, data.today)}</Text>
              <Text className="text-sm font-semibold text-ink-900">{inr(total)}</Text>
            </View>
            {list.map((r, i) => (
              <ExpenseLine key={`${r.source}-${r.id}`} row={r} first={i === 0} onPress={() => onOpen(r)} />
            ))}
          </Card>
        );
      })}
    </View>
  );
}

function ExpenseLine({ row, first, onPress }: { row: Row; first: boolean; onPress: () => void }) {
  const title = row.source === "SALARY" ? row.payee : row.recurringName || row.payee || row.category;
  const bits = [
    row.source === "SALARY" ? `Salary · ${monthLabel(row.forMonth)}` : row.recurringName ? `${row.category} · for ${monthLabel(row.forMonth)}` : row.recurringName || row.payee ? row.category : "",
    row.note,
    payMethodLabel(row.mode),
    row.createdBy ? `by ${row.createdBy}` : "",
  ].filter(Boolean);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className={`flex-row items-center gap-3 px-3 py-2.5 ${first ? "" : "border-t border-ink-100"} ${row.voided ? "opacity-50" : ""}`}>
      <View className={`h-9 w-9 items-center justify-center rounded-full ${row.source === "SALARY" ? "bg-violet-50" : "bg-[#EEF3FF]"}`}>
        <Ionicons name={HEAD_ICON[row.category] ?? "receipt-outline"} size={17} color={row.source === "SALARY" ? "#6d28d9" : "#1F45C7"} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className={`text-sm font-medium text-ink-900 ${row.voided ? "line-through" : ""}`} numberOfLines={1}>
          {title}
        </Text>
        <Text className="text-xs text-ink-500" numberOfLines={1}>
          {row.voided ? `Cancelled · ${row.voidReason}` : bits.join(" · ")}
        </Text>
      </View>
      <View className="items-end">
        <Text className={`text-sm font-semibold text-ink-900 ${row.voided ? "line-through" : ""}`}>{inr(row.amount)}</Text>
        {row.proofPath ? <Ionicons name="attach" size={13} color="#64748b" /> : null}
      </View>
    </Pressable>
  );
}

// ─── Recurring ─────────────────────────────────────────────────────────────────

function RecurringTab({ data, onPay, onEdit, onAdd }: { data: Data; onPay: (p: Pending) => void; onEdit: (r: Recurring) => void; onAdd: () => void }) {
  const active = data.recurring.filter((r) => !r.archived);
  const stopped = data.recurring.filter((r) => r.archived);
  const months: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };
  const monthTotal = active.reduce((s, r) => s + r.amount / (months[r.every] ?? 1), 0);
  return (
    <View className="gap-3">
      {data.pending.length ? (
        <Card className="overflow-hidden">
          <View className="border-b border-ink-100 px-3 py-2">
            <Text className="text-sm font-semibold text-ink-900">To pay</Text>
          </View>
          {data.pending.map((p, i) => (
            <View key={`${p.recurringId}-${p.forMonth}`} className={`flex-row items-center gap-3 px-3 py-2.5 ${i ? "border-t border-ink-100" : ""}`}>
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>{`${p.name} · ${monthLabel(p.forMonth, true)}`}</Text>
                <Text className="text-xs text-ink-500">{`${p.status === "OVERDUE" ? "Was due" : "Due"} ${shortDate(p.dueOn)}${p.paid ? ` · ${inr(p.paid)} paid` : ""}`}</Text>
              </View>
              <Badge tone={statusTone(p.status)}>{statusLabel(p.status)}</Badge>
              {data.canAdd ? (
                <Pressable accessibilityRole="button" onPress={() => onPay(p)} className="rounded-md bg-[#1F45C7] px-3 py-1.5">
                  <Text className="text-xs font-semibold text-white">{`Pay ${inr(p.amount - p.paid)}`}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </Card>
      ) : active.length ? (
        <Card className="flex-row items-center gap-2 p-3">
          <Ionicons name="checkmark-circle" size={18} color="#15803d" />
          <Text className="text-sm text-ink-800">Everything due so far is paid.</Text>
        </Card>
      ) : null}

      <View className="flex-row items-end justify-between">
        <View>
          <Text className="text-base font-semibold text-ink-900">Fixed costs</Text>
          {active.length ? <Text className="text-xs text-ink-500">{`About ${inr(monthTotal)} a month`}</Text> : null}
        </View>
        {data.canManage ? (
          <Button variant="ghost" onPress={onAdd}>
            + Add recurring
          </Button>
        ) : null}
      </View>

      {!active.length ? (
        <Empty
          title="No recurring costs yet"
          body={data.canManage ? "Add rent, internet, bus EMI and other fixed costs once. Each month they show here as due until paid." : "The admin can set up rent and other fixed costs here."}
        />
      ) : null}

      {active.map((r) => (
        <Card key={r.id} className="p-3">
          <Pressable accessibilityRole="button" disabled={!data.canManage} onPress={() => onEdit(r)} className="flex-row items-start gap-3">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-[#EEF3FF]">
              <Ionicons name={HEAD_ICON[r.category] ?? "repeat-outline"} size={17} color="#1F45C7" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold text-ink-900" numberOfLines={1}>{r.name}</Text>
              <Text className="text-xs text-ink-500" numberOfLines={1}>
                {[r.category, `due on ${ordinal(r.dueDay)}`, r.payee].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-sm font-semibold text-ink-900">{inr(r.amount)}</Text>
              <Text className="text-[11px] text-ink-500">{`a ${EVERY.find((e) => e.id === r.every)?.short ?? "month"}`}</Text>
            </View>
          </Pressable>
          {r.periods.length ? (
            <View className="mt-2.5 flex-row flex-wrap gap-1.5">
              {r.periods.slice(-6).map((p) => (
                <View key={p.forMonth} className={`flex-row items-center gap-1 rounded-full px-2 py-0.5 ${p.status === "PAID" ? "bg-emerald-50" : p.status === "OVERDUE" ? "bg-red-50" : p.status === "UPCOMING" ? "bg-ink-50" : "bg-amber-50"}`}>
                  <Ionicons
                    name={p.status === "PAID" ? "checkmark" : p.status === "OVERDUE" ? "alert" : "time-outline"}
                    size={11}
                    color={p.status === "PAID" ? "#15803d" : p.status === "OVERDUE" ? "#b91c1c" : "#92400e"}
                  />
                  <Text className="text-[11px] text-ink-800">{monthLabel(p.forMonth)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ))}

      {stopped.length && data.canManage ? (
        <View className="gap-1.5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">Stopped</Text>
          {stopped.map((r) => (
            <Pressable key={r.id} accessibilityRole="button" onPress={() => onEdit(r)} className="flex-row items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
              <Text className="text-sm text-ink-500">{r.name}</Text>
              <Text className="text-xs text-ink-500">{inr(r.amount)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function FilterPill({ icon, label, active, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`h-10 min-w-0 flex-1 flex-row items-center gap-2 rounded-full border px-3.5 ${active ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
    >
      <Ionicons name={icon} size={16} color={active ? "#1F45C7" : "#475569"} />
      <Text className={`min-w-0 flex-1 text-sm font-medium ${active ? "text-[#1F45C7]" : "text-ink-800"}`} numberOfLines={1}>{label}</Text>
      <Ionicons name="chevron-down" size={14} color="#94a3b8" />
    </Pressable>
  );
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
}

// ─── Report ────────────────────────────────────────────────────────────────────

function ReportTab({ pl, month, today, onMonth, loading, order }: { pl: NonNullable<Data["profitLoss"]>; month: string; today: string; onMonth: (m: string) => void; loading: boolean; order: string[] }) {
  const past = pl.trend.filter((t) => t.month <= today.slice(0, 7));
  const sessionNet = past.reduce((s, t) => s + t.net, 0);
  const plannedRows = [
    ...pl.planned.map((p) => ({ key: p.id, name: p.name, expected: p.expected, paid: p.paid })),
    ...(pl.salary.expected || pl.salary.paid ? [{ key: "salary", name: "Salary", expected: pl.salary.expected, paid: pl.salary.paid }] : []),
  ];
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => onMonth(addMonths(month, -1))} className="h-9 w-9 items-center justify-center rounded-full border border-ink-200">
          <Ionicons name="chevron-back" size={18} color="#3d4f66" />
        </Pressable>
        <View className="items-center">
          <Text className="text-base font-semibold text-ink-900">{monthLabel(month, true)}</Text>
          {loading ? <ActivityIndicator size="small" /> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          disabled={month >= today.slice(0, 7)}
          onPress={() => onMonth(addMonths(month, 1))}
          className={`h-9 w-9 items-center justify-center rounded-full border border-ink-200 ${month >= today.slice(0, 7) ? "opacity-30" : ""}`}
        >
          <Ionicons name="chevron-forward" size={18} color="#3d4f66" />
        </Pressable>
      </View>

      <Card className="p-4">
        <View className="flex-row gap-3">
          <Figure label="Fees received" value={pl.income} tone="text-green-700" />
          <Figure label="Spent" value={pl.expense} tone="text-ink-900" />
        </View>
        <View className={`mt-3 flex-row items-center justify-between rounded-lg px-3 py-2.5 ${pl.net >= 0 ? "bg-emerald-50" : "bg-red-50"}`}>
          <Text className="text-sm font-medium text-ink-800">{pl.net >= 0 ? "Profit" : "Loss"}</Text>
          <Text className={`text-xl font-bold ${pl.net >= 0 ? "text-green-700" : "text-red-700"}`}>{inr(Math.abs(pl.net))}</Text>
        </View>
        <Text className="mt-2 text-[11px] leading-4 text-ink-500">
          Spent counts each cost in the month it belongs to. April's rent paid on 5 May shows in April.
        </Text>
      </Card>

      <Card className="p-4">
        <View className="mb-3 flex-row items-end justify-between">
          <Text className="text-sm font-semibold text-ink-900">{`Session ${pl.trend[0].month.slice(0, 4)}–${pl.trend[11].month.slice(2, 4)}`}</Text>
          <Text className={`text-sm font-semibold ${sessionNet >= 0 ? "text-green-700" : "text-red-700"}`}>{`${sessionNet >= 0 ? "Profit" : "Loss"} ${inr(Math.abs(sessionNet))} so far`}</Text>
        </View>
        <MonthBars trend={pl.trend} month={month} today={today} onMonth={onMonth} />
      </Card>

      {pl.byHead.length ? <HeadSplit title={`Where the money went · ${monthLabel(month)}`} heads={pl.byHead} order={order} /> : null}

      <Card className="p-4">
        <Text className="text-sm font-semibold text-ink-900">Expected this month</Text>
        <View className="mt-2 gap-1.5">
          <Line label="Fees due" value={inr(pl.expected.fees)} />
          <Line label="Fixed costs, salary and other spending" value={`− ${inr(pl.expected.costs)}`} />
          <View className="mt-1 border-t border-ink-100 pt-1.5">
            <Line label={pl.expected.net >= 0 ? "Should be left" : "Short by"} value={inr(Math.abs(pl.expected.net))} strong tone={pl.expected.net >= 0 ? "text-green-700" : "text-red-700"} />
          </View>
        </View>
      </Card>

      {plannedRows.length ? (
        <Card className="overflow-hidden">
          <View className="flex-row border-b border-ink-100 px-3 py-2">
            <Text className="flex-1 text-xs font-semibold text-ink-700">Planned vs paid</Text>
            <Text className="w-20 text-right text-xs font-semibold text-ink-700">Expected</Text>
            <Text className="w-20 text-right text-xs font-semibold text-ink-700">Paid</Text>
          </View>
          {plannedRows.map((p, i) => {
            const diff = p.paid - p.expected;
            return (
              <View key={p.key} className={`flex-row items-center px-3 py-2 ${i ? "border-t border-ink-100" : ""}`}>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm text-ink-900" numberOfLines={1}>{p.name}</Text>
                  {!p.paid ? (
                    <Text className="text-[11px] text-amber-700">Not paid yet</Text>
                  ) : diff !== 0 ? (
                    <Text className={`text-[11px] ${diff > 0 ? "text-red-700" : "text-amber-700"}`}>{diff > 0 ? `${inr(diff)} more than planned` : `${inr(-diff)} still to pay`}</Text>
                  ) : null}
                </View>
                <Text className="w-20 text-right text-sm text-ink-700">{inr(p.expected)}</Text>
                <Text className={`w-20 text-right text-sm font-medium ${p.paid >= p.expected ? "text-green-700" : "text-ink-900"}`}>{inr(p.paid)}</Text>
              </View>
            );
          })}
        </Card>
      ) : null}

    </View>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View className="flex-1">
      <Text className="text-xs text-ink-700">{label}</Text>
      <Text className={`mt-0.5 text-xl font-semibold ${tone}`}>{inr(value)}</Text>
    </View>
  );
}

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className={`flex-1 text-sm ${strong ? "font-semibold text-ink-900" : "text-ink-700"}`}>{label}</Text>
      <Text className={`text-sm ${strong ? "font-bold" : "font-medium"} ${tone ?? "text-ink-900"}`}>{value}</Text>
    </View>
  );
}


// ─── Forms ─────────────────────────────────────────────────────────────────────

function Label({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View className="mb-1.5 mt-4 flex-row items-center justify-between">
      <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">{children}</Text>
      {right}
    </View>
  );
}

function TextBox(props: { value: string; onChangeText: (v: string) => void; placeholder: string; keyboardType?: "default" | "number-pad"; multiline?: boolean; label?: string }) {
  return (
    <TextInput
      accessibilityLabel={props.label ?? props.placeholder}
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      keyboardType={props.keyboardType}
      multiline={props.multiline}
      placeholderTextColor="#94a3b8"
      className="rounded-xl border border-ink-200 px-3 py-3 text-sm text-ink-900"
    />
  );
}

/** Bottom sheet on a phone, centred popup on a big screen. */
function PickerSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const phone = useWindowDimensions().width < 640;
  if (!phone) {
    return (
      <Modal open={open} title={title} onClose={onClose}>
        {children}
      </Modal>
    );
  }
  return (
    <Sheet open={open} onClose={onClose}>
      <View className="px-5 pb-2">
        <Text className="-mt-1 mb-2 text-lg font-semibold text-ink-900">{title}</Text>
        {children}
      </View>
    </Sheet>
  );
}

function OptionRow({ label, sub, on, onPress, icon }: { label: string; sub?: string; on: boolean; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} className={`flex-row items-center gap-3 rounded-xl px-3 py-3 ${on ? "bg-[#EEF3FF]" : ""}`}>
      {icon ? <Ionicons name={icon} size={20} color={on ? "#1F45C7" : "#64748b"} /> : null}
      <Text className={`min-w-0 flex-1 text-[15px] ${on ? "font-semibold text-[#1F45C7]" : "text-ink-900"}`} numberOfLines={1}>{label}</Text>
      {sub ? <Text className="text-xs text-ink-500">{sub}</Text> : null}
      <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={20} color={on ? "#1F45C7" : "#cbd5e1"} />
    </Pressable>
  );
}

function CustomRange({
  open,
  today,
  initial,
  activeKey,
  onPreset,
  onClose,
  onApply,
}: {
  open: boolean;
  today: string;
  initial: { from: string; to: string };
  activeKey: RangeKey | "custom";
  onPreset: (k: RangeKey) => void;
  onClose: () => void;
  onApply: (r: { from: string; to: string }) => void;
}) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [own, setOwn] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFrom(initial.from);
    setTo(initial.to);
    setOwn(activeKey === "custom");
  }, [open, initial.from, initial.to, activeKey]);
  const sessionStart = `${Number(today.slice(5, 7)) >= 4 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04-01`;
  const extra: [string, { from: string; to: string }][] = [
    ["Last 7 days", { from: addDays(today, -6), to: today }],
    ["Last 30 days", { from: addDays(today, -29), to: today }],
    ["Last 3 months", { from: `${addMonths(today.slice(0, 7), -2)}-01`, to: today }],
    ["This session", { from: sessionStart, to: today }],
  ];
  const span = (r: { from: string; to: string }) => (r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} – ${shortDate(r.to)}`);
  const bad = !from || !to || from > to;
  const customOn = activeKey === "custom";
  return (
    <PickerSheet open={open} title="Show spending for" onClose={onClose}>
      {RANGES.map((k) => (
        <OptionRow key={k} label={RANGE_LABEL[k]} sub={span(rangeFor(k, today))} on={activeKey === k} onPress={() => onPreset(k)} />
      ))}
      {extra.map(([label, r]) => (
        <OptionRow key={label} label={label} sub={span(r)} on={customOn && initial.from === r.from && initial.to === r.to} onPress={() => onApply(r)} />
      ))}
      <OptionRow
        label="Custom dates"
        sub={customOn && !extra.some(([, r]) => r.from === initial.from && r.to === initial.to) ? span(initial) : undefined}
        on={own}
        onPress={() => setOwn(!own)}
      />
      {own ? (
        <View className="mt-1 gap-2 rounded-xl border border-ink-200 p-3">
          <View className="flex-row items-center gap-2">
            <Text className="w-12 text-xs font-semibold text-ink-500">From</Text>
            <View className="flex-1">
              <DateField value={from} max={today} onChange={setFrom} />
            </View>
          </View>
          <View className="flex-row items-center gap-2">
            <Text className="w-12 text-xs font-semibold text-ink-500">To</Text>
            <View className="flex-1">
              <DateField value={to} min={from} max={today} onChange={setTo} />
            </View>
          </View>
          <Button disabled={bad} onPress={() => onApply({ from, to })}>
            {bad ? "From must be before To" : `Show ${span({ from, to })}`}
          </Button>
        </View>
      ) : null}
      <View className="h-3" />
    </PickerSheet>
  );
}

/** Big centred ₹ amount, Indian commas while typing, no input box chrome. */
function AmountBox({ value, onChange, autoFocus, small }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; small?: boolean }) {
  const shown = value ? Number(value).toLocaleString("en-IN") : "";
  const size = small ? 26 : 38;
  const width = Math.max(1, (shown || "0").length) * size * 0.62 + 6;
  return (
    <View className={`items-center rounded-2xl bg-[#F4F7FF] ${small ? "py-3" : "py-5"}`}>
      {small ? null : <Text className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Amount</Text>}
      <View className="flex-row items-center justify-center">
        <Text style={{ fontSize: size * 0.8, color: value ? "#0f172a" : "#94a3b8", fontWeight: "600", marginRight: 2 }}>₹</Text>
        <TextInput
          accessibilityLabel="Amount"
          value={shown}
          onChangeText={(v) => onChange(v.replace(/[^\d]/g, "").replace(/^0+/, "").slice(0, 10))}
          placeholder="0"
          keyboardType="number-pad"
          placeholderTextColor="#94a3b8"
          autoFocus={autoFocus}
          selectionColor="#1F45C7"
          style={[{ fontSize: size, fontWeight: "700", color: "#0f172a", width, padding: 0, textAlign: "left", borderWidth: 0 }, Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null]}
        />
      </View>
    </View>
  );
}

/** Heads as icon tiles: three to a row on a phone, easy to hit with a thumb. */
function HeadGrid({ heads, value, onChange }: { heads: { id: string; name: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {heads.map((c) => {
        const on = value === c.id;
        return (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={c.name}
            onPress={() => onChange(c.id)}
            style={{ width: "31.5%" }}
            className={`min-h-[70px] items-center justify-center gap-1 rounded-xl border px-1.5 py-2 ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
          >
            <Ionicons name={HEAD_ICON[c.name] ?? "pricetag-outline"} size={20} color={on ? "#1F45C7" : "#475569"} />
            <Text numberOfLines={2} className={`text-center text-[11px] leading-[14px] ${on ? "font-semibold text-[#1F45C7]" : "text-ink-700"}`}>
              {c.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ExpenseForm({
  open,
  initial,
  data,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: (Partial<Row> & { pendingFor?: Pending }) | null;
  data: Data;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const { token } = useSession();
  const heads = data.categories.filter((c) => !c.archived || c.id === initial?.categoryId);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [paidOn, setPaidOn] = useState(data.today);
  const [forMonth, setForMonth] = useState(data.today.slice(0, 7));
  const [monthTouched, setMonthTouched] = useState(false);
  const [mode, setMode] = useState("CASH");
  const [payee, setPayee] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount(initial?.amount ? String(initial.amount) : "");
    setCategoryId(initial?.categoryId ?? "");
    setPaidOn(initial?.paidOn ?? data.today);
    setForMonth(initial?.forMonth ?? data.today.slice(0, 7));
    setMonthTouched(Boolean(initial?.forMonth && initial.forMonth !== (initial.paidOn ?? data.today).slice(0, 7)));
    setMode(initial?.mode ?? "CASH");
    setPayee(initial?.payee ?? "");
    setNote(initial?.note ?? "");
    setFile(null);
    setError("");
  }, [open, initial, data.today]);

  const editing = Boolean(initial?.id);
  const recurring = Boolean(initial?.recurringId);
  const changePaidOn = (d: string) => {
    setPaidOn(d);
    if (!recurring && !monthTouched) setForMonth(d.slice(0, 7));
  };
  const title = editing ? "Edit expense" : recurring ? `Pay ${initial?.recurringName}` : "Add expense";

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const proofPath = file ? (await uploadFile(token, file, { kind: "expenseBill" })).path : initial?.proofPath ?? "";
      await act(token, "saveExpense", {
        id: initial?.id,
        amount: Number(amount.replace(/[^\d.]/g, "")),
        categoryId,
        recurringId: initial?.recurringId ?? undefined,
        forMonth,
        paidOn,
        mode,
        payee,
        note,
        proofPath,
      });
      onSaved(editing ? "Expense updated." : `${inr(Number(amount.replace(/[^\d.]/g, "")))} added to ${dayLabel(paidOn, data.today).toLowerCase() === "today" ? "today" : shortDate(paidOn)}.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      sheetOnPhone
      footer={
        <View className="gap-2">
          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
          <Button disabled={busy || !amount || (!categoryId && !recurring)} onPress={() => void save()}>
            {busy ? "Saving…" : editing ? "Save changes" : "Save expense"}
          </Button>
        </View>
      }
    >
      <AmountBox value={amount} onChange={setAmount} autoFocus={!editing && !recurring} />
      {initial?.pendingFor ? <Text className="mt-1.5 text-center text-xs text-ink-500">{`Due ${inr(initial.pendingFor.amount)} for ${monthLabel(initial.pendingFor.forMonth, true)}`}</Text> : null}

      {recurring ? (
        <>
          <Label>For month</Label>
          <View className="flex-row items-center gap-2">
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setForMonth(addMonths(forMonth, -1))} className="h-9 w-9 items-center justify-center rounded-full border border-ink-200">
              <Ionicons name="chevron-back" size={16} color="#3d4f66" />
            </Pressable>
            <Text className="flex-1 text-center text-sm font-semibold text-ink-900">{monthLabel(forMonth, true)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setForMonth(addMonths(forMonth, 1))} className="h-9 w-9 items-center justify-center rounded-full border border-ink-200">
              <Ionicons name="chevron-forward" size={16} color="#3d4f66" />
            </Pressable>
          </View>
        </>
      ) : null}

      <Label>Category</Label>
      <HeadGrid heads={heads} value={categoryId} onChange={setCategoryId} />

      <Label>Paid on</Label>
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Chip label="Today" active={paidOn === data.today} onPress={() => changePaidOn(data.today)} />
        <Chip label="Yesterday" active={paidOn === addDays(data.today, -1)} onPress={() => changePaidOn(addDays(data.today, -1))} />
        <View className="min-w-[150px] flex-1">
          <DateField value={paidOn} max={data.today} onChange={changePaidOn} />
        </View>
      </View>

      {!recurring && !monthTouched ? (
        <Pressable accessibilityRole="button" onPress={() => setMonthTouched(true)} className="mt-2 flex-row items-center gap-1.5 self-start py-1">
          <Ionicons name="calendar-clear-outline" size={14} color="#64748b" />
          <Text className="text-xs text-ink-600">{`For ${monthLabel(forMonth, true)}`}</Text>
          <Text className="text-xs font-semibold text-[#1F45C7]">· Bill for another month?</Text>
        </Pressable>
      ) : null}
      {!recurring && monthTouched ? (
        <>
          <Label>For month</Label>
          <View className="flex-row items-center gap-2 rounded-xl border border-ink-200 px-1.5 py-1.5">
            <Pressable accessibilityRole="button" accessibilityLabel="Earlier month" onPress={() => setForMonth(addMonths(forMonth, -1))} className="h-9 w-9 items-center justify-center rounded-full bg-ink-50">
              <Ionicons name="chevron-back" size={16} color="#3d4f66" />
            </Pressable>
            <View className="min-w-0 flex-1 items-center">
              <Text className="text-sm font-semibold text-ink-900">{monthLabel(forMonth, true)}</Text>
              <Text className="text-[11px] text-ink-500" numberOfLines={1}>
                {forMonth === paidOn.slice(0, 7) ? "Same month it was paid" : `Paid ${shortDate(paidOn)}, counted in ${monthLabel(forMonth, true)}`}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Later month"
              disabled={forMonth >= paidOn.slice(0, 7)}
              onPress={() => setForMonth(addMonths(forMonth, 1))}
              className={`h-9 w-9 items-center justify-center rounded-full bg-ink-50 ${forMonth >= paidOn.slice(0, 7) ? "opacity-30" : ""}`}
            >
              <Ionicons name="chevron-forward" size={16} color="#3d4f66" />
            </Pressable>
          </View>
          <Text className="mt-1 text-[11px] text-ink-500">For a bill from an earlier month, e.g. October's electricity paid in November.</Text>
        </>
      ) : null}

      <Label>Paid by</Label>
      <PayMethodTiles value={mode} onChange={setMode} />

      <Label>Paid to</Label>
      <TextBox value={payee} onChangeText={setPayee} placeholder="Shop or person, e.g. Sharma Stationers" />

      <Label>Note</Label>
      <TextBox value={note} onChangeText={setNote} placeholder="What was it for?" multiline />

      <Label>Bill</Label>
      <ProofAttach mode={mode} file={file} onChange={setFile} label={initial?.proofPath ? "Replace bill" : "Attach bill"} hint="Photo of the bill or receipt" />
      <View className="h-4" />
    </Modal>
  );
}

function ExpenseDetail({ row, onClose, onEdit, onCancelled }: { row: Row | null; onClose: () => void; onEdit: (r: Row) => void; onCancelled: () => void }) {
  const { token } = useSession();
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setReason("");
    setCancelling(false);
    setError("");
  }, [row]);
  if (!row) return null;
  const cancel = async () => {
    setBusy(true);
    setError("");
    try {
      await act(token, "voidExpense", { id: row.id, reason });
      onCancelled();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={row.source === "SALARY" ? "Salary payment" : "Expense"} onClose={onClose}>
      <View className="items-center pb-3">
        <Text className={`text-3xl font-bold text-ink-900 ${row.voided ? "line-through" : ""}`}>{inr(row.amount)}</Text>
        <Text className="mt-1 text-sm text-ink-700">{row.source === "SALARY" ? row.payee : row.recurringName || row.category}</Text>
        {row.voided ? (
          <View className="mt-2">
            <Badge tone="danger">Cancelled</Badge>
          </View>
        ) : null}
      </View>
      <View className="gap-2 border-t border-ink-100 pt-3">
        <Line label="Category" value={row.category} />
        <Line label="Paid on" value={new Date(`${row.paidOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })} />
        {row.forMonth !== row.paidOn.slice(0, 7) || row.recurringId || row.source === "SALARY" ? <Line label="For month" value={monthLabel(row.forMonth, true)} /> : null}
        <Line label="Paid by" value={payMethodLabel(row.mode)} />
        {row.payee && row.source !== "SALARY" ? <Line label="Paid to" value={row.payee} /> : null}
        {row.reference ? <Line label="Reference" value={row.reference} /> : null}
        {row.note ? <Line label="Note" value={row.note} /> : null}
        {row.createdBy ? <Line label="Entered by" value={row.createdBy} /> : null}
        {row.voided ? <Line label="Why cancelled" value={row.voidReason} /> : null}
      </View>
      {row.proofPath ? (
        <Pressable accessibilityRole="button" onPress={() => void openSalaryProof(token, row.proofPath)} className="mt-4 flex-row items-center justify-center gap-2 rounded-xl border border-ink-200 py-2.5">
          <Ionicons name="document-attach-outline" size={16} color="#1F45C7" />
          <Text className="text-sm font-semibold text-[#1F45C7]">View bill</Text>
        </Pressable>
      ) : null}
      {row.source === "SALARY" ? <Text className="mt-4 text-xs text-ink-500">Salary payments are changed from Staff → Salary.</Text> : null}
      {row.canEdit && !cancelling ? (
        <View className="mt-4 flex-row gap-2">
          <Button variant="ghost" className="flex-1" onPress={() => onEdit(row)}>
            Edit
          </Button>
          <Button variant="ghost" className="flex-1" onPress={() => setCancelling(true)}>
            Cancel expense
          </Button>
        </View>
      ) : null}
      {!row.canEdit && !row.voided && row.source === "EXPENSE" ? (
        <Text className="mt-4 text-xs text-ink-500">Only the admin can change this now. The person who entered it can change it the same day.</Text>
      ) : null}
      {cancelling ? (
        <View className="mt-4 gap-2">
          <TextBox value={reason} onChangeText={setReason} placeholder="Why cancel? e.g. Entered twice" label="Reason" />
          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
          <View className="flex-row gap-2">
            <Button variant="ghost" className="flex-1" onPress={() => setCancelling(false)}>
              Back
            </Button>
            <Button variant="danger" className="flex-1" disabled={busy || !reason.trim()} onPress={() => void cancel()}>
              {busy ? "Cancelling…" : "Cancel expense"}
            </Button>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

function RecurringForm({
  open,
  initial,
  data,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: Partial<Recurring> | null;
  data: Data;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const { token } = useSession();
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [every, setEvery] = useState("MONTHLY");
  const [dueDay, setDueDay] = useState("1");
  const [startMonth, setStartMonth] = useState(data.today.slice(0, 7));
  const [payee, setPayee] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setCategoryId(initial?.categoryId ?? "");
    setAmount(initial?.amount ? String(initial.amount) : "");
    setEvery(initial?.every ?? "MONTHLY");
    setDueDay(String(initial?.dueDay ?? 1));
    setStartMonth(initial?.startMonth ?? data.today.slice(0, 7));
    setPayee(initial?.payee ?? "");
    setNote(initial?.note ?? "");
    setError("");
  }, [open, initial, data.today]);

  const run = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    setError("");
    try {
      await act(token, "saveRecurringExpense", body);
      onSaved(msg);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const editing = Boolean(initial?.id);
  const heads = data.categories.filter((c) => !c.archived || c.id === initial?.categoryId);

  return (
    <Modal
      open={open}
      title={editing ? "Edit recurring cost" : "Add recurring cost"}
      onClose={onClose}
      sheetOnPhone
      footer={
        <View className="gap-2">
          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
          <Button
            disabled={busy || !name.trim() || !amount}
            onPress={() => void run({ id: initial?.id, name, categoryId, amount: Number(amount), every, dueDay: Number(dueDay), startMonth, payee, note }, editing ? "Recurring cost saved." : `${name} added.`)}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
          {editing ? (
            <Button variant="ghost" disabled={busy} onPress={() => void run({ id: initial?.id, archived: !initial?.archived }, initial?.archived ? `${initial?.name} started again.` : `${initial?.name} stopped.`)}>
              {initial?.archived ? "Start again" : "Stop this cost"}
            </Button>
          ) : null}
        </View>
      }
    >
      <Label>Name</Label>
      <TextBox value={name} onChangeText={setName} placeholder="e.g. School building rent" />
      <Label>Amount</Label>
      <AmountBox value={amount} onChange={setAmount} small />
      <Label>How often</Label>
      <Segmented options={EVERY.map((e) => ({ id: e.id, label: e.label }))} value={every} onChange={setEvery} />
      <View className="flex-row gap-3">
        <View className="flex-1">
          <Label>Due on day</Label>
          <TextBox value={dueDay} onChangeText={(v) => setDueDay(v.replace(/[^\d]/g, "").slice(0, 2))} placeholder="1" keyboardType="number-pad" label="Due day" />
        </View>
        <View className="flex-1">
          <Label>Starts from</Label>
          <View className="flex-row items-center gap-1 rounded-xl border border-ink-200 px-1 py-1.5">
            <Pressable accessibilityRole="button" accessibilityLabel="Earlier" onPress={() => setStartMonth(addMonths(startMonth, -1))} className="h-8 w-8 items-center justify-center">
              <Ionicons name="chevron-back" size={16} color="#3d4f66" />
            </Pressable>
            <Text className="flex-1 text-center text-sm text-ink-900">{monthLabel(startMonth)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Later" onPress={() => setStartMonth(addMonths(startMonth, 1))} className="h-8 w-8 items-center justify-center">
              <Ionicons name="chevron-forward" size={16} color="#3d4f66" />
            </Pressable>
          </View>
        </View>
      </View>
      <Label>Category</Label>
      <HeadGrid heads={heads} value={categoryId} onChange={setCategoryId} />
      <Label>Paid to</Label>
      <TextBox value={payee} onChangeText={setPayee} placeholder="Landlord, internet company…" />
      <Label>Note</Label>
      <TextBox value={note} onChangeText={setNote} placeholder="Optional" />
      <View className="h-4" />
    </Modal>
  );
}

function HeadsModal({ open, data, onClose, onChanged }: { open: boolean; data: Data; onClose: () => void; onChanged: () => void }) {
  const { token } = useSession();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await act(token, "saveExpenseCategory", body);
      setName("");
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const active = data.categories.filter((c) => !c.archived);
  const hidden = data.categories.filter((c) => c.archived);
  return (
    <Modal open={open} title="Expense categories" onClose={onClose} sheetOnPhone>
      <Text className="text-xs text-ink-500">Categories group your spending in reports. Salary is added on its own from the Salary tab.</Text>
      <View className="mt-3 flex-row gap-2">
        <View className="flex-1">
          <TextBox value={name} onChangeText={setName} placeholder="New category, e.g. Sports" />
        </View>
        <Button disabled={busy || !name.trim()} onPress={() => void run({ name })}>
          Add
        </Button>
      </View>
      {error ? <Text className="mt-2 text-sm text-red-700">{error}</Text> : null}
      <View className="mt-3">
        {active.map((c, i) => (
          <View key={c.id} className={`flex-row items-center gap-2 py-2.5 ${i ? "border-t border-ink-100" : ""}`}>
            {editing?.id === c.id ? (
              <>
                <View className="flex-1">
                  <TextBox value={editing.name} onChangeText={(v) => setEditing({ id: c.id, name: v })} placeholder="Name" />
                </View>
                <Button disabled={busy} onPress={() => void run({ id: c.id, name: editing.name })}>
                  Save
                </Button>
              </>
            ) : (
              <>
                <View className="h-9 w-9 items-center justify-center rounded-full bg-[#EEF3FF]">
                  <Ionicons name={HEAD_ICON[c.name] ?? "pricetag-outline"} size={17} color="#1F45C7" />
                </View>
                <Text className="min-w-0 flex-1 text-[15px] text-ink-900" numberOfLines={1}>{c.name}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${c.name}`} hitSlop={6} onPress={() => setEditing({ id: c.id, name: c.name })} className="h-9 w-9 items-center justify-center rounded-full">
                  <Ionicons name="create-outline" size={18} color="#475569" />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Hide ${c.name}`} hitSlop={6} disabled={busy} onPress={() => void run({ id: c.id, archived: true })} className="h-9 w-9 items-center justify-center rounded-full">
                  <Ionicons name="eye-off-outline" size={18} color="#94a3b8" />
                </Pressable>
              </>
            )}
          </View>
        ))}
      </View>
      {hidden.length ? (
        <View className="mt-3 gap-1">
          <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">Hidden</Text>
          {hidden.map((c) => (
            <View key={c.id} className="flex-row items-center justify-between py-1.5">
              <Text className="text-sm text-ink-500">{c.name}</Text>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run({ id: c.id, archived: false })}>
                <Text className="text-xs font-semibold text-[#1F45C7]">Show</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </Modal>
  );
}
