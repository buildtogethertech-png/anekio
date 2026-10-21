import { describe, expect, it } from "vitest";
import { admissionFormFields, staffOnboardingFormFields } from "../../lib/admission-form";
import { parseBillingMonth, parseRollNumber, planStudentRolls, sheetColumnSummary, staffImportHeaders, studentImportColumnGuide, studentImportHeaders, studentTemplateRow } from "../../lib/onboarding";

describe("onboarding student roll number", () => {
  const fields = admissionFormFields(null);

  it("stars locked student columns and keeps parent columns optional", () => {
    const headers = studentImportHeaders(fields);
    expect(headers).toContain("Roll no *");
    expect(headers).toContain("Student name *");
    expect(headers).toContain("Class *");
    expect(headers).not.toContain("Interest *");
    expect(headers).not.toContain("Interest");
    expect(headers).toContain("Billing starts from *");
    expect(headers).toContain("Parent name");
    expect(headers).toContain("Parent mobile");
    expect(headers).toContain("Parent email");
    expect(headers).not.toContain("Parent name *");
    expect(headers).not.toContain("Parent mobile *");
    expect(studentImportHeaders(fields)[0]).toBe("Roll no *");
    expect(studentImportColumnGuide(fields).find((column) => column.header === "Roll no *")?.required).toBe(true);
    const locked = admissionFormFields(null).filter((field) => field.visible && field.required).map((field) => field.id);
    expect(locked).toEqual(["rollNumber", "studentName", "classWanted", "billingStartPeriod"]);
    expect(headers.filter((header) => header.endsWith(" *")).slice(0, 4)).toEqual([
      "Roll no *",
      "Student name *",
      "Class *",
      "Billing starts from *",
    ]);
    expect(studentTemplateRow(fields, {
      rollNumber: 7,
      name: "Aarav Sharma",
      dob: "2015-04-12",
      classLabel: "1-A",
      interests: "Sports",
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
    expect(guide.find((column) => column.header === "Child name *")?.required).toBe(true);
    expect(guide.find((column) => column.header === "Guardian email")?.required).toBe(false);
    expect(guide.find((column) => column.header === "House *")?.required).toBe(true);
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

  it("follows the admission form: hidden parent mobile is left out, billing month is read", () => {
    const configured = admissionFormFields([
      { id: "studentName", label: "Student name", type: "text", visible: true, required: true },
      { id: "classWanted", label: "Class", type: "text", visible: true, required: true },
      { id: "billingStartPeriod", label: "Billing starts from", type: "month", visible: true, required: true },
      { id: "guardianName", label: "Parent / guardian name", type: "text", visible: true, required: true },
      { id: "phone", label: "Parent mobile", type: "phone", visible: false, required: false },
    ]);
    expect(studentImportColumnGuide(configured).find((column) => column.header === "Billing starts from *")?.required).toBe(true);
    const headers = studentImportHeaders(configured);
    expect(headers).not.toContain("Parent mobile");
    expect(headers).toContain("Parent / guardian name *");
    expect(headers).toContain("Billing starts from *");
    expect(headers).not.toContain("Interest *");
    const row = studentTemplateRow(configured, {
      name: "Aarav", dob: "2015-04-12", classLabel: "1-A", billingStart: "2026-04", interests: "Sports", parentName: "Neha", parentMobile: "9876543210", parentEmail: "",
    });
    expect(row).not.toContain("9876543210");
    expect(row[headers.indexOf("Billing starts from *")]).toBe("2026-04");
    expect(parseBillingMonth("2026-04")).toBe("2026-04");
    expect(parseBillingMonth("2026-04-01T00:00:00.000Z")).toBe("2026-04");
    expect(parseBillingMonth("April 2026")).toBe("2026-04");
    expect(parseBillingMonth("")).toBe("");
    expect(parseBillingMonth("soon")).toBeNull();
  });

  it("plans roll numbers: typed as-is, existing kept, blank = max(row - 1, last + 1)", () => {
    const empty = planStudentRolls(
      [2, 3, 4].map((n) => ({ row: `1-A!${n}`, classKey: "1-A", studentId: "", typed: null })),
      []
    );
    expect([...empty.rolls.values()]).toEqual([1, 2, 3]);

    const mixed = planStudentRolls(
      [
        { row: "2", classKey: "1-A", studentId: "", typed: 11 },
        { row: "3", classKey: "1-A", studentId: "", typed: null },
        { row: "4", classKey: "1-A", studentId: "s-old", typed: null },
      ],
      [{ studentId: "s-old", classKey: "1-A", rollNumber: 4 }, { studentId: "s-other", classKey: "1-A", rollNumber: 7 }]
    );
    expect(mixed.rolls.get("2")).toBe(11);
    expect(mixed.rolls.get("3")).toBe(12);
    expect(mixed.rolls.get("4")).toBe(4);
    expect(mixed.errors).toEqual([]);

    const clash = planStudentRolls(
      [{ row: "2", classKey: "1-A", studentId: "", typed: 7 }],
      [{ studentId: "s-other", classKey: "1-A", rollNumber: 7 }]
    );
    expect(clash.errors[0]).toMatch(/roll 7 is already used in 1-A/);
  });
});

describe("staff onboarding excel", () => {
  it("exports visible staff form columns and stars required ones", () => {
    const headers = staffImportHeaders(staffOnboardingFormFields([]));
    expect(headers).toEqual([
      "Staff name *",
      "Mobile number *",
      "Email",
      "Role *",
      "Class teacher of",
      "Joining date",
      "Example only",
    ]);
    expect(headers).not.toContain("Department");
    expect(headers).not.toContain("Qualification");
    expect(headers).not.toContain("Address");
    expect(headers.some((header) => /salary/i.test(header))).toBe(false);
    expect(headers.some((header) => /manager/i.test(header))).toBe(false);
    expect(sheetColumnSummary(headers)).toBe(
      "Staff name *, Mobile number *, Email, Role *, Class teacher of, Joining date"
    );
  });
});
