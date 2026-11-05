#!/usr/bin/env bash
# Allow SSH (port 22) to the server from your current internet IP. Run it when `ssh anekio` times out
# because your home/office IP changed. Old IPs are removed unless you pass --keep-old.
#   bash deploy/aws/ssh-allow-my-ip.sh
set -euo pipefail
source "$(dirname "$0")/config.sh"
SG=$(state_get WEB_SG); [[ -n "$SG" ]] || { echo "Run deploy/aws/1-ec2.sh first."; exit 1; }
MYIP="$(curl -fsS https://checkip.amazonaws.com | tr -d '\n')/32"

CURRENT=$(aws ec2 describe-security-groups --group-ids "$SG" \
  --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp' --output text)
if grep -qw "$MYIP" <<<"$CURRENT"; then
  echo "SSH already allowed from $MYIP"
else
  aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr "$MYIP" >/dev/null
  echo "SSH allowed from $MYIP"
fi
if [[ "${1:-}" != "--keep-old" ]]; then
  for old in $CURRENT; do
    [[ "$old" == "$MYIP" ]] && continue
    aws ec2 revoke-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr "$old" >/dev/null
    echo "Removed old IP $old"
  done
fi
echo "Now:  ssh anekio"
