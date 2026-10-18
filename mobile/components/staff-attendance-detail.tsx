import { useMemo, useState } from "react";
import { Modal as RnModal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Modal, Toast, useToast } from "./ui";
import { act } from "../lib/mutate";
import { weekdayOfYmd, ymd, type SchoolCalendar } from "../lib/calendar";
import {
  dayKind,
  daysInMonth,
  inr,
  minutesLate,
  monthTitle,
  parsePayrollRules,
  personKey,
  shiftMonth,
  salaryBasisLabel,
  salaryPayState,
  summarizePayroll,
  type PayrollMark,
  type PayrollRules,
} from "../lib/payroll";
import type { RecordPayload } from "../lib/record";
import type { IoniconName } from "../lib/nav-icons";
import { EmployeeLeaveCard } from "./leave-balances";
import { SalaryPayCard } from "./salary-pay-card";

type StaffPerson = NonNullable<RecordPayload["staff"]>[number];
type DayKind = "working" | "weekend" | "holiday";

const WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EDIT_MARKS: { value: PayrollMark; label: string }[] = [
  { value: "PRESENT", label: "P — Present" },
  { value: "LATE", label: "Lt — Late" },
  { value: "ABSENT", label: "A — Absent" },
  { value: "LEAVE", label: "L — Leave" },
  { value: "HALF_DAY", label: "HD — Half day" },
];

function parseMark(status?: string): PayrollMark {
  const s = (status || "").toUpperCase();
  if (s === "PRESENT" || s === "IN") return "PRESENT";
  if (s === "ABSENT" || s === "OUT") return "ABSENT";
  if (s === "LEAVE") return "LEAVE";
  if (s === "LATE") return "LATE";
  if (s === "HALF_DAY") return "HALF_DAY";
  return "";
}

function letterFor(mark: PayrollMark, kind: DayKind, future: boolean) {
  if (kind === "holiday") return "H";
  if (kind === "weekend") return "—";
  if (future && !mark) return "—";
  if (mark === "PRESENT") return "P";
  if (mark === "ABSENT") return "A";
  if (mark === "LEAVE") return "L";
  if (mark === "HALF_DAY") return "HD";
  if (mark === "LATE") return "Lt";
  return "—";
}

function badgeClass(letter: string) {
  if (letter === "P") return "bg-emerald-50 text-emerald-700";
  if (letter === "A") return "bg-red-50 text-red-700";
  if (letter === "Lt") return "bg-amber-50 text-amber-800";
  if (letter === "L") return "bg-sky-50 text-sky-800";
  if (letter === "HD") return "bg-amber-50 text-amber-800";
  if (letter === "H") return "bg-violet-50 text-violet-700";
  return "text-ink-400";
}

/** What a calendar day is, in words (handles offs, holidays, future and unmarked days). */
function dayLabel(row: { kind: DayKind; future: boolean; mark: PayrollMark; letter: string }) {
  if (row.kind === "weekend") return "Weekly off";
  if (row.kind === "holiday") return "Holiday";
  if (!row.mark) return row.future ? "Upcoming" : "Not marked";
  return statusLabel(row.letter);
}

function statusLabel(letter: string) {
  if (letter === "P") return "Present";
  if (letter === "A") return "Absent";
  if (letter === "Lt") return "Late";
  if (letter === "L") return "Leave";
  if (letter === "HD") return "Half day";
  if (letter === "H") return "Holiday";
  return "Weekend";
}

const AUDIT_STATUS: Record<string, { label: string; color: string }> = {
  PRESENT: { label: "Present", color: "#10b981" },
  LATE: { label: "Late", color: "#f59e0b" },
  ABSENT: { label: "Absent", color: "#ef4444" },
  LEAVE: { label: "Leave", color: "#0ea5e9" },
  HALF_DAY: { label: "Half day", color: "#f59e0b" },
};

/** "Fri, 18 Sep" */
function shortDay(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** "Changed 2 Oct, 4:15 PM" */
function changedAt(at: string) {
  const d = new Date(at);
  if (Number.isNaN(+d)) return "";
  return `Changed ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
}

function prettyDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function cellSurface(row: { kind: DayKind; today: boolean }) {
  if (row.today) return "border-clay-400 bg-[#F5F8FF]";
  if (row.kind === "holiday") return "border-ink-100 bg-violet-50/60";
  if (row.kind === "weekend") return "border-ink-100 bg-ink-50";
  return "border-ink-100 bg-white";
}

function IconBtn({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: IoniconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="h-9 flex-row items-center gap-1.5 rounded-md border border-ink-200 bg-white px-3"
    >
      <Ionicons name={icon} size={15} color="#2855F6" />
      <Text className="text-[12px] font-medium text-ink-800">{label}</Text>
    </Pressable>
  );
}

function StatChip({
  icon,
  label,
  value,
  emphasis,
}: {
  icon: IoniconName;
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <View
      className={`min-w-[104px] flex-1 flex-row items-center gap-2 rounded-lg border px-3 py-2 ${
        emphasis ? "border-clay-200 bg-[#EEF2FF]" : "border-ink-100 bg-[#F8FAFC]"
      }`}
    >
      <View className="h-8 w-8 items-center justify-center rounded-md bg-white">
        <Ionicons name={icon} size={16} color="#2855F6" />
      </View>
      <View>
        <Text className="text-[16px] font-semibold leading-5 text-ink-900">{value}</Text>
        <Text className="text-[10px] font-medium uppercase tracking-wide text-ink-500">{label}</Text>
      </View>
    </View>
  );
}

function payBadge(status?: string, state?: string) {
  if (state === "PART_PAID") return { label: "Part paid", className: "bg-orange-50 text-orange-800" };
  if (status === "APPROVED") return { label: "Approved · unpaid", className: "bg-emerald-50 text-emerald-800" };
  if (status === "PAID") return { label: "Paid", className: "bg-sky-50 text-sky-800" };
  return { label: "Pending Review", className: "bg-amber-50 text-amber-800" };
}

export function StaffAttendanceDetail({
  person,
  calendar,
  rules,
  payroll,
  payments,
  initialMonth,
  audits,
  token,
  onBack,
  onSaved,
  onEditSalary,
  inSheet,
  salaryAccess = { view: false, approve: false, pay: false },
}: {
  /** Salary is its own permission: see / approve / pay. Attendance stays visible without it. */
  salaryAccess?: { view: boolean; approve: boolean; pay: boolean };
  inSheet?: boolean;
  person: StaffPerson;
  calendar: SchoolCalendar;
  rules?: PayrollRules | null;
  payroll?: RecordPayload["staffPayroll"];
  payments?: RecordPayload["staffSalaryPayments"];
  /** Open on this month (YYYY-MM) instead of the current one. */
  initialMonth?: string;
  audits?: RecordPayload["staffAudits"];
  token: string | null;
  onBack: () => void;
  onSaved: () => Promise<void>;
  onEditSalary?: () => void;
}) {
  const toast = useToast();
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const Wrap = (inSheet ? View : ScrollView) as typeof ScrollView;
  const [section, setSection] = useState<"attendance" | "leave" | "pay">("attendance");
  const [moreOpen, setMoreOpen] = useState(false);
  const split = width >= 960;
  const now = ymd(new Date());
  const [month, setMonth] = useState(initialMonth || now.slice(0, 7));
  const [editDate, setEditDate] = useState("");
  const [editStatus, setEditStatus] = useState<PayrollMark>("PRESENT");
  const [editReason, setEditReason] = useState("");
  const [unlock, setUnlock] = useState(false);
  const [review, setReview] = useState(false);
  const [inspectDate, setInspectDate] = useState("");
  const [historyAll, setHistoryAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const kind = person.kind === "teacher" ? "teacher" : "staff";
  const key = personKey(kind, person.id);
  const payrollRules = parsePayrollRules(rules ? JSON.stringify(rules) : null);
  const dates = useMemo(() => daysInMonth(month), [month]);
  const run = (payroll ?? []).find((row) => row.personKey === key && row.month === month);
  const lockedPay = run?.status === "APPROVED" || run?.status === "PAID";

  const rows = useMemo(() => {
    const byDate = new Map((person.days ?? []).map((d) => [d.date, d]));
    const leave = new Map((person.leaveDays ?? []).map((d) => [d.date, d]));
    return dates.map((date) => {
      const kindDay = dayKind(date, calendar);
      const saved = parseMark(byDate.get(date)?.status);
      const future = date > now;
      const letter = letterFor(saved, kindDay, future);
      const holiday = calendar.holidays.find((h) => h.date === date);
      let remarks = "—";
      if (kindDay === "weekend") remarks = "Weekend";
      else if (kindDay === "holiday") remarks = holiday?.name ? `H · ${holiday.name}` : "H · Holiday";
      else if (byDate.get(date)?.remark) remarks = byDate.get(date)?.remark || "—";
      else if (saved === "LEAVE") remarks = leave.get(date)?.reason || (leave.get(date)?.paid === false ? "Unpaid leave" : "Approved leave");
      else if (saved === "ABSENT") remarks = "Personal absence";
      else if (saved === "HALF_DAY") remarks = "Half day";
      else if (saved === "LATE") {
        const inAt = byDate.get(date)?.inAt || "";
        const start = byDate.get(date)?.startTimeUsed || payrollRules.startTime;
        const lateMin = inAt ? minutesLate(inAt, start) : 0;
        remarks = inAt ? `Late ${lateMin} min · In ${inAt}` : "Late";
      }
      else if (saved === "PRESENT" && byDate.get(date)?.computedStatus === "LATE") remarks = byDate.get(date)?.remark || "Late, marked present";
      else if (future) remarks = "—";
      else if (byDate.get(date)?.inAt) remarks = `In ${byDate.get(date)?.inAt}`;
      return {
        date,
        n: Number(date.slice(8)),
        wd: WEEKDAYS[weekdayOfYmd(date)] || "",
        kind: kindDay,
        future,
        today: date === now,
        mark: saved,
        letter,
        remarks,
        paidLeave: leave.get(date)?.paid !== false,
      };
    });
  }, [calendar, dates, now, person.days, person.leaveDays, payrollRules.startTime]);

  const marks = useMemo(() => new Map(rows.filter((r) => r.mark).map((r) => [r.date, r.mark])), [rows]);
  const paidLeave = useMemo(() => new Map(rows.map((r) => [r.date, r.paidLeave])), [rows]);
  const live = useMemo(
    () =>
      summarizePayroll({
        dates,
        today: now,
        calendar,
        marks,
        paidLeave,
        rules: payrollRules,
        salary: person.salary ?? 30000,
        otherAdj: run?.otherAdj || 0,
      }),
    [calendar, dates, marks, now, paidLeave, payrollRules, person.salary, run?.otherAdj]
  );
  const summary = !run || run.status === "PENDING" ? live : { ...live, attendanceAdj: run.attendanceAdj, finalAmount: run.finalAmount, salary: run.salary, payableDays: run.payableDays, working: run.workingDays, otherAdj: run.otherAdj };
  const weeks = useMemo(() => {
    const lead = rows[0] ? weekdayOfYmd(rows[0].date) - 1 : 0;
    const cells: (typeof rows[number] | null)[] = [...Array(Math.max(0, lead)).fill(null), ...rows];
    while (cells.length % 7) cells.push(null);
    const out: (typeof rows[number] | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [rows]);
  const inspect = rows.find((r) => r.date === inspectDate) || null;
  const monthTrail = (audits ?? []).filter((row) => row.personKey === key && row.date.startsWith(month));
  const roleLine = [person.employeeId || "—", person.kind === "teacher" ? "Teacher" : person.role || "Employee", person.department || "Academic"]
    .filter(Boolean)
    .join(" · ");

  async function saveEdit() {
    if (!editDate) return;
    if (lockedPay && !unlock) {
      toast.show("Confirm that you want to change an approved month.");
      return;
    }
    const current = rows.find((r) => r.date === editDate);
    if (current?.mark && current.mark !== editStatus && !editReason.trim()) {
      toast.show("Add a reason for this correction.");
      return;
    }
    setBusy(true);
    try {
      await act(token, "correctStaffAttendance", {
        kind,
        id: person.id,
        date: editDate,
        status: editStatus,
        reason: editReason.trim() || "Attendance correction approved by administrator.",
        unlockApproved: unlock,
      });
      toast.show("Attendance updated.");
      setEditReason("");
      setUnlock(false);
      await onSaved();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function savePayroll(status: "PENDING" | "APPROVED") {
    setBusy(true);
    try {
      await act(token, "saveStaffPayroll", {
        kind,
        id: person.id,
        month,
        status,
        salary: summary.salary,
        workingDays: summary.working,
        payableDays: summary.payableDays,
        attendanceAdj: summary.attendanceAdj,
        otherAdj: summary.otherAdj,
        finalAmount: summary.finalAmount,
          snapshot: {
          present: summary.present,
          absent: summary.absent + (live.lateLeaveDays || 0),
          leave: summary.leave,
          halfDay: summary.halfDay,
          late: summary.late,
          lateLeaveDays: live.lateLeaveDays || 0,
        },
      });
      toast.show(status === "APPROVED" ? "Payment approved." : "Saved as pending review.");
      setReview(false);
      await onSaved();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save payment.");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const head = ["Date", "Day", "Attendance", "Remarks"];
    const lines = [head.join(","), ...rows.map((r) => [String(r.n).padStart(2, "0"), r.wd, r.letter, `"${r.remarks.replace(/"/g, '""')}"`].join(","))];
    lines.push("");
    lines.push(`Payable days,${summary.payableDays}`);
    if (salaryAccess.view) lines.push(`Final payable,${summary.finalAmount}`);
    const csv = `\uFEFF${lines.join("\n")}`;
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${person.name.replace(/\s+/g, "-")}-attendance-${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.show("Register exported.");
      return;
    }
    toast.show("Export is available on web.");
  }

  function printRegister() {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      toast.show("Print is available on web.");
      return;
    }
    const body = rows
      .map((r) => `<tr><td>${String(r.n).padStart(2, "0")}</td><td>${r.wd}</td><td>${r.letter}</td><td>${r.remarks}</td></tr>`)
      .join("");
    const html = `<!doctype html><html><head><title>${person.name} · ${monthTitle(month)}</title>
      <style>body{font-family:Inter,Arial,sans-serif;color:#102033;padding:24px}table{border-collapse:collapse;width:100%;font-size:12px}
      th,td{border:1px solid #dbe4ee;padding:6px 8px;text-align:left}th{background:#f4f7fb}</style></head>
      <body><h1>${person.name}</h1><p>${roleLine} · ${monthTitle(month)}</p>
      <table><thead><tr><th>Date</th><th>Day</th><th>Attendance</th><th>Remarks</th></tr></thead><tbody>${body}</tbody></table>
      <p>Payable days ${summary.payableDays}${salaryAccess.view ? ` · Final payable ${inr(summary.finalAmount)}` : ""}</p></body></html>`;
    const frame = window.open("", "_blank");
    if (!frame) {
      toast.show("Allow pop-ups to print.");
      return;
    }
    frame.document.write(html);
    frame.document.close();
    frame.focus();
    frame.print();
  }

  const payState = salaryPayState(run, (payments ?? []).filter((p) => p.personKey === key && p.month === month)).state;
  const pay = payBadge(run?.status, payState);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  function openDay(row: (typeof rows)[number]) {
    if (inspectDate === row.date) {
      setInspectDate("");
      setEditDate("");
      return;
    }
    setInspectDate(row.date);
    setEditDate(row.kind === "working" && !row.future ? row.date : "");
    setEditStatus(row.mark || "PRESENT");
    setEditReason("");
    setUnlock(false);
  }

  const calendarGrid = (
    <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <View className="flex-row border-b border-ink-100 bg-[#F8FAFC] px-0.5 py-1.5">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <Text key={label} className="flex-1 text-center text-[9px] font-semibold uppercase tracking-wide text-ink-500">
            {label}
          </Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} className="flex-row border-b border-ink-50">
          {week.map((row, di) =>
            row ? (
              <Pressable
                key={row.date}
                onPress={() => openDay(row)}
                accessibilityRole="button"
                accessibilityLabel={`${prettyDate(row.date)} ${dayLabel(row)}`}
                accessibilityState={{ selected: inspectDate === row.date }}
                className={`h-[52px] flex-1 items-center justify-center border-r border-ink-50 ${cellSurface(row)}`}
                style={inspectDate === row.date ? { borderWidth: 2, borderColor: "#2855F6", borderRadius: 8 } : undefined}
              >
                <Text className={`text-[10px] font-semibold ${row.today ? "text-clay-500" : "text-ink-600"}`}>
                  {String(row.n).padStart(2, "0")}
                </Text>
                <View className={`mt-0.5 h-5 min-w-[18px] items-center justify-center rounded px-1 ${badgeClass(row.letter)}`}>
                  <Text className={`text-[10px] font-semibold ${badgeClass(row.letter)}`}>{row.letter}</Text>
                </View>
                {row.today ? <Text className="text-[7px] font-semibold uppercase leading-3 text-clay-500">Today</Text> : null}
              </Pressable>
            ) : (
              <View key={`empty-${wi}-${di}`} className="h-[52px] flex-1 bg-[#FCFDFE]" />
            )
          )}
        </View>
      ))}
    </View>
  );

  const dayPanel = inspect ? (() => {
    const editable = inspect.kind === "working" && !inspect.future;
    const changed = editable && editStatus !== (inspect.mark || "PRESENT");
    const needsReason = changed && Boolean(inspect.mark);
    return (
      <View className="mt-2 rounded-xl border border-[#C7D5FF] bg-[#F7F9FF] p-3">
        <View className="flex-row items-start gap-2">
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold text-ink-900">{prettyDate(inspect.date)}</Text>
            <Text className="mt-0.5 text-[12px] text-ink-500" numberOfLines={2}>
              {dayLabel(inspect)}
              {inspect.remarks && inspect.remarks !== "—" && inspect.kind === "working" ? ` · ${inspect.remarks}` : ""}
            </Text>
          </View>
          <Pressable accessibilityLabel="Close day" hitSlop={8} onPress={() => { setInspectDate(""); setEditDate(""); }}>
            <Ionicons name="close" size={18} color="#64748b" />
          </Pressable>
        </View>
        {!editable ? (
          <Text className="mt-2 text-[12px] text-ink-500">
            {inspect.future ? "This day hasn't come yet." : "School was closed. Nothing to mark."}
          </Text>
        ) : (
          <>
            <View className="mt-3 flex-row gap-1.5">
              {(
                [
                  ["PRESENT", "Present"],
                  ["LATE", "Late"],
                  ["ABSENT", "Absent"],
                  ["LEAVE", "Leave"],
                  ["HALF_DAY", "Half"],
                ] as const
              ).map(([value, label]) => {
                const on = editStatus === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={`Mark ${label}`}
                    accessibilityState={{ selected: on }}
                    onPress={() => setEditStatus(value)}
                    className={`h-9 flex-1 items-center justify-center rounded-lg border ${on ? "border-[#2855F6] bg-[#2855F6]" : "border-ink-200 bg-white"}`}
                  >
                    <Text className={`text-[12px] font-semibold ${on ? "text-white" : "text-ink-700"}`}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {changed ? (
              <View className="mt-3 gap-2">
                <TextInput
                  value={editReason}
                  onChangeText={setEditReason}
                  placeholder={needsReason ? "Reason for the change (required)" : "Reason (optional)"}
                  placeholderTextColor="#94a3b8"
                  accessibilityLabel="Reason"
                  className="rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900"
                />
                {lockedPay ? (
                  <Pressable onPress={() => setUnlock((v) => !v)} className="flex-row items-center gap-2">
                    <View className={`h-4 w-4 items-center justify-center rounded border ${unlock ? "border-clay-500 bg-clay-500" : "border-ink-300 bg-white"}`}>
                      {unlock ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
                    </View>
                    <Text className="min-w-0 flex-1 text-[12px] text-ink-700">This month is approved. Reopen it to make this change.</Text>
                  </Pressable>
                ) : null}
                <View className="flex-row justify-end gap-2">
                  <Button variant="ghost" onPress={() => { setEditStatus(inspect.mark || "PRESENT"); setEditReason(""); }}>
                    Undo
                  </Button>
                  <Button onPress={() => void saveEdit()} disabled={busy || (needsReason && !editReason.trim()) || (lockedPay && !unlock)}>
                    {busy ? "Saving…" : "Save"}
                  </Button>
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>
    );
  })() : null;

  return (
    <Wrap {...(inSheet ? { className: "px-4 pb-6" } : { className: "min-h-0 flex-1", contentContainerClassName: "pb-6", keyboardShouldPersistTaps: "handled" as const })}>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="mb-3 flex-row items-center gap-3">
        {inSheet ? null : (
          <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Staff" className="h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white">
            <Ionicons name="chevron-back" size={18} color="#1F45C7" />
          </Pressable>
        )}
        <View className="h-10 w-10 items-center justify-center rounded-full bg-[#1F45C7]">
          <Text className="text-[13px] font-bold text-white">
            {person.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
          </Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[16px] font-bold text-ink-900" numberOfLines={1}>{person.name}</Text>
          <Text className="text-[12px] text-ink-500" numberOfLines={1}>{roleLine}</Text>
        </View>
        <View>
          <Pressable accessibilityLabel="More options" onPress={() => setMoreOpen((v) => !v)} className="h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white">
            <Ionicons name="ellipsis-horizontal" size={18} color="#334155" />
          </Pressable>
          <RnModal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
            <View className="flex-1 justify-end">
              <Pressable accessibilityLabel="Close" className="absolute inset-0 bg-black/40" onPress={() => setMoreOpen(false)} />
              <View className="mx-auto w-full max-w-md rounded-t-3xl bg-white px-3 pb-6 pt-2">
                <View className="mb-2 items-center">
                  <View className="h-1 w-10 rounded-full bg-ink-200" />
                </View>
                <Text className="px-3 pb-2 text-[13px] font-semibold text-ink-500">{person.name} · {monthTitle(month)}</Text>
                {(
                  [
                    ["download-outline", "Download register", salaryAccess.view ? "CSV of this month's attendance and pay" : "CSV of this month's attendance", exportCsv],
                    ["print-outline", "Print register", "Opens a printable page", printRegister],
                    ...(onEditSalary ? ([["create-outline", "Edit salary & profile", "Salary, role, reporting manager", onEditSalary]] as const) : []),
                  ] as const
                ).map(([icon, label, hint, fn]) => (
                  <Pressable
                    key={label}
                    onPress={() => {
                      setMoreOpen(false);
                      fn();
                    }}
                    className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-ink-50 hover:bg-ink-50"
                  >
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#EEF3FF]">
                      <Ionicons name={icon} size={18} color="#1F45C7" />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[15px] font-medium text-ink-900">{label}</Text>
                      <Text className="text-[12px] text-ink-500">{hint}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          </RnModal>
        </View>
      </View>

      <View className="mb-3 flex-row items-center gap-2">
        <Pressable accessibilityLabel="Previous month" onPress={() => setMonth(prev)} className="h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white">
          <Ionicons name="chevron-back" size={17} color="#1F45C7" />
        </Pressable>
        <View className="h-10 flex-1 items-center justify-center rounded-full border border-ink-200 bg-white">
          <Text className="text-[14px] font-semibold text-ink-900">{monthTitle(month)}</Text>
        </View>
        <Pressable accessibilityLabel="Next month" onPress={() => setMonth(next)} className="h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white">
          <Ionicons name="chevron-forward" size={17} color="#1F45C7" />
        </Pressable>
        {month !== now.slice(0, 7) ? (
          <Pressable onPress={() => setMonth(now.slice(0, 7))} className="h-10 justify-center rounded-full bg-[#EEF3FF] px-3.5">
            <Text className="text-[13px] font-semibold text-[#1F45C7]">This month</Text>
          </Pressable>
        ) : null}
      </View>

      {(() => {
        const pct = Math.round(summary.attendancePct);
        const absent = summary.absent + (live.lateLeaveDays || 0);
        const low = pct < 75;
        return (
          <View className="mb-3 overflow-hidden rounded-2xl bg-[#1F45C7] p-4">
            <View className="flex-row items-end justify-between">
              <View>
                <Text className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Attendance</Text>
                <Text className="text-[34px] font-bold leading-10 text-white">{pct}%</Text>
              </View>
              <View className="items-end">
                <Text className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Payable</Text>
                <Text className="text-[22px] font-bold text-white">
                  {summary.payableDays}
                  <Text className="text-[13px] font-medium text-white/70"> / {live.divisor} days</Text>
                </Text>
              </View>
            </View>
            <View className="mt-3 h-2 flex-row overflow-hidden rounded-full bg-white/20">
              <View className="bg-emerald-300" style={{ flex: summary.present }} />
              <View className="bg-amber-300" style={{ flex: summary.late + summary.halfDay }} />
              <View className="bg-sky-300" style={{ flex: summary.leave }} />
              <View className="bg-red-300" style={{ flex: absent }} />
              <View style={{ flex: Math.max(0, summary.working - summary.present - summary.late - summary.halfDay - summary.leave - absent) }} />
            </View>
            <View className="mt-3 flex-row">
              {(
                [
                  ["Present", summary.present, "#6ee7b7"],
                  ["Absent", absent, "#fca5a5"],
                  ["Leave", summary.leave, "#7dd3fc"],
                  ["Late / ½", summary.late + summary.halfDay, "#fcd34d"],
                ] as const
              ).map(([label, value, dot], idx) => (
                <View key={label} className={`flex-1 ${idx ? "border-l border-white/15 pl-3" : ""}`}>
                  <View className="flex-row items-center gap-1">
                    <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot }} />
                    <Text className="text-[11px] text-white/75">{label}</Text>
                  </View>
                  <Text className="mt-0.5 text-[17px] font-bold text-white">{value}</Text>
                </View>
              ))}
            </View>
            {low ? (
              <Text className="mt-3 text-[11px] text-amber-200">
                {salaryAccess.view ? `Below 75% this month · ${pay.label.toLowerCase()} pay` : "Below 75% this month"}
              </Text>
            ) : salaryAccess.view ? (
              <Text className="mt-3 text-[11px] text-white/70">Pay status: {pay.label}</Text>
            ) : null}
          </View>
        );
      })()}

      {phone ? (
        <View className="mb-3 flex-row rounded-xl bg-ink-100 p-1">
          {(
            [
              ["attendance", "Attendance"],
              ["leave", "Leave"],
              ...(salaryAccess.view ? ([["pay", `Pay · ${inr(summary.finalAmount)}`]] as const) : []),
            ] as const
          ).map(([id, label]) => {
            const on = section === id;
            return (
              <Pressable
                key={id}
                onPress={() => setSection(id)}
                className={`h-9 flex-1 items-center justify-center rounded-lg ${on ? "bg-white" : ""}`}
                style={on ? { shadowColor: "#0f172a", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } } : undefined}
              >
                <Text className={`text-[13px] font-semibold ${on ? "text-ink-900" : "text-ink-500"}`} numberOfLines={1}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {!phone || section === "leave" ? <EmployeeLeaveCard kind={person.kind} id={person.id} canEdit={Boolean(onEditSalary)} /> : null}

      <View className={`mb-3 ${split ? "flex-row items-stretch gap-3" : "gap-3"}`}>
        {!phone || section === "attendance" ? (
        <View className={split ? "w-[48%]" : "w-full"}>
          <View className="mb-2 flex-row flex-wrap items-center justify-between gap-2">
            <View>
              <Text className="text-[16px] font-semibold text-ink-900">{monthTitle(month)} Attendance</Text>
              <Text className="text-[12px] text-ink-500">Tap a day to see or change it</Text>
            </View>
          </View>
          {calendarGrid}
          {dayPanel}
          <View className="mt-2 flex-row flex-wrap items-center gap-x-2.5 gap-y-1">
            {(
              [
                ["P", "Present", "bg-emerald-500"],
                ["Lt", "Late", "bg-amber-500"],
                ["A", "Absent", "bg-red-500"],
                ["L", "Leave", "bg-sky-500"],
                ["HD", "Half Day", "bg-amber-500"],
                ["H", "Holiday", "bg-violet-400"],
                ["—", "Weekly off / not marked", "bg-ink-300"],
              ] as const
            ).map(([mark, label, dot]) => (
              <View key={label} className="flex-row items-center gap-1">
                <View className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                <Text className="text-[10px] text-ink-500">{label}</Text>
              </View>
            ))}
          </View>
        </View>
        ) : null}

        {salaryAccess.view && (!phone || section === "pay") ? (
        <View className={`${split ? "min-w-0 flex-1" : "w-full"} rounded-xl border border-ink-200 bg-white p-4`}>
          <View className={`mb-3 self-start rounded-md px-2 py-1 ${pay.className}`}>
            <Text className={`text-[11px] font-semibold ${pay.className}`}>Payment Status: {pay.label}</Text>
          </View>
          <View className="rounded-lg border border-clay-200 bg-[#EEF2FF] px-3 py-2.5">
            <Text className="text-[12px] font-semibold text-ink-900">Payable Days</Text>
            <Text className="mt-0.5 text-[22px] font-semibold text-ink-900">{summary.payableDays} Days</Text>
            <Text className="mt-0.5 text-[11px] text-ink-500">
              {`${salaryBasisLabel(payrollRules, live.divisor)} basis${payrollRules.sandwichRule ? " · sandwich rule on" : ""}`}
            </Text>
          </View>
          <Text className="mt-4 text-[15px] font-semibold text-ink-900">Monthly Payment</Text>
          <PayRow label="Monthly Salary" value={inr(summary.salary)} onEdit={salaryAccess.approve ? onEditSalary : undefined} />
          <PayRow label="Salary basis" value={salaryBasisLabel(payrollRules, live.divisor)} />
          <PayRow label="Working Days" value={String(summary.working)} />
          <PayRow label="Payable Days" value={String(summary.payableDays)} />
          {live.sandwichDays ? <PayRow label="Sandwich days (unpaid)" value={`−${live.sandwichDays}`} /> : null}
          {live.unpaidOffDays ? <PayRow label="Unpaid offs" value={`−${live.unpaidOffDays}`} /> : null}
          {live.lateLeaveDays ? (
            <PayRow
              label="Unpaid from lates"
              value={`−${live.lateCutDays} day${live.lateCutDays === 1 ? "" : "s"} (every ${payrollRules.latesPerLeaveDay} lates = ${payrollRules.latePenaltyDays === 0.5 ? "½" : "1"} day)`}
            />
          ) : null}
          <PayRow label="Daily Salary" value={inr(summary.dailySalary, 2)} />
          <PayRow label="Attendance Adjustment" value={inr(summary.attendanceAdj)} />
          <PayRow label="Other Adjustments" value={inr(summary.otherAdj)} />
          <View className="mt-3 rounded-lg border border-clay-200 bg-[#EEF2FF] px-3 py-3">
            <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Final Payable Amount</Text>
            <Text className="mt-1 text-[26px] font-semibold text-ink-900">{inr(summary.finalAmount)}</Text>
          </View>
          {salaryAccess.approve ? (
            <View className="mt-3">
              <Button onPress={() => setReview(true)} disabled={run?.status === "PAID" || payState === "PART_PAID"}>
                {run && run.status !== "PENDING" ? "Review salary" : "Review & approve"}
              </Button>
            </View>
          ) : null}
          <SalaryPayCard
            token={token}
            kind={kind}
            personId={person.id}
            personKey={key}
            month={month}
            runs={payroll}
            payments={payments}
            canPay={salaryAccess.pay}
            onSaved={onSaved}
            onMessage={toast.show}
          />
        </View>
        ) : null}
      </View>

      {monthTrail.length ? (
        <View className="mb-2 mt-3 rounded-xl border border-ink-200 bg-white">
          <View className="flex-row items-center justify-between border-b border-ink-100 px-4 py-3">
            <Text className="text-[14px] font-semibold text-ink-900">Changes this month</Text>
            <Text className="text-[12px] text-ink-500">{monthTrail.length}</Text>
          </View>
          {(historyAll ? monthTrail : monthTrail.slice(0, 3)).map((row, i) => {
            const to = AUDIT_STATUS[row.toStatus] || { label: row.toStatus, color: "#64748b" };
            const from = AUDIT_STATUS[row.fromStatus];
            const reason = row.reason && !/^attendance correction approved by administrator\.?$/i.test(row.reason.trim()) ? row.reason : "";
            const dayRow = rows.find((r) => r.date === row.date);
            return (
              <Pressable
                key={`${row.date}-${row.at}`}
                accessibilityRole="button"
                onPress={() => dayRow && openDay(dayRow)}
                className={`flex-row items-start gap-3 px-4 py-3 active:bg-ink-50 ${i ? "border-t border-ink-100" : ""}`}
              >
                <View className="mt-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: to.color }} />
                <View className="min-w-0 flex-1">
                  <Text className="text-[14px] text-ink-900">
                    <Text className="font-semibold">{shortDay(row.date)}</Text>
                    {from ? ` · ${from.label} → ${to.label}` : ` · Marked ${to.label}`}
                  </Text>
                  {reason ? <Text className="mt-0.5 text-[12px] leading-[17px] text-ink-700">{reason}</Text> : null}
                  <Text className="mt-0.5 text-[11px] text-ink-500">{changedAt(row.at)}</Text>
                </View>
              </Pressable>
            );
          })}
          {monthTrail.length > 3 ? (
            <Pressable accessibilityRole="button" onPress={() => setHistoryAll((v) => !v)} className="border-t border-ink-100 px-4 py-2.5">
              <Text className="text-[13px] font-semibold text-[#1F45C7]">{historyAll ? "Show less" : `Show all ${monthTrail.length}`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Modal
        open={review}
        title="Approve salary"
        onClose={() => setReview(false)}
        sheetOnPhone
        footer={
          <View className={phone ? "gap-2" : "flex-row justify-end gap-2"}>
            {phone ? null : (
              <Button variant="ghost" onPress={() => void savePayroll("PENDING")} disabled={busy}>
                Save for later
              </Button>
            )}
            <Button
              onPress={() => void savePayroll("APPROVED")}
              disabled={busy || run?.status === "APPROVED" || run?.status === "PAID"}
              className={phone ? "h-12 justify-center" : ""}
            >
              {`Approve ${inr(summary.finalAmount)}`}
            </Button>
            {phone ? (
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void savePayroll("PENDING")} className="h-10 items-center justify-center">
                <Text className="text-[14px] font-semibold text-ink-700">Save for later</Text>
              </Pressable>
            ) : null}
          </View>
        }
      >
        {/* 1. The answer first: what will be paid. */}
        <View className="items-center rounded-2xl bg-[#EEF3FF] px-4 py-5">
          <Text className="text-[13px] font-medium text-ink-600">{person.name} · {monthTitle(month)}</Text>
          <Text className="mt-1 text-[32px] font-bold tracking-tight text-ink-900">{inr(summary.finalAmount)}</Text>
          <Text className="mt-0.5 text-[13px] text-ink-600">
            {summary.payableDays === (live.divisor ?? summary.payableDays) ? "Full month salary" : `For ${summary.payableDays} of ${live.divisor ?? summary.payableDays} days`}
          </Text>
        </View>

        {/* 2. Attendance at a glance. */}
        <Text className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wide text-ink-500">Attendance</Text>
        <View className="flex-row overflow-hidden rounded-xl border border-ink-100">
          {[
            { label: "Working", value: summary.working, tone: "text-ink-900" },
            { label: "Present", value: summary.present, tone: "text-emerald-700" },
            { label: "Absent", value: summary.absent + (live.lateLeaveDays || 0), tone: summary.absent + (live.lateLeaveDays || 0) ? "text-red-700" : "text-ink-900" },
            { label: "Leave", value: summary.leave, tone: "text-ink-900" },
          ].map((cell, index) => (
            <View key={cell.label} className={`flex-1 items-center py-3 ${index ? "border-l border-ink-100" : ""}`}>
              <Text className={`text-[18px] font-semibold tabular-nums ${cell.tone}`}>{cell.value}</Text>
              <Text className="mt-0.5 text-[11px] text-ink-500">{cell.label}</Text>
            </View>
          ))}
        </View>

        {/* 3. How the amount is worked out, as a short sum. */}
        <Text className="mb-1 mt-5 text-[12px] font-semibold uppercase tracking-wide text-ink-500">How it's worked out</Text>
        <View className="rounded-xl border border-ink-100 px-4 pb-3">
          <PayRow label="Monthly salary" value={inr(summary.salary)} />
          <PayRow label={live.divisor ? `Per day (÷ ${live.divisor} days)` : "Per day"} value={inr(summary.dailySalary, 2)} />
          {live.sandwichDays ? <PayRow label="Sandwich days (unpaid)" value={`−${live.sandwichDays}`} /> : null}
          {live.unpaidOffDays ? <PayRow label="Unpaid offs" value={`−${live.unpaidOffDays}`} /> : null}
          {live.lateLeaveDays ? (
            <PayRow
              label={`Lates (every ${payrollRules.latesPerLeaveDay} = ${payrollRules.latePenaltyDays === 0.5 ? "½" : "1"} day)`}
              value={`−${live.lateCutDays} day${live.lateCutDays === 1 ? "" : "s"}`}
            />
          ) : null}
          <PayRow label="Payable days" value={`× ${summary.payableDays}`} />
          <View className="mt-3 flex-row items-center justify-between border-t border-ink-100 pt-3">
            <Text className="text-[14px] font-semibold text-ink-900">To pay</Text>
            <Text className="text-[15px] font-bold text-ink-900">{inr(summary.finalAmount)}</Text>
          </View>
        </View>
      </Modal>
    </Wrap>
  );
}

function PayRow({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  return (
    <View className="mt-2 flex-row items-center justify-between gap-3">
      <Text className="text-[13px] text-ink-500">{label}</Text>
      {onEdit ? (
        <Pressable onPress={onEdit} className="flex-row items-center gap-1" accessibilityRole="button" accessibilityLabel="Edit monthly salary">
          <Text className="text-[13px] font-medium text-ink-900">{value}</Text>
          <Ionicons name="create-outline" size={14} color="#2855F6" />
        </Pressable>
      ) : (
        <Text className="text-[13px] font-medium text-ink-900">{value}</Text>
      )}
    </View>
  );
}
