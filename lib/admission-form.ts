export const ADMISSION_FIELD_TYPES = ["text", "email", "phone", "number", "date", "month", "textarea", "select", "radio", "multi", "checkbox", "file", "role", "manager"] as const;
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

const BUILTIN_IDS = ["studentName", "dateOfBirth", "classWanted", "billingStartPeriod", "guardianName", "phone", "email", "message"] as const;
/** Only the office form asks for date of birth; it is optional unless the school makes it required. */
const STUDENT_FIXED_TYPES: Record<string, AdmissionFieldType> = { dateOfBirth: "date", billingStartPeriod: "month" };
/** Every enquiry needs these: who, which class, and a number to call back. Rename only, never hide. */
export const LOCKED_ADMISSION_FIELD_IDS: readonly string[] = ["studentName", "classWanted", "phone"];
/**
 * Admitting a student only needs the child, the class and the billing month. Parent name and mobile are the
 * school's choice: a student admitted without a parent mobile has no parent login until one is added.
 */
export const LOCKED_STUDENT_ADMISSION_FIELD_IDS: readonly string[] = ["studentName", "classWanted", "billingStartPeriod"];
export type AdmissionBuiltinId = (typeof BUILTIN_IDS)[number];
const STAFF_ONBOARDING_BUILTIN_IDS = ["staffName", "phone", "email", "role", "department", "joiningDate", "qualification", "address", "monthlySalary", "reportingManager"] as const;
/** Staff fields with a fixed input type: the code reads them, so a school can't turn them into something else. */
const STAFF_FIXED_TYPES: Record<string, AdmissionFieldType> = {
  staffName: "text",
  phone: "phone",
  email: "email",
  role: "role",
  joiningDate: "date",
  monthlySalary: "number",
  reportingManager: "manager",
};

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

/** Parses a saved form. Built-in ids are the code's field contract; everything else is the school's own field. */
function parseFormFields(
  value: unknown,
  builtinIds: readonly string[],
  lockedIds: readonly string[] = [],
  allowRole = false,
  lockedOptionalIds: readonly string[] = [],
  fixedTypes: Record<string, AdmissionFieldType> = {}
): AdmissionFormField[] {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  const used = new Set<string>();
  return parsed.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .slice(0, builtinIds.length + 14)
    .map((row, index): AdmissionFormField | null => {
      const rawId = String(row.id || "");
      const builtin = builtinIds.includes(rawId);
      const id = builtin ? rawId : customId(rawId, index);
      if (used.has(id)) return null;
      used.add(id);
      let type = ADMISSION_FIELD_TYPES.includes(String(row.type || "") as AdmissionFieldType)
        ? String(row.type) as AdmissionFieldType : "text";
      // "School role" lists the school's live roles; only the staff form has it, and its built-in Role field always uses it.
      if ((type === "role" || type === "manager") && !allowRole) type = "text";
      if (builtin && fixedTypes[rawId]) type = fixedTypes[rawId];
      const fileType = ADMISSION_FILE_TYPES.includes(String(row.fileType || "") as AdmissionFileType)
        ? String(row.fileType) as AdmissionFileType : "image_pdf";
      const lockedOptional = builtin && lockedOptionalIds.includes(id);
      const locked = builtin && (lockedIds.includes(id) || lockedOptional);
      const visible = locked || row.visible === undefined ? true : Boolean(row.visible);
      return {
        id,
        label: String(row.label || id).trim().slice(0, 80) || id,
        type,
        required: lockedOptional ? false : locked || (visible && Boolean(row.required)),
        visible,
        options: ["select", "radio", "multi"].includes(type) ? cleanOptions(row.options) : [],
        builtin,
        helpText: String(row.helpText || "").trim().slice(0, 140) || undefined,
        ...(type === "file" ? { fileType, maxFileSizeMb: Math.min(12, Math.max(1, Math.round(Number(row.maxFileSizeMb || 5) || 5))) } : {}),
      } satisfies AdmissionFormField;
    }).filter((field): field is AdmissionFormField => field !== null);
}

function validatedFormJson(fields: AdmissionFormField[]) {
  for (const field of fields) {
    if (["select", "radio", "multi"].includes(field.type) && field.visible && !field.options.length) throw new Error(`${field.label} needs at least one option.`);
  }
  return JSON.stringify(fields);
}

/** Student admission form: used by Add student in the office. */
export function admissionFormFields(value: unknown): AdmissionFormField[] {
  const fields = parseFormFields(value, BUILTIN_IDS, LOCKED_STUDENT_ADMISSION_FIELD_IDS, false, [], STUDENT_FIXED_TYPES);
  // Older saved forms have no Date of birth row: add it hidden, so the school can switch it on.
  if (fields.length && !fields.some((field) => field.id === "dateOfBirth")) {
    const at = Math.max(0, fields.findIndex((field) => field.id === "studentName") + 1);
    fields.splice(at, 0, { id: "dateOfBirth", label: "Date of birth", type: "date", required: false, visible: false, options: [], builtin: true });
  }
  return fields;
}

/** Website enquiry form: used by the public school website and enquiries. */
export function websiteFormFields(value: unknown): AdmissionFormField[] {
  return parseFormFields(value, BUILTIN_IDS, LOCKED_ADMISSION_FIELD_IDS).filter((field) => field.id !== "dateOfBirth");
}

/** Every employee needs these to log in and be paid from the right day: rename only, never hide. */
export const LOCKED_STAFF_FIELD_IDS: readonly string[] = ["staffName", "phone", "role", "joiningDate", "monthlySalary"];
/** Always on the staff form, but never required. */
export const LOCKED_OPTIONAL_STAFF_FIELD_IDS: readonly string[] = ["email", "reportingManager"];

export function staffOnboardingFormFields(value: unknown): AdmissionFormField[] {
  return parseFormFields(value, STAFF_ONBOARDING_BUILTIN_IDS, LOCKED_STAFF_FIELD_IDS, true, LOCKED_OPTIONAL_STAFF_FIELD_IDS, STAFF_FIXED_TYPES);
}

export function websiteFormJson(value: unknown) {
  return validatedFormJson(websiteFormFields(value));
}

export function admissionFormJson(value: unknown) {
  return validatedFormJson(admissionFormFields(value));
}

/** A school's own saved form wins; otherwise the Anekio default from PlatformConfig. No defaults live in code. */
export function effectiveFormJson(schoolValue: unknown, platformValue: unknown): unknown {
  let parsed = schoolValue;
  if (typeof schoolValue === "string") {
    try { parsed = JSON.parse(schoolValue); } catch { parsed = []; }
  }
  return Array.isArray(parsed) && parsed.length ? schoolValue : platformValue;
}

export const effectiveAdmissionFormJson = effectiveFormJson;

export function staffOnboardingFormJson(value: unknown) {
  return validatedFormJson(staffOnboardingFormFields(value));
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

/** Validates an enquiry (website or walk-in) against the website enquiry form. Billing month is not asked here. */
export function admissionLeadInput(fieldsValue: unknown, input: Record<string, unknown>) {
  const fields = websiteFormFields(fieldsValue);
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
    if (value && field.type === "month" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`Choose a valid ${field.label}.`);
    values[field.id] = value;
  }

  const builtin = (id: AdmissionBuiltinId, max: number) => String(values[id] || "").slice(0, max);
  for (const id of ["studentName", "guardianName"] as const) {
    const value = String(values[id] || "");
    if (value && !isPersonName(value)) throw new Error(`${fields.find((f) => f.id === id)?.label || "Name"} should be a real name, not numbers.`);
  }
  const customValues = Object.fromEntries(fields.filter((field) => !field.builtin && field.visible).map((field) => [field.id, values[field.id] || ""]));
  return {
    fields,
    studentName: builtin("studentName", 120),
    guardianName: builtin("guardianName", 120),
    phone: builtin("phone", 30),
    email: builtin("email", 160),
    classWanted: builtin("classWanted", 80),
    billingStartPeriod: builtin("billingStartPeriod", 7),
    message: builtin("message", 800),
    customValues,
  };
}

/** A person's name needs at least two letters (any script) and can't be mostly digits. */
export function isPersonName(value: string) {
  const v = String(value || "").trim();
  const letters = (v.match(/\p{L}/gu) || []).length;
  const digits = (v.match(/\d/g) || []).length;
  return letters >= 2 && digits <= letters;
}

/**
 * Validates the school's custom admission-form fields for a student added by the office.
 * File fields are uploaded after the student exists, so they are skipped here.
 */
export function studentAdmissionCustomValues(fieldsValue: unknown, input: unknown): Record<string, string> {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const values: Record<string, string> = {};
  for (const field of admissionFormFields(fieldsValue).filter((row) => row.visible && !row.builtin && row.type !== "file")) {
    const raw = Array.isArray(source[field.id]) ? (source[field.id] as unknown[]).map((item) => String(item || "")).join(", ") : source[field.id];
    const value = String(raw ?? "").trim().slice(0, field.type === "textarea" ? 1000 : 180);
    if (field.required && !value) throw new Error(`${field.label} is required.`);
    if (!value) continue;
    if (["select", "radio"].includes(field.type) && !field.options.includes(value)) throw new Error(`Choose a valid ${field.label}.`);
    if (field.type === "multi" && value.split(",").map((row) => row.trim()).filter(Boolean).some((option) => !field.options.includes(option))) throw new Error(`Choose valid ${field.label} options.`);
    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`Enter a valid ${field.label}.`);
    if (field.type === "number" && !Number.isFinite(Number(value))) throw new Error(`Enter a valid ${field.label}.`);
    if (field.type === "month" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`Choose a valid ${field.label}.`);
    if (field.type === "date" && Number.isNaN(new Date(value).getTime())) throw new Error(`Enter a valid ${field.label}.`);
    values[field.id] = value;
  }
  return values;
}
