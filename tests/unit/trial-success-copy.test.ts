import { describe, expect, it } from "vitest";
import { trialStartedHtml } from "../../lib/anekio-site";

describe("trial success copy", () => {
  it("directs the admin to email without exposing a temporary password", () => {
    const html = trialStartedHtml({
      plan: "7-day free trial",
      ownerName: "Asha",
      ownerEmail: "asha@example.com",
      schoolName: "River School",
      login: "9876543210",
      loginUrl: "/login",
      password: "temporary-password",
    } as unknown as Parameters<typeof trialStartedHtml>[0]);

    expect(html).toContain("asha@example.com");
    expect(html).toContain("secure password setup link");
    expect(html).toContain("9876543210");
    expect(html).not.toContain("temporary-password");
  });
});
