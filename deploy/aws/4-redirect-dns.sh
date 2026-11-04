#!/usr/bin/env bash
# Route 53 zone for an extra domain that only redirects to the main site (e.g. anekio.in → anekio.com).
# Root and every subdomain point at the Elastic IP; nginx sends them on with a 301 (deploy/server/nginx-redirect.conf).
#   bash deploy/aws/4-redirect-dns.sh anekio.in      Safe to re-run (UPSERT).
# Then set the 4 printed nameservers at the registrar, and run: bash deploy/push.sh --ssl
set -euo pipefail
source "$(dirname "$0")/config.sh"
ZONE_NAME="${1:?usage: 4-redirect-dns.sh <domain>}"
EIP=$(state_get EIP); [[ -n "$EIP" ]] || { echo "Run deploy/aws/1-ec2.sh first."; exit 1; }
KEY="ZONE_ID_$(echo "$ZONE_NAME" | tr 'a-z.-' 'A-Z__')"

say "Route 53 hosted zone $ZONE_NAME"
ZONE=$(state_get "$KEY")
if [[ -z "$ZONE" ]]; then
  ZONE=$(aws route53 list-hosted-zones-by-name --dns-name "$ZONE_NAME" --max-items 1 \
    --query "HostedZones[?Name=='$ZONE_NAME.'].Id | [0]" --output text)
  if [[ "$ZONE" == "None" || -z "$ZONE" ]]; then
    ZONE=$(aws route53 create-hosted-zone --name "$ZONE_NAME" --caller-reference "$NAME-$ZONE_NAME-$(date +%s)" \
      --hosted-zone-config Comment="$NAME redirect" --query HostedZone.Id --output text)
  fi
  ZONE=${ZONE#/hostedzone/}
  state_set "$KEY" "$ZONE"
fi
echo "$ZONE"

say "Records: $ZONE_NAME and *.$ZONE_NAME → $EIP"
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" --change-batch "{\"Changes\":[
  {\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$ZONE_NAME\",\"Type\":\"A\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$EIP\"}]}},
  {\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"*.$ZONE_NAME\",\"Type\":\"A\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$EIP\"}]}},
  {\"Action\":\"UPSERT\",\"ResourceRecordSet\":{\"Name\":\"$ZONE_NAME\",\"Type\":\"CAA\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"0 issue \\\"letsencrypt.org\\\"\"}]}}]}" \
  --query ChangeInfo.Status --output text

NS=$(aws route53 get-hosted-zone --id "$ZONE" --query 'DelegationSet.NameServers' --output text | tr '\t' '\n')
cat <<DONE

Set these nameservers for $ZONE_NAME at the registrar (Hostinger → Domains → $ZONE_NAME → DNS / Nameservers):
$(echo "$NS" | sed 's/^/  /')
Add $ZONE_NAME to REDIRECT_DOMAINS in deploy/aws/config.sh, then once the registry shows them:  bash deploy/push.sh --ssl
DONE
