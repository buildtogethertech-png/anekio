import * as Location from "expo-location";
import { Platform } from "react-native";

/** Settings → Staff attendance: which way the school takes it, the school point, and the beacon. Same shape as the server. */
export type StaffAttendanceSetup = {
  qr: boolean;
  location: boolean;
  beacon?: boolean;
  lat: number;
  lng: number;
  radiusM: number;
  beaconUuid?: string;
  beaconName?: string;
  beaconRssi?: number;
  gpsBackup?: boolean;
  beaconSecure?: boolean;
};

export const BEACON_DEFAULT_UUID = "8ec76ea3-6668-48da-9866-75be8bc86f4d";
export const BEACON_DEFAULT_NAME = "Anekio-Gate-1";
export const BEACON_DEFAULT_RSSI = -80;
export const BEACON_RSSI_CHOICES = [
  { rssi: -60, label: "2 m", hint: "About 1–2 m: standing right at the beacon" },
  { rssi: -65, label: "5 m", hint: "About 3–5 m: near the desk" },
  { rssi: -70, label: "Room", hint: "Same room" },
  { rssi: -80, label: "Walls", hint: "A wall or two away" },
  { rssi: -90, label: "Far", hint: "Most of the building" },
];

/** Staff check in from their own phone (location or beacon), not by QR at the desk. */
export function selfCheckIn(setup?: Partial<StaffAttendanceSetup> | null) {
  return Boolean(setup?.location || setup?.beacon);
}
export type Fix = { lat: number; lng: number; accuracy: number; mocked: boolean };

export const GEO_RADIUS_CHOICES = [100, 150, 200, 300];
/** Same limit as the server: a rougher fix cannot tell inside from outside the school. */
export const GEO_MAX_ACCURACY_M = 50;

/**
 * The reading counts as at school when its whole uncertainty circle fits inside the radius
 * (distance + accuracy), or when it is sharp (±50 m) and inside. Same rule as the server.
 */
/** Same as the server: a rough reading (no GPS lock) still counts when its middle is inside, and is shown as rough. */
export const GEO_ROUGH_MAX_M = 300;
export function fixCountsRough(meters: number, accuracy: number, radiusM: number) {
  return !fixCountsInside(meters, accuracy, radiusM) && accuracy <= GEO_ROUGH_MAX_M && meters <= radiusM;
}

export function fixCountsInside(meters: number, accuracy: number, radiusM: number) {
  return meters + accuracy <= radiusM || (accuracy <= GEO_MAX_ACCURACY_M && meters <= radiusM);
}

/** A location problem found on the phone (never reached the server), with a code we can log and act on. */
export type GeoFailCode = "permission" | "services_off" | "gps_off" | "approximate" | "no_fix";
export class GeoError extends Error {
  constructor(readonly code: GeoFailCode, message: string, readonly accuracy?: number) {
    super(message);
  }
}
export const PRECISE_OFF_TEXT = "Precise location is off for Anekio. Turn on “Precise location” in settings, then try again.";
/** iOS doesn't say when Precise Location is off; a reading this rough means it is. */
const APPROXIMATE_M = 1000;

export const GPS_OFF_TEXT = "GPS is off on this phone (often Battery saver). Turn off Battery saver, then try again.";

/** What the phone allows right now, for the logs and for the "Turn on" prompts. */
export type PhoneLocation = { on: boolean; gps: boolean; net: boolean; precise: boolean | null; allowed: boolean };

export async function phoneLocation(): Promise<PhoneLocation> {
  const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
  const allowed = perm?.status === "granted";
  const precise = perm?.android?.accuracy ? perm.android.accuracy === "fine" : null;
  if (Platform.OS !== "android") {
    const on = await Location.hasServicesEnabledAsync().catch(() => true);
    return { on, gps: on, net: on, precise, allowed };
  }
  const s = await Location.getProviderStatusAsync().catch(() => null);
  if (!s) return { on: true, gps: true, net: true, precise, allowed };
  return { on: s.locationServicesEnabled, gps: s.gpsAvailable !== false, net: s.networkAvailable !== false, precise, allowed };
}

/**
 * Something on the phone that will make Check in fail, found without asking anything (for the warning
 * shown when the sheet opens). Not asked for location yet is not a problem: Check in asks.
 */
export async function phoneLocationProblem(): Promise<GeoFailCode | null> {
  if (Platform.OS === "web") return null;
  const s = await phoneLocation().catch(() => null);
  if (!s) return null;
  if (!s.on) return "services_off";
  if (s.allowed && s.precise === false) return "approximate";
  if (!s.gps) return "gps_off";
  if (Platform.OS === "android" && !s.net) return "services_off";
  return null;
}

/**
 * Android: location off, or on without GPS (Battery saver / "low accuracy" mode), gives readings hundreds of
 * metres off. Show Android's own "Turn on location / Location accuracy" dialog: one tap fixes it. Battery saver
 * can't be turned off by an app, so that one ends in a message. True when it changed something.
 */
async function ensurePhoneLocationOn() {
  let s = await phoneLocation();
  if (s.on && s.gps && s.net) return false;
  await Location.enableNetworkProviderAsync().catch(() => undefined);
  s = await phoneLocation();
  if (!s.on) throw new GeoError("services_off", "Location is off. Tap Turn on and allow it.");
  if (!s.gps) throw new GeoError("gps_off", GPS_OFF_TEXT);
  return true;
}

/** The warning's "Turn on": Android's own dialogs (precise location, then location / accuracy). Returns what is still wrong. */
export async function turnOnPhoneLocation(): Promise<GeoFailCode | null> {
  const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (perm?.status === "granted" && perm.android?.accuracy === "coarse") await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (Platform.OS === "android") await Location.enableNetworkProviderAsync().catch(() => undefined);
  return phoneLocationProblem();
}

/** Android "Approximate" only: asking again shows Android's "Change to precise location?" dialog. */
async function askPrecise() {
  const again = await Location.requestForegroundPermissionsAsync().catch(() => null);
  if (again?.android?.accuracy !== "fine") throw new GeoError("approximate", PRECISE_OFF_TEXT);
}

/** "9 m", "450 m", then "1.2 km", "5 km": metres under a kilometre, kilometres after. */
export function formatDistance(meters: number) {
  const m = Math.max(0, Math.round(meters));
  if (m < 1000) return `${m} m`;
  const km = m / 1000;
  return `${km >= 10 ? Math.round(km) : Number(km.toFixed(1))} km`;
}

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
    const current = await Location.getForegroundPermissionsAsync();
    const perm = ask && current.status !== "granted" ? await Location.requestForegroundPermissionsAsync() : current;
    if (perm.status !== "granted") {
      if (ask) throw new GeoError("permission", "Allow location for Anekio to mark attendance here.");
      return;
    }
    // Android "Approximate" only: readings are hundreds of metres off, so marking can never pass.
    if (ask && perm.android?.accuracy === "coarse") await askPrecise();
    if (ask && Platform.OS === "android") await ensurePhoneLocationOn();
    else if (!(await Location.hasServicesEnabledAsync())) {
      if (ask) throw new GeoError("services_off", "Turn on Location on your phone and try again.");
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
      if (sub && ask) {
        // Already running (warmed up when the sheet opened): still check precise, location and GPS are on.
        const perm = await Location.getForegroundPermissionsAsync();
        let changed = false;
        if (perm.android?.accuracy === "coarse") {
          await askPrecise();
          changed = true;
        }
        if (Platform.OS === "android" && (await ensurePhoneLocationOn())) changed = true;
        // Turned on just now: restart GPS so the old rough readings aren't used.
        if (changed) {
          safeRemove(sub);
          sub = null;
          best = null;
        }
      }
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

/** After this long, a ±100 m reading is sent too (the server accepts it when the whole circle is inside the school). */
const ROUGH_OK_MS = 10_000;
const ROUGH_OK_M = 100;

/**
 * Waits for a reading good enough to mark: at once when it is very good (or fake, so the server can
 * say so), after a short settle when it is within ±50 m, after 10 s when within ±100 m, else the best
 * one after `waitMs`. Indoors GPS often needs 15–20 s, so the default wait is 20 s.
 */
export async function waitForFix(watcher: FixWatcher, onProgress?: (fix: Fix) => void, waitMs = 20_000): Promise<Fix> {
  await watcher.start(true);
  return new Promise((resolve, reject) => {
    let over = false;
    const finish = (fix: Fix | null) => {
      if (over) return;
      over = true;
      clearInterval(tick);
      clearTimeout(timer);
      unsub();
      if (fix && Platform.OS === "ios" && fix.accuracy >= APPROXIMATE_M) reject(new GeoError("approximate", PRECISE_OFF_TEXT, fix.accuracy));
      else if (fix) resolve(fix);
      else reject(new GeoError("no_fix", "Could not find your location. Step near a window or outside and try again."));
    };
    const check = () => {
      const b = watcher.best();
      if (!b) return;
      const ran = Date.now() - watcher.since();
      if (b.mocked || b.accuracy <= GREAT_ACCURACY_M || (ran >= SETTLE_MS && b.accuracy <= GEO_MAX_ACCURACY_M) || (ran >= ROUGH_OK_MS && b.accuracy <= ROUGH_OK_M)) finish(b);
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
export async function readFix(waitMs = 20_000): Promise<Fix> {
  if (Platform.OS === "web") return readWebFix(waitMs);
  const watcher = createFixWatcher();
  try {
    return await waitForFix(watcher, undefined, waitMs);
  } finally {
    watcher.stop();
  }
}

/**
 * Browser: expo-location's web watcher cannot be stopped (removeSubscription is missing), so ask the browser directly.
 * Laptops often have no GPS and time out on a high-accuracy request, so a failed one is retried with Wi-Fi accuracy.
 */
function readWebFix(waitMs: number): Promise<Fix> {
  const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
  if (!geo) return Promise.reject(new Error("This browser cannot share its location."));
  const ask = (high: boolean) =>
    new Promise<Fix>((resolve, reject) =>
      geo.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy ?? 9999), mocked: false }),
        reject,
        high ? { enableHighAccuracy: true, timeout: waitMs, maximumAge: 0 } : { enableHighAccuracy: false, timeout: waitMs, maximumAge: 60_000 }
      )
    );
  return ask(true)
    .catch((error: GeolocationPositionError) => (error.code === error.PERMISSION_DENIED ? Promise.reject(error) : ask(false)))
    .catch((error: GeolocationPositionError) => {
      throw new Error(
        error.code === error.PERMISSION_DENIED
          ? "Allow location for this site in the browser, then try again."
          : error.code === error.POSITION_UNAVAILABLE
            ? "This computer could not find its location. On a Mac, turn on Location Services for the browser (System Settings → Privacy & Security → Location Services), or take the point from a phone at school."
            : "Could not read your location. Try again."
      );
    });
}
