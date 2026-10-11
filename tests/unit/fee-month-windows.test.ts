import { describe, expect, it } from "vitest";
import { clampFeeDueDay, dueDateForMonth, feePeriod, feePeriodBefore, sessionMonthsThrough, studentMayBeBilledForPeriod } from "../../lib/fees";

const SESSION = { start: "2026-04-01", end: "2027-03-31" };

function periodsThrough(now: Date) {
  return sessionMonthsThrough(now, SESSION).map((month) => month.period);
}

function currentPeriod(now: Date) {
  return feePeriod(now.getFullYear(), now.getMonth());
}

describe("session month generation (MON)", () => {
  it("requires an explicit billing start, independent of imported invoice history", () => {
    expect(studentMayBeBilledForPeriod({ billingStartPeriod: "" }, "2026-10")).toBe(false);
    expect(studentMayBeBilledForPeriod({ billingStartPeriod: "2026-10" }, "2026-09")).toBe(false);
    expect(studentMayBeBilledForPeriod({ billingStartPeriod: "2026-10" }, "2026-10")).toBe(true);
  });
  it("uses the month before billing starts as the invoice cutoff", () => {
    expect(feePeriodBefore("2026-10")).toBe("2026-09");
    expect(feePeriodBefore("2027-01")).toBe("2026-12");
    expect(() => feePeriodBefore("2026-13")).toThrow("valid month");
  });
  it("lists every month of an Apr–Mar session including the year transition", () => {
    expect(periodsThrough(new Date(2027, 2, 31, 12, 0, 0))).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
  });

  it("includes February and a leap February without inventing extra months", () => {
    expect(periodsThrough(new Date(2027, 1, 28, 12, 0, 0))).toContain("2027-02");
    expect(
      sessionMonthsThrough(new Date(2028, 2, 31), { start: "2027-04-01", end: "2028-03-31" }).map((month) => month.period)
    ).toContain("2028-02");
  });

  it("excludes months outside the session and months after as-of", () => {
    const throughJune = periodsThrough(new Date(2026, 5, 15, 12, 0, 0));
    expect(throughJune[0]).toBe("2026-04");
    expect(throughJune.at(-1)).toBe("2026-06");
    expect(throughJune).not.toContain("2026-03");
    expect(throughJune).not.toContain("2026-07");
  });
});

describe("fee generation month windows (AR)", () => {
  it("on 4 Oct 2026 both generation paths include October, not November", () => {
    const now = new Date(2026, 9, 4, 12, 0, 0);
    expect(currentPeriod(now)).toBe("2026-10");
    expect(periodsThrough(now)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(periodsThrough(now)).not.toContain("2026-11");
  });

  it("on October 11 the October invoice remains eligible with an October 10 due date", () => {
    const now = new Date(2026, 9, 11, 12, 0, 0);
    expect(currentPeriod(now)).toBe("2026-10");
    expect(periodsThrough(now).at(-1)).toBe("2026-10");
    expect(studentMayBeBilledForPeriod({ billingStartPeriod: "2026-10" }, "2026-10")).toBe(true);
    expect(dueDateForMonth(2026, 9, 10).getDate()).toBe(10);
    expect(dueDateForMonth(2026, 9, 10).getTime()).toBeLessThan(now.getTime());
  });

  it("uses local calendar boundaries, not UTC midnight", () => {
    expect(currentPeriod(new Date(2026, 8, 30, 23, 59, 0))).toBe("2026-09");
    expect(periodsThrough(new Date(2026, 8, 30, 23, 59, 0)).at(-1)).toBe("2026-09");

    expect(currentPeriod(new Date(2026, 9, 1, 0, 0, 0))).toBe("2026-10");
    expect(periodsThrough(new Date(2026, 9, 1, 0, 0, 0)).at(-1)).toBe("2026-10");

    expect(currentPeriod(new Date(2026, 9, 31, 23, 59, 0))).toBe("2026-10");
    expect(periodsThrough(new Date(2026, 9, 31, 23, 59, 0)).at(-1)).toBe("2026-10");

    expect(currentPeriod(new Date(2026, 10, 1, 0, 0, 0))).toBe("2026-11");
    expect(periodsThrough(new Date(2026, 10, 1, 0, 0, 0)).at(-1)).toBe("2026-11");
  });
});

describe("universal monthly due days (DUE)", () => {
  it("clamps template due days to 1–28 so every selected day exists in every month", () => {
    expect(clampFeeDueDay(31)).toBe(28);
    expect(clampFeeDueDay(0)).toBe(10);
    expect(dueDateForMonth(2026, 1, 30).getDate()).toBe(28);
    expect(dueDateForMonth(2028, 1, 31).getDate()).toBe(29);
    expect(dueDateForMonth(2026, 3, 31).getDate()).toBe(30);
    expect(dueDateForMonth(2026, 0, 31).getDate()).toBe(31);
  });
});
