import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { clock, focusTime, hms, useFocusDay } from "../lib/class-focus";
import { Sheet } from "./ui";

/** Small bar under the top bar (teachers): the school day timer, Break and End day. */
export function FocusDayBar() {
  const focus = useFocusDay();
  if (!focus?.enabled) return null;
  const { day, now, inClass, breakInClass, guardAllowed, allowGuard, startDay, requestBreak, resume, endDay } = focus;

  if (!day || day.status === "ended") {
    return (
      <View className="flex-row items-center gap-2 border-b border-ink-100 bg-white px-4 py-1.5" testID="focus-day-bar">
        <Ionicons name="lock-open-outline" size={14} color="#64748B" />
        <Text className="min-w-0 flex-1 text-[12px] text-ink-500" numberOfLines={1}>
          {day ? `Day ended · focus ${hms(day.focusMs)}` : "School day starts with your check-in"}
        </Text>
        {!day ? (
          <Pressable accessibilityRole="button" onPress={startDay} hitSlop={6} className="flex-row items-center gap-1 rounded-full bg-[#2855F6] px-3 py-1">
            <Ionicons name="play" size={11} color="#fff" />
            <Text className="text-[12px] font-semibold text-white">Start day</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (day.status === "break" && inClass) {
    return (
      <View className="flex-row items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-1.5" testID="focus-day-bar">
        <View className="h-2 w-2 rounded-full bg-red-600" />
        <Text className="min-w-0 flex-1 text-[12px] font-semibold text-red-700" numberOfLines={1}>
          {`Class on · break ${hms(now - day.since)}`}
        </Text>
        <Pressable accessibilityRole="button" onPress={resume} hitSlop={6} className="rounded-full bg-red-600 px-3 py-1">
          <Text className="text-[12px] font-semibold text-white">Back to class</Text>
        </Pressable>
      </View>
    );
  }

  if (day.status === "break") {
    return (
      <View className="flex-row items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-1.5" testID="focus-day-bar">
        <Ionicons name="cafe-outline" size={14} color="#B45309" />
        <Text className="min-w-0 flex-1 text-[12px] font-medium text-amber-900" numberOfLines={1}>
          {`Break · ${day.breakReason || ""} · ${hms(now - day.since)}`}
        </Text>
        <Pressable accessibilityRole="button" onPress={resume} hitSlop={6} className="rounded-full bg-[#2855F6] px-3 py-1">
          <Text className="text-[12px] font-semibold text-white">Resume</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-2 border-b border-[#D6E0FF] bg-[#EEF3FF] px-4 py-1.5" testID="focus-day-bar">
      <Ionicons name="lock-closed" size={13} color="#1F45C7" />
      {inClass ? (
        <Text className="min-w-0 flex-1 text-[12px] font-semibold text-[#1F45C7]" numberOfLines={1}>
          {`Class · ${inClass.classLabel} ${inClass.subject} · till ${clock(inClass.end)}`}
        </Text>
      ) : (
        <>
          <Text className="text-[12px] font-semibold tabular-nums text-[#1F45C7]">{`Focus · ${hms(focusTime(day, now))}`}</Text>
          <View className="min-w-0 flex-1" />
        </>
      )}
      {!guardAllowed ? (
        <Pressable accessibilityRole="button" onPress={allowGuard} hitSlop={6}>
          <Text className="text-[11px] font-semibold text-amber-700" numberOfLines={1}>Allow guard</Text>
        </Pressable>
      ) : null}
      {!inClass || breakInClass ? (
        <Pressable accessibilityRole="button" onPress={requestBreak} hitSlop={6} className="rounded-full border border-[#BFD0FF] bg-white px-2.5 py-0.5">
          <Text className="text-[12px] font-semibold text-[#1F45C7]">Break</Text>
        </Pressable>
      ) : null}
      {!inClass ? (
        <Pressable accessibilityRole="button" onPress={endDay} hitSlop={6} className="rounded-full px-2 py-0.5">
          <Text className="text-[12px] font-medium text-ink-500">End day</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

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
