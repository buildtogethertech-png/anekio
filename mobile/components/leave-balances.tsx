import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal as RnModal, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";
import { Toast, useToast } from "./ui";

type Balance = {
  typeId: string;
  typeName: string;
  limited: boolean;
  mode: string;
  leaveYear: string;
  earned: number;
  used: number;
  pending: number;
  available: number;
  nextCreditOn: string;
  nextCreditDays: number;
};
type LedgerRow = { id: string; typeId: string; typeName: string; kind: string; days: number; note: string; at: string };

const fmt = (n: number) => (n % 1 ? n.toFixed(1) : String(n));
const KIND_LABEL: Record<string, string> = {
  CREDIT: "Credit",
  CARRY_FORWARD: "Carried forward",
  LAPSE: "Lapsed",
  ADJUST: "Adjustment",
  OPENING: "Opening balance",
};

/* ---------------------------------------------------- one employee */

export function EmployeeLeaveCard({ kind, id, canEdit }: { kind: "teacher" | "staff" | undefined; id: string; canEdit: boolean }) {
  const { token } = useSession();
  const toast = useToast();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [typeId, setTypeId] = useState("");
  const [days, setDays] = useState("");
  const [sign, setSign] = useState<1 | -1>(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    try {
      const q = kind === "teacher" ? `teacherId=${encodeURIComponent(id)}` : `staffId=${encodeURIComponent(id)}`;
      const res = await api<{ balances: Balance[]; ledger: LedgerRow[] }>(`/leave-ledger?${q}`, token);
      setBalances(res.balances.filter((b) => b.limited));
      setLedger(res.ledger);
    } catch {
      setBalances([]);
    }
  }, [id, kind, token]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    const n = Number(days);
    if (!typeId || !n || !note.trim()) return;
    setBusy(true);
    try {
      await act(token, "adjustLeaveBalance", {
        typeId,
        ...(kind === "teacher" ? { teacherId: id } : { staffId: id }),
        days: sign * n,
        note: note.trim(),
      });
      toast.show("Leave balance updated.");
      setAdjustOpen(false);
      setDays("");
      setNote("");
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (balances === null) return null;
  const rows = showAll ? ledger : ledger.slice(0, 4);

  const TINTS = ["#1F45C7", "#0891b2", "#7c3aed", "#d97706", "#16a34a"];
  return (
    <View className="mb-3 gap-3">
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
        <View className="flex-row items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
          <View>
            <Text className="text-[15px] font-semibold text-ink-900">Leave balance</Text>
            <Text className="text-[12px] text-ink-500">{balances[0] ? `Leave year ${balances[0].leaveYear}` : "No limited leave types"}</Text>
          </View>
          {canEdit && balances.length ? (
            <Pressable
              accessibilityLabel="Add or remove leave"
              onPress={() => {
                setTypeId(balances[0]?.typeId || "");
                setSign(1);
                setAdjustOpen(true);
              }}
              className="h-9 flex-row items-center gap-1 rounded-full bg-[#EEF3FF] px-3"
            >
              <Ionicons name="swap-vertical" size={14} color="#1F45C7" />
              <Text className="text-[13px] font-semibold text-[#1F45C7]">Adjust</Text>
            </Pressable>
          ) : null}
        </View>
        {balances.map((b, n) => {
          const tint = TINTS[n % TINTS.length];
          const total = Math.max(b.earned, b.used + Math.max(0, b.available), 0.0001);
          const usedPct = Math.min(100, (b.used / total) * 100);
          const pendPct = Math.min(100 - usedPct, (b.pending / total) * 100);
          return (
            <View key={b.typeId} className={`px-4 py-3 ${n ? "border-t border-ink-100" : ""}`}>
              <View className="flex-row items-baseline justify-between">
                <View className="flex-row items-center gap-2">
                  <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tint }} />
                  <Text className="text-[14px] font-semibold text-ink-900">{b.typeName}</Text>
                </View>
                <Text className={`text-[18px] font-bold ${b.available <= 0 ? "text-[#B42318]" : "text-ink-900"}`}>
                  {fmt(b.available)}
                  <Text className="text-[12px] font-medium text-ink-500"> left</Text>
                </Text>
              </View>
              <View className="mt-2 h-1.5 flex-row overflow-hidden rounded-full bg-ink-100">
                <View style={{ width: `${usedPct}%`, backgroundColor: tint }} />
                <View style={{ width: `${pendPct}%`, backgroundColor: tint, opacity: 0.35 }} />
              </View>
              <Text className="mt-1.5 text-[11px] text-ink-500">
                {fmt(b.used)} used of {fmt(b.earned)} earned{b.pending ? ` · ${fmt(b.pending)} waiting` : ""}
              </Text>
            </View>
          );
        })}
      </View>

      {ledger.length ? (
        <View className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
          <Text className="px-4 pb-1 pt-3 text-[13px] font-semibold text-ink-900">History</Text>
          {rows.map((r, n) => (
            <View key={r.id} className={`flex-row items-center gap-3 px-4 py-2.5 ${n ? "border-t border-ink-50" : ""}`}>
              <View className={`h-8 min-w-[44px] items-center justify-center rounded-lg px-2 ${r.days < 0 ? "bg-red-50" : "bg-emerald-50"}`}>
                <Text className={`text-[13px] font-bold ${r.days < 0 ? "text-[#B42318]" : "text-[#18794E]"}`}>
                  {r.days > 0 ? "+" : ""}
                  {fmt(r.days)}
                </Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[13px] font-medium text-ink-900" numberOfLines={1}>
                  {r.typeName} · {KIND_LABEL[r.kind] || r.kind}
                </Text>
                <Text className="text-[11px] text-ink-500" numberOfLines={1}>
                  {r.note ? `${r.note.charAt(0).toUpperCase()}${r.note.slice(1).toLowerCase()} · ` : ""}
                  {new Date(r.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </Text>
              </View>
            </View>
          ))}
          {ledger.length > 4 ? (
            <Pressable onPress={() => setShowAll((v) => !v)} className="border-t border-ink-100 px-4 py-2.5">
              <Text className="text-[12px] font-semibold text-[#1F45C7]">{showAll ? "Show less" : `Show all ${ledger.length}`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <RnModal visible={adjustOpen} transparent animationType="fade" onRequestClose={() => setAdjustOpen(false)}>
        <View className="flex-1 items-center justify-center px-4">
          <Pressable className="absolute inset-0 bg-black/40" onPress={() => setAdjustOpen(false)} />
          <View className="w-full max-w-[420px] rounded-3xl bg-white p-5">
            <Text className="text-[17px] font-semibold text-ink-900">Add or remove leave</Text>
            <Text className="mt-1 text-[12px] text-ink-500">Saved in the history with your reason. Credits already given are not changed.</Text>
            <Text className="mb-2 mt-4 text-xs font-medium text-ink-700">Leave type</Text>
            <View className="flex-row flex-wrap gap-2">
              {balances.map((b) => (
                <Pressable
                  key={b.typeId}
                  onPress={() => setTypeId(b.typeId)}
                  className={`h-9 justify-center rounded-xl border px-3 ${typeId === b.typeId ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200"}`}
                >
                  <Text className={`text-[13px] ${typeId === b.typeId ? "font-semibold text-[#1F45C7]" : "text-ink-700"}`}>
                    {b.typeName} · {fmt(b.available)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View className="mt-4 flex-row items-center gap-2">
              <View className="flex-row rounded-xl bg-ink-100 p-0.5">
                {([1, -1] as const).map((s) => (
                  <Pressable key={s} onPress={() => setSign(s)} className={`h-9 justify-center rounded-lg px-3 ${sign === s ? "bg-white" : ""}`}>
                    <Text className={`text-[13px] font-semibold ${sign === s ? (s > 0 ? "text-[#18794E]" : "text-[#B42318]") : "text-ink-500"}`}>{s > 0 ? "Add" : "Remove"}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={days}
                onChangeText={(t) => setDays(t.replace(/[^\d.]/g, ""))}
                keyboardType="decimal-pad"
                placeholder="Days"
                placeholderTextColor="#94A3B8"
                className="h-10 w-24 rounded-xl border border-ink-200 px-3 text-[15px] text-ink-900"
              />
              <Text className="text-[13px] text-ink-500">days</Text>
            </View>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Reason, e.g. Opening balance from old register"
              placeholderTextColor="#94A3B8"
              className="mt-3 h-11 rounded-xl border border-ink-200 px-3 text-[14px] text-ink-900"
            />
            <View className="mt-4 flex-row gap-2">
              <Pressable onPress={() => setAdjustOpen(false)} className="h-11 flex-1 items-center justify-center rounded-xl border border-ink-200">
                <Text className="text-[14px] font-semibold text-ink-700">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void save()}
                disabled={busy || !Number(days) || !note.trim()}
                className={`h-11 flex-1 items-center justify-center rounded-xl ${Number(days) && note.trim() ? "bg-[#1F45C7]" : "bg-ink-200"}`}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text className={`text-[14px] font-semibold ${Number(days) && note.trim() ? "text-white" : "text-ink-500"}`}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </RnModal>
    </View>
  );
}

/* ---------------------------------------------- everyone, one time */

type Person = { kind: "teacher" | "staff"; id: string; name: string; employeeId: string; balances: Balance[] };
type Overview = { types: { id: string; name: string; forTeacher: boolean; forStaff: boolean }[]; people: Person[] };

/** Bulk screen: type each employee's current balance from the old register. */
export function LeaveBalancesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token } = useSession();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const [data, setData] = useState<Overview | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setData(null);
    try {
      setData(await api<Overview>("/leave-balances", token));
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not load balances.");
      setData({ types: [], people: [] });
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) {
      setEdits({});
      void load();
    }
  }, [open, load]);

  const shown = useMemo(
    () => (data?.people ?? []).filter((p) => !q.trim() || `${p.name} ${p.employeeId}`.toLowerCase().includes(q.trim().toLowerCase())),
    [data, q]
  );
  const changed = Object.keys(edits).filter((k) => edits[k] !== "");

  async function save() {
    if (!data || !changed.length) return;
    setBusy(true);
    try {
      const rows = changed.map((key) => {
        const [kind, id, typeId] = key.split("|");
        return { ...(kind === "teacher" ? { teacherId: id } : { staffId: id }), typeId, available: Number(edits[key]) };
      });
      const res = await act<{ ok: true; changed: number }>(token, "setLeaveBalances", { rows, note: "Opening balance (imported)" });
      toast.show(`${res.changed} balance${res.changed === 1 ? "" : "s"} updated.`);
      setEdits({});
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const types = data?.types ?? [];
  const colW = phone ? 84 : 120;

  return (
    <RnModal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-[#F6F7FB]" edges={["top", "bottom"]}>
        <View className="flex-row items-center gap-2 border-b border-ink-100 bg-white px-2 py-2">
          <Pressable onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full" accessibilityLabel="Close">
            <Ionicons name="chevron-back" size={22} color="#0F172A" />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="text-[16px] font-semibold text-ink-900">Current leave balances</Text>
            <Text className="text-[12px] text-ink-500" numberOfLines={1}>
              Type what each person has left today. Saved as an opening balance.
            </Text>
          </View>
        </View>

        <View className="px-4 pt-3">
          <View className="h-10 flex-row items-center gap-2 rounded-xl border border-ink-100 bg-white px-3">
            <Ionicons name="search" size={16} color="#64748B" />
            <TextInput value={q} onChangeText={setQ} placeholder="Search employee" placeholderTextColor="#94A3B8" className="flex-1 text-[14px] text-ink-900" />
          </View>
        </View>

        {!data ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#1F45C7" />
          </View>
        ) : !types.length ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-center text-[14px] text-ink-600">
              No leave type has a limit yet. Set "how leave builds up" for a type in Settings → Leave first.
            </Text>
          </View>
        ) : (
          <ScrollView className="mt-3 flex-1" contentContainerStyle={{ paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
              <View className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
                <View className="flex-row items-center border-b border-ink-100 bg-ink-50 py-2">
                  <Text className="px-3 text-[12px] font-semibold text-ink-600" style={{ width: phone ? 150 : 240 }}>
                    Employee
                  </Text>
                  {types.map((t) => (
                    <Text key={t.id} className="text-center text-[12px] font-semibold text-ink-600" style={{ width: colW }}>
                      {t.name}
                    </Text>
                  ))}
                </View>
                {shown.map((p, i) => (
                  <View key={`${p.kind}-${p.id}`} className={`flex-row items-center py-2 ${i ? "border-t border-ink-50" : ""}`}>
                    <View className="px-3" style={{ width: phone ? 150 : 240 }}>
                      <Text className="text-[14px] font-medium text-ink-900" numberOfLines={1}>{p.name}</Text>
                      <Text className="text-[11px] text-ink-500" numberOfLines={1}>
                        {p.kind === "teacher" ? "Teacher" : "Staff"}
                        {p.employeeId ? ` · ${p.employeeId}` : ""}
                      </Text>
                    </View>
                    {types.map((t) => {
                      const bal = p.balances.find((b) => b.typeId === t.id);
                      if (!bal) {
                        return (
                          <Text key={t.id} className="text-center text-[12px] text-ink-300" style={{ width: colW }}>
                            —
                          </Text>
                        );
                      }
                      const key = `${p.kind}|${p.id}|${t.id}`;
                      const dirty = edits[key] !== undefined && edits[key] !== "" && Number(edits[key]) !== bal.available;
                      return (
                        <View key={t.id} className="items-center" style={{ width: colW }}>
                          <TextInput
                            value={edits[key] ?? fmt(bal.available)}
                            onChangeText={(v) => setEdits((cur) => ({ ...cur, [key]: v.replace(/[^\d.]/g, "") }))}
                            keyboardType="decimal-pad"
                            selectTextOnFocus
                            className={`h-9 rounded-lg border text-center text-[14px] font-semibold ${dirty ? "border-[#F59E0B] bg-[#FFFBEB] text-[#92400E]" : "border-ink-200 bg-white text-ink-900"}`}
                            style={{ width: colW - 20 }}
                          />
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
            <Text className="mx-4 mt-3 text-[12px] leading-5 text-ink-500">
              The number is what they can still take today. Anekio saves the difference as an "Opening balance" row in each person's history, so
              you can always see what was imported.
            </Text>
          </ScrollView>
        )}

        {changed.length ? (
          <View className="absolute inset-x-0 bottom-0 flex-row items-center gap-3 border-t border-ink-100 bg-white px-4 py-3">
            <Text className="min-w-0 flex-1 text-[13px] text-ink-700">
              {changed.length} change{changed.length === 1 ? "" : "s"} not saved
            </Text>
            <Pressable onPress={() => setEdits({})} className="h-10 justify-center px-3">
              <Text className="text-[13px] font-semibold text-ink-600">Discard</Text>
            </Pressable>
            <Pressable onPress={() => void save()} disabled={busy} className="h-10 justify-center rounded-xl bg-[#1F45C7] px-4">
              <Text className="text-[13px] font-semibold text-white">{busy ? "Saving…" : "Save balances"}</Text>
            </Pressable>
          </View>
        ) : null}
        {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      </SafeAreaView>
    </RnModal>
  );
}
