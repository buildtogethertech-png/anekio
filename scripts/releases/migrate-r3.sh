#!/usr/bin/env bash
# Release r3 (2026-11-06)
#   - Class attendance cover: ClassAttendanceCover table (who marks a class's attendance while its class teacher is out)
#   - Timetable activities (Games, Library, Assembly… — not part of exams): TimetableSlot.activity,
#     SchoolConfig.activityCatalog, Class.activityPlan and Teacher.activities columns
#
#   bash scripts/releases/migrate-r3.sh                                    # local SQLite
#   bash scripts/releases/migrate-r3.sh --env .env.production --preview    # check first
#   bash scripts/releases/migrate-r3.sh --env .env.production              # apply
#
# Safe to run more than once. Only adds a table, columns, indexes and foreign keys.
RELEASE_NAME="r3 (2026-11-06)"
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
release_init "$@"

run_sql scripts/sql/2026-11-06-class-attendance-cover.sql

# Final check: anything else in the schema is added here. Fails instead of dropping data.
prisma_push

echo "==> Release r3 finished for $TARGET"
