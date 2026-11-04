-- Anekio: daily usage per user (admin Usage page, lib/usage.ts).
-- Postgres. Safe to run more than once: only adds a table and indexes; nothing is dropped or rewritten.

CREATE TABLE IF NOT EXISTS "UsageDaily" (
  "id"          TEXT         NOT NULL,
  "day"         TEXT         NOT NULL,
  "orgId"       TEXT,
  "userId"      TEXT         NOT NULL,
  "role"        TEXT         NOT NULL DEFAULT '',
  "platform"    TEXT         NOT NULL DEFAULT 'web',
  "requests"    INTEGER      NOT NULL DEFAULT 0,
  "opsJson"     TEXT         NOT NULL DEFAULT '{}',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UsageDaily_day_userId_platform_key" ON "UsageDaily"("day", "userId", "platform");
CREATE INDEX IF NOT EXISTS "UsageDaily_orgId_day_idx" ON "UsageDaily"("orgId", "day");
CREATE INDEX IF NOT EXISTS "UsageDaily_day_idx" ON "UsageDaily"("day");
