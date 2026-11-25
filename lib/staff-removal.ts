import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { CLASS_TEACHER_LINKS, sortClassesByLabel } from "./class-teacher-access";
import { can, type AccessUser } from "./permissions";
import { ymd } from "./exams";

/**
 * Remove an employee (Staff → profile → Remove from staff).
 *
 * Nothing they own today may be left without an owner, so removal is two steps:
 * 1. `staffRemovalPlanCore` lists everything they are doing right now (class teacher, subjects and their
 *    periods, activity periods, unpublished exam papers, upcoming covers, people reporting to them, open
 *    parent conversations) with who it can go to.
 * 2. `removeStaffCore` takes one new owner per item, moves everything in one transaction and archives them.
 *
 * The person is archived, not deleted: past attendance, payroll, leave and marks keep pointing at them.
 * Their login stops working (one who is also a parent keeps a Parent login).
 */

type Kind = "teacher" | "staff";
type Pool = "teacher" | "person";
type PlanItem = { key: string; label: string; detail: string; pool: Pool };
type PlanSection = { key: string; title: string; hint: string; items: PlanItem[] };

const PERIOD_WORD = (n: number) => `${n} period${n === 1 ? "" : "s"} a week`;

async function loadTarget(input: { kind?: string; id?: string }) {
  const kind: Kind = input.kind === "teacher" ? "teacher" : "staff";
  const id = String(input.id || "");
  if (kind === "teacher") {
    const teacher = await prisma.teacher.findUnique({
      where: { id },
      select: { id: true, userId: true, teachingOnly: true, archivedAt: true, user: { select: { name: true } } },
    });
    if (!teacher || teacher.archivedAt || teacher.teachingOnly) throw new Error("Employee not found.");
    return { kind, id, name: teacher.user.name, userId: teacher.userId as string | null, teacher, staffMemberId: null as string | null };
  }
  const staff = await prisma.staffMember.findUnique({ where: { id }, select: { id: true, name: true, userId: true, archivedAt: true } });
  if (!staff || staff.archivedAt) throw new Error("Employee not found.");
  const teacher = await prisma.teacher.findFirst({
    where: { OR: [{ staffMemberId: staff.id }, ...(staff.userId ? [{ userId: staff.userId }] : [])], archivedAt: null },
    select: { id: true, userId: true, teachingOnly: true, archivedAt: true, user: { select: { name: true } } },
  });
  return { kind, id, name: staff.name, userId: staff.userId, teacher, staffMemberId: staff.id };
}

/** Everything the teaching profile owns right now, grouped the way it is handed over. */
async function teachingLoad(teacherId: string, today: string) {
  const [classLinks, subjects, slots, exams, covers, attendanceCovers] = await Promise.all([
    prisma.teacherClass.findMany({ where: { teacherId, classTeacher: true }, select: { class: { select: { id: true, name: true, section: true } } } }),
    prisma.subject.findMany({ where: { teacherId }, select: { id: true, name: true, classId: true, class: { select: { name: true, section: true } } } }),
    prisma.timetableSlot.findMany({
      where: { teacherId },
      select: {
        id: true,
        classId: true,
        subjectId: true,
        activity: true,
        periodId: true,
        weekday: true,
        combinedId: true,
        class: { select: { name: true, section: true } },
        subject: { select: { name: true } },
      },
    }),
    prisma.exam.findMany({
      where: { workflowStatus: { not: "PUBLISHED" }, OR: [{ teacherId }, { setterId: teacherId }] },
      select: {
        id: true,
        title: true,
        teacherId: true,
        setterId: true,
        paperAt: true,
        date: true,
        classId: true,
        subjectId: true,
        class: { select: { name: true, section: true } },
        subject: { select: { name: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.substituteAssignment.findMany({
      where: { substituteId: teacherId, date: { gte: today } },
      select: { id: true, date: true, slot: { select: { periodId: true, weekday: true, period: { select: { name: true } }, class: { select: { name: true, section: true } } } } },
      orderBy: { date: "asc" },
    }),
    prisma.classAttendanceCover.findMany({
      where: { teacherId, date: { gte: today } },
      select: { id: true, date: true, class: { select: { name: true, section: true } } },
      orderBy: { date: "asc" },
    }),
  ]);

  // One handover per class + subject (or activity): the subject and all its periods go to the same teacher.
  const groups = new Map<string, { key: string; classId: string; subjectId: string | null; activity: string; label: string; slotIds: string[] }>();
  const groupFor = (classId: string, classLabel: string, subjectId: string | null, subjectName: string, activity: string) => {
    const key = `teach:${classId}:${subjectId || `act:${activity}`}`;
    if (!groups.has(key)) groups.set(key, { key, classId, subjectId, activity, label: `${subjectId ? subjectName : activity || "Period"} · ${classLabel}`, slotIds: [] });
    return groups.get(key)!;
  };
  for (const s of subjects) groupFor(s.classId, `${s.class.name}-${s.class.section}`, s.id, s.name, "");
  for (const s of slots) {
    groupFor(s.classId, `${s.class.name}-${s.class.section}`, s.subjectId, s.subject?.name || "", s.activity).slotIds.push(s.id);
  }

  const paper = exams.filter((e) => !e.paperAt && (e.setterId || e.teacherId) === teacherId);
  const checking = exams.filter((e) => e.teacherId === teacherId);
  const classes = sortClassesByLabel(classLinks.map((link) => link.class));
  return { classes, groups: [...groups.values()], slots, paper, checking, covers, attendanceCovers };
}

function examLabel(e: { title: string; class: { name: string; section: string }; subject: { name: string } }) {
  return `${e.subject.name} · ${e.class.name}-${e.class.section}`;
}

function examKey(e: { classId: string; subjectId: string }) {
  return `exams:${e.classId}:${e.subjectId}`;
}

function shortDate(value: string | Date) {
  const d = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

async function activeTeachers(excludeId: string | null) {
  const rows = await prisma.teacher.findMany({
    where: { archivedAt: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true, teachingOnly: true, classes: CLASS_TEACHER_LINKS, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return rows.map((t) => {
    const classes = sortClassesByLabel(t.classes.map((link) => link.class)).map((c) => `${c.name}-${c.section}`);
    return { id: t.id, name: t.user.name, detail: classes.length ? `Class teacher ${classes.join(", ")}` : t.teachingOnly ? "Office · also teaches" : "Teacher" };
  });
}

/** Staff logins that can be a reporting manager or own a parent conversation. */
async function activePeople(excludeUserId: string | null) {
  const rows = await prisma.user.findMany({
    where: { role: { portal: { in: ["OFFICE", "TEACHER"] } }, ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}) },
    select: {
      id: true,
      name: true,
      role: { select: { name: true } },
      teacher: { select: { archivedAt: true, teachingOnly: true } },
      staffMember: { select: { archivedAt: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows
    .filter((u) => !u.staffMember?.archivedAt && !(u.teacher && !u.teacher.teachingOnly && u.teacher.archivedAt))
    .map((u) => ({ id: u.id, name: u.name, detail: u.role.name }));
}

export async function staffRemovalPlanCore(user: AccessUser, input: { kind?: string; id?: string }) {
  if (!can(user, "staff.edit")) throw new Error("You need permission to manage employees.");
  const target = await loadTarget(input);
  if (target.userId && target.userId === user.id) throw new Error("You can't remove yourself.");
  const today = ymd(new Date());
  const sections: PlanSection[] = [];

  if (target.teacher) {
    const load = await teachingLoad(target.teacher.id, today);
    if (load.classes.length) {
      sections.push({
        key: "class",
        title: "Class teacher",
        hint: "Marks attendance and owns the class's leave and parent messages.",
        items: load.classes.map((c) => ({ key: `class:${c.id}`, label: `${c.name}-${c.section}`, detail: "Class teacher", pool: "teacher" as const })),
      });
    }
    if (load.groups.length) {
      sections.push({
        key: "teaching",
        title: "Subjects & periods",
        hint: "The subject and all its weekly periods move together.",
        items: load.groups.map((g) => ({
          key: g.key,
          label: g.label,
          detail: g.slotIds.length ? PERIOD_WORD(g.slotIds.length) : "No periods in the routine yet",
          pool: "teacher" as const,
        })),
      });
    }
    // One row per class + subject: its papers to set and copies to check go to one teacher.
    const examGroups = new Map<string, { label: string; titles: Set<string>; paper: number; checking: number }>();
    for (const [list, role] of [[load.paper, "paper"], [load.checking, "checking"]] as const) {
      for (const e of list) {
        const key = examKey(e);
        const g = examGroups.get(key) || { label: examLabel(e), titles: new Set<string>(), paper: 0, checking: 0 };
        g.titles.add(e.title.split(" · ")[0]);
        g[role] += 1;
        examGroups.set(key, g);
      }
    }
    const examItems: PlanItem[] = [...examGroups].map(([key, g]) => ({
      key,
      label: g.label,
      detail: [[...g.titles].join(", "), g.paper ? `${g.paper} to set` : "", g.checking ? `${g.checking} to check` : ""].filter(Boolean).join(" · "),
      pool: "teacher" as const,
    }));
    if (examItems.length) sections.push({ key: "exams", title: "Exam papers", hint: "Unpublished papers only. Marks already entered stay.", items: examItems });
    const coverItems: PlanItem[] = [
      ...load.covers.map((c) => ({
        key: `cover:${c.id}`,
        label: `${shortDate(c.date)} · ${c.slot.class.name}-${c.slot.class.section}`,
        detail: `Covering ${c.slot.period.name}`,
        pool: "teacher" as const,
      })),
      ...load.attendanceCovers.map((c) => ({
        key: `acover:${c.id}`,
        label: `${shortDate(c.date)} · ${c.class.name}-${c.class.section}`,
        detail: "Marking class attendance",
        pool: "teacher" as const,
      })),
    ];
    if (coverItems.length) sections.push({ key: "covers", title: "Upcoming cover duties", hint: "Substitutions already planned for them.", items: coverItems });
  }

  if (target.userId) {
    const [reports, threads] = await Promise.all([
      prisma.user.findMany({ where: { managerId: target.userId }, select: { id: true, name: true, role: { select: { name: true } } }, orderBy: { name: "asc" } }),
      prisma.inboxThread.findMany({
        where: { assigneeId: target.userId, status: { not: "CLOSED" } },
        select: { id: true, subject: true, studentId: true },
        orderBy: { lastMessageAt: "desc" },
      }),
    ]);
    const studentName = new Map(
      (await prisma.student.findMany({ where: { id: { in: threads.map((t) => t.studentId) } }, select: { id: true, name: true } })).map((s) => [s.id, s.name])
    );
    if (reports.length) {
      sections.push({
        key: "reports",
        title: "Reports to them",
        hint: "Pick a new reporting manager. Leave approvals follow the manager.",
        items: reports.map((r) => ({ key: `report:${r.id}`, label: r.name, detail: r.role.name, pool: "person" as const })),
      });
    }
    if (threads.length) {
      sections.push({
        key: "inbox",
        title: "Open parent conversations",
        hint: "The new owner is added to the conversation.",
        items: threads.map((t) => ({ key: `inbox:${t.id}`, label: t.subject || "Conversation", detail: studentName.get(t.studentId) || "", pool: "person" as const })),
      });
    }
  }

  const pendingLeave = await prisma.leaveRequest.count({
    where: { status: "WAITING", OR: [...(target.teacher ? [{ teacherId: target.teacher.id }] : []), ...(target.staffMemberId ? [{ staffId: target.staffMemberId }] : [])] },
  });
  const notes = [
    "Past attendance, salary, leave and marks stay in records.",
    target.userId ? "Their login stops working." : "",
    pendingLeave ? `${pendingLeave} pending leave request${pendingLeave === 1 ? "" : "s"} will be closed.` : "",
  ].filter(Boolean);

  const needsTeachers = sections.some((s) => s.items.some((i) => i.pool === "teacher"));
  const needsPeople = sections.some((s) => s.items.some((i) => i.pool === "person"));
  return {
    person: { kind: target.kind, id: target.id, name: target.name },
    sections,
    teachers: needsTeachers ? await activeTeachers(target.teacher?.id || null) : [],
    people: needsPeople ? await activePeople(target.userId) : [],
    notes,
  };
}

export async function removeStaffCore(
  user: AccessUser,
  input: { kind?: string; id?: string; picks?: Record<string, string> }
) {
  // Recompute the plan here so an item added since the dialog opened can't be left without an owner.
  const plan = await staffRemovalPlanCore(user, input);
  const target = await loadTarget(input);
  const picks = input.picks || {};
  const teacherIds = new Set(plan.teachers.map((t) => t.id));
  const userIds = new Set(plan.people.map((p) => p.id));
  const nameOf = new Map([...plan.teachers, ...plan.people].map((p) => [p.id, p.name]));

  const missing: string[] = [];
  for (const item of plan.sections.flatMap((s) => s.items)) {
    const to = String(picks[item.key] || "");
    if (!to || !(item.pool === "teacher" ? teacherIds : userIds).has(to)) missing.push(item.label);
  }
  if (missing.length) {
    throw new Error(`Pick who takes over: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}.`);
  }

  const today = ymd(new Date());
  const oldTeacherId = target.teacher?.id || null;
  const load = oldTeacherId ? await teachingLoad(oldTeacherId, today) : null;
  const problems: string[] = [];

  // Periods: the new teacher must be free in each moved period (a combined lesson they already share is fine).
  if (load) {
    const slotById = new Map(load.slots.map((s) => [s.id, s]));
    const byTeacher = new Map<string, typeof load.slots>();
    for (const g of load.groups) {
      const to = picks[g.key];
      byTeacher.set(to, [...(byTeacher.get(to) || []), ...g.slotIds.map((id) => slotById.get(id)!)]);
    }
    for (const [to, moving] of byTeacher) {
      if (!moving.length) continue;
      const busy = await prisma.timetableSlot.findMany({
        where: { teacherId: to, OR: moving.map((s) => ({ periodId: s.periodId, weekday: s.weekday })) },
        select: { periodId: true, weekday: true, combinedId: true, class: { select: { name: true, section: true } } },
      });
      for (const b of busy) {
        const clash = moving.find((s) => s.periodId === b.periodId && s.weekday === b.weekday && !(s.combinedId && s.combinedId === b.combinedId));
        if (clash) problems.push(`${nameOf.get(to)} already teaches ${b.class.name}-${b.class.section} in a period that ${clash.class.name}-${clash.class.section} needs.`);
      }
    }
    for (const c of load.covers) {
      const to = picks[`cover:${c.id}`];
      const [own, cover] = await Promise.all([
        prisma.timetableSlot.count({ where: { teacherId: to, periodId: c.slot.periodId, weekday: c.slot.weekday } }),
        prisma.substituteAssignment.count({ where: { substituteId: to, date: c.date, slot: { periodId: c.slot.periodId } } }),
      ]);
      if (own || cover) problems.push(`${nameOf.get(to)} is busy in that period on ${shortDate(c.date)}.`);
    }
  }
  for (const item of plan.sections.find((s) => s.key === "reports")?.items || []) {
    if (picks[item.key] === item.key.slice("report:".length)) problems.push(`${item.label} can't report to themselves.`);
  }
  if (problems.length) throw new Error([...new Set(problems)].slice(0, 3).join(" "));

  const parentRole = target.userId
    ? await prisma.user.findUnique({ where: { id: target.userId }, select: { parent: { select: { id: true } } } }).then(async (u) =>
        u?.parent ? prisma.role.findUnique({ where: { slug: "PARENT" }, select: { id: true } }) : null
      )
    : null;
  const tombstone = target.userId ? await bcrypt.hash(randomBytes(24).toString("hex"), 10) : "";
  const now = new Date();
  const ops: Prisma.PrismaPromise<unknown>[] = [];

  if (load && oldTeacherId) {
    for (const c of load.classes) {
      const to = picks[`class:${c.id}`];
      ops.push(
        prisma.teacherClass.upsert({
          where: { teacherId_classId: { teacherId: to, classId: c.id } },
          update: { classTeacher: true },
          create: { teacherId: to, classId: c.id, classTeacher: true },
        })
      );
    }
    for (const g of load.groups) {
      const to = picks[g.key];
      if (g.subjectId) ops.push(prisma.subject.updateMany({ where: { id: g.subjectId, teacherId: oldTeacherId }, data: { teacherId: to } }));
      if (g.slotIds.length) ops.push(prisma.timetableSlot.updateMany({ where: { id: { in: g.slotIds } }, data: { teacherId: to } }));
      ops.push(
        prisma.teacherClass.upsert({
          where: { teacherId_classId: { teacherId: to, classId: g.classId } },
          update: {},
          create: { teacherId: to, classId: g.classId },
        })
      );
    }
    for (const e of load.paper) {
      ops.push(
        prisma.exam.update({
          where: { id: e.id },
          data: { setterId: picks[examKey(e)], paperHandedAt: null, paperHandedById: null, paperHandNote: "", paperReturnNote: "" },
        })
      );
    }
    for (const e of load.checking) {
      const to = picks[examKey(e)];
      ops.push(
        prisma.exam.update({ where: { id: e.id }, data: { teacherId: to } }),
        prisma.examEvaluator.deleteMany({ where: { examId: e.id, teacherId: oldTeacherId } }),
        prisma.examEvaluator.upsert({
          where: { examId_teacherId: { examId: e.id, teacherId: to } },
          update: {},
          create: { examId: e.id, teacherId: to },
        })
      );
    }
    for (const c of load.covers) ops.push(prisma.substituteAssignment.update({ where: { id: c.id }, data: { substituteId: picks[`cover:${c.id}`] } }));
    for (const c of load.attendanceCovers) ops.push(prisma.classAttendanceCover.update({ where: { id: c.id }, data: { teacherId: picks[`acover:${c.id}`] } }));
    // Covers planned for their own upcoming leave no longer apply: the periods now belong to someone else.
    ops.push(
      prisma.substituteAssignment.deleteMany({ where: { absentTeacherId: oldTeacherId, date: { gte: today } } }),
      prisma.classAttendanceCover.deleteMany({ where: { absentTeacherId: oldTeacherId, date: { gte: today } } }),
      prisma.teacherClass.deleteMany({ where: { teacherId: oldTeacherId } }),
      prisma.teacherSkill.deleteMany({ where: { teacherId: oldTeacherId } }),
      prisma.teacher.update({ where: { id: oldTeacherId }, data: { activities: "[]", archivedAt: now } })
    );
  }

  if (target.userId) {
    for (const item of plan.sections.find((s) => s.key === "reports")?.items || []) {
      ops.push(prisma.user.update({ where: { id: item.key.slice("report:".length) }, data: { managerId: picks[item.key] } }));
    }
    for (const item of plan.sections.find((s) => s.key === "inbox")?.items || []) {
      const threadId = item.key.slice("inbox:".length);
      ops.push(
        prisma.inboxThread.update({ where: { id: threadId }, data: { assigneeId: picks[item.key] } }),
        prisma.inboxMember.upsert({
          where: { threadId_userId: { threadId, userId: picks[item.key] } },
          update: {},
          create: { threadId, userId: picks[item.key], addedById: user.id },
        })
      );
    }
    // Free their email and number for a future hire; a parent keeps their login, as a parent only.
    ops.push(
      prisma.user.update({
        where: { id: target.userId },
        data: parentRole
          ? { roleId: parentRole.id, managerId: null }
          : { email: `removed+${target.userId}@removed.invalid`, phone: null, password: tombstone, pushToken: null, managerId: null },
      })
    );
  }

  ops.push(
    prisma.leaveRequest.updateMany({
      where: { status: "WAITING", OR: [...(oldTeacherId ? [{ teacherId: oldTeacherId }] : []), ...(target.staffMemberId ? [{ staffId: target.staffMemberId }] : [])] },
      data: { status: "REJECTED", decidedById: user.id, decidedByName: "Removed from staff", decidedAt: now },
    })
  );
  if (target.staffMemberId) ops.push(prisma.staffMember.update({ where: { id: target.staffMemberId }, data: { archivedAt: now } }));

  await prisma.$transaction(ops);
  const moved = plan.sections.reduce((n, s) => n + s.items.length, 0);
  return { removed: target.name, moved };
}
