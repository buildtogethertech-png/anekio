import { Prisma } from "@prisma/client";
import {
  examAdminUserIds,
  examClassLabel,
  examEventKey,
  examSittingName,
  emitExactExamNotice,
  prettyIndiaDay,
} from "./exam-events";
import { paperSetterId } from "./exams";
import { teacherCanEditMarks } from "./exam-workflow";
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

const examNoticeInclude = {
  class: { select: { name: true, section: true } },
  subject: { select: { name: true } },
  series: { select: { id: true, name: true } },
  setter: { include: { user: { select: { id: true, managerId: true } } } },
  teacher: { include: { user: { select: { id: true, managerId: true } } } },
} as const;

export async function runExamDeadlineReminders(runAt = new Date()): Promise<ExamNotificationRunResult> {
  const today = indiaDate(runAt);
  const exams = await prisma.exam.findMany({
    include: examNoticeInclude,
    orderBy: { id: "asc" },
  });
  const result: ExamNotificationRunResult = { eligible: 0, created: 0, skipped: 0, recipients: 0 };
  const admins = await examAdminUserIds();

  for (const exam of exams) {
    const classLabel = examClassLabel(exam);
    const sitting = examSittingName(exam);
    const setter = paperSetterId(exam) === exam.setterId ? exam.setter : exam.teacher;
    const evaluatorId = exam.teacher?.user.id;

    if (exam.paperDueOn && !exam.paperAt && setter) {
      const due = indiaDate(exam.paperDueOn);
      const delta = daysUntil(due, today);
      if (delta === 2 || delta === 1) {
        result.eligible += 1;
        const sent = await emitExactExamNotice({
          eventKey: examEventKey(["EXAM", exam.id, delta === 1 ? "PAPER_DUE_SOON_1" : "PAPER_DUE_SOON_2", due]),
          title: delta === 1 ? `Question paper due tomorrow: ${exam.subject.name}` : `Question paper due soon: ${exam.subject.name}`,
          body:
            delta === 1
              ? `Please submit the ${exam.subject.name} question paper tomorrow.`
              : `The ${exam.subject.name} paper for ${sitting} — ${classLabel} is due on ${prettyIndiaDay(exam.paperDueOn)}.`,
          userIds: [setter.user.id],
        });
        tally(result, sent);
      } else if (delta === 0) {
        result.eligible += 1;
        const sent = await emitExactExamNotice({
          eventKey: examEventKey(["EXAM", exam.id, "PAPER_DUE_TODAY", due]),
          title: `Question paper due today: ${exam.subject.name}`,
          body: `Please submit the ${exam.subject.name} question paper today.`,
          userIds: [setter.user.id],
        });
        tally(result, sent);
      }
    }

    const examDay = indiaDate(exam.date);
    const examDelta = daysUntil(examDay, today);
    if (evaluatorId && (exam.workflowStatus === "SCHEDULED" || exam.workflowStatus === "IN_PROGRESS")) {
      if (examDelta === 1) {
        result.eligible += 1;
        tally(
          result,
          await emitExactExamNotice({
            eventKey: examEventKey(["EXAM", exam.id, "EXAM_TOMORROW", examDay]),
            title: `Exam tomorrow: ${exam.subject.name}`,
            body: `${sitting} · ${classLabel} is tomorrow.`,
            userIds: [evaluatorId],
          })
        );
      } else if (examDelta === 0) {
        result.eligible += 1;
        tally(
          result,
          await emitExactExamNotice({
            eventKey: examEventKey(["EXAM", exam.id, "EXAM_TODAY", examDay]),
            title: `Exam today: ${exam.subject.name}`,
            body: `${sitting} · ${classLabel} is today.`,
            userIds: [evaluatorId],
          })
        );
      }
    }

    const marksDue = exam.copiesDueOn || exam.resultOn;
    if (marksDue && evaluatorId && teacherCanEditMarks(exam.workflowStatus)) {
      const due = indiaDate(marksDue);
      const delta = daysUntil(due, today);
      const users = delta < 0 ? [...new Set([evaluatorId, ...admins])] : [evaluatorId];
      if (delta === 2 || delta === 1 || delta === 0 || delta < 0) {
        result.eligible += 1;
        const event =
          delta < 0 ? "MARKS_OVERDUE" : delta === 0 ? "MARKS_DUE_TODAY" : delta === 1 ? "MARKS_DUE_SOON_1" : "MARKS_DUE_SOON_2";
        tally(
          result,
          await emitExactExamNotice({
            eventKey: examEventKey(["EXAM", exam.id, event, due]),
            title:
              delta < 0
                ? `Marks overdue: ${exam.subject.name}`
                : delta === 0
                  ? `Marks due today: ${exam.subject.name}`
                  : `Marks due soon: ${exam.subject.name}`,
            body: `${sitting} · ${classLabel}. Marks ${delta < 0 ? `were due ${prettyIndiaDay(marksDue)}` : `are due ${prettyIndiaDay(marksDue)}`}.`,
            userIds: users,
          })
        );
      }
    }

    if (exam.resultOn && exam.workflowStatus === "APPROVED") {
      const due = indiaDate(exam.resultOn);
      const delta = daysUntil(due, today);
      if (delta <= 0) {
        result.eligible += 1;
        tally(
          result,
          await emitExactExamNotice({
            eventKey: examEventKey(["EXAM", exam.id, "RESULT_PUBLICATION_DUE", due]),
            title: `Result publication due: ${exam.subject.name}`,
            body: `${sitting} · ${classLabel} is approved. Publish when the school is ready — ${prettyIndiaDay(exam.resultOn)} was the planned date.`,
            userIds: admins,
          })
        );
      }
    }
  }

  return result;
}

function daysUntil(dueYmd: string, todayYmd: string) {
  const due = new Date(`${dueYmd}T00:00:00+05:30`).getTime();
  const today = new Date(`${todayYmd}T00:00:00+05:30`).getTime();
  return Math.round((due - today) / 86_400_000);
}

function tally(
  result: ExamNotificationRunResult,
  sent: { created: boolean; skipped: boolean; recipients?: number }
) {
  if (sent.created) {
    result.created += 1;
    result.recipients += sent.recipients || 0;
  } else {
    result.skipped += 1;
  }
}

export async function runExamCronNotifications(runAt = new Date()) {
  const paperOverdue = await runExamPaperDeadlineNotifications(runAt);
  const reminders = await runExamDeadlineReminders(runAt);
  return { ...paperOverdue, reminders };
}
