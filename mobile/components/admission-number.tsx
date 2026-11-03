import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Card, Field, Input } from "./ui";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";

export type AdmissionNumberInfo = {
  next: string;
  lastNo: string;
  highestSerial: number;
  studentCount: number;
  settings: { format: string; digits: number; floor: number };
  canEdit: boolean;
};

/** The number the next new student will get. The real number is fixed when the student is saved. */
export function useNextAdmissionNo(enabled = true) {
  const { token } = useSession();
  const [info, setInfo] = useState<AdmissionNumberInfo | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    act<AdmissionNumberInfo>(token, "admissionNumberInfo")
      .then((row) => { if (live) setInfo(row); })
      .catch(() => { if (live) setInfo(null); });
    return () => { live = false; };
  }, [token, enabled]);
  return info;
}

/** Read-only admission number on the Add student form. */
export function AdmissionNoPreview({ compact = false }: { compact?: boolean }) {
  const info = useNextAdmissionNo();
  return (
    <View>
      <Text className={`${compact ? "mb-1.5 text-sm font-medium text-ink-800" : "mb-1.5 text-xs font-medium text-ink-700"}`}>Admission no.</Text>
      <View className="h-11 flex-row items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3">
        <Ionicons name="lock-closed-outline" size={14} color="#64748b" />
        <Text className="flex-1 text-sm font-semibold text-ink-900" numberOfLines={1}>{info?.next || "Assigned on save"}</Text>
        <Text className="text-[11px] font-medium text-ink-600">Auto</Text>
      </View>
      <Text className="mt-1 text-[11px] leading-4 text-ink-600">Given automatically when you save. Next in your school&apos;s series.</Text>
    </View>
  );
}

type NoCheck = { state: "idle" | "same" | "checking" | "free" | "taken" | "error"; text?: string };

/** A pending admission-number correction, saved together with the rest of the student by the parent form. */
export type AdmissionNoDraft = { admissionNo: string; reason: string; problem: string };

/** Edit student: number is read-only; the school admin can correct it with a reason (logged). */
export function AdmissionNoField({ studentId, admissionNo, canChange, onDraft }: { studentId: string; admissionNo: string; canChange: boolean; onDraft: (draft: AdmissionNoDraft | null) => void }) {
  const { token } = useSession();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(admissionNo);
  const [reason, setReason] = useState("");
  const [check, setCheck] = useState<NoCheck>({ state: "idle" });
  useEffect(() => {
    setValue(admissionNo);
    setReason("");
    setOpen(false);
    setCheck({ state: "idle" });
  }, [studentId, admissionNo]);
  // Closing the edit form drops any unsaved correction.
  useEffect(() => () => onDraft(null), []);
  // Tell the form what Save changes should do with the number.
  useEffect(() => {
    const next = value.replace(/\s+/g, " ").trim();
    if (!open || !next || next === admissionNo) return onDraft(null);
    const problem =
      check.state === "taken" ? check.text || "That admission number already exists."
      : check.state === "checking" ? "Still checking the admission number. Try again in a moment."
      : check.state === "error" ? "Could not check the admission number."
      : "";
    onDraft({ admissionNo: next, reason: reason.trim(), problem });
  }, [open, value, reason, check, admissionNo]);
  // Live "already exists" check while the admin types.
  useEffect(() => {
    if (!open) return;
    const next = value.replace(/\s+/g, " ").trim();
    if (!next) return setCheck({ state: "idle" });
    if (next === admissionNo) return setCheck({ state: "same" });
    setCheck({ state: "checking" });
    let live = true;
    const t = setTimeout(() => {
      act<{ available: boolean; holder: { name: string; classLabel: string } | null }>(token, "checkAdmissionNumber", { studentId, admissionNo: next })
        .then((row) => {
          if (!live) return;
          setCheck(row.available ? { state: "free", text: `${next} is available` } : { state: "taken", text: `Already exists: ${row.holder?.name || "another student"}${row.holder?.classLabel ? ` (${row.holder.classLabel})` : ""}` });
        })
        .catch(() => live && setCheck({ state: "error", text: "Could not check right now." }));
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [value, open, studentId, admissionNo, token]);
  const tone =
    check.state === "taken" ? { border: "border-red-300", icon: "close-circle" as const, color: "#b91c1c", text: "text-red-700" }
    : check.state === "free" ? { border: "border-emerald-300", icon: "checkmark-circle" as const, color: "#047857", text: "text-emerald-700" }
    : { border: "border-ink-200", icon: null, color: "#64748b", text: "text-ink-600" };
  return (
    <View className="gap-1.5">
      <Text className="text-xs font-medium text-ink-700">Admission no.</Text>
      {!open ? (
        <>
          <View className="h-11 flex-row items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 pl-3 pr-1.5">
            <Ionicons name="lock-closed-outline" size={14} color="#64748b" />
            <Text className="min-w-0 flex-1 text-sm font-semibold text-ink-900" numberOfLines={1}>{admissionNo}</Text>
            {canChange ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Correct admission number"
                onPress={() => setOpen(true)}
                className="h-8 flex-row items-center gap-1 rounded-md px-2.5 hover:bg-blue-50"
              >
                <Ionicons name="create-outline" size={14} color="#1d4ed8" />
                <Text className="text-xs font-semibold text-blue-700">Correct</Text>
              </Pressable>
            ) : null}
          </View>
          <Text className="text-[11px] leading-4 text-ink-600">{canChange ? "Set automatically. Correct it only if it is wrong." : "Set automatically. Only the school admin can correct it."}</Text>
        </>
      ) : (
        <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
          <View className="flex-row items-center gap-2 border-b border-ink-100 bg-ink-50 px-3 py-2.5">
            <Ionicons name="lock-closed-outline" size={13} color="#64748b" />
            <Text className="min-w-0 flex-1 text-xs text-ink-700" numberOfLines={1}>
              Current <Text className="font-semibold text-ink-900">{admissionNo}</Text>
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Keep the current admission number"
              onPress={() => { setOpen(false); setValue(admissionNo); setReason(""); setCheck({ state: "idle" }); }}
              hitSlop={8}
            >
              <Text className="text-xs font-semibold text-ink-700">Keep current</Text>
            </Pressable>
          </View>
          <View className="gap-3 p-3">
            <View className="gap-1">
              <Text className="text-xs font-medium text-ink-700">New admission no.</Text>
              <View className={`h-11 flex-row items-center rounded-lg border bg-white pr-3 ${tone.border}`}>
                <TextInput
                  value={value}
                  onChangeText={setValue}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoFocus
                  placeholder="e.g. 1532"
                  placeholderTextColor="#94a3b8"
                  className="h-full min-w-0 flex-1 px-3 text-sm font-semibold text-ink-900"
                  style={{ outlineStyle: "none" } as object}
                />
                {check.state === "checking" ? <ActivityIndicator size="small" color="#64748b" /> : tone.icon ? <Ionicons name={tone.icon} size={18} color={tone.color} /> : null}
              </View>
              {check.text ? (
                <Text className={`text-xs ${tone.text}`}>{check.text}</Text>
              ) : check.state === "same" ? (
                <Text className="text-xs text-ink-600">This is the current number.</Text>
              ) : null}
            </View>
            <View className="gap-1">
              <Text className="text-xs font-medium text-ink-700">Reason <Text className="font-normal text-ink-500">(optional)</Text></Text>
              <Input value={reason} onChangeText={setReason} placeholder="e.g. Matches the paper register" />
            </View>
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="shield-checkmark-outline" size={13} color="#64748b" />
              <Text className="flex-1 text-[11px] leading-4 text-ink-600">Saved when you press Save changes. Logged with your name.</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

/** Settings → Forms: how new admission numbers look. Counting is always automatic (highest + 1). */
export function AdmissionNumberCard({ canEdit }: { canEdit: boolean }) {
  const { token } = useSession();
  const [info, setInfo] = useState<AdmissionNumberInfo | null>(null);
  const [format, setFormat] = useState("");
  const [digits, setDigits] = useState("");
  const [floor, setFloor] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  function apply(row: AdmissionNumberInfo) {
    setInfo(row);
    setFormat(row.settings.format);
    setDigits(row.settings.digits ? String(row.settings.digits) : "");
    setFloor(row.settings.floor ? String(row.settings.floor) : "");
  }
  useEffect(() => {
    act<AdmissionNumberInfo>(token, "admissionNumberInfo").then(apply).catch(() => setInfo(null));
  }, [token]);
  async function save() {
    setBusy(true);
    setNote("");
    try {
      apply(await act<AdmissionNumberInfo>(token, "saveAdmissionNumberSettings", { format, digits: Number(digits) || 0, floor: Number(floor) || 0 }));
      setNote("Saved.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="p-5">
      <View className="flex-row items-start gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-xl bg-blue-50">
          <Ionicons name="id-card-outline" size={22} color="#1d4ed8" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-base font-semibold text-ink-900">Admission numbers</Text>
          <Text className="mt-1 text-sm leading-5 text-ink-700">
            Every new student gets the next number automatically. Numbers you imported stay as they are; new ones continue after the highest.
          </Text>
        </View>
      </View>
      <View className="mt-4 flex-row flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-ink-50 px-4 py-3">
        <Text className="text-sm text-ink-700">Next student gets <Text className="font-semibold text-ink-900">{info?.next || "—"}</Text></Text>
        {info?.lastNo ? <Text className="text-sm text-ink-700">Highest so far <Text className="font-semibold text-ink-900">{info.lastNo}</Text></Text> : null}
      </View>
      {canEdit ? (
        <View className="mt-4 gap-3">
          <View className="flex-row flex-wrap gap-3">
            <View className="min-w-[220px] flex-1">
              <Field label="Format" hint="{N} = number, {YYYY} or {YY} = session year. Blank = same look as the highest number.">
                <Input value={format} onChangeText={setFormat} placeholder={info?.lastNo ? "Same as last number" : "ADM-{N}"} autoCapitalize="characters" />
              </Field>
            </View>
            <View className="w-[140px]">
              <Field label="Digits" hint="0501 = 4. Blank = same as last.">
                <Input value={digits} onChangeText={(v) => setDigits(v.replace(/\D/g, "").slice(0, 1))} keyboardType="number-pad" placeholder="Auto" />
              </Field>
            </View>
            <View className="w-[180px]">
              <Field label="Next number at least" hint="If your paper register is ahead.">
                <Input value={floor} onChangeText={(v) => setFloor(v.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" placeholder="Off" />
              </Field>
            </View>
          </View>
          <View className="flex-row items-center justify-end gap-3">
            {note ? <Text className={`text-xs ${note === "Saved." ? "text-emerald-700" : "text-red-700"}`}>{note}</Text> : null}
            <Button onPress={save} disabled={busy}>{busy ? "Saving…" : "Save numbering"}</Button>
          </View>
        </View>
      ) : (
        <Text className="mt-3 text-xs text-ink-600">Only the school admin can change the format.</Text>
      )}
    </Card>
  );
}
