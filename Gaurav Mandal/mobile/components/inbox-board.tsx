import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { api, type Notice } from "../lib/api";
import { act } from "../lib/mutate";
import { classifyNotice } from "../lib/notice-kind";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";
import { Badge, Button, Card, Empty, PageHeader, Toast, useToast } from "./ui";

type InboxStatus = "OPEN" | "WAITING" | "URGENT" | "CLOSED";
type ComposeMode = "reply" | "note";
type InboxGroup = {
  key: string;
  student: string;
  classLabel: string;
  parent: string;
  tickets: Notice[];
  primary: Notice;
  openCount: number;
  waitingCount: number;
};

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

function activeMentionQuery(value: string) {
  const match = value.match(/(^|\s)@([A-Za-z .'-]*)$/);
  return match ? match[2].trim().toLowerCase() : null;
}

function groupKeyFor(n: Notice) {
  const parts = bodyParts(n.body);
  return `${parts.student}|${parts.parent}|${parts.classLabel}`.toLowerCase().replace(/\s+/g, " ").trim() || n.studentId || n.id;
}

function newestFirst(a: Notice, b: Notice) {
  return +new Date(b.createdAt) - +new Date(a.createdAt);
}

function bestTicket(tickets: Notice[]) {
  return [...tickets].sort((a, b) => {
    const aClosed = statusFor(a) === "CLOSED" ? 1 : 0;
    const bClosed = statusFor(b) === "CLOSED" ? 1 : 0;
    if (aClosed !== bClosed) return aClosed - bClosed;
    return newestFirst(a, b);
  })[0];
}

export function InboxBoard() {
  const { token, user } = useSession();
  const { data } = useRecord();
  const toast = useToast();
  const { width, height } = useWindowDimensions();
  const wide = width >= 1000;
  const [rows, setRows] = useState<Notice[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [compose, setCompose] = useState("");
  const [composeMode, setComposeMode] = useState<ComposeMode>("reply");
  const [saving, setSaving] = useState(false);
  const parentMode = user?.portal === "PARENT";
  const boardHeight = Math.max(560, height - 265);
  const chatHeight = Math.max(composerOpen ? 190 : 300, boardHeight - (composerOpen ? 345 : 230));
  const mentionPeople = useMemo(() => {
    const names = [
      ...(data?.staff ?? []).map((person) => ({ name: person.name, role: person.role || person.kind || "Staff" })),
      ...(data?.peopleTeachers ?? []).map((person) => ({ name: person.name, role: person.role || "Teacher" })),
      ...(data?.teachers ?? []).map((person) => ({ name: person.name, role: "Teacher" })),
      ...(data?.timetable?.teachers ?? []).map((person) => ({ name: person.name, role: person.team ? "Team" : "Teacher" })),
      ...(data?.team?.people ?? []).map((person) => ({ name: person.name, role: person.role || "Teacher" })),
      ...(data?.managers ?? []).map((person) => ({ name: person.name, role: person.role || "Manager" })),
      ...(data?.officeUsers ?? []).map((person) => ({ name: person.name, role: "Office" })),
    ];
    const seen = new Set<string>();
    return names
      .filter((person) => {
        const key = person.name.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data?.managers, data?.officeUsers, data?.peopleTeachers, data?.staff, data?.teachers, data?.team?.people, data?.timetable?.teachers]);
  const mentionQuery = !parentMode && composeMode === "note" ? activeMentionQuery(compose) : null;
  const mentionSuggestions = mentionQuery === null
    ? []
    : mentionPeople
        .filter((person) => person.name.toLowerCase().includes(mentionQuery))
        .slice(0, 6);

  const load = useCallback(async () => {
    if (!token) return;
    const payload = await api<{ notices: Notice[] }>("/notices", token);
    const tickets = payload.notices.filter((n) => isInboxNotice(n, user?.portal));
    setRows(tickets);
    setSelectedId((old) => old || tickets[0]?.id || "");
    setSelectedGroupKey((old) => old || (tickets[0] ? groupKeyFor(tickets[0]) : ""));
  }, [token, user?.portal]);

  useEffect(() => {
    load().catch((e) => toast.show(e instanceof Error ? e.message : "Could not load inbox."));
  }, [load]);

  const allGroups = useMemo(() => {
    const map = new Map<string, Notice[]>();
    for (const row of rows) {
      const key = groupKeyFor(row);
      map.set(key, [...(map.get(key) || []), row]);
    }
    return [...map.entries()]
      .map(([key, tickets]): InboxGroup => {
        const ordered = [...tickets].sort(newestFirst);
        const primary = bestTicket(ordered);
        const parts = bodyParts(primary.body);
        return {
          key,
          student: parts.student || "Unknown student",
          classLabel: parts.classLabel,
          parent: parts.parent || primary.author,
          tickets: ordered,
          primary,
          openCount: ordered.filter((n) => statusFor(n) !== "CLOSED").length,
          waitingCount: ordered.filter((n) => statusFor(n) === "WAITING").length,
        };
      })
      .sort((a, b) => newestFirst(a.primary, b.primary));
  }, [rows]);
  const groups = allGroups;
  const selectedGroup =
    groups.find((group) => group.key === selectedGroupKey) ||
    groups.find((group) => group.tickets.some((ticket) => ticket.id === selectedId)) ||
    groups[0];
  const selected = selectedGroup?.tickets.find((n) => n.id === selectedId) || selectedGroup?.primary || rows.find((n) => n.id === selectedId) || rows[0];
  const selectedParts = selected ? bodyParts(selected.body) : null;
  const selectedStatus = selected ? statusFor(selected) : "OPEN";
  const related = selectedGroup?.tickets.filter((row) => row.id !== selected?.id) || [];

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
      setComposerOpen(false);
      toast.show(parentMode ? "Reply sent to school." : status === "CLOSED" ? "Request closed." : "Request updated.");
      await load();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not update inbox.");
    } finally {
      setSaving(false);
    }
  }

  function insertMention(name: string) {
    setCompose((current) => {
      const next = current.replace(/(^|\s)@([A-Za-z .'-]*)$/, (_match, space) => `${space}@${name} `);
      return next === current ? `${current}${current.endsWith(" ") || !current ? "" : " "}@${name} ` : next;
    });
  }

  return (
    <View className="min-h-0 flex-1">
      <PageHeader
        title="Inbox"
        lede={parentMode ? "School replies and your request threads." : "Parent requests as simple mail-style tickets."}
      />
      {toast.message ? <Toast message={toast.message} onDone={toast.clear} /> : null}
      <View
        className={`min-h-0 overflow-hidden rounded-md border border-ink-200 bg-white ${wide ? "flex-row" : ""}`}
        style={{ height: boardHeight }}
      >
        <View className={`${wide ? "w-[31%] border-r border-ink-200" : "max-h-[320px] border-b border-ink-200"} bg-white`}>
          <View className="border-b border-ink-100 px-3 py-2">
            <Text className="text-sm font-semibold text-ink-900">{groups.length} {groups.length === 1 ? "student thread" : "student threads"}</Text>
          </View>
          <ScrollView className="min-h-0">
            {!groups.length ? (
              <Empty title={parentMode ? "No inbox messages" : "No parent requests"} body={parentMode ? "School replies will appear here." : "New parent requests will appear here."} />
            ) : null}
            {groups.map((group) => {
              const n = group.primary;
              const on = selectedGroup?.key === group.key;
              const parts = bodyParts(n.body);
              return (
                <Pressable
                  key={group.key}
                  onPress={() => {
                    setSelectedGroupKey(group.key);
                    setSelectedId(group.primary.id);
                    setHistoryOpen(false);
                    setComposerOpen(false);
                  }}
                  className={`border-b border-ink-100 px-3 py-2.5 ${on ? "bg-blue-50" : "bg-white"}`}
                >
                  <View className="flex-row items-start gap-2.5">
                    <View className={`mt-0.5 h-8 w-8 items-center justify-center rounded-full ${on ? "bg-clay-500" : "bg-ink-100"}`}>
                      <Ionicons name="person-outline" size={15} color={on ? "#ffffff" : "#1e3a5f"} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-[10px] font-bold uppercase tracking-wide text-clay-600">{group.openCount} open · {group.tickets.length} total</Text>
                        {parentMode && /^Reply:/i.test(n.title) ? <Badge tone="sky">Reply</Badge> : null}
                      </View>
                      <Text className="mt-0.5 text-sm font-semibold text-ink-900" numberOfLines={1}>{group.student}</Text>
                      <Text className="text-xs text-ink-700" numberOfLines={1}>
                        {group.parent}{group.classLabel ? ` · ${group.classLabel}` : ""}
                      </Text>
                      <Text className="mt-1 text-xs font-medium text-ink-900" numberOfLines={1}>{subjectFor(n)}</Text>
                      <Text className="text-xs text-ink-700" numberOfLines={1}>{parts.message}</Text>
                      <Text className="mt-1 text-[11px] text-ink-600">{shortDate(n.createdAt)} · {n.author}</Text>
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
            <View className="min-h-0 flex-1 p-4">
              <View className="flex-row items-center justify-between gap-4 border-b border-ink-100 pb-3">
                <View className="min-w-0 flex-1">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="text-xs font-bold uppercase tracking-wide text-clay-600">{ticketNo(selected)}</Text>
                    <Text className="text-base font-bold text-ink-900" numberOfLines={1}>{subjectFor(selected)}</Text>
                    <Badge tone={pillFor(selectedStatus)}>{selectedStatus}</Badge>
                    {selectedGroup ? <Text className="text-xs font-semibold text-ink-600">{selectedGroup.openCount} open · {selectedGroup.tickets.length} total</Text> : null}
                  </View>
                  <Text className="mt-1 text-xs text-ink-700" numberOfLines={1}>
                    {selectedParts.student}{selectedParts.classLabel ? ` · ${selectedParts.classLabel}` : ""}{selectedParts.parent ? ` · ${selectedParts.parent}` : ""}
                  </Text>
                </View>
                {!parentMode ? (
                  <View className="items-end gap-2">
                    {selectedStatus !== "URGENT" && selectedStatus !== "CLOSED" ? (
                      <Pressable
                        disabled={saving}
                        onPress={() => save("URGENT")}
                        className="flex-row items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5"
                      >
                        <Ionicons name="flag-outline" size={13} color="#92400e" />
                        <Text className="text-xs font-semibold text-amber-800">Escalate</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>

              <ScrollView className="mt-4 rounded-xl bg-ink-50/40" style={{ maxHeight: chatHeight }} contentContainerClassName="gap-3 p-3">
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
              </ScrollView>

              <View className="mt-3 rounded-xl border border-ink-200 bg-white p-3">
                {!composerOpen ? (
                  <View className="flex-row flex-wrap items-center justify-between gap-2">
                    <View className="flex-row flex-wrap gap-2">
                      <Button
                        disabled={saving}
                        onPress={() => {
                          setComposeMode("reply");
                          setComposerOpen(true);
                        }}
                      >
                        Reply
                      </Button>
                      {!parentMode ? (
                        <Button
                          disabled={saving}
                          variant="ghost"
                          onPress={() => {
                            setComposeMode("note");
                            setComposerOpen(true);
                          }}
                        >
                          Internal note
                        </Button>
                      ) : null}
                    </View>
                    {!parentMode ? <Button disabled={saving} variant="danger" onPress={() => save("CLOSED")}>Close</Button> : null}
                  </View>
                ) : (
                  <>
                    {!parentMode ? (
                      <View className="mb-2 flex-row gap-2">
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
                      className="min-h-[86px] rounded-md border border-ink-200 bg-white px-3 py-2.5 text-sm leading-5 text-ink-900"
                    />
                    {mentionSuggestions.length ? (
                      <View className="mt-2 overflow-hidden rounded-md border border-ink-200 bg-white">
                        {mentionSuggestions.map((person, index) => (
                          <Pressable
                            key={`${person.role}-${person.name}`}
                            onPress={() => insertMention(person.name)}
                            className={`flex-row items-center gap-3 px-3 py-2.5 ${index ? "border-t border-ink-100" : ""}`}
                          >
                            <View className="h-8 w-8 items-center justify-center rounded-full bg-blue-50">
                              <Text className="text-xs font-bold text-clay-700">{person.name.slice(0, 1).toUpperCase()}</Text>
                            </View>
                            <View className="min-w-0 flex-1">
                              <Text className="text-sm font-semibold text-ink-900" numberOfLines={1}>{person.name}</Text>
                              <Text className="text-xs text-ink-600" numberOfLines={1}>{person.role}</Text>
                            </View>
                            <Text className="text-xs font-semibold text-clay-700">@ mention</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    <View className="mt-2 flex-row flex-wrap items-center justify-between gap-2">
                      <Text className="text-xs text-ink-600">{parentMode ? "This reply stays inside this request." : "Use @name to notify staff."}</Text>
                      <View className="flex-row flex-wrap gap-2">
                        <Button
                          disabled={saving}
                          variant="ghost"
                          onPress={() => {
                            setCompose("");
                            setComposerOpen(false);
                          }}
                        >
                          Cancel
                        </Button>
                        {!parentMode ? (
                          <Button disabled={saving} variant="danger" onPress={() => save("CLOSED")}>Close</Button>
                        ) : null}
                        <Button disabled={saving} onPress={() => save(parentMode ? "OPEN" : selectedStatus)}>{saving ? "Sending..." : parentMode ? "Send" : "Send update"}</Button>
                      </View>
                    </View>
                  </>
                )}
              </View>

              {related.length ? (
                <View className="mt-3 overflow-hidden rounded-xl border border-ink-100 bg-white">
                  <Pressable
                    onPress={() => setHistoryOpen((open) => !open)}
                    className="flex-row items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <View className="min-w-0 flex-1">
                      <Text className="text-xs font-semibold uppercase tracking-wide text-ink-700">Old chats</Text>
                      <Text className="mt-0.5 text-xs text-ink-600">{related.length} older {related.length === 1 ? "request" : "requests"} hidden</Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <Text className="text-xs font-semibold text-clay-700">{historyOpen ? "Hide" : "Show"}</Text>
                      <Ionicons name={historyOpen ? "chevron-up" : "chevron-down"} size={16} color="#1d4ed8" />
                    </View>
                  </Pressable>
                  {historyOpen ? (
                    <ScrollView className="max-h-[190px] border-t border-ink-100">
                      {related.map((row, index) => (
                        <Pressable
                          key={row.id}
                          onPress={() => setSelectedId(row.id)}
                          className={`flex-row items-center gap-3 px-4 py-3 ${index ? "border-t border-ink-100" : ""}`}
                        >
                          <View className="h-9 w-9 items-center justify-center rounded-full bg-ink-50">
                            <Ionicons name={statusFor(row) === "CLOSED" ? "checkmark-done-outline" : "mail-outline"} size={16} color="#1e3a5f" />
                          </View>
                          <View className="min-w-0 flex-1">
                            <Text className="text-sm font-bold text-clay-700">{ticketNo(row)}</Text>
                            <Text className="mt-0.5 text-sm font-semibold text-ink-900" numberOfLines={1}>{subjectFor(row)}</Text>
                          </View>
                          <View className="items-end gap-1">
                            <Badge tone={pillFor(statusFor(row))}>{statusFor(row)}</Badge>
                            <Text className="text-xs text-ink-600">{shortDate(row.createdAt)}</Text>
                          </View>
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
              ) : null}
            </View>
          )}
        </Card>
      </View>
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
