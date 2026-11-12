import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { openInAppDoc } from "../lib/in-app-doc";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";
import { DateField } from "./date-field";
import { Button, Input, Modal } from "./ui";

const REASONS = ["Transfer to another school", "Moved to another city", "Fees not paid", "Other"];

type MovingStudent = { id: string; name: string; classId?: string | null; classLabel?: string; dueAmount?: number; dueNow?: string };

/**
 * Move a student out of the school: optional transfer certificate, then the student goes to Past students
 * (no more invoices, attendance or exams). Undo puts them back in the same class.
 */
export function MoveOutModal({
  open,
  student,
  onClose,
  onDone,
  documentData,
}: {
  open: boolean;
  student: MovingStudent | null;
  /** School and student record for the TC (the same data the Documents button sends). */
  documentData?: Record<string, unknown>;
  onClose: () => void;
  /** Called once the student has moved out (or was brought back); the caller reloads. */
  onDone: (message: string) => void | Promise<void>;
}) {
  const { token } = useSession();
  const today = new Date().toISOString().slice(0, 10);
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState("");
  const [leftOn, setLeftOn] = useState(today);
  const [issueTc, setIssueTc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<null | { tcUrl?: string; tcNumber?: string; classId?: string | null }>(null);

  useEffect(() => {
    if (!open) return;
    setReason(REASONS[0]);
    setOther("");
    setLeftOn(today);
    setIssueTc(false);
    setError("");
    setDone(null);
  }, [open, student?.id]);

  if (!student) return null;
  const finalReason = reason === "Other" ? other.trim() || "Left school" : reason;
  const owed = (student.dueAmount || 0) > 0;
  const leftLabel = new Date(`${leftOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  async function moveOut() {
    if (!student) return;
    setBusy(true);
    setError("");
    try {
      // TC first, while the student is still in their class, so it prints the right class.
      let tc: { documentUrl?: string; documentNumber?: string } | null = null;
      if (issueTc) {
        tc = await act<{ documentUrl: string; documentNumber: string }>(token, "issueDocument", {
          templateId: "builtin:TRANSFER_CERTIFICATE",
          subjectType: "STUDENT",
          subjectId: student.id,
          subjectLabel: student.name,
          data: { ...(documentData || {}), document: {}, tc: { leavingDate: leftLabel, reason: finalReason } },
        });
      }
      await act(token, "markStudentLeft", { studentId: student.id, reason: finalReason, leftOn });
      setDone({ tcUrl: tc?.documentUrl, tcNumber: tc?.documentNumber, classId: student.classId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not move the student out.");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!student || !done?.classId) return;
    setBusy(true);
    setError("");
    try {
      await act(token, "restoreStudent", { studentId: student.id, classId: done.classId });
      await onDone(`${student.name} is back in ${student.classLabel || "their class"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not bring the student back.");
    } finally {
      setBusy(false);
    }
  }

  const finish = () => onDone(`${student.name} moved to Past students. No new fees will be raised.`);

  if (done) {
    return (
      <Modal
        open={open}
        title="Moved out"
        sheetOnPhone
        onClose={() => void finish()}
        footer={
          <View className="flex-row gap-2">
            <Button variant="ghost" disabled={busy || !done.classId} onPress={() => void undo()}>
              {busy ? "Undoing…" : "Undo"}
            </Button>
            <Button className="flex-1" disabled={busy} onPress={() => void finish()}>
              Done
            </Button>
          </View>
        }
      >
        <View className="items-center gap-3 py-2">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
            <Ionicons name="checkmark" size={28} color="#15803D" />
          </View>
          <Text className="text-center text-[17px] font-semibold text-ink-900">{student.name} has moved out</Text>
          <Text className="text-center text-[14px] leading-5 text-ink-600">
            {`Now in Past students · left ${leftLabel} · ${finalReason}. No new invoices, attendance or exams. Undo brings them back to ${student.classLabel || "their class"}.`}
          </Text>
          {done.tcUrl ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="View transfer certificate"
              onPress={() => {
                const url = done.tcUrl as string;
                void Promise.resolve(finish()).then(() => openInAppDoc(url, `Transfer certificate · ${student.name}`));
              }}
              className="mt-1 w-full flex-row items-center gap-3 rounded-2xl border border-ink-100 bg-ink-50 px-4 py-3.5"
            >
              <Ionicons name="document-text-outline" size={20} color="#1F45C7" />
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-semibold text-ink-900">Transfer certificate</Text>
                <Text className="text-[13px] text-ink-500">{`${done.tcNumber || "Issued"} · saved in Documents`}</Text>
              </View>
              <Text className="text-[14px] font-semibold text-[#1F45C7]">View</Text>
            </Pressable>
          ) : null}
          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
        </View>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={`Move out · ${student.name}`}
      sheetOnPhone
      onClose={() => !busy && onClose()}
      footer={
        <View className="flex-row gap-2">
          <Button variant="ghost" disabled={busy} onPress={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={busy || (reason === "Other" && !other.trim())} onPress={() => void moveOut()}>
            {busy ? "Moving…" : issueTc ? "Issue TC & move out" : "Move out"}
          </Button>
        </View>
      }
    >
      <View className="gap-5">
        <Text className="text-[14px] leading-5 text-ink-600">
          {`${student.name} (${student.classLabel || "class"}) goes to Past students. No new fees, attendance or exams after this. You can undo it.`}
        </Text>

        {owed ? (
          <View className="flex-row items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
            <Ionicons name="alert-circle-outline" size={18} color="#B45309" />
            <Text className="min-w-0 flex-1 text-[13px] leading-5 text-amber-900">
              {`${student.dueNow || "Some fees"} is still due. It stays on record; collect it from Fees before or after.`}
            </Text>
          </View>
        ) : null}

        <View className="gap-2">
          <Text className="text-[13px] font-semibold uppercase tracking-wide text-ink-500">Reason</Text>
          <View className="flex-row flex-wrap gap-2">
            {REASONS.map((r) => (
              <Pressable
                key={r}
                accessibilityRole="radio"
                accessibilityState={{ selected: reason === r }}
                onPress={() => setReason(r)}
                className={`rounded-full border px-3.5 py-2 ${reason === r ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
              >
                <Text className={`text-[13px] font-medium ${reason === r ? "text-[#1F45C7]" : "text-ink-700"}`}>{r}</Text>
              </Pressable>
            ))}
          </View>
          {reason === "Other" ? <Input value={other} onChangeText={setOther} placeholder="Write the reason" maxLength={120} /> : null}
        </View>

        <View className="gap-2">
          <Text className="text-[13px] font-semibold uppercase tracking-wide text-ink-500">Leaving date</Text>
          <DateField plain value={leftOn} max={today} onChange={setLeftOn} />
        </View>

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: issueTc }}
          onPress={() => setIssueTc((v) => !v)}
          className={`flex-row items-center gap-3 rounded-2xl border px-4 py-3.5 ${issueTc ? "border-[#1F45C7] bg-[#F5F8FF]" : "border-ink-200 bg-white"}`}
        >
          <View className={`h-5 w-5 items-center justify-center rounded-md border ${issueTc ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-300 bg-white"}`}>
            {issueTc ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold text-ink-900">Issue transfer certificate</Text>
            <Text className="text-[13px] text-ink-500">Optional. Saved in the student's Documents with the leaving date and reason.</Text>
          </View>
        </Pressable>

        {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      </View>
    </Modal>
  );
}
