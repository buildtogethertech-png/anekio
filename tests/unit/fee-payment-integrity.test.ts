import { describe, expect, it } from "vitest";
import { invoiceBalance, unpaidFeeMonths, expandOldestUnpaidInvoiceIds, inrToPaise } from "../../lib/fees";
import { gatewayReady, paySecretsFromRow } from "../../lib/pay-config";

describe("fee payment integrity helpers", () => {
  it("converts rupees to Razorpay paise without dropping zeros", () => {
    expect(inrToPaise(1)).toBe(100);
    expect(inrToPaise(10)).toBe(1000);
    expect(inrToPaise(999)).toBe(99900);
    expect(inrToPaise(1000)).toBe(100000);
    expect(inrToPaise(5000)).toBe(500000);
    expect(inrToPaise(12345)).toBe(1234500);
  });

  it("treats gateway NONE as not ready for online checkout", () => {
    expect(gatewayReady(paySecretsFromRow({ gateway: "NONE", razorpayKeyId: "rzp_test_x", razorpayKeySecret: "secret" }))).toBe(false);
  });

  it("requires both Razorpay key id and secret", () => {
    expect(gatewayReady(paySecretsFromRow({ gateway: "RAZORPAY", razorpayKeyId: "rzp_test_x" }))).toBe(false);
    expect(gatewayReady(paySecretsFromRow({ gateway: "RAZORPAY", razorpayKeySecret: "secret" }))).toBe(false);
    expect(gatewayReady(paySecretsFromRow({ gateway: "RAZORPAY", razorpayKeyId: "rzp_test_x", razorpayKeySecret: "secret" }))).toBe(true);
  });

  it("adds late fee onto unpaid remaining for due now", () => {
    const due = invoiceBalance({
      amount: 5000,
      dueDate: new Date("2026-01-01T00:00:00Z"),
      lateKind: "STATIC",
      lateGraceDays: 0,
      lateAmount: 200,
    });
    expect(due.remaining).toBe(5000);
    expect(due.late).toBe(200);
    expect(due.dueNow).toBe(5200);
  });

  it("reduces due now after a partial payment", () => {
    const due = invoiceBalance({
      amount: 5000,
      paid: 500,
      dueDate: new Date("2026-09-10T00:00:00Z"),
      lateKind: "NONE",
    });
    expect(due.paid).toBe(500);
    expect(due.remaining).toBe(4500);
    expect(due.dueNow).toBe(4500);
  });

  it("forces older unpaid months when a later month is selected", () => {
    const ids = expandOldestUnpaidInvoiceIds(
      [
        { id: "jan", studentId: "s1", dueDate: "2026-01-10", title: "January", dueNow: 5000 },
        { id: "feb", studentId: "s1", dueDate: "2026-02-10", title: "February", dueNow: 5000 },
        { id: "mar", studentId: "s1", dueDate: "2026-03-10", title: "March", dueNow: 5000 },
      ],
      ["mar"]
    );
    expect(ids).toEqual(["jan", "feb", "mar"]);
  });

  it("groups unpaid months oldest first", () => {
    const months = unpaidFeeMonths([
      { id: "mar", title: "March", period: "2026-03", dueAt: Date.parse("2026-03-10"), dueNow: 7000 },
      { id: "jan", title: "January", period: "2026-01", dueAt: Date.parse("2026-01-10"), dueNow: 5000 },
    ]);
    expect(months.map((row) => row.period)).toEqual(["2026-01", "2026-03"]);
  });
});
