-- Anekio: school setting for teachers' phones during the school day (Settings → HR & Payroll → Teacher phones).
-- Postgres. Safe to run more than once: only adds a column; nothing is dropped or rewritten.

ALTER TABLE "SchoolConfig" ADD COLUMN IF NOT EXISTS "schoolDayJson" TEXT NOT NULL DEFAULT '';

-- Teachers' school-day phone log (day start, breaks with reason, back to focus, guard off, day end).
CREATE TABLE IF NOT EXISTS "StaffPhoneEvent" (
  "id"        TEXT         NOT NULL,
  "orgId"     TEXT,
  "userId"    TEXT         NOT NULL,
  "date"      TEXT         NOT NULL,
  "type"      TEXT         NOT NULL,
  "at"        TIMESTAMP(3) NOT NULL,
  "reason"    TEXT         NOT NULL DEFAULT '',
  "clientId"  TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffPhoneEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StaffPhoneEvent_userId_clientId_key" ON "StaffPhoneEvent"("userId", "clientId");
CREATE INDEX IF NOT EXISTS "StaffPhoneEvent_date_idx" ON "StaffPhoneEvent"("date");
