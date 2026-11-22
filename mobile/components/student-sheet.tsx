import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Image, Modal as RnModal, Platform, Pressable, ScrollView, Text, TextInput, View, type ViewStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AdmissionFormField, RecordPayload } from "../lib/record";
import { act } from "../lib/mutate";
import { useAssetUrl } from "../lib/assets";
import { pickFile, uploadFile } from "../lib/upload";
import { Button, Card, Modal, Switch } from "./ui";

/**
 * Students → Table: every student on one sortable sheet (web / wide screens), with an "Edit as sheet" mode that
 * works like Excel: type in cells, Enter / ↑ ↓ to move, paste a block copied from Excel, fill a value into all
 * selected rows, then save every change at once. Class, roll and admission number stay read-only here.
 */
type Student = NonNullable<RecordPayload["people"]>[number];

type ColKind = "text" | "date" | "phone" | "email" | "pin" | "number" | "choice" | "file";
type Col = {
  key: string;
  label: string;
  width: number;
  icon: keyof typeof Ionicons.glyphMap;
  kind: ColKind;
  editable: boolean;
  options?: string[];
  /** File columns (photo, documents): the form field, uploaded straight from the cell. */
  file?: { fieldId: string; image: boolean; accept: string };
  read: (s: Student) => string;
  sortValue?: (s: Student) => string | number;
};

const COLS_STORE = "anekio.studentSheet.cols.v1";
const ORDER_STORE = "anekio.studentSheet.order.v1";
const ORDER_ROW_H = 44;
const CHECK_W = 40;
const NAME_W = 210;
const ADM_W = 112;
const ROW_H = 38;

function cleanEmail(v?: string) {
  const e = String(v || "");
  return /@(mobile\.local|local\.anekio\.invalid)$/i.test(e) ? "" : e;
}
function prettyMobile(v: string) {
  const d = mobile10(v);
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : v;
}
function digits(v: string) {
  return v.replace(/\D/g, "");
}
function mobile10(v: string) {
  let d = digits(v);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2015-08-24", "24/08/2015", "24-8-2015" → "2015-08-24"; "" when it is not a date. */
function normDate(v: string) {
  const t = v.trim();
  let y = 0, m = 0, d = 0;
  let r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function dmy(v: string) {
  const n = normDate(v);
  if (!n) return v;
  const [y, m, d] = n.split("-");
  return `${d}/${m}/${y}`;
}
function niceDate(v: string) {
  const n = normDate(v);
  if (!n) return v;
  const [y, m, d] = n.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The value as it will be saved, or an error the office can act on. */
function check(col: Col, raw: string): { value: string; error?: string } {
  const v = raw.trim();
  if (col.key === "name" && !v) return { value: v, error: "Name is needed." };
  if (!v) return { value: "" };
  switch (col.kind) {
    case "date": {
      const n = normDate(v);
      if (!n) return { value: v, error: "Use a date like 24/08/2015." };
      if (n > new Date().toISOString().slice(0, 10)) return { value: v, error: "Date is in the future." };
      return { value: n };
    }
    case "phone": {
      const m = mobile10(v);
      return m.length === 10 ? { value: m } : { value: v, error: "Mobile needs 10 digits." };
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { value: v.toLowerCase() } : { value: v, error: "Not an email address." };
    case "pin":
      return /^\d{6}$/.test(digits(v)) && digits(v).length === v.replace(/\s/g, "").length ? { value: digits(v) } : { value: v, error: "PIN code has 6 digits." };
    case "number":
      return /^-?\d+(\.\d+)?$/.test(v) ? { value: v } : { value: v, error: "Numbers only." };
    case "choice": {
      const hit = (col.options || []).find((o) => o.toLowerCase() === v.toLowerCase());
      return hit ? { value: hit } : { value: v, error: `Pick: ${(col.options || []).join(", ")}` };
    }
    default:
      return { value: v };
  }
}

function buildCols(form: AdmissionFormField[]): Col[] {
  const base: Col[] = [
    // Adm. no. and Student are the two fixed (sticky) columns; these follow.
    { key: "class", label: "Class", width: 72, icon: "school-outline", kind: "text", editable: false, read: (s) => s.classLabel || "" },
    { key: "roll", label: "Roll", width: 64, icon: "list-outline", kind: "number", editable: false, read: (s) => (Number(s.rollNumber) > 0 ? String(s.rollNumber) : ""), sortValue: (s) => (Number(s.rollNumber) > 0 ? Number(s.rollNumber) : 99999) },
    { key: "parentName", label: "Parent", width: 170, icon: "people-outline", kind: "text", editable: true, read: (s) => s.parent || "" },
    { key: "parentPhone", label: "Mobile", width: 124, icon: "call-outline", kind: "phone", editable: true, read: (s) => s.parentPhone || "" },
    { key: "dateOfBirth", label: "Date of birth", width: 132, icon: "calendar-outline", kind: "date", editable: true, read: (s) => s.dateOfBirth || "" },
    { key: "parentEmail", label: "Email", width: 210, icon: "mail-outline", kind: "email", editable: true, read: (s) => cleanEmail(s.parentEmail) },
    { key: "address", label: "Address", width: 230, icon: "home-outline", kind: "text", editable: true, read: (s) => s.parentStreet || s.parentAddress || "" },
    { key: "city", label: "City", width: 130, icon: "business-outline", kind: "text", editable: true, read: (s) => s.parentCity || "" },
    { key: "state", label: "State", width: 130, icon: "map-outline", kind: "text", editable: true, read: (s) => s.parentState || "" },
    { key: "pincode", label: "PIN code", width: 96, icon: "pin-outline", kind: "pin", editable: true, read: (s) => s.parentPincode || "" },
  ];
  const kindOf = (f: AdmissionFormField): ColKind | null =>
    f.type === "select" || f.type === "radio" ? "choice" : f.type === "date" ? "date" : f.type === "phone" ? "phone" : f.type === "email" ? "email" : f.type === "number" ? "number" : f.type === "text" || f.type === "textarea" || f.type === "month" ? "text" : null;
  const custom: Col[] = [];
  const photos: Col[] = [];
  const docs: Col[] = [];
  for (const f of form) {
    if (f.builtin) continue;
    if (f.type === "file") {
      const image = f.fileType === "image";
      const accept = image ? "image/png,image/jpeg,image/webp" : f.fileType === "pdf" ? "application/pdf,.pdf" : "image/png,image/jpeg,image/webp,application/pdf,.pdf";
      const col: Col = {
        key: `custom:${f.id}`,
        label: f.id === "studentPhoto" ? "Photo" : f.label,
        width: image ? 72 : 136,
        icon: image ? "image-outline" : "document-attach-outline",
        kind: "file",
        editable: false,
        file: { fieldId: f.id, image, accept },
        read: (s) => s.admissionData?.[f.id] || "",
        sortValue: (s) => (s.admissionData?.[f.id] ? 0 : 1),
      };
      (f.id === "studentPhoto" ? photos : image ? custom : docs).push(col);
      continue;
    }
    const kind = kindOf(f);
    if (!kind) continue;
    custom.push({
      key: `custom:${f.id}`,
      label: f.label,
      width: kind === "choice" ? 140 : kind === "date" ? 132 : 170,
      icon: kind === "choice" ? "options-outline" : kind === "date" ? "calendar-outline" : "create-outline",
      kind,
      editable: true,
      options: f.options,
      read: (s) => s.admissionData?.[f.id] || "",
    });
  }
  // Documents go last by default; the person can reorder (Columns).
  return [...photos, ...base, ...custom, ...docs];
}

const DEFAULT_HIDDEN = new Set(["address", "state"]);

const sticky = (left: number): ViewStyle =>
  Platform.OS === "web" ? ({ position: "sticky", left, zIndex: 2 } as unknown as ViewStyle) : {};

export function StudentSheet({
  students,
  admissionForm,
  canEdit,
  token,
  tools,
  search,
  onOpen,
  onSaved,
}: {
  students: Student[];
  admissionForm: AdmissionFormField[];
  showFees: boolean;
  canEdit: boolean;
  token: string | null;
  tools: ReactNode;
  /** Search field, kept at a fixed width on the right of the toolbar. */
  search?: ReactNode;
  onOpen: (studentId: string) => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(ORDER_STORE) : null;
      if (raw) return JSON.parse(raw) as string[];
    } catch {}
    return [];
  });
  useEffect(() => {
    try {
      if (Platform.OS !== "web") return;
      if (order.length) globalThis.localStorage?.setItem(ORDER_STORE, JSON.stringify(order));
      else globalThis.localStorage?.removeItem(ORDER_STORE);
    } catch {}
  }, [order]);
  // The person's order first; columns they haven't placed (new form fields) keep their default spot at the end.
  const allCols = useMemo(() => {
    const built = buildCols(admissionForm);
    if (!order.length) return built;
    const rank = new Map(order.map((k, i) => [k, i]));
    return [...built].sort((a, b) => (rank.get(a.key) ?? 1000 + built.indexOf(a)) - (rank.get(b.key) ?? 1000 + built.indexOf(b)));
  }, [admissionForm, order]);
  const [drag, setDrag] = useState<{ key: string; from: number; to: number; startY: number } | null>(null);
  const colList = useMemo(() => {
    if (!drag) return allCols;
    const list = allCols.filter((c) => c.key !== drag.key);
    list.splice(drag.to, 0, allCols[drag.from]);
    return list;
  }, [allCols, drag]);
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(COLS_STORE) : null;
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {}
    return new Set(DEFAULT_HIDDEN);
  });
  useEffect(() => {
    try {
      if (Platform.OS === "web") globalThis.localStorage?.setItem(COLS_STORE, JSON.stringify([...hidden]));
    } catch {}
  }, [hidden]);
  const cols = allCols.filter((c) => !hidden.has(c.key));
  const editCols = cols.filter((c) => c.editable);

  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sortedRows = useMemo(() => {
    if (!sort) return students;
    const col = sort.key === "name" ? null : sort.key === "adm" ? admCol : allCols.find((c) => c.key === sort.key);
    const val = (s: Student) => (col ? (col.sortValue ? col.sortValue(s) : col.read(s).toLowerCase()) : s.name.toLowerCase());
    return [...students].sort((a, b) => {
      const x = val(a), y = val(b);
      const empty = (v: string | number) => v === "" || v === 99999;
      if (empty(x) !== empty(y)) return empty(x) ? 1 : -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
    });
  }, [students, sort, allCols]);

  const [editing, setEditing] = useState(false);
  // Editing only these students (picked rows), or everyone in view when null.
  const [scope, setScope] = useState<Set<string> | null>(null);
  const rows = useMemo(() => (editing && scope ? sortedRows.filter((s) => scope.has(s.id)) : sortedRows), [sortedRows, editing, scope]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAt, setMenuAt] = useState({ right: 16, top: 64 });
  const menuRef = useRef<View>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [fillKey, setFillKey] = useState("");
  const [fillValue, setFillValue] = useState("");
  const [fillClear, setFillClear] = useState(false);
  const [fieldPicker, setFieldPicker] = useState(false);
  const [saving, setSaving] = useState("");
  const [banner, setBanner] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [discardAsk, setDiscardAsk] = useState(false);
  const [focusKey, setFocusKey] = useState("");
  useEffect(() => {
    if (banner?.tone !== "ok") return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
  }, [banner]);
  const inputs = useRef(new Map<string, TextInput | null>());
  const [uploading, setUploading] = useState("");
  const [preview, setPreview] = useState<{ url: string; image: boolean; title: string; sid: string; key: string } | null>(null);
  async function uploadInto(s: Student, c: Col) {
    if (!c.file) return;
    const file = await pickFile(c.file.accept).catch(() => null);
    if (!file) return;
    setUploading(`${s.id}:${c.key}`);
    try {
      const uploaded = await uploadFile(token, file, { kind: "studentDocument", studentId: s.id, type: "CUSTOM_LETTER" });
      await act(token, "setStudentAdmissionFile", { studentId: s.id, fieldId: c.file.fieldId, path: uploaded.path });
      setPreview(null);
      await onSaved(`${c.label} saved for ${s.name}.`);
    } catch (e) {
      setBanner({ tone: "bad", text: e instanceof Error ? e.message : "Could not upload." });
    } finally {
      setUploading("");
    }
  }
  // Choice columns (Gender, Category, …): a list of options under the cell while it has focus (web).
  const [menu, setMenu] = useState<{ id: string; sid: string; key: string; row: number; top: number; left: number; width: number } | null>(null);
  const choiceRef = useRef<View | null>(null);
  // Clicking an option must not blur the cell first (that would close the list before the pick lands).
  useEffect(() => {
    const el = choiceRef.current as unknown as HTMLElement | null;
    if (!menu || Platform.OS !== "web" || !el?.addEventListener) return;
    const keep = (e: Event) => e.preventDefault();
    el.addEventListener("mousedown", keep);
    return () => el.removeEventListener("mousedown", keep);
  }, [menu?.id]);
  useEffect(() => {
    if (!menu || Platform.OS !== "web") return;
    const close = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-choice-menu]")) return;
      setMenu(null);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);
  const active = useRef<{ row: number; col: string } | null>(null);

  const byId = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const colByKey = useMemo(() => new Map([["name", nameCol], ["adm", admCol], ...allCols.map((c) => [c.key, c] as const)]), [allCols]);

  function original(s: Student, key: string) {
    return key === "name" ? s.name : colByKey.get(key)?.read(s) || "";
  }
  function cellValue(s: Student, key: string) {
    return drafts[s.id]?.[key] ?? original(s, key);
  }
  function setCell(id: string, key: string, value: string, base?: Record<string, Record<string, string>>) {
    const s = byId.get(id);
    const next = { ...(base ?? drafts) };
    if (!s) return next;
    const row = { ...(next[id] || {}) };
    const col = colByKey.get(key);
    const norm = col ? check(col, value) : { value };
    if (!norm.error && norm.value === original(s, key)) delete row[key];
    else row[key] = value;
    if (Object.keys(row).length) next[id] = row;
    else delete next[id];
    return next;
  }

  const changedCells = Object.values(drafts).reduce((n, r) => n + Object.keys(r).length, 0);
  const changedRows = Object.keys(drafts).length;
  const invalidCount = Object.entries(drafts).reduce((n, [, r]) => n + Object.entries(r).filter(([k, v]) => check(colByKey.get(k)!, v).error).length, 0);

  // Excel paste: a block with tabs / new lines fills cells right and down from the cell in focus.
  useEffect(() => {
    if (Platform.OS !== "web" || !editing) return;
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain") || "";
      const at = active.current;
      if (!at || !/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return;
      e.preventDefault();
      const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
      const order = ["name", ...editCols.map((c) => c.key)];
      const start = order.indexOf(at.col);
      if (start < 0) return;
      let next = drafts;
      let count = 0;
      lines.forEach((cells, i) => {
        const s = rows[at.row + i];
        if (!s) return;
        cells.forEach((v, j) => {
          const key = order[start + j];
          if (!key) return;
          next = setCell(s.id, key, v.trim(), next);
          count += 1;
        });
      });
      setDrafts(next);
      setBanner({ tone: "ok", text: `Pasted ${count} cell${count === 1 ? "" : "s"}. Check the highlighted cells, then Save.` });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  function choiceMatches(c: Col, typed: string) {
    const t = typed.trim().toLowerCase();
    const all = c.options || [];
    if (!t || all.some((o) => o.toLowerCase() === t)) return all;
    return all.filter((o) => o.toLowerCase().includes(t));
  }
  function pickChoice(sid: string, key: string, option: string) {
    setDrafts((d) => setCell(sid, key, option, d));
    setMenu(null);
  }

  function focusCell(row: number, col: string) {
    const s = rows[row];
    if (!s) return;
    inputs.current.get(`${s.id}:${col}`)?.focus();
  }

  async function save() {
    const ids = Object.keys(drafts);
    if (!ids.length) return;
    if (invalidCount) {
      setBanner({ tone: "bad", text: `${invalidCount} cell${invalidCount === 1 ? " needs" : "s need"} fixing (red) before saving.` });
      return;
    }
    const payload = ids.map((studentId) => {
      const fields: Record<string, unknown> = {};
      const custom: Record<string, string> = {};
      for (const [k, v] of Object.entries(drafts[studentId])) {
        const value = check(colByKey.get(k)!, v).value;
        if (k.startsWith("custom:")) custom[k.slice(7)] = value;
        else fields[k] = value;
      }
      if (Object.keys(custom).length) fields.custom = custom;
      return { studentId, fields };
    });
    const nextErrors: Record<string, string> = {};
    let saved = 0;
    try {
      for (let i = 0; i < payload.length; i += 40) {
        setSaving(`Saving ${Math.min(i + 40, payload.length)} of ${payload.length}…`);
        const res = await act<{ ok: true; saved: number; results: { studentId: string; ok: boolean; error?: string }[] }>(
          token,
          "bulkUpdateStudents",
          { rows: payload.slice(i, i + 40) }
        );
        saved += res.saved;
        for (const r of res.results) if (!r.ok) nextErrors[r.studentId] = r.error || "Could not save.";
      }
    } catch (e) {
      setSaving("");
      setBanner({ tone: "bad", text: e instanceof Error ? e.message : "Could not save." });
      return;
    }
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => nextErrors[id])));
    setErrors(nextErrors);
    setSaving("");
    const failed = Object.keys(nextErrors).length;
    setBanner(
      failed
        ? { tone: "bad", text: `Saved ${saved} student${saved === 1 ? "" : "s"}. ${failed} not saved: see the red rows.` }
        : { tone: "ok", text: `Saved changes for ${saved} student${saved === 1 ? "" : "s"}.` }
    );
    await onSaved(failed ? `Saved ${saved}, ${failed} not saved.` : `Saved ${saved} student${saved === 1 ? "" : "s"}.`);
    if (!failed) {
      setEditing(false);
      setScope(null);
      setSelected(new Set());
    }
  }

  function startEditing(ids: Set<string> | null) {
    setScope(ids && ids.size ? new Set(ids) : null);
    setEditing(true);
    setBanner(null);
  }

  function stopEditing() {
    setDrafts({});
    setErrors({});
    setDiscardAsk(false);
    setEditing(false);
    setScope(null);
    setBanner(null);
  }

  function openMenu() {
    menuRef.current?.measureInWindow((x, y, w, h) => {
      const vw = Platform.OS === "web" ? globalThis.innerWidth || 0 : 0;
      setMenuAt({ right: Math.max(12, vw - (x + w)), top: y + (h || 40) + 6 });
      setMenuOpen(true);
    });
  }

  function exportCsv(only?: Set<string>) {
    if (Platform.OS !== "web") return;
    const list = only && only.size ? rows.filter((s) => only.has(s.id)) : rows;
    const head = ["Adm. no.", "Name", ...cols.map((c) => c.label)];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [head, ...list.map((s) => [s.admissionNo || "", s.name, ...cols.map((c) => c.read(s))])].map((r) => r.map(esc).join(","));
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `students-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const allSelected = rows.length > 0 && rows.every((s) => selected.has(s.id));
  const width = CHECK_W + ADM_W + NAME_W + cols.reduce((n, c) => n + c.width, 0);
  const fillCol = fillKey ? colByKey.get(fillKey) : undefined;
  const fillCheck = fillCol ? check(fillCol, fillValue) : null;
  // Every editable field, hidden columns too.
  const fillable = allCols.filter((c) => c.editable);
  const fillReady = Boolean(fillCol) && (fillClear || (Boolean(fillValue.trim()) && !fillCheck?.error));
  const fillSummary = (() => {
    if (!fillCol) return "";
    const target = fillClear ? "" : fillCheck?.error ? null : fillCheck?.value ?? "";
    const picked = [...selected].map((id) => byId.get(id)).filter((x): x is Student => Boolean(x));
    if (target === null || (!fillClear && !fillValue.trim())) return `Pick a value. It goes into ${fillCol.label} for all ${picked.length} selected students.`;
    const same = picked.filter((st) => {
      const v = drafts[st.id]?.[fillCol.key] ?? original(st, fillCol.key);
      const norm = check(fillCol, v);
      return (norm.error ? v : norm.value) === target;
    }).length;
    const change = picked.length - same;
    if (fillClear) return `${change} student${change === 1 ? "" : "s"} will have ${fillCol.label} cleared${same ? ` · ${same} already empty` : ""}.`;
    return `${change} student${change === 1 ? "" : "s"} will change${same ? ` · ${same} already have this` : ""}.`;
  })();

  // Edit mode looks like a spreadsheet: tighter rows, grid lines, grey header, read-only cells greyed out.
  const rowH = editing ? 32 : ROW_H;
  const grid = editing ? "border-r border-r-ink-200 border-b-ink-200" : "";

  function headerCell(c: Col, left?: number) {
    const on = sort?.key === c.key;
    return (
      <Pressable
        key={c.key}
        accessibilityRole="button"
        accessibilityLabel={`Sort by ${c.label}`}
        onPress={() => setSort(on ? (sort!.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })}
        style={[{ width: c.width, height: editing ? 30 : 34 }, left !== undefined ? sticky(left) : null]}
        className={`flex-row items-center gap-1 border-b border-ink-200 px-3 ${c.file?.image ? "justify-center" : ""} ${editing ? `border-r border-r-ink-200 ${c.editable || c.file ? "bg-[#F1F5F9]" : "bg-[#F8FAFC]"}` : `bg-white ${c.key === "name" ? "border-r border-r-ink-100" : ""}`}`}
      >
        <Text numberOfLines={1} className={`min-w-0 shrink text-[11px] font-semibold uppercase tracking-wider ${on ? "text-ink-900" : "text-ink-500"}`}>
          {c.label}
        </Text>
        {on ? <Ionicons name={sort!.dir === 1 ? "arrow-up" : "arrow-down"} size={11} color="#0f172a" /> : null}
        {editing && !c.editable && !c.file && c.width >= 100 ? <Ionicons name="lock-closed" size={10} color="#94A3B8" /> : null}
      </Pressable>
    );
  }

  function cell(s: Student, rowIndex: number, c: Col, left?: number) {
    const value = cellValue(s, c.key);
    const id = `${s.id}:${c.key}`;
    const changed = drafts[s.id]?.[c.key] !== undefined;
    const bad = changed ? check(c, value).error : undefined;
    const rowOn = selected.has(s.id);
    const divider = c.key === "name" ? "border-r border-r-ink-100" : "";
    const locked = editing && !c.editable && !(c.file && canEdit);
    const bg = bad ? "bg-red-50" : changed ? "bg-amber-50" : rowOn ? "bg-[#F1F5FF]" : locked ? "bg-[#F8FAFC]" : "bg-white";
    const base = [{ width: c.width, height: rowH }, left !== undefined ? sticky(left) : null];
    if (editing && c.editable) {
      const focused = focusKey === id;
      return (
        <View key={c.key} style={base} className={`justify-center border-b border-b-ink-100 ${divider} ${grid} ${bg}`}>
          <TextInput
            ref={(r) => {
              inputs.current.set(id, r);
            }}
            value={c.kind === "date" && !changed ? dmy(value) : value}
            onFocus={(e) => {
              active.current = { row: rowIndex, col: c.key };
              setFocusKey(id);
              const el = Platform.OS === "web" ? (e.nativeEvent as unknown as { target?: HTMLElement }).target : undefined;
              if (c.kind === "choice" && el?.getBoundingClientRect) {
                const r = el.getBoundingClientRect();
                setMenu({ id, sid: s.id, key: c.key, row: rowIndex, top: r.bottom + 2, left: r.left, width: Math.max(r.width, 180) });
              } else setMenu(null);
            }}
            onBlur={() => {
              setFocusKey((k) => (k === id ? "" : k));
              setMenu((m) => (m?.id === id ? null : m));
            }}
            onChangeText={(t) => setDrafts(setCell(s.id, c.key, t))}
            onSubmitEditing={() => {
              if (c.kind === "choice" && value.trim() && check(c, value).error) {
                const first = choiceMatches(c, value)[0];
                if (first) setDrafts(setCell(s.id, c.key, first));
              }
              focusCell(rowIndex + 1, c.key);
            }}
            onKeyPress={(e) => {
              const key = (e.nativeEvent as { key?: string }).key;
              if (key === "ArrowDown") focusCell(rowIndex + 1, c.key);
              if (key === "ArrowUp") focusCell(rowIndex - 1, c.key);
            }}
            blurOnSubmit={false}
            placeholder={focused ? (c.kind === "date" ? "DD/MM/YYYY" : c.kind === "choice" ? "Pick or type" : "") : ""}
            placeholderTextColor="#CBD5E1"
            accessibilityLabel={`${c.label} for ${s.name}`}
            className={`h-full ${editing ? "px-2" : "px-3"} ${c.kind === "choice" ? "pr-7" : ""} text-[13px] ${bad ? "text-red-700" : "text-ink-900"} ${c.key === "name" ? "font-medium" : ""}`}
            style={Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined}
          />
          {focused ? <View pointerEvents="none" className="absolute inset-0 border-2 border-[#2563EB]" /> : null}
          {c.kind === "choice" && !bad ? (
            <View pointerEvents="none" className="absolute bottom-0 right-2 top-0 justify-center">
              <Ionicons name="chevron-down" size={13} color={focused ? "#2563EB" : "#94A3B8"} />
            </View>
          ) : null}
          {bad && !focused ? (
            <View pointerEvents="none" className="absolute right-1.5 top-1.5">
              <Ionicons name="alert-circle" size={12} color="#DC2626" />
            </View>
          ) : null}
        </View>
      );
    }
    if (c.key === "name") {
      return (
        <Pressable
          key="name"
          accessibilityRole="link"
          accessibilityLabel={`Open ${s.name}`}
          onPress={() => onOpen(s.id)}
          style={base}
          className={`justify-center border-b border-b-ink-100 px-3 ${divider} ${grid} ${bg}`}
        >
          <Text numberOfLines={1} className="text-[13px] font-medium text-ink-900 hover:text-[#1F45C7] hover:underline">
            {s.name}
          </Text>
        </Pressable>
      );
    }
    if (c.file) {
      return (
        <View key={c.key} style={base} className={`justify-center border-b border-b-ink-100 ${c.file.image ? "items-center" : editing ? "px-2" : "px-3"} ${grid} ${bg}`}>
          <FileCell
            path={value}
            size={editing ? 24 : 30}
            image={c.file.image}
            label={c.label}
            student={s.name}
            canUpload={canEdit}
            busy={uploading === `${s.id}:${c.key}`}
            onUpload={() => void uploadInto(s, c)}
            onPreview={(url) => setPreview({ url, image: c.file!.image, title: `${c.label} · ${s.name}`, sid: s.id, key: c.key })}
          />
        </View>
      );
    }
    if (c.key === "due") {
      const tone = s.feeTone === "paid" ? "text-emerald-700" : s.feeTone === "overdue" ? "text-red-700" : "text-amber-700";
      const dot = s.feeTone === "paid" ? "bg-emerald-500" : s.feeTone === "overdue" ? "bg-red-500" : "bg-amber-500";
      return (
        <View key={c.key} style={base} className={`flex-row items-center gap-1.5 border-b border-b-ink-100 px-3 ${grid} ${bg}`}>
          {value ? <View className={`h-1.5 w-1.5 rounded-full ${dot}`} /> : null}
          <Text numberOfLines={1} className={`text-[12px] font-medium ${value ? tone : "text-ink-300"}`}>
            {value || "—"}
          </Text>
        </View>
      );
    }
    const shown = c.kind === "date" ? niceDate(value) : c.kind === "phone" ? prettyMobile(value) : value;
    return (
      <View key={c.key} style={base} className={`justify-center border-b border-b-ink-100 ${editing ? "px-2" : "px-3"} ${grid} ${bg}`}>
        <Text numberOfLines={1} className={`text-[13px] tabular-nums ${shown ? (editing ? "text-ink-400" : "text-ink-700") : "text-ink-300"}`}>
          {shown || "—"}
        </Text>
      </View>
    );
  }

  const header = (
    <View className="flex-row" style={{ width }}>
      <View style={[{ width: CHECK_W, height: editing ? 30 : 34 }, sticky(0)]} className={`items-center justify-center border-b border-ink-200 ${editing ? "border-r border-r-ink-200 bg-[#F1F5F9]" : "bg-white"}`}>
        <Check on={allSelected} label="Select all students in view" onPress={() => setSelected(allSelected ? new Set() : new Set(rows.map((s) => s.id)))} />
      </View>
      {headerCell(admCol, CHECK_W)}
      {headerCell(nameCol, CHECK_W + ADM_W)}
      {cols.map((c) => headerCell(c))}
    </View>
  );

  const menuCol = menu ? colByKey.get(menu.key) : undefined;
  const menuStudent = menu ? byId.get(menu.sid) : undefined;
  const menuValue = menu && menuStudent ? cellValue(menuStudent, menu.key) : "";
  const menuOptions = menuCol ? choiceMatches(menuCol, menuValue) : [];
  const choiceMenu =
    menu && menuCol && editing && Platform.OS === "web" ? (
      <View
        ref={choiceRef}
        {...({ dataSet: { choiceMenu: "1" } } as object)}
        style={{ position: "fixed" as never, top: menu.top, left: menu.left, width: menu.width, maxHeight: 260, zIndex: 1000 }}
        className="overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-xl"
      >
        <ScrollView style={{ maxHeight: 250 }} keyboardShouldPersistTaps="handled">
          {menuOptions.length ? (
            menuOptions.map((o) => {
              const on = check(menuCol, menuValue).value === o;
              return (
                <Pressable
                  key={o}
                  accessibilityRole="menuitem"
                  onPress={() => pickChoice(menu.sid, menu.key, o)}
                  className={`h-9 flex-row items-center justify-between gap-2 px-3 hover:bg-ink-50 ${on ? "bg-[#EEF3FF]" : ""}`}
                >
                  <Text numberOfLines={1} className={`text-[13px] ${on ? "font-semibold text-[#1F45C7]" : "text-ink-800"}`}>{o}</Text>
                  {on ? <Ionicons name="checkmark" size={14} color="#1F45C7" /> : null}
                </Pressable>
              );
            })
          ) : (
            <Text className="px-3 py-2 text-[12px] text-ink-500">No match. Options: {(menuCol.options || []).join(", ")}</Text>
          )}
          {menuValue ? (
            <Pressable onPress={() => pickChoice(menu.sid, menu.key, "")} className="mt-1 h-9 flex-row items-center gap-2 border-t border-ink-100 px-3 hover:bg-ink-50">
              <Ionicons name="close-circle-outline" size={14} color="#64748b" />
              <Text className="text-[13px] text-ink-500">Clear</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
    ) : null;

  return (
    <Card className="min-h-0 flex-1 overflow-hidden border-transparent shadow-sm">
      {choiceMenu}
      <RnModal visible={Boolean(preview)} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View className="flex-1 items-center justify-center p-6">
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setPreview(null)} className="absolute inset-0 bg-black/60" />
          {preview ? (
            <View className="w-full max-w-[520px] overflow-hidden rounded-2xl bg-white">
              <View className="flex-row items-center gap-2 border-b border-ink-100 px-4 py-3">
                <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px] font-semibold text-ink-900">{preview.title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setPreview(null)} className="h-8 w-8 items-center justify-center rounded-lg hover:bg-ink-50">
                  <Ionicons name="close" size={18} color="#64748b" />
                </Pressable>
              </View>
              <View className="items-center bg-ink-50 p-4">
                <Image source={{ uri: preview.url }} resizeMode="contain" style={{ width: "100%", height: 380 }} />
              </View>
              {canEdit ? (
                <View className="flex-row justify-end gap-2 px-4 py-3">
                  <Button
                    variant="ghost"
                    onPress={() => {
                      const st = byId.get(preview.sid);
                      const col = colByKey.get(preview.key);
                      if (st && col) void uploadInto(st, col);
                    }}
                  >
                    {uploading ? "Uploading…" : "Replace photo"}
                  </Button>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </RnModal>
      <View className="z-10 flex-row items-start gap-2 px-3 py-2.5">
        <View className="min-w-0 flex-1">{tools}</View>
        {search ? <View className="w-[300px] shrink-0">{search}</View> : null}
        <Pressable
          ref={menuRef}
          accessibilityRole="button"
          accessibilityLabel="More table actions"
          onPress={openMenu}
          className="h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-ink-200 bg-white hover:bg-ink-50"
        >
          <Ionicons name="ellipsis-horizontal" size={18} color="#334155" />
        </Pressable>
      </View>

      {banner ? (
        <View pointerEvents="box-none" className="absolute left-0 right-0 top-14 z-20 items-center">
          <View className={`max-w-[560px] flex-row items-center gap-2 rounded-lg px-3 py-2 shadow-md ${banner.tone === "ok" ? "bg-emerald-700" : "bg-red-700"}`}>
            <Ionicons name={banner.tone === "ok" ? "checkmark-circle" : "alert-circle"} size={14} color="#fff" />
            <Text className="shrink text-[12px] font-medium text-white">{banner.text}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close message" onPress={() => setBanner(null)} hitSlop={8}>
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          </View>
        </View>
      ) : null}

      {!rows.length ? (
        <View className="items-center gap-2 px-4 py-16">
          <View className="h-12 w-12 items-center justify-center rounded-full bg-ink-50">
            <Ionicons name="search" size={20} color="#94a3b8" />
          </View>
          <Text className="text-[15px] font-semibold text-ink-900">No students here</Text>
          <Text className="text-center text-[13px] text-ink-500">Nothing matches this search or filter. Clear the filter, or pick Current / Past.</Text>
        </View>
      ) : (
        <Scroller width={width}>
          <FlatList<Student>
            style={[{ flex: 1 }, Platform.OS === "web" ? ({ overflowX: "auto" } as unknown as ViewStyle) : null]}
            contentContainerStyle={Platform.OS === "web" ? { width, paddingBottom: selected.size || editing ? 80 : 0 } : undefined}
            data={rows}
            keyExtractor={(s) => s.id}
            extraData={[drafts, selected, editing, hidden, sort, errors, focusKey, rowH]}
            initialNumToRender={40}
            maxToRenderPerBatch={40}
            windowSize={11}
            stickyHeaderIndices={[0]}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={header}
            renderItem={({ item: s, index }) => {
              const err = errors[s.id];
              const on = selected.has(s.id);
              return (
                <View>
                  <View className="flex-row" style={{ width }}>
                    <View
                      style={[{ width: CHECK_W, height: rowH }, sticky(0)]}
                      className={`items-center justify-center border-b border-b-ink-100 ${grid} ${err ? "bg-red-50" : on ? "bg-[#F1F5FF]" : editing ? "bg-[#F8FAFC]" : "bg-white"}`}
                    >
                      <Check
                        on={on}
                        label={`Select ${s.name}`}
                        onPress={() =>
                          setSelected((cur) => {
                            const next = new Set(cur);
                            if (next.has(s.id)) next.delete(s.id);
                            else next.add(s.id);
                            return next;
                          })
                        }
                      />
                    </View>
                    {cell(s, index, admCol, CHECK_W)}
                    {cell(s, index, nameCol, CHECK_W + ADM_W)}
                    {cols.map((c) => cell(s, index, c))}
                  </View>
                  {err ? (
                    <View style={[{ width: Math.min(width, 900) }, sticky(0)]} className="flex-row items-center gap-1.5 bg-red-50 px-4 py-1.5">
                      <Ionicons name="alert-circle" size={12} color="#B91C1C" />
                      <Text className="text-[12px] text-red-800">{`${s.name}: ${err}`}</Text>
                    </View>
                  ) : null}
                </View>
              );
            }}
          />
        </Scroller>
      )}

      {editing ? (
        <View pointerEvents="box-none" className="absolute bottom-4 left-0 right-0 items-center px-3">
          <View className="flex-row flex-wrap items-center gap-1 rounded-xl bg-ink-900 py-1.5 pl-4 pr-1.5 shadow-lg">
            {discardAsk ? (
              <>
                <Text className="mr-2 text-[13px] font-semibold text-white">Throw away {changedCells} change{changedCells === 1 ? "" : "s"}?</Text>
                <BarButton icon="arrow-undo-outline" label="Keep editing" onPress={() => setDiscardAsk(false)} />
                <Pressable accessibilityRole="button" onPress={stopEditing} className="rounded-lg bg-red-600 px-3 py-2">
                  <Text className="text-[13px] font-semibold text-white">Discard</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Ionicons name="create-outline" size={15} color="#FCD34D" />
                <Text className="ml-1.5 mr-1 text-[13px] font-semibold text-white">
                  {scope ? `Editing ${scope.size} student${scope.size === 1 ? "" : "s"}` : rows.length ? `Editing all ${rows.length}` : "No students to edit"}
                </Text>
                <Text numberOfLines={1} className="mr-2 text-[12px] text-slate-300">
                  {changedCells
                    ? `· ${changedCells} change${changedCells === 1 ? "" : "s"}${invalidCount ? ` · ${invalidCount} to fix` : ""}`
                    : rows.length ? "· click a cell, Enter ↓, paste from Excel" : ""}
                </Text>
                {rows.length ? (
                <BarButton
                  icon="color-fill-outline"
                  label="Set a value"
                  onPress={() => {
                    if (!selected.size) setSelected(new Set(rows.map((r) => r.id)));
                    setFillKey(editCols[0]?.key || "dateOfBirth");
                    setFillValue("");
                    setFillClear(false);
                    setFieldPicker(false);
                    setFillOpen(true);
                  }}
                />
                ) : null}
                <BarButton icon="close" label={changedCells ? "Discard" : "Done"} onPress={() => (changedCells ? setDiscardAsk(true) : stopEditing())} />
                <Pressable
                  accessibilityRole="button"
                  disabled={!changedCells || Boolean(saving)}
                  onPress={() => void save()}
                  className={`flex-row items-center gap-1.5 rounded-lg px-3 py-2 ${changedCells ? (invalidCount ? "bg-red-600" : "bg-emerald-600") : "bg-white/15"}`}
                >
                  <Ionicons name="checkmark" size={14} color="#fff" />
                  <Text className="text-[13px] font-semibold text-white">{saving || (changedCells ? `Save ${changedRows}` : "Save")}</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      ) : selected.size ? (
        <View pointerEvents="box-none" className="absolute bottom-4 left-0 right-0 items-center px-3">
          <View className="flex-row flex-wrap items-center gap-1 rounded-xl bg-ink-900 py-1.5 pl-4 pr-1.5 shadow-lg">
            <Text className="mr-2 text-[13px] font-semibold text-white">{selected.size} selected</Text>
            {canEdit ? <BarButton icon="create-outline" label="Edit in sheet" onPress={() => startEditing(selected)} /> : null}
            {canEdit ? (
              <BarButton
                icon="color-fill-outline"
                label="Set a value"
                onPress={() => {
                  setFillKey(editCols[0]?.key || "dateOfBirth");
                  setFillValue("");
                  setFillClear(false);
                  setFieldPicker(false);
                  setFillOpen(true);
                }}
              />
            ) : null}
            {Platform.OS === "web" ? <BarButton icon="download-outline" label="Export" onPress={() => exportCsv(selected)} /> : null}
            <BarButton icon="close" label="Clear" onPress={() => setSelected(new Set())} />
          </View>
        </View>
      ) : null}

      <RnModal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable className="flex-1" onPress={() => setMenuOpen(false)}>
          <Pressable
            onPress={() => {}}
            className="absolute w-60 overflow-hidden rounded-xl border border-ink-200 bg-white p-1.5 shadow-xl"
            style={{ right: menuAt.right, top: menuAt.top }}
          >
            <MenuItem
              icon="eye-outline"
              label="Show / hide columns"
              hint={`${cols.length + 1} of ${allCols.length + 1}`}
              onPress={() => {
                setMenuOpen(false);
                setColsOpen(true);
              }}
            />
            {Platform.OS === "web" ? (
              <MenuItem
                icon="download-outline"
                label="Export to Excel (CSV)"
                hint={`${rows.length}`}
                onPress={() => {
                  setMenuOpen(false);
                  exportCsv();
                }}
              />
            ) : null}
            {canEdit && !editing && rows.length ? (
              <>
                <View className="my-1 h-px bg-ink-100" />
                <MenuItem
                  icon="create-outline"
                  label="Edit all in sheet"
                  hint={`${rows.length}`}
                  onPress={() => {
                    setMenuOpen(false);
                    startEditing(null);
                  }}
                />
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </RnModal>

      <Modal open={colsOpen} title="Columns" onClose={() => setColsOpen(false)}>
        <View className="gap-1">
          <Text className="mb-2 text-[13px] text-ink-600">Pick what to see, and drag ⋮⋮ to change the order. Adm. no. and Student name always stay first. Saved on this computer.</Text>
          {colList.map((c) => {
            const on = !hidden.has(c.key);
            const dragging = drag?.key === c.key;
            return (
              <View
                key={c.key}
                style={{ height: ORDER_ROW_H }}
                className={`flex-row items-center gap-3 rounded-lg px-1 ${dragging ? "bg-[#EEF3FF] shadow-md" : ""}`}
              >
                <View
                  accessibilityRole="adjustable"
                  accessibilityLabel={`Drag to move ${c.label}`}
                  onStartShouldSetResponder={() => true}
                  onResponderTerminationRequest={() => false}
                  onResponderGrant={(e) => {
                    const from = allCols.findIndex((x) => x.key === c.key);
                    setDrag({ key: c.key, from, to: from, startY: e.nativeEvent.pageY });
                  }}
                  onResponderMove={(e) => {
                    const y = e.nativeEvent.pageY;
                    setDrag((d) => (d ? { ...d, to: Math.max(0, Math.min(allCols.length - 1, d.from + Math.round((y - d.startY) / ORDER_ROW_H))) } : d));
                  }}
                  onResponderRelease={() => {
                    if (drag && drag.to !== drag.from) setOrder(colList.map((x) => x.key));
                    setDrag(null);
                  }}
                  onResponderTerminate={() => setDrag(null)}
                  style={Platform.OS === "web" ? ({ cursor: dragging ? "grabbing" : "grab", userSelect: "none", touchAction: "none" } as object) : undefined}
                  className="h-9 w-7 items-center justify-center rounded-md hover:bg-ink-100"
                >
                  <Ionicons name="reorder-two" size={18} color={dragging ? "#1F45C7" : "#94A3B8"} />
                </View>
                <Ionicons name={c.icon} size={16} color="#475569" />
                <Text className="flex-1 text-sm text-ink-900">{c.label}</Text>
                {!c.editable && !c.file ? <Text className="text-[11px] text-ink-400">Read only</Text> : null}
                <Switch
                  on={on}
                  onPress={() =>
                    setHidden((h) => {
                      const next = new Set(h);
                      if (next.has(c.key)) next.delete(c.key);
                      else next.add(c.key);
                      return next;
                    })
                  }
                />
              </View>
            );
          })}
          <View className="mt-3 flex-row justify-between">
            <View className="flex-row gap-1">
              <Button variant="ghost" onPress={() => setHidden(new Set())}>
                Show all
              </Button>
              {order.length ? (
                <Button variant="ghost" onPress={() => setOrder([])}>
                  Reset order
                </Button>
              ) : null}
            </View>
            <Button onPress={() => setColsOpen(false)}>Done</Button>
          </View>
        </View>
      </Modal>

      <RnModal visible={fillOpen} transparent animationType="fade" onRequestClose={() => setFillOpen(false)}>
        <View className="flex-1 items-center justify-center px-4">
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setFillOpen(false)} className="absolute inset-0 bg-black/40" />
          <View className="w-full max-w-[520px] overflow-hidden rounded-2xl bg-white shadow-2xl">
            <View className="flex-row items-start gap-3 px-5 pb-3 pt-5">
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-[#EEF3FF]">
                <Ionicons name="color-fill-outline" size={19} color="#1F45C7" />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[17px] font-semibold text-ink-900">Set a value</Text>
                <Text className="mt-0.5 text-[13px] text-ink-500">
                  For {selected.size} selected student{selected.size === 1 ? "" : "s"}. Nothing is saved until you press Save.
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={() => setFillOpen(false)} className="h-8 w-8 items-center justify-center rounded-lg hover:bg-ink-50">
                <Ionicons name="close" size={18} color="#64748b" />
              </Pressable>
            </View>

            <View className="gap-4 px-5 pb-5 pt-1">
              <View className="gap-1.5">
                <Text className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Field</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Field: ${fillCol?.label || "pick one"}`}
                  onPress={() => setFieldPicker((v) => !v)}
                  className={`h-11 flex-row items-center gap-2.5 rounded-lg border bg-white px-3 ${fieldPicker ? "border-[#1F45C7]" : "border-ink-200"}`}
                >
                  <Ionicons name={fillCol?.icon || "list-outline"} size={16} color="#475569" />
                  <Text className="min-w-0 flex-1 text-[14px] font-medium text-ink-900">{fillCol?.label || "Pick a field"}</Text>
                  {fillCol ? <Text className="text-[12px] text-ink-400">{groupOf(fillCol.key)}</Text> : null}
                  <Ionicons name={fieldPicker ? "chevron-up" : "chevron-down"} size={15} color="#64748b" />
                </Pressable>
                {fieldPicker ? (
                  <ScrollView style={{ maxHeight: 240 }} className="rounded-lg border border-ink-200">
                    {(["Student", "Parent", "Admission form"] as const).map((group) => {
                      const list = fillable.filter((c) => groupOf(c.key) === group);
                      if (!list.length) return null;
                      return (
                        <View key={group} className="py-1">
                          <Text className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{group}</Text>
                          {list.map((c) => {
                            const on = c.key === fillKey;
                            return (
                              <Pressable
                                key={c.key}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: on }}
                                accessibilityLabel={c.label}
                                onPress={() => {
                                  setFillKey(c.key);
                                  setFillValue("");
                                  setFillClear(false);
                                  setFieldPicker(false);
                                }}
                                className={`mx-1 h-9 flex-row items-center gap-2.5 rounded-md px-2.5 hover:bg-ink-50 ${on ? "bg-[#F1F5FF]" : ""}`}
                              >
                                <Ionicons name={c.icon} size={15} color={on ? "#1F45C7" : "#64748b"} />
                                <Text className={`min-w-0 flex-1 text-[13px] ${on ? "font-semibold text-[#1F45C7]" : "text-ink-800"}`}>{c.label}</Text>
                                {on ? <Ionicons name="checkmark" size={15} color="#1F45C7" /> : null}
                              </Pressable>
                            );
                          })}
                        </View>
                      );
                    })}
                  </ScrollView>
                ) : null}
              </View>

              {fillCol && !fieldPicker ? (
                <View className="gap-1.5">
                  <Text className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">New value</Text>
                  {fillCol.kind === "choice" ? (
                    <View className={`flex-row flex-wrap gap-1.5 ${fillClear ? "opacity-40" : ""}`}>
                      {(fillCol.options || []).map((o) => {
                        const on = !fillClear && fillValue === o;
                        return (
                          <Pressable
                            key={o}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: on }}
                            disabled={fillClear}
                            onPress={() => setFillValue(o)}
                            className={`h-9 flex-row items-center gap-1.5 rounded-lg border px-3 ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                          >
                            {on ? <Ionicons name="checkmark" size={14} color="#1F45C7" /> : null}
                            <Text className={`text-[13px] ${on ? "font-semibold text-[#1F45C7]" : "text-ink-800"}`}>{o}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : (
                    <View className={`h-11 flex-row items-center gap-2 rounded-lg border bg-white px-3 ${fillValue && fillCheck?.error && !fillClear ? "border-red-400" : "border-ink-200"} ${fillClear ? "opacity-40" : ""}`}>
                      <Ionicons name={fillCol.icon} size={16} color="#94a3b8" />
                      <TextInput
                        value={fillClear ? "" : fillValue}
                        editable={!fillClear}
                        autoFocus
                        onChangeText={setFillValue}
                        placeholder={
                          fillCol.kind === "date" ? "DD/MM/YYYY, e.g. 24/08/2015" : fillCol.kind === "phone" ? "10-digit mobile" : fillCol.kind === "pin" ? "6-digit PIN code" : fillCol.kind === "email" ? "name@example.com" : `Type ${fillCol.label.toLowerCase()}`
                        }
                        placeholderTextColor="#A3AEC2"
                        className="h-full min-w-0 flex-1 text-[14px] text-ink-900"
                        style={Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined}
                      />
                    </View>
                  )}
                  {fillValue && fillCheck?.error && !fillClear ? <Text className="text-[12px] text-red-700">{fillCheck.error}</Text> : null}
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: fillClear }} onPress={() => setFillClear((v) => !v)} className="mt-1 flex-row items-center gap-2 self-start py-1">
                    <View className={`h-4 w-4 items-center justify-center rounded-[4px] border ${fillClear ? "border-red-600 bg-red-600" : "border-ink-300 bg-white"}`}>
                      {fillClear ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
                    </View>
                    <Text className="text-[13px] text-ink-700">Clear this field instead</Text>
                  </Pressable>
                </View>
              ) : null}

              {fillCol && !fieldPicker ? (
                <View className="flex-row items-center gap-2 rounded-lg bg-ink-50 px-3 py-2.5">
                  <Ionicons name="information-circle-outline" size={16} color="#64748b" />
                  <Text className="min-w-0 flex-1 text-[12px] text-ink-600">{fillSummary}</Text>
                </View>
              ) : null}
            </View>

            <View className="flex-row items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/50 px-5 py-3">
              <Pressable accessibilityRole="button" onPress={() => setFillOpen(false)} className="h-10 justify-center rounded-lg px-4 hover:bg-ink-100">
                <Text className="text-[13px] font-semibold text-ink-700">Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!fillReady}
                onPress={() => {
                  const value = fillClear ? "" : fillValue.trim();
                  let next = drafts;
                  for (const id of selected) next = setCell(id, fillKey, value, next);
                  setDrafts(next);
                  if (!editing) startEditing(selected);
                  setFillOpen(false);
                  setBanner({
                    tone: "ok",
                    text: `${fillClear ? "Cleared" : "Set"} ${fillCol?.label || "field"} for ${selected.size} student${selected.size === 1 ? "" : "s"}. Press Save to keep it.`,
                  });
                }}
                className={`h-10 flex-row items-center gap-1.5 rounded-lg px-4 ${fillReady ? (fillClear ? "bg-red-600" : "bg-[#1F45C7]") : "bg-ink-200"}`}
              >
                <Text className="text-[13px] font-semibold text-white">
                  {fillClear ? `Clear for ${selected.size}` : `Set for ${selected.size} student${selected.size === 1 ? "" : "s"}`}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </RnModal>
    </Card>
  );
}

const admCol: Col = {
  key: "adm",
  label: "Adm. no.",
  width: ADM_W,
  icon: "id-card-outline",
  kind: "text",
  editable: false,
  read: (s) => s.admissionNo || "",
};

const nameCol: Col = {
  key: "name",
  label: "Student",
  width: NAME_W,
  icon: "person-outline",
  kind: "text",
  editable: true,
  read: (s) => s.name,
};

/** Web: the list scrolls both ways itself, so the header and the first columns can stick. Native: a sideways wrapper. */
function Scroller({ width, children }: { width: number; children: ReactNode }) {
  if (Platform.OS === "web") return <View style={{ flex: 1, minHeight: 0 }}>{children}</View>;
  return (
    <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
      <View style={{ width, flex: 1 }}>{children}</View>
    </ScrollView>
  );
}

type Icon = keyof typeof Ionicons.glyphMap;

function groupOf(key: string) {
  if (key.startsWith("custom:")) return "Admission form";
  if (key === "dateOfBirth" || key === "name") return "Student";
  return "Parent";
}

function MenuItem({ icon, label, hint, onPress }: { icon: Icon; label: string; hint?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="menuitem" onPress={onPress} className="h-9 flex-row items-center gap-2.5 rounded-md px-2.5 hover:bg-ink-50">
      <Ionicons name={icon} size={15} color="#475569" />
      <Text className="min-w-0 flex-1 text-[13px] text-ink-900">{label}</Text>
      {hint ? <Text className="text-[12px] tabular-nums text-ink-400">{hint}</Text> : null}
    </Pressable>
  );
}

function GhostButton({ icon, label, onPress }: { icon: Icon; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="flex-row items-center gap-1.5 rounded-md px-2.5 py-2 hover:bg-ink-50">
      <Ionicons name={icon} size={15} color="#475569" />
      <Text className="text-[13px] font-medium text-ink-700">{label}</Text>
    </Pressable>
  );
}

function BarButton({ icon, label, onPress }: { icon: Icon; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="flex-row items-center gap-1.5 rounded-lg px-3 py-2 hover:bg-white/10">
      <Ionicons name={icon} size={14} color="#E2E8F0" />
      <Text className="text-[13px] font-medium text-slate-100">{label}</Text>
    </Pressable>
  );
}

function Check({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      hitSlop={10}
      onPress={onPress}
      className={`h-[15px] w-[15px] items-center justify-center rounded-[4px] border ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-300 bg-white"}`}
    >
      {on ? <Ionicons name="checkmark" size={11} color="#fff" /> : null}
    </Pressable>
  );
}

/** A photo / document cell: thumbnail or "View" when uploaded, "Upload" when not. */
function FileCell({
  path,
  size,
  image,
  label,
  student,
  canUpload,
  busy,
  onUpload,
  onPreview,
}: {
  path: string;
  size: number;
  image: boolean;
  label: string;
  student: string;
  canUpload: boolean;
  busy: boolean;
  onUpload: () => void;
  onPreview: (url: string) => void;
}) {
  const url = useAssetUrl(path || null);
  if (busy) return <ActivityIndicator size="small" color="#1F45C7" />;
  // Photo: the same square slot whether it is filled or empty, so the column lines up.
  if (image && !path) {
    if (!canUpload) return <Text className="text-[13px] text-ink-300">—</Text>;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Upload ${label} for ${student}`}
        onPress={onUpload}
        style={{ width: size, height: size }}
        className="items-center justify-center rounded-lg border border-dashed border-ink-300 bg-ink-50 hover:border-[#1F45C7] hover:bg-[#EEF3FF]"
      >
        <Ionicons name="camera-outline" size={Math.round(size * 0.5)} color="#94A3B8" />
      </Pressable>
    );
  }
  if (!path) {
    if (!canUpload) return <Text className="text-[13px] text-ink-300">—</Text>;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Upload ${label} for ${student}`}
        onPress={onUpload}
        className="h-7 flex-row items-center gap-1 self-start rounded-md border border-dashed border-ink-300 px-2 hover:border-[#1F45C7] hover:bg-[#EEF3FF]"
      >
        <Ionicons name={image ? "camera-outline" : "cloud-upload-outline"} size={13} color="#64748b" />
        <Text className="text-[12px] text-ink-500">{image ? "Add" : "Upload"}</Text>
      </Pressable>
    );
  }
  if (image) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${label} of ${student}`}
        disabled={!url}
        onPress={() => onPreview(url)}
        style={{ width: size, height: size }}
        className="overflow-hidden rounded-lg border border-ink-200 bg-ink-100 hover:border-[#1F45C7]"
      >
        {url ? <Image source={{ uri: url }} resizeMode="cover" style={{ width: "100%", height: "100%" }} /> : null}
      </Pressable>
    );
  }
  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`View ${label} of ${student}`}
        disabled={!url}
        onPress={() => {
          if (Platform.OS === "web" && typeof window !== "undefined") window.open(url, "_blank", "noopener");
        }}
        className="h-7 flex-row items-center gap-1 rounded-md bg-emerald-50 px-2 hover:bg-emerald-100"
      >
        <Ionicons name="document-text-outline" size={13} color="#047857" />
        <Text className="text-[12px] font-medium text-emerald-800">{url ? "View" : "…"}</Text>
      </Pressable>
      {canUpload ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Replace ${label} for ${student}`} onPress={onUpload} hitSlop={6} className="opacity-60 hover:opacity-100">
          <Ionicons name="swap-horizontal" size={14} color="#64748b" />
        </Pressable>
      ) : null}
    </View>
  );
}
