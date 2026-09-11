import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { usePathname, useRouter } from "expo-router";
import { featureSearchHits } from "../lib/feature-search";
import { iconForNav, type IoniconName } from "../lib/nav-icons";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";

type SearchHit = {
  id: string;
  key?: string;
  label: string;
  hint: string;
  href: string;
  score?: number;
};

export function AppSearch() {
  const { data } = useRecord();
  const { nav } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const input = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const q = query.trim().toLowerCase();
  const hits = useMemo(() => {
    if (q.length < 2) return [] as SearchHit[];
    const features = featureSearchHits(nav, q, 6);
    const people = (data?.people || [])
      .filter((p) => p.name.toLowerCase().includes(q) || (p.admissionNo || "").toLowerCase().includes(q))
      .slice(0, 5)
      .map((p) => ({ id: `p:${p.id}`, label: p.name, hint: p.classLabel, href: "/people" }));
    const exams = (data?.examPack?.series || [])
      .flatMap((s) => s.exams.map((e) => ({ series: s.name, exam: e })))
      .filter(({ exam, series }) => exam.subject.name.toLowerCase().includes(q) || series.toLowerCase().includes(q))
      .slice(0, 5)
      .map(({ exam, series }) => ({
        id: `e:${exam.id}`,
        label: exam.subject.name,
        hint: series,
        href: `/exams?examId=${exam.id}`,
      }));
    return [...features, ...people, ...exams].slice(0, 8);
  }, [data?.examPack?.series, data?.people, nav, q]);

  useEffect(() => {
    setSelected(0);
  }, [q]);

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

  function go(hit: SearchHit) {
    setQuery("");
    setOpen(false);
    const current = pathname || "/";
    const nextPath = hit.href.split("?")[0] || "/";
    if (hit.href.includes("?") || nextPath !== current) router.push(hit.href as never);
  }

  return (
    <View className="relative min-w-[280px] max-w-[560px]">
      <View
        className={`anekio-search h-11 flex-row items-center gap-2 rounded-xl border px-3 ${
          open ? "border-clay-300 bg-white" : "border-ink-200 bg-ink-50"
        }`}
        style={
          open
            ? {
                shadowColor: "#2563eb",
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.12,
                shadowRadius: 10,
              }
            : undefined
        }
      >
        <Ionicons name="search-outline" size={17} color={open ? "#2563EB" : "#94A3B8"} />
        <TextInput
          ref={input}
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          onSubmitEditing={() => {
            const hit = hits[selected] || hits[0];
            if (hit) go(hit);
          }}
          onKeyPress={(event) => {
            if (Platform.OS !== "web" || !hits.length) return;
            const key = event.nativeEvent.key;
            if (key === "ArrowDown") {
              setOpen(true);
              setSelected((index) => Math.min(index + 1, hits.length - 1));
            } else if (key === "ArrowUp") {
              setOpen(true);
              setSelected((index) => Math.max(index - 1, 0));
            }
          }}
          placeholder="Search features, students, exams..."
          placeholderTextColor="#94A3B8"
          className="min-w-0 flex-1 py-0 text-[14px] text-ink-900"
          style={Platform.OS === "web" ? ({ outlineStyle: "none" } as never) : undefined}
        />
        <View className="rounded-md border border-ink-200 bg-white px-2 py-1">
          <Text className="text-[10px] font-semibold text-ink-500">Ctrl K</Text>
        </View>
      </View>
      {open && q.length >= 2 ? (
        <View
          className="absolute left-0 right-0 top-[50px] z-50 overflow-hidden rounded-xl border border-ink-200 bg-white"
          style={{
            elevation: 16,
            shadowColor: "#0f172a",
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.14,
            shadowRadius: 24,
          }}
        >
          {hits.length ? (
            <View className="border-b border-ink-100 bg-ink-50 px-3 py-2">
              <Text className="text-[11px] font-semibold uppercase text-ink-500">Search results</Text>
            </View>
          ) : null}
          {hits.map((hit, index) => (
            <Pressable
              key={hit.id}
              onPress={() => go(hit)}
              onHoverIn={() => setSelected(index)}
              className={`flex-row items-center gap-3 px-3 py-3 ${index === selected ? "bg-[#EEF4FF]" : "bg-white"}`}
            >
              <View className={`h-9 w-9 items-center justify-center rounded-lg ${index === selected ? "bg-white" : "bg-ink-50"}`}>
                <Ionicons name={iconForHit(hit)} size={18} color={index === selected ? "#2563EB" : "#1E3A5F"} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[13px] font-semibold text-ink-900" numberOfLines={1}>
                  {hit.label}
                </Text>
                <Text className="text-[11px] text-ink-600" numberOfLines={1}>
                  {hit.hint}
                </Text>
              </View>
              <Ionicons name="return-down-forward-outline" size={16} color="#94A3B8" />
            </Pressable>
          ))}
          {!hits.length ? (
            <View className="items-center gap-1 px-4 py-6">
              <Ionicons name="search-outline" size={20} color="#94A3B8" />
              <Text className="text-[13px] font-semibold text-ink-900">No feature found</Text>
              <Text className="text-center text-[11px] text-ink-600">Try fees, exams, students, admissions, notices, or routine.</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function iconForHit(hit: SearchHit): IoniconName {
  if (hit.key) return iconForNav(hit.key);
  if (hit.id.startsWith("p:")) return "person-outline";
  if (hit.id.startsWith("e:")) return "document-text-outline";
  return "search-outline";
}
