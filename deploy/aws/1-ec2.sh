#!/usr/bin/env bash
# Creates the production server in Mumbai: key pair, firewall, S3 role, t4g.small, Elastic IP, $40 budget.
# Run on your Mac:  DOMAIN=app.anekio.in ALERT_EMAIL=you@x.com bash deploy/aws/1-ec2.sh
# Safe to re-run: existing pieces are reused.
set -euo pipefail
source "$(dirname "$0")/config.sh"
command -v aws >/dev/null || { echo "Install the AWS CLI first: brew install awscli"; exit 1; }
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
say "Account $ACCOUNT · profile $AWS_PROFILE · region $AWS_REGION"

VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
[[ "$VPC" == "None" ]] && { echo "No default VPC in $AWS_REGION. Create one: aws ec2 create-default-vpc"; exit 1; }
state_set VPC "$VPC"

say "SSH key pair"
if ! aws ec2 describe-key-pairs --key-names "$NAME" >/dev/null 2>&1; then
  mkdir -p "$HOME/.ssh"
  aws ec2 create-key-pair --key-name "$NAME" --key-type ed25519 --query KeyMaterial --output text > "$KEY_FILE"
  chmod 400 "$KEY_FILE"
  echo "Saved private key to $KEY_FILE"
else
  echo "Key pair $NAME exists (private key: $KEY_FILE)"
fi

say "Security group (web)"
WEB_SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values="$NAME-web" Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)
if [[ "$WEB_SG" == "None" ]]; then
  WEB_SG=$(aws ec2 create-security-group --group-name "$NAME-web" --description "Anekio web: SSH from admin, HTTP/HTTPS public" --vpc-id "$VPC" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" --ip-permissions \
    'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' \
    'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]' >/dev/null
fi
MYIP=$(curl -fsS https://checkip.amazonaws.com | tr -d '\n')
aws ec2 authorize-security-group-ingress --group-id "$WEB_SG" --protocol tcp --port 22 --cidr "$MYIP/32" >/dev/null 2>&1 || true
state_set WEB_SG "$WEB_SG"
echo "$WEB_SG (SSH allowed from $MYIP)"

say "IAM role for S3 (no access keys on the server)"
ROLE="$NAME-ec2"
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
fi
aws iam put-role-policy --role-name "$ROLE" --policy-name s3-uploads --policy-document "{
  \"Version\":\"2012-10-17\",\"Statement\":[
   {\"Effect\":\"Allow\",\"Action\":[\"s3:GetObject\",\"s3:PutObject\",\"s3:DeleteObject\"],\"Resource\":[\"arn:aws:s3:::$PUBLIC_BUCKET/*\",\"arn:aws:s3:::$PRIVATE_BUCKET/*\"]},
   {\"Effect\":\"Allow\",\"Action\":[\"s3:ListBucket\"],\"Resource\":[\"arn:aws:s3:::$PUBLIC_BUCKET\",\"arn:aws:s3:::$PRIVATE_BUCKET\"]}]}"
aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore 2>/dev/null || true
if ! aws iam get-instance-profile --instance-profile-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-instance-profile --instance-profile-name "$ROLE" >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"
  sleep 10 # IAM is eventually consistent
fi

say "EC2 $INSTANCE_TYPE (Ubuntu 24.04 ARM)"
INSTANCE=$(state_get INSTANCE)
if [[ -z "$INSTANCE" ]] || [[ "$(aws ec2 describe-instances --instance-ids "$INSTANCE" --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null)" =~ ^(terminated|None|)$ ]]; then
  AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
  INSTANCE=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" --key-name "$NAME" \
    --security-group-ids "$WEB_SG" --iam-instance-profile Name="$ROLE" \
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$DISK_GB,VolumeType=gp3,DeleteOnTermination=true}" \
    --metadata-options HttpTokens=required \
    --user-data "file://$DEPLOY_DIR/../server/bootstrap.sh" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME}]" "ResourceType=volume,Tags=[{Key=Name,Value=$NAME}]" \
    --query 'Instances[0].InstanceId' --output text)
  state_set INSTANCE "$INSTANCE"
fi
echo "Instance $INSTANCE — waiting until running…"
aws ec2 wait instance-running --instance-ids "$INSTANCE"

say "Elastic IP"
EIP_ALLOC=$(state_get EIP_ALLOC)
if [[ -z "$EIP_ALLOC" ]]; then
  EIP_ALLOC=$(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" --query AllocationId --output text)
  state_set EIP_ALLOC "$EIP_ALLOC"
fi
aws ec2 associate-address --instance-id "$INSTANCE" --allocation-id "$EIP_ALLOC" >/dev/null
EIP=$(aws ec2 describe-addresses --allocation-ids "$EIP_ALLOC" --query 'Addresses[0].PublicIp' --output text)
state_set EIP "$EIP"

say "Monthly budget \$$BUDGET_USD (alerts at 50/80/100%)"
if ! aws budgets describe-budget --account-id "$ACCOUNT" --budget-name "$NAME" >/dev/null 2>&1; then
  aws budgets create-budget --account-id "$ACCOUNT" \
    --budget "{\"BudgetName\":\"$NAME\",\"BudgetLimit\":{\"Amount\":\"$BUDGET_USD\",\"Unit\":\"USD\"},\"TimeUnit\":\"MONTHLY\",\"BudgetType\":\"COST\"}" \
    --notifications-with-subscribers "[
      {\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":50},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$ALERT_EMAIL\"}]},
      {\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":80},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$ALERT_EMAIL\"}]},
      {\"Notification\":{\"NotificationType\":\"FORECASTED\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":100},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"$ALERT_EMAIL\"}]}]" || echo "(Budget not created — set it in Billing → Budgets.)"
fi

cat <<DONE

Server ready: $EIP  (instance $INSTANCE)
  SSH:   ssh -i $KEY_FILE ubuntu@$EIP
  Next:  1) Point DNS:  $DOMAIN  A  $EIP
         2) First boot installs Node/Nginx/PM2 (~3 min). Check: ssh … 'cat /var/log/anekio-bootstrap.done'
         3) Put production env in deploy/aws/.env.production (see deploy/README.md)
         4) Deploy:  bash deploy/push.sh
DONE
