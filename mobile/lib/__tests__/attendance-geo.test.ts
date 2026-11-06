import { Platform } from "react-native";
import * as Location from "expo-location";
import { readFix, waitForFix, type Fix, type FixWatcher } from "../attendance-geo";

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

const originalOs = Platform.OS;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function setOs(os: typeof Platform.OS) {
  Object.defineProperty(Platform, "OS", { configurable: true, writable: true, value: os });
}

function setGeo(getCurrentPosition: jest.Mock) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: { getCurrentPosition } } });
}

afterEach(() => {
  setOs(originalOs);
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

describe("readFix on web", () => {
  beforeEach(() => setOs("web"));

  it("asks the browser, not expo-location's watcher", async () => {
    const get = jest.fn((ok: PositionCallback) => ok({ coords: { latitude: 28.6, longitude: 77.2, accuracy: 18.4 } } as GeolocationPosition));
    setGeo(get);
    await expect(readFix()).resolves.toEqual({ lat: 28.6, lng: 77.2, accuracy: 18, mocked: false });
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it("says how to allow location when the browser blocks it", async () => {
    setGeo(jest.fn((_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError)));
    await expect(readFix()).rejects.toThrow(/Allow location for this site/);
  });
});

describe("waitForFix", () => {
  function fakeWatcher(startedAgoMs: number) {
    let best: Fix | null = null;
    const subs = new Set<(f: Fix) => void>();
    const since = Date.now() - startedAgoMs;
    const w: FixWatcher & { emit: (f: Fix) => void } = {
      start: () => Promise.resolve(),
      best: () => best,
      since: () => since,
      subscribe: (cb) => {
        subs.add(cb);
        return () => subs.delete(cb);
      },
      stop: () => undefined,
      emit: (f) => {
        if (!best || f.accuracy < best.accuracy) best = f;
        subs.forEach((cb) => cb(f));
      },
    };
    return w;
  }
  const at = (accuracy: number): Fix => ({ lat: 28.6, lng: 77.2, accuracy, mocked: false });

  it("takes a very good reading at once", async () => {
    const w = fakeWatcher(0);
    const p = waitForFix(w);
    w.emit(at(12));
    await expect(p).resolves.toMatchObject({ accuracy: 12 });
  });

  it("uses a warm reading that is already there (sheet opened earlier)", async () => {
    const w = fakeWatcher(5_000);
    w.emit(at(38));
    const progress = jest.fn();
    await expect(waitForFix(w, progress)).resolves.toMatchObject({ accuracy: 38 });
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ accuracy: 38 }));
  });

  it("gives a rough reading a moment to improve, then takes the best", async () => {
    jest.useFakeTimers();
    try {
      const w = fakeWatcher(0);
      const p = waitForFix(w, undefined, 10_000);
      w.emit(at(90));
      await jest.advanceTimersByTimeAsync(3_000);
      w.emit(at(60));
      await jest.advanceTimersByTimeAsync(7_500);
      await expect(p).resolves.toMatchObject({ accuracy: 60 });
    } finally {
      jest.useRealTimers();
    }
  });

  it("says so when there is no reading at all", async () => {
    jest.useFakeTimers();
    try {
      const failed = expect(waitForFix(fakeWatcher(0), undefined, 10_000)).rejects.toThrow(/Could not find your location/);
      await jest.advanceTimersByTimeAsync(10_500);
      await failed;
    } finally {
      jest.useRealTimers();
    }
  });
});
