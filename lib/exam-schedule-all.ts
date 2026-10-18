import { examTimes } from "./exam-time";
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";
import { parseExamPlan } from "./exams";
import { ensureExamEvaluator, teacherIdsBySubjectName } from "./exam-evaluators";
import { emitExactExamNotice, examEventKey, prettyIndiaDay } from "./exam-events";

/**
 * Schedule one school exam (e.g. Term 2) for many classes in one go.
 * Each class gets its own sitting (ExamSeries) with one paper per subject. Sections of a class
 * usually share dates, which the screen handles; here every class simply arrives with its papers.
 * Teachers get ONE message listing all their papers, not one per paper.
 */

type PaperIn = { subjectId?: string; teacherId?: string | null; setterId?: string | null; date?: string; paperDueOn?: string; copiesDueOn?: string; startTime?: string; endTime?: string };
type ClassIn = { classId?: string; papers?: PaperIn[] };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function utcDay(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function addDays(value: string, days: number) {
  const d = utcDay(value);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function scheduleExamForClassesCore(
  user: AccessUser,
  input: { sessionId?: string; planItemId?: string; resultOn?: string; classes?: ClassIn[] }
) {
  if (!can(user, "exams.edit")) throw new Error("No access.");
  const sessionId = String(input.sessionId || "");
  const planItemId = String(input.planItemId || "");
  const session = sessionId ? await prisma.schoolSession.findUnique({ where: { id: sessionId } }) : null;
  if (!session) throw new Error("Session missing");
  const item = parseExamPlan(session.examPlanJson).find((row) => row.id === planItemId);
  if (!item) throw new Error("This exam is not in the year's exam list.");
  const requested = (Array.isArray(input.classes) ? input.classes : []).filter((c) => c?.classId);
  if (!requested.length) throw new Error("Pick at least one class.");

  const teacherIds = new Set((await prisma.teacher.findMany({ select: { id: true } })).map((t) => t.id));
  const problems: string[] = [];
  const plans: {
    classId: string;
    label: string;
    papers: { subjectId: string; subjectName: string; teacherId: string; setterId: string; date: string; paperDueOn: string; copiesDueOn: string; startTime: string; endTime: string }[];
  }[] = [];

  for (const row of requested) {
    const classId = String(row.classId);
    const klass = await prisma.class.findUnique({ where: { id: classId } });
    if (!klass) {
      problems.push("A class was not found.");
      continue;
    }
    const label = `${klass.name}-${klass.section}`;
    const taken = await prisma.examSeries.findFirst({
      where: { classId, sessionId, OR: [{ planItemId }, { name: item.name }] },
      select: { id: true },
    });
    if (taken) {
      problems.push(`${label} already has ${item.name}.`);
      continue;
    }
    const subjects = await prisma.subject.findMany({ where: { classId } });
    if (!subjects.length) {
      problems.push(`${label} has no subjects.`);
      continue;
    }
    const byId = new Map(subjects.map((s) => [s.id, s]));
    const skill = await teacherIdsBySubjectName(classId, subjects.map((s) => s.name));
    const papers: (typeof plans)[number]["papers"] = [];
    for (const paper of Array.isArray(row.papers) ? row.papers : []) {
      const subject = byId.get(String(paper.subjectId || ""));
      if (!subject) continue;
      const date = String(paper.date || "").slice(0, 10);
      const paperDueOn = String(paper.paperDueOn || "").slice(0, 10);
      const copiesDueOn = String(paper.copiesDueOn || "").slice(0, 10);
      if (![date, paperDueOn, copiesDueOn].every((d) => YMD.test(d))) {
        problems.push(`${label} ${subject.name}: every paper needs all three dates.`);
        continue;
      }
      if (paperDueOn >= date) problems.push(`${label} ${subject.name}: paper must be ready before the exam day.`);
      if (copiesDueOn <= date) problems.push(`${label} ${subject.name}: checking must finish after the exam day.`);
      const requestedTeacher = String(paper.teacherId || "");
      const teacherId =
        (requestedTeacher && teacherIds.has(requestedTeacher) ? requestedTeacher : "") ||
        subject.teacherId ||
        skill.get(subject.name) ||
        "";
      if (!teacherId) problems.push(`${label} ${subject.name}: no teacher. Assign one on Staff.`);
      // Who makes the question paper: the same teacher unless the office picked someone else.
      const requestedSetter = String(paper.setterId || "");
      const setterId = requestedSetter && teacherIds.has(requestedSetter) ? requestedSetter : teacherId;
      let times = { startTime: "", endTime: "" };
      try {
        times = examTimes(paper.startTime, paper.endTime);
      } catch (e) {
        problems.push(`${label} ${subject.name}: ${e instanceof Error ? e.message : "check the exam time."}`);
      }
      papers.push({ subjectId: subject.id, subjectName: subject.name, teacherId, setterId, date, paperDueOn, copiesDueOn, ...times });
    }
    if (!papers.length) problems.push(`${label}: no papers.`);
    plans.push({ classId, label, papers });
  }

  if (problems.length) {
    throw new Error(problems.length === 1 ? problems[0] : `${problems[0]} (and ${problems.length - 1} more)`);
  }

  const lastCheck = plans.flatMap((p) => p.papers.map((x) => x.copiesDueOn)).sort().at(-1)!;
  const resultOn = YMD.test(String(input.resultOn || "")) && String(input.resultOn) >= lastCheck ? String(input.resultOn) : addDays(lastCheck, 5);

  const seriesIds: string[] = [];
  for (const plan of plans) {
    const created = await prisma.examSeries.create({
      data: {
        classId: plan.classId,
        sessionId,
        planItemId,
        name: item.name,
        exams: {
          create: plan.papers.map((p) => ({
            orgId: user.orgId ?? null,
            title: `${item.name} · ${p.subjectName}`,
            subjectId: p.subjectId,
            classId: plan.classId,
            maxMarks: item.maxMarks || 80,
            date: utcDay(p.date),
            startTime: p.startTime,
            endTime: p.endTime,
            paperDueOn: utcDay(p.paperDueOn),
            copiesDueOn: utcDay(p.copiesDueOn),
            resultOn: utcDay(resultOn),
            teacherId: p.teacherId,
            setterId: p.setterId || p.teacherId,
          })),
        },
      },
      select: { id: true },
    });
    seriesIds.push(created.id);
  }

  const teachersNotified = await notifyTeachersScheduled(item.name, seriesIds, user.id);
  return {
    classes: plans.length,
    papers: plans.reduce((sum, p) => sum + p.papers.length, 0),
    teachers: teachersNotified,
    seriesIds,
  };
}

/** One message per teacher: every paper they have in this exam, with what they do for each. */
async function notifyTeachersScheduled(examName: string, seriesIds: string[], authorId: string) {
  if (!seriesIds.length) return 0;
  const exams = await prisma.exam.findMany({
    where: { seriesId: { in: seriesIds } },
    include: {
      class: { select: { name: true, section: true } },
      subject: { select: { name: true } },
      teacher: { select: { user: { select: { id: true } } } },
      setter: { select: { user: { select: { id: true } } } },
    },
    orderBy: { date: "asc" },
  });
  const byUser = new Map<string, string[]>();
  const add = (userId: string | undefined, line: string) => {
    if (!userId) return;
    byUser.set(userId, [...(byUser.get(userId) || []), line]);
  };
  for (const exam of exams) {
    const label = `${exam.class.name}-${exam.class.section} ${exam.subject.name}`;
    const day = prettyIndiaDay(exam.date);
    const paperBy = exam.paperDueOn ? prettyIndiaDay(exam.paperDueOn) : "—";
    const checkBy = exam.copiesDueOn ? prettyIndiaDay(exam.copiesDueOn) : "—";
    const checker = exam.teacher?.user.id;
    const maker = exam.setter?.user.id || checker;
    if (maker && maker === checker) {
      add(checker, `• ${label}: paper ready by ${paperBy} · exam ${day} · checking done by ${checkBy}`);
    } else {
      add(maker, `• ${label}: make the question paper by ${paperBy} (exam ${day})`);
      add(checker, `• ${label}: exam ${day} · check copies and enter marks by ${checkBy}`);
    }
  }
  for (const [userId, lines] of byUser) {
    await emitExactExamNotice({
      eventKey: examEventKey(["EXAM_SCHEDULED", seriesIds[0], userId]),
      title: `${examName} scheduled · ${lines.length} paper${lines.length === 1 ? "" : "s"} for you`,
      body: `${lines.join("\n")}\n\nGive question papers to the office by the paper date. Enter marks after checking.`,
      userIds: [userId],
      authorId,
    });
  }
  return byUser.size;
}

/** Hand the paper-making or the checking of one paper to another teacher, at any time. */
export async function reassignExamRoleCore(
  user: AccessUser,
  input: { examId?: string; role?: string; teacherId?: string }
) {
  if (!can(user, "exams.edit")) throw new Error("No access.");
  const role = input.role === "paper" ? "paper" : input.role === "checking" ? "checking" : "";
  if (!role) throw new Error("Pick paper or checking.");
  const exam = await prisma.exam.findUnique({
    where: { id: String(input.examId || "") },
    include: {
      class: { select: { name: true, section: true } },
      subject: { select: { name: true } },
      series: { select: { name: true } },
      teacher: { select: { id: true, user: { select: { id: true, name: true } } } },
      setter: { select: { id: true, user: { select: { id: true, name: true } } } },
    },
  });
  if (!exam) throw new Error("Paper not found.");
  const next = await prisma.teacher.findUnique({
    where: { id: String(input.teacherId || "") },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!next) throw new Error("Pick a teacher.");
  if (role === "paper" && exam.paperAt) throw new Error("The office already has this question paper.");
  if (role === "checking") {
    const marked = await prisma.examResult.count({ where: { examId: exam.id } });
    if (marked || exam.workflowStatus === "PUBLISHED") throw new Error("Marks are already being entered, so the copy checker can't be changed.");
  }

  const old = role === "paper" ? exam.setter || exam.teacher : exam.teacher;
  if (old?.id === next.id) return { changed: false };
  await prisma.exam.update({
    where: { id: exam.id },
    data:
      role === "paper"
        ? { setterId: next.id, paperHandedAt: null, paperHandedById: null, paperHandNote: "", paperReturnNote: "" }
        : { teacherId: next.id },
  });
  if (role === "checking") {
    // Marks entry follows the checking teacher; marks already entered stay.
    if (old?.id) await prisma.examEvaluator.deleteMany({ where: { examId: exam.id, teacherId: old.id } });
    await ensureExamEvaluator(exam.id, next.id);
  }

  const label = `${exam.subject.name} ${exam.class.name}-${exam.class.section}`;
  const exName = exam.series?.name || exam.title;
  const job = role === "paper" ? "make the question paper" : "check copies and enter marks";
  const due = role === "paper" ? exam.paperDueOn : exam.copiesDueOn;
  const stamp = Date.now();
  await emitExactExamNotice({
    eventKey: examEventKey(["EXAM_REASSIGN", exam.id, role, next.id, stamp]),
    title: `${exName} · you now ${job} for ${label}`,
    body: `${due ? `Due ${prettyIndiaDay(due)}. ` : ""}Exam ${prettyIndiaDay(exam.date)}.${old?.user.name ? ` Moved from ${old.user.name}.` : ""}`,
    userIds: [next.user.id],
    authorId: user.id,
  });
  if (old?.user.id && old.user.id !== next.user.id) {
    await emitExactExamNotice({
      eventKey: examEventKey(["EXAM_REASSIGN_OLD", exam.id, role, old.id, stamp]),
      title: `${exName} · ${label} moved to ${next.user.name}`,
      body: `You no longer need to ${job} for ${label}.`,
      userIds: [old.user.id],
      authorId: user.id,
    });
  }
  return { changed: true };
}
