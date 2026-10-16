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
const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  CIRCULAR: "megaphone-outline",
  EXAM: "document-text-outline",
  FEES: "wallet-outline",
  ADMISSION: "school-outline",
  FEEDBACK: "chatbubble-ellipses-outline",
  ATTENDANCE: "checkmark-done-outline",
  LEAVE: "airplane-outline",
};
const BODY_MAX = 1000;

function dayBucket(value: string) {
  const d = new Date(value);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start - t) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()) return "Earlier this month";
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function postedTime(value: string) {
  const d = new Date(value);
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  return days < 1
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

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
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState("");

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

  const needle = q.trim().toLowerCase();
  const shown = (notices ?? [])
    .filter((n) => !filter || (n.audiences ?? []).includes(filter))
    .filter((n) => !needle || n.title.toLowerCase().includes(needle) || n.body.toLowerCase().includes(needle));
  const grouped = shown.reduce<{ label: string; rows: Notice[] }[]>((acc, n) => {
    const label = dayBucket(n.createdAt);
    const last = acc[acc.length - 1];
    if (last && last.label === label) last.rows.push(n);
    else acc.push({ label, rows: [n] });
    return acc;
  }, []);
  const opened = (notices ?? []).find((n) => n.id === openId) || null;

  function sendAgain(n: Notice) {
    setTitle(n.title);
    setBody(n.body);
    setAudience(n.audiences?.length ? n.audiences : ["PARENT"]);
    setAllClasses(!n.classes.length);
    setClassIds(n.classes.map((c) => c.id));
    const k = (n.kind && KIND_TONE[n.kind] ? n.kind : "CIRCULAR") as NoticeKind;
    setKind(k);
    setMoreKinds(MORE_KINDS.includes(k));
    setFormError("");
    setOpenId("");
    setComposeOpen(true);
  }

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

  const detail = opened ? (
    <View className="min-h-0 flex-1 bg-white">
      <View className="flex-row items-center border-b border-ink-100 px-4 py-3">
        <Text className="flex-1 text-[15px] font-semibold text-ink-900">Notice</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={() => setOpenId("")} className="h-8 w-8 items-center justify-center rounded-full bg-ink-100">
          <Ionicons name="close" size={18} color="#3d4f66" />
        </Pressable>
      </View>
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20, gap: 16 }}>
        {(() => {
          const k = (opened.kind && KIND_TONE[opened.kind] ? opened.kind : "CIRCULAR") as NoticeKind;
          const tone = KIND_TONE[k];
          return (
            <View className="flex-row items-center gap-2">
              <View className="h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: tone.bg }}>
                <Ionicons name={KIND_ICON[k] || "megaphone-outline"} size={16} color={tone.fg} />
              </View>
              <Text className="text-xs font-semibold" style={{ color: tone.fg }}>
                {KIND_LABEL[k]}
              </Text>
            </View>
          );
        })()}
        <View className="gap-1">
          <Text className="text-[20px] font-bold leading-7 text-ink-900">{opened.title}</Text>
          <Text className="text-xs text-ink-500">
            {new Date(opened.createdAt).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {opened.author}
          </Text>
        </View>
        <Text className="text-[15px] leading-6 text-ink-800">{opened.body}</Text>
        {canPost ? (
          <View className="gap-2 rounded-xl border border-ink-100 bg-ink-50 p-3.5">
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Sent to</Text>
            <View className="flex-row flex-wrap gap-1.5">
              {(opened.audiences?.length ? opened.audiences : ["ALL"]).map((id) => {
                const a = AUDIENCES.find((x) => x.id === id);
                return (
                  <View key={id} className="h-7 flex-row items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5">
                    <Ionicons name={a?.icon || "people-outline"} size={13} color="#475569" />
                    <Text className="text-xs text-ink-700">{a?.label || "Everyone"}</Text>
                  </View>
                );
              })}
            </View>
            <Text className="text-xs text-ink-600">
              {opened.classes.length ? `Classes: ${opened.classes.map((c) => c.label).join(", ")}` : "All classes"}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      {canPost ? (
        <View className="flex-row gap-2 border-t border-ink-100 px-4 pb-3 pt-3">
          <Pressable onPress={() => setOpenId("")} className="h-11 flex-1 items-center justify-center rounded-xl border border-ink-200">
            <Text className="text-[14px] font-semibold text-ink-800">Close</Text>
          </Pressable>
          <Pressable onPress={() => sendAgain(opened)} className="h-11 flex-[2] flex-row items-center justify-center gap-1.5 rounded-xl bg-[#1F45C7]">
            <Ionicons name="copy-outline" size={15} color="#fff" />
            <Text className="text-[14px] font-semibold text-white">Send again / edit copy</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  ) : null;

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
              <Text className="text-sm text-ink-500">
                {canPost
                  ? `Circulars to parents, teachers and staff${notices?.length ? ` · ${notices.length} sent` : ""}`
                  : "Circulars from the school"}
              </Text>
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

          {notices?.length ? (
            <View className={wide ? "flex-row items-center gap-3" : "gap-2.5"}>
              {canPost ? (
                <View className={wide ? "min-w-0 flex-1" : ""}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {[{ id: "", label: "All" }, ...AUDIENCES].map((a) => {
                      const on = filter === a.id;
                      return (
                        <Pressable
                          key={a.id || "all"}
                          onPress={() => setFilter(a.id)}
                          className={`h-8 justify-center rounded-full px-3 ${on ? "bg-ink-900" : "bg-white border border-ink-200"}`}
                        >
                          <Text className={`text-[13px] font-medium ${on ? "text-white" : "text-ink-700"}`}>{a.label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}
              <View className={`h-9 flex-row items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 ${wide ? "w-64" : ""}`}>
                <Ionicons name="search" size={14} color="#94a3b8" />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Search notices"
                  placeholderTextColor="#94a3b8"
                  className="min-w-0 flex-1 text-sm text-ink-900"
                />
                {q ? (
                  <Pressable accessibilityLabel="Clear search" onPress={() => setQ("")}>
                    <Ionicons name="close-circle" size={15} color="#94a3b8" />
                  </Pressable>
                ) : null}
              </View>
            </View>
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
            <View className="gap-5">
              {grouped.map((g) => (
                <View key={g.label} className="gap-2">
                  <Text className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{g.label}</Text>
                  <View className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
                    {g.rows.map((n, i) => {
                      const k = (n.kind && KIND_TONE[n.kind] ? n.kind : "CIRCULAR") as NoticeKind;
                      const tone = KIND_TONE[k];
                      return (
                        <Pressable
                          key={n.id}
                          accessibilityRole="button"
                          onPress={() => setOpenId(n.id)}
                          className={`flex-row gap-3 px-4 py-3.5 hover:bg-ink-50 active:bg-ink-50 ${i ? "border-t border-ink-100" : ""}`}
                        >
                          <View className="h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: tone.bg }}>
                            <Ionicons name={KIND_ICON[k] || "megaphone-outline"} size={18} color={tone.fg} />
                          </View>
                          <View className="min-w-0 flex-1 gap-0.5">
                            <View className="flex-row items-center gap-2">
                              <Text className="min-w-0 flex-1 text-[15px] font-semibold text-ink-900" numberOfLines={1}>
                                {n.title}
                              </Text>
                              <Text className="text-xs text-ink-400">{postedTime(n.createdAt)}</Text>
                            </View>
                            <Text className="text-[13px] leading-5 text-ink-500" numberOfLines={2}>
                              {n.body}
                            </Text>
                            <View className="mt-1 flex-row flex-wrap items-center gap-x-2 gap-y-1">
                              <Text className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: tone.bg, color: tone.fg }}>
                                {KIND_LABEL[k]}
                              </Text>
                              {canPost ? (
                                <Text className="min-w-0 flex-shrink text-[11px] text-ink-400" numberOfLines={1}>
                                  To {audienceLabel(n.audiences).toLowerCase()}
                                  {n.classes.length ? ` · ${n.classes.map((c) => c.label).join(", ")}` : ""}
                                  {" · by "}
                                  {n.author}
                                </Text>
                              ) : (
                                <Text className="text-[11px] text-ink-400">{n.author}</Text>
                              )}
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ) : notices?.length ? (
            <Text className="px-1 text-sm text-ink-500">{needle ? `No notice matches "${q.trim()}".` : "No notices for this group yet."}</Text>
          ) : null}
        </View>
      </ScrollView>

      {wide ? (
        <RnModal visible={Boolean(opened)} transparent animationType="fade" onRequestClose={() => setOpenId("")}>
          <View className="flex-1 flex-row justify-end">
            <Pressable accessibilityLabel="Close" className="absolute inset-0 bg-black/30" onPress={() => setOpenId("")} />
            <View className="h-full w-full max-w-[480px] border-l border-ink-200 bg-white shadow-xl">
              <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
                {detail}
              </SafeAreaView>
            </View>
          </View>
        </RnModal>
      ) : (
        <RnModal visible={Boolean(opened)} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setOpenId("")}>
          <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
            {detail}
          </SafeAreaView>
        </RnModal>
      )}

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
