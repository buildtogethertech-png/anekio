import { Portal } from "@prisma/client";
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";
import { admissionCustomValues, admissionFormFields, type AdmissionFormField } from "./admission-form";
import { configuredAdmissionFormJson } from "./admission-form-config";
import { notifyNoticeRecipients } from "./push";

/**
 * Parents fill in admission-form details the school is still missing (text answers or files).
 * Nothing touches the student record until someone in the office approves it.
 */

type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";

function ensureTable() {
  if (!(prisma as unknown as Record<string, unknown>).profileRequest) {
    throw new Error("Parent updates aren't ready yet. Restart the API (stop npm run api and start it again).");
  }
}

async function schoolFields() {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { admissionFormJson: true } });
  return admissionFormFields(await configuredAdmissionFormJson(config?.admissionFormJson)).filter((f) => f.visible && !f.builtin);
}

async function ownChild(user: AccessUser, studentId: string) {
  if (user.portal !== Portal.PARENT) throw new Error("Only parents can send details here.");
  const parent = await prisma.parent.findUnique({
    where: { userId: user.id },
    include: { students: { select: { id: true, name: true, admissionDataJson: true, class: { select: { name: true, section: true } } } } },
  });
  const child = parent?.students.find((s) => s.id === studentId) || (!studentId ? parent?.students[0] : undefined);
  if (!child) throw new Error("This child is not linked to your account.");
  return child;
}

function cleanValue(field: AdmissionFormField, raw: unknown, studentId: string) {
  const value = String(raw ?? "").trim();
  if (!value) throw new Error(`Add ${field.label} first.`);
  if (field.type === "file") {
    const path = value.replace(/^\/+/, "");
    if (!path.startsWith("private/") || !path.includes(`/students/${studentId}/documents/`)) throw new Error("Upload the file again.");
    return path;
  }
  if (field.type === "select" || field.type === "radio") {
    if (!field.options.includes(value)) throw new Error(`Pick one of the options for ${field.label}.`);
  }
  if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Enter a valid email.");
  if (field.type === "phone" && value.replace(/\D/g, "").length < 10) throw new Error("Enter a valid phone number.");
  if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Pick a date.");
  return value.slice(0, field.type === "textarea" ? 1000 : 300);
}

async function officeReviewerIds() {
  const users = await prisma.user.findMany({
    where: { role: { portal: Portal.OFFICE, OR: [{ slug: "ADMIN" }, { grants: { some: { permission: "people.edit" } } }] } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** What the parent still needs to send for one child, with the state of anything already sent. */
export async function parentDetailsFor(user: AccessUser, studentId: string) {
  ensureTable();
  const child = await ownChild(user, studentId);
  const fields = await schoolFields();
  const values = admissionCustomValues(child.admissionDataJson);
  const requests = await prisma.profileRequest.findMany({
    where: { studentId: child.id },
    orderBy: { createdAt: "desc" },
  });
  const latest = new Map<string, (typeof requests)[number]>();
  for (const r of requests) if (!latest.has(r.fieldId)) latest.set(r.fieldId, r);
  const missing = fields
    .filter((f) => !String(values[f.id] || "").trim())
    .map((f) => {
      const r = latest.get(f.id);
      return {
        field: f,
        request: r && r.status !== "APPROVED"
          ? { id: r.id, status: r.status as RequestStatus, value: r.value, note: r.note, at: r.createdAt.toISOString() }
          : null,
      };
    });
  return {
    student: { id: child.id, name: child.name, classLabel: `${child.class.name}-${child.class.section}` },
    missing,
    counts: {
      toSend: missing.filter((m) => !m.request || m.request.status === "REJECTED").length,
      waiting: missing.filter((m) => m.request?.status === "PENDING").length,
      required: missing.filter((m) => m.field.required && (!m.request || m.request.status === "REJECTED")).length,
    },
  };
}

export async function submitProfileRequestCore(user: AccessUser, input: { studentId?: string; fieldId?: string; value?: string }) {
  ensureTable();
  const child = await ownChild(user, String(input.studentId || ""));
  const field = (await schoolFields()).find((f) => f.id === String(input.fieldId || ""));
  if (!field) throw new Error("That detail is not on the school's form.");
  const value = cleanValue(field, input.value, child.id);
  const pending = await prisma.profileRequest.findFirst({ where: { studentId: child.id, fieldId: field.id, status: "PENDING" } });
  const data = { fieldLabel: field.label, fieldType: field.type, value, createdAt: new Date() };
  if (pending) await prisma.profileRequest.update({ where: { id: pending.id }, data });
  else {
    await prisma.profileRequest.create({
      data: { ...data, studentId: child.id, parentUserId: user.id, fieldId: field.id, status: "PENDING" },
    });
  }
  const reviewers = await officeReviewerIds();
  void notifyNoticeRecipients({
    noticeId: child.id,
    title: `${child.name}'s parent sent ${field.label}`,
    body: "Review and approve it in the office app.",
    userIds: reviewers,
  }).catch(() => undefined);
  return { status: "PENDING" as const };
}

/** Office: everything parents have sent that nobody has looked at yet. */
export async function pendingProfileRequests(user: AccessUser) {
  ensureTable();
  if (!can(user, "people.edit")) throw new Error("No access.");
  const rows = await prisma.profileRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 200 });
  const students = await prisma.student.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.studentId))] } },
    select: { id: true, name: true, admissionNo: true, class: { select: { name: true, section: true } } },
  });
  const parents = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.parentUserId))] } },
    select: { id: true, name: true, phone: true },
  });
  const sMap = new Map(students.map((s) => [s.id, s]));
  const pMap = new Map(parents.map((p) => [p.id, p]));
  return rows.map((r) => {
    const s = sMap.get(r.studentId);
    const p = pMap.get(r.parentUserId);
    return {
      id: r.id,
      fieldId: r.fieldId,
      fieldLabel: r.fieldLabel,
      fieldType: r.fieldType,
      value: r.value,
      at: r.createdAt.toISOString(),
      student: { id: r.studentId, name: s?.name || "Student", classLabel: s ? `${s.class.name}-${s.class.section}` : "", admissionNo: s?.admissionNo || "" },
      parent: { name: p?.name || "Parent", phone: p?.phone || "" },
    };
  });
}

export async function reviewProfileRequestCore(user: AccessUser, input: { id?: string; decision?: string; note?: string }) {
  ensureTable();
  if (!can(user, "people.edit")) throw new Error("No access.");
  const row = await prisma.profileRequest.findFirst({ where: { id: String(input.id || ""), status: "PENDING" } });
  if (!row) throw new Error("This update was already reviewed.");
  const approve = String(input.decision || "").toUpperCase() === "APPROVE";
  const note = String(input.note || "").trim().slice(0, 300);
  if (!approve && !note) throw new Error("Tell the parent what to fix.");
  if (approve) {
    const student = await prisma.student.findFirst({ where: { id: row.studentId }, select: { id: true, admissionDataJson: true } });
    if (!student) throw new Error("Student not found.");
    const values = admissionCustomValues(student.admissionDataJson);
    values[row.fieldId] = row.value;
    await prisma.student.update({ where: { id: student.id }, data: { admissionDataJson: JSON.stringify(values) } });
  }
  await prisma.profileRequest.update({
    where: { id: row.id },
    data: { status: approve ? "APPROVED" : "REJECTED", note, reviewedById: user.id, reviewedAt: new Date() },
  });
  void notifyNoticeRecipients({
    noticeId: row.studentId,
    title: approve ? `${row.fieldLabel} approved` : `${row.fieldLabel} needs a fix`,
    body: approve ? "The school has added it to your child's record." : note,
    userIds: [row.parentUserId],
  }).catch(() => undefined);
  return { status: approve ? "APPROVED" : "REJECTED" };
}
