import type { Portal } from "@prisma/client";
import type { AccessUser } from "./permissions";
import { prisma } from "./prisma";

const EXPO_PUSH = "https://exp.host/--/api/v2/push/send";
const EXACT_RECIPIENT_PUSH_TIMEOUT_MS = 10_000;

export async function savePushTokenCore(user: AccessUser, input: { token?: string }) {
  const token = String(input.token || "").trim();
  if (token && !/^ExponentPushToken\[.+\]$/.test(token)) {
    throw new Error("Bad push token.");
  }
  if (token) {
    await prisma.user.updateMany({
      where: { pushToken: token, id: { not: user.id } },
      data: { pushToken: null },
    });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { pushToken: token || null },
  });
}

export async function notifyNoticePublished(input: {
  noticeId: string;
  title: string;
  body: string;
  portals: Portal[];
  classIds: string[];
  authorId: string;
  studentId?: string | null;
}) {
  const users = await prisma.user.findMany({
    where: {
      id: { not: input.authorId },
      pushToken: { not: null },
      role: { portal: { in: input.portals } },
    },
    include: {
      role: { select: { portal: true } },
      teacher: { include: { subjects: true, classes: true } },
      parent: { include: { students: { select: { id: true, classId: true } } } },
      student: { select: { id: true, classId: true } },
    },
  });
  const tokens = users
    .filter((u) => noticeReachesUser(u, input.classIds, input.studentId))
    .map((u) => u.pushToken)
    .filter((t): t is string => Boolean(t));
  if (!tokens.length) return;
  const messages = tokens.map((to) => ({
    to,
    sound: "default" as const,
    title: input.title,
    body: input.body.slice(0, 140),
    data: { kind: "notice", noticeId: input.noticeId },
    channelId: "notices",
  }));
  for (let i = 0; i < messages.length; i += 100) {
    await fetch(EXPO_PUSH, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
  }
}

export async function notifyNoticeRecipients(input: {
  noticeId: string;
  title: string;
  body: string;
  userIds: string[];
}) {
  const users = await prisma.user.findMany({
    where: {
      id: { in: [...new Set(input.userIds)] },
      pushToken: { not: null },
    },
    select: { pushToken: true },
  });
  const tokens = [...new Set(users.map((user) => user.pushToken).filter((token): token is string => Boolean(token)))];
  if (!tokens.length) return;
  const messages = tokens.map((to) => ({
    to,
    sound: "default" as const,
    title: input.title,
    body: input.body.slice(0, 140),
    data: { kind: "notice", noticeId: input.noticeId },
    channelId: "notices",
  }));
  for (let i = 0; i < messages.length; i += 100) {
    try {
      const response = await fetch(EXPO_PUSH, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(messages.slice(i, i + 100)),
        signal: AbortSignal.timeout(EXACT_RECIPIENT_PUSH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Expo push failed with HTTP ${response.status}`);
    } catch {
      // Each Expo chunk is independent; continue attempting later chunks.
    }
  }
}

function noticeReachesUser(
  user: {
    role: { portal: Portal };
    teacher: { classId: string | null; subjects: { classId: string }[]; classes: { classId: string }[] } | null;
    parent: { students: { id: string; classId: string }[] } | null;
    student: { id: string; classId: string } | null;
  },
  classIds: string[],
  studentId?: string | null
) {
  if (studentId) {
    if (user.role.portal === "PARENT") return (user.parent?.students ?? []).some((s) => s.id === studentId);
    if (user.role.portal === "STUDENT") return user.student?.id === studentId;
    return false;
  }
  if (!classIds.length || user.role.portal === "OFFICE") return true;
  if (user.role.portal === "TEACHER") {
    const ids = new Set<string>();
    if (user.teacher?.classId) ids.add(user.teacher.classId);
    for (const s of user.teacher?.subjects ?? []) ids.add(s.classId);
    for (const c of user.teacher?.classes ?? []) ids.add(c.classId);
    return classIds.some((id) => ids.has(id));
  }
  if (user.role.portal === "PARENT") {
    return (user.parent?.students ?? []).some((s) => classIds.includes(s.classId));
  }
  if (user.role.portal === "STUDENT") {
    return Boolean(user.student && classIds.includes(user.student.classId));
  }
  return false;
}
