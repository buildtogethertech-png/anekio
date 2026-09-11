import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createTestDatabase, type TestDatabase } from "../support/test-database";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fixture: PortalFixture;

describe("ERP authentication flows", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "auth-flow-test-secret-with-enough-entropy";
    database = createTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "AuthChallenge" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT,
        "identifierHash" TEXT NOT NULL,
        "destination" TEXT NOT NULL DEFAULT '',
        "purpose" TEXT NOT NULL,
        "codeHash" TEXT NOT NULL,
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "expiresAt" DATETIME NOT NULL,
        "consumedAt" DATETIME,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AuthChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await prisma.$executeRawUnsafe('CREATE INDEX "AuthChallenge_identifierHash_purpose_createdAt_idx" ON "AuthChallenge"("identifierHash", "purpose", "createdAt")');
    await prisma.$executeRawUnsafe('CREATE INDEX "AuthChallenge_userId_purpose_createdAt_idx" ON "AuthChallenge"("userId", "purpose", "createdAt")');
    await prisma.$executeRawUnsafe('CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt")');
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("signs in with a short-lived email code and rejects reuse", async () => {
    const requested = await request(app)
      .post("/api/v1/login/otp/request")
      .send({ login: fixture.users.office.email });

    expect(requested.status).toBe(200);
    expect(requested.body.message).not.toContain(fixture.users.office.email);
    expect(requested.body.developmentCode).toMatch(/^\d{6}$/);

    const verified = await request(app)
      .post("/api/v1/login/otp/verify")
      .send({ login: fixture.users.office.email, code: requested.body.developmentCode });
    expect(verified.status).toBe(200);
    expect(verified.body.user).toMatchObject({ id: fixture.users.office.id, portal: "OFFICE" });
    expect(verified.body.token).toEqual(expect.any(String));

    const reused = await request(app)
      .post("/api/v1/login/otp/verify")
      .send({ login: fixture.users.office.email, code: requested.body.developmentCode });
    expect(reused.status).toBe(401);
  });

  it("returns the same generic request response for an unknown account", async () => {
    const response = await request(app)
      .post("/api/v1/login/otp/request")
      .send({ login: "missing@school.test" });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe("If that account has a verified email, a six-digit code is on its way.");
    expect(response.body.destination).toBe("mi*****@school.test");
  });

  it("resets a password after verification and consumes the reset code", async () => {
    const requested = await request(app)
      .post("/api/v1/login/password/request")
      .send({ login: fixture.users.teacher.email });
    const nextPassword = "New-password-2026";

    const reset = await request(app)
      .post("/api/v1/login/password/reset")
      .send({ login: fixture.users.teacher.email, code: requested.body.developmentCode, password: nextPassword });
    expect(reset.status).toBe(200);

    const signedIn = await request(app)
      .post("/api/v1/login")
      .send({ login: fixture.users.teacher.email, password: nextPassword });
    expect(signedIn.status).toBe(200);

    const reused = await request(app)
      .post("/api/v1/login/password/reset")
      .send({ login: fixture.users.teacher.email, code: requested.body.developmentCode, password: "Another-password-2026" });
    expect(reused.status).toBe(401);
  });

  it("requires a strong replacement password", async () => {
    const response = await request(app)
      .post("/api/v1/login/password/reset")
      .send({ login: fixture.users.parent.email, code: "123456", password: "short" });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("at least 8 characters");
  });
});
