import { useEffect, useRef, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { PermissionsAndroid, Platform, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { BackLink, Card } from "./ui";

/**
 * Test screen for the school Bluetooth beacon (ESP32 sending iBeacon "Anekio-Gate-1").
 * Shows live signal strength and whether this phone would count as "at school".
 */

const SCHOOL_UUID = "8ec76ea3-6668-48da-9866-75be8bc86f4d";
const BEACON_NAME = "Anekio-Gate-1";
const THRESHOLDS = [-70, -80, -90];
const WINDOW = 8;

type Reading = { rssi: number; at: number };
type BeaconInfo = { major: number; minor: number; tx: number } | null;

function decodeBase64(b64: string) {
  const bin = globalThis.atob ? globalThis.atob(b64) : "";
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Apple iBeacon frame: 4C 00 02 15 <uuid 16> <major 2> <minor 2> <tx 1>. */
function parseIBeacon(manufacturerData?: string | null): (BeaconInfo & { uuid: string }) | null {
  if (!manufacturerData) return null;
  const b = decodeBase64(manufacturerData);
  if (b.length < 25 || b[0] !== 0x4c || b[1] !== 0x00 || b[2] !== 0x02 || b[3] !== 0x15) return null;
  const hex = [...b.slice(4, 20)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const tx = b[24] > 127 ? b[24] - 256 : b[24];
  return { uuid, major: (b[20] << 8) | b[21], minor: (b[22] << 8) | b[23], tx };
}

async function askPermissions() {
  if (Platform.OS !== "android") return true;
  const api = Number(Platform.Version);
  const wanted =
    api >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export function BeaconCheck() {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [readings, setReadings] = useState<Reading[]>([]);
  const [info, setInfo] = useState<BeaconInfo>(null);
  const [threshold, setThreshold] = useState(-80);
  const [now, setNow] = useState(Date.now());
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
    if (!(await askPermissions())) {
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
      manager.current.startDeviceScan(null, { allowDuplicates: true }, (err, device) => {
        if (err) {
          setError(err.message);
          setScanning(false);
          return;
        }
        if (!device || device.rssi == null) return;
        const beacon = parseIBeacon(device.manufacturerData);
        const ours = beacon?.uuid === SCHOOL_UUID || device.name === BEACON_NAME || device.localName === BEACON_NAME;
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
  const recent = readings.slice(-WINDOW);
  const avg = recent.length ? Math.round(recent.reduce((s, r) => s + r.rssi, 0) / recent.length) : null;
  const inside = fresh && avg != null && avg >= threshold;
  const status = !scanning ? "Not scanning" : !last ? "Looking for the beacon…" : !fresh ? "Beacon lost" : inside ? "At school" : "Too far";
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
        <Text className="text-sm font-semibold text-ink-900">Count as "at school" when signal is at least</Text>
        <View className="mt-2 flex-row gap-2">
          {THRESHOLDS.map((t) => (
            <Pressable
              key={t}
              accessibilityRole="button"
              onPress={() => setThreshold(t)}
              className={`flex-1 items-center rounded-lg border py-2 ${threshold === t ? "border-[#1F45C7] bg-[#EEF3FF]" : "border-ink-200"}`}
            >
              <Text className={`text-sm font-semibold ${threshold === t ? "text-[#1F45C7]" : "text-ink-700"}`}>{`${t} dBm`}</Text>
            </Pressable>
          ))}
        </View>
        <Text className="mt-2 text-[11px] text-ink-500">−40 to −60 is right next to it · −75 to −90 is a wall or two away.</Text>
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

      {info ? (
        <Card className="p-4">
          <Text className="text-sm font-semibold text-ink-900">Beacon</Text>
          <Text className="mt-1 text-xs text-ink-600">{`${BEACON_NAME} · Major ${info.major} · Minor ${info.minor} · 1 m power ${info.tx} dBm`}</Text>
        </Card>
      ) : null}
    </View>
  );
}
