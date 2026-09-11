import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fetchMock: ReturnType<typeof vi.fn>;
let adminCookie = "";

function resendResponse(id: string) {
  return new Response(JSON.stringify({ id }), { status: 200, headers: { "content-type": "application/json" } });
}

function payload(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit).body));
}

function futureDemoTime(days = 3) {
  return new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();
}

const demoRequest = (ownerEmail: string, demoScheduledAt: string) => ({
  schoolName: "VidyaPith Public School",
  ownerName: "Principal Owner",
  ownerEmail,
  ownerCountryCode: "+91",
  ownerPhone: "9876543210",
  city: "Bengaluru",
  demoTopic: "Full ERP",
  demoScheduledAt,
});

describe.sequential("public demo email workflow", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "saas-demo-email-test-secret-with-enough-entropy";
    // The implementation db was pushed with this schema; copying it avoids
    // a nested Prisma schema-engine process inside Vitest.
    database = createTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    const email = await import("../../lib/saas-email");
    await email.saveSaasEmailConfig(
      {
        enabled: true,
        resendApiKey: "re_test_not_a_real_key",
        productionFromName: "Anekio Support",
        productionFromEmail: "support@anekio.com",
        stagingFromName: "Anekio Staging",
        stagingFromEmail: "support@mail.staging.anekio.com",
        stagingSafeRecipients: ["support@anekio.com"],
      },
      "admin@anekio.com"
    );
    app = (await import("../../server/index")).default;
    const auth = await import("../../lib/saas-admin-auth");
    adminCookie = `${auth.ADMIN_SESSION_COOKIE}=${encodeURIComponent(auth.createAdminSession("admin@anekio.com"))}`;
  }, 120_000);

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValueOnce(resendResponse("internal-1")).mockResolvedValueOnce(resendResponse("customer-1"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("records a demo, sends the internal route first, then sends the customer route", async () => {
    const scheduledAt = futureDemoTime();
    const response = await request(app).post("/api/saas/enquiry").set("Host", "anekio.com").send(demoRequest("owner@school.in", scheduledAt));

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.demo.scheduledAt).toBe(scheduledAt);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = payload(fetchMock.mock.calls[0]);
    const second = payload(fetchMock.mock.calls[1]);
    expect(first).toMatchObject({ from: "Anekio Support <support@anekio.com>", to: ["support@anekio.com"] });
    expect(first.subject).toContain("VidyaPith Public School");
    expect(second).toMatchObject({ from: "Anekio Support <support@anekio.com>", to: ["owner@school.in"] });

    const deliveries = await prisma.saasEmailDelivery.findMany({ orderBy: { createdAt: "asc" } });
    expect(deliveries.map((row) => [row.audience, row.status])).toEqual([
      ["INTERNAL", "SENT"],
      ["CUSTOMER", "SENT"],
    ]);

    // A double-click/replay keeps the same CRM demo and does not send duplicates.
    const replay = await request(app).post("/api/saas/enquiry").set("Host", "anekio.com").send(demoRequest("owner@school.in", scheduledAt));
    expect(replay.status).toBe(200);
    expect(await prisma.saasDemo.count()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("redirects every staging recipient to the staging allow-list", async () => {
    const response = await request(app)
      .post("/api/saas/enquiry")
      .set("Host", "staging.anekio.com")
      .send(demoRequest("real.school@example.edu", futureDemoTime(4)));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const mail = payload(call);
      expect(mail.from).toBe("Anekio Staging <support@mail.staging.anekio.com>");
      expect(mail.to).toEqual(["support@anekio.com"]);
      expect(mail.cc).toBeUndefined();
      expect(mail.bcc).toBeUndefined();
    }
  });

  it("silently drops a filled honeypot before CRM or email delivery", async () => {
    const before = await prisma.saasOrg.count();
    const response = await request(app)
      .post("/api/saas/enquiry")
      .set("Host", "anekio.com")
      .send({ ...demoRequest("bot@example.edu", futureDemoTime(5)), website: "https://spam.example" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(await prisma.saasOrg.count()).toBe(before);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the database-backed email configuration without revealing its Resend key", async () => {
    const page = await request(app).get("/anekio-admin?view=email").set("Cookie", adminCookie);

    expect(page.status).toBe(200);
    expect(page.text).toContain("Email delivery");
    expect(page.text).toContain("Saved securely");
    expect(page.text).not.toContain("re_test_not_a_real_key");
  });
});
