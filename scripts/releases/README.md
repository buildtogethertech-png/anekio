# Release migrations

One script per release: `migrate-r1.sh`, `migrate-r2.sh`, …

Each release script:
1. runs that release's additive SQL from `scripts/sql/` (Postgres; SQLite gets it from `db push`),
2. runs any data fixes the release needs (`run_tsx`),
3. finishes with `prisma db push` as a safety check (refuses to drop data unless `--accept-data-loss`).

Always preview production first:

    bash scripts/releases/migrate-rN.sh --env .env.production --preview
    bash scripts/releases/migrate-rN.sh --env .env.production

New release: copy the last script to `migrate-r<N+1>.sh`, change `RELEASE_NAME` and the steps,
and put new SQL in `scripts/sql/<date>-<topic>.sql` written with `IF NOT EXISTS` so it can re-run.

| Release | Date | What |
|---|---|---|
| r1 | 2026-11-02 | Per-student pricing, coupons, payment links, plans; automatic admission numbers |
| r2 | 2026-11-05 | Usage tracking (`UsageDaily`) for the admin Usage page |
| r3 | 2026-11-06 | Class attendance cover (`ClassAttendanceCover`), timetable activities |
| r4 | 2026-11-07 | Staff attendance by location (QR or location in Settings), in / out via, every out kept |
| r5 | 2026-11-08 | Teacher phones during the school day (`SchoolConfig.schoolDayJson`, `StaffPhoneEvent`) |
