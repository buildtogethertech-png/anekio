#!/usr/bin/env bash
# Push only the production env and reload the app (no build, ~5 s, no downtime).
#   npm run deploy:env        (after editing deploy/aws/.env.production)
# Code changes still need: npm run deploy:prod
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
source deploy/aws/config.sh
EIP=$(state_get EIP); [[ -n "$EIP" ]] || { echo "Run deploy/aws/1-ec2.sh first."; exit 1; }
ENVF=deploy/aws/.env.production
[[ -f "$ENVF" ]] || { echo "Missing $ENVF (see deploy/README.md)."; exit 1; }
grep -qE '^DATABASE_URL="?postgres' "$ENVF" || { echo "$ENVF needs a postgres DATABASE_URL."; exit 1; }
grep -qE '^CRON_SECRET=.+' "$ENVF" || { echo "$ENVF needs CRON_SECRET."; exit 1; }
grep -qE '^AWS_(PROFILE|ACCESS_KEY_ID|SECRET_ACCESS_KEY)=' "$ENVF" && { echo "Remove AWS_PROFILE / AWS keys from $ENVF: the server uses its IAM role."; exit 1; }
if grep -qE '^EXPO_PUBLIC_' "$ENVF"; then
  echo "Note: EXPO_PUBLIC_* values are baked into the web build; changing them needs npm run deploy:prod."
fi

say "Upload env and reload (no build)"
scp -i "$KEY_FILE" -q "$ENVF" "ubuntu@$EIP:/srv/anekio/shared/.env"
ssh -i "$KEY_FILE" "ubuntu@$EIP" bash -s <<'REMOTE'
set -euo pipefail
chmod 600 /srv/anekio/shared/.env
cd /srv/anekio/current
# The ecosystem file reads /srv/anekio/shared/.env itself; --update-env applies it to the running app.
pm2 reload deploy/server/ecosystem.config.cjs --update-env >/dev/null && pm2 save >/dev/null
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:4000/health >/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:4000/health && echo
REMOTE
say "Env applied"
