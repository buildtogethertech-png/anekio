# Anekio external services

This is the operational inventory of services outside this repository. Use it to check account ownership, billing, production configuration, and renewal dates.

Never put API keys, OAuth secrets, webhook secrets, database URLs, or private keys in this document, Git, Expo public environment variables, or screenshots.

## At a glance

| Service | What Anekio uses it for | Where it is configured | Required? |
| --- | --- | --- | --- |
| Vercel | Web app and Express API hosting | Vercel project settings | Hosted web/API |
| Managed Postgres / Neon | Production database | `DATABASE_URL` in Vercel | Production |
| Expo + EAS | Native builds and push notifications | Expo account and `mobile/` config | Native releases/push |
| Google Cloud | Google sign-in and optional Sheets onboarding | Google Cloud + env variables | Optional |
| Resend | Auth and transactional email | Server env or admin communication settings | Optional per email flow |
| Wakit | WhatsApp login OTP | Server `WAKIT_*` variables | Optional mobile OTP |
| Renflair | SMS fallback for unavailable WhatsApp numbers | Server `RENFLAIR_API_KEY` | Optional; paired with Wakit |
| Razorpay | Fee and Anekio subscription payments | School settings or SaaS env | Optional payments |
| Cashfree | Alternative fee payment gateway | School payment settings | Optional per school |
| AiSensy | WhatsApp fee reminders/payment links | School communication settings | Optional per school |
| AWS S3 + IAM | Hosted file uploads | Server `AWS_*` variables | Optional uploads |
| Zoho Mail | Human support/reply inboxes | Zoho Admin Console and DNS | Operational only |

## Service details

### Vercel

- **Purpose:** Hosts production/staging web exports and the Express API.
- **Configuration:** Vercel Project Settings → Environment Variables. See [README-DEPLOYMENT.md](README-DEPLOYMENT.md).
- **Check:** Production `/health` responds after deploy; intended branch/environment is selected.
- **Record:** Account owner, billing owner, and project admins.

### Managed Postgres / Neon

- **Purpose:** Stores production data through Prisma.
- **Configuration:** Server `DATABASE_URL`; local development can use SQLite.
- **Check:** Backup/retention, database access, and production target before schema releases.
- **Important:** The database URL is a secret; never put it in Expo/EAS variables.

### Expo and EAS

- **Purpose:** Android/iOS builds, native development builds, and Expo push notifications.
- **Configuration:** Expo account `@buildtogether`, [`mobile/app.json`](mobile/app.json), and [`mobile/eas.json`](mobile/eas.json).
- **Check:** Account access, EAS credentials, and API URL for every build profile.
- **Important:** Only intentionally public `EXPO_PUBLIC_*` values belong in EAS build configuration.

### Google Cloud

- **Purpose:** Google sign-in and optional Google Drive/Sheets onboarding import.
- **Configuration:** OAuth clients plus `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MOBILE_ALLOWED_AUDIENCES`, and optional `GOOGLE_DRIVE_*` server variables. Mobile uses public `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` values.
- **Check:** Consent screen, authorised origins/redirects, Android package `in.anekio.school`, and signing SHA-1.
- **Important:** Client IDs are public; client secrets are server-only.

### Resend

- **Purpose:** Login email OTPs, password resets, school fee/payment emails, and public demo/trial emails.
- **Configuration:**
  - Login/auth: `ANEKIO_AUTH_RESEND_API_KEY` and `ANEKIO_AUTH_FROM_EMAIL` on the server.
  - School communication: Admin → School → Communication.
  - Public Anekio email: Anekio Admin → Email delivery.
- **Check:** Sender domain has SPF, DKIM, and DMARC; sender addresses and delivery logs are healthy.
- **Important:** Resend sends outbound mail. Zoho can receive replies; it is not used as a sending API by the app.

### Wakit (WhatsApp OTP)

- **Purpose:** First mobile login OTP delivery attempt.
- **Configuration:** Server-only `WAKIT_TOKEN`; optional `WAKIT_OTP_TEMPLATE` and `WAKIT_OTP_LANGUAGE`.
- **Check:** Approved template/language match Wakit and a test number receives the code.
- **Fallback:** When Wakit explicitly says the number is unavailable on WhatsApp, Anekio sends the same code through Renflair SMS.

### Renflair (SMS OTP fallback)

- **Purpose:** SMS fallback only when Wakit reports the registered number is unavailable on WhatsApp.
- **Configuration:** Server-only `RENFLAIR_API_KEY`.
- **Check:** Use an approved own/test Indian number and confirm the provider accepts its 10-digit mobile format.
- **Important:** Anekio does not fall back after generic Wakit outages, rate limits, or auth errors, avoiding duplicate provider charges/codes.

### Razorpay

- **Purpose:** School fee checkout and Anekio subscription checkout.
- **Configuration:** School fee keys live in Admin → School → Payment gateway. Anekio subscription keys use `ANEKIO_RAZORPAY_KEY_ID` and `ANEKIO_RAZORPAY_KEY_SECRET` server variables.
- **Check:** Test/live mode, webhook URL/signature, settlement details, and one controlled payment test.
- **Important:** Payment secrets never belong in mobile environment variables.

### Cashfree

- **Purpose:** Alternative school fee checkout.
- **Configuration:** Admin → School → Payment gateway; App ID and secret are scoped to each school.
- **Check:** Test/live mode, webhook signature, and one controlled payment test.

### AiSensy

- **Purpose:** School WhatsApp campaigns, including fee reminders and payment links.
- **Configuration:** Admin → School → Communication (`aisensyApiKey` and campaign name).
- **Check:** Approved campaign/template, sender approval, and a test recipient.

### AWS S3 and IAM

- **Purpose:** Optional private and public uploads in hosted environments.
- **Configuration:** `UPLOADS_DRIVER=s3`, `AWS_REGION`, `AWS_ROLE_ARN`, `AWS_S3_PRIVATE_BUCKET`, and `AWS_S3_PUBLIC_BUCKET` on the server.
- **Check:** Least-privilege IAM, bucket policies, CORS if needed, and private/public upload smoke tests.
- **Local behavior:** Uploads default to local disk with `UPLOADS_DRIVER=local`.

### Zoho Mail

- **Purpose:** Human-operated custom-domain support/reply inboxes.
- **Configuration:** Zoho Admin Console and domain DNS/MX records.
- **Check:** Super-admin ownership, domain verification, MX/SPF/DKIM/DMARC, and access to support inboxes.
- **Important:** Zoho is not currently called by app code; manage its DNS/email settings separately from Resend sending configuration.

## Quarterly owner checklist

1. Confirm every account’s owner, billing contact, and recovery email.
2. Remove former team members and rotate compromised/replaced credentials.
3. Verify email DNS authentication and payment webhooks.
4. Test one non-production auth email OTP, WhatsApp OTP, SMS fallback, payment, upload, and push notification where enabled.
5. Review invoices, usage limits, renewal dates, and alert thresholds.

## Not external application services

Prisma, Expo Router, Express, React Native, and the other npm packages are repository dependencies. They do not require a separate production service account merely to run Anekio.
