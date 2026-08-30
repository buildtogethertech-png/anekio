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

export function classifyNotice(n: { kind?: string | null; body?: string | null }) {
  const body = n.body || "";
  const stored = (NOTICE_KINDS as readonly string[]).includes(n.kind || "") ? (n.kind as NoticeKind) : "";
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
