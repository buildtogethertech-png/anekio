---
title: 'Align staff calendar toolbar'
type: 'bugfix'
created: '2026-08-24'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On desktop, Staff renders Search and Date in the first toolbar row while `+ Add staff` sits alone at the far right of the summary row. The date control therefore looks detached and the two rows have visibly ragged alignment and excess empty space.

**Approach:** Treat Search, Date, and `+ Add staff` as one bottom-aligned desktop control row, with attendance summaries on a clean second row. Preserve the current compact phone arrangement, where Add staff remains beside the summaries so Search and Date still fit.

## Boundaries & Constraints

**Always:** Keep Search flexible, Date at a readable fixed width, and all interactive controls vertically aligned on desktop. Preserve the existing `<768px` phone breakpoint, field behavior, attendance summaries, permissions, and `+ Add staff` action. Use the existing `Field`, `DateField`, and `Button` primitives without changing their global sizing.

**Ask First:** Changing shared `DateField`, `Input`, `Button`, or `Field` styles; changing the Staff card structure beyond its toolbar; changing the responsive breakpoint.

**Never:** Add a second Add staff control, hide attendance summaries, alter date selection behavior, change the calendar popover, or modify teacher/student attendance toolbars.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Desktop editor | Width is at least 768px and user can edit staff | Search, Date, and one Add staff button share one bottom-aligned row; summaries occupy the next row | N/A |
| Phone editor | Width is below 768px and user can edit staff | Search and compact Date stay on the first row; one Add staff button remains in the summary row | N/A |
| Read-only user | User lacks `staff.edit` at either width | Search and Date retain their layout and no Add staff button renders | N/A |
| Locked date | Selected day is closed or future | Locked-day message replaces summary badges without disturbing control alignment | N/A |

</frozen-after-approval>

## Code Map

- `mobile/components/office-boards.tsx:1149` -- `StaffBoard` owns the `<768px` breakpoint and permission check. Its register toolbar near line 1222 places Search/Date in row one and Add staff in row two; change only these responsive placements.
- `mobile/components/date-field.tsx:138` -- Date trigger already matches Input/Button vertical padding and uses a desktop popover plus phone modal. Treat as read-only; the defect is parent layout, not the calendar primitive.
- `mobile/components/ui.tsx:44` -- shared Input/Button/Field sizing confirms controls can bottom-align without primitive changes; read-only for this story.
- `mobile/components/__tests__/office-boards.staff.test.tsx:61` -- existing StaffBoard harness already mocks widths and permissions; extend it to cover one Add staff action in the correct responsive row and no action without permission.

## Tasks & Acceptance

**Execution:**
- [x] `mobile/components/office-boards.tsx` -- bottom-align Search, Date, and desktop Add staff in the first toolbar row; retain phone Add staff in the summary row and preserve locked/summary content.
- [x] `mobile/components/__tests__/office-boards.staff.test.tsx` -- verify responsive placement, single-instance rendering, and permission-sensitive absence without relying on computed flex geometry.

**Acceptance Criteria:**
- Given an editable desktop Staff screen, when the toolbar renders, then Search, Date, and exactly one Add staff action form a visually aligned control row above the summaries.
- Given an editable phone Staff screen, when the toolbar renders, then Search and compact Date remain usable and exactly one Add staff action remains in the summary row.
- Given a read-only user, when Staff renders at phone or desktop width, then no Add staff action appears and the remaining controls stay aligned.
- Given a locked date, when the summary row shows its message, then the desktop control row and phone control row remain unchanged.

## Spec Change Log

## Design Notes

The mismatch is caused by grouping, not control height: Input, DateField, and Button already use matching vertical padding. Desktop should use an `items-end` control row so labeled fields and the unlabeled action share a baseline. Runtime width branching keeps one action instance while allowing phone and desktop placement to differ.

## Verification

**Commands:**
- `npm run typecheck:mobile` -- expected: mobile TypeScript passes.
- `npm run test:mobile -- --runInBand` -- expected: mobile Jest suite passes.

**Manual checks:**
- Inspect Staff around 1200px and 390px widths; confirm the desktop date no longer floats above Add staff, phone controls do not clip, and the calendar opens from the unchanged trigger.

## Suggested Review Order

**Responsive toolbar**

- Start with the breakpoint-aware baseline and desktop action placement.
  [`office-boards.tsx:1225`](../../mobile/components/office-boards.tsx#L1225)

- Confirm phone keeps its action beside attendance summaries.
  [`office-boards.tsx:1264`](../../mobile/components/office-boards.tsx#L1264)

**Regression coverage**

- Review exact breakpoint placement and single-action guarantees.
  [`office-boards.staff.test.tsx:224`](../../mobile/components/__tests__/office-boards.staff.test.tsx#L224)

- Verify both responsive actions still open the existing modal.
  [`office-boards.staff.test.tsx:238`](../../mobile/components/__tests__/office-boards.staff.test.tsx#L238)

- Confirm read-only and locked-day layouts retain their safeguards.
  [`office-boards.staff.test.tsx:249`](../../mobile/components/__tests__/office-boards.staff.test.tsx#L249)
