import { useState, type ReactNode } from "react";
import { useRouter } from "expo-router";
import { Image, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, Chip, DateField, Field, Input, Select } from "./form";
import { MonthField } from "./date-field";
import { Segmented, Switch } from "./ui";
import type { AdmissionFormField } from "../lib/record";
import { pickFile, type PickedFile } from "../lib/upload";
import { useAssetUrl } from "../lib/assets";

export type StudentFeeAddOnPayload = {
  id?: string;
  label: string;
  kind: string;
  amount: string;
  cadence?: string;
  startsPeriod?: string;
  endsPeriod?: string;
};

function rupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export type StudentAdmitPayload = {
  name: string;
  dateOfBirth: string;
  billingStartPeriod: string;
  classId: string;
  parentId: string;
  parentName: string;
  parentPhone: string;
  tags: string[];
  feeAddOns: StudentFeeAddOnPayload[];
  collectAdmissionFee: boolean;
  paymentMethod: string;
  paymentReference: string;
  parentEmail: string;
  customValues: Record<string, string>;
};

/** Files picked for the school's custom admission-form file fields, uploaded after the student is created. */
export type StudentAdmitFiles = Record<string, PickedFile>;

/** Pre-filled values, e.g. when admitting an enquiry. `enquiryFiles` are files the parent already uploaded (field id → path). */
export type StudentAdmitInitial = Partial<
  Pick<StudentAdmitPayload, "name" | "classId" | "billingStartPeriod" | "parentId" | "parentName" | "parentPhone" | "parentEmail" | "customValues">
> & { enquiryFiles?: Record<string, string> };

export function fileAccept(field: AdmissionFormField) {
  if (field.fileType === "image") return "image/png,image/jpeg,image/webp";
  if (field.fileType === "pdf") return "application/pdf,.pdf";
  return "image/png,image/jpeg,image/webp,application/pdf,.pdf";
}

export function AdmissionCustomField({
  field,
  value,
  file,
  onChange,
  onFile,
}: {
  field: AdmissionFormField;
  value: string;
  file?: PickedFile;
  onChange: (value: string) => void;
  onFile: (file: PickedFile | null) => void;
}) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  const help = field.helpText ? <Text className="text-[11px] leading-4 text-ink-600">{field.helpText}</Text> : null;
  if (field.type === "select" || field.type === "radio") {
    return (
      <View className="gap-1">
        <Select label={label} value={value} options={field.options.map((option) => ({ id: option, label: option }))} onChange={onChange} />
        {help}
      </View>
    );
  }
  if (field.type === "multi") {
    const picked = value.split(",").map((row) => row.trim()).filter(Boolean);
    return (
      <Field label={label}>
        <View className="flex-row flex-wrap gap-2">
          {field.options.map((option) => {
            const on = picked.includes(option);
            return (
              <Chip
                key={option}
                label={option}
                active={on}
                onPress={() => onChange((on ? picked.filter((row) => row !== option) : [...picked, option]).join(", "))}
              />
            );
          })}
        </View>
        {help}
      </Field>
    );
  }
  if (field.type === "checkbox") {
    return (
      <View className="flex-row items-center justify-between gap-3 py-1">
        <View className="min-w-0 flex-1">
          <Text className="text-xs font-medium text-ink-700">{label}</Text>
          {help}
        </View>
        <Switch on={value === "Yes"} onPress={() => onChange(value === "Yes" ? "" : "Yes")} />
      </View>
    );
  }
  if (field.type === "date") {
    return (
      <Field label={label}>
        <DateField value={value} onChange={onChange} />
        {help}
      </Field>
    );
  }
  if (field.type === "month") {
    return (
      <Field label={label}>
        <MonthField value={value} onChange={onChange} />
        {help}
      </Field>
    );
  }
  if (field.type === "file") {
    return (
      <Field label={label}>
        <View className="flex-row flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onPress={async () => {
              const picked = await pickFile(fileAccept(field)).catch(() => null);
              if (picked) onFile(picked);
            }}
          >
            {file ? "Change file" : "Choose file"}
          </Button>
          {file ? (
            <Text className="min-w-0 flex-1 text-xs text-ink-800" numberOfLines={1}>{file.name}</Text>
          ) : (
            <Text className="text-xs text-ink-600">{field.fileType === "image" ? "Image" : field.fileType === "pdf" ? "PDF" : "Image or PDF"}</Text>
          )}
        </View>
        {help}
      </Field>
    );
  }
  const keyboardType = field.type === "email" ? "email-address" : field.type === "phone" ? "phone-pad" : field.type === "number" ? "numeric" : "default";
  return (
    <Field label={label}>
      <Input
        value={value}
        multiline={field.type === "textarea"}
        keyboardType={keyboardType}
        autoCapitalize={field.type === "email" ? "none" : undefined}
        onChangeText={onChange}
      />
      {help}
    </Field>
  );
}

function emptyForm(classes: { id: string }[]): StudentAdmitPayload {
  return {
    name: "",
    dateOfBirth: "",
    billingStartPeriod: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
    classId: classes[0]?.id || "",
    parentId: "",
    parentName: "",
    parentPhone: "",
    tags: [],
    feeAddOns: [],
    collectAdmissionFee: false,
    paymentMethod: "CASH",
    paymentReference: "",
    parentEmail: "",
    customValues: {},
  };
}

function parentOption(p: { id: string; name: string; phone?: string }) {
  const phone = p.phone?.trim();
  const label = phone ? `${p.name} (${phone})` : p.name;
  return { id: p.id, label, searchText: `${p.name} ${phone || ""}`.trim() };
}

export function SectionCard({
  step,
  title,
  subtitle,
  aside,
  children,
}: {
  step?: number;
  title: string;
  subtitle?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
      <View className="flex-row items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-4 py-3">
        {step ? (
          <View className="h-7 w-7 items-center justify-center rounded-full bg-blue-600">
            <Text className="text-xs font-bold text-white">{step}</Text>
          </View>
        ) : null}
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold text-ink-900">{title}</Text>
          {subtitle ? <Text className="mt-0.5 text-[11px] leading-4 text-ink-600">{subtitle}</Text> : null}
        </View>
        {aside}
      </View>
      <View className="gap-3 p-4">{children}</View>
    </View>
  );
}

function Cell({ half, twoCol, children }: { half?: boolean; twoCol: boolean; children: ReactNode }) {
  return <View style={{ width: twoCol && half ? "48.5%" : "100%" }}>{children}</View>;
}

/** Opens a picked or uploaded file in a new tab (web) or the system viewer (phone). */
function openPreview(url: string) {
  if (!url) return;
  if (Platform.OS === "web" && typeof window !== "undefined") window.open(url, "_blank", "noopener");
  else void Linking.openURL(url).catch(() => undefined);
}

const IMAGE_PATH = /\.(png|jpe?g|webp|gif)$/i;

export function UploadTile({
  field,
  file,
  existingPath,
  onPick,
  onRemove,
}: {
  field: AdmissionFormField;
  file?: PickedFile;
  /** A file already received with the enquiry (private upload path). */
  existingPath?: string;
  onPick: (file: PickedFile) => void;
  onRemove: () => void;
}) {
  const existingUrl = useAssetUrl(file ? "" : existingPath);
  const existingName = existingPath ? existingPath.split("/").pop() || "File" : "";
  const isImage = Boolean(file && file.type.startsWith("image/"));
  const existingIsImage = Boolean(!file && existingPath && IMAGE_PATH.test(existingPath) && existingUrl);
  const previewUrl = file ? file.uri : existingUrl;
  async function choose() {
    const picked = await pickFile(fileAccept(field)).catch(() => null);
    if (picked) onPick(picked);
  }
  const kindLabel = field.fileType === "image" ? "Image" : field.fileType === "pdf" ? "PDF" : "Image or PDF";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${file ? "Change" : "Upload"} ${field.label}`}
      onPress={() => void choose()}
      className={`min-h-[92px] flex-row items-center gap-3 rounded-lg border px-3 py-3 ${
        file || existingName ? "border-emerald-300 bg-emerald-50/60" : "border-dashed border-blue-300 bg-blue-50/40"
      }`}
    >
      <View className={`h-14 w-14 items-center justify-center overflow-hidden rounded-md ${file ? "bg-white" : "bg-white/80"}`}>
        {file && isImage ? (
          <Image source={{ uri: file.uri }} style={{ width: 56, height: 56 }} resizeMode="cover" accessibilityLabel={field.label} />
        ) : existingIsImage ? (
          <Image source={{ uri: existingUrl }} style={{ width: 56, height: 56 }} resizeMode="cover" accessibilityLabel={field.label} />
        ) : (
          <Ionicons
            name={file || existingPath ? "document-text-outline" : field.fileType === "image" ? "image-outline" : "cloud-upload-outline"}
            size={26}
            color={file || existingPath ? "#047857" : "#2855F6"}
          />
        )}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-semibold text-ink-900" numberOfLines={1}>
          {field.label}
          {field.required ? <Text className="text-red-600"> *</Text> : null}
        </Text>
        {file ? (
          <View className="mt-0.5 flex-row items-center gap-1">
            <Ionicons name="checkmark-circle" size={14} color="#047857" />
            <Text className="min-w-0 flex-1 text-xs text-emerald-800" numberOfLines={1}>{file.name}</Text>
          </View>
        ) : existingName ? (
          <View className="mt-0.5 flex-row items-center gap-1">
            <Ionicons name="checkmark-circle" size={14} color="#047857" />
            <Text className="min-w-0 flex-1 text-xs text-emerald-800" numberOfLines={1}>Received with enquiry · {existingName}</Text>
          </View>
        ) : (
          <Text className="mt-0.5 text-xs text-ink-600" numberOfLines={2}>{field.helpText || `Tap to upload · ${kindLabel}`}</Text>
        )}
        {file || existingPath ? (
          <View className="mt-1.5 flex-row gap-4">
            <Pressable
              hitSlop={8}
              disabled={!previewUrl}
              onPress={() => openPreview(previewUrl)}
              accessibilityRole="button"
              accessibilityLabel={`Preview ${field.label}`}
            >
              <Text className={`text-xs font-semibold ${previewUrl ? "text-blue-700" : "text-ink-400"}`}>{previewUrl ? "Preview" : "Loading…"}</Text>
            </Pressable>
            <Text className="text-xs font-semibold text-blue-700">{file ? "Change" : "Replace"}</Text>
            {file ? (
              <Pressable hitSlop={8} onPress={onRemove} accessibilityRole="button" accessibilityLabel={`Remove ${field.label}`}>
                <Text className="text-xs font-semibold text-ink-600">Remove</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function StudentAdmitForm({
  classes,
  parents,
  admissionFeeLines,
  admissionForm = [],
  initial,
  submitLabel = "Add student",
  onSubmit,
  wizard,
  monthlyFees,
}: {
  /** Phone: one step per screen with a sticky Back / Next bar. The caller supplies the full-screen frame. */
  wizard?: boolean;
  /** classId → monthly fee, shown when a class is picked. */
  monthlyFees?: Record<string, number>;
  classes: { id: string; label: string }[];
  parents: { id: string; name: string; phone?: string }[];
  admissionFeeLines: { id: string; classId: string; label: string; amount: number; sortOrder: number }[];
  /** The school's admission form (School setup → Forms & Templates). Labels and extra fields follow it live. */
  admissionForm?: AdmissionFormField[];
  initial?: StudentAdmitInitial;
  submitLabel?: string;
  onSubmit: (values: StudentAdmitPayload, files: StudentAdmitFiles) => Promise<void>;
}) {
  const router = useRouter();
  const enquiryFiles = initial?.enquiryFiles || {};
  const [wizStep, setWizStep] = useState(0);
  const [form, setForm] = useState<StudentAdmitPayload>(() => {
    const base = { ...emptyForm(classes), parentId: wizard || !parents.length ? "__new__" : "", ...(wizard ? { classId: "" } : {}) };
    if (!initial) return base;
    const { enquiryFiles: _files, ...values } = initial;
    return { ...base, ...Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== "")) } as StudentAdmitPayload;
  });
  const [files, setFiles] = useState<StudentAdmitFiles>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(0);
  const twoCol = width >= 520;
  const builtinField = (id: string) => admissionForm.find((field) => field.builtin && field.id === id);
  const builtinLabel = (id: string, fallback: string) => builtinField(id)?.label || fallback;
  const emailField = builtinField("email");
  const showParentEmail = Boolean(emailField?.visible);
  const customFields = admissionForm.filter((field) => field.visible && !field.builtin);
  const detailFields = customFields.filter((field) => field.type !== "file");
  const fileFields = customFields.filter((field) => field.type === "file");
  const uploadedCount = fileFields.filter((field) => files[field.id] || enquiryFiles[field.id]).length;
  const newParent = form.parentId === "__new__";
  const selectedClass = classes.find((row) => row.id === form.classId);
  const selectedAdmissionLines = admissionFeeLines
    .filter((line) => line.classId === form.classId && line.amount > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const admissionTotal = selectedAdmissionLines.reduce((sum, line) => sum + line.amount, 0);
  // No admission fee for the class means no admission: the school sets its fee structure first.
  const feeMissing = Boolean(form.classId) && !selectedAdmissionLines.length;

  function patch(part: Partial<StudentAdmitPayload>) {
    setError("");
    setForm((prev) => ({ ...prev, ...part }));
  }

  function setCustom(id: string, value: string) {
    setError("");
    setForm((prev) => ({ ...prev, customValues: { ...prev.customValues, [id]: value } }));
  }

  function missingField() {
    if (!form.name.trim()) return builtinLabel("studentName", "Student name");
    if (!form.dateOfBirth) return "Date of birth";
    if (!form.classId) return "Class";
    if (!form.billingStartPeriod) return builtinLabel("billingStartPeriod", "Billing starts from");
    for (const field of detailFields) {
      if (field.required && !String(form.customValues[field.id] || "").trim()) return field.label;
    }
    if (!form.parentId) return "Parent";
    if (newParent && !form.parentName.trim()) return builtinLabel("guardianName", "Parent name");
    if (newParent && !form.parentPhone.trim()) return builtinLabel("phone", "Mobile number");
    if (newParent && emailField?.visible && emailField.required && !form.parentEmail.trim()) return emailField.label;
    for (const field of fileFields) {
      if (field.required && !files[field.id] && !enquiryFiles[field.id]) return field.label;
    }
    return "";
  }

  async function save() {
    if (busy) return;
    if (feeMissing) {
      setError(`Set the admission fee for ${selectedClass?.label || "this class"} in Fees → Setup first.`);
      return;
    }
    const missing = missingField();
    if (missing) {
      setError(`${missing} is required.`);
      return;
    }
    setError("");
    setBusy(true);
    try {
      await onSubmit(form, files);
      setForm({ ...emptyForm(classes), parentId: wizard || !parents.length ? "__new__" : "", ...(wizard ? { classId: "" } : {}) });
      setWizStep(0);
      setFiles({});
    } catch {
      /* parent shows the error; keep the form */
    } finally {
      setBusy(false);
    }
  }

  if (wizard) {
    const steps = ["Details", ...(fileFields.length ? ["Documents"] : []), "Parent & fee"];
    const current = steps[Math.min(wizStep, steps.length - 1)];
    const last = wizStep >= steps.length - 1;
    const phoneDigits = form.parentPhone.replace(/\D/g, "").slice(-10);
    const phoneMatch =
      newParent && phoneDigits.length === 10
        ? parents.find((row) => (row.phone || "").replace(/\D/g, "").slice(-10) === phoneDigits)
        : undefined;
    const linked = !newParent ? parents.find((row) => row.id === form.parentId) : undefined;
    const monthly = form.classId ? monthlyFees?.[form.classId] || 0 : 0;

    function stepMissing(name: string) {
      if (name === "Details") {
        if (!form.name.trim()) return builtinLabel("studentName", "Student name");
        if (!form.dateOfBirth) return "Date of birth";
        if (!form.classId) return "Class";
        if (feeMissing) return "";
        if (!form.billingStartPeriod) return builtinLabel("billingStartPeriod", "Billing starts from");
        for (const field of detailFields) {
          if (field.required && !String(form.customValues[field.id] || "").trim()) return field.label;
        }
      }
      if (name === "Documents") {
        for (const field of fileFields) {
          if (field.required && !files[field.id] && !enquiryFiles[field.id]) return field.label;
        }
      }
      return "";
    }

    function next() {
      if (current === "Details" && feeMissing) {
        setError(`Set the admission fee for ${selectedClass?.label || "this class"} in Fees → Setup first.`);
        return;
      }
      const missing = stepMissing(current);
      if (missing) {
        setError(`${missing} is required.`);
        return;
      }
      setError("");
      setWizStep((n) => Math.min(n + 1, steps.length - 1));
    }

    const label = (text: string) => <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">{text}</Text>;
    const box = "rounded-xl border border-ink-200 bg-white px-3 py-3 text-[15px] text-ink-900";

    return (
      <View className="min-h-0 flex-1">
        <View className="px-4 pb-3 pt-1">
          <View className="relative flex-row">
            <View className="absolute h-0.5 rounded-full bg-ink-200" style={{ top: 15, left: `${50 / steps.length}%`, right: `${50 / steps.length}%` }} />
            <View
              className="absolute h-0.5 rounded-full bg-[#1F45C7]"
              style={{
                top: 15,
                left: `${50 / steps.length}%`,
                width: `${steps.length > 1 ? (wizStep / (steps.length - 1)) * (100 - 100 / steps.length) : 0}%`,
              }}
            />
            {steps.map((name, i) => (
              <View key={name} className="flex-1 items-center">
                <View
                  className={`h-8 w-8 items-center justify-center rounded-full ${
                    i < wizStep ? "bg-[#1F45C7]" : i === wizStep ? "border-2 border-[#1F45C7] bg-white" : "border border-ink-300 bg-white"
                  }`}
                >
                  {i < wizStep ? (
                    <Ionicons name="checkmark" size={16} color="#fff" />
                  ) : (
                    <Text className={`text-sm font-bold ${i === wizStep ? "text-[#1F45C7]" : "text-ink-500"}`}>{i + 1}</Text>
                  )}
                </View>
                <Text
                  className={`mt-1.5 text-xs ${i === wizStep ? "font-semibold text-[#1F45C7]" : i < wizStep ? "font-medium text-ink-800" : "text-ink-500"}`}
                  numberOfLines={1}
                >
                  {name}
                </Text>
              </View>
            ))}
          </View>
        </View>
        <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
          {current === "Details" ? (
            <>
              <View>
                {label(`${builtinLabel("studentName", "Student name")} *`)}
                <TextInput
                  value={form.name}
                  onChangeText={(name) => patch({ name })}
                  autoComplete="name"
                  placeholder="Full name as on birth certificate"
                  placeholderTextColor="#94a3b8"
                  className={box}
                  style={{ includeFontPadding: false }}
                />
              </View>
              <View>
                {label("Date of birth *")}
                <DateField birthDate value={form.dateOfBirth} max={new Date().toISOString().slice(0, 10)} onChange={(dateOfBirth) => patch({ dateOfBirth })} />
              </View>
              <View>
                {label("Class *")}
                {classes.length ? (
                  <View className="flex-row flex-wrap gap-2">
                    {classes.map((c) => {
                      const on = form.classId === c.id;
                      return (
                        <Pressable
                          key={c.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          onPress={() => patch({ classId: c.id })}
                          className={`min-w-[56px] items-center rounded-xl border px-3 py-2.5 ${on ? "border-[#1F45C7] bg-[#1F45C7]" : "border-ink-200 bg-white"}`}
                        >
                          <Text className={`text-sm font-semibold ${on ? "text-white" : "text-ink-800"}`}>{c.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <Text className="text-sm text-ink-700">Add a class first, then come back.</Text>
                )}
                {form.classId && !feeMissing ? (
                  <View className="mt-2 flex-row items-center gap-2 rounded-lg bg-[#EEF3FF] px-3 py-2">
                    <Ionicons name="wallet-outline" size={15} color="#1F45C7" />
                    <Text className="flex-1 text-sm text-[#1F45C7]">
                      {monthly ? `${rupees(monthly)}/mo + ` : ""}
                      {rupees(admissionTotal)} admission
                    </Text>
                  </View>
                ) : null}
                {feeMissing ? (
                  <View className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                    <Text className="text-sm font-semibold text-amber-900">{selectedClass?.label || "This class"} has no admission fee yet</Text>
                    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/fees", params: { tab: "setup" } } as never)} className="mt-1 self-start">
                      <Text className="text-sm font-semibold text-[#1F45C7]">Set up fee ›</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
              <View>
                {label(`${builtinLabel("billingStartPeriod", "Billing starts from")} *`)}
                <MonthField value={form.billingStartPeriod} onChange={(billingStartPeriod) => patch({ billingStartPeriod })} />
              </View>
              {detailFields.map((field) => (
                <AdmissionCustomField
                  key={field.id}
                  field={field}
                  value={form.customValues[field.id] || ""}
                  onChange={(value) => setCustom(field.id, value)}
                  onFile={() => undefined}
                />
              ))}
            </>
          ) : null}

          {current === "Documents" ? (
            <>
              {(() => {
                const required = fileFields.filter((f) => f.required);
                const requiredDone = required.filter((f) => files[f.id] || enquiryFiles[f.id]).length;
                return (
                  <View className="flex-row items-center gap-3 rounded-xl bg-ink-50 px-3 py-2.5">
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-white">
                      <Text className="text-xs font-bold text-[#1F45C7]">
                        {uploadedCount}/{fileFields.length}
                      </Text>
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-medium text-ink-900">
                        {requiredDone === required.length ? "All required documents added" : `${required.length - requiredDone} required left`}
                      </Text>
                      <Text className="text-xs text-ink-500">Clear photo or PDF · tap a card to upload</Text>
                    </View>
                  </View>
                );
              })()}
              <View className="flex-row flex-wrap justify-between gap-y-3">
                {fileFields.map((field) => {
                  const file = files[field.id];
                  const existing = enquiryFiles[field.id];
                  const have = Boolean(file || existing);
                  const image = Boolean(file && file.type.startsWith("image/"));
                  return (
                    <Pressable
                      key={field.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${have ? "Change" : "Upload"} ${field.label}`}
                      onPress={async () => {
                        const picked = await pickFile(fileAccept(field)).catch(() => null);
                        if (picked) {
                          setError("");
                          setFiles((prev) => ({ ...prev, [field.id]: picked }));
                        }
                      }}
                      style={{ width: "48.5%", height: 156 }}
                      className={`overflow-hidden rounded-2xl ${have ? "border border-emerald-300 bg-white" : "border-2 border-dashed border-ink-200 bg-white"}`}
                    >
                      {image && file ? (
                        <Image source={{ uri: file.uri }} style={{ width: "100%", height: 104 }} resizeMode="cover" />
                      ) : (
                        <View className={`h-[104px] items-center justify-center ${have ? "bg-emerald-50" : "bg-ink-50/60"}`}>
                          <View className={`h-12 w-12 items-center justify-center rounded-full ${have ? "bg-white" : "bg-[#EEF3FF]"}`}>
                            <Ionicons
                              name={have ? "document-text" : field.fileType === "image" ? "camera-outline" : "cloud-upload-outline"}
                              size={22}
                              color={have ? "#047857" : "#1F45C7"}
                            />
                          </View>
                          {!have ? <Text className="mt-1.5 text-[11px] font-semibold text-[#1F45C7]">Tap to upload</Text> : null}
                        </View>
                      )}
                      {have ? (
                        <View className="absolute right-2 top-2 h-6 w-6 items-center justify-center rounded-full bg-emerald-600">
                          <Ionicons name="checkmark" size={14} color="#fff" />
                        </View>
                      ) : null}
                      <View className="flex-1 justify-center px-2.5">
                        <Text className="text-[13px] font-semibold text-ink-900" numberOfLines={1}>
                          {field.label}
                          {field.required ? <Text className="text-red-600"> *</Text> : null}
                        </Text>
                        <Text className={`text-[11px] ${have ? "text-emerald-700" : "text-ink-500"}`} numberOfLines={1}>
                          {file ? `${file.name} · Change` : existing ? "From enquiry · Replace" : field.required ? "Required" : "Optional"}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {current === "Parent & fee" ? (
            <>
              {linked ? (
                <View className="flex-row items-center gap-3 rounded-xl border border-[#1F45C7] bg-[#EEF3FF] px-3 py-3">
                  <Ionicons name="link-outline" size={18} color="#1F45C7" />
                  <View className="min-w-0 flex-1">
                    <Text className="text-[15px] font-semibold text-ink-900">{linked.name}</Text>
                    <Text className="text-xs text-ink-600">{linked.phone || ""} · existing parent</Text>
                  </View>
                  <Pressable accessibilityRole="button" hitSlop={8} onPress={() => patch({ parentId: "__new__" })}>
                    <Text className="text-sm font-semibold text-[#1F45C7]">Change</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <View>
                    {label(`${builtinLabel("phone", "Parent mobile")} *`)}
                    <TextInput
                      value={form.parentPhone}
                      onChangeText={(parentPhone) => patch({ parentPhone })}
                      keyboardType="phone-pad"
                      placeholder="10-digit mobile number"
                      placeholderTextColor="#94a3b8"
                      className={box}
                      style={{ includeFontPadding: false }}
                    />
                  </View>
                  {phoneMatch ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => patch({ parentId: phoneMatch.id })}
                      className="flex-row items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3"
                    >
                      <Ionicons name="people-outline" size={18} color="#047857" />
                      <View className="min-w-0 flex-1">
                        <Text className="text-[15px] font-semibold text-ink-900">{phoneMatch.name}</Text>
                        <Text className="text-xs text-emerald-800">Already a parent here · link as sibling</Text>
                      </View>
                      <Text className="text-sm font-semibold text-emerald-700">Link</Text>
                    </Pressable>
                  ) : (
                    <>
                      <View>
                        {label(`${builtinLabel("guardianName", "Parent name")} *`)}
                        <TextInput
                          value={form.parentName}
                          onChangeText={(parentName) => patch({ parentName })}
                          autoComplete="name"
                          placeholder="Full name"
                          placeholderTextColor="#94a3b8"
                          className={box}
                          style={{ includeFontPadding: false }}
                        />
                      </View>
                      {showParentEmail ? (
                        <View>
                          {label(`${emailField?.label || "Email"}${emailField?.required ? " *" : ""}`)}
                          <TextInput
                            value={form.parentEmail}
                            onChangeText={(parentEmail) => patch({ parentEmail })}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            placeholder="parent@email.com"
                            placeholderTextColor="#94a3b8"
                            className={box}
                            style={{ includeFontPadding: false }}
                          />
                        </View>
                      ) : null}
                      {parents.length ? (
                        <Select
                          label="Or pick an existing parent"
                          value=""
                          placeholder="Search by name or mobile"
                          options={parents.map(parentOption)}
                          onChange={(parentId) => patch({ parentId })}
                        />
                      ) : null}
                    </>
                  )}
                </>
              )}

              <View className="overflow-hidden rounded-xl border border-ink-100 bg-white">
                <View className="flex-row items-center justify-between px-3 py-3">
                  <Text className="text-[15px] font-semibold text-ink-900">Admission fee</Text>
                  <Text className="text-[15px] font-bold text-ink-900">{rupees(admissionTotal)}</Text>
                </View>
                {selectedAdmissionLines.length > 1
                  ? selectedAdmissionLines.map((line) => (
                      <View key={line.id} className="flex-row justify-between border-t border-ink-50 px-3 py-1.5">
                        <Text className="text-xs text-ink-600">{line.label}</Text>
                        <Text className="text-xs text-ink-800">{rupees(line.amount)}</Text>
                      </View>
                    ))
                  : null}
                <View className="flex-row items-center gap-3 border-t border-ink-100 px-3 py-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-medium text-ink-900">Collect now</Text>
                    <Text className="text-xs text-ink-500">{form.collectAdmissionFee ? "Receipt is created with the student." : "Off: added to dues, collect later."}</Text>
                  </View>
                  <Switch on={form.collectAdmissionFee} onPress={() => patch({ collectAdmissionFee: !form.collectAdmissionFee })} />
                </View>
                {form.collectAdmissionFee ? (
                  <View className="gap-2 border-t border-ink-100 px-3 py-3">
                    <View className="flex-row flex-wrap gap-2">
                      {[
                        ["CASH", "Cash"],
                        ["UPI", "UPI"],
                        ["BANK", "Bank"],
                        ["CHEQUE", "Cheque"],
                      ].map(([id, text]) => {
                        const on = form.paymentMethod === id;
                        return (
                          <Pressable
                            key={id}
                            onPress={() => patch({ paymentMethod: id })}
                            className={`rounded-full border px-3.5 py-1.5 ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
                          >
                            <Text className={`text-sm font-medium ${on ? "text-[#1F45C7]" : "text-ink-700"}`}>{text}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {form.paymentMethod !== "CASH" ? (
                      <TextInput
                        value={form.paymentReference}
                        onChangeText={(paymentReference) => patch({ paymentReference })}
                        placeholder={form.paymentMethod === "CHEQUE" ? "Cheque number" : "UTR / reference"}
                        placeholderTextColor="#94a3b8"
                        className={box}
                        style={{ includeFontPadding: false }}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
              <Text className="text-xs text-ink-500">Admission number is given automatically.</Text>
            </>
          ) : null}
        </ScrollView>

        <View className="border-t border-ink-100 bg-white px-4 pb-2 pt-3">
          {error ? (
            <View className="mb-2 flex-row items-center gap-2 rounded-lg bg-red-50 px-3 py-2">
              <Ionicons name="alert-circle-outline" size={16} color="#b91c1c" />
              <Text className="flex-1 text-sm text-red-700">{error}</Text>
            </View>
          ) : null}
          <View className="flex-row gap-2">
            {wizStep > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setError("");
                  setWizStep((n) => Math.max(0, n - 1));
                }}
                className="h-12 flex-1 items-center justify-center rounded-xl border border-ink-200"
              >
                <Text className="text-[15px] font-semibold text-ink-800">Back</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={busy || !classes.length}
              onPress={() => {
                if (last) void save();
                else next();
              }}
              className={`h-12 flex-[2] items-center justify-center rounded-xl ${busy ? "bg-ink-300" : "bg-[#1F45C7]"}`}
            >
              <Text className="text-[15px] font-semibold text-white">
                {busy
                  ? "Saving…"
                  : last
                    ? form.collectAdmissionFee && admissionTotal
                      ? `${submitLabel} · collect ${rupees(admissionTotal)}`
                      : submitLabel
                    : `Next · ${steps[wizStep + 1]}`}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  let step = 0;
  return (
    <View className="gap-4" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <SectionCard step={++step} title="Student details" subtitle="Follows your admission form in Forms & Templates.">
        <View className="flex-row flex-wrap justify-between gap-y-3">
          <Cell twoCol={twoCol}>
            <Field label={`${builtinLabel("studentName", "Student name")} *`}>
              <Input value={form.name} onChangeText={(name) => patch({ name })} autoComplete="name" placeholder="Full name as on birth certificate" />
            </Field>
          </Cell>
          <Cell half twoCol={twoCol}>
            <Field label="Date of birth *">
              <DateField value={form.dateOfBirth} onChange={(dateOfBirth) => patch({ dateOfBirth })} />
            </Field>
          </Cell>
          <Cell half twoCol={twoCol}>
            {classes.length ? (
              <Select
                label={`${builtinLabel("classWanted", "Class")} *`}
                value={form.classId}
                options={classes.map((c) => ({ id: c.id, label: c.label }))}
                onChange={(classId) => patch({ classId })}
              />
            ) : (
              <Text className="text-sm text-ink-700">Add a class first, then come back.</Text>
            )}
          </Cell>
          <Cell half twoCol={twoCol}>
            <Field label={`${builtinLabel("billingStartPeriod", "Billing starts from")} *`}>
              <MonthField value={form.billingStartPeriod} onChange={(billingStartPeriod) => patch({ billingStartPeriod })} />
            </Field>
          </Cell>
          {detailFields.map((field) => (
            <Cell key={field.id} half={!["textarea", "multi", "checkbox"].includes(field.type)} twoCol={twoCol}>
              <AdmissionCustomField
                field={field}
                value={form.customValues[field.id] || ""}
                onChange={(value) => setCustom(field.id, value)}
                onFile={() => undefined}
              />
            </Cell>
          ))}
        </View>
      </SectionCard>

      {fileFields.length ? (
        <SectionCard
          step={++step}
          title="Documents"
          subtitle="Saved privately to the student's file after admission."
          aside={<Text className={`text-xs font-semibold ${uploadedCount === fileFields.length ? "text-emerald-700" : "text-ink-600"}`}>{uploadedCount}/{fileFields.length} added</Text>}
        >
          <View className="flex-row flex-wrap justify-between gap-y-3">
            {fileFields.map((field) => (
              <Cell key={field.id} half twoCol={twoCol}>
                <UploadTile
                  field={field}
                  file={files[field.id]}
                  existingPath={enquiryFiles[field.id]}
                  onPick={(file) => { setError(""); setFiles((prev) => ({ ...prev, [field.id]: file })); }}
                  onRemove={() => setFiles((prev) => {
                    const next = { ...prev };
                    delete next[field.id];
                    return next;
                  })}
                />
              </Cell>
            ))}
          </View>
        </SectionCard>
      ) : null}

      <SectionCard step={++step} title="Parent or guardian" subtitle={newParent ? "A parent login is created with this mobile number." : "Link this student to a parent already in the school."}>
        {parents.length ? (
          <Segmented
            options={[{ id: "existing", label: "Existing parent" }, { id: "new", label: "New parent" }]}
            value={newParent ? "new" : "existing"}
            onChange={(mode) => patch({ parentId: mode === "new" ? "__new__" : "" })}
          />
        ) : null}
        {newParent ? (
          <View className="flex-row flex-wrap justify-between gap-y-3">
            <Cell half twoCol={twoCol}>
              <Field label={`${builtinLabel("guardianName", "Parent name")} *`}>
                <Input value={form.parentName} onChangeText={(parentName) => patch({ parentName })} autoComplete="name" />
              </Field>
            </Cell>
            <Cell half twoCol={twoCol}>
              <Field label={`${builtinLabel("phone", "Mobile number")} *`}>
                <Input value={form.parentPhone} onChangeText={(parentPhone) => patch({ parentPhone })} keyboardType="phone-pad" placeholder="10-digit mobile number" />
              </Field>
            </Cell>
            {showParentEmail ? (
              <Cell twoCol={twoCol}>
                <Field label={`${emailField?.label || "Email"}${emailField?.required ? " *" : ""}`}>
                  <Input value={form.parentEmail} onChangeText={(parentEmail) => patch({ parentEmail })} keyboardType="email-address" autoCapitalize="none" placeholder="parent@email.com" />
                </Field>
              </Cell>
            ) : null}
          </View>
        ) : (
          <Select
            label="Parent *"
            value={form.parentId}
            placeholder="Search by name or mobile"
            options={parents.map(parentOption)}
            onChange={(parentId) => patch({ parentId })}
          />
        )}
      </SectionCard>

      <SectionCard
        step={++step}
        title="Admission fee"
        subtitle={selectedAdmissionLines.length ? `One-time fee for ${selectedClass?.label || "this class"}. Monthly fees are separate.` : `No admission fee is set for ${selectedClass?.label || "this class"}.`}
        aside={<Text className="text-base font-bold text-ink-900">{rupees(admissionTotal)}</Text>}
      >
        {feeMissing ? (
          <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3">
            <View className="min-w-0 flex-1 flex-row items-start gap-2">
              <Ionicons name="alert-circle-outline" size={18} color="#b45309" />
              <View className="min-w-0 flex-1">
                <Text className="text-sm font-semibold text-amber-900">Set up the admission fee first</Text>
                <Text className="mt-0.5 text-xs leading-4 text-amber-900">
                  {selectedClass?.label || "This class"} has no admission fee yet. Add it once in Fees → Setup, then come back to admit.
                </Text>
              </View>
            </View>
            <Button variant="ghost" onPress={() => router.push({ pathname: "/fees", params: { tab: "setup" } } as never)}>
              Set up admission fee
            </Button>
          </View>
        ) : null}
        {selectedAdmissionLines.length ? (
          <View className="overflow-hidden rounded-lg border border-ink-100">
            {selectedAdmissionLines.map((line, index) => (
              <View key={line.id} className={`flex-row items-center justify-between px-3 py-2 ${index ? "border-t border-ink-100" : ""}`}>
                <Text className="text-xs text-ink-700">{line.label}</Text>
                <Text className="text-xs font-semibold text-ink-900">{rupees(line.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {!feeMissing ? (
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-semibold text-ink-900">Collect payment now</Text>
            <Text className="mt-0.5 text-xs leading-4 text-ink-700">
              {form.collectAdmissionFee
                ? "A paid invoice and receipt are created with the student."
                : selectedAdmissionLines.length
                  ? "Off: a pending invoice is created. Collect it later from Fees."
                  : "Set the admission fee in Fees → Setup to collect it here."}
            </Text>
          </View>
          <Switch on={form.collectAdmissionFee} onPress={() => patch({ collectAdmissionFee: !form.collectAdmissionFee })} />
        </View>
        ) : null}
        {form.collectAdmissionFee && !feeMissing ? (
          <View className="flex-row flex-wrap justify-between gap-y-3">
            <Cell half twoCol={twoCol}>
              <Select
                label="Payment method"
                value={form.paymentMethod}
                options={[
                  { id: "CASH", label: "Cash" },
                  { id: "UPI", label: "UPI" },
                  { id: "BANK", label: "Bank transfer" },
                  { id: "CHEQUE", label: "Cheque" },
                ]}
                onChange={(paymentMethod) => patch({ paymentMethod })}
              />
            </Cell>
            {form.paymentMethod !== "CASH" ? (
              <Cell half twoCol={twoCol}>
                <Field label={form.paymentMethod === "CHEQUE" ? "Cheque number" : "UTR / reference number"}>
                  <Input value={form.paymentReference} onChangeText={(paymentReference) => patch({ paymentReference })} />
                </Field>
              </Cell>
            ) : null}
          </View>
        ) : null}
      </SectionCard>

      <View className="gap-2 border-t border-ink-100 pt-3">
        {error ? (
          <View className="flex-row items-center gap-2 rounded-md bg-red-50 px-3 py-2">
            <Ionicons name="alert-circle-outline" size={16} color="#b91c1c" />
            <Text className="flex-1 text-sm text-red-700">{error}</Text>
          </View>
        ) : null}
        <View className={twoCol ? "flex-row items-center justify-between gap-3" : "gap-2"}>
          <Text className="text-xs text-ink-600">Admission number is assigned automatically. Add-ons can be set later from Manage fee.</Text>
          <Button disabled={busy || !classes.length || feeMissing} onPress={save} className={twoCol ? "min-w-[160px]" : ""}>
            {busy ? "Saving…" : submitLabel}
          </Button>
        </View>
      </View>
    </View>
  );
}
