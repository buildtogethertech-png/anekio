import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";

export type FeesTab = "due" | "templates" | "history" | "register";

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`h-9 shrink-0 items-center justify-center rounded-md px-3 ${active ? "bg-clay-500" : "bg-white"}`}
    >
      <Text className={`text-sm font-semibold ${active ? "text-white" : "text-ink-800"}`}>{label}</Text>
    </Pressable>
  );
}

export function FeesChrome({
  title,
  lede,
  tab,
  onCollect,
  onSetup,
  onHistory,
  onRegister,
}: {
  title: string;
  lede: string;
  tab: FeesTab;
  onCollect: () => void;
  onSetup: () => void;
  onHistory: () => void;
  onRegister: () => void;
}) {
  const phone = useWindowDimensions().width < 768;
  const group = (
    <View className="flex-row items-center rounded-md border border-ink-200 bg-white p-0.5">
      <Chip label="Collect" active={tab === "due"} onPress={onCollect} />
      <Chip label="Setup" active={tab === "templates"} onPress={onSetup} />
      <Chip label="Fee history" active={tab === "history"} onPress={onHistory} />
      <Chip label="Register" active={tab === "register"} onPress={onRegister} />
    </View>
  );
  return (
    <View className="shrink-0 flex-row items-center gap-3">
      <View className="min-w-0 flex-1">
        <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Fees</Text>
        <Text className="text-base font-semibold text-ink-900" numberOfLines={1}>{title}</Text>
        <Text className="text-xs text-ink-600" numberOfLines={1}>{lede}</Text>
      </View>
      {phone ? (
        <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
          {group}
        </ScrollView>
      ) : (
        group
      )}
    </View>
  );
}
