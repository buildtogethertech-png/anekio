import { useEffect, useMemo, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { KeyboardAvoidingView, Linking, Modal as RnModal, Platform, Pressable, ScrollView, Share, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { webOrigin } from "../lib/api";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";
import { Button, Field, Input, Modal } from "./ui";

const PAYMENT_METHODS = [
  { id: "CASH", label: "Cash", short: "Cash", icon: "cash-outline", hint: "Collected at the desk" },
  { id: "UPI", label: "UPI", short: "UPI", icon: "qr-code-outline", hint: "GPay / PhonePe / school QR — enter UTR" },
  { id: "RAZORPAY", label: "Pay link", short: "Pay link", icon: "link-outline", hint: "Parent pays themselves. Copy or send the link." },
  { id: "BANK", label: "Bank transfer", short: "Bank", icon: "business-outline", hint: "NEFT / IMPS — enter the UTR" },
  { id: "CHEQUE", label: "Cheque", short: "Cheque", icon: "document-text-outline", hint: "Cheque number and bank" },
] as const;

type Method = (typeof PAYMENT_METHODS)[number]["id"];
type Busy = null | "collect" | "fees" | "copy" | "whatsapp" | "call";

type OpenMonth = {
  id: string;
  title: string;
  amount: string;
  remaining: string;
  remainingAmt: number;
  lateAmt: number;
  dueNow: number;
  lateLabel: string;
  studentId: string;
  studentName: string;
  classId?: string;
};

type StudentPay = {
  id: string;
  name: string;
  classId?: string;
  classLabel: string;
  parentPhone?: string;
  parentEmail?: string;
  invoices?: {
    id: string;
    title: string;
    amount: string;
    remaining: string;
    dueNow?: number;
    late?: number;
    lateLabel?: string;
    status: string;
  }[];
};

function rupees(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function moneyOf(value?: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function dueOf(inv: NonNullable<StudentPay["invoices"]>[number]) {
  if (typeof inv.dueNow === "number") return inv.dueNow;
  return moneyOf(inv.remaining);
}

function lateOf(inv: NonNullable<StudentPay["invoices"]>[number]) {
  if (typeof inv.late === "number") return inv.late;
  const remaining = moneyOf(inv.remaining);
  return Math.max(0, dueOf(inv) - remaining);
}

function payRangeLabel(titles: string[]) {
  const months = titles.map((title) => title.split(" · ")[0]?.trim() || title).filter(Boolean);
  if (!months.length) return "Selected months";
  if (months.length === 1) return months[0];
  return `${months[0]} to ${months[months.length - 1]}`;
}

function whatsAppDigits(raw?: string | null) {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return "";
}

function channelHint(opts: { wa: boolean }) {
  if (!opts.wa) return "Add the parent phone to enable WhatsApp and call.";
  return "Opens WhatsApp or phone on this device with the selected pay link.";
}

function payLinkText(opts: { studentName: string; range: string; due: number; url: string }) {
  return `Dear Parent,

This is a reminder that the school fee for ${opts.studentName} (${opts.range}) is pending.

Amount due: ${rupees(opts.due)}

Please complete the payment using this secure link:
${opts.url}

If you have already paid, please ignore this message.

Thank you.`;
}

export function GeneratePayment({
  open,
  student,
  students,
  title,
  startMethod,
  onClose,
  onDone,
}: {
  startMethod?: "CASH" | "UPI" | "RAZORPAY" | "BANK" | "CHEQUE";
  open: boolean;
  student: StudentPay | null;
  students?: StudentPay[];
  title?: string;
  onClose: () => void;
  onDone: (message: string) => Promise<void> | void;
}) {
  const { token, user } = useSession();
  const [picked, setPicked] = useState<string[]>([]);
  const [method, setMethod] = useState<Method>("CASH");
  const [reference, setReference] = useState("");
  const [collectedBy, setCollectedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [editBy, setEditBy] = useState(false);
  const [done, setDone] = useState<null | { message: string; amount: number; method: string; range: string; when: string }>(null);
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const roster = students?.length ? students : student ? [student] : [];
  const lead = roster[0] || null;

  const months: OpenMonth[] = useMemo(
    () =>
      roster.flatMap((row) =>
        (row.invoices ?? [])
          .map((inv) => ({
            id: inv.id,
            title: roster.length > 1 ? `${row.name} · ${inv.title}` : inv.title,
            amount: inv.amount,
            remaining: inv.remaining,
            remainingAmt: moneyOf(inv.remaining),
            lateAmt: lateOf(inv),
            dueNow: dueOf(inv),
            lateLabel: inv.lateLabel || "",
            studentId: row.id,
            studentName: row.name,
            classId: row.classId,
          }))
          .filter((m) => m.dueNow > 0)
      ),
    [roster]
  );
  const selected = months.filter((m) => picked.includes(m.id));
  const due = selected.reduce((sum, m) => sum + m.dueNow, 0);
  const current = PAYMENT_METHODS.find((m) => m.id === method)!;
  const wa = whatsAppDigits(lead?.parentPhone);
  const heading = title || (roster.length > 1 ? `Payment · ${roster.length} children` : lead ? `Payment · ${lead.name}` : "Payment");

  useEffect(() => {
    if (!open) return;
    setPicked(months.map((m) => m.id));
    setMethod(startMethod || "CASH");
    setReference("");
    setCollectedBy(user?.name || "");
    setNotes("");
    setBusy(null);
    setCopied(false);
    setError("");
    setShowNote(false);
    setEditBy(false);
    setDone(null);
  }, [open, lead?.id, months.length, user?.name, startMethod]);

  function toggle(id: string) {
    setPicked((ids) => (ids.includes(id) ? ids.filter((row) => row !== id) : [...ids, id]));
  }

  async function runFees() {
    const classIds = [...new Set(roster.map((row) => row.classId).filter(Boolean))];
    if (!classIds.length) return;
    setBusy("fees");
    setError("");
    try {
      for (const classId of classIds) {
        await act(token, "issueDueFees", { classId });
      }
      await onDone("Fees issued.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not run fees.");
    } finally {
      setBusy(null);
    }
  }

  async function collect() {
    if (!selected.length || method === "RAZORPAY") return;
    if (!collectedBy.trim()) {
      setError("Enter who collected or recorded this payment.");
      return;
    }
    setBusy("collect");
    setError("");
    try {
      const groups = new Map<string, string[]>();
      for (const m of selected) {
        groups.set(m.studentId, [...(groups.get(m.studentId) || []), m.id]);
      }
      for (const [studentId, invoiceIds] of groups) {
        await act(token, "collectPartialFees", {
          studentId,
          invoiceIds,
          method,
          reference: reference.trim() || undefined,
          collectedBy: collectedBy.trim() || undefined,
          notes: notes.trim() || undefined,
        });
      }
      const message = selected.length === 1 ? "Collected 1 month." : `Collected ${selected.length} months.`;
      if (phone) {
        setDone({
          message,
          amount: due,
          method: current.label,
          range: payRangeLabel(selected.map((m) => m.title)),
          when: new Date().toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
        });
      } else {
        await onDone(message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not collect.");
    } finally {
      setBusy(null);
    }
  }

  async function payUrl() {
    const ids = [...new Set(selected.map((m) => m.studentId))];
    if (ids.length !== 1) throw new Error("Pay link is one child at a time. Untick the other children.");
    const res = await act<{ ok: true; path: string }>(token, "ensurePayLink", {
      studentId: ids[0],
      invoiceIds: selected.map((m) => m.id),
    });
    if (!res.path) throw new Error("Could not open pay link");
    return `${webOrigin()}${res.path}`;
  }

  async function copyLink() {
    if (!selected.length) return;
    setBusy("copy");
    setError("");
    try {
      const url = await payUrl();
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      } else {
        await Share.share({ message: url, url });
        setCopied(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not copy.");
    } finally {
      setBusy(null);
    }
  }

  async function sendWhatsApp() {
    if (!lead || !selected.length) return;
    setBusy("whatsapp");
    setError("");
    try {
      const ids = [...new Set(selected.map((m) => m.studentId))];
      if (ids.length !== 1) throw new Error("Pay link is one child at a time. Untick the other children.");
      if (!wa) throw new Error("Add the parent phone on this student first");
      const url = await payUrl();
      const text = payLinkText({
        studentName: lead.name,
        range: payRangeLabel(selected.map((m) => m.title)),
        due,
        url,
      });
      await Linking.openURL(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "WhatsApp could not send");
    } finally {
      setBusy(null);
    }
  }

  async function callParent() {
    if (!lead) return;
    setBusy("call");
    setError("");
    try {
      if (!wa) throw new Error("Add the parent phone on this student first");
      await Linking.openURL(`tel:+${wa}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start call");
    } finally {
      setBusy(null);
    }
  }

  const monthWord = selected.length === 1 ? "month" : "months";
  const locked = busy !== null;
  const copyLabel = busy === "copy" ? "Copying" : copied ? "Copied" : "Copy";
  const waLabel = busy === "whatsapp" ? "Opening" : "WhatsApp";
  const callLabel = busy === "call" ? "Calling" : "Call";
  const collectLabel = busy === "collect" ? "Collecting…" : `Collect ${selected.length} ${monthWord}`;
  const manualReady = method === "RAZORPAY" || Boolean(collectedBy.trim());

  if (phone) {
    const receiptText = done
      ? `Dear Parent,\n\nWe have received ${rupees(done.amount)} towards the school fee for ${lead?.name || "your child"} (${done.range}).\n\nMode: ${done.method}\nDate: ${done.when}\n\nThank you.`
      : "";
    const finish = async () => {
      const message = done?.message || "";
      setDone(null);
      await onDone(message);
    };
    const sub = lead ? [lead.classLabel, roster.length > 1 ? `${roster.length} children` : ""].filter(Boolean).join(" · ") : "";
    const allOn = months.length > 0 && picked.length === months.length;
    const lateTotal = selected.reduce((sum, m) => sum + m.lateAmt, 0);
    const needsRef = method === "UPI" || method === "BANK" || method === "CHEQUE";
    return (
      <RnModal visible={open} transparent animationType="slide" onRequestClose={done ? () => void finish() : onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="absolute inset-0 bg-black/40"
            onPress={done ? () => void finish() : onClose}
          />
          <View className="max-h-[92%] rounded-t-3xl bg-white" style={{ maxHeight: "92%" }}>
            <SafeAreaView edges={["bottom"]}>
              <View className="items-center pt-2">
                <View className="h-1 w-10 rounded-full bg-ink-200" />
              </View>
              {done ? (
                <View className="items-center px-5 pb-4 pt-6">
                  <View className="h-16 w-16 items-center justify-center rounded-full bg-green-100">
                    <Ionicons name="checkmark" size={36} color="#15803d" />
                  </View>
                  <Text className="mt-4 text-[28px] font-bold text-ink-900">{rupees(done.amount)}</Text>
                  <Text className="mt-1 text-sm text-ink-600">received from {lead?.name}</Text>
                  <Text className="mt-0.5 text-xs text-ink-500">
                    {done.range} · {done.method} · {done.when}
                  </Text>
                  <View className="mt-6 w-full gap-2">
                    {wa ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void Linking.openURL(`https://wa.me/${wa}?text=${encodeURIComponent(receiptText)}`)}
                        className="h-12 flex-row items-center justify-center gap-2 rounded-xl bg-green-600"
                      >
                        <Ionicons name="logo-whatsapp" size={18} color="#fff" />
                        <Text className="text-[15px] font-semibold text-white">Send receipt on WhatsApp</Text>
                      </Pressable>
                    ) : null}
                    {Platform.OS !== "web" || (typeof navigator !== "undefined" && "share" in navigator) ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void Share.share({ message: receiptText }).catch(() => undefined)}
                        className="h-12 flex-row items-center justify-center gap-2 rounded-xl border border-ink-200"
                      >
                        <Ionicons name="share-outline" size={18} color="#1F45C7" />
                        <Text className="text-[15px] font-semibold text-[#1F45C7]">Share receipt</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void finish()}
                      className="h-12 items-center justify-center rounded-xl"
                    >
                      <Text className="text-[15px] font-semibold text-ink-700">Done</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <>
                  <View className="flex-row items-start gap-3 px-5 pb-2 pt-3">
                    <View className="min-w-0 flex-1">
                      <Text className="text-lg font-semibold text-ink-900" numberOfLines={1}>
                        {roster.length > 1 ? `${roster.length} children` : lead?.name || "Payment"}
                      </Text>
                      {sub ? <Text className="text-xs text-ink-500">{sub}</Text> : null}
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full bg-ink-100">
                      <Ionicons name="close" size={18} color="#3d4f66" />
                    </Pressable>
                  </View>

                  {months.length ? (
                    <>
                      <ScrollView className="px-5" contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
                        <View className="items-center py-3">
                          <Text className="text-[34px] font-bold leading-10 text-ink-900">{rupees(due)}</Text>
                          <Text className="mt-0.5 text-xs text-ink-500">
                            {selected.length} {monthWord}
                            {lateTotal ? ` · includes ${rupees(lateTotal)} late` : ""}
                          </Text>
                        </View>

                        <View className="mb-1 flex-row items-center justify-between">
                          <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">Months</Text>
                          {months.length > 1 ? (
                            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setPicked(allOn ? [] : months.map((m) => m.id))}>
                              <Text className="text-xs font-semibold text-[#1F45C7]">{allOn ? "Clear" : "Select all"}</Text>
                            </Pressable>
                          ) : null}
                        </View>
                        <View className="overflow-hidden rounded-xl border border-ink-100">
                          {months.map((inv, i) => {
                            const on = picked.includes(inv.id);
                            return (
                              <Pressable
                                key={inv.id}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: on }}
                                disabled={locked}
                                onPress={() => toggle(inv.id)}
                                className={`flex-row items-center gap-3 px-3 py-3 ${i ? "border-t border-ink-100" : ""} ${on ? "bg-[#EEF3FF]/50" : ""}`}
                              >
                                <View className={`h-5 w-5 items-center justify-center rounded-md border-2 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-300 bg-white"}`}>
                                  {on ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                                </View>
                                <View className="min-w-0 flex-1">
                                  <Text numberOfLines={1} className="text-sm font-medium text-ink-900">{inv.title}</Text>
                                  {inv.lateAmt ? (
                                    <Text className="mt-0.5 text-xs text-ink-500">
                                      Fee {rupees(inv.remainingAmt)} · <Text className="text-amber-700">Late {rupees(inv.lateAmt)}</Text>
                                    </Text>
                                  ) : null}
                                </View>
                                <Text className="text-sm font-semibold text-ink-900">{rupees(inv.dueNow)}</Text>
                              </Pressable>
                            );
                          })}
                        </View>

                        <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-500">Paid by</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
                          {PAYMENT_METHODS.map((m) => {
                            const on = method === m.id;
                            return (
                              <Pressable
                                key={m.id}
                                accessibilityRole="button"
                                accessibilityState={{ selected: on }}
                                disabled={locked}
                                onPress={() => {
                                  setMethod(m.id);
                                  setReference("");
                                  setCopied(false);
                                  setError("");
                                }}
                                className={`h-[64px] w-[76px] items-center justify-center gap-1 rounded-xl border ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                              >
                                <Ionicons name={m.icon as keyof typeof Ionicons.glyphMap} size={20} color={on ? "#1F45C7" : "#475569"} />
                                <Text className={`text-xs font-medium ${on ? "text-[#1F45C7]" : "text-ink-700"}`}>{m.short}</Text>
                              </Pressable>
                            );
                          })}
                        </ScrollView>

                        {needsRef ? (
                          <TextInput
                            value={reference}
                            onChangeText={setReference}
                            editable={!locked}
                            placeholder={method === "CHEQUE" ? "Cheque no. · bank" : "UTR / reference no."}
                            placeholderTextColor="#94a3b8"
                            className="mt-3 rounded-xl border border-ink-200 px-3 py-3 text-sm text-ink-900"
                            style={{ includeFontPadding: false }}
                          />
                        ) : null}

                        {method === "RAZORPAY" ? (
                          <View className="mt-3 gap-2 rounded-xl border border-ink-100 bg-ink-50 p-3">
                            <Text className="text-sm text-ink-800">
                              Parent pays the {selected.length} {monthWord} ticked above.
                            </Text>
                            <View className="flex-row gap-2">
                              <PayLinkAction icon={copied ? "checkmark" : "copy-outline"} label={copyLabel} disabled={!selected.length || locked} onPress={copyLink} />
                              <PayLinkAction icon="logo-whatsapp" label={waLabel} disabled={!selected.length || locked || !wa} onPress={sendWhatsApp} color="#16a34a" />
                              <PayLinkAction icon="call-outline" label={callLabel} disabled={locked || !wa} onPress={callParent} />
                            </View>
                            {!wa ? <Text className="text-[11px] text-ink-600">{channelHint({ wa: false })}</Text> : null}
                          </View>
                        ) : (
                          <View className="mt-3 gap-2">
                            {showNote ? (
                              <TextInput
                                value={notes}
                                onChangeText={setNotes}
                                editable={!locked}
                                autoFocus
                                placeholder="Receipt note"
                                placeholderTextColor="#94a3b8"
                                className="rounded-xl border border-ink-200 px-3 py-3 text-sm text-ink-900"
                                style={{ includeFontPadding: false }}
                              />
                            ) : null}
                            {editBy ? (
                              <TextInput
                                value={collectedBy}
                                onChangeText={setCollectedBy}
                                editable={!locked}
                                placeholder="Collected by"
                                placeholderTextColor="#94a3b8"
                                className="rounded-xl border border-ink-200 px-3 py-3 text-sm text-ink-900"
                                style={{ includeFontPadding: false }}
                              />
                            ) : null}
                            <View className="flex-row items-center justify-between">
                              {!showNote ? (
                                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setShowNote(true)}>
                                  <Text className="text-sm font-medium text-[#1F45C7]">+ Add note</Text>
                                </Pressable>
                              ) : (
                                <View />
                              )}
                              {!editBy ? (
                                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setEditBy(true)}>
                                  <Text className="text-xs text-ink-500">
                                    Recorded by {collectedBy || "—"} · <Text className="text-[#1F45C7]">Change</Text>
                                  </Text>
                                </Pressable>
                              ) : null}
                            </View>
                          </View>
                        )}

                        {error ? <Text className="mt-3 text-sm text-red-700">{error}</Text> : null}
                      </ScrollView>

                      {method !== "RAZORPAY" ? (
                        <View className="border-t border-ink-100 px-5 pb-2 pt-3">
                          <Pressable
                            accessibilityRole="button"
                            disabled={!selected.length || locked || !manualReady}
                            onPress={collect}
                            className={`h-12 items-center justify-center rounded-xl ${!selected.length || locked || !manualReady ? "bg-ink-200" : "bg-[#1F45C7]"}`}
                          >
                            <Text className="text-[15px] font-semibold text-white">
                              {busy === "collect"
                                ? "Collecting…"
                                : selected.length
                                  ? `Collect ${rupees(due)} · ${current.short}`
                                  : "Tick a month to collect"}
                            </Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <View className="gap-4 px-5 pb-4 pt-2">
                      <Text className="text-sm text-ink-700">
                        No bills yet. Run fees for {lead?.classLabel || "their class"} to create months through today, then collect.
                      </Text>
                      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
                      <Pressable
                        accessibilityRole="button"
                        disabled={locked}
                        onPress={runFees}
                        className="h-12 items-center justify-center rounded-xl bg-[#1F45C7]"
                      >
                        <Text className="text-[15px] font-semibold text-white">{busy === "fees" ? "Running…" : "Run fees now"}</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              )}
            </SafeAreaView>
          </View>
        </KeyboardAvoidingView>
      </RnModal>
    );
  }

  return (
    <Modal open={open} title={heading} onClose={onClose} wide>
      {months.length ? (
        <View className="gap-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm text-ink-700">Tick the months to collect.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPicked(picked.length === months.length ? [] : months.map((m) => m.id))}
            >
              <Text className="text-xs font-semibold text-blue-700">
                {picked.length === months.length ? "Clear all" : "Select all"}
              </Text>
            </Pressable>
          </View>
          <View className="overflow-hidden rounded-md border border-ink-200">
            {months.map((inv, i) => {
              const on = picked.includes(inv.id);
              return (
                <Pressable
                  key={inv.id}
                  disabled={locked}
                  onPress={() => toggle(inv.id)}
                  className={`flex-row items-start justify-between gap-3 px-3 py-2.5 ${
                    i ? "border-t border-ink-100" : ""
                  }`}
                >
                  <View className="min-w-0 flex-1 flex-row items-start gap-2">
                    <View
                      className={`mt-0.5 h-4 w-4 rounded border ${
                        on ? "border-clay-500 bg-clay-500" : "border-ink-300 bg-white"
                      }`}
                    />
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="text-sm font-medium text-ink-900">{inv.title}</Text>
                      <Text className="mt-0.5 text-xs leading-4 text-ink-600">
                        Fee {rupees(inv.remainingAmt)}
                        {inv.lateAmt ? ` · Late ${rupees(inv.lateAmt)}` : ""}
                      </Text>
                    </View>
                  </View>
                  <Text className="shrink-0 text-sm font-semibold text-ink-900">{rupees(inv.dueNow)}</Text>
                </Pressable>
              );
            })}
            <View className="flex-row justify-between border-t border-ink-100 px-3 py-2.5">
              <Text className="text-sm font-semibold text-ink-900">
                {selected.length} {monthWord}
              </Text>
              <Text className="text-sm font-semibold text-ink-900">{rupees(due)}</Text>
            </View>
          </View>

          <View className="flex-row flex-wrap gap-1.5">
            {PAYMENT_METHODS.map((m) => {
              const on = method === m.id;
              return (
                <Pressable
                  key={m.id}
                  disabled={locked}
                  onPress={() => {
                    setMethod(m.id);
                    setCopied(false);
                    setError("");
                  }}
                  className={`rounded-md border px-2.5 py-1.5 ${
                    on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"
                  }`}
                >
                  <Text className={`text-xs ${on ? "text-white" : "text-ink-800"}`}>{m.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text className="text-xs text-ink-700">{current.hint}</Text>

          {method === "UPI" || method === "BANK" ? (
            <Field label="UTR / reference">
              <Input
                value={reference}
                onChangeText={setReference}
                placeholder="12-digit UTR"
                editable={!locked}
              />
            </Field>
          ) : null}
          {method === "CHEQUE" ? (
            <Field label="Cheque number">
              <Input
                value={reference}
                onChangeText={setReference}
                placeholder="Cheque no. · bank"
                editable={!locked}
              />
            </Field>
          ) : null}
          {method === "RAZORPAY" ? (
            <View className="gap-2 rounded-md border border-ink-100 bg-white px-3 py-2.5">
              <Text className="text-sm text-ink-800">
                Parent pays only the {selected.length} {monthWord} ticked above.
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <PayLinkAction
                  icon={copied ? "checkmark" : "copy-outline"}
                  label={copyLabel}
                  disabled={!selected.length || locked}
                  onPress={copyLink}
                />
                <PayLinkAction
                  icon="logo-whatsapp"
                  label={waLabel}
                  disabled={!selected.length || locked || !wa}
                  onPress={sendWhatsApp}
                  color="#16a34a"
                />
                <PayLinkAction icon="call-outline" label={callLabel} disabled={locked || !wa} onPress={callParent} />
              </View>
              <Text className="text-[11px] text-ink-700">
                {channelHint({ wa: Boolean(wa) })}
              </Text>
            </View>
          ) : null}
          {method !== "RAZORPAY" ? (
            <View className="gap-3">
              <Field label="Collected by">
                <Input value={collectedBy} onChangeText={setCollectedBy} placeholder="Name of staff / counter" editable={!locked} />
              </Field>
              <Field label="Note">
                <Input value={notes} onChangeText={setNotes} placeholder="Optional receipt note" editable={!locked} />
              </Field>
            </View>
          ) : null}

          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}

          <View className="flex-row flex-wrap justify-end gap-2">
            <Button className="px-3 py-2" variant="ghost" onPress={onClose}>
              Cancel
            </Button>
            {method === "RAZORPAY" ? null : (
              <>
                <Button
                  variant="ghost"
                  className="px-3 py-2"
                  disabled={!lead || locked || !manualReady}
                  onPress={async () => {
                    if (!lead) return;
                    if (!collectedBy.trim()) {
                      setError("Enter who collected or recorded this payment.");
                      return;
                    }
                    setBusy("collect");
                    setError("");
                    try {
                      await act(token, "collectAllStudentFees", {
                        studentId: lead.id,
                        method,
                        reference: reference.trim() || undefined,
                        collectedBy: collectedBy.trim() || undefined,
                        notes: notes.trim() || "Full payment",
                      });
                      await onDone("Collected all due.");
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Could not collect.");
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Collect all due
                </Button>
                <Button className="px-3 py-2" disabled={!selected.length || locked || !manualReady} onPress={collect}>
                  {collectLabel}
                </Button>
              </>
            )}
          </View>
        </View>
      ) : (
        <View className="gap-4">
          <Text className="text-sm text-ink-700">
            No bills yet. Run fees for {lead?.classLabel || "their class"} to create months through today, then collect.
          </Text>
          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button className="px-3 py-2" variant="ghost" onPress={onClose}>
              Cancel
            </Button>
            <Button className="px-3 py-2" disabled={locked} onPress={runFees}>
              {busy === "fees" ? "Running…" : "Run fees now"}
            </Button>
          </View>
        </View>
      )}
    </Modal>
  );
}

function PayLinkAction({
  icon,
  label,
  disabled,
  onPress,
  color = "#183153",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled?: boolean;
  onPress: () => void;
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`min-w-[92px] flex-row items-center justify-center gap-1.5 rounded-md border border-ink-200 bg-ink-50 px-2.5 py-2 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <Ionicons name={icon} size={17} color={disabled ? "#64748b" : color} />
      <Text className="text-xs font-medium text-ink-800">{label}</Text>
    </Pressable>
  );
}
