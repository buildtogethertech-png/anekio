import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from "react-native";
import { act } from "../lib/mutate";
import { Modal } from "./ui";

/**
 * Create / edit / duplicate an exam. Any name, any classes, as many as the school wants.
 * Creating leads straight into scheduling (dates, times, teachers).
 */

export type ExamFormValue = {
  id?: string;
  name: string;
  sessionId: string;
  classIds: string[];
  maxMarks: number;
  weight: number;
};

type Mode = "create" | "edit" | "duplicate";

const SUGGESTIONS = ["Unit Test", "Class Test", "Half Yearly", "Annual", "Pre-board", "Weekly Test"];

export function ExamFormModal({
  open,
  mode,
  initial,
  sessions,
  classes,
  otherWeights,
  token,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: Mode;
  initial: ExamFormValue | null;
  sessions: { id: string; label: string; current?: boolean }[];
  classes: { id: string; label: string }[];
  /** Sum of the final-result % of the year's other exams, to warn about going over 100%. */
  otherWeights: (sessionId: string, exceptId?: string) => number;
  token: string | null;
  onClose: () => void;
  onSaved: (result: { id: string; sessionId: string; classIds: string[]; created: boolean }) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [maxMarks, setMaxMarks] = useState("80");
  const [counts, setCounts] = useState(false);
  const [weight, setWeight] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const current = sessions.find((s) => s.current) || sessions[0];
    setName(mode === "duplicate" && initial ? `${initial.name}` : initial?.name || "");
    setSessionId(initial?.sessionId || current?.id || "");
    setClassIds(initial?.classIds?.length ? initial.classIds : classes.map((c) => c.id));
    setMaxMarks(String(initial?.maxMarks || 80));
    setCounts(Boolean(initial?.weight));
    setWeight(String(initial?.weight || 10));
    setError("");
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id, mode]);

  const allOn = classIds.length === classes.length;
  const share = counts ? Math.max(0, Math.min(100, Number(weight) || 0)) : 0;
  const total = otherWeights(sessionId, mode === "edit" ? initial?.id : undefined) + share;
  const marks = Number(maxMarks) || 0;
  const ok = name.trim().length > 0 && classIds.length > 0 && marks >= 1 && marks <= 1000 && Boolean(sessionId) && (!counts || share > 0);

  async function save() {
    setBusy(true);
    setError("");
    const body = {
      sessionId,
      name: name.trim(),
      maxMarks: marks,
      weight: share,
      // Every class → store none, so new classes are included automatically.
      classIds: allOn ? [] : classIds,
    };
    try {
      if (mode === "edit" && initial?.id) {
        await act(token, "updateExamItem", { ...body, id: initial.id });
        await onSaved({ id: initial.id, sessionId, classIds, created: false });
      } else {
        const res = await act<{ ok: true; id: string }>(token, "createExam", body);
        await onSaved({ id: res.id, sessionId, classIds, created: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the exam.");
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "edit" ? "Edit exam" : mode === "duplicate" ? "Duplicate exam" : "New exam";
  const action = mode === "edit" ? "Save changes" : "Next: set dates";

  return (
    <Modal
      open={open}
      title={title}
      onClose={() => !busy && onClose()}
      wide
      footer={
        <View className="flex-row flex-wrap items-center justify-end gap-2">
          <Pressable accessibilityRole="button" onPress={onClose} disabled={busy} className="h-10 justify-center px-3">
            <Text className="text-[14px] font-medium text-ink-700">Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!ok || busy}
            onPress={() => void save()}
            className={`h-10 flex-row items-center gap-2 rounded-md px-5 ${ok && !busy ? "bg-clay-500" : "bg-ink-200"}`}
          >
            {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
            <Text className={`text-[14px] font-semibold ${ok && !busy ? "text-white" : "text-ink-500"}`}>{action}</Text>
            {mode !== "edit" && ok && !busy ? <Ionicons name="arrow-forward" size={15} color="#fff" /> : null}
          </Pressable>
        </View>
      }
    >
      <View className="gap-5">
        {/* Name */}
        <View className="gap-2">
          <Text className="text-[13px] font-semibold text-ink-900">Exam name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={80}
            autoFocus={mode !== "edit"}
            placeholder="e.g. Unit Test 3, Half Yearly"
            placeholderTextColor="#94A3B8"
            className="h-11 rounded-lg border border-ink-200 bg-white px-3 text-[15px] text-ink-900"
          />
          {mode === "create" ? (
            <View className="flex-row flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Pressable key={s} accessibilityRole="button" onPress={() => setName(s)} className="h-7 justify-center rounded-full border border-ink-200 bg-white px-3">
                  <Text className="text-[12px] font-medium text-ink-800">{s}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {/* Year */}
        <View className="gap-2">
          <Text className="text-[13px] font-semibold text-ink-900">Year</Text>
          <View className="flex-row flex-wrap gap-2">
            {sessions.map((s) => {
              const on = s.id === sessionId;
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  disabled={mode === "edit"}
                  onPress={() => setSessionId(s.id)}
                  className={`h-9 flex-row items-center gap-1.5 rounded-full border px-3.5 ${on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"} ${mode === "edit" && !on ? "opacity-40" : ""}`}
                >
                  <Text className={`text-[13px] font-medium ${on ? "text-white" : "text-ink-800"}`}>{s.label}</Text>
                  {s.current ? <Text className={`text-[11px] ${on ? "text-white/80" : "text-ink-500"}`}>now</Text> : null}
                </Pressable>
              );
            })}
          </View>
          {mode === "edit" ? <Text className="text-[12px] text-ink-500">To use this exam in another year, duplicate it.</Text> : null}
        </View>

        {/* Classes */}
        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-[13px] font-semibold text-ink-900">Classes</Text>
            <Pressable onPress={() => setClassIds(allOn ? [] : classes.map((c) => c.id))}>
              <Text className="text-[12px] font-medium text-clay-600">{allOn ? "Clear all" : "Select all"}</Text>
            </Pressable>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {classes.map((c) => {
              const on = classIds.includes(c.id);
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setClassIds((cur) => (on ? cur.filter((id) => id !== c.id) : [...cur, c.id]))}
                  className={`h-8 justify-center rounded-full border px-3 ${on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}
                >
                  <Text className={`text-[13px] font-medium ${on ? "text-white" : "text-ink-800"}`}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>
          {!classIds.length ? <Text className="text-[12px] text-red-700">Pick at least one class.</Text> : null}
        </View>

        {/* Marks + final result */}
        <View className="flex-row flex-wrap gap-4">
          <View className="gap-2">
            <Text className="text-[13px] font-semibold text-ink-900">Max marks</Text>
            <TextInput
              value={maxMarks}
              onChangeText={(v) => setMaxMarks(v.replace(/\D/g, "").slice(0, 4))}
              keyboardType="number-pad"
              className="h-11 w-28 rounded-lg border border-ink-200 bg-white px-3 text-[15px] font-semibold text-ink-900"
            />
          </View>
          <View className="min-w-[240px] flex-1 gap-2">
            <Text className="text-[13px] font-semibold text-ink-900">Counts in the final result?</Text>
            <View className="min-h-11 flex-row flex-wrap items-center gap-3 rounded-lg border border-ink-200 bg-white px-3 py-1.5">
              <Switch value={counts} onValueChange={setCounts} />
              {counts ? (
                <View className="flex-row items-center gap-2">
                  <TextInput
                    value={weight}
                    onChangeText={(v) => setWeight(v.replace(/\D/g, "").slice(0, 3))}
                    keyboardType="number-pad"
                    className="h-9 w-16 rounded-md border border-ink-200 text-center text-[15px] font-semibold text-ink-900"
                  />
                  <Text className="text-[13px] text-ink-700">% of the final result</Text>
                </View>
              ) : (
                <Text className="text-[13px] text-ink-700">No, practice / class test</Text>
              )}
            </View>
          </View>
        </View>
        {counts && total !== 100 ? (
          <View className={`flex-row items-start gap-2 rounded-lg px-3 py-2.5 ${total > 100 ? "bg-red-50" : "bg-amber-50"}`}>
            <Ionicons name="alert-circle-outline" size={15} color={total > 100 ? "#B91C1C" : "#B45309"} />
            <Text className={`min-w-0 flex-1 text-[12px] leading-5 ${total > 100 ? "text-red-800" : "text-amber-900"}`}>
              {total > 100
                ? `Exams this year now add up to ${total}% of the final result — more than 100%. Lower one of them.`
                : `Exams this year add up to ${total}% of the final result so far. It should reach 100% by the last exam.`}
            </Text>
          </View>
        ) : null}

        {error ? <Text className="text-[13px] text-red-700">{error}</Text> : null}
      </View>
    </Modal>
  );
}
