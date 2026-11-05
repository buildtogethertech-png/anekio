/**
 * Over-the-air (EAS Update) helpers. A "critical" update is published with OTA_CRITICAL=1
 * (npm run update:prod -- --critical "…"), which app.config.js writes to extra.otaCritical.
 */
export function isCriticalUpdate(manifest: unknown): boolean {
  const m = manifest as { extra?: { expoClient?: { extra?: { otaCritical?: unknown } } } } | null | undefined;
  return m?.extra?.expoClient?.extra?.otaCritical === true;
}

/** Re-check for an update when the app comes back to the foreground, at most this often. */
export const OTA_RECHECK_MS = 30 * 60_000;

export function shouldCheckAgain(lastCheckedAt: number, now: number, every = OTA_RECHECK_MS) {
  return now - lastCheckedAt >= every;
}
