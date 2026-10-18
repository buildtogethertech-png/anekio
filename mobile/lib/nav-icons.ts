import type { ComponentProps } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";

export type IoniconName = ComponentProps<typeof Ionicons>["name"];

export const TAB_ICONS: Record<string, { outline: IoniconName; filled: IoniconName }> = {
  home: { outline: "home-outline", filled: "home" },
  notices: { outline: "megaphone-outline", filled: "megaphone" },
  inbox: { outline: "chatbubbles-outline", filled: "chatbubbles" },
  more: { outline: "grid-outline", filled: "grid" },
  timetable: { outline: "calendar-outline", filled: "calendar" },
  fees: { outline: "wallet-outline", filled: "wallet" },
  profile: { outline: "person-outline", filled: "person" },
  people: { outline: "people-outline", filled: "people" },
  staff: { outline: "briefcase-outline", filled: "briefcase" },
  attendance: { outline: "checkmark-done-circle-outline", filled: "checkmark-done-circle" },
  exams: { outline: "document-text-outline", filled: "document-text" },
  leave: { outline: "airplane-outline", filled: "airplane" },
  class: { outline: "people-outline", filled: "people" },
};

export type TabKey = string;

export function tabIcon(key: string, focused: boolean): IoniconName {
  const pair = TAB_ICONS[key];
  if (!pair) return iconForNav(key);
  return focused ? pair.filled : pair.outline;
}

const NAV_ICONS: Record<string, IoniconName> = {
  home: "home-outline",
  notices: "megaphone-outline",
  inbox: "chatbubbles-outline",
  people: "people-outline",
  onboarding: "rocket-outline",
  staff: "briefcase-outline",
  school: "settings-outline",
  admissions: "person-add-outline",
  timetable: "calendar-outline",
  fees: "wallet-outline",
  exams: "clipboard-outline",
  leave: "airplane-outline",
  class: "people-outline",
  roles: "shield-checkmark-outline",
  subscription: "receipt-outline",
  attendance: "checkmark-done-circle-outline",
  subjects: "book-outline",
  tests: "document-text-outline",
  papers: "documents-outline",
  path: "trail-sign-outline",
  letter: "mail-outline",
  uploads: "cloud-upload-outline",
  profile: "person-outline",
};

export function iconForNav(key: string): IoniconName {
  return NAV_ICONS[key] ?? "ellipse-outline";
}

export function tabsForPortal(portal?: string | null) {
  // Parents: no "More" tab. Everything else sits in Quick access on the home screen.
  if (portal === "PARENT") return ["home", "timetable", "fees", "inbox"];
  // Teachers: no "More" tab. Leave is on the dashboard, Inbox and Profile sit in the top bar.
  if (portal === "TEACHER") return ["home", "attendance", "class", "exams", "timetable"];
  if (portal === "OFFICE") return ["home", "people", "staff", "fees", "more"];
  return ["home", "timetable", "fees", "profile", "more"];
}

/** If a role can't open a preferred tab, the next most useful page it CAN open takes the slot. */
const TAB_FALLBACKS: Record<string, string[]> = {
  OFFICE: ["home", "people", "staff", "fees", "admissions", "exams", "timetable", "notices", "inbox", "school"],
  TEACHER: ["home", "attendance", "class", "exams", "timetable", "leave", "notices", "inbox"],
};

/** Office staff with their own attendance QR get a centre "My QR" button, which takes one tab slot. */
export function qrDockSlots(_portal: string | undefined, _hasSelfQr: boolean) {
  // My QR now lives in the top bar; the bottom bar keeps its normal tabs.
  return 0;
}

/** Which tab moves into More when the centre QR button takes a slot. People lives in More for office staff. */
const DOCK_GIVES_UP: Record<string, string> = { OFFICE: "people" };

export function visibleTabs(portal: string | undefined, nav: { key: string }[], reserved = 0) {
  const allowed = nav.map((item) => item.key);
  const has = new Set(allowed);
  const giveUp = reserved ? DOCK_GIVES_UP[portal || ""] : undefined;
  const all = tabsForPortal(portal).filter((key) => key !== giveUp);
  // Keep the bar at 5 so the centre button sits dead centre.
  const preferred = reserved && !giveUp ? [...all.filter((key) => key !== "more").slice(0, -reserved), ...all.filter((key) => key === "more")] : all;
  const fallback = TAB_FALLBACKS[portal || ""];
  if (!fallback) return preferred.filter((key) => key === "more" || has.has(key));
  const ordered = [...fallback, ...allowed].filter((key, i, all) => has.has(key) && key !== "more" && key !== "profile" && key !== giveUp && all.indexOf(key) === i);
  const slots = preferred.filter((key) => key !== "more").length;
  // Fits in the bar (a 5th page can take More's place): no More tab at all.
  if (!preferred.includes("more") || ordered.length <= slots + 1) return ordered.slice(0, slots + (preferred.includes("more") ? 1 : 0));
  return [...ordered.slice(0, slots), "more"];
}

export function tabLabel(key: string, portal: string | undefined, nav: { key: string; label: string }[]) {
  if (portal === "OFFICE") {
    const officeLabels: Record<string, string> = {
      home: "Desk",
      people: "People",
      staff: "Staff",
      fees: "Fees",
      more: "More",
    };
    if (officeLabels[key]) return officeLabels[key];
  }
  if (key === "more") return "More";
  if (portal === "PARENT" && key === "home") return "Home";
  if (portal === "PARENT" && key === "timetable") return "Schedule";
  return nav.find((item) => item.key === key)?.label || key;
}
