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
  const { total, optionalCount, discountAmount } = monthlyFeeSummary(props);
  return (
    <View className="rounded-xl bg-[#102A5C] px-4 py-3">
      <View className="flex-row items-center justify-between">
        <View><Text className="text-[11px] font-semibold uppercase tracking-wide text-blue-100">Monthly amount to bill</Text><Text className="mt-1 text-xs text-blue-100">{discountAmount ? `${inr(discountAmount)} discount applied` : optionalCount ? `${optionalCount} optional charge${optionalCount === 1 ? "" : "s"} included` : "Class fee only"}</Text></View>
        <View className="items-end"><Text className="text-xl font-semibold text-white">{inr(total)}</Text><Text className="text-[11px] text-blue-100">per month</Text></View>
      </View>
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
  const { classLines, classAddOns, classFee, otherOptions, others, selectedAddOns, beforeDiscount, maximumDiscount, discountAmount, total } = monthlyFeeSummary({ student, templates, catalog, session, otherIds, classAddOnLabels, discountType, discountValue });
  const discountInput = Math.max(0, Math.round(Number(discountValue) || 0));
  const updateDiscountValue = (value: string) => {
    const digits = value.replace(/[^0-9]/g, "");
    if (!digits) return onDiscountValueChange("");
    onDiscountValueChange(String(Math.min(maximumDiscount, Number(digits))));
  };
  const initials = student.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between rounded-xl border border-ink-100 bg-ink-50 p-3">
        <View className="flex-row items-center gap-3">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-clay-100">
            <Text className="text-sm font-semibold text-clay-700">{initials || "S"}</Text>
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold text-ink-900" numberOfLines={1}>{student.name}</Text>
            <Text className="mt-0.5 text-xs text-ink-700" numberOfLines={1}>{student.classLabel} · {student.admissionNo}</Text>
            {sessionLabel ? <Text className="mt-0.5 text-[11px] text-ink-500">{sessionLabel}</Text> : null}
          </View>
        </View>
        <View className="items-end">
          <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Monthly fee</Text>
          <Text className="mt-0.5 text-base font-semibold text-ink-900">{inr(total)}</Text>
        </View>
      </View>

      <View className="rounded-xl border border-blue-100 bg-blue-50 p-3">
        <View className="flex-row items-start justify-between gap-3">
          <View>
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-600">Required class fee</Text>
            <Text className="mt-1 text-sm font-semibold text-ink-900">{student.classLabel || "Class"} monthly plan</Text>
            <Text className="mt-0.5 text-xs text-ink-700">Applied automatically every month</Text>
          </View>
          <Text className="text-base font-semibold text-ink-900">{inr(classFee)}</Text>
        </View>
        {classLines.length ? <View className="mt-3 border-t border-blue-100 pt-2">{classLines.map((line) => (
          <View key={`${line.label}-${line.amount}`} className="flex-row justify-between py-1">
            <Text className="text-xs text-ink-700">{line.label}</Text>
            <Text className="text-xs font-medium text-ink-800">{inr(line.amount)}</Text>
          </View>
        ))}</View> : <Text className="mt-3 border-t border-blue-100 pt-2 text-xs text-ink-600">No class fee lines are configured yet.</Text>}
      </View>

      <View className="rounded-xl border border-ink-200 bg-white p-3">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text className="text-sm font-semibold text-ink-900">Optional class add-ons</Text>
            <Text className="mt-0.5 text-xs leading-4 text-ink-600">Choose only charges this student should receive every month.</Text>
          </View>
          <View className="rounded-full bg-ink-100 px-2 py-1"><Text className="text-[10px] font-semibold text-ink-700">{selectedAddOns.length} selected</Text></View>
        </View>
        {classAddOns.length ? <View className="mt-3 gap-2">{classAddOns.map((item) => {
          const checked = classAddOnLabels.some((label) => classAddOnKey(label) === classAddOnKey(item.label));
          return <Pressable key={item.label} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onToggleClassAddOn(item.label)} className={`flex-row items-center justify-between rounded-lg border px-3 py-2.5 ${checked ? "border-clay-300 bg-blue-50" : "border-ink-200 bg-white"}`}>
            <View className="flex-row items-center gap-2.5"><View className={`h-5 w-5 items-center justify-center rounded-md border ${checked ? "border-clay-600 bg-clay-600" : "border-ink-300 bg-white"}`}><Text className="text-[11px] font-bold text-white">{checked ? "✓" : ""}</Text></View><Text className="text-sm font-medium text-ink-900">{item.label}</Text></View>
            <Text className="text-sm font-semibold text-ink-800">{inr(item.amount)}</Text>
          </Pressable>;
        })}</View> : <Text className="mt-3 text-xs text-ink-600">No optional add-ons are configured for this class.</Text>}
      </View>

      {otherOptions.length ? <View className="rounded-xl border border-ink-200 bg-white p-3">
        <View className="flex-row items-start justify-between gap-3"><View className="flex-1"><Text className="text-sm font-semibold text-ink-900">Universal add-ons</Text><Text className="mt-0.5 text-xs leading-4 text-ink-600">Optional charges available to every student in the school.</Text></View><View className="rounded-full bg-ink-100 px-2 py-1"><Text className="text-[10px] font-semibold text-ink-700">{others.length} selected</Text></View></View>
        <View className="mt-3 gap-2">{otherOptions.map((item) => {
          const checked = otherIds.includes(item.id);
          return <Pressable key={item.id} accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onToggleOther(item.id)} className={`flex-row items-center justify-between rounded-lg border px-3 py-2.5 ${checked ? "border-clay-300 bg-blue-50" : "border-ink-200 bg-white"}`}>
            <View className="flex-row items-center gap-2.5"><View className={`h-5 w-5 items-center justify-center rounded-md border ${checked ? "border-clay-600 bg-clay-600" : "border-ink-300 bg-white"}`}><Text className="text-[11px] font-bold text-white">{checked ? "✓" : ""}</Text></View><Text className="text-sm font-medium text-ink-900">{item.label}</Text></View>
            <Text className="text-sm font-semibold text-ink-800">{inr(item.amount)}</Text>
          </Pressable>;
        })}</View>
      </View> : null}

      <View className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <Text className="text-sm font-semibold text-ink-900">Discount</Text>
        <Text className="mt-0.5 text-xs leading-4 text-ink-600">Optional. It applies to this student’s future monthly invoices.</Text>
        <View className="mt-3 flex-row rounded-lg border border-emerald-200 bg-white p-1">
          {(["FLAT", "PERCENT"] as const).map((type) => <Pressable key={type} accessibilityRole="radio" accessibilityState={{ selected: discountType === type }} onPress={() => onDiscountTypeChange(type)} className={`flex-1 rounded-md px-3 py-2 ${discountType === type ? "bg-emerald-600" : "bg-white"}`}><Text className={`text-center text-xs font-semibold ${discountType === type ? "text-white" : "text-ink-700"}`}>{type === "FLAT" ? "Flat amount" : "Percentage"}</Text></Pressable>)}
        </View>
        <View className={`mt-3 flex-row items-center rounded-lg border bg-white px-3 ${discountFocused ? "border-emerald-500" : "border-emerald-200"}`}>
          <Text className="mr-2 text-base font-semibold text-ink-700">{discountType === "PERCENT" ? "%" : "₹"}</Text>
          <TextInput value={discountValue} onChangeText={updateDiscountValue} onFocus={() => setDiscountFocused(true)} onBlur={() => setDiscountFocused(false)} keyboardType="numeric" placeholder={discountType === "PERCENT" ? "e.g. 10" : "e.g. 500"} maxLength={discountType === "PERCENT" ? 3 : String(Math.max(0, beforeDiscount)).length} className="flex-1 py-2.5 text-sm text-ink-900 outline-none focus:outline-none" style={{ outlineStyle: "none" } as never} />
          {discountAmount > 0 ? <Text className="text-xs font-semibold text-emerald-700">−{inr(discountAmount)}</Text> : null}
        </View>
        <Text className="mt-2 text-[11px] text-emerald-800">Maximum: {discountType === "PERCENT" ? "100%" : inr(beforeDiscount)}</Text>
      </View>

    </View>
  );
}
