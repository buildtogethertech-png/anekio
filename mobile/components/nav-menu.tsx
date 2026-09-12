import Ionicons from "@expo/vector-icons/Ionicons";
import { usePathname, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { iconForNav, visibleTabs } from "../lib/nav-icons";
import { pathForNav } from "../lib/paths";
import { useSession } from "../lib/session";
import { PageHeader } from "./ui";

const OFFICE_SIDEBAR_ORDER = new Map(
  ["home", "onboarding", "inbox", "people", "staff", "timetable", "fees", "exams", "notices", "admissions", "school", "subscription", "roles"].map(
    (key, index) => [key, index]
  )
);

const PARENT_SIDEBAR_ORDER = new Map(
  ["home", "inbox", "notices", "attendance", "timetable", "fees", "tests"].map((key, index) => [key, index])
);

function navLabel(portal: string | undefined, item: { key: string; label: string }) {
  if (portal === "OFFICE" && item.key === "school") return "Settings";
  if (portal === "OFFICE" && item.key === "roles") return "Roles & permissions";
  return item.label;
}

export function NavMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { user, nav, signOut } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const items = nav
    .filter((n) => n.key !== "profile" && n.key !== "uploads")
    .sort((a, b) => {
      const order =
        user?.portal === "OFFICE"
          ? OFFICE_SIDEBAR_ORDER
          : user?.portal === "PARENT"
            ? PARENT_SIDEBAR_ORDER
            : null;
      if (!order) return 0;
      return (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER);
    });

  function active(key: string) {
    const href = pathForNav(key);
    if (key === "home") return pathname === "/" || pathname === "" || pathname === "/index";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function go(key: string) {
    onNavigate?.();
    router.push(pathForNav(key) as never);
  }

  return (
    <View className="flex-1">
      <ScrollView className="flex-1 px-3" contentContainerStyle={{ paddingBottom: 24 }}>
        {items.map((item) => {
          const on = active(item.key);
          return (
            <Pressable
              key={item.key}
              onPress={() => go(item.key)}
              className={`anekio-nav-item mb-1 min-h-[48px] flex-row items-center gap-3 rounded-lg border px-3 ${
                on ? "border-clay-200 bg-clay-50" : "border-transparent"
              }`}
            >
              <View className="w-6 items-center">
                <Ionicons name={iconForNav(item.key)} size={19} color={on ? "#2563eb" : "#1e3a5f"} />
              </View>
              <Text className={`min-w-0 flex-1 text-[14px] ${on ? "font-semibold text-clay-700" : "font-medium text-ink-900"}`}>
                {navLabel(user?.portal, item)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View className="border-t border-ink-200 bg-white px-4 pb-5 pt-4">
        <Pressable
          onPress={() => {
            onNavigate?.();
            router.push("/profile" as never);
          }}
          className="min-h-[44px] justify-center rounded-xl px-2 py-1"
        >
          <Text className="text-sm font-semibold text-ink-900">{user?.name}</Text>
          <Text className="text-[11px] text-ink-500">{user?.portal === "PARENT" ? "Parent" : user?.roleName}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            onNavigate?.();
            signOut();
          }}
          className="mt-1 min-h-[36px] justify-center px-2"
        >
          <Text className="text-sm font-medium text-ink-500">Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function MoreBoard() {
  const { user, nav, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const skip = new Set(visibleTabs(user?.portal, nav).filter((key) => key !== "more"));
  const rest = nav.filter(
    (item) => !skip.has(item.key) && item.key !== "uploads" && item.key !== "profile"
  );

  function go(key: string) {
    router.push(pathForNav(key) as never);
  }

  return (
    <View>
      <PageHeader title="More" />
      <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
        {rest.map((item, index) => {
          const href = pathForNav(item.key);
          const on = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Pressable
              key={item.key}
              onPress={() => go(item.key)}
              className={`min-h-[56px] flex-row items-center gap-3 px-4 py-3 ${
                index ? "border-t border-ink-200" : ""
              } ${on ? "bg-blue-50" : "bg-white"}`}
            >
              <Ionicons name={iconForNav(item.key)} size={21} color={on ? "#1d4ed8" : "#1e3a5f"} />
              <Text className={`min-w-0 flex-1 text-base ${on ? "font-medium text-clay-500" : "text-ink-900"}`}>
                {navLabel(user?.portal, item)}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#64748b" />
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => router.push("/profile" as never)}
          className={`min-h-[56px] flex-row items-center gap-3 px-4 py-3 ${
            rest.length ? "border-t border-ink-200" : ""
          }`}
        >
          <Ionicons name="person-outline" size={21} color="#1e3a5f" />
          <Text className="min-w-0 flex-1 text-base text-ink-900">Profile</Text>
          <Ionicons name="chevron-forward" size={18} color="#64748b" />
        </Pressable>
        <Pressable
          onPress={() => signOut()}
          className="min-h-[56px] flex-row items-center gap-3 border-t border-ink-200 px-4 py-3"
        >
          <Ionicons name="log-out-outline" size={21} color="#b91c1c" />
          <Text className="text-base font-medium text-red-700">Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}
