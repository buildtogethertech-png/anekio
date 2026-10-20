import Ionicons from "@expo/vector-icons/Ionicons";
import { appVersionLabel } from "../lib/app-version";
import { usePathname, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { iconForNav, qrDockSlots, visibleTabs } from "../lib/nav-icons";
import { useRecord } from "../lib/record";
import { pathForNav } from "../lib/paths";
import { useSession } from "../lib/session";
import { PageHeader } from "./ui";

const OFFICE_SIDEBAR_ORDER = new Map(
  ["home", "inbox", "people", "staff", "timetable", "fees", "exams", "notices", "admissions", "school", "subscription", "roles"].map(
    (key, index) => [key, index]
  )
);

const PARENT_SIDEBAR_ORDER = new Map(
  ["home", "inbox", "notices", "attendance", "timetable", "fees", "tests"].map((key, index) => [key, index])
);

function navLabel(portal: string | undefined, item: { key: string; label: string }) {
  if (portal === "OFFICE" && item.key === "school") return "Settings";
  if (portal === "OFFICE" && item.key === "roles") return "Roles & permissions";
  return item.label;
}

/** Shown only to a staff login that is also a parent: flips between the staff app and the parent app. */
type HatKey = "OFFICE" | "TEACHER" | "PARENT" | "STUDENT";
const HAT_LABEL: Record<HatKey, string> = { OFFICE: "Office", TEACHER: "Teacher", PARENT: "Parent", STUDENT: "Student" };
const HAT_ICON: Record<HatKey, keyof typeof Ionicons.glyphMap> = {
  OFFICE: "briefcase-outline",
  TEACHER: "school-outline",
  PARENT: "people-outline",
  STUDENT: "person-outline",
};

/**
 * Switch between the apps one login can open: its own role (first hat), and Teacher / Parent when the
 * person also teaches or is also a parent. One row (or pill) per other app.
 */
export function HatSwitch({ variant = "pill" }: { variant?: "pill" | "row" }) {
  const { user, switchHat } = useSession();
  const router = useRouter();
  const hats = (user?.hats || []) as HatKey[];
  if (hats.length < 2 || user?.support) return null;
  const primary = hats[0];
  const others = hats.filter((hat) => hat !== user?.portal);
  async function flip(to: HatKey) {
    try {
      await switchHat(to === primary ? "STAFF" : to === "PARENT" ? "PARENT" : "TEACHER");
      router.replace("/" as never);
    } catch {
      /* stays in the current app */
    }
  }
  if (variant === "row") {
    return (
      <>
        {others.map((hat) => (
          <Pressable key={hat} onPress={() => void flip(hat)} className="min-h-[56px] flex-row items-center gap-3 border-t border-ink-200 px-4 py-3">
            <Ionicons name={HAT_ICON[hat]} size={21} color="#1e3a5f" />
            <Text className="min-w-0 flex-1 text-base text-ink-900">Switch to {HAT_LABEL[hat]}</Text>
            <Ionicons name="swap-horizontal-outline" size={18} color="#64748b" />
          </Pressable>
        ))}
      </>
    );
  }
  return (
    <View className="flex-row gap-2">
      {others.map((hat) => (
        <Pressable
          key={hat}
          accessibilityRole="button"
          accessibilityLabel={`Switch to ${HAT_LABEL[hat]}`}
          onPress={() => void flip(hat)}
          className="h-9 flex-row items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3"
        >
          <Ionicons name="swap-horizontal-outline" size={15} color="#1d4ed8" />
          <Text className="text-xs font-semibold text-blue-700">{HAT_LABEL[hat]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Profile footer: switch app (staff who are parents) and sign out. Phones without a "More" tab rely on this. */
export function AccountActions() {
  const { signOut, user } = useSession();
  const canSwitch = (user?.hats || []).length > 1 && !user?.support;
  return (
    <>
    <View className="mt-4 overflow-hidden rounded-2xl border border-ink-200 bg-white">
      {canSwitch ? (
        <View className="-mt-px">
          <HatSwitch variant="row" />
        </View>
      ) : null}
      <Pressable onPress={() => void signOut()} className={`min-h-[56px] flex-row items-center gap-3 px-4 py-3 ${canSwitch ? "border-t border-ink-200" : ""}`}>
        <Ionicons name="log-out-outline" size={21} color="#b91c1c" />
        <Text className="text-base font-medium text-red-700">Sign out</Text>
      </Pressable>
    </View>
    <AppVersionLine />
    </>
  );
}

/** Small grey "Anekio v0.1.0 (build 11)" line; nothing on web. */
export function AppVersionLine() {
  const label = appVersionLabel();
  return label ? <Text className="mt-3 text-center text-[12px] text-ink-400">{label}</Text> : null;
}

// Office items opened once in a while: kept in a quieter "Admin" group at the bottom.
const ADMIN_KEYS = new Set(["school", "subscription", "roles"]);

export function NavMenu({
  onNavigate,
  collapsed = false,
  badges = {},
  showAccount = true,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
  badges?: Record<string, number>;
  showAccount?: boolean;
}) {
  const { user, nav, signOut } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const items = nav
    .filter((n) => n.key !== "profile" && n.key !== "uploads" && n.key !== "onboarding")
    .sort((a, b) => {
      const order =
        user?.portal === "OFFICE"
          ? OFFICE_SIDEBAR_ORDER
          : user?.portal === "PARENT"
            ? PARENT_SIDEBAR_ORDER
            : null;
      if (!order) return 0;
      return (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER);
    });
  const grouped = user?.portal === "OFFICE";
  const main = grouped ? items.filter((item) => !ADMIN_KEYS.has(item.key)) : items;
  const admin = grouped ? items.filter((item) => ADMIN_KEYS.has(item.key)) : [];

  function active(key: string) {
    const href = pathForNav(key);
    if (key === "home") return pathname === "/" || pathname === "" || pathname === "/index";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function go(key: string) {
    onNavigate?.();
    router.push(pathForNav(key) as never);
  }

  function row(item: (typeof items)[number], quiet = false) {
    const on = active(item.key);
    const label = navLabel(user?.portal, item);
    const count = badges[item.key] || 0;
    return (
      <Pressable
        key={item.key}
        accessibilityRole="link"
        accessibilityLabel={count ? `${label}, ${count} waiting` : label}
        onPress={() => go(item.key)}
        className={`anekio-nav-item mb-0.5 flex-row items-center rounded-lg border ${quiet ? "min-h-[38px]" : "min-h-[42px]"} ${
          collapsed ? "justify-center px-0" : "gap-3 px-3"
        } ${on ? "border-clay-200 bg-clay-50" : "border-transparent"}`}
      >
        <View className="w-6 items-center">
          <Ionicons name={iconForNav(item.key)} size={quiet ? 17 : 19} color={on ? "#2563eb" : quiet ? "#64748B" : "#1e3a5f"} />
          {collapsed && count ? <View className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500" /> : null}
        </View>
        {collapsed ? null : (
          <>
            <Text
              className={`min-w-0 flex-1 ${quiet ? "text-[13px]" : "text-[14px]"} ${
                on ? "font-semibold text-clay-700" : quiet ? "font-medium text-ink-700" : "font-medium text-ink-900"
              }`}
              numberOfLines={1}
            >
              {label}
            </Text>
            {count ? (
              <View className={`min-w-[20px] items-center rounded-full px-1.5 py-0.5 ${on ? "bg-clay-500" : "bg-red-50"}`}>
                <Text className={`text-[11px] font-semibold ${on ? "text-white" : "text-red-700"}`}>{count > 99 ? "99+" : count}</Text>
              </View>
            ) : null}
          </>
        )}
      </Pressable>
    );
  }

  return (
    <View className="flex-1">
      <ScrollView className={`flex-1 ${collapsed ? "px-2" : "px-3"}`} contentContainerStyle={{ paddingBottom: 24 }}>
        {main.map((item) => row(item))}
        {admin.length ? (
          <View className="mt-4 border-t border-ink-100 pt-3">
            {collapsed ? null : <Text className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-500">Admin</Text>}
            {admin.map((item) => row(item, true))}
          </View>
        ) : null}
      </ScrollView>
      {showAccount ? (
        <View className="border-t border-ink-200 bg-white px-4 pb-5 pt-4">
          <Pressable
            onPress={() => {
              onNavigate?.();
              router.push("/profile" as never);
            }}
            className="min-h-[44px] justify-center rounded-xl px-2 py-1"
          >
            <Text className="text-sm font-semibold text-ink-900">{user?.name}</Text>
            <Text className="text-[11px] text-ink-500">{user?.portal === "PARENT" ? "Parent" : user?.roleName}</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              onNavigate?.();
              signOut();
            }}
            className="mt-1 min-h-[36px] justify-center px-2"
          >
            <Text className="text-sm font-medium text-ink-500">Sign out</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function MoreBoard() {
  const { user, nav, signOut } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { data } = useRecord();
  const skip = new Set(visibleTabs(user?.portal, nav, qrDockSlots(user?.portal, Boolean(data?.staffAttendanceSelf))).filter((key) => key !== "more"));
  const rest = nav.filter(
    (item) => !skip.has(item.key) && item.key !== "uploads" && item.key !== "profile" && item.key !== "onboarding"
  );

  function go(key: string) {
    router.push(pathForNav(key) as never);
  }

  return (
    <View>
      <PageHeader title="More" />
      <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">
        {rest.map((item, index) => {
          const href = pathForNav(item.key);
          const on = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Pressable
              key={item.key}
              onPress={() => go(item.key)}
              className={`min-h-[56px] flex-row items-center gap-3 px-4 py-3 ${
                index ? "border-t border-ink-200" : ""
              } ${on ? "bg-blue-50" : "bg-white"}`}
            >
              <Ionicons name={iconForNav(item.key)} size={21} color={on ? "#1d4ed8" : "#1e3a5f"} />
              <Text className={`min-w-0 flex-1 text-base ${on ? "font-medium text-clay-500" : "text-ink-900"}`}>
                {navLabel(user?.portal, item)}
              </Text>
              <Ionicons name="chevron-forward" size={18} color="#64748b" />
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => router.push("/profile" as never)}
          className={`min-h-[56px] flex-row items-center gap-3 px-4 py-3 ${
            rest.length ? "border-t border-ink-200" : ""
          }`}
        >
          <Ionicons name="person-outline" size={21} color="#1e3a5f" />
          <Text className="min-w-0 flex-1 text-base text-ink-900">Profile</Text>
          <Ionicons name="chevron-forward" size={18} color="#64748b" />
        </Pressable>
        <HatSwitch variant="row" />
        <Pressable
          onPress={() => signOut()}
          className="min-h-[56px] flex-row items-center gap-3 border-t border-ink-200 px-4 py-3"
        >
          <Ionicons name="log-out-outline" size={21} color="#b91c1c" />
          <Text className="text-base font-medium text-red-700">Sign out</Text>
        </Pressable>
      </View>
      <AppVersionLine />
    </View>
  );
}
