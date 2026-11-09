import { Linking, Platform, Share } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * School day guard (Android only, native module in ./android). JS owns the day and sends it with
 * setDay(); the phone keeps it (also after a restart), covers other apps while in focus, ends a break
 * when one of the teacher's classes starts, and ends the day at closing time.
 * On iOS, web or a build without the module, everything is a no-op.
 */
export type NativeDay = {
  status: "off" | "focus" | "break";
  focusMs: number;
  since: number;
  closesAt: number;
  date: string;
  /** School setting: a break may be taken (and kept) while a class is on. */
  breakInClass: boolean;
  /** How long an app Anekio opened stays free (ms; school setting). */
  passMs: number;
  /** Breaks today and their total time, for the guard's "Today" card. */
  breaks: number;
  breakMs: number;
  classes: { start: number; end: number; title: string; subtitle: string }[];
  changedByPhone?: "class" | "closed" | "resumed" | null;
  /** When Anekio opened another app (WhatsApp, call, camera…), not yet logged by JS. */
  outside?: number[];
};

type Native = {
  canDrawOverlays(): boolean;
  openOverlaySettings(): void;
  willOpenApp(): void;
  setDay(json: string): void;
  getDay(): string;
  clearOutside(upTo: number): void;
  addListener(event: "onBreakRequest", listener: () => void): { remove(): void };
};

const native = Platform.OS === "android" ? requireOptionalNativeModule<Native>("ClassLock") : null;

// Android reports "user left" also when Anekio itself opens another app, so tell the guard first:
// links, WhatsApp, calls, settings and share get the short pass instead of the guard.
if (native?.willOpenApp) {
  const mark = <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      native.willOpenApp();
      return fn(...args);
    };
  Linking.openURL = mark(Linking.openURL.bind(Linking));
  Linking.openSettings = mark(Linking.openSettings.bind(Linking));
  Linking.sendIntent = mark(Linking.sendIntent.bind(Linking));
  Share.share = mark(Share.share.bind(Share));
}

export const ClassLock = {
  available: Boolean(native),
  canDrawOverlays: () => (native ? native.canDrawOverlays() : true),
  openOverlaySettings: () => native?.openOverlaySettings(),
  setDay: (day: NativeDay) => native?.setDay(JSON.stringify(day)),
  getDay: (): NativeDay | null => {
    if (!native) return null;
    try {
      return JSON.parse(native.getDay()) as NativeDay;
    } catch {
      return null;
    }
  },
  clearOutside: (upTo: number) => native?.clearOutside(upTo),
  onBreakRequest: (listener: () => void) => native?.addListener("onBreakRequest", listener) ?? { remove() {} },
};
