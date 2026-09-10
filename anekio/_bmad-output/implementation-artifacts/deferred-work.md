- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Add `.pgpass` creation, ownership, and mode requirements to the replica runbook.
  evidence: The existing `pg_basebackup` procedure does not document repeatable non-interactive authentication.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Replace destructive replica data-directory deletion with a preserved-directory workflow.
  evidence: The existing `rm -rf .../*` command can destroy needed data and still leave dotfiles that block `pg_basebackup`.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Document replication-slot inspection and safe `pg_basebackup` retry behavior.
  evidence: A failed backup can leave the newly created slot behind, causing the next `--create-slot` attempt to fail.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Distinguish PostgreSQL settings that require restart from authentication rules that only require reload.
  evidence: The current primary configuration lists settings without operational application steps.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Correct the `pg_hba.conf` wording around AWS security groups.
  evidence: PostgreSQL host rules accept IP addresses and CIDRs, while security-group references belong in AWS network rules.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Expand replica health validation to cover WAL receiver state, slot, sender, LSNs, and primary-side replication state.
  evidence: `pg_is_in_recovery()` alone can be true even when streaming replication is disconnected.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Scope replica service commands to PostgreSQL 15 cluster `main`.
  evidence: Generic `systemctl start postgresql` can affect multiple clusters on Debian or Ubuntu hosts.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Add explicit compatibility safeguards for restoring PostgreSQL 16 archives into PostgreSQL 15.
  evidence: A newer `pg_restore` can read an archive but cannot guarantee that SQL from a newer server is compatible with an older target.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Replace broad `REASSIGN OWNED BY postgres` guidance with ownership changes limited to restored objects.
  evidence: The existing command can reassign unrelated objects owned by `postgres` in the target database.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Document staging behavior for production tablespaces during logical restore.
  evidence: Missing production tablespaces can make restoration fail or place restored data incorrectly.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Replace the fixed EBS size recommendation with measured capacity and free-space criteria.
  evidence: The current recommendation does not calculate WAL, temporary files, index rebuilds, bloat, or growth headroom.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Add an `xfsprogs` availability check before formatting an XFS volume.
  evidence: A default Ubuntu installation may not provide `mkfs.xfs`.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-gitlab-machine-deploy-key-runbook.md`
  summary: Harden the `/etc/fstab` procedure with backup, UUID/filesystem verification, and reboot validation.
  evidence: `mount -a` alone does not prove that the intended production mount will survive reboot safely.
- source_spec: `/Users/gauravmandal/Gaurav Mandal/_bmad-output/implementation-artifacts/spec-nt-5-manual-paper-deadline-cron.md`
  summary: Replace unbounded `noticesForUser` in-memory filtering with database-level visibility filtering and pagination.
  evidence: The existing implementation loads every notice and recipient relation before filtering in application memory, so inbox latency and memory use grow without bound as notice history increases.
