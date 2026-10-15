import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Modal as RnModal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { act } from "../lib/mutate";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";
import { Toast, useToast } from "./ui";

/* ------------------------------------------------------------------ types */

type InboxStatus = "OPEN" | "WAITING" | "CLOSED";
type InboxTarget = "OFFICE" | "CLASS_TEACHER" | "TEACHER";

export type InboxThread = {
  id: string;
  subject: string;
  topic: string;
  status: InboxStatus;
  target: InboxTarget;
  withLabel: string;
  student: { id: string; name: string; classLabel: string };
  parent: { userId: string; name: string; phone: string };
  assignee: { userId: string; name: string } | null;
  members: { userId: string; name: string; role: string }[];
  isMember: boolean;
  lastMessage: { body: string; authorName: string; internal: boolean; kind: string; at: string } | null;
  lastMessageAt: string;
  unread: boolean;
  createdAt: string;
};

type InboxMessage = {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  body: string;
  internal: boolean;
  kind: string;
  mine: boolean;
  fromParent: boolean;
  at: string;
};

type Person = { userId: string; name: string; role: string };
type ThreadDetail = { thread: InboxThread; messages: InboxMessage[]; taggable: Person[] };
type Recipients = {
  classTeacher: { userId: string; name: string } | null;
  teachers: { userId: string; name: string; subject: string }[];
};

/* ---------------------------------------------------------------- helpers */

const BRAND = "#1F45C7";
const LIST_POLL_MS = 30_000;
const THREAD_POLL_MS = 25_000;
const STATUS_RANK: Record<InboxStatus, number> = { OPEN: 0, WAITING: 1, CLOSED: 2 };

const STATUS_STYLE: Record<InboxStatus, { label: string; bg: string; text: string }> = {
  OPEN: { label: "Open", bg: "bg-[#EEF3FF]", text: "text-[#1F45C7]" },
  WAITING: { label: "Waiting", bg: "bg-[#FFF7E8]", text: "text-[#B45309]" },
  CLOSED: { label: "Closed", bg: "bg-ink-100", text: "text-ink-600" },
};

/** What a parent sees: a school reply is good news, not a warning. */
function parentStatus(status: InboxStatus, unread: boolean) {
  if (status === "CLOSED") return { label: "Closed", text: "text-ink-500", bg: "bg-ink-100" };
  if (status === "WAITING") return unread ? { label: "New reply", text: "text-[#1F45C7]", bg: "bg-[#EEF3FF]" } : { label: "Replied", text: "text-ink-600", bg: "bg-ink-100" };
  return { label: "Sent", text: "text-ink-600", bg: "bg-ink-100" };
}

const TOPICS = ["Fees", "Attendance", "Homework", "Exams", "Transport", "Other"];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

function shortAgo(iso: string) {
  const at = new Date(iso);
  const diff = Date.now() - at.getTime();
  if (!Number.isFinite(diff)) return "";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return at.toLocaleDateString("en-IN", { weekday: "short" });
  return at.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

function dayLabel(iso: string) {
  const at = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (at.toDateString() === today.toDateString()) return "Today";
  if (at.toDateString() === y.toDateString()) return "Yesterday";
  return at.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: at.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function sortThreads(rows: InboxThread[]) {
  return [...rows].sort(
    (a, b) =>
      Number(b.unread) - Number(a.unread) ||
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt)
  );
}

function errorText(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

/** Runs `fn` now, every `ms` while the app is in the foreground, and again on returning to the app. */
function usePolling(fn: () => void, ms: number, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let active = AppState.currentState === "active" || Platform.OS === "web";
    const id = setInterval(() => {
      if (active) ref.current();
    }, ms);
    const sub = AppState.addEventListener("change", (state) => {
      const next = state === "active";
      if (next && !active) ref.current();
      active = next;
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [ms, enabled]);
}

/* ------------------------------------------------------------ small parts */

function StatusPill({ status, parentMode, unread = false }: { status: InboxStatus; parentMode: boolean; unread?: boolean }) {
  const s = parentMode ? parentStatus(status, unread) : STATUS_STYLE[status];
  return (
    <View className={`rounded-full px-2 py-0.5 ${s.bg}`}>
      <Text className={`text-[11px] font-semibold ${s.text}`}>{s.label}</Text>
    </View>
  );
}

function statusWord(status: InboxStatus, parentMode: boolean, unread: boolean) {
  const s = parentMode ? parentStatus(status, unread) : STATUS_STYLE[status];
  return <Text className={`text-[12px] font-semibold ${s.text}`}>{s.label}</Text>;
}

/** Who the parent is talking to: a building for the office, initials for a teacher. */
function RecipientAvatar({ thread, size = 40 }: { thread: InboxThread; size?: number }) {
  if (thread.target === "OFFICE") {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2 }} className="items-center justify-center bg-[#EEF3FF]">
        <Ionicons name="business" size={size * 0.45} color={BRAND} />
      </View>
    );
  }
  const name = thread.withLabel.replace(/^Class teacher · /, "");
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2 }} className="items-center justify-center bg-[#F3EEFF]">
      <Text className="font-semibold text-[#6D28D9]" style={{ fontSize: size * 0.36 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

function TopicTag({ topic }: { topic: string }) {
  if (!topic) return null;
  return (
    <View className="rounded-md bg-ink-100 px-1.5 py-0.5">
      <Text className="text-[11px] font-medium text-ink-600">{topic}</Text>
    </View>
  );
}

function Avatar({ name, size = 40, tone = "blue" }: { name: string; size?: number; tone?: "blue" | "ink" }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className={`items-center justify-center ${tone === "blue" ? "bg-[#EEF3FF]" : "bg-ink-100"}`}
    >
      <Text className={`font-semibold ${tone === "blue" ? "text-[#1F45C7]" : "text-ink-700"}`} style={{ fontSize: size * 0.36 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

function FilterChip({ label, count, active, onPress }: { label: string; count?: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`h-8 flex-row items-center gap-1.5 rounded-full border px-3 ${active ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
    >
      <Text className={`text-[13px] font-semibold ${active ? "text-white" : "text-ink-700"}`}>{label}</Text>
      {count ? (
        <Text className={`text-[12px] font-semibold ${active ? "text-white/80" : "text-ink-500"}`}>{count}</Text>
      ) : null}
    </Pressable>
  );
}

/** Bottom sheet on phones, centred card on wide screens. */
function SheetFrame({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const phone = width < 768;
  return (
    <RnModal visible={open} transparent animationType={phone ? "slide" : "fade"} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className={`flex-1 ${phone ? "justify-end" : "items-center justify-center px-4"}`}>
        <Pressable accessibilityLabel="Dismiss" className="absolute inset-0 bg-black/40" onPress={onClose} />
        <View
          className={`w-full bg-white ${phone ? "rounded-t-3xl pb-6" : "max-w-[520px] rounded-2xl pb-4"}`}
          style={{ maxHeight: height * (phone ? 0.9 : 0.85) }}
        >
          {phone ? <View className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-ink-200" /> : null}
          <View className="flex-row items-center justify-between px-5 pb-2 pt-3">
            <Text className="text-[17px] font-semibold text-ink-900">{title}</Text>
            <Pressable onPress={onClose} hitSlop={10} className="h-8 w-8 items-center justify-center rounded-full bg-ink-100">
              <Ionicons name="close" size={18} color="#334155" />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            {children}
          </ScrollView>
          {footer ? <View className="border-t border-ink-100 px-5 pt-3">{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </RnModal>
  );
}

function PrimaryButton({ label, onPress, disabled, busy }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      className={`h-12 flex-row items-center justify-center gap-2 rounded-xl ${disabled ? "bg-ink-200" : "bg-[#1F45C7]"}`}
    >
      {busy ? <ActivityIndicator color="#fff" size="small" /> : null}
      <Text className={`text-[15px] font-semibold ${disabled ? "text-ink-500" : "text-white"}`}>{label}</Text>
    </Pressable>
  );
}

/* ----------------------------------------------------- new conversation */

export function NewConversationSheet({
  open,
  onClose,
  studentId,
  studentName,
  initialTarget = "OFFICE",
  initialSubject = "",
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  studentId?: string;
  studentName?: string;
  initialTarget?: "OFFICE" | "CLASS_TEACHER";
  initialSubject?: string;
  onSent?: (threadId: string) => void;
}) {
  const { token } = useSession();
  const [recipients, setRecipients] = useState<Recipients | null>(null);
  const [target, setTarget] = useState<InboxTarget>(initialTarget);
  const [teacherId, setTeacherId] = useState("");
  const [showTeachers, setShowTeachers] = useState(false);
  const [subject, setSubject] = useState(initialSubject);
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTarget(initialTarget);
    setTeacherId("");
    setShowTeachers(false);
    setSubject(initialSubject);
    setTopic("");
    setMessage("");
    setError("");
    if (!token || !studentId) return;
    api<Recipients>(`/inbox/recipients?studentId=${encodeURIComponent(studentId)}`, token)
      .then(setRecipients)
      .catch(() => setRecipients({ classTeacher: null, teachers: [] }));
  }, [open, studentId, token, initialTarget, initialSubject]);

  const teacherPick = recipients?.teachers.find((t) => t.userId === teacherId);
  const ready =
    Boolean(message.trim()) &&
    (target === "OFFICE" || (target === "CLASS_TEACHER" && Boolean(recipients?.classTeacher)) || (target === "TEACHER" && Boolean(teacherPick)));

  async function send() {
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      const res = await act<{ ok: true; threadId: string }>(token, "startInboxThread", {
        studentId,
        target,
        teacherUserId: target === "TEACHER" ? teacherId : undefined,
        subject: subject.trim(),
        topic,
        message: message.trim(),
      });
      onClose();
      onSent?.(res.threadId);
    } catch (e) {
      setError(errorText(e, "Could not send."));
    } finally {
      setBusy(false);
    }
  }

  const option = (key: InboxTarget, icon: keyof typeof Ionicons.glyphMap, title: string, sub: string, disabled?: boolean) => {
    const active = target === key;
    return (
      <Pressable
        key={key}
        disabled={disabled}
        onPress={() => {
          setTarget(key);
          if (key === "TEACHER") setShowTeachers(true);
        }}
        className={`flex-row items-center gap-3 rounded-xl border px-3 py-3 ${active ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"} ${disabled ? "opacity-50" : ""}`}
      >
        <View className={`h-9 w-9 items-center justify-center rounded-full ${active ? "bg-white" : "bg-ink-50"}`}>
          <Ionicons name={icon} size={18} color={active ? BRAND : "#475569"} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[14px] font-semibold text-ink-900">{title}</Text>
          <Text className="mt-0.5 text-[12px] text-ink-500" numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={20} color={active ? BRAND : "#CBD5E1"} />
      </Pressable>
    );
  };

  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      title="New message"
      footer={
        <View className="gap-2">
          {error ? <Text className="text-[13px] text-red-600">{error}</Text> : null}
          <PrimaryButton label="Send" onPress={() => void send()} disabled={!ready} busy={busy} />
        </View>
      }
    >
      {studentName ? <Text className="mb-3 text-[13px] text-ink-500">About {studentName}</Text> : null}
      <Text className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-500">Send to</Text>
      <View className="gap-2">
        {option("OFFICE", "business-outline", "School office", "Fees, admissions, documents, anything general")}
        {option(
          "CLASS_TEACHER",
          "person-outline",
          "Class teacher",
          recipients?.classTeacher ? recipients.classTeacher.name : recipients ? "No class teacher assigned yet" : "Loading…",
          Boolean(recipients && !recipients.classTeacher)
        )}
        {option(
          "TEACHER",
          "school-outline",
          "A subject teacher",
          teacherPick ? `${teacherPick.name}${teacherPick.subject ? ` · ${teacherPick.subject}` : ""}` : "Pick a teacher",
          Boolean(recipients && !recipients.teachers.length)
        )}
        {target === "TEACHER" && showTeachers && recipients?.teachers.length ? (
          <View className="overflow-hidden rounded-xl border border-ink-200">
            {recipients.teachers.map((t, i) => (
              <Pressable
                key={t.userId}
                onPress={() => {
                  setTeacherId(t.userId);
                  setShowTeachers(false);
                }}
                className={`flex-row items-center gap-3 px-3 py-2.5 ${i ? "border-t border-ink-100" : ""} ${teacherId === t.userId ? "bg-[#EEF3FF]" : "bg-white"}`}
              >
                <Avatar name={t.name} size={30} tone="ink" />
                <View className="min-w-0 flex-1">
                  <Text className="text-[14px] font-medium text-ink-900">{t.name}</Text>
                  {t.subject ? <Text className="text-[12px] text-ink-500">{t.subject}</Text> : null}
                </View>
                {teacherId === t.userId ? <Ionicons name="checkmark" size={18} color={BRAND} /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <Text className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wide text-ink-500">Topic</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
        {TOPICS.map((t) => (
          <FilterChip key={t} label={t} active={topic === t} onPress={() => setTopic((cur) => (cur === t ? "" : t))} />
        ))}
      </ScrollView>
      <TextInput
        value={subject}
        onChangeText={setSubject}
        placeholder="Subject (optional)"
        placeholderTextColor="#94A3B8"
        maxLength={120}
        className="h-11 rounded-xl border border-ink-200 bg-white px-3 text-[15px] text-ink-900"
      />
      <Text className="mb-2 mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink-500">Message</Text>
      <TextInput
        value={message}
        onChangeText={setMessage}
        placeholder="Write your message…"
        placeholderTextColor="#94A3B8"
        multiline
        textAlignVertical="top"
        maxLength={4000}
        className="min-h-[120px] rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[15px] text-ink-900"
      />
      <Text className="mt-2 text-[12px] text-ink-500">No subject? We'll use the first line of your message. Only the people you send this to can see it.</Text>
    </SheetFrame>
  );
}

/* ------------------------------------------------------------ people pick */

function PeopleSheet({
  open,
  onClose,
  title,
  people,
  selected,
  multi,
  onDone,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  people: Person[];
  selected: string[];
  multi?: boolean;
  onDone: (ids: string[]) => void;
  busy?: boolean;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>(selected);
  useEffect(() => {
    if (open) {
      setQ("");
      setPicked(selected);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = people.filter((p) => !q.trim() || `${p.name} ${p.role}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      title={title}
      footer={multi ? <PrimaryButton label={picked.length ? `Add ${picked.length}` : "Add"} disabled={!picked.length} busy={busy} onPress={() => onDone(picked)} /> : undefined}
    >
      <View className="mb-3 h-10 flex-row items-center gap-2 rounded-xl bg-ink-50 px-3">
        <Ionicons name="search" size={16} color="#64748B" />
        <TextInput value={q} onChangeText={setQ} placeholder="Search staff" placeholderTextColor="#94A3B8" className="flex-1 text-[14px] text-ink-900" />
      </View>
      {shown.map((p) => {
        const on = picked.includes(p.userId);
        return (
          <Pressable
            key={p.userId}
            onPress={() => (multi ? setPicked((cur) => (on ? cur.filter((id) => id !== p.userId) : [...cur, p.userId])) : onDone([p.userId]))}
            className="flex-row items-center gap-3 border-b border-ink-100 py-2.5"
          >
            <Avatar name={p.name} size={34} tone="ink" />
            <View className="min-w-0 flex-1">
              <Text className="text-[14px] font-medium text-ink-900">{p.name}</Text>
              {p.role ? <Text className="text-[12px] text-ink-500">{p.role}</Text> : null}
            </View>
            {multi ? (
              <Ionicons name={on ? "checkbox" : "square-outline"} size={20} color={on ? BRAND : "#CBD5E1"} />
            ) : on ? (
              <Ionicons name="checkmark" size={18} color={BRAND} />
            ) : null}
          </Pressable>
        );
      })}
      {!shown.length ? <Text className="py-6 text-center text-[13px] text-ink-500">No one matches.</Text> : null}
    </SheetFrame>
  );
}

/* ------------------------------------------------------------ parent card */

function ParentCardSheet({
  open,
  onClose,
  thread,
  threads,
  onOpenThread,
}: {
  open: boolean;
  onClose: () => void;
  thread: InboxThread | null;
  threads: InboxThread[];
  onOpenThread: (id: string) => void;
}) {
  if (!thread) return null;
  const mine = sortThreads(threads.filter((t) => t.parent.userId === thread.parent.userId));
  const openCount = mine.filter((t) => t.status !== "CLOSED").length;
  return (
    <SheetFrame open={open} onClose={onClose} title="Parent">
      <View className="flex-row items-center gap-3">
        <Avatar name={thread.parent.name} size={48} />
        <View className="min-w-0 flex-1">
          <Text className="text-[16px] font-semibold text-ink-900">{thread.parent.name}</Text>
          <Text className="mt-0.5 text-[13px] text-ink-500">
            Parent of {thread.student.name}
            {thread.student.classLabel ? ` · ${thread.student.classLabel}` : ""}
          </Text>
        </View>
      </View>
      {thread.parent.phone ? (
        <View className="mt-4 flex-row gap-2">
          <Pressable
            onPress={() => void Linking.openURL(`tel:${thread.parent.phone}`)}
            className="h-10 flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-ink-200"
          >
            <Ionicons name="call-outline" size={16} color={BRAND} />
            <Text className="text-[14px] font-semibold text-[#1F45C7]">Call</Text>
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL(`https://wa.me/${thread.parent.phone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}`)}
            className="h-10 flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-ink-200"
          >
            <Ionicons name="logo-whatsapp" size={16} color="#16A34A" />
            <Text className="text-[14px] font-semibold text-ink-800">WhatsApp</Text>
          </Pressable>
        </View>
      ) : null}
      <View className="mt-5 flex-row items-center justify-between">
        <Text className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">Conversations</Text>
        <Text className="text-[12px] font-medium text-ink-500">
          {openCount} open · {mine.length} total
        </Text>
      </View>
      <View className="mt-2 overflow-hidden rounded-xl border border-ink-200">
        {mine.map((t, i) => (
          <Pressable
            key={t.id}
            onPress={() => {
              onClose();
              onOpenThread(t.id);
            }}
            className={`flex-row items-center gap-3 px-3 py-3 ${i ? "border-t border-ink-100" : ""} ${t.id === thread.id ? "bg-ink-50" : "bg-white"}`}
          >
            <View className="min-w-0 flex-1">
              <Text className="text-[14px] font-medium text-ink-900" numberOfLines={1}>
                {t.subject}
              </Text>
              <Text className="mt-0.5 text-[12px] text-ink-500" numberOfLines={1}>
                {t.withLabel} · {shortAgo(t.lastMessageAt)}
              </Text>
            </View>
            <StatusPill status={t.status} parentMode={false} />
          </Pressable>
        ))}
      </View>
      <Text className="mt-2 text-[12px] text-ink-400">Only conversations you are part of are shown.</Text>
    </SheetFrame>
  );
}

/* ---------------------------------------------------------- thread view */

function ThreadView({
  threadId,
  parentMode,
  allThreads,
  onBack,
  onChanged,
  onOpenThread,
  showBack,
}: {
  threadId: string;
  parentMode: boolean;
  allThreads: InboxThread[];
  onBack: () => void;
  onChanged: () => void;
  onOpenThread: (id: string) => void;
  showBack: boolean;
}) {
  const { token, user } = useSession();
  const toast = useToast();
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState<"assign" | "add" | null>(null);
  const [parentCard, setParentCard] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const d = await api<ThreadDetail>(`/inbox/${encodeURIComponent(threadId)}`, token);
      setDetail(d);
      setLoadError("");
    } catch (e) {
      setLoadError(errorText(e, "Could not open this conversation."));
    }
  }, [threadId, token]);

  useEffect(() => {
    setDetail(null);
    setText("");
    setNote(false);
    lastCount.current = 0;
    void load().then(onChanged);
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  usePolling(() => void load(), THREAD_POLL_MS);

  useEffect(() => {
    const n = detail?.messages.length || 0;
    if (n !== lastCount.current) {
      lastCount.current = n;
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: n > 0 }), 60);
    }
  }, [detail?.messages.length]);

  const thread = detail?.thread;

  async function send() {
    const body = text.trim();
    if (!body || !thread) return;
    setSending(true);
    try {
      await act(token, "sendInboxMessage", { threadId: thread.id, body, internal: !parentMode && note });
      setText("");
      await load();
      onChanged();
    } catch (e) {
      toast.show(errorText(e, "Could not send."));
    } finally {
      setSending(false);
    }
  }

  async function update(patch: { status?: InboxStatus; assigneeId?: string; addUserIds?: string[] }, done: string) {
    if (!thread) return;
    setBusy(true);
    try {
      await act(token, "updateInboxThread", { threadId: thread.id, ...patch });
      setMenu(false);
      setPicker(null);
      toast.show(done);
      await load();
      onChanged();
    } catch (e) {
      toast.show(errorText(e, "Could not update."));
    } finally {
      setBusy(false);
    }
  }

  if (!detail || !thread) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        {loadError ? (
          <>
            <Text className="text-center text-[14px] text-ink-700">{loadError}</Text>
            <Pressable onPress={onBack} className="mt-4 rounded-xl border border-ink-200 px-4 py-2">
              <Text className="text-[14px] font-semibold text-ink-800">Back</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={BRAND} />
        )}
      </View>
    );
  }

  const closed = thread.status === "CLOSED";
  const staffMembers = thread.members;
  const memberIds = staffMembers.map((m) => m.userId);
  const parentThreads = allThreads.filter((t) => t.parent.userId === thread.parent.userId);
  const parentOpen = parentThreads.filter((t) => t.status !== "CLOSED").length;

  // Group messages by day for separators.
  let lastDay = "";

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 bg-[#F6F7FB]">
      {/* Header */}
      <View className="border-b border-ink-100 bg-white px-3 pb-2.5 pt-2">
        <View className="flex-row items-center gap-2">
          {showBack ? (
            <Pressable onPress={onBack} hitSlop={10} className="h-9 w-9 items-center justify-center rounded-full">
              <Ionicons name="chevron-back" size={22} color="#0F172A" />
            </Pressable>
          ) : null}
          <View className="min-w-0 flex-1">
            <Text className="text-[16px] font-semibold text-ink-900" numberOfLines={1}>
              {thread.subject}
            </Text>
            <Text className="mt-0.5 text-[12px] text-ink-500" numberOfLines={1}>
              {parentMode
                ? `To ${thread.withLabel} · about ${thread.student.name}${thread.student.classLabel ? ` (${thread.student.classLabel})` : ""}`
                : `${thread.student.name}${thread.student.classLabel ? ` · ${thread.student.classLabel}` : ""} · to ${thread.withLabel}`}
            </Text>
          </View>
          {thread.topic ? <TopicTag topic={thread.topic} /> : null}
          <StatusPill status={thread.status} parentMode={parentMode} />
          {!parentMode ? (
            <Pressable onPress={() => setMenu(true)} hitSlop={10} className="h-9 w-9 items-center justify-center rounded-full">
              <Ionicons name="ellipsis-horizontal" size={20} color="#0F172A" />
            </Pressable>
          ) : null}
        </View>
        {!parentMode ? (
          <View className="mt-2 flex-row items-center gap-2">
            <Pressable onPress={() => setParentCard(true)} className="min-w-0 flex-1 flex-row items-center gap-2 rounded-xl bg-ink-50 px-2.5 py-1.5">
              <Avatar name={thread.parent.name} size={24} />
              <Text className="min-w-0 flex-1 text-[13px] font-medium text-ink-800" numberOfLines={1}>
                {thread.parent.name}
                <Text className="font-normal text-ink-500"> · {parentOpen} open · {parentThreads.length} total</Text>
              </Text>
              <Ionicons name="chevron-forward" size={14} color="#94A3B8" />
            </Pressable>
            <Pressable onPress={() => setPicker("assign")} className="flex-row items-center gap-1.5 rounded-xl bg-ink-50 px-2.5 py-1.5">
              <Ionicons name="person-circle-outline" size={16} color={thread.assignee ? BRAND : "#64748B"} />
              <Text className="text-[13px] font-medium text-ink-800" numberOfLines={1}>
                {thread.assignee ? thread.assignee.name.split(" ")[0] : "Assign"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {/* Messages */}
      <ScrollView ref={scrollRef} className="flex-1" contentContainerStyle={{ padding: 12, gap: 6 }} keyboardShouldPersistTaps="handled">
        {detail.messages.map((m) => {
          const day = dayLabel(m.at);
          const sep = day !== lastDay;
          lastDay = day;
          const separator = sep ? (
            <Text key={`d-${m.id}`} className="my-2 self-center rounded-full bg-white px-3 py-1 text-[11px] font-medium text-ink-500">
              {day}
            </Text>
          ) : null;
          if (m.kind === "EVENT") {
            return (
              <View key={m.id}>
                {separator}
                <Text className="my-1 self-center px-6 text-center text-[12px] text-ink-500">
                  {m.body} · {clockTime(m.at)}
                </Text>
              </View>
            );
          }
          if (m.internal) {
            return (
              <View key={m.id}>
                {separator}
                <View className="my-1 rounded-xl border border-[#F5D98B] bg-[#FFF9E6] px-3 py-2">
                  <View className="flex-row items-center gap-1.5">
                    <Ionicons name="lock-closed" size={11} color="#B45309" />
                    <Text className="text-[11px] font-semibold text-[#B45309]">
                      Internal note · {m.mine ? "You" : m.authorName}
                    </Text>
                    <Text className="ml-auto text-[11px] text-[#B45309]/70">{clockTime(m.at)}</Text>
                  </View>
                  <Text className="mt-1 text-[14px] leading-5 text-ink-900">{m.body}</Text>
                </View>
              </View>
            );
          }
          // Parent sees their own messages on the right; staff see the school side on the right.
          const right = parentMode ? m.mine : !m.fromParent;
          return (
            <View key={m.id}>
              {separator}
              <View className={`max-w-[82%] ${right ? "self-end" : "self-start"}`}>
                {!m.mine ? (
                  <Text className={`mb-0.5 text-[11px] font-medium text-ink-500 ${right ? "text-right" : ""}`}>
                    {m.authorName}
                    {m.authorRole ? <Text className="font-normal text-ink-400"> · {m.authorRole}</Text> : null}
                  </Text>
                ) : null}
                <View className={`rounded-2xl px-3 py-2 ${right ? "rounded-br-md bg-[#1F45C7]" : "rounded-bl-md border border-ink-100 bg-white"}`}>
                  <Text className={`text-[15px] leading-5 ${right ? "text-white" : "text-ink-900"}`}>{m.body}</Text>
                  <Text className={`mt-1 text-right text-[10px] ${right ? "text-white/70" : "text-ink-400"}`}>{clockTime(m.at)}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* Composer */}
      <View className="border-t border-ink-100 bg-white px-3 pb-3 pt-2">
        {closed ? (
          <Text className="mb-1.5 text-center text-[12px] text-ink-500">
            {parentMode ? "This conversation is closed. Replying will reopen it." : "Closed. Replying will reopen it as waiting on the parent."}
          </Text>
        ) : null}
        {!parentMode ? (
          <View className="mb-2 flex-row self-start rounded-lg bg-ink-100 p-0.5">
            {[
              { key: false, label: "Reply to parent" },
              { key: true, label: "Internal note" },
            ].map((o) => (
              <Pressable key={String(o.key)} onPress={() => setNote(o.key)} className={`rounded-md px-3 py-1 ${note === o.key ? "bg-white" : ""}`}>
                <Text className={`text-[12px] font-semibold ${note === o.key ? (o.key ? "text-[#B45309]" : "text-[#1F45C7]") : "text-ink-500"}`}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View className="flex-row items-end gap-2">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={note ? "Only staff will see this…" : parentMode ? "Write a reply…" : `Reply to ${thread.parent.name.split(" ")[0]}…`}
            placeholderTextColor="#94A3B8"
            multiline
            maxLength={4000}
            className={`max-h-[120px] min-h-[42px] flex-1 rounded-2xl border px-3 py-2.5 text-[15px] text-ink-900 ${note ? "border-[#F5D98B] bg-[#FFF9E6]" : "border-ink-200 bg-ink-50"}`}
          />
          <Pressable
            onPress={() => void send()}
            disabled={!text.trim() || sending}
            className={`h-[42px] w-[42px] items-center justify-center rounded-full ${text.trim() ? (note ? "bg-[#B45309]" : "bg-[#1F45C7]") : "bg-ink-200"}`}
          >
            {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="arrow-up" size={20} color="#fff" />}
          </Pressable>
        </View>
      </View>

      {/* Staff actions */}
      <SheetFrame open={menu} onClose={() => setMenu(false)} title="Conversation">
        {[
          closed
            ? { icon: "refresh-outline" as const, label: "Reopen", run: () => void update({ status: "OPEN" }, "Reopened.") }
            : { icon: "checkmark-done-outline" as const, label: "Close conversation", run: () => void update({ status: "CLOSED" }, "Closed.") },
          { icon: "person-circle-outline" as const, label: thread.assignee ? `Assigned to ${thread.assignee.name}` : "Assign to someone", run: () => { setMenu(false); setPicker("assign"); } },
          { icon: "person-add-outline" as const, label: "Add people", run: () => { setMenu(false); setPicker("add"); } },
          { icon: "card-outline" as const, label: "Parent card", run: () => { setMenu(false); setParentCard(true); } },
        ].map((a) => (
          <Pressable key={a.label} disabled={busy} onPress={a.run} className="flex-row items-center gap-3 border-b border-ink-100 py-3.5">
            <Ionicons name={a.icon} size={20} color="#334155" />
            <Text className="flex-1 text-[15px] text-ink-900">{a.label}</Text>
          </Pressable>
        ))}
        <Text className="mb-1 mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink-500">In this conversation</Text>
        <Text className="text-[13px] leading-5 text-ink-700">
          {thread.parent.name} (parent){staffMembers.length ? `, ${staffMembers.map((m) => m.name).join(", ")}` : ""}
        </Text>
      </SheetFrame>

      <PeopleSheet
        open={picker === "assign"}
        onClose={() => setPicker(null)}
        title="Assign to"
        people={[...staffMembers, ...detail.taggable.filter((p) => !memberIds.includes(p.userId) && p.userId !== user?.id)]}
        selected={thread.assignee ? [thread.assignee.userId] : []}
        onDone={([id]) => void update({ assigneeId: id }, "Assigned.")}
        busy={busy}
      />
      <PeopleSheet
        open={picker === "add"}
        onClose={() => setPicker(null)}
        title="Add people"
        multi
        people={detail.taggable.filter((p) => !memberIds.includes(p.userId))}
        selected={[]}
        onDone={(ids) => void update({ addUserIds: ids }, ids.length === 1 ? "Added." : `Added ${ids.length} people.`)}
        busy={busy}
      />
      <ParentCardSheet open={parentCard} onClose={() => setParentCard(false)} thread={thread} threads={allThreads} onOpenThread={onOpenThread} />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
    </KeyboardAvoidingView>
  );
}

/* ------------------------------------------------------------ list board */

type Filter = "open" | "unread" | "mine" | "closed";

export function InboxBoard() {
  const { token, user } = useSession();
  const { data } = useRecord();
  const router = useRouter();
  const params = useLocalSearchParams<{ thread?: string | string[] }>();
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const parentMode = user?.portal === "PARENT";
  const toast = useToast();
  const [threads, setThreads] = useState<InboxThread[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState("");
  const [composer, setComposer] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api<{ threads: InboxThread[] }>("/inbox", token);
      setThreads(res.threads);
      setError("");
    } catch (e) {
      setError(errorText(e, "Could not load inbox."));
      setThreads((cur) => cur ?? []);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);
  usePolling(() => void load(), LIST_POLL_MS);

  const paramThread = Array.isArray(params.thread) ? params.thread[0] : params.thread;
  useEffect(() => {
    if (paramThread) setOpenId(paramThread);
  }, [paramThread]);

  function openThread(id: string) {
    setOpenId(id);
    setThreads((cur) => cur?.map((t) => (t.id === id ? { ...t, unread: false } : t)) ?? cur);
  }

  function closeThread() {
    setOpenId("");
    if (paramThread) router.setParams({ thread: "" });
    void load();
  }

  const rows = threads ?? [];
  const counts = useMemo(
    () => ({
      open: rows.filter((t) => t.status !== "CLOSED").length,
      unread: rows.filter((t) => t.unread).length,
      mine: rows.filter((t) => t.assignee?.userId === user?.id && t.status !== "CLOSED").length,
      closed: rows.filter((t) => t.status === "CLOSED").length,
    }),
    [rows, user?.id]
  );
  const openByParent = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of rows) if (t.status !== "CLOSED") map.set(t.parent.userId, (map.get(t.parent.userId) || 0) + 1);
    return map;
  }, [rows]);

  const shown = sortThreads(
    rows.filter((t) => {
      if (filter === "open" && t.status === "CLOSED") return false;
      if (filter === "unread" && !t.unread) return false;
      if (filter === "mine" && (t.assignee?.userId !== user?.id || t.status === "CLOSED")) return false;
      if (filter === "closed" && t.status !== "CLOSED") return false;
      const needle = q.trim().toLowerCase();
      if (!needle) return true;
      return `${t.subject} ${t.student.name} ${t.parent.name} ${t.student.classLabel} ${t.withLabel}`.toLowerCase().includes(needle);
    })
  );

  const filters: { key: Filter; label: string }[] = parentMode
    ? [
        { key: "open", label: "Active" },
        { key: "closed", label: "Closed" },
      ]
    : [
        { key: "open", label: "Open" },
        { key: "unread", label: "Unread" },
        { key: "mine", label: "Assigned to me" },
        { key: "closed", label: "Closed" },
      ];

  const list = (
    <View className="flex-1 bg-white">
      <View className="px-4 pb-2 pt-3">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-[22px] font-semibold text-ink-900">Inbox</Text>
            <Text className="mt-0.5 text-[13px] text-ink-500">
              {parentMode ? "Your conversations with the school" : counts.unread ? `${counts.unread} unread · ${counts.open} open` : `${counts.open} open`}
            </Text>
          </View>
          {parentMode ? (
            <Pressable onPress={() => setComposer(true)} disabled={!data?.child} className="h-10 flex-row items-center gap-1.5 rounded-xl bg-[#1F45C7] px-3.5">
              <Ionicons name="create-outline" size={17} color="#fff" />
              <Text className="text-[14px] font-semibold text-white">New</Text>
            </Pressable>
          ) : null}
        </View>
        {!parentMode && rows.length > 6 ? (
          <View className="mt-3 h-10 flex-row items-center gap-2 rounded-xl bg-ink-50 px-3">
            <Ionicons name="search" size={16} color="#64748B" />
            <TextInput value={q} onChangeText={setQ} placeholder="Search student, parent, subject" placeholderTextColor="#94A3B8" className="flex-1 text-[14px] text-ink-900" />
          </View>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 12 }}>
          {filters.map((f) => (
            <FilterChip key={f.key} label={f.label} count={counts[f.key]} active={filter === f.key} onPress={() => setFilter(f.key)} />
          ))}
        </ScrollView>
      </View>
      {error ? <Text className="px-4 pb-2 text-[13px] text-red-600">{error}</Text> : null}
      {threads === null ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={BRAND} />
        </View>
      ) : shown.length ? (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
          {shown.map((t) => {
            const active = t.id === openId;
            const parentOpen = openByParent.get(t.parent.userId) || 0;
            const preview = t.lastMessage
              ? `${t.lastMessage.internal ? "Note: " : ""}${t.lastMessage.kind === "EVENT" ? "" : `${t.lastMessage.authorName.split(" ")[0]}: `}${t.lastMessage.body}`
              : "";
            return (
              <Pressable
                key={t.id}
                onPress={() => openThread(t.id)}
                className={`flex-row gap-3 border-b border-ink-100 px-4 py-3 ${active ? "bg-[#EEF3FF]" : "bg-white"}`}
              >
                <View>
                  {parentMode ? <RecipientAvatar thread={t} /> : <Avatar name={t.student.name} tone={t.status === "CLOSED" ? "ink" : "blue"} />}
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className={`min-w-0 flex-1 text-[15px] text-ink-900 ${t.unread ? "font-bold" : "font-semibold"}`} numberOfLines={1}>
                      {parentMode ? t.subject : `${t.student.name}${t.student.classLabel ? ` · ${t.student.classLabel}` : ""}`}
                    </Text>
                    <Text className={`text-[12px] ${t.unread ? "font-semibold text-[#1F45C7]" : "text-ink-400"}`}>{shortAgo(t.lastMessageAt)}</Text>
                  </View>
                  <View className="mt-0.5 flex-row items-center gap-1.5">
                    <Text className="min-w-0 shrink text-[12px] text-ink-500" numberOfLines={1}>
                      {parentMode
                        ? t.withLabel
                        : `${t.subject} · ${t.parent.name}${parentOpen > 1 ? ` (${parentOpen} open)` : ""}${t.assignee ? ` · ${t.assignee.userId === user?.id ? "You" : t.assignee.name.split(" ")[0]}` : ""}`}
                    </Text>
                    <Text className="text-[12px] text-ink-300">·</Text>
                    {statusWord(t.status, parentMode, t.unread)}
                    <TopicTag topic={t.topic} />
                  </View>
                  <View className="mt-0.5 flex-row items-center gap-2">
                    <Text className={`min-w-0 flex-1 text-[13px] ${t.unread ? "font-medium text-ink-900" : "text-ink-500"}`} numberOfLines={1}>
                      {preview}
                    </Text>
                    {t.unread ? <View className="h-2.5 w-2.5 rounded-full bg-[#1F45C7]" /> : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center px-8 pb-16">
          <View className="h-16 w-16 items-center justify-center rounded-full bg-[#EEF3FF]">
            <Ionicons name={filter === "closed" ? "archive-outline" : "chatbubbles-outline"} size={28} color={BRAND} />
          </View>
          <Text className="mt-4 text-center text-[17px] font-semibold text-ink-900">
            {q ? "Nothing matches" : filter === "closed" ? "No closed conversations" : parentMode ? "No conversations yet" : "All caught up"}
          </Text>
          <Text className="mt-1.5 text-center text-[13px] leading-5 text-ink-500">
            {parentMode
              ? "Message the office or your child's teacher. Replies show up here."
              : "Messages parents send to you, or that you are added to, show up here."}
          </Text>
          {parentMode && filter !== "closed" ? (
            <Pressable onPress={() => setComposer(true)} disabled={!data?.child} className="mt-5 h-11 flex-row items-center gap-2 rounded-xl bg-[#1F45C7] px-5">
              <Ionicons name="create-outline" size={17} color="#fff" />
              <Text className="text-[14px] font-semibold text-white">New message</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );

  const composerSheet = (
    <NewConversationSheet
      open={composer}
      onClose={() => setComposer(false)}
      studentId={data?.child?.id}
      studentName={data?.child?.name}
      onSent={(id) => {
        void load();
        openThread(id);
      }}
    />
  );

  if (wide) {
    return (
      <View className="min-h-0 flex-1 flex-row overflow-hidden rounded-2xl border border-ink-200 bg-white" style={{ minHeight: 600 }}>
        <View className="w-[380px] border-r border-ink-100">{list}</View>
        <View className="flex-1">
          {openId ? (
            <ThreadView
              key={openId}
              threadId={openId}
              parentMode={parentMode}
              allThreads={rows}
              onBack={closeThread}
              onChanged={() => void load()}
              onOpenThread={openThread}
              showBack={false}
            />
          ) : (
            <View className="flex-1 items-center justify-center bg-[#F6F7FB]">
              <Ionicons name="chatbubble-ellipses-outline" size={36} color="#CBD5E1" />
              <Text className="mt-3 text-[14px] text-ink-500">Pick a conversation</Text>
            </View>
          )}
        </View>
        {composerSheet}
        {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      </View>
    );
  }

  return (
    <View className="min-h-0 flex-1">
      {list}
      <RnModal visible={Boolean(openId)} animationType="slide" presentationStyle="fullScreen" onRequestClose={closeThread}>
        <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
          {openId ? (
            <ThreadView
              key={openId}
              threadId={openId}
              parentMode={parentMode}
              allThreads={rows}
              onBack={closeThread}
              onChanged={() => void load()}
              onOpenThread={openThread}
              showBack
            />
          ) : null}
        </SafeAreaView>
      </RnModal>
      {composerSheet}
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
    </View>
  );
}
