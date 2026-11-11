-- Anekio: fee receipts. One FeeReceipt per amount received; its Payment rows say which invoices it paid.
-- Postgres. Safe to run more than once: only adds a column, two tables, indexes and foreign keys.
-- Old payments keep receiptId empty until scripts/backfill-fee-receipts.ts is run.

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "receiptId" TEXT;

CREATE TABLE IF NOT EXISTS "FeeReceipt" (
  "id"           TEXT            NOT NULL,
  "orgId"        TEXT,
  "studentId"    TEXT            NOT NULL,
  "receiptNo"    TEXT            NOT NULL,
  "amount"       INTEGER         NOT NULL,
  "method"       "PaymentMethod" NOT NULL DEFAULT 'CASH',
  "reference"    TEXT,
  "proofPath"    TEXT,
  "notes"        TEXT,
  "paidAt"       TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "shareToken"   TEXT            NOT NULL,
  "status"       TEXT            NOT NULL DEFAULT 'ACTIVE',
  "cancelReason" TEXT,
  "cancelledAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeeReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FeeReceiptCounter" (
  "scope" TEXT    NOT NULL,
  "year"  TEXT    NOT NULL,
  "next"  INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "FeeReceiptCounter_pkey" PRIMARY KEY ("scope", "year")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FeeReceipt_shareToken_key" ON "FeeReceipt"("shareToken");
CREATE INDEX IF NOT EXISTS "FeeReceipt_studentId_idx" ON "FeeReceipt"("studentId");
CREATE INDEX IF NOT EXISTS "FeeReceipt_reference_idx" ON "FeeReceipt"("reference");
CREATE UNIQUE INDEX IF NOT EXISTS "FeeReceipt_orgId_receiptNo_key" ON "FeeReceipt"("orgId", "receiptNo");
CREATE INDEX IF NOT EXISTS "Payment_receiptId_idx" ON "Payment"("receiptId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payment_receiptId_fkey') THEN
    ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receiptId_fkey"
      FOREIGN KEY ("receiptId") REFERENCES "FeeReceipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FeeReceipt_studentId_fkey') THEN
    ALTER TABLE "FeeReceipt" ADD CONSTRAINT "FeeReceipt_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
