import { randomUUID } from "crypto";
import { prisma } from "./prisma";

/**
 * Combined lessons: one teacher takes two or more classes together in the same period (6-A + 6-B for Games,
 * or two grades in one room). Each class keeps its own TimetableSlot; the slots share a combinedId.
 * A combinedId only counts while at least two slots with the same teacher, period and day carry it.
 */

type Groupable = { id: string; combinedId?: string | null; teacherId?: string | null; periodId: string; weekday: number };

export function combinedKey(slot: Groupable) {
  return slot.combinedId && slot.teacherId ? `${slot.combinedId}|${slot.teacherId}|${slot.periodId}|${slot.weekday}` : `one|${slot.id}`;
}

/** Slots grouped into lessons, keeping the order of each lesson's first slot. */
export function groupCombined<T extends Groupable>(slots: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const slot of slots) {
    const key = combinedKey(slot);
    const list = groups.get(key);
    if (list) list.push(slot);
    else groups.set(key, [slot]);
  }
  return [...groups.values()];
}

/** The other slots of this slot's combined lesson (empty when it is a normal period). */
export async function combinedSiblings(slot: Groupable) {
  if (!slot.combinedId || !slot.teacherId) return [];
  return prisma.timetableSlot.findMany({
    where: { combinedId: slot.combinedId, teacherId: slot.teacherId, periodId: slot.periodId, weekday: slot.weekday, NOT: { id: slot.id } },
    include: { class: { select: { name: true, section: true } } },
  });
}

/** A lesson left with one class is a normal period again. */
export async function tidyCombined(combinedId?: string | null) {
  if (!combinedId) return;
  const left = await prisma.timetableSlot.count({ where: { combinedId } });
  if (left <= 1) await prisma.timetableSlot.updateMany({ where: { combinedId }, data: { combinedId: null } });
}

/**
 * The combinedId a class's period should carry when its teacher is also in other classes then.
 * No clash → null. Already combined with exactly those classes → same id. Otherwise `clash()` throws,
 * unless the office asked to combine: then the other classes join one lesson with this one.
 */
export async function lessonGroupFor(input: {
  classId: string;
  periodId: string;
  weekday: number;
  busy: { id: string; combinedId: string | null }[];
  combine?: boolean;
  clash: () => never;
}) {
  const before = await prisma.timetableSlot.findFirst({
    where: { classId: input.classId, periodId: input.periodId, weekday: input.weekday },
    select: { combinedId: true },
  });
  const previous = before?.combinedId || null;
  if (!input.busy.length) return { combinedId: null, previous };
  if (previous && input.busy.every((b) => b.combinedId === previous)) return { combinedId: previous, previous };
  if (!input.combine) input.clash();
  const combinedId = input.busy.find((b) => b.combinedId)?.combinedId || randomUUID();
  await prisma.timetableSlot.updateMany({ where: { id: { in: input.busy.map((b) => b.id) } }, data: { combinedId } });
  return { combinedId, previous };
}

/** For every slot in a combined lesson: the other classes in it ("6-B", "7-A"). */
export async function combinedWithLabels() {
  const slots = await prisma.timetableSlot.findMany({
    where: { combinedId: { not: null } },
    select: { id: true, combinedId: true, teacherId: true, periodId: true, weekday: true, class: { select: { name: true, section: true } } },
  });
  const out = new Map<string, string[]>();
  for (const lesson of groupCombined(slots)) {
    if (lesson.length < 2) continue;
    for (const slot of lesson) out.set(slot.id, lesson.filter((s) => s.id !== slot.id).map((s) => `${s.class.name}-${s.class.section}`));
  }
  return out;
}
