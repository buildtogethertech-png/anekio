import { Prisma } from "@prisma/client";
import { paperSetterId } from "./exams";
import { prisma } from "./prisma";
import { notifyNoticeRecipients } from "./push";

const INDIA_TIME_ZONE = "Asia/Kolkata";

function indiaDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function indiaDayStart(value: Date) {
  return new Date(`${indiaDate(value)}T00:00:00+05:30`);
}

export type ExamNotificationRunResult = {
  eligible: number;
  created: number;
  skipped: number;
  recipients: number;
};

function isNoticeEventKeyConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  if (error.meta?.modelName && error.meta.modelName !== "Notice") return false;
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];
  return fields.length === 1 && ["eventKey", "Notice.eventKey", "Notice_eventKey_key"].includes(fields[0]);
}

export async function runExamPaperDeadlineNotifications(
  runAt = new Date()
): Promise<ExamNotificationRunResult> {
  const exams = await prisma.exam.findMany({
    where: {
      paperDueOn: { not: null, lt: indiaDayStart(runAt) },
      paperAt: null,
      OR: [{ setterId: { not: null } }, { teacherId: { not: null } }],
    },
    include: {
      class: { select: { name: true, section: true } },
      subject: { select: { name: true } },
      setter: { include: { user: { select: { id: true, managerId: true } } } },
      teacher: { include: { user: { select: { id: true, managerId: true } } } },
    },
    orderBy: { id: "asc" },
  });
  const examUsers = await prisma.user.findMany({
    where: { role: { grants: { some: { permission: "exams.view" } } } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const examUserIds = examUsers.map((user) => user.id);
  const result: ExamNotificationRunResult = {
    eligible: exams.length,
    created: 0,
    skipped: 0,
    recipients: 0,
  };

  for (const exam of exams) {
    const setter = paperSetterId(exam) === exam.setterId ? exam.setter : exam.teacher;
    if (!setter) {
      result.skipped += 1;
      continue;
    }
    const recipientIds = [...new Set([setter.user.id, ...examUserIds, setter.user.managerId].filter(Boolean))] as string[];
    const dueDate = indiaDate(exam.paperDueOn!);
    const eventKey = `NT-5:${exam.id}:${dueDate}`;
    const classLabel = `${exam.class.name}-${exam.class.section}`;
    const title = `Paper deadline missed: ${exam.subject.name}`;
    const body = `${exam.title} · ${classLabel}\nPaper was due ${dueDate} and is not ready.`;

    const existing = await prisma.notice.findUnique({ where: { eventKey }, select: { id: true } });
    if (existing) {
      result.skipped += 1;
      continue;
    }
    try {
      const notice = await prisma.notice.create({
        data: {
          eventKey,
          title,
          body,
          kind: "EXAM",
          priority: "ACTION",
          authorId: examUserIds[0] || setter.user.id,
          recipients: { create: recipientIds.map((userId) => ({ userId })) },
        },
        select: { id: true },
      });
      result.created += 1;
      result.recipients += recipientIds.length;
      try {
        await notifyNoticeRecipients({ noticeId: notice.id, title, body, userIds: recipientIds });
      } catch {
        // The persisted event is authoritative; Expo delivery is best-effort.
      }
    } catch (error) {
      if (isNoticeEventKeyConflict(error)) {
        result.skipped += 1;
        continue;
      }
      throw error;
    }
  }

  return result;
}
