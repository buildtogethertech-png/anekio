import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";
import { Badge, Button, Input, Modal, Segmented, Switch } from "./ui";

/**
 * Settings → School year.
 * Prepare next year → decide per class (promote / stays / change class / left / pass out) → review → switch.
 * Nothing changes for teachers or parents until the switch.
 */

type Outcome = "PROMOTE" | "DETAIN" | "LEAVE" | "PASS_OUT";
type StudentRow = {
  id: string;
  name: string;
  admissionNo: string;
  rollNumber: number | null;
  attendancePct: number | null;
  outcome: Outcome;
  toClassId: string | null;
  provisional: boolean;
  note: string;
  decided: boolean;
  flags: string[];
};
type ClassCard = {
  id: string;
  label: string;
  defaultToClassId: string | null;
  defaultToLabel: string;
  students: StudentRow[];
  decided: number;
  toCheck: number;
  done: boolean;
};
type Year = { id: string; label: string; startsOn: string; endsOn: string };
type Undo = { fromLabel: string; label: string; switchedAt: string; until: string; blocked: string };
type Board = {
  current: Year;
  next: Year | null;
  undo: Undo | null;
  classes: ClassCard[];
  targets: { id: string; label: string; rank: number | null }[];
  totals: { students: number; promote: number; detain: number; leave: number; passOut: number; classesDone: number; classes: number; toCheck: number };
  pastCount: number;
  joining: { total: number; byClass: { label: string; count: number }[] };
};
type PastRow = { id: string; name: string; admissionNo: string; leftOn: string | null; leftReason: string; lastClass: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function pretty(ymd: string | null | undefined) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

const OUTCOME_TEXT: Record<Outcome, string> = {
  PROMOTE: "Promoted",
  DETAIN: "Stays",
  LEAVE: "Left school",
  PASS_OUT: "Passes out",
};

export function SchoolYearPanel({
  edit,
  phone,
  notify,
  onChanged,
}: {
  edit: boolean;
  phone: boolean;
  notify: (message: string) => void;
  onChanged: () => Promise<void> | void;
}) {
  const { token } = useSession();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [step, setStep] = useState<"promote" | "review">("promote");
  const [openClass, setOpenClass] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [openClass]);
  const [picker, setPicker] = useState<{ card: ClassCard; row: StudentRow } | null>(null);
  const [classPick, setClassPick] = useState<{ title: string; note: string; fromId: string; nearId: string | null; current: string | null; onPick: (classId: string) => void; onPassOut?: () => void; onStay?: () => void; selected?: "PASS_OUT" | "DETAIN" | null } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pastOpen, setPastOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [undoText, setUndoText] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await act<{ ok: true } & Board>(token, "promotionBoard");
      setBoard(res);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not load the school year.");
    } finally {
      setLoading(false);
    }
  }, [token, notify]);

  useEffect(() => {
    if (edit) void load();
    else setLoading(false);
  }, [edit, load]);

  const targetLabel = useMemo(() => new Map((board?.targets ?? []).map((t) => [t.id, t.label])), [board]);

  async function save(rows: Array<Pick<StudentRow, "outcome" | "toClassId" | "provisional" | "note"> & { studentId: string }>, ok?: string) {
    setBusy("save");
    try {
      await act(token, "savePromotionDecisions", { rows });
      await load();
      if (ok) notify(ok);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy("");
    }
  }

  async function prepare() {
    setBusy("prepare");
    try {
      const res = await act<{ ok: true; label: string }>(token, "prepareNextYear");
      notify(`${res.label} is being prepared. Nothing changes until you switch.`);
      await load();
      await onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not prepare next year.");
    } finally {
      setBusy("");
    }
  }

  async function undoSwitch() {
    setBusy("undo");
    try {
      const res = await act<{ ok: true; label: string; nextLabel: string; restored: number }>(token, "undoYearSwitch");
      setUndoOpen(false);
      setUndoText("");
      notify(`Back in ${res.label}. ${res.restored} students are in their old classes. ${res.nextLabel} is being prepared again.`);
      await load();
      await onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not undo the switch.");
    } finally {
      setBusy("");
    }
  }

  async function switchNow() {
    if (!board?.next) return;
    setBusy("switch");
    try {
      const res = await act<{ ok: true; label: string; moved: number; left: number; passedOut: number; joined?: number }>(token, "switchToNextYear", {
        sessionId: board.next.id,
      });
      setConfirmOpen(false);
      setConfirmText("");
      notify(`${res.label} is now the current year. ${res.moved} students moved${res.passedOut ? `, ${res.passedOut} passed out` : ""}${res.left ? `, ${res.left} left` : ""}${res.joined ? `, ${res.joined} new admissions joined` : ""}.`);
      await load();
      await onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not switch the year.");
    } finally {
      setBusy("");
    }
  }

  if (!edit) {
    return <Text className="text-sm text-ink-700">Only school admins can move the school into a new year.</Text>;
  }
  if (loading) {
    return (
      <View className="items-center py-8">
        <ActivityIndicator color="#1F45C7" />
      </View>
    );
  }
  if (!board) return null;

  const pastLink = (
    <Pressable onPress={() => setPastOpen(true)} className="flex-row items-center gap-1 self-start" accessibilityRole="button">
      <Ionicons name="archive-outline" size={14} color="#1F45C7" />
      <Text className="text-xs font-medium text-clay-600">Past students{board.pastCount ? ` (${board.pastCount})` : ""}</Text>
    </Pressable>
  );

  // ── Not preparing yet ───────────────────────────────────────────────
  if (!board.next) {
    const undo = board.undo;
    return (
      <View className="gap-3">
        {undo ? (
          <View className="rounded-md border border-ink-200 bg-ink-50 p-3">
            <View className={phone ? "gap-2" : "flex-row items-center gap-3"}>
              <Ionicons name="time-outline" size={18} color="#3d4f66" />
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-medium text-ink-900">
                  Switched from {undo.fromLabel} to {undo.label} on {pretty(undo.switchedAt)}
                </Text>
                <Text className="mt-0.5 text-xs leading-4 text-ink-700">
                  {undo.blocked
                    ? `${undo.blocked} The switch is now final.`
                    : `Made a mistake? You can undo it until ${pretty(undo.until)}, as long as nothing is done in ${undo.label} yet.`}
                </Text>
              </View>
              {!undo.blocked ? (
                <Button variant="ghost" onPress={() => setUndoOpen(true)} disabled={Boolean(busy)}>
                  Undo switch
                </Button>
              ) : null}
            </View>
          </View>
        ) : null}
        <View className="rounded-md border border-ink-200 p-4">
          <Text className="text-sm font-medium text-ink-900">Move to the next school year</Text>
          <Text className="mt-1 text-xs leading-4 text-ink-700">
            Prepare next year now and decide which students move up, stay, or leave. Teachers and parents keep seeing {board.current.label} until
            you switch.
          </Text>
          <View className="mt-3 gap-1.5">
            {["Prepare the year", "Promote students class by class", "Check and switch"].map((t, i) => (
              <View key={t} className="flex-row items-center gap-2">
                <View className="h-5 w-5 items-center justify-center rounded-full bg-ink-100">
                  <Text className="text-[11px] font-semibold text-ink-800">{i + 1}</Text>
                </View>
                <Text className="text-xs text-ink-800">{t}</Text>
              </View>
            ))}
          </View>
          <View className={`mt-4 ${phone ? "" : "flex-row"}`}>
            <Button onPress={prepare} disabled={busy === "prepare"}>
              {busy === "prepare" ? "Preparing…" : "Prepare next year"}
            </Button>
          </View>
        </View>
        {pastLink}
        <PastStudentsModal open={pastOpen} onClose={() => setPastOpen(false)} targets={board.targets} notify={notify} onChanged={load} />
        {undo ? (
          <Modal
            open={undoOpen}
            title={`Go back to ${undo.fromLabel}?`}
            onClose={() => setUndoOpen(false)}
            sheetOnPhone
            footer={
              <View className="flex-row justify-end gap-2">
                <Button variant="ghost" onPress={() => setUndoOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" disabled={busy === "undo" || undoText.trim().toUpperCase() !== "UNDO"} onPress={undoSwitch}>
                  {busy === "undo" ? "Undoing…" : "Undo switch"}
                </Button>
              </View>
            }
          >
            <View className="gap-3">
              {[
                `Every student goes back to their ${undo.fromLabel} class and roll number.`,
                "Students marked passed out or left in the switch come back.",
                `${undo.fromLabel} becomes the current year again.`,
                `${undo.label} goes back to “being prepared”, with your choices kept, so you can fix them and switch again.`,
              ].map((line) => (
                <View key={line} className="flex-row gap-2">
                  <Text className="text-xs text-ink-600">•</Text>
                  <Text className="flex-1 text-sm leading-5 text-ink-800">{line}</Text>
                </View>
              ))}
              <Text className="text-xs text-ink-700">Type UNDO to confirm.</Text>
              <Input value={undoText} onChangeText={setUndoText} autoCapitalize="characters" placeholder="UNDO" />
            </View>
          </Modal>
        ) : null}
      </View>
    );
  }

  // ── Preparing ───────────────────────────────────────────────────────
  const t = board.totals;
  const next = board.next;
  return (
    <View className="gap-3">
      <View className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <View className="flex-row flex-wrap items-center gap-2">
          <Ionicons name="construct-outline" size={16} color="#92400e" />
          <Text className="text-sm font-semibold text-amber-900">Preparing {next.label}</Text>
          <Text className="text-xs text-amber-900">
            {pretty(next.startsOn)} – {pretty(next.endsOn)}
          </Text>
        </View>
        <Text className="mt-1 text-xs leading-4 text-amber-900">
          Teachers and parents still see {board.current.label}. Students move only when you switch.
        </Text>
      </View>

      <Segmented
        value={step}
        onChange={(id) => setStep(id as "promote" | "review")}
        options={[
          { id: "promote", label: `1  Promote students · ${t.classesDone}/${t.classes}` },
          { id: "review", label: "2  Check & switch" },
        ]}
      />

      {step === "promote" ? (
        <View className="gap-2">
          <Text className="text-xs text-ink-700">
            Everyone moves up by default. Open a class to mark who stays, changes section, or leaves, then tap “Looks right”.
          </Text>
          {board.classes.length ? (
            <View className="flex-row flex-wrap items-center gap-1.5 rounded-md border border-ink-100 bg-ink-50 px-3 py-2">
              <Text className="mr-1 text-xs font-medium text-ink-700">Whole school</Text>
              <TotalChip text={`${t.promote} promoted`} cls="border-ink-200 bg-white text-ink-800" />
              <TotalChip text={`${t.detain} failed`} cls="border-amber-200 bg-amber-50 text-amber-800" />
              <TotalChip text={`${t.passOut} passed out`} cls="border-green-200 bg-green-50 text-green-800" />
              <TotalChip text={`${t.leave} left school`} cls="border-red-200 bg-red-50 text-red-700" />
            </View>
          ) : (
            <Text className="text-sm text-ink-700">No students in any class yet.</Text>
          )}
          {board.classes.map((card) => {
            const open = openClass === card.id;
            // "Changed" = differs from this class's default (top class passes out by default, so that is not a change).
            // The class's "Promote to" = where most promoted students are going (you can change it), else the suggestion.
            const counts = new Map<string, number>();
            for (const s of card.students) if (s.outcome === "PROMOTE" && s.toClassId) counts.set(s.toClassId, (counts.get(s.toClassId) ?? 0) + 1);
            const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
            // What most of the class is doing decides the header ("→ 5-A", "→ Pass out", "→ Stays").
            const outCounts = new Map<Outcome, number>();
            for (const s of card.students) outCounts.set(s.outcome, (outCounts.get(s.outcome) ?? 0) + 1);
            const mainOutcome = [...outCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "PROMOTE";
            const promoting = (outCounts.get("PROMOTE") ?? 0) > 0 && mainOutcome === "PROMOTE";
            const cardTo = promoting ? top : null;
            const cardToLabel = cardTo ? targetLabel.get(cardTo) ?? "" : "";
            const defOutcome: Outcome = cardTo ? "PROMOTE" : mainOutcome;
            const defTo = cardTo ?? (defOutcome === "DETAIN" ? card.id : null);
            const changed = card.students.filter(
              (s) => s.outcome !== defOutcome || ((s.outcome === "PROMOTE" || s.outcome === "DETAIN") && s.toClassId !== defTo)
            );
            const promotable = Boolean(cardTo);
            // Applies to everyone following the class choice; students changed one by one keep their own choice.
            const applyClass = (outcome: Outcome, toClassId: string | null, ok: string) => {
              const rows = card.students.filter((s) => !changed.includes(s));
              void save(rows.map((s) => ({ studentId: s.id, outcome, toClassId, provisional: outcome === "PROMOTE" && s.provisional, note: s.note })), ok);
            };
            const chooseClassTarget = () =>
              setClassPick({
                title: `Promote ${card.label} to`,
                note: "Everyone moving up from this class goes here. You can still change single students.",
                fromId: card.id,
                nearId: card.defaultToClassId,
                current: cardTo,
                selected: !cardTo && (mainOutcome === "PASS_OUT" || mainOutcome === "DETAIN") ? mainOutcome : null,
                onPick: (classId) => applyClass("PROMOTE", classId, `${card.label} → ${targetLabel.get(classId)}.`),
                onPassOut: () => applyClass("PASS_OUT", null, `${card.label} passes out.`),
                onStay: () => applyClass("DETAIN", card.id, `${card.label} stays in ${card.label}.`),
              });
            const picked = card.students.filter((s) => selected.has(s.id));
            const allPicked = picked.length === card.students.length;
            const bulk = (outcome: Outcome, label: string, to?: string) => {
              const toClassId = outcome === "PROMOTE" ? to ?? cardTo : outcome === "DETAIN" ? card.id : null;
              void save(
                picked.map((s) => ({ studentId: s.id, outcome, toClassId, provisional: false, note: s.note })),
                `${picked.length} ${picked.length === 1 ? "student" : "students"}: ${label}.`
              ).then(() => setSelected(new Set()));
            };
            return (
              <View key={card.id} className={`rounded-md border ${card.done ? "border-green-200" : "border-ink-200"} bg-white`}>
                <Pressable
                  onPress={() => setOpenClass(open ? "" : card.id)}
                  className="flex-row items-center gap-3 px-3 py-3"
                  accessibilityRole="button"
                  accessibilityLabel={`${card.label} to ${card.defaultToLabel}`}
                >
                  <View className={`h-6 w-6 items-center justify-center rounded-full ${card.done ? "bg-green-600" : "bg-ink-100"}`}>
                    {card.done ? <Ionicons name="checkmark" size={14} color="#fff" /> : <Ionicons name="school-outline" size={13} color="#3d4f66" />}
                  </View>
                  <View className="min-w-0 flex-1">
                    {card.done ? (
                      <View className="flex-row flex-wrap items-center gap-1.5">
                        <Text className="mr-1 text-sm font-semibold text-ink-900">{card.label}</Text>
                        {(() => {
                          const n = (o: Outcome) => outCounts.get(o) ?? 0;
                          // One chip per class they go to: "59 promoted to 3-A", "2 promoted to 2-A".
                          const promotedChips = [...counts.entries()]
                            .sort((a, b) => b[1] - a[1])
                            .map(([id, c]) => ({ text: `${c} promoted to ${targetLabel.get(id) ?? "?"}`, cls: "border-ink-200 bg-white text-ink-800" }));
                          const chips: { text: string; cls: string }[] = [
                            ...promotedChips,
                            { text: `${n("DETAIN")} failed`, cls: "border-amber-200 bg-amber-50 text-amber-800" },
                            { text: `${n("PASS_OUT")} passed out`, cls: "border-green-200 bg-green-50 text-green-800" },
                            { text: `${n("LEAVE")} left school`, cls: "border-red-200 bg-red-50 text-red-700" },
                          ].filter((c) => !c.text.startsWith("0 "));
                          return chips.map((c) => {
                            const [border, bg, color] = c.cls.split(" ");
                            return (
                              <View key={c.text} className={`rounded border px-1.5 py-0.5 ${border} ${bg}`}>
                                <Text className={`text-xs font-medium ${color}`}>{c.text}</Text>
                              </View>
                            );
                          });
                        })()}
                      </View>
                    ) : (
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-sm font-semibold text-ink-900">{card.label}</Text>
                      <Ionicons name="arrow-forward" size={13} color="#3d4f66" />
                      <Pressable
                        onPress={chooseClassTarget}
                        accessibilityRole="button"
                        accessibilityLabel={`Choose the class ${card.label} moves to`}
                        className={`flex-row items-center gap-1 rounded-md border px-2 py-0.5 ${cardTo ? "border-ink-200 bg-white" : "border-amber-300 bg-amber-50"}`}
                      >
                        <Text className={`text-sm font-semibold ${cardTo ? "text-ink-900" : "text-amber-900"}`}>
                          {cardTo ? cardToLabel : mainOutcome === "PASS_OUT" ? "Pass out" : mainOutcome === "DETAIN" ? "Stays" : mainOutcome === "LEAVE" ? "Left school" : "Choose class"}
                        </Text>
                        <Ionicons name="chevron-down" size={13} color="#3d4f66" />
                      </Pressable>
                    </View>
                    )}
                    <Text className="text-xs text-ink-700" numberOfLines={1}>
                      {card.students.length} students
                      {card.done ? " · checked" : changed.length ? ` · ${changed.length} changed` : ""}
                    </Text>
                  </View>
                  {card.toCheck ? <Badge tone="warn">{`⚠ ${card.toCheck} to check`}</Badge> : null}
                  {!phone && !card.done ? (
                    <Button
                      variant="ghost"
                      className="px-3 py-1.5"
                      disabled={Boolean(busy)}
                      onPress={() =>
                        save(
                          card.students.map((s) => ({ studentId: s.id, outcome: s.outcome, toClassId: s.toClassId, provisional: s.provisional, note: s.note })),
                          `${card.label} checked.`
                        )
                      }
                    >
                      {promotable && !changed.length ? `Promote all to ${cardToLabel}` : "Looks right"}
                    </Button>
                  ) : null}
                  <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color="#3d4f66" />
                </Pressable>
                {open ? (
                  <View className="border-t border-ink-100">
                    <View className={`flex-row flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2 ${picked.length ? "bg-blue-50" : "bg-ink-50"}`}>
                      <Pressable
                        onPress={() => setSelected(allPicked ? new Set() : new Set(card.students.map((s) => s.id)))}
                        className="flex-row items-center gap-2"
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: allPicked }}
                      >
                        <CheckBox on={allPicked} partial={picked.length > 0 && !allPicked} />
                        <Text className="text-xs font-medium text-ink-800">
                          {picked.length ? `${picked.length} selected` : "Select all"}
                        </Text>
                      </Pressable>
                      {picked.length ? (
                        <View className="flex-row flex-wrap items-center gap-1.5">
                          <BulkButton
                            label="Promote to… ▾"
                            tone="ink"
                            onPress={() =>
                              setClassPick({
                                title: `Promote ${picked.length} ${picked.length === 1 ? "student" : "students"} to`,
                                note: `From ${card.label}`,
                                fromId: card.id,
                                nearId: cardTo ?? card.defaultToClassId,
                                current: null,
                                onPick: (classId) => bulk("PROMOTE", `promoted to ${targetLabel.get(classId)}`, classId),
                                onPassOut: () => bulk("PASS_OUT", "pass out"),
                                onStay: () => bulk("DETAIN", `stay in ${card.label}`),
                              })
                            }
                          />
                          <BulkButton label={`Failed · stays in ${card.label}`} tone="warn" onPress={() => bulk("DETAIN", `stay in ${card.label}`)} />
                          <BulkButton label="Pass out" tone="leaf" onPress={() => bulk("PASS_OUT", "pass out")} />
                          <BulkButton label="Left school" tone="danger" onPress={() => bulk("LEAVE", "left school")} />
                          <Pressable onPress={() => setSelected(new Set())} hitSlop={6}>
                            <Text className="text-xs text-ink-700 underline">Clear</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Text className="text-xs text-ink-600">Tick students to change many at once, or tap a name.</Text>
                      )}
                    </View>
                    {card.students.map((s) => (
                      <Pressable
                        key={s.id}
                        onPress={() => setPicker({ card, row: s })}
                        className={`flex-row items-center gap-2 border-b border-ink-50 px-3 py-2.5 ${selected.has(s.id) ? "bg-blue-50" : ""}`}
                        accessibilityRole="button"
                      >
                        <Pressable
                          hitSlop={8}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected.has(s.id) }}
                          onPress={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(s.id)) next.delete(s.id);
                              else next.add(s.id);
                              return next;
                            })
                          }
                        >
                          <CheckBox on={selected.has(s.id)} />
                        </Pressable>
                        <Text className="w-7 text-xs text-ink-600">{s.rollNumber ?? "–"}</Text>
                        <View className="min-w-0 flex-1">
                          <Text className="text-sm text-ink-900" numberOfLines={1}>
                            {s.name}
                          </Text>
                          {s.flags.length || s.attendancePct != null ? (
                            <Text className={`text-[11px] ${s.flags.length ? "text-amber-800" : "text-ink-600"}`} numberOfLines={1}>
                              {s.flags.length ? `⚠ ${s.flags.join(" · ")}` : `Attendance ${s.attendancePct}%`}
                            </Text>
                          ) : null}
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Choose ${s.name}'s class for next year`}
                          hitSlop={6}
                          onPress={() =>
                            setClassPick({
                                  title: `${s.name} goes to`,
                                  note: `Now in ${card.label}. For "Left school", tap the name.`,
                                  selected: s.outcome === "PASS_OUT" || s.outcome === "DETAIN" ? s.outcome : null,
                                  fromId: card.id,
                                  nearId: cardTo ?? card.defaultToClassId,
                                  current: s.outcome === "PROMOTE" ? s.toClassId : null,
                                  onPick: (classId) =>
                                    void save([{ studentId: s.id, outcome: "PROMOTE", toClassId: classId, provisional: s.provisional, note: s.note }]),
                                  onPassOut: () => void save([{ studentId: s.id, outcome: "PASS_OUT", toClassId: null, provisional: false, note: s.note }]),
                                  onStay: () => void save([{ studentId: s.id, outcome: "DETAIN", toClassId: card.id, provisional: false, note: s.note }]),
                                })
                          }
                        >
                          <OutcomePill row={s} card={card} targetLabel={targetLabel} />
                        </Pressable>
                      </Pressable>
                    ))}
                    <View className="flex-row flex-wrap items-center gap-2 p-3">
                      <Button
                        className={phone ? "flex-1" : ""}
                        disabled={Boolean(busy)}
                        onPress={() =>
                          save(
                            card.students.map((s) => ({ studentId: s.id, outcome: s.outcome, toClassId: s.toClassId, provisional: s.provisional, note: s.note })),
                            `${card.label} checked.`
                          )
                        }
                      >
                        {card.done ? "Saved ✓" : promotable && !changed.length ? `Promote all to ${cardToLabel}` : "Looks right"}
                      </Button>
                      {card.decided ? (
                        <Pressable
                          onPress={async () => {
                            await act(token, "resetPromotionClass", { classId: card.id }).catch(() => undefined);
                            await load();
                          }}
                        >
                          <Text className="text-xs font-medium text-ink-700 underline">Reset</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
          <View className="flex-row justify-end">
            <Button variant="ghost" onPress={() => setStep("review")}>
              Next: check & switch
            </Button>
          </View>
        </View>
      ) : (
        <View className="gap-3">
          <View className={phone ? "gap-2" : "flex-row gap-2"}>
            <SummaryTile label="Move up" value={t.promote} />
            <SummaryTile label="Stay in class" value={t.detain} />
            <SummaryTile label="Pass out" value={t.passOut} />
            <SummaryTile label="Leave school" value={t.leave} />
          </View>
          {t.classesDone < t.classes ? (
            <View className="flex-row items-start gap-2 rounded-md bg-amber-50 p-3">
              <Ionicons name="alert-circle-outline" size={16} color="#92400e" />
              <Text className="flex-1 text-xs leading-4 text-amber-900">
                {t.classes - t.classesDone} of {t.classes} classes are not checked yet. Their students will move up to the next class.
                {t.toCheck ? ` ${t.toCheck} students have low attendance.` : ""}
              </Text>
            </View>
          ) : (
            <View className="flex-row items-center gap-2 rounded-md bg-green-50 p-3">
              <Ionicons name="checkmark-circle" size={16} color="#15803d" />
              <Text className="text-xs text-green-800">All {t.classes} classes checked.</Text>
            </View>
          )}
          <View className="rounded-md border border-ink-200 p-3">
            <Text className="text-sm font-medium text-ink-900">When you switch to {next.label}</Text>
            {[
              `${t.promote + t.detain} students get their new class, with roll numbers A→Z.`,
              `${t.passOut + t.leave} students move to Past students. Their fees, marks and certificates stay.`,
              ...(board.joining.total
                ? [`${board.joining.total} new admissions join their classes (${board.joining.byClass.map((c) => `${c.label} ${c.count}`).join(", ")}).`]
                : []),
              `${next.label} becomes the current year for fees, exams and attendance.`,
              `${board.current.label} stays available to look back at.`,
            ].map((line) => (
              <View key={line} className="mt-1.5 flex-row gap-2">
                <Text className="text-xs text-ink-600">•</Text>
                <Text className="flex-1 text-xs leading-4 text-ink-800">{line}</Text>
              </View>
            ))}
          </View>
          <View className={phone ? "gap-2" : "flex-row items-center justify-between"}>
            <Button variant="ghost" onPress={() => setStep("promote")}>
              Back to classes
            </Button>
            <Button onPress={() => setConfirmOpen(true)} disabled={Boolean(busy)}>
              {`Switch to ${next.label} now`}
            </Button>
          </View>
        </View>
      )}

      {pastLink}

      <OutcomeModal
        picker={picker}
        targets={board.targets}
        targetLabel={targetLabel}
        onClose={() => setPicker(null)}
        onPick={(value) => {
          if (!picker) return;
          const r = picker.row;
          setPicker(null);
          void save([{ studentId: r.id, note: r.note, ...value }]);
        }}
      />

      <ClassPickModal pick={classPick} targets={board.targets} onClose={() => setClassPick(null)} />

      <Modal
        open={confirmOpen}
        title={`Switch to ${next.label}?`}
        onClose={() => setConfirmOpen(false)}
        sheetOnPhone
        footer={
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy === "switch" || confirmText.trim().toUpperCase() !== "SWITCH"}
              onPress={switchNow}
            >
              {busy === "switch" ? "Switching…" : "Switch now"}
            </Button>
          </View>
        }
      >
        <View className="gap-3">
          <Text className="text-sm leading-5 text-ink-800">
            {t.promote + t.detain} students get their {next.label} class and {t.passOut + t.leave} move to Past students. Everyone in the school
            will see {next.label} from now on.
          </Text>
          <Text className="text-xs text-ink-700">This cannot be undone with one tap. Type SWITCH to confirm.</Text>
          <Input value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" placeholder="SWITCH" />
        </View>
      </Modal>

      <PastStudentsModal open={pastOpen} onClose={() => setPastOpen(false)} targets={board.targets} notify={notify} onChanged={load} />
    </View>
  );
}

function TotalChip({ text, cls }: { text: string; cls: string }) {
  const [border, bg, color] = cls.split(" ");
  return (
    <View className={`rounded border px-1.5 py-0.5 ${border} ${bg}`}>
      <Text className={`text-xs font-medium ${color}`}>{text}</Text>
    </View>
  );
}

function CheckBox({ on, partial }: { on: boolean; partial?: boolean }) {
  return (
    <View className={`h-[18px] w-[18px] items-center justify-center rounded border ${on || partial ? "border-clay-500 bg-clay-500" : "border-ink-300 bg-white"}`}>
      {on ? <Ionicons name="checkmark" size={13} color="#fff" /> : partial ? <View className="h-0.5 w-2 bg-white" /> : null}
    </View>
  );
}

function BulkButton({ label, tone, onPress }: { label: string; tone: "ink" | "warn" | "leaf" | "danger"; onPress: () => void }) {
  const cls =
    tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "leaf"
        ? "border-green-200 bg-green-50 text-green-800"
        : tone === "danger"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-ink-200 bg-white text-ink-800";
  const [border, bg, color] = cls.split(" ");
  return (
    <Pressable onPress={onPress} className={`rounded-md border px-2.5 py-1.5 ${border} ${bg}`} accessibilityRole="button">
      <Text className={`text-xs font-medium ${color}`}>{label}</Text>
    </Pressable>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 rounded-md border border-ink-200 px-3 py-2.5">
      <Text className="text-xs text-ink-700">{label}</Text>
      <Text className="mt-0.5 text-xl font-semibold text-ink-900">{value}</Text>
    </View>
  );
}

function OutcomePill({ row, card, targetLabel }: { row: StudentRow; card: ClassCard; targetLabel: Map<string, string> }) {
  const to = row.toClassId ? targetLabel.get(row.toClassId) ?? "" : "";
  const text =
    row.outcome === "PROMOTE"
      ? row.toClassId && row.toClassId !== card.defaultToClassId
        ? `→ ${to}`
        : `→ ${to || card.defaultToLabel}`
      : row.outcome === "DETAIN"
        ? `Stays · ${to || card.label}`
        : OUTCOME_TEXT[row.outcome];
  const tone =
    row.outcome === "PROMOTE"
      ? row.toClassId !== card.defaultToClassId
        ? "border-sky-200 bg-sky-50 text-sky-800"
        : "border-ink-200 bg-white text-ink-800"
      : row.outcome === "DETAIN"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : row.outcome === "PASS_OUT"
          ? "border-green-200 bg-green-50 text-green-800"
          : "border-red-200 bg-red-50 text-red-700";
  const [border, bg, color] = tone.split(" ");
  return (
    <View className={`flex-row items-center gap-1 rounded-md border px-2 py-1 ${border} ${bg}`}>
      <Text className={`text-xs font-medium ${color}`} numberOfLines={1}>
        {text}
        {row.provisional ? " · prov." : ""}
      </Text>
      <Ionicons name="chevron-down" size={12} color="#3d4f66" />
    </View>
  );
}

function OutcomeModal({
  picker,
  targets,
  targetLabel,
  onClose,
  onPick,
}: {
  picker: { card: ClassCard; row: StudentRow } | null;
  targets: Board["targets"];
  targetLabel: Map<string, string>;
  onClose: () => void;
  onPick: (value: { outcome: Outcome; toClassId: string | null; provisional: boolean }) => void;
}) {
  const [changing, setChanging] = useState(false);
  const [provisional, setProvisional] = useState(false);
  useEffect(() => {
    setChanging(false);
    setProvisional(Boolean(picker?.row.provisional));
  }, [picker]);
  if (!picker) return null;
  const { card, row } = picker;
  const nextRank = card.defaultToClassId ? targets.find((t) => t.id === card.defaultToClassId)?.rank ?? null : null;
  const sameGrade = nextRank == null ? [] : targets.filter((t) => t.rank === nextRank);
  const others = targets.filter((t) => !sameGrade.some((g) => g.id === t.id));

  const option = (icon: keyof typeof Ionicons.glyphMap, title: string, sub: string, on: boolean, press: () => void) => (
    <Pressable
      key={title}
      onPress={press}
      className={`flex-row items-center gap-3 rounded-md border px-3 py-3 ${on ? "border-clay-500 bg-blue-50" : "border-ink-200 bg-white"}`}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={18} color={on ? "#1F45C7" : "#3d4f66"} />
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-medium text-ink-900">{title}</Text>
        {sub ? <Text className="text-xs text-ink-700">{sub}</Text> : null}
      </View>
      {on ? <Ionicons name="checkmark" size={18} color="#1F45C7" /> : null}
    </Pressable>
  );

  return (
    <Modal open title={row.name} onClose={onClose} sheetOnPhone>
      <View className="gap-2">
        <Text className="text-xs text-ink-700">
          Now in {card.label}
          {row.attendancePct != null ? ` · attendance ${row.attendancePct}%` : ""}
        </Text>
        {!changing ? (
          <>
            <View className={`rounded-md border px-3 py-3 ${row.outcome === "PROMOTE" ? "border-clay-500 bg-blue-50" : "border-ink-200 bg-white"}`}>
              <View className="flex-row items-center gap-3">
                <Ionicons name="arrow-up-circle-outline" size={18} color={row.outcome === "PROMOTE" ? "#1F45C7" : "#3d4f66"} />
                <Text className="flex-1 text-sm font-medium text-ink-900">Promote to</Text>
              </View>
              <View className="mt-2 flex-row flex-wrap gap-1.5 pl-[30px]">
                {sameGrade.map((t) => (
                  <ClassChip key={t.id} label={t.label} on={row.outcome === "PROMOTE" && row.toClassId === t.id} onPress={() => onPick({ outcome: "PROMOTE", toClassId: t.id, provisional })} />
                ))}
                {row.outcome === "PROMOTE" && row.toClassId && !sameGrade.some((t) => t.id === row.toClassId) ? (
                  <ClassChip label={targetLabel.get(row.toClassId) ?? ""} on onPress={() => setChanging(true)} />
                ) : null}
                <Pressable onPress={() => setChanging(true)} className="justify-center rounded-md border border-dashed border-ink-300 px-3 py-2">
                  <Text className="text-sm text-ink-700">Other class…</Text>
                </Pressable>
              </View>
            </View>
            {option("refresh-outline", `Stays in ${card.label}`, "Repeats the year", row.outcome === "DETAIN", () =>
              onPick({ outcome: "DETAIN", toClassId: card.id, provisional: false })
            )}
            {option("school-outline", "Passes out", "Finished school here", row.outcome === "PASS_OUT", () =>
              onPick({ outcome: "PASS_OUT", toClassId: null, provisional: false })
            )}
            {option("exit-outline", "Left school", "TC, moved city …", row.outcome === "LEAVE", () =>
              onPick({ outcome: "LEAVE", toClassId: null, provisional: false })
            )}
            <View className="mt-2 flex-row items-center justify-between rounded-md bg-ink-50 px-3 py-2.5">
              <View className="flex-1 pr-3">
                <Text className="text-sm text-ink-900">Provisional</Text>
                <Text className="text-xs text-ink-700">Promoted, but must clear a re-test</Text>
              </View>
              <Switch
                on={provisional}
                onPress={() => {
                  const on = !provisional;
                  setProvisional(on);
                  if (row.outcome === "PROMOTE") onPick({ outcome: "PROMOTE", toClassId: row.toClassId, provisional: on });
                }}
              />
            </View>
          </>
        ) : (
          <>
            {sameGrade.length ? <Text className="mt-1 text-xs font-medium text-ink-700">Next class</Text> : null}
            <View className="flex-row flex-wrap gap-1.5">
              {sameGrade.map((t) => (
                <ClassChip key={t.id} label={t.label} on={row.toClassId === t.id} onPress={() => onPick({ outcome: "PROMOTE", toClassId: t.id, provisional })} />
              ))}
            </View>
            <Text className="mt-2 text-xs font-medium text-ink-700">Any class</Text>
            <View className="flex-row flex-wrap gap-1.5">
              {others.map((t) => (
                <ClassChip key={t.id} label={t.label} on={row.toClassId === t.id} onPress={() => onPick({ outcome: "PROMOTE", toClassId: t.id, provisional })} />
              ))}
            </View>
            <Pressable onPress={() => setChanging(false)} className="mt-2 self-start">
              <Text className="text-xs font-medium text-clay-600">← Back</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

/** Pick a class: the suggested next grade first, then every other class. */
function ClassPickModal({
  pick,
  targets,
  onClose,
}: {
  pick: { title: string; note: string; fromId: string; nearId: string | null; current: string | null; onPick: (classId: string) => void; onPassOut?: () => void; onStay?: () => void; selected?: "PASS_OUT" | "DETAIN" | null } | null;
  targets: Board["targets"];
  onClose: () => void;
}) {
  if (!pick) return null;
  const nearRank = pick.nearId ? targets.find((t) => t.id === pick.nearId)?.rank ?? null : null;
  const near = nearRank == null ? [] : targets.filter((t) => t.rank === nearRank);
  const rest = targets.filter((t) => t.id !== pick.fromId && !near.some((n) => n.id === t.id));
  const choose = (id: string) => {
    onClose();
    pick.onPick(id);
  };
  const other = (fn?: () => void) => () => {
    onClose();
    fn?.();
  };
  const fromLabel = targets.find((t) => t.id === pick.fromId)?.label ?? "this class";
  return (
    <Modal open title={pick.title} onClose={onClose} sheetOnPhone>
      <View className="gap-2">
        {pick.note ? <Text className="text-xs text-ink-700">{pick.note}</Text> : null}
        {near.length ? (
          <>
            <Text className="mt-1 text-xs font-medium text-ink-700">Next class</Text>
            <View className="flex-row flex-wrap gap-1.5">
              {near.map((t) => (
                <ClassChip key={t.id} label={t.label} on={pick.current === t.id} onPress={() => choose(t.id)} />
              ))}
            </View>
          </>
        ) : null}
        <Text className="mt-2 text-xs font-medium text-ink-700">{near.length ? "Other classes" : "Classes"}</Text>
        <View className="flex-row flex-wrap gap-1.5">
          {rest.map((t) => (
            <ClassChip key={t.id} label={t.label} on={pick.current === t.id} onPress={() => choose(t.id)} />
          ))}
        </View>
        {pick.onPassOut || pick.onStay ? (
          <>
            <Text className="mt-2 text-xs font-medium text-ink-700">Not moving up</Text>
            <View className="flex-row flex-wrap gap-1.5">
              {pick.onPassOut ? (
                <Pressable onPress={other(pick.onPassOut)} className={`flex-row items-center gap-1.5 rounded-md border px-3 py-2 ${pick.selected === "PASS_OUT" ? "border-green-600 bg-green-600" : "border-green-200 bg-green-50"}`}>
                  <Ionicons name="school-outline" size={14} color={pick.selected === "PASS_OUT" ? "#fff" : "#15803d"} />
                  <Text className={`text-sm ${pick.selected === "PASS_OUT" ? "text-white" : "text-green-800"}`}>Pass out</Text>
                </Pressable>
              ) : null}
              {pick.onStay ? (
                <Pressable onPress={other(pick.onStay)} className={`flex-row items-center gap-1.5 rounded-md border px-3 py-2 ${pick.selected === "DETAIN" ? "border-amber-600 bg-amber-600" : "border-amber-200 bg-amber-50"}`}>
                  <Ionicons name="refresh-outline" size={14} color={pick.selected === "DETAIN" ? "#fff" : "#92400e"} />
                  <Text className={`text-sm ${pick.selected === "DETAIN" ? "text-white" : "text-amber-800"}`}>Stays in {fromLabel}</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

function ClassChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className={`rounded-md border px-3 py-2 ${on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}>
      <Text className={`text-sm ${on ? "text-white" : "text-ink-800"}`}>{label}</Text>
    </Pressable>
  );
}

function PastStudentsModal({
  open,
  onClose,
  targets,
  notify,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  targets: Board["targets"];
  notify: (message: string) => void;
  onChanged: () => Promise<void> | void;
}) {
  const { token } = useSession();
  const [rows, setRows] = useState<PastRow[] | null>(null);
  const [q, setQ] = useState("");
  const [restoring, setRestoring] = useState<PastRow | null>(null);

  const load = useCallback(
    async (query: string) => {
      try {
        const res = await act<{ ok: true; students: PastRow[] }>(token, "pastStudents", { q: query });
        setRows(res.students);
      } catch (e) {
        notify(e instanceof Error ? e.message : "Could not load past students.");
      }
    },
    [token, notify]
  );

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void load(q), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [open, q, load]);

  return (
    <Modal open={open} title={restoring ? `Bring back ${restoring.name}` : "Past students"} onClose={() => (restoring ? setRestoring(null) : onClose())} sheetOnPhone wide>
      {restoring ? (
        <View className="gap-2">
          <Text className="text-xs text-ink-700">Pick the class for this year. Old fees, marks and certificates stay as they were.</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {targets.map((t) => (
              <ClassChip
                key={t.id}
                label={t.label}
                on={false}
                onPress={async () => {
                  try {
                    await act(token, "restoreStudent", { studentId: restoring.id, classId: t.id });
                    notify(`${restoring.name} is back in ${t.label}.`);
                    setRestoring(null);
                    await load(q);
                    await onChanged();
                  } catch (e) {
                    notify(e instanceof Error ? e.message : "Could not bring the student back.");
                  }
                }}
              />
            ))}
          </View>
        </View>
      ) : (
        <View className="gap-2">
          <Input value={q} onChangeText={setQ} placeholder="Search name or admission no." />
          {rows === null ? (
            <ActivityIndicator color="#1F45C7" />
          ) : !rows.length ? (
            <Text className="py-6 text-center text-sm text-ink-700">No past students yet. Students who pass out or leave show here.</Text>
          ) : (
            rows.map((r) => (
              <View key={r.id} className="flex-row items-center gap-3 border-b border-ink-100 py-2.5">
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>
                    {r.name} <Text className="text-xs font-normal text-ink-600">· {r.admissionNo}</Text>
                  </Text>
                  <Text className="text-xs text-ink-700" numberOfLines={1}>
                    {[r.leftReason, r.lastClass, r.leftOn ? pretty(r.leftOn) : ""].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <Pressable onPress={() => setRestoring(r)} accessibilityRole="button">
                  <Text className="text-xs font-medium text-clay-600">Bring back</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      )}
    </Modal>
  );
}

type YearSummary = {
  year: { id: string; label: string; startsOn: string; endsOn: string; current: boolean };
  students: number;
  classes: { id: string; label: string; students: number }[];
  cameIn: Partial<Record<Outcome | "JOIN", number>>;
  exams: number;
  fees: { bills: number; billed: number; paid: number; due: number };
  attendanceMarks: number;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

/** Read-only look at one school year (Settings → School year → View). */
export function YearSummaryModal({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const { token } = useSession();
  const [data, setData] = useState<YearSummary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    setError("");
    if (!sessionId) return;
    act<{ ok: true } & YearSummary>(token, "schoolYearSummary", { sessionId })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the year."));
  }, [sessionId, token]);
  if (!sessionId) return null;
  const came = data?.cameIn ?? {};
  const cameTotal = Object.values(came).reduce((n, v) => n + (v ?? 0), 0);
  return (
    <Modal open title={data ? `${data.year.label}${data.year.current ? " · current" : " · past year"}` : "School year"} onClose={onClose} sheetOnPhone wide>
      {error ? (
        <Text className="text-sm text-red-700">{error}</Text>
      ) : !data ? (
        <ActivityIndicator color="#1F45C7" />
      ) : (
        <View className="gap-3">
          <Text className="text-xs text-ink-700">
            {pretty(data.year.startsOn)} – {pretty(data.year.endsOn)}
            {data.year.current ? "" : " · view only"}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <SummaryTile label="Students" value={data.students} />
            <SummaryTile label="Exams" value={data.exams} />
            <SummaryTile label="Fee bills" value={data.fees.bills} />
          </View>
          {data.fees.bills ? (
            <View className="rounded-md border border-ink-200 px-3 py-2.5">
              <Text className="text-xs text-ink-700">Fees</Text>
              <Text className="mt-0.5 text-sm text-ink-900">
                {inr(data.fees.billed)} billed · {inr(data.fees.paid)} paid
                {data.fees.due ? ` · ${inr(data.fees.due)} still due` : " · nothing due"}
              </Text>
            </View>
          ) : null}
          {cameTotal ? (
            <View className="rounded-md border border-ink-200 px-3 py-2.5">
              <Text className="text-xs text-ink-700">How this year started</Text>
              <View className="mt-1.5 flex-row flex-wrap gap-1.5">
                {came.PROMOTE ? <TotalChip text={`${came.PROMOTE} promoted`} cls="border-ink-200 bg-white text-ink-800" /> : null}
                {came.DETAIN ? <TotalChip text={`${came.DETAIN} failed`} cls="border-amber-200 bg-amber-50 text-amber-800" /> : null}
                {came.PASS_OUT ? <TotalChip text={`${came.PASS_OUT} passed out`} cls="border-green-200 bg-green-50 text-green-800" /> : null}
                {came.JOIN ? <TotalChip text={`${came.JOIN} new admissions`} cls="border-sky-200 bg-sky-50 text-sky-800" /> : null}
                {came.LEAVE ? <TotalChip text={`${came.LEAVE} left school`} cls="border-red-200 bg-red-50 text-red-700" /> : null}
              </View>
            </View>
          ) : null}
          <View>
            <Text className="mb-1.5 text-xs font-medium text-ink-700">Classes that year</Text>
            {data.classes.length ? (
              <View className="flex-row flex-wrap gap-1.5">
                {data.classes.map((c) => (
                  <View key={c.id} className="rounded-md border border-ink-100 bg-ink-50 px-2.5 py-1">
                    <Text className="text-xs text-ink-800">
                      {c.label} · {c.students}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-xs text-ink-600">No class records for this year.</Text>
            )}
          </View>
        </View>
      )}
    </Modal>
  );
}
