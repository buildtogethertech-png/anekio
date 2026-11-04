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
  --exclude='.vercel*' --exclude='coverage/' --exclude='deploy/aws/.state' --exclude='deploy/aws/.env*' --exclude='deploy/aws/.grafana.env' --exclude='.env*' \
  ./ "ubuntu@$EIP:/srv/anekio/releases/$REL/"
scp -i "$KEY_FILE" -q "$ENVF" "ubuntu@$EIP:/srv/anekio/shared/.env"
[[ -f deploy/aws/.grafana.env ]] && scp -i "$KEY_FILE" -q deploy/aws/.grafana.env "ubuntu@$EIP:/srv/anekio/shared/grafana.env"

if [[ "${1:-}" == "--ssl" && -n "$(state_get ZONE_ID)" ]]; then
  say "Wildcard certificate $WILDCARD_DOMAIN + *.$WILDCARD_DOMAIN (DNS-01 via Route 53)"
  $SSH "sudo apt-get install -y python3-certbot-dns-route53 >/dev/null && sudo certbot certonly --dns-route53 \
    -d $WILDCARD_DOMAIN -d '*.$WILDCARD_DOMAIN' --cert-name $WILDCARD_DOMAIN --keep-until-expiring \
    --non-interactive --agree-tos -m $ALERT_EMAIL --deploy-hook 'systemctl reload nginx'"
fi

say "Install, generate Prisma (Postgres), switch, reload"
$SSH bash -s -- $(printf '%q ' "$REL" "$DOMAIN" "$EXTRA_DOMAINS" "$WILDCARD_DOMAIN" "$REDIRECT_DOMAINS") <<'REMOTE'   # ssh re-splits args: quote them
set -euo pipefail
REL=$1; DOMAIN=$2; EXTRA_DOMAINS=$3; CERT=$4; REDIRECTS=$5; R=/srv/anekio/releases/$REL
chmod 600 /srv/anekio/shared/.env
cd "$R"
ln -sf /srv/anekio/shared/.env .env
npm ci --no-audit --no-fund --loglevel=error
set -a; . ./.env; set +a
PATH="$R/node_modules/.bin:$PATH" node scripts/vercel-prisma.mjs
ln -sfn "$R" /srv/anekio/current
pm2 startOrReload deploy/server/ecosystem.config.cjs --update-env && pm2 save
if [[ ( "$DOMAIN" == "$CERT" || "${DOMAIN#*.}" == "$CERT" ) ]] && sudo test -d "/etc/letsencrypt/live/$CERT"; then
  sed -e "s/__DOMAIN__/$DOMAIN/" -e "s/__EXTRA_DOMAINS__/$EXTRA_DOMAINS/" -e "s/__CERT__/$CERT/g" deploy/server/nginx-ssl.conf | sudo tee /etc/nginx/sites-available/anekio >/dev/null
else
  sed -e "s/__DOMAIN__/$DOMAIN/" -e "s/__EXTRA_DOMAINS__/$EXTRA_DOMAINS/" deploy/server/nginx.conf | sudo tee /etc/nginx/sites-available/anekio >/dev/null
  if sudo test -d "/etc/letsencrypt/live/$DOMAIN"; then sudo certbot install --nginx -d "$DOMAIN" --cert-name "$DOMAIN" --redirect --non-interactive >/dev/null 2>&1 || true; fi
fi
sudo mkdir -p /var/www/letsencrypt
for FROM in $REDIRECTS; do
  SITE=/etc/nginx/sites-available/anekio-redirect-$FROM
  sed -e "s/__FROM_RE__/${FROM//./\\\\.}/g" -e "s/__FROM__/$FROM/g" -e "s/__TO__/$CERT/g" deploy/server/nginx-redirect.conf | sudo tee "$SITE" >/dev/null
  if sudo test -d "/etc/letsencrypt/live/$FROM"; then sudo sed -i 's/^#SSL //' "$SITE"; fi
  sudo ln -sf "$SITE" /etc/nginx/sites-enabled/
done
GRAFANA_ENV=/srv/anekio/shared/grafana.env
STACK=$( [[ -f $GRAFANA_ENV ]] && grep -E '^GRAFANA_STACK_URL=' $GRAFANA_ENV | cut -d= -f2- | tr -d '"' || true )
if [[ -n "$STACK" ]] && sudo test -d "/etc/letsencrypt/live/$CERT"; then   # monitoring.<domain> → Grafana Cloud stack
  printf 'server {\n  listen 80;\n  listen 443 ssl http2;\n  server_name monitoring.%s;\n  ssl_certificate /etc/letsencrypt/live/%s/fullchain.pem;\n  ssl_certificate_key /etc/letsencrypt/live/%s/privkey.pem;\n  include /etc/letsencrypt/options-ssl-nginx.conf;\n  return 302 %s;\n}\n' \
    "$CERT" "$CERT" "$CERT" "$STACK" | sudo tee /etc/nginx/sites-available/anekio-monitoring >/dev/null
  sudo ln -sf /etc/nginx/sites-available/anekio-monitoring /etc/nginx/sites-enabled/
fi
sudo nginx -t && sudo systemctl reload nginx
bash deploy/server/cron.sh
sudo install -m 644 deploy/server/logrotate.conf /etc/logrotate.d/anekio
sudo sed -i 's/^\(\s*\)rotate 14$/\1rotate 3/' /etc/logrotate.d/nginx   # 3 days of Nginx logs
bash deploy/server/alloy-setup.sh || echo "(Grafana Alloy setup failed; the app is unaffected)"
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:4000/health >/dev/null && break; sleep 1; done
curl -fsS http://127.0.0.1:4000/health && echo
ls -1dt /srv/anekio/releases/* | tail -n +4 | xargs -r rm -rf   # keep last 3
REMOTE

if [[ "${1:-}" == "--ssl" && -z "$(state_get ZONE_ID)" ]]; then
  say "HTTPS certificate for $DOMAIN"
  $SSH "sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m $ALERT_EMAIL --redirect"
fi
if [[ "${1:-}" == "--ssl" ]]; then
  for FROM in $REDIRECT_DOMAINS; do
    say "HTTPS certificate for redirect domain $FROM + www.$FROM (HTTP-01)"
    $SSH "sudo certbot certonly --webroot -w /var/www/letsencrypt -d $FROM -d www.$FROM --cert-name $FROM --keep-until-expiring \
      --non-interactive --agree-tos -m $ALERT_EMAIL --deploy-hook 'systemctl reload nginx' \
      && sudo sed -i 's/^#SSL //' /etc/nginx/sites-available/anekio-redirect-$FROM && sudo nginx -t && sudo systemctl reload nginx"
  done
fi
say "Deployed $REL → http://$EIP  (https://$DOMAIN once DNS + --ssl are done)"
