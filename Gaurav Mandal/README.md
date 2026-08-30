# Cultivate

India-first education product. Cultivates student strength — not marks-as-the-goal.

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

Every demo login uses password `12345`. See `Cultivate-demo-logins.json`.

## Project changes

Use the Jira-first workflow in [`docs/jira-change-workflow.md`](docs/jira-change-workflow.md).

Do not use BMad for this project. For every code change, create or identify a Jira ticket first, document the plan there, make the change, update the ticket with verification notes, then commit with the Jira ticket key in the commit message.
