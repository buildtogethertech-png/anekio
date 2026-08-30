---
title: 'Unclutter staff leave controls'
type: 'bugfix'
created: '2026-08-24'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Staff page renders every leave request in a large card above the attendance register even though the register already shows leave status. This duplicates information, consumes valuable vertical space, and makes the page feel cramped.

**Approach:** Replace the always-visible request card with a compact page-header action that shows the request count and opens the same decision details in a responsive modal. Keep date-specific leave status in the register because it is part of attendance marking.

## Boundaries & Constraints

**Always:** Preserve the office user's ability to reject every leave request currently exposed on Staff. Show the compact action only when requests exist. Keep the leave summary badge, immutable `On leave` row marker, search, date selection, attendance history, and phone/desktop row behavior intact. Use the existing UI primitives and mutation/reload/toast patterns.

**Ask First:** Adding an Office Leave route, changing navigation or permissions, changing leave approval rules, or altering API/data contracts.

**Never:** Delete the only Office leave-decision surface; allow attendance marking to overwrite approved leave; add a new tab; change teacher, parent, or student leave screens.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| No requests | `pendingLeave` is empty | No leave-request action or modal is visible; attendance register keeps its normal layout | N/A |
| One or more requests | `pendingLeave` contains rows | Header shows a compact count action; activating it opens a scrollable modal with every request's person, type, range, optional reason, and Reject control | N/A |
| Reject succeeds | User rejects a request | Existing mutation runs, modal remains usable, data reloads, count/list updates, and success toast appears | N/A |
| Reject fails | Mutation throws | Request remains available and the existing error message appears in a toast | Do not close or discard the request |
| Selected date is approved leave | Staff status resolves to `LEAVE` | Register still displays its leave summary and non-editable `On leave` marker | Attendance cannot overwrite leave |

</frozen-after-approval>

## Code Map

- `mobile/components/office-boards.tsx:1149` -- `StaffBoard`; owns request data, attendance state, responsive register, mutations, toast, and modals. Replace the top card at the return block near line 1366, add modal state/action, and preserve `statusOf`, the summary badge, and row marker.
- `mobile/components/ui.tsx:240` -- `PageHeader` already supports a responsive `action`; `Modal` near line 262 supplies a bounded, scrollable dialog suitable for the request list. Reuse without modification unless implementation proves a general defect.
- `mobile/components/attendance-mark.tsx:63` -- `OnLeaveSign` is the existing immutable attendance marker and is read-only for this change.
- `mobile/lib/record.tsx:443` -- `LeaveRow` defines request fields used by `pendingLeave`; no data-contract change is needed.
- `tests/e2e/fixtures/visual-screens.ts:23` -- Staff is part of the P0 visual screen coverage and is the relevant regression surface.

## Tasks & Acceptance

**Execution:**
- [x] `mobile/components/office-boards.tsx` -- move leave-request details and Reject controls from the always-visible card into a modal opened by a compact counted `PageHeader` action; retain current mutation, toast, reload, and attendance behavior.

**Acceptance Criteria:**
- Given Office has pending staff leave, when Staff opens, then the attendance register is not pushed down by a leave list and a compact request-count action is visible in the header.
- Given the compact action is visible, when it is activated, then all existing request details and Reject controls are accessible in a scrollable modal on phone and desktop widths.
- Given there are no pending requests, when Staff opens, then no request action or empty modal affordance is shown.
- Given a staff member is on leave for the selected date, when the register renders or attendance is saved, then the leave summary and immutable row marker remain unchanged.

## Spec Change Log

## Design Notes

The page has two distinct concepts: pending/active leave decisions and attendance status for the selected date. Progressive disclosure keeps decision capability near Staff without letting a potentially long request list dominate the daily register. The action label should include the count, for example `Leave requests (2)`, so the hidden content remains discoverable.

## Verification

**Commands:**
- `npm run typecheck:mobile` -- expected: mobile TypeScript passes.
- `npm run test:mobile -- --runInBand` -- expected: mobile Jest suite passes.

**Manual checks:**
- Inspect Staff at phone and desktop widths with zero, one, and multiple requests; verify the header stays balanced, the modal scrolls, rejection feedback works, and the attendance register no longer feels vertically cramped.

## Suggested Review Order

**Progressive disclosure**

- Start with the compact counted entry point that frees the attendance register.
  [`office-boards.tsx:1368`](../../mobile/components/office-boards.tsx#L1368)

- Review the responsive modal that preserves request details and rejection.
  [`office-boards.tsx:1383`](../../mobile/components/office-boards.tsx#L1383)

- Confirm exhausted request lists reset retained modal state.
  [`office-boards.tsx:1174`](../../mobile/components/office-boards.tsx#L1174)

**Attendance safety**

- Verify approved leave remains immutable before local attendance marks.
  [`office-boards.tsx:1178`](../../mobile/components/office-boards.tsx#L1178)

**Regression coverage**

- Review responsive visibility, decision outcomes, dismissal, and lifecycle tests.
  [`office-boards.staff.test.tsx:87`](../../mobile/components/__tests__/office-boards.staff.test.tsx#L87)

- Confirm the leave-save test uses a deterministic school day.
  [`office-boards.staff.test.tsx:187`](../../mobile/components/__tests__/office-boards.staff.test.tsx#L187)
