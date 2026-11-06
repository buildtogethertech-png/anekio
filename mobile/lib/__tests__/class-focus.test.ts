import { closingMinute, focusDay, focusTime, hms, teacherPeriodsOn } from "../class-focus";

const MIN = 60_000;

describe("school day", () => {
  it("counts focus time, leaves breaks out and keeps the break reason", () => {
    let day = focusDay.start("u1", 0);
    expect(focusTime(day, 30 * MIN)).toBe(30 * MIN);
    day = focusDay.takeBreak(day, 30 * MIN, "Lunch");
    expect(day.breakReason).toBe("Lunch");
    expect(focusTime(day, 40 * MIN)).toBe(30 * MIN);
    day = focusDay.resume(day, 40 * MIN, "class_started");
    expect(focusTime(day, 50 * MIN)).toBe(40 * MIN);
    day = focusDay.end(day, 60 * MIN, "auto_end");
    expect(day.status).toBe("ended");
    expect(day.focusMs).toBe(50 * MIN);
    expect(day.log.map((e) => e.type)).toEqual(["start", "break", "class_started", "auto_end"]);
    expect(day.log[1].reason).toBe("Lunch");
  });

  it("records the guard being turned off without changing the time", () => {
    const day = focusDay.guardOff(focusDay.start("u1", 0), 5 * MIN);
    expect(day.status).toBe("focus");
    expect(day.log.at(-1)).toEqual({ type: "guard_off", at: 5 * MIN });
  });

  it("finds the teacher's classes today, with covers and periods given away", () => {
    const timetable = {
      periods: [
        { id: "p1", name: "Period 1", start: "09:15", end: "09:55" },
        { id: "p2", name: "Period 2", start: "10:00", end: "10:40" },
        { id: "p3", name: "Period 3", start: "10:45", end: "11:25" },
      ],
      slots: [
        { weekday: 5, periodId: "p1", period: "Period 1", subject: "Maths", classLabel: "5-A" },
        { weekday: 5, periodId: "p2", period: "Period 2", subject: "Science", classLabel: "6-B" },
      ],
    };
    const list = teacherPeriodsOn(new Date(2026, 10, 6), timetable, [
      { date: "2026-11-06", period: "Period 2", startsAt: "10:00", classLabel: "6-B", subject: "Science", kind: "AWAY" },
      { date: "2026-11-06", period: "Period 3", startsAt: "10:45", classLabel: "4-A", subject: "Hindi", kind: "COVER" },
    ]);
    expect(list.map((p) => `${p.classLabel} ${p.subject}`)).toEqual(["5-A Maths", "4-A Hindi"]);
    expect(closingMinute(timetable)).toBe(11 * 60 + 25);
    expect(closingMinute(timetable, "14:30")).toBe(14 * 60 + 30);
  });

  it("formats the bar timer", () => {
    expect(hms(3_725_000)).toBe("01:02:05");
  });
});
