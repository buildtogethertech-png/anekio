import { describe, expect, it } from "vitest";
import {
  admissionFormFields,
  admissionFormJson,
  admissionLeadInput,
  applySchoolClassOptions,
  effectiveAdmissionFormJson,
  LOCKED_STUDENT_ADMISSION_FIELD_IDS,
  parentAdmissionContact,
  staffOnboardingFormFields,
  websiteFormFields,
} from "../../lib/admission-form";

describe("admission form configuration", () => {
  it("uses the platform form only when the school has no override", () => {
    const platform = JSON.stringify([{ id: "billingStartPeriod", label: "Billing starts from", type: "month", required: true, visible: true, builtin: true }]);
    expect(admissionFormFields(effectiveAdmissionFormJson("[]", platform)).map((field) => field.id)).toEqual(
      expect.arrayContaining(["rollNumber", "studentName", "classWanted", "billingStartPeriod"])
    );
    expect(admissionFormFields(effectiveAdmissionFormJson('[{"id":"phone","type":"phone"}]', platform)).map((field) => field.id)).toEqual(
      expect.arrayContaining(["rollNumber", "studentName", "phone", "guardianName", "email"])
    );
  });

  it("injects locked student fields into a custom saved form that omitted them", () => {
    const fields = admissionFormFields([
      { id: "dateOfBirth", label: "Date of birth", type: "date", visible: false, required: false },
      { id: "custom_name", label: "name", type: "text", visible: true, required: false },
      { id: "custom_photo", label: "photo", type: "file", visible: true, required: false, fileType: "image" },
    ]);
    const byId = Object.fromEntries(fields.map((field) => [field.id, field]));
    for (const id of LOCKED_STUDENT_ADMISSION_FIELD_IDS) {
      expect(byId[id]).toMatchObject({ visible: true, required: true, builtin: true });
    }
    expect(byId.guardianName).toMatchObject({ visible: true, required: false });
    expect(byId.phone).toMatchObject({ visible: true, required: false });
    expect(byId.email).toMatchObject({ visible: true, required: false });
    expect(byId.custom_name).toMatchObject({ label: "name", builtin: false });
    expect(byId.custom_photo).toMatchObject({ label: "photo", type: "file" });
    expect(fields.filter((field) => field.visible && field.required).map((field) => field.id)).toEqual([
      "rollNumber",
      "studentName",
      "classWanted",
      "billingStartPeriod",
    ]);
    expect(fields.some((field) => field.id === "interests")).toBe(false);
  });

  it("normalizes builtin changes and safe custom fields", () => {
    const fields = admissionFormFields([
      { id: "studentName", label: "Child name", type: "text", required: false, visible: true },
      { id: "custom_transport", label: "Transport needed", type: "select", required: true, visible: true, options: ["Yes", "No", "Yes"] },
    ]);

    expect(fields.find((field) => field.id === "studentName")).toMatchObject({ label: "Child name", required: true, visible: true });
    expect(fields.find((field) => field.id === "custom_transport")).toMatchObject({
      type: "select",
      required: true,
      options: ["Yes", "No"],
      builtin: false,
    });
  });

  it("locks student profile fields and leaves parent fields unlocked", () => {
    const saved = [
      { id: "studentName", type: "text", required: false, visible: false },
      { id: "classWanted", type: "text", required: false, visible: false },
      { id: "billingStartPeriod", type: "month", required: false, visible: false },
      { id: "guardianName", type: "text", required: false, visible: false },
      { id: "phone", type: "phone", required: false, visible: false },
      { id: "email", type: "email", required: false, visible: false },
    ];
    const admission = Object.fromEntries(admissionFormFields(saved).map((field) => [field.id, [field.visible, field.required]]));
    expect(admission.rollNumber).toEqual([true, true]);
    expect(admission.studentName).toEqual([true, true]);
    expect(admission.classWanted).toEqual([true, true]);
    expect(admission.interests).toBeUndefined();
    expect(admission.billingStartPeriod).toEqual([true, true]);
    expect(admission.guardianName).toEqual([false, false]);
    expect(admission.phone).toEqual([false, false]);
    expect(admission.email).toEqual([false, false]);
    const website = Object.fromEntries(websiteFormFields(saved).map((field) => [field.id, [field.visible, field.required]]));
    expect(website.phone).toEqual([true, true]);
    expect(website.guardianName).toEqual([false, false]);
    expect(website.rollNumber).toBeUndefined();
    expect(website.interests).toBeUndefined();
  });

  it("allows the built-in phone field to be optional", () => {
    const fields = admissionFormFields([
      { id: "phone", label: "Phone", type: "phone", required: false, visible: true },
    ]);

    expect(fields.find((field) => field.id === "phone")).toMatchObject({ visible: true, required: false });
  });

  it("creates a parent profile only when a mobile or email is given", () => {
    expect(parentAdmissionContact({})).toMatchObject({ filled: false, canCreate: false });
    expect(parentAdmissionContact({ parentName: "Neha Sharma" })).toMatchObject({ filled: true, canCreate: false });
    expect(parentAdmissionContact({ parentName: "Neha Sharma", parentPhone: "9876543210" })).toMatchObject({ filled: true, canCreate: true });
    expect(parentAdmissionContact({ parentEmail: "parent@school.test" })).toMatchObject({ filled: true, canCreate: true });
  });

  it("always includes enquiry fields so walk-in works without a saved website form", () => {
    const empty = websiteFormFields([]);
    expect(empty.filter((field) => field.visible && field.required).map((field) => field.id)).toEqual([
      "studentName",
      "classWanted",
      "guardianName",
      "phone",
    ]);
    expect(empty.some((field) => field.id === "rollNumber")).toBe(false);
    expect(empty.find((field) => field.id === "message")).toMatchObject({ visible: true, required: false });
    expect(empty.find((field) => field.id === "classWanted")).toMatchObject({
      type: "select",
      helpText: "Same class list the school office uses for admissions.",
    });
  });

  it("offers school classes for Class interested on website and walk-in forms", () => {
    const fields = applySchoolClassOptions(websiteFormFields([]), ["10-A", "2-A", "efg-B"]);
    expect(fields.find((field) => field.id === "classWanted")).toMatchObject({
      type: "select",
      options: ["10-A", "2-A", "efg-B"],
    });
    const base = { studentName: "Aarav Sharma", phone: "9876543210", guardianName: "Neha Sharma" };
    expect(() => admissionLeadInput([], { ...base, classWanted: "Nursery" }, ["10-A", "2-A"])).toThrow("Choose a valid Class interested.");
    expect(admissionLeadInput([], { ...base, classWanted: "10-A" }, ["10-A", "2-A"]).classWanted).toBe("10-A");
  });

  it("keeps billing month as a required built-in field and validates YYYY-MM", () => {
    const fields = [
      { id: "studentName", label: "Student name", type: "text", required: true, visible: true, builtin: true },
      { id: "classWanted", label: "Class interested", type: "text", required: true, visible: true, builtin: true },
      { id: "phone", label: "Mobile number", type: "phone", required: true, visible: true, builtin: true },
      { id: "billingStartPeriod", label: "Billing starts from", type: "month", required: true, visible: true, builtin: true },
    ];
    const base = { studentName: "Aarav Sharma", classWanted: "1-A", phone: "9876543210", guardianName: "Neha Sharma" };
    expect(() => admissionLeadInput(fields, base)).toThrow("Billing starts from is required.");
    expect(() => admissionLeadInput(fields, { ...base, billingStartPeriod: "2026-13" })).toThrow("Choose a valid Billing starts from.");
    expect(admissionLeadInput(fields, { ...base, billingStartPeriod: "2026-10" }).billingStartPeriod).toBe("2026-10");
  });

  it("enforces required fields and dropdown choices for every lead source", () => {
    const fields = [
      { id: "studentName", label: "Student name", type: "text", required: false, visible: true, builtin: true },
      { id: "classWanted", label: "Class interested", type: "text", required: true, visible: true, builtin: true },
      { id: "phone", label: "Mobile number", type: "phone", required: true, visible: true, builtin: true },
      { id: "custom_transport", label: "Transport needed", type: "select", required: true, visible: true, options: ["Yes", "No"], builtin: false },
    ];
    const base = { studentName: "Aarav Sharma", classWanted: "1-A", phone: "9876543210", guardianName: "Neha Sharma" };

    expect(() => admissionLeadInput(fields, base)).toThrow("Transport needed is required.");
    expect(() => admissionLeadInput(fields, { ...base, custom_transport: "Maybe" })).toThrow("Choose a valid Transport needed.");
    expect(admissionLeadInput(fields, { ...base, custom_transport: "Yes" }).customValues).toEqual({ custom_transport: "Yes" });
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
