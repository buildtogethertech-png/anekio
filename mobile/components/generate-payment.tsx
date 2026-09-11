import { useEffect, useMemo, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Linking, Platform, Pressable, Share, Text, View } from "react-native";
import { webOrigin } from "../lib/api";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";
import { Button, Field, Input, Modal } from "./ui";

const PAYMENT_METHODS = [
  { id: "CASH", label: "Cash", hint: "Collected at the desk" },
  { id: "UPI", label: "UPI", hint: "GPay / PhonePe / school QR — enter UTR" },
  { id: "RAZORPAY", label: "Pay link", hint: "Parent pays themselves. Copy or send the link." },
  { id: "BANK", label: "Bank transfer", hint: "NEFT / IMPS — enter the UTR" },
  { id: "CHEQUE", label: "Cheque", hint: "Cheque number and bank" },
] as const;

type Method = (typeof PAYMENT_METHODS)[number]["id"];
type Busy = null | "collect" | "fees" | "copy" | "whatsapp" | "call";

type OpenMonth = {
  id: string;
  title: string;
  amount: string;
  remaining: string;
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
    lateLabel?: string;
    status: string;
  }[];
};

function rupees(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function dueOf(inv: NonNullable<StudentPay["invoices"]>[number]) {
  if (typeof inv.dueNow === "number") return inv.dueNow;
  const n = Number(String(inv.remaining || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
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
  onClose,
  onDone,
}: {
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
    setMethod("CASH");
    setReference("");
    setCollectedBy(user?.name || "");
    setNotes("");
    setBusy(null);
    setCopied(false);
    setError("");
  }, [open, lead?.id, months.length, user?.name]);

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
      await onDone(selected.length === 1 ? "Collected 1 month." : `Collected ${selected.length} months.`);
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

  return (
    <Modal open={open} title={heading} onClose={onClose} wide>
      {months.length ? (
        <View className="gap-4">
          <Text className="text-sm text-ink-700">
            Tick the months to collect. Leave some off to take two or three months only.
          </Text>
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
                      <Text className="text-sm font-medium text-ink-900">{inv.title}</Text>
                      {inv.lateLabel ? (
                        <Text className="mt-0.5 text-xs text-amber-800">{inv.lateLabel}</Text>
                      ) : null}
                    </View>
                  </View>
                  <Text className="shrink-0 text-sm text-ink-800">{rupees(inv.dueNow)}</Text>
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

          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={onClose}>
              Cancel
            </Button>
            {method === "RAZORPAY" ? null : (
              <>
                <Button
                  variant="ghost"
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
                <Button disabled={!selected.length || locked || !manualReady} onPress={collect}>
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
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={onClose}>
              Cancel
            </Button>
            <Button disabled={locked} onPress={runFees}>
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
