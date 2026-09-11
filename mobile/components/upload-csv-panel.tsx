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
  onBrowse,
  onDownloadSample,
}: {
  heading?: string;
  description: string;
  requiredColumns: string;
  note: string;
  supportedFormat?: string;
  browseLabel?: string;
  sampleLabel?: string;
  onBrowse: () => void;
  onDownloadSample: () => void;
}) {
  return (
    <View className="gap-4">
      <View className="min-h-[250px] items-center justify-center rounded-md border border-dashed border-blue-300 bg-blue-50/40 px-6 py-10">
        <Ionicons name="arrow-up-outline" size={34} color="#2855F6" />
        <Text className="mt-3 text-base font-semibold text-blue-700">{heading}</Text>
        <Text className="mt-1 text-center text-sm text-ink-700">{description}</Text>
        <Button className="mt-4" onPress={onBrowse}>
          {browseLabel}
        </Button>
        <Text className="mt-4 text-xs text-ink-600">Supported format: {supportedFormat}</Text>
      </View>
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <Text className="text-sm font-medium text-ink-800">Required columns: {requiredColumns}</Text>
        <Pressable accessibilityRole="button" onPress={onDownloadSample}>
          <Text className="text-sm font-semibold text-blue-700">{sampleLabel}</Text>
        </Pressable>
      </View>
      <View className="rounded-md bg-amber-50 px-3 py-3">
        <Text className="text-sm text-amber-900">{note}</Text>
      </View>
    </View>
  );
}
