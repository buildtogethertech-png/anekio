# Shared settings for the AWS scripts. Edit DOMAIN / ALERT_EMAIL before the first run.
export AWS_PROFILE="${AWS_PROFILE:-anekio}"
export AWS_REGION="${AWS_REGION:-ap-south-1}"
export AWS_DEFAULT_REGION="$AWS_REGION"

NAME="anekio-prod"
DOMAIN="${DOMAIN:-app.anekio.com}"           # app + API domain (DNS A record → Elastic IP)
EXTRA_DOMAINS="${EXTRA_DOMAINS:-anekio.com www.anekio.com admin.anekio.com connect.anekio.com *.anekio.com}" # marketing, admin, school sites
ALERT_EMAIL="${ALERT_EMAIL:-support@anekio.com}" # budget alerts + Let's Encrypt
INSTANCE_TYPE="t4g.small"                     # 2 vCPU / 2 GB, ARM
DISK_GB=20
DB_CLASS="db.t4g.micro"
DB_STORAGE_GB=20
DB_MAX_STORAGE_GB=50
DB_NAME="anekio"
DB_USER="anekio"
BUDGET_USD=40

# S3 buckets the app uses (from .env.local). The server gets access through an IAM role, not keys.
PUBLIC_BUCKET="${AWS_S3_PUBLIC_BUCKET:-anekio-school-public-staging-440427555457-ap-south-1}"
PRIVATE_BUCKET="${AWS_S3_PRIVATE_BUCKET:-anekio-staging-uploads-440427555457-ap-south-1-an}"

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$DEPLOY_DIR/.state"   # ids + secrets written by the scripts (git-ignored)
KEY_FILE="$HOME/.ssh/${NAME}.pem"

state_get() { [[ -f "$STATE" ]] && grep -E "^$1=" "$STATE" | tail -1 | cut -d= -f2- || true; }
state_set() { touch "$STATE"; chmod 600 "$STATE"; grep -vE "^$1=" "$STATE" > "$STATE.tmp" || true; echo "$1=$2" >> "$STATE.tmp"; mv "$STATE.tmp" "$STATE"; chmod 600 "$STATE"; }
say() { printf '\n==> %s\n' "$*"; }
