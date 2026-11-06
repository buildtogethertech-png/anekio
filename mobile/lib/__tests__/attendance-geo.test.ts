import { Platform } from "react-native";
import * as Location from "expo-location";
import { readFix } from "../attendance-geo";

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
