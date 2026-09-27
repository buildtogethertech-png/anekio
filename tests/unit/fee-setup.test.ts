import { describe, expect, it } from "vitest";
import { dueDateForMonth, lateStampFromSetup, pickAdmissionFeeLines } from "../../lib/fees";
import { sessionLabel } from "../../lib/school-session";

describe("fee setup admission lines", () => {
  it("uses school-wide lines when they exist", () => {
    expect(
      pickAdmissionFeeLines(
        [{ label: "Admission fee", amount: 5200 }],
        [{ label: "Class override", amount: 900 }],
        200
      )
    ).toEqual([{ label: "Admission fee", kind: "FLAT", amount: 5200 }]);
  });

  it("falls back to class lines then the legacy charge", () => {
    expect(pickAdmissionFeeLines([], [{ label: "Prospectus", amount: 200 }], 0)).toEqual([
      { label: "Prospectus", kind: "FLAT", amount: 200 },
    ]);
    expect(pickAdmissionFeeLines([], [], 5000)).toEqual([{ label: "Admission fee", kind: "FLAT", amount: 5000 }]);
    expect(pickAdmissionFeeLines([], [], 0)).toEqual([]);
  });

  it("drops zero amounts and rounds", () => {
    expect(pickAdmissionFeeLines([{ label: "Prospectus", amount: 0 }, { label: "ID card", amount: 199.6 }])).toEqual([
      { label: "ID card", kind: "FLAT", amount: 200 },
    ]);
  });
});

describe("fee setup due dates", () => {
  it("uses the last day on shorter months", () => {
    expect(dueDateForMonth(2026, 1, 31).getDate()).toBe(28);
    expect(dueDateForMonth(2026, 3, 31).getDate()).toBe(30);
    expect(dueDateForMonth(2026, 4, 31).getDate()).toBe(31);
  });

  it("keeps day 1 and day 10 as-is", () => {
    expect(dueDateForMonth(2026, 3, 1).getDate()).toBe(1);
    expect(dueDateForMonth(2026, 8, 10).getDate()).toBe(10);
  });
});

describe("fee setup academic session label", () => {
  it("labels a April–March session as 2026–27", () => {
    expect(sessionLabel("2026-04-01", "2027-03-31")).toBe("2026–27");
  });

  it("returns Session when dates are missing", () => {
    expect(sessionLabel("", "")).toBe("Session");
  });
});

describe("fee setup late fee mapping", () => {
  it("turns off late fee when disabled or amount is zero", () => {
    expect(lateStampFromSetup({ enabled: false, amount: 50 }).stamp.lateKind).toBe("NONE");
    expect(lateStampFromSetup({ enabled: true, amount: 0 }).stamp.lateKind).toBe("NONE");
  });

  it("maps recurring month as the default enabled rule", () => {
    const mapped = lateStampFromSetup({ enabled: true, amount: 100, graceDays: 5 });
    expect(mapped.catalog.enabled).toBe(true);
    expect(mapped.stamp.lateKind).toBe("RECURRING");
    expect(mapped.stamp.lateIntervalUnit).toBe("MONTH");
    expect(mapped.stamp.lateGraceDays).toBe(5);
  });
});
