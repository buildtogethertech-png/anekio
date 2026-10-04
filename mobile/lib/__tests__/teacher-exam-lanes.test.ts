import { phoneLaneHeading } from "../teacher-exam-lanes";

describe("teacher exam phone lanes", () => {
  it("maps each lane to the list heading shown under the tabs", () => {
    expect(phoneLaneHeading("paper").title).toBe("Papers to set");
    expect(phoneLaneHeading("take").title).toBe("Exams to take");
    expect(phoneLaneHeading("marks").title).toBe("Enter marks");
    expect(phoneLaneHeading("office").title).toBe("Sent to office");
    expect(phoneLaneHeading("correction").title).toBe("Correction");
  });
});
