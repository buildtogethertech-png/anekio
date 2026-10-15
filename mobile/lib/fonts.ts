import React from "react";
import { Platform, StyleSheet, Text, TextInput, type TextStyle } from "react-native";
import { cssInterop } from "nativewind";
import { nativeTextModules } from "./font-modules";

/** Bundled Inter (SIL OFL, see assets/fonts/Inter-OFL.txt). Without it Android falls back to the phone's own font, often a serif. */
export const APP_FONTS = {
  Inter_400Regular: require("../assets/fonts/Inter_400Regular.ttf"),
  Inter_500Medium: require("../assets/fonts/Inter_500Medium.ttf"),
  Inter_600SemiBold: require("../assets/fonts/Inter_600SemiBold.ttf"),
  Inter_700Bold: require("../assets/fonts/Inter_700Bold.ttf"),
  Inter_800ExtraBold: require("../assets/fonts/Inter_800ExtraBold.ttf"),
};

const BY_WEIGHT: Record<string, keyof typeof APP_FONTS> = {
  "100": "Inter_400Regular",
  "200": "Inter_400Regular",
  "300": "Inter_400Regular",
  "400": "Inter_400Regular",
  normal: "Inter_400Regular",
  "500": "Inter_500Medium",
  "600": "Inter_600SemiBold",
  "700": "Inter_700Bold",
  bold: "Inter_700Bold",
  "800": "Inter_800ExtraBold",
  "900": "Inter_800ExtraBold",
};

/** Picks the Inter file for the text's weight, unless the text already names its own font. */
function interStyle(style: unknown): TextStyle | null {
  const flat = (StyleSheet.flatten(style as never) || {}) as TextStyle;
  if (flat.fontFamily && !String(flat.fontFamily).startsWith("Inter_")) return null;
  const family = BY_WEIGHT[String(flat.fontWeight ?? "400")] || "Inter_400Regular";
  // Each weight is its own font file; clear fontWeight so the system doesn't fake-bold it again.
  return { fontFamily: family, fontWeight: "normal" };
}

let applied = false;

type AnyComponent = ((props: Record<string, unknown>) => unknown) & { render?: (props: Record<string, unknown>, ref: unknown) => unknown; displayName?: string };

/** forwardRef components (react-native-web): wrap their render function. */
function patchRender(component: AnyComponent) {
  const render = component.render;
  if (typeof render !== "function") return false;
  component.render = function patchedRender(props, ref) {
    const font = interStyle(props.style);
    return render.call(this, font ? { ...props, style: [props.style, font] } : props, ref);
  };
  return true;
}

/**
 * React Native 0.81 ships Text/TextInput as plain function components, so there is no render to wrap.
 * Swap the module's default export (what `import { Text } from "react-native"` reads lazily) for a thin
 * wrapper, and register the wrapper with NativeWind so `className` keeps working.
 */
function wrapComponent(Original: AnyComponent, name: string) {
  const Wrapped = function InterText(props: Record<string, unknown>) {
    const base = interStyle(props.style);
    // Inputs: drop Android's extra font padding so placeholders aren't clipped in short fields.
    const font = base && name === "TextInput" ? { ...base, includeFontPadding: false } : base;
    return React.createElement(Original as never, (font ? { ...props, style: [props.style, font] } : props) as never);
  } as unknown as AnyComponent;
  Object.assign(Wrapped, Original);
  Wrapped.displayName = Original.displayName || name;
  try {
    cssInterop(Wrapped as never, { className: "style" });
  } catch {
    /* className support stays on the original */
  }
  return Wrapped;
}

/**
 * React Native 0.81 ships Text/TextInput as plain function components, so there is no render to wrap.
 * Point both the module's default export and react-native's lazy `Text`/`TextInput` getters at a thin
 * wrapper that adds the Inter family. Each step is best-effort; the app keeps the system font if all fail.
 */
function patchNative(name: "Text" | "TextInput", moduleExports: { default?: AnyComponent }) {
  const rn = require("react-native") as Record<string, unknown>;
  const Original = (moduleExports?.default || rn[name]) as AnyComponent | undefined;
  if (typeof Original !== "function") return patchRender((Original || {}) as AnyComponent) ? "render" : "none";
  const Wrapped = wrapComponent(Original, name);
  const done: string[] = [];
  try {
    Object.defineProperty(moduleExports, "default", { configurable: true, enumerable: true, get: () => Wrapped });
    done.push("module");
  } catch {
    try {
      moduleExports.default = Wrapped;
      done.push("module=");
    } catch {
      /* read-only export */
    }
  }
  try {
    Object.defineProperty(rn, name, { configurable: true, enumerable: true, get: () => Wrapped });
    done.push("index");
  } catch {
    /* non-configurable getter */
  }
  return done.join("+") || "none";
}

/** Makes Inter the default for every Text and TextInput in the app (one place, no per-screen changes). */
export function applyAppFont() {
  if (applied) return;
  applied = true;
  if (Platform.OS === "web") {
    patchRender(Text as unknown as AnyComponent);
    patchRender(TextInput as unknown as AnyComponent);
    return;
  }
  const modules = nativeTextModules();
  if (!modules) return;
  const text = patchNative("Text", modules.Text as { default?: AnyComponent });
  const input = patchNative("TextInput", modules.TextInput as { default?: AnyComponent });
  if (__DEV__) console.log(`[fonts] Inter default: Text=${text}, TextInput=${input}`);
}
