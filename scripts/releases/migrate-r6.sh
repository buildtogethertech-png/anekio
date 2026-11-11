#!/usr/bin/env bash
# Release r6 (2026-11-11)
#   - Fee receipts: FeeReceipt (money received once, numbered RCPT/26-27/00042),
#     FeeReceiptCounter (next number per school and financial year) and Payment.receiptId
#     (which receipt each invoice payment came in on). Part payments and one receipt over many invoices.
#
#   bash scripts/releases/migrate-r6.sh                                    # local SQLite
#   bash scripts/releases/migrate-r6.sh --env .env.production --preview    # check first
#   bash scripts/releases/migrate-r6.sh --env .env.production              # apply
#
# Safe to run more than once. Only adds a column, tables, indexes and foreign keys.
# Old payments are not changed; giving them receipts is a separate step (scripts/backfill-fee-receipts.ts).
RELEASE_NAME="r6 (2026-11-11)"
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
release_init "$@"

run_sql scripts/sql/2026-11-11-fee-receipts.sql

# Final check: anything else in the schema is added here. Fails instead of dropping data.
prisma_push

echo "==> Release r6 finished for $TARGET"
