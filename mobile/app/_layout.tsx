import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NoticeInboxProvider } from "../lib/notice-inbox";
import { SessionProvider } from "../lib/session";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <NoticeInboxProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { flex: 1, backgroundColor: "#f4f7fb" },
            }}
          />
        </NoticeInboxProvider>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
