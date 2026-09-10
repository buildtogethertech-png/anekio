import { prisma } from "./prisma";
import { reportUserIds } from "./reports";
import type { AccessScope } from "./permissions";
import { addDays, ymd } from "./exams";
import { isSchoolDay, nextSchoolDay, snapToSchoolDay, type SchoolCalendar } from "./calendar";
import { parseWeekdays } from "./schedule";
import { notifyNoticePublished } from "./push";
import type { Portal } from "./permissions";
import { ensureSchoolSessions } from "./school-session";

export type LeaveTypeRow = {
  id: string;
  name: string;
  forTeacher: boolean;
  forStaff: boolean;
  forStudent: boolean;
  eligibilityGender: string;
  noticeDays: number;
  yearlyCap: number;
  sortOrder: number;
};

export type LeaveRequestRow = {
  id: string;
  typeId: string;
  typeName: string;
  from: string;
  to: string;
  reason: string;
  status: "ACTIVE" | "WAITING" | "REJECTED";
  who: "teacher" | "staff" | "student";
  subjectId: string;
  subjectName: string;
  classLabel: string;
  waitingOn: "guardian" | "teacher" | "";
  days: number;
};

export type UpcomingTeacherLeaveRow = {
  requestId: string;
  teacherId: string;
  teacherName: string;
  typeName: string;
  from: string;
  to: string;
  reason: string;
  covered: number;
  total: number;
  slots: {
    slotId: string;
    date: string;
    period: string;
    startsAt: string;
    endsAt: string;
    classLabel: string;
    subject: string;
    room: string;
    substituteId: string;
    substituteName: string;
    candidates: { id: string; name: string; match: boolean }[];
  }[];
};

export async function loadSchoolCalendar(): Promise<SchoolCalendar> {
  const { current } = await ensureSchoolSessions();
  const [config, holidays] = await Promise.all([
    prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { weekdays: true } }),
    prisma.schoolHoliday.findMany({ where: { sessionId: current.id }, select: { date: true, name: true } }),
  ]);
  return {
    weekdays: parseWeekdays(config?.weekdays),
    holidays: holidays.map((h) => ({ date: h.date, name: h.name })),
  };
}

export function schoolDaysInRange(from: string, to: string, cal: SchoolCalendar) {
  if (!from || !to || from > to) return [] as string[];
  const days: string[] = [];
  let date = from;
  while (date <= to) {
    if (isSchoolDay(date, cal)) days.push(date);
    date = addDays(date, 1);
    if (days.length > 60) break;
  }
  return days;
}

export function earliestLeaveStart(noticeDays: number, cal: SchoolCalendar) {
  const today = ymd(new Date());
  let date = isSchoolDay(today, cal) ? today : snapToSchoolDay(today, cal);
  const n = Math.max(0, Math.round(noticeDays || 0));
  for (let i = 0; i < n; i += 1) date = nextSchoolDay(date, cal);
  return date;
}

export function serializeLeaveType(row: {
  id: string;
  name: string;
  forTeacher: boolean;
  forStaff: boolean;
  forStudent: boolean;
  eligibilityGender?: string | null;
  noticeDays: number;
  yearlyCap: number;
  sortOrder: number;
}): LeaveTypeRow {
  return {
    id: row.id,
    name: row.name,
    forTeacher: row.forTeacher,
    forStaff: row.forStaff,
    forStudent: row.forStudent,
    eligibilityGender: row.eligibilityGender || "ANY",
    noticeDays: row.noticeDays,
    yearlyCap: row.yearlyCap,
    sortOrder: row.sortOrder,
  };
}

export function serializeLeaveRequest(row: {
  id: string;
  typeId: string;
  from: string;
  to: string;
  reason: string;
  status: "ACTIVE" | "WAITING" | "REJECTED";
  guardianAt: Date | null;
  classTeacherAt: Date | null;
  type: { name: string };
  teacher: { id: string; user: { name: string } } | null;
  staff: { id: string; name: string } | null;
  student: { id: string; name: string; class: { name: string; section: string } } | null;
}): LeaveRequestRow {
  const who = row.teacher ? "teacher" : row.staff ? "staff" : "student";
  const subjectId = row.teacher?.id || row.staff?.id || row.student?.id || "";
  const subjectName = row.teacher?.user.name || row.staff?.name || row.student?.name || "";
  const classLabel = row.student ? `${row.student.class.name}-${row.student.class.section}` : "";
  let waitingOn: LeaveRequestRow["waitingOn"] = "";
  if (who === "student" && row.status === "WAITING") {
    waitingOn = row.guardianAt ? "teacher" : "guardian";
  }
  return {
    id: row.id,
    typeId: row.typeId,
    typeName: row.type.name,
    from: row.from,
    to: row.to,
    reason: row.reason,
    status: row.status,
    who,
    subjectId,
    subjectName,
    classLabel,
    waitingOn,
    days: 0,
  };
}

const leaveInclude = {
  type: { select: { name: true } },
  teacher: { select: { id: true, user: { select: { name: true } } } },
  staff: { select: { id: true, name: true } },
  student: { select: { id: true, name: true, class: { select: { name: true, section: true } } } },
} as const;

export async function listLeaveTypes() {
  await ensureLeaveTypes();
  return prisma.leaveType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function ensureLeaveTypes() {
  const count = await prisma.leaveType.count();
  if (count) return;
  await prisma.leaveType.createMany({
    data: [
      { name: "Planned", forTeacher: true, forStaff: true, forStudent: true, noticeDays: 1, yearlyCap: 10, sortOrder: 0 },
      { name: "Sick", forTeacher: true, forStaff: true, forStudent: true, noticeDays: 0, yearlyCap: 8, sortOrder: 1 },
    ],
  });
}

export async function usedLeaveDays(input: {
  typeId: string;
  teacherId?: string | null;
  staffId?: string | null;
  studentId?: string | null;
  cal: SchoolCalendar;
}) {
  const year = String(new Date().getFullYear());
  const rows = await prisma.leaveRequest.findMany({
    where: {
      typeId: input.typeId,
      status: "ACTIVE",
      from: { gte: `${year}-01-01` },
      ...(input.teacherId ? { teacherId: input.teacherId } : {}),
      ...(input.staffId ? { staffId: input.staffId } : {}),
      ...(input.studentId ? { studentId: input.studentId } : {}),
    },
  });
  return rows.reduce((n, r) => n + schoolDaysInRange(r.from, r.to, input.cal).length, 0);
}

async function staffLeaveForManager(userId: string, scope: AccessScope) {
  const seeAll = scope === "SCHOOL";
  const reports = seeAll ? null : await reportUserIds(userId);
  if (!seeAll && !reports?.length) return [];
  const rows = await loadLeaveRequests({
    status: { in: ["ACTIVE", "WAITING"] },
    ...(seeAll || !reports ? {} : { requesterId: { in: reports } }),
  });
  return rows.filter((r) => r.who !== "student");
}

async function upcomingTeacherLeave(requestIds: string[], cal: SchoolCalendar): Promise<UpcomingTeacherLeaveRow[]> {
  if (!requestIds.length) return [];
  const today = ymd(new Date());
  const until = addDays(today, 7);
  const [requests, teachers, activeLeave, assignedCover] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        id: { in: requestIds },
        status: "ACTIVE",
        teacherId: { not: null },
        from: { lte: until },
        to: { gte: today },
      },
      include: {
        type: { select: { name: true } },
        teacher: {
          include: {
            user: { select: { name: true } },
            slots: {
              include: { period: true, class: true, subject: true, room: true },
            },
          },
        },
        coverAssignments: { include: { substitute: { include: { user: { select: { name: true } } } } } },
      },
      orderBy: [{ from: "asc" }, { createdAt: "asc" }],
    }),
    prisma.teacher.findMany({
      include: {
        user: { select: { name: true } },
        skills: true,
        subjects: { select: { name: true, classId: true } },
        slots: { select: { weekday: true, periodId: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.leaveRequest.findMany({
      where: { status: "ACTIVE", teacherId: { not: null }, from: { lte: until }, to: { gte: today } },
      select: { teacherId: true, from: true, to: true },
    }),
    prisma.substituteAssignment.findMany({
      where: { date: { gte: today, lte: until } },
      include: { slot: { select: { periodId: true } } },
    }),
  ]);

  return requests.flatMap((request) => {
    if (!request.teacher || !request.teacherId) return [];
    const from = request.from < today ? today : request.from;
    const to = request.to > until ? until : request.to;
    const days = schoolDaysInRange(from, to, cal);
    const saved = new Map(request.coverAssignments.map((assignment) => [`${assignment.date}:${assignment.slotId}`, assignment]));
    const slots = days.flatMap((date) => {
      const weekday = new Date(`${date}T00:00:00`).getDay();
      return request.teacher!.slots
        .filter((slot) => slot.weekday === weekday && !slot.period.isBreak)
        .map((slot) => {
          const assignment = saved.get(`${date}:${slot.id}`);
          const candidates = teachers
            .filter((teacher) => teacher.id !== request.teacherId)
            .filter(
              (teacher) =>
                !activeLeave.some((leave) => leave.teacherId === teacher.id && leave.from <= date && leave.to >= date)
            )
            .filter((teacher) => !teacher.slots.some((busy) => busy.weekday === weekday && busy.periodId === slot.periodId))
            .filter(
              (teacher) =>
                !assignedCover.some(
                  (cover) => cover.substituteId === teacher.id && cover.date === date && cover.slot.periodId === slot.periodId
                ) || assignment?.substituteId === teacher.id
            )
            .map((teacher) => ({
              id: teacher.id,
              name: teacher.user.name,
              match: Boolean(
                slot.subject &&
                  (teacher.skills.some(
                    (skill) => skill.classId === slot.classId && skill.subjectName.toLowerCase() === slot.subject!.name.toLowerCase()
                  ) ||
                    teacher.subjects.some(
                      (subject) => subject.classId === slot.classId && subject.name.toLowerCase() === slot.subject!.name.toLowerCase()
                    ))
              ),
            }))
            .sort((a, b) => Number(b.match) - Number(a.match) || a.name.localeCompare(b.name));
          return {
            slotId: slot.id,
            date,
            period: slot.period.name,
            startsAt: slot.period.startsAt,
            endsAt: slot.period.endsAt,
            classLabel: `${slot.class.name}-${slot.class.section}`,
            subject: slot.subject?.name || "Class",
            room: slot.room?.name || "",
            substituteId: assignment?.substituteId || "",
            substituteName: assignment?.substitute.user.name || "",
            candidates,
          };
        });
    });
    return [{
      requestId: request.id,
      teacherId: request.teacherId,
      teacherName: request.teacher.user.name,
      typeName: request.type.name,
      from: request.from,
      to: request.to,
      reason: request.reason,
      covered: slots.filter((slot) => slot.substituteId).length,
      total: slots.length,
      slots,
    }];
  });
}

export async function loadLeaveRequests(where: {
  teacherId?: string;
  staffId?: string;
  requesterId?: { in: string[] };
  studentId?: { in: string[] } | string;
  status?: { in: ("ACTIVE" | "WAITING" | "REJECTED")[] };
}) {
  const rows = await prisma.leaveRequest.findMany({
    where: {
      teacherId: where.teacherId,
      staffId: where.staffId,
      requesterId: where.requesterId,
      studentId: where.studentId,
      status: where.status ? { in: where.status.in } : undefined,
    },
    include: leaveInclude,
    orderBy: { createdAt: "desc" },
  });
  const cal = await loadSchoolCalendar();
  return rows.map((r) => {
    const row = serializeLeaveRequest(r);
    return { ...row, days: schoolDaysInRange(r.from, r.to, cal).length };
  });
}

export async function leaveBundleFor(input: {
  portal: "OFFICE" | "TEACHER" | "PARENT" | "STUDENT";
  userId?: string;
  staffLeaveScope?: AccessScope;
  teacherId?: string | null;
  staffId?: string | null;
  studentIds?: string[];
  classId?: string | null;
}) {
  const types = (await listLeaveTypes()).map(serializeLeaveType);
  const cal = await loadSchoolCalendar();
  const mineWhere =
    input.portal === "TEACHER" && input.teacherId
      ? { teacherId: input.teacherId }
      : input.portal === "OFFICE" && input.staffId
        ? { staffId: input.staffId }
        : input.studentIds?.length
          ? { studentId: { in: input.studentIds } }
          : null;
  const myLeave = mineWhere ? await loadLeaveRequests(mineWhere) : [];
  let pendingLeave: LeaveRequestRow[] = [];
  const teamLeave =
    input.userId && input.staffLeaveScope && (input.portal === "OFFICE" || input.portal === "TEACHER")
      ? await staffLeaveForManager(input.userId, input.staffLeaveScope)
      : [];
  if (input.portal === "OFFICE") {
    pendingLeave = teamLeave;
  } else if (input.portal === "TEACHER" && input.classId) {
    const klass = await prisma.class.findUnique({
      where: { id: input.classId },
      select: { students: { select: { id: true } } },
    });
    const ids = (klass?.students ?? []).map((s) => s.id);
    pendingLeave = ids.length
      ? (await loadLeaveRequests({ studentId: { in: ids }, status: { in: ["WAITING"] } })).filter(
          (r) => r.waitingOn === "teacher"
        )
      : [];
    pendingLeave = [...pendingLeave, ...teamLeave];
  } else if (input.portal === "TEACHER") {
    pendingLeave = teamLeave;
  } else if (input.portal === "PARENT" && input.studentIds?.length) {
    pendingLeave = (await loadLeaveRequests({ studentId: { in: input.studentIds }, status: { in: ["WAITING"] } })).filter(
      (r) => r.waitingOn === "guardian"
    );
  }
  const upcomingLeave = input.portal === "OFFICE"
    ? await upcomingTeacherLeave(
        teamLeave.filter((row) => row.who === "teacher" && row.status === "ACTIVE").map((row) => row.id),
        cal
      )
    : [];
  return { leaveTypes: types, myLeave, pendingLeave, upcomingLeave, calendar: { weekdays: cal.weekdays, holidays: cal.holidays } };
}

export async function postLeaveNotice(input: {
  authorId: string;
  title: string;
  body: string;
  portals: Portal[];
  classIds?: string[];
}) {
  const portals = input.portals;
  const classIds = [...new Set(input.classIds || [])];
  const notice = await prisma.notice.create({
    data: {
      title: input.title,
      body: input.body,
      kind: "LEAVE",
      priority: "INFO",
      authorId: input.authorId,
      audiences: { create: portals.map((portal) => ({ portal })) },
      classes: classIds.length ? { create: classIds.map((classId) => ({ classId })) } : undefined,
    },
  });
  void notifyNoticePublished({
    noticeId: notice.id,
    title: notice.title,
    body: input.body,
    portals,
    classIds,
    authorId: input.authorId,
  }).catch(() => undefined);
}
