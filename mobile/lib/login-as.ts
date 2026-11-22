import { Alert, Platform } from "react-native";

/** Asks before "Log in as": the admin uses Anekio as that person (full access) for up to an hour; changes are logged. */
export function confirmLoginAs(name: string, run: () => void) {
  const message = `You'll use Anekio as ${name} for up to 1 hour, with everything they can do. Anything you change is recorded under your name. Use "Back to my account" at the top to return.`;
  if (Platform.OS === "web") {
    if ((globalThis as { confirm?: (text: string) => boolean }).confirm?.(message)) run();
    return;
  }
  Alert.alert(`Log in as ${name}?`, message, [
    { text: "Cancel", style: "cancel" },
    { text: "Log in as", onPress: run },
  ]);
}
