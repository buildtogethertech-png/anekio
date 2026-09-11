import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture } from "../support/factories";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase;
let prisma: PrismaClient;

describe("trial signup provisioning", () => {
  beforeAll(async () => {
    database = createTestDatabase();
    process.env.ANEKIO_PROVISION_TRIAL_WORKSPACE = "true";
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    await seedPortalFixture(prisma);
  }, 30_000);

  afterAll(async () => {
    delete process.env.ANEKIO_PROVISION_TRIAL_WORKSPACE;
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("creates a local admin login for a trial owner", async () => {
    const { createSaasTrial } = await import("../../lib/anekio-site");
    const trial = await createSaasTrial({
      schoolName: "Bright Valley School",
      ownerName: "Nisha Owner",
      ownerEmail: "nisha@example.com",
      ownerPhone: "9708608971",
      city: "Patna",
      state: "Bihar",
    });

    expect(trial).toMatchObject({ schoolName: "Bright Valley School", subscriptionStatus: "TRIAL" });
    const user = await prisma.user.findFirstOrThrow({
      where: { OR: [{ email: "nisha@example.com" }, { phone: "9708608971" }] },
      include: { role: true },
    });
    expect(user).toMatchObject({ name: "Nisha Owner", phone: "9708608971", role: { slug: "ADMIN" } });
    await expect(bcrypt.compare("12345", user.password)).resolves.toBe(true);
    await expect(prisma.schoolConfig.findUniqueOrThrow({ where: { id: "school" } })).resolves.toMatchObject({
      name: "Bright Valley School",
      phone: "9708608971",
      email: "nisha@example.com",
    });
  });
});
