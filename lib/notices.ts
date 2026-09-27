import type { Portal } from "./permissions";

export const NOTICE_KINDS = ["CIRCULAR", "ADMISSION", "EXAM", "FEES", "FEEDBACK", "ATTENDANCE", "LEAVE"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export type ClassifiedNoticeKind = NoticeKind | "UNKNOWN";

export const NOTICE_KIND_LABEL: Record<NoticeKind, string> = {
  CIRCULAR: "School",
  ADMISSION: "Admissions",
  EXAM: "Examination",
  FEES: "Fees",
  FEEDBACK: "Feedback",
  ATTENDANCE: "Attendance",
  LEAVE: "Leave",
};

export const CLASSIFIED_NOTICE_LABEL: Record<ClassifiedNoticeKind, string> = {
  ...NOTICE_KIND_LABEL,
  UNKNOWN: "Notice",
};

export function isNoticeKind(value: string): value is NoticeKind {
  return (NOTICE_KINDS as readonly string[]).includes(value);
}

/** Map producer aliases onto the catalog. Empty kind stays a circular (legacy rows). */
export function canonicalizeNoticeKind(raw?: string | null): ClassifiedNoticeKind {
  const value = String(raw || "").trim().toUpperCase();
  if (!value) return "CIRCULAR";
  if (value === "FEE") return "FEES";
  if (isNoticeKind(value)) return value;
  return "UNKNOWN";
}

/** Persist only catalog kinds. Unknown office posts remain circulars. FEE is stored as FEES. */
export function storedNoticeKind(raw?: string | null): NoticeKind {
  const kind = canonicalizeNoticeKind(raw);
  return kind === "UNKNOWN" ? "CIRCULAR" : kind;
}

export function classifyNotice(n: { kind?: string | null; body?: string | null }) {
  const canonical = canonicalizeNoticeKind(n.kind);
  if (canonical !== "CIRCULAR") return { kind: canonical };
  if (/ added .+ for .+ on /.test(n.body || "")) return { kind: "EXAM" as const };
  return { kind: "CIRCULAR" as const };
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
