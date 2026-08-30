---
title: 'GitLab Machine Deploy Key Runbook'
type: 'chore'
created: '2026-08-27'
status: 'done'
route: 'one-shot'
---

# GitLab Machine Deploy Key Runbook

## Intent

**Problem:** NeoDove Engineering needs a repeatable, least-privilege process for giving each deployment machine access to a GitLab repository without sharing personal credentials or private keys between machines.

**Approach:** Extend the existing HTML runbook with a dedicated GitLab Deploy Key policy and copy-ready steps covering creation, GitLab registration, SSH selection, verification, rotation, revocation, and troubleshooting.

## Suggested Review Order

**Policy and terminology**

- Establishes one unique, least-privilege deploy key per machine access boundary.
  [`index.html:271`](../../neodove-engineering-docs/index.html#L271)

- Separates SSH Deploy Keys from HTTPS Deploy Tokens before operators configure GitLab.
  [`index.html:288`](../../neodove-engineering-docs/index.html#L288)

**Operational procedure**

- Creates keys as the deployment user with explicit passphrase and permission guidance.
  [`index.html:316`](../../neodove-engineering-docs/index.html#L316)

- Registers only the public key and defaults repository access to read-only.
  [`index.html:353`](../../neodove-engineering-docs/index.html#L353)

- Uses an SSH alias to bind this repository to its dedicated identity.
  [`index.html:369`](../../neodove-engineering-docs/index.html#L369)

- Verifies GitLab's host fingerprint and repository access before deployment.
  [`index.html:395`](../../neodove-engineering-docs/index.html#L395)

**Lifecycle and follow-up**

- Rotates without downtime and preserves a rollback path until validation succeeds.
  [`index.html:411`](../../neodove-engineering-docs/index.html#L411)

- Captures pre-existing PostgreSQL runbook risks without expanding this change's scope.
  [`deferred-work.md:1`](deferred-work.md#L1)
