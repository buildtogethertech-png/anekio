import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { NoticeList } from "../../components/notice-list";
import { useNoticeInbox } from "../../lib/notice-inbox";
import { useSession } from "../../lib/session";

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

  return (
    <SafeAreaView className="min-h-0 flex-1 bg-white" edges={["top"]} testID="notifications-page">
      <View className="flex-row items-center gap-2 px-2 py-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/" as never))}
          className="h-11 w-11 items-center justify-center rounded-full"
        >
          <Ionicons name="chevron-back" size={22} color="#334155" />
        </Pressable>
        <Text className="min-w-0 flex-1 text-[19px] font-semibold tracking-tight text-ink-900">Notifications</Text>
        {unread > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => void inbox?.markAllSeen()} className="px-3 py-2">
            <Text className="text-[13px] font-medium text-[#4F6BD8]">Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      {refreshing && !rows.length ? (
        <View className="items-center py-16">
          <ActivityIndicator color="#1d4ed8" />
        </View>
      ) : !rows.length ? (
        <View className="items-center px-8 py-20">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-[#EFF3FE]">
            <Ionicons name="leaf-outline" size={28} color="#4F6BD8" />
          </View>
          <Text className="mt-4 text-base font-semibold text-ink-800">You're all caught up</Text>
          <Text className="mt-1 text-center text-sm text-ink-500">School updates will appear here.</Text>
        </View>
      ) : (
        <ScrollView
          className="min-h-0 flex-1"
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        >
          <NoticeList
            rows={rows}
            navKeys={navKeys}
            isSeen={(id) => Boolean(inbox?.isSeen(id))}
            onOpen={async (notice, href) => {
              await inbox?.markSeen(notice.id);
              router.push(href as never);
            }}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
