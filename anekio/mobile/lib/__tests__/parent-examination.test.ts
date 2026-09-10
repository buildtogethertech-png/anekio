import { examsScreenForKind, testsScreenForKind } from "../paths";
import { parentTimetableGroups, parentUpcomingPapers } from "../parent-examination";

describe("parent exam routes", () => {
  it("sends parents to Examination on /tests and denies /exams", () => {
    expect(testsScreenForKind("PARENT")).toBe("parent-examination");
    expect(examsScreenForKind("PARENT")).toBe("denied");
  });

  it("keeps staff exams workspaces on /exams", () => {
    expect(examsScreenForKind("TEACHER")).toBe("teacher");
    expect(examsScreenForKind("OFFICE")).toBe("office");
  });

  it("keeps student Examination on /tests", () => {
    expect(testsScreenForKind("STUDENT")).toBe("family-tests");
    expect(examsScreenForKind("STUDENT")).toBe("family-tests");
  });
});

describe("parent upcoming timetable", () => {
  const past = {
    id: "ut1-eng",
    title: "Unit Test 1 · English",
    subject: "English",
    date: "12 Aug 2026",
    teacher: "Kavita Joshi",
    seriesId: "ut1",
    seriesName: "Unit Test 1",
  };
  const future = {
    id: "t1-eng",
    title: "Term 1 · English",
    subject: "English",
    date: "8 Sep 2026",
    teacher: "Kavita Joshi",
    seriesId: "term1",
    seriesName: "Term 1",
  };
  const sessions = [
    { id: "ut1", name: "Unit Test 1" },
    { id: "term1", name: "Term 1" },
  ];

  it("uses upcoming only, so past papers stay off the timetable", () => {
    const papers = parentUpcomingPapers({
      upcoming: [future],
      examTimetable: [past, future],
    });
    const dates = parentTimetableGroups(papers, sessions).flatMap((group) => group.papers.map((paper) => paper.date));
    expect(dates).toEqual(["8 Sep 2026"]);
    expect(dates).not.toContain("12 Aug 2026");
  });

  it("does not invent a past sitting tab when only future papers are upcoming", () => {
    const groups = parentTimetableGroups([future], sessions);
    expect(groups.map((group) => group.name)).toEqual(["Term 1"]);
  });
});
