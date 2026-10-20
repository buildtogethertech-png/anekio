#!/usr/bin/env bash
# Local Android build with EAS (AAB for Play by default; APK with PROFILE=production-test).
#
#   bash scripts/build-aab-local.sh                      # production → .aab
#   PROFILE=production-test bash scripts/build-aab-local.sh   # test APK
#
# Why this script exists: Gradle's :app:createBundleReleaseJsAndAssets spawns `node` itself. A Gradle
# daemon keeps the PATH it was started with, so it can pick an old Node 18 even after `nvm use 20`
# ("configs.toReversed is not a function"). We stop daemons, force Node 20 first on PATH, run Gradle
# without a daemon, and clear NODE_OPTIONS so no debugger attaches to every node process.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR/mobile"

unset NODE_OPTIONS
unset npm_config_prefix
source "$HOME/.nvm/nvm.sh"
nvm use 20 >/dev/null
NODE_BIN="$(nvm which 20)"
export PATH="$(dirname "$NODE_BIN"):$PATH"
export NODE_BINARY="$NODE_BIN"
export NODE_ENV=production
export GRADLE_OPTS="${GRADLE_OPTS:-} -Dorg.gradle.daemon=false"

echo "node: $(node -v) at $(which node)"
case "$(node -v)" in v2[0-9].*|v[3-9][0-9].*) ;; *) echo "Node 20+ required"; exit 1 ;; esac

# Kill any Gradle daemon that still carries an old PATH.
pkill -f GradleDaemon 2>/dev/null || true
if [ -x android/gradlew ]; then (cd android && ./gradlew --stop >/dev/null 2>&1 || true); fi

# Play builds: add 1 to the Android build number first (kept in mobile/app.json).
if [ "${PROFILE:-production}" = "production" ]; then
  node "$PROJECT_DIR/scripts/bump-android-version.js"
fi

npx eas-cli build --platform android --profile "${PROFILE:-production}" --local
