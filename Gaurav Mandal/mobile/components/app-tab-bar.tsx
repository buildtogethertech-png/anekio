import Ionicons from "@expo/vector-icons/Ionicons";
import { usePathname, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pathForNav } from "../lib/paths";
import { tabIcon, tabLabel, visibleTabs } from "../lib/nav-icons";
import { useSession } from "../lib/session";

function pathMatches(key: string, pathname: string) {
  if (key === "home") return pathname === "/" || pathname === "" || pathname === "/index";
  const href = pathForNav(key);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppTabBar() {
  const { user, nav } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabs = visibleTabs(user?.portal, nav);

  if (pathname === "/pay" || pathname.startsWith("/pay/")) return null;
  if (!tabs.length) return null;

  const primary = tabs.filter((key) => key !== "more");
  const onMore = !primary.some((key) => pathMatches(key, pathname));

  return (
    <View
      className="border-t border-ink-200 bg-white"
      style={{ paddingBottom: Math.max(insets.bottom, 6) }}
    >
      <View className="flex-row">
        {tabs.map((key) => {
          const on = key === "more" ? onMore : pathMatches(key, pathname);
          const color = on ? "#1d4ed8" : "#3d4f66";
          const label = tabLabel(key, user?.portal, nav);
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              onPress={() => router.push((key === "more" ? "/more" : pathForNav(key)) as never)}
              className="min-h-[52px] flex-1 items-center justify-center pt-1.5"
            >
              <Ionicons name={tabIcon(key, on)} size={22} color={color} />
              <Text className={`mt-0.5 text-[10px] ${on ? "font-semibold text-clay-500" : "text-ink-700"}`} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
