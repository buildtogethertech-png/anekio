import { DEFAULT_PAYROLL_RULES } from "../../lib/payroll";
import { attendancePct, hm, monthRows, usualIn } from "../staff-monthly-report";

const rules = { ...DEFAULT_PAYROLL_RULES, startTime: "08:00", graceMinutes: 10 };
// Mon–Sat open, 2026-11-14 a holiday.
const calendar = { weekdays: [1, 2, 3, 4, 5, 6], holidays: [{ date: "2026-11-14", name: "Diwali" }] } as never;

describe("monthRows", () => {
  it("counts late time only from recorded In times and never guesses", () => {
    const person = {
      id: "t1",
      kind: "teacher",
      name: "Asha",
      days: [
        { date: "2026-11-02", status: "PRESENT", inAt: "08:05" }, // inside grace: on time
        { date: "2026-11-03", status: "PRESENT", inAt: "08:40" }, // late by 40 from 08:00
        { date: "2026-11-04", status: "LATE", inAt: "" }, // late, no time
        { date: "2026-11-05", status: "ABSENT" },
        { date: "2026-11-06", status: "PRESENT", inAt: "" },
        { date: "2026-11-07", status: "LATE", inAt: "21:52" }, // wrong scan: late, minutes not trusted
      ],
      leaveDays: [{ date: "2026-11-09", reason: "", paid: true, typeName: "Casual" }],
    } as never;
    const [r] = monthRows([person], "2026-11", calendar, rules, "2026-11-10");
    expect(r).toMatchObject({ present: 5, absent: 1, leave: 1, late: 3, lateMin: 40, lateUntimed: 2, timed: 3 });
    // Nov 8 is Sunday, Nov 9 on leave, Nov 10 is today: nothing left unmarked.
    expect(r.notMarked).toBe(0);
  });

  it("counts unmarked school days as absent, skipping holidays, days before joining and before the app was used", () => {
    const ravi = { id: "s1", kind: "staff", name: "Ravi", joinedOn: "2026-11-13", days: [] } as never;
    const asha = { id: "t1", kind: "teacher", name: "Asha", days: [{ date: "2026-11-10", status: "PRESENT" }] } as never;
    const [r, a] = monthRows([ravi, asha], "2026-11", calendar, rules, "2026-11-17");
    // Ravi: 13 (Fri), 16 (Mon) unmarked → absent; 14 holiday, 15 Sunday, 17 today.
    expect(r).toMatchObject({ absent: 2, notMarked: 2 });
    // Asha: school first used the app on the 10th, so 2–9 don't count; 11, 12, 13, 16 unmarked → absent.
    expect(a).toMatchObject({ present: 1, absent: 4 });
  });

  it("gives attendance % without leave and a usual In time from believable times only", () => {
    expect(attendancePct({ present: 9, absent: 1 })).toBe(90);
    expect(attendancePct({ present: 0, absent: 0 })).toBeNull();
    const person = {
      id: "t1",
      kind: "teacher",
      name: "Asha",
      days: [
        { date: "2026-11-02", status: "PRESENT", inAt: "08:00" },
        { date: "2026-11-03", status: "PRESENT", inAt: "08:20" },
        { date: "2026-11-04", status: "LATE", inAt: "21:52" }, // wrong scan, left out
      ],
    } as never;
    const [r] = monthRows([person], "2026-11", calendar, rules, "2026-11-05");
    expect(usualIn(r)).toBe("8:10 AM");
  });

  it("formats minutes", () => {
    expect(hm(0)).toBe("0m");
    expect(hm(45)).toBe("45m");
    expect(hm(100)).toBe("1h 40m");
    expect(hm(120)).toBe("2h");
  });
});
