import { compareByRollThenName, matchesStudentQuery, rollLabel } from "../student-label";

describe("student roll helpers", () => {
  it("sorts the register by roll number then name", () => {
    const rows = [
      { name: "Zara", rollNumber: 12 },
      { name: "Advait", rollNumber: 1 },
      { name: "No roll", rollNumber: null },
      { name: "Aisha", rollNumber: 2 },
    ];
    expect([...rows].sort(compareByRollThenName).map((row) => row.name)).toEqual(["Advait", "Aisha", "Zara", "No roll"]);
  });

  it("finds a student by roll number", () => {
    const student = { name: "Advait Rao", rollNumber: 12, admissionNo: "ADM-12" };
    expect(matchesStudentQuery(student, "12")).toBe(true);
    expect(matchesStudentQuery(student, "roll 12")).toBe(true);
    expect(matchesStudentQuery(student, "advait")).toBe(true);
    expect(matchesStudentQuery(student, "99")).toBe(false);
    expect(rollLabel(12)).toBe("Roll 12");
  });
});
