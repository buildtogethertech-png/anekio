import { prisma } from "./prisma";
import {
  defaultGrants,
  PERMISSION_KEYS,
  scopePolicyFor,
  SYSTEM_ROLES,
  validScopeFor,
  type AccessScope,
  type AccessUser,
} from "./permissions";
import { ensureManagers } from "./reports";

let accessReadyPromise: Promise<void> | null = null;

export async function ensureAccessRoles() {
  if (accessReadyPromise) return accessReadyPromise;
  accessReadyPromise = prepareAccessRoles().catch((error) => {
    accessReadyPromise = null;
    throw error;
  });
  return accessReadyPromise;
}

async function prepareAccessRoles() {
  if (!prisma.role) return;
  for (const spec of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { slug: spec.slug },
      update: { name: spec.name, portal: spec.portal, description: spec.description, isSystem: true },
      create: { ...spec, isSystem: true },
    });
    const grants = spec.slug === "ADMIN" ? PERMISSION_KEYS : defaultGrants(spec.slug);
    const have = await prisma.roleGrant.findMany({
      where: { roleId: role.id },
      select: { permission: true, scope: true },
    });
    const haveSet = new Set(have.map((g) => g.permission));
    const missing = grants.filter((permission) => !haveSet.has(permission));
    if (missing.length) {
      await prisma.roleGrant.createMany({
        data: missing.map((permission) => ({
          roleId: role.id,
          permission,
          scope:
            spec.slug === "ADMIN" && validScopeFor(permission, "SCHOOL", spec.portal)
              ? "SCHOOL"
              : scopePolicyFor(permission, spec.portal).defaultScope,
        })),
      });
    }
  }
  const rolesWithLegacyGrants = await prisma.role.findMany({ include: { grants: true } });
  for (const role of rolesWithLegacyGrants) {
    const permissionSet = new Set(role.grants.map((g) => g.permission));
    for (const grant of role.grants.filter((g) => !g.scope || !validScopeFor(g.permission, g.scope, role.portal))) {
      let scope: AccessScope = scopePolicyFor(grant.permission, role.portal).defaultScope;
      if (!grant.scope && (role.slug === "ADMIN" || grant.permission === "leave.decide")) scope = "SCHOOL";
      if (!grant.scope && (grant.permission === "timetable.view" || grant.permission === "timetable.edit")) {
        scope = permissionSet.has("timetable.edit") ? "SCHOOL" : "REPORTS";
      }
      if (!validScopeFor(grant.permission, scope, role.portal)) {
        scope = scopePolicyFor(grant.permission, role.portal).defaultScope;
      }
      await prisma.roleGrant.update({
        where: { roleId_permission: { roleId: role.id, permission: grant.permission } },
        data: { scope },
      });
    }
  }
  await ensureManagers();
  const managerRoles = await prisma.user.findMany({
    where: { reports: { some: {} }, role: { portal: { in: ["OFFICE", "TEACHER"] } } },
    select: { roleId: true, role: { select: { portal: true } } },
  });
  for (const manager of managerRoles) {
    await prisma.roleGrant.upsert({
      where: { roleId_permission: { roleId: manager.roleId, permission: "leave.decide" } },
      update: {},
      create: { roleId: manager.roleId, permission: "leave.decide", scope: "REPORTS" },
    });
    if (manager.role.portal === "TEACHER") {
      await prisma.roleGrant.upsert({
        where: { roleId_permission: { roleId: manager.roleId, permission: "timetable.view" } },
        update: {},
        create: { roleId: manager.roleId, permission: "timetable.view", scope: "REPORTS" },
      });
    }
  }
}

export async function roleIdBySlug(slug: string) {
  await ensureAccessRoles();
  const role = await prisma.role.findUnique({ where: { slug } });
  if (!role) throw new Error(`Role ${slug} missing`);
  return role.id;
}

export async function loadAccess(userId: string): Promise<AccessUser | null> {
  await ensureAccessRoles();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { grants: true } } },
  });
  if (!user?.role) return null;
  return toAccess(user);
}

function toAccess(user: {
  id: string;
  name: string;
  email: string;
  roleId: string;
  role: {
    name: string;
    slug: string;
    portal: AccessUser["portal"];
    isSystem: boolean;
    grants: { permission: string; scope: AccessScope | null }[];
  };
}): AccessUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role.slug,
    roleName: user.role.name,
    roleId: user.roleId,
    portal: user.role.portal,
    permissions: user.role.grants.map((g) => g.permission),
    scopes: Object.fromEntries(
      user.role.grants.map((g) => [g.permission, g.scope ?? scopePolicyFor(g.permission, user.role.portal).defaultScope])
    ),
    isSystemRole: user.role.isSystem,
  };
}

export async function listRoles() {
  await ensureAccessRoles();
  return prisma.role.findMany({
    include: { grants: true, _count: { select: { users: true } } },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
}

export function slugFromName(name: string) {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24) || "ROLE";
  return base;
}
