export const STAFF_SCAN_COOLDOWN_MS = 1500;
export const STAFF_SCAN_ROUTE = "/staff/scan";

export type ScanFeedbackKind =
  | "idle"
  | "loading"
  | "success"
  | "invalid"
  | "expired"
  | "used"
  | "already"
  | "denied"
  | "unavailable"
  | "error";

export function barcodeDetectorAvailable(win?: { BarcodeDetector?: unknown } | null) {
  return typeof win?.BarcodeDetector === "function";
}

export function videoIsReady(video?: { readyState?: number; videoWidth?: number; videoHeight?: number } | null) {
  return Boolean(video && (video.readyState || 0) >= 2 && (video.videoWidth || 0) > 0 && (video.videoHeight || 0) > 0);
}

export function cameraConstraints() {
  return { video: { facingMode: { ideal: "environment" } }, audio: false } as const;
}

export function shouldIgnoreScan(input: {
  code: string;
  now: number;
  lastCode: string;
  lastAt: number;
  inFlight: boolean;
}) {
  if (!input.code.trim() || input.inFlight) return true;
  if (input.lastCode && input.lastCode === input.code && input.now - input.lastAt < STAFF_SCAN_COOLDOWN_MS) return true;
  return false;
}

export function classifyScanMessage(message: string): { kind: ScanFeedbackKind; title: string } {
  const text = message.toLowerCase();
  if (text.includes("already marked")) return { kind: "already", title: "Already marked" };
  if (text.includes("already used")) return { kind: "used", title: "QR already used" };
  if (text.includes("expired")) return { kind: "expired", title: "QR expired" };
  if (text.includes("not valid") || text.includes("scan a staff attendance qr")) return { kind: "invalid", title: "Invalid QR" };
  if (text.includes("camera") && (text.includes("block") || text.includes("permission") || text.includes("denied"))) {
    return { kind: "denied", title: "Camera blocked" };
  }
  if (text.includes("camera") && text.includes("unavailable")) return { kind: "unavailable", title: "Camera unavailable" };
  return { kind: "error", title: "Could not mark" };
}

export function isStaffScanPath(pathname: string | null | undefined) {
  return pathname === STAFF_SCAN_ROUTE || Boolean(pathname?.startsWith(`${STAFF_SCAN_ROUTE}?`));
}

export function staffScanHref(origin: string) {
  const base = String(origin || "").replace(/\/$/, "");
  return `${base}${STAFF_SCAN_ROUTE}`;
}

type ScanWindow = {
  open: (url?: string, target?: string, features?: string) => unknown;
  location: { origin: string };
};

export function openStaffScanRoute(
  router: { push: (href: never) => void },
  options?: { newTab?: boolean; win?: ScanWindow | null }
) {
  const win = options?.win === undefined ? (typeof window !== "undefined" ? (window as ScanWindow) : null) : options.win;
  if (options?.newTab) {
    if (!win?.open) return;
    const opened = win.open(staffScanHref(win.location.origin), "_blank");
    if (opened && typeof opened === "object" && "opener" in opened) {
      (opened as { opener: unknown }).opener = null;
    }
    return;
  }
  router.push(STAFF_SCAN_ROUTE as never);
}
