#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

unset npm_config_prefix
source "$HOME/.nvm/nvm.sh"
nvm use 20

npm run typecheck
npm run build-app

# The schema sync is scoped to this deployment only. Prisma still stops the
# release when it detects a potentially destructive change requiring review.
npx vercel deploy --prod --build-env ANEKIO_DB_PUSH_ON_BUILD=1
