import { useEffect, useState } from "react";
import { Image, Platform, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { act } from "../lib/mutate";
import { openStaffScanRoute } from "../lib/staff-attendance-scan";
import { Badge, Button, Modal } from "./ui";

type StaffQrResult = {
  qrText: string;
  qrDataUrl: string;
  expiresAt: string;
  ttlSeconds: number;
  person: { kind: "teacher" | "staff"; id: string; name: string; employeeId: string };
};

function expiryLabel(value?: string) {
  if (!value) return "";
  const time = new Date(value);
  if (Number.isNaN(+time)) return "";
  return time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function StaffAttendanceQrButton({
  token,
  disabled,
  compact,
  tile,
  alreadyMarked,
  markedLabel,
  onRefresh,
  onMessage,
}: {
  token: string | null;
  disabled?: boolean;
  compact?: boolean;
  tile?: boolean;
  alreadyMarked?: boolean;
  markedLabel?: string;
  onRefresh?: () => Promise<void> | void;
  onMessage: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<StaffQrResult | null>(null);
  const blocked = Boolean(disabled || alreadyMarked);
  const status = alreadyMarked ? markedLabel || "Attendance already marked for today" : "";

  useEffect(() => {
    if (!onRefresh) return;
    const refresh = () => {
      void onRefresh();
    };
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") refresh();
    };
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("focus", refresh);
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", onVis);
    }
    const id = setInterval(refresh, 15000);
    refresh();
    return () => {
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("focus", refresh);
      }
      if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onVis);
      }
      clearInterval(id);
    };
  }, [onRefresh]);

  async function generate() {
    if (blocked) {
      onMessage(status || "Attendance already marked for today");
      return;
    }
    setBusy(true);
    try {
      const result = await act<{ ok: true } & StaffQrResult>(token, "generateStaffAttendanceQr");
      setQr(result);
      setOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not generate attendance QR.";
      onMessage(message);
      if (/already marked/i.test(message)) {
        setQr(null);
        setOpen(false);
        await onRefresh?.();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {tile ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={alreadyMarked ? "Attendance already marked for today" : "Show attendance QR"}
          disabled={blocked || busy}
          onPress={() => void generate()}
          className={`min-w-[72px] flex-1 items-center rounded-md border border-ink-100 bg-white px-2 py-3 ${blocked || busy ? "opacity-50" : ""}`}
        >
          <Ionicons name="qr-code-outline" size={20} color="#2855F6" />
          <Text className="mt-1 text-xs font-medium text-ink-900">{alreadyMarked ? "Done" : busy ? "Wait" : "QR"}</Text>
        </Pressable>
      ) : (
        <View className="items-end gap-1">
          <Button
            variant="ghost"
            disabled={blocked || busy}
            onPress={() => void generate()}
            className={compact ? "shrink-0 px-2 py-2" : undefined}
            accessibilityLabel={alreadyMarked ? "Attendance already marked for today" : compact ? "Show QR" : "Show attendance QR"}
          >
            {alreadyMarked ? "Attendance marked" : busy ? "Generating..." : compact ? "Show QR" : "Show attendance QR"}
          </Button>
          {alreadyMarked ? <Text className="text-[11px] text-ink-700">{status}</Text> : null}
        </View>
      )}
      <Modal open={open && !alreadyMarked} title="My attendance QR" onClose={() => setOpen(false)} footer={<Button onPress={() => setOpen(false)}>Done</Button>}>
        {qr ? (
          <View className="items-center gap-4">
            <View className="items-center rounded-md border border-ink-100 bg-white p-3">
              <Image source={{ uri: qr.qrDataUrl }} resizeMode="contain" className="h-64 w-64" />
            </View>
            <View className="w-full gap-2">
              <View className="flex-row flex-wrap items-center justify-center gap-2">
                <Badge tone="leaf">{qr.person.name}</Badge>
                <Badge>{qr.person.employeeId}</Badge>
                <Badge tone="warn">{`Expires ${expiryLabel(qr.expiresAt)}`}</Badge>
              </View>
              <Text className="text-center text-xs leading-5 text-ink-700">
                Show this to the attendance scanner. It expires in {Math.round(qr.ttlSeconds / 60)} minutes and works once.
              </Text>
            </View>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

export function StaffAttendanceQrScanButton({
  disabled,
  compact,
}: {
  token?: string | null;
  disabled?: boolean;
  compact?: boolean;
  onDone?: () => Promise<void> | void;
  onMessage?: (message: string) => void;
}) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      onPress={() => openStaffScanRoute(router, Platform)}
      className={compact ? "shrink-0 px-2 py-2" : undefined}
      accessibilityLabel={compact ? "Scan" : "Scan attendance"}
    >
      {compact ? "Scan" : "Scan attendance"}
    </Button>
  );
}
