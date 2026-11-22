/**
 * Where a form answer is saved, at the moment it is saved (no JSON copy, no later sync):
 * - a core field (gender, blood group, category, … — lib/admission-form.ts STUDENT_CORE_FIELDS / STAFF_CORE_FIELDS)
 *   goes straight into its column on Student / Teacher / StaffMember;
 * - any other field is the school's own, so it goes to StudentFieldValue / StaffFieldValue: one row per person per
 *   field id, text plus number / date copies for sorting and range filters.
 * Reads put both back together as one { fieldId: value } map, so screens that show "the form's answers" don't care.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  admissionFormFields,
  LEGACY_STAFF_CORE_IDS,
  LEGACY_STUDENT_CORE_IDS,
  staffOnboardingFormFields,
  STAFF_CORE_FIELDS,
  STUDENT_CORE_FIELDS,
  type CoreField,
} from "./admission-form";
import { configuredAdmissionFormJson, configuredFormJson } from "./admission-form-config";

type Db = Prisma.TransactionClient | typeof prisma;
export type Answers = Record<string, string>;
type Row = { fieldId: string; valueText: string };

/** Include for findMany / findUnique: the person's own-field rows. */
export const FIELD_VALUES_INCLUDE = { fieldValues: { select: { fieldId: true, valueText: true } } } as const;

function coreFor<T extends string>(fieldId: string, core: Record<T, CoreField>, legacy: Record<string, T>): { id: T; field: CoreField } | null {
  const id = (Object.prototype.hasOwnProperty.call(core, fieldId) ? fieldId : legacy[fieldId]) as T | undefined;
  return id ? { id, field: core[id] } : null;
}

function toColumn(field: CoreField, raw: string): string | number | null {
  const v = String(raw ?? "").trim();
  if (field.kind === "yesno") return /^(yes|y|true|1|haan|ha)$/i.test(v) ? "Yes" : /^(no|n|false|0|nahi)$/i.test(v) ? "No" : "";
  if (field.kind === "int") {
    const n = Number.parseInt(v, 10);
    return v && Number.isFinite(n) && n >= 0 && n < 100 ? n : null;
  }
  return v.slice(0, field.type === "textarea" || field.type === "file" ? 1000 : 200);
}

function fromColumn(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function typed(type: string | undefined, raw: string) {
  const valueText = String(raw ?? "").trim().slice(0, 2000);
  const n = Number(valueText);
  return {
    valueText,
    valueNumber: type === "number" && valueText && Number.isFinite(n) ? n : null,
    valueDate: type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? valueText : type === "month" && /^\d{4}-\d{2}$/.test(valueText) ? `${valueText}-01` : null,
  };
}

export async function studentFieldTypes() {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { admissionFormJson: true } });
  return new Map(admissionFormFields(await configuredAdmissionFormJson(config?.admissionFormJson)).map((f) => [f.id, f.type as string]));
}

export async function staffFieldTypes() {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { staffOnboardingFormJson: true } });
  return new Map(staffOnboardingFormFields(await configuredFormJson("staff", config?.staffOnboardingFormJson)).map((f) => [f.id, f.type as string]));
}

/** Splits answers into a column patch and own-field answers. A core id wins over its old custom id. */
function split<T extends string>(answers: Answers, core: Record<T, CoreField>, legacy: Record<string, T>) {
  const columns: Record<string, string | number | null> = {};
  const own: Answers = {};
  const byCoreId = new Set<string>();
  for (const [fieldId, raw] of Object.entries(answers)) {
    const hit = coreFor(fieldId, core, legacy);
    if (!hit) {
      own[fieldId] = String(raw ?? "");
      continue;
    }
    const direct = fieldId === hit.id;
    if (!direct && byCoreId.has(hit.id)) continue;
    if (direct) byCoreId.add(hit.id);
    columns[hit.field.column] = toColumn(hit.field, String(raw ?? ""));
  }
  return { columns, own };
}

type SaveOptions = {
  orgId: string | null;
  actorId?: string | null;
  answers: Answers;
  /** Whole form saved: own-field rows not in `answers` are removed (uploaded files are kept). */
  replace?: boolean;
  types?: Map<string, string>;
};

/** Saves a student's answers: core ones into Student columns, the rest into StudentFieldValue ("" removes). */
export async function saveStudentAnswers(db: Db, studentId: string, options: SaveOptions) {
  const { columns, own } = split(options.answers, STUDENT_CORE_FIELDS, LEGACY_STUDENT_CORE_IDS);
  const types = options.types ?? (await studentFieldTypes());
  if (Object.keys(columns).length) await db.student.update({ where: { id: studentId }, data: columns });
  const keep: string[] = [];
  for (const [fieldId, raw] of Object.entries(own)) {
    const value = typed(types.get(fieldId), raw);
    if (!value.valueText) {
      await db.studentFieldValue.deleteMany({ where: { studentId, fieldId } });
      continue;
    }
    keep.push(fieldId);
    await db.studentFieldValue.upsert({
      where: { studentId_fieldId: { studentId, fieldId } },
      create: { orgId: options.orgId, studentId, fieldId, ...value, createdById: options.actorId ?? null, updatedById: options.actorId ?? null },
      update: { ...value, updatedById: options.actorId ?? null },
    });
  }
  if (options.replace) {
    const files = [...types.entries()].filter(([, type]) => type === "file").map(([id]) => id);
    await db.studentFieldValue.deleteMany({ where: { studentId, fieldId: { notIn: [...keep, ...files] } } });
  }
}

/** A student's answers as { fieldId: value }: own-field rows plus filled core columns under their core ids. */
export function studentAnswersFrom(row: object): Answers {
  const r = row as { fieldValues?: Row[] } & Record<string, unknown>;
  const out: Answers = {};
  for (const v of r.fieldValues ?? []) if (v.valueText) out[v.fieldId] = v.valueText;
  for (const [id, field] of Object.entries(STUDENT_CORE_FIELDS)) {
    const value = fromColumn(r[field.column]);
    if (value) out[id] = value;
  }
  return out;
}

export async function readStudentAnswers(studentId: string): Promise<Answers> {
  const row = await prisma.student.findFirst({ where: { id: studentId }, include: FIELD_VALUES_INCLUDE });
  return row ? studentAnswersFrom(row) : {};
}

/** Saves a teacher's / staff member's onboarding answers: core ones into their columns, the rest into StaffFieldValue. */
export async function saveStaffAnswers(db: Db, kind: "teacher" | "staff", id: string, options: SaveOptions) {
  const { columns, own } = split(options.answers, STAFF_CORE_FIELDS, LEGACY_STAFF_CORE_IDS);
  const types = options.types ?? (await staffFieldTypes());
  // The built-in "Highest qualification" answer has its own column on both.
  if (Object.prototype.hasOwnProperty.call(own, "qualification")) {
    const q = String(own.qualification || "").trim().slice(0, 200);
    columns.qualification = kind === "teacher" ? q || null : q;
    delete own.qualification;
  }
  if (Object.keys(columns).length) {
    if (kind === "teacher") await db.teacher.update({ where: { id }, data: columns });
    else await db.staffMember.update({ where: { id }, data: columns });
  }
  const owner = kind === "teacher" ? { teacherId: id } : { staffMemberId: id };
  const keep: string[] = [];
  for (const [fieldId, raw] of Object.entries(own)) {
    const value = typed(types.get(fieldId), raw);
    if (!value.valueText) {
      await db.staffFieldValue.deleteMany({ where: { ...owner, fieldId } });
      continue;
    }
    keep.push(fieldId);
    const where = kind === "teacher" ? { teacherId_fieldId: { teacherId: id, fieldId } } : { staffMemberId_fieldId: { staffMemberId: id, fieldId } };
    await db.staffFieldValue.upsert({
      where,
      create: { orgId: options.orgId, ...owner, fieldId, ...value, createdById: options.actorId ?? null, updatedById: options.actorId ?? null },
      update: { ...value, updatedById: options.actorId ?? null },
    });
  }
  if (options.replace) {
    const files = [...types.entries()].filter(([, type]) => type === "file").map(([fid]) => fid);
    await db.staffFieldValue.deleteMany({ where: { ...owner, fieldId: { notIn: [...keep, ...files] } } });
  }
}

/** A teacher's / staff member's answers as { fieldId: value }, the same way as studentAnswersFrom. */
export function staffAnswersFrom(row: object): Answers {
  const r = row as { fieldValues?: Row[] } & Record<string, unknown>;
  const out: Answers = {};
  for (const v of r.fieldValues ?? []) if (v.valueText) out[v.fieldId] = v.valueText;
  for (const [id, field] of Object.entries(STAFF_CORE_FIELDS)) {
    const value = fromColumn(r[field.column]);
    if (value) out[id] = value;
  }
  const qualification = fromColumn(r.qualification);
  if (qualification) out.qualification = qualification;
  return out;
}
