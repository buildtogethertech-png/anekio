import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";
import { examAdminUserIds, emitExactExamNotice, examEventKey } from "./exam-events";
import { validateExamMark } from "./exam-marks";

const SENT_NOT_PUBLISHED = ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED", "APPROVED"];

/**
 * Change marks after they are sent to the office, or after results are published (e.g. a parent query).
 * The change applies at once, every changed mark is kept in history, and admins get a message.
 * A reason is required once results are published. Allowed for the paper's assigned teacher,
 * or office staff who run exams.
 */
export async function editPublishedMarksCore(
  user: AccessUser,
  input: { examId?: string; reason?: string; changes?: { studentId?: string; marks?: string | number | null; absent?: boolean }[] }
) {
  const examId = String(input.examId || "");
  const reason = String(input.reason || "").trim().slice(0, 300);
  if (!examId) throw new Error("Exam required");
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: { class: { select: { name: true, section: true } }, subject: { select: { name: true } }, series: { select: { name: true } } },
  });
  if (!exam) throw new Error("Exam not found");
  const published = exam.workflowStatus === "PUBLISHED";
  if (!published && !SENT_NOT_PUBLISHED.includes(exam.workflowStatus || "")) {
    throw new Error("These marks are not sent yet. Edit them from the marks screen.");
  }
  if (published && reason.length < 3) throw new Error("Write a short reason, e.g. \"Parent query — rechecked page 3\".");
  const action = published ? "EDITED_AFTER_PUBLISH" : "EDITED_AFTER_SUBMIT";
  if (user.portal === "TEACHER") {
    const teacher = await prisma.teacher.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!teacher || teacher.id !== exam.teacherId) throw new Error("Only the paper's teacher can change these marks.");
  } else if (!can(user, "exams.edit")) {
    throw new Error("No access.");
  }

  const students = await prisma.student.findMany({ where: { classId: exam.classId }, select: { id: true, name: true } });
  const names = new Map(students.map((s) => [s.id, s.name]));
  const before = new Map(
    (await prisma.examResult.findMany({ where: { examId } })).map((r) => [r.studentId, r])
  );
  const changed: string[] = [];
  for (const row of Array.isArray(input.changes) ? input.changes : []) {
    const studentId = String(row.studentId || "");
    const name = names.get(studentId);
    if (!name) continue;
    const absent = Boolean(row.absent);
    const raw = String(row.marks ?? "").trim();
    if (!absent && raw === "") continue; // a published sheet keeps every student's mark
    const marks = absent ? 0 : Number(raw);
    validateExamMark(marks, exam.maxMarks, name);
    const old = before.get(studentId);
    if (old && old.absent === absent && old.marks === marks) continue;
    await prisma.examResult.upsert({
      where: { examId_studentId: { examId, studentId } },
      update: { marks, absent, version: { increment: 1 } },
      create: { examId, studentId, marks, absent },
    });
    await prisma.examResultAudit.create({
      data: { examId, studentId, marks, absent, action, note: reason || null, actorId: user.id },
    });
    const was = old ? (old.absent ? "Absent" : String(old.marks)) : "—";
    changed.push(`${name}: ${was} → ${absent ? "Absent" : marks}`);
  }
  if (!changed.length) throw new Error("No marks were changed.");

  const admins = (await examAdminUserIds()).filter((id) => id !== user.id);
  const label = `${exam.class.name}-${exam.class.section}`;
  if (!published) {
    // One FYI notice per paper: later edits refresh it instead of adding more. No approval needed.
    const eventKey = examEventKey(["EXAM", examId, action]);
    const title = `Marks updated · ${exam.subject.name} ${label}`;
    const body = `${exam.series?.name || exam.title} · ${user.name || "Teacher"} updated marks after sending them.${reason ? `\nReason: ${reason}` : ""}`;
    const existing = await prisma.notice.findUnique({ where: { eventKey }, select: { id: true } });
    if (existing) {
      await prisma.notice.update({ where: { id: existing.id }, data: { title, body, createdAt: new Date() } });
    } else {
      await emitExactExamNotice({ eventKey, title, body, userIds: admins, authorId: user.id, priority: "INFO" });
    }
    return { changed: changed.length };
  }
  await emitExactExamNotice({
    eventKey: examEventKey(["EXAM", examId, action, Date.now()]),
    title: `Published marks changed · ${exam.subject.name} ${label}`,
    body: `${exam.series?.name || exam.title} · ${user.name || "Teacher"} changed ${changed.length} mark${changed.length === 1 ? "" : "s"}.\nReason: ${reason}\n${changed.slice(0, 8).join("\n")}${changed.length > 8 ? `\n…and ${changed.length - 8} more` : ""}`,
    userIds: admins,
    authorId: user.id,
    priority: "INFO",
  });
  return { changed: changed.length };
}
