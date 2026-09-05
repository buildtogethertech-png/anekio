import { Prisma, type Portal } from "@prisma/client";
import { paperSetterId } from "./exams";
import { prisma } from "./prisma";
import { notifyNoticePublished, notifyNoticeRecipients } from "./push";

const INDIA_TIME_ZONE = "Asia/Kolkata";

export function indiaDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function indiaDayStart(value: Date) {
  return new Date(`${indiaDate(value)}T00:00:00+05:30`);
}

export function daysBetweenIndia(from: Date, to: Date) {
  const a = indiaDayStart(from).getTime();
  const b = indiaDayStart(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function prettyIndiaDay(value: Date | string) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(+dt)) return "";
  return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: INDIA_TIME_ZONE });
}

export function examEventKey(parts: (string | number)[]) {
  return parts.join(":");
}

function isNoticeEventKeyConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (error.meta?.modelName && error.meta.modelName !== "Notice") return false;
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  return fields.length === 1 && ["eventKey", "Notice.eventKey", "Notice_eventKey_key"].includes(fields[0]);
}

export type ExamNoticeCtx = {
  id: string;
  title: string;
  classId: string;
  seriesId?: string | null;
  paperDueOn?: Date | null;
  copiesDueOn?: Date | null;
  resultOn?: Date | null;
  date: Date;
  teacherId?: string | null;
  setterId?: string | null;
  marksGrantedAt?: Date | null;
  class: { name: string; section: string };
  subject: { name: string };
  series?: { id: string; name: string } | null;
  setter?: { user: { id: string; managerId?: string | null } } | null;
  teacher?: { user: { id: string; managerId?: string | null } } | null;
  evaluators?: { teacher: { user: { id: string } } }[];
};

export function examClassLabel(exam: { class: { name: string; section: string } }) {
  return `${exam.class.name}-${exam.class.section}`;
}

export function examSittingName(exam: ExamNoticeCtx) {
  return exam.series?.name || exam.title;
}

async function examAuthorId(fallback?: string | null) {
  if (fallback) return fallback;
  const office = await prisma.user.findFirst({
    where: { role: { portal: "OFFICE" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return office?.id || "";
}

export async function examAdminUserIds() {
  const users = await prisma.user.findMany({
    where: { role: { grants: { some: { permission: "exams.view" } } } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return users.map((user) => user.id);
}

export function evaluatorNoticeUserIds(exam: ExamNoticeCtx) {
  const ids = (exam.evaluators || []).map((row) => row.teacher.user.id);
  if (exam.teacher?.user.id) ids.push(exam.teacher.user.id);
  return [...new Set(ids.filter(Boolean))];
}

export function assignedTeacherUserIds(exam: ExamNoticeCtx) {
  const setter = paperSetterId(exam) === exam.setterId ? exam.setter : exam.teacher;
  return [...new Set([setter?.user.id, ...evaluatorNoticeUserIds(exam)].filter(Boolean))] as string[];
}

export async function emitExactExamNotice(input: {
  eventKey: string;
  title: string;
  body: string;
  userIds: string[];
  authorId?: string | null;
  priority?: string;
}) {
  const recipientIds = [...new Set(input.userIds.filter(Boolean))];
  if (!recipientIds.length) return { created: false, skipped: true, recipients: 0 };
  const existing = await prisma.notice.findUnique({ where: { eventKey: input.eventKey }, select: { id: true } });
  if (existing) return { created: false, skipped: true, recipients: 0 };
  const authorId = await examAuthorId(input.authorId);
  if (!authorId) return { created: false, skipped: true, recipients: 0 };
  try {
    const notice = await prisma.notice.create({
      data: {
        eventKey: input.eventKey,
        title: input.title,
        body: input.body,
        kind: "EXAM",
        priority: input.priority || "ACTION",
        authorId,
        recipients: { create: recipientIds.map((userId) => ({ userId })) },
      },
      select: { id: true },
    });
    try {
      await notifyNoticeRecipients({
        noticeId: notice.id,
        title: input.title,
        body: input.body,
        userIds: recipientIds,
      });
    } catch {
      // Persisted notice is authoritative.
    }
    return { created: true, skipped: false, recipients: recipientIds.length };
  } catch (error) {
    if (isNoticeEventKeyConflict(error)) return { created: false, skipped: true, recipients: 0 };
    throw error;
  }
}

export async function emitClassExamNotice(input: {
  eventKey: string;
  title: string;
  body: string;
  classId: string;
  authorId?: string | null;
  portals?: Portal[];
  priority?: string;
}) {
  const existing = await prisma.notice.findUnique({ where: { eventKey: input.eventKey }, select: { id: true } });
  if (existing) return { created: false, skipped: true };
  const authorId = await examAuthorId(input.authorId);
  if (!authorId) return { created: false, skipped: true };
  const portals = input.portals || (["PARENT", "STUDENT"] as Portal[]);
  try {
    const notice = await prisma.notice.create({
      data: {
        eventKey: input.eventKey,
        title: input.title,
        body: input.body,
        kind: "EXAM",
        priority: input.priority || "HIGH",
        authorId,
        audiences: { create: portals.map((portal) => ({ portal })) },
        classes: { create: [{ classId: input.classId }] },
      },
      select: { id: true },
    });
    try {
      await notifyNoticePublished({
        noticeId: notice.id,
        title: input.title,
        body: input.body,
        portals,
        classIds: [input.classId],
        authorId,
      });
    } catch {
      // Persisted notice is authoritative.
    }
    return { created: true, skipped: false };
  } catch (error) {
    if (isNoticeEventKeyConflict(error)) return { created: false, skipped: true };
    throw error;
  }
}

export async function loadExamNoticeCtx(examId: string) {
  return prisma.exam.findUnique({
    where: { id: examId },
    include: {
      class: { select: { name: true, section: true } },
      subject: { select: { name: true } },
      series: { select: { id: true, name: true } },
      setter: { include: { user: { select: { id: true, managerId: true } } } },
      teacher: { include: { user: { select: { id: true, managerId: true } } } },
      evaluators: { include: { teacher: { include: { user: { select: { id: true } } } } } },
    },
  });
}

export async function notifyExamAssigned(exam: ExamNoticeCtx, authorId?: string | null) {
  const userIds = assignedTeacherUserIds(exam);
  if (!userIds.length) return;
  const classLabel = examClassLabel(exam);
  await emitExactExamNotice({
    eventKey: examEventKey(["EXAM", exam.id, "EXAM_ASSIGNED"]),
    title: `Exam assigned: ${exam.subject.name}`,
    body: `${examSittingName(exam)} · ${classLabel}\nExam date ${prettyIndiaDay(exam.date)}. You can enter marks as soon as the paper is scheduled.`,
    userIds,
    authorId,
  });
}

export async function notifySeriesAssigned(seriesId: string, authorId?: string | null) {
  const series = await prisma.examSeries.findUnique({
    where: { id: seriesId },
    include: {
      exams: {
        include: {
          class: { select: { name: true, section: true } },
          subject: { select: { name: true } },
          series: { select: { id: true, name: true } },
          setter: { include: { user: { select: { id: true, managerId: true } } } },
          teacher: { include: { user: { select: { id: true, managerId: true } } } },
        },
      },
    },
  });
  if (!series) return;
  for (const exam of series.exams) await notifyExamAssigned(exam, authorId);
}

export async function notifySchedulePublished(seriesId: string, authorId?: string | null) {
  const series = await prisma.examSeries.findUnique({
    where: { id: seriesId },
    include: { class: { select: { name: true, section: true } }, exams: { select: { date: true, subject: { select: { name: true } } }, orderBy: { date: "asc" } } },
  });
  if (!series) return;
  const classLabel = `${series.class.name}-${series.class.section}`;
  const lines = series.exams.map((exam) => `${exam.subject.name} · ${prettyIndiaDay(exam.date)}`).join("\n");
  await emitClassExamNotice({
    eventKey: examEventKey(["SERIES", series.id, "EXAM_SCHEDULE_PUBLISHED"]),
    title: `${series.name} examination schedule published`,
    body: `The ${series.name} timetable for ${classLabel} is now available.\n${lines}`,
    classId: series.classId,
    authorId,
  });
}

export async function notifyPaperSubmitted(exam: ExamNoticeCtx, authorId?: string | null) {
  await emitExactExamNotice({
    eventKey: examEventKey(["EXAM", exam.id, "PAPER_SUBMITTED"]),
    title: `Question paper submitted: ${exam.subject.name}`,
    body: `${examSittingName(exam)} · ${examClassLabel(exam)}`,
    userIds: await examAdminUserIds(),
    authorId,
  });
}

export async function notifyMarksGranted(exam: ExamNoticeCtx, authorId?: string | null, userIds?: string[]) {
  const recipients = userIds?.length ? userIds : evaluatorNoticeUserIds(exam);
  for (const userId of recipients) {
    await emitExactExamNotice({
      eventKey: examEventKey(["EXAM", exam.id, "MARKS_GRANTED", userId]),
      title: `Marks entry allowed: ${exam.subject.name}`,
      body: `${examSittingName(exam)} · ${examClassLabel(exam)}\nOffice has allowed you to enter marks for this paper.`,
      userIds: [userId],
      authorId,
    });
  }
}

export async function notifyExamConducted(exam: ExamNoticeCtx, authorId?: string | null) {
  const admins = await examAdminUserIds();
  await emitExactExamNotice({
    eventKey: examEventKey(["EXAM", exam.id, "EXAM_CONDUCTED"]),
    title: `Exam conducted: ${exam.subject.name}`,
    body: `${examSittingName(exam)} · ${examClassLabel(exam)}`,
    userIds: admins,
    authorId,
  });
  const evaluatorId = exam.teacher?.user.id;
  const extra = evaluatorNoticeUserIds(exam);
  const recipients = [...new Set([evaluatorId, ...extra].filter(Boolean))] as string[];
  if (recipients.length && exam.marksGrantedAt) {
    await emitExactExamNotice({
      eventKey: examEventKey(["EXAM", exam.id, "MARKS_ENTRY_OPEN"]),
      title: `Marks entry open: ${exam.subject.name}`,
      body: `${examSittingName(exam)} · ${examClassLabel(exam)}\nEnter marks, then submit for review.`,
      userIds: recipients,
      authorId,
    });
  }
}

export async function notifyMarksSubmitted(exam: ExamNoticeCtx, resubmitted: boolean, authorId?: string | null) {
  const event = resubmitted ? "MARKS_RESUBMITTED" : "MARKS_SUBMITTED";
  await emitExactExamNotice({
    eventKey: examEventKey(["EXAM", exam.id, event]),
    title: resubmitted
      ? `Marks resubmitted: ${exam.subject.name}`
      : `Marks submitted: ${exam.subject.name}`,
    body: `${examSittingName(exam)} · ${examClassLabel(exam)} is ready for review.`,
    userIds: await examAdminUserIds(),
    authorId,
  });
}

export async function notifyMarksCorrection(exam: ExamNoticeCtx, note: string, authorId?: string | null) {
  const recipients = evaluatorNoticeUserIds(exam);
  if (!recipients.length) return;
  await emitExactExamNotice({
    eventKey: examEventKey(["EXAM", exam.id, "MARKS_CORRECTION_REQUIRED", indiaDate(new Date())]),
    title: `Marks correction required: ${exam.subject.name}`,
    body: `${examSittingName(exam)} · ${examClassLabel(exam)}\nAdmin message: ${note}`,
    userIds: recipients,
    authorId,
    priority: "ACTION",
  });
}

export async function notifyMarksReminder(exam: ExamNoticeCtx, authorId?: string | null) {
  const recipients = evaluatorNoticeUserIds(exam);
  const teacherId = exam.teacher?.user.id;
  const userIds = [...new Set([...recipients, teacherId].filter(Boolean))] as string[];
  if (!userIds.length) return;
  await emitExactExamNotice({
    eventKey: examEventKey(["EXAM", exam.id, "MARKS_REMINDER", indiaDate(new Date())]),
    title: `Marks reminder: ${exam.subject.name}`,
    body: `${examSittingName(exam)} · ${examClassLabel(exam)}\nPlease enter or submit marks for this paper.`,
    userIds,
    authorId,
    priority: "ACTION",
  });
}

export async function notifyMarksApproved(exam: ExamNoticeCtx, authorId?: string | null) {
  const evaluatorId = exam.teacher?.user.id;
  if (evaluatorId) {
    await emitExactExamNotice({
      eventKey: examEventKey(["EXAM", exam.id, "MARKS_APPROVED"]),
      title: `Marks approved: ${exam.subject.name}`,
      body: `Your ${exam.subject.name} ${examSittingName(exam)} marks for ${examClassLabel(exam)} have been approved.`,
      userIds: [evaluatorId],
      authorId,
    });
  }
  if (!exam.seriesId) return;
  const series = await prisma.examSeries.findUnique({
    where: { id: exam.seriesId },
    include: { exams: { select: { workflowStatus: true } }, class: { select: { name: true, section: true } } },
  });
  if (!series?.exams.length) return;
  const ready = series.exams.every((row) => row.workflowStatus === "APPROVED" || row.workflowStatus === "PUBLISHED");
  if (!ready) return;
  await emitExactExamNotice({
    eventKey: examEventKey(["SERIES", series.id, "RESULT_READY_TO_PUBLISH"]),
    title: `${series.name} ready to publish`,
    body: `Every paper in ${series.name} · ${series.class.name}-${series.class.section} is approved.`,
    userIds: await examAdminUserIds(),
    authorId,
  });
}

export async function notifyResultsPublished(input: {
  exam?: ExamNoticeCtx | null;
  seriesId?: string | null;
  authorId?: string | null;
}) {
  if (input.exam) {
    await emitClassExamNotice({
      eventKey: examEventKey(["EXAM", input.exam.id, "RESULT_PUBLISHED"]),
      title: `${input.exam.subject.name} result published`,
      body: `Your ${input.exam.subject.name} ${examSittingName(input.exam)} result is now available.`,
      classId: input.exam.classId,
      authorId: input.authorId,
    });
    return;
  }
  if (!input.seriesId) return;
  const series = await prisma.examSeries.findUnique({
    where: { id: input.seriesId },
    include: { class: { select: { name: true, section: true } } },
  });
  if (!series) return;
  await emitClassExamNotice({
    eventKey: examEventKey(["SERIES", series.id, "RESULT_PUBLISHED"]),
    title: `${series.name} results published`,
    body: `Your ${series.name} examination results for ${series.class.name}-${series.class.section} are now available.`,
    classId: series.classId,
    authorId: input.authorId,
  });
}
