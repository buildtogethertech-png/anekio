import { prisma } from "./prisma";
import { runWithoutTenant } from "./tenant-context";
import { errorFields, logger } from "./logger";

/**
 * School names for log lines, held in memory. One small query when the server starts and then at most
 * every 10 minutes; a request never waits for the database (an unknown org just logs without a name).
 */
const REFRESH_MS = 10 * 60_000;
let names = new Map<string, string>();
let loadedAt = 0;
let loading: Promise<void> | null = null;

export async function refreshOrgNames() {
  if (loading) return loading;
  loading = runWithoutTenant(async () => {
    try {
      const orgs = await prisma.saasOrg.findMany({ select: { id: true, schoolName: true } });
      names = new Map(orgs.map((o) => [o.id, o.schoolName]));
      loadedAt = Date.now();
    } catch (error) {
      logger.warn("org_names_refresh_failed", errorFields(error));
      loadedAt = Date.now(); // try again after the normal interval, not on every request
    } finally {
      loading = null;
    }
  });
  return loading;
}

export function orgName(orgId?: string | null) {
  if (Date.now() - loadedAt > REFRESH_MS) void refreshOrgNames();
  return orgId ? names.get(orgId) : undefined;
}

/** Tests only. */
export function setOrgNamesForTest(entries: [string, string][]) {
  names = new Map(entries);
  loadedAt = Date.now();
}
