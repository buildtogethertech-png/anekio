import { describe, expect, it } from "vitest";
import {
  buildFeeRegister,
  compactInr,
  feeMonthLabel,
  monthsDueLabel,
  parseFeeRegisterQuery,
  parseReceiptLink,
  receiptForInvoice,
} from "../../lib/fee-register";

function invoice(partial: {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo?: string;
  className?: string;
  section?: string;
  period: string;
  title?: string;
  amount: number;
  dueDate: string;
  payments?: { amount: number; method: string; paidAt: string }[];
  templateId?: string;
}) {
  return {
    admissionNo: partial.admissionNo || `A-${partial.studentId}`,
    classId: "c1",
    className: partial.className || "3",
    section: partial.section || "A",
    title: partial.title || `${partial.period} fee`,
    templateId: partial.templateId || "tpl",
    templateName: "Monthly fee",
    payments: partial.payments || [],
    ...partial,
  };
}

describe("fee register", () => {
  it("formats lakhs compactly and month labels from period", () => {
    expect(compactInr(842000)).toBe("₹8.42L");
    expect(compactInr(5000)).toBe("₹5,000");
    expect(feeMonthLabel("2026-09")).toBe("Sep 2026");
    expect(monthsDueLabel(0)).toBe("—");
    expect(monthsDueLabel(1)).toBe("1 month");
    expect(monthsDueLabel(4)).toBe("4 months");
  });

  it("matches receipts to an invoice without treating any student receipt as enough", () => {
    const receipts = [
      {
        studentId: "s1",
        invoiceId: "inv-sep",
        period: "2026-09",
        documentUrl: "/r1",
        documentNumber: "PR-1",
        issuedAt: "2026-09-05",
      },
    ];
    expect(receiptForInvoice(receipts, "s1", "inv-sep", "2026-09")?.documentNumber).toBe("PR-1");
    expect(receiptForInvoice(receipts, "s1", "inv-aug", "2026-08")).toBeNull();
    expect(parseReceiptLink(JSON.stringify({ invoiceId: "inv-sep", fees: { period: "2026-09" } }))).toEqual({
      invoiceId: "inv-sep",
      period: "2026-09",
    });
  });

  it("filters unpaid for ≥ 3 months from existing invoice balances", () => {
    const invoices = [
      invoice({ id: "a-jul", studentId: "aarav", studentName: "Aarav Shah", period: "2026-07", amount: 5000, dueDate: "2026-07-10" }),
      invoice({ id: "a-aug", studentId: "aarav", studentName: "Aarav Shah", period: "2026-08", amount: 5000, dueDate: "2026-08-10" }),
      invoice({ id: "a-sep", studentId: "aarav", studentName: "Aarav Shah", period: "2026-09", amount: 5000, dueDate: "2026-09-10" }),
      invoice({
        id: "r-sep",
        studentId: "riya",
        studentName: "Riya Patel",
        period: "2026-09",
        amount: 5000,
        dueDate: "2026-09-10",
        payments: [{ amount: 5000, method: "UPI", paidAt: "2026-09-05" }],
      }),
    ];
    const three = buildFeeRegister(invoices, [], { unpaidMonthsGte: 3, page: 1, pageSize: 50 });
    expect(three.rows.every((row) => row.studentId === "aarav")).toBe(true);
    expect(three.rows[0]?.monthsDue).toBe(3);
    expect(three.summary.students).toBe(1);

    const paid = buildFeeRegister(invoices, [], { status: "paid", page: 1, pageSize: 50 });
    expect(paid.rows.map((row) => row.studentName)).toEqual(["Riya Patel"]);
    expect(paid.rows[0]?.receipt).toBe(false);
  });

  it("filters paid rows missing a PAYMENT_RECEIPT and overdue days", () => {
    const invoices = [
      invoice({
        id: "paid-no-receipt",
        studentId: "siya",
        studentName: "Siya Mehta",
        period: "2026-09",
        amount: 4500,
        dueDate: "2026-09-10",
        payments: [{ amount: 4500, method: "CASH", paidAt: "2026-09-08" }],
      }),
      invoice({
        id: "old",
        studentId: "dev",
        studentName: "Dev Kumar",
        className: "4",
        section: "B",
        period: "2026-07",
        amount: 15000,
        dueDate: "2020-01-01",
        payments: [{ amount: 5000, method: "UPI", paidAt: "2026-07-05" }],
      }),
    ];
    const receipts = [
      {
        studentId: "siya",
        invoiceId: "other",
        period: "2026-08",
        documentUrl: "/x",
        documentNumber: "PR-X",
        issuedAt: "2026-08-01",
      },
    ];
    const missing = buildFeeRegister(invoices, receipts, { receipt: "missing", status: "paid", page: 1, pageSize: 50 });
    expect(missing.rows.map((row) => row.id)).toEqual(["paid-no-receipt"]);
    const overdue = buildFeeRegister(invoices, receipts, { overdueDaysGte: 30, page: 1, pageSize: 50 });
    expect(overdue.rows.map((row) => row.studentName)).toEqual(["Dev Kumar"]);
    expect(overdue.rows[0]?.status).toBe("overdue");
    expect(overdue.rows[0]?.balance).toBe(10000);
  });

  it("parses query filters and paginates without inventing fee math", () => {
    const filter = parseFeeRegisterQuery({
      q: "Aarav",
      unpaidMonthsGte: "3",
      methods: "CASH,UPI",
      receipt: "missing",
      page: "2",
      pageSize: "10",
    });
    expect(filter.unpaidMonthsGte).toBe(3);
    expect(filter.methods).toEqual(["CASH", "UPI"]);
    expect(filter.page).toBe(2);
    const invoices = Array.from({ length: 12 }, (_, i) =>
      invoice({
        id: `r${i}`,
        studentId: `s${i}`,
        studentName: `Student ${i}`,
        period: "2026-09",
        amount: 1000,
        dueDate: "2026-09-10",
      })
    );
    const page = buildFeeRegister(invoices, [], { page: 2, pageSize: 5 });
    expect(page.total).toBe(12);
    expect(page.rows).toHaveLength(5);
    expect(page.rows[0]?.studentName).toBe("Student 3");
  });
});
