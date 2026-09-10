---
title: 'NT-5 manual paper deadline cron'
type: 'feature'
created: '2026-08-29'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Missed paper-ready deadlines currently appear only as overdue teacher work. There is no runnable NT-5 job that creates notifications for the assigned setter, exam users, and the setter's reporting manager.

**Approach:** Add an authenticated, unscheduled NT-5 cron endpoint backed by a reusable idempotent job, then run it once against the development database so the user can test the resulting notifications.

## Boundaries & Constraints

**Always:** Select exams with a configured `paperDueOn` before the India calendar run date and `paperAt=null`; resolve the setter with `setterId` falling back to `teacherId`; notify the setter, users granted `exams.view`, and the setter's configured manager; deduplicate recipients and events in the database; target only those users; protect the endpoint with the existing `CRON_SECRET`; return eligible/created/skipped/recipient counts; preserve existing notices.

**Ask First:** Adding a recurring Vercel schedule, changing which permission means “exam permission,” or fabricating test deadlines.

**Never:** Notify a whole portal/class, substitute `exam.date` for a missing paper deadline, fire on the due date, expose an unauthenticated cron, add Next.js, or store secrets in source control.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Missed paper | Past `paperDueOn`, `paperAt=null`, setter assigned | One targeted NT-5 notice; push attempted; counts returned | Push failure does not duplicate persisted notice |
| Repeated/concurrent run | Same exam and deadline processed again | No duplicate notice or recipient | Unique event key resolves races |
| Not missed | Due today/future, ready, or deadline missing | No notice | Excluded normally |
| Overlapping recipients | A user matches multiple recipient rules | One recipient row and one delivery | Deduplicate by user ID |
| Bad cron request | Missing/wrong bearer secret | No scan or writes | HTTP 401 |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma:320` -- Exam deadline/readiness and setter relations; `Notice` currently lacks event identity and exact-user recipients.
- `lib/exams.ts:244` -- reuse `paperSetterId()` fallback.
- `lib/permissions.ts:42` -- `exams.view` identifies exam-permission recipients.
- `lib/data.ts:943` -- extend notice visibility for exact recipients without changing legacy audience behavior.
- `lib/push.ts:24` -- add exact-user push delivery; existing helper targets portals/classes.
- `lib/exam-notification-run.ts` -- new reusable NT-5 selection, recipient, persistence, and delivery job.
- `server/index.ts:310` -- existing `CRON_SECRET` fees endpoint is the cron authentication pattern.
- `tests/api/portal-api.test.ts` -- isolated API/database coverage and external-fetch mocking pattern.
- `prisma/dev.db` -- latest read-only scan found five eligible 1-A papers dated 2026-08-01.

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` -- add unique notification event identity and explicit Notice recipients.
- [x] `lib/exam-notification-run.ts`, `lib/data.ts`, `lib/push.ts` -- implement exact, idempotent NT-5 creation, visibility, and push.
- [x] `server/index.ts` -- expose `/api/cron/exams` using the existing bearer-secret pattern, with no schedule configuration.
- [x] `tests/api/portal-api.test.ts` -- cover eligibility, exact recipients, idempotency, overlap, authorization, and push failure.
- [x] Generate/push Prisma, run verification, invoke the job once against `prisma/dev.db`, and report created notices and recipients.

**Acceptance Criteria:**
- Given a paper-ready deadline has passed and `paperAt` is null, when the authenticated cron runs, then exactly one NT-5 event is visible to only the setter, `exams.view` users, and configured manager.
- Given the same cron runs repeatedly or concurrently, when it processes the same exam and deadline, then no duplicate event or recipient is created.
- Given legacy notices exist, when notification inboxes load after the change, then existing portal/class visibility is unchanged.
- Given five currently eligible development papers, when the one-shot succeeds, then the response reports their created/skipped status and the generated notices can be tested in-app.

## Spec Change Log

## Design Notes

Use `NT-5:<examId>:<paperDueOn-date>` as the unique event key so a legitimate reschedule can generate a later event. A shared notice with explicit recipient rows provides exact inbox visibility. Persisted creation is idempotent; Expo push remains best-effort without adding an outbox.

## Verification

**Commands:**
- `npm run typecheck:server && npm run typecheck:tests` -- compilation succeeds.
- `npm run test:server` -- server tests pass without real Expo traffic.
- `npm run db:push` -- generated Prisma client and development schema agree.
- Authenticated one-shot call to `/api/cron/exams` -- returns counts and creates testable NT-5 notices once.

## Suggested Review Order

**Job and authentication boundary**

- Start with the reusable India-date, recipient, persistence, and idempotency flow.
  [`exam-notification-run.ts:38`](../../lib/exam-notification-run.ts#L38)

- Confirm the existing bearer-secret pattern protects the unscheduled entry point.
  [`index.ts:321`](../../server/index.ts#L321)

**Exact-recipient persistence and delivery**

- Review eligibility indexing, unique event identity, and explicit user-recipient storage.
  [`schema.prisma:346`](../../prisma/schema.prisma#L346)

- Verify targeted notices override legacy portal and class visibility without changing them.
  [`data.ts:944`](../../lib/data.ts#L944)

- Check deduplicated exact-user push batching and per-chunk best-effort failure handling.
  [`push.ts:69`](../../lib/push.ts#L69)

**Verification**

- Review eligibility, precedence, overlap, authorization, visibility, and exact push assertions.
  [`portal-api.test.ts:676`](../../tests/api/portal-api.test.ts#L676)

- Confirm persisted idempotency survives Expo failure.
  [`portal-api.test.ts:926`](../../tests/api/portal-api.test.ts#L926)

- Confirm later push chunks are attempted after an earlier chunk fails.
  [`portal-api.test.ts:973`](../../tests/api/portal-api.test.ts#L973)
