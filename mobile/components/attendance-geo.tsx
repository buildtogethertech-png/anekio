import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { distanceMeters, GEO_MAX_ACCURACY_M, GEO_RADIUS_CHOICES, readFix, type AttendanceGeo, type Fix } from "../lib/attendance-geo";
import { act } from "../lib/mutate";
import { Button, Modal, Segmented, Switch } from "./ui";

type Note = { tone: "success" | "warn" | "danger"; title: string; body: string };

function NotePanel({ note }: { note: Note }) {
  const box = note.tone === "success" ? "border-green-200 bg-green-50" : note.tone === "warn" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50";
  const ink = note.tone === "success" ? "text-green-900" : note.tone === "warn" ? "text-amber-900" : "text-red-900";
  const icon = note.tone === "success" ? "checkmark-circle" : note.tone === "warn" ? "alert-circle" : "close-circle";
  const color = note.tone === "success" ? "#166534" : note.tone === "warn" ? "#92400e" : "#b91c1c";
  return (
    <View testID="geo-note" className={`flex-row items-start gap-2 rounded-md border p-3 ${box}`}>
      <Ionicons name={icon} size={18} color={color} />
      <View className="min-w-0 flex-1">
        <Text className={`text-sm font-semibold ${ink}`}>{note.title}</Text>
        {note.body ? <Text className={`mt-1 text-xs leading-5 ${ink}`}>{note.body}</Text> : null}
      </View>
    </View>
  );
}

function clock(value?: string) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Could not mark attendance.";
}

/**
 * "Mark here": staff mark their own in / out from their phone while at school. The first mark is the
 * entry, a later one is the exit (the server decides and checks distance, GPS accuracy and fake location).
 */
export function MarkHereSheet({
  open,
  token,
  today,
  onClose,
  onDone,
  onUseQr,
}: {
  open: boolean;
  token: string | null;
  today?: { marked?: boolean; inAt?: string; outAt?: string };
  onClose: () => void;
  onDone: () => void;
  onUseQr?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const checkedIn = Boolean(today?.marked && today?.inAt);

  async function mark() {
    setBusy(true);
    setNote(null);
    try {
      const fix = await readFix();
      const res = await act<{ ok: true; inAt: string; outAt: string; checkedOut: boolean }>(token, "markStaffAttendanceHere", fix);
      setNote(
        res.checkedOut
          ? { tone: "success", title: `Out at ${clock(res.outAt)}`, body: `In ${clock(res.inAt)} · Out ${clock(res.outAt)}. Mark again if you leave later.` }
          : { tone: "success", title: `In at ${clock(res.inAt)}`, body: "Mark again when you leave school." }
      );
      onDone();
    } catch (error) {
      setNote({ tone: "danger", title: "Not marked", body: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  const status = checkedIn
    ? today?.outAt
      ? `In ${clock(today.inAt)} · Out ${clock(today.outAt)}`
      : `Checked in today at ${clock(today?.inAt)}`
    : "Not marked yet today";

  return (
    <Modal
      open={open}
      title="My attendance"
      onClose={() => {
        setNote(null);
        onClose();
      }}
    >
      <View testID="mark-here-sheet" className="gap-3">
        <Text className="text-sm text-ink-600">{status}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={checkedIn ? "Mark out here" : "Mark in here"}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => void mark()}
          className={`items-center gap-1 rounded-xl px-4 py-5 ${checkedIn ? "bg-[#0f2744]" : "bg-clay-500"} ${busy ? "opacity-80" : ""}`}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name={checkedIn ? "log-out-outline" : "location"} size={26} color="#fff" />}
          <Text className="text-base font-semibold text-white">{busy ? "Finding your location…" : checkedIn ? "Mark out here" : "Mark in here"}</Text>
          {!busy ? <Text className="text-xs text-white/80">Works only inside the school</Text> : null}
        </Pressable>
        {note ? <NotePanel note={note} /> : null}
        {onUseQr ? (
          <Button variant="ghost" accessibilityLabel="Use QR instead" onPress={onUseQr}>
            Use QR instead
          </Button>
        ) : null}
      </View>
    </Modal>
  );
}

function place(geo: { lat: number; lng: number }) {
  return `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`;
}

/** Office: where the school is and how far from it counts as "at school". */
export function AttendanceGeoSetupButton({
  token,
  geo,
  onSaved,
  onMessage,
}: {
  token: string | null;
  geo: AttendanceGeo;
  onSaved: () => void;
  onMessage: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AttendanceGeo>(geo);
  const [busy, setBusy] = useState<"" | "point" | "test" | "save">("");
  const [note, setNote] = useState<Note | null>(null);
  const hasPoint = Boolean(draft.lat || draft.lng);

  function openSheet() {
    setDraft(geo);
    setNote(null);
    setOpen(true);
  }

  async function withFix(kind: "point" | "test", use: (fix: Fix) => void) {
    setBusy(kind);
    setNote(null);
    try {
      use(await readFix());
    } catch (error) {
      setNote({ tone: "danger", title: "No location", body: errorText(error) });
    } finally {
      setBusy("");
    }
  }

  function takePoint() {
    void withFix("point", (fix) => {
      if (fix.mocked) {
        setNote({ tone: "danger", title: "Fake location is on", body: "Turn it off and try again." });
        return;
      }
      setDraft((d) => ({ ...d, lat: fix.lat, lng: fix.lng, enabled: true }));
      setNote(
        fix.accuracy > GEO_MAX_ACCURACY_M
          ? { tone: "warn", title: `Rough fix (±${fix.accuracy} m)`, body: "Stand in the open middle of the school, wait a moment and take it again." }
          : { tone: "success", title: `School point taken (±${fix.accuracy} m)`, body: "Save to use it." }
      );
    });
  }

  function testHere() {
    void withFix("test", (fix) => {
      const m = Math.round(distanceMeters(draft, fix));
      const ok = m <= draft.radiusM && fix.accuracy <= GEO_MAX_ACCURACY_M && !fix.mocked;
      setNote(
        ok
          ? { tone: "success", title: `${m} m from the school point`, body: `Marking works here (±${fix.accuracy} m).` }
          : {
              tone: "warn",
              title: `${m} m from the school point`,
              body:
                fix.accuracy > GEO_MAX_ACCURACY_M
                  ? `GPS is rough here (±${fix.accuracy} m), so marking would be refused.`
                  : `Outside ${draft.radiusM} m: marking would be refused here. Pick a bigger distance if this is inside the school.`,
            }
      );
    });
  }

  async function save() {
    setBusy("save");
    try {
      await act(token, "saveAttendanceGeo", draft);
      onMessage(draft.enabled ? "Location attendance is on." : "Location attendance is off.");
      onSaved();
      setOpen(false);
    } catch (error) {
      setNote({ tone: "danger", title: "Not saved", body: errorText(error) });
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <Button variant="ghost" accessibilityLabel="Location attendance" onPress={openSheet}>
        {geo.enabled ? "📍 Location: on" : "📍 Location"}
      </Button>
      <Modal
        open={open}
        title="Attendance by location"
        onClose={() => setOpen(false)}
        footer={
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" onPress={() => setOpen(false)}>
              Cancel
            </Button>
            <Button accessibilityLabel="Save location attendance" disabled={busy !== "" || (draft.enabled && !hasPoint)} onPress={() => void save()}>
              {busy === "save" ? "Saving…" : "Save"}
            </Button>
          </View>
        }
      >
        <View testID="geo-setup" className="gap-4">
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold text-ink-900">Staff mark from their phone</Text>
              <Text className="mt-0.5 text-xs text-ink-500">Teachers and staff tap “Mark in here” in the app when they are at school. QR keeps working.</Text>
            </View>
            <Switch on={draft.enabled} onPress={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))} />
          </View>

          <View className="gap-2">
            <Text className="text-sm font-semibold text-ink-900">School point</Text>
            <Text testID="geo-point" className="text-xs text-ink-600">
              {hasPoint ? place(draft) : "Not set. Stand in the middle of the school and take it from your phone."}
            </Text>
            <Button variant="ghost" accessibilityLabel="Use my current location" disabled={busy !== ""} onPress={takePoint}>
              {busy === "point" ? "Finding location…" : hasPoint ? "Take it again from here" : "Use my current location"}
            </Button>
            {Platform.OS === "web" ? <Text className="text-xs text-amber-800">A laptop's location can be far off. Take the point from a phone at school.</Text> : null}
          </View>

          <View className="gap-2">
            <Text className="text-sm font-semibold text-ink-900">Counts as at school within</Text>
            <Segmented
              options={GEO_RADIUS_CHOICES.map((m) => ({ id: String(m), label: `${m} m` }))}
              value={String(draft.radiusM)}
              onChange={(id) => setDraft((d) => ({ ...d, radiusM: Number(id) }))}
            />
            <Text className="text-xs text-ink-500">150 m suits most schools. Bigger campus: 200–300 m.</Text>
          </View>

          {hasPoint ? (
            <Button variant="ghost" accessibilityLabel="Test here" disabled={busy !== ""} onPress={testHere}>
              {busy === "test" ? "Checking…" : "Test here (walk to the gate, staff room…)"}
            </Button>
          ) : null}
          {note ? <NotePanel note={note} /> : null}
        </View>
      </Modal>
    </>
  );
}
