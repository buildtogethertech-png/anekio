import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AccessUser } from "../../lib/permissions";
import { seedPortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase;
let prisma: PrismaClient;
let user: AccessUser;

describe("school onboarding state", () => {
  beforeAll(async () => {
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    const fixture = await seedPortalFixture(prisma);
    const org = await prisma.saasOrg.create({
      data: {
        id: "org-onboarding-state",
        schoolName: "State Academy",
        ownerName: "Ojas Office",
        ownerEmail: "office.state@school.test",
        ownerPhone: "9876540011",
      },
    });
    const office = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.users.office.id },
      include: { role: { include: { grants: true } } },
    });
    user = {
      id: office.id,
      name: office.name,
      email: office.email,
      role: office.role.slug,
      roleName: office.role.name,
      roleId: office.roleId,
      orgId: org.id,
      portal: "OFFICE",
      permissions: office.role.grants.map((grant) => grant.permission),
      scopes: Object.fromEntries(office.role.grants.map((grant) => [grant.permission, grant.scope || "SCHOOL"])) as AccessUser["scopes"],
      isSystemRole: true,
    };
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("creates per-org onboarding state while a tenant is active", async () => {
    const { setTenantOrg } = await import("../../lib/tenant-context");
    const { ensureOnboardingState, onboardingBundle } = await import("../../lib/onboarding");
    setTenantOrg(user.orgId);
    const state = await ensureOnboardingState(user);
    expect(state.id).toBe(`school:${user.orgId}`);
    expect(state.orgId).toBe(user.orgId);
    const again = await ensureOnboardingState(user);
    expect(again.id).toBe(state.id);
    const bundle = await onboardingBundle(user);
    expect(Array.isArray(bundle.steps)).toBe(true);
    expect(bundle.steps.length).toBeGreaterThan(0);
  });
});
