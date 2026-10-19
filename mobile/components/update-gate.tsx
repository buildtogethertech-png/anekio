import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { AppState, BackHandler, Linking, Modal as RnModal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiBase } from "../lib/api";
import { appVersionLabel, checkForUpdate, useUpdateState } from "../lib/app-version";

/**
 * Mounted once in the root layout.
 * - Update required: full-screen blocker. No close button, Android back does nothing, only "Update on Play Store".
 * - Update available: small dismissible banner at the bottom (once per app session).
 */
export function UpdateGate() {
  const update = useUpdateState();
  const [bannerHidden, setBannerHidden] = useState(false);

  useEffect(() => {
    void checkForUpdate(apiBase());
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void checkForUpdate(apiBase());
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!update.required) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [update.required]);

  function openStore() {
    void Linking.openURL("market://details?id=in.anekio.school").catch(() => Linking.openURL(update.storeUrl));
  }

  if (update.required) {
    return (
      <RnModal visible animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
        <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
          <View className="flex-1 items-center justify-center px-8">
            <View className="h-20 w-20 items-center justify-center rounded-3xl bg-[#EEF3FF]">
              <Ionicons name="arrow-up-circle" size={44} color="#1F45C7" />
            </View>
            <Text className="mt-6 text-center text-[24px] font-bold tracking-tight text-ink-900">Update Anekio</Text>
            <Text className="mt-3 text-center text-[15px] leading-6 text-ink-600">
              {update.message || "A new version of Anekio is available. Please update to keep using the app."}
            </Text>
          </View>
          <View className="gap-3 px-6 pb-6">
            <Pressable accessibilityRole="button" onPress={openStore} className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-[#1F45C7] active:opacity-90">
              <Ionicons name="logo-google-playstore" size={20} color="#fff" />
              <Text className="text-[16px] font-semibold text-white">Update on Play Store</Text>
            </Pressable>
            {appVersionLabel() ? <Text className="text-center text-[12px] text-ink-400">You have {appVersionLabel().replace(/^Anekio /, "")}</Text> : null}
          </View>
        </SafeAreaView>
      </RnModal>
    );
  }

  if (update.available && !bannerHidden) {
    return (
      <View pointerEvents="box-none" className="absolute inset-x-0 bottom-0 px-3 pb-24">
        <View className="flex-row items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3" style={{ elevation: 12 }}>
          <Ionicons name="sparkles-outline" size={18} color="#fff" />
          <Text className="min-w-0 flex-1 text-[13px] text-white">A new version of Anekio is available.</Text>
          <Pressable accessibilityRole="button" onPress={openStore} hitSlop={6}>
            <Text className="text-[13px] font-semibold text-[#93B4FF]">Update</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setBannerHidden(true)} hitSlop={8}>
            <Ionicons name="close" size={18} color="#CBD5E1" />
          </Pressable>
        </View>
      </View>
    );
  }
  return null;
}
