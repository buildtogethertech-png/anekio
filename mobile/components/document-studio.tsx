import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Linking, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "./form";
import { Badge, Button, Field, Input, Modal, Segmented } from "./ui";
import { useAssetUrl } from "../lib/assets";
import { act } from "../lib/mutate";
import { useRecord, type DocumentElement, type DocumentElementType, type DocumentLayout, type DocumentTemplateSummary, type RecordPayload } from "../lib/record";
import { useSession } from "../lib/session";

type Studio = NonNullable<RecordPayload["documentStudio"]>;

type ElementAction = {
  type: DocumentElementType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  element?: Partial<DocumentElement>;
};

const COMMON_ELEMENTS: ElementAction[] = [
  { type: "IMAGE", label: "School logo", icon: "school-outline", element: { field: "school.logoPath", label: "School logo", width: 12, height: 10 } },
  { type: "TEXT", label: "Text", icon: "text-outline" },
  { type: "FIELD", label: "Data field", icon: "code-slash-outline" },
  { type: "TABLE", label: "Table", icon: "grid-outline" },
  { type: "PHOTO", label: "Photo", icon: "person-outline" },
];

const ADVANCED_ELEMENTS: ElementAction[] = [
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

const ELEMENTS = [...COMMON_ELEMENTS, ...ADVANCED_ELEMENTS];
const MM_TO_CSS_PX = 96 / 25.4;
const PAGE_MM: Record<string, [number, number]> = {
  A4: [210, 297],
  A5: [148, 210],
  LETTER: [216, 279],
  CR80: [54, 85.6],
  CUSTOM: [210, 297],
};
const MEDIA_FIELD_LABELS: Record<string, string> = {
  "school.logoPath": "School logo",
  "school.signPath": "Principal signature",
  "school.stampPath": "School stamp",
  "student.photo": "Student photo",
};

function can(user: { permissions: string[] } | null, key: string) {
  return Boolean(user?.permissions.includes(key));
}

function visualFamily(type: string, category: string) {
  const admissions = type.startsWith("ADMISSION") || type === "PARENT_CONSENT" || type === "STUDENT_DECLARATION";
  const certificates = /BONAFIDE|CHARACTER_CERTIFICATE|STUDY_CERTIFICATE|DOB_CERTIFICATE|ATTENDANCE_CERTIFICATE|PROMOTION_CERTIFICATE|TRANSFER_CERTIFICATE|CUSTOM_CERTIFICATE|ACHIEVEMENT_CERTIFICATE|PARTICIPATION_CERTIFICATE|MERIT_CERTIFICATE|NO_DUES|MIGRATION/.test(type);
  if (type === "REPORT_CARD") return { label: "ACADEMICS", accent: "#7C3AED", accent2: "#2563EB", iconBg: "#EDE9FE", icon: "school-outline" as const, border: "#DDD6FE" };
  if (type === "GRADE_SHEET" || type === "CONSOLIDATED_REPORT" || type === "PROGRESS_REPORT" || type === "SUBJECT_MARKSHEET" || type === "RESULT_SUMMARY") {
    return { label: "ACADEMICS", accent: "#2563EB", accent2: "#4F46E5", iconBg: "#DBEAFE", icon: "reader-outline" as const, border: "#BFDBFE" };
  }
  if (category === "FEES" || /FEE|RECEIPT|CHALLAN|DUES|REFUND|CONCESSION/.test(type)) {
    return { label: "FINANCE", accent: "#0F766E", accent2: "#14B8A6", iconBg: "#CCFBF1", icon: "receipt-outline" as const, border: "#99F6E4" };
  }
  if (category === "EMPLOYEE") {
    return { label: "EMPLOYEES", accent: "#E11D48", accent2: "#EA580C", iconBg: "#FFE4E6", icon: "briefcase-outline" as const, border: "#FECDD3" };
  }
  if (certificates) {
    return { label: "CERTIFICATES", accent: "#7C3AED", accent2: "#DB2777", iconBg: "#F3E8FF", icon: "ribbon-outline" as const, border: "#E9D5FF" };
  }
  if (admissions) {
    return { label: "ADMISSIONS", accent: "#EA580C", accent2: "#F59E0B", iconBg: "#FFEDD5", icon: "clipboard-outline" as const, border: "#FED7AA" };
  }
  if (category === "ACADEMIC") {
    return { label: "ACADEMICS", accent: "#4F46E5", accent2: "#2563EB", iconBg: "#E0E7FF", icon: "school-outline" as const, border: "#C7D2FE" };
  }
  if (category === "GENERAL") {
    return { label: "LETTERS", accent: "#4338CA", accent2: "#7C3AED", iconBg: "#E0E7FF", icon: "mail-outline" as const, border: "#C7D2FE" };
  }
  if (type === "STUDENT_ID" || type.endsWith("_CARD") || type.endsWith("_PASS")) {
    return { label: "STUDENTS", accent: "#0284C7", accent2: "#06B6D4", iconBg: "#CFFAFE", icon: "id-card-outline" as const, border: "#A5F3FC" };
  }
  return { label: "STUDENTS", accent: "#0284C7", accent2: "#38BDF8", iconBg: "#E0F2FE", icon: "person-outline" as const, border: "#BAE6FD" };
}

function statusMeta(template: DocumentTemplateSummary) {
  if (template.builtIn) return { tone: "clay" as const, label: "Default" };
  if (template.status === "ACTIVE" && template.hasDraft) return { tone: "leaf" as const, label: `Active · v${template.activeVersion} · Draft` };
  if (template.status === "ACTIVE") return { tone: "leaf" as const, label: `Active · v${template.activeVersion}` };
  if (template.status === "DRAFT") return { tone: "warn" as const, label: "Draft" };
  if (template.status === "PUBLISHED") return { tone: "sky" as const, label: "Published" };
  if (template.status === "ARCHIVED") return { tone: "ink" as const, label: "Archived" };
  return { tone: "ink" as const, label: template.status };
}

function MiniDocumentPreview({ template }: { template: DocumentTemplateSummary }) {
  const card = template.pageSize === "CR80";
  const landscape = template.orientation === "LANDSCAPE";
  const width = card ? 108 : landscape ? 118 : 86;
  const height = card ? 68 : landscape ? 84 : 118;
  const layers = template.layout.elements.filter((row) => row.type === "SHAPE" || row.type === "LINE" || row.type === "TABLE").slice(0, 36);
  return (
    <View className="items-center justify-center rounded-xl px-2 py-3" style={{ backgroundColor: "#F8FAFC" }}>
      <View className="overflow-hidden rounded-md bg-white shadow-sm" style={{ width, height }}>
        {layers.map((row) => (
          <View
            key={row.id}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: `${row.x}%`,
              top: `${row.y}%`,
              width: `${row.width}%`,
              height: row.type === "LINE" ? 1 : `${row.height}%`,
              backgroundColor: row.background || (row.type === "TABLE" ? "#2563EB" : row.borderColor || "#E2E8F0"),
              opacity: row.type === "TABLE" ? 0.85 : 1,
            }}
          />
        ))}
      </View>
    </View>
  );
}

function TemplateGalleryCard({
  template,
  hint,
  desktop,
  design,
  publish,
  issueAllowed,
  onEdit,
  onIssue,
  onArchive,
}: {
  template: DocumentTemplateSummary;
  hint: string;
  desktop: boolean;
  design: boolean;
  publish: boolean;
  issueAllowed: boolean;
  onEdit: () => void;
  onIssue: () => void;
  onArchive: () => void;
}) {
  const [hover, setHover] = useState(false);
  const family = visualFamily(template.type, template.category);
  const status = statusMeta(template);
  return (
    <View
      className="min-h-[360px] min-w-[260px] flex-1 overflow-hidden rounded-2xl border bg-white shadow-sm md:max-w-[48%] xl:max-w-[23%]"
      style={{
        borderColor: hover ? family.accent : family.border,
        transform: [{ translateY: hover ? -3 : 0 }],
        shadowOpacity: hover ? 0.16 : 0.06,
        shadowRadius: hover ? 16 : 8,
        transitionDuration: "220ms",
      } as never}
      {...({
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
      } as object)}
    >
      <View className="h-1.5 w-full" style={{ backgroundColor: hover ? family.accent2 : family.accent }} />
      <View className="h-1 w-full opacity-80" style={{ backgroundColor: family.accent2 }} />
      <MiniDocumentPreview template={template} />
      <View className="flex-1 p-4">
        <View className="flex-row items-start gap-3">
          <View className="h-11 w-11 items-center justify-center rounded-xl" style={{ backgroundColor: family.iconBg, transform: [{ scale: hover ? 1.06 : 1 }] }}>
            <Ionicons name={family.icon} size={22} color={family.accent} />
          </View>
          <View className="min-w-0 flex-1">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-[15px] font-bold text-ink-900">{template.name}</Text>
              <Badge tone={status.tone}>{status.label}</Badge>
            </View>
            <Text className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: family.accent }}>{family.label}</Text>
          </View>
        </View>
        <Text className="mt-3 text-xs leading-5 text-ink-700" numberOfLines={3}>{hint}</Text>
        <Text className="mt-3 text-[11px] font-medium text-ink-600">{template.pageSize}  ·  {template.orientation === "LANDSCAPE" ? "Landscape" : "Portrait"}  ·  {template.layout.elements.length} elements</Text>
        <View className="mt-4 flex-row flex-wrap gap-2">
          {desktop && design ? <Button variant="ghost" onPress={onEdit}>{template.builtIn ? "Design document" : "Edit"}</Button> : null}
          {template.status === "ACTIVE" && issueAllowed ? <Button onPress={onIssue}>Issue</Button> : null}
          {!template.builtIn && publish ? <Button variant="danger" onPress={onArchive}>Archive</Button> : null}
        </View>
      </View>
    </View>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cleanNumberText(text: string) {
  return text.replace(/[^0-9.-]/g, "");
}

function formatNumber(value: number) {
  return String(Math.round(value * 10) / 10);
}

function pagePixels(pageSize: string, orientation: string) {
  const [width, height] = PAGE_MM[pageSize] || PAGE_MM.A4;
  const oriented = orientation === "LANDSCAPE" ? [height, width] : [width, height];
  return {
    width: Math.round(oriented[0] * MM_TO_CSS_PX),
    height: Math.round(oriented[1] * MM_TO_CSS_PX),
  };
}

type BlockedDocumentStudent = {
  subjectId: string;
  subjectLabel?: string;
  error: string;
  pendingMonths?: number;
  paidMonths?: number;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  payUrl?: string;
  noticeSent?: boolean;
};

function cleanPhone(value?: string) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function feeBlockMessage(row: BlockedDocumentStudent, reportCard: boolean) {
  const student = row.subjectLabel || "your child";
  const pay = row.payUrl ? `\nPay link: ${row.payUrl}` : "";
  if (reportCard) {
    const paid = row.paidMonths != null ? `${row.paidMonths} paid fee month${row.paidMonths === 1 ? "" : "s"}` : "unpaid fees";
    return `Namaste, ${student}'s report card was not sent because fee months are still pending (${paid}). Please clear the fees so school can share the report card.${pay}`;
  }
  const pending = row.pendingMonths ? `${row.pendingMonths} pending fee month${row.pendingMonths === 1 ? "" : "s"}` : "pending fees";
  return `Namaste, ${student}'s admit card could not be generated because ${pending} are due. Please clear the fees so school can issue the admit card.${pay}`;
}

function newElement(type: DocumentElementType, index: number): DocumentElement {
  const base = { id: `${type.toLowerCase()}-${Date.now()}-${index}`, type, x: 18 + (index % 4) * 3, y: 25 + (index % 8) * 5, width: 36, height: 7, fontSize: 14, color: "#102a43" } as DocumentElement;
  if (type === "VERIFY_QR" || type === "CUSTOM_QR") return { ...base, width: 16, height: 16, label: type === "VERIFY_QR" ? "Verification QR" : "Custom URL" };
  if (type === "BARCODE") return { ...base, width: 32, height: 10, label: "Internal scan code", field: "document.number" };
  if (type === "PHOTO") return { ...base, width: 20, height: 16, label: "Student photo", field: "student.photo" };
  if (type === "SIGNATURE") return { ...base, width: 20, height: 8, label: "Principal signature", field: "school.signPath" };
  if (type === "STAMP") return { ...base, width: 14, height: 12, label: "School stamp", field: "school.stampPath" };
  if (type === "IMAGE") return { ...base, width: 20, height: 16, label: "Image" };
  if (type === "TABLE") return { ...base, width: 70, height: 20, label: "Data table", field: "results.marks" };
  if (type === "LINE") return { ...base, width: 64, height: 1 };
  if (type === "PAGE_NUMBER") return { ...base, width: 18, height: 4, label: "Page 1" };
  if (type === "FIELD") return { ...base, label: "Student name", field: "student.name" };
  if (type === "TEXT") return { ...base, value: "Type your text", label: "Text" };
  return base;
}

function atPath(source: Record<string, unknown>, path?: string) {
  if (!path) return "";
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return "";
    return (value as Record<string, unknown>)[key] ?? "";
  }, source);
}

function previewText(value: unknown) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" && item ? Object.values(item).join(" · ") : String(item)).join("\n");
  if (typeof value === "object") return Object.values(value).join(" · ");
  return String(value);
}

function defaultMediaField(type: DocumentElementType) {
  if (type === "SIGNATURE") return "school.signPath";
  if (type === "STAMP") return "school.stampPath";
  if (type === "PHOTO") return "student.photo";
  if (type === "IMAGE") return "school.logoPath";
  return "";
}

function mediaTypeForField(field?: string): DocumentElementType {
  if (field === "school.signPath") return "SIGNATURE";
  if (field === "school.stampPath") return "STAMP";
  if (field === "student.photo") return "PHOTO";
  return "IMAGE";
}

function isMediaField(field?: string) {
  return Boolean(field && MEDIA_FIELD_LABELS[field]);
}

function MediaElementPreview({ element, previewData }: { element: DocumentElement; previewData: Record<string, unknown> }) {
  const field = element.field || defaultMediaField(element.type);
  const rawValue = atPath(previewData, field);
  const uri = useAssetUrl(typeof rawValue === "string" ? rawValue : "");
  const label = element.label || MEDIA_FIELD_LABELS[field] || ELEMENTS.find((row) => row.type === element.type)?.label || "Image";
  if (uri) {
    return (
      <View className="h-full w-full items-center justify-center bg-white">
        <Image source={{ uri }} className="h-full w-full" resizeMode="contain" />
      </View>
    );
  }
  return (
    <View className="h-full w-full items-center justify-center border border-dashed border-ink-300 bg-ink-50">
      <Ionicons name={element.type === "PHOTO" ? "person-outline" : element.type === "SIGNATURE" ? "pencil-outline" : element.type === "STAMP" ? "ribbon-outline" : "image-outline"} size={20} color="#52667d" />
      <Text className="mt-1 text-center text-[7px] text-ink-700">{label}</Text>
    </View>
  );
}

function previewTable(value: unknown) {
  if (!Array.isArray(value) || !value.length) return null;
  const rows = value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (!rows.length) return null;
  const columns = Object.keys(rows[0]).slice(0, 4);
  return { columns, rows: rows.slice(0, 6) };
}

function tableHeaderLabel(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function ElementPreview({ element, previewData, previewScale }: { element: DocumentElement; previewData: Record<string, unknown>; previewScale: number }) {
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
  if (["PHOTO", "IMAGE", "SIGNATURE", "STAMP"].includes(element.type)) return <MediaElementPreview element={element} previewData={previewData} />;
  if (element.type === "TABLE") {
    const table = previewTable(atPath(previewData, element.field));
    if (table) {
      return (
        <View className="h-full w-full border border-ink-200 bg-white">
          <View className="flex-row bg-ink-50">
            {table.columns.map((column) => (
              <Text key={column} className="flex-1 border-b border-ink-200 px-2 py-1 font-semibold text-ink-700" numberOfLines={1} style={{ fontSize: 8 * previewScale, lineHeight: 10 * previewScale }}>
                {tableHeaderLabel(column)}
              </Text>
            ))}
          </View>
          {table.rows.map((row, index) => (
            <View key={index} className="flex-row border-b border-ink-100">
              {table.columns.map((column) => (
                <Text key={column} className="flex-1 px-2 py-1 text-ink-900" numberOfLines={1} style={{ fontSize: 8 * previewScale, lineHeight: 10 * previewScale }}>
                  {previewText(row[column])}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    }
    return (
      <View className="h-full w-full border border-ink-300 bg-white">
        {[0, 1, 2, 3].map((row) => <View key={row} className={`flex-1 ${row ? "border-t border-ink-200" : "bg-ink-50"}`} />)}
        <Text className="absolute inset-0 text-center text-[8px] leading-[34px] text-ink-700" numberOfLines={3}>
          {previewText(atPath(previewData, element.field)) || element.label || "Table"}
        </Text>
      </View>
    );
  }
  if (element.type === "LINE") return <View className="mt-[2px] h-px w-full bg-ink-600" />;
  if (element.type === "SHAPE") return <View className="h-full w-full border border-ink-400" style={{ backgroundColor: element.background || "#f0f4f8" }} />;
  if (element.type === "FIELD" && isMediaField(element.field)) return <MediaElementPreview element={{ ...element, type: mediaTypeForField(element.field) }} previewData={previewData} />;
  const copy = element.type === "FIELD" ? previewText(atPath(previewData, element.field)) || element.label || "Data" : element.value || element.label || element.type;
  return (
    <Text
      style={{ fontSize: (element.fontSize || 14) * previewScale, lineHeight: (element.fontSize || 14) * previewScale * 1.2, fontWeight: element.fontWeight || "normal", color: element.color || "#102a43", textAlign: element.align || "left", backgroundColor: element.background || "transparent" }}
    >
      {copy}
    </Text>
  );
}

function CanvasItem({ element, selected, canvasWidth, canvasHeight, previewData, previewScale, onSelect, onMoveStart, onMove }: {
  element: DocumentElement;
  selected: boolean;
  canvasWidth: number;
  canvasHeight: number;
  previewData: Record<string, unknown>;
  previewScale: number;
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
      <Pressable className="h-full w-full overflow-hidden" onPress={onSelect}><ElementPreview element={element} previewData={previewData} previewScale={previewScale} /></Pressable>
      {selected ? <View className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-blue-600" /> : null}
    </View>
  );
}

function NumericProperty({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(formatNumber(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(formatNumber(value));
  }, [editing, value]);

  function commit(nextText = text) {
    const cleaned = cleanNumberText(nextText);
    const parsed = Number(cleaned);
    setEditing(false);
    if (cleaned && Number.isFinite(parsed)) {
      onChange(parsed);
      setText(formatNumber(parsed));
    } else {
      setText(formatNumber(value));
    }
  }

  return (
    <View className="min-w-[44%] flex-1">
      <Text className="mb-1 text-[10px] font-medium uppercase text-ink-700">{label}</Text>
      <TextInput
        keyboardType="decimal-pad"
        value={text}
        onFocus={() => setEditing(true)}
        onBlur={() => commit()}
        onSubmitEditing={() => commit()}
        onChangeText={(nextText) => {
          setEditing(true);
          setText(cleanNumberText(nextText));
        }}
        className="rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-900"
      />
    </View>
  );
}

function ElementButton({ item, onPress, compact = false }: { item: ElementAction; onPress: () => void; compact?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      className={`${compact ? "flex-row items-center gap-2 px-2 py-2" : "min-w-[46%] flex-1 items-center gap-1.5 px-2 py-3"} rounded-md border border-ink-100 bg-white hover:bg-ink-50`}
    >
      <Ionicons name={item.icon} size={compact ? 16 : 20} color="#3d4f66" />
      <Text className={`${compact ? "text-xs" : "text-[11px] text-center"} font-medium text-ink-900`}>{item.label}</Text>
    </Pressable>
  );
}

function TemplateEditor({ template, studio, data, onClose, onSaved }: { template: DocumentTemplateSummary; studio: Studio; data: RecordPayload; onClose: () => void; onSaved: () => Promise<void> }) {
  const { token, user } = useSession();
  const canPublish = can(user, "documents.publish") || can(user, "school.edit");
  const [draft, setDraft] = useState(() => ({ ...template, name: template.builtIn ? `${template.name} · School` : template.name, layout: { elements: template.layout.elements.map((row) => ({ ...row })) } }));
  const [selectedId, setSelectedId] = useState(draft.layout.elements[0]?.id || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<DocumentElement[][]>([]);
  const [future, setFuture] = useState<DocumentElement[][]>([]);
  const [previewTarget, setPreviewTarget] = useState("sample");
  const [previewing, setPreviewing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [focusMode, setFocusMode] = useState(false);
  const basePage = pagePixels(draft.pageSize, draft.orientation);
  const canvasWidth = Math.round(basePage.width * canvasZoom);
  const canvasHeight = Math.round(basePage.height * canvasZoom);
  const zoomPct = Math.round(canvasZoom * 100);
  const selected = draft.layout.elements.find((row) => row.id === selectedId);
  const previewPeople = draft.category === "EMPLOYEE"
    ? (data.staff || []).map((row) => ({ id: `employee:${row.id}`, label: `${row.name} · ${row.role || row.employeeId}` }))
    : (data.people || []).map((row) => ({ id: `student:${row.id}`, label: `${row.name} · ${row.classLabel}` }));
  const sampleStudent = { name: "Aarav Sharma", admissionNo: "ADM-1024", classLabel: "10-A", rollNo: "18", born: "14 Aug 2015", dateOfBirth: "2015-08-14", parent: "Meera Sharma", parentPhone: "9800000042" };
  const sampleEmployee = { name: "Kavita Joshi", employeeId: "EMP-014", role: "Teacher", department: "Academics", joiningDate: "1 Apr 2022" };
  const previewSelection = (() => {
    const [kind, id] = previewTarget.split(":");
    return {
      student: kind === "student" ? data.people?.find((row) => row.id === id) : undefined,
      employee: kind === "employee" ? data.staff?.find((row) => row.id === id) : undefined,
    };
  })();
  const canvasPreviewData = {
    school: { name: "Anekio Public School", address: "Sector 21, Indiranagar, Bengaluru - 560038", phone: "office@anekioschool.edu.in | +91 80 4567 2100", ...(data.school || {}) },
    student: previewSelection.student || sampleStudent,
    guardian: {
      name: previewSelection.student?.parent || sampleStudent.parent,
      phone: previewSelection.student?.parentPhone || sampleStudent.parentPhone,
    },
    employee: previewSelection.employee || sampleEmployee,
    exam: { name: "Term 1", classLabel: previewSelection.student?.classLabel || "10-A", rollNo: "18", schedule: [{ subject: "English", date: "11 Sep 2026" }, { subject: "Mathematics", date: "12 Sep 2026" }] },
    results: { marks: [{ subject: "English", marks: 76, maxMarks: 80, grade: "A1" }, { subject: "Mathematics", marks: 72, maxMarks: 80, grade: "A1" }], attendance: "Present 92%" },
    fees: {
      amount: "Rs. 40,850.00",
      paid: "Rs. 0.00",
      due: "Rs. 42,850.00",
      status: "Overdue",
      receiptLabel: "Receipt No.",
      receiptNumber: "RCPT-2026-014",
      term: "Term 1 Fees",
      method: "Cash",
      reference: "RCPT-2026-014",
      receivedBy: "Vikram Rao",
      receivedAt: "2026-09-01 14:30",
      receivedNote: "Collected at office counter",
      upiId: "anekio.publicschool@upi",
      bankName: "Anekio Education Trust",
      account: "123456789012 | IFSC ANEK0001234",
      paymentUrl: "https://pay.anekio.in/DN-2026-00047",
      lines: [
        { description: "Tuition Fee", period: "Apr - Jun 2026", amount: "Rs. 24,000.00" },
        { description: "Transport Fee", period: "Quarter 1", amount: "Rs. 7,200.00" },
        { description: "Examination Fee", period: "Term 1", amount: "Rs. 3,500.00" },
        { description: "Activity & Lab Fee", period: "Annual", amount: "Rs. 4,500.00" },
        { description: "Library & Digital Access", period: "Annual", amount: "Rs. 1,650.00" },
        { description: "Security Deposit", period: "One time", amount: "Rs. 2,000.00" },
      ],
    },
    document: { number: "DN-2026-00047", issueDate: "1 Apr 2026", dueDate: "DUE: 15 APR 2026", verifyId: "VRFY-00047" },
  };
  const selectedField = selected?.field ? studio.fields.find((row) => row.id === selected.field) : null;
  const selectedPreviewValue = selected?.field
    ? isMediaField(selected.field) && previewText(atPath(canvasPreviewData, selected.field))
      ? "Uploaded image"
      : previewText(atPath(canvasPreviewData, selected.field))
    : "";
  const selectedTitle = selectedField?.label || selected?.label || (selected ? ELEMENTS.find((row) => row.type === selected.type)?.label || selected.type : "");

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

  function patchElementPosition(id: string, axis: "x" | "y", value: number) {
    const element = draft.layout.elements.find((row) => row.id === id);
    if (!element) return;
    if (axis === "x") patchElement(id, { x: clamp(value, 0, 100 - element.width) });
    else patchElement(id, { y: clamp(value, 0, 100 - element.height) });
  }

  function patchElementSize(id: string, axis: "width" | "height", value: number) {
    const element = draft.layout.elements.find((row) => row.id === id);
    if (!element) return;
    if (axis === "width") {
      const width = clamp(value, 2, 100);
      patchElement(id, { width, x: clamp(element.x, 0, 100 - width) });
    } else {
      const height = clamp(value, 1, 100);
      patchElement(id, { height, y: clamp(element.y, 0, 100 - height) });
    }
  }

  function add(type: DocumentElementType, patch: Partial<DocumentElement> = {}) {
    const next = { ...newElement(type, draft.layout.elements.length), ...patch };
    setElements([...draft.layout.elements, next]);
    setSelectedId(next.id);
  }

  function changeZoom(next: number) {
    setCanvasZoom(clamp(next, 0.7, 1.4));
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
      const sampleStudent = { name: "Aarav Sharma", admissionNo: "ADM-2026-0142", classLabel: "VIII-A", className: "VIII", sectionName: "A", rollNo: "17", id: "STU-0142", born: "12 Apr 2013", dateOfBirth: "2013-04-12", gender: "Boy", parent: "Meera Sharma", parentPhone: "9800000042" };
      const sampleEmployee = { name: "Kavita Joshi", employeeId: "EMP-014", role: "Teacher", department: "Academics", joiningDate: "1 Apr 2022" };
      const sampleSchool = { name: "Springfield Public School", address: "12, Lake Road, Bengaluru, Karnataka 560001", phone: "080 4000 1200", email: "office@springfield.school", contact: "080 4000 1200 • office@springfield.school", academicYear: "2026–27", sessionTitle: "Academic Session 2026–27", website: "www.springfield.school", ...(data.school || {}) };
      const result = await act<{ ok: true; html: string }>(token, "previewDocumentTemplate", {
        type: draft.type,
        layout: draft.layout,
        pageSize: draft.pageSize,
        orientation: draft.orientation,
        data: {
          school: sampleSchool,
          student: student || sampleStudent,
          employee: employee || sampleEmployee,
          staff: { classTeacherName: "Kavita Joshi", principalName: (data.school as { signatory?: string } | undefined)?.signatory || "Principal" },
          exam: { name: "Annual Examination", classLabel: student?.classLabel || "VIII-A", schedule: [{ subject: "English", date: "11 Sep 2026" }, { subject: "Mathematics", date: "12 Sep 2026" }] },
          results: {
            marks: [
              { Subject: "Mathematics", "Max Marks": 100, "Marks Obtained": 87, Grade: "A+", "Grade Point": "9.0", Remark: "Excellent" },
              { Subject: "English", "Max Marks": 100, "Marks Obtained": 82, Grade: "A", "Grade Point": "8.5", Remark: "Very Good" },
              { Subject: "Science", "Max Marks": 100, "Marks Obtained": 91, Grade: "A+", "Grade Point": "9.5", Remark: "Excellent" },
              { Subject: "Social Science", "Max Marks": 100, "Marks Obtained": 78, Grade: "B+", "Grade Point": "7.5", Remark: "Good" },
              { Subject: "Hindi", "Max Marks": 100, "Marks Obtained": 85, Grade: "A", "Grade Point": "8.5", Remark: "Very Good" },
            ],
            activities: [
              { Activity: "Sports", Grade: "A", Remark: "Excellent participation" },
              { Activity: "Discipline", Grade: "A+", Remark: "Outstanding" },
              { Activity: "Art & Craft", Grade: "A", Remark: "Very Good" },
              { Activity: "Communication", Grade: "A", Remark: "Good" },
            ],
            totalMarks: 500,
            marksObtained: 423,
            percentage: "84.6%",
            overallGrade: "A",
            classRank: 6,
            workingDays: 100,
            daysPresent: 92,
            daysAbsent: 8,
            attendancePercentage: "92%",
            attendanceBar: 92,
            teacherRemark: "Excellent performance. Keep working consistently and participate more actively in classroom activities.",
            promotionStatus: "PROMOTED",
            nextClass: "Promoted to Class IX",
          },
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
    <Modal open title={`Design document · ${draft.name}`} onClose={onClose} studio footer={
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <Text className={`text-xs ${/could not|required|add /i.test(message) ? "text-red-700" : "text-green-800"}`}>{message}</Text>
        <View className="flex-row gap-2"><Button variant="ghost" disabled={previewing} onPress={() => void preview()}>{previewing ? "Preparing…" : "Preview"}</Button><Button variant="ghost" disabled={saving} onPress={() => void save(false)}>Save draft</Button>{canPublish ? <Button disabled={saving} onPress={() => void save(true)}>Publish template</Button> : null}</View>
      </View>
    }>
      <View className="flex-row items-start gap-3">
        {!focusMode ? (
        <View className="w-40 shrink-0 gap-4">
          <View>
            <Text className="text-xs font-semibold uppercase tracking-wide text-ink-700">Add</Text>
            <View className="mt-2 flex-row flex-wrap gap-2">
              {COMMON_ELEMENTS.map((item) => (
                <ElementButton key={`${item.type}-${item.label}`} item={item} onPress={() => add(item.type, item.element)} />
              ))}
            </View>
            <Pressable onPress={() => setShowAdvanced((open) => !open)} className="mt-3 flex-row items-center justify-between rounded-md border border-ink-200 bg-white px-3 py-2">
              <Text className="text-xs font-medium text-ink-900">Advanced</Text>
              <Ionicons name={showAdvanced ? "chevron-up-outline" : "chevron-down-outline"} size={16} color="#3d4f66" />
            </Pressable>
            {showAdvanced ? (
              <View className="mt-2 gap-1">
                {ADVANCED_ELEMENTS.map((item) => (
                  <ElementButton key={`${item.type}-${item.label}`} item={item} compact onPress={() => add(item.type, item.element)} />
                ))}
              </View>
            ) : null}
          </View>
          <View>
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-700">Page</Text>
            <Dropdown value={draft.pageSize} options={["A4", "A5", "LETTER", "CR80", "CUSTOM"].map((id) => ({ id, label: id }))} onChange={(pageSize) => setDraft((row) => ({ ...row, pageSize }))} />
            <View className="mt-2"><Segmented value={draft.orientation} options={[{ id: "PORTRAIT", label: "Portrait" }, { id: "LANDSCAPE", label: "Landscape" }]} onChange={(orientation) => setDraft((row) => ({ ...row, orientation }))} /></View>
            <View className="mt-3"><Dropdown label="Preview data" value={previewTarget} options={[{ id: "sample", label: "Sample data" }, ...previewPeople]} onChange={setPreviewTarget} /></View>
          </View>
        </View>
        ) : null}

        <View className="min-w-0 flex-1 gap-2">
          <View className="flex-row flex-wrap items-center justify-center gap-2">
            <Button variant="ghost" disabled={!history.length} onPress={undo}>Undo</Button>
            <Button variant="ghost" disabled={!future.length} onPress={redo}>Redo</Button>
            <View className="flex-row items-center overflow-hidden rounded-md border border-ink-200 bg-white">
              <Pressable accessibilityRole="button" accessibilityLabel="Zoom out" onPress={() => changeZoom(canvasZoom - 0.1)} className="h-10 w-10 items-center justify-center border-r border-ink-200">
                <Ionicons name="remove-outline" size={18} color="#3d4f66" />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Reset zoom" onPress={() => changeZoom(1)} className="h-10 min-w-[64px] items-center justify-center border-r border-ink-200 px-2">
                <Text className="text-xs font-semibold text-ink-900">{zoomPct}%</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Zoom in" onPress={() => changeZoom(canvasZoom + 0.1)} className="h-10 w-10 items-center justify-center">
                <Ionicons name="add-outline" size={18} color="#3d4f66" />
              </Pressable>
            </View>
            <Button variant="ghost" onPress={() => setFocusMode((on) => !on)}>{focusMode ? "Tools" : "Focus"}</Button>
            <Text className="text-[11px] text-ink-700">Drag to move · use exact values at right</Text>
          </View>
          <ScrollView horizontal className="rounded-lg bg-ink-100 p-4" contentContainerStyle={{ minWidth: canvasWidth + 32, justifyContent: "center" }}>
            <View style={{ width: canvasWidth, height: canvasHeight }} className="relative bg-white shadow-lg">
              <View pointerEvents="none" className="absolute inset-3 border border-dashed border-ink-200" />
              {draft.layout.elements.map((item) => (
                <CanvasItem key={item.id} element={item} selected={item.id === selectedId} canvasWidth={canvasWidth} canvasHeight={canvasHeight} previewData={canvasPreviewData} previewScale={canvasZoom} onSelect={() => setSelectedId(item.id)} onMoveStart={rememberLayout} onMove={(x, y) => patchElement(item.id, { x, y }, false)} />
              ))}
            </View>
          </ScrollView>
        </View>

        <View className="w-56 shrink-0">
          <Field label="Template name"><Input value={draft.name} onChangeText={(name) => setDraft((row) => ({ ...row, name }))} /></Field>
          {selected ? (
            <View className="mt-5 gap-3 border-t border-ink-100 pt-4">
              <View className="flex-row items-center justify-between gap-2"><Text className="min-w-0 flex-1 text-sm font-semibold text-ink-900" numberOfLines={1}>{selectedTitle}</Text><Badge>{selected.locked ? "Locked" : selectedField ? "Dynamic" : "Selected"}</Badge></View>
              {selected.type === "TEXT" ? <Field label="Text"><Input multiline value={selected.value || ""} onChangeText={(value) => patchElement(selected.id, { value })} /></Field> : null}
              {["FIELD", "TABLE", "BARCODE"].includes(selected.type) ? <Dropdown label="Shows" value={selected.field || ""} options={studio.fields.map((field) => ({ id: field.id, label: `${field.group} · ${field.label}`, searchText: `${field.group} ${field.label}` }))} onChange={(field) => patchElement(selected.id, { field, label: studio.fields.find((row) => row.id === field)?.label })} /> : null}
              {selectedField ? (
                <View className="rounded-md border border-blue-100 bg-blue-50 p-3">
                  <Text className="text-[11px] font-semibold text-blue-900">{selectedField.group} data</Text>
                  <Text className="mt-1 text-xs text-blue-900">{selectedPreviewValue || "No preview value"}</Text>
                </View>
              ) : null}
              {selected.type === "CUSTOM_QR" ? <Field label="URL"><Input autoCapitalize="none" value={selected.value || ""} placeholder="https://" onChangeText={(value) => patchElement(selected.id, { value })} /></Field> : null}
              <View className="flex-row flex-wrap gap-2"><NumericProperty label="X" value={selected.x} onChange={(x) => patchElementPosition(selected.id, "x", x)} /><NumericProperty label="Y" value={selected.y} onChange={(y) => patchElementPosition(selected.id, "y", y)} /><NumericProperty label="Width" value={selected.width} onChange={(width) => patchElementSize(selected.id, "width", width)} /><NumericProperty label="Height" value={selected.height} onChange={(height) => patchElementSize(selected.id, "height", height)} /></View>
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
  const params = useLocalSearchParams<{ document?: string | string[] }>();
  const requestedDocument = Array.isArray(params.document) ? params.document[0] : params.document;
  const openedRequestedDocument = useRef("");
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

  useEffect(() => {
    if (!requestedDocument || openedRequestedDocument.current === requestedDocument) return;
    const template = allTemplates.find((row) => row.type === requestedDocument);
    if (!template) return;
    openedRequestedDocument.current = requestedDocument;
    setView("templates");
    setCategory(template.category);
    setQuery("");
    setEditor(template);
  }, [allTemplates, requestedDocument]);

  async function archive(template: DocumentTemplateSummary) {
    try { await act(token, "archiveDocumentTemplate", { id: template.id }); setMessage("Template archived."); await reload(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not archive template."); }
  }

  return (
    <View className="gap-5">
      <View className="flex-row flex-wrap items-start justify-between gap-4">
        <View className="max-w-2xl">
          <Text className="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-600">Document Studio</Text>
          <Text className="mt-1 text-2xl font-bold tracking-tight text-ink-900">Design documents</Text>
          <Text className="mt-1.5 text-sm leading-6 text-ink-700">Visual PDF and print layouts for IDs, report cards, invoices, and certificates. Fee amounts stay in Fees → Configure fees. WhatsApp campaigns stay in Communication.</Text>
        </View>
        <View className="w-72"><Segmented value={view} options={[{ id: "templates", label: "Library" }, { id: "issued", label: `Issued · ${studio.issued.length}` }]} onChange={setView} /></View>
      </View>
      {!desktop ? <View className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4"><Text className="font-semibold text-indigo-950">Design documents on a laptop</Text><Text className="mt-1 text-xs leading-5 text-indigo-900">On this device you can issue, preview, download, print, and share. Full canvas editing is for larger screens.</Text></View> : null}
      {message ? <Text className="text-sm text-ink-700">{message}</Text> : null}

      {view === "templates" ? (
        <>
          <View className="flex-row flex-wrap items-center gap-2">
            <Pressable onPress={() => setCategory("ALL")} className={`rounded-full border px-3.5 py-1.5 ${category === "ALL" ? "border-indigo-600 bg-indigo-600" : "border-ink-200 bg-white"}`}>
              <Text className={`text-xs font-semibold ${category === "ALL" ? "text-white" : "text-ink-800"}`}>All · {allTemplates.length}</Text>
            </Pressable>
            {studio.categories.map((row) => (
              <Pressable key={row.id} onPress={() => setCategory(row.id)} className={`rounded-full border px-3.5 py-1.5 ${category === row.id ? "border-indigo-600 bg-indigo-600" : "border-ink-200 bg-white"}`}>
                <Text className={`text-xs font-semibold ${category === row.id ? "text-white" : "text-ink-800"}`}>{row.label}</Text>
              </Pressable>
            ))}
          </View>
          <Input value={query} onChangeText={setQuery} placeholder="Search report card, receipt, certificate…" />
          <View className="flex-row flex-wrap gap-4">
            {filtered.map((template) => {
              const type = studio.types.find((row) => row.id === template.type);
              return (
                <TemplateGalleryCard
                  key={template.id}
                  template={template}
                  hint={type?.hint || template.description}
                  desktop={desktop}
                  design={design}
                  publish={publish}
                  issueAllowed={issueAllowed}
                  onEdit={() => setEditor(template)}
                  onIssue={() => setIssue(template)}
                  onArchive={() => void archive(template)}
                />
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
  return [...active, ...defaults, ...missing].sort((a, b) => {
    const rank = (type: string) => type === "REPORT_CARD" ? 2 : type.startsWith("REPORT_CARD") ? 1 : 0;
    return rank(b.type) - rank(a.type) || a.name.localeCompare(b.name);
  });
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
  resultIssue = false,
}: {
  data: RecordPayload;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  allowedTypes: string[];
  label?: string;
  extraData?: Record<string, unknown>;
  batchSubjects?: { subjectType: string; subjectId: string; subjectLabel: string; data?: Record<string, unknown> }[];
  resultIssue?: boolean;
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
  const [requirePaidMonths, setRequirePaidMonths] = useState(
    String((data.school?.policy?.reportCardPaidMonths ?? 0) > 0 ? data.school?.policy?.reportCardPaidMonths : "1")
  );
  const selectedTemplate = templates.find((row) => row.id === templateId) || templates[0];
  const feeGate = !resultIssue && selectedTemplate?.type === "ADMIT_CARD";
  const reportGate = Boolean(
    resultIssue ||
      (selectedTemplate?.type &&
        (selectedTemplate.type === "GRADE_SHEET" ||
          selectedTemplate.type === "CONSOLIDATED_REPORT" ||
          selectedTemplate.type === "PROGRESS_REPORT" ||
          selectedTemplate.type === "REPORT_CARD" ||
          selectedTemplate.type.startsWith("REPORT_CARD_")))
  );
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
          blockIfPendingMonths: feeGate ? Number(blockIfPendingMonths) || 0 : 0,
          requirePaidMonths: reportGate ? Number(requirePaidMonths) || 0 : 0,
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
        if (result.blocked?.length) {
          setMessage(
            reportGate
              ? `${result.issued.length} report cards sent. ${result.blocked.length} parents skipped — paid fee months below ${Number(requirePaidMonths) || 0}.`
              : `${result.issued.length} issued. ${result.blocked.length} blocked because pending fee months were ≥ ${Number(blockIfPendingMonths) || 0}.`
          );
        }
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
      <Modal open={open} title={resultIssue ? `Issue results for ${subjectLabel}` : `Issue for ${subjectLabel}`} onClose={() => setOpen(false)} footer={<View className="items-end"><Button disabled={pending || !templates.length} onPress={() => void issue()}>{pending ? "Issuing…" : "Issue and open"}</Button></View>}>
        <View className="gap-4">
          {batchSubjects?.length ? (
            <View className="rounded-md border border-blue-200 bg-blue-50 p-3">
              <Text className="text-sm font-semibold text-blue-900">Class batch · {batchSubjects.length} students</Text>
              <Text className="mt-1 text-xs leading-5 text-blue-900">
                {resultIssue || reportGate
                  ? "This sends the sitting report card only. Set the paid-months rule below. Parents below that number are skipped and notified."
                  : "Anekio will create one immutable issue record per eligible student and open one combined printable file."}
              </Text>
            </View>
          ) : null}
          {resultIssue ? (
            templates.length ? (
              <View className="rounded-md border border-ink-200 bg-white px-3 py-2.5">
                <Text className="text-sm font-semibold text-ink-900">Report card</Text>
                <Text className="mt-0.5 text-xs text-ink-700">Sitting results for this class</Text>
              </View>
            ) : (
              <View className="rounded-md border border-amber-300 bg-amber-50 p-3">
                <Text className="text-sm font-semibold text-amber-900">No report card template</Text>
                <Text className="mt-1 text-xs leading-5 text-amber-900">Add a Report card type in Settings → Documents, then issue results here.</Text>
              </View>
            )
          ) : templates.length ? (
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
          {batchSubjects?.length && reportGate ? (
            <Field label="Send only if paid months ≥" hint="Example: 3 means only parents whose child has paid at least 3 fee months get this report card. Enter 0 to send to everyone.">
              <Input keyboardType="number-pad" value={requirePaidMonths} onChangeText={setRequirePaidMonths} placeholder="3" />
            </Field>
          ) : null}
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
                  const whatsAppUrl = phone ? `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(feeBlockMessage(row, reportGate))}` : "";
                  return (
                    <View key={row.subjectId} className="rounded-md border border-red-100 bg-white p-3">
                      <View className="flex-row items-start justify-between gap-3">
                        <View className="flex-1">
                          <Text className="text-sm font-semibold text-ink-900">{row.subjectLabel || row.error}</Text>
                          <Text className="mt-0.5 text-xs text-red-800">{row.error}</Text>
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
