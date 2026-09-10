import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { createElement, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { firstPayParam, payEmbedPath, payEmbedUri } from "../../lib/pay-uri";
import { useRecord } from "../../lib/record";

const APP_SCHEME = /^(upi|tez|phonepe|paytmmp|gpay|intent|razorpay):/i;

type PayMessage = { source?: string; paid?: boolean };

export default function PayScreen() {
  const params = useLocalSearchParams<{ token?: string; path?: string }>();
  const token = firstPayParam(params.token);
  const path = firstPayParam(params.path);
  const router = useRouter();
  const { reload } = useRecord();
  const [loading, setLoading] = useState(true);
  const done = useRef(false);
  const webPath = payEmbedPath(token, path);
  const nativeUri = payEmbedUri(token, path);

  async function close() {
    if (done.current) return;
    done.current = true;
    await reload();
    router.back();
  }

  useEffect(() => {
    if (Platform.OS !== "web") return;
    function onMessage(event: MessageEvent<PayMessage>) {
      if (event.data?.source !== "anekio-pay" || !event.data.paid) return;
      close();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!webPath && !nativeUri) {
    return (
      <SafeAreaView className="flex-1 bg-ink-50" edges={["top", "bottom"]}>
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-sm text-ink-700">No payment link. Go back to Fees and tap Pay again.</Text>
          <Pressable className="mt-4 rounded-md bg-clay-500 px-4 py-2.5" onPress={() => router.back()}>
            <Text className="text-sm font-medium text-white">Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
      <View className="flex-row items-center border-b border-ink-200 bg-white px-2 py-1">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close payment"
          onPress={close}
          className="h-10 w-10 items-center justify-center rounded-full"
        >
          <Ionicons name="close" size={22} color="#0f2744" />
        </Pressable>
        <View className="min-w-0 flex-1 py-2">
          <Text className="text-base font-semibold text-ink-900">Pay fees</Text>
          <Text className="text-[11px] text-ink-700">Stays in Anekio · Razorpay</Text>
        </View>
      </View>
      {loading ? (
        <View className="absolute left-0 right-0 top-14 z-10 items-center py-3">
          <ActivityIndicator color="#1d4ed8" />
        </View>
      ) : null}
      {Platform.OS === "web" ? (
        <View className="min-h-0 flex-1">
          {createElement("iframe", {
            src: webPath,
            title: "Pay fees",
            allow: "payment *; publickey-credentials-get *",
            onLoad: () => setLoading(false),
            style: { width: "100%", height: "100%", border: "0", background: "#f6f3ee" },
          })}
        </View>
      ) : (
        <NativePayWebView uri={nativeUri} onClose={close} onLoading={setLoading} />
      )}
    </SafeAreaView>
  );
}

function NativePayWebView({
  uri,
  onClose,
  onLoading,
}: {
  uri: string;
  onClose: () => void;
  onLoading: (value: boolean) => void;
}) {
  const { WebView } = require("react-native-webview") as typeof import("react-native-webview");
  const webRef = useRef<InstanceType<typeof WebView>>(null);
  return (
    <WebView
      ref={webRef}
      source={{ uri }}
      className="flex-1"
      javaScriptEnabled
      domStorageEnabled
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      setSupportMultipleWindows={false}
      originWhitelist={["*"]}
      mixedContentMode="always"
      allowsInlineMediaPlayback
      onLoadStart={() => onLoading(true)}
      onLoadEnd={() => onLoading(false)}
      onNavigationStateChange={(nav: { url: string }) => {
        if (nav.url.includes("paid=1")) onClose();
      }}
      onShouldStartLoadWithRequest={(req: { url: string }) => {
        if (APP_SCHEME.test(req.url)) {
          Linking.openURL(req.url).catch(() => undefined);
          return false;
        }
        return true;
      }}
      onOpenWindow={(event: { nativeEvent: { targetUrl?: string } }) => {
        const next = event.nativeEvent.targetUrl;
        if (next) webRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(next)}; true;`);
      }}
      userAgent="Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
    />
  );
}
