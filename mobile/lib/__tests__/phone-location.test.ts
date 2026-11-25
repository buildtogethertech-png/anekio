import { Platform } from "react-native";
import * as Location from "expo-location";
import { createFixWatcher, GeoError } from "../attendance-geo";

jest.mock("expo-location", () => ({
  Accuracy: { BestForNavigation: 6 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  getProviderStatusAsync: jest.fn(),
  enableNetworkProviderAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

const L = Location as jest.Mocked<typeof Location>;
const fine = { status: "granted", android: { accuracy: "fine" } } as never;
const coarse = { status: "granted", android: { accuracy: "coarse" } } as never;
const provider = (on: boolean, gps: boolean, net = true) => ({ locationServicesEnabled: on, gpsAvailable: gps, networkAvailable: net }) as never;
const originalOs = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, "OS", { configurable: true, writable: true, value: "android" });
  L.getForegroundPermissionsAsync.mockResolvedValue(fine);
  L.watchPositionAsync.mockResolvedValue({ remove: jest.fn() } as never);
  L.enableNetworkProviderAsync.mockResolvedValue(undefined);
});
afterAll(() => Object.defineProperty(Platform, "OS", { configurable: true, writable: true, value: originalOs }));

async function startError() {
  try {
    await createFixWatcher().start(true);
    return "ok";
  } catch (e) {
    return e instanceof GeoError ? e.code : String(e);
  }
}

describe("check in turns location on with Android's own dialog", () => {
  it("location off: shows the dialog, and carries on when the teacher taps Turn on", async () => {
    L.getProviderStatusAsync.mockResolvedValueOnce(provider(false, false)).mockResolvedValueOnce(provider(true, true));
    expect(await startError()).toBe("ok");
    expect(L.enableNetworkProviderAsync).toHaveBeenCalled();
    expect(L.watchPositionAsync).toHaveBeenCalled();
  });

  it("location still off after the dialog: says so", async () => {
    L.getProviderStatusAsync.mockResolvedValue(provider(false, false));
    L.enableNetworkProviderAsync.mockRejectedValue(new Error("denied"));
    expect(await startError()).toBe("services_off");
  });

  it("GPS off (Battery saver): the dialog can't fix it, so it says GPS is off", async () => {
    L.getProviderStatusAsync.mockResolvedValue(provider(true, false));
    expect(await startError()).toBe("gps_off");
    expect(L.watchPositionAsync).not.toHaveBeenCalled();
  });

  it("all on: no dialog", async () => {
    L.getProviderStatusAsync.mockResolvedValue(provider(true, true));
    expect(await startError()).toBe("ok");
    expect(L.enableNetworkProviderAsync).not.toHaveBeenCalled();
  });

  it("approximate only: asks again for precise; refused stays approximate", async () => {
    L.getProviderStatusAsync.mockResolvedValue(provider(true, true));
    L.getForegroundPermissionsAsync.mockResolvedValue(coarse);
    L.requestForegroundPermissionsAsync.mockResolvedValueOnce(fine);
    expect(await startError()).toBe("ok");
    L.requestForegroundPermissionsAsync.mockResolvedValueOnce(coarse);
    expect(await startError()).toBe("approximate");
  });
});
