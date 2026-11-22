/**
 * Students → Table → "Edit as sheet": many students' main fields saved in one go.
 * Each row goes through the same rules as editing one student file (updateStudentCore), so mobile, email and
 * parent checks stay in one place. Custom admission-form fields (text-like ones, not files) are merged into the
 * student's admission data. A row that fails is reported back and does not stop the others.
 */
import { prisma } from "./prisma";
import type { AccessUser } from "./permissions";
import { updateStudentCore } from "./core-actions";
import { admissionFormFields } from "./admission-form";
import { configuredAdmissionFormJson } from "./admission-form-config";
import { assertStudentAccess, CLASS_STUDENTS_EDIT } from "./class-teacher-access";
import { saveStudentAnswers, studentFieldTypes } from "./custom-fields";

export const BULK_STUDENT_MAX_ROWS = 200;

const CORE_KEYS = ["name", "dateOfBirth", "parentName", "parentPhone", "parentEmail", "address", "city", "state", "pincode"] as const;
type CoreKey = (typeof CORE_KEYS)[number];
const EDITABLE_CUSTOM_TYPES = new Set(["text", "email", "phone", "number", "date", "month", "textarea", "select", "radio"]);

type BulkRow = { studentId?: string; fields?: Partial<Record<CoreKey, string>> & { custom?: Record<string, string> } };

function ymd(d: Date | null | undefined) {
  return d ? d.toISOString().slice(0, 10) : "";
}

function cleanDate(value: string) {
  const v = value.trim();
  if (!v) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) {
    throw new Error("Date of birth must be like 2015-08-24.");
  }
  if (v > new Date().toISOString().slice(0, 10)) throw new Error("Date of birth cannot be in the future.");
  return v;
}

export async function bulkUpdateStudentsCore(user: AccessUser, input: { rows?: BulkRow[] }) {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) throw new Error("Nothing to save.");
  if (rows.length > BULK_STUDENT_MAX_ROWS) throw new Error(`Save at most ${BULK_STUDENT_MAX_ROWS} students at a time.`);

  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { admissionFormJson: true } });
  const types = await studentFieldTypes();
  const customFields = new Map(
    admissionFormFields(await configuredAdmissionFormJson(config?.admissionFormJson))
      .filter((f) => !f.builtin && EDITABLE_CUSTOM_TYPES.has(f.type))
      .map((f) => [f.id, f])
  );

  const results: { studentId: string; ok: boolean; error?: string }[] = [];
  for (const row of rows) {
    const studentId = String(row?.studentId || "");
    try {
      if (!studentId) throw new Error("Student missing");
      const fields = row.fields || {};
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        include: { parent: { include: { user: true } }, interests: { select: { tag: true } } },
      });
      if (!student) throw new Error("Student missing");

      const coreChanged = CORE_KEYS.some((k) => typeof fields[k] === "string");
      if (coreChanged) {
        const pick = (k: CoreKey, current: string) => (typeof fields[k] === "string" ? String(fields[k]).trim() : current);
        const parentEmail = student.parent?.user.email || "";
        await updateStudentCore(user, {
          studentId,
          name: pick("name", student.name),
          admissionNo: student.admissionNo,
          classId: student.classId,
          parentId: student.parentId || "",
          dateOfBirth: typeof fields.dateOfBirth === "string" ? cleanDate(fields.dateOfBirth) : ymd(student.dateOfBirth),
          tags: student.interests.map((i) => i.tag),
          parentName: pick("parentName", student.parent?.user.name || ""),
          parentEmail: pick("parentEmail", parentEmail.endsWith("@mobile.local") ? "" : parentEmail),
          parentPhone: pick("parentPhone", student.parent?.phone || student.parent?.user.phone || ""),
          address: pick("address", student.parent?.address || ""),
          city: pick("city", student.parent?.city || ""),
          state: pick("state", student.parent?.state || ""),
          pincode: pick("pincode", student.parent?.pincode || ""),
        });
      }

      const custom = fields.custom && typeof fields.custom === "object" ? fields.custom : null;
      if (custom && Object.keys(custom).length) {
        await assertStudentAccess(user, studentId, [CLASS_STUDENTS_EDIT]);
        const answers: Record<string, string> = {};
        for (const [id, raw] of Object.entries(custom)) {
          const field = customFields.get(id);
          if (!field) throw new Error("That field is not on the admission form.");
          let value = String(raw ?? "").trim().slice(0, 500);
          if (value && (field.type === "select" || field.type === "radio")) {
            const match = field.options.find((o) => o.toLowerCase() === value.toLowerCase());
            if (!match) throw new Error(`${field.label}: pick one of ${field.options.join(", ")}.`);
            value = match;
          }
          answers[id] = value;
        }
        // Straight to the Student column (core fields) or a StudentFieldValue row (the school's own fields).
        await saveStudentAnswers(prisma, studentId, { orgId: student.orgId ?? null, actorId: user.id, answers, types });
      }
      results.push({ studentId, ok: true });
    } catch (e) {
      results.push({ studentId, ok: false, error: e instanceof Error ? e.message : "Could not save." });
    }
  }
  return { saved: results.filter((r) => r.ok).length, results };
}
