import Ionicons from "@expo/vector-icons/Ionicons";
import { Linking, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useEffect, useMemo, useState } from "react";
import { Dropdown } from "./form";
import { Badge, Button, Field, Input, Modal, Segmented } from "./ui";
import { act } from "../lib/mutate";
import { useRecord, type DocumentElement, type DocumentElementType, type DocumentLayout, type DocumentTemplateSummary, type RecordPayload } from "../lib/record";
import { useSession } from "../lib/session";

type Studio = NonNullable<RecordPayload["documentStudio"]>;

const ELEMENTS: { type: DocumentElementType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { type: "TEXT", label: "Text", icon: "text-outline" },
  { type: "FIELD", label: "Data field", icon: "code-slash-outline" },
  { type: "TABLE", label: "Table", icon: "grid-outline" },
  { type: "PHOTO", label: "Photo", icon: "person-outline" },
  { type: "IMAGE", label: "Image", icon: "image-outline" },
  { type: "SIGNATURE", label: "Signature", icon: "pencil-outline" },
  { type: "STAMP", label: "Stamp", icon: "ribbon-outline" },
  { type: "VERIFY_QR", label: "Verification QR", icon: "qr-code-outline" },
  { type: "CUSTOM_QR", label: "Custom URL QR", icon: "link-outline" },
  { type: "BARCODE", label: "Barcode", icon: "barcode-outline" },
  { type: "SHAPE", label: "Shape", icon: "square-outline" },
  { type: "LINE", label: "Divider", icon: "remove-outline" },
  { type: "PAGE_NUMBER", label: "Page number", icon: "documents-outline" },
];

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type BlockedDocumentStudent = {
  subjectId: string;
  subjectLabel?: string;
  error: string;
  pendingMonths?: number;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  payUrl?: string;
  noticeSent?: boolean;
};

function cleanPhone(value?: string) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function feeBlockMessage(row: BlockedDocumentStudent) {
  const student = row.subjectLabel || "your child";
  const pending = row.pendingMonths ? `${row.pendingMonths} pending fee month${row.pendingMonths === 1 ? "" : "s"}` : "pending fees";
  const pay = row.payUrl ? `\nPay link: ${row.payUrl}` : "";
  return `Namaste, ${student}'s admit card could not be generated because ${pending} are due. Please clear the fees so school can issue the admit card.${pay}`;
}

function newElement(type: DocumentElementType, index: number): DocumentElement {
  const base = { id: `${type.toLowerCase()}-${Date.now()}-${index}`, type, x: 18 + (index % 4) * 3, y: 25 + (index % 8) * 5, width: 36, height: 7, fontSize: 14, color: "#102a43" } as DocumentElement;
  if (type === "VERIFY_QR" || type === "CUSTOM_QR") return { ...base, width: 16, height: 16, label: type === "VERIFY_QR" ? "Verification QR" : "Custom URL" };
  if (type === "BARCODE") return { ...base, width: 32, height: 10, label: "Internal scan code", field: "document.number" };
  if (type === "PHOTO" || type === "IMAGE" || type === "SIGNATURE" || type === "STAMP") return { ...base, width: 20, height: 16, label: ELEMENTS.find((row) => row.type === type)?.label };
  if (type === "TABLE") return { ...base, width: 70, height: 20, label: "Data table", field: "results.marks" };
  if (type === "LINE") return { ...base, width: 64, height: 1 };
  if (type === "PAGE_NUMBER") return { ...base, width: 18, height: 4, label: "Page 1" };
  if (type === "FIELD") return { ...base, label: "Student name", field: "student.name" };
  if (type === "TEXT") return { ...base, value: "Type your text", label: "Text" };
  return base;
}

function ElementPreview({ element }: { element: DocumentElement }) {
  if (element.type === "VERIFY_QR" || element.type === "CUSTOM_QR") {
    return (
      <View className="h-full w-full items-center justify-center border border-ink-300 bg-white">
        <Ionicons name="qr-code-outline" size={30} color="#102a43" />
        <Text className="mt-0.5 text-[6px] text-ink-700">{element.type === "VERIFY_QR" ? "VERIFY" : "URL"}</Text>
      </View>
    );
  }
  if (element.type === "BARCODE") {
    return (
      <View className="h-full w-full items-center justify-center border-y-4 border-ink-900 bg-white">
        <Text className="text-[7px] tracking-[3px] text-ink-900">||||| || |||||</Text>
      </View>
    );
  }
  if (["PHOTO", "IMAGE", "SIGNATURE", "STAMP"].includes(element.type)) {
    return (
      <View className="h-full w-full items-center justify-center border border-dashed border-ink-300 bg-ink-50">
        <Ionicons name={element.type === "PHOTO" ? "person-outline" : element.type === "SIGNATURE" ? "pencil-outline" : element.type === "STAMP" ? "ribbon-outline" : "image-outline"} size={20} color="#52667d" />
        <Text className="mt-1 text-[7px] text-ink-700">{element.label}</Text>
      </View>
    );
  }
  if (element.type === "TABLE") {
    return (
      <View className="h-full w-full border border-ink-300 bg-white">
        {[0, 1, 2, 3].map((row) => <View key={row} className={`flex-1 ${row ? "border-t border-ink-200" : "bg-ink-50"}`} />)}
        <Text className="absolute inset-0 text-center text-[8px] leading-[34px] text-ink-700">{element.label || "Table"}</Text>
      </View>
    );
  }
  if (element.type === "LINE") return <View className="mt-[2px] h-px w-full bg-ink-600" />;
  if (element.type === "SHAPE") return <View className="h-full w-full border border-ink-400" style={{ backgroundColor: element.background || "#f0f4f8" }} />;
  const copy = element.type === "FIELD" ? `{{ ${element.field || "field"} }}` : element.value || element.label || element.type;
  return (
    <Text
      numberOfLines={3}
      style={{ fontSize: element.fontSize || 14, fontWeight: element.fontWeight || "normal", color: element.color || "#102a43", textAlign: element.align || "left", backgroundColor: element.background || "transparent" }}
    >
      {copy}
    </Text>
  );
}

function CanvasItem({ element, selected, canvasWidth, canvasHeight, onSelect, onMoveStart, onMove }: {
  element: DocumentElement;
  selected: boolean;
  canvasWidth: number;
  canvasHeight: number;
  onSelect: () => void;
  onMoveStart: () => void;
  onMove: (x: number, y: number) => void;
}) {
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !element.locked,
    onMoveShouldSetPanResponder: (_event, gesture) => !element.locked && Math.abs(gesture.dx) + Math.abs(gesture.dy) > 2,
    onPanResponderGrant: () => { onSelect(); onMoveStart(); },
    onPanResponderMove: (_event, gesture) => {
      onMove(clamp(element.x + (gesture.dx / canvasWidth) * 100, 0, 100 - element.width), clamp(element.y + (gesture.dy / canvasHeight) * 100, 0, 100 - element.height));
    },
  }), [canvasHeight, canvasWidth, element.height, element.locked, element.width, element.x, element.y, onMove, onMoveStart, onSelect]);
  return (
    <View
      {...pan.panHandlers}
      style={{ position: "absolute", left: `${element.x}%`, top: `${element.y}%`, width: `${element.width}%`, height: `${element.height}%` } as never}
      className={`${selected ? "border-2 border-blue-600" : "border border-transparent"} ${element.locked ? "opacity-80" : ""}`}
    >
      <Pressable className="h-full w-full" onPress={onSelect}><ElementPreview element={element} /></Pressable>
      {selected ? <View className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-blue-600" /> : null}
    </View>
  );
}

function NumericProperty({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <View className="min-w-[44%] flex-1">
      <Text className="mb-1 text-[10px] font-medium uppercase text-ink-700">{label}</Text>
      <TextInput keyboardType="decimal-pad" value={String(Math.round(value * 10) / 10)} onChangeText={(text) => onChange(Number(text.replace(/[^0-9.-]/g, "")) || 0)} className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-900" />
    </View>
  );
}

function TemplateEditor({ template, studio, data, onClose, onSaved }: { template: DocumentTemplateSummary; studio: Studio; data: RecordPayload; onClose: () => void; onSaved: () => Promise<void> }) {
  const { token } = useSession();
  const [draft, setDraft] = useState(() => ({ ...template, name: template.builtIn ? `${template.name} · School` : template.name, layout: { elements: template.layout.elements.map((row) => ({ ...row })) } }));
  const [selectedId, setSelectedId] = useState(draft.layout.elements[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<DocumentElement[][]>([]);
  const [future, setFuture] = useState<DocumentElement[][]>([]);
  const [previewTarget, setPreviewTarget] = useState("sample");
  const [previewing, setPreviewing] = useState(false);
  const canvasWidth = draft.orientation === "LANDSCAPE" ? 690 : 520;
  const canvasHeight = draft.pageSize === "CR80" ? 430 : draft.orientation === "LANDSCAPE" ? 488 : 735;
  const selected = draft.layout.elements.find((row) => row.id === selectedId);
  const previewPeople = draft.category === "EMPLOYEE"
    ? (data.staff || []).map((row) => ({ id: `employee:${row.id}`, label: `${row.name} · ${row.role || row.employeeId}` }))
    : (data.people || []).map((row) => ({ id: `student:${row.id}`, label: `${row.name} · ${row.classLabel}` }));

  function setElements(elements: DocumentElement[], remember = true) {
    if (remember) {
      setHistory((rows) => [...rows.slice(-29), draft.layout.elements.map((row) => ({ ...row }))]);
      setFuture([]);
    }
    setDraft((current) => ({ ...current, layout: { elements } }));
  }

  function rememberLayout() {
    setHistory((rows) => [...rows.slice(-29), draft.layout.elements.map((row) => ({ ...row }))]);
    setFuture([]);
  }

  function patchElement(id: string, patch: Partial<DocumentElement>, remember = true) {
    setElements(draft.layout.elements.map((row) => row.id === id ? { ...row, ...patch } : row), remember);
  }

  function add(type: DocumentElementType) {
    const next = newElement(type, draft.layout.elements.length);
    setElements([...draft.layout.elements, next]);
    setSelectedId(next.id);
  }

  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setFuture((rows) => [draft.layout.elements.map((row) => ({ ...row })), ...rows].slice(0, 30));
    setHistory((rows) => rows.slice(0, -1));
    setElements(previous.map((row) => ({ ...row })), false);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setHistory((rows) => [...rows.slice(-29), draft.layout.elements.map((row) => ({ ...row }))]);
    setFuture((rows) => rows.slice(1));
    setElements(next.map((row) => ({ ...row })), false);
  }

  function moveLayer(id: string, direction: "front" | "back") {
    const element = draft.layout.elements.find((row) => row.id === id);
    if (!element) return;
    const others = draft.layout.elements.filter((row) => row.id !== id);
    setElements(direction === "front" ? [...others, element] : [element, ...others]);
  }

  async function save(publish = false) {
    setSaving(true);
    setMessage("");
    try {
      const result = await act<{ ok: true; template: { id: string } }>(token, "saveDocumentTemplate", { id: draft.builtIn ? "" : draft.id, type: draft.type, name: draft.name, description: draft.description, pageSize: draft.pageSize, orientation: draft.orientation, layout: draft.layout });
      if (publish) await act(token, "publishDocumentTemplate", { id: result.template.id });
      setMessage(publish ? "Published and active." : "Draft saved.");
      await onSaved();
      if (publish) onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save template.");
    } finally {
      setSaving(false);
    }
  }

  async function preview() {
    setPreviewing(true);
    setMessage("");
    const browserWindow = Platform.OS === "web" && typeof window !== "undefined" ? window.open("", "_blank") : null;
    if (browserWindow) {
      browserWindow.document.title = "Preparing document preview…";
      browserWindow.document.body.innerHTML = '<p style="font-family:Arial;padding:24px">Preparing document preview…</p>';
    }
    try {
      const [kind, id] = previewTarget.split(":");
      const student = kind === "student" ? data.people?.find((row) => row.id === id) : undefined;
      const employee = kind === "employee" ? data.staff?.find((row) => row.id === id) : undefined;
      const sampleStudent = { name: "Aarav Sharma", admissionNo: "STU-1024", classLabel: "10-A", rollNo: "18", born: "14 Aug 2015", dateOfBirth: "2015-08-14", parent: "Meera Sharma", parentPhone: "9800000042" };
      const sampleEmployee = { name: "Kavita Joshi", employeeId: "EMP-014", role: "Teacher", department: "Academics", joiningDate: "1 Apr 2022" };
      const result = await act<{ ok: true; html: string }>(token, "previewDocumentTemplate", {
        type: draft.type,
        layout: draft.layout,
        pageSize: draft.pageSize,
        orientation: draft.orientation,
        data: {
          school: { name: "Anekio Public School", address: "MG Road, Indore, Madhya Pradesh", ...(data.school || {}) },
          student: student || sampleStudent,
          employee: employee || sampleEmployee,
          exam: { name: "Term 1", classLabel: student?.classLabel || "5-A", schedule: [{ subject: "English", date: "11 Sep 2026" }, { subject: "Mathematics", date: "12 Sep 2026" }] },
          results: { marks: [{ subject: "English", marks: 76, maxMarks: 80, grade: "A1" }, { subject: "Mathematics", marks: 72, maxMarks: 80, grade: "A1" }] },
          fees: { amount: "₹24,000", paid: "₹18,000", due: "₹6,000", lines: [{ item: "Tuition fee", amount: "₹20,000" }, { item: "Activity fee", amount: "₹4,000" }] },
          document: {},
        },
      });
      if (browserWindow) {
        browserWindow.document.open();
        browserWindow.document.write(result.html);
        browserWindow.document.close();
      } else {
        await Linking.openURL(`data:text/html;charset=utf-8,${encodeURIComponent(result.html)}`);
      }
    } catch (error) {
      browserWindow?.close();
      setMessage(error instanceof Error ? error.message : "Could not preview template.");
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <Modal open title={`Design · ${draft.name}`} onClose={onClose} studio footer={
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <Text className={`text-xs ${/could not|required|add /i.test(message) ? "text-red-700" : "text-green-800"}`}>{message}</Text>
        <View className="flex-row gap-2"><Button variant="ghost" disabled={previewing} onPress={() => void preview()}>{previewing ? "Preparing…" : "Preview"}</Button><Button variant="ghost" disabled={saving} onPress={() => void save(false)}>Save draft</Button><Button disabled={saving} onPress={() => void save(true)}>Publish template</Button></View>
      </View>
    }>
      <View className="flex-row items-start gap-4">
        <View className="w-44 shrink-0 gap-4">
          <View>
            <Text className="text-xs font-semibold uppercase tracking-wide text-ink-700">Add elements</Text>
            <View className="mt-2 gap-1">
              {ELEMENTS.map((item) => (
                <Pressable key={item.type} onPress={() => add(item.type)} className="flex-row items-center gap-2 rounded-md px-2 py-2 hover:bg-ink-50">
                  <Ionicons name={item.icon} size={16} color="#3d4f66" /><Text className="text-xs text-ink-900">{item.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View>
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-700">Page</Text>
            <Dropdown value={draft.pageSize} options={["A4", "A5", "LETTER", "CR80", "CUSTOM"].map((id) => ({ id, label: id }))} onChange={(pageSize) => setDraft((row) => ({ ...row, pageSize }))} />
            <View className="mt-2"><Segmented value={draft.orientation} options={[{ id: "PORTRAIT", label: "Portrait" }, { id: "LANDSCAPE", label: "Landscape" }]} onChange={(orientation) => setDraft((row) => ({ ...row, orientation }))} /></View>
            <View className="mt-3"><Dropdown label="Preview data" value={previewTarget} options={[{ id: "sample", label: "Sample data" }, ...previewPeople]} onChange={setPreviewTarget} /></View>
          </View>
        </View>

        <View className="min-w-0 flex-1 gap-2">
          <View className="flex-row items-center justify-center gap-2"><Button variant="ghost" disabled={!history.length} onPress={undo}>Undo</Button><Button variant="ghost" disabled={!future.length} onPress={redo}>Redo</Button><Text className="text-[11px] text-ink-700">Drag to move · use exact values at right</Text></View>
          <ScrollView horizontal className="rounded-lg bg-ink-100 p-5" contentContainerStyle={{ minWidth: canvasWidth + 40, justifyContent: "center" }}>
            <View style={{ width: canvasWidth, height: canvasHeight }} className="relative bg-white shadow-lg">
              <View pointerEvents="none" className="absolute inset-3 border border-dashed border-ink-200" />
              {draft.layout.elements.map((item) => (
                <CanvasItem key={item.id} element={item} selected={item.id === selectedId} canvasWidth={canvasWidth} canvasHeight={canvasHeight} onSelect={() => setSelectedId(item.id)} onMoveStart={rememberLayout} onMove={(x, y) => patchElement(item.id, { x, y }, false)} />
              ))}
            </View>
          </ScrollView>
        </View>

        <View className="w-64 shrink-0">
          <Field label="Template name"><Input value={draft.name} onChangeText={(name) => setDraft((row) => ({ ...row, name }))} /></Field>
          {selected ? (
            <View className="mt-5 gap-3 border-t border-ink-100 pt-4">
              <View className="flex-row items-center justify-between gap-2"><Text className="text-sm font-semibold text-ink-900">{ELEMENTS.find((row) => row.type === selected.type)?.label || selected.type}</Text><Badge>{selected.locked ? "Locked" : "Selected"}</Badge></View>
              {selected.type === "TEXT" ? <Field label="Text"><Input multiline value={selected.value || ""} onChangeText={(value) => patchElement(selected.id, { value })} /></Field> : null}
              {["FIELD", "TABLE", "BARCODE"].includes(selected.type) ? <Dropdown label="Data" value={selected.field || ""} options={studio.fields.map((field) => ({ id: field.id, label: `${field.group} · ${field.label}`, searchText: `${field.group} ${field.label}` }))} onChange={(field) => patchElement(selected.id, { field, label: studio.fields.find((row) => row.id === field)?.label })} /> : null}
              {selected.type === "CUSTOM_QR" ? <Field label="URL"><Input autoCapitalize="none" value={selected.value || ""} placeholder="https://" onChangeText={(value) => patchElement(selected.id, { value })} /></Field> : null}
              <View className="flex-row flex-wrap gap-2"><NumericProperty label="X" value={selected.x} onChange={(x) => patchElement(selected.id, { x: clamp(x, 0, 100 - selected.width) })} /><NumericProperty label="Y" value={selected.y} onChange={(y) => patchElement(selected.id, { y: clamp(y, 0, 100 - selected.height) })} /><NumericProperty label="Width" value={selected.width} onChange={(width) => patchElement(selected.id, { width: clamp(width, 2, 100 - selected.x) })} /><NumericProperty label="Height" value={selected.height} onChange={(height) => patchElement(selected.id, { height: clamp(height, 1, 100 - selected.y) })} /></View>
              <View><Text className="mb-1 text-[10px] font-medium uppercase text-ink-700">Align on page</Text><View className="flex-row flex-wrap gap-1"><Button variant="ghost" onPress={() => patchElement(selected.id, { x: 0 })}>Left</Button><Button variant="ghost" onPress={() => patchElement(selected.id, { x: (100 - selected.width) / 2 })}>Center</Button><Button variant="ghost" onPress={() => patchElement(selected.id, { x: 100 - selected.width })}>Right</Button></View></View>
              {["TEXT", "FIELD", "TABLE", "PAGE_NUMBER"].includes(selected.type) ? <NumericProperty label="Font size" value={selected.fontSize || 14} onChange={(fontSize) => patchElement(selected.id, { fontSize: clamp(fontSize, 6, 72) })} /> : null}
              <View><Text className="mb-1 text-[10px] font-medium uppercase text-ink-700">Layer</Text><View className="flex-row gap-1"><Button variant="ghost" onPress={() => moveLayer(selected.id, "front")}>Bring front</Button><Button variant="ghost" onPress={() => moveLayer(selected.id, "back")}>Send back</Button></View></View>
              <View className="flex-row flex-wrap gap-2"><Button variant="ghost" onPress={() => { const copy = { ...selected, id: `${selected.type.toLowerCase()}-${Date.now()}`, x: clamp(selected.x + 2, 0, 100 - selected.width), y: clamp(selected.y + 2, 0, 100 - selected.height) }; setElements([...draft.layout.elements, copy]); setSelectedId(copy.id); }}>Duplicate</Button><Button variant="ghost" onPress={() => patchElement(selected.id, { locked: !selected.locked })}>{selected.locked ? "Unlock" : "Lock"}</Button><Button variant="danger" onPress={() => { setElements(draft.layout.elements.filter((row) => row.id !== selected.id)); setSelectedId(""); }}>Delete</Button></View>
            </View>
          ) : <Text className="mt-5 text-xs leading-5 text-ink-700">Select an element on the page to edit its data, size, position, and lock state.</Text>}
        </View>
      </View>
    </Modal>
  );
}

function IssueModal({ template, data, onClose, onDone }: { template: DocumentTemplateSummary; data: RecordPayload; onClose: () => void; onDone: () => Promise<void> }) {
  const { token } = useSession();
  const [target, setTarget] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const employeeType = template.category === "EMPLOYEE";
  const options = employeeType
    ? (data.staff || []).map((row) => ({ id: `${row.kind}:${row.id}`, label: `${row.name} · ${row.employeeId || row.role}` }))
    : (data.people || []).map((row) => ({ id: `student:${row.id}`, label: `${row.name} · ${row.classLabel}` }));
  async function issue() {
    const picked = options.find((row) => row.id === target);
    const label = picked?.label.split(" · ")[0] || customLabel.trim();
    if (!target && !label) { setMessage("Choose a student or employee."); return; }
    setPending(true);
    try {
      const [subjectType, subjectId] = target ? target.split(":") : ["custom", `custom-${Date.now()}`];
      const school = data.school || { name: "School", address: "" };
      const student = data.people?.find((row) => row.id === subjectId);
      const employee = data.staff?.find((row) => row.id === subjectId);
      const result = await act<{ ok: true; documentNumber: string; documentUrl: string }>(token, "issueDocument", { templateId: template.id, subjectType, subjectId, subjectLabel: label, data: { school, student: student ? { ...student, classLabel: student.classLabel } : undefined, employee, document: {} } });
      await onDone();
      onClose();
      await Linking.openURL(result.documentUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not issue document.");
    } finally { setPending(false); }
  }
  return (
    <Modal open title={`Issue · ${template.name}`} onClose={onClose} footer={<View className="items-end"><Button disabled={pending} onPress={() => void issue()}>{pending ? "Issuing…" : "Issue document"}</Button></View>}>
      <View className="gap-4">
        {options.length ? <Dropdown label={employeeType ? "Employee" : "Student"} value={target} options={options} placeholder="Choose" onChange={setTarget} /> : <Field label="Recipient / record"><Input value={customLabel} onChangeText={setCustomLabel} placeholder="Name or reference" /></Field>}
        <View className="rounded-md border border-blue-200 bg-blue-50 p-3"><Text className="text-xs leading-5 text-blue-900">Issuing creates an immutable document number, Verify ID, verification link, template-version snapshot, and audit record.</Text></View>
        {message ? <Text className="text-sm text-red-700">{message}</Text> : null}
      </View>
    </Modal>
  );
}

export function DocumentStudio({ studio, data }: { studio: Studio; data: RecordPayload }) {
  const { reload } = useRecord();
  const { token, user } = useSession();
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const [view, setView] = useState("templates");
  const [category, setCategory] = useState("ALL");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<DocumentTemplateSummary | null>(null);
  const [issue, setIssue] = useState<DocumentTemplateSummary | null>(null);
  const [revokeId, setRevokeId] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [reissueId, setReissueId] = useState("");
  const [reissueReason, setReissueReason] = useState("");
  const [message, setMessage] = useState("");
  const design = can(user, "documents.design") || can(user, "school.edit");
  const publish = can(user, "documents.publish") || can(user, "school.edit");
  const issueAllowed = can(user, "documents.issue") || can(user, "school.edit");
  const revokeAllowed = can(user, "documents.revoke") || can(user, "school.edit");
  const allTemplates = [...studio.templates, ...studio.defaults.filter((row) => !studio.templates.some((custom) => custom.type === row.type))];
  const filtered = allTemplates.filter((row) => (category === "ALL" || row.category === category) && (!query.trim() || `${row.name} ${row.description}`.toLowerCase().includes(query.trim().toLowerCase())));

  async function archive(template: DocumentTemplateSummary) {
    try { await act(token, "archiveDocumentTemplate", { id: template.id }); setMessage("Template archived."); await reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not archive template."); }
  }

  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap items-start justify-between gap-4">
        <View className="max-w-2xl"><Text className="text-lg font-semibold text-ink-900">Document templates</Text><Text className="mt-1 text-sm leading-5 text-ink-700">Design once here. Generate from Students, Exams, Fees, or Employees using the active version.</Text></View>
        <View className="w-64"><Segmented value={view} options={[{ id: "templates", label: "Templates" }, { id: "issued", label: `Issued · ${studio.issued.length}` }]} onChange={setView} /></View>
      </View>
      {!desktop ? <View className="rounded-lg border border-blue-200 bg-blue-50 p-4"><Text className="font-semibold text-blue-900">Design templates on a laptop</Text><Text className="mt-1 text-xs leading-5 text-blue-900">On this device you can select active templates, issue documents, preview, download, print, and share.</Text></View> : null}
      {message ? <Text className="text-sm text-ink-700">{message}</Text> : null}

      {view === "templates" ? (
        <>
          <View className="flex-row flex-wrap items-center gap-2"><Pressable onPress={() => setCategory("ALL")} className={`rounded-full border px-3 py-1.5 ${category === "ALL" ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}><Text className={`text-xs ${category === "ALL" ? "text-white" : "text-ink-800"}`}>All · {allTemplates.length}</Text></Pressable>{studio.categories.map((row) => <Pressable key={row.id} onPress={() => setCategory(row.id)} className={`rounded-full border px-3 py-1.5 ${category === row.id ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"}`}><Text className={`text-xs ${category === row.id ? "text-white" : "text-ink-800"}`}>{row.label}</Text></Pressable>)}</View>
          <Input value={query} onChangeText={setQuery} placeholder="Search report card, receipt, certificate…" />
          <View className="flex-row flex-wrap gap-3">
            {filtered.map((template) => {
              const type = studio.types.find((row) => row.id === template.type);
              return (
              <View key={template.id} className="min-w-[280px] flex-1 rounded-lg border border-ink-200 bg-white p-4 md:max-w-[48%]">
                  <View className="flex-row items-start gap-3"><View className="h-16 w-12 items-center justify-center rounded border border-ink-200 bg-ink-50"><Ionicons name={template.pageSize === "CR80" ? "card-outline" : "document-text-outline"} size={24} color="#3d4f66" /></View><View className="min-w-0 flex-1"><View className="flex-row flex-wrap items-center gap-2"><Text className="font-semibold text-ink-900">{template.name}</Text><Badge tone={template.status === "ACTIVE" ? "leaf" : template.builtIn ? "clay" : "ink"}>{template.status === "ACTIVE" ? `Active · v${template.activeVersion}` : template.builtIn ? "Default" : template.status}</Badge></View><Text className="mt-1 text-xs leading-4 text-ink-700">{type?.hint || template.description}</Text><Text className="mt-2 text-[11px] text-ink-700">{template.pageSize} · {template.orientation.toLowerCase()} · {template.layout.elements.length} elements</Text></View></View>
                  <View className="mt-4 flex-row flex-wrap gap-2">{desktop && design ? <Button variant="ghost" onPress={() => setEditor(template)}>{template.builtIn ? "Customize" : "Edit"}</Button> : null}{template.status === "ACTIVE" && issueAllowed ? <Button onPress={() => setIssue(template)}>Issue</Button> : null}{!template.builtIn && publish ? <Button variant="danger" onPress={() => void archive(template)}>Archive</Button> : null}</View>
                </View>
              );
            })}
          </View>
        </>
      ) : (
        <View className="overflow-hidden rounded-lg border border-ink-200 bg-white">
          {studio.issued.length ? studio.issued.map((row, index) => (
            <View key={row.id} className={`flex-row flex-wrap items-center justify-between gap-3 px-4 py-3 ${index ? "border-t border-ink-100" : ""}`}><View><View className="flex-row flex-wrap items-center gap-2"><Text className="text-sm font-semibold text-ink-900">{row.documentNumber}</Text><Badge tone={row.status === "VALID" ? "leaf" : "danger"}>{row.status}</Badge></View><Text className="mt-0.5 text-xs text-ink-700">{row.templateName} · {row.subjectLabel || row.subjectId} · {new Date(row.issuedAt).toLocaleDateString("en-IN")}</Text></View><View className="flex-row gap-3"><Pressable onPress={() => void Linking.openURL(row.documentUrl)}><Text className="text-xs font-semibold text-clay-600">Open</Text></Pressable><Pressable onPress={() => void Linking.openURL(row.verifyUrl)}><Text className="text-xs font-semibold text-clay-600">Verify</Text></Pressable>{row.status === "VALID" && issueAllowed ? <Pressable onPress={() => { setReissueId(row.id); setReissueReason(""); }}><Text className="text-xs font-semibold text-clay-600">Reissue</Text></Pressable> : null}{row.status === "VALID" && revokeAllowed ? <Pressable onPress={() => { setRevokeId(row.id); setRevokeReason(""); }}><Text className="text-xs font-semibold text-red-700">Revoke</Text></Pressable> : null}</View></View>
          )) : <Text className="p-8 text-center text-sm text-ink-700">No documents issued yet.</Text>}
        </View>
      )}
      {editor ? <TemplateEditor template={editor} studio={studio} data={data} onClose={() => setEditor(null)} onSaved={reload} /> : null}
      {issue ? <IssueModal template={issue} data={data} onClose={() => setIssue(null)} onDone={reload} /> : null}
      <Modal open={Boolean(revokeId)} title="Revoke issued document" onClose={() => setRevokeId("")} footer={<View className="flex-row justify-end gap-2"><Button variant="ghost" onPress={() => setRevokeId("")}>Cancel</Button><Button variant="danger" disabled={!revokeReason.trim()} onPress={async () => { try { await act(token, "changeIssuedDocumentStatus", { id: revokeId, status: "REVOKED", reason: revokeReason }); setRevokeId(""); setMessage("Document revoked. Its verification page now shows Revoked."); await reload(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not revoke document."); } }}>Revoke</Button></View>}>
        <View className="gap-3"><Text className="text-sm leading-5 text-ink-700">The original issue record remains in the register. Anyone scanning its QR will see that it is revoked.</Text><Field label="Reason"><Input multiline value={revokeReason} onChangeText={setRevokeReason} placeholder="Incorrect data, replaced, issued by mistake…" /></Field></View>
      </Modal>
      <Modal open={Boolean(reissueId)} title="Reissue document" onClose={() => setReissueId("")} footer={<View className="flex-row justify-end gap-2"><Button variant="ghost" onPress={() => setReissueId("")}>Cancel</Button><Button disabled={!reissueReason.trim()} onPress={async () => { try { const result = await act<{ ok: true; documentUrl: string }>(token, "reissueDocument", { id: reissueId, reason: reissueReason }); setReissueId(""); setMessage("Replacement issued. The earlier document now verifies as Superseded."); await reload(); await Linking.openURL(result.documentUrl); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not reissue document."); } }}>Issue replacement</Button></View>}>
        <View className="gap-3"><Text className="text-sm leading-5 text-ink-700">This creates a new document number using the current active template. The earlier record stays in the register and changes to Superseded.</Text><Field label="Reason"><Input multiline value={reissueReason} onChangeText={setReissueReason} placeholder="Corrected name, updated marks, damaged copy…" /></Field></View>
      </Modal>
    </View>
  );
}

function issuableTemplates(studio: RecordPayload["documentStudio"] | undefined, allowedTypes: string[]) {
  const active = (studio?.templates || []).filter((row) => row.status === "ACTIVE" && allowedTypes.includes(row.type));
  const used = new Set(active.map((row) => row.type));
  const defaults = (studio?.defaults || []).filter((row) => allowedTypes.includes(row.type) && !used.has(row.type));
  for (const row of defaults) used.add(row.type);
  const missing: DocumentTemplateSummary[] = allowedTypes
    .filter((type) => !used.has(type))
    .map((type) => ({
      id: `builtin:${type}`,
      builtIn: true,
      type,
      category: "ACADEMIC",
      name: type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      description: "",
      pageSize: "A4",
      orientation: "PORTRAIT",
      status: "DEFAULT",
      activeVersion: null,
      updatedAt: null,
      layout: { elements: [] },
    }));
  return [...active, ...defaults, ...missing].sort(
    (a, b) => Number(b.type === "REPORT_CARD") - Number(a.type === "REPORT_CARD") || a.name.localeCompare(b.name)
  );
}

export function QuickDocumentButton({
  data,
  subjectType,
  subjectId,
  subjectLabel,
  allowedTypes,
  label = "Documents",
  extraData,
  batchSubjects,
}: {
  data: RecordPayload;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  allowedTypes: string[];
  label?: string;
  extraData?: Record<string, unknown>;
  batchSubjects?: { subjectType: string; subjectId: string; subjectLabel: string; data?: Record<string, unknown> }[];
}) {
  const { token, user } = useSession();
  const { reload } = useRecord();
  const studio = data.documentStudio;
  const templates = issuableTemplates(studio, allowedTypes);
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [blocked, setBlocked] = useState<BlockedDocumentStudent[]>([]);
  const [blockIfPendingMonths, setBlockIfPendingMonths] = useState("");
  const selectedTemplate = templates.find((row) => row.id === templateId) || templates[0];
  const feeGate = selectedTemplate?.type === "ADMIT_CARD";
  useEffect(() => {
    if (!open) return;
    const preferred = templates.find((row) => row.type === "REPORT_CARD") || templates[0];
    if (preferred && !templates.some((row) => row.id === templateId)) setTemplateId(preferred.id);
  }, [open, templates, templateId]);
  if (!(can(user, "documents.issue") || can(user, "school.edit"))) return null;

  async function issue() {
    const template = templates.find((row) => row.id === templateId) || templates[0];
    if (!template) { setMessage("No active template. Publish one in Settings → Documents first."); return; }
    const student = data.people?.find((row) => row.id === subjectId);
    const employee = data.staff?.find((row) => row.id === subjectId);
    setPending(true);
    setMessage("");
    setBlocked([]);
    try {
      if (batchSubjects?.length) {
        const result = await act<{ ok: true; combinedUrl: string; issued: unknown[]; blocked: BlockedDocumentStudent[] }>(token, "issueDocumentBatch", {
          templateId: template.id,
          blockIfPendingMonths: Number(blockIfPendingMonths) || 0,
          subjects: batchSubjects.map((row) => {
            const batchStudent = data.people?.find((person) => person.id === row.subjectId);
            const batchEmployee = data.staff?.find((person) => person.id === row.subjectId);
            return {
              subjectType: row.subjectType,
              subjectId: row.subjectId,
              subjectLabel: row.subjectLabel,
              data: { school: data.school, student: batchStudent, employee: batchEmployee, ...(extraData || {}), ...(row.data || {}), document: {} },
            };
          }),
        });
        await reload();
        setBlocked(result.blocked || []);
        if (result.blocked?.length) setMessage(`${result.issued.length} issued. ${result.blocked.length} blocked because pending fee months were ≥ ${Number(blockIfPendingMonths) || 0}.`);
        if (!result.blocked?.length) setOpen(false);
        if (result.combinedUrl) await Linking.openURL(result.combinedUrl);
        return;
      }
      const result = await act<{ ok: true; documentUrl: string }>(token, "issueDocument", {
        templateId: template.id,
        subjectType,
        subjectId,
        subjectLabel,
        data: {
          school: data.school,
          student,
          employee,
          fees: student ? {
            lines: student.invoices || [],
            amount: student.billed || "",
            paid: student.paid || "",
            due: student.dueNow || "",
          } : undefined,
          ...(extraData || {}),
          document: {},
        },
      });
      await reload();
      setOpen(false);
      await Linking.openURL(result.documentUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not issue document.");
    } finally { setPending(false); }
  }

  return (
    <>
      <Button variant="ghost" onPress={() => setOpen(true)}>{label}</Button>
      <Modal open={open} title={`Issue for ${subjectLabel}`} onClose={() => setOpen(false)} footer={<View className="items-end"><Button disabled={pending || !templates.length} onPress={() => void issue()}>{pending ? "Issuing…" : "Issue and open"}</Button></View>}>
        <View className="gap-4">
          {batchSubjects?.length ? <View className="rounded-md border border-blue-200 bg-blue-50 p-3"><Text className="text-sm font-semibold text-blue-900">Class batch · {batchSubjects.length} students</Text><Text className="mt-1 text-xs leading-5 text-blue-900">Anekio will create one immutable issue record per eligible student and open one combined printable file.</Text></View> : null}
          {templates.length ? (
            <View className="gap-2">
              <Text className="text-xs font-medium uppercase tracking-wide text-ink-700">Template</Text>
              {templates.map((row) => {
                const selected = (templateId || templates[0]?.id) === row.id;
                return (
                  <Pressable
                    key={row.id}
                    onPress={() => setTemplateId(row.id)}
                    className={`rounded-md border px-3 py-2.5 ${selected ? "border-clay-500 bg-blue-50" : "border-ink-200 bg-white"}`}
                  >
                    <Text className="text-sm font-semibold text-ink-900">{row.name}</Text>
                    <Text className="mt-0.5 text-xs text-ink-700">{row.builtIn || row.status === "DEFAULT" ? "School default" : `Active · v${row.activeVersion}`}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <View className="rounded-md border border-amber-300 bg-amber-50 p-3">
              <Text className="text-sm font-semibold text-amber-900">No template available</Text>
              <Text className="mt-1 text-xs leading-5 text-amber-900">Add a document type in Settings → Documents, then issue it here.</Text>
            </View>
          )}
          {batchSubjects?.length && feeGate ? (
            <Field label="Block if pending months ≥" hint="Example: 2 means students with 2 or more unpaid fee months will not get this document. Clear or enter 0 to issue everyone.">
              <Input keyboardType="number-pad" value={blockIfPendingMonths} onChangeText={setBlockIfPendingMonths} placeholder="2" />
            </Field>
          ) : null}
          {message ? <Text className="text-sm text-red-700">{message}</Text> : null}
          {blocked.length ? (
            <View className="rounded-lg border border-red-200 bg-red-50 p-3">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-red-900">Blocked by fee rule</Text>
                  <Text className="mt-1 text-xs leading-4 text-red-800">Parents have been notified where possible. Use Call or WhatsApp to follow up with the fee link.</Text>
                </View>
                <Badge tone="danger">{`${blocked.length} blocked`}</Badge>
              </View>
              <View className="mt-3 gap-2">
                {blocked.slice(0, 8).map((row) => {
                  const phone = cleanPhone(row.parentPhone);
                  const whatsAppUrl = phone ? `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(feeBlockMessage(row))}` : "";
                  return (
                    <View key={row.subjectId} className="rounded-md border border-red-100 bg-white p-3">
                      <View className="flex-row items-start justify-between gap-3">
                        <View className="flex-1">
                          <Text className="text-sm font-semibold text-ink-900">{row.subjectLabel || row.error}</Text>
                          <Text className="mt-0.5 text-xs text-red-800">{row.pendingMonths ? `${row.pendingMonths} pending fee month${row.pendingMonths === 1 ? "" : "s"}` : row.error}</Text>
                          {row.parentName || row.parentPhone ? <Text className="mt-1 text-xs text-ink-600">{[row.parentName, row.parentPhone].filter(Boolean).join(" · ")}</Text> : null}
                          {row.noticeSent ? <Text className="mt-1 text-xs font-medium text-green-700">Parent notification sent</Text> : null}
                        </View>
                        <View className="flex-row flex-wrap justify-end gap-2">
                          {phone ? (
                            <Pressable onPress={() => void Linking.openURL(`tel:${phone}`)} className="h-9 w-9 items-center justify-center rounded-md border border-ink-200 bg-white">
                              <Ionicons name="call-outline" size={18} color="#102a43" />
                            </Pressable>
                          ) : null}
                          {whatsAppUrl ? (
                            <Pressable onPress={() => void Linking.openURL(whatsAppUrl)} className="h-9 w-9 items-center justify-center rounded-md border border-green-200 bg-green-50">
                              <Ionicons name="logo-whatsapp" size={18} color="#047857" />
                            </Pressable>
                          ) : null}
                          {row.payUrl ? (
                            <Pressable onPress={() => void Linking.openURL(row.payUrl || "")} className="h-9 w-9 items-center justify-center rounded-md border border-blue-200 bg-blue-50">
                              <Ionicons name="card-outline" size={18} color="#1d4ed8" />
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}
