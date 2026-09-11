import { clsx, type ClassValue } from "clsx";
import { AsyncLocalStorage } from "node:async_hooks";
import { twMerge } from "tailwind-merge";

const publicOriginStore = new AsyncLocalStorage<string>();

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function withPublicRequestOrigin<T>(origin: string, fn: () => T) {
  return publicOriginStore.run(origin.replace(/\/$/, ""), fn);
}

export function publicOrigin() {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return (
    process.env.PUBLIC_URL?.replace(/\/$/, "") ||
    process.env.ANEKIO_PUBLIC_URL?.replace(/\/$/, "") ||
    publicOriginStore.getStore() ||
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
    (vercel ? `https://${vercel.replace(/^https?:\/\//, "")}` : "") ||
    "http://localhost:4000"
  );
}

export function feePayUrl(token: string) {
  return `${publicOrigin()}/pay/${token}`;
}

export function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function daysLate(dueDate: Date, now = new Date()) {
  const start = new Date(dueDate);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - start.getTime()) / 86400000);
  return Math.max(0, diff);
}

export type LateKind = "NONE" | "STATIC" | "DAILY";

export type LatePolicy = {
  lateKind?: string | null;
  lateGraceDays?: number | null;
  lateAmount?: number | null;
  lateFeePerDay?: number | null;
  lateAfter10?: number | null;
  lateAfter20?: number | null;
};

export function lateAmountForDays(days: number, policy: LatePolicy) {
  const kind = (policy.lateKind || "").toUpperCase();
  const grace = Math.max(0, Math.round(Number(policy.lateGraceDays) || 0));
  const amount = Math.max(0, Math.round(Number(policy.lateAmount) || 0));
  if (kind === "NONE") return 0;
  if (kind === "STATIC") return days > grace ? amount : 0;
  if (kind === "DAILY") return Math.max(0, days - grace) * amount;
  const after10 = policy.lateAfter10 || 0;
  const after20 = policy.lateAfter20 || 0;
  if (after10 > 0 || after20 > 0) {
    if (days >= 20) return after20 || after10;
    if (days >= 10) return after10;
    return 0;
  }
  return Math.max(0, days) * Math.max(0, policy.lateFeePerDay || 0);
}

export function lateFee(dueDate: Date, paid: boolean, policy: LatePolicy = {}) {
  if (paid) return 0;
  return lateAmountForDays(daysLate(dueDate), policy);
}

export const PATH_LABEL: Record<string, string> = {
  OLYMPIAD: "Olympiad",
  SPORTS: "Sports",
  SPELLING: "Spelling",
  SCIENCE: "Science",
  ARTS: "Arts",
};

export const CONTEST_TYPE_LABEL: Record<string, string> = {
  OLYMPIAD: "Olympiad",
  SPELLING: "Spelling",
  SPORTS: "Sports",
  REGIONAL: "Regional",
  OTHER: "Other",
};

export const LEVEL_LABEL: Record<string, string> = {
  SCHOOL: "School",
  DISTRICT: "District",
  NATIONAL: "National",
  INTERNATIONAL: "International",
};

export const GRANT_LABEL: Record<string, string> = {
  NOMINATED: "Nominated",
  AWARDED: "Awarded",
  REJECTED: "Rejected",
  IN_PROGRESS: "In progress",
};

export const APP_TYPE_LABEL: Record<string, string> = {
  CONTEST_ENROLL: "Contest enrollment",
  LEAVE: "Leave / absence",
  FEE_QUERY: "Fee query",
  GRANT_NOMINATION: "Grant nomination",
};

export const APP_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export function percent(marks: number, max: number) {
  if (!max) return 0;
  return Math.round((marks / max) * 100);
}
