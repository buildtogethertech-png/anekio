import { describe, expect, it } from "vitest";
import { navForPortal } from "../../lib/nav";

describe("navigation permission gates", () => {
  it.each([
    ["OFFICE", "roles.manage", "roles"],
    ["OFFICE", "fees.view", "fees"],
    ["OFFICE", "people.view", "people"],
    ["OFFICE", "admissions.view", "admissions"],
    ["OFFICE", "exams.view", "exams"],
    ["OFFICE", "notices.view", "notices"],
    ["OFFICE", "inbox.view", "inbox"],
    ["OFFICE", "timetable.view", "timetable"],
    ["TEACHER", "class.view", "class"],
    ["TEACHER", "attendance.mark", "attendance"],
  ] as const)("%s %s shows %s when on and hides it when off", (portal, permission, key) => {
    const on = navForPortal(portal, [permission]).map((item) => item.key);
    const off = navForPortal(portal, []).map((item) => item.key);
    expect(on).toContain(key);
    expect(off).not.toContain(key);
  });

  it("maps Teacher Notices to attendance.mark", () => {
    expect(navForPortal("TEACHER", ["attendance.mark"]).some((item) => item.key === "notices")).toBe(true);
    expect(navForPortal("TEACHER", ["notices.view"]).some((item) => item.key === "notices")).toBe(false);
  });

  it("maps Subscription to school.edit and Roles to roles.manage", () => {
    expect(navForPortal("OFFICE", ["school.edit"]).map((item) => item.key)).toEqual(
      expect.arrayContaining(["school", "subscription"])
    );
    expect(navForPortal("OFFICE", ["roles.manage"]).map((item) => item.key)).toContain("roles");
    expect(navForPortal("OFFICE", ["fees.view"]).map((item) => item.key)).not.toContain("roles");
  });

  it("hides documents nav because documents.view is not a sidebar item", () => {
    expect(navForPortal("OFFICE", ["documents.view"]).map((item) => item.key)).not.toContain("documents");
  });
});
