import { describe, expect, it } from "vitest";
import {
  buildFeeHistory,
  dateChipLabel,
  eventClock,
  invoiceDisplayNumber,
  parseFeeHistoryQuery,
  resolveDateRange,
} from "../../lib/fee-history";

function invoice(partial: {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo?: string;
  className?: string;
  section?: string;
  period: string;
  amount: number;
  dueDate: string;
  payments?: { id?: string; amount: number; method: string; paidAt: string; notes?: string; reference?: string }[];
}) {
  return {
    admissionNo: partial.admissionNo || `ADM-${partial.studentId}`,
    classId: `c-${partial.className || "3"}-${partial.section || "A"}`,
    className: partial.className || "3",
    section: partial.section || "A",
    title: `${partial.period} fee`,
    payments: partial.payments || [],
    ...partial,
  };
}

const asOf = new Date(2026, 8, 11, 12, 0, 0);

describe("fee history", () => {
  it("defaults this month from the current date, not a hardcoded September 2026", () => {
    expect(resolveDateRange({ datePreset: "this_month" }, new Date(2025, 0, 15))).toEqual({
      preset: "this_month",
      from: "2025-01-01",
      to: "2025-01-31",
    });
    expect(resolveDateRange({ datePreset: "this_month" }, asOf)).toEqual({
      preset: "this_month",
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(resolveDateRange({ datePreset: "last_month" }, asOf)).toEqual({
      preset: "last_month",
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(dateChipLabel("this_month", "2026-09-01", "2026-09-30")).toBe("September");
  });

  it("does not invent a time for date-only invoice events", () => {
    const clock = eventClock("2026-09-11T00:00:00", true);
    expect(clock.timeLabel).toBe("");
    expect(clock.dateLabel).toContain("Sep");
  });

  it("searches student name, admission number, invoice number and receipt number", () => {
    const invoices = [
      invoice({
        id: "cuid-inv-00234",
        studentId: "aarav",
        studentName: "Aarav Sharma",
        admissionNo: "ADM-001",
        period: "2026-09",
        amount: 5000,
        dueDate: "2026-09-10",
        payments: [{ id: "p1", amount: 5000, method: "UPI", paidAt: "2026-09-11T11:42:00" }],
      }),
      invoice({
        id: "other",
        studentId: "riya",
        studentName: "Riya Patel",
        admissionNo: "ADM-002",
        className: "4",
        section: "B",
        period: "2026-09",
        amount: 8800,
        dueDate: "2026-12-31",
      }),
    ];
    const receipts = [
      {
        studentId: "aarav",
        invoiceId: "cuid-inv-00234",
        period: "2026-09",
        documentUrl: "/documents/r1",
        documentNumber: "REC-00981",
        issuedAt: "2026-09-11T11:45:00",
      },
    ];
    const name = buildFeeHistory(invoices, receipts, { q: "Aarav", datePreset: "this_month", page: 1, pageSize: 25 }, { asOf });
    expect(name.events.every((row) => row.studentId === "aarav")).toBe(true);
    const adm = buildFeeHistory(invoices, receipts, { q: "ADM-001", datePreset: "this_month", page: 1, pageSize: 25 }, { asOf });
    expect(adm.events.every((row) => row.admissionNo === "ADM-001")).toBe(true);
    const invNo = invoiceDisplayNumber("cuid-inv-00234");
    const byInv = buildFeeHistory(invoices, receipts, { q: invNo, datePreset: "this_month", page: 1, pageSize: 25 }, { asOf });
    expect(byInv.events.length).toBeGreaterThan(0);
    expect(byInv.events.every((row) => row.invoiceId === "cuid-inv-00234")).toBe(true);
    const byRec = buildFeeHistory(invoices, receipts, { q: "REC-00981", datePreset: "this_month", page: 1, pageSize: 25 }, { asOf });
    expect(byRec.events.some((row) => row.receiptNumber === "REC-00981")).toBe(true);
  });

  it("filters class, section, event type, status and payment mode together without resetting others", () => {
    const invoices = [
      invoice({
        id: "a1",
        studentId: "aarav",
        studentName: "Aarav Sharma",
        className: "3",
        section: "A",
        period: "2026-09",
        amount: 5000,
        dueDate: "2026-09-10",
        payments: [{ id: "p1", amount: 5000, method: "UPI", paidAt: "2026-09-11T11:42:00" }],
      }),
      invoice({
        id: "s1",
        studentId: "siya",
        studentName: "Siya Mehta",
        className: "5",
        section: "A",
        period: "2026-09",
        amount: 7500,
        dueDate: "2026-09-10",
        payments: [{ id: "p2", amount: 3000, method: "BANK", paidAt: "2026-09-10T16:20:00" }],
      }),
    ];
    const combo = buildFeeHistory(
      invoices,
      [],
      { className: "3", eventType: "payment", datePreset: "this_month", page: 1, pageSize: 25 },
      { asOf }
    );
    expect(combo.events).toHaveLength(1);
    expect(combo.events[0]).toMatchObject({
      type: "payment",
      studentName: "Aarav Sharma",
      amount: 5000,
      paymentMode: "UPI",
      classLabel: "3-A",
    });
    const bank = buildFeeHistory(invoices, [], { method: "BANK", datePreset: "this_month", page: 1, pageSize: 25 }, { asOf });
    expect(bank.events.every((row) => row.paymentMode === "BANK")).toBe(true);
    const section = buildFeeHistory(invoices, [], { className: "5", section: "A", datePreset: "this_month", page: 1, pageSize: 25 }, { asOf });
    expect(section.events.every((row) => row.className === "5" && row.section === "A")).toBe(true);
  });

  it("orders newest first with one compact row per payment", () => {
    const invoices = [
      invoice({
        id: "inv-a",
        studentId: "aarav",
        studentName: "Aarav Sharma",
        period: "2026-09",
        amount: 5000,
        dueDate: "2026-09-11",
        payments: [{ id: "p1", amount: 5000, method: "UPI", paidAt: "2026-09-11T11:42:00" }],
      }),
      invoice({
        id: "inv-s",
        studentId: "siya",
        studentName: "Siya Mehta",
        className: "5",
        period: "2026-09",
        amount: 7500,
        dueDate: "2026-09-10",
        payments: [{ id: "p2", amount: 3000, method: "BANK", paidAt: "2026-09-10T16:20:00" }],
      }),
      invoice({
        id: "inv-m",
        studentId: "meera",
        studentName: "Meera Iyer",
        className: "1",
        period: "2026-08",
        amount: 8800,
        dueDate: "2026-08-10",
      }),
    ];
    const result = buildFeeHistory(invoices, [], { datePreset: "custom", from: "2026-08-01", to: "2026-09-30", page: 1, pageSize: 50 }, { asOf });
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.type).toBe("payment");
    expect(result.events[0]?.studentName).toBe("Aarav Sharma");
    expect(result.events[0]?.timeLabel).toBeTruthy();
    expect(result.events.find((row) => row.type === "invoice")).toBeUndefined();
    const partial = result.events.find((row) => row.type === "partial");
    expect(partial?.amount).toBe(3000);
    expect(partial?.balance).toBe(4500);
    expect(result.events.find((row) => row.studentId === "meera")).toBeUndefined();
    const ids = result.events.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("summarises the filtered set and paginates without fabricating collectors or timestamps", () => {
    const invoices = Array.from({ length: 12 }, (_, i) =>
      invoice({
        id: `inv${i}`,
        studentId: `s${i}`,
        studentName: `Student ${i}`,
        period: "2026-09",
        amount: 1000,
        dueDate: "2026-09-20",
        payments: [{ id: `p${i}`, amount: 1000, method: "CASH", paidAt: `2026-09-0${(i % 9) + 1}T10:00:00` }],
      })
    );
    const page1 = buildFeeHistory(invoices, [], { datePreset: "this_month", page: 1, pageSize: 10 }, { asOf });
    expect(page1.events).toHaveLength(10);
    expect(page1.total).toBe(12);
    expect(page1.summary.payments).toBe(12);
    expect(page1.summary.collected).toBe(12000);
    const page2 = buildFeeHistory(invoices, [], { datePreset: "this_month", page: 2, pageSize: 10 }, { asOf });
    expect(page2.events[0]?.id).not.toBe(page1.events[0]?.id);
    expect(page2.events.every((row) => row.collectedBy === "")).toBe(true);
    const empty = buildFeeHistory(invoices, [], { q: "nobody-here", datePreset: "this_month", page: 1, pageSize: 10 }, { asOf });
    expect(empty.events).toEqual([]);
    expect(empty.total).toBe(0);
  });

  it("keeps this-month payments visible and bills the linked invoice without inventing extra events", () => {
    const invoices = [
      invoice({
        id: "july",
        studentId: "aisha",
        studentName: "Aisha Sharma",
        admissionNo: "ADM-101",
        period: "2026-07",
        amount: 8600,
        dueDate: "2026-07-10",
        payments: [{ id: "p-sep", amount: 4300, method: "CASH", paidAt: "2026-09-11T11:00:00" }],
      }),
    ];
    const month = buildFeeHistory(invoices, [], { datePreset: "this_month", page: 1, pageSize: 25 }, { asOf });
    expect(month.events.map((row) => row.type)).toEqual(["partial"]);
    expect(month.events[0]).toMatchObject({
      studentName: "Aisha Sharma",
      amount: 4300,
      paymentMode: "CASH",
      monthLabel: "Jul 2026",
    });
    expect(month.summary.collected).toBe(4300);
    expect(month.summary.billed).toBe(8600);
    expect(month.summary.outstanding).toBe(4300);
    expect(month.events[0]?.timeLabel).toBeTruthy();
  });

  it("parses query defaults to this month and 25 per page", () => {
    const filter = parseFeeHistoryQuery({ q: "Aarav", className: "3", eventType: "payment", methods: "nope" });
    expect(filter.datePreset).toBe("this_month");
    expect(filter.pageSize).toBe(25);
    expect(filter.eventType).toBe("payment");
    expect(filter.className).toBe("3");
  });

  it("attaches receipt details on the payment row without a second receipt event", () => {
    const invoices = [
      invoice({
        id: "inv-r",
        studentId: "riya",
        studentName: "Riya Patel",
        className: "4",
        section: "B",
        period: "2026-09",
        amount: 8800,
        dueDate: "2026-09-11",
        payments: [{ id: "p9", amount: 8800, method: "CASH", paidAt: "2026-09-11T10:15:00" }],
      }),
    ];
    const receipts = [
      {
        studentId: "riya",
        invoiceId: "inv-r",
        period: "2026-09",
        documentUrl: "/documents/rec",
        documentNumber: "REC-00980",
        issuedAt: "2026-09-11T10:16:00",
        issuedByName: "Vikram Rao",
      },
    ];
    const result = buildFeeHistory(invoices, receipts, { datePreset: "this_month", page: 1, pageSize: 10 }, { asOf });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "payment",
      receiptNumber: "REC-00980",
      receiptUrl: "/documents/rec",
      collectedBy: "Vikram Rao",
      amount: 8800,
    });
    expect(result.summary.receipts).toBe(1);
  });
});
