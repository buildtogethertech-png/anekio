import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";

let prisma: PrismaClient;
let database: TestDatabase;

describe.sequential("next admission number when the highest student has left", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    await prisma.class.create({ data: { id: "class-adm", name: "Adm", section: "A" } });
    await prisma.student.createMany({
      data: [
        { id: "s-272", classId: "class-adm", admissionNo: "ANE-00272", name: "Still Here" },
        { id: "s-273", classId: "class-adm", admissionNo: "ANE-00273", name: "Left Today", leftOn: "2026-11-26" },
      ],
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("skips the number of a student who left", async () => {
    const { nextAdmissionNo } = await import("../../lib/admission-number");
    expect(await nextAdmissionNo(prisma, null)).toBe("ANE-00274");
  });
});
