import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { DateField } from "./date-field";
import { Badge, Button, Card, Chip, Field, Input, Modal } from "./ui";
import { act } from "../lib/mutate";
import { useRecord, type LeaveRow, type RecordPayload } from "../lib/record";
import { calendarFrom, closedReason, isSchoolDay, nextSchoolDay, snapToSchoolDay, ymd, type SchoolCalendar } from "../lib/calendar";

function prettyRange(from: string, to: string) {
  if (!from) return "";
  const a = new Date(`${from}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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
              {prettyRange(row.from, row.to)}
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
              {prettyRange(row.from, row.to)}
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
  const children = data?.children ?? [];
  const schoolCalendar = useMemo(
    () => calendarFrom(data?.calendar?.holidays, data?.calendar?.weekdays),
    [data?.calendar?.holidays, data?.calendar?.weekdays]
  );
  const types = (data?.leaveTypes ?? []).filter((t) =>
    audience === "teacher" ? t.forTeacher : audience === "staff" ? t.forStaff : t.forStudent
  );
  const mine = (data?.myLeave ?? []).filter((r) => (studentId ? r.subjectId === studentId : true));
  const [open, setOpen] = useState(openByDefault);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>(studentId ? [studentId] : children[0]?.id ? [children[0].id] : []);
  const [typeId, setTypeId] = useState(types[0]?.id || "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const picked = useMemo(() => types.find((t) => t.id === typeId) || types[0], [types, typeId]);
  const earliest = picked ? earliestLeaveStart(picked.noticeDays, schoolCalendar) : "";
  const leaveClosedReason = (value: string) => {
    const closed = closedReason(value, schoolCalendar);
    if (closed) return closed;
    if (picked?.noticeDays && value < earliest) {
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
      setSelectedStudentIds([studentId]);
      return;
    }
    setSelectedStudentIds((current) => {
      const allowed = new Set(children.map((child) => child.id));
      const kept = current.filter((id) => allowed.has(id));
      return kept.length ? kept : children[0]?.id ? [children[0].id] : [];
    });
  }, [children, studentId]);

  if (!types.length) {
    return (
      <Text className="mt-4 text-sm text-ink-700">Office hasn’t set leave types yet.</Text>
    );
  }

  const trigger = (
    <Button onPress={() => {
      setFormError("");
      setSelectedStudentIds((current) => studentId ? [studentId] : current.length ? current : children[0]?.id ? [children[0].id] : []);
      setOpen(true);
    }}>Apply for leave</Button>
  );
  const allChildrenSelected = Boolean(children.length) && selectedStudentIds.length === children.length;
  const modal = (
    <Modal open={open} title="Request leave" onClose={() => setOpen(false)}>
      <View className="gap-5">
        {audience === "student" && !studentId && children.length > 1 ? (
          <View>
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-semibold uppercase tracking-wide text-ink-700">Apply for</Text>
              <Pressable
                onPress={() => setSelectedStudentIds(allChildrenSelected ? [] : children.map((child) => child.id))}
                hitSlop={8}
              >
                <Text className="text-xs font-medium text-clay-600">{allChildrenSelected ? "Clear" : "Select all"}</Text>
              </Pressable>
            </View>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {children.map((child) => (
                <Pressable
                  key={child.id}
                  onPress={() =>
                    setSelectedStudentIds((current) =>
                      current.includes(child.id)
                        ? current.filter((id) => id !== child.id)
                        : [...current, child.id]
                    )
                  }
                  className={`min-w-[150px] flex-1 rounded-md border px-3 py-3 ${
                    selectedStudentIds.includes(child.id) ? "border-clay-500 bg-blue-50" : "border-ink-200 bg-white"
                  }`}
                >
                  <View className="flex-row items-center gap-2">
                    <View className={`h-5 w-5 items-center justify-center rounded border ${
                      selectedStudentIds.includes(child.id) ? "border-clay-500 bg-clay-500" : "border-ink-300 bg-white"
                    }`}>
                      {selectedStudentIds.includes(child.id) ? <Text className="text-xs font-bold text-white">✓</Text> : null}
                    </View>
                    <Text className="text-sm font-medium text-ink-900">{child.name}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
            <Text className="mt-2 text-xs text-ink-700">You can choose one child or both children for the same leave.</Text>
          </View>
        ) : null}
        <View>
          <Text className="text-xs font-semibold uppercase tracking-wide text-ink-700">Leave type</Text>
          <View className="mt-2 flex-row gap-2">
            {types.map((t) => (
              <Chip
                key={t.id}
                label={t.name}
                active={picked?.id === t.id}
                className="flex-1 items-center py-2"
                onPress={() => setTypeId(t.id)}
              />
            ))}
          </View>
        </View>
        {picked ? (
          <View className="rounded-md bg-ink-50 px-3 py-2">
            <Text className="text-xs text-ink-700">
              {picked.noticeDays
                ? `Apply ${picked.noticeDays} school day${picked.noticeDays === 1 ? "" : "s"} in advance · earliest ${prettyRange(earliest, earliest)}`
                : "Same-day request allowed"}
              {picked.yearlyCap ? ` · ${picked.yearlyCap}-day yearly allowance` : ""}
            </Text>
          </View>
        ) : null}
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field label="First day">
              <DateField
                placeholder="Select first day"
                value={from}
                closedReason={leaveClosedReason}
                onChange={(next) => {
                  setFrom(next);
                  if (!to || to < next) setTo(next);
                }}
              />
            </Field>
          </View>
          <View className="flex-1">
            <Field label="Last day">
              <DateField
                placeholder="Select last day"
                value={to || from}
                closedReason={leaveClosedReason}
                onChange={setTo}
              />
            </Field>
          </View>
        </View>
        {formError ? <Text className="text-xs text-red-700">{formError}</Text> : null}
        <LeaveReason
          onCancel={() => setOpen(false)}
          busy={busy}
          onSubmit={async (reason) => {
            if (!from) {
              setFormError("Choose the first day.");
              onError("Choose the first day.");
              return;
            }
            const blockedFrom = leaveClosedReason(from);
            const blockedTo = leaveClosedReason(to || from);
            if (blockedFrom || blockedTo) {
              const message = blockedFrom || blockedTo;
              setFormError(message);
              onError(message);
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
              for (const selected of targetStudentIds) {
                await act(token, "applyLeave", {
                  typeId: picked?.id,
                  from,
                  to: to || from,
                  reason,
                  studentId: selected || undefined,
                });
              }
              setOpen(false);
              setFrom("");
              setTo("");
              await onDone(targetStudentIds.length > 1 ? `Leave sent for ${targetStudentIds.length} children.` : "Leave sent.");
            } catch (e) {
              const message = e instanceof Error ? e.message : "Could not apply.";
              setFormError(message);
              onError(message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
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

function LeaveReason({ onSubmit, onCancel, busy }: { onSubmit: (reason: string) => Promise<void>; onCancel: () => void; busy?: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <View className="gap-3">
      <Field label="Reason">
        <Input value={reason} onChangeText={setReason} placeholder="Add a short note (optional)" />
      </Field>
      <View className="flex-row justify-end gap-2 border-t border-ink-100 pt-4">
        <Button variant="ghost" disabled={busy} onPress={onCancel}>Cancel</Button>
        <Button disabled={busy} onPress={() => onSubmit(reason)}>{busy ? "Sending..." : "Submit request"}</Button>
      </View>
    </View>
  );
}

export function leaveTypesFrom(data: RecordPayload | null, audience: "teacher" | "staff" | "student") {
  return (data?.leaveTypes ?? []).filter((t) =>
    audience === "teacher" ? t.forTeacher : audience === "staff" ? t.forStaff : t.forStudent
  );
}
