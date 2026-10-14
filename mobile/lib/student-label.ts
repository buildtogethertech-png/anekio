export function rollLabel(rollNumber?: number | null) {
  return rollNumber ? `Roll ${rollNumber}` : "";
}

export function studentMetaLine(input: {
  classLabel?: string | null;
  rollNumber?: number | null;
  admissionNo?: string | null;
}) {
  return [input.classLabel, rollLabel(input.rollNumber), input.admissionNo].filter(Boolean).join(" · ");
}

export function compareByRollThenName(
  a: { name: string; rollNumber?: number | null },
  b: { name: string; rollNumber?: number | null }
) {
  const left = Number(a.rollNumber) || 0;
  const right = Number(b.rollNumber) || 0;
  if (left !== right) {
    if (!left) return 1;
    if (!right) return -1;
    return left - right;
  }
  return a.name.localeCompare(b.name);
}

export function matchesStudentQuery(
  student: { name: string; rollNumber?: number | null; admissionNo?: string | null },
  query: string
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (student.name.toLowerCase().includes(needle)) return true;
  if (String(student.admissionNo || "").toLowerCase().includes(needle)) return true;
  if (student.rollNumber == null) return false;
  const roll = String(student.rollNumber);
  return roll === needle || roll.includes(needle) || `roll ${roll}`.includes(needle);
}
