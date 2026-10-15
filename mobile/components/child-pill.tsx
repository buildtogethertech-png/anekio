import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Modal as RnModal, Pressable, Text, View } from "react-native";
import { useRecord } from "../lib/record";

function initialsOf(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

/** Phone child switcher: a small pill that opens a bottom sheet. Hidden when there is only one child. */
export function ChildPill() {
  const { data, childId, setChildId } = useRecord();
  const [open, setOpen] = useState(false);
  const kids = data?.children ?? [];
  const child = data?.child;
  if (kids.length < 2) return null;
  const activeId = childId || child?.id;
  const first = (child?.name || "").split(" ")[0] || child?.name || "Select child";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Switch child"
        onPress={() => setOpen(true)}
        className="h-9 flex-row items-center gap-1.5 self-start rounded-full border border-ink-200 bg-white pl-1 pr-2.5"
      >
        <View className="h-7 w-7 items-center justify-center rounded-full bg-[#1F45C7]">
          <Text className="text-[11px] font-bold text-white">{initialsOf(child?.name || "")}</Text>
        </View>
        <Text className="text-[13px] font-semibold text-ink-900" numberOfLines={1}>
          {child ? `${first} · ${child.classLabel}` : first}
        </Text>
        <Ionicons name="chevron-down" size={14} color="#64748B" />
      </Pressable>
      <RnModal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end">
          <Pressable className="absolute inset-0 bg-black/40" onPress={() => setOpen(false)} />
          <View className="rounded-t-3xl bg-white px-5 pb-8 pt-3">
            <View className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-200" />
            <Text className="mb-1 text-[17px] font-semibold text-ink-900">Switch child</Text>
            {kids.map((k) => {
              const on = activeId === k.id;
              return (
                <Pressable
                  key={k.id}
                  onPress={() => {
                    void setChildId(k.id);
                    setOpen(false);
                  }}
                  className={`mt-2 flex-row items-center gap-3 rounded-2xl border p-3 ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200"}`}
                >
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#1F45C7]">
                    <Text className="text-[14px] font-bold text-white">{initialsOf(k.name)}</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[15px] font-semibold text-ink-900">{k.name}</Text>
                    <Text className="text-[12px] text-ink-500">{k.classLabel}</Text>
                  </View>
                  {on ? <Ionicons name="checkmark-circle" size={22} color="#1F45C7" /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </RnModal>
    </>
  );
}
