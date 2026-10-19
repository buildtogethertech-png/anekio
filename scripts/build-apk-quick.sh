#!/usr/bin/env bash
# Fast local test APK (no EAS, no build credits). NOT for Google Play: it is signed with the debug key.
# Usage: npm run build-apk:quick            -> talks to production (https://app.anekio.com)
#        API_URL=https://app.staging.anekio.com npm run build-apk:quick
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../mobile" && pwd)"
cd "$MOBILE_DIR"

export EXPO_PUBLIC_API_URL="${API_URL:-https://app.anekio.com}"
export ORG_GRADLE_PROJECT_reactNativeArchitectures="${ARCHS:-arm64-v8a}"   # one chip type = much faster
export NODE_ENV=production
export APP_VARIANT=preview   # installs as "Anekio Preview" (in.anekio.school.preview), next to the Play and Dev apps

echo "Building test APK against $EXPO_PUBLIC_API_URL ($ORG_GRADLE_PROJECT_reactNativeArchitectures)"
# Re-create android/ only when app.json changed or the folder is missing.
if [ ! -d android ] || [ app.json -nt android/build.gradle ] || ! grep -q "in.anekio.school.preview" android/app/build.gradle; then
  npx expo prebuild --platform android --clean --no-install
fi

cd android
./gradlew assembleRelease

APK="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
OUT="$MOBILE_DIR/anekio-test-$(date +%Y%m%d-%H%M).apk"
cp "$APK" "$OUT"
cp "$APK" "$MOBILE_DIR/anekio-preview.apk"   # fixed name: always the latest build
echo ""
echo "APK ready: $OUT"
echo "Install on a USB-connected phone:  adb install -r mobile/anekio-preview.apk   (from the anekio folder)"
