import { createElement, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal as RnModal, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { act } from "../lib/mutate";
import { Button, Field, Input, Modal } from "./ui";

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
}: {
  open: boolean;
  qr: StaffQrResult | null;
  busy: boolean;
  onRefresh: () => void;
  onClose: () => void;
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
