#!/usr/bin/env bash
# Release r1 (2026-11-02)
#   - SaaS: per-student pricing, coupons, payment links, plans
#   - School: automatic admission numbers (format settings + correction log)
#
#   bash scripts/releases/migrate-r1.sh                                    # local SQLite
#   bash scripts/releases/migrate-r1.sh --env .env.production --preview    # check first
#   bash scripts/releases/migrate-r1.sh --env .env.production              # apply
#
# Safe to run more than once. Only adds columns, tables and indexes.
RELEASE_NAME="r1 (2026-11-02)"
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
release_init "$@"

# 1. This release's additive SQL first, so the new Prisma client matches the database for every step after.
run_sql scripts/sql/2026-11-01-payment-links-plans.sql
run_sql scripts/sql/2026-11-02-admission-numbers.sql

# 2. Subject codes must exist before db push (unique index). Idempotent; a no-op when already done.
run_tsx scripts/ensure-subject-code.ts

# 3. Final check: anything else in the schema is added here. Fails instead of dropping data.
prisma_push

# 4. Data backfills that need the full schema in place. Idempotent.
run_tsx scripts/backfill-employee-orgs.ts

echo "==> Release r1 finished for $TARGET"
