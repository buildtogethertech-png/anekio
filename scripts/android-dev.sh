#!/usr/bin/env bash
# Build + install "Anekio Dev" (in.anekio.school.dev) on a USB phone, then use `npx expo start` for live reload.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../mobile"
export APP_VARIANT=development
# android/ is shared with the Preview build; regenerate it when it was made for another app.
if [ ! -d android ] || ! grep -q "in.anekio.school.dev" android/app/build.gradle; then
  npx expo prebuild --platform android --clean --no-install
fi
npx expo run:android "$@"
