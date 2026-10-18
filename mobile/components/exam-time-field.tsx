import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { TimePicker } from "./date-field";
import { Modal } from "./ui";

/** "09:00" → "9:00 AM"; "13:30" → "1:30 PM". */
export function prettyTime(value?: string) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const h = Number(match[1]);
  const m = match[2];
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? "AM" : "PM"}`;
}

export function prettyTimeRange(start?: string, end?: string) {
  const a = prettyTime(start);
  const b = prettyTime(end);
  if (!a || !b) return "";
  // "9:00 AM – 12:00 PM", or "9:00 – 11:00 AM" when both are in the same half of the day.
  const sameHalf = a.slice(-2) === b.slice(-2);
  return sameHalf ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}

function minutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total: number) {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

const PRESETS: { label: string; start: string; end: string }[] = [
  { label: "9 – 12", start: "09:00", end: "12:00" },
  { label: "9 – 11", start: "09:00", end: "11:00" },
  { label: "10 – 1", start: "10:00", end: "13:00" },
  { label: "11 – 1", start: "11:00", end: "13:00" },
];

/** A compact "9:00 – 12:00 PM" button; tap to pick the start and end time. */
export function ExamTimeField({
  start,
  end,
  onChange,
  compact,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(start || "09:00");
  const [to, setTo] = useState(end || "12:00");

  useEffect(() => {
    if (open) {
      setFrom(start || "09:00");
      setTo(end || "12:00");
    }
  }, [open, start, end]);

  const label = prettyTimeRange(start, end);
  const bad = minutes(to) <= minutes(from);
  const length = minutes(to) - minutes(from);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ? `Exam time ${label}, change` : "Add exam time"}
        onPress={() => setOpen(true)}
        className={`flex-row items-center gap-1.5 rounded-lg border bg-white ${compact ? "h-9 px-2.5" : "h-11 px-3"} ${label ? "border-ink-200" : "border-dashed border-ink-200"}`}
      >
        <Ionicons name="time-outline" size={15} color={label ? "#334155" : "#2563EB"} />
        <Text className={`text-[13px] ${label ? "font-medium text-ink-900" : "font-medium text-clay-600"}`} numberOfLines={1}>
          {label || "Add time"}
        </Text>
      </Pressable>
      <Modal
        open={open}
        title="Exam time"
        onClose={() => setOpen(false)}
        footer={
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            {label ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onChange("", "");
                  setOpen(false);
                }}
                className="py-2"
              >
                <Text className="text-[13px] font-medium text-ink-700">Remove time</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable
              accessibilityRole="button"
              disabled={bad}
              onPress={() => {
                onChange(from, to);
                setOpen(false);
              }}
              className={`h-10 items-center justify-center rounded-md px-5 ${bad ? "bg-ink-200" : "bg-clay-500"}`}
            >
              <Text className={`text-[14px] font-semibold ${bad ? "text-ink-500" : "text-white"}`}>
                {bad ? "End must be after start" : `Use ${prettyTimeRange(from, to)}`}
              </Text>
            </Pressable>
          </View>
        }
      >
        <View className="gap-4">
          <View className="flex-row flex-wrap gap-2">
            {PRESETS.map((preset) => {
              const on = preset.start === from && preset.end === to;
              return (
                <Pressable
                  key={preset.label}
                  accessibilityRole="button"
                  onPress={() => {
                    setFrom(preset.start);
                    setTo(preset.end);
                  }}
                  className={`h-8 justify-center rounded-full border px-3 ${on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}
                >
                  <Text className={`text-[13px] font-medium ${on ? "text-white" : "text-ink-800"}`}>{preset.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View className="gap-1.5">
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Starts</Text>
            <TimePicker
              value={from}
              onChange={(next) => {
                // Keep the same length when the start moves.
                const keep = length > 0 ? length : 180;
                setFrom(next);
                setTo(fromMinutes(minutes(next) + keep));
              }}
            />
          </View>
          <View className="gap-1.5">
            <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Ends</Text>
            <TimePicker value={to} onChange={setTo} />
          </View>
          {!bad ? (
            <Text className="text-center text-[13px] text-ink-700">
              {`${Math.floor(length / 60) ? `${Math.floor(length / 60)} hr ` : ""}${length % 60 ? `${length % 60} min` : ""}`.trim()}
            </Text>
          ) : null}
        </View>
      </Modal>
    </>
  );
}
