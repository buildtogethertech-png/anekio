# Anekio

India-first education product built around student strength — not marks-as-the-goal.

One Expo app (web, Android, iOS). One Express API. Four portals (parent, teacher, office, student).

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

## Project changes

Use the Jira-first workflow in [`docs/jira-change-workflow.md`](docs/jira-change-workflow.md).

For every code change, create or identify a Jira ticket first, document the plan there, make the change, update the ticket with verification notes, then commit with the Jira ticket key in the commit message.
