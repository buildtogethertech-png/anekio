#!/usr/bin/env bash
# Applies scripts/sql/2026-11-01-payment-links-plans.sql (additive, safe to re-run) to one Postgres database.
#
#   bash scripts/migrate-payment-links.sh --env .env.production            # asks before running
#   bash scripts/migrate-payment-links.sh --env .env.production --check    # after running: shows what Prisma would still change (should be nothing)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
ENV_FILE=".env"; CHECK=0
while [[ $# -gt 0 ]]; do case "$1" in --env) ENV_FILE="$2"; shift 2;; --check) CHECK=1; shift;; *) echo "Unknown option: $1" >&2; exit 1;; esac; done
[[ -f "$ENV_FILE" ]] || { echo "Env file not found: $ENV_FILE" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a
[[ "${DATABASE_URL:-}" =~ ^postgres(ql)?:// ]] || { echo "DATABASE_URL in $ENV_FILE is not Postgres. For local SQLite use: npm run db:push" >&2; exit 1; }
PRISMA="$ROOT/node_modules/.bin/prisma"; [[ -x "$PRISMA" ]] || { echo "Run npm install first." >&2; exit 1; }
TARGET="$(printf '%s' "$DATABASE_URL" | sed -E 's#^([a-z]+://)([^@/]*@)?([^/?]*)(/[^?]*)?.*#\1\3\4#')"
mkdir -p .vercel-prisma
sed 's/provider *= *"sqlite"/provider = "postgresql"/' prisma/schema.prisma > .vercel-prisma/schema.prisma
if [[ $CHECK -eq 1 ]]; then
  echo "==> Remaining differences between $TARGET and the schema (empty = all good):"
  "$PRISMA" migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel .vercel-prisma/schema.prisma --script
  exit 0
fi
echo "==> Database: $TARGET"
read -r -p "Apply payment-links / plans changes to $TARGET ? Type 'yes': " a; [[ "$a" == "yes" ]] || { echo "Aborted."; exit 1; }
"$PRISMA" db execute --url "$DATABASE_URL" --file scripts/sql/2026-11-01-payment-links-plans.sql
echo "==> Done. Run again with --check to confirm nothing is left to change."
