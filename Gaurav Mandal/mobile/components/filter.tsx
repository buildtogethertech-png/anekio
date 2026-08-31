import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Input, Sheet } from "./ui";

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
};

type ActiveFilter = {
  key: string;
  label: string;
  valueLabel: string;
};

function emptyValue(type: FilterType): FilterValue {
  return type === "multi-select" || type === "checkbox" ? [] : "";
}

function isActiveValue(value: FilterValue) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  return typeof value === "string" ? value.trim().length > 0 : false;
}

function clearedValues(filters: FilterConfig[]): FilterValues {
  return Object.fromEntries(filters.map((filter) => [filter.key, emptyValue(filter.type)]));
}

function optionLabel(filter: FilterConfig, id: string) {
  return filter.options?.find((option) => option.id === id)?.label || id;
}

function activeFilters(filters: FilterConfig[], values: FilterValues): ActiveFilter[] {
  return filters.flatMap((filter) => {
    const value = values[filter.key];
    if (!isActiveValue(value)) return [];
    if (Array.isArray(value)) {
      return value.map((id) => ({ key: filter.key, label: filter.label, valueLabel: optionLabel(filter, id) }));
    }
    if (typeof value === "boolean") {
      return [{ key: filter.key, label: filter.label, valueLabel: value ? "Yes" : "No" }];
    }
    return typeof value === "string" ? [{ key: filter.key, label: filter.label, valueLabel: optionLabel(filter, value) }] : [];
  });
}

function withoutActiveValue(filters: FilterConfig[], values: FilterValues, active: ActiveFilter): FilterValues {
  const filter = filters.find((item) => item.key === active.key);
  if (!filter) return values;
  const current = values[active.key];
  if (Array.isArray(current)) {
    const option = filter.options?.find((item) => item.label === active.valueLabel || item.id === active.valueLabel);
    const removeId = option?.id || active.valueLabel;
    return { ...values, [active.key]: current.filter((id) => id !== removeId) };
  }
  return { ...values, [active.key]: emptyValue(filter.type) };
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

function FilterOptionChip({
  filter,
  option,
  active,
  onPress,
}: {
  filter: FilterConfig;
  option: FilterOption;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${filter.label} ${option.label}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={`shrink-0 rounded-md border px-3 py-1.5 ${active ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}
    >
      <Text className={`text-sm ${active ? "text-white" : "text-ink-800"}`} numberOfLines={1}>
        {option.label}
      </Text>
    </Pressable>
  );
}

function FilterGroup({ filter, values, onChange }: { filter: FilterConfig; values: FilterValues; onChange: (values: FilterValues) => void }) {
  const value = values[filter.key];
  const selected = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  if (filter.type === "text") {
    return (
      <View className="gap-1.5">
        <Text className="text-xs font-medium text-ink-700">{filter.label}</Text>
        <Input
          placeholder={filter.placeholder || filter.label}
          value={typeof value === "string" ? value : ""}
          onChangeText={(text) => onChange({ ...values, [filter.key]: text })}
        />
      </View>
    );
  }
  if (!filter.options?.length) return null;
  return (
    <View className="gap-2">
      <Text className="text-xs font-medium text-ink-700">{filter.label}</Text>
      <View className="flex-row flex-wrap gap-1.5">
        {filter.options.map((option) => (
          <FilterOptionChip
            key={option.id}
            filter={filter}
            option={option}
            active={selected.includes(option.id)}
            onPress={() => onChange(toggleDraftValue(filter, values, option.id))}
          />
        ))}
      </View>
    </View>
  );
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search",
  filters,
  values,
  onApply,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters: FilterConfig[];
  values: FilterValues;
  onApply: (values: FilterValues) => void;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterValues>(values);
  const chips = useMemo(() => activeFilters(filters, values), [filters, values]);
  const activeCount = chips.length;

  useEffect(() => {
    if (open) setDraft(values);
  }, [open, values]);

  function clearAll() {
    const next = clearedValues(filters);
    setDraft(next);
    onApply(next);
    setOpen(false);
  }

  function removeChip(chip: ActiveFilter) {
    onApply(withoutActiveValue(filters, values, chip));
  }

  const panel = (
    <View className="gap-4">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-base font-semibold text-ink-900">Filter</Text>
        {activeCount ? (
          <Text className="text-xs font-medium text-clay-600">{activeCount} active</Text>
        ) : null}
      </View>
      <View className="h-px bg-ink-100" />
      <View className="gap-4">
        {filters.map((filter) => (
          <FilterGroup key={filter.key} filter={filter} values={draft} onChange={setDraft} />
        ))}
      </View>
      <View className="h-px bg-ink-100" />
      <View className="flex-row items-center justify-between gap-3">
        <Pressable accessibilityRole="button" accessibilityLabel="Clear all filters" onPress={clearAll} className="min-h-[40px] justify-center rounded-md px-1">
          <Text className="text-sm font-medium text-ink-800">Clear all</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Apply filters"
          onPress={() => {
            onApply(draft);
            setOpen(false);
          }}
          className="min-h-[40px] min-w-[96px] items-center justify-center rounded-md bg-clay-500 px-4"
        >
          <Text className="text-sm font-medium text-white">Apply</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View className="gap-2">
      <View className="z-20 flex-row items-center gap-2">
        <View className="min-w-0 flex-1">
          <Input placeholder={searchPlaceholder} value={searchValue} onChangeText={onSearchChange} className="border-ink-100 bg-ink-50" />
        </View>
        <View className="shrink-0">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={activeCount ? `Filter, ${activeCount} active` : "Filter"}
            onPress={() => setOpen((on) => !on)}
            className={`h-[42px] min-w-[92px] flex-row items-center justify-center gap-1.5 rounded-md border px-3 ${
              activeCount ? "border-clay-200 bg-blue-50" : "border-ink-100 bg-white"
            }`}
          >
            <Ionicons name="filter-outline" size={15} color={activeCount ? "#1d4ed8" : "#3d4f66"} />
            <Text className={`text-xs font-medium ${activeCount ? "text-clay-600" : "text-ink-900"}`}>Filter</Text>
            {activeCount ? <Text className="text-xs font-semibold text-clay-600">{activeCount}</Text> : null}
          </Pressable>
        </View>
      </View>
      {wide && open ? (
        <View className="z-50 items-end">
          <View className="w-80 rounded-md border border-ink-200 bg-white p-4 shadow-lg">
            {panel}
          </View>
        </View>
      ) : null}
      {chips.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="grow-0">
          <View className="flex-row items-center gap-1.5 pr-1">
            {chips.map((chip) => (
              <Pressable
                key={`${chip.key}:${chip.valueLabel}`}
                accessibilityRole="button"
                accessibilityLabel={`Remove filter ${chip.label}: ${chip.valueLabel}`}
                onPress={() => removeChip(chip)}
                className="h-8 flex-row items-center gap-1.5 rounded-md border border-clay-200 bg-blue-50 px-2.5"
              >
                <Text className="text-xs font-medium text-clay-600">{chip.label}: {chip.valueLabel}</Text>
                <Ionicons name="close" size={14} color="#1d4ed8" />
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel="Clear all filters" onPress={clearAll} className="h-8 justify-center rounded-md px-2">
              <Text className="text-xs font-medium text-ink-700">Clear all</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : null}
      <Sheet open={!wide && open} onClose={() => setOpen(false)}>
        <View className="px-5 pb-4">{panel}</View>
      </Sheet>
    </View>
  );
}
