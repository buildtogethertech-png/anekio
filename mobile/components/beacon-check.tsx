import { useEffect, useRef, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Platform, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { BackLink, Card } from "./ui";
import { askBlePermissions, beaconAverage, hexOf, matchSchoolBeacon, parseIBeacon, parseRotating } from "../lib/beacon-scan";
import { BEACON_DEFAULT_NAME, BEACON_DEFAULT_RSSI, BEACON_DEFAULT_UUID, BEACON_RSSI_CHOICES, type StaffAttendanceSetup } from "../lib/attendance-geo";
import { useOptionalRecord } from "../lib/record";

/**
 * Test screen for the school Bluetooth beacon (ESP32 sending iBeacon "Anekio-Gate-1").
 * Shows live signal strength and whether Check in would work here: same beacon ID and name, same
 * range and same averaging as Check in, taken from the school's Settings → Staff attendance.
 */

type Reading = { rssi: number; at: number };
type BeaconInfo = { major: number; minor: number; tx: number } | null;

export function BeaconCheck() {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [readings, setReadings] = useState<Reading[]>([]);
  const [info, setInfo] = useState<BeaconInfo>(null);
  const [rot, setRot] = useState<{ boot: string; ctr: number; code: string } | null>(null);
  const record = useOptionalRecord();
  const recordData = record?.data as { staffAttendanceSelf?: { attendanceSetup?: StaffAttendanceSetup }; staffAttendanceSetup?: StaffAttendanceSetup } | undefined;
  const setup = recordData?.staffAttendanceSelf?.attendanceSetup ?? recordData?.staffAttendanceSetup;
  const SCHOOL_UUID = setup?.beaconUuid || BEACON_DEFAULT_UUID;
  const BEACON_NAME = setup?.beaconName ?? BEACON_DEFAULT_NAME;
  const schoolRssi = setup?.beaconRssi ?? BEACON_DEFAULT_RSSI;
  const secure = Boolean(setup?.beaconSecure);
  const [threshold, setThreshold] = useState(schoolRssi);
  useEffect(() => setThreshold(schoolRssi), [schoolRssi]);
  const [now, setNow] = useState(Date.now());
  const [seen, setSeen] = useState(0);
  const [nearby, setNearby] = useState<Record<string, { name: string; rssi: number; mfr: string; at: number }>>({});
  const logged = useRef(new Set<string>());
  const manager = useRef<import("react-native-ble-plx").BleManager | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      manager.current?.stopDeviceScan();
      manager.current?.destroy();
      manager.current = null;
    };
  }, []);

  async function start() {
    setError("");
    if (Platform.OS === "web") {
      setError("Open this in the Anekio phone app. A browser can't scan for the beacon.");
      return;
    }
    if (!(await askBlePermissions())) {
      setError("Allow Bluetooth and Location (Nearby devices) for Anekio, then try again.");
      return;
    }
    try {
      const { BleManager, State } = await import("react-native-ble-plx");
      if (!manager.current) manager.current = new BleManager();
      const state = await manager.current.state();
      if (state !== State.PoweredOn) {
        setError("Turn on Bluetooth on this phone, then tap Start again.");
        return;
      }
      setScanning(true);
      manager.current.startDeviceScan(null, { allowDuplicates: true, scanMode: 2 }, (err, device) => {
        if (err) {
          setError(err.message);
          setScanning(false);
          return;
        }
        if (!device || device.rssi == null) return;
        const beacon = parseIBeacon(device.manufacturerData);
        const mfr = hexOf(device.manufacturerData);
        if (!logged.current.has(device.id)) {
          logged.current.add(device.id);
          console.log(`[beacon] ${device.id} rssi=${device.rssi} name=${device.name} local=${device.localName} mfr=${mfr} svc=${JSON.stringify(device.serviceUUIDs)}`);
        }
        setSeen((n) => n + 1);
        setNearby((prev) => ({ ...prev, [device.id]: { name: device.localName || device.name || "", rssi: device.rssi ?? -127, mfr, at: Date.now() } }));
        const ours = matchSchoolBeacon(device, { uuid: SCHOOL_UUID, name: BEACON_NAME, secure });
        const frame = parseRotating(device.manufacturerData);
        if (frame && (ours || device.localName === BEACON_NAME || device.name === BEACON_NAME)) setRot(frame);
        if (!ours) return;
        if (beacon) setInfo({ major: beacon.major, minor: beacon.minor, tx: beacon.tx });
        const rssi = device.rssi;
        setReadings((prev) => [...prev.slice(-59), { rssi, at: Date.now() }]);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bluetooth scanning is not available in this build.");
      setScanning(false);
    }
  }

  function stop() {
    manager.current?.stopDeviceScan();
    setScanning(false);
  }

  const last = readings[readings.length - 1];
  const fresh = last && now - last.at < 5000;
  const avg = beaconAverage(readings.map((r) => r.rssi));
  const inside = fresh && avg != null && avg >= threshold;
  const status = !scanning ? "Not scanning" : !last ? "Looking for the beacon…" : !fresh ? "Beacon lost" : inside ? "Check in works here" : "Too far for check in";
  const tone = !scanning || !last ? "bg-ink-100 text-ink-800" : !fresh ? "bg-red-50 text-red-700" : inside ? "bg-emerald-50 text-green-700" : "bg-amber-50 text-amber-800";
  const icon = !scanning || !last ? "bluetooth-outline" : !fresh ? "close-circle" : inside ? "checkmark-circle" : "walk-outline";

  return (
    <View className="gap-3">
      <BackLink label="Home" onPress={() => router.back()} />
      <Text className="text-xl font-semibold text-ink-900">School beacon test</Text>
      <Text className="-mt-2 text-xs text-ink-500">Walk around with this screen open. It shows how strong the beacon signal is.</Text>

      <Card className="items-center p-5">
        <View className={`flex-row items-center gap-2 rounded-full px-4 py-1.5 ${tone.split(" ")[0]}`}>
          <Ionicons name={icon as never} size={18} color={!scanning || !last ? "#334155" : !fresh ? "#b91c1c" : inside ? "#15803d" : "#92400e"} />
          <Text className={`text-sm font-semibold ${tone.split(" ")[1]}`}>{status}</Text>
        </View>
        <Text className="mt-3 text-5xl font-bold text-ink-900">{fresh && avg != null ? `${avg}` : "—"}</Text>
        <Text className="text-xs text-ink-500">{fresh && last ? `dBm average · now ${last.rssi} dBm` : "dBm"}</Text>
        {last ? <Text className="mt-1 text-[11px] text-ink-400">{`Last seen ${Math.max(0, Math.round((now - last.at) / 1000))}s ago`}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => (scanning ? stop() : void start())}
          className={`mt-4 h-12 w-full items-center justify-center rounded-xl ${scanning ? "border border-ink-200 bg-white" : "bg-[#1F45C7]"}`}
        >
          <Text className={`text-[15px] font-semibold ${scanning ? "text-ink-800" : "text-white"}`}>{scanning ? "Stop" : "Start"}</Text>
        </Pressable>
        {error ? <Text className="mt-3 text-center text-sm text-red-700">{error}</Text> : null}
      </Card>

      <Card className="p-4">
        <Text className="text-sm font-semibold text-ink-900">Check in works when the beacon is</Text>
        <View className="mt-2 flex-row gap-1.5">
          {BEACON_RSSI_CHOICES.map((c) => (
            <Pressable
              key={c.rssi}
              accessibilityRole="button"
              accessibilityLabel={`${c.label}, ${c.rssi} dBm`}
              onPress={() => setThreshold(c.rssi)}
              className={`flex-1 items-center rounded-lg border py-1.5 ${threshold === c.rssi ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200"}`}
            >
              <Text className={`text-sm font-semibold ${threshold === c.rssi ? "text-[#1F45C7]" : "text-ink-700"}`}>{c.label}</Text>
              <Text className="text-[10px] text-ink-500">{`${c.rssi}`}</Text>
              {c.rssi === schoolRssi ? <View className="mt-0.5 h-1 w-1 rounded-full bg-[#1F45C7]" /> : null}
            </Pressable>
          ))}
        </View>
        <Text className="mt-2 text-[11px] text-ink-500">
          {threshold === schoolRssi
            ? `Your school's setting (dot). Same rule as Check in: average of the last 5 readings.`
            : `Trying ${threshold} dBm. Check in still uses the school's setting (${schoolRssi} dBm, dot) until the admin changes it.`}
        </Text>
      </Card>

      {readings.length ? (
        <Card className="p-4">
          <Text className="text-sm font-semibold text-ink-900">Last {readings.length} readings</Text>
          <View className="mt-3 h-24 flex-row items-end" style={{ gap: 2 }}>
            {readings.map((r, i) => {
              const h = Math.max(4, Math.min(100, ((r.rssi + 100) / 60) * 100));
              return <View key={i} style={{ flex: 1, height: `${h}%`, backgroundColor: r.rssi >= threshold ? "#1baf7a" : "#eda100", borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />;
            })}
          </View>
          <View className="mt-1 flex-row justify-between">
            <Text className="text-[10px] text-ink-400">older</Text>
            <Text className="text-[10px] text-ink-400">now</Text>
          </View>
        </Card>
      ) : null}

      {scanning ? (
        <Card className="p-4">
          <Text className="text-sm font-semibold text-ink-900">{`Bluetooth around you · ${seen} signals`}</Text>
          {Object.entries(nearby)
            .filter(([, d]) => now - d.at < 10000)
            .sort((a, b) => b[1].rssi - a[1].rssi)
            .slice(0, 6)
            .map(([id, d]) => (
              <View key={id} className="mt-1.5 flex-row items-center gap-2">
                <Text className="w-12 text-xs font-semibold text-ink-900">{d.rssi}</Text>
                <Text className="min-w-0 flex-1 text-xs text-ink-700" numberOfLines={1}>{d.name || id}</Text>
                <Text className="w-24 text-[10px] text-ink-400" numberOfLines={1}>{d.mfr.slice(0, 12) || "—"}</Text>
              </View>
            ))}
        </Card>
      ) : null}

      <Card className="p-4">
        <Text className="text-sm font-semibold text-ink-900">Rotating code</Text>
        <Text className="mt-1 text-xs text-ink-600">
          {rot
            ? `Code ${rot.code.toUpperCase()} · slot ${rot.ctr} · power-on ${rot.boot.toUpperCase()}. It changes every 30 s.`
            : scanning
              ? "Not seen. This beacon sends a fixed ID only (old sketch)."
              : "Start to see the beacon's code."}
        </Text>
        <Text className="mt-1 text-[11px] text-ink-500">
          {secure ? "Your school needs the code: a beacon without it can't be used to check in." : "Your school doesn't need the code yet (Settings → Staff attendance → Rotating code)."}
        </Text>
      </Card>

      {info ? (
        <Card className="p-4">
          <Text className="text-sm font-semibold text-ink-900">Beacon</Text>
          <Text className="mt-1 text-xs text-ink-600">{`${BEACON_NAME} · Major ${info.major} · Minor ${info.minor} · 1 m power ${info.tx} dBm`}</Text>
        </Card>
      ) : null}
    </View>
  );
}
