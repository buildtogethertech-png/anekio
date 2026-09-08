import { PrismaClient } from "@prisma/client";
import { seedExamDemo } from "../prisma/seed-exams";

const prisma = new PrismaClient();
const API = process.env.ANEKIO_API || "http://localhost:4000";

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];

function pass(name: string, detail = "ok") {
  checks.push({ name, ok: true, detail });
}

function fail(name: string, detail: string) {
  checks.push({ name, ok: false, detail });
}

async function login(loginId: string) {
  const res = await fetch(`${API}/api/v1/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: loginId, password: "12345" }),
  });
  const body = (await res.json()) as { token?: string; error?: string };
  if (!res.ok || !body.token) throw new Error(`${loginId}: ${body.error || res.status}`);
  return body.token;
}

async function act(token: string, op: string, payload: Record<string, unknown>) {
  const res = await fetch(`${API}/api/v1/act`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, ...payload }),
  });
  const body = (await res.json()) as { error?: string; ok?: boolean };
  if (!res.ok) throw new Error(body.error || `${op} ${res.status}`);
  return body;
}

async function record(token: string) {
  const res = await fetch(`${API}/api/v1/record`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`record: ${(body as { error?: string }).error || res.status}`);
  return body as Record<string, any>;
}

async function expectActFail(token: string, op: string, payload: Record<string, unknown>, name: string) {
  try {
    await act(token, op, payload);
    fail(name, "expected this action to be rejected");
  } catch (error) {
    pass(name, error instanceof Error ? error.message : "rejected");
  }
}

function marksFor(students: { id: string }[], maxMarks: number) {
  return students.map((student, i) => {
    const absent = i === 2;
    return {
      studentId: student.id,
      marks: absent ? "" : String(Math.min(maxMarks, 40 + (i % 6) * 5)),
      absent,
    };
  });
}

async function examByTitle(classId: string, title: string) {
  return prisma.exam.findFirstOrThrow({
    where: { classId, title: { contains: title } },
    include: { subject: true, class: true },
  });
}

async function main() {
  await seedExamDemo(prisma);

  const klass = await prisma.class.findFirstOrThrow({
    where: { name: "1", section: "A" },
    include: { students: { orderBy: { name: "asc" } }, subjects: true },
  });

  const statuses = await prisma.exam.groupBy({
    by: ["workflowStatus"],
    where: { classId: klass.id },
    _count: true,
  });
  const statusSet = new Set(statuses.map((row) => row.workflowStatus));
  const needed = [
    "SCHEDULED",
    "IN_PROGRESS",
    "MARKS_DRAFT",
    "SUBMITTED",
    "UNDER_REVIEW",
    "CORRECTION_REQUIRED",
    "APPROVED",
    "PUBLISHED",
  ];
  for (const status of needed) {
    if (statusSet.has(status as never)) pass(`seed has ${status}`, `${statuses.find((s) => s.workflowStatus === status)?._count || 0} paper(s)`);
    else fail(`seed has ${status}`, "missing");
  }

  const teacherToken = await login("kavita.joshi@school.test");
  const otherTeacherToken = await login("sandeep.gill@school.test");
  const officeToken = await login("exams@school.test");
  const parentToken = await login("parent.1a.1@school.test");
  const studentToken = await login("student.1a.01@school.test");
  pass("demo logins", "teacher, other teacher, office, parent, student");

  const teacherRecord = await record(teacherToken);
  const todos = (teacherRecord.todos || []) as { kind?: string; title?: string; examId?: string }[];
  const kinds = new Set(todos.map((todo) => todo.kind));
  if (kinds.has("paper")) pass("teacher open work: set paper", todos.filter((t) => t.kind === "paper").map((t) => t.title).join("; "));
  else fail("teacher open work: set paper", JSON.stringify(todos.map((t) => t.title)));
  if (kinds.has("take")) pass("teacher open work: take exam", todos.filter((t) => t.kind === "take").map((t) => t.title).join("; "));
  else fail("teacher open work: take exam", JSON.stringify(todos.map((t) => t.title)));
  if (kinds.has("marks")) pass("teacher open work: enter marks", todos.filter((t) => t.kind === "marks").map((t) => t.title).join("; "));
  else fail("teacher open work: enter marks", JSON.stringify(todos.map((t) => t.title)));

  const done = (teacherRecord.doneWork || []) as { examDate?: string; title?: string }[];
  const dates = done.map((row) => row.examDate || "").filter(Boolean);
  const sorted = [...dates].sort((a, b) => {
    const today = new Date().toISOString().slice(0, 10);
    const da = Math.abs(Date.parse(`${a}T00:00:00`) - Date.parse(`${today}T00:00:00`));
    const db = Math.abs(Date.parse(`${b}T00:00:00`) - Date.parse(`${today}T00:00:00`));
    return da - db || b.localeCompare(a);
  });
  if (dates.join() === sorted.join()) pass("completed work nearest-first", dates.slice(0, 4).join(" → "));
  else fail("completed work nearest-first", `got ${dates.slice(0, 6).join(",")} expected ${sorted.slice(0, 6).join(",")}`);

  const takeLab = await examByTitle(klass.id, "Unit Test 2 · English");
  const enterPaper = await examByTitle(klass.id, "Unit Test 1 · English");
  const setPaper = takeLab;
  const submittedPaper = await examByTitle(klass.id, "Unit Test 2 · Mathematics");
  const correctionPaper = await examByTitle(klass.id, "Unit Test 1 · Hindi");
  const approvedPaper = await examByTitle(klass.id, "Unit Test 1 · Social Studies");
  const mathPaper = await examByTitle(klass.id, "Unit Test 1 · Mathematics");

  await expectActFail(
    otherTeacherToken,
    "takeExam",
    { examId: mathPaper.id },
    "wrong teacher cannot take exam"
  );
  await expectActFail(
    otherTeacherToken,
    "saveExamMarks",
    { examId: enterPaper.id, marks: marksFor(klass.students, enterPaper.maxMarks) },
    "wrong teacher cannot enter marks"
  );
  await act(officeToken, "grantExamMarks", { examId: mathPaper.id, teacherId: mathPaper.teacherId });
  await act(teacherToken, "saveExamMarks", { examId: mathPaper.id, marks: marksFor(klass.students, mathPaper.maxMarks) });
  pass("assigned teacher can enter marks after office allows it", mathPaper.title);
  await prisma.examResult.deleteMany({ where: { examId: mathPaper.id } });
  await prisma.exam.update({
    where: { id: mathPaper.id },
    data: { workflowStatus: "SCHEDULED", marksGrantedAt: null },
  });
  await prisma.examEvaluator.deleteMany({ where: { examId: mathPaper.id } });
  await expectActFail(
    teacherToken,
    "takeExam",
    { examId: setPaper.id },
    "cannot take exam before paper is set"
  );
  await expectActFail(
    teacherToken,
    "publishExamResults",
    { examId: approvedPaper.id },
    "teacher cannot publish results"
  );

  await act(officeToken, "completeExamWork", { examId: setPaper.id, kind: "paper" });
  await act(officeToken, "grantExamMarks", { examId: setPaper.id, teacherId: setPaper.teacherId });
  await act(teacherToken, "takeExam", { examId: setPaper.id });
  const afterTake = await prisma.exam.findUniqueOrThrow({ where: { id: setPaper.id } });
  if (afterTake.workflowStatus === "IN_PROGRESS") pass("take exam on future date", `exam date ${setPaper.date.toISOString().slice(0, 10)}`);
  else fail("take exam on future date", afterTake.workflowStatus);

  const labMarks = marksFor(klass.students, setPaper.maxMarks);
  await act(teacherToken, "saveExamMarks", { examId: setPaper.id, marks: labMarks });
  pass("save draft after take exam", "Unit Test 2 English");
  await act(teacherToken, "submitExamMarks", { examId: setPaper.id, marks: labMarks });
  pass("submit marks to office", "Unit Test 2 English");

  await expectActFail(
    teacherToken,
    "saveExamMarks",
    { examId: setPaper.id, marks: labMarks },
    "teacher cannot edit after submit"
  );

  await act(officeToken, "reviewExamMarks", { examId: setPaper.id });
  await act(officeToken, "returnExamMarks", { examId: setPaper.id, note: "Check the absent row again." });
  pass("office returns marks for correction", "Unit test 2 English");
  await act(teacherToken, "saveExamMarks", { examId: setPaper.id, marks: labMarks });
  await act(teacherToken, "submitExamMarks", { examId: setPaper.id, marks: labMarks });
  await act(officeToken, "reviewExamMarks", { examId: setPaper.id });
  await act(officeToken, "approveExamMarks", { examId: setPaper.id });
  await act(officeToken, "publishExamResults", { examId: setPaper.id });
  pass("office approve + publish", "Unit Test 2 English");

  await act(officeToken, "reviewExamMarks", { examId: submittedPaper.id });
  pass("office opens submitted paper for review", submittedPaper.title);

  const parentRecord = await record(parentToken);
  const childTests = (parentRecord.child?.tests || []) as { title?: string }[];
  const reports = (parentRecord.reports || []) as { seriesName?: string; exams?: unknown[] }[];
  const termCard = reports.find((row) => row.seriesName === "Term 1");
  if (termCard && (termCard.exams || []).length >= 8) pass("parent report card is Term 1 with every subject", `${(termCard.exams || []).length} subjects`);
  else fail("parent report card is Term 1 with every subject", JSON.stringify(reports.map((r) => `${r.seriesName}:${(r.exams || []).length}`)));
  if (!reports.some((row) => row.seriesName === "Unit Test 1")) pass("no Unit Test 1 report card until every paper is published", "");
  else fail("no Unit Test 1 report card until every paper is published", "partial sitting leaked");
  const liveVisible = childTests.some((row) => (row.title || "").includes("Unit Test 2 · English"));
  const hiddenDraft = childTests.some((row) => (row.title || "").includes("Unit Test 1 · English"));
  if (liveVisible) pass("parent sees newly published Unit Test 2 English marks", "");
  else fail("parent sees newly published Unit Test 2 English marks", JSON.stringify(childTests.map((t) => t.title)));
  if (!hiddenDraft) pass("parent does not see unpublished Unit Test 1 English marks", "");
  else fail("parent does not see unpublished Unit Test 1 English marks", "draft marks leaked");

  const studentRecord = await record(studentToken);
  const studentReports = (studentRecord.reports || []) as { seriesName?: string }[];
  if (studentReports.some((row) => row.seriesName === "Term 1")) pass("student sees Term 1 report card", `${studentReports.length} report(s)`);
  else fail("student sees Term 1 report card", JSON.stringify(studentReports));

  const officeRecord = await record(officeToken);
  const pack = officeRecord.examPack;
  if (pack?.series?.length) pass("office exam board data", `${pack.series.length} sittings`);
  else fail("office exam board data", "examPack missing");

  await act(officeToken, "grantExamMarks", { examId: correctionPaper.id, teacherId: enterPaper.teacherId });
  pass("office can assign / change marking teacher", correctionPaper.title);

  const otherTeacher = await prisma.teacher.findFirstOrThrow({
    where: { user: { email: "sandeep.gill@school.test" } },
    select: { id: true },
  });
  if (otherTeacher.id !== enterPaper.teacherId) {
    await expectActFail(
      officeToken,
      "grantExamMarks",
      { examId: enterPaper.id, teacherId: otherTeacher.id },
      "office cannot grant marks entry to a teacher who does not teach the subject"
    );
  }

  const remaining = await prisma.exam.findMany({
    where: { classId: klass.id },
    select: { title: true, workflowStatus: true, date: true, paperAt: true, conductedAt: true },
    orderBy: { date: "desc" },
  });
  console.log("\n1-A papers now:");
  for (const exam of remaining) {
    console.log(
      `  ${exam.title.padEnd(32)} ${exam.workflowStatus.padEnd(20)} date=${exam.date.toISOString().slice(0, 10)} paper=${exam.paperAt ? "yes" : "no"} taken=${exam.conductedAt ? "yes" : "no"}`
    );
  }

  const failed = checks.filter((row) => !row.ok);
  console.log("\nExam feature checks:");
  for (const row of checks) {
    console.log(`${row.ok ? "PASS" : "FAIL"}  ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) {
    throw new Error(`${failed.length} exam feature check(s) failed`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
