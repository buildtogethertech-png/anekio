// Anekio school beacon for staff check in (ESP32, Arduino IDE).
//
// Sends its name ("Anekio-Gate-1") and a rotating code that changes every 30 seconds:
//   manufacturer data  FF FF 'A' 'K' <power-on id 4> <slot 4> <code 4>
//   code = first 4 bytes of HMAC-SHA256(BEACON_KEY, "AK" + power-on id + slot)
// No clock needed: every power-on picks a new random id and counts 30 s slots from 0.
// The Anekio server knows the key, checks the code, and refuses old or copied codes.
//
// 1. Anekio → Settings → Staff attendance → Bluetooth beacon → turn on "Rotating code" → Show beacon key.
// 2. Paste the key below, upload to the ESP32, plug it into a phone charger near the office desk.

#include <BLEDevice.h>
#include <BLEAdvertising.h>
#include <esp_bt.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <esp_arduino_version.h>
#include "mbedtls/md.h"

const char* BEACON_NAME = "Anekio-Gate-1";
const char* BEACON_KEY = "PASTE_THE_32_CHARACTER_KEY_FROM_ANEKIO";
// Signal power: ESP_PWR_LVL_N12 (shortest) ... N9, N6, N3, N0 (default), P3, P6, P9 (longest).
const esp_power_level_t TX_POWER = ESP_PWR_LVL_N0;

const uint64_t SLOT_US = 30ULL * 1000 * 1000;

uint8_t key[16];
bool keyOk = false;
uint32_t bootId;
uint32_t lastSlot = 0xFFFFFFFF;
BLEAdvertising* adv;

static int hexValue(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static bool readKey() {
  if (strlen(BEACON_KEY) != 32) return false;
  for (int i = 0; i < 16; i++) {
    int hi = hexValue(BEACON_KEY[2 * i]);
    int lo = hexValue(BEACON_KEY[2 * i + 1]);
    if (hi < 0 || lo < 0) return false;
    key[i] = (hi << 4) | lo;
  }
  return true;
}

static void put32(uint8_t* out, uint32_t v) {
  out[0] = v >> 24;
  out[1] = v >> 16;
  out[2] = v >> 8;
  out[3] = v;
}

static void codeFor(uint32_t slot, uint8_t out[4]) {
  uint8_t msg[10] = {'A', 'K'};
  put32(msg + 2, bootId);
  put32(msg + 6, slot);
  uint8_t mac[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);
  mbedtls_md_hmac_starts(&ctx, key, sizeof key);
  mbedtls_md_hmac_update(&ctx, msg, sizeof msg);
  mbedtls_md_hmac_finish(&ctx, mac);
  mbedtls_md_free(&ctx);
  memcpy(out, mac, 4);
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
static String bytes(const uint8_t* b, size_t n) {
  String s;
  for (size_t i = 0; i < n; i++) s += (char)b[i];
  return s;
}
#else
static std::string bytes(const uint8_t* b, size_t n) { return std::string((const char*)b, n); }
#endif

static void advertise(uint32_t slot) {
  BLEAdvertisementData data;
  data.setFlags(0x06);
  if (keyOk) {
    uint8_t m[16] = {0xFF, 0xFF, 'A', 'K'};
    put32(m + 4, bootId);
    put32(m + 8, slot);
    codeFor(slot, m + 12);
    data.setManufacturerData(bytes(m, sizeof m));
    Serial.printf("slot %lu  code %02X%02X%02X%02X\n", (unsigned long)slot, m[12], m[13], m[14], m[15]);
  }
  BLEAdvertisementData scan;
  scan.setName(BEACON_NAME);
  adv->stop();
  adv->setAdvertisementData(data);
  adv->setScanResponseData(scan);
  adv->start();
}

void setup() {
  Serial.begin(115200);
  keyOk = readKey();
  if (!keyOk) Serial.println("BEACON_KEY is not set: sending the name only (Rotating code check in won't work).");
  bootId = esp_random();
  Serial.printf("Anekio beacon %s, power-on id %08lX\n", BEACON_NAME, (unsigned long)bootId);

  BLEDevice::init(BEACON_NAME);
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, TX_POWER);
  adv = BLEDevice::getAdvertising();
  adv->setScanResponse(true);
  adv->setMinInterval(160);  // 100 ms (units of 0.625 ms)
  adv->setMaxInterval(240);  // 150 ms
}

void loop() {
  uint32_t slot = (uint32_t)(esp_timer_get_time() / SLOT_US);
  if (slot != lastSlot) {
    lastSlot = slot;
    advertise(slot);
  }
  delay(200);
}
