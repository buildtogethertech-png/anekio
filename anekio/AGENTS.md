<!-- bmad:context -->
<!-- Verified 2026-08-22 against uncommitted working tree (no project git SHA). Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## Anekio

India-first school product: office, teacher, parent, student. One Expo app (web, Android, iOS) and one Express API. How to run is in `README.md`. Planning and test artifacts go in `_bmad-output/`.

## Policy

- Do not add Next.js, NextAuth, or `/admin/reports` pages — UI is Expo only; API is Express. Leftover `.next/` and `NEXTAUTH_*` names are migration aliases, not the stack.
- Do not put payment gateway keys in `.env` or commit them — they live per school in Admin → School (`SchoolConfig`). `CRON_SECRET` is the env exception.

## Where things are

- API entry: `server/index.ts`. Writes: `POST /api/v1/act` → `lib/run-act.ts` → `lib/core-actions.ts` / `lib/core-office.ts`. Reads: `GET /api/v1/record` → `lib/api-v1-record.ts`.
- Expo screens: `mobile/app/(app)/` → `mobile/components/portal-body.tsx`. Route by nav `key` in `mobile/lib/paths.ts`, not `href` in `lib/nav.ts`.
- Office phone tabs: `mobile/lib/nav-icons.ts`. Sidebar catalog: `lib/nav.ts`. Roles catalog: `lib/permissions.ts` — add a permission before a new screen.
- Public pay/invoice HTML: `server/pay-html.ts` + `lib/pay-public.ts` (not `lib/data.ts`).
- Schema: `prisma/schema.prisma` (`db push`, no migrations). Seed overwrites `Anekio-demo-logins.json` and `.csv`.

## Running and verifying

- App JSON goes through Metro `:8081` (`mobile/metro.config.js` proxies `/api`, `/pay`, `/i` to `:4000`). `EXPO_PUBLIC_API_URL` values ending in `:4000` or `:3000` are rewritten to `:8081`.
- Pay/invoice links must hit Express (`webOrigin` maps `:8081` → `:4000`), not the Metro host.
- There is no `test` script and no CI — do not invent `npm test`. Probe the API with `GET /health` on `:4000`, not `/api/health`.
- After a Prisma schema change, restart `npm run api` — `lib/prisma.ts` caches the client.

## Conventions that differ from defaults

- New writes are a new `op` on `/api/v1/act`, not a new REST route.
- Express 5 file route is `/api/files/*rel`. Do not add `app.options("*")`.
- Office phone tabs stay Desk · People · Staff · Fees · More. Notices is the header bell and More — do not put it back on the office bar. Teacher phone tabs stay Desk · Attendance · Class · Exams · More. Leave is More only. Keep `lib/nav.ts`, `mobile/lib/nav-icons.ts`, and `mobile/components/office-boards.tsx` aligned.
- Root `tsconfig.json` excludes `mobile/`. Mobile must not import root `lib/`.
- Ignore `href` values like `/admin/reports/...` in `lib/nav.ts` — they are leftover and unused.

## Known pitfalls

- Agents have treated this as Next.js on `:3000` because of leftover `.next/`, `NEXTAUTH_*`, and those `href`s. Do not restore that stack.
- Do not hand-edit `Anekio-demo-logins.*` or `mobile/.expo/types/router.d.ts`.

<!-- /bmad:context -->

## Project change workflow

- Do not use BMad for this project, even if BMad skills or files are present.
- For every requested project change, create or identify a Jira ticket before changing code.
- Document the planned change in Jira first: goal, affected area, acceptance notes, and verification plan.
- Make code changes only after the Jira ticket exists.
- After the change, update the Jira ticket with what changed and how it was verified.
- Commit the change with the Jira ticket key in the commit message, for example `KAN-123: Fix leave creation`.
- If the user asks for a change without a Jira ticket key, ask for the ticket key or offer to create one before editing.
