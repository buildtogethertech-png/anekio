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

export function canonicalizeNoticeKind(raw?: string | null): ClassifiedNoticeKind {
  const value = String(raw || "").trim().toUpperCase();
  if (!value) return "CIRCULAR";
  if (value === "FEE") return "FEES";
  if (isNoticeKind(value)) return value;
  return "UNKNOWN";
}

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

export function hrefForNotice(
  kind: ClassifiedNoticeKind,
  notice: { eventKey?: string | null; title?: string; body?: string },
  navKeys: string[]
) {
  const has = (key: string) => navKeys.includes(key);
  if (kind === "EXAM") {
    const key = notice.eventKey || "";
    const examId = key.startsWith("NT-5:") ? key.split(":")[1] : key.startsWith("EXAM:") ? key.split(":")[1] : "";
    const seriesId = key.startsWith("SERIES:") ? key.split(":")[1] : "";
    const event = key.startsWith("NT-5:") ? "PAPER_OVERDUE" : key.split(":")[2] || "";
    if (has("exams")) {
      if (/PAPER|EXAM_ASSIGNED|EXAM_TODAY|EXAM_TOMORROW/.test(event) && examId) {
        const view = /PAPER/.test(event) ? "paper" : /EXAM_TODAY|EXAM_TOMORROW/.test(event) ? "take" : "paper";
        return `/exams?examId=${encodeURIComponent(examId)}&view=${view}`;
      }
      if (/MARKS|RESULT_READY|RESULT_PUBLICATION/.test(event) && examId) {
        const view = /CORRECTION|ENTRY_OPEN|DUE/.test(event) ? "marks" : "review";
        return `/exams?examId=${encodeURIComponent(examId)}&view=${view}`;
      }
      return "/exams";
    }
    if (has("tests")) {
      if (seriesId) return `/tests?seriesId=${encodeURIComponent(seriesId)}`;
      return event.includes("SCHEDULE") ? "/tests?view=timetable" : "/tests";
    }
    return "/";
  }
  if (kind === "ADMISSION") return has("admissions") ? "/admissions" : "/";
  if (kind === "FEES") return has("fees") ? "/fees" : "/";
  if (kind === "ATTENDANCE") {
    const leave = /leave/i.test(`${notice.title || ""} ${notice.body || ""}`);
    if (leave && has("leave")) return "/leave";
    if (has("attendance")) return "/attendance";
    if (leave && has("staff")) return "/staff";
    return "/";
  }
  if (kind === "FEEDBACK") return has("inbox") ? "/inbox" : "/";
  if (kind === "LEAVE") return has("leave") ? "/leave" : has("staff") ? "/staff" : "/";
  if (kind === "CIRCULAR") return has("notices") ? "/notices" : "/";
  return "/";
}

export function noticeBellVisible(nav: { key: string }[]) {
  return nav.some((item) => item.key === "notices");
}
