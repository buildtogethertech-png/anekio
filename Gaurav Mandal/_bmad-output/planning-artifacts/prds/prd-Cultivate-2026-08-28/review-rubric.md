# PRD Quality Review — Cultivate Document Studio

## Overall verdict

This is a thoughtful, unusually concrete platform PRD with a clear thesis, strong domain vocabulary, credible user journeys, privacy-aware document verification, and mostly testable functional consequences. It is not yet green-light ready: the MVP combines a desktop publishing editor, ten document families, cross-module data binding, bulk rendering, versioning, verification, audit, permissions, and a mobile runtime, while several security, retention, numbering, language, and approval decisions remain open. The main risk is therefore not lack of product thinking but an MVP whose boundaries and acceptance contracts are still too broad or unresolved for dependable estimation and story breakdown.

## Decision-readiness — thin

The central decisions are easy to find: design is centralized while generation stays contextual (§1); desktop owns layout editing while phones are operational only (§4.2, §8); Entity Codes, Document IDs, Document Numbers, Verify IDs, and Verification Tokens have distinct roles (§3, §6.4); and official calculations remain in source modules (§6.8). The PRD also names meaningful trade-offs, especially default-template usability versus freeform power, verification utility versus child-data privacy, and reproducibility versus current-data regeneration.

However, the document leaves decisions that affect the security model, schema, lifecycle, and release boundary in §13 as ordinary open questions. It also contains a direct release-boundary tension: FR-25 requires configurable approvals, §10.2 defers multi-step approvals, and Open Question 5 asks whether even one-step approval belongs in the first release. A decision-maker cannot approve implementation without first resolving which approval capability is actually in MVP and what public verification is allowed to disclose.

### Findings

- **high** Resolve release-blocking governance questions before green-light (§13 questions 1, 3–6) — Public-versus-authenticated verification, numbering scope, retention, first-release approval, expiry, and verification-domain behavior affect authorization, data models, irreversible identifiers, and lifecycle rules. They are not safe post-build details. *Fix:* Mark each question as launch-blocking or deferrable, assign an owner and decision date, and resolve the launch blockers in the relevant requirements before estimating MVP.
- **high** Reconcile approval scope (§6.6 FR-25, §10.2, §13 question 5) — “A school can require approval” reads as an MVP capability, while “Multi-step template and issuance approvals” is deferred and the first-release presence of one-step approval remains undecided. Engineering cannot tell whether to build no approval, template-only approval, issuance approval, or both. *Fix:* State the exact MVP approval workflow and move every other variant to Non-Goals/Deferred; update FR-25’s consequences accordingly.
- **medium** Record the major scope trade-off as an explicit decision (§10) — The PRD lists an ambitious platform MVP but does not state what was deliberately sacrificed to keep all ten document types, the freeform editor, verification, audit, and phone generation in the same release. *Fix:* Add a short “MVP decision and trade-off” paragraph naming why this scope is preferred and which quality, document-family, workflow, or rollout dimensions may be narrowed if delivery evidence demands it.

## Substance over theater — adequate

Most content is earned. The five journeys drive specific capabilities; the glossary prevents the common mistake of conflating a student/entity identifier with a document identifier; the QR model is privacy-aware rather than decorative; and the NFRs include useful thresholds for preview, batch generation, accessibility, scanning, and idempotency. The vision is specific to school-issued documents and cannot simply be transplanted to a generic content-management product.

Some breadth is aspirational furniture at the MVP boundary. “Classic, Modern, Formal, and Compact” is imposed across document types without evidence that four variants improve activation, and the ten-type MVP masks very different data and layout systems: report cards, receipts, ID cards, salary slips, certificates, and letters do not become one capability merely because they share a canvas. The catalogue is useful as a long-term inventory, but it should not be mistaken for validated priority.

### Findings

- **medium** Default-template quantity is asserted rather than justified (§6.1 FR-2) — “at least Classic, Modern, Formal, and Compact defaults” may create four variants per supported type before the team has evidence that schools need them; it also conflicts with counter-metric SM-C1’s warning not to optimize template count. *Fix:* Define a coverage outcome (for example, each MVP type has at least one pilot-validated production default) and make additional visual variants evidence-led.
- **medium** Ten MVP document types conceal several distinct products (§10.1) — Report cards need complex academic tables, receipts need financial immutability and numbering, IDs need front/back sheet imposition, while letters need controlled free text. The PRD does not show that each type has enough source data and workflow readiness to ship together. *Fix:* Add a per-type readiness gate covering source data, required fields, default template, contextual entry point, validation, issuance semantics, and verification policy; use it to select the launch subset.

## Strategic coherence — adequate

The thesis is strong and consistent: one place to design, contextual places to generate, and immutable issuance as the source of truth (§1). The journeys, capability groups, and metrics largely follow that arc. SM-1 measures default-template usability, SM-3 measures contextual generation speed, SM-6 tests whether repeat work avoids Settings, and the counter-metrics protect against empty template proliferation and privacy erosion.

The strategic weakness is sequencing. The MVP is described as a single platform release instead of a falsifiable first wedge. Nothing explains why verification, a sophisticated freeform canvas, ten document types, mobile generation, approvals, bulk processing, and asset/version governance must all be present to validate the thesis. As written, failure to launch or adopt would not reveal whether the thesis was wrong or the surface area was simply too large.

### Findings

- **high** MVP lacks a thesis-testing wedge (§10.1, §11) — The same release attempts to validate authoring, contextual generation, batch rendering, authenticity verification, governance, and mobile operations across ten document types. This makes sequencing and causal learning unclear. *Fix:* Define an ordered rollout within MVP—for example, a pilot slice with a small number of high-volume types and shared platform primitives—plus explicit evidence required before adding the remaining types and verification features.
- **medium** Success metrics lack measurement windows and denominators (§11) — “80% of pilot schools,” “95% of ready records,” and “99% of issued verification QR Codes tested by the product” are measurable in principle, but the pilot cohort, observation period, minimum sample, definition of ready, and scan-test protocol are absent. *Fix:* Add metric definitions with cohort, time window, event source, exclusions, and minimum sample size.

## Done-ness clarity — thin

The functional requirements are much stronger than typical narrative PRDs: every FR has consequences, IDs are stable, and several NFRs supply numeric bounds. The document provides a good basis for architecture and initial decomposition.

It is still insufficient as an acceptance contract in several high-risk areas. Template validation does not classify warnings versus blocking errors; field and condition availability is described as “supported” or “appropriate” without a per-type contract; delivery channels and print behavior are not bounded; the verification disclosure is configurable but no type-level defaults are defined; and key performance terms such as “typical,” “normal operating load,” and “representative 300-DPI print test” lack test fixtures. These gaps will yield divergent UX, architecture, and QA interpretations.

### Findings

- **high** Per-document-type data and issuance contracts are missing (§6.3, §6.8, §10.1) — FR-10 exposes fields “appropriate to the Document Type,” FR-30/31 protect source truth, and FR-32 allows controlled text, but no matrix defines required fields, optional fields, editable fields, source module, blocking conditions, numbering, expiry, or verification disclosure for each MVP type. *Fix:* Add a normative MVP document-type contract matrix or linked companion specification with those fields for all ten types.
- **high** Validation outcomes are not deterministic (§6.2 FR-9, §6.5 FR-18–FR-20) — The PRD names clipped text, missing fields, unreadable codes, missing assets, and overflow but only says “blocking errors prevent activation,” without specifying which conditions block activation, single generation, or batch records. *Fix:* Define severity and stage for every validation class, including whether an override is possible and how partial batches handle it.
- **medium** Verification policy is configurable without a safe default contract (§6.4 FR-16, §7.3 NFR-10, §13 question 1) — “limited result configured for the Document Type” and “masked subject identity” do not specify which fields or masking rules apply to each MVP document, particularly receipts, report cards, salary slips, and ID cards. *Fix:* Define deny-by-default public schemas per type and explicit authenticated-detail permissions; keep sensitive financial, academic, and employee types public-status-only unless approved.
- **medium** Several NFR test conditions remain subjective (§7 NFR-2, NFR-3, NFR-6, NFR-7) — “common printers,” “representative” print testing, “typical” preview, and “normal operating load” do not define environments or datasets. NFR-7 also makes the ten-minute target optional by allowing queued progress instead. *Fix:* Specify reference browsers/devices, PDF/print fixtures, dataset profiles, concurrency/load assumptions, and whether queueing changes the completion SLO or only the interaction timeout.
- **medium** Delivery behavior is underspecified (§6.5 FR-21, §4.2) — “supported communication channels,” print, share, and portal publication have no named MVP channels, file-size limits, access expiry, failure states, or authorization consequences. *Fix:* Name the MVP delivery paths and define success/failure/audit behavior for each; defer all others explicitly.

## Scope honesty — thin

The PRD does useful scope work: it distinguishes a long-term catalogue from the ten-type MVP, includes a substantive Non-Goals section, clearly excludes phone layout editing, and flags one catalogue assumption inline. The Deferred section also names several genuine later capabilities rather than hiding them.

The central scope remains optimistic rather than honest about integration and readiness. The first release includes nearly every horizontal platform primitive plus heterogeneous vertical document families. Several assumptions in §15 are not marked inline despite §0 promising that inferred decisions are marked `[ASSUMPTION]`, and no `[NOTE FOR PM]` callouts identify the conflicts that remain. Six open questions are a high density for a launch-level, chain-top PRD, with multiple questions affecting foundational design.

### Findings

- **high** MVP boundary is too broad to estimate as one coherent increment (§10.1) — The MVP includes a freeform multi-page editor, conditional/repeating data, ten document types, asset/version governance, scoped activation, single and 500-record batch generation, PDFs/ZIP/sheets, verification/revocation, issue register, fine-grained permissions, audit, and phone delivery. No internal phase boundary or dependency order is provided. *Fix:* Split the scope into explicit release slices with exit criteria, or reduce the first release to the smallest end-to-end set that proves design once/generate contextually/retain issuance history.
- **medium** Assumptions Index does not round-trip (§0, §5, §15) — Only the catalogue statement appears inline as `[ASSUMPTION]`; the Fast-path, form-factor, identifier-model, and verification entries exist only in the index. A reviewer cannot locate where those assumptions affect requirements, and some now read as firm decisions. *Fix:* Add an inline tag at each affected section or reclassify confirmed items as Decisions and remove them from the Assumptions Index.
- **medium** Deferred conditional rules conflict with current requirements (§6.3 FR-12, §10.2) — FR-12 requires conditional visibility in the product, while “Advanced conditional rules” are deferred without defining the basic/advanced boundary. *Fix:* Enumerate the MVP operators, fields, nesting limit, and allowed condition count; move everything else to Deferred.

## Downstream usability — adequate

This is a chain-top PRD intended to feed UX, architecture, engineering, and QA, so extraction quality matters heavily. It performs well on core mechanics: the glossary is extensive, UJ-1 through UJ-5 are named and contextual, FR-1 through FR-32 and NFR-1 through NFR-16 are contiguous and unique, sections are capability-grouped, and the requirements avoid prescribing a specific implementation stack. The terminology around identity and verification is particularly useful for architecture.

Downstream teams will still need a missing bridge between platform FRs and the ten launch document types. There is also no explicit mapping from every journey or MVP type to the requirements and source modules it depends on. This is not a request for a ceremonial traceability matrix; it is a request for enough type-specific contract information that teams do not invent divergent behavior.

### Findings

- **high** UX and story creation cannot derive complete type-specific flows (§5, §6, §10.1) — The catalogue and horizontal FRs do not state how Report Card, Admit Card, Student ID Card, Fee Invoice, Payment Receipt, Bonafide Certificate, Transfer Certificate, Employee ID Card, Salary Slip, and Custom Letter differ in editor elements, required data, warnings, approvals, numbering, bulk behavior, delivery, and verification. *Fix:* Add one compact requirement profile per MVP type, each referencing stable FRs and naming its exceptions.
- **medium** Brownfield integration dependencies are absent (§4.2, §6.5, §6.8) — Contextual generation relies on existing Students, Exams, Fees, Employees, permissions, data freshness, and portal/share workflows, but the PRD does not distinguish already-available inputs from prerequisite work. *Fix:* Add a brownfield readiness section that identifies the source-of-truth module and known prerequisite or data gap for each MVP document type without dictating technical architecture.

## Shape fit — adequate

The shape fits a high-stakes, multi-stakeholder B2B school platform: named journeys are load-bearing; capabilities are grouped; security, privacy, output quality, audit, and brownfield source truth receive dedicated treatment; and the PRD avoids a standalone persona catalogue. The document correctly treats this as more than a visual editor by covering issuance and verification lifecycle.

The fit weakens at the boundary between a platform PRD and ten vertical product specifications. The horizontal platform is well described, but the vertical types are mostly catalogue entries. For a chain-top launch document, either the PRD should narrow to the platform plus a few fully specified exemplars, or it should include the type profiles needed to make all ten real.

### Findings

- **medium** The document mixes platform scope with catalogue commitment (§5, §10) — It is detailed enough to describe a document platform but not detailed enough to guarantee all ten heterogeneous MVP workflows. *Fix:* Choose and state one shape: a platform PRD with separately gated document-type specs, or a narrower launch PRD containing fully specified initial types and a roadmap for the rest.

## Mechanical notes

- FR IDs are contiguous and unique from FR-1 through FR-32; NFR IDs are contiguous and unique from NFR-1 through NFR-16; UJ IDs are contiguous and unique from UJ-1 through UJ-5.
- Success-metric IDs are unique, but the `SM-C1` convention is structurally different from numeric SM IDs; this is readable and not currently broken.
- The Assumptions Index does not round-trip: four indexed assumptions lack inline `[ASSUMPTION]` tags, while the §5 catalogue assumption is represented inline and in the index.
- All journeys have named protagonists carrying contextual role information inline.
- Defined nouns are often capitalized as glossary terms (`Generated Document`, `Template Version`, `Verification Record`), but `preview`/`Preview`, `generation`/`Generation`, `scope`/`Scope`, and `barcode`/`Barcode` vary between ordinary and defined usage. Normalize only where the defined meaning is intended.
- FR-25 and the approval statements in §10.2 and §13 question 5 are unresolved cross-section conflicts.
- FR-12 and the deferred “Advanced conditional rules” item lack a resolving definition of basic versus advanced rules.
- NFR-5 cites WCAG 2.1 AA, while Research References cite WCAG 2.2. Choose the intended conformance baseline.
- §14 provides credible primary references, but the PRD does not connect individual legal/compliance-derived requirements to the specific source or validation owner; NFR-13 correctly leaves legal validation pending rather than claiming compliance.
