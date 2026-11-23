// react-native-ble-plx ships BLUETOOTH_SCAN with usesPermissionFlags="neverForLocation".
// With that flag Android hides iBeacon adverts from the app, so the school beacon never shows up.
// Strip the flag (we already ask for location) so beacons come through.
const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

module.exports = function withBleBeaconScan(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    AndroidConfig.Manifest.ensureToolsAvailable(manifest);
    const perms = manifest.manifest["uses-permission"] || [];
    let scan = perms.find((p) => p.$["android:name"] === "android.permission.BLUETOOTH_SCAN");
    if (!scan) {
      scan = { $: { "android:name": "android.permission.BLUETOOTH_SCAN" } };
      perms.push(scan);
    }
    delete scan.$["android:usesPermissionFlags"];
    scan.$["tools:remove"] = "android:usesPermissionFlags";
    manifest.manifest["uses-permission"] = perms;
    return cfg;
  });
};
