#!/usr/bin/env bash
# Build on your Mac, ship to EC2, switch over with zero data on the server disk.
#   bash deploy/push.sh            deploy the current working tree
#   bash deploy/push.sh --ssl      also get the HTTPS certificate (once DNS points at the server)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
source deploy/aws/config.sh
EIP=$(state_get EIP); [[ -n "$EIP" ]] || { echo "Run deploy/aws/1-ec2.sh first."; exit 1; }
ENVF=deploy/aws/.env.production
[[ -f "$ENVF" ]] || { echo "Missing $ENVF (see deploy/README.md)."; exit 1; }
grep -qE '^DATABASE_URL="?postgres' "$ENVF" || { echo "$ENVF needs a postgres DATABASE_URL."; exit 1; }
grep -qE '^CRON_SECRET=.+' "$ENVF" || { echo "$ENVF needs CRON_SECRET (any long random string)."; exit 1; }
grep -qE '^AWS_(PROFILE|ACCESS_KEY_ID|SECRET_ACCESS_KEY)=' "$ENVF" && { echo "Remove AWS_PROFILE / AWS keys from $ENVF: the server uses its IAM role."; exit 1; }
SSH="ssh -i $KEY_FILE -o StrictHostKeyChecking=accept-new ubuntu@$EIP"
REL=$(date +%Y%m%d-%H%M%S)

say "Build web app (EXPO_PUBLIC_API_URL=https://$DOMAIN)"
( cd mobile && EXPO_PUBLIC_API_URL="https://$DOMAIN" npx expo export --platform web )

say "Bundle server"
npx --yes esbuild@0.24.0 server/index.ts --bundle --platform=node --target=node20 --format=cjs \
  --outfile=dist/server.cjs --packages=external --sourcemap --log-level=warning

say "Upload release $REL"
$SSH "mkdir -p /srv/anekio/releases/$REL /srv/anekio/shared"
rsync -az --delete -e "ssh -i $KEY_FILE" \
  --include='/mobile/' --include='/mobile/dist/***' --exclude='/mobile/*' \
  --exclude='node_modules/' --exclude='.git/' --exclude='*.db' --exclude='*.db-journal' --exclude='/uploads/' \
  --exclude='.vercel*' --exclude='coverage/' --exclude='deploy/aws/.state' --exclude='deploy/aws/.env*' --exclude='.env*' \
  ./ "ubuntu@$EIP:/srv/anekio/releases/$REL/"
scp -i "$KEY_FILE" -q "$ENVF" "ubuntu@$EIP:/srv/anekio/shared/.env"

say "Install, generate Prisma (Postgres), switch, reload"
$SSH bash -s -- "$REL" "$DOMAIN" "$EXTRA_DOMAINS" <<'REMOTE'
set -euo pipefail
REL=$1; DOMAIN=$2; EXTRA_DOMAINS=$3; R=/srv/anekio/releases/$REL
chmod 600 /srv/anekio/shared/.env
cd "$R"
ln -sf /srv/anekio/shared/.env .env
npm ci --no-audit --no-fund --loglevel=error
set -a; . ./.env; set +a
PATH="$R/node_modules/.bin:$PATH" node scripts/vercel-prisma.mjs
ln -sfn "$R" /srv/anekio/current
pm2 startOrReload deploy/server/ecosystem.config.cjs --update-env && pm2 save
sed -e "s/__DOMAIN__/$DOMAIN/" -e "s/__EXTRA_DOMAINS__/$EXTRA_DOMAINS/" deploy/server/nginx.conf | sudo tee /etc/nginx/sites-available/anekio >/dev/null
if sudo test -d "/etc/letsencrypt/live/$DOMAIN"; then sudo certbot install --nginx -d "$DOMAIN" --cert-name "$DOMAIN" --redirect --non-interactive >/dev/null 2>&1 || true; fi
sudo nginx -t && sudo systemctl reload nginx
bash deploy/server/cron.sh
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:4000/health >/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:4000/health && echo
ls -1dt /srv/anekio/releases/* | tail -n +4 | xargs -r rm -rf   # keep last 3
REMOTE

if [[ "${1:-}" == "--ssl" ]]; then
  say "HTTPS certificate for $DOMAIN"
  $SSH "sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $ALERT_EMAIL --redirect"
fi
say "Deployed $REL → http://$EIP  (https://$DOMAIN once DNS + --ssl are done)"
