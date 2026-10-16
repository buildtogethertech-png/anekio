import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";

/**
 * Phone-first "Review & Finalize Payment" sheet (replaces the centred popup).
 *
 * Standalone draft: the Pay tab passes the numbers in. Wire it where the old
 * modal opens. Field names match the existing screen.
 */

export type ReviewFinalizeProps = {
  open: boolean;
  employee: string;
  month: string; // "September 2026"
  workingDays: number;
  present: number;
  absent: number;
  leave: number;
  payableDays: number; // 30 for calendar basis
  salaryBasis: string; // "Calendar days (30)"
  monthlySalary: number;
  dailySalary: number;
  attendanceAdjustment: number; // negative = deduction
  otherAdjustment: number;
  finalPayable: number;
  onApprove: () => Promise<void> | void;
  onSaveAsPending: () => Promise<void> | void;
  onClose: () => void;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const inr2 = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number) => (n === 0 ? "₹0" : `${n < 0 ? "− " : "+ "}${inr(Math.abs(n))}`);

export function ReviewFinalizeSheet(p: ReviewFinalizeProps) {
  const [busy, setBusy] = useState<"" | "approve" | "pending">("");
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  // Paid days that are not worked days: weekly offs and holidays, paid on this basis.
  const paidOffs = Math.max(0, p.payableDays - p.workingDays);
  const accounted = p.present + p.absent + p.leave + paidOffs;
  const reconciles = accounted === p.payableDays;

  const run = async (kind: "approve" | "pending", fn: () => Promise<void> | void) => {
    setBusy(kind);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy("");
    }
  };

  const canApprove = confirmed && reconciles && !busy;

  return (
    <Modal visible={p.open} animationType="slide" transparent onRequestClose={p.onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" accessibilityLabel="Close" onPress={() => !busy && p.onClose()} />
        <View className="max-h-[92%] rounded-t-3xl bg-white">
          <View className="items-center pt-2">
            <View className="h-1 w-10 rounded-full bg-slate-300" />
          </View>

          {/* Header */}
          <View className="flex-row items-start justify-between px-5 pb-2 pt-3">
            <View className="min-w-0 flex-1 pr-3">
              <Text className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Review & finalize</Text>
              <Text className="mt-0.5 text-[18px] font-semibold text-slate-900" numberOfLines={1}>
                {p.employee}
              </Text>
              <Text className="text-[13px] text-slate-500">{p.month}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={() => !busy && p.onClose()}>
              <Text className="text-[15px] font-medium text-slate-500">Close</Text>
            </Pressable>
          </View>

          <ScrollView className="px-5" contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
            {/* Hero */}
            <View className="rounded-2xl bg-[#EEF3FF] p-4">
              <Text className="text-[12px] font-semibold uppercase tracking-wide text-[#1F45C7]">Final payable</Text>
              <Text className="mt-1 text-[34px] font-bold text-slate-900" accessibilityLabel={`Final payable ${inr(p.finalPayable)}`}>
                {inr(p.finalPayable)}
              </Text>
              <Text className="mt-1 text-[13px] text-slate-600">
                {`${inr2(p.dailySalary)} a day × ${p.payableDays} payable days, plus adjustments`}
              </Text>
            </View>

            {/* Days */}
            <Section title="Days">
              <Row label="Working days" value={`${p.workingDays}`} />
              <Row label="Present" value={`${p.present}`} />
              <Row label="Absent" value={`${p.absent}`} />
              <Row label="Leave" value={`${p.leave}`} />
              <Row label="Paid weekly offs and holidays" value={`${paidOffs}`} />
              <Row label="Payable days" value={`${p.payableDays}`} strong />
              <Text className="px-4 pb-3 pt-1 text-[12px] text-slate-500">{`Salary basis: ${p.salaryBasis}`}</Text>
              {!reconciles ? (
                <Text className="px-4 pb-3 text-[13px] text-red-700">
                  {`Days don't add up: present, absent, leave and paid offs make ${accounted}, not ${p.payableDays}. Fix attendance before approving.`}
                </Text>
              ) : null}
            </Section>

            {/* Money */}
            <Section title="Amount">
              <Row label="Monthly salary" value={inr(p.monthlySalary)} />
              <Row label="Daily salary" value={inr2(p.dailySalary)} />
              <Row label="Attendance adjustment" value={signed(p.attendanceAdjustment)} muted />
              <Row label="Other adjustments" value={signed(p.otherAdjustment)} muted />
              <Row label="Final payable" value={inr(p.finalPayable)} strong />
            </Section>

            {/* Confirmation */}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: confirmed }}
              onPress={() => setConfirmed((v) => !v)}
              className="mt-4 flex-row items-start gap-3 rounded-xl border border-slate-200 p-3"
            >
              <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${confirmed ? "border-[#2855F6] bg-[#2855F6]" : "border-slate-300 bg-white"}`}>
                {confirmed ? <Text className="text-[12px] font-bold text-white">✓</Text> : null}
              </View>
              <Text className="min-w-0 flex-1 text-[13px] leading-5 text-slate-700">
                {`I've checked the days and amounts. Approving locks ${p.month}; changes after that need a reversal.`}
              </Text>
            </Pressable>

            {error ? <Text className="mt-3 text-[13px] text-red-700">{error}</Text> : null}
          </ScrollView>

          {/* Sticky footer: two actions, approve is primary */}
          <View className="flex-row gap-3 border-t border-slate-100 bg-white px-5 pb-8 pt-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save as pending"
              disabled={!!busy}
              onPress={() => run("pending", p.onSaveAsPending)}
              className="h-14 flex-1 items-center justify-center rounded-2xl border border-slate-300 bg-white"
            >
              {busy === "pending" ? (
                <ActivityIndicator color="#334155" />
              ) : (
                <Text className="text-[15px] font-semibold text-slate-700">Save as pending</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Approve payment"
              disabled={!canApprove}
              onPress={() => run("approve", p.onApprove)}
              className={`h-14 flex-[1.4] items-center justify-center rounded-2xl ${canApprove ? "bg-[#2855F6]" : "bg-slate-200"}`}
            >
              {busy === "approve" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className={`text-[15px] font-semibold ${canApprove ? "text-white" : "text-slate-500"}`}>Approve payment</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-4">
      <Text className="mb-2 text-[13px] font-semibold text-slate-700">{title}</Text>
      <View className="rounded-xl border border-slate-200">{children}</View>
    </View>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <View className="flex-row items-center justify-between border-b border-slate-100 px-4 py-3 last:border-b-0">
      <Text className={`min-w-0 flex-1 pr-3 text-[14px] ${strong ? "font-semibold text-slate-900" : muted ? "text-slate-500" : "text-slate-700"}`}>
        {label}
      </Text>
      <Text className={`text-[14px] ${strong ? "font-semibold text-slate-900" : "text-slate-900"}`}>{value}</Text>
    </View>
  );
}
