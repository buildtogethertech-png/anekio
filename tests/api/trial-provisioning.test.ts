import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";

let database: TestDatabase;
let prisma: PrismaClient;
let app: Express;

describe("trial signup provisioning", () => {
  beforeAll(async () => {
    database = createPushedTestDatabase();
    process.env.ANEKIO_PROVISION_TRIAL_WORKSPACE = "true";
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
  }, 120_000);

  afterAll(async () => {
    delete process.env.ANEKIO_PROVISION_TRIAL_WORKSPACE;
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("creates a school org and admin login for a trial owner", async () => {
    const { createSaasTrial } = await import("../../lib/anekio-site");
    const trial = await createSaasTrial({
      schoolName: "Bright Valley School",
      ownerName: "Nisha Owner",
      ownerEmail: "nisha@example.com",
      ownerPhone: "9708608971",
      city: "Patna",
      state: "Bihar",
    });

    expect(trial).toMatchObject({
      schoolName: "Bright Valley School",
      subscriptionStatus: "TRIAL",
      login: "9708608971",
    });
    expect(trial).not.toHaveProperty("password");
    const user = await prisma.user.findFirstOrThrow({
      where: { orgId: trial.id, OR: [{ email: "nisha@example.com" }, { phone: "9708608971" }] },
      include: { role: true },
    });
    expect(user).toMatchObject({ name: "Nisha Owner", phone: "9708608971", orgId: trial.id, role: { slug: "ADMIN" } });
    await expect(bcrypt.compare("12345", user.password)).resolves.toBe(true);
    await expect(prisma.schoolConfig.findFirstOrThrow({ where: { orgId: trial.id } })).resolves.toMatchObject({
      name: "Bright Valley School",
      phone: "9708608971",
      email: "nisha@example.com",
    });

    const login = await request(app).post("/api/v1/login").send({ login: "9708608971", password: "12345" });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ email: "nisha@example.com", role: "ADMIN" });
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
    expect(first.body).toMatchObject({
      login: "9708608972",
      loginUrl: "/login",
    });
    expect(first.body).not.toHaveProperty("password");
    expect(first.text).not.toContain("12345");

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
      error: "Your email and phone are already registered with Anekio. Please log in to continue.",
      loginUrl: "/login",
      conflictFields: ["email", "phone"],
    });

    const emailOnly = await request(app).post("/api/saas/trial").set("Accept", "application/json").send({
      schoolName: "Another School", ownerName: "New Owner", ownerEmail: "existing-owner@example.com", ownerPhone: "9708608998", city: "Ranchi",
    });
    expect(emailOnly.status).toBe(409);
    expect(emailOnly.body).toMatchObject({
      error: "This email is already registered with Anekio. Please log in to continue.",
      conflictFields: ["email"],
    });

    const phoneOnly = await request(app).post("/api/saas/trial").set("Accept", "application/json").send({
      schoolName: "Another School", ownerName: "New Owner", ownerEmail: "new-owner@example.com", ownerPhone: "9708608972", city: "Ranchi",
    });
    expect(phoneOnly.status).toBe(409);
    expect(phoneOnly.body).toMatchObject({
      error: "This phone is already registered with Anekio. Please log in to continue.",
      conflictFields: ["phone"],
    });
  });

  it("creates a new org admin without taking over another school's user", async () => {
    const fixtureAdmin = await prisma.user.findFirstOrThrow({ where: { email: "office.fixture@school.test" } });
    const response = await request(app)
      .post("/api/saas/trial")
      .set("Accept", "application/json")
      .send({
        schoolName: "Second Valley School",
        ownerName: "Second Owner",
        ownerEmail: "office.fixture@school.test",
        ownerPhone: "9708608974",
        city: "Delhi",
        state: "Delhi",
      });

    expect(response.status).toBe(200);
    expect(response.body.org.id).not.toBe(fixtureAdmin.orgId);
    const trialAdmin = await prisma.user.findFirstOrThrow({
      where: { orgId: response.body.org.id, email: "office.fixture@school.test" },
    });
    expect(trialAdmin.id).not.toBe(fixtureAdmin.id);
    const original = await prisma.user.findUniqueOrThrow({ where: { id: fixtureAdmin.id } });
    expect(original.orgId).toBe(fixtureAdmin.orgId);
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
      "Your Anekio school workspace is ready",
    ]);
    const welcomeChallenge = await prisma.authChallenge.findFirstOrThrow({
      where: { orgId: response.body.org.id, purpose: "PASSWORD_RESET" },
    });
    expect(welcomeChallenge.userId).toBeTruthy();
    expect(welcomeChallenge.consumedAt).toBeNull();
    expect(welcomeChallenge.expiresAt.getTime() - welcomeChallenge.createdAt.getTime()).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(JSON.stringify(response.body)).not.toContain("reset-password?token=");
  });
});
