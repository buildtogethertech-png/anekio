# Anekio on AWS (Mumbai) — Plan B

EC2 `t4g.small` (web + API, Nginx + PM2) · RDS PostgreSQL 16 `db.t4g.micro` (private) · S3 for files (IAM role, no keys) · ~$32/month + GST.

Everything runs from **your Mac** with the AWS CLI profile `anekio` (already in `.env.local`).
Secrets and ids land in `deploy/aws/.state` (git-ignored, chmod 600).

## 0. Once
```bash
brew install awscli            # if missing
aws sts get-caller-identity --profile anekio   # must show account 440427555457
```

## 1. Server (today)
```bash
DOMAIN=app.yourdomain.in ALERT_EMAIL=you@yourmail.com bash deploy/aws/1-ec2.sh
```
Creates: SSH key (`~/.ssh/anekio-prod.pem`), security group (SSH only from your IP, 80/443 public),
IAM role with S3 access to the two upload buckets, the instance, an Elastic IP, and a $40 budget with email alerts.
First boot installs Node 20, PM2, Nginx, Certbot, psql, AWS CLI and 2 GB swap (~3 min).
Put `DOMAIN` and `ALERT_EMAIL` in `deploy/aws/config.sh` so you don't retype them.

## 2. Production env
Create `deploy/aws/.env.production` with the same values Vercel had (Vercel → Project → Settings → Environment Variables,
or `vercel env pull deploy/aws/.env.production --environment=production` before the project is paused). Then:
- `DATABASE_URL` → Neon for now (switch to RDS in step 4)
- `ANEKIO_PUBLIC_URL=https://app.yourdomain.in`
- `CRON_SECRET=<long random string>` (`openssl rand -hex 24`)
- keep `AWS_REGION`, `AWS_S3_PUBLIC_BUCKET`, `AWS_S3_PRIVATE_BUCKET`; **remove** `AWS_PROFILE` / access keys (the IAM role is used)
- remove `VERCEL_*`

## 3. Deploy
```bash
bash deploy/push.sh            # builds web + server on your Mac, uploads, npm ci, Prisma (Postgres), PM2 reload, cron
```
Point DNS: `app.yourdomain.in  A  <Elastic IP>` (Cloudflare: proxy off until SSL is issued), then:
```bash
bash deploy/push.sh --ssl      # Let's Encrypt + HTTP→HTTPS redirect (auto-renews)
```

## 4. Database to RDS (~3 days before school reopens)
```bash
bash deploy/aws/2-rds.sh                                  # ~10 min, private, 7-day backups, deletion protection
NEON_URL='postgresql://…neon.tech/neondb?sslmode=require' bash deploy/db/neon-to-rds.sh
# set DATABASE_URL in .env.production to the one in deploy/aws/.state, then
bash deploy/push.sh
```

## Day to day
| Task | Command |
|---|---|
| Deploy | `npm run deploy:prod` (same as `bash deploy/push.sh`; switches to Node 20 itself) |
| Only the env changed | Edit `deploy/aws/.env.production`, then `npm run deploy:env` (~5 s, no build). `EXPO_PUBLIC_*` still needs `deploy:prod` |
| SSH into the server | `ssh anekio` (add the `Host anekio` block from below to `~/.ssh/config`) |
| SSH times out (your IP changed) | `bash deploy/aws/ssh-allow-my-ip.sh` |
| Logs | `ssh anekio 'pm2 logs anekio --lines 100'` |
| Save credit while idle | `bash deploy/aws/power.sh stop` / `start` / `status` |
| Roll back | on the server: `ln -sfn /srv/anekio/releases/<previous> /srv/anekio/current && pm2 reload anekio` |

Cron on the server (IST): leave job 01:00 (same as Vercel's 19:30 UTC), DB backup to `s3://<private bucket>/backups/db/` 02:30.
Add an S3 lifecycle rule on `backups/` to expire after 30 days.

**Before 4 Mar 2027:** upgrade the AWS account from the Free plan, or AWS stops the account.

## Logs, usage and monitoring
**Logs (3 days on the server).** The app writes one JSON line per API request and per event (`lib/logger.ts`).
```bash
bash deploy/logs.sh            # live app log
bash deploy/logs.sh errors     # recent errors and warnings
bash deploy/logs.sh nginx      # live requests (Nginx JSON log)
bash deploy/logs.sh slow       # slowest API calls today
bash deploy/logs.sh usage      # who used Anekio today, per school
```
**Usage history.** `UsageDaily` (one row per user, day, platform; `lib/usage.ts`) feeds **admin → Usage**:
active users today / 7 / 30 days per school, roles, web vs Android, most used actions. Release `r2` adds the table.

**Grafana Cloud (free) at monitoring.anekio.com.**
1. Create a free Grafana Cloud stack; make an Access Policy token with `metrics:write` and `logs:write`.
2. Create the read-only DB login: run `deploy/db/monitor-user.sql` on RDS from the server.
3. `cp deploy/aws/grafana.env.example deploy/aws/.grafana.env`, fill it in (git-ignored), then `bash deploy/push.sh`.
   This installs Grafana Alloy (EC2 metrics, Postgres metrics, app + Nginx logs) and the `monitoring.anekio.com` redirect.
4. In Grafana: Dashboards → New → Import → `deploy/grafana/anekio.json` — one page: Server / CPU / RAM / Disk /
   Database / 5xx at the top, then EC2, RDS, Traffic and App sections that open on click.
   No-menu view: https://stoutgrotto3198.grafana.net/d/anekio-server?kiosk

### `~/.ssh/config`
```
Host anekio
  HostName 13.204.123.9
  User ubuntu
  IdentityFile ~/.ssh/anekio-prod.pem
  IdentitiesOnly yes
  ServerAliveInterval 30
```
