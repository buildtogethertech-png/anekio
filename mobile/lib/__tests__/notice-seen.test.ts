import {
  NOTICE_POLL_MS,
  applyNoticeInboxPoll,
  freshNoticeIds,
  initialSeenNoticeIds,
  markAllNoticeIdsSeen,
  noticesNavBadge,
  unreadNoticeCount,
} from "../notice-seen";
describe("local notice seen state", () => {
  it("uses a 5-second poll interval so the bell badge updates without opening the panel", () => {
    expect(NOTICE_POLL_MS).toBe(5_000);
  });

  it("marks the first snapshot as seen so historical notices do not badge", () => {
    const snapshot = ["n1", "n2", "n3"];
    expect(initialSeenNoticeIds(null, snapshot)).toEqual(snapshot);
    expect(unreadNoticeCount(snapshot, initialSeenNoticeIds(null, snapshot))).toBe(0);
  });

  it("keeps stored seen ids across later polls and badges only new ids", () => {
    const stored = initialSeenNoticeIds(null, ["old-1", "old-2"]);
    const afterLogin = ["old-1", "old-2", "new-1"];
    expect(unreadNoticeCount(afterLogin, stored)).toBe(1);
    expect(freshNoticeIds(stored, afterLogin)).toEqual(["new-1"]);
    expect(freshNoticeIds(["new-1", ...stored], afterLogin)).toEqual([]);
  });

  it("decreases the badge after markSeen and mark all read without dropping ids", () => {
    const ids = ["a", "b", "c"];
    const seen = new Set<string>();
    expect(unreadNoticeCount(ids, seen)).toBe(3);
    seen.add("a");
    expect(unreadNoticeCount(ids, seen)).toBe(2);
    const all = markAllNoticeIdsSeen(seen, ids);
    expect(unreadNoticeCount(ids, all)).toBe(0);
    expect([...all].sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps the Notices sidebar free of the Bell unread count", () => {
    expect(noticesNavBadge(4)).toBe(0);
  });

  it("increases unread on a later poll without opening the bell", () => {
    const first = applyNoticeInboxPoll({ primed: false, stored: ["old"], known: ["old"], noticeIds: ["old"] });
    const polled = applyNoticeInboxPoll({
      primed: first.primed,
      stored: first.seen,
      known: first.known,
      noticeIds: ["old", "new-teacher-update"],
    });
    expect(polled.fresh).toEqual(["new-teacher-update"]);
    expect(unreadNoticeCount(polled.known, first.seen || [])).toBe(1);
  });
});
