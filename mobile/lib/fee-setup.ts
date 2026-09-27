export type SessionYearOption = { id: string; label: string };

export function sessionYearId(startsOn?: string, endsOn?: string) {
  const start = Number(String(startsOn || "").slice(0, 4));
  const end = Number(String(endsOn || "").slice(0, 4));
  if (start && end && end > start) return `${start}-${end}`;
  if (start) return `${start}-${start + 1}`;
  return "";
}

export const SESSION_YEAR_OPTIONS: SessionYearOption[] = Array.from({ length: 36 }, (_, index) => {
  const year = 2015 + index;
  return { id: `${year}-${year + 1}`, label: `${year} to ${year + 1}` };
});

export function datesForSessionYear(id: string, startsOn?: string, endsOn?: string) {
  const startYear = Number(id.slice(0, 4));
  const startMd = /^\d{4}-\d{2}-\d{2}$/.test(String(startsOn || "")) ? String(startsOn).slice(5) : "04-01";
  const endMd = /^\d{4}-\d{2}-\d{2}$/.test(String(endsOn || "")) ? String(endsOn).slice(5) : "03-31";
  return { startsOn: `${startYear}-${startMd}`, endsOn: `${startYear + 1}-${endMd}` };
}

export function clampDueDay(value: unknown) {
  return Math.min(31, Math.max(1, Math.round(Number(value) || 10)));
}

export function ordinalDay(day: number) {
  const value = clampDueDay(day);
  const rem = value % 100;
  if (rem >= 11 && rem <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}
