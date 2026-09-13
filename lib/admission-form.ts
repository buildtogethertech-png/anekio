export const ADMISSION_FIELD_TYPES = ["text", "email", "phone", "number", "date", "textarea", "select", "radio", "multi", "checkbox", "file"] as const;
export const ADMISSION_FILE_TYPES = ["image", "pdf", "image_pdf"] as const;

export type AdmissionFieldType = (typeof ADMISSION_FIELD_TYPES)[number];
export type AdmissionFileType = (typeof ADMISSION_FILE_TYPES)[number];

export type AdmissionFormField = {
  id: string;
  label: string;
  type: AdmissionFieldType;
  required: boolean;
  visible: boolean;
  options: string[];
  builtin: boolean;
  helpText?: string;
  fileType?: AdmissionFileType;
  maxFileSizeMb?: number;
};

const BUILTIN_IDS = ["studentName", "classWanted", "guardianName", "phone", "email", "message"] as const;
export type AdmissionBuiltinId = (typeof BUILTIN_IDS)[number];

export const DEFAULT_ADMISSION_FORM: AdmissionFormField[] = [
  { id: "studentName", label: "Student name", type: "text", required: true, visible: true, options: [], builtin: true },
  { id: "classWanted", label: "Class interested", type: "text", required: true, visible: true, options: [], builtin: true },
  { id: "guardianName", label: "Guardian name", type: "text", required: true, visible: true, options: [], builtin: true },
  { id: "phone", label: "Phone", type: "phone", required: true, visible: true, options: [], builtin: true },
  { id: "email", label: "Email", type: "email", required: false, visible: true, options: [], builtin: true },
  { id: "message", label: "Message", type: "textarea", required: false, visible: true, options: [], builtin: true },
];

function cleanOptions(value: unknown) {
  const source = Array.isArray(value) ? value : String(value || "").split(/\n|,/);
  return [...new Set(source.map((option) => String(option || "").trim().slice(0, 80)).filter(Boolean))].slice(0, 40);
}

function customId(value: unknown, index: number) {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return clean.startsWith("custom_") ? clean : `custom_${clean || index + 1}`;
}

export function admissionFormFields(value: unknown): AdmissionFormField[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return DEFAULT_ADMISSION_FORM.map((field) => ({ ...field, options: [...field.options] }));
    }
  }
  if (!Array.isArray(parsed) || !parsed.length) {
    return DEFAULT_ADMISSION_FORM.map((field) => ({ ...field, options: [...field.options] }));
  }

  const incoming = parsed.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  const byId = new Map(incoming.map((row) => [String(row.id || ""), row]));
  const builtins = DEFAULT_ADMISSION_FORM.map((fallback) => {
    const row = byId.get(fallback.id);
    const type = ADMISSION_FIELD_TYPES.includes(String(row?.type || "") as AdmissionFieldType)
      ? (String(row?.type) as AdmissionFieldType)
      : fallback.type;
    const options = ["select", "radio", "multi"].includes(type) ? cleanOptions(row?.options) : [];
    return {
      ...fallback,
      label: String(row?.label || fallback.label).trim().slice(0, 80) || fallback.label,
      type,
      required: row?.required === undefined ? fallback.required : Boolean(row.required),
      visible: row?.visible === undefined ? fallback.visible : Boolean(row.visible),
      options,
      helpText: String(row?.helpText || "").trim().slice(0, 140) || undefined,
    };
  });

  const used = new Set<string>(BUILTIN_IDS);
  const custom = incoming
    .filter((row) => !used.has(String(row.id || "")))
    .slice(0, 14)
    .map((row, index) => {
      let id = customId(row.id, index);
      while (used.has(id)) id = `${id}_${index + 1}`.slice(0, 55);
      used.add(id);
      const type = ADMISSION_FIELD_TYPES.includes(String(row.type || "") as AdmissionFieldType)
        ? (String(row.type) as AdmissionFieldType)
        : "text";
      const fileType = ADMISSION_FILE_TYPES.includes(String(row.fileType || "") as AdmissionFileType)
        ? (String(row.fileType) as AdmissionFileType)
        : "image_pdf";
      const maxFileSizeMb = Math.min(12, Math.max(1, Math.round(Number(row.maxFileSizeMb || 5) || 5)));
      return {
        id,
        label: String(row.label || `Custom field ${index + 1}`).trim().slice(0, 80) || `Custom field ${index + 1}`,
        type,
        required: Boolean(row.required),
        visible: row.visible === undefined ? true : Boolean(row.visible),
        options: ["select", "radio", "multi"].includes(type) ? cleanOptions(row.options) : [],
        builtin: false,
        helpText: String(row.helpText || "").trim().slice(0, 140) || undefined,
        ...(type === "file" ? { fileType, maxFileSizeMb } : {}),
      } satisfies AdmissionFormField;
    });

  return [...builtins, ...custom].map((field) => ({ ...field, required: field.visible && field.required }));
}

export function admissionFormJson(value: unknown) {
  const fields = admissionFormFields(value);
  for (const field of fields) {
    if (["select", "radio", "multi"].includes(field.type) && field.visible && !field.options.length) {
      throw new Error(`${field.label} needs at least one option.`);
    }
    if (field.type === "file" && field.visible && !field.fileType) {
      throw new Error(`${field.label} needs accepted file types.`);
    }
  }
  return JSON.stringify(fields);
}

export function admissionCustomValues(value: unknown): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([key]) => key.startsWith("custom_"))
        .slice(0, 14)
        .map(([key, entry]) => [key, String(entry || "").trim().slice(0, 1000)])
    );
  } catch {
    return {};
  }
}

export function admissionLeadInput(fieldsValue: unknown, input: Record<string, unknown>) {
  const fields = admissionFormFields(fieldsValue);
  const values: Record<string, string> = {};
  for (const field of fields.filter((row) => row.visible)) {
    const inputValue = input[field.id];
    const raw = Array.isArray(inputValue) ? inputValue.map((item) => String(item || "")).join(", ") : inputValue;
    const value = String(raw ?? "").trim().slice(0, field.type === "textarea" ? 1000 : field.type === "file" ? 260 : 180);
    if (field.required && !value) throw new Error(`${field.label} is required.`);
    if (value && ["select", "radio"].includes(field.type) && !field.options.includes(value)) throw new Error(`Choose a valid ${field.label}.`);
    if (value && field.type === "multi") {
      const picked = value.split(",").map((row) => row.trim()).filter(Boolean);
      if (picked.some((option) => !field.options.includes(option))) throw new Error(`Choose valid ${field.label} options.`);
    }
    if (value && field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`Enter a valid ${field.label}.`);
    if (value && field.type === "number" && !Number.isFinite(Number(value))) throw new Error(`Enter a valid ${field.label}.`);
    values[field.id] = value;
  }

  const builtin = (id: AdmissionBuiltinId, max: number) => String(values[id] || "").slice(0, max);
  const customValues = Object.fromEntries(fields.filter((field) => !field.builtin && field.visible).map((field) => [field.id, values[field.id] || ""]));
  return {
    fields,
    studentName: builtin("studentName", 120),
    guardianName: builtin("guardianName", 120),
    phone: builtin("phone", 30),
    email: builtin("email", 160),
    classWanted: builtin("classWanted", 80),
    message: builtin("message", 800),
    customValues,
  };
}
