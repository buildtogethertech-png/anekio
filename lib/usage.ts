import { prisma } from "./prisma";
import { runWithoutTenant } from "./tenant-context";
import { errorFields, logger } from "./logger";
import { isCustomerOrg } from "./saas-crm";

/**
 * Who uses Anekio: one UsageDaily row per user, IST day and platform. Requests are counted in memory
 * and written at most every few minutes, so tracking adds no database work to a request.
 * Support logins (Anekio staff acting as a user) are not counted.
 */
const IST_OFFSET_MS = 330 * 60_000;
const MAX_OPS_PER_ROW = 150;
const FLUSH_EVERY_MS = 5 * 60_000;

type Pending = {
  day: string;
  orgId: string | null;
  userId: string;
  role: string;
  platform: string;
  requests: number;
  ops: Record<string, number>;
  first: Date;
  last: Date;
};

const pending = new Map<string, Pending>();

export function istDay(at = new Date()) {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function mergeOps(base: Record<string, number>, extra: Record<string, number>, limit = MAX_OPS_PER_ROW) {
  const out: Record<string, number> = { ...base };
  for (const [op, count] of Object.entries(extra)) {
    if (!(op in out) && Object.keys(out).length >= limit) continue;
    out[op] = (out[op] || 0) + count;
  }
  return out;
}

export function parseOps(json: string | null | undefined): Record<string, number> {
  try {
    const value = JSON.parse(json || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, n]) => typeof n === "number")) as Record<string, number>;
  } catch {
    return {};
  }
}

export function recordUsage(input: {
  user: { id: string; orgId?: string | null; role?: string | null; support?: unknown };
  platform: string;
  op?: string;
  at?: Date;
}) {
  if (input.user.support) return;
  const at = input.at || new Date();
  const day = istDay(at);
  const key = `${day}|${input.user.id}|${input.platform}`;
  const row =
    pending.get(key) ||
    ({ day, orgId: input.user.orgId || null, userId: input.user.id, role: input.user.role || "", platform: input.platform, requests: 0, ops: {}, first: at, last: at } as Pending);
  row.requests += 1;
  row.last = at;
  if (input.op) row.ops = mergeOps(row.ops, { [input.op]: 1 });
  pending.set(key, row);
}

export function pendingUsage() {
  return [...pending.values()];
}

async function saveRow(row: Pending) {
  const where = { day_userId_platform: { day: row.day, userId: row.userId, platform: row.platform } };
  const existing = await prisma.usageDaily.findUnique({ where, select: { opsJson: true, firstSeenAt: true } });
  if (!existing) {
    await prisma.usageDaily.create({
      data: { day: row.day, orgId: row.orgId, userId: row.userId, role: row.role, platform: row.platform, requests: row.requests, opsJson: JSON.stringify(row.ops), firstSeenAt: row.first, lastSeenAt: row.last },
    });
    return;
  }
  await prisma.usageDaily.update({
    where,
    data: {
      orgId: row.orgId,
      role: row.role,
      requests: { increment: row.requests },
      opsJson: JSON.stringify(mergeOps(parseOps(existing.opsJson), row.ops)),
      lastSeenAt: row.last,
    },
  });
}

export async function flushUsage() {
  if (!pending.size) return 0;
  const rows = [...pending.values()];
  pending.clear();
  let saved = 0;
  await runWithoutTenant(async () => {
    for (const row of rows) {
      try {
        await saveRow(row);
        saved += 1;
      } catch (error) {
        logger.error("usage_flush_failed", { user: row.userId, day: row.day, ...errorFields(error) });
      }
    }
  });
  return saved;
}

let flusher: NodeJS.Timeout | null = null;

/** Called once by the long-running server (not on serverless). Flushes on PM2 stop/reload too. */
export function startUsageFlusher() {
  if (flusher) return;
  flusher = setInterval(() => void flushUsage(), FLUSH_EVERY_MS);
  flusher.unref();
  const stop = (signal: string) => {
    const timeout = new Promise((resolve) => setTimeout(resolve, 1200));
    void Promise.race([flushUsage(), timeout]).finally(() => {
      logger.info("server_stop", { signal });
      process.exit(0);
    });
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
}

/* ---------- Admin "Usage" page ---------- */

export type UsageRow = { day: string; orgId: string | null; userId: string; role: string; platform: string; requests: number; opsJson: string; lastSeenAt: Date };
export type SchoolUsage = {
  orgId: string;
  name: string;
  today: number;
  week: number;
  month: number;
  requestsWeek: number;
  lastSeenAt: Date | null;
  roles: Record<string, number>;
  platforms: Record<string, number>;
};
export type UsageSummary = {
  activeSchoolsToday: number;
  activeSchoolsWeek: number;
  usersToday: number;
  usersWeek: number;
  usersMonth: number;
  requestsToday: number;
  daily: { day: string; users: number; schools: number }[];
  topOps: { op: string; count: number }[];
  schools: SchoolUsage[];
};

function daysAgo(today: string, n: number) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Pure: rows from the last 30 days + the school list → numbers for the admin page. */
export function summarizeUsage(rows: UsageRow[], orgs: { id: string; schoolName: string }[], now = new Date()): UsageSummary {
  const today = istDay(now);
  const weekStart = daysAgo(today, 6);
  const monthStart = daysAgo(today, 29);
  const distinct = (list: UsageRow[], key: (r: UsageRow) => string | null) => new Set(list.map(key).filter(Boolean)).size;
  const inRange = (from: string) => rows.filter((r) => r.day >= from && r.day <= today);
  const todayRows = inRange(today);
  const weekRows = inRange(weekStart);
  const monthRows = inRange(monthStart);

  const daily = Array.from({ length: 14 }, (_, i) => daysAgo(today, 13 - i)).map((day) => {
    const list = rows.filter((r) => r.day === day);
    return { day, users: distinct(list, (r) => r.userId), schools: distinct(list, (r) => r.orgId) };
  });

  const opCounts: Record<string, number> = {};
  for (const row of weekRows) for (const [op, n] of Object.entries(parseOps(row.opsJson))) opCounts[op] = (opCounts[op] || 0) + n;
  const topOps = Object.entries(opCounts)
    .map(([op, count]) => ({ op, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const schools = orgs.map((org) => {
    const mine = monthRows.filter((r) => r.orgId === org.id);
    const week = mine.filter((r) => r.day >= weekStart);
    const roleUsers: Record<string, Set<string>> = {};
    const platformUsers: Record<string, Set<string>> = {};
    for (const r of week) {
      (roleUsers[r.role || "unknown"] ||= new Set()).add(r.userId);
      (platformUsers[r.platform] ||= new Set()).add(r.userId);
    }
    const last = rows.filter((r) => r.orgId === org.id).reduce<Date | null>((max, r) => (!max || r.lastSeenAt > max ? r.lastSeenAt : max), null);
    return {
      orgId: org.id,
      name: org.schoolName,
      today: distinct(mine.filter((r) => r.day === today), (r) => r.userId),
      week: distinct(week, (r) => r.userId),
      month: distinct(mine, (r) => r.userId),
      requestsWeek: week.reduce((sum, r) => sum + r.requests, 0),
      lastSeenAt: last,
      roles: Object.fromEntries(Object.entries(roleUsers).map(([k, v]) => [k, v.size])),
      platforms: Object.fromEntries(Object.entries(platformUsers).map(([k, v]) => [k, v.size])),
    };
  });
  schools.sort((a, b) => b.week - a.week || (b.lastSeenAt?.getTime() || 0) - (a.lastSeenAt?.getTime() || 0));

  return {
    activeSchoolsToday: distinct(todayRows, (r) => r.orgId),
    activeSchoolsWeek: distinct(weekRows, (r) => r.orgId),
    usersToday: distinct(todayRows, (r) => r.userId),
    usersWeek: distinct(weekRows, (r) => r.userId),
    usersMonth: distinct(monthRows, (r) => r.userId),
    requestsToday: todayRows.reduce((sum, r) => sum + r.requests, 0),
    daily,
    topOps,
    schools,
  };
}

export async function usageSummary(now = new Date()) {
  const since = daysAgo(istDay(now), 29);
  const [rows, orgs] = await runWithoutTenant(() =>
    Promise.all([
      prisma.usageDaily.findMany({
        where: { day: { gte: since } },
        select: { day: true, orgId: true, userId: true, role: true, platform: true, requests: true, opsJson: true, lastSeenAt: true },
      }),
      prisma.saasOrg.findMany({ select: { id: true, schoolName: true, lifecycle: true, pipelineStage: true, subscriptionStatus: true } }),
    ])
  );
  // Customers (even with zero use, so silent schools stand out) plus any org that had activity.
  const usedOrgIds = new Set(rows.map((r) => r.orgId).filter(Boolean));
  const relevant = orgs.filter((o) => usedOrgIds.has(o.id) || isCustomerOrg(o));
  return summarizeUsage(rows, relevant, now);
}
