import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useRef, useState } from "react";
import { Animated, AppState, BackHandler, Image, Linking, Modal as RnModal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiBase } from "../lib/api";
import { appBuild, appVersionName, checkForUpdate, useUpdateState, type UpdateState } from "../lib/app-version";

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
    openPlayStore(update.storeUrl);
  }

  if (update.required) {
    return <UpdateRequiredScreen update={update} />;
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

function openPlayStore(storeUrl: string) {
  void Linking.openURL("market://details?id=in.anekio.school").catch(() => Linking.openURL(storeUrl));
}

function waLink(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const full = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent("Hi, I need help updating the Anekio app.")}`;
}

/** Full-screen, cannot be closed. Branded so users trust it is really Anekio asking. */
function UpdateRequiredScreen({ update }: { update: UpdateState }) {
  const fade = useRef(new Animated.Value(0)).current;
  const [opening, setOpening] = useState(false);
  const version = appVersionName();
  const build = appBuild();

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, [fade]);

  function update_() {
    setOpening(true);
    openPlayStore(update.storeUrl);
    setTimeout(() => setOpening(false), 4000);
  }

  return (
    <RnModal visible animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
      <View className="flex-1 bg-white">
        <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
          <Animated.View style={{ flex: 1, opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
            <ScrollView className="flex-1" contentContainerClassName="flex-grow justify-center px-7 pb-6 pt-4">
              {/* Soft brand card behind logo + title, sized to its content (never cuts through the text). */}
              <View className="items-center overflow-hidden rounded-[28px] bg-[#EEF3FF] px-5 pb-6 pt-8">
                <View className="absolute -right-14 -top-14 h-40 w-40 rounded-full bg-[#DCE6FF]" />
                <View className="absolute -bottom-16 -left-12 h-36 w-36 rounded-full bg-[#E3EBFF]" />
                <View className="h-[88px] w-[88px] items-center justify-center rounded-[26px] bg-white" style={{ shadowColor: "#1F45C7", shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}>
                  <Image source={require("../assets/anekio-mark-transparent.png")} style={{ width: 54, height: 54 }} resizeMode="contain" accessibilityLabel="Anekio" />
                </View>
                <Text className="mt-4 text-[13px] font-bold lowercase tracking-[2px] text-[#1F45C7]">anekio</Text>

                <Text className="mt-6 text-center text-[26px] font-bold leading-8 tracking-tight text-ink-900">A better Anekio is ready</Text>
                <Text className="mt-3 text-center text-[15px] leading-6 text-ink-600">
                  {update.message || "Please update to keep using the app."}
                </Text>
              </View>
              <View className="items-center">
                <View className="mt-5 flex-row items-center gap-2 rounded-full bg-white px-3.5 py-1.5" style={{ borderWidth: 1, borderColor: "#DCE6FF" }}>
                  <Text className="text-[12px] font-semibold text-ink-500">{version ? `v${version}` : build ? `build ${build}` : "This version"}</Text>
                  <Ionicons name="arrow-forward" size={13} color="#94A3B8" />
                  <Text className="text-[12px] font-semibold text-[#1F45C7]">New version</Text>
                </View>
              </View>

              {update.whatsNew.length ? (
                <View className="mt-8 rounded-2xl bg-white px-5 py-4" style={{ borderWidth: 1, borderColor: "#E5EAF2" }}>
                  <Text className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-500">What's new</Text>
                  {update.whatsNew.map((line) => (
                    <View key={line} className="flex-row items-start gap-2.5 py-1.5">
                      <View className="mt-[2px] h-5 w-5 items-center justify-center rounded-full bg-emerald-50">
                        <Ionicons name="checkmark" size={13} color="#059669" />
                      </View>
                      <Text className="min-w-0 flex-1 text-[14px] leading-5 text-ink-800">{line}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View className="mt-6 flex-row items-center justify-center gap-1.5">
                <Ionicons name="shield-checkmark-outline" size={15} color="#059669" />
                <Text className="text-[13px] text-ink-600">Your data is safe. Updating takes under a minute.</Text>
              </View>
            </ScrollView>

            <View className="gap-1 px-6 pb-4 pt-2">
              <Pressable
                accessibilityRole="button"
                onPress={update_}
                className="h-14 flex-row items-center justify-center gap-2 rounded-2xl bg-[#1F45C7] active:opacity-90"
                style={{ shadowColor: "#1F45C7", shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}
              >
                <Ionicons name="logo-google-playstore" size={20} color="#fff" />
                <Text className="text-[16px] font-semibold text-white">{opening ? "Opening Play Store…" : "Update on Play Store"}</Text>
              </Pressable>
              {update.supportPhone ? (
                <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(waLink(update.supportPhone))} className="h-11 flex-row items-center justify-center gap-1.5">
                  <Ionicons name="logo-whatsapp" size={16} color="#16a34a" />
                  <Text className="text-[14px] font-medium text-ink-700">Need help? Contact us</Text>
                </Pressable>
              ) : (
                <View className="h-3" />
              )}
            </View>
          </Animated.View>
        </SafeAreaView>
      </View>
    </RnModal>
  );
}
