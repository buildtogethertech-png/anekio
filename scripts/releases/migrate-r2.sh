#!/usr/bin/env bash
# Release r2 (2026-11-05)
#   - Usage tracking: UsageDaily table for the admin Usage page
#
#   bash scripts/releases/migrate-r2.sh                                    # local SQLite
#   bash scripts/releases/migrate-r2.sh --env .env.production --preview    # check first
#   bash scripts/releases/migrate-r2.sh --env .env.production              # apply
#
# Safe to run more than once. Only adds a table and indexes.
RELEASE_NAME="r2 (2026-11-05)"
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
release_init "$@"

run_sql scripts/sql/2026-11-05-usage-daily.sql

# Final check: anything else in the schema is added here. Fails instead of dropping data.
prisma_push

echo "==> Release r2 finished for $TARGET"
