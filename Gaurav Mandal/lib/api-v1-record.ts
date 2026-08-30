import {
  getClassRoster,
  getClassTimetable,
  getDeskPulse,
  getParentWithChildren,
  getPeople,
  getPeopleExamPack,
  getPublishedSeries,
  getScheduleSetup,
  getStaffRoster,
  getStudentBundle,
  getStudentForUser,
  getTeacherDesk,
  getTeacherProfile,
  getTeacherTimetable,
  getUpcomingExams,
  noticesForUser,
} from "./data";
import { isCircularNotice } from "./notices";
import { leaveBundleFor } from "./leave";
import { gradePolicyFrom, marksVisible, parseExamPlan, timetableVisible, ymd } from "./exams";
import { feeLineTotal, invoiceBalance, parseFeeLines } from "./fees";
import { studentLetter } from "./letter";
import { payFormFromSecrets, paySecretsFromRow } from "./pay-config";
import type { AccessUser } from "./permissions";
import { can, PERMISSIONS, scopeFor, scopePolicyFor } from "./permissions";
import { prisma } from "./prisma";
import { listManagerOptions, reportUserIds, teamClassIds } from "./reports";
import { placeLines, schoolFromConfig } from "./school";
import { listRoles } from "./roles";
import { parseSubjectCatalog, parseWeekdays, weekCapacity, WEEKDAY_SHORT } from "./schedule";
import { ensureSchoolSessions } from "./school-session";
import { documentStudioBundle } from "./document-studio";
import { CONTEST_TYPE_LABEL, daysLate, formatInr, LEVEL_LABEL, PATH_LABEL, percent, publicOrigin } from "./utils";
import { admissionCustomValues, admissionFormFields } from "./admission-form";

function inDate(value: Date | string) {
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function isBellNotice(n: { kind?: string | null; body?: string | null; recipients?: unknown[] }) {
  return isCircularNotice(n) || Boolean(n.recipients?.length);
}

function noticeSummary(n: { id: string; title: string; body: string; createdAt: Date; author: { name: string } }) {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    createdAt: inDate(n.createdAt),
    author: n.author.name,
  };
}

function parseJsonList(value: string | null | undefined, fallback: string[]) {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return fallback;
    const rows = parsed.map((item) => String(item || "").trim()).filter(Boolean);
    return rows.length ? rows : fallback;
  } catch {
    return fallback;
  }
}

async function timetableForClass(classId: string) {
  const [{ config, periods }, slots] = await Promise.all([getScheduleSetup(), getClassTimetable(classId)]);
  const weekdays = parseWeekdays(config?.weekdays);
  return {
    weekdays: weekdays.map((d) => ({ n: d, label: WEEKDAY_SHORT[d] || String(d) })),
    periods: periods.map((p) => ({ id: p.id, name: p.name, start: p.startsAt, end: p.endsAt })),
    slots: slots.map((s) => ({
      weekday: s.weekday,
      periodId: s.periodId,
      period: s.period.name,
      subject: s.subject?.name || "—",
      teacher: s.teacher?.user.name || "",
      room: s.room?.name || "",
      classLabel: s.class ? `${s.class.name}-${s.class.section}` : "",
    })),
  };
}

function serializeChild(
  child: NonNullable<Awaited<ReturnType<typeof getStudentBundle>>>,
  extras?: {
    timetable?: Awaited<ReturnType<typeof timetableForClass>> | null;
    upcoming?: { title: string; subject: string; date: string }[];
  }
) {
  const visible = child.examResults.filter((r) => marksVisible(r.exam));
  const by = new Map<string, { marks: number; max: number; n: number }>();
  for (const r of visible) {
    const name = r.exam.subject.name;
    const cur = by.get(name) ?? { marks: 0, max: 0, n: 0 };
    cur.marks += r.marks;
    cur.max += r.exam.maxMarks;
    cur.n += 1;
    by.set(name, cur);
  }
  const scored = [...by.entries()].map(([name, v]) => {
    const pct = percent(v.marks, v.max);
    return { name, pct, n: v.n };
  });
  const listed = child.class.subjects ?? [];
  const names = listed.length ? listed.map((s) => s.name) : scored.map((s) => s.name);
  const subjects = names
    .map((name) => {
      const row = listed.find((s) => s.name === name);
      const marks = scored.find((s) => s.name === name);
      const pct = marks?.pct ?? 0;
      const n = marks?.n ?? 0;
      const week = (extras?.timetable?.slots ?? [])
        .filter((s) => s.subject === name)
        .map((s) => {
          const p = extras?.timetable?.periods.find((x) => x.id === s.periodId || x.name === s.period);
          const day = extras?.timetable?.weekdays.find((d) => d.n === s.weekday)?.label || "";
          return { day, period: s.period, start: p?.start || "", end: p?.end || "" };
        });
      const next = extras?.upcoming?.find((e) => e.subject === name);
      return {
        name,
        pct,
        n,
        hint: n ? (pct >= 80 ? "Push this." : pct < 70 ? "Build this." : "Steady.") : "No paper yet.",
        teacher: row?.teacher?.user.name || extras?.timetable?.slots.find((s) => s.subject === name)?.teacher || "",
        week,
        nextTest: next ? { title: next.title, date: next.date } : null,
      };
    })
    .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));

  const letter = studentLetter({
    name: child.name,
    interests: child.interests,
    results: visible,
    entries: child.contestEntries,
  });

  return {
    id: child.id,
    name: child.name,
    classLabel: `${child.class.name}-${child.class.section}`,
    admissionNo: child.admissionNo,
    born: inDate(child.dateOfBirth),
    email: child.user?.email || "",
    parentName: child.parent?.user.name || "",
    parentPhone: child.parent?.phone || "",
    parentEmail: child.parent?.user.email || "",
    interests: child.interests.map((i) => PATH_LABEL[i.tag] || i.tag),
    attendance: child.attendance.map((a) => ({
      id: a.id,
      date: inDate(a.date),
      rawDate: a.date.toISOString().slice(0, 10),
      status: a.status.toLowerCase(),
    })),
    subjects,
    tests: visible.map((r) => ({
      id: r.id,
      title: r.exam.title,
      subject: r.exam.subject.name,
      marks: r.marks,
      max: r.exam.maxMarks,
      pct: percent(r.marks, r.exam.maxMarks),
      remarks: r.remarks || "",
    })),
    papers: child.papers.map((p) => ({
      id: p.id,
      title: p.exam.title,
      type: p.type.replace("_", " ").toLowerCase(),
      subject: p.exam.subject.name,
      notes: p.notes || "",
      teacher: p.teacher.name,
      date: inDate(p.createdAt),
      fileName: p.fileName,
      fileUrl: p.filePath ? `${publicOrigin()}/api/files/${p.filePath}` : "",
    })),
    path: child.contestEntries.map((e) => ({
      id: e.id,
      title: e.contest.title,
      type: CONTEST_TYPE_LABEL[e.contest.type] || e.contest.type,
      level: LEVEL_LABEL[e.contest.level] || e.contest.level,
      description: e.contest.description || "",
      rank: e.rank,
      result: e.result || "",
      score: e.score,
    })),
    letter: { lines: letter.lines, paths: letter.paths },
    fees: child.feeInvoices.map((inv) => {
      const b = invoiceBalance(inv);
      return {
        id: inv.id,
        title: inv.title,
        due: inDate(inv.dueDate),
        amount: formatInr(inv.amount),
        paid: formatInr(b.paid),
        remaining: formatInr(b.remaining),
        dueNow: b.dueNow,
        period: inv.period || "",
        dueAt: new Date(inv.dueDate).toISOString(),
        display: b.display.toLowerCase(),
        lateLabel: b.lateLabel,
        lines: feeLineTotal(parseFeeLines(inv.linesJson)).rows.map((l) => `${l.label} ${formatInr(l.value)}`),
        token: inv.shareToken,
        payUrl: inv.shareToken ? `${publicOrigin()}/pay/${inv.shareToken}` : "",
      };
    }),
  };
}

function serializeReports(
  child: NonNullable<Awaited<ReturnType<typeof getStudentBundle>>>,
  published: Awaited<ReturnType<typeof getPublishedSeries>>,
  config: Awaited<ReturnType<typeof prisma.schoolConfig.findUnique>>
) {
  const school = schoolFromConfig(config);
  const policy = gradePolicyFrom(config);
  return published.flatMap((series) => {
    const open = series.exams.filter((e) => marksVisible({ ...e, series: { publishedAt: series.publishedAt } }));
    if (!open.length) return [];
    const exams = open.map((e) => ({
      id: e.id,
      title: e.title,
      maxMarks: e.maxMarks,
      date: inDate(e.date),
      subject: { id: e.subject.id, name: e.subject.name },
    }));
    const marks = open.flatMap((e) =>
      e.results.map((r) => ({
        examId: e.id,
        studentId: r.studentId,
        marks: r.marks,
        absent: r.absent,
        remarks: r.remarks,
      }))
    );
    return [
      {
        seriesId: series.id,
        seriesName: series.name,
        sessionLabel: series.session.label,
        classLabel: `${child.class.name}-${child.class.section}`,
        school: {
          name: school.name,
          address: school.address,
          city: school.city,
          state: school.state,
          pincode: school.pincode,
          phone: school.phone,
          email: school.email,
          affiliation: school.affiliation,
          logoPath: school.logoPath,
          signPath: school.signPath,
          stampPath: school.stampPath,
          signatory: school.signatory,
          invoiceStyle: school.invoiceStyle,
        },
        exams,
        marks,
        classmates: [...new Set(marks.map((m) => m.studentId))].map((id) => ({
          id,
          name: id === child.id ? child.name : "",
        })),
        policy,
      },
    ];
  });
}

async function parentStudentPayload(user: AccessUser, requestedChildId?: string | null) {
  if (user.portal === "STUDENT") {
    const me = await getStudentForUser(user.id);
    if (!me) return { kind: "STUDENT" as const, children: [], child: null, upcoming: [], timetable: null, notices: [], reports: [] };
    const child = await getStudentBundle(me.id);
    const [upcoming, timetable, noticeRows, published, config] = await Promise.all([
      child
        ? getUpcomingExams(child.classId).then((rows) =>
            rows.filter((e) => timetableVisible(e)).map((e) => ({
              id: e.id,
              title: e.title,
              subject: e.subject.name,
              date: inDate(e.date),
              teacher: e.teacher?.user.name || "",
            }))
          )
        : Promise.resolve([]),
      child ? timetableForClass(child.classId) : Promise.resolve(null),
    noticesForUser(user).then((rows) =>
      rows
          .filter(isBellNotice)
          .slice(0, 3)
          .map(noticeSummary)
    ),
      child ? getPublishedSeries(child.classId) : Promise.resolve([]),
      prisma.schoolConfig.findUnique({ where: { id: "school" } }),
    ]);
    const leave = await leaveBundleFor({ portal: "STUDENT", studentIds: child ? [child.id] : [] });
    return {
      kind: "STUDENT" as const,
      children: child ? [{ id: child.id, name: child.name, classLabel: `${child.class.name}-${child.class.section}` }] : [],
      child: child ? serializeChild(child, { timetable, upcoming }) : null,
      upcoming,
      timetable,
      notices: noticeRows,
      reports: child ? serializeReports(child, published, config) : [],
      ...leave,
    };
  }

  const parent = await getParentWithChildren(user.id);
  const students = parent?.students ?? [];
  const childId = students.find((s) => s.id === requestedChildId)?.id ?? students[0]?.id ?? null;
  const child = childId ? await getStudentBundle(childId) : null;
  const [upcoming, timetable, noticeRows, published, config] = await Promise.all([
    child
      ? getUpcomingExams(child.classId).then((rows) =>
          rows.filter((e) => timetableVisible(e)).map((e) => ({
            id: e.id,
            title: e.title,
            subject: e.subject.name,
            date: inDate(e.date),
            teacher: e.teacher?.user.name || "",
          }))
        )
      : Promise.resolve([]),
    child ? timetableForClass(child.classId) : Promise.resolve(null),
    noticesForUser(user).then((rows) =>
      rows
        .filter(isBellNotice)
        .slice(0, 4)
        .map(noticeSummary)
    ),
    child ? getPublishedSeries(child.classId) : Promise.resolve([]),
    prisma.schoolConfig.findUnique({ where: { id: "school" } }),
  ]);
  const leave = await leaveBundleFor({ portal: "PARENT", studentIds: students.map((s) => s.id) });
  return {
    kind: "PARENT" as const,
    children: students.map((s) => ({
      id: s.id,
      name: s.name,
      classLabel: `${s.class.name}-${s.class.section}`,
    })),
    child: child ? serializeChild(child, { timetable, upcoming }) : null,
    upcoming,
    timetable,
    notices: noticeRows,
    reports: child ? serializeReports(child, published, config) : [],
    ...leave,
  };
}

async function teacherPayload(user: AccessUser) {
  const [desk, teacher, noticeRows] = await Promise.all([
    getTeacherDesk(user.id),
    getTeacherProfile(user.id),
    noticesForUser(user).then((rows) =>
      rows
        .filter(isBellNotice)
        .slice(0, 3)
        .map(noticeSummary)
    ),
  ]);
  const roster = teacher?.classId ? await getClassRoster(teacher.classId) : [];
  const today = ymd(new Date());
  const { config, periods } = await getScheduleSetup();
  const weekdays = parseWeekdays(config?.weekdays);
  const slots = teacher ? await getTeacherTimetable(teacher.id) : [];
  const subjects = teacher?.classId
    ? await prisma.subject.findMany({ where: { classId: teacher.classId }, orderBy: { name: "asc" } })
    : [];
  const peopleExamPack = teacher?.classId ? await getPeopleExamPack() : null;
  const seeFees = can(user, "fees.view");
  return {
    kind: "TEACHER" as const,
    classId: teacher?.classId || "",
    classLabel: desk?.classLabel || "",
    classTeacher: Boolean(desk?.classTeacher),
    markedToday: Boolean(desk?.markedToday),
    studentCount: desk?.studentCount ?? 0,
    outToday: desk?.outToday ?? [],
    todos: desk?.todos ?? [],
    doneWork: desk?.doneWork ?? [],
    markSheets: desk?.markSheets ?? [],
    callHome: desk?.callHome ?? [],
    weekPapers: desk?.week ?? [],
    needsAttention: desk?.needsAttention ?? [],
    breakout: desk?.breakout ?? 0,
    notices: noticeRows,
    subjects: subjects.map((s) => ({ id: s.id, name: s.name })),
    classes: teacher?.classId
      ? [{
          id: teacher.classId,
          label: desk?.classLabel || "",
          students: roster.length,
          subjects: subjects.map((s) => ({ id: s.id, name: s.name, teacherId: s.teacherId || "" })),
        }]
      : [],
    people: roster.map((s) => {
      const totals = seeFees
        ? s.feeInvoices.reduce(
            (acc, inv) => {
              const paidAmt = inv.payments.reduce((n, payment) => n + payment.amount, 0);
              const balance = invoiceBalance({ ...inv, paid: paidAmt });
              acc.billed += inv.amount;
              acc.paid += paidAmt;
              acc.due += balance.dueNow;
              if (balance.display === "OVERDUE") acc.overdue += 1;
              return acc;
            },
            { billed: 0, paid: 0, due: 0, overdue: 0 }
          )
        : null;
      return {
        id: s.id,
        name: s.name,
        classId: s.classId,
        classLabel: desk?.classLabel || "",
        parent: s.parent.user.name,
        parentPhone: s.parent.phone || s.parent.user.phone || "",
        admissionNo: s.admissionNo,
        path: s.interests.map((interest) => PATH_LABEL[interest.tag] || interest.tag),
        parentId: s.parent.id,
        parentEmail: s.parent.user.email,
        parentAddress: placeLines(s.parent).join(", ") || "",
        parentStreet: s.parent.address || "",
        parentCity: s.parent.city || "",
        parentState: s.parent.state || "",
        parentPincode: s.parent.pincode || "",
        born: s.dateOfBirth.toLocaleDateString("en-IN"),
        dateOfBirth: ymd(s.dateOfBirth),
        attendance: s.attendance.map((attendance) => ({ status: attendance.status })),
        ...(totals
          ? {
              feeLabel: totals.due > 0 ? `${formatInr(totals.due)} due` : "Paid up",
              feeTone: totals.due <= 0 ? "paid" : totals.overdue ? "overdue" : "due",
              billed: formatInr(totals.billed),
              paid: formatInr(totals.paid),
              dueNow: formatInr(totals.due),
              dueAmount: totals.due,
              overdueCount: totals.overdue,
              invoiceIds: s.feeInvoices.filter((invoice) => invoice.status !== "PAID").map((invoice) => invoice.id),
              invoices: s.feeInvoices.map((invoice) => {
                const paidAmt = invoice.payments.reduce((n, payment) => n + payment.amount, 0);
                const balance = invoiceBalance({ ...invoice, paid: paidAmt });
                return {
                  id: invoice.id,
                  title: invoice.title,
                  due: invoice.dueDate.toLocaleDateString("en-IN"),
                  amount: formatInr(invoice.amount),
                  paid: formatInr(paidAmt),
                  remaining: balance.remaining ? formatInr(balance.remaining) : "",
                  dueNow: balance.dueNow,
                  lateLabel: balance.lateLabel,
                  status: balance.display.toLowerCase(),
                };
              }),
            }
          : {}),
      };
    }),
    examPack: peopleExamPack
      ? {
          school: peopleExamPack.school,
          policy: peopleExamPack.policy,
          planBySession: peopleExamPack.planBySession,
          series: peopleExamPack.series.filter((series) => series.classId === teacher?.classId),
        }
      : undefined,
    roster: roster.map((s) => {
      const todayRow = s.attendance.find((a) => ymd(a.date) === today);
      return {
        id: s.id,
        name: s.name,
        today: todayRow ? todayRow.status.toLowerCase() : "not marked",
        dateOfBirth: ymd(s.dateOfBirth),
        parentName: s.parent.user.name,
        phone: s.parent.phone || s.parent.user.phone || "",
        days: s.attendance.map((a) => ({ date: ymd(a.date), status: a.status })),
      };
    }),
    exams: (desk?.todos ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      hint: t.hint,
      examId: t.examId,
      kind: t.kind,
    })),
    sittings: (desk?.week ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      hint: `${e.subject}${e.classLabel ? ` · ${e.classLabel}` : ""} · ${e.date}`,
    })),
    ...(await leaveBundleFor({
      portal: "TEACHER",
      userId: user.id,
      staffLeaveScope: can(user, "leave.decide") ? scopeFor(user, "leave.decide") : undefined,
      teacherId: teacher?.id || null,
      classId: teacher?.classId || null,
    })),
    ...(await teacherRecordExtras(user, weekdays, periods, slots)),
  };
}

async function teacherRecordExtras(
  user: AccessUser,
  weekdays: number[],
  periods: { id: string; name: string; startsAt: string; endsAt: string; isBreak: boolean; sortOrder: number }[],
  ownSlots: Awaited<ReturnType<typeof getTeacherTimetable>>
) {
  const extras = await teacherTeamExtras(user, weekdays, periods);
  const slots = ownSlots.map((s) => ({
    weekday: s.weekday,
    periodId: s.periodId,
    period: s.period.name,
    subject: s.subject?.name || "—",
    teacher: s.teacher?.user.name || "",
    room: s.room?.name || "",
    classLabel: s.class ? `${s.class.name}-${s.class.section}` : "",
  }));
  if ("timetable" in extras && extras.timetable) {
    return { ...extras, timetable: { ...extras.timetable, slots } };
  }
  return {
    ...extras,
    timetable: {
      weekdays: weekdays.map((d) => ({ n: d, label: WEEKDAY_SHORT[d] || String(d) })),
      periods: periods.map((p) => ({ id: p.id, name: p.name, start: p.startsAt, end: p.endsAt })),
      slots,
    },
  };
}

async function teacherTeamExtras(
  user: AccessUser,
  weekdays: number[],
  periods: { id: string; name: string; startsAt: string; endsAt: string; isBreak: boolean; sortOrder: number }[]
) {
  const reportIds = await reportUserIds(user.id);
  const managers = await listManagerOptions();
  if (!reportIds.length || !can(user, "timetable.view")) return { teamWeek: false, managers };
  const classIds = await teamClassIds(user.id);
  const [{ pulse }, setup, klasses, reports] = await Promise.all([
    getDeskPulse(),
    getScheduleSetup(),
    classIds.length
      ? prisma.class.findMany({
          where: { id: { in: classIds }, archivedAt: null },
          include: {
            slots: {
              include: { period: true, subject: true, teacher: { include: { user: true } }, room: true },
            },
            subjects: true,
          },
          orderBy: [{ name: "asc" }, { section: "asc" }],
        })
      : Promise.resolve([]),
    prisma.user.findMany({
      where: { id: { in: reportIds } },
      include: { teacher: { select: { id: true } }, staffMember: { select: { id: true } }, role: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);
  const reportTeacherIds = new Set(reports.map((r) => r.teacher?.id).filter((id): id is string => Boolean(id)));
  const idleNow = pulse.idleTeachers
    .map((t) => ({
      id: t.id,
      name: t.user.name,
      employeeId: t.employeeId,
      team: reportTeacherIds.has(t.id),
    }))
    .sort((a, b) => Number(b.team) - Number(a.team) || a.name.localeCompare(b.name));
  const holes = pulse.unassigned.filter((h) => classIds.includes(h.classId));
  const teamWeek = classIds.length > 0 && scopeFor(user, "timetable.view") === "REPORTS";
  return {
    teamWeek,
    managers,
    team: {
      emptyPeriods: holes.length,
      idleNow,
      holes: holes.reduce<{ classId: string; classLabel: string; count: number }[]>((rows, hole) => {
        const hit = rows.find((r) => r.classId === hole.classId);
        if (hit) hit.count += 1;
        else rows.push({ classId: hole.classId, classLabel: hole.classLabel, count: 1 });
        return rows;
      }, []),
      people: reports.map((r) => ({
        userId: r.id,
        name: r.name,
        role: r.role.name,
        teacherId: r.teacher?.id || "",
      })),
    },
    ...(teamWeek
      ? {
          timetable: {
            weekdays: weekdays.map((d) => ({ n: d, label: WEEKDAY_SHORT[d] || String(d) })),
            periods: periods.map((p) => ({
              id: p.id,
              name: p.name,
              start: p.startsAt,
              end: p.endsAt,
              isBreak: p.isBreak,
              sortOrder: p.sortOrder,
            })),
            rooms: setup.rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
            teachers: setup.teachers.map((t) => ({
              id: t.id,
              name: t.user.name,
              qualification: t.qualification || "",
              idle: idleNow.some((i) => i.id === t.id),
              team: reportTeacherIds.has(t.id),
              skills: t.skills.map((s) => ({ subjectName: s.subjectName, classId: s.classId })),
            })),
            weekCapacity: weekCapacity(weekdays.length, periods.filter((p) => !p.isBreak).length),
            classes: klasses.map((c) => ({
              id: c.id,
              label: `${c.name}-${c.section}`,
              name: c.name,
              section: c.section,
              subjects: (c.subjects || []).map((s) => ({ id: s.id, name: s.name, weightage: s.weightage })),
              slots: c.slots.map((s) => ({
                weekday: s.weekday,
                periodId: s.periodId,
                period: s.period.name,
                subjectId: s.subject?.id || "",
                subject: s.subject?.name || "—",
                teacherId: s.teacherId || "",
                teacher: s.teacher?.user.name || "",
                room: s.room?.name || "",
              })),
            })),
          },
        }
      : {}),
  };
}

async function officePayload(user: AccessUser) {
  const sessionPack = await ensureSchoolSessions();
  const { sessions, current } = sessionPack;
  const [{ pulse, invoices, collection }, people, staff, config, roles, { config: sched, periods, rooms, teachers: weekTeachers }, classes, recentExams, holidays, examPack] =
    await Promise.all([
      getDeskPulse(),
      getPeople(),
      getStaffRoster(),
      prisma.schoolConfig.findUnique({ where: { id: "school" } }),
      listRoles(),
      getScheduleSetup(),
      prisma.class.findMany({
        where: { archivedAt: null },
        include: {
          slots: {
            include: { period: true, subject: true, teacher: { include: { user: true } }, room: true },
          },
          subjects: true,
        },
        orderBy: [{ name: "asc" }, { section: "asc" }],
      }),
      prisma.exam.findMany({
        include: { subject: true, class: true },
        orderBy: { date: "desc" },
        take: 40,
      }),
      prisma.schoolHoliday.findMany({ where: { sessionId: { in: sessions.map((s) => s.id) } }, orderBy: { date: "asc" } }),
      getPeopleExamPack(),
    ]);
  const weekdays = parseWeekdays(sched?.weekdays);
  const openBills = invoices.filter((i) => i.status !== "PAID");
  const overdue = openBills.filter((i) => daysLate(i.dueDate) > 0);
  const dueNow = openBills.reduce((sum, i) => {
    const paid = i.payments.reduce((s, p) => s + p.amount, 0);
    return sum + Math.max(0, i.amount - paid);
  }, 0);
  const holeMap = new Map<string, { classId: string; classLabel: string; count: number }>();
  for (const hole of pulse.unassigned) {
    const row = holeMap.get(hole.classId) ?? { classId: hole.classId, classLabel: hole.classLabel, count: 0 };
    row.count += 1;
    holeMap.set(hole.classId, row);
  }
  const todayKey = ymd(new Date());
  const coverUntil = new Date();
  coverUntil.setDate(coverUntil.getDate() + 7);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [substituteAssignments, todayAttendance] = await Promise.all([
    prisma.substituteAssignment.findMany({
      where: { date: { gte: todayKey, lte: ymd(coverUntil) } },
      include: {
        substitute: { include: { user: true } },
        leaveRequest: { include: { teacher: { include: { user: true } } } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.attendance.findMany({
      where: { date: today },
      select: { status: true, student: { select: { classId: true } } },
    }),
  ]);
  const attendanceByClass = new Map<string, { present: number; absent: number; marked: number }>();
  for (const row of todayAttendance) {
    const current = attendanceByClass.get(row.student.classId) ?? { present: 0, absent: 0, marked: 0 };
    current.marked += 1;
    if (row.status === "PRESENT" || row.status === "LATE") current.present += 1;
    else current.absent += 1;
    attendanceByClass.set(row.student.classId, current);
  }
  const coverBySlot = new Map<string, typeof substituteAssignments>();
  for (const assignment of substituteAssignments) {
    const rows = coverBySlot.get(assignment.slotId) ?? [];
    rows.push(assignment);
    coverBySlot.set(assignment.slotId, rows);
  }
  const timetableScope = can(user, "timetable.view")
    ? scopeFor(user, "timetable.view")
    : can(user, "timetable.edit")
      ? scopeFor(user, "timetable.edit")
      : null;
  const teamWeek = timetableScope === "REPORTS";
  const scopedClassIds = teamWeek ? await teamClassIds(user.id) : [];
  const weekClasses = timetableScope === "SCHOOL" ? classes : classes.filter((c) => scopedClassIds.includes(c.id));
  const reportIds = await reportUserIds(user.id);
  const reportTeacherIds = new Set(
    (
      await prisma.user.findMany({
        where: { id: { in: reportIds } },
        select: { teacher: { select: { id: true } } },
      })
    )
      .map((r) => r.teacher?.id)
      .filter((id): id is string => Boolean(id))
  );
  const visibleRoomIds = new Set(weekClasses.flatMap((klass) => klass.slots.map((slot) => slot.roomId).filter(Boolean)));
  const visibleWeekTeachers =
    timetableScope === "SCHOOL" ? weekTeachers : weekTeachers.filter((teacher) => reportTeacherIds.has(teacher.id));
  const idleIds = new Set(pulse.idleTeachers.map((t) => t.id));
  const admissionLeads = can(user, "admissions.view") || can(user, "admissions.manage") || can(user, "school.edit")
      ? await prisma.admissionLead.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { events: { orderBy: { createdAt: "desc" } } },
      })
    : [];
  return {
    kind: "OFFICE" as const,
    desk: {
      label: pulse.label,
      emptyPeriods: pulse.unassigned.length,
      idleStaff: pulse.idleTeachers.length,
      teacherAbsent: pulse.emptyClasses.length,
      unmarked: pulse.unmarked,
      overdueCount: overdue.length,
      dueNow: formatInr(dueNow),
      pendingBills: openBills.length,
      school: config?.name || "School",
      holes: [...holeMap.values()].sort((a, b) => b.count - a.count),
      idleNow: pulse.idleTeachers.map((t) => ({ id: t.id, name: t.user.name, employeeId: t.employeeId })),
      didNotCome: [
        ...pulse.emptyClasses.map((s) => ({
          id: s.id,
          label: `${s.class.name}-${s.class.section}${s.subject ? ` · ${s.subject.name}` : ""} · ${s.teacher?.user.name ?? "Teacher"}`,
        })),
        ...pulse.emptyLabs.map((s) => ({
          id: s.id,
          label: `${s.room?.name ?? "Lab"} · ${s.teacher?.user.name ?? "Teacher"}`,
        })),
      ],
      todayAmount: formatInr(collection.todayAmount),
      weekAmount: formatInr(collection.weekAmount),
      series: collection.series.map((d) => ({ label: d.label, amount: d.amount, isToday: d.isToday })),
      classAttendance: people.classes.map((klass) => {
        const total = klass._count.students;
        const marked = attendanceByClass.get(klass.id) ?? { present: 0, absent: 0, marked: 0 };
        const classTeacher = people.teachers.find((teacher) => teacher.classId === klass.id);
        const teacherDay = classTeacher
          ? staff.days.find((day) => day.teacherId === classTeacher.id && ymd(day.date) === todayKey)
          : null;
        return {
          classId: klass.id,
          label: `${klass.name}-${klass.section}`,
          total,
          present: marked.present,
          absent: marked.absent,
          unmarked: Math.max(0, total - marked.marked),
          percent: total ? Math.round((marked.present / total) * 100) : 0,
          teacherId: classTeacher?.id || "",
          teacherName: classTeacher?.user.name || "Not assigned",
          teacherPhone: classTeacher?.user.phone || "",
          teacherStatus: teacherDay?.status || "",
          managerName: classTeacher?.user.manager?.name || "",
          managerPhone: classTeacher?.user.manager?.phone || "",
        };
      }),
    },
    classes: people.classes.map((c) => ({
      id: c.id,
      label: `${c.name}-${c.section}`,
      name: c.name,
      section: c.section,
      students: c._count.students,
      subjects: (c.subjects || []).map((s) => ({ id: s.id, name: s.name, teacherId: s.teacherId || "" })),
    })),
    feeTemplates: (
      await prisma.feeTemplate.findMany({
        include: { lines: { orderBy: { sortOrder: "asc" } }, class: true },
      })
    ).map((t) => ({
      id: t.id,
      classId: t.classId,
      sessionId: t.sessionId || "",
      name: t.name,
      dueDay: t.dueDay,
      lateKind: t.lateKind,
      lateGraceDays: t.lateGraceDays,
      lateAmount: t.lateAmount,
      lines: t.lines.map((l) => ({ label: l.label, kind: l.kind, amount: l.amount })),
    })),
    people: people.students.map((s) => {
      const totals = s.feeInvoices.reduce(
        (acc, inv) => {
          const paidAmt = inv.payments.reduce((n, p) => n + p.amount, 0);
          const m = invoiceBalance({ ...inv, paid: paidAmt });
          acc.billed += inv.amount;
          acc.paid += paidAmt;
          acc.due += m.dueNow;
          if (m.display === "OVERDUE") acc.overdue += 1;
          return acc;
        },
        { billed: 0, paid: 0, due: 0, overdue: 0 }
      );
      return {
        id: s.id,
        name: s.name,
        classId: s.classId,
        classLabel: `${s.class.name}-${s.class.section}`,
        parent: s.parent.user.name,
        parentPhone: s.parent.phone || "",
        admissionNo: s.admissionNo,
        path: s.interests.map((i) => PATH_LABEL[i.tag] || i.tag),
        feeLabel: totals.due > 0 ? `${formatInr(totals.due)} due` : "Paid up",
        feeTone: totals.due <= 0 ? "paid" : totals.overdue ? "overdue" : "due",
        parentId: s.parent.id,
        parentEmail: s.parent.user.email,
        parentAddress: placeLines(s.parent).join(", ") || "",
        born: s.dateOfBirth.toLocaleDateString("en-IN"),
        dateOfBirth: ymd(s.dateOfBirth),
        parentStreet: s.parent.address || "",
        parentCity: s.parent.city || "",
        parentState: s.parent.state || "",
        parentPincode: s.parent.pincode || "",
        billed: formatInr(totals.billed),
        paid: formatInr(totals.paid),
        dueNow: formatInr(totals.due),
        dueAmount: totals.due,
        overdueCount: totals.overdue,
        attendance: s.attendance.map((a) => ({ status: a.status })),
        invoiceIds: s.feeInvoices.filter((inv) => inv.status !== "PAID").map((inv) => inv.id),
        invoices: s.feeInvoices.map((inv) => {
          const paidAmt = inv.payments.reduce((n, p) => n + p.amount, 0);
          const m = invoiceBalance({ ...inv, paid: paidAmt });
          return {
            id: inv.id,
            title: inv.title,
            due: inv.dueDate.toLocaleDateString("en-IN"),
            amount: formatInr(inv.amount),
            paid: formatInr(paidAmt),
            remaining: m.remaining ? formatInr(m.remaining) : "",
            dueNow: m.dueNow,
            lateLabel: m.lateLabel,
            status: m.display.toLowerCase(),
          };
        }),
      };
    }),
    peopleTeachers: people.teachers.map((t) => ({
      id: t.id,
      userId: t.userId,
      name: t.user.name,
      email: t.user.email,
      phone: t.user.phone || "",
      employeeId: t.employeeId,
      role: t.class ? `Class teacher ${t.class.name}-${t.class.section}` : "Teacher",
      qualification: t.qualification || "",
      classId: t.classId || "",
      classLabel: t.class ? `${t.class.name}-${t.class.section}` : "",
      managerId: t.user.managerId || "",
      managerName: t.user.manager?.name || "",
    })),
    peopleParents: people.parents.map((p) => ({
      id: p.id,
      name: p.user.name,
      email: p.user.email,
      phone: p.phone || "",
      address: placeLines(p).join(", "),
      street: p.address || "",
      city: p.city || "",
      state: p.state || "",
      pincode: p.pincode || "",
      children: p.students.map((s) => ({
        id: s.id,
        name: s.name,
        classId: s.classId,
        classLabel: `${s.class.name}-${s.class.section}`,
      })),
      childCount: p.students.length,
    })),
    staff: [
      ...staff.teachers.map((t) => {
        const today = staff.days.find((d) => d.teacherId === t.id && ymd(d.date) === todayKey);
        return {
          id: t.id,
          userId: t.userId,
          kind: "teacher" as const,
          name: t.user.name,
          email: t.user.email,
          employeeId: t.employeeId,
          roleId: t.user.roleId,
          role: t.class ? `Class teacher ${t.class.name}-${t.class.section}` : "Teacher",
          phone: t.user.phone || "",
          qualification: t.qualification || "",
          classLabel: t.class ? `${t.class.name}-${t.class.section}` : "",
          address: t.address || "",
          city: t.city || "",
          state: t.state || "",
          pincode: t.pincode || "",
          joinedOn: t.joinedOn || "",
          today: today ? today.status : "PRESENT",
          days: staff.days
            .filter((d) => d.teacherId === t.id)
            .map((d) => ({ date: ymd(d.date), status: d.status })),
          managerId: t.user.managerId || "",
          managerName: t.user.manager?.name || "",
        };
      }),
      ...staff.staff.map((s) => {
        const today = staff.days.find((d) => d.staffId === s.id && ymd(d.date) === todayKey);
        return {
          id: s.id,
          userId: s.userId || "",
          kind: "staff" as const,
          name: s.name,
          email: s.user?.email || "",
          employeeId: s.employeeId,
          roleId: s.roleId || "",
          role: s.role?.name || s.title || "Staff",
          phone: s.phone || "",
          address: s.address || "",
          city: s.city || "",
          state: s.state || "",
          pincode: s.pincode || "",
          joinedOn: s.joinedOn || "",
          today: today ? today.status : "PRESENT",
          days: staff.days
            .filter((d) => d.staffId === s.id)
            .map((d) => ({ date: ymd(d.date), status: d.status })),
          managerId: s.user?.managerId || "",
          managerName: s.user?.manager?.name || "",
        };
      }),
    ],
    staffRoles: roles
      .filter((r) => r.portal !== "STUDENT")
      .map((r) => ({ id: r.id, name: r.name, portal: r.portal, slug: r.slug })),
    school: {
      name: config?.name || "School",
      phone: config?.phone || "",
      email: config?.email || "",
      address: config?.address || "",
      city: config?.city || "",
      state: config?.state || "",
      pincode: config?.pincode || "",
      affiliation: config?.affiliation || "",
      gstin: config?.gstin || "",
      pan: config?.pan || "",
      upiId: config?.upiId || "",
      bankName: config?.bankName || "",
      bankAccountName: config?.bankAccountName || "",
      bankAccountNumber: config?.bankAccountNumber || "",
      bankIfsc: config?.bankIfsc || "",
      signatory: config?.signatory || "",
      invoiceStyle: config?.invoiceStyle || "classic",
      logoPath: config?.logoPath || "",
      signPath: config?.signPath || "",
      stampPath: config?.stampPath || "",
      sessionStart: current.startsOn,
      sessionEnd: current.endsOn,
      sessionId: current.id,
      sessionLabel: current.label,
      admissionCharge: config?.admissionCharge || 0,
      admissionForm: admissionFormFields(config?.admissionFormJson),
      whatsappCommunityUrl: config?.whatsappCommunityUrl || "",
      website: {
        enabled: config?.websiteEnabled || false,
        slug: config?.websiteSlug || "demo",
        theme: config?.websiteTheme || "blue",
        heroTitle: config?.websiteHeroTitle || "",
        heroSubtitle: config?.websiteHeroSubtitle || "",
        about: config?.websiteAbout || "",
        highlights: parseJsonList(config?.websiteHighlights, ["CBSE aligned learning", "Safe campus", "Smart parent updates", "Admissions open"]),
        facilities: parseJsonList(config?.websiteFacilities, ["Digital classrooms", "Library", "Computer lab", "Sports", "Transport"]),
        gallery: parseJsonList(config?.websiteGallery, []),
        admissionOpen: config?.websiteAdmissionOpen ?? true,
        admissionNote: config?.websiteAdmissionNote || "Admissions are open. Submit an enquiry and our office will contact you.",
      },
      admissionLeads: admissionLeads.map((lead) => ({
        id: lead.id,
        studentName: lead.studentName,
        guardianName: lead.guardianName,
        phone: lead.phone,
        email: lead.email,
        classWanted: lead.classWanted,
        message: lead.message,
        customFields: admissionCustomValues(lead.customFieldsJson),
        source: lead.source,
        status: lead.status,
        followUpAt: lead.followUpAt,
        notes: lead.notes,
        createdAt: lead.createdAt.toLocaleDateString("en-IN"),
        updatedAt: (lead.events[0]?.createdAt || lead.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
        events: lead.events.map((event) => ({
          id: event.id,
          kind: event.kind,
          title: event.title,
          body: event.body,
          actorName: event.actorName,
          createdAt: event.createdAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
        })),
      })),
      subjectCatalog: parseSubjectCatalog(config?.subjectCatalog),
      sessions: sessions.map((s) => ({
        id: s.id,
        label: s.label,
        startsOn: s.startsOn,
        endsOn: s.endsOn,
        current: s.current,
      })),
      holidays: holidays.map((h) => ({ id: h.id, sessionId: h.sessionId || "", date: h.date, name: h.name })),
      policy: gradePolicyFrom(config),
      plan: parseExamPlan(current.examPlanJson),
      pay: payFormFromSecrets(paySecretsFromRow(config)),
    },
    fees: people.students
      .flatMap((s) =>
        s.feeInvoices.map((inv) => {
          const paid = inv.payments.reduce((n, p) => n + p.amount, 0);
          const remaining = Math.max(0, inv.amount - paid);
          const late = inv.status !== "PAID" && daysLate(inv.dueDate) > 0;
          return {
            id: inv.id,
            title: inv.title,
            student: s.name,
            studentId: s.id,
            classId: s.classId,
            classLabel: `${s.class.name}-${s.class.section}`,
            amount: formatInr(inv.amount),
            paid: formatInr(paid),
            remaining,
            status: remaining <= 0 ? "paid" : late ? "overdue" : inv.status.toLowerCase(),
          };
        })
      )
      .slice(0, 80),
    exams: people.classes.map((c) => ({
      id: c.id,
      label: `${c.name}-${c.section}`,
      students: c._count.students,
    })),
    examPack: {
      school: examPack.school,
      policy: examPack.policy,
      planBySession: Object.fromEntries(
        sessions.map((s) => [s.id, examPack.planBySession[s.id] ?? parseExamPlan(s.examPlanJson)])
      ),
      series: examPack.series,
    },
    examList: recentExams.map((e) => ({
      id: e.id,
      title: e.title,
      classId: e.classId,
      label: `${e.subject.name} · ${e.class.name}-${e.class.section}`,
    })),
    examStudents: people.students.map((s) => ({ id: s.id, name: s.name, classId: s.classId })),
    examPapers: people.classes.flatMap((c) =>
      (c.subjects || []).map((sub) => ({ id: sub.id, name: sub.name, classId: c.id }))
    ),
    roles: can(user, "roles.manage") ? roles.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      portal: r.portal,
      description: r.description,
      isSystem: r.isSystem,
      users: r._count.users,
      grants: r.grants.map((g) => g.permission),
      grantScopes: Object.fromEntries(
        r.grants.map((g) => [g.permission, g.scope ?? scopePolicyFor(g.permission).defaultScope])
      ),
    })) : [],
    officeUsers: can(user, "roles.manage") ? await prisma.user.findMany({
      where: { role: { portal: "OFFICE" } },
      select: {
        id: true,
        name: true,
        email: true,
        roleId: true,
        managerId: true,
        manager: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }).then((rows) =>
      rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        roleId: u.roleId,
        managerId: u.managerId || "",
        managerName: u.manager?.name || "",
      }))
    ) : [],
    teamWeek,
    managers: await listManagerOptions(),
    permissionCatalog: can(user, "roles.manage") ? PERMISSIONS.map((p) => ({
      key: p.key,
      group: p.group,
      label: p.label,
      hint: p.hint,
      see: "see" in p && Boolean(p.see),
      portals: [...p.portals],
      scopes: [...scopePolicyFor(p.key).scopes],
      defaultScope: scopePolicyFor(p.key).defaultScope,
      scopePolicies: Object.fromEntries(
        p.portals.map((portal) => [portal, scopePolicyFor(p.key, portal)])
      ),
    })) : [],
    teachers: people.teachers.map((t) => ({ id: t.id, name: t.user.name })),
    timetable: {
      weekdays: timetableScope ? weekdays.map((d) => ({ n: d, label: WEEKDAY_SHORT[d] || String(d) })) : [],
      periods: timetableScope ? periods.map((p) => ({
        id: p.id,
        name: p.name,
        start: p.startsAt,
        end: p.endsAt,
        isBreak: p.isBreak,
        sortOrder: p.sortOrder,
      })) : [],
      rooms: timetableScope ? rooms.filter((room) => timetableScope === "SCHOOL" || visibleRoomIds.has(room.id)).map((r) => ({ id: r.id, name: r.name, kind: r.kind })) : [],
      teachers: visibleWeekTeachers.map((t) => ({
        id: t.id,
        name: t.user.name,
        qualification: t.qualification || "",
        idle: idleIds.has(t.id),
        team: reportTeacherIds.has(t.id),
        skills: t.skills.map((s) => ({ subjectName: s.subjectName, classId: s.classId })),
      })),
      weekCapacity: timetableScope ? weekCapacity(weekdays.length, periods.filter((p) => !p.isBreak).length) : 0,
      classes: weekClasses.map((c) => ({
        id: c.id,
        label: `${c.name}-${c.section}`,
        name: c.name,
        section: c.section,
        subjects: (c.subjects || []).map((s) => ({
          id: s.id,
          name: s.name,
          weightage: s.weightage,
        })),
        slots: c.slots.map((s) => ({
          id: s.id,
          weekday: s.weekday,
          periodId: s.periodId,
          period: s.period.name,
          subjectId: s.subject?.id || "",
          subject: s.subject?.name || "—",
          teacherId: s.teacherId || "",
          teacher: s.teacher?.user.name || "",
          room: s.room?.name || "",
          covers: (coverBySlot.get(s.id) ?? []).map((assignment) => ({
            date: assignment.date,
            substituteId: assignment.substituteId,
            substitute: assignment.substitute.user.name,
            absentTeacher: assignment.leaveRequest.teacher?.user.name || s.teacher?.user.name || "Teacher",
          })),
        })),
      })),
    },
    documentStudio: can(user, "documents.view") || can(user, "school.edit") ? await documentStudioBundle() : null,
    ...(await leaveBundleFor({
      portal: "OFFICE",
      userId: user.id,
      staffLeaveScope: can(user, "leave.decide") ? scopeFor(user, "leave.decide") : undefined,
      staffId: (await prisma.staffMember.findUnique({ where: { userId: user.id }, select: { id: true } }))?.id || null,
    })),
  };
}

export async function recordPayload(user: AccessUser, childId?: string | null) {
  if (user.portal === "PARENT" || user.portal === "STUDENT") {
    return parentStudentPayload(user, childId);
  }
  if (user.portal === "TEACHER") return teacherPayload(user);
  return officePayload(user);
}
