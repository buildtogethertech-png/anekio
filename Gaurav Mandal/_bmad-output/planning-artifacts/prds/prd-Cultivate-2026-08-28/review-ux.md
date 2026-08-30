# UX and Workflow Review: Cultivate Document Studio PRD

## Verdict

The PRD has a strong product model: design is centralized, generation stays in the working module, and issued documents remain immutable and verifiable. The QR/token distinction is especially sound. However, the proposed MVP is closer to a complete document-platform launch than a viable first release. The specification is strongest on capabilities and weakest on the day-to-day states an Indian school office must understand: what is saved versus published, why generation is blocked, what happened to each student in a failed batch, how a corrected document replaces an issued one, and which template will actually be used after class/session changes.

The first release should prove three end-to-end workflows—admit cards, report cards, and payment receipts—using constrained document-specific editors and a shared issuance engine. A general freeform canvas, ten document types, public verification, mobile generation, approvals, asset versioning, and advanced batch operations should not all be launch gates.

## Findings

### 1. Draft, saved, published, and active are four different states but the UI contract does not distinguish them

- **Location:** §3 Glossary; FR-3; FR-23; NFR-8
- **Trigger condition:** An administrator edits an active template, autosave acknowledges the edit, and the screen does not make clear whether the live template changed or only a draft was saved.
- **Guard snippet:** Define an explicit state model and visible status language: `Unsaved changes → Draft saved → Published version → Active for [scope]`. Editing an active version must create a new draft; the header should always show both draft save state and currently active version. Activation must be a separate confirmed action with an effective scope summary.
- **Potential consequence:** Staff believe their changes are live when generation still uses the older version, or accidentally activate unfinished work because a save/checkmark is mistaken for publication.

### 2. Active-template resolution is underspecified for real academic-year rollover

- **Location:** FR-3; §4 Information Architecture; §13 Open Questions
- **Trigger condition:** A school starts a new session, promotes students, renames sections, or copies the previous year's setup while school-, session-, class-, and subtype-level activations overlap.
- **Guard snippet:** Specify a deterministic precedence order and an “effective template” inspector that answers, for any class and date, exactly which version will be used and why. Add `Copy activations to new session`, orphaned-scope warnings, and a rollover checklist that never silently carries exam or fee wording across sessions.
- **Potential consequence:** Different classes receive the wrong report card or outdated principal/signature after rollover, with no obvious place for office staff to diagnose the selection.

### 3. There is no explicit first-run setup that turns defaults into a usable school document set

- **Location:** UJ-1; FR-1–FR-3; FR-24
- **Trigger condition:** A small school opens Document templates for the first time with no logo, verified school details, signature, stamp, numbering scheme, or active template.
- **Guard snippet:** Add a guided “Set up school documents” flow: confirm legal school name/address/affiliation details, upload brand assets, choose signatories, preview required fields, select a default, choose scope, and activate. Show a readiness checklist per document type rather than exposing an empty library first.
- **Potential consequence:** The product appears powerful but incomplete; users create inconsistent templates or abandon setup before any contextual Generate action becomes available.

### 4. Missing source data is treated as a warning concept, not a repair workflow

- **Location:** UJ-2; FR-9; FR-18–FR-20; Risk “Bulk-generation failures”
- **Trigger condition:** Admit-card generation finds missing photos, roll numbers, guardian names, exam rooms, teacher remarks, or marks for dozens of students.
- **Guard snippet:** Define a preflight results screen with counts for `Ready`, `Needs attention`, and `Excluded`; group issues by field and student; provide direct links or bulk actions to repair source records; support CSV export of unresolved issues; let the operator re-run validation without losing the selected population.
- **Potential consequence:** An office user receives a long error list, manually hunts through modules, loses batch context, and either issues incomplete documents or gives up.

### 5. Batch-generation lifecycle and failure recovery are not specified deeply enough

- **Location:** FR-20; NFR-7; NFR-14–NFR-15
- **Trigger condition:** A 500-student job partially succeeds, the browser closes, the API restarts, a PDF renderer times out, or the user retries after an ambiguous failure.
- **Guard snippet:** Define batch states (`Validating`, `Ready`, `Queued`, `Rendering`, `Partially completed`, `Completed`, `Failed`, `Cancelled`), per-record states and failure reasons, durable progress, resume/retry behavior, idempotency key rules, downloadable failure report, and whether successful records are retained when others fail. Number allocation must occur once at a documented commit point.
- **Potential consequence:** Duplicate document numbers, missing issue-register rows, irreconcilable partial ZIPs, or repeated printing of different versions from the same apparent batch.

### 6. The issuance moment and source-data snapshot are ambiguous

- **Location:** FR-19; FR-22; NFR-14
- **Trigger condition:** Student data, marks, fee allocation, or a template changes between preflight, preview, queued rendering, generation completion, and publication.
- **Guard snippet:** Define when source data is frozen and what action constitutes issuance. The confirmation screen should display a data snapshot timestamp and version identifiers; queued jobs must either use that frozen snapshot or force revalidation when stale. Distinguish `Preview`, `Generate draft PDF`, `Issue`, and `Publish/share` if they have different legal/audit effects.
- **Potential consequence:** The preview and issued PDF differ, or two documents created from one batch contain inconsistent data without a comprehensible audit trail.

### 7. Correction, cancellation, reprint, reissue, supersession, and revocation are not mapped to office language

- **Location:** FR-17; FR-22; FR-31; Glossary
- **Trigger condition:** A clerk spots a typo after printing, a receipt payment is reversed, a report card mark is corrected, an ID card is lost, or a transfer certificate is cancelled.
- **Guard snippet:** Provide document-type-specific actions and explanations: `Reprint same issued file`, `Correct source data and issue replacement`, `Cancel/reverse transaction`, `Revoke`, and `Mark lost`. Show whether the old number remains valid, whether the replacement gets a new number, and what parents/verifiers see. Require a reason and confirmation where status changes.
- **Potential consequence:** Staff use “reissue” for fundamentally different cases, creating accounting conflicts, duplicate certificates, or an inaccurate public verification history.

### 8. Human-readable numbering is too open-ended for Indian school registers and statutory documents

- **Location:** FR-13; FR-31; §13 Open Question 3
- **Trigger condition:** Schools require separate receipt books, campus/branch prefixes, financial-year resets, transfer-certificate register numbers, manual legacy numbers, or preprinted stationery ranges.
- **Guard snippet:** Specify sequence ownership, reset periods, branch/campus scope, fiscal versus academic year, gap handling, concurrency, voided numbers, offline/manual imports, and immutable ledger behavior. Provide safe presets per document type and show the next number before confirmation without reserving it indefinitely.
- **Potential consequence:** Duplicate or skipped receipt/certificate numbers, broken reconciliation with physical registers, and resistance from accountants or school management.

### 9. The freeform canvas and the promised variable-data safety are in tension

- **Location:** FR-4–FR-9; §10 MVP Scope; Risk “Editor complexity”
- **Trigger condition:** A user freely positions fields and tables, then real names, bilingual text, remarks, fee lines, or subject rows exceed the designed space.
- **Guard snippet:** Define layout modes per element: fixed/clipped, shrink-to-fit with minimum font, grow container, flow to next page, and block generation. Prefer structured zones for report cards, receipts, and letters; reserve unrestricted positioning for overlays, ID cards, and decorative elements. Include visible test-case switching and a multi-record “stress preview.”
- **Potential consequence:** Templates pass with one preview student but break for the actual class, undermining the claimed 95% batch-success target.

### 10. Template comparison and rollback are named but not usable as currently specified

- **Location:** FR-23
- **Trigger condition:** An administrator needs to understand what changed between the active version and a new draft or restore a version after documents have already been generated.
- **Guard snippet:** Define compare output for element moves, field-binding changes, conditional rules, page settings, assets, and affected scopes. Before activation, show a concise impact summary and representative before/after previews. “Restore” must create a new version and clearly state that issued documents remain untouched.
- **Potential consequence:** Users activate materially different templates based only on version names, then cannot confidently diagnose why printed output changed.

### 11. Shared asset replacement lacks consent, signatory, and departure workflows

- **Location:** FR-24; FR-25; NFR-11
- **Trigger condition:** A principal changes, a signature authorization expires, a stamp is uploaded by mistake, or one signature is valid only for selected document types and dates.
- **Guard snippet:** Add asset validity dates, signatory name/role, authorized document types, approval/status, usage preview, and “used by” dependency view. Prevent deletion while referenced; retiring an asset must not deactivate old versions but should warn on new issuance from an active template that still uses it.
- **Potential consequence:** Schools issue documents with an outdated or unauthorized signature while historical audit remains technically intact but operationally misleading.

### 12. Public verification does not cover school-domain and tenant-lifecycle failure states

- **Location:** FR-15–FR-17; §13 Open Question 6; NFR-9–NFR-13
- **Trigger condition:** A school subscription lapses, the school closes, changes its name/domain, data is migrated, a token is abused, or verification service is unavailable during admission/employment checks.
- **Guard snippet:** Define platform-owned stable verification URLs, tenant suspension behavior, retention guarantees, offline/unavailable messaging, token rotation, abuse throttling that does not make valid verification unusable, and a verifier support/escalation path. Specify whether school branding may change while the issued canonical identity remains historical.
- **Potential consequence:** Previously valid printed documents become unverifiable or appear fraudulent because of a commercial/account transition unrelated to authenticity.

### 13. QR verification needs stronger copy-resistance guidance than “compare the summary”

- **Location:** FR-16; Risk “Fraudulent visual copying”
- **Trigger condition:** A genuine QR image is copied onto an altered document that retains the same visible student name and date but changes marks, amount, or entitlement.
- **Guard snippet:** Define a document-type-specific canonical fingerprint shown on verification: for report cards, class/session and result status; for receipts, masked payer/student, amount, transaction date, and payment status; for certificates, certificate purpose and key issuance metadata. Reveal only the minimum comparison fields and show an explicit “Do these details match the paper?” checklist.
- **Potential consequence:** A verifier sees a green `Valid` status and accepts an altered document even though the token only proves the existence of the original issue.

### 14. Print production workflows common in school offices are missing

- **Location:** FR-4; FR-20–FR-21; NFR-2–NFR-3
- **Trigger condition:** Staff print duplex ID cards, several cards per A4 sheet, preprinted letterhead, two receipt copies, perforated challans, monochrome laser output, or PDFs at a local print shop.
- **Guard snippet:** Add printer-oriented output profiles: single/duplex, front-back alignment, crop marks, card imposition, copies per document (`School`, `Parent`, `Bank`), preprinted-letterhead margin mode, grayscale preview, and a test-page calibration flow. Treat browser print as secondary to generated print-ready PDF.
- **Potential consequence:** Correct on-screen designs waste stationery, misalign card backs, clip on common printers, or require staff to rebuild layouts outside Cultivate.

### 15. Language support is reduced to fonts, but bilingual school documents require layout and data rules

- **Location:** FR-6; FR-11; NFR-4; §13 Open Question 2
- **Trigger condition:** A certificate displays English and Hindi/Marathi/Bengali text together, transliterated names differ from official records, or a font fallback changes line height and wrapping.
- **Guard snippet:** Define bilingual field pairs, language-specific static copy, per-language font fallback, numeral/date preferences, line-height validation, and missing-translation handling. Make language variants either explicit template versions or explicit layers—not silent automatic translation.
- **Potential consequence:** Official names and legal wording are inconsistent across languages, while layouts that passed English preview overflow in the issued regional-language version.

### 16. Permissions do not explicitly govern access to sensitive preview identities and downloadable batch files

- **Location:** FR-18; FR-20–FR-21; FR-27; NFR-10–NFR-13
- **Trigger condition:** A template designer without normal access to all student marks/fees previews real records, or a batch ZIP containing hundreds of children’s documents remains downloadable after generation.
- **Guard snippet:** Separate permissions for sample preview, real-record preview, field categories, batch file access, and delivery. Default template designers to sanitized samples. Define signed download expiry, batch artifact retention, watermarking for previews, and audit of exports containing many records.
- **Potential consequence:** The editor becomes an indirect route to sensitive records, and bulk PDF/ZIP artifacts outlive the operational need that justified access.

### 17. Custom Letter in the MVP can become an uncontrolled mail-merge escape hatch

- **Location:** §5.5; FR-10–FR-12; FR-32; §10 MVP Scope
- **Trigger condition:** A school uses Custom Letter to reproduce document types whose protected fields, approvals, calculations, numbering, verification summary, or retention policy have not been modeled.
- **Guard snippet:** Limit Custom Letter to an explicit safe field set, configurable operator text, and non-verified output in MVP. Do not allow it to mimic receipts, report cards, transfer certificates, or salary slips. Show a visible `Custom document` classification in the Issue Register and verification behavior.
- **Potential consequence:** Users bypass document-specific truth and governance while the output still looks officially endorsed by Cultivate.

### 18. Contextual generation entry points lack a consistent selection and exclusion model

- **Location:** §4.2; FR-19–FR-21
- **Trigger condition:** A clerk generates for “Class 5-A” while some students are inactive, newly admitted, withdrawn, fee-blocked, absent, not registered for an exam, or already issued.
- **Guard snippet:** For each document type, define default inclusion rules, visible filters, exclusion reasons, duplicate-issued warnings, and a reviewable recipient list. Preserve the chosen population as part of the Batch audit and require explicit confirmation when reissuing already-issued records.
- **Potential consequence:** The wrong students receive documents, eligible students are omitted, or duplicate official documents are created without the operator noticing.

### 19. Phone generation is included without a clear operational reason and expands the highest-risk surface

- **Location:** UJ-5; FR-29; §10 MVP Scope; SM-7
- **Trigger condition:** The team must support generation, bulk data warnings, PDF preview, sharing, permissions, and durable batch state on phones while the primary stated design and office workflow is desktop/laptop.
- **Guard snippet:** Remove phone generation as an MVP launch gate unless pilot evidence proves it essential. In the first release, phone may view/download already issued documents; creating or issuing official records should remain in the desktop contextual workflow.
- **Potential consequence:** Engineering and QA effort is diverted from editor reliability and issuance correctness, while small-screen confirmation increases the chance of issuing the wrong population or template.

### 20. The MVP combines too many novel systems to validate safely in one release

- **Location:** §10 MVP Scope; §11 Success Metrics
- **Trigger condition:** The launch requires a freeform editor, ten document types, dynamic tables, asset versioning, scope inheritance, bulk rendering, public verification, numbering, revocation, issue register, audit, mobile operation, and language/print quality simultaneously.
- **Guard snippet:** Split delivery into vertical slices. First: shared brand setup, constrained templates, preflight, batch PDF, immutable issuance, and issue register for Admit Card, Report Card, and Payment Receipt. Second: ID cards and certificates with QR verification and lifecycle actions. Third: general canvas, remaining document types, custom letters, and mobile issuance. Define success criteria per slice.
- **Potential consequence:** A broad but unreliable launch fails on the office’s core need—correct, printable documents—and makes it difficult to learn which part of the product creates value.

### 21. Default-template ownership and update communication are incomplete

- **Location:** FR-1–FR-2; FR-23
- **Trigger condition:** Cultivate fixes a layout, compliance phrase, barcode size, or field binding in a Default Template already duplicated or used directly by schools.
- **Guard snippet:** Define whether a school can activate a Cultivate-managed default directly, how updates are announced, whether security/scanability fixes are mandatory, and how a school compares or adopts an update without losing customization. Record the base-default version from which each School Template originated.
- **Potential consequence:** Schools remain on broken defaults indefinitely or receive unexpected changes that contradict the promise that templates never change silently.

### 22. The PRD does not define accessibility and keyboard behavior for inherently spatial editing

- **Location:** FR-5; NFR-5
- **Trigger condition:** A keyboard user needs to place, size, align, order, or inspect overlapping elements, while NFR-5 only says non-spatial actions must be keyboard-operable.
- **Guard snippet:** Specify a layer-list/property-panel editing path that supports selecting every element, numeric position/size entry, ordering, grouping, locking, alignment, deletion, and accessible announcements without direct canvas manipulation. Define focus order and undo behavior.
- **Potential consequence:** The editor technically passes limited control contrast checks while remaining unusable for keyboard and assistive-technology users.

## Recommended MVP Boundary

The minimum credible release is not “all templates with fewer advanced controls.” It is a small number of complete issuance workflows sharing one reliable engine:

- Admit Card: exam/student readiness, class batch, printable combined PDF, reprint and replacement.
- Report Card: marks/result readiness, long-table stress preview, class batch, publish and corrected replacement.
- Payment Receipt: immutable transaction binding, safe numbering, print/share, reversal and verification status.
- Shared foundation: school brand setup, constrained layout zones, draft/publish/active lifecycle, preflight repair loop, durable batch states, Issue Register, exact-file reprint, permissions and audit.

Student ID cards should follow after duplex/sheet-print calibration is proven. Bonafide and transfer certificates should follow after sequence/register and correction rules are agreed. The freeform canvas should be introduced only after structured templates reveal where schools genuinely need unrestricted placement.
