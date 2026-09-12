import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
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
}: {
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
}) {
  return (
    <View className="gap-4">
      <View className="min-h-[250px] items-center justify-center rounded-md border border-dashed border-blue-300 bg-blue-50/40 px-6 py-10">
        <Ionicons name="arrow-up-outline" size={34} color="#2855F6" />
        <Text className="mt-3 text-base font-semibold text-blue-700">{heading}</Text>
        <Text className="mt-1 text-center text-sm text-ink-700">{description}</Text>
        <Button className="mt-4" disabled={disabled} onPress={onBrowse}>
          {browseLabel}
        </Button>
        <Text className="mt-4 text-xs text-ink-600">Supported format: {supportedFormat}</Text>
      </View>
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <Text className="text-sm font-medium text-ink-800">Required columns: {requiredColumns}</Text>
        <View className="flex-row flex-wrap gap-4">
          {onDownloadTemplate ? (
            <Pressable accessibilityRole="button" disabled={disabled} onPress={onDownloadTemplate}>
              <Text className={`text-sm font-semibold text-blue-700 ${disabled ? "opacity-50" : ""}`}>{templateLabel || "Download template"}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" disabled={disabled} onPress={onDownloadSample}>
            <Text className={`text-sm font-semibold text-blue-700 ${disabled ? "opacity-50" : ""}`}>{sampleLabel}</Text>
          </Pressable>
        </View>
      </View>
      <View className="rounded-md bg-amber-50 px-3 py-3">
        <Text className="text-sm text-amber-900">{note}</Text>
      </View>
    </View>
  );
}
