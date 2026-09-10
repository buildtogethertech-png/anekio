import { marksVisible } from "./exams";
import {
  getParentWithChildren,
  getStudentBundle,
  getStudentForUser,
  getTeacherDesk,
  noticesForUser,
} from "./data";
import { classifyNotice } from "./notices";
import { PATH_LABEL, percent } from "./utils";
import type { AccessUser } from "./permissions";
import { prisma } from "./prisma";

function attendancePct(attendance: { status: string }[]) {
  if (!attendance.length) return 0;
  const present = attendance.filter((a) => a.status !== "ABSENT").length;
  return Math.round((present / attendance.length) * 100);
}

function examAvg(child: NonNullable<Awaited<ReturnType<typeof getStudentBundle>>>) {
  const visible = child.examResults.filter((r) => marksVisible(r.exam));
  if (!visible.length) return 0;
  return Math.round(visible.reduce((n, r) => n + percent(r.marks, r.exam.maxMarks), 0) / visible.length);
}

function childCard(child: NonNullable<Awaited<ReturnType<typeof getStudentBundle>>>) {
  return {
    id: child.id,
    name: child.name,
    classLabel: `${child.class.name}-${child.class.section}`,
    attendancePct: attendancePct(child.attendance),
    avgPct: examAvg(child),
    interests: child.interests.map((i) => PATH_LABEL[i.tag] || i.tag),
  };
}

export async function schoolName() {
  const config = await prisma.schoolConfig.findUnique({
    where: { id: "school" },
    select: { name: true },
  });
  return config?.name || "School";
}

export async function homePayload(user: AccessUser, requestedChildId?: string | null) {
  const school = await schoolName();

  if (user.portal === "PARENT") {
    const parent = await getParentWithChildren(user.id);
    const students = parent?.students ?? [];
    const childId =
      students.find((s) => s.id === requestedChildId)?.id ?? students[0]?.id ?? null;
    const child = childId ? await getStudentBundle(childId) : null;
    return {
      kind: "PARENT" as const,
      school,
      kicker: "Parent · Reports",
      title: child?.name || "The child",
      lede: students.length
        ? `${students.length} children on this login. Switch. See the whole human — not a marksheet.`
        : "No children on this login yet.",
      children: students.map((s) => ({
        id: s.id,
        name: s.name,
        classLabel: `${s.class.name}-${s.class.section}`,
      })),
      child: child ? childCard(child) : null,
    };
  }

  if (user.portal === "STUDENT") {
    const me = await getStudentForUser(user.id);
    const child = me ? await getStudentBundle(me.id) : null;
    return {
      kind: "STUDENT" as const,
      school,
      kicker: "Today",
      title: "Today",
      lede: child ? `${child.class.name}-${child.class.section} · Adm ${child.admissionNo}` : "Your day at school.",
      child: child ? childCard(child) : null,
    };
  }

  if (user.portal === "TEACHER") {
    const desk = await getTeacherDesk(user.id);
    return {
      kind: "TEACHER" as const,
      school,
      kicker: "Teacher · Reports",
      title: "The desk",
      lede: desk?.classTeacher
        ? `Morning work for ${desk.classLabel}.`
        : "Papers you set or mark.",
      classLabel: desk?.classLabel || "",
      classTeacher: Boolean(desk?.classTeacher),
      markedToday: Boolean(desk?.markedToday),
    };
  }

  return {
    kind: "OFFICE" as const,
    school,
    kicker: "Office · Reports",
    title: "The desk",
    lede: `${school}. Same map as the website — phone layout.`,
    name: user.name || user.roleName,
  };
}

export function serializeNotice(
  n: Awaited<ReturnType<typeof noticesForUser>>[number]
) {
  const { kind } = classifyNotice(n);
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    kind,
    eventKey: n.eventKey || "",
    createdAt: n.createdAt.toISOString(),
    author: n.author.name,
    studentId: n.studentId,
    classes: n.classes.map((c) => ({
      id: c.classId,
      label: `${c.class.name}-${c.class.section}`,
    })),
  };
}
