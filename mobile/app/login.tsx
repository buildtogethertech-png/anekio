import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { Image, Linking, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Input } from "../components/ui";
import { useSession, type AuthAccountChoice } from "../lib/session";

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

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <View className="flex-row items-center gap-3">
      <Image source={require("../assets/icon.png")} accessibilityLabel="Anekio" style={{ width: 44, height: 44, borderRadius: 12 }} />
      <View>
        <Text className={`text-lg font-semibold ${inverse ? "text-white" : "text-ink-900"}`}>Anekio</Text>
        <Text className={`text-xs ${inverse ? "text-blue-100" : "text-ink-700"}`}>School operations, in one place</Text>
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
  const { height, width } = useWindowDimensions();
  const isWideLayout = width >= 900;
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
  const [accountChoices, setAccountChoices] = useState<AuthAccountChoice[]>([]);
  const [pending, setPending] = useState(false);

  if (user) return <Redirect href="/(app)" />;

  function clearFeedback() {
    setError("");
    setNotice("");
    setDevelopmentCode("");
    setAccountChoices([]);
  }

  function chooseMode(next: LoginMode) {
    setMode(next);
    setCode("");
    setCodeSent(false);
    setConfirmPassword("");
    clearFeedback();
  }

  async function onPasswordSignIn(accountId?: string) {
    setPending(true);
    setError("");
    setNotice("");
    setDevelopmentCode("");
    try {
      const choices = await signIn(login, password, accountId);
      if (choices?.length) {
        setAccountChoices(choices);
        setNotice("Choose which school account to open.");
        return;
      }
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

  const form = (
    <View className={isWideLayout ? "w-[470px] px-10 py-12" : "w-full px-6 pb-9 pt-8"}>
      <View>
        {mode === "forgot" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to sign in"
            onPress={() => chooseMode("password")}
            className="mb-7 flex-row items-center gap-2 self-start"
          >
            <Ionicons name="arrow-back" size={18} color="#2563EB" />
            <Text className="text-sm font-semibold text-clay-600">Back to sign in</Text>
          </Pressable>
        ) : null}

        <Text className="text-[30px] font-semibold tracking-tight text-ink-900">{heading}</Text>
        <Text className="mt-2 text-[15px] leading-6 text-ink-700">{subheading}</Text>

        {mode !== "forgot" ? (
          <View className="mt-8 flex-row rounded-xl border border-[#E2E8F0] bg-[#F5F8FC] p-1" accessibilityRole="tablist">
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
                  className={`h-11 flex-1 items-center justify-center rounded-lg ${active ? "bg-white" : ""}`}
                  style={active ? { shadowColor: "#102A56", shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 } : undefined}
                >
                  <Text className={`text-sm font-semibold ${active ? "text-ink-900" : "text-ink-700"}`}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <View className="mt-6 gap-5">
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
                        onChangeText={(value) => {
                          setLogin(value);
                          setAccountChoices([]);
                        }}
                        placeholder="name@school.com or mobile number"
                        className="h-14 pl-11 text-base"
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
                          onChangeText={(value) => {
                            setPassword(value);
                            setAccountChoices([]);
                          }}
                          onSubmitEditing={() => onPasswordSignIn()}
                          placeholder="Enter your password"
                          className="h-14 px-11 text-base"
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                          onPress={() => setShowPassword((current) => !current)}
                          className="absolute right-2 z-10 h-10 w-10 items-center justify-center"
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

                  {accountChoices.length ? (
                    <View className="gap-2 rounded-md border border-clay-200 bg-clay-50 p-3">
                      <Text className="text-xs font-semibold text-ink-900">Choose school</Text>
                      {accountChoices.map((choice) => (
                        <Pressable
                          key={choice.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Sign in to ${choice.schoolName}`}
                          disabled={pending}
                          onPress={() => onPasswordSignIn(choice.id)}
                          className="rounded-md border border-[#D8E2EC] bg-white px-3 py-2.5"
                        >
                          <Text className="text-sm font-semibold text-ink-900">{choice.schoolName}</Text>
                          <Text className="mt-0.5 text-xs text-ink-700">{choice.name} · {choice.roleName}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}

                  {mode === "password" ? (
                    <Button testID="login-submit" accessibilityLabel="Sign in" onPress={() => onPasswordSignIn()} disabled={pending || !login || !password} className="h-14 justify-center">
                      {pending ? "Signing in..." : "Sign in securely"}
                    </Button>
                  ) : codeSent ? (
                    <Button
                      accessibilityLabel={mode === "forgot" ? "Reset password" : "Verify and sign in"}
                      onPress={mode === "forgot" ? onResetPassword : onCodeSignIn}
                      disabled={pending || code.length !== 6 || (mode === "forgot" && (!password || !confirmPassword))}
                      className="h-14 justify-center"
                    >
                      {pending ? "Verifying..." : mode === "forgot" ? "Reset password" : "Verify and sign in"}
                    </Button>
                  ) : (
                    <Button accessibilityLabel="Send verification code" onPress={onRequestCode} disabled={pending || !login} className="h-14 justify-center">
                      {pending ? "Sending code..." : "Send verification code"}
                    </Button>
                  )}

          {mode !== "password" && codeSent ? (
            <Pressable disabled={pending} onPress={onRequestCode} className="items-center py-1">
              <Text className="text-xs font-semibold text-clay-600">Send a new code</Text>
            </Pressable>
          ) : null}
        </View>

        <View className="mt-8 border-t border-ink-200 pt-5">
          <View className="flex-row flex-wrap items-center justify-center gap-1">
            <Text className="text-xs text-ink-700">New to Anekio?</Text>
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(marketingPricingUrl())}>
              <Text className="text-xs font-semibold text-clay-600">Start a trial</Text>
            </Pressable>
          </View>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL("mailto:support@anekio.com")} className="mt-3 items-center">
            <Text className="text-xs text-ink-700">Need help? <Text className="font-medium text-clay-600">support@anekio.com</Text></Text>
          </Pressable>
          <View className="mt-5 flex-row items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-3">
            <View className="h-8 w-8 items-center justify-center rounded-lg bg-white">
              <Ionicons name="shield-checkmark-outline" size={18} color="#1D4ED8" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-semibold text-ink-900">Secure school access</Text>
              <Text className="mt-0.5 text-[11px] leading-4 text-ink-700">Your password and school data stay protected.</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-[#F4F7FB]" testID="login-screen">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ minHeight: Math.max(height, 680) }}>
        <View className={`flex-1 items-center ${isWideLayout ? "justify-center px-4 py-5 sm:px-6 sm:py-8" : "justify-start"}`}>
          {!isWideLayout ? (
            <View className="w-full bg-[#173B77] px-6 pb-20 pt-10">
              <Brand inverse />
              <Text className="mt-9 text-[27px] font-semibold leading-8 tracking-tight text-white">Your school, ready for the day.</Text>
              <Text className="mt-2 text-sm leading-6 text-blue-100">Sign in to continue where your team left off.</Text>
            </View>
          ) : null}
          <View
            className={`w-full overflow-hidden bg-white ${isWideLayout ? "flex-row border border-[#DFE7F1]" : "-mt-8 rounded-t-[28px]"}`}
            style={isWideLayout ? {
              maxWidth: 960,
              borderRadius: 16,
              shadowColor: "#0F2942",
              shadowOpacity: 0.1,
              shadowRadius: 28,
              shadowOffset: { width: 0, height: 14 },
              elevation: 4,
            } : undefined}
          >
            {isWideLayout ? (
              <View className="w-[490px] justify-between bg-[#173B77] px-12 py-12">
                <View>
                  <Brand inverse />
                  <View className="mt-20">
                    <Text className="text-[34px] font-semibold leading-[42px] tracking-tight text-white">Run every school day with clarity.</Text>
                    <Text className="mt-4 max-w-[330px] text-[15px] leading-6 text-blue-100">Admissions, fees, attendance and communication—one shared workspace for your school team.</Text>
                  </View>
                </View>
                <View className="flex-row items-center gap-2">
                  <Ionicons name="shield-checkmark-outline" size={17} color="#93C5FD" />
                  <Text className="text-xs text-blue-100">Secure access for your school team</Text>
                </View>
              </View>
            ) : null}
            {form}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
