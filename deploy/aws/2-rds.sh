#!/usr/bin/env bash
# Creates RDS PostgreSQL 16 (db.t4g.micro, Single-AZ, private) reachable only from the web server.
# Run on your Mac after 1-ec2.sh:  bash deploy/aws/2-rds.sh   (~10 minutes)
set -euo pipefail
source "$(dirname "$0")/config.sh"
VPC=$(state_get VPC); WEB_SG=$(state_get WEB_SG)
[[ -n "$VPC" && -n "$WEB_SG" ]] || { echo "Run deploy/aws/1-ec2.sh first."; exit 1; }

say "Security group (database): 5432 only from the web server"
DB_SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values="$NAME-db" Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)
if [[ "$DB_SG" == "None" ]]; then
  DB_SG=$(aws ec2 create-security-group --group-name "$NAME-db" --description "Anekio Postgres: only from web server" --vpc-id "$VPC" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --group-id "$DB_SG" --protocol tcp --port 5432 --source-group "$WEB_SG" >/dev/null
fi
state_set DB_SG "$DB_SG"

DB_ID="$NAME-db"
if ! aws rds describe-db-instances --db-instance-identifier "$DB_ID" >/dev/null 2>&1; then
  PASS=$(state_get DB_PASSWORD)
  [[ -n "$PASS" ]] || { PASS=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 28); state_set DB_PASSWORD "$PASS"; }
  say "Creating $DB_CLASS PostgreSQL 16 ($DB_STORAGE_GB GB gp3, autoscale to $DB_MAX_STORAGE_GB GB)"
  aws rds create-db-instance --db-instance-identifier "$DB_ID" --engine postgres --engine-version 16 \
    --db-instance-class "$DB_CLASS" --allocated-storage "$DB_STORAGE_GB" --max-allocated-storage "$DB_MAX_STORAGE_GB" \
    --storage-type gp3 --db-name "$DB_NAME" --master-username "$DB_USER" --master-user-password "$PASS" \
    --vpc-security-group-ids "$DB_SG" --no-publicly-accessible --no-multi-az \
    --backup-retention-period "$DB_BACKUP_DAYS" --preferred-backup-window "20:30-21:00" \
    --deletion-protection --storage-encrypted --copy-tags-to-snapshot \
    --tags Key=Name,Value="$NAME" >/dev/null
fi
echo "Waiting for the database (usually 5–10 minutes)…"
aws rds wait db-instance-available --db-instance-identifier "$DB_ID"
HOST=$(aws rds describe-db-instances --db-instance-identifier "$DB_ID" --query 'DBInstances[0].Endpoint.Address' --output text)
PASS=$(state_get DB_PASSWORD)
URL="postgresql://$DB_USER:$PASS@$HOST:5432/$DB_NAME?sslmode=require&connection_limit=10"
state_set DB_HOST "$HOST"
state_set DATABASE_URL "$URL"
cat <<DONE

RDS ready: $HOST
DATABASE_URL is saved in deploy/aws/.state (not printed). Next:
  1) Copy Neon → RDS:  bash deploy/db/neon-to-rds.sh
  2) Put that DATABASE_URL in deploy/aws/.env.production and run: bash deploy/push.sh
DONE
