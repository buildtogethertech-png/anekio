import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { act } from "../lib/mutate";
import type { RecordPayload } from "../lib/record";
import { pickFile, uploadFile, type PickedFile } from "../lib/upload";
import { Modal, Sheet } from "./ui";

/**
 * Teacher hands the question paper to the exam office. Nothing is "ready" until the office
 * confirms it (Received) — until then the paper waits, and the teacher can undo.
 * A soft copy (PDF / photo / Word) is optional.
 */

type MarkSheet = NonNullable<RecordPayload["markSheets"]>[number];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function prettyDay(value?: string) {
  if (!value) return "";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  const date = new Date(y, m - 1, d);
  return `${DAYS[date.getDay()]}, ${d} ${MONTHS[m - 1]}`;
}

function prettyWhen(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return `${date.getDate()} ${MONTHS[date.getMonth()]}, ${time}`;
}

function subjectOnly(subject: string) {
  return subject.replace(/^[A-Z0-9-]{2,12}\s*·\s*/, "");
}

export function PaperHandoverSheet({
  sheet,
  token,
  onClose,
  onDone,
}: {
  sheet: MarkSheet | null;
  token: string | null;
  onClose: () => void;
  onDone: (message: string) => void | Promise<void>;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 640;
  const [note, setNote] = useState("");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [busy, setBusy] = useState<"" | "hand" | "undo">("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (sheet) {
      setNote("");
      setFile(null);
      setError("");
      setBusy("");
    }
  }, [sheet?.examId]);

  const name = sheet ? subjectOnly(sheet.subject) : "";
  const where = sheet ? [sheet.seriesName, sheet.classLabel, sheet.date ? `exam ${prettyDay(sheet.date)}` : ""].filter(Boolean).join(" · ") : "";
  const waiting = Boolean(sheet?.paperWaiting);
  const returned = Boolean(sheet?.paperReturnNote) && !waiting;

  async function handOver() {
    if (!sheet) return;
    setBusy("hand");
    setError("");
    try {
      if (file) await uploadFile(token, file, { kind: "question", examId: sheet.examId });
      await act(token, "handOverExamPaper", { examId: sheet.examId, note });
      await onDone(`${name} paper handed over. Waiting for the office to confirm.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not hand over the paper.");
    } finally {
      setBusy("");
    }
  }

  async function undo() {
    if (!sheet) return;
    setBusy("undo");
    setError("");
    try {
      await act(token, "undoExamPaperHandover", { examId: sheet.examId });
      await onDone(`Handover undone. ${name} paper is back on your list.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not undo.");
    } finally {
      setBusy("");
    }
  }

  async function chooseFile() {
    try {
      const picked = await pickFile("application/pdf,image/*,.doc,.docx");
      if (picked) setFile(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not pick a file.");
    }
  }

  const header = (
    <View className="flex-row items-center gap-3">
      <View className={`h-12 w-12 items-center justify-center rounded-2xl ${waiting ? "bg-amber-50" : "bg-[#EEF3FF]"}`}>
        <Ionicons name={waiting ? "time-outline" : "document-text-outline"} size={22} color={waiting ? "#B45309" : "#1F45C7"} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[18px] font-semibold text-ink-900">{waiting ? `${name} paper is with the office` : `Hand over ${name} paper?`}</Text>
        {where ? <Text className="mt-0.5 text-[13px] text-ink-700">{where}</Text> : null}
      </View>
    </View>
  );

  const body = waiting ? (
    <View className="gap-4">
      {header}
      <View className="gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
        <Text className="text-[14px] font-medium text-amber-900">Waiting for the exam office to confirm</Text>
        <Text className="text-[13px] text-amber-800">{`Handed over ${prettyWhen(sheet?.paperHandedAt)}. It counts as ready once they tap Received.`}</Text>
        {sheet?.paperHandNote ? <Text className="mt-1 text-[13px] text-amber-900">{`Your note: ${sheet.paperHandNote}`}</Text> : null}
        {sheet?.paperFileName ? <Text className="text-[13px] text-amber-900">{`Soft copy: ${sheet.paperFileName}`}</Text> : null}
      </View>
      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      <View className="gap-2">
        <BigButton label="Close" onPress={onClose} />
        <BigButton label={busy === "undo" ? "Undoing…" : "Undo handover"} tone="danger" busy={busy === "undo"} onPress={() => void undo()} />
      </View>
    </View>
  ) : (
    <View className="gap-4">
      {header}
      {returned ? (
        <View className="flex-row items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <Ionicons name="return-down-back-outline" size={16} color="#B91C1C" />
          <View className="min-w-0 flex-1">
            <Text className="text-[13px] font-semibold text-red-800">The office sent it back</Text>
            <Text className="text-[13px] text-red-800">{sheet?.paperReturnNote}</Text>
          </View>
        </View>
      ) : null}
      <Text className="text-[14px] leading-5 text-ink-700">
        Give the paper to the exam office, then confirm here. It shows as ready once the office taps Received.
      </Text>
      <View className="gap-1.5">
        <Text className="text-xs font-medium text-ink-800">Note for the office (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          maxLength={300}
          placeholder="e.g. 2 sets in a sealed envelope"
          placeholderTextColor="#94A3B8"
          className="rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900"
        />
      </View>
      {file ? (
        <View className="flex-row items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5">
          <Ionicons name="attach-outline" size={16} color="#334155" />
          <Text className="min-w-0 flex-1 text-[13px] text-ink-900" numberOfLines={1}>{file.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Remove soft copy" hitSlop={8} onPress={() => setFile(null)}>
            <Ionicons name="close" size={16} color="#64748B" />
          </Pressable>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => void chooseFile()} className="flex-row items-center gap-2 self-start py-1">
          <Ionicons name="attach-outline" size={16} color="#2563EB" />
          <Text className="text-[14px] font-medium text-clay-600">Attach soft copy (optional)</Text>
        </Pressable>
      )}
      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      <View className="gap-2">
        <BigButton
          label={busy === "hand" ? (file ? "Uploading…" : "Saving…") : "Yes, I've handed it over"}
          tone="primary"
          busy={busy === "hand"}
          onPress={() => void handOver()}
        />
        <BigButton label="Cancel" onPress={onClose} />
      </View>
    </View>
  );

  if (phone) {
    return (
      <Sheet open={Boolean(sheet)} onClose={() => !busy && onClose()}>
        <View className="px-5 pb-2 pt-1">{body}</View>
      </Sheet>
    );
  }
  return (
    <Modal open={Boolean(sheet)} title={waiting ? "Paper with the office" : "Hand over paper"} onClose={() => !busy && onClose()}>
      {body}
    </Modal>
  );
}

function BigButton({ label, onPress, tone, busy }: { label: string; onPress: () => void; tone?: "primary" | "danger"; busy?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      className={`h-12 flex-row items-center justify-center gap-2 rounded-xl ${
        tone === "primary" ? "bg-clay-500" : tone === "danger" ? "border border-red-200 bg-white" : "border border-ink-200 bg-white"
      } ${busy ? "opacity-70" : ""}`}
    >
      {busy ? <ActivityIndicator size="small" color={tone === "primary" ? "#fff" : "#B91C1C"} /> : null}
      <Text className={`text-[15px] font-semibold ${tone === "primary" ? "text-white" : tone === "danger" ? "text-red-700" : "text-ink-800"}`}>{label}</Text>
    </Pressable>
  );
}
