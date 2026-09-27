import { clampDueDay, datesForSessionYear, ordinalDay, SESSION_YEAR_OPTIONS, sessionYearId } from "../fee-setup";

describe("fee setup session years", () => {
  it("labels the session as start year to end year", () => {
    expect(sessionYearId("2026-04-01", "2027-03-31")).toBe("2026-2027");
    expect(SESSION_YEAR_OPTIONS.find((row) => row.id === "2026-2027")?.label).toBe("2026 to 2027");
  });

  it("includes years through 2035 to 2036 and 2050 to 2051", () => {
    const labels = SESSION_YEAR_OPTIONS.map((row) => row.label);
    expect(labels[0]).toBe("2015 to 2016");
    expect(labels).toContain("2035 to 2036");
    expect(labels.at(-1)).toBe("2050 to 2051");
    expect(SESSION_YEAR_OPTIONS).toHaveLength(36);
  });

  it("applies a picked session year to April–March dates by default", () => {
    expect(datesForSessionYear("2027-2028")).toEqual({
      startsOn: "2027-04-01",
      endsOn: "2028-03-31",
    });
  });

  it("keeps custom month and day when the year changes", () => {
    expect(datesForSessionYear("2028-2029", "2026-06-15", "2027-05-20")).toEqual({
      startsOn: "2028-06-15",
      endsOn: "2029-05-20",
    });
  });
});

describe("fee setup due day", () => {
  it("clamps empty, zero, and oversized days", () => {
    expect(clampDueDay(undefined)).toBe(10);
    expect(clampDueDay(0)).toBe(10);
    expect(clampDueDay(31)).toBe(31);
    expect(clampDueDay(99)).toBe(31);
  });

  it("uses ordinal labels for the selected day", () => {
    expect(ordinalDay(1)).toBe("1st");
    expect(ordinalDay(2)).toBe("2nd");
    expect(ordinalDay(3)).toBe("3rd");
    expect(ordinalDay(11)).toBe("11th");
    expect(ordinalDay(21)).toBe("21st");
  });
});
