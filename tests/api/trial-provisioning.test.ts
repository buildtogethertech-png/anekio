import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture } from "../support/factories";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase;
let prisma: PrismaClient;
let app: Express;

describe("trial signup provisioning", () => {
  beforeAll(async () => {
    database = createTestDatabase();
    process.env.ANEKIO_PROVISION_TRIAL_WORKSPACE = "true";
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
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

  it("returns a login path when trial contact already exists", async () => {
    const first = await request(app)
      .post("/api/saas/trial")
      .set("Accept", "application/json")
      .send({
        schoolName: "Already There School",
        ownerName: "Existing Owner",
        ownerEmail: "existing-owner@example.com",
        ownerPhone: "9708608972",
        city: "Ranchi",
        state: "Jharkhand",
      });
    expect(first.status).toBe(200);

    const duplicate = await request(app)
      .post("/api/saas/trial")
      .set("Accept", "application/json")
      .send({
        schoolName: "Already There School",
        ownerName: "Existing Owner",
        ownerEmail: "existing-owner@example.com",
        ownerPhone: "9708608972",
        city: "Ranchi",
        state: "Jharkhand",
      });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({
      error: "This email or phone is already registered with Anekio. Please log in to continue.",
      loginUrl: "/login",
    });
  });

  it("creates onboarding email deliveries for new trial signups", async () => {
    const response = await request(app)
      .post("/api/saas/trial")
      .set("Accept", "application/json")
      .send({
        schoolName: "Mail Trial School",
        ownerName: "Mail Owner",
        ownerEmail: "mail-owner@example.com",
        ownerPhone: "9708608973",
        city: "Delhi",
        state: "Delhi",
      });

    expect(response.status).toBe(200);
    const deliveries = await prisma.saasEmailDelivery.findMany({
      where: { orgId: response.body.org.id, event: "TRIAL_STARTED" },
      include: { rule: true },
      orderBy: { audience: "asc" },
    });
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((delivery) => delivery.audience).sort()).toEqual(["CUSTOMER", "INTERNAL"]);
    expect(deliveries.map((delivery) => delivery.rule?.subjectTemplate).sort()).toEqual([
      "New Anekio trial started · {{schoolName}}",
      "Your Anekio trial is ready",
    ]);
  });
});
