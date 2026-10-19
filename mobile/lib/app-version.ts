import { useSyncExternalStore } from "react";
import { Platform } from "react-native";

type AppInfo = { applicationId: string | null; nativeBuildVersion: string | null; nativeApplicationVersion: string | null };
const NO_INFO: AppInfo = { applicationId: null, nativeBuildVersion: null, nativeApplicationVersion: null };
let info: AppInfo | null = null;
/** Lazy + guarded: an app binary built without expo-application must not crash at start-up. */
function appInfo(): AppInfo {
  if (info) return info;
  try {
    const mod = require("expo-application") as typeof import("expo-application");
    info = { applicationId: mod.applicationId, nativeBuildVersion: mod.nativeBuildVersion, nativeApplicationVersion: mod.nativeApplicationVersion };
  } catch {
    info = NO_INFO;
  }
  return info;
}

/**
 * App version + force update (client side).
 * - appBuild(): native build number (Android versionCode, e.g. 11). Sent as X-App-Build with every API call.
 * - The server answers 426 when this build is below the minimum set in the Anekio admin console;
 *   checkForUpdate() asks /api/v1/app-version on launch and when the app comes back to the foreground.
 * Testing in Expo / dev builds: set EXPO_PUBLIC_FAKE_APP_BUILD=5 (dev only) to pretend to be build 5.
 */

const PLAY_URL = "https://play.google.com/store/apps/details?id=in.anekio.school";

function fakeBuild() {
  if (!__DEV__) return 0;
  return Math.floor(Number(process.env.EXPO_PUBLIC_FAKE_APP_BUILD) || 0);
}

/** "Anekio Dev" / "Anekio Preview", Expo Go and the website never get blocked, unless a fake build is set. */
export function updateChecksOn() {
  if (Platform.OS === "web") return false;
  if (fakeBuild()) return true;
  const id = appInfo().applicationId || "";
  return id === "in.anekio.school";
}

export function appBuild() {
  return fakeBuild() || Math.floor(Number(appInfo().nativeBuildVersion) || 0);
}

/** "0.1.0" — the user-facing version, or "" on web. */
export function appVersionName() {
  return Platform.OS === "web" ? "" : appInfo().nativeApplicationVersion || "";
}

export function appVersionLabel() {
  if (Platform.OS === "web") return "";
  const version = appInfo().nativeApplicationVersion || "";
  const build = appBuild();
  const id = appInfo().applicationId || "";
  const dev = id.endsWith(".dev") ? " · dev" : id.endsWith(".preview") ? " · preview" : "";
  return version ? `Anekio v${version}${build ? ` (build ${build})` : ""}${dev}` : "";
}

/** Headers added to every API request from the store app. */
export function appVersionHeaders(): Record<string, string> {
  if (!updateChecksOn()) return {};
  const build = appBuild();
  return build ? { "X-App-Platform": Platform.OS, "X-App-Build": String(build) } : {};
}

export type UpdateState = { required: boolean; available: boolean; message: string; storeUrl: string; latestBuild: number; whatsNew: string[]; supportPhone: string };

let state: UpdateState = { required: false, available: false, message: "", storeUrl: PLAY_URL, latestBuild: 0, whatsNew: [], supportPhone: "" };
const listeners = new Set<() => void>();

function setState(next: Partial<UpdateState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function useUpdateState() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state
  );
}

/** Called by api() when the server answers 426: block right away. */
export function markUpdateRequired(message?: string, storeUrl?: string) {
  setState({ required: true, available: false, message: message || state.message, storeUrl: storeUrl || state.storeUrl || PLAY_URL });
}

/** Ask the server. Any failure (offline, server down) leaves the app usable. */
export async function checkForUpdate(apiBase: string) {
  if (!updateChecksOn()) return;
  const build = appBuild();
  if (!build) return;
  try {
    const res = await fetch(`${apiBase}/api/v1/app-version?platform=${Platform.OS}&build=${build}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return;
    const data = (await res.json()) as Partial<UpdateState> & { latestBuild?: number };
    setState({
      required: Boolean(data.required),
      available: Boolean(data.available),
      message: String(data.message || ""),
      storeUrl: String(data.storeUrl || PLAY_URL),
      latestBuild: Number(data.latestBuild || 0),
      whatsNew: Array.isArray(data.whatsNew) ? data.whatsNew.map(String).slice(0, 3) : [],
      supportPhone: String(data.supportPhone || ""),
    });
  } catch {
    // fail open
  }
}
