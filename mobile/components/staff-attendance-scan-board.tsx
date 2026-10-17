import { createElement, useEffect, useRef, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import jsQR from "jsqr";
import { useRouter } from "expo-router";
import { act } from "../lib/mutate";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";
import { Button, Field, Input } from "./ui";
import {
  barcodeDetectorAvailable,
  cameraConstraints,
  classifyScanMessage,
  shouldIgnoreScan,
  STAFF_SCAN_COOLDOWN_MS,
  videoIsReady,
  type ScanFeedbackKind,
} from "../lib/staff-attendance-scan";

type ScanResult = {
  person: { kind: "teacher" | "staff"; id: string; name: string; employeeId: string };
  date: string;
  status: string;
  inAt: string;
};

type Tone = "idle" | "success" | "warn" | "danger";

function toneFor(kind: ScanFeedbackKind): Tone {
  if (kind === "success") return "success";
  if (kind === "already" || kind === "used" || kind === "expired" || kind === "unavailable") return "warn";
  if (kind === "invalid" || kind === "denied" || kind === "error") return "danger";
  return "idle";
}

function ResultPanel({ kind, title, body }: { kind: ScanFeedbackKind; title: string; body: string }) {
  const tone = toneFor(kind);
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

export function StaffAttendanceScanBoard() {
  const router = useRouter();
  const { token, user } = useSession();
  const { reload } = useRecord();
  const allowed = Boolean(user?.permissions.includes("staff.edit"));
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("Opening camera...");
  const [result, setResult] = useState({ kind: "loading" as ScanFeedbackKind, title: "Starting scanner", body: "Camera access is requested on this page only." });
  const videoRef = useRef<unknown>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const inFlightRef = useRef(false);
  const lastCodeRef = useRef("");
  const lastAtRef = useRef(0);
  const mountedRef = useRef(true);
  const [retry, setRetry] = useState(0);
  // Android / iOS scan with the native camera (expo-camera); the web keeps getUserMedia + BarcodeDetector/jsQR.
  const native = Platform.OS !== "web";
  const [permission, requestPermission] = useCameraPermissions();
  const nativeCam = native && Boolean(permission?.granted);

  useEffect(() => {
    if (!native || !allowed || !permission) return;
    if (permission.granted) {
      setStatus("Point camera at the attendance QR.");
      setResult({ kind: "idle", title: "Ready to scan", body: "Keep this screen open. Each teacher can be scanned in turn." });
    } else if (permission.canAskAgain) {
      void requestPermission();
    } else {
      setStatus("Camera permission was blocked.");
      setResult({ kind: "denied", title: "Camera blocked", body: "Turn on camera access for Anekio in Settings, or paste the QR below." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, allowed, permission?.granted, permission?.canAskAgain, retry]);

  async function markCode(raw: string) {
    const clean = raw.trim();
    const now = Date.now();
    if (
      shouldIgnoreScan({
        code: clean,
        now,
        lastCode: lastCodeRef.current,
        lastAt: lastAtRef.current,
        inFlight: inFlightRef.current,
      })
    ) {
      return;
    }
    inFlightRef.current = true;
    lastCodeRef.current = clean;
    lastAtRef.current = now;
    try {
      if (!mountedRef.current) return;
      setResult({ kind: "loading", title: "Checking QR", body: "Confirming this attendance QR..." });
      const next = await act<{ ok: true } & ScanResult>(token, "scanStaffAttendanceQr", { code: clean });
      if (!mountedRef.current) return;
      setCode("");
      setResult({
        kind: "success",
        title: "Attendance marked",
        body: `${next.person.name} marked ${next.status.toLowerCase()} at ${next.inAt}. Keep scanning.`,
      });
      setStatus("Ready for the next teacher.");
      await reload().catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not scan attendance QR.";
      const classified = classifyScanMessage(message);
      if (!mountedRef.current) return;
      setResult({ kind: classified.kind, title: classified.title, body: `${message} Scanner still running. Show the next QR.` });
      setStatus("Scanner still running. Show the next QR.");
    } finally {
      setTimeout(() => {
        inFlightRef.current = false;
      }, STAFF_SCAN_COOLDOWN_MS);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    if (!allowed || Platform.OS !== "web") {
      return () => {
        mountedRef.current = false;
      };
    }

    let stopped = false;
    const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
    canvasRef.current = canvas;

    async function decodeFrame(video: HTMLVideoElement) {
      const win = window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: unknown) => Promise<{ rawValue?: string }[]> } };
      if (barcodeDetectorAvailable(win) && win.BarcodeDetector) {
        try {
          const detector = new win.BarcodeDetector({ formats: ["qr_code"] });
          const hits = await detector.detect(video);
          return hits[0]?.rawValue || "";
        } catch {
          /* fall through to jsQR */
        }
      }
      if (!canvas) return "";
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return "";
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return "";
      ctx.drawImage(video, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      return jsQR(image.data, image.width, image.height)?.data || "";
    }

    async function start() {
      const nav = typeof navigator !== "undefined" ? navigator : null;
      if (!nav?.mediaDevices?.getUserMedia) {
        if (!mountedRef.current || stopped) return;
        setStatus("Camera QR scan is not available. Paste the QR code below.");
        setResult({ kind: "unavailable", title: "Camera unavailable", body: "Paste the QR code below or use a supported browser." });
        return;
      }
      try {
        if (!mountedRef.current || stopped) return;
        setStatus("Opening camera...");
        const stream = await nav.mediaDevices.getUserMedia(cameraConstraints());
        if (stopped || !mountedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current as HTMLVideoElement | null;
        if (!video) return;
        video.srcObject = stream;
        await video.play?.();
        setStatus("Point camera at the attendance QR.");
        setResult({ kind: "idle", title: "Ready to scan", body: "Keep this tab open. Each teacher can be scanned in turn." });
        const tick = async () => {
          if (stopped || !mountedRef.current) return;
          const live = videoRef.current as HTMLVideoElement | null;
          if (live && videoIsReady(live) && !inFlightRef.current) {
            try {
              const hit = await decodeFrame(live);
              if (hit) void markCode(hit);
            } catch {
              if (mountedRef.current) setStatus("Could not read the QR yet. Hold it steady.");
            }
          }
          frameRef.current = requestAnimationFrame(() => {
            void tick();
          });
        };
        const onReady = () => {
          if (stopped || !mountedRef.current) return;
          if (videoIsReady(video)) void tick();
        };
        video.addEventListener("loadeddata", onReady);
        if (videoIsReady(video)) void tick();
      } catch (error) {
        const denied = error instanceof Error && /not allowed|permission|denied/i.test(error.message);
        if (!mountedRef.current || stopped) return;
        if (denied) {
          setStatus("Camera permission was blocked.");
          setResult({ kind: "denied", title: "Camera blocked", body: "Allow camera access, then retry." });
        } else {
          setStatus("Camera could not start.");
          setResult({ kind: "unavailable", title: "Camera unavailable", body: "Paste the QR code below or retry camera access." });
        }
      }
    }

    void start();
    return () => {
      stopped = true;
      mountedRef.current = false;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      inFlightRef.current = false;
    };
  }, [allowed, retry]);

  if (!allowed) {
    return (
      <View className="gap-3 p-4">
        <Text className="text-lg font-semibold text-ink-900">Scan attendance</Text>
        <ResultPanel kind="denied" title="No access" body="Staff attendance scanning needs the staff.edit permission." />
      </View>
    );
  }

  return (
    <View className="min-h-0 flex-1 gap-3 bg-ink-50 p-4" testID="staff-scan-board">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-semibold text-ink-900">Scan attendance</Text>
          <Text className="mt-1 text-sm text-ink-700">This screen is for scanning only. Each teacher can be marked in turn.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close scanner"
          onPress={() => router.replace("/staff" as never)}
          className="min-h-[40px] justify-center px-2"
        >
          <Text className="text-sm font-medium text-clay-600">Close</Text>
        </Pressable>
      </View>
      <View className="relative min-h-[420px] flex-1 overflow-hidden rounded-md bg-ink-900">
        {Platform.OS === "web" ? (
          <>
            {createElement("video", {
              ref: videoRef,
              muted: true,
              playsInline: true,
              autoPlay: true,
              style: {
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                background: "#0f172a",
              },
            })}
            <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
              <View className="h-52 w-52 rounded-lg border-4 border-white/90 bg-transparent" />
            </View>
            <View className="absolute inset-x-0 bottom-0 bg-ink-900/70 px-4 py-3">
              <Text className="text-center text-sm font-semibold text-white">Point camera at staff attendance QR</Text>
              <Text className="mt-1 text-center text-xs text-white/80">{status}</Text>
            </View>
          </>
        ) : nativeCam ? (
          <>
            <CameraView
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => void markCode(data)}
              onMountError={(e) => setResult({ kind: "unavailable", title: "Camera unavailable", body: e.message || "Paste the QR code below." })}
            />
            <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
              <View className="h-52 w-52 rounded-lg border-4 border-white/90 bg-transparent" />
            </View>
            <View className="absolute inset-x-0 bottom-0 bg-ink-900/70 px-4 py-3" pointerEvents="none">
              <Text className="text-center text-sm font-semibold text-white">Point camera at staff attendance QR</Text>
              <Text className="mt-1 text-center text-xs text-white/80">{status}</Text>
            </View>
          </>
        ) : (
          <View className="flex-1 items-center justify-center bg-blue-50 p-6">
            <Ionicons name="camera-outline" size={46} color="#1d4ed8" />
            <Text className="mt-3 text-center text-sm font-semibold text-ink-900">Allow camera to scan</Text>
            <Text className="mt-1 text-center text-xs leading-5 text-ink-700">
              {permission && !permission.canAskAgain ? "Camera access is off for Anekio. Turn it on in Settings." : "Anekio needs the camera to read attendance QR codes."}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void (permission && !permission.canAskAgain ? Linking.openSettings() : requestPermission())}
              className="mt-4 rounded-md bg-clay-500 px-4 py-2"
            >
              <Text className="text-sm font-semibold text-white">{permission && !permission.canAskAgain ? "Open Settings" : "Allow camera"}</Text>
            </Pressable>
          </View>
        )}
      </View>
      <ResultPanel kind={result.kind} title={result.title} body={result.body} />
      <Field label="QR code">
        <Input
          value={code}
          onChangeText={setCode}
          placeholder="Scan or paste attendance QR code"
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => void markCode(code)}
        />
      </Field>
      <View className="flex-row justify-end gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry camera"
          onPress={() => {
            setRetry((n) => n + 1);
            setResult({ kind: "loading", title: "Starting scanner", body: "Retrying camera access." });
          }}
          className="min-h-[40px] justify-center px-3"
        >
          <Text className="text-sm font-medium text-clay-600">Retry camera</Text>
        </Pressable>
        <Button onPress={() => void markCode(code)}>Mark attendance</Button>
      </View>
    </View>
  );
}
