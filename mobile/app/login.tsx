import Ionicons from "@expo/vector-icons/Ionicons";
import * as Google from "expo-auth-session/providers/google";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useRef, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { Animated, Image, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Input } from "../components/ui";
import { apiBase, webOrigin } from "../lib/api";
import { useSession, type AuthAccountChoice } from "../lib/session";

WebBrowser.maybeCompleteAuthSession();

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "";
const googleAndroidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || "";
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "";

type LoginMode = "password" | "otp" | "forgot" | "trial";

async function startTrial(input: {
  schoolName: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  city: string;
  studentCount: string;
}) {
  const url = `${apiBase()}/api/saas/trial`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("Can't reach the API. Keep npm run api running.");
  }
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    login?: string;
    password?: string;
    loginUrl?: string;
  };
  if (!res.ok) {
    const error = new Error(data.error || "Could not create the school.") as Error & { loginUrl?: string };
    error.loginUrl = data.loginUrl;
    throw error;
  }
  if (!data.login || !data.password) throw new Error("School created, but login details were missing. Try signing in with your phone.");
  return { login: data.login, password: data.password };
}

function Brand({ inverse = false, compact = false, centered = false, markSize, wordSize }: { inverse?: boolean; compact?: boolean; centered?: boolean; markSize?: number; wordSize?: number }) {
  const size = markSize ?? (compact ? 30 : 38);
  return (
    <View className={centered ? "items-center" : "flex-row items-center gap-2.5"}>
      <Image source={require("../assets/anekio-mark-transparent.png")} accessibilityLabel="Anekio" style={{ width: size, height: size }} />
      <View className={centered ? "items-center" : ""} style={centered ? { marginTop: -28 } : undefined}>
        <Text style={{ fontFamily: Platform.select({ ios: centered ? "Avenir Next Demi Bold" : "Avenir Next", android: centered ? "sans-serif-black" : "sans-serif-medium", default: "system-ui" }), ...(centered ? { letterSpacing: -1.1, includeFontPadding: false } : {}), ...(wordSize ? { fontSize: wordSize, lineHeight: wordSize + 10 } : {}) }} className={`${centered ? "text-2xl" : "text-lg"} font-bold lowercase tracking-tight ${inverse ? "text-white" : "text-ink-900"}`}>anekio</Text>
        {!compact ? <Text className={`text-xs ${inverse ? "text-blue-100" : "text-ink-700"}`}>Connecting school & parents</Text> : null}
      </View>
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <Text className="mb-2 text-[13px] font-semibold text-[#172B4D]">{children}</Text>;
}

function GoogleSignInButton({ disabled, onIdToken, onError }: { disabled: boolean; onIdToken: (idToken: string) => void; onError: (message: string) => void }) {
  const [request, , promptGoogle] = Google.useIdTokenAuthRequest({
    webClientId: googleWebClientId || undefined,
    androidClientId: googleAndroidClientId || undefined,
    iosClientId: googleIosClientId || undefined,
    selectAccount: true,
  });

  async function start() {
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      onError("Google sign-in needs an Anekio development build. Expo Go uses a different Android identity, so Google blocks this test.");
      return;
    }
    try {
      const response = await promptGoogle();
      if (response.type !== "success") return;
      const idToken = response.params.id_token || response.authentication?.idToken;
      if (!idToken) return onError("Google did not return a sign-in token. Please try again.");
      onIdToken(idToken);
    } catch {
      onError("Google sign-in could not be started. Please try again.");
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      disabled={disabled || !request}
      onPress={() => void start()}
      className={`h-12 flex-row items-center justify-center gap-2 rounded-2xl border border-[#D6DEEA] bg-white ${disabled || !request ? "opacity-60" : ""}`}
    >
      <Ionicons name="logo-google" size={18} color="#4285F4" />
      <Text className="text-sm font-semibold text-[#243B64]">Continue with Google</Text>
    </Pressable>
  );
}

export default function Login() {
  const {
    user,
    signIn,
    signInWithGoogle,
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
  const [resetLinkSent, setResetLinkSent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [developmentCode, setDevelopmentCode] = useState("");
  const [accountChoices, setAccountChoices] = useState<AuthAccountChoice[]>([]);
  const [googleIdToken, setGoogleIdToken] = useState("");
  const [pending, setPending] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [city, setCity] = useState("");
  const [studentCount, setStudentCount] = useState("");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const keyboardProgress = useRef(new Animated.Value(0)).current;
  const googleConfigured = Platform.OS === "android" ? Boolean(googleAndroidClientId) : Platform.OS === "ios" ? Boolean(googleIosClientId) : Boolean(googleWebClientId);
  const balancedPhoneLayout =
    !isWideLayout && !keyboardVisible && height >= 760 && mode === "password" && !accountChoices.length && !error && !notice;

  function setKeyboardLayout(visible: boolean) {
    setKeyboardVisible(visible);
    Animated.timing(keyboardProgress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 180,
      useNativeDriver: false,
    }).start();
  }

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => {
      setKeyboardLayout(true);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardLayout(false);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [keyboardProgress]);

  if (user) return <Redirect href="/(app)" />;

  function clearFeedback() {
    setError("");
    setNotice("");
    setDevelopmentCode("");
    setAccountChoices([]);
    setGoogleIdToken("");
  }

  function chooseMode(next: LoginMode) {
    setMode(next);
    setCode("");
    setCodeSent(false);
    setResetLinkSent(false);
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

  async function onGoogleSignIn(idToken: string, accountId?: string) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const choices = await signInWithGoogle(idToken, accountId);
      if (choices?.length) {
        setGoogleIdToken(idToken);
        setAccountChoices(choices);
        setNotice("Choose which school account to open.");
        return;
      }
      router.replace("/(app)");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "We could not sign you in with Google.");
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
      setResetLinkSent(mode === "forgot");
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

  async function onCreateSchool() {
    if (!schoolName.trim() || !ownerName.trim() || !ownerEmail.trim() || !ownerPhone.trim() || !city.trim()) {
      setError("Fill school name, your name, email, phone, and city.");
      return;
    }
    setPending(true);
    clearFeedback();
    try {
      const created = await startTrial({
        schoolName: schoolName.trim(),
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim(),
        ownerPhone: ownerPhone.trim(),
        city: city.trim(),
        studentCount: studentCount.trim(),
      });
      setLogin(created.login);
      setPassword(created.password);
      const choices = await signIn(created.login, created.password);
      if (choices?.length) {
        chooseMode("password");
        setAccountChoices(choices);
        setNotice("Your school is ready. Choose which account to open.");
        return;
      }
      router.replace("/(app)");
    } catch (exception) {
      const alreadyRegistered = exception && typeof exception === "object" && "loginUrl" in exception;
      setError(exception instanceof Error ? exception.message : "We could not create the school.");
      if (alreadyRegistered) {
        chooseMode("password");
        setLogin(ownerPhone.trim() || ownerEmail.trim());
        setPassword("12345");
      }
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

  const heading = mode === "forgot" ? "Reset your password" : mode === "trial" ? "Create your school" : mode === "otp" ? "Sign in with a code" : "Welcome back";
  const subheading =
    mode === "forgot"
      ? "We will verify your registered email before you choose a new password."
      : mode === "trial"
        ? "Fill these details to open a new Anekio workspace and sign in."
        : "Sign in to your school workspace.";

  const form = (
    <View className={isWideLayout ? "w-[470px] px-10 py-7" : "w-full pb-5 pt-0"}>
      <View>
        {mode === "forgot" || mode === "trial" ? (
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

        <Text style={!isWideLayout ? { fontFamily: Platform.select({ ios: "Avenir Next", android: "sans-serif", default: "system-ui" }), fontWeight: "700" } : undefined} className={`${isWideLayout ? "text-[30px]" : "text-[31px] leading-[39px]"} font-bold tracking-tight text-[#102A5C]`}>{heading}</Text>
        <Text className="mt-2 text-[16px] leading-6 text-[#52627A]">{subheading}</Text>

        <View className={`${isWideLayout ? "mt-5 gap-4" : "mt-7 gap-5"}`}>
          {mode === "trial" ? (
            <>
              <View>
                <FieldLabel>School name</FieldLabel>
                <Input value={schoolName} onChangeText={setSchoolName} placeholder="VidyaPith Public School" className="h-14 text-base" />
              </View>
              <View>
                <FieldLabel>Your name</FieldLabel>
                <Input value={ownerName} onChangeText={setOwnerName} placeholder="Principal / Owner" className="h-14 text-base" />
              </View>
              <View>
                <FieldLabel>Work email</FieldLabel>
                <Input autoCapitalize="none" keyboardType="email-address" value={ownerEmail} onChangeText={setOwnerEmail} placeholder="owner@school.in" className="h-14 text-base" />
              </View>
              <View>
                <FieldLabel>Phone</FieldLabel>
                <Input keyboardType="phone-pad" value={ownerPhone} onChangeText={setOwnerPhone} placeholder="98765 43210" className="h-14 text-base" />
              </View>
              <View>
                <FieldLabel>City</FieldLabel>
                <Input value={city} onChangeText={setCity} placeholder="Bengaluru" className="h-14 text-base" />
              </View>
              <View>
                <FieldLabel>Number of students</FieldLabel>
                <Input keyboardType="number-pad" value={studentCount} onChangeText={setStudentCount} placeholder="480" className="h-14 text-base" />
              </View>
              {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
              {notice ? <Text className="text-sm text-ink-700">{notice}</Text> : null}
              <Button accessibilityLabel="Create my school" onPress={() => void onCreateSchool()} disabled={pending} className="h-14 justify-center">
                {pending ? "Creating your school..." : "Create my school"}
              </Button>
            </>
          ) : (
            <>
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
                        onFocus={() => setKeyboardLayout(true)}
                        onBlur={() => setKeyboardLayout(false)}
                        onChangeText={(value) => {
                          setLogin(value);
                          setAccountChoices([]);
                        }}
                        placeholder="name@school.com or mobile number"
                        className={`${isWideLayout ? "h-12" : "h-14"} rounded-2xl border-[#D6DEEA] pl-11 text-base`}
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
                          onFocus={() => setKeyboardLayout(true)}
                          onBlur={() => setKeyboardLayout(false)}
                          onChangeText={(value) => {
                            setPassword(value);
                            setAccountChoices([]);
                          }}
                          onSubmitEditing={() => onPasswordSignIn()}
                          placeholder="Enter your password"
                          className={`${isWideLayout ? "h-12" : "h-14"} rounded-2xl border-[#D6DEEA] px-11 text-base`}
                          style={{ paddingLeft: 37 }}
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

                  {codeSent && !resetLinkSent ? (
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

                  {mode === "forgot" && codeSent && !resetLinkSent ? (
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
                          onPress={() => googleIdToken ? onGoogleSignIn(googleIdToken, choice.id) : onPasswordSignIn(choice.id)}
                          className="rounded-md border border-[#D8E2EC] bg-white px-3 py-2.5"
                        >
                          <Text className="text-sm font-semibold text-ink-900">{choice.schoolName}</Text>
                          <Text className="mt-0.5 text-xs text-ink-700">{choice.name} · {choice.roleName}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}

                  {mode === "password" ? (
                    <>
                      <Button testID="login-submit" accessibilityLabel="Sign in" onPress={() => onPasswordSignIn()} disabled={pending || !login || !password} className={`${isWideLayout ? "h-12" : "h-14"} justify-center bg-[#2955DB] shadow-lg shadow-blue-300`} style={!isWideLayout ? { borderRadius: 18, shadowColor: "#2955DB", shadowOpacity: 0.24, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 } : undefined}>
                        {pending ? "Signing in..." : "Sign in securely"}
                      </Button>
                      <View className="flex-row items-center gap-3 py-1">
                        <View className="h-px flex-1 bg-[#DCE3ED]" />
                        <Text className="text-[11px] font-medium text-[#7B8799]">OR</Text>
                        <View className="h-px flex-1 bg-[#DCE3ED]" />
                      </View>
                      {googleConfigured ? (
                        <GoogleSignInButton
                          disabled={pending}
                          onIdToken={(idToken) => void onGoogleSignIn(idToken)}
                          onError={setError}
                        />
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Google sign-in needs configuration"
                          disabled
                          className="h-12 flex-row items-center justify-center gap-2 rounded-2xl border border-[#D6DEEA] bg-white opacity-60"
                        >
                          <Ionicons name="logo-google" size={18} color="#4285F4" />
                          <Text className="text-sm font-semibold text-[#243B64]">Continue with Google</Text>
                        </Pressable>
                      )}
                    </>
                  ) : codeSent && !resetLinkSent ? (
                    <Button
                      accessibilityLabel={mode === "forgot" ? "Reset password" : "Verify and sign in"}
                      onPress={mode === "forgot" ? onResetPassword : onCodeSignIn}
                      disabled={pending || code.length !== 6 || (mode === "forgot" && (!password || !confirmPassword))}
                      className="h-12 justify-center"
                    >
                      {pending ? "Verifying..." : mode === "forgot" ? "Reset password" : "Verify and sign in"}
                    </Button>
                  ) : resetLinkSent ? null : (
                    <Button accessibilityLabel="Send verification code" onPress={onRequestCode} disabled={pending || !login} className="h-12 justify-center">
                      {pending ? "Sending code..." : "Send verification code"}
                    </Button>
                  )}

                  {mode === "password" ? (
                    <Pressable accessibilityRole="button" onPress={() => chooseMode("otp")} className="items-center py-2">
                      <Text className="text-xs font-medium text-ink-700">Prefer a code? <Text className="font-semibold text-clay-600">Use a one-time code</Text></Text>
                    </Pressable>
                  ) : mode === "otp" && !codeSent ? (
                    <Pressable accessibilityRole="button" onPress={() => chooseMode("password")} className="items-center py-1.5">
                      <Text className="text-xs font-semibold text-clay-600">Use password instead</Text>
                    </Pressable>
                  ) : null}

          {mode !== "password" && codeSent && !resetLinkSent ? (
            <Pressable disabled={pending} onPress={onRequestCode} className="items-center py-1">
              <Text className="text-xs font-semibold text-clay-600">Send a new code</Text>
            </Pressable>
          ) : null}
            </>
          )}
        </View>

        <View className={`${isWideLayout ? "mt-5 pt-4" : "mt-7 pt-5"} border-t border-[#DCE3ED]`}>
          {isWideLayout ? (
            <>
              <View className="flex-row flex-wrap items-center justify-center gap-1">
                {mode === "trial" ? (
                  <>
                    <Text className="text-xs text-ink-700">Already have a school?</Text>
                    <Pressable accessibilityRole="button" onPress={() => chooseMode("password")}>
                      <Text className="text-xs font-semibold text-clay-600">Sign in</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text className="text-xs text-ink-700">New to Anekio?</Text>
                    <Pressable accessibilityRole="button" onPress={() => chooseMode("trial")}>
                      <Text className="text-xs font-semibold text-clay-600">Create a new school</Text>
                    </Pressable>
                  </>
                )}
              </View>
              <Pressable accessibilityRole="link" onPress={() => void Linking.openURL("mailto:support@anekio.com")} className="mt-2.5 items-center">
                <Text className="text-xs text-ink-700">Need help? <Text className="font-medium text-clay-600">support@anekio.com</Text></Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${webOrigin()}/privacy`)} className="mt-2 items-center">
                <Text className="text-xs text-ink-700">By continuing, you agree to Anekio’s <Text className="font-medium text-clay-600">Privacy Policy</Text></Text>
              </Pressable>
            </>
          ) : (
            <View className="flex-row items-center justify-center gap-8">
              <Pressable accessibilityRole="link" accessibilityLabel="Contact support" onPress={() => void Linking.openURL("mailto:support@anekio.com")} className="items-center gap-1.5 px-2 py-1">
                <View className="h-8 w-8 items-center justify-center rounded-full bg-[#E8EEFC]">
                  <Ionicons name="help-circle-outline" size={18} color="#2955DB" />
                </View>
                <Text className="text-xs font-semibold text-[#3654A2]">Help</Text>
              </Pressable>
              <Pressable accessibilityRole="link" accessibilityLabel="Privacy policy" onPress={() => void Linking.openURL(`${webOrigin()}/privacy`)} className="items-center gap-1.5 px-2 py-1">
                <View className="h-8 w-8 items-center justify-center rounded-full bg-[#E8EEFC]">
                  <Ionicons name="shield-checkmark-outline" size={17} color="#2955DB" />
                </View>
                <Text className="text-xs font-semibold text-[#3654A2]">Privacy</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-[#F5F7FC]" testID="login-screen">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!isWideLayout && (keyboardVisible || !balancedPhoneLayout)}
        contentContainerStyle={{ minHeight: isWideLayout || balancedPhoneLayout ? height : Math.max(height, 680), flexGrow: 1 }}
      >
        <View className={`flex-1 items-center overflow-hidden ${isWideLayout ? "justify-center px-4 py-5 sm:px-6 sm:py-8" : balancedPhoneLayout ? "justify-center px-6 py-8" : "justify-start px-6 py-7"}`}>
          {!isWideLayout ? (
            <View pointerEvents="none" className="absolute inset-0">
              <View className="absolute -right-12 -top-8 h-36 w-36 rounded-full bg-[#E6ECFA]" />
              <View className="absolute -left-8 top-[190px] h-20 w-20 rounded-full border border-[#DFE9F8]" />
              <View className="absolute right-4 top-[270px] h-4 w-4 rotate-45 rounded-sm bg-[#CDEFEA]" />
              <Ionicons name="sparkles-outline" size={23} color="#9CB9DE" style={{ position: "absolute", left: 28, top: 134 }} />
              <Ionicons name="star" size={12} color="#F0B58B" style={{ position: "absolute", right: 45, top: 410 }} />
            </View>
          ) : null}
          <View
            className="w-full"
          >
            {!isWideLayout ? (
              <Animated.View
                style={{
                  height: keyboardProgress.interpolate({ inputRange: [0, 1], outputRange: [184, 112] }),
                  marginBottom: keyboardProgress.interpolate({ inputRange: [0, 1], outputRange: [40, 16] }),
                  alignItems: "center",
                }}
              >
                <Animated.View style={{ transform: [{ scale: keyboardProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] }) }] }}>
                  <Brand compact centered markSize={124} wordSize={36} />
                </Animated.View>
              </Animated.View>
            ) : null}
            <View
              className={`w-full overflow-hidden ${isWideLayout ? "self-center flex-row border border-[#DFE7F1] bg-white" : ""}`}
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
              <View className="w-[490px] justify-between bg-[#173B77] px-12 py-10">
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
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
