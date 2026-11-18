import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { Linking, Pressable, Text, View } from "react-native";
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
  TeacherLeaveBoard,
} from "./family-boards";
import { TeacherExamsBoard } from "./teacher-exams-workspace";
import { TeacherPapersBoard } from "./teacher-papers";
import { Button, Empty, PageHeader } from "./ui";
import { AccountActions, MoreBoard } from "./nav-menu";
import { ParentExamination, ParentExaminationError, ParentExaminationLoading } from "./parent-examination";
import { OnboardingBoard } from "./onboarding-board";
import { SubscriptionBoard } from "./subscription-board";
import { PORTAL_PATH, examsScreenForKind, testsScreenForKind } from "../lib/paths";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";
import { webOrigin } from "../lib/api";

function resolveRenewUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${webOrigin()}${url.startsWith("/") ? url : `/${url}`}`;
}

function lockDate(value: string | Date) {
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Shown instead of the app while the school's plan is not active. Admins see what happened, the price
 * worked out, and how to renew or talk to us. Everyone else is told to ask the school's admin.
 */
function SubscriptionLocked({ lock }: { lock: NonNullable<ReturnType<typeof useRecord>["data"]>["subscriptionLock"] }) {
  const router = useRouter();
  if (!lock) return null;
  const ended = lock.renewalOn ? lockDate(lock.renewalOn) : "";
  const stopped = lock.reason === "STOPPED";
  const title = stopped ? "Your Anekio plan is paused" : lock.free ? "Your free trial has ended" : "Your Anekio plan has ended";
  const inr = (n: number) => `₹${new Intl.NumberFormat("en-IN").format(Math.round(n))}`;
  const start = new Date();
  const until = new Date(start);
  until.setFullYear(until.getFullYear() + 1);
  const wa = String(lock.supportPhone || "").replace(/\D/g, "");
  const waDigits = wa.length === 10 ? `91${wa}` : wa;

  if (!lock.canRenew) {
    return (
      <View className="mx-auto mt-6 w-full max-w-md items-center rounded-2xl border border-ink-100 bg-white px-6 py-8">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-amber-50">
          <Ionicons name="lock-closed-outline" size={24} color="#B45309" />
        </View>
        <Text className="mt-4 text-center text-xl font-semibold text-ink-900">{lock.schoolName} needs to renew Anekio</Text>
        <Text className="mt-2 text-center text-sm leading-6 text-ink-600">
          The school's plan is not active right now, so the app is closed for a while. Please ask your school office or admin to renew it. Nothing is lost.
        </Text>
      </View>
    );
  }

  return (
    <View className="mx-auto mt-2 w-full max-w-lg items-center rounded-2xl border border-ink-100 bg-white px-6 py-8">
      <View className="h-14 w-14 items-center justify-center rounded-full bg-amber-50">
        <Ionicons name={stopped ? "pause-circle-outline" : "hourglass-outline"} size={26} color="#B45309" />
      </View>
      <Text className="mt-4 text-center text-2xl font-semibold text-ink-900">{title}</Text>
      <Text className="mt-1 text-center text-sm text-ink-500">
        {lock.schoolName}
        {ended && !stopped ? ` · ended on ${ended}` : ""}
      </Text>

      <View className="mt-4 flex-row items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5">
        <Ionicons name="shield-checkmark-outline" size={15} color="#047857" />
        <Text className="text-[13px] font-medium text-emerald-800">Your students, fees and records are safe</Text>
      </View>
      <Text className="mt-3 text-center text-sm leading-6 text-ink-600">Renew to open the app again for everyone in your school.</Text>

      <View className="mt-5 w-full items-center rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-4">
        <Text className="text-3xl font-bold text-ink-900">
          {inr(lock.amount)}
          <Text className="text-base font-medium text-ink-500"> / year</Text>
        </Text>
        {lock.seats && lock.rateMonthly ? (
          <Text className="mt-1 text-[13px] text-ink-600">{`${lock.seats} students × ₹${lock.rateMonthly} × 12 months`}</Text>
        ) : lock.seats ? (
          <Text className="mt-1 text-[13px] text-ink-600">{`For ${lock.seats} students`}</Text>
        ) : null}
        <Text className="mt-1 text-[12px] text-ink-500">{`Covers ${lockDate(start)} → ${lockDate(until)}`}</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => void Linking.openURL(resolveRenewUrl(lock.renewUrl))}
        className="mt-5 w-full items-center rounded-xl bg-[#1F45C7] py-3.5 active:opacity-80"
      >
        <Text className="text-[15px] font-semibold text-white">Renew now</Text>
      </Pressable>
      <View className="mt-3 w-full flex-row gap-2">
        {waDigits ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void Linking.openURL(`https://wa.me/${waDigits}?text=${encodeURIComponent(`Hi, I want to renew Anekio for ${lock.schoolName}.`)}`)}
            className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-ink-200 py-3 active:bg-ink-50"
          >
            <Ionicons name="logo-whatsapp" size={16} color="#15803D" />
            <Text className="text-[14px] font-semibold text-ink-800">Talk to us</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/subscription" as never)}
          className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-ink-200 py-3 active:bg-ink-50"
        >
          <Ionicons name="receipt-outline" size={16} color="#334155" />
          <Text className="text-[14px] font-semibold text-ink-800">Plan & invoices</Text>
        </Pressable>
      </View>
      <Text className="mt-4 text-center text-xs leading-5 text-ink-500">Access opens again as soon as the payment goes through.</Text>
    </View>
  );
}

function LoadError({ detail, onRetry }: { detail: string; onRetry: () => void }) {
  const showDevelopmentDetail = typeof __DEV__ !== "undefined" && __DEV__;
  return (
    <View className="mx-auto w-full max-w-md items-center gap-4 rounded-xl border border-ink-200 bg-white px-6 py-8">
      <View className="h-11 w-11 items-center justify-center rounded-full bg-[#EEF4FF]">
        <Text className="text-xl font-semibold text-clay-500">!</Text>
      </View>
      <View className="items-center gap-1.5">
        <Text className="text-xl font-semibold text-ink-900">Something went wrong</Text>
        <Text className="text-center text-sm leading-6 text-ink-700">We’re having trouble loading this page. Please wait a moment and try again.</Text>
        {showDevelopmentDetail ? <Text className="mt-2 text-center text-xs text-red-700">{detail}</Text> : null}
      </View>
      <Button onPress={onRetry}>Try again</Button>
    </View>
  );
}

export function PortalBody({ screen }: { screen: string }) {
  const { data, error, reload } = useRecord();
  const { nav, user } = useSession();
  const parentTests = screen === "tests" && user?.portal === "PARENT";

  if (error) {
    if (parentTests) return <ParentExaminationError message={error} onRetry={() => void reload()} />;
    return <LoadError detail={error} onRetry={() => void reload()} />;
  }
  if (!data) {
    if (parentTests) return <ParentExaminationLoading />;
    return <Text className="text-sm text-ink-700">Loading…</Text>;
  }
  if (data.subscriptionLock) {
    // A locked school's admin can still open their plan and invoices.
    if (screen === "subscription" && data.subscription) return <SubscriptionBoard />;
    return <SubscriptionLocked lock={data.subscriptionLock} />;
  }
  if (screen === "profile")
    return (
      <View>
        <FamilyProfile />
        <AccountActions />
      </View>
    );

  const allowed = new Set(nav.map((item) => item.key));
  // "My leave" is personal (opened from the profile menu), so every staff login can open it even
  // when Leave isn't one of their sidebar items, the same way My profile works.
  const ownLeave = screen === "leave" && (data.kind === "OFFICE" || data.kind === "TEACHER");
  if (screen !== "more" && screen in PORTAL_PATH && !allowed.has(screen) && !ownLeave) {
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
  if (screen === "onboarding") return <OnboardingBoard />;
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
    const examsScreen = examsScreenForKind(data.kind);
    if (examsScreen === "office") return <ExamsBoard />;
    if (examsScreen === "teacher") {
      return (
        <View className="min-h-0 flex-1">
          <TeacherPapersBoard />
        </View>
      );
    }
    if (examsScreen === "denied") {
      return <Empty title="No access" body="This role cannot open this page." />;
    }
    return <FamilyTests />;
  }
  if (screen === "roles") return <RolesBoard />;
  if (screen === "subscription") return <SubscriptionBoard />;
  if (screen === "attendance") {
    if (data.kind === "TEACHER") {
      return (
        <View className="min-h-0 flex-1">
          <TeacherAttendanceBoard />
        </View>
      );
    }
    return <FamilyAttendance />;
  }
  if (screen === "class") {
    if (data.kind === "TEACHER") return <PeopleBoard studentOnly title={data.classLabel || "Class"} />;
    return <Empty title="No access" body="This page is for the class teacher." />;
  }
  if (screen === "leave") {
    if (data.kind === "TEACHER" || data.kind === "OFFICE") return <TeacherLeaveBoard />;
    return <FamilyAttendance />;
  }
  if (screen === "subjects") return <FamilySubjects />;
  if (screen === "tests") return testsScreenForKind(data.kind) === "parent-examination" ? <ParentExamination /> : <FamilyTests />;
  if (screen === "papers") return <FamilyPapers />;
  if (screen === "path") return <FamilyPath />;
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
