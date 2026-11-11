import { useEffect, useMemo, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { KeyboardAvoidingView, Linking, Modal as RnModal, Platform, Pressable, ScrollView, Share, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { webOrigin } from "../lib/api";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";
import { Button, Field, Input, Modal } from "./ui";
import { ProofAttach } from "./salary-pay-sheet";
import { uploadFile, type PickedFile } from "../lib/upload";
import { receiptMessage, receiptPdfUrl, sendReceiptOnWhatsApp, shareReceiptPdf } from "../lib/receipt-share";

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
  dueAt: string;
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
    dueAt?: string;
  }[];
};

/** How an amount is spread over the ticked months: oldest due date first, the last may be part paid. */
export function splitPayment(months: { id: string; dueNow: number; dueAt: string }[], amount: number) {
  let left = Math.max(0, Math.round(amount));
  return [...months]
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .map((m) => {
      const pay = Math.min(left, m.dueNow);
      left -= pay;
      return { id: m.id, pay, full: pay >= m.dueNow };
    })
    .filter((row) => row.pay > 0);
}

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

export function payRangeLabel(titles: string[]) {
  const months = titles.map((title) => title.split(" · ")[0]?.trim() || title).filter(Boolean);
  if (!months.length) return "Selected months";
  if (months.length === 1) return months[0];
  return `${months[0]} to ${months[months.length - 1]}`;
}

export function whatsAppDigits(raw?: string | null) {
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

export function payLinkText(opts: { studentName: string; range: string; due: number; url: string }) {
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
  const [proof, setProof] = useState<PickedFile | null>(null);
  const [amountText, setAmountText] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [editBy, setEditBy] = useState(false);
  const [done, setDone] = useState<null | {
    message: string;
    amount: number;
    method: string;
    range: string;
    when: string;
    receiptNo: string;
    utr: string;
    receiptUrl: string;
  }>(null);
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
            dueAt: inv.dueAt || "",
          }))
          .filter((m) => m.dueNow > 0)
      ),
    [roster]
  );
  const selected = months.filter((m) => picked.includes(m.id));
  const due = selected.reduce((sum, m) => sum + m.dueNow, 0);
  const oneChild = new Set(selected.map((m) => m.studentId)).size <= 1;
  const typed = amountText.replace(/[^0-9]/g, "");
  const received = typed ? Number(typed) : due;
  const partPay = Boolean(typed) && received < due;
  const amountError = !typed
    ? ""
    : received <= 0
      ? "Enter the amount received."
      : received > due
        ? `More than due (${rupees(due)}). Tick more months.`
        : partPay && !oneChild
          ? "Part payment is one child at a time."
          : "";
  const split = partPay ? splitPayment(selected, received) : [];
  const current = PAYMENT_METHODS.find((m) => m.id === method)!;
  const wa = whatsAppDigits(lead?.parentPhone);
  const heading = title || (roster.length > 1 ? `Payment · ${roster.length} children` : lead ? `Payment · ${lead.name}` : "Payment");

  useEffect(() => {
    if (!open) return;
    setPicked(months.map((m) => m.id));
    setMethod(startMethod || "CASH");
    setReference("");
    setProof(null);
    setAmountText("");
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
    if (amountError) {
      setError(amountError);
      return;
    }
    if (!collectedBy.trim()) {
      setError("Enter who collected or recorded this payment.");
      return;
    }
    setBusy("collect");
    setError("");
    try {
      // Optional UPI / bank screenshot, stored once and linked to every payment row.
      const proofPath = proof ? (await uploadFile(token, proof, { kind: "invoiceAttachment" })).path : undefined;
      const groups = new Map<string, string[]>();
      for (const m of selected) {
        groups.set(m.studentId, [...(groups.get(m.studentId) || []), m.id]);
      }
      const receiptNos: string[] = [];
      const receiptTokens: string[] = [];
      for (const [studentId, invoiceIds] of groups) {
        const res = await act<{ ok: true; receiptNo?: string; receiptToken?: string }>(token, "collectPartialFees", {
          studentId,
          invoiceIds,
          amount: partPay ? received : undefined,
          method,
          reference: reference.trim() || undefined,
          collectedBy: collectedBy.trim() || undefined,
          notes: notes.trim() || undefined,
          proofPath,
        });
        if (res?.receiptNo) receiptNos.push(res.receiptNo);
        if (res?.receiptToken) receiptTokens.push(res.receiptToken);
      }
      // Receipt PDF link (a family collection shares the first child's receipt).
      const firstStudent = [...groups.keys()][0];
      const receiptUrl = receiptTokens[0]
        ? `${webOrigin()}/pay/r/${encodeURIComponent(receiptTokens[0])}`
        : firstStudent
          ? await receiptPdfUrl(token, groups.get(firstStudent) || []).catch(() => "")
          : "";
      const message = partPay
        ? `Collected ${rupees(received)}.`
        : selected.length === 1
          ? "Collected 1 month."
          : `Collected ${selected.length} months.`;
      if (phone) {
        setDone({
          message,
          amount: received,
          method: current.label,
          range: payRangeLabel(selected.map((m) => m.title)),
          when: new Date().toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
          receiptNo: receiptNos.join(", "),
          utr: reference.trim(),
          receiptUrl,
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

  const monthWord = selected.length === 1 ? "month" : "months";
  const locked = busy !== null;
  const copyLabel = busy === "copy" ? "Copying" : copied ? "Copied" : "Copy";
  const waLabel = busy === "whatsapp" ? "Opening" : "WhatsApp";
  const collectLabel = busy === "collect" ? "Collecting…" : partPay ? `Collect ${rupees(received)}` : `Collect ${selected.length} ${monthWord}`;
  const amountBox = (
    <View>
      <TextInput
        value={amountText}
        onChangeText={(v) => {
          setAmountText(v.replace(/[^0-9]/g, ""));
          setError("");
        }}
        editable={!locked && selected.length > 0}
        keyboardType="number-pad"
        accessibilityLabel="Amount received"
        placeholder={`${rupees(due)} (full)`}
        placeholderTextColor="#94a3b8"
        className="rounded-xl border border-ink-200 px-3 py-3 text-sm text-ink-900"
        style={{ includeFontPadding: false }}
      />
      {amountError ? (
        <Text className="mt-1.5 text-xs text-red-700">{amountError}</Text>
      ) : split.length ? (
        <View className="mt-2 gap-1 rounded-xl bg-ink-50 px-3 py-2">
          {split.map((row) => {
            const m = selected.find((x) => x.id === row.id);
            return (
              <View key={row.id} className="flex-row justify-between gap-3">
                <Text numberOfLines={1} className="min-w-0 flex-1 text-xs text-ink-700">
                  {m?.title}
                  {row.full ? "" : " · part paid"}
                </Text>
                <Text className="text-xs font-semibold text-ink-900">{rupees(row.pay)}</Text>
              </View>
            );
          })}
          <Text className="text-[11px] text-ink-500">Still due after this: {rupees(due - received)}</Text>
        </View>
      ) : (
        <Text className="mt-1.5 text-[11px] text-ink-500">Leave empty to collect in full. Less goes to the oldest month first.</Text>
      )}
    </View>
  );
  const manualReady = method === "RAZORPAY" || Boolean(collectedBy.trim());

  if (phone) {
    const receiptText = done
      ? receiptMessage({
          studentName: lead?.name || "your child",
          amount: rupees(done.amount),
          range: done.range,
          method: done.method,
          when: done.when,
          receiptNo: done.receiptNo,
          utr: done.utr,
          url: done.receiptUrl,
        })
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
                  {done.receiptNo ? (
                    <Text className="mt-1 text-xs font-semibold text-ink-700">Receipt No. {done.receiptNo}</Text>
                  ) : null}
                  <View className="mt-6 w-full gap-2">
                    {wa ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void sendReceiptOnWhatsApp(wa, receiptText)}
                        className="h-12 flex-row items-center justify-center gap-2 rounded-xl bg-green-600"
                      >
                        <Ionicons name="logo-whatsapp" size={18} color="#fff" />
                        <Text className="text-[15px] font-semibold text-white">Send receipt on WhatsApp</Text>
                      </Pressable>
                    ) : null}
                    {done.receiptUrl || Platform.OS !== "web" || (typeof navigator !== "undefined" && "share" in navigator) ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          done.receiptUrl
                            ? void shareReceiptPdf(done.receiptUrl, `Receipt-${(done.receiptNo || "fee").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`, receiptText)
                            : void Share.share({ message: receiptText }).catch(() => undefined)
                        }
                        className="h-12 flex-row items-center justify-center gap-2 rounded-xl border border-ink-200"
                      >
                        <Ionicons name="share-outline" size={18} color="#1F45C7" />
                        <Text className="text-[15px] font-semibold text-[#1F45C7]">{done.receiptUrl ? "Share receipt PDF" : "Share receipt"}</Text>
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

                        {method !== "RAZORPAY" ? (
                          <>
                            <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-500">Amount received</Text>
                            {amountBox}
                          </>
                        ) : null}

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

                        {method !== "RAZORPAY" && method !== "CASH" ? (
                          <View className="mt-3">
                            <ProofAttach mode={method} file={proof} onChange={setProof} disabled={locked} />
                          </View>
                        ) : null}

                        {method === "RAZORPAY" ? (
                          <View className="mt-3 gap-2.5">
                            {wa ? (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Send pay link on WhatsApp"
                                disabled={!selected.length || locked}
                                onPress={sendWhatsApp}
                                className={`h-12 flex-row items-center justify-center gap-2 rounded-xl bg-[#16a34a] active:opacity-80 ${!selected.length || locked ? "opacity-50" : ""}`}
                              >
                                <Ionicons name="logo-whatsapp" size={19} color="#fff" />
                                <Text className="text-[15px] font-semibold text-white">Send on WhatsApp</Text>
                              </Pressable>
                            ) : (
                              <Text className="text-[12px] text-ink-600">{channelHint({ wa: false })}</Text>
                            )}
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Copy pay link"
                              hitSlop={8}
                              disabled={!selected.length || locked}
                              onPress={copyLink}
                              className={`flex-row items-center justify-center gap-1.5 py-1 ${!selected.length || locked ? "opacity-50" : ""}`}
                            >
                              <Ionicons name={copied ? "checkmark" : "copy-outline"} size={15} color="#1F45C7" />
                              <Text className="text-[13px] font-medium text-[#1F45C7]">{copied ? "Link copied" : "Copy link instead"}</Text>
                            </Pressable>
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
                            disabled={!selected.length || locked || !manualReady || Boolean(amountError)}
                            onPress={collect}
                            className={`h-12 items-center justify-center rounded-xl ${!selected.length || locked || !manualReady || amountError ? "bg-ink-200" : "bg-[#1F45C7]"}`}
                          >
                            <Text className="text-[15px] font-semibold text-white">
                              {busy === "collect"
                                ? "Collecting…"
                                : selected.length
                                  ? `Collect ${rupees(received)} · ${current.short}`
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
          {method !== "RAZORPAY" && method !== "CASH" ? (
            <ProofAttach mode={method} file={proof} onChange={setProof} disabled={locked} />
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
              </View>
              <Text className="text-[11px] text-ink-700">
                {channelHint({ wa: Boolean(wa) })}
              </Text>
            </View>
          ) : null}
          {method !== "RAZORPAY" ? (
            <View className="gap-3">
              <Field label="Amount received">{amountBox}</Field>
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
                <Button className="px-3 py-2" disabled={!selected.length || locked || !manualReady || Boolean(amountError)} onPress={collect}>
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
