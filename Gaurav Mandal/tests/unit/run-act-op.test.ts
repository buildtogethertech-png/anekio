import { describe, expect, it } from "vitest";
import { actOp } from "../../lib/run-act";

describe("actOp", () => {
  it("keeps saveSchoolPayrollRules even when other fields are present", () => {
    expect(
      actOp({
        startTime: "09:00",
        graceMinutes: 5,
        lateDeductionMode: "NONE",
        op: "saveSchoolPayrollRules",
      })
    ).toBe("saveSchoolPayrollRules");
  });

  it("treats a late-timing body without op as saveSchoolPayrollRules", () => {
    expect(actOp({ startTime: "08:00", graceMinutes: 10, endTime: "14:00" })).toBe("saveSchoolPayrollRules");
  });

  it("treats a staff register body without op as markStaffAttendance", () => {
    expect(actOp({ date: "2026-09-09", rows: [{ kind: "teacher", id: "t1" }] })).toBe("markStaffAttendance");
  });
});
