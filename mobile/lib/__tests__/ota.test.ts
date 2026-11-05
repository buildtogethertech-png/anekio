import { canAutoReload, CRITICAL_AUTO_RELOAD_MS, isCriticalUpdate, OTA_RECHECK_MS, shouldCheckAgain } from "../ota";

describe("OTA helpers", () => {
  it("reads the critical flag from an EAS update manifest", () => {
    expect(isCriticalUpdate({ extra: { expoClient: { extra: { otaCritical: true } } } })).toBe(true);
    expect(isCriticalUpdate({ extra: { expoClient: { extra: { otaCritical: false } } } })).toBe(false);
    expect(isCriticalUpdate({ extra: {} })).toBe(false);
    expect(isCriticalUpdate(undefined)).toBe(false);
  });

  it("re-checks at most every 30 minutes", () => {
    expect(OTA_RECHECK_MS).toBe(30 * 60_000);
    expect(shouldCheckAgain(0, OTA_RECHECK_MS - 1)).toBe(false);
    expect(shouldCheckAgain(0, OTA_RECHECK_MS)).toBe(true);
  });

  it("auto-reloads a critical update only in the first 5 seconds after launch", () => {
    expect(CRITICAL_AUTO_RELOAD_MS).toBe(5_000);
    expect(canAutoReload(1_000, 1_000 + CRITICAL_AUTO_RELOAD_MS)).toBe(true);
    expect(canAutoReload(1_000, 1_000 + CRITICAL_AUTO_RELOAD_MS + 1)).toBe(false);
  });
});
