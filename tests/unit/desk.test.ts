import { describe, expect, it } from "vitest";
import { findUnassigned, type DeskSlot } from "../../lib/desk";

const classes = [{ id: "class-1", name: "1", section: "A" }];
const periods = [
  { id: "p1", name: "P1", startsAt: "09:00", endsAt: "09:40", isBreak: false, sortOrder: 1 },
  { id: "p2", name: "P2", startsAt: "09:40", endsAt: "10:20", isBreak: false, sortOrder: 2 },
];

function slot(patch: Partial<DeskSlot>): DeskSlot {
  return {
    id: "slot-1",
    weekday: 1,
    teacherId: null,
    classId: "class-1",
    class: { name: "1", section: "A" },
    subject: { name: "Science" },
    room: null,
    period: { id: "p1", name: "P1", startsAt: "09:00", endsAt: "09:40" },
    teacher: null,
    ...patch,
  };
}

describe("desk timetable gaps", () => {
  it("does not treat every blank timetable cell as an actionable gap", () => {
    expect(findUnassigned({ classes, weekdays: [1], periods, slots: [] })).toEqual([]);
  });

  it("counts a placed subject slot without a teacher", () => {
    const gaps = findUnassigned({ classes, weekdays: [1], periods, slots: [slot({})] });

    expect(gaps).toEqual([
      {
        key: "class-1:p1:1",
        classId: "class-1",
        classLabel: "1-A",
        weekday: 1,
        day: "Mon",
        periodName: "P1",
        time: "09:00–09:40",
      },
    ]);
  });

  it("does not count a subject slot after a teacher is assigned", () => {
    const gaps = findUnassigned({ classes, weekdays: [1], periods, slots: [slot({ teacherId: "teacher-1" })] });

    expect(gaps).toEqual([]);
  });
});
