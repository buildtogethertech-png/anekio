import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAppToken, verifyAppToken } from "../../lib/app-jwt";

const ENV_KEYS = ["JWT_SECRET", "APP_JWT_SECRET", "NEXTAUTH_SECRET"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

describe("application JWTs", () => {
  beforeEach(() => {
    vi.useRealTimers();
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.JWT_SECRET = "unit-test-secret-with-enough-entropy";
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("round-trips the signed user id", () => {
    const token = signAppToken("user-42");

    expect(token.split(".")).toHaveLength(3);
    expect(verifyAppToken(token)).toBe("user-42");
  });

  it("rejects a token whose payload was tampered with", () => {
    const [header, payload, signature] = signAppToken("user-42").split(".");
    const changedPayload = `${payload.slice(0, -1)}${payload.endsWith("a") ? "b" : "a"}`;

    expect(verifyAppToken(`${header}.${changedPayload}.${signature}`)).toBeNull();
  });

  it("rejects expired tokens", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
    const token = signAppToken("user-42");

    vi.setSystemTime(new Date("2025-02-02T00:00:00.000Z"));
    expect(verifyAppToken(token)).toBeNull();
  });

  it("fails closed when no signing secret is configured", () => {
    for (const key of ENV_KEYS) delete process.env[key];

    expect(() => signAppToken("user-42")).toThrow("JWT_SECRET is missing");
  });
});
