#!/usr/bin/env bash
# Production logs from your Mac (server keeps 3 days).
#   bash deploy/logs.sh            live app log (one JSON line per API request / event)
#   bash deploy/logs.sh errors     last 50 app errors and warnings
#   bash deploy/logs.sh nginx      live requests as Nginx sees them
#   bash deploy/logs.sh slow       20 slowest API requests in today's log
#   bash deploy/logs.sh usage      who used Anekio today, per school (database; up to 5 min behind)
set -euo pipefail
source "$(dirname "$0")/aws/config.sh"
EIP=$(state_get EIP); [[ -n "$EIP" ]] || { echo "Run deploy/aws/1-ec2.sh first."; exit 1; }
SSH=(ssh -i "$KEY_FILE" -o StrictHostKeyChecking=accept-new "ubuntu@$EIP")

case "${1:-app}" in
  app)
    "${SSH[@]}" "tail -n 40 -F /var/log/anekio/out.log | sed -u 's/^[^{]*//' | jq -cR 'fromjson? // .'" ;;
  errors)
    "${SSH[@]}" "tail -n 400 /var/log/anekio/error.log | sed 's/^[^{]*//' | jq -cR 'fromjson? | select(.lvl==\"error\" or .lvl==\"warn\") | {t,msg,err,path,user,org}' | tail -n 50" ;;
  nginx)
    "${SSH[@]}" "sudo tail -n 40 -F /var/log/nginx/anekio-access.log | jq -c '{t,status,method,host,path,rt,ip}'" ;;
  slow)
    "${SSH[@]}" "sed 's/^[^{]*//' /var/log/anekio/out.log | jq -cR 'fromjson? | select(.msg==\"req\")' | jq -cs 'sort_by(-.ms) | .[:20][] | {ms,method,path,op,status,org}'" ;;
  usage)
    "${SSH[@]}" bash -s <<'REMOTE'
URL=$(grep -E '^DATABASE_URL=' /srv/anekio/shared/.env | cut -d= -f2- | tr -d '"')
psql "${URL%%\?*}?sslmode=require" -P pager=off -c "
  select coalesce(o.\"schoolName\", u.\"orgId\", '(no school)') as school,
         count(distinct u.\"userId\") as users,
         string_agg(distinct u.role, ', ') as roles,
         string_agg(distinct u.platform, ', ') as platforms,
         sum(u.requests) as requests,
         to_char(max(u.\"lastSeenAt\") at time zone 'UTC' at time zone 'Asia/Kolkata', 'HH24:MI') as last_seen_ist
  from \"UsageDaily\" u left join \"SaasOrg\" o on o.id = u.\"orgId\"
  where u.day = to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD')
  group by 1 order by users desc;"
REMOTE
    ;;
  *)
    sed -n '2,8p' "$0"; exit 1 ;;
esac
