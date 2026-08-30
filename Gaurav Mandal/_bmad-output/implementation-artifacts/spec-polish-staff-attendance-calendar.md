---
title: 'Polish staff attendance calendar'
type: 'bugfix'
created: '2026-08-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'NO_VCS'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The seven-day attendance strip on the desktop Staff screen is visually cramped and its current-day marker uses a thick near-black outline around the final `P`, making the otherwise light interface look harsh and unfinished.

**Approach:** Refine the shared attendance-dot presentation with clearer desktop sizing and spacing, and replace the dark current-day outline with a softer brand-blue treatment that still communicates which day is active. Preserve the existing attendance data, chronology, status colors, and compact phone layout.

## Boundaries & Constraints

**Always:** Keep seven school days in chronological order; retain green `P`, red `A`, amber late, blue leave, and neutral unmarked states; keep the active date perceptible without a black outline; preserve accessibility text and the existing `<768px` compact behavior. Use existing `ink`, `clay`, and status color tokens.

**Ask First:** Changing the attendance history calculation, weekday abbreviations, number of displayed days, shared color tokens, or the Staff row structure; making a visual change that materially increases the phone strip width.

**Never:** Add a second calendar control, change attendance values or save behavior, remove the active-date cue entirely, introduce web-only CSS, or alter the `P / A / L` editor control.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Desktop history | Seven attendance dots with one active date | Dots and weekday labels have comfortable, consistent sizing and spacing; the active dot uses a soft brand treatment with no dark outline | N/A |
| Compact history | Staff or teacher view below 768px | The existing compact footprint remains usable and does not crowd the row | N/A |
| Mixed statuses | Present, absent, late, leave, and unmarked days | Every status retains its existing semantic fill and legible foreground content | N/A |
| No active date | Locked day or no matching active date | No dot receives the active treatment; the history remains visually balanced | N/A |

</frozen-after-approval>

## Code Map

- `mobile/components/attendance-mark.tsx:5` -- `AttendanceDots` owns the dot dimensions, weekday-label typography, inter-day gap, status fills, accessibility label, and the current `border-2 border-ink-900` active treatment. Change this component only; `DayMark` is out of scope.
- `mobile/components/office-boards.tsx:1289` -- Staff integration supplies seven dots and `activeDate`; desktop renders the normal variant while widths below 768px pass `compact`. Treat the surrounding Staff row as read-only.
- `mobile/components/family-boards.tsx:801` -- Teacher attendance also consumes `AttendanceDots` with the same compact/desktop split, so shared visual behavior must remain safe on both surfaces.
- `mobile/lib/attendance-summary.ts:93` -- `lastAttendanceDots` already returns chronological school days with the selected day at the right; no data change is required.
- `mobile/tailwind.config.js:6` -- existing `ink`, `clay`, and status palettes are the approved visual tokens; do not add a one-off color.
- `mobile/components/__tests__/attendance-mark.test.tsx` -- add focused component coverage for normal versus compact sizing, active brand treatment, absence of the dark border, and the no-active-date case.

## Tasks & Acceptance

**Execution:**
- [x] `mobile/components/attendance-mark.tsx` -- improve normal desktop dot/label sizing and spacing while retaining the compact variant; replace the near-black active border with a restrained `clay`-palette cue.
- [x] `mobile/components/__tests__/attendance-mark.test.tsx` -- verify active, inactive, compact, and mixed-status rendering without coupling tests to StaffBoard data fetching.

**Acceptance Criteria:**
- Given the desktop Staff register, when a seven-day history renders, then the mini calendar is evenly spaced and easier to scan without changing its order or values.
- Given the selected date is the final present day, when the dot renders, then it remains distinguishable through a soft brand-blue treatment and has no `border-ink-900` class.
- Given a phone-width Staff or teacher register, when the compact variant renders, then its current footprint and legibility are preserved.
- Given attendance editing is available, when the user changes `P`, `A`, or `L`, then the editor and save behavior remain unchanged.

## Spec Change Log

## Design Notes

The current indicator should harmonize with the product's blue interaction color rather than add a nearly black ring to a status-colored dot. Desktop may use a modestly larger circle and label plus slightly more breathing room; compact keeps its existing dimensions. The active cue must remain visible on every status fill without replacing the status color itself.

## Verification

**Commands:**
- `npm --prefix mobile test -- --runInBand` -- expected: focused and existing mobile Jest suites pass.
- `npm run typecheck:mobile` -- expected: mobile TypeScript passes.

**Manual checks:**
- Inspect Staff at approximately 1200px and 390px widths, and confirm the desktop strip is cleaner, the final active `P` has no dark ring, and the phone row does not clip.
- Inspect teacher attendance once because `AttendanceDots` is shared; confirm status meaning and active-date clarity remain intact.

## Suggested Review Order

**Shared presentation**

- Start with responsive sizing and spacing that preserve the compact footprint.
  [`attendance-mark.tsx:14`](../../mobile/components/attendance-mark.tsx#L14)

- Review the active-state and neutral-fill interaction across every status.
  [`attendance-mark.tsx:28`](../../mobile/components/attendance-mark.tsx#L28)

**Verification**

- Confirm desktop, compact, active, and inactive behavior remain independently asserted.
  [`attendance-mark.test.tsx:25`](../../mobile/components/__tests__/attendance-mark.test.tsx#L25)

- Check mixed-status and unmarked-active coverage for semantic-color preservation.
  [`attendance-mark.test.tsx:58`](../../mobile/components/__tests__/attendance-mark.test.tsx#L58)
