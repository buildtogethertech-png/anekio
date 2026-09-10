import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import type { Notice } from "../lib/api";
import { classifyNotice, type NoticeKind } from "../lib/notice-kind";
import type { IoniconName } from "../lib/nav-icons";
import { useNoticeInbox } from "../lib/notice-inbox";
import { useSession } from "../lib/session";

const KIND_STYLE: Record<NoticeKind, { icon: IoniconName; color: string; bg: string; label: string; rail: string }> = {
  ADMISSION: { icon: "person-add", color: "#7c2d12", bg: "bg-amber-50", label: "Admissions", rail: "bg-amber-500" },
  EXAM: { icon: "document-text", color: "#c2410c", bg: "bg-orange-50", label: "Examination", rail: "bg-orange-500" },
  FEES: { icon: "card", color: "#047857", bg: "bg-emerald-50", label: "Fees", rail: "bg-emerald-600" },
  FEEDBACK: { icon: "chatbubble-ellipses", color: "#1e3a5f", bg: "bg-ink-100", label: "Feedback", rail: "bg-blue-600" },
  ATTENDANCE: { icon: "checkmark-circle", color: "#d97706", bg: "bg-amber-50", label: "Attendance", rail: "bg-yellow-500" },
  LEAVE: { icon: "calendar", color: "#4338ca", bg: "bg-blue-50", label: "Leave", rail: "bg-indigo-600" },
  CIRCULAR: { icon: "megaphone", color: "#1d4ed8", bg: "bg-blue-50", label: "School", rail: "bg-blue-600" },
};

function postedWhen(value: string) {
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function hrefForNotice(kind: NoticeKind, notice: Notice, navKeys: string[]) {
  const has = (key: string) => navKeys.includes(key);
  if (kind === "EXAM") {
    const key = notice.eventKey || "";
    const examId = key.startsWith("NT-5:") ? key.split(":")[1] : key.startsWith("EXAM:") ? key.split(":")[1] : "";
    const seriesId = key.startsWith("SERIES:") ? key.split(":")[1] : "";
    const event = key.startsWith("NT-5:") ? "PAPER_OVERDUE" : key.split(":")[2] || "";
    if (has("exams")) {
      if (/PAPER|EXAM_ASSIGNED|EXAM_TODAY|EXAM_TOMORROW/.test(event) && examId) {
        const view = /PAPER/.test(event) ? "paper" : /EXAM_TODAY|EXAM_TOMORROW/.test(event) ? "take" : "paper";
        return `/exams?examId=${encodeURIComponent(examId)}&view=${view}`;
      }
      if (/MARKS|RESULT_READY|RESULT_PUBLICATION/.test(event) && examId) {
        const view = /CORRECTION|ENTRY_OPEN|DUE/.test(event) ? "marks" : "review";
        return `/exams?examId=${encodeURIComponent(examId)}&view=${view}`;
      }
      return "/exams";
    }
    if (has("tests")) {
      if (seriesId) return `/tests?seriesId=${encodeURIComponent(seriesId)}`;
      return event.includes("SCHEDULE") ? "/tests?view=timetable" : "/tests";
    }
    return "/";
  }
  if (kind === "ADMISSION") return has("admissions") ? "/admissions" : "/";
  if (kind === "FEES") return has("fees") ? "/fees" : "/";
  if (kind === "ATTENDANCE") {
    const leave = /leave/i.test(`${notice.title} ${notice.body}`);
    if (leave && has("leave")) return "/leave";
    if (has("attendance")) return "/attendance";
    if (leave && has("staff")) return "/staff";
    return "/";
  }
  if (kind === "FEEDBACK") return has("inbox") ? "/inbox" : "/";
  if (kind === "LEAVE") return has("leave") ? "/leave" : has("staff") ? "/staff" : "/";
  return has("notices") ? "/notices" : "/";
}

export function NotificationRow({ notice, unread }: { notice: Notice; unread?: boolean }) {
  const router = useRouter();
  const { nav } = useSession();
  const inbox = useNoticeInbox();
  const { kind } = classifyNotice(notice);
  const style = KIND_STYLE[kind];
  const href = hrefForNotice(
    kind,
    notice,
    nav.map((item) => item.key)
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${style.label}. ${notice.title}`}
      onPress={async () => {
        await inbox?.markSeen(notice.id);
        router.push(href as never);
      }}
      className={`overflow-hidden rounded-2xl border ${unread ? "border-ink-200 bg-white shadow-sm" : "border-ink-100 bg-white/55 opacity-70"}`}
    >
      <View className="flex-row">
        <View className={`w-1.5 ${unread ? style.rail : "bg-ink-200"}`} />
        <View className="flex-1 flex-row gap-3 p-4">
          <View className={`h-11 w-11 items-center justify-center rounded-full ${style.bg}`}>
            <Ionicons name={style.icon} size={20} color={style.color} />
          </View>
          <View className="min-w-0 flex-1">
            <View className="flex-row items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className={`text-xs font-bold uppercase tracking-wide ${unread ? "text-blue-700" : "text-ink-500"}`}>{style.label}</Text>
                  {unread ? <View className="h-2 w-2 rounded-full bg-blue-700" /> : null}
                </View>
                <Text className={`mt-1 text-base ${unread ? "font-bold text-ink-900" : "font-semibold text-ink-700"}`} numberOfLines={1}>
                  {notice.title}
                </Text>
              </View>
              <Text className={`text-xs ${unread ? "font-semibold text-ink-700" : "text-ink-500"}`}>{postedWhen(notice.createdAt)}</Text>
            </View>
            {notice.body ? (
              <Text className={`mt-1 text-sm leading-5 ${unread ? "text-ink-800" : "text-ink-500"}`} numberOfLines={2}>
                {notice.body}
              </Text>
            ) : null}
          </View>
          <View className="justify-center">
            <Ionicons name="chevron-forward" size={18} color={unread ? "#334155" : "#94a3b8"} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}
