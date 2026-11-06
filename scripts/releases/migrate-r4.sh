#!/usr/bin/env bash
# Release r4 (2026-11-07)
#   - Staff attendance by location: SchoolConfig.staffAttendanceJson (QR or location, school point, radius)
#   - StaffDay.inVia / outVia (qr, location or by hand), geoJson (where a location mark was made),
#     outLogJson (every out of the day; outAt stays the last one)
#
#   bash scripts/releases/migrate-r4.sh                                    # local SQLite
#   bash scripts/releases/migrate-r4.sh --env .env.production --preview    # check first
#   bash scripts/releases/migrate-r4.sh --env .env.production              # apply
#
# Safe to run more than once. Only adds columns with defaults.
RELEASE_NAME="r4 (2026-11-07)"
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
release_init "$@"

run_sql scripts/sql/2026-11-07-staff-attendance-location.sql

# Final check: anything else in the schema is added here. Fails instead of dropping data.
prisma_push

echo "==> Release r4 finished for $TARGET"
