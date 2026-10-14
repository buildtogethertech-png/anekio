import { verifyAppToken, verifySupportToken } from "./app-jwt";
import { can, type AccessUser } from "./permissions";
import { loadAccess } from "./roles";
import { setTenantOrg } from "./tenant-context";
import { activeSupportSession } from "./support-session";

export function readBearer(header?: string | null) {
  const [scheme, token] = String(header || "").split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function userFromAuthHeader(header?: string | null): Promise<AccessUser | null> {
  const token = readBearer(header);
  if (!token) return null;
  let userId: string | null = null;
  let supportSessionId: string | null = null;
  try {
    userId = verifyAppToken(token);
    if (!userId) {
      const support = verifySupportToken(token);
      if (support) {
        userId = support.userId;
        supportSessionId = support.sessionId;
      }
    }
  } catch {
    userId = null;
  }
  if (!userId) return null;
  const support = supportSessionId ? await activeSupportSession(supportSessionId, userId) : null;
  if (supportSessionId && !support) return null;
  const user = await loadAccess(userId);
  if (user?.orgId) setTenantOrg(user.orgId);
  if (user && support) user.support = support;
  return user;
}

export function hasAny(user: AccessUser, keys: string[]) {
  return keys.some((key) => can(user, key));
}

export function serializeUser(user: AccessUser) {
  return {
    id: user.id,
    name: user.name ?? "",
    email: user.email ?? "",
    role: user.role,
    roleName: user.roleName,
    portal: user.portal,
    permissions: user.permissions,
    ...(user.support ? { support: { adminEmail: user.support.adminEmail, expiresAt: user.support.expiresAt } } : {}),
  };
}
