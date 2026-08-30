import { useMemo, useState } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { closedCaption, prettyDay } from "../lib/calendar";
import { Popover } from "./form/popover";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toYmd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromYmd(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function DateField({
  value,
  onChange,
  closedReason,
  max,
  plain,
  bare,
  placeholder = "Pick a date",
}: {
  value: string;
  onChange: (next: string) => void;
  closedReason?: (ymd: string) => string;
  max?: string;
  plain?: boolean;
  bare?: boolean;
  placeholder?: string;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const selected = fromYmd(value) || new Date();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const futureSelected = Boolean(max && value && value > max);
  const reason = futureSelected ? "Future" : closedReason?.(value) || "";
  const caption = futureSelected ? "That day has not come yet." : closedCaption(reason);
  const weekday = WEEKDAY_LONG[selected.getDay()] || "";
  const sideLabel = value ? (reason ? (reason.length > 18 ? "Off" : reason) : weekday) : "";
  const maxMonth = max ? fromYmd(max) : null;
  const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  const canNext = !maxMonth || nextMonth <= new Date(maxMonth.getFullYear(), maxMonth.getMonth(), 1);

  const cells = useMemo(() => {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startPad = start.getDay();
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const slots: (number | null)[] = [];
    for (let i = 0; i < startPad; i++) slots.push(null);
    for (let d = 1; d <= daysInMonth; d++) slots.push(d);
    while (slots.length % 7) slots.push(null);
    return slots;
  }, [cursor]);

  const today = toYmd(new Date());
  const calendar = (
    <View className="p-3.5">
      <View className="mb-3 flex-row items-center justify-between">
        <Pressable
          onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="h-8 w-8 items-center justify-center rounded-full"
        >
          <Ionicons name="chevron-back" size={18} color="#1e3a5f" />
        </Pressable>
        <Text className="text-sm font-semibold text-ink-900">
          {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
        </Text>
        <Pressable
          disabled={!canNext}
          onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className={`h-8 w-8 items-center justify-center rounded-full ${canNext ? "" : "opacity-30"}`}
        >
          <Ionicons name="chevron-forward" size={18} color="#1e3a5f" />
        </Pressable>
      </View>
      <View className="mb-1 flex-row border-b border-ink-100 pb-1">
        {WEEKDAYS.map((d) => (
          <Text key={d} className="h-7 flex-1 text-center text-[11px] font-medium text-ink-700">
            {d}
          </Text>
        ))}
      </View>
      <View>
        {Array.from({ length: cells.length / 7 }, (_, row) => (
          <View key={row} className="flex-row">
            {cells.slice(row * 7, row * 7 + 7).map((day, col) => {
              if (!day) {
                return <View key={`e-${row}-${col}`} className="h-10 flex-1" />;
              }
              const stamp = toYmd(new Date(cursor.getFullYear(), cursor.getMonth(), day));
              const active = stamp === value;
              const isToday = stamp === today;
              const future = Boolean(max && stamp > max);
              const closed = Boolean(closedReason?.(stamp));
              const blocked = future || closed;
              return (
                <Pressable
                  key={stamp}
                  disabled={blocked}
                  onPress={() => {
                    if (blocked) return;
                    onChange(stamp);
                    setOpen(false);
                  }}
                  className="h-10 flex-1 items-center justify-center"
                >
                  <View
                    className={`h-8 w-8 items-center justify-center rounded-full ${
                      active ? "bg-clay-500" : blocked ? "bg-ink-50" : isToday ? "border border-clay-500" : ""
                    }`}
                  >
                    <Text
                      className={`text-sm ${
                        active ? "text-white" : blocked ? "text-ink-400" : "text-ink-900"
                      }`}
                    >
                      {day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );

  function toggle() {
    setCursor(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setOpen((v) => !v);
  }

  const trigger = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? prettyDay(value, true) : placeholder}
      onPress={toggle}
      className={`flex-row items-center ${bare ? "gap-2 py-1" : "rounded-lg border border-ink-200 bg-white px-3 py-2.5"} ${
        plain ? "gap-2" : ""
      }`}
    >
      <Text className={`min-w-0 flex-1 text-sm ${value ? "text-ink-900" : "text-ink-700"}`} numberOfLines={1}>
        {value
          ? plain
            ? `${WEEKDAY_LONG[selected.getDay()].slice(0, 3)}, ${prettyDay(value, !phone)}`
            : prettyDay(value, true)
          : placeholder}
      </Text>
      {!plain && sideLabel ? (
        <Text
          className={`shrink-0 px-2 text-xs font-medium ${reason ? "text-amber-800" : "text-ink-700"}`}
          numberOfLines={1}
        >
          {sideLabel}
        </Text>
      ) : null}
      <Ionicons name="calendar-outline" size={18} color="#3d4f66" />
    </Pressable>
  );

  return (
    <View className="w-full">
      {phone ? (
        <>
          {trigger}
          <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
            <Pressable className="flex-1 items-center justify-center bg-black/40 px-4 py-8" onPress={() => setOpen(false)}>
              <Pressable className="w-full max-w-md rounded-[10px] border border-ink-200 bg-white" onPress={() => {}}>
                {calendar}
              </Pressable>
            </Pressable>
          </Modal>
        </>
      ) : (
        <Popover open={open} onClose={() => setOpen(false)} panel={calendar} maxHeight={360} fixedHeight={350} width={320} align="end">
          {trigger}
        </Popover>
      )}
      {!plain && caption ? <Text className="mt-1 text-[11px] text-ink-700">{caption}</Text> : null}
    </View>
  );
}
