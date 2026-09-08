import { PrismaClient, type ExamWorkflowStatus } from "@prisma/client";
import { DEFAULT_EXAM_PLAN } from "../lib/exams";

const prisma = new PrismaClient();

const EXTRA_SUBJECTS = ["Science", "Hindi", "Social Studies", "Computer", "Art", "Physical Education"];
const SUBJECT_ORDER = ["English", "Mathematics", "Science", "Hindi", "Social Studies", "Computer", "Art", "Physical Education"];

function atNoon(value: string) {
  return new Date(`${value}T12:00:00`);
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(value: string, days: number) {
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + days);
  return ymd(dt);
}

function score(i: number, max: number, absent: boolean) {
  if (absent) return { marks: 0, absent: true as const, remarks: "Absent" };
  const marks = Math.min(max, Math.max(8, Math.round(max * (0.58 + (i % 7) * 0.05))));
  return { marks, absent: false as const, remarks: i % 5 === 0 ? "Good work" : null };
}

type PaperSeed = {
  subjectName: string;
  date: string;
  status: ExamWorkflowStatus;
  paperReady?: boolean;
  grant?: boolean;
  correctionNote?: string;
};

async function ensureClassSubjects(
  db: PrismaClient,
  klass: { id: string; subjects: { id: string; name: string; teacherId: string | null }[]; teachers: { id: string }[] }
) {
  const teacherId = klass.subjects[0]?.teacherId || klass.teachers[0]?.id;
  if (!teacherId) return klass.subjects;
  for (const name of EXTRA_SUBJECTS) {
    if (klass.subjects.some((s) => s.name === name)) continue;
    const subject = await db.subject.create({
      data: { name, classId: klass.id, teacherId, weightage: 4 },
    });
    klass.subjects.push(subject);
    await db.teacherSkill.upsert({
      where: { teacherId_subjectName_classId: { teacherId, subjectName: name, classId: klass.id } },
      create: { teacherId, subjectName: name, classId: klass.id },
      update: {},
    });
  }
  klass.subjects.sort((a, b) => {
    const ia = SUBJECT_ORDER.indexOf(a.name);
    const ib = SUBJECT_ORDER.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
  });
  return klass.subjects;
}

function papersFor(
  subjects: { name: string }[],
  start: string,
  overlay: Record<string, Partial<Omit<PaperSeed, "subjectName">>> = {}
): PaperSeed[] {
  return subjects.map((subject, i) => {
    const extra = overlay[subject.name] || {};
    return {
      subjectName: subject.name,
      date: extra.date || addDays(start, i),
      status: extra.status || "SCHEDULED",
      paperReady: extra.paperReady ?? true,
      grant: extra.grant,
      correctionNote: extra.correctionNote,
    };
  });
}

async function sittingForClass(
  db: PrismaClient,
  input: {
    classId: string;
    sessionId: string;
    planItemId: string;
    name: string;
    published: boolean;
    papers: PaperSeed[];
    teacherBySubject: Map<string, string>;
    subjects: { id: string; name: string }[];
    students: { id: string }[];
  }
) {
  const plan = DEFAULT_EXAM_PLAN.find((row) => row.id === input.planItemId);
  const maxMarks = plan?.maxMarks ?? 80;
  const series = await db.examSeries.create({
    data: {
      classId: input.classId,
      sessionId: input.sessionId,
      planItemId: input.planItemId,
      name: input.name,
      publishedAt: input.published ? atNoon(input.papers[0]?.date || ymd(new Date())) : null,
      exams: {
        create: input.papers.flatMap((paper) => {
          const subject = input.subjects.find((s) => s.name === paper.subjectName);
          if (!subject) return [];
          const teacherId = input.teacherBySubject.get(subject.name) || null;
          const conducted = paper.status !== "SCHEDULED";
          const submitted = ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED", "CORRECTION_REQUIRED", "APPROVED", "PUBLISHED"].includes(
            paper.status
          );
          const reviewed = paper.status === "APPROVED" || paper.status === "PUBLISHED";
          const published = paper.status === "PUBLISHED";
          const grant =
            paper.grant ??
            (paper.status !== "SCHEDULED" && (paper.paperReady || conducted));
          return [
            {
              title: `${input.name} · ${subject.name}`,
              subjectId: subject.id,
              classId: input.classId,
              teacherId,
              setterId: teacherId,
              date: atNoon(paper.date),
              paperDueOn: atNoon(addDays(paper.date, -7)),
              copiesDueOn: atNoon(addDays(paper.date, 7)),
              resultOn: atNoon(addDays(paper.date, 14)),
              maxMarks,
              workflowStatus: paper.status,
              paperFileName: paper.paperReady || conducted ? `${subject.name}-paper.pdf` : "",
              paperFilePath: paper.paperReady || conducted ? `papers/${subject.name.toLowerCase().replace(/\s+/g, "-")}-paper.pdf` : "",
              paperAt: paper.paperReady || conducted ? atNoon(addDays(paper.date, -5)) : null,
              marksGrantedAt: grant ? atNoon(addDays(paper.date, -4)) : null,
              conductedAt: conducted ? atNoon(paper.date) : null,
              submittedAt: submitted ? atNoon(addDays(paper.date, 2)) : null,
              reviewedAt: reviewed ? atNoon(addDays(paper.date, 3)) : null,
              correctionNote: paper.correctionNote || null,
              resultsPublishedAt: published ? atNoon(addDays(paper.date, 4)) : null,
              copiesDoneAt: submitted ? atNoon(addDays(paper.date, 2)) : null,
            },
          ];
        }),
      },
    },
    include: { exams: true },
  });

  for (const exam of series.exams) {
    if (exam.teacherId && exam.marksGrantedAt) {
      await db.examEvaluator.upsert({
        where: { examId_teacherId: { examId: exam.id, teacherId: exam.teacherId } },
        create: { examId: exam.id, teacherId: exam.teacherId },
        update: {},
      });
    }
  }

  const marked = series.exams.filter((exam) =>
    ["MARKS_DRAFT", "SUBMITTED", "UNDER_REVIEW", "CORRECTION_REQUIRED", "RESUBMITTED", "APPROVED", "PUBLISHED"].includes(
      exam.workflowStatus
    )
  );
  for (const exam of marked) {
    await db.examResult.createMany({
      data: input.students.map((student, i) => {
        const row = score(i, exam.maxMarks, i === 2);
        return {
          examId: exam.id,
          studentId: student.id,
          marks: row.marks,
          absent: row.absent,
          remarks: row.remarks,
        };
      }),
    });
  }
  return series;
}

export async function seedExamDemo(client = prisma) {
  const session = await client.schoolSession.findFirst({ where: { current: true } });
  if (!session) throw new Error("No current school session");
  const today = ymd(new Date());

  await client.schoolSession.update({
    where: { id: session.id },
    data: { examPlanJson: JSON.stringify(DEFAULT_EXAM_PLAN) },
  });
  await client.examSeries.deleteMany({ where: { sessionId: session.id } });
  await client.exam.deleteMany({
    where: { class: { archivedAt: null } },
  });

  const classes = await client.class.findMany({
    where: { archivedAt: null, section: "A", name: { in: ["1", "2"] } },
    include: {
      subjects: true,
      students: { orderBy: { name: "asc" } },
      teachers: true,
    },
    orderBy: { name: "asc" },
  });
  if (!classes.length) throw new Error("Seed school classes first");

  for (const klass of classes) {
    await ensureClassSubjects(client, klass);
    const teacherBySubject = new Map(
      klass.subjects.map((s) => [s.name, s.teacherId || klass.teachers[0]?.id || ""])
    );
    const base = {
      classId: klass.id,
      sessionId: session.id,
      teacherBySubject,
      subjects: klass.subjects,
      students: klass.students,
    };

    const publishedSitting = {
      status: "PUBLISHED" as const,
      paperReady: true,
      grant: true,
    };

    if (klass.name === "1") {
      await sittingForClass(client, {
        ...base,
        planItemId: "unit1",
        name: "Unit Test 1",
        published: true,
        papers: papersFor(klass.subjects, "2026-08-12", {
          Mathematics: { date: "2026-08-13", status: "SCHEDULED", paperReady: true, grant: false },
          English: { date: "2026-08-12", status: "MARKS_DRAFT", paperReady: true, grant: true },
          Science: { date: "2026-08-14", status: "UNDER_REVIEW", paperReady: true, grant: true },
          Hindi: {
            date: "2026-08-16",
            status: "CORRECTION_REQUIRED",
            paperReady: true,
            grant: true,
            correctionNote: "Please check Rahul's marks.",
          },
          "Social Studies": { date: "2026-08-17", status: "APPROVED", paperReady: true, grant: true },
          Computer: { date: "2026-08-18", status: "PUBLISHED", paperReady: true, grant: true },
          Art: { date: "2026-08-19", status: "IN_PROGRESS", paperReady: true, grant: true },
          "Physical Education": { date: "2026-08-20", status: "SCHEDULED", paperReady: false, grant: false },
        }),
      });
      await sittingForClass(client, {
        ...base,
        planItemId: "term1",
        name: "Term 1",
        published: true,
        papers: papersFor(klass.subjects, "2026-09-08", Object.fromEntries(klass.subjects.map((s) => [s.name, publishedSitting]))),
      });
      await sittingForClass(client, {
        ...base,
        planItemId: "unit2",
        name: "Unit Test 2",
        published: false,
        papers: papersFor(klass.subjects, addDays(today, 1), {
          English: { date: addDays(today, 10), status: "SCHEDULED", paperReady: false, grant: false },
          Mathematics: { date: addDays(today, -2), status: "SUBMITTED", paperReady: true, grant: true },
        }),
      });
    } else {
      await sittingForClass(client, {
        ...base,
        planItemId: "unit1",
        name: "Unit Test 1",
        published: true,
        papers: papersFor(klass.subjects, "2026-07-14", Object.fromEntries(klass.subjects.map((s) => [s.name, publishedSitting]))),
      });
    }
  }

  return { classes: classes.map((c) => `${c.name}-${c.section}`), today };
}

async function main() {
  const result = await seedExamDemo();
  console.log(`Exam demo seeded for ${result.classes.join(", ")} (today ${result.today})`);
  console.log("  Sequence: Unit Test 1 → Term 1 → Unit Test 2 → Term 2. Every sitting uses every class subject.");
  console.log("  1-A Term 1 is fully published (one report card). Unit Test 1 still shows the office journey.");
  console.log("  Logins password 12345: kavita.joshi@school.test · exams@school.test · parent.1a.1@school.test · student.1a.01@school.test");
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("prisma/seed-exams.ts")) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
