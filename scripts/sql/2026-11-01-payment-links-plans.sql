-- Anekio: per-student pricing, payment links (new / renewal / free trial) and plans.
-- Postgres. Safe to run more than once: only adds tables, columns and indexes; nothing is dropped or rewritten.
-- Run with:  bash scripts/migrate-payment-links.sh --env .env.production

-- 1) Checkout audit on payments
ALTER TABLE "SaasPayment" ADD COLUMN IF NOT EXISTS "couponCode"   TEXT NOT NULL DEFAULT '';
ALTER TABLE "SaasPayment" ADD COLUMN IF NOT EXISTS "studentCount" INTEGER;

-- 2) Per-student website pricing
ALTER TABLE "SaasSitePricing" ADD COLUMN IF NOT EXISTS "perStudentMonthly" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "SaasSitePricing" ADD COLUMN IF NOT EXISTS "minimumYearly"     INTEGER NOT NULL DEFAULT 12000;

-- 3) Plans (price + validity; trialDays > 0 = free-trial plan)
CREATE TABLE IF NOT EXISTS "SaasPlan" (
  "id"                TEXT         NOT NULL,
  "name"              TEXT         NOT NULL,
  "perStudentMonthly" INTEGER      NOT NULL DEFAULT 5,
  "minimumYearly"     INTEGER      NOT NULL DEFAULT 12000,
  "validityMonths"    INTEGER      NOT NULL DEFAULT 12,
  "trialDays"         INTEGER      NOT NULL DEFAULT 0,
  "active"            BOOLEAN      NOT NULL DEFAULT true,
  "createdBy"         TEXT         NOT NULL DEFAULT '',
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SaasPlan_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "SaasPlan" ADD COLUMN IF NOT EXISTS "trialDays" INTEGER NOT NULL DEFAULT 0;

-- 4) Payment links (table name kept as SaasCoupon)
CREATE TABLE IF NOT EXISTS "SaasCoupon" (
  "id"            TEXT         NOT NULL,
  "code"          TEXT         NOT NULL,
  "kind"          TEXT         NOT NULL DEFAULT 'PERCENT',
  "value"         INTEGER      NOT NULL,
  "minimumYearly" INTEGER,
  "maxUses"       INTEGER      NOT NULL DEFAULT 0,
  "usedCount"     INTEGER      NOT NULL DEFAULT 0,
  "validUntil"    TIMESTAMP(3),
  "active"        BOOLEAN      NOT NULL DEFAULT true,
  "note"          TEXT         NOT NULL DEFAULT '',
  "createdBy"     TEXT         NOT NULL DEFAULT '',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SaasCoupon_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SaasCoupon_code_key" ON "SaasCoupon"("code");
ALTER TABLE "SaasCoupon" ADD COLUMN IF NOT EXISTS "schoolName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SaasCoupon" ADD COLUMN IF NOT EXISTS "students"   INTEGER;
ALTER TABLE "SaasCoupon" ADD COLUMN IF NOT EXISTS "purpose"    TEXT NOT NULL DEFAULT 'NEW';
ALTER TABLE "SaasCoupon" ADD COLUMN IF NOT EXISTS "orgId"      TEXT;
ALTER TABLE "SaasCoupon" ADD COLUMN IF NOT EXISTS "planId"     TEXT;
