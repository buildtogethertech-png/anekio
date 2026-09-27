export const NOTICE_POLL_MS = 5_000;

export function initialSeenNoticeIds(stored: string[] | null, noticeIds: string[]) {
  return stored ? [...stored] : [...noticeIds];
}

export function unreadNoticeCount(noticeIds: string[], seen: Iterable<string>) {
  const read = seen instanceof Set ? seen : new Set(seen);
  return noticeIds.filter((id) => !read.has(id)).length;
}

export function freshNoticeIds(known: Iterable<string>, noticeIds: string[]) {
  const have = known instanceof Set ? known : new Set(known);
  return noticeIds.filter((id) => !have.has(id));
}

export function markAllNoticeIdsSeen(seen: Iterable<string>, known: Iterable<string>) {
  return new Set([...seen, ...known]);
}

/** Sidebar Notices is the circular board. Unread badges belong on the Bell only. */
export function noticesNavBadge(_unreadBell: number) {
  return 0;
}

export function applyNoticeInboxPoll(input: {
  primed: boolean;
  stored: string[] | null;
  known: Iterable<string>;
  noticeIds: string[];
}) {
  if (!input.primed) {
    const seen = initialSeenNoticeIds(input.stored, input.noticeIds);
    return { primed: true, seen, known: input.noticeIds, fresh: [] as string[] };
  }
  return {
    primed: true,
    seen: null as string[] | null,
    known: input.noticeIds,
    fresh: freshNoticeIds(input.known, input.noticeIds),
  };
}
