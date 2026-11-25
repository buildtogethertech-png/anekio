import { describe, expect, it } from "vitest";
import { beaconCodeFor, checkSelfMark, GeoCheckError, parseStaffAttendanceSetup, verifyBeaconCode } from "../../lib/staff-attendance-setup";

const setup = parseStaffAttendanceSetup(JSON.stringify({ beacon: true, lat: 28.6, lng: 77.2, radiusM: 150, beaconRssi: -80 }));

function reason(input: Parameters<typeof checkSelfMark>[1], s = setup) {
  try {
    return checkSelfMark(s, input).via;
  } catch (e) {
    expect(e).toBeInstanceOf(GeoCheckError);
    return (e as GeoCheckError).geo.reason;
  }
}

describe("beacon rule", () => {
  it("reads a beacon setup with defaults", () => {
    expect(setup).toMatchObject({ qr: false, location: false, beacon: true, gpsBackup: true, beaconName: "Anekio-Gate-1", beaconRssi: -80 });
    expect(parseStaffAttendanceSetup("")).toMatchObject({ qr: true, beacon: false });
  });

  it("matches the UUID in any case and without dashes, or the beacon name", () => {
    expect(reason({ beacon: { uuid: "8EC76EA3666848DA986675BE8BC86F4D", rssi: -70 } })).toBe("beacon");
    expect(reason({ beacon: { name: "Anekio-Gate-1", rssi: -70 } })).toBe("beacon");
    expect(reason({ beacon: { uuid: "11111111-2222-3333-4444-555555555555", rssi: -40 } })).toBe("beacon_other");
  });

  it("needs the signal at least as strong as the setting", () => {
    expect(reason({ beacon: { name: "Anekio-Gate-1", rssi: -80 } })).toBe("beacon");
    expect(reason({ beacon: { name: "Anekio-Gate-1", rssi: -81 } })).toBe("beacon_far");
    expect(reason({ beacon: { name: "Anekio-Gate-1" } })).toBe("beacon_far");
  });

  it("a tight setting (about 2 m) needs a strong signal", () => {
    const tight = { ...setup, beaconRssi: -60 };
    expect(reason({ beacon: { name: "Anekio-Gate-1", rssi: -58 } }, tight)).toBe("beacon");
    expect(reason({ beacon: { name: "Anekio-Gate-1", rssi: -66 } }, tight)).toBe("beacon_far");
    expect(parseStaffAttendanceSetup(JSON.stringify({ beacon: true, beaconRssi: -65 })).beaconRssi).toBe(-65);
  });

  it("falls back to GPS only when the backup is on", () => {
    expect(reason({ lat: 28.6, lng: 77.2, accuracy: 10 })).toBe("location");
    expect(reason({ lat: 28.6, lng: 77.2, accuracy: 10 }, { ...setup, gpsBackup: false })).toBe("no_beacon");
  });

  it("is off when the school uses QR", () => {
    expect(reason({ beacon: { name: "Anekio-Gate-1", rssi: -50 } }, parseStaffAttendanceSetup(""))).toBe("off");
  });
});

describe("rotating beacon code", () => {
  const key = "00112233445566778899aabbccddeeff";
  const boot = "a7f2c001";
  const t0 = 1_800_000_000_000;

  it("makes the same code as the ESP32 (HMAC-SHA256 of AK + boot + slot, first 4 bytes)", () => {
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const msg = Buffer.from([0x41, 0x4b, 0xa7, 0xf2, 0xc0, 0x01, 0, 0, 0, 5]);
    const want = createHmac("sha256", Buffer.from(key, "hex")).update(msg).digest().subarray(0, 4).toString("hex");
    expect(beaconCodeFor(key, boot, 5)).toBe(want);
  });

  it("a new boot is remembered; later codes must match the time since then", () => {
    const first = verifyBeaconCode(key, {}, { boot, ctr: 10, code: beaconCodeFor(key, boot, 10) }, t0);
    expect(first).toEqual({ ok: true, boots: { [boot]: { ctr: 10, at: t0 } } });
    const boots = (first as { boots: Record<string, { ctr: number; at: number }> }).boots;
    // 5 minutes on = 10 slots on.
    const later = t0 + 5 * 60_000;
    expect(verifyBeaconCode(key, boots, { boot, ctr: 20, code: beaconCodeFor(key, boot, 20) }, later)).toEqual({ ok: true, boots: null });
    expect(verifyBeaconCode(key, boots, { boot, ctr: 21, code: beaconCodeFor(key, boot, 21) }, later)).toMatchObject({ ok: true });
    // A code copied 3 slots ago is dead.
    expect(verifyBeaconCode(key, boots, { boot, ctr: 17, code: beaconCodeFor(key, boot, 17) }, later)).toEqual({ ok: false, reason: "beacon_old" });
  });

  it("refuses a wrong code, a wrong key, or no code", () => {
    expect(verifyBeaconCode(key, {}, { boot, ctr: 1, code: "deadbeef" }, t0)).toEqual({ ok: false, reason: "beacon_code" });
    const other = "ffeeddccbbaa99887766554433221100";
    expect(verifyBeaconCode(key, {}, { boot, ctr: 1, code: beaconCodeFor(other, boot, 1) }, t0)).toEqual({ ok: false, reason: "beacon_code" });
    expect(verifyBeaconCode(key, {}, undefined, t0)).toEqual({ ok: false, reason: "beacon_code" });
  });

  it("follows a beacon whose clock drifted one slot", () => {
    const boots = { [boot]: { ctr: 0, at: t0 } };
    const now = t0 + 100 * 30_000;
    const r = verifyBeaconCode(key, boots, { boot, ctr: 101, code: beaconCodeFor(key, boot, 101) }, now);
    expect(r).toEqual({ ok: true, boots: { [boot]: { ctr: 101, at: now } } });
  });
});
