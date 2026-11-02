-- Anekio: automatic admission numbers (format settings + correction log).
-- Postgres. Safe to run more than once: only adds columns, a table and an index; nothing is dropped or rewritten.

-- 1) Admission number look for new students (counting stays automatic: highest serial + 1)
ALTER TABLE "SchoolConfig" ADD COLUMN IF NOT EXISTS "admissionNoFormat" TEXT    NOT NULL DEFAULT '';
ALTER TABLE "SchoolConfig" ADD COLUMN IF NOT EXISTS "admissionNoDigits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SchoolConfig" ADD COLUMN IF NOT EXISTS "admissionNoFloor"  INTEGER NOT NULL DEFAULT 0;

-- 2) Log of admin corrections to a student's admission number
CREATE TABLE IF NOT EXISTS "AdmissionNumberChange" (
  "id"            TEXT         NOT NULL,
  "orgId"         TEXT,
  "studentId"     TEXT         NOT NULL,
  "fromNo"        TEXT         NOT NULL,
  "toNo"          TEXT         NOT NULL,
  "reason"        TEXT         NOT NULL DEFAULT '',
  "changedById"   TEXT         NOT NULL,
  "changedByName" TEXT         NOT NULL DEFAULT '',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdmissionNumberChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AdmissionNumberChange_orgId_studentId_idx" ON "AdmissionNumberChange"("orgId", "studentId");
