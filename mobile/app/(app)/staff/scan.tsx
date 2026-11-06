import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StaffAttendanceScanBoard } from "../../../components/staff-attendance-scan-board";

export default function StaffScanScreen() {
  return (
    <SafeAreaView className="min-h-0 flex-1 bg-[#0B1530]" edges={["top", "bottom"]} testID="staff-scan-screen">
      <View className="min-h-0 flex-1">
        <StaffAttendanceScanBoard />
      </View>
    </SafeAreaView>
  );
}
