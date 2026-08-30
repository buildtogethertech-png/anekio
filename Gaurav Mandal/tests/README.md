# Anekio test framework

Anekio uses four complementary test layers. Vitest and Supertest protect the Express/Prisma rules and API, Jest Expo with React Native Testing Library protects components, Playwright protects the Expo web journeys and visual output, and Maestro protects installed Android/iOS builds.

The configured coverage threshold is 95% for statements, branches, functions, and lines. That is an enforcement target, not a claim that the current application already has 95% coverage. `npm run test:coverage` fails until both measured layers earn every threshold.

## Setup

Use the Node version declared in `.nvmrc` and `package.json`:

```bash
nvm use
npm install
npm --prefix mobile install
npx playwright install chromium webkit
```

The API and browser fixtures use `prisma/dev.db` as a read-only schema template. Initialize it once on a clean checkout:

```bash
npx prisma db push
npm run db:seed
```

Optional local overrides can be copied from `.env.test.example` to the ignored `.env.test`. The test configs load that file without overriding variables already supplied by CI. Never point `TEST_DATABASE_URL` at `prisma/dev.db`, `prisma/demo.db`, staging, or production.

Maestro additionally needs its CLI, a booted simulator/emulator, and an installed release-shaped Anekio build. Do not use Expo Go for the device suite. Provide the four `ANEKIO_*_LOGIN` and `ANEKIO_*_PASSWORD` values through the shell or CI secret store.

## Commands

Fast local gate:

```bash
npm run verify:quick
```

This runs server, mobile, and test TypeScript checks; all Vitest and Jest tests; and the Expo web export. It does not claim coverage or device confidence.

Current pull-request gate, including the full browser matrix:

```bash
npm run verify:pr
```

This is the best green pre-push command while the repository is building toward 95%: it combines `verify:quick` with Playwright authentication, accessibility, responsive, and visual checks.

Strict pre-push gate:

```bash
npm run verify
```

This requires the 95% Vitest/Jest coverage gates, the full Playwright matrix, and a production web export. While coverage is below 95%, failure is intentional and blocks the push.

Individual layers:

```bash
npm test                       # Vitest + Jest Expo

npm run test:server            # Vitest unit + Supertest API
npm run test:mobile            # Jest Expo component tests
npm run test:coverage          # both strict 95% coverage gates
npm run test:e2e:p0            # critical login, accessibility, and portal visuals
npm run test:e2e               # full browser and visual suite
npm run test:visual:p0         # compare 12 critical portal screens in all browsers
npm run test:visual            # compare all 135 approved screenshots
npm run test:flows:p0          # P0 native Maestro flows
npm run test:flows             # full native Maestro suite
```

Interactive and debug modes:

```bash
npm run test:server:ui
npm --prefix mobile run test:watch
npm run test:e2e:headed
npm run test:e2e:ui
PWDEBUG=1 npm run test:e2e
npm run maestro:studio
```

Only run `npm run test:visual:update` after visually reviewing an intentional UI change. Updated PNGs are the new approval contract and belong in the same change as the UI.

The authenticated visual matrix covers 44 role/screen combinations in desktop Chromium, Android-sized Chromium, and iPhone WebKit: 132 portal images plus three login images. It includes every permission-reachable stable base screen for Office, Teacher, Parent, and Student. Parameterized payment WebViews and currently unreachable/broken Profile or Uploads routes are not approved as expected UI.

On a passing run, every visual case attaches both `expected-*` and `actual-*` images to the HTML report. On failure, Playwright additionally provides the received image and pixel diff. Open `playwright-report/index.html`, select a visual case, and expand Attachments to see the images side by side.

## Architecture

- `tests/unit/` contains pure policy and utility tests.
- `tests/api/` uses Supertest against the exported Express app.
- `tests/support/test-database.ts` copies the SQLite schema to a dedicated test file, clears every table in the copy, and cleans temporary Vitest files.
- `tests/support/factories.ts` creates the minimum deterministic school graph for Office, Teacher, Parent, and Student behavior.
- `tests/support/start-e2e-server.ts` creates a clean ignored Playwright database, seeds it, and starts Express on the isolated test port.
- `tests/e2e/fixtures/` contains non-production account defaults with CI environment overrides.
- `tests/e2e/fixtures/visual-screens.ts` is the reviewed Office/Teacher/Parent/Student screen contract and priority map.
- `tests/e2e/helpers/` owns reusable browser actions and assertions. Response waiters are registered before navigation or clicks to avoid races; the visual helper authenticates through the isolated API and freezes browser time.
- `tests/e2e/__screenshots__/` contains reviewed desktop Chrome, Android-sized Chrome, and iPhone WebKit baselines.
- `mobile/components/__tests__/` contains React Native component tests.
- `.maestro/` contains release-shaped device journeys; `.maestro/subflows/` is excluded from direct discovery.

Playwright uses ports 8082 and 4100 so it can run beside the normal Metro `:8081` and API `:4000` processes. Vitest and Playwright run database-backed suites serially because each suite uses one Prisma singleton and one SQLite fixture. The isolated E2E server and visual browser are fixed at 24 August 2026 so calendar-sensitive desks, attendance, and fees do not change merely because the suite is run later.

## Test-writing rules

- Prefer accessible roles, labels, and stable `testID` values. Do not select styling classes or fragile view ancestry.
- Keep UI journeys user-visible: API requests may prepare data, but assertions must verify rendered outcomes.
- Register network/event waiters before the action that triggers them. Do not use fixed sleeps, `waitForTimeout`, or arbitrary retries.
- Every database suite must use the isolated helpers. Never import the Prisma singleton before setting the test database URL.
- Use deterministic factories and explicit dates. Never use real school credentials, payment keys, push tokens, or messaging keys.
- Keep P0 flows short and independent. Each Maestro flow clears state, launches the installed app, and asserts its destination.
- Never commit `.only`; CI also enables Playwright `forbidOnly`.
- Treat line coverage, responsive visual checks, accessibility scans, and native journeys as separate evidence. One percentage cannot replace the others.

Codex does not currently expose a project write-time interception hook, so the TEA write hook is intentionally not installed. Run `bmad-testarch-test-review` for post-write enforcement of the test-quality criteria.

## Reports

- Vitest execution: `test-results/vitest/index.html`, `junit.xml`, and `results.json`.
- Server coverage: `coverage/server/index.html`, LCOV, Cobertura, and JSON summary.
- Jest execution: `test-results/jest/junit.xml`.
- Mobile coverage: `mobile/coverage/index.html`, LCOV, Cobertura, and JSON summary.
- Playwright execution: `playwright-report/index.html`, plus JUnit/JSON and failure artifacts under `test-results/playwright/`.
- Playwright failures retain traces, screenshots, and video for functional cases. Portal visual cases disable redundant video but retain actual/expected/diff images and traces. Open a trace with `npx playwright show-trace <trace.zip>`.

## CI integration

Use Node 20 and cache the root/mobile npm downloads and Playwright browsers. A practical pipeline is:

1. Install root and mobile dependencies with lockfiles.
2. Initialize and seed the read-only schema-template database.
3. Run `npm run verify:quick` for every pull request.
4. Run `npm run test:e2e:p0` as the browser P0 gate.
5. Run `npm run verify` once the repository reaches the configured 95% thresholds.
6. Run `npm run test:flows:p0` on a device-lab job with an installed preview build; native flows are deliberately not part of default `npm test`.
7. Upload `coverage/`, `mobile/coverage/`, `playwright-report/`, and `test-results/` even when a job fails.

Give each parallel database job its own `TEST_DATABASE_URL`. Do not shard the SQLite browser suite until each shard also has independent accounts and a unique database.

## Troubleshooting

- **Playwright reports Node 18:** run `nvm use`; Playwright and Vitest in this repository require the declared Node 20 runtime.
- **Port 8082 or 4100 is occupied:** stop the conflicting test process or set a matching `PLAYWRIGHT_BASE_URL`, `PLAYWRIGHT_API_PORT`, and `PLAYWRIGHT_WEB_COMMAND` in `.env.test`. Normal development ports 8081/4000 can remain active.
- **The schema template is missing:** run `npx prisma db push` and `npm run db:seed` once, then retry. Tests copy and empty this file; they never modify it.
- **A visual test differs intentionally:** inspect the received/diff images in `test-results/playwright/`, run the headed test, then use `npm run test:visual:update` and review every changed PNG.
- **Maestro cannot find an element:** confirm the installed build matches the current source and inspect IDs with `npm run maestro:studio`; Expo Go is unsupported for these flows.
- **Coverage exits non-zero while tests pass:** open both HTML coverage reports. The strict 95% thresholds are working as designed; add meaningful branch and behavior tests rather than excluding production files.

## Knowledge references

The framework follows the repository TEA guidance in `mobile-test-strategy.md`, `maestro-flows.md`, `mobile-ci-device-lab.md`, `test-levels-framework.md`, `test-priorities-matrix.md`, and `test-quality.md`. Use those with the installed `bmad-testarch-framework`, `bmad-testarch-automate`, `bmad-testarch-test-review`, and `bmad-testarch-ci` skills when expanding the suite.
