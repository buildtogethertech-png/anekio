import { useMemo, useState, type ComponentProps } from "react";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Calendar, type DateData } from "react-native-calendars";
import { closedCaption, prettyDay } from "../lib/calendar";
import { Popover } from "./form/popover";

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DESKTOP_CALENDAR_SIZE = { width: 304, height: 390 };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
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
  birthDate,
}: {
  /** Date of birth: opens on a year grid about six years back, no Today shortcuts. */
  birthDate?: boolean;
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
  const [picker, setPicker] = useState<"calendar" | "month" | "year">("calendar");
  const [yearPage, setYearPage] = useState(() => selected.getFullYear() - 5);
  const beforeMin = Boolean(min && value && value < min);
  const futureSelected = Boolean(max && value && value > max);
  const reason = beforeMin ? "Before start" : futureSelected ? "Future" : value ? closedReason?.(value) || "" : "";
  const caption = beforeMin ? "Choose a day on or after the first day." : futureSelected ? "That day has not come yet." : closedCaption(reason);
  const weekday = WEEKDAY_LONG[selected.getDay()] || "";
  const sideLabel = value ? (reason ? (reason.length > 18 ? "Off" : reason) : weekday) : "";
  const allowed = (stamp: string) => !((min && stamp < min) || (max && stamp > max) || closedReason?.(stamp));
  const quickPicks = (() => {
    const today = toYmd(new Date());
    const picks: { label: string; value: string }[] = [];
    if (allowed(today)) picks.push({ label: "Today", value: today });
    const next = new Date();
    for (let i = 0; i < 10; i += 1) {
      next.setDate(next.getDate() + 1);
      const stamp = toYmd(next);
      if (allowed(stamp)) {
        picks.push({ label: i === 0 ? "Tomorrow" : `Next school day`, value: stamp });
        break;
      }
    }
    return picks;
  })();
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

  const monthYearPicker = picker === "calendar" ? null : (
    <View className="px-2 pt-2">
      <View className="flex-row items-center justify-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose month"
          onPress={() => setPicker((current) => (current === "month" ? "calendar" : "month"))}
          className={`rounded-md px-2.5 py-1.5 ${picker === "month" ? "bg-blue-50" : "bg-ink-50"}`}
        >
          <Text className="text-xs font-semibold text-ink-900">{MONTHS[cursor.getMonth()]}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose year"
          onPress={() => {
            setYearPage(cursor.getFullYear() - 5);
            setPicker((current) => (current === "year" ? "calendar" : "year"));
          }}
          className={`rounded-md px-2.5 py-1.5 ${picker === "year" ? "bg-blue-50" : "bg-ink-50"}`}
        >
          <Text className="text-xs font-semibold text-ink-900">{cursor.getFullYear()}</Text>
        </Pressable>
      </View>
      {picker === "month" ? (
        <View className="mt-2 flex-row flex-wrap gap-1">
          {MONTHS.map((month, index) => (
            <Pressable
              key={month}
              accessibilityRole="button"
              onPress={() => {
                setCursor(new Date(cursor.getFullYear(), index, 1));
                setPicker("calendar");
              }}
              className={`w-[30%] rounded-md px-1 py-2 ${cursor.getMonth() === index ? "bg-blue-600" : "bg-ink-50"}`}
            >
              <Text className={`text-center text-xs font-medium ${cursor.getMonth() === index ? "text-white" : "text-ink-800"}`}>{month.slice(0, 3)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {picker === "year" ? (
        <View className="mt-2">
          <View className="mb-1 flex-row items-center justify-between">
            <Pressable accessibilityRole="button" accessibilityLabel="Earlier years" onPress={() => setYearPage((year) => year - 12)} className="rounded-md p-1.5">
              <Ionicons name="chevron-back" size={16} color="#1e3a5f" />
            </Pressable>
            <Text className="text-xs font-semibold text-ink-800">{yearPage} – {yearPage + 11}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Later years" onPress={() => setYearPage((year) => year + 12)} className="rounded-md p-1.5">
              <Ionicons name="chevron-forward" size={16} color="#1e3a5f" />
            </Pressable>
          </View>
          <View className="flex-row flex-wrap gap-1">
            {Array.from({ length: 12 }, (_, index) => yearPage + index).map((year) => (
              <Pressable
                key={year}
                accessibilityRole="button"
                onPress={() => {
                  setCursor(new Date(year, cursor.getMonth(), 1));
                  setPicker(birthDate ? "month" : "calendar");
                }}
                className={`w-[30%] rounded-md px-1 py-2 ${cursor.getFullYear() === year ? "bg-blue-600" : "bg-ink-50"}`}
              >
                <Text className={`text-center text-xs font-medium ${cursor.getFullYear() === year ? "text-white" : "text-ink-800"}`}>{year}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );

  const calendar = (
    <View className="rounded-lg bg-white px-1 py-1">
      {monthYearPicker}
      {picker === "calendar" ? <Calendar
        style={{ width: phone ? undefined : DESKTOP_CALENDAR_SIZE.width }}
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
          <View className="h-9 w-9 items-center justify-center rounded-full bg-ink-50">
            <Ionicons name={direction === "left" ? "chevron-back" : "chevron-forward"} size={18} color="#1e3a5f" />
          </View>
        )}
        renderHeader={() => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose month and year"
            onPress={() => setPicker("month")}
            className="flex-row items-center gap-1 rounded-full px-3 py-1.5 active:bg-ink-50"
          >
            <Text style={{ fontFamily: "Inter_700Bold", fontSize: 16, color: "#102a43" }}>
              {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
            </Text>
            <Ionicons name="chevron-down" size={15} color="#52667d" />
          </Pressable>
        )}
        theme={{
          textDayFontFamily: "Inter_500Medium",
          textMonthFontFamily: "Inter_700Bold",
          textDayHeaderFontFamily: "Inter_600SemiBold",
          calendarBackground: "#ffffff",
          textSectionTitleColor: "#52667d",
          selectedDayBackgroundColor: "#2456d6",
          selectedDayTextColor: "#ffffff",
          todayTextColor: "#2456d6",
          dayTextColor: "#102a43",
          monthTextColor: "#102a43",
          textDisabledColor: "#9aa7b7",
          arrowColor: "#1e3a5f",
          textDayFontSize: phone ? 15 : 13,
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
              width: phone ? 40 : 30,
              height: phone ? 40 : 30,
              alignItems: "center",
              justifyContent: "center",
            },
            selected: {
              borderRadius: phone ? 20 : 15,
            },
            // Today: outlined ring (Material-style), selected day stays solid blue.
            today: {
              borderRadius: phone ? 20 : 15,
              borderWidth: 1.5,
              borderColor: "#2456d6",
            },
          },
        } as CalendarTheme}
      /> : null}
    </View>
  );

  function toggle() {
    if (birthDate && !value) {
      const year = new Date().getFullYear() - 6;
      setCursor(new Date(year, 0, 1));
      setYearPage(year - 5);
      setPicker("year");
      setOpen((v) => !v);
      return;
    }
    setCursor(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setPicker("calendar");
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
          <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
            <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setOpen(false)}>
              <Pressable className="w-full rounded-t-3xl bg-white pb-6" onPress={() => {}}>
                <View className="items-center pt-2.5">
                  <View className="h-1 w-10 rounded-full bg-ink-200" />
                </View>
                <View className="flex-row items-end justify-between px-6 pb-2 pt-3">
                  <View>
                    <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Select date</Text>
                    <Text className="mt-1 text-[26px] font-bold text-ink-900">
                      {value ? `${WEEKDAY_LONG[selected.getDay()].slice(0, 3)}, ${prettyDay(value, false)}` : "—"}
                    </Text>
                  </View>
                  <Pressable accessibilityRole="button" onPress={() => setOpen(false)} hitSlop={8} className="pb-1.5">
                    <Text className="text-sm font-semibold text-[#2456d6]">Cancel</Text>
                  </Pressable>
                </View>
                {quickPicks.length && !birthDate ? (
                  <View className="flex-row gap-2 px-6 pb-1">
                    {quickPicks.map((pick) => (
                      <Pressable
                        key={pick.label}
                        onPress={() => {
                          onChange(pick.value);
                          setOpen(false);
                        }}
                        className={`rounded-full border px-3.5 py-1.5 ${value === pick.value ? "border-[#2456d6] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                      >
                        <Text className={`text-xs font-semibold ${value === pick.value ? "text-[#2456d6]" : "text-ink-800"}`}>{pick.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <View className="px-3">{calendar}</View>
                {closedReason ? (
                  <View className="flex-row items-center gap-4 px-6 pt-1">
                    <View className="flex-row items-center gap-1.5">
                      <View className="h-3 w-3 rounded-full border-[1.5px] border-[#2456d6]" />
                      <Text className="text-[11px] text-ink-700">Today</Text>
                    </View>
                    <View className="flex-row items-center gap-1.5">
                      <Text className="text-[13px] font-medium text-[#9aa7b7]">12</Text>
                      <Text className="text-[11px] text-ink-700">Holiday / weekly off</Text>
                    </View>
                  </View>
                ) : null}
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

export function MonthField({
  value,
  onChange,
  placeholder = "Pick a month",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const valid = /^\d{4}-\d{2}$/.test(value);
  const selected = valid ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1) : new Date();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const label = valid ? selected.toLocaleString("en-IN", { month: "long", year: "numeric" }) : placeholder;
  const selectedDate = valid ? `${value}-01` : "";

  function toggle() {
    setCursor(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setOpen((current) => !current);
  }

  const calendar = (
    <View className="rounded-lg bg-white px-1 py-1">
      <Calendar
        style={{ width: DESKTOP_CALENDAR_SIZE.width }}
        current={toYmd(cursor)}
        hideExtraDays
        markedDates={selectedDate ? { [selectedDate]: { selected: true, selectedColor: "#2456d6", selectedTextColor: "#ffffff" } } : {}}
        onMonthChange={(date: DateData) => setCursor(new Date(date.year, date.month - 1, 1))}
        onDayPress={(date: DateData) => {
          onChange(date.dateString.slice(0, 7));
          setOpen(false);
        }}
        renderArrow={(direction: "left" | "right") => (
          <View className="h-7 w-7 items-center justify-center rounded-full bg-ink-50">
            <Ionicons name={direction === "left" ? "chevron-back" : "chevron-forward"} size={17} color="#1e3a5f" />
          </View>
        )}
        theme={{
          textDayFontFamily: "Inter_500Medium",
          textMonthFontFamily: "Inter_700Bold",
          textDayHeaderFontFamily: "Inter_600SemiBold",
          calendarBackground: "#ffffff",
          textSectionTitleColor: "#52667d",
          selectedDayBackgroundColor: "#2456d6",
          selectedDayTextColor: "#ffffff",
          todayTextColor: "#2456d6",
          dayTextColor: "#102a43",
          monthTextColor: "#102a43",
          arrowColor: "#1e3a5f",
          textDayFontSize: 13,
          textMonthFontSize: 15,
          textDayHeaderFontSize: 11,
          textDayFontWeight: "500",
          textMonthFontWeight: "700",
        } as CalendarTheme}
      />
    </View>
  );

  const trigger = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={toggle}
      className="min-h-[44px] w-full flex-row items-center gap-2 rounded-md border border-ink-200 bg-white px-3 py-2.5"
    >
      <Text className={`min-w-0 flex-1 text-sm ${valid ? "text-ink-900" : "text-ink-700"}`} numberOfLines={1}>{label}</Text>
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
              <Pressable className="w-full max-w-md rounded-[10px] border border-ink-200 bg-white" onPress={() => {}}>{calendar}</Pressable>
            </Pressable>
          </Modal>
        </>
      ) : (
        <Popover open={open} onClose={() => setOpen(false)} panel={calendar} maxHeight={DESKTOP_CALENDAR_SIZE.height} width={DESKTOP_CALENDAR_SIZE.width} align="end" fixedHeight={DESKTOP_CALENDAR_SIZE.height}>
          {trigger}
        </Popover>
      )}
    </View>
  );
}
