#!/usr/bin/env bash
# Save credit while you are not using the server:  bash deploy/aws/power.sh stop|start|status
# Stopped EC2 costs only disk + IP (~$0.18/day). RDS can be stopped for up to 7 days (AWS restarts it after).
set -euo pipefail
source "$(dirname "$0")/config.sh"
INSTANCE=$(state_get INSTANCE); DB_ID="$NAME-db"
has_db() { aws rds describe-db-instances --db-instance-identifier "$DB_ID" >/dev/null 2>&1; }
case "${1:-status}" in
  stop)  aws ec2 stop-instances --instance-ids "$INSTANCE" >/dev/null; has_db && aws rds stop-db-instance --db-instance-identifier "$DB_ID" >/dev/null || true; echo "Stopping." ;;
  start) has_db && aws rds start-db-instance --db-instance-identifier "$DB_ID" >/dev/null 2>&1 || true; aws ec2 start-instances --instance-ids "$INSTANCE" >/dev/null; aws ec2 wait instance-running --instance-ids "$INSTANCE"; echo "Running at $(state_get EIP)." ;;
  *)     echo "EC2: $(aws ec2 describe-instances --instance-ids "$INSTANCE" --query 'Reservations[0].Instances[0].State.Name' --output text)"
         has_db && echo "RDS: $(aws rds describe-db-instances --db-instance-identifier "$DB_ID" --query 'DBInstances[0].DBInstanceStatus' --output text)" || echo "RDS: not created" ;;
esac
