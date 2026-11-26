import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { registerPhotoCapture } from "../lib/photo-capture";
import type { PickedFile } from "../lib/upload";

/** Full-screen camera behind "Take photo" on every attach button. Mounted once in the root layout. */
export function PhotoCaptureHost() {
  const [open, setOpen] = useState(false);
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resolver = useRef<((file: PickedFile | null) => void) | null>(null);
  const camRef = useRef<CameraView | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (Platform.OS === "web") return;
    registerPhotoCapture(
      () =>
        new Promise<PickedFile | null>((resolve) => {
          resolver.current?.(null);
          resolver.current = resolve;
          setError("");
          setOpen(true);
        })
    );
    return () => registerPhotoCapture(null);
  }, []);

  function finish(file: PickedFile | null) {
    resolver.current?.(file);
    resolver.current = null;
    setOpen(false);
  }

  async function snap() {
    if (busy) return;
    setBusy(true);
    try {
      const pic = await camRef.current?.takePictureAsync({ quality: 0.6 });
      if (pic?.uri) finish({ uri: pic.uri, name: `photo-${Date.now()}.jpg`, type: "image/jpeg" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not take the photo.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={() => finish(null)} statusBarTranslucent>
      <View className="flex-1 bg-black">
        <CameraView ref={camRef} style={{ flex: 1 }} facing={facing} onMountError={(e) => setError(e.message || "Could not start the camera.")} />
        <View className="absolute left-0 right-0 flex-row items-center justify-between px-4" style={{ top: insets.top + 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close camera" onPress={() => finish(null)} className="h-10 w-10 items-center justify-center rounded-full bg-black/40">
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch camera"
            onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
            className="h-10 w-10 items-center justify-center rounded-full bg-black/40"
          >
            <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
          </Pressable>
        </View>
        {error ? (
          <Text className="absolute left-4 right-4 text-center text-sm text-white" style={{ bottom: insets.bottom + 120 }}>
            {error}
          </Text>
        ) : null}
        <View className="absolute left-0 right-0 items-center" style={{ bottom: insets.bottom + 28 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            onPress={() => void snap()}
            className="h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white"
          >
            <View className={`h-14 w-14 rounded-full ${busy ? "bg-white/50" : "bg-white"}`} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
