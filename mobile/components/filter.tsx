import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal as RnModal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Sheet } from "./ui";

export type FilterOption = {
  id: string;
  label: string;
};

export type FilterValue = string | string[] | boolean | null | undefined;

export type FilterValues = Record<string, FilterValue>;

export type FilterType =
  | "single-select"
  | "multi-select"
  | "search-select"
  | "date"
  | "date-range"
  | "number-range"
  | "boolean"
  | "status"
  | "checkbox"
  | "radio"
  | "text";

export type FilterConfig = {
  key: string;
  label: string;
  type: FilterType;
  options?: FilterOption[];
  placeholder?: string;
  /** What "cleared" means for this filter (e.g. Students = Current). Equal to it: no chip. */
  defaultValue?: FilterValue;
};

function emptyValue(type: FilterType): FilterValue {
  return type === "multi-select" || type === "checkbox" ? [] : "";
}

function isActiveValue(value: FilterValue) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  return typeof value === "string" ? value.trim().length > 0 : false;
}

function resetValue(filter: FilterConfig): FilterValue {
  return filter.defaultValue ?? emptyValue(filter.type);
}

function sameValue(a: FilterValue, b: FilterValue) {
  const norm = (v: FilterValue) => (Array.isArray(v) ? [...v].sort().join("\u0001") : v ?? "");
  return norm(a) === norm(b);
}

/** Set to something other than its default (a filter without a default: anything picked). */
function isChanged(filter: FilterConfig, value: FilterValue) {
  return filter.defaultValue !== undefined ? !sameValue(value, filter.defaultValue) : isActiveValue(value);
}

function clearedValues(filters: FilterConfig[]): FilterValues {
  return Object.fromEntries(filters.map((filter) => [filter.key, resetValue(filter)]));
}

function optionLabel(filter: FilterConfig, id: string) {
  return filter.options?.find((option) => option.id === id)?.label || id;
}

function toggleDraftValue(filter: FilterConfig, values: FilterValues, id: string): FilterValues {
  const current = values[filter.key];
  if (filter.type === "multi-select" || filter.type === "checkbox") {
    const selected = Array.isArray(current) ? current : [];
    return {
      ...values,
      [filter.key]: selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id],
    };
  }
  return { ...values, [filter.key]: current === id ? emptyValue(filter.type) : id };
}

function valueText(filter: FilterConfig, value: FilterValue) {
  if (!isActiveValue(value)) return "";
  const labels = Array.isArray(value)
    ? value.map((id) => optionLabel(filter, id).replace(/ · \d+$/, ""))
    : typeof value === "boolean"
      ? [value ? "Yes" : "No"]
      : [optionLabel(filter, String(value)).replace(/ · \d+$/, "")];
  return labels.length > 3 ? `${labels.slice(0, 2).join(", ")} +${labels.length - 2}` : labels.join(", ");
}

/** One filter chip per filter ("Class: 1-A, 2-B"), so many picked values stay one tidy chip. */
function groupedChips(filters: FilterConfig[], values: FilterValues) {
  return filters.flatMap((filter) => {
    const value = values[filter.key];
    if (!isActiveValue(value) || !isChanged(filter, value)) return [];
    return [{ key: filter.key, label: filter.label, text: valueText(filter, value) }];
  });
}

/** The search field used with filters: icon, text, and a clear button once something is typed. */
export function SearchBox({ value, onChange, placeholder = "Search" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <View className="h-10 flex-row items-center gap-2 rounded-lg border border-ink-200 bg-white px-3">
      <Ionicons name="search" size={15} color="#94a3b8" />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor="#A3AEC2"
        value={value}
        onChangeText={onChange}
        accessibilityLabel={placeholder}
        className="h-full min-w-0 flex-1 text-[13px] text-ink-900"
        style={Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => onChange("")}>
          <Ionicons name="close-circle" size={16} color="#94a3b8" />
        </Pressable>
      ) : null}
    </View>
  );
}

const FILTER_ICONS: Partial<Record<FilterType, keyof typeof Ionicons.glyphMap>> = {
  "multi-select": "list-outline",
  checkbox: "list-outline",
  "single-select": "radio-button-on-outline",
  radio: "radio-button-on-outline",
  status: "ellipse-outline",
  text: "text-outline",
  boolean: "toggle-outline",
};

/** One filter's choices: a tick list (search box when long) or a text field. Changes apply at once. */
function FilterOptions({ filter, values, onApply }: { filter: FilterConfig; values: FilterValues; onApply: (values: FilterValues) => void }) {
  const value = values[filter.key];
  const multi = filter.type === "multi-select" || filter.type === "checkbox";
  const selected = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
  const [find, setFind] = useState("");
  const [text, setText] = useState(typeof value === "string" ? value : "");
  if (filter.type === "text") {
    return (
      <View className="gap-2 p-3">
        <SearchBox
          value={text}
          onChange={(t) => {
            setText(t);
            onApply({ ...values, [filter.key]: t });
          }}
          placeholder={filter.placeholder || filter.label}
        />
      </View>
    );
  }
  const options = filter.options ?? [];
  const needle = find.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  return (
    <View>
      {options.length > 8 ? (
        <View className="border-b border-ink-100 p-2">
          <SearchBox value={find} onChange={setFind} placeholder={`Find ${filter.label.toLowerCase()}`} />
        </View>
      ) : null}
      <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
        <View className="p-1.5">
          {shown.map((option) => {
            const on = selected.includes(option.id);
            return (
              <Pressable
                key={option.id}
                accessibilityRole={multi ? "checkbox" : "radio"}
                accessibilityState={{ checked: on }}
                accessibilityLabel={option.label}
                onPress={() => onApply(toggleDraftValue(filter, values, option.id))}
                className={`h-9 flex-row items-center gap-2.5 rounded-md px-2.5 hover:bg-ink-50 ${on ? "bg-[#F1F5FF]" : ""}`}
              >
                {multi ? (
                  <View className={`h-4 w-4 items-center justify-center rounded-[4px] border ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-300 bg-white"}`}>
                    {on ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
                  </View>
                ) : (
                  <View className={`h-4 w-4 items-center justify-center rounded-full border ${on ? "border-[#1F45C7]" : "border-ink-300"}`}>
                    {on ? <View className="h-2 w-2 rounded-full bg-[#1F45C7]" /> : null}
                  </View>
                )}
                <Text className={`min-w-0 flex-1 text-[13px] ${on ? "font-semibold text-ink-900" : "text-ink-800"}`} numberOfLines={1}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
          {!shown.length ? <Text className="px-2.5 py-3 text-[13px] text-ink-500">Nothing matches.</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search",
  hideSearch = false,
  besideButton,
  filters,
  values,
  onApply,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  hideSearch?: boolean;
  /** Without search: shown right after the Filter button, before the chips (which then take the rest of the row). */
  besideButton?: ReactNode;
  filters: FilterConfig[];
  values: FilterValues;
  onApply: (values: FilterValues) => void;
}) {
  const { width, height } = useWindowDimensions();
  const wide = width >= 768;
  // null: closed. "": the list of filters. A key: that filter's choices.
  const [open, setOpen] = useState<string | null>(null);
  const [frame, setFrame] = useState({ left: 16, top: 64 });
  const buttonRef = useRef<View>(null);
  const chipRefs = useRef(new Map<string, View | null>());
  const chips = useMemo(() => groupedChips(filters, values), [filters, values]);
  const activeCount = chips.length;
  const PANEL_W = 300;
  const current = open ? filters.find((f) => f.key === open) : undefined;

  function openAt(anchor: View | null | undefined, which: string) {
    if (wide && anchor) {
      anchor.measureInWindow((x, y, _w, h) => {
        setFrame({ left: Math.min(Math.max(12, x), width - PANEL_W - 12), top: y + (h || 36) + 6 });
        setOpen(which);
      });
    } else setOpen(which);
  }

  function clearOne(key: string) {
    const f = filters.find((x) => x.key === key);
    if (f) onApply({ ...values, [key]: resetValue(f) });
  }

  const menu = (
    <View className="p-1.5">
      {filters.map((f) => {
        const chip = chips.find((c) => c.key === f.key);
        return (
          <Pressable
            key={f.key}
            accessibilityRole="button"
            accessibilityLabel={`Filter by ${f.label}`}
            onPress={() => setOpen(f.key)}
            className="h-10 flex-row items-center gap-2.5 rounded-md px-2.5 hover:bg-ink-50"
          >
            <Ionicons name={f.key === "group" ? "people-outline" : FILTER_ICONS[f.type] || "funnel-outline"} size={15} color="#64748b" />
            <Text className="text-[13px] font-medium text-ink-900">{f.label}</Text>
            <Text className="min-w-0 flex-1 text-right text-[12px] text-[#1F45C7]" numberOfLines={1}>
              {chip?.text || valueText(f, values[f.key])}
            </Text>
            <Ionicons name="chevron-forward" size={14} color="#94a3b8" />
          </Pressable>
        );
      })}
    </View>
  );

  const panelHead = current ? (
    <View className="h-11 flex-row items-center gap-1 border-b border-ink-100 px-2">
      <Pressable accessibilityRole="button" accessibilityLabel="Back to filters" hitSlop={6} onPress={() => setOpen("")} className="h-8 w-8 items-center justify-center rounded-md hover:bg-ink-50">
        <Ionicons name="chevron-back" size={16} color="#334155" />
      </Pressable>
      <Text className="min-w-0 flex-1 text-[13px] font-semibold text-ink-900">{current.label}</Text>
      {isChanged(current, values[current.key]) ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${current.label}`} onPress={() => clearOne(current.key)} className="h-8 justify-center px-2">
          <Text className="text-[12px] font-medium text-[#1F45C7]">Clear</Text>
        </Pressable>
      ) : null}
    </View>
  ) : (
    <View className="h-11 flex-row items-center justify-between border-b border-ink-100 px-3.5">
      <Text className="text-[13px] font-semibold text-ink-900">Filter by</Text>
      {activeCount ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear all filters"
          onPress={() => onApply(clearedValues(filters))}
          className="h-8 justify-center"
        >
          <Text className="text-[12px] font-medium text-[#1F45C7]">Clear all</Text>
        </Pressable>
      ) : null}
    </View>
  );
  const panelBody = current ? <FilterOptions key={current.key} filter={current} values={values} onApply={onApply} /> : menu;

  const chipList = (
    <>
        {chips.map((chip) => (
        <View
          key={chip.key}
          ref={(r) => {
            chipRefs.current.set(chip.key, r);
          }}
          className="h-8 flex-row items-center overflow-hidden rounded-lg border border-[#C7D5FB] bg-[#EEF3FF]"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit filter ${chip.label}`}
            onPress={() => openAt(chipRefs.current.get(chip.key), chip.key)}
            className="h-full flex-row items-center gap-1 pl-2.5 pr-1.5"
          >
            <Text className="text-[12px] text-[#3B5BD9]">{chip.label}</Text>
            <Text className="text-[12px] font-semibold text-[#1F45C7]" numberOfLines={1}>
              {chip.text}
            </Text>
            <Ionicons name="chevron-down" size={12} color="#1F45C7" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove filter ${chip.label}`}
            onPress={() => clearOne(chip.key)}
            className="h-full justify-center border-l border-[#C7D5FB] px-1.5 hover:bg-[#DCE6FF]"
          >
            <Ionicons name="close" size={13} color="#1F45C7" />
          </Pressable>
        </View>
      ))}
    </>
  );

  return (
    <View className="relative z-20 gap-2">
      <View className={`z-20 flex-row items-center gap-2 ${hideSearch ? "" : "flex-wrap"}`}>
        {hideSearch ? null : (
          <View className="min-w-0 flex-1">
            <SearchBox value={searchValue} onChange={onSearchChange} placeholder={searchPlaceholder} />
          </View>
        )}
        <Pressable
          ref={buttonRef}
          accessibilityRole="button"
          accessibilityLabel={activeCount ? `Filter, ${activeCount} active` : "Filter"}
          onPress={() => openAt(buttonRef.current, "")}
          className="h-10 shrink-0 flex-row items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 hover:bg-ink-50"
        >
          <Ionicons name="filter" size={15} color="#334155" />
          <Text className="text-[13px] font-semibold text-ink-800">Filter</Text>
        </Pressable>
        {hideSearch ? besideButton : null}
        {hideSearch ? (
          // A fixed slot: chips appear here and scroll sideways, so nothing else in the toolbar moves.
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
            <View className="flex-row items-center gap-1.5">{chipList}</View>
          </ScrollView>
        ) : null}
      </View>
      {!hideSearch && chips.length ? <View className="flex-row flex-wrap items-center gap-1.5">{chipList}</View> : null}

      <RnModal visible={wide && open !== null} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable className="flex-1" onPress={() => setOpen(null)}>
          <Pressable
            className="absolute overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl"
            style={{ left: frame.left, top: frame.top, width: PANEL_W, maxHeight: Math.max(280, height - frame.top - 24) }}
            onPress={() => {}}
          >
            {panelHead}
            {panelBody}
          </Pressable>
        </Pressable>
      </RnModal>

      <Sheet open={!wide && open !== null} onClose={() => setOpen(null)}>
        <View className="pb-4">
          {panelHead}
          {panelBody}
          {current ? (
            <View className="px-4 pt-3">
              <Pressable accessibilityRole="button" onPress={() => setOpen(null)} className="h-11 items-center justify-center rounded-lg bg-[#1F45C7]">
                <Text className="text-[14px] font-semibold text-white">Done</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Sheet>
    </View>
  );
}
