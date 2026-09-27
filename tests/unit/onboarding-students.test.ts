import { describe, expect, it } from "vitest";
import { admissionFormFields } from "../../lib/admission-form";
import { parseRollNumber, studentImportHeaders, studentTemplateRow } from "../../lib/onboarding";

describe("onboarding student roll number", () => {
  const fields = admissionFormFields(null);

  it("puts Roll number before the student name in the template", () => {
    expect(studentImportHeaders(fields)[0]).toBe("Roll number");
    expect(studentImportHeaders(fields)[1]).toBe("Student name");
    expect(studentTemplateRow(fields, {
      rollNumber: 7,
      name: "Aarav Sharma",
      dob: "2015-04-12",
      classLabel: "1-A",
      parentName: "Neha Sharma",
      parentMobile: "9876543210",
      parentEmail: "parent@example.com",
    })[0]).toBe(7);
    expect(studentTemplateRow(fields, {
      rollNumber: 7,
      name: "Aarav Sharma",
      dob: "2015-04-12",
      classLabel: "1-A",
      parentName: "Neha Sharma",
      parentMobile: "9876543210",
      parentEmail: "parent@example.com",
    })[1]).toBe("Aarav Sharma");
  });

  it("accepts blank rolls for auto-assign and rejects junk values", () => {
    expect(parseRollNumber("")).toEqual({ ok: true, value: null });
    expect(parseRollNumber("12")).toEqual({ ok: true, value: 12 });
    expect(parseRollNumber("0")).toEqual({ ok: false, value: null });
    expect(parseRollNumber("12A")).toEqual({ ok: false, value: null });
  });
});
