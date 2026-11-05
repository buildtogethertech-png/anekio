#!/usr/bin/env bash
# Release r4 (2026-11-06)
#   - Teacher phones during the school day: SchoolConfig.schoolDayJson column and the
#     StaffPhoneEvent table (day start, breaks with reason, day end — for the Phone use report)
#
#   bash scripts/releases/migrate-r4.sh                                    # local SQLite
#   bash scripts/releases/migrate-r4.sh --env .env.production --preview    # check first
#   bash scripts/releases/migrate-r4.sh --env .env.production              # apply
#
# Safe to run more than once. Only adds a column, a table and indexes.
RELEASE_NAME="r4 (2026-11-06)"
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
release_init "$@"

run_sql scripts/sql/2026-11-06-school-day.sql

# Final check: anything else in the schema is added here. Fails instead of dropping data.
prisma_push

echo "==> Release r4 finished for $TARGET"
