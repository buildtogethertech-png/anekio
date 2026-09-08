import { RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PhoneTopBar } from "./notice-bell";
import { PortalBody } from "./portal-body";
import { useRecord } from "../lib/record";

export function ScreenPage({ screen }: { screen: string }) {
  const { reload, refreshing, data } = useRecord();
  const { width } = useWindowDimensions();
  const wide = width >= 768;
  const workspace =
    screen === "people" ||
    screen === "admissions" ||
    (screen === "attendance" && data?.kind === "TEACHER") ||
    screen === "staff" ||
    screen === "exams" ||
    (screen === "timetable" && data?.kind === "OFFICE");

  const teacherExams = screen === "exams" && data?.kind === "TEACHER";
  const teacherAttendance = screen === "attendance" && data?.kind === "TEACHER";
  const parentTests = screen === "tests" && data?.kind === "PARENT";
  const workspacePage = workspace || parentTests;
  return (
    <SafeAreaView
      className={`min-h-0 flex-1 overflow-hidden ${screen === "exams" ? "bg-[#F7F9FC]" : "bg-ink-50"}`}
      edges={wide ? ["top", "bottom"] : ["top"]}
      testID={`portal-screen-${screen}`}
    >
      <PhoneTopBar />
      {workspacePage ? (
        <View className={`min-h-0 flex-1 ${teacherExams || teacherAttendance ? (wide ? "px-5 py-3" : "px-3 py-2") : parentTests ? "px-4 py-5 sm:px-10 sm:py-8" : "px-6 py-6 sm:px-8 sm:py-6"}`}>
          <PortalBody screen={screen} />
        </View>
      ) : (
        <ScrollView
          className="min-h-0 flex-1"
          contentContainerClassName="px-4 py-5 sm:px-10 sm:py-8"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => reload()} />}
        >
          <PortalBody screen={screen} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
