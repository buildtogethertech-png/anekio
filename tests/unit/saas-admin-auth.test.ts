import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_COOKIE,
  adminEmailAllowed,
  createAdminSession,
  localAdminLoginAvailable,
  readAdminSession,
  verifyLocalAdminLogin,
} from "../../lib/saas-admin-auth";

describe("SaaS admin authentication", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "saas-admin-test-secret-with-enough-entropy";
    delete process.env.ANEKIO_ADMIN_ALLOWED_EMAILS;
    delete process.env.ANEKIO_ADMIN_ALLOWED_DOMAINS;
    delete process.env.ANEKIO_ADMIN_DEV_PASSWORD;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    delete process.env.ANEKIO_ADMIN_ALLOWED_EMAILS;
    delete process.env.ANEKIO_ADMIN_ALLOWED_DOMAINS;
    delete process.env.ANEKIO_ADMIN_DEV_PASSWORD;
    process.env.NODE_ENV = "test";
  });

  it("allows only the built-in exact account and exact Anekio domains", () => {
    expect(adminEmailAllowed("buildtogether.tech@gmail.com")).toBe(true);
    expect(adminEmailAllowed("OWNER@ANEKIO.COM")).toBe(true);
    expect(adminEmailAllowed("finance@anekio.in")).toBe(true);
    expect(adminEmailAllowed("owner@sub.anekio.com")).toBe(false);
    expect(adminEmailAllowed("owner@fakeanekio.com")).toBe(false);
    expect(adminEmailAllowed("buildtogether.tech+admin@gmail.com")).toBe(false);
  });

  it("supports explicit additive allowlist configuration", () => {
    process.env.ANEKIO_ADMIN_ALLOWED_EMAILS = "operator@example.com";
    process.env.ANEKIO_ADMIN_ALLOWED_DOMAINS = "trusted.example";

    expect(adminEmailAllowed("operator@example.com")).toBe(true);
    expect(adminEmailAllowed("finance@trusted.example")).toBe(true);
    expect(adminEmailAllowed("finance@sub.trusted.example")).toBe(false);
  });

  it("creates a signed, expiring session with a CSRF token", () => {
    const now = Date.parse("2026-08-30T10:00:00.000Z");
    const token = createAdminSession("buildtogether.tech@gmail.com", now);
    const cookie = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`;
    const session = readAdminSession(cookie, now + 1_000);

    expect(session).toMatchObject({ email: "buildtogether.tech@gmail.com" });
    expect(session?.csrf.length).toBeGreaterThan(20);
    expect(readAdminSession(cookie, now + 13 * 60 * 60 * 1_000)).toBeNull();
  });

  it("accepts the retained local credential only for allowlisted accounts outside production", () => {
    expect(localAdminLoginAvailable()).toBe(true);
    expect(verifyLocalAdminLogin("buildtogether.tech@gmail.com", "12345")).toBe(true);
    expect(verifyLocalAdminLogin("outsider@example.com", "12345")).toBe(false);
    expect(verifyLocalAdminLogin("buildtogether.tech@gmail.com", "wrong")).toBe(false);

    process.env.ANEKIO_ADMIN_DEV_PASSWORD = "different-local-secret";
    expect(verifyLocalAdminLogin("finance@anekio.in", "different-local-secret")).toBe(true);

    process.env.NODE_ENV = "production";
    expect(localAdminLoginAvailable()).toBe(false);
    expect(verifyLocalAdminLogin("buildtogether.tech@gmail.com", "different-local-secret")).toBe(false);
  });

  it("rejects a forged session", () => {
    const token = createAdminSession("buildtogether.tech@gmail.com");
    const forged = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    expect(readAdminSession(`${ADMIN_SESSION_COOKIE}=${forged}`)).toBeNull();
  });
});
