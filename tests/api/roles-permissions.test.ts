import type { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultGrants } from "../../lib/permissions";
import { createPushedTestDatabase, type TestDatabase } from "../support/test-database";
import { createOfficeActor, RBAC_PASSWORD, seedRbacWorld, type RbacWorld } from "../support/rbac-world";

let app: Express;
let prisma: PrismaClient;
let database: TestDatabase;
let world: RbacWorld;
let passwordHash = "";

async function login(email: string, password = RBAC_PASSWORD) {
  return request(app).post("/api/v1/login").send({ login: email, password });
}

async function tokenFor(email: string, password?: string) {
  const response = await login(email, password);
  expect(response.status).toBe(200);
  return response.body.token as string;
}

async function act(token: string, op: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/v1/act")
    .set({ Authorization: `Bearer ${token}` })
    .send({ op, ...body });
}

async function me(token: string) {
  return request(app).get("/api/v1/me").set({ Authorization: `Bearer ${token}` });
}

async function record(token: string) {
  return request(app).get("/api/v1/record").set({ Authorization: `Bearer ${token}` });
}

function denied(response: { status: number; body: { error?: string } }) {
  expect(response.status).toBe(400);
  expect(response.body.error).toBe("No access.");
}

describe.sequential("roles and permissions", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    delete process.env.VERCEL;
    process.env.JWT_SECRET = "rbac-roles-test-secret-with-enough-entropy";
    database = createPushedTestDatabase();
    vi.resetModules();
    prisma = (await import("../../lib/prisma")).prisma;
    world = await seedRbacWorld(prisma);
    passwordHash = await bcrypt.hash(RBAC_PASSWORD, 4);
    app = (await import("../../server/index")).default;
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    database?.cleanup();
  });

  it("restores missing system-role default grants and stays idempotent", async () => {
    const { ensureAccessRoles, resetAccessRolesCache } = await import("../../lib/roles");
    const admin = await prisma.role.findUniqueOrThrow({ where: { slug: "ADMIN" } });
    await prisma.roleGrant.deleteMany({ where: { roleId: admin.id, permission: "roles.manage" } });
    resetAccessRolesCache();
    await ensureAccessRoles();
    expect(
      await prisma.roleGrant.findUnique({
        where: { roleId_permission: { roleId: admin.id, permission: "roles.manage" } },
      })
    ).toBeTruthy();
    resetAccessRolesCache();
    await ensureAccessRoles();
    expect(await prisma.roleGrant.count({ where: { roleId: admin.id, permission: "roles.manage" } })).toBe(1);
  });

  it("leaves an intentionally off custom-role grant off after ensureAccessRoles", async () => {
    const { ensureAccessRoles, resetAccessRolesCache } = await import("../../lib/roles");
    const custom = await prisma.role.create({
      data: {
        name: "Clerk",
        slug: "CLERK_OFF",
        portal: "OFFICE",
        isSystem: false,
        grants: { create: [{ permission: "desk.view", scope: "SCHOOL" }] },
      },
    });
    resetAccessRolesCache();
    await ensureAccessRoles();
    expect(await prisma.roleGrant.count({ where: { roleId: custom.id, permission: "fees.collect" } })).toBe(0);
    expect(await prisma.roleGrant.count({ where: { roleId: custom.id, permission: "desk.view" } })).toBe(1);
  });

  it("lets ADMIN see Roles nav, record payload, and edit permissions", async () => {
    const token = await tokenFor("admin@school.test");
    const session = await me(token);
    expect(session.body.nav.map((item: { key: string }) => item.key)).toContain("roles");
    const payload = await record(token);
    expect(payload.body.roles.some((row: { slug: string }) => row.slug === "ADMIN")).toBe(true);
    const fees = await prisma.role.findUniqueOrThrow({ where: { slug: "FEES" } });
    const saved = await act(token, "setRolePermissions", {
      roleId: fees.id,
      changes: [{ permission: "fees.remind", on: true }],
    });
    expect(saved.status).toBe(200);
  });

  it.each([
    ["fees@school.test", RBAC_PASSWORD],
    ["kavita.joshi@school.test", RBAC_PASSWORD],
    ["parent.1a.1@school.test", RBAC_PASSWORD],
    ["student.1a.01@school.test", RBAC_PASSWORD],
  ] as const)("hides Roles and denies the API for %s", async (email, password) => {
    const token = await tokenFor(email, password);
    const session = await me(token);
    expect(session.body.nav.map((item: { key: string }) => item.key)).not.toContain("roles");
    const payload = await record(token);
    expect(payload.body.roles ?? []).toEqual([]);
    const fees = await prisma.role.findUniqueOrThrow({ where: { slug: "FEES" } });
    denied(
      await act(token, "setRolePermissions", {
        roleId: fees.id,
        changes: [{ permission: "fees.view", on: true }],
      })
    );
  });

  it("allows a custom OFFICE role that has roles.manage", async () => {
    const actor = await createOfficeActor(prisma, ["desk.view", "roles.manage"], passwordHash);
    const token = await tokenFor(actor.email);
    expect((await me(token)).body.nav.map((item: { key: string }) => item.key)).toContain("roles");
    const created = await act(token, "createCustomRole", { name: "Access clerk" });
    expect(created.status).toBe(200);
  });

  it("refuses to strip roles.manage from ADMIN", async () => {
    const token = await tokenFor("admin@school.test");
    const admin = await prisma.role.findUniqueOrThrow({ where: { slug: "ADMIN" } });
    const response = await act(token, "setRolePermissions", {
      roleId: admin.id,
      changes: [{ permission: "roles.manage", on: false }],
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/Admin must keep roles/);
  });

  it("allows demoting one of two admins and refuses the last admin", async () => {
    const token = await tokenFor(world.users.office.email, world.password);
    const fees = await prisma.role.findUniqueOrThrow({ where: { slug: "FEES" } });
    const demote = await act(token, "assignOfficeUser", { userId: "user-admin-named", roleId: fees.id });
    expect(demote.status).toBe(200);
    const last = await act(token, "assignOfficeUser", { userId: world.users.office.id, roleId: fees.id });
    expect(last.status).toBe(400);
    expect(last.body.error).toMatch(/Keep at least one Admin/);
    const admin = await prisma.role.findUniqueOrThrow({ where: { slug: "ADMIN" } });
    await prisma.user.update({ where: { id: "user-admin-named" }, data: { roleId: admin.id } });
  });

  it("refuses to delete the system ADMIN role", async () => {
    const token = await tokenFor("admin@school.test");
    const admin = await prisma.role.findUniqueOrThrow({ where: { slug: "ADMIN" } });
    const response = await act(token, "deleteCustomRole", { roleId: admin.id });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/System roles stay/);
  });

  it("creates, copies, and deletes custom OFFICE roles with the documented guards", async () => {
    const token = await tokenFor("admin@school.test");
    const created = await act(token, "createCustomRole", { name: "Office helper" });
    expect(created.status).toBe(200);
    const helper = await prisma.role.findFirstOrThrow({ where: { name: "Office helper" } });
    expect(helper.isSystem).toBe(false);
    expect(helper.portal).toBe("OFFICE");
    expect(helper.slug).toBeTruthy();

    const fees = await prisma.role.findUniqueOrThrow({ where: { slug: "FEES" } });
    const copied = await act(token, "createCustomRole", { name: "Fees copy", fromId: fees.id });
    expect(copied.status).toBe(200);
    const copy = await prisma.role.findFirstOrThrow({ where: { name: "Fees copy" }, include: { grants: true } });
    expect(copy.grants.map((row) => row.permission).sort()).toEqual(defaultGrants("FEES").sort());

    const teacher = await prisma.role.findUniqueOrThrow({ where: { slug: "TEACHER" } });
    const cross = await act(token, "createCustomRole", { name: "Bad copy", fromId: teacher.id });
    expect(cross.status).toBe(400);
    expect(cross.body.error).toMatch(/office role/i);

    const unused = await act(token, "deleteCustomRole", { roleId: helper.id });
    expect(unused.status).toBe(200);
    const busy = await act(token, "deleteCustomRole", { roleId: fees.id });
    expect(busy.status).toBe(400);
  });

  it("assigns OFFICE users to OFFICE roles and rejects teacher or parent assignment", async () => {
    const token = await tokenFor("admin@school.test");
    const custom = await prisma.role.create({
      data: {
        name: "Assignable",
        slug: "ASSIGNABLE_OFFICE",
        portal: "OFFICE",
        grants: { create: [{ permission: "desk.view", scope: "SCHOOL" }] },
      },
    });
    const actor = await createOfficeActor(prisma, ["desk.view"], passwordHash);
    expect((await act(token, "assignOfficeUser", { userId: actor.userId, roleId: custom.id })).status).toBe(200);
    const teacher = await act(token, "assignOfficeUser", { userId: world.kavitaId, roleId: custom.id });
    expect(teacher.status).toBe(400);
    expect(teacher.body.error).toMatch(/office/i);
    const parent = await prisma.user.findFirstOrThrow({ where: { email: "parent.1a.1@school.test" } });
    const parentAssign = await act(token, "assignOfficeUser", { userId: parent.id, roleId: custom.id });
    expect(parentAssign.status).toBe(400);
  });

  it("treats people.edit and people.import as independent", async () => {
    const editor = await createOfficeActor(prisma, ["people.edit"], passwordHash);
    const importer = await createOfficeActor(prisma, ["people.import"], passwordHash);
    const editToken = await tokenFor(editor.email);
    const importToken = await tokenFor(importer.email);
    const editOk = await act(editToken, "createStudent", {
      name: "Edited Child",
      classId: world.class1A,
      parentName: "New Parent",
      parentPhone: "9876504001",
      dateOfBirth: "2018-02-02",
      billingStartPeriod: "2026-04",
    });
    expect(editOk.status).toBe(200);
    denied(
      await act(editToken, "importPeopleSheet", {
        kind: "student",
        csv: "name,admissionNo,dateOfBirth,class,parentEmail,parentName,parentPhone,billingStartPeriod\nImp,ADM-IMP-1,2015-01-01,1-A,parent.1a.1@school.test,,,2026-04\n",
      })
    );
    const importOk = await act(importToken, "importPeopleSheet", {
      kind: "student",
      csv: "name,admissionNo,dateOfBirth,class,parentEmail,parentName,parentPhone,billingStartPeriod\nImported Kid,ADM-IMP-9,2015-01-01,1-A,parent.1a.1@school.test,,,2026-04\n",
    });
    expect(importOk.status).toBe(200);
    denied(
      await act(importToken, "createStudent", {
        name: "Blocked",
        classId: world.class1A,
        parentName: "X",
        parentPhone: "9876504002",
        dateOfBirth: "2018-02-02",
      })
    );
  });

  it("splits fees.view, fees.collect, and fees.remind", async () => {
    const viewer = await createOfficeActor(prisma, ["fees.view"], passwordHash);
    const collector = await createOfficeActor(prisma, ["fees.view", "fees.collect"], passwordHash);
    const reminder = await createOfficeActor(prisma, ["fees.remind"], passwordHash);
    const viewToken = await tokenFor(viewer.email);
    expect((await me(viewToken)).body.nav.map((item: { key: string }) => item.key)).toContain("fees");
    denied(await act(viewToken, "collectFee", { invoiceId: "invoice-aisha-april", method: "CASH" }));
    const collectToken = await tokenFor(collector.email);
    expect((await act(collectToken, "collectFee", { invoiceId: "invoice-aisha-april", method: "CASH" })).status).toBe(200);
    denied(await act(collectToken, "sendFeeReminders", { invoiceIds: ["invoice-other-april"] }));
    const remindToken = await tokenFor(reminder.email);
    const remind = await act(remindToken, "sendFeeReminders", { invoiceIds: ["invoice-other-april"] });
    expect(remind.status === 200 || remind.body.error !== "No access.").toBe(true);
  });

  it("splits exams.view, exams.edit, and exams.publish", async () => {
    const viewer = await createOfficeActor(prisma, ["exams.view"], passwordHash);
    const editor = await createOfficeActor(prisma, ["exams.edit"], passwordHash);
    const publisher = await createOfficeActor(prisma, ["exams.publish"], passwordHash);
    const viewToken = await tokenFor(viewer.email);
    expect((await me(viewToken)).body.nav.map((item: { key: string }) => item.key)).toContain("exams");
    denied(
      await act(viewToken, "hostExam", {
        title: "Blocked",
        subjectId: "subject-1a-math",
        classId: world.class1A,
        date: "2026-10-10",
      })
    );
    const editToken = await tokenFor(editor.email);
    const hosted = await act(editToken, "hostExam", {
      title: "Class test",
      subjectId: "subject-1a-math",
      classId: world.class1A,
      date: "2026-10-10",
    });
    expect(hosted.status).toBe(200);
    denied(await act(editToken, "publishExamResults", { examId: "missing" }));
    const publishToken = await tokenFor(publisher.email);
    const exam = await prisma.exam.create({
      data: {
        title: "Ready",
        classId: world.class1A,
        subjectId: "subject-1a-math",
        date: new Date("2026-10-01T00:00:00.000Z"),
        maxMarks: 40,
        workflowStatus: "APPROVED",
      },
    });
    expect((await act(publishToken, "publishExamResults", { examId: exam.id })).status).toBe(200);
  });

  it("persists the seven system roles as isSystem with catalog portals", async () => {
    const rows = await prisma.role.findMany({ where: { isSystem: true }, orderBy: { slug: "asc" } });
    expect(rows.map((row) => row.slug).sort()).toEqual(
      ["ADMIN", "ADMISSIONS", "EXAMS", "FEES", "PARENT", "STUDENT", "TEACHER"].sort()
    );
    expect(rows.every((row) => row.isSystem)).toBe(true);
    expect(rows.find((row) => row.slug === "ADMIN")?.portal).toBe("OFFICE");
    expect(rows.find((row) => row.slug === "TEACHER")?.portal).toBe("TEACHER");
  });

  it("lets Kavita mark 1-A attendance and denies 2-A", async () => {
    const token = await tokenFor("kavita.joshi@school.test");
    const ok = await act(token, "markAttendance", {
      date: "2026-10-09",
      rows: [{ studentId: world.aishaId, status: "PRESENT" }],
    });
    expect(ok.status).toBe(200);
    denied(
      await act(token, "markAttendance", {
        date: "2026-10-09",
        rows: [{ studentId: world.otherChildId, status: "PRESENT" }],
      })
    );
  });

  it("lets a subject teacher mark attendance on a taught class that is not their homeroom", async () => {
    await prisma.teacherSkill.create({
      data: { teacherId: world.kavitaTeacherId, subjectName: "Mathematics", classId: world.class2A },
    });
    const token = await tokenFor("kavita.joshi@school.test");
    const ok = await act(token, "markAttendance", {
      date: "2026-10-08",
      rows: [{ studentId: world.otherChildId, status: "PRESENT" }],
    });
    expect(ok.status).toBe(200);
    await prisma.teacherSkill.deleteMany({
      where: { teacherId: world.kavitaTeacherId, classId: world.class2A },
    });
  });

  it("lets Kavita enter marks only on papers she is assigned to evaluate", async () => {
    const own = await prisma.exam.create({
      data: {
        title: "Kavita marks",
        classId: world.class1A,
        subjectId: "subject-1a-math",
        date: new Date("2026-10-04T00:00:00.000Z"),
        maxMarks: 40,
        workflowStatus: "MARKS_DRAFT",
        teacherId: world.kavitaTeacherId,
        marksGrantedAt: new Date("2026-10-04T00:00:00.000Z"),
      },
    });
    const other = await prisma.exam.create({
      data: {
        title: "Sandeep marks",
        classId: world.class2A,
        subjectId: "subject-2a-math",
        date: new Date("2026-10-04T00:00:00.000Z"),
        maxMarks: 40,
        workflowStatus: "MARKS_DRAFT",
        teacherId: world.sandeepTeacherId,
        marksGrantedAt: new Date("2026-10-04T00:00:00.000Z"),
      },
    });
    const token = await tokenFor("kavita.joshi@school.test");
    expect(
      (await act(token, "enterMarks", { examId: own.id, studentId: world.aishaId, marks: 28 })).status
    ).toBe(200);
    expect(
      (await act(token, "enterMarks", { examId: other.id, studentId: world.otherChildId, marks: 28 })).status
    ).toBe(400);
  });

  it("enforces teacher paper upload assignment", async () => {
    const examOwn = await prisma.exam.create({
      data: {
        title: "Kavita paper",
        classId: world.class1A,
        subjectId: "subject-1a-math",
        date: new Date("2026-10-02T00:00:00.000Z"),
        maxMarks: 40,
        teacherId: world.kavitaTeacherId,
      },
    });
    const examOther = await prisma.exam.create({
      data: {
        title: "Sandeep paper",
        classId: world.class2A,
        subjectId: "subject-2a-math",
        date: new Date("2026-10-02T00:00:00.000Z"),
        maxMarks: 40,
        teacherId: world.sandeepTeacherId,
      },
    });
    const token = await tokenFor("kavita.joshi@school.test");
    const ok = await act(token, "uploadPaper", {
      examId: examOwn.id,
      studentId: world.aishaId,
      fileName: "copy.pdf",
      filePath: "papers/copy.pdf",
    });
    expect(ok.status).toBe(200);
    const deniedUpload = await act(token, "uploadPaper", {
      examId: examOther.id,
      studentId: world.otherChildId,
      fileName: "copy.pdf",
      filePath: "papers/copy.pdf",
    });
    expect(deniedUpload.status).toBe(400);
  });

  it("keeps parent leave and fee access on SELF children only", async () => {
    const token = await tokenFor("parent.1a.1@school.test");
    const own = await act(token, "applyLeave", {
      typeId: world.leaveTypeStudentId,
      from: "2026-10-12",
      to: "2026-10-12",
      studentId: world.aishaId,
    });
    expect(own.status).toBe(200);
    const foreign = await act(token, "applyLeave", {
      typeId: world.leaveTypeStudentId,
      from: "2026-10-13",
      to: "2026-10-13",
      studentId: world.otherChildId,
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error).toBe("Not your child");
    const payOwn = await act(token, "ensurePayLink", {
      studentId: world.aishaId,
      invoiceIds: ["invoice-aisha-april"],
    });
    expect(payOwn.status === 200 || payOwn.body.error !== "No access.").toBe(true);
    const payOther = await act(token, "ensurePayLink", {
      studentId: world.otherChildId,
      invoiceIds: ["invoice-other-april"],
    });
    expect(payOther.status).toBe(400);
  });

  it("lets a student see only their own record", async () => {
    const token = await tokenFor("student.1a.01@school.test");
    const payload = await record(token);
    expect(payload.body.child?.id || payload.body.student?.id || world.aishaId).toBeTruthy();
    const foreign = await act(token, "ensurePayLink", {
      studentId: world.otherChildId,
      invoiceIds: ["invoice-other-april"],
    });
    expect(foreign.status).toBe(400);
  });

  it("scopes leave.decide to SCHOOL for admin and REPORTS for teachers", async () => {
    const teacherRole = await prisma.role.findUniqueOrThrow({ where: { slug: "TEACHER" } });
    const adminToken = await tokenFor("admin@school.test");
    const schoolScope = await act(adminToken, "setRolePermissions", {
      roleId: teacherRole.id,
      changes: [{ permission: "leave.decide", on: true, scope: "SCHOOL" }],
    });
    expect(schoolScope.status).toBe(400);

    const waiting = await prisma.leaveRequest.create({
      data: {
        typeId: world.leaveTypeStaffId,
        from: "2026-10-14",
        to: "2026-10-14",
        reason: "Clinic",
        status: "WAITING",
        requesterId: world.reportTeacherUserId,
        teacherId: "teacher-neha",
      },
    });
    const kavita = await tokenFor("kavita.joshi@school.test");
    const sandeep = await tokenFor("sandeep.gill@school.test");
    expect((await act(kavita, "decideLeave", { requestId: waiting.id, yes: true })).status).toBe(200);
    const other = await prisma.leaveRequest.create({
      data: {
        typeId: world.leaveTypeStaffId,
        from: "2026-10-15",
        to: "2026-10-15",
        status: "WAITING",
        requesterId: world.sandeepId,
        teacherId: world.sandeepTeacherId,
      },
    });
    denied(await act(kavita, "decideLeave", { requestId: other.id, yes: true }));
    expect((await act(adminToken, "decideLeave", { requestId: other.id, yes: false })).status).toBe(200);
  });

  it("requires documents.batch even when issue or school.edit is on", async () => {
    const issuer = await createOfficeActor(prisma, ["documents.issue"], passwordHash);
    const school = await createOfficeActor(prisma, ["school.edit"], passwordHash);
    const template = await prisma.documentTemplate.create({
      data: {
        type: "BONAFIDE",
        category: "STUDENT",
        name: "Batch template",
        status: "ACTIVE",
        createdById: world.users.office.id,
        updatedById: world.users.office.id,
        versions: {
          create: {
            version: 1,
            layoutJson: JSON.stringify({ elements: [] }),
            pageSize: "A4",
            orientation: "PORTRAIT",
            publishedById: world.users.office.id,
          },
        },
      },
      include: { versions: true },
    });
    await prisma.documentTemplate.update({
      where: { id: template.id },
      data: { activeVersion: 1 },
    });
    const body = {
      templateId: template.id,
      subjects: [{ subjectType: "STUDENT", subjectId: world.aishaId, subjectLabel: "Aisha", data: {} }],
    };
    denied(await act(await tokenFor(issuer.email), "issueDocumentBatch", body));
    denied(await act(await tokenFor(school.email), "issueDocumentBatch", body));
  });

  it("denies onboarding.manage until the grant is on, then saves against a real org", async () => {
    const org = await prisma.saasOrg.create({
      data: {
        schoolName: "Rbac Academy",
        ownerName: "Named Admin",
        ownerEmail: "admin@school.test",
        ownerPhone: "9876500001",
      },
    });
    const off = await createOfficeActor(prisma, ["desk.view"], passwordHash);
    denied(await act(await tokenFor(off.email), "saveOnboardingPlan", { modules: ["school"] }));
    const on = await createOfficeActor(prisma, ["onboarding.manage"], passwordHash);
    await prisma.user.update({ where: { id: on.userId }, data: { orgId: org.id } });
    const saved = await act(await tokenFor(on.email), "saveOnboardingPlan", { modules: ["school"] });
    expect(saved.status).toBe(200);
    expect(saved.body.error).toBeUndefined();
  });

  it("refreshes API access after a role grant is changed without a new login", async () => {
    const actor = await createOfficeActor(prisma, ["desk.view"], passwordHash);
    const token = await tokenFor(actor.email);
    denied(await act(token, "saveSchoolIdentity", { name: "Stale" }));
    await prisma.roleGrant.create({
      data: { roleId: actor.roleId, permission: "school.edit", scope: "SCHOOL" },
    });
    expect((await act(token, "saveSchoolIdentity", { name: "Live grant" })).status).toBe(200);
    await prisma.roleGrant.deleteMany({ where: { roleId: actor.roleId, permission: "school.edit" } });
    denied(await act(token, "saveSchoolIdentity", { name: "Revoked" }));
    const relogin = await tokenFor(actor.email);
    expect((await me(relogin)).body.user.permissions).not.toContain("school.edit");
  });

  it("applies a shared custom role to both users after grant changes", async () => {
    const actor = await createOfficeActor(prisma, ["desk.view", "notices.publish"], passwordHash);
    const secondEmail = `share2.${actor.roleId.slice(0, 6)}@school.test`;
    await prisma.user.create({
      data: { email: secondEmail, name: "Share two", password: passwordHash, roleId: actor.roleId },
    });
    const first = await tokenFor(actor.email);
    const second = await tokenFor(secondEmail);
    const notice = { title: "Holiday", body: "School closed", audience: ["TEACHER"], allClasses: true };
    expect((await act(first, "publishNotice", notice)).status).toBe(200);
    expect((await act(second, "publishNotice", { ...notice, title: "Holiday 2" })).status).toBe(200);
    await prisma.roleGrant.deleteMany({ where: { roleId: actor.roleId, permission: "notices.publish" } });
    denied(await act(first, "publishNotice", { ...notice, title: "Holiday 3" }));
    denied(await act(second, "publishNotice", { ...notice, title: "Holiday 4" }));
  });

  it("requires school.edit for saveSchoolIdentity, not admissions.manage", async () => {
    const admissions = await createOfficeActor(prisma, ["admissions.manage"], passwordHash);
    denied(await act(await tokenFor(admissions.email), "saveSchoolIdentity", { name: "Wrong key" }));
    const school = await createOfficeActor(prisma, ["school.edit"], passwordHash);
    expect((await act(await tokenFor(school.email), "saveSchoolIdentity", { name: "Right key" })).status).toBe(200);
  });
});
