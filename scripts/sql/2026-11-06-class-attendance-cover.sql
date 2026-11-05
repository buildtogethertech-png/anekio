-- Anekio: one-day class attendance cover (who marks a class's attendance while its class teacher is out).
-- Postgres. Safe to run more than once: only adds a table, indexes and foreign keys; nothing is dropped or rewritten.

CREATE TABLE IF NOT EXISTS "ClassAttendanceCover" (
  "id"              TEXT         NOT NULL,
  "orgId"           TEXT,
  "date"            TEXT         NOT NULL,
  "classId"         TEXT         NOT NULL,
  "teacherId"       TEXT         NOT NULL,
  "absentTeacherId" TEXT,
  "leaveRequestId"  TEXT,
  "assignedById"    TEXT         NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClassAttendanceCover_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClassAttendanceCover_date_classId_key" ON "ClassAttendanceCover"("date", "classId");
CREATE INDEX IF NOT EXISTS "ClassAttendanceCover_teacherId_date_idx" ON "ClassAttendanceCover"("teacherId", "date");

DO $$ BEGIN
  ALTER TABLE "ClassAttendanceCover" ADD CONSTRAINT "ClassAttendanceCover_classId_fkey"
    FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClassAttendanceCover" ADD CONSTRAINT "ClassAttendanceCover_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClassAttendanceCover" ADD CONSTRAINT "ClassAttendanceCover_leaveRequestId_fkey"
    FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Timetable activities (Games, Library, Assembly…): a period with an activity instead of a subject. Not used by exams.
ALTER TABLE "TimetableSlot" ADD COLUMN IF NOT EXISTS "activity" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SchoolConfig" ADD COLUMN IF NOT EXISTS "activityCatalog" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "activityPlan" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "activities" TEXT NOT NULL DEFAULT '[]';
