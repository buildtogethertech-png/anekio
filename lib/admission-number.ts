/**
 * Admission numbers.
 *
 * - Onboarding import keeps the school's own numbers exactly as given.
 * - After that every new student gets the next number automatically:
 *   highest serial + 1. The serial is the LAST group of digits ("ADM-0226" → 226, "2024/1532" → 1532).
 *   Gaps are never refilled.
 * - The school can set the look (format + padding) and a "next number at least" floor, never the counting.
 */

export type AdmissionNoSettings = {
  /** Template with {N} (serial) and optional {YYYY}/{YY} (session start year). Empty = copy the last number's look. */
  format: string;
  /** Zero padding for {N}. 0 = copy the last number's padding. */
  digits: number;
  /** Next serial is at least this. 0 = no floor. */
  floor: number;
};

export const DEFAULT_ADMISSION_FORMAT = "ADM-{N}";
export const DEFAULT_ADMISSION_DIGITS = 4;

/** Last group of digits in an admission number, or null when it has none. */
export function serialOf(admissionNo: string): number | null {
  const match = String(admissionNo || "").match(/(\d+)(?!.*\d)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) ? n : null;
}

/** "ADM-0226" → { format: "ADM-{N}", digits: 4 }. Text after the serial is kept too ("12/A" → "{N}/A"). */
export function patternOf(sample: string): { format: string; digits: number } {
  const value = String(sample || "");
  const match = value.match(/(\d+)(?!.*\d)/);
  if (!match || match.index === undefined) return { format: DEFAULT_ADMISSION_FORMAT, digits: DEFAULT_ADMISSION_DIGITS };
  const before = value.slice(0, match.index).replace(/[{}]/g, "");
  const after = value.slice(match.index + match[1].length).replace(/[{}]/g, "");
  return { format: `${before}{N}${after}`, digits: match[1].length };
}

export function cleanAdmissionFormat(raw: unknown) {
  const value = String(raw ?? "").replace(/[\r\n\t]/g, "").trim().slice(0, 30);
  if (!value) return "";
  return value.includes("{N}") ? value : `${value}{N}`;
}

export function formatAdmissionNo(format: string, serial: number, digits: number, sessionYear: number) {
  const template = cleanAdmissionFormat(format) || DEFAULT_ADMISSION_FORMAT;
  const n = String(Math.max(0, Math.floor(serial))).padStart(Math.max(0, Math.min(8, Math.floor(digits) || 0)), "0");
  return template
    .replace(/\{YYYY\}/g, String(sessionYear))
    .replace(/\{YY\}/g, String(sessionYear).slice(-2))
    .replace(/\{N\}/g, n);
}

export type AdmissionPlan = {
  admissionNo: string;
  serial: number;
  /** Highest serial in use (0 when none). */
  highestSerial: number;
  /** The number the look was copied from, when no format is set. */
  lastNo: string;
  format: string;
  digits: number;
};

/** Pure: the next admission number for a school, given every number already in use. */
export function planNextAdmissionNo(
  existing: string[],
  settings: AdmissionNoSettings,
  sessionYear: number,
  taken: Set<string> = new Set(existing.map((no) => no.trim().toUpperCase()))
): AdmissionPlan {
  let highestSerial = 0;
  let lastNo = "";
  for (const no of existing) {
    const serial = serialOf(no);
    if (serial !== null && serial >= highestSerial) {
      highestSerial = serial;
      lastNo = no;
    }
  }
  const learned = lastNo ? patternOf(lastNo) : { format: DEFAULT_ADMISSION_FORMAT, digits: DEFAULT_ADMISSION_DIGITS };
  const format = cleanAdmissionFormat(settings.format) || learned.format;
  const digits = settings.digits > 0 ? settings.digits : learned.digits;
  let serial = Math.max(highestSerial + 1, Math.floor(settings.floor) || 0, 1);
  let admissionNo = formatAdmissionNo(format, serial, digits, sessionYear);
  for (let guard = 0; taken.has(admissionNo.toUpperCase()) && guard < 10000; guard += 1) {
    serial += 1;
    admissionNo = formatAdmissionNo(format, serial, digits, sessionYear);
  }
  return { admissionNo, serial, highestSerial, lastNo, format, digits };
}

export function sessionStartYear(sessionStart: string | null | undefined, asOf = new Date()) {
  const year = Number(String(sessionStart || "").slice(0, 4));
  if (year > 1900) return year;
  return asOf.getMonth() >= 3 ? asOf.getFullYear() : asOf.getFullYear() - 1;
}

type AdmissionDb = {
  student: { findMany: (args: { where: { orgId: string | null }; select: { admissionNo: true } }) => Promise<{ admissionNo: string }[]> };
  schoolConfig: {
    findFirst: (args: { where: { orgId: string } }) => Promise<AdmissionConfigRow | null>;
    findUnique: (args: { where: { id: string } }) => Promise<AdmissionConfigRow | null>;
  };
};
type AdmissionConfigRow = { admissionNoFormat?: string | null; admissionNoDigits?: number | null; admissionNoFloor?: number | null; sessionStart?: string | null };

export function admissionSettingsFrom(config: AdmissionConfigRow | null | undefined): AdmissionNoSettings {
  return {
    format: cleanAdmissionFormat(config?.admissionNoFormat),
    digits: Math.max(0, Math.min(8, Math.floor(Number(config?.admissionNoDigits) || 0))),
    floor: Math.max(0, Math.floor(Number(config?.admissionNoFloor) || 0)),
  };
}

/** Loads settings + numbers in use for one school (orgId null = single-school install). */
export async function admissionNumberContext(db: unknown, orgId: string | null) {
  const client = db as AdmissionDb;
  const [config, rows] = await Promise.all([
    orgId ? client.schoolConfig.findFirst({ where: { orgId } }) : client.schoolConfig.findUnique({ where: { id: "school" } }),
    client.student.findMany({ where: { orgId }, select: { admissionNo: true } }),
  ]);
  return {
    settings: admissionSettingsFrom(config),
    existing: rows.map((row) => row.admissionNo),
    sessionYear: sessionStartYear(config?.sessionStart),
  };
}

/** Next number for one new student. Call inside the transaction that creates the student. */
export async function nextAdmissionNo(db: unknown, orgId: string | null) {
  const ctx = await admissionNumberContext(db, orgId);
  return planNextAdmissionNo(ctx.existing, ctx.settings, ctx.sessionYear).admissionNo;
}

/** For bulk import: hands out numbers one by one without re-reading, skipping numbers the sheet itself uses. */
export async function admissionNumberer(db: unknown, orgId: string | null, sheetNumbers: string[]) {
  const ctx = await admissionNumberContext(db, orgId);
  const all = [...ctx.existing, ...sheetNumbers.filter(Boolean)];
  const taken = new Set(all.map((no) => no.trim().toUpperCase()));
  return {
    next() {
      const plan = planNextAdmissionNo(all, ctx.settings, ctx.sessionYear, taken);
      all.push(plan.admissionNo);
      taken.add(plan.admissionNo.toUpperCase());
      return plan.admissionNo;
    },
  };
}

/** True for a Prisma unique-constraint error on the admission number. */
export function isAdmissionNoClash(error: unknown) {
  const e = error as { code?: string; meta?: { target?: unknown } } | null;
  if (!e || e.code !== "P2002") return false;
  const target = e.meta?.target;
  const text = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return !text || text.includes("admissionNo");
}

/** Re-runs a create when two people saved a student at the same moment and both got the same number. */
export async function withAdmissionNoRetry<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i += 1) {
    try {
      return await run();
    } catch (error) {
      if (i >= attempts || !isAdmissionNoClash(error)) throw error;
    }
  }
}
