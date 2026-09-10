import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { NoticeInboxProvider } from "../lib/notice-inbox";
import { SessionProvider } from "../lib/session";

export default function RootLayout() {
  return (
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
  );
}
