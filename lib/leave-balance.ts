import { prisma } from "./prisma";
import { addDays, ymd } from "./exams";
import { loadSchoolCalendar, schoolDaysInRange } from "./leave";
import type { SchoolCalendar } from "./calendar";
import { runWithoutTenant, setTenantOrg } from "./tenant-context";

/**
 * Leave balances for teachers and staff, kept as a ledger.
 *
 * - Credits are written once per period (month / quarter / half-year / year) and never rewritten,
 *   so changing a rule only affects future credits.
 * - `ensureLeaveCredits` adds whatever is due but missing. The daily cron calls it for everyone,
 *   and screens call it for one person, so a missed cron run fixes itself.
 * - Students have no balance; their leave works as before.
 */

export type CreditMode = "YEARLY" | "MONTHLY" | "QUARTERLY" | "HALF_YEARLY";
export const CREDIT_MODES: CreditMode[] = ["YEARLY", "MONTHLY", "QUARTERLY", "HALF_YEARLY"];
const PERIOD_MONTHS: Record<CreditMode, number> = { YEARLY: 12, MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6 };
const PERIOD_LETTER: Record<CreditMode, string> = { YEARLY: "Y", MONTHLY: "M", QUARTERLY: "Q", HALF_YEARLY: "H" };

type TypeRule = {
  id: string;
  name: string;
  forTeacher: boolean;
  forStaff: boolean;
  yearlyCap: number;
  creditMode: string;
  creditAmount: number;
  carryForward: string;
  carryForwardCap: number;
  prorateJoiners: boolean;
  advanceDays: number;
  creditRuleSince: Date | null;
};

export type LeavePerson = { teacherId?: string | null; staffId?: string | null; joinedOn?: string | null };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function monthStart(year: number, month1: number) {
  // month1 may run past 12: normalise.
  const y = year + Math.floor((month1 - 1) / 12);
  const m = ((month1 - 1) % 12) + 1;
  return `${y}-${pad(m)}-01`;
}

export function personKey(p: LeavePerson) {
  return p.teacherId ? `t:${p.teacherId}` : `s:${p.staffId}`;
}

/** The leave year containing `date`, given the school's start month (1-12). */
export function leaveYearFor(date: string, startMonth: number) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const sy = m >= startMonth ? y : y - 1;
  const from = monthStart(sy, startMonth);
  const to = addDays(monthStart(sy + 1, startMonth), -1);
  return {
    startYear: sy,
    key: `LY${sy}`,
    from,
    to,
    label: startMonth === 1 ? String(sy) : `${sy}-${String(sy + 1).slice(2)}`,
  };
}

export function modeOf(type: Pick<TypeRule, "creditMode">): CreditMode {
  return (CREDIT_MODES.includes(type.creditMode as CreditMode) ? type.creditMode : "YEARLY") as CreditMode;
}

/** A type without a positive yearly cap / credit amount has no limit, and so no ledger. */
export function isLimited(type: Pick<TypeRule, "creditMode" | "yearlyCap" | "creditAmount">) {
  return modeOf(type) === "YEARLY" ? type.yearlyCap > 0 : type.creditAmount > 0;
}

export function periodsOf(type: Pick<TypeRule, "creditMode">, year: { startYear: number; key: string }, startMonth: number) {
  const mode = modeOf(type);
  const len = PERIOD_MONTHS[mode];
  return Array.from({ length: 12 / len }, (_, i) => {
    const start = monthStart(year.startYear, startMonth + i * len);
    const end = addDays(monthStart(year.startYear, startMonth + (i + 1) * len), -1);
    return { key: `${year.key}-${PERIOD_LETTER[mode]}${i}`, start, end, months: len };
  });
}

function round(n: number) {
  return Math.round(n * 2) / 2;
}

/** How much a period credits this person, or 0 if they had not joined in time. */
export function creditFor(
  type: Pick<TypeRule, "creditMode" | "yearlyCap" | "creditAmount" | "prorateJoiners">,
  period: { start: string; end: string; months: number },
  joinedOn: string
) {
  const joined = /^\d{4}-\d{2}-\d{2}$/.test(joinedOn) ? joinedOn : "1970-01-01";
  if (joined > period.end) return 0;
  const mode = modeOf(type);
  if (mode === "YEARLY") {
    if (joined <= period.start || !type.prorateJoiners) return type.yearlyCap;
    // Months left in the leave year, counting the joining month if they joined by the 15th.
    const jy = Number(joined.slice(0, 4));
    const jm = Number(joined.slice(5, 7));
    const jd = Number(joined.slice(8, 10));
    const py = Number(period.start.slice(0, 4));
    const pm = Number(period.start.slice(5, 7));
    const monthsIn = (jy - py) * 12 + (jm - pm) + (jd > 15 ? 1 : 0);
    return round((type.yearlyCap * Math.max(0, 12 - monthsIn)) / 12);
  }
  // Monthly / quarterly / half-yearly: credited if they joined by the middle of the period.
  const mid = addDays(period.start, Math.floor((period.months * 30) / 2) - 1);
  return joined <= mid ? type.creditAmount : 0;
}

async function leaveYearStartMonth() {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { leaveYearStartMonth: true } }).catch(() => null);
  const m = Number(config?.leaveYearStartMonth || 4);
  return m >= 1 && m <= 12 ? m : 4;
}

async function usedIn(type: { id: string }, p: LeavePerson, from: string, to: string, cal: SchoolCalendar) {
  const rows = await prisma.leaveRequest.findMany({
    where: {
      typeId: type.id,
      status: { in: ["ACTIVE", "WAITING"] },
      from: { lte: to },
      to: { gte: from },
      ...(p.teacherId ? { teacherId: p.teacherId } : { staffId: p.staffId }),
    },
    select: { from: true, to: true, halfDay: true, status: true },
  });
  let used = 0;
  let pending = 0;
  for (const r of rows) {
    const days = r.halfDay ? 0.5 : schoolDaysInRange(r.from < from ? from : r.from, r.to > to ? to : r.to, cal).length;
    if (r.status === "ACTIVE") used += days;
    else pending += days;
  }
  return { used, pending };
}

async function insertOnce(row: {
  typeId: string;
  personKey: string;
  teacherId: string | null;
  staffId: string | null;
  kind: string;
  days: number;
  leaveYear: string;
  period: string;
  note: string;
}) {
  const existing = await prisma.leaveLedger.findFirst({
    where: { typeId: row.typeId, personKey: row.personKey, kind: row.kind, period: row.period },
    select: { id: true },
  });
  if (existing) return false;
  try {
    await prisma.leaveLedger.create({ data: row });
    return true;
  } catch {
    return false; // a parallel run wrote it first
  }
}

/** Writes every credit / carry-forward / lapse that is due for this person but missing. */
export async function ensureLeaveCredits(
  type: TypeRule,
  p: LeavePerson,
  ctx: { today: string; startMonth: number; cal: SchoolCalendar }
) {
  if (!isLimited(type)) return 0;
  const key = personKey(p);
  const joined = p.joinedOn || "1970-01-01";
  const year = leaveYearFor(ctx.today, ctx.startMonth);
  let added = 0;
  const base = { typeId: type.id, personKey: key, teacherId: p.teacherId || null, staffId: p.staffId || null };

  // Year end: carry forward from last year (only if last year had a ledger, i.e. Anekio was in use).
  const prev = leaveYearFor(addDays(year.from, -1), ctx.startMonth);
  const prevRows = await prisma.leaveLedger.findMany({ where: { typeId: type.id, personKey: key, leaveYear: prev.key }, select: { days: true, kind: true } });
  if (prevRows.length && !prevRows.some((r) => r.kind === "LAPSE")) {
    const earned = prevRows.reduce((n, r) => n + r.days, 0);
    const { used, pending } = await usedIn(type, p, prev.from, prev.to, ctx.cal);
    const left = Math.max(0, round(earned - used - pending));
    const carry = type.carryForward === "ALL" ? left : type.carryForward === "CAPPED" ? Math.min(left, Math.max(0, type.carryForwardCap)) : 0;
    if (carry > 0 && (await insertOnce({ ...base, kind: "CARRY_FORWARD", days: carry, leaveYear: year.key, period: `${year.key}-CF`, note: `Carried from ${prev.label}` }))) added += 1;
    if (left - carry > 0 && (await insertOnce({ ...base, kind: "LAPSE", days: -(left - carry), leaveYear: prev.key, period: `${prev.key}-LAPSE`, note: `Lapsed at end of ${prev.label}` }))) added += 1;
  }

  // This year's credits up to today.
  const since = type.creditRuleSince ? ymd(type.creditRuleSince) : "";
  for (const period of periodsOf(type, year, ctx.startMonth)) {
    if (period.start > ctx.today) break;
    if (since && period.start < since) continue; // rule changed after this period began: it stays as it was
    const days = creditFor(type, period, joined);
    if (days <= 0) continue;
    const mode = modeOf(type);
    const note =
      mode === "YEARLY"
        ? `Yearly credit ${year.label}`
        : `${mode === "MONTHLY" ? "Monthly" : mode === "QUARTERLY" ? "Quarterly" : "Half-yearly"} credit · ${new Date(`${period.start}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`;
    if (await insertOnce({ ...base, kind: "CREDIT", days, leaveYear: year.key, period: period.key, note })) added += 1;
  }
  return added;
}

export type LeaveBalance = {
  typeId: string;
  typeName: string;
  limited: boolean;
  mode: CreditMode;
  leaveYear: string;
  earned: number;
  used: number;
  pending: number;
  available: number;
  advanceDays: number;
  nextCreditOn: string;
  nextCreditDays: number;
};

export async function balanceFor(type: TypeRule, p: LeavePerson, ctx: { today: string; startMonth: number; cal: SchoolCalendar }): Promise<LeaveBalance> {
  const year = leaveYearFor(ctx.today, ctx.startMonth);
  const mode = modeOf(type);
  const limited = isLimited(type);
  const { used, pending } = await usedIn(type, p, year.from, year.to, ctx.cal);
  let earned = 0;
  if (limited) {
    const rows = await prisma.leaveLedger.findMany({ where: { typeId: type.id, personKey: personKey(p), leaveYear: year.key }, select: { days: true } });
    earned = round(rows.reduce((n, r) => n + r.days, 0));
  }
  const next = periodsOf(type, year, ctx.startMonth).find((x) => x.start > ctx.today);
  const nextStart = next?.start || leaveYearFor(addDays(year.to, 1), ctx.startMonth).from;
  return {
    typeId: type.id,
    typeName: type.name,
    limited,
    mode,
    leaveYear: year.label,
    earned,
    used,
    pending,
    available: limited ? round(earned - used - pending) : 0,
    advanceDays: type.advanceDays,
    nextCreditOn: limited ? nextStart : "",
    nextCreditDays: limited ? (mode === "YEARLY" ? type.yearlyCap : type.creditAmount) : 0,
  };
}

async function typesFor(p: LeavePerson) {
  const types = await prisma.leaveType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return types.filter((t) => (p.teacherId ? t.forTeacher : t.forStaff));
}

async function joinedOnFor(p: LeavePerson) {
  if (p.joinedOn) return p.joinedOn;
  if (p.teacherId) return (await prisma.teacher.findUnique({ where: { id: p.teacherId }, select: { joinedOn: true } }))?.joinedOn || "";
  if (p.staffId) return (await prisma.staffMember.findUnique({ where: { id: p.staffId }, select: { joinedOn: true } }))?.joinedOn || "";
  return "";
}

/** One person's balances, topping up any missing credits first. */
export async function leaveBalancesFor(p: LeavePerson) {
  if (!p.teacherId && !p.staffId) return [];
  const person = { ...p, joinedOn: await joinedOnFor(p) };
  const ctx = { today: ymd(new Date()), startMonth: await leaveYearStartMonth(), cal: await loadSchoolCalendar() };
  const out: LeaveBalance[] = [];
  for (const type of await typesFor(person)) {
    await ensureLeaveCredits(type, person, ctx);
    out.push(await balanceFor(type, person, ctx));
  }
  return out;
}

/** Throws when a teacher/staff request needs more days than they have (plus allowed advance). */
export async function assertLeaveBalance(typeId: string, p: LeavePerson, from: string, to: string, halfDay: string) {
  const type = await prisma.leaveType.findUnique({ where: { id: typeId } });
  if (!type || !isLimited(type)) return;
  const person = { ...p, joinedOn: await joinedOnFor(p) };
  const ctx = { today: ymd(new Date()), startMonth: await leaveYearStartMonth(), cal: await loadSchoolCalendar() };
  await ensureLeaveCredits(type, person, ctx);
  const bal = await balanceFor(type, person, ctx);
  const need = halfDay ? 0.5 : schoolDaysInRange(from, to, ctx.cal).length;
  if (need > bal.available + Math.max(0, type.advanceDays)) {
    const left = Math.max(0, bal.available);
    throw new Error(
      `You have ${left % 1 ? left.toFixed(1) : left} ${type.name.toLowerCase()} leave${left === 1 ? "" : "s"} available. This request needs ${need}.` +
        (bal.nextCreditOn && modeOf(type) !== "YEARLY" ? ` Next credit on ${new Date(`${bal.nextCreditOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}.` : "")
    );
  }
}

/** Office: manual +/- with a reason (opening balance, correction, extra days). */
export async function adjustLeaveBalance(input: {
  typeId: string;
  teacherId?: string | null;
  staffId?: string | null;
  days: number;
  note: string;
  opening?: boolean;
  byUserId: string;
}) {
  const days = round(Number(input.days) || 0);
  if (!days) throw new Error("Enter the number of days to add or remove.");
  const note = String(input.note || "").trim().slice(0, 200);
  if (!note) throw new Error("Add a reason.");
  const type = await prisma.leaveType.findUnique({ where: { id: input.typeId } });
  if (!type) throw new Error("Leave type not found.");
  if (!isLimited(type)) throw new Error(`${type.name} has no limit, so there is no balance to adjust.`);
  const p = { teacherId: input.teacherId || null, staffId: input.teacherId ? null : input.staffId || null };
  if (!p.teacherId && !p.staffId) throw new Error("Pick an employee.");
  const year = leaveYearFor(ymd(new Date()), await leaveYearStartMonth());
  await prisma.leaveLedger.create({
    data: {
      typeId: type.id,
      personKey: personKey(p),
      teacherId: p.teacherId,
      staffId: p.staffId,
      kind: input.opening ? "OPENING" : "ADJUST",
      days,
      leaveYear: year.key,
      period: `${input.opening ? "OPEN" : "ADJ"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      note,
      createdById: input.byUserId,
    },
  });
}

/** Ledger history for one person, newest first (for the employee profile). */
export async function leaveLedgerFor(p: LeavePerson) {
  const rows = await prisma.leaveLedger.findMany({
    where: { personKey: personKey(p) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const types = new Map((await prisma.leaveType.findMany({ select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  return rows.map((r) => ({
    id: r.id,
    typeId: r.typeId,
    typeName: types.get(r.typeId) || "Leave",
    kind: r.kind,
    days: r.days,
    note: r.note,
    at: r.createdAt.toISOString(),
  }));
}

/** Daily cron: top up every teacher and staff member in every school. */
export async function runLeaveCredits(now = new Date()) {
  const orgs = await runWithoutTenant(() => prisma.leaveType.findMany({ select: { orgId: true }, distinct: ["orgId"] }));
  let added = 0;
  let people = 0;
  for (const { orgId } of orgs) {
    await runWithoutTenant(async () => {
      if (orgId) setTenantOrg(orgId);
      const ctx = { today: ymd(now), startMonth: await leaveYearStartMonth(), cal: await loadSchoolCalendar() };
      const types = (await prisma.leaveType.findMany()).filter((t) => isLimited(t));
      if (!types.length) return;
      const [teachers, staff] = await Promise.all([
        types.some((t) => t.forTeacher) ? prisma.teacher.findMany({ select: { id: true, joinedOn: true } }) : [],
        types.some((t) => t.forStaff) ? prisma.staffMember.findMany({ select: { id: true, joinedOn: true } }) : [],
      ]);
      for (const t of teachers) {
        people += 1;
        for (const type of types.filter((x) => x.forTeacher)) added += await ensureLeaveCredits(type, { teacherId: t.id, joinedOn: t.joinedOn }, ctx);
      }
      for (const s of staff) {
        people += 1;
        for (const type of types.filter((x) => x.forStaff)) added += await ensureLeaveCredits(type, { staffId: s.id, joinedOn: s.joinedOn }, ctx);
      }
    });
  }
  return { schools: orgs.length, people, added };
}

/** Office: everyone's balances for the bulk "current balances" screen. */
export async function allLeaveBalances() {
  const [teachers, staff] = await Promise.all([
    prisma.teacher.findMany({ select: { id: true, joinedOn: true, employeeId: true, user: { select: { name: true } } } }),
    prisma.staffMember.findMany({ select: { id: true, joinedOn: true, employeeId: true, name: true } }),
  ]);
  const types = (await prisma.leaveType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })).filter((t) => isLimited(t) && (t.forTeacher || t.forStaff));
  const people = [
    ...teachers.map((t) => ({ kind: "teacher" as const, id: t.id, name: t.user?.name || "Teacher", employeeId: t.employeeId || "", joinedOn: t.joinedOn })),
    ...staff.map((s) => ({ kind: "staff" as const, id: s.id, name: s.name || "Staff", employeeId: s.employeeId || "", joinedOn: s.joinedOn })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const rows = [];
  for (const p of people) {
    const balances = await leaveBalancesFor(p.kind === "teacher" ? { teacherId: p.id, joinedOn: p.joinedOn } : { staffId: p.id, joinedOn: p.joinedOn });
    rows.push({ ...p, balances: balances.filter((b) => b.limited) });
  }
  return {
    types: types.map((t) => ({ id: t.id, name: t.name, forTeacher: t.forTeacher, forStaff: t.forStaff })),
    people: rows,
  };
}

/**
 * One-time import / correction: set each person's *available* balance to a number.
 * Writes the difference as an OPENING row, so the history shows exactly what was imported.
 */
export async function setLeaveBalances(input: {
  rows: { teacherId?: string | null; staffId?: string | null; typeId: string; available: number }[];
  note?: string;
  byUserId: string;
}) {
  let changed = 0;
  const startMonth = await leaveYearStartMonth();
  const year = leaveYearFor(ymd(new Date()), startMonth);
  const note = String(input.note || "").trim().slice(0, 200) || "Opening balance (imported)";
  for (const row of (input.rows || []).slice(0, 2000)) {
    const target = round(Number(row.available));
    if (!Number.isFinite(target) || target < 0) continue;
    const p = row.teacherId ? { teacherId: row.teacherId } : row.staffId ? { staffId: row.staffId } : null;
    if (!p) continue;
    const current = (await leaveBalancesFor(p)).find((b) => b.typeId === row.typeId);
    if (!current?.limited) continue;
    const delta = round(target - current.available);
    if (!delta) continue;
    await prisma.leaveLedger.create({
      data: {
        typeId: row.typeId,
        personKey: personKey(p),
        teacherId: p.teacherId || null,
        staffId: p.staffId || null,
        kind: "OPENING",
        days: delta,
        leaveYear: year.key,
        period: `OPEN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        note: `${note} · set to ${target}`,
        createdById: input.byUserId,
      },
    });
    changed += 1;
  }
  return { changed };
}
