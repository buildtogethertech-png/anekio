import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { clearCopiedDatabase, createCopiedDevDatabase, type TestDatabase } from "../support/test-database";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fixture: PortalFixture;
let officeToken = "";
let teacherToken = "";
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

describe.sequential("fee setup API", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "fee-setup-test-secret-with-enough-entropy";
    database = createCopiedDevDatabase();
    vi.resetModules();
    const prismaModule = await import("../../lib/prisma");
    prisma = prismaModule.prisma;
    await clearCopiedDatabase(prisma);
    fixture = await seedPortalFixture(prisma);
    await prisma.class.create({ data: { id: "class-6-b", name: "6", section: "B" } });
    app = (await import("../../server/index")).default;
    officeToken = (await login(fixture.users.office.email)).body.token;
    teacherToken = (await login(fixture.users.teacher.email)).body.token;
    parentToken = (await login(fixture.users.parent.email)).body.token;
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("blocks teachers and parents from fee setup writes", async () => {
    const teacher = await act(teacherToken, "saveFeeAcademicSession", { startsOn: "2026-04-01", endsOn: "2027-03-31" });
    const parent = await act(parentToken, "saveAdmissionFeeSetup", { lines: [{ label: "Admission fee", amount: 100 }] });
    expect(teacher.status).toBe(400);
    expect(teacher.body.error).toMatch(/no access/i);
    expect(parent.status).toBe(400);
    expect(parent.body.error).toMatch(/no access/i);
  });

  it("requires both session dates and rejects an end before start", async () => {
    const missing = await act(officeToken, "saveFeeAcademicSession", { startsOn: "2026-04-01" });
    const inverted = await act(officeToken, "saveFeeAcademicSession", { startsOn: "2027-04-01", endsOn: "2026-03-31" });
    expect(missing.body.error).toMatch(/start and end/i);
    expect(inverted.body.error).toMatch(/after session start/i);
  });

  it("saves the academic session onto school config and the current session", async () => {
    const response = await act(officeToken, "saveFeeAcademicSession", {
      startsOn: "2027-04-01",
      endsOn: "2028-03-31",
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, startsOn: "2027-04-01", endsOn: "2028-03-31" });
    const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
    const session = await prisma.schoolSession.findFirst({ where: { current: true } });
    expect(config?.sessionStart).toBe("2027-04-01");
    expect(config?.sessionEnd).toBe("2028-03-31");
    expect(session?.startsOn).toBe("2027-04-01");
    expect(session?.endsOn).toBe("2028-03-31");
    expect(session?.label).toBe("2027–28");
  });

  it("clamps the due day and writes it onto current and unscoped templates", async () => {
    await prisma.feeTemplate.create({
      data: {
        id: "tpl-current",
        classId: fixture.classId,
        sessionId: "session-2026",
        name: "Monthly fee",
        startsPeriod: "2026-04",
        endsPeriod: "2027-03",
        dueDay: 10,
      },
    });
    await prisma.feeTemplate.create({
      data: {
        id: "tpl-unscoped",
        classId: "class-6-b",
        sessionId: null,
        name: "Monthly fee",
        startsPeriod: "2026-04",
        endsPeriod: "2027-03",
        dueDay: 10,
      },
    });
    const high = await act(officeToken, "applySessionDueDay", { dueDay: 99 });
    expect(high.status).toBe(200);
    expect(high.body.dueDay).toBe(31);
    expect((await prisma.feeTemplate.findUnique({ where: { id: "tpl-current" } }))?.dueDay).toBe(31);
    expect((await prisma.feeTemplate.findUnique({ where: { id: "tpl-unscoped" } }))?.dueDay).toBe(31);

    const low = await act(officeToken, "applySessionDueDay", { dueDay: 0 });
    expect(low.body.dueDay).toBe(10);
  });

  it("saves admission fee for one class without touching the other", async () => {
    const one = await act(officeToken, "saveAdmissionFeeSetup", {
      classId: fixture.classId,
      lines: [
        { label: "Admission fee", amount: 5000 },
        { label: "Prospectus", amount: 200 },
      ],
    });
    expect(one.status).toBe(200);
    expect(one.body.classIds).toEqual([fixture.classId]);
    const rows = await prisma.admissionFeeLine.findMany({ orderBy: { sortOrder: "asc" } });
    expect(rows.map((row) => ({ classId: row.classId, label: row.label, amount: row.amount }))).toEqual([
      { classId: fixture.classId, label: "Admission fee", amount: 5000 },
      { classId: fixture.classId, label: "Prospectus", amount: 200 },
    ]);
  });

  it("copies admission fee to every class when classId is omitted", async () => {
    const all = await act(officeToken, "saveAdmissionFeeSetup", {
      lines: [{ label: "Admission fee", amount: 4500 }],
    });
    expect(all.status).toBe(200);
    expect(all.body.classIds.sort()).toEqual(["class-6-b", fixture.classId].sort());
    const rows = await prisma.admissionFeeLine.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.amount === 4500)).toBe(true);
    const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
    expect(config?.admissionCharge).toBe(4500);
  });

  it("rejects an unknown class and ignores blank admission lines", async () => {
    const unknown = await act(officeToken, "saveAdmissionFeeSetup", {
      classId: "missing-class",
      lines: [{ label: "Admission fee", amount: 100 }],
    });
    expect(unknown.body.error).toMatch(/valid class/i);
    const cleared = await act(officeToken, "saveAdmissionFeeSetup", {
      classId: fixture.classId,
      lines: [{ label: "", amount: 0 }],
    });
    expect(cleared.status).toBe(200);
    expect(await prisma.admissionFeeLine.count({ where: { classId: fixture.classId } })).toBe(0);
  });

  it("saves a class monthly template and rejects a template with no charges", async () => {
    const empty = await act(officeToken, "saveFeeTemplate", {
      classId: fixture.classId,
      lines: [],
    });
    expect(empty.body.error).toMatch(/at least one class charge/i);

    const existing = await prisma.feeTemplate.findFirst({ where: { classId: fixture.classId, sessionId: "session-2026" } });
    const saved = await act(officeToken, "saveFeeTemplate", {
      templateId: existing?.id,
      classId: fixture.classId,
      name: "Monthly fee",
      startsPeriod: "2026-04",
      endsPeriod: "2027-03",
      dueDay: 10,
      lines: [
        { label: "Tuition", amount: 5000, scope: "ALL" },
        { label: "Project", amount: 400, scope: "ADD_ON" },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body.ok).toBe(true);
    const template = await prisma.feeTemplate.findFirst({
      where: { classId: fixture.classId, sessionId: "session-2026" },
      include: { lines: true },
    });
    expect(template?.dueDay).toBe(10);
    expect(template?.lines.filter((line) => line.scope === "ALL").map((line) => line.label)).toEqual(["Tuition"]);
    expect(template?.lines.filter((line) => line.scope === "ADD_ON").map((line) => line.label)).toEqual(["Project"]);
  });

  it("allows consecutive class fee structures but rejects overlapping periods", async () => {
    const next = await act(officeToken, "saveFeeTemplate", {
      classId: fixture.classId,
      name: "Revised monthly fee",
      startsPeriod: "2027-04",
      endsPeriod: "2027-06",
      dueDay: 10,
      lines: [{ label: "Tuition", amount: 5500, scope: "ALL" }],
    });
    expect(next.status).toBe(200);

    const overlap = await act(officeToken, "saveFeeTemplate", {
      classId: fixture.classId,
      name: "Overlapping fee",
      startsPeriod: "2027-06",
      endsPeriod: "2027-08",
      dueDay: 10,
      lines: [{ label: "Tuition", amount: 6000, scope: "ALL" }],
    });
    expect(overlap.status).toBe(400);
    expect(overlap.body.error).toMatch(/overlap/i);

    const duplicate = await act(officeToken, "saveFeeTemplate", {
      classId: fixture.classId,
      name: "Duplicate fee",
      startsPeriod: "2027-04",
      endsPeriod: "2027-06",
      dueDay: 10,
      lines: [{ label: "Tuition", amount: 5500, scope: "ALL" }],
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.error).toMatch(/overlap/i);
  });

  it("saves transport and other catalog fees", async () => {
    const transport = await act(officeToken, "saveFeeCatalog", {
      item: { kind: "TRANSPORT", label: "Route A", amount: 800 },
    });
    const other = await act(officeToken, "saveFeeCatalog", {
      item: { kind: "OTHER", label: "Computer fee", amount: 300 },
    });
    expect(transport.status).toBe(200);
    expect(other.status).toBe(200);
    const labels = [...transport.body.items, ...other.body.items].map((item: { label: string }) => item.label);
    expect(labels).toEqual(expect.arrayContaining(["Route A", "Computer fee"]));
  });

  it("saves the session late fee onto the catalog and current templates", async () => {
    const response = await act(officeToken, "applySessionLateFee", {
      enabled: true,
      amount: 50,
      graceDays: 5,
      rule: "STATIC",
    });
    expect(response.status).toBe(200);
    const template = await prisma.feeTemplate.findFirst({ where: { classId: fixture.classId, sessionId: "session-2026" } });
    expect(template?.lateKind).toBe("STATIC");
    expect(template?.lateAmount).toBe(50);
    expect(template?.lateGraceDays).toBe(5);
  });
});
