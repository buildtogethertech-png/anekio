import { describe, expect, it } from "vitest";
import { DEFAULT_EXAM_PLAN } from "../../lib/exams";
import { schoolSpecificSetupComplete } from "../../lib/onboarding";

const session = { id: "session-2026", examPlanJson: JSON.stringify(DEFAULT_EXAM_PLAN) };
const suggested = { configuredSteps: [] as string[], session, weekdays: "[1,2,3,4,5,6]", teachingPeriodCount: 4 };

describe("school-specific onboarding defaults", () => {
  it("does not treat suggested session, weekdays, or exam plan as completed", () => {
    expect(schoolSpecificSetupComplete(suggested)).toEqual({ sessions: false, workingDays: false, examPlan: false });
  });

  it("requires school confirmation and a teaching period for the clock", () => {
    expect(schoolSpecificSetupComplete({ ...suggested, configuredSteps: ["working_days"], teachingPeriodCount: 0 }).workingDays).toBe(false);
    expect(schoolSpecificSetupComplete({ ...suggested, configuredSteps: ["working_days"] }).workingDays).toBe(true);
  });

  it("scopes session and exam-plan confirmations to the current school year", () => {
    const confirmed = { ...suggested, configuredSteps: ["sessions:session-2026", "exam_plan:session-2026"] };
    expect(schoolSpecificSetupComplete(confirmed)).toEqual({ sessions: true, workingDays: false, examPlan: true });
    expect(schoolSpecificSetupComplete({ ...confirmed, session: { ...session, id: "session-2027" } })).toEqual({ sessions: false, workingDays: false, examPlan: false });
  });
});
