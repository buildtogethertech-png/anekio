import { createElement, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, Modal as RnModal, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { act } from "../lib/mutate";
import { Button, Field, Input, Modal, Toast, useToast } from "./ui";

type StaffQrResult = {
  qrText: string;
  qrDataUrl: string;
  expiresAt: string;
  ttlSeconds: number;
  checkedInAt?: string;
  person: { kind: "teacher" | "staff"; id: string; name: string; employeeId: string };
};

type ScanResult = {
  person: { kind: "teacher" | "staff"; id: string; name: string; employeeId: string };
  date: string;
  status: string;
  inAt: string;
};

type ResultTone = "idle" | "success" | "warn" | "danger";

function ResultPanel({ tone, title, body }: { tone: ResultTone; title: string; body: string }) {
  const classes =
    tone === "success"
      ? "border-green-200 bg-green-50"
      : tone === "danger"
        ? "border-red-200 bg-red-50"
        : tone === "warn"
          ? "border-amber-200 bg-amber-50"
          : "border-ink-200 bg-ink-50";
  const icon =
    tone === "success" ? "checkmark-circle" : tone === "danger" ? "close-circle" : tone === "warn" ? "alert-circle" : "scan-outline";
  const color = tone === "success" ? "#166534" : tone === "danger" ? "#b91c1c" : tone === "warn" ? "#92400e" : "#3d4f66";
  const titleClass = tone === "success" ? "text-green-900" : tone === "danger" ? "text-red-900" : tone === "warn" ? "text-amber-900" : "text-ink-900";
  const bodyClass = tone === "success" ? "text-green-800" : tone === "danger" ? "text-red-800" : tone === "warn" ? "text-amber-800" : "text-ink-700";
  return (
    <View className={`rounded-md border p-3 ${classes}`}>
      <View className="flex-row items-start gap-2">
        <Ionicons name={icon} size={18} color={color} />
        <View className="min-w-0 flex-1">
          <Text className={`text-sm font-semibold ${titleClass}`}>{title}</Text>
          <Text className={`mt-1 text-xs leading-5 ${bodyClass}`}>{body}</Text>
        </View>
      </View>
    </View>
  );
}

function clockLabel(value?: string) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!m) {
    const d = new Date(String(value || ""));
    return Number.isNaN(+d) ? "" : d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  }
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

/** Bottom sheet (phone) / centred card (wide) with a big QR, a live countdown and auto refresh. */
function QrSheet({
  open,
  qr,
  busy,
  onRefresh,
  onClose,
  onScan,
}: {
  open: boolean;
  qr: StaffQrResult | null;
  busy: boolean;
  onRefresh: () => void;
  onClose: () => void;
  /** When set, shows a "Scan staff" switch for people who also run the check-in desk. */
  onScan?: () => void;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const [now, setNow] = useState(Date.now());
  const refreshing = useRef(false);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  const expiresAt = qr ? Date.parse(qr.expiresAt) : 0;
  const total = Math.max(1, (qr?.ttlSeconds || 120) * 1000);
  const left = Math.max(0, expiresAt - now);
  const secs = Math.ceil(left / 1000);
  const countdown = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const frac = Math.min(1, left / total);

  // Expired while open: fetch a fresh code automatically.
  useEffect(() => {
    if (!open || !qr || left > 0 || busy || refreshing.current) return;
    refreshing.current = true;
    onRefresh();
  }, [open, qr, left, busy, onRefresh]);
  useEffect(() => {
    refreshing.current = false;
  }, [qr?.expiresAt]);

  const qrSize = Math.min(phone ? width - 96 : 300, 300);
  const urgent = secs <= 20;

  return (
    <RnModal visible={open} transparent animationType={phone ? "slide" : "fade"} onRequestClose={onClose}>
      <View className={`flex-1 ${phone ? "justify-end" : "items-center justify-center px-4"}`}>
        <Pressable accessibilityLabel="Close" className="absolute inset-0 bg-black/50" onPress={onClose} />
        <View className={`w-full bg-white px-5 ${phone ? "rounded-t-3xl pb-8 pt-3" : "max-w-[420px] rounded-3xl pb-6 pt-4"}`}>
          {phone ? <View className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-200" /> : null}
          <View className="flex-row items-center justify-between">
            <Text className="text-[18px] font-semibold text-ink-900">My attendance QR</Text>
            <Pressable onPress={onClose} hitSlop={10} className="h-8 w-8 items-center justify-center rounded-full bg-ink-100">
              <Ionicons name="close" size={18} color="#334155" />
            </Pressable>
          </View>

          {qr?.checkedInAt ? (
            <View className="mt-3 flex-row items-center gap-2 rounded-xl bg-[#ECF8F0] px-3 py-2.5">
              <Ionicons name="checkmark-circle" size={18} color="#18794E" />
              <Text className="text-[13px] font-semibold text-[#18794E]">Checked in today at {clockLabel(qr.checkedInAt)}</Text>
            </View>
          ) : null}

          <View className="mt-4 items-center">
            <View className="items-center justify-center rounded-3xl border border-ink-100 bg-white p-3" style={{ width: qrSize + 24, height: qrSize + 24 }}>
              {qr && left > 0 ? (
                <Image source={{ uri: qr.qrDataUrl }} resizeMode="contain" style={{ width: qrSize, height: qrSize }} />
              ) : (
                <View className="items-center">
                  <ActivityIndicator color="#1F45C7" />
                  <Text className="mt-2 text-[13px] text-ink-500">Getting a fresh code…</Text>
                </View>
              )}
            </View>
          </View>

          <View className="mt-4 items-center">
            <Text className={`text-[28px] font-bold tabular-nums ${urgent ? "text-[#B42318]" : "text-ink-900"}`}>{left > 0 ? countdown : "0:00"}</Text>
            <View className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-ink-100">
              <View className={`h-full rounded-full ${urgent ? "bg-[#E5484D]" : "bg-[#1F45C7]"}`} style={{ width: `${frac * 100}%` }} />
            </View>
            <Text className="mt-2 text-[12px] text-ink-500">Refreshes by itself · works once</Text>
          </View>

          {qr ? (
            <Text className="mt-4 text-center text-[14px] font-medium text-ink-800">
              {qr.person.name}
              {qr.person.employeeId ? <Text className="text-ink-500"> · {qr.person.employeeId}</Text> : null}
            </Text>
          ) : null}
          <Text className="mt-1 text-center text-[12px] text-ink-500">Hold your phone up to the school's scanner.</Text>

          <Pressable onPress={onRefresh} disabled={busy} className="mt-4 flex-row items-center justify-center gap-1.5 self-center px-3 py-1.5" hitSlop={8}>
            <Ionicons name="refresh" size={15} color={busy ? "#94A3B8" : "#1F45C7"} />
            <Text className={`text-[13px] font-semibold ${busy ? "text-ink-400" : "text-[#1F45C7]"}`}>{busy ? "Refreshing…" : "New code"}</Text>
          </Pressable>

          {onScan ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan staff"
              onPress={onScan}
              className="mt-3 flex-row items-center gap-3 rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3 active:bg-ink-100"
            >
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-white">
                <Ionicons name="scan-outline" size={20} color="#1F45C7" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[14px] font-semibold text-ink-900">Scan staff</Text>
                <Text className="text-[12px] text-ink-500">Open the check-in desk camera</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </Pressable>
          ) : null}
        </View>
      </View>
    </RnModal>
  );
}

export function StaffAttendanceQrButton({
  token,
  disabled,
  compact,
  tile,
  round,
  onMessage,
}: {
  token: string | null;
  disabled?: boolean;
  compact?: boolean;
  tile?: boolean;
  /** Round icon style used in the teacher phone dashboard's quick actions. */
  round?: boolean;
  onMessage: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<StaffQrResult | null>(null);

  async function generate() {
    setBusy(true);
    try {
      const result = await act<{ ok: true } & StaffQrResult>(token, "generateStaffAttendanceQr");
      setQr(result);
      setOpen(true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Could not generate attendance QR.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {tile && round ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show my attendance QR"
          disabled={disabled || busy}
          onPress={() => void generate()}
          className={`flex-1 items-center gap-1.5 active:opacity-70 ${disabled || busy ? "opacity-50" : ""}`}
        >
          <View className="h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF3FF]">
            <Ionicons name="qr-code-outline" size={22} color="#1F45C7" />
          </View>
          <Text className="text-xs font-medium text-ink-800">{busy ? "Wait…" : "My QR"}</Text>
        </Pressable>
      ) : tile ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show attendance QR"
          disabled={disabled || busy}
          onPress={() => void generate()}
          className={`min-w-[72px] flex-1 items-center rounded-md border border-ink-100 bg-white px-2 py-3 ${disabled || busy ? "opacity-50" : ""}`}
        >
          <Ionicons name="qr-code-outline" size={20} color="#2855F6" />
          <Text className="mt-1 text-xs font-medium text-ink-900">{busy ? "Wait" : "QR"}</Text>
        </Pressable>
      ) : (
        <Button variant="ghost" disabled={disabled || busy} onPress={() => void generate()} className={compact ? "shrink-0 px-2 py-2" : undefined}>
          {busy ? "Generating..." : compact ? "Show QR" : "Show attendance QR"}
        </Button>
      )}
      <QrSheet
        open={open}
        qr={qr}
        busy={busy}
        onRefresh={() => void generate()}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

export function StaffAttendanceQrScanButton({
  token,
  disabled,
  compact,
  onDone,
  onMessage,
}: {
  token: string | null;
  disabled?: boolean;
  compact?: boolean;
  onDone: () => Promise<void> | void;
  onMessage: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<{ tone: ResultTone; title: string; body: string }>({
    tone: "idle",
    title: "Ready to scan",
    body: "Point the camera at a staff attendance QR.",
  });
  const videoRef = useRef<unknown>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);

  async function scan(raw: string) {
    const clean = raw.trim();
    if (!clean) return;
    try {
      setResult({ tone: "idle", title: "Checking QR", body: "Confirming this attendance QR..." });
      const next = await act<{ ok: true } & ScanResult>(token, "scanStaffAttendanceQr", { code: clean });
      setCode("");
      setResult({
        tone: "success",
        title: "Attendance marked",
        body: `${next.person.name} marked ${next.status.toLowerCase()} at ${next.inAt}.`,
      });
      onMessage(`${next.person.name} attendance marked at ${next.inAt}.`);
      await onDone();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not scan attendance QR.";
      setResult({ tone: "danger", title: "Rejected", body: message });
      onMessage(message);
    }
  }

  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    setStatus("");
    setResult({ tone: "idle", title: "Ready to scan", body: "Point the camera at a staff attendance QR." });
    let stopped = false;
    let frame = 0;
    async function start() {
      const nav = typeof navigator !== "undefined" ? navigator : null;
      const barcodeDetectorClass =
        typeof window !== "undefined"
          ? (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: unknown) => Promise<{ rawValue?: string }[]> } }).BarcodeDetector
          : undefined;
      if (!nav?.mediaDevices?.getUserMedia || !barcodeDetectorClass) {
        setStatus("Camera QR scan is not available in this browser. Paste the QR code below.");
        setResult({ tone: "warn", title: "Camera scanner unavailable", body: "Paste the QR code below or use a supported browser." });
        return;
      }
      try {
        setStatus("Opening camera...");
        const stream = await nav.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        streamRef.current = stream;
        const video = videoRef.current as { srcObject?: MediaStream; play?: () => Promise<void>; readyState?: number } | null;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play?.();
        const detector = new barcodeDetectorClass({ formats: ["qr_code"] });
        setStatus("Point camera at the attendance QR.");
        const tick = async () => {
          if (stopped || !open) return;
          const liveVideo = videoRef.current as { readyState?: number } | null;
          if (liveVideo?.readyState && liveVideo.readyState >= 2 && !busyRef.current) {
            busyRef.current = true;
            try {
              const hits = await detector.detect(liveVideo);
              const hit = hits[0]?.rawValue || "";
              if (hit) {
                void scan(hit);
                return;
              }
            } catch {
              setStatus("Could not read the QR yet. Hold it steady.");
            } finally {
              busyRef.current = false;
            }
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch {
        setStatus("Camera permission was blocked. Allow camera access or paste the QR code.");
        setResult({ tone: "danger", title: "Camera blocked", body: "Allow camera access in Chrome, then reopen Scan attendance." });
      }
    }
    void start();
    return () => {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      busyRef.current = false;
    };
  }, [open]);

  return (
    <>
      <Button variant="ghost" disabled={disabled} onPress={() => setOpen(true)} className={compact ? "shrink-0 px-2 py-2" : undefined}>
        {compact ? "Scan" : "Scan attendance"}
      </Button>
      <Modal
        open={open}
        title="Scan attendance"
        onClose={() => setOpen(false)}
        footer={
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={() => setOpen(false)}>
              Close
            </Button>
            <Button onPress={() => void scan(code)}>Mark attendance</Button>
          </View>
        }
      >
        <View className="gap-4">
          <View className="overflow-hidden rounded-md border border-blue-200 bg-ink-900">
            {Platform.OS === "web" ? (
              <View className="relative h-72">
                {createElement("video", {
                  ref: videoRef,
                  muted: true,
                  playsInline: true,
                  style: {
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    background: "#0f172a",
                  },
                })}
                <View className="absolute inset-0 items-center justify-center">
                  <View className="h-40 w-40 rounded-lg border-4 border-white/90 bg-transparent" />
                </View>
                <View className="absolute inset-x-0 bottom-0 bg-ink-900/80 px-4 py-3">
                  <Text className="text-center text-sm font-semibold text-white">Point camera at staff attendance QR</Text>
                  <Text className="mt-1 text-center text-xs text-white/80">{status || "Marks today's in time immediately"}</Text>
                </View>
              </View>
            ) : (
              <View className="items-center bg-blue-50 p-6">
                <Ionicons name="camera-outline" size={46} color="#1d4ed8" />
                <Text className="mt-3 text-center text-sm font-semibold text-ink-900">Camera scanner needs the mobile camera module</Text>
                <Text className="mt-1 text-center text-xs leading-5 text-ink-700">Paste or scan the QR code below for now.</Text>
              </View>
            )}
          </View>
          <ResultPanel tone={result.tone} title={result.title} body={result.body} />
          <Field label="QR code">
            <Input
              value={code}
              onChangeText={setCode}
              placeholder="Scan or paste attendance QR code"
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => void scan(code)}
            />
          </Field>
        </View>
      </Modal>
    </>
  );
}

type KioskEntry = { id: string; tone: "success" | "danger"; title: string; body: string; at: string; name?: string };

function initials(name?: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

const NATIVE_DRIVER = Platform.OS !== "web";

/** Corner brackets + a sweeping line that show staff where to hold their QR. */
function ScanFrame({ size, tone }: { size: number; tone: "idle" | "success" | "danger" }) {
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(sweep, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);
  const color = tone === "success" ? "#4ADE80" : tone === "danger" ? "#F87171" : "#FFFFFF";
  const arm = Math.round(size * 0.18);
  const w = 4;
  const corner = (pos: object, sides: object) => (
    <View pointerEvents="none" style={[{ position: "absolute", width: arm, height: arm, borderColor: color }, pos, sides]} />
  );
  return (
    <View pointerEvents="none" style={{ width: size, height: size }}>
      {corner({ top: 0, left: 0 }, { borderTopWidth: w, borderLeftWidth: w, borderTopLeftRadius: 18 })}
      {corner({ top: 0, right: 0 }, { borderTopWidth: w, borderRightWidth: w, borderTopRightRadius: 18 })}
      {corner({ bottom: 0, left: 0 }, { borderBottomWidth: w, borderLeftWidth: w, borderBottomLeftRadius: 18 })}
      {corner({ bottom: 0, right: 0 }, { borderBottomWidth: w, borderRightWidth: w, borderBottomRightRadius: 18 })}
      {tone === "idle" ? (
        <Animated.View
          style={{
            position: "absolute",
            left: 14,
            right: 14,
            height: 2,
            borderRadius: 2,
            backgroundColor: "#7DD3FC",
            opacity: 0.9,
            shadowColor: "#7DD3FC",
            shadowOpacity: 0.9,
            shadowRadius: 8,
            transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [12, size - 14] }) }],
          }}
        />
      ) : null}
    </View>
  );
}

function LiveDot({ on }: { on: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE_DRIVER }));
    loop.start();
    return () => loop.stop();
  }, [on, pulse]);
  const color = on ? "#4ADE80" : "#FBBF24";
  return (
    <View style={{ width: 10, height: 10, alignItems: "center", justifyContent: "center" }}>
      {on ? (
        <Animated.View
          style={{
            position: "absolute",
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: color,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
          }}
        />
      ) : null}
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

const KIOSK_STEPS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: "phone-portrait-outline", text: "Open Anekio" },
  { icon: "qr-code-outline", text: "Staff → Show QR" },
  { icon: "scan-outline", text: "Hold it in the frame" },
];

/**
 * Full-screen check-in desk: put a phone/tablet on a tripod at the gate and staff
 * hold up their own attendance QR. Scans continuously; each result shows big, then resets.
 */
export function AttendanceKiosk({ token, open, onClose, onScanned }: { token: string | null; open: boolean; onClose: () => void; onScanned?: () => void }) {
  const { width, height } = useWindowDimensions();
  const wide = width > height && width >= 700;
  const videoRef = useRef<unknown>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [camError, setCamError] = useState("");
  const [camReady, setCamReady] = useState(false);
  const [flash, setFlash] = useState<KioskEntry | null>(null);
  const [log, setLog] = useState<KioskEntry[]>([]);
  const [count, setCount] = useState(0);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [open]);

  // Full screen + keep the screen awake while the kiosk is open (web).
  useEffect(() => {
    if (!open || Platform.OS !== "web" || typeof document === "undefined") return;
    let lock: { release?: () => Promise<void> } | null = null;
    const doc = document as unknown as { documentElement: { requestFullscreen?: () => Promise<void> }; fullscreenElement?: unknown; exitFullscreen?: () => Promise<void> };
    void doc.documentElement.requestFullscreen?.().catch(() => undefined);
    const nav = navigator as unknown as { wakeLock?: { request: (k: string) => Promise<{ release?: () => Promise<void> }> } };
    void nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    return () => {
      void lock?.release?.().catch(() => undefined);
      if (doc.fullscreenElement) void doc.exitFullscreen?.().catch(() => undefined);
    };
  }, [open]);

  async function handle(code: string) {
    const clean = code.trim();
    const t = Date.now();
    if (!clean || (lastRef.current.code === clean && t - lastRef.current.at < 5000)) return;
    lastRef.current = { code: clean, at: t };
    const stamp = new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
    let entry: KioskEntry;
    try {
      const res = await act<{ ok: true } & ScanResult>(token, "scanStaffAttendanceQr", { code: clean });
      const late = String(res.status).toUpperCase() === "LATE";
      entry = {
        id: `${t}`,
        tone: "success",
        title: `${late ? "Checked in late" : "Welcome"}, ${res.person.name.split(" ")[0]}`,
        body: `In at ${res.inAt}${res.person.employeeId ? ` · ${res.person.employeeId}` : ""}`,
        name: res.person.name,
        at: stamp,
      };
      setCount((c) => c + 1);
      onScanned?.();
    } catch (e) {
      entry = { id: `${t}`, tone: "danger", title: "Not marked", body: e instanceof Error ? e.message : "Could not read this QR.", at: stamp };
    }
    setFlash(entry);
    setLog((cur) => [entry, ...cur].slice(0, 5));
    setTimeout(() => setFlash((f) => (f?.id === entry.id ? null : f)), 3000);
  }

  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    let stopped = false;
    let frame = 0;
    setCamError("");
    setCamReady(false);
    (async () => {
      const nav = typeof navigator !== "undefined" ? navigator : null;
      const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: unknown) => Promise<{ rawValue?: string }[]> } }).BarcodeDetector;
      if (!nav?.mediaDevices?.getUserMedia || !Detector) {
        setCamError("This browser can't scan QR codes. Use Chrome on Android or a laptop.");
        return;
      }
      try {
        const stream = await nav.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
        streamRef.current = stream;
        const video = videoRef.current as { srcObject?: MediaStream; play?: () => Promise<void> } | null;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play?.();
        setCamReady(true);
        const detector = new Detector({ formats: ["qr_code"] });
        const tick = async () => {
          if (stopped) return;
          const v = videoRef.current as { readyState?: number } | null;
          if (v?.readyState && v.readyState >= 2 && !busyRef.current) {
            busyRef.current = true;
            try {
              const hit = (await detector.detect(v))[0]?.rawValue || "";
              if (hit) await handle(hit);
            } catch {
              /* keep scanning */
            } finally {
              busyRef.current = false;
            }
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      } catch {
        setCamError("Camera blocked. Allow camera access for this site, then reopen.");
      }
    })();
    return () => {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      busyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facing]);

  const time = now.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const day = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  // Portrait: camera fills the width and most of the height. Landscape: camera left, panel right.
  const camW = wide ? Math.min(height * 0.72, width - 440, 640) : Math.min(width - 40, 560);
  const camH = wide ? camW : Math.min(Math.round(camW * 1.22), Math.round(height * 0.56));
  const frameSize = Math.round(Math.min(camW, camH) * 0.66);
  const scanning = camReady && !camError;
  const frameTone = flash ? flash.tone : "idle";
  const ring = flash ? (flash.tone === "success" ? "#22C55E" : "#EF4444") : "rgba(255,255,255,0.14)";

  const camera = (
    <View className="overflow-hidden rounded-[28px]" style={{ width: camW, height: camH, borderWidth: 3, borderColor: ring, backgroundColor: "#060D22" }}>
      {Platform.OS === "web" && !camError ? (
        createElement("video", {
          ref: videoRef,
          muted: true,
          playsInline: true,
          style: { width: "100%", height: "100%", objectFit: "cover", background: "#060D22", transform: facing === "user" ? "scaleX(-1)" : undefined },
        })
      ) : (
        <View className="flex-1 items-center justify-center p-8">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-white/10">
            <Ionicons name="videocam-off-outline" size={30} color="rgba(255,255,255,0.8)" />
          </View>
          <Text className="mt-4 text-center text-[17px] font-semibold text-white">Camera unavailable</Text>
          <Text className="mt-1 max-w-[300px] text-center text-[14px] leading-5 text-white/70">
            {camError || "Open Anekio in Chrome on this device to use the camera."}
          </Text>
        </View>
      )}

      {!camError && Platform.OS === "web" ? (
        <>
          {/* soft vignette so the frame reads against any background */}
          <View pointerEvents="none" className="absolute inset-0" style={{ backgroundColor: "rgba(6,13,34,0.18)" }} />
          <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
            <ScanFrame size={frameSize} tone={frameTone} />
          </View>
          <View pointerEvents="none" className="absolute left-4 top-4 flex-row items-center gap-2 rounded-full bg-black/45 px-3 py-1.5">
            <LiveDot on={scanning} />
            <Text className="text-[12px] font-semibold text-white">{scanning ? "Scanning" : "Starting camera…"}</Text>
          </View>
          {!flash ? (
            <View pointerEvents="none" className="absolute inset-x-0 bottom-0 items-center pb-4">
              <View className="rounded-full bg-black/45 px-4 py-2">
                <Text className="text-[13px] font-medium text-white">Hold your QR inside the frame</Text>
              </View>
            </View>
          ) : null}
        </>
      ) : null}

      {flash ? (
        <View
          className="absolute inset-0 items-center justify-center px-6"
          style={{ backgroundColor: flash.tone === "success" ? "rgba(21,128,61,0.92)" : "rgba(185,28,28,0.92)" }}
        >
          {flash.tone === "success" && flash.name ? (
            <View className="h-24 w-24 items-center justify-center rounded-full border-4 border-white/40 bg-white/20">
              <Text className="text-[34px] font-bold text-white">{initials(flash.name)}</Text>
              <View className="absolute -bottom-1 -right-1 h-9 w-9 items-center justify-center rounded-full bg-white">
                <Ionicons name="checkmark" size={24} color="#15803D" />
              </View>
            </View>
          ) : (
            <Ionicons name="close-circle" size={88} color="#fff" />
          )}
          <Text className="mt-5 text-center text-[28px] font-bold text-white">{flash.title}</Text>
          <Text className="mt-1.5 text-center text-[16px] text-white/90">{flash.body}</Text>
        </View>
      ) : null}
    </View>
  );

  const steps = (
    <View className="w-full flex-row gap-2">
      {KIOSK_STEPS.map((s, i) => (
        <View key={s.text} className="flex-1 items-center rounded-2xl border border-white/10 bg-white/[0.06] px-2 py-3">
          <View className="h-9 w-9 items-center justify-center rounded-full bg-[#2855F6]/30">
            <Ionicons name={s.icon} size={18} color="#BFD0FF" />
          </View>
          <Text className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-white/40">Step {i + 1}</Text>
          <Text className="mt-0.5 text-center text-[13px] font-medium leading-4 text-white">{s.text}</Text>
        </View>
      ))}
    </View>
  );

  const recent = (
    <View className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-[11px] font-semibold uppercase tracking-wider text-white/50">Recent check-ins</Text>
        {count ? <Text className="text-[11px] font-semibold text-[#4ADE80]">{count} today on this device</Text> : null}
      </View>
      {log.length ? (
        log.map((row) => (
          <View key={row.id} className="flex-row items-center gap-3 py-1.5">
            <View
              className="h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: row.tone === "success" ? "rgba(74,222,128,0.16)" : "rgba(248,113,113,0.16)" }}
            >
              {row.tone === "success" && row.name ? (
                <Text className="text-[12px] font-bold text-[#86EFAC]">{initials(row.name)}</Text>
              ) : (
                <Ionicons name="close" size={16} color="#FCA5A5" />
              )}
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[14px] font-medium text-white" numberOfLines={1}>
                {row.tone === "success" ? row.name : "Not marked"}
              </Text>
              <Text className="text-[12px] text-white/50" numberOfLines={1}>{row.body}</Text>
            </View>
            <Text className="text-[12px] tabular-nums text-white/50">{row.at}</Text>
          </View>
        ))
      ) : (
        <Text className="py-2 text-[13px] text-white/40">Waiting for the first scan…</Text>
      )}
    </View>
  );

  return (
    <RnModal visible={open} animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View className="flex-1 bg-[#0B1530]">
        {/* decorative glow */}
        <View pointerEvents="none" className="absolute -top-40 left-1/2 h-96 w-96 rounded-full" style={{ marginLeft: -192, backgroundColor: "rgba(40,85,246,0.22)", filter: "blur(80px)" } as object} />

        <View className="flex-row items-start justify-between px-5 pt-5">
          <View>
            <View className="flex-row items-center gap-2">
              <View className="h-6 w-6 items-center justify-center rounded-md bg-[#2855F6]">
                <Ionicons name="qr-code" size={13} color="#fff" />
              </View>
              <Text className="text-[12px] font-semibold uppercase tracking-[2px] text-white/60">Staff check-in</Text>
            </View>
            <Text className="mt-2 text-[40px] font-bold leading-[44px] tabular-nums text-white">{time}</Text>
            <Text className="text-[14px] text-white/60">{day}</Text>
          </View>
          <View className="flex-row gap-2">
            <Pressable
              accessibilityLabel="Switch camera"
              onPress={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
              className="h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/10 active:bg-white/20"
            >
              <Ionicons name="camera-reverse-outline" size={20} color="#fff" />
            </Pressable>
            <Pressable
              accessibilityLabel="Exit check-in"
              onPress={onClose}
              className="h-11 flex-row items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-4 active:bg-white/20"
            >
              <Ionicons name="close" size={18} color="#fff" />
              <Text className="text-[14px] font-semibold text-white">Exit</Text>
            </Pressable>
          </View>
        </View>

        {wide ? (
          <View className="flex-1 flex-row items-center justify-center gap-8 px-6 pb-6">
            {camera}
            <View className="w-96 gap-4">
              <View>
                <Text className="text-[26px] font-bold text-white">Show your attendance QR</Text>
                <Text className="mt-1 text-[15px] text-white/60">Your in-time is marked the moment it's read.</Text>
              </View>
              {steps}
              {recent}
            </View>
          </View>
        ) : (
          <View className="flex-1 items-center justify-between px-5 pb-6 pt-5">
            {camera}
            <View className="w-full items-center gap-4" style={{ maxWidth: camW }}>
              <Text className="text-center text-[22px] font-bold text-white">Show your attendance QR</Text>
              {log.length ? recent : steps}
            </View>
          </View>
        )}
      </View>
    </RnModal>
  );
}

/** Top-bar icon: opens the full-screen check-in desk. Only for people who can mark staff attendance. */
export function KioskTopButton({ token, permissions, onScanned }: { token: string | null; permissions?: string[]; onScanned?: () => void }) {
  const [open, setOpen] = useState(false);
  const allowed = (permissions ?? []).some((p) => p === "staff.attendance" || p === "staff.edit");
  if (!allowed) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open staff check-in"
        onPress={() => setOpen(true)}
        className="h-10 w-10 items-center justify-center rounded-full bg-white"
      >
        <Ionicons name="scan-outline" size={20} color="#0f2744" />
      </Pressable>
      <AttendanceKiosk token={token} open={open} onClose={() => setOpen(false)} onScanned={onScanned} />
    </>
  );
}

/**
 * One QR icon for the phone top bar. Tap opens your own QR straight away;
 * people who can scan get a "Scan staff" link inside that sheet.
 * Scanners without a QR of their own go straight to the check-in desk.
 */
export function QrDockButton({
  token,
  hasSelfQr = true,
  canScan = false,
  onScanned,
}: {
  token: string | null;
  top?: boolean;
  hasSelfQr?: boolean;
  canScan?: boolean;
  onScanned?: () => void;
}) {
  const toast = useToast();
  const [kiosk, setKiosk] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<StaffQrResult | null>(null);

  async function showMine() {
    setBusy(true);
    try {
      const result = await act<{ ok: true } & StaffQrResult>(token, "generateStaffAttendanceQr");
      setQr(result);
      setQrOpen(true);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not generate attendance QR.");
    } finally {
      setBusy(false);
    }
  }

  if (!hasSelfQr && !canScan) return null;

  function press() {
    if (hasSelfQr) void showMine();
    else setKiosk(true);
  }

  return (
    <>
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hasSelfQr ? "Show my attendance QR" : "Scan staff attendance"}
        onPress={press}
        disabled={busy}
        className="h-10 w-10 items-center justify-center rounded-full bg-white"
      >
        {busy ? <ActivityIndicator size="small" color="#0f2744" /> : <Ionicons name={hasSelfQr ? "qr-code-outline" : "scan-outline"} size={20} color="#0f2744" />}
      </Pressable>


      <QrSheet
        open={qrOpen}
        qr={qr}
        busy={busy}
        onRefresh={() => void showMine()}
        onClose={() => setQrOpen(false)}
        onScan={
          canScan
            ? () => {
                setQrOpen(false);
                setKiosk(true);
              }
            : undefined
        }
      />
      {canScan ? <AttendanceKiosk token={token} open={kiosk} onClose={() => setKiosk(false)} onScanned={onScanned} /> : null}
    </>
  );
}
