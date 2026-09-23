import { classifyNotice, hrefForNotice, noticeBellVisible } from "../notice-kind";

const officeNav = ["home", "notices", "fees", "exams", "admissions", "inbox", "staff", "leave"];
const parentNav = ["home", "notices", "fees", "tests", "inbox"];
const teacherNav = ["home", "notices", "exams", "leave", "inbox", "attendance"];

describe("hrefForNotice destinations", () => {
  it("routes catalog kinds to the existing modules", () => {
    expect(hrefForNotice("EXAM", { eventKey: null }, officeNav)).toBe("/exams");
    expect(hrefForNotice("EXAM", { eventKey: "SERIES:ser-1:RESULT_READY" }, parentNav)).toBe("/tests?seriesId=ser-1");
    expect(hrefForNotice("FEES", {}, parentNav)).toBe("/fees");
    expect(hrefForNotice("ADMISSION", {}, officeNav)).toBe("/admissions");
    expect(hrefForNotice("LEAVE", {}, teacherNav)).toBe("/leave");
    expect(hrefForNotice("LEAVE", {}, officeNav)).toBe("/leave");
    expect(hrefForNotice("FEEDBACK", {}, officeNav)).toBe("/inbox");
    expect(hrefForNotice("CIRCULAR", {}, officeNav)).toBe("/notices");
  });

  it("sends FEE events to Fees after classification, not the Notices board", () => {
    const { kind } = classifyNotice({ kind: "FEE", title: "Admit card blocked — fees pending" });
    expect(kind).toBe("FEES");
    expect(hrefForNotice(kind, {}, parentNav)).toBe("/fees");
    expect(hrefForNotice(kind, {}, parentNav)).not.toBe("/notices");
  });

  it("does not send unknown kinds to the Notices board", () => {
    const { kind } = classifyNotice({ kind: "SOMETHING_NEW" });
    expect(kind).toBe("UNKNOWN");
    expect(hrefForNotice(kind, {}, officeNav)).toBe("/");
  });
});

describe("notice bell visibility", () => {
  it("follows the notices nav key", () => {
    expect(noticeBellVisible([{ key: "home" }, { key: "notices" }])).toBe(true);
    expect(noticeBellVisible([{ key: "home" }, { key: "fees" }])).toBe(false);
  });
});
