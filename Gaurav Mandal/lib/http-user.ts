import { verifyAppToken } from "./app-jwt";
import { can, type AccessUser } from "./permissions";
import { loadAccess } from "./roles";

export function readBearer(header?: string | null) {
  const [scheme, token] = String(header || "").split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function userFromAuthHeader(header?: string | null): Promise<AccessUser | null> {
  const token = readBearer(header);
  if (!token) return null;
  let userId: string | null = null;
  try {
    userId = verifyAppToken(token);
  } catch {
    userId = null;
  }
  if (!userId) return null;
  return loadAccess(userId);
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
  };
}
