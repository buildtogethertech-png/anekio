import { createElement, useEffect, useRef, useState } from "react";
import { Image, Platform, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { act } from "../lib/mutate";
import { Badge, Button, Field, Input, Modal } from "./ui";

type StaffQrResult = {
  qrText: string;
  qrDataUrl: string;
  expiresAt: string;
  ttlSeconds: number;
  person: { kind: "teacher" | "staff"; id: string; name: string; employeeId: string };
};

type ScanResult = {
  person: { kind: "teacher" | "staff"; id: string; name: string; employeeId: string };
  date: string;
  status: string;
  inAt: string;
};

type ResultTone = "idle" | "success" | "warn" | "danger";

function expiryLabel(value?: string) {
  if (!value) return "";
  const time = new Date(value);
  if (Number.isNaN(+time)) return "";
  return time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

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

export function StaffAttendanceQrButton({
  token,
  disabled,
  compact,
  onMessage,
}: {
  token: string | null;
  disabled?: boolean;
  compact?: boolean;
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
      <Button variant="ghost" disabled={disabled || busy} onPress={() => void generate()} className={compact ? "shrink-0 px-2 py-2" : undefined}>
        {busy ? "Generating..." : compact ? "My QR" : "My attendance QR"}
      </Button>
      <Modal open={open} title="My attendance QR" onClose={() => setOpen(false)} footer={<Button onPress={() => setOpen(false)}>Done</Button>}>
        {qr ? (
          <View className="items-center gap-4">
            <View className="items-center rounded-md border border-ink-100 bg-white p-3">
              <Image source={{ uri: qr.qrDataUrl }} resizeMode="contain" className="h-64 w-64" />
            </View>
            <View className="w-full gap-2">
              <View className="flex-row flex-wrap items-center justify-center gap-2">
                <Badge tone="leaf">{qr.person.name}</Badge>
                <Badge>{qr.person.employeeId}</Badge>
                <Badge tone="warn">{`Expires ${expiryLabel(qr.expiresAt)}`}</Badge>
              </View>
              <Text className="text-center text-xs leading-5 text-ink-700">
                Show this to the attendance scanner. It expires in {Math.round(qr.ttlSeconds / 60)} minutes and works once.
              </Text>
            </View>
          </View>
        ) : null}
      </Modal>
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
