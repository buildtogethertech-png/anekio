import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

export type LeaveCreditMode = "YEARLY" | "MONTHLY" | "QUARTERLY" | "HALF_YEARLY";
export type LeaveCarry = "NONE" | "CAPPED" | "ALL";

export type LeaveCreditDraft = {
  forTeacher: boolean;
  forStaff: boolean;
  forStudent: boolean;
  yearlyCap: number;
  creditMode?: string;
  creditAmount?: number;
  carryForward?: string;
  carryForwardCap?: number;
  prorateJoiners?: boolean;
  advanceDays?: number;
};

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const MODES: { id: LeaveCreditMode; label: string; per: string; perYear: number }[] = [
  { id: "MONTHLY", label: "Monthly", per: "month", perYear: 12 },
  { id: "QUARTERLY", label: "Quarterly", per: "quarter", perYear: 4 },
  { id: "HALF_YEARLY", label: "Half-yearly", per: "half-year", perYear: 2 },
  { id: "YEARLY", label: "All at year start", per: "year", perYear: 1 },
];

function num(n: number) {
  return n % 1 ? n.toFixed(1) : String(n);
}

function modeOf(row: LeaveCreditDraft): LeaveCreditMode {
  const m = String(row.creditMode || "YEARLY").toUpperCase();
  return (MODES.some((x) => x.id === m) ? m : "YEARLY") as LeaveCreditMode;
}

/** "1 / month · 12 a year · carry up to 10" */
export function leaveCreditSummary(row: LeaveCreditDraft) {
  if (!row.forTeacher && !row.forStaff) return "Students only · no balance";
  const mode = modeOf(row);
  const meta = MODES.find((m) => m.id === mode)!;
  const amount = mode === "YEARLY" ? row.yearlyCap : Number(row.creditAmount || 0);
  if (!amount) return "No limit";
  const head = mode === "YEARLY" ? `${num(amount)} at year start` : `${num(amount)} / ${meta.per} · ${num(amount * meta.perYear)} a year`;
  const carry =
    row.carryForward === "ALL" ? "carry all" : row.carryForward === "CAPPED" ? `carry up to ${row.carryForwardCap || 0}` : "lapses yearly";
  return `${head} · ${carry}`;
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`h-9 items-center justify-center rounded-xl border px-3 ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
    >
      <Text className={`text-[13px] ${on ? "font-semibold text-[#1F45C7]" : "text-ink-700"}`}>{label}</Text>
    </Pressable>
  );
}

function Step({ value, onChange, step = 1, max = 365 }: { value: number; onChange: (n: number) => void; step?: number; max?: number }) {
  return (
    <View className="flex-row items-center gap-1">
      <Pressable onPress={() => onChange(Math.max(0, Math.round((value - step) * 2) / 2))} className="h-9 w-9 items-center justify-center rounded-xl border border-ink-200 bg-white">
        <Ionicons name="remove" size={16} color="#334155" />
      </Pressable>
      <TextInput
        value={num(value)}
        keyboardType="decimal-pad"
        onChangeText={(t) => {
          const n = Number(t.replace(/[^\d.]/g, ""));
          if (Number.isFinite(n)) onChange(Math.min(max, Math.round(n * 2) / 2));
        }}
        className="h-9 w-14 rounded-xl border border-ink-200 bg-white text-center text-[15px] font-semibold text-ink-900"
      />
      <Pressable onPress={() => onChange(Math.min(max, Math.round((value + step) * 2) / 2))} className="h-9 w-9 items-center justify-center rounded-xl border border-ink-200 bg-white">
        <Ionicons name="add" size={16} color="#334155" />
      </Pressable>
    </View>
  );
}

/** How a leave type builds up for teachers and staff. Students never have a balance. */
export function LeaveCreditFields<T extends LeaveCreditDraft>({
  row,
  onChange,
  startMonth,
  existing,
}: {
  row: T;
  onChange: (next: T) => void;
  startMonth: number;
  /** Editing a saved type: changes apply from the next credit. */
  existing?: boolean;
}) {
  if (!row.forTeacher && !row.forStaff) {
    return (
      <View className="flex-row gap-2 rounded-xl bg-ink-50 p-3">
        <Ionicons name="information-circle-outline" size={16} color="#64748B" />
        <Text className="min-w-0 flex-1 text-[12px] leading-5 text-ink-600">
          Students don't have a leave balance. Parents apply and the class teacher approves.
        </Text>
      </View>
    );
  }
  const mode = modeOf(row);
  const meta = MODES.find((m) => m.id === mode)!;
  const amount = mode === "YEARLY" ? row.yearlyCap : Number(row.creditAmount || 0);
  const carry = (String(row.carryForward || "NONE").toUpperCase() as LeaveCarry) || "NONE";
  const set = (patch: Partial<LeaveCreditDraft>) => onChange({ ...row, ...patch });
  const yearEnd = MONTHS[(startMonth + 10) % 12];

  return (
    <View className="gap-4">
      <View>
        <Text className="mb-2 text-xs font-medium text-ink-700">How leave builds up</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {MODES.map((m) => (
            <Chip
              key={m.id}
              label={m.label}
              on={mode === m.id}
              onPress={() =>
                set(
                  m.id === "YEARLY"
                    ? { creditMode: "YEARLY", yearlyCap: row.yearlyCap || Math.round(Number(row.creditAmount || 0) * 12) }
                    : { creditMode: m.id, creditAmount: Number(row.creditAmount || 0) || (row.yearlyCap ? Math.round((row.yearlyCap / m.perYear) * 2) / 2 : 1) }
                )
              }
            />
          ))}
        </ScrollView>
      </View>

      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-medium text-ink-900">{mode === "YEARLY" ? "Days per year" : `Days per ${meta.per}`}</Text>
          <Text className="text-[11px] text-ink-500">
            {amount ? (mode === "YEARLY" ? "Given on the first day of the leave year" : `= ${num(amount * meta.perYear)} a year`) : "0 = no limit"}
          </Text>
        </View>
        <Step
          value={amount}
          step={mode === "YEARLY" ? 1 : 0.5}
          max={mode === "YEARLY" ? 365 : 31}
          onChange={(n) => set(mode === "YEARLY" ? { yearlyCap: Math.round(n) } : { creditAmount: n })}
        />
      </View>

      {amount ? (
        <>
          <View>
            <Text className="mb-2 text-xs font-medium text-ink-700">Unused leave at the end of {yearEnd}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip label="Lapses" on={carry === "NONE"} onPress={() => set({ carryForward: "NONE" })} />
              <Chip label="Carry up to…" on={carry === "CAPPED"} onPress={() => set({ carryForward: "CAPPED", carryForwardCap: row.carryForwardCap || 10 })} />
              <Chip label="Carry all" on={carry === "ALL"} onPress={() => set({ carryForward: "ALL" })} />
            </View>
            {carry === "CAPPED" ? (
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-sm text-ink-800">Most days carried into next year</Text>
                <Step value={Number(row.carryForwardCap || 0)} onChange={(n) => set({ carryForwardCap: Math.round(n) })} />
              </View>
            ) : null}
          </View>

          {mode === "YEARLY" ? (
            <Pressable onPress={() => set({ prorateJoiners: row.prorateJoiners === false })} className="flex-row items-center gap-3">
              <Ionicons name={row.prorateJoiners !== false ? "checkbox" : "square-outline"} size={20} color={row.prorateJoiners !== false ? "#1F45C7" : "#94A3B8"} />
              <View className="min-w-0 flex-1">
                <Text className="text-sm text-ink-900">New joiners get a share</Text>
                <Text className="text-[11px] text-ink-500">Joining in October gives half the yearly days</Text>
              </View>
            </Pressable>
          ) : null}

          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-medium text-ink-900">Advance allowed</Text>
              <Text className="text-[11px] text-ink-500">Days they can take before earning them</Text>
            </View>
            <Step value={Number(row.advanceDays || 0)} max={30} onChange={(n) => set({ advanceDays: Math.round(n) })} />
          </View>
        </>
      ) : null}

      {existing ? (
        <View className="flex-row gap-2 rounded-xl bg-[#FFF7E8] p-3">
          <Ionicons name="time-outline" size={16} color="#B45309" />
          <Text className="min-w-0 flex-1 text-[12px] leading-5 text-[#92400E]">
            Changes apply from the next credit. Leave already credited stays as it is.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** "Leave year starts in April" picker. */
export function LeaveYearStart({ value, onChange, disabled }: { value: number; onChange: (m: number) => void; disabled?: boolean }) {
  return (
    <View className="rounded-2xl border border-ink-200 bg-white p-3.5">
      <Text className="text-sm font-semibold text-ink-900">Leave year starts in</Text>
      <Text className="mt-0.5 text-[12px] text-ink-500">
        Credits restart, and unused leave carries over or lapses, on 1 {MONTHS[value - 1]}.
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3" contentContainerStyle={{ gap: 6 }}>
        {MONTHS.map((m, i) => (
          <Pressable
            key={m}
            disabled={disabled}
            onPress={() => onChange(i + 1)}
            className={`h-8 items-center justify-center rounded-full border px-3 ${value === i + 1 ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
          >
            <Text className={`text-[12px] font-semibold ${value === i + 1 ? "text-white" : "text-ink-700"}`}>{m.slice(0, 3)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
