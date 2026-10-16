import { useState, type ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, KeyboardAvoidingView, Linking, Modal as RnModal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { webOrigin } from "../lib/api";
import { inr, SALARY_PAY_MODES } from "../lib/payroll";
import { pickFile, uploadFile, type PickedFile } from "../lib/upload";

/**
 * Phone bottom sheet for paying salary. Same look as fee "Collect payment":
 * big amount on top, method tiles, reference field, sticky pay button, then a success screen.
 */

const METHOD_TILE: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  CASH: { label: "Cash", icon: "cash-outline" },
  UPI: { label: "UPI", icon: "qr-code-outline" },
  BANK: { label: "Bank", icon: "business-outline" },
  CHEQUE: { label: "Cheque", icon: "document-text-outline" },
};

export function payMethodLabel(mode: string) {
  return METHOD_TILE[mode]?.label || mode;
}

export function SalarySheetFrame({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <RnModal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end">
        <Pressable accessibilityRole="button" accessibilityLabel="Close" className="absolute inset-0 bg-black/40" onPress={onClose} />
        <View className="rounded-t-3xl bg-white" style={{ maxHeight: "92%" }}>
          <SafeAreaView edges={["bottom"]}>
            <View className="items-center pt-2">
              <View className="h-1 w-10 rounded-full bg-ink-200" />
            </View>
            {title ? (
              <View className="flex-row items-start gap-3 px-5 pb-1 pt-3">
                <View className="min-w-0 flex-1">
                  <Text className="text-lg font-semibold text-ink-900" numberOfLines={1}>
                    {title}
                  </Text>
                  {subtitle ? <Text className="text-xs text-ink-500">{subtitle}</Text> : null}
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full bg-ink-100">
                  <Ionicons name="close" size={18} color="#3d4f66" />
                </Pressable>
              </View>
            ) : null}
            <ScrollView className="px-5" contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
            {footer ? <View className="border-t border-ink-100 px-5 pb-2 pt-3">{footer}</View> : null}
          </SafeAreaView>
        </View>
      </KeyboardAvoidingView>
    </RnModal>
  );
}

export function SheetLabel({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View className="mb-2 mt-4 flex-row items-center justify-between">
      <Text className="text-xs font-semibold uppercase tracking-wide text-ink-500">{children}</Text>
      {right}
    </View>
  );
}

export function PayMethodTiles({ value, onChange, disabled }: { value: string; onChange: (mode: string) => void; disabled?: boolean }) {
  return (
    <View className="flex-row gap-2">
      {SALARY_PAY_MODES.map((m) => {
        const on = value === m;
        const t = METHOD_TILE[m];
        return (
          <Pressable
            key={m}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
            disabled={disabled}
            onPress={() => onChange(m)}
            className={`h-[64px] flex-1 items-center justify-center gap-1 rounded-xl border ${on ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200 bg-white"}`}
          >
            <Ionicons name={t.icon} size={20} color={on ? "#1F45C7" : "#475569"} />
            <Text className={`text-xs font-medium ${on ? "text-[#1F45C7]" : "text-ink-700"}`}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SheetInput(props: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  accessibilityLabel?: string;
  autoCapitalize?: "none" | "characters" | "sentences";
  editable?: boolean;
}) {
  return (
    <TextInput
      {...props}
      placeholderTextColor="#94a3b8"
      className="rounded-xl border border-ink-200 px-3 py-3 text-sm text-ink-900"
      style={{ includeFontPadding: false }}
    />
  );
}

export function SheetPayButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`h-12 items-center justify-center rounded-xl ${disabled ? "bg-ink-200" : "bg-[#1F45C7]"}`}
    >
      <Text className="text-[15px] font-semibold text-white">{label}</Text>
    </Pressable>
  );
}

export function SalaryPaidSuccess({ amount, line, sub, onDone }: { amount: number; line: string; sub: string; onDone: () => void }) {
  return (
    <View className="items-center pb-4 pt-6">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <Ionicons name="checkmark" size={36} color="#15803d" />
      </View>
      <Text className="mt-4 text-[28px] font-bold text-ink-900">{inr(amount)}</Text>
      <Text className="mt-1 text-sm text-ink-600">{line}</Text>
      <Text className="mt-0.5 text-xs text-ink-500">{sub}</Text>
      <Pressable accessibilityRole="button" onPress={onDone} className="mt-6 h-12 w-full items-center justify-center rounded-xl border border-ink-200">
        <Text className="text-[15px] font-semibold text-ink-800">Done</Text>
      </Pressable>
    </View>
  );
}

/** What the proof should be, per method. */
export function proofHint(mode: string) {
  if (mode === "CASH") return "Photo of the salary slip signed by the employee";
  if (mode === "CHEQUE") return "Photo of the cheque";
  return "Screenshot of the UPI / bank transfer";
}

/** Optional proof picker (photo or PDF). Works in both the phone sheet and desktop popups. */
export function ProofAttach({
  mode,
  file,
  onChange,
  disabled,
}: {
  mode: string;
  file: PickedFile | null;
  onChange: (file: PickedFile | null) => void;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState(false);
  if (file) {
    const image = isImageFile(file.type, file.name);
    const show = () => (image ? setPreview(true) : void openUri(file.uri));
    return (
      <>
        <View className="flex-row items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
          <Pressable accessibilityRole="button" accessibilityLabel="Preview proof" onPress={show}>
            {image ? (
              <Image source={{ uri: file.uri }} style={{ width: 52, height: 52, borderRadius: 10, backgroundColor: "#fff" }} resizeMode="cover" />
            ) : (
              <View className="h-[52px] w-[52px] items-center justify-center rounded-[10px] bg-white">
                <Ionicons name="document-text" size={22} color="#047857" />
                <Text className="text-[9px] font-bold text-emerald-700">PDF</Text>
              </View>
            )}
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-medium text-ink-900" numberOfLines={1}>{file.name}</Text>
            <View className="mt-1 flex-row items-center gap-3">
              <Pressable accessibilityRole="button" hitSlop={6} onPress={show} className="flex-row items-center gap-1">
                <Ionicons name="eye-outline" size={14} color="#1F45C7" />
                <Text className="text-xs font-semibold text-[#1F45C7]">Preview</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                hitSlop={6}
                disabled={disabled}
                onPress={async () => {
                  const picked = await pickFile("image/*,application/pdf").catch(() => null);
                  if (picked) onChange(picked);
                }}
              >
                <Text className="text-xs font-semibold text-ink-600">Change</Text>
              </Pressable>
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Remove proof" hitSlop={8} disabled={disabled} onPress={() => onChange(null)} className="h-8 w-8 items-center justify-center rounded-full bg-white">
            <Ionicons name="trash-outline" size={16} color="#b91c1c" />
          </Pressable>
        </View>
        <ProofPreview open={preview} uri={file.uri} name={file.name} onClose={() => setPreview(false)} />
      </>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Attach proof"
      disabled={disabled}
      onPress={async () => {
        const picked = await pickFile("image/*,application/pdf").catch(() => null);
        if (picked) onChange(picked);
      }}
      className="flex-row items-center gap-3 rounded-xl border-2 border-dashed border-ink-200 px-3 py-3"
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-[#EEF3FF]">
        <Ionicons name={mode === "CASH" ? "camera-outline" : "attach-outline"} size={18} color="#1F45C7" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-semibold text-[#1F45C7]">Attach proof</Text>
        <Text className="text-[11px] text-ink-500">{`${proofHint(mode)} · optional`}</Text>
      </View>
    </Pressable>
  );
}

/** Uploads the proof (if any) and returns its stored path. */
export async function uploadSalaryProof(token: string | null, file: PickedFile | null) {
  if (!file) return "";
  const res = await uploadFile(token, file, { kind: "salaryProof" });
  return res.path;
}

/** Opens a private proof file in the browser / viewer. */
export async function openSalaryProof(token: string | null, path: string) {
  await openUri(await proofViewUrl(token, path));
}

export function isImageFile(type?: string, name?: string) {
  return (type || "").startsWith("image/") || /\.(jpe?g|png|webp|gif|heic)$/i.test(name || "");
}

async function openUri(uri: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    if (uri.startsWith("data:")) {
      const w = window.open("", "_blank");
      if (w) w.document.write(`<iframe src="${uri}" style="border:0;width:100%;height:100%"></iframe>`);
      return;
    }
    window.open(uri, "_blank");
    return;
  }
  await Linking.openURL(uri);
}

async function proofViewUrl(token: string | null, path: string) {
  const res = await fetch(`${webOrigin()}/api/files/view-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ path }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string };
  if (!res.ok || !data.url) throw new Error("Could not open the proof.");
  return data.url;
}

/** Full-screen image preview on a dark backdrop; tap the image or X to close. */
export function ProofPreview({ open, uri, name, onClose }: { open: boolean; uri: string; name?: string; onClose: () => void }) {
  return (
    <RnModal visible={open && Boolean(uri)} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/90">
        <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
          <View className="flex-row items-center gap-3 px-4 py-3">
            <Text className="min-w-0 flex-1 text-sm font-medium text-white" numberOfLines={1}>{name || "Proof"}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close preview" hitSlop={10} onPress={onClose} className="h-9 w-9 items-center justify-center rounded-full bg-white/15">
              <Ionicons name="close" size={20} color="#fff" />
            </Pressable>
          </View>
          <Pressable className="flex-1 px-3 pb-4" onPress={onClose} accessibilityLabel="Close preview">
            <Image source={{ uri }} style={{ width: "100%", height: "100%" }} resizeMode="contain" />
          </Pressable>
        </SafeAreaView>
      </View>
    </RnModal>
  );
}

/** "View proof" on a saved payment: images open in the in-app preview, PDFs in the viewer. */
export function SavedProofLink({ token, path, onError }: { token: string | null; path: string; onError: (m: string) => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const image = isImageFile("", path);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View proof"
        hitSlop={6}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const signed = await proofViewUrl(token, path);
            if (image) setUrl(signed);
            else await openUri(signed);
          } catch (e) {
            onError(e instanceof Error ? e.message : "Could not open the proof.");
          } finally {
            setBusy(false);
          }
        }}
        className="mt-1 flex-row items-center gap-1 self-start"
      >
        <Ionicons name="eye-outline" size={13} color="#1F45C7" />
        <Text className="text-[12px] font-semibold text-[#1F45C7]">{busy ? "Opening…" : "View proof"}</Text>
      </Pressable>
      <ProofPreview open={Boolean(url)} uri={url} name="Payment proof" onClose={() => setUrl("")} />
    </>
  );
}
