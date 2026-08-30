#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOBILE_DIR="$PROJECT_DIR/mobile"
BUILD_TMP="$(mktemp -d /tmp/anekio-eas-build.XXXXXX)"

cleanup() {
  rm -rf "$BUILD_TMP"
}
trap cleanup EXIT

unset npm_config_prefix
source "$HOME/.nvm/nvm.sh"
nvm use 20

rsync -a \
  --exclude node_modules \
  --exclude dist \
  --exclude .expo \
  --exclude android \
  --exclude ios \
  --exclude coverage \
  "$MOBILE_DIR/" "$BUILD_TMP/"

cd "$BUILD_TMP"
npm ci --ignore-scripts
npx eas-cli build --platform android --profile preview
