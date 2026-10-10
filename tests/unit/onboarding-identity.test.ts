import { describe, expect, it } from "vitest";
import { schoolIdentityComplete } from "../../lib/onboarding";

const savedSchool = {
  name: "Roushan Public School",
  address: "Karihari",
  phone: "9708608975",
  email: "office@example.com",
  logoPath: "public/logo.png",
  signPath: "private/signature.png",
};

describe("school identity onboarding", () => {
  it("does not count a named school without uploaded brand assets as complete", () => {
    expect(schoolIdentityComplete({ ...savedSchool, logoPath: "", signPath: "" })).toBe(false);
    expect(schoolIdentityComplete({ ...savedSchool, signPath: "" })).toBe(false);
    expect(schoolIdentityComplete({ ...savedSchool, logoPath: "" })).toBe(false);
  });

  it("requires saved identity and contact details", () => {
    expect(schoolIdentityComplete({ ...savedSchool, name: "Anekio School" })).toBe(false);
    expect(schoolIdentityComplete({ ...savedSchool, address: "" })).toBe(false);
    expect(schoolIdentityComplete({ ...savedSchool, email: "" })).toBe(false);
  });

  it("counts a saved logo and signature as complete without an optional stamp", () => {
    expect(schoolIdentityComplete(savedSchool)).toBe(true);
  });
});
