import { useEffect, useRef, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Platform, Pressable, Text, View } from "react-native";
import type { PickedFile } from "../lib/upload";
import { Button } from "./ui";

export function UploadCsvPanel({
  heading = "Choose a CSV file",
  description,
  requiredColumns,
  note,
  supportedFormat = ".csv",
  browseLabel = "Browse",
  sampleLabel = "Download sample file",
  templateLabel,
  onBrowse,
  onDownloadTemplate,
  onDownloadSample,
  disabled,
  browseDisabled,
  downloadDisabled,
  onDropFile,
}: {
  /** Web: a file dropped on the box. Same handling as a file picked with Browse. */
  onDropFile?: (file: PickedFile) => void;
  heading?: string;
  description: string;
  requiredColumns: string;
  note: string;
  supportedFormat?: string;
  browseLabel?: string;
  sampleLabel?: string;
  templateLabel?: string;
  onBrowse: () => void;
  onDownloadTemplate?: () => void;
  onDownloadSample: () => void;
  disabled?: boolean;
  browseDisabled?: boolean;
  downloadDisabled?: boolean;
}) {
  const isBrowseDisabled = browseDisabled ?? disabled;
  const isDownloadDisabled = downloadDisabled ?? disabled;
  const zone = useRef<View>(null);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState("");
  const canDrop = Platform.OS === "web" && Boolean(onDropFile) && !isBrowseDisabled;
  const allowed = supportedFormat
    .split(",")
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);

  // Web only: react-native-web renders View as a div, so native drag events work on it.
  useEffect(() => {
    const el = zone.current as unknown as HTMLElement | null;
    if (!canDrop || !el?.addEventListener) return;
    let depth = 0;
    const over = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const enter = (e: DragEvent) => {
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const name = file.name.toLowerCase();
      if (allowed.length && !allowed.some((ext) => name.endsWith(ext))) {
        setDropError(`Drop a ${allowed.join(" or ")} file.`);
        return;
      }
      setDropError("");
      onDropFile?.({ uri: URL.createObjectURL(file), name: file.name, type: file.type || "application/octet-stream" });
    };
    el.addEventListener("dragover", over);
    el.addEventListener("dragenter", enter);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragenter", enter);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, [canDrop, onDropFile, supportedFormat]);

  return (
    <View className="gap-4">
      <View
        ref={zone}
        className={`min-h-[250px] items-center justify-center rounded-md border border-dashed px-6 py-10 ${dragging ? "border-2 border-blue-500 bg-blue-100/70" : "border-blue-300 bg-blue-50/40"}`}
      >
        <Ionicons name={dragging ? "download-outline" : "arrow-up-outline"} size={34} color="#2855F6" />
        <Text className="mt-3 text-base font-semibold text-blue-700">{dragging ? "Drop the file to upload" : heading}</Text>
        <Text className="mt-1 text-center text-sm text-ink-700">
          {canDrop && !dragging ? `Drag a file here, or click Browse. ${description}` : description}
        </Text>
        <Button className="mt-4" variant={isBrowseDisabled ? "ghost" : "primary"} disabled={isBrowseDisabled} onPress={onBrowse}>
          {isBrowseDisabled && browseLabel === "Browse" ? "Locked until setup step is done" : browseLabel}
        </Button>
        <Text className="mt-4 text-xs text-ink-600">Supported format: {supportedFormat}</Text>
        {dropError ? <Text className="mt-2 text-xs font-medium text-red-700">{dropError}</Text> : null}
      </View>
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <Text className="text-sm font-medium text-ink-800">Required columns: {requiredColumns}</Text>
        <View className="flex-row flex-wrap gap-4">
          {onDownloadTemplate ? (
            <Pressable accessibilityRole="button" disabled={isDownloadDisabled} onPress={onDownloadTemplate}>
              <Text className={`text-sm font-semibold text-blue-700 ${isDownloadDisabled ? "opacity-50" : ""}`}>{templateLabel || "Download template"}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" disabled={isDownloadDisabled} onPress={onDownloadSample}>
            <Text className={`text-sm font-semibold text-blue-700 ${isDownloadDisabled ? "opacity-50" : ""}`}>{sampleLabel}</Text>
          </Pressable>
        </View>
      </View>
      <View className="rounded-md bg-amber-50 px-3 py-3">
        <Text className="text-sm text-amber-900">{note}</Text>
      </View>
    </View>
  );
}
