/**
 * Location attendance: the office saves where the school is (SchoolConfig.attendanceGeoJson) and how far
 * from that point counts as "at school". Staff then mark in / out from their own phone; the server checks
 * the distance, the GPS accuracy and the phone's fake-location flag.
 */
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";

export type AttendanceGeo = { enabled: boolean; lat: number; lng: number; radiusM: number };

export const GEO_RADIUS_CHOICES = [100, 150, 200, 300];
export const GEO_DEFAULT_RADIUS = 150;
/** A fix worse than this (metres) is too rough to tell inside from outside the school. */
export const GEO_MAX_ACCURACY_M = 50;

const OFF: AttendanceGeo = { enabled: false, lat: 0, lng: 0, radiusM: GEO_DEFAULT_RADIUS };

function validPoint(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

export function parseAttendanceGeo(raw: string | null | undefined): AttendanceGeo {
  if (!raw) return { ...OFF };
  try {
    const v = JSON.parse(raw);
    const lat = Number(v?.lat);
    const lng = Number(v?.lng);
    if (!validPoint(lat, lng)) return { ...OFF };
    const radiusM = GEO_RADIUS_CHOICES.includes(Number(v?.radiusM)) ? Number(v.radiusM) : GEO_DEFAULT_RADIUS;
    return { enabled: Boolean(v?.enabled), lat, lng, radiusM };
  } catch {
    return { ...OFF };
  }
}

export async function loadAttendanceGeo() {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { attendanceGeoJson: true } });
  return parseAttendanceGeo(config?.attendanceGeoJson);
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

export async function saveAttendanceGeoCore(user: AccessUser, input: { enabled?: boolean; lat?: number; lng?: number; radiusM?: number }) {
  if (!can(user, "school.edit")) throw new Error("No access.");
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const enabled = Boolean(input.enabled);
  if (!validPoint(lat, lng)) {
    if (enabled) throw new Error("Set the school location first.");
    await prisma.schoolConfig.upsert({ where: { id: "school" }, update: { attendanceGeoJson: "" }, create: { id: "school", attendanceGeoJson: "" } });
    return { ok: true as const, attendanceGeo: { ...OFF } };
  }
  const radiusM = Number(input.radiusM);
  if (!GEO_RADIUS_CHOICES.includes(radiusM)) throw new Error(`Pick a distance: ${GEO_RADIUS_CHOICES.join(", ")} m.`);
  const geo: AttendanceGeo = { enabled, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, radiusM };
  const json = JSON.stringify(geo);
  await prisma.schoolConfig.upsert({ where: { id: "school" }, update: { attendanceGeoJson: json }, create: { id: "school", attendanceGeoJson: json } });
  return { ok: true as const, attendanceGeo: geo };
}

/** Throws a message the teacher can act on when this fix does not count as "at school". */
export function checkAtSchool(geo: AttendanceGeo, fix: { lat?: number; lng?: number; accuracy?: number; mocked?: boolean }) {
  if (!geo.enabled) throw new Error("Location attendance is off for your school.");
  if (fix.mocked) throw new Error("Fake location is on for this phone. Turn it off to mark attendance.");
  const lat = Number(fix.lat);
  const lng = Number(fix.lng);
  if (!validPoint(lat, lng)) throw new Error("Could not read your location. Try again.");
  const accuracy = Math.round(Number(fix.accuracy));
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > GEO_MAX_ACCURACY_M) {
    throw new Error("Weak GPS signal. Step near a window or outside and try again.");
  }
  const meters = Math.round(distanceMeters(geo, { lat, lng }));
  if (meters > geo.radiusM) throw new Error(`You are ${meters} m from school. Mark when you are inside (within ${geo.radiusM} m).`);
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, acc: accuracy, m: meters };
}
