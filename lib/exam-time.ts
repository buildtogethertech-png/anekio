/** "9:00" / "09:00" / "21:30" → "09:00"; anything else → "". */
export function cleanExamTime(raw: unknown) {
  const match = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Both times, or neither; end must be after start. */
export function examTimes(start: unknown, end: unknown) {
  const startTime = cleanExamTime(start);
  const endTime = cleanExamTime(end);
  if (!startTime || !endTime) return { startTime: "", endTime: "" };
  if (endTime <= startTime) throw new Error("Exam end time must be after the start time.");
  return { startTime, endTime };
}
