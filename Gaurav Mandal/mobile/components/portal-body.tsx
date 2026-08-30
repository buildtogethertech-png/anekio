import { Linking, Text, View } from "react-native";
import {
  DeskBoard,
  AdmissionsBoard,
  ExamsBoard,
  FeesBoard,
  PeopleBoard,
  RolesBoard,
  SchoolBoard,
  StaffBoard,
} from "./office-boards";
import { InboxBoard } from "./inbox-board";
import { WeekBoard } from "./week-board";
import {
  FamilyAttendance,
  FamilyFees,
  FamilyHomeBoard,
  FamilyLetter,
  FamilyPapers,
  FamilyPath,
  FamilyProfile,
  FamilySubjects,
  FamilyTests,
  FamilyTimetable,
  TeacherAttendanceBoard,
  TeacherDeskBoard,
  TeacherExamsBoard,
  TeacherLeaveBoard,
} from "./family-boards";
import { Button, Empty, PageHeader } from "./ui";
import { MoreBoard } from "./nav-menu";
import { PORTAL_PATH } from "../lib/paths";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";
import { webOrigin } from "../lib/api";

function resolveRenewUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${webOrigin()}${url.startsWith("/") ? url : `/${url}`}`;
}

function SubscriptionLocked({ lock }: { lock: NonNullable<ReturnType<typeof useRecord>["data"]>["subscriptionLock"] }) {
  if (!lock) return null;
  const renewal = lock.renewalOn ? new Date(lock.renewalOn).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
  return (
    <View className="mx-auto w-full max-w-2xl gap-4 rounded-md border border-amber-200 bg-amber-50 p-5">
      <View className="gap-2">
        <Text className="text-xs font-semibold uppercase tracking-wide text-amber-800">Renewal required</Text>
        <Text className="text-2xl font-semibold text-ink-900">Renew Anekio to continue</Text>
        <Text className="text-sm leading-6 text-ink-700">
          {lock.schoolName} can still sign in, but school modules are hidden until the subscription is renewed.
        </Text>
      </View>
      <View className="gap-1">
        <Text className="text-sm text-ink-800">Plan amount: ₹{new Intl.NumberFormat("en-IN").format(lock.amount)}</Text>
        {renewal ? <Text className="text-sm text-ink-700">Renewal date: {renewal}</Text> : null}
      </View>
      <Button onPress={() => void Linking.openURL(resolveRenewUrl(lock.renewUrl))}>Renew securely</Button>
      <Text className="text-xs leading-5 text-ink-700">
        After payment, access becomes active again. One of our account managers will connect with you as well.
      </Text>
    </View>
  );
}

export function PortalBody({ screen }: { screen: string }) {
  const { data, error } = useRecord();
  const { nav } = useSession();

  if (error) return <Text className="text-sm text-red-700">{error}</Text>;
  if (!data) return <Text className="text-sm text-ink-700">Loading…</Text>;
  if (data.subscriptionLock) return <SubscriptionLocked lock={data.subscriptionLock} />;

  const allowed = new Set(nav.map((item) => item.key));
  if (screen !== "more" && screen in PORTAL_PATH && !allowed.has(screen)) {
    return <Empty title="No access" body="This role cannot open this page." />;
  }

  if (screen === "home") {
    return (
      <View accessibilityLabel={`${data.kind.toLowerCase()} home`} testID={`home-${data.kind.toLowerCase()}`}>
        {data.kind === "OFFICE" ? (
          <DeskBoard />
        ) : data.kind === "TEACHER" ? (
          <TeacherDeskBoard />
        ) : (
          <FamilyHomeBoard />
        )}
      </View>
    );
  }
  if (screen === "people") return <PeopleBoard />;
  if (screen === "inbox") return <InboxBoard />;
  if (screen === "admissions") return <AdmissionsBoard />;
  if (screen === "staff") return <StaffBoard />;
  if (screen === "school") return <SchoolBoard />;
  if (screen === "timetable") {
    if (data.kind === "OFFICE") return <WeekBoard />;
    if (data.kind === "TEACHER" && data.teamWeek) return <WeekBoard />;
    return <FamilyTimetable />;
  }
  if (screen === "fees") {
    if (data.kind === "OFFICE") return <FeesBoard />;
    return <FamilyFees />;
  }
  if (screen === "exams") {
    if (data.kind === "OFFICE") return <ExamsBoard />;
    if (data.kind === "TEACHER") return <TeacherExamsBoard />;
    return <FamilyTests />;
  }
  if (screen === "roles") return <RolesBoard />;
  if (screen === "attendance") {
    if (data.kind === "TEACHER") return <TeacherAttendanceBoard />;
    return <FamilyAttendance />;
  }
  if (screen === "class") {
    if (data.kind === "TEACHER") return <PeopleBoard studentOnly title={data.classLabel || "Class"} />;
    return <Empty title="No access" body="This page is for the class teacher." />;
  }
  if (screen === "leave") {
    if (data.kind === "TEACHER") return <TeacherLeaveBoard />;
    return <FamilyAttendance />;
  }
  if (screen === "subjects") return <FamilySubjects />;
  if (screen === "tests") return <FamilyTests />;
  if (screen === "papers") return <FamilyPapers />;
  if (screen === "path") return <FamilyPath />;
  if (screen === "profile") return <FamilyProfile />;
  if (screen === "more") return <MoreBoard />;
  if (screen === "letter") return <FamilyLetter />;
  if (screen === "uploads") return <TeacherExamsBoard uploads />;

  return (
    <View>
      <PageHeader kicker="Anekio" title={screen} lede="Same map as the website." />
      <Empty title="This page" body="Open another item from More." />
    </View>
  );
}
