/**
 * How a school takes staff attendance (Settings → Staff attendance), in SchoolConfig.staffAttendanceJson:
 * one way at a time, never both:
 * - QR (default): staff show their QR at the check-in desk.
 * - Location: staff mark in / out from their own phone at school; the server checks the distance from the
 *   saved school point, the GPS accuracy and the phone's fake-location flag.
 * The office can always mark by hand. The way not chosen is hidden in the app and refused here.
 */
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";

export type StaffAttendanceSetup = { qr: boolean; location: boolean; lat: number; lng: number; radiusM: number };

export const GEO_RADIUS_CHOICES = [100, 150, 200, 300];
export const GEO_DEFAULT_RADIUS = 150;
/** A fix worse than this (metres) is too rough to tell inside from outside the school. */
export const GEO_MAX_ACCURACY_M = 50;

const DEFAULT_SETUP: StaffAttendanceSetup = { qr: true, location: false, lat: 0, lng: 0, radiusM: GEO_DEFAULT_RADIUS };

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
    const location = point && Boolean(v?.location);
    return {
      qr: !location,
      location,
      lat: point ? lat : 0,
      lng: point ? lng : 0,
      radiusM: GEO_RADIUS_CHOICES.includes(Number(v?.radiusM)) ? Number(v.radiusM) : GEO_DEFAULT_RADIUS,
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
  input: { qr?: boolean; location?: boolean; lat?: number; lng?: number; radiusM?: number }
) {
  if (!can(user, "school.edit")) throw new Error("No access.");
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const point = validPoint(lat, lng);
  const location = Boolean(input.location);
  if (location === (input.qr !== false)) throw new Error("Pick one way: QR or location.");
  if (location && !point) throw new Error("Set the school location first.");
  const radiusM = Number(input.radiusM ?? GEO_DEFAULT_RADIUS);
  if (!GEO_RADIUS_CHOICES.includes(radiusM)) throw new Error(`Pick a distance: ${GEO_RADIUS_CHOICES.join(", ")} m.`);
  const setup: StaffAttendanceSetup = {
    qr: !location,
    location,
    lat: point ? Math.round(lat * 1e6) / 1e6 : 0,
    lng: point ? Math.round(lng * 1e6) / 1e6 : 0,
    radiusM,
  };
  const json = JSON.stringify(setup);
  await prisma.schoolConfig.upsert({ where: { id: "school" }, update: { staffAttendanceJson: json }, create: { id: "school", staffAttendanceJson: json } });
  return { ok: true as const, staffAttendanceSetup: setup };
}

/** Throws a message the teacher can act on when this fix does not count as "at school". */
export function checkAtSchool(setup: StaffAttendanceSetup, fix: { lat?: number; lng?: number; accuracy?: number; mocked?: boolean }) {
  if (!setup.location) throw new Error("Location attendance is off for your school.");
  if (fix.mocked) throw new Error("Fake location is on for this phone. Turn it off to mark attendance.");
  const lat = Number(fix.lat);
  const lng = Number(fix.lng);
  if (!validPoint(lat, lng)) throw new Error("Could not read your location. Try again.");
  const accuracy = Math.round(Number(fix.accuracy));
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > GEO_MAX_ACCURACY_M) {
    throw new Error("Weak GPS signal. Step near a window or outside and try again.");
  }
  const meters = Math.round(distanceMeters(setup, { lat, lng }));
  if (meters > setup.radiusM) throw new Error(`You are ${formatDistance(meters)} from school. Mark when you are inside (within ${setup.radiusM} m).`);
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, acc: accuracy, m: meters };
}
