import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";
import { canOpenStaffScan } from "../lib/staff-attendance-scan";
import { AttendanceKiosk } from "./staff-attendance-qr";

/** /staff/scan: the same check-in desk as the phone, as a page of its own (a laptop or tablet at the gate). */
export function StaffAttendanceScanBoard() {
  const router = useRouter();
  const { token, user } = useSession();
  const { data, reload } = useRecord();

  if (!canOpenStaffScan(user?.permissions)) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-[#0B1530] p-6" testID="staff-scan-board">
        <Ionicons name="lock-closed-outline" size={28} color="rgba(255,255,255,0.7)" />
        <Text className="text-[18px] font-semibold text-white">No access</Text>
        <Text className="text-center text-[14px] text-white/60">Staff attendance scanning needs staff.attendance or staff.edit.</Text>
      </View>
    );
  }

  if (data?.staffAttendanceSetup?.qr === false) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-[#0B1530] p-6" testID="staff-scan-board">
        <Ionicons name="qr-code-outline" size={28} color="rgba(255,255,255,0.7)" />
        <Text className="text-[18px] font-semibold text-white">QR attendance is off</Text>
        <Text className="text-center text-[14px] text-white/60">Turn it on in Settings → Staff attendance.</Text>
      </View>
    );
  }

  return (
    <View className="min-h-0 flex-1 bg-[#0B1530]" testID="staff-scan-board">
      <AttendanceKiosk
        inline
        open
        token={token}
        onClose={() => router.replace("/staff" as never)}
        onScanned={() => void reload().catch(() => undefined)}
      />
    </View>
  );
}
