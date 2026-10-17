import { describe, expect, it } from "vitest";
import { skillNameMatches } from "../../lib/exam-evaluators";

describe("class test subject assignment matching", () => {
  it("matches TeacherSkill names without regard to case or padding", () => {
    expect(skillNameMatches("Mathematics", "Mathematics")).toBe(true);
    expect(skillNameMatches("  science ", "Science")).toBe(true);
    expect(skillNameMatches("English", "Hindi")).toBe(false);
  });

  it("matches a TeacherSkill name against a subject code", () => {
    expect(skillNameMatches("ENG", "ENG")).toBe(true);
  });
});
