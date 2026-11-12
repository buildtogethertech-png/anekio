import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { inr } from "../lib/payroll";
import type { useRecord } from "../lib/record";

type RecordData = NonNullable<ReturnType<typeof useRecord>["data"]>;
type Student = NonNullable<RecordData["people"]>[number];
type Catalog = NonNullable<RecordData["feeCatalog"]>;

export function classAddOnKey(label: string) {
  return String(label || "").trim().toLowerCase();
}

export function studentHasClassAddOn(addOns: { kind?: string | null; label?: string | null }[], optionLabel: string) {
  const key = classAddOnKey(optionLabel);
  if (!key) return false;
  return addOns.some((row) => {
    const kind = String(row.kind || "");
    const classKey = /^CLASS:(.+)$/i.exec(kind)?.[1]?.toLowerCase();
    if (classKey) return classKey === key;
    if (/^OTHER:/i.test(kind) || kind.toUpperCase() === "DISCOUNT" || kind.toUpperCase() === "CONCESSION") return false;
    return classAddOnKey(String(row.label || "")) === key;
  });
}

export function catalogKindId(kind?: string | null) {
  const match = /^OTHER:(.+)$/i.exec(String(kind || "").trim());
  if (!match) return null;
  return { kind: "OTHER" as const, id: match[1] };
}

export function feeAssignmentFromStudent(addOns?: { kind?: string | null; label?: string | null; amount?: number | null }[] | null) {
  const otherIds: string[] = [];
  const classAddOnLabels: string[] = [];
  let discount: { type: "FLAT" | "PERCENT"; value: number } | null = null;
  for (const addOn of addOns || []) {
    const parsed = catalogKindId(addOn.kind);
    if (parsed?.kind === "OTHER") {
      otherIds.push(parsed.id);
      continue;
    }
    const kind = String(addOn.kind || "").toUpperCase();
    if (kind === "DISCOUNT" || kind === "DISCOUNT_PERCENT") {
      discount = { type: kind === "DISCOUNT_PERCENT" ? "PERCENT" : "FLAT", value: Math.max(0, Number(addOn.amount) || 0) };
      continue;
    }
    if (kind === "CONCESSION") continue;
    const label = String(addOn.label || "").trim();
    if (label) classAddOnLabels.push(label);
  }
  return { otherIds, classAddOnLabels, discount };
}

type MonthlyFeeSummaryInput = {
  student: Student;
  templates: RecordData["feeTemplates"];
  catalog: Catalog;
  session?: { id: string };
  otherIds: string[];
  classAddOnLabels: string[];
  discountType: "FLAT" | "PERCENT";
  discountValue: string;
};

export function monthlyFeeSummary({ student, templates, catalog, session, otherIds, classAddOnLabels, discountType, discountValue }: MonthlyFeeSummaryInput) {
  const classTpl = [...(templates ?? [])]
    .filter((row) => row.classId === student.classId && (!session || row.sessionId === session.id || !row.sessionId))
    .sort((a, b) => (b.startsPeriod || "").localeCompare(a.startsPeriod || ""))[0];
  const classLines = (classTpl?.lines || []).filter((line) => line.scope !== "ADD_ON");
  const classAddOns = (classTpl?.lines || []).filter((line) => line.scope === "ADD_ON" && Number(line.amount) > 0);
  const classFee = classLines.reduce((sum, line) => sum + Math.max(0, Math.round(Number(line.amount) || 0)), 0);
  const otherOptions = catalog.items.filter((item) => item.kind === "OTHER" && item.active);
  const others = otherOptions.filter((item) => otherIds.includes(item.id));
  const selectedAddOns = classAddOns.filter((line) => classAddOnLabels.some((label) => classAddOnKey(label) === classAddOnKey(line.label)));
  const beforeDiscount = classFee + others.reduce((sum, item) => sum + item.amount, 0) + selectedAddOns.reduce((sum, line) => sum + line.amount, 0);
  const discountInput = Math.max(0, Math.round(Number(discountValue) || 0));
  const maximumDiscount = discountType === "PERCENT" ? 100 : beforeDiscount;
  const discountAmount = discountType === "PERCENT" ? Math.round(beforeDiscount * Math.min(100, discountInput) / 100) : Math.min(beforeDiscount, discountInput);
  return { classTpl, classLines, classAddOns, classFee, otherOptions, others, selectedAddOns, beforeDiscount, maximumDiscount, discountAmount, total: beforeDiscount - discountAmount, optionalCount: selectedAddOns.length + others.length };
}

export function MonthlyFeeBillSummary(props: MonthlyFeeSummaryInput) {
  const { total, classFee, others, selectedAddOns, discountAmount } = monthlyFeeSummary(props);
  const parts = [
    classFee ? `Class ${inr(classFee)}` : "",
    ...selectedAddOns.map((line) => `${line.label} ${inr(line.amount)}`),
    ...others.map((item) => `${item.label} ${inr(item.amount)}`),
  ].filter(Boolean);
  const breakdown = `${parts.join(" + ") || "No charges"}${discountAmount ? ` − Discount ${inr(discountAmount)}` : ""}`;
  return (
    <View className="flex-row items-center justify-between gap-3 rounded-2xl bg-[#1E2A44] px-4 py-3">
      <View className="min-w-0 flex-1">
        <Text className="text-[12px] font-medium text-[#A9B8D1]">Billed every month</Text>
        <Text className="mt-0.5 text-[12px] text-[#DCE3EE]" numberOfLines={2}>{breakdown}</Text>
      </View>
      <Text className="text-[22px] font-bold text-white">{inr(total)}</Text>
    </View>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <View className={`h-6 w-11 justify-center rounded-full px-0.5 ${on ? "bg-[#1F45C7]" : "bg-ink-200"}`}>
      <View className={`h-5 w-5 rounded-full bg-white shadow-sm ${on ? "self-end" : "self-start"}`} />
    </View>
  );
}

function SectionTitle({ children, hint }: { children: string; hint?: string }) {
  return (
    <View className="mb-2 flex-row items-baseline justify-between">
      <Text className="text-[13px] font-semibold uppercase tracking-wide text-ink-500">{children}</Text>
      {hint ? <Text className="text-[12px] text-ink-500">{hint}</Text> : null}
    </View>
  );
}

export function ManageFeeBody({
  student,
  templates,
  catalog,
  session,
  sessionLabel,
  otherIds,
  classAddOnLabels,
  discountType,
  discountValue,
  onToggleOther,
  onToggleClassAddOn,
  onDiscountTypeChange,
  onDiscountValueChange,
}: {
  student: Student;
  templates: RecordData["feeTemplates"];
  catalog: Catalog;
  session?: { id: string };
  sessionLabel?: string;
  otherIds: string[];
  classAddOnLabels: string[];
  discountType: "FLAT" | "PERCENT";
  discountValue: string;
  onToggleOther: (id: string) => void;
  onToggleClassAddOn: (label: string) => void;
  onDiscountTypeChange: (type: "FLAT" | "PERCENT") => void;
  onDiscountValueChange: (value: string) => void;
}) {
  const [discountFocused, setDiscountFocused] = useState(false);
  const { classLines, classAddOns, classFee, otherOptions, others, selectedAddOns, beforeDiscount, maximumDiscount, discountAmount } = monthlyFeeSummary({ student, templates, catalog, session, otherIds, classAddOnLabels, discountType, discountValue });
  const updateDiscountValue = (value: string) => {
    const digits = value.replace(/[^0-9]/g, "");
    if (!digits) return onDiscountValueChange("");
    onDiscountValueChange(String(Math.min(maximumDiscount, Number(digits))));
  };
  // Class add-ons and school-wide extras are one list to the office: the student either pays it or not.
  const extras = [
    ...classAddOns.map((line) => ({
      key: `class:${line.label}`,
      label: line.label,
      amount: line.amount,
      on: classAddOnLabels.some((label) => classAddOnKey(label) === classAddOnKey(line.label)),
      toggle: () => onToggleClassAddOn(line.label),
    })),
    ...otherOptions.map((item) => ({
      key: `other:${item.id}`,
      label: item.label,
      amount: item.amount,
      on: otherIds.includes(item.id),
      toggle: () => onToggleOther(item.id),
    })),
  ];
  const chosen = selectedAddOns.length + others.length;
  return (
    <View className="gap-5">
      <Text className="text-[13px] text-ink-500">{[student.classLabel, student.admissionNo, sessionLabel].filter(Boolean).join(" · ")}</Text>

      <View>
        <SectionTitle>Class fee</SectionTitle>
        <View className="flex-row items-center gap-3 rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3.5">
          <Ionicons name="lock-closed" size={15} color="#94A3B8" />
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold text-ink-900">{student.classLabel || "Class"} monthly plan</Text>
            <Text className="mt-0.5 text-[13px] text-ink-500" numberOfLines={2}>
              {classLines.length ? classLines.map((line) => (classLines.length > 1 ? `${line.label} ${inr(line.amount)}` : line.label)).join(" · ") : "No class fee set yet"}
            </Text>
          </View>
          <Text className="text-[16px] font-semibold text-ink-900">{inr(classFee)}</Text>
        </View>
      </View>

      {extras.length ? (
        <View>
          <SectionTitle hint={chosen ? `${chosen} on` : "Tap to add"}>Extras</SectionTitle>
          <View className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
            {extras.map((item, i) => (
              <Pressable
                key={item.key}
                accessibilityRole="switch"
                accessibilityState={{ checked: item.on }}
                accessibilityLabel={`${item.label} ${inr(item.amount)} a month`}
                onPress={item.toggle}
                className={`flex-row items-center gap-3 px-4 py-3.5 ${i ? "border-t border-ink-100" : ""}`}
              >
                <View className="min-w-0 flex-1">
                  <Text className={`text-[15px] ${item.on ? "font-semibold text-ink-900" : "text-ink-800"}`} numberOfLines={1}>{item.label}</Text>
                  <Text className="mt-0.5 text-[13px] text-ink-500">{inr(item.amount)} a month</Text>
                </View>
                <Switch on={item.on} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View>
        <SectionTitle hint="Optional">Discount</SectionTitle>
        <View className="flex-row items-center gap-2">
          <View className="flex-row rounded-xl bg-ink-100 p-1">
            {(["FLAT", "PERCENT"] as const).map((type) => (
              <Pressable
                key={type}
                accessibilityRole="radio"
                accessibilityState={{ selected: discountType === type }}
                accessibilityLabel={type === "FLAT" ? "Discount in rupees" : "Discount in percent"}
                onPress={() => onDiscountTypeChange(type)}
                className={`h-9 w-11 items-center justify-center rounded-lg ${discountType === type ? "bg-white shadow-sm" : ""}`}
              >
                <Text className={`text-[15px] font-semibold ${discountType === type ? "text-ink-900" : "text-ink-500"}`}>{type === "FLAT" ? "₹" : "%"}</Text>
              </Pressable>
            ))}
          </View>
          <View className={`h-11 min-w-0 flex-1 flex-row items-center rounded-xl border bg-white px-3 ${discountFocused ? "border-[#1F45C7]" : "border-ink-200"}`}>
            <TextInput
              value={discountValue}
              onChangeText={updateDiscountValue}
              onFocus={() => setDiscountFocused(true)}
              onBlur={() => setDiscountFocused(false)}
              keyboardType="numeric"
              placeholder={discountType === "PERCENT" ? "0 %" : "₹ 0"}
              maxLength={discountType === "PERCENT" ? 3 : String(Math.max(0, beforeDiscount)).length}
              className="min-w-0 flex-1 text-[15px] text-ink-900 outline-none focus:outline-none"
              style={{ outlineStyle: "none" } as never}
            />
            {discountAmount > 0 ? <Text className="text-[13px] font-semibold text-emerald-700">−{inr(discountAmount)}</Text> : null}
          </View>
        </View>
        <Text className="mt-1.5 text-[12px] text-ink-500">Applies to future monthly invoices · up to {discountType === "PERCENT" ? "100%" : inr(beforeDiscount)}</Text>
      </View>
    </View>
  );
}
