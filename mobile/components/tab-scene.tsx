import { createContext, useContext, useEffect } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  makeMutable,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";

export type TabSceneNavigation = {
  addListener: (type: "focus" | "blur", cb: () => void) => () => void;
  isFocused: () => boolean;
};

const TabSceneProgress = createContext<SharedValue<number> | null>(null);

/** 0 → 1 while the visible tab fades out after a tab-bar tap, before the next screen has rendered. */
const tabLeaving = makeMutable(0);
/** Breathing opacity for the placeholder shown while the next screen renders; runs only during a switch. */
const skeletonPulse = makeMutable(1);

/**
 * Call on a tab-bar tap (to another tab). Starts swapping the current screen for a placeholder on the UI thread right
 * away, so the switch visibly starts even while the JS thread renders the next screen. The next screen's focus resets
 * it; if no focus comes (navigation did not happen), the screen fades back in.
 */
export function startTabLeave() {
  tabLeaving.value = withSequence(
    withTiming(1, { duration: 120, easing: Easing.out(Easing.quad) }),
    withDelay(2500, withTiming(0, { duration: 150 })),
  );
  skeletonPulse.value = withRepeat(
    withSequence(withTiming(0.55, { duration: 650, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: 650, easing: Easing.inOut(Easing.ease) })),
    -1,
  );
}

/**
 * Wraps each phone tab screen (Tabs `screenLayout`). Hides the screen's body when it loses focus and fades it in
 * when it gains focus, on the UI thread with Reanimated: bottom-tabs' own `animation` option (RN Animated native
 * driver) shows no transition on this RN 0.81 / Fabric setup.
 */
export function TabScene({ navigation, children }: { navigation: TabSceneNavigation; children: ReactNode }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    const show = () => {
      tabLeaving.value = 0;
      progress.value = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) cancelAnimation(skeletonPulse);
      });
    };
    if (navigation.isFocused()) show();
    const offFocus = navigation.addListener("focus", show);
    const offBlur = navigation.addListener("blur", () => {
      progress.value = 0;
    });
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation, progress]);
  return <TabSceneProgress.Provider value={progress}>{children}</TabSceneProgress.Provider>;
}

/**
 * The part of a tab screen under the top bar. On tab switches it fades in so the top bar stays still, and a grey
 * placeholder stands in while the next screen is still rendering, so the area is never a blank white page.
 */
export function TabSceneBody({ children }: { children: ReactNode }) {
  const progress = useContext(TabSceneProgress);
  if (!progress) return <View style={{ flex: 1, minHeight: 0 }}>{children}</View>;
  return <AnimatedBody progress={progress}>{children}</AnimatedBody>;
}

function AnimatedBody({ progress, children }: { progress: SharedValue<number>; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({
    opacity: progress.value * (1 - tabLeaving.value),
    transform: [{ translateY: (1 - progress.value) * 8 }],
  }));
  const skeletonStyle = useAnimatedStyle(() => ({
    opacity: Math.max(tabLeaving.value, 1 - progress.value) * skeletonPulse.value,
  }));
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <Animated.View style={[StyleSheet.absoluteFill, skeletonStyle]} pointerEvents="none">
        <TabSkeleton />
      </Animated.View>
      <Animated.View style={[{ flex: 1, minHeight: 0 }, style]}>{children}</Animated.View>
    </View>
  );
}

function TabSkeleton() {
  return (
    <View style={sk.page}>
      <View style={[sk.bar, { width: "42%", height: 22 }]} />
      <View style={sk.card} />
      <View style={sk.chips}>
        <View style={[sk.bar, sk.chip]} />
        <View style={[sk.bar, sk.chip]} />
        <View style={[sk.bar, sk.chip]} />
      </View>
      <View style={sk.list}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={sk.row}>
            <View style={sk.avatar} />
            <View style={{ flex: 1, gap: 7 }}>
              <View style={[sk.bar, { width: "58%", height: 12 }]} />
              <View style={[sk.bar, { width: "36%", height: 10 }]} />
            </View>
            <View style={[sk.bar, { width: 52, height: 12 }]} />
          </View>
        ))}
      </View>
    </View>
  );
}

const GREY = "#E5EAF2";
const sk = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingTop: 20, gap: 14 },
  bar: { backgroundColor: GREY, borderRadius: 6 },
  card: { height: 96, borderRadius: 14, backgroundColor: GREY },
  chips: { flexDirection: "row", gap: 8 },
  chip: { width: 68, height: 28, borderRadius: 14 },
  list: { borderRadius: 14, backgroundColor: "#fff", paddingHorizontal: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#EFF6FF" },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: GREY },
});
