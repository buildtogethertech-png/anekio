import { prisma } from "./prisma";

/**
 * Force / soft update rules for the mobile apps.
 * The app compares its own native build number (Android versionCode) with these values:
 *   build < minBuild    -> blocking "Update required" screen (and the API refuses its requests with 426)
 *   build < latestBuild -> dismissible "new version available" banner
 * 0 switches a rule off. Edited from the Anekio admin console (view=app-version).
 */
export type AppPlatform = "android" | "ios";
export type AppVersionRules = { platform: AppPlatform; minBuild: number; latestBuild: number; message: string; storeUrl: string; updatedAt: string | null; updatedBy: string };

export const DEFAULT_STORE_URL: Record<AppPlatform, string> = {
  android: "https://play.google.com/store/apps/details?id=in.anekio.school",
  ios: "",
};
export const DEFAULT_UPDATE_MESSAGE = "A new version of Anekio is available. Please update to keep using the app.";

const TTL_MS = 15_000;
const cache = new Map<AppPlatform, { at: number; rules: AppVersionRules }>();

export function appPlatform(value: unknown): AppPlatform | null {
  const v = String(value || "").toLowerCase();
  return v === "android" || v === "ios" ? v : null;
}

function wholeNumber(value: unknown) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function getAppVersionRules(platform: AppPlatform, fresh = false): Promise<AppVersionRules> {
  const hit = cache.get(platform);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.rules;
  let row: { minBuild: number; latestBuild: number; message: string; storeUrl: string; updatedAt: Date; updatedBy: string } | null = null;
  try {
    row = await prisma.appVersionConfig.findUnique({ where: { id: platform } });
  } catch {
    row = null; // table missing or DB hiccup: never block anyone because of it
  }
  const rules: AppVersionRules = {
    platform,
    minBuild: row?.minBuild ?? 0,
    latestBuild: Math.max(row?.latestBuild ?? 0, row?.minBuild ?? 0),
    message: row?.message?.trim() || DEFAULT_UPDATE_MESSAGE,
    storeUrl: row?.storeUrl?.trim() || DEFAULT_STORE_URL[platform],
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    updatedBy: row?.updatedBy ?? "",
  };
  cache.set(platform, { at: Date.now(), rules });
  return rules;
}

/** Plain-language result for one app build. */
export async function updateStatusFor(platform: AppPlatform, build: number) {
  const rules = await getAppVersionRules(platform);
  const required = rules.minBuild > 0 && build > 0 && build < rules.minBuild;
  const available = !required && rules.latestBuild > 0 && build > 0 && build < rules.latestBuild;
  return { ...rules, build, required, available };
}

export async function saveAppVersionRules(input: Record<string, unknown>, actorEmail: string) {
  const platform = appPlatform(input.platform) || "android";
  const minBuild = wholeNumber(input.minBuild);
  const latestBuild = Math.max(wholeNumber(input.latestBuild), minBuild);
  const message = String(input.message || "").trim().slice(0, 300);
  const storeUrl = String(input.storeUrl || "").trim().slice(0, 300);
  if (storeUrl && !/^https:\/\//i.test(storeUrl)) throw new Error("Store link must start with https://");
  const data = { minBuild, latestBuild, message, storeUrl, updatedBy: actorEmail };
  await prisma.appVersionConfig.upsert({ where: { id: platform }, create: { id: platform, ...data }, update: data });
  cache.delete(platform);
  await prisma.saasAuditEvent
    .create({
      data: {
        actorEmail,
        action: "APP_VERSION_UPDATED",
        entityType: "APP_VERSION",
        entityId: platform,
        detail: `${platform} · force below build ${minBuild || "off"} · suggest below ${latestBuild || "off"}`,
      },
    })
    .catch(() => undefined);
  return getAppVersionRules(platform, true);
}
