import { Alert } from "react-native";
import type { PickedFile } from "./upload";

type Opener = () => Promise<PickedFile | null>;
let opener: Opener | null = null;

/** PhotoCaptureHost (mounted once in the root layout) registers the in-app camera here. */
export function registerPhotoCapture(open: Opener | null) {
  opener = open;
}

/** "Take photo": the in-app camera (expo-camera, already in the build). Resolves null if closed or not allowed. */
export async function takePhoto(): Promise<PickedFile | null> {
  if (!opener) return null;
  const { Camera } = require("expo-camera") as typeof import("expo-camera");
  const current = await Camera.getCameraPermissionsAsync();
  const granted = current.granted || (current.canAskAgain && (await Camera.requestCameraPermissionsAsync()).granted);
  if (!granted) {
    Alert.alert("Camera is off", "Camera access is off for Anekio. Turn it on in Settings, or choose a photo instead.");
    return null;
  }
  return opener();
}
