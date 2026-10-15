import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal as RnModal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { act } from "../lib/mutate";
import type { AdmissionFormField } from "../lib/record";
import { useSession } from "../lib/session";
import { uploadFile, type PickedFile } from "../lib/upload";
import { DocViewer } from "./doc-viewer";
import { AdmissionCustomField } from "./student-admit-form";
import { Toast, useToast } from "./ui";

type RequestState = { id: string; status: "PENDING" | "REJECTED"; value: string; note: string; at: string } | null;
export type ParentDetails = {
  student: { id: string; name: string; classLabel: string };
  missing: { field: AdmissionFormField; request: RequestState }[];
  counts: { toSend: number; waiting: number; required: number };
};

/** Loads what the school still needs for this child. */
export function useParentDetails(studentId?: string) {
  const { token } = useSession();
  const [data, setData] = useState<ParentDetails | null>(null);
  const load = useCallback(async () => {
    if (!token || !studentId) return;
    try {
      setData(await api<ParentDetails>(`/parent-details?studentId=${encodeURIComponent(studentId)}`, token));
    } catch {
      setData(null);
    }
  }, [studentId, token]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, reload: load };
}

/** Home card: only shows when something is missing or waiting. */
export function ParentDetailsCard({ data, onOpen }: { data: ParentDetails | null; onOpen: () => void }) {
  if (!data || (!data.counts.toSend && !data.counts.waiting)) return null;
  const first = data.student.name.split(" ")[0];
  const sending = data.counts.toSend;
  return (
    <Pressable onPress={onOpen} className="flex-row items-center gap-3 rounded-2xl border border-[#F5D98B] bg-[#FFFBEB] p-3.5">
      <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#FEF3C7]">
        <Ionicons name="document-attach-outline" size={20} color="#B45309" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-semibold text-ink-900">
          {sending ? `${sending} detail${sending === 1 ? "" : "s"} needed for ${first}` : "Sent to school"}
        </Text>
        <Text className="mt-0.5 text-[12px] text-ink-600" numberOfLines={1}>
          {sending
            ? data.counts.required
              ? `${data.counts.required} required by the school · tap to add`
              : "Tap to add them from your phone"
            : `${data.counts.waiting} waiting for the office to approve`}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#B45309" />
    </Pressable>
  );
}

function shortValue(field: AdmissionFormField, value: string) {
  if (field.type === "file") return "File uploaded";
  return value.length > 60 ? `${value.slice(0, 57)}…` : value;
}

function DetailRow({
  item,
  studentId,
  onSent,
}: {
  item: ParentDetails["missing"][number];
  studentId: string;
  onSent: (message: string) => Promise<void>;
}) {
  const { token } = useSession();
  const { field, request } = item;
  const waiting = request?.status === "PENDING";
  const [editing, setEditing] = useState(!waiting);
  const [value, setValue] = useState(waiting || field.type === "file" ? "" : request?.value || "");
  const [file, setFile] = useState<PickedFile | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = field.type === "file" ? Boolean(file) : Boolean(value.trim());

  async function send() {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      let payload = value.trim();
      if (field.type === "file" && file) {
        const uploaded = await uploadFile(token, file, { kind: "parentDocument", studentId });
        payload = uploaded.path;
      }
      await act(token, "submitProfileRequest", { studentId, fieldId: field.id, value: payload });
      setEditing(false);
      setFile(undefined);
      await onSent(`${field.label} sent to the school.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="rounded-2xl border border-ink-100 bg-white p-4">
      <View className="flex-row items-start gap-2">
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-ink-900">{field.label}</Text>
          {field.helpText ? <Text className="mt-0.5 text-[12px] text-ink-500">{field.helpText}</Text> : null}
        </View>
        {waiting ? (
          <View className="flex-row items-center gap-1 rounded-full bg-[#FFF7E8] px-2 py-0.5">
            <Ionicons name="time-outline" size={12} color="#B45309" />
            <Text className="text-[11px] font-semibold text-[#B45309]">Waiting for school</Text>
          </View>
        ) : field.required ? (
          <View className="rounded-full bg-[#FDECEC] px-2 py-0.5">
            <Text className="text-[11px] font-semibold text-[#B42318]">Required</Text>
          </View>
        ) : (
          <View className="rounded-full bg-ink-100 px-2 py-0.5">
            <Text className="text-[11px] font-semibold text-ink-500">Optional</Text>
          </View>
        )}
      </View>

      {request?.status === "REJECTED" ? (
        <View className="mt-3 flex-row gap-2 rounded-xl bg-[#FDECEC] p-2.5">
          <Ionicons name="alert-circle" size={16} color="#B42318" />
          <Text className="min-w-0 flex-1 text-[12px] leading-5 text-[#7F1D1D]">
            <Text className="font-semibold">School asked for a fix: </Text>
            {request.note}
          </Text>
        </View>
      ) : null}

      {waiting && !editing ? (
        <View className="mt-3 flex-row items-center gap-2">
          <Text className="min-w-0 flex-1 text-[13px] text-ink-600" numberOfLines={1}>
            You sent: {shortValue(field, request!.value)}
          </Text>
          <Pressable onPress={() => setEditing(true)} hitSlop={8}>
            <Text className="text-[13px] font-semibold text-[#1F45C7]">Change</Text>
          </Pressable>
        </View>
      ) : (
        <View className="mt-3 gap-3">
          <AdmissionCustomField
            field={{ ...field, label: "", required: false, helpText: undefined }}
            value={value}
            file={file}
            onChange={setValue}
            onFile={(f) => setFile(f || undefined)}
          />
          {error ? <Text className="text-[12px] text-red-600">{error}</Text> : null}
          <Pressable
            onPress={() => void send()}
            disabled={!ready || busy}
            className={`h-11 flex-row items-center justify-center gap-2 rounded-xl ${ready && !busy ? "bg-[#1F45C7]" : "bg-ink-200"}`}
          >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="paper-plane-outline" size={16} color={ready ? "#fff" : "#94A3B8"} />}
            <Text className={`text-[14px] font-semibold ${ready && !busy ? "text-white" : "text-ink-500"}`}>{busy ? "Sending…" : "Send to school"}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

export function ParentDetailsSheet({
  open,
  onClose,
  data,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  data: ParentDetails | null;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  return (
    <RnModal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-[#F6F7FB]" edges={["top", "bottom"]}>
        <View className="flex-row items-center gap-2 border-b border-ink-100 bg-white px-2 py-2">
          <Pressable onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full" accessibilityLabel="Close">
            <Ionicons name="chevron-back" size={22} color="#0F172A" />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="text-[16px] font-semibold text-ink-900" numberOfLines={1}>
              Details for {data?.student.name.split(" ")[0] || "your child"}
            </Text>
            <Text className="text-[12px] text-ink-500" numberOfLines={1}>
              From the school's admission form
            </Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <View className="flex-row gap-2 rounded-2xl bg-[#EEF3FF] p-3">
            <Ionicons name="shield-checkmark-outline" size={18} color="#1F45C7" />
            <Text className="min-w-0 flex-1 text-[12px] leading-5 text-[#1E3A8A]">
              The school still needs these. Anything you send is checked by the office before it's added to {data?.student.name.split(" ")[0] || "your child"}'s record.
            </Text>
          </View>
          {data && data.missing.length ? (
            data.missing.map((item) => (
              <DetailRow
                key={`${item.field.id}-${item.request?.status || "new"}-${item.request?.at || ""}`}
                item={item}
                studentId={data.student.id}
                onSent={async (message) => {
                  toast.show(message);
                  await onChanged();
                }}
              />
            ))
          ) : (
            <View className="items-center rounded-2xl bg-white px-6 py-10">
              <View className="h-14 w-14 items-center justify-center rounded-full bg-[#ECF8F0]">
                <Ionicons name="checkmark-done" size={26} color="#18794E" />
              </View>
              <Text className="mt-3 text-[16px] font-semibold text-ink-900">All details are complete</Text>
              <Text className="mt-1 text-center text-[13px] text-ink-500">The school has everything it needs.</Text>
            </View>
          )}
        </ScrollView>
        {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      </SafeAreaView>
    </RnModal>
  );
}

/* ----------------------------------------------------------- office review */

type PendingUpdate = {
  id: string;
  fieldId: string;
  fieldLabel: string;
  fieldType: string;
  value: string;
  at: string;
  student: { id: string; name: string; classLabel: string; admissionNo: string };
  parent: { name: string; phone: string };
};

function ago(iso: string) {
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Desk card + review sheet for details parents have sent. Renders nothing when the queue is empty. */
export function ParentUpdatesReview() {
  const { token } = useSession();
  const toast = useToast();
  const [rows, setRows] = useState<PendingUpdate[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [rejecting, setRejecting] = useState("");
  const [note, setNote] = useState("");
  const [doc, setDoc] = useState<{ url: string; title: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api<{ requests: PendingUpdate[] }>("/profile-requests", token);
      setRows(res.requests);
    } catch {
      setRows([]);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  async function viewFile(row: PendingUpdate) {
    try {
      const res = await api<{ url: string }>("/files/view-url", token, { method: "POST", body: JSON.stringify({ path: row.value }) });
      setDoc({ url: res.url, title: `${row.fieldLabel} · ${row.student.name}` });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not open the file.");
    }
  }

  async function decide(row: PendingUpdate, decision: "APPROVE" | "REJECT") {
    setBusy(row.id);
    try {
      await act(token, "reviewProfileRequest", { id: row.id, decision, note: decision === "REJECT" ? note : "" });
      toast.show(decision === "APPROVE" ? `${row.fieldLabel} added to ${row.student.name}'s record.` : "Sent back to the parent.");
      setRejecting("");
      setNote("");
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy("");
    }
  }

  if (!rows.length && !open) return null;

  return (
    <>
      <Pressable onPress={() => setOpen(true)} className="mb-4 flex-row items-center gap-3 rounded-2xl border border-[#C7D7FE] bg-[#F5F8FF] p-3.5">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#E0E8FF]">
          <Ionicons name="people-outline" size={20} color="#1F45C7" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-ink-900">
            {rows.length} parent update{rows.length === 1 ? "" : "s"} to review
          </Text>
          <Text className="mt-0.5 text-[12px] text-ink-600" numberOfLines={1}>
            Admission details sent from the parent app
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#1F45C7" />
      </Pressable>

      <RnModal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setOpen(false)}>
        <SafeAreaView className="flex-1 bg-[#F6F7FB]" edges={["top", "bottom"]}>
          <View className="flex-row items-center gap-2 border-b border-ink-100 bg-white px-2 py-2">
            <Pressable onPress={() => setOpen(false)} className="h-10 w-10 items-center justify-center rounded-full" accessibilityLabel="Close">
              <Ionicons name="chevron-back" size={22} color="#0F172A" />
            </Pressable>
            <View className="min-w-0 flex-1">
              <Text className="text-[16px] font-semibold text-ink-900">Parent updates</Text>
              <Text className="text-[12px] text-ink-500">Approve to add it to the student record</Text>
            </View>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32, maxWidth: 720, width: "100%", alignSelf: "center" }} keyboardShouldPersistTaps="handled">
            {rows.length ? (
              rows.map((row) => (
                <View key={row.id} className="rounded-2xl border border-ink-100 bg-white p-4">
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="min-w-0 flex-1">
                      <Text className="text-[15px] font-semibold text-ink-900" numberOfLines={1}>
                        {row.student.name}
                        <Text className="font-normal text-ink-500">
                          {row.student.classLabel ? ` · ${row.student.classLabel}` : ""}
                        </Text>
                      </Text>
                      <Text className="mt-0.5 text-[12px] text-ink-500" numberOfLines={1}>
                        {row.parent.name} sent this · {ago(row.at)}
                      </Text>
                    </View>
                  </View>
                  <View className="mt-3 rounded-xl bg-ink-50 p-3">
                    <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{row.fieldLabel}</Text>
                    {row.fieldType === "file" ? (
                      <Pressable onPress={() => void viewFile(row)} className="mt-1.5 flex-row items-center gap-1.5 self-start">
                        <Ionicons name="document-text-outline" size={16} color="#1F45C7" />
                        <Text className="text-[14px] font-semibold text-[#1F45C7]">View file</Text>
                      </Pressable>
                    ) : (
                      <Text className="mt-1 text-[14px] text-ink-900">{row.value}</Text>
                    )}
                  </View>
                  {rejecting === row.id ? (
                    <View className="mt-3 gap-2">
                      <TextInput
                        value={note}
                        onChangeText={setNote}
                        placeholder="What should the parent fix? e.g. photo is blurry"
                        placeholderTextColor="#94A3B8"
                        multiline
                        className="min-h-[64px] rounded-xl border border-ink-200 bg-white px-3 py-2 text-[14px] text-ink-900"
                      />
                      <View className="flex-row gap-2">
                        <Pressable onPress={() => setRejecting("")} className="h-10 flex-1 items-center justify-center rounded-xl border border-ink-200">
                          <Text className="text-[13px] font-semibold text-ink-700">Cancel</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => void decide(row, "REJECT")}
                          disabled={!note.trim() || busy === row.id}
                          className={`h-10 flex-1 items-center justify-center rounded-xl ${note.trim() ? "bg-[#B42318]" : "bg-ink-200"}`}
                        >
                          <Text className={`text-[13px] font-semibold ${note.trim() ? "text-white" : "text-ink-500"}`}>Send back</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View className="mt-3 flex-row gap-2">
                      <Pressable
                        onPress={() => {
                          setRejecting(row.id);
                          setNote("");
                        }}
                        className="h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-ink-200"
                      >
                        <Ionicons name="arrow-undo-outline" size={15} color="#B42318" />
                        <Text className="text-[13px] font-semibold text-[#B42318]">Ask to fix</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void decide(row, "APPROVE")}
                        disabled={busy === row.id}
                        className="h-10 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-[#18794E]"
                      >
                        {busy === row.id ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="checkmark" size={16} color="#fff" />}
                        <Text className="text-[13px] font-semibold text-white">Approve</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))
            ) : (
              <View className="items-center rounded-2xl bg-white px-6 py-10">
                <Ionicons name="checkmark-done-circle" size={36} color="#18794E" />
                <Text className="mt-2 text-[15px] font-semibold text-ink-900">All reviewed</Text>
              </View>
            )}
          </ScrollView>
          {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
        </SafeAreaView>
        <DocViewer url={doc?.url ?? null} title={doc?.title ?? ""} onClose={() => setDoc(null)} />
      </RnModal>
    </>
  );
}
