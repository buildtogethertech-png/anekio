import Ionicons from "@expo/vector-icons/Ionicons";
import { usePathname, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isStaffScanPath } from "../lib/staff-attendance-scan";
import { pathForNav } from "../lib/paths";
import { qrDockSlots, tabIcon, tabLabel, visibleTabs } from "../lib/nav-icons";
import { useSession } from "../lib/session";
import { useRecord } from "../lib/record";
import { QrDockButton } from "./staff-attendance-qr";
import { startTabLeave } from "./tab-scene";

function pathMatches(key: string, pathname: string) {
  if (key === "home") return pathname === "/" || pathname === "" || pathname === "/index";
  const href = pathForNav(key);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppTabBar() {
  const { user, nav, token } = useSession();
  const { data } = useRecord();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The tapped tab lights up at once; the pathname only changes after the next screen has rendered.
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  useEffect(() => setPressedKey(null), [pathname]);
  const hasSelfQr = Boolean(data?.staffAttendanceSelf);
  const showQr = qrDockSlots(user?.portal, hasSelfQr) > 0;
  const tabs = visibleTabs(user?.portal, nav, showQr ? 1 : 0);

  if (pathname === "/pay" || pathname.startsWith("/pay/") || isStaffScanPath(pathname)) return null;
  if (pathname === "/notifications") return null;
  if (!tabs.length) return null;

  const primary = tabs.filter((key) => key !== "more");
  const qrAt = Math.floor(tabs.length / 2);
  const onMore = !primary.some((key) => pathMatches(key, pathname));

  return (
    <View
      className="border-t border-ink-200 bg-white"
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      <View className="flex-row">
        {tabs.map((key, index) => {
          const dock =
            showQr && index === qrAt ? (
              <QrDockButton key="qr-dock" token={token} />
            ) : null;
          const current = key === "more" ? onMore : pathMatches(key, pathname);
          const on = pressedKey ? pressedKey === key : current;
          const color = on ? "#2563eb" : "#64748B";
          const label = tabLabel(key, user?.portal, nav);
          return [
            dock,
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              onPress={() => {
                setPressedKey(key);
                if (!current) startTabLeave();
                // Let the highlight paint before the next screen's render takes the JS thread.
                requestAnimationFrame(() => router.push((key === "more" ? "/more" : pathForNav(key)) as never));
              }}
              android_ripple={{ color: "#DBEAFE", borderless: true, radius: 30 }}
              className="min-h-[52px] flex-1 items-center justify-center pt-1.5"
              style={({ pressed }) => [Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : null, pressed && Platform.OS === "ios" ? { opacity: 0.6 } : null]}
            >
              <Ionicons name={tabIcon(key, on)} size={22} color={color} />
              <Text className={`mt-0.5 text-[10px] ${on ? "font-semibold text-clay-500" : "text-ink-700"}`} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>,
          ];
        })}
      </View>
    </View>
  );
}
