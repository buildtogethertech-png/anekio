/**
 * runtimeVersion "fingerprint": an OTA update reaches only builds with the same native code.
 * The app config's `extra` section is skipped so flags such as extra.otaCritical (set per update)
 * do not change the runtime version and block delivery.
 */
const { SourceSkips } = require("@expo/fingerprint");

module.exports = {
  sourceSkips: SourceSkips.ExpoConfigExtraSection,
};
