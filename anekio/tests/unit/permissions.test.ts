import { describe, expect, it } from "vitest";
import {
  can,
  defaultGrants,
  PERMISSION_KEYS,
  permissionsForPortal,
  scopeFor,
  scopePolicyFor,
  validScopeFor,
  type AccessUser,
} from "../../lib/permissions";

function userWith(permissions: string[]): AccessUser {
  return {
    id: "user-1",
    role: "FIXTURE",
    roleName: "Fixture",
    roleId: "role-1",
    portal: "OFFICE",
    permissions,
    scopes: {},
    isSystemRole: false,
  };
}

describe("permission policy", () => {
  it("grants Admin every catalogued permission without duplicates", () => {
    const grants = defaultGrants("ADMIN");

    expect(grants).toEqual(PERMISSION_KEYS);
    expect(new Set(grants).size).toBe(grants.length);
    expect(grants).toContain("roles.manage");
  });

  it.each([
    ["TEACHER", "attendance.mark", "roles.manage"],
    ["PARENT", "children.view", "attendance.mark"],
    ["STUDENT", "self.view", "people.view"],
    ["FEES", "fees.collect", "exams.publish"],
  ])("keeps %s defaults inside the role boundary", (role, allowed, forbidden) => {
    const grants = defaultGrants(role);

    expect(grants).toContain(allowed);
    expect(grants).not.toContain(forbidden);
  });

  it("checks exact permission keys rather than prefixes", () => {
    const user = userWith(["fees.view"]);

    expect(can(user, "fees.view")).toBe(true);
    expect(can(user, "fees.collect")).toBe(false);
    expect(can(null, "fees.view")).toBe(false);
  });

  it("exposes only permissions valid for the requested portal", () => {
    const parentPermissions = permissionsForPortal("PARENT");

    expect(parentPermissions.map((permission) => permission.key)).toEqual(["children.view", "fees.pay"]);
    expect(parentPermissions.every((permission) => (permission.portals as readonly string[]).includes("PARENT"))).toBe(true);
  });

  it("uses fixed scopes for personal and assigned work", () => {
    expect(scopePolicyFor("self.view")).toEqual({ scopes: ["SELF"], defaultScope: "SELF" });
    expect(scopePolicyFor("attendance.mark")).toEqual({ scopes: ["ASSIGNED"], defaultScope: "ASSIGNED" });
    expect(scopePolicyFor("fees.collect")).toEqual({ scopes: ["SCHOOL"], defaultScope: "SCHOOL" });
  });

  it("allows only reports or school scope for manager-sensitive work", () => {
    expect(scopePolicyFor("leave.decide")).toEqual({
      scopes: ["REPORTS", "SCHOOL"],
      defaultScope: "REPORTS",
    });
    expect(validScopeFor("leave.decide", "REPORTS")).toBe(true);
    expect(validScopeFor("leave.decide", "SELF")).toBe(false);
    expect(scopePolicyFor("leave.decide", "TEACHER")).toEqual({
      scopes: ["REPORTS"],
      defaultScope: "REPORTS",
    });
    expect(validScopeFor("leave.decide", "SCHOOL", "TEACHER")).toBe(false);
  });

  it("reads an explicit grant scope and otherwise uses the safe catalog default", () => {
    const user = userWith(["leave.decide"]);
    user.scopes["leave.decide"] = "SCHOOL";

    expect(scopeFor(user, "leave.decide")).toBe("SCHOOL");
    expect(scopeFor(user, "timetable.view")).toBe("REPORTS");
  });
});
