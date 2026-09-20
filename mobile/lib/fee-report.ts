export type FeeReportPayment = {
  key: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  classId: string;
  classLabel: string;
  amount: number;
  method: string;
  modeLabel: string;
  paidAt: string;
  paidDay: string;
  period: string;
  invoiceId: string;
  invoiceTitle: string;
  invoiceUrl?: string;
  receiptUrl?: string;
  reference: string;
  notes: string;
};

export type AgingBucketId = "notDue" | "d1" | "d8" | "d31" | "d61" | "d90";

const AGING: { id: AgingBucketId; label: string; min: number; max: number }[] = [
  { id: "notDue", label: "Not due", min: -Infinity, max: 0 },
  { id: "d1", label: "1–7 days", min: 1, max: 7 },
  { id: "d8", label: "8–30 days", min: 8, max: 30 },
  { id: "d31", label: "31–60 days", min: 31, max: 60 },
  { id: "d61", label: "61–90 days", min: 61, max: 90 },
  { id: "d90", label: "90+ days", min: 91, max: Infinity },
];

export function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseDay(value?: string) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const iso = new Date(text);
  if (!Number.isNaN(+iso)) return ymd(iso);
  const enIn = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (enIn) {
    const day = Number(enIn[1]);
    const month = Number(enIn[2]);
    const year = Number(enIn[3]);
    return ymd(new Date(year, month - 1, day));
  }
  return "";
}

export function addDays(day: string, count: number) {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(year, month - 1, date + count);
  return ymd(next);
}

export function monthStart(day: string) {
  return `${day.slice(0, 7)}-01`;
}

export function monthEnd(day: string) {
  const [year, month] = day.split("-").map(Number);
  return ymd(new Date(year, month, 0));
}

export function datePresetRange(
  preset: string,
  today = ymd(new Date()),
  session?: { startsOn?: string; endsOn?: string }
) {
  const [year, month, date] = today.split("-").map(Number);
  const weekday = new Date(year, month - 1, date).getDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const from = addDays(today, -1);
    return { from, to: from };
  }
  if (preset === "week") return { from: addDays(today, mondayOffset), to: today };
  if (preset === "month") return { from: monthStart(today), to: monthEnd(today) };
  if (preset === "lastMonth") {
    const prev = addDays(monthStart(today), -1);
    return { from: monthStart(prev), to: monthEnd(prev) };
  }
  if (preset === "quarter") {
    const q = Math.floor((month - 1) / 3) * 3 + 1;
    const start = `${year}-${String(q).padStart(2, "0")}-01`;
    return { from: start, to: today };
  }
  if (preset === "year") {
    const from = parseDay(session?.startsOn) || `${year}-04-01`;
    const to = parseDay(session?.endsOn) || today;
    return { from, to: to < today ? to : today };
  }
  return { from: monthStart(today), to: monthEnd(today) };
}

export function previousRange(from: string, to: string) {
  const start = new Date(from);
  const end = new Date(to);
  const days = Math.max(1, Math.round((+end - +start) / 86400000) + 1);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, 1 - days);
  return { from: prevFrom, to: prevTo };
}

export function collectionRate(collected: number, billed: number) {
  if (billed <= 0) return null;
  return Math.round((collected / billed) * 1000) / 10;
}

export function autoGrain(from: string, to: string): "day" | "week" | "month" {
  const days = Math.max(1, Math.round((+new Date(to) - +new Date(from)) / 86400000) + 1);
  if (days <= 21) return "day";
  if (days <= 120) return "week";
  return "month";
}

export function bucketKey(day: string, grain: "day" | "week" | "month") {
  if (grain === "month") return day.slice(0, 7);
  if (grain === "day") return day;
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year, month - 1, date);
  const offset = value.getDay() === 0 ? -6 : 1 - value.getDay();
  return addDays(day, offset);
}

export function agingBucket(daysOverdue: number): AgingBucketId {
  const row = AGING.find((item) => daysOverdue >= item.min && daysOverdue <= item.max) || AGING[AGING.length - 1];
  return row.id;
}

export const AGING_LABELS = AGING;

export function daysOverdue(dueDay: string, today = ymd(new Date())) {
  if (!dueDay || dueDay >= today) return 0;
  return Math.round((+new Date(today) - +new Date(dueDay)) / 86400000);
}
