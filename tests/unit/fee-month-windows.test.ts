import { describe, expect, it } from "vitest";
import { clampFeeDueDay, dueDateForMonth, feePeriod, sessionMonthsThrough } from "../../lib/fees";

const SESSION = { start: "2026-04-01", end: "2027-03-31" };

/** Mirrors `issueClassFeesCore`: last completed calendar month, not the current month. */
function lastCompletedPeriod(now: Date) {
  const lastCompletedMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return feePeriod(lastCompletedMonth.getFullYear(), lastCompletedMonth.getMonth());
}

function periodsThrough(now: Date) {
  return sessionMonthsThrough(now, SESSION).map((month) => month.period);
}

describe("session month generation (MON)", () => {
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

describe("issueClassFees vs issueDueFees month windows (AR)", () => {
  it("on 4 Oct 2026 class-issue stops at September while due-fees includes October", () => {
    const now = new Date(2026, 9, 4, 12, 0, 0);
    expect(lastCompletedPeriod(now)).toBe("2026-09");
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

  it("uses local calendar boundaries, not UTC midnight", () => {
    expect(lastCompletedPeriod(new Date(2026, 8, 30, 23, 59, 0))).toBe("2026-08");
    expect(periodsThrough(new Date(2026, 8, 30, 23, 59, 0)).at(-1)).toBe("2026-09");

    expect(lastCompletedPeriod(new Date(2026, 9, 1, 0, 0, 0))).toBe("2026-09");
    expect(periodsThrough(new Date(2026, 9, 1, 0, 0, 0)).at(-1)).toBe("2026-10");

    expect(lastCompletedPeriod(new Date(2026, 9, 31, 23, 59, 0))).toBe("2026-09");
    expect(periodsThrough(new Date(2026, 9, 31, 23, 59, 0)).at(-1)).toBe("2026-10");

    expect(lastCompletedPeriod(new Date(2026, 10, 1, 0, 0, 0))).toBe("2026-10");
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
