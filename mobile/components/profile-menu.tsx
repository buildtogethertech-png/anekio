import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Modal, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useRecord } from "../lib/record";
import { useSession } from "../lib/session";

/** Profile button for the top bar: full chip on desktop, avatar only on phone. Opens My profile / My leave / Sign out. */
export function ProfileMenuButton({ compact = false }: { compact?: boolean }) {
  const { user, signOut, switchHat } = useSession();
  // Other apps this login can open (Office / Teacher / Parent), shown right in this menu.
  const hats = user?.support ? [] : (user?.hats || []);
  const otherHats = hats.filter((hat) => hat !== user?.portal);
  const hatLabel = (hat: string) => (hat === "OFFICE" ? "Office" : hat === "TEACHER" ? "Teacher" : hat === "PARENT" ? "Parent" : "Student");
  const hatIcon = (hat: string): keyof typeof Ionicons.glyphMap =>
    hat === "OFFICE" ? "briefcase-outline" : hat === "TEACHER" ? "school-outline" : "people-outline";
  function switchTo(hat: string) {
    setOpen(false);
    const as = hat === hats[0] ? "STAFF" : hat === "PARENT" ? "PARENT" : "TEACHER";
    void switchHat(as)
      .then(() => router.replace("/" as never))
      .catch(() => undefined);
  }
  const { data } = useRecord();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const chipRef = useRef<View>(null);
  const { width: windowWidth } = useWindowDimensions();
  const name = user?.name || "Profile";
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const staff = user?.portal === "OFFICE" || user?.portal === "TEACHER";
  const left = (data?.leaveBalances ?? []).filter((b) => b.limited).reduce((sum, b) => sum + Math.max(0, b.available), 0);
  const hasLimits = (data?.leaveBalances ?? []).some((b) => b.limited);
  // On Android, navigating in the same tap that closes the menu's Modal can be dropped while the
  // Modal is still dismissing. Close first, then navigate once it has gone.
  const go = (path: string) => {
    setOpen(false);
    setTimeout(() => router.push(path as never), Platform.OS === "web" ? 0 : 300);
  };
  const item = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void, hint?: string, danger?: boolean) => (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-ink-50">
      <Ionicons name={icon} size={17} color={danger ? "#b91c1c" : "#475569"} />
      <Text className={`min-w-0 flex-1 text-[14px] ${danger ? "text-red-700" : "text-ink-900"}`}>{label}</Text>
      {hint ? <Text className="text-xs text-ink-500">{hint}</Text> : null}
    </Pressable>
  );
  return (
    <View ref={chipRef} collapsable={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile menu"
        onPress={() => {
          if (open) {
            setOpen(false);
            return;
          }
          // The menu renders in its own layer (a Modal), so page content below the header can't cover it.
          // Open right away (with a default spot); measuring can be late or skipped on Android.
          setOpen(true);
          chipRef.current?.measureInWindow((x, y, w, h) => {
            if (h) setAnchor({ top: y + h + 6, right: Math.max(8, windowWidth - (x + w)) });
          });
        }}
        className={compact ? "ml-0.5 h-9 w-9 items-center justify-center rounded-full bg-[#EEF3FF]" : "min-h-10 flex-row items-center gap-2 rounded-full px-1.5 py-1"}
      >
        {compact ? (
          <Text className="text-xs font-bold text-[#1F45C7]">{initials || "Me"}</Text>
        ) : (
        <>
        <View className="h-8 w-8 items-center justify-center rounded-full bg-[#EEF4FF]">
          <Text className="text-[11px] font-semibold text-clay-500">{initials || "A"}</Text>
        </View>
        <View className="min-w-0">
          <Text className="text-[13px] font-medium text-ink-900" numberOfLines={1}>
            {name}
          </Text>
          <Text className="text-[11px] text-ink-500">
            {user?.portal === "TEACHER" ? "Teacher" : user?.portal === "OFFICE" ? user?.roleName || "Office" : user?.portal === "PARENT" ? "Parent" : "Student"}
          </Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color="#94A3B8" />
        </>
        )}
      </Pressable>
      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1 }}>
          <Pressable accessibilityLabel="Close menu" onPress={() => setOpen(false)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
          <View
            className="rounded-xl border border-ink-200 bg-white p-1.5"
            style={{
              position: "absolute",
              top: anchor?.top ?? 64,
              right: anchor?.right ?? 16,
              width: Math.min(240, windowWidth - 16),
              elevation: 8,
              shadowColor: "#0f172a",
              shadowOpacity: 0.12,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 8 },
            }}
          >
            <View className="border-b border-ink-100 px-3 pb-2.5 pt-1.5">
              <Text className="text-[14px] font-semibold text-ink-900" numberOfLines={1}>{name}</Text>
              <Text className="text-xs text-ink-500" numberOfLines={1}>{user?.email || user?.roleName}</Text>
            </View>
            <View className="pt-1">
              {item("person-circle-outline", "My profile", () => go("/profile"))}
              {staff ? item("airplane-outline", "My leave", () => go("/leave"), hasLimits ? `${left % 1 ? left.toFixed(1) : left} days left` : undefined) : null}
              {otherHats.length ? <View className="my-1 h-px bg-ink-100" /> : null}
              {otherHats.map((hat) => (
                <View key={hat}>{item(hatIcon(hat), `Switch to ${hatLabel(hat)}`, () => switchTo(hat))}</View>
              ))}
              <View className="my-1 h-px bg-ink-100" />
              {item("log-out-outline", "Sign out", () => {
                setOpen(false);
                signOut();
              }, undefined, true)}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
