/** First unused roll in a class (1, then gaps, then max + 1). Matches the server assigner. */
export function nextClassRoll(
  students: { classId?: string | null; rollNumber?: number | null }[],
  classId: string,
  /** Rolls the server already holds for this class (also students who left), from the record's classes. */
  taken: number[] = []
) {
  if (!classId) return "";
  const used = new Set<number>(taken.filter((roll) => Number.isInteger(roll) && roll > 0));
  for (const student of students) {
    if (student.classId !== classId) continue;
    const roll = Number(student.rollNumber);
    if (Number.isInteger(roll) && roll > 0) used.add(roll);
  }
  let next = 1;
  while (used.has(next)) next += 1;
  return String(next);
}
