import { Platform } from "react-native";
import { appBuild } from "./app-version";
import { act } from "./mutate";

/** iPhone 7 (iPhone9,x) and newer can read NFC tags; iPads cannot. */
function iosNfc(modelId: string) {
  const m = /^iPhone(\d+),/.exec(modelId);
  if (m) return Number(m[1]) >= 9 ? "yes" : "no";
  return /^iPad|^iPod/.test(modelId) ? "no" : "unknown";
}

const sent = new Set<string>();

/** Once, when the server asks (session.deviceCheck): this staff phone's brand, model and NFC support. */
export async function reportDevice(token: string, userId: string) {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return;
  if (sent.has(userId)) return;
  let Device: typeof import("expo-device");
  try {
    Device = require("expo-device") as typeof import("expo-device");
  } catch {
    return;
  }
  sent.add(userId);
  const modelId = String(Device.modelId || "");
  let nfc = "unknown";
  try {
    nfc = Platform.OS === "android" ? ((await Device.hasPlatformFeatureAsync("android.hardware.nfc")) ? "yes" : "no") : iosNfc(modelId);
  } catch {
    /* keep "unknown" */
  }
  try {
    await act(token, "reportDevice", {
      platform: Platform.OS,
      nfc,
      brand: Device.brand || Device.manufacturer || "",
      model: Device.modelName || "",
      modelId,
      os: `${Device.osName || Platform.OS} ${Device.osVersion || ""}`.trim(),
      appBuild: String(appBuild() || ""),
    });
  } catch (error) {
    sent.delete(userId);
    throw error;
  }
}
