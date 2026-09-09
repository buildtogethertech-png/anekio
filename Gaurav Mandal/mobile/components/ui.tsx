import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Dimensions,
  Modal as RnModal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Close"
      onPress={onPress}
      hitSlop={8}
      className="h-8 w-8 items-center justify-center"
    >
      <Ionicons name="close" size={22} color="#3d4f66" />
    </Pressable>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View className="gap-1.5">
      <View className="gap-0.5">
        <Text className="text-xs font-medium text-ink-700">{label}</Text>
        {hint ? <Text className="text-[11px] leading-4 text-ink-700">{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      {...props}
      placeholderTextColor="#3d4f66"
      className={`rounded-md border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 ${props.className || ""}`}
    />
  );
}

export function Button({
  children,
  className,
  disabled,
  variant = "primary",
  ...props
}: PressableProps & { children: ReactNode; className?: string; variant?: "primary" | "ghost" | "danger" }) {
  const styles =
    variant === "ghost"
      ? "border border-ink-200 bg-white"
      : variant === "danger"
        ? "bg-red-700"
        : "bg-clay-500";
  const text = variant === "ghost" ? "text-ink-800" : "text-white";
  return (
    <Pressable
      {...props}
      accessibilityRole={props.accessibilityRole || "button"}
      disabled={disabled}
      className={`items-center rounded-md px-4 py-2.5 transition-transform duration-150 active:scale-[0.97] ${styles} ${disabled ? "opacity-50" : ""} ${className || ""}`}
    >
      <Text className={`text-sm font-medium ${text}`}>{children}</Text>
    </Pressable>
  );
}

export function Card({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View className={`rounded-xl border border-ink-200 bg-white ${className || ""}`} style={style}>
      {children}
    </View>
  );
}

export function Badge({
  children,
  tone = "ink",
}: {
  children: string;
  tone?: "ink" | "clay" | "leaf" | "warn" | "danger" | "sky";
}) {
  const styles =
    tone === "leaf"
      ? "bg-emerald-50 text-green-700"
      : tone === "warn"
        ? "bg-amber-50 text-amber-800"
        : tone === "danger"
          ? "bg-red-50 text-red-700"
          : tone === "clay"
            ? "bg-blue-50 text-clay-600"
            : tone === "sky"
              ? "bg-sky-50 text-sky-800"
              : "bg-ink-100 text-ink-800";
  return (
    <View className="rounded px-2 py-0.5">
      <Text className={`text-xs font-medium ${styles}`}>{children}</Text>
    </View>
  );
}

export function Switch({
  on,
  disabled,
  onPress,
}: {
  on: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      className={`h-6 w-10 justify-center rounded-full ${on ? "bg-clay-500" : "bg-ink-200"} ${disabled ? "opacity-50" : ""}`}
    >
      <View className={`h-5 w-5 rounded-full bg-white ${on ? "ml-4" : "ml-0.5"}`} />
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  className,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  className?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`shrink-0 rounded-md border px-3 py-1.5 ${active ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"} ${className || ""}`}
    >
      <Text className={`text-sm ${active ? "text-white" : "text-ink-800"}`} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipScroller({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      className="grow-0"
    >
      <View className="flex-row items-center gap-1.5 pr-1">{children}</View>
    </ScrollView>
  );
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <View className="flex-row gap-1.5">
      {options.map((opt) => {
        const on = opt.id === value;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onChange(opt.id)}
            className={`min-h-[40px] flex-1 items-center justify-center rounded-md border px-1.5 py-2 ${
              on ? "border-clay-500 bg-clay-500" : "border-ink-200 bg-white"
            }`}
          >
            <Text numberOfLines={1} className={`text-center text-xs font-medium ${on ? "text-white" : "text-ink-800"}`}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <Card className="px-6 py-10">
      <Text className="text-center text-lg font-semibold text-ink-900">{title}</Text>
      <Text className="mt-2 text-center text-sm text-ink-700">{body}</Text>
    </Card>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="flex-1 p-4">
      <Text className="text-xs font-medium text-ink-700">{label}</Text>
      <Text className="mt-1 text-2xl font-semibold text-ink-900">{value}</Text>
      {hint ? <Text className="mt-1 text-xs text-ink-700">{hint}</Text> : null}
    </Card>
  );
}

export function PageHeader({
  kicker: _kicker,
  title,
  lede,
  action,
}: {
  kicker?: string;
  title: string;
  lede?: string;
  action?: ReactNode;
}) {
  return (
    <View className="mb-3 flex-col gap-1.5 border-b border-ink-200 pb-3 sm:mb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-3 sm:pb-3">
      <View className="max-w-2xl">
        <Text className="text-xl font-semibold text-ink-900">{title}</Text>
        {lede ? <Text className="mt-1 text-xs leading-4 text-ink-700">{lede}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
  wide,
  studio,
  footer,
  centerTitle,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  studio?: boolean;
  footer?: ReactNode;
  centerTitle?: boolean;
}) {
  return (
    <RnModal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View className="relative flex-1 items-center justify-center px-4 py-8">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          className="absolute inset-0 bg-black/40"
          onPress={onClose}
        />
        <View
          className={`z-10 w-full ${studio ? "max-w-[96rem]" : wide ? "max-w-3xl" : "max-w-lg"} max-h-[94%] rounded-md border border-ink-200 bg-white p-5`}
        >
          <View className="relative mb-4 min-h-8 flex-row items-center justify-end gap-3">
            <Text
              className={`${centerTitle ? "absolute inset-x-10 text-center" : "flex-1"} text-lg font-semibold text-ink-900`}
            >
              {title}
            </Text>
            <CloseButton onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: studio ? 760 : footer ? 520 : 640 }}>
            {children}
          </ScrollView>
          {footer ? <View className="mt-4 border-t border-ink-100 pt-4">{footer}</View> : null}
        </View>
      </View>
    </RnModal>
  );
}

export function Sheet({
  open,
  children,
  onClose,
}: {
  open: boolean;
  children: ReactNode;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const screenH = Dimensions.get("window").height;
  const maxH = Math.round(screenH * 0.9);
  const padBottom = Math.max(insets.bottom, 12);
  const translateY = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const close = useCallback(() => {
    translateY.value = 0;
    onClose();
  }, [onClose, translateY]);

  useEffect(() => {
    if (open) translateY.value = 0;
  }, [open, translateY]);

  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetY(-12)
    .failOffsetX([-24, 24])
    .onUpdate((e) => {
      if (e.translationY > 0 && scrollY.value <= 4) {
        translateY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      const shouldClose = translateY.value > 110 || e.velocityY > 900;
      if (shouldClose) {
        translateY.value = withTiming(screenH, { duration: 180 }, (finished) => {
          if (finished) runOnJS(close)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 240 });
      }
    });

  const handlePan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      const shouldClose = translateY.value > 90 || e.velocityY > 800;
      if (shouldClose) {
        translateY.value = withTiming(screenH, { duration: 180 }, (finished) => {
          if (finished) runOnJS(close)();
        });
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 240 });
      }
    });

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const dimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, screenH * 0.5], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <RnModal
      visible={open}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={close}
    >
      <GestureHandlerRootView style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable className="absolute inset-0" onPress={close}>
          <Animated.View className="absolute inset-0 bg-black/40" style={dimStyle} />
        </Pressable>
        <GestureDetector gesture={pan}>
          <Animated.View
            className="overflow-hidden rounded-t-2xl bg-white"
            style={[sheetStyle, { maxHeight: maxH, paddingBottom: padBottom }]}
          >
            <View className="h-12 justify-center">
              <GestureDetector gesture={handlePan}>
                <Animated.View className="h-12 items-center justify-center" collapsable={false}>
                  <View className="h-1.5 w-12 rounded-full bg-ink-200" />
                </Animated.View>
              </GestureDetector>
              <View className="absolute right-3">
                <CloseButton onPress={close} />
              </View>
            </View>
            <Animated.ScrollView
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              bounces
              scrollEventThrottle={16}
              onScroll={onScroll}
              style={{ maxHeight: maxH - 48 - padBottom }}
            >
              {children}
            </Animated.ScrollView>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </RnModal>
  );
}

function alertTone(message: string) {
  return /could not|failed|missing|required|wrong|invalid|no access|not found|not saved|cannot|assign |pick |add /i.test(message)
    ? "danger"
    : "success";
}

function alertMessage(message: string, ok: boolean) {
  if (!ok) return message;
  if (/^school saved\.?$/i.test(message.trim())) return "School changes saved.";
  return message;
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets?.bottom ?? 0, 20);
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  const tone = alertTone(message);
  const ok = tone === "success";
  const copy = alertMessage(message, ok);
  return (
    <RnModal visible={Boolean(message)} transparent animationType="fade" onRequestClose={onDone}>
      <View pointerEvents="box-none" className="flex-1 items-center justify-end px-4" style={{ paddingBottom: bottom }}>
        <View
          accessibilityRole="alert"
          className="w-full max-w-sm flex-row items-center gap-3 rounded-lg border border-ink-100 bg-white px-4 py-3 shadow-lg"
        >
          <View className={`h-6 w-6 items-center justify-center rounded-full ${ok ? "bg-green-600" : "bg-red-600"}`}>
            <Ionicons name={ok ? "checkmark" : "alert"} size={16} color="#ffffff" />
          </View>
          <Text className={`min-w-0 flex-1 text-sm font-semibold ${ok ? "text-green-800" : "text-red-700"}`}>
            {copy}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss alert" hitSlop={8} onPress={onDone}>
            <Ionicons name="close" size={22} color="#3d4f66" />
          </Pressable>
        </View>
      </View>
    </RnModal>
  );
}

export function useToast() {
  const [message, setMessage] = useState("");
  return { message, show: setMessage, clear: () => setMessage("") };
}
