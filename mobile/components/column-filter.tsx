import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

/**
 * Students table → column header menu: sort, filter ("Date of birth after 1 Jan 2018", "City is empty",
 * "Mobile starts with 98765", "Class is any of 1-A, 2-A"), hide. Filters on several columns combine with AND.
 */
export type FilterKind = "text" | "phone" | "number" | "date" | "set" | "file";
export type ColumnFilter = { key: string; op: string; a?: string; b?: string; set?: string[] };

const OPS: Record<FilterKind, [string, string][]> = {
  text: [["contains", "contains"], ["is", "is"], ["isNot", "is not"], ["starts", "starts with"], ["empty", "is empty"], ["notEmpty", "is not empty"]],
  phone: [["starts", "starts with"], ["contains", "contains"], ["empty", "is empty"], ["notEmpty", "is not empty"]],
  number: [["eq", "="], ["gt", ">"], ["lt", "<"], ["between", "between"], ["empty", "is empty"]],
  date: [["on", "is on"], ["before", "is before"], ["after", "is after"], ["between", "is between"], ["empty", "is empty"], ["notEmpty", "is not empty"]],
  set: [["anyOf", "is any of"], ["noneOf", "is none of"], ["empty", "is empty"], ["notEmpty", "is not empty"]],
  file: [["has", "uploaded"], ["missing", "not uploaded"]],
};
const NO_VALUE = new Set(["empty", "notEmpty", "has", "missing"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toDate(v: string) {
  const t = String(v || "").trim();
  let r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (r) return `${r[1]}-${r[2].padStart(2, "0")}-${r[3].padStart(2, "0")}`;
  r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (r) return `${r[3]}-${r[2].padStart(2, "0")}-${r[1].padStart(2, "0")}`;
  return "";
}
function niceDate(v: string) {
  const d = toDate(v);
  if (!d) return v;
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}
const digits = (v: string) => String(v || "").replace(/\D/g, "");

/** Does a cell value pass this filter? */
export function matchFilter(f: ColumnFilter, kind: FilterKind, raw: string) {
  const v = String(raw || "").trim();
  if (f.op === "empty" || f.op === "missing") return !v;
  if (f.op === "notEmpty" || f.op === "has") return Boolean(v);
  if (kind === "set") {
    const hit = (f.set ?? []).some((x) => x.toLowerCase() === v.toLowerCase());
    return f.op === "noneOf" ? !hit : hit;
  }
  if (kind === "date") {
    const d = toDate(v), a = toDate(f.a || ""), b = toDate(f.b || "");
    if (!d) return false;
    if (f.op === "on") return d === a;
    if (f.op === "before") return Boolean(a) && d < a;
    if (f.op === "after") return Boolean(a) && d > a;
    if (f.op === "between") return (!a || d >= a) && (!b || d <= b);
    return true;
  }
  if (kind === "number") {
    const n = Number(v), a = Number(f.a), b = Number(f.b);
    if (!v || !Number.isFinite(n)) return false;
    if (f.op === "eq") return n === a;
    if (f.op === "gt") return n > a;
    if (f.op === "lt") return n < a;
    if (f.op === "between") return (!f.a || n >= a) && (!f.b || n <= b);
    return true;
  }
  const hay = kind === "phone" ? digits(v) : v.toLowerCase();
  const needle = kind === "phone" ? digits(f.a || "") : String(f.a || "").trim().toLowerCase();
  if (f.op === "contains") return hay.includes(needle);
  if (f.op === "starts") return hay.startsWith(needle);
  if (f.op === "is") return hay === needle;
  if (f.op === "isNot") return hay !== needle;
  return true;
}

/** "Date of birth after 1 Jan 2018", "City is empty", "Class is any of 1-A, 2-A". */
export function filterLabel(f: ColumnFilter, kind: FilterKind, label: string) {
  const op = OPS[kind].find(([id]) => id === f.op)?.[1] ?? f.op;
  if (NO_VALUE.has(f.op)) return `${label} ${op}`;
  if (kind === "set") {
    const list = f.set ?? [];
    return `${label} ${op} ${list.slice(0, 3).join(", ")}${list.length > 3 ? ` +${list.length - 3}` : ""}`;
  }
  const show = (x?: string) => (kind === "date" ? niceDate(x || "") : x || "");
  if (f.op === "between") return `${label} ${show(f.a) || "…"} – ${show(f.b) || "…"}`;
  return `${label} ${op} ${show(f.a)}`;
}

function valid(f: ColumnFilter, kind: FilterKind) {
  if (NO_VALUE.has(f.op)) return true;
  if (kind === "set") return Boolean(f.set?.length);
  if (kind === "date") return f.op === "between" ? Boolean(toDate(f.a || "") || toDate(f.b || "")) : Boolean(toDate(f.a || ""));
  if (kind === "number") return f.op === "between" ? Boolean(f.a || f.b) : f.a !== undefined && f.a !== "" && Number.isFinite(Number(f.a));
  return Boolean(String(f.a || "").trim());
}

export function ColumnMenu({
  label,
  colKey,
  kind,
  options,
  filter,
  sortDir,
  at,
  onSort,
  onApply,
  onHide,
  onClose,
}: {
  label: string;
  colKey: string;
  kind: FilterKind;
  /** For "set" columns: every value to pick from. */
  options: string[];
  filter?: ColumnFilter;
  sortDir: 1 | -1 | 0;
  at: { top: number; left: number };
  onSort: (dir: 1 | -1 | 0) => void;
  onApply: (f: ColumnFilter | null) => void;
  onHide?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ColumnFilter>(filter ?? { key: colKey, op: OPS[kind][0][0], a: "", b: "", set: [] });
  const [q, setQ] = useState("");
  useEffect(() => {
    setDraft(filter ?? { key: colKey, op: OPS[kind][0][0], a: "", b: "", set: [] });
    setQ("");
  }, [colKey, filter, kind]);

  const needsValue = !NO_VALUE.has(draft.op);
  const ok = valid(draft, kind);
  const shown = options.filter((o) => !q || o.toLowerCase().includes(q.toLowerCase()));
  const input = (key: "a" | "b", placeholder: string) => (
    <TextInput
      value={draft[key] ?? ""}
      onChangeText={(t) => setDraft((d) => ({ ...d, [key]: t }))}
      onSubmitEditing={() => ok && onApply(draft)}
      placeholder={placeholder}
      placeholderTextColor="#A3AEC2"
      keyboardType={kind === "number" || kind === "phone" ? "number-pad" : "default"}
      autoFocus={key === "a"}
      className="h-9 min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-2.5 text-[13px] text-ink-900"
      style={Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined}
    />
  );
  const placeholder = kind === "date" ? "DD/MM/YYYY" : kind === "phone" ? "e.g. 98765" : kind === "number" ? "Number" : "Value";
  const left = Platform.OS === "web" && typeof window !== "undefined" ? Math.max(8, Math.min(at.left, window.innerWidth - 300)) : at.left;

  return (
    <>
      <Pressable accessibilityLabel="Close column menu" onPress={onClose} style={{ position: "fixed" as never, top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }} />
      <View
        style={{ position: "fixed" as never, top: at.top, left, width: 288, zIndex: 1000 }}
        className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl"
      >
        <View className="border-b border-ink-100 p-1.5">
          {([
            [1, "arrow-up", "Sort A → Z"],
            [-1, "arrow-down", "Sort Z → A"],
          ] as const).map(([dir, icon, text]) => (
            <Pressable
              key={dir}
              accessibilityRole="button"
              onPress={() => onSort(sortDir === dir ? 0 : dir)}
              className={`h-8 flex-row items-center gap-2 rounded-md px-2 hover:bg-ink-50 ${sortDir === dir ? "bg-[#EEF3FF]" : ""}`}
            >
              <Ionicons name={icon} size={14} color={sortDir === dir ? "#1F45C7" : "#475569"} />
              <Text className={`text-[13px] ${sortDir === dir ? "font-semibold text-[#1F45C7]" : "text-ink-800"}`}>{text}</Text>
            </Pressable>
          ))}
          {onHide ? (
            <Pressable accessibilityRole="button" onPress={onHide} className="h-8 flex-row items-center gap-2 rounded-md px-2 hover:bg-ink-50">
              <Ionicons name="eye-off-outline" size={14} color="#475569" />
              <Text className="text-[13px] text-ink-800">Hide column</Text>
            </Pressable>
          ) : null}
        </View>

        <View className="gap-2 p-3">
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">{`Filter · ${label}`}</Text>
          <View className="flex-row flex-wrap gap-1">
            {OPS[kind].map(([id, text]) => {
              const on = draft.op === id;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setDraft((d) => ({ ...d, op: id }))}
                  className={`h-7 justify-center rounded-full border px-2.5 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white hover:bg-ink-50"}`}
                >
                  <Text className={`text-[12px] ${on ? "font-semibold text-white" : "text-ink-700"}`}>{text}</Text>
                </Pressable>
              );
            })}
          </View>

          {needsValue && kind === "set" ? (
            <View className="gap-1.5">
              {options.length > 8 ? (
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Search"
                  placeholderTextColor="#A3AEC2"
                  className="h-8 rounded-lg border border-ink-200 bg-white px-2.5 text-[13px] text-ink-900"
                  style={Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined}
                />
              ) : null}
              <ScrollView style={{ maxHeight: 200 }}>
                {shown.map((o) => {
                  const on = (draft.set ?? []).includes(o);
                  return (
                    <Pressable
                      key={o}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      onPress={() => setDraft((d) => ({ ...d, set: on ? (d.set ?? []).filter((x) => x !== o) : [...(d.set ?? []), o] }))}
                      className="h-8 flex-row items-center gap-2 rounded-md px-1 hover:bg-ink-50"
                    >
                      <Ionicons name={on ? "checkbox" : "square-outline"} size={16} color={on ? "#1F45C7" : "#94A3B8"} />
                      <Text className="text-[13px] text-ink-800">{o}</Text>
                    </Pressable>
                  );
                })}
                {!shown.length ? <Text className="px-1 py-2 text-[12px] text-ink-500">No values.</Text> : null}
              </ScrollView>
            </View>
          ) : needsValue ? (
            <View className="flex-row items-center gap-2">
              {input("a", draft.op === "between" ? (kind === "date" ? "From DD/MM/YYYY" : "From") : placeholder)}
              {draft.op === "between" ? input("b", kind === "date" ? "To DD/MM/YYYY" : "To") : null}
            </View>
          ) : null}

          <View className="mt-1 flex-row items-center justify-between">
            {filter ? (
              <Pressable accessibilityRole="button" onPress={() => onApply(null)} hitSlop={6}>
                <Text className="text-[13px] font-semibold text-red-700">Remove filter</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable
              accessibilityRole="button"
              disabled={!ok}
              onPress={() => onApply(draft)}
              className={`h-8 justify-center rounded-lg px-3.5 ${ok ? "bg-[#1F45C7]" : "bg-ink-200"}`}
            >
              <Text className="text-[13px] font-semibold text-white">Apply</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </>
  );
}
