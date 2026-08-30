---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-identify-targets', 'step-03c-aggregate', 'step-04-validate-and-summarize']
lastStep: 'step-04-validate-and-summarize'
lastSaved: '2026-08-24'
inputDocuments:
  - playwright.config.ts
  - package.json
  - mobile/package.json
  - mobile/jest.config.js
  - tests/e2e/accessibility.spec.ts
  - tests/e2e/auth.spec.ts
  - tests/e2e/visual.spec.ts
  - tests/e2e/fixtures/accounts.ts
  - tests/e2e/helpers/login.ts
  - tests/support/start-e2e-server.ts
  - _bmad-output/test-artifacts/framework-setup-progress.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/library-integration-mandate.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/playwright-utils-mandate.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/mobile-test-strategy.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/maestro-flows.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/mobile-ci-device-lab.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/test-levels-framework.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/test-priorities-matrix.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/data-factories.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/selective-testing.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/ci-burn-in.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/test-quality.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/overview.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/api-request.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/auth-session.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/recurse.md
  - .agents/skills/bmad-testarch-automate/resources/knowledge/playwright-cli.md
---

# Automation Expansion Summary

## Step 1 — Preflight and Context

- Detected stack: `mobile`, because this repository contains an Expo application and a configured `.maestro/` native-flow directory. The same repository also owns the Express API tested through Vitest/Supertest and Playwright setup.
- Execution mode: Standalone. No story, technical specification, or feature test-design artifact was supplied; the target is the existing reachable UI described by source code and current tests.
- Framework readiness: passed. `.maestro/`, `mobile/jest.config.js`, `playwright.config.ts`, and the required test dependencies are present.
- Execution constraint: Maestro is not available on `PATH`, so native flows can be generated but cannot be executed in this environment. The requested visual expansion targets the Expo web surface through Playwright and is executable here.
- Existing coverage: four role-login journeys, login accessibility, and one login-screen visual baseline across desktop Chromium, phone Chromium, and phone WebKit. The gap is authenticated portal-screen visual coverage.
- Isolation: Playwright recreates a dedicated test SQLite database and seeds deterministic Office, Teacher, Parent, and Student accounts before browser execution.
- Playwright Utils gate: configuration enables the preference, but `@seontechnologies/playwright-utils` is not installed, so the mandate's two-gate rule leaves this run on the existing vanilla Playwright framework. No package migration is introduced during coverage expansion.
- Pact gate: contract automation is not relevant to this same-repository Expo/Express boundary, and no Pact indicators exist. No Pact artifacts are planned.
- Browser automation: Playwright CLI guidance applies; browser tests use semantic/test-id locators, deterministic response or visible-state waits, no fixed sleeps, exact screenshot comparisons, and failure traces/screenshots/videos.
- Knowledge applied: mobile test-layer selection, Maestro/device-lab constraints, P0-P3 prioritization, deterministic factories, selective execution, CI burn-in, test-quality rules, Playwright HTTP/auth helpers, and recursive async handling.

## Step 2 — Automation Targets and Coverage Plan

### Navigation and testability findings

- Expo Router exposes 22 authenticated route files under `mobile/app/(app)/`: 20 content/menu routes plus `notifications` and the parameterized `pay` surface.
- The permission-filtered navigation produces 36 role-specific primary screen instances: Office 9, Teacher 7, Parent 10, and Student 10.
- `more` and `notifications` are reachable for every portal, bringing the stable authenticated visual target to 44 role/screen combinations.
- Only login and portal home currently expose route-level `testID` selectors. All other screens need a stable route-root identifier before reliable visual automation can wait on and name them.
- `uploads` has a route and renderer but no role receives an `uploads` navigation key; the access gate therefore renders `No access`. It is excluded from approved baselines because it is currently unreachable as intended content.
- `profile` is linked from the sidebar and More screen for every role, but only the Student navigation grants the `profile` key. Office, Teacher, and Parent therefore reach `No access`; those broken states will not be approved as visual baselines. Student Profile remains in scope.
- `pay` requires a generated payment path and embeds an external gateway/WebView. It is an interaction/integration target, not a deterministic base-page visual target, and is deferred until gateway responses can be safely stubbed.
- OS integration exists around push permissions/notifications, app foreground refresh, external call/WhatsApp/file/payment links, WebView, document selection, and SecureStore. These are native/integration targets and are intentionally not duplicated in the browser screenshot suite.
- Local persistence includes the auth token, selected child, and seen-notice IDs in localStorage on web and SecureStore on native.
- HTTP boundaries used by the selected visual tests are login/session, the role record payload, and notices. Business mutation behavior stays at API/unit level unless a separate critical journey requires UI interaction.

### Visual target matrix

| Portal | Screens | Count |
| --- | --- | ---: |
| Office | home, people, staff, school, timetable, fees, exams, notices, roles, more, notifications | 11 |
| Teacher | home, notices, attendance, class, leave, exams, timetable, more, notifications | 9 |
| Parent | home, notices, attendance, subjects, tests, papers, path, letter, timetable, fees, more, notifications | 12 |
| Student | home, notices, attendance, subjects, tests, papers, path, timetable, fees, profile, more, notifications | 12 |

Each of the 44 authenticated cases will run in desktop Chromium, phone Chromium, and phone WebKit. Together with the existing login image, the suite will own 135 approved images (132 authenticated + 3 login).

### Test levels and priorities

| Level | Priority | Target | Reason |
| --- | --- | --- | --- |
| Browser E2E visual | P0 | Four role homes; Office People/Staff/Fees; Teacher Attendance/Class/Exams; Parent and Student Fees | Highest-value daily operational and money/attendance surfaces; exact appearance at desktop and phone breakpoints |
| Browser E2E visual | P1 | Remaining permission-reachable base screens, More, Notices, Notifications, Student Profile | Comprehensive screen regression coverage requested by the user without repeating business-rule assertions |
| Browser E2E functional | P2 follow-up | Office/Teacher/Parent Profile authorization mismatch; unreachable Uploads route | These are source-discovered navigation defects and must be resolved before approving their intended appearance |
| Browser/native integration | P2 follow-up | Payment WebView, document upload, external links, push permission/deep-link behavior | Environment-dependent journeys need dedicated stubs or release-shaped device execution |
| API/unit/component | Existing or later expansion | Permissions, record payloads, actions, pure formatting, form state | Faster and more diagnostic layers; visual tests will not duplicate their business assertions |

### Implementation shape

- Add stable route-root test IDs without changing screen layout.
- Authenticate each visual case through the API and inject isolated localStorage before navigation, avoiding repeated UI login while keeping every test independent.
- Wait on visible route state and seeded content; use no fixed sleeps.
- Capture the full viewport so navigation chrome and responsive layout are included.
- Attach both the approved expected image and the current actual image even on passing tests; Playwright continues to attach expected/actual/diff automatically on failure.
- Use deterministic seeded data and normalize/fix time-dependent presentation before baseline approval.
- Keep every screen as its own named test so one mismatch does not hide later screens and reports remain actionable.

## Step 3 — Adaptive Generation and Aggregation

- Execution mode: `AGENT-TEAM`, resolved from `auto` after capability probing confirmed agent-team and subagent support.
- API worker: success, 0 new tests. The visual target uses existing login/session/record/notices APIs only as setup, and those endpoints already have Vitest/Supertest coverage.
- Mobile worker: success, 0 new Maestro/unit/component tests. Existing native P0 role-login flows already cover access integration; cheaper tests cannot prove pixel rendering, and the worker contract correctly prohibits browser E2E generation.
- Aggregate: 0 duplicate tests and 0 fixture files written. No Playwright Utils infrastructure was generated because its package-installation gate is not satisfied.
- Browser handoff: the requested Expo Web visual suite remains 44 independent role/screen tests, 132 browser-project executions, and 135 total approved snapshots including the existing login images. This is implemented after the mobile workflow boundary rather than mislabeling browser tests as native tests.
- Worker elapsed time: under one minute in parallel. Temp result files and the aggregate summary were retained for validation evidence.

## Step 4 — Validation Summary

### Workflow validation

- Framework, manifests, test directories, existing patterns, deterministic database factory, and browser projects are present and ready.
- Standalone target discovery, navigation mapping, level selection, P0/P1 prioritization, and duplicate-coverage checks passed.
- API and native worker outputs are valid and successful. Their zero-test result is intentional: neither layer can prove the requested browser pixels, and both would duplicate existing coverage.
- No generated test files, fixtures, skipped tests, focus markers, hard waits, conditionals, shared state, or unexplained utility deviations were introduced by the workers.
- Pact checks are N/A because no contract artifacts were generated and the application/API are a same-repository boundary.
- No browser CLI session was opened, so there is no orphaned session to close.
- Worker temp artifacts were used only for orchestration and are deleted after this validation; durable evidence is consolidated in this document.

### Files created or updated by the workflow

- Created: `_bmad-output/test-artifacts/automation-summary.md`.
- No executable tests were created by the mobile workflow branch. The planned Playwright Expo Web implementation follows as a scoped fallback because the selected mobile worker is expressly prohibited from producing browser E2E tests.

### Coverage, assumptions, and risks

- Planned level: browser E2E visual only, with 44 independent authenticated screen cases and 132 responsive browser executions.
- Planned priorities: 12 P0 screen cases and 32 P1 screen cases, each executed by all three browser projects.
- Existing login visual remains one case across three projects, for 135 approved images after expansion.
- Assumption: seeded role accounts retain the permission catalogs currently defined in `lib/permissions.ts` and the navigation lists in `lib/nav.ts`.
- Risk: time-derived content must be frozen or normalized or future runs will fail for calendar reasons rather than UI regressions.
- Risk: Profile for Office/Teacher/Parent and Uploads are not approved because current access wiring renders `No access`; Pay requires an external-gateway test design.
- Native visual equivalence remains outside this browser suite; Maestro CLI plus release-shaped Android/iOS builds are required for device-level validation.

### Playwright Utils deviations

None. The package is not installed, so the mandate's package gate is inactive and the existing vanilla Playwright style remains authoritative for this repository. The recommended `auth-session` utility could be adopted only after installing `@seontechnologies/playwright-utils` and wiring a Cultivate provider that persists `cultivate.token` in localStorage; that migration is not part of this visual expansion.

### Next recommended workflow

- After the browser suite is implemented and run, use `bmad-testarch-test-review` to evaluate screenshot-test quality and `bmad-testarch-trace` if a formal screen-to-test traceability gate is wanted.

## Expo Web Visual Implementation Result

- Added 44 independent authenticated visual tests: Office 11, Teacher 9, Parent 12, Student 12.
- Added 132 approved portal PNGs across desktop Chromium, phone Chromium, and phone WebKit. With the existing login screen, the report now contains 135 visual comparisons.
- Priority coverage: 12 P0 screens × 3 projects = 36 critical comparisons; 32 P1 screens × 3 projects = 96 broader comparisons; login adds 3 visual comparisons.
- Added stable route-root `testID` values to `ScreenPage`, Notices, and Notifications without altering their layout.
- Added API-based isolated authentication, navigation response synchronization, fixed browser/server time, loading/access guards, and single-capture PNG comparison helpers.
- Every passing case attaches its approved expected PNG and current actual PNG. The final report contains 135 expected and 135 actual pass attachments.
- Visual review: generated and inspected contact sheets for all three projects; no loading, access-denied, or crash overlay was approved.
- Validation: `npm run test:visual` passed 135/135 in comparison-only mode in 2.0 minutes.
- Full browser validation: `npm run test:e2e` passed 150/150 across desktop Chromium, phone Chromium, and phone WebKit.
- Repository validation: `npm run verify:quick` passed all TypeScript checks, 25 server tests, 2 mobile component tests, and the Expo web export under Node 20.
