-- Anekio: how staff attendance is taken (QR or location) and in / out details for location marks.
-- Postgres. Safe to run more than once: only adds columns with defaults; nothing is dropped or rewritten.

ALTER TABLE "SchoolConfig" ADD COLUMN IF NOT EXISTS "staffAttendanceJson" TEXT NOT NULL DEFAULT '';

ALTER TABLE "StaffDay" ADD COLUMN IF NOT EXISTS "inVia"      TEXT NOT NULL DEFAULT '';
ALTER TABLE "StaffDay" ADD COLUMN IF NOT EXISTS "outVia"     TEXT NOT NULL DEFAULT '';
ALTER TABLE "StaffDay" ADD COLUMN IF NOT EXISTS "geoJson"    TEXT NOT NULL DEFAULT '';
ALTER TABLE "StaffDay" ADD COLUMN IF NOT EXISTS "outLogJson" TEXT NOT NULL DEFAULT '';
