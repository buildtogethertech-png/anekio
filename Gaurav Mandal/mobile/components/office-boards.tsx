import { createElement, useMemo, useState, useEffect } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { GeneratePayment } from "./generate-payment";
import { Dropdown } from "./form";
import { Badge, Button, Card, Chip, Empty, Field, Input, Modal, PageHeader, Segmented, Sheet, Stat, Switch, Toast, useToast } from "./ui";
import { DateField } from "./date-field";
import { StaffAdmitForm, type StaffAdmitPayload } from "./staff-admit-form";
import { StudentAdmitForm, type StudentAdmitPayload } from "./student-admit-form";
import { ReportCardSheet, type ReportCardData } from "./report-card-sheet";
import { studentSeriesScore, studentYearScore } from "../lib/exams";
import { act } from "../lib/mutate";
import { useRecord, type AdmissionFormField } from "../lib/record";
import { useSession } from "../lib/session";
import { canChangeManager, ManagerPicker } from "./manager-picker";
import { AttendanceDots, DayMark, OnLeaveSign } from "./attendance-mark";
import { lastAttendanceDots } from "../lib/attendance-summary";
import { calendarFrom, closedCaption, closedReason, ymd } from "../lib/calendar";
import { QuickDocumentButton } from "./document-studio";

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
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
    tone === "paid" ? "text-leaf-600" : tone === "overdue" ? "text-amber-800" : "text-ink-700";
  return <Text className={`text-xs ${color}`}>{label || ""}</Text>;
}

type PeopleKind = "student" | "teacher" | "parent";

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
  const [feeFilter, setFeeFilter] = useState<"all" | "due" | "overdue" | "clear">(incoming ? "due" : "all");
  const [picked, setPicked] = useState<{ kind: PeopleKind; id: string } | null>(
    incoming ? { kind: "student", id: incoming } : null
  );
  const [payOpen, setPayOpen] = useState(false);
  const [openCard, setOpenCard] = useState<ReportCardData | null>(null);
  const [add, setAdd] = useState<PeopleKind | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importCsv, setImportCsv] = useState("");
  const [importKind, setImportKind] = useState<PeopleKind>("student");
  const [filterOpen, setFilterOpen] = useState(false);
  const [fileTab, setFileTab] = useState<"file" | "fees" | "reports">("file");
  const [fileEdit, setFileEdit] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [editTags, setEditTags] = useState<string[]>([]);
  const [idCardPending, setIdCardPending] = useState(false);
  const people = data?.people ?? [];
  const teachersAll = data?.peopleTeachers ?? [];
  const parentsAll = data?.peopleParents ?? [];
  const showFees = can(user, "fees.view");
  const needle = q.trim().toLowerCase();
  const showStudents = studentOnly || kind === "student";
  const showTeachers = !studentOnly && kind === "teacher";
  const showParents = !studentOnly && kind === "parent";
  const addKind: PeopleKind = kind === "parent" ? "parent" : "student";
  const filtered = people.filter((s) => {
    if (classIds.length && !classIds.includes(s.classId || "")) return false;
    if (showFees && feeFilter === "due" && !(s.dueAmount && s.dueAmount > 0)) return false;
    if (showFees && feeFilter === "overdue" && !(s.overdueCount && s.overdueCount > 0)) return false;
    if (showFees && feeFilter === "clear" && (s.dueAmount || 0) > 0) return false;
    if (!needle) return true;
    return [s.name, s.admissionNo, s.parent, s.classLabel, s.parentEmail].join(" ").toLowerCase().includes(needle);
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
      ? people.find((s) => s.id === picked.id) || (wide ? filtered[0] || null : null)
      : wide && showStudents && !showTeachers && !showParents
        ? filtered[0] || null
        : null;
  const selectedTeacher =
    picked?.kind === "teacher"
      ? teachersAll.find((t) => t.id === picked.id) || (wide ? filteredTeachers[0] || null : null)
      : null;
  const selectedParent =
    picked?.kind === "parent"
      ? parentsAll.find((p) => p.id === picked.id) || (wide ? filteredParents[0] || null : null)
      : null;
  const selected = selectedStudent;

  useEffect(() => {
    if (!incoming) return;
    setFeeFilter("due");
    setClassIds([]);
    setKind("student");
    setPicked({ kind: "student", id: incoming });
    setFileTab("file");
  }, [incoming]);
  useEffect(() => {
    setFileTab("file");
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
      ? studentYearScore(selected.id, yearPlan, yearSittings, examPack?.policy ?? { bands: [], passPercent: 33, showRank: false })
      : null;
  const classmates = people.filter((s) => s.classId === selected?.classId);
  const classSummary =
    classIds.length === 0
      ? null
      : classIds.length === 1
        ? (data?.classes ?? []).find((c) => c.id === classIds[0])?.label || "1 class"
        : `${classIds.length} classes`;
  const feeSummary = !showFees || feeFilter === "all" ? null : feeFilter === "due" ? "Due" : feeFilter === "overdue" ? "Overdue" : "Paid up";
  const filterLabel = [classSummary, feeSummary].filter(Boolean).join(" · ") || "Filter";
  const filterOn = filterLabel !== "Filter";

  function pickKind(next: PeopleKind) {
    setKind(next);
    setFileTab("file");
    if (!wide) {
      setPicked(null);
      return;
    }
    if (next === "student") setPicked(filtered[0] ? { kind: "student", id: filtered[0].id } : null);
    if (next === "teacher") setPicked(filteredTeachers[0] ? { kind: "teacher", id: filteredTeachers[0].id } : null);
    if (next === "parent") setPicked(filteredParents[0] ? { kind: "parent", id: filteredParents[0].id } : null);
  }

  const filterBody = (
    <View className="gap-4">
      <View>
        <Text className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-700">Class</Text>
        <View className="flex-row flex-wrap gap-1.5">
          <Chip label="All" active={classIds.length === 0} onPress={() => setClassIds([])} />
          {(data?.classes ?? []).map((c) => (
            <Chip
              key={c.id}
              label={c.label}
              active={classIds.includes(c.id)}
              onPress={() =>
                setClassIds((ids) => (ids.includes(c.id) ? ids.filter((id) => id !== c.id) : [...ids, c.id]))
              }
            />
          ))}
        </View>
      </View>
      {showFees ? <View>
        <Text className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-700">Fees</Text>
        <View className="flex-row flex-wrap gap-1.5">
          {(
            [
              ["all", "All"],
              ["due", "Due"],
              ["overdue", "Overdue"],
              ["clear", "Paid up"],
            ] as const
          ).map(([id, label]) => (
            <Chip key={id} label={label} active={feeFilter === id} onPress={() => setFeeFilter(id)} />
          ))}
        </View>
      </View> : null}
    </View>
  );

  const listTools = (
    <View className="border-b border-ink-100 p-2.5">
      <View className="flex-row gap-2">
        <View className="min-w-0 flex-1">
          <Input placeholder="Search" value={q} onChangeText={setQ} />
        </View>
        {showStudents ? (
          <View className="relative shrink-0">
            <Pressable
              onPress={() => setFilterOpen((on) => !on)}
              className={`h-[42px] max-w-[7.5rem] justify-center rounded-md border px-2.5 ${
                filterOn ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"
              }`}
            >
              <Text numberOfLines={1} className={`text-xs ${filterOn ? "text-white" : "text-ink-900"}`}>
                {filterLabel}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {!studentOnly ? <View className="mt-2">
        <Segmented
          options={[
            { id: "student", label: "Student" },
            { id: "parent", label: "Parent" },
          ]}
          value={kind}
          onChange={(id) => pickKind(id as PeopleKind)}
        />
      </View> : null}
      {wide && showStudents && filterOpen ? <View className="mt-2 border-t border-ink-100 pt-2">{filterBody}</View> : null}
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

  function StudentPane({ bare }: { bare?: boolean }) {
    if (!selected) {
      return <Empty title="Pick a student" body="Family details and report cards show here." />;
    }
    const classTeacher = teachersAll.find((teacher) => teacher.classId && teacher.classId === selected.classId);
    const latestIdCard = (data?.documentStudio?.issued || [])
      .filter((row) => row.type === "STUDENT_ID" && row.subjectType === "STUDENT" && row.subjectId === selected.id)
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())[0];
    const activeIdTemplate = (data?.documentStudio?.templates || []).some((row) => row.status === "ACTIVE" && row.type === "STUDENT_ID");
    const header = (
      <>
        <View className="flex-row flex-wrap items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-2xl font-semibold text-ink-900">{selected.name}</Text>
            <Text className="mt-1 text-sm text-ink-700">
              {selected.classLabel} · {selected.admissionNo}
              {selected.born ? ` · Born ${selected.born}` : ""}
            </Text>
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
        <View className="mt-4">
          <Segmented
            options={[
              { id: "file", label: "File" },
              ...(showFees ? [{ id: "fees", label: "Fees" }] : []),
              { id: "reports", label: "Reports" },
            ]}
            value={fileTab}
            onChange={(id) => setFileTab(id as "file" | "fees" | "reports")}
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
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={() => setFileEdit(false)}>
            Cancel
          </Button>
          <Button onPress={saveFile}>Save</Button>
        </View>
      </View>
    ) : (
      <View className="mt-2">
        <View className="flex-row items-center justify-between py-1">
          <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Details</Text>
          {can(user, "people.edit") ? (
            <Pencil
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
                });
                setEditTags(pathIds(selected.path));
                setFileEdit(true);
              }}
            />
          ) : null}
        </View>
        <FactRow label="Parent" value={selected.parent} />
        <FactRow label="Phone" value={selected.parentPhone || "—"} />
        <FactRow label="Email" value={selected.parentEmail || "—"} />
        <FactRow label="Address" value={selected.parentAddress || "—"} />
        <View className="my-3 rounded-md border border-blue-100 bg-blue-50 p-4">
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
                {idCardPending ? "Issuing…" : latestIdCard ? "Reissue" : "Issue ID card"}
              </Button>
            </View>
          </View>
        </View>
        <View className="flex-row items-center justify-between gap-4 border-b border-ink-100 py-2.5">
          <Text className="w-24 shrink-0 text-xs text-ink-700">Class teacher</Text>
          {classTeacher ? (
            <View className="min-w-0 flex-1 items-end">
              <Text numberOfLines={1} className="text-right text-sm font-medium text-ink-900">
                {classTeacher.name}
              </Text>
              <Pressable onPress={() => router.push("/staff" as never)} hitSlop={8} className="mt-0.5">
                <Text className="text-xs font-medium text-clay-600">View in Employees</Text>
              </Pressable>
            </View>
          ) : (
            <Text className="min-w-0 flex-1 text-right text-sm text-ink-900">Not assigned</Text>
          )}
        </View>
        <View className="flex-row items-center justify-between gap-4 py-2.5">
          <Text className="w-24 shrink-0 text-xs text-ink-700">Path</Text>
          <View className="flex-1 flex-row flex-wrap justify-end gap-1">
            {(selected.path ?? []).length ? (
              selected.path!.map((p) => (
                <Badge key={p} tone="clay">
                  {p}
                </Badge>
              ))
            ) : (
              <Text className="text-sm text-ink-900">—</Text>
            )}
          </View>
        </View>
      </View>
    );
    const feesBody = (
      <View className="mt-3 min-h-0 flex-1">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Fees</Text>
          {can(user, "fees.collect") || can(user, "people.edit") ? (
            <Pressable onPress={() => setPayOpen(true)} className="py-1">
              <Text className="text-sm font-medium text-clay-600">Generate payment</Text>
            </Pressable>
          ) : null}
        </View>
        <View className="flex-row">
          <View className="flex-1">
            <Text className="text-xs text-ink-700">Billed</Text>
            <Text className="mt-1 text-base font-semibold text-ink-900">{selected.billed || "₹0"}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-xs text-ink-700">Paid</Text>
            <Text className="mt-1 text-base font-semibold text-ink-900">{selected.paid || "₹0"}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-xs text-ink-700">Due now</Text>
            <Text
              className={`mt-1 text-base font-semibold ${
                (selected.dueAmount || 0) > 0 ? "text-amber-800" : "text-leaf-600"
              }`}
            >
              {selected.dueNow || "₹0"}
            </Text>
            {selected.overdueCount ? (
              <Text className="mt-1 text-xs text-amber-800">{selected.overdueCount} overdue</Text>
            ) : null}
          </View>
        </View>
        {selected.invoices?.length ? (
          <ScrollView className="mt-3 min-h-0 flex-1" nestedScrollEnabled>
            <View className="overflow-hidden rounded-md border border-ink-200">
              {selected.invoices.map((inv, i) => (
                <View
                  key={inv.id}
                  className={`flex-row items-center justify-between gap-3 px-3 py-3 ${i ? "border-t border-ink-100" : ""}`}
                >
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-ink-900">{inv.title}</Text>
                    <Text className="mt-1 text-xs text-ink-700">
                      Due {inv.due} · {inv.amount}
                      {inv.remaining ? ` · ${inv.remaining} left` : ""}
                    </Text>
                  </View>
                  <Badge tone={inv.status === "paid" ? "leaf" : inv.status === "overdue" ? "warn" : "clay"}>
                    {inv.status}
                  </Badge>
                </View>
              ))}
            </View>
          </ScrollView>
        ) : (
          <Text className="mt-3 text-sm text-ink-700">
            No bills yet. Generate payment, then run fees for {selected.classLabel}.
          </Text>
        )}
      </View>
    );
    const reportsBody = (
      <View className="mt-3">
        {year?.entered ? (
          <Text className="text-sm text-ink-800">
            Year {year.pct}%
            {year.grade ? ` · ${year.grade}` : ""} · {year.entered} sitting{year.entered === 1 ? "" : "s"}
          </Text>
        ) : null}
        {classSittings.length ? (
          <View className="mt-2 overflow-hidden rounded-md border border-ink-200">
            {classSittings.map((series, i) => {
              const score = studentSeriesScore(
                selected.id,
                series.exams,
                series.marks,
                examPack?.policy ?? { bands: [], passPercent: 33, showRank: false }
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
                      policy: examPack?.policy ?? { bands: [], passPercent: 33, showRank: false },
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
    const tabBody = showFees && fileTab === "fees" ? feesBody : fileTab === "reports" ? reportsBody : fileBody;
    if (bare) {
      return (
        <View className="px-5 pb-6">
          {header}
          {tabBody}
        </View>
      );
    }
    return (
      <Card className="min-h-0 flex-1 overflow-hidden p-5">
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
    return <Card className="min-h-0 flex-1 overflow-hidden p-5">{body}</Card>;
  }

  function ParentPane({ bare }: { bare?: boolean }) {
    if (!selectedParent) {
      return <Empty title="Pick a parent" body="Contact and children show here." />;
    }
    const kids = Array.isArray(selectedParent.children) ? selectedParent.children : [];
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
          <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Children</Text>
          {can(user, "fees.collect") || can(user, "people.edit") ? (
            <Pressable onPress={() => setPayOpen(true)} className="py-1">
              <Text className="text-sm font-medium text-clay-600">Generate payment</Text>
            </Pressable>
          ) : null}
        </View>
        {kids.length ? (
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
    return <Card className="min-h-0 flex-1 overflow-hidden p-5">{body}</Card>;
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

  const peopleList = (
    <Card className={`min-h-0 overflow-hidden ${wide ? "" : "flex-1"}`} style={wide ? { width: 320 } : undefined}>
      {listTools}
      {listEmpty ? (
        <Text className="px-4 py-10 text-center text-sm text-ink-700">No people match that filter.</Text>
      ) : (
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" className="flex-1" contentContainerClassName={wide ? undefined : "pb-24"}>
          {showStudents
            ? filtered.map((s, i) => {
                const on = picked?.kind === "student" && picked.id === s.id;
                return (
                  <Pressable
                    key={`student-${s.id}`}
                    onPress={() => setPicked({ kind: "student", id: s.id })}
                    className={`flex-row items-start justify-between gap-3 px-4 py-3 ${i ? "border-t border-ink-100" : ""} ${
                      on ? "bg-blue-50" : ""
                    }`}
                  >
                    <View className="flex-1">
                      <Text className="font-medium text-ink-900">{s.name}</Text>
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
            ? filteredTeachers.map((t, i) => {
                const on = picked?.kind === "teacher" && picked.id === t.id;
                return (
                  <Pressable
                    key={`teacher-${t.id}`}
                    onPress={() => setPicked({ kind: "teacher", id: t.id })}
                    className={`px-4 py-3 ${i ? "border-t border-ink-100" : ""} ${on ? "bg-blue-50" : ""}`}
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
            ? filteredParents.map((p, i) => {
                const on = picked?.kind === "parent" && picked.id === p.id;
                return (
                  <Pressable
                    key={`parent-${p.id}`}
                    onPress={() => setPicked({ kind: "parent", id: p.id })}
                    className={`px-4 py-3 ${i ? "border-t border-ink-100" : ""} ${on ? "bg-blue-50" : ""}`}
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
      <View className="mb-3 flex-row items-center justify-between gap-2">
        <Text className="text-xl font-semibold text-ink-900">{title}</Text>
        <View className="flex-row flex-wrap gap-2">
          {can(user, "people.import") || can(user, "people.edit") ? (
            <Button
              variant="ghost"
              onPress={() => {
                setImportKind(addKind);
                setImportOpen(true);
              }}
            >
              Import
            </Button>
          ) : null}
          {can(user, "people.edit") ? (
            <Button onPress={() => setAdd(addKind)}>
              {addKind === "parent" ? "Add parent" : "Add student"}
            </Button>
          ) : null}
        </View>
      </View>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}

      {wide ? (
        <View className="min-h-0 flex-1 flex-row gap-4">
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

      <Sheet open={!wide && showStudents && filterOpen} onClose={() => setFilterOpen(false)}>
        <View className="px-5 pb-4">{filterBody}</View>
      </Sheet>

      <Modal open={importOpen} title="Import sheet" onClose={() => setImportOpen(false)}>
        <View className="gap-3">
          <Text className="text-sm text-ink-700">
            Paste CSV with a header row. Students need name, admissionNo, dateOfBirth, class, parentEmail.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {(["student", "parent"] as PeopleKind[]).map((id) => (
              <Chip key={id} label={id} active={importKind === id} onPress={() => setImportKind(id)} />
            ))}
          </View>
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

export function StaffBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const staff = data?.staff ?? [];
  const [q, setQ] = useState("");
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [infoFor, setInfoFor] = useState<(typeof staff)[number] | null>(null);
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

  useEffect(() => {
    if (!pendingLeave.length) setLeaveOpen(false);
  }, [pendingLeave.length]);

  function statusOf(p: (typeof staff)[number]) {
    const key = `${p.kind}:${p.id}`;
    const hit = p.days?.find((d) => d.date === date);
    const saved = (hit?.status || (date === today ? p.today : "") || "").toUpperCase();
    if (saved === "LEAVE") return "LEAVE";
    if (marks[key]) return marks[key];
    return saved || "PRESENT";
  }

  async function saveDay() {
    if (locked) {
      toast.show(lockedNote || "Attendance is not marked.");
      return;
    }
    try {
      await act(token, "markStaffAttendance", {
        date,
        rows: staff.map((p) => ({
          kind: p.kind || "staff",
          id: p.id,
          status: statusOf(p).toUpperCase(),
        })),
      });
      toast.show("Saved the day.");
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

  const yes = staff.filter((p) => statusOf(p).toUpperCase() === "PRESENT").length;
  const late = staff.filter((p) => statusOf(p).toUpperCase() === "LATE").length;
  const no = staff.filter((p) => statusOf(p).toUpperCase() === "ABSENT").length;
  const onLeave = staff.filter((p) => statusOf(p).toUpperCase() === "LEAVE").length;
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
        joinedOn: editFor.joinedOn || today,
        email: editFor.email || "",
        address: editFor.address || "",
        city: editFor.city || "",
        state: editFor.state || "",
        pincode: editFor.pincode || "",
        managerId: editFor.managerId || "",
      }
    : undefined;

  const register = (
    <Card className="min-h-0 flex-1">
      <View className="gap-3 border-b border-ink-100 px-4 py-4">
        <View
          testID="staff-toolbar-controls"
          className={`flex-row gap-2 ${phone ? "items-start" : "items-end"}`}
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
          <View className={`shrink-0 ${phone ? "w-[158px]" : "w-[220px]"}`}>
            <Field label="Date">
              <DateField
                plain
                value={date}
                max={today}
                closedReason={(value) => closedReason(value, calendar)}
                onChange={(next) => {
                  setDate(next);
                  setMarks({});
                }}
              />
            </Field>
          </View>
          {!phone && canMark ? (
            <Button variant="ghost" onPress={() => setAddOpen(true)}>
              + Add staff
            </Button>
          ) : null}
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
          {phone && canMark ? (
            <Button variant="ghost" onPress={() => setAddOpen(true)}>
              + Add staff
            </Button>
          ) : null}
        </View>
      </View>
      <ScrollView className="min-h-0 flex-1" keyboardShouldPersistTaps="handled">
        {!shown.length ? (
          <View className="px-4 py-8">
            <Empty title="No match" body="Clear search to see the full register." />
          </View>
        ) : (
          shown.map((p) => {
            const st = statusOf(p).toUpperCase();
            const dots = lastAttendanceDots(p.days ?? [], date, locked ? undefined : st, 7, calendar);
            const mark =
              st === "LEAVE" ? (
                <OnLeaveSign />
              ) : (
                <DayMark
                  name={p.name}
                  status={st}
                  disabled={locked || !canMark}
                  onChange={(next) => setMarks((m) => ({ ...m, [`${p.kind}:${p.id}`]: next }))}
                />
              );
            const who = (
              <View className={phone ? "min-w-0 flex-1" : "w-56 shrink-0"}>
                <View className="min-w-0">
                  <View className="flex-row items-center gap-1.5">
                    <Text className="min-w-0 shrink text-sm font-medium text-ink-900" numberOfLines={1}>
                      {p.name}
                    </Text>
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
      <PageHeader
        title="Employees"
        lede="Mark P, A or late. Leave shows on its own."
        action={
          pendingLeave.length ? (
            <Button variant="ghost" onPress={() => setLeaveOpen(true)}>
              {`Leave requests (${pendingLeave.length})`}
            </Button>
          ) : undefined
        }
      />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
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
          </View>
        ) : null}
      </Modal>
      <Modal open={addOpen} title="Add staff" onClose={() => setAddOpen(false)}>
        <StaffAdmitForm
          roles={data?.staffRoles ?? []}
          managers={data?.managers ?? []}
          user={user}
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
      <Modal open={Boolean(editFor)} title="Edit staff" onClose={() => setEditFor(null)}>
        {editFor ? (
          <StaffAdmitForm
            roles={editRoleOptions}
            managers={data?.managers ?? []}
            user={user}
            initialValues={editInitial}
            submitLabel="Save staff"
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

export function FeesBoard() {
  const { data, reload } = useRecord();
  const { token, user } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [classId, setClassId] = useState("all");
  const [filter, setFilter] = useState<"all" | "overdue">("all");
  const [tab, setTab] = useState<"due" | "templates">("due");
  const [tplName, setTplName] = useState("Monthly fee");
  const [tplDue, setTplDue] = useState("10");
  const [tplLate, setTplLate] = useState("NONE");
  const [tplAmount, setTplAmount] = useState("0");
  const [tplLines, setTplLines] = useState("Tuition,8000");
  const [invoiceTitle, setInvoiceTitle] = useState("Fee");
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [invoiceStudent, setInvoiceStudent] = useState("");
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
  const classTemplate = templates.find(
    (t) => t.classId === classId && (!currentSession || t.sessionId === currentSession.id || !t.sessionId)
  );

  async function runFees() {
    try {
      await act(token, "issueDueFees", { classId: classId === "all" ? undefined : classId });
      toast.show("Fees issued.");
      await reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not run fees.");
    }
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

  return (
    <View>
      <PageHeader kicker="Admin · Reports" title="Fees" lede="One line per student. Open them on Students to collect." />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View className="mb-4 flex-row flex-wrap gap-2">
        <Chip label="Due" active={tab === "due"} onPress={() => setTab("due")} />
        <Chip label="Templates" active={tab === "templates"} onPress={() => setTab("templates")} />
      </View>
      <View className="mb-4 flex-row flex-wrap gap-2">
        <Chip
          label={dueStudents.length ? `Due · ${dueStudents.length}` : "Due"}
          active={classId === "all" && filter === "all"}
          onPress={() => {
            setClassId("all");
            setFilter("all");
          }}
        />
        <Chip
          label={overdueStudents.length ? `Overdue · ${overdueStudents.length}` : "Overdue"}
          active={filter === "overdue" && classId === "all"}
          onPress={() => {
            setClassId("all");
            setFilter("overdue");
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
      {tab === "templates" ? (
        <Card className="mb-6 p-4">
          <Text className="mb-2 text-sm font-medium text-ink-900">Fee template</Text>
          <Text className="mb-3 text-sm text-ink-700">Pick a class, then save the monthly lines. One line per part: Tuition,8000</Text>
          {classId === "all" ? (
            <Text className="text-sm text-ink-700">Pick a class above first.</Text>
          ) : (
            <View className="gap-3">
              <Field label="Name">
                <Input value={tplName} onChangeText={setTplName} placeholder={classTemplate?.name || "Monthly fee"} />
              </Field>
              <Field label="Due day">
                <Input keyboardType="number-pad" value={tplDue} onChangeText={setTplDue} />
              </Field>
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
              <Field label="Lines">
                <Input value={tplLines} onChangeText={setTplLines} multiline placeholder={"Tuition,8000\nBooks,800"} />
              </Field>
              {can(user, "fees.configure") ? (
                <Button
                  onPress={async () => {
                    try {
                      await act(token, "saveFeeTemplate", {
                        classId,
                        sessionId: currentSession?.id,
                        name: tplName,
                        dueDay: Number(tplDue),
                        lateKind: tplLate,
                        lateAmount: Number(tplAmount),
                        lines: tplLines
                          .split("\n")
                          .map((row) => row.trim())
                          .filter(Boolean)
                          .map((row) => {
                            const [label, amount] = row.split(",");
                            return { label: (label || "Line").trim(), kind: "FLAT", amount: Number(amount || 0) };
                          }),
                      });
                      toast.show("Template saved.");
                      await reload();
                    } catch (e) {
                      toast.show(e instanceof Error ? e.message : "Could not save.");
                    }
                  }}
                >
                  Save template
                </Button>
              ) : null}
              {can(user, "fees.collect") ? (
                <Button
                  variant="ghost"
                  onPress={async () => {
                    try {
                      await act(token, "issueClassFees", {
                        classId,
                        year: new Date().getFullYear(),
                        month: new Date().getMonth(),
                      });
                      toast.show("This month issued.");
                      await reload();
                    } catch (e) {
                      toast.show(e instanceof Error ? e.message : "Could not issue.");
                    }
                  }}
                >
                  Issue this month
                </Button>
              ) : null}
            </View>
          )}
          {can(user, "fees.collect") ? (
            <View className="mt-6 gap-3 border-t border-ink-100 pt-4">
              <Text className="text-sm font-medium text-ink-900">One-off invoice</Text>
              <View className="flex-row flex-wrap gap-2">
                {people.slice(0, 20).map((s) => (
                  <Chip key={s.id} label={s.name} active={invoiceStudent === s.id} onPress={() => setInvoiceStudent(s.id)} />
                ))}
              </View>
              <Field label="Title">
                <Input value={invoiceTitle} onChangeText={setInvoiceTitle} />
              </Field>
              <Field label="Amount">
                <Input keyboardType="number-pad" value={invoiceAmount} onChangeText={setInvoiceAmount} />
              </Field>
              <Button
                onPress={async () => {
                  const student = people.find((s) => s.id === invoiceStudent);
                  if (!student) {
                    toast.show("Pick a student.");
                    return;
                  }
                  try {
                    await act(token, "createInvoice", {
                      studentId: student.id,
                      classId: student.classId,
                      title: invoiceTitle,
                      amount: Number(invoiceAmount),
                      dueDate: new Date().toISOString().slice(0, 10),
                    });
                    toast.show("Invoice added.");
                    await reload();
                  } catch (e) {
                    toast.show(e instanceof Error ? e.message : "Could not add.");
                  }
                }}
              >
                Add invoice
              </Button>
            </View>
          ) : null}
        </Card>
      ) : null}
      {tab === "due" && filter === "overdue" ? (
        <View className="mb-4 gap-2">
          <Text className="text-sm text-ink-700">Students with at least one month past the due date.</Text>
          {can(user, "fees.remind") && overdueStudents.length ? (
            <Button onPress={remindOverdue}>Remind overdue</Button>
          ) : null}
        </View>
      ) : tab === "due" && classId === "all" ? (
        <Text className="mb-4 text-sm text-ink-700">
          Totals only. Pick a class to run missing months. Open a student on Students to collect.
        </Text>
      ) : tab === "due" && can(user, "fees.collect") ? (
        <View className="mb-4">
          <Button onPress={runFees}>Run fees now</Button>
        </View>
      ) : null}
      {tab === "due" ? <Text className="mb-3 font-semibold text-ink-900">Pending</Text> : null}
      {tab !== "due" ? null : !students.length ? (
        <Empty
          title="Nothing pending"
          body={
            filter === "overdue"
              ? "Nothing overdue."
              : classId === "all"
                ? "Nothing pending. Pick a class and run fees now."
                : "No bills for this class yet. Run fees now."
          }
        />
      ) : (
        <View className="gap-3">
          {students.map((s) => {
            const months = monthsOf(s);
            const overdue = s.overdueCount || 0;
            return (
              <Pressable
                key={s.id}
                onPress={() => router.push({ pathname: "/people", params: { student: s.id } } as never)}
              >
                <Card className="p-5">
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
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
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
