import { useEffect, useState } from "react";
import { Platform, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { addDays, ymd } from "../lib/calendar";
import { act } from "../lib/mutate";
import { pickFile } from "../lib/upload";
import type { RecordPayload } from "../lib/record";
import { Button, Input, Modal } from "./ui";

type Todo = NonNullable<RecordPayload["todos"]>[number];
type Sheet = NonNullable<RecordPayload["markSheets"]>[number];

export function examTodoKind(todo: Todo): "paper" | "marks" | "skip" {
  if (todo.kind === "copies" || todo.title.toLowerCase().startsWith("upload copies")) return "skip";
  if (todo.kind === "paper" || todo.id.startsWith("paper-")) return "paper";
  if (todo.kind === "marks" || todo.id.startsWith("marks-") || todo.title.toLowerCase().includes("enter marks")) {
    return "marks";
  }
  return "skip";
}

export function examTodoTone(todo: Todo): "overdue" | "soon" | "" {
  if (todo.urgency === "overdue" || todo.urgency === "soon") return todo.urgency;
  const due = (todo.dueOn || "").slice(0, 10);
  if (!due) {
    if ((todo.hint || "").toLowerCase().includes("overdue")) return "overdue";
    return "";
  }
  const today = ymd(new Date());
  if (due < today) return "overdue";
  if (due <= addDays(today, 5)) return "soon";
  return "";
}

function prettyDue(value?: string) {
  const s = (value || "").slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function toneCopy(todo: Todo) {
  const tone = examTodoTone(todo);
  const due = prettyDue(todo.dueOn);
  if (tone === "overdue") return due ? `Overdue · ${due}` : "Overdue";
  if (tone === "soon") {
    if (!todo.dueOn) return "Due soon";
    const today = ymd(new Date());
    if (todo.dueOn.slice(0, 10) === today) return "Due today";
    return due ? `Due ${due}` : "Due soon";
  }
  return due ? `Due ${due}` : "";
}

function normHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function csvCell(row: Record<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[normHeader(key)];
    if (value) return value;
  }
  return "";
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if ((char === "," || char === "\t") && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value.trim());
  return cells;
}

function parseMarksCsv(text: string): Record<string, string>[] {
  const raw = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n").filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((h) => normHeader(h));
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) row[h] = (cells[i] || "").trim();
    });
    return row;
  });
}

async function readSheetText(file: { uri: string; name: string }) {
  const text = await fetch(file.uri).then((r) => r.text());
  if (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls") || text.startsWith("PK")) {
    throw new Error("Save the Excel file as CSV, then import that.");
  }
  return text;
}

export function ExamTodoCard({
  todo,
  pending,
  done,
  onDone,
  onUndo,
  onOpenMarks,
  embedded,
}: {
  todo: Todo;
  pending?: boolean;
  done?: boolean;
  onDone?: () => void;
  onUndo?: () => void;
  onOpenMarks?: () => void;
  embedded?: boolean;
}) {
  const { width } = useWindowDimensions();
  const phone = width < 768;
  const kind = examTodoKind(todo);
  const tone = done ? "" : examTodoTone(todo);
  const label = done ? "Done" : toneCopy(todo);
  const bar = done ? "bg-emerald-600" : tone === "overdue" ? "bg-red-600" : tone === "soon" ? "bg-amber-500" : "bg-ink-200";
  const chip = done
    ? "bg-emerald-50 text-green-700"
    : tone === "overdue"
      ? "bg-red-50 text-red-700"
      : tone === "soon"
        ? "bg-amber-50 text-amber-800"
        : "bg-ink-50 text-ink-700";
  const marksRow = kind === "marks" && onOpenMarks;
  const action =
    kind === "paper" && onDone && !done ? (
      <Button variant="ghost" disabled={pending} onPress={onDone} className="px-3 py-2">
        Mark done
      </Button>
    ) : kind === "paper" && onUndo && done ? (
      <Button variant="ghost" disabled={pending} onPress={onUndo} className="px-3 py-2">
        Undo
      </Button>
    ) : marksRow ? (
      <View className="min-w-[92px] items-center rounded-md border border-ink-200 bg-white px-3 py-2">
        <Text className="text-sm font-medium text-ink-800">{done ? "Edit marks" : "Enter marks"}</Text>
      </View>
    ) : null;
  const body = (
    <View className="flex-row">
      <View className={`w-1 ${bar}`} />
      <View className={`min-w-0 flex-1 ${phone ? "px-3 py-3" : "flex-row items-center gap-4 px-4 py-3"}`}>
        <View className="min-w-0 flex-1">
          <Text className={`text-sm font-semibold ${done ? "text-ink-700" : "text-ink-900"}`} numberOfLines={1}>
            {todo.title}
          </Text>
          {todo.hint ? <Text className="mt-0.5 text-xs text-ink-700" numberOfLines={1}>{todo.hint}</Text> : null}
        </View>
        <View className={`${phone ? "mt-3" : ""} flex-row items-center justify-between gap-3`}>
          {label ? <Text className={`rounded-md px-2 py-1 text-[11px] font-medium ${chip}`}>{label}</Text> : <View />}
          {action}
        </View>
      </View>
    </View>
  );
  return (
    <View
      className={
        embedded
          ? "border-t border-ink-100 bg-white"
          : `mb-2 overflow-hidden rounded-md border bg-white ${done ? "border-ink-100" : "border-ink-200"}`
      }
    >
      {marksRow ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={done ? `Change marks. ${todo.title}` : todo.title}
          disabled={pending}
          onPress={onOpenMarks}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
}

export function TeacherMarksModal({
  sheet,
  token,
  onClose,
  onSaved,
}: {
  sheet: Sheet | null;
  token: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!sheet) return;
    const next: Record<string, string> = {};
    for (const s of sheet.students) {
      next[s.id] = s.absent ? "Ab" : s.marks == null ? "" : String(s.marks);
    }
    setDraft(next);
    setQuery("");
    setError("");
    setNote("");
  }, [sheet]);

  const needle = query.trim().toLowerCase();
  const visible = !sheet
    ? []
    : !needle
      ? sheet.students
      : sheet.students.filter((s) =>
          [s.name, s.admissionNo].join(" ").toLowerCase().includes(needle)
        );

  async function saveTyped() {
    if (!sheet) return;
    setPending(true);
    setError("");
    try {
      await act(token, "saveExamMarks", {
        examId: sheet.examId,
        marks: sheet.students.map((s) => {
          const raw = (draft[s.id] || "").trim();
          const absent = /^(ab|absent)$/i.test(raw);
          return { studentId: s.id, marks: absent ? "" : raw, absent };
        }),
      });
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setPending(false);
    }
  }

  async function fillFromCsv() {
    if (!sheet) return;
    setPending(true);
    setError("");
    setNote("");
    try {
      const file = await pickFile(".csv,text/csv,text/plain");
      if (!file) {
        setPending(false);
        return;
      }
      const csv = await readSheetText(file);
      const rows = parseMarksCsv(csv);
      if (!rows.length) throw new Error("The sheet is empty. Use columns Admission, Name, Marks.");
      const byAdm = new Map(sheet.students.map((s) => [s.admissionNo.trim().toLowerCase(), s]));
      const byName = new Map(sheet.students.map((s) => [s.name.trim().toLowerCase(), s]));
      const next = { ...draft };
      let filled = 0;
      let missed = 0;
      for (const row of rows) {
        const admission = csvCell(row, "admissionNo", "admission", "adm", "admn", "admissionno").toLowerCase();
        const name = csvCell(row, "name", "student", "studentname").toLowerCase();
        const student = (admission && byAdm.get(admission)) || (name && byName.get(name)) || null;
        if (!student) {
          missed += 1;
          continue;
        }
        const absentRaw = csvCell(row, "absent", "ab");
        const raw = csvCell(row, "marks", "score", "mark", "obtained");
        if (/^(y|yes|1|ab|absent|true)$/i.test(absentRaw) || /^(ab|absent)$/i.test(raw)) {
          next[student.id] = "Ab";
          filled += 1;
          continue;
        }
        if (raw === "") continue;
        next[student.id] = raw;
        filled += 1;
      }
      if (!filled) {
        throw new Error(missed ? "Could not match those rows. Use admission number." : "No marks in that sheet.");
      }
      setDraft(next);
      setNote(
        missed
          ? `Filled ${filled}. ${missed} row${missed === 1 ? "" : "s"} did not match — check those, then save.`
          : `Filled ${filled} from the sheet. Check them, then save.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that sheet.");
    } finally {
      setPending(false);
    }
  }

  function downloadSampleCsv() {
    if (!sheet || Platform.OS !== "web") return;
    const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = ["Admission,Name,Marks,Absent"];
    for (const [index, s] of sheet.students.entries()) {
      const sampleMark = Math.min(
        sheet.maxMarks,
        Math.max(1, Math.round(sheet.maxMarks * (0.65 + (index % 5) * 0.05)))
      );
      lines.push([s.admissionNo, s.name, String(sampleMark), ""].map(csvCell).join(","));
    }
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${sheet.subject}-${sheet.classLabel || "class"}-marks.csv`
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, "-");
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNote("Sample CSV downloaded with dummy marks. Edit them if needed, then import the file.");
  }

  const entered = sheet
    ? sheet.students.filter((s) => (draft[s.id] || "").trim()).length
    : 0;

  return (
    <Modal
      open={Boolean(sheet)}
      title={sheet ? `${sheet.subject}${sheet.classLabel ? ` · ${sheet.classLabel}` : ""}` : "Marks"}
      onClose={onClose}
      wide
      footer={
        sheet ? (
          <View className="flex-row flex-wrap items-center justify-between gap-3">
            <Text className="text-xs text-ink-700">{entered} of {sheet.students.length} entered</Text>
            <View className="flex-row items-center gap-2">
              <Button variant="ghost" disabled={pending} onPress={onClose}>Cancel</Button>
              <Button disabled={pending} onPress={saveTyped}>{pending ? "Saving…" : "Save marks"}</Button>
            </View>
          </View>
        ) : null
      }
    >
      {sheet ? (
        <View>
          <View className="rounded-md bg-ink-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-medium text-ink-900">Enter marks out of {sheet.maxMarks}</Text>
              <Text className="mt-0.5 text-xs text-ink-700">Use Ab only when a student was absent.</Text>
            </View>
            <View className="mt-3 flex-row flex-wrap gap-2 sm:mt-0">
              <Button variant="ghost" disabled={pending} onPress={fillFromCsv} className="px-3 py-2">
                {pending ? "Reading…" : "Import CSV"}
              </Button>
              {Platform.OS === "web" ? (
                <Button variant="ghost" disabled={pending} onPress={downloadSampleCsv} className="px-3 py-2">
                  Download sample CSV
                </Button>
              ) : null}
            </View>
          </View>
          {note ? <Text className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-clay-600">{note}</Text> : null}
          {error ? <Text className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</Text> : null}
          {sheet.students.length > 12 ? (
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search name or admission"
              autoCapitalize="none"
              autoCorrect={false}
              className="mt-3"
            />
          ) : null}
          <View className="mt-3 overflow-hidden rounded-md border border-ink-200">
            <View className="flex-row items-center gap-3 bg-ink-50 px-4 py-2.5">
              <Text className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wide text-ink-700">Student</Text>
              <Text className="w-20 text-center text-[11px] font-medium uppercase tracking-wide text-ink-700">
                /{sheet.maxMarks}
              </Text>
              <Text className="w-16 text-center text-[11px] font-medium uppercase tracking-wide text-ink-700">Absent</Text>
            </View>
            {visible.length ? (
              visible.map((s, i) => {
                const raw = (draft[s.id] ?? "").trim();
                const absent = /^(ab|absent)$/i.test(raw);
                return (
                  <View
                    key={s.id}
                    className={`flex-row items-center gap-3 px-4 py-2.5 ${i ? "border-t border-ink-100" : ""}`}
                  >
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>
                        {s.name}
                      </Text>
                      {s.admissionNo ? <Text className="text-[11px] text-ink-700">{s.admissionNo}</Text> : null}
                    </View>
                    <TextInput
                      keyboardType="number-pad"
                      value={absent ? "" : (draft[s.id] ?? "")}
                      onChangeText={(v) => setDraft((cur) => ({ ...cur, [s.id]: v }))}
                      placeholder={absent ? "Ab" : ""}
                      placeholderTextColor="#3d4f66"
                      editable={!absent}
                      style={{
                        width: 80,
                        height: 38,
                        borderWidth: 1,
                        borderColor: absent ? "#cbd5e1" : "#c5d0dc",
                        borderRadius: 6,
                        textAlign: "center",
                        fontSize: 14,
                        color: "#0f2744",
                        backgroundColor: absent ? "#f4f7fa" : "#ffffff",
                        paddingVertical: 0,
                        paddingHorizontal: 4,
                      }}
                    />
                    <Pressable
                      onPress={() =>
                        setDraft((cur) => ({
                          ...cur,
                          [s.id]: absent ? "" : "Ab",
                        }))
                      }
                      className={`h-[38px] w-16 items-center justify-center rounded-md border ${
                        absent ? "border-amber-400 bg-amber-50" : "border-ink-200 bg-white"
                      }`}
                    >
                      <Text className={`text-xs font-medium ${absent ? "text-amber-800" : "text-ink-700"}`}>Ab</Text>
                    </Pressable>
                  </View>
                );
              })
            ) : (
              <Text className="px-3 py-6 text-center text-sm text-ink-700">No one matches that search.</Text>
            )}
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
