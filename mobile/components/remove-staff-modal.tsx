import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Modal } from "./ui";
import { Select } from "./form";
import { act } from "../lib/mutate";

type Pool = "teacher" | "person";
type Item = { key: string; label: string; detail: string; pool: Pool };
type Section = { key: string; title: string; hint: string; items: Item[] };
type Choice = { id: string; name: string; detail: string };
type Plan = { sections: Section[]; teachers: Choice[]; people: Choice[]; notes: string[] };

/** A subject's exam papers follow the teacher picked for that subject, unless already picked. */
function withFollowers(prev: Record<string, string>, key: string, id: string) {
  const next = { ...prev, [key]: id };
  if (key.startsWith("teach:")) {
    const examKey = `exams:${key.slice("teach:".length)}`;
    if (!prev[examKey]) next[examKey] = id;
  }
  return next;
}

/**
 * Remove an employee: everything they own right now (class, subjects and periods, exam papers, covers,
 * people reporting to them, parent conversations) is handed to someone else first, then they are archived.
 */
export function RemoveStaffModal({
  open,
  person,
  token,
  onClose,
  onRemoved,
}: {
  open: boolean;
  person: { kind: "teacher" | "staff"; id: string; name: string };
  token: string | null;
  onClose: () => void;
  onRemoved: (message: string) => void;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loadError, setLoadError] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState<Record<Pool, string>>({ teacher: "", person: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setPlan(null);
    setLoadError("");
    setError("");
    setPicks({});
    setBulk({ teacher: "", person: "" });
    act<Plan>(token, "staffRemovalPlan", { kind: person.kind, id: person.id })
      .then(setPlan)
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load what they are doing."));
  }, [open, person.kind, person.id, token]);

  const items = useMemo(() => plan?.sections.flatMap((s) => s.items) ?? [], [plan]);
  const assigned = items.filter((i) => picks[i.key]).length;
  const options = useMemo(
    () => ({
      teacher: (plan?.teachers ?? []).map((t) => ({ id: t.id, label: t.name, searchText: t.detail })),
      person: (plan?.people ?? []).map((p) => ({ id: p.id, label: p.name, searchText: p.detail })),
    }),
    [plan]
  );
  const pools = (["teacher", "person"] as const).filter((pool) => items.some((i) => i.pool === pool));

  /** "Hand everything to": fills every item of that kind; single items can still be changed after. */
  function applyBulk(pool: Pool, id: string) {
    setBulk((b) => ({ ...b, [pool]: id }));
    if (!id) return;
    setPicks((prev) => {
      const next = { ...prev };
      for (const i of items) if (i.pool === pool && !(pool === "person" && i.key === `report:${id}`)) next[i.key] = id;
      return next;
    });
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const res = await act<{ removed: string; moved: number }>(token, "removeStaff", { kind: person.kind, id: person.id, picks });
      onRemoved(res.moved ? `${res.removed} was removed. ${res.moved} item${res.moved === 1 ? "" : "s"} handed over.` : `${res.removed} was removed.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove them.");
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(plan) && assigned === items.length;
  const footer = (
    <View className={`${phone ? "gap-3" : "flex-row items-center gap-3"}`}>
      <Text className="flex-1 text-[12px] text-ink-500">
        {!plan ? "" : items.length ? `${assigned} of ${items.length} handed over` : "Nothing to hand over"}
      </Text>
      <View className="flex-row gap-2">
        <Button variant="ghost" onPress={onClose} className={phone ? "flex-1" : ""}>
          <Text className="font-semibold text-ink-800">Cancel</Text>
        </Button>
        <Button variant="danger" disabled={!ready || busy} onPress={() => void remove()} className={`${phone ? "flex-1" : ""} ${!ready || busy ? "opacity-50" : ""}`}>
          <Text className="font-semibold text-white">{busy ? "Removing…" : "Remove from staff"}</Text>
        </Button>
      </View>
    </View>
  );

  return (
    <Modal open={open} title={`Remove ${person.name}`} onClose={onClose} wide sheetOnPhone footer={footer}>
      {loadError ? (
        <Text className="rounded-lg bg-red-50 px-3 py-2.5 text-[13px] text-red-700">{loadError}</Text>
      ) : !plan ? (
        <View className="items-center py-10">
          <ActivityIndicator color="#1F45C7" />
        </View>
      ) : (
        <View className="gap-4">
          <Text className="text-[13px] leading-5 text-ink-600">
            {items.length
              ? `Before ${person.name} leaves, hand over everything they are doing right now.`
              : `${person.name} has nothing assigned right now. You can remove them straight away.`}
          </Text>

          {pools.length ? (
            <View className="gap-3 rounded-xl bg-[#F5F8FF] p-3.5">
              {pools.map((pool) => (
                <View key={pool} className={phone ? "gap-1.5" : "flex-row items-center gap-3"}>
                  <View className={phone ? "" : "w-[200px]"}>
                    <Text className="text-[13px] font-semibold text-ink-900">{pool === "teacher" ? "Hand all teaching to" : "Hand reports & messages to"}</Text>
                    <Text className="text-[11px] text-ink-500">You can change single items below.</Text>
                  </View>
                  <View className="flex-1">
                    <Select value={bulk[pool]} options={options[pool]} onChange={(id) => applyBulk(pool, id)} placeholder={pool === "teacher" ? "Pick a teacher" : "Pick a person"} />
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {plan.sections.map((section) => {
            const done = section.items.filter((i) => picks[i.key]).length;
            return (
              <View key={section.key} className="overflow-hidden rounded-xl border border-ink-100 bg-white">
                <View className="flex-row items-start gap-2 border-b border-ink-100 bg-ink-50/60 px-3.5 py-2.5">
                  <View className="min-w-0 flex-1">
                    <Text className="text-[13px] font-semibold text-ink-900">{section.title}</Text>
                    <Text className="text-[11px] text-ink-500">{section.hint}</Text>
                  </View>
                  <View className={`flex-row items-center gap-1 rounded-full px-2 py-0.5 ${done === section.items.length ? "bg-emerald-50" : "bg-amber-50"}`}>
                    {done === section.items.length ? <Ionicons name="checkmark" size={12} color="#047857" /> : null}
                    <Text className={`text-[11px] font-semibold ${done === section.items.length ? "text-emerald-700" : "text-amber-800"}`}>
                      {done}/{section.items.length}
                    </Text>
                  </View>
                </View>
                {section.items.map((item, index) => (
                  <View
                    key={item.key}
                    className={`${phone ? "gap-2" : "flex-row items-center gap-3"} px-3.5 py-2.5 ${index ? "border-t border-ink-100" : ""}`}
                  >
                    <View className="min-w-0 flex-1">
                      <Text className="text-[14px] font-medium text-ink-900" numberOfLines={1}>{item.label}</Text>
                      {item.detail ? <Text className="text-[12px] text-ink-500" numberOfLines={1}>{item.detail}</Text> : null}
                    </View>
                    <View className={phone ? "" : "w-[240px]"}>
                      <Select
                        value={picks[item.key] || ""}
                        options={item.key.startsWith("report:") ? options[item.pool].filter((o) => `report:${o.id}` !== item.key) : options[item.pool]}
                        onChange={(id) => setPicks((prev) => withFollowers(prev, item.key, id))}
                        placeholder="Hand over to…"
                      />
                    </View>
                  </View>
                ))}
              </View>
            );
          })}

          {plan.notes.length ? (
            <View className="gap-1.5">
              {plan.notes.map((note) => (
                <View key={note} className="flex-row items-start gap-2">
                  <Ionicons name="information-circle-outline" size={15} color="#64748B" style={{ marginTop: 1 }} />
                  <Text className="flex-1 text-[12px] leading-[18px] text-ink-600">{note}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {error ? <Text className="rounded-lg bg-red-50 px-3 py-2.5 text-[13px] leading-5 text-red-700">{error}</Text> : null}
        </View>
      )}
    </Modal>
  );
}
