import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useFocusDay } from "../lib/class-focus";
import { Sheet } from "./ui";

/** Break needs a reason. Mounted once in the app layout. */
export function FocusBreakSheet() {
  const focus = useFocusDay();
  const [picked, setReason] = useState("");
  const [other, setOther] = useState("");
  if (!focus?.enabled) return null;
  const { askBreak, cancelBreak, takeBreak, reasons, inClass } = focus;
  const reason = reasons.includes(picked) ? picked : reasons[0];
  const text = reason === "Other" ? other.trim() : reason;
  return (
    <Sheet open={askBreak} onClose={cancelBreak}>
      <View className="px-5 pb-2" testID="focus-break-sheet">
        <View>
          <Text className="text-[18px] font-semibold text-ink-900">Take a break</Text>
          <Text className="mt-1 text-[13px] text-ink-600">
            {inClass
              ? `${inClass.classLabel} ${inClass.subject} is on. The break and its reason are recorded.`
              : "Your phone is free until you resume. If a class of yours starts, the break may end by itself."}
          </Text>
          <Text className="mb-1.5 mt-4 text-[12px] font-medium text-ink-500">Reason</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {reasons.map((r) => {
              const on = reason === r;
              return (
                <Pressable
                  key={r}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => setReason(r)}
                  className={`h-8 justify-center rounded-full border px-3 ${on ? "border-[#2855F6] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                >
                  <Text className={`text-[13px] ${on ? "font-semibold text-[#1F45C7]" : "text-ink-700"}`}>{r}</Text>
                </Pressable>
              );
            })}
          </View>
          {reason === "Other" ? (
            <TextInput
              value={other}
              onChangeText={setOther}
              placeholder="Write the reason"
              maxLength={80}
              className="mt-3 h-10 rounded-lg border border-ink-200 px-3 text-[14px] text-ink-900"
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={!text}
            onPress={() => takeBreak(text)}
            className={`mt-5 h-11 items-center justify-center rounded-xl ${text ? "bg-[#2855F6]" : "bg-ink-200"}`}
          >
            <Text className="text-[15px] font-semibold text-white">Start break</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={cancelBreak} className="mt-1 h-11 items-center justify-center">
            <Text className="text-[14px] font-medium text-ink-600">Keep working</Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}
