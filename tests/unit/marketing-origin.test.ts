import { describe, expect, it } from "vitest";
import { marketingOrigin } from "../../mobile/lib/marketing-origin";

describe("marketing origin", () => {
  it.each([
    ["http://app.localhost:4000", "http://localhost:4000"],
    ["https://app.staging.anekio.com", "https://staging.anekio.com"],
    ["https://app.anekio.com", "https://anekio.com"],
    ["http://localhost:4000", "http://localhost:4000"],
  ])("maps %s to %s", (app, marketing) => {
    expect(marketingOrigin(app)).toBe(marketing);
  });
});
