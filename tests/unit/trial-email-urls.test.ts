import { describe, expect, it } from "vitest";
import { trialEmailOrigins } from "../../lib/trial-email-urls";

describe("trial email links", () => {
  it("uses the local website for password reset and Expo for login", () => {
    expect(trialEmailOrigins("localhost:4000")).toEqual({ site: "http://localhost:4000", app: "http://localhost:8081" });
  });

  it("uses the matching staging hosts", () => {
    expect(trialEmailOrigins("app.staging.anekio.com")).toEqual({ site: "https://staging.anekio.com", app: "https://app.staging.anekio.com" });
  });

  it("never trusts an unknown request host", () => {
    expect(trialEmailOrigins("attacker.example")).toEqual({ site: "https://anekio.com", app: "https://app.anekio.com" });
  });
});
