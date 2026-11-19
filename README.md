# Anekio

India-first education product built around student strength — not marks-as-the-goal.

One Expo app (web, Android, iOS). One Express API. Four portals (parent, teacher, office, student).

For external provider accounts, configuration locations, and quarterly ownership checks, see [README-SERVICES.md](README-SERVICES.md).

## Run

For a new local machine:

```bash
npm run setup
```

`npm run serup` is also available as a typo-friendly alias.

Two processes:

```bash
npm run api
```

In another terminal:

```bash
npm run app
```

API: [http://localhost:4000](http://localhost:4000). App: Expo on [http://localhost:8081](http://localhost:8081).

Local domain routes:

```text
http://localhost:4000/          Anekio marketing page
http://app.localhost:4000/      ERP app shell
http://admin.localhost:4000/    admin portal
```

During local development and tests, the internal SaaS admin accepts an allowed
email with the existing demo password (`12345`). Override it locally with
`ANEKIO_ADMIN_DEV_PASSWORD`. This password login is disabled automatically in
production.

Production uses Google sign-in and fails closed until `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are configured. Register the callback URL for the route
you use:

```text
http://admin.localhost:4000/auth/google/callback
http://localhost:4000/anekio-admin/auth/google/callback
```

Production uses the same `/auth/google/callback` path on the admin host. Access
is built in for the exact `buildtogether.tech@gmail.com` account and exact
`anekio.com` / `anekio.in` domains; optional additive allowlists are documented
in `.env.example`.

## Staging

The isolated Vercel staging project is `anekio-staging`. Its hostname mapping is:

```text
https://staging.anekio.com                   Anekio marketing page
https://app.staging.anekio.com               ERP app shell
https://admin.staging.anekio.com             admin portal
https://<school>.staging.anekio.com          school website
```

Deploy the current checkout to that project with:

```bash
npm run deploy-staging
```

The staging deploy script only runs from the `staging` branch and always targets
the isolated `anekio-staging` Vercel project. `npm run deploy:staging` remains
as a compatibility alias.

Every demo login uses password `12345`. See `Anekio-demo-logins.json`.

## Prisma ERD

Regenerate the domain-split Prisma relation diagrams from `prisma/schema.prisma`:

```bash
npm run erd:prisma
```

Open the generated HTML:

```bash
open /private/tmp/anekio-prisma-erd/anekio-prisma-erd.html
```

The HTML uses Mermaid from CDN, so the browser needs internet access to render
the diagrams. The generated Mermaid source files are written beside the HTML in
`/private/tmp/anekio-prisma-erd/`.

## Project changes

Use the Jira-first workflow in [`docs/jira-change-workflow.md`](docs/jira-change-workflow.md).

For every code change, create or identify a Jira ticket first, document the plan there, make the change, update the ticket with verification notes, then commit with the Jira ticket key in the commit message.

## Hosting: AWS Mumbai (moved 5 Nov 2026)

Anekio moved off Vercel + Neon onto AWS Mumbai (`ap-south-1`). All school data was copied and checked table by table.

- **Why:** the API ran in the US (Virginia) and the database in Ohio; Neon also paused when idle (~14 s cold start). Login now takes ~0.09 s (was 0.25 s, or ~14 s after idle).
- **Data:** stays in India on an encrypted database that is not reachable from the internet.
- **Monitoring:** `monitoring.anekio.com` (server/DB health, traffic, errors, per-school activity). 8 email alerts go to support@anekio.com (server/DB down, error spikes, disk/memory/CPU/storage). Admin → Usage shows active users per school.
- **Domains:** `anekio.in` redirects to `anekio.com`; one auto-renewing SSL certificate covers all school subdomains.
- **Cost:** about ₹3,300/month incl. GST; AWS credits cover roughly the first 4 months.
- **Deploys are manual:** pushing to GitHub does not deploy. Ship with `npm run deploy:prod` (`bash deploy/push.sh`, no downtime). Phone OTA: `npm run update:prod -- "message"`.
- **Logs:** `bash deploy/logs.sh` (or `errors`, `slow`, `usage`). Server keeps 3 days; Grafana keeps 14.
- **Staging is offline:** it lived on Vercel, so staging/preview app builds won't connect until it is set up again.
- **Still to do:** delete the old Neon database once stable; upgrade the AWS account from the Free plan before **4 March 2027**; decide whether staging is needed.

Setup, scripts and runbook: [`deploy/README.md`](deploy/README.md).
