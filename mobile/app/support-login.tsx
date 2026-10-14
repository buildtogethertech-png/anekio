import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, Input } from "../components/ui";
import { useSession } from "../lib/session";

/** Anekio staff "log in as" — reached via QR deep link (anekio://support-login?code=…), web link, or long-press on the login logo. */
export default function SupportLogin() {
  const params = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();
  const { signInWithSupportCode } = useSession();
  const [code, setCode] = useState(typeof params.code === "string" ? params.code : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const autoTried = useRef(false);

  async function submit(value = code) {
    const clean = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length !== 8) {
      setError("Enter the 8-character support code.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await signInWithSupportCode(clean);
      router.replace("/(app)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Support login failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (autoTried.current || typeof params.code !== "string" || !params.code) return;
    autoTried.current = true;
    void submit(params.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.code]);

  return (
    <SafeAreaView className="flex-1 bg-[#f4f7fb]">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 items-center justify-center px-6">
        <View className="w-full max-w-[380px] gap-4 rounded-2xl border border-ink-200 bg-white p-6">
          <View className="gap-1">
            <Text className="text-lg font-bold text-ink-900">Support login</Text>
            <Text className="text-sm text-ink-700">For Anekio staff. Enter the one-time code from the admin panel.</Text>
          </View>
          <Field label="Support code">
            <Input
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="ABCD-2345"
              maxLength={9}
              onSubmitEditing={() => void submit()}
              editable={!busy}
            />
          </Field>
          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
          <Button onPress={() => void submit()} disabled={busy}>
            {busy ? "Signing in…" : "Continue"}
          </Button>
          <Button variant="ghost" onPress={() => router.replace("/login")} disabled={busy}>
            Back to login
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
