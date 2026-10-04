import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";

const CRON_SECRET = "fee-cron-test-secret";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fixture: PortalFixture;
let officeToken = "";

async function login(email: string, password = fixture.password) {
  return request(app).post("/api/v1/login").send({ login: email, password });
}

async function act(token: string, op: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/v1/act")
    .set({ Authorization: `Bearer ${token}` })
    .send({ op, ...body });
}

function cron(headers: Record<string, string> = {}) {
  return request(app).post("/api/cron/fees").set(headers);
}

describe.sequential("fee cron", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "fee-cron-test-secret-with-enough-entropy";
    process.env.CRON_SECRET = CRON_SECRET;
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
  }, 120_000);

  afterEach(() => {
    vi.useRealTimers();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("rejects missing, empty, and wrong cron secrets and never echoes the secret", async () => {
    const missing = await cron();
    const wrong = await cron({ Authorization: "Bearer not-the-secret" });
    const configured = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "";
    const empty = await cron({ Authorization: "Bearer " });
    process.env.CRON_SECRET = configured;
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(empty.status).toBe(401);
    expect(JSON.stringify(missing.body) + String(missing.text)).not.toContain(CRON_SECRET);
    expect(JSON.stringify(wrong.body) + String(wrong.text)).not.toContain(CRON_SECRET);
  });

  it("issues through the current month once, including October on 4 Oct, without duplicating or creating admission invoices", async () => {
    const classId = "class-cron-fees";
    await prisma.class.create({ data: { id: classId, name: "Cron", section: "F" } });
    const student = await prisma.student.create({
      data: {
        id: "student-cron-fees",
        parentId: "parent-pari",
        classId,
        admissionNo: "ADM-CRON-1",
        name: "Cron Child",
        dateOfBirth: new Date("2015-01-01T00:00:00Z"),
      },
    });
    await prisma.studentClassEnrollment.create({
      data: {
        studentId: student.id,
        classId,
        sessionId: "session-2026",
        rollNumber: 1,
        joinedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    });
    await prisma.feeInvoice.create({
      data: {
        studentId: student.id,
        classId,
        period: `ADMISSION-${student.id}`,
        title: "One-time admission fee",
        amount: 4000,
        linesJson: "[]",
        dueDate: new Date("2026-04-01T00:00:00.000Z"),
        status: "DUE",
      },
    });
    const saved = await act(officeToken, "saveFeeTemplate", {
      classId,
      sessionId: "session-2026",
      name: "Monthly fee",
      startsPeriod: "2026-04",
      endsPeriod: "2027-03",
      dueDay: 10,
      lines: [{ label: "Tuition", amount: 1500, scope: "ALL" }],
    });
    expect(saved.status).toBe(200);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
    const first = await cron({ Authorization: `Bearer ${CRON_SECRET}` });
    const second = await cron({ Authorization: `Bearer ${CRON_SECRET}` });
    const [a, b] = await Promise.all([
      cron({ Authorization: `Bearer ${CRON_SECRET}` }),
      cron({ Authorization: `Bearer ${CRON_SECRET}` }),
    ]);
    vi.useRealTimers();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(JSON.stringify(first.body)).not.toContain(CRON_SECRET);

    const invoices = await prisma.feeInvoice.findMany({ where: { studentId: student.id } });
    const monthly = invoices.filter((row) => /^\d{4}-\d{2}$/.test(row.period)).map((row) => row.period).sort();
    expect(monthly).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(invoices.filter((row) => row.period.startsWith("ADMISSION-"))).toHaveLength(1);
    const counted = await prisma.feeInvoice.groupBy({
      by: ["studentId", "period"],
      where: { studentId: student.id },
      _count: { _all: true },
    });
    expect(counted.every((row) => row._count._all === 1)).toBe(true);
  });
});
