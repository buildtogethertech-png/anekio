import Ionicons from "@expo/vector-icons/Ionicons";
import * as Updates from "expo-updates";
import { useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import { isCriticalUpdate, shouldCheckAgain } from "../lib/ota";

/** Dev only: EXPO_PUBLIC_OTA_BANNER_PREVIEW=1 shows the banner with a fake update, to check how it looks. */
const PREVIEW = __DEV__ && process.env.EXPO_PUBLIC_OTA_BANNER_PREVIEW === "1";

/**
 * Mounted once in the root layout (Android/iOS release builds only).
 * The app checks for an update on launch (app.json updates.checkAutomatically) and again when it returns to
 * the foreground after 30 min. A downloaded update shows a small "Tap to refresh" banner; a critical one
 * reloads straight away.
 */

export function OtaUpdateBanner() {
  const enabled = Platform.OS !== "web" && !__DEV__ && Updates.isEnabled;
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const [hidden, setHidden] = useState(false);
  const lastCheck = useRef(Date.now());
  const critical = isCriticalUpdate(downloadedUpdate?.manifest);

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !shouldCheckAgain(lastCheck.current, Date.now())) return;
      lastCheck.current = Date.now();
      Updates.checkForUpdateAsync()
        .then((result) => (result.isAvailable ? Updates.fetchUpdateAsync() : undefined))
        .catch(() => undefined);
    });
    return () => sub.remove();
  }, [enabled]);

  useEffect(() => {
    if (enabled && isUpdatePending && critical) void Updates.reloadAsync().catch(() => undefined);
  }, [enabled, isUpdatePending, critical]);

  if (hidden) return null;
  if (!PREVIEW && (!enabled || !isUpdatePending || critical)) return null;
  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 top-0 px-3 pt-12">
      <View className="flex-row items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3" style={{ elevation: 12 }}>
        <Ionicons name="sparkles-outline" size={18} color="#fff" />
        <Text className="min-w-0 flex-1 text-[13px] text-white">Anekio has been updated.</Text>
        <Pressable accessibilityRole="button" onPress={() => (PREVIEW ? setHidden(true) : void Updates.reloadAsync().catch(() => undefined))} hitSlop={6}>
          <Text className="text-[13px] font-semibold text-[#93B4FF]">Tap to refresh</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setHidden(true)} hitSlop={8}>
          <Ionicons name="close" size={18} color="#CBD5E1" />
        </Pressable>
      </View>
    </View>
  );
}
