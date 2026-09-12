import { useState } from "react";
import { Redirect, Slot, Tabs, useRouter } from "expo-router";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { AppTabBar } from "../../components/app-tab-bar";
import { NavMenu } from "../../components/nav-menu";
import { NoticeBell } from "../../components/notice-bell";
import { OnboardingBoard } from "../../components/onboarding-board";
import { RecordProvider, useRecord } from "../../lib/record";
import { useSession } from "../../lib/session";

function ProfileChip() {
  const { user } = useSession();
  const router = useRouter();
  const name = user?.name || "Profile";
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Profile"
      onPress={() => router.push("/profile" as never)}
      className="min-h-10 flex-row items-center gap-2 rounded-full px-1.5 py-1"
    >
      <View className="h-8 w-8 items-center justify-center rounded-full bg-[#EEF4FF]">
        <Text className="text-[11px] font-semibold text-clay-500">{initials || "A"}</Text>
      </View>
      <View className="min-w-0">
        <Text className="text-[13px] font-medium text-ink-900" numberOfLines={1}>
          {name}
        </Text>
        <Text className="text-[11px] text-ink-500">
          {user?.portal === "TEACHER" ? "Teacher" : user?.portal === "OFFICE" ? "Office" : user?.portal === "PARENT" ? "Parent" : "Student"}
        </Text>
      </View>
      <Ionicons name="chevron-down" size={14} color="#94A3B8" />
    </Pressable>
  );
}

function LaunchPanelButton() {
  const { data } = useRecord();
  const { user } = useSession();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const onboarding = data?.onboarding;
  const show = user?.portal === "OFFICE" && onboarding && onboarding.progress.percent < 100;
  if (!show) return null;

  const panelWidth = Math.min(760, Math.max(360, width - 48));
  const bottomOffset = width >= 768 ? Math.max(insets.bottom + 24, 24) : Math.max(insets.bottom + 84, 84);
  const rightOffset = width >= 768 ? 28 : 16;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open school setup"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        className="absolute z-50 h-16 w-16 items-center justify-center rounded-full border border-blue-200 bg-white shadow-xl"
        style={{
          bottom: bottomOffset,
          right: rightOffset,
          shadowColor: "#1d4ed8",
          shadowOpacity: 0.22,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        <View className="h-12 w-12 items-center justify-center rounded-full bg-blue-50">
          <Ionicons name="rocket" size={27} color="#2563eb" />
        </View>
        <View className="absolute -right-1 -top-1 min-w-[30px] items-center rounded-full border border-white bg-clay-500 px-1.5 py-0.5">
          <Text className="text-[10px] font-bold text-white">{onboarding.progress.percent}%</Text>
        </View>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View className="flex-1">
          <Pressable accessibilityLabel="Close school setup" className="absolute inset-0 bg-ink-900/20" onPress={() => setOpen(false)} />
          <View
            className="absolute bottom-0 right-0 top-0 overflow-hidden border-l border-ink-200 bg-ink-50 shadow-xl"
            style={{ width: panelWidth, maxHeight: height }}
            testID="launch-setup-panel"
          >
            <SafeAreaView className="min-h-0 flex-1" edges={["top", "bottom"]}>
              <View className="h-14 flex-row items-center justify-between border-b border-ink-200 bg-white px-5">
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-ink-900">School setup</Text>
                  <Text className="text-[11px] text-ink-500">{onboarding.progress.percent}% complete</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close school setup"
                  onPress={() => setOpen(false)}
                  className="h-10 w-10 items-center justify-center rounded-full"
                >
                  <Ionicons name="close" size={22} color="#0f2744" />
                </Pressable>
              </View>
              <ScrollView className="min-h-0 flex-1" contentContainerClassName="px-5 py-5">
                <OnboardingBoard compact onNavigate={() => setOpen(false)} />
              </ScrollView>
            </SafeAreaView>
          </View>
        </View>
      </Modal>
    </>
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
    <SafeAreaView className="h-full min-h-0 w-[244px] shrink-0 overflow-hidden border-r border-ink-200 bg-white">
      <View className="flex-row items-center gap-2.5 px-4 pb-3 pt-5">
        <View className="h-8 w-8 items-center justify-center rounded-xl bg-[#EEF2FF]">
          <Text className="text-sm font-semibold text-clay-500">A</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-ink-900">Anekio</Text>
          <Text className="text-[11px] font-medium text-ink-500">{role}</Text>
        </View>
      </View>
      <View className="mt-3 min-h-0 flex-1">
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
        <View className="min-h-0 flex-1 flex-row overflow-hidden bg-[#F7F9FC]">
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
          <LaunchPanelButton />
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
          <Tabs.Screen name="onboarding" options={{ href: null }} />
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
        <LaunchPanelButton />
      </View>
    </RecordProvider>
  );
}
