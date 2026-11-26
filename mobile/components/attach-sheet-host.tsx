import Ionicons from "@expo/vector-icons/Ionicons";
import { Camera, CameraView } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Image, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { registerAttachSheet, type AttachSource } from "../lib/photo-capture";
import type { PickedFile } from "../lib/upload";

type Stage = "sheet" | "camera" | "preview";

/** Attach on the phone: Camera / Gallery (/ File) sheet, then the in-app camera. Mounted once in the root layout. */
export function AttachSheetHost() {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState(false);
  const [stage, setStage] = useState<Stage>("sheet");
  const [shot, setShot] = useState<PickedFile | null>(null);
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [canAsk, setCanAsk] = useState(true);
  const resolver = useRef<((source: AttachSource | null) => void) | null>(null);
  const camRef = useRef<CameraView | null>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (Platform.OS === "web") return;
    registerAttachSheet(
      (opts) =>
        new Promise<AttachSource | null>((resolve) => {
          resolver.current?.(null);
          resolver.current = resolve;
          setFiles(opts.files);
          setStage("sheet");
          setShot(null);
          setError("");
          setBlocked(false);
          setOpen(true);
        })
    );
    return () => registerAttachSheet(null);
  }, []);

  function finish(source: AttachSource | null) {
    const resolve = resolver.current;
    resolver.current = null;
    setOpen(false);
    // Let the sheet close before the phone's picker opens on top.
    setTimeout(() => resolve?.(source), source && source.kind !== "photo" ? 250 : 0);
  }

  async function openCamera() {
    setError("");
    // Read it fresh each time: they may have just allowed it in Settings.
    let now = await Camera.getCameraPermissionsAsync();
    if (!now.granted && now.canAskAgain) now = await Camera.requestCameraPermissionsAsync();
    setCanAsk(now.canAskAgain);
    setBlocked(!now.granted);
    if (now.granted) setStage("camera");
  }

  async function snap() {
    if (busy) return;
    setBusy(true);
    try {
      const pic = await camRef.current?.takePictureAsync({ quality: 0.6 });
      if (pic?.uri) {
        setShot({ uri: pic.uri, name: `photo-${Date.now()}.jpg`, type: "image/jpeg" });
        setStage("preview");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not take the photo.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  if (stage === "camera" || stage === "preview") {
    return (
      <Modal visible animationType="fade" onRequestClose={() => (stage === "preview" ? setStage("camera") : setStage("sheet"))} statusBarTranslucent>
        <View className="flex-1 bg-black">
          {stage === "preview" && shot ? (
            <Image source={{ uri: shot.uri }} style={{ flex: 1 }} resizeMode="contain" />
          ) : (
            <CameraView ref={camRef} style={{ flex: 1 }} facing={facing} onMountError={(e) => setError(e.message || "Could not start the camera.")} />
          )}
          <View className="absolute left-0 right-0 flex-row items-center justify-between px-4" style={{ top: insets.top + 12 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close camera"
              onPress={() => finish(null)}
              className="h-11 w-11 items-center justify-center rounded-full bg-black/50"
            >
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
            {stage === "camera" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Switch camera"
                onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
                className="h-11 w-11 items-center justify-center rounded-full bg-black/50"
              >
                <Ionicons name="camera-reverse-outline" size={22} color="#fff" />
              </Pressable>
            ) : null}
          </View>
          {error ? (
            <Text className="absolute left-6 right-6 text-center text-sm text-white" style={{ bottom: insets.bottom + 130 }}>
              {error}
            </Text>
          ) : null}
          {stage === "camera" ? (
            <View className="absolute left-0 right-0 items-center" style={{ bottom: insets.bottom + 32 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Take photo"
                onPress={() => void snap()}
                className="h-[76px] w-[76px] items-center justify-center rounded-full border-4 border-white"
              >
                <View className={`h-[58px] w-[58px] rounded-full ${busy ? "bg-white/50" : "bg-white"}`} />
              </Pressable>
            </View>
          ) : (
            <View className="absolute left-0 right-0 flex-row gap-3 px-5" style={{ bottom: insets.bottom + 28 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setStage("camera")}
                className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-white/40 bg-black/40"
              >
                <Ionicons name="refresh" size={18} color="#fff" />
                <Text className="text-[15px] font-semibold text-white">Retake</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => shot && finish({ kind: "photo", file: shot })}
                className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-[#1F45C7]"
              >
                <Ionicons name="checkmark" size={20} color="#fff" />
                <Text className="text-[15px] font-semibold text-white">Use photo</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>
    );
  }

  const tiles: { key: string; icon: keyof typeof Ionicons.glyphMap; label: string; bg: string; fg: string; onPress: () => void }[] = [
    { key: "camera", icon: "camera", label: "Camera", bg: "#EEF3FF", fg: "#1F45C7", onPress: () => void openCamera() },
    { key: "photos", icon: "images", label: "Gallery", bg: "#ECFDF5", fg: "#047857", onPress: () => finish({ kind: "photos" }) },
    ...(files ? [{ key: "files", icon: "document-text" as const, label: "File", bg: "#FFF7ED", fg: "#C2410C", onPress: () => finish({ kind: "files" }) }] : []),
  ];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => finish(null)} statusBarTranslucent>
      <Pressable accessibilityLabel="Close" onPress={() => finish(null)} className="flex-1 bg-black/40" />
      <View className="rounded-t-[24px] bg-white px-5 pt-3" style={{ paddingBottom: insets.bottom + 20 }}>
        <View className="mb-4 h-1 w-10 self-center rounded-full bg-ink-200" />
        <Text className="text-[18px] font-semibold text-ink-900">{files ? "Add a photo or file" : "Add a photo"}</Text>
        <Text className="mt-0.5 text-[13px] text-ink-600">{files ? "Take a photo, or pick one from the gallery or files." : "Take a photo, or pick one from the gallery."}</Text>
        <View className="mt-5 flex-row gap-3">
          {tiles.map((t) => (
            <Pressable
              key={t.key}
              accessibilityRole="button"
              accessibilityLabel={t.label}
              onPress={t.onPress}
              className="flex-1 items-center gap-2 rounded-2xl border border-ink-100 py-4 active:bg-ink-50"
            >
              <View className="h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: t.bg }}>
                <Ionicons name={t.icon} size={26} color={t.fg} />
              </View>
              <Text className="text-[14px] font-semibold text-ink-900">{t.label}</Text>
            </Pressable>
          ))}
        </View>
        {blocked ? (
          <View className="mt-4 flex-row items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
            <Ionicons name="camera-outline" size={20} color="#B45309" />
            <Text className="min-w-0 flex-1 text-[13px] text-amber-900">Camera is off for Anekio. Allow it to take photos here.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => (canAsk ? void openCamera() : void Linking.openSettings())}
              className="rounded-lg bg-amber-600 px-3 py-2"
            >
              <Text className="text-[13px] font-semibold text-white">{canAsk ? "Allow camera" : "Open settings"}</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => finish(null)} className="mt-4 h-12 items-center justify-center rounded-xl bg-ink-50">
          <Text className="text-[15px] font-semibold text-ink-800">Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
