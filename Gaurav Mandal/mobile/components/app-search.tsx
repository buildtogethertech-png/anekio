import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { usePathname, useRouter } from "expo-router";
import { useRecord } from "../lib/record";

export function AppSearch() {
  const { data } = useRecord();
  const router = useRouter();
  const pathname = usePathname();
  const input = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const hits = useMemo(() => {
    if (q.length < 2) return [];
    const people = (data?.people || [])
      .filter((p) => p.name.toLowerCase().includes(q) || (p.admissionNo || "").toLowerCase().includes(q))
      .slice(0, 5)
      .map((p) => ({ id: `p:${p.id}`, label: p.name, hint: p.classLabel, href: "/people" as const }));
    const exams = (data?.examPack?.series || [])
      .flatMap((s) => s.exams.map((e) => ({ series: s.name, exam: e })))
      .filter(({ exam, series }) => exam.subject.name.toLowerCase().includes(q) || series.toLowerCase().includes(q))
      .slice(0, 5)
      .map(({ exam, series }) => ({
        id: `e:${exam.id}`,
        label: exam.subject.name,
        hint: series,
        href: `/exams?examId=${exam.id}` as const,
      }));
    return [...people, ...exams].slice(0, 8);
  }, [data?.examPack?.series, data?.people, q]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <View className="relative min-w-0 max-w-[420px] flex-1">
      <View className="anekio-search flex-row items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2">
        <Ionicons name="search-outline" size={16} color="#94A3B8" />
        <TextInput
          ref={input}
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          placeholder="Search students, exams, etc..."
          placeholderTextColor="#94A3B8"
          className="min-w-0 flex-1 py-0 text-[13px] text-ink-900"
        />
        <View className="rounded-md border border-ink-200 bg-ink-50 px-1.5 py-0.5">
          <Text className="text-[10px] font-medium text-ink-700">Ctrl K</Text>
        </View>
      </View>
      {open && hits.length ? (
        <View className="absolute left-0 right-0 top-11 z-20 overflow-hidden rounded-xl border border-ink-200 bg-white">
          {hits.map((hit) => (
            <Pressable
              key={hit.id}
              onPress={() => {
                setQuery("");
                setOpen(false);
                if (hit.href !== pathname) router.push(hit.href as never);
              }}
              className="px-3 py-2.5"
            >
              <Text className="text-[13px] font-medium text-ink-900">{hit.label}</Text>
              <Text className="text-[11px] text-ink-700">{hit.hint}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
