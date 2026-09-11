import type { ComponentProps } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";

export type IoniconName = ComponentProps<typeof Ionicons>["name"];

export const TAB_ICONS: Record<string, { outline: IoniconName; filled: IoniconName }> = {
  home: { outline: "home-outline", filled: "home" },
  notices: { outline: "megaphone-outline", filled: "megaphone" },
  inbox: { outline: "mail-unread-outline", filled: "mail-unread" },
  more: { outline: "grid-outline", filled: "grid" },
  timetable: { outline: "calendar-outline", filled: "calendar" },
  fees: { outline: "card-outline", filled: "card" },
  profile: { outline: "person-outline", filled: "person" },
  people: { outline: "people-outline", filled: "people" },
  staff: { outline: "briefcase-outline", filled: "briefcase" },
  attendance: { outline: "checkmark-circle-outline", filled: "checkmark-circle" },
  exams: { outline: "document-text-outline", filled: "document-text" },
  leave: { outline: "walk-outline", filled: "walk" },
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
  inbox: "mail-unread-outline",
  people: "people-outline",
  onboarding: "rocket-outline",
  staff: "briefcase-outline",
  school: "school-outline",
  timetable: "calendar-outline",
  fees: "card-outline",
  exams: "document-text-outline",
  leave: "walk-outline",
  class: "people-outline",
  roles: "shield-checkmark-outline",
  subscription: "receipt-outline",
  attendance: "checkmark-circle-outline",
  subjects: "book-outline",
  tests: "reader-outline",
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
  if (portal === "PARENT") return ["home", "timetable", "fees", "more"];
  if (portal === "TEACHER") return ["home", "attendance", "class", "exams", "more"];
  if (portal === "OFFICE") return ["home", "people", "staff", "fees", "more"];
  return ["home", "timetable", "fees", "profile", "more"];
}

export function visibleTabs(portal: string | undefined, nav: { key: string }[]) {
  const allowed = new Set(nav.map((item) => item.key));
  return tabsForPortal(portal).filter((key) => key === "more" || allowed.has(key));
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
