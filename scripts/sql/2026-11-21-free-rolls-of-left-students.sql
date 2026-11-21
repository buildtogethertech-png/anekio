-- Anekio: students who already left still hold their roll number in this year's class, so the office
-- cannot give that number to anyone else (or close the gap with "Set roll numbers").
-- From this release, leaving frees the roll automatically; this frees the ones from before.
-- The enrollment row stays (history). Its roll is parked on -(10000 + roll), the same as the app does,
-- so the old number can still be read back (and is reused if the student is restored and it is free).
-- Postgres. Safe to run more than once: only touches current-year rows of left students with a real roll.

UPDATE "StudentClassEnrollment" AS e
SET "active" = false,
    "rollNumber" = -(10000 + e."rollNumber")
FROM "Student" AS s, "SchoolSession" AS ss
WHERE e."studentId" = s."id"
  AND e."sessionId" = ss."id"
  AND ss."current" = true
  AND s."leftOn" IS NOT NULL
  AND e."rollNumber" > 0;
