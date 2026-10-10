import { feeAssignmentFromStudent } from "../manage-fee";

describe("student fee assignment", () => {
  it("reads universal catalog fees, class add-ons, and a discount from the student", () => {
    expect(
      feeAssignmentFromStudent([
        { kind: "OTHER:computer", label: "Computer fee" },
        { kind: "CLASS:picnic", label: "Picnic" },
        { kind: "DISCOUNT_PERCENT", label: "Discount", amount: 10 },
      ])
    ).toEqual({
      otherIds: ["computer"],
      classAddOnLabels: ["Picnic"],
      discount: { type: "PERCENT", value: 10 },
    });
  });
});
