#!/usr/bin/env bash
# EC2 first boot (runs as root via user-data). Installs Node 20, PM2, Nginx, Certbot, psql 16, AWS CLI, 2 GB swap.
set -euxo pipefail
exec > >(tee -a /var/log/anekio-bootstrap.log) 2>&1
export DEBIAN_FRONTEND=noninteractive

if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf && sysctl --system
fi
timedatectl set-timezone Asia/Kolkata

apt-get update -y
apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx python3-certbot-dns-route53 postgresql-client-16 rsync unzip jq
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2@latest
snap install aws-cli --classic || true

mkdir -p /srv/anekio /var/log/anekio
chown -R ubuntu:ubuntu /srv/anekio /var/log/anekio

# Nginx: placeholder until the first deploy writes the real site config.
cat > /etc/nginx/sites-available/anekio <<'NGINX'
server {
  listen 80 default_server;
  server_name _;
  location / { proxy_pass http://127.0.0.1:4000; }
}
NGINX
ln -sf /etc/nginx/sites-available/anekio /etc/nginx/sites-enabled/anekio
rm -f /etc/nginx/sites-enabled/default
systemctl enable --now nginx && systemctl reload nginx

# PM2 starts the app on reboot.
env PATH="$PATH:/usr/bin" pm2 startup systemd -u ubuntu --hp /home/ubuntu
date > /var/log/anekio-bootstrap.done
