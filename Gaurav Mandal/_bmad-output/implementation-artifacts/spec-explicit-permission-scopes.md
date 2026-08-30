---
title: 'Explicit permission scopes for reporting managers'
type: 'feature'
created: '2026-08-28'
status: 'done'
baseline_commit: 'NO_VCS'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Cultivate already separates Office, Teacher, Parent, and Student portals and assigns permissions by role, but data visibility is partly hard-coded. In particular, leave and timetable logic infer “my reports” or “whole school” from whether a permission exists, so an administrator cannot see or configure the real boundary.

**Approach:** Store a scope with each role grant and expose it in Roles. Keep portal and permission behavior unchanged, use `SELF`, `ASSIGNED`, `REPORTS`, and `SCHOOL` as the common vocabulary, and first enforce configurable scopes on the existing manager-sensitive leave and timetable flows.

## Boundaries & Constraints

**Always:** The server is authoritative; every saved scope must be valid for that permission and portal. `REPORTS` means direct reports through the existing `User.managerId` relationship. `ASSIGNED` means the existing teacher/class assignment rules. Existing users must retain their effective access after the schema update. Navigation remains controlled by whether a grant exists, not by its scope.

**Ask First:** Expanding `REPORTS` to recursive reports, introducing campus/branch scope, or making fees, exams, people, and notices newly configurable by scope requires a separate product decision because those modules do not yet have one consistent narrower boundary.

**Never:** Create manager-flavoured roles solely to represent visibility, trust a scope sent by the client without catalog validation, expose school-wide records to a grant whose scope is narrower, or add a second authorization system outside `lib/permissions.ts` and role grants.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Existing role upgrade | Existing grants have no stored scope | Admin manager-sensitive grants become `SCHOOL`; other applicable grants preserve their present `REPORTS`, `ASSIGNED`, or `SELF` behavior | Startup normalization is idempotent |
| Manager leave access | `leave.decide` with `REPORTS` | User sees and decides leave only for direct reports | Reject an out-of-scope leave action |
| School leave access | `leave.decide` with `SCHOOL` | User sees and decides any staff leave in the school | N/A |
| Timetable access | `timetable.view` or `timetable.edit` with `REPORTS` | User sees or edits only classes derived from direct-report teachers | Reject writes outside those classes |
| Invalid update | Client sends unsupported scope for a permission | No grant is changed | Return a clear validation error |
| Role copy | A role with scoped grants is duplicated | Permission keys and scopes are copied exactly | N/A |

</frozen-after-approval>

## Code Map

- `prisma/schema.prisma` -- persists the scope on each `RoleGrant`.
- `lib/permissions.ts` -- defines scope vocabulary, allowed/default scope per permission, and scope-aware access helpers.
- `lib/roles.ts` -- loads scoped grants and normalizes existing/system grants without widening access.
- `lib/reports.ts` -- existing source of direct-report users and their assigned classes.
- `lib/api-v1-record.ts` -- returns scoped role/catalog data and applies scope to leave, dashboard, and timetable reads.
- `lib/core-actions.ts` -- validates scope updates, preserves scope during role copy, and enforces scoped timetable/leave writes.
- `lib/leave.ts` -- resolves staff leave by explicit access scope rather than a `seeAll` boolean.
- `mobile/lib/record.tsx` -- types scoped grants and catalog scope options.
- `mobile/components/office-boards.tsx` -- shows a compact scope selector for permissions that support more than one scope.
- `tests/unit/permissions.test.ts` -- covers scope defaults, validation, and access helpers.
- `tests/api/portal-api.test.ts` -- covers persisted role scopes and manager versus school data boundaries.

## Tasks & Acceptance

**Execution:**
- [x] `prisma/schema.prisma` -- add a scope field to role grants -- make visibility durable and role-specific.
- [x] `lib/permissions.ts`, `lib/roles.ts` -- define allowed scopes, load scope maps, and safely normalize old grants -- centralize policy and preserve behavior.
- [x] `lib/api-v1-record.ts`, `lib/core-actions.ts`, `lib/leave.ts` -- replace inferred leave/timetable scope with explicit scope checks -- make reads and writes agree.
- [x] `mobile/lib/record.tsx`, `mobile/components/office-boards.tsx` -- display and edit scope beside eligible permissions -- make manager access understandable to admins.
- [x] `tests/unit/permissions.test.ts`, `tests/api/portal-api.test.ts` -- test validation, migration defaults, copying, and record/action boundaries -- prevent accidental privilege widening.

**Acceptance Criteria:**
- Given an admin opens Roles, when a permission has multiple valid scopes, then its current scope is visible and can be changed without disabling the permission.
- Given a fixed-scope teacher, parent, or student grant, when it is shown in Roles, then its scope is understandable but cannot be changed to an invalid broader value.
- Given a reporting manager with `REPORTS` scope, when they read or mutate leave/timetable data, then only direct-report data is available.
- Given the same permission with `SCHOOL` scope, when an authorized office user uses it, then school-wide data is available.
- Given the schema is upgraded over existing data, when the app restarts, then no existing non-admin user gains broader access.

## Spec Change Log

## Design Notes

The grant remains the simple unit of authorization: `{ permission, scope }`. Portal chooses the product experience, permission chooses the capability, and scope chooses the records. Only permissions with an already-defined manager boundary are configurable in this change; other permissions receive their existing fixed semantic scope so the model can expand safely later.

## Verification

**Commands:**
- `npm run db:push` -- expected: Prisma accepts and applies the grant schema change.
- `npm run typecheck` -- expected: server, mobile, and test TypeScript pass.
- `npm run test:server` -- expected: permission and API authorization tests pass.
- `npm --prefix mobile run test` -- expected: mobile component tests pass.

**Manual checks (if no CLI):**
- In Office → Roles, confirm eligible permissions show the saved scope and changing it survives reload.
- Sign in as a reporting manager and confirm leave/timetable screens never reveal a non-report’s records.

## Suggested Review Order

**Policy model**

- Start with the portal-aware scope catalog and authoritative validation helpers.
  [`permissions.ts:87`](../../lib/permissions.ts#L87)

- Review durable grant storage and the shared scope vocabulary.
  [`schema.prisma:17`](../../prisma/schema.prisma#L17)

- See idempotent legacy normalization and manager-grant preparation.
  [`roles.ts:13`](../../lib/roles.ts#L13)

**Authorization boundaries**

- Atomic grant updates prevent partial persistence after validation failures.
  [`core-actions.ts:1109`](../../lib/core-actions.ts#L1109)

- Leave decisions require both capability and matching report scope.
  [`leave-actions.ts:189`](../../lib/leave-actions.ts#L189)

- Timetable reads filter classes, teachers, rooms, and metadata consistently.
  [`api-v1-record.ts:691`](../../lib/api-v1-record.ts#L691)

- Leave bundles only query team data when an explicit scope exists.
  [`leave.ts:352`](../../lib/leave.ts#L352)

**Admin experience**

- Role controls apply portal-specific options and explain fixed scopes.
  [`office-boards.tsx:2062`](../../mobile/components/office-boards.tsx#L2062)

- Scope chips persist eligible changes without disabling permissions.
  [`office-boards.tsx:2139`](../../mobile/components/office-boards.tsx#L2139)

**Verification**

- API coverage exercises migration, atomicity, copying, and report boundaries.
  [`portal-api.test.ts:159`](../../tests/api/portal-api.test.ts#L159)

- Component coverage verifies fixed labels and selectable scope persistence.
  [`office-boards.staff.test.tsx:282`](../../mobile/components/__tests__/office-boards.staff.test.tsx#L282)
