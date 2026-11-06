import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Easing, Modal as RnModal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Ionicons from "@expo/vector-icons/Ionicons";
import { createFixWatcher, distanceMeters, GEO_MAX_ACCURACY_M, GEO_RADIUS_CHOICES, readFix, waitForFix, type Fix, type FixWatcher, type StaffAttendanceSetup } from "../lib/attendance-geo";
import { act } from "../lib/mutate";
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
const GREEN = "#22C55E";

type Phase = "idle" | "locating" | "done" | "error";
type Done = { kind: "in" | "out" | "already"; inAt: string; outAt: string; meters?: number; accuracy?: number };

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** Soft rings around the big button: slow while waiting for a tap, quick while finding the location. */
function PulseRings({ color, fast, active }: { color: string; fast: boolean; active: boolean }) {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const duration = fast ? 1100 : 2400;
    const ring = (v: Animated.Value) =>
      Animated.loop(Animated.timing(v, { toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE_DRIVER }));
    const one = ring(a);
    const two = ring(b);
    one.start();
    const t = setTimeout(() => two.start(), duration / 2);
    return () => {
      clearTimeout(t);
      one.stop();
      two.stop();
      a.setValue(0);
      b.setValue(0);
    };
  }, [active, fast, a, b]);
  if (!active) return null;
  return (
    <>
      {[a, b].map((v, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: "absolute",
            width: 200,
            height: 200,
            borderRadius: 100,
            borderWidth: 2,
            borderColor: color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }) }],
          }}
        />
      ))}
    </>
  );
}

function TimelineCard({ inAt, outAt }: { inAt?: string; outAt?: string }) {
  const stop = (label: string, value: string, on: boolean, icon: keyof typeof Ionicons.glyphMap) => (
    <View className="flex-1 flex-row items-center gap-3">
      <View className={`h-10 w-10 items-center justify-center rounded-full ${on ? "bg-white/15" : "border border-dashed border-white/25"}`}>
        <Ionicons name={icon} size={18} color={on ? "#fff" : "rgba(255,255,255,0.35)"} />
      </View>
      <View>
        <Text className="text-[11px] font-semibold uppercase tracking-wider text-white/45">{label}</Text>
        <Text className={`text-[17px] font-semibold tabular-nums ${on ? "text-white" : "text-white/35"}`}>{value}</Text>
      </View>
    </View>
  );
  return (
    <View testID="attendance-timeline" className="w-full flex-row items-center rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3.5">
      {stop("In", inAt ? clock(inAt) : "—", Boolean(inAt), "enter-outline")}
      <View className="mx-2 h-px w-6 bg-white/20" />
      {stop("Out", outAt ? clock(outAt) : "—", Boolean(outAt), "exit-outline")}
    </View>
  );
}

/** What is happening while marking, so the wait never feels stuck. */
function MarkSteps({ step, accuracy }: { step: "gps" | "check"; accuracy: number | null }) {
  const row = (label: string, state: "active" | "done" | "next", detail?: string) => (
    <View className="flex-row items-center gap-3 py-2">
      <View className={`h-7 w-7 items-center justify-center rounded-full ${state === "done" ? "bg-[#22C55E]" : state === "active" ? "bg-[#2855F6]" : "border border-white/20"}`}>
        {state === "done" ? (
          <Ionicons name="checkmark" size={16} color="#fff" />
        ) : state === "active" ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : null}
      </View>
      <Text className={`flex-1 text-[15px] ${state === "next" ? "text-white/40" : "font-semibold text-white"}`}>{label}</Text>
      {detail ? <Text className="text-[13px] tabular-nums text-white/55">{detail}</Text> : null}
    </View>
  );
  const gpsDetail = accuracy == null ? "" : accuracy <= GEO_MAX_ACCURACY_M ? `±${accuracy} m` : `±${accuracy} m · improving`;
  return (
    <View testID="mark-steps" className="mt-5 w-full max-w-[340px] rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2">
      {row(step === "gps" ? "Finding your location" : "Location found", step === "gps" ? "active" : "done", gpsDetail)}
      {row("Checking you're at school", step === "check" ? "active" : "next")}
    </View>
  );
}

/**
 * "Mark in": staff mark their own attendance from their phone while at school. One big button; once in,
 * marking out is a small optional link (the server keeps the last out of the day). The server checks
 * distance, GPS accuracy and fake location.
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
  today?: { marked?: boolean; inAt?: string; outAt?: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const now = useClock();
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"gps" | "check">("gps");
  const [liveAcc, setLiveAcc] = useState<number | null>(null);
  const checkedIn = Boolean(today?.marked && today?.inAt);
  const watcher = useRef<FixWatcher | null>(null);

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

  function close() {
    setPhase("idle");
    setDone(null);
    setError("");
    onClose();
  }

  async function mark() {
    setPhase("locating");
    setStep("gps");
    setLiveAcc(null);
    setError("");
    try {
      const fix =
        Platform.OS === "web" || !watcher.current ? await readFix() : await waitForFix(watcher.current, (f) => setLiveAcc(f.accuracy));
      setLiveAcc(fix.accuracy);
      setStep("check");
      const res = await act<{ ok: true; inAt: string; outAt: string; checkedOut: boolean; meters?: number; accuracy?: number }>(
        token,
        "markStaffAttendanceHere",
        fix
      );
      setDone({ kind: res.checkedOut ? "out" : "in", inAt: res.inAt, outAt: res.outAt, meters: res.meters, accuracy: res.accuracy });
      setPhase("done");
      onDone();
    } catch (e) {
      const text = errorText(e);
      if (/Mark again when leaving/.test(text)) {
        setDone({ kind: "already", inAt: today?.inAt || "", outAt: today?.outAt || "" });
        setPhase("done");
        return;
      }
      setError(text);
      setPhase("error");
    }
  }

  const inAt = done?.inAt || today?.inAt || "";
  const outAt = done?.outAt || today?.outAt || "";
  const dayDone = done ? done.kind === "out" : Boolean(outAt);
  const showIn = phase === "done" || (checkedIn && phase !== "locating" && phase !== "error");
  const locating = phase === "locating";
  const ringColor = phase === "error" ? "#F87171" : BLUE;

  let title = "Mark your attendance";
  let sub = "Tap when you are inside the school.";
  if (locating) {
    title = checkedIn ? "Marking you out…" : "Marking you in…";
    sub = "";
  } else if (phase === "error") {
    title = "Not marked";
    sub = error;
  } else if (done?.kind === "out") {
    title = `Out at ${clock(done.outAt)}`;
    sub = "Have a good evening. Mark out again if you leave later.";
  } else if (showIn && dayDone && !done) {
    title = "Done for today";
    sub = `In ${clock(inAt)} · Out ${clock(outAt)}`;
  } else if (done?.kind === "already") {
    title = `Already in at ${clock(done.inAt)}`;
    sub = "You're all set. Mark out only when you leave school.";
  } else if (showIn) {
    title = phase === "done" ? `You're in · ${clock(inAt)}` : `You're in since ${clock(inAt)}`;
    sub = phase === "done" ? "Have a great day." : "Nothing else to do.";
  }
  const where =
    done?.meters != null ? `${done.meters} m from school${done.accuracy ? ` · GPS ±${done.accuracy} m` : ""}` : "";

  return (
    <RnModal visible={open} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View testID="mark-here-sheet" className="flex-1 bg-[#0B1530]" style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}>
        <StatusBar style="light" />
        {/* Soft glow: stacked faint circles (native has no blur). */}
        {[520, 400, 290].map((size) => (
          <View
            key={size}
            pointerEvents="none"
            style={{ position: "absolute", top: -size / 2, left: "50%", marginLeft: -size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: "rgba(40,85,246,0.07)" }}
          />
        ))}

        <View className="flex-row items-start justify-between px-5">
          <View>
            <View className="flex-row items-center gap-2">
              <View className="h-6 w-6 items-center justify-center rounded-md bg-[#2855F6]">
                <Ionicons name="location" size={13} color="#fff" />
              </View>
              <Text className="text-[12px] font-semibold uppercase tracking-[2px] text-white/60">My attendance</Text>
            </View>
            <Text className="mt-2 text-[40px] font-bold leading-[44px] tabular-nums text-white">
              {clock(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`)}
            </Text>
            <Text className="text-[14px] text-white/60">{now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={close}
            className="h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/10 active:bg-white/20"
          >
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
        </View>

        <View className="flex-1 items-center justify-center px-6">
          <View className="h-[300px] w-[300px] items-center justify-center">
            {showIn ? (
              <View
                testID="attendance-done"
                className="h-[200px] w-[200px] items-center justify-center rounded-full"
                style={{ backgroundColor: dayDone ? "rgba(255,255,255,0.08)" : "rgba(34,197,94,0.16)", borderWidth: 2, borderColor: dayDone ? "rgba(255,255,255,0.22)" : GREEN }}
              >
                <View className="h-[120px] w-[120px] items-center justify-center rounded-full" style={{ backgroundColor: dayDone ? "#334155" : GREEN }}>
                  <Ionicons name={dayDone ? "exit-outline" : "checkmark"} size={64} color="#fff" />
                </View>
              </View>
            ) : (
              <>
                <PulseRings color={ringColor} fast={locating} active />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mark in here"
                  accessibilityState={{ disabled: locating, busy: locating }}
                  disabled={locating}
                  onPress={() => void mark()}
                  className="h-[200px] w-[200px] items-center justify-center rounded-full active:opacity-90"
                  style={{ backgroundColor: phase === "error" ? "#DC2626" : BLUE, shadowColor: BLUE, shadowOpacity: 0.6, shadowRadius: 30, elevation: 16 }}
                >
                  {locating ? <ActivityIndicator size="large" color="#fff" /> : <Ionicons name={phase === "error" ? "refresh" : "finger-print"} size={56} color="#fff" />}
                  <Text className="mt-2 text-[20px] font-bold text-white">{locating ? "Checking…" : phase === "error" ? "Try again" : "Mark in"}</Text>
                </Pressable>
              </>
            )}
          </View>

          <Text className="mt-2 text-center text-[24px] font-bold text-white">{title}</Text>
          {sub ? <Text className={`mt-1.5 text-center text-[15px] leading-5 ${phase === "error" ? "text-red-200" : "text-white/65"}`}>{sub}</Text> : null}
          {where ? <Text className="mt-2 text-center text-[13px] text-white/45">{where}</Text> : null}
          {locating ? <MarkSteps step={step} accuracy={liveAcc} /> : null}
        </View>

        <View className="gap-3 px-5">
          <TimelineCard inAt={inAt} outAt={outAt} />
          {showIn ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mark out here"
              disabled={locating}
              onPress={() => void mark()}
              className="flex-row items-center gap-3.5 rounded-2xl bg-white px-4 py-3.5 active:opacity-90"
            >
              <View className="h-11 w-11 items-center justify-center rounded-full bg-[#FFF1E8]">
                <Ionicons name="exit-outline" size={22} color="#EA580C" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[16px] font-semibold text-ink-900">{outAt ? "Update out time" : "Mark out"}</Text>
                <Text className="mt-0.5 text-[13px] text-ink-500">{outAt ? `Out at ${clock(outAt)} · tap if you're leaving now` : "Tap when you leave school"}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
            </Pressable>
          ) : null}
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
  today?: { marked?: boolean; inAt?: string; outAt?: string };
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
