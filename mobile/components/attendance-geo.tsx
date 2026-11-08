import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Dimensions, Modal as RnModal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { createFixWatcher, distanceMeters, formatDistance, GEO_MAX_ACCURACY_M, GEO_RADIUS_CHOICES, readFix, waitForFix, type Fix, type FixWatcher, type StaffAttendanceSetup } from "../lib/attendance-geo";
import { act } from "../lib/mutate";
import { useOptionalRecord } from "../lib/record";
import { closingMinute, hms, teacherPeriodsOn, useFocusDay } from "../lib/class-focus";
import { useRouter } from "expo-router";
import { Badge, Button, Segmented } from "./ui";

type Note = { tone: "success" | "warn" | "danger"; title: string; body: string };

function NotePanel({ note }: { note: Note }) {
  const box = note.tone === "success" ? "border-green-200 bg-green-50" : note.tone === "warn" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50";
  const ink = note.tone === "success" ? "text-green-900" : note.tone === "warn" ? "text-amber-900" : "text-red-900";
  const icon = note.tone === "success" ? "checkmark-circle" : note.tone === "warn" ? "alert-circle" : "close-circle";
  const color = note.tone === "success" ? "#166534" : note.tone === "warn" ? "#92400e" : "#b91c1c";
  return (
    <View testID="geo-note" className={`flex-row items-start gap-2 rounded-md border p-3 ${box}`}>
      <Ionicons name={icon} size={18} color={color} />
      <View className="min-w-0 flex-1">
        <Text className={`text-sm font-semibold ${ink}`}>{note.title}</Text>
        {note.body ? <Text className={`mt-1 text-xs leading-5 ${ink}`}>{note.body}</Text> : null}
      </View>
    </View>
  );
}

function clock(value?: string) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Could not mark attendance.";
}

const BLUE = "#2855F6";
const ORANGE = "#EA580C";

type Phase = "idle" | "locating" | "done" | "error" | "leaving";
type Marked = { ok: true; inAt: string; outAt: string; checkedOut: boolean };

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function hhmmNow(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function minutesOf(t: string) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** "6h 12m" between in and out (or now). */
function hoursText(inAt: string, until: string) {
  const a = minutesOf(inAt);
  const b = minutesOf(until);
  if (a == null || b == null || b < a) return "—";
  const m = b - a;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/**
 * One mark (in or out) from the phone: GPS (warm watcher when there is one), then the server.
 * `onStep` says what is happening, for the button text.
 */
async function markHere(token: string | null, watcher: FixWatcher | null, onStep: (step: "gps" | "check") => void, earlyReason?: string) {
  onStep("gps");
  const fix = Platform.OS === "web" || !watcher ? await readFix() : await waitForFix(watcher);
  onStep("check");
  return act<Marked>(token, "markStaffAttendanceHere", earlyReason ? { ...fix, earlyReason } : fix);
}

/** Small floating message with a clear tone (the shared Toast guesses tone from words). */
function CheckToast({ msg, onDone }: { msg: { tone: "ok" | "bad"; text: string } | null; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, msg.tone === "ok" ? 2600 : 4500);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  if (!msg) return null;
  const ok = msg.tone === "ok";
  return (
    <RnModal visible transparent animationType="fade" onRequestClose={onDone}>
      <View pointerEvents="box-none" className="flex-1 items-center justify-end px-4" style={{ paddingBottom: Math.max(insets.bottom, 20) + 64 }}>
        <View accessibilityRole="alert" className="w-full max-w-sm flex-row items-center gap-3 rounded-2xl bg-white px-4 py-3.5" style={{ shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, elevation: 10 }}>
          <View className={`h-8 w-8 items-center justify-center rounded-full ${ok ? "bg-green-600" : "bg-red-600"}`}>
            <Ionicons name={ok ? "checkmark" : "close"} size={18} color="#fff" />
          </View>
          <Text className={`min-w-0 flex-1 text-[14px] font-semibold ${ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} onPress={onDone}>
            <Ionicons name="close" size={20} color="#64748B" />
          </Pressable>
        </View>
      </View>
    </RnModal>
  );
}

const EARLY_REASONS: { label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: "Not well", icon: "medkit-outline" },
  { label: "Family / emergency", icon: "home-outline" },
  { label: "School work outside", icon: "business-outline" },
  { label: "Other", icon: "create-outline" },
];

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={onPress}
      className={`rounded-full border px-3.5 py-2 ${on ? "border-[#D97706] bg-amber-50" : "border-ink-200 bg-white"}`}
    >
      <Text className={`text-[14px] font-semibold ${on ? "text-amber-800" : "text-ink-800"}`}>{label}</Text>
    </Pressable>
  );
}

/** Checking out before the school day is over: classes left, why (four tiles), one button. */
function LeavingEarly({
  classesLeft,
  reason,
  note,
  busy,
  onReason,
  onNote,
  onConfirm,
  onLeave,
  onCancel,
}: {
  classesLeft: { key: string; classLabel: string; subject: string; start: number }[];
  reason: string;
  note: string;
  busy: string;
  onReason: (r: string) => void;
  onNote: (t: string) => void;
  onConfirm: () => void;
  onLeave: () => void;
  onCancel: () => void;
}) {
  const ready = Boolean(reason) && (reason !== "Other" || note.trim().length > 1);
  const at = (m: number) => clock(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return (
    <View testID="leaving-early" className="gap-4">
      <View className="flex-row items-center gap-3">
        <View className="h-12 w-12 items-center justify-center rounded-full bg-orange-100">
          <Ionicons name="home" size={24} color={ORANGE} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[20px] font-bold text-ink-900">Going home early?</Text>
          <Text className="text-[13px] text-ink-500">Tell the school why. Your classes will be covered.</Text>
        </View>
      </View>
      {classesLeft.length ? (
        <View className="gap-1.5 rounded-2xl bg-ink-50 px-3 py-2.5">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{`Still left today · ${classesLeft.length}`}</Text>
          {classesLeft.slice(0, 3).map((c) => (
            <View key={c.key} className="flex-row items-center gap-2">
              <Text className="w-[72px] text-[13px] font-semibold tabular-nums text-ink-700">{at(c.start)}</Text>
              <Text className="min-w-0 flex-1 text-[14px] text-ink-900" numberOfLines={1}>{`${c.classLabel} ${c.subject}`.trim()}</Text>
            </View>
          ))}
          {classesLeft.length > 3 ? <Text className="text-[12px] text-ink-500">{`+ ${classesLeft.length - 3} more`}</Text> : null}
        </View>
      ) : null}
      <View className="flex-row flex-wrap justify-between gap-y-2">
        {EARLY_REASONS.map((r) => {
          const on = reason === r.label;
          return (
            <Pressable
              key={r.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={r.label}
              onPress={() => onReason(r.label)}
              className={`w-[48.5%] flex-row items-center gap-2 rounded-2xl border px-3 py-3 ${on ? "border-[#EA580C] bg-orange-50" : "border-ink-200 bg-white"}`}
            >
              <Ionicons name={r.icon} size={18} color={on ? ORANGE : "#475569"} />
              <Text className={`min-w-0 flex-1 text-[13px] font-semibold ${on ? "text-orange-800" : "text-ink-800"}`}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {reason === "Other" ? (
        <TextInput
          value={note}
          onChangeText={onNote}
          placeholder="Write a short reason"
          placeholderTextColor="#94A3B8"
          accessibilityLabel="Reason for leaving early"
          className="rounded-2xl border border-ink-200 bg-white px-4 py-3 text-[15px] text-ink-900"
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check out and go home"
        accessibilityState={{ disabled: !ready || Boolean(busy) }}
        disabled={!ready || Boolean(busy)}
        onPress={onConfirm}
        className={`h-14 flex-row items-center justify-center gap-2 rounded-2xl ${ready ? "" : "opacity-40"}`}
        style={{ backgroundColor: ORANGE }}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="exit-outline" size={22} color="#fff" />}
        <Text className="text-[16px] font-bold text-white">{busy || (ready ? "Check out & go home" : "Choose a reason")}</Text>
      </Pressable>
      <View className="flex-row items-center justify-between">
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8}>
          <Text className="text-[14px] font-semibold text-ink-500">Not now</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onLeave} hitSlop={8}>
          <Text className="text-[14px] font-semibold text-[#1F45C7]">Apply half-day leave instead</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Break (with a reason) and Resume, for the phone's school day. */
function BreakControls({
  status,
  reason,
  since,
  now,
  inClass,
  breakAllowed,
  reasons,
  onTake,
  onResume,
}: {
  status: "focus" | "break" | "ended";
  reason: string;
  since: number;
  now: number;
  inClass: string;
  breakAllowed: boolean;
  reasons: string[];
  onTake: (reason: string) => void;
  onResume: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  if (status === "break") {
    return (
      <View testID="on-break" className="flex-row items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3">
        <Ionicons name="cafe" size={22} color="#B45309" />
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-amber-900">{`On break · ${reason}`}</Text>
          <Text className="text-[13px] tabular-nums text-amber-800">{hms(now - since)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Resume" onPress={onResume} className="rounded-xl px-5 py-2.5" style={{ backgroundColor: BLUE }}>
          <Text className="text-[15px] font-bold text-white">Resume</Text>
        </Pressable>
      </View>
    );
  }
  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Take a break"
        accessibilityState={{ disabled: !breakAllowed }}
        disabled={!breakAllowed}
        onPress={() => setOpen(true)}
        className={`flex-row items-center gap-3 rounded-2xl border border-ink-200 bg-white px-4 py-3 ${breakAllowed ? "" : "opacity-60"}`}
      >
        <Ionicons name="cafe-outline" size={20} color="#475569" />
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-ink-900">Take a break</Text>
          {!breakAllowed ? <Text className="text-[12px] text-ink-500">{`${inClass || "A class"} is on now · after it`}</Text> : null}
        </View>
        {breakAllowed ? <Ionicons name="chevron-forward" size={18} color="#94A3B8" /> : null}
      </Pressable>
    );
  }
  const ready = Boolean(pick) && (pick !== "Other" || note.trim().length > 1);
  return (
    <View testID="break-reasons" className="gap-3 rounded-2xl border border-ink-200 bg-white p-3.5">
      <Text className="text-[13px] font-semibold text-ink-700">Break for</Text>
      <View className="flex-row flex-wrap gap-2">
        {reasons.map((r) => (
          <Chip key={r} label={r} on={pick === r} onPress={() => setPick(r)} />
        ))}
      </View>
      {pick === "Other" ? (
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Write a short reason"
          placeholderTextColor="#94A3B8"
          accessibilityLabel="Break reason"
          className="rounded-xl border border-ink-200 px-3 py-2.5 text-[15px] text-ink-900"
        />
      ) : null}
      <View className="flex-row gap-2">
        <Pressable accessibilityRole="button" onPress={() => setOpen(false)} className="flex-1 items-center rounded-xl border border-ink-200 py-2.5">
          <Text className="text-[15px] font-semibold text-ink-700">Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start break"
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          onPress={() => {
            onTake(pick === "Other" ? note.trim() || "Other" : pick);
            setOpen(false);
            setPick("");
            setNote("");
          }}
          className={`flex-1 items-center rounded-xl py-2.5 ${ready ? "" : "opacity-40"}`}
          style={{ backgroundColor: "#D97706" }}
        >
          <Text className="text-[15px] font-bold text-white">Start break</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The teacher's own day, as a sheet from the bottom (after checking in; checking in itself happens on
 * the dashboard tile): In / Out / hours, Break and Resume, and Check out — which, before the school day
 * is over, asks why. Checking out ends the phone's school day. The server checks distance, GPS
 * accuracy and fake location.
 */
export function MarkHereSheet({
  open,
  token,
  today,
  onClose,
  onDone,
}: {
  open: boolean;
  token: string | null;
  today?: { marked?: boolean; inAt?: string; outAt?: string; outLog?: { at: string }[] };
  onClose: () => void;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const now = useNow(15_000);
  const record = useOptionalRecord();
  const router = useRouter();
  const focus = useFocusDay();
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState<"gps" | "check">("gps");
  const [done, setDone] = useState<Marked | null>(null);
  const [error, setError] = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveNote, setLeaveNote] = useState("");
  const watcher = useRef<FixWatcher | null>(null);
  const checkedIn = Boolean(today?.marked && today?.inAt);
  const phoneDay = focus?.enabled && focus.day && focus.day.status !== "ended" ? focus.day : null;

  // Start GPS as soon as the sheet opens (only if already allowed), so the tap is usually instant.
  useEffect(() => {
    if (!open || Platform.OS === "web") return;
    const w = createFixWatcher();
    watcher.current = w;
    void w.start(false).catch(() => undefined);
    return () => {
      w.stop();
      watcher.current = null;
    };
  }, [open]);

  // Before the school day ends (teachers): Check out asks why, and shows the classes still left today.
  const data = record?.data;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const myPeriods =
    data?.kind === "TEACHER" ? teacherPeriodsOn(now, data.timetable as never, (data as { dayChanges?: never }).dayChanges) : [];
  const classesLeft = myPeriods.filter((p) => p.end > nowMin);
  const closes = data?.kind === "TEACHER" ? closingMinute(data.timetable as never, data.schoolDay?.endsAt) : 0;
  const earlyNow = data?.kind === "TEACHER" && nowMin < closes;

  const inAt = done?.inAt || today?.inAt || "";
  const outAt = done?.outAt || today?.outAt || "";
  const isIn = checkedIn || Boolean(done);
  const locating = phase === "locating";
  const leaveWhy = () => (leaveReason === "Other" ? leaveNote.trim() || "Other" : leaveReason);

  function close() {
    setPhase("idle");
    setDone(null);
    setError("");
    setLeaveReason("");
    setLeaveNote("");
    onClose();
  }

  async function mark(earlyReason?: string) {
    setPhase("locating");
    setError("");
    try {
      const res = await markHere(token, watcher.current, setStep, earlyReason);
      setDone(res);
      setPhase("done");
      // Checking out ends the phone's school day (the guard goes off), even in the middle of a class.
      if (res.checkedOut) focus?.goHome(earlyReason);
      onDone();
      setTimeout(close, 1600);
    } catch (e) {
      setError(errorText(e));
      setPhase(earlyReason ? "leaving" : "error");
    }
  }

  const busyText = locating ? (step === "gps" ? "Finding your location…" : "Checking you're at school…") : "";
  const status = !isIn
    ? { icon: "time-outline" as const, bg: "bg-ink-100", color: "#475569", title: "Not checked in yet", sub: "Check in once you're inside school." }
    : outAt
      ? { icon: "moon" as const, bg: "bg-violet-100", color: "#6D28D9", title: "Done for today", sub: `In ${clock(inAt)} · Out ${clock(outAt)}` }
      : { icon: "checkmark" as const, bg: "bg-green-100", color: "#15803D", title: "You're checked in", sub: `Since ${clock(inAt)}` };

  const body =
    phase === "leaving" ? (
      <LeavingEarly
        classesLeft={classesLeft}
        reason={leaveReason}
        note={leaveNote}
        busy={busyText}
        onReason={setLeaveReason}
        onNote={setLeaveNote}
        onConfirm={() => void mark(leaveWhy())}
        onLeave={() => {
          close();
          router.push("/leave" as never);
        }}
        onCancel={() => setPhase("idle")}
      />
    ) : phase === "done" && done ? (
      <View testID="attendance-done" className="items-center gap-2 py-6">
        <View className={`h-16 w-16 items-center justify-center rounded-full ${done.checkedOut ? "bg-violet-100" : "bg-green-100"}`}>
          <Ionicons name={done.checkedOut ? "moon" : "checkmark"} size={34} color={done.checkedOut ? "#6D28D9" : "#15803D"} />
        </View>
        <Text className="text-[20px] font-bold text-ink-900">{done.checkedOut ? `Checked out at ${clock(done.outAt)}` : `Checked in at ${clock(done.inAt)}`}</Text>
        <Text className="text-[14px] text-ink-500">{done.checkedOut ? "See you tomorrow!" : "Have a great day."}</Text>
      </View>
    ) : (
      <View className="gap-3">
        <View className="flex-row items-center gap-3">
          <View className={`h-11 w-11 items-center justify-center rounded-full ${status.bg}`}>
            <Ionicons name={status.icon} size={22} color={status.color} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[18px] font-bold text-ink-900">{status.title}</Text>
            <Text className="text-[13px] text-ink-500">{status.sub}</Text>
          </View>
        </View>

        {isIn ? (
          <View testID="attendance-timeline" className="flex-row rounded-2xl bg-ink-50 py-3">
            {[
              ["In", clock(inAt) || "—", "#047857"],
              ["Out", outAt ? clock(outAt) : "—", "#C2410C"],
              ["Hours", inAt ? hoursText(inAt, outAt || hhmmNow(now)) : "—", "#1D4ED8"],
            ].map(([label, value, tint]) => (
              <View key={label} className="flex-1 items-center">
                <Text className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: tint }}>
                  {label}
                </Text>
                <Text className="mt-0.5 text-[16px] font-bold tabular-nums text-ink-900">{value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {focus?.enabled && isIn && !focus.guardAllowed && phoneDay ? (
          <Pressable accessibilityRole="button" onPress={focus.allowGuard} className="flex-row items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3">
            <Ionicons name="shield-half-outline" size={20} color="#B45309" />
            <Text className="min-w-0 flex-1 text-[13px] text-amber-900">Allow “Display over other apps” so your school day works.</Text>
            <Text className="text-[13px] font-bold text-amber-800">Allow</Text>
          </Pressable>
        ) : null}

        {phoneDay && isIn && !outAt && !locating ? (
          <BreakControls
            status={phoneDay.status}
            reason={phoneDay.breakReason || ""}
            since={phoneDay.since}
            now={focus?.now ?? Date.now()}
            inClass={focus?.inClass ? `${focus.inClass.classLabel} ${focus.inClass.subject}`.trim() : ""}
            breakAllowed={!focus?.inClass || Boolean(focus?.breakInClass)}
            reasons={focus?.reasons ?? []}
            onTake={(r) => focus?.takeBreak(r)}
            onResume={() => focus?.resume()}
          />
        ) : null}

        {error ? (
          <View className="flex-row items-start gap-2 rounded-2xl bg-red-50 px-4 py-3">
            <Ionicons name="alert-circle" size={18} color="#B91C1C" />
            <Text className="min-w-0 flex-1 text-[13px] text-red-800">{error}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isIn ? "Check out here" : "Check in here"}
          accessibilityState={{ disabled: locating, busy: locating }}
          disabled={locating}
          onPress={() => {
            if (isIn && !outAt && earlyNow) setPhase("leaving");
            else void mark();
          }}
          className="mt-1 h-14 flex-row items-center justify-center gap-2.5 rounded-2xl active:opacity-90"
          style={{ backgroundColor: isIn ? ORANGE : BLUE }}
        >
          {locating ? <ActivityIndicator color="#fff" /> : <Ionicons name={isIn ? "exit-outline" : "enter-outline"} size={22} color="#fff" />}
          <Text className="text-[16px] font-bold text-white">{busyText || (isIn ? (outAt ? "Check out again" : "Check out") : "Check in")}</Text>
        </Pressable>
      </View>
    );

  return (
    <RnModal visible={open} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View className="flex-1 justify-end">
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} className="absolute inset-0 bg-black/40" />
        <View testID="mark-here-sheet" className="rounded-t-3xl bg-white px-5 pt-2.5" style={{ paddingBottom: insets.bottom + 18 }}>
          <View className="mb-3 h-1.5 w-12 self-center rounded-full bg-ink-200" />
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: Dimensions.get("window").height * 0.85 }}>
            {body}
          </ScrollView>
        </View>
      </View>
    </RnModal>
  );
}

function place(geo: { lat: number; lng: number }) {
  return `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`;
}

function MethodRow({
  icon,
  title,
  body,
  on,
  soon,
  onSelect,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  on?: boolean;
  soon?: boolean;
  onSelect?: () => void;
  children?: ReactNode;
}) {
  return (
    <View className={`gap-3 rounded-xl border p-4 ${on ? "border-clay-500 bg-white" : "border-ink-200 bg-white"} ${soon ? "opacity-60" : ""}`}>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={title}
        accessibilityState={{ checked: Boolean(on), disabled: soon }}
        disabled={soon}
        onPress={() => onSelect?.()}
        className="flex-row items-center gap-3"
      >
        <View className="h-10 w-10 items-center justify-center rounded-full bg-ink-50">
          <Ionicons name={icon} size={20} color="#0f2744" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold text-ink-900">{title}</Text>
          <Text className="mt-0.5 text-xs leading-4 text-ink-500">{body}</Text>
        </View>
        {soon ? (
          <Badge>Coming soon</Badge>
        ) : (
          <View className={`h-5 w-5 items-center justify-center rounded-full border-2 ${on ? "border-clay-500" : "border-ink-300"}`}>
            {on ? <View className="h-2.5 w-2.5 rounded-full bg-clay-500" /> : null}
          </View>
        )}
      </Pressable>
      {on && children ? <View className="gap-3 border-t border-ink-100 pt-3">{children}</View> : null}
    </View>
  );
}

/**
 * Settings → Staff attendance: which ways the school takes it. Only what is on shows up in the app
 * (a QR-only school never asks staff for their location).
 */
export function StaffAttendanceSettings({
  token,
  setup,
  canEdit,
  onSaved,
}: {
  token: string | null;
  setup: StaffAttendanceSetup;
  canEdit: boolean;
  onSaved: (message: string) => void;
}) {
  const [draft, setDraft] = useState<StaffAttendanceSetup>(setup);
  const [busy, setBusy] = useState<"" | "point" | "test" | "save">("");
  const [note, setNote] = useState<Note | null>(null);
  const hasPoint = Boolean(draft.lat || draft.lng);
  const changed = JSON.stringify(draft) !== JSON.stringify(setup);

  async function withFix(kind: "point" | "test", use: (fix: Fix) => void) {
    setBusy(kind);
    setNote(null);
    try {
      use(await readFix());
    } catch (error) {
      setNote({ tone: "danger", title: "No location", body: errorText(error) });
    } finally {
      setBusy("");
    }
  }

  function takePoint() {
    void withFix("point", (fix) => {
      if (fix.mocked) {
        setNote({ tone: "danger", title: "Fake location is on", body: "Turn it off and try again." });
        return;
      }
      setDraft((d) => ({ ...d, lat: fix.lat, lng: fix.lng }));
      setNote(
        fix.accuracy > GEO_MAX_ACCURACY_M
          ? { tone: "warn", title: `Rough fix (±${fix.accuracy} m)`, body: "Stand in the open middle of the school, wait a moment and take it again." }
          : { tone: "success", title: `School point taken (±${fix.accuracy} m)`, body: "Save to use it." }
      );
    });
  }

  function testHere() {
    void withFix("test", (fix) => {
      const m = Math.round(distanceMeters(draft, fix));
      const ok = m <= draft.radiusM && fix.accuracy <= GEO_MAX_ACCURACY_M && !fix.mocked;
      setNote(
        ok
          ? { tone: "success", title: `${formatDistance(m)} from the school point`, body: `Marking works here (±${fix.accuracy} m).` }
          : {
              tone: "warn",
              title: `${formatDistance(m)} from the school point`,
              body:
                fix.accuracy > GEO_MAX_ACCURACY_M
                  ? `GPS is rough here (±${fix.accuracy} m), so marking would be refused.`
                  : `Outside ${draft.radiusM} m: marking would be refused here. Pick a bigger distance if this is inside the school.`,
            }
      );
    });
  }

  async function save() {
    setBusy("save");
    setNote(null);
    try {
      await act(token, "saveStaffAttendanceSetup", draft);
      onSaved("Staff attendance saved.");
    } catch (error) {
      setNote({ tone: "danger", title: "Not saved", body: errorText(error) });
    } finally {
      setBusy("");
    }
  }

  const choose = (key: "qr" | "location") => {
    if (!canEdit) return;
    setNote(null);
    setDraft((d) => ({ ...d, qr: key === "qr", location: key === "location" }));
  };

  return (
    <View testID="staff-attendance-settings" className="gap-3">
      <Text className="text-sm text-ink-600">Pick one way staff mark their attendance. Only that way shows in the app. The office can always mark by hand on Staff → Today.</Text>
      <MethodRow icon="qr-code-outline" title="QR code" body="Staff show their QR from the app; the office scans it at the desk." on={draft.qr} onSelect={() => choose("qr")} />
      <MethodRow
        icon="location-outline"
        title="Location"
        body="Staff tap “Check in” on their phone. Works only inside the school."
        on={draft.location}
        onSelect={() => choose("location")}
      >
        <View className="gap-2">
          <Text className="text-sm font-semibold text-ink-900">School point</Text>
          <Text testID="geo-point" className="text-xs text-ink-600">
            {hasPoint ? place(draft) : "Not set. Stand in the middle of the school and take it from your phone."}
          </Text>
          {canEdit ? (
            <Button variant="ghost" accessibilityLabel="Use my current location" disabled={busy !== ""} onPress={takePoint}>
              {busy === "point" ? "Finding location…" : hasPoint ? "Take it again from here" : "Use my current location"}
            </Button>
          ) : null}
          {Platform.OS === "web" ? <Text className="text-xs text-amber-800">A laptop's location can be far off. Take the point from a phone at school.</Text> : null}
        </View>
        <View className="gap-2">
          <Text className="text-sm font-semibold text-ink-900">Counts as at school within</Text>
          <Segmented
            options={GEO_RADIUS_CHOICES.map((m) => ({ id: String(m), label: `${m} m` }))}
            value={String(draft.radiusM)}
            onChange={(id) => canEdit && setDraft((d) => ({ ...d, radiusM: Number(id) }))}
          />
          <Text className="text-xs text-ink-500">150 m suits most schools. Bigger campus: 200–300 m.</Text>
        </View>
        {hasPoint ? (
          <Button variant="ghost" accessibilityLabel="Test here" disabled={busy !== ""} onPress={testHere}>
            {busy === "test" ? "Checking…" : "Test here (walk to the gate, staff room…)"}
          </Button>
        ) : null}
      </MethodRow>
      <MethodRow icon="card-outline" title="RFID card" body="Staff tap their ID card on a reader at the gate." soon />
      <MethodRow icon="finger-print-outline" title="Fingerprint" body="Staff put a finger on a biometric device at the gate." soon />
      {note ? <NotePanel note={note} /> : null}
      {canEdit ? (
        <View className="flex-row justify-end">
          <Button
            accessibilityLabel="Save staff attendance"
            disabled={busy !== "" || !changed || (draft.location && !hasPoint)}
            onPress={() => void save()}
          >
            {busy === "save" ? "Saving…" : draft.location && !hasPoint ? "Set the school point to save" : "Save"}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The teacher's own check-in, for schools that take it by location: a round tile in the dashboard's quick
 * actions, a small header button (office staff), or a plain button on wider screens.
 * Not checked in yet: a tap checks in right there (spinner on the tile, then a short message).
 * Checked in: a tap opens MarkHereSheet (Check out, Break / Resume).
 */
export function MarkHereButton({
  token,
  today,
  tile,
  icon,
  disabled,
  onDone,
}: {
  token: string | null;
  today?: { marked?: boolean; inAt?: string; outAt?: string; outLog?: { at: string }[] };
  tile?: boolean;
  /** Small round button for the phone header (office staff). */
  icon?: boolean;
  disabled?: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [justIn, setJustIn] = useState("");
  const checkedIn = Boolean((today?.marked && today?.inAt) || justIn);
  const onBreak = useFocusDay()?.day?.status === "break";
  const dayDone = Boolean(checkedIn && today?.outAt);
  // "Check in" is the teacher's own attendance (class attendance keeps the word "Attendance").
  const tileText = busy ? "Checking in…" : onBreak ? "On break" : dayDone ? "Done" : checkedIn ? "Check out" : "Check in";
  const inAt = today?.inAt || justIn;
  const label = onBreak
    ? "My check in. On break"
    : dayDone
      ? `My check in. Done, out at ${clock(today?.outAt)}`
      : checkedIn
        ? `My check in. In at ${clock(inAt)}`
        : "My check in. Not checked in yet";

  async function checkInNow() {
    setBusy(true);
    const watcher = Platform.OS === "web" ? null : createFixWatcher();
    try {
      const res = await markHere(token, watcher, () => undefined);
      setJustIn(res.inAt);
      setMsg({ tone: "ok", text: `Checked in at ${clock(res.inAt)}` });
      onDone();
    } catch (e) {
      setMsg({ tone: "bad", text: errorText(e) });
    } finally {
      watcher?.stop();
      setBusy(false);
    }
  }

  const press = () => {
    if (busy) return;
    if (checkedIn) setOpen(true);
    else void checkInNow();
  };

  return (
    <>
      {icon ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: disabled || busy, busy }}
          disabled={disabled || busy}
          onPress={press}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          {busy ? <ActivityIndicator size="small" color="#0f2744" /> : <Ionicons name="location-outline" size={21} color="#0f2744" />}
          {busy ? null : checkedIn ? (
            <View className="absolute right-1 top-1 h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white bg-[#22C55E]" />
          ) : (
            <View className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#F59E0B]" />
          )}
        </Pressable>
      ) : tile ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: disabled || busy, busy }}
          disabled={disabled || busy}
          onPress={press}
          className={`flex-1 items-center gap-1.5 active:opacity-70 ${disabled ? "opacity-50" : ""}`}
        >
          <View className={`h-12 w-12 items-center justify-center rounded-2xl ${checkedIn ? "bg-[#EEF3FF]" : "bg-[#2855F6]"}`}>
            {busy ? (
              <ActivityIndicator color={checkedIn ? "#1F45C7" : "#fff"} />
            ) : (
              <Ionicons name={checkedIn ? (dayDone ? "moon-outline" : "exit-outline") : "enter-outline"} size={22} color={checkedIn ? "#1F45C7" : "#fff"} />
            )}
            {busy ? null : onBreak ? (
              <View className="absolute -right-1 -top-1 h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[#D97706]">
                <Ionicons name="cafe" size={10} color="#fff" />
              </View>
            ) : checkedIn ? (
              <View className="absolute -right-1 -top-1 h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[#22C55E]">
                <Ionicons name="checkmark" size={11} color="#fff" />
              </View>
            ) : null}
          </View>
          <Text className={`text-xs ${checkedIn ? "font-medium text-ink-800" : "font-bold text-[#1F45C7]"}`}>{tileText}</Text>
        </Pressable>
      ) : (
        <Button variant="ghost" accessibilityLabel={label} disabled={disabled || busy} onPress={press}>
          {busy ? "Checking in…" : checkedIn ? `✓ In at ${clock(inAt)}` : "📍 Check in"}
        </Button>
      )}
      <MarkHereSheet open={open} token={token} today={justIn && !today?.inAt ? { ...today, marked: true, inAt: justIn } : today} onClose={() => setOpen(false)} onDone={onDone} />
      <CheckToast msg={msg} onDone={() => setMsg(null)} />
    </>
  );
}
