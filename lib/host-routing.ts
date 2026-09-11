export const RESERVED_SCHOOL_SLUGS = new Set(["admin", "api", "app", "connect", "staging", "www"]);

export function normalizeHostname(value: string) {
  return value.split(",")[0].trim().split(":")[0].toLowerCase();
}

export function hasHostnamePrefix(value: string, prefix: string) {
  const hostname = normalizeHostname(value);
  return hostname === `${prefix}.localhost` || hostname.startsWith(`${prefix}.`);
}

export function normalizeSchoolWebsiteSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function validateSchoolWebsiteSlug(value: string) {
  const slug = normalizeSchoolWebsiteSlug(value);
  if (!slug) throw new Error("Enter a website slug.");
  if (RESERVED_SCHOOL_SLUGS.has(slug)) {
    throw new Error(`${slug} is reserved by Anekio. Choose another website slug.`);
  }
  return slug;
}

export function schoolWebsiteDomain(value: string) {
  let hostname = "";
  try {
    hostname = new URL(value).hostname.toLowerCase();
  } catch {
    hostname = normalizeHostname(value);
  }
  return hostname === "staging.anekio.com" || hostname.endsWith(".staging.anekio.com")
    ? "staging.anekio.com"
    : "anekio.com";
}

export function schoolWebsiteHostname(slug: string, origin: string) {
  return `${validateSchoolWebsiteSlug(slug)}.${schoolWebsiteDomain(origin)}`;
}

export function schoolSlugFromHostname(value: string) {
  const hostname = normalizeHostname(value);
  const roots = ["staging.anekio.com", "anekio.com"];

  for (const root of roots) {
    const suffix = `.${root}`;
    if (!hostname.endsWith(suffix)) continue;

    const slug = hostname.slice(0, -suffix.length);
    if (!slug || slug.includes(".") || RESERVED_SCHOOL_SLUGS.has(slug)) return "";
    return slug;
  }

  return "";
}
