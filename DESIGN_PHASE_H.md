# DESIGN_PHASE_H — Post-E31 UX: review trust, publish orientation, dense programs

Date: 2026-08-15. Source: founder live test of E31 with `IB Dunia 2025 - Rooming.xlsx`
(school PD day: 3 timeslots in sheet names, 20–22 parallel breakouts per slot, 26 rooms).
Method: 3 parallel research agents (A: codebase reality, B: industry patterns, C:
first-principles personas) + synthesis. This doc records findings, decisions, and the
H-series chunk plan.

## The four problems (founder-reported)

P1. The AI-ingest review screen is a dense 83-checkbox list (62 creates + 21 deletes) in
    small type inside nested scroll boxes — impossible to verify realistically. Also:
    upload copy fails to say PDF/Word/paste already use AI (they do; only the xlsx copy
    mentions AI at all).
P2. After Publish, nothing tells the organizer where to see the event as attendees do.
    Both post-publish affordances point at the public page /e/[slug]; there is NO link
    anywhere in the organizer console to the attendee app agenda (/dashboard?tab=Agenda).
P3. 22 concurrent sessions render as an 11-row wrapped card wall (list), a 3,072px-wide
    horizontal scroll (grid: 22 lanes × 132px min), or by-room. Attendee task at a
    breakout-style event is "pick ONE per timeslot" — no view supports that task.
P4. Grid/By-room cells contain title+room only, single action = navigate to session page.
    Join requires leaving the grid and losing scroll position. Cells cannot even show
    joined state (TimetableSession carries no attendance data).

## Key codebase facts (Agent A)

- ReviewChangeset rows CAN carry the full session object (description, speakers, endTime,
  track, items, per-field confidence) — the UI renders only day · title · startTime · room.
  Confidence is collapsed to a single min and stripped when uniform. LOW_CONFIDENCE=0.8
  exists in the API and as a separate duplicated literal in the web component.
- Rows can only be UNCHECKED, never edited; rowsToApiChangeset already round-trips edited
  fields, so inline edit is structurally possible with no API change.
- No select-all/none anywhere (known: ux-audit 03:199). Creates default checked; deletes
  default unchecked; zero-create-with-deletes already collapses deletes into <details>.
- PDF is read multimodally (attachment), DOCX via mammoth — AI path confirmed.
- Publish success = a bare green <p>. "View program" after ingest → organizer Program tab.
  Attendee-app links exist only as context-free /dashboard in the sidebar Account group.
- List view density handling = a 12px "N concurrent sessions" note; then all cards render.
  Mobile is always List (switcher hidden <768px); 22 concurrent = 22 stacked cards.
- Join lives on the List card (2-modal flow — known friction, ux-audit 02:22) and the
  session page. Grid/By-room: click-through only, by design rule "never present a button
  that does nothing" (FIX_PLAN E0 item 5 — public page blocks stay non-interactive).
- Join (attendance/My Schedule) ≠ Star (reminders) ≠ Like (public signal): three tables,
  three endpoints; only Join feeds My Schedule.

## Industry patterns adopted (Agent B) — calm-filtered

- "Review the exceptions, trust the rest" (doc-AI standard) — but always show all rows,
  highlight low-confidence; reasons not raw percentages.
- Domain-shaped preview: review the SCHEDULE (grouped by day/slot with counts), not a
  flat row list (Gleanin/Cvent session-import pattern).
- Commit-to-draft is already our model — publish stays the real gate.
- Post-publish: success moment with copyable link + "view as audience" CTA (YouTube/
  Eventbrite/Wix) + persistent view-live affordance (Squarespace/Shopify). Both, not one.
- Dense programs: timeslot-first chunking; personal-agenda-first ("browse once, My
  Schedule is home" — Sched model); slot-picker semantics for breakout-style events
  (RegFox/Momice/MobileMind pattern). REJECTED as anti-calm: recommendation feeds,
  animated seat-scarcity, engagement badges.
- Dense-view actions: tap-opens-sheet/popover (Google Calendar model) for dense surfaces;
  always-visible join only where rows are roomy; never gesture-only actions.

## Design decisions (founder-confirmable; C's synthesis)

D1. RESOLVED — Import scope question: at review (or upload), ask "Is this file the full
    program or part of it?" Default: PART. Partial imports NEVER propose deletes.
    Full-program imports keep the delete section, quarantined at bottom, default-unchecked,
    with honest copy. Rationale: converts the one catastrophic failure (rubber-stamped
    bulk delete) into a non-event; mirrors additive-first principles.
D2. RESOLVED — Review is grouped by day+timeslot with per-group counts ("Breakout 1
    (10:00–11:00) — 21 sessions in 21 rooms"), groups collapsible, select all/none per
    section, comfortable type, no nested max-height scrolls. Assumptions stay at top as
    the primary verification object.
D3. RESOLVED — Upload copy says plainly: "Excel, PDF, Word, or pasted text — AI reads any
    of these and drafts sessions for your review." (PDF/DOCX capability already exists.)
D4. RESOLVED — Publish moment: success block with the live URL, Copy link, "View as
    attendees" (public page) AND "Open attendee app" (event-scoped, ?tab=Agenda), plus a
    persistent post-publish header affordance. No confetti; the sentence is the celebration.
D5. PENDING FOUNDER — Breakout-shape flag: per-event organizer-declared setting
    ("Attendees pick one session per timeslot"), SUGGESTED by the ingest assumptions when
    20+ sessions share identical start/end (AI drafts, human confirms). Gates the P3
    pick-one view and P4 replace-semantics. Additive (eventFeatureConfig or Event column).
D6. RESOLVED — Dense-view action model: tap a grid/by-room/list cell → bottom sheet
    (title, presenter, room, description snippet, Join primary, Star secondary, "Full
    details →"). Cells show STATE only (joined check, star dot), never buttons. Public
    page /e/[slug] stays non-interactive (standing rule). Roomy single-column rows may
    keep an inline Join.
D7. RESOLVED — Pick-one view (breakout events): timeslot accordion, current slot open,
    single-column rows, local filter box, join collapses the slot to "Your 10:00 — X ·
    Room · [Change]". Joining a second session in a slot prompts an honest replace
    confirm. No recommendations, no seat-count pressure; "Full — waitlist" stays factual.
D8. RESOLVED — Confidence: keep amber highlight; add plain-language reasons per flagged
    field when pipeline support lands (H6); never a bare constant; single source for the
    0.8 threshold (export from shared).

## H-series chunk plan

H1 (quick, frontend+copy): Publish moment + persistent view-as-attendee affordances (D4).
   Also ingest success banner gains "Open attendee app" alongside "View program".
H2 (quick, frontend): Review hygiene — grouped by day/slot with counts (D2), select
   all/none per section, remove nested scrolls, comfortable type, upload copy (D3),
   tokenized colors (audit 03:308). No pipeline changes.
H3 (medium, full-stack, no migration): Import-scope question (D1) — UI question at
   review; partial default suppresses delete proposals in changeset build; full keeps
   quarantined section. Tests on both paths.
H4 (medium, frontend + data threading): Session peek sheet (D6) on dashboard grid/
   by-room/list; thread joined/starred state into TimetableSession; single-modal join
   from the sheet (also fixes the known two-modal friction, audit 02:22, and the
   "Asynchronous- Time Zone Issues!" label). Grid cells gain joined-check/star-dot.
H5 (project, additive schema or flag): Breakout shape (D5) + pick-one timeslot view (D7):
   organizer setting, ingest suggestion in assumptions, accordion view, slot collapse,
   replace-confirm. Ships after H4 (reuses the sheet).
H6 (later, pipeline): Confidence reasons + inline edit-in-review (round-trip already
   supported by rowsToApiChangeset). Deferred until H1–H5 validate direction.

Sequencing rationale: H1/H2 are days-level quick wins closing founder-observed trust gaps;
H3 removes the destructive-review hazard before any pilot organizer imports a partial
file; H4 builds the one interaction component H5 depends on; H5 is the flagship attendee
experience for exactly the pilot demo shape (PD days / breakout conferences).

## H-GEN — describe your event, get a suggested agenda (added 2026-08-15)

Founder request: organizer provides parameters (days — prefilled from event dates; day
start/end; lunch/break windows; rooms by name or count; number of parallel sessions per
slot or total session count; breakout yes/no) → AI generates a draft agenda skeleton
(timeslots, placeholder sessions, breaks) for review.

Recon findings: the existing Setup assistant is a deterministic mock (fixed 4-block
skeleton, no rooms, no breakouts, no real AI) — H-GEN is its real successor for the
agenda part. The ingest pipeline is the delivery vehicle: extractToCreateChangeset is
source-agnostic, ReviewChangeset is already reused by 4 importers, and
confirmAgendaChangeset creates Session+Track+Room+Speaker from plain strings. The
demo-event generator (lib/demoEvent) has the parameter-driven write shape as precedent.

Design: structured form (not free-text chat) → generator emits ExtractedSession[] →
lands in the SAME grouped review screen (H2) with its choices as assumptions (including
a breakout-flag suggestion per D5) → confirm creates DRAFT sessions. Provenance: new
additive AgendaIngestSourceKind value GENERATED. Metering: reuse AGENDA_INGEST /
aiIngestPerEvent (FREE = 1/event; no schema change beyond the enum value). Breaks/lunch
render as sessions in a "Breaks" track (or isMinimal rows) — no new models.

Sequencing: after H3 (so generated output is born into the fixed review), before H4/H5.
Revised order: H1 → H2 → H3 → H-GEN → H4 → H5 → outreach.

## Settled ground honored (do not re-litigate)

- E19.1 concurrent card wrapping (designed for ≤5 tracks — H5/H7 supersede for breakout
  shape only, behind the flag; default agenda unchanged).
- E0 item 5: no dead buttons; public-page blocks stay static.
- E1 item 11: never display a constant confidence.
- F-series: tokens/config only, one earned count-up, reduced-motion, no engagement theatre.
- Calm anti-goals: no recommendations feed, no scarcity animation, no push.
