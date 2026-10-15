import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal as RnModal, Pressable, RefreshControl, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Toast, useToast } from "../../components/ui";
import { PhoneTopBar } from "../../components/notice-bell";
import { api, type Notice } from "../../lib/api";
import { act } from "../../lib/mutate";
import { isCircularNotice, NOTICE_KIND_LABEL, type NoticeKind } from "../../lib/notice-kind";
import { useNoticeInbox } from "../../lib/notice-inbox";
import { useRecord } from "../../lib/record";
import { useSession } from "../../lib/session";

const BLUE = "#1F45C7";

const AUDIENCES: { id: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "PARENT", label: "Parents", icon: "people-outline" },
  { id: "TEACHER", label: "Teachers", icon: "school-outline" },
  { id: "STUDENT", label: "Students", icon: "person-outline" },
  { id: "OFFICE", label: "Office staff", icon: "briefcase-outline" },
];

const MAIN_KINDS: NoticeKind[] = ["CIRCULAR", "EXAM", "FEES", "ADMISSION"];
const MORE_KINDS: NoticeKind[] = ["FEEDBACK", "ATTENDANCE", "LEAVE"];
const KIND_LABEL: Record<NoticeKind, string> = { ...NOTICE_KIND_LABEL, CIRCULAR: "General" };
const KIND_TONE: Record<string, { bg: string; fg: string }> = {
  CIRCULAR: { bg: "#EEF3FF", fg: BLUE },
  EXAM: { bg: "#F3E8FF", fg: "#7e22ce" },
  FEES: { bg: "#ECFDF5", fg: "#047857" },
  ADMISSION: { bg: "#FFF7ED", fg: "#c2410c" },
  FEEDBACK: { bg: "#F1F5F9", fg: "#334155" },
  ATTENDANCE: { bg: "#FEF2F2", fg: "#b91c1c" },
  LEAVE: { bg: "#F0F9FF", fg: "#0369a1" },
};
const BODY_MAX = 1000;

function postedWhen(value: string) {
  return new Date(value).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function audienceLabel(ids: string[] = []) {
  if (!ids.length) return "Everyone";
  return ids.map((id) => AUDIENCES.find((a) => a.id === id)?.label || id).join(", ");
}

export default function Notices() {
  const { token, user } = useSession();
  const inbox = useNoticeInbox();
  const refreshInbox = inbox?.refresh;
  const { data } = useRecord();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<string[]>(["PARENT"]);
  const [allClasses, setAllClasses] = useState(true);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [kind, setKind] = useState<NoticeKind>("CIRCULAR");
  const [moreKinds, setMoreKinds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    const payload = await api<{ notices: Notice[] }>("/notices", token);
    setNotices(payload.notices.filter(isCircularNotice));
    await refreshInbox?.({ silent: true });
  }, [token, refreshInbox]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load."));
  }, [load]);

  const canPost = Boolean(user?.permissions.includes("notices.publish"));
  const classes = data?.classes ?? [];
  const classScoped = audience.includes("PARENT") || audience.includes("STUDENT");

  const reach = useMemo(() => {
    const parts: string[] = [];
    let total = 0;
    const inClasses = (classId?: string) => allClasses || (classId ? classIds.includes(classId) : false);
    const students = (data?.people ?? []).filter((p) => inClasses(p.classId)).length;
    if (audience.includes("PARENT")) {
      parts.push(`${students} ${students === 1 ? "family" : "families"}`);
      total += students;
    }
    if (audience.includes("STUDENT")) {
      parts.push(`${students} ${students === 1 ? "student" : "students"}`);
      total += students;
    }
    const staff = data?.staff ?? [];
    if (audience.includes("TEACHER")) {
      const n = staff.filter((s) => s.kind === "teacher").length;
      parts.push(`${n} ${n === 1 ? "teacher" : "teachers"}`);
      total += n;
    }
    if (audience.includes("OFFICE")) {
      const n = staff.filter((s) => s.kind !== "teacher").length;
      parts.push(`${n} office staff`);
      total += n;
    }
    return { text: parts.join(" · "), total };
  }, [audience, allClasses, classIds, data?.people, data?.staff]);

  const shown = (notices ?? []).filter((n) => !filter || (n.audiences ?? []).includes(filter));

  function resetForm() {
    setTitle("");
    setBody("");
    setAudience(["PARENT"]);
    setAllClasses(true);
    setClassIds([]);
    setKind("CIRCULAR");
    setMoreKinds(false);
    setFormError("");
  }

  async function post() {
    if (!title.trim()) return setFormError("Add a title.");
    if (!body.trim()) return setFormError("Write the message.");
    if (!audience.length) return setFormError("Pick who should get it.");
    if (classScoped && !allClasses && !classIds.length) return setFormError("Pick a class, or All classes.");
    setBusy(true);
    setFormError("");
    try {
      await act(token, "publishNotice", { title: title.trim(), body: body.trim(), audience, allClasses: classScoped ? allClasses : true, classIds: classScoped ? classIds : [], kind });
      toast.show("Notice sent.");
      resetForm();
      setComposeOpen(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  }

  const sectionLabel = (text: string) => <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{text}</Text>;

  const composer = (
    <View className="min-h-0 flex-1 bg-white">
      <View className="flex-row items-center border-b border-ink-100 px-4 py-3">
        <Text className="flex-1 text-lg font-semibold text-ink-900">New notice</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={() => setComposeOpen(false)} className="h-8 w-8 items-center justify-center rounded-full bg-ink-100">
          <Ionicons name="close" size={18} color="#3d4f66" />
        </Pressable>
      </View>
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 18 }} keyboardShouldPersistTaps="handled">
        <View>
          {sectionLabel("Title")}
          <TextInput
            value={title}
            onChangeText={(v) => setTitle(v.slice(0, 120))}
            placeholder="e.g. School closed on Monday"
            placeholderTextColor="#94a3b8"
            className="h-11 rounded-xl border border-ink-200 px-3 text-[15px] text-ink-900"
            style={{ includeFontPadding: false }}
          />
        </View>
        <View>
          <View className="flex-row items-end justify-between">
            {sectionLabel("Message")}
            <Text className={`mb-2 text-[11px] ${body.length > BODY_MAX * 0.9 ? "text-amber-700" : "text-ink-400"}`}>
              {body.length}/{BODY_MAX}
            </Text>
          </View>
          <TextInput
            value={body}
            onChangeText={(v) => setBody(v.slice(0, BODY_MAX))}
            multiline
            textAlignVertical="top"
            placeholder="Write the circular…"
            placeholderTextColor="#94a3b8"
            className="rounded-xl border border-ink-200 px-3 py-3 text-[15px] leading-5 text-ink-900"
            style={{ minHeight: 140, includeFontPadding: false }}
          />
        </View>
        <View>
          {sectionLabel("Send to")}
          <View className="flex-row flex-wrap gap-2">
            {AUDIENCES.map((a) => {
              const on = audience.includes(a.id);
              return (
                <Pressable
                  key={a.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => setAudience((cur) => (on ? cur.filter((x) => x !== a.id) : [...cur, a.id]))}
                  className={`h-10 flex-row items-center gap-1.5 rounded-full border px-3.5 ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                >
                  <Ionicons name={on ? "checkmark-circle" : a.icon} size={16} color={on ? BLUE : "#64748b"} />
                  <Text className={`text-sm font-medium ${on ? "text-[#1F45C7]" : "text-ink-700"}`}>{a.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {classScoped ? (
          <View>
            {sectionLabel("Classes")}
            <View className="flex-row flex-wrap gap-2">
              <Pressable
                onPress={() => {
                  setAllClasses(true);
                  setClassIds([]);
                }}
                className={`h-9 justify-center rounded-full border px-3.5 ${allClasses ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
              >
                <Text className={`text-sm font-semibold ${allClasses ? "text-white" : "text-ink-700"}`}>All classes</Text>
              </Pressable>
              {classes.map((c) => {
                const on = !allClasses && classIds.includes(c.id);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      setAllClasses(false);
                      setClassIds((cur) => (cur.includes(c.id) ? cur.filter((id) => id !== c.id) : [...cur, c.id]));
                    }}
                    className={`h-9 justify-center rounded-full border px-3.5 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
                  >
                    <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-700"}`}>{c.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}
        <View>
          {sectionLabel("Type")}
          <View className="flex-row flex-wrap gap-2">
            {[...MAIN_KINDS, ...(moreKinds || MORE_KINDS.includes(kind) ? MORE_KINDS : [])].map((k) => {
              const on = kind === k;
              const tone = KIND_TONE[k];
              return (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  className="h-9 justify-center rounded-full border px-3.5"
                  style={{ borderColor: on ? tone.fg : "#e2e8f0", backgroundColor: on ? tone.bg : "#fff" }}
                >
                  <Text className="text-sm font-semibold" style={{ color: on ? tone.fg : "#475569" }}>
                    {KIND_LABEL[k]}
                  </Text>
                </Pressable>
              );
            })}
            {!moreKinds && !MORE_KINDS.includes(kind) ? (
              <Pressable onPress={() => setMoreKinds(true)} className="h-9 justify-center px-2">
                <Text className="text-sm font-medium text-ink-500">More…</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <View>
          {sectionLabel("Preview")}
          <View className="rounded-2xl bg-ink-100 p-3">
            <View className="rounded-xl bg-white p-3 shadow-sm">
              <View className="flex-row items-center gap-2">
                <View className="h-5 w-5 items-center justify-center rounded-md bg-[#1F45C7]">
                  <Ionicons name="megaphone" size={11} color="#fff" />
                </View>
                <Text className="flex-1 text-[11px] font-medium text-ink-500" numberOfLines={1}>
                  {data?.school?.name || "Anekio"} · now
                </Text>
              </View>
              <Text className="mt-1.5 text-sm font-semibold text-ink-900" numberOfLines={1}>
                {title || "Notice title"}
              </Text>
              <Text className="mt-0.5 text-xs leading-4 text-ink-600" numberOfLines={2}>
                {body || "The first lines of your message show here."}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
      <View className="gap-2 border-t border-ink-100 px-4 pb-3 pt-3">
        {formError ? <Text className="text-sm text-red-700">{formError}</Text> : null}
        {reach.text ? (
          <View className="flex-row items-start gap-2 rounded-lg bg-ink-50 px-3 py-2">
            <Ionicons name="people-outline" size={15} color="#64748b" style={{ marginTop: 1 }} />
            <Text className="flex-1 text-xs leading-4 text-ink-600">Goes to {reach.text}</Text>
          </View>
        ) : null}
        <View className="flex-row gap-2">
          <Pressable onPress={() => setComposeOpen(false)} className="h-12 flex-1 items-center justify-center rounded-xl border border-ink-200">
            <Text className="text-[15px] font-semibold text-ink-800">Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void post()}
            className={`h-12 flex-[2] flex-row items-center justify-center gap-1.5 rounded-xl ${busy ? "bg-ink-300" : "bg-[#1F45C7]"}`}
          >
            <Ionicons name="send" size={15} color="#fff" />
            <Text className="text-[15px] font-semibold text-white" numberOfLines={1}>
              {busy ? "Sending…" : reach.total ? `Send to ${reach.total} ${reach.total === 1 ? "person" : "people"}` : "Send notice"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView className="min-h-0 flex-1 overflow-hidden bg-ink-50" edges={wide ? ["top", "bottom"] : ["top"]} testID="portal-screen-notices">
      <PhoneTopBar />
      <ScrollView
        className="min-h-0 flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 110 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              try {
                await load();
              } finally {
                setRefreshing(false);
              }
            }}
          />
        }
      >
        <View className="mx-auto w-full max-w-4xl gap-4">
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-[24px] font-bold tracking-tight text-ink-900">Notices</Text>
              {notices?.length ? (
                <Text className="text-sm text-ink-500">
                  {notices.length} {notices.length === 1 ? "notice" : "notices"}
                </Text>
              ) : null}
            </View>
            {canPost ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  resetForm();
                  setComposeOpen(true);
                }}
                className="h-10 flex-row items-center gap-1.5 rounded-full bg-[#1F45C7] px-4"
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text className="text-sm font-semibold text-white">New notice</Text>
              </Pressable>
            ) : null}
          </View>
          {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}

          {canPost && notices?.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {[{ id: "", label: "All" }, ...AUDIENCES].map((a) => {
                const on = filter === a.id;
                return (
                  <Pressable
                    key={a.id || "all"}
                    onPress={() => setFilter(a.id)}
                    className={`h-8 justify-center rounded-full border px-3 ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                  >
                    <Text className={`text-[13px] font-medium ${on ? "text-[#1F45C7]" : "text-ink-700"}`}>{a.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {notices && !notices.length ? (
            <View className="items-center rounded-2xl border border-ink-100 bg-white px-6 py-12">
              <View className="h-14 w-14 items-center justify-center rounded-full bg-[#EEF3FF]">
                <Ionicons name="megaphone-outline" size={26} color={BLUE} />
              </View>
              <Text className="mt-3 text-base font-semibold text-ink-900">No notices yet</Text>
              <Text className="mt-1 text-center text-sm text-ink-500">
                {canPost ? "Circulars you post show up here and in everyone's app." : "When the school posts a circular, it shows up here."}
              </Text>
              {canPost ? (
                <Pressable
                  onPress={() => {
                    resetForm();
                    setComposeOpen(true);
                  }}
                  className="mt-4 h-10 flex-row items-center gap-1.5 rounded-full bg-[#1F45C7] px-4"
                >
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text className="text-sm font-semibold text-white">Post your first notice</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {shown.length ? (
            <View className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
              {shown.map((n, i) => {
                const k = (n.kind && KIND_TONE[n.kind] ? n.kind : "CIRCULAR") as NoticeKind;
                const tone = KIND_TONE[k];
                return (
                  <View key={n.id} className={`gap-1.5 px-4 py-3.5 ${i ? "border-t border-ink-100" : ""}`}>
                    <View className="flex-row items-center gap-2">
                      <Text className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: tone.bg, color: tone.fg }}>
                        {KIND_LABEL[k]}
                      </Text>
                      <Text className="min-w-0 flex-1 text-[15px] font-semibold text-ink-900" numberOfLines={1}>
                        {n.title}
                      </Text>
                      <Text className="text-xs text-ink-400">{postedWhen(n.createdAt)}</Text>
                    </View>
                    <Text className="text-sm leading-5 text-ink-600" numberOfLines={3}>
                      {n.body}
                    </Text>
                    {canPost ? (
                      <Text className="text-xs text-ink-400" numberOfLines={1}>
                        {audienceLabel(n.audiences)} · {n.classes.length ? n.classes.map((c) => c.label).join(", ") : "All classes"} · {n.author}
                      </Text>
                    ) : (
                      <Text className="text-xs text-ink-400">{n.author}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          ) : notices?.length ? (
            <Text className="px-1 text-sm text-ink-500">No notices for this group yet.</Text>
          ) : null}
        </View>
      </ScrollView>

      {canPost ? (
        wide ? (
          <RnModal visible={composeOpen} transparent animationType="fade" onRequestClose={() => setComposeOpen(false)}>
            <View className="flex-1 flex-row justify-end">
              <Pressable accessibilityLabel="Close" className="absolute inset-0 bg-black/30" onPress={() => setComposeOpen(false)} />
              <View className="h-full w-full max-w-[480px] border-l border-ink-200 bg-white shadow-xl">
                <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
                  {composer}
                </SafeAreaView>
              </View>
            </View>
          </RnModal>
        ) : (
          <RnModal visible={composeOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setComposeOpen(false)}>
            <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
              {composer}
            </SafeAreaView>
          </RnModal>
        )
      ) : null}
    </SafeAreaView>
  );
}
