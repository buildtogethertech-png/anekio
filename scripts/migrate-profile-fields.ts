/**
 * One-off, local database: moves form answers out of the old JSON blobs into their new home, for every school,
 * the same way the app now saves them (core fields → Student / Teacher / StaffMember columns, the school's own
 * fields → StudentFieldValue / StaffFieldValue), and switches saved forms to the core field ids.
 * Production does the same with scripts/sql/2026-11-22-profile-fields.sql. Safe to run more than once.
 *   npx tsx scripts/migrate-profile-fields.ts
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { runWithoutTenant, setTenantOrg } from "../lib/tenant-context";
import { admissionCustomValues, admissionFormJson, staffOnboardingFormJson } from "../lib/admission-form";
import { saveStaffAnswers, saveStudentAnswers, staffFieldTypes, studentFieldTypes } from "../lib/custom-fields";

function rawJson(text: string | null | undefined): Record<string, string> {
  try {
    const v = text ? JSON.parse(text) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x ?? "")])) : {};
  } catch {
    return {};
  }
}

async function migrateScope(orgId: string | null) {
  const config = await prisma.schoolConfig.findUnique({ where: { id: "school" }, select: { id: true, admissionFormJson: true, staffOnboardingFormJson: true } });
  if (config) {
    const data: Record<string, string> = {};
    try {
      if (config.admissionFormJson && config.admissionFormJson !== "[]") data.admissionFormJson = admissionFormJson(config.admissionFormJson);
    } catch {}
    try {
      if (config.staffOnboardingFormJson && config.staffOnboardingFormJson !== "[]") data.staffOnboardingFormJson = staffOnboardingFormJson(config.staffOnboardingFormJson);
    } catch {}
    if (Object.keys(data).length) await prisma.schoolConfig.update({ where: { id: "school" }, data });
  }
  const [studentTypes, staffTypes] = await Promise.all([studentFieldTypes(), staffFieldTypes()]);
  const org = orgId ? {} : { orgId: null };
  const students = await prisma.student.findMany({ where: { ...org, OR: [{ leftOn: null }, { leftOn: { not: null } }] }, select: { id: true, orgId: true, admissionDataJson: true } });
  for (const s of students) {
    const answers = admissionCustomValues(s.admissionDataJson);
    if (Object.keys(answers).length) await saveStudentAnswers(prisma, s.id, { orgId: s.orgId ?? null, answers, types: studentTypes });
  }
  const teachers = await prisma.teacher.findMany({ where: { ...org, OR: [{ archivedAt: null }, { archivedAt: { not: null } }] }, select: { id: true, orgId: true, onboardingDataJson: true } });
  for (const t of teachers) {
    const answers = rawJson(t.onboardingDataJson);
    if (Object.keys(answers).length) await saveStaffAnswers(prisma, "teacher", t.id, { orgId: t.orgId ?? null, answers, types: staffTypes });
  }
  const staff = await prisma.staffMember.findMany({ where: { ...org, OR: [{ archivedAt: null }, { archivedAt: { not: null } }] }, select: { id: true, orgId: true, onboardingDataJson: true } });
  for (const m of staff) {
    const answers = rawJson(m.onboardingDataJson);
    if (Object.keys(answers).length) await saveStaffAnswers(prisma, "staff", m.id, { orgId: m.orgId ?? null, answers, types: staffTypes });
  }
  return { students: students.length, teachers: teachers.length, staff: staff.length };
}

async function main() {
  const out: Record<string, unknown> = {};
  const orgs = await runWithoutTenant(() => prisma.saasOrg.findMany({ select: { id: true } }));
  for (const o of orgs) {
    out[o.id] = await runWithoutTenant(async () => {
      setTenantOrg(o.id);
      return migrateScope(o.id);
    });
  }
  out.none = await runWithoutTenant(() => migrateScope(null));
  console.log("Moved answers:", JSON.stringify(out));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
