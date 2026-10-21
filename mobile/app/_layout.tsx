import "../global.css";
import "../lib/web-effects";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NoticeInboxProvider } from "../lib/notice-inbox";
import { UpdateGate } from "../components/update-gate";
import { GlobalDocViewer } from "../components/doc-viewer";
import { SessionProvider } from "../lib/session";
import { KeyboardProvider } from "../lib/keyboard";
import { APP_FONTS, applyAppFont } from "../lib/fonts";

applyAppFont();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(APP_FONTS);
  if (__DEV__ && fontError) console.warn("[fonts] Inter failed to load", fontError);
  // Wait for Inter so the first frame doesn't flash the phone's fallback font.
  if (!fontsLoaded && !fontError) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
        <SessionProvider>
          <NoticeInboxProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { flex: 1, backgroundColor: "#f4f7fb" },
              }}
            />
            <GlobalDocViewer />
            <UpdateGate />
          </NoticeInboxProvider>
        </SessionProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
