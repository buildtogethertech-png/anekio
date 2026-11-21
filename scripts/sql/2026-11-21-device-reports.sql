-- Anekio: staff phone report (brand, model, NFC support, IP), one row per staff login, sent once.
-- Postgres. Safe to run more than once: only creates a new table and index; nothing else is touched.
-- To ask one person's phone again: DELETE FROM "DeviceReport" WHERE "userId" = '<user id>';

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

-- Per school: how many staff have reported, how many are still pending (removed staff left out).
-- SELECT o."schoolName", u."orgId",
--        COUNT(*) AS staff,
--        COUNT(d.id) AS reported,
--        COUNT(*) - COUNT(d.id) AS pending,
--        SUM(CASE WHEN d.nfc = 'yes' THEN 1 ELSE 0 END) AS nfc_yes,
--        SUM(CASE WHEN d.nfc = 'no' THEN 1 ELSE 0 END) AS nfc_no
-- FROM "User" u
-- JOIN "Role" r ON r.id = u."roleId" AND r.portal IN ('TEACHER', 'OFFICE')
-- LEFT JOIN "SaasOrg" o ON o.id = u."orgId"
-- LEFT JOIN "DeviceReport" d ON d."userId" = u.id
-- WHERE NOT EXISTS (SELECT 1 FROM "Teacher" t WHERE t."userId" = u.id AND t."archivedAt" IS NOT NULL)
--   AND NOT EXISTS (SELECT 1 FROM "StaffMember" s WHERE s."userId" = u.id AND s."archivedAt" IS NOT NULL)
-- GROUP BY o."schoolName", u."orgId"
-- ORDER BY pending DESC;
--
-- Who is still pending in one school:
-- SELECT u.id, u.name, u.phone FROM "User" u JOIN "Role" r ON r.id = u."roleId" AND r.portal IN ('TEACHER', 'OFFICE')
--   LEFT JOIN "DeviceReport" d ON d."userId" = u.id WHERE u."orgId" = '<org id>' AND d.id IS NULL ORDER BY u.name;
