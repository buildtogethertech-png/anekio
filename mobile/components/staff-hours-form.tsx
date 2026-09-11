import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Button, Field, Input, Toast, useToast } from "./ui";
import { normalizeHHmm, parsePayrollRules } from "../lib/payroll";
import type { RecordPayload } from "../lib/record";

export type StaffHoursFormHandle = { save: () => Promise<void> };

export const StaffHoursForm = forwardRef<
  StaffHoursFormHandle,
  {
    rules?: RecordPayload["payrollRules"];
    canEdit: boolean;
    onSave: (payload: Record<string, unknown>) => Promise<void>;
    compact?: boolean;
    hideButton?: boolean;
  }
>(function StaffHoursForm({ rules, canEdit, onSave, compact, hideButton }, ref) {
  const parsed = parsePayrollRules(rules ? JSON.stringify(rules) : null);
  const [startTime, setStartTime] = useState(parsed.startTime);
  const [endTime, setEndTime] = useState(parsed.endTime);
  const [graceMinutes, setGraceMinutes] = useState(String(parsed.graceMinutes));
  const [freeLateCount, setFreeLateCount] = useState(String(parsed.freeLateCount));
  const [latesPerLeaveDay, setLatesPerLeaveDay] = useState(String(parsed.latesPerLeaveDay));
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const draft = useRef({
    canEdit,
    onSave,
    startTime,
    endTime,
    graceMinutes,
    freeLateCount,
    latesPerLeaveDay,
  });
  draft.current = {
    canEdit,
    onSave,
    startTime,
    endTime,
    graceMinutes,
    freeLateCount,
    latesPerLeaveDay,
  };

  async function save() {
    const cur = draft.current;
    if (busy || !cur.canEdit) return;
    const start = normalizeHHmm(cur.startTime);
    if (!start) throw new Error("Day starts must be a time like 08:00.");
    const end = cur.endTime.trim() ? normalizeHHmm(cur.endTime) : "";
    if (cur.endTime.trim() && !end) throw new Error("Day ends must be a time like 14:00.");
    const grace = Number(cur.graceMinutes);
    if (!Number.isFinite(grace) || grace < 0) throw new Error("Grace minutes must be 0 or more.");
    setBusy(true);
    try {
      await cur.onSave({
        startTime: start,
        endTime: end,
        graceMinutes: grace,
        freeLateCount: Number(cur.freeLateCount) || 0,
        lateDeductionMode: "NONE",
        lateDeductionAmount: 0,
        lateDayFraction: 0,
        latesPerLeaveDay: Number(cur.latesPerLeaveDay) || 0,
      });
    } finally {
      setBusy(false);
    }
  }

  useImperativeHandle(ref, () => ({ save }), [busy]);

  return (
    <View className={compact ? "" : "rounded-md border border-ink-200 p-3"}>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {compact ? null : (
        <>
          <Text className="text-sm font-medium text-ink-900">Staff attendance hours</Text>
          <Text className="mt-0.5 text-xs text-ink-700">
            This sets school start and grace for Late vs Present on Timesheet In times.
          </Text>
        </>
      )}
      <View className="mt-3 flex-row flex-wrap gap-3">
        <Field label="Day starts">
          <Input value={startTime} onChangeText={setStartTime} placeholder="08:00" className="w-28" accessibilityLabel="Day starts" />
        </Field>
        <Field label="Grace minutes">
          <Input
            keyboardType="number-pad"
            value={graceMinutes}
            onChangeText={setGraceMinutes}
            className="w-24"
            accessibilityLabel="Grace minutes"
          />
        </Field>
        <Field label="Free late days / month">
          <Input keyboardType="number-pad" value={freeLateCount} onChangeText={setFreeLateCount} className="w-24" />
        </Field>
        <Field label="Day ends (optional)">
          <Input value={endTime} onChangeText={setEndTime} placeholder="14:00" className="w-28" />
        </Field>
      </View>
      <View className="mt-3">
        <Text className="text-xs font-medium text-ink-800">Lates that equal 1 unpaid absent day</Text>
        <Text className="mt-0.5 text-[11px] text-ink-500">
          3 lates = 1 day cut from payable salary. 6 lates = 2 days. Remainder stays Late.
        </Text>
        <View className="mt-2 flex-row flex-wrap items-center gap-2">
          {(
            [
              ["0", "Off"],
              ["3", "3 = 1 day"],
              ["5", "5 = 1 day"],
            ] as const
          ).map(([value, label]) => {
            const active = latesPerLeaveDay === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`${label} late leave rule`}
                onPress={() => setLatesPerLeaveDay(value)}
                className={`rounded-md border px-3 py-2 ${active ? "border-clay-500 bg-[#EEF2FF]" : "border-ink-200 bg-white"}`}
              >
                <Text className={`text-xs font-medium ${active ? "text-clay-700" : "text-ink-800"}`}>{label}</Text>
              </Pressable>
            );
          })}
          <Field label="Custom">
            <Input
              keyboardType="number-pad"
              value={latesPerLeaveDay}
              onChangeText={setLatesPerLeaveDay}
              className="w-20"
              accessibilityLabel="Lates per leave day"
            />
          </Field>
        </View>
      </View>
      {canEdit && !hideButton ? (
        <View className="mt-3">
          <Button
            disabled={busy}
            onPress={() => {
              void save().catch((e) => {
                toast.show(e instanceof Error ? e.message : "Could not save.");
              });
            }}
            style={Platform.OS === "web" ? { cursor: busy ? "default" : "pointer" } : undefined}
          >
            {busy ? "Saving…" : "Save late timing"}
          </Button>
        </View>
      ) : null}
    </View>
  );
});
