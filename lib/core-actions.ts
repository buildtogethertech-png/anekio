import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { AttendanceStatus, PaymentMethod, PathTag, Portal, PayrollStatus, RoomKind, StaffKind } from "@prisma/client";
import { sendAisensyWhatsApp } from "./aisensy";
import { getPayShareChannels, type PayShareChannelId } from "./comms";
import { recordLedgerPayment } from "./fee-ledger";
import { issueDueFeesCore } from "./fee-run";
import { feePeriod, invoiceBalance, payRangeLabel } from "./fees";
import { buildStudentMonthPayPath } from "./pay";
import { sendResendEmail } from "./resend";
import { publicOrigin } from "./utils";
import {
  can,
  LOCKED_KEYS,
  PERMISSION_KEYS,
  permissionsForPortal,
  scopeFor,
  scopePolicyFor,
  validScopeFor,
  type AccessScope,
  type AccessUser,
} from "./permissions";
import { normalizeMobile, requireMobile } from "./phone";
import { prisma } from "./prisma";
import { roleIdBySlug, slugFromName } from "./roles";
import { closedReason, paperDates, parseHolidayText, snapToSchoolDay, type PaperCadence } from "./calendar";
import { classifyFromIn, normalizeHHmm, parsePayrollRules, personKey, type PayrollRules } from "./payroll";
import { loadSchoolCalendar } from "./leave";
import { staffDayInstant, staffDayWindow, staffDayYmd } from "./staff-day";
import { addDays, examPlanWeight, parseExamPlan, ymd } from "./exams";
import { teacherCanEditMarks, teacherMayEnterMarks } from "./exam-workflow";
import { validateExamMark } from "./exam-marks";
import { notifySchedulePublished, notifySeriesAssigned } from "./exam-events";
import { isNoticeKind, normalizeWhatsAppGroupUrl } from "./notices";
import { notifyNoticePublished, notifyNoticeRecipients } from "./push";
import { PAY_GATEWAYS, type PayGateway } from "./pay-config";
import { formatQualification, parseSubjectCatalog, parseWeekdays, weekCapacity } from "./schedule";
import { validateSchoolWebsiteSlug } from "./host-routing";
import { ensureVercelSchoolWebsiteDomain } from "./vercel-domains";
import {
  createSchoolSession,
  deleteSchoolSession,
  ensureSchoolSessions,
  setCurrentSchoolSession,
  syncCurrentSessionDates,
} from "./school-session";
import { placeFields, parseMonthlySalary, requireJoinedOn, STAFF_FIRST_PASSWORD, todayJoinedOn } from "./staff-profile";
import { assertManagerChoice, defaultManagerIdForRole, managerIdForNewUser, teamClassIds } from "./reports";
import { admissionFormFields, admissionFormJson, admissionLeadInput } from "./admission-form";

function need(user: AccessUser, ...keys: string[]) {
  if (!keys.some((k) => can(user, k))) throw new Error("No access.");
}

function needSchoolScope(user: AccessUser, key: string) {
  need(user, key);
  if (scopeFor(user, key) !== "SCHOOL") throw new Error("This setting needs school-wide access.");
}

function missingAdmissionLeadRequirements(configFieldsValue: unknown, lead: { customFieldsJson?: string | null }) {
  const customValues = (() => {
    try {
      const parsed = JSON.parse(lead.customFieldsJson || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  })();
  return admissionFormFields(configFieldsValue)
    .filter((field) => field.visible && field.required && !field.builtin)
    .filter((field) => !String(customValues[field.id] || "").trim())
    .map((field) => field.label);
}

export async function changeOwnPasswordCore(
  user: AccessUser,
  input: { current: string; next: string }
) {
  const current = String(input.current || "");
  const next = String(input.next || "").trim();
  if (next.length < 6) throw new Error("New password must be at least 6 characters");
  const row = await prisma.user.findUnique({ where: { id: user.id } });
  if (!row) throw new Error("Account missing");
  const ok = await bcrypt.compare(current, row.password);
  if (!ok) throw new Error("Current password is wrong");
  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(next, 10) },
  });
}

const PATH_TAGS = ["OLYMPIAD", "SPORTS", "SPELLING", "SCIENCE", "ARTS"] as const;

async function assertPhoneFree(phone: string, exceptUserId?: string) {
  const taken = await prisma.user.findFirst({
    where: { phone, ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}) },
  });
  if (taken) throw new Error("That number already has a login");
}

async function nextEmployeeId(prefix: "S" | "T") {
  const existing =
    prefix === "T"
      ? await prisma.teacher.findMany({ select: { employeeId: true } })
      : await prisma.staffMember.findMany({ select: { employeeId: true } });
  const nums = existing
    .map((row) => Number(String(row.employeeId).replace(/\D/g, "")))
    .filter((n) => Number.isFinite(n));
  const start = prefix === "T" ? 100 : 200;
  return `${prefix}-${(nums.length ? Math.max(...nums) : start) + 1}`;
}

export async function createStudentCore(
  user: AccessUser,
  input: {
    name: string;
    admissionNo: string;
    classId: string;
    parentId: string;
    dateOfBirth: string;
    tags?: string[];
  }
) {
  need(user, "people.edit");
  const name = input.name.trim();
  const admissionNo = input.admissionNo.trim();
  const tags = (input.tags || []).filter((t): t is PathTag => PATH_TAGS.includes(t as PathTag));
  if (!name || !admissionNo || !input.classId || !input.parentId || !input.dateOfBirth) {
    throw new Error("Missing student fields");
  }
  await prisma.student.create({
    data: {
      name,
      admissionNo,
      classId: input.classId,
      parentId: input.parentId,
      dateOfBirth: new Date(input.dateOfBirth),
      interests: { create: tags.map((tag) => ({ tag })) },
    },
  });
}

function normalizeAdmissionFeeLines(input: unknown) {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((row, index) => {
      const value = row && typeof row === "object" ? row as Record<string, unknown> : {};
      return {
        label: String(value.label || "").trim().slice(0, 80),
        amount: Math.max(0, Math.round(Number(value.amount || 0))),
        sortOrder: index,
      };
    })
    .filter((row) => row.label || row.amount > 0)
    .map((row) => ({ ...row, label: row.label || "Admission fee" }));
}

export async function saveAdmissionFeeSetupCore(user: AccessUser, input: { classId?: string; lines?: unknown }) {
  need(user, "fees.configure");
  const classId = String(input.classId || "").trim();
  if (!classId) throw new Error("Pick a class first.");
  const klass = await prisma.class.findUnique({ where: { id: classId }, select: { id: true, archivedAt: true } });
  if (!klass || klass.archivedAt) throw new Error("Pick a valid class.");
  const lines = normalizeAdmissionFeeLines(input.lines);
  await prisma.$transaction([
    prisma.admissionFeeLine.deleteMany({ where: { classId } }),
    ...lines.map((line) => prisma.admissionFeeLine.create({ data: { classId, ...line } })),
  ]);
  return { lines };
}

export async function admitLeadAsStudentCore(
  user: AccessUser,
  input: {
    leadId?: string;
    studentName?: string;
    admissionNo?: string;
    classId?: string;
    dateOfBirth?: string;
    guardianName?: string;
    parentEmail?: string;
    parentPhone?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    paymentMethod?: string;
    paymentReference?: string;
  }
) {
  need(user, "admissions.manage");
  const leadId = String(input.leadId || "").trim();
  const studentName = String(input.studentName || "").trim();
  const admissionNo = String(input.admissionNo || "").trim();
  const classId = String(input.classId || "").trim();
  const dateOfBirth = String(input.dateOfBirth || "").trim();
  const guardianName = String(input.guardianName || "").trim();
  const parentEmail = String(input.parentEmail || "").toLowerCase().trim();
  const parentPhone = requireMobile(String(input.parentPhone || ""), "the parent");
  const address = String(input.address || "").trim();
  const city = String(input.city || "").trim();
  const state = String(input.state || "").trim();
  const pincode = String(input.pincode || "").trim();
  const paymentMethod = String(input.paymentMethod || "").trim().toUpperCase();
  const paymentReference = String(input.paymentReference || "").trim();
  if (!leadId) throw new Error("Pick a lead first.");
  if (!studentName || !admissionNo || !classId || !dateOfBirth || !guardianName || !parentEmail || !parentPhone || !address || !city || !state || !pincode) {
    throw new Error("Fill all required admission fields before adding the student.");
  }
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) throw new Error("Pick a valid date of birth.");

  return prisma.$transaction(async (tx) => {
    const lead = await tx.admissionLead.findUnique({ where: { id: leadId } });
    if (!lead) throw new Error("Lead not found.");
    const klass = await tx.class.findUnique({ where: { id: classId } });
    if (!klass || klass.archivedAt) throw new Error("Pick a valid class.");
    const config = await tx.schoolConfig.findUnique({ where: { id: "school" } });
    const classAdmissionRows = await tx.admissionFeeLine.findMany({
      where: { classId, active: true },
      orderBy: { sortOrder: "asc" },
    });
    const configuredAdmissionLines = classAdmissionRows
      .map((line) => ({ label: line.label, kind: "FLAT" as const, amount: Math.max(0, line.amount) }))
      .filter((line) => line.label && line.amount > 0);
    const legacyAdmissionCharge = Math.max(0, config?.admissionCharge || 0);
    const admissionLines = configuredAdmissionLines.length
      ? configuredAdmissionLines
      : legacyAdmissionCharge > 0
        ? [{ label: "Admission fee", kind: "FLAT" as const, amount: legacyAdmissionCharge }]
        : [];
    const admissionCharge = admissionLines.reduce((sum, line) => sum + line.amount, 0);
    const missingLeadRequirements = missingAdmissionLeadRequirements(config?.admissionFormJson, lead);
    if (missingLeadRequirements.length) {
      throw new Error(`Before admitting this student, complete: ${missingLeadRequirements.join(", ")}.`);
    }
    const allowedPaymentMethods = new Set(["CASH", "UPI", "RAZORPAY", "CASHFREE", "BILLDESK", "BANK", "CHEQUE"]);
    if (admissionCharge > 0 && !allowedPaymentMethods.has(paymentMethod)) {
      throw new Error("Record the one-time admission fee payment before adding the student.");
    }
    if (admissionCharge > 0 && paymentMethod !== "CASH" && !paymentReference) {
      throw new Error("Enter the payment reference for the one-time admission fee.");
    }
    const existingStudent = await tx.student.findUnique({ where: { admissionNo } });
    if (existingStudent) throw new Error("That admission number is already used.");

    const emailOwner = await tx.user.findUnique({ where: { email: parentEmail }, include: { parent: true } });
    const phoneOwner = await tx.user.findUnique({ where: { phone: parentPhone }, include: { parent: true } });
    if (emailOwner && phoneOwner && emailOwner.id !== phoneOwner.id) {
      throw new Error("Email and phone belong to different parent logins.");
    }
    const parentUser = emailOwner || phoneOwner;
    let parentId = parentUser?.parent?.id || "";
    if (parentUser && !parentId) throw new Error("That login is not a parent account.");
    if (parentUser) {
      await tx.user.update({
        where: { id: parentUser.id },
        data: {
          name: guardianName,
          email: parentEmail,
          phone: parentUser.phone || parentPhone,
        },
      });
      await tx.parent.update({ where: { id: parentId }, data: { phone: parentPhone, address, city, state, pincode } });
    } else {
      const created = await tx.user.create({
        data: {
          name: guardianName,
          email: parentEmail,
          password: await bcrypt.hash("12345", 10),
          roleId: await roleIdBySlug("PARENT"),
          phone: parentPhone,
          parent: { create: { phone: parentPhone, address, city, state, pincode } },
        },
        include: { parent: true },
      });
      parentId = created.parent?.id || "";
    }
    if (!parentId) throw new Error("Could not prepare parent account.");

    const student = await tx.student.create({
      data: {
        name: studentName,
        admissionNo,
        classId,
        parentId,
        dateOfBirth: born,
      },
    });
    if (admissionCharge > 0) {
      await tx.feeInvoice.create({
        data: {
          studentId: student.id,
          classId,
          period: `ADMISSION-${student.id}`,
          title: "One-time admission fee",
          amount: admissionCharge,
          linesJson: JSON.stringify(admissionLines),
          dueDate: new Date(),
          status: "PAID",
          payments: {
            create: {
              amount: admissionCharge,
              method: paymentMethod as PaymentMethod,
              reference: paymentReference || null,
              notes: "Collected as a one-time admission fee",
            },
          },
        },
      });
    }
    const actorName = user.name || "School office";
    await tx.admissionLead.update({
      where: { id: leadId },
      data: {
        studentName,
        guardianName,
        phone: parentPhone,
        email: parentEmail,
        classWanted: `${klass.name}-${klass.section}`,
        status: "ADMITTED",
      },
    });
    await tx.admissionLeadEvent.create({
      data: {
        leadId,
        kind: "ADMITTED",
        title: "Student admitted",
        body: `Admission no ${admissionNo} · ${klass.name}-${klass.section}${admissionCharge > 0 ? ` · one-time admission fee ₹${admissionCharge.toLocaleString("en-IN")} paid by ${paymentMethod}` : ""}`,
        actorName,
      },
    });
    return { studentId: student.id };
  });
}

export async function updateStudentCore(
  user: AccessUser,
  input: {
    studentId: string;
    name: string;
    admissionNo: string;
    classId: string;
    parentId: string;
    dateOfBirth: string;
    tags?: string[];
    parentName?: string;
    parentEmail?: string;
    parentPhone?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
  }
) {
  need(user, "people.edit");
  const id = String(input.studentId || "");
  const name = input.name.trim();
  const admissionNo = input.admissionNo.trim();
  const classId = String(input.classId || "");
  const parentId = String(input.parentId || "");
  const dob = String(input.dateOfBirth || "");
  const tags = (input.tags || []).filter((t): t is PathTag => PATH_TAGS.includes(t as PathTag));
  const parentName = String(input.parentName || "").trim();
  const parentEmail = String(input.parentEmail || "").toLowerCase().trim();
  const parentPhone = requireMobile(String(input.parentPhone || ""), "the parent");
  const address = String(input.address || "").trim();
  const city = String(input.city || "").trim();
  const state = String(input.state || "").trim();
  const pincode = String(input.pincode || "").trim();
  if (!id || !name || !admissionNo || !classId || !parentId || !dob) {
    throw new Error("Missing student fields");
  }
  const student = await prisma.student.findUnique({ where: { id } });
  if (!student) throw new Error("Student missing");
  const takenAdm = await prisma.student.findFirst({
    where: { admissionNo, NOT: { id } },
    select: { id: true },
  });
  if (takenAdm) throw new Error("That admission number is already used");
  const parent = await prisma.parent.findUnique({
    where: { id: parentId },
    include: { user: true },
  });
  if (!parent) throw new Error("Parent missing");
  if (parentEmail && parentEmail !== parent.user.email) {
    const taken = await prisma.user.findUnique({ where: { email: parentEmail } });
    if (taken && taken.id !== parent.userId) {
      throw new Error("That email is already on another profile");
    }
  }
  await assertPhoneFree(parentPhone, parent.userId);
  await prisma.student.update({
    where: { id },
    data: {
      name,
      admissionNo,
      classId,
      parentId,
      dateOfBirth: new Date(dob),
    },
  });
  await prisma.studentInterest.deleteMany({ where: { studentId: id } });
  if (tags.length) {
    await prisma.studentInterest.createMany({ data: tags.map((tag) => ({ studentId: id, tag })) });
  }
  await prisma.parent.update({
    where: { id: parentId },
    data: {
      phone: parentPhone,
      address,
      city,
      state,
      pincode,
      user: {
        update: {
          ...(parentName ? { name: parentName } : {}),
          ...(parentEmail ? { email: parentEmail } : {}),
          phone: parentPhone,
        },
      },
    },
  });
}

export async function updateParentCore(
  user: AccessUser,
  input: {
    parentId: string;
    name: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    password?: string;
  }
) {
  need(user, "people.edit");
  const id = String(input.parentId || "");
  const name = input.name.trim();
  const email = input.email.toLowerCase().trim();
  const mobile = requireMobile(String(input.phone || ""), "the parent");
  const address = String(input.address || "").trim();
  const city = String(input.city || "").trim();
  const state = String(input.state || "").trim();
  const pincode = String(input.pincode || "").trim();
  const password = String(input.password || "");
  if (!id || !name || !email) throw new Error("Name and email are required");
  const parent = await prisma.parent.findUnique({ where: { id }, include: { user: true } });
  if (!parent) throw new Error("Parent missing");
  if (email !== parent.user.email) {
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken && taken.id !== parent.userId) {
      throw new Error("That email is already on another profile");
    }
  }
  if (mobile) await assertPhoneFree(mobile, parent.userId);
  await prisma.parent.update({
    where: { id },
    data: {
      phone: mobile,
      address,
      city,
      state,
      pincode,
      user: {
        update: {
          name,
          email,
          phone: mobile,
          ...(password.trim() ? { password: await bcrypt.hash(password.trim(), 10) } : {}),
        },
      },
    },
  });
}

export async function updateTeacherCore(
  user: AccessUser,
  input: {
    teacherId: string;
    name: string;
    email: string;
    phone?: string;
    employeeId: string;
    roleId?: string;
    joinedOn?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    qualification?: string;
    password?: string;
    managerId?: string | null;
    monthlySalary?: number | string;
  }
) {
  need(user, "staff.edit", "people.edit");
  const id = String(input.teacherId || "");
  const name = input.name.trim();
  const email = input.email.toLowerCase().trim();
  const mobile = requireMobile(String(input.phone || ""), "the teacher");
  const employeeId = String(input.employeeId || "").trim();
  const joinedOn = input.joinedOn ? requireJoinedOn(input.joinedOn) : undefined;
  const place = placeFields(input);
  const qualification = String(input.qualification || "").trim();
  const password = String(input.password || "");
  if (!id || !name || !email || !employeeId) throw new Error("Name, email, and employee id are required");
  const teacher = await prisma.teacher.findUnique({ where: { id }, include: { user: true } });
  if (!teacher) throw new Error("Teacher missing");
  let roleId: string | undefined;
  if (input.roleId) {
    const role = await prisma.role.findUnique({ where: { id: input.roleId } });
    if (!role || role.portal !== "TEACHER") throw new Error("Pick a teacher role");
    roleId = role.id;
  }
  if (email !== teacher.user.email) {
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken && taken.id !== teacher.userId) {
      throw new Error("That email is already on another profile");
    }
  }
  if (employeeId !== teacher.employeeId) {
    const taken = await prisma.teacher.findFirst({
      where: { employeeId, NOT: { id } },
      select: { id: true },
    });
    if (taken) throw new Error("That employee id is already used");
  }
  await assertPhoneFree(mobile, teacher.userId);
  const userPatch: { name: string; email: string; phone: string; password?: string; managerId?: string | null } = {
    name,
    email,
    phone: mobile,
    ...(roleId ? { roleId } : {}),
    ...(password.trim() ? { password: await bcrypt.hash(password.trim(), 10) } : {}),
  };
  if (input.managerId !== undefined) {
    userPatch.managerId = await assertManagerChoice(user, teacher.userId, input.managerId || null);
  }
  await prisma.teacher.update({
    where: { id },
    data: {
      employeeId,
      ...(joinedOn ? { joinedOn } : {}),
      ...place,
      qualification: qualification || null,
      ...(input.monthlySalary !== undefined ? { monthlySalary: parseMonthlySalary(input.monthlySalary) } : {}),
      user: { update: userPatch },
    },
  });
}

export async function updateStaffMemberCore(
  user: AccessUser,
  input: {
    staffId: string;
    name: string;
    phone: string;
    roleId: string;
    joinedOn: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    managerId?: string | null;
    monthlySalary?: number | string;
  }
) {
  need(user, "staff.edit");
  const id = String(input.staffId || "").trim();
  const name = String(input.name || "").trim();
  const phone = requireMobile(input.phone || "", "the employee");
  const joinedOn = requireJoinedOn(input.joinedOn);
  const email = String(input.email || "").toLowerCase().trim();
  const place = placeFields(input);
  if (!id || !name) throw new Error("Enter their name");
  if (!input.roleId) throw new Error("Pick a role");
  const staff = await prisma.staffMember.findUnique({ where: { id }, include: { user: true } });
  if (!staff) throw new Error("Employee missing");
  const role = await prisma.role.findUnique({ where: { id: input.roleId } });
  if (!role || role.portal === "STUDENT" || role.portal === "PARENT" || role.portal === "TEACHER") {
    throw new Error("Pick an employee role");
  }
  if (staff.userId) await assertPhoneFree(phone, staff.userId);
  else await assertPhoneFree(phone);
  if (email && staff.userId && email !== staff.user?.email) {
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken && taken.id !== staff.userId) throw new Error("That email is already in the school");
  }
  const title = role.name;
  const kind: StaffKind = role.portal === "OFFICE" ? "OFFICE" : "SUPPORT";
  if (staff.userId) {
    await prisma.user.update({
      where: { id: staff.userId },
      data: {
        name,
        phone,
        roleId: role.id,
        ...(email ? { email } : {}),
        managerId: await assertManagerChoice(
          user,
          staff.userId,
          input.managerId === undefined ? staff.user?.managerId || null : input.managerId || null
        ),
      },
    });
  }
  await prisma.staffMember.update({
    where: { id },
    data: {
      name,
      title,
      phone,
      role: { connect: { id: role.id } },
      joinedOn,
      kind,
      ...place,
      ...(input.monthlySalary !== undefined ? { monthlySalary: parseMonthlySalary(input.monthlySalary) } : {}),
    },
  });
}

export async function setManagerCore(user: AccessUser, input: { userId?: string; managerId?: string | null }) {
  const userId = String(input.userId || "").trim();
  if (!userId) throw new Error("Pick a person");
  const managerId = await assertManagerChoice(user, userId, input.managerId === undefined ? null : input.managerId);
  await prisma.user.update({ where: { id: userId }, data: { managerId } });
}

export async function createParentCore(
  user: AccessUser,
  input: { name: string; email: string; phone?: string; password?: string; address?: string; city?: string; state?: string; pincode?: string }
) {
  need(user, "people.edit");
  const name = input.name.trim();
  const email = input.email.toLowerCase().trim();
  const mobile = requireMobile(input.phone || "", "the parent");
  if (!name || !email) throw new Error("Name and email are required");
  await assertPhoneFree(mobile);
  await prisma.user.create({
    data: {
      name,
      email,
      password: await bcrypt.hash(input.password || "12345", 10),
      roleId: await roleIdBySlug("PARENT"),
      phone: mobile,
      parent: {
        create: {
          phone: mobile,
          address: input.address || "",
          city: input.city || "",
          state: input.state || "",
          pincode: input.pincode || "",
        },
      },
    },
  });
}

export async function createTeacherCore(
  user: AccessUser,
  input: {
    name: string;
    email: string;
    phone?: string;
    password?: string;
    employeeId?: string;
    qualification?: string[] | string;
    qualificationNotes?: string;
    offers?: { subjectName: string; classId: string }[];
    monthlySalary?: number | string;
  }
) {
  need(user, "staff.edit");
  const name = input.name.trim();
  const email = input.email.toLowerCase().trim();
  const mobile = requireMobile(input.phone || "", "the teacher");
  if (!name || !email) throw new Error("Name and email are required");
  await assertPhoneFree(mobile);
  let employeeId = (input.employeeId || "").trim();
  if (!employeeId) employeeId = await nextEmployeeId("T");
  const offers = (input.offers || []).filter((o) => o.subjectName && o.classId);
  const classIds = [...new Set(offers.map((o) => o.classId))];
  const tags = Array.isArray(input.qualification)
    ? input.qualification
    : input.qualification
      ? [input.qualification]
      : [];
  const qualification = formatQualification(tags, input.qualificationNotes || "");
  const roleId = await roleIdBySlug("TEACHER");
  await prisma.user.create({
    data: {
      name,
      email,
      password: await bcrypt.hash(input.password || "12345", 10),
      roleId,
      phone: mobile,
      managerId: await defaultManagerIdForRole("TEACHER", "TEACHER"),
      teacher: {
        create: {
          employeeId,
          joinedOn: todayJoinedOn(),
          monthlySalary: parseMonthlySalary(input.monthlySalary),
          ...(qualification ? { qualification } : {}),
          ...(classIds[0] ? { classId: classIds[0] } : {}),
          skills: {
            create: offers.map((o) => ({ subjectName: o.subjectName, classId: o.classId })),
          },
          classes: { create: classIds.map((id) => ({ classId: id })) },
        },
      },
    },
  });
}

async function assertWeightsFitWeek(weights: { name: string; weightage: number }[]) {
  const [config, periods] = await Promise.all([
    prisma.schoolConfig.findUnique({ where: { id: "school" } }),
    prisma.period.findMany(),
  ]);
  const cap = weekCapacity(parseWeekdays(config?.weekdays).length, periods.filter((p) => !p.isBreak).length);
  if (cap <= 0) throw new Error("Set school days and teaching periods first. There is no week to fill.");
  const sum = weights.reduce((n, row) => n + row.weightage, 0);
  for (const row of weights) {
    if (row.weightage > cap) {
      throw new Error(
        `${row.name} is ${row.weightage} periods. This week only has ${cap}. A subject cannot be larger than the week.`
      );
    }
  }
  if (sum > cap) {
    throw new Error(`These subjects add up to ${sum} periods. This week only has ${cap}. Reduce weightage until the sum fits.`);
  }
  return cap;
}

export async function createClassCore(
  user: AccessUser,
  input: {
    name: string;
    section?: string;
    teacherId?: string;
    subjects?: { name: string; weightage: number }[];
  }
) {
  need(user, "people.edit", "school.edit");
  const name = input.name.trim();
  const section = (input.section || "A").trim().toUpperCase();
  if (!name) throw new Error("Class and section required");
  let weights = (input.subjects || [])
    .map((s) => ({ name: s.name.trim(), weightage: Math.max(0, Number(s.weightage) || 0) }))
    .filter((s) => s.name);
  if (!weights.length) {
    const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
    const catalog = parseSubjectCatalog(config?.subjectCatalog);
    const each = 4;
    weights = catalog.map((name) => ({ name, weightage: each }));
  }
  if (weights.length) await assertWeightsFitWeek(weights).catch(() => undefined);
  const klass = await prisma.class.upsert({
    where: { name_section: { name, section } },
    update: { archivedAt: null },
    create: { name, section },
  });
  const teacherId = (input.teacherId || "").trim();
  if (teacherId) {
    const teacher = await prisma.teacher.findUnique({ where: { id: teacherId }, select: { id: true } });
    if (teacher) {
      await prisma.teacher.update({ where: { id: teacherId }, data: { classId: klass.id } });
      await prisma.teacherClass.upsert({
        where: { teacherId_classId: { teacherId, classId: klass.id } },
        update: {},
        create: { teacherId, classId: klass.id },
      });
    }
  }
  for (const row of weights) {
    const existing = await prisma.subject.findFirst({ where: { classId: klass.id, name: row.name } });
    if (existing) {
      await prisma.subject.update({ where: { id: existing.id }, data: { weightage: row.weightage } });
    } else {
      await prisma.subject.create({ data: { classId: klass.id, name: row.name, weightage: row.weightage } });
    }
  }
}

export async function markAttendanceCore(
  user: AccessUser,
  input: { date: string; rows: { studentId: string; status: AttendanceStatus }[] }
) {
  need(user, "attendance.mark");
  const stamp = String(input.date || "").slice(0, 10);
  const todayLocal = ymd(new Date());
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (stamp > todayLocal && stamp > todayUtc) {
    throw new Error("Cannot mark a future date.");
  }
  const cal = await loadSchoolCalendar();
  const closed = closedReason(stamp, cal);
  if (closed) {
    throw new Error(
      /off$/i.test(closed) ? `${closed}. Attendance is not marked.` : `${closed} — school closed. Attendance is not marked.`
    );
  }
  const day = new Date(input.date);
  day.setHours(0, 0, 0, 0);
  for (const row of input.rows) {
    await prisma.attendance.upsert({
      where: { studentId_date: { studentId: row.studentId, date: day } },
      update: { status: row.status, markedById: user.id },
      create: { studentId: row.studentId, date: day, status: row.status, markedById: user.id },
    });
  }
}

async function staffDaysOnStamp(kind: "teacher" | "staff", id: string, stamp: string) {
  const { from, to } = staffDayWindow(stamp);
  const rows =
    kind === "teacher"
      ? await prisma.staffDay.findMany({ where: { teacherId: id, date: { gte: from, lte: to } } })
      : await prisma.staffDay.findMany({ where: { staffId: id, date: { gte: from, lte: to } } });
  return rows.filter((row) => staffDayYmd(row.date) === stamp);
}

async function findStaffDayOnStamp(kind: "teacher" | "staff", id: string, stamp: string) {
  const rows = await staffDaysOnStamp(kind, id, stamp);
  return rows.find((row) => row.inAt) || rows[0] || null;
}

async function deleteStaffDaysOnStamp(kind: "teacher" | "staff", id: string, stamp: string) {
  const rows = await staffDaysOnStamp(kind, id, stamp);
  if (!rows.length) return;
  await prisma.staffDay.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
}

async function writeStaffDayOnStamp(
  kind: "teacher" | "staff",
  id: string,
  stamp: string,
  data: {
    status: AttendanceStatus;
    markedById: string;
    inAt: string;
    outAt: string;
    startTimeUsed: string;
    computedStatus: AttendanceStatus | null;
    remark?: string;
  }
) {
  const instant = staffDayInstant(stamp);
  const rows = await staffDaysOnStamp(kind, id, stamp);
  const keep = rows.find((row) => row.inAt) || rows[0];
  const extras = rows.filter((row) => row.id !== keep?.id).map((row) => row.id);
  if (extras.length) await prisma.staffDay.deleteMany({ where: { id: { in: extras } } });
  if (keep) {
    await prisma.staffDay.update({
      where: { id: keep.id },
      data,
    });
    return;
  }
  if (kind === "teacher") {
    await prisma.staffDay.create({ data: { teacherId: id, date: instant, ...data } });
  } else {
    await prisma.staffDay.create({ data: { staffId: id, date: instant, ...data } });
  }
}

export async function markStaffAttendanceCore(
  user: AccessUser,
  input: {
    date: string;
    rows: {
      kind: "teacher" | "staff";
      id: string;
      status: AttendanceStatus;
      inAt?: string;
      outAt?: string;
      clear?: boolean;
    }[];
  }
) {
  need(user, "staff.edit");
  const stamp = String(input.date || "").slice(0, 10);
  if (stamp > staffDayYmd(new Date())) {
    throw new Error("Cannot mark a future date.");
  }
  const cal = await loadSchoolCalendar();
  const closed = closedReason(stamp, cal);
  if (closed) {
    throw new Error(
      /off$/i.test(closed) ? `${closed}. Attendance is not marked.` : `${closed} — school closed. Attendance is not marked.`
    );
  }
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const rules = parsePayrollRules(config?.payrollJson);
  const written: { kind: "teacher" | "staff"; id: string; date: string; status: AttendanceStatus; inAt: string }[] = [];
  for (const row of input.rows) {
    if (row.clear) {
      await deleteStaffDaysOnStamp(row.kind, row.id, stamp);
      written.push({ kind: row.kind, id: row.id, date: stamp, status: "ABSENT", inAt: "" });
      continue;
    }
    const next = classifyStaffDay(row.status, row.inAt, row.outAt, rules);
    await writeStaffDayOnStamp(row.kind, row.id, stamp, {
      status: next.status,
      markedById: user.id,
      inAt: next.inAt,
      outAt: next.outAt,
      startTimeUsed: next.startTimeUsed,
      computedStatus: next.computedStatus,
    });
    written.push({ kind: row.kind, id: row.id, date: stamp, status: next.status, inAt: next.inAt });
  }
  return { days: written };
}

function classifyStaffDay(
  rawStatus: AttendanceStatus,
  inAtRaw: string | undefined,
  outAtRaw: string | undefined,
  rules: PayrollRules
) {
  const inAt = normalizeHHmm(inAtRaw || "");
  const outAt = normalizeHHmm(outAtRaw || "");
  if (rawStatus === "LEAVE" || rawStatus === "ABSENT") {
    return { status: rawStatus, inAt, outAt, startTimeUsed: "", computedStatus: null as AttendanceStatus | null };
  }
  if (inAt) {
    const hit = classifyFromIn(inAt, rules.startTime, rules.graceMinutes);
    if (hit) {
      return {
        status: hit.status as AttendanceStatus,
        inAt,
        outAt,
        startTimeUsed: hit.startTimeUsed,
        computedStatus: hit.status as AttendanceStatus,
      };
    }
  }
  return {
    status: rawStatus,
    inAt,
    outAt,
    startTimeUsed: "",
    computedStatus: null as AttendanceStatus | null,
  };
}

const STAFF_MARKS = new Set<AttendanceStatus>(["PRESENT", "ABSENT", "LATE", "LEAVE", "HALF_DAY"]);

export async function correctStaffAttendanceCore(
  user: AccessUser,
  input: {
    kind: "teacher" | "staff";
    id: string;
    date: string;
    status: AttendanceStatus;
    reason: string;
    unlockApproved?: boolean;
  }
) {
  need(user, "staff.edit");
  const stamp = String(input.date || "").slice(0, 10);
  if (stamp > staffDayYmd(new Date())) throw new Error("Cannot mark a future date.");
  const status = STAFF_MARKS.has(input.status) ? input.status : null;
  if (!status) throw new Error("Pick a valid attendance status.");
  const reason = String(input.reason || "").trim();
  const cal = await loadSchoolCalendar();
  const closed = closedReason(stamp, cal);
  if (closed) {
    throw new Error(
      /off$/i.test(closed) ? `${closed}. Attendance is not marked.` : `${closed} — school closed. Attendance is not marked.`
    );
  }
  const key = personKey(input.kind, input.id);
  const month = stamp.slice(0, 7);
  const run = await prisma.staffPayrollRun.findUnique({ where: { personKey_month: { personKey: key, month } } });
  if (run && run.status !== "PENDING" && !input.unlockApproved) {
    throw new Error("This month is already approved. Confirm to change attendance.");
  }
  const existing = await findStaffDayOnStamp(input.kind, input.id, stamp);
  const fromStatus = existing?.status || "";
  if (fromStatus && fromStatus !== status && !reason) {
    throw new Error("Add a reason for this attendance correction.");
  }
  const computedStatus =
    fromStatus === "LATE" && status === "PRESENT"
      ? AttendanceStatus.LATE
      : existing?.computedStatus ?? null;
  const auditReason =
    fromStatus === "LATE" && status === "PRESENT" && reason
      ? `LATE→PRESENT: ${reason}`
      : reason || "Attendance recorded.";
  const patch = {
    status,
    markedById: user.id,
    remark: reason || existing?.remark || "",
    computedStatus,
  };
  await writeStaffDayOnStamp(input.kind, input.id, stamp, {
    ...patch,
    inAt: existing?.inAt || "",
    outAt: existing?.outAt || "",
    startTimeUsed: existing?.startTimeUsed || "",
  });
  if (fromStatus !== status) {
    await prisma.staffAttendanceAudit.create({
      data: {
        personKey: key,
        date: stamp,
        fromStatus: fromStatus || "UNMARKED",
        toStatus: status,
        reason: auditReason,
        actorId: user.id,
      },
    });
  }
  if (run && run.status !== "PENDING" && input.unlockApproved) {
    await prisma.staffPayrollRun.update({
      where: { id: run.id },
      data: { status: "PENDING", approvedAt: null, approvedById: null },
    });
  }
}

export async function saveStaffPayrollCore(
  user: AccessUser,
  input: {
    kind: "teacher" | "staff";
    id: string;
    month: string;
    status: "PENDING" | "APPROVED" | "PAID";
    salary: number;
    workingDays: number;
    payableDays: number;
    attendanceAdj: number;
    otherAdj?: number;
    finalAmount: number;
    snapshot?: Record<string, unknown>;
  }
) {
  need(user, "staff.edit");
  const month = String(input.month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Pick a month.");
  const key = personKey(input.kind, input.id);
  const nextStatus =
    input.status === "PAID" ? PayrollStatus.PAID : input.status === "APPROVED" ? PayrollStatus.APPROVED : PayrollStatus.PENDING;
  const existing = await prisma.staffPayrollRun.findUnique({ where: { personKey_month: { personKey: key, month } } });
  if (existing && existing.status !== "PENDING" && nextStatus === "PENDING") {
    // allow saving pending after unlock via attendance correction
  } else if (existing && existing.status === "APPROVED" && nextStatus === "APPROVED") {
    throw new Error("This payment is already approved.");
  } else if (existing && existing.status === "PAID") {
    throw new Error("This payment is already marked paid.");
  }
  await prisma.staffPayrollRun.upsert({
    where: { personKey_month: { personKey: key, month } },
    update: {
      status: nextStatus,
      salary: Math.round(input.salary),
      workingDays: Math.round(input.workingDays),
      payableDays: input.payableDays,
      attendanceAdj: Math.round(input.attendanceAdj),
      otherAdj: Math.round(input.otherAdj || 0),
      finalAmount: Math.round(input.finalAmount),
      snapshotJson: JSON.stringify(input.snapshot || {}),
      approvedAt: nextStatus === "PENDING" ? null : existing?.approvedAt || new Date(),
      approvedById: nextStatus === "PENDING" ? null : user.id,
    },
    create: {
      personKey: key,
      month,
      status: nextStatus,
      salary: Math.round(input.salary),
      workingDays: Math.round(input.workingDays),
      payableDays: input.payableDays,
      attendanceAdj: Math.round(input.attendanceAdj),
      otherAdj: Math.round(input.otherAdj || 0),
      finalAmount: Math.round(input.finalAmount),
      snapshotJson: JSON.stringify(input.snapshot || {}),
      approvedAt: nextStatus === "PENDING" ? null : new Date(),
      approvedById: nextStatus === "PENDING" ? null : user.id,
    },
  });
}

export async function createStaffMemberCore(
  user: AccessUser,
  input: {
    name: string;
    phone: string;
    roleId: string;
    joinedOn: string;
    password?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    managerId?: string | null;
    monthlySalary?: number | string;
  }
) {
  need(user, "staff.edit");
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Enter their name");
  const phone = normalizeMobile(input.phone);
  if (!phone) throw new Error("Enter a 10-digit mobile number");
  if (!input.roleId) throw new Error("Pick a role");
  const joinedOn = requireJoinedOn(input.joinedOn);
  const place = placeFields(input);
  const role = await prisma.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw new Error("Role missing");
  const email = (input.email || "").toLowerCase().trim();
  const password = (input.password || "").trim() || STAFF_FIRST_PASSWORD;
  if (email && role.portal === "STUDENT") {
    throw new Error("Add students from Students — they need a class.");
  }
  const title = role.name;
  const kind: StaffKind = role.portal === "OFFICE" ? "OFFICE" : role.portal === "TEACHER" ? "OTHER" : "SUPPORT";
  await assertPhoneFree(phone);
  const loginEmail = email || `${phone}@mobile.local`;
  const taken = await prisma.user.findUnique({ where: { email: loginEmail } });
  if (taken) throw new Error("That email is already in the school");
  const hash = await bcrypt.hash(password, 10);
  const managerId = await managerIdForNewUser(user, role, input.managerId);
  const monthlySalary = parseMonthlySalary(input.monthlySalary);
  if (role.portal === "TEACHER") {
    const employeeId = await nextEmployeeId("T");
    await prisma.user.create({
      data: {
        name,
        email: loginEmail,
        phone,
        password: hash,
        roleId: role.id,
        managerId,
        teacher: { create: { employeeId, joinedOn, monthlySalary, ...place } },
      },
    });
  } else if (role.portal === "PARENT") {
    await prisma.user.create({
      data: {
        name,
        email: loginEmail,
        phone,
        password: hash,
        roleId: role.id,
        parent: { create: { phone, ...place } },
      },
    });
  } else {
    const employeeId = await nextEmployeeId("S");
    await prisma.user.create({
      data: {
        name,
        email: loginEmail,
        phone,
        password: hash,
        roleId: role.id,
        managerId,
        staffMember: { create: { name, title, phone, kind, employeeId, roleId: role.id, joinedOn, monthlySalary, ...place } },
      },
    });
  }
}

const NOTICE_PORTALS = ["PARENT", "TEACHER", "STUDENT", "OFFICE"] as const;

export async function publishNoticeCore(
  user: AccessUser,
  input: {
    title: string;
    body: string;
    audience: string[];
    classIds?: string[];
    allClasses?: boolean;
    kind?: string;
  }
) {
  need(user, "notices.publish");
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) throw new Error("Give the notice a title");
  if (!body) throw new Error("Write the notice");
  const portals = [...new Set(input.audience)].filter((p): p is (typeof NOTICE_PORTALS)[number] =>
    NOTICE_PORTALS.includes(p as (typeof NOTICE_PORTALS)[number])
  );
  if (!portals.length) throw new Error("Pick who should see this");
  const classIds = input.allClasses ? [] : [...new Set((input.classIds || []).filter(Boolean))];
  if (!input.allClasses && !classIds.length) throw new Error("Pick a class, or All classes");
  const kind = isNoticeKind(String(input.kind || "")) ? input.kind : "CIRCULAR";
  const notice = await prisma.notice.create({
    data: {
      title,
      body,
      kind,
      priority: "INFO",
      authorId: user.id,
      audiences: { create: portals.map((portal) => ({ portal })) },
      classes: classIds.length ? { create: classIds.map((classId) => ({ classId })) } : undefined,
    },
  });
  void notifyNoticePublished({
    noticeId: notice.id,
    title,
    body,
    portals,
    classIds,
    authorId: user.id,
  }).catch(() => undefined);
}

export async function submitParentQueryCore(
  user: AccessUser,
  input: {
    studentId?: string;
    target?: string;
    subject?: string;
    message?: string;
  }
) {
  if (user.portal !== "PARENT") throw new Error("Only parents can send this.");
  const target = input.target === "teacher" ? "teacher" : "office";
  const subject = String(input.subject || "").trim();
  const message = String(input.message || "").trim();
  if (!subject) throw new Error("Add a short subject");
  if (!message) throw new Error("Write the query");

  const parent = await prisma.parent.findUnique({
    where: { userId: user.id },
    include: {
      students: {
        include: {
          class: {
            include: {
              teachers: { include: { user: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
  if (!parent?.students.length) throw new Error("No child is linked to this parent.");
  const child = parent.students.find((s) => s.id === input.studentId) || parent.students[0];
  const classLabel = `${child.class.name}-${child.class.section}`;
  const classTeacher = child.class.teachers[0]?.user.name || "Class teacher";
  const portals = target === "teacher" ? [Portal.TEACHER] : [Portal.OFFICE];
  const classIds = target === "teacher" ? [child.classId] : [];
  const title = target === "teacher" ? `Parent consult: ${subject}` : `Parent query: ${subject}`;
  const body =
    target === "teacher"
      ? `${child.name} · ${classLabel} · Parent: ${user.name}\nFor ${classTeacher}\n\n${message}`
      : `${child.name} · ${classLabel} · Parent: ${user.name}\n\n${message}`;

  const notice = await prisma.notice.create({
    data: {
      title,
      body,
      kind: "FEEDBACK",
      priority: "INFO",
      authorId: user.id,
      studentId: child.id,
      classes: classIds.length ? { create: classIds.map((classId) => ({ classId })) } : undefined,
      audiences: { create: portals.map((portal) => ({ portal })) },
    },
  });
  void notifyNoticePublished({
    noticeId: notice.id,
    title,
    body,
    portals,
    classIds,
    authorId: user.id,
  }).catch(() => undefined);
}

async function studentForParentQuery(notice: { studentId: string | null; body: string }) {
  if (notice.studentId) {
    return prisma.student.findUnique({
      where: { id: notice.studentId },
      include: { class: true, parent: { include: { user: true } } },
    });
  }
  const firstLine = notice.body.split("\n")[0] || "";
  const studentName = firstLine.split("·")[0]?.trim();
  if (!studentName) return null;
  return prisma.student.findFirst({
    where: { name: studentName },
    include: { class: true, parent: { include: { user: true } } },
  });
}

function cleanParentQuerySubject(title: string) {
  return title.replace(/^(Reply:|Parent (query|consult|reply):|Note ·)\s*/i, "").trim() || "General query";
}

function inboxStatusForBody(body: string) {
  const matches = [...body.matchAll(/Status:\s*(OPEN|WAITING|URGENT|CLOSED)/gi)];
  return matches.at(-1)?.[1]?.toUpperCase() || "OPEN";
}

async function activeParentThreadForReply(input: { originalId: string; studentId: string; subject: string }) {
  const rows = await prisma.notice.findMany({
    where: {
      kind: "FEEDBACK",
      studentId: input.studentId,
      title: {
        in: [`Parent query: ${input.subject}`, `Parent consult: ${input.subject}`],
      },
    },
    include: { audiences: true, classes: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.find((row) => row.id === input.originalId && inboxStatusForBody(row.body) !== "CLOSED")
    || rows.find((row) => inboxStatusForBody(row.body) !== "CLOSED")
    || null;
}

function normalizeMentionName(value: string) {
  return String(value || "")
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9 .'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function staffUsersMentionedIn(input: { authorId: string; internalNote: string; assignee: string }) {
  const candidates = await prisma.user.findMany({
    where: {
      id: { not: input.authorId },
      role: { portal: { in: [Portal.OFFICE, Portal.TEACHER] } },
    },
    select: { id: true, name: true },
  });
  const assignee = normalizeMentionName(input.assignee);
  const note = ` ${normalizeMentionName(input.internalNote)} `;
  const mentionText = ` ${String(input.internalNote || "")
    .toLowerCase()
    .replace(/[^@a-z0-9 .'-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  const mentioned = candidates
    .filter((candidate) => {
      const fullName = normalizeMentionName(candidate.name);
      if (!fullName) return false;
      const firstName = fullName.split(" ")[0] || fullName;
      return (
        assignee === fullName ||
        assignee.startsWith(`${fullName} `) ||
        mentionText.includes(`@${fullName} `) ||
        note.includes(` ${fullName} `) ||
        (firstName.length >= 3 && mentionText.includes(`@${firstName} `))
      );
    })
    .map((candidate) => candidate.id);
  return [...new Set(mentioned)];
}

export async function replyParentQueryCore(
  user: AccessUser,
  input: {
    noticeId?: string;
    reply?: string;
    internalNote?: string;
    status?: string;
    assignee?: string;
  }
) {
  need(user, "inbox.manage");
  const noticeId = String(input.noticeId || "");
  const reply = String(input.reply || "").trim();
  const internalNote = String(input.internalNote || "").trim();
  const status = String(input.status || "OPEN").toUpperCase();
  const assignee = String(input.assignee || "").trim();
  if (!noticeId) throw new Error("Pick a query.");
  if (!reply && !internalNote && !assignee && status === "OPEN") throw new Error("Write a reply, note, assignment, or status.");
  const original = await prisma.notice.findUnique({
    where: { id: noticeId },
    include: { audiences: true, classes: true },
  });
  if (!original || original.kind !== "FEEDBACK") throw new Error("Parent query not found.");
  const student = await studentForParentQuery(original);
  if (!student?.parent?.userId) throw new Error("Could not find the parent for this query.");
  if (user.portal === Portal.PARENT) {
    if (student.parent.userId !== user.id) throw new Error("No access to this message.");
    if (!reply) throw new Error("Write a reply to send to the school.");
    const subject = cleanParentQuerySubject(original.title);
    const activeThread = await activeParentThreadForReply({ originalId: original.id, studentId: student.id, subject });
    const now = new Date();
    const parentReplyEvent = `\n\n--- inbox:${now.toISOString()} ---\nParent replied: ${reply}`;
    if (activeThread) {
      await Promise.all([
        prisma.notice.update({
          where: { id: activeThread.id },
          data: { body: `${activeThread.body}${parentReplyEvent}` },
        }),
        original.id !== activeThread.id
          ? prisma.notice.update({
              where: { id: original.id },
              data: { body: `${original.body}${parentReplyEvent}` },
            })
          : Promise.resolve(),
      ]);
      void notifyNoticePublished({
        noticeId: activeThread.id,
        title: activeThread.title,
        body: reply,
        portals: [Portal.OFFICE, Portal.TEACHER],
        classIds: activeThread.classes.map((row) => row.classId),
        authorId: user.id,
      }).catch(() => undefined);
      return;
    }
    throw new Error("This chat is closed. Raise a new query to start a new issue.");
  }
  const now = new Date();
  const timeline = [
    "",
    `--- inbox:${now.toISOString()} ---`,
    `Status: ${status}`,
    assignee ? `Assigned: ${assignee}` : "",
    internalNote ? `Internal note: ${internalNote}` : "",
    reply ? `Reply sent by ${user.name || user.roleName}: ${reply}` : "",
  ].filter(Boolean).join("\n");
  await prisma.notice.update({
    where: { id: original.id },
    data: {
      priority: status === "CLOSED" ? "DONE" : status === "URGENT" ? "ACTION" : original.priority,
      body: `${original.body}\n${timeline}`,
    },
  });
  if (internalNote || assignee) {
    const mentionedUserIds = await staffUsersMentionedIn({ authorId: user.id, internalNote, assignee });
    if (mentionedUserIds.length) {
      const subject = cleanParentQuerySubject(original.title);
      const body = [
        `${user.name || user.roleName} mentioned you in ${subject}.`,
        `${student.name} · ${student.class.name}-${student.class.section} · Parent: ${student.parent.user.name}`,
        internalNote || (assignee ? `Assigned: ${assignee}` : ""),
      ].filter(Boolean).join("\n\n");
      const mentionNotice = await prisma.notice.create({
        data: {
          title: `Mentioned in ${subject}`,
          body,
          kind: "FEEDBACK",
          priority: "ACTION",
          authorId: user.id,
          studentId: student.id,
          recipients: { create: mentionedUserIds.map((userId) => ({ userId })) },
        },
      });
      void notifyNoticeRecipients({
        noticeId: mentionNotice.id,
        title: mentionNotice.title,
        body,
        userIds: mentionedUserIds,
      }).catch(() => undefined);
    }
  }
  if (reply) {
    const title = `Reply: ${original.title.replace(/^Parent (query|consult):\s*/i, "")}`;
    const body = `${student.name} · ${student.class.name}-${student.class.section} · From: ${user.name || user.roleName}\n\n${reply}`;
    const parentReply = await prisma.notice.create({
      data: {
        title,
        body,
        kind: "FEEDBACK",
        priority: "INFO",
        authorId: user.id,
        studentId: student.id,
        audiences: { create: [{ portal: Portal.PARENT }] },
      },
    });
    void notifyNoticePublished({
      noticeId: parentReply.id,
      title,
      body,
      portals: [Portal.PARENT],
      classIds: [],
      authorId: user.id,
    }).catch(() => undefined);
  }
}

function keepSecret(next: string | undefined, current?: string | null) {
  if (next === undefined) return current || "";
  return next.trim() || current || "";
}

function slugify(value: string) {
  return (value || "school").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "school";
}

function dataSafeSchoolSlug(value: string) {
  return slugify(value.replace(/\bschool\b/gi, "").trim() || value);
}

function cleanStringList(next: string | undefined, current: string | null | undefined, fallback: string[]) {
  const source = next === undefined ? current : next;
  try {
    const parsed = JSON.parse(source || "[]");
    if (Array.isArray(parsed)) {
      const values = parsed.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 12);
      return JSON.stringify(values.length ? values : fallback);
    }
  } catch {
    const values = String(source || "").split(/\n|,/).map((item) => item.trim()).filter(Boolean).slice(0, 12);
    return JSON.stringify(values.length ? values : fallback);
  }
  return JSON.stringify(fallback);
}

export async function saveSchoolIdentityCore(
  user: AccessUser,
  input: {
    name?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    phone?: string;
    email?: string;
    affiliation?: string;
    gstin?: string;
    pan?: string;
    sessionStart?: string;
    sessionEnd?: string;
    upiId?: string;
    bankName?: string;
    bankAccountName?: string;
    bankAccountNumber?: string;
    bankIfsc?: string;
    payGateway?: string;
    payTestMode?: boolean;
    razorpayKeyId?: string;
    razorpayKeySecret?: string;
    razorpayWebhookSecret?: string;
    cashfreeAppId?: string;
    cashfreeSecretKey?: string;
    billdeskMerchantId?: string;
    billdeskClientId?: string;
    billdeskSecret?: string;
    aisensyApiKey?: string;
    aisensyCampaign?: string;
    resendApiKey?: string;
    resendFromEmail?: string;
    signatory?: string;
    logoPath?: string;
    signPath?: string;
    stampPath?: string;
    invoiceStyle?: string;
    whatsappCommunityUrl?: string;
    websiteEnabled?: boolean;
    websiteSlug?: string;
    websiteTheme?: string;
    websiteHeroTitle?: string;
    websiteHeroSubtitle?: string;
    websiteAbout?: string;
    websiteHighlights?: string;
    websiteFacilities?: string;
    websiteGallery?: string;
    websiteAdmissionOpen?: boolean;
    websiteAdmissionNote?: string;
    admissionCharge?: number;
  }
) {
  need(user, "admissions.manage");
  const existing = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const schoolName = (input.name || existing?.name || "Anekio School").trim() || "Anekio School";
  const requestedWebsiteSlug =
    input.websiteSlug === undefined
      ? existing?.websiteSlug || dataSafeSchoolSlug(schoolName)
      : input.websiteSlug;
  const websiteSlug = validateSchoolWebsiteSlug(requestedWebsiteSlug);
  const slugOwner = await prisma.schoolConfig.findFirst({
    where: { websiteSlug, NOT: { id: "school" } },
    select: { id: true },
  });
  if (slugOwner) throw new Error("That website slug is already used by another school.");
  const payGateway = (PAY_GATEWAYS.some((g) => g.id === input.payGateway)
    ? input.payGateway
    : existing?.payGateway || "NONE") as PayGateway;
  const community = (input.whatsappCommunityUrl || "").trim();
  const schoolAsset = (next: string | undefined, current?: string | null) => {
    if (next === undefined) return current || "";
    const value = next.trim();
    if (value && !value.startsWith("school/")) throw new Error("Invalid school asset.");
    return value;
  };
  const data = {
    name: schoolName,
    address: (input.address || "").trim(),
    city: (input.city || "").trim(),
    state: (input.state || "").trim(),
    pincode: (input.pincode || "").trim(),
    phone: (input.phone || "").trim(),
    email: (input.email || "").trim(),
    affiliation: (input.affiliation || "").trim(),
    gstin: (input.gstin || "").trim(),
    pan: (input.pan || "").trim(),
    sessionStart: (input.sessionStart || "").trim(),
    sessionEnd: (input.sessionEnd || "").trim(),
    upiId: (input.upiId || "").trim(),
    bankName: (input.bankName || "").trim(),
    bankAccountName: (input.bankAccountName || "").trim(),
    bankAccountNumber: (input.bankAccountNumber || "").trim(),
    bankIfsc: (input.bankIfsc || "").trim().toUpperCase(),
    payGateway,
    payTestMode: payGateway === "NONE" ? existing?.payTestMode ?? true : Boolean(input.payTestMode),
    razorpayKeyId: keepSecret(input.razorpayKeyId, existing?.razorpayKeyId),
    razorpayKeySecret: keepSecret(input.razorpayKeySecret, existing?.razorpayKeySecret),
    razorpayWebhookSecret: keepSecret(input.razorpayWebhookSecret, existing?.razorpayWebhookSecret),
    cashfreeAppId: keepSecret(input.cashfreeAppId, existing?.cashfreeAppId),
    cashfreeSecretKey: keepSecret(input.cashfreeSecretKey, existing?.cashfreeSecretKey),
    billdeskMerchantId: keepSecret(input.billdeskMerchantId, existing?.billdeskMerchantId),
    billdeskClientId: keepSecret(input.billdeskClientId, existing?.billdeskClientId),
    billdeskSecret: keepSecret(input.billdeskSecret, existing?.billdeskSecret),
    aisensyApiKey: keepSecret(input.aisensyApiKey, existing?.aisensyApiKey),
    aisensyCampaign: keepSecret(input.aisensyCampaign, existing?.aisensyCampaign) || "fee_reminder",
    resendApiKey: keepSecret(input.resendApiKey, existing?.resendApiKey),
    resendFromEmail: (input.resendFromEmail ?? existing?.resendFromEmail ?? "").trim(),
    signatory: (input.signatory || "").trim(),
    logoPath: schoolAsset(input.logoPath, existing?.logoPath),
    signPath: schoolAsset(input.signPath, existing?.signPath),
    stampPath: schoolAsset(input.stampPath, existing?.stampPath),
    invoiceStyle: ["classic", "compact", "formal"].includes(input.invoiceStyle || "")
      ? input.invoiceStyle!
      : existing?.invoiceStyle || "classic",
    whatsappCommunityUrl: community ? normalizeWhatsAppGroupUrl(community) : "",
    websiteEnabled: input.websiteEnabled ?? existing?.websiteEnabled ?? false,
    websiteSlug,
    websiteTheme: ["blue", "green", "purple", "orange"].includes(input.websiteTheme || "") ? input.websiteTheme! : existing?.websiteTheme || "blue",
    websiteHeroTitle: (input.websiteHeroTitle || "").trim().slice(0, 120),
    websiteHeroSubtitle: (input.websiteHeroSubtitle || "").trim().slice(0, 260),
    websiteAbout: (input.websiteAbout || "").trim().slice(0, 1200),
    websiteHighlights: cleanStringList(input.websiteHighlights, existing?.websiteHighlights, ["CBSE aligned learning", "Safe campus", "Smart parent updates", "Admissions open"]),
    websiteFacilities: cleanStringList(input.websiteFacilities, existing?.websiteFacilities, ["Digital classrooms", "Library", "Computer lab", "Sports", "Transport"]),
    websiteGallery: cleanStringList(input.websiteGallery, existing?.websiteGallery, []),
    websiteAdmissionOpen: input.websiteAdmissionOpen ?? existing?.websiteAdmissionOpen ?? true,
    websiteAdmissionNote: (input.websiteAdmissionNote || "").trim().slice(0, 300),
    admissionCharge: Math.max(0, Math.round(Number(input.admissionCharge ?? existing?.admissionCharge ?? 0))),
  };
  if (data.sessionStart && data.sessionEnd && data.sessionEnd < data.sessionStart) {
    throw new Error("Session end must be after session start.");
  }
  await prisma.schoolConfig.upsert({
    where: { id: "school" },
    update: data,
    create: { id: "school", weekdays: "[1,2,3,4,5,6]", ...data },
  });
  if (data.sessionStart && data.sessionEnd) {
    await syncCurrentSessionDates(data.sessionStart, data.sessionEnd);
  }
  await ensureVercelSchoolWebsiteDomain(data.websiteSlug, { enabled: data.websiteEnabled, logger: console });
}

export async function saveSchoolWebsiteCore(
  user: AccessUser,
  input: {
    websiteEnabled?: boolean;
    websiteSlug?: string;
    websiteTheme?: string;
    websiteHeroTitle?: string;
    websiteHeroSubtitle?: string;
    websiteAbout?: string;
    websiteHighlights?: string;
    websiteFacilities?: string;
    websiteGallery?: string;
    websiteAdmissionOpen?: boolean;
    websiteAdmissionNote?: string;
  }
) {
  need(user, "admissions.manage");
  const existing = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const schoolName = (existing?.name || "Anekio School").trim() || "Anekio School";
  const requestedWebsiteSlug =
    input.websiteSlug === undefined
      ? existing?.websiteSlug || dataSafeSchoolSlug(schoolName)
      : input.websiteSlug;
  const websiteSlug = validateSchoolWebsiteSlug(requestedWebsiteSlug);
  const slugOwner = await prisma.schoolConfig.findFirst({
    where: { websiteSlug, NOT: { id: "school" } },
    select: { id: true },
  });
  if (slugOwner) throw new Error("That website slug is already used by another school.");

  const data = {
    websiteEnabled: input.websiteEnabled ?? existing?.websiteEnabled ?? false,
    websiteSlug,
    websiteTheme: ["blue", "green", "purple", "orange"].includes(input.websiteTheme || "")
      ? input.websiteTheme!
      : existing?.websiteTheme || "blue",
    websiteHeroTitle: input.websiteHeroTitle === undefined ? existing?.websiteHeroTitle || "" : input.websiteHeroTitle.trim().slice(0, 120),
    websiteHeroSubtitle: input.websiteHeroSubtitle === undefined ? existing?.websiteHeroSubtitle || "" : input.websiteHeroSubtitle.trim().slice(0, 260),
    websiteAbout: input.websiteAbout === undefined ? existing?.websiteAbout || "" : input.websiteAbout.trim().slice(0, 1200),
    websiteHighlights: cleanStringList(input.websiteHighlights, existing?.websiteHighlights, ["CBSE aligned learning", "Safe campus", "Smart parent updates", "Admissions open"]),
    websiteFacilities: cleanStringList(input.websiteFacilities, existing?.websiteFacilities, ["Digital classrooms", "Library", "Computer lab", "Sports", "Transport"]),
    websiteGallery: cleanStringList(input.websiteGallery, existing?.websiteGallery, []),
    websiteAdmissionOpen: input.websiteAdmissionOpen ?? existing?.websiteAdmissionOpen ?? true,
    websiteAdmissionNote: input.websiteAdmissionNote === undefined ? existing?.websiteAdmissionNote || "" : input.websiteAdmissionNote.trim().slice(0, 300),
  };

  await prisma.schoolConfig.upsert({
    where: { id: "school" },
    update: data,
    create: { id: "school", name: schoolName, weekdays: "[1,2,3,4,5,6]", ...data },
  });
  await ensureVercelSchoolWebsiteDomain(data.websiteSlug, { enabled: data.websiteEnabled, logger: console });
  return { website: { enabled: data.websiteEnabled, slug: data.websiteSlug } };
}

export async function saveAdmissionFormCore(user: AccessUser, input: { fields?: unknown }) {
  needSchoolScope(user, "admissions.manage");
  const fields = admissionFormJson(input.fields);
  await prisma.schoolConfig.upsert({
    where: { id: "school" },
    update: { admissionFormJson: fields },
    create: { id: "school", admissionFormJson: fields },
  });
}

export async function createAdmissionLeadCore(user: AccessUser, input: Record<string, unknown>) {
  needSchoolScope(user, "admissions.manage");
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const values = admissionLeadInput(config?.admissionFormJson, input);
  const actorName = user.name || "School office";
  const customSummary = values.fields
    .filter((field) => !field.builtin && values.customValues[field.id])
    .map((field) => `${field.label}: ${values.customValues[field.id]}`)
    .join("\n");
  const lead = await prisma.admissionLead.create({
    data: {
      studentName: values.studentName,
      guardianName: values.guardianName,
      phone: values.phone,
      email: values.email,
      classWanted: values.classWanted,
      message: values.message,
      customFieldsJson: JSON.stringify(values.customValues),
      source: "walk_in",
      events: {
        create: {
          kind: "NEW",
          title: "Walk-in lead added",
          body: [values.classWanted ? `Class interested: ${values.classWanted}` : "", customSummary].filter(Boolean).join("\n"),
          actorName,
        },
      },
    },
  });
  return { leadId: lead.id };
}

export async function updateAdmissionLeadCore(
  user: AccessUser,
  input: {
    id?: string;
    studentName?: string;
    guardianName?: string;
    phone?: string;
    email?: string;
    classWanted?: string;
    message?: string;
    status?: string;
    followUpAt?: string;
    notes?: string;
    eventKind?: string;
    eventTitle?: string;
    eventBody?: string;
    remark?: string;
    disposition?: string;
  }
) {
  need(user, "admissions.manage");
  const id = String(input.id || "");
  if (!id) throw new Error("Lead missing.");
  const existing = await prisma.admissionLead.findUnique({ where: { id } });
  if (!existing) throw new Error("Lead not found.");
  const allowed = new Set(["NEW", "CONTACTED", "FOLLOW_UP", "TEST", "SELECTED", "ADMITTED", "REJECTED", "DISPOSED"]);
  const data: {
    studentName?: string;
    guardianName?: string;
    phone?: string;
    email?: string;
    classWanted?: string;
    message?: string;
    status?: string;
    followUpAt?: string;
    notes?: string;
  } = {};
  if (input.status !== undefined) {
    const status = String(input.status || "NEW").toUpperCase();
    if (!allowed.has(status)) throw new Error("Invalid lead status.");
    if (status === "ADMITTED" && existing.status !== "ADMITTED") {
      throw new Error("Complete the admission details and payment before admitting this lead.");
    }
    data.status = status;
  }
  if (input.studentName !== undefined) data.studentName = String(input.studentName || "").trim().slice(0, 120);
  if (input.guardianName !== undefined) data.guardianName = String(input.guardianName || "").trim().slice(0, 120);
  if (input.phone !== undefined) data.phone = String(input.phone || "").trim().slice(0, 30);
  if (input.email !== undefined) data.email = String(input.email || "").trim().slice(0, 160);
  if (input.classWanted !== undefined) data.classWanted = String(input.classWanted || "").trim().slice(0, 80);
  if (input.message !== undefined) data.message = String(input.message || "").trim().slice(0, 800);
  if (input.followUpAt !== undefined) data.followUpAt = String(input.followUpAt || "").trim().slice(0, 20);
  if (input.notes !== undefined) data.notes = String(input.notes || "").trim().slice(0, 2000);
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { admissionFormJson: true } });
  const requiredBuiltin = admissionFormFields(config?.admissionFormJson).filter((field) => field.builtin && field.visible && field.required);
  for (const field of requiredBuiltin) {
    const value = String((data as Record<string, unknown>)[field.id] ?? (existing as unknown as Record<string, unknown>)[field.id] ?? "").trim();
    if (!value) throw new Error(`${field.label} is required.`);
  }

  const events: { kind: string; title: string; body?: string; actorName: string }[] = [];
  const actorName = user.name || "School office";
  const changes = Object.entries(data).filter(([key, value]) => value !== (existing as Record<string, unknown>)[key]);
  const fieldLabels: Record<string, string> = {
    studentName: "Student name",
    guardianName: "Guardian name",
    phone: "Phone number",
    email: "Email",
    classWanted: "Class interested",
    message: "Enquiry message",
    notes: "Office notes",
    status: "Lead stage",
    followUpAt: "Follow-up",
  };
  const fieldOrder = ["studentName", "guardianName", "phone", "email", "classWanted", "message", "status", "followUpAt", "notes"];
  const formatValue = (value: unknown) => String(value ?? "").trim() || "-";
  const statusName = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
  const orderedChanges = changes
    .filter(([key]) => fieldLabels[key])
    .sort(([left], [right]) => fieldOrder.indexOf(left) - fieldOrder.indexOf(right));
  const changeLines = orderedChanges
    .map(([key, value]) => {
      const before = key === "status" ? statusName(existing.status) : formatValue((existing as Record<string, unknown>)[key]);
      const after = key === "status" ? statusName(String(value)) : formatValue(value);
      return `${fieldLabels[key]}\n${before} -> ${after}`;
    });
  const eventTitle = String(input.eventTitle || "").trim().slice(0, 160);
  if (eventTitle) {
    events.push({
      kind: String(input.eventKind || "ACTION").trim().toUpperCase().slice(0, 40),
      title: eventTitle,
      body: String(input.eventBody || "").trim().slice(0, 1000),
      actorName,
    });
  }
  const remark = String(input.remark || "").trim().slice(0, 1000);
  if (remark) {
    changeLines.push(`Remark\n${remark}`);
  }
  if (changeLines.length && !eventTitle) {
    const changedLabels = orderedChanges.map(([key]) => fieldLabels[key]);
    events.push({
      kind: String(input.eventKind || "UPDATE").trim().toUpperCase().slice(0, 40),
      title: changedLabels.length ? `Updated ${changedLabels.join(", ")}` : "Remark added",
      body: changeLines.join("\n\n"),
      actorName,
    });
  } else if (remark) {
    const kind = String(input.eventKind || "NOTE").trim().toUpperCase().slice(0, 40);
    const disposition = String(input.disposition || "").trim().slice(0, 120);
    events.push({
      kind,
      title: disposition || (kind === "CALL" ? "Call remark added" : kind === "WHATSAPP" ? "WhatsApp remark added" : "Remark added"),
      body: remark,
      actorName,
    });
  }

  await prisma.$transaction([
    prisma.admissionLead.update({ where: { id }, data }),
    ...events.map((event) => prisma.admissionLeadEvent.create({ data: { leadId: id, ...event } })),
  ]);
}

export async function saveTimetableSlotCore(
  user: AccessUser,
  input: {
    classId: string;
    periodId: string;
    weekday: number;
    teacherId?: string | null;
    subjectId?: string | null;
    subjectName?: string;
    clear?: boolean;
  }
) {
  const { classId, periodId, weekday } = input;
  need(user, "timetable.edit");
  if (scopeFor(user, "timetable.edit") === "REPORTS") {
    const team = await teamClassIds(user.id);
    if (!team.includes(classId)) throw new Error("No access.");
  }
  let subjectId = input.subjectId || null;
  const teacherId = input.teacherId || null;
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const days = parseWeekdays(config?.weekdays);
  if (!days.includes(weekday)) throw new Error("School is closed that day");
  const period = await prisma.period.findUnique({ where: { id: periodId } });
  if (!period) throw new Error("Period missing");
  if (input.clear || (!subjectId && !input.subjectName && !teacherId)) {
    await prisma.timetableSlot.deleteMany({ where: { classId, periodId, weekday } });
    return { ok: true as const };
  }
  if (period.isBreak) throw new Error("A break cannot take a lesson.");
  if (teacherId && (input.subjectName || subjectId)) {
    let name = input.subjectName || "";
    if (!name && subjectId) {
      const existing = await prisma.subject.findUnique({ where: { id: subjectId } });
      name = existing?.name ?? "";
    }
    if (name) {
      const skill = await prisma.teacherSkill.findUnique({
        where: { teacherId_subjectName_classId: { teacherId, subjectName: name, classId } },
      });
      if (!skill) throw new Error("This teacher is not assigned that subject for this class.");
      const found = await prisma.subject.findFirst({ where: { classId, name } });
      const subject = found
        ? await prisma.subject.update({ where: { id: found.id }, data: { teacherId } })
        : await prisma.subject.create({ data: { name, classId, teacherId } });
      subjectId = subject.id;
    }
  }
  if (teacherId) {
    const busy = await prisma.timetableSlot.findFirst({
      where: { teacherId, periodId, weekday, NOT: { classId } },
    });
    if (busy) throw new Error("This teacher is already in another class this period.");
  }
  await prisma.timetableSlot.upsert({
    where: { classId_periodId_weekday: { classId, periodId, weekday } },
    update: { subjectId, teacherId },
    create: { classId, periodId, weekday, subjectId, teacherId },
  });
  return { ok: true as const };
}

function parsePayMethod(raw?: string) {
  return (
    ["CASH", "UPI", "RAZORPAY", "BANK", "CHEQUE"].includes(raw || "") ? raw : "CASH"
  ) as PaymentMethod;
}

function assertPayRefs(method: PaymentMethod, reference: string | null) {
  if ((method === "UPI" || method === "BANK") && !reference) {
    throw new Error("Enter the UTR / reference number");
  }
  if (method === "CHEQUE" && !reference) {
    throw new Error("Enter the cheque number");
  }
}

function paymentAuditNote(user: AccessUser, input: { collectedBy?: string; notes?: string }) {
  const receivedBy = String(input.collectedBy || user.name || user.email || "School office").trim();
  const note = String(input.notes || "").trim();
  return note ? `Collected by: ${receivedBy}; Note: ${note}` : `Collected by: ${receivedBy}`;
}

export async function collectFeeCore(
  user: AccessUser,
  input: { invoiceId: string; amount?: number; method?: string; reference?: string; notes?: string; proofPath?: string; collectedBy?: string }
) {
  need(user, "fees.collect");
  const invoice = await prisma.feeInvoice.findUnique({
    where: { id: input.invoiceId },
    include: { payments: true },
  });
  if (!invoice) throw new Error("Invoice missing");
  const due = invoiceBalance(invoice).dueNow;
  const amount = Math.round(Number(input.amount || due));
  if (amount <= 0) throw new Error("Invalid payment");
  const method = parsePayMethod(input.method);
  const providedReference = String(input.reference || "").trim() || null;
  assertPayRefs(method, providedReference);
  const reference = providedReference || `RCPT-${invoice.id.slice(-8).toUpperCase()}`;
  await recordLedgerPayment({
    invoiceId: invoice.id,
    amount,
    method,
    reference,
    proofPath: String(input.proofPath || "").trim() || null,
    notes: paymentAuditNote(user, input),
  });
}

export async function collectPartialFeesCore(
  user: AccessUser,
  input: {
    studentId: string;
    invoiceIds?: string[];
    method?: string;
    reference?: string;
    notes?: string;
    proofPath?: string;
    collectedBy?: string;
  }
) {
  need(user, "fees.collect");
  const studentId = String(input.studentId || "");
  const invoiceIds = [...new Set((input.invoiceIds || []).map(String).filter(Boolean))];
  if (!studentId) throw new Error("Student required");
  if (!invoiceIds.length) throw new Error("Pick the months to collect");
  const method = parsePayMethod(input.method);
  if (method === "RAZORPAY") {
    throw new Error("Use the pay link so the parent can pay themselves");
  }
  const reference = String(input.reference || "").trim() || null;
  const notes = paymentAuditNote(user, input);
  assertPayRefs(method, reference);
  const invoices = await prisma.feeInvoice.findMany({
    where: { studentId, id: { in: invoiceIds } },
    include: { payments: true },
    orderBy: { dueDate: "asc" },
  });
  const open = invoices
    .map((inv) => ({ inv, dueNow: invoiceBalance(inv).dueNow }))
    .filter((row) => row.dueNow > 0);
  if (!open.length) throw new Error("Those months are already paid");
  const receiptBase = reference || `RCPT-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  for (const row of open) {
    await recordLedgerPayment({
      invoiceId: row.inv.id,
      amount: row.dueNow,
      method,
      reference: `${receiptBase}:${row.inv.id.slice(-8)}`,
      proofPath: String(input.proofPath || "").trim() || null,
      notes,
    });
  }
}

export async function issueDueFeesCoreApi(user: AccessUser, input: { classId?: string }) {
  need(user, "fees.collect");
  const { current } = await ensureSchoolSessions();
  if (input.classId) {
    const period = feePeriod(new Date().getFullYear(), new Date().getMonth());
    const template = await prisma.feeTemplate.findFirst({
      where: {
        classId: input.classId,
        sessionId: current.id,
        startsPeriod: { lte: period },
        endsPeriod: { gte: period },
      },
      include: { lines: true },
    });
    if (!template?.lines.length) throw new Error(`Please create a fee template for ${period} before creating fees.`);
  }
  return issueDueFeesCore(new Date(), input.classId || undefined, current.id);
}

export async function enterMarksCore(
  user: AccessUser,
  input: { examId: string; studentId: string; marks: number; remarks?: string }
) {
  need(user, "marks.enter", "exams.edit");
  if (!input.examId || !input.studentId || Number.isNaN(input.marks)) throw new Error("Invalid marks");
  const exam = await prisma.exam.findUnique({ where: { id: input.examId }, include: { evaluators: true } });
  if (!exam) throw new Error("Exam not found");
  if (user.portal === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({ where: { userId: user.id } });
    if (!teacherMayEnterMarks(exam, teacher?.id)) {
      throw new Error("Office must allow marks entry on this paper first.");
    }
    if (!teacherCanEditMarks(exam.workflowStatus)) {
      throw new Error("Marks are locked. Wait for admin to send this paper back if a correction is needed.");
    }
  }
  if (exam.workflowStatus === "PUBLISHED") throw new Error("Published results cannot be edited.");
  const student = await prisma.student.findUnique({ where: { id: input.studentId }, select: { classId: true, name: true } });
  if (!student || student.classId !== exam.classId) throw new Error("That student is not in this class.");
  validateExamMark(Number(input.marks), exam.maxMarks, student.name);
  await prisma.examResult.upsert({
    where: { examId_studentId: { examId: input.examId, studentId: input.studentId } },
    update: { marks: input.marks, remarks: input.remarks || null },
    create: { examId: input.examId, studentId: input.studentId, marks: input.marks, remarks: input.remarks || null },
  });
}

export async function hostExamCore(
  user: AccessUser,
  input: { title: string; subjectId: string; classId: string; date: string; maxMarks?: number }
) {
  need(user, "exams.edit", "exams.teach");
  const classId = String(input.classId || "");
  const subjectId = String(input.subjectId || "");
  const title = String(input.title || "").trim() || "Exam";
  const day = String(input.date || "").slice(0, 10);
  if (!classId || !subjectId || !day) throw new Error("Title, subject, class and date are required");
  const teacher =
    user.portal === "TEACHER" ? await prisma.teacher.findUnique({ where: { userId: user.id } }) : null;
  if (user.portal === "TEACHER" && (!teacher?.classId || teacher.classId !== classId)) {
    throw new Error("Not your class");
  }
  const [klass, subject] = await Promise.all([
    prisma.class.findUnique({ where: { id: classId }, select: { name: true, section: true } }),
    prisma.subject.findUnique({ where: { id: subjectId }, select: { name: true } }),
  ]);
  if (!klass || !subject) throw new Error("Class or subject missing");
  await prisma.exam.create({
    data: {
      title,
      subjectId,
      classId,
      date: new Date(day),
      maxMarks: Number(input.maxMarks || 40),
      teacherId: teacher?.id || null,
      setterId: teacher?.id || null,
      workflowStatus: "SCHEDULED",
    },
  });
  const label = `${klass.name}-${klass.section}`;
  const pretty = new Date(`${day}T00:00:00`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
  const body = `${user.name} added ${title} · ${subject.name} for ${label} on ${pretty}.`;
  const portals = ["PARENT", "STUDENT", "TEACHER"] as const;
  const notice = await prisma.notice.create({
    data: {
      title: `${title} · ${label}`,
      body,
      kind: "EXAM",
      priority: "HIGH",
      authorId: user.id,
      audiences: { create: portals.map((portal) => ({ portal })) },
      classes: { create: [{ classId }] },
    },
  });
  void notifyNoticePublished({
    noticeId: notice.id,
    title: notice.title,
    body,
    portals: [...portals],
    classIds: [classId],
    authorId: user.id,
  }).catch(() => undefined);
}

export async function ensureInvoiceShareTokenCore(user: AccessUser, invoiceId: string) {
  need(user, "fees.collect", "fees.pay");
  const existing = await prisma.feeInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      shareToken: true,
      student: { select: { userId: true, parent: { select: { userId: true } } } },
    },
  });
  if (!existing) throw new Error("Invoice missing");
  if (user.portal === "PARENT" && existing.student.parent.userId !== user.id) throw new Error("Invoice missing");
  if (user.portal === "STUDENT" && existing.student.userId !== user.id) throw new Error("Invoice missing");
  if (existing.shareToken) return existing.shareToken;
  const shareToken = randomUUID();
  await prisma.feeInvoice.update({ where: { id: invoiceId }, data: { shareToken } });
  return shareToken;
}

export async function ensurePayerPayLinkCore(
  user: AccessUser,
  input: { studentId: string; invoiceIds: string[] }
) {
  need(user, "fees.pay", "fees.collect");
  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    select: { id: true, userId: true, parent: { select: { userId: true } } },
  });
  if (!student) throw new Error("Student missing");
  if (user.portal === "PARENT" && student.parent.userId !== user.id) throw new Error("Student missing");
  if (user.portal === "STUDENT" && student.userId !== user.id) throw new Error("Student missing");
  if (user.portal === "TEACHER") throw new Error("No access.");
  return buildStudentMonthPayPath(student.id, input.invoiceIds, {
    forceOlderPrefix: user.portal === "PARENT" || user.portal === "STUDENT",
  });
}

export async function sendStudentPayLinkCore(
  user: AccessUser,
  input: { studentId: string; invoiceIds: string[]; channel: PayShareChannelId }
) {
  need(user, "fees.collect");
  const invoiceIds = [...new Set((input.invoiceIds || []).map(String).filter(Boolean))];
  const { path } = await buildStudentMonthPayPath(input.studentId, invoiceIds);
  const payUrl = `${publicOrigin()}${path}`;
  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    include: {
      parent: { include: { user: true } },
      feeInvoices: { include: { payments: true } },
    },
  });
  if (!student) throw new Error("Student missing");
  const wanted = new Set(invoiceIds);
  const picked = student.feeInvoices
    .filter((inv) => wanted.has(inv.id))
    .sort((a, b) => +a.dueDate - +b.dueDate);
  if (!picked.length) throw new Error("Pick the months for this pay link");
  const range = payRangeLabel(picked.map((inv) => inv.title));
  const dueNow = picked.reduce((sum, inv) => sum + invoiceBalance(inv).dueNow, 0);
  const channels = await getPayShareChannels();

  if (input.channel === "whatsapp") {
    if (!channels.whatsapp) {
      throw new Error("Connect the school's AiSensy key in Admin → School → Communication");
    }
    await sendAisensyWhatsApp({
      phone: student.parent.phone,
      userName: student.parent.user.name || student.name,
      params: [student.name, range, String(dueNow), payUrl],
    });
  } else {
    if (!channels.email) {
      throw new Error("Connect the school's Resend key in Admin → School → Communication");
    }
    await sendResendEmail({
      to: student.parent.user.email,
      studentName: student.name,
      title: range,
      amount: String(dueNow),
      payUrl,
    });
  }

  const via = input.channel === "whatsapp" ? "WhatsApp" : "email";
  await prisma.feeReminder.createMany({
    data: picked.map((inv) => ({
      invoiceId: inv.id,
      message: `${student.name}: ${inv.title} pay link sent · ${via}`,
    })),
  });
}

export async function setRolePermissionsCore(
  user: AccessUser,
  input: { roleId: string; changes: { permission: string; on: boolean; scope?: string }[] }
) {
  need(user, "roles.manage");
  if (!input.roleId || !input.changes.length) throw new Error("Nothing to change");
  const role = await prisma.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw new Error("Role missing");
  const allowed = new Set<string>(permissionsForPortal(role.portal).map((p) => p.key));
  const existing = new Map(
    (await prisma.roleGrant.findMany({ where: { roleId: input.roleId } })).map((grant) => [grant.permission, grant])
  );
  const prepared: { permission: string; on: boolean; scope?: AccessScope }[] = [];
  for (const change of input.changes) {
    if (!allowed.has(change.permission) || !PERMISSION_KEYS.includes(change.permission as (typeof PERMISSION_KEYS)[number])) {
      throw new Error("Unknown permission");
    }
    if (!change.on && role.slug === "ADMIN" && LOCKED_KEYS.includes(change.permission as (typeof LOCKED_KEYS)[number])) {
      throw new Error("Admin must keep roles, or nobody can open this screen.");
    }
    if (change.on) {
      const current = existing.get(change.permission);
      const scope = String(
        change.scope ||
          current?.scope ||
          (role.slug === "ADMIN" && validScopeFor(change.permission, "SCHOOL", role.portal)
            ? "SCHOOL"
            : scopePolicyFor(change.permission, role.portal).defaultScope)
      );
      if (!validScopeFor(change.permission, scope, role.portal)) {
        throw new Error("That scope is not available for this permission.");
      }
      prepared.push({ permission: change.permission, on: true, scope });
    } else {
      prepared.push({ permission: change.permission, on: false });
    }
  }
  await prisma.$transaction(async (tx) => {
    for (const change of prepared) {
      if (change.on && change.scope) {
        await tx.roleGrant.upsert({
          where: { roleId_permission: { roleId: input.roleId, permission: change.permission } },
          update: { scope: change.scope },
          create: { roleId: input.roleId, permission: change.permission, scope: change.scope },
        });
      } else {
        await tx.roleGrant.deleteMany({ where: { roleId: input.roleId, permission: change.permission } });
      }
    }
  });
}

export async function createCustomRoleCore(user: AccessUser, input: { name: string; fromId?: string }) {
  need(user, "roles.manage");
  const name = input.name.trim();
  const fromId = (input.fromId || "").trim();
  if (!name) throw new Error("Give the role a name");
  let slug = slugFromName(name);
  const taken = await prisma.role.findUnique({ where: { slug } });
  if (taken) slug = `${slug}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const from = fromId
    ? await prisma.role.findUnique({ where: { id: fromId }, include: { grants: true } })
    : null;
  if (from && from.portal !== "OFFICE") throw new Error("Copy from an office role");
  const allowed = new Set<string>(permissionsForPortal("OFFICE").map((permission) => permission.key));
  const grants = from?.grants.length
    ? from.grants
        .filter((grant) => allowed.has(grant.permission))
        .map((grant) => ({
          permission: grant.permission,
          scope: validScopeFor(grant.permission, String(grant.scope || ""), "OFFICE")
            ? grant.scope!
            : scopePolicyFor(grant.permission, "OFFICE").defaultScope,
        }))
    : [{ permission: "desk.view", scope: scopePolicyFor("desk.view", "OFFICE").defaultScope }];
  await prisma.role.create({
    data: {
      name,
      slug,
      portal: "OFFICE",
      isSystem: false,
      description: from ? `Copied from ${from.name}` : "Custom office role",
      grants: { create: grants },
    },
  });
}

export async function deleteCustomRoleCore(user: AccessUser, input: { roleId: string }) {
  need(user, "roles.manage");
  const role = await prisma.role.findUnique({
    where: { id: input.roleId },
    include: { _count: { select: { users: true } } },
  });
  if (!role) throw new Error("Role missing");
  if (role.isSystem) throw new Error("System roles stay");
  if (role._count.users) throw new Error("Move people off this role first");
  await prisma.role.delete({ where: { id: input.roleId } });
}

export async function assignOfficeUserCore(user: AccessUser, input: { userId: string; roleId: string }) {
  need(user, "roles.manage");
  const person = await prisma.user.findUnique({ where: { id: input.userId }, include: { role: true } });
  const role = await prisma.role.findUnique({ where: { id: input.roleId } });
  if (!person || person.role.portal !== "OFFICE") throw new Error("Pick someone in the office");
  if (!role || role.portal !== "OFFICE") throw new Error("Pick an office role");
  if (person.role.slug === "ADMIN" && role.slug !== "ADMIN") {
    const admins = await prisma.user.count({ where: { role: { slug: "ADMIN" } } });
    if (admins <= 1) throw new Error("Keep at least one Admin");
  }
  await prisma.user.update({ where: { id: input.userId }, data: { roleId: input.roleId } });
}

export async function copyRoleAccessCore(user: AccessUser, input: { roleId: string; fromId: string }) {
  need(user, "roles.manage");
  if (!input.roleId || !input.fromId || input.roleId === input.fromId) {
    throw new Error("Pick a different role to copy from");
  }
  const [role, from] = await Promise.all([
    prisma.role.findUnique({ where: { id: input.roleId } }),
    prisma.role.findUnique({ where: { id: input.fromId }, include: { grants: true } }),
  ]);
  if (!role || !from) throw new Error("Role missing");
  if (role.portal !== from.portal) throw new Error("Copy from the same kind of login");
  const allowed = new Set<string>(permissionsForPortal(role.portal).map((p) => p.key));
  const keep: string[] = role.slug === "ADMIN" ? [...LOCKED_KEYS] : [];
  const next = from.grants.filter((g) => allowed.has(g.permission) && !keep.includes(g.permission));
  const prepared = next.map((grant) => ({
    roleId: input.roleId,
    permission: grant.permission,
    scope: validScopeFor(grant.permission, String(grant.scope || ""), role.portal)
      ? grant.scope!
      : scopePolicyFor(grant.permission, role.portal).defaultScope,
  }));
  await prisma.$transaction(async (tx) => {
    await tx.roleGrant.deleteMany({
      where: {
        roleId: input.roleId,
        ...(role.slug === "ADMIN" ? { permission: { notIn: [...LOCKED_KEYS] } } : {}),
      },
    });
    if (prepared.length) await tx.roleGrant.createMany({ data: prepared });
  });
}

export async function createOfficeUserCore(
  user: AccessUser,
  input: { name: string; email: string; roleId: string; password?: string }
) {
  need(user, "roles.manage");
  const name = input.name.trim();
  const email = input.email.toLowerCase().trim();
  if (!name || !email || !input.roleId) throw new Error("Name, email, and role are required");
  const role = await prisma.role.findUnique({ where: { id: input.roleId } });
  if (!role || role.portal !== "OFFICE") throw new Error("Pick an office role");
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw new Error("That email is already in the school");
  await prisma.user.create({
    data: {
      name,
      email,
      password: await bcrypt.hash(input.password || "office123", 10),
      roleId: input.roleId,
      managerId: await defaultManagerIdForRole(role.slug, role.portal),
    },
  });
}

export async function saveSchoolSubjectsCore(
  user: AccessUser,
  input: { names?: string[]; applyToAllClasses?: boolean }
) {
  need(user, "school.edit");
  const names = [...new Set((input.names || []).map((s) => String(s || "").trim()).filter(Boolean))];
  if (!names.length) throw new Error("Add at least one subject.");
  await prisma.schoolConfig.upsert({
    where: { id: "school" },
    update: { subjectCatalog: JSON.stringify(names) },
    create: { id: "school", subjectCatalog: JSON.stringify(names) },
  });
  if (!input.applyToAllClasses) return;
  const classes = await prisma.class.findMany({
    where: { archivedAt: null },
    include: { subjects: true },
  });
  for (const klass of classes) {
    const have = new Set(klass.subjects.map((s) => s.name));
    for (const name of names) {
      if (have.has(name)) continue;
      await prisma.subject.create({ data: { classId: klass.id, name, weightage: 4 } });
    }
  }
}

export async function saveClassCurriculumCore(
  user: AccessUser,
  input: { classId: string; subjects: { name: string; weightage: number }[] }
) {
  need(user, "people.edit");
  const classId = input.classId;
  if (!classId) throw new Error("Class required");
  const weights = (input.subjects || [])
    .map((s) => ({ name: s.name.trim(), weightage: Math.max(0, Number(s.weightage) || 0) }))
    .filter((s) => s.name);
  if (!weights.length) throw new Error("Add at least one subject.");
  await assertWeightsFitWeek(weights);
  const keep = new Set(weights.map((w) => w.name));
  const current = await prisma.subject.findMany({
    where: { classId },
    include: { _count: { select: { slots: true, exams: true } } },
  });
  for (const row of weights) {
    const existing = current.find((s) => s.name === row.name);
    if (existing) {
      await prisma.subject.update({ where: { id: existing.id }, data: { weightage: row.weightage } });
    } else {
      await prisma.subject.create({ data: { classId, name: row.name, weightage: row.weightage } });
    }
  }
  for (const s of current) {
    if (!keep.has(s.name) && s._count.slots === 0 && s._count.exams === 0) {
      await prisma.subject.delete({ where: { id: s.id } }).catch(() => undefined);
    }
  }
}

export async function setTeacherResourcesCore(
  user: AccessUser,
  input: {
    teacherId: string;
    name?: string;
    qualification?: string[] | string;
    qualificationNotes?: string;
    offers?: { subjectName: string; classId: string }[];
  }
) {
  need(user, "staff.edit");
  const teacherId = input.teacherId;
  if (!teacherId) throw new Error("Teacher required");
  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId }, select: { userId: true } });
  if (!teacher) throw new Error("Teacher required");
  const name = (input.name || "").trim();
  if (name) await prisma.user.update({ where: { id: teacher.userId }, data: { name } });
  const tags = Array.isArray(input.qualification)
    ? input.qualification
    : input.qualification
      ? [input.qualification]
      : [];
  const qualification = formatQualification(tags, input.qualificationNotes || "");
  await prisma.teacher.update({ where: { id: teacherId }, data: { qualification } });
  const offers = (input.offers || []).filter((o) => o.subjectName && o.classId);
  const classIds = [...new Set(offers.map((o) => o.classId))];
  await prisma.teacherSkill.deleteMany({ where: { teacherId } });
  await prisma.teacherClass.deleteMany({ where: { teacherId } });
  if (offers.length) {
    await prisma.teacherSkill.createMany({
      data: offers.map((o) => ({ teacherId, subjectName: o.subjectName, classId: o.classId })),
    });
  }
  if (classIds.length) {
    await prisma.teacherClass.createMany({
      data: classIds.map((classId) => ({ teacherId, classId })),
    });
  }
}

export async function saveSchoolClockCore(
  user: AccessUser,
  input: {
    weekdays: number[];
    periods: { id: string; name: string; startsAt: string; endsAt: string; isBreak?: boolean; sortOrder?: number }[];
  }
) {
  needSchoolScope(user, "timetable.edit");
  const days = [...new Set((input.weekdays || []).map(Number).filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b);
  await prisma.$transaction(async (tx) => {
    await tx.schoolConfig.upsert({
      where: { id: "school" },
      update: { weekdays: JSON.stringify(days.length ? days : [1, 2, 3, 4, 5, 6]) },
      create: { id: "school", weekdays: JSON.stringify(days.length ? days : [1, 2, 3, 4, 5, 6]) },
    });
    for (const p of input.periods || []) {
      await tx.period.update({
        where: { id: p.id },
        data: {
          name: p.name || "Period",
          startsAt: p.startsAt || "09:00",
          endsAt: p.endsAt || "09:40",
          isBreak: Boolean(p.isBreak),
          ...(p.sortOrder != null ? { sortOrder: p.sortOrder } : {}),
        },
      });
    }
  });
}

export async function addPeriodCore(
  user: AccessUser,
  input: { name?: string; startsAt?: string; endsAt?: string; isBreak?: boolean }
) {
  needSchoolScope(user, "timetable.edit");
  const last = await prisma.period.aggregate({ _max: { sortOrder: true } });
  await prisma.period.create({
    data: {
      name: input.name || "Period",
      startsAt: input.startsAt || "09:00",
      endsAt: input.endsAt || "09:40",
      isBreak: Boolean(input.isBreak),
      sortOrder: (last._max.sortOrder ?? 0) + 1,
    },
  });
}

export async function deletePeriodCore(user: AccessUser, input: { id: string }) {
  needSchoolScope(user, "timetable.edit");
  if (!input.id) throw new Error("Period required");
  await prisma.period.delete({ where: { id: input.id } });
}

export async function saveRoomsCore(
  user: AccessUser,
  input: { rooms: { id: string; name: string; kind?: string }[] }
) {
  needSchoolScope(user, "timetable.edit");
  await prisma.$transaction(async (tx) => {
    for (const r of input.rooms || []) {
      await tx.room.update({
        where: { id: r.id },
        data: {
          name: (r.name || "").trim(),
          kind: ((r.kind || "CLASSROOM") as RoomKind) || "CLASSROOM",
        },
      });
    }
  });
}

export async function addRoomCore(user: AccessUser, input: { name: string; kind?: string }) {
  needSchoolScope(user, "timetable.edit");
  const name = (input.name || "").trim();
  if (!name) throw new Error("Room name required");
  await prisma.room.create({
    data: {
      name,
      kind: ((input.kind || "CLASSROOM") as RoomKind) || "CLASSROOM",
    },
  });
}

export async function deleteRoomCore(user: AccessUser, input: { id: string }) {
  needSchoolScope(user, "timetable.edit");
  if (!input.id) throw new Error("Room required");
  await prisma.timetableSlot.updateMany({ where: { roomId: input.id }, data: { roomId: null } });
  await prisma.room.delete({ where: { id: input.id } });
}

export async function createSchoolSessionCore(
  user: AccessUser,
  input: { startsOn?: string; endsOn?: string; copyFromId?: string; makeCurrent?: boolean }
) {
  need(user, "school.edit");
  return createSchoolSession({
    startsOn: input.startsOn || "",
    endsOn: input.endsOn || "",
    copyFromId: input.copyFromId || undefined,
    makeCurrent: Boolean(input.makeCurrent),
  });
}

export async function setCurrentSchoolSessionCore(user: AccessUser, input: { sessionId?: string }) {
  need(user, "school.edit");
  await setCurrentSchoolSession(String(input.sessionId || ""));
}

export async function deleteSchoolSessionCore(user: AccessUser, input: { sessionId?: string }) {
  need(user, "school.edit");
  await deleteSchoolSession(String(input.sessionId || ""));
}

async function holidaySessionId(input: { sessionId?: string }) {
  const requested = String(input.sessionId || "");
  if (requested) {
    const found = await prisma.schoolSession.findUnique({ where: { id: requested }, select: { id: true } });
    if (!found) throw new Error("Session missing");
    return found.id;
  }
  const { current } = await ensureSchoolSessions();
  return current.id;
}

export async function addSchoolHolidayCore(user: AccessUser, input: { sessionId?: string; date?: string; name?: string }) {
  need(user, "school.edit");
  const sessionId = await holidaySessionId(input);
  const date = String(input.date || "").slice(0, 10);
  const name = String(input.name || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) throw new Error("Date and name are required");
  const existing = await prisma.schoolHoliday.findUnique({ where: { sessionId_date: { sessionId, date } } });
  const merged =
    existing && existing.name !== name && !existing.name.split(" · ").includes(name)
      ? `${existing.name} · ${name}`
      : name;
  await prisma.schoolHoliday.upsert({
    where: { sessionId_date: { sessionId, date } },
    update: { name: existing ? merged : name },
    create: { sessionId, date, name, source: "manual" },
  });
}

export async function deleteSchoolHolidayCore(user: AccessUser, input: { id?: string }) {
  need(user, "school.edit");
  const id = String(input.id || "");
  if (!id) throw new Error("Holiday required");
  await prisma.schoolHoliday.delete({ where: { id } });
}

export async function importSchoolHolidaysCore(user: AccessUser, input: { sessionId?: string; pasted?: string }) {
  need(user, "school.edit");
  const sessionId = await holidaySessionId(input);
  const text = String(input.pasted || "");
  const rows = parseHolidayText(text);
  if (!rows.length) throw new Error("No holidays found. Use a CSV (date, name) or an .ics calendar.");
  const existing = await prisma.schoolHoliday.findMany({ where: { sessionId } });
  const byDate = new Map(existing.map((h) => [h.date, h]));
  const source = /BEGIN:VEVENT/i.test(text) ? "ics" : "csv";
  let added = 0;
  for (const row of rows) {
    const prev = byDate.get(row.date);
    if (!prev) {
      await prisma.schoolHoliday.create({ data: { sessionId, date: row.date, name: row.name, source } });
      added += 1;
      continue;
    }
    if (prev.name === row.name || prev.name.split(" · ").includes(row.name)) continue;
    await prisma.schoolHoliday.update({
      where: { id: prev.id },
      data: { name: `${prev.name} · ${row.name}` },
    });
    added += 1;
  }
  if (!added) throw new Error("Those dates are already on the calendar.");
}

export async function saveGradePolicyCore(
  user: AccessUser,
  input: { passPercent?: number; showRank?: boolean; bands?: { min?: number; grade?: string }[]; reportCardPaidMonths?: number }
) {
  need(user, "exams.edit", "school.edit");
  const passPercent = Math.max(0, Math.min(100, Math.round(Number(input.passPercent || 33))));
  const showRank = Boolean(input.showRank);
  const reportCardPaidMonths = Math.max(0, Math.min(24, Math.floor(Number(input.reportCardPaidMonths) || 0)));
  const cleaned = (Array.isArray(input.bands) ? input.bands : [])
    .map((b) => ({
      min: Math.max(0, Math.min(100, Math.round(Number(b.min) || 0))),
      grade: String(b.grade || "").trim(),
    }))
    .filter((b) => b.grade)
    .sort((a, b) => b.min - a.min);
  await prisma.schoolConfig.upsert({
    where: { id: "school" },
    update: { passPercent, showRank, reportCardPaidMonths, gradeBandsJson: JSON.stringify(cleaned) },
    create: { id: "school", passPercent, showRank, reportCardPaidMonths, gradeBandsJson: JSON.stringify(cleaned) },
  });
}

export async function saveExamPlanCore(
  user: AccessUser,
  input: { sessionId?: string; plan?: unknown }
) {
  need(user, "exams.edit", "school.edit");
  const sessionId = String(input.sessionId || "");
  if (!sessionId) throw new Error("Session required");
  const raw = Array.isArray(input.plan) ? input.plan : [];
  if (!raw.length) throw new Error("Keep at least one sitting in the year plan");
  if (raw.length > 20) throw new Error("A year plan can have at most 20 sittings");
  if (raw.some((row) => !row || typeof row !== "object")) throw new Error("Each sitting must be a valid row");
  const drafts = raw as Record<string, unknown>[];
  if (drafts.some((row) => !String(row.name || "").trim())) throw new Error("Give every sitting a name");
  if (drafts.some((row) => String(row.name || "").trim().length > 80)) throw new Error("Sitting names must be 80 characters or less");
  if (drafts.some((row) => !Number.isInteger(Number(row.weight)) || Number(row.weight) < 1 || Number(row.weight) > 100)) {
    throw new Error("Each result weight must be a whole number from 1% to 100%");
  }
  if (drafts.some((row) => !Number.isInteger(Number(row.maxMarks)) || Number(row.maxMarks) < 1 || Number(row.maxMarks) > 1000)) {
    throw new Error("Maximum marks must be a whole number from 1 to 1,000");
  }
  if (drafts.some((row) => !String(row.expectedPeriod || "").trim())) throw new Error("Add an expected period for every sitting");
  if (drafts.some((row) => String(row.expectedPeriod || "").trim().length > 40)) throw new Error("Expected periods must be 40 characters or less");
  const items = parseExamPlan(JSON.stringify(input.plan || []), false);
  if (examPlanWeight(items) !== 100) throw new Error("Result weights must add up to exactly 100%");
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("Each sitting must have a unique id");
  if (new Set(items.map((item) => item.name.toLowerCase())).size !== items.length) throw new Error("Sitting names must be unique");
  await prisma.schoolSession.update({
    where: { id: sessionId },
    data: { examPlanJson: JSON.stringify(items) },
  });
}

async function needExamClass(user: AccessUser, classId: string, mode: "mark" | "run" = "mark") {
  need(user, "exams.edit", "marks.enter", "exams.teach");
  if (user.portal === "OFFICE" && can(user, "exams.edit")) return;
  const teacher = await prisma.teacher.findUnique({
    where: { userId: user.id },
    include: { subjects: true, classes: true },
  });
  if (!teacher) throw new Error("Not your class");
  const linked =
    teacher.classId === classId ||
    teacher.subjects.some((s) => s.classId === classId) ||
    teacher.classes.some((c) => c.classId === classId);
  const assigned = linked
    ? 1
    : await prisma.exam.count({
        where: {
          classId,
          OR: [
            { teacherId: teacher.id },
            { setterId: teacher.id },
            { evaluators: { some: { teacherId: teacher.id } } },
          ],
        },
      });
  if (!assigned) throw new Error("Not your class");
  if (mode === "run" && teacher.classId !== classId) {
    throw new Error("Only the class teacher or admin can do that");
  }
}

type SeriesPaperInput = {
  subjectId?: string;
  teacherId?: string | null;
  setterId?: string | null;
  maxMarks?: number;
  date?: string;
  paperDueOn?: string;
  copiesDueOn?: string;
  resultOn?: string;
};

function examDateFields(paper: {
  date: string;
  paperDueOn?: string;
  copiesDueOn?: string;
  resultOn?: string;
  teacherId?: string | null;
  setterId?: string | null;
}) {
  const teacherId = paper.teacherId || null;
  return {
    date: new Date(paper.date),
    paperDueOn: paper.paperDueOn ? new Date(paper.paperDueOn) : null,
    copiesDueOn: paper.copiesDueOn ? new Date(paper.copiesDueOn) : null,
    resultOn: paper.resultOn ? new Date(paper.resultOn) : null,
    teacherId,
    setterId: paper.setterId || teacherId,
  };
}

function cadenceForKind(kind: string): PaperCadence {
  return kind === "unit" ? "same" : "school";
}

export async function createExamSeriesCore(
  user: AccessUser,
  input: {
    classId: string;
    sessionId: string;
    name?: string;
    planItemId?: string;
    papers?: SeriesPaperInput[];
    startsOn?: string;
  }
) {
  const classId = String(input.classId || "");
  const sessionId = String(input.sessionId || "");
  if (!classId || !sessionId) throw new Error("Class and session required");
  await needExamClass(user, classId, "run");

  const session = await prisma.schoolSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error("Session missing");
  const plan = parseExamPlan(session.examPlanJson);
  const planItemId = String(input.planItemId || "").trim();
  const item = planItemId ? plan.find((row) => row.id === planItemId) : undefined;
  const name = String(input.name || "").trim() || item?.name || "Term 1";

  const subjects = await prisma.subject.findMany({
    where: { classId },
    orderBy: { name: "asc" },
  });
  if (!subjects.length) throw new Error("Add subjects on Routine first. Exam papers need a subject list.");

  let papers = (Array.isArray(input.papers) ? input.papers : [])
    .map((row) => {
      const teacherId = String(row.teacherId || "") || null;
      return {
        subjectId: String(row.subjectId || ""),
        teacherId,
        setterId: String(row.setterId || "") || teacherId,
        maxMarks: Math.max(1, Math.round(Number(row.maxMarks) || 0)),
        date: String(row.date || "").slice(0, 10),
        paperDueOn: String(row.paperDueOn || "").slice(0, 10),
        copiesDueOn: String(row.copiesDueOn || "").slice(0, 10),
        resultOn: String(row.resultOn || "").slice(0, 10),
      };
    })
    .filter((row) => row.subjectId && row.maxMarks && row.date);

  if (!papers.length) {
    const [config, holidays] = await Promise.all([
      prisma.schoolConfig.findUnique({ where: { id: "school" } }),
      prisma.schoolHoliday.findMany({ where: { sessionId }, orderBy: { date: "asc" } }),
    ]);
    const calendar = {
      weekdays: parseWeekdays(config?.weekdays),
      holidays: holidays.map((h) => ({ date: h.date, name: h.name })),
    };
    const rawStart = String(input.startsOn || "").slice(0, 10);
    const start = snapToSchoolDay(
      /^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? rawStart : addDays(ymd(new Date()), 14),
      calendar
    );
    const dates = paperDates(subjects.length, start, cadenceForKind(item?.kind || "term1"), calendar);
    const maxMarks = item?.maxMarks ?? 80;
    papers = subjects.map((subject, i) => {
      const examDate = dates[i] || start;
      return {
        subjectId: subject.id,
        teacherId: subject.teacherId,
        setterId: subject.teacherId,
        maxMarks,
        date: examDate,
        paperDueOn: addDays(examDate, -7),
        copiesDueOn: addDays(examDate, 7),
        resultOn: addDays(examDate, 14),
      };
    });
  }

  if (!papers.length) throw new Error("Pick at least one subject");
  const byId = new Map(subjects.map((s) => [s.id, s]));
  papers = papers.map((p) => {
    const subject = byId.get(p.subjectId);
    const teacherId = p.teacherId || subject?.teacherId || null;
    return { ...p, teacherId, setterId: p.setterId || teacherId };
  });
  const covered = new Set(papers.map((p) => p.subjectId));
  const lastDate = papers.map((p) => p.date).filter(Boolean).sort().at(-1) || ymd(new Date());
  let extra = 1;
  for (const subject of subjects) {
    if (covered.has(subject.id)) continue;
    const examDate = addDays(lastDate, extra);
    extra += 1;
    papers.push({
      subjectId: subject.id,
      teacherId: subject.teacherId,
      setterId: subject.teacherId,
      maxMarks: item?.maxMarks ?? papers[0]?.maxMarks ?? 80,
      date: examDate,
      paperDueOn: addDays(examDate, -7),
      copiesDueOn: addDays(examDate, 7),
      resultOn: addDays(examDate, 14),
    });
  }
  if (papers.some((p) => !p.teacherId)) {
    throw new Error("Schedule not saved. Assign a teacher to every subject in Routine first; teachers are needed for checking and entering marks.");
  }
  const clash = await prisma.examSeries.findFirst({ where: { classId, sessionId, name } });
  if (clash) throw new Error(`${name} already exists for this class and session.`);
  if (planItemId) {
    const taken = await prisma.examSeries.findFirst({ where: { classId, sessionId, planItemId } });
    if (taken) throw new Error(`${taken.name} is already scheduled for this class.`);
  }

  await prisma.examSeries.create({
    data: {
      classId,
      sessionId,
      planItemId,
      name,
      exams: {
        create: papers.flatMap((p) => {
          const subject = byId.get(p.subjectId);
          if (!subject) return [];
          return [
            {
              title: `${name} · ${subject.name}`,
              subjectId: subject.id,
              classId,
              maxMarks: p.maxMarks,
              ...examDateFields({
                ...p,
                teacherId: p.teacherId || subject.teacherId,
                setterId: p.setterId || p.teacherId || subject.teacherId,
              }),
            },
          ];
        }),
      },
    },
  });
  const created = await prisma.examSeries.findFirst({
    where: { classId, sessionId, name },
    select: { id: true },
  });
  if (created) {
    await notifySeriesAssigned(created.id, user.id);
  }
}

export async function publishExamSeriesCore(
  user: AccessUser,
  input: { seriesId: string; publish?: boolean | string | number }
) {
  const seriesId = String(input.seriesId || "");
  if (!seriesId) throw new Error("Series required");
  const series = await prisma.examSeries.findUnique({ where: { id: seriesId } });
  if (!series) throw new Error("Series not found");
  await needExamClass(user, series.classId, "run");
  const on = input.publish !== false && input.publish !== "0" && input.publish !== 0;
  await prisma.examSeries.update({
    where: { id: seriesId },
    data: { publishedAt: on ? new Date() : null },
  });
  if (on) await notifySchedulePublished(seriesId, user.id);
}

export async function deleteExamSeriesCore(user: AccessUser, input: { seriesId: string }) {
  const seriesId = String(input.seriesId || "");
  if (!seriesId) throw new Error("Series required");
  const series = await prisma.examSeries.findUnique({ where: { id: seriesId } });
  if (!series) throw new Error("Series not found");
  await needExamClass(user, series.classId, "run");
  await prisma.examSeries.delete({ where: { id: seriesId } });
}

export async function saveSchoolPayrollRulesCore(
  user: AccessUser,
  input: {
    startTime?: string;
    endTime?: string;
    graceMinutes?: number;
    freeLateCount?: number;
    lateDeductionMode?: string;
    lateDeductionAmount?: number;
    lateDayFraction?: number;
    latesPerLeaveDay?: number;
  }
) {
  need(user, "school.edit", "staff.edit");
  const existing = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const next = parsePayrollRules(
    JSON.stringify({
      ...parsePayrollRules(existing?.payrollJson),
      startTime: input.startTime,
      endTime: input.endTime,
      graceMinutes: input.graceMinutes,
      freeLateCount: input.freeLateCount,
      lateDeductionMode: "NONE",
      lateDeductionAmount: 0,
      lateDayFraction: 0,
      latesPerLeaveDay: input.latesPerLeaveDay,
    })
  );
  await prisma.schoolConfig.upsert({
    where: { id: "school" },
    update: { payrollJson: JSON.stringify(next) },
    create: { id: "school", payrollJson: JSON.stringify(next) },
  });
  let updated = 0;
  try {
    const days = await prisma.staffDay.findMany({ where: { inAt: { not: "" } } });
    for (const row of days) {
      if (row.status === AttendanceStatus.LEAVE) continue;
      const hit = classifyFromIn(row.inAt, next.startTime, next.graceMinutes);
      if (!hit) continue;
      await prisma.staffDay.update({
        where: { id: row.id },
        data: {
          status: hit.status as AttendanceStatus,
          startTimeUsed: hit.startTimeUsed,
          computedStatus: hit.status as AttendanceStatus,
        },
      });
      updated += 1;
    }
  } catch (error) {
    console.error("late timing saved; in-time recheck skipped", error);
  }
  return { rules: next, reclassified: updated };
}

export async function saveLeavePolicyCore(
  user: AccessUser,
  input: {
    types?: {
      id?: string;
      name?: string;
      forTeacher?: boolean;
      forStaff?: boolean;
      forStudent?: boolean;
      eligibilityGender?: string;
      noticeDays?: number;
      yearlyCap?: number;
    }[];
  }
) {
  need(user, "school.edit");
  const genderOptions = new Set(["ANY", "FEMALE", "MALE"]);
  const rows = (input.types || []).map((row, i) => ({
    id: String(row.id || "").trim(),
    name: String(row.name || "").trim() || "Leave",
    forTeacher: Boolean(row.forTeacher),
    forStaff: Boolean(row.forStaff),
    forStudent: Boolean(row.forStudent),
    eligibilityGender: genderOptions.has(String(row.eligibilityGender || "").toUpperCase())
      ? String(row.eligibilityGender).toUpperCase()
      : "ANY",
    noticeDays: Math.max(0, Math.min(30, Math.round(Number(row.noticeDays) || 0))),
    yearlyCap: Math.max(0, Math.min(365, Math.round(Number(row.yearlyCap) || 0))),
    sortOrder: i,
  }));
  if (!rows.length) throw new Error("Add at least one leave type");
  if (rows.some((r) => !r.forTeacher && !r.forStaff && !r.forStudent)) {
    throw new Error("Each type must apply to someone");
  }
  const keep = rows.filter((r) => r.id).map((r) => r.id);
  await prisma.$transaction(async (tx) => {
    if (keep.length) {
      await tx.leaveType.deleteMany({ where: { id: { notIn: keep } } });
    } else {
      await tx.leaveType.deleteMany();
    }
    for (const row of rows) {
      const data = {
        name: row.name,
        forTeacher: row.forTeacher,
        forStaff: row.forStaff,
        forStudent: row.forStudent,
        eligibilityGender: row.eligibilityGender,
        noticeDays: row.noticeDays,
        yearlyCap: row.yearlyCap,
        sortOrder: row.sortOrder,
      };
      if (row.id) {
        await tx.leaveType.upsert({ where: { id: row.id }, update: data, create: { id: row.id, ...data } });
      } else {
        await tx.leaveType.create({ data });
      }
    }
  });
}

export async function applyLeaveCore(
  user: AccessUser,
  input: { typeId?: string; from?: string; to?: string; reason?: string; studentId?: string }
) {
  const { applyLeave } = await import("./leave-actions");
  await applyLeave(user, input);
}

export async function decideLeaveCore(
  user: AccessUser,
  input: { requestId?: string; yes?: boolean }
) {
  const { decideLeave } = await import("./leave-actions");
  await decideLeave(user, input);
}

export async function assignSubstituteCore(
  user: AccessUser,
  input: { requestId?: string; slotId?: string; date?: string; substituteId?: string }
) {
  const { assignSubstitute } = await import("./leave-actions");
  await assignSubstitute(user, input);
}

export async function sendClassNoteCore(
  user: AccessUser,
  input: { studentId?: string; title?: string; body?: string }
) {
  need(user, "class.view");
  const teacher = await prisma.teacher.findUnique({ where: { userId: user.id } });
  if (!teacher?.classId) throw new Error("When you are class teacher, notes go from here.");
  const studentId = String(input.studentId || "").trim();
  if (!studentId) throw new Error("Pick a child");
  const student = await prisma.student.findUnique({ where: { id: studentId } });
  if (!student || student.classId !== teacher.classId) throw new Error("That child is not in your section");
  const title = String(input.title || "").trim() || `Note · ${student.name}`;
  const body = String(input.body || "").trim();
  if (!body) throw new Error("Write a short note");
  const portals = ["PARENT", "STUDENT"] as const;
  const notice = await prisma.notice.create({
    data: {
      title,
      body,
      kind: "FEEDBACK",
      priority: "INFO",
      authorId: user.id,
      studentId: student.id,
      audiences: { create: portals.map((portal) => ({ portal })) },
      classes: { create: [{ classId: student.classId }] },
    },
  });
  void notifyNoticePublished({
    noticeId: notice.id,
    title,
    body,
    portals: [...portals],
    classIds: [student.classId],
    studentId: student.id,
    authorId: user.id,
  }).catch(() => undefined);
}
