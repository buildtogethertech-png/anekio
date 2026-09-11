import { createElement, useMemo, useState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { GeneratePayment } from "./generate-payment";
import { Dropdown } from "./form";
import { Badge, Button, Card, Chip, Empty, Field, Input, Modal, PageHeader, Segmented, Sheet, Stat, Switch, Toast, useToast } from "./ui";
import { DateField } from "./date-field";
import { FilterBar, type FilterConfig, type FilterValues } from "./filter";
import { StaffAdmitForm, type StaffAdmitClass, type StaffAdmitPayload, type StaffAdmitRole } from "./staff-admit-form";
import { StaffAttendanceDetail } from "./staff-attendance-detail";
import { StudentAdmitForm, type StudentAdmitPayload } from "./student-admit-form";
import { ReportCardSheet, type ReportCardData } from "./report-card-sheet";
import { studentSeriesScore, studentYearScore } from "../lib/exams";
import { act, saveLateTiming } from "../lib/mutate";
import { apiBase } from "../lib/api";
import { useRecord, type AdmissionFormField } from "../lib/record";
import { useSession } from "../lib/session";
import { canChangeManager, ManagerPicker } from "./manager-picker";
import { AttendanceDots, DayMark, OnLeaveSign } from "./attendance-mark";
import { inr, parsePayrollRules, type PayrollRules } from "../lib/payroll";
import { lastAttendanceDots } from "../lib/attendance-summary";
import { calendarFrom, closedCaption, closedReason, ymd } from "../lib/calendar";
import { QuickDocumentButton } from "./document-studio";
import { StaffHoursForm, type StaffHoursFormHandle } from "./staff-hours-form";
import { StaffTimesheet } from "./staff-timesheet";

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

function dayKey(value?: string) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dt = new Date(raw);
  if (Number.isNaN(+dt)) return raw.slice(0, 10);
  if (dt.getTimezoneOffset() === -330 && dt.getHours() === 18 && dt.getMinutes() === 30 && dt.getSeconds() === 0) {
    const next = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : raw.slice(0, 10);
}

function dayOn<T extends { date: string }>(days: T[] | undefined, date: string) {
  const want = dayKey(date);
  return days?.find((row) => dayKey(row.date) === want);
}

function phoneHref(phone?: string) {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `tel:+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `tel:+${digits}`;
  return digits.length >= 8 ? `tel:+${digits}` : "";
}

function whatsappHref(phone?: string, text?: string) {
  const digits = (phone || "").replace(/\D/g, "");
  const number = digits.length === 10 ? `91${digits}` : digits.length >= 10 ? digits : "";
  return number ? `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ""}` : "";
}

function Row({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card className="p-4">
      <Text className="font-medium text-ink-900">{title}</Text>
      {hint ? <Text className="mt-1 text-sm text-ink-700">{hint}</Text> : null}
    </Card>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-start justify-between gap-4 border-b border-ink-100 py-2.5">
      <Text className="w-24 shrink-0 pt-0.5 text-xs text-ink-700">{label}</Text>
      <Text className="min-w-0 flex-1 text-right text-sm text-ink-900">{value || "—"}</Text>
    </View>
  );
}

function Pencil({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} className="h-8 w-8 items-center justify-center rounded-md">
      <Ionicons name="pencil-outline" size={16} color="#1d4ed8" />
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">{children}</Text>;
}

function FeeText({ label, tone }: { label?: string; tone?: string }) {
  const color =
    tone === "paid" ? "text-leaf-600" : tone === "overdue" ? "text-amber-800" : "text-amber-800";
  const bg = tone === "paid" ? "bg-emerald-50" : tone === "overdue" ? "bg-amber-50" : "bg-orange-50";
  if (!label) return null;
  return (
    <View className={`shrink-0 rounded px-2 py-1 ${bg}`}>
      <Text className={`text-[11px] font-semibold ${color}`}>{label}</Text>
    </View>
  );
}

function MoneyText({ amount }: { amount: number }) {
  if (amount <= 0) return <Text className="text-sm font-medium text-leaf-600">No dues</Text>;
  return <Text className="text-sm font-semibold text-amber-800">₹{Math.round(amount).toLocaleString("en-IN")} due</Text>;
}

function DetailField({ label, value }: { label: string; value?: string }) {
  return (
    <View className="min-w-[44%] flex-1 py-2">
      <Text className="text-xs text-ink-700">{label}</Text>
      <Text className="mt-1 text-sm font-medium text-ink-900" numberOfLines={2}>
        {value || "Not provided"}
      </Text>
    </View>
  );
}

function DetailSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View className="border-t border-ink-100 pt-4">
      <View className="mb-2 flex-row items-center justify-between gap-3">
        <Text className="text-sm font-semibold text-ink-900">{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

function MetricTile({ label, value, tone = "ink", hint }: { label: string; value: string; tone?: "ink" | "leaf" | "warn"; hint?: string }) {
  const valueColor = tone === "leaf" ? "text-green-700" : tone === "warn" ? "text-amber-800" : "text-ink-900";
  return (
    <View className="min-w-[30%] flex-1 rounded-md bg-ink-50 px-3 py-3">
      <Text className="text-xs text-ink-700">{label}</Text>
      <Text className={`mt-1 text-base font-semibold ${valueColor}`}>{value}</Text>
      {hint ? <Text className="mt-1 text-xs text-ink-700">{hint}</Text> : null}
    </View>
  );
}

function UnderlineTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="grow-0 border-b border-ink-100">
      <View className="flex-row gap-5">
        {tabs.map((tab) => {
          const on = tab.id === value;
          return (
            <Pressable key={tab.id} onPress={() => onChange(tab.id)} className={`pb-2 ${on ? "border-b-2 border-clay-500" : ""}`}>
              <Text className={`text-sm font-medium ${on ? "text-clay-600" : "text-ink-700"}`}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

type PeopleKind = "student" | "teacher" | "parent";
type StudentTab = "overview" | "fees" | "attendance" | "reports" | "documents";
type StudentSort = "name" | "class" | "due";

const PATH_OPTIONS = [
  { id: "OLYMPIAD", label: "Olympiad" },
  { id: "SPORTS", label: "Sports" },
  { id: "SPELLING", label: "Spelling" },
  { id: "ARTS", label: "Arts" },
  { id: "SCIENCE", label: "Science" },
] as const;

function pathIds(path?: string[]) {
  const rows = path ?? [];
  return PATH_OPTIONS.filter((p) => rows.includes(p.id) || rows.includes(p.label)).map((p) => p.id);
}

function childText(children: { name: string }[] | string | undefined) {
  if (Array.isArray(children)) return children.map((c) => c.name).join(", ");
  return children || "";
}

function joinedHint(joinedOn?: string) {
  const [y, m, d] = String(joinedOn || "")
    .trim()
    .slice(0, 10)
    .split("-")
    .map(Number);
  if (!y || !m || !d) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `Joined ${d} ${months[m - 1]} ${y}`;
}

function StatBox({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View className="min-w-[30%] flex-1 rounded-md border border-ink-200 px-3 py-2">
      <Text className="text-xs text-ink-700">{label}</Text>
      <Text className="mt-0.5 text-lg font-semibold text-ink-900">{value}</Text>
      {hint ? <Text className="text-xs text-amber-800">{hint}</Text> : null}
    </View>
  );
}

export function DeskBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const router = useRouter();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const [coverageFor, setCoverageFor] = useState("");
  const [coverBusy, setCoverBusy] = useState("");
  const desk = data?.desk;
  if (!desk) return <Empty title="The desk" body="Loading the school pulse." />;
  const desktop = width >= 900;
  const empty = desk.emptyPeriods;
  const overdue = desk.overdueCount ?? 0;
  const series = desk.series ?? [];
  const max = Math.max(...series.map((d) => d.amount), 1);
  const first = (user?.name || "").split(" ")[0] || "there";
  const fees = data?.fees ?? [];
  const feePaid = fees.filter((fee) => fee.status === "paid").length;
  const feeOverdue = fees.filter((fee) => fee.status === "overdue").length;
  const feeOpen = Math.max(0, fees.length - feePaid - feeOverdue);
  const feeTotal = Math.max(1, fees.length);
  const upcomingLeave = data?.upcomingLeave ?? [];
  const selectedLeave = upcomingLeave.find((leave) => leave.requestId === coverageFor) || null;
  const classAttendance = desk.classAttendance ?? [];
  const attendanceTotals = classAttendance.reduce(
    (sum, klass) => ({
      present: sum.present + klass.present,
      absent: sum.absent + klass.absent,
      unmarked: sum.unmarked + klass.unmarked,
      total: sum.total + klass.total,
    }),
    { present: 0, absent: 0, unmarked: 0, total: 0 }
  );
  const attention = [
    ...(desk.idleNow ?? []).map((row) => ({ label: row.name, hint: `${row.employeeId} · idle now`, route: "/staff" })),
    ...(desk.didNotCome ?? []).map((row) => ({ label: row.label, hint: "Did not come", route: "/staff" })),
    ...(desk.holes ?? []).map((row) => ({ label: row.classLabel, hint: `${row.count} unassigned period${row.count === 1 ? "" : "s"}`, route: "/timetable" })),
    ...upcomingLeave
      .filter((leave) => leave.covered < leave.total)
      .map((leave) => ({
        label: `${leave.teacherName} · upcoming leave`,
        hint: `${leave.total - leave.covered} period${leave.total - leave.covered === 1 ? "" : "s"} need cover`,
        route: "/staff",
      })),
  ].slice(0, 6);
  const shortMoney = (amount: number) =>
    amount >= 100000 ? `₹${(amount / 100000).toFixed(amount >= 1000000 ? 0 : 1)}L` : amount >= 1000 ? `₹${Math.round(amount / 1000)}k` : `₹${amount}`;
  const leaveRange = (from: string, to: string) => {
    const pretty = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    return from === to ? pretty(from) : `${pretty(from)}–${pretty(to)}`;
  };

  async function setCover(requestId: string, slotId: string, date: string, substituteId: string) {
    const key = `${date}:${slotId}`;
    setCoverBusy(key);
    try {
      await act(token, "assignSubstitute", { requestId, slotId, date, substituteId });
      toast.show(substituteId ? "Substitute assigned." : "Coverage cleared.");
      await reload();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not assign coverage.");
    } finally {
      setCoverBusy("");
    }
  }

  return (
    <View>
      <View className="mb-5 flex-row items-end justify-between gap-3 border-b border-ink-200 pb-4">
        <View>
          <Text className="text-xs font-medium uppercase tracking-wide text-clay-600">Admin desk</Text>
          <Text className="mt-1 text-2xl font-semibold text-ink-900">Good day, {first}</Text>
          <Text className="mt-1 text-sm text-ink-700">Live school operations and collection health.</Text>
        </View>
        <Button variant="ghost" onPress={() => router.push("/timetable")}>
          Routine
        </Button>
      </View>

      <View className="flex-row flex-wrap gap-3">
        {[
          { label: "Timetable gaps", value: String(empty), hint: empty ? "Needs assignment" : "Fully covered", route: "/timetable", danger: empty > 0 },
          { label: "Idle staff", value: String(desk.idleStaff), hint: "Available this stretch", route: "/staff", danger: false },
          { label: "Teacher absent", value: String(desk.teacherAbsent ?? 0), hint: "Assigned today", route: "/staff", danger: (desk.teacherAbsent ?? 0) > 0 },
          { label: "Fees overdue", value: String(overdue), hint: desk.dueNow || "₹0 pending", route: "/fees", danger: overdue > 0 },
        ].map((metric) => (
          <Pressable key={metric.label} className={desktop ? "w-[23.5%]" : "w-[47%]"} onPress={() => router.push(metric.route as never)}>
            <Card className="min-h-[124px] p-4">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">{metric.label}</Text>
                <Ionicons name="arrow-forward" size={15} color="#3d4f66" />
              </View>
              <Text className={`mt-3 text-3xl font-semibold ${metric.danger ? "text-red-600" : "text-ink-900"}`}>{metric.value}</Text>
              <Text className="mt-1 text-xs text-ink-700">{metric.hint}</Text>
            </Card>
          </Pressable>
        ))}
      </View>

      {toast.message ? <View className="mt-4"><Toast message={toast.message} onDone={toast.clear} /></View> : null}

      {upcomingLeave.length ? (
        <Card className="mt-4 overflow-hidden">
          <View className="flex-row items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
            <View>
              <Text className="text-base font-semibold text-ink-900">Upcoming teacher leave</Text>
              <Text className="mt-0.5 text-xs text-ink-700">Today and the next seven days</Text>
            </View>
            <Badge tone={upcomingLeave.some((leave) => leave.covered < leave.total) ? "warn" : "leaf"}>
              {upcomingLeave.some((leave) => leave.covered < leave.total) ? "Coverage needed" : "Covered"}
            </Badge>
          </View>
          {upcomingLeave.map((leave, index) => {
            const uncovered = leave.total - leave.covered;
            return (
              <View key={leave.requestId} className={`flex-row flex-wrap items-center gap-3 px-5 py-4 ${index ? "border-t border-ink-100" : ""}`}>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-ink-900">{leave.teacherName} · {leave.typeName}</Text>
                  <Text className="mt-0.5 text-xs text-ink-700">
                    {leaveRange(leave.from, leave.to)}{leave.reason ? ` · ${leave.reason}` : ""}
                  </Text>
                </View>
                <View className="items-end">
                  <Text className={`text-xs font-medium ${uncovered ? "text-amber-800" : "text-green-700"}`}>
                    {leave.total ? `${leave.covered}/${leave.total} periods covered` : "No scheduled periods"}
                  </Text>
                  {leave.total ? (
                    <Pressable className="mt-1" onPress={() => setCoverageFor(leave.requestId)}>
                      <Text className="text-sm font-medium text-clay-600">{uncovered ? "Assign cover" : "View coverage"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      <View className={`mt-4 gap-4 ${desktop ? "flex-row" : ""}`}>
        <Card className="flex-[1.4] p-5">
          <View className="flex-row items-start justify-between gap-3">
            <View>
              <Text className="text-base font-semibold text-ink-900">Collection trend</Text>
              <Text className="mt-0.5 text-xs text-ink-700">Last seven days</Text>
            </View>
            <View className="items-end">
              <Text className="text-xl font-semibold text-ink-900">{desk.weekAmount || "₹0"}</Text>
              <Text className="text-xs text-ink-700">Today {desk.todayAmount || "₹0"}</Text>
            </View>
          </View>
          <View className="mt-5 h-40 flex-row items-end gap-2">
            {series.map((point) => (
              <View key={`${point.label}-${point.isToday}`} className="flex-1 items-center justify-end">
                <Text className="mb-1 text-[9px] font-medium text-ink-700">{point.amount ? shortMoney(point.amount) : ""}</Text>
                <View className="h-28 w-full max-w-16 justify-end overflow-hidden rounded-md bg-ink-50">
                  <View
                    className={`w-full rounded-md ${point.isToday ? "bg-clay-500" : "bg-sky-400"}`}
                    style={{ height: Math.max(5, (point.amount / max) * 112) }}
                  />
                </View>
                <Text className={`mt-1.5 text-[10px] ${point.isToday ? "font-semibold text-clay-600" : "text-ink-700"}`}>{point.label}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Card className="flex-1 p-5">
          <View className="flex-row items-start justify-between gap-3">
            <View>
              <Text className="text-base font-semibold text-ink-900">Fee health</Text>
              <Text className="mt-0.5 text-xs text-ink-700">Recent invoice status</Text>
            </View>
            <Pressable onPress={() => router.push("/fees")}><Text className="text-sm text-clay-600">Open fees</Text></Pressable>
          </View>
          <View className="mt-7 h-4 flex-row overflow-hidden rounded-full bg-ink-100">
            {feePaid ? <View className="h-full bg-emerald-500" style={{ width: `${(feePaid / feeTotal) * 100}%` }} /> : null}
            {feeOpen ? <View className="h-full bg-amber-400" style={{ width: `${(feeOpen / feeTotal) * 100}%` }} /> : null}
            {feeOverdue ? <View className="h-full bg-red-500" style={{ width: `${(feeOverdue / feeTotal) * 100}%` }} /> : null}
          </View>
          <View className="mt-6 gap-3">
            {[
              ["Paid", feePaid, "bg-emerald-500"],
              ["Pending", feeOpen, "bg-amber-400"],
              ["Overdue", feeOverdue, "bg-red-500"],
            ].map(([label, count, color]) => (
              <View key={String(label)} className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-2"><View className={`h-2.5 w-2.5 rounded-full ${color}`} /><Text className="text-sm text-ink-700">{label}</Text></View>
                <Text className="text-sm font-semibold text-ink-900">{count}</Text>
              </View>
            ))}
          </View>
          <View className="mt-6 rounded-md bg-red-50 px-3 py-2.5">
            <Text className="text-xs text-red-700">{desk.dueNow || "₹0"} currently outstanding</Text>
          </View>
        </Card>
      </View>

      <View className={`mt-4 gap-4 ${desktop ? "flex-row" : ""}`}>
        <Card className="flex-[1.4] p-5">
          <View className="flex-row items-start justify-between gap-3">
            <View>
              <Text className="text-base font-semibold text-ink-900">Today’s attendance</Text>
              <Text className="mt-0.5 text-xs text-ink-700">Present, out, and still unmarked by class</Text>
            </View>
            <Pressable onPress={() => router.push("/people")}><Text className="text-sm text-clay-600">Open people</Text></Pressable>
          </View>
          <View className="mt-6 h-4 flex-row overflow-hidden rounded-full bg-ink-100">
            {attendanceTotals.present ? <View className="h-full bg-emerald-500" style={{ width: `${(attendanceTotals.present / Math.max(1, attendanceTotals.total)) * 100}%` }} /> : null}
            {attendanceTotals.absent ? <View className="h-full bg-red-500" style={{ width: `${(attendanceTotals.absent / Math.max(1, attendanceTotals.total)) * 100}%` }} /> : null}
            {attendanceTotals.unmarked ? <View className="h-full bg-amber-400" style={{ width: `${(attendanceTotals.unmarked / Math.max(1, attendanceTotals.total)) * 100}%` }} /> : null}
          </View>
          <View className="mt-3 flex-row flex-wrap gap-x-5 gap-y-2">
            {[
              ["Present", attendanceTotals.present, "bg-emerald-500"],
              ["Out", attendanceTotals.absent, "bg-red-500"],
              ["Unmarked", attendanceTotals.unmarked, "bg-amber-400"],
            ].map(([label, count, color]) => (
              <View key={String(label)} className="flex-row items-center gap-2">
                <View className={`h-2.5 w-2.5 rounded-full ${color}`} />
                <Text className="text-xs text-ink-700">{label} · {count}</Text>
              </View>
            ))}
          </View>
          <View className="mt-5 overflow-hidden rounded-md border border-ink-100">
            {classAttendance.slice(0, 8).map((klass, index) => {
              const marked = klass.present + klass.absent;
              const teacherAway = klass.teacherStatus === "ABSENT" || klass.teacherStatus === "LEAVE";
              const status = !marked
                ? teacherAway
                  ? `Teacher ${klass.teacherStatus.toLowerCase()} · not taken`
                  : "Attendance not taken"
                : klass.unmarked
                  ? `${klass.unmarked} unmarked`
                  : `${klass.percent}% · ${klass.absent} out`;
              const reminder = `Hi ${klass.teacherName}, attendance for ${klass.label} is still unmarked today. Please update it when possible.`;
              const teacherTel = phoneHref(klass.teacherPhone);
              const teacherWa = whatsappHref(klass.teacherPhone, reminder);
              return (
                <View key={klass.classId} className={`flex-row items-center gap-3 px-3 py-2.5 ${index ? "border-t border-ink-100" : ""}`}>
                  <View className="w-9"><Text className="text-xs font-semibold text-ink-900">{klass.label}</Text></View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-xs font-medium text-ink-900" numberOfLines={1}>{klass.teacherName}</Text>
                    <Text className={`text-[10px] ${!marked ? "text-amber-700" : klass.percent < 75 ? "text-red-600" : "text-ink-700"}`} numberOfLines={1}>{status}</Text>
                  </View>
                  <View className="flex-row items-center gap-4">
                    {teacherWa ? <Pressable accessibilityLabel={`WhatsApp ${klass.teacherName}`} onPress={() => void Linking.openURL(teacherWa)}><Ionicons name="logo-whatsapp" size={20} color="#16a34a" /></Pressable> : null}
                    {teacherTel ? <Pressable accessibilityLabel={`Call ${klass.teacherName}`} onPress={() => void Linking.openURL(teacherTel)}><Ionicons name="call-outline" size={19} color="#2454d8" /></Pressable> : null}
                    {!teacherWa && !teacherTel ? <Text className="text-[10px] text-ink-700">No phone</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        </Card>

        <Card className="flex-1 overflow-hidden">
          <View className="border-b border-ink-100 px-5 py-4">
            <Text className="text-base font-semibold text-ink-900">Needs attention</Text>
            <Text className="mt-0.5 text-xs text-ink-700">Live staffing and timetable issues</Text>
          </View>
          {attention.length ? attention.map((row, index) => (
            <Pressable key={`${row.label}-${index}`} onPress={() => router.push(row.route as never)} className={`px-5 py-3 ${index ? "border-t border-ink-100" : ""}`}>
              <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>{row.label}</Text>
              <Text className="mt-0.5 text-xs text-red-600">{row.hint}</Text>
            </Pressable>
          )) : (
            <View className="items-center px-5 py-10">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-emerald-50"><Ionicons name="checkmark" size={22} color="#15803d" /></View>
              <Text className="mt-3 text-sm font-medium text-ink-900">Operations look healthy</Text>
              <Text className="mt-1 text-center text-xs text-ink-700">No staffing or timetable issues right now.</Text>
            </View>
          )}
        </Card>
      </View>

      <Modal
        open={Boolean(selectedLeave)}
        title={selectedLeave ? `Cover · ${selectedLeave.teacherName}` : "Leave coverage"}
        onClose={() => setCoverageFor("")}
        wide
      >
        {selectedLeave ? (
          <View>
            <View className="mb-4 rounded-md bg-ink-50 px-4 py-3">
              <Text className="text-sm font-medium text-ink-900">{selectedLeave.typeName} · {leaveRange(selectedLeave.from, selectedLeave.to)}</Text>
              <Text className="mt-1 text-xs text-ink-700">Recommended teachers match the subject and are free in that period.</Text>
            </View>
            {selectedLeave.slots.map((slot, index) => {
              const key = `${slot.date}:${slot.slotId}`;
              return (
                <View key={key} className={`py-4 ${index ? "border-t border-ink-100" : ""}`}>
                  <View className="flex-row flex-wrap items-start justify-between gap-3">
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-semibold text-ink-900">{slot.classLabel} · {slot.subject}</Text>
                      <Text className="mt-0.5 text-xs text-ink-700">
                        {leaveRange(slot.date, slot.date)} · {slot.period}{slot.startsAt ? ` · ${slot.startsAt}${slot.endsAt ? `–${slot.endsAt}` : ""}` : ""}{slot.room ? ` · ${slot.room}` : ""}
                      </Text>
                    </View>
                    {slot.substituteName ? <Badge tone="leaf">{slot.substituteName}</Badge> : <Badge tone="warn">Uncovered</Badge>}
                  </View>
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    {slot.candidates.length ? slot.candidates.slice(0, 8).map((candidate) => (
                      <Chip
                        key={candidate.id}
                        label={`${candidate.match ? "★ " : ""}${candidate.name}`}
                        active={slot.substituteId === candidate.id}
                        onPress={() => void setCover(selectedLeave.requestId, slot.slotId, slot.date, candidate.id)}
                      />
                    )) : <Text className="text-xs text-red-700">No teacher is free in this period.</Text>}
                    {slot.substituteId ? (
                      <Pressable
                        disabled={coverBusy === key}
                        onPress={() => void setCover(selectedLeave.requestId, slot.slotId, slot.date, "")}
                        className="justify-center px-2"
                      >
                        <Text className="text-xs text-red-700">Clear</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

export function PeopleBoard({ studentOnly = false, title = "Students" }: { studentOnly?: boolean; title?: string }) {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const toast = useToast();
  const params = useLocalSearchParams<{ student?: string | string[] }>();
  const incoming = Array.isArray(params.student) ? params.student[0] : params.student;
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<PeopleKind>("student");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [parentQuery, setParentQuery] = useState("");
  const [feeFilter, setFeeFilter] = useState<"all" | "due" | "overdue" | "clear">(incoming ? "due" : "all");
  const [studentSort, setStudentSort] = useState<StudentSort>("name");
  const [picked, setPicked] = useState<{ kind: PeopleKind; id: string } | null>(
    incoming ? { kind: "student", id: incoming } : null
  );
  const [payOpen, setPayOpen] = useState(false);
  const [openCard, setOpenCard] = useState<ReportCardData | null>(null);
  const [add, setAdd] = useState<PeopleKind | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importCsv, setImportCsv] = useState("");
  const [importKind, setImportKind] = useState<PeopleKind>("student");
  const [fileTab, setFileTab] = useState<StudentTab>("overview");
  const [fileEdit, setFileEdit] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<Record<string, any>>({});
  const [editTags, setEditTags] = useState<string[]>([]);
  const [idCardPending, setIdCardPending] = useState(false);
  const people = data?.people ?? [];
  const teachersAll = data?.peopleTeachers ?? [];
  const parentsAll = data?.peopleParents ?? [];
  const showFees = can(user, "fees.view");
  const needle = q.trim().toLowerCase();
  const parentNeedle = parentQuery.trim().toLowerCase();
  const showStudents = studentOnly || kind === "student";
  const showTeachers = !studentOnly && kind === "teacher";
  const showParents = false;
  const filtered = people.filter((s) => {
    if (classIds.length && !classIds.includes(s.classId || "")) return false;
    if (showFees && feeFilter === "due" && !(s.dueAmount && s.dueAmount > 0)) return false;
    if (showFees && feeFilter === "overdue" && !(s.overdueCount && s.overdueCount > 0)) return false;
    if (showFees && feeFilter === "clear" && (s.dueAmount || 0) > 0) return false;
    if (parentNeedle && ![s.parent, s.parentEmail, s.parentPhone].join(" ").toLowerCase().includes(parentNeedle)) return false;
    if (!needle) return true;
    return [s.name, s.admissionNo, s.parent, s.classLabel, s.parentEmail, s.parentPhone].join(" ").toLowerCase().includes(needle);
  });
  const sortedStudents = [...filtered].sort((a, b) => {
    if (studentSort === "class") {
      return a.classLabel.localeCompare(b.classLabel) || a.name.localeCompare(b.name);
    }
    if (studentSort === "due") {
      return (b.dueAmount || 0) - (a.dueAmount || 0) || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });
  const filteredTeachers = teachersAll.filter((t) => {
    if (!needle) return true;
    return [t.name, t.email, t.employeeId, t.qualification, t.classLabel, t.role, t.managerName]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const filteredParents = parentsAll.filter((p) => {
    if (!needle) return true;
    return [p.name, p.email, p.phone, childText(p.children), p.address].join(" ").toLowerCase().includes(needle);
  });
  const selectedStudent =
    picked?.kind === "student"
      ? people.find((s) => s.id === picked.id) || (wide ? sortedStudents[0] || null : null)
      : wide && showStudents && !showTeachers && !showParents
        ? sortedStudents[0] || null
        : null;
  const selectedTeacher =
    picked?.kind === "teacher"
      ? teachersAll.find((t) => t.id === picked.id) || (wide ? filteredTeachers[0] || null : null)
      : null;
  const selectedParent =
    picked?.kind === "parent"
      ? filteredParents.find((p) => p.id === picked.id) || (wide ? filteredParents[0] || null : null)
      : null;
  const selected = selectedStudent;

  useEffect(() => {
    if (!incoming) return;
    setFeeFilter("due");
    setClassIds([]);
    setKind("student");
    setPicked({ kind: "student", id: incoming });
    setFileTab("overview");
  }, [incoming]);
  useEffect(() => {
    setFileTab("overview");
  }, [picked?.id]);
  useEffect(() => {
    setFileEdit(false);
  }, [picked?.id, fileTab]);
  const examPack = data?.examPack;
  const classSittings = (examPack?.series ?? []).filter((s) => s.classId === selected?.classId);
  const yearSession =
    classSittings.find((s) => s.sessionCurrent)?.sessionId ?? classSittings[0]?.sessionId ?? "";
  const yearPlan = yearSession ? examPack?.planBySession[yearSession] ?? [] : [];
  const yearSittings = classSittings.filter((s) => s.sessionId === yearSession);
  const year =
    selected && yearPlan.length
      ? studentYearScore(selected.id, yearPlan, yearSittings, examPack?.policy ?? { bands: [], passPercent: 33, showRank: false, reportCardPaidMonths: 0 })
      : null;
  const classmates = people.filter((s) => s.classId === selected?.classId);
  const feeAddOnOptions = (data?.feeTemplates ?? []).flatMap((template) =>
    template.lines
      .filter((line) => line.scope === "ADD_ON")
      .map((line) => ({
        id: `${template.id}:${line.label}`,
        classId: template.classId,
        label: line.label,
        kind: "CHARGE",
        amount: line.amount,
        startsPeriod: template.startsPeriod || "",
        endsPeriod: template.endsPeriod || "",
      }))
  );
  const studentFilters = useMemo<FilterConfig[]>(() => {
    const filters: FilterConfig[] = [
      {
        key: "classIds",
        label: "Class",
        type: "multi-select",
        options: (data?.classes ?? []).map((c) => ({ id: c.id, label: c.label })),
      },
      {
        key: "parentQuery",
        label: "Parent",
        type: "text",
        placeholder: "Name, phone, or email",
      },
    ];
    if (showFees) {
      filters.push({
        key: "feeStatus",
        label: "Fee status",
        type: "single-select",
        options: [
          { id: "due", label: "Due" },
          { id: "overdue", label: "Overdue" },
          { id: "clear", label: "Paid up" },
        ],
      });
    }
    return filters;
  }, [data?.classes, showFees]);
  const studentFilterValues = useMemo<FilterValues>(
    () => ({
      classIds,
      parentQuery,
      feeStatus: feeFilter === "all" ? "" : feeFilter,
    }),
    [classIds, parentQuery, feeFilter]
  );

  function applyStudentFilters(values: FilterValues) {
    const nextClassIds = values.classIds;
    const nextParentQuery = values.parentQuery;
    const nextFeeStatus = values.feeStatus;
    setClassIds(Array.isArray(nextClassIds) ? nextClassIds : []);
    setParentQuery(typeof nextParentQuery === "string" ? nextParentQuery : "");
    setFeeFilter(nextFeeStatus === "due" || nextFeeStatus === "overdue" || nextFeeStatus === "clear" ? nextFeeStatus : "all");
  }

  function pickKind(next: PeopleKind) {
    setKind(next);
    setFileTab("overview");
    if (!wide) {
      setPicked(null);
      return;
    }
    if (next === "student") setPicked(sortedStudents[0] ? { kind: "student", id: sortedStudents[0].id } : null);
    if (next === "teacher") setPicked(filteredTeachers[0] ? { kind: "teacher", id: filteredTeachers[0].id } : null);
    if (next === "parent") setPicked(filteredParents[0] ? { kind: "parent", id: filteredParents[0].id } : null);
  }

  const listTools = (
    <View className="gap-3 p-3">
      {showStudents ? (
        <FilterBar
          searchPlaceholder="Search students"
          searchValue={q}
          onSearchChange={setQ}
          filters={studentFilters}
          values={studentFilterValues}
          onApply={applyStudentFilters}
        />
      ) : (
        <Input placeholder="Search" value={q} onChangeText={setQ} className="border-ink-100 bg-ink-50" />
      )}
      {showStudents ? (
        <View className="flex-row flex-wrap items-center gap-1.5">
          {(["name", "class", "due"] as StudentSort[]).map((id) => (
            <Pressable
              key={id}
              onPress={() => setStudentSort(id)}
              className={`rounded-full px-2.5 py-1 ${studentSort === id ? "bg-ink-900" : "bg-ink-50"}`}
            >
              <Text className={`text-xs font-medium ${studentSort === id ? "text-white" : "text-ink-700"}`}>
                {id === "name" ? "Name" : id === "class" ? "Class" : "Due"}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  async function saveAdd() {
    try {
      if (add === "parent") {
        await act(token, "createParent", form);
      } else if (add === "teacher") {
        await act(token, "createTeacher", form);
      } else {
        return;
      }
      setAdd(null);
      setForm({});
      toast.show("Saved.");
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function addStudent(values: StudentAdmitPayload) {
    try {
      await act(token, "createStudent", values);
      setAdd(null);
      setForm({});
      toast.show("Student added.");
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
      throw e;
    }
  }

  async function saveFile() {
    try {
      if (kind === "student" && selected) {
        await act(token, "updateStudent", {
          studentId: selected.id,
          name: edit.name || selected.name,
          admissionNo: edit.admissionNo || selected.admissionNo,
          classId: edit.classId || selected.classId,
          parentId: edit.parentId || selected.parentId,
          dateOfBirth: edit.dateOfBirth || selected.dateOfBirth,
          tags: editTags,
          parentName: edit.parentName || selected.parent,
          parentEmail: edit.parentEmail || selected.parentEmail,
          parentPhone: edit.parentPhone || selected.parentPhone,
          address: edit.address || selected.parentStreet || selected.parentAddress,
          city: edit.city || selected.parentCity,
          state: edit.state || selected.parentState,
          pincode: edit.pincode || selected.parentPincode,
          feeAddOns: edit.feeAddOns ?? selected.feeAddOns ?? [],
        });
      } else if (kind === "parent" && selectedParent) {
        await act(token, "updateParent", {
          parentId: selectedParent.id,
          name: edit.name || selectedParent.name,
          email: edit.email || selectedParent.email,
          phone: edit.phone || selectedParent.phone,
          address: edit.address || selectedParent.street || selectedParent.address,
          city: edit.city || selectedParent.city,
          state: edit.state || selectedParent.state,
          pincode: edit.pincode || selectedParent.pincode,
        });
      } else if (kind === "teacher" && selectedTeacher) {
        await act(token, "updateTeacher", {
          teacherId: selectedTeacher.id,
          name: edit.name || selectedTeacher.name,
          email: edit.email || selectedTeacher.email,
          phone: edit.phone || selectedTeacher.phone,
          employeeId: selectedTeacher.employeeId,
          qualification: edit.qualification || selectedTeacher.qualification,
          ...(canChangeManager(user, selectedTeacher.managerId) && edit.managerId !== undefined
            ? { managerId: edit.managerId || null }
            : {}),
        });
      } else {
        return;
      }
      setFileEdit(false);
      toast.show("Saved.");
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function issueStudentIdCard() {
    if (!data || !selected) return;
    const template = (data.documentStudio?.templates || []).find((row) => row.status === "ACTIVE" && row.type === "STUDENT_ID");
    if (!template) {
      toast.show("Publish the Student ID card template in Settings first.");
      return;
    }
    setIdCardPending(true);
    try {
      const result = await act<{ ok: true; documentUrl: string }>(token, "issueDocument", {
        templateId: template.id,
        subjectType: "STUDENT",
        subjectId: selected.id,
        subjectLabel: selected.name,
        data: {
          school: data.school,
          student: selected,
          document: {},
        },
      });
      await reload();
      await Linking.openURL(result.documentUrl);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not issue ID card.");
    } finally {
      setIdCardPending(false);
    }
  }

  async function openFeeDocument(inv: { id: string; invoiceUrl?: string; receiptUrl?: string }, paid: boolean) {
    const directUrl = paid ? inv.receiptUrl : inv.invoiceUrl;
    if (directUrl) {
      await Linking.openURL(directUrl);
      return;
    }
    try {
      const result = await act<{ ok: true; token: string }>(token, "ensurePayToken", { invoiceId: inv.id });
      const shareToken = encodeURIComponent(result.token);
      const url = paid ? `${apiBase()}/pay/${shareToken}?paid=1` : `${apiBase()}/i/${shareToken}`;
      await reload();
      await Linking.openURL(url);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not open fee document.");
    }
  }

  function StudentPane({ bare }: { bare?: boolean }) {
    if (!selected) {
      return <Empty title="Pick a student" body="Family details and report cards show here." />;
    }
    const classTeacher = teachersAll.find((teacher) => teacher.classId && teacher.classId === selected.classId);
    const latestIdCard = (data?.documentStudio?.issued || [])
      .filter((row) => row.type === "STUDENT_ID" && row.subjectType === "STUDENT" && row.subjectId === selected.id)
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())[0];
    const activeIdTemplate = (data?.documentStudio?.templates || []).some((row) => row.status === "ACTIVE" && row.type === "STUDENT_ID");
    const studentDocs = (data?.documentStudio?.issued || [])
      .filter((row) => row.subjectType === "STUDENT" && row.subjectId === selected.id)
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime());
    const docTypeLabel = (type: string) =>
      data?.documentStudio?.types?.find((row) => row.id === type)?.label || type.replace(/_/g, " ").toLowerCase();
    const parentTel = phoneHref(selected.parentPhone);
    const header = (
      <>
        <View className="flex-row flex-wrap items-start justify-between gap-4">
          <View className="min-w-0 flex-1 flex-row items-start gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-full bg-ink-100">
              <Text className="text-base font-semibold text-ink-900">{initials(selected.name)}</Text>
            </View>
            <View className="min-w-0 flex-1">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="text-2xl font-semibold text-ink-900" numberOfLines={1}>{selected.name}</Text>
                {showFees ? <FeeText label={selected.feeLabel} tone={selected.feeTone} /> : null}
              </View>
              <Text className="mt-1 text-sm text-ink-800">{selected.classLabel} · {selected.admissionNo}</Text>
              {selected.born ? <Text className="mt-0.5 text-xs text-ink-700">Born {selected.born}</Text> : null}
            </View>
          </View>
          <View className="flex-row flex-wrap justify-end gap-2">
            {can(user, "people.edit") ? (
              <Button
                variant="ghost"
                onPress={() => {
                  setEdit({
                    name: selected.name,
                    admissionNo: selected.admissionNo,
                    dateOfBirth: selected.dateOfBirth || "",
                    classId: selected.classId || "",
                    parentId: selected.parentId || "",
                    parentName: selected.parent,
                    parentEmail: selected.parentEmail || "",
                    parentPhone: selected.parentPhone || "",
                    address: selected.parentStreet || selected.parentAddress || "",
                    city: selected.parentCity || "",
                    state: selected.parentState || "",
                    pincode: selected.parentPincode || "",
                    feeAddOns: (selected.feeAddOns ?? []).map((addOn) => ({ ...addOn, amount: String(addOn.amount) })),
                  });
                  setEditTags(pathIds(selected.path));
                  setFileTab("overview");
                  setFileEdit(true);
                }}
              >
                Edit
              </Button>
            ) : null}
            <Button variant="ghost" onPress={() => setFileTab("documents")}>Documents</Button>
            <Pressable
              disabled={!parentTel}
              onPress={() => parentTel ? void Linking.openURL(parentTel) : undefined}
              className={`h-[42px] w-[42px] items-center justify-center rounded-md border border-ink-200 bg-white ${parentTel ? "" : "opacity-50"}`}
            >
              <Ionicons name="call-outline" size={18} color="#3d4f66" />
            </Pressable>
          </View>
        </View>
        <View className="mt-5">
          <UnderlineTabs
            tabs={[
              { id: "overview", label: "Overview" },
              ...(showFees ? [{ id: "fees", label: "Fees" }] : []),
              { id: "attendance", label: "Attendance" },
              { id: "reports", label: "Exams & Reports" },
              { id: "documents", label: "Documents" },
            ]}
            value={fileTab}
            onChange={(id) => setFileTab(id as StudentTab)}
          />
        </View>
      </>
    );
    const fileBody = fileEdit ? (
      <View className="mt-3 gap-3">
        <Field label="Name">
          <Input value={edit.name ?? selected.name} onChangeText={(v) => setEdit((p) => ({ ...p, name: v }))} />
        </Field>
        <Field label="Admission no.">
          <Input value={edit.admissionNo ?? selected.admissionNo} onChangeText={(v) => setEdit((p) => ({ ...p, admissionNo: v }))} />
        </Field>
        <Field label="Date of birth">
          <DateField
            value={edit.dateOfBirth ?? selected.dateOfBirth ?? ""}
            onChange={(v) => setEdit((p) => ({ ...p, dateOfBirth: v }))}
          />
        </Field>
        <Field label="Class">
          <View className="flex-row flex-wrap gap-1.5">
            {(data?.classes ?? []).map((c) => (
              <Chip
                key={c.id}
                label={c.label}
                active={(edit.classId || selected.classId) === c.id}
                onPress={() => setEdit((p) => ({ ...p, classId: c.id }))}
              />
            ))}
          </View>
        </Field>
        <Field label="Parent">
          <Input value={edit.parentName ?? selected.parent} onChangeText={(v) => setEdit((p) => ({ ...p, parentName: v }))} />
        </Field>
        <Field label="Phone">
          <Input keyboardType="phone-pad" value={edit.parentPhone ?? selected.parentPhone ?? ""} onChangeText={(v) => setEdit((p) => ({ ...p, parentPhone: v }))} />
        </Field>
        <Field label="Email">
          <Input autoCapitalize="none" value={edit.parentEmail ?? selected.parentEmail ?? ""} onChangeText={(v) => setEdit((p) => ({ ...p, parentEmail: v }))} />
        </Field>
        <Field label="Address">
          <Input value={edit.address ?? selected.parentStreet ?? selected.parentAddress ?? ""} onChangeText={(v) => setEdit((p) => ({ ...p, address: v }))} />
        </Field>
        <Field label="Path">
          <View className="flex-row flex-wrap gap-1.5">
            {PATH_OPTIONS.map((p) => (
              <Chip
                key={p.id}
                label={p.label}
                active={editTags.includes(p.id)}
                onPress={() =>
                  setEditTags((tags) => (tags.includes(p.id) ? tags.filter((id) => id !== p.id) : [...tags, p.id]))
                }
              />
            ))}
          </View>
        </Field>
        {showFees ? (
          <Field label="Student add-ons">
            <View className="gap-2">
              {feeAddOnOptions.length ? (
                <View className="flex-row flex-wrap gap-1.5">
                  {feeAddOnOptions
                    .filter((option) => !option.classId || option.classId === (edit.classId || selected.classId))
                    .map((option) => {
                      const rows = (edit.feeAddOns ?? selected.feeAddOns ?? []) as NonNullable<typeof selected.feeAddOns>;
                      const active = rows.some((row) => row.label.toLowerCase() === option.label.toLowerCase());
                      return (
                        <Chip
                          key={`${option.classId}-${option.label}`}
                          label={option.label}
                          active={active}
                          onPress={() =>
                            setEdit((prev) => {
                              const current = (prev.feeAddOns ?? selected.feeAddOns ?? []) as NonNullable<typeof selected.feeAddOns>;
                              return {
                                ...prev,
                                feeAddOns: active
                                  ? current.filter((row) => row.label.toLowerCase() !== option.label.toLowerCase())
                                  : [
                                      ...current,
                                      {
                                        label: option.label,
                                        kind: option.kind,
                                        amount: option.amount,
                                        cadence: "MONTHLY",
                                        startsPeriod: option.startsPeriod,
                                        endsPeriod: option.endsPeriod,
                                      },
                                    ],
                              };
                            })
                          }
                        />
                      );
                    })}
                </View>
              ) : (
                <Text className="text-xs text-ink-700">No add-ons configured for this class yet.</Text>
              )}
              {((edit.feeAddOns ?? selected.feeAddOns ?? []) as NonNullable<typeof selected.feeAddOns>).length ? (
                <View className="gap-2 rounded-md border border-ink-100 bg-ink-50 p-2">
                  {((edit.feeAddOns ?? selected.feeAddOns ?? []) as NonNullable<typeof selected.feeAddOns>).map((addOn) => (
                    <View key={addOn.label} className="flex-row items-end gap-2">
                      <View className="min-w-0 flex-1">
                        <Text className="text-xs font-medium text-ink-800">{addOn.label}</Text>
                        <Text className="text-[11px] text-ink-600">{addOn.kind === "DISCOUNT" ? "Monthly discount" : "Monthly add-on"}</Text>
                      </View>
                      <View className="w-32">
                        <Input
                          keyboardType="number-pad"
                          value={String(addOn.amount)}
                          onChangeText={(amount) =>
                            setEdit((prev) => {
                              const current = (prev.feeAddOns ?? selected.feeAddOns ?? []) as NonNullable<typeof selected.feeAddOns>;
                              return {
                                ...prev,
                                feeAddOns: current.map((row) => (row.label === addOn.label ? { ...row, amount: Number(amount) || 0 } : row)),
                              };
                            })
                          }
                        />
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </Field>
        ) : null}
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={() => setFileEdit(false)}>
            Cancel
          </Button>
          <Button onPress={saveFile}>Save</Button>
        </View>
      </View>
    ) : (
      <View className="mt-5 gap-5">
        <DetailSection title="Profile">
          <View className="flex-row flex-wrap gap-x-6">
            <DetailField label="Parent" value={selected.parent} />
            <DetailField label="Phone" value={selected.parentPhone} />
            <DetailField label="Email" value={selected.parentEmail} />
            <DetailField label="Address" value={selected.parentAddress} />
          </View>
        </DetailSection>
        <DetailSection
          title="Academic"
          action={
            classTeacher ? (
              <Pressable onPress={() => router.push("/staff" as never)} hitSlop={8}>
                <Text className="text-xs font-medium text-clay-600">View teacher</Text>
              </Pressable>
            ) : null
          }
        >
          <View className="flex-row flex-wrap gap-x-6">
            <DetailField label="Class" value={selected.classLabel} />
            <DetailField label="Admission no." value={selected.admissionNo} />
            <DetailField label="Class teacher" value={classTeacher?.name || "Not assigned"} />
            <View className="min-w-[44%] flex-1 py-2">
              <Text className="text-xs text-ink-700">Stream / Path</Text>
              <View className="mt-1 flex-row flex-wrap gap-1">
                {(selected.path ?? []).length ? (
                  selected.path!.map((p) => (
                    <Badge key={p} tone="clay">
                      {p}
                    </Badge>
                  ))
                ) : (
                  <Text className="text-sm font-medium text-ink-900">Not provided</Text>
                )}
              </View>
            </View>
          </View>
        </DetailSection>
        <DetailSection
          title="Documents"
          action={<Pressable onPress={() => setFileTab("documents")} hitSlop={8}><Text className="text-xs font-medium text-clay-600">View all</Text></Pressable>}
        >
          <View className="rounded-md bg-sky-50 p-4">
            <View className="flex-row flex-wrap items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-2">
                  <Ionicons name="id-card-outline" size={18} color="#1d4ed8" />
                  <Text className="text-sm font-semibold text-ink-900">Student ID card</Text>
                </View>
                <Text className="mt-1 text-xs leading-5 text-ink-700">
                  {latestIdCard
                    ? `${latestIdCard.documentNumber} · issued ${new Date(latestIdCard.issuedAt).toLocaleDateString("en-IN")}`
                    : activeIdTemplate
                      ? "Ready to issue from the approved ID card template."
                      : "Approve and publish the Student ID card template first."}
                </Text>
              </View>
              <View className="flex-row flex-wrap justify-end gap-2">
                {latestIdCard ? (
                  <Button variant="ghost" onPress={() => void Linking.openURL(latestIdCard.documentUrl)}>
                    Open ID card
                  </Button>
                ) : null}
                <Button disabled={idCardPending || !activeIdTemplate} onPress={() => void issueStudentIdCard()}>
                  {idCardPending ? "Issuing..." : latestIdCard ? "Reissue" : "Issue ID card"}
                </Button>
              </View>
            </View>
          </View>
        </DetailSection>
      </View>
    );
    const nextDue = selected.invoices?.find((inv) => inv.status !== "paid")?.due || "";
    const feesBody = (
      <View className="mt-5 min-h-0 flex-1 gap-4">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-sm font-semibold text-ink-900">Fee summary</Text>
          {can(user, "fees.collect") || can(user, "people.edit") ? (
            <Button onPress={() => setPayOpen(true)}>Record payment</Button>
          ) : null}
        </View>
        <View className="flex-row flex-wrap gap-3">
          <MetricTile label="Total fees" value={selected.billed || "₹0"} />
          <MetricTile label="Paid" value={selected.paid || "₹0"} tone="leaf" />
          <MetricTile
            label="Outstanding"
            value={selected.dueNow || "₹0"}
            tone={(selected.dueAmount || 0) > 0 ? "warn" : "leaf"}
            hint={selected.overdueCount ? `${selected.overdueCount} overdue` : (selected.dueAmount || 0) > 0 ? "Due now" : "Clear"}
          />
          <MetricTile label="Next due date" value={nextDue || "Not scheduled"} />
        </View>
        {selected.invoices?.length ? (
          <ScrollView className="min-h-0 flex-1" nestedScrollEnabled>
            <View className="overflow-hidden rounded-md bg-white">
              <View className="flex-row items-center justify-between border-b border-ink-100 px-3 pb-2">
                <View>
                  <Text className="text-sm font-semibold text-ink-900">Invoices and receipts</Text>
                  <Text className="mt-0.5 text-xs text-ink-700">Month-wise billing ledger for this student</Text>
                </View>
                <Text className="text-xs text-ink-700">{selected.invoices.length} month{selected.invoices.length === 1 ? "" : "s"}</Text>
              </View>
              {selected.invoices.map((inv, i) => {
                const paid = inv.status === "paid";
                return (
                  <View
                    key={inv.id}
                    className={`flex-row items-center justify-between gap-3 px-3 py-3 ${i ? "border-t border-ink-100" : ""}`}
                  >
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-medium text-ink-900">{inv.title}</Text>
                      <Text className="mt-1 text-xs text-ink-700">
                        {paid ? `Paid ${inv.paid}` : `Due ${inv.due} · ${inv.amount}`}
                        {!paid && inv.remaining ? ` · ${inv.remaining} left` : ""}
                        {!paid && inv.lateLabel ? ` · ${inv.lateLabel}` : ""}
                      </Text>
                    </View>
                    <View className="items-end gap-1.5">
                      <Badge tone={paid ? "leaf" : inv.status === "overdue" ? "warn" : "clay"}>
                        {paid ? "paid" : inv.status}
                      </Badge>
                      <View className="flex-row flex-wrap justify-end gap-1.5">
                        <Pressable
                          onPress={() => void openFeeDocument(inv, false)}
                          className="flex-row items-center gap-1 rounded-md border border-ink-200 px-2 py-1"
                        >
                          <Ionicons name="document-text-outline" size={14} color="#1d4ed8" />
                          <Text className="text-xs font-medium text-clay-600">Invoice</Text>
                        </Pressable>
                        {paid ? (
                          <Pressable
                            onPress={() => void openFeeDocument(inv, true)}
                            className="flex-row items-center gap-1 rounded-md border border-ink-200 px-2 py-1"
                          >
                            <Ionicons name="receipt-outline" size={14} color="#15803d" />
                            <Text className="text-xs font-medium text-green-700">Receipt</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        ) : (
          <Text className="mt-3 text-sm text-ink-700">
            No bills yet. Generate payment, then run fees for {selected.classLabel}.
          </Text>
        )}
      </View>
    );
    const attendanceCounts = (selected.attendance ?? []).reduce(
      (acc, row) => {
        if (row.status === "PRESENT") acc.present += 1;
        else if (row.status === "ABSENT") acc.absent += 1;
        else if (row.status === "LATE") acc.late += 1;
        return acc;
      },
      { present: 0, absent: 0, late: 0 }
    );
    const attendanceMarked = attendanceCounts.present + attendanceCounts.absent + attendanceCounts.late;
    const attendancePctValue = attendanceMarked
      ? `${Math.round((attendanceCounts.present / attendanceMarked) * 100)}%`
      : "Not marked";
    const attendanceBody = (
      <View className="mt-5 gap-4">
        <View className="flex-row flex-wrap gap-3">
          <MetricTile label="Attendance" value={attendancePctValue} />
          <MetricTile label="Present" value={String(attendanceCounts.present)} tone="leaf" />
          <MetricTile label="Absent" value={String(attendanceCounts.absent)} tone={attendanceCounts.absent ? "warn" : "ink"} />
        </View>
        <DetailSection title="Recent attendance">
          <View className="rounded-md bg-ink-50 p-4">
            <Text className="text-sm font-medium text-ink-900">{attendanceMarked || "No"} marked record{attendanceMarked === 1 ? "" : "s"}</Text>
            <Text className="mt-1 text-xs leading-5 text-ink-700">Dated attendance is managed from the Attendance workspace for this class.</Text>
          </View>
        </DetailSection>
      </View>
    );
    const reportsBody = (
      <View className="mt-5 gap-4">
        <View>
          <Text className="text-sm font-semibold text-ink-900">Exams & reports</Text>
          <Text className="mt-1 text-xs text-ink-700">{selected.classLabel} · {yearSession || "Current session"}</Text>
        </View>
        {year?.entered ? (
          <Text className="text-sm text-ink-800">
            Year {year.pct}%
            {year.grade ? ` · ${year.grade}` : ""} · {year.entered} sitting{year.entered === 1 ? "" : "s"}
          </Text>
        ) : null}
        {classSittings.length ? (
          <View className="overflow-hidden rounded-md bg-white">
            {classSittings.map((series, i) => {
              const score = studentSeriesScore(
                selected.id,
                series.exams,
                series.marks,
                examPack?.policy ?? { bands: [], passPercent: 33, showRank: false, reportCardPaidMonths: 0 }
              );
              return (
                <Pressable
                  key={series.id}
                  onPress={() =>
                    setOpenCard({
                      school: examPack?.school ?? data?.school ?? {},
                      seriesName: series.name,
                      sessionLabel: series.sessionLabel,
                      classLabel: selected.classLabel,
                      student: {
                        id: selected.id,
                        name: selected.name,
                        admissionNo: selected.admissionNo,
                        parentName: selected.parent,
                        attendance: selected.attendance ?? [],
                      },
                      classmates: classmates.map((s) => ({ id: s.id, name: s.name })),
                      exams: series.exams,
                      marks: series.marks,
                      policy: examPack?.policy ?? { bands: [], passPercent: 33, showRank: false, reportCardPaidMonths: 0 },
                    })
                  }
                  className={`flex-row items-center justify-between gap-3 px-3 py-3 ${i ? "border-t border-ink-100" : ""}`}
                >
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-ink-900">{series.name}</Text>
                    <Text className="mt-1 text-xs text-ink-700">
                      {series.sessionLabel}
                      {score.entered ? ` · ${score.pct}%${score.grade ? ` · ${score.grade}` : ""}` : " · no marks"}
                    </Text>
                  </View>
                  <Badge tone={series.published ? "leaf" : "ink"}>
                    {series.published ? "published" : "draft"}
                  </Badge>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text className="mt-2 text-sm text-ink-700">No sitting for {selected.classLabel} yet. Add one on Exams.</Text>
        )}
      </View>
    );
    const documentRows = [
      { type: "STUDENT_ID", label: "Student ID" },
      { type: "DOB_CERTIFICATE", label: "Birth certificate" },
      { type: "TRANSFER_CERTIFICATE", label: "Transfer certificate" },
      { type: "OTHER", label: "Other documents" },
    ];
    const documentsBody = (
      <View className="mt-5 gap-4">
        <View className="flex-row flex-wrap items-center justify-between gap-3">
          <View>
            <Text className="text-sm font-semibold text-ink-900">Documents</Text>
            <Text className="mt-1 text-xs text-ink-700">{studentDocs.length} issued for this student</Text>
          </View>
          {data ? (
            <QuickDocumentButton
              data={data}
              subjectType="STUDENT"
              subjectId={selected.id}
              subjectLabel={selected.name}
              allowedTypes={["STUDENT_ID", "BONAFIDE", "STUDY_CERTIFICATE", "DOB_CERTIFICATE", "CHARACTER_CERTIFICATE", "ATTENDANCE_CERTIFICATE", "PROMOTION_CERTIFICATE", "TRANSFER_CERTIFICATE", "NO_DUES", "GATE_PASS", "LIBRARY_CARD", "TRANSPORT_CARD", "BUS_PASS", "ADMIT_CARD", "REPORT_CARD", "CONSOLIDATED_REPORT", "GRADE_SHEET", "PROGRESS_REPORT", "ACHIEVEMENT_CERTIFICATE", "PARTICIPATION_CERTIFICATE", "MERIT_CERTIFICATE", "FEE_INVOICE", "FEE_CHALLAN", "PAYMENT_RECEIPT", "CONSOLIDATED_RECEIPT", "FEE_STATEMENT", "DUES_NOTICE", "LATE_FEE_NOTICE", "FEE_CLEARANCE", "CUSTOM_LETTER"]}
            />
          ) : null}
        </View>
        <View className="overflow-hidden rounded-md bg-white">
          {documentRows.map((doc, index) => {
            const issued =
              doc.type === "OTHER"
                ? studentDocs.find((row) => !["STUDENT_ID", "DOB_CERTIFICATE", "TRANSFER_CERTIFICATE"].includes(row.type))
                : studentDocs.find((row) => row.type === doc.type);
            return (
              <View
                key={doc.type}
                className={`flex-row items-center justify-between gap-3 px-3 py-3 ${index ? "border-t border-ink-100" : ""}`}
              >
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-medium text-ink-900">{issued ? docTypeLabel(issued.type) : doc.label}</Text>
                  <Text className="mt-1 text-xs text-ink-700">
                    {issued ? `Uploaded ${new Date(issued.issuedAt).toLocaleDateString("en-IN")} · ${issued.documentNumber}` : "Not uploaded"}
                  </Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Badge tone={issued ? "leaf" : "ink"}>{issued ? issued.status.toLowerCase() : "missing"}</Badge>
                  {issued ? (
                    <Pressable onPress={() => void Linking.openURL(issued.documentUrl)} hitSlop={8}>
                      <Text className="text-xs font-medium text-clay-600">Open</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      </View>
    );
    const tabBody =
      showFees && fileTab === "fees"
        ? feesBody
        : fileTab === "attendance"
          ? attendanceBody
          : fileTab === "reports"
            ? reportsBody
            : fileTab === "documents"
              ? documentsBody
              : fileBody;
    if (bare) {
      return (
        <View className="px-5 pb-6">
          {header}
          {tabBody}
        </View>
      );
    }
    return (
      <Card className="min-h-0 flex-1 overflow-hidden border-transparent p-6 shadow-sm">
        {header}
        {tabBody}
      </Card>
    );
  }

  function TeacherPane({ bare }: { bare?: boolean }) {
    if (!selectedTeacher) {
      return <Empty title="Pick a teacher" body="Contact and class details show here." />;
    }
    const body = fileEdit ? (
      <View className="mt-4 gap-3">
        <Field label="Name">
          <Input value={edit.name ?? selectedTeacher.name} onChangeText={(v) => setEdit((p) => ({ ...p, name: v }))} />
        </Field>
        <Field label="Email">
          <Input autoCapitalize="none" value={edit.email ?? selectedTeacher.email} onChangeText={(v) => setEdit((p) => ({ ...p, email: v }))} />
        </Field>
        <Field label="Mobile">
          <Input keyboardType="phone-pad" value={edit.phone ?? selectedTeacher.phone ?? ""} onChangeText={(v) => setEdit((p) => ({ ...p, phone: v }))} />
        </Field>
        <Field label="Qualification">
          <Input value={edit.qualification ?? selectedTeacher.qualification ?? ""} onChangeText={(v) => setEdit((p) => ({ ...p, qualification: v }))} />
        </Field>
        {canChangeManager(user, selectedTeacher.managerId) ? (
          <Field label="Reports to">
            <ManagerPicker
              user={user}
              managers={data?.managers ?? []}
              value={edit.managerId ?? selectedTeacher.managerId ?? ""}
              onPick={(id) => setEdit((p) => ({ ...p, managerId: id }))}
            />
          </Field>
        ) : null}
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={() => setFileEdit(false)}>
            Cancel
          </Button>
          <Button onPress={saveFile}>Save</Button>
        </View>
      </View>
    ) : (
      <>
        <View className="flex-row items-start justify-between gap-2">
          <View className="min-w-0 flex-1">
            <Text className="text-2xl font-semibold text-ink-900">{selectedTeacher.name}</Text>
            <Text className="mt-1 text-sm text-ink-700">
              {selectedTeacher.employeeId}
              {selectedTeacher.classLabel ? ` · ${selectedTeacher.classLabel}` : ""}
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {data ? <QuickDocumentButton data={data} subjectType="EMPLOYEE" subjectId={selectedTeacher.id} subjectLabel={selectedTeacher.name} allowedTypes={["EMPLOYEE_ID", "OFFER_LETTER", "APPOINTMENT_LETTER", "CONFIRMATION_LETTER", "EXPERIENCE_CERTIFICATE", "RELIEVING_LETTER", "SERVICE_CERTIFICATE", "LEAVE_APPROVAL", "DISCIPLINARY_LETTER", "CUSTOM_LETTER"]} /> : null}
            {can(user, "people.edit") || can(user, "staff.edit") ? (
              <Pencil
                onPress={() => {
                  setEdit({
                    name: selectedTeacher.name,
                    email: selectedTeacher.email,
                    phone: selectedTeacher.phone || "",
                    qualification: selectedTeacher.qualification || "",
                    managerId: selectedTeacher.managerId || "",
                  });
                  setFileEdit(true);
                }}
              />
            ) : null}
          </View>
        </View>
        <View className="mt-4">
          <FactRow label="Email" value={selectedTeacher.email} />
          <FactRow label="Mobile" value={selectedTeacher.phone || "—"} />
          <FactRow label="Role" value={selectedTeacher.role || "Teacher"} />
          <FactRow label="Qualification" value={selectedTeacher.qualification || "—"} />
          <FactRow label="Reports to" value={selectedTeacher.managerName || "—"} />
        </View>
      </>
    );
    if (bare) return <View className="px-5 pb-6">{body}</View>;
    return <Card className="min-h-0 flex-1 overflow-hidden border-transparent p-6 shadow-sm">{body}</Card>;
  }

  function ParentPane({ bare }: { bare?: boolean }) {
    if (!selectedParent) {
      return <Empty title="Pick a parent" body="Contact and children show here." />;
    }
    const kids = Array.isArray(selectedParent.children) ? selectedParent.children : [];
    const childRecords = people.filter((student) => student.parentId === selectedParent.id);
    const childCards = childRecords.length
      ? childRecords
      : kids.map((kid) => people.find((student) => student.id === kid.id)).filter((student): student is (typeof people)[number] => Boolean(student));
    const totalDue = childCards.reduce((sum, child) => sum + (child.dueAmount || 0), 0);
    const body = fileEdit ? (
      <View className="mt-4 gap-3">
        <Field label="Name">
          <Input value={edit.name ?? selectedParent.name} onChangeText={(v) => setEdit((p) => ({ ...p, name: v }))} />
        </Field>
        <Field label="Email">
          <Input autoCapitalize="none" value={edit.email ?? selectedParent.email} onChangeText={(v) => setEdit((p) => ({ ...p, email: v }))} />
        </Field>
        <Field label="Phone">
          <Input keyboardType="phone-pad" value={edit.phone ?? selectedParent.phone} onChangeText={(v) => setEdit((p) => ({ ...p, phone: v }))} />
        </Field>
        <Field label="Address">
          <Input value={edit.address ?? selectedParent.street ?? selectedParent.address ?? ""} onChangeText={(v) => setEdit((p) => ({ ...p, address: v }))} />
        </Field>
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={() => setFileEdit(false)}>
            Cancel
          </Button>
          <Button onPress={saveFile}>Save</Button>
        </View>
      </View>
    ) : (
      <>
        <View className="flex-row items-start justify-between gap-2">
          <Text className="min-w-0 flex-1 text-2xl font-semibold text-ink-900">{selectedParent.name}</Text>
          {can(user, "people.edit") ? (
            <Pencil
              onPress={() => {
                setEdit({
                  name: selectedParent.name,
                  email: selectedParent.email,
                  phone: selectedParent.phone,
                  address: selectedParent.street || selectedParent.address || "",
                  city: selectedParent.city || "",
                  state: selectedParent.state || "",
                  pincode: selectedParent.pincode || "",
                });
                setFileEdit(true);
              }}
            />
          ) : null}
        </View>
        <View className="mt-4">
          <FactRow label="Email" value={selectedParent.email} />
          <FactRow label="Phone" value={selectedParent.phone || "—"} />
          <FactRow label="Address" value={selectedParent.address || "—"} />
        </View>
        <View className="mt-4 flex-row items-center justify-between">
          <View>
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Children</Text>
            <Text className="mt-0.5 text-xs text-ink-700">
              {childCards.length || kids.length} {(childCards.length || kids.length) === 1 ? "student" : "students"}
              {showFees ? ` · ${totalDue > 0 ? `₹${Math.round(totalDue).toLocaleString("en-IN")} due` : "no dues"}` : ""}
            </Text>
          </View>
          {can(user, "fees.collect") ? (
            <Pressable onPress={() => setPayOpen(true)} className="py-1">
              <Text className="text-sm font-medium text-clay-600">Collect all dues</Text>
            </Pressable>
          ) : null}
        </View>
        {childCards.length ? (
          <View className="mt-3 gap-2">
            {childCards.map((child) => {
              const classTeacher = teachersAll.find((teacher) => teacher.classId && teacher.classId === child.classId);
              const openBills = (child.invoices || []).filter((invoice) => invoice.status !== "paid" && (invoice.dueNow || 0) > 0);
              return (
                <Pressable
                  key={child.id}
                  onPress={() => {
                    setKind("student");
                    setPicked({ kind: "student", id: child.id });
                    setFileTab("overview");
                  }}
                  className="rounded-md border border-ink-100 bg-ink-50 px-3 py-3"
                >
                  <View className="flex-row items-start justify-between gap-3">
                    <View className="min-w-0 flex-1">
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Text className="text-base font-semibold text-ink-900" numberOfLines={1}>{child.name}</Text>
                        {showFees ? <FeeText label={child.feeLabel} tone={child.feeTone} /> : null}
                      </View>
                      <Text className="mt-1 text-sm text-ink-800">{child.classLabel} · {child.admissionNo}</Text>
                      {child.born ? <Text className="mt-0.5 text-xs text-ink-700">Born {child.born}</Text> : null}
                    </View>
                    {showFees ? <MoneyText amount={child.dueAmount || 0} /> : null}
                  </View>
                  <View className="mt-3 flex-row flex-wrap gap-x-6 gap-y-2 border-t border-ink-100 pt-3">
                    <View className="min-w-[42%] flex-1">
                      <Text className="text-xs text-ink-700">Class teacher</Text>
                      <Text className="mt-0.5 text-sm font-medium text-ink-900">{classTeacher?.name || "Not assigned"}</Text>
                    </View>
                    <View className="min-w-[42%] flex-1">
                      <Text className="text-xs text-ink-700">Open bills</Text>
                      <Text className="mt-0.5 text-sm font-medium text-ink-900">
                        {showFees ? `${openBills.length} ${openBills.length === 1 ? "month" : "months"}` : "Fees hidden"}
                      </Text>
                    </View>
                    <View className="min-w-[42%] flex-1">
                      <Text className="text-xs text-ink-700">Parent phone</Text>
                      <Text className="mt-0.5 text-sm font-medium text-ink-900">{child.parentPhone || selectedParent.phone || "Not provided"}</Text>
                    </View>
                    <View className="min-w-[42%] flex-1">
                      <Text className="text-xs text-ink-700">Parent email</Text>
                      <Text className="mt-0.5 text-sm font-medium text-ink-900" numberOfLines={1}>
                        {child.parentEmail || selectedParent.email || "Not provided"}
                      </Text>
                    </View>
                  </View>
                  <View className="mt-3 flex-row justify-end">
                    <Text className="text-sm font-medium text-clay-600">Open student record</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : kids.length ? (
          kids.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => {
                setKind("student");
                setPicked({ kind: "student", id: c.id });
              }}
              className="flex-row items-center justify-between border-b border-ink-100 py-2.5"
            >
              <Text className="text-sm text-ink-900">{c.name}</Text>
              <Text className="text-xs text-ink-700">{c.classLabel}</Text>
            </Pressable>
          ))
        ) : (
          <Text className="mt-2 text-sm text-ink-700">{childText(selectedParent.children) || "—"}</Text>
        )}
      </>
    );
    if (bare) return <View className="px-5 pb-6">{body}</View>;
    return <Card className="min-h-0 flex-1 overflow-hidden border-transparent p-6 shadow-sm">{body}</Card>;
  }

  function FilePane({ bare }: { bare?: boolean }) {
    if (kind === "teacher") return <TeacherPane bare={bare} />;
    if (kind === "parent") return <ParentPane bare={bare} />;
    return <StudentPane bare={bare} />;
  }

  const listEmpty =
    (!showStudents || !filtered.length) &&
    (!showTeachers || !filteredTeachers.length) &&
    (!showParents || !filteredParents.length);
  const visibleCount = showStudents ? filtered.length : showParents ? filteredParents.length : filteredTeachers.length;
  const visibleNoun = showStudents ? "student" : showParents ? "parent" : "employee";

  const peopleList = (
    <Card className={`min-h-0 overflow-hidden border-transparent shadow-sm ${wide ? "" : "flex-1"}`} style={wide ? { width: 372 } : undefined}>
      {listTools}
      {listEmpty ? (
        <Text className="px-4 py-10 text-center text-sm text-ink-700">No people match that filter.</Text>
      ) : (
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" className="flex-1" contentContainerClassName={wide ? undefined : "pb-24"}>
          {showStudents
            ? sortedStudents.map((s) => {
                const on = picked?.kind === "student" && picked.id === s.id;
                return (
                  <Pressable
                    key={`student-${s.id}`}
                    onPress={() => setPicked({ kind: "student", id: s.id })}
                    className={`mx-2 mb-1 flex-row items-center gap-3 rounded-md px-3 py-2.5 ${
                      on ? "bg-blue-50" : "bg-white"
                    }`}
                  >
                    <View className={`h-9 w-9 items-center justify-center rounded-full ${on ? "bg-white" : "bg-ink-100"}`}>
                      <Text className="text-xs font-semibold text-ink-900">{initials(s.name)}</Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="font-medium text-ink-900" numberOfLines={1}>{s.name}</Text>
                      <Text className="mt-0.5 text-xs text-ink-700">
                        {s.classLabel} · {s.admissionNo}
                      </Text>
                    </View>
                    {showFees ? <FeeText label={s.feeLabel} tone={s.feeTone} /> : null}
                  </Pressable>
                );
              })
            : null}
          {showTeachers
            ? filteredTeachers.map((t) => {
                const on = picked?.kind === "teacher" && picked.id === t.id;
                return (
                  <Pressable
                    key={`teacher-${t.id}`}
                    onPress={() => setPicked({ kind: "teacher", id: t.id })}
                    className={`border-l-2 px-4 py-3 ${on ? "border-l-clay-500 bg-blue-50" : "border-l-transparent"}`}
                  >
                    <Text className="font-medium text-ink-900">{t.name}</Text>
                    <Text className="mt-0.5 text-xs text-ink-700">
                      {t.employeeId}
                      {t.managerName ? ` · Reports to ${t.managerName}` : ""}
                    </Text>
                  </Pressable>
                );
              })
            : null}
          {showParents
            ? filteredParents.map((p) => {
                const on = picked?.kind === "parent" && picked.id === p.id;
                return (
                  <Pressable
                    key={`parent-${p.id}`}
                    onPress={() => setPicked({ kind: "parent", id: p.id })}
                    className={`border-l-2 px-4 py-3 ${on ? "border-l-clay-500 bg-blue-50" : "border-l-transparent"}`}
                  >
                    <Text className="font-medium text-ink-900">{p.name}</Text>
                    <Text className="mt-0.5 text-xs text-ink-700">
                      {p.childCount ?? 0} {(p.childCount ?? 0) === 1 ? "child" : "children"}
                    </Text>
                  </Pressable>
                );
              })
            : null}
        </ScrollView>
      )}
    </Card>
  );

  return (
    <View className="flex-1">
      <View className="mb-4 flex-row items-center justify-between gap-2">
        <View>
          <Text className="text-2xl font-semibold text-ink-900">{title}</Text>
          <Text className="mt-1 text-xs text-ink-700">{visibleCount} {visibleNoun}{visibleCount === 1 ? "" : "s"} in view</Text>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {can(user, "people.import") || can(user, "people.edit") ? (
            <Button
              variant="ghost"
              onPress={() => {
                setImportKind("student");
                setImportOpen(true);
              }}
            >
              Import
            </Button>
          ) : null}
          {can(user, "people.edit") ? (
            <Button onPress={() => setAdd("student")}>Add student</Button>
          ) : null}
        </View>
      </View>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}

      {wide ? (
        <View className="min-h-0 flex-1 flex-row gap-5">
          {peopleList}
          <View className="min-h-0 flex-1">
            <FilePane />
          </View>
        </View>
      ) : (
        <View className="min-h-0 flex-1">{peopleList}</View>
      )}

      <Sheet open={!wide && Boolean(picked)} onClose={() => setPicked(null)}>
        <FilePane bare />
      </Sheet>

      <Modal
        open={Boolean(openCard)}
        title={openCard ? `${openCard.seriesName} · ${openCard.student.name}` : "Progress report"}
        onClose={() => setOpenCard(null)}
        wide
      >
        {openCard ? <ReportCardSheet data={openCard} /> : null}
      </Modal>

      {showFees ? <GeneratePayment
        open={payOpen}
        student={selected}
        students={
          kind === "parent" && selectedParent
            ? people.filter((s) => s.parentId === selectedParent.id)
            : undefined
        }
        title={kind === "parent" && selectedParent ? `Payment · ${selectedParent.name}` : undefined}
        onClose={() => setPayOpen(false)}
        onDone={async (message) => {
          setPayOpen(false);
          toast.show(message);
          await reload();
        }}
      /> : null}

      <Modal open={importOpen} title="Import sheet" onClose={() => setImportOpen(false)}>
        <View className="gap-3">
          <Text className="text-sm text-ink-700">
            Paste CSV with a header row. Students need name, admissionNo, dateOfBirth, class, parentEmail.
          </Text>
          <Field label="CSV">
            <Input value={importCsv} onChangeText={setImportCsv} multiline />
          </Field>
          <Button
            onPress={async () => {
              try {
                const result = await act<{ ok: true; created: number; skipped: string[] }>(token, "importPeopleSheet", {
                  kind: importKind,
                  csv: importCsv,
                });
                setImportOpen(false);
                setImportCsv("");
                toast.show(`Imported ${result.created}.`);
                await reload();
              } catch (e) {
                toast.show(e instanceof Error ? e.message : "Could not import.");
              }
            }}
          >
            Import
          </Button>
        </View>
      </Modal>

      <Modal
        open={Boolean(add)}
        title={add === "parent" ? "Add parent" : "Add student"}
        onClose={() => setAdd(null)}
      >
        <View className="gap-3">
          {add === "student" ? (
            <StudentAdmitForm
              classes={data?.classes ?? []}
              parents={data?.peopleParents ?? []}
              feeAddOnOptions={feeAddOnOptions}
              onSubmit={addStudent}
            />
          ) : null}
          {add === "parent" ? (
            <>
              <Field label="Name">
                <Input value={form.name || ""} onChangeText={(v) => setForm({ ...form, name: v })} />
              </Field>
              <Field label="Email">
                <Input autoCapitalize="none" value={form.email || ""} onChangeText={(v) => setForm({ ...form, email: v })} />
              </Field>
              <Field label="Mobile">
                <Input keyboardType="phone-pad" value={form.phone || ""} onChangeText={(v) => setForm({ ...form, phone: v })} placeholder="10-digit number" />
              </Field>
              <Button onPress={saveAdd}>Save</Button>
            </>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const LEAD_STATUSES = [
  { id: "ALL", label: "All" },
  { id: "NEW", label: "New" },
  { id: "CONTACTED", label: "Contacted" },
  { id: "FOLLOW_UP", label: "Follow-up" },
  { id: "TEST", label: "Entrance test" },
  { id: "SELECTED", label: "Selected" },
  { id: "ADMITTED", label: "Admitted" },
  { id: "REJECTED", label: "Rejected" },
  { id: "DISPOSED", label: "Disposed" },
];

function leadStatusLabel(status: string) {
  return LEAD_STATUSES.find((row) => row.id === status)?.label || status.replaceAll("_", " ");
}

function leadStatusColor(status: string) {
  if (status === "ADMITTED") return "#15803d";
  if (["REJECTED", "DISPOSED"].includes(status)) return "#dc2626";
  if (status === "NEW") return "#2563eb";
  if (status === "FOLLOW_UP") return "#d97706";
  return "#64748b";
}

function leadSourceLabel(source?: string) {
  if (!source || source === "school_website") return "School website";
  return source.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function AdmissionTimelineBody({ body }: { body: string }) {
  const sections = body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (!sections.length) return null;
  return (
    <View className="mt-3 gap-2">
      {sections.map((section, index) => {
        const [label, ...lines] = section.split("\n");
        const value = lines.join("\n").trim();
        const [before, after] = value.includes(" -> ") ? value.split(" -> ", 2) : [];
        return (
          <View key={`${label}-${index}`} className="rounded-md bg-ink-50 px-3 py-2.5">
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-600">{label}</Text>
            {before !== undefined && after !== undefined ? (
              <View className="mt-1.5 flex-row flex-wrap items-center gap-2">
                <View className="min-w-[120px] flex-1 rounded border border-ink-100 bg-white px-2 py-1.5">
                  <Text className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">Before</Text>
                  <Text className="mt-0.5 text-sm font-medium text-ink-800">{before || "-"}</Text>
                </View>
                <Ionicons name="arrow-forward" size={15} color="#64748b" />
                <View className="min-w-[120px] flex-1 rounded border border-blue-100 bg-blue-50 px-2 py-1.5">
                  <Text className="text-[10px] font-semibold uppercase tracking-wide text-blue-600">After</Text>
                  <Text className="mt-0.5 text-sm font-semibold text-blue-900">{after || "-"}</Text>
                </View>
              </View>
            ) : value ? (
              <>
                <Text className="mt-1 text-sm leading-5 text-ink-800">{value}</Text>
              </>
            ) : (
              null
            )}
          </View>
        );
      })}
    </View>
  );
}

type AdmissionTimelineEvent = {
  id: string;
  kind: string;
  title: string;
  body: string;
  actorName: string;
  createdAt: string;
};

function titleToTimelineLabel(title: string) {
  const clean = title.trim();
  if (/^student name changed$/i.test(clean)) return "Student name";
  if (/^guardian name changed$/i.test(clean)) return "Guardian name";
  if (/^phone number changed$/i.test(clean)) return "Phone number";
  if (/^email changed$/i.test(clean)) return "Email";
  if (/^class interested changed$/i.test(clean)) return "Class interested";
  if (/^enquiry message changed$/i.test(clean)) return "Enquiry message";
  if (/^stage changed/i.test(clean)) return "Lead stage";
  if (/^follow-up/i.test(clean)) return "Follow-up";
  if (/^remark added$/i.test(clean)) return "Remark";
  return clean.replace(/\s+changed$/i, "");
}

function legacyBodyToTimelineSection(event: AdmissionTimelineEvent) {
  const label = titleToTimelineLabel(event.title);
  const body = String(event.body || "").trim();
  const from = body.match(/^From:\s*(.*)$/im)?.[1]?.trim();
  const to = body.match(/^To:\s*(.*)$/im)?.[1]?.trim();
  const added = body.match(/^Added:\s*(.*)$/im)?.[1]?.trim();
  const previous = body.match(/^Previous value:\s*(.*)$/im)?.[1]?.trim();
  if (from !== undefined && to !== undefined) return `${label}\n${from || "-"} -> ${to || "-"}`;
  if (added !== undefined) return `${label}\n- -> ${added || "-"}`;
  if (/^Cleared/im.test(body)) return `${label}\n${previous || "-"} -> -`;
  return body ? `${label}\n${body}` : label;
}

function groupAdmissionTimelineEvents(events: AdmissionTimelineEvent[]) {
  const grouped: AdmissionTimelineEvent[] = [];
  const canGroup = (event: AdmissionTimelineEvent) => ["EDIT", "STATUS", "FOLLOW_UP", "NOTE", "UPDATE"].includes(event.kind);
  const mergeable = (left: AdmissionTimelineEvent, right: AdmissionTimelineEvent) =>
    canGroup(left) &&
    canGroup(right) &&
    left.actorName === right.actorName &&
    left.createdAt === right.createdAt;

  for (const event of events) {
    const previous = grouped[grouped.length - 1];
    if (!previous || !mergeable(previous, event)) {
      grouped.push({ ...event, body: canGroup(event) && event.kind !== "UPDATE" ? legacyBodyToTimelineSection(event) : event.body });
      continue;
    }
    const existingSections = previous.body ? previous.body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean) : [];
    grouped[grouped.length - 1] = {
      ...previous,
      kind: "UPDATE",
      title: "Lead updated",
      body: [...existingSections, legacyBodyToTimelineSection(event)].join("\n\n"),
    };
  }

  return grouped;
}

function admissionTimelineIcon(kind: string) {
  if (kind === "CALL") return "call-outline";
  if (kind === "WHATSAPP") return "logo-whatsapp";
  if (kind === "EMAIL") return "mail-outline";
  if (kind === "FOLLOW_UP") return "calendar-outline";
  if (kind === "STATUS") return "swap-horizontal-outline";
  if (kind === "NEW") return "sparkles-outline";
  return "create-outline";
}

function admissionTimelineTone(kind: string) {
  if (kind === "NEW") return { bg: "bg-emerald-50", border: "border-emerald-100", icon: "#15803d" };
  if (kind === "CALL") return { bg: "bg-blue-50", border: "border-blue-100", icon: "#1d4ed8" };
  if (kind === "WHATSAPP") return { bg: "bg-green-50", border: "border-green-100", icon: "#16a34a" };
  if (kind === "EMAIL") return { bg: "bg-sky-50", border: "border-sky-100", icon: "#0369a1" };
  if (kind === "FOLLOW_UP") return { bg: "bg-amber-50", border: "border-amber-100", icon: "#d97706" };
  return { bg: "bg-blue-50", border: "border-blue-100", icon: "#1d4ed8" };
}

function LeadDetailTile({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-w-[210px] flex-1 rounded-md border border-ink-100 bg-ink-50 px-3 py-2.5">
      <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-600">{label}</Text>
      <Text className="mt-1 text-sm font-semibold text-ink-900" numberOfLines={1}>{value || "—"}</Text>
    </View>
  );
}

function LeadCompactAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="h-10 flex-row items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3"
    >
      <Ionicons name={icon} size={17} color="#1d4ed8" />
      <Text className="text-xs font-semibold text-blue-700">{label}</Text>
    </Pressable>
  );
}

function LeadPencilButton({ editing, onPress }: { editing: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={editing ? "Cancel editing lead details" : "Edit lead details"}
      onPress={onPress}
      className="h-8 w-8 items-center justify-center rounded-md border border-blue-100 bg-blue-50"
    >
      <Ionicons name={editing ? "close-outline" : "pencil-outline"} size={16} color="#1d4ed8" />
    </Pressable>
  );
}

function AdmissionMetric({
  icon,
  label,
  value,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View className="min-w-[180px] flex-1 flex-row items-center gap-3 rounded-lg border border-ink-200 bg-white p-4">
      <View className="h-11 w-11 items-center justify-center rounded-full bg-ink-50">
        <Ionicons name={icon} size={19} color={color} />
      </View>
      <View>
        <Text className="text-xl font-semibold text-ink-900">{value}</Text>
        <Text className="text-xs text-ink-700">{label}</Text>
      </View>
    </View>
  );
}

function LeadDateTimeInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
}) {
  const inputValue = value.trim().replace(" ", "T").slice(0, 16);

  function fromNativeDateTime(next: string) {
    onChangeText(next ? next.replace("T", " ") : "");
  }

  if (Platform.OS === "web") {
    return (
      <View className="h-[46px] justify-center rounded-md border border-ink-200 bg-white px-3">
        {createElement("input", {
          "aria-label": placeholder || "Pick follow-up date and time",
          type: "datetime-local",
          value: inputValue,
          onChange: (event: { currentTarget: { value: string } }) => fromNativeDateTime(event.currentTarget.value),
          style: {
            width: "100%",
            border: 0,
            outline: "none",
            background: "transparent",
            color: "#12233d",
            font: "inherit",
            fontSize: 16,
          },
        })}
      </View>
    );
  }

  return <Input value={value} placeholder={placeholder || "Pick date and time"} onChangeText={onChangeText} />;
}

function AdmissionFieldControl({
  field,
  value,
  onChange,
}: {
  field: AdmissionFormField;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  if (field.type === "select") {
    return <Dropdown label={label} value={value} options={field.options.map((option) => ({ id: option, label: option }))} onChange={onChange} />;
  }
  const keyboardType = field.type === "email" ? "email-address" : field.type === "phone" ? "phone-pad" : field.type === "number" ? "numeric" : "default";
  return (
    <Field label={label}>
      <Input
        value={value}
        multiline={field.type === "textarea"}
        keyboardType={keyboardType}
        placeholder={field.type === "date" ? "YYYY-MM-DD" : undefined}
        onChangeText={onChange}
      />
    </Field>
  );
}

export function AdmissionsBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const toast = useToast();
  const leads = data?.school?.admissionLeads || [];
  const admissionFields = (data?.school?.admissionForm || []).filter((field) => field.visible);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [selectedId, setSelectedId] = useState(leads[0]?.id || "");
  const [leadOpen, setLeadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInValues, setWalkInValues] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({
    studentName: "",
    guardianName: "",
    phone: "",
    email: "",
    classWanted: "",
    message: "",
  });
  const [activityDraft, setActivityDraft] = useState({ status: "FOLLOW_UP", followUpAt: "", remark: "" });
  const selected = leads.find((lead) => lead.id === selectedId) || leads[0] || null;
  const filtered = leads.filter((lead) => {
    const needle = query.trim().toLowerCase();
    const matchText = [lead.studentName, lead.guardianName, lead.phone, lead.email, lead.classWanted, lead.message].join(" ").toLowerCase();
    return (!needle || matchText.includes(needle)) && (status === "ALL" || lead.status === status);
  });
  const counts = LEAD_STATUSES.map((row) => ({
    ...row,
    n: row.id === "ALL" ? leads.length : leads.filter((lead) => lead.status === row.id).length,
  }));

  useEffect(() => {
    if (!selected) return;
    setDraft({
      studentName: selected.studentName,
      guardianName: selected.guardianName,
      phone: selected.phone,
      email: selected.email,
      classWanted: selected.classWanted,
      message: selected.message,
    });
    setActivityDraft((old) => ({ ...old, status: selected.status, followUpAt: selected.followUpAt || "" }));
  }, [selected?.id]);

  function resetLeadDraft() {
    if (!selected) return;
    setDraft({
      studentName: selected.studentName,
      guardianName: selected.guardianName,
      phone: selected.phone,
      email: selected.email,
      classWanted: selected.classWanted,
      message: selected.message,
    });
    setActivityDraft((old) => ({ ...old, status: selected.status, followUpAt: selected.followUpAt || "", remark: "" }));
  }

  async function updateLead(body: Record<string, unknown>, message = "Lead updated.", leadId = selected?.id) {
    if (!leadId) return;
    try {
      await act(token, "updateAdmissionLead", { id: leadId, ...body });
      toast.show(message);
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not update lead.");
    }
  }

  async function createWalkInLead() {
    try {
      const result = await act<{ ok: true; leadId: string }>(token, "createAdmissionLead", walkInValues);
      toast.show("Walk-in lead added.");
      setWalkInOpen(false);
      setWalkInValues({});
      setSelectedId(result.leadId);
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not add walk-in lead.");
    }
  }

  const timelineEvents = groupAdmissionTimelineEvents(selected
    ? selected.events?.length
      ? selected.events
      : [{ id: "created", kind: "NEW", title: "Lead created", body: "", actorName: "School website", createdAt: selected.createdAt }]
    : []);
  const leadDataTable = (
    <View className="min-w-[1384px]">
      <View className="min-h-[48px] flex-row items-center border-b border-ink-200 bg-ink-50 px-2 py-3">
        <Text className="w-10 text-xs font-semibold text-ink-700">No.</Text>
        <Text className="w-40 text-xs font-semibold text-ink-700">Name</Text>
        <Text className="w-40 text-xs font-semibold text-ink-700">Guardian</Text>
        <Text className="w-32 text-xs font-semibold text-ink-700">Number</Text>
        <Text className="w-48 text-xs font-semibold text-ink-700">Email</Text>
        <Text className="w-24 text-xs font-semibold text-ink-700">Class</Text>
        <Text className="w-28 text-xs font-semibold text-ink-700">Source</Text>
        <Text className="w-24 text-xs font-semibold text-ink-700">Created</Text>
        <Text className="w-36 text-xs font-semibold text-ink-700">Updated at</Text>
        <Text className="w-28 text-xs font-semibold text-ink-700">Status</Text>
        <Text className="w-36 text-xs font-semibold text-ink-700">Follow-up</Text>
      </View>
      {filtered.map((lead, index) => (
        <Pressable
          key={lead.id}
          accessibilityRole="button"
          accessibilityLabel={`Open ${lead.studentName} timeline`}
          onPress={() => { setSelectedId(lead.id); setTimelineOpen(true); }}
          className="min-h-[64px] flex-row items-center border-b border-ink-100 bg-white px-2 py-3.5"
        >
          <Text className="w-10 text-sm text-ink-700">{index + 1}</Text>
          <Text className="w-40 pr-3 text-sm font-semibold text-ink-900" numberOfLines={1}>{lead.studentName || "—"}</Text>
          <Text className="w-40 pr-3 text-sm text-ink-800" numberOfLines={1}>{lead.guardianName || "—"}</Text>
          <Text className="w-32 pr-3 text-sm text-ink-800" numberOfLines={1}>{lead.phone || "—"}</Text>
          <Text className="w-48 pr-3 text-sm text-ink-700" numberOfLines={1}>{lead.email || "—"}</Text>
          <Text className="w-24 pr-3 text-sm text-ink-800" numberOfLines={1}>{lead.classWanted || "—"}</Text>
          <Text className="w-28 pr-3 text-xs text-ink-700" numberOfLines={1}>{leadSourceLabel(lead.source)}</Text>
          <Text className="w-24 pr-3 text-xs text-ink-700" numberOfLines={1}>{lead.createdAt}</Text>
          <Text className="w-36 pr-3 text-xs text-ink-700" numberOfLines={1}>{lead.updatedAt || lead.createdAt}</Text>
          <View className="w-28 flex-row items-center gap-1.5 pr-3">
            <View className="h-2 w-2 rounded-full" style={{ backgroundColor: leadStatusColor(lead.status) }} />
            <Text className="text-xs font-medium text-ink-800" numberOfLines={1}>{leadStatusLabel(lead.status)}</Text>
          </View>
          <Text className={`w-36 pr-3 text-xs ${lead.followUpAt ? "font-semibold text-amber-800" : "text-ink-500"}`} numberOfLines={1}>{lead.followUpAt || "—"}</Text>
        </Pressable>
      ))}
    </View>
  );
  const leadActionColumn = (
    <View className="w-36 shrink-0 border-l border-ink-200 bg-white">
      <View className="min-h-[48px] justify-center border-b border-ink-200 bg-ink-50 px-4 py-3">
        <Text className="text-xs font-semibold text-ink-700">Action</Text>
      </View>
      {filtered.map((lead) => (
        <View key={lead.id} className="min-h-[64px] justify-center border-b border-ink-100 px-4 py-3.5">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ${lead.studentName} lead`}
              onPress={() => { setSelectedId(lead.id); setEditOpen(false); setLeadOpen(true); }}
              className="items-center rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5"
            >
              <Text className="text-xs font-semibold text-blue-700">View lead</Text>
            </Pressable>
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView className="h-full" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 48 }}>
      <View className="mb-5 flex-row flex-wrap items-end justify-between gap-3">
        <View>
          <Text className="text-2xl font-semibold text-ink-900">Admissions</Text>
          <Text className="mt-1 text-sm text-ink-700">Enquiries, follow-ups and student onboarding in one place.</Text>
        </View>
        <View className="items-end gap-2">
          {can(user, "admissions.manage") ? <Button onPress={() => setWalkInOpen(true)}>Add walk-in lead</Button> : null}
          <Text className="text-xs text-ink-700">{leads.length} total {leads.length === 1 ? "enquiry" : "enquiries"}</Text>
        </View>
      </View>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="mb-5 flex-row flex-wrap gap-3">
        <AdmissionMetric icon="people-outline" label="Total leads" value={String(leads.length)} color="#475569" />
        <AdmissionMetric icon="sparkles-outline" label="New leads" value={String(counts.find((c) => c.id === "NEW")?.n || 0)} color="#2563eb" />
        <AdmissionMetric icon="time-outline" label="Need follow-up" value={String(counts.find((c) => c.id === "FOLLOW_UP")?.n || 0)} color="#d97706" />
        <AdmissionMetric icon="checkmark-circle-outline" label="Admitted" value={String(counts.find((c) => c.id === "ADMITTED")?.n || 0)} color="#15803d" />
      </View>
      <View className="overflow-hidden rounded-md bg-white">
          <View className="flex-row flex-wrap items-end gap-3 px-4 pb-4 pt-5">
            <View className="min-w-[260px] flex-1">
              <Field label="Search leads">
                <Input value={query} onChangeText={setQuery} placeholder="Student, guardian, phone, class…" />
              </Field>
            </View>
            <View className="min-w-[220px]">
              <Dropdown label="Status" value={status} options={counts.map((row) => ({ id: row.id, label: `${row.label} (${row.n})` }))} onChange={setStatus} />
            </View>
          </View>
          <View className="border-t border-ink-100">
            {filtered.length ? (
              <View className="flex-row">
                <View className="min-w-0 flex-1">
                  <ScrollView horizontal showsHorizontalScrollIndicator>
                    {leadDataTable}
                  </ScrollView>
                </View>
                {leadActionColumn}
              </View>
            ) : <Empty title="No leads" body="No admission enquiries match this filter." />}
          </View>
      </View>
      <Modal open={walkInOpen} wide title="Add walk-in lead" onClose={() => setWalkInOpen(false)}>
        <View className="gap-4">
          <Text className="text-sm leading-5 text-ink-700">
            Record an enquiry received at the school office. It will enter the same admissions pipeline with source Walk-in.
          </Text>
          {admissionFields.length ? (
            <View className="flex-row flex-wrap gap-3">
              {admissionFields.map((field) => (
                <View key={field.id} className={field.type === "textarea" ? "w-full" : "min-w-[240px] flex-1"}>
                  <AdmissionFieldControl
                    field={field}
                    value={walkInValues[field.id] || ""}
                    onChange={(value) => setWalkInValues((current) => ({ ...current, [field.id]: value }))}
                  />
                </View>
              ))}
            </View>
          ) : <Text className="text-sm text-ink-700">No admission fields are currently visible.</Text>}
          <View className="flex-row justify-end gap-2 border-t border-ink-100 pt-4">
            <Button variant="ghost" onPress={() => setWalkInOpen(false)}>Cancel</Button>
            <Button onPress={createWalkInLead}>Add lead</Button>
          </View>
        </View>
      </Modal>
      <Modal open={leadOpen && Boolean(selected)} wide title={selected ? `${selected.studentName || selected.guardianName || "Admission"} · lead` : "Lead"} onClose={() => { setEditOpen(false); setLeadOpen(false); }}>
        <View className="p-1">
          {selected ? (
            <View>
              <View className="flex-row flex-wrap items-start justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="min-w-0 text-xl font-semibold text-ink-900" numberOfLines={1}>{selected.studentName || selected.guardianName || "Admission lead"}</Text>
                    <LeadPencilButton
                      editing={editOpen}
                      onPress={() => {
                        if (editOpen) resetLeadDraft();
                        setEditOpen((open) => !open);
                      }}
                    />
                  </View>
                  <Text className="mt-1 text-sm text-ink-700">{selected.classWanted ? `Interested in ${selected.classWanted}` : "Class interest not recorded"}</Text>
                </View>
                <View className="items-end gap-3">
                  <View className="flex-row items-center gap-1.5">
                    <View className="h-2 w-2 rounded-full" style={{ backgroundColor: leadStatusColor(selected.status) }} />
                    <Text className="text-xs font-medium text-ink-800">{leadStatusLabel(selected.status)}</Text>
                  </View>
                  <View className="flex-row gap-2">
                    <LeadCompactAction icon="time-outline" label="Timeline" onPress={() => setTimelineOpen(true)} />
                  </View>
                </View>
              </View>
              {editOpen ? (
                <View className="mt-4 gap-3 border-t border-ink-100 pt-4">
                  <View className="flex-row flex-wrap gap-3">
                    <View className="min-w-[220px] flex-1">
                      <Field label="Student name"><Input value={draft.studentName} onChangeText={(v) => setDraft((old) => ({ ...old, studentName: v }))} /></Field>
                    </View>
                    <View className="min-w-[220px] flex-1">
                      <Field label="Guardian name"><Input value={draft.guardianName} onChangeText={(v) => setDraft((old) => ({ ...old, guardianName: v }))} /></Field>
                    </View>
                  </View>
                  <View className="flex-row flex-wrap gap-3">
                    <View className="min-w-[220px] flex-1">
                      <Field label="Phone"><Input value={draft.phone} onChangeText={(v) => setDraft((old) => ({ ...old, phone: v }))} /></Field>
                    </View>
                    <View className="min-w-[220px] flex-1">
                      <Field label="Email"><Input value={draft.email} onChangeText={(v) => setDraft((old) => ({ ...old, email: v }))} /></Field>
                    </View>
                  </View>
                  <Field label="Class interested"><Input value={draft.classWanted} onChangeText={(v) => setDraft((old) => ({ ...old, classWanted: v }))} /></Field>
                  <Field label="Message"><Input multiline value={draft.message} onChangeText={(v) => setDraft((old) => ({ ...old, message: v }))} /></Field>
                </View>
              ) : (
                <>
                  <View className="mt-4 flex-row flex-wrap gap-2 border-t border-ink-100 pt-4">
                    <LeadDetailTile label="Guardian" value={selected.guardianName} />
                    <LeadDetailTile label="Phone" value={selected.phone} />
                    <LeadDetailTile label="Email" value={selected.email || "—"} />
                    <LeadDetailTile label="Stage" value={leadStatusLabel(selected.status)} />
                    <LeadDetailTile label="Follow-up" value={selected.followUpAt || "—"} />
                    <LeadDetailTile label="Source" value={leadSourceLabel(selected.source)} />
                    {Object.entries(selected.customFields || {}).filter(([, value]) => value).map(([id, value]) => {
                      const field = admissionFields.find((row) => row.id === id);
                      return <LeadDetailTile key={id} label={field?.label || id.replace(/^custom_/, "").replaceAll("_", " ")} value={value} />;
                    })}
                  </View>
                  {selected.message ? <View className="mt-3 border-l-2 border-blue-300 bg-blue-50 px-3 py-2.5"><Text className="text-sm leading-5 text-ink-800">{selected.message}</Text></View> : null}
                </>
              )}
              <View className="mt-4 gap-3 rounded-md border border-ink-100 bg-white p-4">
                <View>
                  <SectionLabel>Lead update</SectionLabel>
                </View>
                <View className="flex-row flex-wrap gap-3">
                  <View className="min-w-[220px] flex-1">
                    <Dropdown
                      label="Lead stage"
                      value={activityDraft.status}
                      options={LEAD_STATUSES.filter((s) => s.id !== "ALL" && (s.id !== "ADMITTED" || selected.status === "ADMITTED"))}
                      onChange={(v) => setActivityDraft((old) => ({ ...old, status: v }))}
                    />
                  </View>
                  <View className="min-w-[220px] flex-1">
                    <Field label="Next follow-up">
                      <LeadDateTimeInput value={activityDraft.followUpAt} placeholder="Pick follow-up date and time" onChangeText={(v) => setActivityDraft((old) => ({ ...old, followUpAt: v }))} />
                    </Field>
                  </View>
                </View>
                <Field label="Remark">
                  <Input multiline value={activityDraft.remark} placeholder="Write the latest update for this lead." onChangeText={(v) => setActivityDraft((old) => ({ ...old, remark: v }))} />
                </Field>
              </View>
              <View className="mt-4 flex-row justify-end gap-2 border-t border-ink-100 pt-4">
                {editOpen ? <Button variant="ghost" onPress={() => { resetLeadDraft(); setEditOpen(false); }}>Cancel</Button> : null}
                <Button onPress={async () => {
                  await updateLead({
                    ...draft,
                    status: activityDraft.status || selected.status,
                    followUpAt: activityDraft.followUpAt,
                    remark: activityDraft.remark,
                    eventKind: "UPDATE",
                  }, "Lead saved.");
                  setActivityDraft((old) => ({ ...old, remark: "" }));
                  setEditOpen(false);
                }}>
                  Save
                </Button>
              </View>
              {selected.notes ? <View className="mt-5 border-t border-ink-100 pt-4"><SectionLabel>Office notes</SectionLabel><Text className="mt-2 text-sm leading-5 text-ink-800">{selected.notes}</Text></View> : null}
            </View>
          ) : (
            <Empty title="Select a lead" body="Choose an enquiry to call, follow up, or move through admissions." />
          )}
        </View>
      </Modal>
      <Modal open={timelineOpen && Boolean(selected)} title="Lead timeline" onClose={() => setTimelineOpen(false)}>
        <View className="gap-4">
          {selected ? (
            <View className="rounded-md border border-ink-100 bg-ink-50 px-4 py-3">
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-semibold text-ink-900" numberOfLines={1}>{selected.studentName}</Text>
                  <Text className="mt-0.5 text-xs text-ink-700">{selected.phone || "No phone"} · {selected.classWanted || "No class"}</Text>
                </View>
                <View className="flex-row items-center gap-1.5">
                  <View className="h-2 w-2 rounded-full" style={{ backgroundColor: leadStatusColor(selected.status) }} />
                  <Text className="text-xs font-semibold text-ink-800">{leadStatusLabel(selected.status)}</Text>
                </View>
              </View>
            </View>
          ) : null}
          <View className="gap-3">
            {timelineEvents.map((event, index) => {
              const tone = admissionTimelineTone(event.kind);
              return (
                <View key={event.id} className="flex-row gap-3">
                  <View className="items-center">
                    <View className={`h-9 w-9 items-center justify-center rounded-full border ${tone.border} ${tone.bg}`}>
                      <Ionicons name={admissionTimelineIcon(event.kind) as keyof typeof Ionicons.glyphMap} size={17} color={tone.icon} />
                    </View>
                    {index < timelineEvents.length - 1 ? <View className="mt-1 w-px flex-1 bg-ink-200" /> : null}
                  </View>
                  <View className="min-w-0 flex-1 rounded-md border border-ink-100 bg-white px-4 py-3">
                    <View className="flex-row flex-wrap items-start justify-between gap-2">
                      <Text className="min-w-0 flex-1 text-sm font-semibold text-ink-900">{event.title}</Text>
                      <Text className="text-[11px] text-ink-500">{event.createdAt}</Text>
                    </View>
                    {event.actorName ? <Text className="mt-1 text-xs text-ink-600">By {event.actorName}</Text> : null}
                    {event.body ? <AdmissionTimelineBody body={event.body} /> : null}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function todayStaffYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseStaffBulkRows(raw: string, roleId: string, classId: string): StaffAdmitPayload[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\t|,/).map((part) => part.trim());
      return {
        name: parts[0] || "",
        phone: parts[1] || "",
        email: parts[2] || "",
        monthlySalary: parts[3] || "30000",
        roleId,
        classId,
        joinedOn: todayStaffYmd(),
        address: "",
        city: "",
        state: "",
        pincode: "",
        managerId: "",
      };
    });
}

function StaffBulkAdmitForm({
  roles,
  classes,
  onSubmit,
}: {
  roles: StaffAdmitRole[];
  classes: StaffAdmitClass[];
  onSubmit: (rows: StaffAdmitPayload[]) => Promise<void>;
}) {
  const defaultRole = roles.find((r) => r.portal === "TEACHER")?.id || roles[0]?.id || "";
  const [roleId, setRoleId] = useState(defaultRole);
  const [classId, setClassId] = useState("");
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const picked = roles.find((r) => r.id === roleId);
  const showClassTeacher = picked?.portal === "TEACHER";
  const rows = parseStaffBulkRows(raw, roleId, showClassTeacher ? classId : "").filter((row) => row.name || row.phone);

  useEffect(() => {
    if (!roleId && defaultRole) setRoleId(defaultRole);
  }, [defaultRole, roleId]);

  async function save() {
    if (busy || !rows.length) return;
    setBusy(true);
    try {
      await onSubmit(rows);
      setRaw("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-4">
      <View className="gap-3 sm:flex-row">
        <View className="flex-1">
          <Dropdown
            label="Role"
            value={roleId}
            options={roles.map((r) => ({ id: r.id, label: r.name, group: r.portal || "Role" }))}
            onChange={(next) => {
              setRoleId(next);
              if (roles.find((r) => r.id === next)?.portal !== "TEACHER") setClassId("");
            }}
            placeholder="Pick a role"
          />
        </View>
        {showClassTeacher ? (
          <View className="flex-1">
            <Dropdown
              label="Class teacher of"
              value={classId}
              options={[{ id: "", label: "Not a class teacher" }, ...classes.map((c) => ({ id: c.id, label: c.label }))]}
              onChange={setClassId}
              placeholder="Choose class"
            />
          </View>
        ) : null}
      </View>
      <Field label="Rows">
        <Input
          multiline
          value={raw}
          onChangeText={setRaw}
          placeholder={"Name, Mobile, Email, Salary\nAnita Sharma, 9876543210, anita@school.in, 30000"}
          className="min-h-[180px] align-top"
        />
      </Field>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-xs text-ink-700">{rows.length ? `${rows.length} ready` : "No rows"}</Text>
        <Button disabled={!rows.length || busy} onPress={save}>{busy ? "Adding..." : "Add employees"}</Button>
      </View>
    </View>
  );
}

export function StaffBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const staff = data?.staff ?? [];
  const [q, setQ] = useState("");
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [times, setTimes] = useState<Record<string, string>>({});
  const [savedTimes, setSavedTimes] = useState<Record<string, string>>({});
  const [savedDate, setSavedDate] = useState("");
  const timesRef = useRef(times);
  const marksRef = useRef(marks);
  timesRef.current = times;
  marksRef.current = marks;
  const [timesheetOpen, setTimesheetOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const hoursRef = useRef<StaffHoursFormHandle>(null);
  const [rulesOverride, setRulesOverride] = useState<PayrollRules | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [infoFor, setInfoFor] = useState<(typeof staff)[number] | null>(null);
  const [detailFor, setDetailFor] = useState<(typeof staff)[number] | null>(null);
  const [editFor, setEditFor] = useState<(typeof staff)[number] | null>(null);
  const pendingLeave = data?.pendingLeave ?? [];
  const calendar = useMemo(
    () => calendarFrom(data?.school?.holidays, data?.timetable?.weekdays),
    [data?.school?.holidays, data?.timetable?.weekdays]
  );
  const today = ymd(new Date());
  const [date, setDate] = useState(today);
  const dayClosed = closedReason(date, calendar);
  const dayFuture = date > today;
  const locked = Boolean(dayClosed || dayFuture);
  const lockedNote = dayFuture ? "That day has not come yet." : closedCaption(dayClosed);
  const canMark = can(user, "staff.edit");
  const canHours = can(user, "school.edit") || canMark;

  useEffect(() => {
    if (!pendingLeave.length) setLeaveOpen(false);
  }, [pendingLeave.length]);

  function statusOf(p: (typeof staff)[number]) {
    const key = `${p.kind}:${p.id}`;
    const hit = dayOn(p.days, date);
    const onLeave = (p.leaveDays ?? []).some((d) => dayKey(d.date) === date);
    const saved = (hit?.status || "").toUpperCase();
    const local = String(marksRef.current[key] ?? marks[key] ?? "").toUpperCase();
    if (saved === "LEAVE" || onLeave || (date === today && (p.today || "").toUpperCase() === "LEAVE")) return "LEAVE";
    if (local === "PRESENT" || local === "ABSENT" || local === "LATE") return local;
    if (saved === "PRESENT" || saved === "ABSENT" || saved === "LATE") return saved;
    if (!locked) return "PRESENT";
    return "";
  }

  function arrivalOf(p: (typeof staff)[number]) {
    return statusOf(p).toUpperCase();
  }

  function timesOf(p: (typeof staff)[number]) {
    const key = `${p.kind}:${p.id}`;
    const local = timesRef.current[key];
    if (local !== undefined) return local;
    return dayOn(p.days, date)?.inAt || "";
  }

  const payrollRules =
    rulesOverride || parsePayrollRules(data?.payrollRules ? JSON.stringify(data.payrollRules) : null);

  async function saveDay() {
    if (locked) {
      toast.show(lockedNote || "Attendance is not marked.");
      return;
    }
    try {
      const rows = staff.map((p) => {
        const status = statusOf(p).toUpperCase();
        const hit = dayOn(p.days, date);
        if (status === "LEAVE") {
          return { kind: p.kind || "staff", id: p.id, status: "LEAVE" as const, inAt: "", outAt: "" };
        }
        const inAt = status === "ABSENT" ? "" : timesOf(p) || "";
        return {
          kind: p.kind || "staff",
          id: p.id,
          status: (status === "LATE" ? "LATE" : status === "ABSENT" ? "ABSENT" : "PRESENT") as "PRESENT" | "ABSENT" | "LATE",
          inAt,
          outAt: hit?.outAt || "",
        };
      });
      const saved = await act<{ ok: true; days?: { kind: string; id: string; inAt?: string; status?: string }[] }>(
        token,
        "markStaffAttendance",
        { date, rows }
      );
      const frozen: Record<string, string> = {};
      for (const row of saved.days ?? []) {
        frozen[`${row.kind}:${row.id}`] = row.inAt || "";
      }
      for (const row of rows) {
        const key = `${row.kind}:${row.id}`;
        if (frozen[key] === undefined) frozen[key] = row.inAt || "";
      }
      toast.show("Saved the day.");
      setTimes(frozen);
      setSavedTimes(frozen);
      setSavedDate(date);
      setMarks({});
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function addStaff(values: StaffAdmitPayload) {
    await act(token, "createStaffMember", values);
    setAddOpen(false);
    toast.show("Added. They log in with this mobile, then change the first password on Profile.");
    await reload();
  }

  async function addBulkStaff(rows: StaffAdmitPayload[]) {
    let count = 0;
    for (const row of rows) {
      await act(token, "createStaffMember", row);
      count += 1;
    }
    setBulkOpen(false);
    toast.show(`Added ${count} ${count === 1 ? "employee" : "employees"}.`);
    await reload();
  }

  async function editStaff(values: StaffAdmitPayload) {
    if (!editFor) return;
    if (editFor.kind === "teacher") {
      await act(token, "updateTeacher", {
        teacherId: editFor.id,
        name: values.name,
        email: values.email || editFor.email || "",
        phone: values.phone,
        employeeId: editFor.employeeId || "",
        roleId: values.roleId,
        joinedOn: values.joinedOn,
        address: values.address,
        city: values.city,
        state: values.state,
        pincode: values.pincode,
        qualification: editFor.qualification || "",
        managerId: values.managerId || null,
        monthlySalary: values.monthlySalary,
        classId: values.classId || null,
      });
    } else {
      await act(token, "updateStaffMember", {
        staffId: editFor.id,
        ...values,
        managerId: values.managerId || null,
      });
    }
    setEditFor(null);
    setInfoFor(null);
    toast.show("Employee saved.");
    await reload();
  }

  const yes = staff.filter((p) => arrivalOf(p) === "PRESENT").length;
  const late = staff.filter((p) => arrivalOf(p) === "LATE").length;
  const no = staff.filter((p) => arrivalOf(p) === "ABSENT").length;
  const onLeave = staff.filter((p) => arrivalOf(p) === "LEAVE").length;
  const needle = q.trim().toLowerCase();
  const shown = needle ? staff.filter((p) => p.name.toLowerCase().includes(needle)) : staff;
  const editRoleOptions = editFor?.kind === "teacher"
    ? (data?.staffRoles ?? []).filter((r) => r.portal === "TEACHER")
    : (data?.staffRoles ?? []).filter((r) => r.portal !== "TEACHER" && r.portal !== "PARENT" && r.portal !== "STUDENT");
  const editInitial = editFor
    ? {
        name: editFor.name,
        phone: editFor.phone || "",
        roleId: editFor.roleId || editRoleOptions[0]?.id || "",
        classId: editFor.classId || "",
        joinedOn: editFor.joinedOn || today,
        email: editFor.email || "",
        address: editFor.address || "",
        city: editFor.city || "",
        state: editFor.state || "",
        pincode: editFor.pincode || "",
        managerId: editFor.managerId || "",
        monthlySalary: String(editFor.salary ?? 30000),
      }
    : undefined;

  const register = (
    <Card className="min-h-0 flex-1">
      <View className={phone ? "gap-2 border-b border-ink-100 px-3 py-2" : "gap-3 border-b border-ink-100 px-4 py-4"}>
        {phone ? (
          <>
            <View testID="staff-toolbar-controls" className="flex-row items-center gap-1.5">
              {pendingLeave.length ? (
                <Button
                  variant="ghost"
                  accessibilityLabel={`Leave requests (${pendingLeave.length})`}
                  onPress={() => setLeaveOpen(true)}
                  className="shrink-0 px-2 py-2"
                >
                  {`Leave (${pendingLeave.length})`}
                </Button>
              ) : null}
              <View className="min-w-0 flex-1 flex-row items-center rounded-md border border-ink-200 bg-white pl-2">
                <Ionicons name="search-outline" size={16} color="#3d4f66" />
                <Input
                  value={q}
                  onChangeText={setQ}
                  placeholder="Name"
                  accessibilityLabel="Search"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-w-0 flex-1 border-0 px-2 py-2"
                />
              </View>
              <View testID="staff-date" className="w-[108px] shrink-0">
                <DateField
                  compact
                  plain
                  value={date}
                  max={today}
                  closedReason={(value) => closedReason(value, calendar)}
                  onChange={(next) => {
                    setDate(next);
                    setMarks({});
                    setTimes({});
                  }}
                />
              </View>
              {canMark ? (
                <Button variant="ghost" accessibilityLabel="+ Add employee" onPress={() => setAddOpen(true)} className="shrink-0 px-2 py-2">
                  + Add
                </Button>
              ) : null}
              {canMark ? (
                <Button variant="ghost" accessibilityLabel="Bulk upload employees" onPress={() => setBulkOpen(true)} className="shrink-0 px-2 py-2">
                  Bulk
                </Button>
              ) : null}
            </View>
            <View testID="staff-toolbar-actions" className="flex-row items-center gap-1.5">
              <Button variant="ghost" accessibilityLabel="Timesheet" onPress={() => setTimesheetOpen(true)} className="shrink-0 px-2 py-2">
                Timesheet
              </Button>
              <Button variant="ghost" accessibilityLabel="Late timing" onPress={() => setHoursOpen(true)} className="shrink-0 px-2 py-2">
                Late timing
              </Button>
            </View>
            <View testID="staff-toolbar-summary" className="flex-row flex-wrap items-center gap-2">
              {locked ? (
                <Text className="text-sm text-amber-800">{lockedNote.replace(/\.$/, "")}.</Text>
              ) : (
                <View className="flex-row flex-wrap gap-2">
                  <Badge tone="leaf">{`${yes} P`}</Badge>
                  {late ? <Badge tone="warn">{`${late} late`}</Badge> : null}
                  <Badge tone="danger">{`${no} A`}</Badge>
                  {onLeave ? <Badge tone="sky">{`${onLeave} on leave`}</Badge> : null}
                  {needle ? <Badge>{`${shown.length} shown`}</Badge> : null}
                </View>
              )}
            </View>
          </>
        ) : (
          <>
        <View
          testID="staff-toolbar-controls"
          className="flex-row items-end gap-2"
        >
          <View className="min-w-0 flex-1">
            <Field label="Search">
              <View className="flex-row items-center rounded-md border border-ink-200 bg-white pl-2.5">
                <Ionicons name="search-outline" size={18} color="#3d4f66" />
                <Input
                  value={q}
                  onChangeText={setQ}
                  placeholder="Name"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-w-0 flex-1 border-0"
                />
              </View>
            </Field>
          </View>
          <View className="w-[220px] shrink-0">
            <Field label="Date">
              <DateField
                plain
                value={date}
                max={today}
                closedReason={(value) => closedReason(value, calendar)}
                onChange={(next) => {
                  setDate(next);
                  setMarks({});
                  setTimes({});
                }}
              />
            </Field>
          </View>
          {canMark ? (
            <Button variant="ghost" onPress={() => setAddOpen(true)}>
              + Add employee
            </Button>
          ) : null}
          {canMark ? (
            <Button variant="ghost" accessibilityLabel="Bulk upload employees" onPress={() => setBulkOpen(true)}>
              Bulk upload
            </Button>
          ) : null}
          <Button variant="ghost" accessibilityLabel="Timesheet" onPress={() => setTimesheetOpen(true)}>
            Timesheet
          </Button>
          <Button variant="ghost" accessibilityLabel="Late timing" onPress={() => setHoursOpen(true)}>
            Late timing
          </Button>
        </View>
        <View testID="staff-toolbar-summary" className="flex-row flex-wrap items-center justify-between gap-2">
          {locked ? (
            <Text className="text-sm text-amber-800">{lockedNote.replace(/\.$/, "")}.</Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              <Badge tone="leaf">{`${yes} P`}</Badge>
              {late ? <Badge tone="warn">{`${late} late`}</Badge> : null}
              <Badge tone="danger">{`${no} A`}</Badge>
              {onLeave ? <Badge tone="sky">{`${onLeave} on leave`}</Badge> : null}
              {needle ? <Badge>{`${shown.length} shown`}</Badge> : null}
            </View>
          )}
        </View>
          </>
        )}
      </View>
      <ScrollView className="min-h-0 flex-1" keyboardShouldPersistTaps="handled">
        {!shown.length ? (
          <View className="px-4 py-8">
            <Empty title="No match" body="Clear search to see the full register." />
          </View>
        ) : (
          shown.map((p) => {
            const st = statusOf(p).toUpperCase();
            const overlay = locked ? undefined : st || undefined;
            const dots = lastAttendanceDots(p.days ?? [], date, overlay, 7, calendar);
            const mark = (
              <View className="shrink-0 items-end gap-1">
                {st === "LEAVE" ? (
                  <OnLeaveSign />
                ) : (
                  <DayMark
                    name={p.name}
                    status={st}
                    disabled={locked || !canMark}
                    onChange={(status) => {
                      const key = `${p.kind}:${p.id}`;
                      marksRef.current = { ...marksRef.current, [key]: status };
                      setMarks((m) => ({ ...m, [key]: status }));
                    }}
                  />
                )}
              </View>
            );
            const who = (
              <View className={phone ? "min-w-0 flex-1" : "w-56 shrink-0"}>
                <View className="min-w-0">
                  <View className="flex-row items-center gap-1.5">
                    <Pressable
                      onPress={() => setDetailFor(p)}
                      accessibilityRole="button"
                      accessibilityLabel={`${p.name} monthly attendance`}
                      hitSlop={4}
                    >
                      <Text className="min-w-0 shrink text-sm font-medium text-clay-500 underline" numberOfLines={1}>
                        {p.name}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setInfoFor(p)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${p.name} details`}
                      className="h-7 w-7 items-center justify-center rounded-full"
                    >
                      <Ionicons name="information-circle-outline" size={17} color="#1d4ed8" />
                    </Pressable>
                  </View>
                  <Text className="text-xs text-ink-700" numberOfLines={1}>
                    {p.kind === "teacher" ? "Teacher" : p.role}
                  </Text>
                </View>
              </View>
            );
            return (
              <View key={`${p.kind}:${p.id}`} className="border-t border-ink-100 px-4 py-3">
                {phone ? (
                  <View className="gap-2">
                    <View className="flex-row items-center justify-between gap-3">
                      {who}
                      {mark}
                    </View>
                    <AttendanceDots dots={dots} compact activeDate={locked ? undefined : date} />
                  </View>
                ) : (
                  <View className="flex-row items-center gap-4">
                    {who}
                    <AttendanceDots dots={dots} activeDate={locked ? undefined : date} />
                    <View className="ml-auto">{mark}</View>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
      {canMark ? (
        <View className="border-t border-ink-100 bg-white p-4">
          <Button onPress={saveDay} disabled={locked}>
            Save the day
          </Button>
        </View>
      ) : null}
    </Card>
  );

  return (
    <View className="min-h-0 flex-1">
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {detailFor ? (
        <StaffAttendanceDetail
          person={staff.find((row) => row.id === detailFor.id && row.kind === detailFor.kind) || detailFor}
          calendar={calendar}
          rules={payrollRules}
          payroll={data?.staffPayroll}
          audits={data?.staffAudits}
          token={token}
          onBack={() => setDetailFor(null)}
          onSaved={reload}
          onEditSalary={
            canMark
              ? () => setEditFor(staff.find((row) => row.id === detailFor.id && row.kind === detailFor.kind) || detailFor)
              : undefined
          }
        />
      ) : timesheetOpen ? (
        <StaffTimesheet
          staff={staff}
          calendar={calendar}
          rules={payrollRules}
          token={token}
          canEdit={canMark}
          overlayDate={savedDate}
          overlayTimes={savedTimes}
          onBack={() => setTimesheetOpen(false)}
          onSaved={reload}
          onStamp={(kind, id, inAt) => {
            const key = `${kind}:${id}`;
            setSavedDate(date);
            setSavedTimes((cur) => ({ ...cur, [key]: inAt }));
            setTimes((cur) => ({ ...cur, [key]: inAt }));
          }}
        />
      ) : (
        <>
      {phone ? null : (
      <PageHeader
        title="Employees"
        lede="Mark Present, Late, or Absent, then Save the day. Optional In time lives on Timesheet."
        action={
          pendingLeave.length ? (
            <Button variant="ghost" onPress={() => setLeaveOpen(true)}>
              {`Leave requests (${pendingLeave.length})`}
            </Button>
          ) : undefined
        }
      />
      )}
      {register}
      <Modal open={leaveOpen && Boolean(pendingLeave.length)} title="Leave requests" onClose={() => setLeaveOpen(false)}>
        <View>
          {pendingLeave.map((row, index) => (
            <View
              key={row.id}
              className={`flex-row items-center justify-between gap-3 py-3 ${index ? "border-t border-ink-100" : ""}`}
            >
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-medium text-ink-900">
                  {row.subjectName} · {row.typeName}
                </Text>
                <Text className="text-xs text-ink-700">
                  {row.from === row.to ? row.from : `${row.from}–${row.to}`}
                  {row.reason ? ` · ${row.reason}` : ""}
                </Text>
              </View>
              {row.status === "WAITING" ? (
                <Button
                  onPress={async () => {
                    try {
                      await act(token, "decideLeave", { requestId: row.id, yes: true });
                      toast.show("Leave approved.");
                      await reload();
                    } catch (e) {
                      toast.show(e instanceof Error ? e.message : "Could not save.");
                    }
                  }}
                >
                  Approve
                </Button>
              ) : (
                <Badge tone="leaf">Approved</Badge>
              )}
              <Button
                variant="ghost"
                onPress={async () => {
                  try {
                    await act(token, "decideLeave", { requestId: row.id, yes: false });
                    toast.show("Leave rejected.");
                    await reload();
                  } catch (e) {
                    toast.show(e instanceof Error ? e.message : "Could not save.");
                  }
                }}
              >
                Reject
              </Button>
            </View>
          ))}
        </View>
      </Modal>
      <Modal open={Boolean(infoFor)} title={infoFor?.kind === "teacher" ? "Teacher details" : "Employee details"} onClose={() => setInfoFor(null)}>
        {infoFor ? (
          <View>
            <View className="mb-3 flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                <Text className="font-semibold text-clay-700">{infoFor.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-base font-semibold text-ink-900">
                  {infoFor.name}
                </Text>
                <Text className="text-xs text-ink-700">{infoFor.kind === "teacher" ? "Teacher" : infoFor.role || "Employee"}</Text>
              </View>
              {canMark ? (
                <Pressable
                  onPress={() => {
                    setEditFor(infoFor);
                    setInfoFor(null);
                  }}
                  hitSlop={8}
                  className="flex-row items-center gap-1.5 rounded-md border border-ink-200 px-3 py-2"
                >
                  <Ionicons name="pencil-outline" size={16} color="#1d4ed8" />
                  <Text className="text-sm font-medium text-clay-600">Edit</Text>
                </Pressable>
              ) : null}
            </View>
            <FactRow label="Type" value={infoFor.kind === "teacher" ? "Teacher" : "Employee"} />
            {infoFor.employeeId ? <FactRow label="Employee ID" value={infoFor.employeeId} /> : null}
            {infoFor.classLabel ? <FactRow label="Class" value={infoFor.classLabel} /> : null}
            <FactRow label="Phone" value={infoFor.phone || "—"} />
            <FactRow label="Email" value={infoFor.email || "—"} />
            {infoFor.qualification ? <FactRow label="Qualification" value={infoFor.qualification} /> : null}
            <FactRow label="Joined" value={infoFor.joinedOn ? joinedHint(infoFor.joinedOn).replace(/^Joined /, "") : "—"} />
            <FactRow label="Reports to" value={infoFor.managerName || "—"} />
            <FactRow label="Monthly salary" value={inr(infoFor.salary ?? 30000)} />
          </View>
        ) : null}
      </Modal>
        </>
      )}
      <Modal
        open={hoursOpen}
        title="Late timing"
        onClose={() => setHoursOpen(false)}
        footer={
          canHours ? (
            <Button
              accessibilityLabel="Save late timing"
              onPress={() => {
                void hoursRef.current?.save().catch((e) => {
                  toast.show(e instanceof Error ? e.message : "Could not save.");
                });
              }}
            >
              Save late timing
            </Button>
          ) : undefined
        }
      >
        <Text className="text-sm text-ink-700">
          Start and grace decide Present vs Late from the saved In time. Change them, save, and every day with an In time is rechecked.
        </Text>
        {!canHours ? (
          <Text className="mt-2 text-xs text-amber-800">You need school.edit or staff.edit to save these times.</Text>
        ) : null}
        <View className="mt-1">
          <StaffHoursForm
            ref={hoursRef}
            compact
            hideButton
            rules={payrollRules}
            canEdit={canHours}
            onSave={async (payload) => {
              const saved = await saveLateTiming<{ ok: true; rules?: PayrollRules }>(token, payload);
              const next = saved.rules || parsePayrollRules(JSON.stringify({ ...payrollRules, ...payload }));
              setRulesOverride(next);
              toast.show("Late timing saved. In times were rechecked for Present vs Late.");
              setHoursOpen(false);
              await reload();
            }}
          />
        </View>
      </Modal>
      <Modal open={addOpen} title="Add employee" onClose={() => setAddOpen(false)}>
        <StaffAdmitForm
          roles={data?.staffRoles ?? []}
          managers={data?.managers ?? []}
          classes={data?.classes ?? []}
          user={user}
          submitLabel="Add employee"
          onSubmit={async (values) => {
            try {
              await addStaff(values);
            } catch (e) {
              toast.show(e instanceof Error ? e.message : "Could not save.");
              throw e;
            }
          }}
        />
      </Modal>
      <Modal open={bulkOpen} title="Bulk upload employees" onClose={() => setBulkOpen(false)} wide>
        <StaffBulkAdmitForm
          roles={data?.staffRoles ?? []}
          classes={data?.classes ?? []}
          onSubmit={async (rows) => {
            try {
              await addBulkStaff(rows);
            } catch (e) {
              toast.show(e instanceof Error ? e.message : "Could not upload.");
              throw e;
            }
          }}
        />
      </Modal>
      <Modal open={Boolean(editFor)} title="Edit employee" onClose={() => setEditFor(null)}>
        {editFor ? (
          <StaffAdmitForm
            roles={editRoleOptions}
            managers={data?.managers ?? []}
            classes={data?.classes ?? []}
            user={user}
            initialValues={editInitial}
            submitLabel="Save employee"
            busyLabel="Saving…"
            onSubmit={async (values) => {
              try {
                await editStaff(values);
              } catch (e) {
                toast.show(e instanceof Error ? e.message : "Could not save.");
                throw e;
              }
            }}
          />
        ) : null}
      </Modal>
    </View>
  );
}

export { SchoolBoard } from "./school-board";

type FeeLineDraft = { id: string; label: string; amount: string; scope: "ALL" | "ADD_ON" };

function newFeeLine(label = "", amount = "", scope: "ALL" | "ADD_ON" = "ALL"): FeeLineDraft {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, label, amount, scope };
}

function currentFeePeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function periodLabel(period?: string) {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return "Not generated";
  const [year, month] = period.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleString("en-IN", { month: "long", year: "numeric" });
}

function MonthInput({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) {
  if (Platform.OS === "web") {
    return (
      <View className="h-[46px] justify-center rounded-md border border-ink-200 bg-white px-3">
        {createElement("input", {
          "aria-label": "Fee month",
          type: "month",
          value,
          onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
          style: {
            width: "100%",
            border: 0,
            outline: "none",
            background: "transparent",
            color: "#12233d",
            font: "inherit",
            fontSize: 16,
          },
        })}
      </View>
    );
  }
  return <Input value={value} onChangeText={onChangeText} placeholder="2026-07" />;
}

export function FeesBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const router = useRouter();
  const toast = useToast();
  const didInitialRefresh = useRef(false);
  const [classId, setClassId] = useState("all");
  const [filter, setFilter] = useState<"all" | "overdue">("all");
  const [tab, setTab] = useState<"due" | "templates">("due");
  const [feeEditorOpen, setFeeEditorOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [tplName, setTplName] = useState("Monthly fee");
  const [tplDue, setTplDue] = useState("10");
  const [tplStart, setTplStart] = useState(currentFeePeriod());
  const [tplEnd, setTplEnd] = useState(currentFeePeriod());
  const [tplLate, setTplLate] = useState("NONE");
  const [tplAmount, setTplAmount] = useState("0");
  const [tplLines, setTplLines] = useState<FeeLineDraft[]>([
    newFeeLine("Tuition", "8000"),
    newFeeLine("Laboratory fee", "0"),
  ]);
  const people = data?.people ?? [];
  const dueStudents = people.filter((s) => (s.dueAmount || 0) > 0);
  const overdueStudents = dueStudents.filter((s) => (s.overdueCount || 0) > 0);
  const students = (classId === "all" ? dueStudents : dueStudents.filter((s) => s.classId === classId))
    .filter((s) => (filter === "overdue" ? (s.overdueCount || 0) > 0 : true))
    .sort((a, b) => (b.dueAmount || 0) - (a.dueAmount || 0) || a.name.localeCompare(b.name));

  function monthsOf(s: (typeof people)[number]) {
    return (s.invoices ?? []).filter((inv) => inv.status !== "paid").length;
  }

  function oldestOf(s: (typeof people)[number]) {
    const open = (s.invoices ?? []).filter((inv) => inv.status !== "paid");
    return open[open.length - 1]?.title || open[0]?.title || "";
  }

  const templates = data?.feeTemplates ?? [];
  const currentSession = data?.school?.sessions?.find((s) => s.current) ?? data?.school?.sessions?.[0];
  const classTemplates = useMemo(
    () => templates
      .filter((t) => t.classId === classId && (!currentSession || t.sessionId === currentSession.id || !t.sessionId))
      .sort((a, b) => (b.startsPeriod || "").localeCompare(a.startsPeriod || "") || (b.endsPeriod || "").localeCompare(a.endsPeriod || "")),
    [templates, classId, currentSession?.id]
  );
  const classTemplate = selectedTemplateId === "new"
    ? null
    : classTemplates.find((t) => t.id === selectedTemplateId) || classTemplates[0] || null;
  const selectedClass = data?.classes?.find((c) => c.id === classId);
  const selectedClassStudents = classId === "all" ? [] : people.filter((s) => s.classId === classId);
  const generationStudents = classId === "all" ? people : selectedClassStudents;
  const generatedPeriods = generationStudents.flatMap((s) =>
    (s.invoices ?? []).map((invoice) => invoice.period || "").filter((period) => /^\d{4}-\d{2}$/.test(period))
  );
  const generatedThrough = generatedPeriods.length ? [...generatedPeriods].sort().at(-1) || "" : "";
  const tplTotal = tplLines
    .filter((line) => line.scope !== "ADD_ON")
    .reduce((sum, line) => sum + Math.max(0, Math.round(Number(line.amount) || 0)), 0);
  const defaultStartPeriod = currentSession?.startsOn?.slice(0, 7) || currentFeePeriod();
  const defaultEndPeriod = currentSession?.endsOn?.slice(0, 7) || defaultStartPeriod;

  useEffect(() => {
    if (didInitialRefresh.current) return;
    didInitialRefresh.current = true;
    void reload();
  }, [reload]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const refreshOnFocus = () => {
      void reload();
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [reload]);

  useEffect(() => {
    if (classId === "all") return;
    setSelectedTemplateId((current) => (current && (current === "new" || classTemplates.some((t) => t.id === current)) ? current : classTemplates[0]?.id || "new"));
  }, [classId, classTemplates]);

  useEffect(() => {
    if (classId === "all") return;
    setTplName(classTemplate?.name || "Monthly fee");
    setTplDue(String(classTemplate?.dueDay || 10));
    setTplStart(classTemplate?.startsPeriod || defaultStartPeriod);
    setTplEnd(classTemplate?.endsPeriod || defaultEndPeriod);
    setTplLate(classTemplate?.lateKind || "NONE");
    setTplAmount(String(classTemplate?.lateAmount || 0));
    setTplLines(
      classTemplate?.lines?.length
        ? classTemplate.lines.map((line) => newFeeLine(line.label, String(line.amount), line.scope === "ADD_ON" ? "ADD_ON" : "ALL"))
        : [newFeeLine("Tuition", "8000"), newFeeLine("Laboratory fee", "0"), newFeeLine("Books", "0")]
    );
  }, [classId, selectedTemplateId, classTemplate?.id, classTemplate?.name, classTemplate?.startsPeriod, classTemplate?.endsPeriod, classTemplate?.dueDay, classTemplate?.lateKind, classTemplate?.lateAmount, classTemplate?.lines, defaultStartPeriod, defaultEndPeriod]);

  function feeTemplateTotal(template: (typeof templates)[number]) {
    return template.lines
      .filter((line) => line.scope !== "ADD_ON")
      .reduce((sum, line) => sum + Math.max(0, Math.round(Number(line.amount) || 0)), 0);
  }

  function patchTplLine(id: string, patch: Partial<FeeLineDraft>) {
    setTplLines((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function removeTplLine(id: string) {
    setTplLines((rows) => rows.length > 1 ? rows.filter((row) => row.id !== id) : rows);
  }

  async function remindOverdue() {
    const ids = overdueStudents.flatMap((s) => (s.invoiceIds ?? []).slice(0, 2));
    try {
      const result = await act<{ ok: true; sent: number }>(token, "sendFeeReminders", { invoiceIds: ids });
      toast.show(`Reminded ${result.sent}.`);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not remind.");
    }
  }

  async function issueFeeTemplate(templateId?: string) {
    if (!templateId || classId === "all") {
      toast.show("Select a saved fee range first.");
      return;
    }
    try {
      await act(token, "issueClassFees", { classId, templateId });
      toast.show("Fee range issued.");
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not issue.");
    }
  }

  async function saveFeeTemplate() {
    try {
      const lines = tplLines
        .map((line) => ({
          label: line.label.trim(),
          kind: "FLAT",
          amount: Math.max(0, Math.round(Number(line.amount) || 0)),
          scope: line.scope,
        }))
        .filter((line) => line.label || line.amount > 0);
      lines.forEach((line) => {
        if (!line.label) line.label = "Line";
      });
      if (!lines.length) {
        toast.show("Add at least one fee line.");
        return;
      }
      const saved = await act<{ ok: true; id: string }>(token, "saveFeeTemplate", {
        templateId: classTemplate?.id,
        classId,
        sessionId: currentSession?.id,
        name: tplName,
        startsPeriod: tplStart,
        endsPeriod: tplEnd,
        dueDay: Number(tplDue),
        lateKind: tplLate,
        lateAmount: Number(tplAmount),
        lines,
      });
      setSelectedTemplateId(saved.id);
      setFeeEditorOpen(false);
      toast.show("Template saved.");
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    }
  }

  function startNewFeeRange() {
    setSelectedTemplateId("new");
    setTplName("Monthly fee");
    setTplDue("10");
    setTplStart(defaultStartPeriod);
    setTplEnd(defaultEndPeriod);
    setTplLate("NONE");
    setTplAmount("0");
    setTplLines([newFeeLine("Tuition", "8000"), newFeeLine("Laboratory fee", "0"), newFeeLine("Books", "0")]);
    setFeeEditorOpen(true);
  }

  return (
    <View>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="mb-3 gap-1.5 rounded-md border border-ink-100 bg-white p-1.5">
        <View className="flex-row flex-wrap items-stretch gap-1.5">
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setTab("due");
              setClassId("all");
              setFilter("all");
            }}
            className={`min-w-[110px] flex-1 flex-row items-center gap-2 rounded-md px-3 py-1.5 ${tab === "due" && classId === "all" && filter === "all" ? "bg-clay-500" : "bg-ink-50"}`}
          >
            <Text className={`text-[11px] font-semibold uppercase tracking-wide ${tab === "due" && classId === "all" && filter === "all" ? "text-white" : "text-ink-700"}`}>Due</Text>
            <Text className={`text-base font-semibold ${tab === "due" && classId === "all" && filter === "all" ? "text-white" : "text-ink-900"}`}>{dueStudents.length}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setTab("due");
              setClassId("all");
              setFilter("overdue");
            }}
            className={`min-w-[125px] flex-1 flex-row items-center gap-2 rounded-md px-3 py-1.5 ${tab === "due" && classId === "all" && filter === "overdue" ? "bg-clay-500" : "bg-ink-50"}`}
          >
            <Text className={`text-[11px] font-semibold uppercase tracking-wide ${tab === "due" && classId === "all" && filter === "overdue" ? "text-white" : "text-ink-700"}`}>Overdue</Text>
            <Text className={`text-base font-semibold ${tab === "due" && classId === "all" && filter === "overdue" ? "text-white" : "text-ink-900"}`}>{overdueStudents.length}</Text>
          </Pressable>
          <View className="min-w-[210px] flex-1 flex-row items-center gap-2 rounded-md bg-ink-50 px-3 py-1.5">
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-700">Generated through</Text>
            <Text className="text-base font-semibold text-ink-900">{periodLabel(generatedThrough)}</Text>
          </View>
          <View className="flex-row rounded-md border border-ink-200 bg-white p-0.5">
            <Pressable
              accessibilityRole="button"
              onPress={() => setTab("due")}
              className={`min-w-[76px] items-center rounded-md px-3 py-1.5 ${tab === "due" ? "bg-clay-500" : "bg-white"}`}
            >
              <Text className={`text-sm font-semibold ${tab === "due" ? "text-white" : "text-ink-800"}`}>Collect</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setTab("templates")}
              className={`min-w-[76px] items-center rounded-md px-3 py-1.5 ${tab === "templates" ? "bg-clay-500" : "bg-white"}`}
            >
              <Text className={`text-sm font-semibold ${tab === "templates" ? "text-white" : "text-ink-800"}`}>Setup</Text>
            </Pressable>
          </View>
        </View>
        <View className="flex-row flex-wrap gap-1.5">
          <Chip
            label="All classes"
            active={classId === "all"}
            onPress={() => {
              setClassId("all");
            }}
          />
          {(data?.classes ?? []).map((c) => (
            <Chip
              key={c.id}
              label={c.label}
              active={classId === c.id && filter === "all"}
              onPress={() => {
                setClassId(c.id);
                setFilter("all");
              }}
            />
          ))}
        </View>
      </View>
      {tab === "templates" ? (
        <Card className="mb-6 p-4">
          <View className="mb-4 flex-row flex-wrap items-start justify-between gap-3">
            <View className="max-w-2xl">
              <Text className="text-base font-semibold text-ink-900">Class fee setup</Text>
              <Text className="mt-1 text-sm leading-5 text-ink-700">
                Build fees for a month range. When fees change later, create the next range with the new amount.
              </Text>
            </View>
            {selectedClass ? (
              <View className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-blue-900">Selected class</Text>
                <Text className="text-sm font-semibold text-blue-950">{selectedClass.label}</Text>
              </View>
            ) : null}
          </View>
          {classId === "all" ? (
            <View className="rounded-md border border-ink-100 bg-white p-3">
              <View className="mb-3 flex-row flex-wrap items-start justify-between gap-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-ink-900">Choose a class to set fees</Text>
                  <Text className="mt-1 text-xs leading-5 text-ink-700">
                    Setup is saved class-wise because tuition, lab fees, and optional add-ons can differ by class.
                  </Text>
                </View>
                <Text className="text-xs font-semibold text-blue-700">Monthly setup</Text>
              </View>
              <View className="flex-row flex-wrap gap-2">
                {(data?.classes ?? []).map((c) => (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Set fees for ${c.label}`}
                    onPress={() => {
                      setClassId(c.id);
                      setFilter("all");
                    }}
                    className="min-w-[92px] items-center rounded-md border border-ink-200 bg-ink-50 px-4 py-3"
                  >
                    <Text className="text-sm font-semibold text-ink-900">{c.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            <View className="gap-4">
              <View className="gap-3 rounded-md border border-ink-100 bg-white p-3">
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-semibold text-ink-900">Fee setup history</Text>
                    <Text className="mt-0.5 text-xs leading-5 text-ink-700">Select an old, current, or future range to inspect and edit its fee lines.</Text>
                  </View>
                  <Button
                    variant="ghost"
                    onPress={startNewFeeRange}
                  >
                    New range
                  </Button>
                </View>
                {classTemplates.length ? (
                  <View className="flex-row flex-wrap gap-2">
                    {classTemplates.map((template) => {
                      const active = classTemplate?.id === template.id;
                      return (
                        <View
                          key={template.id}
                          className={`min-w-[210px] flex-1 rounded-md border px-3 py-2 ${active ? "border-blue-300 bg-blue-50" : "border-ink-100 bg-ink-50"}`}
                        >
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Edit fee setup ${template.startsPeriod || "start"} to ${template.endsPeriod || "end"}`}
                            onPress={() => {
                              setSelectedTemplateId(template.id);
                              setFeeEditorOpen(true);
                            }}
                          >
                            <Text className={`text-xs font-semibold uppercase tracking-wide ${active ? "text-blue-900" : "text-ink-700"}`}>
                              {template.startsPeriod || "Not set"} to {template.endsPeriod || "Not set"}
                            </Text>
                            <Text className="mt-1 text-sm font-semibold text-ink-900">{template.name}</Text>
                            <Text className="mt-0.5 text-xs text-ink-700">
                              ₹{feeTemplateTotal(template).toLocaleString("en-IN")} monthly · due day {template.dueDay}
                            </Text>
                          </Pressable>
                          <View className="mt-3 flex-row flex-wrap gap-2">
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Edit fee setup ${template.startsPeriod || "start"} to ${template.endsPeriod || "end"}`}
                              onPress={() => {
                                setSelectedTemplateId(template.id);
                                setFeeEditorOpen(true);
                              }}
                              className="flex-1 flex-row items-center justify-center gap-1 rounded-md border border-ink-200 bg-white px-3 py-2"
                            >
                              <Ionicons name="create-outline" size={15} color="#334155" />
                              <Text className="text-xs font-semibold text-ink-800">Edit setup</Text>
                            </Pressable>
                          {can(user, "fees.collect") ? (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Generate invoices for ${template.startsPeriod || "start"} to ${template.endsPeriod || "end"}`}
                              onPress={() => {
                                setSelectedTemplateId(template.id);
                                void issueFeeTemplate(template.id);
                              }}
                              className="flex-1 flex-row items-center justify-center gap-1 rounded-md border border-ink-200 bg-white px-3 py-2"
                            >
                              <Ionicons name="receipt-outline" size={15} color="#1d4ed8" />
                              <Text className="text-xs font-semibold text-blue-700">Generate invoices</Text>
                            </Pressable>
                          ) : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text className="rounded-md border border-dashed border-ink-200 px-3 py-2 text-xs text-ink-700">
                    No fee setup history yet. Create the first range for this class.
                  </Text>
                )}
              </View>
            </View>
          )}
        </Card>
      ) : null}
      <Modal
        open={feeEditorOpen}
        wide
        title={selectedTemplateId === "new" ? "New fee range" : "Edit fee range"}
        onClose={() => setFeeEditorOpen(false)}
        footer={
          <View className="flex-row flex-wrap justify-end gap-2">
            {can(user, "fees.collect") ? (
              <Button
                variant="ghost"
                disabled={!classTemplate}
                onPress={() => void issueFeeTemplate(classTemplate?.id)}
              >
                Generate invoices
              </Button>
            ) : null}
            {can(user, "fees.configure") ? (
              <Button onPress={() => void saveFeeTemplate()}>Save setup</Button>
            ) : null}
          </View>
        }
      >
        <View className="gap-4">
          <View className="flex-row flex-wrap gap-3">
            <View className="min-w-[260px] flex-1">
              <Field label="Template name" hint="Shown on generated student invoices.">
                <Input value={tplName} onChangeText={setTplName} placeholder={classTemplate?.name || "Monthly fee"} />
              </Field>
            </View>
            <View className="w-36">
              <Field label="Due day" hint="Day of month">
                <Input keyboardType="number-pad" value={tplDue} onChangeText={setTplDue} />
              </Field>
            </View>
          </View>
          <View className="rounded-md border border-ink-100 bg-white p-3">
            <View className="mb-3 flex-row flex-wrap items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-semibold text-ink-900">Fee applies for</Text>
                <Text className="mt-0.5 text-xs leading-5 text-ink-700">Use a new range when this class fee increases or decreases.</Text>
              </View>
              <Badge tone="clay">{tplStart && tplEnd ? `${tplStart} to ${tplEnd}` : "Set range"}</Badge>
            </View>
            <View className="flex-row flex-wrap gap-3">
              <View className="min-w-[180px] flex-1">
                <Field label="From month">
                  <MonthInput value={tplStart} onChangeText={setTplStart} />
                </Field>
              </View>
              <View className="min-w-[180px] flex-1">
                <Field label="To month">
                  <MonthInput value={tplEnd} onChangeText={setTplEnd} />
                </Field>
              </View>
            </View>
          </View>
          <View className="gap-2 rounded-md border border-ink-100 bg-ink-50 p-3">
            <View className="flex-row flex-wrap items-center justify-between gap-2">
              <View>
                <Text className="text-sm font-semibold text-ink-900">Fee line items</Text>
                <Text className="mt-0.5 text-xs text-ink-700">Use separate rows for base fee, laboratory, books, transport, or any other charge.</Text>
              </View>
              <View className="items-end">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-700">Monthly total</Text>
                <Text className="text-lg font-semibold text-ink-900">₹{tplTotal.toLocaleString("en-IN")}</Text>
              </View>
            </View>
            <View className="gap-2">
              {tplLines.map((line, index) => (
                <View key={line.id} className="flex-row flex-wrap items-end gap-2 rounded-md border border-ink-100 bg-white p-2">
                  <View className="min-w-[220px] flex-1">
                    <Field label={index === 0 ? "Component" : " "}>
                      <Input value={line.label} onChangeText={(label) => patchTplLine(line.id, { label })} placeholder="Tuition / Laboratory fee / Books" />
                    </Field>
                  </View>
                  <View className="w-40">
                    <Field label={index === 0 ? "Amount" : " "}>
                      <Input keyboardType="number-pad" value={line.amount} onChangeText={(amount) => patchTplLine(line.id, { amount })} placeholder="0" />
                    </Field>
                  </View>
                  <View className="w-48">
                    <Text className="mb-1 text-xs font-medium text-ink-700">{index === 0 ? "Applies to" : " "}</Text>
                    <View className="flex-row rounded-md border border-ink-200 bg-white p-0.5">
                      {(["ALL", "ADD_ON"] as const).map((scope) => (
                        <Pressable
                          key={scope}
                          accessibilityRole="button"
                          accessibilityLabel={`${line.label || "Fee line"} applies to ${scope === "ALL" ? "all students" : "selected add-on students"}`}
                          onPress={() => patchTplLine(line.id, { scope })}
                          className={`flex-1 items-center rounded px-2 py-2 ${line.scope === scope ? "bg-ink-900" : "bg-white"}`}
                        >
                          <Text className={`text-xs font-semibold ${line.scope === scope ? "text-white" : "text-ink-700"}`}>
                            {scope === "ALL" ? "All" : "Add-on"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove fee line ${index + 1}`}
                    disabled={tplLines.length <= 1}
                    onPress={() => removeTplLine(line.id)}
                    className={`h-10 w-10 items-center justify-center rounded-md border border-ink-200 ${tplLines.length <= 1 ? "opacity-40" : ""}`}
                  >
                    <Ionicons name="trash-outline" size={17} color="#b42318" />
                  </Pressable>
                </View>
              ))}
            </View>
            <View className="flex-row flex-wrap gap-2">
              {[
                ["Tuition", "8000", "ALL"],
                ["Laboratory fee", "500", "ALL"],
                ["Other fee", "0", "ALL"],
                ["Transport add-on", "1200", "ADD_ON"],
                ["Hostel add-on", "2000", "ADD_ON"],
                ["Coaching add-on", "1000", "ADD_ON"],
              ].map(([label, amount, scope]) => (
                <Pressable key={label} onPress={() => setTplLines((rows) => [...rows, newFeeLine(label, amount, scope as "ALL" | "ADD_ON")])} className="rounded-md border border-ink-200 bg-white px-3 py-2">
                  <Text className="text-xs font-medium text-clay-700">+ {label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-md border border-ink-100 bg-white p-3">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold text-ink-900">Student add-ons</Text>
              <Text className="mt-1 text-xs leading-5 text-ink-700">
                Mark optional services above as Add-on, then assign them only to students who take them. Discounts stay separate on the student profile.
              </Text>
            </View>
            <Button variant="ghost" onPress={() => router.push("/people" as never)}>Manage students</Button>
          </View>
          <View className="gap-3 rounded-md border border-ink-100 bg-white p-3">
            <Text className="text-sm font-semibold text-ink-900">Late fee rule</Text>
            <View className="flex-row flex-wrap gap-2">
              {["NONE", "STATIC", "DAILY"].map((id) => (
                <Chip key={id} label={id === "NONE" ? "No late" : id === "STATIC" ? "One-time late" : "Daily late"} active={tplLate === id} onPress={() => setTplLate(id)} />
              ))}
            </View>
            {tplLate !== "NONE" ? (
              <Field label="Late amount">
                <Input keyboardType="number-pad" value={tplAmount} onChangeText={setTplAmount} />
              </Field>
            ) : null}
          </View>
        </View>
      </Modal>
      {tab === "due" ? (
        <View className="rounded-md border border-ink-100 bg-white p-3">
          <View className="mb-3 flex-row items-center justify-between gap-3">
            <Text className="font-semibold text-ink-900">Pending invoices</Text>
            <View className="flex-row items-center gap-2">
              {filter === "overdue" && can(user, "fees.remind") && overdueStudents.length ? (
                <Button className="px-3 py-1.5" onPress={remindOverdue}>Remind</Button>
              ) : null}
              <Text className="text-xs font-medium text-ink-700">{students.length} students</Text>
            </View>
          </View>
          {!students.length ? (
            <View className="h-[300px] items-center justify-center rounded-md bg-ink-50 px-4">
              <Text className="text-base font-semibold text-ink-900">
                {filter === "overdue" ? "Nothing overdue" : "Nothing pending"}
              </Text>
              <Text className="mt-1 max-w-lg text-center text-sm leading-5 text-ink-700">
                {filter === "overdue"
                  ? "No unpaid invoice has crossed its due date."
                  : classId === "all"
                    ? "Pick a class to review its fee generation status."
                    : "Open Setup, create a saved fee range, then generate invoices from that range."}
              </Text>
            </View>
          ) : (
            <ScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 500 }}
              contentContainerClassName="gap-3 pb-1"
            >
              {students.map((s) => {
                const months = monthsOf(s);
                const overdue = s.overdueCount || 0;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => router.push({ pathname: "/people", params: { student: s.id } } as never)}
                  >
                    <View className="rounded-md border border-ink-100 bg-white p-4">
                      <View className="flex-row items-start justify-between gap-3">
                        <View className="flex-1">
                          <Text className="font-semibold text-ink-900">
                            {s.name}
                            {s.classLabel ? ` · ${s.classLabel}` : ""}
                          </Text>
                          <Text className="mt-1 text-sm text-ink-700">
                            {s.dueNow} due · {months} {months === 1 ? "month" : "months"}
                            {overdue ? ` · ${overdue} overdue` : ""}
                          </Text>
                          {oldestOf(s) ? <Text className="mt-1 text-xs text-ink-700">Oldest {oldestOf(s)}</Text> : null}
                        </View>
                        <Badge tone={overdue ? "warn" : "clay"}>{overdue ? "overdue" : "due"}</Badge>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

export { ExamsBoard } from "./exams-board";

const PORTAL_LABEL: Record<string, string> = {
  OFFICE: "Office",
  TEACHER: "Teacher",
  PARENT: "Parent",
  STUDENT: "Student",
};

const MODULE_COPY: Record<string, string> = {
  Dashboard: "First screen after login — dues, empty classes, what needs a look.",
  Students: "Student register, family details, and imports.",
  Employees: "Teachers and office staff. Attendance and leave.",
  "School settings": "Letterhead, clock, rooms, subjects, calendar, pay.",
  Documents: "Design templates, issue official documents, and manage verification.",
  Routine: "Periods, rooms, subjects, and teacher assignments.",
  Fees: "Cash window. Collect, remind, templates.",
  Exams: "Marksheets, papers, publish report cards.",
  Notices: "Circulars. Pick who and which class. They show in the app.",
  Roles: "Who can see what. Keep this on Admin.",
  Teaching: "Own classes — attendance, papers, marks, the week.",
  Family: "Own children — the record, and paying fees.",
  Student: "The child’s own path, tests, and timetable.",
};

const LOCKED_KEYS = ["roles.manage"];
const SCOPE_LABEL: Record<string, string> = {
  SELF: "Self",
  ASSIGNED: "Assigned",
  REPORTS: "Direct reports",
  SCHOOL: "Whole school",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function RolesBoard() {
  const { data, reload } = useRecord();
  const { token, refresh, user } = useSession();
  const toast = useToast();
  const roles = data?.roles ?? [];
  const users = data?.officeUsers ?? [];
  const catalogAll = data?.permissionCatalog ?? [];
  const [roleId, setRoleId] = useState(roles[0]?.id || "");
  const role = roles.find((r) => r.id === roleId) || roles[0];
  const [grants, setGrants] = useState<string[]>([]);
  const [grantScopes, setGrantScopes] = useState<Record<string, "SELF" | "ASSIGNED" | "REPORTS" | "SCHOOL">>({});
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [makeOpen, setMakeOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [managerFor, setManagerFor] = useState<string | null>(null);

  useEffect(() => {
    if (role) {
      setGrants(role.grants ?? []);
      setGrantScopes(role.grantScopes ?? {});
      setExpandedGroups({});
    }
  }, [role?.id, role?.grants, role?.grantScopes]);

  const catalog = catalogAll
    .filter((p) => !role || p.portals.includes(role.portal))
    .map((permission) => ({
      ...permission,
      ...(role && permission.scopePolicies?.[role.portal]
        ? permission.scopePolicies[role.portal]
        : {}),
    }));
  const groups = useMemo(() => {
    const names = [...new Set(catalog.map((p) => p.group))];
    const q = query.trim().toLowerCase();
    return names
      .map((group) => {
        const rows = catalog.filter((p) => p.group === group);
        return {
          group,
          see: rows.find((p) => p.see),
          actions: rows.filter((p) => !p.see),
          all: rows,
        };
      })
      .filter((m) => {
        if (!q) return true;
        const blob = [m.group, MODULE_COPY[m.group], ...m.all.map((p) => `${p.label} ${p.hint || ""}`)]
          .join(" ")
          .toLowerCase();
        return blob.includes(q);
      });
  }, [catalog, query]);

  const onRole = users.filter((u) => u.roleId === role?.id);
  const others = users.filter((u) => u.roleId !== role?.id);
  const office = roles.filter((r) => r.portal === "OFFICE");
  const portals = roles.filter((r) => r.portal !== "OFFICE");
  const roleOptions = [
    ...office.map((r) => ({
      id: r.id,
      label: `${r.name} · Office${users.filter((u) => u.roleId === r.id).length ? ` · ${users.filter((u) => u.roleId === r.id).length} people` : ""}`,
      searchText: `${r.name} office ${r.description || ""}`,
    })),
    ...portals.map((r) => ({
      id: r.id,
      label: `${r.name} · ${PORTAL_LABEL[r.portal] || r.portal}`,
      searchText: `${r.name} ${PORTAL_LABEL[r.portal] || r.portal} ${r.description || ""}`,
    })),
  ];

  function locked(key: string) {
    return role?.slug === "ADMIN" && LOCKED_KEYS.includes(key) && grants.includes(key);
  }

  async function apply(
    changes: { permission: string; on: boolean; scope?: "SELF" | "ASSIGNED" | "REPORTS" | "SCHOOL" }[]
  ) {
    if (!role || !changes.length) return;
    const next = new Set(grants);
    const nextScopes = { ...grantScopes };
    for (const change of changes) {
      if (locked(change.permission) && !change.on) continue;
      if (change.on) {
        next.add(change.permission);
        const row = catalog.find((p) => p.key === change.permission);
        nextScopes[change.permission] = change.scope ?? nextScopes[change.permission] ?? row?.defaultScope ?? "SCHOOL";
      } else {
        next.delete(change.permission);
        delete nextScopes[change.permission];
      }
    }
    const prev = grants;
    const prevScopes = grantScopes;
    setGrants([...next]);
    setGrantScopes(nextScopes);
    setPending(true);
    try {
      await act(token, "setRolePermissions", {
        roleId: role.id,
        changes: changes.filter((c) => !locked(c.permission) || c.on),
      });
      await reload();
      await refresh();
    } catch (e) {
      setGrants(prev);
      setGrantScopes(prevScopes);
      toast.show(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setPending(false);
    }
  }

  function scopeControl(permission: (typeof catalog)[number]) {
    if (!grants.includes(permission.key)) return null;
    const selected = grantScopes[permission.key] ?? permission.defaultScope;
    if (permission.scopes.length < 2) {
      return (
        <Text className="mt-1 text-[11px] font-medium text-ink-600">
          Scope: {SCOPE_LABEL[selected]}
        </Text>
      );
    }
    return (
      <View className="mt-2 flex-row flex-wrap gap-1">
        {permission.scopes.map((scope) => (
          <Pressable
            key={scope}
            disabled={pending}
            onPress={() => apply([{ permission: permission.key, on: true, scope }])}
            className={`rounded-full border px-2.5 py-1 ${
              selected === scope ? "border-clay-600 bg-clay-50" : "border-ink-200 bg-white"
            }`}
          >
            <Text className={`text-[11px] font-medium ${selected === scope ? "text-clay-700" : "text-ink-700"}`}>
              {SCOPE_LABEL[scope]}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  function flip(key: string, on: boolean) {
    if (!role || (locked(key) && !on)) return;
    const row = catalog.find((p) => p.key === key);
    if (!row) return;
    const mod = groups.find((m) => m.group === row.group) ?? {
      group: row.group,
      see: catalog.find((p) => p.group === row.group && p.see),
      actions: catalog.filter((p) => p.group === row.group && !p.see),
      all: catalog.filter((p) => p.group === row.group),
    };
    if (on) {
      const extra = mod.see && !grants.includes(mod.see.key) ? [{ permission: mod.see.key, on: true }] : [];
      apply([...extra, { permission: key, on: true }]);
      return;
    }
    if (row.see) {
      apply(mod.all.map((p) => ({ permission: p.key, on: false })));
      return;
    }
    apply([{ permission: key, on: false }]);
  }

  function flipModule(mod: (typeof groups)[number], on: boolean) {
    if (on) {
      const see = mod.see ?? mod.all[0];
      if (!see) return;
      apply([{ permission: see.key, on: true }]);
      return;
    }
    apply(mod.all.map((p) => ({ permission: p.key, on: false })));
  }

  async function saveModal(op: string, body: Record<string, unknown>, ok: string, close: () => void) {
    try {
      await act(token, op, body);
      close();
      setForm({});
      toast.show(ok);
      await reload();
      await refresh();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    }
  }

  if (!role) {
    return (
      <View>
        <PageHeader
          kicker="Admin · Reports"
          title="Roles & permissions"
          lede="Choose a role, then switch on the access that belongs to it."
        />
        <Empty title="No roles" body="Roles load from the school." />
      </View>
    );
  }

  return (
    <View>
      <PageHeader
        kicker="Admin · Reports"
        title="Roles & permissions"
        lede="Choose a role, then switch on the access that belongs to it."
      />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="gap-4">
        <View className="min-w-0 gap-4">
          <Card className="p-4">
            <View className="flex-row flex-wrap items-end justify-between gap-3">
              <View>
                <Text className="text-sm font-semibold text-ink-900">Permissions</Text>
                <Text className="mt-0.5 text-xs text-ink-700">Grouped by the screen or workflow they unlock.</Text>
              </View>
              <View className="flex-row flex-wrap items-end gap-2">
                <View className="w-72">
                  <Dropdown
                    label="Role"
                    value={role.id}
                    options={roleOptions}
                    onChange={(id) => setRoleId(id)}
                    placeholder="Pick a role"
                  />
                </View>
                <Button
                  variant="ghost"
                  onPress={() => {
                    setForm({});
                    setMakeOpen(true);
                  }}
                >
                  New role
                </Button>
              </View>
            </View>
            <View className="mt-3">
              <Input
                className="py-1.5"
                placeholder="Find people, fees, exams..."
                value={query}
                onChangeText={setQuery}
              />
            </View>

            <View className="mt-4 overflow-hidden rounded-md border border-ink-200">
              {groups.map((mod) => {
                const seeOn = mod.see ? grants.includes(mod.see.key) : mod.all.some((p) => grants.includes(p.key));
                const expanded = Boolean(query.trim()) || Boolean(expandedGroups[mod.group]);
                return (
                  <View key={mod.group} className="border-b border-ink-200 last:border-b-0">
                    <View className="flex-row items-center justify-between gap-4 bg-ink-50 px-3 py-3">
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setExpandedGroups((cur) => ({ ...cur, [mod.group]: !cur[mod.group] }))}
                        className="min-w-0 flex-1"
                      >
                        <View className="flex-row flex-wrap items-center gap-2">
                          <Text className="text-sm font-semibold text-ink-900">{mod.group}</Text>
                          <Badge tone={seeOn ? "leaf" : "ink"}>{seeOn ? "On" : "Off"}</Badge>
                        </View>
                        <Text className="mt-0.5 text-xs text-ink-700">{MODULE_COPY[mod.group] ?? ""}</Text>
                      </Pressable>
                      <View className="flex-row items-center gap-3">
                        <Switch
                          on={seeOn}
                          disabled={Boolean(mod.see && locked(mod.see.key))}
                          onPress={() => flipModule(mod, !seeOn)}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${mod.group}`}
                          hitSlop={8}
                          onPress={() => setExpandedGroups((cur) => ({ ...cur, [mod.group]: !cur[mod.group] }))}
                        >
                          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color="#3d4f66" />
                        </Pressable>
                      </View>
                    </View>
                    {expanded && mod.see ? (
                      <View className="flex-row items-center justify-between gap-3 border-t border-ink-100 bg-white px-3 py-2.5">
                        <View className="min-w-0 flex-1">
                          <Text className="text-sm font-medium text-ink-900">{mod.see.label}</Text>
                          {mod.see.hint ? <Text className="text-[11px] text-ink-700">{mod.see.hint}</Text> : null}
                        </View>
                        <View className="items-end">
                          <Switch
                            on={grants.includes(mod.see.key)}
                            disabled={locked(mod.see.key)}
                            onPress={() => flip(mod.see!.key, !grants.includes(mod.see!.key))}
                          />
                          {scopeControl(mod.see)}
                        </View>
                      </View>
                    ) : null}
                    {expanded
                      ? mod.actions.map((perm) => (
                        <View
                          key={perm.key}
                          className={`flex-row items-center justify-between gap-3 border-t border-ink-100 px-3 py-2.5 ${
                            seeOn ? "bg-white" : "bg-white opacity-40"
                          }`}
                        >
                          <View className="min-w-0 flex-1">
                            <Text className="text-sm text-ink-900">{perm.label}</Text>
                            {perm.hint ? <Text className="text-[11px] text-ink-700">{perm.hint}</Text> : null}
                          </View>
                          <View className="items-end">
                            <Switch
                              on={grants.includes(perm.key)}
                              disabled={locked(perm.key) || !seeOn}
                              onPress={() => flip(perm.key, !grants.includes(perm.key))}
                            />
                            {scopeControl(perm)}
                          </View>
                        </View>
                      ))
                      : null}
                  </View>
                );
              })}
              {!groups.length ? (
                <Text className="px-4 py-8 text-center text-sm text-ink-700">Nothing matches “{query}”.</Text>
              ) : null}
            </View>
          </Card>

          {role.portal === "OFFICE" ? (
            <Card className="p-4">
              <View className="flex-row items-center justify-between gap-2">
                <View>
                  <Text className="text-sm font-semibold text-ink-900">Users in this role</Text>
                  <Text className="text-xs text-ink-700">Move or add office users here.</Text>
                </View>
                <View className="flex-row gap-3">
                  {others.length ? (
                    <Pressable onPress={() => setAssignOpen(true)}>
                      <Text className="text-xs font-medium text-clay-600">Move</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => {
                      setForm({});
                      setAddOpen(true);
                    }}
                  >
                    <Text className="text-xs font-medium text-clay-600">Add</Text>
                  </Pressable>
                </View>
              </View>
              {onRole.length ? (
                <View className="mt-3 flex-row flex-wrap gap-3">
                  {onRole.map((u) => {
                    const adminRole = role.slug === "ADMIN";
                    const open = managerFor === u.id;
                    return (
                      <View key={u.id} className="min-w-[220px] flex-1 rounded-md border border-ink-100 bg-ink-50 p-3">
                        <View className="flex-row items-center gap-2">
                          <View className="h-8 w-8 items-center justify-center rounded-full bg-ink-100">
                            <Text className="text-[11px] font-semibold text-ink-800">{initials(u.name)}</Text>
                          </View>
                          <View className="min-w-0 flex-1">
                            <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>
                              {u.name}
                            </Text>
                            <Text className="text-[11px] text-ink-700" numberOfLines={1}>
                              {u.email}
                            </Text>
                            {!adminRole && (u.managerName || canChangeManager(user, u.managerId)) ? (
                              <Pressable
                                disabled={!canChangeManager(user, u.managerId)}
                                onPress={() => setManagerFor(open ? null : u.id)}
                              >
                                <Text className="text-[11px] text-ink-700">
                                  Reports to {u.managerName || "—"}
                                  {canChangeManager(user, u.managerId) ? (open ? " · Done" : " · Change") : ""}
                                </Text>
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                        {!adminRole && open ? (
                          <View className="mt-2 pl-10">
                            <ManagerPicker
                              user={user}
                              managers={data?.managers ?? []}
                              value={u.managerId}
                              onPick={async (id) => {
                                try {
                                  await act(token, "setManager", { userId: u.id, managerId: id });
                                  setManagerFor(null);
                                  toast.show("Reporting manager saved.");
                                  await reload();
                                } catch (e) {
                                  toast.show(e instanceof Error ? e.message : "Could not save.");
                                }
                              }}
                            />
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text className="mt-3 text-sm text-ink-700">Nobody yet.</Text>
              )}
            </Card>
          ) : null}
        </View>
      </View>

      <Modal open={makeOpen} title="New role" onClose={() => setMakeOpen(false)}>
        <View className="gap-3">
          <Text className="text-sm text-ink-700">
            Create a custom office role. Turn on only the permissions it needs.
          </Text>
          <Field label="Name">
            <Input
              value={form.name || ""}
              onChangeText={(v) => setForm({ ...form, name: v })}
              placeholder="Clerk"
            />
          </Field>
          <Button
            onPress={() =>
              saveModal(
                "createCustomRole",
                { name: form.name, fromId: "" },
                "Role created",
                () => setMakeOpen(false)
              )
            }
          >
            Create role
          </Button>
        </View>
      </Modal>

      <Modal open={addOpen} title={`Add person — ${role.name}`} onClose={() => setAddOpen(false)}>
        <View className="gap-3">
          <Field label="Name">
            <Input value={form.name || ""} onChangeText={(v) => setForm({ ...form, name: v })} />
          </Field>
          <Field label="Email">
            <Input autoCapitalize="none" value={form.email || ""} onChangeText={(v) => setForm({ ...form, email: v })} />
          </Field>
          <Field label="Password">
            <Input value={form.password || ""} onChangeText={(v) => setForm({ ...form, password: v })} placeholder="office123" />
          </Field>
          <Button
            onPress={() =>
              saveModal(
                "createOfficeUser",
                { name: form.name, email: form.email, password: form.password, roleId: role.id },
                "Person added",
                () => setAddOpen(false)
              )
            }
          >
            Add person
          </Button>
        </View>
      </Modal>

      <Modal open={assignOpen} title={`Move someone to ${role.name}`} onClose={() => setAssignOpen(false)}>
        <View className="gap-3">
          {others.map((u) => (
            <Chip
              key={u.id}
              label={`${u.name} · ${roles.find((r) => r.id === u.roleId)?.name ?? ""}`}
              active={form.userId === u.id}
              onPress={() => setForm({ ...form, userId: u.id })}
            />
          ))}
          <Button
            onPress={() =>
              saveModal(
                "assignOfficeUser",
                { userId: form.userId, roleId: role.id },
                "Moved",
                () => setAssignOpen(false)
              )
            }
          >
            Move here
          </Button>
        </View>
      </Modal>

    </View>
  );
}

export { Row };
