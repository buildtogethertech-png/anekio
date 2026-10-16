import { useMemo, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Field, Input, Switch, Toast, useToast } from "./ui";
import {
  DEFAULT_PAYROLL_RULES,
  daysInMonth,
  dayKind,
  inr,
  monthTitle,
  normalizeHHmm,
  parsePayrollRules,
  type PayrollRules,
  type SalaryBasis,
} from "../lib/payroll";
import type { SchoolCalendar } from "../lib/calendar";

type Draft = {
  salaryBasis: SalaryBasis;
  fixedMonthDays: string;
  sandwichRule: boolean;
  unmarkedAs: "PRESENT" | "ABSENT";
  startTime: string;
  endTime: string;
  graceMinutes: string;
  freeLateCount: string;
  latesPerLeaveDay: string;
  latePenaltyDays: number;
};

function toDraft(r: PayrollRules): Draft {
  return {
    salaryBasis: r.salaryBasis,
    fixedMonthDays: String(r.fixedMonthDays),
    sandwichRule: r.sandwichRule,
    unmarkedAs: r.unmarkedAs,
    startTime: r.startTime,
    endTime: r.endTime,
    graceMinutes: String(r.graceMinutes),
    freeLateCount: String(r.freeLateCount),
    latesPerLeaveDay: String(r.latesPerLeaveDay),
    latePenaltyDays: r.latePenaltyDays,
  };
}

const SAMPLE_SALARY = 30000;

function Section({ icon, title, lede, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; lede?: string; children: ReactNode }) {
  return (
    <View className="rounded-2xl border border-ink-200 bg-white p-4">
      <View className="flex-row items-center gap-2.5">
        <View className="h-8 w-8 items-center justify-center rounded-lg bg-[#EEF3FF]">
          <Ionicons name={icon} size={16} color="#1F45C7" />
        </View>
        <Text className="text-[15px] font-semibold text-ink-900">{title}</Text>
      </View>
      {lede ? <Text className="mt-1.5 text-[13px] leading-[19px] text-ink-700">{lede}</Text> : null}
      <View className="mt-3 gap-3">{children}</View>
    </View>
  );
}

function Chips<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={String(o.id)}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${o.label}`}
            accessibilityState={{ selected: on, disabled }}
            disabled={disabled}
            onPress={() => onChange(o.id)}
            className={`rounded-full border px-3.5 py-2 ${on ? "border-[#2855F6] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
          >
            <Text className={`text-[13px] font-medium ${on ? "text-[#1F45C7]" : "text-ink-700"}`}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ToggleRow({ title, body, on, onPress, disabled }: { title: string; body: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <View className={`flex-row items-start gap-3 ${disabled ? "opacity-50" : ""}`}>
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-medium text-ink-900">{title}</Text>
        <Text className="mt-0.5 text-[12px] leading-[17px] text-ink-500">{body}</Text>
      </View>
      <Switch on={on} disabled={disabled} onPress={onPress} />
    </View>
  );
}

/**
 * HR & Payroll → Payroll rules. Everything that turns attendance into salary:
 * salary day basis, paid offs, sandwich rule, unmarked days, half days, timing and lates.
 */
export function PayrollRulesForm({
  rules,
  calendar,
  canEdit,
  onSave,
}: {
  rules?: unknown;
  calendar: SchoolCalendar;
  canEdit: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const toast = useToast();
  const saved = useMemo(() => parsePayrollRules(rules ? JSON.stringify(rules) : null), [rules]);
  const [d, setD] = useState<Draft>(() => toDraft(saved));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((cur) => ({ ...cur, [key]: value }));
  const offsCount = d.salaryBasis !== "WORKING";

  // Live example for this month so the choice is concrete.
  const example = useMemo(() => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const dates = daysInMonth(month);
    const working = dates.filter((date) => dayKind(date, calendar) === "working").length;
    const fixed = Math.min(31, Math.max(20, Number(d.fixedMonthDays) || 30));
    const divisor = d.salaryBasis === "CALENDAR" ? dates.length : d.salaryBasis === "FIXED" ? fixed : working;
    return { month: monthTitle(month), divisor, perDay: divisor ? SAMPLE_SALARY / divisor : 0 };
  }, [calendar, d.fixedMonthDays, d.salaryBasis]);

  const lateCutOn = Number(d.latesPerLeaveDay) > 0;
  const lateFrom = useMemo(() => {
    const start = normalizeHHmm(d.startTime);
    const grace = Number(d.graceMinutes);
    if (!start || !Number.isFinite(grace) || grace < 0) return "";
    const [h, m] = start.split(":").map(Number);
    const t = h * 60 + m + grace;
    const hh = Math.floor(t / 60) % 24;
    return `${hh % 12 || 12}:${String(t % 60).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
  }, [d.graceMinutes, d.startTime]);

  async function save() {
    if (!canEdit || busy) return;
    const start = normalizeHHmm(d.startTime);
    if (!start) throw new Error("Day starts must be a time like 08:00.");
    const end = d.endTime.trim() ? normalizeHHmm(d.endTime) : "";
    if (d.endTime.trim() && !end) throw new Error("Day ends must be a time like 14:00.");
    const grace = Number(d.graceMinutes);
    if (!Number.isFinite(grace) || grace < 0) throw new Error("Grace minutes must be 0 or more.");
    const fixed = Number(d.fixedMonthDays);
    if (d.salaryBasis === "FIXED" && (!Number.isInteger(fixed) || fixed < 20 || fixed > 31)) throw new Error("Fixed days must be between 20 and 31.");
    setBusy(true);
    try {
      await onSave({
        salaryBasis: d.salaryBasis,
        fixedMonthDays: Number.isInteger(fixed) ? fixed : 30,
        // Weekly offs and holidays are always paid; a half day always pays half.
        paidWeeklyOffs: true,
        paidHolidays: true,
        sandwichRule: d.sandwichRule,
        unmarkedAs: d.unmarkedAs,
        halfDayCredit: 0.5,
        startTime: start,
        endTime: end,
        graceMinutes: grace,
        freeLateCount: Math.max(0, Math.floor(Number(d.freeLateCount) || 0)),
        latesPerLeaveDay: Math.max(0, Math.floor(Number(d.latesPerLeaveDay) || 0)),
        latePenaltyDays: d.latePenaltyDays,
        lateDeductionMode: "NONE",
        lateDeductionAmount: 0,
        lateDayFraction: 0,
      });
    } finally {
      setBusy(false);
    }
  }

  const basisCard = (id: SalaryBasis, title: string, body: string, tag?: string) => {
    const on = d.salaryBasis === id;
    return (
      <Pressable
        key={id}
        accessibilityRole="radio"
        accessibilityLabel={title}
        accessibilityState={{ selected: on, disabled: !canEdit }}
        disabled={!canEdit}
        onPress={() => set("salaryBasis", id)}
        className={`flex-row items-start gap-3 rounded-xl border p-3 ${on ? "border-[#2855F6] bg-[#F5F8FF]" : "border-ink-200 bg-white"}`}
      >
        <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded-full border-2 ${on ? "border-[#2855F6]" : "border-ink-300"}`}>
          {on ? <View className="h-2.5 w-2.5 rounded-full bg-[#2855F6]" /> : null}
        </View>
        <View className="min-w-0 flex-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-[14px] font-semibold text-ink-900">{title}</Text>
            {tag ? (
              <View className="rounded-full bg-[#ECFDF5] px-2 py-0.5">
                <Text className="text-[10px] font-semibold text-[#047857]">{tag}</Text>
              </View>
            ) : null}
          </View>
          <Text className="mt-0.5 text-[12px] leading-[17px] text-ink-500">{body}</Text>
          {id === "FIXED" && on ? (
            <View className="mt-2.5">
              <Chips
                label="Fixed days"
                value={d.fixedMonthDays}
                disabled={!canEdit}
                options={[
                  { id: "30", label: "30 days" },
                  { id: "26", label: "26 days (6-day week)" },
                ]}
                onChange={(v) => set("fixedMonthDays", v)}
              />
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View className="gap-4">
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}

      <Section icon="calculator-outline" title="Salary day basis" lede="Monthly salary is fixed. This decides what one day's pay is, so absent and unpaid days are cut fairly.">
        {basisCard("CALENDAR", "Calendar days", "Salary ÷ days in the month (28–31). Sundays and holidays are paid.", "Recommended")}
        {basisCard("FIXED", "Fixed days", "Salary ÷ the same number every month. Simple for staff to understand.")}
        {basisCard("WORKING", "Working days only", "Salary ÷ days the school is open that month. An absence costs more in short months.")}
        <View className="flex-row items-center gap-2 rounded-xl bg-ink-50 px-3 py-2.5">
          <Ionicons name="bulb-outline" size={15} color="#64748b" />
          <Text className="min-w-0 flex-1 text-[12px] leading-[17px] text-ink-700">
            {`${example.month}: on ${inr(SAMPLE_SALARY)} salary, 1 day = ${inr(example.perDay, 0)} (÷ ${example.divisor}).`}
          </Text>
        </View>
      </Section>

      <Section icon="checkmark-done-outline" title="Counting attendance">
        <Field label="Days nobody marked" hint="If attendance wasn't saved for a past working day.">
          <Chips
            label="Unmarked days"
            value={d.unmarkedAs}
            disabled={!canEdit}
            options={[
              { id: "PRESENT", label: "Count as present" },
              { id: "ABSENT", label: "Count as absent" },
            ]}
            onChange={(v) => set("unmarkedAs", v)}
          />
        </Field>
        <ToggleRow
          title="Sandwich rule"
          body={offsCount ? "Absent on Saturday and Monday? The Sunday in between is unpaid too." : "Not used with working-days basis, since offs aren't counted."}
          on={d.sandwichRule}
          disabled={!canEdit || !offsCount}
          onPress={() => set("sandwichRule", !d.sandwichRule)}
        />
      </Section>

      <Section icon="alarm-outline" title="Timing & lates">
        <View className="flex-row flex-wrap items-end gap-3">
          <Field label="Day starts">
            <Input value={d.startTime} editable={canEdit} onChangeText={(v) => set("startTime", v)} placeholder="08:00" className="w-24" accessibilityLabel="Day starts" />
          </Field>
          <Field label="Grace (minutes)">
            <Input keyboardType="number-pad" editable={canEdit} value={d.graceMinutes} onChangeText={(v) => set("graceMinutes", v)} className="w-24" accessibilityLabel="Grace minutes" />
          </Field>
        </View>
        {lateFrom ? <Text className="-mt-1 text-[12px] text-ink-500">{`Anyone coming in after ${lateFrom} is marked Late.`}</Text> : null}

        <View className="h-px bg-ink-100" />

        <ToggleRow
          title="Cut pay for repeated lates"
          body="A few lates are fine; too many in a month cost pay."
          on={lateCutOn}
          disabled={!canEdit}
          onPress={() => set("latesPerLeaveDay", lateCutOn ? "0" : "3")}
        />
        {lateCutOn ? (
          <View className="gap-2.5 rounded-xl bg-ink-50 p-3">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-[14px] text-ink-800">Every</Text>
              <Input
                keyboardType="number-pad"
                editable={canEdit}
                value={d.latesPerLeaveDay}
                onChangeText={(v) => set("latesPerLeaveDay", v)}
                className="w-14 text-center"
                accessibilityLabel="Lates per leave day"
              />
              <Text className="text-[14px] text-ink-800">lates cut</Text>
              <Chips
                label="Late cut"
                value={d.latePenaltyDays}
                disabled={!canEdit}
                options={[
                  { id: 1, label: "1 day" },
                  { id: 0.5, label: "½ day" },
                ]}
                onChange={(v) => set("latePenaltyDays", v)}
              />
            </View>
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-[14px] text-ink-800">First</Text>
              <Input
                keyboardType="number-pad"
                editable={canEdit}
                value={d.freeLateCount}
                onChangeText={(v) => set("freeLateCount", v)}
                className="w-14 text-center"
                accessibilityLabel="Free lates per month"
              />
              <Text className="text-[14px] text-ink-800">lates each month are free</Text>
            </View>
          </View>
        ) : null}
      </Section>

      {canEdit ? (
        <View
          className="sticky bottom-0 z-10 -mx-1 flex-row flex-wrap items-center gap-3 border-t border-ink-100 bg-[#F7F9FC] px-1 py-3 pr-20"
          style={Platform.OS === "web" ? undefined : { paddingBottom: 12 }}
        >
          <Button
            disabled={busy}
            accessibilityLabel="Save payroll rules"
            onPress={() => {
              void save().catch((e) => toast.show(e instanceof Error ? e.message : "Could not save."));
            }}
          >
            {busy ? "Saving…" : "Save payroll rules"}
          </Button>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setD(toDraft(DEFAULT_PAYROLL_RULES));
              toast.show("Defaults filled in. Save to apply.");
            }}
            className="px-2 py-2"
          >
            <Text className="text-[13px] font-semibold text-[#1F45C7]">Reset to defaults</Text>
          </Pressable>
        </View>
      ) : (
        <Text className="text-xs text-amber-800">You need school.edit or staff.edit to change payroll rules.</Text>
      )}
    </View>
  );
}
