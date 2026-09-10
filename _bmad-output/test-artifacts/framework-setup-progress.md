---
stepsCompleted: ['step-01-preflight', 'step-02-select-framework', 'step-03-scaffold-framework', 'step-04-docs-and-scripts', 'step-05-validate-and-summary']
lastStep: 'step-05-validate-and-summary'
lastSaved: '2026-08-24'
---

# Test Framework Setup Progress

## Step 1 — Preflight

- Detected stack: `mobile` with a separate Node.js backend surface.
- Client: Expo 54, React Native 0.81, React 19, Expo Router 6, TypeScript, Metro, NativeWind.
- Targets: web, Android, and iOS from the single `mobile/` application.
- Backend: Express 5, Prisma 6, SQLite in development, TypeScript executed with `tsx`.
- Existing E2E framework: none.
- Existing unit/component framework: none.
- Existing native-flow framework: none.
- Test architecture context: `README.md`, repository `AGENTS.md`, `server/index.ts`, `lib/run-act.ts`, `lib/api-v1-record.ts`, `mobile/app.json`, and both package manifests.
- Authentication: bearer JWT issued by `POST /api/v1/login`; role/permission enforcement is server-side and reflected in portal navigation.
- API convention: reads use `/api/v1/record` and `/api/v1/home`; authenticated writes use `/api/v1/act` with an `op` command.
- Preflight result: passed. The mobile/UI and backend layers require separate runners orchestrated by root scripts.

## Step 2 — Framework Selection

- Native device E2E: Maestro. It provides readable cross-platform flows for Expo/React Native on Android and iOS.
- Expo unit/component tests: Jest with the `jest-expo` preset and React Native Testing Library, matching Expo 54 and React 19 guidance.
- Browser E2E and visual regression: Playwright. The Expo app also ships to web, and Playwright covers authenticated portal journeys, desktop/phone viewports, screenshots, traces, and failure artifacts.
- Backend unit/integration tests: Vitest with V8 coverage and Supertest against the exported Express app.
- Persistence: isolated temporary SQLite test databases; tests must never mutate `prisma/dev.db`.
- Coverage policy: 95% thresholds for statements, branches, functions, and lines in meaningful unit/component-test scope. UI confidence is measured separately through portal-route and critical-journey coverage rather than interpreting line coverage as visual correctness.
- Selection result: Maestro + Jest Expo + React Native Testing Library + Playwright + Vitest/Supertest, orchestrated by root npm scripts.

## Step 3 — Framework Scaffolding

- Execution mode resolved to agent-team; independent configuration, API-test, and UI-flow work units were integrated and revalidated together.
- Root orchestration: type checks for server/mobile/tests, Vitest unit/API commands, Jest Expo component commands, Playwright P0/full/visual commands, Maestro P0/full commands, coverage commands, web export, and pre-push verification scripts.
- Backend: `vitest.config.ts`, V8 coverage/reporters, Supertest integration tests, JWT and permission unit tests, deterministic factories, and isolated SQLite helpers.
- Expo component layer: `mobile/jest.config.js`, `mobile/jest.setup.ts`, React Native Testing Library, JUnit/HTML/LCOV/Cobertura coverage outputs, and representative accessible-control tests.
- Browser layer: `playwright.config.ts`, Chromium/WebKit desktop/phone projects, traces/screenshots/videos on failure, HTML/JUnit/JSON reports, exact visual snapshots, and an axe-core accessibility check.
- Browser data isolation: tests use ports 8082/4100, copy only the schema from `prisma/dev.db` into an ignored test database, erase every copied table, and seed a deterministic four-portal graph. Development data is never opened for writes.
- Native layer: `.maestro/config.yaml`, four P0 role-login journeys, a reusable login subflow, environment-provided credentials, and stable test IDs. Maestro YAML parses; native device execution remains pending because the CLI is not installed.
- Sample coverage: Office, Teacher, Parent, and Student authentication and portal routing, login accessibility, responsive visual baseline, API health/auth/session/records, JWT behavior, permission boundaries, and shared Expo controls.
- Contract testing gate: Pact was not scaffolded because the Expo client and Express API are a same-repository application boundary, not an independently deployed consumer/provider contract.
- Playwright utility package gate: the mobile workflow uses plain Playwright for the Expo web target; no separate utility package was required.
- Validation at scaffold completion: TypeScript passed; Vitest 25/25 passed; Jest 2/2 passed; Playwright P0 15/15 passed; visual snapshots 3/3 passed during baseline generation.

## Step 4 — Documentation and Scripts

- Added `tests/README.md` with Node/database/browser/device setup, fast and strict gates, headed/debug modes, framework architecture, selector/isolation/cleanup rules, CI sequencing, report locations, and TEA knowledge references.
- Added the mobile-workflow command names required by the framework: `test:unit`, `test:flows`, `test:flows:p0`, and `maestro:studio`; preserved `test:native*` as compatibility aliases.
- Kept native device flows outside default `npm test`; they require a booted simulator/emulator and an installed release-shaped build.
- Configured Vitest and Playwright to load optional ignored `.env.test` values without overriding CI-provided environment variables.
- Write-time hook: intentionally skipped because this work is running in Codex, which has no supported project interception hook. The documentation directs contributors to `bmad-testarch-test-review` for enforcement.

## Step 5 — Validation and Completion Summary

### Checklist validation

- Preflight, manifest, architecture, stack selection, directory, permission, environment, script, documentation, and dependency checks passed.
- Vitest, Jest Expo, Playwright, and Maestro YAML configuration files load/parse successfully; server/mobile/test TypeScript passes.
- Isolated database support, deterministic factories, account fixtures, browser auth helpers, responsive baselines, stable selectors, and automatic cleanup are present.
- Test-quality scan found no `.only`, `.skip`, fixed waits, sleeps, TODOs, or FIXMEs in executable test/flow files.
- Required HTML/JUnit/JSON/LCOV/Cobertura report outputs were generated at their documented locations.
- `expo-document-picker` was aligned from an incompatible major to Expo SDK 54's supported `~14.0.8`; Expo's dependency check now reports dependencies up to date.
- Deliberate checklist deviations: the SQLite/Prisma suites run serially to protect data isolation; simple functional helpers are used instead of page objects; fixed deterministic school data is used instead of random faker output; Playwright utilities and Pact were not applicable to the selected mobile same-repository boundary.

### Execution evidence

- `npm run verify:quick`: passed on Node 20, including all TypeScript projects, Vitest, Jest Expo, and Expo web export.
- `npm run verify:pr`: added as the current green pre-push composition of `verify:quick` plus the full Playwright matrix; both constituent gates passed on the final workspace state.
- Vitest/Supertest: 3 files, 25/25 tests passed.
- Jest Expo/React Native Testing Library: 1 file, 2/2 tests passed.
- Playwright full matrix: 18/18 passed across desktop Chromium, Pixel-sized Chromium, and iPhone WebKit; includes four portal logins, axe accessibility, and exact reviewed visual comparisons.
- Maestro: all configuration and flow YAML parsed; native execution was not attempted because the Maestro CLI, booted device, and installed release-shaped build are not available in this workspace.

### Honest 95% gate status

- Server: statements 17.94%, branches 13.20%, functions 25.99%, lines 19.27%.
- Mobile: statements 0.09%, branches 0.23%, functions 0.14%, lines 0.11%.
- Both runners enforce 95% for all four metrics. `npm run test:coverage` and therefore `npm run verify` correctly fail today. The threshold has not been weakened and production files have not been hidden from measurement.

### Completion

- Framework setup is complete: Maestro + Jest Expo/RNTL + Playwright/Axe + Vitest/Supertest, with isolated SQLite data, deterministic role coverage, visual baselines, reports, and documented npm gates.
- The next engineering phase is test automation expansion, prioritizing `core-actions.ts`, `core-office.ts`, payment/fees/leave paths, Expo session/API/storage logic, and the large portal boards before adding lower-risk presentation tests.
- Knowledge applied: mobile test strategy, Maestro flow design, release-shaped device-lab guidance, test-level boundaries, P0-P3 prioritization, network-first synchronization, deterministic isolation, and test-quality constraints.
