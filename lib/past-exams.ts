import ExcelJS from "exceljs";
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";
import { parseExamPlan } from "./exams";
import { parseCsv } from "./sheet";
import { readUpload } from "./uploads";

/**
 * Old exam marks ("Add old marks"): fully optional. A school that joins mid-year can type or upload
 * marks for an exam that already happened (e.g. Term 1) so it shows on report cards. Nothing else
 * depends on it: an exam with no marks is simply "not tracked", and report cards weigh only the
 * exams that exist.
 *
 * Imported marks are saved as an ordinary sitting (ExamSeries + one Exam per subject) that is
 * already published, so report cards, parent results and marksheets read them like any other exam.
 */

type Ctx = Awaited<ReturnType<typeof loadContext>>;

function needRun(user: AccessUser) {
  if (!can(user, "exams.edit")) throw new Error("No access.");
}

function norm(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isYmd(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

async function loadContext(input: { sessionId?: string; classId?: string; planItemId?: string }) {
  const sessionId = String(input.sessionId || "");
  const classId = String(input.classId || "");
  const planItemId = String(input.planItemId || "");
  if (!sessionId || !classId || !planItemId) throw new Error("Pick the exam and class.");
  const [session, klass] = await Promise.all([
    prisma.schoolSession.findUnique({ where: { id: sessionId } }),
    prisma.class.findUnique({ where: { id: classId } }),
  ]);
  if (!session) throw new Error("Session missing");
  if (!klass) throw new Error("Class missing");
  const item = parseExamPlan(session.examPlanJson).find((row) => row.id === planItemId);
  if (!item) throw new Error("This exam is not in the year's exam list.");
  const [subjects, students] = await Promise.all([
    prisma.subject.findMany({ where: { classId }, orderBy: { name: "asc" } }),
    prisma.student.findMany({
      where: { classId },
      select: {
        id: true,
        name: true,
        admissionNo: true,
        enrollments: { where: { sessionId }, select: { rollNumber: true, classId: true } },
      },
    }),
  ]);
  if (!subjects.length) throw new Error("Add subjects for this class first.");
  const rows = students
    .map((s) => ({
      id: s.id,
      name: s.name,
      admissionNo: s.admissionNo,
      rollNumber: s.enrollments.find((e) => e.classId === classId)?.rollNumber ?? null,
    }))
    .sort((a, b) => (a.rollNumber ?? 9999) - (b.rollNumber ?? 9999) || a.name.localeCompare(b.name));
  return { session, klass, item, subjects, students: rows, classLabel: `${klass.name}-${klass.section}` };
}

function subjectHeader(subject: { code: string; name: string }, maxMarks: number) {
  const label = subject.code ? `${subject.code} · ${subject.name}` : subject.name;
  return `${label} (out of ${maxMarks})`;
}

/** Excel to fill offline: one row per student (roll order), one column per subject. */
export async function pastExamTemplate(
  user: AccessUser,
  input: { sessionId?: string; classId?: string; planItemId?: string; maxMarks?: string | number }
) {
  needRun(user);
  const ctx = await loadContext(input);
  const maxMarks = Math.max(1, Math.round(Number(input.maxMarks) || ctx.item.maxMarks || 80));
  const existing = await existingMarks(ctx);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Anekio";
  const sheet = workbook.addWorksheet(ctx.classLabel.slice(0, 31));
  const headers = ["Roll no", "Admission no", "Student name", ...ctx.subjects.map((s) => subjectHeader(s, maxMarks))];
  sheet.addRow(headers);
  for (const student of ctx.students) {
    sheet.addRow([
      student.rollNumber ?? "",
      student.admissionNo,
      student.name,
      ...ctx.subjects.map((subject) => existing.get(`${student.id}:${subject.id}`) ?? ""),
    ]);
  }
  sheet.views = [{ state: "frozen", ySplit: 1, xSplit: 3 }];
  sheet.getRow(1).font = { bold: true, color: { argb: "FF0F172A" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
  sheet.columns = headers.map((header, index) => ({
    width: index === 2 ? 28 : index < 2 ? 14 : Math.max(14, Math.min(30, header.length + 2)),
  }));
  const help = workbook.addWorksheet("How to fill");
  [
    [`${ctx.item.name} · Class ${ctx.classLabel}`],
    [""],
    ["• Type each student's marks under the subject. Marks can't be more than the 'out of' number."],
    ["• Type AB if the student was absent."],
    ["• Leave a cell empty if you don't have that mark. You can add it later."],
    ["• Don't change the Roll no, Admission no or Student name columns."],
    ["• Then upload this file on Anekio → Exams → Add old marks."],
  ].forEach((row) => help.addRow(row));
  help.getColumn(1).width = 90;
  help.getRow(1).font = { bold: true, size: 13 };
  const safe = `${ctx.item.name}-${ctx.classLabel}`.replace(/[^A-Za-z0-9-]+/g, "-");
  return {
    fileName: `anekio-old-marks-${safe}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}

async function findSeries(ctx: Ctx) {
  return prisma.examSeries.findFirst({
    where: {
      classId: ctx.klass.id,
      sessionId: ctx.session.id,
      OR: [{ planItemId: ctx.item.id }, { name: ctx.item.name }],
    },
    include: { exams: { select: { id: true, subjectId: true, workflowStatus: true, maxMarks: true } } },
  });
}

/** "studentId:subjectId" → "34" | "AB" for marks already saved on this exam. */
async function existingMarks(ctx: Ctx) {
  const series = await findSeries(ctx);
  const out = new Map<string, string>();
  if (!series?.exams.length) return out;
  const subjectByExam = new Map(series.exams.map((e) => [e.id, e.subjectId]));
  const results = await prisma.examResult.findMany({ where: { examId: { in: series.exams.map((e) => e.id) } } });
  for (const r of results) {
    const subjectId = subjectByExam.get(r.examId);
    if (subjectId) out.set(`${r.studentId}:${subjectId}`, r.absent ? "AB" : String(r.marks));
  }
  return out;
}

/** Marks already saved for this class and exam, so the grid can open pre-filled. */
export async function pastExamMarksCore(user: AccessUser, input: { sessionId?: string; classId?: string; planItemId?: string }) {
  needRun(user);
  const ctx = await loadContext(input);
  const series = await findSeries(ctx);
  const live = Boolean(series?.exams.some((e) => e.workflowStatus !== "PUBLISHED"));
  const values = Object.fromEntries(await existingMarks(ctx));
  return {
    values,
    live,
    maxMarks: series?.exams[0]?.maxMarks ?? ctx.item.maxMarks ?? 80,
  };
}

/** Reads an uploaded Excel/CSV (our template or the school's own sheet) into grid values. Nothing is saved yet. */
export async function readPastExamSheetCore(
  user: AccessUser,
  input: { sessionId?: string; classId?: string; planItemId?: string; uploadPath?: string }
) {
  needRun(user);
  const ctx = await loadContext(input);
  const uploadPath = String(input.uploadPath || "");
  if (!uploadPath.includes("/exams/imports/") || uploadPath.includes("..")) throw new Error("Upload the sheet from Exams → Add old marks.");
  const { buf, type } = await readUpload(uploadPath);
  let table: string[][] = [];
  if (type === "text/csv" || uploadPath.toLowerCase().endsWith(".csv")) {
    const rows = parseCsvGrid(buf.toString("utf8"));
    table = rows;
  } else {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const sheet = workbook.worksheets.find((ws) => ws.name !== "How to fill") || workbook.worksheets[0];
    if (!sheet) throw new Error("This file has no sheet.");
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        values[col - 1] = cellText(cell.value);
      });
      table.push(Array.from(values, (v) => v ?? ""));
    });
  }
  if (table.length < 2) throw new Error("The sheet is empty.");
  const header = table[0].map(norm);
  const col = (...keys: string[]) => header.findIndex((h) => keys.some((k) => h === norm(k)));
  const rollCol = col("Roll no", "roll", "rollno", "rollnumber");
  const admCol = col("Admission no", "admission", "admissionno", "admissionnumber", "adm");
  const nameCol = col("Student name", "name", "student", "studentname");
  // Subject columns: header starts with the subject code, or contains the subject name.
  const subjectCols = ctx.subjects
    .map((subject) => {
      const code = norm(subject.code);
      const name = norm(subject.name);
      const index = header.findIndex(
        (h, i) => ![rollCol, admCol, nameCol].includes(i) && ((code && (h === code || h.startsWith(code))) || (name && h.includes(name)))
      );
      return { subjectId: subject.id, index };
    })
    .filter((row) => row.index >= 0);
  if (!subjectCols.length) throw new Error("No subject columns found. Use the Excel downloaded from Anekio.");
  const byAdm = new Map(ctx.students.map((s) => [norm(s.admissionNo), s]));
  const byRoll = new Map(ctx.students.filter((s) => s.rollNumber != null).map((s) => [String(s.rollNumber), s]));
  const byName = new Map(ctx.students.map((s) => [norm(s.name), s]));
  const values: Record<string, string> = {};
  const unmatched: string[] = [];
  for (const row of table.slice(1)) {
    const adm = admCol >= 0 ? norm(row[admCol] || "") : "";
    const roll = rollCol >= 0 ? String(row[rollCol] || "").trim() : "";
    const name = nameCol >= 0 ? norm(row[nameCol] || "") : "";
    if (!adm && !roll && !name) continue;
    const student = (adm && byAdm.get(adm)) || (name && byName.get(name)) || (roll && byRoll.get(roll)) || null;
    if (!student) {
      unmatched.push(String((nameCol >= 0 && row[nameCol]) || (admCol >= 0 && row[admCol]) || roll || "A row"));
      continue;
    }
    for (const { subjectId, index } of subjectCols) {
      const raw = String(row[index] ?? "").trim();
      if (raw) values[`${student.id}:${subjectId}`] = raw;
    }
  }
  return { values, unmatched, matchedSubjects: subjectCols.length, totalSubjects: ctx.subjects.length };
}

function parseCsvGrid(text: string) {
  // Reuse the tolerant CSV parser, then rebuild an ordered grid from its header map.
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  return [headers, ...rows.map((row) => headers.map((h) => row[h] || ""))];
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value && value.result != null) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text || "");
  }
  return String(value).trim();
}

/** Saves the grid. Empty cells clear a mark; "AB" means absent. Creates the published sitting on first save. */
export async function savePastExamMarksCore(
  user: AccessUser,
  input: {
    sessionId?: string;
    classId?: string;
    planItemId?: string;
    examDate?: string;
    maxMarks?: string | number;
    values?: Record<string, string | number | null>;
  }
) {
  needRun(user);
  const ctx = await loadContext(input);
  const examDate = String(input.examDate || "").slice(0, 10);
  if (!isYmd(examDate)) throw new Error("Pick the month the exam happened.");
  const maxMarks = Math.max(1, Math.min(1000, Math.round(Number(input.maxMarks) || ctx.item.maxMarks || 80)));
  const studentById = new Map(ctx.students.map((s) => [s.id, s]));
  const subjectById = new Map(ctx.subjects.map((s) => [s.id, s]));

  type Cell = { studentId: string; subjectId: string; marks: number; absent: boolean } | { studentId: string; subjectId: string; clear: true };
  const cells: Cell[] = [];
  const errors: string[] = [];
  for (const [key, rawValue] of Object.entries(input.values || {})) {
    const [studentId, subjectId] = key.split(":");
    const student = studentById.get(studentId);
    const subject = subjectById.get(subjectId);
    if (!student || !subject) continue;
    const raw = String(rawValue ?? "").trim();
    if (!raw) {
      cells.push({ studentId, subjectId, clear: true });
      continue;
    }
    if (/^(ab|a|absent)$/i.test(raw)) {
      cells.push({ studentId, subjectId, marks: 0, absent: true });
      continue;
    }
    const marks = Number(raw);
    if (Number.isNaN(marks) || marks < 0) {
      errors.push(`${student.name} · ${subject.name}: "${raw}" is not a mark`);
    } else if (marks > maxMarks) {
      errors.push(`${student.name} · ${subject.name}: ${marks} is more than ${maxMarks}`);
    } else {
      cells.push({ studentId, subjectId, marks, absent: false });
    }
  }
  if (errors.length) {
    throw new Error(errors.length === 1 ? errors[0] : `${errors[0]} (and ${errors.length - 1} more)`);
  }
  const filled = cells.filter((c): c is Exclude<Cell, { clear: true }> => !("clear" in c));

  let series = await findSeries(ctx);
  if (series?.exams.some((e) => e.workflowStatus !== "PUBLISHED")) {
    throw new Error(`${ctx.item.name} is already scheduled for ${ctx.classLabel}. Teachers enter its marks from the paper.`);
  }
  if (!series && !filled.length) throw new Error("Type at least one mark, or upload the Excel.");

  const now = new Date();
  const date = new Date(`${examDate}T00:00:00Z`);
  if (!series) {
    const created = await prisma.examSeries.create({
      data: { classId: ctx.klass.id, sessionId: ctx.session.id, planItemId: ctx.item.id, name: ctx.item.name, publishedAt: now },
    });
    series = { ...created, exams: [] };
  } else if (!series.planItemId) {
    await prisma.examSeries.update({ where: { id: series.id }, data: { planItemId: ctx.item.id } });
  }

  // One paper per subject that has marks (or already exists). Subjects with no marks stay off report cards.
  const examBySubject = new Map(series.exams.map((e) => [e.subjectId, e.id]));
  const neededSubjects = new Set(filled.map((c) => c.subjectId));
  for (const subjectId of neededSubjects) {
    if (examBySubject.has(subjectId)) continue;
    const subject = subjectById.get(subjectId)!;
    const exam = await prisma.exam.create({
      data: {
        title: `${ctx.item.name} · ${subject.name}`,
        subjectId,
        classId: ctx.klass.id,
        seriesId: series.id,
        teacherId: subject.teacherId ?? null,
        setterId: subject.teacherId ?? null,
        date,
        maxMarks,
        workflowStatus: "PUBLISHED",
        conductedAt: date,
        submittedAt: now,
        reviewedAt: now,
        resultsPublishedAt: now,
      },
    });
    examBySubject.set(subjectId, exam.id);
  }
  if (series.exams.length) {
    await prisma.exam.updateMany({ where: { seriesId: series.id }, data: { date, maxMarks } });
  }

  let saved = 0;
  for (const c of cells) {
    const examId = examBySubject.get(c.subjectId);
    if (!examId) continue;
    if ("clear" in c) {
      await prisma.examResult.deleteMany({ where: { examId, studentId: c.studentId } });
      continue;
    }
    await prisma.examResult.upsert({
      where: { examId_studentId: { examId, studentId: c.studentId } },
      update: { marks: c.marks, absent: c.absent },
      create: { examId, studentId: c.studentId, marks: c.marks, absent: c.absent },
    });
    await prisma.examResultAudit.create({
      data: { examId, studentId: c.studentId, marks: c.marks, absent: c.absent, action: "IMPORTED", actorId: user.id, note: "Old marks" },
    });
    saved += 1;
  }
  return { saved, subjects: neededSubjects.size, seriesId: series.id };
}
