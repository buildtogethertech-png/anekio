import { splitPayment } from "../generate-payment";

describe("splitPayment", () => {
  const months = [
    { id: "nov", dueNow: 1800, dueAt: "2026-11-10" },
    { id: "backlog", dueNow: 8000, dueAt: "2026-01-05" },
    { id: "oct", dueNow: 1800, dueAt: "2026-10-10" },
  ];

  it("pays the oldest month first and part pays the last one reached", () => {
    expect(splitPayment(months, 10000)).toEqual([
      { id: "backlog", pay: 8000, full: true },
      { id: "oct", pay: 1800, full: true },
      { id: "nov", pay: 200, full: false },
    ]);
  });

  it("leaves out months the money does not reach", () => {
    expect(splitPayment(months, 500)).toEqual([{ id: "backlog", pay: 500, full: false }]);
  });
});
