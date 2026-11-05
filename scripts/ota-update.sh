#!/usr/bin/env bash
# Publish an over-the-air (EAS Update) JS/UI update to installed Android apps — no Play Store review.
#   npm run update:prod    -- "Fixed fee receipt layout"              users get a "Tap to refresh" banner
#   npm run update:prod    -- --critical "Fee total fix"             installs as soon as it downloads
#   npm run update:preview -- "Try new dashboard"                     only test APKs (production-test / preview)
# Native changes (new native package, permissions, icon, app.json native settings) still need a Play build.
set -euo pipefail
CHANNEL="${1:?usage: ota-update.sh <production|preview> [--critical] \"message\"}"; shift
CRITICAL=0
if [[ "${1:-}" == "--critical" ]]; then CRITICAL=1; shift; fi
MESSAGE="${1:?Add a short message, e.g. \"Fixed fee receipt layout\"}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR/mobile"
unset npm_config_prefix
source "$HOME/.nvm/nvm.sh" >/dev/null
nvm use 20 >/dev/null

# Same values the matching EAS build profile bakes in (eas.json), so the update talks to production.
export EXPO_PUBLIC_API_URL="https://app.anekio.com"
case "$CHANNEL" in
  production) unset APP_VARIANT ;;
  preview) export APP_VARIANT=preview ;;
  *) echo "Channel must be production or preview"; exit 1 ;;
esac
export OTA_CRITICAL="$CRITICAL"

[[ "$CRITICAL" == 1 ]] && echo "==> CRITICAL update: apps reload as soon as it downloads."
echo "==> Publishing to channel '$CHANNEL': $MESSAGE"
npx eas-cli update --channel "$CHANNEL" --platform android --message "$MESSAGE" --non-interactive
echo "==> Done. Phones get it on next app open (or within 30 min of coming back to the app)."
echo "    Undo: npx eas-cli update:republish (pick the previous update) from the mobile folder."
