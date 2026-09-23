import { describe, expect, it } from "vitest";
import { isBellNotice } from "../../lib/api-v1-record";
import { navForPortal } from "../../lib/nav";
import { defaultGrants } from "../../lib/permissions";
import {
  classifyNotice,
  CLASSIFIED_NOTICE_LABEL,
  canonicalizeNoticeKind,
  isCircularNotice,
  NOTICE_KINDS,
  storedNoticeKind,
} from "../../lib/notices";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("notice kind classification", () => {
  it.each(NOTICE_KINDS)("keeps catalog kind %s", (kind) => {
    expect(classifyNotice({ kind }).kind).toBe(kind);
    expect(canonicalizeNoticeKind(kind.toLowerCase())).toBe(kind);
  });

  it("normalizes FEE and fee aliases to FEES, not School/circular", () => {
    expect(storedNoticeKind("FEE")).toBe("FEES");
    expect(classifyNotice({ kind: "FEE" }).kind).toBe("FEES");
    expect(classifyNotice({ kind: "fee" }).kind).toBe("FEES");
    expect(isCircularNotice({ kind: "FEE" })).toBe(false);
    expect(CLASSIFIED_NOTICE_LABEL.FEES).toBe("Fees");
    expect(isBellNotice({ kind: "FEE", recipients: [] })).toBe(false);
  });

  it("does not treat unknown kinds as circulars", () => {
    expect(classifyNotice({ kind: "SOMETHING_NEW" }).kind).toBe("UNKNOWN");
    expect(isCircularNotice({ kind: "SOMETHING_NEW" })).toBe(false);
    expect(isBellNotice({ kind: "SOMETHING_NEW", recipients: [] })).toBe(false);
    expect(storedNoticeKind("SOMETHING_NEW")).toBe("CIRCULAR");
  });

  it("keeps empty kind as a circular and exam-body heuristic for unmarked exam posts", () => {
    expect(classifyNotice({ kind: "", body: "Hello parents" }).kind).toBe("CIRCULAR");
    expect(classifyNotice({ kind: null, body: "Office added Unit test for 6-A on 12 Sep" }).kind).toBe("EXAM");
  });

  it("shows named-recipient rows on desk snippets even when they are not circulars", () => {
    expect(isBellNotice({ kind: "EXAM", recipients: [{ userId: "u1" }] })).toBe(true);
    expect(isBellNotice({ kind: "CIRCULAR", recipients: [] })).toBe(true);
    expect(isBellNotice({ kind: "FEES", recipients: [] })).toBe(false);
  });
});

describe("notice bell navigation grants", () => {
  it("shows the bell when the portal nav includes notices", () => {
    expect(navForPortal("OFFICE", defaultGrants("ADMIN")).some((item) => item.key === "notices")).toBe(true);
    expect(navForPortal("TEACHER", defaultGrants("TEACHER")).some((item) => item.key === "notices")).toBe(true);
    expect(navForPortal("PARENT", defaultGrants("PARENT")).some((item) => item.key === "notices")).toBe(true);
    expect(navForPortal("STUDENT", defaultGrants("STUDENT")).some((item) => item.key === "notices")).toBe(true);
  });

  it("hides the bell for office roles without notices.view", () => {
    expect(navForPortal("OFFICE", defaultGrants("FEES")).some((item) => item.key === "notices")).toBe(false);
    expect(navForPortal("OFFICE", defaultGrants("EXAMS")).some((item) => item.key === "notices")).toBe(false);
    expect(navForPortal("OFFICE", ["desk.view"]).some((item) => item.key === "notices")).toBe(false);
  });

  it("lets Admin publish circulars and keeps other portals off notices.publish", () => {
    expect(defaultGrants("ADMIN")).toContain("notices.publish");
    expect(defaultGrants("TEACHER")).not.toContain("notices.publish");
    expect(defaultGrants("PARENT")).not.toContain("notices.publish");
    expect(defaultGrants("STUDENT")).not.toContain("notices.publish");
  });
});

describe("attendance notice producer", () => {
  it("does not currently write ATTENDANCE Notice rows", () => {
    const files = [
      "lib/core-actions.ts",
      "lib/leave.ts",
      "lib/exam-events.ts",
      "lib/exam-notification-run.ts",
      "lib/document-studio.ts",
      "lib/data.ts",
      "lib/school-website.ts",
    ];
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/kind:\s*["']ATTENDANCE["']/);
    }
  });
});
