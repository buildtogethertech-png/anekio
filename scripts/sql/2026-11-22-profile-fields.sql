-- Anekio 2026-11-22: student & staff profile answers in columns and tables, not JSON.
-- From this release the app saves a form answer straight to where it belongs:
--   core fields (gender, blood group, category, …) → a column on Student / Teacher / StaffMember;
--   the school's own fields → StudentFieldValue / StaffFieldValue (one row per person per field id).
-- Also: salary history (SalaryRevision) — a salary is never overwritten; each change is a new row.
-- This script: 1) adds the columns and tables; 2) copies every existing answer out of admissionDataJson /
-- onboardingDataJson into them; 3) switches saved forms to the core field ids. The JSON columns are left as they
-- were (no longer read), as a backup.
-- Postgres. Run on the server BEFORE deploying this release. Safe to run more than once.

BEGIN;

-- AlterTable
ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS "bloodGroup" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "dateOfBirth" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "emergencyPhone" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "esic" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "experienceYears" INTEGER,
ADD COLUMN IF NOT EXISTS "gender" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "maritalStatus" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "panNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "uan" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "apaarId" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "bloodGroup" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "gender" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "homeAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "motherTongue" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "photoPath" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN IF NOT EXISTS "bloodGroup" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "dateOfBirth" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "emergencyPhone" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "esic" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "experienceYears" INTEGER,
ADD COLUMN IF NOT EXISTS "gender" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "maritalStatus" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "panNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "qualification" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "uan" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE IF NOT EXISTS "StudentFieldValue" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "studentId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "valueText" TEXT NOT NULL DEFAULT '',
    "valueNumber" DOUBLE PRECISION,
    "valueDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "StudentFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StaffFieldValue" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "teacherId" TEXT,
    "staffMemberId" TEXT,
    "fieldId" TEXT NOT NULL,
    "valueText" TEXT NOT NULL DEFAULT '',
    "valueNumber" DOUBLE PRECISION,
    "valueDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "StaffFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SalaryRevision" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "teacherId" TEXT,
    "staffMemberId" TEXT,
    "amount" INTEGER NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "SalaryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StudentFieldValue_orgId_fieldId_valueText_idx" ON "StudentFieldValue"("orgId", "fieldId", "valueText");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StudentFieldValue_orgId_fieldId_valueDate_idx" ON "StudentFieldValue"("orgId", "fieldId", "valueDate");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StudentFieldValue_studentId_fieldId_key" ON "StudentFieldValue"("studentId", "fieldId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StaffFieldValue_orgId_fieldId_valueText_idx" ON "StaffFieldValue"("orgId", "fieldId", "valueText");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StaffFieldValue_orgId_fieldId_valueDate_idx" ON "StaffFieldValue"("orgId", "fieldId", "valueDate");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StaffFieldValue_teacherId_fieldId_key" ON "StaffFieldValue"("teacherId", "fieldId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StaffFieldValue_staffMemberId_fieldId_key" ON "StaffFieldValue"("staffMemberId", "fieldId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SalaryRevision_teacherId_effectiveFrom_idx" ON "SalaryRevision"("teacherId", "effectiveFrom");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SalaryRevision_staffMemberId_effectiveFrom_idx" ON "SalaryRevision"("staffMemberId", "effectiveFrom");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SalaryRevision_orgId_idx" ON "SalaryRevision"("orgId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentFieldValue_studentId_fkey') THEN
    ALTER TABLE "StudentFieldValue" ADD CONSTRAINT "StudentFieldValue_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentFieldValue_createdById_fkey') THEN
    ALTER TABLE "StudentFieldValue" ADD CONSTRAINT "StudentFieldValue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StudentFieldValue_updatedById_fkey') THEN
    ALTER TABLE "StudentFieldValue" ADD CONSTRAINT "StudentFieldValue_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffFieldValue_teacherId_fkey') THEN
    ALTER TABLE "StaffFieldValue" ADD CONSTRAINT "StaffFieldValue_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffFieldValue_staffMemberId_fkey') THEN
    ALTER TABLE "StaffFieldValue" ADD CONSTRAINT "StaffFieldValue_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffFieldValue_createdById_fkey') THEN
    ALTER TABLE "StaffFieldValue" ADD CONSTRAINT "StaffFieldValue_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StaffFieldValue_updatedById_fkey') THEN
    ALTER TABLE "StaffFieldValue" ADD CONSTRAINT "StaffFieldValue_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalaryRevision_teacherId_fkey') THEN
    ALTER TABLE "SalaryRevision" ADD CONSTRAINT "SalaryRevision_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalaryRevision_staffMemberId_fkey') THEN
    ALTER TABLE "SalaryRevision" ADD CONSTRAINT "SalaryRevision_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalaryRevision_createdById_fkey') THEN
    ALTER TABLE "SalaryRevision" ADD CONSTRAINT "SalaryRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SalaryRevision_updatedById_fkey') THEN
    ALTER TABLE "SalaryRevision" ADD CONSTRAINT "SalaryRevision_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Reads a JSON text column without failing on a bad row.
CREATE OR REPLACE FUNCTION pg_temp.anekio_json(t text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN CASE WHEN t IS NULL OR btrim(t) = '' THEN '{}'::jsonb ELSE t::jsonb END;
EXCEPTION WHEN others THEN
  RETURN '{}'::jsonb;
END $$;


-- 1. Student core answers → columns (only fills; a value already in the column wins).
UPDATE "Student" s SET
  "gender" = coalesce(nullif(left(btrim(coalesce(j->>'custom_gender', '')), 200), ''), s."gender"),
  "bloodGroup" = coalesce(nullif(left(btrim(coalesce(j->>'custom_blood_group', '')), 200), ''), s."bloodGroup"),
  "category" = coalesce(nullif(left(btrim(coalesce(j->>'custom_category', '')), 200), ''), s."category"),
  "motherTongue" = coalesce(nullif(left(btrim(coalesce(j->>'custom_mother_tongue', '')), 200), ''), s."motherTongue"),
  "apaarId" = coalesce(nullif(left(btrim(coalesce(j->>'custom_apaar_id', '')), 200), ''), s."apaarId"),
  "homeAddress" = coalesce(nullif(left(btrim(coalesce(nullif(btrim(j->>'custom_address'), ''), j->>'custom_home_address', '')), 1000), ''), s."homeAddress"),
  "photoPath" = coalesce(nullif(btrim(j->>'custom_student_photo'), ''), nullif(s."photoPath", ''),
    (SELECT btrim(kv.value) FROM jsonb_each_text(j) kv WHERE kv.key LIKE 'custom\_student\_photo%' AND btrim(kv.value) <> '' ORDER BY kv.key LIMIT 1), '')
FROM (SELECT "id", pg_temp.anekio_json("admissionDataJson") AS j FROM "Student") x
WHERE x."id" = s."id";

-- 2. Every other student answer → StudentFieldValue.
INSERT INTO "StudentFieldValue" ("id", "orgId", "studentId", "fieldId", "valueText", "valueDate", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."orgId", s."id", kv.key, left(btrim(kv.value), 2000),
       CASE WHEN btrim(kv.value) ~ '^\d{4}-\d{2}-\d{2}$' THEN btrim(kv.value) END,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Student" s, jsonb_each_text(pg_temp.anekio_json(s."admissionDataJson")) kv
WHERE btrim(coalesce(kv.value, '')) <> ''
  AND kv.key LIKE 'custom\_%'
  AND kv.key NOT IN ('custom_gender', 'custom_blood_group', 'custom_category', 'custom_mother_tongue', 'custom_apaar_id', 'custom_address', 'custom_home_address', 'custom_student_photo')
ON CONFLICT ("studentId", "fieldId") DO NOTHING;

-- 3. Teacher / StaffMember core answers → columns (only fills).
UPDATE "Teacher" t SET
  "gender" = coalesce(nullif(left(btrim(coalesce(j->>'custom_gender', '')), 200), ''), t."gender"),
  "dateOfBirth" = coalesce(nullif(left(btrim(coalesce(nullif(btrim(j->>'custom_dob'), ''), j->>'custom_date_of_birth', '')), 200), ''), t."dateOfBirth"),
  "bloodGroup" = coalesce(nullif(left(btrim(coalesce(j->>'custom_blood_group', '')), 200), ''), t."bloodGroup"),
  "maritalStatus" = coalesce(nullif(left(btrim(coalesce(j->>'custom_marital_status', '')), 200), ''), t."maritalStatus"),
  "experienceYears" = coalesce(CASE WHEN btrim(coalesce(j->>'custom_experience_years', '')) ~ '^\d{1,2}$' THEN btrim(j->>'custom_experience_years')::int END, t."experienceYears"),
  "emergencyPhone" = coalesce(nullif(left(btrim(coalesce(j->>'custom_emergency_contact', '')), 200), ''), t."emergencyPhone"),
  "panNumber" = coalesce(nullif(left(btrim(coalesce(j->>'custom_pan_number', '')), 200), ''), t."panNumber"),
  "uan" = coalesce(nullif(left(btrim(coalesce(j->>'custom_uan', '')), 200), ''), t."uan"),
  "esic" = coalesce(nullif(left(btrim(coalesce(j->>'custom_esic', '')), 200), ''), t."esic"),
  "qualification" = coalesce(nullif(t."qualification", ''), nullif(left(btrim(coalesce(j->>'qualification', '')), 200), ''))
FROM (SELECT "id", pg_temp.anekio_json("onboardingDataJson") AS j FROM "Teacher") x
WHERE x."id" = t."id";

UPDATE "StaffMember" m SET
  "gender" = coalesce(nullif(left(btrim(coalesce(j->>'custom_gender', '')), 200), ''), m."gender"),
  "dateOfBirth" = coalesce(nullif(left(btrim(coalesce(nullif(btrim(j->>'custom_dob'), ''), j->>'custom_date_of_birth', '')), 200), ''), m."dateOfBirth"),
  "bloodGroup" = coalesce(nullif(left(btrim(coalesce(j->>'custom_blood_group', '')), 200), ''), m."bloodGroup"),
  "maritalStatus" = coalesce(nullif(left(btrim(coalesce(j->>'custom_marital_status', '')), 200), ''), m."maritalStatus"),
  "experienceYears" = coalesce(CASE WHEN btrim(coalesce(j->>'custom_experience_years', '')) ~ '^\d{1,2}$' THEN btrim(j->>'custom_experience_years')::int END, m."experienceYears"),
  "emergencyPhone" = coalesce(nullif(left(btrim(coalesce(j->>'custom_emergency_contact', '')), 200), ''), m."emergencyPhone"),
  "panNumber" = coalesce(nullif(left(btrim(coalesce(j->>'custom_pan_number', '')), 200), ''), m."panNumber"),
  "uan" = coalesce(nullif(left(btrim(coalesce(j->>'custom_uan', '')), 200), ''), m."uan"),
  "esic" = coalesce(nullif(left(btrim(coalesce(j->>'custom_esic', '')), 200), ''), m."esic"),
  "qualification" = coalesce(nullif(left(btrim(coalesce(j->>'qualification', '')), 200), ''), m."qualification")
FROM (SELECT "id", pg_temp.anekio_json("onboardingDataJson") AS j FROM "StaffMember") x
WHERE x."id" = m."id";

-- 4. Every other staff answer (incl. Department) → StaffFieldValue.
INSERT INTO "StaffFieldValue" ("id", "orgId", "teacherId", "fieldId", "valueText", "valueDate", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."orgId", t."id", kv.key, left(btrim(kv.value), 2000),
       CASE WHEN btrim(kv.value) ~ '^\d{4}-\d{2}-\d{2}$' THEN btrim(kv.value) END,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Teacher" t, jsonb_each_text(pg_temp.anekio_json(t."onboardingDataJson")) kv
WHERE btrim(coalesce(kv.value, '')) <> '' AND kv.key NOT IN ('qualification', 'custom_gender', 'custom_dob', 'custom_date_of_birth', 'custom_blood_group', 'custom_marital_status', 'custom_experience_years', 'custom_emergency_contact', 'custom_pan_number', 'custom_uan', 'custom_esic')
ON CONFLICT ("teacherId", "fieldId") DO NOTHING;

INSERT INTO "StaffFieldValue" ("id", "orgId", "staffMemberId", "fieldId", "valueText", "valueDate", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, m."orgId", m."id", kv.key, left(btrim(kv.value), 2000),
       CASE WHEN btrim(kv.value) ~ '^\d{4}-\d{2}-\d{2}$' THEN btrim(kv.value) END,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "StaffMember" m, jsonb_each_text(pg_temp.anekio_json(m."onboardingDataJson")) kv
WHERE btrim(coalesce(kv.value, '')) <> '' AND kv.key NOT IN ('qualification', 'custom_gender', 'custom_dob', 'custom_date_of_birth', 'custom_blood_group', 'custom_marital_status', 'custom_experience_years', 'custom_emergency_contact', 'custom_pan_number', 'custom_uan', 'custom_esic')
ON CONFLICT ("staffMemberId", "fieldId") DO NOTHING;

-- 5. Saved forms: old custom ids of core fields → the core id (label, options, visibility kept).
CREATE OR REPLACE FUNCTION pg_temp.anekio_student_form(t text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE arr jsonb;
BEGIN
  BEGIN arr := CASE WHEN t IS NULL OR btrim(t) = '' THEN '[]'::jsonb ELSE t::jsonb END;
  EXCEPTION WHEN others THEN RETURN t; END;
  IF jsonb_typeof(arr) <> 'array' THEN RETURN t; END IF;
  RETURN coalesce((SELECT jsonb_agg(CASE e->>'id'
        WHEN 'custom_gender' THEN e || '{"id": "gender", "builtin": false, "type": "select"}'
        WHEN 'custom_blood_group' THEN e || '{"id": "bloodGroup", "builtin": false, "type": "select"}'
        WHEN 'custom_category' THEN e || '{"id": "category", "builtin": false, "type": "select"}'
        WHEN 'custom_mother_tongue' THEN e || '{"id": "motherTongue", "builtin": false, "type": "text"}'
        WHEN 'custom_apaar_id' THEN e || '{"id": "apaarId", "builtin": false, "type": "text"}'
        WHEN 'custom_address' THEN e || '{"id": "homeAddress", "builtin": false, "type": "textarea"}'
        WHEN 'custom_home_address' THEN e || '{"id": "homeAddress", "builtin": false, "type": "textarea"}'
        WHEN 'custom_student_photo' THEN e || '{"id": "studentPhoto", "builtin": false, "type": "file", "fileType": "image"}'
        ELSE e END ORDER BY o) FROM jsonb_array_elements(arr) WITH ORDINALITY x(e, o)), '[]'::jsonb)::text;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.anekio_staff_form(t text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE arr jsonb;
BEGIN
  BEGIN arr := CASE WHEN t IS NULL OR btrim(t) = '' THEN '[]'::jsonb ELSE t::jsonb END;
  EXCEPTION WHEN others THEN RETURN t; END;
  IF jsonb_typeof(arr) <> 'array' THEN RETURN t; END IF;
  RETURN coalesce((SELECT jsonb_agg(CASE e->>'id'
        WHEN 'custom_gender' THEN e || '{"id": "gender", "builtin": false, "type": "select"}'
        WHEN 'custom_dob' THEN e || '{"id": "dateOfBirth", "builtin": false, "type": "date"}'
        WHEN 'custom_date_of_birth' THEN e || '{"id": "dateOfBirth", "builtin": false, "type": "date"}'
        WHEN 'custom_blood_group' THEN e || '{"id": "bloodGroup", "builtin": false, "type": "select"}'
        WHEN 'custom_marital_status' THEN e || '{"id": "maritalStatus", "builtin": false, "type": "select"}'
        WHEN 'custom_experience_years' THEN e || '{"id": "experienceYears", "builtin": false, "type": "number"}'
        WHEN 'custom_emergency_contact' THEN e || '{"id": "emergencyPhone", "builtin": false, "type": "phone"}'
        WHEN 'custom_pan_number' THEN e || '{"id": "panNumber", "builtin": false, "type": "text"}'
        WHEN 'custom_uan' THEN e || '{"id": "uan", "builtin": false, "type": "text"}'
        WHEN 'custom_esic' THEN e || '{"id": "esic", "builtin": false, "type": "text"}'
        ELSE e END ORDER BY o) FROM jsonb_array_elements(arr) WITH ORDINALITY x(e, o)), '[]'::jsonb)::text;
END $$;

UPDATE "SchoolConfig" SET "admissionFormJson" = pg_temp.anekio_student_form("admissionFormJson"), "staffOnboardingFormJson" = pg_temp.anekio_staff_form("staffOnboardingFormJson");
UPDATE "PlatformConfig" SET "admissionFormJson" = pg_temp.anekio_student_form("admissionFormJson"), "staffOnboardingFormJson" = pg_temp.anekio_staff_form("staffOnboardingFormJson");

-- 6. Salary history: everyone starts with one row, today's salary from their joining month (only if they have none).
INSERT INTO "SalaryRevision" ("id", "orgId", "teacherId", "amount", "effectiveFrom", "reason", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."orgId", t."id", t."monthlySalary",
       CASE WHEN t."joinedOn" ~ '^\d{4}-\d{2}' THEN left(t."joinedOn", 7) ELSE to_char(CURRENT_DATE, 'YYYY-MM') END,
       'Joining salary', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Teacher" t
WHERE NOT EXISTS (SELECT 1 FROM "SalaryRevision" r WHERE r."teacherId" = t."id");

INSERT INTO "SalaryRevision" ("id", "orgId", "staffMemberId", "amount", "effectiveFrom", "reason", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, m."orgId", m."id", m."monthlySalary",
       CASE WHEN m."joinedOn" ~ '^\d{4}-\d{2}' THEN left(m."joinedOn", 7) ELSE to_char(CURRENT_DATE, 'YYYY-MM') END,
       'Joining salary', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "StaffMember" m
WHERE NOT EXISTS (SELECT 1 FROM "SalaryRevision" r WHERE r."staffMemberId" = m."id");

COMMIT;

-- Check (read-only): JSON answers that should now be rows. *_json = *_rows (rows can be higher: new answers saved since).
SELECT
  (SELECT count(*) FROM "Student" s, jsonb_each_text(pg_temp.anekio_json(s."admissionDataJson")) kv
     WHERE btrim(coalesce(kv.value, '')) <> '' AND kv.key LIKE 'custom\_%' AND kv.key NOT IN ('custom_gender', 'custom_blood_group', 'custom_category', 'custom_mother_tongue', 'custom_apaar_id', 'custom_address', 'custom_home_address', 'custom_student_photo')) AS student_json,
  (SELECT count(*) FROM "StudentFieldValue") AS student_rows,
  (SELECT count(*) FROM (
     SELECT 1 FROM "Teacher" t, jsonb_each_text(pg_temp.anekio_json(t."onboardingDataJson")) kv
       WHERE btrim(coalesce(kv.value, '')) <> '' AND kv.key NOT IN ('qualification', 'custom_gender', 'custom_dob', 'custom_date_of_birth', 'custom_blood_group', 'custom_marital_status', 'custom_experience_years', 'custom_emergency_contact', 'custom_pan_number', 'custom_uan', 'custom_esic')
     UNION ALL
     SELECT 1 FROM "StaffMember" m, jsonb_each_text(pg_temp.anekio_json(m."onboardingDataJson")) kv
       WHERE btrim(coalesce(kv.value, '')) <> '' AND kv.key NOT IN ('qualification', 'custom_gender', 'custom_dob', 'custom_date_of_birth', 'custom_blood_group', 'custom_marital_status', 'custom_experience_years', 'custom_emergency_contact', 'custom_pan_number', 'custom_uan', 'custom_esic')) z) AS staff_json,
  (SELECT count(*) FROM "StaffFieldValue") AS staff_rows,
  (SELECT count(*) FROM "Student" WHERE "gender" <> '') AS students_gender,
  (SELECT count(*) FROM "Student" WHERE "category" <> '') AS students_category,
  (SELECT count(*) FROM "Student" WHERE "homeAddress" <> '') AS students_home_address,
  (SELECT count(*) FROM "Student" WHERE "photoPath" <> '') AS students_photo;
