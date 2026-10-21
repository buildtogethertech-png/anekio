import { nextClassRoll } from "../next-class-roll";

describe("nextClassRoll", () => {
  const roster = [
    { classId: "1-a", rollNumber: 1 },
    { classId: "1-a", rollNumber: 2 },
    { classId: "1-a", rollNumber: 4 },
    { classId: "2-a", rollNumber: 1 },
  ];

  it("returns blank until a class is picked", () => {
    expect(nextClassRoll(roster, "")).toBe("");
  });

  it("starts at 1 for an empty class", () => {
    expect(nextClassRoll(roster, "3-a")).toBe("1");
  });

  it("fills the first gap in the selected class", () => {
    expect(nextClassRoll(roster, "1-a")).toBe("3");
    expect(nextClassRoll(roster, "2-a")).toBe("2");
  });
});
