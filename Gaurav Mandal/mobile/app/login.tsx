import { useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Card, Field, Input } from "../components/ui";
import { apiBase } from "../lib/api";
import { useSession } from "../lib/session";

const demos = [
  ["admin@school.test", "12345", "Admin — everything"],
  ["kavita.joshi@school.test", "12345", "Teacher — 1-A"],
  ["parent.1a.1@school.test", "12345", "Parent — 1-A · 2 children"],
  ["student.1a.01@school.test", "12345", "Student — Aisha Sharma"],
];

export default function Login() {
  const { user, signIn } = useSession();
  const router = useRouter();
  const [login, setLogin] = useState("admin@school.test");
  const [password, setPassword] = useState("12345");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (user) return <Redirect href="/(app)" />;

  async function onSubmit() {
    setPending(true);
    setError("");
    try {
      await signIn(login, password);
      router.replace("/(app)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Those credentials are not in this school.");
    } finally {
      setPending(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-ink-50" testID="login-screen">
      <ScrollView contentContainerClassName="flex-grow items-center justify-center px-4 py-10">
        <Card className="w-full max-w-md p-8">
          <Text className="text-xs font-medium text-clay-600">Anekio</Text>
          <Text className="mt-1 text-2xl font-semibold text-ink-900">Sign in</Text>
          <Text className="mt-1 text-sm text-ink-700">Parent, teacher, admin, or student portal.</Text>
          <View className="mt-6 gap-4">
            <Field label="Email or number">
              <Input
                accessibilityLabel="Email or number"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                testID="login-identity"
                value={login}
                onChangeText={setLogin}
                placeholder="Email or 10-digit mobile"
              />
            </Field>
            <Field label="Password">
              <Input
                accessibilityLabel="Password"
                secureTextEntry
                testID="login-password"
                value={password}
                onChangeText={setPassword}
              />
            </Field>
            {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
            <Text testID="login-api-base" style={{ fontSize: 12, color: "#0f2744" }}>API {apiBase()}</Text>
            <Button accessibilityLabel="Sign in" testID="login-submit" onPress={onSubmit} disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </View>
          <View className="mt-6 gap-2">
            <Text className="text-xs font-medium text-ink-700">Demo accounts</Text>
            {demos.map(([email, pass, label]) => (
              <Pressable
                key={email}
                onPress={() => {
                  setLogin(email);
                  setPassword(pass);
                }}
                className="flex-row items-center justify-between rounded-md border border-ink-200 bg-ink-50 px-3 py-2"
              >
                <Text className="text-sm text-ink-900">{label}</Text>
                <Text className="text-sm text-ink-700">{email}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
