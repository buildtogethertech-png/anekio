import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applicableMonthlyFee,
  clampFeeDueDay,
  catalogAddOnKind,
  catalogAddOnLabel,
  classAddOnKind,
  feeTemplateLateWrite,
  lateStampFromSetup,
  composeStudentFeeLines,
  parseCatalogAddOnKind,
  parseFeeCatalogState,
  studentHasClassAddOn,
} from "../../lib/fees";
import { invoiceBalance } from "../../lib/fees";

describe("fee catalog and student assignment", () => {
  it("keeps class templates independent in catalog math", () => {
    const class1 = applicableMonthlyFee({
      classLines: [{ label: "Tuition", amount: 1000, scope: "ALL" }],
      addOns: [],
      period: "2026-09",
    });
    const class2 = applicableMonthlyFee({
      classLines: [{ label: "Tuition", amount: 1400, scope: "ALL" }],
      addOns: [],
      period: "2026-09",
    });
    expect(class1.total).toBe(1000);
    expect(class2.total).toBe(1400);
  });

  it("does not bill optional catalog fees from class ALL lines", () => {
    const billed = composeStudentFeeLines(
      [
        { label: "Tuition", amount: 1200, scope: "ALL" },
        { label: "Computer Fee", amount: 300, scope: "ADD_ON" },
      ],
      [],
      "2026-09"
    );
    expect(billed.map((line) => line.label)).toEqual(["Tuition"]);
    expect(billed.reduce((sum, line) => sum + line.amount, 0)).toBe(1200);
  });

  it("bills a class add-on only when the student opted in", () => {
    const project = { label: "Project", kind: "CLASS:project", amount: 400, cadence: "MONTHLY", active: true };
    const opted = applicableMonthlyFee({
      classLines: [
        { label: "Tuition", amount: 1200, scope: "ALL" },
        { label: "Project", amount: 400, scope: "ADD_ON" },
      ],
      addOns: [project],
      period: "2026-09",
    });
    const skipped = applicableMonthlyFee({
      classLines: [
        { label: "Tuition", amount: 1200, scope: "ALL" },
        { label: "Project", amount: 400, scope: "ADD_ON" },
      ],
      addOns: [],
      period: "2026-09",
    });
    expect(opted.total).toBe(1600);
    expect(opted.extras.map((line) => line.label)).toEqual(["Project"]);
    expect(skipped.total).toBe(1200);
  });

  it("matches opted-in class add-ons by CLASS kind or CHARGE label", () => {
    expect(classAddOnKind("Project")).toBe("CLASS:project");
    expect(studentHasClassAddOn([{ kind: "CLASS:project", label: "Project" }], "Project")).toBe(true);
    expect(studentHasClassAddOn([{ kind: "CHARGE", label: "Project" }], "Project")).toBe(true);
    expect(studentHasClassAddOn([{ kind: "OTHER:c1", label: "Project" }], "Project")).toBe(false);
  });

  it("uses the class fee when the student has no add-ons", () => {
    const fee = applicableMonthlyFee({
      classLines: [{ label: "Tuition", amount: 1400, scope: "ALL" }],
      addOns: [],
      period: "2026-09",
    });
    expect(fee.extras).toEqual([]);
    expect(fee.total).toBe(1400);
  });

  it("parses a universal catalog kind", () => {
    const kind = catalogAddOnKind("OTHER", "computer");
    expect(parseCatalogAddOnKind(kind)).toEqual({ kind: "OTHER", id: "computer" });
    expect(parseCatalogAddOnKind("CHARGE")).toBeNull();
  });

  it("assigns optional computer to one student only", () => {
    const computer = { id: "comp", kind: "OTHER" as const, label: "Computer Fee", amount: 300, active: true };
    const studentA = applicableMonthlyFee({
      classLines: [{ label: "Tuition", amount: 1200, scope: "ALL" }],
      addOns: [{ label: computer.label, kind: catalogAddOnKind("OTHER", computer.id), amount: 300, cadence: "MONTHLY", active: true }],
      period: "2026-09",
    });
    const studentB = applicableMonthlyFee({
      classLines: [{ label: "Tuition", amount: 1200, scope: "ALL" }],
      addOns: [],
      period: "2026-09",
    });
    expect(studentA.total).toBe(1500);
    expect(studentB.total).toBe(1200);
  });

  it("applies a flat discount to a student's monthly fee", () => {
    const fee = applicableMonthlyFee({
      classLines: [{ label: "Tuition", amount: 1200, scope: "ALL" }],
      addOns: [{ label: "Discount", kind: "DISCOUNT", amount: 200, cadence: "MONTHLY", active: true }],
      period: "2026-09",
    });
    expect(fee.total).toBe(1000);
    expect(fee.extras).toEqual([{ label: "Discount", kind: "FLAT", amount: -200 }]);
  });

  it("applies a percentage discount to the class fee and selected add-ons", () => {
    const fee = applicableMonthlyFee({
      classLines: [{ label: "Tuition", amount: 1200, scope: "ALL" }],
      addOns: [
        { label: "Computer Fee", kind: "OTHER:computer", amount: 300, cadence: "MONTHLY", active: true },
        { label: "Discount", kind: "DISCOUNT_PERCENT", amount: 10, cadence: "MONTHLY", active: true },
      ],
      period: "2026-09",
    });
    expect(fee.total).toBe(1350);
    expect(fee.extras).toEqual([
      { label: "Computer Fee", kind: "FLAT", amount: 300 },
      { label: "Discount (10%)", kind: "FLAT", amount: -150 },
    ]);
  });

  it("excludes inactive and expired add-ons from future invoices", () => {
    const lines = composeStudentFeeLines(
      [{ label: "Tuition", amount: 1400, scope: "ALL" }],
      [
        { label: "Computer Fee", kind: "OTHER:c1", amount: 300, cadence: "MONTHLY", active: false },
        { label: "Library Fee", kind: "OTHER:l1", amount: 100, cadence: "MONTHLY", active: true, startsPeriod: "2026-04", endsPeriod: "2026-08" },
      ],
      "2026-09"
    );
    expect(lines.map((line) => line.label)).toEqual(["Tuition"]);
  });

  it("snapshots class and universal add-on lines at issue composition time", () => {
    const lines = composeStudentFeeLines(
      [{ label: "Tuition", amount: 1400, scope: "ALL" }],
      [
        { label: "Computer Fee", kind: "OTHER:c", amount: 300, cadence: "MONTHLY", active: true },
      ],
      "2026-09"
    );
    expect(lines).toEqual([
      { label: "Tuition", kind: "FLAT", amount: 1400 },
      { label: "Computer Fee", kind: "FLAT", amount: 300 },
    ]);
  });

  it("does not rewrite a historical invoice amount when catalog price changes", () => {
    const issued = { amount: 1500, dueDate: new Date("2026-09-10"), payments: [] };
    const laterCatalogAmount = 1800;
    expect(issued.amount).toBe(1500);
    expect(laterCatalogAmount).not.toBe(issued.amount);
  });

  it("adds ₹10 late fee for each overdue month on unpaid invoices", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T08:00:00Z"));
    const month = () =>
      invoiceBalance({
        amount: 1000,
        dueDate: new Date("2026-09-10"),
        lateKind: "RECURRING",
        lateAmount: 10,
        lateGraceDays: 5,
        lateIntervalCount: 1,
        lateIntervalUnit: "MONTH",
        payments: [],
      }).late;
    expect(month() + month() + month()).toBe(30);
    vi.useRealTimers();
  });

  it("adds ₹50 late fee across five overdue months at ₹10 each", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T08:00:00Z"));
    const late = Array.from({ length: 5 }, () =>
      invoiceBalance({
        amount: 1000,
        dueDate: new Date("2026-09-10"),
        lateKind: "RECURRING",
        lateAmount: 10,
        lateGraceDays: 5,
        lateIntervalCount: 1,
        lateIntervalUnit: "MONTH",
        payments: [],
      }).late
    ).reduce((sum, value) => sum + value, 0);
    expect(late).toBe(50);
    vi.useRealTimers();
  });

  it("drops a fully paid month from outstanding fee and late", () => {
    const paid = invoiceBalance({
      amount: 1000,
      dueDate: new Date("2026-06-10"),
      lateKind: "RECURRING",
      lateAmount: 10,
      lateGraceDays: 0,
      lateIntervalCount: 1,
      lateIntervalUnit: "MONTH",
      payments: [{ amount: 1000 }],
    });
    expect(paid.remaining).toBe(0);
    expect(paid.late).toBe(0);
    expect(paid.dueNow).toBe(0);
  });

  it("ignores removed transport entries in school-scoped catalog json", () => {
    const parsed = parseFeeCatalogState(
      JSON.stringify({
        items: [
          { id: "a", kind: "TRANSPORT", label: "Route A", amount: 1000, active: true },
          { id: "c", kind: "OTHER", label: "Computer Fee", amount: 300, active: true },
        ],
        late: { enabled: true, amount: 10, graceDays: 5 },
      })
    );
    expect(parsed.items.filter((item) => item.kind === "OTHER")).toHaveLength(1);
    expect(parsed.late).toEqual({
      enabled: true,
      amount: 10,
      graceDays: 5,
      rule: "RECURRING_MONTH",
      intervalCount: 1,
    });
    expect(parsed.dueDay).toBe(10);
  });

  it("clamps due day 0 to 10 and values above 28 to 28", () => {
    expect(clampFeeDueDay(0)).toBe(10);
    expect(clampFeeDueDay(29)).toBe(28);
    expect(clampFeeDueDay(99)).toBe(28);
    expect(clampFeeDueDay(1)).toBe(1);
    expect(feeTemplateLateWrite(lateStampFromSetup({ enabled: false }).stamp)).not.toHaveProperty("lateFeePerDay");
  });
});
