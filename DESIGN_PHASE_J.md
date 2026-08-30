# DESIGN_PHASE_J — Organizer workflows, org entity, certificates, paid attendance

Date: 2026-08-24. Method: 3 parallel research agents (J-A organizer-journey dead-end
audit with file:line root causes; J-B paid-attendance decision memo with cited market
research; J-C org-model + certificates design) triggered by founder live-testing the
Northbridge demo build. Full agent reports summarized; chunk specs below are the
build plan.

## Founder-reported issues → root causes (J-A)

1. Label select shows no options → NOT a data bug: custom Select popup renders
   position:absolute inside .console-table-wrap (overflow-x:auto forces a clip
   container); popup is clipped below short rosters (Select.tsx:238, globals.css:234/
   6011). KebabMenu has the same latent bug. Fix: render popups via kit/Portal.
2. CSV invite emails immediately, no add-silently/selection/labels →
   createAndEmailInvite (attendees.ts:47-149) fuses seat-creation + email; dry-run
   mapping has no label; no row checkboxes; inviteStatus derived from token hash so a
   silent-add needs a NOT_INVITED state.
3. Setup assistant conflicts → mergeSetupExtract overwrites any confirmed field with
   any validated extract, silently (extractTypes.ts:239); document upload same
   (setupCopilot.ts:279); wizard→AI re-entry blanket-reverts manual edits
   (new.tsx:147-167); completeViaCopilot drops extracted day start/end times
   (new.tsx:351); ingest never reconciles file event-dates vs event settings.
4. Assistant hedges on feature state → organizerState.ts includes counts/checklist
   only; resolved buildFeatureState, plan/entitlements, readiness counts absent.
5. No event→org move → PUT /event silently ignores organizationId (event.ts:68 vs
   315-359). 17 models denormalize organizationId; full transfer would corrupt
   billing/metering/audit. Verdict: draft-only restricted transfer + "duplicate into
   other org"; never general transfer.

Other findings (ranked): re-import creates duplicates for cross-day/retitled sessions
(changeset.ts:74-143); ingest delete rows omit attendee blast radius; solo-owner
account deletion demands org close/transfer endpoints that don't exist; Speakers tab
is add-only (no edit/delete UI); unarchive → DRAFT + portal tokens not restored,
unannounced; bulk-invite partial-failure detail dropped by UI; certificate-ready
email links WEB_BASE_URL/verify/{id} — no such web page exists (likely 404 in prod).
Verified good: feature toggles truly preserve data; program deletes have honest
blast-radius confirms; wizard drafts per-tab-only is a documented tradeoff.

## Org entity (J-C)

Organization is a billing shell: no PUT route at all (name uneditable), no identity
fields. Public surface: "Hosted by <name>" text on /e/[slug] only. Org picker renders
even for single-org users (dashboard + wizard).
Build (ORG-1): additive columns websiteUrl, supportEmail, logoUrl, description;
PUT /organizations/:orgId (OWNER/ADMIN, patchFields contract); /organizer/org/settings
page; hosted-by becomes a link + contact mailto on /e/[slug]; org logo as fallback
event logo + wizard prefill (prefill-not-seed per BRAND-2 doctrine); editable name;
hide org picker when memberships.length === 1, quiet "Creating in X · change" line
otherwise.
Defer: public /o/<slug> org page (marketplace feature; we're invite-driven), promo
media gallery (violates identity-not-billboard), server-side default-org pref.
ORG-2 (later): transfer-ownership + close-empty-org endpoints (unblocks the account-
deletion dead-end); draft-only event transfer (DRAFT + no purchases/certs/AI-usage/
series → single safe transaction), else recommend re-create + re-import.

## Certificates (J-C)

Today: built-in pdfkit layout only (platform colors — BRAND-3 unshipped for certs);
merge fields {attendeeName}{eventName}{dates}{hours}{signatureImage}{certificateId};
eligibility ANY_CHECKIN/MIN_SESSIONS/REQUIRED_SESSIONS (registration-based, honest
copy exists); batch job w/ progress; email = link notification (idempotent, opt-in),
NOT attachment (correct — keep); BUG: email's /verify/{id} link has no web page.
CERT-1 (S): BRAND-3 for certificates (event accent + optional logo into pdf.ts) +
web /verify/[id] page calling the existing API verify route.
CERT-2 (M): CertificateTemplate.kind = TEXT | IMAGE_BACKGROUND (+backgroundImageUrl,
nameBox JSON {xPct,yPct,widthPct,fontSize,color,align}, orientation). Organizer
uploads PNG/JPG of their finished design (the Canva-export reality), draggable name
box (v1: vertical slider + centered), renderer branches, all existing eligibility/
batch/storage/email machinery untouched.
Don't build: DOCX→PDF (needs LibreOffice — infeasible on Render native runtime),
full WYSIWYG designer, PDF attachments.

## Paid attendance (J-B) — decision

NEVER platform-as-MoR for attendee money (money-transmitter licensing, dispute/fraud
liability, pre-event fund-holding tail risk). Education reality: POs/invoices/checks
are first-class — many districts cannot card-pay; every education conference offers a
PO path. Competitor take rates: Eventbrite ~3.7%+$1.79+processing (effective 10-14%
on cheap tickets); Tito 3%; Humanitix 2.1%+$0.99 (schools 1%); Whova 3%+$0.99 atop
license. Sched has no ticketing (Eventbrite sync) — schedule-platform + external
ticketing is a validated shape.
PAY-T0 (days of work, ships whenever): per-event toggle "This event charges a
registration fee" (off = zero UI change). On: price text + payment URL (Stripe
Payment Link/PayPal/school store/"PO instructions" free text) shown at registration;
EventMembership.paymentStatus (UNPAID/PO_ON_FILE/PAID/WAIVED/REFUNDED) + optional
reference; organizer marks paid manually or via CSV paid-list import (doubles as the
Eventbrite/Humanitix "integration"); optional gate/badge on paid status. ToS line:
UKEDL doesn't process off-platform payments.
PAY-T1 (post-pilot, 4-8 wks part-time, only after T0 demand): Stripe Connect
STANDARD, hosted onboarding, DIRECT charges on the organizer's own account (organizer
= merchant: their refunds/disputes/1099-K; zero Connect fees on direct charges),
optional application_fee (start 0%; ticketing gated to paid plans instead), webhook
flips the same paymentStatus, mandatory refund-policy field before enabling, ToS
organizer-terms update (attorney pass), PO path stays visible beside card checkout.
Marketing line: "your Stripe account, your money, POs welcome" vs Eventbrite's
effective 10%+.
Don't build: seat maps, promo codes, group carts, installments, Express/Custom,
bespoke Eventbrite API sync.

## Chunk sequence

Pre-outreach (P0/P1):
  W-1 SELECT-PORTAL (S): Select + KebabMenu popups via kit/Portal (fixes label bug
      everywhere).
  W-2 ROSTER-IMPORT (M): split ensureRosterSeat/sendInvite; POST /attendees/import
      (no email) + /attendees/send-invites {userIds}; NOT_INVITED status chip; label
      column in dry-run mapping + per-row label & checkboxes; roster bulk-select
      "Send invites".
  W-3 STATE-FEATURES (S): FEATURES (resolved) + PLAN + readiness counts into
      buildOrganizerStateText.
  W-4 SETUP-CONFLICT (M): pre-merge diff in runCreateTurn → deterministic conflict
      question + pendingConflict card (reuse diff-card UX); old→new highlight in aside.
  W-5 AI-DRAFT-MERGE (S): field-wise wizard→AI restore (wizard-wins for later edits);
      stop slicing day times in completeViaCopilot.
  W-6 SMALL-COPY (S): org-picker "can't change later" + reject organizationId on PUT;
      ingest delete rows show joined counts; bulk-invite partial breakdown; hide org
      picker for single-org users.
  CERT-1 (S): cert branding + web verify page (fixes live 404).
Post-outreach / as demand dictates:
  W-7 REIMPORT-MATCH (M); ORG-1 (M); PAY-T0 (M); CERT-2 (M); ORG-2 (M); PAY-T1 (L).

## Talk showcase / TEDx-style preset (J-D research, 2026-08-25)

Research verdict: build the light preset now (all S, config/seed data); TEDx is the
cleanest public showcase of Speaker Readiness — TED's own organizer guide prescribes
the exact multi-draft deadline cadence (rough/1st/2nd/final draft, rehearsals) that
the reminder sweep automates; no dedicated TEDx-organizer software exists (Sessionize
covers applications only); ~3,000+ events/yr, tight organizer community. Volunteer
nonprofit budgets → word-of-mouth niche, not a pricing pillar.
Event anatomy (cited in agent memo): Community license = ≤100 in-person attendees,
≤$150 ticket, one day, single-track stage (no panels/stage Q&A), talks ≤18 min,
speakers unpaid, sponsors never on stage or homepage, ALL talks recorded + TED
Speaker Release signed BEFORE rehearsals, organizer keeps releases on file.
TRADEMARK RULES (strict): in-product name "Talk showcase" — TEDx appears only
descriptively ("TEDx-style, storytelling nights, lightning talks"); marketing may say
"built for TEDx-style talk events" with footer "TED and TEDx are trademarks of TED
Conferences, LLC. UKEDL is not affiliated with or endorsed by TED."; NEVER "TEDx
preset", never TED logo/trade dress.
TALK-1 spec (S): SetupEventType talk_showcase + keywords (tedx, talk showcase,
storytelling, lightning talks, pecha kucha) + feature preset (breakout_style off,
cfp off-by-default, session polls/Q&A off, sponsors on, checkin on, certificates on,
paid_attendance on, engagement theatre off) + attendeeCap prefill 100 w/ helper copy
+ single-track one-day agenda skeleton (doors → intro-video slot → 3 talk sessions
w/ breaks → closing) + seeded readiness template "Talk showcase speaker pack"
(headshot, bio ≤100w, title+description, rough outline, draft 1/2/final script,
slides, SIGNED release as file-with-approval, copyright-clearance confirm, AV needs
select, dress-rehearsal confirm, organizer-only internal items). Deferred (M):
rehearsal slot scheduler, milestone-chain visual, relative template due dates.

## Console polish round (founder live-test 2026-08-26) + Speakers/Account designs

Founder-reported: (1) single-line inputs for multi-sentence content (portal bio was an
<input> — unreadable past a few words) → all long-text entry becomes auto-growing,
user-resizable textareas sitewide; (2) console tab strip wraps to an orphan second row
→ single scrollable row; (3) /account: back-nav buried, Delete prominent, no confirm
dialog; (4) Speakers tab is a bare name list.

SPK-1 design (agent-researched vs Whova Speaker Center/Sched/Sessionize/Swapcard/
Sessionboard; effort M, FRONTEND-ONLY — PUT/DELETE /speakers/:id already exist,
sessions + readiness rollups (GET /readiness/overview subjects[].rollup) + portal rows
(GET /readiness/portal-access) already served):
- Table replaces the <ul>: photo+name+title/affiliation (CFP badge if converted),
  sessions count w/ first title, readiness chip "3/4 ready (+1 late)" counts-only,
  portal email + state (Invited/Opened/Revoked/Expired/No invite). Name filter >10.
- Row → SpeakerDetail SlideOver (wide): editable profile (name/title/affiliation/bio/
  photo via existing PUT), contact (portal email read-only + dates, mint stays in
  Readiness tab), sessions list linking to Program, readiness one-liner linking to
  the Readiness subject SlideOver (?tab=readiness&speaker= deep link), footer
  Save/Delete/Close.
- Delete via ConfirmDialog danger with honest cascade copy (sessions unlinked; N
  readiness assignments + submitted materials incl. files deleted; portal access
  revoked; CFP submission kept but unlinked). Counts from client-side data.
- NOT: engagement stats, progress bars, approve/reject, reminders, bulk actions,
  featured flags.

ACCT-1 design (norms: uxpatterns.dev account-settings anatomy, GitHub/Buttondown
danger-zone-last, Stripe hosted portal for billing; effort M):
Single page, sections: prominent "← Back to dashboard" top-left; Profile (extract
dashboard ProfileEditor to shared component); Email (read-only + honest
"contact support to change" — change-email route does NOT exist, defer L) & password
(form → existing POST /auth/change-password); Notification account defaults (writes
the eventId:null row — needs small account-level PUT; J-A #6); Plan & billing card
(plan name + link /organizer/billing; no upsell copy); Your organizations (read-only
list); Data & privacy (export, directly above danger zone); Danger zone LAST,
visually quarantined, existing email+password re-auth PLUS ConfirmDialog(tone danger)
with concrete-consequences copy, CTA "Schedule deletion" never "Confirm".

UX-3 shipped (S, frontend-only): (1) components/kit/AutoGrowTextarea — grows from
`minRows`, keeps `resize: vertical`, and a drag of the handle disables auto-grow so
typing can't undo it; every prose field in the app now uses it (39 textareas + the
portal's short_text input, which is where the founder's bio actually landed —
long_text was already a textarea) and consolePolish.test pins that no page may
hand-roll a `<textarea>` again. (2) components/organizer/ConsoleTabStrip — one
nowrap row, hidden scrollbar, mask-based fade on whichever edge has tabs behind it,
active tab scrolled into view; the single-row rules moved out of the phone media
query and are now the base. (3) /account: "← Back to dashboard" above the heading
(footer duplicate dropped), delete card = .card.danger-zone with a "Danger zone"
label, ConfirmDialog on top of the re-auth, export directly above; export and
deletion errors no longer share one slot. (4) /speaker-readiness placeholder box →
public/marketing/readiness-dashboard.png in a bordered .mkt-screenshot figure.
Still open here: SPK-1 and the full ACCT-1 redesign.

W-7 REIMPORT-MATCH shipped (M): buildReimportChangeset matches in tiers instead of
title+same-day only — exact normalized title on the same day, then exact title on any
day (moved), then similarity ≥ REIMPORT_TITLE_THRESHOLD on the same day OR in the same
time slot (retitled) — so a session that changed day or title updates in place rather
than re-importing as a duplicate. Within a tier candidates rank by similarity, same
room, clock distance, day distance; update rows now carry structured `changes`
(old → new for day/time/room/track/title/description, mirroring what confirm writes,
including the missing-endTime → start+1h rule), the matched `tier`, and `movesTime`
plus joined/bookmark counts, and the review UI renders them through FieldDiffList in
the same `from → to` shape as the setup-copilot config diff card. A matched session
that changes nothing emits NO row (it is still matched, so it is never proposed for
delete either) — the review no longer pads itself with no-op updates. Ambiguity is
never guessed: when the top two candidates are indistinguishable on all four rank
keys, or two import rows fit one existing session equally well, the row stays an ADD
carrying a MatchDecision, renders in a "Needs your decision" section with a radio per
candidate (default "Add as a new session"), and the contested existing sessions are
held back from delete proposals as well. Resolution is client-side only
(resolveMatchDecision) — the dry-run doctrine is untouched, nothing applies until
Confirm drafts. job.ts now also selects `description` (a field the diff cannot see
would otherwise be assumed unchanged).
