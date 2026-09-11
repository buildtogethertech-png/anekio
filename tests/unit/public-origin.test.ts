import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin, withPublicRequestOrigin } from "../../lib/utils";

const ENV_KEYS = ["PUBLIC_URL", "ANEKIO_PUBLIC_URL", "NEXTAUTH_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

describe("public origin", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses the current request host before legacy or Vercel aliases", () => {
    process.env.NEXTAUTH_URL = "https://legacy.example.com";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "cultivate-school.vercel.app";

    const origin = withPublicRequestOrigin("https://app.anekio.com", () => publicOrigin());

    expect(origin).toBe("https://app.anekio.com");
  });

  it("keeps explicit public URL configuration as the strongest override", () => {
    process.env.PUBLIC_URL = "https://pay.anekio.com/";

    const origin = withPublicRequestOrigin("https://app.anekio.com", () => publicOrigin());

    expect(origin).toBe("https://pay.anekio.com");
  });
});
