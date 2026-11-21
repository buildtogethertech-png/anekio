import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from "react-native";
import { act } from "../lib/mutate";
import { Modal } from "./ui";

type Kit = {
  student: { id: string; name: string; admissionNo: string; classLabel: string };
  parent: { name: string; phone: string; setPasswordUrl?: string } | null;
  confirmation: { url: string; number: string } | null;
  confirmationError?: string;
  fee: { kind: "receipt" | "invoice"; label: string; amount: number; url: string } | null;
  files: { id: string; label: string; url: string; idProof: boolean }[];
  pending: string[];
  appUrl: string;
  webUrl: string;
};

type Item = { key: string; label: string; hint?: string; line: string };

function openUrl(url: string) {
  if (Platform.OS === "web" && typeof window !== "undefined") window.open(url, "_blank", "noopener");
  else void Linking.openURL(url).catch(() => undefined);
}

function waNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits.length >= 10 ? digits : "";
}

/** After admitting a student: send the family the admission confirmation, fee receipt, their files and the app link. */
export function AdmissionKitModal({
  token,
  studentId,
  headline,
  onClose,
}: {
  token: string | null;
  studentId: string;
  headline: string;
  onClose: () => void;
}) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [error, setError] = useState("");
  const [off, setOff] = useState<string[]>([]);
  const [kitUrl, setKitUrl] = useState("");

  useEffect(() => {
    if (!studentId) return;
    setKit(null);
    setError("");
    act<Kit & { ok: true }>(token, "admissionKit", { studentId })
      .then((res) => {
        setKit(res);
        setOff(res.files.filter((file) => file.idProof).map((file) => `file:${file.id}`));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not prepare the admission documents."));
  }, [token, studentId]);

  const items = useMemo<Item[]>(() => {
    if (!kit) return [];
    const list: Item[] = [];
    if (kit.confirmation)
      list.push({ key: "confirmation", label: "Admission confirmation", hint: "Own link · lists the documents received", line: `• Admission confirmation: ${kit.confirmation.url}` });
    if (kit.fee) {
      const amount = `₹${kit.fee.amount.toLocaleString("en-IN")}`;
      list.push({
        key: "fee",
        label: kit.fee.kind === "receipt" ? `Admission fee receipt (${amount})` : `Admission fee pay link (${amount})`,
        line: `${kit.fee.kind === "receipt" ? "Admission fee receipt" : "Pay admission fee"} (${amount}): ${kit.fee.url}`,
      });
    }
    for (const file of kit.files) {
      list.push({ key: `file:${file.id}`, label: file.label, hint: file.idProof ? "ID proof · off by default" : "Own link", line: `• ${file.label}: ${file.url}` });
    }
    const appLines = [
      "Parent app:",
      ...(kit.parent?.setPasswordUrl ? [`1. Set your password (link works for 7 days): ${kit.parent.setPasswordUrl}`] : []),
      `${kit.parent?.setPasswordUrl ? "2" : "1"}. Android app: ${kit.appUrl}`,
      `${kit.parent?.setPasswordUrl ? "3" : "2"}. Web: ${kit.webUrl.replace(/\/$/, "")}/login`,
      ...(kit.parent?.phone ? [`User ID: ${kit.parent.phone}`] : []),
    ];
    list.push({
      key: "app",
      label: "Parent app login",
      hint: kit.parent?.setPasswordUrl ? "Set-password link · app · web" : "App and web link",
      line: `\n${appLines.join("\n")}`,
    });
    return list;
  }, [kit]);

  const chosen = items.filter((item) => !off.includes(item.key));
  const fileIds = chosen.filter((item) => item.key.startsWith("file:")).map((item) => item.key.slice(5));
  const inPdf = chosen.some((item) => item.key === "confirmation" || item.key.startsWith("file:"));
  const fileKey = fileIds.join(",");
  const withConfirmation = chosen.some((item) => item.key === "confirmation");

  // One link for the whole pack: the confirmation first, then each chosen file as its own page.
  useEffect(() => {
    if (!kit || !inPdf) {
      setKitUrl("");
      return;
    }
    let live = true;
    setKitUrl("");
    act<{ ok: true; url: string }>(token, "admissionKitLink", { studentId: kit.student.id, fileIds: fileKey ? fileKey.split(",") : [], confirmation: withConfirmation })
      .then((res) => live && setKitUrl(res.url))
      .catch(() => live && setKitUrl(""));
    return () => {
      live = false;
    };
  }, [token, kit, inPdf, fileKey, withConfirmation]);

  function message() {
    if (!kit) return "";
    const hello = kit.parent?.name ? `Dear ${kit.parent.name},` : "Dear parent,";
    const lines = [
      hello,
      `Admission of ${kit.student.name} (Class ${kit.student.classLabel}, Admission No. ${kit.student.admissionNo}) is confirmed. Welcome to our school!`,
    ];
    const docs = chosen.filter((item) => item.key === "confirmation" || item.key.startsWith("file:")).map((item) => item.line);
    if (docs.length) lines.push("", "Documents (open any time):", ...docs);
    lines.push(...chosen.filter((item) => !(item.key === "confirmation" || item.key.startsWith("file:"))).map((item) => item.line));
    if (kit.pending.length) lines.push("", `Pending documents: ${kit.pending.join(", ")}. Please submit them at the school office.`);
    return lines.join("\n");
  }

  async function sendWhatsApp() {
    const text = encodeURIComponent(message());
    const number = kit?.parent?.phone ? waNumber(kit.parent.phone) : "";
    const query = `${number ? `phone=${number}&` : ""}text=${text}`;
    // api.whatsapp.com rather than wa.me: some school/office firewalls (e.g. Sophos) break wa.me's certificate.
    const web = `https://api.whatsapp.com/send?${query}`;
    if (Platform.OS !== "web") {
      // Phone: open the WhatsApp app straight away; fall back to the web link if it is not installed.
      try {
        await Linking.openURL(`whatsapp://send?${query}`);
      } catch {
        openUrl(web);
      }
      return;
    }
    openUrl(web);
  }

  const pdfItems = items.filter((item) => item.key === "confirmation" || item.key.startsWith("file:"));
  const extraItems = items.filter((item) => !(item.key === "confirmation" || item.key.startsWith("file:")));
  const canSend = Boolean(kit) && chosen.length > 0;
  const initials = (kit?.parent?.name || "P")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

  const row = (item: Item, last: boolean) => {
    const on = !off.includes(item.key);
    return (
      <Pressable
        key={item.key}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        accessibilityLabel={item.label}
        onPress={() => setOff((cur) => (on ? [...cur, item.key] : cur.filter((key) => key !== item.key)))}
        className={`flex-row items-center gap-3 px-3.5 py-3 active:bg-ink-50 ${last ? "" : "border-b border-ink-100"}`}
      >
        <View className={`h-[22px] w-[22px] items-center justify-center rounded-md ${on ? "bg-[#1F45C7]" : "border-2 border-ink-300 bg-white"}`}>
          {on ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
        </View>
        <View className="min-w-0 flex-1">
          <Text className={`text-[14px] font-semibold ${on ? "text-ink-900" : "text-ink-600"}`}>{item.label}</Text>
          {item.hint ? <Text className="mt-0.5 text-[12px] text-ink-500">{item.hint}</Text> : null}
        </View>
      </Pressable>
    );
  };

  const group = (title: string, list: Item[]) =>
    list.length ? (
      <View className="gap-2">
        <Text className="text-[12px] font-semibold text-ink-600">{title}</Text>
        <View className="overflow-hidden rounded-xl border border-ink-200 bg-white">{list.map((item, i) => row(item, i === list.length - 1))}</View>
      </View>
    ) : null;

  return (
    <Modal
      open={Boolean(studentId)}
      title="Student admitted"
      onClose={onClose}
      sheetOnPhone
      footer={
        <View className="gap-2.5">
          <Pressable
            accessibilityRole="button"
            disabled={!canSend}
            onPress={() => void sendWhatsApp()}
            className={`h-12 flex-row items-center justify-center gap-2 rounded-xl bg-[#16A34A] active:bg-[#15803D] ${canSend ? "" : "opacity-50"}`}
          >
            <Ionicons name="logo-whatsapp" size={20} color="#fff" />
            <Text className="text-[15px] font-semibold text-white">Send on WhatsApp</Text>
          </Pressable>
          <View className="flex-row gap-2.5">
            {inPdf ? (
              <Pressable
                accessibilityRole="button"
                disabled={!kitUrl}
                onPress={() => openUrl(kitUrl)}
                className={`h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-ink-200 bg-white active:bg-ink-50 ${kitUrl ? "" : "opacity-50"}`}
              >
                <Ionicons name="document-text-outline" size={17} color="#1F45C7" />
                <Text className="text-[14px] font-semibold text-[#1F45C7]">Open PDF</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              className="h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl active:bg-ink-50"
            >
              <Ionicons name="time-outline" size={17} color="#64748B" />
              <Text className="text-[14px] font-medium text-ink-600">Send later</Text>
            </Pressable>
          </View>
        </View>
      }
    >
      <View className="gap-5">
        <View className="items-center gap-2 pt-1">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
            <Ionicons name="checkmark" size={30} color="#059669" />
          </View>
          <Text className="text-center text-[18px] font-bold text-ink-900">{kit ? kit.student.name : "Student admitted"}</Text>
          {kit ? (
            <View className="flex-row flex-wrap items-center justify-center gap-1.5">
              <View className="rounded-full bg-ink-100 px-2.5 py-1">
                <Text className="text-[12px] font-semibold text-ink-700">{kit.student.admissionNo}</Text>
              </View>
              <View className="rounded-full bg-ink-100 px-2.5 py-1">
                <Text className="text-[12px] font-semibold text-ink-700">{`Class ${kit.student.classLabel}`}</Text>
              </View>
            </View>
          ) : null}
          {(() => {
            // The pills already show the number; keep only the extra news (fee invoiced, joins next year…).
            const extra = headline
              .split(" · ")
              .filter((part) => !/^Student (added|admitted)/.test(part) && part !== kit?.student.admissionNo)
              .join(" · ");
            return extra ? <Text className="text-center text-[12px] text-ink-500">{extra}</Text> : null;
          })()}
        </View>

        {error ? <Text className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</Text> : null}
        {!kit && !error ? (
          <View className="flex-row items-center justify-center gap-2 py-4">
            <ActivityIndicator size="small" />
            <Text className="text-[13px] text-ink-600">Preparing the admission documents…</Text>
          </View>
        ) : null}

        {kit ? (
          <>
            <View className="flex-row items-center gap-3 rounded-xl bg-[#F0FDF4] px-3.5 py-3">
              <View className="h-10 w-10 items-center justify-center rounded-full bg-white">
                <Text className="text-[13px] font-bold text-[#15803D]">{initials}</Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[12px] text-ink-500">Send to</Text>
                <Text className="text-[15px] font-semibold text-ink-900" numberOfLines={1}>
                  {kit.parent?.phone ? `${kit.parent.name || "Parent"} · ${kit.parent.phone}` : "Pick the chat in WhatsApp"}
                </Text>
              </View>
              <Ionicons name="logo-whatsapp" size={22} color="#16A34A" />
            </View>
            {group("Documents", pdfItems)}
            {group("Also send", extraItems)}
            {kit.confirmationError ? (
              <Text className="text-[12px] text-amber-700">{`Admission confirmation not added: ${kit.confirmationError}`}</Text>
            ) : null}
            {kit.pending.length ? (
              <View className="flex-row items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-3">
                <Ionicons name="alert-circle-outline" size={17} color="#B45309" />
                <Text className="min-w-0 flex-1 text-[12px] leading-[17px] text-amber-800">{`Still to collect: ${kit.pending.join(", ")}. The message asks the family to bring them.`}</Text>
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </Modal>
  );
}
