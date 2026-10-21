import { TurboModuleRegistry } from "react-native";

/**
 * Keyboard handling for the phone apps (react-native-keyboard-controller).
 * Android (edge-to-edge, SDK 54) does not resize screens or full-screen popups for the keyboard, so typed
 * fields at the bottom stayed hidden. KeyboardAwareScrollView scrolls the focused field above the keyboard.
 * Web uses lib/keyboard.web.tsx (the browser already does this).
 */
export {
  KeyboardProvider,
  KeyboardAwareScrollView,
  KeyboardAvoidingView as KbAvoidingView,
  KeyboardEvents,
} from "react-native-keyboard-controller";

/** True only in an app build that contains the library's native part (a reload alone is not enough). */
export const keyboardLibraryLinked = Boolean(TurboModuleRegistry.get("KeyboardController"));
if (__DEV__) {
  console.log(`[keyboard] native keyboard library ${keyboardLibraryLinked ? "LINKED ✓" : "NOT in this build ✗ — rebuild the app"}`);
}
