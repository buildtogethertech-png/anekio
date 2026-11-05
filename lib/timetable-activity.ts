import { formatSubjectLabel } from "./subject-code";

export function cleanActivity(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

/** What a period shows: the subject label, or the activity name, or "—" when empty. */
export function slotLabel(slot: { subject?: { code: string; name: string } | null; activity?: string | null }) {
  if (slot.subject) return formatSubjectLabel(slot.subject.code, slot.subject.name);
  return slot.activity || "—";
}
