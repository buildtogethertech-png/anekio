import { Redirect, Slot, Tabs, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppTabBar } from "../../components/app-tab-bar";
import { NavMenu } from "../../components/nav-menu";
import { NoticeBell } from "../../components/notice-bell";
import { RecordProvider } from "../../lib/record";
import { useSession } from "../../lib/session";

function ProfileChip() {
  const { user } = useSession();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Profile"
      onPress={() => router.push("/profile" as never)}
      className="h-10 flex-row items-center rounded-full border border-ink-200 bg-white px-3"
    >
      <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>
        {user?.name?.split(" ")[0] || "Profile"}
      </Text>
    </Pressable>
  );
}

function Sidebar() {
  const { user } = useSession();
  const role =
    user?.portal === "PARENT"
      ? "Parent"
      : user?.portal === "TEACHER"
        ? "Teacher"
        : user?.portal === "OFFICE"
          ? "Office"
          : "Student";
  return (
    <SafeAreaView className="h-full min-h-0 w-[232px] shrink-0 overflow-hidden border-r border-ink-200 bg-white">
      <View className="flex-row items-center gap-2.5 px-4 pb-3 pt-5">
        <View className="h-8 w-8 items-center justify-center rounded-xl bg-[#EEF2FF]">
          <Text className="text-sm font-semibold text-clay-500">A</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-ink-900">Anekio</Text>
          <Text className="text-[11px] font-medium text-ink-500">{role}</Text>
        </View>
      </View>
      <View className="mx-4 mb-3 h-px bg-ink-200" />
      <View className="min-h-0 flex-1">
        <NavMenu />
      </View>
    </SafeAreaView>
  );
}

export default function AppLayout() {
  const { ready, user } = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= 768;

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-ink-50">
        <ActivityIndicator color="#1d4ed8" />
      </View>
    );
  }
  if (!user) return <Redirect href="/login" />;

  if (wide) {
    return (
      <RecordProvider>
        <View className="min-h-0 flex-1 flex-row overflow-hidden bg-ink-50">
          <Sidebar />
          <View className="min-h-0 flex-1 overflow-hidden">
            <View className="h-14 shrink-0 flex-row items-center justify-end gap-2 border-b border-ink-200 bg-white px-5">
              <NoticeBell />
              <ProfileChip />
            </View>
            <View className="min-h-0 flex-1 overflow-hidden">
              <Slot />
            </View>
          </View>
        </View>
      </RecordProvider>
    );
  }

  return (
    <RecordProvider>
      <View className="min-h-0 flex-1 overflow-hidden">
        <Tabs
          tabBar={() => <AppTabBar />}
          screenOptions={{
            headerShown: false,
            tabBarHideOnKeyboard: true,
            sceneStyle: { flex: 1, overflow: "hidden" },
          }}
        >
          <Tabs.Screen name="index" />
          <Tabs.Screen name="notices" options={{ href: null }} />
          <Tabs.Screen name="notifications" options={{ href: null }} />
          <Tabs.Screen name="inbox" options={{ href: null }} />
          <Tabs.Screen name="more" options={{ href: null }} />
          <Tabs.Screen name="people" options={{ href: null }} />
          <Tabs.Screen name="staff" options={{ href: null }} />
          <Tabs.Screen name="school" options={{ href: null }} />
          <Tabs.Screen name="timetable" options={{ href: null }} />
          <Tabs.Screen name="fees" options={{ href: null }} />
          <Tabs.Screen name="pay" options={{ href: null }} />
          <Tabs.Screen name="exams" options={{ href: null }} />
          <Tabs.Screen name="roles" options={{ href: null }} />
          <Tabs.Screen name="attendance" options={{ href: null }} />
          <Tabs.Screen name="class" options={{ href: null }} />
          <Tabs.Screen name="leave" options={{ href: null }} />
          <Tabs.Screen name="subjects" options={{ href: null }} />
          <Tabs.Screen name="tests" options={{ href: null }} />
          <Tabs.Screen name="papers" options={{ href: null }} />
          <Tabs.Screen name="path" options={{ href: null }} />
          <Tabs.Screen name="letter" options={{ href: null }} />
          <Tabs.Screen name="uploads" options={{ href: null }} />
          <Tabs.Screen name="profile" options={{ href: null }} />
        </Tabs>
      </View>
    </RecordProvider>
  );
}
