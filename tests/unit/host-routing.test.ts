import { describe, expect, it } from "vitest";
import {
  hasHostnamePrefix,
  normalizeHostname,
  normalizeSchoolWebsiteSlug,
  schoolSlugFromHostname,
  schoolWebsiteDomain,
  schoolWebsiteHostname,
  validateSchoolWebsiteSlug,
} from "../../lib/host-routing";

describe("host routing", () => {
  it("normalizes forwarded host values", () => {
    expect(normalizeHostname(" APP.STAGING.ANEKIO.COM:443, proxy.internal ")).toBe("app.staging.anekio.com");
  });

  it("normalizes a school-entered website slug", () => {
    expect(normalizeSchoolWebsiteSlug(" Green Valley Public School ")).toBe("green-valley-public-school");
  });

  it.each(["app", "admin", "api", "connect", "staging", "www"])("reserves the %s slug for Anekio", (slug) => {
    expect(() => validateSchoolWebsiteSlug(slug)).toThrow("reserved by Anekio");
  });

  it.each([
    ["https://app.anekio.com", "anekio.com"],
    ["https://app.staging.anekio.com", "staging.anekio.com"],
  ])("selects the school website domain for %s", (origin, domain) => {
    expect(schoolWebsiteDomain(origin)).toBe(domain);
  });

  it("builds the school website hostname for the current environment", () => {
    expect(schoolWebsiteHostname("Green Valley 2", "https://app.staging.anekio.com")).toBe("green-valley-2.staging.anekio.com");
    expect(schoolWebsiteHostname("greenvalley2", "https://app.anekio.com")).toBe("greenvalley2.anekio.com");
  });

  it.each([
    ["app.anekio.com", "app"],
    ["app.staging.anekio.com", "app"],
    ["admin.anekio.com", "admin"],
    ["admin.staging.anekio.com", "admin"],
  ])("recognizes %s as the %s host", (hostname, prefix) => {
    expect(hasHostnamePrefix(hostname, prefix)).toBe(true);
  });

  it.each([
    ["springfield.anekio.com", "springfield"],
    ["springfield.staging.anekio.com", "springfield"],
  ])("extracts the school slug from %s", (hostname, slug) => {
    expect(schoolSlugFromHostname(hostname)).toBe(slug);
  });

  it.each([
    "anekio.com",
    "staging.anekio.com",
    "app.anekio.com",
    "app.staging.anekio.com",
    "admin.anekio.com",
    "admin.staging.anekio.com",
    "nested.school.anekio.com",
  ])("does not treat %s as a school hostname", (hostname) => {
    expect(schoolSlugFromHostname(hostname)).toBe("");
  });
});
