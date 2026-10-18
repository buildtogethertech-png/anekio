import Ionicons from "@expo/vector-icons/Ionicons";
import { createElement, useState } from "react";
import { ActivityIndicator, Linking, Modal as RnModal, Platform, Pressable, Share, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { closeInAppDoc, useInAppDoc } from "../lib/in-app-doc";

/** Shows an invoice / receipt page inside the app instead of sending the parent to the browser. */
export function DocViewer({ url, title, onClose }: { url: string | null; title: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const open = Boolean(url);

  async function share() {
    if (!url) return;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
      return;
    }
    try {
      await Share.share({ message: `${title}: ${url}`, url });
    } catch {
      void Linking.openURL(url);
    }
  }

  return (
    <RnModal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose} onShow={() => setLoading(true)}>
      <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
        <View className="flex-row items-center gap-1 border-b border-ink-100 bg-white px-2 py-1.5">
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full">
            <Ionicons name="chevron-back" size={22} color="#0F172A" />
          </Pressable>
          <Text className="min-w-0 flex-1 text-[16px] font-semibold text-ink-900" numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Platform.OS === "web" ? "Open in new tab" : "Share"}
            onPress={() => void share()}
            className="h-9 flex-row items-center gap-1.5 rounded-full bg-[#EEF3FF] px-3"
          >
            <Ionicons name={Platform.OS === "web" ? "open-outline" : "share-outline"} size={16} color="#1F45C7" />
            <Text className="text-[13px] font-semibold text-[#1F45C7]">{Platform.OS === "web" ? "Open" : "Share"}</Text>
          </Pressable>
        </View>
        <View className="min-h-0 flex-1 bg-[#F6F7FB]">
          {url ? (
            Platform.OS === "web" ? (
              createElement("iframe", {
                src: url,
                title,
                onLoad: () => setLoading(false),
                style: { width: "100%", height: "100%", border: "0", background: "#F6F7FB" },
              })
            ) : (
              <NativeDoc uri={url} onLoading={setLoading} />
            )
          ) : null}
          {loading ? (
            <View className="absolute inset-x-0 top-6 items-center" pointerEvents="none">
              <ActivityIndicator color="#1F45C7" />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </RnModal>
  );
}

function NativeDoc({ uri, onLoading }: { uri: string; onLoading: (v: boolean) => void }) {
  const { WebView } = require("react-native-webview") as typeof import("react-native-webview");
  return (
    <WebView
      source={{ uri }}
      className="flex-1"
      javaScriptEnabled
      domStorageEnabled
      originWhitelist={["*"]}
      setSupportMultipleWindows={false}
      onLoadStart={() => onLoading(true)}
      onLoadEnd={() => onLoading(false)}
    />
  );
}

/** Mounted once in the root layout; shows whatever openInAppDoc() asked for. */
export function GlobalDocViewer() {
  const doc = useInAppDoc();
  return <DocViewer url={doc?.url ?? null} title={doc?.title ?? ""} onClose={closeInAppDoc} />;
}
