import { describe, expect, it } from "vitest";
import {
  can,
  defaultGrants,
  PERMISSION_KEYS,
  PERMISSIONS,
  permissionsForPortal,
  scopeFor,
  scopePolicyFor,
  SYSTEM_ROLES,
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
  it("keeps catalog keys unique, with documents.design and no documents.studio", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    expect(PERMISSION_KEYS).toContain("documents.design");
    expect(PERMISSION_KEYS).not.toContain("documents.studio");
    expect(PERMISSIONS.find((row) => row.key === "documents.design")?.portals).toEqual(["OFFICE"]);
  });

  it("defines exactly the seven system roles", () => {
    expect(SYSTEM_ROLES.map((row) => row.slug)).toEqual([
      "ADMIN",
      "ADMISSIONS",
      "FEES",
      "EXAMS",
      "TEACHER",
      "PARENT",
      "STUDENT",
    ]);
    expect(SYSTEM_ROLES.every((row) => row.portal)).toBe(true);
  });

  it("maps system roles onto OFFICE, TEACHER, PARENT, and STUDENT portals", () => {
    expect(SYSTEM_ROLES.map((row) => [row.slug, row.portal])).toEqual([
      ["ADMIN", "OFFICE"],
      ["ADMISSIONS", "OFFICE"],
      ["FEES", "OFFICE"],
      ["EXAMS", "OFFICE"],
      ["TEACHER", "TEACHER"],
      ["PARENT", "PARENT"],
      ["STUDENT", "STUDENT"],
    ]);
  });

  it("rejects invalid scopes for each family of permissions", () => {
    expect(validScopeFor("fees.view", "ASSIGNED")).toBe(false);
    expect(validScopeFor("attendance.mark", "SCHOOL")).toBe(false);
    expect(validScopeFor("children.view", "SCHOOL")).toBe(false);
    expect(validScopeFor("leave.decide", "ASSIGNED")).toBe(false);
    expect(validScopeFor("fees.view", "SCHOOL")).toBe(true);
  });

  it("marks see permissions separately from action permissions", () => {
    expect(PERMISSIONS.filter((row) => row.see).map((row) => row.key)).toEqual(
      expect.arrayContaining(["people.view", "fees.view", "exams.view", "roles.manage", "attendance.mark"])
    );
    expect(PERMISSIONS.find((row) => row.key === "fees.collect")?.see).toBeUndefined();
    expect(PERMISSIONS.find((row) => row.key === "people.import")?.see).toBeUndefined();
  });

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

    expect(parentPermissions.map((permission) => permission.key)).toEqual([
      "inbox.view",
      "inbox.manage",
      "children.view",
      "fees.pay",
    ]);
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
