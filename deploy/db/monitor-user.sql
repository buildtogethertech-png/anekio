-- Read-only login for Grafana's Postgres dashboard (Alloy's postgres exporter).
-- pg_monitor can read server statistics (pg_stat_*), not school data.
-- Run once on RDS from the EC2 box, with a fresh password:
--   psql "$DATABASE_URL_WITHOUT_PARAMS?sslmode=require" -v pw="'<password>'" -f deploy/db/monitor-user.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anekio_monitor') THEN
    CREATE ROLE anekio_monitor LOGIN;
  END IF;
END $$;
ALTER ROLE anekio_monitor WITH PASSWORD :pw CONNECTION LIMIT 3;
GRANT pg_monitor TO anekio_monitor;
GRANT CONNECT ON DATABASE anekio TO anekio_monitor;
