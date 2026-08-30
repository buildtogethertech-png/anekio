import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { payHref, webOrigin } from "../../lib/api";
import { useRecord } from "../../lib/record";

const APP_SCHEME = /^(upi|tez|phonepe|paytmmp|gpay|intent|razorpay):/i;

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value || "";
}

export default function PayScreen() {
  const params = useLocalSearchParams<{ token?: string; path?: string }>();
  const token = firstParam(params.token);
  const path = firstParam(params.path);
  const router = useRouter();
  const { reload } = useRecord();
  const webRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const done = useRef(false);

  async function close() {
    if (done.current) return;
    done.current = true;
    await reload();
    router.back();
  }

  function onNav(nav: WebViewNavigation) {
    if (nav.url.includes("paid=1")) close();
  }

  const raw = path ? `${webOrigin()}${path}` : token ? payHref(token) : "";
  const uri = raw ? `${raw}${raw.includes("?") ? "&" : "?"}embed=1` : "";

  if (!uri) {
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
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={onNav}
        onShouldStartLoadWithRequest={(req) => {
          if (APP_SCHEME.test(req.url)) {
            Linking.openURL(req.url).catch(() => undefined);
            return false;
          }
          return true;
        }}
        onOpenWindow={(event) => {
          const next = event.nativeEvent.targetUrl;
          if (next) webRef.current?.injectJavaScript(`window.location.href = ${JSON.stringify(next)}; true;`);
        }}
        userAgent="Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
      />
    </SafeAreaView>
  );
}
