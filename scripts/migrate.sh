#!/usr/bin/env bash
# Run Anekio DB migrations (schema sync + data migrations) against one database.
#
#   bash scripts/migrate.sh                         # local SQLite from .env
#   bash scripts/migrate.sh --env .env.production   # Postgres (asks for confirmation)
#   bash scripts/migrate.sh --env .env.production --preview   # show SQL only, change nothing
#
# Flags:
#   --env <file>          env file holding DATABASE_URL (default: .env)
#   --preview             print the SQL `db push` would run, then exit
#   --yes                 skip the confirmation prompt for remote databases
#   --accept-data-loss    pass --accept-data-loss to prisma db push (only with approval)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE=".env"
PREVIEW=0
ASSUME_YES=0
DATA_LOSS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_FILE="$2"; shift 2 ;;
    --preview) PREVIEW=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --accept-data-loss) DATA_LOSS=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

[[ -f "$ENV_FILE" ]] || { echo "Env file not found: $ENV_FILE" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
[[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL is empty in $ENV_FILE" >&2; exit 1; }

# Node 20 like the other project scripts (skipped when nvm is not installed).
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  unset npm_config_prefix
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null
fi

PRISMA="$ROOT/node_modules/.bin/prisma"
TSX="$ROOT/node_modules/.bin/tsx"
[[ -x "$PRISMA" && -x "$TSX" ]] || { echo "Run npm install first (prisma/tsx missing)." >&2; exit 1; }

SCHEMA="prisma/schema.prisma"
IS_POSTGRES=0
if [[ "$DATABASE_URL" =~ ^postgres(ql)?:// ]]; then
  IS_POSTGRES=1
  # Same rewrite as scripts/vercel-prisma.mjs: the repo schema is SQLite.
  mkdir -p .vercel-prisma
  sed 's/provider *= *"sqlite"/provider = "postgresql"/' prisma/schema.prisma > .vercel-prisma/schema.prisma
  SCHEMA=".vercel-prisma/schema.prisma"
fi

# Masked target for logs: protocol://host/db (no credentials).
TARGET="$(printf '%s' "$DATABASE_URL" | sed -E 's#^([a-z]+://)([^@/]*@)?([^/?]*)(/[^?]*)?.*#\1\3\4#')"
echo "==> Env file : $ENV_FILE"
echo "==> Database : $TARGET"
echo "==> Schema   : $SCHEMA"

if [[ $PREVIEW -eq 1 ]]; then
  echo "==> SQL that 'prisma db push' would apply (nothing is changed):"
  "$PRISMA" migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel "$SCHEMA" --script
  echo "Note: ensure-subject-code also adds Subject.code + unique indexes before the push."
  exit 0
fi

if [[ $IS_POSTGRES -eq 1 && $ASSUME_YES -ne 1 ]]; then
  read -r -p "Migrate REMOTE database $TARGET ? Type 'yes' to continue: " answer
  [[ "$answer" == "yes" ]] || { echo "Aborted."; exit 1; }
fi

restore_local_client() {
  if [[ $IS_POSTGRES -eq 1 ]]; then
    echo "==> Restoring local SQLite Prisma client"
    "$PRISMA" generate --schema prisma/schema.prisma >/dev/null || true
  fi
}
trap restore_local_client EXIT

echo "==> [1/4] prisma generate"
"$PRISMA" generate --schema "$SCHEMA"

# Must run BEFORE db push: the schema adds @@unique([classId, code]) and every
# existing Subject would otherwise get code "" and the push would fail.
echo "==> [2/4] Subject codes: add column, backfill, dedupe, unique indexes"
"$TSX" scripts/ensure-subject-code.ts

echo "==> [3/4] prisma db push"
PUSH_ARGS=(db push --schema "$SCHEMA" --skip-generate)
[[ $DATA_LOSS -eq 1 ]] && PUSH_ARGS+=(--accept-data-loss)
"$PRISMA" "${PUSH_ARGS[@]}"

echo "==> [4/4] Backfill employee orgs"
"$TSX" scripts/backfill-employee-orgs.ts

echo "==> Migration finished for $TARGET"
