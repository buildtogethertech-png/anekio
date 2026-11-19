import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

/** Validated categorical palette (light), fixed order. Slot 7 (violet) is kept for Salary. */
const SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#e34948"];
const SALARY = "#6250d6";
const OTHER = "#94a3b8";
const SPENT = "#2a78d6";
const FEES = "#1baf7a";

function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** ₹1.2L / ₹45k style for axis labels. */
function short(n: number) {
  if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(1).replace(/\.0$/, "")}Cr`;
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1).replace(/\.0$/, "")}L`;
  if (n >= 1000) return `₹${Math.round(n / 1000)}k`;
  return `₹${Math.round(n)}`;
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayName(date: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", opts);
}

/** Colour follows the head, not its rank: heads keep their slot from the school's head order. */
export function headColor(name: string, order: string[]) {
  if (name === "Salary") return SALARY;
  const i = order.indexOf(name);
  return i >= 0 && i < SLOTS.length ? SLOTS[i] : OTHER;
}

/** Spending per day across the picked dates. Tap a bar to read it. */
export function DailySpendChart({ from, to, byDay, today, bare }: { from: string; to: string; byDay: { date: string; amount: number }[]; today: string; bare?: boolean }) {
  // Up to 45 days: one bar a day. Longer: one bar a week; past ~6 months: one bar a month.
  const { days, unit } = useMemo(() => {
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    const unit: "day" | "week" | "month" = span <= 45 ? "day" : span <= 200 ? "week" : "month";
    const keyOf = (d: string) => (unit === "day" ? d : unit === "month" ? `${d.slice(0, 7)}-01` : addDays(from, Math.floor((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (7 * 86_400_000)) * 7));
    const out = new Map<string, number>();
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const k = keyOf(d);
      if (!out.has(k)) out.set(k, 0);
    }
    for (const d of byDay) if (d.date >= from && d.date <= to) out.set(keyOf(d.date), (out.get(keyOf(d.date)) ?? 0) + d.amount);
    return { days: [...out.entries()].map(([date, amount]) => ({ date, amount })), unit };
  }, [from, to, byDay]);
  const fmt = (d: string, long = false) =>
    unit === "month"
      ? dayName(d, { month: "short", year: long ? "numeric" : undefined })
      : unit === "week"
        ? `${long ? "Week of " : ""}${dayName(d, { day: "numeric", month: "short" })}`
        : dayName(d, long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });
  const [picked, setPicked] = useState<string | null>(null);
  const max = Math.max(1, ...days.map((d) => d.amount));
  const spentDays = days.filter((d) => d.amount > 0);
  const avg = spentDays.length ? spentDays.reduce((s, d) => s + d.amount, 0) / days.length : 0;
  const top = spentDays.reduce<{ date: string; amount: number } | null>((m, d) => (!m || d.amount > m.amount ? d : m), null);
  const sel = days.find((d) => d.date === picked) ?? null;
  const gap = days.length > 20 ? 2 : 4;
  const H = 110;

  return (
    <View className={bare ? "" : "rounded-xl border border-ink-200 bg-white p-3"}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1">
          <Text className={bare ? "text-xs font-semibold text-ink-700" : "text-sm font-semibold text-ink-900"}>{`Spent each ${unit}`}</Text>
          <Text className="text-xs text-ink-500" numberOfLines={1}>
            {sel
              ? `${fmt(sel.date, true)} · ${inr(sel.amount)}`
              : top
                ? `Highest ${inr(top.amount)} ${unit === "day" ? "on" : "in"} ${fmt(top.date, true)} · avg ${inr(avg)}/${unit}`
                : "Nothing spent in these dates"}
          </Text>
        </View>
        <Text className="text-[11px] text-ink-400">{short(max)}</Text>
      </View>
      <View className="mt-2 flex-row items-end border-b border-ink-200" style={{ height: H, gap }}>
        {days.map((d) => {
          const on = picked === d.date;
          const h = d.amount ? Math.max(4, (d.amount / max) * (H - 6)) : 2;
          return (
            <Pressable
              key={d.date}
              accessibilityRole="button"
              accessibilityLabel={`${fmt(d.date, true)}: ${inr(d.amount)}`}
              onPress={() => setPicked(on ? null : d.date)}
              className="h-full flex-1 justify-end"
            >
              <View
                style={{
                  height: h,
                  backgroundColor: d.amount ? SPENT : "#e2e8f0",
                  opacity: picked && !on ? 0.35 : 1,
                  borderTopLeftRadius: 4,
                  borderTopRightRadius: 4,
                }}
              />
            </Pressable>
          );
        })}
      </View>
      <View className="mt-1 flex-row justify-between">
        <Text className="text-[10px] text-ink-400">{fmt(days[0]?.date ?? from)}</Text>
        {days.length > 2 ? <Text className="text-[10px] text-ink-400">{fmt(days[Math.floor(days.length / 2)].date)}</Text> : null}
        <Text className="text-[10px] text-ink-400">{unit === "day" && days[days.length - 1]?.date === today ? "Today" : fmt(days[days.length - 1]?.date ?? to)}</Text>
      </View>
    </View>
  );
}

/** One bar split by head, then a legend list with amounts and shares. Top 5 heads, the rest as Other. */
export function HeadSplit({
  title,
  heads,
  order,
  active,
  onPick,
}: {
  title: string;
  heads: { name: string; amount: number }[];
  order: string[];
  active?: string;
  onPick?: (name: string) => void;
}) {
  const total = heads.reduce((s, h) => s + h.amount, 0);
  if (!total) return null;
  const top = heads.slice(0, 5);
  const rest = heads.slice(5).reduce((s, h) => s + h.amount, 0);
  const parts = [...top.map((h) => ({ ...h, color: headColor(h.name, order) })), ...(rest ? [{ name: "Other", amount: rest, color: OTHER }] : [])];
  return (
    <View className="rounded-xl border border-ink-200 bg-white p-3">
      <View className="flex-row items-baseline justify-between">
        <Text className="text-sm font-semibold text-ink-900">{title}</Text>
        <Text className="text-xs text-ink-500">{inr(total)}</Text>
      </View>
      <View className="mt-2.5 h-3 flex-row overflow-hidden rounded-full" style={{ gap: 2 }}>
        {parts.map((p) => (
          <View key={p.name} style={{ flex: p.amount, backgroundColor: p.color, opacity: active && active !== p.name ? 0.3 : 1 }} />
        ))}
      </View>
      <View className="mt-2.5">
        {parts.map((p) => {
          const pick = onPick && p.name !== "Other" ? () => onPick(p.name) : undefined;
          return (
            <Pressable
              key={p.name}
              accessibilityRole={pick ? "button" : undefined}
              disabled={!pick}
              onPress={pick}
              className={`flex-row items-center gap-2 rounded-md px-1 py-1.5 ${active === p.name ? "bg-ink-50" : ""}`}
            >
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: p.color }} />
              <Text className="min-w-0 flex-1 text-sm text-ink-800" numberOfLines={1}>{p.name}</Text>
              <Text className="w-10 text-right text-xs text-ink-500">{`${Math.round((p.amount / total) * 100)}%`}</Text>
              <Text className="w-24 text-right text-sm font-medium text-ink-900">{inr(p.amount)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Fees received vs spent, month by month for the session. Tap a month to open it. */
export function MonthBars({
  trend,
  month,
  today,
  onMonth,
}: {
  trend: { month: string; income: number; expense: number; net: number }[];
  month: string;
  today: string;
  onMonth: (m: string) => void;
}) {
  const shown = trend.filter((t) => t.month <= today.slice(0, 7));
  const max = Math.max(1, ...shown.map((t) => Math.max(t.income, t.expense)));
  const H = 130;
  const sel = shown.find((t) => t.month === month);
  return (
    <View>
      <View className="flex-row items-center gap-3">
        <Key color={FEES} label="Fees received" />
        <Key color={SPENT} label="Spent" />
        <Text className="ml-auto text-[11px] text-ink-400">{short(max)}</Text>
      </View>
      <View className="mt-2 flex-row items-end border-b border-ink-200" style={{ height: H, gap: 6 }}>
        {shown.map((t) => {
          const on = t.month === month;
          return (
            <Pressable
              key={t.month}
              accessibilityRole="button"
              accessibilityLabel={`${t.month}: fees ${inr(t.income)}, spent ${inr(t.expense)}`}
              onPress={() => onMonth(t.month)}
              className={`h-full flex-1 flex-row items-end justify-center rounded-t-md ${on ? "bg-ink-50" : ""}`}
              style={{ gap: 2 }}
            >
              <View style={{ width: "40%", height: t.income ? Math.max(3, (t.income / max) * (H - 8)) : 2, backgroundColor: t.income ? FEES : "#e2e8f0", borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
              <View style={{ width: "40%", height: t.expense ? Math.max(3, (t.expense / max) * (H - 8)) : 2, backgroundColor: t.expense ? SPENT : "#e2e8f0", borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
            </Pressable>
          );
        })}
      </View>
      <View className="mt-1 flex-row" style={{ gap: 6 }}>
        {shown.map((t) => (
          <Text key={t.month} className={`flex-1 text-center text-[10px] ${t.month === month ? "font-semibold text-ink-900" : "text-ink-400"}`}>
            {new Date(`${t.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" }).slice(0, 3)}
          </Text>
        ))}
      </View>
      {sel ? (
        <Text className="mt-2 text-xs text-ink-700">
          {`${new Date(`${sel.month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long" })}: fees ${inr(sel.income)} · spent ${inr(sel.expense)} · `}
          <Text className={`font-semibold ${sel.net > 0 ? "text-green-700" : sel.net < 0 ? "text-red-700" : "text-ink-700"}`}>{`${sel.net >= 0 ? "profit" : "loss"} ${inr(Math.abs(sel.net))}`}</Text>
        </Text>
      ) : null}
    </View>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text className="text-[11px] text-ink-700">{label}</Text>
    </View>
  );
}
