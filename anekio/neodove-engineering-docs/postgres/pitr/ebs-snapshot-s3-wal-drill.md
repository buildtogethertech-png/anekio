# PostgreSQL PITR Drill: EBS Snapshot + S3 WAL

This runbook records the NeoDove staging recovery drill for PostgreSQL 15 on EC2 using:

- AWS Backup EBS snapshot as the base disk restore
- S3 archived PostgreSQL WAL for point-in-time recovery
- A temporary EC2 recovery machine for inspection and querying

Use this for accidental `DROP`, bad migration, or bad write recovery drills. Do not run these steps on production directly.

## Mental Model

PITR needs two things:

1. A base backup or snapshot from before the recovery target.
2. A continuous WAL archive from that base point until the recovery target.

EBS snapshot restore gives the database files as of the snapshot time. S3 WAL replay moves PostgreSQL forward from that snapshot to the exact recovery time.

If a bad command happened at `2026-08-31 16:41:00+05:30`, recover to just before it, for example:

```conf
recovery_target_time = '2026-08-31 16:40:00+05:30'
```

## NeoDove Staging Values From Drill

S3 WAL bucket:

```text
s3://neodove-postgres-pitr-staging/postgresql/staging/wal/
```

Observed restored EBS volume:

```text
vol-0ce62170ca9ba7c9e
```

Observed recovery EC2:

```text
staging-backup-replica
```

Observed restored disk inside EC2:

```text
/dev/nvme1n1
/dev/nvme1n1p1
```

Observed mounted restored root:

```text
/restore/source-root
```

PostgreSQL data directory inside restored root:

```text
/restore/source-root/var/lib/postgresql/15/main
```

## Setup Requirements

The recovery EC2 must have:

- Same AWS region and same Availability Zone as the restored EBS volume.
- PostgreSQL 15 installed.
- AWS CLI installed.
- IAM role attached with S3 read access to the WAL bucket.
- No production app traffic.
- Enough disk space to copy the restored PostgreSQL data directory.

Prefer IAM role over static AWS keys. Do not put long-lived AWS keys in shell history or config files.

Minimum IAM permissions for restore:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject",
    "s3:ListBucket"
  ],
  "Resource": [
    "arn:aws:s3:::neodove-postgres-pitr-staging",
    "arn:aws:s3:::neodove-postgres-pitr-staging/postgresql/staging/wal/*"
  ]
}
```

## 1. Restore EBS Snapshot From AWS Backup

In AWS Console:

1. Go to AWS Backup.
2. Open the backup vault and select the PostgreSQL/EBS recovery point.
3. Restore it as an EBS volume.
4. Wait for restore job status `Completed`.
5. Note the restored resource ID, for example:

```text
volume/vol-0ce62170ca9ba7c9e
```

The restored EBS volume is not automatically queryable. It must be attached to an EC2 instance and mounted.

## 2. Create Or Choose Recovery EC2

Create a temporary EC2 instance in the same Availability Zone as the restored volume.

Important:

- EBS volume attach requires same Availability Zone, not only same region.
- Do not attach the restored volume to production for a drill.
- Keep the instance disposable.

## 3. Attach Restored Volume

In EC2 Console:

1. Go to Elastic Block Store -> Volumes.
2. Select restored volume, for example `vol-0ce62170ca9ba7c9e`.
3. Actions -> Attach volume.
4. Select the recovery EC2.
5. Device name: use a data device name such as:

```text
/dev/sdf
```

On Nitro EC2 instances Linux may show it as `/dev/nvme1n1`. That is normal.

## 4. Find And Mount Restored Volume

SSH into recovery EC2 and inspect disks:

```bash
lsblk -f
```

Example from drill:

```text
nvme0n1
|-nvme0n1p1  ext4  cloudimg-rootfs  ...  /
nvme1n1
|-nvme1n1p1  ext4  cloudimg-rootfs
|-nvme1n1p15 vfat  UEFI
|-nvme1n1p16 ext4  BOOT
```

Here:

- `nvme0n1p1` is the recovery EC2 root disk.
- `nvme1n1p1` is the restored source root partition.

Mount read-only first:

```bash
sudo mkdir -p /restore/source-root
sudo mount -o ro /dev/nvme1n1p1 /restore/source-root
```

Check PostgreSQL data:

```bash
sudo ls -lah /restore/source-root/var/lib/postgresql/15/main | head
sudo cat /restore/source-root/var/lib/postgresql/15/main/PG_VERSION
```

Expected files:

```text
PG_VERSION
base
global
pg_wal
pg_logical
```

Warning: cloned root volumes can have the same filesystem UUID as the current root disk. Do not add this restored UUID to `/etc/fstab` on the recovery machine. Mount manually by device path for the drill.

## 5. Copy Restored PostgreSQL Data Into Recovery EC2

For a disposable recovery EC2, stop local PostgreSQL and replace its data directory with the restored copy.

```bash
sudo systemctl stop postgresql
sudo mv /var/lib/postgresql/15/main /var/lib/postgresql/15/main.empty
sudo mkdir -p /var/lib/postgresql/15/main
sudo rsync -aHAX --numeric-ids /restore/source-root/var/lib/postgresql/15/main/ /var/lib/postgresql/15/main/
sudo chown -R postgres:postgres /var/lib/postgresql/15/main
sudo chmod 700 /var/lib/postgresql/15/main
sudo rm -f /var/lib/postgresql/15/main/postmaster.pid
```

Copy restored config if needed:

```bash
sudo cp -a /etc/postgresql/15/main /etc/postgresql/15/main.empty
sudo rsync -aHAX --numeric-ids /restore/source-root/etc/postgresql/15/main/ /etc/postgresql/15/main/
```

Confirm the data directory:

```bash
sudo grep "data_directory" /etc/postgresql/15/main/postgresql.conf
```

Expected:

```conf
data_directory = '/var/lib/postgresql/15/main'
```

## 6. Install AWS CLI On Recovery EC2

Check whether AWS CLI exists:

```bash
which aws
command -v aws
```

If `/usr/local/bin/aws` does not exist, install AWS CLI v2.

For ARM/aarch64 EC2:

```bash
cd /tmp
curl "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
/usr/local/bin/aws --version
```

For x86_64 EC2:

```bash
cd /tmp
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
/usr/local/bin/aws --version
```

Ubuntu 24.04 may not have an `awscli` apt package candidate, so the AWS CLI v2 installer is safer for this drill.

## 7. Verify S3 WAL Access As postgres

The PostgreSQL process runs as Linux user `postgres`, so test S3 as that user:

```bash
sudo -u postgres /usr/local/bin/aws sts get-caller-identity
sudo -u postgres /usr/local/bin/aws s3 ls s3://neodove-postgres-pitr-staging/postgresql/staging/wal/ | tail
```

Expected WAL files are 16 MB objects with names like:

```text
0000000100000008000000C1
0000000100000008000000C2
0000000100000008000000C3
```

If error is `NoCredentials`, attach an IAM role to the recovery EC2:

EC2 -> Instances -> select recovery instance -> Actions -> Security -> Modify IAM role

Then retry the `sudo -u postgres aws s3 ls ...` command.

## 8. Configure PITR Recovery

Edit:

```bash
sudo nano /var/lib/postgresql/15/main/postgresql.auto.conf
```

For a recovery machine, disable archiving so the drill does not upload recovered WAL back into the real staging WAL archive:

```conf
archive_mode = 'off'
archive_timeout = '60s'
archive_command = 'true'
restore_command = '/usr/local/bin/aws s3 cp s3://neodove-postgres-pitr-staging/postgresql/staging/wal/%f %p'
recovery_target_time = '2026-08-31 16:40:00+05:30'
recovery_target_action = 'promote'
```

Use the real recovery target time just before the bad command.

Save in nano:

```text
Ctrl+O
Enter
Ctrl+X
```

Create recovery signal:

```bash
sudo touch /var/lib/postgresql/15/main/recovery.signal
sudo chown postgres:postgres /var/lib/postgresql/15/main/recovery.signal
sudo rm -f /var/lib/postgresql/15/main/postmaster.pid
```

Start PostgreSQL:

```bash
sudo systemctl start postgresql
```

Watch the real cluster log:

```bash
sudo tail -f /var/log/postgresql/logs/postgresql.log
```

The wrapper service log is less useful:

```bash
sudo journalctl -u postgresql -f
```

Prefer:

```bash
sudo journalctl -u postgresql@15-main -n 150 --no-pager
sudo tail -n 120 /var/log/postgresql/logs/postgresql.log
```

Expected recovery log messages:

```text
starting point-in-time recovery
restored log file "..." from archive
redo in progress
consistent recovery state reached
database system is ready to accept read-only connections
recovery stopping before/at ...
database system is ready to accept connections
```

The `00000002.history does not exist` 404 can be normal if PostgreSQL probes for a timeline history file that is not present. The important part is whether WAL segment restore continues.

## 9. Query Recovered Database

Connect:

```bash
sudo -u postgres psql
```

List databases:

```sql
\l
```

Switch to the NeoDove staging database:

```sql
\c neodove_staging
```

Then query:

```sql
select count(*) from campaign_lead;
```

If the relation does not exist, search schemas:

```sql
select schemaname, tablename
from pg_tables
where tablename ilike '%campaign%';
```

Then query with schema:

```sql
select count(*) from schema_name.campaign_lead;
```

Check whether recovery is complete:

```bash
sudo -u postgres psql -c "select pg_is_in_recovery();"
```

Result meaning:

- `t`: still in recovery/read-only.
- `f`: promoted and queryable normally.

## Mistakes Hit During Drill

### Typed `restore_command` in shell

Wrong:

```bash
restore_command = '/usr/local/bin/aws s3 cp ...'
```

This gives:

```text
restore_command: command not found
```

Reason: `restore_command` is PostgreSQL config, not a Linux command. Put it in `postgresql.auto.conf` or `postgresql.conf`.

### Used wrong AWS CLI path

Error:

```text
sh: 1: /usr/local/bin/aws: not found
FATAL: could not restore file "00000002.history" from archive: command not found
```

Fix:

```bash
which aws
command -v aws
```

Then either install AWS CLI at `/usr/local/bin/aws` or update config to the real path.

### AWS CLI worked for ubuntu but not postgres

Error:

```text
NoCredentials: Unable to locate credentials
```

Fix: attach an EC2 IAM role and test as the postgres user:

```bash
sudo -u postgres /usr/local/bin/aws s3 ls s3://neodove-postgres-pitr-staging/postgresql/staging/wal/ | tail
```

### Looked at wrapper service logs only

`postgresql.service` can say `Finished` while the actual cluster failed. Check:

```bash
sudo journalctl -u postgresql@15-main -n 150 --no-pager
sudo tail -n 120 /var/log/postgresql/logs/postgresql.log
```

### Tried to query the wrong database

Prompt:

```text
postgres=#
```

means connected to the default `postgres` database. Switch first:

```sql
\c neodove_staging
```

Then query the table.

### Reused a data directory after failed attempts

If recovery fails with checkpoint/WAL errors after multiple starts, rebuild a fresh copy from the mounted snapshot:

```bash
sudo systemctl stop postgresql
sudo mv /var/lib/postgresql/15/main /var/lib/postgresql/15/main.failed-$(date +%s)
sudo mkdir -p /var/lib/postgresql/15/main
sudo rsync -aHAX --numeric-ids /restore/source-root/var/lib/postgresql/15/main/ /var/lib/postgresql/15/main/
sudo chown -R postgres:postgres /var/lib/postgresql/15/main
sudo chmod 700 /var/lib/postgresql/15/main
sudo rm -f /var/lib/postgresql/15/main/postmaster.pid
```

Then reapply PITR config and start again.

### Left archiving enabled on recovery machine

If the recovery machine has:

```conf
archive_mode = 'on'
archive_command = '... upload to s3://neodove-postgres-pitr-staging/postgresql/staging/wal/%f'
```

it may upload recovery-machine WAL into the same staging WAL archive after promotion. For a drill, set:

```conf
archive_mode = 'off'
archive_command = 'true'
```

Keep `restore_command` enabled because it downloads WAL from S3.

## Common Failure Messages

### `/usr/local/bin/aws: not found`

Install AWS CLI v2 or change config to the actual AWS CLI path.

### `NoCredentials`

The `postgres` user cannot access AWS credentials. Attach an IAM role to the EC2 and test as `postgres`.

### `00000002.history does not exist`

Usually not fatal by itself. PostgreSQL may probe for timeline history files. Continue checking whether WAL segments are restored.

### `PANIC: could not locate a valid checkpoint record`

Possible causes:

- Data directory was modified by failed recovery attempts.
- Snapshot is not a consistent PostgreSQL base.
- Required WAL segment sequence is incomplete or wrong for the data directory.

First retry from a fresh copy of the mounted snapshot. If it repeats, verify the snapshot/base backup consistency and WAL chain.

## Cleanup After Drill

After the required data is verified or exported:

1. Stop PostgreSQL on recovery machine.
2. Preserve drill logs and commands.
3. Detach restored EBS volume if no longer needed.
4. Delete temporary EC2 if disposable.
5. Delete temporary restored EBS volume after confirmation.
6. Keep AWS Backup recovery point and S3 WAL according to retention policy.

Do not delete production backups, WAL archives, or snapshots during an incident.
