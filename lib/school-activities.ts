/**
 * Activities: non-exam periods such as Games, Library or Assembly.
 *
 * The school keeps its list in SchoolConfig.activityCatalog; each class says how many periods a week
 * it has of each in Class.activityPlan. A timetable period holds an activity in TimetableSlot.activity.
 * None of this is read by exams, marks or report cards (they only use Subject rows).
 */
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";
import { cleanActivity } from "./timetable-activity";

/** Used until the school saves its own list. */
export const DEFAULT_ACTIVITIES = ["Games", "Library", "Assembly", "Art & craft", "Music"];
const MAX_ACTIVITIES = 50;
const MAX_PER_WEEK = 20;

export type ClassActivity = { name: string; perWeek: number };

function sameName(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function uniqueNames(names: unknown[]) {
  const out: string[] = [];
  for (const raw of names) {
    const name = cleanActivity(raw);
    if (name && !out.some((have) => sameName(have, name))) out.push(name);
  }
  return out.slice(0, MAX_ACTIVITIES);
}

export function parseActivityCatalog(raw: string | null | undefined) {
  if (raw == null || raw === "") return [...DEFAULT_ACTIVITIES];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? uniqueNames(list) : [...DEFAULT_ACTIVITIES];
  } catch {
    return [...DEFAULT_ACTIVITIES];
  }
}

export function parseActivityPlan(raw: string | null | undefined): ClassActivity[] {
  try {
    const list = JSON.parse(raw || "[]");
    if (!Array.isArray(list)) return [];
    const out: ClassActivity[] = [];
    for (const row of list) {
      const name = cleanActivity(row?.name);
      const perWeek = Math.max(0, Math.min(MAX_PER_WEEK, Math.round(Number(row?.perWeek) || 0)));
      if (name && !out.some((have) => sameName(have.name, name))) out.push({ name, perWeek });
    }
    return out;
  } catch {
    return [];
  }
}

export type TeacherActivity = { name: string; classId: string };

/** A teacher's activities per class (JSON [{ name, classId }]), like subject assignments. */
export function parseTeacherActivities(raw: string | null | undefined): TeacherActivity[] {
  try {
    const list = JSON.parse(raw || "[]");
    if (!Array.isArray(list)) return [];
    const out: TeacherActivity[] = [];
    for (const row of list) {
      const name = cleanActivity(row?.name);
      const classId = String(row?.classId || "");
      if (name && classId && !out.some((o) => o.classId === classId && sameName(o.name, name))) out.push({ name, classId });
    }
    return out;
  } catch {
    return [];
  }
}

/** Validate a teacher's activity picks: each must be on that class's activity plan. Null = not sent (leave as is). */
export async function cleanTeacherActivities(rows: unknown) {
  if (!Array.isArray(rows)) return null;
  const picks = parseTeacherActivities(JSON.stringify(rows));
  const classes = await prisma.class.findMany({
    where: { id: { in: [...new Set(picks.map((p) => p.classId))] } },
    select: { id: true, name: true, section: true, activityPlan: true },
  });
  for (const pick of picks) {
    const klass = classes.find((c) => c.id === pick.classId);
    if (!klass) throw new Error("Class not found");
    const planned = planActivity(klass.activityPlan, pick.name);
    if (!planned) throw new Error(`${pick.name} is not set for ${klass.name}-${klass.section}.`);
    pick.name = planned.name;
  }
  return JSON.stringify(picks);
}

export async function loadActivityCatalog() {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { activityCatalog: true } });
  return parseActivityCatalog(config?.activityCatalog);
}

function needSchoolEdit(user: AccessUser) {
  if (!can(user, "school.edit")) throw new Error("No access.");
}

/**
 * Save the school's activity list. `entries` keep their old name in `previousName` so a rename also
 * renames the activity in class plans and in the timetable. An activity still used anywhere cannot be removed.
 */
export async function saveActivityCatalogCore(user: AccessUser, input: { entries?: { name?: string; previousName?: string }[] }) {
  needSchoolEdit(user);
  const rows = (input.entries || []).map((row) => ({ name: cleanActivity(row.name), previousName: cleanActivity(row.previousName) }));
  if (rows.some((row) => !row.name)) throw new Error("An activity needs a name.");
  const names = uniqueNames(rows.map((row) => row.name));
  if (names.length !== rows.length) throw new Error("Two activities have the same name.");
  const before = await loadActivityCatalog();
  const classes = await prisma.class.findMany({ select: { id: true, name: true, section: true, activityPlan: true } });
  const teachers = await prisma.teacher.findMany({ where: { activities: { not: "[]" } }, select: { id: true, activities: true } });
  async function saveTeacherNames(change: (rows: TeacherActivity[]) => TeacherActivity[]) {
    for (const t of teachers) {
      const names = parseTeacherActivities(t.activities);
      const next = change(names);
      if (JSON.stringify(next) === JSON.stringify(names)) continue;
      t.activities = JSON.stringify(next);
      await prisma.teacher.update({ where: { id: t.id }, data: { activities: t.activities } });
    }
  }

  // Renames first, so the "still used" check below sees the new names.
  for (const row of rows) {
    if (!row.previousName || sameName(row.previousName, row.name)) continue;
    await prisma.timetableSlot.updateMany({ where: { activity: row.previousName }, data: { activity: row.name } });
    for (const klass of classes) {
      const plan = parseActivityPlan(klass.activityPlan);
      if (!plan.some((p) => sameName(p.name, row.previousName))) continue;
      const next = plan.map((p) => (sameName(p.name, row.previousName) ? { ...p, name: row.name } : p));
      klass.activityPlan = JSON.stringify(next);
      await prisma.class.update({ where: { id: klass.id }, data: { activityPlan: klass.activityPlan } });
    }
    await saveTeacherNames((list) => list.map((n) => (sameName(n.name, row.previousName) ? { ...n, name: row.name } : n)));
  }

  const renamedFrom = new Set(rows.filter((r) => r.previousName).map((r) => r.previousName.toLowerCase()));
  const removed = before.filter((name) => !names.some((n) => sameName(n, name)) && !renamedFrom.has(name.toLowerCase()));
  for (const name of removed) {
    const inPlan = classes.filter((k) => parseActivityPlan(k.activityPlan).some((p) => sameName(p.name, name))).map((k) => `${k.name}-${k.section}`);
    if (inPlan.length) throw new Error(`${name} is still on ${inPlan.slice(0, 3).join(", ")}${inPlan.length > 3 ? "…" : ""}. Remove it from those classes first.`);
    const slot = await prisma.timetableSlot.findFirst({ where: { activity: name }, include: { class: { select: { name: true, section: true } } } });
    if (slot) throw new Error(`${name} is still in ${slot.class.name}-${slot.class.section}'s timetable. Clear those periods first.`);
  }

  // A removed activity simply drops off teachers (it only ever suggested them).
  if (removed.length) await saveTeacherNames((list) => list.filter((n) => !removed.some((r) => sameName(r, n.name))));

  const activityCatalog = JSON.stringify(names);
  await prisma.schoolConfig.upsert({
    where: { id: "school" },
    update: { activityCatalog },
    create: { id: "school", weekdays: "[1,2,3,4,5,6]", subjectCatalog: "[]", activityCatalog },
  });
  return { ok: true as const, activities: names };
}

/** Set a class's activities and periods a week. Names must be in the school list. */
export async function saveClassActivitiesCore(user: AccessUser, input: { classId?: string; activities?: { name?: string; perWeek?: number }[] }) {
  needSchoolEdit(user);
  const classId = String(input.classId || "");
  const klass = await prisma.class.findUnique({ where: { id: classId }, select: { id: true, name: true, section: true } });
  if (!klass) throw new Error("Class not found");
  const catalog = await loadActivityCatalog();
  const plan = parseActivityPlan(JSON.stringify(input.activities || []));
  for (const row of plan) {
    const known = catalog.find((name) => sameName(name, row.name));
    if (!known) throw new Error(`${row.name} is not in the school's activities. Add it in Manage activities first.`);
    row.name = known;
  }
  const kept = plan.filter((row) => row.perWeek > 0);
  await prisma.class.update({ where: { id: classId }, data: { activityPlan: JSON.stringify(kept) } });
  // Teachers lose this class for activities it no longer has.
  const teachers = await prisma.teacher.findMany({ where: { activities: { contains: classId } }, select: { id: true, activities: true } });
  for (const t of teachers) {
    const rows = parseTeacherActivities(t.activities);
    const next = rows.filter((r) => r.classId !== classId || kept.some((k) => sameName(k.name, r.name)));
    if (next.length !== rows.length) await prisma.teacher.update({ where: { id: t.id }, data: { activities: JSON.stringify(next) } });
  }
  return { ok: true as const };
}

/** The class's planned activity for a timetable period (case-insensitive), or null. */
export function planActivity(rawPlan: string | null | undefined, activity: string) {
  return parseActivityPlan(rawPlan).find((row) => sameName(row.name, activity)) || null;
}
