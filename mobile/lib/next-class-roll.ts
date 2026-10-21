/** First unused roll in a class (1, then gaps, then max + 1). Matches the server assigner. */
export function nextClassRoll(
  students: { classId?: string | null; rollNumber?: number | null }[],
  classId: string
) {
  if (!classId) return "";
  const used = new Set<number>();
  for (const student of students) {
    if (student.classId !== classId) continue;
    const roll = Number(student.rollNumber);
    if (Number.isInteger(roll) && roll > 0) used.add(roll);
  }
  let next = 1;
  while (used.has(next)) next += 1;
  return String(next);
}
