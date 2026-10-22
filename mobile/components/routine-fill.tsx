/**
 * Routine → "Fill all classes": check if the school has enough teacher time, preview the
 * whole-school fill, apply it in one go, and undo it if needed. Hand-placed periods stay.
 */
import { useEffect, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Modal, Switch } from "./ui";
import { Popover } from "./form/popover";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";

type Issue = { level: "error" | "warn"; kind: string; text: string };
type Preview = {
  check: { cellsPerWeek: number; teachers: number; needed: number; capacity: number; issues: Issue[]; ok: boolean };
  filled: number;
  preview: null | {
    needed: number;
    placed: number;
    perClass: { classId: string; label: string; adding: number; missing: number }[];
    unplaced: { classLabel: string; subjectLabel: string; count: number; reason: string }[];
    splitSubjects: string[];
    placements: unknown[];
    notes?: string[];
    stats?: { samePeriod?: number; heavyMorning?: number; classTeacherFirst?: number };
  };
};

type Rules = {
  classTeacherFirst: boolean;
  samePeriodDaily: boolean;
  heavyMorning: boolean;
  heavySubjects: string[];
  morningUntilPeriodId: string;
  doubles: Record<string, number>;
  unavailable: Record<string, string[]>;
};
type RulesData = {
  rules: Rules;
  days: { n: number; label: string }[];
  periods: { id: string; name: string; startsAt: string }[];
  subjects: { key: string; name: string; maxNeed: number }[];
  teachers: { id: string; name: string }[];
  classesWithoutClassTeacher: number;
};

export function FillAllSheet({ open, onClose, onApplied }: { open: boolean; onClose: () => void; onApplied: (ids: string[], added: number) => void }) {
  const { token } = useSession();
  const router = useRouter();
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [anyway, setAnyway] = useState(false);
  const [step, setStep] = useState<"rules" | "preview">("rules");
  const [rulesData, setRulesData] = useState<RulesData | null>(null);
  const [rules, setRules] = useState<Rules | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("rules");
    setData(null);
    setError("");
    setAnyway(false);
    setRulesData(null);
    act<RulesData & { ok: true }>(token, "loadTimetableRules", {})
      .then((r) => {
        setRulesData(r);
        setRules(r.rules);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load rules."));
  }, [open, token]);

  async function saveAndPreview() {
    if (!rules) return;
    setStep("preview");
    setData(null);
    setError("");
    setLoading(true);
    try {
      await act(token, "saveTimetableRules", { rules });
      setData(await act<Preview & { ok: true }>(token, "previewTimetableFill", {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check the timetable.");
    } finally {
      setLoading(false);
    }
  }

  const check = data?.check;
  const preview = data?.preview;
  const errors = check?.issues.filter((i) => i.level === "error") ?? [];
  const warns = check?.issues.filter((i) => i.level === "warn") ?? [];
  const canApply = Boolean(preview && preview.placed > 0 && (check?.ok || anyway));
  const pct = check && check.needed ? Math.min(100, Math.round((check.capacity / check.needed) * 100)) : 100;

  async function apply() {
    if (!preview) return;
    setSaving(true);
    setError("");
    try {
      const res = await act<{ ok: true; added: number; undoIds: string[] }>(token, "applyTimetableFill", { placements: preview.placements });
      onApplied(res.undoIds, res.added);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      sheetOnPhone
      title="Fill all classes"
      onClose={onClose}
      footer={
        step === "rules" ? (
          <View className="flex-row items-center justify-end gap-2">
            <Button variant="ghost" onPress={onClose}>
              Cancel
            </Button>
            <Button disabled={!rules} onPress={() => void saveAndPreview()}>
              Save rules & preview
            </Button>
          </View>
        ) : (
        <View className="flex-row items-center justify-end gap-2">
          <Button variant="ghost" onPress={() => setStep("rules")} className="mr-auto">
            ← Rules
          </Button>
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          {preview && preview.placed > 0 ? (
            <Button disabled={!canApply || saving} onPress={() => void apply()}>
              {saving ? "Saving…" : `Add ${preview.placed} periods`}
            </Button>
          ) : null}
        </View>
        )
      }
    >
      {step === "rules" ? (
        rulesData && rules ? (
          <RulesStep data={rulesData} rules={rules} onChange={setRules} />
        ) : (
          <View className="items-center py-8">
            {error ? <Text className="text-[13px] text-red-700">{error}</Text> : <Text className="text-[14px] text-ink-700">Loading rules…</Text>}
          </View>
        )
      ) : (
      <View className="gap-4">
        {loading ? (
          <View className="items-center py-8">
            <Ionicons name="hourglass-outline" size={20} color="#64748B" />
            <Text className="mt-2 text-[14px] text-ink-700">Checking teachers and periods for every class…</Text>
          </View>
        ) : null}
        {error ? <Text className="text-[13px] text-red-700">{error}</Text> : null}

        {check && !check.needed ? (
          <View className="items-center rounded-xl bg-emerald-50 px-4 py-6">
            <Ionicons name="checkmark-circle" size={22} color="#16a34a" />
            <Text className="mt-2 text-[15px] font-semibold text-emerald-900">Every class is already full</Text>
            <Text className="mt-0.5 text-[13px] text-emerald-800">All subjects have their periods for the week.</Text>
          </View>
        ) : null}

        {check && check.needed ? (
          <>
            <View className="rounded-xl border border-ink-200 bg-white p-4">
              <View className="flex-row items-end justify-between">
                <View>
                  <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Periods still to place</Text>
                  <Text className="mt-0.5 text-[22px] font-bold tabular-nums text-ink-900">{check.needed}</Text>
                </View>
                <View className="items-end">
                  <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Teachers can take</Text>
                  <Text className={`mt-0.5 text-[22px] font-bold tabular-nums ${check.capacity >= check.needed ? "text-emerald-700" : "text-red-700"}`}>{check.capacity}</Text>
                </View>
              </View>
              <View className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100">
                <View className={`h-full rounded-full ${check.capacity >= check.needed ? "bg-emerald-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
              </View>
              <Text className="mt-2 text-[12px] text-ink-500">
                {`${check.teachers} teachers × ${check.cellsPerWeek} periods a week, minus periods already placed. Nothing to set up.`}
              </Text>
            </View>

            {errors.length ? (
              <View className="gap-2">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-red-700">{`Fix first · ${errors.length}`}</Text>
                {errors.map((issue) => (
                  <View key={issue.text} className="flex-row items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
                    <Ionicons name="close-circle" size={16} color="#dc2626" />
                    <Text className="flex-1 text-[13px] leading-5 text-red-900">{issue.text}</Text>
                  </View>
                ))}
                <View className="flex-row flex-wrap gap-2">
                  <Button variant="ghost" className="anekio-btn h-9 px-3 py-1.5" onPress={() => { onClose(); router.push("/school?tab=subjects" as never); }}>
                    Subjects & periods
                  </Button>
                  <Button variant="ghost" className="anekio-btn h-9 px-3 py-1.5" onPress={() => { onClose(); router.push("/staff" as never); }}>
                    Teachers
                  </Button>
                </View>
              </View>
            ) : (
              <View className="flex-row items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5">
                <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
                <Text className="flex-1 text-[13px] text-emerald-900">Enough teachers for every subject in every class.</Text>
              </View>
            )}
            {warns.map((issue) => (
              <View key={issue.text} className="flex-row items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
                <Ionicons name="alert-circle" size={16} color="#d97706" />
                <Text className="flex-1 text-[13px] text-amber-900">{issue.text}</Text>
              </View>
            ))}

            {preview ? (
              <View className="gap-2">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Preview · nothing saved yet</Text>
                <Text className="text-[14px] text-ink-900">
                  {preview.placed === preview.needed
                    ? `All ${preview.placed} periods fit, with no teacher in two classes at once.`
                    : `${preview.placed} of ${preview.needed} periods fit. ${preview.needed - preview.placed} could not be placed.`}
                </Text>
                {preview.stats && Object.keys(preview.stats).length ? (
                  <View className="flex-row flex-wrap gap-1.5">
                    {(
                      [
                        ["classTeacherFirst", "Class teacher in period 1"],
                        ["samePeriod", "Same period daily"],
                        ["heavyMorning", "Main subjects in morning"],
                      ] as const
                    )
                      .filter(([k]) => preview.stats?.[k] !== undefined)
                      .map(([k, label]) => {
                        const v = preview.stats![k]!;
                        return (
                          <View key={k} className={`rounded-md px-2 py-1 ${v >= 90 ? "bg-emerald-50" : v >= 70 ? "bg-[#EEF3FF]" : "bg-amber-50"}`}>
                            <Text className={`text-[12px] font-medium ${v >= 90 ? "text-emerald-800" : v >= 70 ? "text-[#1F45C7]" : "text-amber-900"}`}>{`${label} · ${v}%`}</Text>
                          </View>
                        );
                      })}
                  </View>
                ) : null}
                {preview.notes?.length ? (
                  <View className="gap-1 rounded-lg bg-[#EEF3FF] px-3 py-2">
                    {preview.notes.map((n) => (
                      <Text key={n} className="text-[12px] text-ink-700">{`• ${n}`}</Text>
                    ))}
                  </View>
                ) : null}
                <View className="flex-row flex-wrap gap-1.5">
                  {preview.perClass.map((c) => (
                    <View key={c.classId} className={`rounded-md px-2 py-1 ${c.missing ? "bg-amber-50" : "bg-ink-50"}`}>
                      <Text className={`text-[12px] ${c.missing ? "text-amber-900" : "text-ink-700"}`}>
                        {`${c.label} +${c.adding}${c.missing ? ` · ${c.missing} left` : ""}`}
                      </Text>
                    </View>
                  ))}
                </View>
                {preview.unplaced.length ? (
                  <View className="gap-1 rounded-lg bg-amber-50 px-3 py-2">
                    {preview.unplaced.slice(0, 8).map((u) => (
                      <Text key={`${u.classLabel}${u.subjectLabel}`} className="text-[12px] text-amber-900">
                        {`${u.classLabel} ${u.subjectLabel} (${u.count}): ${u.reason}`}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {preview.splitSubjects.length ? (
                  <Text className="text-[12px] text-ink-500">{`Shared between two teachers to make it fit: ${preview.splitSubjects.join(", ")}`}</Text>
                ) : null}
                <Text className="text-[12px] text-ink-500">Periods you placed by hand stay where they are. You can undo after saving.</Text>
                {!check.ok && preview.placed > 0 ? (
                  <Pressable onPress={() => setAnyway(!anyway)} className="flex-row items-center gap-2 py-1">
                    <Ionicons name={anyway ? "checkbox" : "square-outline"} size={18} color={anyway ? "#1F45C7" : "#94A3B8"} />
                    <Text className="text-[13px] text-ink-700">Fill what fits now, fix the rest later</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </>
        ) : null}
      </View>
      )}
    </Modal>
  );
}

function RuleRow({ title, hint, on, onPress, first, children }: { title: string; hint: string; on: boolean; onPress: () => void; first?: boolean; children?: React.ReactNode }) {
  return (
    <View className={`px-4 py-3 ${first ? "" : "border-t border-ink-100"}`}>
      <Pressable accessibilityRole="switch" onPress={onPress} className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-[14px] font-medium text-ink-900">{title}</Text>
          <Text className="mt-0.5 text-[12px] text-ink-500">{hint}</Text>
        </View>
        <Switch on={on} onPress={onPress} />
      </Pressable>
      {on && children ? <View className="mt-3">{children}</View> : null}
    </View>
  );
}

function Pill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className={`rounded-full border px-2.5 py-1 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}>
      <Text className={`text-[12px] font-medium ${on ? "text-white" : "text-ink-700"}`}>{label}</Text>
    </Pressable>
  );
}

/** Step 1 of Fill all classes: how the school likes its timetable. Saved for next time. */
function RulesStep({ data, rules, onChange }: { data: RulesData; rules: Rules; onChange: (r: Rules) => void }) {
  const [teacherOpen, setTeacherOpen] = useState("");
  const set = (patch: Partial<Rules>) => onChange({ ...rules, ...patch });
  const morningIdx = data.periods.findIndex((p) => p.id === rules.morningUntilPeriodId);
  const morningEnd = morningIdx >= 0 ? morningIdx : Math.ceil(data.periods.length / 2) - 1;
  const blockedCount = Object.values(rules.unavailable).reduce((n, c) => n + c.length, 0);
  const doubleCount = Object.values(rules.doubles).reduce((n, c) => n + c, 0);
  return (
    <View className="gap-4">
      <Text className="text-[13px] text-ink-600">How does your school like its timetable? Auto-fill follows these. They are saved for next time.</Text>
      <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
        <RuleRow
          first
          title="Class teacher takes Period 1 every day"
          hint={data.classesWithoutClassTeacher ? `For attendance. ${data.classesWithoutClassTeacher} classes have no class teacher yet.` : "For attendance and the day's notices."}
          on={rules.classTeacherFirst}
          onPress={() => set({ classTeacherFirst: !rules.classTeacherFirst })}
        />
        <RuleRow
          title="Same subject at the same period every day"
          hint="e.g. Maths always in Period 2. Easier for students and teachers to remember."
          on={rules.samePeriodDaily}
          onPress={() => set({ samePeriodDaily: !rules.samePeriodDaily })}
        />
        <RuleRow
          title="Main subjects in the morning"
          hint="Main subjects early, activity subjects like PE and Art later."
          on={rules.heavyMorning}
          onPress={() => set({ heavyMorning: !rules.heavyMorning })}
        >
          <Text className="mb-1.5 text-[12px] font-medium text-ink-600">Main subjects</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {data.subjects.map((s) => {
              const on = rules.heavySubjects.includes(s.key);
              return <Pill key={s.key} label={s.name} on={on} onPress={() => set({ heavySubjects: on ? rules.heavySubjects.filter((k) => k !== s.key) : [...rules.heavySubjects, s.key] })} />;
            })}
          </View>
          <Text className="mb-1.5 mt-3 text-[12px] font-medium text-ink-600">Morning ends after</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {data.periods.map((p, i) => (
              <Pill key={p.id} label={p.name} on={i === morningEnd} onPress={() => set({ morningUntilPeriodId: p.id })} />
            ))}
          </View>
        </RuleRow>
      </View>

      <View>
        <Text className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{`Double periods${doubleCount ? ` · ${doubleCount}` : ""}`}</Text>
        <Text className="mb-2 text-[12px] text-ink-500">Two periods in a row on one day, for labs, Computer or Art. Never across a break.</Text>
        <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
          {data.subjects
            .filter((s) => s.maxNeed >= 2)
            .map((s, i) => {
              const n = rules.doubles[s.key] || 0;
              const max = Math.min(3, Math.floor(s.maxNeed / 2));
              const setN = (v: number) => {
                const next = { ...rules.doubles };
                if (v > 0) next[s.key] = v;
                else delete next[s.key];
                set({ doubles: next });
              };
              return (
                <View key={s.key} className={`flex-row items-center gap-3 px-4 py-2 ${i ? "border-t border-ink-100" : ""}`}>
                  <Text className="flex-1 text-[14px] text-ink-900">{s.name}</Text>
                  <Text className="text-[12px] text-ink-500">{n ? `${n} a week` : "None"}</Text>
                  <View className="flex-row items-center overflow-hidden rounded-lg border border-ink-200">
                    <Pressable accessibilityLabel={`Fewer ${s.name} doubles`} disabled={!n} onPress={() => setN(n - 1)} className="h-8 w-8 items-center justify-center">
                      <Ionicons name="remove" size={14} color={n ? "#334155" : "#CBD5E1"} />
                    </Pressable>
                    <Text className="w-6 text-center text-[14px] font-semibold tabular-nums text-ink-900">{n}</Text>
                    <Pressable accessibilityLabel={`More ${s.name} doubles`} disabled={n >= max} onPress={() => setN(n + 1)} className="h-8 w-8 items-center justify-center">
                      <Ionicons name="add" size={14} color={n < max ? "#334155" : "#CBD5E1"} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
        </View>
      </View>

      <View>
        <Text className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{`Teachers not available${blockedCount ? ` · ${blockedCount} periods` : ""}`}</Text>
        <Text className="mb-2 text-[12px] text-ink-500">Part-time teachers or fixed duties. Tap a teacher, then tap the periods they can't take.</Text>
        <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
          {data.teachers.map((t, i) => {
            const cells = rules.unavailable[t.id] || [];
            const openNow = teacherOpen === t.id;
            const toggle = (key: string) => {
              const next = { ...rules.unavailable };
              const list = cells.includes(key) ? cells.filter((c) => c !== key) : [...cells, key];
              if (list.length) next[t.id] = list;
              else delete next[t.id];
              set({ unavailable: next });
            };
            const toggleDay = (day: number) => {
              const keys = data.periods.map((p) => `${day}|${p.id}`);
              const all = keys.every((k) => cells.includes(k));
              const next = { ...rules.unavailable };
              const list = all ? cells.filter((c) => !keys.includes(c)) : [...new Set([...cells, ...keys])];
              if (list.length) next[t.id] = list;
              else delete next[t.id];
              set({ unavailable: next });
            };
            return (
              <View key={t.id} className={i ? "border-t border-ink-100" : ""}>
                <Pressable onPress={() => setTeacherOpen(openNow ? "" : t.id)} className="flex-row items-center gap-3 px-4 py-2.5 active:bg-ink-50">
                  <Text className="flex-1 text-[14px] text-ink-900">{t.name}</Text>
                  <Text className={`text-[12px] ${cells.length ? "font-medium text-red-700" : "text-ink-500"}`}>{cells.length ? `${cells.length} blocked` : "Always available"}</Text>
                  <Ionicons name={openNow ? "chevron-up" : "chevron-down"} size={14} color="#94A3B8" />
                </Pressable>
                {openNow ? (
                  <View className="px-3 pb-3">
                    <View className="flex-row">
                      <View className="w-12" />
                      {data.days.map((d) => (
                        <Pressable key={d.n} onPress={() => toggleDay(d.n)} className="flex-1 items-center py-1">
                          <Text className="text-[11px] font-semibold text-ink-600 underline">{d.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {data.periods.map((p) => (
                      <View key={p.id} className="flex-row items-center">
                        <Text className="w-12 text-[11px] text-ink-500" numberOfLines={1}>{p.name.replace(/^Period\s*/i, "P")}</Text>
                        {data.days.map((d) => {
                          const key = `${d.n}|${p.id}`;
                          const off = cells.includes(key);
                          return (
                            <Pressable
                              key={key}
                              accessibilityLabel={`${t.name} ${d.label} ${p.name} ${off ? "not available" : "available"}`}
                              onPress={() => toggle(key)}
                              className={`m-0.5 h-7 flex-1 items-center justify-center rounded ${off ? "bg-red-100" : "bg-ink-50"}`}
                            >
                              {off ? <Ionicons name="close" size={12} color="#b91c1c" /> : null}
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                    <Text className="mt-1.5 text-[11px] text-ink-500">Tap a day name to block the whole day.</Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export type ClearSnapshot = { slots: unknown[]; changes: unknown[] };

/** Clear the weekly timetable of one class or all classes, with counts up front. Undo lives on the board. */
export function ClearSheet({
  open,
  klass,
  canAll,
  onClose,
  onCleared,
}: {
  open: boolean;
  klass: { id: string; label: string } | null;
  canAll: boolean;
  onClose: () => void;
  onCleared: (snapshot: ClearSnapshot, removed: number, label: string) => void;
}) {
  const { token } = useSession();
  const [scope, setScope] = useState<"class" | "all">("class");
  const [counts, setCounts] = useState<{ class?: { periods: number; changes: number }; all?: { periods: number; changes: number } }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setScope("class");
    setError("");
    setCounts({});
    const load = async () => {
      const next: typeof counts = {};
      if (klass?.id) next.class = await act<{ ok: true; periods: number; changes: number }>(token, "countTimetableClear", { classId: klass.id });
      if (canAll) next.all = await act<{ ok: true; periods: number; changes: number }>(token, "countTimetableClear", {});
      setCounts(next);
    };
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not count periods."));
  }, [open, klass?.id, canAll, token]);

  const chosen = scope === "all" ? counts.all : counts.class;
  const label = scope === "all" ? "all classes" : klass?.label || "this class";

  async function clear() {
    setBusy(true);
    setError("");
    try {
      const res = await act<{ ok: true; removed: number; snapshot: ClearSnapshot }>(token, "clearTimetable", scope === "all" ? {} : { classId: klass?.id });
      onCleared(res.snapshot, res.removed, label);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear.");
    } finally {
      setBusy(false);
    }
  }

  const options: { key: "class" | "all"; title: string; n?: { periods: number; changes: number } }[] = [
    ...(klass ? [{ key: "class" as const, title: `Only ${klass.label}`, n: counts.class }] : []),
    ...(canAll ? [{ key: "all" as const, title: "All classes", n: counts.all }] : []),
  ];

  return (
    <Modal
      open={open}
      sheetOnPhone
      title="Clear timetable"
      onClose={onClose}
      footer={
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy || !chosen?.periods} onPress={() => void clear()}>
            {busy ? "Clearing…" : chosen ? `Remove ${chosen.periods} periods` : "Remove"}
          </Button>
        </View>
      }
    >
      <View className="gap-3">
        <Text className="text-[13px] text-ink-600">The weekly timetable for these classes becomes empty. Subjects, teachers and periods per week stay as they are.</Text>
        {options.map((o) => {
          const on = scope === o.key;
          return (
            <Pressable
              key={o.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => setScope(o.key)}
              className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${on ? "border-red-300 bg-red-50" : "border-ink-200 bg-white"}`}
            >
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={16} color={on ? "#dc2626" : "#94A3B8"} />
              <Text className="flex-1 text-[14px] font-medium text-ink-900">{o.title}</Text>
              <Text className="text-[13px] tabular-nums text-ink-600">{o.n ? `${o.n.periods} periods` : "…"}</Text>
            </Pressable>
          );
        })}
        {chosen?.changes ? (
          <View className="flex-row items-start gap-2 rounded-lg bg-amber-50 px-3 py-2">
            <Ionicons name="alert-circle" size={15} color="#d97706" />
            <Text className="flex-1 text-[13px] text-amber-900">{`${chosen.changes} one-day changes (covers, "this day only") are linked to these periods and will be removed too. Undo brings them back.`}</Text>
          </View>
        ) : null}
        <Text className="text-[12px] text-ink-500">You can undo right after. Undo works until you leave or reload this page.</Text>
        {error ? <Text className="text-[13px] text-red-700">{error}</Text> : null}
      </View>
    </Modal>
  );
}

export type MenuItem = { key: string; label: string; hint?: string; icon: keyof typeof Ionicons.glyphMap; danger?: boolean; onPress: () => void };

/** A button that opens a short menu. Keeps the Routine header to two buttons. */
export function MenuButton({ label, icon, primary, small, items }: { label?: string; icon?: keyof typeof Ionicons.glyphMap; primary?: boolean; small?: boolean; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const tint = primary ? "#FFFFFF" : "#334155";
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="end"
      minWidth={240}
      panel={
        <View className="py-1">
          {items.map((item, i) => (
            <Pressable
              key={item.key}
              accessibilityRole="menuitem"
              onPress={() => {
                setOpen(false);
                item.onPress();
              }}
              className={`flex-row items-center gap-3 px-3 py-2.5 active:bg-ink-50 ${item.danger && i ? "mt-1 border-t border-ink-100" : ""}`}
            >
              <Ionicons name={item.icon} size={16} color={item.danger ? "#b91c1c" : "#475569"} />
              <View className="min-w-0 flex-1">
                <Text className={`text-[14px] ${item.danger ? "text-red-700" : "text-ink-900"}`}>{item.label}</Text>
                {item.hint ? <Text className="text-[12px] text-ink-500">{item.hint}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label || "More actions"}
        onPress={() => setOpen((v) => !v)}
        hitSlop={small ? 6 : undefined}
        className={
          small
            ? "flex-row items-center gap-1 rounded-full bg-[#1F45C7] px-2.5 py-1"
            : `h-10 flex-row items-center gap-1.5 rounded-md px-3 ${primary ? "bg-clay-500" : "border border-ink-200 bg-white"}`
        }
      >
        {icon ? <Ionicons name={icon} size={small ? 11 : 16} color={tint} /> : null}
        {label ? <Text className={small ? "text-[11px] font-semibold text-white" : `text-sm font-medium ${primary ? "text-white" : "text-ink-800"}`}>{label}</Text> : null}
        {label ? <Ionicons name="chevron-down" size={small ? 10 : 14} color={tint} /> : null}
      </Pressable>
    </Popover>
  );
}

/** Small outlined button with an icon and a short label, for the Routine header. */
export function IconButton({ icon, label, danger, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; danger?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`h-10 flex-row items-center gap-1.5 rounded-md border bg-white px-3 active:opacity-80 ${danger ? "border-red-200 hover:bg-red-50" : "border-ink-200 hover:bg-ink-50"}`}
    >
      <Ionicons name={icon} size={16} color={danger ? "#b91c1c" : "#475569"} />
      <Text className={`text-sm font-medium ${danger ? "text-red-700" : "text-ink-800"}`}>{label}</Text>
    </Pressable>
  );
}
