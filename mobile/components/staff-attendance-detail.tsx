import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
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
  summarizePayroll,
  type PayrollMark,
  type PayrollRules,
} from "../lib/payroll";
import type { RecordPayload } from "../lib/record";
import type { IoniconName } from "../lib/nav-icons";

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

function statusLabel(letter: string) {
  if (letter === "P") return "Present";
  if (letter === "A") return "Absent";
  if (letter === "Lt") return "Late";
  if (letter === "L") return "Leave";
  if (letter === "HD") return "Half day";
  if (letter === "H") return "Holiday";
  return "Weekend";
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

function payBadge(status?: string) {
  if (status === "APPROVED") return { label: "Approved", className: "bg-emerald-50 text-emerald-800" };
  if (status === "PAID") return { label: "Paid", className: "bg-sky-50 text-sky-800" };
  return { label: "Pending Review", className: "bg-amber-50 text-amber-800" };
}

export function StaffAttendanceDetail({
  person,
  calendar,
  rules,
  payroll,
  audits,
  token,
  onBack,
  onSaved,
  onEditSalary,
}: {
  person: StaffPerson;
  calendar: SchoolCalendar;
  rules?: PayrollRules | null;
  payroll?: RecordPayload["staffPayroll"];
  audits?: RecordPayload["staffAudits"];
  token: string | null;
  onBack: () => void;
  onSaved: () => Promise<void>;
  onEditSalary?: () => void;
}) {
  const toast = useToast();
  const { width } = useWindowDimensions();
  const split = width >= 960;
  const now = ymd(new Date());
  const [month, setMonth] = useState(now.slice(0, 7));
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editStatus, setEditStatus] = useState<PayrollMark>("PRESENT");
  const [editReason, setEditReason] = useState("");
  const [unlock, setUnlock] = useState(false);
  const [review, setReview] = useState(false);
  const [inspectDate, setInspectDate] = useState("");
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
  const trail = (audits ?? []).filter((row) => row.personKey === key).slice(0, 8);
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
      setEditing(false);
      setEditDate("");
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
    lines.push(`Final payable,${summary.finalAmount}`);
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
      <p>Payable days ${summary.payableDays} · Final payable ${inr(summary.finalAmount)}</p></body></html>`;
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

  const pay = payBadge(run?.status);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  function openDay(row: (typeof rows)[number]) {
    if (editing && row.kind === "working" && !row.future) {
      setEditDate(row.date);
      setEditStatus(row.mark === "LATE" ? "PRESENT" : row.mark || "PRESENT");
      setEditReason("");
      return;
    }
    setInspectDate(row.date);
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
                accessibilityLabel={`${prettyDate(row.date)} ${statusLabel(row.letter)}`}
                className={`h-[52px] flex-1 items-center justify-center border-r border-ink-50 ${cellSurface(row)}`}
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

  return (
    <ScrollView className="min-h-0 flex-1" contentContainerClassName="pb-6" keyboardShouldPersistTaps="handled">
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="mb-3 flex-row flex-wrap items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Pressable onPress={onBack} className="mb-1 flex-row items-center gap-1" accessibilityRole="button" accessibilityLabel="Back to Employees">
            <Ionicons name="chevron-back" size={16} color="#2855F6" />
            <Text className="text-[12px] font-medium text-clay-500">Back to Employees</Text>
          </Pressable>
          <Text className="text-[22px] font-semibold text-ink-900">{person.name}</Text>
          <Text className="mt-0.5 text-[13px] text-ink-500">{roleLine}</Text>
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <View className={`rounded-md px-2.5 py-1 ${pay.className}`}>
            <Text className={`text-[11px] font-semibold ${pay.className}`}>Payment Status: {pay.label}</Text>
          </View>
          <IconBtn label="Export" icon="download-outline" onPress={exportCsv} />
          <IconBtn label="Print" icon="print-outline" onPress={printRegister} />
        </View>
      </View>

      <View className="mb-3 flex-row flex-wrap items-center gap-2">
        <Pressable accessibilityLabel="Previous month" onPress={() => setMonth(prev)} className="h-9 flex-row items-center gap-1 rounded-md border border-ink-200 bg-white px-2.5">
          <Ionicons name="chevron-back" size={14} color="#334155" />
          <Text className="text-[12px] font-medium text-ink-700">{monthTitle(prev)}</Text>
        </Pressable>
        <View className="h-9 min-w-[148px] items-center justify-center rounded-md border border-ink-200 bg-[#EEF2FF] px-3">
          <Text className="text-[12px] font-semibold text-clay-500">{monthTitle(month)}</Text>
        </View>
        <Pressable accessibilityLabel="Next month" onPress={() => setMonth(next)} className="h-9 flex-row items-center gap-1 rounded-md border border-ink-200 bg-white px-2.5">
          <Text className="text-[12px] font-medium text-ink-700">{monthTitle(next)}</Text>
          <Ionicons name="chevron-forward" size={14} color="#334155" />
        </Pressable>
        <Pressable onPress={() => setMonth(now.slice(0, 7))} className="h-9 items-center justify-center rounded-md border border-ink-200 bg-white px-3">
          <Text className="text-[12px] font-medium text-ink-800">Current Month</Text>
        </Pressable>
      </View>

      <View className="mb-3 flex-row flex-wrap gap-2">
        <StatChip icon="calendar-outline" label="Working days" value={String(summary.working)} />
        <StatChip icon="checkmark-circle-outline" label="Present" value={String(summary.present)} />
        <StatChip icon="close-circle-outline" label="Absent" value={String(summary.absent + (live.lateLeaveDays || 0))} />
        <StatChip icon="walk-outline" label="Leave" value={String(summary.leave)} />
        <StatChip icon="time-outline" label="Late" value={String(summary.late)} />
        <StatChip icon="remove-circle-outline" label="Half day" value={String(summary.halfDay)} />
        <StatChip icon="stats-chart-outline" label="Attendance" value={`${summary.attendancePct.toFixed(0)}%`} />
        <StatChip icon="wallet-outline" label="Payable days" value={String(summary.payableDays)} emphasis />
      </View>

      <View className={`mb-3 ${split ? "flex-row items-stretch gap-3" : "gap-3"}`}>
        <View className={split ? "w-[48%]" : "w-full"}>
          <View className="mb-2 flex-row flex-wrap items-center justify-between gap-2">
            <View>
              <Text className="text-[16px] font-semibold text-ink-900">{monthTitle(month)} Attendance</Text>
              <Text className="text-[12px] text-ink-500">Monthly attendance overview</Text>
            </View>
            <Button variant="ghost" onPress={() => setEditing((v) => !v)}>
              {editing ? "Done" : "Edit Attendance"}
            </Button>
          </View>
          {editing ? (
            <Text className="mb-2 text-[11px] text-ink-500">Tap a working day to correct it. A reason is required when the status changes.</Text>
          ) : null}
          {calendarGrid}
          <View className="mt-2 flex-row flex-wrap items-center gap-x-2.5 gap-y-1">
            {(
              [
                ["P", "Present", "bg-emerald-500"],
                ["Lt", "Late", "bg-amber-500"],
                ["A", "Absent", "bg-red-500"],
                ["L", "Leave", "bg-sky-500"],
                ["HD", "Half Day", "bg-amber-500"],
                ["H", "Holiday", "bg-violet-400"],
                ["—", "Weekend", "bg-ink-300"],
              ] as const
            ).map(([mark, label, dot]) => (
              <View key={label} className="flex-row items-center gap-1">
                <View className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                <Text className="text-[10px] text-ink-500">{label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className={`${split ? "min-w-0 flex-1" : "w-full"} rounded-xl border border-ink-200 bg-white p-4`}>
          <View className={`mb-3 self-start rounded-md px-2 py-1 ${pay.className}`}>
            <Text className={`text-[11px] font-semibold ${pay.className}`}>Payment Status: {pay.label}</Text>
          </View>
          <View className="rounded-lg border border-clay-200 bg-[#EEF2FF] px-3 py-2.5">
            <Text className="text-[12px] font-semibold text-ink-900">Payable Days</Text>
            <Text className="mt-0.5 text-[22px] font-semibold text-ink-900">{summary.payableDays} Days</Text>
            <Text className="mt-0.5 text-[11px] text-ink-500">
              {payrollRules.latesPerLeaveDay
                ? `${payrollRules.latesPerLeaveDay} lates = 1 unpaid absent day`
                : "Calculated according to configured payroll rules"}
            </Text>
          </View>
          <Text className="mt-4 text-[15px] font-semibold text-ink-900">Monthly Payment</Text>
          <PayRow label="Monthly Salary" value={inr(summary.salary)} onEdit={onEditSalary} />
          <PayRow label="Working Days" value={String(summary.working)} />
          <PayRow label="Payable Days" value={String(summary.payableDays)} />
          {live.lateLeaveDays ? (
            <PayRow
              label="Unpaid from lates"
              value={`−${live.lateLeaveDays} day${live.lateLeaveDays === 1 ? "" : "s"} (${payrollRules.latesPerLeaveDay} lates = 1 absent)`}
            />
          ) : null}
          <PayRow label="Daily Salary" value={inr(summary.dailySalary, 2)} />
          <PayRow label="Attendance Adjustment" value={inr(summary.attendanceAdj)} />
          <PayRow label="Other Adjustments" value={inr(summary.otherAdj)} />
          <View className="mt-3 rounded-lg border border-clay-200 bg-[#EEF2FF] px-3 py-3">
            <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Final Payable Amount</Text>
            <Text className="mt-1 text-[26px] font-semibold text-ink-900">{inr(summary.finalAmount)}</Text>
          </View>
          <View className="mt-3">
            <Button onPress={() => setReview(true)} disabled={run?.status === "PAID"}>
              Review & Finalize Payment
            </Button>
          </View>
        </View>
      </View>

      {trail.length ? (
        <View className="mt-3 mb-2">
          <Text className="mb-1 text-[12px] font-semibold text-ink-700">Attendance change history</Text>
          {trail.map((row) => (
            <Text key={`${row.date}-${row.at}`} className="text-[11px] leading-5 text-ink-500">
              {row.date}: {row.fromStatus} → {row.toStatus} · {row.reason}
            </Text>
          ))}
        </View>
      ) : null}

      <Modal open={Boolean(inspect)} title={inspect ? prettyDate(inspect.date) : "Attendance"} onClose={() => setInspectDate("")}>
        {inspect ? (
          <View className="gap-3">
            <View>
              <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500">Attendance</Text>
              <Text className="mt-1 text-sm font-semibold text-ink-900">
                {inspect.letter} — {statusLabel(inspect.letter)}
              </Text>
            </View>
            <View>
              <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500">Remarks</Text>
              <Text className="mt-1 text-sm text-ink-700">
                {!inspect.remarks || inspect.remarks === "—" ? "No remarks" : inspect.remarks}
              </Text>
            </View>
            {inspect.kind === "working" && !inspect.future ? (
              <Button
                onPress={() => {
                  setEditDate(inspect.date);
                  setEditStatus(inspect.mark || "PRESENT");
                  setEditReason("");
                  setInspectDate("");
                }}
              >
                Change attendance
              </Button>
            ) : null}
          </View>
        ) : null}
      </Modal>

      <Modal open={Boolean(editDate)} title={editDate ? prettyDate(editDate) : "Edit"} onClose={() => setEditDate("")}>
        <View className="gap-3">
          <Text className="text-sm text-ink-700">
            Current status: {letterFor(rows.find((r) => r.date === editDate)?.mark || "", "working", false)} — {statusLabel(letterFor(rows.find((r) => r.date === editDate)?.mark || "", "working", false))}
          </Text>
          {EDIT_MARKS.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => setEditStatus(opt.value)}
              className={`rounded-md border px-3 py-2 ${editStatus === opt.value ? "border-clay-500 bg-[#EEF2FF]" : "border-ink-200"}`}
            >
              <Text className="text-sm font-medium text-ink-900">{opt.label}</Text>
            </Pressable>
          ))}
          <Text className="text-xs font-medium text-ink-700">Reason</Text>
          <TextInput
            value={editReason}
            onChangeText={setEditReason}
            placeholder="Attendance correction approved by administrator."
            className="min-h-[64px] rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-900"
            multiline
          />
          {lockedPay ? (
            <Pressable onPress={() => setUnlock((v) => !v)} className="flex-row items-center gap-2">
              <View className={`h-4 w-4 rounded border ${unlock ? "bg-clay-500 border-clay-500" : "border-ink-300"}`} />
              <Text className="text-xs text-ink-700">I confirm changing an approved payment month</Text>
            </Pressable>
          ) : null}
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={() => setEditDate("")}>
              Cancel
            </Button>
            <Button onPress={() => void saveEdit()} disabled={busy}>
              {busy ? "Saving…" : "Save Changes"}
            </Button>
          </View>
        </View>
      </Modal>

      <Modal open={review} title="Review & Finalize Payment" onClose={() => setReview(false)}>
        <View className="gap-2">
          <PayRow label="Employee" value={person.name} />
          <PayRow label="Month" value={monthTitle(month)} />
          <PayRow label="Working Days" value={String(summary.working)} />
          <PayRow label="Present" value={String(summary.present)} />
          <PayRow label="Absent" value={String(summary.absent + (live.lateLeaveDays || 0))} />
          <PayRow label="Leave" value={String(summary.leave)} />
          <PayRow label="Payable Days" value={String(summary.payableDays)} />
          {live.lateLeaveDays ? (
            <PayRow
              label="Unpaid from lates"
              value={`−${live.lateLeaveDays} day${live.lateLeaveDays === 1 ? "" : "s"} (${payrollRules.latesPerLeaveDay} lates = 1 absent)`}
            />
          ) : null}
          <PayRow label="Monthly Salary" value={inr(summary.salary)} />
          <PayRow label="Daily Salary" value={inr(summary.dailySalary, 2)} />
          <PayRow label="Final Payable" value={inr(summary.finalAmount)} />
          <View className="mt-3 flex-row flex-wrap justify-end gap-2">
            <Button variant="ghost" onPress={() => void savePayroll("PENDING")} disabled={busy}>
              Save as Pending
            </Button>
            <Button onPress={() => void savePayroll("APPROVED")} disabled={busy || run?.status === "APPROVED" || run?.status === "PAID"}>
              Approve Payment
            </Button>
          </View>
        </View>
      </Modal>
    </ScrollView>
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
