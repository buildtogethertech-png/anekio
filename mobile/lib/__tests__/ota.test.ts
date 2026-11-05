import { isCriticalUpdate, OTA_RECHECK_MS, shouldCheckAgain } from "../ota";

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
});
