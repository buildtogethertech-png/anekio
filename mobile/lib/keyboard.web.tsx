import type { ReactNode } from "react";
import { KeyboardAvoidingView, ScrollView, type ScrollViewProps } from "react-native";

/** Web: the browser keeps the focused field in view by itself. */
export function KeyboardProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export const KeyboardAwareScrollView = ScrollView as unknown as (props: ScrollViewProps & { bottomOffset?: number }) => ReactNode;

export const keyboardLibraryLinked = false;

export const KbAvoidingView = KeyboardAvoidingView;
export const KeyboardEvents = { addListener: (_name: string, _cb: (e: { height: number }) => void) => ({ remove() {} }) };
