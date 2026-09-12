export const NOTICE_KINDS = ["CIRCULAR", "ADMISSION", "EXAM", "FEES", "FEEDBACK", "ATTENDANCE", "LEAVE"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export type ClassifiedNoticeKind = NoticeKind | "OTHER";

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

export function classifyNotice(n: { kind?: string | null }) {
  const stored = canonicalNoticeKind(n.kind);
  if ((NOTICE_KINDS as readonly string[]).includes(stored)) return { kind: stored as NoticeKind };
  return { kind: "OTHER" as const };
}

export function isCircularNotice(n: { kind?: string | null }) {
  return canonicalNoticeKind(n.kind) === "CIRCULAR";
}
