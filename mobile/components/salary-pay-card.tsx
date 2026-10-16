import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Field, Input, Modal } from "./ui";
import { DateField } from "./date-field";
import { act } from "../lib/mutate";
import { ymd } from "../lib/calendar";
import { inr, monthTitle, salaryPayState, SALARY_PAY_MODES, type SalaryPayState } from "../lib/payroll";
import type { RecordPayload } from "../lib/record";
import { PayMethodTiles, SavedProofLink, payMethodLabel, ProofAttach, SalarySheetFrame, SheetInput, SheetLabel, SheetPayButton, uploadSalaryProof } from "./salary-pay-sheet";
import { useSession } from "../lib/session";
import type { PickedFile } from "../lib/upload";

type Payment = NonNullable<RecordPayload["staffSalaryPayments"]>[number];
type Run = NonNullable<RecordPayload["staffPayroll"]>[number];

const MODE_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  CASH: "cash-outline",
  UPI: "qr-code-outline",
  BANK: "business-outline",
  CHEQUE: "document-text-outline",
};

/** "2026-10-17" → "17 Oct 2026". */
export function prettyDate(ymdValue: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymdValue || "");
  if (!m) return ymdValue;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

export const PAY_MODE_LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK: "Bank", CHEQUE: "Cheque" };

export const PAY_STATE_LABEL: Record<SalaryPayState, { label: string; fg: string; bg: string }> = {
  NOT_APPROVED: { label: "Not approved", fg: "#92400e", bg: "#FFFBEB" },
  UNPAID: { label: "Unpaid", fg: "#b91c1c", bg: "#FEF2F2" },
  PART_PAID: { label: "Part paid", fg: "#b45309", bg: "#FFF7ED" },
  PAID: { label: "Paid", fg: "#047857", bg: "#ECFDF5" },
};

export function PayStatePill({ state }: { state: SalaryPayState }) {
  const t = PAY_STATE_LABEL[state];
  return (
    <View className="self-start rounded-full px-2.5 py-1" style={{ backgroundColor: t.bg }}>
      <Text className="text-[11px] font-semibold" style={{ color: t.fg }}>{t.label}</Text>
    </View>
  );
}

/** Sheet for one payment. Amount starts at what's still owed. */
export function RecordPaymentSheet({
  open,
  title,
  balance,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  balance: number;
  onClose: () => void;
  onSubmit: (p: { amount: number; paidOn: string; mode: string; reference: string; note: string; proofPath: string }) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(balance));
  const [paidOn, setPaidOn] = useState(ymd(new Date()));
  const [mode, setMode] = useState<string>("UPI");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const n = Math.round(Number(amount));
  const rest = Number.isFinite(n) ? Math.max(0, balance - n) : balance;
  const { width } = useWindowDimensions();
  const { token } = useSession();
  const [proof, setProof] = useState<PickedFile | null>(null);

  async function submit() {
    setError("");
    if (!Number.isFinite(n) || n <= 0) return setError("Enter an amount more than ₹0.");
    if (n > balance) return setError(`That's more than the ${inr(balance)} still owed.`);
    setBusy(true);
    try {
      const proofPath = await uploadSalaryProof(token, proof);
      await onSubmit({ amount: n, paidOn, mode, reference, note, proofPath });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the payment.");
    } finally {
      setBusy(false);
    }
  }

  if (width < 768) {
    const valid = Number.isFinite(n) && n > 0 && n <= balance;
    return (
      <SalarySheetFrame
        open={open}
        onClose={onClose}
        title={title}
        subtitle={`Still owed ${inr(balance)}`}
        footer={
          <SheetPayButton
            disabled={busy || !valid}
            onPress={() => void submit()}
            label={busy ? "Saving…" : valid ? `Pay ${inr(n)} · ${payMethodLabel(mode)}` : "Enter an amount"}
          />
        }
      >
        <View className="items-center py-3">
          <View className="flex-row items-center">
            <Text className="text-[34px] font-bold leading-10 text-ink-900">₹</Text>
            <TextInput
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/[^\d]/g, ""))}
              keyboardType="number-pad"
              accessibilityLabel="Amount paid"
              className="min-w-[80px] text-center text-[34px] font-bold text-ink-900"
              style={{ includeFontPadding: false, paddingVertical: 0 }}
            />
          </View>
          <Text className="mt-0.5 text-xs text-ink-500">
            {valid && rest > 0 ? `${inr(rest)} will stay pending` : valid ? "Pays the full balance" : " "}
          </Text>
          {n !== balance ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setAmount(String(balance))} className="mt-2 rounded-full bg-[#EEF3FF] px-3 py-1.5">
              <Text className="text-xs font-semibold text-[#1F45C7]">{`Pay full ${inr(balance)}`}</Text>
            </Pressable>
          ) : null}
        </View>

        <SheetLabel>Paid on</SheetLabel>
        <DateField value={paidOn} max={ymd(new Date())} onChange={setPaidOn} />

        <SheetLabel>Paid by</SheetLabel>
        <PayMethodTiles
          value={mode}
          disabled={busy}
          onChange={(m) => {
            setMode(m);
            setReference("");
          }}
        />
        <View className="mt-3 gap-2">
          {mode !== "CASH" ? (
            <SheetInput
              value={reference}
              onChangeText={setReference}
              autoCapitalize="characters"
              accessibilityLabel="Reference"
              placeholder={mode === "CHEQUE" ? "Cheque no. · bank (optional)" : "UTR / reference no. (optional)"}
            />
          ) : null}
          <SheetInput value={note} onChangeText={setNote} placeholder="Note (optional), e.g. balance next week" />
          <ProofAttach mode={mode} file={proof} onChange={setProof} disabled={busy} />
        </View>
        {error ? <Text className="mt-3 text-sm text-red-700">{error}</Text> : null}
      </SalarySheetFrame>
    );
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            accessibilityLabel="Save payment"
            onPress={() => void submit()}
          >
            {busy ? "Saving…" : "Save payment"}
          </Button>
        </View>
      }
    >
      <View className="gap-4">
        <Field label="Amount paid" hint={`Still owed ${inr(balance)}${rest > 0 && n > 0 ? ` · ${inr(rest)} will stay pending` : ""}`}>
          <Input keyboardType="number-pad" value={amount} onChangeText={setAmount} accessibilityLabel="Amount paid" />
        </Field>
        <Field label="Paid on">
          <DateField value={paidOn} max={ymd(new Date())} onChange={setPaidOn} />
        </Field>
        <Field label="Method">
          <View className="flex-row flex-wrap gap-2">
            {SALARY_PAY_MODES.map((m) => {
              const on = m === mode;
              return (
                <Pressable
                  key={m}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setMode(m)}
                  className={`rounded-full border px-4 py-2 ${on ? "border-[#2855F6] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                >
                  <Text className={`text-[13px] font-medium ${on ? "text-[#1F45C7]" : "text-ink-700"}`}>{PAY_MODE_LABEL[m]}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>
        {mode !== "CASH" ? (
          <Field label={mode === "CHEQUE" ? "Cheque number" : "Transaction / UTR number"} hint="Optional">
            <Input value={reference} onChangeText={setReference} autoCapitalize="characters" accessibilityLabel="Reference" />
          </Field>
        ) : null}
        <Field label="Note" hint="Optional">
          <Input value={note} onChangeText={setNote} placeholder="e.g. Balance next week" />
        </Field>
        <Field label="Proof" hint="Optional">
          <ProofAttach mode={mode} file={proof} onChange={setProof} disabled={busy} />
        </Field>
        {error ? <Text className="text-[13px] text-red-700">{error}</Text> : null}
      </View>
    </Modal>
  );
}

/**
 * Due / paid / owed for one person-month, with the payment history and "Record payment".
 * Earlier months' unpaid balances show as a separate line; they never change this month's salary.
 */
export function SalaryPayCard({
  token,
  kind,
  personId,
  personKey,
  month,
  runs,
  payments,
  canPay,
  onSaved,
  onMessage,
  flat,
}: {
  /** Inside a sheet: no outer card border or title; stats as tiles. */
  flat?: boolean;
  token: string | null;
  kind: "teacher" | "staff";
  personId: string;
  personKey: string;
  month: string;
  runs?: RecordPayload["staffPayroll"];
  payments?: RecordPayload["staffSalaryPayments"];
  canPay: boolean;
  onSaved: () => Promise<void>;
  onMessage: (m: string) => void;
}) {
  const [recordOpen, setRecordOpen] = useState(false);
  const [voidFor, setVoidFor] = useState<Payment | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);

  const mine = useMemo(() => (payments ?? []).filter((p) => p.personKey === personKey), [payments, personKey]);
  const run = (runs ?? []).find((r) => r.personKey === personKey && r.month === month) as Run | undefined;
  const thisMonth = mine.filter((p) => p.month === month);
  const s = salaryPayState(run, thisMonth);
  const earlierOwed = useMemo(
    () =>
      (runs ?? [])
        .filter((r) => r.personKey === personKey && r.month < month)
        .reduce((sum, r) => sum + salaryPayState(r, mine.filter((p) => p.month === r.month)).balance, 0),
    [mine, month, personKey, runs]
  );

  const cell = (label: string, value: string, color?: string) => (
    <View className={`min-w-0 flex-1 ${flat ? "rounded-xl bg-ink-50 px-3 py-2.5" : ""}`}>
      <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</Text>
      <Text className="mt-0.5 text-[17px] font-semibold" style={{ color: color || "#0f172a" }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
  const live = thisMonth.filter((p) => !p.voided).length;

  return (
    <View className={flat ? "" : "mt-4 rounded-xl border border-ink-200 bg-white p-4"}>
      {flat ? null : (
        <View className="flex-row items-center justify-between">
          <Text className="text-[15px] font-semibold text-ink-900">Salary payment</Text>
          <PayStatePill state={s.state} />
        </View>
      )}

      {s.state === "NOT_APPROVED" ? (
        <Text className="mt-2 text-[13px] leading-5 text-ink-700">Approve {monthTitle(month)} first. Then you can record what was paid.</Text>
      ) : (
        <>
          <View className={`${flat ? "mt-1 gap-2" : "mt-3 gap-3"} flex-row`}>
            {cell("Due", inr(s.due))}
            {cell("Paid", inr(s.paid), "#047857")}
            {cell("Owed", inr(s.balance), s.balance ? "#b91c1c" : "#0f172a")}
          </View>
          {canPay && s.balance > 0 ? (
            <View className="mt-3">
              <Button accessibilityLabel="Record payment" onPress={() => setRecordOpen(true)}>
                {s.paid > 0 ? "Record another payment" : "Record payment"}
              </Button>
            </View>
          ) : null}
        </>
      )}

      {earlierOwed > 0 ? (
        <View className="mt-3 flex-row items-center gap-2 rounded-lg bg-amber-50 px-3 py-2">
          <Ionicons name="alert-circle-outline" size={15} color="#b45309" />
          <Text className="min-w-0 flex-1 text-[12px] text-amber-900">{`Earlier months still owed: ${inr(earlierOwed)}`}</Text>
        </View>
      ) : null}

      {thisMonth.length ? (
        <View className={flat ? "mt-4" : "mt-3 border-t border-ink-100 pt-3"}>
          <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
            {`Payments · ${live}`}
          </Text>
          <View className="overflow-hidden rounded-xl border border-ink-100">
            {thisMonth.map((p, i) => (
              <View key={p.id} className={`flex-row items-start gap-3 px-3 py-3 ${i ? "border-t border-ink-100" : ""} ${p.voided ? "bg-ink-50/60" : "bg-white"}`}>
                <View className={`mt-0.5 h-9 w-9 items-center justify-center rounded-full ${p.voided ? "bg-ink-100" : "bg-[#EEF3FF]"}`}>
                  <Ionicons name={MODE_ICON[p.mode] || "swap-horizontal-outline"} size={17} color={p.voided ? "#94a3b8" : "#1F45C7"} />
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className={`text-[15px] font-semibold ${p.voided ? "text-ink-500 line-through" : "text-ink-900"}`}>{inr(p.amount)}</Text>
                    {p.voided ? (
                      <View className="rounded-full bg-ink-100 px-2 py-0.5">
                        <Text className="text-[10px] font-semibold text-ink-600">Cancelled</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text className="mt-0.5 text-[12px] text-ink-600" numberOfLines={1}>
                    {`${PAY_MODE_LABEL[p.mode] || p.mode} · ${prettyDate(p.paidOn)}`}
                  </Text>
                  {p.voided ? (
                    <Text className="mt-0.5 text-[12px] text-ink-500" numberOfLines={2}>{`Reason: ${p.voidReason}`}</Text>
                  ) : [p.reference, p.note].filter(Boolean).length ? (
                    <Text className="mt-0.5 text-[12px] text-ink-500" numberOfLines={2}>{[p.reference ? `Ref ${p.reference}` : "", p.note].filter(Boolean).join(" · ")}</Text>
                  ) : null}
                  {!p.voided ? (
                    p.proofPath ? (
                      <SavedProofLink token={token} path={p.proofPath} onError={onMessage} />
                    ) : p.mode === "CASH" ? (
                      <View className="mt-1.5 self-start rounded-full bg-amber-50 px-2 py-0.5">
                        <Text className="text-[11px] font-semibold text-amber-800">No proof</Text>
                      </View>
                    ) : null
                  ) : null}
                </View>
                {canPay && !p.voided ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel payment"
                    hitSlop={8}
                    onPress={() => setVoidFor(p)}
                    className="h-8 flex-row items-center gap-1 rounded-full border border-ink-200 px-2.5"
                  >
                    <Ionicons name="arrow-undo-outline" size={13} color="#64748b" />
                    <Text className="text-[12px] font-medium text-ink-600">Undo</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ) : s.state !== "NOT_APPROVED" ? (
        <Text className="mt-4 text-[13px] text-ink-500">No payments recorded yet.</Text>
      ) : null}

      {recordOpen ? (
        <RecordPaymentSheet
          open
          title={`Pay ${monthTitle(month)}`}
          balance={s.balance}
          onClose={() => setRecordOpen(false)}
          onSubmit={async (p) => {
            await act(token, "recordStaffSalaryPayment", { kind, id: personId, month, ...p });
            setRecordOpen(false);
            onMessage(p.amount >= s.balance ? "Paid in full." : `${inr(p.amount)} recorded. ${inr(s.balance - p.amount)} still owed.`);
            await onSaved();
          }}
        />
      ) : null}

      <Modal
        open={Boolean(voidFor)}
        title="Undo this payment?"
        onClose={() => {
          setVoidFor(null);
          setVoidReason("");
        }}
        footer={
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={() => setVoidFor(null)}>
              Keep it
            </Button>
            <Button
              disabled={busy || !voidReason.trim()}
              onPress={async () => {
                if (!voidFor) return;
                setBusy(true);
                try {
                  await act(token, "voidStaffSalaryPayment", { paymentId: voidFor.id, reason: voidReason });
                  setVoidFor(null);
                  setVoidReason("");
                  onMessage("Payment cancelled. The amount is owed again.");
                  await onSaved();
                } catch (e) {
                  onMessage(e instanceof Error ? e.message : "Could not cancel the payment.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Cancel payment
            </Button>
          </View>
        }
      >
        <Text className="text-[13px] leading-5 text-ink-700">
          {voidFor ? `${inr(voidFor.amount)} paid on ${voidFor.paidOn} will be marked cancelled and stay in the history.` : ""}
        </Text>
        <View className="mt-3">
          <Field label="Reason">
            <Input value={voidReason} onChangeText={setVoidReason} placeholder="e.g. Entered twice" accessibilityLabel="Cancel reason" />
          </Field>
        </View>
      </Modal>
    </View>
  );
}
