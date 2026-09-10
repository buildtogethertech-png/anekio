import { describe, expect, it } from "vitest";
import { paidFeeMonthCount, reportCardFeeMonthsRequired, reportCardUnlocked } from "../../lib/fees";
import { evaluatorNoticeUserIds } from "../../lib/exam-events";

describe("report card fee months", () => {
  it("counts fully paid invoices as paid months", () => {
    expect(
      paidFeeMonthCount([
        { amount: 1000, dueDate: "2026-04-10", payments: [{ amount: 1000 }] },
        { amount: 1000, dueDate: "2026-05-10", payments: [{ amount: 400 }] },
        { amount: 1000, dueDate: "2026-06-10", payments: [] },
      ])
    ).toBe(1);
  });

  it("treats 0 required months as unlocked for everyone", () => {
    expect(reportCardFeeMonthsRequired({ reportCardPaidMonths: 0 })).toBe(0);
    expect(reportCardUnlocked(0, 0)).toBe(true);
    expect(reportCardUnlocked(2, 3)).toBe(false);
    expect(reportCardUnlocked(3, 3)).toBe(true);
  });
});

describe("subject publish recipients", () => {
  it("notifies only the subject teacher and granted evaluators", () => {
    expect(
      evaluatorNoticeUserIds({
        id: "exam-1",
        title: "UT2 Social Studies",
        classId: "class-1-a",
        date: new Date("2026-09-10"),
        class: { name: "1", section: "A" },
        subject: { name: "Social Studies" },
        teacher: { user: { id: "user-kavita" } },
        evaluators: [{ teacher: { user: { id: "user-extra" } } }],
      })
    ).toEqual(["user-extra", "user-kavita"]);
  });
});
