/**
 * Teachers' phones during the school day (Settings → HR & Payroll → Teacher phones).
 *
 * When on, a teacher's Anekio app keeps other apps paused from their check-in until the day ends.
 * `breakDuringClass` decides whether a break can be taken while one of their classes is on.
 */
import { prisma } from "./prisma";
import { can, type AccessUser } from "./permissions";
import { staffDayYmd } from "./staff-day";

export type SchoolDaySettings = {
  enabled: boolean;
  /** "never": no break while a class is on. "with_reason": a break is allowed, with a reason. */
  breakDuringClass: "never" | "with_reason";
  /** "last_period" or a fixed "HH:MM" when the day ends by itself. */
  endsAt: string;
  breakReasons: string[];
};

export const DEFAULT_BREAK_REASONS = ["Free period", "Lunch", "Personal call", "Office work"];

export const SCHOOL_DAY_DEFAULTS: SchoolDaySettings = {
  enabled: false,
  breakDuringClass: "never",
  endsAt: "last_period",
  breakReasons: DEFAULT_BREAK_REASONS,
};

function cleanReasons(list: unknown) {
  if (!Array.isArray(list)) return DEFAULT_BREAK_REASONS;
  const out: string[] = [];
  for (const raw of list) {
    const r = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (r && !out.some((o) => o.toLowerCase() === r.toLowerCase())) out.push(r);
  }
  return out.slice(0, 12);
}

export function parseSchoolDay(raw: string | null | undefined): SchoolDaySettings {
  if (!raw) return { ...SCHOOL_DAY_DEFAULTS };
  try {
    const o = JSON.parse(raw) as Partial<SchoolDaySettings>;
    const endsAt = typeof o.endsAt === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.endsAt) ? o.endsAt : "last_period";
    return {
      enabled: o.enabled === true,
      breakDuringClass: o.breakDuringClass === "with_reason" ? "with_reason" : "never",
      endsAt,
      breakReasons: cleanReasons(o.breakReasons),
    };
  } catch {
    return { ...SCHOOL_DAY_DEFAULTS };
  }
}

export async function loadSchoolDay() {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { schoolDayJson: true } });
  return parseSchoolDay(config?.schoolDayJson);
}

export async function saveSchoolDayCore(user: AccessUser, input: Partial<SchoolDaySettings>) {
  if (!can(user, "school.edit")) throw new Error("No access.");
  if (input.endsAt && input.endsAt !== "last_period" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endsAt)) {
    throw new Error("Pick when the day ends.");
  }
  const reasons = cleanReasons(input.breakReasons);
  if (!reasons.length) throw new Error("Add at least one break reason.");
  const next = parseSchoolDay(JSON.stringify({ ...input, breakReasons: reasons }));
  const schoolDayJson = JSON.stringify(next);
  await prisma.schoolConfig.upsert({
    where: { id: "school" },
    update: { schoolDayJson },
    create: { id: "school", weekdays: "[1,2,3,4,5,6]", subjectCatalog: "[]", schoolDayJson },
  });
  return { ok: true as const, schoolDay: next };
}

const EVENT_TYPES = new Set(["start", "break", "resume", "class_started", "guard_off", "outside", "end", "auto_end"]);

/** Teacher app → server: the school-day log. Safe to resend (the phone's event id is kept once). */
export async function logSchoolDayCore(
  user: AccessUser,
  input: { events?: { id?: string; type?: string; at?: number; reason?: string; date?: string }[] }
) {
  if (user.portal !== "TEACHER") throw new Error("No access.");
  const events = (input.events || []).slice(0, 300);
  let saved = 0;
  for (const e of events) {
    const clientId = String(e.id || "").slice(0, 64);
    const type = String(e.type || "");
    const at = Number(e.at);
    const date = String(e.date || "");
    if (!clientId || !EVENT_TYPES.has(type) || !Number.isFinite(at) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    await prisma.staffPhoneEvent.upsert({
      where: { userId_clientId: { userId: user.id, clientId } },
      update: {},
      create: { userId: user.id, clientId, type, at: new Date(at), date, reason: String(e.reason || "").slice(0, 80) },
    });
    saved += 1;
  }
  return { ok: true as const, saved };
}

export type PhoneBreak = { from: string; to: string | null; reason: string; minutes: number; endedBy: string };

/** Admin report: each teacher's school day on a date — start, breaks with reasons, end, guard off. */
export async function schoolDayReportCore(user: AccessUser, input: { date?: string }) {
  if (!can(user, "staff.view") && !can(user, "staff.attendance") && !can(user, "staff.edit")) throw new Error("No access.");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || "")) ? String(input.date) : staffDayYmd(new Date());
  const [teachers, events] = await Promise.all([
    prisma.teacher.findMany({ where: { teachingOnly: false }, select: { id: true, userId: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
    prisma.staffPhoneEvent.findMany({ where: { date }, orderBy: { at: "asc" } }),
  ]);
  const byUser = new Map<string, typeof events>();
  for (const e of events) byUser.set(e.userId, [...(byUser.get(e.userId) || []), e]);
  const now = Date.now();
  const rows = teachers.map((t) => {
    const list = byUser.get(t.userId) || [];
    const start = list.find((e) => e.type === "start");
    const end = [...list].reverse().find((e) => e.type === "end" || e.type === "auto_end");
    const breaks: PhoneBreak[] = [];
    let open: (typeof list)[number] | null = null;
    for (const e of list) {
      if (e.type === "break") open = e;
      else if (open && (e.type === "resume" || e.type === "class_started" || e.type === "end" || e.type === "auto_end")) {
        breaks.push({ from: open.at.toISOString(), to: e.at.toISOString(), reason: open.reason, minutes: Math.round((+e.at - +open.at) / 60_000), endedBy: e.type });
        open = null;
      }
    }
    if (open) breaks.push({ from: open.at.toISOString(), to: null, reason: open.reason, minutes: Math.round((now - +open.at) / 60_000), endedBy: "" });
    return {
      teacherId: t.id,
      name: t.user.name,
      started: start ? start.at.toISOString() : null,
      ended: end ? end.at.toISOString() : null,
      endedBy: end?.type || "",
      breaks,
      breakMinutes: breaks.reduce((n, b) => n + b.minutes, 0),
      guardOff: list.filter((e) => e.type === "guard_off").length,
      /** Times Anekio opened another app (WhatsApp, call, camera…) — allowed, shown separately from breaks. */
      outside: list.filter((e) => e.type === "outside").length,
      timeline: list.map((e) => ({ type: e.type, at: e.at.toISOString(), reason: e.reason })),
    };
  });
  return { ok: true as const, date, rows };
}
