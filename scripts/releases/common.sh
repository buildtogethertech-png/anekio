#!/usr/bin/env bash
# Shared helpers for per-release migration scripts (scripts/releases/migrate-rN.sh).
# Source it, then call: release_init "$@"  →  run_sql / run_tsx / prisma_push.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ENV_FILE=".env"
PREVIEW=0
ASSUME_YES=0
DATA_LOSS=0
IS_POSTGRES=0
SCHEMA="prisma/schema.prisma"
PRISMA="$ROOT/node_modules/.bin/prisma"
TSX="$ROOT/node_modules/.bin/tsx"

release_usage() {
  cat <<USAGE
Usage: bash $0 [--env <file>] [--preview] [--yes] [--accept-data-loss]
  --env <file>          env file with DATABASE_URL (default: .env = local SQLite)
  --preview             show what would change, change nothing
  --yes                 no confirmation prompt for remote databases
  --accept-data-loss    pass --accept-data-loss to prisma db push (only with approval)
USAGE
}

release_init() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env) ENV_FILE="$2"; shift 2 ;;
      --preview) PREVIEW=1; shift ;;
      --yes|-y) ASSUME_YES=1; shift ;;
      --accept-data-loss) DATA_LOSS=1; shift ;;
      -h|--help) release_usage; exit 0 ;;
      *) echo "Unknown option: $1" >&2; release_usage; exit 1 ;;
    esac
  done
  [[ -f "$ENV_FILE" ]] || { echo "Env file not found: $ENV_FILE" >&2; exit 1; }
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  [[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL is empty in $ENV_FILE" >&2; exit 1; }

  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    unset npm_config_prefix
    # shellcheck disable=SC1091
    source "$HOME/.nvm/nvm.sh"
    nvm use 20 >/dev/null
  fi
  [[ -x "$PRISMA" && -x "$TSX" ]] || { echo "Run npm install first (prisma/tsx missing)." >&2; exit 1; }

  if [[ "$DATABASE_URL" =~ ^postgres(ql)?:// ]]; then
    IS_POSTGRES=1
    # Same rewrite as scripts/vercel-prisma.mjs: the repo schema is SQLite.
    mkdir -p .vercel-prisma
    sed 's/provider *= *"sqlite"/provider = "postgresql"/' prisma/schema.prisma > .vercel-prisma/schema.prisma
    SCHEMA=".vercel-prisma/schema.prisma"
  fi

  TARGET="$(printf '%s' "$DATABASE_URL" | sed -E 's#^([a-z]+://)([^@/]*@)?([^/?]*)(/[^?]*)?.*#\1\3\4#')"
  echo "==> Release  : ${RELEASE_NAME:-?}"
  echo "==> Env file : $ENV_FILE"
  echo "==> Database : $TARGET"
  echo "==> Schema   : $SCHEMA"

  if [[ $PREVIEW -eq 1 ]]; then
    echo "==> SQL that 'prisma db push' would apply after this release (nothing is changed):"
    "$PRISMA" migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel "$SCHEMA" --script
    exit 0
  fi

  if [[ $IS_POSTGRES -eq 1 && $ASSUME_YES -ne 1 ]]; then
    read -r -p "Run ${RELEASE_NAME:-release} on REMOTE database $TARGET ? Type 'yes' to continue: " answer
    [[ "$answer" == "yes" ]] || { echo "Aborted."; exit 1; }
  fi
  trap restore_local_client EXIT

  echo "==> prisma generate"
  "$PRISMA" generate --schema "$SCHEMA" >/dev/null
}

restore_local_client() {
  if [[ $IS_POSTGRES -eq 1 ]]; then
    echo "==> Restoring local SQLite Prisma client"
    "$PRISMA" generate --schema prisma/schema.prisma >/dev/null || true
  fi
}

# Additive Postgres SQL (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS). On SQLite, db push applies it.
run_sql() {
  local file="$1"
  if [[ $IS_POSTGRES -eq 1 ]]; then
    echo "==> SQL  $file"
    "$PRISMA" db execute --url "$DATABASE_URL" --file "$file"
  else
    echo "==> SQL  $file (SQLite: applied by prisma db push)"
  fi
}

run_tsx() {
  echo "==> TSX  $1"
  "$TSX" "$@"
}

prisma_push() {
  echo "==> prisma db push"
  local args=(db push --schema "$SCHEMA" --skip-generate)
  [[ $DATA_LOSS -eq 1 ]] && args+=(--accept-data-loss)
  "$PRISMA" "${args[@]}"
}
