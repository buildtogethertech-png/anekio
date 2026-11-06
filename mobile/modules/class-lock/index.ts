import { Platform } from "react-native";
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
  classes: { start: number; end: number; title: string; subtitle: string }[];
  changedByPhone?: "class" | "closed" | "resumed" | null;
  /** When Anekio opened another app (WhatsApp, call, camera…), not yet logged by JS. */
  outside?: number[];
};

type Native = {
  canDrawOverlays(): boolean;
  openOverlaySettings(): void;
  setDay(json: string): void;
  getDay(): string;
  clearOutside(upTo: number): void;
  addListener(event: "onBreakRequest", listener: () => void): { remove(): void };
};

const native = Platform.OS === "android" ? requireOptionalNativeModule<Native>("ClassLock") : null;

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
