/**
 * Build variants so test builds never clash with the Play Store app on the same phone.
 *
 *   APP_VARIANT unset / "production" -> "Anekio",     in.anekio.school      (Google Play)
 *   APP_VARIANT=development           -> "Anekio Dev", in.anekio.school.dev  (dev client, quick/local/staging test APKs)
 *
 * Everything else comes from app.json. Set APP_VARIANT in eas.json profiles or before a local build.
 */
module.exports = ({ config }) => {
  const variant = process.env.APP_VARIANT || "production";
  if (variant === "production") return config;

  return {
    ...config,
    name: "Anekio Dev",
    scheme: "anekio-dev",
    android: { ...config.android, package: "in.anekio.school.dev" },
    ios: { ...config.ios, bundleIdentifier: "in.anekio.school.dev" },
  };
};
