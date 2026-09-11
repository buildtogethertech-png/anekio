import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { Linking, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Input } from "../components/ui";
import { useSession } from "../lib/session";

type LoginMode = "password" | "otp" | "forgot";

function marketingPricingUrl() {
  if (typeof window === "undefined") return "https://anekio.com/#pricing";
  const { hostname, protocol } = window.location;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1") {
    return "http://localhost:4000/#pricing";
  }
  if (hostname === "app.staging.anekio.com") return "https://staging.anekio.com/#pricing";
  if (hostname === "app.anekio.com") return "https://anekio.com/#pricing";
  return `${protocol}//${hostname.replace(/^app\./, "")}#pricing`;
}

function Brand() {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-10 w-10 items-center justify-center rounded-md bg-clay-500">
        <Text className="text-lg font-bold text-white">A</Text>
      </View>
      <View>
        <Text className="text-lg font-semibold text-ink-900">Anekio</Text>
        <Text className="text-[11px] text-ink-700">School ERP</Text>
      </View>
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <Text className="mb-1.5 text-xs font-semibold text-ink-800">{children}</Text>;
}

export default function Login() {
  const {
    user,
    signIn,
    requestLoginCode,
    signInWithCode,
    requestPasswordReset,
    resetPassword,
  } = useSession();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const showDevelopment = typeof __DEV__ !== "undefined" && __DEV__;
  const [mode, setMode] = useState<LoginMode>("password");
  const [login, setLogin] = useState(showDevelopment ? "admin@school.test" : "");
  const [password, setPassword] = useState(showDevelopment ? "12345" : "");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [developmentCode, setDevelopmentCode] = useState("");
  const [pending, setPending] = useState(false);

  if (user) return <Redirect href="/(app)" />;

  function clearFeedback() {
    setError("");
    setNotice("");
    setDevelopmentCode("");
  }

  function chooseMode(next: LoginMode) {
    setMode(next);
    setCode("");
    setCodeSent(false);
    setConfirmPassword("");
    clearFeedback();
  }

  async function onPasswordSignIn() {
    setPending(true);
    clearFeedback();
    try {
      await signIn(login, password);
      router.replace("/(app)");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "We could not sign you in.");
    } finally {
      setPending(false);
    }
  }

  async function onRequestCode() {
    setPending(true);
    clearFeedback();
    try {
      const response = mode === "forgot" ? await requestPasswordReset(login) : await requestLoginCode(login);
      setCodeSent(true);
      setNotice(`${response.message} Check ${response.destination}.`);
      setDevelopmentCode(response.developmentCode || "");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "We could not send a code.");
    } finally {
      setPending(false);
    }
  }

  async function onCodeSignIn() {
    setPending(true);
    setError("");
    try {
      await signInWithCode(login, code);
      router.replace("/(app)");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "That code could not be verified.");
    } finally {
      setPending(false);
    }
  }

  async function onResetPassword() {
    if (password !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setPending(true);
    setError("");
    try {
      await resetPassword(login, code, password);
      chooseMode("password");
      setNotice("Password changed. Sign in with your new password.");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "The password could not be changed.");
    } finally {
      setPending(false);
    }
  }

  const heading = mode === "forgot" ? "Reset your password" : "Welcome back";
  const subheading =
    mode === "forgot"
      ? "We will verify your registered email before you choose a new password."
      : "Sign in to your school workspace.";

  return (
    <SafeAreaView className="flex-1 bg-[#EEF3F8]" testID="login-screen">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ minHeight: Math.max(height, 680) }}>
        <View className="flex-1 items-center justify-center px-4 py-6 sm:px-6">
          <View
            className="w-full border border-[#D8E2EC] bg-white px-6 py-8 sm:px-10 sm:py-10"
            style={{
              maxWidth: 500,
              borderRadius: 8,
              shadowColor: "#0F2942",
              shadowOpacity: 0.08,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 12 },
              elevation: 3,
            }}
          >
            <Brand />

            <View className="mt-9">
                {mode === "forgot" ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back to sign in"
                    onPress={() => chooseMode("password")}
                    className="mb-7 flex-row items-center gap-2 self-start"
                  >
                    <Ionicons name="arrow-back" size={18} color="#1D4ED8" />
                    <Text className="text-sm font-semibold text-clay-600">Back to sign in</Text>
                  </Pressable>
                ) : null}

                <Text className="text-[28px] font-semibold text-ink-900">{heading}</Text>
                <Text className="mt-2 text-sm leading-6 text-ink-700">{subheading}</Text>

                {mode !== "forgot" ? (
                  <View className="mt-7 flex-row rounded-md bg-ink-100 p-1" accessibilityRole="tablist">
                    {([
                      ["password", "Password"],
                      ["otp", "Email OTP"],
                    ] as const).map(([id, label]) => {
                      const active = mode === id;
                      return (
                        <Pressable
                          key={id}
                          accessibilityRole="tab"
                          accessibilityState={{ selected: active }}
                          onPress={() => chooseMode(id)}
                          className={`h-10 flex-1 items-center justify-center rounded ${active ? "bg-white" : ""}`}
                          style={active ? { shadowColor: "#102A56", shadowOpacity: 0.08, shadowRadius: 5, elevation: 1 } : undefined}
                        >
                          <Text className={`text-sm font-semibold ${active ? "text-ink-900" : "text-ink-700"}`}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}

                <View className="mt-6 gap-4">
                  <View>
                    <FieldLabel>{mode === "otp" || mode === "forgot" ? "Registered email or mobile" : "Email or mobile number"}</FieldLabel>
                    <View className="relative justify-center">
                      <View className="absolute left-3 z-10"><Ionicons name="person-outline" size={18} color="#64748B" /></View>
                      <Input
                        accessibilityLabel="Email or mobile number"
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="email-address"
                        testID="login-identity"
                        value={login}
                        onChangeText={setLogin}
                        placeholder="name@school.com or mobile number"
                        className="h-12 pl-10"
                      />
                    </View>
                  </View>

                  {mode === "password" ? (
                    <View>
                      <View className="mb-1.5 flex-row items-center justify-between">
                        <Text className="text-xs font-semibold text-ink-800">Password</Text>
                        <Pressable accessibilityRole="button" onPress={() => chooseMode("forgot")}>
                          <Text className="text-xs font-semibold text-clay-600">Forgot password?</Text>
                        </Pressable>
                      </View>
                      <View className="relative justify-center">
                        <View className="absolute left-3 z-10"><Ionicons name="lock-closed-outline" size={18} color="#64748B" /></View>
                        <Input
                          accessibilityLabel="Password"
                          secureTextEntry={!showPassword}
                          testID="login-password"
                          value={password}
                          onChangeText={setPassword}
                          onSubmitEditing={onPasswordSignIn}
                          placeholder="Enter your password"
                          className="h-12 px-10"
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                          onPress={() => setShowPassword((current) => !current)}
                          className="absolute right-2 z-10 h-9 w-9 items-center justify-center"
                        >
                          <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={19} color="#64748B" />
                        </Pressable>
                      </View>
                    </View>
                  ) : null}

                  {codeSent ? (
                    <View>
                      <FieldLabel>Six-digit verification code</FieldLabel>
                      <Input
                        accessibilityLabel="Six-digit verification code"
                        value={code}
                        onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="000000"
                        className="h-12 text-center text-lg font-semibold"
                      />
                    </View>
                  ) : null}

                  {mode === "forgot" && codeSent ? (
                    <>
                      <View>
                        <FieldLabel>New password</FieldLabel>
                        <Input accessibilityLabel="New password" secureTextEntry={!showPassword} value={password} onChangeText={setPassword} placeholder="At least 8 characters" className="h-12" />
                      </View>
                      <View>
                        <FieldLabel>Confirm new password</FieldLabel>
                        <Input accessibilityLabel="Confirm new password" secureTextEntry={!showPassword} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Enter it again" className="h-12" />
                      </View>
                      <Pressable onPress={() => setShowPassword((current) => !current)} className="-mt-1 flex-row items-center gap-2 self-start">
                        <Ionicons name={showPassword ? "checkbox" : "square-outline"} size={18} color="#2563EB" />
                        <Text className="text-xs text-ink-700">Show passwords</Text>
                      </Pressable>
                    </>
                  ) : null}

                  {notice ? (
                    <View className="flex-row gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                      <Ionicons name="checkmark-circle-outline" size={18} color="#047857" />
                      <Text className="min-w-0 flex-1 text-xs leading-5 text-emerald-800">{notice}</Text>
                    </View>
                  ) : null}
                  {developmentCode ? <Text className="text-xs text-ink-700">Local verification code: {developmentCode}</Text> : null}
                  {error ? (
                    <View className="flex-row gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
                      <Ionicons name="alert-circle-outline" size={18} color="#B91C1C" />
                      <Text className="min-w-0 flex-1 text-xs leading-5 text-red-700">{error}</Text>
                    </View>
                  ) : null}

                  {mode === "password" ? (
                    <Button testID="login-submit" accessibilityLabel="Sign in" onPress={onPasswordSignIn} disabled={pending || !login || !password} className="h-12 justify-center">
                      {pending ? "Signing in..." : "Sign in securely"}
                    </Button>
                  ) : codeSent ? (
                    <Button
                      accessibilityLabel={mode === "forgot" ? "Reset password" : "Verify and sign in"}
                      onPress={mode === "forgot" ? onResetPassword : onCodeSignIn}
                      disabled={pending || code.length !== 6 || (mode === "forgot" && (!password || !confirmPassword))}
                      className="h-12 justify-center"
                    >
                      {pending ? "Verifying..." : mode === "forgot" ? "Reset password" : "Verify and sign in"}
                    </Button>
                  ) : (
                    <Button accessibilityLabel="Send verification code" onPress={onRequestCode} disabled={pending || !login} className="h-12 justify-center">
                      {pending ? "Sending code..." : "Send verification code"}
                    </Button>
                  )}

                  {mode !== "password" && codeSent ? (
                    <Pressable disabled={pending} onPress={onRequestCode} className="items-center py-1">
                      <Text className="text-xs font-semibold text-clay-600">Send a new code</Text>
                    </Pressable>
                  ) : null}
                </View>

                <View className="mt-7 border-t border-ink-200 pt-5">
                  <View className="flex-row flex-wrap items-center justify-center gap-1">
                    <Text className="text-xs text-ink-700">Setting up a new school?</Text>
                    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(marketingPricingUrl())}>
                      <Text className="text-xs font-semibold text-clay-600">View plans and start a trial</Text>
                    </Pressable>
                  </View>
                  <View className="mt-5 flex-row items-center justify-center gap-2">
                    <Ionicons name="shield-checkmark-outline" size={15} color="#047857" />
                    <Text className="text-[11px] text-ink-700">Secure sign-in · Never share your password or OTP</Text>
                  </View>
                  <Pressable accessibilityRole="link" onPress={() => void Linking.openURL("mailto:support@anekio.com")} className="mt-3 items-center">
                    <Text className="text-[11px] text-ink-700">Need help? support@anekio.com</Text>
                  </Pressable>
                </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
