import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Badge, Button, Card, Chip, Empty, Field, Input, PageHeader, Toast, useToast } from "../../components/ui";
import { PhoneTopBar } from "../../components/notice-bell";
import { api, type Notice } from "../../lib/api";
import { act } from "../../lib/mutate";
import { isCircularNotice } from "../../lib/notice-kind";
import { useNoticeInbox } from "../../lib/notice-inbox";
import { useRecord } from "../../lib/record";
import { useSession } from "../../lib/session";

function postedWhen(value: string) {
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function Notices() {
  const { token, user } = useSession();
  const inbox = useNoticeInbox();
  const refreshInbox = inbox?.refresh;
  const { data } = useRecord();
  const toast = useToast();
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<string[]>(["PARENT"]);
  const [allClasses, setAllClasses] = useState(true);
  const [classIds, setClassIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    const payload = await api<{ notices: Notice[] }>("/notices", token);
    setNotices(payload.notices);
    await refreshInbox?.({ silent: true });
  }, [token, refreshInbox]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load."));
  }, [load]);

  const kicker =
    user?.portal === "PARENT"
      ? "Parent · Reports"
      : user?.portal === "TEACHER"
        ? "Teacher · Reports"
        : user?.portal === "STUDENT"
          ? undefined
          : "Office · Reports";

  const canPost = Boolean(user?.permissions.includes("notices.publish"));
  const { width } = useWindowDimensions();
  const wide = width >= 768;

  async function post() {
    try {
      await act(token, "publishNotice", { title, body, audience, allClasses, classIds, kind: "CIRCULAR" });
      setTitle("");
      setBody("");
      toast.show("On the board.");
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not post.");
    }
  }

  return (
    <SafeAreaView
      className="min-h-0 flex-1 overflow-hidden bg-ink-50"
      edges={wide ? ["top", "bottom"] : ["top"]}
      testID="portal-screen-notices"
    >
      <PhoneTopBar />
      <ScrollView
        className="min-h-0 flex-1"
        contentContainerClassName="px-4 py-6"
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
        <PageHeader
          kicker={kicker}
          title="School Notices"
          lede={
            user?.portal === "PARENT"
              ? "Circulars and events for your child's class."
              : "Things the school wants to announce — events, holidays, and circulars."
          }
        />
        {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
        {error ? <Text className="mb-4 text-sm text-red-700">{error}</Text> : null}
        {canPost ? (
          <Card className="mb-6 p-4">
            <Text className="mb-3 text-sm font-medium text-ink-900">Post a notice</Text>
            <View className="gap-3">
              <Field label="Title">
                <Input value={title} onChangeText={setTitle} placeholder="Annual Sports Day" />
              </Field>
              <Field label="Message">
                <Input value={body} onChangeText={setBody} multiline placeholder="Venue, time, and what families should know." />
              </Field>
              <Text className="text-xs font-medium text-ink-700">Audience</Text>
              <View className="flex-row flex-wrap gap-2">
                {["PARENT", "TEACHER", "STUDENT", "OFFICE"].map((p) => (
                  <Chip
                    key={p}
                    label={p[0] + p.slice(1).toLowerCase() + "s"}
                    active={audience.includes(p)}
                    onPress={() =>
                      setAudience((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))
                    }
                  />
                ))}
              </View>
              <Chip
                label="All classes"
                active={allClasses}
                onPress={() => {
                  setAllClasses(true);
                  setClassIds([]);
                }}
              />
              <View className="flex-row flex-wrap gap-2">
                {(data?.classes ?? []).map((c) => (
                  <Chip
                    key={c.id}
                    label={c.label}
                    active={!allClasses && classIds.includes(c.id)}
                    onPress={() => {
                      setAllClasses(false);
                      setClassIds((cur) => (cur.includes(c.id) ? cur.filter((id) => id !== c.id) : [...cur, c.id]));
                    }}
                  />
                ))}
              </View>
              <Button onPress={post}>Publish notice</Button>
            </View>
          </Card>
        ) : null}
        {notices && !notices.filter(isCircularNotice).length ? (
          <Empty title="No notices" body="When the office posts a circular, it shows up here." />
        ) : null}
        <View className="gap-3">
          {(notices ?? []).filter(isCircularNotice).map((n) => (
            <Card key={n.id} className="p-4">
              <View className="flex-row items-start justify-between gap-2">
                <View className="flex-row min-w-0 flex-1 items-start gap-2">
                  <Ionicons name="megaphone-outline" size={18} color="#1d4ed8" style={{ marginTop: 2 }} />
                  <Text className="flex-1 font-medium text-ink-900">{n.title}</Text>
                </View>
                <Text className="text-xs text-ink-700">{postedWhen(n.createdAt)}</Text>
              </View>
              <Text className="mt-2 text-sm leading-5 text-ink-700">{n.body}</Text>
              <View className="mt-2 flex-row flex-wrap gap-1.5">
                {n.classes.length ? n.classes.map((c) => <Badge key={c.id}>{c.label}</Badge>) : <Badge>All classes</Badge>}
              </View>
            </Card>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
