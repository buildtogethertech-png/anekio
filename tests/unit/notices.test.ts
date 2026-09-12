import { describe, expect, it } from "vitest";
import {
  classifyNotice,
  isCircularNotice,
  isSystemNotification,
  noticeMatchesFeed,
} from "../../lib/notices";
import { unreadCount } from "../../lib/notice-seen";

describe("notice vs notification classification", () => {
  it("treats CIRCULAR as a school notice", () => {
    expect(isCircularNotice({ kind: "CIRCULAR" })).toBe(true);
    expect(isSystemNotification({ kind: "CIRCULAR" })).toBe(false);
    expect(noticeMatchesFeed({ kind: "CIRCULAR" }, "circulars")).toBe(true);
    expect(noticeMatchesFeed({ kind: "CIRCULAR" }, "notifications")).toBe(false);
  });

  it.each(["FEES", "EXAM", "LEAVE", "ATTENDANCE", "FEEDBACK", "ADMISSION"] as const)(
    "keeps %s on the notification feed, not Notices",
    (kind) => {
      expect(isCircularNotice({ kind })).toBe(false);
      expect(noticeMatchesFeed({ kind }, "circulars")).toBe(false);
      expect(noticeMatchesFeed({ kind }, "notifications")).toBe(true);
      expect(classifyNotice({ kind }).kind).toBe(kind);
    }
  );

  it("normalizes legacy FEE to FEES and never to CIRCULAR", () => {
    expect(classifyNotice({ kind: "FEE" }).kind).toBe("FEES");
    expect(isCircularNotice({ kind: "FEE" })).toBe(false);
    expect(noticeMatchesFeed({ kind: "FEE" }, "notifications")).toBe(true);
  });

  it("does not promote unknown kinds to CIRCULAR", () => {
    expect(isCircularNotice({ kind: "WEIRD" })).toBe(false);
    expect(isCircularNotice({ kind: "" })).toBe(false);
    expect(classifyNotice({ kind: "WEIRD" }).kind).toBe("OTHER");
    expect(noticeMatchesFeed({ kind: "WEIRD" }, "circulars")).toBe(false);
    expect(noticeMatchesFeed({ kind: "WEIRD" }, "notifications")).toBe(true);
  });

  it("does not infer EXAM from circular body text", () => {
    const n = { kind: "CIRCULAR", body: "Office added English for 6-A on Monday" };
    expect(classifyNotice(n).kind).toBe("CIRCULAR");
    expect(isCircularNotice(n)).toBe(true);
  });
});

describe("notification read state", () => {
  it("keeps notification unread when Notices is opened", () => {
    const notifications = ["a", "b", "c", "d", "e"];
    const seen = new Set<string>();
    expect(unreadCount(notifications, seen)).toBe(5);
  });

  it("marks only the opened notification as read", () => {
    const notifications = ["a", "b", "c", "d", "e"];
    const seen = new Set(["a"]);
    expect(unreadCount(notifications, seen)).toBe(4);
  });
});
