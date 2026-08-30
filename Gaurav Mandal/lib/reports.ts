import { can, type AccessUser } from "./permissions";
import { prisma } from "./prisma";

export async function defaultAdminUserId() {
  const admin = await prisma.user.findFirst({
    where: { role: { slug: "ADMIN" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id || null;
}

export async function defaultManagerIdForRole(slug: string, portal: string) {
  if (slug === "ADMIN" || portal === "PARENT" || portal === "STUDENT") return null;
  return defaultAdminUserId();
}

export async function managerIdForNewUser(
  actor: AccessUser,
  role: { slug: string; portal: string },
  requested?: string | null
) {
  const fallback = await defaultManagerIdForRole(role.slug, role.portal);
  if (role.slug === "ADMIN" || role.portal === "PARENT" || role.portal === "STUDENT") return null;
  const pick = requested === undefined || requested === null || requested === "" ? fallback : requested;
  if (!pick) return fallback;
  const manager = await prisma.user.findUnique({
    where: { id: pick },
    include: { role: { select: { portal: true } } },
  });
  if (!manager || (manager.role.portal !== "OFFICE" && manager.role.portal !== "TEACHER")) {
    throw new Error("Pick an office or teacher login");
  }
  if (!can(actor, "staff.edit") && pick !== actor.id && pick !== fallback) {
    throw new Error("You can only keep them or send them to Admin");
  }
  return pick;
}

export async function ensureManagers() {
  const adminId = await defaultAdminUserId();
  if (!adminId) return;
  await prisma.user.updateMany({
    where: {
      managerId: null,
      id: { not: adminId },
      role: { slug: { not: "ADMIN" }, portal: { in: ["OFFICE", "TEACHER"] } },
    },
    data: { managerId: adminId },
  });
}

export async function reportUserIds(managerId: string) {
  const rows = await prisma.user.findMany({
    where: { managerId },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function teamClassIds(managerId: string) {
  const ids = new Set<string>();
  const reports = await prisma.user.findMany({
    where: { managerId },
    include: {
      teacher: { include: { skills: true, classes: true, subjects: true } },
    },
  });
  for (const row of reports) {
    const t = row.teacher;
    if (!t) continue;
    if (t.classId) ids.add(t.classId);
    for (const s of t.subjects) ids.add(s.classId);
    for (const s of t.skills) ids.add(s.classId);
    for (const c of t.classes) ids.add(c.classId);
  }
  return [...ids];
}

export async function listManagerOptions() {
  const rows = await prisma.user.findMany({
    where: { role: { portal: { in: ["OFFICE", "TEACHER"] } } },
    select: { id: true, name: true, role: { select: { name: true, slug: true, portal: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role.name,
    slug: r.role.slug,
    portal: r.role.portal,
  }));
}

export async function canSetManager(actor: AccessUser, reportUserId: string) {
  if (can(actor, "staff.edit")) return true;
  const row = await prisma.user.findUnique({
    where: { id: reportUserId },
    select: { managerId: true },
  });
  return Boolean(row && row.managerId === actor.id);
}

export async function assertManagerChoice(actor: AccessUser, reportUserId: string, managerId: string | null) {
  if (reportUserId === managerId) throw new Error("Someone cannot report to themselves");
  const report = await prisma.user.findUnique({
    where: { id: reportUserId },
    include: { role: { select: { slug: true, portal: true } } },
  });
  if (!report) throw new Error("That person is missing");
  if (report.role.portal === "PARENT" || report.role.portal === "STUDENT") {
    throw new Error("Parents and students do not have a reporting manager");
  }
  if (report.role.slug === "ADMIN") throw new Error("Admin does not report to anyone");
  if (!(await canSetManager(actor, reportUserId))) throw new Error("No access.");
  if (!managerId) {
    const adminId = await defaultAdminUserId();
    return adminId && adminId !== reportUserId ? adminId : null;
  }
  const manager = await prisma.user.findUnique({
    where: { id: managerId },
    include: { role: { select: { portal: true } } },
  });
  if (!manager || (manager.role.portal !== "OFFICE" && manager.role.portal !== "TEACHER")) {
    throw new Error("Pick an office or teacher login");
  }
  if (!can(actor, "staff.edit") && managerId !== actor.id) {
    const adminId = await defaultAdminUserId();
    if (managerId !== adminId) throw new Error("You can only keep them or send them to Admin");
  }
  let walk: string | null = managerId;
  const seen = new Set([reportUserId]);
  for (let i = 0; i < 24 && walk; i += 1) {
    if (seen.has(walk)) throw new Error("That reporting line would loop");
    seen.add(walk);
    const next: { managerId: string | null } | null = await prisma.user.findUnique({
      where: { id: walk },
      select: { managerId: true },
    });
    walk = next?.managerId || null;
  }
  return managerId;
}
