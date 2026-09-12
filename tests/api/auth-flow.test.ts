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
      CREATE TABLE IF NOT EXISTS "AuthChallenge" (
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
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AuthChallenge_identifierHash_purpose_createdAt_idx" ON "AuthChallenge"("identifierHash", "purpose", "createdAt")');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AuthChallenge_userId_purpose_createdAt_idx" ON "AuthChallenge"("userId", "purpose", "createdAt")');
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt")');
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

  it("asks for the school when the same parent contact has multiple accounts", async () => {
    const parent = await prisma.user.findUniqueOrThrow({ where: { id: fixture.users.parent.id } });
    await prisma.saasOrg.createMany({
      data: [
        { id: "org-choice-a", schoolName: "North Campus", ownerName: "Owner A", ownerEmail: "a@example.test", ownerPhone: "9876500101" },
        { id: "org-choice-b", schoolName: "South Campus", ownerName: "Owner B", ownerEmail: "b@example.test", ownerPhone: "9876500102" },
      ],
    });
    await prisma.user.update({ where: { id: parent.id }, data: { orgId: "org-choice-a" } });
    await prisma.user.create({
      data: {
        id: "user-parent-choice-b",
        orgId: "org-choice-b",
        email: parent.email,
        phone: parent.phone,
        password: parent.password,
        name: "Pari Parent South",
        roleId: parent.roleId,
        parent: { create: { orgId: "org-choice-b", phone: parent.phone } },
      },
    });

    const ambiguous = await request(app)
      .post("/api/v1/login")
      .send({ login: parent.phone, password: fixture.password });
    expect(ambiguous.status).toBe(200);
    expect(ambiguous.body.accountChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixture.users.parent.id, schoolName: "North Campus" }),
      expect.objectContaining({ id: "user-parent-choice-b", schoolName: "South Campus" }),
    ]));

    const selected = await request(app)
      .post("/api/v1/login")
      .send({ login: parent.phone, password: fixture.password, accountId: "user-parent-choice-b" });
    expect(selected.status).toBe(200);
    expect(selected.body.user).toMatchObject({ id: "user-parent-choice-b", portal: "PARENT" });
    expect(selected.body.token).toEqual(expect.any(String));
  });
});
