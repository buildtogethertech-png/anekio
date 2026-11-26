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

async function act(token: string, op: string, body: Record<string, unknown> = {}) {
  return request(app).post("/api/v1/act").set({ Authorization: `Bearer ${token}` }).send({ op, ...body });
}

describe.sequential("edit student: wrong parent number, link to the parent already here", () => {
  const classId = "class-link";
  const studentId = "student-link";
  const edit = (body: Record<string, unknown>) =>
    act(officeToken, "updateStudent", {
      studentId,
      name: "Link Kid",
      admissionNo: "ADM-LINK",
      classId,
      dateOfBirth: "2016-01-01",
      parentName: "Typed Name",
      address: "",
      ...body,
    });

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "student-parent-link-test-secret-long-enough";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
    officeToken = (await request(app).post("/api/v1/login").send({ login: fixture.users.office.email, password: fixture.password })).body.token;
    await prisma.class.create({ data: { id: classId, name: "Link", section: "A" } });
    await prisma.student.create({ data: { id: studentId, classId, admissionNo: "ADM-LINK", name: "Link Kid" } });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("a wrong number made its own parent login", async () => {
    expect((await edit({ parentId: "", parentPhone: "9000000001" })).status).toBe(200);
    const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    expect(student.parentId).toBeTruthy();
    expect(student.parentId).not.toBe("parent-pari");
  });

  it("typing the sibling's number without linking says to link, and changes nothing", async () => {
    const before = await prisma.student.findUniqueOrThrow({ where: { id: studentId } });
    const res = await edit({ parentId: before.parentId, parentPhone: "9876540003" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Pari Parent.*Link/);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).parentId).toBe(before.parentId);
  });

  it("Link moves the student to that parent and leaves their details as they were", async () => {
    const res = await edit({ parentId: "parent-pari", parentPhone: "9876540003", parentEmail: "typed@x.test" });
    expect(res.status).toBe(200);
    expect((await prisma.student.findUniqueOrThrow({ where: { id: studentId } })).parentId).toBe("parent-pari");
    const pari = await prisma.parent.findUniqueOrThrow({ where: { id: "parent-pari" }, include: { user: true } });
    expect(pari).toMatchObject({ phone: "9876540003", address: "1 Fixture Road", city: "Bengaluru" });
    expect(pari.user).toMatchObject({ name: "Pari Parent", email: "parent.fixture@school.test" });
  });

  it("after linking, editing the student as usual still updates that parent", async () => {
    const res = await edit({ parentId: "parent-pari", parentPhone: "9876540003", parentName: "Pari P", address: "2 New Road" });
    expect(res.status).toBe(200);
    expect(await prisma.parent.findUniqueOrThrow({ where: { id: "parent-pari" }, include: { user: true } })).toMatchObject({
      address: "2 New Road",
      user: expect.objectContaining({ name: "Pari P" }),
    });
  });
});
