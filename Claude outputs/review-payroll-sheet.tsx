import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";

/**
 * Phone-first "Review & approve salary" sheet.
 *
 * Drop-in draft: it does not read any data itself. The Pay tab passes the
 * numbers in and gets `onApprove` called when the user confirms.
 * Wire it where the old "Review & Finalize Payment" modal is opened.
 */

export type PayrollReviewProps = {
  open: boolean;
  monthLabel: string; // e.g. "June 2026"
  personName: string;
  workedDays: number; // days actually worked (present + half days counted as worked)
  paidOffDays: number; // weekly offs + holidays that are paid
  payableDays: number; // must equal workedDays + paidOffDays
  basis: string; // e.g. "Calendar days" | "Fixed salary" | "Working days"
  gross: number;
  deductions: { label: string; amount: number }[];
  net: number;
  alreadyPaid?: number; // optional: shown only when > 0
  onApprove: () => Promise<void> | void;
  onClose: () => void;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function ReviewPayrollSheet(p: PayrollReviewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  // The sheet is only valid when the days reconcile. Shown on screen so nobody has to check by hand.
  const reconciles = p.workedDays + p.paidOffDays === p.payableDays;
  const canApprove = confirmed && reconciles && !busy;

  const close = () => {
    if (busy) return;
    setConfirmed(false);
    setError("");
    p.onClose();
  };

  return (
    <Modal visible={p.open} animationType="slide" transparent onRequestClose={close}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable className="flex-1" accessibilityLabel="Close" onPress={close} />
        <View className="max-h-[92%] rounded-t-3xl bg-white">
          {/* Handle + header */}
          <View className="items-center pt-2">
            <View className="h-1 w-10 rounded-full bg-ink-200" />
          </View>
          <View className="flex-row items-start justify-between px-5 pb-3 pt-3">
            <View className="min-w-0 flex-1 pr-3">
              <Text className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">Review salary</Text>
              <Text className="mt-0.5 text-[18px] font-semibold text-ink-900" numberOfLines={1}>
                {p.personName}
              </Text>
              <Text className="text-[13px] text-ink-500">{p.monthLabel}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={close}>
              <Text className="text-[15px] font-medium text-ink-500">Close</Text>
            </Pressable>
          </View>

          <ScrollView className="px-5" contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            {/* Hero: net pay */}
            <View className="rounded-2xl bg-[#EEF3FF] p-4">
              <Text className="text-[12px] font-semibold uppercase tracking-wide text-[#1F45C7]">Net pay to be paid</Text>
              <Text className="mt-1 text-[32px] font-bold text-ink-900" accessibilityLabel={`Net pay ${inr(p.net)}`}>
                {inr(p.net)}
              </Text>
              {p.alreadyPaid && p.alreadyPaid > 0 ? (
                <Text className="mt-1 text-[13px] text-ink-700">{`${inr(p.alreadyPaid)} already paid this month`}</Text>
              ) : null}
            </View>

            {/* Days, reconciled */}
            <View className="mt-4">
              <Text className="text-[13px] font-semibold text-ink-700">Days</Text>
              <View className="mt-2 rounded-xl border border-ink-200">
                <Row label="Worked" value={`${p.workedDays}`} />
                <Row label="Paid offs and holidays" value={`${p.paidOffDays}`} />
                <Row label="Total payable" value={`${p.payableDays}`} strong />
              </View>
              <Text className="mt-2 text-[12px] text-ink-500">{`Basis: ${p.basis}`}</Text>
              {!reconciles ? (
                <Text className="mt-2 text-[13px] text-red-700">
                  {`Days don't add up (${p.workedDays} + ${p.paidOffDays} ≠ ${p.payableDays}). Fix attendance before approving.`}
                </Text>
              ) : null}
            </View>

            {/* Breakdown */}
            <View className="mt-4">
              <Text className="text-[13px] font-semibold text-ink-700">Breakdown</Text>
              <View className="mt-2 rounded-xl border border-ink-200">
                <Row label="Gross salary" value={inr(p.gross)} />
                {p.deductions.map((d) => (
                  <Row key={d.label} label={d.label} value={`− ${inr(d.amount)}`} muted />
                ))}
                <Row label="Net pay" value={inr(p.net)} strong />
              </View>
            </View>

            {/* Irreversible-action confirmation */}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: confirmed }}
              onPress={() => setConfirmed((v) => !v)}
              className="mt-5 flex-row items-start gap-3 rounded-xl border border-ink-200 p-3"
            >
              <View
                className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${
                  confirmed ? "border-[#2855F6] bg-[#2855F6]" : "border-ink-300 bg-white"
                }`}
              >
                {confirmed ? <Text className="text-[12px] font-bold text-white">✓</Text> : null}
              </View>
              <Text className="min-w-0 flex-1 text-[13px] leading-5 text-ink-700">
                I have checked these days and amounts. Approving locks {p.monthLabel}. Changes after that need a reversal.
              </Text>
            </Pressable>

            {error ? <Text className="mt-3 text-[13px] text-red-700">{error}</Text> : null}
          </ScrollView>

          {/* Sticky footer */}
          <View className="border-t border-ink-100 bg-white px-5 pb-8 pt-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Approve and lock ${p.monthLabel}`}
              disabled={!canApprove}
              onPress={async () => {
                setBusy(true);
                setError("");
                try {
                  await p.onApprove();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not approve. Try again.");
                } finally {
                  setBusy(false);
                }
              }}
              className={`h-14 items-center justify-center rounded-2xl ${canApprove ? "bg-[#2855F6]" : "bg-ink-200"}`}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className={`text-[16px] font-semibold ${canApprove ? "text-white" : "text-ink-500"}`}>
                  {`Approve and lock ${p.monthLabel}`}
                </Text>
              )}
            </Pressable>
            {!confirmed ? (
              <Text className="mt-2 text-center text-[12px] text-ink-500">Tick the box above to enable approval.</Text>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <View className="flex-row items-center justify-between border-b border-ink-100 px-4 py-3 last:border-b-0">
      <Text className={`min-w-0 flex-1 pr-3 text-[14px] ${strong ? "font-semibold text-ink-900" : muted ? "text-ink-600" : "text-ink-700"}`}>
        {label}
      </Text>
      <Text className={`text-[14px] ${strong ? "font-semibold text-ink-900" : muted ? "text-ink-600" : "text-ink-900"}`}>{value}</Text>
    </View>
  );
}
