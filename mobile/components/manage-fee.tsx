import { Pressable, Text, View } from "react-native";
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
    if (/^(TRANSPORT|OTHER):/i.test(kind) || kind.toUpperCase() === "DISCOUNT" || kind.toUpperCase() === "CONCESSION") return false;
    return classAddOnKey(String(row.label || "")) === key;
  });
}

export function ManageFeeBody({
  student,
  templates,
  catalog,
  session,
  sessionLabel,
  transportId,
  otherIds,
  classAddOnLabels,
  onTransport,
  onToggleOther,
  onToggleClassAddOn,
}: {
  student: Student;
  templates: RecordData["feeTemplates"];
  catalog: Catalog;
  session?: { id: string };
  sessionLabel?: string;
  transportId: string;
  otherIds: string[];
  classAddOnLabels: string[];
  onTransport: (id: string) => void;
  onToggleOther: (id: string) => void;
  onToggleClassAddOn: (label: string) => void;
}) {
  const classTpl = [...(templates ?? [])]
    .filter((row) => row.classId === student.classId && (!session || row.sessionId === session.id || !row.sessionId))
    .sort((a, b) => (b.startsPeriod || "").localeCompare(a.startsPeriod || ""))[0];
  const classLines = (classTpl?.lines || []).filter((line) => line.scope !== "ADD_ON");
  const classAddOns = (classTpl?.lines || []).filter((line) => line.scope === "ADD_ON" && Number(line.amount) > 0);
  const classFee = classLines.reduce((sum, line) => sum + Math.max(0, Math.round(Number(line.amount) || 0)), 0);
  const transportOptions = catalog.items.filter((item) => item.kind === "TRANSPORT" && item.active);
  const otherOptions = catalog.items.filter((item) => item.kind === "OTHER" && item.active);
  const transport = transportOptions.find((item) => item.id === transportId);
  const others = otherOptions.filter((item) => otherIds.includes(item.id));
  const selectedAddOns = classAddOns.filter((line) => classAddOnLabels.some((label) => classAddOnKey(label) === classAddOnKey(line.label)));
  const total = classFee + (transport?.amount || 0) + others.reduce((sum, item) => sum + item.amount, 0) + selectedAddOns.reduce((sum, line) => sum + line.amount, 0);
  return (
    <View className="gap-4">
      <View>
        <Text className="text-base font-semibold text-ink-900">{student.name}</Text>
        <Text className="mt-0.5 text-sm text-ink-700">
          {student.classLabel} · {student.admissionNo}
        </Text>
        {sessionLabel ? <Text className="mt-0.5 text-xs text-ink-500">{sessionLabel}</Text> : null}
      </View>
      <View className="rounded-md border border-ink-100 bg-ink-50 px-3 py-3">
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Class fee</Text>
        <Text className="mt-1 text-sm font-semibold text-ink-900">
          {student.classLabel || "Class"} · {inr(classFee)} / month
        </Text>
        <Text className="mt-0.5 text-xs text-ink-600">Automatically applied</Text>
      </View>
      <View>
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Class add-ons</Text>
        <Text className="mt-1 text-xs text-ink-600">Optional for this class. Tick only the charges this student should pay.</Text>
        {classAddOns.map((item) => {
          const checked = classAddOnLabels.some((label) => classAddOnKey(label) === classAddOnKey(item.label));
          return (
            <Pressable key={item.label} onPress={() => onToggleClassAddOn(item.label)} className="mt-1 flex-row items-center justify-between py-1">
              <Text className="text-sm text-ink-900">
                {checked ? "☑" : "☐"} {item.label}
              </Text>
              <Text className="text-sm text-ink-800">{inr(item.amount)} / month</Text>
            </Pressable>
          );
        })}
        {!classAddOns.length ? <Text className="mt-2 text-sm text-ink-600">No class add-ons in Setup yet.</Text> : null}
      </View>
      <View>
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Transport</Text>
        <Pressable onPress={() => onTransport("")} className="mt-2 flex-row items-center gap-2 py-1">
          <Text className="text-sm text-ink-900">{transportId ? "○" : "●"} No transport</Text>
        </Pressable>
        {transportOptions.map((item) => (
          <Pressable key={item.id} onPress={() => onTransport(item.id)} className="flex-row items-center gap-2 py-1">
            <Text className="text-sm text-ink-900">
              {transportId === item.id ? "●" : "○"} {item.label} — {inr(item.amount)} / month
            </Text>
          </Pressable>
        ))}
        {!transportOptions.length ? <Text className="mt-2 text-sm text-ink-600">No transport options in Setup yet.</Text> : null}
      </View>
      <View>
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Other fees</Text>
        {otherOptions.map((item) => {
          const checked = otherIds.includes(item.id);
          return (
            <Pressable key={item.id} onPress={() => onToggleOther(item.id)} className="mt-1 flex-row items-center justify-between py-1">
              <Text className="text-sm text-ink-900">
                {checked ? "☑" : "☐"} {item.label}
              </Text>
              <Text className="text-sm text-ink-800">{inr(item.amount)} / month</Text>
            </Pressable>
          );
        })}
        {!otherOptions.length ? <Text className="mt-2 text-sm text-ink-600">No other fees in Setup yet.</Text> : null}
      </View>
      <View className="border-t border-ink-100 pt-3">
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Applicable monthly fee</Text>
        <View className="mt-2 flex-row justify-between">
          <Text className="text-sm text-ink-700">Class fee</Text>
          <Text className="text-sm text-ink-900">{inr(classFee)}</Text>
        </View>
        {selectedAddOns.map((item) => (
          <View key={item.label} className="mt-1 flex-row justify-between">
            <Text className="text-sm text-ink-700">{item.label}</Text>
            <Text className="text-sm text-ink-900">{inr(item.amount)}</Text>
          </View>
        ))}
        {transport ? (
          <View className="mt-1 flex-row justify-between">
            <Text className="text-sm text-ink-700">Transport</Text>
            <Text className="text-sm text-ink-900">{inr(transport.amount)}</Text>
          </View>
        ) : null}
        {others.map((item) => (
          <View key={item.id} className="mt-1 flex-row justify-between">
            <Text className="text-sm text-ink-700">{item.label}</Text>
            <Text className="text-sm text-ink-900">{inr(item.amount)}</Text>
          </View>
        ))}
        <View className="mt-2 flex-row justify-between border-t border-ink-100 pt-2">
          <Text className="text-sm font-semibold text-ink-900">Total</Text>
          <Text className="text-sm font-semibold text-ink-900">{inr(total)} / month</Text>
        </View>
      </View>
    </View>
  );
}
