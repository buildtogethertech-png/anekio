import { feeAssignmentFromStudent } from "../manage-fee";

describe("student fee assignment", () => {
  it("reads universal catalog fees and class add-ons from the student", () => {
    expect(
      feeAssignmentFromStudent([
        { kind: "OTHER:computer", label: "Computer fee" },
        { kind: "CLASS:picnic", label: "Picnic" },
        { kind: "DISCOUNT", label: "Sibling" },
      ])
    ).toEqual({
      otherIds: ["computer"],
      classAddOnLabels: ["Picnic"],
    });
  });
});
