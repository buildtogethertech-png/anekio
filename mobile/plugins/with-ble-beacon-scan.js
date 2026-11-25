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

    // The BLUETOOTH permissions make Play treat Bluetooth as required hardware and drop devices without it.
    // Bluetooth is only for beacon check in (the app falls back to GPS), so mark it optional.
    const features = manifest.manifest["uses-feature"] || [];
    for (const name of ["android.hardware.bluetooth", "android.hardware.bluetooth_le"]) {
      const feature = features.find((f) => f.$["android:name"] === name);
      if (feature) feature.$["android:required"] = "false";
      else features.push({ $: { "android:name": name, "android:required": "false" } });
    }
    manifest.manifest["uses-feature"] = features;
    return cfg;
  });
};
