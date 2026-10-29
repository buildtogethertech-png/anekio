import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Input, Modal } from "./ui";
import { DateField } from "./date-field";
import { act } from "../lib/mutate";
import { pickFile, uploadFile } from "../lib/upload";
import { inr } from "../lib/payroll";
import { ymd } from "../lib/calendar";
import { adhocTotals, whole } from "../lib/adhoc-invoice";

export type AdhocCatalogItem = { id: string; label: string; amount: number; active: boolean };
export type AdhocStudentOption = { id: string; name: string; classId?: string; classLabel?: string; admissionNo?: string };

type Line = { key: string; label: string; qty: string; rate: string };

/** Light placeholder so empty boxes never look filled in. */
const HINT = "#a3adbb";

function Label({ text, optional }: { text: string; optional?: boolean }) {
  return (
    <Text className="text-xs font-medium text-ink-700">
      {text}
      {optional ? <Text className="font-normal text-ink-400">  optional</Text> : null}
    </Text>
  );
}

/** Amount box with a fixed ₹ in front, so the placeholder can stay a plain light 0. */
function MoneyInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <View className={`relative justify-center ${className || ""}`}>
      <Text className="absolute left-3 z-10 text-sm text-ink-500">₹</Text>
      <Input
        className="pl-7"
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^0-9]/g, ""))}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={HINT}
      />
    </View>
  );
}

let lineSeq = 0;
function newLine(label = "", rate = ""): Line {
  lineSeq += 1;
  return { key: `l${lineSeq}`, label, qty: "1", rate };
}

export function AdhocInvoiceModal({
  open,
  token,
  student,
  students,
  catalog,
  onClose,
  onDone,
}: {
  open: boolean;
  token: string | null;
  /** Fixed student (from a student's Fees tab). */
  student: { id: string; name: string; classLabel?: string } | null;
  /** When there is no fixed student: pick one student or a whole class (Fees page). */
  students?: AdhocStudentOption[];
  catalog?: AdhocCatalogItem[];
  onClose: () => void;
  onDone: (message: string) => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [discount, setDiscount] = useState("");
  const [dueDate, setDueDate] = useState(ymd(new Date()));
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [forMode, setForMode] = useState<"student" | "class">("student");
  const [search, setSearch] = useState("");
  const [pickedStudent, setPickedStudent] = useState<AdhocStudentOption | null>(null);
  const [pickedClass, setPickedClass] = useState("");
  const [files, setFiles] = useState<{ path: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForMode("student");
    setSearch("");
    setPickedStudent(null);
    setPickedClass("");
    setFiles([]);
    setUploading(false);
    setTitle("");
    setLines([newLine()]);
    setDiscount("");
    setDueDate(ymd(new Date()));
    setNote("");
    setError("");
  }, [open, student?.id]);

  const totals = useMemo(() => adhocTotals(lines, discount), [lines, discount]);
  const picking = !student;
  const classOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string; count: number }>();
    for (const row of students ?? []) {
      if (!row.classId) continue;
      const cur = map.get(row.classId) || { id: row.classId, label: row.classLabel || "Class", count: 0 };
      cur.count += 1;
      map.set(row.classId, cur);
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [students]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return (students ?? [])
      .filter((row) => `${row.name} ${row.admissionNo || ""} ${row.classLabel || ""}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [students, search]);
  const targetIds = !picking
    ? [student!.id]
    : forMode === "student"
      ? pickedStudent ? [pickedStudent.id] : []
      : (students ?? []).filter((row) => row.classId && row.classId === pickedClass).map((row) => row.id);
  const targetLabel = !picking
    ? student!.name
    : forMode === "student"
      ? pickedStudent?.name || ""
      : `${classOptions.find((row) => row.id === pickedClass)?.label || "class"} (${targetIds.length} students)`;
  const quickItems = (catalog ?? []).filter((item) => item.active && item.label);

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((cur) => cur.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const addQuick = (item: AdhocCatalogItem) =>
    setLines((cur) => {
      const blank = cur.find((line) => !line.label.trim() && !line.rate.trim());
      const rate = item.amount > 0 ? String(item.amount) : "";
      if (blank) return cur.map((line) => (line.key === blank.key ? { ...line, label: item.label, rate } : line));
      return [...cur, newLine(item.label, rate)];
    });

  async function attach() {
    if (files.length >= 5) {
      setError("At most 5 attachments");
      return;
    }
    try {
      const file = await pickFile("image/*,application/pdf");
      if (!file) return;
      setUploading(true);
      setError("");
      const res = await uploadFile(token, file, { kind: "invoiceAttachment" });
      setFiles((cur) => [...cur, { path: res.path, name: res.fileName || file.name }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not attach the file.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!targetIds.length) {
      setError(forMode === "class" ? "Pick a class" : "Pick a student");
      return;
    }
    if (totals.error) {
      setError(totals.error);
      return;
    }
    setPending(true);
    setError("");
    try {
      await act(token, "createAdhocInvoice", {
        studentIds: targetIds,
        title: title.trim(),
        dueDate,
        note: note.trim(),
        discount: totals.discount,
        attachments: files,
        lines: lines
          .filter((line) => line.label.trim() || line.rate.trim())
          .map((line) => ({ label: line.label.trim(), qty: whole(line.qty || "1"), rate: Math.round(whole(line.rate)) })),
      });
      await onDone(
        targetIds.length > 1
          ? `${targetIds.length} invoices of ${inr(totals.total)} raised for ${targetLabel}.`
          : `Invoice of ${inr(totals.total)} raised for ${targetLabel}.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the invoice.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open && (Boolean(student) || Boolean(students))}
      title={student ? `New invoice · ${student.name}` : "New invoice"}
      sheetOnPhone
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <View className="gap-2">
          {error ? <Text className="text-xs text-red-700">{error}</Text> : null}
          <View className="flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="text-xs text-ink-500">{targetIds.length > 1 ? `Each · ${targetIds.length} students` : "Total"}</Text>
              <Text className="text-xl font-semibold text-ink-900">{inr(totals.total)}</Text>
            </View>
            <Button variant="ghost" disabled={pending} onPress={onClose}>
              Cancel
            </Button>
            <Button disabled={pending || uploading || !targetIds.length || totals.total <= 0} onPress={() => void submit()}>
              {pending ? "Creating..." : "Create"}
            </Button>
          </View>
        </View>
      }
    >
      {student || students ? (
        <View className="gap-5">
          {picking ? (
            <View className="gap-2">
              <View className="flex-row items-center justify-between">
                <Label text="For" />
                <View className="flex-row rounded-md border border-ink-200 p-0.5">
                  {(
                    [
                      ["student", "Student"],
                      ["class", "Whole class"],
                    ] as const
                  ).map(([id, label]) => (
                    <Pressable
                      key={id}
                      onPress={() => {
                        setForMode(id);
                        setError("");
                      }}
                      className={`rounded px-3 py-1 ${forMode === id ? "bg-clay-500" : ""}`}
                    >
                      <Text className={`text-xs font-medium ${forMode === id ? "text-white" : "text-ink-700"}`}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {forMode === "student" ? (
                pickedStudent ? (
                  <View className="flex-row items-center justify-between rounded-md border border-ink-200 bg-white px-3 py-2.5">
                    <Text className="text-sm text-ink-900" numberOfLines={1}>
                      {pickedStudent.name}
                      <Text className="text-ink-500">{` · ${[pickedStudent.classLabel, pickedStudent.admissionNo].filter(Boolean).join(" · ")}`}</Text>
                    </Text>
                    <Pressable accessibilityLabel="Change student" onPress={() => setPickedStudent(null)} hitSlop={8}>
                      <Ionicons name="close" size={18} color="#3d4f66" />
                    </Pressable>
                  </View>
                ) : (
                  <View className="gap-1">
                    <Input value={search} onChangeText={setSearch} placeholder="Search name or admission no" placeholderTextColor={HINT} autoFocus />
                    {matches.length ? (
                      <View className="overflow-hidden rounded-md border border-ink-100 bg-white">
                        {matches.map((row, i) => (
                          <Pressable
                            key={row.id}
                            onPress={() => {
                              setPickedStudent(row);
                              setSearch("");
                              setError("");
                            }}
                            className={`px-3 py-2 ${i ? "border-t border-ink-100" : ""}`}
                          >
                            <Text className="text-sm text-ink-900" numberOfLines={1}>
                              {row.name}
                              <Text className="text-ink-500">{` · ${[row.classLabel, row.admissionNo].filter(Boolean).join(" · ")}`}</Text>
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : search.trim() ? (
                      <Text className="px-1 text-xs text-ink-500">No student found</Text>
                    ) : null}
                  </View>
                )
              ) : (
                <View className="flex-row flex-wrap gap-1.5">
                  {classOptions.map((row) => (
                    <Pressable
                      key={row.id}
                      onPress={() => {
                        setPickedClass(row.id);
                        setError("");
                      }}
                      className={`rounded-md border px-3 py-1.5 ${pickedClass === row.id ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}
                    >
                      <Text className={`text-sm ${pickedClass === row.id ? "text-white" : "text-ink-800"}`}>
                        {row.label} <Text className={pickedClass === row.id ? "text-white/80" : "text-ink-500"}>{row.count}</Text>
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          ) : null}
          <View className="gap-1.5">
            <Label text="Title" optional />
            <Input value={title} onChangeText={setTitle} placeholder={lines[0]?.label.trim() || "e.g. Annual day costume"} placeholderTextColor={HINT} maxLength={120} />
          </View>

          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <Text className="flex-1 text-xs font-medium text-ink-700">Item</Text>
              <Text className="w-14 text-center text-xs font-medium text-ink-700">Qty</Text>
              <Text className="w-28 text-xs font-medium text-ink-700">Price</Text>
              <View className="w-7" />
            </View>
            {lines.map((line) => (
              <View key={line.key} className="flex-row items-center gap-2">
                <Input className="min-w-0 flex-1" value={line.label} onChangeText={(v) => setLine(line.key, { label: v })} placeholder="e.g. ID card" placeholderTextColor={HINT} maxLength={80} />
                <Input className="w-14 text-center" value={line.qty} onChangeText={(v) => setLine(line.key, { qty: v.replace(/[^0-9]/g, "") })} keyboardType="number-pad" />
                <MoneyInput className="w-28" value={line.rate} onChange={(v) => setLine(line.key, { rate: v })} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${line.label || "item"}`}
                  disabled={lines.length === 1}
                  onPress={() => setLines((cur) => cur.filter((row) => row.key !== line.key))}
                  className={`h-7 w-7 items-center justify-center ${lines.length === 1 ? "opacity-0" : ""}`}
                >
                  <Ionicons name="close" size={18} color="#3d4f66" />
                </Pressable>
              </View>
            ))}
            <View className="flex-row flex-wrap items-center gap-2 pt-1">
              <Pressable onPress={() => setLines((cur) => [...cur, newLine()])} className="flex-row items-center gap-1 rounded-md px-1 py-1">
                <Ionicons name="add" size={16} color="#1F45C7" />
                <Text className="text-sm font-medium text-[#1F45C7]">Add item</Text>
              </Pressable>
              {quickItems.slice(0, 6).map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => addQuick(item)}
                  className="rounded-full border border-ink-200 bg-ink-50 px-2.5 py-1"
                >
                  <Text className="text-xs text-ink-700" numberOfLines={1}>
                    {item.label}
                    {item.amount ? ` ${inr(item.amount)}` : ""}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View className="flex-row flex-wrap gap-3">
            <View className="min-w-[140px] flex-1">
              <View className="gap-1.5">
                <Label text="Due date" />
                <DateField value={dueDate} onChange={setDueDate} />
              </View>
            </View>
            <View className="min-w-[140px] flex-1">
              <View className="gap-1.5">
                <Label text="Discount" optional />
                <MoneyInput value={discount} onChange={setDiscount} />
              </View>
            </View>
          </View>

          <View className="gap-1.5">
            <Label text="Note" optional />
            <Input value={note} onChangeText={setNote} placeholder="e.g. Replacement for lost ID card" placeholderTextColor={HINT} maxLength={500} />
          </View>

          <View className="gap-2">
            <Label text="Photo or bill" optional />
            {files.map((file) => (
              <View key={file.path} className="flex-row items-center gap-2 rounded-md border border-ink-200 bg-white px-3 py-2">
                <Ionicons name={/\.pdf$/i.test(file.name) ? "document-text-outline" : "image-outline"} size={16} color="#3d4f66" />
                <Text className="min-w-0 flex-1 text-sm text-ink-900" numberOfLines={1}>{file.name}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${file.name}`}
                  hitSlop={8}
                  onPress={() => setFiles((cur) => cur.filter((row) => row.path !== file.path))}
                >
                  <Ionicons name="close" size={16} color="#3d4f66" />
                </Pressable>
              </View>
            ))}
            {files.length < 5 ? (
              <Pressable
                accessibilityRole="button"
                disabled={uploading}
                onPress={() => void attach()}
                className={`flex-row items-center justify-center gap-2 rounded-md border border-dashed border-ink-300 px-3 py-3 ${uploading ? "opacity-60" : ""}`}
              >
                <Ionicons name="attach-outline" size={16} color="#1F45C7" />
                <Text className="text-sm font-medium text-[#1F45C7]">{uploading ? "Uploading..." : files.length ? "Attach another" : "Attach photo or PDF"}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </Modal>
  );
}
