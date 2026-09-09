import { prisma } from "./prisma";
import { buildCollectionSeries, buildDeskPulse, collectionWindow, startOfDay } from "./desk";
import { classifyStudent } from "./classify";
import { addDays, gradePolicyFrom, paperSetterId, parseExamPlan, ymd } from "./exams";
import { packedEvaluators, examEvaluatorIds, grantedEvaluatorIds } from "./exam-evaluators";
import { teacherAssignedToPaper } from "./exam-marks";
import { compareExamNearness, eligibleMarksTeacherIds, examWorkStepOrder, teacherMayEnterMarks, teacherMayTakeExam } from "./exam-workflow";
import { parseWeekdays, weekCapacity } from "./schedule";
import { schoolFromConfig } from "./school";
import { ensureSchoolSessions } from "./school-session";

export async function getParentWithChildren(userId: string) {
  return prisma.parent.findUnique({
    where: { userId },
    include: {
      user: true,
      students: {
        include: {
          class: true,
          interests: true,
          user: true,
        },
        orderBy: { name: "asc" },
      },
    },
  });
}

export async function getTeacherProfile(userId: string) {
  return prisma.teacher.findUnique({
    where: { userId },
    include: {
      user: true,
      class: { include: { students: { include: { interests: true } } } },
      subjects: { include: { class: true } },
    },
  });
}

export async function getStudentForUser(userId: string) {
  return prisma.student.findUnique({
    where: { userId },
    include: {
      class: true,
      interests: true,
      parent: { include: { user: true } },
    },
  });
}

export async function getStudentBundle(studentId: string) {
  return prisma.student.findUnique({
    where: { id: studentId },
    include: {
      class: {
        include: {
          subjects: {
            include: { teacher: { include: { user: true } } },
            orderBy: { name: "asc" },
          },
        },
      },
      interests: true,
      parent: { include: { user: true } },
      user: true,
      attendance: { orderBy: { date: "desc" }, take: 40 },
      examResults: {
        include: { exam: { include: { subject: true, series: true } } },
        orderBy: { exam: { date: "desc" } },
      },
      papers: {
        include: { exam: { include: { subject: true } }, teacher: true },
        orderBy: { createdAt: "desc" },
      },
      contestEntries: {
        include: { contest: true },
        orderBy: { contest: { startsAt: "desc" } },
      },
      grants: {
        include: { nominatedBy: true, contestEntry: { include: { contest: true } } },
        orderBy: { createdAt: "desc" },
      },
      feeInvoices: {
        include: { payments: true, reminders: true },
        orderBy: { dueDate: "desc" },
      },
    },
  });
}

export async function getClassRoster(classId: string) {
  return prisma.student.findMany({
    where: { classId },
    include: {
      parent: { include: { user: { select: { name: true, phone: true, email: true } } } },
      interests: true,
      attendance: { orderBy: { date: "desc" }, take: 400 },
      examResults: { include: { exam: { include: { subject: true, series: true } } } },
      feeInvoices: { include: { payments: true }, orderBy: { dueDate: "desc" } },
      contestEntries: { include: { contest: true } },
      grants: true,
    },
    orderBy: { name: "asc" },
  });
}

export async function getPublishedSeries(classId: string) {
  return prisma.examSeries.findMany({
    where: {
      classId,
      exams: {
        some: {
          OR: [{ workflowStatus: "PUBLISHED" }, { resultsPublishedAt: { not: null } }],
        },
      },
    },
    include: {
      session: true,
      exams: {
        include: { subject: true, results: true },
        orderBy: { date: "asc" },
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function getClassExamSeries(classId: string) {
  const { current } = await ensureSchoolSessions();
  return prisma.examSeries.findMany({
    where: { classId, sessionId: current.id },
    include: {
      session: { select: { label: true } },
      exams: {
        select: { date: true, workflowStatus: true, resultsPublishedAt: true },
        orderBy: { date: "asc" },
      },
    },
    orderBy: [{ createdAt: "asc" }],
  });
}

export async function getUpcomingExams(classId: string) {
  return prisma.exam.findMany({
    where: { classId, date: { gte: startOfToday() } },
    include: { subject: true, series: true, teacher: { include: { user: true } } },
    orderBy: { date: "asc" },
  });
}

export async function getClassExamPapers(classId: string) {
  return prisma.exam.findMany({
    where: { classId },
    include: { subject: true, series: true, teacher: { include: { user: true } } },
    orderBy: { date: "asc" },
  });
}

export async function getPastExams(classId: string) {
  return prisma.exam.findMany({
    where: { classId },
    include: {
      subject: true,
      series: true,
      results: { include: { student: true } },
      papers: true,
    },
    orderBy: { date: "desc" },
  });
}

export async function getExamDesk(classId?: string, sessionId?: string, seriesId?: string) {
  const { sessions, current } = await ensureSchoolSessions();
  const session = (sessionId && sessions.find((s) => s.id === sessionId)) || current;
  const classes = await prisma.class.findMany({
    where: { archivedAt: null },
    include: {
      subjects: { include: { teacher: true }, orderBy: { name: "asc" } },
      _count: { select: { students: true } },
    },
    orderBy: [{ name: "asc" }, { section: "asc" }],
  });
  const selectedId =
    classId && classes.some((c) => c.id === classId) ? classId : classes[0]?.id ?? "";
  const seriesList = selectedId
    ? await prisma.examSeries.findMany({
        where: { classId: selectedId, sessionId: session.id },
        include: {
          exams: {
            include: {
              subject: true,
              results: true,
              teacher: { include: { user: true } },
              setter: { include: { user: true } },
              papers: true,
            },
            orderBy: { date: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const series = (seriesId && seriesList.find((s) => s.id === seriesId)) || seriesList[0] || null;
  const students = selectedId
    ? await prisma.student.findMany({
        where: { classId: selectedId },
        include: { attendance: true },
        orderBy: { name: "asc" },
      })
    : [];
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const teachers = await prisma.teacher.findMany({
    include: { user: true },
    orderBy: { employeeId: "asc" },
  });
  const plan = parseExamPlan(session.examPlanJson);
  const scheduledIds = [
    ...new Set(seriesList.map((s) => s.planItemId).filter((id) => Boolean(id))),
  ];
  const sessionSeries = await prisma.examSeries.findMany({
    where: { sessionId: session.id },
    select: { classId: true, name: true, planItemId: true },
  });
  const holidays = await prisma.schoolHoliday.findMany({ where: { sessionId: session.id }, orderBy: { date: "asc" } });
  return {
    classes,
    selectedId,
    sessions,
    currentSession: current,
    session,
    seriesList,
    series,
    students,
    teachers,
    config,
    plan,
    scheduledIds,
    sessionSeries,
    calendar: {
      weekdays: parseWeekdays(config?.weekdays),
      holidays: holidays.map((h) => ({ date: h.date, name: h.name })),
    },
    holidays,
  };
}

export async function teacherExamClassIds(userId: string) {
  const teacher = await prisma.teacher.findUnique({
    where: { userId },
    include: { subjects: true, classes: true },
  });
  const ids = new Set<string>();
  if (teacher?.classId) ids.add(teacher.classId);
  for (const s of teacher?.subjects ?? []) ids.add(s.classId);
  for (const c of teacher?.classes ?? []) ids.add(c.classId);
  if (teacher) {
    const assigned = await prisma.exam.findMany({
      where: { OR: [{ teacherId: teacher.id }, { setterId: teacher.id }, { evaluators: { some: { teacherId: teacher.id } } }] },
      select: { classId: true },
    });
    for (const row of assigned) ids.add(row.classId);
  }
  return [...ids];
}

export async function getTeacherExamWork(userId: string) {
  const teacher = await prisma.teacher.findUnique({ where: { userId } });
  if (!teacher) return [];
  return prisma.exam.findMany({
    where: {
      OR: [
        { teacherId: teacher.id },
        { setterId: teacher.id },
        { classId: teacher.classId || "__none__" },
        { evaluators: { some: { teacherId: teacher.id } } },
      ],
    },
    include: {
      subject: true,
      class: true,
      series: true,
      teacher: { include: { user: true } },
      setter: { include: { user: true } },
      papers: true,
      evaluators: { include: { teacher: { include: { user: { select: { name: true } } } } } },
      results: { select: { studentId: true, marks: true, absent: true, correctionNote: true, correctionRequestedAt: true } },
      _count: { select: { results: true } },
    },
    orderBy: { date: "asc" },
  });
}

function dueLine(when: Date | string) {
  const due = ymd(when);
  const today = ymd(new Date());
  if (due < today) return `overdue · due ${due}`;
  if (due === today) return "due today";
  return `due ${due}`;
}

function dueUrgency(when: Date | string | null | undefined): "overdue" | "soon" | "" {
  if (!when) return "";
  const due = ymd(when);
  const today = ymd(new Date());
  if (due < today) return "overdue";
  if (due <= addDays(today, 5)) return "soon";
  return "";
}

function absentRun(days: { date: Date; status: string }[], through: string) {
  let n = 0;
  let cursor = through;
  for (let i = 0; i < 21; i += 1) {
    const mark = days.find((d) => ymd(d.date) === cursor)?.status;
    if (!mark) {
      cursor = addDays(cursor, -1);
      continue;
    }
    if (mark !== "ABSENT") break;
    n += 1;
    cursor = addDays(cursor, -1);
  }
  return n;
}

export async function getTeacherDesk(userId: string) {
  const teacher = await prisma.teacher.findUnique({
    where: { userId },
    include: { user: true, class: true },
  });
  if (!teacher) return null;
  const today = ymd(new Date());
  const weekEnd = addDays(today, 7);
  const work = await getTeacherExamWork(userId);
  const classIds = [...new Set(work.map((e) => e.classId))];
  const counts = classIds.length
    ? await prisma.student.groupBy({
        by: ["classId"],
        _count: { _all: true },
        where: { classId: { in: classIds } },
      })
    : [];
  const countByClass = Object.fromEntries(counts.map((c) => [c.classId, c._count._all]));
  const classStudents = classIds.length
    ? await prisma.student.findMany({
        where: { classId: { in: classIds } },
        select: { id: true, name: true, admissionNo: true, classId: true },
        orderBy: { name: "asc" },
      })
    : [];
  const studentsByClass = new Map<string, typeof classStudents>();
  for (const row of classStudents) {
    const list = studentsByClass.get(row.classId) || [];
    list.push(row);
    studentsByClass.set(row.classId, list);
  }
  const todos: {
    id: string;
    title: string;
    hint: string;
    href: string;
    examId: string;
    kind: "paper" | "marks" | "take";
    dueOn: string;
    urgency: "overdue" | "soon" | "";
  }[] = [];
  for (const exam of work) {
    const label = exam.class ? `${exam.class.name}-${exam.class.section}` : "";
    const students = countByClass[exam.classId] || 0;
    const href = `/teacher/reports/exams?classId=${exam.classId}&series=${exam.seriesId || ""}`;
    const where = `${exam.title}${label ? ` · ${label}` : ""}`;
    if (paperSetterId(exam) === teacher.id && !exam.paperAt) {
      const due = exam.paperDueOn || exam.date;
      todos.push({
        id: `paper-${exam.id}`,
        examId: exam.id,
        kind: "paper",
        title: `Set ${exam.subject.name} paper`,
        hint: `${where} · ${dueLine(due)}`,
        href,
        dueOn: ymd(exam.date),
        urgency: dueUrgency(due),
      });
    }
    if (teacherMayTakeExam(exam, teacher.id) && students) {
      todos.push({
        id: `take-${exam.id}`,
        examId: exam.id,
        kind: "take",
        title: `Take exam · ${exam.subject.name}`,
        hint: `${where} · paper set · exam ${ymd(exam.date)}`,
        href,
        dueOn: ymd(exam.date),
        urgency: dueUrgency(exam.date),
      });
    }
    if (teacherMayEnterMarks(exam, teacher.id) && students) {
      todos.push({
        id: `marks-${exam.id}`,
        examId: exam.id,
        kind: "marks",
        title: exam.workflowStatus === "CORRECTION_REQUIRED" ? `Correct marks · ${exam.subject.name}` : `Enter marks · ${exam.subject.name}`,
        hint: `${exam._count.results}/${students} entered · ${where}`,
        href: `${href}&view=register`,
        dueOn: ymd(exam.date),
        urgency: exam.workflowStatus === "CORRECTION_REQUIRED" ? "overdue" : dueUrgency(exam.resultOn || exam.copiesDueOn),
      });
    }
  }
  todos.sort(
    (a, b) => compareExamNearness(a.dueOn, b.dueOn, today) || examWorkStepOrder(a.kind) - examWorkStepOrder(b.kind)
  );
  const doneWork: {
    id: string;
    examId: string;
    kind: "paper" | "take" | "marks";
    title: string;
    hint: string;
    doneAt: string;
    examDate: string;
  }[] = [];
  for (const exam of work) {
    const label = exam.class ? `${exam.class.name}-${exam.class.section}` : "";
    const where = `${exam.title}${label ? ` · ${label}` : ""}`;
    const students = countByClass[exam.classId] || 0;
    const examDate = ymd(exam.date);
    if (paperSetterId(exam) === teacher.id && exam.paperAt) {
      doneWork.push({
        id: `done-paper-${exam.id}`,
        examId: exam.id,
        kind: "paper",
        title: `${exam.subject.name} paper set`,
        hint: where,
        doneAt: ymd(exam.paperAt),
        examDate,
      });
    }
    if ((exam.teacherId === teacher.id || examEvaluatorIds(exam).includes(teacher.id)) && exam.conductedAt) {
      doneWork.push({
        id: `done-take-${exam.id}`,
        examId: exam.id,
        kind: "take",
        title: `Exam taken · ${exam.subject.name}`,
        hint: where,
        doneAt: ymd(exam.conductedAt),
        examDate,
      });
    }
    if (grantedEvaluatorIds(exam).includes(teacher.id) && (exam.workflowStatus === "SUBMITTED" || exam.workflowStatus === "UNDER_REVIEW" || exam.workflowStatus === "APPROVED" || exam.workflowStatus === "PUBLISHED")) {
      doneWork.push({
        id: `done-marks-${exam.id}`,
        examId: exam.id,
        kind: "marks",
        title: `Marks sent · ${exam.subject.name}`,
        hint: `${exam._count.results}/${students} entered · ${where}`,
        doneAt: ymd(exam.submittedAt || exam.resultOn || exam.date),
        examDate,
      });
    }
  }
  doneWork.sort(
    (a, b) => compareExamNearness(a.examDate, b.examDate, today) || examWorkStepOrder(a.kind) - examWorkStepOrder(b.kind)
  );
  const markSheets = work
    .filter((exam) => teacherAssignedToPaper(exam, teacher.id))
    .map((exam) => {
      const label = exam.class ? `${exam.class.name}-${exam.class.section}` : "";
      const byStudent = new Map(exam.results.map((r) => [r.studentId, r]));
      return {
        examId: exam.id,
        title: exam.title,
        subject: exam.subject.name,
        maxMarks: exam.maxMarks,
        classLabel: label,
        date: ymd(exam.date),
        seriesName: exam.series?.name || exam.title,
        workflowStatus: exam.workflowStatus,
        correctionNote: exam.correctionNote || "",
        entered: exam._count.results,
        canEnterMarks: teacherMayEnterMarks(exam, teacher.id),
        students: (studentsByClass.get(exam.classId) || []).map((s) => {
          const saved = byStudent.get(s.id);
          return {
            id: s.id,
            name: s.name,
            admissionNo: s.admissionNo,
            marks: saved && !saved.absent ? saved.marks : null,
            absent: Boolean(saved?.absent),
            correctionNote: saved?.correctionNote || "",
            correctionRequested: Boolean(saved?.correctionRequestedAt),
          };
        }),
      };
    });

  const week = work
    .filter((e) => {
      const day = ymd(e.date);
      return day >= today && day <= weekEnd;
    })
    .slice(0, 3)
    .map((e) => ({
      id: e.id,
      title: e.title,
      subject: e.subject.name,
      date: ymd(e.date),
      classLabel: e.class ? `${e.class.name}-${e.class.section}` : "",
      setter: paperSetterId(e) === teacher.id,
      evaluator: teacherAssignedToPaper(e, teacher.id),
      href: `/teacher/reports/exams?classId=${e.classId}${e.seriesId ? `&series=${e.seriesId}` : ""}`,
    }));

  const students = teacher.classId
    ? await prisma.student.findMany({
        where: { classId: teacher.classId },
        include: {
          parent: { include: { user: true } },
          attendance: { orderBy: { date: "desc" }, take: 40 },
          examResults: { include: { exam: true } },
          contestEntries: true,
        },
        orderBy: { name: "asc" },
      })
    : [];
  const todayRows = students.map((s) => s.attendance.find((a) => ymd(a.date) === today) ?? null);
  const markedToday = students.length > 0 && todayRows.every(Boolean);
  const outToday = students.filter((_, i) => todayRows[i]?.status === "ABSENT").map((s) => s.name);
  const callHome = students
    .map((s) => {
      const run = absentRun(s.attendance, today);
      const phone = (s.parent.phone || "").replace(/\D/g, "").slice(-10);
      const classLabel = teacher.class ? `${teacher.class.name}-${teacher.class.section}` : "class";
      return {
        id: s.id,
        name: s.name,
        days: run,
        parentName: s.parent.user.name,
        phone: s.parent.phone || "",
        wa:
          phone.length === 10
            ? `https://wa.me/91${phone}?text=${encodeURIComponent(
                `Namaste, this is ${teacher.user.name}, class teacher of ${classLabel}. ${s.name} has been absent for ${run} days. Please let the school know.`
              )}`
            : "",
      };
    })
    .filter((s) => s.days >= 3);
  const bands = students.map((s) => ({ name: s.name, band: classifyStudent(s).band }));

  return {
    teacherName: teacher.user.name,
    classLabel: teacher.class ? `${teacher.class.name}-${teacher.class.section}` : "",
    classTeacher: Boolean(teacher.classId),
    studentCount: students.length,
    markedToday,
    outToday,
    todos,
    doneWork,
    markSheets,
    week,
    callHome,
    needsAttention: bands.filter((b) => b.band === "support").map((b) => b.name),
    breakout: bands.filter((b) => b.band === "breakout").length,
  };
}

export async function getSeriesCard(seriesId: string, studentId: string) {
  const series = await prisma.examSeries.findUnique({
    where: { id: seriesId },
    include: {
      class: true,
      session: true,
      exams: {
        include: { subject: true, results: true },
        orderBy: { date: "asc" },
      },
    },
  });
  if (!series) return null;
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      class: true,
      attendance: true,
      parent: { include: { user: true } },
    },
  });
  if (!student || student.classId !== series.classId) return null;
  const classmates = await prisma.student.findMany({
    where: { classId: series.classId },
    select: { id: true, name: true, admissionNo: true },
    orderBy: { name: "asc" },
  });
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  return { series, student, classmates, config };
}

export async function getInvoices() {
  return prisma.feeInvoice.findMany({
    include: {
      student: { include: { class: true } },
      payments: true,
      reminders: { orderBy: { sentAt: "desc" } },
    },
    orderBy: { dueDate: "asc" },
  });
}

export async function getFeeDesk(classId?: string) {
  const { sessions, current } = await ensureSchoolSessions();
  const classes = await prisma.class.findMany({
    where: { archivedAt: null },
    include: {
      feeTemplates: { include: { lines: { orderBy: { sortOrder: "asc" } } } },
      _count: { select: { students: true } },
    },
    orderBy: [{ name: "asc" }, { section: "asc" }],
  });
  const viewAll = !classId || classId === "all";
  const selectedId = viewAll
    ? "all"
    : classes.some((c) => c.id === classId)
      ? classId
      : classes[0]?.id ?? "";
  const invoices = await prisma.feeInvoice.findMany({
    where: viewAll ? { status: { not: "PAID" } } : { classId: selectedId },
    include: {
      student: { include: { class: true } },
      payments: true,
      reminders: { orderBy: { sentAt: "desc" } },
    },
    orderBy: [{ dueDate: "asc" }, { status: "asc" }],
  });
  const pendingCount = await prisma.feeInvoice.count({ where: { status: { not: "PAID" } } });
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  return { classes, selectedId, invoices, config, viewAll, pendingCount, sessions, currentSession: current };
}

export async function getSharedInvoice(token: string) {
  const invoice = await prisma.feeInvoice.findUnique({
    where: { shareToken: token },
    include: {
      student: { include: { class: true, parent: { include: { user: true } } } },
      payments: true,
    },
  });
  if (!invoice) return null;
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  return { invoice, config };
}

export async function getStudentPay(token: string) {
  const student = await prisma.student.findUnique({
    where: { payToken: token },
    include: {
      class: true,
      parent: { include: { user: true } },
      feeInvoices: {
        include: { payments: true },
        orderBy: { dueDate: "asc" },
      },
    },
  });
  if (!student) return null;
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  return { student, config };
}

export async function getPeople() {
  const [students, teachers, parents, classes] = await Promise.all([
    prisma.student.findMany({
      include: {
        class: true,
        interests: true,
        parent: { include: { user: true } },
        user: true,
        feeInvoices: { include: { payments: true }, orderBy: { dueDate: "desc" } },
        attendance: { select: { status: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.teacher.findMany({
      include: { user: { include: { manager: { select: { id: true, name: true, phone: true } } } }, class: true, subjects: true },
      orderBy: { employeeId: "asc" },
    }),
    prisma.parent.findMany({
      include: { user: true, students: { include: { class: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.class.findMany({
      where: { archivedAt: null },
      include: { _count: { select: { students: true } }, subjects: true },
      orderBy: [{ name: "asc" }, { section: "asc" }],
    }),
  ]);
  return { students, teachers, parents, classes };
}

export async function getPeopleExamPack() {
  const [config, series, skills] = await Promise.all([
    prisma.schoolConfig.findUnique({ where: { id: "school" } }),
    prisma.examSeries.findMany({
      include: {
        session: true,
        exams: {
          include: {
            subject: true,
            results: true,
            teacher: { include: { user: true } },
            setter: { include: { user: true } },
            evaluators: { include: { teacher: { include: { user: true } } } },
          },
          orderBy: { date: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.teacherSkill.findMany({ select: { teacherId: true, classId: true, subjectName: true } }),
  ]);
  const planBySession: Record<string, ReturnType<typeof parseExamPlan>> = {};
  for (const row of series) {
    if (!planBySession[row.sessionId]) {
      planBySession[row.sessionId] = parseExamPlan(row.session.examPlanJson);
    }
  }
  return {
    school: schoolFromConfig(config),
    policy: gradePolicyFrom(config),
    planBySession,
    series: series.map((s) => ({
      id: s.id,
      classId: s.classId,
      sessionId: s.sessionId,
      sessionLabel: s.session.label,
      sessionCurrent: s.session.current,
      planItemId: s.planItemId,
      name: s.name,
      published: Boolean(s.publishedAt),
      exams: s.exams.map((e) => ({
        id: e.id,
        title: e.title,
        maxMarks: e.maxMarks,
        date: e.date.toISOString(),
        paperDueOn: e.paperDueOn?.toISOString() ?? null,
        copiesDueOn: e.copiesDueOn?.toISOString() ?? null,
        resultOn: e.resultOn?.toISOString() ?? null,
        teacherId: e.teacherId,
        teacherName: e.teacher?.user.name || "",
        setterId: e.setterId,
        setterName: e.setter?.user.name || e.teacher?.user.name || "",
        evaluators: packedEvaluators(e),
        eligibleTeacherIds: eligibleMarksTeacherIds({
          examTeacherId: e.teacherId,
          subjectTeacherId: e.subject.teacherId,
          skillTeacherIds: skills
            .filter((skill) => skill.classId === e.classId && skill.subjectName === e.subject.name)
            .map((skill) => skill.teacherId),
        }),
        subject: { id: e.subject.id, name: e.subject.name },
        workflowStatus: e.workflowStatus,
        correctionNote: e.correctionNote || "",
        entered: e.results.length,
        paperAt: e.paperAt?.toISOString() ?? null,
        marksGrantedAt: e.marksGrantedAt?.toISOString() ?? null,
        conductedAt: e.conductedAt?.toISOString() ?? null,
        paperFileName: e.paperFileName || "",
        resultsPublishedAt: e.resultsPublishedAt?.toISOString() ?? null,
      })),
      marks: s.exams.flatMap((e) =>
        e.results.map((r) => ({
          examId: e.id,
          studentId: r.studentId,
          marks: r.marks,
          absent: r.absent,
          remarks: r.remarks,
          version: r.version,
          correctionNote: r.correctionNote || "",
          correctionRequested: Boolean(r.correctionRequestedAt),
        }))
      ),
    })),
  };
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const CHILD_COOKIE = "anekio-child";

export function readChildCookie() {
  return null;
}

export async function resolveChildId(
  parentUserId: string,
  requested?: string | null
) {
  const parent = await getParentWithChildren(parentUserId);
  if (!parent || parent.students.length === 0) return { parent, childId: null as string | null };
  const cookieId = readChildCookie();
  const pick =
    parent.students.find((s) => s.id === requested)?.id ??
    parent.students.find((s) => s.id === cookieId)?.id ??
    parent.students[0].id;
  return { parent, childId: pick };
}

export async function getAllClasses() {
  return prisma.class.findMany({
    include: {
      _count: { select: { students: true } },
      subjects: { include: { teacher: { include: { user: true } } } },
      slots: true,
    },
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }, { section: "asc" }],
  });
}

export async function getScheduleSetup() {
  const [config, periods, rooms, teachers] = await Promise.all([
    prisma.schoolConfig.findUnique({ where: { id: "school" } }),
    prisma.period.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.room.findMany({ orderBy: { name: "asc" } }),
    prisma.teacher.findMany({
      include: {
        user: true,
        subjects: true,
        skills: true,
        classes: true,
      },
    }),
  ]);
  return { config, periods, rooms, teachers };
}

export async function getWeekCapacity() {
  const [config, periods] = await Promise.all([
    prisma.schoolConfig.findUnique({ where: { id: "school" } }),
    prisma.period.findMany(),
  ]);
  const days = parseWeekdays(config?.weekdays);
  const teaching = periods.filter((p) => !p.isBreak).length;
  return weekCapacity(days.length, teaching);
}

export async function getClassTimetable(classId: string) {
  return prisma.timetableSlot.findMany({
    where: { classId },
    include: {
      period: true,
      subject: true,
      teacher: { include: { user: true } },
      room: true,
      class: true,
    },
  });
}

export async function getTeacherTimetable(teacherId: string) {
  return prisma.timetableSlot.findMany({
    where: { teacherId },
    include: {
      period: true,
      subject: true,
      teacher: { include: { user: true } },
      room: true,
      class: true,
    },
  });
}

export async function getStaffRoster(date = startOfDay()) {
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 400);
  const fromStamp = ymd(from);
  const [teachers, staff, days, leave, payrollRuns, audits] = await Promise.all([
    prisma.teacher.findMany({
      include: { user: { include: { manager: { select: { id: true, name: true } } } }, class: true },
      orderBy: { employeeId: "asc" },
    }),
    prisma.staffMember.findMany({
      where: { archivedAt: null },
      include: {
        role: { select: { id: true, name: true, portal: true } },
        user: { select: { id: true, email: true, managerId: true, manager: { select: { id: true, name: true } } } },
      },
      orderBy: { employeeId: "asc" },
    }),
    prisma.staffDay.findMany({ where: { date: { gte: from } }, orderBy: { date: "desc" } }),
    prisma.leaveRequest.findMany({
      where: {
        status: "ACTIVE",
        to: { gte: fromStamp },
        OR: [{ teacherId: { not: null } }, { staffId: { not: null } }],
      },
      select: {
        teacherId: true,
        staffId: true,
        from: true,
        to: true,
        reason: true,
        type: { select: { name: true, paid: true } },
      },
    }),
    prisma.staffPayrollRun.findMany(),
    prisma.staffAttendanceAudit.findMany({ orderBy: { createdAt: "desc" }, take: 400 }),
  ]);
  return { teachers, staff, days, leave, payrollRuns, audits, date };
}

export async function getDeskPulse() {
  const now = new Date();
  const day = startOfDay(now);
  const window = collectionWindow(now);
  const [config, periods, slots, teachers, attendance, invoices, classes, payments] = await Promise.all([
    prisma.schoolConfig.findUnique({ where: { id: "school" } }),
    prisma.period.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.timetableSlot.findMany({
      include: {
        class: true,
        subject: true,
        room: true,
        period: true,
        teacher: { include: { user: true } },
      },
    }),
    prisma.teacher.findMany({
      include: { user: true },
      orderBy: { employeeId: "asc" },
    }),
    prisma.staffDay.findMany({ where: { date: day, teacherId: { not: null } } }),
    prisma.feeInvoice.findMany({
      where: { status: { not: "PAID" } },
      include: { payments: true },
    }),
    prisma.class.findMany({
      where: { archivedAt: null },
      orderBy: [{ name: "asc" }, { section: "asc" }],
    }),
    prisma.payment.findMany({
      where: { paidAt: { gte: window.from } },
      select: { amount: true, paidAt: true },
    }),
  ]);
  const pulse = buildDeskPulse({
    now,
    weekdays: parseWeekdays(config?.weekdays),
    periods,
    classes,
    slots,
    teachers,
    attendance,
  });
  const collection = buildCollectionSeries(payments, now);
  return { pulse, invoices, collection, staffMarked: attendance.length, teacherCount: teachers.length };
}

export function portalForRole(role: string) {
  if (role === "TEACHER") return "teacher";
  if (role === "PARENT") return "parent";
  if (role === "STUDENT") return "student";
  return "admin";
}

const noticeInclude = {
  audiences: true,
  classes: { include: { class: true } },
  recipients: { select: { userId: true } },
  author: { select: { name: true } },
} as const;

export async function teacherNoticeClassIds(userId: string) {
  const teacher = await prisma.teacher.findUnique({
    where: { userId },
    include: { subjects: true, classes: true },
  });
  const ids = new Set<string>();
  if (teacher?.classId) ids.add(teacher.classId);
  for (const s of teacher?.subjects ?? []) ids.add(s.classId);
  for (const c of teacher?.classes ?? []) ids.add(c.classId);
  return [...ids];
}

function parseLeadFollowUpAt(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const isoish = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2})(?::(\d{2}))?)?/);
  if (isoish) {
    const [, y, m, d, hh = "9", mm = "0"] = isoish;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const tomorrow = raw.match(/^tomorrow\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (tomorrow) {
    const [, h, m = "0", ap = ""] = tomorrow;
    const date = new Date();
    date.setDate(date.getDate() + 1);
    let hour = Number(h);
    if (ap.toLowerCase() === "pm" && hour < 12) hour += 12;
    if (ap.toLowerCase() === "am" && hour === 12) hour = 0;
    date.setHours(hour, Number(m), 0, 0);
    return date;
  }
  return null;
}

async function ensureDueAdmissionFollowUpNotices(user: { portal: "OFFICE" | "TEACHER" | "PARENT" | "STUDENT" }) {
  if (user.portal !== "OFFICE") return;
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 2 * 60 * 1000);
  const author = await prisma.user.findFirst({
    where: { role: { portal: "OFFICE" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!author) return;
  const leads = await prisma.admissionLead.findMany({
    where: { status: { notIn: ["ADMITTED", "DISPOSED", "REJECTED"] }, followUpAt: { not: "" } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  for (const lead of leads) {
    const due = parseLeadFollowUpAt(lead.followUpAt);
    if (!due || due > windowEnd) continue;
    const marker = `lead-followup:${lead.id}:${lead.followUpAt}`;
    const exists = await prisma.notice.findFirst({
      where: { kind: "ADMISSION", body: { contains: marker } },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.notice.create({
      data: {
        title: `Follow up admission lead: ${lead.studentName}`,
        body: `${lead.guardianName} · ${lead.phone} · Class ${lead.classWanted}\n${lead.message || "No note"}\n\n${marker}`,
        kind: "ADMISSION",
        priority: "ACTION",
        authorId: author.id,
        audiences: { create: [{ portal: "OFFICE" }] },
      },
    });
  }
}

export async function noticesForUser(user: { id: string; portal: "OFFICE" | "TEACHER" | "PARENT" | "STUDENT" }) {
  await ensureDueAdmissionFollowUpNotices(user);
  const rows = await prisma.notice.findMany({
    include: noticeInclude,
    orderBy: { createdAt: "desc" },
  });
  if (user.portal === "OFFICE") {
    return rows.filter((n) =>
      n.recipients.length
        ? n.recipients.some((recipient) => recipient.userId === user.id)
        : n.audiences.some((a) => a.portal === "OFFICE")
    );
  }
  let classIds: string[] = [];
  let studentIds: string[] = [];
  if (user.portal === "PARENT") {
    const parent = await prisma.parent.findUnique({
      where: { userId: user.id },
      include: { students: { select: { id: true, classId: true } } },
    });
    classIds = [...new Set((parent?.students ?? []).map((s) => s.classId))];
    studentIds = (parent?.students ?? []).map((s) => s.id);
  } else if (user.portal === "TEACHER") {
    classIds = await teacherNoticeClassIds(user.id);
  } else if (user.portal === "STUDENT") {
    const student = await prisma.student.findUnique({
      where: { userId: user.id },
      select: { id: true, classId: true },
    });
    if (student) {
      classIds = [student.classId];
      studentIds = [student.id];
    }
  }
  return rows.filter((n) => {
    if (n.recipients.length) return n.recipients.some((recipient) => recipient.userId === user.id);
    if (!n.audiences.some((a) => a.portal === user.portal)) return false;
    if (n.studentId) {
      if (user.portal === "PARENT" || user.portal === "STUDENT") return studentIds.includes(n.studentId);
      if (user.portal === "TEACHER") return n.classes.some((c) => classIds.includes(c.classId));
      return false;
    }
    if (!n.classes.length) return true;
    return n.classes.some((c) => classIds.includes(c.classId));
  });
}

export async function getNoticesBoard() {
  const [notices, classes, config] = await Promise.all([
    prisma.notice.findMany({
      include: noticeInclude,
      orderBy: { createdAt: "desc" },
    }),
    prisma.class.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, section: true },
      orderBy: [{ name: "asc" }, { section: "asc" }],
    }),
    prisma.schoolConfig.findUnique({
      where: { id: "school" },
      select: { name: true },
    }),
  ]);
  return {
    notices,
    classes,
    schoolName: config?.name || "School",
  };
}
