import { useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import { openInAppDoc } from "../lib/in-app-doc";
import { act } from "../lib/mutate";
import { inr } from "../lib/payroll";
import { useSession } from "../lib/session";
import { Button, Field, Input, Modal } from "./ui";

export type InvoicePayment = {
  amount: string;
  method: string;
  reference: string;
  paidAt: string;
  amountValue?: number;
  receiptId?: string;
  receiptNo?: string;
  receiptTotal?: number;
  receiptUrl?: string;
};

const METHOD: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK: "Bank",
  CHEQUE: "Cheque",
  RAZORPAY: "Online",
  CASHFREE: "Online",
  BILLDESK: "Online",
};

/** One line per receipt that paid this invoice, newest first (older payments without a receipt: one line each). */
export function invoiceReceipts(payments: InvoicePayment[] | undefined) {
  const byKey = new Map<string, { key: string; receiptId: string; receiptNo: string; url: string; amount: number; total: number; paidAt: string; method: string }>();
  for (const [i, p] of (payments ?? []).entries()) {
    const key = p.receiptId || `legacy-${i}`;
    const amount = p.amountValue ?? (Number(String(p.amount || "").replace(/[^0-9.]/g, "")) || 0);
    const row = byKey.get(key);
    if (row) {
      row.amount += amount;
      continue;
    }
    byKey.set(key, {
      key,
      receiptId: p.receiptId || "",
      receiptNo: p.receiptNo || String(p.reference || "").split(":")[0].toUpperCase() || "Payment",
      url: p.receiptUrl || "",
      amount,
      total: p.receiptTotal || 0,
      paidAt: p.paidAt || "",
      method: p.method || "",
    });
  }
  return [...byKey.values()].sort((a, b) => b.paidAt.localeCompare(a.paidAt));
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(+d) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Receipt links are PDFs; inside the app show the page version, which fits a phone. */
export function receiptPageUrl(url: string) {
  return /\/pay\/r\//.test(url) && !/[?&]view=/.test(url) ? `${url}${url.includes("?") ? "&" : "?"}view=1` : url;
}

function openReceipt(url: string, label: string) {
  openInAppDoc(receiptPageUrl(url), label);
}

/**
 * Receipts under an invoice: number, date, mode, amount. Tap opens the receipt PDF.
 * With `canCancel`, each receipt can be cancelled with a reason.
 */
export function InvoiceReceipts({
  payments,
  canCancel,
  onChanged,
  onOpen,
  className = "",
}: {
  payments: InvoicePayment[] | undefined;
  /** Show the receipt in a viewer the caller owns (e.g. one inside its own sheet). */
  onOpen?: (url: string, title: string) => void;
  canCancel?: boolean;
  onChanged?: (message: string) => void | Promise<void>;
  className?: string;
}) {
  const { token } = useSession();
  const [cancelling, setCancelling] = useState<null | { id: string; receiptNo: string; total: number }>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = invoiceReceipts(payments);
  if (!rows.length) return null;

  async function confirm() {
    if (!cancelling || !reason.trim()) return;
    setBusy(true);
    setError("");
    try {
      await act(token, "cancelFeeReceipt", { receiptId: cancelling.id, reason: reason.trim() });
      const no = cancelling.receiptNo;
      setCancelling(null);
      await onChanged?.(`Receipt ${no} cancelled.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the receipt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className={`gap-1 ${className}`}>
      {rows.map((r) => (
        <View key={r.key} className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open receipt ${r.receiptNo}`}
            disabled={!r.url}
            onPress={() => r.url && (onOpen ? onOpen(receiptPageUrl(r.url), `Receipt ${r.receiptNo}`) : openReceipt(r.url, `Receipt ${r.receiptNo}`))}
            className="min-w-0 flex-1 flex-row items-center gap-1.5"
          >
            <Ionicons name="receipt-outline" size={12} color="#047857" />
            <Text numberOfLines={2} className="min-w-[96px] flex-1 text-[11px] text-ink-600">
              <Text className={r.url ? "font-semibold text-[#1F45C7]" : "font-semibold text-ink-700"}>{r.receiptNo}</Text>
              {[dayLabel(r.paidAt), METHOD[r.method] || r.method, r.total > r.amount ? `of ${inr(r.total)}` : ""].filter(Boolean).map((part) => ` · ${part}`).join("")}
            </Text>
          </Pressable>
          <Text className="text-[11px] font-semibold text-green-700">{inr(r.amount)}</Text>
          {canCancel && r.receiptId ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Cancel receipt ${r.receiptNo}`}
              hitSlop={6}
              onPress={() => {
                setReason("");
                setError("");
                setCancelling({ id: r.receiptId, receiptNo: r.receiptNo, total: r.total || r.amount });
              }}
            >
              <Ionicons name="close-circle-outline" size={14} color="#94a3b8" />
            </Pressable>
          ) : null}
        </View>
      ))}
      <Modal
        open={Boolean(cancelling)}
        title={cancelling ? `Cancel receipt ${cancelling.receiptNo}?` : "Cancel receipt"}
        sheetOnPhone
        onClose={() => !busy && setCancelling(null)}
        footer={
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" disabled={busy} onPress={() => setCancelling(null)}>
              Keep
            </Button>
            <Button disabled={busy || !reason.trim()} onPress={() => void confirm()}>
              {busy ? "Cancelling…" : "Cancel receipt"}
            </Button>
          </View>
        }
      >
        <View className="gap-3">
          <Text className="text-sm leading-5 text-ink-700">
            {cancelling ? `${inr(cancelling.total)} comes off the months this receipt paid. The receipt number stays in the records as cancelled.` : ""}
          </Text>
          <Field label="Reason">
            <Input value={reason} onChangeText={setReason} placeholder="e.g. Cheque bounced, entered twice" editable={!busy} />
          </Field>
          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
        </View>
      </Modal>
    </View>
  );
}
