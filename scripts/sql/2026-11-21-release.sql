-- Anekio release 2026-11-21: every schema change not yet on prod (committed HEAD ed0a6b914 → this release).
-- Postgres. Safe to run more than once: only adds nullable columns, a new table and indexes; nothing is dropped.
--   Teacher.archivedAt         staff removed from the school (kept for history)
--   TimetableSlot.combinedId   combined class periods
--   DeviceReport               one-time staff phone report (brand, model, NFC, IP) — see 2026-11-21-device-reports.sql

ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

ALTER TABLE "TimetableSlot" ADD COLUMN IF NOT EXISTS "combinedId" TEXT;
CREATE INDEX IF NOT EXISTS "TimetableSlot_combinedId_idx" ON "TimetableSlot"("combinedId");

CREATE TABLE IF NOT EXISTS "DeviceReport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT '',
    "brand" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "modelId" TEXT NOT NULL DEFAULT '',
    "os" TEXT NOT NULL DEFAULT '',
    "appBuild" TEXT NOT NULL DEFAULT '',
    "nfc" TEXT NOT NULL DEFAULT 'unknown',
    "ip" TEXT NOT NULL DEFAULT '',
    "extraJson" TEXT NOT NULL DEFAULT '{}',
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceReport_userId_key" ON "DeviceReport"("userId");
CREATE INDEX IF NOT EXISTS "DeviceReport_orgId_idx" ON "DeviceReport"("orgId");
