import { Pressable, Text, View } from "react-native";

/** Chips to pick one class when a teacher has more than one (class teacher of several, or a class handed over). */
export function ClassSwitch({
  options,
  value,
  onChange,
  testID,
}: {
  options: { id: string; label: string; hint?: string }[];
  value: string;
  onChange: (id: string) => void;
  testID?: string;
}) {
  if (options.length < 2) return null;
  return (
    <View className="mb-2 flex-row flex-wrap gap-2" testID={testID}>
      {options.map((opt) => {
        const on = opt.id === value;
        return (
          <Pressable
            key={opt.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(opt.id)}
            className={`rounded-xl border px-3 py-1.5 ${on ? "border-[#2855F6] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
          >
            <Text className={`text-[13px] font-semibold ${on ? "text-[#1F45C7]" : "text-ink-900"}`}>{opt.label}</Text>
            {opt.hint ? <Text className="text-[11px] text-ink-500">{opt.hint}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
