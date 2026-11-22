import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal as RnModal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { act } from "../lib/mutate";
import { inr, monthTitle, shiftMonth } from "../lib/payroll";

const REASONS = ["Annual increment", "Promotion", "Probation over", "Correction"];

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Staff → profile → Revise salary. Adds a row to the person's salary history (never overwrites): new amount, the
 * month it starts from, and why. Months already paid keep the salary they were approved at.
 */
export function ReviseSalaryModal({
  open,
  token,
  person,
  onClose,
  onSaved,
}: {
  open: boolean;
  token: string | null;
  person: { kind?: string; id: string; name: string; salary?: number } | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState(thisMonth());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const phone = useWindowDimensions().width < 640;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!open) return;
    setAmount(person?.salary ? String(person.salary) : "");
    setMonth(thisMonth());
    setReason("");
    setError("");
  }, [open, person?.id]);

  const value = Math.round(Number(amount.replace(/[₹,\s]/g, "")));
  const valid = Number.isFinite(value) && value > 0;
  const change = valid && person?.salary ? value - person.salary : 0;
  const now = thisMonth();

  async function save() {
    if (!person || !valid) return;
    setBusy(true);
    setError("");
    try {
      await act(token, "reviseSalary", { kind: person.kind === "teacher" ? "teacher" : "staff", id: person.id, amount: value, effectiveFrom: month, reason });
      onSaved(`${person.name}: ${inr(value)} a month from ${monthTitle(month)}.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RnModal visible={open} transparent animationType={phone ? "slide" : "fade"} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className={`flex-1 ${phone ? "justify-end" : "items-center justify-center px-4"}`}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="absolute inset-0 bg-black/40" />
        <View className={phone ? "max-h-[92%] w-full overflow-hidden rounded-t-3xl bg-white" : "w-full max-w-[440px] overflow-hidden rounded-2xl bg-white shadow-2xl"}>
          {phone ? (
            <View className="items-center pt-2">
              <View className="h-1 w-10 rounded-full bg-ink-200" />
            </View>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
          <View className={`flex-row items-start gap-3 px-5 pb-3 ${phone ? "pt-3" : "pt-5"}`}>
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
              <Ionicons name="trending-up" size={19} color="#047857" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[17px] font-semibold text-ink-900">Revise salary</Text>
              <Text className="mt-0.5 text-[13px] text-ink-500" numberOfLines={phone ? 2 : 1}>
                {person ? `${person.name} · now ${inr(person.salary ?? 0)} a month` : ""}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose} className="h-8 w-8 items-center justify-center rounded-lg">
              <Ionicons name="close" size={18} color="#64748b" />
            </Pressable>
          </View>

          <View className="gap-4 px-5 pb-5">
            <View className="gap-1.5">
              <Text className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">New monthly salary</Text>
              <View className={`${phone ? "h-14 rounded-xl" : "h-11 rounded-lg"} flex-row items-center gap-2 border border-ink-200 bg-white px-3`}>
                <Text className={`${phone ? "text-[20px]" : "text-[15px]"} text-ink-500`}>₹</Text>
                <TextInput
                  accessibilityLabel="New monthly salary"
                  value={amount}
                  onChangeText={(t) => setAmount(t.replace(/[^\d]/g, ""))}
                  keyboardType="number-pad"
                  placeholder="e.g. 32000"
                  placeholderTextColor="#A3AEC2"
                  autoFocus={!phone}
                  className={`h-full min-w-0 flex-1 ${phone ? "text-[20px]" : "text-[15px]"} font-semibold tabular-nums text-ink-900`}
                  style={Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined}
                />
                {change ? (
                  <Text className={`text-[12px] font-semibold ${change > 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {`${change > 0 ? "+" : "−"}${inr(Math.abs(change))}`}
                  </Text>
                ) : null}
              </View>
            </View>

            <View className="gap-1.5">
              <Text className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Starts from</Text>
              <View className={`${phone ? "h-14 rounded-xl" : "h-11 rounded-lg"} flex-row items-center border border-ink-200 bg-white`}>
                <Pressable accessibilityRole="button" accessibilityLabel="Earlier month" onPress={() => setMonth((m) => shiftMonth(m, -1))} className="h-full w-11 items-center justify-center">
                  <Ionicons name="chevron-back" size={16} color="#334155" />
                </Pressable>
                <View className="flex-1 items-center">
                  <Text className="text-[14px] font-semibold text-ink-900">{monthTitle(month)}</Text>
                  <Text className="text-[11px] text-ink-500">{month === now ? "This month" : month > now ? "Later month" : "Earlier month"}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Later month" onPress={() => setMonth((m) => shiftMonth(m, 1))} className="h-full w-11 items-center justify-center">
                  <Ionicons name="chevron-forward" size={16} color="#334155" />
                </Pressable>
              </View>
              {month < now ? <Text className="text-[12px] text-amber-700">Months already approved or paid keep their salary; recalculate them if needed.</Text> : null}
              {month > now ? <Text className="text-[12px] text-ink-500">Today's salary stays the same until {monthTitle(month)}.</Text> : null}
            </View>

            <View className="gap-1.5">
              <Text className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Reason</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {REASONS.map((r) => {
                  const on = reason === r;
                  return (
                    <Pressable
                      key={r}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      onPress={() => setReason(on ? "" : r)}
                      className={`${phone ? "h-9 px-3.5" : "h-8 px-3"} justify-center rounded-full border ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                    >
                      <Text className={`text-[12px] ${on ? "font-semibold text-[#1F45C7]" : "text-ink-700"}`}>{r}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                accessibilityLabel="Reason"
                value={REASONS.includes(reason) ? "" : reason}
                onChangeText={setReason}
                placeholder="Or write your own"
                placeholderTextColor="#A3AEC2"
                className={`${phone ? "h-12 rounded-xl text-[15px]" : "h-10 rounded-lg text-[13px]"} border border-ink-200 bg-white px-3 text-ink-900`}
                style={Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined}
              />
            </View>

            {error ? <Text className="text-[12px] text-red-700">{error}</Text> : null}
          </View>
          </ScrollView>

          {phone ? (
            <View className="gap-2 border-t border-ink-100 px-5 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
              <Pressable
                accessibilityRole="button"
                disabled={!valid || busy}
                onPress={() => void save()}
                className={`h-12 items-center justify-center rounded-xl ${valid && !busy ? "bg-[#1F45C7]" : "bg-ink-200"}`}
              >
                <Text className="text-[15px] font-semibold text-white">{busy ? "Saving…" : "Save new salary"}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={onClose} className="h-11 items-center justify-center rounded-xl">
                <Text className="text-[15px] font-semibold text-ink-700">Cancel</Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-row items-center justify-end gap-2 border-t border-ink-100 px-5 py-3">
              <Pressable accessibilityRole="button" onPress={onClose} className="h-10 justify-center rounded-lg px-4">
                <Text className="text-[13px] font-semibold text-ink-700">Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!valid || busy}
                onPress={() => void save()}
                className={`h-10 justify-center rounded-lg px-4 ${valid && !busy ? "bg-[#1F45C7]" : "bg-ink-200"}`}
              >
                <Text className="text-[13px] font-semibold text-white">{busy ? "Saving…" : "Save new salary"}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </RnModal>
  );
}
