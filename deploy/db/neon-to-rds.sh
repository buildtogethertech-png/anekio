#!/usr/bin/env bash
# Copies the Neon database into RDS. Runs pg_dump/pg_restore ON the EC2 server (RDS is private to it).
#   NEON_URL='postgresql://…neon.tech/…?sslmode=require' bash deploy/db/neon-to-rds.sh
# Stop writes first (school closed / maintenance) so nothing is lost between dump and switch.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
source deploy/aws/config.sh
EIP=$(state_get EIP); RDS_URL=$(state_get DATABASE_URL)
[[ -n "${NEON_URL:-}" ]] || { echo "Set NEON_URL to the Neon connection string."; exit 1; }
[[ -n "$RDS_URL" ]] || { echo "Run deploy/aws/2-rds.sh first."; exit 1; }
ssh -i "$KEY_FILE" "ubuntu@$EIP" bash -s -- "${NEON_URL%%\?*}?sslmode=require" "${RDS_URL%%\?*}?sslmode=require" <<'REMOTE'
set -euo pipefail
SRC=$1; DST=$2
VER=$(psql "$SRC" -tAc "show server_version_num" | cut -c1-2)
if [[ "$VER" -gt 16 ]] && ! command -v /usr/lib/postgresql/$VER/bin/pg_dump >/dev/null; then
  sudo apt-get install -y postgresql-common >/dev/null
  sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
  sudo apt-get install -y "postgresql-client-$VER" >/dev/null
fi
BIN=/usr/lib/postgresql/$( [[ "$VER" -gt 16 ]] && echo "$VER" || echo 16 )/bin
echo "Neon is Postgres $VER. Dumping…"
"$BIN/pg_dump" --no-owner --no-acl -Fc "$SRC" -f /tmp/neon.dump
echo "Restoring into RDS…"
"$BIN/pg_restore" --no-owner --no-acl --clean --if-exists -d "$DST" /tmp/neon.dump || echo "(pg_restore reported warnings — check counts below)"
for t in '"Student"' '"FeeInvoice"' '"Payment"' '"User"'; do
  printf '%-14s neon=%s rds=%s\n' "$t" "$(psql "$SRC" -tAc "select count(*) from $t")" "$(psql "$DST" -tAc "select count(*) from $t")"
done
rm -f /tmp/neon.dump
REMOTE
cat <<DONE
Copied. Next:
  1) In deploy/aws/.env.production set DATABASE_URL to the value of DATABASE_URL in deploy/aws/.state
  2) bash deploy/push.sh
  3) Bring the schema up to date on RDS (safe to re-run):
     ssh -i $KEY_FILE ubuntu@$EIP 'cd /srv/anekio/current && bash scripts/releases/migrate-r1.sh --env .env --yes'
DONE
