import { describe, expect, it } from "vitest";
import { admissionFormFields } from "../../lib/admission-form";
import { parseRollNumber, studentImportColumnGuide, studentImportHeaders, studentTemplateRow } from "../../lib/onboarding";

describe("onboarding student roll number", () => {
  const fields = admissionFormFields(null);

  it("puts Roll number before the student name in the template", () => {
    expect(studentImportHeaders(fields)[0]).toBe("Roll number");
    expect(studentImportHeaders(fields)[1]).toBe("Student name");
    expect(studentImportHeaders(fields)[4]).toBe("Billing starts from");
    expect(studentImportColumnGuide(fields)[4]).toMatchObject({ header: "Billing starts from", required: true });
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

  it("marks school-required fields and system-required fields in the Excel guide", () => {
    const configured = admissionFormFields([
      { id: "studentName", label: "Child name", type: "text", visible: true, required: true },
      { id: "email", label: "Guardian email", type: "email", visible: true, required: false },
      { id: "custom_house", label: "House", type: "text", visible: true, required: true },
      { id: "custom_note", label: "Hidden note", type: "text", visible: false, required: true },
    ]);
    const guide = studentImportColumnGuide(configured);
    expect(guide.find((column) => column.header === "Child name")?.required).toBe(true);
    expect(guide.find((column) => column.header === "Date of birth")?.required).toBe(true);
    expect(guide.find((column) => column.header === "Guardian email")?.required).toBe(false);
    expect(guide.find((column) => column.header === "House")?.required).toBe(true);
    expect(guide.some((column) => column.header === "Hidden note")).toBe(false);
  });

  it("leaves hidden optional email out of the student sheet", () => {
    const configured = admissionFormFields([
      { id: "email", label: "Parent email", type: "email", visible: false, required: false },
    ]);
    expect(studentImportHeaders(configured)).not.toContain("Parent email");
    expect(studentImportColumnGuide(configured).some((column) => column.header === "Parent email")).toBe(false);
    expect(studentTemplateRow(configured, {
      name: "Aarav", dob: "2015-04-12", classLabel: "1-A", parentName: "Neha", parentMobile: "9876543210", parentEmail: "hidden@example.com",
    })).not.toContain("hidden@example.com");
  });
});
