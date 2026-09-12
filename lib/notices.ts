import type { Portal } from "./permissions";

export const NOTICE_KINDS = ["CIRCULAR", "ADMISSION", "EXAM", "FEES", "FEEDBACK", "ATTENDANCE", "LEAVE"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export type ClassifiedNoticeKind = NoticeKind | "OTHER";
export type NoticeFeed = "circulars" | "notifications" | "all";

export const NOTICE_KIND_LABEL: Record<ClassifiedNoticeKind, string> = {
  CIRCULAR: "School",
  ADMISSION: "Admissions",
  EXAM: "Examination",
  FEES: "Fees",
  FEEDBACK: "Feedback",
  ATTENDANCE: "Attendance",
  LEAVE: "Leave",
  OTHER: "Update",
};

export function canonicalNoticeKind(value?: string | null) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "FEE") return "FEES";
  return raw;
}

export function isNoticeKind(value: string): value is NoticeKind {
  return (NOTICE_KINDS as readonly string[]).includes(value);
}

export function classifyNotice(n: { kind?: string | null }) {
  const stored = canonicalNoticeKind(n.kind);
  if (isNoticeKind(stored)) return { kind: stored };
  return { kind: "OTHER" as const };
}

export function isCircularNotice(n: { kind?: string | null }) {
  return canonicalNoticeKind(n.kind) === "CIRCULAR";
}

export function isSystemNotification(n: { kind?: string | null }) {
  return !isCircularNotice(n);
}

export function noticeMatchesFeed(n: { kind?: string | null }, feed: NoticeFeed = "all") {
  if (feed === "circulars") return isCircularNotice(n);
  if (feed === "notifications") return isSystemNotification(n);
  return true;
}

export const NOTICE_ROLES: { portal: Portal; label: string }[] = [
  { portal: "PARENT", label: "Parents" },
  { portal: "TEACHER", label: "Teachers" },
  { portal: "STUDENT", label: "Students" },
  { portal: "OFFICE", label: "Office" },
];

export function noticeRoleLabel(portal: string) {
  return NOTICE_ROLES.find((r) => r.portal === portal)?.label ?? portal;
}

export function normalizeWhatsAppGroupUrl(raw: string) {
  const text = raw.trim();
  if (!text) return "";
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("Paste a chat.whatsapp.com invite link");
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "chat.whatsapp.com") {
    throw new Error("Paste a chat.whatsapp.com invite link");
  }
  const code = url.pathname.replace(/^\//, "").split("/")[0];
  if (!code) throw new Error("That invite link is empty");
  return `https://chat.whatsapp.com/${code}`;
}
