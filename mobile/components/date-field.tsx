import { useMemo, useState, type ComponentProps } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Calendar, type DateData } from "react-native-calendars";
import { closedCaption, prettyDay } from "../lib/calendar";
import { Popover } from "./form/popover";

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DESKTOP_CALENDAR_SIZE = { width: 304, height: 318 };
type CalendarMark = {
  disabled?: boolean;
  disableTouchEvent?: boolean;
  selected?: boolean;
  selectedColor?: string;
  selectedTextColor?: string;
  textColor?: string;
};
type CalendarMarks = Record<string, CalendarMark>;
type CalendarTheme = NonNullable<ComponentProps<typeof Calendar>["theme"]> & Record<string, unknown>;

function toYmd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fromYmd(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function monthDates(cursor: Date) {
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => toYmd(new Date(cursor.getFullYear(), cursor.getMonth(), index + 1)));
}

export function DateField({
  value,
  onChange,
  closedReason,
  min,
  max,
  plain,
  bare,
  compact,
  placeholder = "Pick a date",
}: {
  value: string;
  onChange: (next: string) => void;
  closedReason?: (ymd: string) => string;
  min?: string;
  max?: string;
  plain?: boolean;
  bare?: boolean;
  compact?: boolean;
  placeholder?: string;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const selected = fromYmd(value) || new Date();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const beforeMin = Boolean(min && value && value < min);
  const futureSelected = Boolean(max && value && value > max);
  const reason = beforeMin ? "Before start" : futureSelected ? "Future" : value ? closedReason?.(value) || "" : "";
  const caption = beforeMin ? "Choose a day on or after the first day." : futureSelected ? "That day has not come yet." : closedCaption(reason);
  const weekday = WEEKDAY_LONG[selected.getDay()] || "";
  const sideLabel = value ? (reason ? (reason.length > 18 ? "Off" : reason) : weekday) : "";
  const markedDates = useMemo<CalendarMarks>(() => {
    const marks: CalendarMarks = {};
    for (const stamp of monthDates(cursor)) {
      const disabled = Boolean((min && stamp < min) || (max && stamp > max) || closedReason?.(stamp));
      if (disabled) {
        marks[stamp] = {
          disabled: true,
          disableTouchEvent: true,
          textColor: "#9aa7b7",
        };
      }
    }
    if (value) {
      marks[value] = {
        ...(marks[value] || {}),
        selected: true,
        selectedColor: "#2456d6",
        selectedTextColor: "#ffffff",
      };
    }
    return marks;
  }, [closedReason, cursor, max, min, value]);

  const calendar = (
    <View className="rounded-lg bg-white px-1 py-1">
      <Calendar
        style={{ width: DESKTOP_CALENDAR_SIZE.width }}
        current={toYmd(cursor)}
        firstDay={0}
        hideExtraDays
        minDate={min}
        maxDate={max}
        markedDates={markedDates}
        disableAllTouchEventsForDisabledDays
        onMonthChange={(date: DateData) => setCursor(new Date(date.year, date.month - 1, 1))}
        onDayPress={(date: DateData) => {
          const stamp = date.dateString;
          if ((min && stamp < min) || (max && stamp > max) || closedReason?.(stamp)) return;
          onChange(stamp);
          setOpen(false);
        }}
        renderArrow={(direction: "left" | "right") => (
          <View className="h-7 w-7 items-center justify-center rounded-full bg-ink-50">
            <Ionicons name={direction === "left" ? "chevron-back" : "chevron-forward"} size={17} color="#1e3a5f" />
          </View>
        )}
        theme={{
          calendarBackground: "#ffffff",
          textSectionTitleColor: "#52667d",
          selectedDayBackgroundColor: "#2456d6",
          selectedDayTextColor: "#ffffff",
          todayTextColor: "#2456d6",
          dayTextColor: "#102a43",
          monthTextColor: "#102a43",
          textDisabledColor: "#9aa7b7",
          arrowColor: "#1e3a5f",
          textDayFontSize: 13,
          textMonthFontSize: 15,
          textDayHeaderFontSize: 11,
          textDayFontWeight: "500",
          textMonthFontWeight: "700",
          textDayHeaderFontWeight: "700",
          "stylesheet.calendar.header": {
            header: {
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginHorizontal: 4,
              paddingLeft: 4,
              paddingRight: 4,
              marginTop: 4,
              marginBottom: 4,
            },
            week: {
              marginTop: 8,
              flexDirection: "row",
              justifyContent: "space-around",
            },
          },
          "stylesheet.day.basic": {
            base: {
              width: 30,
              height: 30,
              alignItems: "center",
              justifyContent: "center",
            },
            selected: {
              borderRadius: 15,
            },
          },
        } as CalendarTheme}
      />
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
      className={`w-full flex-row items-center ${
        compact ? "min-h-9 gap-1 rounded-md border border-ink-200 bg-white px-2 py-1.5" : bare ? "min-h-[44px] gap-2 py-1" : "min-h-[44px] rounded-md border border-ink-200 bg-white px-3 py-2.5"
      } ${plain && !compact ? "gap-2" : ""}`}
    >
      <Text className={`min-w-0 flex-1 text-sm ${value ? "text-ink-900" : "text-ink-700"}`} numberOfLines={1}>
        {value
          ? compact
            ? prettyDay(value, false)
            : plain
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
      <Ionicons name="calendar-outline" size={compact ? 14 : 18} color="#3d4f66" />
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
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          panel={calendar}
          maxHeight={DESKTOP_CALENDAR_SIZE.height}
          width={DESKTOP_CALENDAR_SIZE.width}
          align="end"
          fixedHeight={DESKTOP_CALENDAR_SIZE.height}
        >
          {trigger}
        </Popover>
      )}
      {!plain && value && caption ? <Text className="mt-1 text-[11px] text-ink-700">{caption}</Text> : null}
    </View>
  );
}
