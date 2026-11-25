import { describe, expect, it } from "vitest";
import { checkAtSchool, fixCountsInside, GeoCheckError, parseStaffAttendanceSetup } from "../../lib/staff-attendance-setup";

// School point, 150 m radius. 0.0001° latitude ≈ 11 m.
const setup = parseStaffAttendanceSetup(JSON.stringify({ location: true, lat: 28.6, lng: 77.2, radiusM: 150 }));
const north = (m: number) => 28.6 + m / 111_195;

function reason(fix: { lat: number; lng: number; accuracy: number; mocked?: boolean }) {
  try {
    checkAtSchool(setup, fix);
    return "ok";
  } catch (e) {
    expect(e).toBeInstanceOf(GeoCheckError);
    return (e as GeoCheckError).geo.reason;
  }
}

describe("location rule", () => {
  it("accepts a rough reading when its whole circle is inside the radius", () => {
    expect(fixCountsInside(20, 90, 150)).toBe(true);
    expect(reason({ lat: north(20), lng: 77.2, accuracy: 90 })).toBe("ok");
  });

  it("keeps accepting sharp readings inside, as before", () => {
    expect(reason({ lat: north(140), lng: 77.2, accuracy: 30 })).toBe("ok");
  });

  it("says weak GPS when the rough reading could be outside", () => {
    expect(reason({ lat: north(100), lng: 77.2, accuracy: 90 })).toBe("weak");
  });

  it("says too far only when the person is outside even at the reading's best", () => {
    expect(reason({ lat: north(400), lng: 77.2, accuracy: 60 })).toBe("far");
    expect(reason({ lat: north(200), lng: 77.2, accuracy: 80 })).toBe("weak");
  });

  it("reports fake location and missing readings with their reason", () => {
    expect(reason({ lat: north(10), lng: 77.2, accuracy: 10, mocked: true })).toBe("mocked");
    expect(reason({ lat: north(10), lng: 77.2, accuracy: 0 })).toBe("no_fix");
  });

  it("carries the numbers for the log", () => {
    try {
      checkAtSchool(setup, { lat: north(100), lng: 77.2, accuracy: 90 });
    } catch (e) {
      expect((e as GeoCheckError).geo).toMatchObject({ reason: "weak", accuracy: 90, meters: 100, radiusM: 150 });
    }
  });
});
