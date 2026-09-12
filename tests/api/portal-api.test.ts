import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { seedPortalFixture, type PortalFixture } from "../support/factories";
import { createTestDatabase, type TestDatabase } from "../support/test-database";
import {
  ADMIN_SESSION_COOKIE,
  readAdminSession,
} from "../../lib/saas-admin-auth";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let fixture: PortalFixture;

async function login(email: string, password = fixture.password) {
  return request(app).post("/api/v1/login").send({ login: email, password });
}

const nt5CronAuth = { Authorization: "Bearer fixture-cron-secret" };
const nt5RoleIds = ["role-exam-only", "role-manager-only", "role-office-negative"];
const nt5UserIds = ["user-exam-only", "user-manager-only", "user-office-negative", "user-evaluator"];

async function resetNt5Fixture() {
  await prisma.notice.deleteMany({ where: { eventKey: { startsWith: "NT-5:exam-nt5-" } } });
  await prisma.exam.deleteMany({ where: { id: { startsWith: "exam-nt5-" } } });
  await prisma.user.update({
    where: { id: fixture.users.teacher.id },
    data: { managerId: fixture.users.office.id, pushToken: null },
  });
  await prisma.user.update({ where: { id: fixture.users.office.id }, data: { pushToken: null } });
  await prisma.user.deleteMany({
    where: { OR: [{ id: { in: nt5UserIds } }, { id: { startsWith: "user-exam-chunk-" } }] },
  });
  await prisma.role.deleteMany({ where: { id: { in: nt5RoleIds } } });
}

async function setupNt5Actors() {
  await resetNt5Fixture();
  const officePassword = await prisma.user.findUniqueOrThrow({
    where: { id: fixture.users.office.id },
    select: { password: true },
  });
  await prisma.role.create({
    data: {
      id: "role-exam-only",
      name: "Exam only",
      slug: "EXAM_ONLY",
      portal: "OFFICE",
      grants: { create: [{ permission: "exams.view", scope: "SCHOOL" }] },
    },
  });
  await prisma.role.createMany({
    data: [
      { id: "role-manager-only", name: "Manager only", slug: "MANAGER_ONLY", portal: "OFFICE" },
      { id: "role-office-negative", name: "Notice viewer", slug: "NOTICE_VIEWER", portal: "OFFICE" },
    ],
  });
  await prisma.roleGrant.createMany({
    data: [
      { roleId: "role-manager-only", permission: "desk.view", scope: "SCHOOL" },
      { roleId: "role-office-negative", permission: "notices.view", scope: "SCHOOL" },
    ],
  });
  await prisma.user.createMany({
    data: [
      {
        id: "user-exam-only",
        email: "exam.only@school.test",
        password: officePassword.password,
        name: "Exam Only User",
        roleId: "role-exam-only",
        pushToken: "ExponentPushToken[exam-only]",
      },
      {
        id: "user-manager-only",
        email: "manager.only@school.test",
        password: officePassword.password,
        name: "Manager Only User",
        roleId: "role-manager-only",
        pushToken: "ExponentPushToken[manager]",
      },
      {
        id: "user-office-negative",
        email: "notice.viewer@school.test",
        password: officePassword.password,
        name: "Notice Viewer",
        roleId: "role-office-negative",
        pushToken: "ExponentPushToken[non-recipient]",
      },
    ],
  });
  await prisma.user.create({
    data: {
      id: "user-evaluator",
      email: "evaluator@school.test",
      password: officePassword.password,
      name: "Evaluator Teacher",
      roleId: "role-teacher",
      pushToken: "ExponentPushToken[evaluator]",
      teacher: { create: { id: "teacher-evaluator", employeeId: "T-FIX-EVALUATOR" } },
    },
  });
  await prisma.user.update({
    where: { id: fixture.users.teacher.id },
    data: { managerId: "user-manager-only", pushToken: "ExponentPushToken[teacher]" },
  });
  await prisma.user.update({
    where: { id: fixture.users.office.id },
    data: { pushToken: "ExponentPushToken[office]" },
  });
  return {
    password: officePassword.password,
    recipientIds: ["user-exam-only", "user-manager-only", fixture.users.office.id, fixture.users.teacher.id].sort(),
    recipientTokens: [
      "ExponentPushToken[exam-only]",
      "ExponentPushToken[manager]",
      "ExponentPushToken[office]",
      "ExponentPushToken[teacher]",
    ].sort(),
  };
}

async function createNt5Exam(input: {
  id: string;
  dueOn?: Date | null;
  paperAt?: Date | null;
  setterId?: string | null;
  teacherId?: string | null;
}) {
  return prisma.exam.create({
    data: {
      id: input.id,
      title: input.id,
      subjectId: "subject-mathematics",
      classId: fixture.classId,
      date: new Date("2026-09-15T00:00:00.000Z"),
      paperDueOn: input.dueOn ?? null,
      paperAt: input.paperAt ?? null,
      setterId: input.setterId ?? null,
      teacherId: input.teacherId ?? null,
      maxMarks: 80,
    },
  });
}

describe("Express portal API", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "integration-test-secret-with-enough-entropy";
    process.env.CRON_SECRET = "fixture-cron-secret";
    database = createTestDatabase();

    // DATABASE_URL must be set before either module is loaded because lib/prisma
    // intentionally caches a single client for the application process. Clear
    // this isolated test file's module registry before the dynamic imports.
    vi.resetModules();
    const prismaModule = await import("../../lib/prisma");
    prisma = prismaModule.prisma;
    fixture = await seedPortalFixture(prisma);
    app = (await import("../../server/index")).default;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env.CRON_SECRET = "fixture-cron-secret";
    await prisma.payment.deleteMany({ where: { reference: { startsWith: "pay_KAN45" } } });
    await prisma.feeInvoice.deleteMany({ where: { id: "invoice-anaya-may-k45" } });
  });

  it("uses an isolated SQLite file outside prisma/dev.db", () => {
    expect(database.databasePath).toMatch(/anekio-vitest-/);
    expect(database.databasePath).not.toContain("/prisma/dev.db");
    expect(process.env.DATABASE_URL).toBe(database.databaseUrl);
  });

  it("reports API health without authentication", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("validates, reserves, and saves school website slugs", async () => {
    const original = await prisma.schoolConfig.findUniqueOrThrow({ where: { id: "school" } });
    const { id: _id, ...originalData } = original;
    const originalPublicUrl = process.env.PUBLIC_URL;
    const session = await login(fixture.users.office.email);
    const auth = { Authorization: `Bearer ${session.body.token}` };

    try {
      process.env.PUBLIC_URL = "https://staging.anekio.com";
      const reserved = await request(app)
        .post("/api/v1/act")
        .set(auth)
        .send({ op: "saveSchoolIdentity", websiteSlug: "admin" });
      expect(reserved.status).toBe(400);
      expect(reserved.body.error).toContain("reserved by Anekio");

      await prisma.schoolConfig.create({
        data: { id: "other-school", name: "Other School", websiteSlug: "taken-school" },
      });
      const taken = await request(app)
        .post("/api/v1/act")
        .set(auth)
        .send({ op: "saveSchoolIdentity", websiteSlug: "taken-school" });
      expect(taken.status).toBe(400);
      expect(taken.body).toEqual({ error: "That website slug is already used by another school." });

      const saved = await request(app)
        .post("/api/v1/act")
        .set(auth)
        .send({ op: "saveSchoolIdentity", websiteSlug: "Green Valley Academy" });
      expect(saved.status).toBe(200);
      expect((await prisma.schoolConfig.findUniqueOrThrow({ where: { id: "school" } })).websiteSlug).toBe("green-valley-academy");

      const record = await request(app)
        .get("/api/v1/record")
        .set(auth)
        .set("X-Forwarded-Host", "app.staging.anekio.com");
      expect(record.body.school.website).toMatchObject({
        slug: "green-valley-academy",
        domain: "staging.anekio.com",
      });
    } finally {
      if (originalPublicUrl === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = originalPublicUrl;
      await prisma.schoolConfig.deleteMany({ where: { id: "other-school" } });
      await prisma.schoolConfig.update({ where: { id: "school" }, data: originalData });
    }
  });

  it("releases changed school website slugs and resolves the current owner by slug", async () => {
    const original = await prisma.schoolConfig.findUniqueOrThrow({ where: { id: "school" } });
    const { id: _id, ...originalData } = original;
    const session = await login(fixture.users.office.email);
    const auth = { Authorization: `Bearer ${session.body.token}` };

    try {
      await prisma.schoolConfig.update({
        where: { id: "school" },
        data: {
          name: "Original Campus",
          websiteEnabled: true,
          websiteSlug: "old-campus",
          websiteHeroTitle: "Original Campus admissions",
        },
      });

      const oldBeforeChange = await request(app).get("/").set("Host", "old-campus.anekio.com");
      expect(oldBeforeChange.status).toBe(200);
      expect(oldBeforeChange.text).toContain("Original Campus admissions");

      const changed = await request(app)
        .post("/api/v1/act")
        .set(auth)
        .send({
          op: "saveSchoolWebsite",
          websiteEnabled: true,
          websiteSlug: "new-campus",
          websiteHeroTitle: "New Campus admissions",
        });
      expect(changed.status).toBe(200);

      const oldAfterChange = await request(app).get("/").set("Host", "old-campus.anekio.com");
      expect(oldAfterChange.status).toBe(404);
      expect(oldAfterChange.body).toEqual({ error: "School website not found" });

      const newAfterChange = await request(app).get("/").set("Host", "new-campus.anekio.com");
      expect(newAfterChange.status).toBe(200);
      expect(newAfterChange.text).toContain("New Campus admissions");

      await prisma.schoolConfig.create({
        data: {
          id: "other-school",
          name: "Other Campus",
          websiteEnabled: true,
          websiteSlug: "old-campus",
          websiteHeroTitle: "Other Campus admissions",
        },
      });

      const oldReused = await request(app).get("/").set("Host", "old-campus.anekio.com");
      expect(oldReused.status).toBe(200);
      expect(oldReused.text).toContain("Other Campus admissions");
    } finally {
      await prisma.schoolConfig.deleteMany({ where: { id: "other-school" } });
      await prisma.schoolConfig.update({ where: { id: "school" }, data: originalData });
    }
  });

  it("protects the SaaS admin and completes the organisation, invoice, and payment workflow", async () => {
    const anonymous = await request(app).get("/anekio-admin");
    expect(anonymous.status).toBe(200);
    expect(anonymous.text).toContain("Sign in to Anekio Admin");
    expect(anonymous.text).toContain("Sign in locally");
    expect(anonymous.text).not.toContain("Manage customer ownership");

    const localLogin = await request(app)
      .post("/anekio-admin/login")
      .type("form")
      .send({ email: "buildtogether.tech@gmail.com", password: "12345" });
    expect(localLogin.status).toBe(303);
    const cookie = String(localLogin.headers["set-cookie"]?.[0] || "").split(";")[0];
    expect(cookie).toContain(`${ADMIN_SESSION_COOKIE}=`);
    const session = readAdminSession(cookie);
    expect(session).not.toBeNull();

    const home = await request(app).get("/anekio-admin").set("Cookie", cookie);
    expect(home.status).toBe(200);
    expect(home.text).toContain("Sales pipeline");
    expect(home.text).toContain("Leads");
    expect(home.text).toContain("Subscriptions");

    const createOrg = await request(app)
      .post("/anekio-admin/orgs")
      .set("Cookie", cookie)
      .type("form")
      .send({
        csrf: session!.csrf,
        schoolName: "Anekio Test School",
        ownerName: "Test Owner",
        ownerEmail: "owner@school.example",
        ownerPhone: "+91 98765 43210",
        subscriptionStatus: "LEAD",
        plan: "Annual school",
        monthlyPrice: "14999",
      });
    expect(createOrg.status).toBe(303);

    const org = await prisma.saasOrg.findFirstOrThrow({ where: { schoolName: "Anekio Test School" } });
    const detail = await request(app)
      .get(`/anekio-admin?view=org&id=${org.id}`)
      .set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain("Anekio Test School");
    expect(detail.text).toContain("Create invoice");

    const createInvoice = await request(app)
      .post(`/anekio-admin/orgs/${org.id}/invoices`)
      .set("Cookie", cookie)
      .type("form")
      .send({
        csrf: session!.csrf,
        issueDate: "2026-08-30",
        dueDate: "2026-09-06",
        description: "Anekio subscription",
        quantity: "1",
        unitPrice: "10000",
        taxPercent: "18",
      });
    expect(createInvoice.status).toBe(303);

    const invoice = await prisma.saasInvoice.findFirstOrThrow({ where: { orgId: org.id } });
    expect(invoice.total).toBe(11800);
    const issue = await request(app)
      .post(`/anekio-admin/invoices/${invoice.id}/issue`)
      .set("Cookie", cookie)
      .type("form")
      .send({ csrf: session!.csrf });
    expect(issue.status).toBe(303);

    const payment = await request(app)
      .post(`/anekio-admin/invoices/${invoice.id}/payments`)
      .set("Cookie", cookie)
      .type("form")
      .send({
        csrf: session!.csrf,
        amount: "11800",
        paidAt: "2026-08-30",
        method: "UPI",
        reference: "UTR-ADMIN-TEST-1",
      });
    expect(payment.status).toBe(303);

    const paid = await prisma.saasInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(paid).toMatchObject({ status: "PAID", paidAmount: 11800 });
    const customer = await prisma.saasOrg.findUniqueOrThrow({ where: { id: org.id } });
    expect(customer).toMatchObject({ lifecycle: "CUSTOMER", pipelineStage: "WON", subscriptionStatus: "ACTIVE" });
    expect(await prisma.saasSubscription.count({ where: { orgId: org.id, status: "ACTIVE" } })).toBe(1);
    expect(await prisma.saasAuditEvent.count({ where: { orgId: org.id } })).toBeGreaterThanOrEqual(4);
  });

  it("rejects incomplete and invalid credentials with explicit errors", async () => {
    const incomplete = await request(app).post("/api/v1/login").send({ login: "" });
    const invalid = await login(fixture.users.office.email, "wrong-password");

    expect(incomplete.status).toBe(400);
    expect(incomplete.body).toEqual({ error: "Email or number, and password." });
    expect(invalid.status).toBe(401);
    expect(invalid.body).toEqual({ error: "Those credentials are not in this school." });
  });

  it.each(["office", "teacher", "parent", "student"] as const)(
    "logs in the %s portal with its role-scoped navigation",
    async (kind) => {
      const expected = fixture.users[kind];
      const response = await login(expected.email);

      expect(response.status).toBe(200);
      expect(response.body.token).toEqual(expect.any(String));
      expect(response.body.user).toMatchObject({
        id: expected.id,
        name: expected.name,
        portal: expected.portal,
      });
      expect(response.body.user.permissions).toContain(expected.expectedPermission);
      expect(response.body.nav.length).toBeGreaterThan(0);
      expect(response.body.nav.every((item: { permission: string | null }) =>
        item.permission === null || response.body.user.permissions.includes(item.permission)
      )).toBe(true);
    }
  );

  it("accepts a normalized Indian mobile number for parent login", async () => {
    const response = await login("+91 98765 40003");

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: fixture.users.parent.id, portal: "PARENT" });
  });

  it("restores the authenticated user through /me and rejects a bad bearer token", async () => {
    const session = await login(fixture.users.teacher.email);
    const restored = await request(app)
      .get("/api/v1/me")
      .set("Authorization", `Bearer ${session.body.token}`);
    const rejected = await request(app)
      .get("/api/v1/me")
      .set("Authorization", "Bearer not-a-valid-token");

    expect(restored.status).toBe(200);
    expect(restored.body.user).toMatchObject({ id: fixture.users.teacher.id, portal: "TEACHER" });
    expect(restored.body.nav.map((item: { key: string }) => item.key)).toContain("attendance");
    expect(rejected.status).toBe(401);
    expect(rejected.body).toEqual({ error: "Sign in again." });
  });

  it.each([
    ["office", "OFFICE"],
    ["teacher", "TEACHER"],
    ["parent", "PARENT"],
    ["student", "STUDENT"],
  ] as const)("returns the %s portal record projection", async (kind, recordKind) => {
    const session = await login(fixture.users[kind].email);
    const response = await request(app)
      .get("/api/v1/record")
      .set("Authorization", `Bearer ${session.body.token}`);

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe(recordKind);

    if (kind === "office") {
      expect(response.body.school.name).toBe("Fixture Academy");
      expect(response.body.people).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: fixture.studentId, admissionNo: "ADM-FIX-1" })])
      );
      expect(response.body.roles).toEqual(
        expect.arrayContaining([expect.objectContaining({ slug: "ADMIN", isSystem: true })])
      );
    } else if (kind === "teacher") {
      expect(response.body).toMatchObject({ classId: fixture.classId, classLabel: "6-A", studentCount: 1 });
      expect(response.body.roster).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: fixture.studentId, name: "Anaya Student" })])
      );
      expect(response.body.notices).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: "Fixture circular" })])
      );
    } else {
      expect(response.body.children).toEqual([
        expect.objectContaining({ id: fixture.studentId, name: "Anaya Student", classLabel: "6-A" }),
      ]);
      expect(response.body.child).toMatchObject({
        id: fixture.studentId,
        name: "Anaya Student",
        admissionNo: "ADM-FIX-1",
        classLabel: "6-A",
      });
      expect(response.body.child.fees).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "invoice-anaya-april", period: "2026-04" })])
      );
    }
  });

  it("lets a parent open a published marksheet PDF and hides unpublished papers", async () => {
    await prisma.examSeries.create({
      data: {
        id: "series-unit-1",
        classId: fixture.classId,
        sessionId: "session-2026",
        name: "Unit test 1",
        exams: {
          create: [
            {
              id: "exam-math-published",
              title: "Unit test 1 Mathematics",
              subjectId: "subject-mathematics",
              classId: fixture.classId,
              teacherId: "teacher-tara",
              date: new Date("2026-07-10T00:00:00.000Z"),
              maxMarks: 40,
              workflowStatus: "PUBLISHED",
              resultsPublishedAt: new Date("2026-07-12T00:00:00.000Z"),
              results: { create: { studentId: fixture.studentId, marks: 32, remarks: "Good work" } },
            },
            {
              id: "exam-math-draft",
              title: "Unit test 1 draft paper",
              subjectId: "subject-mathematics",
              classId: fixture.classId,
              teacherId: "teacher-tara",
              date: new Date("2026-07-11T00:00:00.000Z"),
              maxMarks: 40,
              workflowStatus: "MARKS_DRAFT",
              results: { create: { studentId: fixture.studentId, marks: 10, remarks: "Hidden" } },
            },
          ],
        },
      },
    });

    const parentSession = await login(fixture.users.parent.email);
    const parentAuth = { Authorization: `Bearer ${parentSession.body.token}` };
    const record = await request(app).get("/api/v1/record").set(parentAuth);
    expect(record.status).toBe(200);
    expect(record.body.reports).toEqual([]);
    expect(record.body.child.tests).toEqual([
      expect.objectContaining({
        examId: "exam-math-published",
        subject: "Mathematics",
        marks: 32,
      }),
    ]);

    const sheet = await request(app)
      .get("/api/v1/marksheet")
      .query({ seriesId: "series-unit-1", studentId: fixture.studentId })
      .set(parentAuth);
    expect(sheet.status).toBe(400);

    const paper = await request(app)
      .get("/api/v1/marksheet")
      .query({ examId: "exam-math-published" })
      .set(parentAuth);
    expect(paper.status).toBe(200);
    expect(paper.text).toContain("Unit test 1 Mathematics");

    const draft = await request(app)
      .get("/api/v1/marksheet")
      .query({ examId: "exam-math-draft" })
      .set(parentAuth);
    expect(draft.status).toBe(400);

    const teacherSession = await login(fixture.users.teacher.email);
    const teacherSheet = await request(app)
      .get("/api/v1/marksheet")
      .query({ seriesId: "series-unit-1", studentId: fixture.studentId })
      .set("Authorization", `Bearer ${teacherSession.body.token}`);
    expect(teacherSheet.status).toBe(400);

    await prisma.exam.deleteMany({ where: { seriesId: "series-unit-1" } });
    await prisma.examSeries.delete({ where: { id: "series-unit-1" } });
  });

  it("shows one consolidated receipt for selected paid fee invoices", async () => {
    await prisma.feeInvoice.create({
      data: {
        id: "invoice-anaya-may-k45",
        studentId: fixture.studentId,
        classId: fixture.classId,
        period: "2026-05",
        title: "May fees",
        amount: 250000,
        dueDate: new Date("2027-05-10T00:00:00.000Z"),
        shareToken: "invoice-anaya-may-k45",
      },
    });
    await prisma.payment.createMany({
      data: [
        {
          invoiceId: "invoice-anaya-april",
          amount: 250000,
          method: "RAZORPAY",
          reference: "pay_KAN45:ya-april",
          notes: "order order_KAN45",
        },
        {
          invoiceId: "invoice-anaya-may-k45",
          amount: 250000,
          method: "RAZORPAY",
          reference: "pay_KAN45:may-k45",
          notes: "order order_KAN45",
        },
      ],
    });

    const response = await request(app).get("/pay/s/pay-anaya-fixture?m=2026-04,2026-05&paid=1");

    expect(response.status).toBe(200);
    expect(response.text).toContain("Receipt");
    expect(response.text).toContain("pay_KAN45");
    expect(response.text).toContain("April fees");
    expect(response.text).toContain("May fees");
    expect(response.text).toContain("Selected invoices are paid.");
  });

  it("keeps teacher leave waiting until office approval", async () => {
    const teacherSession = await login(fixture.users.teacher.email);
    const teacherAuth = { Authorization: `Bearer ${teacherSession.body.token}` };
    const applied = await request(app)
      .post("/api/v1/act")
      .set(teacherAuth)
      .send({
        op: "applyLeave",
        typeId: "leave-sick",
        from: "2026-09-01",
        to: "2026-09-01",
        reason: "Medical appointment",
      });

    expect(applied.status).toBe(200);
    const requestRow = await prisma.leaveRequest.findFirstOrThrow({
      where: { teacherId: "teacher-tara", from: "2026-09-01" },
    });
    expect(requestRow.status).toBe("WAITING");
    expect(await prisma.staffDay.findFirst({ where: { teacherId: "teacher-tara" } })).toBeNull();
    expect(
      await prisma.notice.findFirst({
        where: { authorId: fixture.users.teacher.id, title: { startsWith: "Leave request" } },
      })
    ).toMatchObject({ kind: "LEAVE" });

    const officeSession = await login(fixture.users.office.email);
    const officeAuth = { Authorization: `Bearer ${officeSession.body.token}` };
    const officeRecord = await request(app).get("/api/v1/record").set(officeAuth);
    expect(officeRecord.body.pendingLeave).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: requestRow.id, status: "WAITING" })])
    );

    const approved = await request(app)
      .post("/api/v1/act")
      .set(officeAuth)
      .send({ op: "decideLeave", requestId: requestRow.id, yes: true });

    expect(approved.status).toBe(200);
    expect(await prisma.leaveRequest.findUnique({ where: { id: requestRow.id } })).toMatchObject({ status: "ACTIVE" });
    expect(await prisma.staffDay.findFirst({ where: { teacherId: "teacher-tara" } })).toMatchObject({ status: "LEAVE" });
  });

  it("requires authentication before exposing portal records", async () => {
    const response = await request(app).get("/api/v1/record");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Sign in again." });
  });

  it("lets office read the fee register from existing invoices", async () => {
    const denied = await request(app).get("/api/v1/fee-register");
    expect(denied.status).toBe(401);
    const officeSession = await login(fixture.users.office.email);
    const officeAuth = { Authorization: `Bearer ${officeSession.body.token}` };
    const register = await request(app).get("/api/v1/fee-register").set(officeAuth);
    expect(register.status).toBe(200);
    expect(register.body.rows.length).toBeGreaterThan(0);
    expect(register.body.rows[0]).toEqual(
      expect.objectContaining({
        studentId: fixture.studentId,
        admissionNo: "ADM-FIX-1",
        total: 250000,
      })
    );
    const parentSession = await login(fixture.users.parent.email);
    const parent = await request(app)
      .get("/api/v1/fee-register")
      .set({ Authorization: `Bearer ${parentSession.body.token}` });
    expect(parent.status).toBe(403);

    const historyDenied = await request(app).get("/api/v1/fee-history");
    expect(historyDenied.status).toBe(401);
    const history = await request(app)
      .get("/api/v1/fee-history")
      .query({ datePreset: "custom", from: "2000-01-01", to: "2099-12-31", pageSize: 25 })
      .set(officeAuth);
    expect(history.status).toBe(200);
    expect(history.body.events.length).toBeGreaterThan(0);
    expect(history.body.events[0]).toEqual(
      expect.objectContaining({
        studentId: fixture.studentId,
      })
    );
    const parentHistory = await request(app)
      .get("/api/v1/fee-history")
      .set({ Authorization: `Bearer ${parentSession.body.token}` });
    expect(parentHistory.status).toBe(403);
  });

  it("saves late timing and staff In time so a later record load still has them", async () => {
    const officeSession = await login(fixture.users.office.email);
    const officeAuth = { Authorization: `Bearer ${officeSession.body.token}` };

    const late = await request(app).post("/api/v1/act").set(officeAuth).send({
      op: "saveSchoolPayrollRules",
      startTime: "09:00",
      endTime: "14:00",
      graceMinutes: 5,
      freeLateCount: 0,
      lateDeductionMode: "NONE",
      lateDeductionAmount: 0,
      lateDayFraction: 0,
    });
    expect(late.status).toBe(200);
    expect(late.body.rules).toMatchObject({ startTime: "09:00", graceMinutes: 5 });
    const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
    expect(JSON.parse(config?.payrollJson || "{}")).toMatchObject({ startTime: "09:00", graceMinutes: 5 });

    const marked = await request(app).post("/api/v1/act").set(officeAuth).send({
      op: "markStaffAttendance",
      date: "2026-09-09",
      rows: [{ kind: "teacher", id: "teacher-tara", status: "PRESENT", inAt: "09:20", outAt: "", clear: false }],
    });
    expect(marked.status).toBe(200);
    expect(marked.body.days?.[0]).toMatchObject({ inAt: "09:20" });
    expect(await prisma.staffDay.findFirst({ where: { teacherId: "teacher-tara", inAt: "09:20" } })).toBeTruthy();

    const record = await request(app).get("/api/v1/record").set(officeAuth);
    expect(record.status).toBe(200);
    expect(record.body.payrollRules).toMatchObject({ startTime: "09:00", graceMinutes: 5 });
    const teacher = (record.body.staff as { id: string; days?: { date: string; inAt?: string }[] }[]).find(
      (row) => row.id === "teacher-tara"
    );
    expect(teacher?.days?.some((day) => day.date === "2026-09-09" && day.inAt === "09:20")).toBe(true);
  });

  it("notifies a staff member when they are mentioned in an inbox internal note", async () => {
    const parentSession = await login(fixture.users.parent.email);
    const parentAuth = { Authorization: `Bearer ${parentSession.body.token}` };
    const submitted = await request(app)
      .post("/api/v1/act")
      .set(parentAuth)
      .send({
        op: "submitParentQuery",
        studentId: fixture.studentId,
        target: "office",
        subject: "Transport issue",
        message: "Please check the bus route.",
      });
    expect(submitted.status).toBe(200);

    const query = await prisma.notice.findFirstOrThrow({
      where: { authorId: fixture.users.parent.id, title: "Parent query: Transport issue" },
      orderBy: { createdAt: "desc" },
    });
    const officeSession = await login(fixture.users.office.email);
    const mentioned = await request(app)
      .post("/api/v1/act")
      .set({ Authorization: `Bearer ${officeSession.body.token}` })
      .send({
        op: "replyParentQuery",
        noticeId: query.id,
        internalNote: "@Tara Teacher please check this.",
      });
    expect(mentioned.status).toBe(200);

    const mentionNotice = await prisma.notice.findFirstOrThrow({
      where: {
        title: "Mentioned in Transport issue",
        recipients: { some: { userId: fixture.users.teacher.id } },
      },
      include: { recipients: true },
    });
    expect(mentionNotice.body).toContain("@Tara Teacher please check this.");

    const teacherSession = await login(fixture.users.teacher.email);
    const teacherRecord = await request(app)
      .get("/api/v1/record")
      .set({ Authorization: `Bearer ${teacherSession.body.token}` });
    expect(teacherRecord.status).toBe(200);
    expect(teacherRecord.body.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: mentionNotice.id,
          title: "Mentioned in Transport issue",
        }),
      ])
    );
  });

  it("keeps grouped update history and communication actions in the admission lead timeline", async () => {
    const lead = await prisma.admissionLead.create({
      data: {
        studentName: "Old Student Name",
        guardianName: "Fixture Guardian",
        phone: "9876540010",
        email: "",
        classWanted: "5",
      },
    });
    const session = await login(fixture.users.office.email);
    const auth = { Authorization: `Bearer ${session.body.token}` };

    const edited = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({
        op: "updateAdmissionLead",
        id: lead.id,
        studentName: "New Student Name",
        email: "guardian@example.test",
        status: "FOLLOW_UP",
        followUpAt: "2026-09-05 10:30",
        remark: "Parent asked for fee details.",
      });
    expect(edited.status).toBe(200);

    const call = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({
        op: "updateAdmissionLead",
        id: lead.id,
        eventKind: "CALL",
        eventTitle: "Call button clicked",
        eventBody: "Calling 9876540010",
      });
    expect(call.status).toBe(200);

    const events = await prisma.admissionLeadEvent.findMany({ where: { leadId: lead.id } });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "UPDATE",
          title: "Updated Student name, Email, Lead stage, Follow-up",
          body: [
            "Student name\nOld Student Name -> New Student Name",
            "Email\n- -> guardian@example.test",
            "Lead stage\nNew -> Follow Up",
            "Follow-up\n- -> 2026-09-05 10:30",
            "Remark\nParent asked for fee details.",
          ].join("\n\n"),
          actorName: "Ojas Office",
        }),
        expect.objectContaining({ kind: "CALL", title: "Call button clicked", body: "Calling 9876540010" }),
      ])
    );
  });

  it("saves one admission form and uses it for permission-scoped walk-in leads", async () => {
    const officeSession = await login(fixture.users.office.email);
    const officeAuth = { Authorization: `Bearer ${officeSession.body.token}` };
    const fields = [
      { id: "studentName", label: "Child name", type: "text", required: true, visible: true, builtin: true },
      { id: "classWanted", label: "Class", type: "text", required: true, visible: true, builtin: true },
      { id: "guardianName", label: "Guardian", type: "text", required: true, visible: true, builtin: true },
      { id: "phone", label: "Mobile", type: "phone", required: true, visible: true, builtin: true },
      { id: "email", label: "Email", type: "email", required: false, visible: false, builtin: true },
      { id: "message", label: "Notes", type: "textarea", required: false, visible: true, builtin: true },
      { id: "custom_transport", label: "Transport needed", type: "select", required: true, visible: true, options: ["Yes", "No"], builtin: false },
    ];

    const saved = await request(app).post("/api/v1/act").set(officeAuth).send({ op: "saveAdmissionForm", fields });
    expect(saved.status).toBe(200);

    const created = await request(app).post("/api/v1/act").set(officeAuth).send({
      op: "createAdmissionLead",
      studentName: "Walk In Child",
      classWanted: "Nursery",
      guardianName: "Walk In Guardian",
      phone: "9876540099",
      message: "Visited the front office",
      custom_transport: "Yes",
    });
    expect(created.status).toBe(200);
    const lead = await prisma.admissionLead.findUniqueOrThrow({ where: { id: created.body.leadId } });
    expect(lead).toMatchObject({ studentName: "Walk In Child", source: "walk_in" });
    expect(JSON.parse(lead.customFieldsJson)).toEqual({ custom_transport: "Yes" });

    const teacherSession = await login(fixture.users.teacher.email);
    const forbidden = await request(app)
      .post("/api/v1/act")
      .set("Authorization", `Bearer ${teacherSession.body.token}`)
      .send({ op: "createAdmissionLead", studentName: "Blocked" });
    expect(forbidden.status).toBe(400);
    expect(forbidden.body).toEqual({ error: "No access." });
  });

  it("saves, publishes, issues, verifies, and revokes an official document", async () => {
    const session = await login(fixture.users.office.email);
    const auth = { Authorization: `Bearer ${session.body.token}` };
    const saved = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({
        op: "saveDocumentTemplate",
        type: "BONAFIDE",
        name: "Fixture bonafide",
        pageSize: "A4",
        orientation: "PORTRAIT",
        layout: {
          elements: [
            { id: "title", type: "TEXT", x: 10, y: 10, width: 80, height: 8, value: "Bonafide certificate" },
            { id: "student", type: "FIELD", x: 10, y: 25, width: 80, height: 8, field: "student.name" },
            { id: "verify", type: "VERIFY_QR", x: 75, y: 75, width: 16, height: 16 },
            { id: "barcode", type: "BARCODE", x: 10, y: 78, width: 40, height: 10, field: "document.number" },
          ],
        },
      });
    expect(saved.status).toBe(200);
    const templateId = saved.body.template.id as string;

    const preview = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({
        op: "previewDocumentTemplate",
        pageSize: "CR80",
        orientation: "LANDSCAPE",
        layout: { elements: [{ id: "student", type: "FIELD", x: 10, y: 25, width: 80, height: 8, field: "student.name" }] },
        data: { school: { name: "Fixture Academy" }, student: { name: "Preview Student" } },
      });
    expect(preview.status).toBe(200);
    expect(preview.body.html).toContain("Preview Student");
    expect(preview.body.html).toContain("width:85.6mm");

    const published = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({ op: "publishDocumentTemplate", id: templateId });
    expect(published.status).toBe(200);
    expect(published.body.version).toBe(1);

    const issued = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({
        op: "issueDocument",
        templateId,
        subjectType: "STUDENT",
        subjectId: fixture.studentId,
        subjectLabel: "Anaya Student",
        data: { school: { name: "Fixture Academy" }, student: { name: "Anaya Student" } },
      });
    expect(issued.status).toBe(200);
    expect(issued.body.documentNumber).toMatch(/^B-\d{4}-\d{6}$/);

    const row = await prisma.issuedDocument.findUnique({ where: { id: issued.body.id } });
    expect(row?.renderedHtml).toContain("data:image/png;base64,");
    expect(row?.fileHash).toMatch(/^[0-9a-f]{64}$/);

    const verified = await request(app).get(`/verify/${row?.verifyToken}`);
    expect(verified.status).toBe(200);
    expect(verified.text).toContain("VALID");
    expect(verified.text).not.toContain("Anaya Student");

    const batch = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({
        op: "issueDocumentBatch",
        templateId,
        subjects: [
          { subjectType: "STUDENT", subjectId: "student-batch-1", subjectLabel: "First Student", data: { school: { name: "Fixture Academy" }, student: { name: "First Student" } } },
          { subjectType: "STUDENT", subjectId: "student-batch-2", subjectLabel: "Second Student", data: { school: { name: "Fixture Academy" }, student: { name: "Second Student" } } },
        ],
      });
    expect(batch.status).toBe(200);
    expect(batch.body.issued).toHaveLength(2);
    expect(batch.body.blocked).toEqual([]);
    const combined = await request(app).get(`/document-batches/${batch.body.batchId}`);
    expect(combined.status).toBe(200);
    expect(combined.text.match(/class="page"/g)).toHaveLength(2);
    const replacement = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({ op: "reissueDocument", id: batch.body.issued[0].id, reason: "Corrected in test" });
    expect(replacement.status).toBe(200);
    expect(await prisma.issuedDocument.findUnique({ where: { id: batch.body.issued[0].id } })).toMatchObject({ status: "SUPERSEDED" });

    const revoked = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({ op: "changeIssuedDocumentStatus", id: issued.body.id, status: "REVOKED", reason: "Replaced in test" });
    expect(revoked.status).toBe(200);
    const rechecked = await request(app).get(`/verify/${row?.verifyToken}`);
    expect(rechecked.text).toContain("REVOKED");
    expect(await prisma.documentEvent.count({ where: { issuedDocumentId: issued.body.id } })).toBe(2);
  });

  it("persists valid scopes, rejects invalid scopes, and enforces report boundaries", async () => {
    const session = await login(fixture.users.office.email);
    const auth = { Authorization: `Bearer ${session.body.token}` };
    const initial = await request(app).get("/api/v1/record").set(auth);
    const admin = initial.body.roles.find((role: { slug: string }) => role.slug === "ADMIN");
    const leaveCatalog = initial.body.permissionCatalog.find(
      (permission: { key: string }) => permission.key === "leave.decide"
    );

    expect(admin.grantScopes["leave.decide"]).toBe("SCHOOL");
    expect(leaveCatalog.scopes).toEqual(["REPORTS", "SCHOOL"]);
    expect(
      await prisma.roleGrant.count({ where: { scope: null } })
    ).toBe(0);
    expect(
      await prisma.roleGrant.findUnique({
        where: { roleId_permission: { roleId: "role-teacher", permission: "leave.decide" } },
      })
    ).toMatchObject({ scope: "REPORTS" });
    expect(
      await prisma.roleGrant.findUnique({
        where: { roleId_permission: { roleId: "role-legacy-office", permission: "leave.decide" } },
      })
    ).toMatchObject({ scope: "SCHOOL" });
    expect(
      await prisma.roleGrant.findUnique({
        where: { roleId_permission: { roleId: "role-legacy-teacher", permission: "leave.decide" } },
      })
    ).toMatchObject({ scope: "REPORTS" });

    const invalid = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({
        op: "setRolePermissions",
        roleId: admin.id,
        changes: [{ permission: "leave.decide", on: true, scope: "SELF" }],
      });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toContain("scope is not available");

    const beforeAtomic = await prisma.roleGrant.findUnique({
      where: { roleId_permission: { roleId: admin.id, permission: "leave.decide" } },
    });
    const mixedInvalid = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({
        op: "setRolePermissions",
        roleId: admin.id,
        changes: [
          { permission: "leave.decide", on: true, scope: "REPORTS" },
          { permission: "attendance.mark", on: true, scope: "SELF" },
        ],
      });
    expect(mixedInvalid.status).toBe(400);
    expect(
      await prisma.roleGrant.findUnique({
        where: { roleId_permission: { roleId: admin.id, permission: "leave.decide" } },
      })
    ).toMatchObject({ scope: beforeAtomic?.scope });

    const changed = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({
        op: "setRolePermissions",
        roleId: admin.id,
        changes: [
          { permission: "leave.decide", on: true, scope: "REPORTS" },
          { permission: "timetable.view", on: true, scope: "REPORTS" },
          { permission: "timetable.edit", on: true, scope: "REPORTS" },
        ],
      });
    expect(changed.status).toBe(200);

    await prisma.class.create({ data: { id: "class-7-b", name: "7", section: "B" } });
    await prisma.user.create({
      data: {
        id: "user-outside-report",
        email: "outside.report@school.test",
        password: "unused",
        name: "Outside Teacher",
        roleId: "role-teacher",
        teacher: { create: { id: "teacher-outside-report", employeeId: "T-FIX-2", classId: "class-7-b" } },
      },
    });
    await prisma.leaveRequest.createMany({
      data: [
        {
          id: "leave-direct-report",
          typeId: "leave-sick",
          from: "2026-08-28",
          to: "2026-08-28",
          status: "ACTIVE",
          requesterId: fixture.users.teacher.id,
          teacherId: "teacher-tara",
        },
        {
          id: "leave-outside-report",
          typeId: "leave-sick",
          from: "2026-08-28",
          to: "2026-08-28",
          status: "ACTIVE",
          requesterId: "user-outside-report",
          teacherId: "teacher-outside-report",
        },
      ],
    });

    const scopedRecord = await request(app).get("/api/v1/record").set(auth);
    expect(scopedRecord.body.pendingLeave.map((leave: { id: string }) => leave.id)).toContain("leave-direct-report");
    expect(scopedRecord.body.pendingLeave.map((leave: { id: string }) => leave.id)).not.toContain("leave-outside-report");
    expect(scopedRecord.body.timetable.classes.map((schoolClass: { id: string }) => schoolClass.id)).toContain(fixture.classId);
    expect(scopedRecord.body.timetable.classes.map((schoolClass: { id: string }) => schoolClass.id)).not.toContain("class-7-b");

    const deniedLeave = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({ op: "decideLeave", requestId: "leave-outside-report", yes: false });
    expect(deniedLeave.status).toBe(400);
    expect(deniedLeave.body).toEqual({ error: "No access." });

    const deniedTimetable = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({
        op: "saveTimetableSlot",
        classId: "class-7-b",
        periodId: "period-1",
        weekday: 1,
        clear: true,
      });
    expect(deniedTimetable.status).toBe(400);
    expect(deniedTimetable.body).toEqual({ error: "No access." });

    const copied = await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({ op: "createCustomRole", name: "Scoped copy", fromId: admin.id });
    expect(copied.status).toBe(200);
    const copiedRole = await prisma.role.findUnique({ where: { slug: "SCOPED_COPY" }, include: { grants: true } });
    expect(copiedRole?.grants.find((grant) => grant.permission === "leave.decide")?.scope).toBe("REPORTS");

    await request(app)
      .post("/api/v1/act")
      .set(auth)
      .send({
        op: "setRolePermissions",
        roleId: admin.id,
        changes: [
          { permission: "leave.decide", on: true, scope: "SCHOOL" },
          { permission: "timetable.view", on: true, scope: "SCHOOL" },
          { permission: "timetable.edit", on: true, scope: "SCHOOL" },
        ],
      });
  });

  it("keeps the NT-5 cron POST-only and fails closed without a configured secret", async () => {
    await setupNt5Actors();
    await createNt5Exam({
      id: "exam-nt5-auth",
      dueOn: new Date("2026-08-01T00:00:00.000Z"),
      setterId: "teacher-tara",
    });

    const getResponse = await request(app).get("/api/cron/exams").set(nt5CronAuth);
    const putResponse = await request(app).put("/api/cron/exams").set(nt5CronAuth);
    expect(getResponse.status).toBe(404);
    expect(putResponse.status).toBe(404);

    const configuredSecret = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      const unset = await request(app).post("/api/cron/exams");
      const bearerUndefined = await request(app)
        .post("/api/cron/exams")
        .set("Authorization", "Bearer undefined");
      process.env.CRON_SECRET = "";
      const empty = await request(app)
        .post("/api/cron/exams")
        .set("Authorization", "Bearer undefined");
      expect([unset.status, bearerUndefined.status, empty.status]).toEqual([401, 401, 401]);
    } finally {
      process.env.CRON_SECRET = configuredSecret;
    }
    expect(await prisma.notice.count({ where: { eventKey: { startsWith: "NT-5:exam-nt5-" } } })).toBe(0);
  });

  it("creates exact, idempotent NT-5 recipients and pushes only to them", async () => {
    await resetNt5Fixture();
    const unauthorized = await request(app).post("/api/cron/exams");
    const wrongSecret = await request(app)
      .post("/api/cron/exams")
      .set("Authorization", "Bearer wrong-secret");
    expect(unauthorized.status).toBe(401);
    expect(wrongSecret.status).toBe(401);
    expect(await prisma.notice.count({ where: { eventKey: { startsWith: "NT-5:" } } })).toBe(0);

    const officePassword = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.users.office.id },
      select: { password: true },
    });
    await prisma.role.create({
      data: {
        id: "role-exam-only",
        name: "Exam only",
        slug: "EXAM_ONLY",
        portal: "OFFICE",
        grants: { create: [{ permission: "exams.view", scope: "SCHOOL" }] },
      },
    });
    await prisma.user.create({
      data: {
        id: "user-exam-only",
        email: "exam.only@school.test",
        password: officePassword.password,
        name: "Exam Only User",
        roleId: "role-exam-only",
      },
    });
    await prisma.role.createMany({
      data: [
        {
          id: "role-manager-only",
          name: "Manager only",
          slug: "MANAGER_ONLY",
          portal: "OFFICE",
        },
        {
          id: "role-office-negative",
          name: "Notice viewer",
          slug: "NOTICE_VIEWER",
          portal: "OFFICE",
        },
      ],
    });
    await prisma.roleGrant.createMany({
      data: [
        { roleId: "role-manager-only", permission: "desk.view", scope: "SCHOOL" },
        { roleId: "role-office-negative", permission: "notices.view", scope: "SCHOOL" },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: "user-manager-only",
          email: "manager.only@school.test",
          password: officePassword.password,
          name: "Manager Only User",
          roleId: "role-manager-only",
          pushToken: "ExponentPushToken[manager]",
        },
        {
          id: "user-office-negative",
          email: "notice.viewer@school.test",
          password: officePassword.password,
          name: "Notice Viewer",
          roleId: "role-office-negative",
          pushToken: "ExponentPushToken[non-recipient]",
        },
      ],
    });
    await prisma.user.create({
      data: {
        id: "user-evaluator",
        email: "evaluator@school.test",
        password: officePassword.password,
        name: "Evaluator Teacher",
        roleId: "role-teacher",
        pushToken: "ExponentPushToken[evaluator]",
        teacher: { create: { id: "teacher-evaluator", employeeId: "T-FIX-EVALUATOR" } },
      },
    });
    await prisma.user.update({
      where: { id: fixture.users.teacher.id },
      data: { managerId: "user-manager-only" },
    });
    const indiaToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const todayStart = new Date(`${indiaToday}T00:00:00+05:30`);
    const baseExam = {
      subjectId: "subject-mathematics",
      classId: fixture.classId,
      date: new Date("2026-09-15T00:00:00.000Z"),
      maxMarks: 80,
    };
    await prisma.exam.createMany({
      data: [
        {
          ...baseExam,
          id: "exam-nt5-setter",
          title: "Setter deadline",
          setterId: "teacher-tara",
          teacherId: "teacher-evaluator",
          paperDueOn: new Date("2026-08-01T00:00:00.000Z"),
        },
        {
          ...baseExam,
          id: "exam-nt5-fallback",
          title: "Evaluator fallback deadline",
          teacherId: "teacher-tara",
          paperDueOn: new Date("2026-08-02T00:00:00.000Z"),
        },
        {
          ...baseExam,
          id: "exam-nt5-today",
          title: "Due today",
          setterId: "teacher-tara",
          paperDueOn: todayStart,
        },
        {
          ...baseExam,
          id: "exam-nt5-future",
          title: "Due later",
          setterId: "teacher-tara",
          paperDueOn: new Date(todayStart.getTime() + 86_400_000),
        },
        {
          ...baseExam,
          id: "exam-nt5-ready",
          title: "Already ready",
          setterId: "teacher-tara",
          paperDueOn: new Date("2026-08-03T00:00:00.000Z"),
          paperAt: new Date("2026-08-03T12:00:00.000Z"),
        },
        {
          ...baseExam,
          id: "exam-nt5-no-deadline",
          title: "No deadline",
          setterId: "teacher-tara",
        },
      ],
    });
    await prisma.user.update({ where: { id: fixture.users.office.id }, data: { pushToken: "ExponentPushToken[office]" } });
    await prisma.user.update({ where: { id: fixture.users.teacher.id }, data: { pushToken: "ExponentPushToken[teacher]" } });
    await prisma.user.update({ where: { id: "user-exam-only" }, data: { pushToken: "ExponentPushToken[exam-only]" } });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as Response);
    const cronAuth = { Authorization: "Bearer fixture-cron-secret" };

    const first = await request(app).post("/api/cron/exams").set(cronAuth);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ eligible: 2, created: 2, skipped: 0, recipients: 8 });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of fetchMock.mock.calls) {
      const messages = JSON.parse(String((call[1] as RequestInit).body)) as { to: string }[];
      expect(messages.map((message) => message.to).sort()).toEqual([
        "ExponentPushToken[exam-only]",
        "ExponentPushToken[manager]",
        "ExponentPushToken[office]",
        "ExponentPushToken[teacher]",
      ]);
    }
    const notices = await prisma.notice.findMany({
      where: { eventKey: { startsWith: "NT-5:" } },
      include: { recipients: true, audiences: true, classes: true },
      orderBy: { eventKey: "asc" },
    });
    expect(notices).toHaveLength(2);
    expect(notices.map((notice) => notice.eventKey)).toEqual([
      "NT-5:exam-nt5-fallback:2026-08-02",
      "NT-5:exam-nt5-setter:2026-08-01",
    ]);
    for (const notice of notices) {
      expect(notice.recipients.map((recipient) => recipient.userId).sort()).toEqual([
        "user-exam-only",
        "user-manager-only",
        fixture.users.office.id,
        fixture.users.teacher.id,
      ]);
      expect(notice.recipients.map((recipient) => recipient.userId)).not.toContain("user-evaluator");
      expect(notice.recipients.map((recipient) => recipient.userId)).not.toContain("user-office-negative");
      expect(notice.audiences).toEqual([]);
      expect(notice.classes).toEqual([]);
    }

    const repeated = await request(app).post("/api/cron/exams").set(cronAuth);
    expect(repeated.body).toMatchObject({ eligible: 2, created: 0, skipped: 2, recipients: 0 });
    expect(
      await prisma.noticeRecipient.count({
        where: { notice: { eventKey: { startsWith: "NT-5:" } } },
      })
    ).toBe(8);

    const sessions = await Promise.all([
      login(fixture.users.office.email),
      login(fixture.users.teacher.email),
      login(fixture.users.parent.email),
      login(fixture.users.student.email),
      login("exam.only@school.test"),
      login("manager.only@school.test"),
      login("notice.viewer@school.test"),
    ]);
    const circulars = await Promise.all(
      sessions.slice(0, 4).map((session) =>
        request(app).get("/api/v1/notices").set("Authorization", `Bearer ${session.body.token}`)
      )
    );
    const inboxes = await Promise.all(
      sessions.map((session) =>
        request(app).get("/api/v1/notices?feed=notifications").set("Authorization", `Bearer ${session.body.token}`)
      )
    );
    for (const board of circulars) {
      expect(board.status).toBe(200);
      expect(board.body.notices).toEqual(
        expect.arrayContaining([expect.objectContaining({ title: "Fixture circular", kind: "CIRCULAR" })])
      );
      expect(board.body.notices.filter((notice: { title: string }) => notice.title.startsWith("Paper deadline missed"))).toHaveLength(0);
    }
    expect(inboxes[0].body.notices.filter((notice: { kind: string; title: string }) => notice.title.startsWith("Paper deadline missed"))).toHaveLength(2);
    expect(inboxes[1].body.notices.filter((notice: { kind: string; title: string }) => notice.title.startsWith("Paper deadline missed"))).toHaveLength(2);
    expect(inboxes[2].body.notices.filter((notice: { kind: string }) => notice.kind === "EXAM")).toHaveLength(0);
    expect(inboxes[3].body.notices.filter((notice: { kind: string }) => notice.kind === "EXAM")).toHaveLength(0);
    expect(inboxes[4].body.notices.filter((notice: { title: string }) => notice.title.startsWith("Paper deadline missed"))).toHaveLength(2);
    expect(inboxes[5].status).toBe(200);
    expect(inboxes[5].body.notices.filter((notice: { kind: string }) => notice.kind === "EXAM")).toHaveLength(2);
    expect(inboxes[6].status).toBe(200);
    expect(inboxes[6].body.notices.filter((notice: { kind: string }) => notice.kind === "EXAM")).toHaveLength(0);
    for (const inbox of inboxes.slice(0, 4)) {
      expect(inbox.body.notices.filter((notice: { title: string }) => notice.title === "Fixture circular")).toHaveLength(0);
    }

    await prisma.exam.create({
      data: {
        ...baseExam,
        id: "exam-nt5-concurrent",
        title: "Concurrent deadline",
        setterId: "teacher-tara",
        paperDueOn: new Date("2026-08-04T00:00:00.000Z"),
      },
    });
    const concurrent = await Promise.all([
      request(app).post("/api/cron/exams").set(cronAuth),
      request(app).post("/api/cron/exams").set(cronAuth),
    ]);
    expect(concurrent.every((response) => response.status === 200)).toBe(true);
    expect(concurrent.reduce((sum, response) => sum + response.body.created, 0)).toBe(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(await prisma.notice.count({ where: { eventKey: "NT-5:exam-nt5-concurrent:2026-08-04" } })).toBe(1);
    expect(
      await prisma.noticeRecipient.count({
        where: { notice: { eventKey: "NT-5:exam-nt5-concurrent:2026-08-04" } },
      })
    ).toBe(4);
    fetchMock.mockRestore();
  });

  it("persists and deduplicates an NT-5 event when Expo push fails", async () => {
    await setupNt5Actors();
    await prisma.exam.create({
      data: {
        id: "exam-nt5-push-failure",
        title: "Push failure deadline",
        subjectId: "subject-mathematics",
        classId: fixture.classId,
        setterId: "teacher-tara",
        teacherId: "teacher-evaluator",
        date: new Date("2026-09-15T00:00:00.000Z"),
        paperDueOn: new Date("2026-08-05T00:00:00.000Z"),
        maxMarks: 80,
      },
    });
    const pushSignals: (AbortSignal | null)[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      pushSignals.push(init?.signal instanceof AbortSignal ? init.signal : null);
      return Promise.reject(new DOMException("Expo request timed out", "TimeoutError"));
    });
    const cronAuth = { Authorization: "Bearer fixture-cron-secret" };

    const first = await request(app).post("/api/cron/exams").set(cronAuth);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ eligible: 1, created: 1, skipped: 0, recipients: 4 });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(pushSignals[0]).toBeInstanceOf(AbortSignal);
    const persisted = await prisma.notice.findUnique({
      where: { eventKey: "NT-5:exam-nt5-push-failure:2026-08-05" },
      include: { recipients: true },
    });
    expect(persisted?.recipients.map((recipient) => recipient.userId).sort()).toEqual([
      "user-exam-only",
      "user-manager-only",
      fixture.users.office.id,
      fixture.users.teacher.id,
    ]);

    const repeated = await request(app).post("/api/cron/exams").set(cronAuth);
    expect(repeated.body).toMatchObject({ eligible: 1, created: 0, skipped: 1, recipients: 0 });
    expect(
      await prisma.notice.count({ where: { eventKey: "NT-5:exam-nt5-push-failure:2026-08-05" } })
    ).toBe(1);
    fetchMock.mockRestore();
  });

  it("attempts later exact-recipient push chunks after an earlier chunk fails", async () => {
    const actors = await setupNt5Actors();
    await prisma.user.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        id: `user-exam-chunk-${index}`,
        email: `exam.chunk.${index}@school.test`,
        password: actors.password,
        name: `Exam Chunk ${index}`,
        roleId: "role-exam-only",
        pushToken: `ExponentPushToken[chunk-${index}]`,
      })),
    });
    await prisma.exam.create({
      data: {
        id: "exam-nt5-push-chunks",
        title: "Push chunk deadline",
        subjectId: "subject-mathematics",
        classId: fixture.classId,
        setterId: "teacher-tara",
        date: new Date("2026-09-15T00:00:00.000Z"),
        paperDueOn: new Date("2026-08-06T00:00:00.000Z"),
        maxMarks: 80,
      },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const response = await request(app)
      .post("/api/cron/exams")
      .set("Authorization", "Bearer fixture-cron-secret");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ eligible: 1, created: 1, skipped: 0, recipients: 105 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const chunkSizes = fetchMock.mock.calls.map((call) =>
      (JSON.parse(String((call[1] as RequestInit).body)) as unknown[]).length
    );
    expect(chunkSizes).toEqual([100, 5]);
    const pushedTokens = fetchMock.mock.calls.flatMap((call) =>
      (JSON.parse(String((call[1] as RequestInit).body)) as { to: string }[]).map((message) => message.to)
    );
    const expectedTokens = [
      ...actors.recipientTokens,
      ...Array.from({ length: 101 }, (_, index) => `ExponentPushToken[chunk-${index}]`),
    ].sort();
    expect(pushedTokens.sort()).toEqual(expectedTokens);
    expect(new Set(pushedTokens)).toHaveLength(105);
    expect(pushedTokens).not.toContain("ExponentPushToken[evaluator]");
    expect(pushedTokens).not.toContain("ExponentPushToken[non-recipient]");
    expect(fetchMock.mock.calls.every((call) => (call[1] as RequestInit).signal instanceof AbortSignal)).toBe(true);
    expect(
      await prisma.noticeRecipient.count({
        where: { notice: { eventKey: "NT-5:exam-nt5-push-chunks:2026-08-06" } },
      })
    ).toBe(105);
    fetchMock.mockRestore();
  });

  it("keeps school circulars off the notification feed and system kinds off Notices", async () => {
    const office = await login(fixture.users.office.email);
    const parent = await login(fixture.users.parent.email);
    const officeAuth = { Authorization: `Bearer ${office.body.token}` };
    const parentAuth = { Authorization: `Bearer ${parent.body.token}` };

    const posted = await request(app).post("/api/v1/act").set(officeAuth).send({
      op: "publishNotice",
      title: "Annual Sports Day",
      body: "20 September · School Ground",
      audience: ["PARENT", "TEACHER", "STUDENT", "OFFICE"],
      allClasses: true,
      kind: "FEES",
    });
    expect(posted.status).toBe(200);

    await prisma.notice.create({
      data: {
        id: "notice-fee-legacy",
        title: "Report card held due to fee",
        body: "Clear dues to open the report card.",
        kind: "FEE",
        authorId: fixture.users.office.id,
        audiences: { create: [{ portal: "PARENT" }, { portal: "STUDENT" }, { portal: "OFFICE" }] },
        classes: { create: [{ classId: fixture.classId }] },
      },
    });
    await prisma.notice.create({
      data: {
        id: "notice-unknown-kind",
        title: "Mystery ping",
        body: "Should not be a circular.",
        kind: "WEIRD",
        authorId: fixture.users.office.id,
        audiences: { create: [{ portal: "OFFICE" }, { portal: "PARENT" }] },
      },
    });
    await prisma.notice.create({
      data: {
        id: "notice-personal-fees",
        title: "Fee payment received",
        body: "₹5,000 received for September",
        kind: "FEES",
        authorId: fixture.users.office.id,
        recipients: { create: [{ userId: fixture.users.parent.id }] },
      },
    });

    const board = await request(app).get("/api/v1/notices").set(officeAuth);
    const titles = (board.body.notices as { title: string; kind: string }[]).map((n) => n.title);
    expect(titles).toContain("Annual Sports Day");
    expect(board.body.notices.find((n: { title: string }) => n.title === "Annual Sports Day")).toMatchObject({
      kind: "CIRCULAR",
    });
    expect(titles).not.toContain("Report card held due to fee");
    expect(titles).not.toContain("Mystery ping");
    expect(titles).not.toContain("Fee payment received");

    const feed = await request(app).get("/api/v1/notices?feed=notifications").set(officeAuth);
    const feedKinds = (feed.body.notices as { title: string; kind: string }[]).map((n) => `${n.kind}:${n.title}`);
    expect(feedKinds).toContain("FEES:Report card held due to fee");
    expect(feedKinds).toContain("OTHER:Mystery ping");
    expect(feedKinds.some((row) => row.endsWith(":Annual Sports Day"))).toBe(false);

    const parentBoard = await request(app).get("/api/v1/notices").set(parentAuth);
    expect(parentBoard.body.notices.map((n: { title: string }) => n.title)).not.toContain("Fee payment received");
    const parentFeed = await request(app).get("/api/v1/notices?feed=notifications").set(parentAuth);
    expect(parentFeed.body.notices).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Fee payment received", kind: "FEES" })])
    );
    const officePersonal = (feed.body.notices as { title: string }[]).filter((n) => n.title === "Fee payment received");
    expect(officePersonal).toHaveLength(0);
  });
});
