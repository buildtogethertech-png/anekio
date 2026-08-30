# Security, Privacy, Identity, and Compliance Review

**Artifact reviewed:** `prd.md` — Cultivate Document Studio  
**Review date:** 2026-08-28  
**Scope:** Product-requirement gaps affecting child privacy, school/tenant isolation, identifiers, QR and barcode verification, issuance integrity, abuse resistance, auditability, and India-specific compliance boundaries. This is not an implementation or legal-opinion review.

## Verdict

**Promising foundation, but not ready for launch approval.** The PRD makes several good foundational choices: opaque verification tokens; separation of Entity Code, Document ID, and Document Number; immutable template versions; retained rendered output and file hash; school-scoped permissions; reissue/revoke flows; and an explicit prohibition on using Aadhaar as an identifier.

However, the document still leaves launch-critical product behavior ambiguous. The largest gaps are: no precise issuance state model; insufficient safeguards for public verification of children’s documents; weak lifecycle requirements for tenant closure, school transfer, retention, and erasure; incomplete identifier and numbering invariants; optional audit of sensitive exports/shares; and no product requirements for compromised QR codes, copied QR images, leaked signature/stamp assets, or abusive bulk operations. India-specific privacy and statutory-document boundaries are acknowledged but mostly deferred to “legal validation,” which is too open-ended for acceptance.

**Recommended gate:** Resolve all P0 findings and convert the compliance boundary into explicit pre-launch decisions before verification, public sharing, or official financial/academic documents ship.

## What the PRD Already Gets Right

- A Document ID is distinct from a school-visible number and from a long-lived Entity Code.
- Verification QR codes contain an opaque token rather than student data or predictable document numbers.
- Public verification is explicitly minimal and does not expose marks, fees, contact information, address, or full date of birth by default.
- Generated documents retain their rendered file, hash, template version, issuer, timestamp, and source data information.
- Published templates and generated outputs are immutable through normal operations.
- Reissue creates a new identity and preserves the original history.
- Cross-school access is prohibited, and permissions are separated by task and Document Type.
- Aadhaar is explicitly excluded from QR payloads and identifier roles.
- The PRD correctly warns that a genuine QR image can be copied to a different document.

These should remain hard invariants during future product and architecture work.

## Priority Findings

### P0-1 — “Generated,” “issued,” “published,” and “delivered” are not a defined state machine

FR-19 says Generation creates an immutable Generated Document and Issue Register entry. FR-21 separately records publication, while FR-16 calls a verification result Valid. The PRD does not define whether a previewed/downloaded-but-never-approved document is official, whether verification is active immediately on generation, or what happens when a bulk job generates files but delivery fails.

This ambiguity can make drafts look official, consume legally meaningful receipt/document numbers prematurely, expose public verification before school approval, and make retries produce conflicting “valid” documents.

**Required product decision:** Define one lifecycle with allowed transitions and permissions. At minimum distinguish `Draft render`, `Generated`, `Approved` where applicable, `Issued`, `Delivered/Published`, `Superseded`, `Revoked`, `Expired`, and `Generation failed`. State explicitly:

- when the Document ID and human-readable number are allocated;
- when the QR becomes publicly resolvable;
- which state may be printed or shared;
- whether a downloaded generated file is automatically considered issued;
- which states are terminal;
- how partial batch success is represented;
- how abandoned outputs and reserved sequence numbers appear in the register;
- how a correction differs from reprint, re-download, regeneration, reissue, and revocation.

Acceptance should require that no draft, failed, or unapproved output can appear `Valid` in public verification.

### P0-2 — Public verification of a child’s document needs an explicit privacy policy, not only masking

FR-16 proposes showing school identity, document type, number, issue date, masked subject identity, and status without login. Even masked information can confirm that a child is enrolled, received a certificate, sat an exam, uses transport, or has a school-issued record. Document Number and issue date can also be correlated with a paper copy. The PRD does not define which document types are public-verifiable, who enables this, whether parents can object, how long the page remains public, or whether search engines/link previews may retain it.

**Required product decision:** Create a verification disclosure matrix per Document Type. Each row must specify:

- whether public verification is allowed, school-configurable, authenticated-only, or prohibited;
- exact public fields and masking behavior;
- lawful/authorized basis and required school/parent notice or consent;
- verification lifetime and expiry behavior;
- whether an adult employee can control their own public record;
- how the subject/guardian can request correction, withdrawal, or access;
- behavior for revoked, expired, transferred, and deleted records.

Use `status only` as the default for child-sensitive categories unless a documented use case requires more. Public verification pages must not be discoverable through browsing, search, school-wide lookup, or predictable identifiers. The product must make public-verification enablement a deliberate, documented school decision rather than a template-side checkbox.

### P0-3 — Retention, erasure, correction, and immutability conflict is unresolved

FR-22 and NFR-16 require immutable outputs and snapshots. NFR-13 mentions retention, correction, deletion/export controls, but Open Question 4 leaves retention unresolved. It is unclear whether a source snapshot contains full child data, how long PDFs remain after a student leaves, what happens on a valid deletion/correction request, or what schools can retain for statutory/defensive reasons.

**Required product decision:** Define a data-lifecycle matrix before launch, by Document Type and artifact class: template, asset, preview cache, source snapshot, generated PDF, batch ZIP, verification record, delivery copy/link, and audit event. For each, state:

- purpose and minimum data retained;
- default and configurable retention period;
- school archival/legal-hold options and authority;
- correction mechanism without historical rewriting;
- deletion, anonymization, or cryptographic erasure behavior;
- what remains in audit after content deletion;
- behavior when the student/employee leaves, the school terminates Cultivate, or the tenant is deleted;
- export/return obligations at contract termination.

“Immutable” should mean tamper-resistant history, not indefinite retention of every child-data copy. If a historical PDF must be removed, the register can retain a minimal tombstone and hash/status without keeping the personal-data payload, subject to the approved policy.

### P0-4 — Tenant isolation is stated but not specified across the full lifecycle

NFR-12 prohibits cross-school access, but the requirements do not cover school code collisions, verification-token ownership, template copying, user membership in multiple schools, school merges, student transfers, shared devices, custom domains, backups/exports, or deletion of a tenant. Public verification is especially ambiguous because it intentionally bypasses authenticated tenant access.

**Required product decision:** Define school ownership as immutable metadata for every template, version, asset, document, batch, token, sequence, snapshot, delivery link, and audit event. Product acceptance must cover:

- no cross-school search, scan result, autocomplete, preview sample, batch inclusion, export, or public-token fallback;
- a user switching schools must see an explicit active-school context before generation or asset use;
- transferring a student never transfers previously issued documents or verification authority to the new school;
- copied templates must strip source-school assets, records, identifiers, verification tokens, and signatures unless an explicit authorized transfer exists;
- school closure or account termination has a defined verification and export outcome;
- domain changes never break or silently redirect tokens to a different tenant;
- `Not Found` behavior must not reveal whether a token belongs to another school.

### P0-5 — Audit requirements are too narrow and make sensitive delivery logging optional

FR-21 makes direct download/share logging dependent on school policy. That is unsafe for report cards, salary slips, ID cards, transfer certificates, fee records, bulk ZIPs, signatures, and stamps. FR-28 also omits viewing sensitive generated documents, exporting registers, failed authorization attempts, permission changes, verification-setting changes, sequence changes, and bulk data exports.

**Required product decision:** Mandatory audit should cover, at minimum:

- view/open of sensitive generated documents;
- preview with real data;
- download, print request, portal publication, external share, link creation, and link revocation;
- batch creation, composition, partial failure, retry, and export;
- template/asset view and download where signatures or stamps are involved;
- role and permission changes;
- sequence and verification-setting changes;
- public verification abuse signals and administrative access to them;
- denied cross-school or unauthorized attempts;
- audit search/export itself.

Specify who can view audit history, retention, exportability, correction annotations, time-zone presentation, and whether subjects/guardians can receive a disclosure of access where required by school policy. Audit records must remain append-only and visibly distinguish actor action from automated system action.

### P0-6 — India compliance is acknowledged but not converted into a launch boundary

The PRD cites the DPDP Act and mentions future legal validation, but it does not name the product decisions that must be completed before launch. Child-data processing, public verification, parent/guardian authority, employee documents, fee documents, statutory numbering, board/state-specific forms, grievance/correction flows, and cross-border service dependencies cannot remain a single generic NFR.

**Required product decision:** Add a compliance readiness gate owned jointly by product/legal/security before pilot release. It should approve at least:

- Cultivate’s and the school’s respective roles and responsibilities for each workflow;
- age/child treatment and how verifiable guardian authorization, notice, and withdrawal are handled where applicable;
- permitted purposes for previews, generation, verification, delivery, and analytics;
- retention/deletion schedules and response flows for access, correction, erasure, and grievances;
- incident/breach escalation responsibilities and school notification workflow;
- cross-border processing/storage and subprocessors, if any;
- state board/CBSE/other-board language and layout disclaimers;
- GST/financial-document rules and sequence/cancellation behavior for document types represented as invoices, receipts, or credit notes;
- employee salary/privacy access requirements;
- accessibility and supported Indian-language/font validation.

The PRD should say that unsupported jurisdiction- or board-specific templates are branded as school-created/custom, not “compliant” or “officially approved” by Cultivate.

## High-Priority Findings

### P1-1 — Identifier invariants are incomplete

The three-identifier model is good, but requirements do not define school codes, Entity Code reassignment, Document Number collision domains, sequence resets, manual overrides, check-digit validation, or concurrent/bulk issuance. A globally unique Document ID alone does not prevent schools from accidentally issuing duplicate visible numbers.

Add requirements that:

- Entity Codes are never silently reassigned to a different person or record;
- Document IDs and Verification Tokens are system-controlled and non-editable;
- sequence scope is explicit per school, document type, financial year/session, and series;
- number formats are previewed and collision-checked before activation;
- sequence resets and manual changes require elevated permission, reason, warning, and audit;
- voided/cancelled numbers remain visible in sequence history and are not reused;
- bulk/concurrent issuance cannot allocate the same number twice;
- Verify IDs include error detection and cannot be used to enumerate adjacent records;
- school-visible codes and numbers may be printed, but never function as authorization secrets.

### P1-2 — A copied genuine QR remains too easy to misuse

The verification page advises comparison with a canonical summary, but the required summary may be too weak to distinguish a genuine receipt/report card from a forged document carrying a copied QR. Conversely, showing enough fields to prevent substitution could violate child privacy.

Add a configurable authenticity comparison design per Document Type. Options should include a short, privacy-safe fingerprint of canonical content; clear display of masked recipient plus document-specific non-sensitive anchors; and an authenticated path for authorized verifiers who need more detail. Consider allowing a verifier to upload or select a PDF for exact file-hash comparison without making the document content public. Explicitly state that visual seals, barcodes, watermarks, and QR images are not independent proof.

### P1-3 — Token compromise and verification lifecycle are underspecified

“Revocable” is not enough. There is no flow for a leaked token, accidentally shared verification URL, QR replacement, public-verification disablement, or verification-domain migration.

Require:

- rotation of a compromised Verification Token without changing the immutable Document ID;
- immediate invalidation of the prior token with a non-revealing response;
- an audit reason and link to the replacement token/document state;
- school-wide emergency suspension of public verification;
- per-document-type and per-document disablement;
- a stable first-party verification domain or a migration plan that preserves trust;
- clear offline/no-network behavior so “cannot connect” is never shown as “valid.”

### P1-4 — Barcode requirements may expose predictable student or employee codes

FR-14 permits binding Code 128 directly to Entity Code or Document ID. A student ID card or bus pass is frequently visible and lost; a predictable entity code can enable enumeration or reveal internal identifiers. The product does not distinguish a human-visible lookup code from a bearer credential.

Define barcode modes by use case:

- `Lookup only`: resolves only after authenticated, school-scoped authorization and carries no access right;
- `Presentation token`: short-lived or revocable where the barcode functions as a gate/library/transport credential;
- `Verification`: uses the opaque verification mechanism, not a raw Entity Code.

Default public-facing cards away from raw internal primary identifiers. Lost/stolen cards need deactivate/reissue behavior, and scans must not reveal more information than the scanning role can already access.

### P1-5 — Signature, stamp, letterhead, and photo assets need stronger product governance

Versioning and permission checks are specified, but high-risk asset abuse remains possible. A staff member with template access could copy or export a principal’s signature, place it on an unauthorized custom letter, or generate documents after authority changes.

Add requirements for:

- separate permission to use versus manage/download sensitive assets;
- allowed document types, scopes, issuer roles, validity dates, and approval requirements per signature/stamp;
- automatic block after an authorized signatory’s authority expires or is revoked;
- visible “sample/not valid” watermark on draft and sample previews;
- prevention of extracting original signature/stamp files through ordinary template use;
- mandatory audit of every issuance using a protected signature or stamp;
- emergency deactivation and impact view listing affected active templates;
- explicit distinction between a visual signature image and a cryptographic/digital signature.

### P1-6 — Delivery and sharing requirements do not protect the recipient sufficiently

“Share through supported communication channels” does not state how the intended parent/employee is selected, whether a wrong recipient can be recalled, whether links expire, or what happens when phone numbers/accounts change. Sending salary slips or report cards through generic links creates material privacy risk.

Add delivery-channel policies by Document Type, including recipient eligibility, confirmation before bulk send, masked destination preview, link expiry, access authentication where appropriate, revocation, failed-delivery handling, resend behavior, portal visibility periods, and removal after student/employee departure. Combined PDFs and ZIP files should be excluded from external sharing by default because they contain multiple subjects.

### P1-7 — Preview with “real data” is a separate disclosure event

FR-18 allows any eligible real record or sanitized sample data. It does not say which records an editor can select, whether template editors who cannot access marks/fees may preview those fields, or whether screenshots/downloads are restricted. A template editor could gain child data through the preview surface.

Require sanitized samples by default. Real-record preview must inherit source-module permissions, school/class scope, purpose, and field-level masking; it must be audited for sensitive types; search must not reveal unauthorized people; and preview output must carry a visible non-official watermark and must not be shareable as an issued document.

### P1-8 — Bulk generation and export abuse controls are missing

FR-20 supports 500-document batches and ZIPs but has no elevated authorization, confirmation of population, anomaly detection, daily thresholds, or second-person approval for especially sensitive exports. A compromised office account could exfiltrate the entire school.

Require a pre-issuance summary showing school, session, population, exclusions, document type, recipient count, template version, delivery action, and sensitive fields. Separate bulk permissions from single-document permissions as already contemplated, then add school-configurable thresholds or approval for high-risk types. Provide cancel-before-issuance, partial-result visibility, expiring exports, and audit of who downloaded combined files.

### P1-9 — Custom QR and custom content can become a phishing or harmful-link channel

The PRD distinguishes verification QR from Custom URL QR visually, but does not define whether arbitrary URLs are permitted, how users/recipients recognize non-Cultivate links, or whether administrators can embed misleading verification text.

Require domain display and a clear “External link—not verified by Cultivate” treatment in the editor and generated-document guidance. Schools should be able to disable custom URLs. Verification badges or labels must be reserved for system verification elements and unavailable as ordinary assets/text styles. Template validation should warn when a custom element visually imitates Cultivate Verify.

## Medium-Priority Findings

### P2-1 — Public verification abuse and enumeration need measurable outcomes

NFR-9 mentions rate limiting but provides no product behavior under scraping or repeated guessing. Add acceptance outcomes: generic responses for invalid tokens; no indication whether a school/student/document exists; escalation/challenge behavior after suspicious volume; school-facing visibility into verification activity without exposing verifier personal data unnecessarily; and a support process for falsely blocked legitimate verifiers.

### P2-2 — The document catalogue contains legally ambiguous names

“Date-of-birth certificate issued from school records,” “migration support letter,” “transfer certificate,” and financial forms can be mistaken for government-, board-, or tax-authorized documents. Add canonical display names and disclaimers per jurisdiction/board. For example, distinguish a school record extract from a civil birth certificate and a school-issued support letter from a board migration certificate. Defaults should never imply statutory authority that the school or Cultivate does not possess.

### P2-3 — Revocation and correction reasons need controlled disclosure

FR-17 requires a reason but does not say whether it is internal, public, or shown to the subject. Free-text reasons could expose disciplinary, financial, or child-sensitive information on a public page. Define structured reason categories plus restricted internal notes, and specify the public-safe message separately. Corrected personal data should produce a linked replacement without repeating the erroneous sensitive value in public history.

### P2-4 — Issue Register search can itself leak sensitive data

FR-26 allows search by recipient and Entity Code. Requirements should specify field-level result redaction, minimum search length, role-scoped document categories, no cross-type inference, controlled export, and audit of sensitive searches. A user allowed to issue admit cards should not automatically discover salary slips or fee disputes in the same register.

### P2-5 — Verification needs accessible non-smartphone alternatives

The Verify ID is a useful start, but the PRD does not explicitly require a manual first-party verification path, accessible status wording, or school contact/escalation when a document is revoked or not found. Add a typed Verify ID path with checksum validation, equivalent privacy protections, accessible status explanations, and a safe school contact channel that does not expose a child or verifier.

### P2-6 — Data provenance shown to issuers is too vague

FR-19 shows a data timestamp, but administrators also need to know which source records are stale, provisional, unpublished, corrected, or missing. Define document-specific preflight provenance and freshness rules. High-impact fields such as legal name, date of birth, marks, attendance, fee amount, and employment compensation should show their authoritative source and block issuance when the source state is not eligible.

### P2-7 — Operational ownership for privacy and security incidents is absent

Add product workflows for a school to report a leaked document, copied QR, exposed bulk ZIP, unauthorized signature use, wrong-recipient delivery, or suspected account compromise. The workflow should capture affected documents/batches, allow containment (revoke links/tokens, suspend delivery/verification, deactivate assets), preserve evidence, and notify the right school/Cultivate administrators according to approved policy.

## Suggested Requirement Additions

The following requirement groups would close most gaps without prescribing implementation:

1. **Document issuance lifecycle:** canonical states, transitions, allocation points, retry semantics, batch partial success, and public-validity rules.
2. **Verification disclosure policy:** per-type public/authenticated/prohibited modes, exact fields, enablement authority, lifetime, withdrawal, and subject rights.
3. **Identifier and sequence governance:** immutability, collision domains, non-reuse, voids, check digits, manual changes, concurrency, and audit.
4. **Artifact retention matrix:** rendered files, snapshots, audit tombstones, exports, previews, assets, tokens, and school-termination outcomes.
5. **Protected asset governance:** signature/stamp authorization, usage scope, expiry, approvals, deactivation, watermarking, and audit.
6. **Secure delivery policy:** recipient confirmation, authentication, expiry, revocation, multi-subject export restrictions, and wrong-recipient response.
7. **Sensitive operation audit:** real-data previews, views, downloads, prints, shares, exports, permission changes, sequence changes, denied access, and audit export.
8. **Tenant lifecycle isolation:** multi-school users, transfers, template copies, school closure, domain changes, backups/exports, and generic failure behavior.
9. **India launch compliance gate:** explicit decision checklist and named owner rather than a general promise of later legal validation.
10. **Abuse and incident response:** enumeration, mass export, compromised QR, leaked asset, wrong-recipient delivery, emergency suspension, and evidence preservation.

## Recommended New Open Questions

1. Which Document Types are public-verifiable, authenticated-verifiable, or never externally verifiable by default?
2. Exactly when does a generated output become an official issued document and begin resolving as `Valid`?
3. What artifact and audit data remains after a valid erasure request or school termination, and for how long?
4. Who may enable public verification and protected signature/stamp use, and when is dual approval mandatory?
5. What happens to public verification when a school closes, changes domain, leaves Cultivate, or loses account access?
6. Which channels may deliver report cards, ID cards, salary slips, and fee records, and what authentication/expiry is required for each?
7. What product behavior is required when a verification token, signature, stamp, batch ZIP, or delivery link is compromised?
8. Which numbering rules are statutory or board-specific, and which formats are merely school preferences?
9. May a parent/guardian disable public verification of a child’s document, and how is a legitimate third-party verification then supported?
10. Which Indian state boards and languages are explicitly supported at launch, and how are unsupported variants labeled?

## Launch Acceptance Gate

Before public verification or official-document issuance is enabled for pilots, evidence should show that:

- every output has an unambiguous issuance state and no non-issued output verifies as valid;
- public verification disclosure has been approved per Document Type;
- cross-school isolation has been exercised across templates, assets, previews, batches, exports, verification, and school switching;
- identifiers and visible sequences cannot collide, be reused, or act as authorization secrets;
- lost/compromised tokens, cards, links, signatures, and stamps can be contained without deleting history;
- downloads, shares, bulk exports, protected-asset use, and sensitive views are mandatorily auditable;
- retention, correction, erasure, school termination, and transfer behavior is documented and accepted;
- wrong-recipient and mass-export risks have product controls and incident workflows;
- India-specific privacy, child-data, financial-document, employment-document, and board/state boundaries have named owners and recorded approval;
- generated defaults and marketing claims do not overstate legal, board, government, or cryptographic validity.

