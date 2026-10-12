import { useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PhoneTopBar } from "../../../components/notice-bell";
import { StaffAttendanceScanBoard } from "../../../components/staff-attendance-scan-board";

export default function StaffScanScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  return (
    <SafeAreaView className="min-h-0 flex-1 bg-ink-50" edges={wide ? ["top", "bottom"] : ["top"]} testID="staff-scan-screen">
      <PhoneTopBar />
      <View className={`min-h-0 flex-1 ${wide ? "px-5 py-3" : "px-3 py-2"}`}>
        <StaffAttendanceScanBoard />
      </View>
    </SafeAreaView>
  );
}
