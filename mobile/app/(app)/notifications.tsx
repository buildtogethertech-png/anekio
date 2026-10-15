import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { classifyNotice, CLASSIFIED_NOTICE_LABEL, hrefForNotice, type ClassifiedNoticeKind } from "../../lib/notice-kind";
import { useNoticeInbox } from "../../lib/notice-inbox";
import { useSession } from "../../lib/session";

const KIND_LOOK: Record<ClassifiedNoticeKind, { icon: keyof typeof Ionicons.glyphMap; tint: string; bg: string }> = {
  CIRCULAR: { icon: "megaphone-outline", tint: "#1d4ed8", bg: "#EEF4FF" },
  ADMISSION: { icon: "school-outline", tint: "#b45309", bg: "#FFF7E6" },
  EXAM: { icon: "document-text-outline", tint: "#c2410c", bg: "#FFF1E8" },
  FEES: { icon: "wallet-outline", tint: "#047857", bg: "#ECFDF5" },
  FEEDBACK: { icon: "chatbubble-ellipses-outline", tint: "#475569", bg: "#F1F5F9" },
  ATTENDANCE: { icon: "calendar-outline", tint: "#a16207", bg: "#FEFCE8" },
  LEAVE: { icon: "airplane-outline", tint: "#4338ca", bg: "#EEF2FF" },
  UNKNOWN: { icon: "notifications-outline", tint: "#475569", bg: "#F1F5F9" },
};

/** "2 days ago" style, like app-store notification lists. */
function timeAgo(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function groupLabel(value: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const at = new Date(value).getTime();
  if (at >= start.getTime()) return "Today";
  if (at >= start.getTime() - 6 * 86_400_000) return "This week";
  return "Earlier";
}

/** Full-page notifications (phone). The desktop header keeps the popover. */
export default function NotificationsScreen() {
  const inbox = useNoticeInbox();
  const { nav } = useSession();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const rows = inbox?.notices ?? [];
  const unread = inbox?.unread ?? 0;
  const navKeys = nav.map((item) => item.key);

  async function refresh() {
    if (!inbox) return;
    setRefreshing(true);
    try {
      await inbox.refresh({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups: { label: string; items: typeof rows }[] = [];
  for (const notice of rows) {
    const label = groupLabel(notice.createdAt);
    const group = groups.find((row) => row.label === label);
    if (group) group.items.push(notice);
    else groups.push({ label, items: [notice] });
  }

  return (
    <SafeAreaView className="min-h-0 flex-1 bg-white" edges={["top"]} testID="notifications-page">
      <View className="flex-row items-center gap-2 px-2 py-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))}
          className="h-11 w-11 items-center justify-center rounded-full"
        >
          <Ionicons name="arrow-back" size={24} color="#0f2744" />
        </Pressable>
        <Text className="min-w-0 flex-1 text-xl font-semibold text-ink-900">Notifications</Text>
        {unread > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => void inbox?.markAllSeen()} className="px-3 py-2">
            <Text className="text-sm font-semibold text-blue-700">Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      {refreshing && !rows.length ? (
        <View className="items-center py-16">
          <ActivityIndicator color="#1d4ed8" />
        </View>
      ) : !rows.length ? (
        <View className="items-center px-8 py-20">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-ink-50">
            <Ionicons name="notifications-off-outline" size={30} color="#94a3b8" />
          </View>
          <Text className="mt-4 text-base font-semibold text-ink-800">No notifications yet</Text>
          <Text className="mt-1 text-center text-sm text-ink-500">School updates will appear here.</Text>
        </View>
      ) : (
        <ScrollView
          className="min-h-0 flex-1"
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        >
          {groups.map((group) => (
            <View key={group.label}>
              <Text className="px-5 pb-1 pt-4 text-sm font-medium text-ink-700">{group.label}</Text>
              {group.items.map((notice) => {
                const { kind } = classifyNotice(notice);
                const look = KIND_LOOK[kind];
                const unreadRow = !inbox?.isSeen(notice.id);
                const href = hrefForNotice(kind, notice, navKeys);
                return (
                  <Pressable
                    key={notice.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${CLASSIFIED_NOTICE_LABEL[kind]}. ${notice.title}`}
                    onPress={async () => {
                      await inbox?.markSeen(notice.id);
                      router.push(href as never);
                    }}
                    className="flex-row items-start gap-3 py-3 pl-2 pr-5 active:bg-ink-50"
                  >
                    <View className="w-2 items-center pt-5">
                      {unreadRow ? <View className="h-1.5 w-1.5 rounded-full bg-blue-600" /> : null}
                    </View>
                    <View className="h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: look.bg }}>
                      <Ionicons name={look.icon} size={22} color={look.tint} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className={`text-[15px] leading-5 ${unreadRow ? "font-semibold text-ink-900" : "text-ink-800"}`} numberOfLines={2}>
                        {notice.title}
                      </Text>
                      {notice.body ? (
                        <Text className="mt-0.5 text-sm leading-5 text-ink-600" numberOfLines={3}>
                          {notice.body}
                        </Text>
                      ) : null}
                      <Text className="mt-1 text-xs text-ink-500">
                        {CLASSIFIED_NOTICE_LABEL[kind]} · {timeAgo(notice.createdAt)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
