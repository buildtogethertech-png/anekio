/**
 * Student seats on an Anekio plan. A school pays for students in slabs of 50 (50, 100, 150 …).
 * SaasOrg.studentCount holds the seats paid for (rounded up to a slab); 0/empty = not set, no limit.
 * Free trials have no limit. A paid school cannot add students beyond its seats until it upgrades;
 * students already on the roll keep working.
 */
import { prisma } from "./prisma";

export const SEAT_STEP = 50;
const DAY = 86_400_000;

/** Smallest slab of 50 that covers this many students (at least 50). */
export function seatSlab(students: number) {
  const n = Math.max(0, Math.floor(Number(students) || 0));
  return Math.max(SEAT_STEP, Math.ceil(n / SEAT_STEP) * SEAT_STEP);
}

export function onFreeTrial(org: { subscriptionStatus: string; paymentStatus: string }) {
  return org.subscriptionStatus.toUpperCase() === "TRIAL" || org.paymentStatus.toUpperCase() === "TRIAL";
}

/** Seats paid for (0 = not set, so no limit). */
export function paidSeats(org: { studentCount: number | null }) {
  return org.studentCount && org.studentCount > 0 ? seatSlab(org.studentCount) : 0;
}

/** Students on the roll today (students who left are not counted). */
export function activeStudents(orgId: string) {
  return prisma.student.count({ where: { orgId } });
}

export type SeatStatus = {
  active: number;
  /** Seats paid for; 0 = no limit (free trial or not set). */
  paid: number;
  /** Slab that covers the students on the roll today. */
  needed: number;
  limited: boolean;
  /** True when no more students can be added without an upgrade. */
  full: boolean;
  trial: boolean;
};

export function seatStatus(org: { subscriptionStatus: string; paymentStatus: string; studentCount: number | null }, active: number): SeatStatus {
  const trial = onFreeTrial(org);
  const paid = trial ? 0 : paidSeats(org);
  const limited = paid > 0;
  return { active, paid, needed: seatSlab(active), limited, full: limited && active >= paid, trial };
}

/** Refuse to add students beyond the seats a paid school has bought. */
export async function assertSeatsFor(orgId: string | null | undefined, adding: number) {
  if (!orgId || adding < 1) return;
  const org = await prisma.saasOrg.findUnique({
    where: { id: orgId },
    select: { subscriptionStatus: true, paymentStatus: true, studentCount: true },
  });
  if (!org) return;
  const status = seatStatus(org, await activeStudents(orgId));
  if (!status.limited || status.active + adding <= status.paid) return;
  const room = Math.max(0, status.paid - status.active);
  throw new Error(
    room
      ? `Your plan covers ${status.paid} students and ${status.active} are on the roll, so only ${room} more can be added. Upgrade from Manage subscription to add more.`
      : `Your plan covers ${status.paid} students and all seats are used. Upgrade from Manage subscription to add more students.`
  );
}

/** Price to add seats until the current period ends: extra seats × monthly rate × 12 × days left / 365. */
export function upgradeQuote(input: { rateMonthly: number; fromSeats: number; toSeats: number; endsOn: Date; now?: Date }) {
  const now = input.now ?? new Date();
  const extra = Math.max(0, input.toSeats - input.fromSeats);
  const daysLeft = Math.max(0, Math.ceil((input.endsOn.getTime() - now.getTime()) / DAY));
  const amount = Math.ceil((extra * input.rateMonthly * 12 * daysLeft) / 365);
  return { extra, daysLeft, rateMonthly: input.rateMonthly, amount };
}

/** How many more students can be added right now (Infinity when there is no limit). */
export async function seatRoom(orgId: string | null | undefined) {
  if (!orgId) return Infinity;
  const org = await prisma.saasOrg.findUnique({
    where: { id: orgId },
    select: { subscriptionStatus: true, paymentStatus: true, studentCount: true },
  });
  if (!org) return Infinity;
  const status = seatStatus(org, await activeStudents(orgId));
  return status.limited ? Math.max(0, status.paid - status.active) : Infinity;
}
