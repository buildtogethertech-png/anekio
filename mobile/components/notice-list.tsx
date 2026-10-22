import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Notice } from "../lib/api";
import { classifyNotice, CLASSIFIED_NOTICE_LABEL, hrefForNotice, type ClassifiedNoticeKind } from "../lib/notice-kind";

/** Soft pastel tiles: low-saturation backgrounds, muted icon tints. */
const KIND_LOOK: Record<ClassifiedNoticeKind, { icon: keyof typeof Ionicons.glyphMap; tint: string; bg: string }> = {
  CIRCULAR: { icon: "megaphone-outline", tint: "#4F6BD8", bg: "#EFF3FE" },
  ADMISSION: { icon: "school-outline", tint: "#B7791F", bg: "#FDF6EA" },
  EXAM: { icon: "ribbon-outline", tint: "#7C6BD6", bg: "#F3F1FD" },
  FEES: { icon: "wallet-outline", tint: "#2F9E7A", bg: "#ECF8F3" },
  FEEDBACK: { icon: "chatbubble-ellipses-outline", tint: "#64748B", bg: "#F3F5F8" },
  ATTENDANCE: { icon: "calendar-outline", tint: "#C08A1E", bg: "#FCF7EA" },
  LEAVE: { icon: "airplane-outline", tint: "#5B63C9", bg: "#F0F1FC" },
  INBOX: { icon: "chatbubbles-outline", tint: "#1D4ED8", bg: "#EEF4FF" },
  UNKNOWN: { icon: "notifications-outline", tint: "#64748B", bg: "#F3F5F8" },
};

export function timeAgo(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function dayLabel(value: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const at = new Date(value).getTime();
  if (at >= start.getTime()) return "Today";
  if (at >= start.getTime() - 86_400_000) return "Yesterday";
  if (at >= start.getTime() - 6 * 86_400_000) return "This week";
  return "Earlier";
}

function firstLine(body?: string) {
  return String(body || "").split("\n")[0].trim();
}

type Item = { kind: "one"; notice: Notice } | { kind: "stack"; key: string; notices: Notice[] };

/** Notices that ask someone to act stay on their own and are never clubbed. */
const NEVER_STACK = /\b(assigned|reassigned|changed|change|moved|allowed|returned|sent back|correction|rejected|cancelled|cover)\b/i;

function titleWords(notice: Notice) {
  return notice.title.trim().split(/\s+/).filter(Boolean);
}

/** Shared start/end of two titles: "Office received your Hindi paper" vs "...your Maths paper" -> 3 + 1. */
function titleFrame(a: string[], b: string[]) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre].toLowerCase() === b[pre].toLowerCase()) pre += 1;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf].toLowerCase() === b[b.length - 1 - suf].toLowerCase()
  )
    suf += 1;
  return { pre, suf };
}

/** Same event about a different subject: same frame, only a short middle differs. */
function sameEvent(a: Notice, b: Notice) {
  if (classifyNotice(a).kind !== classifyNotice(b).kind) return false;
  if (NEVER_STACK.test(a.title) || NEVER_STACK.test(b.title)) return false;
  const lineA = firstLine(a.body);
  if (!lineA || lineA !== firstLine(b.body)) return false;
  const wa = titleWords(a);
  const wb = titleWords(b);
  const { pre, suf } = titleFrame(wa, wb);
  if (pre + suf < 2) return false;
  return wa.length - pre - suf <= 3 && wb.length - pre - suf <= 3 && wa.length - pre - suf > 0 && wb.length - pre - suf > 0;
}

/**
 * Within a day, repeats of the same event (same sitting, only the subject differs)
 * collapse into one stack at the newest one's place, e.g. "7 results published".
 * Anything else stays a single row.
 */
export function stackNotices(rows: Notice[]) {
  const sections: { label: string; items: Item[] }[] = [];
  for (const notice of rows) {
    const label = dayLabel(notice.createdAt);
    let section = sections[sections.length - 1];
    if (!section || section.label !== label) {
      section = { label, items: [] };
      sections.push(section);
    }
    const home = section.items.find((item) =>
      item.kind === "stack" ? sameEvent(item.notices[0], notice) : sameEvent(item.notice, notice),
    );
    if (!home) {
      section.items.push({ kind: "one", notice });
    } else if (home.kind === "stack") {
      home.notices.push(notice);
    } else {
      const at = section.items.indexOf(home);
      section.items[at] = { kind: "stack", key: home.notice.id, notices: [home.notice, notice] };
    }
  }
  return sections;
}

/** "Office received your Hindi paper" x2 -> "Office received 2 papers" · parts ["Hindi", "Maths"]. */
export function summarizeStack(notices: Notice[]) {
  const words = notices.map(titleWords);
  let pre = Infinity;
  let suf = Infinity;
  for (const w of words.slice(1)) {
    const f = titleFrame(words[0], w);
    pre = Math.min(pre, f.pre);
    suf = Math.min(suf, f.suf);
  }
  if (!Number.isFinite(pre)) pre = 0;
  if (!Number.isFinite(suf)) suf = 0;
  const parts = words.map((w) => w.slice(pre, w.length - suf).join(" ")).filter(Boolean);
  const prefixWords = words[0].slice(0, pre);
  if (prefixWords.length && /^(your|the|a)$/i.test(prefixWords[prefixWords.length - 1])) prefixWords.pop();
  const prefix = prefixWords.join(" ").replace(/:$/, "");
  const sufWords = words[0].slice(words[0].length - suf).map((w) => w.toLowerCase());
  if (sufWords.length) sufWords[0] = sufWords[0].endsWith("s") ? sufWords[0] : `${sufWords[0]}s`;
  const count = notices.length;
  const kind = classifyNotice(notices[0]).kind;
  const headline = sufWords.length
    ? [prefix, String(count), ...sufWords].filter(Boolean).join(" ")
    : prefix
      ? `${prefix} · ${count}`
      : `${count} ${CLASSIFIED_NOTICE_LABEL[kind].toLowerCase()} updates`;
  return { headline: headline.charAt(0).toUpperCase() + headline.slice(1), parts: parts.length ? parts : notices.map((n) => n.title) };
}

function listParts(parts: string[], max = 3) {
  if (parts.length <= max) return parts.join(", ");
  return `${parts.slice(0, max).join(", ")} and ${parts.length - max} more`;
}

export function NoticeList({
  rows,
  navKeys,
  isSeen,
  onOpen,
  dense,
}: {
  rows: Notice[];
  navKeys: string[];
  isSeen: (id: string) => boolean;
  onOpen: (notice: Notice, href: string) => void;
  dense?: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const sections = stackNotices(rows);
  const px = dense ? "px-4" : "px-5";

  function Row({ notice, nested }: { notice: Notice; nested?: boolean }) {
    const { kind } = classifyNotice(notice);
    const look = KIND_LOOK[kind];
    const unread = !isSeen(notice.id);
    const href = hrefForNotice(kind, notice, navKeys);
    const lines = String(notice.body || "").split("\n").map((l) => l.trim()).filter(Boolean);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${CLASSIFIED_NOTICE_LABEL[kind]}. ${notice.title}`}
        onPress={() => onOpen(notice, href)}
        className={`flex-row items-start gap-3 ${px} ${nested ? "py-2.5 pl-[68px]" : "py-3.5"} ${unread && !nested ? "bg-[#F7F9FE]" : ""} active:bg-ink-50`}
      >
        {nested ? null : (
          <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: look.bg }}>
            <Ionicons name={look.icon} size={18} color={look.tint} />
          </View>
        )}
        <View className="min-w-0 flex-1">
          <View className="flex-row items-baseline gap-2">
            <Text className={`min-w-0 flex-1 text-[14px] leading-5 ${unread ? "font-semibold text-ink-900" : "font-medium text-ink-700"}`} numberOfLines={1}>
              {notice.title}
            </Text>
            <Text className="text-[11px] text-ink-400">{timeAgo(notice.createdAt)}</Text>
            {unread ? <View className="h-1.5 w-1.5 self-center rounded-full bg-[#5B7BEA]" /> : null}
          </View>
          {!nested && lines.length ? (
            <Text className="mt-0.5 text-[13px] leading-[18px] text-ink-500" numberOfLines={2}>
              {lines.join(" · ")}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  }

  return (
    <View>
      {sections.map((section) => (
        <View key={section.label}>
          <Text className={`${px} pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-[0.8px] text-ink-400`}>{section.label}</Text>
          {section.items.map((item) => {
            if (item.kind === "one") return <Row key={item.notice.id} notice={item.notice} />;
            const first = item.notices[0];
            const { kind } = classifyNotice(first);
            const look = KIND_LOOK[kind];
            const unreadCount = item.notices.filter((n) => !isSeen(n.id)).length;
            const expanded = Boolean(open[item.key]);
            const { headline, parts } = summarizeStack(item.notices);
            return (
              <View key={item.key} className={unreadCount ? "bg-[#F7F9FE]" : ""}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${headline}. ${expanded ? "Collapse" : "Expand"}`}
                  onPress={() => setOpen((s) => ({ ...s, [item.key]: !expanded }))}
                  className={`flex-row items-start gap-3 ${px} py-3.5 active:bg-ink-50`}
                >
                  <View className="h-10 w-10">
                    <View className="absolute left-1 top-1 h-10 w-10 rounded-full" style={{ backgroundColor: look.bg, opacity: 0.6 }} />
                    <View className="h-10 w-10 items-center justify-center rounded-full border-2 border-white" style={{ backgroundColor: look.bg }}>
                      <Ionicons name={look.icon} size={18} color={look.tint} />
                    </View>
                  </View>
                  <View className="min-w-0 flex-1">
                    <View className="flex-row items-baseline gap-2">
                      <Text className={`min-w-0 flex-1 text-[14px] leading-5 ${unreadCount ? "font-semibold text-ink-900" : "font-medium text-ink-700"}`} numberOfLines={1}>
                        {headline}
                      </Text>
                      <Text className="text-[11px] text-ink-400">{timeAgo(first.createdAt)}</Text>
                      {unreadCount ? <View className="h-1.5 w-1.5 self-center rounded-full bg-[#5B7BEA]" /> : null}
                    </View>
                    <Text className="mt-0.5 text-[13px] leading-[18px] text-ink-500" numberOfLines={2}>
                      {[firstLine(first.body), listParts(parts)].filter(Boolean).join(" · ")}
                    </Text>
                    <View className="mt-1.5 flex-row items-center gap-1">
                      <Text className="text-[12px] font-medium text-[#4F6BD8]">{expanded ? "Show less" : `Show all ${item.notices.length}`}</Text>
                      <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={12} color="#4F6BD8" />
                    </View>
                  </View>
                </Pressable>
                {expanded ? (
                  <View className="pb-2">
                    {item.notices.map((notice) => (
                      <Row key={notice.id} notice={notice} nested />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
