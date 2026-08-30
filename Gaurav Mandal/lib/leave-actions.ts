import { AttendanceStatus } from "@prisma/client";
import { can, scopeFor, type AccessUser } from "./permissions";
import { prisma } from "./prisma";
import {
  earliestLeaveStart,
  loadSchoolCalendar,
  postLeaveNotice,
  schoolDaysInRange,
} from "./leave";

function dayDate(value: string) {
  const d = new Date(`${value}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function writeStaffLeave(input: {
  days: string[];
  teacherId?: string | null;
  staffId?: string | null;
  markedById: string;
}) {
  for (const day of input.days) {
    const date = dayDate(day);
    if (input.teacherId) {
      await prisma.staffDay.upsert({
        where: { teacherId_date: { teacherId: input.teacherId, date } },
        update: { status: AttendanceStatus.LEAVE, markedById: input.markedById },
        create: { date, status: AttendanceStatus.LEAVE, teacherId: input.teacherId, markedById: input.markedById },
      });
    } else if (input.staffId) {
      await prisma.staffDay.upsert({
        where: { staffId_date: { staffId: input.staffId, date } },
        update: { status: AttendanceStatus.LEAVE, markedById: input.markedById },
        create: { date, status: AttendanceStatus.LEAVE, staffId: input.staffId, markedById: input.markedById },
      });
    }
  }
}

async function clearStaffLeave(input: { days: string[]; teacherId?: string | null; staffId?: string | null }) {
  const dates = input.days.map(dayDate);
  await prisma.staffDay.deleteMany({
    where: {
      status: AttendanceStatus.LEAVE,
      date: { in: dates },
      ...(input.teacherId ? { teacherId: input.teacherId } : {}),
      ...(input.staffId ? { staffId: input.staffId } : {}),
    },
  });
}

async function writeStudentLeave(input: { days: string[]; studentId: string; markedById: string }) {
  for (const day of input.days) {
    const date = dayDate(day);
    await prisma.attendance.upsert({
      where: { studentId_date: { studentId: input.studentId, date } },
      update: { status: AttendanceStatus.LEAVE, markedById: input.markedById },
      create: {
        studentId: input.studentId,
        date,
        status: AttendanceStatus.LEAVE,
        markedById: input.markedById,
      },
    });
  }
}

export async function applyLeave(user: AccessUser, input: { typeId?: string; from?: string; to?: string; reason?: string; studentId?: string }) {
  const typeId = String(input.typeId || "");
  const from = String(input.from || "").slice(0, 10);
  const to = String(input.to || from).slice(0, 10);
  const reason = String(input.reason || "").trim();
  if (!typeId || !from || !to) throw new Error("Pick a leave type and the dates");
  if (from > to) throw new Error("End date is before the start");
  const type = await prisma.leaveType.findUnique({ where: { id: typeId } });
  if (!type) throw new Error("That leave type is gone. Ask the office to set Planned and Sick.");
  const cal = await loadSchoolCalendar();
  const days = schoolDaysInRange(from, to, cal);
  if (!days.length) throw new Error("Those dates are weekly offs or holidays");
  const earliest = earliestLeaveStart(type.noticeDays, cal);
  if (from < earliest) {
    throw new Error(
      type.noticeDays
        ? `${type.name} needs ${type.noticeDays} school day${type.noticeDays === 1 ? "" : "s"} of notice. Use Sick if you need today.`
        : "That start date is too soon"
    );
  }

  const teacher = user.portal === "TEACHER" ? await prisma.teacher.findUnique({ where: { userId: user.id } }) : null;
  const staff = await prisma.staffMember.findUnique({ where: { userId: user.id } });
  const studentSelf = user.portal === "STUDENT" ? await prisma.student.findUnique({ where: { userId: user.id }, include: { class: true, parent: { include: { user: true } } } }) : null;
  const parent = user.portal === "PARENT" ? await prisma.parent.findUnique({ where: { userId: user.id }, include: { students: { include: { class: true } } } }) : null;

  if (user.portal === "TEACHER" || (user.portal === "OFFICE" && !input.studentId)) {
    const teacherId = teacher?.id || null;
    const staffId = teacherId ? null : staff?.id || null;
    if (teacherId && !type.forTeacher) throw new Error("This type is not for teachers");
    if (staffId && !type.forStaff) throw new Error("This type is not for staff");
    if (!teacherId && !staffId) throw new Error("Only teachers and staff on the register can apply");
    await assertNoOverlap({ teacherId, staffId, from, to });
    const created = await prisma.leaveRequest.create({
      data: {
        typeId,
        from,
        to,
        reason,
        status: "WAITING",
        requesterId: user.id,
        teacherId,
        staffId,
      },
    });
    await postLeaveNotice({
      authorId: user.id,
      title: `Leave request · ${user.name || "Staff"}`,
      body: `${user.name} requested ${type.name.toLowerCase()} leave ${prettyRange(from, to)}${reason ? `. ${reason}` : "."}`,
      portals: ["OFFICE"],
    });
    return created;
  }

  if (!type.forStudent) throw new Error("This type is not for students");
  const child =
    studentSelf ||
    parent?.students.find((s) => s.id === String(input.studentId || "")) ||
    parent?.students[0] ||
    null;
  if (!child) throw new Error("Pick the child");
  if (parent && !parent.students.some((s) => s.id === child.id)) throw new Error("Not your child");
  await assertNoOverlap({ studentId: child.id, from, to });
  const parentStarted = user.portal === "PARENT";
  const created = await prisma.leaveRequest.create({
    data: {
      typeId,
      from,
      to,
      reason,
      status: "WAITING",
      requesterId: user.id,
      studentId: child.id,
      guardianAt: parentStarted ? new Date() : null,
    },
  });
  const label = `${child.class.name}-${child.class.section}`;
  if (parentStarted) {
    await postLeaveNotice({
      authorId: user.id,
      title: `Leave waiting · ${child.name}`,
      body: `${child.name} · ${label} · ${type.name} ${prettyRange(from, to)}. Class teacher to approve.`,
      portals: ["TEACHER"],
      classIds: [child.classId],
    });
  } else {
    await postLeaveNotice({
      authorId: user.id,
      title: `Waiting on you · ${child.name}`,
      body: `${child.name} asked for ${type.name.toLowerCase()} leave ${prettyRange(from, to)}. Guardian to approve.`,
      portals: ["PARENT"],
      classIds: [child.classId],
    });
  }
  return created;
}

export async function decideLeave(user: AccessUser, input: { requestId?: string; yes?: boolean }) {
  const requestId = String(input.requestId || "");
  if (!requestId) throw new Error("Leave request missing");
  const yes = input.yes !== false;
  const row = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: {
      type: true,
      teacher: { include: { user: true } },
      staff: { include: { user: true } },
      student: { include: { class: true, parent: { include: { user: true } }, user: true } },
    },
  });
  if (!row) throw new Error("Leave request missing");
  const cal = await loadSchoolCalendar();
  const days = schoolDaysInRange(row.from, row.to, cal);

  if (row.teacherId || row.staffId) {
    const isManager = row.requesterId
      ? (await prisma.user.findUnique({ where: { id: row.requesterId }, select: { managerId: true } }))?.managerId ===
        user.id
      : false;
    const canDecide = can(user, "leave.decide");
    const schoolWide = canDecide && scopeFor(user, "leave.decide") === "SCHOOL";
    if (!canDecide || (!schoolWide && !isManager)) throw new Error("No access.");
    if (row.status === "REJECTED") throw new Error("Already rejected");
    const name = row.teacher?.user.name || row.staff?.name || "Staff";
    if (yes) {
      if (row.status === "ACTIVE") throw new Error("Leave is already approved");
      await prisma.leaveRequest.update({ where: { id: row.id }, data: { status: "ACTIVE" } });
      await writeStaffLeave({ days, teacherId: row.teacherId, staffId: row.staffId, markedById: user.id });
      await postLeaveNotice({
        authorId: user.id,
        title: `Leave approved · ${name}`,
        body: `${name}'s ${row.type.name.toLowerCase()} leave ${prettyRange(row.from, row.to)} was approved.`,
        portals: row.teacherId ? ["TEACHER"] : ["OFFICE"],
      });
      return;
    }
    await prisma.leaveRequest.update({ where: { id: row.id }, data: { status: "REJECTED" } });
    await clearStaffLeave({ days, teacherId: row.teacherId, staffId: row.staffId });
    await postLeaveNotice({
      authorId: user.id,
      title: `Leave rejected · ${name}`,
      body: `${name}'s ${row.type.name.toLowerCase()} leave ${prettyRange(row.from, row.to)} was rejected.`,
      portals: row.teacherId ? ["TEACHER"] : ["OFFICE"],
    });
    return;
  }

  if (!row.student) throw new Error("Leave request missing");
  const child = row.student;
  const parent = user.portal === "PARENT" ? await prisma.parent.findUnique({ where: { userId: user.id } }) : null;
  const teacher = user.portal === "TEACHER" ? await prisma.teacher.findUnique({ where: { userId: user.id } }) : null;
  const isGuardian = Boolean(parent && parent.id === child.parentId);
  const isClassTeacher = Boolean(teacher?.classId && teacher.classId === child.classId);
  if (row.status !== "WAITING") throw new Error("This leave is already decided");

  if (isGuardian && !row.guardianAt) {
    if (!yes) {
      await prisma.leaveRequest.update({ where: { id: row.id }, data: { status: "REJECTED" } });
      await postLeaveNotice({
        authorId: user.id,
        title: `Leave declined · ${child.name}`,
        body: `Guardian declined ${row.type.name.toLowerCase()} leave ${prettyRange(row.from, row.to)}.`,
        portals: ["STUDENT", "TEACHER"],
        classIds: [child.classId],
      });
      return;
    }
    await prisma.leaveRequest.update({ where: { id: row.id }, data: { guardianAt: new Date() } });
    await postLeaveNotice({
      authorId: user.id,
      title: `Leave waiting · ${child.name}`,
      body: `${child.name} · ${child.class.name}-${child.class.section} · ${row.type.name} ${prettyRange(row.from, row.to)}. Class teacher to approve.`,
      portals: ["TEACHER"],
      classIds: [child.classId],
    });
    return;
  }

  if (isClassTeacher) {
    if (!row.guardianAt) throw new Error("Guardian has not said yes yet");
    if (!yes) {
      await prisma.leaveRequest.update({ where: { id: row.id }, data: { status: "REJECTED" } });
      await postLeaveNotice({
        authorId: user.id,
        title: `Leave declined · ${child.name}`,
        body: `Class teacher declined ${row.type.name.toLowerCase()} leave ${prettyRange(row.from, row.to)}.`,
        portals: ["PARENT", "STUDENT"],
        classIds: [child.classId],
      });
      return;
    }
    await prisma.leaveRequest.update({
      where: { id: row.id },
      data: { classTeacherAt: new Date(), status: "ACTIVE" },
    });
    await writeStudentLeave({ days, studentId: child.id, markedById: user.id });
    await postLeaveNotice({
      authorId: user.id,
      title: `Leave granted · ${child.name}`,
      body: `${child.name} has ${row.type.name.toLowerCase()} leave ${prettyRange(row.from, row.to)}.`,
      portals: ["PARENT", "STUDENT"],
      classIds: [child.classId],
    });
    return;
  }

  throw new Error("No access.");
}

export async function assignSubstitute(
  user: AccessUser,
  input: { requestId?: string; slotId?: string; date?: string; substituteId?: string }
) {
  if (!can(user, "leave.decide")) throw new Error("No access.");
  const requestId = String(input.requestId || "");
  const slotId = String(input.slotId || "");
  const date = String(input.date || "").slice(0, 10);
  const substituteId = String(input.substituteId || "");
  if (!requestId || !slotId || !date) throw new Error("Pick a leave period");
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { teacher: true },
  });
  if (!request?.teacherId || request.status !== "ACTIVE") throw new Error("That teacher leave is not active");
  if (scopeFor(user, "leave.decide") !== "SCHOOL") {
    const requester = await prisma.user.findUnique({ where: { id: request.requesterId }, select: { managerId: true } });
    if (requester?.managerId !== user.id) throw new Error("No access.");
  }
  if (date < request.from || date > request.to) throw new Error("That date is outside this leave");
  const slot = await prisma.timetableSlot.findUnique({ where: { id: slotId } });
  const weekday = new Date(`${date}T00:00:00`).getDay();
  if (!slot || slot.teacherId !== request.teacherId || slot.weekday !== weekday) {
    throw new Error("That period is not affected by this leave");
  }
  if (!substituteId) {
    await prisma.substituteAssignment.deleteMany({ where: { date, slotId, leaveRequestId: requestId } });
    return;
  }
  if (substituteId === request.teacherId) throw new Error("Pick another teacher");
  const [substitute, onLeave, regularClass, otherCover] = await Promise.all([
    prisma.teacher.findUnique({ where: { id: substituteId } }),
    prisma.leaveRequest.findFirst({
      where: { teacherId: substituteId, status: "ACTIVE", from: { lte: date }, to: { gte: date } },
    }),
    prisma.timetableSlot.findFirst({
      where: { teacherId: substituteId, weekday, periodId: slot.periodId },
    }),
    prisma.substituteAssignment.findFirst({
      where: { substituteId, date, slot: { periodId: slot.periodId }, NOT: { slotId } },
    }),
  ]);
  if (!substitute) throw new Error("Teacher not found");
  if (onLeave) throw new Error("That teacher is also on leave");
  if (regularClass || otherCover) throw new Error("That teacher is already busy in this period");
  await prisma.substituteAssignment.upsert({
    where: { date_slotId: { date, slotId } },
    update: { leaveRequestId: requestId, substituteId, assignedById: user.id },
    create: { leaveRequestId: requestId, slotId, date, substituteId, assignedById: user.id },
  });
}

async function assertNoOverlap(input: {
  teacherId?: string | null;
  staffId?: string | null;
  studentId?: string | null;
  from: string;
  to: string;
}) {
  const open = await prisma.leaveRequest.findMany({
    where: {
      status: { in: ["ACTIVE", "WAITING"] },
      ...(input.teacherId ? { teacherId: input.teacherId } : {}),
      ...(input.staffId ? { staffId: input.staffId } : {}),
      ...(input.studentId ? { studentId: input.studentId } : {}),
    },
  });
  if (open.some((r) => r.from <= input.to && input.from <= r.to)) {
    throw new Error("Leave already sits on those dates");
  }
}

function prettyRange(from: string, to: string) {
  const a = new Date(`${from}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (from === to) return a;
  const b = new Date(`${to}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return `${a}–${b}`;
}
