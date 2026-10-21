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

const BUILTIN_IDS = ["rollNumber", "studentName", "dateOfBirth", "classWanted", "billingStartPeriod", "guardianName", "phone", "email", "message"] as const;
/** Only the office form asks for date of birth; it is optional unless the school makes it required. */
const STUDENT_FIXED_TYPES: Record<string, AdmissionFieldType> = {
  rollNumber: "number",
  dateOfBirth: "date",
  billingStartPeriod: "month",
};
/** Every enquiry needs these: who, which class, and a number to call back. Rename only, never hide. */
export const LOCKED_ADMISSION_FIELD_IDS: readonly string[] = ["studentName", "classWanted", "phone"];
/**
 * A student profile always needs roll, name, class and billing month. Parent name / mobile / email
 * stay unlocked: fill them to create a parent login, or leave them blank and admit the child alone.
 */
export const LOCKED_STUDENT_ADMISSION_FIELD_IDS: readonly string[] = [
  "rollNumber",
  "studentName",
  "classWanted",
  "billingStartPeriod",
];
const STUDENT_ONLY_IDS = ["rollNumber", "dateOfBirth"] as const;
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
  address: "textarea",
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
    if (field.id === "classWanted") continue;
    if (["select", "radio", "multi"].includes(field.type) && field.visible && !field.options.length) throw new Error(`${field.label} needs at least one option.`);
  }
  return JSON.stringify(fields);
}

const DEFAULT_STUDENT_ADMISSION_FIELDS: AdmissionFormField[] = [
  { id: "rollNumber", label: "Roll no", type: "number", required: true, visible: true, options: [], builtin: true, helpText: "Whole number of 1 or more. Must be unique in the class." },
  { id: "studentName", label: "Student name", type: "text", required: true, visible: true, options: [], builtin: true },
  { id: "dateOfBirth", label: "Date of birth", type: "date", required: false, visible: false, options: [], builtin: true },
  { id: "classWanted", label: "Class", type: "text", required: true, visible: true, options: [], builtin: true },
  { id: "billingStartPeriod", label: "Billing starts from", type: "month", required: true, visible: true, options: [], builtin: true },
  { id: "guardianName", label: "Parent name", type: "text", required: false, visible: true, options: [], builtin: true },
  { id: "phone", label: "Parent mobile", type: "phone", required: false, visible: true, options: [], builtin: true, helpText: "Optional. A mobile or email creates the parent login." },
  { id: "email", label: "Parent email", type: "email", required: false, visible: true, options: [], builtin: true },
  { id: "message", label: "Notes", type: "textarea", required: false, visible: false, options: [], builtin: true },
];

function withLockedStudentAdmissionFields(fields: AdmissionFormField[]) {
  const saved = new Map(fields.filter((field) => field.id !== "interests").map((field) => [field.id, field]));
  const next: AdmissionFormField[] = [];
  for (const fallback of DEFAULT_STUDENT_ADMISSION_FIELDS) {
    const row = saved.get(fallback.id);
    if (row) {
      next.push(
        LOCKED_STUDENT_ADMISSION_FIELD_IDS.includes(fallback.id)
          ? { ...row, helpText: fallback.helpText }
          : row
      );
      saved.delete(fallback.id);
    } else {
      next.push({ ...fallback, options: [...fallback.options] });
    }
  }
  for (const field of fields) {
    if (saved.has(field.id)) {
      next.push(field);
      saved.delete(field.id);
    }
  }
  return next;
}

/** Student admission form: used by Add student in the office. */
export function admissionFormFields(value: unknown): AdmissionFormField[] {
  return withLockedStudentAdmissionFields(
    parseFormFields(value, BUILTIN_IDS, LOCKED_STUDENT_ADMISSION_FIELD_IDS, false, [], STUDENT_FIXED_TYPES)
  );
}

const DEFAULT_WEBSITE_ADMISSION_FIELDS: AdmissionFormField[] = [
  { id: "studentName", label: "Student name", type: "text", required: true, visible: true, options: [], builtin: true },
  { id: "classWanted", label: "Class interested", type: "select", required: true, visible: true, options: [], builtin: true, helpText: "Same class list the school office uses for admissions." },
  { id: "guardianName", label: "Parent / guardian name", type: "text", required: true, visible: true, options: [], builtin: true },
  { id: "phone", label: "Mobile number", type: "phone", required: true, visible: true, options: [], builtin: true, helpText: "We will call or WhatsApp you on this number." },
  { id: "email", label: "Email", type: "email", required: false, visible: true, options: [], builtin: true },
  { id: "message", label: "Message", type: "textarea", required: false, visible: true, options: [], builtin: true, helpText: "Questions about fees, transport or visiting the campus." },
  { id: "billingStartPeriod", label: "Billing starts from", type: "month", required: false, visible: false, options: [], builtin: true },
];

function withLockedWebsiteFields(fields: AdmissionFormField[]) {
  const saved = new Map(
    fields
      .filter((field) => field.id !== "interests" && !(STUDENT_ONLY_IDS as readonly string[]).includes(field.id))
      .map((field) => [field.id, field])
  );
  const next: AdmissionFormField[] = [];
  for (const fallback of DEFAULT_WEBSITE_ADMISSION_FIELDS) {
    const row = saved.get(fallback.id);
    if (row) {
      next.push(LOCKED_ADMISSION_FIELD_IDS.includes(fallback.id) ? { ...row, helpText: fallback.helpText } : row);
      saved.delete(fallback.id);
    } else {
      next.push({ ...fallback, options: [...fallback.options] });
    }
  }
  for (const field of fields) {
    if (saved.has(field.id)) {
      next.push(field);
      saved.delete(field.id);
    }
  }
  return next;
}

/** Website enquiry form: used by the public school website and walk-in leads. */
export function websiteFormFields(value: unknown): AdmissionFormField[] {
  return withLockedWebsiteFields(parseFormFields(value, BUILTIN_IDS, LOCKED_ADMISSION_FIELD_IDS)).filter(
    (field) => !(STUDENT_ONLY_IDS as readonly string[]).includes(field.id)
  );
}

export function classLabelsFrom(classes: { name?: string; section?: string; label?: string }[]): string[] {
  return [...new Set(classes.map((row) => row.label || [row.name, row.section].filter(Boolean).join("-")).filter(Boolean))];
}

/** Class interested always offers the school's live sections, the same list Add student uses. */
export function applySchoolClassOptions(fields: AdmissionFormField[], classLabels: string[]): AdmissionFormField[] {
  if (!classLabels.length) return fields;
  return fields.map((field) => (field.id === "classWanted" ? { ...field, type: "select", options: [...classLabels] } : field));
}

/** Parent details are optional. A parent profile is created only when a mobile or email is given. */
export function parentAdmissionContact(input: { parentName?: string; parentPhone?: string; parentEmail?: string }) {
  const parentName = String(input.parentName || "").trim();
  const parentEmail = String(input.parentEmail || "").trim().toLowerCase();
  const parentPhone = String(input.parentPhone || "").trim();
  const filled = Boolean(parentName || parentEmail || parentPhone);
  return { parentName, parentEmail, parentPhone, filled, canCreate: Boolean(parentPhone || parentEmail) };
}

/** Enough to create a staff login: name, mobile, role. Rename only, never hide. */
export const LOCKED_STAFF_FIELD_IDS: readonly string[] = ["staffName", "phone", "role"];
/** Always on the staff form, but never required. Salary and manager can be filled later. */
export const LOCKED_OPTIONAL_STAFF_FIELD_IDS: readonly string[] = ["email"];

const DEFAULT_STAFF_ONBOARDING_FIELDS: AdmissionFormField[] = [
  { id: "staffName", label: "Staff name", type: "text", required: true, visible: true, options: [], builtin: true },
  { id: "phone", label: "Mobile number", type: "phone", required: true, visible: true, options: [], builtin: true },
  { id: "email", label: "Email", type: "email", required: false, visible: true, options: [], builtin: true },
  { id: "role", label: "Role", type: "role", required: true, visible: true, options: [], builtin: true },
  { id: "department", label: "Department", type: "text", required: false, visible: false, options: [], builtin: true },
  { id: "joiningDate", label: "Joining date", type: "date", required: false, visible: true, options: [], builtin: true },
  { id: "qualification", label: "Qualification", type: "text", required: false, visible: false, options: [], builtin: true },
  { id: "address", label: "Address", type: "textarea", required: false, visible: false, options: [], builtin: true },
  { id: "monthlySalary", label: "Monthly salary", type: "number", required: false, visible: false, options: [], builtin: true },
  { id: "reportingManager", label: "Reporting manager", type: "manager", required: false, visible: false, options: [], builtin: true },
];

function withLockedStaffFields(fields: AdmissionFormField[]) {
  const saved = new Map(fields.map((field) => [field.id, field]));
  const next: AdmissionFormField[] = [];
  for (const fallback of DEFAULT_STAFF_ONBOARDING_FIELDS) {
    next.push(saved.get(fallback.id) || { ...fallback, options: [...fallback.options] });
    saved.delete(fallback.id);
  }
  for (const field of fields) {
    if (saved.has(field.id)) {
      next.push(field);
      saved.delete(field.id);
    }
  }
  return next;
}

export function staffOnboardingFormFields(value: unknown): AdmissionFormField[] {
  return withLockedStaffFields(
    parseFormFields(value, STAFF_ONBOARDING_BUILTIN_IDS, LOCKED_STAFF_FIELD_IDS, true, LOCKED_OPTIONAL_STAFF_FIELD_IDS, STAFF_FIXED_TYPES)
  );
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
export function admissionLeadInput(fieldsValue: unknown, input: Record<string, unknown>, classLabels: string[] = []) {
  const fields = applySchoolClassOptions(websiteFormFields(fieldsValue), classLabels);
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
