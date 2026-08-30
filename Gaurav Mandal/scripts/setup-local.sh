#!/usr/bin/env bash
set -euo pipefail

unset npm_config_prefix

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
  nvm use
else
  REQUIRED_NODE="$(tr -d '[:space:]' < .nvmrc)"
  CURRENT_NODE="$(node -v 2>/dev/null || true)"
  echo "nvm was not found. Make sure Node ${REQUIRED_NODE} is active before continuing."
  echo "Current node: ${CURRENT_NODE:-not found}"
fi

node scripts/setup-local.mjs
