# Anekio deployment runbook

This is the release guide for the web application and Android app. Release only from a clean, committed `main` branch. Staging is deployed separately from the `staging` branch.

## Before any production release

1. Create or update the relevant Jira ticket and record the verification plan.
2. Confirm the working tree is clean and the intended commit is on `main`:

   ```bash
   git status --short
   git branch --show-current
   git log -1 --oneline
   ```

3. Run local checks:

   ```bash
   npm run typecheck
   npm run build:web
   ```

4. Push the commit:

   ```bash
   git push origin main
   ```

Do not run `npm run db:seed` or `npm run db:reset` against production. Both are destructive.

## Production web deployment (Vercel)

The production release is an Expo web export plus the Express API bundled as a Vercel function. Run this from the repository root:

```bash
npm run deploy:production
```

It runs, in order:

```bash
npm run typecheck
npm run build:web
npx vercel deploy --prod
```

The command prints a Vercel deployment URL. Wait until it is **Ready**, then check the live health endpoint with the authenticated Vercel CLI:

```bash
npx vercel inspect <deployment-url>
npx vercel curl <deployment-url>/health
```

A healthy response is `{"ok":true}`.

### Required production environment variables

Configure production values in **Vercel Project Settings → Environment Variables**. Never put secrets in this file, `.env`, or Git.

- `DATABASE_URL` — production Neon/Postgres connection string
- `JWT_SECRET`
- `ANEKIO_AUTH_SECRET`
- `ANEKIO_AUTH_RESEND_API_KEY` and `ANEKIO_AUTH_FROM_EMAIL` when email auth is enabled
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` when Google admin login is enabled
- `CRON_SECRET` for scheduled requests
- S3 configuration when uploads use S3: `UPLOADS_DRIVER=s3`, `AWS_REGION`, `AWS_ROLE_ARN`, `AWS_S3_PRIVATE_BUCKET`, and `AWS_S3_PUBLIC_BUCKET`

The Vercel build runs `scripts/vercel-prisma.mjs`. With a Postgres `DATABASE_URL`, it generates a Postgres Prisma client. It only changes the production schema when `ANEKIO_DB_PUSH_ON_BUILD=1` is configured. Enable that only for an intentional, reviewed schema release; never set `ANEKIO_DB_PUSH_ACCEPT_DATA_LOSS=1` unless data loss was explicitly approved. Do not set `ANEKIO_SEED_ON_BUILD=1` in production.

### Rollback

In the Vercel dashboard, open **Deployments**, find the last known-good production deployment, and use **Promote to Production**. Verify `/health` again afterwards. If the release included a schema change, assess database compatibility before rolling the application back.

## Staging web deployment

Staging is isolated from production and its script only runs on the `staging` branch:

```bash
git switch staging
git pull --ff-only origin staging
npm run deploy:staging
```

Do not use staging credentials or its database URL in production builds.

## Android production `.aab` build

Android release builds use Expo Application Services (EAS). The production EAS profile in [`mobile/eas.json`](mobile/eas.json) has `android.buildType: "app-bundle"`, so it produces an Android App Bundle (`.aab`) for Google Play—not an APK.

### One-time setup

1. Install and authenticate EAS CLI:

   ```bash
   npm install --global eas-cli
   eas login
   ```

2. Ensure the Expo account can access the project ID in [`mobile/app.json`](mobile/app.json).
3. Set the **production** EAS environment value `EXPO_PUBLIC_API_URL=https://app.anekio.com` (or the current production app URL). Native apps cannot rely on the web app's same-origin API behaviour; without this value they can fall back to a local development address.

   ```bash
   cd mobile
   eas env:create --name EXPO_PUBLIC_API_URL --value https://app.anekio.com --environment production --visibility plaintext
   ```

   This URL is public build configuration, not a secret. Do not add database, JWT, payment, or email keys to EAS build variables.

### Build the AAB

From the repository root:

```bash
cd mobile
npx eas-cli build --platform android --profile production
```

EAS uploads the source and builds remotely. The CLI prints a build URL; wait for it to finish, then download the `.aab` from that page or submit it to Google Play:

```bash
npx eas-cli submit --platform android --profile production
```

Before submitting, increment the app version/build number according to the Expo/EAS versioning policy (`mobile/eas.json` uses `appVersionSource: remote`) and test the AAB through an internal testing track in Google Play.

### Internal APK for testers

The preview profile makes an installable APK, not an AAB:

```bash
npm run build-apk
```

It currently points to the preview API URL configured in `mobile/eas.json`. Use this for internal testers only, not the Play Store.

## After release

1. Verify the production health endpoint.
2. Sign in with an appropriate non-production test account and check the released workflow.
3. Record the deployed commit, Vercel/EAS build URL, and verification result on the Jira ticket.
