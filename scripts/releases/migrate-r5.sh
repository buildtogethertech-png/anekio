#!/usr/bin/env bash
# Release r5 (2026-11-08)
#   - Teacher phones during the school day: SchoolConfig.schoolDayJson column and the
#     StaffPhoneEvent table (day start, breaks with reason, day end — for the Phone use report)
#   - LeaveType.noteRequired: the school decides per leave type whether a note to the approver is needed
#
#   bash scripts/releases/migrate-r5.sh                                    # local SQLite
#   bash scripts/releases/migrate-r5.sh --env .env.production --preview    # check first
#   bash scripts/releases/migrate-r5.sh --env .env.production              # apply
#
# Safe to run more than once. Only adds a column, a table and indexes.
RELEASE_NAME="r5 (2026-11-08)"
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
release_init "$@"

run_sql scripts/sql/2026-11-06-school-day.sql
run_sql scripts/sql/2026-11-08-leave-note-required.sql

# Final check: anything else in the schema is added here. Fails instead of dropping data.
prisma_push

echo "==> Release r5 finished for $TARGET"
