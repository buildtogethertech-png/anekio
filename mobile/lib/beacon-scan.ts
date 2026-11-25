import { PermissionsAndroid, Platform } from "react-native";

/**
 * The school's Bluetooth beacon (an ESP32 sending iBeacon, named e.g. "Anekio-Gate-1").
 * Android sees the iBeacon UUID; iPhones hide iBeacon data from apps, so there we match the name.
 */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Plain base64 → bytes (no atob dependency). */
export function decodeBase64(b64: string) {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function hexOf(b64?: string | null) {
  if (!b64) return "";
  return [...decodeBase64(b64)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Apple iBeacon frame: 4C 00 02 15 <uuid 16> <major 2> <minor 2> <tx 1>. */
export function parseIBeacon(manufacturerData?: string | null) {
  if (!manufacturerData) return null;
  const b = decodeBase64(manufacturerData);
  if (b.length < 25 || b[0] !== 0x4c || b[1] !== 0x00 || b[2] !== 0x02 || b[3] !== 0x15) return null;
  const hex = [...b.slice(4, 20)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const tx = b[24] > 127 ? b[24] - 256 : b[24];
  return { uuid, major: (b[20] << 8) | b[21], minor: (b[22] << 8) | b[23], tx };
}

/**
 * The Anekio beacon's rotating frame (manufacturer data, test company ID 0xFFFF):
 * FF FF 'A' 'K' <boot 4> <slot 4> <code 4>. The code changes every 30 s; only the server can check it.
 */
export function parseRotating(manufacturerData?: string | null) {
  if (!manufacturerData) return null;
  const b = decodeBase64(manufacturerData);
  if (b.length < 16 || b[0] !== 0xff || b[1] !== 0xff || b[2] !== 0x41 || b[3] !== 0x4b) return null;
  const hex = (from: number) => [...b.slice(from, from + 4)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const ctr = ((b[8] << 24) >>> 0) + (b[9] << 16) + (b[10] << 8) + b[11];
  return { boot: hex(4), ctr, code: hex(12) };
}

/**
 * Is this advert the school's beacon, and by what? The UUID in the iBeacon data (either byte order:
 * the ESP32 library sends it reversed), else the Bluetooth name.
 */
export function matchSchoolBeacon(
  device: { name?: string | null; localName?: string | null; manufacturerData?: string | null },
  want: { uuid: string; name: string; secure?: boolean }
): "uuid" | "name" | "code" | null {
  // Rotating code on: any Anekio frame counts here; the server checks the code with the school's key.
  if (want.secure) return parseRotating(device.manufacturerData) ? "code" : null;
  const flat = want.uuid.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (flat.length === 32) {
    const mfr = hexOf(device.manufacturerData);
    const reversed = flat.match(/../g)!.reverse().join("");
    if (mfr.includes(flat) || mfr.includes(reversed)) return "uuid";
  }
  if (want.name && (device.name === want.name || device.localName === want.name)) return "name";
  return null;
}

export async function askBlePermissions() {
  if (Platform.OS !== "android") return true;
  const api = Number(Platform.Version);
  const wanted =
    api >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

/** How many recent readings make up the signal (one reading jumps around a lot). Same for check in and the test screen. */
export const BEACON_WINDOW = 5;

/** The signal check in uses: the average of the last few readings. */
export function beaconAverage(rssis: number[]) {
  const last = rssis.slice(-BEACON_WINDOW);
  return last.length ? Math.round(last.reduce((a, b) => a + b, 0) / last.length) : null;
}

export type BeaconProblem = "unsupported" | "permission" | "bluetooth_off" | "not_found" | "weak";
export type BeaconHitInfo = { uuid?: string; name?: string; rssi: number; boot?: string; ctr?: number; code?: string };
export type BeaconScan = { hit: BeaconHitInfo | null; problem: BeaconProblem | null; rssi?: number };

export const BEACON_PROBLEM_TEXT: Record<BeaconProblem, string> = {
  unsupported: "This app version can't use the school beacon. Update Anekio from the Play Store.",
  permission: "Allow Bluetooth (Nearby devices) and Location for Anekio, then try again.",
  bluetooth_off: "Turn on Bluetooth, then try again.",
  not_found: "School beacon not found. Go near it and try again.",
  weak: "School beacon is too far. Go closer to it and try again.",
};

type Manager = import("react-native-ble-plx").BleManager;
let shared: Manager | null = null;

async function manager() {
  if (shared) return shared;
  const { BleManager } = await import("react-native-ble-plx");
  shared = new BleManager();
  return shared;
}

/**
 * Listen for the school beacon for up to `timeoutMs`. Done early once a few readings average strong enough.
 * The signal is the average of the last few readings (one reading jumps around a lot).
 */
export async function scanForBeacon(opts: {
  uuid: string;
  name: string;
  minRssi: number;
  /** The school uses the rotating code: match by it and send the newest code. */
  secure?: boolean;
  timeoutMs?: number;
  onRssi?: (rssi: number) => void;
}): Promise<BeaconScan> {
  if (Platform.OS === "web") return { hit: null, problem: "unsupported" };
  let m: Manager;
  try {
    m = await manager();
  } catch {
    return { hit: null, problem: "unsupported" };
  }
  if (!(await askBlePermissions())) return { hit: null, problem: "permission" };
  try {
    const { State } = await import("react-native-ble-plx");
    let state = await m.state();
    // Right after start-up the state can still be Unknown for a moment.
    for (let i = 0; i < 5 && (state === State.Unknown || state === State.Resetting); i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      state = await m.state();
    }
    if (state === State.Unsupported || state === State.Unauthorized) return { hit: null, problem: state === State.Unauthorized ? "permission" : "unsupported" };
    if (state !== State.PoweredOn) return { hit: null, problem: "bluetooth_off" };
  } catch {
    return { hit: null, problem: "unsupported" };
  }

  const readings: number[] = [];
  let seen: Omit<BeaconHitInfo, "rssi"> = {};
  const average = () => beaconAverage(readings) ?? -127;
  return new Promise<BeaconScan>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      m.stopDeviceScan();
      if (!readings.length) return resolve({ hit: null, problem: "not_found" });
      const rssi = average();
      resolve(rssi >= opts.minRssi ? { hit: { ...seen, rssi }, problem: null, rssi } : { hit: null, problem: "weak", rssi });
    };
    const timer = setTimeout(finish, opts.timeoutMs ?? 6000);
    m.startDeviceScan(null, { allowDuplicates: true, scanMode: 2 }, (err, device) => {
      if (err) {
        finished = true;
        clearTimeout(timer);
        m.stopDeviceScan();
        resolve({ hit: null, problem: /authoriz|permission/i.test(err.message) ? "permission" : /powered off/i.test(err.message) ? "bluetooth_off" : "unsupported" });
        return;
      }
      const by = device && device.rssi != null ? matchSchoolBeacon(device, opts) : null;
      if (!device || device.rssi == null || !by) return;
      // Matched here already, so tell the server what it knows the beacon by (the newest code, when rotating).
      seen = by === "code" ? { ...parseRotating(device.manufacturerData)! } : by === "uuid" ? { uuid: opts.uuid } : { name: opts.name };
      readings.push(device.rssi);
      opts.onRssi?.(average());
      if (readings.length >= 3 && average() >= opts.minRssi) finish();
    });
  });
}
