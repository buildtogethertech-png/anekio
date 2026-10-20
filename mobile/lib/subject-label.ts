export type SubjectLabelInput = { code?: string | null; name?: string | null };

export function normalizeSubjectCode(raw: string | null | undefined) {
  return String(raw || "")
    .trim()
    .toUpperCase();
}

export function formatSubjectLabel(code?: string | null, name?: string | null) {
  const displayName = String(name || "").trim();
  if (displayName) return displayName;
  return String(code || "").trim();
}

export function subjectLabel(subject?: SubjectLabelInput | string | null) {
  if (!subject) return "";
  if (typeof subject === "string") return subject;
  return formatSubjectLabel(subject.code, subject.name);
}

export function catalogCodeMatchesGrade(_code: string, _gradeName: string) {
  return true;
}

export function skillMatchesSubject(skillName: string, subject: SubjectLabelInput) {
  const skill = skillName.trim().toLowerCase();
  if (!skill) return false;
  const name = String(subject.name || "").trim().toLowerCase();
  if (name && skill === name) return true;
  const code = normalizeSubjectCode(subject.code);
  return Boolean(code) && skill === code.toLowerCase();
}

export function resolveSkillLabel(
  skillName: string,
  subjects: SubjectLabelInput[],
  catalog: SubjectLabelInput[] = []
) {
  const hit = subjects.find((row) => skillMatchesSubject(skillName, row));
  if (hit?.name) return String(hit.name).trim();
  const skill = skillName.trim().toLowerCase();
  const cat = catalog.find((row) => {
    const name = String(row.name || "").trim().toLowerCase();
    const code = normalizeSubjectCode(row.code);
    return (name && name === skill) || (code && code.toLowerCase() === skill);
  });
  if (cat?.name) {
    const planned = subjects.find((row) => skillMatchesSubject(String(cat.name), row) || skillMatchesSubject(String(cat.code || ""), row));
    return String(planned?.name || cat.name).trim();
  }
  return skillName.trim();
}

export function labeledTeacherSkills<T extends { subjectName: string; classId: string }>(
  skills: T[],
  classes: { id: string; subjects: SubjectLabelInput[] }[]
) {
  const everySubject = classes.flatMap((klass) => klass.subjects);
  return skills.map((skill) => {
    const pool = (skill.classId && classes.find((klass) => klass.id === skill.classId)?.subjects) || everySubject;
    return { ...skill, subjectName: resolveSkillLabel(skill.subjectName, pool) };
  });
}
