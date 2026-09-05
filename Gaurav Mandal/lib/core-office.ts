import bcrypt from "bcryptjs";
import { FeeLineKind, InvoiceStatus, PaperType, PathTag } from "@prisma/client";
import { sendAisensyWhatsApp, getAisensyConfig } from "./aisensy";
import { can, type AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { roleIdBySlug } from "./roles";
import { reminderCopy } from "./fee-run";
import {
  dueDateForMonth,
  feeLineTotal,
  feePeriod,
  invoiceBalance,
  invoiceLateStamp,
  monthFeeTitle,
  parseFeeLines,  
  periodFromDate,
} from "./fees";
import { normalizeMobile } from "./phone";
import { getResendConfig, sendResendEmail } from "./resend";
import { cell, parseClassLabel, parseCsv, parseDob, parsePathTags } from "./sheet";
import { ensureSchoolSessions, startNextSchoolSession } from "./school-session";
import { todayJoinedOn } from "./staff-profile";
import { feePayUrl } from "./utils";
import { addDays, paperSetterId, ymd } from "./exams";
import { validateExamMark } from "./exam-marks";
import {
  adminCanPublish,
  adminCanReview,
  assertExamTransition,
  canGrantMarksEntry,
  grantedEvaluatorIds,
  teacherCanEditMarks,
  teacherMayEnterMarks,
  teacherMayTakeExam,
  teacherCanTakeExam,
} from "./exam-workflow";
import {
  loadExamNoticeCtx,
  notifyExamConducted,
  notifyMarksApproved,
  notifyMarksCorrection,
  notifyMarksGranted,
  notifyMarksReminder,
  notifyMarksSubmitted,
  notifyPaperSubmitted,
  notifyResultsPublished,
  notifySeriesAssigned,
} from "./exam-events";
import { eligibleTeacherIdsForExam, ensureExamEvaluator } from "./exam-evaluators";
import { isQuestionPaperFile } from "./uploads";
function need(user: AccessUser, ...keys: string[]) {
  if (!keys.some((k) => can(user, k))) throw new Error("No access.");
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

export async function startNextSchoolSessionCore(user: AccessUser) {
  need(user, "school.edit");
  await startNextSchoolSession();
}

export async function saveFeeTemplateCore(
  user: AccessUser,
  input: {
    classId: string;
    sessionId?: string;
    name?: string;
    dueDay?: number;
    lateKind?: string;
    lateGraceDays?: number;
    lateAmount?: number;
    lines?: { label?: string; kind?: string; amount?: number }[];
  }
) {
  need(user, "fees.configure");
  const classId = String(input.classId || "");
  if (!classId) throw new Error("Class required");
  const { current } = await ensureSchoolSessions();
  const sessionId = String(input.sessionId || current.id);
  const name = String(input.name || "Monthly fee").trim() || "Monthly fee";
  const dueDay = Math.min(28, Math.max(1, Number(input.dueDay || 10)));
  const rawKind = String(input.lateKind || "NONE").toUpperCase();
  const lateKind = rawKind === "STATIC" || rawKind === "DAILY" ? rawKind : "NONE";
  const lateGraceDays = lateKind === "NONE" ? 0 : Math.max(0, Math.round(Number(input.lateGraceDays || 0)));
  const lateAmount = lateKind === "NONE" ? 0 : Math.max(0, Math.round(Number(input.lateAmount || 0)));
  const lateStamp = {
    lateKind,
    lateGraceDays,
    lateAmount,
    lateAfter10: lateKind === "STATIC" ? lateAmount : 0,
    lateAfter20: 0,
  };
  const lines = (Array.isArray(input.lines) ? input.lines : parseFeeLines(JSON.stringify(input.lines || []))).map(
    (line, i) => ({
      label: String(line.label || "").trim() || "Line",
      kind: (line.kind === "PERCENT" ? "PERCENT" : "FLAT") as FeeLineKind,
      amount: Math.max(0, Math.round(Number(line.amount) || 0)),
      sortOrder: i,
    })
  );
  const existing = await prisma.feeTemplate.findFirst({ where: { classId, sessionId } });
  if (existing) {
    await prisma.feeLine.deleteMany({ where: { templateId: existing.id } });
    await prisma.feeTemplate.update({
      where: { id: existing.id },
      data: { name, dueDay, ...lateStamp, lines: { create: lines } },
    });
  } else {
    await prisma.feeTemplate.create({
      data: { classId, sessionId, name, dueDay, ...lateStamp, lines: { create: lines } },
    });
  }
}

async function deliverFeeReminder(invoiceId: string) {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      student: { include: { parent: { include: { user: true } } } },
      payments: true,
    },
  });
  if (!invoice) throw new Error("Invoice missing");
  const { dueNow, message } = reminderCopy(invoice);
  if (dueNow <= 0) throw new Error("This month is already paid. Nudge another open bill.");
  let token = invoice.shareToken;
  if (!token) {
    token = crypto.randomUUID();
    await prisma.feeInvoice.update({ where: { id: invoice.id }, data: { shareToken: token } });
  }
  const payUrl = feePayUrl(token);
  const [whatsapp, email] = await Promise.all([getAisensyConfig(), getResendConfig()]);
  if (!whatsapp.configured && !email.configured) {
    throw new Error("Connect WhatsApp or email in Admin → School → Communication");
  }
  const sent: string[] = [];
  const errors: string[] = [];
  if (whatsapp.configured) {
    try {
      await sendAisensyWhatsApp({
        phone: invoice.student.parent.phone,
        userName: invoice.student.parent.user.name || invoice.student.name,
        params: [invoice.student.name, invoice.title, String(dueNow), payUrl],
      });
      sent.push("WhatsApp");
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "WhatsApp failed");
    }
  }
  if (email.configured) {
    try {
      await sendResendEmail({
        to: invoice.student.parent.user.email,
        studentName: invoice.student.name,
        title: invoice.title,
        amount: String(dueNow),
        payUrl,
      });
      sent.push("email");
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Email failed");
    }
  }
  if (!sent.length) throw new Error(errors[0] || "Reminder could not be sent");
  await prisma.feeReminder.create({
    data: { invoiceId, message: `${message} · ${sent.join(" + ")}` },
  });
}

export async function sendFeeRemindersCore(user: AccessUser, input: { invoiceIds?: string[] }) {
  need(user, "fees.collect", "fees.remind");
  const ids = [...new Set((input.invoiceIds || []).map(String).filter(Boolean))].slice(0, 100);
  if (!ids.length) throw new Error("Nothing to remind");
  let ok = 0;
  let lastError = "";
  for (let i = 0; i < ids.length; i += 4) {
    const results = await Promise.allSettled(ids.slice(i, i + 4).map(deliverFeeReminder));
    for (const result of results) {
      if (result.status === "fulfilled") ok += 1;
      else lastError = result.reason instanceof Error ? result.reason.message : "Reminder failed";
    }
  }
  if (!ok) throw new Error(lastError || "No reminders sent");
  return { sent: ok };
}

export async function collectAllStudentFeesCore(
  user: AccessUser,
  input: { studentId: string; method?: string; reference?: string; notes?: string; proofPath?: string }
) {
  need(user, "fees.collect");
  const studentId = String(input.studentId || "");
  if (!studentId) throw new Error("Student required");
  const method = (["CASH", "UPI", "BANK", "CHEQUE"].includes(input.method || "") ? input.method : "CASH") as
    | "CASH"
    | "UPI"
    | "BANK"
    | "CHEQUE";
  const reference = String(input.reference || "").trim() || null;
  if ((method === "UPI" || method === "BANK") && !reference) throw new Error("Enter the UTR / reference number");
  if (method === "CHEQUE" && !reference) throw new Error("Enter the cheque number");
  const invoices = await prisma.feeInvoice.findMany({
    where: { studentId },
    include: { payments: true },
    orderBy: { dueDate: "asc" },
  });
  const open = invoices.filter((inv) => invoiceBalance(inv).dueNow > 0);
  if (!open.length) throw new Error("Nothing due for this student");
  const { recordLedgerPayment } = await import("./fee-ledger");
  const proofPath = String(input.proofPath || "").trim() || null;
  const notes = String(input.notes || "").trim() || "Full payment";
  for (const inv of open) {
    await recordLedgerPayment({
      invoiceId: inv.id,
      amount: invoiceBalance(inv).dueNow,
      method,
      reference,
      proofPath,
      notes,
    });
  }
}

export async function issueClassFeesCore(
  user: AccessUser,
  input: { classId: string; year?: number; month?: number }
) {
  need(user, "fees.collect");
  const classId = String(input.classId || "");
  const year = Number(input.year || new Date().getFullYear());
  const monthIndex = Number(input.month ?? new Date().getMonth());
  const { current } = await ensureSchoolSessions();
  const template = await prisma.feeTemplate.findFirst({
    where: { classId, sessionId: current.id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!template || !template.lines.length) throw new Error("Save a fee template first");
  const drafts = template.lines.map((l) => ({ label: l.label, kind: l.kind, amount: l.amount }));
  const { total } = feeLineTotal(drafts);
  const title = monthFeeTitle(year, monthIndex, template.name);
  const dueDate = dueDateForMonth(year, monthIndex, template.dueDay);
  const period = feePeriod(year, monthIndex);
  const students = await prisma.student.findMany({ where: { classId }, select: { id: true } });
  if (!students.length) throw new Error("This class has no students. Add them on Students, then issue.");
  const already = await prisma.feeInvoice.findMany({
    where: { classId, period },
    select: { studentId: true },
  });
  const have = new Set(already.map((i) => i.studentId));
  const linesJson = JSON.stringify(drafts);
  await prisma.feeInvoice.createMany({
    data: students
      .filter((s) => !have.has(s.id))
      .map((s) => ({
        studentId: s.id,
        classId,
        templateId: template.id,
        period,
        title,
        amount: total,
        linesJson,
        dueDate,
        ...invoiceLateStamp(template),
        shareToken: crypto.randomUUID(),
        status: InvoiceStatus.DUE,
      })),
  });
}

export async function createInvoiceCore(
  user: AccessUser,
  input: { studentId: string; classId?: string; title?: string; amount?: number; dueDate?: string; lateFeePerDay?: number }
) {
  need(user, "fees.collect");
  const studentId = String(input.studentId || "");
  if (!studentId) throw new Error("Student required");
  const dueDate = new Date(String(input.dueDate || ymd(new Date())));
  await prisma.feeInvoice.create({
    data: {
      studentId,
      classId: String(input.classId || "") || null,
      period: periodFromDate(dueDate),
      title: String(input.title || "Fee"),
      amount: Number(input.amount || 0),
      dueDate,
      lateFeePerDay: Number(input.lateFeePerDay || 50),
      status: InvoiceStatus.DUE,
      shareToken: crypto.randomUUID(),
    },
  });
}

export async function copyExamSeriesCore(user: AccessUser, input: { seriesId: string; classIds?: string[] }) {
  need(user, "exams.edit");
  const seriesId = String(input.seriesId || "");
  const classIds = [...new Set((input.classIds || []).map(String).filter(Boolean))];
  if (!seriesId || !classIds.length) throw new Error("Pick at least one class");
  const source = await prisma.examSeries.findUnique({
    where: { id: seriesId },
    include: { exams: { include: { subject: true, evaluators: true } } },
  });
  if (!source) throw new Error("Exam not found");
  let copied = 0;
  const blocked: string[] = [];
  for (const classId of classIds) {
    if (classId === source.classId) continue;
    const klass = await prisma.class.findUnique({
      where: { id: classId },
      select: { name: true, section: true },
    });
    const label = klass ? `${klass.name}-${klass.section}` : "Class";
    const clash = await prisma.examSeries.findFirst({
      where: {
        classId,
        sessionId: source.sessionId,
        OR: source.planItemId
          ? [{ name: source.name }, { planItemId: source.planItemId }]
          : [{ name: source.name }],
      },
    });
    if (clash) {
      blocked.push(`${label} already has ${clash.name}`);
      continue;
    }
    const destSubjects = await prisma.subject.findMany({ where: { classId } });
    const byName = new Map(destSubjects.map((s) => [s.name.trim().toLowerCase(), s]));
    const papers = source.exams.flatMap((exam) => {
      const subject = byName.get(exam.subject.name.trim().toLowerCase());
      if (!subject) return [];
      return [
        {
          subject,
          teacherId: exam.teacherId || subject.teacherId,
          setterId: exam.setterId || exam.teacherId || subject.teacherId,
          maxMarks: exam.maxMarks,
          date: ymd(exam.date),
          paperDueOn: exam.paperDueOn ? ymd(exam.paperDueOn) : "",
          copiesDueOn: exam.copiesDueOn ? ymd(exam.copiesDueOn) : "",
          resultOn: exam.resultOn ? ymd(exam.resultOn) : "",
        },
      ];
    });
    if (!papers.length) {
      blocked.push(`${label} has no matching subjects`);
      continue;
    }
    await prisma.examSeries.create({
      data: {
        classId,
        sessionId: source.sessionId,
        planItemId: source.planItemId,
        name: source.name,
        exams: {
          create: papers.map((p) => ({
            title: `${source.name} · ${p.subject.name}`,
            subjectId: p.subject.id,
            classId,
            maxMarks: p.maxMarks,
            ...examDateFields({
              date: p.date,
              paperDueOn: p.paperDueOn,
              copiesDueOn: p.copiesDueOn,
              resultOn: p.resultOn,
              teacherId: p.teacherId,
              setterId: p.setterId,
            }),
          })),
        },
      },
    });
    copied += 1;
  }
  if (!copied) throw new Error(blocked[0] || "Could not copy this timetable");
  const copies = await prisma.examSeries.findMany({
    where: { sessionId: source.sessionId, name: source.name, classId: { in: classIds } },
    select: { id: true },
  });
  for (const row of copies) await notifySeriesAssigned(row.id, user.id);
  return { copied };
}

export async function updateExamSeriesPapersCore(
  user: AccessUser,
  input: {
    seriesId: string;
    papers?: {
      subjectId?: string;
      teacherId?: string;
      setterId?: string;
      maxMarks?: number;
      date?: string;
      paperDueOn?: string;
      copiesDueOn?: string;
      resultOn?: string;
    }[];
  }
) {
  const seriesId = String(input.seriesId || "");
  if (!seriesId) throw new Error("Series required");
  const series = await prisma.examSeries.findUnique({
    where: { id: seriesId },
    include: { exams: true },
  });
  if (!series) throw new Error("Series not found");
  await needExamClass(user, series.classId, "run");
  const papers = (input.papers || [])
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
  if (!papers.length) throw new Error("Pick at least one subject");
  const classSubjects = await prisma.subject.findMany({ where: { classId: series.classId } });
  const lastDate = papers.map((p) => p.date).filter(Boolean).sort().at(-1) || ymd(new Date());
  let extra = 1;
  for (const subject of classSubjects) {
    if (papers.some((p) => p.subjectId === subject.id)) continue;
    const examDate = addDays(lastDate, extra);
    extra += 1;
    papers.push({
      subjectId: subject.id,
      teacherId: subject.teacherId,
      setterId: subject.teacherId,
      maxMarks: papers[0]?.maxMarks || 80,
      date: examDate,
      paperDueOn: addDays(examDate, -7),
      copiesDueOn: addDays(examDate, 7),
      resultOn: addDays(examDate, 14),
    });
  }
  const keepSubjects = new Set(papers.map((p) => p.subjectId));
  for (const exam of series.exams) {
    if (!keepSubjects.has(exam.subjectId)) {
      const marked = await prisma.examResult.count({ where: { examId: exam.id } });
      if (marked) throw new Error("Cannot remove a subject that already has marks.");
      await prisma.exam.delete({ where: { id: exam.id } });
    }
  }
  const subjects = await prisma.subject.findMany({
    where: { classId: series.classId, id: { in: papers.map((p) => p.subjectId) } },
  });
  const byId = new Map(subjects.map((s) => [s.id, s]));
  for (const paper of papers) {
    const subject = byId.get(paper.subjectId);
    if (!subject) continue;
    const existing = series.exams.find((e) => e.subjectId === paper.subjectId);
    const teacherId = paper.teacherId || existing?.teacherId || subject.teacherId;
    if (!teacherId) throw new Error("Schedule not saved. Assign a teacher to every subject in Routine first; teachers are needed for checking and entering marks.");
    const stamp = examDateFields({
      ...paper,
      teacherId,
      setterId: paper.setterId || existing?.setterId || teacherId,
    });
    if (existing) {
      await prisma.exam.update({
        where: { id: existing.id },
        data: { title: `${series.name} · ${subject.name}`, maxMarks: paper.maxMarks, ...stamp },
      });
    } else {
      await prisma.exam.create({
        data: {
          seriesId: series.id,
          title: `${series.name} · ${subject.name}`,
          subjectId: subject.id,
          classId: series.classId,
          maxMarks: paper.maxMarks,
          ...stamp,
        },
      });
    }
  }
  await notifySeriesAssigned(series.id, user.id);
}

export async function saveSeriesMarksCore(
  user: AccessUser,
  input: {
    seriesId: string;
    marks?: { examId?: string; studentId?: string; marks?: string | number; absent?: boolean; remarks?: string }[];
  }
) {
  const seriesId = String(input.seriesId || "");
  if (!seriesId) throw new Error("Series required");
  const series = await prisma.examSeries.findUnique({
    where: { id: seriesId },
    include: { exams: { include: { evaluators: true } } },
  });
  if (!series) throw new Error("Series not found");
  need(user, "marks.enter", "exams.edit");
  const teacher =
    user.portal === "TEACHER"
      ? await prisma.teacher.findUnique({ where: { userId: user.id }, select: { id: true } })
      : null;
  const examIds = new Set(
    series.exams
      .filter((e) => (teacher ? teacherMayEnterMarks(e, teacher.id) : can(user, "exams.edit")))
      .map((e) => e.id)
  );
  if (!examIds.size) throw new Error("Only the evaluation teacher can enter marks for their paper");
  const locked = new Set(
    series.exams
      .filter((e) => examIds.has(e.id) && (teacher ? !teacherCanEditMarks(e.workflowStatus) : e.workflowStatus === "PUBLISHED"))
      .map((e) => e.id)
  );
  const rows = Array.isArray(input.marks) ? input.marks : [];
  if (rows.some((row) => locked.has(String(row.examId || "")))) {
    throw new Error("Marks are locked for one or more papers.");
  }
  const maxByExam = new Map(series.exams.map((e) => [e.id, e.maxMarks]));
  const students = await prisma.student.findMany({ where: { classId: series.classId }, select: { id: true } });
  const studentIds = new Set(students.map((s) => s.id));
  for (const row of rows) {
    const examId = String(row.examId || "");
    const studentId = String(row.studentId || "");
    if (!examIds.has(examId) || !studentIds.has(studentId)) continue;
    const absent = Boolean(row.absent);
    const raw = String(row.marks ?? "").trim();
    if (!absent && raw === "") {
      await prisma.examResult.deleteMany({ where: { examId, studentId } });
      continue;
    }
    const marks = absent ? 0 : Number(raw);
    if (Number.isNaN(marks) || marks < 0) throw new Error("Marks must be a number");
    const cap = maxByExam.get(examId) || 0;
    if (marks > cap) throw new Error(`Marks cannot exceed ${cap}`);
    await prisma.examResult.upsert({
      where: { examId_studentId: { examId, studentId } },
      update: { marks, absent, remarks: String(row.remarks || "").trim() || null },
      create: { examId, studentId, marks, absent, remarks: String(row.remarks || "").trim() || null },
    });
  }
}

async function writeMarkAudit(input: {
  examId: string;
  studentId: string;
  marks: number;
  absent: boolean;
  remarks?: string | null;
  action: string;
  actorId: string;
  note?: string | null;
}) {
  await prisma.examResultAudit.create({
    data: {
      examId: input.examId,
      studentId: input.studentId,
      marks: input.marks,
      absent: input.absent,
      remarks: input.remarks || null,
      action: input.action,
      actorId: input.actorId,
      note: input.note || null,
    },
  });
}

async function writeExamMarkRows(
  exam: { id: string; classId: string; maxMarks: number; workflowStatus?: string | null; correctionNote?: string | null },
  rows: { studentId?: string; marks?: string | number; absent?: boolean }[],
  opts?: { actorId?: string; restrictTo?: Set<string>; audit?: string }
) {
  const students = await prisma.student.findMany({
    where: { classId: exam.classId },
    select: { id: true, name: true },
  });
  const studentIds = new Set(students.map((s) => s.id));
  const names = new Map(students.map((s) => [s.id, s.name]));
  let saved = 0;
  for (const row of rows) {
    const studentId = String(row.studentId || "");
    if (!studentId) continue;
    if (!studentIds.has(studentId)) throw new Error("That student is not in this class.");
    if (opts?.restrictTo && !opts.restrictTo.has(studentId)) {
      throw new Error("Only the requested student marks can be corrected.");
    }
    const absent = Boolean(row.absent);
    const raw = String(row.marks ?? "").trim();
    if (!absent && raw === "") {
      if (exam.workflowStatus === "CORRECTION_REQUIRED") continue;
      await prisma.examResult.deleteMany({ where: { examId: exam.id, studentId } });
      continue;
    }
    const marks = absent ? 0 : Number(raw);
    validateExamMark(marks, exam.maxMarks, names.get(studentId) || "Marks");
    const remarks = null;
    await prisma.examResult.upsert({
      where: { examId_studentId: { examId: exam.id, studentId } },
      update: { marks, absent },
      create: { examId: exam.id, studentId, marks, absent },
    });
    if (opts?.audit && opts.actorId) {
      await writeMarkAudit({
        examId: exam.id,
        studentId,
        marks,
        absent,
        remarks,
        action: opts.audit,
        actorId: opts.actorId,
      });
    }
    saved += 1;
  }
  return { saved, studentCount: students.length };
}

async function correctionStudentIds(examId: string, _paperNote?: string | null) {
  const rows = await prisma.examResult.findMany({
    where: { examId, correctionRequestedAt: { not: null } },
    select: { studentId: true },
  });
  if (rows.length) return new Set(rows.map((row) => row.studentId));
  return null;
}

export async function saveExamMarksCore(
  user: AccessUser,
  input: {
    examId?: string;
    marks?: { studentId?: string; marks?: string | number; absent?: boolean }[];
  }
) {
  const examId = String(input.examId || "");
  if (!examId) throw new Error("Exam required");
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { evaluators: true } });
  if (!exam) throw new Error("Exam not found");
  await needExamClass(user, exam.classId, "mark");
  if (user.portal === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({ where: { userId: user.id } });
    if (!teacherMayEnterMarks(exam, teacher?.id)) {
      throw new Error("Office must allow marks entry on this paper first.");
    }
  } else if (exam.workflowStatus === "PUBLISHED") {
    throw new Error("Published results cannot be edited. Unpublish first if the school must change them.");
  } else {
    need(user, "exams.edit");
  }
  const restrict =
    user.portal === "TEACHER" && exam.workflowStatus === "CORRECTION_REQUIRED"
      ? await correctionStudentIds(exam.id, exam.correctionNote)
      : null;
  const result = await writeExamMarkRows(exam, Array.isArray(input.marks) ? input.marks : [], {
    restrictTo: restrict && restrict.size ? restrict : undefined,
  });
  if (exam.workflowStatus === "SCHEDULED" || exam.workflowStatus === "IN_PROGRESS") {
    assertExamTransition(exam.workflowStatus, "MARKS_DRAFT");
    await prisma.exam.update({
      where: { id: exam.id },
      data: { workflowStatus: "MARKS_DRAFT" },
    });
  }
  return result;
}

export async function takeExamCore(user: AccessUser, input: { examId?: string }) {
  const examId = String(input.examId || "");
  if (!examId) throw new Error("Exam required");
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { evaluators: true } });
  if (!exam) throw new Error("Exam not found");
  await needExamClass(user, exam.classId, "mark");
  if (user.portal === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({ where: { userId: user.id } });
    if (!teacherMayTakeExam(exam, teacher?.id)) {
      throw new Error("Set the question paper first, then take the exam.");
    }
  }
  if (!teacherCanTakeExam(exam.workflowStatus)) throw new Error("This exam has already been taken.");
  assertExamTransition(exam.workflowStatus, "IN_PROGRESS");
  await prisma.exam.update({
    where: { id: exam.id },
    data: { workflowStatus: "IN_PROGRESS", conductedAt: new Date() },
  });
  const ctx = await loadExamNoticeCtx(exam.id);
  if (ctx) await notifyExamConducted(ctx, user.id);
}

export async function submitExamMarksCore(
  user: AccessUser,
  input: {
    examId?: string;
    marks?: { studentId?: string; marks?: string | number; absent?: boolean }[];
  }
) {
  const examId = String(input.examId || "");
  if (!examId) throw new Error("Exam required");
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { evaluators: true } });
  if (!exam) throw new Error("Exam not found");
  await needExamClass(user, exam.classId, "mark");
  if (user.portal === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({ where: { userId: user.id } });
    if (!teacherMayEnterMarks(exam, teacher?.id)) {
      throw new Error("Office must allow marks entry on this paper first.");
    }
  } else {
    need(user, "exams.edit", "marks.enter");
    if (!teacherCanEditMarks(exam.workflowStatus) && exam.workflowStatus !== "SCHEDULED") {
      throw new Error("This paper is already submitted.");
    }
  }
  const restrict =
    user.portal === "TEACHER" && exam.workflowStatus === "CORRECTION_REQUIRED"
      ? await correctionStudentIds(exam.id, exam.correctionNote)
      : null;
  const nextStatus = exam.workflowStatus === "CORRECTION_REQUIRED" ? "RESUBMITTED" : "SUBMITTED";
  await writeExamMarkRows(exam, Array.isArray(input.marks) ? input.marks : [], {
    actorId: user.id,
    restrictTo: restrict && restrict.size ? restrict : undefined,
    audit: nextStatus,
  });
  const students = await prisma.student.findMany({ where: { classId: exam.classId }, select: { id: true } });
  const results = await prisma.examResult.findMany({ where: { examId: exam.id } });
  const have = new Set(results.map((row) => row.studentId));
  const missing = students.filter((s) => !have.has(s.id)).length;
  if (missing && nextStatus === "SUBMITTED") {
    throw new Error(`Enter marks or Absent for every student before submitting. ${missing} still missing.`);
  }
  assertExamTransition(exam.workflowStatus, nextStatus);
  await prisma.exam.update({
    where: { id: exam.id },
    data: {
      workflowStatus: nextStatus,
      submittedAt: new Date(),
      copiesDoneAt: new Date(),
      correctionNote: nextStatus === "RESUBMITTED" ? exam.correctionNote : null,
    },
  });
  if (nextStatus === "RESUBMITTED") {
    await prisma.examResult.updateMany({
      where: { examId: exam.id, correctionRequestedAt: { not: null } },
      data: {
        correctionRequestedAt: null,
        correctionRequestedById: null,
        version: { increment: 1 },
      },
    });
  }
  const ctx = await loadExamNoticeCtx(exam.id);
  if (ctx) await notifyMarksSubmitted(ctx, nextStatus === "RESUBMITTED", user.id);
  return { submitted: students.length };
}

export async function reviewExamMarksCore(user: AccessUser, input: { examId?: string }) {
  need(user, "exams.edit");
  const examId = String(input.examId || "");
  if (!examId) throw new Error("Exam required");
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { evaluators: true } });
  if (!exam) throw new Error("Exam not found");
  if (!adminCanReview(exam.workflowStatus)) {
    throw new Error("This paper is not waiting for review.");
  }
  if (exam.workflowStatus === "SUBMITTED") {
    assertExamTransition(exam.workflowStatus, "UNDER_REVIEW");
    await prisma.exam.update({
      where: { id: exam.id },
      data: { workflowStatus: "UNDER_REVIEW" },
    });
  }
}

export async function returnExamMarksCore(user: AccessUser, input: { examId?: string; note?: string }) {
  need(user, "exams.edit");
  const examId = String(input.examId || "");
  if (!examId) throw new Error("Exam required");
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { evaluators: true } });
  if (!exam) throw new Error("Exam not found");
  if (
    exam.workflowStatus !== "SUBMITTED" &&
    exam.workflowStatus !== "UNDER_REVIEW" &&
    exam.workflowStatus !== "RESUBMITTED" &&
    exam.workflowStatus !== "APPROVED"
  ) {
    throw new Error("Only submitted papers can be sent back.");
  }
  const note = String(input.note || "").trim();
  if (!note) throw new Error("Add a correction note so the teacher knows what to fix.");
  assertExamTransition(exam.workflowStatus, "CORRECTION_REQUIRED");
  await prisma.exam.update({
    where: { id: exam.id },
    data: {
      workflowStatus: "CORRECTION_REQUIRED",
      correctionNote: note,
    },
  });
  const ctx = await loadExamNoticeCtx(exam.id);
  if (ctx) await notifyMarksCorrection(ctx, note, user.id);
}

export async function requestExamMarkCorrectionCore(
  user: AccessUser,
  input: { examId?: string; studentId?: string; note?: string }
) {
  need(user, "exams.edit");
  const examId = String(input.examId || "");
  const studentId = String(input.studentId || "");
  const note = String(input.note || "").trim();
  if (!examId || !studentId) throw new Error("Pick the student and paper.");
  if (!note) throw new Error("Add a reason so the teacher knows what to verify.");
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: { evaluators: true, results: true },
  });
  if (!exam) throw new Error("Exam not found");
  if (exam.workflowStatus === "PUBLISHED") throw new Error("Unpublish results before requesting a correction.");
  if (
    exam.workflowStatus !== "SUBMITTED" &&
    exam.workflowStatus !== "UNDER_REVIEW" &&
    exam.workflowStatus !== "RESUBMITTED" &&
    exam.workflowStatus !== "APPROVED"
  ) {
    throw new Error("Request a correction after the teacher has submitted the mark sheet.");
  }
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, name: true, classId: true } });
  if (!student || student.classId !== exam.classId) throw new Error("That student is not in this class.");
  const current = exam.results.find((row) => row.studentId === studentId);
  if (!current) throw new Error("No mark has been submitted for this student yet.");
  assertExamTransition(exam.workflowStatus, "CORRECTION_REQUIRED");
  await prisma.examResult.update({
    where: { examId_studentId: { examId, studentId } },
    data: {
      correctionNote: note,
      correctionRequestedAt: new Date(),
      correctionRequestedById: user.id,
    },
  });
  await prisma.exam.update({
    where: { id: examId },
    data: { workflowStatus: "CORRECTION_REQUIRED", correctionNote: exam.correctionNote || note },
  });
  await writeMarkAudit({
    examId,
    studentId,
    marks: current.marks,
    absent: current.absent,
    remarks: current.remarks,
    action: "CORRECTION_REQUESTED",
    actorId: user.id,
    note,
  });
  const ctx = await loadExamNoticeCtx(examId);
  if (ctx) await notifyMarksCorrection(ctx, `${student.name}: ${note}`, user.id);
}

export async function remindExamMarksCore(user: AccessUser, input: { examId?: string }) {
  need(user, "exams.edit");
  const examId = String(input.examId || "");
  if (!examId) throw new Error("Exam required");
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) throw new Error("Exam not found");
  await needExamClass(user, exam.classId, "run");
  if (exam.workflowStatus === "PUBLISHED") throw new Error("Results are already published.");
  const ctx = await loadExamNoticeCtx(examId);
  if (!ctx) throw new Error("Exam not found");
  await notifyMarksReminder(ctx, user.id);
}

export async function examMarkHistoryCore(user: AccessUser, input: { examId?: string; studentId?: string }) {
  need(user, "exams.edit", "exams.view");
  const examId = String(input.examId || "");
  const studentId = String(input.studentId || "");
  if (!examId || !studentId) throw new Error("Pick the student and paper.");
  const rows = await prisma.examResultAudit.findMany({
    where: { examId, studentId },
    orderBy: { createdAt: "asc" },
  });
  const actors = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.actorId))] } },
    select: { id: true, name: true },
  });
  const names = new Map(actors.map((row) => [row.id, row.name]));
  return {
    history: rows.map((row) => ({
      id: row.id,
      action: row.action,
      marks: row.marks,
      absent: row.absent,
      note: row.note || "",
      at: row.createdAt.toISOString(),
      actorName: names.get(row.actorId) || "Staff",
    })),
  };
}

export async function approveExamMarksCore(user: AccessUser, input: { examId?: string }) {
  need(user, "exams.edit", "exams.publish");
  const examId = String(input.examId || "");
  if (!examId) throw new Error("Exam required");
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { evaluators: true } });
  if (!exam) throw new Error("Exam not found");
  if (exam.workflowStatus !== "SUBMITTED" && exam.workflowStatus !== "UNDER_REVIEW" && exam.workflowStatus !== "RESUBMITTED") {
    throw new Error("Approve after the teacher has submitted the mark sheet.");
  }
  assertExamTransition(exam.workflowStatus, "APPROVED");
  const results = await prisma.examResult.findMany({ where: { examId: exam.id } });
  for (const row of results) {
    await writeMarkAudit({
      examId: exam.id,
      studentId: row.studentId,
      marks: row.marks,
      absent: row.absent,
      remarks: row.remarks,
      action: "APPROVED",
      actorId: user.id,
    });
  }
  await prisma.exam.update({
    where: { id: exam.id },
    data: { workflowStatus: "APPROVED", reviewedAt: new Date() },
  });
  const ctx = await loadExamNoticeCtx(exam.id);
  if (ctx) await notifyMarksApproved(ctx, user.id);
}

export async function publishExamResultsCore(
  user: AccessUser,
  input: { examId?: string; seriesId?: string }
) {
  need(user, "exams.publish");
  const examId = String(input.examId || "");
  const seriesId = String(input.seriesId || "");
  if (examId) {
    const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { evaluators: true } });
    if (!exam) throw new Error("Exam not found");
    if (!adminCanPublish(exam.workflowStatus)) {
      throw new Error("Approve the mark sheet before publishing results.");
    }
    assertExamTransition(exam.workflowStatus, "PUBLISHED");
    await prisma.exam.update({
      where: { id: exam.id },
      data: { workflowStatus: "PUBLISHED", resultsPublishedAt: new Date() },
    });
    const ctx = await loadExamNoticeCtx(exam.id);
    if (ctx) await notifyResultsPublished({ exam: ctx, authorId: user.id });
    return { published: 1 };
  }
  if (!seriesId) throw new Error("Exam or series required");
  const series = await prisma.examSeries.findUnique({
    where: { id: seriesId },
    include: { exams: true },
  });
  if (!series) throw new Error("Series not found");
  await needExamClass(user, series.classId, "run");
  const notReady = series.exams.filter(
    (exam) => exam.workflowStatus !== "APPROVED" && exam.workflowStatus !== "PUBLISHED"
  );
  if (notReady.length) {
    throw new Error(
      `Results cannot be published yet. ${notReady.map((exam) => exam.title).join(", ")} ${notReady.length === 1 ? "is" : "are"} still awaiting review.`
    );
  }
  const now = new Date();
  await prisma.exam.updateMany({
    where: { seriesId, workflowStatus: "APPROVED" },
    data: { workflowStatus: "PUBLISHED", resultsPublishedAt: now },
  });
  await notifyResultsPublished({ seriesId, authorId: user.id });
  return { published: series.exams.length };
}

export async function importExamMarksCore(user: AccessUser, input: { examId?: string; csv?: string }) {
  const examId = String(input.examId || "");
  const csv = String(input.csv || "");
  if (!examId) throw new Error("Exam required");
  if (/^PK\x03\x04/.test(csv) || csv.includes("xl/")) {
    throw new Error("Save the Excel file as CSV, then import that.");
  }
  const rows = parseCsv(csv);
  if (!rows.length) throw new Error("The sheet is empty. Use columns Admission, Name, Marks.");
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { evaluators: true } });
  if (!exam) throw new Error("Exam not found");
  await needExamClass(user, exam.classId, "mark");
  if (user.portal === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({ where: { userId: user.id } });
    if (!teacherMayEnterMarks(exam, teacher?.id)) {
      throw new Error("Office must allow marks entry on this paper first.");
    }
  } else if (exam.workflowStatus === "PUBLISHED") {
    throw new Error("Published results cannot be edited.");
  }
  const students = await prisma.student.findMany({
    where: { classId: exam.classId },
    select: { id: true, name: true, admissionNo: true },
  });
  const byAdm = new Map(students.map((s) => [s.admissionNo.trim().toLowerCase(), s]));
  const byName = new Map(students.map((s) => [s.name.trim().toLowerCase(), s]));
  let saved = 0;
  const skipped: string[] = [];
  for (const row of rows) {
    const admission = cell(row, "admissionNo", "admission", "adm", "admn", "admissionno").toLowerCase();
    const name = cell(row, "name", "student", "studentname").toLowerCase();
    const student = (admission && byAdm.get(admission)) || (name && byName.get(name)) || null;
    if (!student) {
      skipped.push(cell(row, "name", "admissionNo", "admission") || "A row");
      continue;
    }
    const absentRaw = cell(row, "absent", "ab");
    const absent = /^(y|yes|1|ab|absent|true)$/i.test(absentRaw);
    const raw = cell(row, "marks", "score", "mark", "obtained");
    if (!absent && raw === "") {
      skipped.push(student.name);
      continue;
    }
    const marks = absent ? 0 : Number(raw);
    if (Number.isNaN(marks) || marks < 0) throw new Error(`Marks for ${student.name} must be a number`);
    if (marks > exam.maxMarks) throw new Error(`${student.name}: marks cannot exceed ${exam.maxMarks}`);
    await prisma.examResult.upsert({
      where: { examId_studentId: { examId, studentId: student.id } },
      update: { marks, absent },
      create: { examId, studentId: student.id, marks, absent },
    });
    saved += 1;
  }
  if (!saved) throw new Error(skipped[0] ? `Could not match ${skipped[0]}. Use admission number.` : "No marks in that sheet.");
  return { saved, skipped: skipped.length };
}

export async function completeExamWorkCore(
  user: AccessUser,
  input: { examId?: string; kind?: string; done?: boolean | string | number }
) {
  const examId = String(input.examId || "");
  const kind = String(input.kind || "");
  if (!examId || (kind !== "paper" && kind !== "copies")) throw new Error("Pick a paper task");
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { evaluators: true } });
  if (!exam) throw new Error("Exam not found");
  await needExamClass(user, exam.classId, "mark");
  if (user.portal === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({ where: { userId: user.id } });
    if (!teacher) throw new Error("Not your paper");
    if (kind === "paper" && paperSetterId(exam) !== teacher.id) throw new Error("Only the setter marks the paper done");
    if (kind === "copies" && !grantedEvaluatorIds(exam).includes(teacher.id)) throw new Error("Only a teacher allowed to enter marks can mark copies done");
  }
  const on = input.done !== false && input.done !== "0" && input.done !== 0;
  await prisma.exam.update({
    where: { id: examId },
    data: kind === "paper" ? { paperAt: on ? new Date() : null } : { copiesDoneAt: on ? new Date() : null },
  });
  if (kind === "paper" && on) {
    const ctx = await loadExamNoticeCtx(examId);
    if (ctx) await notifyPaperSubmitted(ctx, user.id);
  }
}

export async function uploadPaperCore(
  user: AccessUser,
  input: { examId: string; studentId: string; type?: string; notes?: string; fileName: string; filePath: string }
) {
  need(user, "papers.upload");
  const examId = String(input.examId || "");
  const studentId = String(input.studentId || "");
  if (!examId || !studentId || !input.filePath) throw new Error("Exam, student and file are required");
  const allowed: PaperType[] = ["MARK_SHEET", "ANSWER_SHEET", "EVALUATED"];
  const type = (allowed.includes(input.type as PaperType) ? input.type : "EVALUATED") as PaperType;
  await prisma.examPaper.create({
    data: {
      examId,
      studentId,
      teacherId: user.id,
      type,
      fileName: input.fileName,
      filePath: input.filePath,
      notes: String(input.notes || "") || null,
    },
  });
}

export async function uploadQuestionPaperCore(
  user: AccessUser,
  input: { examId: string; fileName: string; filePath: string; mime?: string }
) {
  need(user, "papers.upload", "exams.edit");
  const examId = String(input.examId || "");
  if (!examId || !input.filePath) throw new Error("Exam and question paper are required");
  if (!isQuestionPaperFile(input.fileName, input.mime || "")) {
    throw new Error("Upload the question paper as a PDF or Word file. Spreadsheets and CSVs are not question papers.");
  }
  const exam = await prisma.exam.findUnique({ where: { id: examId }, include: { teacher: true } });
  if (!exam) throw new Error("Exam not found");
  if (user.portal === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({ where: { userId: user.id } });
    const setterId = exam.setterId || exam.teacherId;
    if (!teacher || teacher.id !== setterId) throw new Error("Only the question teacher can set this paper");
  }
  await prisma.exam.update({
    where: { id: examId },
    data: { paperFileName: input.fileName, paperFilePath: input.filePath, paperAt: new Date() },
  });
  const ctx = await loadExamNoticeCtx(examId);
  if (ctx) await notifyPaperSubmitted(ctx, user.id);
}

export async function grantExamMarksCore(user: AccessUser, input: { examId?: string; teacherId?: string; remove?: boolean | string }) {
  need(user, "exams.edit");
  const examId = String(input.examId || "");
  const teacherId = String(input.teacherId || "");
  if (!examId || !teacherId) throw new Error("Pick the paper and the teacher who will enter marks.");
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: { evaluators: true, subject: true },
  });
  if (!exam) throw new Error("Exam not found");
  if (exam.workflowStatus === "PUBLISHED") throw new Error("Results are already published.");
  const teacher = await prisma.teacher.findUnique({ where: { id: teacherId }, include: { user: { select: { id: true } } } });
  if (!teacher) throw new Error("Teacher not found");
  const removing = input.remove === true || input.remove === "1" || input.remove === "true";
  const current = grantedEvaluatorIds(exam);
  if (removing) {
    if (!current.includes(teacherId)) throw new Error("That teacher is not allowed to enter marks on this paper.");
    await prisma.examEvaluator.deleteMany({ where: { examId, teacherId } });
    const left = await prisma.examEvaluator.count({ where: { examId } });
    await prisma.exam.update({
      where: { id: examId },
      data: { marksGrantedAt: left ? exam.marksGrantedAt : null },
    });
    return { removed: true };
  }
  const eligible = await eligibleTeacherIdsForExam(examId);
  if (!canGrantMarksEntry(teacherId, eligible)) {
    throw new Error("Only a teacher of this subject can be given marks entry. Assign them on Routine first.");
  }
  await ensureExamEvaluator(examId, teacherId);
  await prisma.exam.update({
    where: { id: examId },
    data: {
      teacherId: exam.teacherId || teacherId,
      marksGrantedAt: new Date(),
    },
  });
  const ctx = await loadExamNoticeCtx(examId);
  if (ctx) await notifyMarksGranted(ctx, user.id, [teacher.user.id]);
  return { added: true };
}

export async function importPeopleSheetCore(user: AccessUser, input: { kind?: string; csv?: string }) {
  need(user, "people.edit", "people.import");
  const kind = String(input.kind || "student");
  const rows = parseCsv(String(input.csv || ""));
  if (!rows.length) throw new Error("The sheet is empty. Check the header row.");
  const created: string[] = [];
  const skipped: string[] = [];

  if (kind === "student") {
    const [classes, parents, existing] = await Promise.all([
      prisma.class.findMany({ where: { archivedAt: null } }),
      prisma.parent.findMany({ include: { user: true } }),
      prisma.student.findMany({ select: { admissionNo: true } }),
    ]);
    const taken = new Set(existing.map((s) => s.admissionNo.toLowerCase()));
    const parentByEmail = new Map(parents.map((p) => [p.user.email.toLowerCase(), p]));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = i + 2;
      const name = cell(row, "name");
      const admissionNo = cell(row, "admissionNo", "admission");
      const dob = parseDob(cell(row, "dateOfBirth", "dob"));
      const classRaw = cell(row, "class") || `${cell(row, "className")} ${cell(row, "section")}`.trim();
      const parsedClass = parseClassLabel(classRaw);
      const klass = parsedClass
        ? classes.find((c) => c.name === parsedClass.name && c.section.toUpperCase() === parsedClass.section)
        : classes.find((c) => `${c.name}-${c.section}`.toLowerCase() === classRaw.toLowerCase());
      const parentEmail = cell(row, "parentEmail").toLowerCase();
      if (!name || !admissionNo || !dob || !klass || !parentEmail) {
        skipped.push(`Row ${line}: need name, admission no., date of birth, class, parent email.`);
        continue;
      }
      if (taken.has(admissionNo.toLowerCase())) {
        skipped.push(`Row ${line}: admission ${admissionNo} already exists.`);
        continue;
      }
      let parent = parentByEmail.get(parentEmail);
      if (!parent) {
        const parentName = cell(row, "parentName");
        const parentPhone = normalizeMobile(cell(row, "parentPhone"));
        if (!parentName) {
          skipped.push(`Row ${line}: no parent with ${parentEmail}. Add the parent first.`);
          continue;
        }
        if (!parentPhone) {
          skipped.push(`Row ${line}: parent needs a 10-digit mobile.`);
          continue;
        }
        const password = await bcrypt.hash("12345", 10);
        const userRow = await prisma.user.create({
          data: {
            name: parentName,
            email: parentEmail,
            password,
            roleId: await roleIdBySlug("PARENT"),
            phone: parentPhone,
            parent: { create: { phone: parentPhone } },
          },
          include: { parent: { include: { user: true } } },
        });
        parent = userRow.parent!;
        parentByEmail.set(parentEmail, parent);
      }
      await prisma.student.create({
        data: {
          name,
          admissionNo,
          classId: klass.id,
          parentId: parent.id,
          dateOfBirth: dob,
          interests: { create: parsePathTags(cell(row, "path")).map((tag) => ({ tag: tag as PathTag })) },
        },
      });
      taken.add(admissionNo.toLowerCase());
      created.push(name);
    }
  } else if (kind === "parent") {
    const existing = await prisma.user.findMany({ select: { email: true } });
    const taken = new Set(existing.map((u) => u.email.toLowerCase()));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = i + 2;
      const name = cell(row, "name");
      const email = cell(row, "email").toLowerCase();
      const parentPhone = normalizeMobile(cell(row, "phone"));
      if (!name || !email) {
        skipped.push(`Row ${line}: need name and email.`);
        continue;
      }
      if (!parentPhone) {
        skipped.push(`Row ${line}: need a 10-digit mobile.`);
        continue;
      }
      if (taken.has(email)) {
        skipped.push(`Row ${line}: ${email} already exists.`);
        continue;
      }
      await prisma.user.create({
        data: {
          name,
          email,
          password: await bcrypt.hash(cell(row, "password") || "12345", 10),
          roleId: await roleIdBySlug("PARENT"),
          phone: parentPhone,
          parent: { create: { phone: parentPhone } },
        },
      });
      taken.add(email);
      created.push(name);
    }
  } else if (kind === "teacher") {
    const existingUsers = await prisma.user.findMany({ select: { email: true } });
    const existingTeachers = await prisma.teacher.findMany({ select: { employeeId: true } });
    const takenEmail = new Set(existingUsers.map((u) => u.email.toLowerCase()));
    const takenEmp = new Set(existingTeachers.map((t) => t.employeeId.toLowerCase()));
    const nums = existingTeachers
      .map((t) => Number(String(t.employeeId).replace(/\D/g, "")))
      .filter((n) => Number.isFinite(n));
    let nextEmp = (nums.length ? Math.max(...nums) : 100) + 1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = i + 2;
      const name = cell(row, "name");
      const email = cell(row, "email").toLowerCase();
      const mobile = normalizeMobile(cell(row, "phone"));
      if (!name || !email) {
        skipped.push(`Row ${line}: need name and email.`);
        continue;
      }
      if (!mobile) {
        skipped.push(`Row ${line}: need a 10-digit mobile.`);
        continue;
      }
      if (takenEmail.has(email)) {
        skipped.push(`Row ${line}: ${email} already exists.`);
        continue;
      }
      let employeeId = cell(row, "employeeId");
      if (!employeeId) {
        employeeId = `T-${nextEmp}`;
        nextEmp += 1;
      }
      if (takenEmp.has(employeeId.toLowerCase())) {
        skipped.push(`Row ${line}: employee id ${employeeId} already exists.`);
        continue;
      }
      await prisma.user.create({
        data: {
          name,
          email,
          password: await bcrypt.hash(cell(row, "password") || "12345", 10),
          roleId: await roleIdBySlug("TEACHER"),
          phone: mobile,
          teacher: {
            create: {
              employeeId,
              joinedOn: todayJoinedOn(),
              ...(cell(row, "qualification") ? { qualification: cell(row, "qualification") } : {}),
            },
          },
        },
      });
      takenEmail.add(email);
      takenEmp.add(employeeId.toLowerCase());
      created.push(name);
    }
  } else {
    throw new Error("Unknown sheet type");
  }
  if (!created.length) throw new Error(skipped[0] || "Nothing imported.");
  return { created: created.length, skipped };
}

export async function archiveClassCore(user: AccessUser, input: { classId: string; restore?: boolean }) {
  need(user, "people.edit");
  const classId = String(input.classId || "");
  if (!classId) throw new Error("Class required");
  await prisma.class.update({
    where: { id: classId },
    data: { archivedAt: input.restore ? null : new Date() },
  });
}
