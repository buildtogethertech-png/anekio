/**
 * Three apps that can all live on one phone:
 *
 *   APP_VARIANT unset / "production" -> "Anekio"         in.anekio.school          Google Play (real users)
 *   APP_VARIANT=preview               -> "Anekio Preview" in.anekio.school.preview  release build to test before a Play release
 *   APP_VARIANT=development           -> "Anekio Dev"     in.anekio.school.dev      dev client: live reload with `npx expo start`
 *
 * Everything else comes from app.json. Set APP_VARIANT in eas.json profiles or before a local build.
 */
const VARIANTS = {
  development: { name: "Anekio Dev", id: "in.anekio.school.dev", scheme: "anekio-dev" },
  preview: { name: "Anekio Preview", id: "in.anekio.school.preview", scheme: "anekio-preview" },
};

module.exports = ({ config: base }) => {
  // OTA_CRITICAL=1 (npm run update:prod -- --critical) marks an update that installs as soon as it downloads.
  const config = { ...base, extra: { ...base.extra, otaCritical: process.env.OTA_CRITICAL === "1" } };
  const variant = VARIANTS[process.env.APP_VARIANT || ""];
  if (!variant) return config;
  return {
    ...config,
    name: variant.name,
    scheme: variant.scheme,
    android: { ...config.android, package: variant.id },
    ios: { ...config.ios, bundleIdentifier: variant.id },
  };
};
