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
  const checked = validateSubjectCode(code || "");
  if (checked.ok) return displayName ? `${checked.code} · ${displayName}` : checked.code;
  return displayName;
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

export function parseSubjectCatalog(raw: string | null | undefined): SubjectCatalogEntry[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_SUBJECT_CATALOG.map((row) => ({ ...row }));
    const entries: SubjectCatalogEntry[] = [];
    const usedCodes = new Set<string>();
    const usedLegacyNames = new Set<string>();
    for (const item of parsed) {
      if (typeof item === "string") {
        const name = item.trim();
        if (!name || usedLegacyNames.has(name.toLowerCase())) continue;
        let code = knownCodeForName(name) || codeFromLegacyName(name, usedCodes);
        if (usedCodes.has(code)) code = codeFromLegacyName(`${name}-${usedCodes.size + 1}`, usedCodes);
        usedCodes.add(code);
        usedLegacyNames.add(name.toLowerCase());
        entries.push({ code, name });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const row = item as { code?: unknown; name?: unknown };
      const name = String(row.name || "").trim();
      if (!name) continue;
      const checked = validateSubjectCode(String(row.code || knownCodeForName(name) || ""));
      const code = checked.ok && !usedCodes.has(checked.code) ? checked.code : codeFromLegacyName(name, usedCodes);
      if (usedCodes.has(code)) continue;
      usedCodes.add(code);
      entries.push({ code, name });
    }
    return entries.length ? entries : DEFAULT_SUBJECT_CATALOG.map((row) => ({ ...row }));
  } catch {
    return DEFAULT_SUBJECT_CATALOG.map((row) => ({ ...row }));
  }
}

export function serializeSubjectCatalog(entries: SubjectCatalogEntry[]) {
  const seenCodes = new Set<string>();
  const rows: SubjectCatalogEntry[] = [];
  for (const entry of entries) {
    const name = String(entry.name || "").trim();
    if (!name) throw new Error("Give every subject a name.");
    const code = requireSubjectCode(entry.code);
    if (seenCodes.has(code)) throw new Error(`Subject code ${code} is already in the catalog.`);
    seenCodes.add(code);
    rows.push({ code, name });
  }
  if (!rows.length) throw new Error("Add at least one subject.");
  return JSON.stringify(rows);
}

export function gradeNameOf(className: string) {
  return String(className || "").trim();
}

export function classLabelOf(className: string, section: string) {
  return `${gradeNameOf(className)}-${String(section || "").trim()}`;
}

export function gradeSubjectCode(base: string, gradeName: string) {
  const code = requireSubjectCode(base);
  const grade = gradeNameOf(gradeName).replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!grade || grade === "1") return code;
  const suffix = `-${grade}`;
  return requireSubjectCode(`${code.slice(0, SUBJECT_CODE_MAX - suffix.length)}${suffix}`);
}

export function formatClassList(labels: string[]) {
  const unique = [...new Set(labels.filter(Boolean))];
  if (unique.length <= 1) return unique[0] || "";
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

export async function assertCodeFitsGrade(input: {
  gradeName: string;
  code: string;
  name: string;
  excludeSubjectId?: string;
}) {
  const gradeName = gradeNameOf(input.gradeName);
  const code = requireSubjectCode(input.code);
  const name = input.name.trim();
  const owners = await prisma.subject.findMany({
    where: {
      code,
      ...(input.excludeSubjectId ? { id: { not: input.excludeSubjectId } } : {}),
    },
    include: { class: { select: { name: true, section: true } } },
  });
  for (const row of owners) {
    const ownerGrade = gradeNameOf(row.class.name);
    const ownerLabel = classLabelOf(row.class.name, row.class.section);
    if (ownerGrade === gradeName) continue;
    throw new Error(
      `${code} is already used by Class ${ownerGrade} (${ownerLabel}). Use a different code for Class ${gradeName}.`
    );
  }
}

export function catalogHasSubject(catalog: SubjectCatalogEntry[], input: { code?: string; name?: string }) {
  const code = input.code ? validateSubjectCode(input.code) : null;
  const name = String(input.name || "").trim().toLowerCase();
  return catalog.some((row) => {
    if (code?.ok && row.code === code.code) return true;
    if (name && row.name.trim().toLowerCase() === name) return true;
    return false;
  });
}

export function matchCatalogEntry(catalog: SubjectCatalogEntry[], input: { code?: string; name?: string }) {
  const code = input.code ? validateSubjectCode(input.code) : null;
  if (code?.ok) {
    const byCode = catalog.find((row) => row.code === code.code);
    if (byCode) return byCode;
  }
  const name = String(input.name || "").trim().toLowerCase();
  if (name) return catalog.find((row) => row.name.trim().toLowerCase() === name) || null;
  return null;
}

export function skillMatchesSubject(skillName: string, subject: { code?: string | null; name?: string | null }) {
  const skill = skillName.trim().toLowerCase();
  if (!skill) return false;
  const code = validateSubjectCode(subject.code || "");
  if (code.ok && skill === code.code.toLowerCase()) return true;
  return skill === String(subject.name || "").trim().toLowerCase();
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
  const code = validateSubjectCode(subject.code || "").ok ? normalizeSubjectCode(subject.code) : "";
  return {
    id: subject.id,
    code,
    name: subject.name,
    weightage: subject.weightage ?? 0,
    label: formatSubjectLabel(code, subject.name),
  };
}

async function tableColumns(table: string) {
  return prisma.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info(${table})`);
}

export async function ensureSubjectCodeColumn() {
  const cols = await tableColumns("Subject");
  if (!cols.some((col) => col.name === "code")) {
    await prisma.$executeRawUnsafe('ALTER TABLE "Subject" ADD COLUMN "code" TEXT NOT NULL DEFAULT ""');
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
  const configs = await prisma.schoolConfig.findMany({ select: { id: true, subjectCatalog: true } });
  const subjectRows = await prisma.subject.findMany({ select: { code: true, name: true } });
  for (const config of configs) {
    const entries = parseSubjectCatalog(config.subjectCatalog);
    const used = new Set(entries.map((row) => row.code));
    for (const row of subjectRows) {
      const checked = validateSubjectCode(row.code);
      if (!checked.ok || used.has(checked.code)) continue;
      entries.push({ code: checked.code, name: row.name });
      used.add(checked.code);
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
