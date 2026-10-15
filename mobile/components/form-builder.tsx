import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { Modal as RnModal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Dropdown } from "./form";
import { Badge, Button, Field, Input, Modal, Switch } from "./ui";
import type { AdmissionFormField } from "../lib/record";

/**
 * One editor for all three school forms (student admission, website enquiry, staff onboarding).
 * Form contents come from the school's saved form or the Anekio default in PlatformConfig — none live in code.
 */

const FIELD_TYPE_OPTIONS = [
  { id: "text", label: "Short text" },
  { id: "textarea", label: "Long text" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "number", label: "Number" },
  { id: "date", label: "Date" },
  { id: "month", label: "Month and year" },
  { id: "select", label: "Dropdown" },
  { id: "radio", label: "Single choice" },
  { id: "multi", label: "Multiple choice" },
  { id: "checkbox", label: "Checkbox" },
  { id: "file", label: "File upload" },
] as const;

const SCHOOL_CLASSES_FIELD_TYPE = "schoolClasses";

const FILE_TYPE_OPTIONS = [
  { id: "image_pdf", label: "Image or PDF" },
  { id: "pdf", label: "PDF only" },
  { id: "image", label: "Image only" },
] as const;

function fieldId(label: string) {
  return `custom_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field"}_${Date.now()}`;
}

function newField(overrides: Partial<AdmissionFormField> = {}): AdmissionFormField {
  const type = overrides.type || "text";
  return {
    id: overrides.id || fieldId(overrides.label || "field"),
    label: overrides.label || "New field",
    type,
    required: Boolean(overrides.required),
    visible: overrides.visible ?? true,
    options: overrides.options ? [...overrides.options] : [],
    builtin: Boolean(overrides.builtin),
    helpText: overrides.helpText || "",
    fileType: type === "file" ? overrides.fileType || "image_pdf" : undefined,
    maxFileSizeMb: type === "file" ? overrides.maxFileSizeMb || 5 : undefined,
  };
}

export function fieldError(field: AdmissionFormField) {
  if (!field.visible) return "";
  if (!field.label.trim()) return "Field label is required.";
  if (["select", "radio", "multi"].includes(field.type) && !field.options.length) return "Add at least one option.";
  if (field.type === "file" && !field.fileType) return "Choose accepted file types.";
  return "";
}

function fileTypeSummary(field: AdmissionFormField) {
  if (field.fileType === "image") return "JPG, PNG";
  if (field.fileType === "pdf") return "PDF";
  return "JPG, PNG, PDF";
}

function sameOptions(left: string[], right: string[]) {
  return left.length === right.length && left.every((option, index) => option === right[index]);
}

function typeValue(field: AdmissionFormField, classOptions: string[]) {
  if (field.id === "classWanted" && field.type === "select" && classOptions.length && sameOptions(field.options, classOptions)) {
    return SCHOOL_CLASSES_FIELD_TYPE;
  }
  return field.type;
}

function typeOptions(field: AdmissionFormField, classOptions: string[]) {
  if (field.id !== "classWanted" || !classOptions.length) return [...FIELD_TYPE_OPTIONS];
  return [...FIELD_TYPE_OPTIONS.slice(0, 7), { id: SCHOOL_CLASSES_FIELD_TYPE, label: "School classes" }, ...FIELD_TYPE_OPTIONS.slice(7)];
}

export function cloneFields(fields: AdmissionFormField[]) {
  return fields.map((field) => ({ ...field, options: [...field.options] }));
}

function sameField(a: AdmissionFormField, b: AdmissionFormField) {
  return a.id === b.id || a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
}

export function FormBuilderModal({
  open,
  title,
  intro,
  audience,
  fields,
  suggestions = [],
  lockedIds = [],
  classOptions = [],
  canEdit = true,
  onChange,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  intro: string;
  /** Who fills the form, e.g. "parents", "the office", "staff". */
  audience: string;
  fields: AdmissionFormField[];
  /** Fields from the Anekio default form that this school has not added yet. */
  suggestions?: AdmissionFormField[];
  lockedIds?: readonly string[];
  classOptions?: string[];
  canEdit?: boolean;
  onChange: (fields: AdmissionFormField[]) => void;
  onSave: () => Promise<void>;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Two-tap delete on the row: first tap arms it, second tap within a few seconds removes the field.
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const editing = fields.find((field) => field.id === editingId);
  const available = suggestions.filter((suggestion) => !fields.some((field) => sameField(field, suggestion)));
  const locked = (id: string) => lockedIds.includes(id);
  const shown = fields.filter((field) => field.visible).length;
  const required = fields.filter((field) => field.required).length;

  function patchField(id: string, change: Partial<AdmissionFormField>) {
    onChange(fields.map((field) => (field.id === id ? { ...field, ...change } : field)));
  }

  function addField(overrides: Partial<AdmissionFormField> = {}) {
    const next = newField(overrides);
    onChange([...fields, next]);
    setEditingId(next.id);
  }

  function duplicate(field: AdmissionFormField) {
    const copy = newField({ ...field, id: undefined, builtin: false, label: `${field.label} copy` });
    onChange([...fields, copy]);
    setEditingId(copy.id);
  }

  function move(id: string, direction: -1 | 1) {
    const index = fields.findIndex((field) => field.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= fields.length) return;
    const next = [...fields];
    const [field] = next.splice(index, 1);
    next.splice(nextIndex, 0, field);
    onChange(next);
  }

  function addPicked() {
    const rows = available.filter((field) => picked.includes(field.id)).map((field) => newField({ ...field }));
    if (rows.length) onChange([...fields, ...rows]);
    setPicked([]);
  }

  function removeField(field: AdmissionFormField) {
    if (field.builtin) return;
    if (confirmDeleteId !== field.id) {
      setConfirmDeleteId(field.id);
      setTimeout(() => setConfirmDeleteId((current) => (current === field.id ? "" : current)), 3000);
      return;
    }
    setConfirmDeleteId("");
    onChange(fields.filter((row) => row.id !== field.id));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  }

  const phoneMain = (
    <RnModal visible={open && !editing} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
        <View className="h-14 flex-row items-center border-b border-ink-100 px-2">
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="h-11 w-11 items-center justify-center">
            <Ionicons name="close" size={24} color="#0f2744" />
          </Pressable>
          <View className="min-w-0 flex-1 items-center">
            <Text className="text-[16px] font-semibold text-ink-900" numberOfLines={1}>{title}</Text>
            <Text className="text-[11px] text-ink-600">{shown} shown · {required} required</Text>
          </View>
          <View className="w-11" />
        </View>
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 18 }}>
          {([
            ["Shown to " + audience, fields.filter((field) => field.visible)],
            ["Hidden", fields.filter((field) => !field.visible)],
          ] as const).map(([heading, rows]) =>
            rows.length ? (
              <View key={heading}>
                <Text className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-500">{heading}</Text>
                <View className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
                  {rows.map((field, index) => {
                    const isLocked = locked(field.id);
                    const typeLabel = FIELD_TYPE_OPTIONS.find((option) => option.id === field.type)?.label || field.type;
                    return (
                      <Pressable
                        key={field.id}
                        disabled={!canEdit}
                        onPress={() => setEditingId(field.id)}
                        className={`flex-row items-center gap-3 px-4 py-3 active:bg-ink-50 ${index ? "border-t border-ink-100" : ""}`}
                      >
                        <View className="min-w-0 flex-1">
                          <Text className={`text-[15px] font-medium ${field.visible ? "text-ink-900" : "text-ink-500"}`} numberOfLines={1}>
                            {field.label || "Untitled field"}
                          </Text>
                          <Text className="mt-0.5 text-xs text-ink-500" numberOfLines={1}>
                            {field.visible ? (field.required ? "Required" : "Optional") : typeLabel}
                            {field.visible ? ` · ${typeLabel}` : ""}
                            {fieldError(field) ? " · needs fixing" : ""}
                          </Text>
                        </View>
                        {isLocked ? (
                          <Ionicons name="lock-closed" size={15} color="#94A3B8" />
                        ) : canEdit ? (
                          <Switch on={field.visible} onPress={() => patchField(field.id, { visible: !field.visible, required: field.visible ? false : field.required })} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null
          )}
          {!fields.length ? <Text className="text-center text-sm text-ink-600">No fields yet. Add one below.</Text> : null}
          {canEdit ? (
            <View className="gap-2">
              <Pressable onPress={() => addField()} className="h-11 flex-row items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#1F45C7]/40 bg-[#EEF3FF]/50">
                <Ionicons name="add" size={18} color="#1F45C7" />
                <Text className="text-sm font-semibold text-[#1F45C7]">Add field</Text>
              </Pressable>
              {available.length ? (
                <View className="flex-row flex-wrap gap-1.5">
                  {available.map((field) => (
                    <Pressable
                      key={field.id}
                      onPress={() => onChange([...fields, newField({ ...field })])}
                      className="h-8 justify-center rounded-full bg-ink-50 px-3 active:bg-ink-100"
                    >
                      <Text className="text-xs font-medium text-ink-700">+ {field.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
        {canEdit ? (
          <View className="gap-1.5 border-t border-ink-100 px-4 pb-3 pt-3">
            <Pressable
              disabled={saving || fields.some((field) => Boolean(fieldError(field)))}
              onPress={() => void save()}
              className={`h-12 items-center justify-center rounded-2xl bg-[#1F45C7] ${saving || fields.some((field) => Boolean(fieldError(field))) ? "opacity-50" : ""}`}
            >
              <Text className="text-[15px] font-semibold text-white">{saving ? "Saving…" : "Save form"}</Text>
            </Pressable>
            <Text className="text-center text-[11px] text-ink-500" numberOfLines={2}>{intro}</Text>
          </View>
        ) : null}
      </SafeAreaView>
    </RnModal>
  );

  const { width } = useWindowDimensions();
  const phone = width < 768;
  return (
    <>
      {phone ? phoneMain : null}
      <Modal open={!phone && open && !editing} title={title} onClose={onClose} wide>
        <View className="gap-4">
          <View className="flex-row flex-wrap items-center justify-between gap-2 rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2.5">
            <Text className="min-w-0 flex-1 text-xs leading-5 text-ink-800">{intro}</Text>
            <Text className="text-[11px] font-semibold text-blue-800">{shown} shown · {required} required</Text>
          </View>

          {available.length && canEdit ? (
            <View className="rounded-md border border-ink-200 bg-white p-3">
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-semibold text-ink-900">Suggested fields</Text>
                  <Text className="mt-0.5 text-[11px] leading-4 text-ink-700">From Anekio's default form. Pick any to add.</Text>
                </View>
                <Button variant="ghost" disabled={!picked.length} onPress={addPicked}>
                  {picked.length ? `Add ${picked.length}` : "Add"}
                </Button>
              </View>
              <View className="mt-3 flex-row flex-wrap gap-2">
                {available.map((field) => {
                  const on = picked.includes(field.id);
                  return (
                    <Pressable
                      key={field.id}
                      onPress={() => setPicked((rows) => (on ? rows.filter((row) => row !== field.id) : [...rows, field.id]))}
                      className={`flex-row items-center gap-1 rounded-md border px-2.5 py-1.5 ${on ? "border-blue-300 bg-blue-50" : "border-ink-200 bg-white"}`}
                    >
                      <Ionicons name={on ? "checkbox-outline" : field.type === "file" ? "document-attach-outline" : "add-circle-outline"} size={15} color={on ? "#1d4ed8" : "#3d4f66"} />
                      <Text className={`text-[11px] font-medium ${on ? "text-blue-900" : "text-ink-800"}`}>{field.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View className="overflow-hidden rounded-md border border-ink-200 bg-white">
            <View className="flex-row flex-wrap items-center justify-between gap-2 border-b border-ink-100 bg-ink-50 px-3 py-2.5">
              <View>
                <Text className="text-sm font-semibold text-ink-900">Form fields</Text>
                <Text className="mt-0.5 text-[11px] text-ink-700">{shown} shown to {audience}</Text>
              </View>
              {canEdit ? (
                <Button variant="ghost" onPress={() => addField()} className="py-2">
                  Add field
                </Button>
              ) : null}
            </View>
            {!fields.length ? (
              <View className="items-center p-6">
                <Ionicons name="document-text-outline" size={26} color="#64748b" />
                <Text className="mt-2 text-sm font-semibold text-ink-900">No fields yet</Text>
                <Text className="mt-1 text-center text-xs text-ink-700">Add fields, or pick from the suggestions above.</Text>
              </View>
            ) : null}
            {fields.map((field, index) => {
              const isLocked = locked(field.id);
              return (
                <View key={field.id} className="flex-row items-center gap-3 border-b border-ink-100 px-3 py-2.5 last:border-b-0">
                  <View className="flex-row gap-1">
                    <Pressable
                      accessibilityLabel={`Move ${field.label} up`}
                      disabled={index === 0 || !canEdit}
                      onPress={() => move(field.id, -1)}
                      className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white"
                    >
                      <Ionicons name="chevron-up" size={16} color={index === 0 ? "#94a3b8" : "#3d4f66"} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Move ${field.label} down`}
                      disabled={index === fields.length - 1 || !canEdit}
                      onPress={() => move(field.id, 1)}
                      className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white"
                    >
                      <Ionicons name="chevron-down" size={16} color={index === fields.length - 1 ? "#94a3b8" : "#3d4f66"} />
                    </Pressable>
                  </View>
                  <Pressable disabled={!canEdit} onPress={() => setEditingId(field.id)} className="min-w-0 flex-1">
                    <View className="flex-row flex-wrap items-center gap-2">
                      <Text className="text-sm font-semibold text-ink-900">{field.label || "Untitled field"}</Text>
                      <Badge tone={field.visible ? "clay" : "ink"}>{isLocked ? "Always shown" : field.visible ? "Shown" : "Hidden"}</Badge>
                      {field.required ? <Badge tone="warn">Required</Badge> : null}
                      {fieldError(field) ? <Badge tone="danger">Fix</Badge> : null}
                    </View>
                    <Text className="mt-1 text-[11px] text-ink-700" numberOfLines={1}>
                      {FIELD_TYPE_OPTIONS.find((option) => option.id === field.type)?.label || field.type}
                      {field.type === "file" ? ` · ${fileTypeSummary(field)} · ${field.maxFileSizeMb || 5} MB` : ""}
                      {field.helpText ? ` · ${field.helpText}` : ""}
                    </Text>
                  </Pressable>
                  {canEdit ? (
                    <View className="flex-row items-center gap-2">
                      {isLocked ? (
                        <View accessibilityLabel={`${field.label} is always shown and required`} className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-ink-50">
                          <Ionicons name="lock-closed-outline" size={15} color="#64748b" />
                        </View>
                      ) : (
                        <Pressable
                          accessibilityLabel={`${field.visible ? "Hide" : "Show"} ${field.label}`}
                          onPress={() => patchField(field.id, { visible: !field.visible, required: field.visible ? false : field.required })}
                          className={`h-8 w-8 items-center justify-center rounded-md border ${field.visible ? "border-blue-200 bg-blue-50" : "border-ink-200 bg-white"}`}
                        >
                          <Ionicons name={field.visible ? "eye-outline" : "eye-off-outline"} size={16} color={field.visible ? "#1d4ed8" : "#64748b"} />
                        </Pressable>
                      )}
                      <Pressable
                        accessibilityLabel={`Edit ${field.label}`}
                        onPress={() => setEditingId(field.id)}
                        className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white"
                      >
                        <Ionicons name="create-outline" size={16} color="#3d4f66" />
                      </Pressable>
                      {field.builtin ? (
                        <Pressable
                          disabled
                          accessibilityRole="button"
                          accessibilityState={{ disabled: true }}
                          accessibilityLabel={`${field.label} can't be deleted`}
                          accessibilityHint={isLocked ? "Every form needs this field." : "Default field. Hide it instead of deleting."}
                          // @ts-expect-error web-only tooltip
                          title={isLocked ? "Every form needs this field" : "Default field. Hide it instead"}
                          className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-ink-50 opacity-60"
                        >
                          <Ionicons name="trash-outline" size={16} color="#94a3b8" />
                        </Pressable>
                      ) : confirmDeleteId === field.id ? (
                        <Pressable
                          accessibilityLabel={`Confirm delete ${field.label}`}
                          onPress={() => removeField(field)}
                          className="h-8 flex-row items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2"
                        >
                          <Ionicons name="trash" size={14} color="#b91c1c" />
                          <Text className="text-[11px] font-semibold text-red-700">Delete?</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          accessibilityLabel={`Delete ${field.label}`}
                          onPress={() => removeField(field)}
                          className="h-8 w-8 items-center justify-center rounded-md border border-ink-200 bg-white"
                        >
                          <Ionicons name="trash-outline" size={16} color="#b91c1c" />
                        </Pressable>
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          {canEdit ? (
            <View className="flex-row items-center justify-end gap-2">
              <Button variant="ghost" onPress={onClose}>Cancel</Button>
              <Button disabled={saving || fields.some((field) => Boolean(fieldError(field)))} onPress={() => void save()}>
                {saving ? "Saving…" : "Save form"}
              </Button>
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal open={open && Boolean(editing)} title="Edit field" onClose={() => setEditingId("")}>
        {editing ? (
          <View className="gap-3">
            <Field label="Field label">
              <Input value={editing.label} onChangeText={(label) => patchField(editing.id, { label })} />
            </Field>
            <Dropdown
              label="Input type"
              value={typeValue(editing, classOptions)}
              options={typeOptions(editing, classOptions)}
              onChange={(type) => {
                const useClasses = type === SCHOOL_CLASSES_FIELD_TYPE;
                const nextType = (useClasses ? "select" : type) as AdmissionFormField["type"];
                const choice = ["select", "radio", "multi"].includes(nextType);
                patchField(editing.id, {
                  type: nextType,
                  options: choice ? (useClasses ? classOptions : editing.options) : [],
                  fileType: nextType === "file" ? editing.fileType || "image_pdf" : undefined,
                  maxFileSizeMb: nextType === "file" ? editing.maxFileSizeMb || 5 : undefined,
                });
              }}
            />
            {["select", "radio", "multi"].includes(editing.type) ? (
              <Field
                label="Options"
                hint={typeValue(editing, classOptions) === SCHOOL_CLASSES_FIELD_TYPE ? "Linked from School setup classes. Edit lines here to override." : "One option per line"}
              >
                <Input
                  multiline
                  value={editing.options.join("\n")}
                  onChangeText={(value) => patchField(editing.id, { options: value.split(/\n|,/).map((option) => option.trim()).filter(Boolean) })}
                />
              </Field>
            ) : null}
            {editing.type === "file" ? (
              <View className="flex-row flex-wrap gap-3">
                <View className="min-w-[180px] flex-1">
                  <Dropdown
                    label="Accepted files"
                    value={editing.fileType || "image_pdf"}
                    options={[...FILE_TYPE_OPTIONS]}
                    onChange={(fileType) => patchField(editing.id, { fileType: fileType as AdmissionFormField["fileType"] })}
                  />
                </View>
                <View className="min-w-[150px] flex-1">
                  <Field label="Max size (MB)">
                    <Input
                      keyboardType="number-pad"
                      value={String(editing.maxFileSizeMb || 5)}
                      onChangeText={(value) => patchField(editing.id, { maxFileSizeMb: Math.min(12, Math.max(1, Number(value.replace(/[^0-9]/g, "")) || 1)) })}
                    />
                  </Field>
                </View>
              </View>
            ) : null}
            <Field label="Help text">
              <Input
                value={editing.helpText || ""}
                placeholder={editing.type === "file" ? `Accepted: ${fileTypeSummary(editing)} · up to ${editing.maxFileSizeMb || 5} MB` : `Optional guidance for ${audience}`}
                onChangeText={(helpText) => patchField(editing.id, { helpText })}
              />
            </Field>
            <View className="flex-row flex-wrap items-center gap-5">
              <View className="flex-row items-center gap-2">
                <Switch
                  on={editing.visible}
                  disabled={locked(editing.id)}
                  onPress={() => patchField(editing.id, { visible: !editing.visible, required: editing.visible ? false : editing.required })}
                />
                <Text className="text-xs font-medium text-ink-800">Show field</Text>
              </View>
              <View className="flex-row items-center gap-2">
                <Switch
                  on={editing.required}
                  disabled={!editing.visible || locked(editing.id)}
                  onPress={() => patchField(editing.id, { required: !editing.required })}
                />
                <Text className="text-xs font-medium text-ink-800">Required</Text>
              </View>
              {locked(editing.id) ? <Text className="text-[11px] text-ink-600">Every form needs this field.</Text> : null}
            </View>
            {fieldError(editing) ? <Text className="text-xs font-medium text-red-700">{fieldError(editing)}</Text> : null}
            <View className="mt-2 flex-row flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3">
              <View className="flex-row flex-wrap gap-2">
                <Pressable
                  accessibilityLabel="Move up"
                  disabled={fields[0]?.id === editing.id}
                  onPress={() => move(editing.id, -1)}
                  className={`h-10 w-10 items-center justify-center rounded-md border border-ink-200 ${fields[0]?.id === editing.id ? "opacity-40" : ""}`}
                >
                  <Ionicons name="arrow-up" size={16} color="#3d4f66" />
                </Pressable>
                <Pressable
                  accessibilityLabel="Move down"
                  disabled={fields[fields.length - 1]?.id === editing.id}
                  onPress={() => move(editing.id, 1)}
                  className={`h-10 w-10 items-center justify-center rounded-md border border-ink-200 ${fields[fields.length - 1]?.id === editing.id ? "opacity-40" : ""}`}
                >
                  <Ionicons name="arrow-down" size={16} color="#3d4f66" />
                </Pressable>
                <Button variant="ghost" onPress={() => duplicate(editing)}>Duplicate</Button>
                {!editing.builtin ? (
                  <Button
                    variant="ghost"
                    onPress={() => {
                      onChange(fields.filter((row) => row.id !== editing.id));
                      setEditingId("");
                    }}
                  >
                    Delete
                  </Button>
                ) : null}
              </View>
              <Button onPress={() => setEditingId("")}>Done</Button>
            </View>
          </View>
        ) : null}
      </Modal>
    </>
  );
}
