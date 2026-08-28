# DESIGN_PHASE_K — Console UX batch + sponsor outreach

Date: 2026-08-28. Trigger: founder live-review of the Northbridge console (9 items +
1 found bug). Method: two agents — K-R1 sponsor-outreach decision memo (web-researched,
cited); K-R2 codebase recon with file:line, conflict map, and chunk grouping. This doc
is the build plan; agent details summarized.

## Decisions

D1. Sponsor outreach NEVER sends through UKEDL's email. Resend AUP bans cold outreach
    explicitly (account shutdown without warning); domain reputation carries invites/
    reminders platform-wide; relaying makes UKEDL a CAN-SPAM sender. v1 = draft-and-
    copy: pipeline + composer + mailto/copy from the organizer's own address ("Sponsors
    hear from you, not from us"). OAuth send-as (Gmail restricted scope = annual CASA
    $1-5k) only if demand proves it. No directories/scraping, no sequences, no
    open-tracking, no bulk send — anti-calm and AUP-poison.
D2. Feature/nav popovers ship copy-first (title + description + "appears in" line);
    imageSrc slot reserved in the component; screenshot pipeline later (only one
    product image exists today).
D3. Invoices: Stripe-hosted first — set invoice_creation[enabled]=true on payment-mode
    checkout (one line; subscriptions already produce invoices; billing page already
    lists them). Self-generated PDF invoices deferred behind ORG-1 (needs org billing
    address fields); would reuse the certificates pdfkit pipeline.
D4. CFP label: additive Event.cfpLabel, default display "Call for Presentations";
    public CFP page already renders CfpForm.title so mainly organizer surfaces + nav.
D5. Tab overflow: measured priority+overflow "More ▾" menu (portal-anchored) with
    active-tab-always-visible swap; compact sizing ≤~1200px; scrolling row stays as
    touch fallback.
D6. Setup assistant becomes a floating dock (FAB bottom-right + docked 384px aside
    that PUSHES content via body class — exact ConciergeChat/CHAT-1 pattern), mounted
    in OrganizerShell so it's on every console page. Overview checklist card stays;
    its inline chat toggle goes.

## Key recon facts (K-R2, verified file:line)

- ConsoleTabStrip.tsx has ResizeObserver plumbing already; tab list built in console
  index :811-830; Features intentionally last (first overflow casualty).
- features.ts has plainDescription per key; "appearsIn" map does NOT exist — add
  appearsIn?: string to FeatureDefinition. Sidebar labels are inline literals in
  OrganizerShell :153-188 (no description map). Settings SlideOver fields have no
  help text; copy home = overviewCopy.settings in packages/config.
- Subpages (ingest/cfp/scanner/sponsors/analytics) have NO back affordance; only
  analytics passes eventName. Build ConsoleSubpageHeader; OrganizerShell should
  expose eventName / accept backTo.
- SetupCopilotChat (501 lines) generalizes as-is; ConciergeChat dock CSS at
  globals.css:4800-4857; organizerId optional already.
- Billing: UPGRADE_SKUS is a local label list; PLAN_BY_SKU + formatDisplayPrice
  give everything; /billing/summary already returns invoices[] w/ hosted URLs;
  payment-mode checkout lacks invoice_creation flag.
- Check-in truth: QR payload = EventMembership.checkInCode; shown in attendee app
  profile (ProfileEditor :298-320 via qrserver image); badge PDFs exist server-side,
  NO badges UI — don't link one. Scanner: BarcodeDetector (silently dead on
  unsupported browsers — add a note), manual entry, offline queue + sync.
- Multi-column: tracks/rooms lists → grid repeat(auto-fill,minmax(260px,1fr)),
  edit form spans full row. Tables (speakers/participants/scanner roster) stay.
- BUG confirmed: sponsors.tsx renders the full add form + empty state alongside the
  "Feature not available" error; fix = feature check → ListEmpty + link to Features
  tab; audit cfp/scanner for the same shape.

## Chunk plan (order matters; conflict-safe per recon)

K-1 (A+B, M): kit/HoverInfo.tsx (useAnchoredPopup; mouseenter ~400ms + focusin;
    role=tooltip; ⓘ tap target for touch; imageSrc slot) + ConsoleSubpageHeader
    (← Back to {event}) wired on 5 subpages + billing-from-account; tab overflow
    More▾ menu w/ active-visible swap + compact sizing; "Organizer mode" StatusChip
    badge in shell topbar + data-shell-mode attr.
K-2 (C, M): popover content rollout — features.ts appearsIn + wiring HoverInfo on
    feature rows, sidebar items (write ~10 descriptions), settings fields (write
    copy in overviewCopy.settings); billing plan buttons get real prices from
    PLAN_BY_SKU + HoverInfo per plan; Event.cfpLabel (additive migration) +
    settings field + sidebar/organizer-page threading (default "Call for
    Presentations").
K-3 (D, M): OrganizerAssistantDock (FAB + docked aside + body.copilot-docked push)
    mounted in OrganizerShell on all console pages; remove inline chat toggle from
    the Overview card; AGENT-3.1 event-switch close keyed on eventId.
K-4 (E, S): check-in explainer panel (accurate flow incl. BarcodeDetector-unsupported
    note); tracks/rooms multi-column grid; sponsors gate fix (+ same audit on
    cfp/scanner pages).
K-5 (F, S): invoice_creation[enabled]=true on payment-mode Stripe checkout + test.
SPX-0/1 (M+M): sponsor outreach v1 per D1 — SponsorProspect + OutreachTemplate
    models (additive), CSV dry-run import (W-2 pattern), pipeline table with
    statuses, composer w/ merge fields + starter template, mailto/copy actions +
    "mark contacted", AI personalize via gateway (OUTREACH_DRAFT metered,
    draft-only), CONFIRMED → "Add as sponsor" conversion; feature key
    sponsor_outreach dependsOn sponsors; Free cap outreachProspectsPerEvent 25.
    SPX-2 later: speaker-invite template kind.
Deferred: PDF invoices (post-ORG-1), popover screenshots pipeline, OAuth send-as.
