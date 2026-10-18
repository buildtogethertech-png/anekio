import { can, scopeFor, type AccessUser } from "./permissions";
import { prisma } from "./prisma";
import { teamClassIds } from "./reports";
import { parseWeekdays, WEEKDAY_SHORT } from "./schedule";
import { placeLines, schoolFromConfig } from "./school";
import { getClassTimetable, getTeacherTimetable } from "./data";

export type RoutinePrintSlot = {
  weekday: number;
  periodId?: string;
  period: string;
  subject: string;
  teacher?: string;
  room?: string;
  classLabel?: string;
};

export type RoutinePrintGrid = {
  schoolName: string;
  place?: string;
  subtitle: string;
  weekdays: { n: number; label: string }[];
  periods: { id: string; name: string; start?: string; end?: string; isBreak?: boolean }[];
  slots: RoutinePrintSlot[];
  showTeacher?: boolean;
  showClass?: boolean;
};

function esc(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slotFor(grid: RoutinePrintGrid, weekday: number, period: RoutinePrintGrid["periods"][number]) {
  return grid.slots.find(
    (slot) => slot.weekday === weekday && (slot.periodId ? slot.periodId === period.id : slot.period === period.name)
  );
}

function filled(slot?: RoutinePrintSlot) {
  return Boolean(slot && slot.subject && slot.subject !== "—");
}

function cellMeta(grid: RoutinePrintGrid, slot: RoutinePrintSlot) {
  return [grid.showTeacher ? slot.teacher : "", grid.showClass ? slot.classLabel : "", slot.room]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" · ");
}

export function routinePrintHtml(grid: RoutinePrintGrid) {
  return routinePrintHtmlMany([grid]);
}

function routineSheet(grid: RoutinePrintGrid) {
  const head = grid.weekdays
    .map((day) => `<th>${esc(day.label)}</th>`)
    .join("");
  const body = grid.periods
    .map((period) => {
      const time = [period.start, period.end].filter(Boolean).join("–");
      if (period.isBreak) {
        return `<tr class="break"><th>${esc(period.name)}${time ? `<span>${esc(time)}</span>` : ""}</th><td colspan="${grid.weekdays.length}">Break</td></tr>`;
      }
      const cells = grid.weekdays
        .map((day) => {
          const slot = slotFor(grid, day.n, period);
          if (!filled(slot) || !slot) return `<td class="empty">—</td>`;
          const meta = cellMeta(grid, slot);
          return `<td><strong>${esc(slot.subject)}</strong>${meta ? `<small>${esc(meta)}</small>` : ""}</td>`;
        })
        .join("");
      return `<tr><th>${esc(period.name)}${time ? `<span>${esc(time)}</span>` : ""}</th>${cells}</tr>`;
    })
    .join("");

  return `<main class="sheet">
    <h1>${esc(grid.schoolName)}</h1>
    ${grid.place ? `<p class="place">${esc(grid.place)}</p>` : ""}
    <h2>${esc(grid.subtitle)}</h2>
    <table>
      <thead><tr><th>Period</th>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </main>`;
}

/** One printable page per class (page break between them), e.g. "All classes". */
export function routinePrintHtmlMany(grids: RoutinePrintGrid[]) {
  const title = grids.length === 1 ? grids[0].subtitle : `${grids.length} classes`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Routine · ${esc(title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  html,body { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { margin:0; background:#eef2f7; font-family:Inter,system-ui,"Segoe UI",sans-serif; color:#0f172a; }
  .toolbar { position:sticky; top:0; z-index:2; padding:12px; text-align:center; background:#eef2f7; }
  .sheet { width:277mm; margin:16px auto 32px; background:#fff; padding:18px 20px 24px; box-shadow:0 2px 18px #102a4322; }
  h1 { margin:0; font-size:20px; }
  .place { margin:4px 0 0; color:#475569; font-size:12px; }
  h2 { margin:14px 0 10px; font-size:15px; font-weight:700; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:11px; }
  th,td { border:1px solid #cbd5e1; padding:7px 8px; vertical-align:top; }
  thead th { background:#0f172a; color:#fff; font-size:11px; letter-spacing:.04em; text-transform:uppercase; }
  tbody th { width:88px; background:#f8fafc; text-align:left; }
  tbody th span { display:block; margin-top:3px; font-weight:500; color:#64748b; font-size:10px; }
  td strong { display:block; font-size:12px; }
  td small { display:block; margin-top:3px; color:#475569; font-size:10px; }
  td.empty { color:#94a3b8; text-align:center; }
  tr.break td { text-align:center; background:#fffbeb; color:#92400e; font-weight:600; }
  @media print { body { background:#fff; } .toolbar { display:none; } .sheet { box-shadow:none; margin:0; width:auto; } }
  .sheet + .sheet { page-break-before: always; break-before: page; }
</style></head>
<body>
  <div class="toolbar"><button onclick="window.print()">Save as PDF</button></div>
  ${grids.map(routineSheet).join("\n")}
</body></html>`;
}

function classLabel(klass: { name: string; section: string }) {
  return `${klass.name}-${klass.section}`;
}

function slotsFromRows(
  rows: Awaited<ReturnType<typeof getClassTimetable>>
): RoutinePrintSlot[] {
  return rows.map((row) => ({
    weekday: row.weekday,
    periodId: row.periodId,
    period: row.period.name,
    subject: row.subject?.name || "—",
    teacher: row.teacher?.user.name || "",
    room: row.room?.name || "",
    classLabel: row.class ? classLabel(row.class) : "",
  }));
}

async function schoolHeader() {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" } });
  const school = schoolFromConfig(config);
  return {
    school,
    weekdays: parseWeekdays(config?.weekdays).map((n) => ({ n, label: WEEKDAY_SHORT[n] || String(n) })),
  };
}

async function periodRows() {
  const periods = await prisma.period.findMany({ orderBy: { sortOrder: "asc" } });
  return periods.map((period) => ({
    id: period.id,
    name: period.name,
    start: period.startsAt,
    end: period.endsAt,
    isBreak: period.isBreak,
  }));
}

async function teacherMaySeeClass(user: AccessUser, classId: string) {
  const teacher = await prisma.teacher.findUnique({
    where: { userId: user.id },
    include: { subjects: true, classes: true, skills: true },
  });
  if (!teacher) return false;
  if (teacher.classId === classId) return true;
  if (teacher.subjects.some((row) => row.classId === classId)) return true;
  if (teacher.classes.some((row) => row.classId === classId)) return true;
  if (teacher.skills.some((row) => row.classId === classId)) return true;
  if (can(user, "timetable.view") && scopeFor(user, "timetable.view") === "REPORTS") {
    const team = await teamClassIds(user.id);
    return team.includes(classId);
  }
  return false;
}

async function childClassId(user: AccessUser, requestedId?: string) {
  if (user.portal === "STUDENT") {
    const me = await prisma.student.findUnique({ where: { userId: user.id }, select: { classId: true } });
    return me?.classId || "";
  }
  if (user.portal === "PARENT") {
    const parent = await prisma.parent.findUnique({
      where: { userId: user.id },
      include: { students: { select: { id: true, classId: true } } },
    });
    const children = parent?.students || [];
    const pick = requestedId ? children.find((row) => row.id === requestedId) : children[0];
    return pick?.classId || "";
  }
  return "";
}

export async function routineHtmlForUser(user: AccessUser, input: { classId?: string; studentId?: string }) {
  const { school, weekdays } = await schoolHeader();
  const periods = await periodRows();
  const place = placeLines(school).join(" · ");
  const requestedClassId = String(input.classId || "").trim();

  if (user.portal === "OFFICE") {
    if (!can(user, "timetable.view")) throw new Error("No access.");
    if (!requestedClassId) throw new Error("Pick a class");
    // "all" or a comma list exports several classes, one page each.
    const ids = requestedClassId === "all" ? null : requestedClassId.split(",").map((id) => id.trim()).filter(Boolean);
    const classes = await prisma.class.findMany({
      where: { archivedAt: null, ...(ids ? { id: { in: ids } } : {}) },
    });
    if (!classes.length) throw new Error("Class not found");
    classes.sort((a, b) => classLabel(a).localeCompare(classLabel(b), undefined, { numeric: true }));
    const grids: RoutinePrintGrid[] = [];
    for (const klass of classes) {
      grids.push({
        schoolName: school.name,
        place,
        subtitle: `Class ${classLabel(klass)} · Weekly routine`,
        weekdays,
        periods,
        slots: slotsFromRows(await getClassTimetable(klass.id)),
        showTeacher: true,
      });
    }
    return routinePrintHtmlMany(grids);
  }

  if (user.portal === "TEACHER") {
    if (!can(user, "timetable.teach") && !can(user, "timetable.view")) throw new Error("No access.");
    if (requestedClassId) {
      if (!(await teacherMaySeeClass(user, requestedClassId))) throw new Error("No access.");
      const klass = await prisma.class.findUnique({ where: { id: requestedClassId } });
      if (!klass) throw new Error("Class not found");
      const slots = slotsFromRows(await getClassTimetable(klass.id));
      return routinePrintHtml({
        schoolName: school.name,
        place,
        subtitle: `Class ${classLabel(klass)} · Weekly routine`,
        weekdays,
        periods,
        slots,
        showTeacher: true,
      });
    }
    const teacher = await prisma.teacher.findUnique({ where: { userId: user.id } });
    if (!teacher) throw new Error("No access.");
    const slots = slotsFromRows(await getTeacherTimetable(teacher.id));
    return routinePrintHtml({
      schoolName: school.name,
      place,
      subtitle: `${user.name || "Teacher"} · Weekly routine`,
      weekdays,
      periods,
      slots,
      showClass: true,
    });
  }

  if (user.portal === "PARENT" && !can(user, "children.view")) throw new Error("No access.");
  if (user.portal === "STUDENT" && !can(user, "self.view")) throw new Error("No access.");
  const classId = await childClassId(user, String(input.studentId || ""));
  if (!classId) throw new Error("No access.");
  const klass = await prisma.class.findUnique({ where: { id: classId } });
  if (!klass) throw new Error("Class not found");
  const slots = slotsFromRows(await getClassTimetable(klass.id));
  return routinePrintHtml({
    schoolName: school.name,
    place,
    subtitle: `Class ${classLabel(klass)} · Weekly routine`,
    weekdays,
    periods,
    slots,
    showTeacher: true,
  });
}
