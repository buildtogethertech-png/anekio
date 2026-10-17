import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { act } from "../lib/mutate";
import { useSession } from "../lib/session";
import { Card, Field, Input, Modal, Sheet } from "./ui";

/**
 * "Account details" on the Profile page: name, login email and WhatsApp number.
 *
 * Email and phone follow the usual pattern: current password → six-digit code to the NEW
 * email / WhatsApp → switched, with a heads-up to the old email. Nothing changes until the code
 * is confirmed.
 */

type Account = { name: string; email: string; phone: string; canEditName: boolean; canEditContact: boolean };
type Kind = "email" | "phone";
type CodeSent = { destination: string; channel: string; resendInSeconds: number; developmentCode?: string };

const prettyPhone = (phone: string) => (phone.length === 10 ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : phone);

export function AccountDetailsCard({ onMessage }: { onMessage: (message: string) => void }) {
  const { token, refresh } = useSession();
  const [account, setAccount] = useState<Account | null>(null);
  const [loadError, setLoadError] = useState("");
  const [nameOpen, setNameOpen] = useState(false);
  const [contact, setContact] = useState<Kind | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await act<{ ok: true; account: Account }>(token, "getMyAccount");
      setAccount(res.account);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load your details.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changed(message: string) {
    onMessage(message);
    await load();
    await refresh().catch(() => undefined);
  }

  if (!account) {
    return (
      <Card className="mb-4 p-5">
        <Text className="text-sm text-ink-700">{loadError || "Loading your details…"}</Text>
        {loadError ? (
          <Pressable onPress={() => void load()} className="mt-2 self-start">
            <Text className="text-sm font-medium text-clay-600">Try again</Text>
          </Pressable>
        ) : null}
      </Card>
    );
  }

  return (
    <Card className="mb-4 overflow-hidden">
      <Text className="px-5 pb-1 pt-4 text-[13px] font-semibold text-ink-900">Account details</Text>
      <DetailRow
        icon="person-outline"
        label="Name"
        value={account.name}
        action={account.canEditName ? "Edit" : undefined}
        note={account.canEditName ? undefined : "Ask the office to change your name"}
        onPress={() => setNameOpen(true)}
      />
      <DetailRow
        icon="mail-outline"
        label="Email"
        value={account.email || "Not added"}
        muted={!account.email}
        action={account.canEditContact ? (account.email ? "Change" : "Add") : undefined}
        onPress={() => setContact("email")}
      />
      <DetailRow
        icon="logo-whatsapp"
        label="Mobile (WhatsApp)"
        value={account.phone ? prettyPhone(account.phone) : "Not added"}
        muted={!account.phone}
        action={account.canEditContact ? (account.phone ? "Change" : "Add") : undefined}
        onPress={() => setContact("phone")}
        last
      />

      <NameSheet
        open={nameOpen}
        current={account.name}
        onClose={() => setNameOpen(false)}
        onSaved={async () => {
          setNameOpen(false);
          await changed("Name updated.");
        }}
      />
      <ContactSheet
        kind={contact}
        current={contact === "email" ? account.email : account.phone}
        onClose={() => setContact(null)}
        onChanged={async (kind) => {
          setContact(null);
          await changed(kind === "email" ? "Email updated. Use it the next time you sign in." : "Mobile number updated.");
        }}
      />
    </Card>
  );
}

function DetailRow({
  icon,
  label,
  value,
  action,
  note,
  muted,
  last,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  action?: string;
  note?: string;
  muted?: boolean;
  last?: boolean;
  onPress: () => void;
}) {
  const body = (
    <View className={`flex-row items-center gap-3 px-5 py-3.5 ${last ? "" : "border-b border-ink-100"}`}>
      <View className="h-9 w-9 items-center justify-center rounded-full bg-ink-50">
        <Ionicons name={icon} size={17} color="#334155" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-xs text-ink-700">{label}</Text>
        <Text className={`text-[15px] ${muted ? "text-ink-500" : "font-medium text-ink-900"}`} numberOfLines={1}>
          {value}
        </Text>
        {note ? <Text className="mt-0.5 text-[11px] text-ink-500">{note}</Text> : null}
      </View>
      {action ? <Text className="text-sm font-semibold text-clay-600">{action}</Text> : null}
    </View>
  );
  if (!action) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${action} ${label.toLowerCase()}`} onPress={onPress}>
      {body}
    </Pressable>
  );
}

/** Bottom sheet on phone (button stays at the bottom, above the keyboard), popup on desktop. */
function AccountSheet({
  open,
  title,
  step,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  step?: string;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  if (width >= 640) {
    return (
      <Modal open={open} title={title} onClose={onClose} footer={footer}>
        {step ? <Text className="-mt-2 mb-3 text-xs font-medium uppercase tracking-wide text-ink-500">{step}</Text> : null}
        {children}
      </Modal>
    );
  }
  return (
    <Sheet open={open} onClose={onClose}>
      <View className="px-5 pb-2">
        {/* The sheet already has its own close button by the handle. */}
        <View className="mb-4">
          {step ? <Text className="text-xs font-medium uppercase tracking-wide text-ink-500">{step}</Text> : null}
          <Text className="mt-0.5 text-lg font-semibold text-ink-900">{title}</Text>
        </View>
        {children}
        <View className="mt-5">{footer}</View>
      </View>
    </Sheet>
  );
}

function PrimaryAction({ label, busyLabel, busy, disabled, onPress }: { label: string; busyLabel: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      className={`h-12 flex-row items-center justify-center gap-2 rounded-xl ${off && !busy ? "bg-ink-200" : "bg-clay-500"}`}
    >
      {busy ? <ActivityIndicator color="#fff" size="small" /> : null}
      <Text className={`text-[15px] font-semibold ${off && !busy ? "text-ink-500" : "text-white"}`}>{busy ? busyLabel : label}</Text>
    </Pressable>
  );
}

function PasswordInput({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <View className="relative justify-center">
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={!shown}
        autoComplete="current-password"
        textContentType="password"
        autoCapitalize="none"
        placeholderTextColor="#3d4f66"
        className="rounded-md border border-ink-200 bg-white py-2.5 pl-3 pr-11 text-sm text-ink-900"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shown ? "Hide password" : "Show password"}
        onPress={() => setShown((v) => !v)}
        hitSlop={8}
        className="absolute right-2 h-8 w-8 items-center justify-center"
      >
        <Ionicons name={shown ? "eye-off-outline" : "eye-outline"} size={18} color="#64748B" />
      </Pressable>
    </View>
  );
}

function NameSheet({ open, current, onClose, onSaved }: { open: boolean; current: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { token } = useSession();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(current);
      setError("");
    }
  }, [open, current]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      await act(token, "updateMyName", { name });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const clean = name.replace(/\s+/g, " ").trim();
  return (
    <AccountSheet
      open={open}
      title="Edit name"
      onClose={onClose}
      footer={<PrimaryAction label="Save name" busyLabel="Saving…" busy={busy} disabled={clean.length < 2 || clean === current} onPress={() => void save()} />}
    >
      <View className="gap-3">
        <Field label="Full name">
          <Input value={name} onChangeText={setName} autoCapitalize="words" maxLength={80} />
        </Field>
        <Text className="text-xs text-ink-700">This is how your name shows on staff lists, payroll and messages.</Text>
        {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      </View>
    </AccountSheet>
  );
}

function ContactSheet({
  kind,
  current,
  onClose,
  onChanged,
}: {
  kind: Kind | null;
  current: string;
  onClose: () => void;
  onChanged: (kind: Kind) => Promise<void>;
}) {
  const { token } = useSession();
  const [value, setValue] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<CodeSent | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState(false);
  const email = kind === "email";

  useEffect(() => {
    if (kind) {
      setValue("");
      setPassword("");
      setCode("");
      setSent(null);
      setError("");
      setWait(0);
      setTouched(false);
    }
  }, [kind]);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function sendCode() {
    if (!kind) return;
    setBusy(true);
    setError("");
    try {
      const res = await act<CodeSent & { ok: true }>(token, "requestContactChange", { kind, value, password });
      setSent(res);
      setCode("");
      setWait(res.resendInSeconds || 45);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!kind) return;
    setBusy(true);
    setError("");
    try {
      await act(token, "confirmContactChange", { kind, code });
      await onChanged(kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not verify the code.");
    } finally {
      setBusy(false);
    }
  }

  const label = email ? "email" : "mobile number";
  const digits = value.replace(/\D/g, "");
  const valueOk = email ? /^\S+@\S+\.\S+$/.test(value.trim()) : digits.length === 10 || (digits.length === 12 && digits.startsWith("91"));
  const valueError = !value.trim() || valueOk
    ? ""
    : email
      ? /^[\d\s+()-]+$/.test(value.trim())
        ? "That looks like a phone number. Enter an email address."
        : "Enter a valid email address, like name@school.com."
      : "Enter a 10-digit mobile number.";
  const showValueError = Boolean(valueError) && (touched || (email ? value.includes("@") && value.includes(".") : digits.length > 10));
  const channelText = sent?.channel === "SMS" ? "by SMS" : sent?.channel === "EMAIL" ? "by email" : "on WhatsApp";

  return (
    <AccountSheet
      open={kind != null}
      title={`${current ? "Change" : "Add"} ${label}`}
      step={sent ? "Step 2 of 2 · Enter code" : "Step 1 of 2 · Confirm it's you"}
      onClose={() => !busy && onClose()}
      footer={
        sent ? (
          <PrimaryAction
            label={`Verify and update ${label}`}
            busyLabel="Checking…"
            busy={busy}
            disabled={code.replace(/\D/g, "").length !== 6}
            onPress={() => void verify()}
          />
        ) : (
          <PrimaryAction label="Send code" busyLabel="Sending…" busy={busy} disabled={!valueOk || !password} onPress={() => void sendCode()} />
        )
      }
    >
      {sent ? (
        <View className="gap-3">
          <View className="rounded-lg bg-[#EEF3FF] p-3">
            <Text className="text-sm leading-5 text-ink-900">
              {`We sent a 6-digit code ${channelText} to `}
              <Text className="font-semibold">{sent.destination}</Text>
              {". It expires in 10 minutes."}
            </Text>
          </View>
          <Field label="Code">
            <Input
              value={code}
              onChangeText={(next) => setCode(next.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
              placeholder="••••••"
              className="text-center text-[22px] font-semibold tracking-[0.5em]"
            />
          </Field>
          {sent.developmentCode ? <Text className="text-xs text-ink-500">{`Dev only: code ${sent.developmentCode}`}</Text> : null}
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <Pressable disabled={busy} onPress={() => setSent(null)} className="py-1">
              <Text className="text-sm font-medium text-clay-600">{`Use a different ${label}`}</Text>
            </Pressable>
            <Pressable disabled={busy || wait > 0} onPress={() => void sendCode()} className="py-1">
              <Text className={`text-sm font-medium ${wait > 0 ? "text-ink-500" : "text-clay-600"}`}>
                {wait > 0 ? `Resend in ${wait}s` : "Resend code"}
              </Text>
            </Pressable>
          </View>
          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
        </View>
      ) : (
        <View className="gap-3">
          <Text className="text-sm leading-5 text-ink-700">
            {email
              ? "Enter your password, then the new email. We'll send a code there to confirm it's yours. You'll sign in with the new email after this."
              : "Enter your password, then the new number. We'll send a code on WhatsApp to confirm it's yours. School messages will go to this number."}
          </Text>
          {current ? (
            <View className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5">
              <Text className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{`Current ${label}`}</Text>
              <Text className="mt-0.5 text-[15px] font-medium text-ink-900">{email ? current : prettyPhone(current)}</Text>
            </View>
          ) : null}
          {/* Password comes first so the browser doesn't treat the new email/number box as the login username and autofill it. */}
          <Field label="Your password">
            <PasswordInput value={password} onChangeText={setPassword} />
          </Field>
          <Field label={email ? "New email" : "New WhatsApp number"}>
            <Input
              value={value}
              onChangeText={setValue}
              onBlur={() => setTouched(true)}
              keyboardType={email ? "email-address" : "phone-pad"}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
              textContentType="none"
              placeholder={email ? "name@example.com" : "10-digit mobile number"}
              className={showValueError ? "border-red-400" : ""}
            />
          </Field>
          {showValueError ? <Text className="-mt-1 text-xs text-red-700">{valueError}</Text> : null}
          {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
        </View>
      )}
    </AccountSheet>
  );
}

/** Change password: same popup (desktop) / bottom sheet (phone) as Edit name and Change email/phone. */
export function PasswordSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { token } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setError("");
    }
  }, [open]);

  const mismatch = Boolean(confirm) && next !== confirm;

  async function save() {
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await act(token, "changePassword", { current, next });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountSheet
      open={open}
      title="Change password"
      onClose={onClose}
      footer={
        <PrimaryAction
          label="Save new password"
          busyLabel="Saving…"
          busy={busy}
          disabled={!current || !next || !confirm || mismatch}
          onPress={() => void save()}
        />
      }
    >
      <View className="gap-3">
        <Field label="Current password">
          <PasswordInput value={current} onChangeText={setCurrent} />
        </Field>
        <Field label="New password">
          <PasswordInput value={next} onChangeText={setNext} />
        </Field>
        <Field label="Confirm new password">
          <PasswordInput value={confirm} onChangeText={setConfirm} />
        </Field>
        {mismatch ? <Text className="text-xs text-red-700">New passwords do not match.</Text> : null}
        {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      </View>
    </AccountSheet>
  );
}
