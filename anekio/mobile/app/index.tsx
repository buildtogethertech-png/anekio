import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../lib/session";

export default function Index() {
  const { ready, user } = useSession();
  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-ink-50">
        <ActivityIndicator color="#1d4ed8" />
      </View>
    );
  }
  return <Redirect href={user ? "/(app)" : "/login"} />;
}
