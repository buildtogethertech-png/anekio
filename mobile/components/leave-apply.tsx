import { useEffect, useMemo, useState } from "react";
import { Modal as RnModal, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { DateField } from "./date-field";
import { Badge, Button, Card, Modal } from "./ui";
import { act } from "../lib/mutate";
import { useRecord, type LeaveRow, type RecordPayload } from "../lib/record";
import { addDays, calendarFrom, closedReason, isSchoolDay, nextSchoolDay, snapToSchoolDay, ymd, type SchoolCalendar } from "../lib/calendar";

const EMPTY_CHILDREN: NonNullable<RecordPayload["children"]> = [];
const EMPTY_LEAVE_TYPES: NonNullable<RecordPayload["leaveTypes"]> = [];

/** "15 Oct · First half" for half days. */
export function halfDayLabel(halfDay?: string) {
  return halfDay === "FIRST" ? "First half" : halfDay === "SECOND" ? "Second half" : "";
}

function prettyRange(from: string, to: string, halfDay?: string) {
  if (!from) return "";
  const a = new Date(`${from}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (halfDayLabel(halfDay)) return `${a} · ${halfDayLabel(halfDay)}`;
  if (!to || from === to) return a;
  const b = new Date(`${to}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${a}–${b}`;
}

function earliestLeaveStart(noticeDays: number, cal: SchoolCalendar) {
  let date = isSchoolDay(ymd(new Date()), cal) ? ymd(new Date()) : snapToSchoolDay(ymd(new Date()), cal);
  for (let i = 0; i < Math.max(0, Math.round(noticeDays || 0)); i += 1) date = nextSchoolDay(date, cal);
  return date;
}

export function LeaveList({ rows, empty }: { rows: LeaveRow[]; empty?: string }) {
  if (!rows.length) {
    return empty ? <Text className="text-sm text-ink-700">{empty}</Text> : null;
  }
  return (
    <View>
      {rows.map((row, index) => (
        <View key={row.id} className={`flex-row items-center justify-between gap-3 py-3 ${index ? "border-t border-ink-100" : ""}`}>
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-medium text-ink-900">
              {row.typeName}
              {row.subjectName && row.who === "student" ? ` · ${row.subjectName}` : ""}
            </Text>
            <Text className="text-xs text-ink-700">
              {prettyRange(row.from, row.to, row.halfDay)}
              {row.classLabel ? ` · ${row.classLabel}` : ""}
              {row.reason ? ` · ${row.reason}` : ""}
            </Text>
          </View>
          <Badge tone={row.status === "ACTIVE" ? "leaf" : row.status === "WAITING" ? "warn" : "ink"}>
            {row.status === "ACTIVE" ? "Leave" : row.status === "WAITING" ? "Waiting" : "Rejected"}
          </Badge>
        </View>
      ))}
    </View>
  );
}

export function LeaveDecideList({
  rows,
  token,
  onDone,
  onError,
  yesLabel = "Approve",
  title = "Waiting on you",
  rejectOnly = false,
}: {
  rows: LeaveRow[];
  token: string | null;
  onDone: (ok: string) => Promise<void> | void;
  onError: (msg: string) => void;
  yesLabel?: string;
  title?: string;
  rejectOnly?: boolean;
}) {
  const [busy, setBusy] = useState("");
  if (!rows.length) return null;
  return (
    <Card className="mb-4">
      <View className="border-b border-ink-100 px-4 py-3">
        <Text className="text-sm font-medium text-ink-900">{title}</Text>
      </View>
      {rows.map((row) => (
        <View key={row.id} className="flex-row items-center justify-between gap-2 border-t border-ink-100 px-4 py-3">
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-medium text-ink-900">
              {row.subjectName} · {row.typeName}
            </Text>
            <Text className="text-xs text-ink-700">
              {prettyRange(row.from, row.to, row.halfDay)}
              {row.classLabel ? ` · ${row.classLabel}` : ""}
            </Text>
          </View>
          <View className="flex-row gap-2">
            <Pressable
              disabled={Boolean(busy)}
              onPress={async () => {
                setBusy(row.id);
                try {
                  await act(token, "decideLeave", { requestId: row.id, yes: false });
                  await onDone("Leave declined.");
                } catch (e) {
                  onError(e instanceof Error ? e.message : "Could not save.");
                } finally {
                  setBusy("");
                }
              }}
            >
              <Text className="text-sm text-red-700">Reject</Text>
            </Pressable>
            {rejectOnly || row.status !== "WAITING" ? null : (
              <Pressable
                disabled={Boolean(busy)}
                onPress={async () => {
                  setBusy(row.id);
                  try {
                    await act(token, "decideLeave", { requestId: row.id, yes: true });
                    await onDone(yesLabel === "Approve" ? "Leave granted." : "Noted.");
                  } catch (e) {
                    onError(e instanceof Error ? e.message : "Could not save.");
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <Text className="text-sm font-medium text-clay-600">{yesLabel}</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
    </Card>
  );
}

export function LeaveApplyCard({
  audience,
  studentId,
  token,
  onDone,
  onError,
  openByDefault = false,
  compact = false,
  triggerOnly = false,
  className = "",
}: {
  audience: "teacher" | "staff" | "student";
  studentId?: string;
  token: string | null;
  onDone: (ok: string) => Promise<void> | void;
  onError: (msg: string) => void;
  openByDefault?: boolean;
  compact?: boolean;
  triggerOnly?: boolean;
  className?: string;
}) {
  const { data } = useRecord();
  const children = data?.children ?? EMPTY_CHILDREN;
  const schoolCalendar = useMemo(
    () => calendarFrom(data?.calendar?.holidays, data?.calendar?.weekdays),
    [data?.calendar?.holidays, data?.calendar?.weekdays]
  );
  const types = useMemo(
    () =>
      (data?.leaveTypes ?? EMPTY_LEAVE_TYPES).filter((t) =>
        audience === "teacher" ? t.forTeacher : audience === "staff" ? t.forStaff : t.forStudent
      ),
    [audience, data?.leaveTypes]
  );
  const mine = (data?.myLeave ?? []).filter((r) => (studentId ? r.subjectId === studentId : true));
  const childIds = useMemo(() => children.map((child) => child.id), [children]);
  const [open, setOpen] = useState(openByDefault);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>(studentId ? [studentId] : children[0]?.id ? [children[0].id] : []);
  const [typeId, setTypeId] = useState(types[0]?.id || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [duration, setDuration] = useState<"FULL" | "FIRST" | "SECOND">("FULL");
  const half = duration !== "FULL";
  const [reason, setReason] = useState("");
  const { width } = useWindowDimensions();
  const phoneSheet = width < 768;
  const endDate = half ? from : to || from;
  // School days in the request (half day = 0.5).
  const requestDays = (() => {
    if (!from) return 0;
    if (half) return isSchoolDay(from, schoolCalendar) ? 0.5 : 0;
    let count = 0;
    for (let day = from, i = 0; day <= endDate && i < 120; day = addDays(day, 1), i += 1) {
      if (isSchoolDay(day, schoolCalendar)) count += 1;
    }
    return count;
  })();
  // Balance per leave type for staff (approved days in the current school session or calendar year).
  const session = (data?.school?.sessions ?? []).find((row) => row.current);
  const yearStart = session?.startsOn?.slice(0, 10) || `${ymd(new Date()).slice(0, 4)}-01-01`;
  const yearEnd = session?.endsOn?.slice(0, 10) || `${ymd(new Date()).slice(0, 4)}-12-31`;
  const balanceOf = (typeId: string) => (data?.leaveBalances ?? []).find((b) => b.typeId === typeId);
  const leftFor = (type: { id: string; yearlyCap: number }) => {
    if (audience === "student") return null;
    const bal = balanceOf(type.id);
    if (bal) return bal.limited ? bal.available : null;
    if (!type.yearlyCap) return null;
    const used = (data?.myLeave ?? [])
      .filter((row) => row.typeId === type.id && row.status === "ACTIVE" && row.from.slice(0, 10) >= yearStart && row.from.slice(0, 10) <= yearEnd)
      .reduce((sum, row) => sum + (row.days || 0), 0);
    return Math.max(0, type.yearlyCap - used);
  };
  const dayText = (n: number) => `${n % 1 ? n.toFixed(1) : n} day${n === 1 ? "" : "s"}`;
  const pretty = (value: string) =>
    value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Pick date";
  const weekdayOf = (value: string) => (value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short" }) : "");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const picked = useMemo(() => types.find((t) => t.id === typeId) || types[0], [types, typeId]);
  const earliest = picked ? earliestLeaveStart(picked.noticeDays, schoolCalendar) : "";
  const leaveClosedReason = (value: string) => {
    const closed = closedReason(value, schoolCalendar);
    if (closed) return closed;
    // Past days are allowed (applying late); notice only counts for future dates.
    if (picked?.noticeDays && value >= earliestLeaveStart(0, schoolCalendar) && value < earliest) {
      return `${picked.name} needs ${picked.noticeDays} school day${picked.noticeDays === 1 ? "" : "s"} notice`;
    }
    return "";
  };

  useEffect(() => {
    if (!types.length) return;
    if (!types.some((t) => t.id === typeId)) setTypeId(types[0].id);
  }, [types, typeId]);

  useEffect(() => {
    if (studentId) {
      setSelectedStudentIds((current) => (current.length === 1 && current[0] === studentId ? current : [studentId]));
      return;
    }
    setSelectedStudentIds((current) => {
      const allowed = new Set(childIds);
      const kept = current.filter((id) => allowed.has(id));
      const next = kept.length ? kept : childIds[0] ? [childIds[0]] : [];
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [childIds, studentId]);

  if (!types.length) {
    return (
      <Text className="mt-4 text-sm text-ink-700">Office hasn’t set leave types yet.</Text>
    );
  }

  function openApplyModal() {
    const initialDate = from || earliest;
    setFormError("");
    setSelectedStudentIds((current) => studentId ? [studentId] : current.length ? current : children[0]?.id ? [children[0].id] : []);
    if (initialDate) {
      setFrom(initialDate);
      if (!to || to < initialDate) setTo(initialDate);
    }
    setOpen(true);
  }

  const trigger = (
    <Button onPress={() => {
      setFormError("");
      openApplyModal();
    }}>Apply for leave</Button>
  );
  const allChildrenSelected = Boolean(children.length) && selectedStudentIds.length === children.length;
  async function submitLeave() {
    if (!from) {
      setFormError("Choose the start date.");
      onError("Choose the start date.");
      return;
    }
    const blockedFrom = leaveClosedReason(from);
    const blockedTo = leaveClosedReason(endDate);
    if (blockedFrom || blockedTo) {
      const message = blockedFrom || blockedTo;
      setFormError(message);
      onError(message);
      return;
    }
    if (reason.trim().length < 3) {
      setFormError("Add a short note for the approver.");
      onError("Add a short note for the approver.");
      return;
    }
    const targetStudentIds = studentId ? [studentId] : selectedStudentIds;
    if (audience === "student" && !targetStudentIds.length) {
      setFormError("Choose at least one child.");
      onError("Choose at least one child.");
      return;
    }
    setFormError("");
    setBusy(true);
    try {
      const leaveTargets = audience === "student" ? targetStudentIds : [undefined];
      for (const selected of leaveTargets) {
        await act(token, "applyLeave", {
          typeId: picked?.id,
          from,
          to: endDate,
          reason,
          studentId: selected || undefined,
          halfDay: half ? duration : "",
        });
      }
      setOpen(false);
      setFrom("");
      setTo("");
      setReason("");
      setDuration("FULL");
      await onDone(audience === "student" && targetStudentIds.length > 1 ? `Leave sent for ${targetStudentIds.length} children.` : audience === "student" ? "Leave sent." : "Leave applied. See its status below.");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not apply.";
      setFormError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  const pickedLeft = picked ? leftFor(picked) : null;
  const overBalance = pickedLeft !== null && requestDays > pickedLeft;

  const formBody = (
    <View className="gap-6">
      {audience === "student" && !studentId && children.length > 1 ? (
        <View>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-ink-900">Apply for</Text>
            <Pressable onPress={() => setSelectedStudentIds(allChildrenSelected ? [] : children.map((child) => child.id))} hitSlop={8}>
              <Text className="text-xs font-semibold text-[#1F45C7]">{allChildrenSelected ? "Clear" : "Select all"}</Text>
            </Pressable>
          </View>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {children.map((child) => {
              const on = selectedStudentIds.includes(child.id);
              return (
                <Pressable
                  key={child.id}
                  onPress={() => setSelectedStudentIds((current) => (current.includes(child.id) ? current.filter((id) => id !== child.id) : [...current, child.id]))}
                  className={`h-10 flex-row items-center gap-2 rounded-full px-3.5 ${on ? "bg-[#1F45C7]" : "bg-ink-50"}`}
                >
                  <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={16} color={on ? "#FFFFFF" : "#94A3B8"} />
                  <Text className={`text-sm font-medium ${on ? "text-white" : "text-ink-800"}`}>{child.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Dates, Keka-style: start | n days | end */}
      <View className="relative flex-row items-start overflow-hidden rounded-2xl bg-ink-50">
        <View pointerEvents="none" className="absolute inset-0 z-10 items-center justify-center">
          <View className="rounded-full border border-ink-200 bg-white px-2.5 py-1">
            <Text className="text-xs font-semibold text-ink-900">{from ? dayText(requestDays) : "—"}</Text>
          </View>
        </View>
        <View className="min-w-0 flex-1 py-3 pl-4 pr-10">
          <Text className="text-xs text-ink-700">{half ? "Date" : "Start date"}</Text>
          <DateField
            plain
            bare
            placeholder="Pick date"
            value={from}
            closedReason={leaveClosedReason}
            onChange={(next) => {
              setFrom(next);
              if (half || !to || to < next) setTo(next);
            }}
          />
        </View>
        <View className="w-px self-stretch bg-ink-200" />
        <View className={`min-w-0 flex-1 items-end py-3 pl-10 pr-4 ${half ? "opacity-50" : ""}`}>
          <Text className="text-xs text-ink-700">End date</Text>
          {half ? (
            <Text className="mt-2.5 text-[15px] font-semibold text-ink-900">{from ? pretty(from) : "—"}</Text>
          ) : (
            <DateField plain bare placeholder="Pick date" value={to || from} min={from || undefined} closedReason={leaveClosedReason} onChange={setTo} />
          )}
        </View>
      </View>

      <View>
        <View className="flex-row gap-2">
          {([
            ["FULL", "Full day"],
            ["HALF", "Half day"],
          ] as const).map(([id, label]) => {
            const on = id === "FULL" ? !half : half;
            return (
              <Pressable
                key={id}
                onPress={() => {
                  if (id === "FULL") setDuration("FULL");
                  else {
                    setDuration(duration === "SECOND" ? "SECOND" : "FIRST");
                    if (from) setTo(from);
                  }
                }}
                className={`h-10 flex-1 items-center justify-center rounded-full border ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
              >
                <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-800"}`}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
        {half ? (
          <View className="mt-3 flex-row items-center justify-between rounded-2xl bg-ink-50 px-4 py-2.5">
            <Text className="text-sm text-ink-800">
              <Text className="font-semibold text-ink-900">{from ? new Date(`${from}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}</Text>
              {from ? `, ${weekdayOf(from)}` : ""}
            </Text>
            <View className="flex-row rounded-full bg-white p-0.5">
              {([
                ["FIRST", "1st half"],
                ["SECOND", "2nd half"],
              ] as const).map(([id, label]) => (
                <Pressable key={id} onPress={() => setDuration(id)} className={`rounded-full px-3 py-1.5 ${duration === id ? "bg-[#EEF3FF]" : ""}`}>
                  <Text className={`text-xs font-semibold ${duration === id ? "text-[#1F45C7]" : "text-ink-700"}`}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </View>

      <View>
        <Text className="mb-2 text-sm font-semibold text-ink-900">Leave type</Text>
        <View className="overflow-hidden rounded-2xl border border-ink-100">
          {types.map((t, index) => {
            const on = picked?.id === t.id;
            const left = leftFor(t);
            return (
              <Pressable
                key={t.id}
                onPress={() => setTypeId(t.id)}
                className={`flex-row items-center gap-3 px-4 py-3 ${index ? "border-t border-ink-100" : ""} ${on ? "bg-[#F3F6FF]" : "bg-white"}`}
              >
                <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={20} color={on ? "#1F45C7" : "#94A3B8"} />
                <View className="min-w-0 flex-1">
                  <Text className="text-[15px] font-medium text-ink-900">{t.name}</Text>
                  <Text className="mt-0.5 text-xs text-ink-700">
                    {t.noticeDays ? `Apply ${t.noticeDays} day${t.noticeDays === 1 ? "" : "s"} ahead` : "Same-day allowed"}
                  </Text>
                </View>
                {left !== null ? (
                  <View className="items-end">
                    <Text className={`text-xs font-semibold ${left <= 0 ? "text-red-700" : "text-ink-700"}`}>
                      {left % 1 ? left.toFixed(1) : left} left
                    </Text>
                    {balanceOf(t.id)?.nextCreditOn && balanceOf(t.id)?.mode !== "YEARLY" ? (
                      <Text className="text-[10px] text-ink-500">
                        +{balanceOf(t.id)!.nextCreditDays} on{" "}
                        {new Date(`${balanceOf(t.id)!.nextCreditOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </Text>
                    ) : null}
                  </View>
                ) : audience !== "student" && t.yearlyCap && !balanceOf(t.id) ? (
                  <Text className="text-xs text-ink-500">{t.yearlyCap}/yr</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        {overBalance ? (
          <Text className="mt-2 text-xs text-amber-800">
            This asks for more {picked?.name.toLowerCase()} leave than you have left. The school can still approve it.
          </Text>
        ) : null}
      </View>

      <View>
        <Text className="mb-2 text-sm font-semibold text-ink-900">
          Note to approver <Text className="text-red-600">*</Text>
        </Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. Family function, doctor's appointment"
          placeholderTextColor="#94A3B8"
          multiline
          className="min-h-[88px] rounded-2xl bg-ink-50 px-4 py-3 text-[15px] text-ink-900"
          style={{ textAlignVertical: "top" }}
        />
      </View>
      {formError ? <Text className="text-sm text-red-700">{formError}</Text> : null}
    </View>
  );

  const footer = (
    <View className="gap-2.5">
      <Text className="text-center text-sm text-ink-700">
        Leave request is for <Text className="font-bold text-ink-900">{from ? dayText(requestDays) : "—"}</Text>
        {picked ? ` · ${picked.name}` : ""}
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy || !from || !picked || reason.trim().length < 3}
        onPress={() => void submitLeave()}
        className={`h-12 items-center justify-center rounded-2xl ${busy || !from || !picked || reason.trim().length < 3 ? "bg-[#1F45C7]/40" : "bg-[#1F45C7]"}`}
      >
        <Text className="text-[15px] font-semibold text-white">{busy ? "Sending…" : "Request leave"}</Text>
      </Pressable>
    </View>
  );

  const modal = phoneSheet ? (
    <RnModal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setOpen(false)}>
      <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
        <View className="h-14 flex-row items-center px-2">
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setOpen(false)} className="h-11 w-11 items-center justify-center">
            <Ionicons name="close" size={24} color="#0f2744" />
          </Pressable>
          <Text className="flex-1 text-center text-[17px] font-semibold text-ink-900">Apply leave</Text>
          <View className="w-11" />
        </View>
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {formBody}
        </ScrollView>
        <View className="border-t border-ink-100 px-4 pb-3 pt-3">{footer}</View>
      </SafeAreaView>
    </RnModal>
  ) : (
    <Modal open={open} title="Apply leave" onClose={() => setOpen(false)} footer={footer}>
      {formBody}
    </Modal>
  );

  if (triggerOnly) {
    return (
      <View className={className}>
        {trigger}
        {modal}
      </View>
    );
  }

  return (
    <View className={`${compact ? "" : "mt-4"} ${className}`}>
      <Card className={`overflow-hidden ${compact ? "h-full" : ""}`}>
        <View className={`flex-row flex-wrap items-center justify-between gap-3 border-b border-ink-100 ${compact ? "px-5 py-5" : "px-5 py-4"}`}>
          <View className="min-w-[150px] flex-1">
            <Text className="text-base font-semibold text-ink-900">Planned leave</Text>
            <Text className="mt-0.5 text-xs text-ink-700">Requests and approvals</Text>
            {audience !== "student" ? (
              <Pressable onPress={() => router.push("/leave" as never)} hitSlop={6} className="mt-1 self-start">
                <Text className="text-xs font-semibold text-[#1F45C7]">Balance & history ›</Text>
              </Pressable>
            ) : null}
          </View>
          {trigger}
        </View>
        {mine.length ? (
          <View className="px-5 py-4">
            <LeaveList rows={mine} />
          </View>
        ) : (
          <View className={`px-5 ${compact ? "py-5" : "py-8"}`}>
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
                <Text className="text-lg text-emerald-700">✓</Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-medium text-ink-900">No leave planned</Text>
                <Text className="mt-0.5 text-xs leading-4 text-ink-700">You’re all caught up. New requests will appear here.</Text>
              </View>
            </View>
          </View>
        )}
        {compact ? (
          <View className="mt-auto border-t border-ink-100 bg-ink-50 px-5 py-4">
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-700">Good to know</Text>
            <View className="mt-2 flex-row items-start gap-2">
              <Text className="text-xs text-clay-600">•</Text>
              <Text className="min-w-0 flex-1 text-xs leading-4 text-ink-700">
                {picked?.noticeDays
                  ? `Apply at least ${picked.noticeDays} school day${picked.noticeDays === 1 ? "" : "s"} in advance.`
                  : "Same-day requests are allowed when plans change."}
              </Text>
            </View>
            <View className="mt-1.5 flex-row items-start gap-2">
              <Text className="text-xs text-clay-600">•</Text>
              <Text className="min-w-0 flex-1 text-xs leading-4 text-ink-700">You’ll see the school’s decision here as soon as it is reviewed.</Text>
            </View>
          </View>
        ) : null}
      </Card>
      {modal}
    </View>
  );
}

export function leaveTypesFrom(data: RecordPayload | null, audience: "teacher" | "staff" | "student") {
  return (data?.leaveTypes ?? []).filter((t) =>
    audience === "teacher" ? t.forTeacher : audience === "staff" ? t.forStaff : t.forStudent
  );
}
