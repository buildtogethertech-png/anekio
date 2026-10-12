export type SubjectLabelInput = { code?: string | null; name?: string | null };

const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export function normalizeSubjectCode(raw: string | null | undefined) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

export function formatSubjectLabel(code?: string | null, name?: string | null) {
  const displayName = String(name || "").trim();
  const normalized = normalizeSubjectCode(code);
  const valid =
    normalized.length >= 2 &&
    normalized.length <= 12 &&
    CODE_PATTERN.test(normalized) &&
    !normalized.startsWith("-") &&
    !normalized.endsWith("-") &&
    !normalized.includes("--");
  if (valid) return displayName ? `${normalized} · ${displayName}` : normalized;
  return displayName;
}

export function subjectLabel(subject?: SubjectLabelInput | string | null) {
  if (!subject) return "";
  if (typeof subject === "string") return subject;
  return formatSubjectLabel(subject.code, subject.name);
}

export function skillMatchesSubject(skillName: string, subject: SubjectLabelInput) {
  const skill = skillName.trim().toLowerCase();
  if (!skill) return false;
  const normalized = normalizeSubjectCode(subject.code);
  const valid =
    normalized.length >= 2 &&
    normalized.length <= 12 &&
    CODE_PATTERN.test(normalized);
  if (valid && skill === normalized.toLowerCase()) return true;
  return skill === String(subject.name || "").trim().toLowerCase();
}
