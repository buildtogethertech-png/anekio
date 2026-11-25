# Anekio school beacon (ESP32)

A small ESP32 board on a phone charger in the school office. Staff tap **Check in** on their phone near it.
It sends its name and a code that changes every 30 seconds, made with the school's secret key, so a fake beacon
app or a copied code does not work. One key per school; we put it on the beacon before we hand it over.

| File | What |
|---|---|
| `esp32-beacon.ino` | The firmware. Keep `BEACON_KEY` as the placeholder here: never commit a real key. |
| `flash.sh` | Puts the firmware with a school's key on a board, then checks it is sending. |
| `case/` | 3D-printed case for the ESP32-C3 SuperMini. |

---

## What to buy (per beacon)

| Item | Notes | About |
|---|---|---|
| **ESP32-C3 SuperMini** (preferred) or any **ESP32 dev board** (ESP32-WROOM / DevKit V1) | Both work. C3 is smaller and fits the case. Not ESP32-S2 (no Bluetooth). | ₹250–450 |
| USB cable that carries **data** | Charge-only cables cannot flash. USB-C for the C3, micro-USB for most DevKits. | ₹100 |
| Any 5 V phone charger (0.5 A or more) | An old one is fine. Not a laptop USB port (it sleeps). | ₹0–200 |
| Case (optional) | Print `case/` for the C3. No metal case: metal blocks Bluetooth. | ₹50–150 |

No battery, SIM or Wi-Fi needed.

---

## One time on the Mac that flashes beacons

```bash
bash hardware/esp32-beacon/flash.sh --setup
```

Installs `arduino-cli` (Homebrew) and the ESP32 board package **3.3.13**. Do not upgrade it to 4.x: 4.x renamed
the Bluetooth library and this firmware does not build there. The script pins the version for you.

---

## Onboard a school (production)

### 1. Turn it on and get the key (Anekio, as the school's admin)

**Who:** a login of that school with Settings access (the school's Admin, or us through a support login).

**Where:**

| | How to get there |
|---|---|
| Web (laptop) | Log in at **https://app.anekio.com** → left menu, under **ADMIN** → **Settings** → in the list, under **HR & Payroll** → **Staff attendance**. Direct link once logged in: **https://app.anekio.com/school?tab=staffAttendance** |
| Phone (Anekio app) | Office mode → bottom tab **More** → **Settings** → **HR & Payroll** → **Staff attendance** |

**What is on that screen (Bluetooth beacon card):**

| Setting | What to set |
|---|---|
| **Bluetooth beacon** (the round button on the card) | Select it. This makes Check in use the beacon. |
| **Beacon ID** | Leave as it is. The Anekio ESP32 does not use it when Rotating code is on. |
| **Beacon name** | Leave `Anekio-Gate-1`. With Rotating code on, other names (`Anekio-Gate-2`) also work. |
| **Counts as at school when the beacon is** | How close staff must be: **2 m** (at the desk), **5 m**, **Room**, **Walls** (next rooms too), **Far**. Start with **2 m** or **5 m**. |
| **Rotating code (stops fake beacons)** | **On.** Only after this does **Show beacon key** appear. |
| **Show beacon key** | Shows the line `const char* BEACON_KEY = "…";`. Copy it for `flash.sh`. The same key is shown every time until someone makes a new one. |
| **Use GPS when the beacon isn't found** | On, if the school's point is set (Location card): check in still works in a power cut or on an old app. |
| **Save** (bottom of the page) | Press after changing anything. |

Phone only (the browser can't use Bluetooth): **Test beacon here** checks if Check in would work where you stand,
and **Open beacon tester** shows live signal and the rotating code.

Steps:
1. Choose **Bluetooth beacon**.
2. Turn **Rotating code** on. Always on in production: without it, any phone app sending the same name passes.
3. Tap **Show beacon key** and copy the line it shows (or just the 32-character key inside it). Treat it like a password: don't put it in WhatsApp
   groups, screenshots or git.
4. Pick a distance (**2 m** for "at the office desk", **Room** for a bigger area) and **Save**.
5. Turn on **Use GPS when the beacon isn't found** if the school point is set: check in keeps working in a power cut.

### 2. Flash the beacon (Mac, board plugged in by USB)
```bash
bash hardware/esp32-beacon/flash.sh
```
Paste the key (or the whole `BEACON_KEY` line) when asked; it is hidden. The script:
1. finds the board and its chip (ESP32 or ESP32-C3);
2. builds the firmware with the key in a temporary copy (the repo file is never changed);
3. flashes and verifies it;
4. listens for 35 seconds and must show `slot 0` and `slot 1`, then prints **OK**.

More beacons for the same school (another gate, a second building): same key, another name:
```bash
bash hardware/esp32-beacon/flash.sh --name Anekio-Gate-2
```
Longer range for a big hall: `--power P3` (default `N0`; `N12` shortest … `P9` longest).

Write the school name on a sticker on the beacon so boards don't get mixed up.

### 3. Install at the school
1. Plug it into a phone charger in the office, at about chest height, not inside a metal cupboard.
2. Label it "Anekio attendance – do not unplug".
3. As the admin, on a phone: **Settings → Staff attendance → Bluetooth beacon → Test beacon here**, standing
   where staff will check in. For live signal and the rotating code: **Open beacon tester**.
4. Too weak where it should work → pick a farther distance in Settings (or reflash with `--power P3`).

### 4. Staff phones
- Staff need the Anekio app version **with Bluetooth** (Play Store build made after 23 Nov 2026). An OTA update
  cannot add Bluetooth to an older install.
- First check in asks for **Nearby devices** (Bluetooth) and **Location**: allow both, and keep Bluetooth on.

---

## Do / Don't

**Do**
- Keep **Rotating code on** for every school.
- Flash each school's beacons with **that school's** key, and label them.
- Use a data USB cable and a wall charger.
- Keep the key private. If it leaks, make a new one (below).

**Don't**
- Don't commit a real key, or edit `esp32-beacon.ino` with one: always use `flash.sh`.
- Don't power the beacon from a laptop or a TV USB port.
- Don't put it in a metal box, behind a steel almirah, or on the floor.
- Don't upgrade the ESP32 board package to 4.x.
- Don't press **New key (if it leaked)** unless you will reflash every beacon of that school right after: old beacons stop working.

---

## How the rotating code works

On power-on the beacon picks a random power-on ID and counts 30-second slots (0, 1, 2 …). Each slot it sends
`AK + power-on ID + slot + code`, where code = first 4 bytes of HMAC-SHA256(school key, "AK" + power-on ID + slot).
The phone passes these to the server, which recomputes the code with the key and only accepts the current slot
(±1). A power cut just gives a new power-on ID; the server accepts it, nothing to reset.

---

## Lost, stolen or leaked key

1. **Settings → Staff attendance → Bluetooth beacon → New key (if it leaked) → Make the new key.** All old beacons
   of that school stop working.
2. Reflash every beacon of that school with the new key (`flash.sh`).

## Troubleshooting

| Problem | Fix |
|---|---|
| `No ESP32 found` | Use a data cable; try another USB port. On Windows-made CH340 boards install the CH340 driver. |
| `Could not talk to the board` / upload fails at Connecting | Hold **BOOT**, tap **EN/RST**, release **BOOT**, run again. |
| `More than one USB device` | Unplug other devices or pass `--port /dev/cu.usbserial-…` (see `ls /dev/cu.*`). |
| `no rotating code seen` | Unplug and replug the board, run again. |
| Check in says "That is not your school's beacon" | Beacon flashed with another school's key, or Rotating code is off and the name differs. Reflash with this school's key. |
| Check in says the beacon is too far | Go closer, pick a farther distance in Settings, or reflash with `--power P3`. |
| Works for some phones only | Those phones run an old app (no Bluetooth) or have Bluetooth / Nearby devices off. |
