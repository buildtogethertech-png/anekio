import { describe, expect, it } from "vitest";
import { collapseStaffDaysByDate, staffDayInstant, staffDayYmd } from "../../lib/staff-day";

describe("staff calendar day", () => {
  it("maps IST midnight, UTC midnight, and +05:30 noon to the same school date", () => {
    expect(staffDayYmd(new Date("2026-09-09T00:00:00+05:30"))).toBe("2026-09-09");
    expect(staffDayYmd(new Date("2026-09-09T00:00:00.000Z"))).toBe("2026-09-09");
    expect(staffDayYmd(new Date("2026-09-08T18:30:00.000Z"))).toBe("2026-09-09");
    expect(staffDayYmd(new Date("2026-09-09T00:00:00+05:30"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(staffDayYmd(staffDayInstant("2026-09-09"))).toBe("2026-09-09");
    expect(staffDayYmd(new Date(2026, 8, 8, 18, 30, 0, 0))).toBe("2026-09-09");
  });

  it("keeps the In time when two datetimes collapse to one school day", () => {
    const utcMidnight = {
      date: new Date("2026-09-09T00:00:00.000Z"),
      inAt: "",
      status: "PRESENT",
    };
    const istMidnight = {
      date: new Date("2026-09-08T18:30:00.000Z"),
      inAt: "08:15",
      status: "LATE",
    };
    const map = collapseStaffDaysByDate([utcMidnight, istMidnight]);
    expect(map.get("2026-09-09")?.inAt).toBe("08:15");
  });

  it("prefers the India midnight row when both rows have an In time", () => {
    const utcMidnight = {
      date: new Date("2026-09-09T00:00:00.000Z"),
      inAt: "07:22",
      status: "PRESENT",
    };
    const istMidnight = {
      date: new Date("2026-09-08T18:30:00.000Z"),
      inAt: "08:05",
      status: "LATE",
    };
    const map = collapseStaffDaysByDate([utcMidnight, istMidnight]);
    expect(map.get("2026-09-09")?.inAt).toBe("08:05");
  });
});
