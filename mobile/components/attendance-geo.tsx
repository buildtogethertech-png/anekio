import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Modal as RnModal, Platform, Pressable, Text, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";
import { createFixWatcher, distanceMeters, GEO_MAX_ACCURACY_M, GEO_RADIUS_CHOICES, readFix, waitForFix, type Fix, type FixWatcher, type StaffAttendanceSetup } from "../lib/attendance-geo";
import { act } from "../lib/mutate";
import { useOptionalRecord } from "../lib/record";
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

const NATIVE_DRIVER = Platform.OS !== "web";
const BLUE = "#2855F6";
const ORANGE = "#EA580C";
type Tone = "blue" | "green" | "slate" | "red" | "orange";
const GREEN = "#22C55E";
const RING = 236;
const STROKE = 10;
const R = (RING - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Phase = "idle" | "locating" | "done" | "error";
type Done = { kind: "in" | "out"; inAt: string; outAt: string };

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

function greeting(d: Date) {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Full-screen soft gradient with a glow behind the ring (SVG: works the same on phone and web). */
function Backdrop({ tone }: { tone: Tone }) {
  const glow = tone === "green" ? GREEN : tone === "red" ? "#EF4444" : tone === "slate" ? "#8B5CF6" : tone === "orange" ? "#F97316" : "#3B82F6";
  return (
    <Svg pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
      <Defs>
        <SvgLinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1B2A6B" />
          <Stop offset="0.55" stopColor="#0B1530" />
          <Stop offset="1" stopColor="#060B1A" />
        </SvgLinearGradient>
        <RadialGradient id="glow" cx="50%" cy="45%" r="45%">
          <Stop offset="0" stopColor={glow} stopOpacity="0.35" />
          <Stop offset="1" stopColor={glow} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#bg)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#glow)" />
    </Svg>
  );
}

/** The big ring: spinning arc while marking, fills green on success. */
function StatusRing({ phase, tone, children }: { phase: Phase; tone: Tone; children: ReactNode }) {
  const spin = useRef(new Animated.Value(0)).current;
  const fill = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (phase !== "locating") return;
    spin.setValue(0);
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }));
    loop.start();
    return () => loop.stop();
  }, [phase, spin]);

  useEffect(() => {
    if (phase !== "idle") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(breathe, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, breathe]);

  useEffect(() => {
    const full = tone === "green" || tone === "slate" || tone === "orange";
    if (phase === "done") {
      fill.setValue(0);
      pop.setValue(0.4);
      burst.setValue(0);
      Animated.parallel([
        Animated.timing(fill, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(burst, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
      ]).start();
    } else {
      fill.setValue(full ? 1 : 0);
      pop.setValue(1);
    }
  }, [phase, tone, fill, pop, burst]);

  const stroke = tone === "green" ? GREEN : tone === "red" ? "#F87171" : tone === "slate" ? "#A78BFA" : tone === "orange" ? "#FDBA74" : "#7C9BFF";
  return (
    <View style={{ width: RING + 40, height: RING + 40, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: RING,
          height: RING,
          borderRadius: RING / 2,
          borderWidth: 2,
          borderColor: stroke,
          opacity: burst.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.7, 0] }),
          transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
        }}
      />
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          transform: [
            { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
            { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) },
          ],
        }}
      >
        <Svg width={RING} height={RING}>
          <Circle cx={RING / 2} cy={RING / 2} r={R} stroke="rgba(255,255,255,0.10)" strokeWidth={STROKE} fill="none" />
          {phase === "locating" ? (
            <Circle
              cx={RING / 2}
              cy={RING / 2}
              r={R}
              stroke={stroke}
              strokeWidth={STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${CIRC * 0.28} ${CIRC}`}
            />
          ) : (
            <AnimatedCircle
              cx={RING / 2}
              cy={RING / 2}
              r={R}
              stroke={stroke}
              strokeWidth={STROKE}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${CIRC} ${CIRC}`}
              strokeDashoffset={fill.interpolate({ inputRange: [0, 1], outputRange: [CIRC, 0] })}
              transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            />
          )}
        </Svg>
      </Animated.View>
      <Animated.View style={{ transform: [{ scale: pop }] }}>{children}</Animated.View>
    </View>
  );
}

function Stepper({ step }: { step: 0 | 1 | 2 }) {
  const labels = ["Locating", "Verifying", "Done"];
  return (
    <View testID="mark-steps" className="mt-5 flex-row items-center justify-center gap-2">
      {labels.map((label, i) => (
        <View key={label} className="flex-row items-center gap-2">
          <View className={`h-2 rounded-full ${i < step ? "w-2 bg-[#22C55E]" : i === step ? "w-6 bg-white" : "w-2 bg-white/25"}`} />
          <Text className={`text-[12px] font-semibold uppercase tracking-wider ${i <= step ? "text-white" : "text-white/35"}`}>{label}</Text>
          {i < labels.length - 1 ? <View className="h-px w-4 bg-white/20" /> : null}
        </View>
      ))}
    </View>
  );
}

function StatsCard({ inAt, outAt, now }: { inAt: string; outAt: string; now: Date }) {
  const cell = (icon: keyof typeof Ionicons.glyphMap, label: string, value: string, tint: string) => (
    <View className="flex-1 items-center">
      <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: `${tint}33` }}>
        <Ionicons name={icon} size={16} color={tint} />
      </View>
      <Text className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">{label}</Text>
      <Text className="mt-0.5 text-[17px] font-bold tabular-nums text-white">{value}</Text>
    </View>
  );
  return (
    <View testID="attendance-timeline" className="w-full flex-row items-center rounded-3xl border border-white/10 bg-white/[0.07] px-2 py-4">
      {cell("enter-outline", "In", inAt ? clock(inAt) : "—", "#4ADE80")}
      <View className="h-10 w-px bg-white/10" />
      {cell("exit-outline", "Out", outAt ? clock(outAt) : "—", "#FB923C")}
      <View className="h-10 w-px bg-white/10" />
      {cell("time-outline", "Hours", inAt ? hoursText(inAt, outAt || hhmmNow(now)) : "—", "#93C5FD")}
    </View>
  );
}

/**
 * "Mark in": staff mark their own attendance from their phone while at school. One big button; once in,
 * a big "Mark out" button (any number of times: the last out counts). The server checks distance, GPS
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
  const firstName = (record?.data?.staffAttendanceSelf?.name || "").split(" ")[0];
  const schoolName = record?.data?.school?.name || "";
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState<0 | 1>(0);
  const checkedIn = Boolean(today?.marked && today?.inAt);
  const watcher = useRef<FixWatcher | null>(null);

  // Start GPS as soon as the screen opens (only if already allowed), so the tap is usually instant.
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

  function close() {
    setPhase("idle");
    setDone(null);
    setError("");
    onClose();
  }

  async function mark() {
    setPhase("locating");
    setStep(0);
    setError("");
    try {
      const fix = Platform.OS === "web" || !watcher.current ? await readFix() : await waitForFix(watcher.current);
      setStep(1);
      const res = await act<{ ok: true; inAt: string; outAt: string; checkedOut: boolean }>(token, "markStaffAttendanceHere", fix);
      setDone({ kind: res.checkedOut ? "out" : "in", inAt: res.inAt, outAt: res.outAt });
      setPhase("done");
      onDone();
      setTimeout(() => setPhase((p) => (p === "done" ? "idle" : p)), 2200);
    } catch (e) {
      setError(errorText(e));
      setPhase("error");
    }
  }

  const inAt = done?.inAt || today?.inAt || "";
  const outAt = done?.outAt || today?.outAt || "";
  // The screen may be a step behind the server right after marking: what we just did counts.
  const isIn = checkedIn || Boolean(done);
  const flash = phase === "done";
  const locating = phase === "locating";
  const log = today?.outLog ?? [];
  const earlierOuts = (done?.kind === "out" && log.at(-1)?.at !== done.outAt ? log : log.slice(0, -1)).filter((o) => o.at !== outAt);
  const tone: Tone =
    phase === "error" ? "red" : flash ? (done?.kind === "out" ? "slate" : "green") : isIn && !locating ? "orange" : "blue";

  let title = "Ready to mark in?";
  let sub = "Tap Mark in once you're inside school.";
  if (locating) {
    title = isIn ? "Marking you out…" : "Marking you in…";
    sub = step === 0 ? "Finding your location" : "Checking you're at school";
  } else if (phase === "error") {
    title = "Couldn't mark you";
    sub = error;
  } else if (flash && done?.kind === "out") {
    title = `Out at ${clock(done.outAt)}`;
    sub = "See you tomorrow!";
  } else if (flash) {
    title = "You're in! 🎉";
    sub = `Checked in at ${clock(inAt)}. Have a great day.`;
  } else if (isIn && outAt) {
    title = "Done for today";
    sub = `In ${clock(inAt)} · Out ${clock(outAt)}. Leaving later? Tap again.`;
  } else if (isIn) {
    title = "You're checked in";
    sub = `Since ${clock(inAt)}. Tap Mark out when you leave.`;
  }

  // One button in the middle: Mark in (blue), then Mark out (orange). A short tick / moon after each mark.
  const face = flash ? (
    <View
      testID="attendance-done"
      className="h-[180px] w-[180px] items-center justify-center rounded-full"
      style={{
        backgroundColor: done?.kind === "out" ? "#4C3A9E" : "#16A34A",
        shadowColor: done?.kind === "out" ? "#8B5CF6" : GREEN,
        shadowOpacity: 0.7,
        shadowRadius: 36,
        elevation: 18,
      }}
    >
      <Ionicons name={done?.kind === "out" ? "moon" : "checkmark"} size={done?.kind === "out" ? 64 : 84} color="#fff" />
    </View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isIn ? "Mark out here" : "Mark in here"}
      accessibilityState={{ disabled: locating, busy: locating }}
      disabled={locating}
      onPress={() => void mark()}
      className="h-[180px] w-[180px] items-center justify-center rounded-full active:opacity-90"
      style={{
        backgroundColor: phase === "error" ? "#DC2626" : isIn ? ORANGE : BLUE,
        shadowColor: phase === "error" ? "#EF4444" : isIn ? "#F97316" : BLUE,
        shadowOpacity: 0.75,
        shadowRadius: 36,
        elevation: 18,
      }}
    >
      {locating ? (
        <>
          <Ionicons name="navigate" size={48} color="#fff" />
          <Text className="mt-1.5 text-[18px] font-bold text-white">Hold on</Text>
        </>
      ) : phase === "error" ? (
        <>
          <Ionicons name="refresh" size={48} color="#fff" />
          <Text className="mt-1.5 text-[18px] font-bold text-white">Try again</Text>
        </>
      ) : (
        <>
          <Ionicons name={isIn ? "exit-outline" : "enter-outline"} size={56} color="#fff" />
          <Text className="mt-1 text-[24px] font-extrabold text-white">{isIn ? (outAt ? "Out again" : "Mark out") : "Mark in"}</Text>
        </>
      )}
    </Pressable>
  );

  return (
    <RnModal visible={open} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View testID="mark-here-sheet" className="flex-1 overflow-hidden bg-[#0B1530]" style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }}>
        <StatusBar style="light" />
        <Backdrop tone={tone} />

        <View className="flex-row items-center justify-between px-5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={close}
            className="h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/10 active:bg-white/20"
          >
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
          {schoolName ? (
            <View className="max-w-[70%] flex-row items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-2">
              <Ionicons name="school" size={13} color="#BFD0FF" />
              <Text className="text-[13px] font-semibold text-white/85" numberOfLines={1}>
                {schoolName}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="mt-5 px-6">
          <Text className="text-[15px] text-white/60">{`${greeting(now)}${firstName ? "," : ""}`}</Text>
          {firstName ? <Text className="text-[30px] font-bold leading-[36px] text-white">{firstName} 👋</Text> : null}
          <Text className="mt-1 text-[14px] text-white/50">
            {`${clock(hhmmNow(now))} · ${now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}`}
          </Text>
        </View>

        <View className="flex-1 items-center justify-center px-6">
          <StatusRing phase={phase} tone={tone}>
            {face}
          </StatusRing>
          <Text className="mt-3 text-center text-[26px] font-bold text-white">{title}</Text>
          <Text className={`mt-1.5 text-center text-[15px] leading-5 ${phase === "error" ? "text-red-200" : "text-white/65"}`}>{sub}</Text>
          {locating ? <Stepper step={step} /> : null}
        </View>

        <View className="gap-3 px-5">
          {isIn ? <StatsCard inAt={inAt} outAt={outAt} now={now} /> : null}
          {earlierOuts.length ? (
            <Text testID="earlier-outs" className="text-center text-[12px] text-white/45">
              {`Earlier out ${earlierOuts.map((o) => clock(o.at)).join(", ")} · the last one counts`}
            </Text>
          ) : null}
          <View className="mt-1 flex-row items-center justify-center gap-1.5">
            <Ionicons name="flash" size={12} color="rgba(191,208,255,0.55)" />
            <Text className="text-[12px] font-medium tracking-wide text-white/40">
              Powered by <Text className="font-bold text-white/60">Anekio SmartAttend</Text>
            </Text>
          </View>
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
          ? { tone: "success", title: `${m} m from the school point`, body: `Marking works here (±${fix.accuracy} m).` }
          : {
              tone: "warn",
              title: `${m} m from the school point`,
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
        body="Staff tap “Mark in here” on their phone. Works only inside the school."
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
 * "Attendance" for schools that take it by location: a round tile in the phone dashboard's quick
 * actions (next to My class), or a plain button on wider screens. Opens MarkHereSheet.
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
  const label = checkedIn ? `Attendance. In at ${clock(today?.inAt)}` : "Attendance. Not marked yet";
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
            <Ionicons name="location-outline" size={22} color="#1F45C7" />
            {checkedIn ? (
              <View className="absolute -right-1 -top-1 h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-[#22C55E]">
                <Ionicons name="checkmark" size={11} color="#fff" />
              </View>
            ) : (
              <View className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-[#F59E0B]" />
            )}
          </View>
          <Text className="text-xs font-medium text-ink-800">Attendance</Text>
        </Pressable>
      ) : (
        <Button variant="ghost" accessibilityLabel={label} disabled={disabled} onPress={() => setOpen(true)}>
          {checkedIn ? `✓ In at ${clock(today?.inAt)}` : "📍 Mark attendance"}
        </Button>
      )}
      <MarkHereSheet open={open} token={token} today={today} onClose={() => setOpen(false)} onDone={onDone} />
    </>
  );
}
