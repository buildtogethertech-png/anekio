/**
 * How a school takes staff attendance (Settings → Staff attendance), in SchoolConfig.staffAttendanceJson:
 * one way at a time:
 * - QR (default): staff show their QR at the check-in desk.
 * - Location: staff mark in / out from their own phone at school; the server checks the distance from the
 *   saved school point, the GPS accuracy and the phone's fake-location flag.
 * - Bluetooth beacon: staff mark from their phone when it hears the school's beacon (an ESP32 at the office)
 *   strongly enough; GPS can stand in when the beacon is not heard, if the school point is set.
 * The office can always mark by hand. The way not chosen is hidden in the app and refused here.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";

export type StaffAttendanceSetup = {
  qr: boolean;
  location: boolean;
  beacon: boolean;
  lat: number;
  lng: number;
  radiusM: number;
  /** iBeacon UUID the school's beacon sends. */
  beaconUuid: string;
  /** Bluetooth name the beacon sends (iPhones only see this, not the iBeacon UUID). */
  beaconName: string;
  /** Weakest signal (dBm) that still counts as at school. */
  beaconRssi: number;
  /** Beacon not heard: use GPS instead (needs the school point). */
  gpsBackup: boolean;
  /** The beacon sends a code that changes every 30 s (needs the school's beacon key on the ESP32). */
  beaconSecure: boolean;
};

export const GEO_RADIUS_CHOICES = [100, 150, 200, 300];
export const GEO_DEFAULT_RADIUS = 150;
/** A fix worse than this (metres) is too rough to tell inside from outside the school. */
export const GEO_MAX_ACCURACY_M = 50;
/**
 * A rough reading (phones that never get a GPS lock indoors give ±100–300 m from mobile towers) still counts
 * when its middle is inside the school. Such a mark is kept with its accuracy, so the office sees it as rough.
 */
export const GEO_ROUGH_MAX_M = 300;

export const BEACON_DEFAULT_UUID = "8ec76ea3-6668-48da-9866-75be8bc86f4d";
export const BEACON_DEFAULT_NAME = "Anekio-Gate-1";
/** About 2 m, about 5 m, same room, a wall or two, most of the building. */
export const BEACON_RSSI_CHOICES = [-60, -65, -70, -80, -90];
export const BEACON_DEFAULT_RSSI = -80;

const DEFAULT_SETUP: StaffAttendanceSetup = {
  qr: true,
  location: false,
  beacon: false,
  lat: 0,
  lng: 0,
  radiusM: GEO_DEFAULT_RADIUS,
  beaconUuid: BEACON_DEFAULT_UUID,
  beaconName: BEACON_DEFAULT_NAME,
  beaconRssi: BEACON_DEFAULT_RSSI,
  gpsBackup: true,
  beaconSecure: false,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function cleanUuid(raw: unknown) {
  const u = String(raw ?? "").trim().toLowerCase();
  return UUID_RE.test(u) ? u : "";
}

function cleanName(raw: unknown) {
  return String(raw ?? "").trim().slice(0, 40);
}

function validPoint(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

export function parseStaffAttendanceSetup(raw: string | null | undefined): StaffAttendanceSetup {
  if (!raw) return { ...DEFAULT_SETUP };
  try {
    const v = JSON.parse(raw);
    const lat = Number(v?.lat);
    const lng = Number(v?.lng);
    const point = validPoint(lat, lng);
    const beacon = Boolean(v?.beacon);
    const location = !beacon && point && Boolean(v?.location);
    return {
      qr: !location && !beacon,
      location,
      beacon,
      lat: point ? lat : 0,
      lng: point ? lng : 0,
      radiusM: GEO_RADIUS_CHOICES.includes(Number(v?.radiusM)) ? Number(v.radiusM) : GEO_DEFAULT_RADIUS,
      beaconUuid: cleanUuid(v?.beaconUuid) || BEACON_DEFAULT_UUID,
      beaconName: v?.beaconName === undefined ? BEACON_DEFAULT_NAME : cleanName(v.beaconName),
      beaconRssi: BEACON_RSSI_CHOICES.includes(Number(v?.beaconRssi)) ? Number(v.beaconRssi) : BEACON_DEFAULT_RSSI,
      gpsBackup: point && v?.gpsBackup !== false,
      beaconSecure: Boolean(v?.beaconSecure),
    };
  } catch {
    return { ...DEFAULT_SETUP };
  }
}

export async function loadStaffAttendanceSetup() {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { staffAttendanceJson: true } });
  return parseStaffAttendanceSetup(config?.staffAttendanceJson);
}

export async function assertQrAttendanceOn() {
  if (!(await loadStaffAttendanceSetup()).qr) throw new Error("QR attendance is off for your school.");
}

/** "9 m", "450 m", then "1.2 km", "5 km": metres under a kilometre, kilometres after. */
export function formatDistance(meters: number) {
  const m = Math.max(0, Math.round(meters));
  if (m < 1000) return `${m} m`;
  const km = m / 1000;
  return `${km >= 10 ? Math.round(km) : Number(km.toFixed(1))} km`;
}

/** Straight-line distance in metres (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export async function saveStaffAttendanceSetupCore(
  user: AccessUser,
  input: {
    qr?: boolean;
    location?: boolean;
    beacon?: boolean;
    lat?: number;
    lng?: number;
    radiusM?: number;
    beaconUuid?: string;
    beaconName?: string;
    beaconRssi?: number;
    gpsBackup?: boolean;
    beaconSecure?: boolean;
  }
) {
  if (!can(user, "school.edit")) throw new Error("No access.");
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const point = validPoint(lat, lng);
  const location = Boolean(input.location);
  const beacon = Boolean(input.beacon);
  if ([input.qr !== false, location, beacon].filter(Boolean).length !== 1) throw new Error("Pick one way: QR, location or Bluetooth beacon.");
  if (location && !point) throw new Error("Set the school location first.");
  const radiusM = Number(input.radiusM ?? GEO_DEFAULT_RADIUS);
  if (!GEO_RADIUS_CHOICES.includes(radiusM)) throw new Error(`Pick a distance: ${GEO_RADIUS_CHOICES.join(", ")} m.`);
  const beaconUuid = input.beaconUuid === undefined ? BEACON_DEFAULT_UUID : cleanUuid(input.beaconUuid);
  const beaconName = input.beaconName === undefined ? BEACON_DEFAULT_NAME : cleanName(input.beaconName);
  const beaconRssi = Number(input.beaconRssi ?? BEACON_DEFAULT_RSSI);
  const gpsBackup = input.gpsBackup !== false;
  if (beacon) {
    if (!beaconUuid) throw new Error("Beacon ID should look like 8ec76ea3-6668-48da-9866-75be8bc86f4d.");
    if (!BEACON_RSSI_CHOICES.includes(beaconRssi)) throw new Error("Pick how close staff must be to the beacon.");
    if (gpsBackup && !point) throw new Error("Set the school location for the GPS backup, or turn the backup off.");
  }
  const setup: StaffAttendanceSetup = {
    qr: !location && !beacon,
    location,
    beacon,
    lat: point ? Math.round(lat * 1e6) / 1e6 : 0,
    lng: point ? Math.round(lng * 1e6) / 1e6 : 0,
    radiusM,
    beaconUuid: beaconUuid || BEACON_DEFAULT_UUID,
    beaconName,
    beaconRssi: BEACON_RSSI_CHOICES.includes(beaconRssi) ? beaconRssi : BEACON_DEFAULT_RSSI,
    gpsBackup: point && gpsBackup,
    beaconSecure: Boolean(input.beaconSecure),
  };
  // The beacon key and the beacons seen so far live in the same JSON but never leave the server: keep them.
  const secret = await loadBeaconSecret();
  const json = JSON.stringify({
    ...setup,
    beaconSecret: secret.key || (setup.beaconSecure ? newBeaconKey() : undefined),
    beaconBoots: secret.boots,
  });
  await prisma.schoolConfig.upsert({ where: { id: "school" }, update: { staffAttendanceJson: json }, create: { id: "school", staffAttendanceJson: json } });
  return { ok: true as const, staffAttendanceSetup: setup };
}

/** Why a location mark was refused, with the numbers, so the server can log it. */
export class GeoCheckError extends Error {
  constructor(
    message: string,
    readonly geo: {
      reason: "off" | "mocked" | "no_fix" | "weak" | "far" | "no_beacon" | "beacon_other" | "beacon_far" | "beacon_code" | "beacon_old";
      accuracy?: number;
      meters?: number;
      radiusM?: number;
      rssi?: number;
      minRssi?: number;
    }
  ) {
    super(message);
  }
}

/**
 * The reading counts as at school when its whole uncertainty circle fits inside the radius
 * (distance + accuracy), or, as before, when it is sharp (±50 m) and inside.
 */
export function fixCountsInside(meters: number, accuracy: number, radiusM: number) {
  return meters + accuracy <= radiusM || (accuracy <= GEO_MAX_ACCURACY_M && meters <= radiusM);
}

/** Throws a message the teacher can act on when this fix does not count as "at school". */
export function checkAtSchool(setup: StaffAttendanceSetup, fix: { lat?: number; lng?: number; accuracy?: number; mocked?: boolean }) {
  if (!setup.location && !(setup.beacon && setup.gpsBackup)) throw new GeoCheckError("Location attendance is off for your school.", { reason: "off" });
  if (fix.mocked) throw new GeoCheckError("Fake location is on for this phone. Turn it off to mark attendance.", { reason: "mocked" });
  const lat = Number(fix.lat);
  const lng = Number(fix.lng);
  if (!validPoint(lat, lng)) throw new GeoCheckError("Could not read your location. Try again.", { reason: "no_fix" });
  const accuracy = Math.round(Number(fix.accuracy));
  if (!Number.isFinite(accuracy) || accuracy <= 0) throw new GeoCheckError("Could not read your location. Try again.", { reason: "no_fix" });
  const meters = Math.round(distanceMeters(setup, { lat, lng }));
  const geo = { accuracy, meters, radiusM: setup.radiusM };
  if (!fixCountsInside(meters, accuracy, setup.radiusM)) {
    // Outside even if the reading is off by its full accuracy: really away. Otherwise GPS is just too rough to tell.
    if (meters - accuracy > setup.radiusM) {
      throw new GeoCheckError(`You are ${formatDistance(meters)} from school. Mark when you are inside (within ${setup.radiusM} m).`, { reason: "far", ...geo });
    }
    // Rough but centred inside the school: accept it (the office sees "Rough location ±N m" on the day).
    if (accuracy <= GEO_ROUGH_MAX_M && meters <= setup.radiusM) {
      return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, acc: accuracy, m: meters };
    }
    throw new GeoCheckError(`Weak GPS signal (±${accuracy} m). Step near a window or outside and try again.`, { reason: "weak", ...geo });
  }
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, acc: accuracy, m: meters };
}

/** What the phone heard: the school beacon's UUID and / or name, and the signal strength (dBm). */
export type BeaconHit = { uuid?: string; name?: string; rssi?: number; boot?: string; ctr?: number; code?: string };

function sameUuid(a: string, b: string) {
  const strip = (x: string) => x.toLowerCase().replace(/[^0-9a-f]/g, "");
  return Boolean(strip(a)) && strip(a) === strip(b);
}

/**
 * A self mark from the phone ("Check in"): the school beacon when the school uses one (GPS as backup
 * when it is not heard and the backup is on), else location. Returns how it was marked and what to keep.
 */
export function checkSelfMark(
  setup: StaffAttendanceSetup,
  input: { lat?: number; lng?: number; accuracy?: number; mocked?: boolean; beacon?: BeaconHit | null }
): { via: "location" | "beacon"; fix: { lat: number; lng: number; acc: number; m: number } | { rssi: number } } {
  if (setup.beacon && input.beacon) {
    const hit = input.beacon;
    // With the rotating code on, the code itself proves it is our beacon (checked after this, with the key).
    const ours =
      (setup.beaconSecure && Boolean(hit.code)) ||
      sameUuid(String(hit.uuid || ""), setup.beaconUuid) ||
      (Boolean(setup.beaconName) && cleanName(hit.name) === setup.beaconName);
    if (!ours) throw new GeoCheckError("That is not your school's beacon.", { reason: "beacon_other" });
    const rssi = Math.round(Number(hit.rssi));
    if (!Number.isFinite(rssi) || rssi >= 0 || rssi < setup.beaconRssi) {
      throw new GeoCheckError("You are too far from the school beacon. Go closer to it and try again.", {
        reason: "beacon_far",
        rssi: Number.isFinite(rssi) ? rssi : undefined,
        minRssi: setup.beaconRssi,
      });
    }
    return { via: "beacon", fix: { rssi } };
  }
  if (setup.beacon && !setup.gpsBackup) {
    throw new GeoCheckError("School beacon not found. Go near it, turn on Bluetooth and try again.", { reason: "no_beacon" });
  }
  return { via: "location", fix: checkAtSchool(setup, input) };
}

/* ---------- Rotating beacon code ----------
 * The ESP32 picks a random boot ID every time it powers on and counts 30-second slots from then (no clock
 * needed). It sends boot ID, slot and code = first 4 bytes of HMAC-SHA256(key, "AK" + boot + slot).
 * The server knows the key, so it can check the code; the first good code of a boot tells it when that boot
 * started, so later codes must carry the slot that matches the time now (±1). A copied code dies within a minute,
 * codes from an earlier power-on are refused, and nobody without the key can make one.
 */

export const BEACON_SLOT_MS = 30_000;
/** Boots remembered per school (a beacon that restarts after a power cut starts a new one). */
const MAX_BOOTS = 20;

/** Where a boot's slots line up with real time: slot `ctr` was seen at `at` (ms). */
export type BeaconBoot = { ctr: number; at: number };
export type BeaconBoots = Record<string, BeaconBoot>;
/** What the phone read from the beacon's rotating frame. */
export type BeaconCode = { boot?: string; ctr?: number; code?: string };

export function newBeaconKey() {
  return randomBytes(16).toString("hex");
}

export function beaconCodeFor(keyHex: string, boot: string, ctr: number) {
  const msg = Buffer.alloc(10);
  msg.write("AK", 0, "ascii");
  msg.writeUInt32BE(parseInt(boot, 16) >>> 0, 2);
  msg.writeUInt32BE(ctr >>> 0, 6);
  return createHmac("sha256", Buffer.from(keyHex, "hex")).update(msg).digest().subarray(0, 4).toString("hex");
}

/**
 * Is this rotating code good right now? Returns the boots to save when they changed (a new boot, or the
 * beacon's clock drifting a slot), so a beacon left on for months keeps working.
 */
export function verifyBeaconCode(
  keyHex: string,
  boots: BeaconBoots,
  hit: BeaconCode | undefined,
  now: number
): { ok: true; boots: BeaconBoots | null } | { ok: false; reason: "beacon_code" | "beacon_old" } {
  const boot = String(hit?.boot || "").toLowerCase();
  const ctr = Number(hit?.ctr);
  const code = String(hit?.code || "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(keyHex) || !/^[0-9a-f]{8}$/.test(boot) || !/^[0-9a-f]{8}$/.test(code) || !Number.isInteger(ctr) || ctr < 0 || ctr > 0xffffffff) {
    return { ok: false, reason: "beacon_code" };
  }
  const want = Buffer.from(beaconCodeFor(keyHex, boot, ctr), "hex");
  if (!timingSafeEqual(want, Buffer.from(code, "hex"))) return { ok: false, reason: "beacon_code" };
  const known = boots[boot];
  if (!known) {
    // A boot we have not seen: the beacon was just powered on. Remember when, drop the oldest boots.
    const next = Object.entries({ ...boots, [boot]: { ctr, at: now } })
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX_BOOTS);
    return { ok: true, boots: Object.fromEntries(next) };
  }
  const expected = known.ctr + Math.floor((now - known.at) / BEACON_SLOT_MS);
  if (Math.abs(ctr - expected) > 1) return { ok: false, reason: "beacon_old" };
  // Re-anchor when the beacon's clock has drifted a slot, so the window keeps following it.
  return { ok: true, boots: ctr === expected ? null : { ...boots, [boot]: { ctr, at: now } } };
}

/** The school's beacon key and the boots seen so far (server only: never in the record). */
export async function loadBeaconSecret() {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { staffAttendanceJson: true } });
  try {
    const v = JSON.parse(config?.staffAttendanceJson || "{}");
    const key = /^[0-9a-f]{32}$/.test(String(v?.beaconSecret || "")) ? String(v.beaconSecret) : "";
    const boots: BeaconBoots = v?.beaconBoots && typeof v.beaconBoots === "object" ? v.beaconBoots : {};
    return { key, boots };
  } catch {
    return { key: "", boots: {} as BeaconBoots };
  }
}

async function writeBeaconSecret(patch: { beaconSecret?: string; beaconBoots?: BeaconBoots }) {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { staffAttendanceJson: true } });
  let v: Record<string, unknown> = {};
  try {
    v = JSON.parse(config?.staffAttendanceJson || "{}") || {};
  } catch {
    v = {};
  }
  const json = JSON.stringify({ ...v, ...patch });
  await prisma.schoolConfig.upsert({ where: { id: "school" }, update: { staffAttendanceJson: json }, create: { id: "school", staffAttendanceJson: json } });
}

/** Settings → Staff attendance → Beacon key: the key to put on the ESP32 (made on first ask). `rotate` makes a new one. */
export async function beaconKeyCore(user: AccessUser, input: { rotate?: boolean }) {
  if (!can(user, "school.edit")) throw new Error("No access.");
  const current = await loadBeaconSecret();
  if (current.key && !input.rotate) return { key: current.key };
  const key = newBeaconKey();
  // A new key: beacons flashed with the old one stop working, and their boots mean nothing now.
  await writeBeaconSecret({ beaconSecret: key, beaconBoots: {} });
  return { key };
}

/** Check a rotating code for a check in, and save the boots when they changed. Throws when the code is bad. */
export async function assertBeaconCode(hit: BeaconCode | undefined, now = Date.now()) {
  const { key, boots } = await loadBeaconSecret();
  if (!key) throw new GeoCheckError("The school beacon is not set up yet. Ask the office.", { reason: "beacon_code" });
  const result = verifyBeaconCode(key, boots, hit, now);
  if (!result.ok) {
    throw new GeoCheckError(
      result.reason === "beacon_old"
        ? "That beacon code has expired. Stay near the school beacon and try again."
        : hit?.code
          ? "That is not your school's beacon."
          : "This beacon does not send the school's code. Ask the office to update it.",
      { reason: result.reason }
    );
  }
  if (result.boots) await writeBeaconSecret({ beaconBoots: result.boots });
}
