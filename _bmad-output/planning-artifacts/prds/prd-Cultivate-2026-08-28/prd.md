---
title: Cultivate Document Studio
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# PRD: Cultivate Document Studio

## 0. Document Purpose

This PRD defines a shared document-template, generation, and verification capability for Cultivate. It is intended for product, UX, architecture, engineering, and QA. Requirements are grouped by capability with stable IDs; inferred decisions are marked `[ASSUMPTION]` and indexed at the end. Detailed visual design and technical architecture are downstream artifacts.

## 1. Vision

Cultivate Document Studio gives an Indian school one place to design every official document it issues while keeping generation inside the workflow where the document is needed. A school administrator designs and activates templates from **Settings → Document templates** on a laptop or desktop. Staff then generate report cards from Exams, receipts from Fees, ID cards and certificates from Students, and employee documents from Employees without returning to the designer.

The product combines production-ready defaults with a full desktop canvas. A small school can add its logo, signatures, and colours and begin immediately; an advanced school can position fields, tables, photographs, signatures, stamps, QR codes, and barcodes precisely. Every generated document can receive its own traceable identity and, where enabled, a privacy-safe verification experience.

The product thesis is that document design should be centralized, but document generation should remain contextual. Cultivate should become the source of truth for both the data shown on a document and the exact version that was issued.

## 2. Target Users

### 2.1 Jobs To Be Done

- A school owner or administrator wants all official documents to share the school’s identity without depending on a designer for routine changes.
- An office administrator wants to start from a credible default, preview real data, and generate hundreds of correct documents in one operation.
- An exam controller wants admit cards and report cards to use current exam, subject, marks, attendance, and student data.
- A fee collector wants invoices and receipts to be generated from the fee ledger rather than retyped.
- A student, parent, employer, or receiving school wants to verify that a document is authentic without gaining access to unrelated personal data.
- An authorized staff member on a phone wants to select an active template, generate, preview, download, print, or share a document without editing its layout.

### 2.2 Non-Users in v1

- Professional graphic designers needing illustration, photo-editing, animation, or publishing-suite capabilities.
- External organizations authoring templates without a Cultivate school account.
- Students and parents modifying official templates or generated records.

### 2.3 Key User Journeys

- **UJ-1. Asha activates the school’s first report-card template.** Asha is the school administrator working on a laptop. From Settings, she opens Document templates, chooses a Formal report-card default, applies the school logo, colours, principal signature, and stamp, previews it with a real student, fixes an overflowing remarks field, and activates it for classes 1–5. The active version becomes available from Exams without changing previously issued report cards.
- **UJ-2. Ravi generates admit cards for a class.** Ravi is the exam controller. From an exam sitting, he chooses Generate admit cards, confirms the active template and included students, reviews warnings for missing photographs or roll numbers, and generates one PDF package plus individual student records. Cultivate records who generated them and the template version used.
- **UJ-3. Meena issues a verifiable payment receipt.** Meena records a cash payment in Fees. Cultivate generates the receipt from the fee transaction, assigns an immutable receipt number and Document ID, renders the school’s active receipt template, and makes it available to print or share. Scanning its QR code shows a limited verification result, not the student’s full fee history.
- **UJ-4. Arjun verifies a certificate.** Arjun receives a bonafide certificate outside the school. He scans its QR code, sees the school name, document type, masked student identity, issue date, and status, and can tell whether it is valid, superseded, or revoked. No login is required for the limited result.
- **UJ-5. Neha handles a document from her phone.** Neha is an authorized office employee away from her desk. She opens a student record, selects an active certificate template, previews the populated document, generates it, and shares the PDF. She cannot reposition fields or change the master template on the phone.

## 3. Glossary

- **Document Type** — A supported business document such as Report Card, Admit Card, Student ID Card, or Payment Receipt.
- **Default Template** — A Cultivate-provided, ready-to-use design for a Document Type.
- **School Template** — A school-owned design created from a Default Template or a blank canvas.
- **Template Version** — An immutable published snapshot of a School Template. Generated Documents retain their Template Version.
- **Active Template** — The Template Version selected for a Document Type and an optional Scope.
- **Scope** — The school, session, class, document subtype, or other context to which an Active Template applies.
- **Canvas** — The desktop design surface where a Template Editor places and styles Elements.
- **Element** — A design object such as Text, Image, Dynamic Field, Table, Shape, Signature, Stamp, QR Code, or Barcode.
- **Dynamic Field** — A placeholder bound to Cultivate Data and resolved during Preview or Generation.
- **Cultivate Data** — Authorized school, student, guardian, employee, class, exam, attendance, fee, or transaction data already held by Cultivate.
- **Generated Document** — An immutable rendered output created for one Entity or Batch using a Template Version and Cultivate Data.
- **Entity Code** — A stable school-scoped identifier for a student, employee, invoice, exam, or other record; it may be rendered as text or a Barcode for internal lookup.
- **Document ID** — A unique identifier for one Generated Document, distinct from an Entity Code and Template Version.
- **Verification Token** — An opaque, revocable value encoded in a QR Code that resolves to a limited Verification Record without exposing personal data in the QR payload.
- **Verification Record** — The minimal public or authenticated status view for a Generated Document.
- **Batch** — A Generation operation producing multiple Generated Documents from one Template Version.
- **Issue Register** — The searchable audit record of Generated Documents, status changes, downloads, and reissues.

## 4. Information Architecture

### 4.1 Design and administration

**Settings → Document templates** contains:

- Overview
- Student documents
- Exam and academic documents
- Fee documents
- Employee documents
- Certificates and letters
- Brand assets
- Signatures and stamps
- Issue register
- Verification settings

### 4.2 Contextual generation

- **Students:** ID cards, admission documents, certificates, transfer documents, letters.
- **Exams:** admit cards, date sheets, seating slips, marksheets, report cards, result summaries.
- **Fees:** invoices, challans, receipts, statements, dues notices, no-dues certificates.
- **Employees:** ID cards, appointment documents, salary slips, experience and relieving documents.
- **Phone:** select, preview, generate, download, print, and share; no Canvas editing.

## 5. Document Catalogue

### 5.1 Student identity and administration

- Student ID card, including front/back and sheet-print layouts
- Admission form and admission acknowledgement
- Admission confirmation letter
- Student profile / cumulative record
- Bonafide certificate
- Study certificate
- Date-of-birth certificate issued from school records
- Character / conduct certificate
- Attendance certificate
- Promotion certificate
- Transfer certificate / school leaving certificate
- Migration support letter
- No-dues certificate
- Student undertaking / declaration
- Parent consent form
- Gate pass, library card, transport card, and bus pass

### 5.2 Exams and academics

- Admit card / hall ticket
- Exam date sheet
- Seating plan and desk slip
- Invigilator duty sheet
- Subject marksheet
- Report card
- Consolidated report card
- Grade sheet
- Result summary
- Progress report
- Achievement certificate
- Participation certificate
- Merit certificate

### 5.3 Fees and finance

- Fee invoice / demand note
- Fee challan
- Payment receipt
- Consolidated receipt
- Fee statement / ledger statement
- Outstanding-dues notice
- Late-fee notice
- Refund receipt / credit note
- Scholarship or concession confirmation
- Fee clearance / no-dues certificate

### 5.4 Employees

- Employee ID card
- Offer letter
- Appointment letter
- Confirmation letter
- Salary slip
- Experience certificate
- Relieving letter
- Service certificate
- Leave approval letter
- Warning / disciplinary letter
- Staff attendance statement

### 5.5 General school communication

- School letterhead
- Circular
- Notice
- Invitation
- Event pass
- Acknowledgement
- Mailing label and envelope
- Custom certificate
- Custom letter
- Custom blank document

`[ASSUMPTION: The catalogue is the long-term supported set; the MVP subset is defined in §10 and does not require every type at launch.]`

## 6. Features and Functional Requirements

### 6.1 Template Library and Defaults

**Description:** Administrators browse Document Types, preview Default Templates, create School Templates, and configure which Template Version is active for each Scope. Realizes UJ-1.

#### FR-1: Browse the template library

An authorized administrator can browse Default Templates and School Templates by Document Type, status, page format, and ownership.

**Consequences:**
- Each card shows a thumbnail, name, Document Type, page format, status, last editor, and last update.
- Search returns results by template name and Document Type.

#### FR-2: Start from a default or blank canvas

An authorized administrator can preview a Default Template, use it without modification, duplicate it into a School Template, or create a blank School Template.

**Consequences:**
- Cultivate provides at least Classic, Modern, Formal, and Compact defaults where the Document Type supports those variants.
- Updating a Cultivate Default Template does not silently alter an existing School Template.

#### FR-3: Activate templates by scope

An authorized administrator can activate one Template Version as the default for a Document Type and optionally override it for a session, class, or subtype.

**Consequences:**
- Cultivate shows the inheritance chain and warns about overlapping Scope rules.
- Contextual Generation resolves exactly one Active Template or explains why none is available.

### 6.2 Desktop Template Editor

**Description:** The Template Editor provides a full desktop Canvas with precise placement and safe handling of variable data. Phone editing is excluded. Realizes UJ-1.

#### FR-4: Configure pages

An authorized administrator can configure A4, A5, Letter, portrait, landscape, ID-card, and custom page dimensions with margins, bleed, and multiple pages.

**Consequences:**
- Print-safe and non-printable areas are visible on the Canvas.
- ID-card templates support front and back faces and multi-card sheet layouts.

#### FR-5: Place and manipulate elements

An authorized administrator can add, select, move, resize, rotate, duplicate, group, lock, hide, reorder, and delete Elements.

**Consequences:**
- The Canvas supports rulers, guides, grid, snapping, multi-select, alignment, equal spacing, zoom, undo, and redo.
- Locked Elements cannot be changed until unlocked.

#### FR-6: Style content

An authorized administrator can configure typography, colours, borders, backgrounds, opacity, spacing, alignment, and reusable school styles.

**Consequences:**
- Font selection clearly identifies fonts that cannot render the chosen language.
- A school can define reusable brand colours and type styles.

#### FR-7: Add supported elements

The Template Editor supports static Text, Dynamic Field, Image, school Logo, student/employee Photo, Shape, Line, Table, Repeating List, Signature, Stamp, QR Code, Barcode, page number, and page break Elements.

**Consequences:**
- Each Element exposes only properties meaningful to its type.
- Images support crop, fit, fill, aspect lock, and placeholder behavior.

#### FR-8: Design variable tables

An authorized administrator can configure Tables for marks, grades, attendance, fee lines, payments, subjects, and other repeatable Cultivate Data.

**Consequences:**
- Tables support headers, totals, conditional columns, row splitting rules, repeated headers, and overflow to additional pages.
- Preview includes short, typical, and long-data cases.

#### FR-9: Detect layout problems

Cultivate validates a School Template before activation or Generation.

**Consequences:**
- Warnings identify clipped text, missing required Dynamic Fields, out-of-page Elements, unreadable QR Codes or Barcodes, missing assets, and table overflow.
- Blocking errors prevent activation and explain the corrective action.

### 6.3 Data Binding and Conditional Content

#### FR-10: Insert authorized dynamic fields

The Template Editor exposes searchable Dynamic Fields appropriate to the Document Type and the administrator’s permissions.

**Consequences:**
- Fields are grouped into School, Session, Class, Student, Guardian, Employee, Exam, Subject, Attendance, Fee, Payment, and Document metadata.
- A preview clearly distinguishes static text from Dynamic Fields.

#### FR-11: Format values

An authorized administrator can configure date, number, currency, percentage, name, address, casing, masking, and empty-value formatting.

**Consequences:**
- Indian date, numbering, and currency formats are available by default.
- Empty values can render as blank, a configured fallback, or a blocking Generation warning.

#### FR-12: Apply conditional visibility

An authorized administrator can show or hide an Element based on supported rules, such as payment status, gender, transport enrolment, grade availability, or missing data.

**Consequences:**
- Rules use guided conditions rather than executable code.
- Preview can simulate each branch used by a Template Version.

### 6.4 Identity, QR Codes, Barcodes, and Verification

**Description:** **Cultivate Verify** distinguishes long-lived Entity Codes from unique Document IDs. Verification QR Codes provide public authenticity checks; Barcodes optimize internal scanning. Realizes UJ-3 and UJ-4.

#### FR-13: Assign document identities

Cultivate assigns a globally unique Document ID to every Generated Document and displays an optional human-readable Document Number based on a school-configured sequence.

**Consequences:**
- A Document ID is never reused, including after revocation or regeneration.
- Human-readable formats can include school code, Document Type, session/year, and sequence, for example `CPS-RC-2026-000123`.
- Cultivate also exposes a shorter human-readable Verify ID with a checksum when manual verification is enabled; it is never the predictable Document Number alone.

#### FR-14: Render barcodes for internal lookup

An authorized administrator can bind a Barcode Element to a supported Entity Code or Document ID.

**Consequences:**
- Code 128 is available for compact alphanumeric identifiers; QR Code remains a separate Element.
- Scan lookup respects the scanning user’s permissions and school scope.

#### FR-15: Render privacy-safe verification QR codes

An authorized administrator can add a verification QR Code that contains only a Cultivate verification URL with an opaque Verification Token.

**Consequences:**
- The QR payload contains no student name, phone number, marks, fees, date of birth, or other direct personal data.
- Cultivate tests the rendered code for minimum size, contrast, quiet zone, and successful decoding before Generation.
- Verification QR and Custom URL QR are visibly different Element types; a decorative or custom QR is never presented as proof of authenticity.

#### FR-16: Verify document status

A recipient can open a Verification Record from a valid Verification Token and see a limited result configured for the Document Type.

**Consequences:**
- The result shows school identity, Document Type, Document Number, issue date, masked subject identity, and one of Valid, Superseded, Revoked, Expired, or Not Found.
- Sensitive details require authenticated, authorized access and are never inferred from an invalid token.
- The page tells the verifier to compare its canonical summary with the printed document because copying a genuine QR image alone does not make another document authentic.

#### FR-17: Reissue, supersede, and revoke documents

An authorized administrator can reissue, supersede, or revoke a Generated Document with a reason while preserving the original Issue Register entry.

**Consequences:**
- Reissuing creates a new Document ID and links the replacement to the previous document.
- Verification immediately reflects current status without deleting historical evidence.

### 6.5 Preview, Generation, and Delivery

#### FR-18: Preview with representative data

An authorized user can Preview a School Template using an eligible real record or sanitized sample data before activation or Generation.

**Consequences:**
- Preview never changes the underlying record or creates a Generated Document.
- Users can test missing photo, long name/address, many table rows, multiple languages, and page overflow.

#### FR-19: Generate one document contextually

An authorized user can generate a document from the relevant Student, Exam, Fee, or Employee workflow.

**Consequences:**
- The user sees the resolved Active Template, data timestamp, warnings, and delivery options before confirming.
- Generation creates an immutable Generated Document and Issue Register entry.

#### FR-20: Generate documents in a batch

An authorized user can select a class, exam sitting, fee run, employee group, or filtered population and generate a Batch.

**Consequences:**
- Cultivate validates all records before Generation and separates blocking records from ready records.
- Output can be downloaded as individual PDFs, a combined PDF, a ZIP, or a sheet layout where applicable.

#### FR-21: Deliver generated documents

An authorized user can preview, download, print, publish to the relevant portal, or share a Generated Document through supported communication channels.

**Consequences:**
- Delivery permissions are separate from template-edit permissions.
- The Issue Register records generation and publication; direct download/share logging follows the school’s configured audit policy.

#### FR-22: Preserve reproducibility

Cultivate preserves enough issuance data to reproduce what was issued without silently substituting current data or the latest template.

**Consequences:**
- A Generated Document retains its rendered file, cryptographic file hash, Document ID, Template Version, issue timestamp, issuer, and source-record snapshot/reference.
- Regeneration from current data is explicitly labeled as a new issue.

### 6.6 Template Lifecycle, Brand Assets, and Governance

#### FR-23: Manage drafts and versions

An authorized administrator can save a draft, name a version, compare changes, publish a Template Version, duplicate it, archive it, and restore a prior version as a new draft.

**Consequences:**
- Published Template Versions are immutable.
- Activating a new version does not alter Generated Documents.

#### FR-24: Manage reusable assets

An authorized administrator can manage school logos, letterheads, authorized signatures, stamps, watermarks, and brand styles in a reusable asset library.

**Consequences:**
- Each asset records owner, upload date, last use, status, and allowed Document Types.
- Replacing an asset creates a new asset version rather than changing historical Generated Documents.

#### FR-25: Require approvals where configured

A school can require approval before a Template Version becomes active or before selected Document Types are issued.

**Consequences:**
- The creator cannot self-approve when separation of duties is enabled.
- Rejection returns the item to draft with a reason.

#### FR-26: Search the issue register

An authorized user can search and filter the Issue Register by Document ID, Document Number, Entity Code, Document Type, recipient, Batch, issuer, date, and status.

**Consequences:**
- Results respect permissions and school boundaries.
- Authorized users can open the exact rendered file and lifecycle history.

### 6.7 Permissions, Audit, and Mobile Behavior

#### FR-27: Separate document permissions

Cultivate provides separate permissions for viewing templates, editing templates, publishing versions, managing assets, generating, bulk generating, delivering, viewing the Issue Register, and revoking.

**Consequences:**
- Users cannot gain access to source data through Document Studio if they lack access to that data elsewhere.
- Roles can be limited by Document Type.

#### FR-28: Record consequential activity

Cultivate records template publication, activation, approval, Generation, publication to a portal, reissue, supersession, revocation, and sensitive asset changes.

**Consequences:**
- Each event records actor, school, timestamp, action, target, and reason where required.
- Audit history cannot be edited through the product UI.

#### FR-29: Provide a phone-safe runtime

An authorized phone user can select an Active Template, Preview, Generate, download, print, publish, and share when permitted.

**Consequences:**
- Canvas editing and template layout controls are unavailable on phones.
- If no Active Template exists, the phone UI explains that template design must be completed on a laptop or desktop.

### 6.8 Document-Specific Controls

#### FR-30: Support academic calculations without template logic

Report-card and marksheet templates consume grades, totals, averages, attendance, remarks, and promotion status calculated by Cultivate rather than calculating them inside the Template Editor.

**Consequences:**
- A template can present available calculated values but cannot redefine official grading rules.
- Missing or unpublished results block issuance according to school policy.

#### FR-31: Preserve financial truth

Invoice, receipt, challan, statement, and credit-note templates consume immutable fee and payment records rather than editable display amounts.

**Consequences:**
- Template editing cannot alter balances, payment allocation, transaction IDs, or receipt sequences.
- Cancelled or reversed payments remain represented according to accounting status.

#### FR-32: Support controlled certificate and letter drafting

An authorized user can complete approved editable fields for certificates and letters while protected Dynamic Fields and identifiers remain system-controlled.

**Consequences:**
- The Template Version declares which fields are operator-editable.
- Generated free text is preserved in the issuance snapshot and audit history.

## 7. Cross-Cutting Non-Functional Requirements

### 7.1 Output quality and interoperability

- **NFR-1:** Generated PDF text must remain selectable and searchable except for intentionally raster image content.
- **NFR-2:** A generated A4 document must print without clipping at 100% scale on common printers when the printer honours the declared page size.
- **NFR-3:** QR Codes and Barcodes must remain scannable in the final PDF and in a representative 300-DPI print test at the configured minimum size.
- **NFR-4:** The system must support Unicode content and fonts suitable for English and configured Indian languages; unsupported glyphs must produce a blocking warning.
- **NFR-5:** Colour contrast for editor controls and Verification Records must meet WCAG 2.1 AA; keyboard operation must cover all non-spatial editor actions.

### 7.2 Performance and scale

- **NFR-6:** A typical one-page Preview should render within 3 seconds at the 95th percentile under normal operating load.
- **NFR-7:** A Batch of 500 two-page Generated Documents should complete within 10 minutes or provide visible queued progress, partial-failure reporting, and safe retry.
- **NFR-8:** Editor autosave must preserve acknowledged changes after network interruption and clearly show saving, saved, offline, and conflict states.

### 7.3 Security and privacy

- **NFR-9:** Verification Tokens must be unguessable, revocable, rate-limited, and excluded from analytics or logs that expose them to unauthorized parties.
- **NFR-10:** Public Verification Records must apply data minimization by Document Type and disclose no direct contact, fee, marks, address, or full date-of-birth data by default.
- **NFR-11:** Uploaded signatures, stamps, photographs, and letterheads must inherit school isolation, permission checks, malware validation, and retention controls.
- **NFR-12:** Cross-school access to Templates, assets, Generated Documents, Issue Register entries, or Verification Records must be denied.
- **NFR-13:** Children’s data must be minimized and processed under school-configured authorization, consent, retention, correction, and deletion/export controls validated against applicable Indian data-protection requirements before launch.

### 7.4 Reliability and traceability

- **NFR-14:** A successful Generation confirmation must mean the rendered file and Issue Register entry are durably linked; partial success must be reported explicitly.
- **NFR-15:** Repeated retry of the same confirmed Generation request must not issue accidental duplicate Document Numbers.
- **NFR-16:** Published Template Versions and Generated Documents must be immutable through normal product operations.

## 8. Constraints and Guardrails

- The Template Editor is optimized for laptop and desktop web layouts; phone parity is explicitly unnecessary.
- Dynamic Fields are allow-listed by Document Type and permission. Arbitrary code, SQL, HTML, or script execution is prohibited.
- A QR Code is not proof by appearance alone; verification status comes from the Verification Record.
- Cultivate Verify confirms that the issuing school generated the record and whether that issued version remains valid; it does not independently certify the truth of the school’s underlying data.
- Personal data must not be embedded directly in QR payloads or exposed merely because a Document ID is known.
- Aadhaar numbers must not be used as an Entity Code, Document ID, Verification Token, or QR payload; any future Aadhaar-related workflow must be separate, opt-in, masked, and legally reviewed.
- Official calculations and financial amounts come from their source modules, not editable template expressions.
- Default Templates must avoid implying legal or board-specific compliance that Cultivate has not verified.

## 9. Non-Goals

- Replacing Canva, Adobe Illustrator, or a general-purpose publishing suite.
- Photo editing beyond crop, fit, rotation, and basic image presentation.
- User-authored scripts, formulas with side effects, or database queries.
- OCR-based import of legacy paper templates in the MVP.
- Digital-signature certificates, blockchain notarization, or government identity integration in the MVP.
- Guaranteed legal validity of a school’s chosen wording; schools remain responsible for content and approvals.
- Editing master layouts on a phone.

## 10. MVP Scope

### 10.1 In Scope

- Settings → Document templates and contextual Generation entry points.
- Default Templates for Report Card, Admit Card, Student ID Card, Fee Invoice, Payment Receipt, Bonafide Certificate, Transfer Certificate, Employee ID Card, Salary Slip, and Custom Letter.
- Desktop Canvas with core Element placement, styling, alignment, layers, undo/redo, page configuration, Tables, Dynamic Fields, Photo, Signature, Stamp, QR Code, and Code 128 Barcode.
- Brand asset library.
- Preview with real and representative sample data.
- Template drafts, immutable published versions, activation by school/session/class where relevant.
- Single and class-level Batch Generation, combined and individual PDF download.
- Document ID, school-configured Document Number, Verification Token, QR Verification Record, reissue, and revocation.
- Issue Register, role permissions, and audit history.
- Phone Preview, Generate, download, print, publish, and share using Active Templates.

### 10.2 Deferred After MVP

- Full long-term Document Catalogue beyond the ten MVP types.
- Multi-step template and issuance approvals.
- Advanced conditional rules and complex nested repeating data.
- Spreadsheet mail merge and external data-source integrations.
- Automated multilingual translation.
- Digital certificate signing and external trust-provider integration.
- OCR/template reconstruction from uploaded PDFs or scans.
- Cross-school template marketplace.
- Scheduled recurring document Generation.

## 11. Success Metrics

### Primary

- **SM-1:** At least 80% of pilot schools activate one Default Template after changing no more than brand assets and five style properties. Validates FR-1–FR-3 and FR-24.
- **SM-2:** At least 95% of ready records in a 500-student Batch generate without manual per-student layout correction. Validates FR-8, FR-9, and FR-20.
- **SM-3:** Median time from opening contextual Generation to downloading a class Batch is under five minutes, excluding time spent resolving missing source data. Validates FR-19–FR-21.
- **SM-4:** At least 99% of issued verification QR Codes tested by the product resolve to the correct Verification Record. Validates FR-13–FR-17.

### Secondary

- **SM-5:** Fewer than 2% of Generated Documents are reissued because of template layout or field-binding errors. Validates FR-9, FR-18, and FR-22.
- **SM-6:** At least 70% of repeat Generation operations use an already Active Template without entering Settings. Validates the centralized-design/contextual-generation thesis.
- **SM-7:** At least 90% of phone Generation attempts using valid source data complete without requesting desktop layout access. Validates FR-29.

### Counter-metrics

- **SM-C1:** Do not optimize template count; measure activation and successful issuance instead of encouraging unused templates.
- **SM-C2:** Do not increase public verification detail to improve recipient engagement; privacy minimization overrides page-view metrics.
- **SM-C3:** Do not reduce Generation warnings if doing so increases incorrect or unverifiable documents.

## 12. Risks and Mitigations

- **Editor complexity:** A freeform Canvas can overwhelm school staff. Mitigate with strong defaults, guided setup, snapping, safe property controls, and progressive disclosure.
- **Variable-data overflow:** Real names, addresses, remarks, and tables can break layouts. Mitigate with representative Preview modes, overflow policies, and activation validation.
- **Sensitive-data leakage:** Public QR verification can expose student information. Mitigate with opaque Verification Tokens, minimal per-type Verification Records, rate limiting, masking, and revocation.
- **Children’s privacy and consent:** Documents can contain photographs, marks, addresses, health information, and guardian data. Mitigate with field-level permissions, least-data defaults, retention controls, masked previews, school policy configuration, and legal validation against India’s DPDP framework before launch.
- **Fraudulent visual copying:** A copied QR image can be placed on a modified document. Mitigate by showing Document Type, masked identity, issue date, status, and optional document fingerprint details on the Verification Record.
- **Historical drift:** Current data or assets may differ from issued content. Mitigate with immutable Template Versions, asset versions, issuance snapshots, and stored rendered outputs.
- **Bulk-generation failures:** One bad record can block an entire school. Mitigate with preflight validation, ready/blocked separation, partial batches, progress, and retry.

## 13. Open Questions

1. Which school roles may see a public Verification Record versus an authenticated detailed Verification Record?
2. Which Indian languages must ship with verified font support in the MVP?
3. Should Document Numbers use one school-wide sequence or separate sequences per Document Type by default?
4. How long must Generated Documents and audit events be retained after a student or employee leaves?
5. Should the first release include one-step template approval, or is publish permission sufficient for pilot schools?
6. Which Generated Document classes require expiry dates, and what should happen when a school changes its public verification domain?

## 14. Research References

- [India Digital Personal Data Protection Act, 2023 — MeitY](https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf)
- [CBSE Affiliation Bye-Laws](https://www.cbse.gov.in/cbsenew/aff_bye_laws.html)
- [DigiLocker issuer model](https://www.digilocker.gov.in/web/about/issuers) and [document verification](https://verify.digilocker.gov.in/)
- [UIDAI official QR information](https://uidai.gov.in/qr-code-reader)
- [CBIC GST invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html)
- [OWASP guidance on insecure direct object references](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html)
- [RFC 4086: randomness requirements for security](https://www.rfc-editor.org/rfc/rfc4086)
- [W3C Verifiable Credentials Data Model 2.0 — status and privacy patterns](https://www.w3.org/TR/vc-data-model-2.0/)
- [DENSO QR error correction](https://www.qrcode.com/en/about/error_correction.html) and [quiet-zone guidance](https://www.qrcode.com/en/howto/cell.html)
- [Adobe InDesign Data Merge](https://helpx.adobe.com/indesign/using/data-merge.html), [Microsoft Word Mail Merge](https://support.microsoft.com/en-us/office/use-mail-merge-for-bulk-email-letters-labels-and-envelopes-f488ed5b-b849-4c11-9cff-932c49474705), and [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)

## 15. Assumptions Index

- §5: The complete Document Catalogue is the long-term supported set, while the MVP launches with ten priority Document Types.
