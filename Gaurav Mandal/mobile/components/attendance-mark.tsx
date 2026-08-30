import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { type AttendanceDot } from "../lib/attendance-summary";

export function AttendanceDots({
  dots,
  compact,
  activeDate,
}: {
  dots: AttendanceDot[];
  compact?: boolean;
  activeDate?: string;
}) {
  const dim = compact ? "h-5 w-5" : "h-7 w-7";
  const type = compact ? "text-[9px]" : "text-[11px]";
  const weekdayType = compact ? "text-[9px]" : "text-[10px]";
  const label = dots
    .filter((d) => d.letter || d.kind === "leave")
    .map((d) => `${d.weekday} ${d.kind === "leave" ? "leave" : d.kind === "late" ? "late" : d.letter}`)
    .join(" ");
  return (
    <View
      className={`flex-row items-end ${compact ? "gap-1.5" : "gap-2"}`}
      accessibilityRole="text"
      accessibilityLabel={label ? `Last 7 days ${label}` : "No recent days"}
    >
      {dots.map((dot, i) => {
        const active = Boolean(activeDate && dot.date === activeDate);
        const fill =
          dot.letter === "P"
            ? "bg-emerald-600"
            : dot.letter === "A"
              ? "bg-red-600"
              : dot.kind === "late"
                ? "bg-amber-500"
                : dot.kind === "leave"
                  ? "bg-sky-600"
                  : active
                    ? "bg-ink-100"
                    : "border border-ink-200 bg-ink-100";
        return (
          <View key={`${dot.date || "empty"}-${i}`} className="items-center gap-0.5">
            <Text
              testID={`attendance-weekday-${dot.date || i}`}
              className={`${weekdayType} font-medium ${active ? "text-clay-600" : "text-ink-700"}`}
            >
              {dot.weekday || " "}
            </Text>
            <View
              testID={`attendance-dot-${dot.date || i}`}
              className={`${dim} items-center justify-center rounded-full ${fill} ${
                active ? "border-2 border-clay-400" : ""
              }`}
            >
              {dot.kind === "leave" ? (
                <Ionicons name="calendar-outline" size={compact ? 10 : 12} color="#fff" />
              ) : (
                <Text className={`${type} font-semibold ${dot.letter ? "text-white" : "text-ink-400"}`}>
                  {dot.letter || "·"}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function OnLeaveSign() {
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="On leave"
      className="h-8 flex-row items-center gap-1 rounded-full bg-sky-600 px-2.5"
    >
      <Ionicons name="calendar-outline" size={14} color="#fff" />
      <Text className="text-xs font-semibold text-white">On leave</Text>
    </View>
  );
}

export function DayMark({
  status,
  disabled,
  onChange,
  name,
}: {
  status: string;
  disabled?: boolean;
  onChange: (status: "PRESENT" | "ABSENT" | "LATE") => void;
  name: string;
}) {
  const st = status.toUpperCase();
  const choices = [
    { value: "PRESENT" as const, letter: "P", label: "present", on: "bg-emerald-600" },
    { value: "ABSENT" as const, letter: "A", label: "absent", on: "bg-red-600" },
    { value: "LATE" as const, letter: "L", label: "late", on: "bg-amber-500" },
  ];
  return (
    <View className="flex-row overflow-hidden rounded-full border border-ink-200">
      {choices.map((c) => {
        const selected = st === c.value;
        return (
          <Pressable
            key={c.value}
            accessibilityRole="button"
            accessibilityLabel={`${name} ${c.label}`}
            accessibilityState={{ selected }}
            disabled={disabled}
            onPress={() => onChange(c.value)}
            className={`h-8 w-9 items-center justify-center ${selected ? c.on : "bg-white"} ${
              disabled ? "opacity-50" : ""
            }`}
          >
            <Text className={`text-center text-xs font-semibold ${selected ? "text-white" : "text-ink-700"}`}>
              {c.letter}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
