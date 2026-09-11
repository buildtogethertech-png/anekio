import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The active school organisation for the current request.  Keeping this in
 * async-local storage means concurrent requests cannot accidentally reuse the
 * previous request's tenant.
 */
type TenantState = { orgId: string | null };

const tenantStorage = new AsyncLocalStorage<TenantState>();

export function runWithoutTenant<T>(work: () => T) {
  // Keep a mutable request-local object rather than storing the ID directly.
  // AsyncLocalStorage child continuations can outlive the function that first
  // loaded the user; mutating this shared request object keeps the tenant set
  // visible to the route after an awaited lookup.
  return tenantStorage.run({ orgId: null }, work);
}

export function setTenantOrg(orgId: string | null | undefined) {
  if (!orgId) return;
  const state = tenantStorage.getStore();
  if (state) {
    state.orgId = orgId;
    return;
  }
  tenantStorage.enterWith({ orgId });
}

export function currentTenantOrg() {
  return tenantStorage.getStore()?.orgId;
}
