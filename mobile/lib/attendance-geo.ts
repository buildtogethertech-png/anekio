import * as Location from "expo-location";

export type AttendanceGeo = { enabled: boolean; lat: number; lng: number; radiusM: number };
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

/**
 * The phone's location for attendance. A first GPS fix is often rough, so this listens for up to
 * `waitMs` and keeps the best one, stopping early once it is good enough.
 */
export async function readFix(waitMs = 12_000): Promise<Fix> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") throw new Error("Allow location for Anekio to mark attendance here.");
  if (!(await Location.hasServicesEnabledAsync())) throw new Error("Turn on Location on your phone and try again.");
  let best: Fix | null = null;
  await new Promise<void>((resolve) => {
    let sub: Location.LocationSubscription | null = null;
    let finished = false;
    const done = () => {
      finished = true;
      clearTimeout(timer);
      sub?.remove();
      resolve();
    };
    const timer = setTimeout(done, waitMs);
    Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (p) => {
      const fix = toFix(p);
      if (!best || fix.accuracy < best.accuracy || fix.mocked) best = fix;
      if (fix.mocked || fix.accuracy <= 20) done();
    })
      .then((s) => {
        sub = s;
        if (finished) s.remove();
      })
      .catch(done);
  });
  if (!best) best = toFix(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }));
  return best;
}
