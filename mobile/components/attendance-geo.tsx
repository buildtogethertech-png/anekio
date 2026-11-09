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

const EARLY_TINTS: Record<string, { bg: string; fg: string }> = {
  "Not well": { bg: "#FFE8EC", fg: "#BE123C" },
  "Family / emergency": { bg: "#FEF3E2", fg: "#B45309" },
  "School work outside": { bg: "#EAF0FF", fg: "#1F45C7" },
  Other: { bg: "#F1F5F9", fg: "#475569" },
};

/** Checking out before the school day is over: when the day ends, classes left, why (four tiles), one button. */
function LeavingEarly({
  classesLeft,
  endsAt,
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
  /** Minute of the day the school day ends (0 = unknown). */
  endsAt: number;
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
      <View className="items-center pt-1">
        <View className="h-[72px] w-[72px] items-center justify-center rounded-full bg-orange-50">
          <View className="h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: ORANGE }}>
            <Ionicons name="home" size={26} color="#fff" />
          </View>
        </View>
        <Text className="mt-3 text-[22px] font-bold text-ink-900">Going home early?</Text>
        <Text className="mt-1 text-center text-[14px] leading-5 text-ink-500">
          {endsAt > 0 ? `School ends at ${at(endsAt)}. ` : ""}Pick a reason. The office will arrange cover for your classes.
        </Text>
      </View>

      {classesLeft.length ? (
        <View className="rounded-2xl border border-ink-200 bg-white px-3.5 py-3">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-[13px] font-semibold text-ink-700">Your classes left today</Text>
            <View className="rounded-full bg-orange-50 px-2 py-0.5">
              <Text className="text-[12px] font-bold text-orange-700">{classesLeft.length}</Text>
            </View>
          </View>
          <View className="gap-2">
            {classesLeft.slice(0, 3).map((c) => (
              <View key={c.key} className="flex-row items-center gap-2.5">
                <View className="w-[78px] items-center rounded-lg bg-[#EEF3FF] py-1">
                  <Text className="text-[12px] font-semibold tabular-nums text-[#1F45C7]">{at(c.start)}</Text>
                </View>
                <Text className="min-w-0 flex-1 text-[14px] font-medium text-ink-900" numberOfLines={1}>{`${c.classLabel} ${c.subject}`.trim()}</Text>
              </View>
            ))}
          </View>
          {classesLeft.length > 3 ? <Text className="mt-2 text-[12px] text-ink-500">{`+ ${classesLeft.length - 3} more`}</Text> : null}
        </View>
      ) : null}

      <View className="gap-2">
        <Text className="text-[13px] font-semibold text-ink-700">Why are you leaving?</Text>
        <View className="flex-row flex-wrap justify-between gap-y-2.5">
          {EARLY_REASONS.map((r) => {
            const on = reason === r.label;
            const tint = EARLY_TINTS[r.label] ?? EARLY_TINTS.Other;
            return (
              <Pressable
                key={r.label}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={r.label}
                onPress={() => onReason(r.label)}
                className="w-[48.5%] flex-row items-center gap-2.5 rounded-2xl bg-white px-3 py-3"
                style={{ borderWidth: on ? 2 : 1, borderColor: on ? ORANGE : "#E2E8F0", backgroundColor: on ? "#FFF7ED" : "#FFFFFF" }}
              >
                <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: tint.bg }}>
                  <Ionicons name={r.icon} size={18} color={tint.fg} />
                </View>
                <Text className="min-w-0 flex-1 text-[13px] font-semibold leading-4 text-ink-900">{r.label}</Text>
                {on ? <Ionicons name="checkmark-circle" size={18} color={ORANGE} /> : null}
              </Pressable>
            );
          })}
        </View>
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
        className="h-14 flex-row items-center justify-center gap-2 rounded-full"
        style={{ backgroundColor: ready ? ORANGE : "#E2E8F0" }}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="exit-outline" size={22} color={ready ? "#fff" : "#94A3B8"} />}
        <Text className="text-[16px] font-bold" style={{ color: ready ? "#fff" : "#64748B" }}>
          {busy || (ready ? "Check out & go home" : "Pick a reason first")}
        </Text>
      </Pressable>
      <View className="flex-row gap-2.5">
        <Pressable accessibilityRole="button" onPress={onCancel} className="h-12 flex-1 items-center justify-center rounded-full border border-ink-200 bg-white">
          <Text className="text-[15px] font-semibold text-ink-700">Not now</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Apply half-day leave instead"
          onPress={onLeave}
          className="h-12 flex-1 flex-row items-center justify-center gap-1.5 rounded-full bg-[#EEF3FF]"
        >
          <Ionicons name="airplane-outline" size={16} color="#1F45C7" />
          <Text className="text-[15px] font-semibold text-[#1F45C7]">Half-day leave</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Why the break (one tap; "Other" asks for a word). */
function BreakPicker({ reasons, onTake, onCancel }: { reasons: string[]; onTake: (reason: string) => void; onCancel: () => void }) {
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const ready = Boolean(pick) && (pick !== "Other" || note.trim().length > 1);
  return (
    <View testID="break-reasons" className="gap-3 rounded-2xl bg-amber-50 p-3.5">
      <Text className="text-[14px] font-semibold text-amber-900">Break for</Text>
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
          className="rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[15px] text-ink-900"
        />
      ) : null}
      <View className="flex-row gap-2">
        <Pressable accessibilityRole="button" onPress={onCancel} className="flex-1 items-center rounded-xl border border-amber-200 bg-white py-2.5">
          <Text className="text-[15px] font-semibold text-ink-700">Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start break"
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          onPress={() => onTake(pick === "Other" ? note.trim() || "Other" : pick)}
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
 * Before Android's "Display over other apps" permission: say plainly what the school day does, what is
 * recorded and who sees it (Play: prominent disclosure and consent for monitoring).
 */
function GuardConsent({ open, onAgree, onCancel }: { open: boolean; onAgree: () => void; onCancel: () => void }) {
  const insets = useSafeAreaInsets();
  const point = (icon: keyof typeof Ionicons.glyphMap, text: string, tint = "#1F45C7") => (
    <View className="flex-row items-start gap-3">
      <View className="mt-0.5 h-8 w-8 items-center justify-center rounded-full bg-ink-50">
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text className="min-w-0 flex-1 text-[14px] leading-5 text-ink-800">{text}</Text>
    </View>
  );
  return (
    <RnModal visible={open} transparent animationType="slide" onRequestClose={onCancel} statusBarTranslucent>
      <View className="flex-1 justify-end">
        <Pressable accessibilityRole="button" accessibilityLabel="Not now" onPress={onCancel} className="absolute inset-0 bg-black/40" />
        <View testID="guard-consent" className="gap-4 rounded-t-3xl bg-white px-5 pt-5" style={{ paddingBottom: insets.bottom + 18 }}>
          <Text className="text-[20px] font-bold text-ink-900">Your school day on this phone</Text>
          {point("lock-closed-outline", "During school hours, other apps are paused while you are not on a break. Anekio, calls and apps opened from Anekio, and breaks stay free.")}
          {point("document-text-outline", "Anekio records when your day starts and ends, your breaks with their reason, and when you leave Anekio. Your school's admin can see this.")}
          {point("eye-off-outline", "Anekio does not read your messages, photos or what you do in other apps.", "#047857")}
          {point("power-outline", "It turns off when you check out, when the school day ends, and on leave days.")}
          <Text className="text-[13px] text-ink-500">Next, Android asks you to let Anekio “display over other apps”.</Text>
          <View className="flex-row gap-2.5">
            <Pressable accessibilityRole="button" onPress={onCancel} className="h-12 flex-1 items-center justify-center rounded-2xl border border-ink-200">
              <Text className="text-[15px] font-semibold text-ink-700">Not now</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="I agree, continue" onPress={onAgree} className="h-12 flex-1 items-center justify-center rounded-2xl" style={{ backgroundColor: BLUE }}>
              <Text className="text-[15px] font-bold text-white">I agree, continue</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </RnModal>
  );
}

/**
 * The teacher's own day, as a sheet from the bottom: Check in; then In / Out / hours, Break and Resume,
 * and Check out — which, before the school day
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
  const [picking, setPicking] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
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
    setPicking(false);
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
        endsAt={closes}
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
          <Pressable accessibilityRole="button" accessibilityLabel="Allow the school day" onPress={() => setConsentOpen(true)} className="flex-row items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3">
            <Ionicons name="shield-half-outline" size={20} color="#B45309" />
            <Text className="min-w-0 flex-1 text-[13px] text-amber-900">Allow “Display over other apps” so your school day works.</Text>
            <Text className="text-[13px] font-bold text-amber-800">Allow</Text>
          </Pressable>
        ) : null}

        {phoneDay?.status === "break" && isIn && !outAt ? (
          <View testID="on-break" className="flex-row items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3">
            <Ionicons name="cafe" size={20} color="#B45309" />
            <Text className="min-w-0 flex-1 text-[15px] font-semibold text-amber-900">{`On break · ${phoneDay.breakReason || ""}`}</Text>
            <Text className="text-[14px] font-semibold tabular-nums text-amber-800">{hms((focus?.now ?? Date.now()) - phoneDay.since)}</Text>
          </View>
        ) : null}

        {picking && phoneDay && phoneDay.status === "focus" ? (
          <BreakPicker
            reasons={focus?.reasons ?? []}
            onTake={(r) => {
              focus?.takeBreak(r);
              setPicking(false);
            }}
            onCancel={() => setPicking(false)}
          />
        ) : null}

        {error ? (
          <View className="flex-row items-start gap-2 rounded-2xl bg-red-50 px-4 py-3">
            <Ionicons name="alert-circle" size={18} color="#B91C1C" />
            <Text className="min-w-0 flex-1 text-[13px] text-red-800">{error}</Text>
          </View>
        ) : null}

        <View className="flex-row gap-2.5">
          {phoneDay && isIn && !outAt && !locating ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={phoneDay.status === "break" ? "Resume" : "Take a break"}
              accessibilityState={{ disabled: phoneDay.status !== "break" && Boolean(focus?.inClass) && !focus?.breakInClass }}
              disabled={phoneDay.status !== "break" && Boolean(focus?.inClass) && !focus?.breakInClass}
              onPress={() => {
                if (phoneDay.status === "break") focus?.resume();
                else setPicking((v) => !v);
              }}
              className={`mt-1 h-14 flex-1 flex-row items-center justify-center gap-2 rounded-2xl active:opacity-90 ${
                phoneDay.status !== "break" && focus?.inClass && !focus?.breakInClass ? "opacity-40" : ""
              }`}
              style={{ backgroundColor: phoneDay.status === "break" ? BLUE : "#D97706" }}
            >
              <Ionicons name={phoneDay.status === "break" ? "play" : "cafe-outline"} size={20} color="#fff" />
              <Text className="text-[16px] font-bold text-white">{phoneDay.status === "break" ? "Resume" : "Break"}</Text>
            </Pressable>
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
            className="mt-1 h-14 flex-1 flex-row items-center justify-center gap-2.5 rounded-2xl active:opacity-90"
            style={{ backgroundColor: isIn ? ORANGE : BLUE }}
          >
            {locating ? <ActivityIndicator color="#fff" /> : <Ionicons name={isIn ? "exit-outline" : "enter-outline"} size={22} color="#fff" />}
            <Text className="text-[16px] font-bold text-white">{busyText || (isIn ? (outAt ? "Check out again" : "Check out") : "Check in")}</Text>
          </Pressable>
        </View>
        {phoneDay && phoneDay.status === "focus" && isIn && !outAt && focus?.inClass && !focus?.breakInClass ? (
          <Text className="text-center text-[12px] text-ink-500">{`${`${focus.inClass.classLabel} ${focus.inClass.subject}`.trim()} is on now · break after it`}</Text>
        ) : null}
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
          <GuardConsent
            open={consentOpen}
            onCancel={() => setConsentOpen(false)}
            onAgree={() => {
              setConsentOpen(false);
              focus?.allowGuard();
            }}
          />
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
 * A tap opens MarkHereSheet: Check in, or Break / Resume and Check out.
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
  const checkedIn = Boolean(today?.marked && today?.inAt);
  const focus = useFocusDay();
  const onBreak = focus?.day?.status === "break";
  const phoneDayOn = Boolean(focus?.enabled && focus.day && focus.day.status !== "ended");
  const dayDone = Boolean(checkedIn && today?.outAt);
  // "Check in" is the teacher's own attendance (class attendance keeps the word "Attendance").
  // One tile; it always opens the sheet, where Check in / Break / Check out are.
  const tileText = onBreak ? "On break" : dayDone ? "Done" : checkedIn ? (phoneDayOn ? "Break / Out" : "Check out") : "Check in";
  const label = onBreak
    ? "My check in. On break"
    : dayDone
      ? `My check in. Done, out at ${clock(today?.outAt)}`
      : checkedIn
        ? `My check in. In at ${clock(today?.inAt)}`
        : "My check in. Not checked in yet";

  return (
    <>
      {icon ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          disabled={disabled}
          onPress={() => setOpen(true)}
          className="h-10 w-10 items-center justify-center rounded-full bg-white"
        >
          <Ionicons name="location-outline" size={21} color="#0f2744" />
          {checkedIn ? (
            <View className="absolute right-1 top-1 h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white bg-[#22C55E]" />
          ) : (
            <View className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#F59E0B]" />
          )}
        </Pressable>
      ) : tile ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => setOpen(true)}
          className={`flex-1 items-center gap-1.5 active:opacity-70 ${disabled ? "opacity-50" : ""}`}
        >
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF3FF]">
            <Ionicons name={checkedIn ? (dayDone ? "moon-outline" : "exit-outline") : "enter-outline"} size={22} color="#1F45C7" />
            {onBreak ? (
              <View className="absolute -right-1 -top-1 h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[#D97706]">
                <Ionicons name="cafe" size={10} color="#fff" />
              </View>
            ) : checkedIn ? (
              <View className="absolute -right-1 -top-1 h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[#22C55E]">
                <Ionicons name="checkmark" size={11} color="#fff" />
              </View>
            ) : null}
          </View>
          <Text className="text-xs font-medium text-ink-800">{tileText}</Text>
        </Pressable>
      ) : (
        <Button variant="ghost" accessibilityLabel={label} disabled={disabled} onPress={() => setOpen(true)}>
          {checkedIn ? `✓ In at ${clock(today?.inAt)}` : "📍 Check in"}
        </Button>
      )}
      <MarkHereSheet open={open} token={token} today={today} onClose={() => setOpen(false)} onDone={onDone} />
    </>
  );
}
