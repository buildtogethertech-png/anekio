#!/usr/bin/env bash
# Flash an Anekio school beacon onto an ESP32 plugged into this Mac by USB, then check it is sending.
#
#   bash hardware/esp32-beacon/flash.sh                         asks for the school's beacon key
#   bash hardware/esp32-beacon/flash.sh --name Anekio-Gate-2    a second beacon in the same school
#   bash hardware/esp32-beacon/flash.sh --power P3              longer range (N12 shortest … P9 longest)
#   bash hardware/esp32-beacon/flash.sh --port /dev/cu.usbserial-0001
#   bash hardware/esp32-beacon/flash.sh --setup                 only install the tools (once per Mac)
#
# The key comes from Anekio → Settings → Staff attendance → Bluetooth beacon → Rotating code → Show beacon key.
# It is typed in (hidden) or read from ANEKIO_BEACON_KEY, and only goes into a temporary copy of the sketch:
# never into this folder or git. Works for the ESP32 dev board and the ESP32-C3 SuperMini.
set -euo pipefail

CORE_VERSION="3.3.13" # ESP32 Arduino core. 4.x renamed the BLE library and does not build this sketch.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="Anekio-Gate-1"
POWER="N0"
PORT=""
SETUP_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="${2:?--name needs a value}"; shift 2 ;;
    --power) POWER="${2:?--power needs a value}"; shift 2 ;;
    --port) PORT="${2:?--port needs a value}"; shift 2 ;;
    --setup) SETUP_ONLY=1; shift ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[[ "$POWER" =~ ^(N12|N9|N6|N3|N0|P3|P6|P9)$ ]] || fail "--power must be one of N12 N9 N6 N3 N0 P3 P6 P9"
[[ "$NAME" =~ ^[A-Za-z0-9._-]{1,20}$ ]] || fail "--name: letters, numbers, - . _ only, up to 20 characters"

# ---- 1. Tools (installs only what is missing) -------------------------------------------------------
if ! command -v arduino-cli >/dev/null; then
  command -v brew >/dev/null || fail "Install Homebrew first: https://brew.sh"
  say "Installing arduino-cli"
  brew install arduino-cli
fi
if ! arduino-cli core list 2>/dev/null | grep -qE "^esp32:esp32 +$CORE_VERSION "; then
  say "Installing the ESP32 board package $CORE_VERSION (one time, a few minutes)"
  [[ -f "$HOME/Library/Arduino15/arduino-cli.yaml" ]] || arduino-cli config init >/dev/null
  arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json 2>/dev/null || true
  arduino-cli core update-index
  arduino-cli core install "esp32:esp32@$CORE_VERSION"
fi
ESPTOOL="$(ls -d "$HOME"/Library/Arduino15/packages/esp32/tools/esptool_py/*/ 2>/dev/null | tail -1)esptool"
[[ -x "$ESPTOOL" ]] || fail "esptool not found after installing the ESP32 package"
if [[ "$SETUP_ONLY" == 1 ]]; then say "Tools ready."; exit 0; fi

# ---- 2. The board ------------------------------------------------------------------------------------
if [[ -z "$PORT" ]]; then
  PORTS=$(ls /dev/cu.usbserial* /dev/cu.usbmodem* /dev/cu.wchusbserial* /dev/cu.SLAB_USBtoUART* 2>/dev/null || true)
  [[ -n "$PORTS" ]] || fail "No ESP32 found. Plug it in with a DATA USB cable (charge-only cables don't work), then run again."
  [[ $(wc -w <<<"$PORTS") -eq 1 ]] || fail "More than one USB device: pick one with --port. Found: $(echo $PORTS)"
  PORT="$PORTS"
fi
say "Board on $PORT"
CHIP=$("$ESPTOOL" --port "$PORT" chip-id 2>&1 | sed -n 's/^Chip type: *//p;s/^Chip is //p' | head -1)
case "$CHIP" in
  ESP32-C3*) FQBN="esp32:esp32:esp32c3:CDCOnBoot=cdc" ;;
  ESP32-D0WD* | ESP32-D0WDQ6* | ESP32-D2WD* | ESP32-PICO* | ESP32-U4WDH* | ESP32) FQBN="esp32:esp32:esp32" ;;
  "") fail "Could not talk to the board. Hold the BOOT button, tap EN/RST, release BOOT, then run again." ;;
  *) fail "Chip '$CHIP' is not supported here (use an ESP32 dev board or ESP32-C3)." ;;
esac
echo "    Chip: $CHIP"

# ---- 3. The school's key -----------------------------------------------------------------------------
KEY="${ANEKIO_BEACON_KEY:-}"
if [[ -z "$KEY" ]]; then
  printf '\nPaste the school beacon key (32 characters, hidden): '
  read -rs KEY
  echo
fi
# Settings shows the key as a whole sketch line; take the 32-character key from whatever was pasted.
KEY="$(grep -oE '[0-9a-fA-F]{32}' <<<"$KEY" | head -1 | tr 'A-F' 'a-f' || true)"
[[ "$KEY" =~ ^[0-9a-f]{32}$ ]] || fail "That is not a beacon key (32 characters, 0-9 and a-f). Copy it again from Settings."

# ---- 4. Build a private copy and flash ---------------------------------------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/esp32-beacon"
python3 -I - "$HERE/esp32-beacon.ino" "$WORK/esp32-beacon/esp32-beacon.ino" "$KEY" "$NAME" "$POWER" <<'PY'
import re, sys
src, dst, key, name, power = sys.argv[1:6]
s = open(src).read()
for pattern, value in [
    (r'const char\* BEACON_KEY = "[^"]*";', f'const char* BEACON_KEY = "{key}";'),
    (r'const char\* BEACON_NAME = "[^"]*";', f'const char* BEACON_NAME = "{name}";'),
    (r'const esp_power_level_t TX_POWER = ESP_PWR_LVL_\w+;', f'const esp_power_level_t TX_POWER = ESP_PWR_LVL_{power};'),
]:
    s, n = re.subn(pattern, value, s)
    if n != 1:
        sys.exit(f"Could not set {pattern} in the sketch")
open(dst, "w").write(s)
PY
say "Building ($FQBN)"
if ! OUT=$(arduino-cli compile --fqbn "$FQBN" "$WORK/esp32-beacon" 2>&1); then
  tail -20 <<<"$OUT"
  fail "Build failed."
fi
grep -E "Sketch uses" <<<"$OUT" | sed 's/^/    /' || true
say "Flashing"
if ! OUT=$(arduino-cli upload --fqbn "$FQBN" -p "$PORT" "$WORK/esp32-beacon" 2>&1) || ! grep -q "Hash of data verified" <<<"$OUT"; then
  tail -10 <<<"$OUT"
  fail "Upload failed. Hold BOOT while it says Connecting, then run again."
fi
echo "    Written and verified."

# ---- 5. Check it is sending ----------------------------------------------------------------------------
say "Checking the beacon (35 s: it should show slot 0 and slot 1)"
"$ESPTOOL" --port "$PORT" --after hard-reset read-mac >/dev/null 2>&1 || true
python3 -I - "$PORT" <<'PY'
import os, re, sys, termios, time
fd = os.open(sys.argv[1], os.O_RDONLY | os.O_NOCTTY | os.O_NONBLOCK)
a = termios.tcgetattr(fd)
a[0] = 0; a[1] = 0; a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL; a[3] = 0; a[4] = a[5] = termios.B115200
termios.tcsetattr(fd, termios.TCSANOW, a)
buf, end = b"", time.time() + 35
while time.time() < end:
    try: buf += os.read(fd, 4096)
    except BlockingIOError: time.sleep(0.05)
os.close(fd)
text = buf.decode("utf-8", "replace")
# Opening the port can reset the board a few times, leaving half lines: show only whole ones.
boots = re.findall(r"Anekio beacon \S+, power-on id [0-9A-F]{8}", text)
if boots:
    print("    " + boots[-1])
for slot in re.findall(r"slot \d+ +code [0-9A-F]{8}", text):
    print("    " + re.sub(r"code [0-9A-F]{8}", "code ********", slot))
slots = {int(m) for m in re.findall(r"slot (\d+)", text)}
if "BEACON_KEY is not set" in text:
    sys.exit("\nERROR: the beacon did not take the key. Run again.")
if len(slots) < 2:
    sys.exit("\nERROR: no rotating code seen. Unplug and plug the board, then run again.")
print("\nOK: beacon is sending with the school key. Unplug it and put it on a phone charger at the school.")
PY
