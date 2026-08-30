import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Field } from "../ui";
import { Popover } from "./popover";

export type SelectOption = {
  id: string;
  label: string;
  searchText?: string;
};

export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = "Pick",
  className,
}: {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = options.find((o) => o.id === value)?.label || placeholder;

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => (o.searchText || o.label).toLowerCase().includes(q));
  }, [options, query]);

  const control = (
    <View className={className || ""}>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        panel={
          <View>
            {options.length > 6 ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor="#3d4f66"
                autoFocus
                className="border-b border-ink-100 px-3 py-2.5 text-sm text-ink-900"
              />
            ) : null}
            <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 220 }}>
              {filtered.length ? (
                filtered.map((o) => {
                  const selected = o.id === value;
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => {
                        onChange(o.id);
                        setOpen(false);
                      }}
                      className={`flex-row items-center justify-between gap-2 px-3 py-2.5 ${
                        selected ? "bg-blue-50" : ""
                      }`}
                    >
                      <Text className={`min-w-0 flex-1 text-sm ${selected ? "font-medium text-ink-900" : "text-ink-900"}`}>
                        {o.label}
                      </Text>
                      {selected ? <Ionicons name="checkmark" size={16} color="#1e3a5f" /> : null}
                    </Pressable>
                  );
                })
              ) : (
                <Text className="px-3 py-2.5 text-sm text-ink-700">No matches</Text>
              )}
            </ScrollView>
          </View>
        }
      >
        <Pressable
          onPress={() => setOpen((v) => !v)}
          className="flex-row items-center justify-between gap-2 rounded-md border border-ink-200 bg-white px-3 py-2.5"
        >
          <Text className={`min-w-0 flex-1 text-sm ${value ? "text-ink-900" : "text-ink-700"}`} numberOfLines={1}>
            {current}
          </Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color="#3d4f66" />
        </Pressable>
      </Popover>
    </View>
  );

  if (!label) return control;

  return (
    <Field label={label}>
      {control}
    </Field>
  );
}
