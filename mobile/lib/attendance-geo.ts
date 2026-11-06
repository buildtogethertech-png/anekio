import * as Location from "expo-location";
import { Platform } from "react-native";

/** Settings → Staff attendance: which ways the school takes it, and the school point for location. */
export type StaffAttendanceSetup = { qr: boolean; location: boolean; lat: number; lng: number; radiusM: number };
export type Fix = { lat: number; lng: number; accuracy: number; mocked: boolean };

export const GEO_RADIUS_CHOICES = [100, 150, 200, 300];
/** Same limit as the server: a rougher fix cannot tell inside from outside the school. */
export const GEO_MAX_ACCURACY_M = 50;

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toFix(p: Location.LocationObject): Fix {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    accuracy: Math.round(p.coords.accuracy ?? 9999),
    mocked: Boolean(p.mocked),
  };
}

function safeRemove(sub: Location.LocationSubscription | null) {
  try {
    sub?.remove();
  } catch {
    // already stopped
  }
}

/** Good enough at once; anything up to the server's limit is taken after a short wait. */
const GREAT_ACCURACY_M = 20;
const SETTLE_MS = 2_000;
/** A reading older than this is not used for a new mark. */
const FRESH_MS = 30_000;

export type FixWatcher = {
  /** Starts GPS. ask=false only starts when location is already allowed (no prompt). */
  start: (ask: boolean) => Promise<void>;
  best: () => Fix | null;
  /** When GPS started, for "has it had time to settle". */
  since: () => number;
  subscribe: (cb: (fix: Fix) => void) => () => void;
  stop: () => void;
};

/**
 * Keeps GPS running and remembers the best recent reading. The attendance sheet starts one as soon as
 * it opens, so by the time the teacher taps, a good reading is usually there already.
 */
export function createFixWatcher(): FixWatcher {
  let best: (Fix & { at: number }) | null = null;
  let sub: Location.LocationSubscription | null = null;
  let since = 0;
  let starting: Promise<void> | null = null;
  let stopped = false;
  const listeners = new Set<(fix: Fix) => void>();

  function push(fix: Fix) {
    const now = Date.now();
    if (!best || now - best.at > FRESH_MS || fix.accuracy <= best.accuracy || fix.mocked) best = { ...fix, at: now };
    listeners.forEach((cb) => cb(fix));
  }

  async function begin(ask: boolean) {
    const perm = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      if (ask) throw new Error("Allow location for Anekio to mark attendance here.");
      return;
    }
    if (!(await Location.hasServicesEnabledAsync())) {
      if (ask) throw new Error("Turn on Location on your phone and try again.");
      return;
    }
    if (sub || stopped) return;
    const s = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
      (p) => push(toFix(p))
    );
    if (stopped) safeRemove(s);
    else {
      sub = s;
      since = Date.now();
    }
  }

  return {
    async start(ask) {
      stopped = false;
      if (starting) await starting.catch(() => undefined);
      if (sub) return;
      starting = begin(ask);
      try {
        await starting;
      } finally {
        starting = null;
      }
    },
    best: () => (best && Date.now() - best.at <= FRESH_MS ? best : null),
    since: () => since,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    stop() {
      stopped = true;
      safeRemove(sub);
      sub = null;
      listeners.clear();
    },
  };
}

/**
 * Waits for a reading good enough to mark: at once when it is very good (or fake, so the server can
 * say so), after a short settle when it is within the server's limit, else the best one after `waitMs`.
 */
export async function waitForFix(watcher: FixWatcher, onProgress?: (fix: Fix) => void, waitMs = 10_000): Promise<Fix> {
  await watcher.start(true);
  return new Promise((resolve, reject) => {
    let over = false;
    const finish = (fix: Fix | null) => {
      if (over) return;
      over = true;
      clearInterval(tick);
      clearTimeout(timer);
      unsub();
      if (fix) resolve(fix);
      else reject(new Error("Could not find your location. Step near a window or outside and try again."));
    };
    const check = () => {
      const b = watcher.best();
      if (!b) return;
      const settled = Date.now() - watcher.since() >= SETTLE_MS;
      if (b.mocked || b.accuracy <= GREAT_ACCURACY_M || (settled && b.accuracy <= GEO_MAX_ACCURACY_M)) finish(b);
    };
    const unsub = watcher.subscribe((fix) => {
      onProgress?.(fix);
      check();
    });
    const tick = setInterval(check, 400);
    const timer = setTimeout(() => finish(watcher.best()), waitMs);
    const now = watcher.best();
    if (now) onProgress?.(now);
    check();
  });
}

/** One reading (Settings: school point, Test here). */
export async function readFix(waitMs = 10_000): Promise<Fix> {
  if (Platform.OS === "web") return readWebFix(waitMs);
  const watcher = createFixWatcher();
  try {
    return await waitForFix(watcher, undefined, waitMs);
  } finally {
    watcher.stop();
  }
}

/** Browser: expo-location's web watcher cannot be stopped (removeSubscription is missing), so ask the browser directly. */
function readWebFix(waitMs: number): Promise<Fix> {
  return new Promise((resolve, reject) => {
    const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
    if (!geo) {
      reject(new Error("This browser cannot share its location."));
      return;
    }
    geo.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy ?? 9999), mocked: false }),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? "Allow location for this site in the browser, then try again."
              : "Could not read your location. Try again."
          )
        ),
      { enableHighAccuracy: true, timeout: waitMs, maximumAge: 0 }
    );
  });
}
