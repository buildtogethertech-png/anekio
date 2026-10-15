import { Portal } from "@prisma/client";
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";
import { notifyNoticeRecipients } from "./push";

/**
 * Parent ↔ school inbox. A thread is visible only to its members (the parent, whoever it was
 * sent to, and anyone tagged in later) plus staff holding `inbox.viewAll`.
 */

export type InboxTarget = "OFFICE" | "CLASS_TEACHER" | "TEACHER";
export type InboxStatus = "OPEN" | "WAITING" | "CLOSED";

const TARGETS: InboxTarget[] = ["OFFICE", "CLASS_TEACHER", "TEACHER"];
const STATUSES: InboxStatus[] = ["OPEN", "WAITING", "CLOSED"];

function clean(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

/** A running API that predates `prisma db push` still holds the old client without inbox models. */
function ensureInboxTables() {
  if (!(prisma as unknown as Record<string, unknown>).inboxThread) {
    throw new Error("Inbox isn't ready yet. Restart the API (stop npm run api and start it again).");
  }
}

function isStaff(user: AccessUser) {
  return user.portal === Portal.OFFICE || user.portal === Portal.TEACHER;
}

function viewAll(user: AccessUser) {
  return user.portal === Portal.OFFICE && can(user, "inbox.viewAll");
}

/** Office users whose role can read the inbox. */
async function officeInboxUserIds() {
  const users = await prisma.user.findMany({
    where: {
      role: {
        portal: Portal.OFFICE,
        OR: [{ slug: "ADMIN" }, { grants: { some: { permission: "inbox.view" } } }],
      },
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function classTeacherUserId(classId: string) {
  const teacher = await prisma.teacher.findFirst({ where: { classId }, select: { userId: true } });
  return teacher?.userId || "";
}

/** Teachers a parent may write to for this child: anyone with a period or subject in the child's class. */
export async function inboxRecipients(user: AccessUser, studentId: string) {
  ensureInboxTables();
  const student = await childForParent(user, studentId);
  const [classTeacher, teachers] = await Promise.all([
    prisma.teacher.findFirst({ where: { classId: student.classId }, include: { user: { select: { id: true, name: true } } } }),
    prisma.teacher.findMany({
      where: {
        OR: [
          { slots: { some: { classId: student.classId } } },
          { subjects: { some: { classId: student.classId } } },
          { classes: { some: { classId: student.classId } } },
        ],
      },
      include: {
        user: { select: { id: true, name: true } },
        subjects: { where: { classId: student.classId }, select: { name: true } },
      },
    }),
  ]);
  return {
    classTeacher: classTeacher ? { userId: classTeacher.user.id, name: classTeacher.user.name } : null,
    teachers: teachers
      .filter((t) => t.user.id !== classTeacher?.user.id)
      .map((t) => ({ userId: t.user.id, name: t.user.name, subject: t.subjects.map((s) => s.name).join(", ") }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function childForParent(user: AccessUser, studentId: string) {
  if (user.portal !== Portal.PARENT) throw new Error("Only parents can start a conversation here.");
  const parent = await prisma.parent.findUnique({
    where: { userId: user.id },
    include: { students: { select: { id: true, name: true, classId: true } } },
  });
  const child = parent?.students.find((s) => s.id === studentId) || parent?.students[0];
  if (!child) throw new Error("No child is linked to this parent.");
  return child;
}

async function addMembers(threadId: string, userIds: string[], addedById: string) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const existing = await prisma.inboxMember.findMany({ where: { threadId, userId: { in: ids } }, select: { userId: true } });
  const have = new Set(existing.map((m) => m.userId));
  const fresh = ids.filter((id) => !have.has(id));
  if (fresh.length) await prisma.inboxMember.createMany({ data: fresh.map((userId) => ({ threadId, userId, addedById })) });
}

async function pushTo(userIds: string[], exceptId: string, title: string, body: string, threadId: string) {
  const ids = userIds.filter((id) => id && id !== exceptId);
  if (!ids.length) return;
  await notifyNoticeRecipients({ noticeId: threadId, title, body, userIds: ids, kind: "inbox" }).catch(() => undefined);
}

export async function startInboxThreadCore(
  user: AccessUser,
  input: { studentId?: string; target?: string; teacherUserId?: string; subject?: string; topic?: string; message?: string }
) {
  ensureInboxTables();
  const child = await childForParent(user, String(input.studentId || ""));
  const target = (TARGETS.includes(input.target as InboxTarget) ? input.target : "OFFICE") as InboxTarget;
  const message = clean(input.message, 4000);
  if (!message) throw new Error("Write your message.");
  const topic = clean(input.topic, 40);
  const firstLine = message.split(/\n/)[0].trim();
  const subject = clean(input.subject, 120) || (firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine);

  let staffIds: string[] = [];
  if (target === "OFFICE") staffIds = await officeInboxUserIds();
  else if (target === "CLASS_TEACHER") {
    const id = await classTeacherUserId(child.classId);
    if (!id) throw new Error("This class has no class teacher yet. Send it to the office instead.");
    staffIds = [id];
  } else {
    const recipients = await inboxRecipients(user, child.id);
    const pick = [recipients.classTeacher, ...recipients.teachers].find((t) => t?.userId === input.teacherUserId);
    if (!pick) throw new Error("Pick one of your child's teachers.");
    staffIds = [pick.userId];
  }

  const thread = await prisma.inboxThread.create({
    data: { studentId: child.id, parentUserId: user.id, target, subject, topic, createdById: user.id, status: "OPEN" },
  });
  await prisma.inboxMessage.create({
    data: { threadId: thread.id, authorId: user.id, authorName: user.name || "Parent", body: message },
  });
  await prisma.inboxMember.createMany({
    data: [
      { threadId: thread.id, userId: user.id, lastReadAt: new Date() },
      ...staffIds.filter((id) => id !== user.id).map((userId) => ({ threadId: thread.id, userId, addedById: user.id })),
    ],
  });
  void pushTo(staffIds, user.id, `${child.name}'s parent: ${subject}`, message, thread.id);
  return { threadId: thread.id };
}

async function threadForUser(user: AccessUser, threadId: string) {
  ensureInboxTables();
  const thread = await prisma.inboxThread.findUnique({ where: { id: threadId }, include: { members: true } });
  if (!thread) throw new Error("Conversation not found.");
  const member = thread.members.find((m) => m.userId === user.id);
  const parentOwner = user.portal === Portal.PARENT && thread.parentUserId === user.id;
  if (!member && !parentOwner && !(isStaff(user) && viewAll(user))) throw new Error("You are not part of this conversation.");
  return { thread, member };
}

export async function sendInboxMessageCore(user: AccessUser, input: { threadId?: string; body?: string; internal?: boolean }) {
  const { thread } = await threadForUser(user, String(input.threadId || ""));
  const body = clean(input.body, 4000);
  if (!body) throw new Error("Write a message.");
  const staff = isStaff(user);
  if (staff && !can(user, "inbox.manage")) throw new Error("You can read but not reply in the inbox.");
  const internal = staff && Boolean(input.internal);
  await prisma.inboxMessage.create({
    data: { threadId: thread.id, authorId: user.id, authorName: user.name || (staff ? "School" : "Parent"), body, internal },
  });
  // A parent writing reopens the thread; a school reply means the school now waits on the parent.
  const status: InboxStatus = internal ? (thread.status as InboxStatus) : staff ? "WAITING" : "OPEN";
  await prisma.inboxThread.update({ where: { id: thread.id }, data: { lastMessageAt: new Date(), status } });
  await addMembers(thread.id, [user.id], user.id);
  await prisma.inboxMember.updateMany({ where: { threadId: thread.id, userId: user.id }, data: { lastReadAt: new Date() } });
  const memberIds = thread.members.map((m) => m.userId);
  const audience = internal ? memberIds.filter((id) => id !== thread.parentUserId) : memberIds;
  void pushTo(audience, user.id, internal ? `Note · ${thread.subject}` : thread.subject, body, thread.id);
}

export async function updateInboxThreadCore(
  user: AccessUser,
  input: { threadId?: string; status?: string; assigneeId?: string; addUserIds?: string[] }
) {
  if (!isStaff(user) || !can(user, "inbox.manage")) throw new Error("No access.");
  const { thread } = await threadForUser(user, String(input.threadId || ""));
  const events: string[] = [];
  const data: { status?: string; assigneeId?: string } = {};
  if (input.status && STATUSES.includes(input.status as InboxStatus) && input.status !== thread.status) {
    data.status = input.status;
    events.push(input.status === "CLOSED" ? "closed this conversation" : input.status === "OPEN" ? "reopened this conversation" : "marked it waiting on parent");
  }
  const add = [...new Set([...(input.addUserIds || []), ...(input.assigneeId ? [input.assigneeId] : [])])].filter(
    (id) => id && !thread.members.some((m) => m.userId === id)
  );
  if (add.length) {
    const staff = await prisma.user.findMany({
      where: { id: { in: add }, role: { portal: { in: [Portal.OFFICE, Portal.TEACHER] } } },
      select: { id: true, name: true },
    });
    await addMembers(thread.id, staff.map((s) => s.id), user.id);
    if (staff.length) events.push(`added ${staff.map((s) => s.name).join(", ")}`);
    void pushTo(staff.map((s) => s.id), user.id, `You were added · ${thread.subject}`, `${user.name || "Staff"} added you to a parent conversation.`, thread.id);
  }
  if (input.assigneeId !== undefined && input.assigneeId !== thread.assigneeId) {
    data.assigneeId = String(input.assigneeId || "");
    if (data.assigneeId) {
      const who = await prisma.user.findUnique({ where: { id: data.assigneeId }, select: { name: true } });
      events.push(`assigned it to ${who?.name || "a staff member"}`);
    } else events.push("cleared the assignee");
  }
  if (Object.keys(data).length) await prisma.inboxThread.update({ where: { id: thread.id }, data });
  if (events.length) {
    await prisma.inboxMessage.create({
      data: {
        threadId: thread.id,
        authorId: user.id,
        authorName: user.name || "Staff",
        body: `${user.name || "Staff"} ${events.join(" and ")}`,
        internal: !data.status || data.status === "WAITING",
        kind: "EVENT",
      },
    });
  }
}

type ThreadRow = Awaited<ReturnType<typeof loadThreads>>[number];

async function loadThreads(where: object) {
  return prisma.inboxThread.findMany({
    where,
    include: {
      members: true,
      messages: { orderBy: { createdAt: "desc" }, take: 6 },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 300,
  });
}

async function describeThreads(user: AccessUser, rows: ThreadRow[]) {
  const studentIds = [...new Set(rows.map((r) => r.studentId))];
  const userIds = [...new Set(rows.flatMap((r) => [r.parentUserId, r.assigneeId, ...r.members.map((m) => m.userId)]).filter(Boolean))];
  const [students, users] = await Promise.all([
    prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true, class: { select: { name: true, section: true } } } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, phone: true, role: { select: { name: true, portal: true } } } }),
  ]);
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  const parentView = user.portal === Portal.PARENT;
  return rows.map((r) => {
    const s = studentMap.get(r.studentId);
    const visible = r.messages.filter((m) => !parentView || !m.internal);
    const last = visible[0];
    const me = r.members.find((m) => m.userId === user.id);
    const unread = Boolean(last && last.authorId !== user.id && (!me?.lastReadAt || me.lastReadAt < last.createdAt));
    const staffMembers = r.members.filter((m) => m.userId !== r.parentUserId).map((m) => userMap.get(m.userId)).filter(Boolean);
    const parent = userMap.get(r.parentUserId);
    return {
      id: r.id,
      subject: r.subject,
      topic: r.topic,
      status: r.status as InboxStatus,
      target: r.target as InboxTarget,
      withLabel:
        r.target === "OFFICE"
          ? "Office"
          : r.target === "CLASS_TEACHER"
            ? `Class teacher${staffMembers[0] ? ` · ${staffMembers[0]!.name}` : ""}`
            : staffMembers[0]?.name || "Teacher",
      student: { id: r.studentId, name: s?.name || "Student", classLabel: s ? `${s.class.name}-${s.class.section}` : "" },
      parent: { userId: r.parentUserId, name: parent?.name || "Parent", phone: parentView ? "" : parent?.phone || "" },
      assignee: r.assigneeId ? { userId: r.assigneeId, name: userMap.get(r.assigneeId)?.name || "" } : null,
      members: parentView ? [] : staffMembers.map((m) => ({ userId: m!.id, name: m!.name, role: m!.role?.name || "" })),
      isMember: Boolean(me),
      lastMessage: last ? { body: last.body, authorName: last.authorName, internal: last.internal, kind: last.kind, at: last.createdAt.toISOString() } : null,
      lastMessageAt: r.lastMessageAt.toISOString(),
      unread,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

/** Threads this user can see: their own (parent), ones they are a member of, or all (inbox.viewAll). */
export async function listInboxThreads(user: AccessUser) {
  ensureInboxTables();
  if (!can(user, "inbox.view") && user.portal !== Portal.PARENT) throw new Error("No access.");
  const where =
    user.portal === Portal.PARENT
      ? { parentUserId: user.id }
      : viewAll(user)
        ? {}
        : { members: { some: { userId: user.id } } };
  return describeThreads(user, await loadThreads(where));
}

export async function inboxThreadDetail(user: AccessUser, threadId: string) {
  ensureInboxTables();
  const { thread, member } = await threadForUser(user, threadId);
  if (member) await prisma.inboxMember.update({ where: { id: member.id }, data: { lastReadAt: new Date() } });
  const [row] = await describeThreads(user, await loadThreads({ id: thread.id }));
  const messages = await prisma.inboxMessage.findMany({
    where: { threadId: thread.id, ...(user.portal === Portal.PARENT ? { internal: false } : {}) },
    orderBy: { createdAt: "asc" },
  });
  const authorIds = [...new Set(messages.map((m) => m.authorId))];
  const authors = await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, role: { select: { name: true } } } });
  const roleOf = new Map(authors.map((a) => [a.id, a.role?.name || ""]));
  const taggable = isStaff(user)
    ? (
        await prisma.user.findMany({
          where: { role: { portal: { in: [Portal.OFFICE, Portal.TEACHER] } } },
          select: { id: true, name: true, role: { select: { name: true } } },
          orderBy: { name: "asc" },
        })
      ).map((u) => ({ userId: u.id, name: u.name, role: u.role?.name || "" }))
    : [];
  return {
    thread: row,
    messages: messages.map((m) => ({
      id: m.id,
      authorId: m.authorId,
      authorName: m.authorName,
      authorRole: m.authorId === thread.parentUserId ? "Parent" : roleOf.get(m.authorId) || "School",
      body: m.body,
      internal: m.internal,
      kind: m.kind,
      mine: m.authorId === user.id,
      fromParent: m.authorId === thread.parentUserId,
      at: m.createdAt.toISOString(),
    })),
    taggable,
  };
}
