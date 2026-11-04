#!/usr/bin/env bash
# Installs / updates Grafana Alloy and points it at Grafana Cloud. Run on the server by deploy/push.sh,
# only when /srv/anekio/shared/grafana.env exists (copied from deploy/aws/.grafana.env). Safe to re-run.
set -euo pipefail
ENV_FILE=/srv/anekio/shared/grafana.env
[[ -f "$ENV_FILE" ]] || { echo "No $ENV_FILE: Grafana monitoring stays off."; exit 0; }
grep -qE '^GRAFANA_TOKEN="?glc_' "$ENV_FILE" || { echo "GRAFANA_TOKEN not set in deploy/aws/.grafana.env: Grafana monitoring stays off."; exit 0; }
cd "$(dirname "$0")"

if ! command -v alloy >/dev/null; then
  echo "==> Installing Grafana Alloy"
  sudo mkdir -p /etc/apt/keyrings
  curl -fsSL https://apt.grafana.com/gpg.key | gpg --dearmor | sudo tee /etc/apt/keyrings/grafana.gpg >/dev/null
  echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list >/dev/null
  sudo apt-get update -y >/dev/null
  sudo apt-get install -y alloy >/dev/null
fi

# Read Nginx logs (group adm) and app logs (world-readable).
sudo usermod -aG adm alloy

# Settings + secrets for the systemd unit (EnvironmentFile=/etc/default/alloy).
{
  echo 'CONFIG_FILE="/etc/alloy/config.alloy"'
  echo 'CUSTOM_ARGS=""'
  grep -E '^(GRAFANA_PROM_URL|GRAFANA_PROM_USER|GRAFANA_LOKI_URL|GRAFANA_LOKI_USER|GRAFANA_TOKEN|MONITOR_DB_URL)=' "$ENV_FILE"
} | sudo tee /etc/default/alloy >/dev/null
sudo chmod 600 /etc/default/alloy

sudo install -m 644 config.alloy /etc/alloy/config.alloy
sudo systemctl enable alloy >/dev/null 2>&1
sudo systemctl restart alloy
sleep 3
systemctl is-active --quiet alloy && echo "Alloy running → Grafana Cloud" || { sudo journalctl -u alloy -n 30 --no-pager; exit 1; }
