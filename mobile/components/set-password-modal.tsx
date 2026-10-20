import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Platform, Pressable, Share, Text, TextInput, View } from "react-native";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";
import { Button, Modal } from "./ui";

/** Easy to read out on a call: no 0/O, 1/l/I. */
function generatePassword() {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const pick = (set: string, n: number) => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join("");
  return `${pick(letters, 4)}${pick(digits, 4)}`;
}

/**
 * Admin sets a new password for someone else's login.
 * target: { userId } for staff / teachers / office users, or { parentId } for a student's parent.
 */
export function SetPasswordModal({
  open,
  name,
  target,
  onClose,
  onDone,
}: {
  open: boolean;
  name: string;
  target: { userId?: string; parentId?: string };
  onClose: () => void;
  onDone?: (message: string) => void;
}) {
  const { token } = useSession();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (open) {
      setPassword(generatePassword());
      setShow(true);
      setError("");
      setSaved("");
    }
  }, [open]);

  async function save() {
    if (password.trim().length < 6) {
      setError("Use at least 6 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await act(token, "adminSetPassword", { ...target, password: password.trim() });
      setSaved(password.trim());
      onDone?.(`New password set for ${name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    const text = `Your new Anekio password is: ${saved}\nPlease change it from Profile after you sign in.`;
    if (Platform.OS === "web") {
      try {
        await navigator.clipboard?.writeText(text);
      } catch {
        /* ignore */
      }
      return;
    }
    await Share.share({ message: text }).catch(() => undefined);
  }

  return (
    <Modal open={open} title={saved ? "Password changed" : `New password for ${name}`} onClose={onClose}>
      {saved ? (
        <View>
          <View className="items-center rounded-2xl bg-emerald-50 px-4 py-5">
            <Ionicons name="checkmark-circle" size={32} color="#059669" />
            <Text className="mt-2 text-[14px] text-ink-700">{name} can now sign in with</Text>
            <Text selectable className="mt-1 text-[26px] font-bold tracking-wider text-ink-900">{saved}</Text>
          </View>
          <Text className="mt-3 text-[13px] leading-5 text-ink-600">
            Share it with them privately. They also get a notice that their password was changed, and can change it from Profile.
          </Text>
          <View className="mt-4 flex-row justify-end gap-2">
            <Button variant="ghost" onPress={() => void share()}>
              {Platform.OS === "web" ? "Copy" : "Share"}
            </Button>
            <Button onPress={onClose}>Done</Button>
          </View>
        </View>
      ) : (
        <View>
          <Text className="text-[13px] leading-5 text-ink-600">
            Set a new password for {name}. Their old password stops working right away.
          </Text>
          <Text className="mb-1.5 mt-4 text-[12px] font-semibold text-ink-700">New password</Text>
          <View className="h-12 flex-row items-center rounded-xl border border-ink-200 bg-white pl-3.5 pr-1">
            <TextInput
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setError("");
              }}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoCorrect={false}
              className="min-w-0 flex-1 text-[16px] text-ink-900"
              placeholder="At least 6 characters"
              placeholderTextColor="#94A3B8"
            />
            <Pressable accessibilityLabel={show ? "Hide password" : "Show password"} onPress={() => setShow((v) => !v)} className="h-10 w-10 items-center justify-center">
              <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={19} color="#64748B" />
            </Pressable>
          </View>
          <Pressable onPress={() => setPassword(generatePassword())} className="mt-2 flex-row items-center gap-1.5 self-start">
            <Ionicons name="refresh-outline" size={14} color="#1F45C7" />
            <Text className="text-[13px] font-medium text-[#1F45C7]">Suggest another</Text>
          </Pressable>
          {error ? <Text className="mt-3 text-[13px] text-red-700">{error}</Text> : null}
          <View className="mt-5 flex-row justify-end gap-2">
            <Button variant="ghost" onPress={onClose}>
              Cancel
            </Button>
            <Button onPress={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Set password"}
            </Button>
          </View>
        </View>
      )}
    </Modal>
  );
}
