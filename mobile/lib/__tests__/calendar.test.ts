import { inferDeadlineOffsets, shiftSchoolDays, sittingDeadlines, type SchoolCalendar } from "../calendar";

const calendar: SchoolCalendar = {
  weekdays: [1, 2, 3, 4, 5],
  holidays: [{ date: "2026-09-11", name: "School holiday" }],
};

describe("working-day exam deadlines", () => {
  it("skips weekends and school holidays in both directions", () => {
    expect(shiftSchoolDays("2026-09-14", -2, calendar)).toBe("2026-09-09");
    expect(shiftSchoolDays("2026-09-18", 2, calendar)).toBe("2026-09-22");
  });

  it("calculates and restores saved working-day offsets", () => {
    const deadlines = sittingDeadlines(
      ["2026-09-14", "2026-09-18"],
      { paperBefore: 2, copiesAfter: 2, resultAfter: 2 },
      calendar
    );

    expect(deadlines).toEqual({
      paperDueOn: "2026-09-09",
      copiesDueOn: "2026-09-22",
      resultOn: "2026-09-22",
    });
    expect(inferDeadlineOffsets(["2026-09-14", "2026-09-18"], deadlines, calendar)).toEqual({
      paperBefore: 2,
      copiesAfter: 2,
      resultAfter: 2,
    });
  });
});
