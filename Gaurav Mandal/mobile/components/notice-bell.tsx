import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hrefForNotice } from "./notification-row";
import { classifyNotice, NOTICE_KIND_LABEL, type NoticeKind } from "../lib/notice-kind";
import { useNoticeInbox } from "../lib/notice-inbox";
import { useSession } from "../lib/session";

const TAG_STYLE: Record<NoticeKind, string> = {
  ADMISSION: "bg-amber-100 text-amber-900",
  EXAM: "bg-orange-100 text-orange-900",
  FEES: "bg-emerald-100 text-emerald-900",
  FEEDBACK: "bg-slate-100 text-slate-700",
  ATTENDANCE: "bg-yellow-100 text-yellow-900",
  LEAVE: "bg-indigo-100 text-indigo-900",
  CIRCULAR: "bg-blue-100 text-blue-800",
};

function postedWhen(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function NoticeBell() {
  const { nav } = useSession();
  const inbox = useNoticeInbox();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  if (!nav.some((n) => n.key === "notices")) return null;

  const unread = inbox?.unread ?? 0;
  const rows = inbox?.notices ?? [];
  const navKeys = nav.map((item) => item.key);
  const panelWidth = Math.min(390, width - 24);
  const panelTop = width >= 768 ? Math.max(insets.top + 12, 64) : insets.top + 52;
  const panelHeight = Math.max(240, Math.min(520, height - panelTop - 16));

  async function openPanel() {
    setOpen(true);
    if (!inbox) return;
    setRefreshing(true);
    try {
      await inbox.refresh({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={unread ? `Notifications, ${unread} new` : "Notifications"}
        accessibilityState={{ expanded: open }}
        onPress={() => void openPanel()}
        className={`h-10 w-10 items-center justify-center rounded-full ${open ? "bg-blue-50" : "bg-white"}`}
        style={{ shadowColor: "#0f2744", shadowOpacity: 0.09, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}
      >
        <Ionicons name={open ? "notifications" : "notifications-outline"} size={22} color={open ? "#1d4ed8" : "#0f2744"} />
        {unread > 0 ? (
          <View className="absolute right-0 top-0 min-w-[17px] items-center rounded-full bg-red-600 px-1">
            <Text className="text-[10px] font-bold leading-[17px] text-white">{unread > 9 ? "9+" : unread}</Text>
          </View>
        ) : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View className="flex-1">
          <Pressable
            accessibilityLabel="Close notifications"
            className="absolute inset-0 bg-ink-900/10"
            onPress={() => setOpen(false)}
          />
          <View
            className="absolute right-3 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl"
            style={{ top: panelTop, width: panelWidth, maxHeight: panelHeight }}
            testID="notification-popover"
          >
            <View className="flex-row items-center justify-between border-b border-ink-100 px-4 py-3">
              <View className="flex-row items-center gap-2">
                <Text className="text-lg font-bold text-ink-900">Notifications</Text>
                {unread > 0 ? (
                  <View className="rounded-full bg-blue-100 px-2 py-0.5">
                    <Text className="text-xs font-bold text-blue-800">{unread} new</Text>
                  </View>
                ) : null}
              </View>
              <View className="flex-row items-center gap-1">
                {unread > 0 ? (
                  <Pressable accessibilityRole="button" onPress={() => void inbox?.markAllSeen()} className="px-1 py-2">
                    <Text className="text-xs font-semibold text-blue-700">Mark all read</Text>
                  </Pressable>
                ) : null}
                <Pressable accessibilityRole="button" accessibilityLabel="Close notifications" onPress={() => setOpen(false)} className="p-2">
                  <Ionicons name="close" size={18} color="#475569" />
                </Pressable>
              </View>
            </View>

            {refreshing && !rows.length ? (
              <View className="items-center py-12">
                <ActivityIndicator color="#1d4ed8" />
              </View>
            ) : !rows.length ? (
              <View className="items-center px-6 py-12">
                <Ionicons name="notifications-off-outline" size={30} color="#94a3b8" />
                <Text className="mt-3 font-semibold text-ink-700">No notifications yet</Text>
                <Text className="mt-1 text-center text-sm text-ink-500">School updates will appear here.</Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: panelHeight - 58 }}>
                {rows.map((notice) => {
                  const { kind } = classifyNotice(notice);
                  const unreadRow = !inbox?.isSeen(notice.id);
                  const href = hrefForNotice(kind, notice, navKeys);
                  return (
                    <Pressable
                      key={notice.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${NOTICE_KIND_LABEL[kind]}. ${notice.title}`}
                      onPress={async () => {
                        await inbox?.markSeen(notice.id);
                        setOpen(false);
                        router.push(href as never);
                      }}
                      className={`border-b border-ink-100 px-4 py-3 ${unreadRow ? "bg-white" : "bg-ink-50/60"}`}
                    >
                      <View className="flex-row items-start gap-3">
                        <View className="min-w-0 flex-1">
                          <View className="flex-row items-center gap-2">
                            <Text className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TAG_STYLE[kind]}`}>
                              {NOTICE_KIND_LABEL[kind]}
                            </Text>
                            {unreadRow ? <View className="h-2 w-2 rounded-full bg-blue-600" /> : null}
                            <Text className="ml-auto text-xs text-ink-500">{postedWhen(notice.createdAt)}</Text>
                          </View>
                          <Text className={`mt-1.5 text-sm ${unreadRow ? "font-bold text-ink-900" : "font-semibold text-ink-700"}`} numberOfLines={1}>
                            {notice.title}
                          </Text>
                          {notice.body ? (
                            <Text className="mt-0.5 text-xs leading-5 text-ink-600" numberOfLines={2}>
                              {notice.body}
                            </Text>
                          ) : null}
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="#94a3b8" style={{ marginTop: 24 }} />
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

export function PhoneTopBar() {
  const { width } = useWindowDimensions();
  const router = useRouter();
  if (width >= 768) return null;
  return (
    <View className="flex-row items-center border-b border-ink-200 bg-white px-2 py-1">
      <Pressable onPress={() => router.push("/")} className="min-w-0 flex-1 justify-center py-2">
        <Text className="text-base font-semibold text-ink-900">Anekio</Text>
      </Pressable>
      <NoticeBell />
    </View>
  );
}
