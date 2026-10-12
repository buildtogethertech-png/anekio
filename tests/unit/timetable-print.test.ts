import { describe, expect, it } from "vitest";
import { routinePrintHtml } from "../../lib/timetable-html";

describe("routine PDF HTML", () => {
  const grid = {
    schoolName: "Anekio School",
    place: "Bengaluru",
    subtitle: "Class 1-A · Weekly routine",
    weekdays: [
      { n: 1, label: "Mon" },
      { n: 2, label: "Tue" },
    ],
    periods: [
      { id: "p1", name: "1", start: "08:00", end: "08:40" },
      { id: "p2", name: "Break", start: "08:40", end: "09:00", isBreak: true },
    ],
    slots: [
      {
        weekday: 1,
        periodId: "p1",
        period: "1",
        subject: "Mathematics",
        teacher: "Kavita Joshi",
        room: "R1",
      },
    ],
    showTeacher: true,
  };

  it("prints the class week with subjects and a Save as PDF control", () => {
    const html = routinePrintHtml(grid);
    expect(html).toContain("Save as PDF");
    expect(html).toContain("Class 1-A · Weekly routine");
    expect(html).toContain("Mathematics");
    expect(html).toContain("Kavita Joshi");
    expect(html).toContain("Anekio School");
    expect(html).toContain("Break");
    expect(html).toContain("window.print()");
  });

  it("leaves unassigned periods empty instead of inventing a teacher", () => {
    const html = routinePrintHtml(grid);
    expect(html).toContain("—");
    expect(html).not.toContain("Sandeep");
  });
});
