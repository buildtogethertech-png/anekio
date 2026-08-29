import { describe, expect, it } from "vitest";
import { admissionFormFields, admissionFormJson, admissionLeadInput, DEFAULT_ADMISSION_FORM } from "../../lib/admission-form";

describe("admission form configuration", () => {
  it("keeps the current hardcoded form as the backward-compatible default", () => {
    expect(admissionFormFields("[]")).toEqual(DEFAULT_ADMISSION_FORM);
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

  it("enforces required fields and dropdown choices for every lead source", () => {
    const fields = [
      ...DEFAULT_ADMISSION_FORM.map((field) => ({ ...field, required: false })),
      { id: "custom_transport", label: "Transport needed", type: "select", required: true, visible: true, options: ["Yes", "No"], builtin: false },
    ];

    expect(() => admissionLeadInput(fields, {})).toThrow("Transport needed is required.");
    expect(() => admissionLeadInput(fields, { custom_transport: "Maybe" })).toThrow("Choose a valid Transport needed.");
    expect(admissionLeadInput(fields, { custom_transport: "Yes" }).customValues).toEqual({ custom_transport: "Yes" });
  });

  it("rejects a visible dropdown without options before saving", () => {
    expect(() => admissionFormJson([{ id: "custom_empty", label: "Empty", type: "select", visible: true }])).toThrow(
      "Empty needs at least one dropdown option."
    );
  });
});
