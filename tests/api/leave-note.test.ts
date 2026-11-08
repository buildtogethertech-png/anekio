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
let teacherToken = "";

async function act(token: string, op: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/v1/act")
    .set({ Authorization: `Bearer ${token}` })
    .send({ op, ...body });
}

describe.sequential("note to approver per leave type", () => {
  beforeAll(async () => {
    // A fixed Wednesday, so Thursday is a school day and needs no notice.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T06:30:00Z"));
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "leave-note-test-secret-long-enough-1";
    database = createPushedTestDatabase();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
    teacherToken = (await request(app).post("/api/v1/login").send({ login: fixture.users.teacher.email, password: fixture.password })).body.token;
    await prisma.leaveType.create({ data: { id: "lt-sick", name: "Sick quick", noticeDays: 0, yearlyCap: 10, noteRequired: false } });
    await prisma.leaveType.create({ data: { id: "lt-planned", name: "Planned note", noticeDays: 0, yearlyCap: 10 } });
  }, 90_000);

  afterAll(async () => {
    vi.useRealTimers();
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("a type with the note on still needs one", async () => {
    const res = await act(teacherToken, "applyLeave", { typeId: "lt-planned", from: "2026-11-05", to: "2026-11-05", reason: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/short note for the approver/);
  });

  it("a type with the note off can be applied without one", async () => {
    const res = await act(teacherToken, "applyLeave", { typeId: "lt-sick", from: "2026-11-05", to: "2026-11-05", reason: "" });
    expect(res.status).toBe(200);
    expect(await prisma.leaveRequest.count({ where: { typeId: "lt-sick" } })).toBe(1);
  });

  it("the setting comes back with the leave types", async () => {
    const rec = await request(app).get("/api/v1/record").set({ Authorization: `Bearer ${teacherToken}` });
    const types = rec.body.leaveTypes as { id: string; noteRequired: boolean }[];
    expect(types.find((t) => t.id === "lt-sick")?.noteRequired).toBe(false);
    expect(types.find((t) => t.id === "lt-planned")?.noteRequired).toBe(true);
  });
});
