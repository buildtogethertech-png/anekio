#!/usr/bin/env bash
# Moves anekio.com DNS to Route 53: hosted zone, every record that was on Vercel DNS (mail, DKIM, CAA),
# web records → Elastic IP, and Route 53 access for the server role (wildcard SSL via DNS-01).
# Run on your Mac after 1-ec2.sh:  bash deploy/aws/3-dns.sh   Safe to re-run (UPSERT).
# Then, at cutover, set the 4 printed nameservers at the registrar (Hostinger).
set -euo pipefail
source "$(dirname "$0")/config.sh"
EIP=$(state_get EIP); [[ -n "$EIP" ]] || { echo "Run deploy/aws/1-ec2.sh first."; exit 1; }
ZONE_NAME="${ZONE_NAME:-anekio.com}"
TTL=300

say "Route 53 hosted zone $ZONE_NAME"
ZONE=$(state_get ZONE_ID)
if [[ -z "$ZONE" ]]; then
  ZONE=$(aws route53 list-hosted-zones-by-name --dns-name "$ZONE_NAME" --max-items 1 \
    --query "HostedZones[?Name=='$ZONE_NAME.'].Id | [0]" --output text)
  if [[ "$ZONE" == "None" || -z "$ZONE" ]]; then
    ZONE=$(aws route53 create-hosted-zone --name "$ZONE_NAME" --caller-reference "$NAME-$(date +%s)" \
      --hosted-zone-config Comment="$NAME" --query HostedZone.Id --output text)
  fi
  ZONE=${ZONE#/hostedzone/}
  state_set ZONE_ID "$ZONE"
fi
echo "$ZONE"

rr() { # name type ttl value...  (values already quoted for TXT/CAA)
  local name=$1 type=$2 ttl=$3; shift 3
  local vals=""; for v in "$@"; do vals+="{\"Value\":$(jq -Rn --arg v "$v" '$v')},"; done
  printf '{"Action":"UPSERT","ResourceRecordSet":{"Name":"%s","Type":"%s","TTL":%s,"ResourceRecords":[%s]}},' \
    "$name" "$type" "$ttl" "${vals%,}"
}
DKIM='p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLCpb2dNuHcaV7LNYbe1aBAor+1avhmngWlh9iqSGmUuWuli1ZDDwStjHpM3iFqRF0SZOhbi2PFe5vJXWdUgD9FnMGuzQ/BaK8ow5Kq9Y8/OZsR2CWJw1nCoXQBryHoQV64tb35j+t/gkkjOfal6YFXZTNnt4jNI6hFlxQOEpFpwIDAQAB'
# Staging still lives on Vercel until that project is removed.
VERCEL_STAGING="c11d02eb2dbc3122.vercel-dns-017.com."

CHANGES="$(rr "$ZONE_NAME" A $TTL "$EIP")"
CHANGES+="$(rr "*.$ZONE_NAME" A $TTL "$EIP")"
CHANGES+="$(rr "$ZONE_NAME" MX $TTL "10 mx.zoho.in." "20 mx2.zoho.in." "50 mx3.zoho.in.")"
CHANGES+="$(rr "$ZONE_NAME" TXT $TTL '"v=spf1 include:zoho.in ~all"' '"zoho-verification=zb05685536.zmverify.zoho.in"')"
CHANGES+="$(rr "$ZONE_NAME" CAA $TTL '0 issue "letsencrypt.org"' '0 issue "pki.goog"' '0 issue "sectigo.com"' '0 issue "amazon.com"')"
CHANGES+="$(rr "send.$ZONE_NAME" MX $TTL "10 feedback-smtp.ap-northeast-1.amazonses.com.")"
CHANGES+="$(rr "send.$ZONE_NAME" TXT $TTL '"v=spf1 include:amazonses.com ~all"')"
CHANGES+="$(rr "resend._domainkey.$ZONE_NAME" TXT $TTL "\"$DKIM\"")"
CHANGES+="$(rr "staging.$ZONE_NAME" CNAME $TTL "$VERCEL_STAGING")"
CHANGES+="$(rr "*.staging.$ZONE_NAME" CNAME $TTL "$VERCEL_STAGING")"

say "Records (web → $EIP, mail/DKIM/CAA copied from Vercel DNS)"
aws route53 change-resource-record-sets --hosted-zone-id "$ZONE" \
  --change-batch "{\"Comment\":\"$NAME\",\"Changes\":[${CHANGES%,}]}" --query ChangeInfo.Status --output text

say "Server role may answer DNS-01 challenges in this zone only"
aws iam put-role-policy --role-name "$NAME-ec2" --policy-name route53-certbot --policy-document "{
  \"Version\":\"2012-10-17\",\"Statement\":[
   {\"Effect\":\"Allow\",\"Action\":[\"route53:ListHostedZones\",\"route53:GetChange\"],\"Resource\":\"*\"},
   {\"Effect\":\"Allow\",\"Action\":[\"route53:ChangeResourceRecordSets\"],\"Resource\":\"arn:aws:route53:::hostedzone/$ZONE\"}]}"

NS=$(aws route53 get-hosted-zone --id "$ZONE" --query 'DelegationSet.NameServers' --output text | tr '\t' '\n')
state_set ZONE_NS "$(echo $NS)"
cat <<DONE

Route 53 is ready but NOT live yet. At cutover, set these nameservers at Hostinger (Domains → anekio.com → DNS / Nameservers):
$(echo "$NS" | sed 's/^/  /')
Check before switching:  dig +short MX $ZONE_NAME @$(echo "$NS" | head -1)
DONE
