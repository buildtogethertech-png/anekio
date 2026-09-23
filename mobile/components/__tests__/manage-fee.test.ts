import { feeAssignmentFromStudent } from "../manage-fee";

describe("student fee assignment", () => {
  it("reads transport, other catalog fees, and class add-ons from the student", () => {
    expect(
      feeAssignmentFromStudent([
        { kind: "TRANSPORT:route-a", label: "Transport · Route A" },
        { kind: "OTHER:computer", label: "Computer fee" },
        { kind: "CLASS:picnic", label: "Picnic" },
        { kind: "DISCOUNT", label: "Sibling" },
      ])
    ).toEqual({
      transportId: "route-a",
      otherIds: ["computer"],
      classAddOnLabels: ["Picnic"],
    });
  });
});
