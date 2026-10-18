import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fixture: PortalFixture;
let officeToken = "";
let parentToken = "";

async function login(email: string, password = fixture.password) {
  return request(app).post("/api/v1/login").send({ login: email, password });
}

async function act(token: string, op: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/v1/act")
    .set({ Authorization: `Bearer ${token}` })
    .send({ op, ...body });
}

async function bell(token: string) {
  const res = await request(app).get("/api/v1/notices").set({ Authorization: `Bearer ${token}` });
  expect(res.status).toBe(200);
  return (res.body.notices || []) as { kind: string; title: string; body: string; eventKey?: string }[];
}

describe.sequential("inbox messages reach the notification bell", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "inbox-notifications-test-secret-with-enough-entropy";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
    parentToken = (await login(fixture.users.parent.email)).body.token;
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("notifies the office when a parent starts a thread, and the parent when the office replies", async () => {
    const started = await act(parentToken, "startInboxThread", {
      studentId: fixture.studentId,
      target: "OFFICE",
      subject: "Fee receipt missing",
      message: "I paid on Monday but no receipt yet.",
    });
    expect(started.status).toBe(200);
    const threadId = String(started.body.threadId || started.body.id || "");

    const officeBell = await bell(officeToken);
    const toOffice = officeBell.find((n) => n.kind === "INBOX");
    expect(toOffice?.title).toContain("Fee receipt missing");
    expect(toOffice?.eventKey?.startsWith("INBOX:")).toBe(true);
    // The parent who wrote it does not get notified about their own message.
    expect((await bell(parentToken)).some((n) => n.kind === "INBOX")).toBe(false);

    const replied = await act(officeToken, "sendInboxMessage", { threadId, body: "Sending it now." });
    expect(replied.status).toBe(200);
    const parentBell = await bell(parentToken);
    const toParent = parentBell.find((n) => n.kind === "INBOX");
    expect(toParent?.body).toBe("Sending it now.");
    if (threadId) expect(toParent?.eventKey).toContain(threadId);
  });
});
