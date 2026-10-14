import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession } from "../lib/session";

/** Always-visible marker while an Anekio admin is signed in as a school user. */
export function SupportBanner() {
  const { user, signOut } = useSession();
  const insets = useSafeAreaInsets();
  if (!user?.support) return null;
  const until = new Date(user.support.expiresAt);
  const time = until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + 6, left: 0, right: 0, alignItems: "center", zIndex: 1000 }}>
      <View className="flex-row items-center gap-3 rounded-full bg-red-700 px-4 py-2" style={{ elevation: 6 }}>
        <Text className="text-xs font-semibold text-white" numberOfLines={1}>
          Support view · {user.name} ({user.roleName}) · until {time}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void signOut()} className="rounded-full bg-white/20 px-2.5 py-1">
          <Text className="text-xs font-bold text-white">Exit</Text>
        </Pressable>
      </View>
    </View>
  );
}
