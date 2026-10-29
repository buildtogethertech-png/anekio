import { adhocTotals } from "../../lib/adhoc-invoice";

describe("adhocTotals", () => {
  it("adds qty × price and takes the discount off", () => {
    const t = adhocTotals(
      [
        { label: "ID card", qty: "2", rate: "150" },
        { label: "Trip", qty: "1", rate: "1,200" },
      ],
      "100"
    );
    expect(t).toMatchObject({ subtotal: 1500, discount: 100, total: 1400, error: "", count: 2 });
  });

  it("ignores empty rows but needs at least one item", () => {
    expect(adhocTotals([{ label: "", qty: "1", rate: "" }], "").error).toBe("Add at least one item");
  });

  it("flags a missing name, price or a discount that is too big", () => {
    expect(adhocTotals([{ label: "", qty: "1", rate: "50" }], "").error).toBe("Every item needs a name");
    expect(adhocTotals([{ label: "Books", qty: "1", rate: "" }], "").error).toBe('Enter a price for "Books"');
    expect(adhocTotals([{ label: "Books", qty: "0", rate: "50" }], "").error).toContain("Quantity");
    expect(adhocTotals([{ label: "Books", qty: "1", rate: "50" }], "50").error).toBe("Discount must be less than the total");
  });
});
