import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { api, type Notice } from "../lib/api";
import { act } from "../lib/mutate";
import { classifyNotice } from "../lib/notice-kind";
import { useSession } from "../lib/session";
import { Badge, Button, Card, Empty, PageHeader, Toast, useToast } from "./ui";

type InboxStatus = "OPEN" | "WAITING" | "URGENT" | "CLOSED";
type ComposeMode = "reply" | "note";

function isInboxNotice(n: Notice, portal?: string | null) {
  if (classifyNotice(n).kind !== "FEEDBACK") return false;
  if (portal === "PARENT") return /^(Reply:|Note ·|Parent (query|consult|reply):)/i.test(n.title);
  return /^Parent (query|consult|reply):/i.test(n.title);
}

function subjectFor(n: Notice) {
  return n.title.replace(/^(Reply:|Parent (query|consult|reply):|Note ·)\s*/i, "").trim() || "General query";
}

function ticketNo(n: Notice) {
  return `REQ-${n.id.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase() || "NEW"}`;
}

function bodyParts(body: string) {
  const [main, ...events] = body.split(/\n--- inbox:/);
  const lines = main.trim().split("\n");
  const meta = lines[0] || "";
  const directedTo = lines.find((line) => /^For /i.test(line))?.replace(/^For /i, "").trim() || "";
  const message = lines
    .slice(1)
    .filter((line) => !/^For /i.test(line))
    .join("\n")
    .trim();
  const bits = meta.split("·").map((part) => part.trim()).filter(Boolean);
  return {
    meta,
    student: bits[0] || "",
    classLabel: bits[1] || "",
    parent: bits.find((part) => /^Parent:/i.test(part))?.replace(/^Parent:\s*/i, "") || "",
    directedTo,
    message: message || "No message written.",
    events: events.map((e) => parseEvent(`inbox:${e.trim()}`)),
  };
}

function parseEvent(event: string) {
  const lines = event.replace(/^inbox:/, "").split("\n").map((line) => line.trim()).filter(Boolean);
  const stamp = lines.shift()?.replace(/\s*---$/, "") || "";
  const status = lines.find((line) => /^Status:/i.test(line))?.replace(/^Status:\s*/i, "");
  const assigned = lines.find((line) => /^Assigned:/i.test(line))?.replace(/^Assigned:\s*/i, "");
  const note = lines.find((line) => /^Internal note:/i.test(line))?.replace(/^Internal note:\s*/i, "");
  const reply = lines.find((line) => /^Reply sent by /i.test(line))?.replace(/^Reply sent by /i, "");
  const parentReply = lines.find((line) => /^Parent replied:/i.test(line))?.replace(/^Parent replied:\s*/i, "");
  return { stamp, status, assigned, note, reply, parentReply, raw: lines.join("\n") };
}

function statusFor(n: Notice): InboxStatus {
  const matches = [...n.body.matchAll(/Status:\s*(OPEN|WAITING|URGENT|CLOSED)/gi)];
  return (matches.at(-1)?.[1]?.toUpperCase() as InboxStatus | undefined) || "OPEN";
}

function pillFor(status: InboxStatus) {
  if (status === "CLOSED") return "ink";
  if (status === "URGENT") return "danger";
  if (status === "WAITING") return "warn";
  return "sky";
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function longDate(value: string) {
  return new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function InboxBoard() {
  const { token, user } = useSession();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const [rows, setRows] = useState<Notice[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<"ALL" | InboxStatus>("ALL");
  const [compose, setCompose] = useState("");
  const [composeMode, setComposeMode] = useState<ComposeMode>("reply");
  const [saving, setSaving] = useState(false);
  const parentMode = user?.portal === "PARENT";

  const load = useCallback(async () => {
    if (!token) return;
    const payload = await api<{ notices: Notice[] }>("/notices", token);
    const tickets = payload.notices.filter((n) => isInboxNotice(n, user?.portal));
    setRows(tickets);
    setSelectedId((old) => old || tickets[0]?.id || "");
  }, [token, user?.portal]);

  useEffect(() => {
    load().catch((e) => toast.show(e instanceof Error ? e.message : "Could not load inbox."));
  }, [load]);

  const visible = useMemo(() => {
    if (filter === "ALL") return rows;
    return rows.filter((n) => statusFor(n) === filter);
  }, [filter, rows]);
  const selected = rows.find((n) => n.id === selectedId) || visible[0] || rows[0];
  const selectedParts = selected ? bodyParts(selected.body) : null;
  const selectedStatus = selected ? statusFor(selected) : "OPEN";
  const related = selected && selectedParts
    ? rows.filter((row) => row.id !== selected.id && (row.studentId === selected.studentId || bodyParts(row.body).parent === selectedParts.parent)).slice(0, 4)
    : [];

  async function save(status: InboxStatus = selectedStatus) {
    if (!selected) return;
    if (!compose.trim() && status === selectedStatus) {
      toast.show(parentMode ? "Write your reply first." : "Write a reply, @mention, note, or change status.");
      return;
    }
    setSaving(true);
    try {
      await act(token, "replyParentQuery", {
        noticeId: selected.id,
        reply: composeMode === "reply" ? compose : "",
        internalNote: !parentMode && composeMode === "note" ? compose : "",
        assignee: !parentMode ? (compose.match(/@([A-Za-z][A-Za-z .'-]+)/)?.[1] || "") : "",
        status,
      });
      setCompose("");
      toast.show(parentMode ? "Reply sent to school." : status === "CLOSED" ? "Request closed." : "Request updated.");
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not update inbox.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="min-h-0 flex-1">
      <PageHeader
        title="Inbox"
        lede={parentMode ? "School replies and your request threads." : "Parent requests as simple mail-style tickets."}
      />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      {!parentMode ? (
        <View className="mb-3 flex-row flex-wrap gap-2">
          {(["ALL", "OPEN", "WAITING", "URGENT", "CLOSED"] as const).map((item) => {
            const on = filter === item;
            return (
              <Pressable
                key={item}
                onPress={() => setFilter(item)}
                className={`rounded-full border px-4 py-2 ${on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}
              >
                <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-800"}`}>
                  {item === "ALL" ? "All requests" : item[0] + item.slice(1).toLowerCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View className={`min-h-0 flex-1 overflow-hidden rounded-md border border-ink-200 bg-white ${wide ? "flex-row" : ""}`}>
        <View className={`${wide ? "w-[38%] border-r border-ink-200" : "max-h-[360px] border-b border-ink-200"} bg-white`}>
          <View className="border-b border-ink-100 px-4 py-3">
            <Text className="text-sm font-semibold text-ink-900">{visible.length} {visible.length === 1 ? "request" : "requests"}</Text>
            <Text className="mt-0.5 text-xs text-ink-600">Click a row to read the full thread.</Text>
          </View>
          <ScrollView className="min-h-0">
            {!visible.length ? (
              <Empty title={parentMode ? "No inbox messages" : "No parent requests"} body={parentMode ? "School replies will appear here." : "New parent requests will appear here."} />
            ) : null}
            {visible.map((n) => {
              const on = selected?.id === n.id;
              const parts = bodyParts(n.body);
              const status = statusFor(n);
              return (
                <Pressable key={n.id} onPress={() => setSelectedId(n.id)} className={`border-b border-ink-100 px-4 py-3 ${on ? "bg-blue-50" : "bg-white"}`}>
                  <View className="flex-row items-start gap-3">
                    <View className={`mt-1 h-9 w-9 items-center justify-center rounded-full ${on ? "bg-clay-500" : "bg-ink-100"}`}>
                      <Ionicons name="mail-outline" size={17} color={on ? "#ffffff" : "#1e3a5f"} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-[11px] font-bold uppercase tracking-wide text-clay-600">{ticketNo(n)}</Text>
                        {!parentMode ? <Badge tone={pillFor(status)}>{status}</Badge> : /^Reply:/i.test(n.title) ? <Badge tone="sky">Reply</Badge> : null}
                      </View>
                      <Text className="mt-1 text-base font-semibold text-ink-900" numberOfLines={1}>{subjectFor(n)}</Text>
                      <Text className="mt-0.5 text-sm text-ink-700" numberOfLines={1}>
                        {parts.student}{parts.classLabel ? ` · ${parts.classLabel}` : ""}{parts.parent ? ` · ${parts.parent}` : ""}
                      </Text>
                      <Text className="mt-2 text-sm leading-5 text-ink-800" numberOfLines={2}>{parts.message}</Text>
                      <Text className="mt-2 text-xs text-ink-600">{shortDate(n.createdAt)} · {n.author}</Text>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
        <Card className="min-h-[420px] flex-1 border-0 p-0">
          {!selected || !selectedParts ? (
            <Empty title={parentMode ? "Select a message" : "Select a request"} body="Choose a thread from the list." />
          ) : (
            <ScrollView className="min-h-0 flex-1" contentContainerClassName="p-6 pb-8">
              <View className="flex-row items-start justify-between gap-4 border-b border-ink-100 pb-5">
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-bold uppercase tracking-wide text-clay-600">{ticketNo(selected)}</Text>
                  <Text className="mt-1 text-2xl font-bold text-ink-900">{subjectFor(selected)}</Text>
                  <Text className="mt-2 text-sm text-ink-700">
                    {selectedParts.student}{selectedParts.classLabel ? ` · ${selectedParts.classLabel}` : ""}{selectedParts.parent ? ` · Parent: ${selectedParts.parent}` : ""}
                  </Text>
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    {selectedParts.parent ? <PersonChip label={selectedParts.parent} prefix="Parent" /> : null}
                    {selectedParts.directedTo ? <PersonChip label={selectedParts.directedTo} prefix="To" /> : <PersonChip label="Office" prefix="To" />}
                    <PersonChip label={selected.author} prefix="From" />
                  </View>
                </View>
                {!parentMode ? <Badge tone={pillFor(selectedStatus)}>{selectedStatus}</Badge> : null}
              </View>

              {related.length ? (
                <View className="mt-4 rounded-lg bg-ink-50 px-4 py-3">
                  <Text className="text-xs font-semibold uppercase tracking-wide text-ink-700">Related</Text>
                  <View className="mt-2 gap-1.5">
                    {related.map((row) => (
                      <Pressable key={row.id} onPress={() => setSelectedId(row.id)}>
                        <Text className="text-sm text-clay-700">{ticketNo(row)} · {subjectFor(row)}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              <View className="mt-6 gap-4">
                <ThreadBubble
                  label={parentMode ? "Message" : "Parent message"}
                  author={selected.author}
                  date={longDate(selected.createdAt)}
                  body={selectedParts.message}
                  mine={parentMode}
                />
                {selectedParts.events.map((event, index) => (
                  <ThreadEvent key={`${event.stamp}-${index}`} event={event} />
                ))}
              </View>

              <View className="mt-6 rounded-xl border border-ink-200 bg-white p-4">
                {!parentMode ? (
                  <View className="mb-3 flex-row gap-2">
                    {(["reply", "note"] as const).map((mode) => (
                      <Pressable
                        key={mode}
                        onPress={() => setComposeMode(mode)}
                        className={`rounded-full border px-3 py-1.5 ${composeMode === mode ? "border-clay-500 bg-blue-50" : "border-ink-200 bg-white"}`}
                      >
                        <Text className={`text-xs font-semibold ${composeMode === mode ? "text-clay-700" : "text-ink-700"}`}>
                          {mode === "reply" ? "Reply to parent" : "Internal note / @mention"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <TextInput
                  multiline
                  value={compose}
                  onChangeText={setCompose}
                  placeholder={parentMode ? "Write back to school…" : composeMode === "reply" ? "Write reply to parent…" : "Add note, e.g. @Kavita please check admit card issue"}
                  placeholderTextColor="#64748b"
                  className="min-h-[110px] rounded-md border border-ink-200 bg-white px-3 py-3 text-sm leading-5 text-ink-900"
                />
                <View className="mt-3 flex-row flex-wrap items-center justify-between gap-2">
                  <Text className="text-xs text-ink-600">{parentMode ? "Your reply becomes part of this request." : "Use @name to pull another staff member into the request."}</Text>
                  <View className="flex-row flex-wrap gap-2">
                    {!parentMode ? (
                      <>
                        <Button disabled={saving} variant="ghost" onPress={() => save("WAITING")}>Waiting</Button>
                        <Button disabled={saving} variant="ghost" onPress={() => save("URGENT")}>Urgent</Button>
                        <Button disabled={saving} variant="danger" onPress={() => save("CLOSED")}>Close</Button>
                      </>
                    ) : null}
                    <Button disabled={saving} onPress={() => save(parentMode ? "OPEN" : selectedStatus)}>{saving ? "Sending..." : parentMode ? "Send" : "Send update"}</Button>
                  </View>
                </View>
              </View>
            </ScrollView>
          )}
        </Card>
      </View>
    </View>
  );
}

function PersonChip({ prefix, label }: { prefix: string; label: string }) {
  return (
    <View className="rounded-full border border-ink-200 bg-white px-3 py-1.5">
      <Text className="text-xs text-ink-700"><Text className="font-semibold text-ink-900">{prefix}:</Text> {label}</Text>
    </View>
  );
}

function ThreadBubble({ label, author, date, body, mine }: { label: string; author: string; date: string; body: string; mine?: boolean }) {
  return (
    <View className={`rounded-xl border px-4 py-3 ${mine ? "border-blue-100 bg-blue-50" : "border-ink-100 bg-ink-50"}`}>
      <Text className="text-[11px] font-bold uppercase tracking-wide text-ink-700">{label}</Text>
      <Text className="mt-1 text-xs text-ink-600">{author} · {date}</Text>
      <Text className="mt-3 text-base leading-6 text-ink-900">{body}</Text>
    </View>
  );
}

function ThreadEvent({ event }: { event: ReturnType<typeof parseEvent> }) {
  const body = event.parentReply || event.reply || event.note || event.assigned || event.status || event.raw;
  const label = event.parentReply ? "Parent replied" : event.reply ? "School replied" : event.note ? "Internal note" : event.assigned ? "Assigned" : "Status updated";
  return (
    <View className="flex-row gap-3">
      <View className="mt-1 h-8 w-8 items-center justify-center rounded-full bg-blue-50">
        <Ionicons name={event.note || event.assigned ? "person-add-outline" : "chatbubble-outline"} size={15} color="#1d4ed8" />
      </View>
      <View className="min-w-0 flex-1 rounded-xl border border-ink-100 bg-white px-4 py-3">
        <Text className="text-sm font-semibold text-ink-900">{label}</Text>
        {event.stamp ? <Text className="mt-0.5 text-xs text-ink-600">{longDate(event.stamp)}</Text> : null}
        {body ? <Text className="mt-2 text-sm leading-5 text-ink-800">{body}</Text> : null}
      </View>
    </View>
  );
}
