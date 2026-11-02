import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
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

/** Edit student: number is read-only; the school admin can correct it with a reason (logged). */
export function AdmissionNoField({ studentId, admissionNo, canChange, onChanged }: { studentId: string; admissionNo: string; canChange: boolean; onChanged: () => void | Promise<void> }) {
  const { token } = useSession();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(admissionNo);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setValue(admissionNo);
    setReason("");
    setError("");
    setOpen(false);
  }, [studentId, admissionNo]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await act(token, "changeAdmissionNumber", { studentId, admissionNo: value, reason });
      setOpen(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the admission number.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Field label="Admission no.">
      <View className="h-11 flex-row items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3">
        <Ionicons name="lock-closed-outline" size={14} color="#64748b" />
        <Text className="flex-1 text-sm font-semibold text-ink-900" numberOfLines={1}>{admissionNo}</Text>
        {canChange && !open ? (
          <Pressable accessibilityRole="button" onPress={() => setOpen(true)} hitSlop={8}>
            <Text className="text-xs font-semibold text-blue-700">Change</Text>
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <View className="mt-2 gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <Text className="text-xs leading-4 text-amber-900">Only correct a mistake. The change is logged with your name and reason.</Text>
          <Input value={value} onChangeText={setValue} placeholder="New admission number" autoCapitalize="characters" />
          <Input value={reason} onChangeText={setReason} placeholder="Reason, e.g. matches paper register" />
          {error ? <Text className="text-xs text-red-700">{error}</Text> : null}
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onPress={save} disabled={busy || !value.trim() || !reason.trim()}>{busy ? "Saving…" : "Save number"}</Button>
          </View>
        </View>
      ) : (
        <Text className="text-[11px] leading-4 text-ink-600">{canChange ? "Set automatically. Change only to correct a mistake." : "Set automatically. Only the school admin can correct it."}</Text>
      )}
    </Field>
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
