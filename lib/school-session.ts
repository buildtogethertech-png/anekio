import { prisma } from "./prisma";
import { defaultAcademicSession, parseSchoolDate } from "./school";
import { DEFAULT_EXAM_PLAN } from "./exams";

export type SchoolSessionRow = {
  id: string;
  label: string;
  startsOn: string;
  endsOn: string;
  current: boolean;
};

export function sessionLabel(startsOn: string, endsOn: string) {
  const start = parseSchoolDate(startsOn);
  const end = parseSchoolDate(endsOn);
  if (!start || !end) return "Session";
  const a = start.getFullYear();
  const b = end.getFullYear();
  if (a === b) return String(a);
  return `${a}–${String(b).slice(-2)}`;
}

export async function ensureSchoolSessions() {
  let sessions = await prisma.schoolSession.findMany({ orderBy: { startsOn: "desc" } });
  if (!sessions.length) {
    const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
    const fallback = defaultAcademicSession();
    const startsOn = config?.sessionStart || fallback.sessionStart;
    const endsOn = config?.sessionEnd || fallback.sessionEnd;
    const row = await prisma.schoolSession.create({
      data: {
        label: sessionLabel(startsOn, endsOn),
        startsOn,
        endsOn,
        current: true,
        examPlanJson: JSON.stringify(DEFAULT_EXAM_PLAN),
      },
    });
    sessions = [row];
  }
  let current = sessions.find((s) => s.current) ?? sessions[0];
  if (!current.current) {
    await prisma.schoolSession.updateMany({ data: { current: false } });
    current = await prisma.schoolSession.update({
      where: { id: current.id },
      data: { current: true },
    });
  }
  await prisma.feeTemplate.updateMany({
    where: { sessionId: null },
    data: { sessionId: current.id },
  });
  sessions = await prisma.schoolSession.findMany({ orderBy: { startsOn: "desc" } });
  current = sessions.find((s) => s.current) ?? sessions[0];
  return { sessions, current };
}

export function nextSessionDates(current: { startsOn: string; endsOn: string }) {
  const end = parseSchoolDate(current.endsOn) ?? parseSchoolDate(defaultAcademicSession().sessionEnd)!;
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const close = new Date(start.getFullYear() + 1, start.getMonth(), start.getDate() - 1);
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { startsOn: ymd(start), endsOn: ymd(close) };
}

export async function startNextSchoolSession() {
  const { current } = await ensureSchoolSessions();
  const next = nextSessionDates(current);
  const old = await prisma.feeTemplate.findMany({
    where: { sessionId: current.id },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  await prisma.schoolSession.updateMany({ data: { current: false } });
  const created = await prisma.schoolSession.create({
    data: {
      label: sessionLabel(next.startsOn, next.endsOn),
      startsOn: next.startsOn,
      endsOn: next.endsOn,
      current: true,
      examPlanJson: current.examPlanJson || JSON.stringify(DEFAULT_EXAM_PLAN),
      templates: {
        create: old.map((t) => ({
          classId: t.classId,
          name: t.name,
          startsPeriod: t.startsPeriod,
          endsPeriod: t.endsPeriod,
          dueDay: t.dueDay,
          lateKind: t.lateKind,
          lateGraceDays: t.lateGraceDays,
          lateAmount: t.lateAmount,
          lateAfter10: t.lateAfter10,
          lateAfter20: t.lateAfter20,
          lines: {
            create: t.lines.map((l) => ({
              label: l.label,
              kind: l.kind,
              amount: l.amount,
              sortOrder: l.sortOrder,
            })),
          },
        })),
      },
    },
  });
  await prisma.schoolConfig.upsert({
    where: { id: "school" },
    update: { sessionStart: created.startsOn, sessionEnd: created.endsOn },
    create: {
      id: "school",
      sessionStart: created.startsOn,
      sessionEnd: created.endsOn,
    },
  });
  return created;
}

export async function createSchoolSession(input: {
  startsOn: string;
  endsOn: string;
  copyFromId?: string;
  makeCurrent?: boolean;
}) {
  const { sessions } = await ensureSchoolSessions();
  const startsOn = input.startsOn.trim();
  const endsOn = input.endsOn.trim();
  const start = parseSchoolDate(startsOn);
  const end = parseSchoolDate(endsOn);
  if (!start || !end) throw new Error("Set session start and end dates.");
  if (end < start) throw new Error("Session end must be after session start.");
  const label = sessionLabel(startsOn, endsOn);
  const clash = sessions.find((s) => s.startsOn === startsOn && s.endsOn === endsOn);
  if (clash) throw new Error(`${clash.label} already exists.`);
  const overlap = sessions.find((s) => s.startsOn <= endsOn && startsOn <= s.endsOn);
  if (overlap) throw new Error(`Those dates overlap ${overlap.label}.`);

  const copyFromId = input.copyFromId;
  const source = copyFromId
    ? await prisma.schoolSession.findUnique({ where: { id: copyFromId } })
    : null;
  const old = copyFromId
    ? await prisma.feeTemplate.findMany({
        where: { sessionId: copyFromId },
        include: { lines: { orderBy: { sortOrder: "asc" } } },
      })
    : [];
  const makeCurrent = Boolean(input.makeCurrent);
  if (makeCurrent) {
    await prisma.schoolSession.updateMany({ data: { current: false } });
  }
  const created = await prisma.schoolSession.create({
    data: {
      label,
      startsOn,
      endsOn,
      current: makeCurrent,
      examPlanJson: source?.examPlanJson || JSON.stringify(DEFAULT_EXAM_PLAN),
      templates: {
        create: old.map((t) => ({
          classId: t.classId,
          name: t.name,
          startsPeriod: t.startsPeriod,
          endsPeriod: t.endsPeriod,
          dueDay: t.dueDay,
          lateKind: t.lateKind,
          lateGraceDays: t.lateGraceDays,
          lateAmount: t.lateAmount,
          lateAfter10: t.lateAfter10,
          lateAfter20: t.lateAfter20,
          lines: {
            create: t.lines.map((l) => ({
              label: l.label,
              kind: l.kind,
              amount: l.amount,
              sortOrder: l.sortOrder,
            })),
          },
        })),
      },
    },
  });
  if (makeCurrent) {
    await prisma.schoolConfig.upsert({
      where: { id: "school" },
      update: { sessionStart: created.startsOn, sessionEnd: created.endsOn },
      create: {
        id: "school",
        sessionStart: created.startsOn,
        sessionEnd: created.endsOn,
      },
    });
  }
  return created;
}

export async function setCurrentSchoolSession(id: string) {
  const { sessions } = await ensureSchoolSessions();
  const row = sessions.find((s) => s.id === id);
  if (!row) throw new Error("Session missing.");
  await prisma.schoolSession.updateMany({ data: { current: false } });
  await prisma.schoolSession.update({ where: { id }, data: { current: true } });
  await prisma.schoolConfig.upsert({
    where: { id: "school" },
    update: { sessionStart: row.startsOn, sessionEnd: row.endsOn },
    create: { id: "school", sessionStart: row.startsOn, sessionEnd: row.endsOn },
  });
  return row;
}

export async function deleteSchoolSession(id: string) {
  const { sessions, current } = await ensureSchoolSessions();
  if (sessions.length <= 1) throw new Error("Keep at least one session.");
  if (current.id === id) throw new Error("Switch current session first, then delete this one.");
  const templates = await prisma.feeTemplate.findMany({
    where: { sessionId: id },
    select: { id: true },
  });
  if (templates.length) {
    await prisma.feeInvoice.updateMany({
      where: { templateId: { in: templates.map((t) => t.id) } },
      data: { templateId: null },
    });
  }
  await prisma.schoolSession.delete({ where: { id } });
}

export async function syncCurrentSessionDates(startsOn: string, endsOn: string) {
  const { current } = await ensureSchoolSessions();
  await prisma.schoolSession.update({
    where: { id: current.id },
    data: {
      startsOn,
      endsOn,
      label: sessionLabel(startsOn, endsOn),
    },
  });
}
