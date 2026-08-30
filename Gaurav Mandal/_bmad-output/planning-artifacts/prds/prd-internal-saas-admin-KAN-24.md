# Product Requirements Document: Internal SaaS Organisation Admin

**Jira:** KAN-24  
**Product:** Cultivate / Anekio internal operations  
**Status:** Draft for stakeholder review  
**Date:** 2026-08-30  
**Owner:** Anekio internal team

## 1. Product summary

Build a secure, polished internal admin portal where authorised Anekio staff can onboard and manage customer organisations (initially schools), see the responsible people, manage subscription status, create invoices, record and reconcile payments, and track follow-ups.

This is an operations console, not a school-facing portal. It evolves the existing Express-rendered admin surface at `admin.<host>` / `/cultivate-admin` and the existing `SaasOrg` and `SaasPayment` records. It must not introduce Next.js, NextAuth, or a separate admin application.

The current screenshot is a reference for the starting functionality only. Its single long form and dense editable table are not the target UI. The release must provide a real admin information architecture with navigation, dashboard summaries, list/detail screens, focused forms, and clear action feedback.

## 2. Problem

The current admin page allows anyone who can reach the URL to view and change organisation and payment information. Organisation, subscription, and payment fields are presented in one large page, with no authenticated operator identity, invoice lifecycle, audit history, or reliable way to search and follow up.

Internal staff need a small but dependable system that answers:

- Which organisations are leads, trials, active customers, paused, overdue, or closed?
- Who owns each customer relationship and who should be contacted?
- What plan and price were agreed, and for which billing period?
- Which invoices are due, paid, overdue, void, or partially paid?
- Which payments were received, by what method, and against which invoice?
- Who made each important administrative change?

## 3. Goals

1. Prevent all anonymous access to the internal portal and its mutation endpoints.
2. Let an authorised operator create and maintain a complete organisation record.
3. Provide clear organisation and billing lifecycle states.
4. Create downloadable, uniquely numbered invoices suitable for Indian business use.
5. Record online and offline payments and allocate them to invoices.
6. Make overdue accounts and upcoming follow-ups easy to find.
7. Preserve an audit trail for sensitive changes.
8. Keep the first release intentionally small and usable on desktop and phone.

## 4. Non-goals for the first release

- Full accounting, bookkeeping, TDS filing, GST return filing, or revenue recognition.
- Customer self-service billing or a customer-facing subscription portal.
- Automated provisioning of a complete school database or tenant infrastructure.
- Multi-currency billing; the first release uses INR only.
- Automated refunds, credit notes, or dunning workflows.
- A generic CRM for unrelated sales pipelines.
- Replacing school fee invoices and payments already handled inside each school workspace.

## 5. Users and access policy

### 5.1 Primary user

**Internal operator:** an Anekio founder, finance operator, or authorised operations employee who onboards organisations, records commercial terms, issues invoices, confirms payments, and follows up.

### 5.2 Authentication

- Every admin page and admin action requires sign-in.
- Preferred sign-in for v1 is Google OAuth because the initial users have Google-managed email accounts.
- Authentication is implemented in Express and must not use NextAuth.
- A signed-in account is allowed only when its normalised, verified email matches an active access rule.
- Initial access rules:
  - exact email: `buildtogether.tech@gmail.com`
  - domain: `anekio.com`
  - domain: `anekio.in`
- Domain comparison is case-insensitive and exact; addresses such as `user@sub.anekio.com` or `user@fakeanekio.com` are not implicitly allowed.
- Disabled or removed access takes effect on the next request or within a short session revalidation window.
- Failed authorisation returns a neutral access-denied page and does not reveal organisation data.
- Admin POST actions require CSRF protection, secure cookies, and server-side authorisation; hiding UI controls is not sufficient.

### 5.3 Roles

The first release may use one `ADMIN` role for all allowed accounts. The data and audit design should allow later separation into `ADMIN`, `FINANCE`, and `VIEWER` without redesigning organisation or invoice records.

## 6. Information architecture

### 6.1 Dashboard

Show compact operational totals and actionable queues:

- active organisations
- trials ending soon
- invoices due in the next 7 days
- overdue invoices and overdue amount
- payments received this month
- follow-ups due today or overdue
- recent activity

### 6.2 Organisations

Provide searchable, filterable organisation cards or rows. Default columns:

- organisation name and city
- lifecycle status
- owner / primary contact
- assigned internal owner
- plan and billing cycle
- next invoice or renewal date
- outstanding balance
- follow-up status and next follow-up date

Filters include status, payment health, plan, assigned owner, city, and follow-up due state. Search includes organisation name, contact name, email, phone, GSTIN, and invoice number.

### 6.3 Organisation detail

Use a summary header and focused sections or tabs:

1. **Overview:** legal/display name, school name where applicable, lifecycle, contact information, size, links, internal owner, and notes.
2. **Subscription:** plan, billing frequency, agreed amount, start date, trial dates, renewal date, status, and cancellation/pause reason.
3. **Invoices:** invoice list, totals, due dates, balances, statuses, PDF actions, and create-invoice action.
4. **Payments:** payment history, method, provider/reference, allocation, proof, and record-payment action.
5. **Activity:** append-only audit events and follow-up notes.

### 6.4 Invoice detail

Show seller and customer details, line items, taxes, totals, payment allocation, balance, status history, internal notes, and downloadable PDF. Provide only actions valid for the current state.

### 6.5 Required application shell

The authenticated portal uses a consistent application shell:

- **Desktop:** left navigation, top bar, page title/actions, and a constrained readable content area.
- **Phone:** compact header and drawer or bottom navigation without horizontal page scrolling.
- **Navigation:** Dashboard, Organisations, Invoices, Payments, Follow-ups, and Settings.
- **Top bar:** global search, signed-in operator identity, and sign-out.
- **Page header:** breadcrumb where useful, page title, short context, and one clear primary action.

The marketing-page button shown in the reference is not a primary operational action. If retained, it belongs in a secondary account/help menu.

### 6.6 MVP screen blueprint

#### Dashboard

- First row: Active organisations, Outstanding amount, Overdue invoices, Payments this month.
- Main column: organisations needing attention and invoices due/overdue.
- Secondary column: follow-ups due and recent activity.
- One primary action: **Add organisation**.

#### Organisation list

- Header with **Add organisation**.
- Search and filters directly above the list.
- Rows show organisation, main contact, lifecycle, plan, outstanding amount, next follow-up, and overflow actions.
- Clicking a row opens its detail page; fields are not edited inside the table.
- Empty state explains the feature and offers **Add first organisation**.

#### Add/edit organisation

- Use a focused page or modal with grouped sections: Basic details, Primary contact, Billing address/tax, Subscription, Internal ownership, and Notes.
- The initial view asks only for essential fields; optional details can be expanded so the form does not feel overwhelming.
- Use appropriate input types, Indian phone formatting, selects for controlled statuses, and date pickers for dates.
- Provide Save and Cancel actions, inline errors, unsaved-change protection, and visible success feedback.

#### Organisation detail

- Summary header with organisation name, lifecycle badge, primary contact, plan, balance, and actions.
- Tabs or sections: Overview, Subscription, Invoices, Payments, Activity.
- Primary contextual action changes by need: Create invoice, Record payment, or Edit organisation.
- Notes and audit history are visually distinct; operators must not mistake internal notes for customer-facing invoice notes.

#### Invoice composer

- Use an invoice-style editor, not a generic textarea or raw JSON field.
- Add/remove line-item rows with description, quantity, rate, tax, and calculated amount.
- Keep subtotal, tax, round-off, paid amount, and total visible in a summary panel.
- Actions: Save draft, Preview, Issue invoice. Issuing requires confirmation.

#### Payment recorder

- Display organisation, invoice number, total, paid, and outstanding amount before entry.
- Fields: payment date, amount, method, reference/UTR, optional proof, and internal note.
- Show the new balance before confirmation and prevent amounts above the supported balance policy.

### 6.7 UI quality bar

- The portal must look intentionally designed, not like a generated HTML form or database editor.
- Establish reusable visual tokens for spacing, typography, colour, borders, elevation, focus, and status badges.
- Use a neutral working surface with restrained Anekio brand accents; avoid oversized empty fields and excessive card nesting.
- Tables use comfortable density, sticky headers where helpful, aligned numeric columns, and responsive card fallback on small screens.
- Every action has loading, success, error, empty, and disabled states.
- Destructive or irreversible actions are visually separated from ordinary actions.
- Skeleton/loading states must not cause major layout shifts.

## 7. Core workflows

### 7.1 Sign in

1. Operator visits the admin host or `/cultivate-admin`.
2. Anonymous operator is redirected to sign in.
3. Google returns a verified email identity.
4. Server checks the exact-email and domain allowlist.
5. Allowed operator receives a secure session and lands on the dashboard; all others are denied.

### 7.2 Add an organisation

1. Operator selects **Add organisation**.
2. Operator enters the minimum required information: organisation/school name, primary contact name, email, phone, and lifecycle status.
3. Optional commercial, address, tax, scale, ownership, URL, and follow-up fields can be added immediately or later.
4. System detects likely duplicates by normalised name, email, phone, or GSTIN and asks for confirmation before creating a possible duplicate.
5. System saves the organisation and records who created it.

### 7.3 Start or update a subscription

1. Operator selects a plan or records a custom commercial agreement.
2. Operator sets billing frequency, INR price, start date, renewal/next billing date, and trial details if applicable.
3. Status transitions are constrained to valid moves and reason/date are required for pause, cancellation, or closure.
4. The change is written to the activity history.

### 7.4 Create and issue an invoice

1. Operator opens an organisation and selects **Create invoice**.
2. Seller/customer details are snapshotted onto the invoice so historical invoices do not change when the organisation is edited.
3. Operator sets invoice date, due date, billing period, line items, discount, GST treatment, and notes.
4. System calculates subtotal, CGST/SGST or IGST as applicable, round-off, and grand total in paise-safe integer arithmetic.
5. A draft can be edited. Issuing assigns an immutable unique invoice number and freezes financial fields.
6. Operator can download the invoice PDF and mark/share it through an external channel. Sending email is a later enhancement unless separately approved.

### 7.5 Record a payment

1. Operator selects an invoice or organisation and chooses **Record payment**.
2. Operator enters amount, date, method, reference/UTR/provider ID, optional proof, and notes.
3. Payment is allocated to one invoice in v1; the model should allow later multi-invoice allocation.
4. System rejects zero/negative payments and warns on duplicate references or overpayment.
5. Invoice becomes `PARTIALLY_PAID` or `PAID` based on allocated total; a reversal never deletes the original event.

### 7.6 Follow up

1. Operator records a note, outcome, next action, and next follow-up date.
2. Due and overdue follow-ups appear on the dashboard and organisation list.
3. Completing or rescheduling the follow-up preserves the prior history.

## 8. Functional requirements

### P0 — required for launch

- **FR-01:** Require an authenticated and authorised session for every internal admin page and mutation endpoint, including legacy `/cultivate-admin` and admin-host routes.
- **FR-02:** Support exact-email and exact-domain access rules with the initial allowlist defined in section 5.2.
- **FR-03:** Allow operators to sign out and invalidate their current session.
- **FR-04:** Create, view, edit, search, and filter organisations.
- **FR-05:** Store primary contact and internal account owner separately.
- **FR-06:** Track organisation lifecycle using controlled values: `LEAD`, `TRIAL`, `ACTIVE`, `PAUSED`, `CANCELLED`, `CLOSED`.
- **FR-07:** Track subscription plan, billing frequency, agreed INR amount, start date, trial end, renewal date, and status.
- **FR-08:** Create and edit draft invoices with one or more line items.
- **FR-09:** Issue uniquely numbered invoices and render a downloadable PDF.
- **FR-10:** Support invoice states `DRAFT`, `ISSUED`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, and `VOID`, with valid state transitions.
- **FR-11:** Calculate and display subtotal, discount, tax, round-off, total, paid amount, and outstanding amount.
- **FR-12:** Record manual or gateway payments with amount, date, method, reference, status, and notes.
- **FR-13:** Link payments to an organisation and invoice; never infer a paid invoice from a free-text organisation-level status.
- **FR-14:** Show organisation-level outstanding balance derived from issued invoices and allocated payments.
- **FR-15:** Record append-only audit events for sign-in, organisation changes, subscription changes, invoice issue/void, and payment creation/reversal.
- **FR-16:** Validate required fields server-side and provide clear inline errors without losing entered data.
- **FR-17:** Prevent accidental duplicate form submissions and make payment callbacks idempotent.

### P1 — next after launch

- **FR-18:** Dashboard queues and totals described in section 6.1.
- **FR-19:** Follow-up notes, next-action owner, due date, completion, and overdue views.
- **FR-20:** CSV export of organisations, invoices, and payments for an authorised operator.
- **FR-21:** Upload and retrieve payment proof with file-type, size, and access controls.
- **FR-22:** Configurable invoice numbering prefix and seller billing profile.
- **FR-23:** Expiring sessions, forced sign-out, and an internal page to manage individual allowed accounts.

### P2 — later

- Scheduled recurring invoice generation with preview and operator approval.
- Email delivery and delivery history.
- Credit notes, refunds, overpayment credits, and payment allocation across invoices.
- Role-based permissions for finance, viewer, and administrator roles.
- Automated reminders and dunning rules.
- Organisation provisioning and deployment health.

## 9. Organisation and billing data

### Organisation

- display name and legal name
- organisation type (school initially)
- lifecycle status
- primary contact name, email, and Indian phone number
- secondary contacts
- billing address, city, state, pincode, country
- GSTIN and PAN where applicable
- teacher/student counts
- internal account owner
- login and API URLs
- internal notes, tags, created/updated timestamps

### Subscription

- organisation, plan name, billing frequency
- amount in minor units (paise) and currency `INR`
- start, trial end, current-period start/end, and next billing dates
- status and status reason
- agreed commercial notes

### Invoice

- immutable invoice number after issue
- organisation and subscription reference
- seller and customer snapshots
- invoice and due dates; service/billing period
- line items with description, quantity, unit price, taxable value, and tax code/rate
- subtotal, discount, CGST, SGST, IGST, round-off, total, paid, and balance
- status, issue/void timestamps, void reason, internal note, customer note
- creator and timestamps

### Payment and allocation

- organisation, amount in minor units, currency, paid date
- method (`UPI`, `BANK_TRANSFER`, `CARD`, `CASH`, `CHEQUE`, `GATEWAY`, `OTHER`)
- provider, order/payment/reference ID, proof, notes, and status
- one or more allocations containing invoice and allocated amount
- creator/reverser, timestamps, and reversal reason

### Audit event

- operator, action, entity type/id, timestamp
- structured summary of changed fields, excluding secrets
- request/session metadata sufficient for investigation

## 10. Invoice and India-specific rules

- Store money as integer minor units; do not use floating-point arithmetic for financial totals.
- Use INR in v1 and Indian number/date formatting in the UI and PDF.
- GST fields and tax calculations are supported but not forced when the seller or customer is not GST-registered.
- When GST applies, choose CGST + SGST for intra-state supply and IGST for inter-state supply, with an explicit operator override and reason for exceptional cases.
- Invoice numbering must be unique and sequential within the configured financial-year series. A number is assigned only when the invoice is issued.
- Issued invoices are not edited in place. Incorrect issued invoices are voided with a reason; credit-note support is a later requirement.
- The final legal/tax invoice format must be reviewed by the business's accountant before production use.

## 11. Security and privacy requirements

- Default-deny access; a valid Google identity alone is not authorisation.
- Verify OAuth state, nonce, issuer, audience, email verification, and redirect URI.
- Use `HttpOnly`, `Secure`, and appropriate `SameSite` session cookies; rotate session identifiers after sign-in.
- Protect state-changing requests from CSRF and rate-limit sign-in and sensitive actions.
- Do not place payment gateway keys in `.env`; school gateway keys remain in `SchoolConfig` per project policy. Any future platform billing credential design requires a separate security decision and secret store.
- Do not log tokens, cookies, secrets, full payment proofs, or unnecessary personal data.
- All invoice PDFs and payment proofs require authenticated access; URLs must not be publicly guessable.
- Audit records are append-only to ordinary admin users.
- Backups and recovery must cover organisation, invoice, payment, allocation, and audit data.

## 12. UX requirements

- Treat the reference image as evidence of the current workflow, not a visual design to preserve. Replace the very wide all-in-one form/table with the application shell and screen blueprint in section 6.
- Optimise the main workflow for desktop while keeping all tasks usable on phone widths.
- Use clear labels and controlled selects instead of free-text status fields.
- Show financial status using both text and colour; colour alone must not carry meaning.
- Confirm irreversible actions such as invoice issue and void. Ordinary field edits should not require confirmation.
- Preserve entered form values after validation errors and prevent double submission.
- Provide empty, loading, success, and error states for every major view.
- Meet WCAG 2.1 AA expectations for keyboard operation, focus, contrast, labels, and error messaging.

### 12.1 Minimum usable functionality

The first usable release is not complete unless an authorised operator can perform this entire path through the UI without database access or terminal commands:

1. Sign in and sign out.
2. View a meaningful dashboard.
3. Add an organisation with owner/contact details.
4. Search for and reopen that organisation.
5. Edit organisation, subscription, and follow-up information.
6. Create, preview, issue, and download an invoice.
7. Record a partial or full payment against that invoice.
8. See the updated invoice status and organisation outstanding balance.
9. Review who performed each important action and when.

Authentication around the existing page alone does not satisfy the requirement.

## 13. Non-functional requirements

- Typical authenticated pages should respond within 2 seconds at the expected internal-team scale; search/filter interactions should feel immediate.
- Organisation, invoice, and payment writes are transactional where consistency spans multiple records.
- Payment verification and callbacks are idempotent by provider/order/payment identifiers.
- Server-side pagination is introduced before lists exceed 100 records.
- All timestamps are stored unambiguously and displayed in Asia/Kolkata for the initial team.
- The portal must fail closed when authentication configuration is unavailable.
- Existing marketing, school ERP, public pay, and invoice routes must continue working.

## 14. Launch acceptance criteria

1. An anonymous request to every internal admin page or mutation receives no organisation or billing data and is redirected to sign-in or rejected.
2. `buildtogether.tech@gmail.com` can sign in; verified users at exactly `@anekio.com` and `@anekio.in` can sign in; unrelated or lookalike domains cannot.
3. An authorised operator can create an organisation, see it in a searchable list, open its detail page, and update controlled lifecycle/subscription fields.
4. An operator can create a draft invoice with multiple line items, review calculated tax/totals, issue it once, and download a readable PDF with a unique invoice number.
5. An operator can record a partial and final payment; allocated totals and invoice/organisation balances update correctly without deleting payment history.
6. Duplicate payment callbacks or repeated submissions do not create duplicate payments.
7. Important organisation, subscription, invoice, and payment actions show operator and timestamp in activity history.
8. Invalid input is rejected server-side with actionable errors and without exposing stack traces or secrets.
9. Desktop and phone layouts support sign-in, organisation management, invoice creation, and payment recording.
10. Relevant type checks and focused automated tests pass, and `GET /health` succeeds on Express port `4000` after schema changes and API restart.
11. The delivered portal uses separate dashboard, list, detail, and task-focused form experiences; it does not ship as the current single long form plus editable table.
12. A stakeholder can complete the minimum usable path in section 12.1 without assistance, hidden routes, database edits, or terminal commands.

## 15. Success measures

Within the first month after launch:

- 100% of internal admin access is authenticated and allowlisted.
- At least 95% of onboarded customer organisations have a named contact, internal owner, lifecycle status, and next commercial action.
- 100% of newly issued SaaS invoices and recorded payments are linked to an organisation and audit actor.
- Operators can find an organisation and its outstanding balance in under 30 seconds.
- No duplicate payment is created from retried submissions or gateway callbacks.

## 16. Delivery slices

### Slice 1: Secure foundation and organisations

Authentication/allowlist, secure sessions, route protection, organisation list/detail/create/edit, controlled statuses, search, and audit foundation.

### Slice 2: Invoices and payments

Subscription terms, invoice drafts/issue/PDF, manual payment entry, payment allocation, derived balances, and idempotency.

### Slice 3: Operational dashboard

Overdue/due queues, follow-ups, filters, activity views, exports, and workflow polish.

Each slice requires its own implementation ticket or scoped child tickets before code changes.

## 17. Assumptions and decisions to confirm

1. **Access rule:** treat `buildtogether.tech@gmail.com` as one exact account, not a domain, and allow every verified mailbox at exactly `anekio.com` and `anekio.in`.
2. **Branding:** the screen may say “Anekio Internal Admin” while managing the Cultivate product.
3. **Invoice seller:** confirm the legal seller name, billing address, GSTIN/PAN, place of supply defaults, bank/UPI details, and authorised signatory before production invoices are issued.
4. **Commercial model:** confirm whether ₹14,999 is monthly, annual, or a one-time early-bird amount; the current code labels it inconsistently.
5. **Billing credentials:** confirm the approved secret-storage approach for Anekio's own SaaS payment gateway; school gateway credentials must continue to live per school in `SchoolConfig`.
6. **Customer communication:** confirm whether v1 only downloads PDFs or must also email invoices.
7. **Data tenancy:** confirm whether all SaaS organisations remain in the current shared operational database or reference separately provisioned school databases.

## 18. Release gate

Implementation can start only after stakeholders confirm the access rule, commercial price/frequency, and seller invoice details. Before production release, complete an authentication/authorisation review, invoice calculation tests, payment idempotency tests, audit-event tests, responsive review, and accountant review of the invoice output.
