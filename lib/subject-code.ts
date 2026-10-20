import { prisma } from "./prisma";

export type SubjectCatalogEntry = { code: string; name: string };

export const SUBJECT_CODE_MIN = 2;
export const SUBJECT_CODE_MAX = 12;

export const KNOWN_SUBJECT_CODES: Record<string, string> = {
  english: "ENG",
  mathematics: "MAT",
  maths: "MAT",
  math: "MAT",
  science: "SCI",
  hindi: "HIN",
  "social studies": "SST",
  "social science": "SST",
  computer: "CSC",
  "computer science": "CSC",
  art: "ART",
  arts: "ART",
  "physical education": "PED",
  pe: "PED",
  physics: "PHY",
  chemistry: "CHE",
  biology: "BIO",
};

export const DEFAULT_SUBJECT_CATALOG: SubjectCatalogEntry[] = [
  { code: "ENG", name: "English" },
  { code: "MAT", name: "Mathematics" },
  { code: "SCI", name: "Science" },
  { code: "HIN", name: "Hindi" },
  { code: "SST", name: "Social Studies" },
  { code: "CSC", name: "Computer" },
  { code: "ART", name: "Art" },
  { code: "PED", name: "Physical Education" },
];

const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export function normalizeSubjectCode(raw: string | null | undefined) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

export function validateSubjectCode(raw: string | null | undefined) {
  const code = normalizeSubjectCode(raw);
  if (code.length < SUBJECT_CODE_MIN || code.length > SUBJECT_CODE_MAX) {
    return { ok: false as const, code, error: "Subject code must be 2–12 characters." };
  }
  if (code.startsWith("-") || code.endsWith("-") || code.includes("--") || !CODE_PATTERN.test(code)) {
    return { ok: false as const, code, error: "Use letters, numbers, and single hyphens only." };
  }
  return { ok: true as const, code };
}

export function requireSubjectCode(raw: string | null | undefined) {
  const checked = validateSubjectCode(raw);
  if (!checked.ok) throw new Error(checked.error);
  return checked.code;
}

export function formatSubjectLabel(code?: string | null, name?: string | null) {
  const displayName = String(name || "").trim();
  if (displayName) return displayName;
  return String(code || "").trim();
}

export function knownCodeForName(name: string) {
  return KNOWN_SUBJECT_CODES[name.trim().toLowerCase()] || "";
}

export function catalogEntryFromName(name: string): SubjectCatalogEntry {
  const trimmed = name.trim();
  const mapped = knownCodeForName(trimmed);
  if (mapped) return { code: mapped, name: trimmed };
  return { code: codeFromLegacyName(trimmed, new Set()), name: trimmed };
}

export function codeFromLegacyName(name: string, used: Set<string>) {
  const mapped = knownCodeForName(name);
  if (mapped && !used.has(mapped) && validateSubjectCode(mapped).ok) return mapped;
  const compact = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, SUBJECT_CODE_MAX);
  let base = compact.length >= SUBJECT_CODE_MIN ? compact : `SUB${compact}`.slice(0, SUBJECT_CODE_MAX);
  if (base.length < SUBJECT_CODE_MIN) base = "SUB";
  if (!used.has(base) && validateSubjectCode(base).ok) return base;
  let n = 2;
  while (n < 1000) {
    const suffix = `-${n}`;
    const next = `${base.slice(0, SUBJECT_CODE_MAX - suffix.length)}${suffix}`;
    if (validateSubjectCode(next).ok && !used.has(next)) return next;
    n += 1;
  }
  return `SUB${Date.now().toString(36).toUpperCase()}`.slice(0, SUBJECT_CODE_MAX);
}

export function isBakedDefaultCatalog(entries: SubjectCatalogEntry[]) {
  if (entries.length !== DEFAULT_SUBJECT_CATALOG.length) return false;
  const expected = new Set(DEFAULT_SUBJECT_CATALOG.map((row) => row.name.trim().toLowerCase()));
  return entries.every((row) => expected.has(row.name.trim().toLowerCase()));
}

/** New orgs used to inherit the CBSE starter list. Drop it when the school has not used any subjects yet. */
export async function emptyUnusedBakedSubjectCatalog(orgId?: string | null) {
  if (!orgId) return;
  const config = await prisma.schoolConfig.findFirst({
    where: { orgId },
    select: { id: true, subjectCatalog: true },
  });
  if (!config) return;
  const catalog = parseSubjectCatalog(config.subjectCatalog);
  if (!isBakedDefaultCatalog(catalog)) return;
  const used = await prisma.subject.count({ where: { orgId } });
  if (used) return;
  await prisma.schoolConfig.update({ where: { id: config.id }, data: { subjectCatalog: "[]" } });
}

export async function subjectCatalogForSchool(config?: { id?: string; orgId?: string | null; subjectCatalog?: string } | null) {
  if (!config) return [];
  const catalog = parseSubjectCatalog(config.subjectCatalog);
  if (!isBakedDefaultCatalog(catalog) || !config.orgId) return catalog;
  const used = await prisma.subject.count({ where: { orgId: config.orgId } });
  if (used) return catalog;
  if (config.id) {
    await prisma.schoolConfig.update({ where: { id: config.id }, data: { subjectCatalog: "[]" } });
  }
  return [];
}

export function parseSubjectCatalog(raw: string | null | undefined): SubjectCatalogEntry[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const entries: SubjectCatalogEntry[] = [];
    const usedCodes = new Set<string>();
    const usedNames = new Set<string>();
    for (const item of parsed) {
      let name = "";
      let storedCode = "";
      if (typeof item === "string") {
        name = item.trim();
      } else if (item && typeof item === "object") {
        const row = item as { code?: unknown; name?: unknown };
        name = String(row.name || "").trim();
        storedCode = String(row.code || "").trim();
      }
      if (!name || usedNames.has(name.toLowerCase())) continue;
      usedNames.add(name.toLowerCase());
      const checked = validateSubjectCode(storedCode || knownCodeForName(name) || "");
      const code = checked.ok && !usedCodes.has(checked.code) ? checked.code : codeFromLegacyName(name, usedCodes);
      usedCodes.add(code);
      entries.push({ code, name });
    }
    return entries;
  } catch {
    return [];
  }
}

export function serializeSubjectCatalog(entries: SubjectCatalogEntry[]) {
  const seen = new Set<string>();
  const rows: { name: string }[] = [];
  for (const entry of entries) {
    const name = String(entry.name || "").trim();
    if (!name) throw new Error("Give every subject a name.");
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`${name} is already in the catalog.`);
    seen.add(key);
    rows.push({ name });
  }
  return JSON.stringify(rows);
}

export function gradeNameOf(className: string) {
  return String(className || "").trim();
}

export function classLabelOf(className: string, section: string) {
  return `${gradeNameOf(className)}-${String(section || "").trim()}`;
}

export function gradeTokenOf(gradeName: string) {
  return gradeNameOf(gradeName).replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

export function gradeSubjectCode(base: string, gradeName: string) {
  const code = requireSubjectCode(base);
  const grade = gradeTokenOf(gradeName);
  if (!grade || grade === "1") return code;
  const suffix = `-${grade}`;
  return requireSubjectCode(`${code.slice(0, SUBJECT_CODE_MAX - suffix.length)}${suffix}`);
}

/** SAN-5 belongs on Class 5; unsuffixed ENG belongs on Class 1. */
export function catalogCodeMatchesGrade(code: string, gradeName: string) {
  const token = gradeTokenOf(gradeName);
  const checked = validateSubjectCode(code);
  if (!token || !checked.ok) return false;
  if (token === "1") return !checked.code.includes("-") || checked.code.endsWith("-1");
  return checked.code.endsWith(`-${token}`);
}

export function formatClassList(labels: string[]) {
  const unique = [...new Set(labels.filter(Boolean))];
  if (unique.length <= 1) return unique[0] || "";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

export async function assertCodeFitsGrade(_input: {
  gradeName: string;
  code: string;
  name: string;
  excludeSubjectId?: string;
}) {
  return;
}

export function catalogHasSubject(catalog: SubjectCatalogEntry[], input: { code?: string; name?: string }) {
  return Boolean(matchCatalogEntry(catalog, input));
}

export function matchCatalogEntry(catalog: SubjectCatalogEntry[], input: { code?: string; name?: string }) {
  const name = String(input.name || "").trim().toLowerCase();
  if (name) {
    const byName = catalog.find((row) => row.name.trim().toLowerCase() === name);
    if (byName) return byName;
  }
  const code = input.code ? validateSubjectCode(input.code) : null;
  if (code?.ok) return catalog.find((row) => row.code === code.code) || null;
  const asName = String(input.code || "").trim().toLowerCase();
  if (asName) return catalog.find((row) => row.name.trim().toLowerCase() === asName) || null;
  return null;
}

export function skillMatchesSubject(skillName: string, subject: { code?: string | null; name?: string | null }) {
  const skill = skillName.trim().toLowerCase();
  if (!skill) return false;
  const code = validateSubjectCode(subject.code || "");
  if (code.ok && skill === code.code.toLowerCase()) return true;
  return skill === String(subject.name || "").trim().toLowerCase();
}

export function resolveSkillLabel(
  skillName: string,
  subjects: { code?: string | null; name: string }[],
  catalog: SubjectCatalogEntry[] = []
) {
  const hit = matchClassSubject(subjects, { subjectName: skillName, code: skillName });
  if (hit) return hit.name;
  const cat = matchCatalogEntry(catalog, { name: skillName, code: skillName });
  if (cat) {
    const planned = matchClassSubject(subjects, { code: cat.code, subjectName: cat.name });
    return planned?.name || cat.name;
  }
  return String(skillName || "").trim();
}

export function labeledTeacherSkills<T extends { subjectName: string; classId: string }>(
  skills: T[],
  classes: { id: string; subjects: { code?: string | null; name: string }[] }[],
  catalog: SubjectCatalogEntry[] = []
) {
  const everySubject = classes.flatMap((klass) => klass.subjects);
  return skills.map((skill) => {
    const pool = (skill.classId && classes.find((klass) => klass.id === skill.classId)?.subjects) || everySubject;
    return { ...skill, subjectName: resolveSkillLabel(skill.subjectName, pool, catalog) };
  });
}

export async function reconcileTeacherSkillNames(aliases: { from: string; to: string }[] = []) {
  const skills = await prisma.teacherSkill.findMany();
  const wanted = new Map<string, string>();
  for (const alias of aliases) {
    const from = alias.from.trim();
    const to = alias.to.trim();
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue;
    wanted.set(from, to);
  }
  const subjects = await prisma.subject.findMany({ select: { classId: true, code: true, name: true } });
  const byClass = new Map<string, { classId: string; code: string; name: string }[]>();
  for (const row of subjects) {
    byClass.set(row.classId, [...(byClass.get(row.classId) || []), row]);
  }
  for (const skill of skills) {
    const next =
      wanted.get(skill.subjectName) ||
      resolveSkillLabel(skill.subjectName, byClass.get(skill.classId) || []);
    if (!next || next === skill.subjectName) continue;
    const clash = skills.some(
      (row) =>
        row.id !== skill.id &&
        row.teacherId === skill.teacherId &&
        row.classId === skill.classId &&
        row.subjectName === next
    );
    try {
      if (clash) {
        await prisma.teacherSkill.delete({ where: { id: skill.id } });
        skill.subjectName = next;
        continue;
      }
      await prisma.teacherSkill.update({ where: { id: skill.id }, data: { subjectName: next } });
      skill.subjectName = next;
    } catch {
      // Leftover rows without a tenant org still display via labeledTeacherSkills.
    }
  }
}

export function matchClassSubject<T extends { id: string; code?: string | null; name: string }>(
  subjects: T[],
  input: { subjectId?: string | null; code?: string | null; subjectName?: string | null }
) {
  if (input.subjectId) {
    const byId = subjects.find((row) => row.id === input.subjectId);
    if (byId) return byId;
  }
  const code = input.code ? validateSubjectCode(input.code) : null;
  if (code?.ok) {
    const byCode = subjects.find((row) => validateSubjectCode(row.code || "").ok && normalizeSubjectCode(row.code) === code.code);
    if (byCode) return byCode;
  }
  const skill = String(input.subjectName || input.code || "").trim();
  if (skill) {
    const bySkill = subjects.find((row) => skillMatchesSubject(skill, row));
    if (bySkill) return bySkill;
  }
  return null;
}

export function subjectDto(subject: { id: string; code?: string | null; name: string; weightage?: number | null }) {
  return {
    id: subject.id,
    code: subject.code || "",
    name: subject.name,
    weightage: subject.weightage ?? 0,
    label: formatSubjectLabel(subject.code, subject.name),
  };
}

async function tableColumns(table: string) {
  // Works on local SQLite and production Postgres.
  if (/^postgres(?:ql)?:\/\//i.test(String(process.env.DATABASE_URL || ""))) {
    return prisma.$queryRawUnsafe<{ name: string }[]>(
      "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1",
      table
    );
  }
  return prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info(${table})`);
}

export async function ensureSubjectCodeColumn() {
  const cols = await tableColumns("Subject");
  if (!cols.some((col) => col.name === "code")) {
    // '' is an empty string; "" would be an (invalid) empty identifier in Postgres.
    await prisma.$executeRawUnsafe(`ALTER TABLE "Subject" ADD COLUMN "code" TEXT NOT NULL DEFAULT ''`);
  }
}

export async function backfillSubjectCodes() {
  const subjects = await prisma.subject.findMany({
    select: { id: true, classId: true, name: true, code: true },
    orderBy: [{ classId: "asc" }, { name: "asc" }],
  });
  const usedByClass = new Map<string, Set<string>>();
  for (const row of subjects) {
    const used = usedByClass.get(row.classId) || new Set<string>();
    const current = validateSubjectCode(row.code || "");
    if (current.ok) used.add(current.code);
    usedByClass.set(row.classId, used);
  }
  for (const row of subjects) {
    const used = usedByClass.get(row.classId) || new Set<string>();
    const current = validateSubjectCode(row.code || "");
    if (current.ok && [...subjects.filter((s) => s.classId === row.classId && s.id !== row.id)].every((other) => normalizeSubjectCode(other.code) !== current.code)) {
      continue;
    }
    const next = codeFromLegacyName(row.name, used);
    used.add(next);
    usedByClass.set(row.classId, used);
    await prisma.subject.update({ where: { id: row.id }, data: { code: next } });
  }
}

export async function resolveDuplicateClassSubjectNames() {
  const subjects = await prisma.subject.findMany({
    select: { id: true, classId: true, name: true },
    orderBy: [{ classId: "asc" }, { name: "asc" }, { id: "asc" }],
  });
  const seen = new Map<string, number>();
  for (const row of subjects) {
    const key = `${row.classId}::${row.name.trim().toLowerCase()}`;
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    if (count === 0) continue;
    await prisma.subject.update({
      where: { id: row.id },
      data: { name: `${row.name} ${count + 1}` },
    });
  }
}

export async function resolveCrossGradeSubjectCodes() {
  const subjects = await prisma.subject.findMany({
    include: { class: { select: { name: true, section: true } } },
    orderBy: [{ classId: "asc" }, { name: "asc" }],
  });
  const ownerGrade = new Map<string, string>();
  for (const row of subjects) {
    const checked = validateSubjectCode(row.code);
    if (!checked.ok) continue;
    const grade = gradeNameOf(row.class.name);
    const held = ownerGrade.get(checked.code);
    if (!held) {
      ownerGrade.set(checked.code, grade);
      continue;
    }
    if (held === grade) continue;
    const used = new Set(
      subjects
        .filter((item) => gradeNameOf(item.class.name) === grade)
        .map((item) => normalizeSubjectCode(item.code))
        .filter(Boolean)
    );
    let next = gradeSubjectCode(checked.code, grade);
    if (used.has(next)) next = codeFromLegacyName(`${row.name}-${grade}`, used);
    await prisma.subject.update({ where: { id: row.id }, data: { code: next } });
    await prisma.teacherSkill.updateMany({
      where: { classId: row.classId, subjectName: { in: [checked.code, row.name] } },
      data: { subjectName: next },
    });
    row.code = next;
    used.add(next);
  }
}

export async function ensureSubjectCodeSchema() {
  await ensureSubjectCodeColumn();
  await resolveDuplicateClassSubjectNames();
  await backfillSubjectCodes();
  await resolveCrossGradeSubjectCodes();
  const configs = await prisma.schoolConfig.findMany({ select: { id: true, orgId: true, subjectCatalog: true } });
  const subjectRows = await prisma.subject.findMany({ select: { code: true, name: true, orgId: true } });
  for (const config of configs) {
    const entries = parseSubjectCatalog(config.subjectCatalog);
    const used = new Set(entries.map((row) => row.code));
    for (const row of subjectRows) {
      if (config.orgId && row.orgId && row.orgId !== config.orgId) continue;
      if (entries.some((entry) => entry.name.trim().toLowerCase() === row.name.trim().toLowerCase())) continue;
      const next = catalogEntryFromName(row.name);
      if (used.has(next.code)) next.code = codeFromLegacyName(row.name, used);
      entries.push(next);
      used.add(next.code);
    }
    await prisma.schoolConfig.update({
      where: { id: config.id },
      data: { subjectCatalog: JSON.stringify(entries) },
    });
  }
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "Subject_classId_code_key" ON "Subject"("classId", "code")'
  );
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS "Subject_classId_name_key" ON "Subject"("classId", "name")'
  );
}
