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
