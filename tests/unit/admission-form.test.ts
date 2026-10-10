import { describe, expect, it } from "vitest";
import { admissionFormFields, admissionFormJson, admissionLeadInput, effectiveAdmissionFormJson } from "../../lib/admission-form";

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
});
