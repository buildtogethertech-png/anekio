#!/usr/bin/env bash
# Installs the server crontab (run by deploy/push.sh). Reads CRON_SECRET, DATABASE_URL, AWS_S3_PRIVATE_BUCKET from .env.
set -euo pipefail
ENV=/srv/anekio/shared/.env
cat > /srv/anekio/shared/backup-db.sh <<'SH'
#!/usr/bin/env bash
# Nightly Postgres dump → S3 (private bucket, backups/). Keeps 30 days via S3 lifecycle (set once in the console).
set -euo pipefail
set -a; source /srv/anekio/shared/.env; set +a
URL="${DATABASE_URL%%\?*}"
STAMP=$(date +%F)
pg_dump --no-owner --no-acl -Fc "$URL" | aws s3 cp - "s3://$AWS_S3_PRIVATE_BUCKET/backups/db/anekio-$STAMP.dump" --only-show-errors
echo "$(date) backup ok $STAMP"
SH
chmod 700 /srv/anekio/shared/backup-db.sh
( crontab -l 2>/dev/null | grep -v '# anekio' || true
  # Vercel ran the leave job at 19:30 UTC = 01:00 IST; the server clock is IST.
  echo '0 1 * * * set -a; . '"$ENV"'; set +a; curl -fsS -m 120 -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:4000/api/cron/leave >> /var/log/anekio/cron.log 2>&1 # anekio'
  echo '30 2 * * * /srv/anekio/shared/backup-db.sh >> /var/log/anekio/backup.log 2>&1 # anekio'
  # Monthly fee invoices, 06:00 IST daily (only missing months are created). One school for now: Tagore Public School.
  echo '0 6 * * * set -a; . '"$ENV"'; set +a; curl -fsS -m 300 -H "Authorization: Bearer $CRON_SECRET" "http://127.0.0.1:4000/api/cron/fees?orgId=cmv7op9js0007le06e9oxcmks" >> /var/log/anekio/cron.log 2>&1 # anekio'
) | crontab -
echo "crontab installed"
