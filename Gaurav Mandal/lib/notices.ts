import type { Portal } from "./permissions";

export const NOTICE_KINDS = ["CIRCULAR", "ADMISSION", "EXAM", "FEES", "FEEDBACK", "ATTENDANCE", "LEAVE"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const NOTICE_KIND_LABEL: Record<NoticeKind, string> = {
  CIRCULAR: "School",
  ADMISSION: "Admissions",
  EXAM: "Examination",
  FEES: "Fees",
  FEEDBACK: "Feedback",
  ATTENDANCE: "Attendance",
  LEAVE: "Leave",
};

export function isNoticeKind(value: string): value is NoticeKind {
  return (NOTICE_KINDS as readonly string[]).includes(value);
}

export function classifyNotice(n: { kind?: string | null; body?: string | null }) {
  const body = n.body || "";
  const stored = isNoticeKind(n.kind || "") ? (n.kind as NoticeKind) : "";
  const kind: NoticeKind =
    stored && stored !== "CIRCULAR"
      ? stored
      : / added .+ for .+ on /.test(body)
        ? "EXAM"
        : stored || "CIRCULAR";
  return { kind };
}

export function isCircularNotice(n: { kind?: string | null; body?: string | null }) {
  return classifyNotice(n).kind === "CIRCULAR";
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
