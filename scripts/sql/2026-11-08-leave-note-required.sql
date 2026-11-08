-- Anekio: per leave type, whether applying needs a note to the approver.
-- Postgres. Safe to run more than once: only adds a column with a default (true = today's behaviour).

ALTER TABLE "LeaveType" ADD COLUMN IF NOT EXISTS "noteRequired" BOOLEAN NOT NULL DEFAULT true;
