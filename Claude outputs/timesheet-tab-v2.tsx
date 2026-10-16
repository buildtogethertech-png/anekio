import { Pressable, ScrollView, Text, View } from "react-native";

/**
 * Phone-first Timesheet tab (standalone draft).
 *
 * Changes from the current screen:
 * - One month control (the header's), not two.
 * - Bigger day headers; today's column is highlighted.
 * - "Off" is a pill, a dash is a plain dot, so the two are never confused.
 * - Whole row is the tap target for editing; the "Edit" chips are gone.
 * - Instructions are readable and sit above the grid.
 * - Bottom padding keeps the last row clear of the floating rocket button.
 */

export type TimesheetDay = { day: number; letter: string; isToday?: boolean; isWeekend?: boolean };
export type TimesheetMark = "P" | "L" | "A" | "OFF" | null;
export type TimesheetRow = { id: string; name: string; sub?: string; marks: Record<number, TimesheetMark> };

export type TimesheetTabProps = {
  monthLabel: string; // "October 2026"
  days: TimesheetDay[];
  rows: TimesheetRow[];
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onOpenCell: (rowId: string, day: number) => void;
  bottomInset?: number; // space for the floating rocket button, default 96
};

const MARK_STYLE: Record<Exclude<TimesheetMark, null>, { text: string; fg: string; bg: string; label: string }> = {
  P: { text: "P", fg: "#047857", bg: "#ECFDF5", label: "Present" },
  L: { text: "L", fg: "#1F45C7", bg: "#EEF3FF", label: "Leave" },
  A: { text: "A", fg: "#b91c1c", bg: "#FEF2F2", label: "Absent" },
  OFF: { text: "Off", fg: "#64748b", bg: "#F1F5F9", label: "Weekly off" },
};

export function TimesheetTab(p: TimesheetTabProps) {
  return (
    <View className="flex-1 px-4">
      {/* Single month control */}
      <View className="flex-row items-center justify-between py-3">
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={10} onPress={p.onPrevMonth} className="h-10 w-10 items-center justify-center rounded-full bg-slate-100">
          <Text className="text-[18px] text-slate-700">‹</Text>
        </Pressable>
        <Text className="text-[16px] font-semibold text-slate-900">{p.monthLabel}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" hitSlop={10} onPress={p.onNextMonth} className="h-10 w-10 items-center justify-center rounded-full bg-slate-100">
          <Text className="text-[18px] text-slate-700">›</Text>
        </Pressable>
      </View>

      <Text className="pb-3 text-[13px] leading-5 text-slate-600">
        Tap a day to mark Present (P), Leave (L), Absent (A) or Off. Changes save when you tap Save.
      </Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {/* Day headers */}
          <View className="flex-row items-end border-b border-slate-200 pb-2">
            <View className="w-[120px] pr-2">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Teacher</Text>
            </View>
            {p.days.map((d) => (
              <View key={d.day} className={`w-11 items-center rounded-lg py-1 ${d.isToday ? "bg-[#EEF3FF]" : ""}`}>
                <Text className={`text-[11px] ${d.isWeekend ? "text-slate-400" : "text-slate-500"}`}>{d.letter}</Text>
                <Text className={`text-[15px] font-semibold ${d.isToday ? "text-[#1F45C7]" : "text-slate-900"}`}>{d.day}</Text>
              </View>
            ))}
          </View>

          {/* Rows: whole row is a unit; tap a cell to edit */}
          {p.rows.map((r) => (
            <View key={r.id} className="flex-row items-center border-b border-slate-100 py-3">
              <View className="w-[120px] pr-2">
                <Text className="text-[14px] font-semibold text-slate-900" numberOfLines={1}>{r.name}</Text>
                {r.sub ? <Text className="text-[12px] text-slate-500" numberOfLines={1}>{r.sub}</Text> : null}
              </View>
              {p.days.map((d) => {
                const m = r.marks[d.day] ?? null;
                const style = m ? MARK_STYLE[m] : null;
                return (
                  <Pressable
                    key={d.day}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.name}, day ${d.day}, ${style ? style.label : "not marked"}`}
                    onPress={() => p.onOpenCell(r.id, d.day)}
                    className={`h-9 w-11 items-center justify-center ${d.isToday ? "bg-[#F8FAFF]" : ""}`}
                  >
                    {style ? (
                      <View className="h-7 min-w-[30px] items-center justify-center rounded-full px-1.5" style={{ backgroundColor: style.bg }}>
                        <Text className="text-[12px] font-semibold" style={{ color: style.fg }}>{style.text}</Text>
                      </View>
                    ) : (
                      <View className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Legend */}
      <View className="mt-4 flex-row flex-wrap gap-x-4 gap-y-2">
        {(Object.keys(MARK_STYLE) as Exclude<TimesheetMark, null>[]).map((k) => (
          <View key={k} className="flex-row items-center gap-2">
            <View className="h-4 w-4 items-center justify-center rounded-full" style={{ backgroundColor: MARK_STYLE[k].bg }} />
            <Text className="text-[12px] text-slate-600">{MARK_STYLE[k].label}</Text>
          </View>
        ))}
      </View>

      <View style={{ height: p.bottomInset ?? 96 }} />
    </View>
  );
}
