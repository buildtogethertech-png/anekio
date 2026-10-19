import { describe, expect, it } from "vitest";
import { admissionFormFields, admissionFormJson, admissionLeadInput, effectiveAdmissionFormJson, staffOnboardingFormFields, websiteFormFields } from "../../lib/admission-form";

describe("admission form configuration", () => {
  it("uses the platform form only when the school has no override", () => {
    const platform = JSON.stringify([{ id: "billingStartPeriod", label: "Billing starts from", type: "month", required: true, visible: true, builtin: true }]);
    expect(admissionFormFields(effectiveAdmissionFormJson("[]", platform))).toMatchObject([{ id: "billingStartPeriod", type: "month", required: true, builtin: true }]);
    expect(admissionFormFields(effectiveAdmissionFormJson('[{"id":"phone","type":"phone"}]', platform)).map((field) => field.id)).toEqual(["phone"]);
    expect(admissionFormFields("[]")).toEqual([]);
  });

  it("normalizes builtin changes and safe custom fields", () => {
    const fields = admissionFormFields([
      { id: "studentName", label: "Child name", type: "text", required: false, visible: true },
      { id: "custom_transport", label: "Transport needed", type: "select", required: true, visible: true, options: ["Yes", "No", "Yes"] },
    ]);

    expect(fields.find((field) => field.id === "studentName")).toMatchObject({ label: "Child name", required: false });
    expect(fields.find((field) => field.id === "custom_transport")).toMatchObject({
      type: "select",
      required: true,
      options: ["Yes", "No"],
      builtin: false,
    });
  });

  it("locks only student name, class and billing month on admission; parent fields are the school's choice", () => {
    const saved = [
      { id: "studentName", type: "text", required: false, visible: false },
      { id: "classWanted", type: "text", required: false, visible: false },
      { id: "billingStartPeriod", type: "month", required: false, visible: false },
      { id: "guardianName", type: "text", required: false, visible: false },
      { id: "phone", type: "phone", required: false, visible: false },
    ];
    const admission = Object.fromEntries(admissionFormFields(saved).map((field) => [field.id, [field.visible, field.required]]));
    expect(admission).toEqual({
      studentName: [true, true],
      classWanted: [true, true],
      billingStartPeriod: [true, true],
      guardianName: [false, false],
      phone: [false, false],
    });
    // The website enquiry still needs a number to call back.
    const website = Object.fromEntries(websiteFormFields(saved).map((field) => [field.id, [field.visible, field.required]]));
    expect(website.phone).toEqual([true, true]);
    expect(website.guardianName).toEqual([false, false]);
  });

  it("allows the built-in phone field to be optional", () => {
    const fields = admissionFormFields([
      { id: "phone", label: "Phone", type: "phone", required: false, visible: true },
    ]);

    expect(fields.find((field) => field.id === "phone")).toMatchObject({ visible: true, required: false });
  });

  it("keeps billing month as a required built-in field and validates YYYY-MM", () => {
    const fields = [{ id: "billingStartPeriod", label: "Billing starts from", type: "month", required: true, visible: true, builtin: true }];
    expect(() => admissionLeadInput(fields, {})).toThrow("Billing starts from is required.");
    expect(() => admissionLeadInput(fields, { billingStartPeriod: "2026-13" })).toThrow("Choose a valid Billing starts from.");
    expect(admissionLeadInput(fields, { billingStartPeriod: "2026-10" }).billingStartPeriod).toBe("2026-10");
  });

  it("enforces required fields and dropdown choices for every lead source", () => {
    const fields = [
      { id: "studentName", label: "Student name", type: "text", required: false, visible: true, builtin: true },
      { id: "custom_transport", label: "Transport needed", type: "select", required: true, visible: true, options: ["Yes", "No"], builtin: false },
    ];

    expect(() => admissionLeadInput(fields, {})).toThrow("Transport needed is required.");
    expect(() => admissionLeadInput(fields, { custom_transport: "Maybe" })).toThrow("Choose a valid Transport needed.");
    expect(admissionLeadInput(fields, { custom_transport: "Yes" }).customValues).toEqual({ custom_transport: "Yes" });
  });

  it("rejects a visible dropdown without options before saving", () => {
    expect(() => admissionFormJson([{ id: "custom_empty", label: "Empty", type: "select", visible: true }])).toThrow(
      "Empty needs at least one option."
    );
  });

  it("always includes the staff fields needed to create a teacher profile", () => {
    const empty = staffOnboardingFormFields([]);
    expect(empty.map((field) => field.id)).toEqual([
      "staffName",
      "phone",
      "email",
      "role",
      "department",
      "joiningDate",
      "qualification",
      "address",
      "monthlySalary",
      "reportingManager",
    ]);
    expect(empty.filter((field) => field.visible && field.required).map((field) => field.id)).toEqual([
      "staffName",
      "phone",
      "role",
    ]);
    expect(empty.find((field) => field.id === "email")).toMatchObject({ visible: true, required: false });
    expect(empty.find((field) => field.id === "monthlySalary")).toMatchObject({ visible: false, required: false });
    expect(empty.find((field) => field.id === "reportingManager")).toMatchObject({ visible: false, required: false });

    const mixed = staffOnboardingFormFields([
      { id: "custom_new", label: "New field", type: "text", required: false, visible: true },
    ]);
    expect(mixed[0]).toMatchObject({ id: "staffName", label: "Staff name", required: true, visible: true });
    expect(mixed.map((field) => field.id)).toContain("custom_new");
    expect(mixed.at(-1)).toMatchObject({ id: "custom_new", label: "New field" });
  });
});
