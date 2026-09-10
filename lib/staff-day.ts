/** School calendar day for staff In/Out rows. Always India, not the server timezone. */
export const STAFF_DAY_TZ = "Asia/Kolkata";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymdParts(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function indiaYmd(dt: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: STAFF_DAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

export function staffDayYmd(value: Date | string) {
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(+dt)) return "";
  // SQLite on India Windows often stores 00:00 IST as a naive 18:30 the previous local evening.
  // That Date is 13:00 UTC, so Asia/Kolkata would label it yesterday. Shift it to the school day.
  if (dt.getTimezoneOffset() === -330 && dt.getHours() === 18 && dt.getMinutes() === 30 && dt.getSeconds() === 0) {
    const next = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1);
    return ymdParts(next.getFullYear(), next.getMonth() + 1, next.getDate());
  }
  return indiaYmd(dt);
}

export function staffDayInstant(stamp: string) {
  const s = String(stamp || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(NaN);
  const [year, month, day] = s.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function staffDayWindow(stamp: string) {
  const instant = staffDayInstant(stamp);
  return {
    instant,
    from: new Date(instant.getTime() - 36 * 60 * 60 * 1000),
    to: new Date(instant.getTime() + 36 * 60 * 60 * 1000),
  };
}

export function collapseStaffDaysByDate<T extends { date: Date | string; inAt?: string | null }>(rows: T[]) {
  const out = new Map<string, T>();
  for (const row of rows) {
    const date = staffDayYmd(row.date);
    if (!date) continue;
    const prev = out.get(date);
    if (!prev) {
      out.set(date, row);
      continue;
    }
    const prevIn = prev.inAt || "";
    const nextIn = row.inAt || "";
    if (!prevIn && nextIn) out.set(date, row);
    else if (prevIn && nextIn) out.set(date, row);
  }
  return out;
}
