import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The active school organisation for the current request.  Keeping this in
 * async-local storage means concurrent requests cannot accidentally reuse the
 * previous request's tenant.
 */
const tenantStorage = new AsyncLocalStorage<string | null>();

export function runWithoutTenant<T>(work: () => T) {
  return tenantStorage.run(null, work);
}

export function setTenantOrg(orgId: string | null | undefined) {
  if (orgId) tenantStorage.enterWith(orgId);
}

export function currentTenantOrg() {
  return tenantStorage.getStore();
}
